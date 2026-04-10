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
import logging
from typing import Any
from uuid import uuid4
from datetime import datetime, timezone

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
from app.api.performance import _build_student_context, _call_ai_for_chat, _chat_fallback, _run_analyzer
from app.api.ai_tools import tool_save_memory

router = APIRouter(prefix="/api/v1/coach", tags=["coach"])


def sanitize_nulls(obj: Any) -> Any:
    """
    Convert AI-generated sentinel strings for missing values into real JSON nulls.
    Handles nested dicts and lists recursively.
    """
    replaced = False

    def _sanitize(value: Any) -> Any:
        nonlocal replaced
        if isinstance(value, dict):
            return {key: _sanitize(val) for key, val in value.items()}
        if isinstance(value, list):
            return [_sanitize(item) for item in value]
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"null", "none", ""}:
                replaced = True
                return None
        return value

    cleaned = _sanitize(obj)
    if replaced:
        logging.getLogger(__name__).debug("Sanitized AI response null-like strings to JSON null")
    return cleaned


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
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
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

    # Enforce message length limit
    if len(text) > 10_000:
        raise HTTPException(status_code=400, detail="Message too long (max 10,000 characters)")

    # Enforce image size limit (base64 ~4/3 overhead → 5 MB raw ≈ 6.8 MB base64)
    _MAX_IMAGE_B64 = 7 * 1024 * 1024
    if image_data and len(image_data) > _MAX_IMAGE_B64:
        raise HTTPException(status_code=413, detail="Image too large (max 5 MB)")

    # ── Save user message ─────────────────────────────────────────────────────
    user_msg = CoachMessage(
        id=str(uuid4()),
        conversation_id=conv_id,
        student_id=current_user.id,
        role="user",
        content=text or "",
        image_data=image_data,
        image_mime=image_mime,
        created_at=datetime.now(timezone.utc),
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

    # Run the Analyzer first so the chat model gets a precise briefing instead
    # of having to re-derive priority from raw numbers itself.
    # If the student has no data yet the analyzer gracefully returns nothing.
    analyzer_decision: dict | None = None
    try:
        analyzer_decision = await _run_analyzer(context)
        if not analyzer_decision.get("primary_topic"):
            analyzer_decision = None
    except Exception:
        analyzer_decision = None  # no data yet — chat works fine without it

    if image_data and image_mime:
        # Vision call also receives the analyzer decision via context extension
        if analyzer_decision:
            context = {**context, "_analyzer_decision": analyzer_decision}
        answer = await _call_ai_vision(context, user_message_for_ai, image_data, image_mime, history)
    else:
        answer = await _call_ai_for_chat(
            context,
            user_message_for_ai,
            conversation_history=history,
            analyzer_decision=analyzer_decision,
        )

    # ── Attach hard-data enrichments (no AI needed — computed from context) ──────
    if analyzer_decision and analyzer_decision.get("primary_topic"):
        primary_topic = analyzer_decision["primary_topic"]
        target_acc    = analyzer_decision.get("target_accuracy", 70)

        # Mastery progress bar data
        weak_topics   = context.get("weak_topics", [])
        topic_stat    = next((t for t in weak_topics if t.get("topic") == primary_topic), {})
        current_acc   = round((topic_stat.get("accuracy", 0)) * 100)
        answer["mastery_progress"] = {
            "topic":   primary_topic,
            "current": current_acc,
            "target":  target_acc,
        }

        # Topic unlock chain — all topics that co-fail with the priority topic
        all_pairs  = context.get("co_failure_pairs", [])
        unlocks    = []
        for p in all_pairs:
            if p.get("topic_a") == primary_topic and p.get("topic_b") not in unlocks:
                unlocks.append(p["topic_b"])
            elif p.get("topic_b") == primary_topic and p.get("topic_a") not in unlocks:
                unlocks.append(p["topic_a"])
        if unlocks:
            answer["topic_chain"] = unlocks[:4]  # cap at 4 for UI clarity

        # Days since last session
        recent = context.get("recent_sessions", [])
        if recent and recent[0].get("days_ago") is not None:
            answer["days_since_last"] = recent[0]["days_ago"]

        # Relapse flag — student previously mastered this topic but regressed
        if topic_stat.get("times_mastered", 0) > 0 and topic_stat.get("accuracy", 1.0) < 0.6:
            answer["is_relapse"] = True

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

    # ── Process AI tool calls ─────────────────────────────────────────────────
    save_memory_req = answer.get("save_memory")
    if isinstance(save_memory_req, dict):
        key   = save_memory_req.get("key", "").strip()
        label = save_memory_req.get("label", "").strip()
        value = save_memory_req.get("value", "")
        if key and label and value is not None and str(value).strip():
            try:
                tool_save_memory(current_user.id, key, label, str(value), db)
            except Exception:
                pass  # never let a memory save failure break the chat

    # ── Save assistant message ────────────────────────────────────────────────
    ai_text = answer.get("response", "")
    assistant_msg = CoachMessage(
        id=str(uuid4()),
        conversation_id=conv_id,
        student_id=current_user.id,
        role="assistant",
        content=ai_text,
        ai_metadata=answer,
        created_at=datetime.now(timezone.utc),
    )
    db.add(assistant_msg)

    # ── Update conversation metadata ──────────────────────────────────────────
    conv.message_count = (conv.message_count or 0) + 2
    conv.updated_at = datetime.now(timezone.utc)

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
    q: str = Query(..., min_length=1, max_length=100),
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
    personal_memories = context.get("personal_memories", [])

    memory_lines = "\n".join(
        f"  • {m['label']}: {m['value']}" for m in personal_memories
    ) if personal_memories else "  • Nothing saved yet"

    system_prompt = f"""You are Sage — CortexQ's personal study coach. You have this student's real performance data loaded below and you always use it. You never say "I don't know" or "I don't have access to your data" — that data is right here.
The student has shared an image. Analyze what it actually shows and respond naturally.

STUDENT DATA:
- Confirmed weak topics (≥3 attempts, <60%): {confirmed_weak or "none yet"}
- Dangerous misconceptions: {dangerous_topics or "none"}
- Overconfidence rate: {overconf_str}

PERSONAL MEMORY (facts you saved about this student across all past conversations):
{memory_lines}

RULES:
1. Describe what the image actually shows.
2. If the image is about a medical or study topic AND it relates to a confirmed weak topic, connect it — but only if genuinely relevant.
3. If the image is personal, off-topic, or about a conversation (e.g. a screenshot of a chat), respond to it naturally WITHOUT forcing a redirect to study topics. Do not shoehorn medical advice into unrelated images.
4. MEMORY RULE: Personal facts you remember come ONLY from the PERSONAL MEMORY section above or the current conversation. You do NOT have access to previous separate conversations. If the student shows you a screenshot proving you forgot something, acknowledge it honestly — and if they reveal a fact worth saving, include "save_memory" in your response.
5. SAVING FACTS: When the student reveals a personal fact worth remembering (name, exam date, goals, preferences), include "save_memory" in your JSON.
6. If the student asks what data you have about them, summarize the STUDENT DATA and PERSONAL MEMORY above — never say you don't have data.
7. Return ONLY valid JSON. No markdown.

RESPONSE SCHEMA:
{{
  "response": "natural reply to what the image actually shows — 1-2 sentences",
  "action": "review_topic | practice_questions | misconception_correction | spaced_review | confidence_building | exam_strategy | off_topic",
  "topic_focus": "exact topic name from their data only if genuinely relevant, otherwise null",
  "next_step": "one specific study action — or null if the image is not study-related",
  "confidence_tip": "specific to their {overconf_str} overconfidence rate, or null if not relevant",
  "urgency": "low | medium | high | critical",
  "encouraging_note": "one honest sentence — or null if not relevant",
  "save_memory": {{"key": "snake_case_key", "label": "Human readable label", "value": "the fact to save"}} or null
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

    _log = logging.getLogger(__name__)

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
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()
            parsed = json.loads(raw)
            parsed = sanitize_nulls(parsed)
            required = ["response", "action", "topic_focus", "next_step", "confidence_tip", "urgency", "encouraging_note"]
            for key in required:
                parsed.setdefault(key, None)
            return parsed
    except Exception as e:
        _log.warning("Vision call failed (%s), falling back to text-only", e)
        fallback_msg = text if text else "I sent you an image to look at."
        # Preserve analyzer decision through the fallback path
        fallback_decision = context.pop("_analyzer_decision", None)
        return await _call_ai_for_chat(
            context, fallback_msg,
            conversation_history=history,
            analyzer_decision=fallback_decision,
        )
