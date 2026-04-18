"""convert users.id and all referencing columns from INTEGER to VARCHAR(36)

Revision ID: 009
Revises: 008
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None

# All FK constraints referencing users(id), with their table and column
_FK_DEPS = [
    ("lectures",               "user_id",    "lectures_user_id_fkey"),
    ("quiz_sessions",          "user_id",    "quiz_sessions_user_id_fkey"),
    ("performance_sessions",   "student_id", "performance_sessions_student_id_fkey"),
    ("weak_points",            "student_id", "weak_points_student_id_fkey"),
    ("weekly_quiz_assignments","student_id", "weekly_quiz_assignments_student_id_fkey"),
    ("topic_co_failures",      "student_id", "topic_co_failures_student_id_fkey"),
    ("topic_snapshots",        "student_id", "topic_snapshots_student_id_fkey"),
    ("learning_patterns",      "student_id", "learning_patterns_student_id_fkey"),
    ("student_ai_insights",    "student_id", "student_ai_insights_student_id_fkey"),
    ("question_attempts",      "student_id", "question_attempts_student_id_fkey"),
    ("answer_timelines",       "student_id", "answer_timelines_student_id_fkey"),
    ("coach_conversations",    "student_id", "coach_conversations_student_id_fkey"),
    ("coach_messages",         "student_id", "coach_messages_student_id_fkey"),
]


def _col_type(conn, table: str, column: str) -> str:
    row = conn.execute(
        text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c"
        ),
        {"t": table, "c": column},
    ).fetchone()
    return row[0] if row else ""


def _fk_exists(conn, table: str, constraint: str) -> bool:
    row = conn.execute(
        text(
            "SELECT 1 FROM information_schema.table_constraints "
            "WHERE table_name = :t AND constraint_name = :c "
            "AND constraint_type = 'FOREIGN KEY'"
        ),
        {"t": table, "c": constraint},
    ).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()

    # Skip if users.id is already a character type
    if not _col_type(conn, "users", "id").startswith("int"):
        return

    # 1. Drop all FK constraints
    for table, col, constraint in _FK_DEPS:
        if _fk_exists(conn, table, constraint):
            op.drop_constraint(constraint, table, type_="foreignkey")

    # 2. Convert users.id: INTEGER → VARCHAR(36)
    op.alter_column(
        "users", "id",
        existing_type=sa.Integer(),
        type_=sa.String(36),
        existing_nullable=False,
        postgresql_using="id::text",
    )

    # 3. Convert each referencing column: INTEGER → VARCHAR(36)
    for table, col, _ in _FK_DEPS:
        if _col_type(conn, table, col).startswith("int"):
            op.alter_column(
                table, col,
                existing_type=sa.Integer(),
                type_=sa.String(36),
                existing_nullable=False,
                postgresql_using=f"{col}::text",
            )

    # 4. Re-create FK constraints
    for table, col, constraint in _FK_DEPS:
        op.create_foreign_key(constraint, table, "users", [col], ["id"])


def downgrade() -> None:
    conn = op.get_bind()

    # Drop FKs
    for table, col, constraint in _FK_DEPS:
        if _fk_exists(conn, table, constraint):
            op.drop_constraint(constraint, table, type_="foreignkey")

    # Revert referencing columns back to INTEGER
    for table, col, _ in _FK_DEPS:
        if not _col_type(conn, table, col).startswith("int"):
            op.alter_column(
                table, col,
                existing_type=sa.String(36),
                type_=sa.Integer(),
                existing_nullable=False,
                postgresql_using=f"{col}::integer",
            )

    # Revert users.id back to INTEGER
    op.alter_column(
        "users", "id",
        existing_type=sa.String(36),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="id::integer",
    )
