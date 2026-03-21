import json
import re
import time
import logging
import httpx
from typing import Dict, Any
from app.core.config import settings

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# ─────────────────────────────────────────────────────────────────
# CHUNKING CONFIGURATION
# ─────────────────────────────────────────────────────────────────
# Each chunk is sent as a separate API call and results are merged.
# Overlap prevents cutting a concept mid-sentence at chunk boundaries.
CHUNK_SIZE = 40_000       # ~10-12 pages per chunk
CHUNK_OVERLAP = 2_000     # overlap between consecutive chunks
MAX_CHUNKS = 10           # safety cap — prevents runaway on 500MB uploads


# ─────────────────────────────────────────────────────────────────
# SPEED CONFIGURATION
# ─────────────────────────────────────────────────────────────────
# These values are tuned for OpenRouter / large model inference.
# Lower max_tokens = faster response without losing question quality.
SPEED_CONFIG = {
    "highyield": {
        "max_tokens": 5000,       # was 8000 — saves ~8-12s per chunk
        "temperature": 0.30,      # was 0.35
        "presence_penalty": 0.3,  # was 0.5
        "frequency_penalty": 0.3, # was 0.4
    },
    "exam": {
        "max_tokens": 5000,
        "temperature": 0.35,      # was 0.40
        "presence_penalty": 0.3,
        "frequency_penalty": 0.3,
    },
}

# Approximate tokens-per-second for time estimation.
# Adjust after observing real latency on your deployment.
ESTIMATED_TPS = 80  # conservative estimate for OpenRouter free tier


# ─────────────────────────────────────────────────────────────────
# FORBIDDEN PATTERNS — used in post-processing validation
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

# ── Factual flags ────────────────────────────────────────────────
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

# Strip Qwen3 / DeepSeek thinking tags that appear before JSON output
_THINKING_TAG_PATTERN = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


# ─────────────────────────────────────────────────────────────────
# TEXT CHUNKING
# ─────────────────────────────────────────────────────────────────

def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE) -> list[str]:
    """
    Split lecture text into overlapping chunks so no content is lost.
    Each chunk gets its own MCQ generation call and results are merged.
    Overlap prevents cutting a concept mid-sentence at chunk boundaries.
    """
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

    logger.info(f"Text split into {len(chunks)} chunks "
                f"({len(text):,} chars total, {chunk_size:,} chars/chunk, "
                f"{CHUNK_OVERLAP:,} char overlap)")
    return chunks


