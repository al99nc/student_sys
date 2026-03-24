import os
import json
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from sqlalchemy.orm import Session
from typing import List
from app.db.database import get_db
from app.models.models import Lecture, Result
from app.schemas.lecture import LectureOut, ResultOut, ProcessStatus
from app.api.deps import get_current_user
from app.models.models import User
from app.services.pdf_service import extract_text_from_pdf
from app.services.ai_service import generate_study_content, _estimate_processing_time
from app.core.config import settings

router = APIRouter(tags=["lectures"])

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

    # Save to DB
    lecture = Lecture(
        user_id=current_user.id,
        title=file.filename.replace(".pdf", ""),
        file_path=file_path,
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
    mode: str = Query("highyield", pattern="^(highyield|exam)$"),
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

    return _estimate_processing_time(text, mode)


@router.post("/process/{lecture_id}", response_model=ProcessStatus)
async def process_lecture(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    mode: str = Query("highyield", pattern="^(highyield|exam)$"),
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
    )
