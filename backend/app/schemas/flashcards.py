from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FlashcardOut(BaseModel):
    id: str
    document_id: int
    topic: str
    front: str
    back: str
    memory_tip: Optional[str] = None
    card_type: str
    difficulty: str
    fsrs_state: Optional[int] = None
    days_overdue: Optional[int] = None
    lapses: Optional[int] = None

    model_config = {"from_attributes": True}


class ReviewRequest(BaseModel):
    rating: int = Field(..., ge=1, le=4)
    time_spent_seconds: Optional[int] = None


class ReviewResponse(BaseModel):
    next_due: datetime
    interval_days: int
    state: int
    new_stability: Optional[float] = None


class GenerateRequest(BaseModel):
    mode: str = "revision"


class GenerateResponse(BaseModel):
    generated_count: int
    card_ids: list[str]


class FlashcardStats(BaseModel):
    total_cards_seen: int
    total_reviews: int
    cards_due_today: int
    cards_mastered: int
    avg_rating: Optional[float] = None
    topic_breakdown: list[dict]
    streak_days: int
