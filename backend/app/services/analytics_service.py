"""
Analytics service — real database queries for all analytics endpoints.
All functions receive a SQLAlchemy Session and the authenticated User ORM object.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.models import User
from app.models.performance import (
    QuestionAttempt,
    PerformanceSession,
    WeakPoint,
    TopicCoFailure,
    StudentAiInsight,
)


# ── Overview ──────────────────────────────────────────────────────────────────

def get_overview_stats(user: User, db: Session) -> dict:
    """
    Overall accuracy, total attempts, sessions this week, current streak,
    and the single weakest topic.
    """
    uid = user.id

    total_attempts = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == uid
    ).count()

    total_correct = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == uid,
        QuestionAttempt.is_correct == True,
    ).count()

    overall_accuracy = round(total_correct / total_attempts * 100, 2) if total_attempts else 0.0

    # Sessions in the current ISO week (Mon–Sun)
    now = datetime.now(timezone.utc)
    week_start = now - timedelta(days=now.weekday())
    week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)

    sessions_this_week = db.query(PerformanceSession).filter(
        PerformanceSession.student_id == uid,
        PerformanceSession.completed_at >= week_start,
    ).count()

    # Current streak — consecutive calendar days with at least one completed session
    streak = 0
    check_date = now.date()
    while True:
        day_start = datetime(check_date.year, check_date.month, check_date.day, tzinfo=timezone.utc)
        day_end = day_start + timedelta(days=1)
        had_session = db.query(PerformanceSession).filter(
            PerformanceSession.student_id == uid,
            PerformanceSession.completed_at >= day_start,
            PerformanceSession.completed_at < day_end,
        ).first()
        if had_session:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break
        if streak > 365:   # safety cap
            break

    weakest = (
        db.query(WeakPoint)
        .filter(
            WeakPoint.student_id == uid,
            WeakPoint.flagged_as_weak == True,
        )
        .order_by(WeakPoint.accuracy_rate.asc())
        .first()
    )

    weakest_topic = (
        {"topic": weakest.topic, "accuracy_rate": weakest.accuracy_rate}
        if weakest else None
    )

    return {
        "overall_accuracy": overall_accuracy,
        "total_correct": total_correct,
        "total_attempted": total_attempts,
        "sessions_this_week": sessions_this_week,
        "current_streak": streak,
        "weakest_topic": weakest_topic,
    }


# ── Accuracy timeline ─────────────────────────────────────────────────────────

def get_accuracy_timeline(user: User, db: Session, days: int = 7) -> dict:
    """
    Returns per-day correct/total/accuracy for the last N days.
    Days with no attempts are included as zeros so the chart never has gaps.
    """
    uid = user.id
    now = datetime.now(timezone.utc)
    timeline = []

    for i in range(days - 1, -1, -1):
        day = now.date() - timedelta(days=i)
        day_start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
        day_end = day_start + timedelta(days=1)

        attempts = db.query(QuestionAttempt).filter(
            QuestionAttempt.student_id == uid,
            QuestionAttempt.created_at >= day_start,
            QuestionAttempt.created_at < day_end,
        ).all()

        total = len(attempts)
        correct = sum(1 for a in attempts if a.is_correct)
        accuracy = round(correct / total * 100, 2) if total else 0.0

        timeline.append({
            "date": day.isoformat(),
            "correct": correct,
            "total": total,
            "accuracy_percent": accuracy,
        })

    return {"days": days, "data": timeline}


# ── Weak topics ───────────────────────────────────────────────────────────────

def get_weak_topics(
    user: User,
    db: Session,
    limit: int = 10,
    include_recovered: bool = True,
) -> dict:
    """
    Returns flagged weak topics with decay severity derived from accuracy_rate.
    'Recovered' means previously flagged but accuracy_rate now >= 0.6.
    """
    uid = user.id

    query = db.query(WeakPoint).filter(WeakPoint.student_id == uid)
    if not include_recovered:
        query = query.filter(WeakPoint.flagged_as_weak == True)

    weak_points = query.order_by(WeakPoint.accuracy_rate.asc()).limit(limit).all()

    topics = []
    for wp in weak_points:
        acc = wp.accuracy_rate or 0.0
        if acc >= 0.8:
            severity = "recovered"
        elif acc >= 0.6:
            severity = "low"
        elif acc >= 0.4:
            severity = "medium"
        else:
            severity = "high"

        topics.append({
            "subtopic": wp.topic,
            "error_count": wp.total_attempts - (wp.correct_attempts or 0),
            "decay_rate": wp.decay_rate or 1,
            "decay_severity": severity,
        })

    return {"topics": topics}


# ── Confidence calibration ────────────────────────────────────────────────────

def get_confidence_calibration(user: User, db: Session) -> dict:
    """
    Groups attempts by pre_answer_confidence level (1–3) and calculates accuracy.
    Danger-zone points: high confidence (>=2) but accuracy < 50 %.
    """
    uid = user.id

    attempts = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == uid,
        QuestionAttempt.pre_answer_confidence.isnot(None),
    ).all()

    buckets: dict[int, list] = {1: [], 2: [], 3: []}
    for a in attempts:
        level = a.pre_answer_confidence
        if level in buckets:
            buckets[level].append(a.is_correct)

    data = []
    danger_zone = 0
    for level in (1, 2, 3):
        results = buckets[level]
        total = len(results)
        correct = sum(results)
        accuracy = round(correct / total * 100, 2) if total else 0.0
        if level >= 2 and accuracy < 50.0 and total > 0:
            danger_zone += 1
        data.append({
            "confidence_level": level,
            "attempts": total,
            "correct": correct,
            "accuracy_percent": accuracy,
        })

    return {"data": data, "danger_zone_points": danger_zone}


# ── Time-of-day ───────────────────────────────────────────────────────────────

def get_time_of_day_stats(user: User, db: Session) -> dict:
    """
    Groups attempts by time_of_day hour into four periods and returns accuracy.
    """
    uid = user.id

    attempts = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == uid,
        QuestionAttempt.time_of_day.isnot(None),
    ).all()

    periods = {
        "morning":   [],   # 6–11
        "afternoon": [],   # 12–17
        "evening":   [],   # 18–21
        "night":     [],   # 22–5
    }

    for a in attempts:
        h = a.time_of_day
        if 6 <= h <= 11:
            periods["morning"].append(a.is_correct)
        elif 12 <= h <= 17:
            periods["afternoon"].append(a.is_correct)
        elif 18 <= h <= 21:
            periods["evening"].append(a.is_correct)
        else:
            periods["night"].append(a.is_correct)

    best_time = "morning"
    best_acc = -1.0
    data = []
    for name, results in periods.items():
        total = len(results)
        acc = sum(results) / total if total else 0.0
        if acc > best_acc:
            best_acc = acc
            best_time = name
        data.append({
            "time_of_day": name,
            "accuracy_rate": round(acc, 4),
            "is_peak": False,   # filled below
        })

    for item in data:
        item["is_peak"] = item["time_of_day"] == best_time

    return {"data": data, "best_time": best_time}


# ── AI insight ────────────────────────────────────────────────────────────────

def generate_ai_insight(
    user: User,
    db: Session,
    force_regenerate: bool = False,
    max_length: int = None,
    style: str = "balanced",
) -> dict:
    """
    Returns the latest cached AI insight from student_ai_insights.
    Falls back gracefully when no insight has been generated yet.
    The heavy AI generation lives in performance.py (_generate_and_persist_insight).
    """
    uid = user.id

    cached = (
        db.query(StudentAiInsight)
        .filter(
            StudentAiInsight.student_id == uid,
            StudentAiInsight.is_current == True,
        )
        .order_by(StudentAiInsight.generated_at.desc())
        .first()
    )

    if cached:
        insight_text = cached.insight_json.get("personalized_message", "")
        if max_length and len(insight_text) > max_length:
            insight_text = insight_text[:max_length] + "..."
        minutes_ago = int(
            (datetime.now(timezone.utc) - cached.generated_at.replace(tzinfo=timezone.utc)).total_seconds() / 60
        )
        return {
            "data": {
                "insight_text": insight_text,
                "generated_at": cached.generated_at,
                "minutes_ago": minutes_ago,
            },
            "message": "Cached insight retrieved",
        }

    return {
        "data": None,
        "message": "No insight generated yet. Complete at least one session to generate your first insight.",
    }


# ── Co-failures ───────────────────────────────────────────────────────────────

def get_cofailures(user: User, db: Session, limit: int = 10) -> dict:
    """
    Returns topic pairs that co-fail (both flagged as weak) for this student.
    """
    uid = user.id

    pairs = (
        db.query(TopicCoFailure)
        .filter(TopicCoFailure.student_id == uid)
        .order_by(TopicCoFailure.co_failure_count.desc())
        .limit(limit)
        .all()
    )

    return {
        "topic_pairs": [
            {
                "topic_a": p.topic_a,
                "topic_b": p.topic_b,
                "co_fail_count": p.co_failure_count,
            }
            for p in pairs
        ]
    }
