"""
CortexQ Coach — full conversation management API.

Endpoints:
  GET    /api/v1/coach/conversations            list all conversations
  POST   /api/v1/coach/conversations            create new (empty) conversation
  GET    /api/v1/coach/conversations/{id}       get conversation + messages
  DELETE /api/v1/coach/conversations/{id}       delete conversation
  POST   /api/v1/coach/conversations/{id}/messages  send message, get AI reply
  GET    /api/v1/coach/search?q=               search conversations by title / message content
"""

import re
import json
from uuid import uuid4
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.api.deps import get_current_user
from app.models.models import User
from app.models.coach import CoachConversation, CoachMessage
from app.models.performance import McqQuestion

# Re-use helpers from performance module
from app.api.performance import _build_student_context, _call_ai_for_chat, _chat_fallback

router = APIRouter(prefix="/api/v1/coach", tags=["coach"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_message(msg: CoachMessage) -> dict:
    return {
        "id":              msg.id,
        "role":            msg.role,
        "content":         msg.content,
        "image_data":      msg.image_data,
        "image_mime":      msg.image_mime,
        "ai_metadata":     msg.ai_metadata,
        "created_at":      msg.created_at.isoformat(),
    }


def _serialize_conversation(conv: CoachConversation) -> dict:
    return {
        "id":            conv.id,
        "title":         conv.title,
        "message_count": conv.message_count,
        "created_at":    conv.created_at.isoformat(),
        "updated_at":    conv.updated_at.isoformat(),
    }


# ── GET /conversations ────────────────────────────────────────────────────────

@router.get("/conversations")
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convs = (
        db.query(CoachConversation)
        .filter(CoachConversation.student_id == current_user.id)
        .order_by(CoachConversation.updated_at.desc())
        .all()
    )
    return [_serialize_conversation(c) for c in convs]


# ── POST /conversations ───────────────────────────────────────────────────────

@router.post("/conversations")
def create_conversation(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = CoachConversation(
        id=str(uuid4()),
        student_id=current_user.id,
        title="New Conversation",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        message_count=0,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _serialize_conversation(conv)


# ── GET /conversations/{id} ───────────────────────────────────────────────────

@router.get("/conversations/{conv_id}")
def get_conversation(
    conv_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = db.query(CoachConversation).filter(
        CoachConversation.id == conv_id,
        CoachConversation.student_id == current_user.id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = (
        db.query(CoachMessage)
        .filter(CoachMessage.conversation_id == conv_id)
        .order_by(CoachMessage.created_at.asc())
        .all()
    )
    return {
        **_serialize_conversation(conv),
        "messages": [_serialize_message(m) for m in messages],
    }


# ── DELETE /conversations/{id} ────────────────────────────────────────────────

@router.delete("/conversations/{conv_id}")
def delete_conversation(
    conv_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = db.query(CoachConversation).filter(
        CoachConversation.id == conv_id,
        CoachConversation.student_id == current_user.id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.query(CoachMessage).filter(CoachMessage.conversation_id == conv_id).delete()
    db.delete(conv)
    db.commit()
    return {"status": "deleted"}


# ── POST /conversations/{id}/messages ────────────────────────────────────────

@router.post("/conversations/{conv_id}/messages")
async def send_message(
    conv_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send a user message and receive an AI reply.
    Body: { message: str, image_data?: str, image_mime?: str }
    """
    conv = db.query(CoachConversation).filter(
        CoachConversation.id == conv_id,
        CoachConversation.student_id == current_user.id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    text = (body.get("message") or "").strip()
    image_data = body.get("image_data")   # base64 data URL
    image_mime = body.get("image_mime")

    if not text and not image_data:
        raise HTTPException(status_code=400, detail="message or image_data is required")

    # ── Save user message ─────────────────────────────────────────────────────
    user_msg = CoachMessage(
        id=str(uuid4()),
        conversation_id=conv_id,
        student_id=current_user.id,
        role="user",
        content=text or "",
        image_data=image_data,
        image_mime=image_mime,
        created_at=datetime.utcnow(),
    )
    db.add(user_msg)

    # ── Build conversation history for AI (last 8 turns) ─────────────────────
    prior_messages = (
        db.query(CoachMessage)
        .filter(CoachMessage.conversation_id == conv_id)
        .order_by(CoachMessage.created_at.asc())
        .all()
    )

    history: list[dict] = []
    for m in prior_messages[-16:]:   # last 8 pairs
        if m.role == "user":
            # Build content — text + optional image for vision models
            if m.image_data and image_mime:
                history.append({
                    "role": "user",
                    "content": [
                        {"type": "text", "text": m.content or "(image attached)"},
                        {"type": "image_url", "image_url": {"url": m.image_data}},
                    ],
                })
            else:
                history.append({"role": "user", "content": m.content})
        else:
            history.append({"role": "assistant", "content": m.content})

    # Current message (with image if present)
    if image_data and image_mime:
        user_message_for_ai = f"{text}\n[User attached an image]" if text else "[User attached an image]"
    else:
        user_message_for_ai = text

    # ── Call AI ───────────────────────────────────────────────────────────────
    context = _build_student_context(current_user.id, db)

    if image_data and image_mime:
        # Use vision-capable model
        answer = await _call_ai_vision(context, user_message_for_ai, image_data, image_mime, history)
    else:
        answer = await _call_ai_for_chat(context, user_message_for_ai, conversation_history=history)

    # ── Attach practice questions for topic_focus ─────────────────────────────
    topic_focus = answer.get("topic_focus")
    if topic_focus:
        practice_qs = (
            db.query(McqQuestion)
            .filter(McqQuestion.topic == topic_focus)
            .limit(3)
            .all()
        )
        if practice_qs:
            answer["practice_questions"] = [
                {
                    "id": q.id,
                    "document_id": q.document_id,
                    "topic": q.topic,
                    "preview": (q.question_text[:100] + "…") if len(q.question_text) > 100 else q.question_text,
                }
                for q in practice_qs
            ]
            answer["practice_document_id"] = practice_qs[0].document_id

    # ── Save assistant message ────────────────────────────────────────────────
    ai_text = answer.get("response", "")
    assistant_msg = CoachMessage(
        id=str(uuid4()),
        conversation_id=conv_id,
        student_id=current_user.id,
        role="assistant",
        content=ai_text,
        ai_metadata=answer,
        created_at=datetime.utcnow(),
    )
    db.add(assistant_msg)

    # ── Update conversation metadata ──────────────────────────────────────────
    conv.message_count = (conv.message_count or 0) + 2
    conv.updated_at = datetime.utcnow()

    # Auto-title on first user message
    if conv.title == "New Conversation" and text:
        conv.title = text[:60] + ("…" if len(text) > 60 else "")

    db.commit()

    return {
        "user_message":      _serialize_message(user_msg),
        "assistant_message": {**_serialize_message(assistant_msg), **answer},
    }


# ── GET /search ───────────────────────────────────────────────────────────────

@router.get("/search")
def search_conversations(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search conversation titles and message content."""
    like = f"%{q}%"

    # Conversations whose title matches
    title_hits = (
        db.query(CoachConversation)
        .filter(
            CoachConversation.student_id == current_user.id,
            CoachConversation.title.ilike(like),
        )
        .all()
    )

    # Conversations with matching message content
    msg_conv_ids = [
        row[0]
        for row in db.query(CoachMessage.conversation_id)
        .filter(
            CoachMessage.student_id == current_user.id,
            CoachMessage.content.ilike(like),
        )
        .distinct()
        .all()
    ]

    all_ids = {c.id for c in title_hits} | set(msg_conv_ids)
    if not all_ids:
        return []

    results = (
        db.query(CoachConversation)
        .filter(
            CoachConversation.id.in_(all_ids),
            CoachConversation.student_id == current_user.id,
        )
        .order_by(CoachConversation.updated_at.desc())
        .all()
    )
    return [_serialize_conversation(c) for c in results]


# ── Vision AI call (Groq llama-3.2-vision) ────────────────────────────────────

async def _call_ai_vision(
    context: dict,
    text: str,
    image_data: str,
    image_mime: str,
    history: list[dict],
) -> dict:
    """
    Vision-capable AI call. Falls back to regular chat if vision call fails.
    """
    weak_topics_data = context.get("weak_topics", [])
    confirmed_weak  = [t["topic"] for t in weak_topics_data if t.get("total_attempts", 0) >= 3 and t.get("accuracy", 1.0) < 0.6]
    dangerous_topics = [t["topic"] for t in weak_topics_data if t.get("dangerous_misconception")]
    overconf = context.get("calibration", {}).get("overconfidence_rate")
    overconf_str = f"{overconf:.0%}" if isinstance(overconf, float) else "unknown"

    system_prompt = f"""You are CortexQ Coach — a knowledgeable, direct tutor for medical students.
The student has shared an image (likely a diagram, question, or notes). Analyze it and connect it to their study needs.

STUDENT DATA:
- Confirmed weak topics (≥3 attempts, <60%): {confirmed_weak or "none yet"}
- Dangerous misconceptions: {dangerous_topics or "none"}
- Overconfidence rate: {overconf_str}

RULES:
1. Tell the student what the image shows and what's important about it medically.
2. If it relates to a confirmed weak topic, connect it explicitly.
3. Lead with what TO DO — not what they failed at.
4. Return ONLY valid JSON. No markdown.

RESPONSE SCHEMA:
{{
  "response": "what the image shows + direct coaching insight in 1-2 conversational sentences",
  "action": "review_topic | practice_questions | misconception_correction | spaced_review | confidence_building | exam_strategy | off_topic",
  "topic_focus": "exact topic name from their data, or null",
  "next_step": "one specific action with a number and target",
  "confidence_tip": "specific to their {overconf_str} overconfidence rate",
  "urgency": "low | medium | high | critical",
  "encouraging_note": "one honest specific sentence — no hollow filler"
}}"""

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history[-8:])
    messages.append({
        "role": "user",
        "content": [
            {"type": "text", "text": text or "What is this?"},
            {"type": "image_url", "image_url": {"url": image_data}},
        ],
    })

    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.CHAT_AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": 700,
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()
            parsed = json.loads(raw)
            required = ["response", "action", "topic_focus", "next_step", "confidence_tip", "urgency", "encouraging_note"]
            for key in required:
                parsed.setdefault(key, None)
            return parsed
    except Exception:
        # Fall back to text-only call
        return await _call_ai_for_chat(context, text or "I shared an image.", conversation_history=history)
