"""
global_token_guard.py — System-wide daily AI token fail-safe.

Problem
-------
Per-user budgets stop individual abuse, but a bug, a loop, or a wave of
legitimate users can still burn the Groq/OpenRouter quota for the entire
day. This module adds a second, cheaper check: a single global counter
that blocks ALL AI requests once the day's system-wide token ceiling is hit.

Architecture
------------
Primary path  → Redis INCRBY / GET on key  global:tokens:YYYY-MM-DD  (UTC)
Fallback path → SUM query on ai_usage_logs, cached in-process for 60 s

Both paths are safe under concurrency:
  • Redis INCRBY is atomic — no TOCTOU race on the counter itself.
  • The check-then-call gap means ~concurrent_req × max_tokens_per_req
    tokens can overshoot the limit (typical: 10 req × 8K = 80K on a
    budget of tens of millions — acceptable for a cost safety net).
  • The in-process DB cache uses a threading.Lock for safe invalidation.

Startup warm-up
---------------
On app startup, seed Redis from today's DB total so a server restart does
not reset the counter mid-day.  Call  init_global_token_guard(db)  inside
the FastAPI lifespan / startup event.

Usage
-----
1. In every AI endpoint (via GuardAIUsage):
       check_global_capacity(db)        ← raises 503 if over limit
       ... call AI ...
       record_global_usage(tokens_used)  ← INCRBY (best-effort)

2. Standalone dependency (if you want the check without GuardAIUsage):
       _: None = Depends(GlobalCapacityCheck)
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.db.database import get_db

if TYPE_CHECKING:
    import redis as _redis_module

logger = logging.getLogger(__name__)

# ── Redis connection (module-level singleton, set by init_global_token_guard) ─

_redis_client: "_redis_module.Redis | None" = None  # type: ignore[type-arg]
_redis_available: bool = False

# ── In-process DB-fallback cache ─────────────────────────────────────────────

_CACHE_TTL_SECONDS = 60  # how stale the DB fallback is allowed to be

_cache_lock = threading.Lock()
_cached_value: int = 0
_cached_at: float = 0.0          # time.monotonic() stamp


# ── Redis key helpers ─────────────────────────────────────────────────────────

def _today_key() -> str:
    """global:tokens:2026-04-17  (UTC date — rotates automatically at midnight)"""
    return "global:tokens:" + datetime.now(timezone.utc).strftime("%Y-%m-%d")


_REDIS_TTL = 90_000  # 25 hours — outlasts any single UTC day; cleaned up automatically


# ── Initialisation ────────────────────────────────────────────────────────────

def init_global_token_guard(db: Session, redis_url: str | None = None) -> None:
    """
    Call once at application startup (inside lifespan or @app.on_event("startup")).

    Steps
    -----
    1. Connect to Redis (if redis_url provided and redis-py installed).
    2. Seed today's Redis counter from the DB so a restart mid-day does not
       reset the global total to zero.
    3. If Redis is unavailable, the module falls back to the DB cache path.
    """
    global _redis_client, _redis_available

    if redis_url:
        try:
            import redis as _redis_lib  # optional dependency

            pool = _redis_lib.ConnectionPool.from_url(
                redis_url,
                max_connections=20,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            client = _redis_lib.Redis(connection_pool=pool)
            client.ping()  # fail fast if unreachable
            _redis_client = client
            _redis_available = True
            logger.info("GlobalTokenGuard: Redis connected (%s)", redis_url.split("@")[-1])
        except Exception as exc:
            logger.warning("GlobalTokenGuard: Redis unavailable (%s) — using DB fallback", exc)
            _redis_available = False
    else:
        logger.info("GlobalTokenGuard: No REDIS_URL configured — using DB fallback")
        _redis_available = False

    # Seed Redis counter from today's DB total (handles mid-day restarts)
    if _redis_available and _redis_client is not None:
        try:
            key = _today_key()
            exists = _redis_client.exists(key)
            if not exists:
                db_total = _query_db_total(db)
                if db_total > 0:
                    _redis_client.set(key, db_total, ex=_REDIS_TTL)
                    logger.info(
                        "GlobalTokenGuard: Seeded Redis counter with %d tokens from DB",
                        db_total,
                    )
        except Exception as exc:
            logger.warning("GlobalTokenGuard: Failed to seed Redis from DB: %s", exc)


def close_global_token_guard() -> None:
    """Release Redis connections. Call inside lifespan shutdown."""
    global _redis_client, _redis_available
    if _redis_client is not None:
        try:
            _redis_client.close()
        except Exception:
            pass
    _redis_client = None
    _redis_available = False


# ── Public API ────────────────────────────────────────────────────────────────

def check_global_capacity(db: Session, limit: int) -> None:
    """
    Raise HTTP 503 if the global daily token budget is exhausted.

    Called BEFORE the AI request is dispatched.  Fast: one Redis GET
    (~0.2 ms) or a cached DB integer comparison.

    Parameters
    ----------
    db    : SQLAlchemy session (used only when Redis is unavailable)
    limit : daily token ceiling from settings.GLOBAL_DAILY_TOKEN_BUDGET
    """
    if limit <= 0:
        return  # 0 = unlimited (e.g. enterprise override)

    current = _read_current_total(db)
    if current >= limit:
        logger.warning(
            "GlobalTokenGuard: capacity reached (%d/%d tokens today)", current, limit
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "AI capacity temporarily reached. "
                "The daily system limit has been hit. "
                "Please try again after midnight UTC."
            ),
            headers={"Retry-After": _seconds_until_midnight()},
        )


def record_global_usage(tokens: int) -> None:
    """
    Increment the global counter by `tokens` after a successful AI call.

    Best-effort — never raises. The ground-truth total always lives in
    ai_usage_logs; this counter is only for fast pre-call checks.
    """
    if tokens <= 0:
        return

    if _redis_available and _redis_client is not None:
        try:
            key = _today_key()
            new_val = _redis_client.incrby(key, tokens)
            # Set expiry on first write (when key is brand-new for today)
            if new_val == tokens:
                _redis_client.expire(key, _REDIS_TTL)
        except Exception as exc:
            logger.warning("GlobalTokenGuard: Redis INCRBY failed: %s", exc)
            # Invalidate in-process cache so next check hits the DB
            _invalidate_cache()
    else:
        # No Redis — update in-process cache optimistically so we don't
        # re-query the DB on every request (the next DB query will self-correct)
        with _cache_lock:
            global _cached_value
            _cached_value += tokens


# ── FastAPI dependency ────────────────────────────────────────────────────────

def GlobalCapacityCheck(db: Session = Depends(get_db)) -> None:
    """
    Standalone FastAPI dependency.  Use when you want only the global check
    without the full GuardAIUsage (per-user budget + logging).

        @router.post("/generate")
        def generate(_: None = Depends(GlobalCapacityCheck)):
            ...
    """
    from app.core.config import settings

    check_global_capacity(db, settings.GLOBAL_DAILY_TOKEN_BUDGET)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _read_current_total(db: Session) -> int:
    """Return today's global token total from Redis or the DB cache."""
    if _redis_available and _redis_client is not None:
        try:
            val = _redis_client.get(_today_key())
            return int(val) if val is not None else 0
        except Exception as exc:
            logger.warning("GlobalTokenGuard: Redis GET failed (%s) — DB fallback", exc)
            # Fall through to DB path

    return _read_db_cached(db)


