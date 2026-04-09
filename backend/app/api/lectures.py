import os
import json
import time
import secrets
import shutil
from pathlib import Path
from collections import defaultdict
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from sqlalchemy.orm import Session
from app.db.database import get_db
from datetime import datetime
from app.models.models import Lecture, Result, QuizSession
from app.schemas.lecture import LectureOut, ResultOut, ProcessStatus, ShareTokenOut, ViewersOut, SharedResultOut, QuizSessionOut, QuizSessionSave
from app.api.deps import get_current_user
from app.models.models import User
from app.services.pdf_service import extract_text_from_pdf
from app.services.ai_service import generate_study_content, _estimate_processing_time
from app.core.config import settings

router = APIRouter(tags=["lectures"])

# In-memory active sessions: share_token -> {session_id: last_ping_time}
_active_sessions: dict = defaultdict(dict)
SESSION_TIMEOUT = 60  # seconds

# Tracks which token+session pairs have already been counted as a view
# so refreshes and strict-mode double-renders don't double-count
_counted_sessions: set = set()

def _cleanup_sessions(token: str):
    now = time.time()
    stale = [sid for sid, t in list(_active_sessions[token].items()) if now - t > SESSION_TIMEOUT]
    for sid in stale:
        del _active_sessions[token][sid]

def ensure_upload_dir():
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

