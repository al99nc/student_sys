"""
Performance tracking SQLAlchemy models.

These models back the /api/v1/performance/* endpoints and the AI coaching
pipeline. The schema matches the Alembic migrations in alembic/versions/.
"""
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Float, ForeignKey,
    Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.types import JSON

from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PerformanceSession(Base):
    """One quiz attempt by a student on a specific document."""
    __tablename__ = "performance_sessions"

    id                     = Column(String(36), primary_key=True, default=_uuid)
    student_id             = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    document_id            = Column(Integer, ForeignKey("lectures.id"), nullable=False, index=True)
    mode                   = Column(String(20), nullable=False)          # highyield|exam|revision|quiz
    started_at             = Column(DateTime, default=_utcnow, nullable=False, index=True)
    completed_at           = Column(DateTime, nullable=True, index=True)
    total_questions        = Column(Integer, nullable=False)
    correct_count          = Column(Integer, default=0, server_default="0", nullable=False)
    duration_seconds       = Column(Integer, nullable=True)
    readiness_score        = Column(Float, nullable=True)
    avg_time_per_question  = Column(Float, nullable=True)
    abandoned              = Column(Boolean, default=False, server_default="0", nullable=False)
    rushed_count           = Column(Integer, default=0, server_default="0", nullable=False)
    started_from           = Column(String(50), nullable=True)           # "performance"|"quiz_page"|"weekly_quiz"
    device_type            = Column(String(20), nullable=True)           # "mobile"|"desktop"
    interruptions          = Column(Integer, nullable=True)
    longest_pause_seconds  = Column(Integer, nullable=True)
    questions_skipped      = Column(Integer, nullable=True)


class McqQuestion(Base):
    """A single MCQ stored after AI generation, referenced by performance tracking."""
    __tablename__ = "mcq_questions"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    document_id         = Column(Integer, ForeignKey("lectures.id"), nullable=False, index=True)
    topic               = Column(String(255), nullable=False, index=True)
    question_text       = Column(Text, nullable=False)
    option_a            = Column(Text, nullable=False)
    option_b            = Column(Text, nullable=False)
    option_c            = Column(Text, nullable=False)
    option_d            = Column(Text, nullable=False)
    correct_answer      = Column(String(1), nullable=False)
    explanation         = Column(Text, nullable=False)
    mode                = Column(String(20), nullable=False)              # highyield|exam|revision
    difficulty_type     = Column(String(20), nullable=False)              # recall|application|analysis
    created_at          = Column(DateTime, default=_utcnow, nullable=False)
    global_accuracy_rate = Column(Float, nullable=True)
    global_avg_time     = Column(Float, nullable=True)
    discrimination_index = Column(Float, nullable=True)


class QuestionAttempt(Base):
    """One student answer to one MCQ within a session."""
    __tablename__ = "question_attempts"

    id                    = Column(String(36), primary_key=True, default=_uuid)
    session_id            = Column(String(36), ForeignKey("performance_sessions.id"), nullable=False, index=True)
    student_id            = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    question_id           = Column(String(36), ForeignKey("mcq_questions.id"), nullable=False, index=True)
    selected_answer       = Column(String(1), nullable=False)
    correct_answer        = Column(String(1), nullable=False)
    is_correct            = Column(Boolean, nullable=False)
    time_spent_seconds    = Column(Integer, nullable=False)
    attempt_number        = Column(Integer, nullable=False, default=1)
    confidence_proxy      = Column(Float, nullable=True)
    time_of_day           = Column(Integer, nullable=True)   # hour 0–23
    day_of_week           = Column(Integer, nullable=True)   # 0=Mon
    answer_changed        = Column(Boolean, nullable=True)
    original_answer       = Column(String(1), nullable=True)
    time_to_first_change  = Column(Integer, nullable=True)
    pre_answer_confidence = Column(Integer, nullable=True)   # 1=guessing|2=pretty sure|3=certain
    time_to_confidence    = Column(Integer, nullable=True)
    calibration_gap       = Column(Integer, nullable=True)   # +1=under, -1=over, -2=dangerous over
    created_at            = Column(DateTime, default=_utcnow, nullable=False, index=True)


class WeakPoint(Base):
    """
    Per-student, per-topic accuracy tracker. Updated incrementally on every
    answer submission — the source-of-truth for coaching decisions.
    """
    __tablename__ = "weak_points"

    id                      = Column(String(36), primary_key=True, default=_uuid)
    student_id              = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    topic                   = Column(String(255), nullable=False, index=True)
    total_attempts          = Column(Integer, default=0, server_default="0", nullable=False)
    correct_attempts        = Column(Integer, default=0, server_default="0", nullable=False)
    accuracy_rate           = Column(Float, default=0.0, server_default="0", nullable=False)
    consecutive_failures    = Column(Integer, default=0, server_default="0", nullable=False)
    last_attempted_at       = Column(DateTime, nullable=True)
    last_correct_at         = Column(DateTime, nullable=True)
    last_wrong_at           = Column(DateTime, nullable=True)
    flagged_as_weak         = Column(Boolean, default=False, server_default="0", nullable=False, index=True)
    updated_at              = Column(DateTime, default=_utcnow, nullable=False)
    dangerous_misconception = Column(Boolean, default=False, nullable=True)
    most_common_wrong_answer = Column(String(1), nullable=True)
    first_mastered_at       = Column(DateTime, nullable=True)
    times_mastered          = Column(Integer, default=0, nullable=True)
    times_relapsed          = Column(Integer, default=0, nullable=True)
    decay_rate              = Column(Integer, nullable=True)   # days until review needed
    accuracy_7d_ago         = Column(Float, nullable=True)
    accuracy_trend          = Column(Float, nullable=True)     # accuracy_now − accuracy_7d_ago

    __table_args__ = (
        UniqueConstraint("student_id", "topic", name="uq_weak_point_student_topic"),
    )


