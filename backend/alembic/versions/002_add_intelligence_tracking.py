"""Add intelligence tracking columns and new tables

Revision ID: 002
Revises: 001
Create Date: 2026-04-01

Adds:
- New columns to question_attempts, weak_points, performance_sessions, mcq_questions
- New column (days_since_last_review) + unique index to topic_snapshots
- New tables: answer_timelines, learning_patterns, student_ai_insights

All new columns on existing tables are nullable so existing data is never broken.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_column_safe(table: str, column: sa.Column) -> None:
    """Add a column, silently skip if it already exists (idempotent)."""
    try:
        op.add_column(table, column)
    except Exception:
        pass


def upgrade() -> None:
    # ── question_attempts: time intelligence + confidence columns ─────────────
    _add_column_safe("question_attempts", sa.Column("time_of_day", sa.Integer(), nullable=True))
    _add_column_safe("question_attempts", sa.Column("day_of_week", sa.Integer(), nullable=True))
    _add_column_safe("question_attempts", sa.Column("answer_changed", sa.Boolean(), nullable=True))
    _add_column_safe("question_attempts", sa.Column("original_answer", sa.String(1), nullable=True))
    _add_column_safe("question_attempts", sa.Column("time_to_first_change", sa.Integer(), nullable=True))
    _add_column_safe("question_attempts", sa.Column("pre_answer_confidence", sa.Integer(), nullable=True))
    _add_column_safe("question_attempts", sa.Column("time_to_confidence", sa.Integer(), nullable=True))
    _add_column_safe("question_attempts", sa.Column("calibration_gap", sa.Integer(), nullable=True))

    # ── weak_points: decay + misconception columns ────────────────────────────
    _add_column_safe("weak_points", sa.Column("first_mastered_at", sa.DateTime(), nullable=True))
    _add_column_safe("weak_points", sa.Column("times_mastered", sa.Integer(), nullable=True))
    _add_column_safe("weak_points", sa.Column("times_relapsed", sa.Integer(), nullable=True))
    _add_column_safe("weak_points", sa.Column("decay_rate", sa.Float(), nullable=True))
    _add_column_safe("weak_points", sa.Column("dangerous_misconception", sa.Boolean(), nullable=True))

    # ── performance_sessions: context + metadata columns ──────────────────────
    _add_column_safe("performance_sessions", sa.Column("started_from", sa.String(50), nullable=True))
    _add_column_safe("performance_sessions", sa.Column("device_type", sa.String(20), nullable=True))
    _add_column_safe("performance_sessions", sa.Column("interruptions", sa.Integer(), nullable=True))
    _add_column_safe("performance_sessions", sa.Column("longest_pause_seconds", sa.Integer(), nullable=True))
    _add_column_safe("performance_sessions", sa.Column("questions_skipped", sa.Integer(), nullable=True))
    _add_column_safe("performance_sessions", sa.Column("exam_date", sa.DateTime(), nullable=True))

    # ── mcq_questions: global stats columns ──────────────────────────────────
    _add_column_safe("mcq_questions", sa.Column("global_accuracy_rate", sa.Float(), nullable=True))
    _add_column_safe("mcq_questions", sa.Column("global_avg_time", sa.Float(), nullable=True))
    _add_column_safe("mcq_questions", sa.Column("discrimination_index", sa.Float(), nullable=True))

    # ── topic_snapshots: new column + replace composite index with unique ──────
    _add_column_safe("topic_snapshots", sa.Column("days_since_last_review", sa.Integer(), nullable=True))

    # Drop old non-unique composite index and replace with unique index
    try:
        op.drop_index("ix_snapshot_student_topic_date", table_name="topic_snapshots")
    except Exception:
        pass  # index may not exist (fresh DB setup after model change)

    try:
        op.create_index(
            "uq_topic_snapshot_student_topic_date",
            "topic_snapshots",
            ["student_id", "topic", "snapshot_date"],
            unique=True,
        )
    except Exception:
        pass  # index already exists

    try:
        op.create_index("ix_topic_snapshots_student_id", "topic_snapshots", ["student_id"])
    except Exception:
        pass  # index already exists

    # ── answer_timelines: new table ───────────────────────────────────────────
    op.create_table(
        "answer_timelines",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("attempt_id", sa.String(36), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("time_on_option_a", sa.Float(), nullable=True),
        sa.Column("time_on_option_b", sa.Float(), nullable=True),
        sa.Column("time_on_option_c", sa.Float(), nullable=True),
        sa.Column("time_on_option_d", sa.Float(), nullable=True),
        sa.Column("second_choice", sa.String(1), nullable=True),
        sa.Column("re_read_question", sa.Boolean(), nullable=True),
        sa.Column("re_read_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["attempt_id"], ["question_attempts.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_answer_timelines_student_id", "answer_timelines", ["student_id"])
    op.create_index("ix_answer_timelines_attempt_id", "answer_timelines", ["attempt_id"])

    # ── learning_patterns: new table (one row per student) ────────────────────
    op.create_table(
        "learning_patterns",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.Column("avg_sessions_per_week", sa.Float(), nullable=True),
        sa.Column("preferred_session_length_minutes", sa.Float(), nullable=True),
        sa.Column("preferred_time_of_day", sa.Integer(), nullable=True),
        sa.Column("consistency_score", sa.Float(), nullable=True),
        sa.Column("best_question_type", sa.String(20), nullable=True),
        sa.Column("worst_question_type", sa.String(20), nullable=True),
        sa.Column("overconfidence_rate", sa.Float(), nullable=True),
        sa.Column("underconfidence_rate", sa.Float(), nullable=True),
        sa.Column("answer_change_accuracy", sa.Float(), nullable=True),
        sa.Column("avg_decay_days", sa.Float(), nullable=True),
        sa.Column("fastest_forgetting_topic", sa.String(255), nullable=True),
        sa.Column("most_stable_topic", sa.String(255), nullable=True),
        sa.Column("mobile_accuracy", sa.Float(), nullable=True),
        sa.Column("desktop_accuracy", sa.Float(), nullable=True),
        sa.Column("morning_accuracy", sa.Float(), nullable=True),
        sa.Column("afternoon_accuracy", sa.Float(), nullable=True),
        sa.Column("evening_accuracy", sa.Float(), nullable=True),
        sa.Column("projected_readiness_7d", sa.Float(), nullable=True),
        sa.Column("projected_readiness_14d", sa.Float(), nullable=True),
        sa.Column("projected_readiness_30d", sa.Float(), nullable=True),
        sa.Column("behavioral_flags", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("student_id", name="uq_learning_patterns_student_id"),
    )
    op.create_index("ix_learning_patterns_student_id", "learning_patterns", ["student_id"])

    # ── student_ai_insights: new table ───────────────────────────────────────
    op.create_table(
        "student_ai_insights",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("insight_json", sa.JSON(), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("trigger", sa.String(50), nullable=False),
        sa.Column("questions_answered_at_generation", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_student_ai_insights_student_id", "student_ai_insights", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_student_ai_insights_student_id", table_name="student_ai_insights")
    op.drop_table("student_ai_insights")

    op.drop_index("ix_learning_patterns_student_id", table_name="learning_patterns")
    op.drop_table("learning_patterns")

    op.drop_index("ix_answer_timelines_attempt_id", table_name="answer_timelines")
    op.drop_index("ix_answer_timelines_student_id", table_name="answer_timelines")
    op.drop_table("answer_timelines")

    # Restore old topic_snapshots index (best-effort)
    try:
        op.drop_index("ix_topic_snapshots_student_id", table_name="topic_snapshots")
    except Exception:
        pass
    try:
        op.drop_index("uq_topic_snapshot_student_topic_date", table_name="topic_snapshots")
    except Exception:
        pass
    try:
        op.create_index(
            "ix_snapshot_student_topic_date",
            "topic_snapshots",
            ["student_id", "topic", "snapshot_date"],
        )
    except Exception:
        pass

    # NOTE: SQLite does not support DROP COLUMN in older versions.
    # New columns on existing tables are left in place on downgrade.
    # To fully revert, recreate those tables from scratch via a separate migration.
