from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    AI_API_KEY: str = "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"
    AI_MODEL: str = "qwen/qwen3-235b-a22b:free"  # Qwen model
    DATABASE_URL: str = "sqlite:///./students.db"
    UPLOAD_DIR: str = "uploads"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
