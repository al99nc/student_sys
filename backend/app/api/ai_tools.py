"""
AI Tools — persistent memory and future tool endpoints the AI can trigger.

The AI signals tool use by including special fields in its JSON response.
The coach endpoint (`/api/v1/coach/conversations/{id}/messages`) detects
these fields and calls the relevant tool functions here automatically.

Current tools:
  save_memory   — upsert a personal fact about the student
  delete_memory — remove a saved fact

Student-facing REST endpoints (for UI display / management):
  GET    /api/v1/ai-tools/memory        list all saved memories
  DELETE /api/v1/ai-tools/memory/{key}  delete a memory by key
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert

from app.db.database import get_db
from app.api.deps import get_current_user
from app.models.models import User
from app.models.ai_tools import StudentMemory

router = APIRouter(prefix="/api/v1/ai-tools", tags=["ai-tools"])


# ── Internal tool functions (called by coach.py, not the student) ─────────────

def tool_save_memory(student_id: int, key: str, label: str, value: str, db: Session) -> dict:
    """
    Upsert a memory entry. If the key already exists, update label + value.
    Returns the saved record as a dict.
    """
    key = key.strip().lower().replace(" ", "_")[:100]
    label = label.strip()[:200]
    value = str(value).strip()

    existing = db.query(StudentMemory).filter(
        StudentMemory.student_id == student_id,
        StudentMemory.key == key,
    ).first()

    if existing:
        existing.label = label
        existing.value = value
        existing.updated_at = datetime.utcnow()
    else:
        existing = StudentMemory(
            student_id=student_id,
            key=key,
            label=label,
            value=value,
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)
    return _serialize(existing)


def tool_delete_memory(student_id: int, key: str, db: Session) -> bool:
    """Delete a memory by key. Returns True if deleted, False if not found."""
    key = key.strip().lower().replace(" ", "_")[:100]
    row = db.query(StudentMemory).filter(
        StudentMemory.student_id == student_id,
        StudentMemory.key == key,
    ).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def get_all_memories(student_id: int, db: Session) -> list[dict]:
    """Load all memories for a student — used by _build_student_context."""
    rows = (
        db.query(StudentMemory)
        .filter(StudentMemory.student_id == student_id)
        .order_by(StudentMemory.updated_at.desc())
        .all()
    )
    return [_serialize(r) for r in rows]


# ── Student-facing REST endpoints ─────────────────────────────────────────────

@router.get("/memory")
def list_memories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all memories Sage has saved about this student."""
    return get_all_memories(current_user.id, db)


@router.delete("/memory/{key}")
def delete_memory(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Let the student delete a memory entry."""
    deleted = tool_delete_memory(current_user.id, key, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"status": "deleted", "key": key}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(m: StudentMemory) -> dict:
    return {
        "key":        m.key,
        "label":      m.label,
        "value":      m.value,
        "updated_at": m.updated_at.isoformat(),
    }