class WeeklyQuizAssignment(Base):
    """A set of weak-topic questions assigned for the student's current week."""
    __tablename__ = "weekly_quiz_assignments"

    id           = Column(String(36), primary_key=True, default=_uuid)
    student_id   = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    assigned_at  = Column(DateTime, default=_utcnow, nullable=False)
    week_start   = Column(Date, nullable=False)
    question_ids = Column(JSON, nullable=False)                          # list[str] UUIDs
    status       = Column(String(20), default="pending", server_default="pending", nullable=False)
    completed_at = Column(DateTime, nullable=True)


class TopicCoFailure(Base):
    """Tracks topic pairs that a student tends to fail together."""
    __tablename__ = "topic_co_failures"

    id              = Column(String(36), primary_key=True, default=_uuid)
    student_id      = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    topic_a         = Column(String(255), nullable=False)
    topic_b         = Column(String(255), nullable=False)
    co_failure_count = Column(Integer, default=1, nullable=False)

    __table_args__ = (
        UniqueConstraint("student_id", "topic_a", "topic_b", name="uq_co_failure_student_pair"),
    )


class TopicSnapshot(Base):
    """Daily accuracy snapshot per topic — used for trend analysis and decay detection."""
    __tablename__ = "topic_snapshots"

    id                   = Column(String(36), primary_key=True, default=_uuid)
    student_id           = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    topic                = Column(String(255), nullable=False)
    accuracy_rate        = Column(Float, nullable=False)
    snapshot_date        = Column(Date, nullable=False)
    days_since_last_review = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "student_id", "topic", "snapshot_date",
            name="uq_topic_snapshot_student_topic_date",
        ),
    )


class AnswerTimeline(Base):
    """Per-option hover/dwell time for a single question attempt."""
    __tablename__ = "answer_timelines"

    id               = Column(String(36), primary_key=True, default=_uuid)
    attempt_id       = Column(String(36), ForeignKey("question_attempts.id"), nullable=False, unique=True)
    student_id       = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    time_on_option_a = Column(Float, nullable=True)
    time_on_option_b = Column(Float, nullable=True)
    time_on_option_c = Column(Float, nullable=True)
    time_on_option_d = Column(Float, nullable=True)
    second_choice    = Column(String(1), nullable=True)
    re_read_question = Column(Boolean, nullable=True)
    re_read_count    = Column(Integer, nullable=True)
    created_at       = Column(DateTime, default=_utcnow, nullable=True)


class LearningPattern(Base):
    """
    Computed cognitive profile for a student (one row per student).
    Updated in the background after sessions complete.
    """
    __tablename__ = "learning_patterns"

    id                              = Column(String(36), primary_key=True, default=_uuid)
    student_id                      = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    computed_at                     = Column(DateTime, default=_utcnow, nullable=False)
    exam_date                       = Column(DateTime, nullable=True)
    avg_sessions_per_week           = Column(Float, nullable=True)
    preferred_session_length_minutes = Column(Float, nullable=True)
    preferred_time_of_day           = Column(Integer, nullable=True)   # hour 0–23
    consistency_score               = Column(Float, nullable=True)
    best_question_type              = Column(String(20), nullable=True)
    worst_question_type             = Column(String(20), nullable=True)
    overconfidence_rate             = Column(Float, nullable=True)
    underconfidence_rate            = Column(Float, nullable=True)
    answer_change_accuracy          = Column(Float, nullable=True)
    avg_decay_days                  = Column(Float, nullable=True)
    fastest_forgetting_topic        = Column(String(255), nullable=True)
    most_stable_topic               = Column(String(255), nullable=True)
    mobile_accuracy                 = Column(Float, nullable=True)
    desktop_accuracy                = Column(Float, nullable=True)
    morning_accuracy                = Column(Float, nullable=True)
    afternoon_accuracy              = Column(Float, nullable=True)
    evening_accuracy                = Column(Float, nullable=True)
    projected_readiness_7d          = Column(Float, nullable=True)
    projected_readiness_14d         = Column(Float, nullable=True)
    projected_readiness_30d         = Column(Float, nullable=True)
    behavioral_flags                = Column(Text, nullable=True)       # comma-separated flag strings

    __table_args__ = (
        UniqueConstraint("student_id", name="uq_learning_patterns_student_id"),
    )


class StudentAiInsight(Base):
    """
    Persisted AI insight for a student. Only one row is 'current' at a time
    (is_current=True). Stale insights are kept for audit/history.
    """
    __tablename__ = "student_ai_insights"

    id                              = Column(String(36), primary_key=True, default=_uuid)
    student_id                      = Column(String(36), ForeignKey("users.id"), nullable=False)
    insight_json                    = Column(JSON, nullable=False)
    generated_at                    = Column(DateTime, nullable=False)
    trigger                         = Column(String(50), nullable=False)   # first_time|background_stale|forced
    questions_answered_at_generation = Column(Integer, nullable=False)
    is_current                      = Column(Boolean, default=True, server_default="1", nullable=False)
