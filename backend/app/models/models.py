from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from uuid import uuid4
from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, index=True, nullable=False, default=_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String(120), nullable=True)
    university = Column(String(255), nullable=True)
    college = Column(String(120), nullable=True)       # faculty: medicine, pharmacy, etc.
    year_of_study = Column(Integer, nullable=True)     # 1–6
    subject = Column(String(255), nullable=True)       # set when uploading a lecture
    topic_area = Column(String(255), nullable=True)    # auto-extracted from PDF
    level = Column(String(50), nullable=True)          # legacy — kept for existing rows
    created_at = Column(DateTime, default=_utcnow)

    lectures = relationship("Lecture", back_populates="owner")


class Lecture(Base):
    __tablename__ = "lectures"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    university = Column(String(255), nullable=True)
    college = Column(String(120), nullable=True)       # faculty: medicine, pharmacy, etc.
    year_of_study = Column(Integer, nullable=True)     # 1–6
    subject = Column(String(255), nullable=True)       # set when uploading a lecture
    topic_area = Column(String(255), nullable=True)    # auto-extracted from PDF
    level = Column(String(50), nullable=True)          # legacy — kept for existing rows

    owner = relationship("User", back_populates="lectures")
    result = relationship("Result", back_populates="lecture", uselist=False)


class Result(Base):
    __tablename__ = "results"

    id = Column(Integer, primary_key=True, index=True)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    summary = Column(Text, nullable=True)
    key_concepts = Column(Text, nullable=True)  # JSON string
    mcqs = Column(Text, nullable=True)           # JSON string
    created_at = Column(DateTime, default=_utcnow)
    share_token = Column(String, unique=True, index=True, nullable=True)
    view_count = Column(Integer, default=0, server_default="0")

    lecture = relationship("Lecture", back_populates="result")


class QuizSession(Base):
    __tablename__ = "quiz_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    answers = Column(Text, nullable=True)        # JSON: {"0": "A", "2": "C"}
    retake_count = Column(Integer, default=0, server_default="0")
    updated_at = Column(DateTime, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "lecture_id", name="uq_user_lecture_session"),
    )

