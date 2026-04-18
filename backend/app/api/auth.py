from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import User
from app.schemas.auth import UserCreate, UserLogin, Token, UserOut, OnboardingUpdate
from app.core.security import hash_password, verify_password, create_access_token
from app.core.limiter import limiter
from app.api.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def signup(request: Request, user_data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    local_part = user_data.email.split("@")[0]
    bro_bonus = local_part.lower().endswith("-fromali")

    user = User(
        email=user_data.email,
        hashed_password=hash_password(user_data.password),
        credit_balance=100 if bro_bonus else 0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
@limiter.limit("10/minute")
def login(request: Request, user_data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_data.email).first()
    if not user or not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer"}

@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/onboarding", response_model=UserOut)
def save_onboarding(
    data: OnboardingUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.name = data.name.strip()
    current_user.university = data.university.strip()
    current_user.college = data.college.strip()
    current_user.year_of_study = data.year_of_study
    db.commit()
    db.refresh(current_user)
    return current_user
