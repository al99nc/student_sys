"""
In-memory OTP store for Telegram bot email verification.
Codes expire after 10 minutes.
One active code per email at a time — requesting a new code invalidates the old one.
"""
import random
import time
import logging

import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)

# {email: {"code": "123456", "expires_at": float}}
_otp_store: dict[str, dict] = {}
_OTP_TTL = 600  # 10 minutes


def generate_and_store(email: str) -> str:
    """Generate a 6-digit OTP, store it, return the code string."""
    code = str(random.randint(100000, 999999))
    _otp_store[email.lower().strip()] = {
        "code": code,
        "expires_at": time.time() + _OTP_TTL,
    }
    return code


def verify_code(email: str, code: str) -> bool:
    """Returns True if the code matches and is not expired. Deletes the code on success."""
    key = email.lower().strip()
    entry = _otp_store.get(key)
    if not entry:
        return False
    if time.time() > entry["expires_at"]:
        _otp_store.pop(key, None)
        return False
    if entry["code"] != code.strip():
        return False
    _otp_store.pop(key, None)
    return True


async def send_otp_email(to_email: str, code: str) -> None:
    """
    Send the OTP code to the user's email via Resend API.
    Reads RESEND_API_KEY from settings.
    Raises an exception if sending fails — caller must handle it.
    """
    if not settings.RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY is not configured")

    html_body = f"""
    <body style="font-family: sans-serif; background: #000; color: #fff; padding: 40px 20px; text-align: center;">
      <div style="max-width: 500px; margin: 0 auto;">
        <div style="font-size: 24px; font-weight: 900; margin-bottom: 32px; letter-spacing: -1px;">
          the<span style="color: #22c55e;">mcq</span>
        </div>
        <p style="font-size: 16px; color: #ccc; margin-bottom: 24px;">
          Enter this code in the Telegram app to sign in:
        </p>
        <div style="font-size: 48px; font-weight: 900; letter-spacing: 12px; color: #fff; margin: 32px 0; font-family: monospace;">{code}</div>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">
          This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    </body>
    """

    text_body = f"Your themcq verification code is: {code}\n\nEnter this code in the Telegram app to sign in. The code expires in 10 minutes."

    payload = {
        "from": settings.SMTP_FROM or "noreply@themcq.xyz",
        "to": [to_email],
        "subject": f"{code} is your themcq verification code",
        "text": text_body,
        "html": html_body,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            json=payload,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
        )

    if resp.status_code >= 400:
        body = resp.text
        logger.error("Resend OTP email failed: status=%s body=%s", resp.status_code, body)
        raise RuntimeError(f"Resend API returned {resp.status_code}")
