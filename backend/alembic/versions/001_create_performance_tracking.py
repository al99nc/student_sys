"""Create performance tracking tables

Revision ID: 001
Revises:
Create Date: 2026-03-31

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # mcq_questions must exist before question_attempts (FK reference)
    op.create_table(
        "mcq_questions",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("topic", sa.String(255), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("option_a", sa.Text(), nullable=False),
        sa.Column("option_b", sa.Text(), nullable=False),
        sa.Column("option_c", sa.Text(), nullable=False),
        sa.Column("option_d", sa.Text(), nullable=False),
        sa.Column("correct_answer", sa.String(1), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("difficulty_type", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["lectures.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mcq_questions_document_id", "mcq_questions", ["document_id"])
    op.create_index("ix_mcq_questions_topic", "mcq_questions", ["topic"])

    # performance_sessions must exist before question_attempts (FK reference)
    op.create_table(
        "performance_sessions",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("readiness_score", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["document_id"], ["lectures.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_performance_sessions_student_id", "performance_sessions", ["student_id"])
    op.create_index("ix_performance_sessions_document_id", "performance_sessions", ["document_id"])

    op.create_table(
        "question_attempts",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("session_id", sa.String(36), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("question_id", sa.String(36), nullable=False),
        sa.Column("selected_answer", sa.String(1), nullable=False),
        sa.Column("correct_answer", sa.String(1), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("time_spent_seconds", sa.Integer(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["mcq_questions.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["performance_sessions.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_question_attempts_student_id", "question_attempts", ["student_id"])

    op.create_table(
        "weak_points",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("topic", sa.String(255), nullable=False),
        sa.Column("total_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accuracy_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempted_at", sa.DateTime(), nullable=True),
        sa.Column("flagged_as_weak", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_weak_points_student_id", "weak_points", ["student_id"])
    op.create_index("ix_weak_points_topic", "weak_points", ["topic"])
    op.create_index("ix_weak_points_flagged_as_weak", "weak_points", ["flagged_as_weak"])

    op.create_table(
        "weekly_quiz_assignments",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("question_ids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_weekly_quiz_assignments_student_id", "weekly_quiz_assignments", ["student_id"])
    op.create_index("ix_weekly_quiz_assignments_week_start", "weekly_quiz_assignments", ["week_start"])


def downgrade() -> None:
    op.drop_index("ix_weekly_quiz_assignments_week_start", "weekly_quiz_assignments")
    op.drop_index("ix_weekly_quiz_assignments_student_id", "weekly_quiz_assignments")
    op.drop_table("weekly_quiz_assignments")

    op.drop_index("ix_weak_points_flagged_as_weak", "weak_points")
    op.drop_index("ix_weak_points_topic", "weak_points")
    op.drop_index("ix_weak_points_student_id", "weak_points")
    op.drop_table("weak_points")

    op.drop_index("ix_question_attempts_student_id", "question_attempts")
    op.drop_table("question_attempts")

    op.drop_index("ix_performance_sessions_document_id", "performance_sessions")
    op.drop_index("ix_performance_sessions_student_id", "performance_sessions")
    op.drop_table("performance_sessions")

    op.drop_index("ix_mcq_questions_topic", "mcq_questions")
    op.drop_index("ix_mcq_questions_document_id", "mcq_questions")
    op.drop_table("mcq_questions")
