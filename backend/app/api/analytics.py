"""
Analytics API router for student performance analysis.
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.analytics import (
    OverviewResponse,
    AccuracyTimelineResponse,
    WeakTopicsResponse,
    ConfidenceCalibrationResponse,
    TimeOfDayResponse,
    AIInsightResponse,
    CoFailuresResponse,
)
from app.models.models import User
from app.services.analytics_service import (
    get_overview_stats,
    get_accuracy_timeline,
    get_weak_topics,
    get_confidence_calibration,
    get_time_of_day_stats,
    generate_ai_insight,
    get_cofailures,
)
from app.api.deps import get_current_user

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get(
    "/overview",
    response_model=OverviewResponse,
    summary="Get overall analytics overview",
    description="Returns overall accuracy, total attempts, sessions this week, "
    "current streak, and weakest topic.",
)
async def get_overview(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OverviewResponse:
    return get_overview_stats(user, db)


@router.get(
    "/accuracy-timeline",
    response_model=AccuracyTimelineResponse,
    summary="Get accuracy timeline",
    description="Returns accuracy data for the last N days with correct and total attempts.",
)
async def get_accuracy_timeline_endpoint(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    days: int = Query(default=7, ge=1, le=90, description="Number of days of history to retrieve"),
) -> AccuracyTimelineResponse:
    return get_accuracy_timeline(user, db, days=days)


@router.get(
    "/weak-topics",
    response_model=WeakTopicsResponse,
    summary="Get weak topics",
    description="Returns topics where the student is getting questions wrong repeatedly, "
    "with decay rate and severity.",
)
async def get_weak_topics_endpoint(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=10, ge=1, le=50, description="Maximum number of weak topics to return"),
    include_recovered: bool = Query(default=True, description="Include topics that have recovered"),
) -> WeakTopicsResponse:
    return get_weak_topics(user, db, limit=limit, include_recovered=include_recovered)


@router.get(
    "/confidence-calibration",
    response_model=ConfidenceCalibrationResponse,
    summary="Get confidence calibration",
    description="Analyzes the relationship between confidence level and actual accuracy.",
)
async def get_confidence_calibration_endpoint(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConfidenceCalibrationResponse:
    return get_confidence_calibration(user, db)


@router.get(
    "/time-of-day",
    response_model=TimeOfDayResponse,
    summary="Get time of day analytics",
    description="Analyzes accuracy patterns across different times of the day.",
)
async def get_time_of_day_endpoint(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TimeOfDayResponse:
    return get_time_of_day_stats(user, db)


@router.post(
    "/ai-insight",
    response_model=AIInsightResponse,
    summary="Generate AI insight",
    description="Returns the latest cached AI-powered insight about the student's study patterns.",
)
async def generate_insight_endpoint(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    force_regenerate: Optional[bool] = Query(default=False, description="Force regeneration even if cached"),
    max_length: Optional[int] = Query(default=None, description="Max length of the insight in characters"),
    style: Optional[str] = Query(
        default=None,
        description="Style of insight: 'encouraging', 'analytical', 'action-oriented', or 'balanced'",
    ),
) -> AIInsightResponse:
    return generate_ai_insight(user, db, force_regenerate=force_regenerate, max_length=max_length, style=style)


@router.get(
    "/co-failures",
    response_model=CoFailuresResponse,
    summary="Get co-failure topic pairs",
    description="Returns topic pairs where the student tends to fail both topics together.",
)
async def get_cofailures_endpoint(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=10, ge=1, le=50, description="Maximum number of co-failure pairs to return"),
) -> CoFailuresResponse:
    return get_cofailures(user, db, limit=limit)
