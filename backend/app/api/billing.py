import logging
import time

import httpx
import stripe
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.entitlements import (
    coach_limit_for_user,
    count_coach_messages_this_month,
    count_tokens_today,
    count_uploads_this_month,
    daily_token_budget,
    is_premium,
    plan_tier,
    resolve_entitlements,
    upload_limit_for_user,
)
from app.core.limiter import limiter
from app.db.database import get_db
from app.models.billing import Subscription
from app.models.models import CheckoutPayment, User, WaylPayment

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class CheckoutSessionBody(BaseModel):
    credits: int = Field(..., ge=1, le=1_000_000, description="How many credits to buy (pay-as-you-go)")


class SubscribeBody(BaseModel):
    price_id: str = Field(..., description="Stripe Price ID for the chosen plan/interval")


class CheckoutSessionOut(BaseModel):
    checkout_url: str


class BillingConfigOut(BaseModel):
    credit_price_cents: int
    currency: str
    pro_monthly_price_id: str
    pro_yearly_price_id: str
    credit_price_iqd: int


class WaylCheckoutBody(BaseModel):
    credits: int = Field(..., ge=1, le=1_000_000, description="How many credits to buy via Wayl (IQD)")


class WaylCheckoutOut(BaseModel):
    checkout_url: str
    reference_id: str


class EntitlementsOut(BaseModel):
    plan: str
    premium: bool
    credit_balance: int
    uploads_this_month: int
    uploads_limit: int
    coach_messages_this_month: int
    coach_messages_limit: int
    tokens_used_today: int
    daily_token_budget: int
    free_ai_model: str
    premium_ai_model: str
    credit_cost_mcq_process: float       # actual credits (3.0)
    credit_cost_coach_message: float      # actual credits (0.5)
    extra_usage_enabled: bool
    # Capability flags — false for free, true for pro/enterprise
    has_coach_memory: bool
    has_analytics: bool
    has_exam_simulator: bool
    has_cross_doc_query: bool
    has_spaced_repetition: bool
    has_export: bool
    has_priority_queue: bool


# ── Internal helpers ──────────────────────────────────────────────────────────

def _stripe_ready() -> bool:
    return bool(settings.CHECKOUT_SECRET_KEY and settings.CHECKOUT_SECRET_KEY.strip())


def _get_stripe_key() -> str:
    if not _stripe_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Checkout is not configured (missing CHECKOUT_SECRET_KEY)",
        )
    return settings.CHECKOUT_SECRET_KEY.strip()


def _plan_for_price_id(price_id: str) -> str:
    """Map a Stripe Price ID to a plan name."""
    pro_ids = {settings.STRIPE_PRICE_PRO_MONTHLY, settings.STRIPE_PRICE_PRO_YEARLY}
    if price_id in pro_ids:
        return "pro"
    # Unknown price IDs default to pro (safer than downgrading to free).
    return "pro"


def _upsert_subscription(
    db: Session,
    *,
    stripe_sub_id: str,
    stripe_customer_id: str,
    user_id: str,
    plan: str,
    status_str: str,
    current_period_end: datetime | None,
    cancel_at_period_end: bool,
) -> None:
    """Create or update the local Subscription row and sync user.plan."""
    sub = (
        db.query(Subscription)
        .filter(Subscription.stripe_subscription_id == stripe_sub_id)
        .first()
    )
    if sub is None:
        sub = Subscription(
            user_id=user_id,
            stripe_subscription_id=stripe_sub_id,
            stripe_customer_id=stripe_customer_id,
            plan=plan,
            status=status_str,
            current_period_end=current_period_end,
            cancel_at_period_end=int(cancel_at_period_end),
        )
        db.add(sub)
    else:
        sub.plan = plan
        sub.status = status_str
        sub.current_period_end = current_period_end
        sub.cancel_at_period_end = int(cancel_at_period_end)
        sub.updated_at = datetime.now(timezone.utc)

    # Keep user.plan in sync.
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        if status_str in ("active", "trialing"):
            user.plan = plan
        elif status_str in ("canceled", "unpaid", "incomplete_expired"):
            user.plan = "free"
        if stripe_customer_id and not user.stripe_customer_id:
            user.stripe_customer_id = stripe_customer_id

    db.commit()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/entitlements", response_model=EntitlementsOut)
