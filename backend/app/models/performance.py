from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Date, Index, Text, UniqueConstraint
from sqlalchemy.types import JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from uuid import uuid4

from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


class PerformanceSession(Base):
    """
    Tracks each time a student starts a performance quiz.
    NOTE: The existing 'quiz_sessions' table stores saved quiz state (answers/retake_count)
    and is used by the existing lectures API. This table is named 'performance_sessions'
    to avoid conflict. The spec named it 'quiz_sessions' but that name is taken.
    """
    __tablename__ = "performance_sessions"

    id = Column(String(36), primary_key=True, default=_uuid)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("lectures.id"), nullable=False, index=True)
    mode = Column(String(20), nullable=False)          # 'highyield','exam','revision','quiz'
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    total_questions = Column(Integer, nullable=False)
    correct_count = Column(Integer, default=0, nullable=False)
    duration_seconds = Column(Integer, nullable=True)
    readiness_score = Column(Float, nullable=True)
    abandoned = Column(Boolean, default=False, nullable=False)
    avg_time_per_question = Column(Float, nullable=True)
    rushed_count = Column(Integer, default=0, nullable=False)  # questions answered in < 5 seconds

    # New columns
    started_from = Column(String(50), nullable=True)         # 'telegram_share'|'web_upload'|'weekly_quiz'|'direct'
    device_type = Column(String(20), nullable=True)          # 'mobile'|'desktop'|'tablet'
    interruptions = Column(Integer, nullable=True)           # times paused > 2 minutes
    longest_pause_seconds = Column(Integer, nullable=True)   # longest single pause
    questions_skipped = Column(Integer, nullable=True)       # skipped without answering
    exam_date = Column(DateTime, nullable=True)              # student's upcoming exam date

    attempts = relationship("QuestionAttempt", back_populates="session")


class McqQuestion(Base):
    """
    Persisted generated MCQ questions — reusable across sessions.
    Created before QuestionAttempt so FK references resolve in migration order.
    """
    __tablename__ = "mcq_questions"

    id = Column(String(36), primary_key=True, default=_uuid)
    document_id = Column(Integer, ForeignKey("lectures.id"), nullable=False, index=True)
    topic = Column(String(255), nullable=False, index=True)
    question_text = Column(String, nullable=False)
    option_a = Column(String, nullable=False)
    option_b = Column(String, nullable=False)
    option_c = Column(String, nullable=False)
    option_d = Column(String, nullable=False)
    correct_answer = Column(String(1), nullable=False)
    explanation = Column(String, nullable=False)
    mode = Column(String(20), nullable=False)           # 'highyield','exam','revision'
    difficulty_type = Column(String(20), nullable=False)  # 'recall','application','analysis'
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # New columns — global stats updated on every answer
    global_accuracy_rate = Column(Float, nullable=True)   # accuracy across ALL students
    global_avg_time = Column(Float, nullable=True)        # avg time_spent_seconds across all students
    discrimination_index = Column(Float, nullable=True)   # top27% accuracy - bottom27% accuracy


