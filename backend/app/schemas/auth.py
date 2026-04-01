from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    uuid: str
    email: str
    name: Optional[str] = None
    university: Optional[str] = None
    college: Optional[str] = None
    year_of_study: Optional[int] = None
    subject: Optional[str] = None
    topic_area: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class OnboardingUpdate(BaseModel):
    name: str
    university: str
    college: str
    year_of_study: int

class Token(BaseModel):
    access_token: str
    token_type: str
