import json
import random
import re
import logging
import httpx
from typing import Dict, Any
from app.core.config import settings

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are a professor-level medical exam writer for postgraduate and clinical board examinations. "
    "Your job is to generate DIFFICULT, high-yield MCQs strictly based on the provided lecture text. "
    "Questions must demand deep understanding — not surface recall.\n\n"

    "DIFFICULTY STANDARDS — at least 60% of questions must be Type 2 or 3:\n"
    "  Type 1 (recall): 'What is the origin of X?' — use sparingly, max 40% of questions.\n"
    "  Type 2 (application): Patient has symptom Y — which pathway/structure is affected?\n"
    "  Type 3 (analysis): Two tracts are damaged — which combination of deficits results?\n\n"

    "OPTION RULES:\n"
    "- 'All of the above' / 'None of the above' are ALLOWED only when ALL listed options are genuinely "
    "  correct (or incorrect) and the question explicitly tests comprehensive knowledge. "
    "  Use sparingly — no more than 3 questions out of 30.\n"
    "- Each standard option must be a SINGLE specific answer.\n"
    "- All 4 options must belong to the SAME category (all structures, all mechanisms, all symptoms, etc.).\n"
    "- Distractors must be the most commonly confused alternatives — not obviously wrong.\n\n"

    "QUESTION CRAFT:\n"
    "- Use clinical vignettes, double-negatives, exception questions ('all EXCEPT'), "
    "  and mechanism-based questions to increase difficulty.\n"
    "- Distractors should exploit predictable misconceptions (e.g., ipsi vs. contra, "
    "  facilitory vs. inhibitory, similar-named structures).\n"
    "- Every fact must come from the lecture — do not invent content.\n"
    "- The 'explanation' field must be a real sentence you write — never output the format description literally.\n\n"

    "OUTPUT: Return ONLY valid JSON. No markdown, no extra text.\n"
)

USER_PROMPT_TEMPLATE = """Read the lecture text carefully and generate EXACTLY 30 difficult, high-yield MCQs based ONLY on its content.

DIFFICULTY MIX — strictly enforce:
- 8 recall (Type 1): direct fact — "What is X?" or "Which structure does Y?"
- 14 application (Type 2): clinical vignette — "A 35-year-old woman presents with fatigue and pallor. Labs show microcytic anemia. Which finding best confirms the diagnosis?"
- 8 analysis (Type 3): reasoning — "All of the following are causes of X EXCEPT...", mechanism comparison, or "A patient has both X and Y — which combination of findings is expected?"

ANTI-REPETITION RULES (critical):
- Do NOT ask the same concept for different demographics (children / adults / adolescents / pregnant women). Ask it ONCE for the most relevant group.
- Do NOT ask the same fact twice with slightly different wording.
- Each of the 30 questions must test a DISTINCT piece of knowledge.
- Count your questions before submitting — output EXACTLY 30, no more.

OPTION RULES:
- Each option must be a single specific answer; all 4 from the same category.
- "All of the above" allowed max 2 times — only when every other option is genuinely correct.
- "None of the above" allowed max 1 time — only when no other option is correct.
- NEVER use "Both A and B" or "Neither A nor B" — these are confusing and banned.
- Distractors must be the top-2 most commonly confused alternatives, not obviously wrong choices.

COVERAGE:
- Spread evenly across all major topics in the lecture.
- No more than 5 questions on any single topic.

FORMAT per MCQ:
- topic: the lecture section this belongs to
- question: full question stem (vignette for Type 2/3)
- options: ["A. text", "B. text", "C. text", "D. text"]
- answer: the correct letter ("A" / "B" / "C" / "D")
- explanation: Start with the correct letter, then write 1-2 real sentences explaining WHY it is correct and WHY the most tempting wrong answer is wrong. Example: "C — Iron absorption occurs in the duodenum and proximal jejunum because this region expresses the DMT-1 transporter. B (small intestine) is too vague and incorrect; absorption does not occur uniformly throughout the small intestine."

Also generate:
- summary: 3-5 sentences summarizing the lecture's key points
- key_concepts: 8-12 short high-yield phrases from the lecture

Distribute correct answers (A/B/C/D) evenly across all 30 questions.

Return ONLY this JSON:
{{"summary":"string","key_concepts":["string"],"mcqs":[{{"topic":"string","question":"string","options":["A. text","B. text","C. text","D. text"],"answer":"A","explanation":"A — real explanation here"}}]}}

Lecture text:
{text}"""