class QuestionAttempt(Base):
    """Tracks every answer a student gives in a performance session."""
    __tablename__ = "question_attempts"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("performance_sessions.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    question_id = Column(String(36), ForeignKey("mcq_questions.id"), nullable=False)
    selected_answer = Column(String(1), nullable=False)
    correct_answer = Column(String(1), nullable=False)
    is_correct = Column(Boolean, nullable=False)
    time_spent_seconds = Column(Integer, nullable=False)
    attempt_number = Column(Integer, nullable=False, default=1)
    confidence_proxy = Column(Float, nullable=True)   # 1/time_spent when correct, 0 when wrong
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # New columns — time intelligence
    time_of_day = Column(Integer, nullable=True)          # hour 0-23 when attempt was made
    day_of_week = Column(Integer, nullable=True)          # 0=Monday, 6=Sunday
    answer_changed = Column(Boolean, nullable=True)       # did they change their answer
    original_answer = Column(String(1), nullable=True)    # what they picked before changing
    time_to_first_change = Column(Integer, nullable=True) # seconds before they changed

    # New columns — pre-reveal confidence (collected BEFORE answer is revealed)
    pre_answer_confidence = Column(Integer, nullable=True)  # 1=guessing, 2=pretty sure, 3=certain
    time_to_confidence = Column(Integer, nullable=True)     # seconds from answer selection to confidence tap
    calibration_gap = Column(Integer, nullable=True)
    # (confidence - 1) * (1 if correct else -1)
    # +2 = certain+right = mastery | -2 = certain+wrong = dangerous misconception

    session = relationship("PerformanceSession", back_populates="attempts")
    question = relationship("McqQuestion")


class WeakPoint(Base):
    """Aggregated per-student per-topic weakness tracking."""
    __tablename__ = "weak_points"

    id = Column(String(36), primary_key=True, default=_uuid)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    topic = Column(String(255), nullable=False, index=True)
    total_attempts = Column(Integer, default=0, nullable=False)
    correct_attempts = Column(Integer, default=0, nullable=False)
    accuracy_rate = Column(Float, default=0.0, nullable=False)
    consecutive_failures = Column(Integer, default=0, nullable=False)
    last_attempted_at = Column(DateTime, nullable=True)
    last_correct_at = Column(DateTime, nullable=True)
    last_wrong_at = Column(DateTime, nullable=True)
    most_common_wrong_answer = Column(String(1), nullable=True)
    accuracy_7d_ago = Column(Float, nullable=True)    # snapshot updated weekly
    accuracy_trend = Column(Float, nullable=True)     # current - 7d_ago (positive = improving)
    flagged_as_weak = Column(Boolean, default=False, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # New columns — knowledge decay tracking
    first_mastered_at = Column(DateTime, nullable=True)  # first time accuracy crossed 0.8
    times_mastered = Column(Integer, nullable=True)      # times accuracy reached >= 0.8
    times_relapsed = Column(Integer, nullable=True)      # times accuracy dropped below 0.6 after mastery
    decay_rate = Column(Float, nullable=True)            # days between first mastery and first relapse

    # New columns — misconception tracking
    dangerous_misconception = Column(Boolean, nullable=True)
    # True when calibration_gap == -2 on this topic (certain + wrong)


class WeeklyQuizAssignment(Base):
    """Tracks weak-point quiz assignments given to students each week."""
    __tablename__ = "weekly_quiz_assignments"

    id = Column(String(36), primary_key=True, default=_uuid)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    assigned_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    week_start = Column(Date, nullable=False, index=True)
    question_ids = Column(JSON, nullable=False)         # list of mcq_question UUIDs
    status = Column(String(20), nullable=False, default="pending")  # pending/completed/dismissed
    completed_at = Column(DateTime, nullable=True)


class TopicCoFailure(Base):
    """
    Tracks which topics fail together for a student.
    Incremented whenever two topics are simultaneously flagged as weak.
    High co_failure_count means one topic likely prerequisite of the other.
    """
    __tablename__ = "topic_co_failures"

    id = Column(String(36), primary_key=True, default=_uuid)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    topic_a = Column(String(255), nullable=False)       # always alphabetically <= topic_b
    topic_b = Column(String(255), nullable=False)
    co_failure_count = Column(Integer, default=0, nullable=False)

    __table_args__ = (
        Index("ix_co_failure_student_topics", "student_id", "topic_a", "topic_b"),
    )


class TopicSnapshot(Base):
    """
    Per-session accuracy snapshot per student per topic.
    Taken on session complete for every topic touched.
    Used to compute accuracy_trend in WeakPoint.
    """
    __tablename__ = "topic_snapshots"

    id = Column(String(36), primary_key=True, default=_uuid)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    topic = Column(String(255), nullable=False)
    accuracy_rate = Column(Float, nullable=False)
    snapshot_date = Column(Date, nullable=False)
    days_since_last_review = Column(Integer, nullable=True)
    # calculated: (snapshot_date - last_attempted_at).days from weak_points

    __table_args__ = (
        UniqueConstraint("student_id", "topic", "snapshot_date",
                         name="uq_topic_snapshot_student_topic_date"),
        Index("ix_topic_snapshots_student_id", "student_id"),
    )


class AnswerTimeline(Base):
    """
    Per-attempt hover/reading behavior from the frontend.
    Captures which options the student spent time on before answering.
    Optional — only stored when frontend sends this data.
    """
    __tablename__ = "answer_timelines"

    id = Column(String(36), primary_key=True, default=_uuid)
    attempt_id = Column(String(36), ForeignKey("question_attempts.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Time spent hovering each option (seconds, from frontend tracking)
    time_on_option_a = Column(Float, nullable=True)
    time_on_option_b = Column(Float, nullable=True)
    time_on_option_c = Column(Float, nullable=True)
    time_on_option_d = Column(Float, nullable=True)

    # What they almost picked (option with second-highest hover time)
    second_choice = Column(String(1), nullable=True)

    # Reading behavior
    re_read_question = Column(Boolean, nullable=True)  # scrolled back up to re-read stem
    re_read_count = Column(Integer, nullable=True)     # how many times they re-read it

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_answer_timelines_student_id", "student_id"),
        Index("ix_answer_timelines_attempt_id", "attempt_id"),
    )


class LearningPattern(Base):
    """
    Aggregated cognitive + behavioral profile per student.
    One row per student, updated by background job weekly.
    """
    __tablename__ = "learning_patterns"

    id = Column(String(36), primary_key=True, default=_uuid)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    computed_at = Column(DateTime, nullable=False)

    # Study behavior
    avg_sessions_per_week = Column(Float, nullable=True)
    preferred_session_length_minutes = Column(Float, nullable=True)
    preferred_time_of_day = Column(Integer, nullable=True)  # 0-23 hour of best performance
    consistency_score = Column(Float, nullable=True)        # 0.0-1.0: regularity of study

    # Cognitive patterns
    best_question_type = Column(String(20), nullable=True)   # 'recall'|'application'|'analysis'
    worst_question_type = Column(String(20), nullable=True)
    overconfidence_rate = Column(Float, nullable=True)       # proportion confident(3) but wrong
    underconfidence_rate = Column(Float, nullable=True)      # proportion guessing(1) but right
    answer_change_accuracy = Column(Float, nullable=True)    # accuracy on changed-answer questions

    # Forgetting patterns
    avg_decay_days = Column(Float, nullable=True)            # avg days before mastered topics relapse
    fastest_forgetting_topic = Column(String(255), nullable=True)
    most_stable_topic = Column(String(255), nullable=True)

    # Performance by context
    mobile_accuracy = Column(Float, nullable=True)
    desktop_accuracy = Column(Float, nullable=True)
    morning_accuracy = Column(Float, nullable=True)    # 6am-12pm
    afternoon_accuracy = Column(Float, nullable=True)  # 12pm-6pm
    evening_accuracy = Column(Float, nullable=True)    # 6pm-12am

    # Exam readiness projections (calculated by AI)
    projected_readiness_7d = Column(Float, nullable=True)
    projected_readiness_14d = Column(Float, nullable=True)
    projected_readiness_30d = Column(Float, nullable=True)

    # Behavioral flags (comma-separated for AI context)
    behavioral_flags = Column(Text, nullable=True)
    # e.g. "changes_answers_loses_accuracy,performs_worse_mobile,overconfident_thalassemia"

    __table_args__ = (
        Index("ix_learning_patterns_student_id", "student_id"),
    )


class StudentAiInsight(Base):
    """
    Cached AI-generated insight for a student.
    Regenerated when stale (10+ new answers since last generation).
    """
    __tablename__ = "student_ai_insights"

    id = Column(String(36), primary_key=True, default=_uuid)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    insight_json = Column(JSON, nullable=False)
    # Full AI response: next_topic, intervention_type, personalized_message,
    # predicted_readiness_7d, critical_insight, daily_plan

    generated_at = Column(DateTime, nullable=False)
    trigger = Column(String(50), nullable=False)
    # 'session_complete'|'new_weak_point'|'weekly'|'exam_date_set'|'on_demand'

    questions_answered_at_generation = Column(Integer, nullable=False)
    # total question count when generated — used to detect staleness

    is_current = Column(Boolean, default=True, nullable=False)
    # False when a newer insight has been generated

    __table_args__ = (
        Index("ix_student_ai_insights_student_id", "student_id"),
    )