def _read_db_cached(db: Session) -> int:
    """
    Return today's total from the DB, with a 60-second in-process cache.
    Thread-safe: only one thread queries the DB at a time; others read the
    stale cached value while the refresh is in flight (acceptable — the cache
    TTL means we're at most 60 s out of date).
    """
    global _cached_value, _cached_at

    now = time.monotonic()
    with _cache_lock:
        if now - _cached_at < _CACHE_TTL_SECONDS:
            return _cached_value

    # Outside the lock while querying so other threads are not blocked
    fresh = _query_db_total(db)
    with _cache_lock:
        _cached_value = fresh
        _cached_at = time.monotonic()
    return fresh


def _query_db_total(db: Session) -> int:
    """
    SELECT SUM(tokens_total) FROM ai_usage_logs WHERE created_at >= today_utc.
    Uses the ix_ai_usage_logs_created_at index — fast even on large tables.
    """
    from app.models.billing import AIUsageLog

    day_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    # Strip tzinfo: SQLAlchemy stores naive UTC datetimes
    day_start_naive = day_start.replace(tzinfo=None)

    try:
        result = (
            db.query(func.coalesce(func.sum(AIUsageLog.tokens_total), 0))
            .filter(AIUsageLog.created_at >= day_start_naive)
            .scalar()
        )
        return int(result or 0)
    except Exception as exc:
        logger.error("GlobalTokenGuard: DB total query failed: %s", exc)
        return 0  # fail open — do not block requests on a DB error


def _invalidate_cache() -> None:
    """Force the next request to re-query the DB (used when Redis INCRBY fails)."""
    global _cached_at
    with _cache_lock:
        _cached_at = 0.0


def _seconds_until_midnight() -> str:
    """Return seconds until next UTC midnight as a string (for Retry-After header)."""
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # next midnight
    from datetime import timedelta
    next_midnight = midnight + timedelta(days=1)
    delta = int((next_midnight - now).total_seconds())
    return str(max(delta, 1))
