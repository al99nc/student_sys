# Run from project root: python tests/mcq_quality_rater.py

import os
import sys
import asyncio
import json
import argparse
import httpx
from pathlib import Path

# Add backend to sys.path to allow imports from app
sys.path.append(os.path.abspath("backend"))

try:
    from app.core.config import settings
    from app.services.generator import generate_study_content
    from app.services.pdf_service import extract_text_from_pdf
except ImportError:
    print("ERROR: Could not import backend modules. Make sure you are running from the project root.")
    sys.exit(1)

# ─── CONFIG BLOCK (top of file, easy to edit) ───
TEST_PDF_PATH = "tests/sample.pdf"
MCQ_COUNT = 10
MODE = "exam"                # revision | exam | harder | custom
CUSTOM_INSTRUCTIONS = ""     # only if MODE = custom
RATER_MODEL = "google/gemini-2.5-flash-preview"
RUN_ALL_MODES = False        # if True, ignores MODE and runs all 4 modes back to back
# ─────────────────────────────────────────────────

def detect_language(text):
    # Simple check for Arabic characters
    if any("\u0600" <= char <= "\u06FF" for char in text):
        return "Arabic"
    return "English"

async def call_rater_ai(mcqs_text, mode, custom_instructions, language):
    api_key = settings.open_rout_PAID_API_KEY or settings.AI_API_KEY
    if not api_key:
        return "ERROR: No API key found in settings."

    prompt = f"""You are a strict MCQ quality evaluator for university-level exams.
Rate the following MCQs generated for mode: {mode}
Detected language: {language}

Mode expectations:
- revision: easy recall questions, straightforward, confidence building
- exam: medium difficulty, realistic exam questions, balanced coverage
- harder: genuinely challenging, requires deep understanding, tricky distractors
- custom: matches these instructions exactly — {custom_instructions}

MCQs:
{mcqs_text}

Rate EACH criterion 1-10 with a one sentence reason. Be harsh:

1. ACCURACY — correct answers are actually correct, no factual errors
2. DISTRACTOR QUALITY — wrong options are believable, not obviously wrong
3. CLARITY — questions are unambiguous and clearly worded
4. DIFFICULTY MATCH — difficulty matches the mode described above
5. DEPTH — tests real understanding, not surface reading
6. NO PATTERN ABUSE — varied correct answer positions, no "all of the above"
7. TOPIC COVERAGE — covers important concepts, not just minor details
8. LANGUAGE QUALITY — proper grammar and professional tone in whatever language used

Respond in this exact format, no extra text:
ACCURACY: X/10 | reason
DISTRACTOR_QUALITY: X/10 | reason
CLARITY: X/10 | reason
DIFFICULTY_MATCH: X/10 | reason
DEPTH: X/10 | reason
NO_PATTERN_ABUSE: X/10 | reason
TOPIC_COVERAGE: X/10 | reason
LANGUAGE_QUALITY: X/10 | reason
OVERALL: X/10
TOP_ISSUE: one sentence
VERDICT: PASS or NEEDS_WORK or FAIL"""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": RATER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
    }

    url = "https://openrouter.ai/api/v1/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        return f"ERROR: Rater AI call failed — {str(e)}"

def format_mcqs(mcqs):
    lines = []
    for i, q in enumerate(mcqs, 1):
        lines.append(f"Q{i}: {q['question']}")
        for opt in q['options']:
            lines.append(opt)
        lines.append(f"Correct Answer: {q['answer']}")
        lines.append("")
    return "\n".join(lines)

