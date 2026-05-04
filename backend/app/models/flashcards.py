"""
Flashcard system SQLAlchemy models.

Parallel to the MCQ performance system but fully independent — uses its own
FlashcardFsrsCard table so the two FSRS engines never interfere.
"""
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Column, DateTime, Float, ForeignKey,
    Integer, String, Text, UniqueConstraint,
)

from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Flashcard(Base):
    """One AI-generated flashcard derived from a lecture PDF."""
    __tablename__ = "flashcards"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    document_id         = Column(Integer, ForeignKey("lectures.id"), nullable=False, index=True)
    topic               = Column(String(255), nullable=False, index=True)
    front               = Column(Text, nullable=False)
    back                = Column(Text, nullable=False)
    memory_tip          = Column(Text, nullable=True)
    card_type           = Column(String(20), nullable=False, default="concept")   # concept|definition|mechanism|comparison|clinical
    difficulty          = Column(String(10), nullable=False, default="medium")    # easy|medium|hard
    source_text         = Column(Text, nullable=True)
    created_at          = Column(DateTime, default=_utcnow)
    global_avg_rating   = Column(Float, nullable=True)
    global_review_count = Column(Integer, default=0, server_default="0")


class FlashcardFsrsCard(Base):
    """
    FSRS spaced-repetition state for one student × one flashcard.
    Mirrors FsrsCard in performance.py but references flashcards.id.
    State values: 0=New, 1=Learning, 2=Review, 3=Relearning.
    """
    __tablename__ = "flashcard_fsrs_cards"

    id               = Column(String(36), primary_key=True, default=_uuid)
    student_id       = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    flashcard_id     = Column(String(36), ForeignKey("flashcards.id"), nullable=False, index=True)
    stability        = Column(Float, nullable=True)
    difficulty       = Column(Float, nullable=True)
    due_date         = Column(DateTime, nullable=False)
    last_review_date = Column(DateTime, nullable=True)
    state            = Column(Integer, default=0, server_default="0", nullable=False)
    reps             = Column(Integer, default=0, server_default="0", nullable=False)
    lapses           = Column(Integer, default=0, server_default="0", nullable=False)
    elapsed_days     = Column(Integer, default=0, server_default="0", nullable=False)
    scheduled_days   = Column(Integer, default=0, server_default="0", nullable=False)
    created_at       = Column(DateTime, default=_utcnow)
    updated_at       = Column(DateTime, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("student_id", "flashcard_id", name="uq_flashcard_fsrs_student_card"),
    )


class FlashcardReview(Base):
    """Every individual flashcard review event — used for analytics and streak calculation."""
    __tablename__ = "flashcard_reviews"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    student_id          = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    flashcard_id        = Column(String(36), ForeignKey("flashcards.id"), nullable=False, index=True)
    rating              = Column(Integer, nullable=False)   # 1=Again, 2=Hard, 3=Good, 4=Easy
    time_spent_seconds  = Column(Integer, nullable=True)
    reviewed_at         = Column(DateTime, default=_utcnow, nullable=False, index=True)
