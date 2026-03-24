import re
import random
import logging

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────
# VALIDATION PATTERNS
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

_TRIVIAL_QUESTION_PATTERNS = re.compile(
    r"(first\s+observed|first\s+described|first\s+reported|who\s+first|"
    r"also\s+known\s+as|common\s+name\s+for|what\s+is\s+.*\s+called|"
    r"named\s+after|derives?\s+its\s+name|what\s+does\s+.{0,30}\s+mean|"
    r"meaning\s+of\s+the\s+(name|word|term)|"
    r"in\s+what\s+year|which\s+year\s+was|when\s+was\s+.*\s+first)",
    re.IGNORECASE,
)


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
            return True, "IDA bone marrow answered 'decreased erythropoiesis' — correct = absent iron stores"

    if _ACD_QUESTION_PATTERN.search(question):
        if _ACD_BAD_ANSWER.search(check_text):
            return True, "ACD question states normal/elevated serum iron — correct = LOW iron + HIGH ferritin"

    return False, ""


def _is_trivial_question(mcq: dict, mode: str = "highyield") -> bool:
    """Returns True for historical trivia, pure naming, or bullet-point conversions.
    Only applied in highyield and exam modes — revision allows basic recall."""
    if mode == "revision":
        return False
    return bool(_TRIVIAL_QUESTION_PATTERNS.search(mcq.get("question", "")))


def _fix_option_prefixes(mcq: dict) -> dict:
    """Ensure all options have A./B./C./D. prefixes.
    Critical for revision mode where chunks may return raw option text."""
    fixed = []
    for i, opt in enumerate(mcq.get("options", [])):
        prefix = chr(ord("A") + i) + ". "
        cleaned = re.sub(r"^[a-dA-D]\.\s*", "", opt).strip()
        fixed.append(prefix + cleaned)
    mcq["options"] = fixed
    return mcq


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
    """Three-layer deduplication:
    1. Demographic-stripped stem hash (catches age/sex variants)
    2. Identical option-set hash (catches reworded duplicates)
    3. Topic+answer key (catches same-concept questions with different stems)
    """
    seen_stems: set[str] = set()
    seen_option_sets: set[frozenset] = set()
    seen_topic_answer: set[str] = set()
    unique = []

    for mcq in mcqs:
        stem_key = _norm_stem(mcq.get("question", ""))
        option_key = _norm_options(mcq)
        topic_answer_key = (
            f"{mcq.get('topic', '').lower().strip()}::{mcq.get('answer', '').upper()}"
        )

        if stem_key in seen_stems:
            logger.warning(f"Duplicate stem removed: {mcq.get('question', '')[:70]}")
            continue
        if option_key in seen_option_sets and len(option_key) == 4:
            logger.warning(f"Duplicate option-set removed: {mcq.get('question', '')[:70]}")
            continue
        if topic_answer_key in seen_topic_answer and topic_answer_key != "::":
            logger.warning(f"Same topic+answer removed: {mcq.get('question', '')[:70]}")
            continue

        seen_stems.add(stem_key)
        seen_option_sets.add(option_key)
        seen_topic_answer.add(topic_answer_key)
        unique.append(mcq)

    return unique


def _shuffle_options(mcq: dict) -> dict:
    """Randomly shuffle answer options and update the answer letter and explanation prefix."""
    options = mcq.get("options", [])
    answer_letter = mcq.get("answer", "").upper()
    if len(options) != 4 or answer_letter not in {"A", "B", "C", "D"}:
        return mcq

    correct_idx = ord(answer_letter) - ord("A")
    correct_text = re.sub(r"^[A-D]\.\s*", "", options[correct_idx]).strip()

    shuffled = options[:]
    random.shuffle(shuffled)

    new_correct_idx = next(
        i for i, opt in enumerate(shuffled)
        if re.sub(r"^[A-D]\.\s*", "", opt).strip() == correct_text
    )
    new_letter = chr(ord("A") + new_correct_idx)

    # Re-apply A./B./C./D. prefixes to match new positions
    shuffled = [chr(ord("A") + i) + ". " + re.sub(r"^[A-D]\.\s*", "", opt).strip()
                for i, opt in enumerate(shuffled)]

    mcq["options"] = shuffled
    mcq["answer"] = new_letter

    # Update explanation prefix if it starts with the old answer letter
    explanation = mcq.get("explanation", "")
    if explanation.upper().startswith(answer_letter + " "):
        mcq["explanation"] = new_letter + explanation[1:]

    return mcq


def _validate_and_filter_mcqs(mcqs: list, mode: str = "highyield") -> tuple[list, list]:
    valid = []
    rejected = []
    exam_catchall_count = 0

    for mcq in mcqs:
        mcq = _fix_option_prefixes(mcq)
        reasons = []

        if _has_forbidden_option(mcq, mode):
            reasons.append("forbidden option phrase (catch-all or semantic 'Both X and Y')")
        if _has_duplicate_options(mcq):
            reasons.append("duplicate options within question")
        if not _answer_matches_options(mcq):
            reasons.append(f"answer letter '{mcq.get('answer')}' out of range or invalid")

        factual_error, factual_reason = _has_known_factual_error(mcq)
        if factual_error:
            reasons.append(f"factual error: {factual_reason}")

        if _is_trivial_question(mcq, mode):
            reasons.append("trivial question — historical trivia, naming, or bullet-point conversion")

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
                f"Rejected [{mode}]: {mcq.get('question', '')[:60]} | {', '.join(reasons)}"
            )
        else:
            valid.append(_shuffle_options(mcq))

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
