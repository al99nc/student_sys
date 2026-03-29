from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.db.database import Base, engine
from app.api import auth, lectures, telegram

# Create database tables
Base.metadata.create_all(bind=engine)

# Migrate: add sharing columns to results table if they don't exist yet
with engine.connect() as _conn:
    for _stmt in [
        "ALTER TABLE results ADD COLUMN share_token VARCHAR",
        "ALTER TABLE results ADD COLUMN view_count INTEGER DEFAULT 0",
    ]:
        try:
            _conn.execute(text(_stmt))
            _conn.commit()
        except Exception:
            pass  # column already exists

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

@app.get("/")
def root():
    return {"message": "Students Study Assistant API is running"}

@app.get("/health")
def health():
    return {"status": "ok"}