@router.post("/upload", response_model=LectureOut)
async def upload_lecture(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    ensure_upload_dir()

    # Save file
    safe_name = f"{current_user.id}_{file.filename}"
    file_path = os.path.join(settings.UPLOAD_DIR, safe_name)

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Try to extract text to validate it's a real PDF
    try:
        extract_text_from_pdf(file_path)
    except Exception as e:
        os.remove(file_path)
        raise HTTPException(status_code=400, detail=str(e))

    # Save to DB — snapshot user profile onto the lecture at upload time
    lecture = Lecture(
        user_id=current_user.id,
        title=file.filename.replace(".pdf", ""),
        file_path=file_path,
        university=current_user.university,
        college=current_user.college,
        year_of_study=current_user.year_of_study,
        subject=current_user.subject,
        topic_area=file.filename.replace(".pdf", ""),  # seed from filename; overwritten after AI processing
    )
    db.add(lecture)
    db.commit()
    db.refresh(lecture)
    return lecture

@router.get("/lectures", response_model=List[LectureOut])
def get_lectures(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Lecture).filter(Lecture.user_id == current_user.id).order_by(Lecture.created_at.desc()).all()

@router.get("/estimate/{lecture_id}")
async def estimate_lecture_processing(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    mode: str = Query("highyield", pattern="^(highyield|exam|harder)$"),
):
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id, Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    try:
        text = extract_text_from_pdf(lecture.file_path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"PDF extraction failed: {str(e)}")

    return _estimate_processing_time(text, mode, len(settings.get_all_api_keys()))


@router.post("/process/{lecture_id}", response_model=ProcessStatus)
async def process_lecture(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    mode: str = Query("highyield", pattern="^(highyield|exam|harder)$"),
):
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id, Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    # Extract text
    try:
        text = extract_text_from_pdf(lecture.file_path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"PDF extraction failed: {str(e)}")

    # Call AI
    try:
        ai_data = await generate_study_content(text, mode=mode)
    except Exception as e:
        err_str = str(e)
        if "DAILY_LIMIT:" in err_str:
            raise HTTPException(
                status_code=429,
                detail=err_str.replace("DAILY_LIMIT: ", ""),
            )
        raise HTTPException(status_code=503, detail=f"AI processing failed: {err_str}")

    # Save or update result
    existing = db.query(Result).filter(Result.lecture_id == lecture_id).first()
    if existing:
        existing.summary = ai_data.get("summary", "")
        existing.key_concepts = json.dumps(ai_data.get("key_concepts", []))
        existing.mcqs = json.dumps(ai_data.get("mcqs", []))
        db.commit()
    else:
        result = Result(
            lecture_id=lecture_id,
            summary=ai_data.get("summary", ""),
            key_concepts=json.dumps(ai_data.get("key_concepts", [])),
            mcqs=json.dumps(ai_data.get("mcqs", [])),
        )
        db.add(result)
        db.commit()

    return ProcessStatus(
        status="success",
        message="Lecture processed successfully",
        lecture_id=lecture_id,
    )

@router.get("/results/{lecture_id}", response_model=ResultOut)
def get_results(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id, Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    result = db.query(Result).filter(Result.lecture_id == lecture_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Results not found. Process the lecture first.")

    return ResultOut(
        id=result.id,
        lecture_id=result.lecture_id,
        summary=result.summary,
        key_concepts=json.loads(result.key_concepts) if result.key_concepts else [],
        mcqs=json.loads(result.mcqs) if result.mcqs else [],
        created_at=result.created_at,
        share_token=result.share_token,
        view_count=result.view_count or 0,
    )


@router.post("/results/{lecture_id}/share", response_model=ShareTokenOut)
def create_share_link(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id, Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    result = db.query(Result).filter(Result.lecture_id == lecture_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="No results yet. Process the lecture first.")

    if not result.share_token:
        result.share_token = secrets.token_urlsafe(16)
        db.commit()
        db.refresh(result)

    return {"share_token": result.share_token}


@router.get("/shared/{token}", response_model=SharedResultOut)
def get_shared_result(token: str, db: Session = Depends(get_db)):
    result = db.query(Result).filter(Result.share_token == token).first()
    if not result:
        raise HTTPException(status_code=404, detail="Shared content not found or link is invalid")

    return SharedResultOut(
        lecture_id=result.lecture_id,
        lecture_title=result.lecture.title,
        summary=result.summary,
        key_concepts=json.loads(result.key_concepts) if result.key_concepts else [],
        mcqs=json.loads(result.mcqs) if result.mcqs else [],
        view_count=result.view_count,
    )


@router.post("/shared/{token}/ping")
def ping_shared_session(
    token: str,
    session_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    result = db.query(Result).filter(Result.share_token == token).first()
    if not result:
        raise HTTPException(status_code=404, detail="Not found")

    sid = session_id or secrets.token_hex(8)
    unique_key = f"{token}:{sid}"

    # Increment view_count only the first time this session is seen
    if unique_key not in _counted_sessions:
        _counted_sessions.add(unique_key)
        result.view_count = (result.view_count or 0) + 1
        db.commit()

    _active_sessions[token][sid] = time.time()
    _cleanup_sessions(token)

    return {
        "session_id": sid,
        "active_viewers": len(_active_sessions[token]),
        "view_count": result.view_count or 0,
    }


@router.get("/results/{lecture_id}/active-viewers", response_model=ViewersOut)
def get_active_viewers(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id, Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    result = db.query(Result).filter(Result.lecture_id == lecture_id).first()
    if not result or not result.share_token:
        return ViewersOut(view_count=0, active_viewers=0, share_token=None)

    token = result.share_token
    _cleanup_sessions(token)

    return ViewersOut(
        view_count=result.view_count or 0,
        active_viewers=len(_active_sessions[token]),
        share_token=token,
    )


@router.get("/sessions/{lecture_id}", response_model=QuizSessionOut)
def get_quiz_session(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(QuizSession).filter(
        QuizSession.user_id == current_user.id,
        QuizSession.lecture_id == lecture_id,
    ).first()
    if not session:
        return QuizSessionOut(answers={}, retake_count=0)
    return QuizSessionOut(
        answers=json.loads(session.answers) if session.answers else {},
        retake_count=session.retake_count or 0,
    )


@router.put("/sessions/{lecture_id}")
def save_quiz_session(
    lecture_id: int,
    data: QuizSessionSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(QuizSession).filter(
        QuizSession.user_id == current_user.id,
        QuizSession.lecture_id == lecture_id,
    ).first()
    if session:
        session.answers = json.dumps(data.answers)
        session.updated_at = datetime.utcnow()
    else:
        session = QuizSession(
            user_id=current_user.id,
            lecture_id=lecture_id,
            answers=json.dumps(data.answers),
            retake_count=0,
        )
        db.add(session)
    db.commit()
    return {"status": "saved"}


@router.post("/sessions/{lecture_id}/retake", response_model=QuizSessionOut)
def retake_quiz_session(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(QuizSession).filter(
        QuizSession.user_id == current_user.id,
        QuizSession.lecture_id == lecture_id,
    ).first()
    if session:
        session.retake_count = (session.retake_count or 0) + 1
        session.answers = json.dumps({})
        session.updated_at = datetime.utcnow()
        db.commit()
        return QuizSessionOut(answers={}, retake_count=session.retake_count)
    else:
        session = QuizSession(
            user_id=current_user.id,
            lecture_id=lecture_id,
            answers=json.dumps({}),
            retake_count=1,
        )
        db.add(session)
        db.commit()
        return QuizSessionOut(answers={}, retake_count=1)


@router.get("/stats")
def get_user_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total_lectures = db.query(Lecture).filter(Lecture.user_id == current_user.id).count()

    processed_lectures = (
        db.query(Result)
        .join(Lecture, Result.lecture_id == Lecture.id)
        .filter(Lecture.user_id == current_user.id)
        .count()
    )

    sessions = (
        db.query(QuizSession, Result)
        .join(Lecture, QuizSession.lecture_id == Lecture.id)
        .join(Result, Result.lecture_id == Lecture.id)
        .filter(QuizSession.user_id == current_user.id)
        .all()
    )

    total_answered = 0
    total_correct = 0
    for session, result in sessions:
        answers = json.loads(session.answers) if session.answers else {}
        mcqs = json.loads(result.mcqs) if result.mcqs else []
        total = len(mcqs)
        answered = len(answers)
        correct = sum(
            1 for idx_str, letter in answers.items()
            if (i := int(idx_str)) < total and mcqs[i].get("answer") == letter
        )
        total_answered += answered
        total_correct += correct

    avg_score = round(total_correct / total_answered * 100) if total_answered > 0 else 0

    return {
        "total_lectures": total_lectures,
        "processed_lectures": processed_lectures,
        "total_mcqs_answered": total_answered,
        "avg_score": avg_score,
    }


@router.get("/my-shared-sessions")
def get_my_shared_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all quiz sessions the user has on lectures they don't own (i.e. shared lectures)."""
    rows = (
        db.query(QuizSession, Lecture, Result)
        .join(Lecture, QuizSession.lecture_id == Lecture.id)
        .join(Result, Result.lecture_id == Lecture.id)
        .filter(QuizSession.user_id == current_user.id)
        .filter(Lecture.user_id != current_user.id)
        .filter(Result.share_token.isnot(None))
        .order_by(QuizSession.updated_at.desc())
        .all()
    )

    out = []
    for session, lecture, result in rows:
        answers = json.loads(session.answers) if session.answers else {}
        mcqs = json.loads(result.mcqs) if result.mcqs else []
        total = len(mcqs)
        answered = len(answers)
        correct = sum(
            1 for idx_str, letter in answers.items()
            if (i := int(idx_str)) < total and mcqs[i].get("answer") == letter
        )
        out.append({
            "lecture_id": lecture.id,
            "lecture_title": lecture.title,
            "share_token": result.share_token,
            "answered": answered,
            "total": total,
            "correct": correct,
            "retake_count": session.retake_count or 0,
            "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        })
    return out
