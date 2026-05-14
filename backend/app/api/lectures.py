import os
import json
import time
import base64
import secrets
import string as _string
import shutil
import threading
import logging
import httpx

logger = logging.getLogger(__name__)
from pathlib import Path
from collections import defaultdict
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from app.db.database import get_db, SessionLocal
from datetime import datetime, timezone
from app.models.models import Lecture, Result, QuizSession, ProcessingJob
from app.schemas.lecture import LectureOut, ResultOut, ProcessStatus, ShareTokenOut, ViewersOut, SharedResultOut, QuizSessionOut, QuizSessionSave, SolvedLectureOut, SolvedEssayOut, SolvedEssayQuestion, SolvedOut, SolvedMCQ
from app.api.deps import get_current_user
from app.models.models import User
from app.services.pdf_service import extract_text_from_pdf
from app.services.ai_service import generate_study_content, _estimate_processing_time
from app.services.generator import generate_essay_content, grade_essay_answer
from app.core.config import settings
from app.core.limiter import limiter
from app.core.entitlements import (
    assert_can_upload,
    plan_tier,
    refund_credits,
    try_spend_credits,
    will_use_premium_for_mcq,
    is_premium,
)


def _generate_job_id() -> str:
    """Generate an 11-character URL-safe job ID (YouTube-style)."""
    alphabet = _string.ascii_letters + _string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(11))


async def _run_processing_job(job_id: str, use_premium: bool, spent: bool, cost: int, focus_instruction: str = "") -> None:
    """
    Runs in the background after HTTP response is sent.
    Opens its own DB session — never reuses the request session.
    """
    from app.db.database import SessionLocal
    from app.models.models import ProcessingJob, Lecture, Result, User
    from app.services.pdf_service import extract_text_from_pdf
    from app.services.ai_service import generate_study_content
    from app.services.generator import generate_essay_content
    from app.core.entitlements import refund_credits
    from app.core.config import settings
    import json
    from datetime import datetime, timezone

    db = SessionLocal()
    try:
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
        if not job:
            return

        now = datetime.now(timezone.utc)
        job.status = "processing"
        job.started_at = now
        job.progress_pct = 5
        job.progress_label = "Reading your PDF..."
        db.commit()

        lecture = db.query(Lecture).filter(Lecture.id == job.lecture_id).first()
        if not lecture:
            job.status = "failed"
            job.error_message = "Lecture not found"
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        try:
            text = extract_text_from_pdf(lecture.file_path)
        except Exception as e:
            if spent and cost > 0:
                user = db.query(User).filter(User.id == job.user_id).first()
                if user:
                    refund_credits(db, user, cost, commit=True)
            job.status = "failed"
            job.error_message = f"Could not read PDF: {str(e)}"
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        job.progress_pct = 15
        job.progress_label = "PDF read. Starting AI generation..."
        db.commit()

        context_dict = None
        if job.custom_context:
            try:
                context_dict = json.loads(job.custom_context)
            except Exception:
                pass

        is_essay_mode = job.mode in ("essay", "essay_custom")

        job.progress_pct = 20
        job.progress_label = "AI is generating your questions..."
        db.commit()

        try:
            if is_essay_mode:
                ai_data = await generate_essay_content(
                    text, is_premium=use_premium, custom_context=context_dict,
                )
                essay_data = ai_data
                mcq_data = {"mcqs": [], "summary": "", "key_concepts": []}
            else:
                ai_data = await generate_study_content(
                    text, mode=job.mode, is_premium=use_premium, custom_context=context_dict,
                    focus_instruction=focus_instruction,
                )
                mcq_data = ai_data
                # Also generate essay questions alongside MCQs
                try:
                    essay_data = await generate_essay_content(
                        text, is_premium=use_premium, custom_context=context_dict,
                    )
                except Exception as ese:
                    logger.warning("Essay generation failed (non-fatal): %s", ese)
                    essay_data = {"questions": [], "summary": "", "key_concepts": []}
        except Exception as e:
            if spent and cost > 0:
                user = db.query(User).filter(User.id == job.user_id).first()
                if user:
                    refund_credits(db, user, cost, commit=True)

            err_str = str(e)
            job.status = "failed"
            job.error_message = err_str if len(err_str) < 300 else err_str[:300]
            job.completed_at = datetime.now(timezone.utc)
            job.progress_pct = 0
            job.progress_label = "Generation failed"
            db.commit()
            return

        job.progress_pct = 85
        job.progress_label = "Saving your questions..."
        db.commit()

        saved_context = json.dumps(context_dict) if context_dict else None
        existing = db.query(Result).filter(Result.lecture_id == job.lecture_id).first()
        if existing:
            existing.summary = mcq_data.get("summary", "")
            existing.key_concepts = json.dumps(mcq_data.get("key_concepts", []))
            if is_essay_mode:
                existing.essays = json.dumps(essay_data.get("questions", []))
            else:
                existing.mcqs = json.dumps(mcq_data.get("mcqs", []))
                existing.essays = json.dumps(essay_data.get("questions", []))
            existing.custom_context = saved_context
            existing.mode = job.mode
            db.commit()
        else:
            result = Result(
                lecture_id=job.lecture_id,
                summary=mcq_data.get("summary", ""),
                key_concepts=json.dumps(mcq_data.get("key_concepts", [])),
                mcqs=json.dumps(mcq_data.get("mcqs", [])) if not is_essay_mode else "[]",
                essays=json.dumps(essay_data.get("questions", [])) if essay_data.get("questions") else None,
                custom_context=saved_context,
                mode=job.mode,
            )
            db.add(result)
            db.commit()

        ai_title = mcq_data.get("_meta", {}).get("ai_title", "") if not is_essay_mode else ""
        if ai_title:
            lecture.title = ai_title
            db.commit()

        job.status = "done"
        job.progress_pct = 100
        job.progress_label = "Done! Redirecting you..."
        job.completed_at = datetime.now(timezone.utc)
        db.commit()

    except Exception as e:
        try:
            job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
            if job and job.status not in ("done", "failed"):
                job.status = "failed"
                job.error_message = f"Unexpected error: {str(e)[:200]}"
                job.completed_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB

