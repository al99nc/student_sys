import asyncio
import json
import math
import re
import time
import logging
import httpx
from typing import Dict, Any
from app.core.config import settings
from app.services.prompts import _get_prompts, build_contextual_prompt, ESSAY_GRADE_SYSTEM_PROMPT, ESSAY_GRADE_USER_PROMPT
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
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
UTILITY_MODEL = "llama-3.1-8b-instant"


# ─────────────────────────────────────────────────────────────────
# SUBJECT DETECTION
# ─────────────────────────────────────────────────────────────────
SUBJECT_DETECTION_SYSTEM = "You are a medical text classifier. Return only valid JSON, no markdown."

SUBJECT_DETECTION_USER = """\
Read this medical lecture text and return ONLY this JSON with no extra text:
{
  "subject": "one of: pharmacology | cardiology | neurology | anatomy | physiology | biochemistry | pathology | microbiology | immunology | surgery | pediatrics | obstetrics | psychiatry | other",
  "subtopics": ["list", "of", "3-6", "main", "subtopics", "covered"],
  "key_facts": ["5-8 critical facts from this text that must be accurate in any MCQ about it"],
  "common_misconceptions": ["3-5 common student errors related to this specific content"]
}

Text:
{text_sample}
"""

# ─────────────────────────────────────────────────────────────────
# MCQ VALIDATOR
# ─────────────────────────────────────────────────────────────────
VALIDATOR_SYSTEM = "You are a medical MCQ quality auditor. Return only valid JSON, no markdown."

VALIDATOR_USER = """\
Review these MCQs and flag problems. Return ONLY this JSON:
{
  "flagged": [
    {
      "index": 0,
      "reason": "distractor B could be argued as correct because...",
      "fix": "change B to say X instead, which is actually false"
    }
  ]
}

Flag a question if ANY of these are true:
1. A wrong option could be argued as correct by a knowledgeable student
2. Two questions test the exact same concept (flag the second one, reason: "duplicate of index N")
3. The question stem gives away the answer
4. A clinical vignette is solvable in one obvious step with no reasoning needed
5. The question uses "all the following are FALSE EXCEPT" but has MORE THAN ONE true option among A/B/C/D — flag as: "false_except_multiple_true"
6. The question uses "all the following are FALSE EXCEPT" but ALL options are false — flag as: "false_except_no_true"

If no problems found, return: {"flagged": []}

MCQs:
{mcqs_json}
"""


# ─────────────────────────────────────────────────────────────────
# CHUNKING CONFIGURATION
# ─────────────────────────────────────────────────────────────────
CHUNK_SIZE    = 5500
CHUNK_OVERLAP = 400
MAX_CHUNKS    = 8