async def generate_study_content(text: str) -> Dict[str, Any]:
    truncated_text = text[:7000] if len(text) > 7000 else text

    if not settings.AI_API_KEY:
        logger.warning("AI_API_KEY is not set — returning mock data")
        return _get_mock_response()

    try:
        return await _call_groq_api(truncated_text)
    except httpx.HTTPStatusError as e:
        logger.error(f"Groq API error {e.response.status_code}: {e.response.text}")
        raise RuntimeError(f"Groq API error {e.response.status_code}: {e.response.text}")
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI JSON: {e}")
        raise RuntimeError(f"AI returned invalid JSON: {e}")
    except Exception as e:
        logger.error(f"AI error: {e}")
        raise RuntimeError(str(e))


async def _call_groq_api(text: str) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {settings.AI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.AI_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT_TEMPLATE.format(text=text)},
        ],
        "temperature": 0.2,
        "presence_penalty": 0.2,
        "frequency_penalty": 0.2,
        "max_tokens": 6000,
        "response_format": {"type": "json_object"},  # forces valid JSON from Groq
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(GROQ_API_URL, headers=headers, json=payload)
        resp.raise_for_status()

    raw = resp.json()["choices"][0]["message"]["content"]
    logger.info(f"Groq response preview: {raw[:300]}")

    # Strip markdown fences as fallback
    cleaned = re.sub(r"```(?:json)?", "", raw).strip().rstrip("```").strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Last resort: find the outermost { } block
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise ValueError("No JSON object found in AI response")
        data = json.loads(match.group())

    def _norm(s: str) -> str:
        """Normalize text for dedup — strips option prefix (A./B./C./D.), punctuation, then sorts words."""
        s = s.lower()
        s = re.sub(r"^[a-d]\.\s*", "", s)   # strip leading "A. " / "B. " etc.
        s = re.sub(r"[^a-z0-9 ]", "", s)    # strip remaining punctuation
        return " ".join(sorted(s.split()))   # sort so reordered lists match

    # 1. Drop MCQs where any two options are identical after normalization
    # 2. Drop duplicate questions
    seen_questions: set[str] = set()
    unique_mcqs = []
    for mcq in data.get("mcqs", []):
        q_key = _norm(mcq["question"])

        # Check for duplicate options within this question
        option_keys = [_norm(opt) for opt in mcq.get("options", [])]
        if len(option_keys) != len(set(option_keys)):
            logger.warning(f"Dropped MCQ with duplicate options: {mcq['question'][:60]}")
            continue

        if q_key not in seen_questions:
            seen_questions.add(q_key)
            unique_mcqs.append(mcq)

    # Shuffle options so correct answer is distributed evenly across A/B/C/D
    for mcq in unique_mcqs:
        old_answer = mcq["answer"]
        correct_text = next(
            (opt for opt in mcq["options"] if opt.startswith(old_answer + ".")),
            None,
        )
        if correct_text is None:
            continue
        # Strip letter prefixes, shuffle, re-label A/B/C/D
        texts = [re.sub(r"^[A-D]\.\s*", "", opt) for opt in mcq["options"]]
        random.shuffle(texts)
        mcq["options"] = [f"{chr(65+i)}. {t}" for i, t in enumerate(texts)]
        # Find where the correct answer landed and update answer + explanation letter
        correct_bare = re.sub(r"^[A-D]\.\s*", "", correct_text)
        for i, t in enumerate(texts):
            if t == correct_bare:
                new_answer = chr(65 + i)
                mcq["answer"] = new_answer
                # Fix the leading letter in the explanation (e.g. "A — reason" → "C — reason")
                if "explanation" in mcq and isinstance(mcq["explanation"], str):
                    mcq["explanation"] = re.sub(
                        r"^[A-D](?=\s*[—\-–])", new_answer, mcq["explanation"]
                    )
                break

    data["mcqs"] = unique_mcqs
    logger.info(f"MCQs after dedup: {len(data['mcqs'])}")
    return data


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
      "explanation": "A — reason"
            }
        ],
    }