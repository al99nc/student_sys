"""
AI flashcard generation service.

Provides generate_flashcards_for_document() which calls Groq to produce
Anki-style flashcards from lecture PDF text chunks.
Also provides generate_and_save_flashcards() for use as a background task.
"""
import asyncio
import json
import logging
import re
from uuid import uuid4

import httpx

from app.core.config import settings
from app.services.generator import (
    GROQ_URL,
    _chunk_text,
    _THINKING_TAG_PATTERN,
    _parse_groq_retry_after,
)

logger = logging.getLogger(__name__)

_FLASHCARD_CHUNK_SIZE = 6_000
_FLASHCARD_MAX_CARDS_PER_CHUNK = 15

_SYSTEM_PROMPT = """You are a medical education expert creating Anki-style flashcards for university students.
Generate high-quality flashcards from the provided lecture content.

RULES:
1. Each card must have a clear, specific FRONT (question/prompt) and a BACK (complete answer).
2. One concept per card. Never put two ideas on one card.
3. card_type options: concept, definition, mechanism, comparison, clinical
4. Include a memory_tip for hard cards — a short mnemonic or analogy. Keep it under 15 words.
5. Do NOT generate cards for trivial facts (dates, author names, page numbers).
6. Focus on high-yield exam content: mechanisms, drug actions, pathophysiology, clinical presentations.
7. The front should be a question, not a statement. Bad: "Metformin mechanism". Good: "What is the primary mechanism of action of Metformin?"
8. Return ONLY valid JSON array. No markdown. No explanation."""


def _build_user_prompt(chunk_text: str, topic: str, mode: str, num_cards: int) -> str:
    return (
        f"LECTURE CONTENT:\n{chunk_text}\n\n"
        f"TOPIC: {topic}\n"
        f"MODE: {mode} (highyield = focus on most tested concepts; exam = broad coverage; revision = quick recall cards)\n\n"
        f"Generate {num_cards} flashcards. Return a JSON array:\n"
        "[\n"
        "  {\n"
        '    "front": "string",\n'
        '    "back": "string",\n'
        '    "memory_tip": "string or null",\n'
        '    "card_type": "concept|definition|mechanism|comparison|clinical",\n'
        '    "difficulty": "easy|medium|hard",\n'
        '    "source_text": "the exact phrase from the content this card is based on, max 100 chars"\n'
        "  }\n"
        "]"
    )


async def _call_flashcard_chunk(
    chunk_text: str,
    topic: str,
    mode: str,
    num_cards: int,
    api_key: str,
) -> list[dict]:
    user_prompt = _build_user_prompt(chunk_text, topic, mode, num_cards)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.FREE_AI_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.30,
        "max_tokens": 4_000,
        "presence_penalty": 0.2,
        "frequency_penalty": 0.2,
    }

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(GROQ_URL, headers=headers, json=payload)
                if resp.status_code == 429:
                    retry_in = _parse_groq_retry_after(resp.text)
                    await asyncio.sleep(retry_in + 1 if retry_in > 0 else 65)
                    continue
                if resp.status_code == 401:
                    raise RuntimeError("INVALID_KEY")
                resp.raise_for_status()

            raw = resp.json()["choices"][0]["message"].get("content") or ""
            cleaned = _THINKING_TAG_PATTERN.sub("", raw).strip()
            cleaned = re.sub(r"```(?:json)?", "", cleaned).strip().rstrip("```").strip()

            data = json.loads(cleaned)
            if not isinstance(data, list):
                raise ValueError("Expected JSON array")
            return data

        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("Flashcard chunk parse failed (attempt %d): %s", attempt + 1, e)
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
        except Exception as e:
            logger.warning("Flashcard chunk call failed (attempt %d): %s", attempt + 1, e)
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)

    return []


async def generate_flashcards_for_document(
    text_chunks: list[str],
    topic: str,
    document_id: int,
    mode: str = "highyield",
    num_cards: int = _FLASHCARD_MAX_CARDS_PER_CHUNK,
) -> list[dict]:
    """
    Generate flashcards from text chunks using Groq.
    Returns a list of raw card dicts (not yet saved to DB).
    Each dict has: front, back, memory_tip, card_type, difficulty, source_text.
    """
    api_key = settings.AI_API_KEY
    if not api_key:
        logger.warning("No AI API key — skipping flashcard generation")
        return []

    tasks = [
        _call_flashcard_chunk(chunk, topic, mode, num_cards, api_key)
        for chunk in text_chunks
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    cards: list[dict] = []
    for r in results:
        if isinstance(r, Exception):
            logger.warning("Flashcard chunk task failed: %s", r)
            continue
        if isinstance(r, list):
            cards.extend(r)

    return cards


def _dedup_cards(
    new_cards: list[dict],
    existing_fronts: set[str],
) -> list[dict]:
    seen: set[str] = set(existing_fronts)
    unique: list[dict] = []
    for card in new_cards:
        front_key = (card.get("front") or "").strip().lower()
        if not front_key:
            continue
        if front_key not in seen:
            seen.add(front_key)
            unique.append(card)
    return unique


def generate_and_save_flashcards(
    document_id: int,
    mode: str,
    db_session_factory,
) -> None:
    """
    Background task: generate flashcards for a document and save to DB.
    Called after MCQ generation completes.
    """
    import asyncio as _asyncio
    from app.models.flashcards import Flashcard
    from app.services.pdf_service import extract_text_from_pdf

    db = db_session_factory()
    try:
        from app.models.models import Lecture
        lecture = db.query(Lecture).filter(Lecture.id == document_id).first()
        if not lecture:
            logger.warning("generate_and_save_flashcards: lecture %s not found", document_id)
            return

        existing_count = db.query(Flashcard).filter(
            Flashcard.document_id == document_id
        ).count()
        if existing_count >= 5:
            logger.info(
                "Flashcards already exist for document %s (%d cards) — skipping",
                document_id, existing_count,
            )
            return

        try:
            text = extract_text_from_pdf(lecture.file_path)
        except Exception as e:
            logger.error("Could not extract text for flashcard generation: %s", e)
            return

        topic = lecture.topic_area or lecture.title or "General"
        chunks = _chunk_text(text, chunk_size=_FLASHCARD_CHUNK_SIZE)

        try:
            loop = _asyncio.new_event_loop()
            raw_cards = loop.run_until_complete(
                generate_flashcards_for_document(chunks, topic, document_id, mode)
            )
        except Exception as e:
            logger.error("Flashcard AI generation failed: %s", e)
            return
        finally:
            try:
                loop.close()
            except Exception:
                pass

        existing_fronts = {
            row[0].strip().lower()
            for row in db.query(Flashcard.front)
            .filter(Flashcard.document_id == document_id)
            .all()
        }

        unique_cards = _dedup_cards(raw_cards, existing_fronts)

        saved = 0
        for card in unique_cards:
            front = (card.get("front") or "").strip()
            back = (card.get("back") or "").strip()
            if not front or not back:
                continue
            db.add(Flashcard(
                id=str(uuid4()),
                document_id=document_id,
                topic=topic,
                front=front,
                back=back,
                memory_tip=(card.get("memory_tip") or "").strip() or None,
                card_type=card.get("card_type", "concept"),
                difficulty=card.get("difficulty", "medium"),
                source_text=(card.get("source_text") or "")[:500] or None,
            ))
            saved += 1

        db.commit()
        logger.info(
            "Flashcard background task: saved %d new cards for document %s",
            saved, document_id,
        )

    except Exception as e:
        logger.error("generate_and_save_flashcards failed: %s", e)
        db.rollback()
    finally:
        db.close()
