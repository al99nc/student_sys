from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Any

class LectureOut(BaseModel):
    id: int
    title: str
    file_path: str
    created_at: datetime

    class Config:
        from_attributes = True

class MCQ(BaseModel):
    question: str
    options: List[str]
    answer: str
    explanation: Optional[str] = None  # e.g. "Glutamate is excitatory; GABA is inhibitory"
    topic: Optional[str] = None         # e.g. "Basal Ganglia"

class ResultOut(BaseModel):
    id: int
    lecture_id: int
    summary: Optional[str] = None
    key_concepts: Optional[List[str]] = None
    mcqs: Optional[List[MCQ]] = None
    created_at: datetime
    share_token: Optional[str] = None
    view_count: int = 0

    class Config:
        from_attributes = True

class ProcessStatus(BaseModel):
    status: str
    message: str
    lecture_id: int

class ShareTokenOut(BaseModel):
    share_token: str

class ViewersOut(BaseModel):
    view_count: int
    active_viewers: int
    share_token: Optional[str] = None

class SharedResultOut(BaseModel):
    lecture_id: int
    lecture_title: str
    summary: Optional[str] = None
    key_concepts: Optional[List[str]] = None
    mcqs: Optional[List[MCQ]] = None
    view_count: int

class QuizSessionOut(BaseModel):
    answers: dict = {}
    retake_count: int = 0

class QuizSessionSave(BaseModel):
    answers: dict
