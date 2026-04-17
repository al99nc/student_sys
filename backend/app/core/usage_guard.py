"""
usage_guard.py — FastAPI dependency for AI request gating.

Two layers of protection per request
--------------------------------------
1. Global capacity check   — system-wide daily token ceiling (fail-safe)
2. Per-user budget check   — per-plan daily token allowance

Both are checked before the AI call.  After the call, token usage is:
  a. Logged to ai_usage_logs (DB)          via guard.log()
  b. Incremented in the global counter     via record_global_usage()

Usage
-----
Inject GuardAIUsage into any AI-calling endpoint:

    @router.post("/process")
    def process(
        body: ProcessBody,
        guard: _UsageGuard = Depends(GuardAIUsage("mcq_generate")),
        ...
    ):
        result = call_ai(...)
        guard.log(
            tokens_input=result.usage.prompt_tokens,
            tokens_output=result.usage.completion_tokens,
            model=result.model,
        )

If you only need the budget checks (no post-call logging):

    _: None = Depends(CheckDailyBudget)
"""

from __future__ import annotations

from typing import Callable

from fastapi import Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.entitlements import (
    assert_within_daily_token_budget,
    log_ai_usage,
)
from app.core.global_token_guard import (
    check_global_capacity,
    record_global_usage,
)
from app.db.database import get_db
from app.models.models import User


# ── Simple budget check (no post-call logging) ────────────────────────────────

def CheckDailyBudget(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """
    Raises HTTP 503 if the global daily token ceiling is hit, then
    raises HTTP 429 if this user's personal daily budget is exhausted.
    """
    check_global_capacity(db, settings.GLOBAL_DAILY_TOKEN_BUDGET)
    assert_within_daily_token_budget(db, current_user)


# ── Full guard: pre-call checks + post-call usage logger ─────────────────────

class _UsageGuard:
    """
    Returned by GuardAIUsage(feature).  Holds the DB session and user so
    that guard.log() can write the usage record without re-fetching them.
    """

    def __init__(self, feature: str, user: User, db: Session) -> None:
        self.feature = feature
        self.user = user
        self.db = db

    def log(self, *, tokens_input: int, tokens_output: int, model: str) -> None:
        """
        Call this after every successful AI response.

        Actions performed (in order):
          1. Insert row into ai_usage_logs (source of truth)
          2. Increment global Redis/in-process counter
        """
        # 1 — persistent record (DB)
        log_ai_usage(
            self.db,
            user_id=self.user.id,
            feature=self.feature,
            model=model,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
        )
        # 2 — global fast counter (Redis / in-process)
        record_global_usage(tokens_input + tokens_output)


def GuardAIUsage(feature: str) -> Callable[..., _UsageGuard]:
    """
    Factory that returns a FastAPI dependency performing all pre-call checks
    and exposing .log() for post-call accounting.

    Pre-call checks (in order, cheapest first):
      1. Global daily token ceiling      → HTTP 503 "capacity reached"
      2. Per-user daily token budget     → HTTP 429 "user limit reached"

    Parameters
    ----------
    feature : str
        Label stored in ai_usage_logs.feature.
        Convention: "mcq_generate" | "coach" | "analysis" | "coach_router"
    """

    def _dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> _UsageGuard:
        # ── Layer 1: global fail-safe ────────────────────────────────────
        check_global_capacity(db, settings.GLOBAL_DAILY_TOKEN_BUDGET)

        # ── Layer 2: per-user plan quota ─────────────────────────────────
        assert_within_daily_token_budget(db, current_user)

        return _UsageGuard(feature=feature, user=current_user, db=db)

    # Stable __name__ so FastAPI doesn't deduplicate the dependency incorrectly
    _dependency.__name__ = f"guard_ai_usage_{feature}"
    return _dependency


# ── Estimated token counts (when the provider omits usage in the response) ────

def estimate_tokens(text: str) -> int:
    """
    Rough token estimate: ~4 chars per token for English prose.
    Use only when the provider does not return a usage object.
    """
    return max(1, len(text) // 4)
