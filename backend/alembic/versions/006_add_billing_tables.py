"""add billing tables (checkout_payments, coach_performance_usage, users.credit_balance)

Revision ID: 006
Revises: f1a1e6dde3fe
Create Date: 2026-04-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = "006"
down_revision: Union[str, None] = "f1a1e6dde3fe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(conn, name: str) -> bool:
    return inspect(conn).has_table(name)


def _column_exists(conn, table: str, column: str) -> bool:
    cols = [c["name"] for c in inspect(conn).get_columns(table)]
    return column in cols


def upgrade() -> None:
    conn = op.get_bind()

    if not _table_exists(conn, "checkout_payments"):
        op.create_table(
            "checkout_payments",
            sa.Column("stripe_checkout_session_id", sa.String(255), primary_key=True),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("credits", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_checkout_payments_user_id", "checkout_payments", ["user_id"])

    if not _table_exists(conn, "coach_performance_usage"):
        op.create_table(
            "coach_performance_usage",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_coach_performance_usage_user_id", "coach_performance_usage", ["user_id"])

    if not _column_exists(conn, "users", "credit_balance"):
        op.add_column(
            "users",
            sa.Column("credit_balance", sa.Integer(), nullable=True, server_default="0"),
        )


def downgrade() -> None:
    conn = op.get_bind()

    if _column_exists(conn, "users", "credit_balance"):
        op.drop_column("users", "credit_balance")

    if _table_exists(conn, "coach_performance_usage"):
        op.drop_index("ix_coach_performance_usage_user_id", table_name="coach_performance_usage")
        op.drop_table("coach_performance_usage")

    if _table_exists(conn, "checkout_payments"):
        op.drop_index("ix_checkout_payments_user_id", table_name="checkout_payments")
        op.drop_table("checkout_payments")
