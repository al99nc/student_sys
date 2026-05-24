import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from pathlib import Path

logger = logging.getLogger(__name__)
from typing import Dict, Tuple
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Depends, Request, UploadFile, File, Header
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.models import User, Lecture, BotSession, UserSession
from app.core.config import settings
from app.core.security import create_access_token, create_session
from app.core.limiter import limiter
from app.core.otp import generate_and_store, verify_code, send_otp_email
from app.services.pdf_service import extract_text_from_pdf
from sqlalchemy import func

router = APIRouter(prefix="/auth", tags=["telegram"])

# ── Bot temp-file store ────────────────────────────────────────────────────
# token -> (file_path, original_filename, expires_at)
_temp_files: Dict[str, Tuple[str, str, float]] = {}
_TEMP_TTL = 3600          # 1 hour
_TEMP_DIR = Path("temp_uploads")

bot_router = APIRouter(prefix="/bot", tags=["bot"])


class TelegramInitDataRequest(BaseModel):
    init_data: str


_INIT_DATA_MAX_AGE = 300  # 5 minutes


def _validate_init_data(init_data: str, bot_token: str) -> dict:
    """
    Validate Telegram WebApp initData using the official algorithm:
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

    Returns the parsed data dict (with 'user' already decoded from JSON).
    Raises ValueError if the hash doesn't match or data is stale.
    """
    pairs: dict[str, str] = {}
    for part in init_data.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            pairs[k] = unquote(v)

    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise ValueError("Missing hash in initData")

    # Validate timestamp to prevent replay attacks
    auth_date = pairs.get("auth_date")
    if auth_date is None:
        raise ValueError("Missing auth_date in initData")
    if abs(time.time() - int(auth_date)) > _INIT_DATA_MAX_AGE:
        raise ValueError("initData has expired — please reopen the app")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))

    # secret_key = HMAC-SHA256("WebAppData", bot_token)
    secret_key = hmac.new(
        key=b"WebAppData",
        msg=bot_token.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).digest()

    # expected_hash = HMAC-SHA256(secret_key, data_check_string)
    expected_hash = hmac.new(
        key=secret_key,
        msg=data_check_string.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(received_hash, expected_hash):
        raise ValueError("initData hash mismatch — request did not come from Telegram")

    if "user" in pairs:
        pairs["user"] = json.loads(pairs["user"])  # type: ignore[assignment]

    return pairs


@router.post("/telegram")
@limiter.limit("20/minute")
def telegram_auth(request: Request, body: TelegramInitDataRequest, db: Session = Depends(get_db)):
    """
    Exchange Telegram WebApp initData for a standard JWT access token.

    Auto-creates a User row the first time a Telegram user logs in
    so all existing /upload and /process endpoints work unchanged.
    """
    if not settings.TELEGRAM_BOT_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Telegram auth is not configured on this server",
        )

    try:
        data = _validate_init_data(body.init_data, settings.TELEGRAM_BOT_TOKEN)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    tg_user = data.get("user", {})
    telegram_id = tg_user.get("id")
    if not telegram_id:
        raise HTTPException(status_code=400, detail="No user object in initData")

    # If the user linked their Telegram account via the bot OTP flow,
    # return a JWT for their real account (with their real email, lectures, etc.)
    linked_user = db.query(User).filter(User.telegram_chat_id == str(telegram_id)).first()
    if linked_user:
        db.query(UserSession).filter(UserSession.user_id == linked_user.id).delete()
        db.commit()
        sid, stk = create_session(db, linked_user.id)
        db.commit()
        token = create_access_token({"sub": str(linked_user.id), "sid": sid, "stk": stk})
        return {
            "access_token": token,
            "token_type": "bearer",
            "linked": True,
            "email": linked_user.email,
        }

    # Fallback: synthetic email for Telegram-native users who haven't linked
    synthetic_email = f"tg_{telegram_id}@telegram.local"
    user = db.query(User).filter(User.email == synthetic_email).first()
    if not user:
        user = User(email=synthetic_email)
        db.add(user)
        db.commit()
        db.refresh(user)

    db.query(UserSession).filter(UserSession.user_id == user.id).delete()
    db.commit()
    sid, stk = create_session(db, user.id)
    db.commit()
    token = create_access_token({"sub": str(user.id), "sid": sid, "stk": stk})
    return {
        "access_token": token,
        "token_type": "bearer",
    }


