from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime,
    ForeignKey, Date, Index, Text, UniqueConstraint,
)
from sqlalchemy.types import JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from uuid import uuid4

from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PerformanceSession(Base):
    __tablename__ = "performance_sessions"

    id                      = Column(String(36), primary_key=True, default=_uuid)
    student_id              = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    document_id             = Column(Integer, ForeignKey("lectures.id"), nullable=False, index=True)
    mode                    = Column(String(20), nullable=False)
    started_at              = Column(DateTime, default=_utcnow, nullable=False, index=True)
    completed_at            = Column(DateTime, nullable=True, index=True)
    total_questions         = Column(Integer, nullable=False)
    correct_count           = Column(Integer, default=0, nullable=False)
    duration_seconds        = Column(Integer, nullable=True)
    readiness_score         = Column(Float, nullable=True)
    abandoned               = Column(Boolean, default=False, nullable=False)
    avg_time_per_question   = Column(Float, nullable=True)
    rushed_count            = Column(Integer, default=0, nullable=False)
    started_from            = Column(String(50), nullable=True)
    device_type             = Column(String(20), nullable=True)
    interruptions           = Column(Integer, nullable=True)
    longest_pause_seconds   = Column(Integer, nullable=True)
    questions_skipped       = Column(Integer, nullable=True)
    # exam_date removed — belongs on LearningPattern

    attempts = relationship("QuestionAttempt", back_populates="session")


class McqQuestion(Base):
    __tablename__ = "mcq_questions"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    document_id         = Column(Integer, ForeignKey("lectures.id"), nullable=False, index=True)
    topic               = Column(String(255), nullable=False, index=True)
    question_text       = Column(String, nullable=False)
    option_a            = Column(String, nullable=False)
    option_b            = Column(String, nullable=False)
    option_c            = Column(String, nullable=False)
    option_d            = Column(String, nullable=False)
    correct_answer      = Column(String(1), nullable=False)
    explanation         = Column(String, nullable=False)
    mode                = Column(String(20), nullable=False)
    difficulty_type     = Column(String(20), nullable=False)
    created_at          = Column(DateTime, default=_utcnow, nullable=False)
    global_accuracy_rate    = Column(Float, nullable=True)
    global_avg_time         = Column(Float, nullable=True)
    discrimination_index    = Column(Float, nullable=True)


class QuestionAttempt(Base):
    __tablename__ = "question_attempts"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    session_id          = Column(String(36), ForeignKey("performance_sessions.id"), nullable=False, index=True)
    student_id          = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    question_id         = Column(String(36), ForeignKey("mcq_questions.id"), nullable=False, index=True)  # ← fixed
    selected_answer     = Column(String(1), nullable=False)
    correct_answer      = Column(String(1), nullable=False)
    is_correct          = Column(Boolean, nullable=False)
    time_spent_seconds  = Column(Integer, nullable=False)
    attempt_number      = Column(Integer, nullable=False, default=1)
    confidence_proxy    = Column(Float, nullable=True)
    created_at          = Column(DateTime, default=_utcnow, nullable=False, index=True)  # ← fixed
    time_of_day         = Column(Integer, nullable=True)
    day_of_week         = Column(Integer, nullable=True)
    answer_changed      = Column(Boolean, nullable=True)
    original_answer     = Column(String(1), nullable=True)
    time_to_first_change        = Column(Integer, nullable=True)
    pre_answer_confidence       = Column(Integer, nullable=True)
    time_to_confidence          = Column(Integer, nullable=True)
    calibration_gap             = Column(Integer, nullable=True)

    session  = relationship("PerformanceSession", back_populates="attempts")
    question = relationship("McqQuestion")


class WeakPoint(Base):
    __tablename__ = "weak_points"

    id                      = Column(String(36), primary_key=True, default=_uuid)
    student_id              = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    topic                   = Column(String(255), nullable=False, index=True)
    total_attempts          = Column(Integer, default=0, nullable=False)
    correct_attempts        = Column(Integer, default=0, nullable=False)
    accuracy_rate           = Column(Float, default=0.0, nullable=False)
    consecutive_failures    = Column(Integer, default=0, nullable=False)
    last_attempted_at       = Column(DateTime, nullable=True)
    last_correct_at         = Column(DateTime, nullable=True)
    last_wrong_at           = Column(DateTime, nullable=True)
    most_common_wrong_answer = Column(String(1), nullable=True)
    accuracy_7d_ago         = Column(Float, nullable=True)
    accuracy_trend          = Column(Float, nullable=True)
    flagged_as_weak         = Column(Boolean, default=False, nullable=False, index=True)
    updated_at              = Column(DateTime, default=_utcnow, nullable=False)
    first_mastered_at       = Column(DateTime, nullable=True)
    times_mastered          = Column(Integer, nullable=True)
    times_relapsed          = Column(Integer, nullable=True)
    decay_rate              = Column(Integer, nullable=True)  # ← Integer, not Float
    dangerous_misconception = Column(Boolean, nullable=True)

    __table_args__ = (
        UniqueConstraint("student_id", "topic", name="uq_weak_point_student_topic"),  # ← critical
    )


