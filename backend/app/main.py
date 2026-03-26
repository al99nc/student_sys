from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import Base, engine
from app.api import auth, lectures

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Students Study Assistant",
    description="Upload lectures, get MCQs, summaries, and key concepts powered by AI",
    version="1.0.0",
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://84.235.244.210:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(lectures.router)

@app.get("/")
def root():
    return {"message": "Students Study Assistant API is running"}

@app.get("/health")
def health():
    return {"status": "ok"}