# ── Bot endpoints ──────────────────────────────────────────────────────────

def _check_bot_secret(x_bot_secret: str = Header(None)):
    expected = settings.BOT_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="Bot secret not configured on server")
    if not x_bot_secret or not hmac.compare_digest(x_bot_secret, expected):
        raise HTTPException(status_code=403, detail="Invalid bot secret")


def _purge_expired():
    now = time.time()
    expired = [t for t, (_, _, exp) in _temp_files.items() if now > exp]
    for t in expired:
        fp, _, _ = _temp_files.pop(t)
        try:
            os.remove(fp)
        except OSError:
            pass


@bot_router.post("/upload-temp")
async def bot_upload_temp(
    file: UploadFile = File(...),
    _: None = Depends(_check_bot_secret),
):
    """Bot uploads a PDF here; returns a one-time token for the Mini App."""
    _purge_expired()

    if not (file.filename or "").lower().endswith(".pdf") and file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    _TEMP_DIR.mkdir(parents=True, exist_ok=True)

    content = await file.read()

    # Validate PDF magic bytes to prevent content-type spoofing
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="File is not a valid PDF")

    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    token = secrets.token_urlsafe(20)
    dest = _TEMP_DIR / f"{token}.pdf"
    dest.write_bytes(content)

    _temp_files[token] = (str(dest), file.filename or "lecture.pdf", time.time() + _TEMP_TTL)
    return {"token": token}


@bot_router.get("/temp/{token}")
def bot_fetch_temp(token: str):
    """Mini App fetches the pre-uploaded PDF using the token."""
    _purge_expired()

    entry = _temp_files.get(token)
    if not entry:
        raise HTTPException(status_code=404, detail="File not found or expired")

    file_path, filename, _ = entry

    if not os.path.exists(file_path):
        _temp_files.pop(token, None)
        raise HTTPException(status_code=404, detail="File not found or expired")

    return FileResponse(
        path=file_path,
        media_type="application/pdf",
        headers={"X-File-Name": filename},
    )


# ── Bot auth endpoints ─────────────────────────────────────────────────────

class BotSendCodeRequest(BaseModel):
    email: str

class BotVerifyCodeRequest(BaseModel):
    email: str
    code: str
    chat_id: str


@bot_router.post("/send-code")
async def bot_send_code(
    body: BotSendCodeRequest,
    _: None = Depends(_check_bot_secret),
    db: Session = Depends(get_db),
):
    """
    Called by the bot when a user submits their email.
    Checks the email exists in the DB, generates an OTP, sends it.
    Returns 200 if sent, 404 if email not found.
    """
    email = body.email.lower().strip()

    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Invalid email format")

    user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user:
        user = User(email=email)
        db.add(user)
        db.commit()

    code = generate_and_store(email)

    try:
        await send_otp_email(email, code)
    except Exception as exc:
        logger.error("OTP email failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to send email. Please try again.")

    return {"status": "sent"}


@bot_router.post("/verify-code")
async def bot_verify_code(
    body: BotVerifyCodeRequest,
    _: None = Depends(_check_bot_secret),
    db: Session = Depends(get_db),
):
    """
    Called by the bot when a user submits the 6-digit code.
    Verifies the code, links telegram_chat_id to the user, returns a JWT.
    """
    email = body.email.lower().strip()

    if not verify_code(email, body.code):
        raise HTTPException(status_code=401, detail="Invalid or expired code")

    user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.telegram_chat_id = str(body.chat_id)
    db.commit()

    db.query(UserSession).filter(UserSession.user_id == user.id).delete()
    db.commit()
    sid, stk = create_session(db, user.id)
    db.commit()
    token = create_access_token({"sub": str(user.id), "sid": sid, "stk": stk})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": str(user.id),
    }


