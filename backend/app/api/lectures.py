import os
import json
import time
import base64
import secrets
import shutil
import threading
import httpx
from pathlib import Path
from collections import defaultdict
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from sqlalchemy.orm import Session
from app.db.database import get_db
from datetime import datetime, timezone
from app.models.models import Lecture, Result, QuizSession
from app.schemas.lecture import LectureOut, ResultOut, ProcessStatus, ShareTokenOut, ViewersOut, SharedResultOut, QuizSessionOut, QuizSessionSave
from app.api.deps import get_current_user
from app.models.models import User
from app.services.pdf_service import extract_text_from_pdf
from app.services.ai_service import generate_study_content, _estimate_processing_time
from app.core.config import settings
from app.core.entitlements import (
    assert_can_upload,
    plan_tier,
    refund_credits,
    try_spend_credits,
    will_use_premium_for_mcq,
    is_premium,
)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB

class UploadTextRequest(BaseModel):
    text: str
    title: str = "Pasted content"

router = APIRouter(tags=["lectures"])

# In-memory active sessions: share_token -> {session_id: last_ping_time}
_active_sessions: dict = defaultdict(dict)
SESSION_TIMEOUT = 60  # seconds

# Tracks which token+session pairs have already been counted as a view
# so refreshes and strict-mode double-renders don't double-count
_counted_sessions: set = set()
_counted_sessions_lock = threading.Lock()

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB

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
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    content = await file.read()

    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    # Validate PDF magic bytes (%PDF-)
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="File is not a valid PDF")

    assert_can_upload(db, current_user)

    from app.core.entitlements import upload_limit_for_user, count_uploads_this_month, plan_tier
    if plan_tier(current_user) == "free":
        n = count_uploads_this_month(db, current_user.id)
        if n >= upload_limit_for_user(current_user):
            try_spend_credits(db, current_user, 1, commit=True)

    ensure_upload_dir()

    # Sanitize filename to prevent path traversal
    safe_basename = os.path.basename(file.filename or "upload.pdf")
    safe_name = f"{current_user.id}_{safe_basename}"
    upload_dir = os.path.normpath(settings.UPLOAD_DIR)
    file_path = os.path.normpath(os.path.join(upload_dir, safe_name))
    if not file_path.startswith(upload_dir):
        raise HTTPException(status_code=400, detail="Invalid filename")

    with open(file_path, "wb") as f:
        f.write(content)

    # Try to extract text to validate it's a real PDF
    try:
        extract_text_from_pdf(file_path)
    except Exception as e:
        os.remove(file_path)
        raise HTTPException(status_code=400, detail="Could not read PDF. Ensure the file is not corrupted or password-protected.")

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

@router.post("/upload-text", response_model=LectureOut)
async def upload_text(
    body: UploadTextRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Accept raw pasted text and store it as a lecture."""
    text = body.text.strip()
    if len(text) < 100:
        raise HTTPException(status_code=400, detail="Text is too short (minimum 100 characters)")
    if len(text) > 500_000:
        raise HTTPException(status_code=413, detail="Text is too long (max 500,000 characters)")

    assert_can_upload(db, current_user)

    from app.core.entitlements import upload_limit_for_user, count_uploads_this_month, plan_tier
    if plan_tier(current_user) == "free":
        n = count_uploads_this_month(db, current_user.id)
        if n >= upload_limit_for_user(current_user):
            try_spend_credits(db, current_user, 1, commit=True)

    ensure_upload_dir()
    safe_title = "".join(c for c in body.title if c.isalnum() or c in " _-")[:60].strip() or "pasted"
    file_name = f"{current_user.id}_{safe_title}.txt"
    upload_dir = os.path.normpath(settings.UPLOAD_DIR)
    file_path = os.path.normpath(os.path.join(upload_dir, file_name))
    if not file_path.startswith(upload_dir):
        raise HTTPException(status_code=400, detail="Invalid title")

    Path(file_path).write_text(text, encoding="utf-8")

    lecture = Lecture(
        user_id=current_user.id,
        title=body.title[:120],
        file_path=file_path,
        university=current_user.university,
        college=current_user.college,
        year_of_study=current_user.year_of_study,
        subject=current_user.subject,
        topic_area=body.title[:120],
    )
    db.add(lecture)
    db.commit()
    db.refresh(lecture)
    return lecture


@router.post("/extract-image-text")
async def extract_image_text(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Use a vision model to extract text from an uploaded image (camera capture or paste)."""
    content_type = file.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, or GIF images are supported")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    if not settings.CHAT_AI_API_KEY:
        raise HTTPException(status_code=503, detail="Vision AI is not configured")

    b64 = base64.b64encode(content).decode()
    data_url = f"data:{content_type};base64,{b64}"

    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.CHAT_AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": (
                                        "You are an academic content extractor. "
                                        "Extract ALL text from this image exactly as written — "
                                        "preserve headings, bullet points, numbered lists, and structure. "
                                        "Do not summarize, paraphrase, or add any commentary. "
                                        "Output only the extracted text, nothing else."
                                    ),
                                },
                                {"type": "image_url", "image_url": {"url": data_url}},
                            ],
                        }
                    ],
                    "temperature": 0.1,
                    "max_tokens": 4096,
                },
            )
            resp.raise_for_status()
            extracted = resp.json()["choices"][0]["message"]["content"].strip()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Vision model error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Vision model failed: {str(e)}")

    if not extracted or len(extracted) < 20:
        raise HTTPException(status_code=422, detail="Could not extract readable text from the image")

    return {"text": extracted}


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
    except Exception:
        raise HTTPException(status_code=422, detail="Could not extract text from the uploaded file")

    premium = will_use_premium_for_mcq(current_user)
    inter = (
        settings.PREMIUM_INTER_CHUNK_WAIT_SECONDS
        if premium
        else settings.FREE_INTER_CHUNK_WAIT_SECONDS
    )
    return _estimate_processing_time(
        text, mode, len(settings.get_all_api_keys()), inter_chunk_wait=inter
    )


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
    except Exception:
        raise HTTPException(status_code=422, detail="Could not extract text from the uploaded file")

    # Spend credits for premium MCQ generation; insufficient balance ⇒ free model (no spend)
    cost = settings.CREDIT_COST_MCQ_PROCESS
    spent = False
    use_premium = False
    
    if not current_user.extra_usage_enabled:
        # Toggle OFF: free usage with no credits spent
        use_premium = False
    elif plan_tier(current_user) in ("pro", "enterprise"):
        # Pro/enterprise: always use premium
        use_premium = True
    elif cost > 0:
        # Free tier with toggle ON: try to spend credits
        spent = try_spend_credits(db, current_user, cost, commit=True)
        use_premium = spent
    else:
        use_premium = is_premium(current_user)

    try:
        ai_data = await generate_study_content(text, mode=mode, is_premium=use_premium)
    except Exception as e:
        if spent and cost > 0:
            refund_credits(db, current_user, cost, commit=True)
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
        result.share_token = secrets.token_urlsafe(32)
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

    # Increment view_count only the first time this session is seen (thread-safe)
    with _counted_sessions_lock:
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
        session.updated_at = datetime.now(timezone.utc)
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
        session.updated_at = datetime.now(timezone.utc)
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
