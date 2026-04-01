from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.db.database import Base, engine
from app.api import auth, lectures, telegram
from app.api.telegram import bot_router
from app.api import performance
# Import performance models so Base.metadata includes them for create_all
import app.models.performance  # noqa: F401

# Create database tables
Base.metadata.create_all(bind=engine)

# Migrate: add new columns to existing tables if they don't exist yet
with engine.connect() as _conn:
    for _stmt in [
        "ALTER TABLE results ADD COLUMN share_token VARCHAR",
        "ALTER TABLE results ADD COLUMN view_count INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN uuid VARCHAR(36)",
        "ALTER TABLE users ADD COLUMN name VARCHAR(120)",
        "ALTER TABLE users ADD COLUMN university VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN college VARCHAR(120)",
        "ALTER TABLE users ADD COLUMN year_of_study INTEGER",
        "ALTER TABLE users ADD COLUMN subject VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN topic_area VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN level VARCHAR(50)",
        "ALTER TABLE lectures ADD COLUMN university VARCHAR(255)",
        "ALTER TABLE lectures ADD COLUMN college VARCHAR(120)",
        "ALTER TABLE lectures ADD COLUMN year_of_study INTEGER",
        "ALTER TABLE lectures ADD COLUMN subject VARCHAR(255)",
        "ALTER TABLE lectures ADD COLUMN topic_area VARCHAR(255)",
        "ALTER TABLE lectures ADD COLUMN level VARCHAR(50)",
    ]:
        try:
            _conn.execute(text(_stmt))
            _conn.commit()
        except Exception:
            pass  # column already exists

# Back-fill uuid for any existing users that don't have one yet
from uuid import uuid4 as _uuid4
with engine.connect() as _conn:
    try:
        rows = _conn.execute(text("SELECT id FROM users WHERE uuid IS NULL")).fetchall()
        for row in rows:
            _conn.execute(
                text("UPDATE users SET uuid = :uuid WHERE id = :id"),
                {"uuid": str(_uuid4()), "id": row[0]},
            )
        _conn.commit()
    except Exception:
        pass

app = FastAPI(
    title="Students Study Assistant",
    description="Upload lectures, get MCQs, summaries, and key concepts powered by AI",
    version="1.0.0",
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://84.235.244.210:3000",
        "https://cortexq.net",         # production web
        "https://www.cortexq.net",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(lectures.router)
app.include_router(telegram.router)
app.include_router(bot_router)
app.include_router(performance.router)

@app.get("/")
def root():
    return {"message": "Students Study Assistant API is running"}

@app.get("/health")
def health():
    return {"status": "ok"}
