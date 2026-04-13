"""
AI Tools API - Memory management endpoints for persistent student context.
"""
from typing import List
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.api.deps import get_current_user
from app.models.models import User
from app.models.ai_tools import StudentMemory


router = APIRouter(prefix="/api/v1/ai-tools", tags=["ai-tools"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class MemorySaveRequest(BaseModel):
    key: str = Field(..., min_length=1, max_length=100, description="Unique identifier (snake_case)")
    label: str = Field(..., min_length=1, max_length=200, description="Human-readable label")
    value: str = Field(..., min_length=1, description="The fact to store")
    type: str = Field(default="context", description="identity|goal|context|behavior|emotional")
    importance: float = Field(default=0.5, ge=0.0, le=1.0, description="Importance score 0.0-1.0")
    reason: str | None = Field(default=None, description="Why this memory is worth saving")


class MemoryOut(BaseModel):
    id: str
    key: str
    label: str
    value: str
    type: str
    importance: float
    reason: str | None
    created_at: datetime
    updated_at: datetime
    last_accessed_at: datetime

    class Config:
        from_attributes = True


# ── Helper Function ───────────────────────────────────────────────────────────

def tool_save_memory(
    student_id: str,
    key: str,
    label: str,
    value: str,
    db: Session,
    type: str = "context",
    importance: float = 0.5,
    reason: str | None = None,
) -> StudentMemory:
    """
    Save or update a memory for a student.
    Used by AI coach to persist facts across conversations.
    """
    now = datetime.now(timezone.utc)
    
    # Check if memory already exists
    existing = db.query(StudentMemory).filter(
        StudentMemory.student_id == student_id,
        StudentMemory.key == key,
    ).first()
    
    if existing:
        # Update existing memory
        existing.label = label
        existing.value = value
        existing.type = type
        existing.importance = importance
        existing.reason = reason
        existing.updated_at = now
        existing.last_accessed_at = now
        db.commit()
        db.refresh(existing)
        return existing
    else:
        # Create new memory
        memory = StudentMemory(
            student_id=student_id,
            key=key,
            label=label,
            value=value,
            type=type,
            importance=importance,
            reason=reason,
            created_at=now,
            updated_at=now,
            last_accessed_at=now,
        )
        db.add(memory)
        db.commit()
        db.refresh(memory)
        return memory


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/memory", response_model=MemoryOut, status_code=status.HTTP_201_CREATED)
def save_memory(
    body: MemorySaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Save or update a memory for the current user.
    If a memory with the same key exists, it will be updated.
    """
    memory = tool_save_memory(
        student_id=current_user.id,
        key=body.key,
        label=body.label,
        value=body.value,
        db=db,
        type=body.type,
        importance=body.importance,
        reason=body.reason,
    )
    return memory


@router.get("/memory", response_model=List[MemoryOut])
def list_memories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all memories for the current user, ordered by importance (descending).
    """
    memories = (
        db.query(StudentMemory)
        .filter(StudentMemory.student_id == current_user.id)
        .order_by(StudentMemory.importance.desc(), StudentMemory.updated_at.desc())
        .all()
    )
    
    # Update last_accessed_at for all retrieved memories
    now = datetime.now(timezone.utc)
    for memory in memories:
        memory.last_accessed_at = now
    db.commit()
    
    return memories


@router.get("/memory/{key}", response_model=MemoryOut)
def get_memory(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific memory by key.
    """
    memory = db.query(StudentMemory).filter(
        StudentMemory.student_id == current_user.id,
        StudentMemory.key == key,
    ).first()
    
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with key '{key}' not found",
        )
    
    # Update last_accessed_at
    memory.last_accessed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(memory)
    
    return memory


@router.delete("/memory/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Delete a specific memory by key.
    """
    memory = db.query(StudentMemory).filter(
        StudentMemory.student_id == current_user.id,
        StudentMemory.key == key,
    ).first()
    
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with key '{key}' not found",
        )
    
    db.delete(memory)
    db.commit()
    return None


@router.delete("/memory", status_code=status.HTTP_204_NO_CONTENT)
def clear_all_memories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Delete all memories for the current user.
    """
    db.query(StudentMemory).filter(
        StudentMemory.student_id == current_user.id
    ).delete()
    db.commit()
    return None


# ── Internal helper (not an endpoint) ────────────────────────────────────────

def get_all_memories(student_id: str, db: Session) -> list[dict]:
    """
    Return all memories for a student as plain dicts, ordered by importance.
    Used by _build_student_context in performance.py to inject facts into
    the AI system prompt without going through the HTTP layer.
    """
    memories = (
        db.query(StudentMemory)
        .filter(StudentMemory.student_id == student_id)
        .order_by(StudentMemory.importance.desc(), StudentMemory.updated_at.desc())
        .all()
    )
    return [
        {
            "key": m.key,
            "label": m.label,
            "value": m.value,
            "type": m.type,
            "importance": m.importance,
            "reason": m.reason,
        }
        for m in memories
    ]
