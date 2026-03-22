import asyncio
import json
import re
import time
import logging
import httpx
from typing import Dict, Any
from app.core.config import settings

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────
# API ENDPOINT
# ─────────────────────────────────────────────────────────────────
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

OPENROUTER_HEADERS = {
    "Content-Type": "application/json",
    "HTTP-Referer": "https://localhost",
}


# ─────────────────────────────────────────────────────────────────
# CHUNKING CONFIGURATION
# ─────────────────────────────────────────────────────────────────
CHUNK_SIZE = 8_000
CHUNK_OVERLAP = 1_000
MAX_CHUNKS = 12


# ─────────────────────────────────────────────────────────────────
# SPEED CONFIGURATION
# ─────────────────────────────────────────────────────────────────
SPEED_CONFIG = {
    "highyield": {
        "max_tokens": 7000,
        "temperature": 0.30,
    },
    "exam": {
        "max_tokens": 8000,
        "temperature": 0.35,
    },
}

ESTIMATED_TPS = 80


# ─────────────────────────────────────────────────────────────────
# FORBIDDEN PATTERNS
# ─────────────────────────────────────────────────────────────────
FORBIDDEN_OPTION_PATTERNS = re.compile(
    r"\b(all of the above|none of the above|both a and b|neither a nor b|"
    r"both of the above|all the above|none of these)\b",
    re.IGNORECASE,
)

SEMANTIC_COMBINED_PATTERNS = re.compile(
    r"\b(both\s+\w[\w\s]{0,40}\band\b|neither\s+\w[\w\s]{0,40}\bnor\b)",
    re.IGNORECASE,
)

EXAM_CATCHALL_PATTERNS = re.compile(
    r"\b(all of the above|none of the above|a and b)\b",
    re.IGNORECASE,
)

_DEMOGRAPHIC_STRIP = re.compile(
    r"\b(\d+[-‐–]year[-‐–]old|year old|years old|"
    r"\b(man|woman|male|female|boy|girl|patient|child|infant|elderly|adolescent)\b)",
    re.IGNORECASE,
)

_IDA_MARROW_QUESTION_PATTERN = re.compile(
    r"bone\s+marrow.{0,80}iron\s+deficien|iron\s+deficien.{0,80}bone\s+marrow",
    re.IGNORECASE | re.DOTALL,
)
_IDA_MARROW_BAD_ANSWER = re.compile(
    r"decreased\s+erythropoiesis|reduced\s+erythropoiesis|decrease[sd]?\s+red\s+cell\s+production",
    re.IGNORECASE,
)
_ACD_QUESTION_PATTERN = re.compile(
    r"anemia\s+of\s+chronic\s+disease|chronic\s+disease.{0,40}anemia",
    re.IGNORECASE,
)
_ACD_BAD_ANSWER = re.compile(
    r"normal\s+or\s+elevated\s+serum\s+iron|elevated\s+serum\s+iron",
    re.IGNORECASE,
)

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
        f"({len(text):,} chars total, {chunk_size:,} chars/chunk)"
    )
    return chunks


