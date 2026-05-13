

import hashlib
import random
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.security import (
    create_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.db.database import get_db
from app.models.models import MagicLinkToken, User
from app.schemas.auth import (
    MagicLinkRequest,
    MagicLinkResponse,
    OnboardingUpdate,
    Token,
    UserCreate,
    UserLogin,
    UserOut,
    VerifyCodeRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_MAGIC_LINK_TTL_MINUTES = 10
_MAGIC_LINK_RATE_LIMIT = 3       # max emails per window
_MAGIC_LINK_RATE_WINDOW = 15     # minutes


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def _send_magic_link_email(email: str, token: str, code: str | None = None) -> None:
    if not settings.RESEND_API_KEY:
        raise HTTPException(status_code=503, detail="Email service not configured")
    link = f"{settings.APP_PUBLIC_URL}/api/auth/verify?token={token}"

    otp_block = ""
    if code:
        otp_block = (
            "<div style=\"margin-top:24px;padding:16px;background:#f5f5f5;border-radius:8px;text-align:center;\">"
            "<p style=\"margin:0 0 8px;font-size:14px;color:#666;\">Or enter this code in the Telegram app:</p>"
            f"<p style=\"margin:0;font-size:32px;font-weight:bold;letter-spacing:8px;color:#111;\">{code}</p>"
            "<p style=\"margin:8px 0 0;font-size:12px;color:#999;\">Expires in 10 minutes</p>"
            "</div>"
        )

    text = (
        f"Click the link below to sign in. The link expires in 10 minutes.\n\n"
        f"{link}\n\n"
        f"If you didn't request this, you can safely ignore this email."
    )
    if code:
        text += f"\n\nOr enter this code in the app: {code}\nThis code expires in 10 minutes."

    payload = {
        "from": "noreply@themcq.xyz",
        "to": [email],
        "subject": "Your themcq sign-in link",
        "text": text,
        "html": (
            "<p>Click the button below to sign in. The link expires in 10 minutes.</p>"
            f'<p><a href="{link}" style="background:#6366f1;color:#fff;padding:12px 24px;'
            f'border-radius:6px;text-decoration:none;font-weight:bold;">Sign in to themcq</a></p>'
            f'<p>Or paste this URL into your browser:<br>{link}</p>'
            f"{otp_block}"
            "<p>If you didn't request this, you can safely ignore this email.</p>"
        ),
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            json=payload,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
        )
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Failed to send email")


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def signup(request: Request, user_data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    ip = request.headers.get("X-Forwarded-For", request.client.host).split(",")[0].strip()
    existing_ip = db.query(User).filter(User.signup_ip == ip).first()

    local_part = user_data.email.split("@")[0]
    bro_bonus = local_part.lower().endswith("-fromali")

    user = User(
        email=user_data.email,
        hashed_password=hash_password(user_data.password),
        credit_balance=0 if existing_ip else (100 if bro_bonus else 0),
        signup_ip=ip,
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
    if needs_rehash(user.hashed_password):
        user.hashed_password = hash_password(user_data.password)
        db.commit()
    token = create_access_token({"sub": str(user.id), "is_admin": bool(user.is_admin)})
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


@router.post("/request-link", response_model=MagicLinkResponse)
async def request_magic_link(
    body: MagicLinkRequest,
    db: Session = Depends(get_db),
):
    email = body.email.lower().strip()
    now = datetime.now(timezone.utc)

    # Per-email rate limit: max 3 requests per 15 minutes.
    window_start = now - timedelta(minutes=_MAGIC_LINK_RATE_WINDOW)
    recent_count = (
        db.query(MagicLinkToken)
        .filter(
            MagicLinkToken.email == email,
            MagicLinkToken.created_at >= window_start,
        )
        .count()
    )
    if recent_count >= _MAGIC_LINK_RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many requests. Try again in {_MAGIC_LINK_RATE_WINDOW} minutes.",
        )

    # Ensure user exists; create if new (passwordless — "!" can never bcrypt-verify).
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, hashed_password="!")
        db.add(user)
        db.flush()

    # Clean up expired tokens for this email.
    db.query(MagicLinkToken).filter(
        MagicLinkToken.email == email,
        MagicLinkToken.expires_at < now,
    ).delete(synchronize_session=False)

    # Generate token: 32 random bytes, URL-safe base64 encoded.
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = now + timedelta(minutes=_MAGIC_LINK_TTL_MINUTES)
    otp_code = str(random.randint(100000, 999999))

    db.add(MagicLinkToken(
        email=email,
        token_hash=token_hash,
        expires_at=expires_at,
        used=0,
        otp_code=otp_code,
    ))
    db.commit()

    await _send_magic_link_email(email, raw_token, code=otp_code)

    return MagicLinkResponse(
        message="Check your email — we sent a sign-in link.",
        email=email,
    )


@router.get("/verify")
def verify_magic_link(
    token: str = Query(..., description="Raw magic-link token from email"),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    token_hash = _hash_token(token)

    record = (
        db.query(MagicLinkToken)
        .filter(MagicLinkToken.token_hash == token_hash)
        .first()
    )

    error_redirect = f"{settings.APP_PUBLIC_URL}/auth?error=invalid_link"

    if not record:
        return RedirectResponse(url=error_redirect, status_code=302)

    expires = record.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    if record.used or expires < now:
        return RedirectResponse(url=error_redirect, status_code=302)

    # Mark token as consumed.
    record.used = 1
    db.commit()

    user = db.query(User).filter(User.email == record.email).first()
    if not user:
        return RedirectResponse(url=error_redirect, status_code=302)

    jwt_token = create_access_token({"sub": str(user.id), "email": user.email})

    # Redirect to the frontend callback page which saves the JWT to localStorage.
    # Fragment (#) would be cleaner but is not accessible server-side; query param is
    # immediately consumed by the callback page and the URL is replaced in history.
    return RedirectResponse(
        url=f"{settings.APP_PUBLIC_URL}/auth/callback?token={jwt_token}",
        status_code=302,
    )


@router.post("/verify-code", response_model=Token)
@limiter.limit("15/15minute")
def verify_code(
    request: Request,
    body: VerifyCodeRequest,
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    email = body.email.lower().strip()

    record = (
        db.query(MagicLinkToken)
        .filter(
            MagicLinkToken.email == email,
            MagicLinkToken.otp_code == body.code,
            MagicLinkToken.used == 0,
        )
        .order_by(MagicLinkToken.created_at.desc())
        .first()
    )

    if not record:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired code",
        )

    expires = record.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired code",
        )

    record.used = 1
    db.commit()

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, hashed_password="!")
        db.add(user)
        db.commit()
        db.refresh(user)

    jwt_token = create_access_token({"sub": str(user.id), "email": user.email})
    return {"access_token": jwt_token, "token_type": "bearer"}


# ── Google OAuth 2.0 ──────────────────────────────────────────────────────────

_GOOGLE_AUTH_URL     = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
_GOOGLE_STATE_SALT   = "google-oauth-state"
_GOOGLE_STATE_MAX_AGE = 600  # 10 minutes


def _google_redirect_uri() -> str:
    return f"{settings.APP_PUBLIC_URL}/api/auth/google/callback"


def _create_google_state() -> str:
    from itsdangerous import URLSafeTimedSerializer
    s = URLSafeTimedSerializer(settings.SECRET_KEY, salt=_GOOGLE_STATE_SALT)
    return s.dumps(secrets.token_urlsafe(16))


def _verify_google_state(state: str) -> bool:
    from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
    s = URLSafeTimedSerializer(settings.SECRET_KEY, salt=_GOOGLE_STATE_SALT)
    try:
        s.loads(state, max_age=_GOOGLE_STATE_MAX_AGE)
        return True
    except (BadSignature, SignatureExpired):
        return False


@router.get("/google")
async def google_login():
    from authlib.integrations.httpx_client import AsyncOAuth2Client
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth not configured")

    state = _create_google_state()
    async with AsyncOAuth2Client(
        client_id=settings.GOOGLE_CLIENT_ID,
        redirect_uri=_google_redirect_uri(),
    ) as client:
        url, _ = client.create_authorization_url(
            _GOOGLE_AUTH_URL,
            scope="openid email profile",
            state=state,
        )
    return RedirectResponse(url, status_code=302)


@router.get("/google/callback")
async def google_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    from authlib.integrations.httpx_client import AsyncOAuth2Client
    error_redirect = f"{settings.APP_PUBLIC_URL}/auth?error=google_failed"

    if error or not code or not state:
        return RedirectResponse(error_redirect, status_code=302)

    if not _verify_google_state(state):
        return RedirectResponse(error_redirect, status_code=302)

    try:
        async with AsyncOAuth2Client(
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            redirect_uri=_google_redirect_uri(),
        ) as client:
            await client.fetch_token(_GOOGLE_TOKEN_URL, code=code)
            resp = await client.get(_GOOGLE_USERINFO_URL)
            userinfo = resp.json()
    except Exception:
        return RedirectResponse(error_redirect, status_code=302)

    email: str | None = userinfo.get("email")
    name: str | None  = userinfo.get("name")

    if not email:
        return RedirectResponse(error_redirect, status_code=302)

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, hashed_password="!", name=name)
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.name and name:
        user.name = name
        db.commit()

    jwt_token = create_access_token(
        {"sub": str(user.id), "email": user.email},
        expires_delta=timedelta(days=7),
    )
    return RedirectResponse(
        url=f"{settings.APP_PUBLIC_URL}/auth/callback?token={jwt_token}",
        status_code=302,
    )
