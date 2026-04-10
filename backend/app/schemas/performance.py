from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Any
from datetime import datetime


# ── Session ──────────────────────────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    document_id: int
    mode: str           # 'highyield' | 'exam' | 'revision' | 'quiz'
    total_questions: int

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        allowed = {"highyield", "exam", "revision", "quiz"}
        if v not in allowed:
            raise ValueError(f"mode must be one of {allowed}")
        return v


class StartSessionResponse(BaseModel):
    session_id: str


# ── Answer ────────────────────────────────────────────────────────────────────

class AnswerRequest(BaseModel):
    question_id: str
    selected_answer: str    # 'A' | 'B' | 'C' | 'D'
    correct_answer: str     # kept for client compat; server validates against DB
    time_spent_seconds: int = Field(..., ge=1)

    # Pre-reveal confidence — collected BEFORE answer is shown
    # Optional for backward compatibility: old clients that don't send it still work
    pre_answer_confidence: Optional[int] = None
    # 1 = just guessing | 2 = pretty sure | 3 = certain

    time_to_confidence: Optional[int] = None
    # seconds from answer selection to confidence tap

    # Answer-change tracking
    answer_changed: Optional[bool] = None
    original_answer: Optional[str] = None
    time_to_first_change: Optional[int] = None

    # Optional hover/reading behavior from frontend
    answer_timeline: Optional[dict] = None
    # keys: time_on_option_a/b/c/d, second_choice, re_read_question, re_read_count

    @field_validator("selected_answer", "correct_answer")
    @classmethod
    def validate_answer_letter(cls, v: str) -> str:
        if v.upper() not in {"A", "B", "C", "D"}:
            raise ValueError("answer must be A, B, C, or D")
        return v.upper()


class AnswerResponse(BaseModel):
    attempt_id: str
    running_score: float    # correct_so_far / answered_so_far


# ── Complete session ──────────────────────────────────────────────────────────

class CompleteSessionResponse(BaseModel):
    correct: int
    total: int
    accuracy: float
    duration_seconds: int
    readiness_score: float


# ── Weak points ───────────────────────────────────────────────────────────────

class WeakPointOut(BaseModel):
    topic: str
    accuracy_rate: float
    total_attempts: int
    consecutive_failures: int
    last_attempted_at: Optional[datetime] = None
    last_correct_at: Optional[datetime] = None
    last_wrong_at: Optional[datetime] = None
    most_common_wrong_answer: Optional[str] = None
    accuracy_trend: Optional[float] = None

    model_config = {"from_attributes": True}


# ── Readiness ─────────────────────────────────────────────────────────────────

class ReadinessResponse(BaseModel):
    readiness_score: float
    total_questions_answered: int
    weak_topics_count: int
    strong_topics_count: int
    last_session_at: Optional[datetime] = None


# ── Session history ───────────────────────────────────────────────────────────

class SessionHistoryItem(BaseModel):
    session_id: str
    document_name: str
    mode: str
    correct: int
    total: int
    readiness_score: Optional[float] = None
    duration_seconds: Optional[int] = None
    completed_at: Optional[datetime] = None


# ── Save questions ────────────────────────────────────────────────────────────

class SaveQuestionsRequest(BaseModel):
    document_id: int
    mode: str
    mcqs: List[Any]     # dicts from ai_service — flexible format


class SaveQuestionsResponse(BaseModel):
    saved_count: int
    question_ids: List[str]


# ── MCQ question out ──────────────────────────────────────────────────────────

class McqQuestionOut(BaseModel):
    id: str
    topic: str
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_answer: str
    explanation: str
    mode: str
    difficulty_type: str

    model_config = {"from_attributes": True}


# ── Weekly quiz ───────────────────────────────────────────────────────────────

class WeeklyQuizResponse(BaseModel):
    assignment_id: Optional[str] = None
    questions: Optional[List[McqQuestionOut]] = None
    weak_topics: Optional[List[str]] = None


# ── AI insight ────────────────────────────────────────────────────────────────

class AiInsightResponse(BaseModel):
    next_topic_to_study: Optional[str] = None
    intervention_type: Optional[str] = None
    personalized_message: Optional[str] = None
    predicted_readiness_7d: Optional[float] = None
    critical_insight: Optional[str] = None
    daily_plan: Optional[list] = None
    behavioral_warning: Optional[str] = None
    strongest_topic: Optional[str] = None


class NextBestActionResponse(BaseModel):
    action_type: str
    topic: Optional[str]
    next_step: str
    reason: List[str]
    confidence_gap_alert: bool
    short_message: str
    predicted_readiness_24h: Optional[float] = None


# ── Next question ─────────────────────────────────────────────────────────────

class NextQuestionResponse(BaseModel):
    question: Optional[McqQuestionOut] = None
    reason: str
    # 'weak_topic' | 'dangerous_misconception' | 'co_failure_topic' | 'standard' | 'session_complete'
