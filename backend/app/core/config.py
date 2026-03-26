from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    AI_API_KEY: str = ""
    AI_API_KEYS: str = ""  # comma-separated extra keys: key1,key2,key3
    AI_MODEL: str = "openai/gpt-oss-120b"
    DATABASE_URL: str = "sqlite:///./students.db"
    UPLOAD_DIR: str = "uploads"

    def get_all_api_keys(self) -> list[str]:
        keys = [self.AI_API_KEY] if self.AI_API_KEY else []
        if self.AI_API_KEYS:
            keys += [k.strip() for k in self.AI_API_KEYS.split(",") if k.strip()]
        return keys

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