class WeeklyQuizAssignment(Base):
    __tablename__ = "weekly_quiz_assignments"

    id           = Column(String(36), primary_key=True, default=_uuid)
    student_id   = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    assigned_at  = Column(DateTime, default=_utcnow, nullable=False)
    week_start   = Column(Date, nullable=False)
    question_ids = Column(JSON, nullable=False)
    status       = Column(String(20), nullable=False, default="pending")
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_weekly_quiz_student_week_status", "student_id", "week_start", "status"),  # ← added
    )


class TopicCoFailure(Base):
    __tablename__ = "topic_co_failures"

    id               = Column(String(36), primary_key=True, default=_uuid)
    student_id       = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    topic_a          = Column(String(255), nullable=False)
    topic_b          = Column(String(255), nullable=False)
    co_failure_count = Column(Integer, default=0, nullable=False)

    __table_args__ = (
        UniqueConstraint("student_id", "topic_a", "topic_b", name="uq_co_failure_student_pair"),  # ← critical
        Index("ix_co_failure_student_topics", "student_id", "topic_a", "topic_b"),
    )


class TopicSnapshot(Base):
    __tablename__ = "topic_snapshots"

    id                    = Column(String(36), primary_key=True, default=_uuid)
    student_id            = Column(String(36), ForeignKey("users.id"), nullable=False)
    topic                 = Column(String(255), nullable=False)
    accuracy_rate         = Column(Float, nullable=False)
    snapshot_date         = Column(Date, nullable=False)
    days_since_last_review = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("student_id", "topic", "snapshot_date",
                         name="uq_topic_snapshot_student_topic_date"),
        Index("ix_topic_snapshots_student_id", "student_id"),
    )


class AnswerTimeline(Base):
    __tablename__ = "answer_timelines"

    id              = Column(String(36), primary_key=True, default=_uuid)
    attempt_id      = Column(String(36), ForeignKey("question_attempts.id"),
                             nullable=False, unique=True)  # ← unique: one per attempt
    student_id      = Column(String(36), ForeignKey("users.id"), nullable=False)
    time_on_option_a = Column(Float, nullable=True)
    time_on_option_b = Column(Float, nullable=True)
    time_on_option_c = Column(Float, nullable=True)
    time_on_option_d = Column(Float, nullable=True)
    second_choice   = Column(String(1), nullable=True)
    re_read_question = Column(Boolean, nullable=True)
    re_read_count   = Column(Integer, nullable=True)
    created_at      = Column(DateTime, default=_utcnow)

    __table_args__ = (
        Index("ix_answer_timelines_student_id", "student_id"),
    )


class LearningPattern(Base):
    __tablename__ = "learning_patterns"

    id              = Column(String(36), primary_key=True, default=_uuid)
    student_id      = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)
    computed_at     = Column(DateTime, nullable=False)
    exam_date       = Column(DateTime, nullable=True)  # ← moved here from PerformanceSession

    avg_sessions_per_week               = Column(Float, nullable=True)
    preferred_session_length_minutes    = Column(Float, nullable=True)
    preferred_time_of_day               = Column(Integer, nullable=True)
    consistency_score                   = Column(Float, nullable=True)
    best_question_type                  = Column(String(20), nullable=True)
    worst_question_type                 = Column(String(20), nullable=True)
    overconfidence_rate                 = Column(Float, nullable=True)
    underconfidence_rate                = Column(Float, nullable=True)
    answer_change_accuracy              = Column(Float, nullable=True)
    avg_decay_days                      = Column(Float, nullable=True)
    fastest_forgetting_topic            = Column(String(255), nullable=True)
    most_stable_topic                   = Column(String(255), nullable=True)
    mobile_accuracy                     = Column(Float, nullable=True)
    desktop_accuracy                    = Column(Float, nullable=True)
    morning_accuracy                    = Column(Float, nullable=True)
    afternoon_accuracy                  = Column(Float, nullable=True)
    evening_accuracy                    = Column(Float, nullable=True)
    projected_readiness_7d              = Column(Float, nullable=True)
    projected_readiness_14d             = Column(Float, nullable=True)
    projected_readiness_30d             = Column(Float, nullable=True)
    behavioral_flags                    = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_learning_patterns_student_id", "student_id"),
    )


class StudentAiInsight(Base):
    __tablename__ = "student_ai_insights"

    id                              = Column(String(36), primary_key=True, default=_uuid)
    student_id                      = Column(String(36), ForeignKey("users.id"), nullable=False)
    insight_json                    = Column(JSON, nullable=False)
    generated_at                    = Column(DateTime, nullable=False)
    trigger                         = Column(String(50), nullable=False)
    questions_answered_at_generation = Column(Integer, nullable=False)
    is_current                      = Column(Boolean, default=True, nullable=False)

    __table_args__ = (
        Index("ix_ai_insights_student_current", "student_id", "is_current"),  # ← composite
    )