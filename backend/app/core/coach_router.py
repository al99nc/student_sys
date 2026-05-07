"""
Keyword-based intent classifier for themcq Coach.

Classifies incoming messages into intents before hitting the LLM so we can:
  - Return canned responses for off_topic  (no LLM cost / latency)
  - Use a focused prompt for profile_query
  - Use a concept-explanation prompt for concept_question
  - Use the full priority prompt for study_advice
"""

import re

# ── Intent keyword patterns ───────────────────────────────────────────────────

_PROFILE_PATTERNS = re.compile(
    r"\b("
    r"my (profile|stats|scores?|accuracy|performance|progress|data|information|topics?|questions?|overconfidence|weak)"
    r"|what (do you know|have you|data).{0,20}\bme\b"
    r"|show me my"
    r"|how (am i|many questions)"
    r"|summarize my"
    r")\b",
    re.IGNORECASE,
)

_STUDY_PATTERNS = re.compile(
    r"\b("
    r"what should i (study|practice|do|tackle|start|focus)"
    r"|where should i (focus|start|study|concentrate)"
    r"|study plan"
    r"|help me (prioritize|improve)"
    r"|most important topic"
    r"|what (do i|topics?) (need to work on|should i work on)"
    r"|where (am i losing|should i)"
    r"|most urgent"
    r"|biggest weakness"
    r"|what('s| is) (my biggest|the most)"
    r"|what topic"
    r")\b",
    re.IGNORECASE,
)

_CONCEPT_PATTERNS = re.compile(
    r"\b("
    r"explain (to me|how|what|why|this|the)"
    r"|what is (the mechanism|pharmacokinetics|a |an )"
    r"|mechanism of action"
    r"|teach me"
    r"|i don'?t understand"
    r"|can you explain"
    r"|what'?s the difference between"
    r"|how do i remember"
    r"|why does this"
    r"|pathophysiology"
    r"|define (this|the)"
    r"|how does the"
    r")\b",
    re.IGNORECASE,
)

_OFF_TOPIC_PATTERNS = re.compile(
    r"\b("
    r"i love you"
    r"|weather"
    r"|tell me a joke"
    r"|are you (a real|conscious)"
    r"|who created you"
    r"|i'?m (so bored|really hungry|hungry)"
    r"|what is your name"
    r"|do you have feelings"
    r"|i hate studying"
    r"|i give up"
    r"|can we just talk"
    r"|how are you (doing|today)"
    r"|what do you think about life"
    r")\b",
    re.IGNORECASE,
)

# ── Classifier ────────────────────────────────────────────────────────────────

def classify(message: str) -> str:
    """
    Returns one of: 'profile_query', 'study_advice', 'concept_question', 'off_topic', 'unknown'
    Falls back to 'unknown' so the full LLM prompt still runs.
    """
    if _OFF_TOPIC_PATTERNS.search(message):
        return "off_topic"
    if _PROFILE_PATTERNS.search(message):
        return "profile_query"
    if _STUDY_PATTERNS.search(message):
        return "study_advice"
    if _CONCEPT_PATTERNS.search(message):
        return "concept_question"
    return "unknown"
