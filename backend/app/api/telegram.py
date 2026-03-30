import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Dict, Tuple
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Header
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.models import User
from app.core.config import settings
from app.core.security import create_access_token, hash_password

router = APIRouter(prefix="/auth", tags=["telegram"])

# ── Bot temp-file store ────────────────────────────────────────────────────
# token -> (file_path, original_filename, expires_at)
_temp_files: Dict[str, Tuple[str, str, float]] = {}
_TEMP_TTL = 3600          # 1 hour
_TEMP_DIR = Path("temp_uploads")

bot_router = APIRouter(prefix="/bot", tags=["bot"])


class TelegramInitDataRequest(BaseModel):
    init_data: str


def _validate_init_data(init_data: str, bot_token: str) -> dict:
    """
    Validate Telegram WebApp initData using the official algorithm:
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

    Returns the parsed data dict (with 'user' already decoded from JSON).
    Raises ValueError if the hash doesn't match.
    """
    pairs: dict[str, str] = {}
    for part in init_data.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            pairs[k] = unquote(v)

    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise ValueError("Missing hash in initData")

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
def telegram_auth(body: TelegramInitDataRequest, db: Session = Depends(get_db)):
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

    # Synthetic email to identify this Telegram user in the DB.
    # The password is random and can never be used to log in via /auth/login.
    synthetic_email = f"tg_{telegram_id}@telegram.local"
    user = db.query(User).filter(User.email == synthetic_email).first()
    if not user:
        user = User(
            email=synthetic_email,
            hashed_password=hash_password(secrets.token_hex(32)),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "telegram_user": tg_user,
    }


# ── Bot endpoints ──────────────────────────────────────────────────────────

def _check_bot_secret(x_bot_secret: str = Header(None)):
    expected = os.environ.get("BOT_SECRET", "cortexq-bot-secret-2026")
    if not x_bot_secret or x_bot_secret != expected:
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

    token = secrets.token_urlsafe(20)
    dest = _TEMP_DIR / f"{token}.pdf"
    content = await file.read()
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