class UploadTextRequest(BaseModel):
    text: str
    title: str = "Pasted content"

class CustomContext(BaseModel):
    exam_type: str = "final"       # final|midterm|quiz|certification|entrance|oral|revision
    time_to_exam: str = "1week"    # today|3days|1week|1month
    prior_knowledge: str = "know_basics"  # first_time|know_basics|deep_review
    difficulty: str = "medium"     # easy|medium|hard|brutal
    mcq_count: int = 20            # 10–40
    weak_topics: str = ""

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
    upload_path = os.path.abspath(settings.UPLOAD_DIR)
    Path(upload_path).mkdir(parents=True, exist_ok=True)

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
    upload_dir = os.path.abspath(settings.UPLOAD_DIR)
    file_path = os.path.abspath(os.path.join(upload_dir, safe_name))
    if not file_path.startswith(upload_dir):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Validate file size before writing
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    with open(file_path, "wb") as f:
        bytes_written = f.write(content)
    
    # Verify file was written completely
    if bytes_written != len(content):
        try:
            os.remove(file_path)
        except:
            pass
        raise HTTPException(status_code=500, detail="Failed to write file completely")

    # Try to extract text to validate it's a real PDF
    try:
        extract_text_from_pdf(file_path)
    except Exception as e:
        try:
            os.remove(file_path)
        except:
            pass
        raise HTTPException(status_code=400, detail=f"Could not read PDF. Ensure the file is not corrupted or password-protected. Error: {str(e)[:100]}")

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
    upload_dir = os.path.abspath(settings.UPLOAD_DIR)
    file_path = os.path.abspath(os.path.join(upload_dir, file_name))
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
@limiter.limit("10/minute")
async def extract_image_text(
    request: Request,
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


@router.get("/files/{lecture_id}")
def get_lecture_file(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Serve the raw uploaded file (PDF or text) for in-browser viewing."""
    lecture = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if lecture.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your lecture")

    file_path = lecture.file_path
    
    # Normalize path (handle both forward and backward slashes)
    file_path = file_path.replace("\\", "/")
    
    # Convert to absolute path if stored as relative
    if not os.path.isabs(file_path):
        # Extract just the filename
        basename = os.path.basename(file_path)
        # Construct absolute path
        file_path = os.path.abspath(os.path.join(settings.UPLOAD_DIR, basename))
    else:
        # Normalize absolute paths to use consistent separators
        file_path = os.path.abspath(file_path)
    
    # Ensure file exists
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail=f"File not found")
    
    # Validate file is not empty
    file_size = os.path.getsize(file_path)
    if file_size == 0:
        raise HTTPException(status_code=400, detail="File is empty (0 bytes)")

    is_pdf = file_path.lower().endswith(".pdf")
    media_type = "application/pdf" if is_pdf else "text/plain; charset=utf-8"
    filename = os.path.basename(file_path)

    # Use StreamingResponse to reliably serve file content
    def file_iterator(file_path: str, chunk_size: int = 65536):
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    resp = StreamingResponse(
        file_iterator(file_path),
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Content-Length": str(file_size),
        }
    )
    return resp


@router.delete("/lectures/{lecture_id}")
def delete_lecture(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if lecture.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your lecture")

    file_path = lecture.file_path

    db.query(Result).filter(Result.lecture_id == lecture_id).delete()
    db.query(ProcessingJob).filter(ProcessingJob.lecture_id == lecture_id).delete()
    db.query(QuizSession).filter(QuizSession.lecture_id == lecture_id).delete()
    db.delete(lecture)
    db.commit()

    if file_path and os.path.isfile(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass

    return {"detail": "Lecture deleted"}


@router.get("/lectures", response_model=List[LectureOut])
def get_lectures(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lectures = db.query(Lecture).filter(Lecture.user_id == current_user.id).order_by(Lecture.created_at.desc()).all()
    lecture_ids = [l.id for l in lectures]
    results_map = {
        r.lecture_id: r
        for r in db.query(Result).filter(Result.lecture_id.in_(lecture_ids)).all()
    }
    active_jobs_map = {
        j.lecture_id: j.id
        for j in db.query(ProcessingJob)
            .filter(ProcessingJob.lecture_id.in_(lecture_ids), ProcessingJob.status.in_(["pending", "processing"]))
            .all()
    }
    out = []
    for lec in lectures:
        result = results_map.get(lec.id)
        d = LectureOut.model_validate(lec)
        d.is_processed = result is not None
        d.has_essays = bool(result and result.essays)
        d.pending_job_id = active_jobs_map.get(lec.id)
        out.append(d)
    return out

@router.get("/lectures/solved", response_model=List[SolvedLectureOut])
def get_solved_lectures(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lectures = db.query(Lecture).filter(Lecture.user_id == current_user.id).order_by(Lecture.created_at.desc()).all()
    results_map = {
        r.lecture_id: r
        for r in db.query(Result).filter(Result.lecture_id.in_([l.id for l in lectures])).all()
    }
    out = []
    for lec in lectures:
        result = results_map.get(lec.id)
        if not result:
            continue
        mcqs = json.loads(result.mcqs) if result.mcqs else []
        mcqs = mcqs or []
        has_essays = bool(result.essays)
        if not mcqs and not has_essays:
            continue
        out.append(SolvedLectureOut(
            id=lec.id,
            title=lec.title,
            created_at=lec.created_at,
            mcq_count=len(mcqs),
            has_essays=has_essays,
        ))
    return out

@router.get("/estimate/{lecture_id}")
async def estimate_lecture_processing(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    mode: str = Query("revision", pattern="^(revision|exam|harder|essay)$"),
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


@router.post("/process/{lecture_id}")
@limiter.limit("10/minute")
async def process_lecture(
    request: Request,
    lecture_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    mode: str = Query("revision", pattern="^(revision|exam|harder|custom|essay|essay_custom)$"),
    custom_context: Optional[CustomContext] = None,
    focus: str = Query("", max_length=300),
):
    """
    Creates a processing job and starts generation in the background.
    Returns immediately with job_id. Client redirects to /upload/{job_id}.
    """
    from app.models.models import ProcessingJob
    import json

    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id, Lecture.user_id == current_user.id
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    # Return existing active job to prevent duplicate submissions
    existing_active = db.query(ProcessingJob).filter(
        ProcessingJob.user_id == current_user.id,
        ProcessingJob.status.in_(["pending", "processing"]),
    ).order_by(ProcessingJob.created_at.desc()).first()

    if existing_active:
        return {
            "job_id": existing_active.id,
            "lecture_id": existing_active.lecture_id,
            "status": existing_active.status,
            "already_running": True,
        }

    cost = settings.CREDIT_COST_MCQ_PROCESS
    spent = False
    use_premium = False

    if not current_user.extra_usage_enabled:
        use_premium = False
    elif plan_tier(current_user) in ("pro", "enterprise"):
        use_premium = True
    elif cost > 0:
        spent = try_spend_credits(db, current_user, cost, commit=True)
        use_premium = spent
    else:
        use_premium = is_premium(current_user)

    try:
        from app.services.ai_service import _estimate_processing_time
        from app.services.pdf_service import extract_text_from_pdf
        text_preview = extract_text_from_pdf(lecture.file_path)
        inter = (
            settings.PREMIUM_INTER_CHUNK_WAIT_SECONDS
            if use_premium
            else settings.FREE_INTER_CHUNK_WAIT_SECONDS
        )
        estimate = _estimate_processing_time(
            text_preview, mode, len(settings.get_all_api_keys()), inter_chunk_wait=inter
        )
        estimated_seconds = estimate.get("estimated_seconds", 120)
        total_chunks = estimate.get("chunks", 1)
    except Exception:
        estimated_seconds = 120
        total_chunks = 1

    context_json = None
    if custom_context is not None:
        context_dict = custom_context.model_dump()
        context_dict["field_of_study"] = " ".join(filter(None, [
            current_user.college, current_user.subject,
        ])) or "General Studies"
        context_json = json.dumps(context_dict)

    job_id = _generate_job_id()
    job = ProcessingJob(
        id=job_id,
        user_id=current_user.id,
        lecture_id=lecture_id,
        mode=mode,
        status="pending",
        progress_pct=0,
        progress_label="Starting up...",
        estimated_seconds_remaining=estimated_seconds,
        total_chunks=total_chunks,
        completed_chunks=0,
        custom_context=context_json,
    )
    db.add(job)
    db.commit()

    background_tasks.add_task(_run_processing_job, job_id, use_premium, spent, cost, focus)

    return {
        "job_id": job_id,
        "lecture_id": lecture_id,
        "estimated_seconds": estimated_seconds,
        "status": "pending",
        "already_running": False,
    }

@router.get("/jobs/active/mine")
def get_my_active_job(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Called when the user lands on /upload to check if they have a running job.
    Returns null if none.
    """
    from app.models.models import ProcessingJob

    job = db.query(ProcessingJob).filter(
        ProcessingJob.user_id == current_user.id,
        ProcessingJob.status.in_(["pending", "processing"]),
    ).order_by(ProcessingJob.created_at.desc()).first()

    if not job:
        return {"active_job": None}

    return {
        "active_job": {
            "job_id": job.id,
            "lecture_id": job.lecture_id,
            "mode": job.mode,
            "status": job.status,
            "progress_pct": job.progress_pct,
            "progress_label": job.progress_label,
        }
    }


@router.get("/jobs/{job_id}")
def get_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Poll every 2s from /upload/{jobId} page."""
    from app.models.models import ProcessingJob
    from datetime import datetime, timezone

    job = db.query(ProcessingJob).filter(
        ProcessingJob.id == job_id,
        ProcessingJob.user_id == current_user.id,
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    elapsed_seconds = None
    if job.started_at:
        elapsed_seconds = int(
            (datetime.now(timezone.utc) - job.started_at.replace(tzinfo=timezone.utc)).total_seconds()
        )

    remaining = None
    if job.estimated_seconds_remaining and elapsed_seconds is not None:
        remaining = max(0, job.estimated_seconds_remaining - elapsed_seconds)

    return {
        "job_id": job.id,
        "lecture_id": job.lecture_id,
        "mode": job.mode,
        "status": job.status,
        "progress_pct": job.progress_pct,
        "progress_label": job.progress_label,
        "estimated_seconds_remaining": remaining,
        "elapsed_seconds": elapsed_seconds,
        "error_message": job.error_message if job.status == "failed" else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


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
        lecture_title=lecture.title,
        mode=result.mode,
        summary=result.summary,
        key_concepts=json.loads(result.key_concepts) if result.key_concepts else [],
        mcqs=json.loads(result.mcqs) if result.mcqs else [],
        has_essays=bool(result.essays),
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


class EssayGradeRequest(BaseModel):
    lecture_id: int
    question_index: int
    student_answer: str
    ideal_answer: str


@router.get("/essay-results/{lecture_id}")
def get_essay_results(
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
    if not result or not result.essays:
        raise HTTPException(status_code=404, detail="Essay results not found. Process the lecture in Essay Mode first.")

    questions = json.loads(result.essays)
    return {
        "id": result.id,
        "lecture_id": lecture_id,
        "questions": questions,
        "created_at": result.created_at,
    }


@router.get("/solved/{lecture_id}", response_model=SolvedOut)
def get_solved(
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
        raise HTTPException(status_code=404, detail="No study materials found. Process the lecture first.")

    mcqs = []
    raw_mcqs = json.loads(result.mcqs) if result.mcqs else []
    for q in (raw_mcqs or []):
        mcqs.append(SolvedMCQ(
            question=q.get("question", ""),
            options=q.get("options", []),
            answer=q.get("answer", ""),
            explanation=q.get("explanation"),
            topic=q.get("topic"),
        ))

    essays = []
    raw_essays = json.loads(result.essays) if result.essays else []
    for q in (raw_essays or []):
        essays.append(SolvedEssayQuestion(
            question=q.get("question", ""),
            ideal_answer=q.get("ideal_answer", ""),
            topic=q.get("topic"),
            max_score=q.get("max_score", 100),
        ))

    if not mcqs and not essays:
        raise HTTPException(status_code=404, detail="No study materials found for this lecture.")

    return SolvedOut(
        lecture_id=lecture_id,
        lecture_title=lecture.title,
        created_at=result.created_at,
        mcqs=mcqs,
        essays=essays,
    )


@router.post("/essay/grade")
@limiter.limit("20/minute")
async def grade_essay(
    request: Request,
    body: EssayGradeRequest,
    current_user: User = Depends(get_current_user),
):
    if not body.student_answer.strip():
        raise HTTPException(status_code=400, detail="Student answer cannot be empty")
    if len(body.student_answer) > 10_000:
        raise HTTPException(status_code=400, detail="Answer too long (max 10,000 characters)")

    try:
        result = await grade_essay_answer(
            question=f"Question index {body.question_index}",
            ideal_answer=body.ideal_answer,
            student_answer=body.student_answer,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Grading failed: {str(e)}")

    return result


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
