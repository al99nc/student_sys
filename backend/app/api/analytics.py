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
    DashboardResponse,
    UserProfile,
    EntitlementsSummary,
    LectureStats,
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
    get_lecture_stats,
)
from app.core.entitlements import (
    resolve_entitlements,
    count_uploads_this_month,
    count_coach_messages_this_month,
    count_tokens_today,
    is_premium,
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


@router.get(
    "/dashboard",
    response_model=DashboardResponse,
    summary="Get full dashboard data in one request",
    description=(
        "Aggregates user profile, entitlements, lecture stats, and all analytics "
        "sections into a single response. Replaces separate calls to /auth/me, "
        "/billing/entitlements, /stats, and all /analytics/* endpoints."
    ),
)
async def get_dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    timeline_days: int = Query(default=7, ge=1, le=90, description="Days of accuracy history to include"),
    weak_topics_limit: int = Query(default=10, ge=1, le=50, description="Max weak topics to return"),
    co_failures_limit: int = Query(default=10, ge=1, le=50, description="Max co-failure pairs to return"),
) -> DashboardResponse:
    uid = str(user.id)
    ent = resolve_entitlements(user)

    user_profile = UserProfile(
        id=uid,
        email=user.email,
        name=user.name,
        university=user.university,
        college=user.college,
        year_of_study=user.year_of_study,
        credit_balance=user.credit_balance or 0,
        profile_picture=user.profile_picture,
    )

    entitlements = EntitlementsSummary(
        plan=ent.tier,
        premium=is_premium(user),
        credit_balance=user.credit_balance or 0,
        uploads_this_month=count_uploads_this_month(db, uid),
        uploads_limit=ent.uploads_limit,
        coach_messages_this_month=count_coach_messages_this_month(db, uid),
        coach_messages_limit=ent.coach_limit,
        tokens_used_today=count_tokens_today(db, uid),
        daily_token_budget=ent.daily_token_budget,
        extra_usage_enabled=bool(user.extra_usage_enabled),
        has_coach_memory=ent.has_coach_memory,
        has_analytics=ent.has_analytics,
        has_exam_simulator=ent.has_exam_simulator,
        has_cross_doc_query=ent.has_cross_doc_query,
        has_spaced_repetition=ent.has_spaced_repetition,
        has_export=ent.has_export,
        has_priority_queue=ent.has_priority_queue,
    )

    return DashboardResponse(
        user=user_profile,
        entitlements=entitlements,
        lecture_stats=get_lecture_stats(user, db),
        overview=get_overview_stats(user, db),
        accuracy_timeline=get_accuracy_timeline(user, db, days=timeline_days),
        weak_topics=get_weak_topics(user, db, limit=weak_topics_limit),
        confidence_calibration=get_confidence_calibration(user, db),
        time_of_day=get_time_of_day_stats(user, db),
        co_failures=get_cofailures(user, db, limit=co_failures_limit),
        ai_insight=generate_ai_insight(user, db),
    )
