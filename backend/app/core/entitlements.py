"""
Entitlements — what a user can do based on their plan.

Plan hierarchy (highest wins):
    enterprise  > pro  > free

is_premium()        True for pro or enterprise only.
plan_tier()         Returns "free" | "pro" | "enterprise".
resolve_entitlements()  Returns a frozen Entitlements dataclass with all
                    limits and capability flags resolved in one place.

Credits are overflow capacity for Pro/Enterprise subscribers only.
Free users do not receive elevated access from a credit balance.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.coach import CoachMessage
from app.models.models import CoachPerformanceUsage, Lecture, User


# ── Plan tier ─────────────────────────────────────────────────────────────────

def plan_tier(user: User | None) -> str:
    """Return "free" | "pro" | "enterprise"."""
    if user is None:
        return "free"
    p = (user.plan or "free").lower()
    return p if p in ("pro", "enterprise") else "free"


def is_premium(user: User | None) -> bool:
    """True only for paid plan users (pro or enterprise)."""
    return plan_tier(user) in ("pro", "enterprise")


# ── Entitlements dataclass ────────────────────────────────────────────────────

@dataclass(frozen=True)
class Entitlements:
    tier: str
    uploads_limit: int
    coach_limit: int
    daily_token_budget: int
    model: str
    overflow_credits: int
    # Capability flags — false for free, true for pro/enterprise
    has_coach_memory: bool
    has_analytics: bool
    has_exam_simulator: bool
    has_cross_doc_query: bool
    has_spaced_repetition: bool
    has_export: bool
    has_priority_queue: bool


def resolve_entitlements(user: User | None) -> Entitlements:
    """Compute all entitlements for a user in one place. Use this in endpoints."""
    tier = plan_tier(user)
    paid = tier in ("pro", "enterprise")
    return Entitlements(
        tier=tier,
        uploads_limit=upload_limit_for_user(user) if user else settings.FREE_PDF_UPLOADS_PER_MONTH,
        coach_limit=coach_limit_for_user(user) if user else settings.FREE_COACH_MESSAGES_PER_MONTH,
        daily_token_budget=daily_token_budget(user) if user else settings.FREE_DAILY_TOKEN_BUDGET,
        model=settings.PREMIUM_AI_MODEL if paid else settings.FREE_AI_MODEL,
        overflow_credits=(user.credit_balance or 0) if (paid and user) else 0,
        has_coach_memory=paid,
        has_analytics=paid,
        has_exam_simulator=paid,
        has_cross_doc_query=paid,
        has_spaced_repetition=paid,
        has_export=paid,
        has_priority_queue=paid,
    )


# ── Monthly limit helpers ─────────────────────────────────────────────────────

def upload_limit_for_user(user: User) -> int:
    tier = plan_tier(user)
    if tier == "enterprise":
        return 9_999
    if tier == "pro":
        return settings.PRO_PDF_UPLOADS_PER_MONTH
    return settings.FREE_PDF_UPLOADS_PER_MONTH


def coach_limit_for_user(user: User) -> int:
    tier = plan_tier(user)
    if tier == "enterprise":
        return 9_999
    if tier == "pro":
        return settings.PRO_COACH_MESSAGES_PER_MONTH
    return settings.FREE_COACH_MESSAGES_PER_MONTH


def daily_token_budget(user: User) -> int:
    """Maximum AI tokens (input + output combined) allowed today. 0 = unlimited."""
    tier = plan_tier(user)
    if tier == "enterprise":
        return settings.ENTERPRISE_DAILY_TOKEN_BUDGET
    if tier == "pro":
        return settings.PRO_DAILY_TOKEN_BUDGET
    return settings.FREE_DAILY_TOKEN_BUDGET


# ── Usage counters ────────────────────────────────────────────────────────────

def count_uploads_this_month(db: Session, user_id: str) -> int:
    # DB-side NOW() so app-server / DB clock drift cannot skew the counter.
    month_start = func.date_trunc("month", func.now())
    return (
        db.query(func.count(Lecture.id))
        .filter(Lecture.user_id == user_id, Lecture.created_at >= month_start)
        .scalar()
        or 0
    )


def count_coach_messages_this_month(db: Session, user_id: str) -> int:
    """User-role coach messages + legacy performance /students/me/chat calls."""
    month_start = func.date_trunc("month", func.now())
    cm = (
        db.query(func.count(CoachMessage.id))
        .filter(
            CoachMessage.student_id == str(user_id),
            CoachMessage.role == "user",
            CoachMessage.created_at >= month_start,
        )
        .scalar()
        or 0
    )
    pc = (
        db.query(func.count(CoachPerformanceUsage.id))
        .filter(
            CoachPerformanceUsage.user_id == str(user_id),
            CoachPerformanceUsage.created_at >= month_start,
        )
        .scalar()
        or 0
    )
    return int(cm) + int(pc)


def count_tokens_today(db: Session, user_id: str) -> int:
    """Sum of tokens_total for all AI calls made by this user today (UTC)."""
    from app.models.billing import AIUsageLog
    from datetime import datetime, timezone

    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = (
        db.query(func.coalesce(func.sum(AIUsageLog.tokens_total), 0))
        .filter(
            AIUsageLog.user_id == user_id,
            AIUsageLog.created_at >= day_start,
        )
        .scalar()
    )
    return int(result or 0)


# ── Assertion guards (raise 403/429 if limit exceeded) ───────────────────────

def assert_can_upload(db: Session, user: User) -> None:
    limit = upload_limit_for_user(user)
    n = count_uploads_this_month(db, user.id)
    if n >= limit:
        tier = plan_tier(user)
        # Free users with credits can keep uploading — 1 credit per upload
        if tier == "free" and (user.credit_balance or 0) > 0:
            return
        from fastapi import HTTPException, status
        if tier == "free":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": "You've used your free uploads this month.",
                    "hint": "Purchase credits to keep uploading — 1 credit per upload.",
                    "upgrade_required": True,
                },
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": f"Monthly upload limit reached ({n}/{limit}).",
                "hint": "Try again next month or contact support.",
                "upgrade_required": False,
            },
        )


def assert_can_send_coach_message(
    db: Session, user: User, model_preference: str = ""
) -> None:
    tier = plan_tier(user)

    # Paid users: always allowed regardless of model
    if tier in ("pro", "enterprise"):
        return

    # Free users: Gemini requires credits
    if model_preference == "gemini":
        if (user.credit_balance or 0) <= 0:
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": "Gemini is a Pro feature.",
                    "hint": "Upgrade to Pro or purchase credits to use Gemini.",
                    "upgrade_required": True,
                },
            )
        return  # has credits — allow through, credits will be spent in the endpoint

    # Free users on Llama: enforce monthly cap
    limit = coach_limit_for_user(user)
    n = count_coach_messages_this_month(db, user.id)
    if n >= limit:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": f"Free limit reached ({n}/{limit} messages this month).",
                "hint": "Upgrade to Pro for unlimited messages and a coach that remembers you.",
                "upgrade_required": True,
            },
        )


def assert_within_daily_token_budget(db: Session, user: User) -> None:
    """Raise 429 if user has exhausted today's token budget."""
    budget = daily_token_budget(user)
    if budget == 0:
        return  # unlimited
    used = count_tokens_today(db, user.id)
    if used >= budget:
        from fastapi import HTTPException, status

        tier = plan_tier(user)
        hint = (
            "Upgrade to Pro for a 75× higher daily limit."
            if tier == "free"
            else "Daily limit resets at midnight UTC."
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily AI token budget reached ({used:,}/{budget:,} tokens). {hint}",
        )


