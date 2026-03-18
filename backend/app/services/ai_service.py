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
    "You are a professor-level medical exam writer. Every question must have ONE unambiguous correct answer "
    "verifiable in standard textbooks (Guyton, Snell, Ganong).\n\n"

    "ABSOLUTE RULES (violations = failed question):\n"
    "1. NEVER use: 'All of the above', 'None of the above', 'Both A and B', 'Neither A nor B'.\n"
    "   These options destroy discrimination power and are banned completely.\n"
    "2. Each option must be a SINGLE specific answer — not a combination.\n"
    "3. All 4 options must belong to the SAME category (all nuclei, all neurotransmitters, etc.).\n"
    "4. ONE question = ONE concept. Never combine origin + function in one question.\n"
    "5. No repeating the same concept in different wording.\n\n"

    "FACTUAL ANCHORS (use these exact answers — do not deviate):\n"
    "- Rubrospinal tract: originates from RED NUCLEUS, crosses at level of RED NUCLEUS in midbrain.\n"
    "- Lateral tectospinal: originates from SUPERIOR COLLICULUS → visuospinal reflexes.\n"
    "- Ventral tectospinal: originates from INFERIOR COLLICULUS → audiospinal reflexes.\n"
    "- Lateral reticulospinal (medullary): INHIBITORY to stretch reflex.\n"
    "- Ventral reticulospinal (pontine): FACILITATORY to stretch reflex.\n"
    "- Vestibulospinal: controls POSTURE and MUSCLE TONE (NOT skilled voluntary movement).\n"
    "- Inferior olive: sends fibers to CEREBELLUM.\n"
    "- Putamen circuit: controls FAMILIAR AUTOMATIC MOVEMENTS (motor programs).\n"
    "- Caudate circuit: controls PLANNING/ORGANIZING complex goal-directed movements.\n"
    "- Putamen damage: MOTOR APRAXIA (loss of familiar automatic movement).\n"
    "- Caudate damage: INABILITY TO PLAN/ORGANIZE movements to achieve a complex goal.\n"
    "- Chorea: rapid, irregular, dance-like involuntary movements.\n"
    "- Hemiballismus: violent, flinging movements of proximal limbs (one side).\n"
    "- BG lesion symptoms: CONTRALATERAL side.\n"
    "- Involuntary movements: DISAPPEAR with sleep, INCREASE with nervous excitement.\n"
    "- Cerebellum triad: ASTHENIA (weakness) + ATONIA (reduced tone) + ATAXIA (incoordination).\n\n"

    "OUTPUT: Return ONLY valid JSON. No markdown, no extra text.\n"
)
USER_PROMPT_TEMPLATE = """Generate EXACTLY 30 high-yield MCQs from the lecture below.

BANNED OPTIONS (instant fail if used):
"All of the above" | "None of the above" | "Both A and B" | "Neither A nor B" | any combination option.
Every option must be a SINGLE specific answer.

OPTION UNIQUENESS (critical):
- The 4 options within a single question must be MEANINGFULLY DIFFERENT.
- Do NOT reorder the same items to create a fake distractor (e.g. "A,B,C" vs "C,B,A" — these are the same).
- Do NOT use near-synonyms as separate options (e.g. "Decrease" and "Disappear" for the same concept).
- Each option must be clearly distinguishable from the others.

SYLLABUS — follow this exact order, one question per slot:

🔷 Tracts & Functions (8 questions)
1.  Origin of rubrospinal tract → correct answer: Red nucleus
2.  Level at which rubrospinal tract crosses → correct answer: Level of the red nucleus (midbrain)
3.  Origin of lateral tectospinal tract → correct answer: Superior colliculus
4.  Function of lateral tectospinal tract → correct answer: Visuospinal reflexes
5.  Origin of ventral tectospinal tract → correct answer: Inferior colliculus
6.  Lateral reticulospinal tract effect on stretch reflex → correct answer: Inhibitory
7.  Ventral reticulospinal tract effect on stretch reflex → correct answer: Facilitatory
8.  Main function of vestibulospinal tract → correct answer: Posture and muscle tone (NOT skilled voluntary movement — that is cerebellar/corticospinal)

🔷 Basal Ganglia (7 questions)
9.  Structures forming the basal ganglia → correct answer: Caudate + putamen + globus pallidus
10. Specific function of the putamen circuit → correct answer: Storage/execution of familiar automatic motor programs
11. Specific function of the caudate circuit → correct answer: Planning and organizing movements to achieve a complex goal
12. Result of putamen circuit damage → correct answer: Motor apraxia
13. Result of caudate circuit damage → correct answer: Inability to organize/plan complex goal-directed movements
14. Anatomical location of basal ganglia → correct answer: Cerebral hemispheres lateral to thalamus
15. Output targets of basal ganglia → correct answer: Cerebral cortex, thalamus, and brainstem

🔷 Neurotransmitters (5 questions)
16. Main excitatory NT in basal ganglia → correct answer: Glutamate
17. Main inhibitory NT in basal ganglia → correct answer: GABA
18. Role of dopamine in basal ganglia → correct answer: Modulates motor control (inhibits indirect pathway, facilitates direct)
19. Role of acetylcholine in basal ganglia → correct answer: Excitatory modulator (balances dopamine)
20. Effect of disrupted excitatory/inhibitory balance → correct answer: Involuntary movements

🔷 Lesions & Involuntary Movements (5 questions)
21. Characteristic involuntary movement of basal ganglia lesion → correct answer: Chorea/athetosis/hemiballismus
22. Precise description of chorea → correct answer: Rapid, irregular, dance-like movements (NOT tremor, NOT slow)
23. Precise description of hemiballismus → correct answer: Violent flinging movements of proximal limbs on one side
24. Side of body affected by unilateral basal ganglia lesion → correct answer: Contralateral side
25. Behavior of involuntary movements during sleep → correct answer: Disappear with sleep, increase with nervous excitement

🔷 Cerebellum (5 questions)
26. Three functional divisions of the cerebellum → correct answer: Vestibulocerebellum, spinocerebellum, cerebrocerebellum
27. Function of vestibulocerebellum → correct answer: Maintenance of equilibrium and balance
28. Function of spinocerebellum → correct answer: Control of muscle tone and gross movement
29. Function of cerebrocerebellum → correct answer: Coordination of skilled voluntary movements
30. Classic triad of cerebellar lesion → correct answer: Asthenia + Atonia + Ataxia

DISTRACTOR RULES:
- All options must be from the SAME category (all nuclei OR all NTs OR all tracts — never mixed)
- Include the most commonly confused alternatives as distractors
- Every distractor must be plausible enough to fool a student who half-knows the topic

FORMAT:
- topic: section name (Tracts & Functions / Basal Ganglia / Neurotransmitters / Lesions & Involuntary Movements / Cerebellum)
- explanation: "X — one precise sentence why correct, optionally why main distractor is wrong"
- Distribute A/B/C/D answers roughly evenly across all 30 questions
- Also generate: summary (3-5 sentences) and key_concepts (8-12 short phrases)

Return ONLY this JSON:
{{"summary":"string","key_concepts":["string"],"mcqs":[{{"topic":"string","question":"string","options":["A. text","B. text","C. text","D. text"],"answer":"A","explanation":"A — reason"}}]}}

Lecture text:
{text}"""


async def generate_study_content(text: str) -> Dict[str, Any]:
    truncated_text = text[:10000] if len(text) > 10000 else text

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
        correct_text = next(
            (opt for opt in mcq["options"] if opt.startswith(mcq["answer"] + ".")),
            None,
        )
        if correct_text is None:
            continue
        # Strip letter prefixes, shuffle, re-label A/B/C/D
        texts = [re.sub(r"^[A-D]\.\s*", "", opt) for opt in mcq["options"]]
        random.shuffle(texts)
        mcq["options"] = [f"{chr(65+i)}. {t}" for i, t in enumerate(texts)]
        # Find where the correct answer landed
        correct_bare = re.sub(r"^[A-D]\.\s*", "", correct_text)
        for i, t in enumerate(texts):
            if t == correct_bare:
                mcq["answer"] = chr(65 + i)
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
