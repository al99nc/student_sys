from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# Response models for analytics endpoints

class OverviewStat(BaseModel):
    """Single stat card value"""
    stat_name: str
    value: int | float
    description: str


class OverviewResponse(BaseModel):
    """Response for GET /analytics/overview"""
    overall_accuracy: float
    total_correct: int
    total_attempted: int
    sessions_this_week: int
    current_streak: int
    weakest_topic: Optional[dict]  # topic, subtopic, error_count, last_seen

    class Config:
        from_attributes = True


class DailyAccuracy(BaseModel):
    """Single daily accuracy data point"""
    date: str  # YYYY-MM-DD
    correct: int
    total: int
    accuracy_percent: float


class AccuracyTimelineResponse(BaseModel):
    """Response for GET /analytics/accuracy-timeline"""
    days: int
    data: list[DailyAccuracy]

    class Config:
        from_attributes = True


class WeakTopic(BaseModel):
    """Single weak topic with decay severity"""
    subtopic: str
    error_count: int
    decay_rate: int  # 1-10
    decay_severity: str  # "high", "medium", "low", "recovered"

    @property
    def color(self) -> str:
        if self.decay_rate >= 8:
            return "text-red-500"
        elif self.decay_rate >= 5:
            return "text-orange-500"
        elif self.decay_rate >= 2:
            return "text-yellow-500"
        else:
            return "text-green-500"


class WeakTopicsResponse(BaseModel):
    """Response for GET /analytics/weak-topics"""
    topics: list[WeakTopic]


class ConfidenceCalibrationPoint(BaseModel):
    """Single confidence level accuracy point"""
    confidence_level: int  # 1-5
    attempts: int
    correct: int
    accuracy_percent: float


class ConfidenceCalibrationResponse(BaseModel):
    """Response for GET /analytics/confidence-calibration"""
    data: list[ConfidenceCalibrationPoint]
    danger_zone_points: int  # count of points where confidence >= 4 but accuracy < 50%

    class Config:
        from_attributes = True


class TimeOfDayData(BaseModel):
    """Single time of day accuracy"""
    time_of_day: str  # morning, afternoon, evening, night
    accuracy_rate: float
    is_peak: bool

    @property
    def color(self) -> str:
        if self.is_peak:
            return "bg-green-500"
        elif self.accuracy_rate >= 70:
            return "bg-blue-500"
        else:
            return "bg-slate-600"


class TimeOfDayResponse(BaseModel):
    """Response for GET /analytics/time-of-day"""
    data: list[TimeOfDayData]
    best_time: str

    class Config:
        from_attributes = True


class AIInsightCacheData(BaseModel):
    """Cached AI insight data"""
    insight_text: str
    generated_at: datetime
    minutes_ago: int


class AIInsightResponse(BaseModel):
    """Response for GET/POST /analytics/ai-insight"""
    data: Optional[AIInsightCacheData]
    message: Optional[str]  # "Insight generated" or "No cached insight found"


class CohesionMetrics(BaseModel):
    """Response for Cohesion Score endpoint"""
    cohesion_score: float
    topic_pairs_analyzed: int
    most_cohesive_pair: Optional[dict]
    least_cohesive_pair: Optional[dict]


class CoFailureData(BaseModel):
    """Co-failure topic pair"""
    topic_a: str
    topic_b: str
    co_fail_count: int


class CoFailuresResponse(BaseModel):
    """Response for Co-failures endpoint"""
    topic_pairs: list[CoFailureData]