# ── Bot authenticated PDF upload ───────────────────────────────────────────

@bot_router.post("/upload-pdf")
async def bot_upload_pdf(
    file: UploadFile = File(...),
    _: None = Depends(_check_bot_secret),
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    """
    Bot uploads a PDF on behalf of an authenticated user.
    The bot passes the user's JWT in the Authorization header.
    Returns the lecture_id so the bot can build the Mini App deep link.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing user token")

    token = authorization.replace("Bearer ", "")
    try:
        from app.core.security import decode_access_token
        payload = decode_access_token(token)
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    filename = file.filename or "lecture.pdf"
    if not filename.lower().endswith(".pdf") and file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    content = await file.read()

    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Not a valid PDF file")

    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")

    upload_dir = os.path.abspath(settings.UPLOAD_DIR)
    os.makedirs(upload_dir, exist_ok=True)
    safe_name = f"{user.id}_{secrets.token_hex(6)}_{os.path.basename(filename)}"
    file_path = os.path.join(upload_dir, safe_name)

    with open(file_path, "wb") as f:
        f.write(content)

    try:
        extract_text_from_pdf(file_path)
    except Exception:
        os.remove(file_path)
        raise HTTPException(status_code=400, detail="Could not read PDF. It may be corrupted or password-protected.")

    lecture = Lecture(
        user_id=user.id,
        title=filename.replace(".pdf", ""),
        file_path=file_path,
        university=user.university or "",
        college=user.college or "",
        year_of_study=user.year_of_study,
        subject=user.subject or "",
        topic_area=filename.replace(".pdf", ""),
        level=user.level or "",
    )
    db.add(lecture)
    db.commit()
    db.refresh(lecture)

    return {
        "lecture_id": lecture.id,
        "title": lecture.title,
    }


# ── Bot session persistence (DB-backed, survives restarts) ─────────────────

class BotSessionSaveRequest(BaseModel):
    chat_id: str
    email: str = ""
    jwt: str | None = None
    state: str = "waiting_email"

@bot_router.post("/session/save")
async def bot_save_session(
    body: BotSessionSaveRequest,
    _: None = Depends(_check_bot_secret),
    db: Session = Depends(get_db),
):
    """Upsert a bot session row (keyed by chat_id)."""
    from datetime import datetime, timedelta, timezone
    existing = db.query(BotSession).filter(BotSession.chat_id == body.chat_id).first()
    expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    if existing:
        existing.email = body.email
        existing.jwt = body.jwt
        existing.state = body.state
        existing.expires_at = expires_at
    else:
        db.add(BotSession(
            chat_id=body.chat_id,
            email=body.email,
            jwt=body.jwt,
            state=body.state,
            expires_at=expires_at,
        ))
    db.commit()
    return {"status": "ok"}


@bot_router.get("/session/{chat_id}")
async def bot_get_session(
    chat_id: str,
    _: None = Depends(_check_bot_secret),
    db: Session = Depends(get_db),
):
    """Return the session for this chat_id, or null if not found / expired."""
    from datetime import datetime, timezone
    session = db.query(BotSession).filter(BotSession.chat_id == chat_id).first()
    if not session:
        return {"session": None}
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        db.delete(session)
        db.commit()
        return {"session": None}
    return {
        "session": {
            "chat_id": session.chat_id,
            "email": session.email,
            "jwt": session.jwt,
            "state": session.state,
            "expires_at": session.expires_at.isoformat(),
        }
    }


@bot_router.delete("/session/{chat_id}")
async def bot_delete_session(
    chat_id: str,
    _: None = Depends(_check_bot_secret),
    db: Session = Depends(get_db),
):
    """Delete a bot session."""
    session = db.query(BotSession).filter(BotSession.chat_id == chat_id).first()
    if session:
        db.delete(session)
        db.commit()
    return {"status": "ok"}
