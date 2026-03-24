from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    AI_API_KEY: str = "REMOVED"
    AI_MODEL: str = "openai/gpt-oss-120b"
    DATABASE_URL: str = "sqlite:///./students.db"
    UPLOAD_DIR: str = "uploads"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
