"""
CortexQ Coach — full conversation management API.

Endpoints:
  GET    /api/v1/coach/conversations            list all conversations
  POST   /api/v1/coach/conversations            create new (empty) conversation
  GET    /api/v1/coach/conversations/{id}       get conversation + messages
  DELETE /api/v1/coach/conversations/{id}       delete conversation
  POST   /api/v1/coach/conversations/{id}/messages  send message, get AI reply
  GET    /api/v1/coach/search?q=               search conversations by title / message content
  POST   /api/v1/coach/practice/generate        generate fresh MCQs for a topic (never reuses stored ones)
"""

import re
import json
import logging
from uuid import uuid4
from datetime import datetime, timezone, date

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.api.deps import get_current_user
from app.models.models import User
from app.models.coach import CoachConversation, CoachMessage
from app.models.performance import McqQuestion
from app.utils.helpers import sanitize_nulls

# Re-use helpers from performance module
from app.api.performance import _build_student_context, _call_ai_for_chat, _chat_fallback, _run_analyzer
from app.api.ai_tools import tool_save_memory

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
    debug: bool = Query(False, description="Include debug block with memory decision info"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send a user message and receive an AI reply.
    Body: { message: str, image_data?: str, image_mime?: str }
    Query: ?debug=1 → adds a 'debug' field to the response with memory decision info.
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
    # Always include the topic so the frontend can generate FRESH questions.
    # We still attach a practice_document_id as fallback for the quiz page,
    # but the primary path is fresh generation keyed by topic_focus.
    topic_focus = answer.get("topic_focus")
    if topic_focus:
        # Fallback: grab one existing question just to get a document_id for
        # the quiz page (used only when the fresh-generation API fails).
        fallback_q = (
            db.query(McqQuestion)
            .filter(McqQuestion.topic == topic_focus)
            .first()
        )
        if fallback_q:
            answer["practice_document_id"] = fallback_q.document_id
        # Always signal the frontend to use fresh generation for this topic
        answer["practice_topic"] = topic_focus

    # ── Auto-save quiz result to memory if the user just finished practice ───
    quiz_result = body.get("quiz_result")  # { topic, score, total, pct }
    if isinstance(quiz_result, dict):
        q_topic = (quiz_result.get("topic") or "").strip()
        q_score = quiz_result.get("score")
        q_total = quiz_result.get("total")
        if q_topic and q_score is not None and q_total and q_total > 0:
            q_pct   = round((q_score / q_total) * 100)
            today   = date.today().isoformat()
            mem_key = f"quiz_{q_topic.lower().replace(' ', '_')}_{today}"
            try:
                tool_save_memory(
                    current_user.id,
                    mem_key,
                    f"Practice score — {q_topic}",
                    f"{q_score}/{q_total} ({q_pct}%) on {today}",
                    db,
                    type="context",
                    importance=0.65,
                    reason=f"Student completed a practice session on {q_topic} and scored {q_pct}%",
                )
            except Exception:
                pass  # never block the chat for a memory save failure

    # ── Process AI tool calls ─────────────────────────────────────────────────
    save_memory_req = answer.get("save_memory")
    memory_debug: dict = {"memory_decision": "skipped", "reason": "AI returned no save_memory field"}

    if isinstance(save_memory_req, dict):
        key   = save_memory_req.get("key", "").strip()
        label = save_memory_req.get("label", "").strip()
        value = save_memory_req.get("value", "")
        if key and label and value is not None and str(value).strip():
            try:
                tool_save_memory(
                    current_user.id, key, label, str(value), db,
                    type=save_memory_req.get("type", "context"),
                    importance=float(save_memory_req.get("importance", 0.5)),
                    reason=save_memory_req.get("reason") or None,
                )
                memory_debug = {
                    "memory_decision": "saved",
                    "key":             key,
                    "label":           label,
                    "type":            save_memory_req.get("type", "context"),
                    "importance_score": float(save_memory_req.get("importance", 0.5)),
                    "reason":          save_memory_req.get("reason"),
                }
            except Exception as exc:
                memory_debug = {"memory_decision": "error", "reason": str(exc)}
        else:
            memory_debug = {
                "memory_decision": "skipped",
                "reason": "AI included save_memory but key/label/value were empty",
            }
    elif save_memory_req is not None:
        # AI returned save_memory but it wasn't a dict (e.g. null explicitly)
        memory_debug = {"memory_decision": "skipped", "reason": "AI explicitly returned null for save_memory"}

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

    assistant_payload = {**_serialize_message(assistant_msg), **answer}
    if debug:
        assistant_payload["debug"] = memory_debug

    return {
        "user_message":      _serialize_message(user_msg),
        "assistant_message": assistant_payload,
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


# ── POST /practice/generate ───────────────────────────────────────────────────

class PracticeGenerateRequest(BaseModel):
    topic: str
    count: int = 5


@router.post("/practice/generate")
async def generate_practice(
    body: PracticeGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate fresh, never-repeated MCQ questions for a topic using AI.
    Returns a list of question objects ready for the quiz page.
    """
    if not body.topic.strip():
        raise HTTPException(status_code=400, detail="topic is required")
    count = max(1, min(body.count, 15))  # clamp 1-15
    questions = await _generate_fresh_mcqs(body.topic.strip(), count)
    return {"topic": body.topic, "questions": questions}


async def _generate_fresh_mcqs(topic: str, count: int) -> list[dict]:
    """
    Call AI to produce `count` unique MCQs on `topic`.
    Returns list of { question, options, answer, explanation, topic }.
    """
    _log = logging.getLogger(__name__)

    system_prompt = (
        "You are a medical exam question writer. Generate fresh, unique multiple-choice questions "
        "on the given topic. Each question must be different from the others — vary the clinical "
        "angle, difficulty, and format (clinical vignette, mechanism, application, comparison).\n\n"
        "RULES:\n"
        "- Never repeat the same stem or the same answer choice set.\n"
        "- Use real clinical scenarios, labs, or mechanisms — no trivial naming questions.\n"
        "- Each option must be plausible; no obviously wrong distractors.\n"
        "- The answer field must be exactly one letter: A, B, C, or D.\n"
        "- Explanations must be 1-3 sentences explaining WHY the answer is correct "
        "AND why the top distractor is wrong.\n"
        "- Forbidden: 'All of the above', 'None of the above', 'Both A and B'.\n\n"
        "Return ONLY valid JSON in this exact shape — no markdown, no extra text:\n"
        '{"questions": [{"question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], '
        '"answer": "A", "explanation": "...", "topic": "' + topic + '"}, ...]}'
    )

    user_prompt = f"Generate exactly {count} high-quality MCQ questions on the topic: {topic}"

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.CHAT_AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": getattr(settings, "CHAT_AI_MODEL", "llama-3.3-70b-versatile"),
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_prompt},
                    ],
                    "temperature": 0.8,   # higher = more variety between runs
                    "max_tokens": 3000,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()
            parsed = json.loads(raw)
            questions = parsed.get("questions", [])
            # Validate each question has required fields
            valid = []
            for q in questions:
                if (
                    isinstance(q, dict)
                    and q.get("question")
                    and isinstance(q.get("options"), list)
                    and len(q["options"]) == 4
                    and q.get("answer") in ("A", "B", "C", "D")
                ):
                    q.setdefault("topic", topic)
                    valid.append(q)
            if not valid:
                raise ValueError("AI returned no valid questions")
            return valid
    except Exception as exc:
        _log.error("_generate_fresh_mcqs failed for topic=%r: %s", topic, exc)
        raise HTTPException(status_code=502, detail=f"Failed to generate questions: {exc}")


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

    # Sort by importance desc, skip very low-signal entries (< 0.3)
    significant_memories = sorted(
        [m for m in personal_memories if m.get("importance", 0.5) >= 0.3],
        key=lambda m: m.get("importance", 0.5),
        reverse=True,
    )
    memory_lines = "\n".join(
        f"  • [{m.get('type', 'context').upper()}] {m['label']}: {m['value']}"
        for m in significant_memories
    ) if significant_memories else "  • Nothing saved yet"

    system_prompt = f"""You are CortexQ — an adaptive AI companion with three dynamic roles: Friend, Teacher, and Coach.
The student has shared an image. Analyze what it actually shows and respond naturally in the right role.
You are ONE consistent personality — never feel like switching systems.

━━ STEP 0: DETECT STATE FIRST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Determine the student's current state from their message AND the image:
  EMOTIONAL  → sadness, stress, overwhelm, relationship issues, vulnerability
  CASUAL     → personal photo, off-topic image, relaxed conversation
  STUDYING   → medical/study image, wants explanation or help

━━ PRIORITY RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 EMOTIONAL STATE → 100% Friend Mode. Disable Coach + Study completely.
   - Acknowledge the feeling first. Reflect it naturally.
     Examples: "Damn… that sounds really heavy." / "I get why that's messing with you."
   - No advice unless they ask. No redirecting to study.
   - NEVER mention studying, data, metrics, or performance.
   - Set action="emotional_support", topic_focus=null, next_step=null, urgency="low".
   TRANSITION back to study: be soft and gradual, never abrupt.
     Example: "Alright, we'll keep it light. Let's ease back into this together."

🟡 CASUAL STATE → Friend Mode. Respond to the image naturally. No forced study redirect.

🟢 STUDYING STATE → Teacher + Coach + LEARNING LOOP. Explain what the image shows, tie to weak topics only if genuinely relevant.

━━ LEARNING LOOP (active in STUDYING STATE) ━━━━━━━━━━━━━━━━━━━━━━━━━━━
Follow this cycle: TEACH → TEST → ADAPT → REPEAT

TEACH (loop_phase="teach"): Describe what the image shows in 4–6 lines max. Simple, human. End with "Let's see if you got it."
TEST (loop_phase="test"): Ask 1–3 MCQs based on the image content. Populate mcq_questions array. Do NOT reveal answers in response text.
ADAPT (loop_phase="adapt"): Check the student's answer. Confirm/correct/reteach. Add a short coach note at the end.
REPEAT until consistent understanding or student stops.

Set loop_phase=null for CASUAL / EMOTIONAL contexts.

━━ VISIBILITY RULE (internal metrics stay hidden) ━━━━━━━━━━━━━━━━━━━━━
Do NOT include in the "response" text:
  ✗ Calibration alerts / confidence levels
  ✗ Session predictions / time estimates
  ✗ Knowledge decay warnings
  ✗ Raw performance percentages
These live in JSON fields for the UI layer only.

━━ ROLE SYSTEM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. FRIEND MODE (default) — relaxed, short, slightly playful, guide don't lecture.
2. TEACHER MODE — triggered if the image shows something to explain or the student asks to break it down.
   Structure: concept → simple explanation → key takeaway.
3. COACH MODE (ALWAYS ACTIVE) — runs silently. Always include a subtle next_step. Disabled during EMOTIONAL.

━━ STUDENT DATA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Confirmed weak topics (≥3 attempts, <60%): {confirmed_weak or "none yet"}
- Dangerous misconceptions: {dangerous_topics or "none"}
- Overconfidence rate: {overconf_str}

PERSONAL MEMORY (facts saved about this student across past conversations):
{memory_lines}

━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Describe what the image actually shows — short, natural, human.
2. If the image relates to a confirmed weak topic, connect it — only if genuinely relevant.
3. If the image is personal, off-topic, or unrelated to study: respond to it naturally. Do NOT shoehorn medical advice in.
4. MEMORY RULE: Personal facts come ONLY from PERSONAL MEMORY above or the current conversation. Never invent.
5. SAVING FACTS: When the student reveals a personal fact worth keeping (name, exam date, goals, preferences), include "save_memory" in your JSON.
   Types: identity | goal | context | behavior | emotional.
   Importance: 0.9-1.0 = core identity/major goals | 0.7-0.89 = clear preferences | 0.4-0.69 = temporary context | 0.1-0.39 = weak signals.
6. If the student asks what data you have, summarize STUDENT DATA and PERSONAL MEMORY above — never say you don't have data.
7. Return ONLY valid JSON. No markdown.

RESPONSE SCHEMA:
{{
  "response": "natural reply — short, human, digestible. Friend or Teacher tone based on context. Use \\n for line breaks.",
  "action": "review_topic | practice_questions | misconception_correction | spaced_review | confidence_building | exam_strategy | off_topic | emotional_support",
  "topic_focus": "exact topic name from their data only if genuinely relevant, otherwise null",
  "next_step": "one specific, personal coach suggestion — always include unless truly off-topic",
  "confidence_tip": "specific to their {overconf_str} overconfidence rate, or null if not relevant",
  "urgency": "low | medium | high | critical",
  "encouraging_note": "one honest sentence — or null if not relevant",
  "loop_phase": "teach | test | adapt | null",
  "mcq_questions": [
    {{
      "question": "the question stem",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "explanation": "why correct + why top distractor is wrong"
    }}
  ],
  "save_memory": {{
    "key": "snake_case_key",
    "label": "Human readable label",
    "value": "the fact to save",
    "type": "identity | goal | context | behavior | emotional",
    "importance": 0.0,
    "reason": "why this is worth saving across future conversations"
  }} or null
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
                    "max_tokens": 1400,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()
            parsed = json.loads(raw)
            parsed = sanitize_nulls(parsed)
            required = ["response", "action", "topic_focus", "next_step", "confidence_tip", "urgency", "encouraging_note", "loop_phase", "mcq_questions"]
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