def _estimate_processing_time(text: str, mode: str) -> dict:
    """
    Estimate total processing time before the API call starts.
    Returns a dict with human-readable estimates for the frontend.

    Formula:
      chunks × (prompt_tokens + max_output_tokens) / estimated_TPS
    """
    chunks = _chunk_text(text)
    n_chunks = len(chunks)
    max_tokens = SPEED_CONFIG[mode]["max_tokens"]

    # Rough prompt token estimate: ~1 token per 4 chars of chunk + ~1500 for system prompt
    prompt_tokens_per_chunk = (CHUNK_SIZE // 4) + 1500
    total_tokens = n_chunks * (prompt_tokens_per_chunk + max_tokens)
    estimated_seconds = total_tokens / ESTIMATED_TPS

    # Add network overhead per chunk (~3s round-trip latency)
    estimated_seconds += n_chunks * 3

    return {
        "chunks": n_chunks,
        "estimated_seconds": round(estimated_seconds),
        "estimated_range": f"{max(5, round(estimated_seconds * 0.7))}–{round(estimated_seconds * 1.3)}s",
        "text_length_chars": len(text),
        "note": (
            "Large PDFs are processed in chunks. "
            f"Your document will be processed in {n_chunks} part(s)."
        ) if n_chunks > 1 else "Single chunk — fastest processing.",
    }


# ─────────────────────────────────────────────────────────────────
# HIGH YIELD MODE
# ─────────────────────────────────────────────────────────────────
HIGHYIELD_SYSTEM_PROMPT = (
    "You are a professor-level medical exam writer for postgraduate and clinical board examinations (USMLE, COMLEX, ABIM, FRCPath, etc.). "
    "Your job is to generate DIFFICULT, high-yield MCQs strictly based on the provided lecture text. "
    "Questions must demand deep understanding, clinical reasoning, and pattern recognition — not surface recall.\n\n"

    "=== DIFFICULTY STANDARDS ===\n"
    "Each question must fall into one of three types:\n"
    "  Type 1 (Recall — max 30%): Direct fact retrieval. Example: 'What is the primary site of iron absorption?'\n"
    "  Type 2 (Application — ~50%): Clinical vignette requiring diagnosis, next best step, or mechanism identification. "
    "Example: 'A 35-year-old woman presents with fatigue and pallor. Labs show microcytic anemia, low serum ferritin, and low serum iron. "
    "What is the most likely cause?'\n"
    "  Type 3 (Analysis — ~20%): Higher-order reasoning including 'all EXCEPT' questions, multi-mechanism integration, "
    "or comparing/contrasting similar pathologies. Example: 'Which combination of laboratory findings best distinguishes "
    "iron deficiency anemia from anemia of chronic disease?'\n\n"

    "=== QUESTION CRAFTING RULES ===\n"
    "- Use clinical vignettes for Type 2 and Type 3 questions — include age, sex, relevant symptoms, and key labs.\n"
    "- VIGNETTE UNIQUENESS: Each vignette must differ in CLINICAL CONTENT (different symptoms, labs, or diagnosis). "
    "Two vignettes that share the same symptoms, labs, and diagnosis but differ only in patient age or sex are IDENTICAL and must not both appear.\n"
    "- OPTION PARALLELISM: All 4 options must be at the same conceptual level. Do NOT mix a root cause with its downstream effect "
    "in the same option list. Example: Do NOT offer both 'insufficient iron availability' and 'impaired hemoglobin synthesis' "
    "as separate options when one causes the other — pick the level of explanation and keep all options at that level.\n"
    "- Double-negatives and exception questions ('all EXCEPT', 'which is LEAST likely') are encouraged for Type 3.\n"
    "- Distractors must be the most commonly confused alternatives — exploit predictable misconceptions.\n"
    "- Every fact, diagnosis, mechanism, and treatment must come EXCLUSIVELY from the lecture text.\n"
    "- The 'explanation' field must be internally consistent — never contradict itself.\n\n"

    "=== CRITICAL FACTUAL ACCURACY — READ CAREFULLY ===\n"
    "The following errors appear repeatedly in AI-generated medical MCQs. Every one is WRONG. "
    "If your output contains any of these, it will be automatically rejected:\n\n"
    "  ✗ WRONG: 'IDA causes iron overload' — IDA is defined by DEPLETED iron stores, not excess.\n"
    "  ✗ WRONG: 'Bone marrow in IDA shows decreased erythropoiesis' — IDA bone marrow shows INCREASED "
    "erythroid activity (compensatory) with ABSENT stainable iron stores. Decreased erythropoiesis is NEVER "
    "the correct answer for an IDA bone marrow question. The correct finding is absent iron stores.\n"
    "  ✗ WRONG: 'ACD has normal or elevated serum iron' — Anemia of chronic disease causes LOW serum iron "
    "(with HIGH ferritin). This is what distinguishes it from IDA, where both serum iron AND ferritin are low.\n"
    "  ✗ WRONG: 'Sickle cell disease causes hypochromic microcytic anemia' — sickle cell is normocytic.\n"
    "  ✗ WRONG: 'Peripheral nerve damage causes ataxia' — PNS damage causes peripheral neuropathy.\n\n"
    "If you are uncertain whether a fact is correct, do NOT include it — skip that question entirely.\n\n"

    "=== OPTION RULES (strictly enforced — violations will be auto-rejected) ===\n"
    "- Each of the 4 options must be a SINGLE specific answer.\n"
    "- All 4 options must belong to the SAME category (all anatomical sites, all lab findings, all mechanisms, etc.).\n"
    "- FORBIDDEN options — do NOT use any of these constructs:\n"
    "    • 'All of the above'\n"
    "    • 'None of the above'\n"
    "    • 'Both A and B' / 'Neither A nor B'\n"
    "    • 'All the above' / 'Both of the above' / 'None of these'\n"
    "    • ANY 'Both X and Y' phrasing — for example, 'Both alpha and beta thalassemia' is FORBIDDEN "
    "because it is structurally identical to 'Both A and B'. Name a single specific answer instead.\n"
    "- Never recycle the same 4-option set across multiple questions.\n\n"

    "=== DISTRACTOR QUALITY RULES ===\n"
    "- Wrong answers must represent plausible misconceptions, not random terms.\n"
    "- For pathophysiology: distractors should be related mechanisms or transporters.\n"
    "- For clinical questions: distractors should be conditions in the same differential with overlapping features.\n"
    "- For lab questions: distractors must be real lab values — just the wrong direction or wrong test.\n\n"

    "=== ANTI-REPETITION RULES ===\n"
    "- Before generating, list 30 DISTINCT educational objectives. No two may overlap.\n"
    "- No two questions may test the same fact, even with different patient demographics or wording.\n"
    "- Changing only patient age or sex does NOT make a new question.\n"
    "- Do NOT generate questions with identical or near-identical option sets.\n"
    "- If lecture content is limited, generate FEWER but DEEPER questions. "
    "Do NOT pad with repetition. Quality over quantity — a set of 15 excellent questions is better than 30 poor ones.\n\n"

    "=== TOPIC COVERAGE & DISTRIBUTION ===\n"
    "Distribute questions across these categories (scale to available content):\n"
    "  - Pathophysiology / Mechanisms: 5-7 questions\n"
    "  - Etiology / Causes / Risk Factors: 5-7 questions\n"
    "  - Diagnostic Workup (labs, imaging, biopsy): 4-6 questions\n"
    "  - Clinical Presentation: 3-5 questions\n"
    "  - Treatment / Management: 3-5 questions\n"
    "  - Complications / Prognosis: 2-3 questions\n"
    "  - Pharmacology: 2-3 questions (if applicable)\n\n"
    "- Maximum 4 questions per lecture subsection.\n"
    "- Spread correct answers (A/B/C/D) evenly — approximately 7-8 of each letter per 30 questions.\n\n"

    "=== OUTPUT FORMAT ===\n"
    "Return ONLY valid JSON. No markdown, no code fences, no extra text.\n"
    "  - summary: 3-5 sentences synthesizing the lecture's core concepts\n"
    "  - key_concepts: list of 8-12 short, high-yield phrases\n"
    "  - mcqs: array of question objects, each with:\n"
    "      - topic: lecture section name\n"
    "      - question: full question stem\n"
    "      - options: list of 4 strings prefixed 'A.', 'B.', 'C.', 'D.'\n"
    "      - answer: single letter 'A', 'B', 'C', or 'D'\n"
    "      - explanation: correct letter + 1-2 sentences on WHY correct and WHY top distractor is wrong\n\n"

    "=== VERIFICATION STEP (internal — do not output) ===\n"
    "Before finalizing:\n"
    "1. All educational objectives are distinct.\n"
    "2. ZERO forbidden option phrases — including any 'Both X and Y' constructs.\n"
    "3. No two vignettes differ only in patient demographics.\n"
    "4. No two questions share an identical option set.\n"
    "5. Every fact is traceable to the lecture text.\n"
    "6. No IDA bone marrow question answers 'decreased erythropoiesis' — correct answer is absent iron stores.\n"
    "7. No ACD question states normal or elevated serum iron — ACD = low serum iron.\n"
    "8. Every explanation is internally consistent — it does not contradict itself.\n"
    "9. Answer distribution is roughly even (A/B/C/D ~7-8 each).\n"
    "Regenerate any question that fails a check before output."
)


HIGHYIELD_USER_PROMPT = """Read the lecture text carefully and generate high-yield MCQs based ONLY on its content.

QUANTITY RULE: Generate as many questions as the content supports with high quality.
- Rich lecture (many distinct concepts) → up to 30 questions.
- Short or narrow lecture → fewer questions (e.g. 10-15). Do NOT pad with repetition to hit 30.
- Every question must have a UNIQUE educational objective. Stop generating when you run out of distinct objectives.

HARD RULES — violation = automatic rejection:
1. "All of the above", "None of the above", "Both A and B", "Neither A nor B" — COMPLETELY FORBIDDEN.
2. "Both X and Y" phrasing in any option is FORBIDDEN. Example: "Both alpha and beta thalassemia" = FORBIDDEN.
   Instead, name a single specific answer.
3. No two questions test the same concept — even with different demographics or wording.
4. Changing ONLY patient age or sex = same question = delete it.
5. No two questions share an identical 4-option set.
6. Every distractor must be a plausible near-miss from the same category.
7. Every fact must come directly from the lecture text — do not invent anything.

FACTUAL ACCURACY — these errors are BANNED and will be auto-rejected:
- NEVER say IDA causes iron overload (IDA = depleted iron stores).
- NEVER say IDA bone marrow shows decreased erythropoiesis.
  CORRECT: IDA bone marrow shows INCREASED erythroid activity with ABSENT stainable iron stores.
  The correct bone marrow answer for IDA is always "absent iron stores", not "decreased erythropoiesis".
- NEVER say ACD has normal or elevated serum iron. ACD = LOW serum iron + HIGH ferritin.
- NEVER say sickle cell causes microcytic anemia (it is normocytic).
- If uncertain about a fact, skip the question entirely.

OPTION PARALLELISM RULE:
- All 4 options must be at the same conceptual level.
- Do NOT mix a root cause with its downstream effect.

EXPLANATION CONSISTENCY RULE:
- Explanations must not contradict themselves.
- If a fact is used to support the correct answer, it cannot simultaneously describe a wrong answer.

VIGNETTE UNIQUENESS:
- Each vignette must differ in CLINICAL CONTENT: different labs, different diagnosis, or different management question.
- Maximum 2 vignettes per diagnosis category.

COVERAGE (scale to content):
- Pathophysiology / Mechanisms: 5-7
- Etiology / Causes: 5-7
- Diagnostic Workup: 4-6
- Clinical Presentation: 3-5
- Treatment / Management: 3-5
- Complications / Prognosis: 2-3
- Pharmacology (if applicable): 2-3

DIFFICULTY MIX:
- 30% recall: "What is X?"
- 50% application: clinical vignette with specific labs → diagnosis or next step
- 20% analysis: "All EXCEPT", mechanism comparison, or lab pattern differentiation

OPTION RULES:
- All 4 options from the same semantic category.
- Distractors = top-2 most commonly confused near-misses.
- Unique option set per question — no recycling.

BEFORE OUTPUT — verify:
1. All educational objectives are distinct and non-overlapping.
2. Zero forbidden option phrases, including "Both X and Y" constructs.
3. No demographic-only duplicate vignettes.
4. No IDA bone marrow question says "decreased erythropoiesis".
5. No ACD question says "normal or elevated serum iron".
6. All explanations are internally consistent.
7. Correct answers evenly spread (A/B/C/D roughly equal).

FORMAT per MCQ:
- topic, question, options: ["A. ...", "B. ...", "C. ...", "D. ..."], answer: "A"/"B"/"C"/"D"
- explanation: correct letter + why correct + why top distractor is wrong (1-2 sentences, no contradictions)

Also: summary (3-5 sentences), key_concepts (8-12 phrases).

Return ONLY this JSON:
{{"summary":"string","key_concepts":["string"],"mcqs":[{{"topic":"string","question":"string","options":["A. text","B. text","C. text","D. text"],"answer":"A","explanation":"A — real explanation here"}}]}}

Lecture text:
{text}"""


# ─────────────────────────────────────────────────────────────────
# EXAM MODE
# ─────────────────────────────────────────────────────────────────
EXAM_SYSTEM_PROMPT = (
    "You are writing questions for a real postgraduate medical licensing exam. "
    "Model your questions EXACTLY on the style of actual board exam questions shown below.\n\n"

    "STYLE REFERENCE — real exam questions. Match this difficulty and format:\n"
    "  'About phentolamine, all the following are FALSE EXCEPT: "
    "A. It is a sympathomimetic  B. It activates alpha receptors  "
    "C. It reduces peripheral resistance  D. It treats clonidine-withdrawal hypertensive crisis'\n"
    "  'All drugs are prodrugs EXCEPT: A. Enalapril  B. Ramipril  C. Lisinopril  D. Clopidogrel'\n"
    "  'A 68-year-old man with chronic heart failure abandons his low-salt diet and develops "
    "severe pulmonary edema 3 days later. First-line drug: "
    "A. Diltiazem  B. Dobutamine  C. Enalapril  D. Furosemide'\n"
    "  'Ranolazine inhibits: A. late I(Ca)  B. late I(K)  C. late I(Na)  D. COX-1'\n"
    "  'All following are anticoagulants EXCEPT: "
    "A. Fondaparinux  B. Rivaroxaban  C. Cilostazol  D. Bivalirudin'\n\n"

    "=== MANDATORY FORMAT DISTRIBUTION — THIS IS THE MOST IMPORTANT RULE ===\n"
    "You MUST produce questions in EXACTLY this ratio. Count your questions as you write them:\n"
    "  40% — 'All the following are FALSE/WRONG EXCEPT' format.\n"
    "         HOW TO WRITE IT: Write 3 false statements and 1 true statement as options.\n"
    "         The student must identify the ONE TRUE option.\n"
    "         Example stem: 'Regarding iron absorption, all the following are FALSE EXCEPT:'\n"
    "         Example options: 'A. Iron is absorbed mainly in the ileum  "
    "B. Ferric iron is the absorbable form  C. Vitamin C inhibits iron absorption  "
    "D. DMT1 transports ferrous iron into enterocytes'\n"
    "         (D is the only true statement — A, B, C are all false)\n"
    "  35% — Full clinical vignettes with specific comorbidities and labs → management decision.\n"
    "  15% — Exact mechanism: name the specific receptor, transporter, enzyme, or ion channel.\n"
    "  10% — Classification trap: which item does NOT belong to the group.\n\n"
    "IF YOUR OUTPUT CONTAINS ZERO 'FALSE EXCEPT' QUESTIONS, IT IS WRONG. "
    "For a 10-question set: write 4 FALSE EXCEPT, 3-4 vignettes, 1-2 mechanism, 1 classification trap.\n\n"

    "=== VIGNETTE UNIQUENESS ===\n"
    "- Each vignette must differ in CLINICAL CONTENT — different comorbidities, labs, or decision point.\n"
    "- Changing only patient age or sex does NOT create a new question.\n"
    "- Two vignettes reaching the same answer via the same reasoning = duplicate. Delete one.\n\n"

    "=== COMBINATION OPTIONS — max 2 per set ===\n"
    "- 'D. All of the above' ONLY when ALL 3 other options are correct.\n"
    "- 'D. None of the above' ONLY when NO other option is correct.\n"
    "- 'D. A and B' ONLY when exactly A and B are both correct.\n"
    "- 'Both X and Y' phrasing is FORBIDDEN — same construct as 'Both A and B'.\n"
    "- Standard single-item options are always preferred.\n\n"

    "=== ONE-CONCEPT-ONE-QUESTION ===\n"
    "- Each question tests exactly ONE distinct concept.\n"
    "- Never vary only demographics or drug name to manufacture a fake new question.\n\n"

    "=== CRITICAL FACTUAL ACCURACY ===\n"
    "- Every fact must be verifiable from the lecture text. If uncertain, skip the question.\n"
    "- These errors will be auto-rejected:\n"
    "    ✗ 'IDA causes iron overload'\n"
    "    ✗ 'IDA bone marrow shows decreased erythropoiesis' — correct finding is ABSENT iron stores\n"
    "    ✗ 'ACD has normal or elevated serum iron' — ACD = LOW serum iron + HIGH ferritin\n"
    "    ✗ 'Sickle cell is microcytic'\n"
    "- Explanations must be internally consistent.\n\n"

    "=== STRICT BANS ===\n"
    "  BANNED: 'What is the most common symptom of X?'\n"
    "  BANNED: 'What is the primary cause of X in [demographic]?'\n"
    "  BANNED: Recycling the same 4-option set across different questions.\n"
    "  BANNED: Questions answerable without knowing the specific mechanism.\n\n"

    "=== DISTRACTOR QUALITY ===\n"
    "- Wrong answers = real items from the most closely related category.\n"
    "- Never use an option a partially-prepared student would immediately eliminate.\n\n"

    "=== EXPLANATION RULES ===\n"
    "- Start: 'B — ' (correct letter + dash).\n"
    "- Sentence 1: WHY correct — specific mechanism, receptor, or property from lecture.\n"
    "- Sentence 2: WHY the most tempting wrong answer is wrong — named by content, never by letter.\n"
    "- NEVER write a generic explanation. NEVER contradict yourself within the same explanation.\n\n"

    "OUTPUT: Return ONLY valid JSON. No markdown, no trailing commas, no text outside the object."
)

EXAM_USER_PROMPT = """Read the entire lecture text. Extract every distinct testable concept and write one exam-style MCQ per concept.

TARGET: Dense lecture → 15-25 questions. Short lecture → 8-12. Never fewer than 8.

=== FORMAT MIX — MANDATORY, COUNT AS YOU WRITE ===
You MUST hit these ratios. If you finish and the distribution is wrong, rewrite questions until it is correct:
- 40% → "All the following are FALSE EXCEPT" (write 3 false options + 1 true; student finds the ONE TRUE)
- 35% → Full clinical vignettes (age, sex, specific comorbidities, specific labs → management)
- 15% → Exact mechanism question (specific receptor, transporter, enzyme, ion channel)
- 10% → Classification trap (which item does NOT belong)

HOW TO WRITE A "FALSE EXCEPT" QUESTION:
  Stem: "Regarding [topic], all the following are FALSE EXCEPT:"
  Write options A, B, C as clearly false statements about the topic.
  Write option D (or whichever letter) as the ONE true statement.
  Example: "Regarding iron absorption, all the following are FALSE EXCEPT:
    A. Iron absorption occurs mainly in the ileum
    B. Ferric (Fe³⁺) is the form transported by DMT1
    C. Calcium enhances iron absorption
    D. Ferroportin exports iron from enterocytes into the bloodstream"
  Answer: D

CONCEPT EXHAUSTION RULE:
- List every major concept before writing. Each → at most 1 question. Exhaust the list.

ANTI-REPETITION:
- Same mechanism tested twice = delete the second.
- Vignettes differing only in age/sex = delete the duplicate.
- No more than 3 questions per lecture section.
- No two questions share an identical 4-option set.

FACTUAL ACCURACY — auto-rejected if violated:
- NEVER say IDA causes iron overload.
- NEVER say IDA bone marrow shows decreased erythropoiesis.
  CORRECT: IDA bone marrow = INCREASED erythroid activity + ABSENT stainable iron stores.
- NEVER say ACD has normal or elevated serum iron (ACD = LOW serum iron + HIGH ferritin).
- NEVER say sickle cell is microcytic.

COMBINATION OPTIONS: max 2 total, only when strictly accurate.
"Both X and Y" phrasing is FORBIDDEN.

BEFORE OUTPUT — verify format distribution:
1. Count FALSE EXCEPT questions — must be ~40% of total. If zero, rewrite before submitting.
2. Count vignettes — must be ~35%.
3. Count mechanism questions — must be ~15%.
4. Count classification traps — must be ~10%.
5. Zero forbidden option phrases including "Both X and Y".
6. No IDA bone marrow question answers "decreased erythropoiesis".
7. No ACD question states "normal or elevated serum iron".
8. No self-contradicting explanations.
9. A/B/C/D answers distributed roughly evenly.

FORMAT per MCQ:
- topic, question, options: ["A. ...", "B. ...", "C. ...", "D. ..."]
- answer: "A"/"B"/"C"/"D"
- explanation: "X — [why correct, specific fact from lecture]. [Why most tempting wrong answer is wrong, by content not letter.]"

Also: summary (3-5 sentences), key_concepts (8-12 phrases).

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

    if _IDA_MARROW_QUESTION_PATTERN.search(question):
        if _IDA_MARROW_BAD_ANSWER.search(correct_option + " " + explanation):
            return True, (
                "IDA bone marrow question incorrectly answered with 'decreased erythropoiesis'; "
                "correct finding is absent iron stores with increased erythroid activity"
            )

    if _ACD_QUESTION_PATTERN.search(question):
        if _ACD_BAD_ANSWER.search(correct_option + " " + explanation):
            return True, (
                "ACD question incorrectly states normal or elevated serum iron; "
                "ACD is characterised by LOW serum iron and HIGH ferritin"
            )

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
            reasons.append("forbidden option phrase — literal catch-all or semantic 'Both X and Y'")
        if _has_duplicate_options(mcq):
            reasons.append("duplicate options within question")
        if not _answer_matches_options(mcq):
            reasons.append(f"answer letter '{mcq.get('answer')}' out of range or invalid")

        factual_error, factual_reason = _has_known_factual_error(mcq)
        if factual_error:
            reasons.append(f"known factual error: {factual_reason}")

        if mode == "exam" and not reasons:
            for opt in mcq.get("options", []):
                if EXAM_CATCHALL_PATTERNS.search(opt):
                    exam_catchall_count += 1
                    if exam_catchall_count > 2:
                        reasons.append("exceeded max 2 catch-all options for exam mode")
                    break

        if reasons:
            rejected.append({
                "question_preview": mcq.get("question", "")[:80],
                "reasons": reasons,
            })
            logger.warning(
                f"Rejected MCQ [{mode}]: {mcq.get('question', '')[:60]} | "
                f"Reasons: {', '.join(reasons)}"
            )
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
            logger.warning(
                f"[{mode}] Distribution skewed: '{letter}' = {count}/{total} ({ratio:.0%})"
            )


def _warn_exam_format_distribution(mcqs: list) -> None:
    false_except = sum(
        1 for m in mcqs
        if re.search(
            r"false.{0,20}except|wrong.{0,20}except|incorrect.{0,20}except",
            m.get("question", ""), re.IGNORECASE,
        )
    )
    total = len(mcqs)
    if total == 0:
        return
    ratio = false_except / total
    logger.info(f"[exam] FALSE EXCEPT questions: {false_except}/{total} ({ratio:.0%})")
    if ratio < 0.25:
        logger.warning(
            f"[exam] FALSE EXCEPT ratio is {ratio:.0%} — expected ~40%. "
            "Exam mode format distribution rule is not being followed."
        )


def _fix_explanation_prefix(mcqs: list) -> list:
    """Ensure the explanation letter prefix matches the declared answer."""
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
) -> tuple[dict, float]:
    """
    Call the API for a single text chunk.
    Returns (parsed_data, elapsed_seconds).
    """
    system_prompt = EXAM_SYSTEM_PROMPT if mode == "exam" else HIGHYIELD_SYSTEM_PROMPT
    user_prompt = (
        EXAM_USER_PROMPT.format(text=text)
        if mode == "exam"
        else HIGHYIELD_USER_PROMPT.format(text=text)
    )

    # Append chunk context note so the model knows it's part of a larger document
    if total_chunks > 1:
        user_prompt += (
            f"\n\n[NOTE: This is chunk {chunk_index + 1} of {total_chunks} from a larger document. "
            "Generate questions only from the content above. Do not repeat questions from other chunks.]"
        )

    cfg = SPEED_CONFIG[mode]

    request_headers = {
        "Authorization": f"Bearer {settings.AI_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost",
    }

    payload = {
        "model": settings.AI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": cfg["temperature"],
        "presence_penalty": cfg["presence_penalty"],
        "frequency_penalty": cfg["frequency_penalty"],
        "max_tokens": cfg["max_tokens"],
        "response_format": {"type": "json_object"},
    }

    t_start = time.monotonic()

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(GROQ_API_URL, headers=request_headers, json=payload)
        resp.raise_for_status()

    elapsed = time.monotonic() - t_start

    raw = resp.json()["choices"][0]["message"]["content"]
    logger.info(
        f"[{mode}] Chunk {chunk_index + 1}/{total_chunks} completed in {elapsed:.1f}s | "
        f"Preview: {raw[:200]}"
    )

    # Strip thinking tags (Qwen3 / DeepSeek reasoning models)
    cleaned = _THINKING_TAG_PATTERN.sub("", raw).strip()
    cleaned = re.sub(r"```(?:json)?", "", cleaned).strip().rstrip("```").strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        data = _salvage_partial_json(cleaned, chunk_index)

    return data, elapsed


def _salvage_partial_json(text: str, chunk_index: int = 0) -> dict:
    """
    Recover usable data from a truncated AI response.

    Strategy:
      1. Extract every complete MCQ object via brace-matching.
      2. Extract summary and key_concepts with targeted regex.
      3. Return a valid dict even if some fields are missing.

    This handles the common case where max_tokens cuts the JSON mid-array.
    """
    # ── 1. Extract complete MCQ objects ──────────────────────────
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
                candidate = text[obj_start : i + 1]
                try:
                    obj = json.loads(candidate)
                    # Only keep objects that look like MCQs
                    if "question" in obj and "options" in obj and "answer" in obj:
                        mcqs.append(obj)
                except json.JSONDecodeError:
                    pass
                obj_start = None

    # ── 2. Extract summary ────────────────────────────────────────
    summary = ""
    summary_match = re.search(r'"summary"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    if summary_match:
        try:
            summary = json.loads(f'"{summary_match.group(1)}"')
        except json.JSONDecodeError:
            summary = summary_match.group(1)

    # ── 3. Extract key_concepts ───────────────────────────────────
    key_concepts: list[str] = []
    kc_match = re.search(r'"key_concepts"\s*:\s*(\[.*?\])', text, re.DOTALL)
    if kc_match:
        try:
            key_concepts = json.loads(kc_match.group(1))
        except json.JSONDecodeError:
            # Grab individual quoted strings from the partial array
            key_concepts = re.findall(r'"((?:[^"\\]|\\.)+)"', kc_match.group(1))

    if not mcqs and not summary:
        raise ValueError(
            f"Could not salvage any content from AI response for chunk {chunk_index + 1}"
        )

    logger.warning(
        f"Chunk {chunk_index + 1}: JSON was truncated — salvaged "
        f"{len(mcqs)} MCQ(s), summary={'yes' if summary else 'no'}"
    )
    return {"summary": summary, "key_concepts": key_concepts, "mcqs": mcqs}


# ─────────────────────────────────────────────────────────────────
# MERGE RESULTS FROM MULTIPLE CHUNKS
# ─────────────────────────────────────────────────────────────────

def _merge_chunk_results(results: list[dict]) -> dict:
    """
    Merge MCQ lists, summaries, and key_concepts from multiple chunks
    into a single unified response object.
    """
    if len(results) == 1:
        return results[0]

    merged_mcqs: list[dict] = []
    all_key_concepts: list[str] = []
    # Use the summary from the first chunk as the base
    merged_summary = results[0].get("summary", "")

    for result in results:
        merged_mcqs.extend(result.get("mcqs", []))
        all_key_concepts.extend(result.get("key_concepts", []))

    # Deduplicate key_concepts while preserving order
    seen_kc: set[str] = set()
    unique_key_concepts = []
    for kc in all_key_concepts:
        norm = kc.lower().strip()
        if norm not in seen_kc:
            seen_kc.add(norm)
            unique_key_concepts.append(kc)

    return {
        "summary": merged_summary,
        "key_concepts": unique_key_concepts[:12],  # cap at 12
        "mcqs": merged_mcqs,
    }


# ─────────────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────────

async def generate_study_content(text: str, mode: str = "highyield") -> Dict[str, Any]:
    """
    Main entry point. Handles text of any size via chunking.
    Returns merged, validated MCQ data plus timing metadata.
    """
    if not settings.AI_API_KEY:
        logger.warning("AI_API_KEY is not set — returning mock data")
        return _get_mock_response()

    # ── Pre-flight: estimate processing time ─────────────────────
    time_estimate = _estimate_processing_time(text, mode)
    logger.info(
        f"[{mode}] Processing estimate: {time_estimate['chunks']} chunk(s), "
        f"~{time_estimate['estimated_range']}"
    )

    chunks = _chunk_text(text)
    total_chunks = len(chunks)

    try:
        # ── Process each chunk ────────────────────────────────────
        chunk_results = []
        chunk_timings = []
        t_total_start = time.monotonic()

        for i, chunk in enumerate(chunks):
            logger.info(f"[{mode}] Processing chunk {i + 1}/{total_chunks} "
                        f"({len(chunk):,} chars)...")
            data, elapsed = await _call_single_chunk(chunk, mode, i, total_chunks)
            chunk_results.append(data)
            chunk_timings.append(round(elapsed, 2))

        total_elapsed = round(time.monotonic() - t_total_start, 2)

        # ── Merge all chunks ──────────────────────────────────────
        merged = _merge_chunk_results(chunk_results)
        raw_mcqs = merged.get("mcqs", [])

        # ── Step 1: deduplicate across all chunks ─────────────────
        deduped = _deduplicate_by_question(raw_mcqs)

        # ── Step 2: validate + filter ─────────────────────────────
        valid_mcqs, rejected = _validate_and_filter_mcqs(deduped, mode)

        if rejected:
            logger.warning(
                f"[{mode}] {len(rejected)} MCQs rejected. "
                f"Reasons: {[r['reasons'] for r in rejected]}"
            )

        # ── Step 3: fix explanation prefixes ──────────────────────
        valid_mcqs = _fix_explanation_prefix(valid_mcqs)

        # ── Step 4: monitor distributions ─────────────────────────
        _warn_answer_distribution(valid_mcqs, mode)
        if mode == "exam":
            _warn_exam_format_distribution(valid_mcqs)

        merged["mcqs"] = valid_mcqs
        merged["_meta"] = {
            # Question counts
            "total_generated": len(raw_mcqs),
            "total_after_dedup": len(deduped),
            "total_valid": len(valid_mcqs),
            "total_rejected": len(rejected),
            "rejection_log": rejected,
            # Chunking info
            "chunks_processed": total_chunks,
            "chunk_timings_seconds": chunk_timings,
            # Timing
            "total_elapsed_seconds": total_elapsed,
            "estimated_range": time_estimate["estimated_range"],
            "text_length_chars": len(text),
        }

        logger.info(
            f"[{mode}] Done — {len(valid_mcqs)} valid MCQs from {total_chunks} chunk(s) "
            f"in {total_elapsed}s "
            f"(generated={len(raw_mcqs)}, rejected={len(rejected)})"
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