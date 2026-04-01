import json
import random
import re
from uuid import uuid4
from datetime import datetime, timedelta
from typing import List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
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


# ── GET /students/me/ai-insight ───────────────────────────────────────────────

@router.get("/students/me/ai-insight")
async def get_ai_insight(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns the current AI insight for this student.
    Regenerates if stale (10+ new answers since last generation).
    """
    total_answered = db.query(QuestionAttempt).filter(
        QuestionAttempt.student_id == current_user.id
    ).count()

    current_insight = db.query(StudentAiInsight).filter(
        StudentAiInsight.student_id == current_user.id,
        StudentAiInsight.is_current == True,
    ).order_by(StudentAiInsight.generated_at.desc()).first()

    should_regenerate = (
        current_insight is None or
        (total_answered - current_insight.questions_answered_at_generation) >= 10
    )

    if should_regenerate:
        context = await _build_student_context(current_user.id, db)
        insight_data = await _call_ai_for_insight(context)

        if current_insight:
            current_insight.is_current = False

        new_insight = StudentAiInsight(
            id=str(uuid4()),
            student_id=current_user.id,
            insight_json=insight_data,
            generated_at=datetime.utcnow(),
            trigger="on_demand",
            questions_answered_at_generation=total_answered,
            is_current=True,
        )
        db.add(new_insight)
        db.commit()
        return insight_data

    return current_insight.insight_json


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

async def _build_student_context(student_id: int, db: Session) -> dict:
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
    Uses OpenRouter with the same API key as the rest of the app.
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
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.AI_API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://localhost",
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
