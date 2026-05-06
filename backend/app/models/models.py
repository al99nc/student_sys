from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from uuid import uuid4
from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, index=True, nullable=False, default=_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String(120), nullable=True)
    university = Column(String(255), nullable=True)
    college = Column(String(120), nullable=True)
    year_of_study = Column(Integer, nullable=True)
    subject = Column(String(255), nullable=True)
    topic_area = Column(String(255), nullable=True)
    level = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    # Pay-as-you-go credits (purchased via Checkout; see billing webhook)
    credit_balance = Column(Integer, default=0, server_default="0")
    # Subscription plan: "free" | "pro" | "enterprise"
    plan = Column(String(20), default="free", server_default="free", nullable=False)
    # Stripe customer ID — set on first subscription checkout, reused for future payments
    stripe_customer_id = Column(String(255), nullable=True)
    # Allow spending credits to keep using AI features when limits are hit
    extra_usage_enabled = Column(Integer, default=1, server_default="1", nullable=False)
    # Monthly credit spend cap (NULL = unlimited). Auto-disables toggle when reached.
    monthly_credit_limit = Column(Integer, nullable=True)
    # Credits spent this calendar month (resets lazily on first spend of a new month)
    monthly_credits_used = Column(Integer, default=0, server_default="0", nullable=False)
    # "YYYY-MM" of the last monthly reset — used to detect a new month
    monthly_reset_month = Column(String(7), nullable=True)
    # Admin flag — only set via direct DB update, never via API
    is_admin = Column(Integer, default=0, server_default="0", nullable=False)
    # IP address at signup — used to prevent trial abuse
    signup_ip = Column(String(45), nullable=True, index=True)

    lectures = relationship("Lecture", back_populates="owner")


class CoachPerformanceUsage(Base):
    """One row per POST /api/v1/performance/students/me/chat (legacy coach widget)."""

    __tablename__ = "coach_performance_usage"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), nullable=False, index=True)
    created_at = Column(DateTime, default=_utcnow)


class CheckoutPayment(Base):
    """Idempotency record: one Stripe Checkout Session credits the user at most once."""

    __tablename__ = "checkout_payments"

    stripe_checkout_session_id = Column(String(255), primary_key=True)
    # No FK: legacy DBs may use integer user ids while the app model uses string UUIDs.
    user_id = Column(String(36), nullable=False, index=True)
    credits = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class WaylPayment(Base):
    """Idempotency record: one Wayl payment link credits the user at most once."""

    __tablename__ = "wayl_payments"

    wayl_reference_id = Column(String(255), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    credits = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class Lecture(Base):
    __tablename__ = "lectures"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    university = Column(String(255), nullable=True)
    college = Column(String(120), nullable=True)
    year_of_study = Column(Integer, nullable=True)
    subject = Column(String(255), nullable=True)
    topic_area = Column(String(255), nullable=True)
    level = Column(String(50), nullable=True)

    owner = relationship("User", back_populates="lectures")
    result = relationship("Result", back_populates="lecture", uselist=False)


class Result(Base):
    __tablename__ = "results"

    id = Column(Integer, primary_key=True, index=True)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    summary = Column(Text, nullable=True)
    key_concepts = Column(Text, nullable=True)
    mcqs = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    share_token = Column(String, unique=True, index=True, nullable=True)
    view_count = Column(Integer, default=0, server_default="0")
    custom_context = Column(Text, nullable=True)
    essays = Column(Text, nullable=True)

    lecture = relationship("Lecture", back_populates="result")


class QuizSession(Base):
    """
    Legacy quiz session — stores raw answer JSON from the quiz page.
    Performance-tracked sessions use PerformanceSession in models/performance.py.
    """
    __tablename__ = "quiz_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    answers = Column(Text, nullable=True)
    retake_count = Column(Integer, default=0, server_default="0")
    updated_at = Column(DateTime, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "lecture_id", name="uq_user_lecture_session"),
    )


class ProcessingJob(Base):
    """Background MCQ/essay generation job — one row per generation request."""

    __tablename__ = "processing_jobs"

    id               = Column(String(16), primary_key=True)
    user_id          = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    lecture_id       = Column(Integer, ForeignKey("lectures.id"), nullable=False, index=True)
    mode             = Column(String(20), nullable=False)
    # status: pending | processing | done | failed
    status           = Column(String(20), nullable=False, default="pending")

    progress_pct     = Column(Integer, default=0)
    progress_label   = Column(String(100), nullable=True)
    estimated_seconds_remaining = Column(Integer, nullable=True)

    created_at       = Column(DateTime, default=_utcnow, nullable=False, index=True)
    started_at       = Column(DateTime, nullable=True)
    completed_at     = Column(DateTime, nullable=True)

    error_message    = Column(Text, nullable=True)
    custom_context   = Column(Text, nullable=True)

    total_chunks     = Column(Integer, nullable=True)
    completed_chunks = Column(Integer, default=0)