# ── AI usage logging ──────────────────────────────────────────────────────────

def log_ai_usage(
    db: Session,
    *,
    user_id: str,
    feature: str,
    model: str,
    tokens_input: int,
    tokens_output: int,
    commit: bool = True,
) -> None:
    """Persist one AI call to ai_usage_logs. Call after every successful response."""
    from app.models.billing import AIUsageLog

    total = tokens_input + tokens_output
    premium_models = {settings.PREMIUM_AI_MODEL, settings.PREMIUM_CHAT_MODEL}
    rate = (
        settings.COST_PER_1K_TOKENS_PREMIUM
        if model in premium_models
        else settings.COST_PER_1K_TOKENS_FREE
    )
    cost_usd = (total / 1000) * rate

    db.add(
        AIUsageLog(
            user_id=user_id,
            feature=feature,
            model=model,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            tokens_total=total,
            cost_usd=cost_usd,
        )
    )
    if commit:
        db.commit()
    else:
        db.flush()


# ── Credit spend/refund ───────────────────────────────────────────────────────

def try_spend_credits(db: Session, user: User, amount: int, *, commit: bool = True) -> bool:
    """
    Atomically subtract overflow credits. Returns True if the action may proceed.

    Pro/Enterprise subscribers always return True without touching the balance —
    their plan covers quota-included actions. Credits on paid plans are overflow
    capacity managed separately.
    """
    if amount <= 0:
        return True
    if plan_tier(user) in ("pro", "enterprise"):
        return True  # plan covers this action — no credit charge
    res = db.execute(
        text(
            "UPDATE users SET credit_balance = credit_balance - :amt "
            "WHERE id = :id AND credit_balance >= :amt"
        ),
        {"amt": amount, "id": user.id},
    )
    if commit:
        db.commit()
    else:
        db.flush()
    ok = bool(getattr(res, "rowcount", 0))
    if ok:
        db.refresh(user)
    return ok


def refund_credits(db: Session, user: User, amount: int, *, commit: bool = True) -> None:
    """Restore overflow credits (e.g. after a failed AI call)."""
    if amount <= 0:
        return
    if plan_tier(user) in ("pro", "enterprise"):
        return  # nothing was charged
    db.execute(
        text("UPDATE users SET credit_balance = credit_balance + :amt WHERE id = :id"),
        {"amt": amount, "id": user.id},
    )
    if commit:
        db.commit()
    else:
        db.flush()
    db.refresh(user)


# ── Quality-selection helpers (used before AI calls) ─────────────────────────

def has_premium_access(user: User) -> bool:
    """True for pro/enterprise OR free users with credits."""
    if plan_tier(user) in ("pro", "enterprise"):
        return True
    return (user.credit_balance or 0) > 0


def will_use_premium_for_mcq(user: User) -> bool:
    """True if the next MCQ process will use the premium model."""
    return has_premium_access(user)


def will_use_premium_for_coach(user: User) -> bool:
    """True if the next coach message will use the premium model."""
    return has_premium_access(user)