# ─────────────────────────────────────────────────────────────────
# GROQ RATE LIMITS  (free tier, model: openai/gpt-oss-120b)
# Hard limits:  RPM 30 | TPM 8 000 | TPD 200 000
# We target 93 % of TPM (7 500) so a single request never crashes.
#
# Input-token budget per mode (system prompt + user template, no text):
#   revision    ~6 000 chars  → ~1 500 tokens
#   exam        ~8 500 chars  → ~2 100 tokens
#   quick_review ~3 600 chars  → ~  900 tokens
# One 8 000-char chunk ≈ 2 000 tokens.
#
# max_output = 7 500 − chunk_tokens − prompt_tokens
#   revision:     7 500 − 2 000 − 1 500 = 4 000 → ~14.8 s @ 270 TPS
#   exam:         7 500 − 2 000 − 2 100 = 3 400 → ~12.6 s @ 270 TPS
#   quick_review: 7 500 − 2 000 −   900 = 4 600 → capped at 3 500
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
    # TPM budget = 8000 total (input + output per minute).
    # Chunk ~750 tokens + prompt ~1500 tokens = ~2250 input → 5750 headroom.
    # Cap output at 4500 to leave a safety margin and never hit the limit.
    "revision": {
        "max_tokens": 4_500,
        "temperature": 0.30,
        "presence_penalty": 0.3,
        "frequency_penalty": 0.3,
    },
    "exam": {
        "max_tokens": 3_400,   # 7500 - 2000 (chunk) - 2100 (prompt) = 3400 safe ceiling
        "temperature": 0.35,
        "presence_penalty": 0.3,
        "frequency_penalty": 0.3,
    },
    "harder": {
        "max_tokens": 3_500,
        "temperature": 0.40,
        "presence_penalty": 0.4,
        "frequency_penalty": 0.4,
    },
    "quick_review": {
        "max_tokens": 3_000,
        "temperature": 0.25,
        "presence_penalty": 0.2,
        "frequency_penalty": 0.2,
    },
    # custom context mode — student-tailored prompts (paid feature)
    "custom": {
        "max_tokens": 4_500,
        "temperature": 0.30,
        "presence_penalty": 0.3,
        "frequency_penalty": 0.3,
    },
    "essay": {
        "max_tokens": 5_000,
        "temperature": 0.30,
        "presence_penalty": 0.2,
        "frequency_penalty": 0.2,
    },
    "essay_custom": {
        "max_tokens": 5_000,
        "temperature": 0.30,
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


def _estimate_processing_time(
    text: str,
    mode: str,
    n_keys: int = 1,
    *,
    inter_chunk_wait: int | None = None,
) -> dict:
    chunks = _chunk_text(text)
    n_chunks = len(chunks)
    max_tokens = SPEED_CONFIG.get(mode, SPEED_CONFIG["revision"])["max_tokens"]
    wait = inter_chunk_wait if inter_chunk_wait is not None else _INTER_CHUNK_WAIT

    per_chunk_seconds = max_tokens / ESTIMATED_TPS + 2   # +2 for network + prefill

    # Each batch runs min(n_keys, remaining_chunks) chunks in parallel.
    # Between batches we wait _INTER_CHUNK_WAIT for each key's TPM window to reset.
    batch_size = max(1, n_keys)
    n_batches = math.ceil(n_chunks / batch_size)
    total_seconds = n_batches * per_chunk_seconds + max(0, n_batches - 1) * wait

    return {
        "chunks": n_chunks,
        "keys": n_keys,
        "estimated_seconds": round(total_seconds),
        "estimated_range": (
            f"{max(5, round(total_seconds * 0.8))}–{round(total_seconds * 1.25)}s"
        ),
        "text_length_chars": len(text),
        "note": (
            f"{n_chunks} chunk(s), {n_keys} key(s), {n_batches} batch(es) — "
            f"~{round(total_seconds)}s total."
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
# SUBJECT DETECTION + DYNAMIC FACTS + VALIDATOR
# ─────────────────────────────────────────────────────────────────

async def detect_subject(
    text_sample: str,
    api_key: str | None = None,
) -> dict | None:
    resolved_key = api_key or settings.AI_API_KEY
    resolved_model = UTILITY_MODEL
    user_msg = SUBJECT_DETECTION_USER.replace("{text_sample}", text_sample)
    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": SUBJECT_DETECTION_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.1,
        "max_tokens": 800,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(GROQ_URL, headers=headers, json=payload)
            resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"].get("content") or ""
        cleaned = _THINKING_TAG_PATTERN.sub("", raw).strip()
        cleaned = re.sub(r"```(?:json)?", "", cleaned).strip().rstrip("```").strip()
        return json.loads(cleaned)
    except Exception as e:
        logger.warning(f"Subject detection failed: {e} — continuing without it")
        return None


def build_ai_title(subject_data: dict | None) -> str:
    if not subject_data:
        return ""
    subject = subject_data.get("subject", "").replace("_", " ").title()
    subtopics = subject_data.get("subtopics", [])
    if subtopics:
        topics_str = ", ".join(str(t).strip() for t in subtopics[:3])
        return f"{subject}: {topics_str}" if subject else topics_str
    return subject


def build_dynamic_facts_block(subject_data: dict | None) -> str:
    if not subject_data:
        return (
            "=== CRITICAL FACTUAL ACCURACY ===\n"
            "All facts must come exclusively from the lecture text.\n"
            "If uncertain about a fact, skip the question."
        )
    lines = ["=== CRITICAL FACTUAL ACCURACY ==="]
    lines.append(f"Subject: {subject_data.get('subject', 'general medicine')}")
    lines.append("Key facts that MUST be accurate in every question:")
    for fact in subject_data.get("key_facts", []):
        lines.append(f"  ✓ {fact}")
    lines.append("Common misconceptions to AVOID introducing as correct answers:")
    for err in subject_data.get("common_misconceptions", []):
        lines.append(f"  ✗ {err}")
    lines.append("If uncertain about any fact from this subject, skip the question.")
    return "\n".join(lines)


async def validate_and_clean(
    mcqs: list[dict],
    api_key: str | None = None,
) -> list[dict]:
    if len(mcqs) < 5:
        return mcqs
    resolved_key = api_key or settings.AI_API_KEY
    resolved_model = UTILITY_MODEL
    try:
        MAX_VALIDATE = 20
        sample = mcqs[:MAX_VALIDATE]
        mcqs_json = json.dumps(
            [{"index": i, **q} for i, q in enumerate(sample)],
            ensure_ascii=False,
        )
        user_msg = VALIDATOR_USER.replace("{mcqs_json}", mcqs_json)
        headers = {
            "Authorization": f"Bearer {resolved_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": resolved_model,
            "messages": [
                {"role": "system", "content": VALIDATOR_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            "temperature": 0.1,
            "max_tokens": 2_000,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(GROQ_URL, headers=headers, json=payload)
            resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"].get("content") or ""
        cleaned = _THINKING_TAG_PATTERN.sub("", raw).strip()
        cleaned = re.sub(r"```(?:json)?", "", cleaned).strip().rstrip("```").strip()
        result = json.loads(cleaned)
        flagged = result.get("flagged", [])
        duplicate_indices: set[int] = set()
        for item in flagged:
            idx = item.get("index")
            reason = item.get("reason", "")
            if idx is None or not isinstance(idx, int) or idx >= len(mcqs):
                continue
            if "duplicate" in reason.lower():
                duplicate_indices.add(idx)
                logger.warning(f"[validator] Removing duplicate MCQ at index {idx}: {reason}")
            elif "false_except_multiple_true" in reason.lower() or "false_except_no_true" in reason.lower():
                duplicate_indices.add(idx)
                logger.warning(f"[validator] Removing broken FALSE EXCEPT at index {idx}: {reason}")
            else:
                logger.warning(f"[validator] Quality issue at index {idx}: {reason}")
        if duplicate_indices:
            mcqs = [q for i, q in enumerate(mcqs) if i not in duplicate_indices]
        return mcqs
    except Exception as e:
        logger.warning(f"MCQ validation failed: {e} — returning original MCQs")
        return mcqs


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
    *,
    model: str | None = None,
    custom_prompts: tuple[str, str] | None = None,
    focus_instruction: str = "",
    dynamic_facts_block: str = "",
) -> tuple[dict, float]:
    if custom_prompts is not None:
        system_prompt, user_prompt_template = custom_prompts
        user_prompt = user_prompt_template.replace("{text}", text)
    else:
        system_prompt, user_prompt_template = _get_prompts(mode)
        user_prompt = user_prompt_template.format(text=text)

    if "{dynamic_facts_block}" in system_prompt:
        system_prompt = system_prompt.replace("{dynamic_facts_block}", dynamic_facts_block)

    if focus_instruction and focus_instruction.strip():
        focus_block = (
            f"\n\n=== STUDENT FOCUS INSTRUCTION — HIGHEST PRIORITY ===\n"
            f"The student specifically wants questions on: {focus_instruction.strip()}\n"
            f"RULES:\n"
            f"- At least 60% of questions MUST directly address this focus area.\n"
            f"- Questions outside this focus are ONLY allowed if the lecture has insufficient content on it.\n"
            f"- If the focus mentions specific drugs/topics/mechanisms, every question should test one of those specifically.\n"
            f"- Do NOT ignore this instruction or treat it as a suggestion — it is a hard constraint.\n"
            f"=== END FOCUS INSTRUCTION ===\n"
        )
        user_prompt = focus_block + user_prompt

    if total_chunks > 1:
        user_prompt += (
            f"\n\n[NOTE: This is chunk {chunk_index + 1} of {total_chunks}. "
            f"Generate 8-12 questions ONLY from this content. "
            "Do NOT repeat questions from other chunks. Keep explanations concise.]"
        )

    cfg = SPEED_CONFIG.get(mode, SPEED_CONFIG["revision"])
    resolved_model = model or settings.FREE_AI_MODEL

    _is_openrouter = api_key and api_key == settings.open_rout_PAID_API_KEY
    _is_gemini_direct = (resolved_model.startswith("gemini") or resolved_model.startswith("google/")) and not _is_openrouter
    if _is_openrouter:
        api_url = OPENROUTER_URL
    elif _is_gemini_direct:
        api_url = f"{settings.GEMINI_API_BASE.split('?')[0].rstrip('/')}/chat/completions"
    else:
        api_url = GROQ_URL
    resolved_key = api_key or settings.AI_API_KEY

    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": cfg["temperature"],
        "max_tokens": cfg["max_tokens"],
    }
    if not _is_gemini_direct and not _is_openrouter:
        payload["presence_penalty"] = cfg.get("presence_penalty", 0.3)
        payload["frequency_penalty"] = cfg.get("frequency_penalty", 0.3)

    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            t_start = time.monotonic()

            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(api_url, headers=headers, json=payload)
                if not resp.is_success:
                    logger.error(f"[{mode}] HTTP {resp.status_code}: {resp.text[:300]}")
                if resp.status_code == 401:
                    raise RuntimeError("INVALID_KEY: API key rejected (401 Unauthorized)")
                if resp.status_code == 429:
                    body = resp.text
                    if "per day" in body or "TPD" in body:
                        retry_in = _parse_groq_retry_after(body)
                        minutes = max(1, round(retry_in / 60))
                        raise RuntimeError(
                            f"DAILY_LIMIT: Daily token quota exhausted "
                            f"(200 000 tokens/day). Try again in ~{minutes} minutes."
                        )
                    # Per-minute TPM limit — embed exact retry seconds so caller waits precisely
                    retry_in = _parse_groq_retry_after(resp.text)
                    raise RuntimeError(f"TPM_LIMIT:{retry_in:.1f}: {resp.text[:120]}")
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

            # Invalid key — propagate immediately, no point retrying
            if "INVALID_KEY" in err_str:
                raise

            # TPM per-minute 429 — wait exactly as Groq says, then retry same key
            if "429" in err_str:
                # Extract seconds from "TPM_LIMIT:40.5:..." or fallback to 65s
                try:
                    retry_wait = float(str(e).split(":")[1]) + 1.0
                except (IndexError, ValueError):
                    retry_wait = 65.0
                logger.warning(
                    f"[{mode}] Chunk {chunk_index + 1} hit TPM limit — "
                    f"waiting {retry_wait:.0f}s before retry (attempt {attempt + 1})"
                )
                await asyncio.sleep(retry_wait)
                continue  # retry same key

            # Other errors — exponential backoff
            wait = 2 ** attempt
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
    *,
    model: str,
    custom_prompts: tuple[str, str] | None = None,
    focus_instruction: str = "",
    dynamic_facts_block: str = "",
) -> tuple[dict, float]:
    """Call a single chunk, rotating keys on TPM, daily-limit, and invalid-key errors.

    Round-robin start: chunk N starts at key[N % len(keys)] so concurrent chunks
    each prefer a different key and don't all hammer key[0] simultaneously.
    """
    last_error: Exception | None = None
    tpm_hit_keys: set[str] = set()
    tpm_retry_after: float = 65.0   # updated from Groq's actual retry-after header

    def _rotated_keys() -> list[str]:
        """Return available_keys starting from this chunk's preferred slot."""
        keys = list(available_keys)
        if not keys:
            return keys
        start = chunk_index % len(keys)
        return keys[start:] + keys[:start]

    for key in _rotated_keys():
        if key not in available_keys:
            continue  # another concurrent chunk already removed this key
        try:
            return await _call_single_chunk(
                text, mode, chunk_index, total_chunks, api_key=key, model=model,
                custom_prompts=custom_prompts, focus_instruction=focus_instruction,
                dynamic_facts_block=dynamic_facts_block,
            )
        except RuntimeError as e:
            err_str = str(e)
            if "DAILY_LIMIT" in err_str:
                if key in available_keys:
                    available_keys.remove(key)
                logger.warning(
                    f"[{mode}] Key ...{key[-6:]} hit daily limit — "
                    f"rotating ({len(available_keys)} remaining)"
                )
                last_error = e
                continue
            if "INVALID_KEY" in err_str:
                if key in available_keys:
                    available_keys.remove(key)
                logger.warning(
                    f"[{mode}] Key ...{key[-6:]} is invalid — "
                    f"removing permanently ({len(available_keys)} remaining)"
                )
                last_error = e
                continue
            if "TPM_LIMIT" in err_str:
                tpm_hit_keys.add(key)
                # Parse the exact retry-after Groq embedded: "TPM_LIMIT:40.5:..."
                try:
                    tpm_retry_after = max(tpm_retry_after, float(err_str.split(":")[1]))
                except (IndexError, ValueError):
                    pass
                logger.warning(
                    f"[{mode}] Key ...{key[-6:]} hit TPM limit — rotating to next key"
                )
                last_error = e
                continue
            raise

    # All live keys hit TPM — wait exactly as long as Groq says, not a hardcoded 65s
    if tpm_hit_keys and available_keys:
        wait = tpm_retry_after + 1.0   # +1s safety margin
        logger.info(f"[{mode}] All {len(tpm_hit_keys)} key(s) hit TPM limit — waiting {wait:.0f}s")
        await asyncio.sleep(wait)
        for key in list(available_keys):
            try:
                return await _call_single_chunk(
                    text, mode, chunk_index, total_chunks, api_key=key, model=model,
                    custom_prompts=custom_prompts, focus_instruction=focus_instruction,
                    dynamic_facts_block=dynamic_facts_block,
                )
            except RuntimeError as e:
                last_error = e
                err_str = str(e)
                if "DAILY_LIMIT" in err_str or "INVALID_KEY" in err_str:
                    if key in available_keys:
                        available_keys.remove(key)
                continue

    if last_error and "DAILY_LIMIT" in str(last_error):
        raise RuntimeError(
            "DAILY_LIMIT: All API keys have hit their daily token quota (200 000 tokens/day). "
            "Add more keys to AI_API_KEYS in .env or wait until tomorrow."
        )
    raise RuntimeError(
        f"Chunk {chunk_index + 1} failed after trying all available keys. "
        f"Last error: {last_error}"
    )


async def generate_study_content(
    text: str,
    mode: str = "revision",
    *,
    is_premium: bool = False,
    custom_context: dict | None = None,
    focus_instruction: str = "",
) -> Dict[str, Any]:
    if is_premium:
        if settings.open_rout_PAID_API_KEY:
            ai_model = settings.open_rout_PAID_MODEL
            available_keys = [settings.open_rout_PAID_API_KEY]
        else:
            ai_model = settings.FREE_AI_MODEL
            available_keys = settings.get_all_api_keys()
    else:
        ai_model = settings.FREE_AI_MODEL
        available_keys = settings.get_all_api_keys()

    if not available_keys:
        logger.warning("No API keys configured — returning mock data")
        return _get_mock_response()

    # Step 1: detect subject from first 3000 chars for dynamic factual accuracy injection
    subject_data = await detect_subject(
        text[:3000],
        api_key=available_keys[0],
    )
    facts_block = build_dynamic_facts_block(subject_data)

    # Build custom prompts once if context is provided, then use mode="custom"
    _custom_prompts: tuple[str, str] | None = None
    if custom_context:
        mode = "custom"
        _custom_prompts = build_contextual_prompt(
            field_of_study=custom_context.get("field_of_study", ""),
            exam_type=custom_context.get("exam_type", "final"),
            time_to_exam=custom_context.get("time_to_exam", "1week"),
            prior_knowledge=custom_context.get("prior_knowledge", "know_basics"),
            difficulty=custom_context.get("difficulty", "medium"),
            mcq_count=int(custom_context.get("mcq_count", 20)),
            weak_topics=custom_context.get("weak_topics", ""),
        )

    # Normalise unknown modes to revision
    if mode not in SPEED_CONFIG:
        logger.warning(f"Unknown mode '{mode}' — falling back to revision")
        mode = "revision"
    _using_openrouter = is_premium and bool(settings.open_rout_PAID_API_KEY)
    if _using_openrouter:
        inter_wait = 0  # OpenRouter handles rate limits — no delay needed
    elif is_premium:
        inter_wait = settings.PREMIUM_INTER_CHUNK_WAIT_SECONDS
    else:
        inter_wait = settings.FREE_INTER_CHUNK_WAIT_SECONDS

    chunks = _chunk_text(text)
    total_chunks = len(chunks)
    # For OpenRouter: run all chunks in parallel regardless of key count
    n_keys = total_chunks if _using_openrouter else len(available_keys)

    time_estimate = _estimate_processing_time(
        text, mode, n_keys, inter_chunk_wait=inter_wait
    )
    logger.info(
        f"[{mode}] Estimate: {total_chunks} chunk(s), {n_keys} key(s), "
        f"~{time_estimate['estimated_range']}"
    )

    try:
        t_total_start = time.monotonic()

        # Batch-parallel: run up to n_keys chunks simultaneously, one key per chunk.
        # Each key has its own 8 000 TPM budget, so parallel chunks don't contend.
        # Between batches we wait inter_wait so every key's TPM window resets.
        chunk_output: list[tuple[dict, float]] = []
        batch_size = max(1, n_keys)

        for batch_start in range(0, total_chunks, batch_size):
            batch_indices = list(range(batch_start, min(batch_start + batch_size, total_chunks)))

            if batch_start > 0:
                logger.info(
                    f"[{mode}] Waiting {inter_wait}s before batch "
                    f"{batch_start // batch_size + 1} (TPM window reset)"
                )
                await asyncio.sleep(inter_wait)

            logger.info(
                f"[{mode}] Processing chunks {batch_start + 1}–{batch_indices[-1] + 1} "
                f"of {total_chunks} in parallel ({len(batch_indices)} key(s))"
            )
            tasks = [
                _call_chunk_with_rotation(
                    available_keys, chunks[i], mode, i, total_chunks,
                    model=ai_model, custom_prompts=_custom_prompts,
                    focus_instruction=focus_instruction,
                    dynamic_facts_block=facts_block,
                )
                for i in batch_indices
            ]
            batch_results = await asyncio.gather(*tasks)
            chunk_output.extend(batch_results)

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
        valid_mcqs = await validate_and_clean(valid_mcqs)
        _warn_answer_distribution(valid_mcqs, mode)
        if mode in ("exam", "harder"):
            _warn_exam_format_distribution(valid_mcqs)

        merged["mcqs"] = valid_mcqs
        merged["_meta"] = {
            "mode": mode,
            "ai_model": ai_model,
            "premium_tier": is_premium,
            "ai_title": build_ai_title(subject_data),
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


def _salvage_essay_json(text: str, chunk_index: int = 0) -> dict:
    """Recover essay questions from truncated JSON responses."""
    questions: list[dict] = []
    seen: set[str] = set()
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
                            and "ideal_answer" in obj
                        ):
                            key = obj["question"][:60]
                            if key not in seen:
                                seen.add(key)
                                obj.setdefault("max_score", 100)
                                questions.append(obj)
                    except json.JSONDecodeError:
                        pass
                    break

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

    if not questions and not summary:
        raise ValueError(f"Could not salvage any essay content from chunk {chunk_index + 1}")

    logger.warning(f"Essay chunk {chunk_index + 1}: salvaged {len(questions)} question(s)")
    return {"questions": questions, "summary": summary, "key_concepts": key_concepts}


def _build_essay_context_override(custom_context: dict) -> str:
    """Build extra instructions injected into the essay prompt when Smart Context is active."""
    parts = []
    q_count = int(custom_context.get("mcq_count", 8))
    parts.append(f"TARGET: Generate exactly {q_count} essay questions.")

    diff = custom_context.get("difficulty", "medium")
    diff_map = {
        "easy":   "Keep questions straightforward — recall + basic application.",
        "medium": "Mix understanding and application questions.",
        "hard":   "Require deep analysis, comparison, and synthesis.",
        "brutal": "Only advanced analysis and synthesis. No recall questions.",
    }
    parts.append(diff_map.get(diff, diff_map["medium"]))

    time_map = {
        "today":  "Focus on the single highest-yield concept per topic.",
        "3days":  "Cover all major topics; include key mechanisms.",
        "1week":  "Full coverage including edge cases.",
        "1month": "Comprehensive depth — rare exceptions welcome.",
    }
    t = custom_context.get("time_to_exam", "1week")
    parts.append(time_map.get(t, time_map["1week"]))

    weak = custom_context.get("weak_topics", "").strip()
    if weak:
        parts.append(f"PRIORITIZE these weak areas (at least 40% of questions): {weak}")

    prior = custom_context.get("prior_knowledge", "know_basics")
    if prior == "first_time":
        parts.append("Ideal answers must define all technical terms — student sees this for the first time.")
    elif prior == "deep_review":
        parts.append("Ideal answers should include nuanced edge cases — student is well-prepared.")

    return "\n".join(parts)


async def _call_essay_chunk(
    text: str,
    chunk_index: int,
    total_chunks: int,
    api_key: str | None = None,
    model: str | None = None,
    custom_context: dict | None = None,
) -> dict:
    """Call AI for a single essay chunk and return parsed essay JSON."""
    from app.services.prompts import ESSAY_SYSTEM_PROMPT, ESSAY_USER_PROMPT

    user_prompt = ESSAY_USER_PROMPT.format(text=text)

    if custom_context:
        ctx_block = _build_essay_context_override(custom_context)
        user_prompt = f"=== SMART CONTEXT OVERRIDES ===\n{ctx_block}\n\n" + user_prompt

    if total_chunks > 1:
        user_prompt += (
            f"\n\n[NOTE: Chunk {chunk_index + 1} of {total_chunks}. "
            "Generate 3-5 questions from THIS content only.]"
        )

    cfg = SPEED_CONFIG["essay"]
    resolved_model = model or settings.FREE_AI_MODEL
    resolved_key = api_key or settings.AI_API_KEY

    _is_openrouter = resolved_key == settings.open_rout_PAID_API_KEY
    _is_gemini_direct = (resolved_model.startswith("gemini") or resolved_model.startswith("google/")) and not _is_openrouter
    if _is_openrouter:
        api_url = OPENROUTER_URL
    elif _is_gemini_direct:
        api_url = f"{settings.GEMINI_API_BASE.split('?')[0].rstrip('/')}/chat/completions"
    else:
        api_url = GROQ_URL

    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": ESSAY_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": cfg["temperature"],
        "max_tokens": cfg["max_tokens"],
        "presence_penalty": cfg["presence_penalty"],
        "frequency_penalty": cfg["frequency_penalty"],
    }

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(api_url, headers=headers, json=payload)
                if resp.status_code == 401:
                    raise RuntimeError("INVALID_KEY: API key rejected (401 Unauthorized)")
                if resp.status_code == 429:
                    retry_in = _parse_groq_retry_after(resp.text)
                    await asyncio.sleep(retry_in + 1 if retry_in > 0 else 65)
                    continue
                resp.raise_for_status()

            raw = resp.json()["choices"][0]["message"].get("content") or ""
            cleaned = _THINKING_TAG_PATTERN.sub("", raw).strip()
            cleaned = re.sub(r"```(?:json)?", "", cleaned).strip().rstrip("```").strip()

            try:
                data = json.loads(cleaned)
            except json.JSONDecodeError:
                data = _salvage_essay_json(cleaned, chunk_index)

            if not data.get("questions"):
                raise ValueError("No essay questions in response")

            for q in data["questions"]:
                q.setdefault("max_score", 100)

            return data

        except RuntimeError as e:
            raise  # propagate INVALID_KEY / TPM_LIMIT immediately for caller rotation
        except Exception as e:
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
            else:
                raise RuntimeError(f"Essay chunk {chunk_index + 1} failed: {e}")

    raise RuntimeError(f"Essay chunk {chunk_index + 1} failed after 3 attempts")


async def generate_essay_content(
    text: str,
    *,
    is_premium: bool = False,
    custom_context: dict | None = None,
) -> Dict[str, Any]:
    """Generate open-ended essay questions with ideal answers from lecture text."""
    if is_premium and settings.open_rout_PAID_API_KEY:
        ai_model = settings.open_rout_PAID_MODEL
        api_key = settings.open_rout_PAID_API_KEY
    else:
        ai_model = settings.FREE_AI_MODEL
        api_key = None  # use rotation below

    available_keys = settings.get_all_api_keys() if not is_premium else None

    chunks = _chunk_text(text)
    total_chunks = len(chunks)
    all_questions: list[dict] = []
    summary = ""
    key_concepts: list[str] = []

    for i, chunk in enumerate(chunks):
        if i > 0:
            await asyncio.sleep(settings.FREE_INTER_CHUNK_WAIT_SECONDS if not is_premium else 5)
        # For free tier, rotate through all keys just like MCQ generation does
        if available_keys:
            start = i % len(available_keys)
            rotated = available_keys[start:] + available_keys[:start]
            last_err: Exception | None = None
            for key in rotated:
                try:
                    data = await _call_essay_chunk(chunk, i, total_chunks, api_key=key, model=ai_model, custom_context=custom_context)
                    break
                except RuntimeError as e:
                    if "INVALID_KEY" in str(e) or "DAILY_LIMIT" in str(e):
                        if key in available_keys:
                            available_keys.remove(key)
                        last_err = e
                        continue
                    raise
            else:
                raise last_err or RuntimeError(f"Essay chunk {i + 1} failed: all keys exhausted")
        else:
            data = await _call_essay_chunk(chunk, i, total_chunks, api_key=api_key, model=ai_model, custom_context=custom_context)
        all_questions.extend(data.get("questions", []))
        if not summary:
            summary = data.get("summary", "")
        key_concepts.extend(data.get("key_concepts", []))

    # Deduplicate by question text
    seen: set[str] = set()
    unique_questions = []
    for q in all_questions:
        key = q.get("question", "")[:80]
        if key not in seen:
            seen.add(key)
            unique_questions.append(q)

    seen_kc: set[str] = set()
    unique_kc = []
    for kc in key_concepts:
        norm = kc.lower().strip()
        if norm not in seen_kc:
            seen_kc.add(norm)
            unique_kc.append(kc)

    return {
        "questions": unique_questions,
        "summary": summary,
        "key_concepts": unique_kc[:12],
    }


async def grade_essay_answer(
    question: str,
    ideal_answer: str,
    student_answer: str,
) -> Dict[str, Any]:
    """Use AI to grade a student essay answer against the ideal answer."""
    user_prompt = ESSAY_GRADE_USER_PROMPT.format(
        question=question,
        ideal_answer=ideal_answer,
        student_answer=student_answer,
    )

    api_key = settings.AI_API_KEY
    model = settings.FREE_AI_MODEL

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": ESSAY_GRADE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 1_000,
    }

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(GROQ_URL, headers=headers, json=payload)
                if resp.status_code == 401:
                    raise RuntimeError("INVALID_KEY: API key rejected (401 Unauthorized)")
                if resp.status_code == 429:
                    retry_in = _parse_groq_retry_after(resp.text)
                    await asyncio.sleep(retry_in + 1 if retry_in > 0 else 65)
                    continue
                resp.raise_for_status()

            raw = resp.json()["choices"][0]["message"].get("content") or ""
            cleaned = _THINKING_TAG_PATTERN.sub("", raw).strip()
            cleaned = re.sub(r"```(?:json)?", "", cleaned).strip().rstrip("```").strip()
            data = json.loads(cleaned)

            return {
                "score": max(0, min(100, int(data.get("score", 0)))),
                "feedback": data.get("feedback", ""),
                "key_points_covered": data.get("key_points_covered", []),
                "key_points_missed": data.get("key_points_missed", []),
            }
        except json.JSONDecodeError:
            # Try to extract score manually
            score_match = re.search(r'"score"\s*:\s*(\d+)', raw if "raw" in dir() else "")
            return {
                "score": int(score_match.group(1)) if score_match else 50,
                "feedback": "Grading completed.",
                "key_points_covered": [],
                "key_points_missed": [],
            }
        except Exception as e:
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
            else:
                raise RuntimeError(f"Grading failed: {e}")

    raise RuntimeError("Grading failed after 3 attempts")


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
