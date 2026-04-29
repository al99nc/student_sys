from pydantic import BaseModel
from datetime import datetime


class SiteContentUpdate(BaseModel):
    content: str


class SiteContentOut(BaseModel):
    key: str
    content: str
    updated_at: datetime

    class Config:
        from_attributes = True
