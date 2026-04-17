from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    university: Optional[str] = None
    college: Optional[str] = None
    year_of_study: Optional[int] = None
    subject: Optional[str] = None
    topic_area: Optional[str] = None
    credit_balance: int = 0
    created_at: datetime

    class Config:
        from_attributes = True

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id_to_str(cls, v) -> str:
        return str(v)

    @field_validator("credit_balance", mode="before")
    @classmethod
    def credit_balance_none(cls, v: Optional[int]) -> int:
        return 0 if v is None else v


class OnboardingUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    university: str = Field(..., min_length=1, max_length=255)
    college: str = Field(..., min_length=1, max_length=120)
    year_of_study: int = Field(..., ge=1, le=10)

    @field_validator("name", "university", "college")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()

class Token(BaseModel):
    access_token: str
    token_type: str
