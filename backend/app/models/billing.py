"""
Billing models: Subscription and AIUsageLog.

Subscription  — tracks an active Stripe subscription (monthly/yearly).
               One active row per user at most.

AIUsageLog    — one row per AI call; used for cost tracking, per-user
               daily token budgets, and abuse detection.
"""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import BigInteger, Column, DateTime, Float, Integer, String, Text

from app.db.database import Base


def _uuid() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Subscription(Base):
    """
    Active Stripe subscription for a user.

    Lifecycle managed entirely through Stripe webhooks:
      customer.subscription.created / updated → upsert row, set plan on User
      customer.subscription.deleted           → status = "canceled", plan = "free"
      invoice.paid                            → extend current_period_end
    """

    __tablename__ = "subscriptions"

    id = Column(String(36), primary_key=True, default=_uuid)
    # No FK: legacy DBs may use integer user ids while the app model uses string UUIDs.
    user_id = Column(String(36), nullable=False, index=True)
    stripe_subscription_id = Column(String(255), unique=True, nullable=False, index=True)
    stripe_customer_id = Column(String(255), nullable=False)
    plan = Column(String(20), nullable=False)          # "pro" | "enterprise"
    status = Column(String(30), nullable=False)        # Stripe status: active, past_due, canceled …
    current_period_end = Column(DateTime, nullable=True)
    cancel_at_period_end = Column(Integer, default=0, server_default="0")  # boolean as int
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class AIUsageLog(Base):
    """
    One row per AI call — used for per-user daily token budgets,
    cost analytics, and abuse detection.

    tokens_input + tokens_output come from the API response usage object.
    If the provider does not return usage, estimate from text length.
    """

    __tablename__ = "ai_usage_logs"

    id = Column(String(36), primary_key=True, default=_uuid)
    # No FK: legacy DBs may use integer user ids while the app model uses string UUIDs.
    user_id = Column(String(36), nullable=False, index=True)
    feature = Column(String(50), nullable=False)       # "mcq_generate" | "coach" | "analysis" …
    model = Column(String(100), nullable=False)
    tokens_input = Column(Integer, default=0)
    tokens_output = Column(Integer, default=0)
    tokens_total = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)              # estimated cost at time of call
    created_at = Column(DateTime, default=_utcnow, index=True)
