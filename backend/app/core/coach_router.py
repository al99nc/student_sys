"""
Semantic router for CortexQ Coach.

Classifies incoming messages into intents before hitting the LLM so we can:
  - Return canned responses for off_topic  (no LLM cost / latency)
  - Use a focused prompt for profile_query
  - Use a concept-explanation prompt for concept_question
  - Use the full priority prompt for study_advice
"""

from semantic_router import Route
from semantic_router.routers import SemanticRouter
from semantic_router.encoders import FastEmbedEncoder

# ── Route definitions ─────────────────────────────────────────────────────────

_profile_route = Route(
    name="profile_query",
    utterances=[
        "what data do you have on me",
        "what do you know about me",
        "show me my profile",
        "what are my stats",
        "what are my scores",
        "tell me about my performance",
        "what topics have I done",
        "how many questions have I answered",
        "what's my overconfidence rate",
        "what are my weak topics",
        "what does my profile look like",
        "what information do you have about me",
        "what's my accuracy",
        "how am I doing overall",
        "summarize my progress",
    ],
)

_study_route = Route(
    name="study_advice",
    utterances=[
        "what should I study",
        "where should I focus",
        "what topic should I do next",
        "give me a study plan",
        "help me prioritize",
        "what's the most important topic",
        "what do I need to work on",
        "what should I practice",
        "where am I losing marks",
        "what should I tackle first",
        "what's my biggest weakness",
        "help me improve",
        "where should I start today",
        "what topic is most urgent",
    ],
)

_concept_route = Route(
    name="concept_question",
    utterances=[
        "explain to me how this works",
        "what is the mechanism of action",
        "teach me about this topic",
        "I don't understand this concept",
        "can you explain beta blockers",
        "what's the difference between",
        "how do I remember this",
        "why does this happen in the body",
        "describe the pathophysiology",
        "define this medical term",
        "how does the heart work",
        "what is pharmacokinetics",
    ],
)

_off_topic_route = Route(
    name="off_topic",
    utterances=[
        "I love you",
        "what's the weather like today",
        "tell me a joke",
        "are you a real person",
        "who created you",
        "I'm so bored right now",
        "I'm really hungry",
        "what is your name",
        "do you have feelings",
        "are you conscious",
        "I hate studying so much",
        "this is impossible I give up",
        "can we just talk",
        "how are you doing today",
        "what do you think about life",
    ],
)

# ── Router (lazy-loaded on first call) ────────────────────────────────────────

_router: SemanticRouter | None = None


def _get_router() -> SemanticRouter:
    global _router
    if _router is None:
        encoder = FastEmbedEncoder()
        _router = SemanticRouter(
            encoder=encoder,
            routes=[_profile_route, _study_route, _concept_route, _off_topic_route],
            auto_sync="local",
        )
    return _router


def classify(message: str) -> str:
    """
    Returns one of: 'profile_query', 'study_advice', 'concept_question', 'off_topic', 'unknown'
    Falls back to 'unknown' on any error so the full LLM prompt still runs.
    """
    try:
        result = _get_router()(message)
        return result.name if result.name else "unknown"
    except Exception:
        return "unknown"
