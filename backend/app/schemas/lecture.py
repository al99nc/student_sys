from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Any

class LectureOut(BaseModel):
    id: int
    title: str
    file_path: str
    created_at: datetime
    university: Optional[str] = None
    college: Optional[str] = None
    year_of_study: Optional[int] = None
    subject: Optional[str] = None
    topic_area: Optional[str] = None
    is_processed: bool = False
    has_essays: bool = False

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
    has_essays: bool = False
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

class SolvedEssayQuestion(BaseModel):
    question: str
    ideal_answer: str
    topic: Optional[str] = None
    max_score: int = 100

class SolvedMCQ(BaseModel):
    question: str
    options: List[str]
    answer: str
    explanation: Optional[str] = None
    topic: Optional[str] = None

class SolvedOut(BaseModel):
    lecture_id: int
    lecture_title: str
    created_at: datetime
    mcqs: List[SolvedMCQ]
    essays: List[SolvedEssayQuestion]

class SolvedEssayOut(BaseModel):
    lecture_id: int
    lecture_title: str
    questions: List[SolvedEssayQuestion]
    created_at: datetime

class SolvedLectureOut(BaseModel):
    id: int
    title: str
    created_at: datetime
    mcq_count: int
    has_essays: bool

class QuizSessionOut(BaseModel):
    answers: dict = {}
    retake_count: int = 0

class QuizSessionSave(BaseModel):
    answers: dict
