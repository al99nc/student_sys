from sqlalchemy import Column, String, Integer, DateTime, Text, UniqueConstraint
from datetime import datetime
from uuid import uuid4

from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


class StudentMemory(Base):
    """
    Persistent key-value facts the AI saves about a student across all conversations.
    Examples: preferred name, study goals, favorite number, exam date, etc.
    """
    __tablename__ = "student_memories"

    id         = Column(String(36), primary_key=True, default=_uuid)
    student_id = Column(Integer, nullable=False, index=True)
    key        = Column(String(100), nullable=False)   # snake_case identifier, e.g. "favorite_number"
    label      = Column(String(200), nullable=False)   # human-readable, e.g. "Favorite number"
    value      = Column(Text, nullable=False)           # the stored fact
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("student_id", "key", name="uq_student_memory_key"),
    )