def _estimate_processing_time(text: str, mode: str) -> dict:
    chunks = _chunk_text(text)
    n_chunks = len(chunks)
    max_tokens = SPEED_CONFIG[mode]["max_tokens"]

    # Chunks run in parallel — estimate is for a single chunk, not the sum
    tokens_per_chunk = (CHUNK_SIZE // 4) + 1500 + max_tokens
    estimated_seconds = tokens_per_chunk / ESTIMATED_TPS + 3

    return {
        "chunks": n_chunks,
        "estimated_seconds": round(estimated_seconds),
        "estimated_range": (
            f"{max(5, round(estimated_seconds * 0.7))}–{round(estimated_seconds * 1.3)}s"
        ),
        "text_length_chars": len(text),
        "note": (
            f"Large PDF — processing {n_chunks} chunks in parallel."
            if n_chunks > 1
            else "Single chunk — fastest processing."
        ),
    }


# ─────────────────────────────────────────────────────────────────
# HIGH YIELD PROMPTS
# ─────────────────────────────────────────────────────────────────
HIGHYIELD_SYSTEM_PROMPT = (
    "You are a professor-level medical exam writer for postgraduate and clinical board examinations (USMLE, COMLEX, ABIM, FRCPath, etc.). "
    "Your job is to generate DIFFICULT, high-yield MCQs strictly based on the provided lecture text. "
    "Questions must demand deep understanding, clinical reasoning, and pattern recognition — not surface recall.\n\n"

    "=== DIFFICULTY STANDARDS ===\n"
    "Each question must fall into one of three types:\n"
    "  Type 1 (Recall — max 30%): Direct fact retrieval.\n"
    "  Type 2 (Application — ~50%): Clinical vignette requiring diagnosis, next best step, or mechanism identification.\n"
    "  Type 3 (Analysis — ~20%): Higher-order reasoning including 'all EXCEPT' questions or comparing similar pathologies.\n\n"

    "=== QUESTION CRAFTING RULES ===\n"
    "- Use clinical vignettes for Type 2 and Type 3 — include age, sex, symptoms, and key labs.\n"
    "- VIGNETTE UNIQUENESS: Vignettes differing only in patient age or sex are IDENTICAL — delete one.\n"
    "- OPTION PARALLELISM: All 4 options at the same conceptual level. Never mix root cause with downstream effect.\n"
    "- Distractors must be the most commonly confused alternatives.\n"
    "- Every fact must come EXCLUSIVELY from the lecture text.\n"
    "- Explanations must be internally consistent — never contradict themselves.\n\n"

    "=== CRITICAL FACTUAL ACCURACY ===\n"
    "These errors will be automatically rejected:\n"
    "  ✗ 'IDA causes iron overload' — IDA = DEPLETED iron stores.\n"
    "  ✗ 'Bone marrow in IDA shows decreased erythropoiesis' — IDA = INCREASED erythroid activity + ABSENT iron stores.\n"
    "  ✗ 'ACD has normal or elevated serum iron' — ACD = LOW serum iron + HIGH ferritin.\n"
    "  ✗ 'Sickle cell causes hypochromic microcytic anemia' — sickle cell is normocytic.\n"
    "  ✗ 'Peripheral nerve damage causes ataxia' — PNS damage = peripheral neuropathy.\n"
    "If uncertain, skip the question.\n\n"

    "=== OPTION RULES ===\n"
    "- FORBIDDEN: 'All of the above', 'None of the above', 'Both A and B', 'Neither A nor B',\n"
    "  'All the above', 'Both of the above', 'None of these', ANY 'Both X and Y' phrasing.\n"
    "- Never recycle the same 4-option set across questions.\n\n"

    "=== DISTRACTOR QUALITY ===\n"
    "- Pathophysiology: related mechanisms or transporters.\n"
    "- Clinical: conditions in the same differential.\n"
    "- Lab: real values — just wrong direction or wrong test.\n\n"

    "=== ANTI-REPETITION ===\n"
    "- 30 DISTINCT educational objectives before generating. No overlaps.\n"
    "- Changing only age or sex does NOT make a new question.\n"
    "- Limited content → fewer but deeper questions. Quality over quantity.\n\n"

    "=== TOPIC DISTRIBUTION ===\n"
    "  Pathophysiology/Mechanisms: 5-7 | Etiology/Causes: 5-7 | Diagnostic Workup: 4-6\n"
    "  Clinical Presentation: 3-5 | Treatment/Management: 3-5 | Complications: 2-3 | Pharmacology: 2-3\n"
    "  Max 4 questions per subsection. Spread A/B/C/D answers evenly.\n\n"

    "=== OUTPUT FORMAT ===\n"
    "Return ONLY valid JSON — no markdown, no code fences:\n"
    "  summary: 3-5 sentences | key_concepts: 8-12 phrases\n"
    "  mcqs: [{topic, question, options:[4 strings prefixed A/B/C/D], answer, explanation}]\n\n"

    "=== VERIFICATION (internal) ===\n"
    "1. All objectives distinct. 2. Zero forbidden phrases incl. 'Both X and Y'.\n"
    "3. No demographic-only duplicates. 4. No identical option sets.\n"
    "5. Facts traceable to lecture. 6. IDA marrow = absent iron stores.\n"
    "7. ACD = low serum iron. 8. Consistent explanations. 9. Even A/B/C/D spread.\n"
    "Regenerate failing questions before output."
)

HIGHYIELD_USER_PROMPT = """Generate high-yield MCQs from the lecture text below.

QUANTITY: Rich lecture → up to 30 Qs. Short lecture → 10-15. Never pad. Stop when objectives run out.

HARD RULES (violation = rejected):
1. All of the above / None of the above / Both A and B / Neither A nor B — FORBIDDEN.
2. "Both X and Y" in any option — FORBIDDEN.
3. No two questions test the same concept.
4. Age/sex change only = same question = delete.
5. No identical 4-option sets.
6. Plausible distractors from same category only.
7. Facts from lecture text only.

FACTUAL BANS:
- IDA bone marrow = INCREASED erythroid activity + ABSENT stainable iron stores (not decreased erythropoiesis).
- ACD = LOW serum iron + HIGH ferritin (not normal/elevated serum iron).
- IDA ≠ iron overload. Sickle cell = normocytic.

OPTION PARALLELISM: All 4 options same conceptual level.
VIGNETTE UNIQUENESS: Different clinical content per vignette. Max 2 per diagnosis.
COVERAGE: Pathophysiology 5-7, Etiology 5-7, Workup 4-6, Clinical 3-5, Treatment 3-5, Complications 2-3.
DIFFICULTY: 30% recall, 50% application, 20% analysis.

VERIFY BEFORE OUTPUT:
1. Distinct objectives. 2. Zero forbidden phrases. 3. No demographic duplicates.
4. No IDA marrow = decreased erythropoiesis. 5. No ACD = elevated serum iron.
6. Consistent explanations. 7. Even A/B/C/D spread.

Return ONLY this JSON:
{{"summary":"string","key_concepts":["string"],"mcqs":[{{"topic":"string","question":"string","options":["A. text","B. text","C. text","D. text"],"answer":"A","explanation":"A — real explanation"}}]}}

Lecture text:
{text}"""


# ─────────────────────────────────────────────────────────────────
# EXAM MODE PROMPTS
# ─────────────────────────────────────────────────────────────────
EXAM_SYSTEM_PROMPT = (
    "You are writing questions for a real postgraduate medical licensing exam.\n\n"

    "STYLE REFERENCE:\n"
    "  'About phentolamine, all the following are FALSE EXCEPT: "
    "A. It is a sympathomimetic  B. It activates alpha receptors  "
    "C. It reduces peripheral resistance  D. It treats clonidine-withdrawal hypertensive crisis'\n"
    "  'All drugs are prodrugs EXCEPT: A. Enalapril  B. Ramipril  C. Lisinopril  D. Clopidogrel'\n"
    "  'A 68-year-old man with chronic heart failure develops pulmonary edema. First-line drug: "
    "A. Diltiazem  B. Dobutamine  C. Enalapril  D. Furosemide'\n\n"

    "=== MANDATORY FORMAT DISTRIBUTION ===\n"
    "Count as you write — hit these EXACTLY:\n"
    "  40% — 'All the following are FALSE EXCEPT': 3 false options + 1 true. Student finds the ONE TRUE.\n"
    "  35% — Clinical vignettes: age, sex, comorbidities, labs → management decision.\n"
    "  15% — Exact mechanism: specific receptor, transporter, enzyme, or ion channel.\n"
    "  10% — Classification trap: which item does NOT belong.\n"
    "ZERO FALSE EXCEPT questions = WRONG OUTPUT.\n\n"

    "=== FALSE EXCEPT FORMAT ===\n"
    "Stem: 'Regarding [topic], all the following are FALSE EXCEPT:'\n"
    "Options: A, B, C = false statements. One option = the single true statement.\n"
    "Example: 'A. Iron absorbed in ileum  B. Fe³⁺ transported by DMT1  "
    "C. Calcium enhances absorption  D. DMT1 transports Fe²⁺ into enterocytes' → Answer D\n\n"

    "=== RULES ===\n"
    "- One concept per question. No demographic variants.\n"
    "- Vignettes: unique clinical content (different comorbidities/labs/decisions).\n"
    "- Combination options (All of the above, A and B): max 2 total, only when strictly accurate.\n"
    "- 'Both X and Y' phrasing FORBIDDEN.\n"
    "- BANNED questions: 'most common symptom of X', 'primary cause in [demographic]'.\n\n"

    "=== FACTUAL ACCURACY ===\n"
    "Auto-rejected: IDA iron overload | IDA decreased erythropoiesis (correct=absent iron stores) | "
    "ACD normal/elevated serum iron (correct=low iron+high ferritin) | sickle cell microcytic.\n\n"

    "=== EXPLANATIONS ===\n"
    "Start: 'B — '. Sentence 1: why correct (specific mechanism). "
    "Sentence 2: why top wrong answer is wrong (by content, not letter). Never generic. Never self-contradicting.\n\n"

    "OUTPUT: Return ONLY valid JSON. No markdown. No trailing commas."
)

EXAM_USER_PROMPT = """Extract every distinct testable concept from the lecture. Write one exam-style MCQ per concept.

TARGET: Dense lecture → 15-25 Qs. Short → 8-12. Never fewer than 8.

FORMAT MIX — MANDATORY (count as you write, fix before submitting):
- 40% → "All the following are FALSE EXCEPT" (3 false + 1 true)
- 35% → Full clinical vignettes (specific labs/comorbidities → management)
- 15% → Exact mechanism (receptor/transporter/enzyme/channel)
- 10% → Classification trap (which does NOT belong)

FALSE EXCEPT EXAMPLE:
  "Regarding iron absorption, all the following are FALSE EXCEPT:
  A. Absorption mainly in ileum  B. Fe³⁺ transported by DMT1
  C. Calcium enhances absorption  D. Ferroportin exports iron from enterocytes"
  Answer: D

ANTI-REPETITION: Same mechanism twice → delete second. Age/sex-only vignette variants → delete duplicate.
FACTUAL BANS: IDA iron overload | IDA decreased erythropoiesis | ACD elevated serum iron | sickle cell microcytic.
COMBINATION OPTIONS: Max 2 total. "Both X and Y" FORBIDDEN.

VERIFY BEFORE SUBMITTING:
1. FALSE EXCEPT = ~40%. If zero → rewrite.
2. Vignettes = ~35%. Mechanism = ~15%. Traps = ~10%.
3. Zero forbidden phrases. No factual errors. No self-contradicting explanations.
4. A/B/C/D roughly evenly distributed.

Return ONLY valid JSON:
{{"summary":"string","key_concepts":["string"],"mcqs":[{{"topic":"string","question":"string","options":["A. text","B. text","C. text","D. text"],"answer":"A","explanation":"A — real explanation"}}]}}

Lecture text:
{text}"""


# ─────────────────────────────────────────────────────────────────
# POST-PROCESSING VALIDATORS
# ─────────────────────────────────────────────────────────────────

def _has_forbidden_option(mcq: dict, mode: str = "highyield") -> bool:
    if mode == "exam":
        return False
    for opt in mcq.get("options", []):
        if FORBIDDEN_OPTION_PATTERNS.search(opt):
            return True
        if SEMANTIC_COMBINED_PATTERNS.search(opt):
            return True
    return False


def _has_duplicate_options(mcq: dict) -> bool:
    def _norm(s: str) -> str:
        s = re.sub(r"^[a-d]\.\s*", "", s.lower())
        return re.sub(r"\s+", " ", s).strip()
    opts = [_norm(o) for o in mcq.get("options", [])]
    return len(opts) != len(set(opts))


def _answer_matches_options(mcq: dict) -> bool:
    answer = mcq.get("answer", "").upper()
    if answer not in {"A", "B", "C", "D"}:
        return False
    return (ord(answer) - ord("A")) < len(mcq.get("options", []))


def _has_known_factual_error(mcq: dict) -> tuple[bool, str]:
    question = mcq.get("question", "")
    explanation = mcq.get("explanation", "")
    answer_idx = ord(mcq.get("answer", "A").upper()) - ord("A")
    options = mcq.get("options", [])
    correct_option = options[answer_idx] if answer_idx < len(options) else ""
    check_text = correct_option + " " + explanation

    if _IDA_MARROW_QUESTION_PATTERN.search(question):
        if _IDA_MARROW_BAD_ANSWER.search(check_text):
            return True, "IDA bone marrow answered with 'decreased erythropoiesis' — correct is absent iron stores"

    if _ACD_QUESTION_PATTERN.search(question):
        if _ACD_BAD_ANSWER.search(check_text):
            return True, "ACD question states normal/elevated serum iron — correct is LOW iron + HIGH ferritin"

    return False, ""


def _norm_stem(s: str) -> str:
    s = s.lower()
    s = _DEMOGRAPHIC_STRIP.sub(" ", s)
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return " ".join(sorted(s.split()))


def _norm_options(mcq: dict) -> frozenset:
    def _norm(s: str) -> str:
        s = re.sub(r"^[a-d]\.\s*", "", s.lower())
        return re.sub(r"[^a-z0-9 ]", "", s).strip()
    return frozenset(_norm(o) for o in mcq.get("options", []))


def _deduplicate_by_question(mcqs: list) -> list:
    seen_stems: set[str] = set()
    seen_option_sets: set[frozenset] = set()
    unique = []
    for mcq in mcqs:
        stem_key = _norm_stem(mcq.get("question", ""))
        option_key = _norm_options(mcq)
        if stem_key in seen_stems:
            logger.warning(f"Duplicate stem removed: {mcq.get('question', '')[:70]}")
            continue
        if option_key in seen_option_sets and len(option_key) == 4:
            logger.warning(f"Duplicate option-set removed: {mcq.get('question', '')[:70]}")
            continue
        seen_stems.add(stem_key)
        seen_option_sets.add(option_key)
        unique.append(mcq)
    return unique


def _validate_and_filter_mcqs(mcqs: list, mode: str = "highyield") -> tuple[list, list]:
    valid = []
    rejected = []
    exam_catchall_count = 0

    for mcq in mcqs:
        reasons = []

        if _has_forbidden_option(mcq, mode):
            reasons.append("forbidden option phrase")
        if _has_duplicate_options(mcq):
            reasons.append("duplicate options within question")
        if not _answer_matches_options(mcq):
            reasons.append(f"answer letter '{mcq.get('answer')}' invalid")

        factual_error, factual_reason = _has_known_factual_error(mcq)
        if factual_error:
            reasons.append(f"factual error: {factual_reason}")

        if mode == "exam" and not reasons:
            for opt in mcq.get("options", []):
                if EXAM_CATCHALL_PATTERNS.search(opt):
                    exam_catchall_count += 1
                    if exam_catchall_count > 2:
                        reasons.append("exceeded max 2 catch-all options")
                    break

        if reasons:
            rejected.append({"question_preview": mcq.get("question", "")[:80], "reasons": reasons})
            logger.warning(f"Rejected [{mode}]: {mcq.get('question', '')[:60]} | {', '.join(reasons)}")
        else:
            valid.append(mcq)

    return valid, rejected


def _warn_answer_distribution(mcqs: list, mode: str = "highyield") -> None:
    counts = {"A": 0, "B": 0, "C": 0, "D": 0}
    for mcq in mcqs:
        letter = mcq.get("answer", "").upper()
        if letter in counts:
            counts[letter] += 1
    logger.info(f"[{mode}] Answer distribution: {counts}")
    total = len(mcqs)
    for letter, count in counts.items():
        ratio = count / total if total else 0
        if ratio < 0.10 or ratio > 0.45:
            logger.warning(f"[{mode}] Skewed: '{letter}' = {count}/{total} ({ratio:.0%})")


def _warn_exam_format_distribution(mcqs: list) -> None:
    false_except = sum(
        1 for m in mcqs
        if re.search(r"false.{0,20}except|wrong.{0,20}except", m.get("question", ""), re.IGNORECASE)
    )
    total = len(mcqs)
    if total == 0:
        return
    ratio = false_except / total
    logger.info(f"[exam] FALSE EXCEPT: {false_except}/{total} ({ratio:.0%})")
    if ratio < 0.25:
        logger.warning(f"[exam] FALSE EXCEPT ratio {ratio:.0%} — expected ~40%.")


def _fix_explanation_prefix(mcqs: list) -> list:
    for mcq in mcqs:
        answer_letter = mcq.get("answer", "")
        if isinstance(mcq.get("explanation"), str):
            mcq["explanation"] = re.sub(
                r"^[A-D](?=\s*[—\-–])", answer_letter, mcq["explanation"]
            )
    return mcqs


# ─────────────────────────────────────────────────────────────────
# SINGLE CHUNK API CALL
# ─────────────────────────────────────────────────────────────────

async def _call_single_chunk(
    text: str,
    mode: str,
    chunk_index: int,
    total_chunks: int,
    max_retries: int = 3,
) -> tuple[dict, float]:
    system_prompt = EXAM_SYSTEM_PROMPT if mode == "exam" else HIGHYIELD_SYSTEM_PROMPT
    user_prompt = (
        EXAM_USER_PROMPT.format(text=text)
        if mode == "exam"
        else HIGHYIELD_USER_PROMPT.format(text=text)
    )

    if total_chunks > 1:
        user_prompt += (
            f"\n\n[NOTE: This is chunk {chunk_index + 1} of {total_chunks} parallel chunks. "
            f"Generate 8-12 questions ONLY from this content. "
            "Do NOT repeat questions from other chunks. Keep explanations concise.]"
        )

    cfg = SPEED_CONFIG[mode]
    headers = {**OPENROUTER_HEADERS, "Authorization": f"Bearer {settings.AI_API_KEY}"}

    payload = {
        "model": settings.AI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": cfg["temperature"],
        "max_tokens": cfg["max_tokens"],
        "include_reasoning": False,
    }

    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            t_start = time.monotonic()

            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(OPENROUTER_URL, headers=headers, json=payload)
                resp.raise_for_status()

            elapsed = time.monotonic() - t_start
            raw = resp.json()["choices"][0]["message"]["content"]

            if len(raw.strip()) < 50:
                raise ValueError(f"Response too short ({len(raw)} chars) — likely a quota error")

            logger.info(
                f"[{mode}] Chunk {chunk_index + 1}/{total_chunks} done in {elapsed:.1f}s "
                f"(attempt {attempt + 1})"
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
    mcqs: list[dict] = []
    depth = 0
    obj_start: int | None = None

    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and obj_start is not None:
                candidate = text[obj_start: i + 1]
                try:
                    obj = json.loads(candidate)
                    if "question" in obj and "options" in obj and "answer" in obj:
                        mcqs.append(obj)
                except json.JSONDecodeError:
                    pass
                obj_start = None

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

async def generate_study_content(text: str, mode: str = "highyield") -> Dict[str, Any]:
    if not settings.AI_API_KEY:
        logger.warning("AI_API_KEY is not set — returning mock data")
        return _get_mock_response()

    time_estimate = _estimate_processing_time(text, mode)
    logger.info(
        f"[{mode}] Estimate: {time_estimate['chunks']} chunk(s) in parallel, ~{time_estimate['estimated_range']}"
    )

    chunks = _chunk_text(text)
    total_chunks = len(chunks)

    try:
        t_total_start = time.monotonic()

        # All chunks processed concurrently — total time = slowest chunk, not sum
        logger.info(f"[{mode}] Firing {total_chunks} chunk(s) in parallel...")
        tasks = [
            _call_single_chunk(chunk, mode, i, total_chunks)
            for i, chunk in enumerate(chunks)
        ]
        chunk_output = await asyncio.gather(*tasks)

        chunk_results = [data for data, _ in chunk_output]
        chunk_timings = [round(elapsed, 2) for _, elapsed in chunk_output]
        total_elapsed = round(time.monotonic() - t_total_start, 2)

        merged = _merge_chunk_results(chunk_results)
        raw_mcqs = merged.get("mcqs", [])

        deduped = _deduplicate_by_question(raw_mcqs)
        valid_mcqs, rejected = _validate_and_filter_mcqs(deduped, mode)

        if rejected:
            logger.warning(f"[{mode}] {len(rejected)} MCQs rejected: {[r['reasons'] for r in rejected]}")

        valid_mcqs = _fix_explanation_prefix(valid_mcqs)
        _warn_answer_distribution(valid_mcqs, mode)
        if mode == "exam":
            _warn_exam_format_distribution(valid_mcqs)

        merged["mcqs"] = valid_mcqs
        merged["_meta"] = {
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
