import json
import random
import re
from uuid import uuid4
from datetime import datetime, timedelta
from typing import List

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.database import get_db
from app.api.deps import get_current_user
from app.models.models import User, Lecture
from app.models.performance import (
    PerformanceSession,
    McqQuestion,
    QuestionAttempt,
    WeakPoint,
    WeeklyQuizAssignment,
    TopicCoFailure,
    TopicSnapshot,
    AnswerTimeline,
    LearningPattern,
    StudentAiInsight,
)
from app.schemas.performance import (
    StartSessionRequest,
    StartSessionResponse,
    AnswerRequest,
    AnswerResponse,
    CompleteSessionResponse,
    WeakPointOut,
    ReadinessResponse,
    SessionHistoryItem,
    SaveQuestionsRequest,
    SaveQuestionsResponse,
    McqQuestionOut,
    WeeklyQuizResponse,
    AiInsightResponse,
    NextBestActionResponse,
)

router = APIRouter(prefix="/api/v1/performance", tags=["performance"])

MASTERY_THRESHOLD = 0.8
RELAPSE_THRESHOLD = 0.6


# ── POST /sessions/start ──────────────────────────────────────────────────────

@router.post("/sessions/start", response_model=StartSessionResponse)
def start_session(
    body: StartSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = db.query(Lecture).filter(Lecture.id == body.document_id).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Document not found")

    session = PerformanceSession(
        id=str(uuid4()),
        student_id=current_user.id,
        document_id=body.document_id,
        mode=body.mode,
        total_questions=body.total_questions,
        correct_count=0,
    )
    db.add(session)
    db.commit()
    return StartSessionResponse(session_id=session.id)


# ── POST /sessions/{session_id}/answer ───────────────────────────────────────

@router.post("/sessions/{session_id}/answer", response_model=AnswerResponse)
def submit_answer(
    session_id: str,
    body: AnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(PerformanceSession).filter(
        PerformanceSession.id == session_id,
        PerformanceSession.student_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    is_correct = body.selected_answer == body.correct_answer

    # Attempt number = how many times this student has answered this question total
    prev_attempts = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == current_user.id,
        QuestionAttempt.question_id == body.question_id,
    ).count()

    # confidence_proxy: fast+correct = high confidence, wrong = 0
    confidence_proxy = (1.0 / body.time_spent_seconds) if is_correct and body.time_spent_seconds > 0 else 0.0

    now = datetime.utcnow()
    attempt_id = str(uuid4())
    attempt = QuestionAttempt(
        id=attempt_id,
        session_id=session_id,
        student_id=current_user.id,
        question_id=body.question_id,
        selected_answer=body.selected_answer,
        correct_answer=body.correct_answer,
        is_correct=is_correct,
        time_spent_seconds=body.time_spent_seconds,
        attempt_number=prev_attempts + 1,
        confidence_proxy=confidence_proxy,
        # Time intelligence
        time_of_day=now.hour,
        day_of_week=now.weekday(),
        # Answer-change fields from body
        answer_changed=body.answer_changed,
        original_answer=body.original_answer,
        time_to_first_change=body.time_to_first_change,
    )
    db.add(attempt)

    # Pre-reveal confidence and calibration_gap
    if body.pre_answer_confidence is not None:
        direction = 1 if is_correct else -1
        attempt.calibration_gap = (body.pre_answer_confidence - 1) * direction
        attempt.pre_answer_confidence = body.pre_answer_confidence
        attempt.time_to_confidence = body.time_to_confidence

    # Update session correct count and rushed signal
    if is_correct:
        session.correct_count = (session.correct_count or 0) + 1
    if body.time_spent_seconds < 5:
        session.rushed_count = (session.rushed_count or 0) + 1

    # Resolve topic for this question
    question = db.query(McqQuestion).filter(McqQuestion.id == body.question_id).first()
    topic = question.topic if question else "unknown"

    # Upsert weak_points for this student+topic
    weak_point = db.query(WeakPoint).filter(
        WeakPoint.student_id == current_user.id,
        WeakPoint.topic == topic,
    ).first()

    was_weak_before = weak_point.flagged_as_weak if weak_point else False

    if weak_point:
        # Capture accuracy before update for mastery tracking
        old_accuracy = weak_point.accuracy_rate or 0.0

        weak_point.total_attempts += 1
        if is_correct:
            weak_point.correct_attempts += 1
            weak_point.consecutive_failures = 0
            weak_point.last_correct_at = now
        else:
            weak_point.consecutive_failures += 1
            weak_point.last_wrong_at = now
        weak_point.accuracy_rate = weak_point.correct_attempts / weak_point.total_attempts
        weak_point.last_attempted_at = now
        weak_point.flagged_as_weak = (
            weak_point.accuracy_rate < 0.6 and weak_point.total_attempts >= 3
        )
        weak_point.updated_at = now

        # Mastery tracking
        was_mastered = old_accuracy >= MASTERY_THRESHOLD
        now_mastered = weak_point.accuracy_rate >= MASTERY_THRESHOLD

        if now_mastered and not was_mastered:
            if not weak_point.first_mastered_at:
                weak_point.first_mastered_at = now
            weak_point.times_mastered = (weak_point.times_mastered or 0) + 1

        if was_mastered and weak_point.accuracy_rate < RELAPSE_THRESHOLD:
            weak_point.times_relapsed = (weak_point.times_relapsed or 0) + 1
            if weak_point.first_mastered_at:
                days = (now - weak_point.first_mastered_at).days
                weak_point.decay_rate = days

    else:
        weak_point = WeakPoint(
            id=str(uuid4()),
            student_id=current_user.id,
            topic=topic,
            total_attempts=1,
            correct_attempts=1 if is_correct else 0,
            accuracy_rate=1.0 if is_correct else 0.0,
            consecutive_failures=0 if is_correct else 1,
            last_attempted_at=now,
            last_correct_at=now if is_correct else None,
            last_wrong_at=None if is_correct else now,
            flagged_as_weak=False,  # needs >= 3 attempts to flag
            updated_at=now,
        )
        db.add(weak_point)

    # Dangerous misconception: certain + wrong (calibration_gap == -2)
    if attempt.calibration_gap == -2:
        weak_point.dangerous_misconception = True

    # most_common_wrong_answer: most frequent distractor this student picks for this topic
    if not is_correct:
        wrong_row = (
            db.query(QuestionAttempt.selected_answer, func.count(QuestionAttempt.id).label("cnt"))
            .join(McqQuestion, QuestionAttempt.question_id == McqQuestion.id)
            .filter(
                QuestionAttempt.student_id == current_user.id,
                McqQuestion.topic == topic,
                QuestionAttempt.is_correct == False,
            )
            .group_by(QuestionAttempt.selected_answer)
            .order_by(func.count(QuestionAttempt.id).desc())
            .first()
        )
        if wrong_row:
            weak_point.most_common_wrong_answer = wrong_row[0]

    db.flush()  # so weak_point.flagged_as_weak is final before co-failure check

    # Update global question stats (autoflush includes current attempt)
    if question:
        all_attempts = db.query(QuestionAttempt).filter(
            QuestionAttempt.question_id == body.question_id
        ).all()
        if all_attempts:
            question.global_accuracy_rate = sum(1 for a in all_attempts if a.is_correct) / len(all_attempts)
            question.global_avg_time = sum(a.time_spent_seconds for a in all_attempts) / len(all_attempts)

    # TopicCoFailure: when a topic becomes newly flagged, pair it with all other flagged topics
    newly_flagged = not was_weak_before and weak_point.flagged_as_weak
    if newly_flagged:
        other_flagged_topics = [
            row[0]
            for row in db.query(WeakPoint.topic).filter(
                WeakPoint.student_id == current_user.id,
                WeakPoint.flagged_as_weak == True,
                WeakPoint.topic != topic,
            ).all()
        ]
        for other_topic in other_flagged_topics:
            ta, tb = sorted([topic, other_topic])
            co = db.query(TopicCoFailure).filter(
                TopicCoFailure.student_id == current_user.id,
                TopicCoFailure.topic_a == ta,
                TopicCoFailure.topic_b == tb,
            ).first()
            if co:
                co.co_failure_count += 1
            else:
                db.add(TopicCoFailure(
                    id=str(uuid4()),
                    student_id=current_user.id,
                    topic_a=ta,
                    topic_b=tb,
                    co_failure_count=1,
                ))

    # Save AnswerTimeline if frontend provides hover data
    if body.answer_timeline:
        timeline = AnswerTimeline(
            id=str(uuid4()),
            attempt_id=attempt_id,
            student_id=current_user.id,
            time_on_option_a=body.answer_timeline.get("time_on_option_a"),
            time_on_option_b=body.answer_timeline.get("time_on_option_b"),
            time_on_option_c=body.answer_timeline.get("time_on_option_c"),
            time_on_option_d=body.answer_timeline.get("time_on_option_d"),
            second_choice=body.answer_timeline.get("second_choice"),
            re_read_question=body.answer_timeline.get("re_read_question", False),
            re_read_count=body.answer_timeline.get("re_read_count", 0),
        )
        db.add(timeline)

    db.commit()

    # Weekly quiz trigger: fire if 3+ flagged weak points and no pending assignment this week
    weak_count = db.query(WeakPoint).filter(
        WeakPoint.student_id == current_user.id,
        WeakPoint.flagged_as_weak == True,
    ).count()

    week_start = datetime.utcnow().date() - timedelta(days=datetime.utcnow().weekday())
    existing_assignment = db.query(WeeklyQuizAssignment).filter(
        WeeklyQuizAssignment.student_id == current_user.id,
        WeeklyQuizAssignment.week_start == week_start,
        WeeklyQuizAssignment.status == "pending",
    ).first()

    if weak_count >= 3 and not existing_assignment:
        weak_topics = db.query(WeakPoint.topic).filter(
            WeakPoint.student_id == current_user.id,
            WeakPoint.flagged_as_weak == True,
        ).all()

        topic_list = [t[0] for t in weak_topics]
        questions = db.query(McqQuestion).filter(
            McqQuestion.topic.in_(topic_list)
        ).order_by(func.random()).limit(10).all()

        if questions:
            assignment = WeeklyQuizAssignment(
                id=str(uuid4()),
                student_id=current_user.id,
                week_start=week_start,
                question_ids=[str(q.id) for q in questions],
                status="pending",
            )
            db.add(assignment)
            db.commit()

    # Running score = correct so far / answered so far in this session
    total_answered = db.query(QuestionAttempt).filter(
        QuestionAttempt.session_id == session_id,
    ).count()
    running_score = (session.correct_count or 0) / total_answered if total_answered > 0 else 0.0

    return AnswerResponse(attempt_id=attempt_id, running_score=running_score)


# ── POST /sessions/{session_id}/complete ─────────────────────────────────────

@router.post("/sessions/{session_id}/complete", response_model=CompleteSessionResponse)
def complete_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(PerformanceSession).filter(
        PerformanceSession.id == session_id,
        PerformanceSession.student_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    now = datetime.utcnow()
    session.completed_at = now
    session.duration_seconds = int((now - session.started_at).total_seconds())

    correct = session.correct_count or 0
    total = session.total_questions or 1

    base_score = (correct / total) * 100

    # Penalty: -2 per topic where accuracy_rate < 0.5
    penalty_topics = db.query(WeakPoint).filter(
        WeakPoint.student_id == current_user.id,
        WeakPoint.accuracy_rate < 0.5,
    ).count()

    readiness = max(0.0, min(100.0, base_score - (penalty_topics * 2)))
    session.readiness_score = readiness
    session.avg_time_per_question = session.duration_seconds / total if total > 0 else None

    # Snapshot every topic touched in this session (at most once per topic per day)
    topics_in_session = (
        db.query(McqQuestion.topic)
        .join(QuestionAttempt, QuestionAttempt.question_id == McqQuestion.id)
        .filter(QuestionAttempt.session_id == session_id)
        .distinct()
        .all()
    )
    today = now.date()
    for (topic,) in topics_in_session:
        exists = db.query(TopicSnapshot).filter(
            TopicSnapshot.student_id == current_user.id,
            TopicSnapshot.topic == topic,
            TopicSnapshot.snapshot_date == today,
        ).first()
        if not exists:
            wp = db.query(WeakPoint).filter(
                WeakPoint.student_id == current_user.id,
                WeakPoint.topic == topic,
            ).first()
            if wp:
                days_since = None
                if wp.last_attempted_at:
                    days_since = (now - wp.last_attempted_at).days
                db.add(TopicSnapshot(
                    id=str(uuid4()),
                    student_id=current_user.id,
                    topic=topic,
                    accuracy_rate=wp.accuracy_rate,
                    snapshot_date=today,
                    days_since_last_review=days_since,
                ))

    # Update accuracy_trend on weak_points using 7-day snapshots
    seven_days_ago = today - timedelta(days=7)
    for (topic,) in topics_in_session:
        wp = db.query(WeakPoint).filter(
            WeakPoint.student_id == current_user.id,
            WeakPoint.topic == topic,
        ).first()
        if wp:
            old_snapshot = db.query(TopicSnapshot).filter(
                TopicSnapshot.student_id == current_user.id,
                TopicSnapshot.topic == topic,
                TopicSnapshot.snapshot_date <= seven_days_ago,
            ).order_by(TopicSnapshot.snapshot_date.desc()).first()

            if old_snapshot:
                wp.accuracy_7d_ago = old_snapshot.accuracy_rate
                wp.accuracy_trend = round(wp.accuracy_rate - old_snapshot.accuracy_rate, 3)

    # Invalidate current AI insight so it regenerates with fresh data
    db.query(StudentAiInsight).filter(
        StudentAiInsight.student_id == current_user.id,
        StudentAiInsight.is_current == True,
    ).update({"is_current": False})

    db.commit()

    accuracy = correct / total if total > 0 else 0.0

    return CompleteSessionResponse(
        correct=correct,
        total=total,
        accuracy=accuracy,
        duration_seconds=session.duration_seconds,
        readiness_score=readiness,
    )


# ── GET /students/me/weak-points ─────────────────────────────────────────────

@router.get("/students/me/weak-points", response_model=List[WeakPointOut])
def get_weak_points(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    weak_points = (
        db.query(WeakPoint)
        .filter(
            WeakPoint.student_id == current_user.id,
            WeakPoint.flagged_as_weak == True,
        )
        .order_by(WeakPoint.accuracy_rate.asc())
        .all()
    )

    seven_days_ago = (datetime.utcnow() - timedelta(days=7)).date()
    result = []
    for wp in weak_points:
        old_snapshot = (
            db.query(TopicSnapshot)
            .filter(
                TopicSnapshot.student_id == current_user.id,
                TopicSnapshot.topic == wp.topic,
                TopicSnapshot.snapshot_date <= seven_days_ago,
            )
            .order_by(TopicSnapshot.snapshot_date.desc())
            .first()
        )
        out = WeakPointOut.model_validate(wp)
        if old_snapshot:
            out.accuracy_trend = round(wp.accuracy_rate - old_snapshot.accuracy_rate, 3)
        result.append(out)

    return result


# ── GET /students/me/readiness ────────────────────────────────────────────────

@router.get("/students/me/readiness", response_model=ReadinessResponse)
def get_readiness(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cutoff = datetime.utcnow() - timedelta(days=14)

    recent_attempts = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == current_user.id,
        QuestionAttempt.created_at >= cutoff,
    ).all()

    total_answered = len(recent_attempts)
    correct_answered = sum(1 for a in recent_attempts if a.is_correct)
    readiness_score = (correct_answered / total_answered * 100) if total_answered > 0 else 0.0

    weak_count = db.query(WeakPoint).filter(
        WeakPoint.student_id == current_user.id,
        WeakPoint.flagged_as_weak == True,
    ).count()

    strong_count = db.query(WeakPoint).filter(
        WeakPoint.student_id == current_user.id,
        WeakPoint.flagged_as_weak == False,
        WeakPoint.total_attempts >= 3,
        WeakPoint.accuracy_rate >= 0.6,
    ).count()

    last_session = (
        db.query(PerformanceSession)
        .filter(
            PerformanceSession.student_id == current_user.id,
            PerformanceSession.completed_at.isnot(None),
        )
        .order_by(PerformanceSession.completed_at.desc())
        .first()
    )

    return ReadinessResponse(
        readiness_score=readiness_score,
        total_questions_answered=total_answered,
        weak_topics_count=weak_count,
        strong_topics_count=strong_count,
        last_session_at=last_session.completed_at if last_session else None,
    )


def _estimate_readiness_24h(student_id: int, db: Session) -> float:
    sessions = (
        db.query(PerformanceSession)
        .filter(
            PerformanceSession.student_id == student_id,
            PerformanceSession.completed_at.isnot(None),
        )
        .order_by(PerformanceSession.completed_at.desc())
        .limit(5)
        .all()
    )

    if not sessions:
        return None

    weights = [1.1, 1.0, 0.9, 0.8, 0.7]
    scores = [s.readiness_score or 0.0 for s in sessions]
    total_w = sum(weights[: len(scores)])
    if total_w == 0:
        return None

    weighted = sum((scores[i] * weights[i]) for i in range(len(scores)))
    return round(weighted / total_w, 1)


def _build_next_best_action(student_id: int, db: Session) -> dict:
    now = datetime.utcnow()

    weak_points = db.query(WeakPoint).filter(WeakPoint.student_id == student_id).all()
    pattern = db.query(LearningPattern).filter(LearningPattern.student_id == student_id).first()

    overconfident = (pattern.overconfidence_rate or 0.0) > 0.3 if pattern else False

    dangerous = [wp for wp in weak_points if wp.dangerous_misconception]
    decay_overdue = [
        wp
        for wp in weak_points
        if wp.decay_rate is not None
        and wp.last_attempted_at is not None
        and (now - wp.last_attempted_at).days > wp.decay_rate
    ]
    weak_flagged = [wp for wp in weak_points if wp.flagged_as_weak]

    # Primary topic selection
    candidate: WeakPoint = None
    action_type = "practice_topic"

    if dangerous:
        candidate = sorted(dangerous, key=lambda x: x.accuracy_rate or 0.0)[0]
        action_type = "misconception_correction"
    elif decay_overdue:
        candidate = sorted(decay_overdue, key=lambda x: (now - x.last_attempted_at).days, reverse=True)[0]
        action_type = "spaced_review"
    elif weak_flagged:
        candidate = sorted(weak_flagged, key=lambda x: x.accuracy_rate or 1.0)[0]
        if candidate.accuracy_rate is not None:
            if candidate.accuracy_rate < 0.5:
                action_type = "review_topic"
            elif candidate.accuracy_rate < 0.7:
                action_type = "practice_topic"
            else:
                action_type = "mixed_review"
    elif weak_points:
        candidate = sorted(weak_points, key=lambda x: x.accuracy_rate or 1.0)[0]
        action_type = "practice_topic" if candidate.accuracy_rate < 0.85 else "advance_topic"
    else:
        action_type = "exploration"

    if candidate is None:
        next_step = "Start with a new high-yield topic and do 5 focused questions."
        topic = None
        reason = ["No existing weak point data available yet."]
    else:
        topic = candidate.topic
        if action_type == "misconception_correction":
            next_step = f"Correct your misconception on {topic}: do 4 targeted concept-explanation questions first."
        elif action_type == "spaced_review":
            next_step = f"Review {topic} now; the topic is overdue based on your decay curve." 
        elif action_type == "review_topic":
            next_step = f"Review basics of {topic} with 5 rapid flashcards and one explanation note."
        elif action_type == "practice_topic":
            next_step = f"Practice {topic} with 5 application questions, then check reasoning immediately."
        elif action_type == "mixed_review":
            next_step = f"Mix review and applied problems in {topic} with 3 quick remembrance checks."
        elif action_type == "advance_topic":
            next_step = f"Move forward from {topic} to the next connected topic after 3 quiz questions."
        else:
            next_step = f"Explore a new topic with 5 quick questions to gather data."

        reason = []
        if dangerous:
            reason.append("Dangerous misconception detected")
        if decay_overdue:
            reason.append("Decay overdue: revisit this topic")
        if candidate.flagged_as_weak:
            reason.append(f"Weak topic ({candidate.accuracy_rate:.0%} accuracy)")
        else:
            reason.append(f"Accuracy at {candidate.accuracy_rate:.0%} indicates next step {action_type}")
        if candidate.consecutive_failures >= 3:
            reason.append(f"{candidate.consecutive_failures} consecutive failures")

    confidence_gap_alert = overconfident
    if not confidence_gap_alert:
        recent_attempts = db.query(QuestionAttempt).filter(
            QuestionAttempt.student_id == student_id,
            QuestionAttempt.created_at >= now - timedelta(days=14),
            QuestionAttempt.calibration_gap.isnot(None),
        ).all()
        if recent_attempts:
            wrong_confident = sum(1 for a in recent_attempts if a.calibration_gap == -2)
            total_conf = len(recent_attempts)
            if total_conf > 0 and (wrong_confident / total_conf) > 0.2:
                confidence_gap_alert = True
                reason.append("High overconfidence pattern from recent answers")

    return {
        "action_type": action_type,
        "topic": topic,
        "next_step": next_step,
        "reason": reason,
        "confidence_gap_alert": confidence_gap_alert,
        "short_message": (
            f"CortexQ: Focus on {topic if topic else 'a focused topic'}. "
            "Clear the key gap, then we re-evaluate."
        ),
        "predicted_readiness_24h": _estimate_readiness_24h(student_id, db),
    }


# ── GET /students/me/next-action ─────────────────────────────────────────────────

@router.get("/students/me/next-action", response_model=NextBestActionResponse)
async def get_next_best_action(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    context = _build_student_context(current_user.id, db)
    try:
        return await _call_ai_pipeline(context, current_user.id, db)
    except Exception:
        return _build_next_best_action(current_user.id, db)


# ── GET /students/me/history ─────────────────────────────────────────────────

@router.get("/students/me/history", response_model=List[SessionHistoryItem])
def get_session_history(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(PerformanceSession, Lecture)
        .join(Lecture, PerformanceSession.document_id == Lecture.id)
        .filter(
            PerformanceSession.student_id == current_user.id,
            PerformanceSession.completed_at.isnot(None),
        )
        .order_by(PerformanceSession.completed_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return [
        SessionHistoryItem(
            session_id=s.id,
            document_name=l.title,
            mode=s.mode,
            correct=s.correct_count or 0,
            total=s.total_questions or 0,
            readiness_score=s.readiness_score,
            duration_seconds=s.duration_seconds,
            completed_at=s.completed_at,
        )
        for s, l in rows
    ]


# ── GET /questions/{document_id} ─────────────────────────────────────────────

@router.get("/questions/{document_id}")
def get_questions_for_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns all McqQuestion IDs + question text for a document.
    The frontend uses this to map question_text → UUID for performance tracking."""
    questions = db.query(McqQuestion).filter(
        McqQuestion.document_id == document_id
    ).all()
    return [{"id": q.id, "question_text": q.question_text} for q in questions]


# ── POST /questions/save ──────────────────────────────────────────────────────

@router.post("/questions/save", response_model=SaveQuestionsResponse)
def save_questions(
    body: SaveQuestionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = db.query(Lecture).filter(Lecture.id == body.document_id).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Document not found")

    # Load existing question texts for this document (deduplication key)
    existing = db.query(McqQuestion).filter(
        McqQuestion.document_id == body.document_id
    ).all()
    existing_texts = {q.question_text for q in existing}

    valid_modes = {"highyield", "exam", "revision"}
    mode = body.mode if body.mode in valid_modes else "highyield"

    saved: list[McqQuestion] = []

    for mcq in body.mcqs:
        # Support both dict and Pydantic-like objects
        if hasattr(mcq, "__dict__"):
            mcq = mcq.__dict__

        # Question text — field name varies
        q_text = mcq.get("question") or mcq.get("question_text") or ""
        if not q_text or q_text in existing_texts:
            continue

        # options can be List[str] (ai_service format) or dict {A:..., B:...}
        options = mcq.get("options", [])
        if isinstance(options, list):
            opt_a = options[0] if len(options) > 0 else ""
            opt_b = options[1] if len(options) > 1 else ""
            opt_c = options[2] if len(options) > 2 else ""
            opt_d = options[3] if len(options) > 3 else ""
        elif isinstance(options, dict):
            opt_a = options.get("A") or options.get("a", "")
            opt_b = options.get("B") or options.get("b", "")
            opt_c = options.get("C") or options.get("c", "")
            opt_d = options.get("D") or options.get("d", "")
        else:
            opt_a = mcq.get("option_a", "")
            opt_b = mcq.get("option_b", "")
            opt_c = mcq.get("option_c", "")
            opt_d = mcq.get("option_d", "")

        correct = mcq.get("answer") or mcq.get("correct_answer") or "A"
        correct = correct.upper() if correct else "A"

        diff_type = mcq.get("difficulty_type", "recall")
        if diff_type not in {"recall", "application", "analysis"}:
            diff_type = "recall"

        q = McqQuestion(
            id=str(uuid4()),
            document_id=body.document_id,
            topic=mcq.get("topic") or "General",
            question_text=q_text,
            option_a=opt_a,
            option_b=opt_b,
            option_c=opt_c,
            option_d=opt_d,
            correct_answer=correct,
            explanation=mcq.get("explanation") or "",
            mode=mode,
            difficulty_type=diff_type,
        )
        db.add(q)
        existing_texts.add(q_text)
        saved.append(q)

    db.commit()

    return SaveQuestionsResponse(
        saved_count=len(saved),
        question_ids=[q.id for q in saved],
    )


# ── GET /weekly-quiz/pending ──────────────────────────────────────────────────

@router.get("/weekly-quiz/pending", response_model=WeeklyQuizResponse)
def get_pending_weekly_quiz(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    week_start = datetime.utcnow().date() - timedelta(days=datetime.utcnow().weekday())

    assignment = db.query(WeeklyQuizAssignment).filter(
        WeeklyQuizAssignment.student_id == current_user.id,
        WeeklyQuizAssignment.week_start == week_start,
        WeeklyQuizAssignment.status == "pending",
    ).first()

    if not assignment:
        # Try to generate one from flagged weak topics
        weak_rows = db.query(WeakPoint.topic).filter(
            WeakPoint.student_id == current_user.id,
            WeakPoint.flagged_as_weak == True,
        ).all()

        if not weak_rows:
            return WeeklyQuizResponse(assignment_id=None)

        topic_list = [row[0] for row in weak_rows]
        questions = (
            db.query(McqQuestion)
            .filter(McqQuestion.topic.in_(topic_list))
            .order_by(func.random())
            .limit(10)
            .all()
        )

        if not questions:
            return WeeklyQuizResponse(assignment_id=None)

        assignment = WeeklyQuizAssignment(
            id=str(uuid4()),
            student_id=current_user.id,
            week_start=week_start,
            question_ids=[str(q.id) for q in questions],
            status="pending",
        )
        db.add(assignment)
        db.commit()
        db.refresh(assignment)
    else:
        # Load questions listed in the existing assignment
        qids = assignment.question_ids or []
        questions = db.query(McqQuestion).filter(McqQuestion.id.in_(qids)).all()

    weak_topics = [
        row[0]
        for row in db.query(WeakPoint.topic).filter(
            WeakPoint.student_id == current_user.id,
            WeakPoint.flagged_as_weak == True,
        ).all()
    ]

    return WeeklyQuizResponse(
        assignment_id=assignment.id,
        questions=[
            McqQuestionOut(
                id=q.id,
                topic=q.topic,
                question_text=q.question_text,
                option_a=q.option_a,
                option_b=q.option_b,
                option_c=q.option_c,
                option_d=q.option_d,
                correct_answer=q.correct_answer,
                explanation=q.explanation,
                mode=q.mode,
                difficulty_type=q.difficulty_type,
            )
            for q in questions
        ],
        weak_topics=weak_topics,
    )


# ── POST /weekly-quiz/{assignment_id}/dismiss ─────────────────────────────────

@router.post("/weekly-quiz/{assignment_id}/dismiss")
def dismiss_weekly_quiz(
    assignment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = db.query(WeeklyQuizAssignment).filter(
        WeeklyQuizAssignment.id == assignment_id,
        WeeklyQuizAssignment.student_id == current_user.id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    assignment.status = "dismissed"
    db.commit()
    return {"status": "dismissed"}


# ── GET /sessions/{session_id}/next-question ──────────────────────────────────

@router.get("/sessions/{session_id}/next-question")
def get_next_question(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Adaptive question selection.
    Prioritizes dangerous misconception topics (+15), weak topics (+10),
    co-failure topics (+5), and analysis questions (+2).
    """
    session = db.query(PerformanceSession).filter(
        PerformanceSession.id == session_id,
        PerformanceSession.student_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    answered_ids = {
        row[0] for row in db.query(QuestionAttempt.question_id)
        .filter(QuestionAttempt.session_id == session_id)
        .all()
    }

    available = db.query(McqQuestion).filter(
        McqQuestion.document_id == session.document_id,
        ~McqQuestion.id.in_(answered_ids) if answered_ids else True,
    ).all()

    if not available:
        return {"question": None, "reason": "session_complete"}

    # Build priority sets
    weak_topics = {
        row[0] for row in db.query(WeakPoint.topic).filter(
            WeakPoint.student_id == current_user.id,
            WeakPoint.flagged_as_weak == True,
        ).all()
    }

    dangerous_topics = {
        row[0] for row in db.query(WeakPoint.topic).filter(
            WeakPoint.student_id == current_user.id,
            WeakPoint.dangerous_misconception == True,
        ).all()
    }

    co_failure_topics = set()
    if weak_topics:
        co_rows = db.query(TopicCoFailure).filter(
            TopicCoFailure.student_id == current_user.id,
            TopicCoFailure.co_failure_count >= 2,
        ).filter(
            (TopicCoFailure.topic_a.in_(weak_topics)) |
            (TopicCoFailure.topic_b.in_(weak_topics))
        ).all()
        for cf in co_rows:
            co_failure_topics.add(cf.topic_a)
            co_failure_topics.add(cf.topic_b)

    def score_question(q: McqQuestion) -> float:
        score = 0.0
        if q.topic in dangerous_topics:
            score += 15.0   # highest priority — misconception must be corrected
        elif q.topic in weak_topics:
            score += 10.0
        elif q.topic in co_failure_topics:
            score += 5.0
        if q.difficulty_type == "analysis":
            score += 2.0
        elif q.difficulty_type == "application":
            score += 1.0
        # Small noise to prevent deterministic ordering
        score += random.uniform(0, 0.5)
        return score

    best = max(available, key=score_question)

    reason = "standard"
    if best.topic in dangerous_topics:
        reason = "dangerous_misconception"
    elif best.topic in weak_topics:
        reason = "weak_topic"
    elif best.topic in co_failure_topics:
        reason = "co_failure_topic"

    return {
        "question": {
            "id": best.id,
            "topic": best.topic,
            "question_text": best.question_text,
            "option_a": best.option_a,
            "option_b": best.option_b,
            "option_c": best.option_c,
            "option_d": best.option_d,
            "correct_answer": best.correct_answer,
            "explanation": best.explanation,
            "mode": best.mode,
            "difficulty_type": best.difficulty_type,
        },
        "reason": reason,
    }


# ── Config ────────────────────────────────────────────────────────────────────
INSIGHT_STALE_AFTER_N_ANSWERS = 10   # put this in settings if you prefer

# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/students/me/ai-insight")
async def get_ai_insight(
    background_tasks: BackgroundTasks,
    force: bool = Query(False, description="Force regeneration even if fresh"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns the current AI insight for this student.

    Strategy:
    - If no insight exists → generate now (blocking, first-time only).
    - If stale (10+ new answers) OR force=true → return cached immediately,
      kick off regeneration in the background so next request gets fresh data.
    - If fresh → return cached immediately.

    Response always includes metadata so the frontend knows what it's showing.
    """
    total_answered = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == current_user.id
    ).count()

    current_insight = (
        db.query(StudentAiInsight)
        .filter(
            StudentAiInsight.student_id == current_user.id,
            StudentAiInsight.is_current == True,
        )
        .order_by(StudentAiInsight.generated_at.desc())
        .first()
    )

    answers_since_generation = (
        total_answered - (current_insight.questions_answered_at_generation or 0)
        if current_insight else total_answered
    )
    is_stale = answers_since_generation >= INSIGHT_STALE_AFTER_N_ANSWERS or force

    # ── First ever insight: block and generate now ────────────────────────────
    if current_insight is None:
        if total_answered == 0:
            # No data at all — return a sensible empty state, don't waste an API call
            return {
                "status": "no_data",
                "message": "Complete at least one practice session to unlock your AI insight.",
                "insight": None,
                "meta": {
                    "generated_at": None,
                    "answers_since_generation": 0,
                    "is_stale": False,
                    "is_fresh": False,
                },
            }

        insight_data = await _generate_and_persist_insight(
            student_id=current_user.id,
            total_answered=total_answered,
            trigger="first_time",
            current_insight=None,
            db=db,
        )
        return {
            "status": "generated",
            "insight": insight_data,
            "meta": {
                "generated_at": datetime.utcnow().isoformat(),
                "answers_since_generation": 0,
                "is_stale": False,
                "is_fresh": True,
            },
        }

    # ── Stale: return cached now, regenerate in background ───────────────────
    if is_stale:
        background_tasks.add_task(
            _background_regenerate_insight,
            student_id=current_user.id,
            total_answered=total_answered,
            old_insight_id=current_insight.id,
            trigger="background_stale" if not force else "forced",
        )
        return {
            "status": "stale",  # frontend can show a "Refreshing..." badge
            "insight": current_insight.insight_json,
            "meta": {
                "generated_at": current_insight.generated_at.isoformat(),
                "answers_since_generation": answers_since_generation,
                "is_stale": True,
                "is_fresh": False,
            },
        }

    # ── Fresh: return immediately ─────────────────────────────────────────────
    return {
        "status": "fresh",
        "insight": current_insight.insight_json,
        "meta": {
            "generated_at": current_insight.generated_at.isoformat(),
            "answers_since_generation": answers_since_generation,
            "is_stale": False,
            "is_fresh": True,
        },
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _generate_and_persist_insight(
    student_id: int,
    total_answered: int,
    trigger: str,
    current_insight,   # the old StudentAiInsight row or None
    db: Session,
) -> dict:
    """Calls the AI, persists the result, flips is_current. Returns the insight dict."""
    context = _build_student_context(student_id, db)
    insight_data = await _call_ai_for_insight(context)

    if current_insight:
        current_insight.is_current = False

    new_insight = StudentAiInsight(
        id=str(uuid4()),
        student_id=student_id,
        insight_json=insight_data,
        generated_at=datetime.utcnow(),
        trigger=trigger,
        questions_answered_at_generation=total_answered,
        is_current=True,
    )
    db.add(new_insight)
    db.commit()
    return insight_data


async def _background_regenerate_insight(
    student_id: int,
    total_answered: int,
    old_insight_id: str,
    trigger: str,
) -> None:
    """
    Runs in the background after a stale response is already returned.
    Opens its own DB session so it doesn't conflict with the closed request session.
    """
    from app.db.database import SessionLocal   # local import to avoid circular

    db = SessionLocal()
    try:
        old_insight = db.query(StudentAiInsight).filter(
            StudentAiInsight.id == old_insight_id
        ).first()
        await _generate_and_persist_insight(
            student_id=student_id,
            total_answered=total_answered,
            trigger=trigger,
            current_insight=old_insight,
            db=db,
        )
    except Exception:
        pass   # background task — never crash the app; log here if you have a logger
    finally:
        db.close()


# ── AI call ───────────────────────────────────────────────────────────────────

async def _call_ai_for_insight(context: dict) -> dict:
    """
    Calls the AI with the full student context and returns a structured insight dict.
    Falls back gracefully on any failure — never raises.
    """

    # ── Pull key signals for the system prompt summary ────────────────────────
    total_q        = context.get("total_questions_answered", 0)
    weak_topics    = context.get("weak_topics", [])
    dangerous      = [t["topic"] for t in weak_topics if t.get("dangerous_misconception")]
    overconf_rate  = context.get("calibration", {}).get("overconfidence_rate")
    co_failures    = context.get("co_failure_pairs", [])
    recent         = context.get("recent_sessions", [])
    last_readiness = recent[0].get("readiness_score") if recent else None
    decaying_topics = [
        t["topic"] for t in weak_topics
        if t.get("decay_rate_days") and t.get("last_attempted_days_ago")
        and t["last_attempted_days_ago"] > t["decay_rate_days"]
    ]

    system_prompt = f"""You are CortexQ — an adaptive AI learning coach for medical students.
You receive complete performance data for one student and return a structured insight report.

Be precise, specific, and direct. Use actual topic names. Never give generic study advice.

STUDENT SIGNALS (pre-computed for you):
- Total questions answered: {total_q}
- Dangerous misconceptions: {dangerous or "none"}
- Overconfidence rate: {f"{overconf_rate:.0%}" if overconf_rate is not None else "unknown"}
- Decaying topics (overdue for review): {decaying_topics or "none"}
- Co-failing topic pairs: {[(p["topic_a"], p["topic_b"]) for p in co_failures] or "none"}
- Last readiness score: {f"{last_readiness:.1f}%" if last_readiness else "unknown"}

PRIORITY ORDER for next_topic_to_study (top takes precedence):
1. Any topic with dangerous_misconception=true → must be addressed first, always
2. Confirmed weak topics (≥3 attempts, <60% accuracy) — real, verified gaps
3. Co-failing pairs — recommend the one that unlocks the other
4. Decaying topics — overdue for spaced review

RULES:
1. If dangerous_misconception is true → intervention_type MUST be "misconception_correction"
2. If overconfidence_rate > 0.3 → behavioral_warning MUST name this pattern explicitly
3. If any topic's last_attempted_days_ago > decay_rate_days → include it in the daily plan
4. daily_plan must cover 3 days with specific topic names and concrete question counts
5. predicted_readiness_7d must be a float, not null — estimate from the trend data
6. personalized_message must START WITH AN ACTION, not an observation.
   BAD: "You are struggling with X." GOOD: "Prioritize X this week — it's your biggest verified gap."
7. Never use: "based on your data", "you have demonstrated", "you failed", "Let's review"
8. Return ONLY valid JSON. No markdown. No explanation outside the object."""

    user_prompt = f"""FULL STUDENT DATA:
{json.dumps(context, indent=2)}

Return a JSON object with EXACTLY these fields:
{{
  "next_topic_to_study":      "string — the single most important topic right now and exactly why",
  "intervention_type":        "one of: explanation | easier_questions | harder_questions | spaced_review | misconception_correction | confidence_building",
  "personalized_message":     "string — one sentence shown directly to the student, honest and specific",
  "predicted_readiness_7d":   float between 0 and 100,
  "critical_insight":         "string — one pattern in their data they likely haven't noticed themselves",
  "daily_plan": [
    {{"day": 1, "focus": "specific topic name", "question_count": int, "priority": "critical|high|medium"}},
    {{"day": 2, "focus": "specific topic name", "question_count": int, "priority": "critical|high|medium"}},
    {{"day": 3, "focus": "specific topic name", "question_count": int, "priority": "critical|high|medium"}}
  ],
  "behavioral_warning":       "string — only if overconfidence_rate > 0.3 or a dangerous pattern exists, else null",
  "strongest_topic":          "string — the topic they're genuinely good at, from the data",
  "decay_alert":              "string — name the most overdue topic and days since review, else null",
  "urgency_level":            "one of: routine | elevated | critical"
}}"""

    insight_model = getattr(settings, "AI_MODEL", "llama-3.3-70b-versatile")

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": insight_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_prompt},
                    ],
                    "temperature": 0.25,   # lower than chat — we want consistency
                    "max_tokens": 1500,
                },
            )

            if resp.status_code == 429:
                raise httpx.HTTPStatusError("rate_limited", request=resp.request, response=resp)

            resp.raise_for_status()

            raw = resp.json()["choices"][0]["message"]["content"]
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()

            parsed = json.loads(raw)

            # Validate + fill required keys defensively
            required_keys = {
                "next_topic_to_study", "intervention_type", "personalized_message",
                "predicted_readiness_7d", "critical_insight", "daily_plan",
                "behavioral_warning", "strongest_topic", "decay_alert", "urgency_level",
            }
            for key in required_keys:
                parsed.setdefault(key, None)

            valid_interventions = {
                "explanation", "easier_questions", "harder_questions",
                "spaced_review", "misconception_correction", "confidence_building",
            }
            if parsed.get("intervention_type") not in valid_interventions:
                parsed["intervention_type"] = "spaced_review"

            if parsed.get("urgency_level") not in {"routine", "elevated", "critical"}:
                parsed["urgency_level"] = "routine"

            if not isinstance(parsed.get("daily_plan"), list):
                parsed["daily_plan"] = []

            return parsed

    except json.JSONDecodeError:
        return _insight_fallback("parse_error")
    except httpx.HTTPStatusError as e:
        reason = "rate_limited" if e.response.status_code == 429 else "api_error"
        return _insight_fallback(reason)
    except httpx.TimeoutException:
        return _insight_fallback("timeout")
    except Exception:
        return _insight_fallback("unknown")


def _insight_fallback(reason: str = "unknown") -> dict:
    messages = {
        "rate_limited": "Insight generation rate-limited — try again in a moment.",
        "timeout":      "AI took too long to respond. Your cached insight is still valid.",
        "parse_error":  "Received a response but couldn't parse it. Try refreshing.",
        "api_error":    "API error during insight generation.",
        "unknown":      "Something went wrong during insight generation.",
    }
    return {
        "next_topic_to_study":   "Continue with your lowest-accuracy topic",
        "intervention_type":     "spaced_review",
        "personalized_message":  messages.get(reason, "Insight temporarily unavailable."),
        "predicted_readiness_7d": None,
        "critical_insight":       None,
        "daily_plan":             [],
        "behavioral_warning":     None,
        "strongest_topic":        None,
        "decay_alert":            None,
        "urgency_level":          "routine",
    }

# ── AI chat helper ─────────────────────────────────────────────────────────────

async def _call_ai_for_chat(
    context: dict,
    user_message: str,
    conversation_history: list[dict] | None = None,
) -> dict:
    """
    AI coaching chat. Supports multi-turn history.
    conversation_history: list of {"role": "user"|"assistant", "content": "..."}
    """

    # ── Build a compact, readable context for the AI ─────────────────────────
    weak_topics_data = context.get("weak_topics", [])

    # Only flag topics with ≥3 attempts as genuinely weak — fewer attempts = still gathering data
    confirmed_weak  = [t for t in weak_topics_data if t.get("total_attempts", 0) >= 3 and t.get("accuracy", 1.0) < 0.6]
    early_data      = [t for t in weak_topics_data if t.get("total_attempts", 0) < 3]
    dangerous       = [t for t in weak_topics_data if t.get("dangerous_misconception")]
    co_pairs        = [(p["topic_a"], p["topic_b"]) for p in context.get("co_failure_pairs", [])]
    overconf        = context.get("calibration", {}).get("overconfidence_rate")
    overconf_str    = f"{overconf:.0%}" if isinstance(overconf, float) else "unknown"
    total_q         = context.get("total_questions_answered", 0)

    # Compact topic summary (avoid dumping huge JSON)
    topic_lines = []
    for t in weak_topics_data[:8]:
        attempts = t.get("total_attempts", 0)
        acc = t.get("accuracy", 0)
        flag = " ⚠ MISCONCEPTION" if t.get("dangerous_misconception") else ""
        reliability = "confirmed weak" if attempts >= 3 else f"only {attempts} attempt{'s' if attempts != 1 else ''} — too early to judge"
        topic_lines.append(f"  • {t['topic']}: {acc:.0%} accuracy, {attempts} attempts ({reliability}){flag}")

    topics_summary = "\n".join(topic_lines) if topic_lines else "  • No topic data yet"

    system_prompt = f"""You are CortexQ Coach — a sharp, direct tutor for medical students. Advise like a knowledgeable friend who already read the numbers, not like a report generator.

STUDENT SNAPSHOT:
- Total questions answered: {total_q}
- Topics attempted (sorted by accuracy):
{topics_summary}
- Dangerous misconceptions (certain + wrong): {[t["topic"] for t in dangerous] or "none"}
- Overconfidence rate: {overconf_str}
- Co-failing pairs (topics that tank together): {co_pairs or "none"}

━━━ PRIORITY ORDER — strictly top-to-bottom ━━━
1. DANGEROUS MISCONCEPTIONS → action="misconception_correction", urgency="critical"
   If any topic has a dangerous misconception, address it first. No exceptions.

2. CONFIRMED WEAK = {[t["topic"] for t in confirmed_weak] or "none"}
   ≥3 attempts + <60% accuracy. Real, verified gaps — recommend targeted practice.

3. CO-FAILING PAIRS = {co_pairs or "none"}
   If Topic A and B fail together, recommend A because "fixing A pulls up B too."
   Use the relationship explicitly — don't just list both topics separately.

4. EARLY DATA = {[t["topic"] for t in early_data[:4]] or "none"}
   Fewer than 3 attempts. DO NOT label these as weaknesses.
   Instead say: "quick check", "only N attempt(s) — worth a pass", "still too early to call."
   Only recommend these if tiers 1–3 are all empty.

━━━ RESPONSE RULES ━━━
• YOUR FIRST WORDS = the action. Not the observation.
  BAD: "You have 0% on X." → GOOD: "Hit X next — 0/1 so far and it drags Y down with it."
  BAD: "Your weakest topic is X." → GOOD: "Knock out X — confirmed weak at 40% over 5 tries."

• `response` = 1–2 sentences MAX. Short. Conversational. Like texting a smart friend.

• `next_step` = one concrete action with an exact number.
  e.g. "Do 10 questions on Antifungal Therapy. Aim for >60%."

• `encouraging_note` = honest, tied to their actual data. Zero generic filler.
  BAD: "Keep going, you've got this!" → GOOD: "Your Pharmacology accuracy has been climbing — that's real progress."

• `confidence_tip` = calibrated to their overconfidence rate of {overconf_str}.
  If >30%: name the pattern directly. If unknown: give a universal calibration tip.

BANNED PHRASES — must not appear anywhere in the output:
"based on your data", "your performance data", "you have demonstrated", "you have not demonstrated",
"you failed", "you struggled", "Let's review", "Let's focus", "Let's dive",
"It's normal", "Great question", "with focused effort", "you have a chance",
"keep it up", "keep going", "you're doing great", "identified as weak".

Return ONLY valid JSON. No markdown, no preamble, no explanation outside the object.

RESPONSE SCHEMA:
{{
  "response": "1-2 sentence recommendation — action-first, conversational tone",
  "action": "review_topic | practice_questions | misconception_correction | spaced_review | confidence_building | exam_strategy | off_topic",
  "topic_focus": "exact topic name from the data, or null",
  "next_step": "one concrete action with a number: e.g. 'Do 10 questions on X. Aim for >70%.'",
  "confidence_tip": "specific to their overconfidence rate of {overconf_str} — never generic",
  "urgency": "low | medium | high | critical",
  "encouraging_note": "one honest, specific sentence tied to actual data — no hollow filler"
}}"""

    # ── Build messages array ──────────────────────────────────────────────────
    messages = [{"role": "system", "content": system_prompt}]

    if conversation_history:
        # Trim to last 8 turns to stay within context limits
        messages.extend(conversation_history[-8:])

    messages.append({"role": "user", "content": user_message})

    # ── Call Groq ───────────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.CHAT_AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": getattr(settings, "CHAT_AI_MODEL", "llama-3.3-70b-versatile"),
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": 600,
                },
            )

            if resp.status_code == 429:
                raise httpx.HTTPStatusError("rate_limited", request=resp.request, response=resp)

            resp.raise_for_status()

            raw = resp.json()["choices"][0]["message"]["content"]
            
            # More aggressive cleaning
            # Strip thinking tags
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            # Strip markdown code blocks
            raw = re.sub(r"```(?:json)?", "", raw).strip()
            raw = raw.rstrip("```").strip()
            # Remove any leading/trailing whitespace
            raw = raw.strip()
            
            # Try to find JSON in the response if there's extra text
            json_match = re.search(r'\{.*\}(?=\s*$|\s*$)', raw, re.DOTALL)
            if json_match:
                raw = json_match.group(0)
            
            # Try to parse
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError as e:
                # If parsing fails, log and return structured fallback from raw text
                import logging
                logging.getLogger(__name__).warning(f"JSON parse error: {e}. Raw: {raw[:200]}")
                return _chat_fallback_from_text(raw)

            # Validate required keys exist; fill missing ones defensively
            required = ["response", "action", "topic_focus", "next_step", "confidence_tip", "urgency", "encouraging_note"]
            for key in required:
                if key not in parsed:
                    parsed[key] = None

            valid_actions = {"review_topic", "practice_questions", "misconception_correction",
                             "spaced_review", "confidence_building", "exam_strategy", "off_topic", "fallback"}
            if parsed.get("action") not in valid_actions:
                parsed["action"] = "review_topic"

            valid_urgency = {"low", "medium", "high", "critical"}
            if parsed.get("urgency") not in valid_urgency:
                parsed["urgency"] = "medium"
            
            # Ensure response is not empty
            if not parsed.get("response"):
                parsed["response"] = "Let's work on your weak topics. Check your weak points panel and pick the lowest-accuracy topic."

            return parsed

    except json.JSONDecodeError as e:
        import logging
        logging.getLogger(__name__).exception(f"JSON decode error in chat: {e}")
        return _chat_fallback(reason="parse_error")
    except httpx.HTTPStatusError as e:
        reason = "rate_limited" if e.response.status_code == 429 else "api_error"
        return _chat_fallback(reason=reason)
    except httpx.TimeoutException:
        return _chat_fallback(reason="timeout")
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("_call_ai_for_chat unexpected error: %s", e)
        return _chat_fallback(reason="unknown")


def _chat_fallback_from_text(raw_text: str) -> dict:
    """Fallback for non-JSON AI reply that is still actionable text."""
    text = (raw_text or "").strip()
    if not text:
        return _chat_fallback(reason="parse_error")

    action = "practice_questions" if re.search(r"\bpractice\b", text, re.I) else "review_topic"
    if re.search(r"\bmisconcept(ion|ions)?\b", text, re.I):
        action = "misconception_correction"

    topic_focus = None
    topic_match = re.search(r"\b(?:on|for)\s+([A-Za-z0-9 &\-]+?)(?:[\.,]|$)", text, re.I)
    if topic_match:
        topic_focus = topic_match.group(1).strip()

    next_step = text if len(text) <= 250 else text[:250].rstrip() + "..."

    # Detect urgency based on weakness signals in the text
    urgency = "medium"
    if action == "misconception_correction":
        urgency = "critical"
    elif re.search(r"confirmed weak", text, re.I):
        urgency = "high"
    elif re.search(r"overdue|decay|dangerous", text, re.I):
        urgency = "elevated"

    return {
        "response": text if len(text) <= 300 else text[:300].rstrip() + "...",
        "action": action,
        "topic_focus": topic_focus,
        "next_step": next_step,
        "confidence_tip": "Slow down on tough options: eliminate at least two wrong choices before committing.",
        "urgency": urgency,
        "encouraging_note": "Good signal: you got a clear instruction; follow it and request a new coach check after 10 questions.",
    }


def _chat_fallback(
    response: str = "I couldn't reach the AI engine right now.",
    reason: str = "unknown",
) -> dict:
    messages = {
        "rate_limited": "Too many requests — wait a moment and try again.",
        "timeout":      "The AI took too long to respond. Try a shorter question.",
        "parse_error":  "Got a response but couldn't read it. Try rephrasing.",
        "api_error":    "API error on our end. Use the next-action card for now.",
        "unknown":      "Something went wrong. Use the next-action card for now.",
    }
    return {
        "response":          messages.get(reason, response),
        "action":            "fallback",
        "topic_focus":       None,
        "next_step":         "Check your weak points panel and pick the lowest-accuracy topic.",
        "confidence_tip":    "When in doubt, eliminate options you're certain are wrong first.",
        "urgency":           "low",
        "encouraging_note":  "You're still here — that already puts you ahead.",
    }

# ── 2-Stage AI Pipeline: Analyzer → Humanizer ────────────────────────────────

async def _run_analyzer(context: dict) -> dict:
    """
    Stage 1 — CortexQ Analyzer.
    Cold, precise logic. Reads student profile, applies priority rules,
    returns a structured decision object. No human tone. No explanations.
    Uses ANALYZER_MODEL at temperature=0.1.
    """
    weak_topics = context.get("weak_topics", [])
    co_pairs = context.get("co_failure_pairs", [])
    overconf = context.get("calibration", {}).get("overconfidence_rate")
    recent = context.get("recent_sessions", [])

    confirmed_weak = [t for t in weak_topics if t.get("total_attempts", 0) >= 3 and t.get("accuracy", 1.0) < 0.6]
    dangerous = [t for t in weak_topics if t.get("dangerous_misconception")]
    early_data = [t for t in weak_topics if t.get("total_attempts", 0) < 3]

    system_prompt = """You are CortexQ Analyzer — a precision learning intelligence engine.

Your job is to analyze a student's performance data and produce a structured decision object.

You do NOT speak to the student.
You ONLY think, prioritize, and decide.

DECISION RULES (STRICT):

PRIORITY ORDER:
a) Dangerous misconceptions → ALWAYS highest priority
b) Confirmed weak topics (≥3 attempts AND accuracy <60%)
c) Co-failure amplification (topics that fail together)
d) Early data (<3 attempts) → ONLY if nothing else exists

SAMPLE SIZE:
<3 attempts = NOT reliable — NEVER treat as confirmed weakness

CO-FAILURE:
If A and B fail together → recommend A to improve B

OVERCONFIDENCE:
If overconfidence_rate > 0.3 → mark behavior_issue = true

OUTPUT FORMAT (STRICT JSON ONLY):
{
  "primary_topic": "string",
  "secondary_topic": "string or null",
  "reason_type": "misconception | weak_topic | co_failure | early_signal",
  "intervention": "misconception_correction | practice_questions | review | spaced_review",
  "question_count": integer (5-15),
  "target_accuracy": integer (60-85),
  "urgency": "low | medium | high | critical",
  "behavior_issue": true | false,
  "confidence_level": "low | medium | high"
}

IMPORTANT: NO explanations. NO human tone. ONLY structured decision. Be strict and consistent."""

    user_prompt = f"""STUDENT PROFILE:

Topics (sorted by accuracy):
{json.dumps([{"topic": t["topic"], "accuracy": t["accuracy"], "attempts": t["total_attempts"], "dangerous_misconception": t["dangerous_misconception"]} for t in weak_topics[:10]], indent=2)}

Confirmed weak topics (≥3 attempts, <60% accuracy):
{json.dumps([t["topic"] for t in confirmed_weak]) if confirmed_weak else "none"}

Dangerous misconceptions:
{json.dumps([t["topic"] for t in dangerous]) if dangerous else "none"}

Co-failure pairs:
{json.dumps([{"topic_a": p["topic_a"], "topic_b": p["topic_b"]} for p in co_pairs]) if co_pairs else "none"}

Early data topics (<3 attempts):
{json.dumps([t["topic"] for t in early_data[:5]]) if early_data else "none"}

Overconfidence rate: {f"{overconf:.0%}" if isinstance(overconf, float) else "unknown"}

Recent sessions: {len(recent)} sessions on record"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.CHAT_AI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": getattr(settings, "ANALYZER_MODEL", "llama-3.3-70b-versatile"),
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.1,
                "max_tokens": 500,
            },
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()
        return json.loads(raw)


async def _run_humanizer(decision: dict, context: dict) -> dict:
    """
    Stage 2 — CortexQ Humanizer.
    Takes the Analyzer's structured decision and converts it into a natural,
    conversational coaching message. 1-2 sentences. Action-first. Never robotic.
    Uses HUMANIZER_MODEL at temperature=0.7.
    """
    overconf = context.get("calibration", {}).get("overconfidence_rate")

    system_prompt = """You are CortexQ Coach — a sharp, human-like medical study coach.

Your job is to convert a structured AI decision into a natural, conversational coaching message.

YOUR JOB:
Turn the decision into a response that is:
- Natural (like a smart friend)
- Action-first (start with what to do)
- Short (1-2 sentences MAX)
- Specific (use real topic names + numbers)

RULES:
START WITH ACTION — e.g. "Hit Antifungal Therapy next — it's dragging down Cell Membrane questions."

HANDLE EARLY DATA:
If reason_type = "early_signal" → say "quick check" or "still early" — DO NOT say "you're weak"

CO-FAILURE:
If secondary_topic exists → mention it naturally: "because it's tied to X"

MISCONCEPTIONS → sound urgent and corrective

BEHAVIOR FIX:
If behavior_issue = true → add: "slow down before locking answers"

TONE: Confident but chill. No robotic phrasing. No generic motivation. No analysis explanation.

BANNED PHRASES: "based on your data", "you failed", "you struggled", "Let's review", "keep it up", "you're doing great"

OUTPUT FORMAT (STRICT JSON ONLY):
{
  "response": "1-2 sentence natural coaching message",
  "next_step": "Do X questions on Y. Aim for >Z%",
  "reason": "max 10 words",
  "urgency": "low | medium | high | critical",
  "confidence_tip": "only if behavior_issue = true, else null"
}

ONLY return JSON. No extra text. No explanations."""

    user_prompt = f"""Convert this decision into coaching:

{json.dumps(decision, indent=2)}

Student overconfidence rate: {f"{overconf:.0%}" if isinstance(overconf, float) else "unknown"}"""

    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.CHAT_AI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": getattr(settings, "HUMANIZER_MODEL", "llama-3.3-70b-versatile"),
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.7,
                "max_tokens": 300,
            },
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()
        return json.loads(raw)


async def _call_ai_pipeline(context: dict, student_id: int, db: Session) -> dict:
    """
    Orchestrates Stage 1 (Analyzer) → Stage 2 (Humanizer).
    Returns a dict compatible with NextBestActionResponse.
    Falls back to _build_next_best_action if either stage fails.
    """
    try:
        decision = await _run_analyzer(context)
    except Exception:
        return _build_next_best_action(student_id, db)

    if not decision or not decision.get("primary_topic"):
        return _build_next_best_action(student_id, db)

    try:
        coaching = await _run_humanizer(decision, context)
    except Exception:
        return _build_next_best_action(student_id, db)

    if not coaching or not coaching.get("response"):
        return _build_next_best_action(student_id, db)

    return {
        "action_type":             decision.get("intervention", "practice_questions"),
        "topic":                   decision.get("primary_topic"),
        "next_step":               coaching.get("next_step", f"Do {decision.get('question_count', 10)} questions on {decision.get('primary_topic')}. Aim for >{decision.get('target_accuracy', 70)}%."),
        "reason":                  [coaching.get("reason", decision.get("reason_type", ""))],
        "confidence_gap_alert":    bool(decision.get("behavior_issue", False)),
        "short_message":           coaching.get("response", ""),
        "predicted_readiness_24h": _estimate_readiness_24h(student_id, db),
        "urgency":                 coaching.get("urgency", decision.get("urgency", "medium")),
        "confidence_tip":          coaching.get("confidence_tip"),
        "secondary_topic":         decision.get("secondary_topic"),
    }


@router.post("/students/me/chat")
async def chat_with_coach(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    message = body.get("message")
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    history = body.get("conversation_history", [])

    context = _build_student_context(current_user.id, db)
    answer = await _call_ai_for_chat(context, message, conversation_history=history)

    # Attach real practice questions for the topic the coach recommends
    topic_focus = answer.get("topic_focus")
    if topic_focus:
        practice_qs = (
            db.query(McqQuestion)
            .filter(McqQuestion.topic == topic_focus)
            .limit(3)
            .all()
        )
        if practice_qs:
            answer["practice_questions"] = [
                {
                    "id": q.id,
                    "document_id": q.document_id,
                    "topic": q.topic,
                    "preview": (q.question_text[:100] + "…") if len(q.question_text) > 100 else q.question_text,
                }
                for q in practice_qs
            ]
            answer["practice_document_id"] = practice_qs[0].document_id

    return answer

# ── POST /students/me/exam-date ───────────────────────────────────────────────

@router.post("/students/me/exam-date")
def set_exam_date(
    exam_date: datetime,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Student sets their upcoming exam date.
    Stored in learning_patterns. Invalidates current AI insight
    so it regenerates with exam urgency context.
    """
    pattern = db.query(LearningPattern).filter(
        LearningPattern.student_id == current_user.id
    ).first()

    if not pattern:
        pattern = LearningPattern(
            id=str(uuid4()),
            student_id=current_user.id,
            exam_date=exam_date,
            computed_at=datetime.utcnow(),
        )
        db.add(pattern)

    # Invalidate current AI insight so it regenerates with exam urgency
    db.query(StudentAiInsight).filter(
        StudentAiInsight.student_id == current_user.id,
        StudentAiInsight.is_current == True,
    ).update({"is_current": False})

    db.commit()
    return {"status": "exam_date_set", "exam_date": exam_date}


# ── AI helpers ────────────────────────────────────────────────────────────────

def _build_student_context(student_id: int, db: Session) -> dict:
    """
    Builds the complete student profile sent to the AI.
    Rebuilt from the database on every call since LLMs have no persistent memory.
    """
    now = datetime.utcnow()
    cutoff_14d = now - timedelta(days=14)
    seven_days_ago = now.date() - timedelta(days=7)

    weak_points = db.query(WeakPoint).filter(
        WeakPoint.student_id == student_id,
    ).order_by(WeakPoint.accuracy_rate.asc()).all()

    recent_sessions = db.query(PerformanceSession).filter(
        PerformanceSession.student_id == student_id,
        PerformanceSession.completed_at.isnot(None),
    ).order_by(PerformanceSession.completed_at.desc()).limit(5).all()

    co_failures = db.query(TopicCoFailure).filter(
        TopicCoFailure.student_id == student_id,
        TopicCoFailure.co_failure_count >= 2,
    ).all()

    pattern = db.query(LearningPattern).filter(
        LearningPattern.student_id == student_id
    ).first()

    total_answered = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == student_id
    ).count()

    recent_attempts = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == student_id,
        QuestionAttempt.created_at >= cutoff_14d,
        QuestionAttempt.calibration_gap.isnot(None),
    ).all()

    certain_wrong = sum(1 for a in recent_attempts if a.calibration_gap == -2)
    guessing_right = sum(1 for a in recent_attempts if a.calibration_gap == 1)
    total_with_confidence = len(recent_attempts)

    return {
        "student_id": student_id,
        "total_questions_answered": total_answered,

        "weak_topics": [
            {
                "topic": wp.topic,
                "accuracy": round(wp.accuracy_rate or 0, 2),
                "total_attempts": wp.total_attempts,
                "consecutive_failures": wp.consecutive_failures,
                "most_common_wrong_answer": wp.most_common_wrong_answer,
                "dangerous_misconception": wp.dangerous_misconception,
                "times_mastered": wp.times_mastered or 0,
                "times_relapsed": wp.times_relapsed or 0,
                "decay_rate_days": wp.decay_rate,
                "last_attempted_days_ago": (
                    (now - wp.last_attempted_at).days
                    if wp.last_attempted_at else None
                ),
                "accuracy_trend": wp.accuracy_trend,
                "accuracy_7d_ago": wp.accuracy_7d_ago,
            }
            for wp in weak_points
        ],

        "co_failure_pairs": [
            {
                "topic_a": cf.topic_a,
                "topic_b": cf.topic_b,
                "co_failure_count": cf.co_failure_count,
            }
            for cf in co_failures
        ],

        "recent_sessions": [
            {
                "mode": s.mode,
                "correct": s.correct_count,
                "total": s.total_questions,
                "accuracy": round((s.correct_count or 0) / (s.total_questions or 1), 2),
                "readiness_score": s.readiness_score,
                "duration_minutes": round((s.duration_seconds or 0) / 60, 1),
                "device": s.device_type,
                "interruptions": s.interruptions,
                "rushed_count": s.rushed_count,
                "days_ago": (now - s.completed_at).days if s.completed_at else None,
            }
            for s in recent_sessions
        ],

        "calibration": {
            "total_with_confidence_data": total_with_confidence,
            "dangerous_overconfidence_count": certain_wrong,
            "overconfidence_rate": round(certain_wrong / total_with_confidence, 2) if total_with_confidence > 0 else None,
            "underconfidence_count": guessing_right,
            "underconfidence_rate": round(guessing_right / total_with_confidence, 2) if total_with_confidence > 0 else None,
        },

        "cognitive_profile": {
            "avg_sessions_per_week": pattern.avg_sessions_per_week if pattern else None,
            "preferred_time_of_day": pattern.preferred_time_of_day if pattern else None,
            "overconfidence_rate": pattern.overconfidence_rate if pattern else None,
            "answer_change_accuracy": pattern.answer_change_accuracy if pattern else None,
            "best_question_type": pattern.best_question_type if pattern else None,
            "worst_question_type": pattern.worst_question_type if pattern else None,
            "consistency_score": pattern.consistency_score if pattern else None,
            "mobile_accuracy": pattern.mobile_accuracy if pattern else None,
            "desktop_accuracy": pattern.desktop_accuracy if pattern else None,
            "avg_decay_days": pattern.avg_decay_days if pattern else None,
            "behavioral_flags": (
                pattern.behavioral_flags.split(",") if pattern and pattern.behavioral_flags else []
            ),
        },
    }


async def _call_ai_for_insight(context: dict) -> dict:
    """
    Calls the AI with the student context and returns structured insight.
    Uses Groq with the same API key as the rest of the app.
    """
    prompt = f"""You are an adaptive learning coach for a medical student.
You have complete data about this student's performance history.
Analyze it deeply and provide highly personalized recommendations.

STUDENT DATA:
{json.dumps(context, indent=2)}

Based on this data, return a JSON object with EXACTLY these fields:

{{
  "next_topic_to_study": "string — the single most important topic right now and exactly why",
  "intervention_type": "one of: explanation | easier_questions | harder_questions | spaced_review | misconception_correction | confidence_building",
  "personalized_message": "string — one sentence shown to the student, honest but encouraging",
  "predicted_readiness_7d": float between 0-100,
  "critical_insight": "string — one pattern in their data they probably don't know about themselves",
  "daily_plan": [
    {{"day": 1, "focus": "string", "question_count": int, "priority": "string"}},
    {{"day": 2, "focus": "string", "question_count": int, "priority": "string"}},
    {{"day": 3, "focus": "string", "question_count": int, "priority": "string"}}
  ],
  "behavioral_warning": "string or null — only if overconfidence_rate > 0.3 or other dangerous pattern",
  "strongest_topic": "string — what they're actually good at"
}}

Rules:
- If dangerous_misconception is true for any topic, intervention_type MUST be misconception_correction
- If overconfidence_rate > 0.3, behavioral_warning MUST call this out directly
- If any topic has decay_rate_days < 5 and last_attempted_days_ago > decay_rate_days, flag it as overdue
- Be specific — use actual topic names from the data, not generic advice
- Return ONLY valid JSON, no markdown, no explanation outside the JSON"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.AI_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 2000,
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            # Strip thinking tags and markdown fences
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()
            return json.loads(raw)
    except Exception:
        return {
            "next_topic_to_study": "Continue with your weakest topics",
            "intervention_type": "spaced_review",
            "personalized_message": "Keep going — consistency is the key.",
            "predicted_readiness_7d": None,
            "critical_insight": None,
            "daily_plan": [],
            "behavioral_warning": None,
            "strongest_topic": None,
        }