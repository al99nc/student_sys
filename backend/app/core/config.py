from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator
import os
import sys


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        is_production = (
            os.getenv("ENVIRONMENT", "").lower() in ("production", "prod")
            or os.getenv("ENV", "").lower() in ("production", "prod")
            or not os.getenv("DEBUG", "true").lower() in ("true", "1", "yes")
        )

        if is_production and ("dev-secret" in v or len(v) < 32):
            print(
                "\n" + "=" * 80 + "\n"
                "FATAL ERROR: Weak or default SECRET_KEY detected in production!\n"
                "The SECRET_KEY must be at least 32 characters and cannot contain 'dev-secret'.\n"
                "Generate a strong key with: python -c 'import secrets; print(secrets.token_urlsafe(32))'\n"
                "Set it in your .env file or environment variables.\n"
                "=" * 80 + "\n",
                file=sys.stderr,
            )
            sys.exit(1)

        if not is_production and ("dev-secret" in v or len(v) < 32):
            import warnings
            warnings.warn(
                "SECRET_KEY is weak or default — set a strong random value in production",
                stacklevel=2,
            )
        return v

    ALGORITHM: str = "HS256"
    # 1440 minutes = 24 hours.  Override via ACCESS_TOKEN_EXPIRE_MINUTES in .env.
    # Previous default was 20160 (14 days) which is too long for a JWT access token.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    AI_API_KEY: str = ""
    AI_API_KEYS: str = ""          # comma-separated extra keys
    CHAT_AI_API_KEY: str = ""

    # ── Gemini (Google AI Studio) ─────────────────────────────────────────────
    GEMINI_PAID_API_KEY: str = ""
    GEMINI_PAID_MODEL: str = "gemini-2.5-flash"   # overridable via .env
    GEMINI_API_BASE: str = "https://generativelanguage.googleapis.com/v1beta/openai"

    # ── OpenRouter (preferred for premium — no billing region issues) ─────────
    open_rout_PAID_API_KEY: str = ""
    open_rout_PAID_MODEL: str = "google/gemini-2.5-flash"

    # Legacy default used if code paths omit explicit tier; prefer FREE_* / PREMIUM_* below.
    AI_MODEL: str = "llama-3.3-70b-versatile"
    ANALYZER_MODEL: str = "gpt-oss-120b"
    HUMANIZER_MODEL: str = "llama-3.3-70b-versatile"
    CHAT_AI_MODEL: str = "openai/gpt-oss-120b"

    # Tiered models — free uses Groq, paid uses Gemini (synced from GEMINI_PAID_MODEL)
    FREE_AI_MODEL: str = "llama-3.3-70b-versatile"
    PREMIUM_AI_MODEL: str = "gemini-2.5-flash"
    FREE_CHAT_MODEL: str = "llama-3.3-70b-versatile"
    PREMIUM_CHAT_MODEL: str = "gemini-2.5-flash"

    @model_validator(mode="after")
    def _sync_gemini_model(self) -> "Settings":
        self.PREMIUM_AI_MODEL = self.GEMINI_PAID_MODEL
        self.PREMIUM_CHAT_MODEL = self.GEMINI_PAID_MODEL
        return self
    FREE_CHAT_TIMEOUT_S: float = 25.0
    PREMIUM_CHAT_TIMEOUT_S: float = 120.0
    FREE_INTER_CHUNK_WAIT_SECONDS: int = 60
    PREMIUM_INTER_CHUNK_WAIT_SECONDS: int = 20

    FREE_PDF_UPLOADS_PER_MONTH: int = 10
    FREE_COACH_MESSAGES_PER_MONTH: int = 300
    DATABASE_URL: str = "sqlite:///./students.db"
    UPLOAD_DIR: str = "uploads"
    TELEGRAM_BOT_TOKEN: str = ""

    # Stripe Checkout (pay-as-you-go credits). Secret key from Dashboard → Developers → API keys.
    CHECKOUT_SECRET_KEY: str = ""
    # Webhook signing secret from Dashboard → Developers → Webhooks → endpoint → Signing secret.
    CHECKOUT_WEBHOOK_SECRET: str = ""
    # Public URL of the frontend (success/cancel redirects). e.g. http://localhost:3000
    APP_PUBLIC_URL: str = "http://localhost:3000"
    # Price per credit in the smallest currency unit (e.g. cents for USD). 100 = $1.00 per credit.
    CREDIT_PRICE_CENTS: int = 100
    CHECKOUT_CURRENCY: str = "usd"

    # Credits consumed per action (0 = free for that action). Premium model runs only if spend succeeds.
    # Note: costs are in internal units where 2 units = 1 credit
    # So 3 credits = 6 units, 0.5 credits = 1 unit
    CREDIT_COST_MCQ_PROCESS: int = 6      # 3 credits
    CREDIT_COST_COACH_MESSAGE: int = 1    # 0.5 credits

    # ── Subscription plans ────────────────────────────────────────────
    # Stripe Price IDs for recurring subscriptions (set in .env).
    # Create products + prices in Stripe Dashboard, paste the price_xxx IDs here.
    STRIPE_PRICE_PRO_MONTHLY: str = ""     # e.g. price_1Pxxxxxxxxxxxxxx
    STRIPE_PRICE_PRO_YEARLY: str = ""

    # Plan limits — monthly caps per plan.
    PRO_PDF_UPLOADS_PER_MONTH: int = 100
    PRO_COACH_MESSAGES_PER_MONTH: int = 9_999   # effective unlimited

    # Daily AI token budgets (input + output combined).
    # 0 = unlimited (enterprise).
    FREE_DAILY_TOKEN_BUDGET: int = 8_000
    PRO_DAILY_TOKEN_BUDGET: int = 600_000
    ENTERPRISE_DAILY_TOKEN_BUDGET: int = 0   # unlimited

    # Approximate cost per 1 000 tokens (USD) for each model — used for cost_usd logging.
    # Update whenever model pricing changes; these do not affect billing, only reporting.
    COST_PER_1K_TOKENS_FREE: float = 0.0001   # llama-3.3-70b on Groq (very cheap)
    COST_PER_1K_TOKENS_PREMIUM: float = 0.0025  # gpt-oss-120b via OpenRouter

    # ── Redis (optional — enables fast global token counter) ─────────────────
    # Leave empty to use the DB-backed in-process cache fallback instead.
    # Format: redis://[:password@]host[:port][/db]  or  rediss:// for TLS
    REDIS_URL: str = ""

    # ── Global daily token fail-safe ──────────────────────────────────────────
    # Total input+output tokens allowed across ALL users per UTC day.
    # 0 = disabled (no global cap).
    # Tune based on your Groq/OpenRouter daily quota.
    # Example: Groq free tier = 200 000 TPD → set to 180 000 (10 % safety margin)
    GLOBAL_DAILY_TOKEN_BUDGET: int = 50_000_000

    # ── Wayl Payment Gateway (IQD — Iraqi Dinar) ─────────────────────────────
    # API key from your Wayl merchant dashboard.
    WAYL_API_KEY: str = ""
    WAYL_API_BASE_URL: str = "https://api.thewayl.com"
    # Secret sent to Wayl on link creation — Wayl will use it to sign webhooks (min 10 chars).
    # Must be set in .env — empty string disables Wayl webhook verification.
    WAYL_WEBHOOK_SECRET: str = ""
    # Price per credit in IQD (minimum total per link is 1000 IQD).
    CREDIT_PRICE_IQD: int = 5000

    # Comma-separated list of allowed CORS origins.
    # Avoids hardcoding production IPs directly in source code.
    # Example in .env:  CORS_ORIGINS=http://localhost:3000,https://themcq.xyz
    CORS_ORIGINS: str = "http://localhost:3000,https://themcq.xyz,https://www.themcq.xyz"

    def get_gemini_key(self, is_premium: bool) -> str:
        if is_premium and self.open_rout_PAID_API_KEY:
            return self.open_rout_PAID_API_KEY
        return self.GEMINI_PAID_API_KEY if is_premium else ""

    def get_premium_chat_url(self) -> str:
        if self.open_rout_PAID_API_KEY:
            return "https://openrouter.ai/api/v1/chat/completions"
        return f"{self.GEMINI_API_BASE.split('?')[0].rstrip('/')}/chat/completions"

    def get_premium_chat_model(self) -> str:
        if self.open_rout_PAID_API_KEY:
            return self.open_rout_PAID_MODEL
        return self.GEMINI_PAID_MODEL

    def get_all_api_keys(self) -> list[str]:
        keys = [self.AI_API_KEY] if self.AI_API_KEY else []
        if self.AI_API_KEYS:
            keys += [k.strip() for k in self.AI_API_KEYS.split(",") if k.strip()]
        return keys

    def get_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    class Config:
        env_file = ("../.env", ".env")
        extra = "ignore"


settings = Settings()