def get_entitlements(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = str(current_user.id)
    ent = resolve_entitlements(current_user)
    return EntitlementsOut(
        plan=ent.tier,
        premium=is_premium(current_user),
        credit_balance=current_user.credit_balance or 0,
        uploads_this_month=count_uploads_this_month(db, uid),
        uploads_limit=ent.uploads_limit,
        coach_messages_this_month=count_coach_messages_this_month(db, uid),
        coach_messages_limit=ent.coach_limit,
        tokens_used_today=count_tokens_today(db, uid),
        daily_token_budget=ent.daily_token_budget,
        free_ai_model=settings.FREE_AI_MODEL,
        premium_ai_model=settings.PREMIUM_AI_MODEL,
        # Convert internal units to actual credits (1 unit = 0.5 credits)
        credit_cost_mcq_process=settings.CREDIT_COST_MCQ_PROCESS / 2.0,
        credit_cost_coach_message=settings.CREDIT_COST_COACH_MESSAGE / 2.0,
        extra_usage_enabled=bool(current_user.extra_usage_enabled),
        has_coach_memory=ent.has_coach_memory,
        has_analytics=ent.has_analytics,
        has_exam_simulator=ent.has_exam_simulator,
        has_cross_doc_query=ent.has_cross_doc_query,
        has_spaced_repetition=ent.has_spaced_repetition,
        has_export=ent.has_export,
        has_priority_queue=ent.has_priority_queue,
    )


@router.get("/config", response_model=BillingConfigOut)
def billing_config():
    """Public pricing — credit purchases and subscription price IDs."""
    return BillingConfigOut(
        credit_price_cents=settings.CREDIT_PRICE_CENTS,
        currency=settings.CHECKOUT_CURRENCY.upper(),
        pro_monthly_price_id=settings.STRIPE_PRICE_PRO_MONTHLY,
        pro_yearly_price_id=settings.STRIPE_PRICE_PRO_YEARLY,
        credit_price_iqd=settings.CREDIT_PRICE_IQD,
    )


@router.post("/extra-usage/toggle")
def toggle_extra_usage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle extra usage setting (allow spending credits when limit is hit)."""
    current_user.extra_usage_enabled = 1 - current_user.extra_usage_enabled
    db.commit()
    return {"extra_usage_enabled": bool(current_user.extra_usage_enabled)}


@router.post("/checkout-session", response_model=CheckoutSessionOut)
@limiter.limit("20/minute")
def create_checkout_session(
    request: Request,
    body: CheckoutSessionBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Overflow credit purchase via Stripe Checkout (Pro/Enterprise subscribers only)."""
    if plan_tier(current_user) not in ("pro", "enterprise"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Overflow credits are available to Pro and Enterprise subscribers only. Upgrade your plan first.",
        )
    stripe.api_key = _get_stripe_key()
    credits = body.credits
    total_cents = credits * settings.CREDIT_PRICE_CENTS
    if total_cents < 50:
        raise HTTPException(
            status_code=400,
            detail=f"Minimum purchase is {max(1, (49 + settings.CREDIT_PRICE_CENTS) // settings.CREDIT_PRICE_CENTS)} credits at this price.",
        )

    base = settings.APP_PUBLIC_URL.rstrip("/")
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            customer=current_user.stripe_customer_id or None,
            line_items=[
                {
                    "price_data": {
                        "currency": settings.CHECKOUT_CURRENCY.lower(),
                        "product_data": {
                            "name": f"{credits} credits",
                            "description": "Pay-as-you-go study credits",
                        },
                        "unit_amount": total_cents,
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{base}/billing?checkout=success",
            cancel_url=f"{base}/billing?checkout=canceled",
            client_reference_id=current_user.id,
            metadata={"user_id": current_user.id, "credits": str(credits), "type": "credits"},
        )
    except stripe.StripeError as e:
        logger.exception("Stripe checkout session failed: %s", e)
        raise HTTPException(status_code=502, detail="Payment provider error") from e

    if not session.url:
        raise HTTPException(status_code=502, detail="No checkout URL returned")
    return CheckoutSessionOut(checkout_url=session.url)


@router.post("/subscribe", response_model=CheckoutSessionOut)
@limiter.limit("10/minute")
def create_subscription_session(
    request: Request,
    body: SubscribeBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Start a Stripe Checkout session for a recurring subscription.
    After Stripe confirms payment, the webhook sets user.plan automatically.
    """
    stripe.api_key = _get_stripe_key()

    if not body.price_id:
        raise HTTPException(status_code=400, detail="price_id is required")

    base = settings.APP_PUBLIC_URL.rstrip("/")
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=current_user.stripe_customer_id or None,
            line_items=[{"price": body.price_id, "quantity": 1}],
            success_url=f"{base}/billing?checkout=subscribed",
            cancel_url=f"{base}/billing?checkout=canceled",
            client_reference_id=current_user.id,
            metadata={"user_id": current_user.id, "type": "subscription"},
        )
    except stripe.StripeError as e:
        logger.exception("Stripe subscription session failed: %s", e)
        raise HTTPException(status_code=502, detail="Payment provider error") from e

    if not session.url:
        raise HTTPException(status_code=502, detail="No checkout URL returned")
    return CheckoutSessionOut(checkout_url=session.url)


@router.post("/cancel-subscription", status_code=200)
def cancel_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Schedule the active subscription to cancel at period end.
    The user keeps access until current_period_end; the webhook finalises downgrade.
    """
    stripe.api_key = _get_stripe_key()

    sub = (
        db.query(Subscription)
        .filter(
            Subscription.user_id == current_user.id,
            Subscription.status.in_(["active", "trialing"]),
        )
        .order_by(Subscription.created_at.desc())
        .first()
    )
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription found.")

    try:
        stripe.Subscription.modify(
            sub.stripe_subscription_id,
            cancel_at_period_end=True,
        )
    except stripe.StripeError as e:
        logger.exception("Stripe cancel failed: %s", e)
        raise HTTPException(status_code=502, detail="Payment provider error") from e

    sub.cancel_at_period_end = 1
    sub.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"detail": "Subscription will cancel at end of billing period."}


# ── Stripe webhook ────────────────────────────────────────────────────────────

@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    if not _stripe_ready() or not settings.CHECKOUT_WEBHOOK_SECRET.strip():
        raise HTTPException(status_code=503, detail="Webhook not configured")

    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    if not sig:
        raise HTTPException(status_code=400, detail="Missing stripe-signature")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig, settings.CHECKOUT_WEBHOOK_SECRET.strip()
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid payload") from e
    except stripe.SignatureVerificationError as e:
        raise HTTPException(status_code=400, detail="Invalid signature") from e

    etype = event["type"]
    data = event["data"]["object"]

    # ── One-time credit purchase ─────────────────────────────────────
    if etype == "checkout.session.completed":
        meta = data.get("metadata") or {}
        purchase_type = meta.get("type", "credits")

        if purchase_type == "credits":
            _handle_credits_purchase(db, data)
        # subscription checkout.session.completed fires first but the
        # subscription object is provisioned via customer.subscription.* events below.

    # ── Subscription lifecycle ────────────────────────────────────────
    elif etype in (
        "customer.subscription.created",
        "customer.subscription.updated",
    ):
        _handle_subscription_upsert(db, data)

    elif etype == "customer.subscription.deleted":
        _handle_subscription_deleted(db, data)

    elif etype == "invoice.paid":
        # Renew: extend current_period_end via the subscription update path.
        sub_id = data.get("subscription")
        if sub_id:
            try:
                stripe_sub = stripe.Subscription.retrieve(sub_id)
                _handle_subscription_upsert(db, stripe_sub)
            except stripe.StripeError:
                pass  # best-effort; next subscription.updated will fix it

    elif etype == "invoice.payment_failed":
        sub_id = data.get("subscription")
        if sub_id:
            sub = (
                db.query(Subscription)
                .filter(Subscription.stripe_subscription_id == sub_id)
                .first()
            )
            if sub:
                sub.status = "past_due"
                sub.updated_at = datetime.now(timezone.utc)
                db.commit()

    return {"received": True}


# ── Webhook sub-handlers ──────────────────────────────────────────────────────

def _handle_credits_purchase(db: Session, sess: dict) -> None:
    session_id = sess.get("id")
    meta = sess.get("metadata") or {}
    user_id = meta.get("user_id")
    credits_raw = meta.get("credits")

    if not session_id or not user_id or credits_raw is None:
        logger.warning("Credits checkout missing metadata: %s", session_id)
        return

    try:
        credits = int(credits_raw)
    except (TypeError, ValueError):
        logger.warning("Invalid credits value in metadata for session %s", session_id)
        return

    if credits < 1:
        return

    if sess.get("payment_status") != "paid":
        return

    # Idempotency check
    if db.query(CheckoutPayment).filter(
        CheckoutPayment.stripe_checkout_session_id == session_id
    ).first():
        return

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.error("Webhook for unknown user %s session %s", user_id, session_id)
        return

    db.add(CheckoutPayment(
        stripe_checkout_session_id=session_id,
        user_id=user_id,
        credits=credits,
    ))
    if user.credit_balance is None:
        user.credit_balance = 0
    user.credit_balance += credits

    # Store customer ID for future checkouts (skip re-creating the customer)
    customer_id = sess.get("customer")
    if customer_id and not user.stripe_customer_id:
        user.stripe_customer_id = customer_id

    db.commit()
    logger.info("Credited %s credits to user %s (session %s)", credits, user_id, session_id)


def _handle_subscription_upsert(db: Session, stripe_sub: dict) -> None:
    sub_id = stripe_sub.get("id")
    customer_id = stripe_sub.get("customer")
    stripe_status = stripe_sub.get("status", "")

    # Resolve user via customer ID or metadata
    user_id = _resolve_user_id(db, stripe_sub, customer_id)
    if not user_id:
        logger.warning("Cannot resolve user for subscription %s", sub_id)
        return

    # Determine plan from the first line-item price
    plan = "pro"
    items = (stripe_sub.get("items") or {}).get("data") or []
    if items:
        price_id = (items[0].get("price") or {}).get("id", "")
        plan = _plan_for_price_id(price_id)

    # current_period_end is a Unix timestamp
    period_end_ts = stripe_sub.get("current_period_end")
    period_end = (
        datetime.fromtimestamp(period_end_ts, tz=timezone.utc).replace(tzinfo=None)
        if period_end_ts
        else None
    )

    _upsert_subscription(
        db,
        stripe_sub_id=sub_id,
        stripe_customer_id=customer_id or "",
        user_id=user_id,
        plan=plan,
        status_str=stripe_status,
        current_period_end=period_end,
        cancel_at_period_end=bool(stripe_sub.get("cancel_at_period_end")),
    )
    logger.info("Subscription %s upserted for user %s — status=%s plan=%s", sub_id, user_id, stripe_status, plan)


def _handle_subscription_deleted(db: Session, stripe_sub: dict) -> None:
    sub_id = stripe_sub.get("id")
    customer_id = stripe_sub.get("customer")
    user_id = _resolve_user_id(db, stripe_sub, customer_id)
    if not user_id:
        return

    _upsert_subscription(
        db,
        stripe_sub_id=sub_id,
        stripe_customer_id=customer_id or "",
        user_id=user_id,
        plan="free",
        status_str="canceled",
        current_period_end=None,
        cancel_at_period_end=False,
    )
    logger.info("Subscription %s canceled — user %s downgraded to free", sub_id, user_id)


def _resolve_user_id(db: Session, stripe_obj: dict, customer_id: str | None) -> str | None:
    """
    Try to find user_id from:
    1. metadata.user_id on the Stripe object
    2. stripe_customer_id stored on a User row
    """
    meta = stripe_obj.get("metadata") or {}
    uid = meta.get("user_id")
    if uid:
        return uid

    if customer_id:
        user = db.query(User).filter(User.stripe_customer_id == customer_id).first()
        if user:
            return user.id

    return None


# ── Wayl helpers ──────────────────────────────────────────────────────────────

def _wayl_ready() -> bool:
    return bool(settings.WAYL_API_KEY and settings.WAYL_API_KEY.strip())


def _wayl_headers() -> dict:
    if not _wayl_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Wayl payment gateway is not configured (missing WAYL_API_KEY)",
        )
    return {"X-WAYL-AUTHENTICATION": settings.WAYL_API_KEY.strip()}


def _wayl_reference_id(user_id: str, credits: int) -> str:
    """Generate a unique, parseable Wayl referenceId."""
    ts = int(time.time() * 1000)
    # Keep user_id short — take last 8 hex chars of the UUID
    uid_short = str(user_id).replace("-", "")[-8:]
    return f"cq-{uid_short}-{credits}c-{ts}"


# ── Wayl routes ───────────────────────────────────────────────────────────────

@router.post("/wayl-checkout", response_model=WaylCheckoutOut)
@limiter.limit("20/minute")
def create_wayl_checkout(
    request: Request,
    body: WaylCheckoutBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Overflow credit purchase via Wayl/IQD (Pro/Enterprise subscribers only)."""
    if plan_tier(current_user) not in ("pro", "enterprise"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Overflow credits are available to Pro and Enterprise subscribers only. Upgrade your plan first.",
        )
    credits = body.credits
    total_iqd = credits * settings.CREDIT_PRICE_IQD

    if total_iqd < 1000:
        raise HTTPException(
            status_code=400,
            detail=f"Minimum payment is 1000 IQD. Buy at least {max(1, -(-1000 // settings.CREDIT_PRICE_IQD))} credits.",
        )

    reference_id = _wayl_reference_id(current_user.id, credits)
    base = settings.APP_PUBLIC_URL.rstrip("/")

    payload = {
        "env": "live",
        "referenceId": reference_id,
        "total": total_iqd,
        "currency": "IQD",
        "customParameter": f"{str(current_user.id)}:{credits}",
        "lineItem": [
            {"label": f"{credits} credits", "amount": total_iqd, "type": "increase"}
        ],
        "webhookUrl": f"{base}/api/billing/wayl-webhook",
        "webhookSecret": settings.WAYL_WEBHOOK_SECRET,
        "redirectionUrl": f"{base}/billing?checkout=success",
    }

    try:
        resp = httpx.post(
            f"{settings.WAYL_API_BASE_URL}/api/v1/links",
            json=payload,
            headers=_wayl_headers(),
            timeout=15,
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.exception("Wayl link creation failed: %s — %s", e.response.status_code, e.response.text)
        raise HTTPException(status_code=502, detail="Payment provider error") from e
    except httpx.RequestError as e:
        logger.exception("Wayl request error: %s", e)
        raise HTTPException(status_code=502, detail="Payment provider unreachable") from e

    data = resp.json().get("data", {})
    checkout_url = data.get("url")
    if not checkout_url:
        raise HTTPException(status_code=502, detail="No payment URL returned from Wayl")

    logger.info("Wayl link created ref=%s user=%s credits=%s total_iqd=%s", reference_id, current_user.id, credits, total_iqd)
    return WaylCheckoutOut(checkout_url=checkout_url, reference_id=reference_id)


@router.post("/wayl-verify/{reference_id}", status_code=200)
@limiter.limit("10/minute")
def wayl_verify_payment(
    request: Request,
    reference_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Call this after a Wayl payment to manually claim credits.
    Useful when the webhook can't reach localhost in development.
    Fetches the link from Wayl, confirms it's Complete, and credits the user.
    """
    # Already processed?
    if db.query(WaylPayment).filter(WaylPayment.wayl_reference_id == reference_id).first():
        return {"detail": "Already credited.", "credit_balance": current_user.credit_balance or 0}

    try:
        resp = httpx.get(
            f"{settings.WAYL_API_BASE_URL}/api/v1/links/{reference_id}",
            headers=_wayl_headers(),
            timeout=10,
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail="Could not reach Wayl to verify payment") from e

    link = resp.json().get("data", {})

    if link.get("status") != "Complete":
        raise HTTPException(
            status_code=400,
            detail=f"Payment not complete yet (status: {link.get('status', 'unknown')}). Pay first then retry.",
        )

    # Parse user_id and credits from customParameter — verify this link belongs to current user
    custom = link.get("customParameter") or ""
    try:
        owner_id, credits_raw = custom.split(":", 1)
        credits = int(credits_raw)
        assert credits >= 1
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse payment metadata.")

    if str(owner_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="This payment link does not belong to your account.")

    db.add(WaylPayment(wayl_reference_id=reference_id, user_id=str(current_user.id), credits=credits))
    if current_user.credit_balance is None:
        current_user.credit_balance = 0
    current_user.credit_balance += credits
    db.commit()

    logger.info("Wayl manual verify: credited %s credits to user %s (ref %s)", credits, current_user.id, reference_id)
    return {"detail": f"{credits} credits added.", "credit_balance": current_user.credit_balance}


@router.post("/wayl-sync", status_code=200)
@limiter.limit("5/minute")
def wayl_sync_payments(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Fetch all Complete Wayl links, find ones belonging to this user,
    and credit any that haven't been processed yet.
    """
    try:
        resp = httpx.get(
            f"{settings.WAYL_API_BASE_URL}/api/v1/links",
            headers=_wayl_headers(),
            params={"statuses": ["Complete"], "take": 100},
            timeout=15,
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail="Could not reach Wayl") from e

    links = resp.json().get("data", [])
    credited = 0
    total_credits = 0
    uid = str(current_user.id)

    for link in links:
        if link.get("status") != "Complete":
            continue
        custom = link.get("customParameter") or ""
        try:
            owner_id, credits_raw = custom.split(":", 1)
            credits = int(credits_raw)
            assert credits >= 1
        except Exception:
            continue

        if str(owner_id) != uid:
            continue

        ref = link.get("referenceId")
        if not ref:
            continue

        if db.query(WaylPayment).filter(WaylPayment.wayl_reference_id == ref).first():
            continue

        db.add(WaylPayment(wayl_reference_id=ref, user_id=uid, credits=credits))
        if current_user.credit_balance is None:
            current_user.credit_balance = 0
        current_user.credit_balance += credits
        credited += 1
        total_credits += credits

    if credited > 0:
        db.commit()

    logger.info("Wayl sync: credited %s credits across %s payments for user %s", total_credits, credited, uid)
    return {
        "payments_found": credited,
        "credits_added": total_credits,
        "credit_balance": current_user.credit_balance or 0,
    }


@router.post("/wayl-webhook", include_in_schema=False)
async def wayl_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Wayl calls this URL when a payment link status changes.
    We verify the payment by re-fetching the link from Wayl API before crediting.
    """
    if not _wayl_ready():
        raise HTTPException(status_code=503, detail="Wayl not configured")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    reference_id = payload.get("referenceId")
    if not reference_id:
        logger.warning("Wayl webhook missing referenceId: %s", payload)
        return {"received": True}

    incoming_status = payload.get("status", "")
    if incoming_status != "Complete":
        # Not a completed payment — acknowledge and ignore
        return {"received": True}

    # ── Independent verification: re-fetch link from Wayl ────────────────────
    try:
        verify_resp = httpx.get(
            f"{settings.WAYL_API_BASE_URL}/api/v1/links/{reference_id}",
            headers=_wayl_headers(),
            timeout=10,
        )
        verify_resp.raise_for_status()
    except Exception as e:
        logger.exception("Wayl webhook: failed to verify link %s — %s", reference_id, e)
        raise HTTPException(status_code=502, detail="Could not verify payment with Wayl")

    link = verify_resp.json().get("data", {})
    if link.get("status") != "Complete":
        logger.warning("Wayl webhook: link %s status is %s — skipping credit", reference_id, link.get("status"))
        return {"received": True}

    # ── Parse user_id and credits from customParameter ────────────────────────
    custom = link.get("customParameter") or ""
    try:
        user_id, credits_raw = custom.split(":", 1)
        credits = int(credits_raw)
        assert credits >= 1
    except Exception:
        logger.error("Wayl webhook: cannot parse customParameter '%s' for ref %s", custom, reference_id)
        return {"received": True}

    # ── Idempotency check ─────────────────────────────────────────────────────
    if db.query(WaylPayment).filter(WaylPayment.wayl_reference_id == reference_id).first():
        logger.info("Wayl webhook: ref %s already processed — skipping", reference_id)
        return {"received": True}

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.error("Wayl webhook: unknown user %s for ref %s", user_id, reference_id)
        return {"received": True}

    db.add(WaylPayment(wayl_reference_id=reference_id, user_id=user_id, credits=credits))
    if user.credit_balance is None:
        user.credit_balance = 0
    user.credit_balance += credits
    db.commit()

    logger.info("Wayl: credited %s credits to user %s (ref %s)", credits, user_id, reference_id)
    return {"received": True}
