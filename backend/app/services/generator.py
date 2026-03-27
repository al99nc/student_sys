import asyncio
import json
import re
import time
import logging
import httpx
from typing import Dict, Any
from app.core.config import settings
from app.services.prompts import _get_prompts
from app.services.validators import (
    _deduplicate_by_question,
    _validate_and_filter_mcqs,
    _fix_explanation_prefix,
    _warn_answer_distribution,
    _warn_exam_format_distribution,
)

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────
# API ENDPOINT
# ─────────────────────────────────────────────────────────────────
OPENROUTER_URL = "https://api.groq.com/openai/v1/chat/completions"


# ─────────────────────────────────────────────────────────────────
# CHUNKING CONFIGURATION
# ─────────────────────────────────────────────────────────────────
CHUNK_SIZE = 3_000
CHUNK_OVERLAP = 200
MAX_CHUNKS = 20


# ─────────────────────────────────────────────────────────────────
# GROQ RATE LIMITS  (free tier, model: openai/gpt-oss-120b)
# Hard limits:  RPM 30 | TPM 8 000 | TPD 200 000
# We target 93 % of TPM (7 500) so a single request never crashes.
#
# Input-token budget per mode (system prompt + user template, no text):
#   highyield  ~6 000 chars  → ~1 500 tokens
#   exam       ~8 500 chars  → ~2 100 tokens
#   revision   ~3 600 chars  → ~  900 tokens
# One 8 000-char chunk ≈ 2 000 tokens.
#
# max_output = 7 500 − chunk_tokens − prompt_tokens
#   highyield:  7 500 − 2 000 − 1 500 = 4 000 → ~14.8 s @ 270 TPS
#   exam:       7 500 − 2 000 − 2 100 = 3 400 → ~12.6 s @ 270 TPS
#   revision:   7 500 − 2 000 −   900 = 4 600 → capped at 3 500
#
# Multi-chunk: processed sequentially; after each chunk we wait
# _INTER_CHUNK_WAIT seconds so the TPM window fully resets before
# the next request fires (avoids cascading 429 errors).
# ─────────────────────────────────────────────────────────────────
GROQ_RPM = 30           # hard limit: requests per minute
GROQ_TPM = 8_000        # hard limit: tokens per minute (input + output)
_SAFE_TPM = 7_500       # operating target: 93.75 % of GROQ_TPM
_INTER_CHUNK_WAIT = 60  # seconds between sequential chunks (full TPM reset)


# ─────────────────────────────────────────────────────────────────
# SPEED CONFIGURATION
# max_tokens is calculated from _SAFE_TPM minus prompt + chunk overhead
# so that each request stays within the TPM budget.
# ─────────────────────────────────────────────────────────────────
SPEED_CONFIG = {
    "highyield": {
        "max_tokens": 5_500,   # ceiling; natural output is ~2 500-3 500 tokens
        "temperature": 0.30,
        "presence_penalty": 0.3,
        "frequency_penalty": 0.3,
    },
    "exam": {
        "max_tokens": 5_000,   # caps exam at ~12 s @ 400 TPS (was 8 000 → ~20 s)
        "temperature": 0.35,
        "presence_penalty": 0.3,
        "frequency_penalty": 0.3,
    },
    "harder": {
        # Budget: ~1 400 prompt tokens + ~750 chunk tokens = ~2 150 input.
        # 8 000 TPM limit − 2 150 input = 5 850 headroom → cap at 4 500 for safety.
        "max_tokens": 4_500,
        "temperature": 0.40,
        "presence_penalty": 0.4,
        "frequency_penalty": 0.4,
    },
    "revision": {
        "max_tokens": 3_500,   # revision output is short; no change needed
        "temperature": 0.25,
        "presence_penalty": 0.2,
        "frequency_penalty": 0.2,
    },
}

# Actual Groq LPU generation speed for openai/gpt-oss-120b (~120B model).
# Used only for time estimates shown to the user; does not affect API calls.
ESTIMATED_TPS = 270

_THINKING_TAG_PATTERN = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


# ─────────────────────────────────────────────────────────────────
# TEXT CHUNKING
# ─────────────────────────────────────────────────────────────────

def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE) -> list[str]:
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(text) and len(chunks) < MAX_CHUNKS:
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - CHUNK_OVERLAP

    logger.info(
        f"Text split into {len(chunks)} chunks "
        f"({len(text):,} chars total, ~{chunk_size:,} chars each)"
    )
    return chunks


