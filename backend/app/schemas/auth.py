from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime


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
    plan: str = "free"
    is_admin: bool = False
    created_at: datetime
    profile_picture: Optional[str] = None

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

    @field_validator("is_admin", mode="before")
    @classmethod
    def coerce_is_admin(cls, v) -> bool:
        if v is None or v == 0 or v == "0" or v == "false":
            return False
        return True


class OnboardingUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    university: str = Field(..., min_length=1, max_length=255)
    college: str = Field(..., min_length=1, max_length=120)
    year_of_study: int = Field(..., ge=1, le=10)

    @field_validator("name", "university", "college")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    university: Optional[str] = Field(None, min_length=1, max_length=255)
    college: Optional[str] = Field(None, min_length=1, max_length=120)
    year_of_study: Optional[int] = Field(None, ge=1, le=10)

    @field_validator("name", "university", "college")
    @classmethod
    def strip_whitespace(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v else v


class Token(BaseModel):
    access_token: str
    token_type: str
    is_new_user: bool = False


class SessionOut(BaseModel):
    id: str
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime
    last_seen_at: datetime


class MagicLinkRequest(BaseModel):
    email: EmailStr


class MagicLinkResponse(BaseModel):
    message: str
    email: str


class VerifyCodeRequest(BaseModel):
    email: str
    code: str
