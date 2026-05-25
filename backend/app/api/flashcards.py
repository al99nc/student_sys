"""
Flashcard API router — /api/v1/flashcards

Endpoints:
  POST  /generate/{document_id}          AI generation for a lecture
  GET   /due                             Cards due for review today
  POST  /{flashcard_id}/review           Submit a review rating
  GET   /document/{document_id}          Browse all cards for a lecture
  GET   /stats                           Study statistics
  GET   /schedule                        Per-topic retention overview
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.entitlements import count_uploads_this_month, upload_limit_for_user
from app.core.limiter import limiter
from app.db.database import SessionLocal, get_db
from app.models.flashcards import Flashcard, FlashcardFsrsCard, FlashcardReview
from app.models.models import Lecture, User
from app.models.performance import WeakPoint
from app.schemas.flashcards import (
    FlashcardOut,
    FlashcardStats,
    FlashcardUpdate,
    GenerateRequest,
    GenerateResponse,
    ReviewRequest,
    ReviewResponse,
)
from app.services.flashcard_service import (
    _dedup_cards,
    generate_flashcards_for_document,
)
from app.services.pdf_service import extract_text_from_pdf
from app.services.generator import _chunk_text
from starlette.requests import Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/flashcards", tags=["flashcards"])

_FLASHCARD_CHUNK_SIZE = 6_000

# FSRS forgetting-curve constants (mirrored from performance.py)
_FSRS_DECAY = -0.5
_FSRS_FACTOR = 0.9 ** (1.0 / _FSRS_DECAY) - 1


def _ensure_tz(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _fsrs_retention(elapsed_days: float, stability: float) -> float:
    if stability <= 0:
        return 0.0
    return (1.0 + _FSRS_FACTOR * elapsed_days / stability) ** _FSRS_DECAY


def _card_to_out(
    card: Flashcard,
    fsrs: FlashcardFsrsCard | None,
    now: datetime,
) -> dict:
    days_overdue = None
    if fsrs:
        due = _ensure_tz(fsrs.due_date)
        if due and due < now:
            days_overdue = max(0, (now - due).days)

    return {
        "id": card.id,
        "document_id": card.document_id,
        "topic": card.topic,
        "front": card.front,
        "back": card.back,
        "memory_tip": card.memory_tip,
        "card_type": card.card_type,
        "difficulty": card.difficulty,
        "is_starred": bool(card.is_starred),
        "fsrs_state": fsrs.state if fsrs else None,
        "days_overdue": days_overdue,
        "lapses": fsrs.lapses if fsrs else None,
    }


@router.post("/", response_model=FlashcardOut)
def create_manual_flashcard(
    body: FlashcardUpdate,  # Reuse Update schema but require front/back/doc_id
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    document_id: int = Query(...),
):
    lecture = db.query(Lecture).filter(
        Lecture.id == document_id,
        Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    front = (body.front or "").strip()
    back = (body.back or "").strip()
    if not front or not back:
        raise HTTPException(status_code=400, detail="Front and back are required")

    card = Flashcard(
        id=str(uuid4()),
        document_id=document_id,
        topic=lecture.topic_area or lecture.title or "General",
        front=front,
        back=back,
        memory_tip=body.memory_tip,
        card_type=body.card_type or "concept",
        difficulty=body.difficulty or "medium",
        created_at=datetime.now(timezone.utc),
    )
    db.add(card)
    db.commit()
    db.refresh(card)

    now = datetime.now(timezone.utc)
    return _card_to_out(card, None, now)


# ── PATCH /{flashcard_id} ─────────────────────────────────────────────────────

@router.patch("/{flashcard_id}", response_model=FlashcardOut)
def update_flashcard(
    flashcard_id: str,
    body: FlashcardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify the card exists and belongs to the user via document_id
    card = db.query(Flashcard).filter(Flashcard.id == flashcard_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Flashcard not found")

    lecture = db.query(Lecture).filter(
        Lecture.id == card.document_id,
        Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=403, detail="Not authorized to edit this card")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(card, key, value)

    db.commit()
    db.refresh(card)

    now = datetime.now(timezone.utc)
    fsrs = db.query(FlashcardFsrsCard).filter(
        FlashcardFsrsCard.student_id == current_user.id,
        FlashcardFsrsCard.flashcard_id == flashcard_id
    ).first()

    return _card_to_out(card, fsrs, now)


# ── DELETE /{flashcard_id} ────────────────────────────────────────────────────

@router.delete("/{flashcard_id}")
def delete_flashcard(
    flashcard_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    card = db.query(Flashcard).filter(Flashcard.id == flashcard_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Flashcard not found")

    lecture = db.query(Lecture).filter(
        Lecture.id == card.document_id,
        Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=403, detail="Not authorized to delete this card")

    # Clean up associated FSRS and review data
    db.query(FlashcardFsrsCard).filter(FlashcardFsrsCard.flashcard_id == flashcard_id).delete()
    db.query(FlashcardReview).filter(FlashcardReview.flashcard_id == flashcard_id).delete()
    db.delete(card)
    db.commit()

    return {"message": "Flashcard deleted successfully"}


# ── POST /generate/{document_id} ──────────────────────────────────────────────

@router.post("/generate/{document_id}", response_model=GenerateResponse)
@limiter.limit("5/minute")
async def generate_flashcards(
    request: Request,
    document_id: int,
    body: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = db.query(Lecture).filter(
        Lecture.id == document_id,
        Lecture.user_id == current_user.id,
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    # Free tier: flashcard generation counts against the same upload quota
    from app.core.entitlements import plan_tier
    if plan_tier(current_user) == "free":
        n = count_uploads_this_month(db, current_user.id)
        if n > upload_limit_for_user(current_user):
            raise HTTPException(
                status_code=403,
                detail="Monthly upload limit reached. Upgrade to Pro for more.",
            )

    # Skip if already generated
    existing_count = db.query(Flashcard).filter(
        Flashcard.document_id == document_id
    ).count()
    if existing_count >= 5:
        existing_ids = [
            row[0] for row in db.query(Flashcard.id)
            .filter(Flashcard.document_id == document_id)
            .all()
        ]
        return GenerateResponse(generated_count=0, card_ids=existing_ids)

    try:
        text = extract_text_from_pdf(lecture.file_path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read lecture file: {e}")

    topic = lecture.topic_area or lecture.title or "General"
    chunks = _chunk_text(text, chunk_size=_FLASHCARD_CHUNK_SIZE)

    raw_cards = await generate_flashcards_for_document(
        chunks, topic, document_id, mode=body.mode
    )

    existing_fronts = {
        row[0].strip().lower()
        for row in db.query(Flashcard.front)
        .filter(Flashcard.document_id == document_id)
        .all()
    }

    unique_cards = _dedup_cards(raw_cards, existing_fronts)

    saved_ids: list[str] = []
    for card in unique_cards:
        front = (card.get("front") or "").strip()
        back = (card.get("back") or "").strip()
        if not front or not back:
            continue
        fc = Flashcard(
            id=str(uuid4()),
            document_id=document_id,
            topic=topic,
            front=front,
            back=back,
            memory_tip=(card.get("memory_tip") or "").strip() or None,
            card_type=card.get("card_type", "concept"),
            difficulty=card.get("difficulty", "medium"),
            source_text=(card.get("source_text") or "")[:500] or None,
        )
        db.add(fc)
        saved_ids.append(fc.id)

    db.commit()
    return GenerateResponse(generated_count=len(saved_ids), card_ids=saved_ids)


# ── GET /due ──────────────────────────────────────────────────────────────────

@router.get("/due")
def get_due_cards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    document_id: int | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
):
    now = datetime.now(timezone.utc)

    # Cards with existing FSRS state that are due
    fsrs_q = db.query(FlashcardFsrsCard).filter(
        FlashcardFsrsCard.student_id == current_user.id,
        FlashcardFsrsCard.due_date <= now,
    )
    if document_id is not None:
        fsrs_q = fsrs_q.join(
            Flashcard, FlashcardFsrsCard.flashcard_id == Flashcard.id
        ).filter(Flashcard.document_id == document_id)

    due_fsrs = fsrs_q.all()

    # IDs the student has already seen
    seen_ids_rows = db.query(FlashcardFsrsCard.flashcard_id).filter(
        FlashcardFsrsCard.student_id == current_user.id
    ).all()
    seen_ids = [row[0] for row in seen_ids_rows]

    # New cards (never reviewed) — fill up to limit
    new_q = db.query(Flashcard)
    if seen_ids:
        new_q = new_q.filter(~Flashcard.id.in_(seen_ids))
    
    if document_id is not None:
        new_q = new_q.filter(Flashcard.document_id == document_id)

    new_cards = new_q.limit(max(0, limit - len(due_fsrs))).all()

    # Build priority-sorted output
    def priority(fsrs_row: FlashcardFsrsCard) -> tuple:
        # critical: lapses >= 2 → (0, ...)
        # high: overdue >= 3 days → (1, ...)
        # rest → (2, ...)
        lapses = fsrs_row.lapses or 0
        due = _ensure_tz(fsrs_row.due_date)
        days_over = max(0, (now - due).days) if due else 0
        if lapses >= 2:
            return (0, -lapses)
        if days_over >= 3:
            return (1, -days_over)
        return (2, 0)

    due_fsrs_sorted = sorted(due_fsrs, key=priority)

    cards_out: list[dict] = []
    fsrs_map: dict[str, FlashcardFsrsCard] = {}

    for f in due_fsrs_sorted[:limit]:
        card = db.query(Flashcard).filter(Flashcard.id == f.flashcard_id).first()
        if card:
            fsrs_map[card.id] = f
            cards_out.append(_card_to_out(card, f, now))

    for card in new_cards:
        if len(cards_out) >= limit:
            break
        cards_out.append(_card_to_out(card, None, now))

    return {"due_count": len(cards_out), "cards": cards_out}


# ── POST /{flashcard_id}/review ───────────────────────────────────────────────

@router.post("/{flashcard_id}/review", response_model=ReviewResponse)
def review_flashcard(
    flashcard_id: str,
    body: ReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    card = db.query(Flashcard).filter(Flashcard.id == flashcard_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Flashcard not found")

    now = datetime.now(timezone.utc)

    # Load or create FlashcardFsrsCard
    fsrs = db.query(FlashcardFsrsCard).filter(
        FlashcardFsrsCard.student_id == current_user.id,
        FlashcardFsrsCard.flashcard_id == flashcard_id,
    ).first()

    # Run FSRS update
    interval_days = 1
    new_state = 1
    new_stability = None
    next_due = now + timedelta(days=interval_days)

    try:
        from fsrs import FSRS, Card, Rating, State as FsrsState

        rating_map = {1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy}
        rating = rating_map.get(body.rating, Rating.Good)
        scheduler = FSRS()

        if fsrs:
            existing_card = Card(
                due=_ensure_tz(fsrs.due_date),
                stability=fsrs.stability or 0.0,
                difficulty=fsrs.difficulty or 0.0,
                elapsed_days=fsrs.elapsed_days,
                scheduled_days=fsrs.scheduled_days,
                reps=fsrs.reps,
                lapses=fsrs.lapses,
                state=FsrsState(fsrs.state),
                last_review=_ensure_tz(fsrs.last_review_date),
            )
            updated, _ = scheduler.review_card(existing_card, rating, now=now)
            fsrs.stability = updated.stability
            fsrs.difficulty = updated.difficulty
            fsrs.due_date = updated.due
            fsrs.last_review_date = now
            fsrs.state = updated.state.value
            fsrs.reps = updated.reps
            fsrs.lapses = updated.lapses
            fsrs.elapsed_days = updated.elapsed_days
            fsrs.scheduled_days = updated.scheduled_days
            fsrs.updated_at = now
        else:
            new_card = Card()
            updated, _ = scheduler.review_card(new_card, rating, now=now)
            fsrs = FlashcardFsrsCard(
                id=str(uuid4()),
                student_id=current_user.id,
                flashcard_id=flashcard_id,
                stability=updated.stability,
                difficulty=updated.difficulty,
                due_date=updated.due,
                last_review_date=now,
                state=updated.state.value,
                reps=updated.reps,
                lapses=updated.lapses,
                elapsed_days=updated.elapsed_days,
                scheduled_days=updated.scheduled_days,
                updated_at=now,
            )
            db.add(fsrs)

        interval_days = fsrs.scheduled_days or 1
        new_state = fsrs.state
        new_stability = fsrs.stability
        next_due = _ensure_tz(fsrs.due_date) or now + timedelta(days=interval_days)

    except ImportError:
        # py-fsrs not installed — simple +1 day fallback
        if not fsrs:
            fsrs = FlashcardFsrsCard(
                id=str(uuid4()),
                student_id=current_user.id,
                flashcard_id=flashcard_id,
                due_date=now + timedelta(days=1),
                last_review_date=now,
                state=1,
                reps=1,
                lapses=0,
                elapsed_days=0,
                scheduled_days=1,
                updated_at=now,
            )
            db.add(fsrs)
        else:
            fsrs.due_date = now + timedelta(days=1)
            fsrs.last_review_date = now
            fsrs.reps = (fsrs.reps or 0) + 1
            fsrs.updated_at = now
        next_due = now + timedelta(days=1)
    except Exception as e:
        logger.error("FSRS update failed for flashcard %s: %s", flashcard_id, e)
        next_due = now + timedelta(days=1)

    # Log review event
    db.add(FlashcardReview(
        id=str(uuid4()),
        student_id=current_user.id,
        flashcard_id=flashcard_id,
        rating=body.rating,
        time_spent_seconds=body.time_spent_seconds,
        reviewed_at=now,
    ))

    # Update global card stats
    review_count = (card.global_review_count or 0) + 1
    old_avg = card.global_avg_rating or 0.0
    new_avg = (old_avg * (review_count - 1) + body.rating) / review_count
    card.global_avg_rating = new_avg
    card.global_review_count = review_count

    # Cross-system signal: struggling flashcard → boost weak_points for MCQ system
    if body.rating in (1, 2):
        wp = db.query(WeakPoint).filter(
            WeakPoint.student_id == current_user.id,
            WeakPoint.topic == card.topic,
        ).first()
        if wp:
            wp.consecutive_failures = (wp.consecutive_failures or 0) + 1
            wp.flagged_as_weak = (
                (wp.accuracy_rate or 0.0) < 0.6 and (wp.total_attempts or 0) >= 3
            ) or wp.consecutive_failures >= 3

    db.commit()

    return ReviewResponse(
        next_due=next_due,
        interval_days=interval_days,
        state=new_state,
        new_stability=new_stability,
    )


# ── GET /document/{document_id} ───────────────────────────────────────────────

@router.get("/document/{document_id}")
def get_document_cards(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    topic: str | None = Query(None),
    card_type: str | None = Query(None),
    difficulty: str | None = Query(None),
):
    lecture = db.query(Lecture).filter(Lecture.id == document_id).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    q = db.query(Flashcard).filter(Flashcard.document_id == document_id)
    if topic:
        q = q.filter(Flashcard.topic == topic)
    if card_type:
        q = q.filter(Flashcard.card_type == card_type)
    if difficulty:
        q = q.filter(Flashcard.difficulty == difficulty)

    cards = q.order_by(Flashcard.created_at).all()

    now = datetime.now(timezone.utc)
    fsrs_map: dict[str, FlashcardFsrsCard] = {}
    card_ids = [c.id for c in cards]
    if card_ids:
        for f in db.query(FlashcardFsrsCard).filter(
            FlashcardFsrsCard.student_id == current_user.id,
            FlashcardFsrsCard.flashcard_id.in_(card_ids),
        ).all():
            fsrs_map[f.flashcard_id] = f

    return [_card_to_out(card, fsrs_map.get(card.id), now) for card in cards]


# ── GET /stats ────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=FlashcardStats)
def get_flashcard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)

    all_reviews = db.query(FlashcardReview).filter(
        FlashcardReview.student_id == current_user.id
    ).all()

    total_reviews = len(all_reviews)
    total_cards_seen = db.query(func.count(FlashcardFsrsCard.id)).filter(
        FlashcardFsrsCard.student_id == current_user.id
    ).scalar() or 0

    avg_rating: float | None = None
    if all_reviews:
        avg_rating = round(sum(r.rating for r in all_reviews) / len(all_reviews), 2)

    # Cards due today
    cards_due_today = db.query(func.count(FlashcardFsrsCard.id)).filter(
        FlashcardFsrsCard.student_id == current_user.id,
        FlashcardFsrsCard.due_date <= now,
    ).scalar() or 0

    # Mastered: state == 2 (Review) and stability >= 7
    cards_mastered = db.query(func.count(FlashcardFsrsCard.id)).filter(
        FlashcardFsrsCard.student_id == current_user.id,
        FlashcardFsrsCard.state == 2,
        FlashcardFsrsCard.stability >= 7.0,
    ).scalar() or 0

    # Streak: consecutive days with at least one review
    streak_days = _calc_streak(current_user.id, db, now)

    # Per-topic breakdown
    all_fsrs = db.query(FlashcardFsrsCard).filter(
        FlashcardFsrsCard.student_id == current_user.id
    ).all()
    if not all_fsrs:
        return FlashcardStats(
            total_cards_seen=0,
            total_reviews=total_reviews,
            cards_due_today=cards_due_today,
            cards_mastered=0,
            avg_rating=avg_rating,
            topic_breakdown=[],
            streak_days=streak_days,
        )

    fc_ids = [f.flashcard_id for f in all_fsrs]
    fc_topic_map: dict[str, str] = {}
    if fc_ids:
        for fc in db.query(Flashcard).filter(Flashcard.id.in_(fc_ids)).all():
            fc_topic_map[fc.id] = fc.topic

    topic_stats: dict[str, dict] = {}
    for f in all_fsrs:
        t = fc_topic_map.get(f.flashcard_id, "Unknown")
        if t not in topic_stats:
            topic_stats[t] = {"topic": t, "total": 0, "mastered": 0, "due": 0}
        topic_stats[t]["total"] += 1
        if f.state == 2 and (f.stability or 0) >= 7:
            topic_stats[t]["mastered"] += 1
        due = _ensure_tz(f.due_date)
        if due and due <= now:
            topic_stats[t]["due"] += 1

    return FlashcardStats(
        total_cards_seen=total_cards_seen,
        total_reviews=total_reviews,
        cards_due_today=cards_due_today,
        cards_mastered=cards_mastered,
        avg_rating=avg_rating,
        topic_breakdown=list(topic_stats.values()),
        streak_days=streak_days,
    )


def _calc_streak(student_id: str, db: Session, now: datetime) -> int:
    """Count consecutive days (ending today) where at least one review was submitted."""
    review_dates = set()
    for row in db.query(FlashcardReview.reviewed_at).filter(
        FlashcardReview.student_id == student_id
    ).all():
        dt = _ensure_tz(row[0])
        if dt:
            review_dates.add(dt.date())

    streak = 0
    day = now.date()
    while day in review_dates:
        streak += 1
        day -= timedelta(days=1)
    return streak


# ── GET /schedule ─────────────────────────────────────────────────────────────

@router.get("/schedule")
def get_flashcard_schedule(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)

    all_fsrs = db.query(FlashcardFsrsCard).filter(
        FlashcardFsrsCard.student_id == current_user.id
    ).all()
    if not all_fsrs:
        return {"topics": []}

    fc_ids = [f.flashcard_id for f in all_fsrs]
    fc_topic_map: dict[str, str] = {}
    if fc_ids:
        for fc in db.query(Flashcard).filter(Flashcard.id.in_(fc_ids)).all():
            fc_topic_map[fc.id] = fc.topic

    topic_data: dict[str, dict] = {}
    for f in all_fsrs:
        t = fc_topic_map.get(f.flashcard_id, "Unknown")
        if t not in topic_data:
            topic_data[t] = {
                "topic": t,
                "retentions": [],
                "due_count": 0,
                "next_dues": [],
                "total_cards": 0,
            }
        topic_data[t]["total_cards"] += 1

        due = _ensure_tz(f.due_date)
        if due and due <= now:
            topic_data[t]["due_count"] += 1
        if due:
            topic_data[t]["next_dues"].append(due)

        last = _ensure_tz(f.last_review_date)
        if last and (f.stability or 0) > 0:
            elapsed = (now - last).total_seconds() / 86400.0
            ret = _fsrs_retention(elapsed, f.stability)
            topic_data[t]["retentions"].append(ret)

    result = []
    for t, data in topic_data.items():
        rets = data["retentions"]
        avg_ret = (sum(rets) / len(rets) * 100) if rets else 0.0
        next_dues = sorted(data["next_dues"])
        result.append({
            "topic": t,
            "retention_pct": round(avg_ret, 1),
            "due_count": data["due_count"],
            "next_due": next_dues[0].isoformat() if next_dues else None,
            "total_cards": data["total_cards"],
        })

    # Sort worst retention first
    result.sort(key=lambda x: x["retention_pct"])
    return {"topics": result}
