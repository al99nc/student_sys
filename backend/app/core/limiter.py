from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def _get_user_or_ip(request: Request) -> str:
    """Rate-limit key: JWT user-id when authenticated, else remote IP.

    Keying by user ID prevents a single abuser from evading limits by rotating
    IPs (VPN, mobile data, etc.) while keeping public/unauthenticated endpoints
    IP-limited as a fallback.
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        try:
            from app.core.security import decode_token  # lazy — avoids circular import at module level
            payload = decode_token(token)
            if payload and "sub" in payload:
                return f"user:{payload['sub']}"
        except Exception:
            pass
    return get_remote_address(request)


limiter = Limiter(key_func=_get_user_or_ip)
