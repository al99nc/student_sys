import hashlib
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.core.security import create_access_token, decode_token, rotate_session_token
from app.models.models import User, UserSession

security = HTTPBearer()


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)

def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    # ── Session binding check + rotation ─────────────────────────────────────
    sid = payload.get("sid")
    stk = payload.get("stk")
    if sid and stk:
        # Lock the session row to avoid race conditions when rotating or
        # revoking tokens. This serializes concurrent requests touching
        # the same session and prevents spurious DELETE warnings.
        try:
            session = db.query(UserSession).filter(UserSession.id == sid).with_for_update().first()
        except Exception:
            # Some DB backends (or SQLAlchemy configs) may not support
            # FOR UPDATE in this context; fall back to a normal query.
            session = db.query(UserSession).filter(UserSession.id == sid).first()
        if not session or session.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found")

        expires_at = _ensure_utc(session.expires_at)
        if expires_at and expires_at < datetime.now(timezone.utc):
            # Use a direct delete query to avoid SQLAlchemy expecting the
            # row to still exist in the session (prevents SAWarning when
            # concurrent requests already removed it).
            db.query(UserSession).filter(UserSession.id == session.id).delete(synchronize_session=False)
            db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

        expected_hash = hashlib.sha256(stk.encode()).hexdigest()
        if session.token_hash == expected_hash:
            # Rotate session token for theft protection
            new_stk = rotate_session_token(db, session)
            db.commit()

            # Issue new JWT with rotated token
            new_jwt = create_access_token({
                "sub": str(user_id),
                "sid": sid,
                "stk": new_stk,
            })
            request.state._new_jwt = new_jwt
        elif session.previous_token_hash == expected_hash:
            # Allow one concurrent request using the prior token after a recent rotation.
            session.last_seen_at = datetime.now(timezone.utc)
            db.commit()
        else:
            # Token mismatch — stolen token detected, revoke session.
            # Use a direct delete to avoid SAWarning if another request
            # already removed the row concurrently.
            db.query(UserSession).filter(UserSession.id == session.id).delete(synchronize_session=False)
            db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")
    # else: legacy token without session binding — still allowed

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    db.refresh(user)

    return user


def get_current_admin(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    row = db.execute(
        text("SELECT is_admin FROM users WHERE id = :id"),
        {"id": current_user.id},
    ).fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
