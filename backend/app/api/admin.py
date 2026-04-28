from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.db.database import get_db
from app.models.models import User

router = APIRouter(prefix="/admin", tags=["admin"])


class SetCreditsRequest(BaseModel):
    email: EmailStr
    credits: int


class SetCreditsResponse(BaseModel):
    email: str
    credit_balance: int


class AdminStats(BaseModel):
    total_users: int
    free_users: int
    pro_users: int
    enterprise_users: int
    total_credits: int
    new_users_today: int
    new_users_this_week: int


@router.get("/stats", response_model=AdminStats)
def get_admin_stats(
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=now.weekday())

    total_users = db.query(func.count(User.id)).scalar() or 0
    free_users = db.query(func.count(User.id)).filter(User.plan == "free").scalar() or 0
    pro_users = db.query(func.count(User.id)).filter(User.plan == "pro").scalar() or 0
    enterprise_users = db.query(func.count(User.id)).filter(User.plan == "enterprise").scalar() or 0
    total_credits = db.query(func.coalesce(func.sum(User.credit_balance), 0)).scalar() or 0
    new_users_today = (
        db.query(func.count(User.id)).filter(User.created_at >= today_start).scalar() or 0
    )
    new_users_this_week = (
        db.query(func.count(User.id)).filter(User.created_at >= week_start).scalar() or 0
    )

    return AdminStats(
        total_users=total_users,
        free_users=free_users,
        pro_users=pro_users,
        enterprise_users=enterprise_users,
        total_credits=total_credits,
        new_users_today=new_users_today,
        new_users_this_week=new_users_this_week,
    )


@router.post("/set-credits", response_model=SetCreditsResponse)
def set_credits(
    body: SetCreditsRequest,
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if body.credits < 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Credits cannot be negative")

    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.credit_balance = body.credits
    db.commit()
    db.refresh(user)
    return SetCreditsResponse(email=user.email, credit_balance=user.credit_balance)
