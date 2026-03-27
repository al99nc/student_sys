from app.services.prompts import (
    HIGHYIELD_SYSTEM_PROMPT, HIGHYIELD_USER_PROMPT,
    EXAM_SYSTEM_PROMPT, EXAM_USER_PROMPT,
    HARDER_SYSTEM_PROMPT, HARDER_USER_PROMPT,
    REVISION_SYSTEM_PROMPT, REVISION_USER_PROMPT,
    _get_prompts,
)
from app.services.validators import (
    FORBIDDEN_OPTION_PATTERNS, SEMANTIC_COMBINED_PATTERNS, EXAM_CATCHALL_PATTERNS,
    _has_forbidden_option, _has_duplicate_options, _answer_matches_options,
    _has_known_factual_error, _is_trivial_question, _fix_option_prefixes,
    _norm_stem, _norm_options, _deduplicate_by_question,
    _validate_and_filter_mcqs, _warn_answer_distribution,
    _warn_exam_format_distribution, _fix_explanation_prefix,
)
from app.services.generator import (
    OPENROUTER_URL, CHUNK_SIZE, CHUNK_OVERLAP, MAX_CHUNKS, SPEED_CONFIG, ESTIMATED_TPS,
    _chunk_text, _estimate_processing_time, _call_single_chunk,
    _salvage_partial_json, _merge_chunk_results,
    generate_study_content, _get_mock_response,
)

__all__ = ["generate_study_content"]