async def run_quality_test(mode, instructions, count, pdf_path):
    # 1. Load PDF
    if not os.path.exists(pdf_path):
        print(f"ERROR: No sample PDF found at {pdf_path} — add one and rerun")
        return None

    try:
        text = extract_text_from_pdf(pdf_path)
    except Exception as e:
        print(f"ERROR: Failed to read PDF — {str(e)}")
        return None

    # 2. Generate MCQs
    print(f"Generating {count} MCQs in {mode} mode...")
    
    custom_context = None
    focus_instruction = ""
    if mode == "custom":
        custom_context = {
            "field_of_study": "Medicine",
            "exam_type": "final",
            "time_to_exam": "1week",
            "prior_knowledge": "know_basics",
            "difficulty": "medium",
            "mcq_count": count,
            "weak_topics": instructions
        }
    else:
        focus_instruction = f"Generate exactly {count} high-quality MCQs."

    try:
        # Use premium=True to hit OpenRouter as requested
        result = await generate_study_content(
            text, 
            mode=mode, 
            is_premium=True, 
            custom_context=custom_context,
            focus_instruction=focus_instruction
        )
        mcqs = result.get("mcqs", [])
        if not mcqs:
            print("ERROR: MCQ generation failed — Returned empty list")
            return None
    except Exception as e:
        print(f"ERROR: MCQ generation failed — {str(e)}")
        return None

    # 3. Format MCQs
    mcqs_formatted = format_mcqs(mcqs)
    language = detect_language(text)

    # 4. Call Rater AI
    print(f"Rating {len(mcqs)} MCQs using {RATER_MODEL}...")
    rating_raw = await call_rater_ai(mcqs_formatted, mode, instructions, language)
    
    if rating_raw.startswith("ERROR"):
        print(rating_raw)
        return None

    # 5. Parse Response
    report_data = {}
    lines = rating_raw.strip().split("\n")
    for line in lines:
        if ":" in line:
            key, val = line.split(":", 1)
            report_data[key.strip()] = val.strip()

    # 6. Print Report
    print("\n════════════════════════════════════════")
    print(" CortexQ MCQ Quality Report")
    print(f" Mode: {mode} | Questions: {len(mcqs)} | Language: {language}")
    print("════════════════════════════════════════")
    
    criteria = [
        "ACCURACY", "DISTRACTOR_QUALITY", "CLARITY", "DIFFICULTY_MATCH", 
        "DEPTH", "NO_PATTERN_ABUSE", "TOPIC_COVERAGE", "LANGUAGE_QUALITY"
    ]
    
    for c in criteria:
        val = report_data.get(c, "N/A")
        label = c.replace("_", " ")
        print(f" {label:<18} {val}")

    print("────────────────────────────────────────")
    overall = report_data.get("OVERALL", "N/A")
    top_issue = report_data.get("TOP_ISSUE", "N/A")
    verdict_raw = report_data.get("VERDICT", "N/A")
    
    verdict = verdict_raw
    if "PASS" in verdict_raw.upper():
        verdict = "✅ PASS"
    elif "FAIL" in verdict_raw.upper():
        verdict = "❌ FAIL"
    elif "NEEDS_WORK" in verdict_raw.upper() or "WORK" in verdict_raw.upper():
        verdict = "⚠️ NEEDS WORK"

    print(f" OVERALL:   {overall}")
    print(f" TOP ISSUE: {top_issue}")
    print(f" VERDICT:   {verdict}")
    print("════════════════════════════════════════\n")

    if not report_data:
        print("Raw Rater Output (parsing failed):")
        print(rating_raw)
        print("════════════════════════════════════════\n")

    return {
        "mode": mode,
        "overall": overall,
        "verdict": verdict
    }

async def main():
    parser = argparse.ArgumentParser(description="CortexQ MCQ Quality Rater")
    parser.add_argument("--mode", type=str, choices=["revision", "exam", "harder", "custom"], default=MODE)
    parser.add_argument("--instructions", type=str, default=CUSTOM_INSTRUCTIONS)
    parser.add_argument("--count", type=int, default=MCQ_COUNT)
    parser.add_argument("--pdf", type=str, default=TEST_PDF_PATH)
    parser.add_argument("--all-modes", action="store_true", default=RUN_ALL_MODES)

    args = parser.parse_args()

    if args.all_modes:
        modes = ["revision", "exam", "harder", "custom"]
        results = []
        for m in modes:
            res = await run_quality_test(m, args.instructions, args.count, args.pdf)
            if res:
                results.append(res)
        
        if results:
            print("Comparison Table:")
            print(f"{'MODE':<12} | {'OVERALL':<8} | {'VERDICT'}")
            print("-" * 35)
            for r in results:
                print(f"{r['mode']:<12} | {r['overall']:<8} | {r['verdict']}")
    else:
        await run_quality_test(args.mode, args.instructions, args.count, args.pdf)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting...")
        sys.exit(0)
