"""Shared utility helpers used across multiple API modules."""
import logging
from typing import Any


def sanitize_nulls(obj: Any) -> Any:
    """
    Convert AI-generated sentinel strings for missing values into real JSON nulls.
    Handles nested dicts and lists recursively.

    The Groq models sometimes emit the string "null", "none", or "" instead of
    a real JSON null — this function normalises them so downstream code can do
    simple ``if value is None`` checks.
    """
    replaced = False

    def _sanitize(value: Any) -> Any:
        nonlocal replaced
        if isinstance(value, dict):
            return {key: _sanitize(val) for key, val in value.items()}
        if isinstance(value, list):
            return [_sanitize(item) for item in value]
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"null", "none", ""}:
                replaced = True
                return None
        return value

    cleaned = _sanitize(obj)
    if replaced:
        logging.getLogger(__name__).debug(
            "sanitize_nulls: replaced AI null-like strings with JSON null"
        )
    return cleaned
