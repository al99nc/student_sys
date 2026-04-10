from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.types import JSON
from datetime import datetime, timezone
from uuid import uuid4

from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CoachConversation(Base):
    __tablename__ = "coach_conversations"

    id            = Column(String(36), primary_key=True, default=_uuid)
    student_id    = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    title         = Column(String(255), nullable=False, default="New Conversation")
    created_at    = Column(DateTime, default=_utcnow, nullable=False)
    updated_at    = Column(DateTime, default=_utcnow, nullable=False)
    message_count = Column(Integer, default=0, nullable=False)


class CoachMessage(Base):
    __tablename__ = "coach_messages"

    id              = Column(String(36), primary_key=True, default=_uuid)
    conversation_id = Column(String(36), ForeignKey("coach_conversations.id"), nullable=False, index=True)
    student_id      = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    role            = Column(String(20), nullable=False)   # "user" | "assistant"
    content         = Column(Text, nullable=False)         # text content
    image_data      = Column(Text, nullable=True)          # base64 data URL (user messages only)
    image_mime      = Column(String(50), nullable=True)    # "image/jpeg", "image/png", etc.
    ai_metadata     = Column(JSON, nullable=True)          # action, topic_focus, next_step, practice_document_id, etc.
    created_at      = Column(DateTime, default=_utcnow, nullable=False)