def _estimate_processing_time(text: str, mode: str) -> dict:
    chunks = _chunk_text(text)
    n_chunks = len(chunks)
    max_tokens = SPEED_CONFIG.get(mode, SPEED_CONFIG["highyield"])["max_tokens"]

    # TPS is output-generation speed; prefill (input) is near-instant on Groq LPUs.
    # For multi-chunk, add _INTER_CHUNK_WAIT seconds between sequential chunks.
    per_chunk_seconds = max_tokens / ESTIMATED_TPS + 2   # +2 for network + prefill
    total_seconds = per_chunk_seconds + _INTER_CHUNK_WAIT * max(0, n_chunks - 1)

    return {
        "chunks": n_chunks,
        "estimated_seconds": round(total_seconds),
        "estimated_range": (
            f"{max(5, round(total_seconds * 0.8))}–{round(total_seconds * 1.25)}s"
        ),
        "text_length_chars": len(text),
        "note": (
            f"Large document — {n_chunks} chunks processed sequentially "
            f"(~{round(total_seconds)}s total, free-tier TPM budget)."
            if n_chunks > 1
            else "Single chunk — fastest processing."
        ),
    }


# ─────────────────────────────────────────────────────────────────
# RATE-LIMIT HELPERS
# ─────────────────────────────────────────────────────────────────

def _parse_groq_retry_after(error_msg: str) -> float:
    """Return seconds to wait from a Groq 'Please try again in Xm Y.Zs' message."""
    # "20m8.303999999s"
    m = re.search(r"try again in (\d+)m([\d.]+)s", error_msg)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2))
    # "1m30s"
    m = re.search(r"try again in (\d+)m(\d+)s", error_msg)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2))
    # "45.5s"
    m = re.search(r"try again in ([\d.]+)s", error_msg)
    if m:
        return float(m.group(1))
    return 0.0


# ─────────────────────────────────────────────────────────────────
# SINGLE CHUNK API CALL
# ─────────────────────────────────────────────────────────────────

