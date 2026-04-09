from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 20160  # 2 weeks
    AI_API_KEY: str = ""  # Set in .env file
    AI_API_KEYS: str = ""  # comma-separated extra keys, set in .env file
    CHAT_AI_API_KEY: str = ""  # Set in .env file
    AI_MODEL: str = "llama-3.3-70b-versatile"
    ANALYZER_MODEL: str = "gpt-oss-120b"  # Stage 1 - cold logic
    HUMANIZER_MODEL: str = "llama-3.3-70b-versatile"  # Stage 2 - warm tone
    CHAT_AI_MODEL: str = "gpt-oss-120b"
    DATABASE_URL: str = "sqlite:///./students.db"
    UPLOAD_DIR: str = "uploads"
    TELEGRAM_BOT_TOKEN: str = ""  # Set in .env file

    def get_all_api_keys(self) -> list[str]:
        keys = [self.AI_API_KEY] if self.AI_API_KEY else []
        if self.AI_API_KEYS:
            keys += [k.strip() for k in self.AI_API_KEYS.split(",") if k.strip()]
        return keys

    class Config:
        env_file = ("../.env", ".env")
        extra = "ignore"

settings = Settings()
