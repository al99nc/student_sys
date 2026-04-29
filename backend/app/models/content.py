from sqlalchemy import Column, String, Text, DateTime
from datetime import datetime, timezone
from app.db.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SiteContent(Base):
    __tablename__ = "site_content"

    key = Column(String(50), primary_key=True)
    content = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