async def _call_single_chunk(
    text: str,
    mode: str,
    chunk_index: int,
    total_chunks: int,
    api_key: str | None = None,
    max_retries: int = 3,
) -> tuple[dict, float]:
    system_prompt, user_prompt_template = _get_prompts(mode)
    user_prompt = user_prompt_template.format(text=text)

    if total_chunks > 1:
        user_prompt += (
            f"\n\n[NOTE: This is chunk {chunk_index + 1} of {total_chunks} parallel chunks. "
            f"Generate 8-12 questions ONLY from this content. "
            "Do NOT repeat questions from other chunks. Keep explanations concise.]"
        )

    cfg = SPEED_CONFIG.get(mode, SPEED_CONFIG["highyield"])
    headers = {
        "Authorization": f"Bearer {api_key or settings.AI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.AI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": cfg["temperature"],
        "max_tokens": cfg["max_tokens"],
        "presence_penalty": cfg.get("presence_penalty", 0.3),
        "frequency_penalty": cfg.get("frequency_penalty", 0.3),
    }

    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            t_start = time.monotonic()

            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(OPENROUTER_URL, headers=headers, json=payload)
                if not resp.is_success:
                    logger.error(f"[{mode}] HTTP {resp.status_code}: {resp.text[:300]}")
                if resp.status_code == 429:
                    body = resp.text
                    if "per day" in body or "TPD" in body:
                        retry_in = _parse_groq_retry_after(body)
                        minutes = max(1, round(retry_in / 60))
                        raise RuntimeError(
                            f"DAILY_LIMIT: Daily token quota exhausted "
                            f"(200 000 tokens/day). Try again in ~{minutes} minutes."
                        )
                resp.raise_for_status()

            elapsed = time.monotonic() - t_start
            raw = resp.json()["choices"][0]["message"].get("content") or ""
            logger.debug(f"[{mode}] Raw AI response (first 500 chars): {raw[:500]!r}")

            if len(raw.strip()) < 50:
                # Groq sometimes returns HTTP 200 with null/empty content when TPM is
                # exhausted instead of a proper 429.  Tag the message with "429" so the
                # retry logic below treats it as a rate-limit and waits 65 s.
                raise ValueError(f"429-quota: empty response ({len(raw)} chars)")

            logger.info(
                f"[{mode}] Chunk {chunk_index + 1}/{total_chunks} done "
                f"in {elapsed:.1f}s (attempt {attempt + 1})"
            )

            cleaned = _THINKING_TAG_PATTERN.sub("", raw).strip()
            cleaned = re.sub(r"```(?:json)?", "", cleaned).strip().rstrip("```").strip()

            try:
                data = json.loads(cleaned)
            except json.JSONDecodeError:
                data = _salvage_partial_json(cleaned, chunk_index)

            if not data.get("mcqs"):
                raise ValueError("Response contained zero MCQs")

            return data, elapsed

        except Exception as e:
            last_error = e
            err_str = str(e)

            # Daily limit — propagate immediately so caller can rotate key
            if "DAILY_LIMIT" in err_str:
                raise

            is_429 = "429" in err_str

            # TPM (per-minute) or other 429 → wait for the window to reset.
            wait = 65 if is_429 else 2 ** attempt
            logger.warning(
                f"[{mode}] Chunk {chunk_index + 1} attempt {attempt + 1}/{max_retries} "
                f"failed: {e}. Retrying in {wait}s..."
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(wait)

    raise RuntimeError(
        f"Chunk {chunk_index + 1} failed after {max_retries} attempts. Last error: {last_error}"
    )


# ─────────────────────────────────────────────────────────────────
# PARTIAL JSON SALVAGE
# ─────────────────────────────────────────────────────────────────

def _salvage_partial_json(text: str, chunk_index: int = 0) -> dict:
    """Recover MCQs from truncated JSON responses.

    The original implementation tracked depth from the FIRST '{' (the outer wrapper),
    so it only emitted an object when depth returned to 0 — which never happens when the
    JSON is truncated.  MCQ objects live at depth 2+ and were silently discarded.

    This version tries every '{' as an independent candidate start.  For each one it
    tracks its own depth counter; when that counter hits 0 the closed object is tested
    for the MCQ fields.  This correctly extracts all complete MCQ objects regardless of
    how deeply they are nested or where the truncation occurs.
    """
    mcqs: list[dict] = []
    seen_questions: set[str] = set()
    n = len(text)

    for start in range(n):
        if text[start] != "{":
            continue
        depth = 0
        for end in range(start, n):
            c = text[end]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start: end + 1]
                    try:
                        obj = json.loads(candidate)
                        if (
                            isinstance(obj, dict)
                            and "question" in obj
                            and "options" in obj
                            and "answer" in obj
                        ):
                            q_key = obj["question"][:60]
                            if q_key not in seen_questions:
                                seen_questions.add(q_key)
                                mcqs.append(obj)
                    except json.JSONDecodeError:
                        pass
                    break  # done with this start position

    summary = ""
    summary_match = re.search(r'"summary"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    if summary_match:
        try:
            summary = json.loads(f'"{summary_match.group(1)}"')
        except json.JSONDecodeError:
            summary = summary_match.group(1)

    key_concepts: list[str] = []
    kc_match = re.search(r'"key_concepts"\s*:\s*(\[.*?\])', text, re.DOTALL)
    if kc_match:
        try:
            key_concepts = json.loads(kc_match.group(1))
        except json.JSONDecodeError:
            key_concepts = re.findall(r'"((?:[^"\\]|\\.)+)"', kc_match.group(1))

    if not mcqs and not summary:
        raise ValueError(f"Could not salvage any content from chunk {chunk_index + 1}")

    logger.warning(
        f"Chunk {chunk_index + 1}: JSON truncated — salvaged "
        f"{len(mcqs)} MCQ(s), summary={'yes' if summary else 'no'}"
    )
    return {"mcqs": mcqs, "summary": summary, "key_concepts": key_concepts}


# ─────────────────────────────────────────────────────────────────
# MERGE CHUNKS
# ─────────────────────────────────────────────────────────────────

def _merge_chunk_results(results: list[dict]) -> dict:
    if len(results) == 1:
        return results[0]

    merged_mcqs: list[dict] = []
    all_key_concepts: list[str] = []
    merged_summary = results[0].get("summary", "")

    for result in results:
        merged_mcqs.extend(result.get("mcqs", []))
        all_key_concepts.extend(result.get("key_concepts", []))

    seen_kc: set[str] = set()
    unique_key_concepts = []
    for kc in all_key_concepts:
        norm = kc.lower().strip()
        if norm not in seen_kc:
            seen_kc.add(norm)
            unique_key_concepts.append(kc)

    return {
        "summary": merged_summary,
        "key_concepts": unique_key_concepts[:12],
        "mcqs": merged_mcqs,
    }


# ─────────────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────────

async def _call_chunk_with_rotation(
    available_keys: list[str],
    text: str,
    mode: str,
    chunk_index: int,
    total_chunks: int,
) -> tuple[dict, float]:
    """Call a single chunk, rotating to the next API key on daily-limit errors."""
    last_error: Exception | None = None
    for key in list(available_keys):
        try:
            return await _call_single_chunk(text, mode, chunk_index, total_chunks, api_key=key)
        except RuntimeError as e:
            if "DAILY_LIMIT" in str(e):
                available_keys.remove(key)
                logger.warning(
                    f"[{mode}] Key ending ...{key[-6:]} hit daily limit — "
                    f"rotating to next key ({len(available_keys)} remaining)"
                )
                last_error = e
                continue
            raise
    raise RuntimeError(
        "DAILY_LIMIT: All API keys have hit their daily token quota (200 000 tokens/day). "
        "Add more keys to AI_API_KEYS in .env or wait until tomorrow."
    ) if last_error else RuntimeError("No API keys available")


async def generate_study_content(text: str, mode: str = "highyield") -> Dict[str, Any]:
    available_keys = settings.get_all_api_keys()
    if not available_keys:
        logger.warning("No API keys configured — returning mock data")
        return _get_mock_response()

    # Normalise unknown modes to highyield
    if mode not in SPEED_CONFIG:
        logger.warning(f"Unknown mode '{mode}' — falling back to highyield")
        mode = "highyield"

    time_estimate = _estimate_processing_time(text, mode)
    logger.info(
        f"[{mode}] Estimate: {time_estimate['chunks']} chunk(s), "
        f"~{time_estimate['estimated_range']}"
    )

    chunks = _chunk_text(text)
    total_chunks = len(chunks)

    try:
        t_total_start = time.monotonic()

        if total_chunks == 1:
            # Single chunk — fastest path, no rate-limit concerns.
            chunk_output = [await _call_chunk_with_rotation(available_keys, chunks[0], mode, 0, 1)]
        else:
            # Multi-chunk: process sequentially to stay within GROQ_TPM (8 000 tokens/min).
            # Each chunk uses ~_SAFE_TPM tokens; firing concurrently would exceed the budget
            # and cause cascading 429s.  After each chunk we wait _INTER_CHUNK_WAIT seconds
            # so the TPM window fully resets before the next request fires.
            chunk_output = []
            for i, chunk in enumerate(chunks):
                result = await _call_chunk_with_rotation(available_keys, chunk, mode, i, total_chunks)
                chunk_output.append(result)
                if i < total_chunks - 1:
                    elapsed = result[1]
                    refill_wait = max(2.0, _INTER_CHUNK_WAIT - elapsed)
                    logger.info(
                        f"[{mode}] TPM refill: waiting {refill_wait:.0f}s "
                        f"before chunk {i + 2}/{total_chunks}..."
                    )
                    await asyncio.sleep(refill_wait)

        chunk_results = [data for data, _ in chunk_output]
        chunk_timings = [round(elapsed, 2) for _, elapsed in chunk_output]
        total_elapsed = round(time.monotonic() - t_total_start, 2)

        merged = _merge_chunk_results(chunk_results)
        raw_mcqs = merged.get("mcqs", [])

        deduped = _deduplicate_by_question(raw_mcqs)
        valid_mcqs, rejected = _validate_and_filter_mcqs(deduped, mode)

        if rejected:
            logger.warning(
                f"[{mode}] {len(rejected)} MCQs rejected: "
                f"{[r['reasons'] for r in rejected]}"
            )

        valid_mcqs = _fix_explanation_prefix(valid_mcqs)
        _warn_answer_distribution(valid_mcqs, mode)
        if mode in ("exam", "harder"):
            _warn_exam_format_distribution(valid_mcqs)

        merged["mcqs"] = valid_mcqs
        merged["_meta"] = {
            "mode": mode,
            "total_generated": len(raw_mcqs),
            "total_after_dedup": len(deduped),
            "total_valid": len(valid_mcqs),
            "total_rejected": len(rejected),
            "rejection_log": rejected,
            "chunks_processed": total_chunks,
            "chunk_timings_seconds": chunk_timings,
            "total_elapsed_seconds": total_elapsed,
            "estimated_range": time_estimate["estimated_range"],
            "text_length_chars": len(text),
        }

        logger.info(
            f"[{mode}] Done — {len(valid_mcqs)} valid MCQs from {total_chunks} chunk(s) "
            f"in {total_elapsed}s (generated={len(raw_mcqs)}, rejected={len(rejected)})"
        )
        return merged

    except httpx.HTTPStatusError as e:
        logger.error(f"API error {e.response.status_code}: {e.response.text}")
        raise RuntimeError(f"API error {e.response.status_code}: {e.response.text}")
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI JSON: {e}")
        raise RuntimeError(f"AI returned invalid JSON: {e}")
    except Exception as e:
        logger.error(f"AI error: {e}")
        raise RuntimeError(str(e))


def _get_mock_response() -> Dict[str, Any]:
    return {
        "summary": "3-5 concise sentences summarizing key ideas",
        "key_concepts": ["8-12 short high-yield phrases"],
        "mcqs": [
            {
                "topic": "string",
                "question": "string",
                "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
                "answer": "A",
                "explanation": "A — reason",
            }
        ],
        "_meta": {
            "mode": "mock",
            "total_generated": 0,
            "total_after_dedup": 0,
            "total_valid": 0,
            "total_rejected": 0,
            "rejection_log": [],
            "chunks_processed": 0,
            "chunk_timings_seconds": [],
            "total_elapsed_seconds": 0,
            "estimated_range": "N/A",
            "text_length_chars": 0,
        },
    }
