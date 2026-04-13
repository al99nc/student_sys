from pydantic_settings import BaseSettings
from pydantic import field_validator
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
    AI_MODEL: str = "llama-3.3-70b-versatile"
    ANALYZER_MODEL: str = "gpt-oss-120b"
    HUMANIZER_MODEL: str = "llama-3.3-70b-versatile"
    CHAT_AI_MODEL: str = "gpt-oss-120b"
    DATABASE_URL: str = "sqlite:///./students.db"
    UPLOAD_DIR: str = "uploads"
    TELEGRAM_BOT_TOKEN: str = ""

    # Comma-separated list of allowed CORS origins.
    # Avoids hardcoding production IPs directly in source code.
    # Example in .env:  CORS_ORIGINS=http://localhost:3000,https://themcq.xyz
    CORS_ORIGINS: str = "http://localhost:3000,https://themcq.xyz,https://www.themcq.xyz"

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
