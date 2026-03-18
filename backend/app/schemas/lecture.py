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

    class Config:
        from_attributes = True

class ProcessStatus(BaseModel):
    status: str
    message: str
    lecture_id: int
