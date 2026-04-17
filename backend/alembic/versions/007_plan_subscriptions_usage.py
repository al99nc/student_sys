"""add plan, stripe_customer_id, subscriptions, ai_usage_logs

Revision ID: 007
Revises: 006
Create Date: 2026-04-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(conn, name: str) -> bool:
    return inspect(conn).has_table(name)


def _column_exists(conn, table: str, column: str) -> bool:
    cols = [c["name"] for c in inspect(conn).get_columns(table)]
    return column in cols


def upgrade() -> None:
    conn = op.get_bind()

    # ── users: plan + stripe_customer_id ─────────────────────────────
    if not _column_exists(conn, "users", "plan"):
        op.add_column(
            "users",
            sa.Column(
                "plan",
                sa.String(20),
                nullable=False,
                server_default="free",
            ),
        )

    if not _column_exists(conn, "users", "stripe_customer_id"):
        op.add_column(
            "users",
            sa.Column("stripe_customer_id", sa.String(255), nullable=True),
        )

    # ── subscriptions ────────────────────────────────────────────────
    if not _table_exists(conn, "subscriptions"):
        op.create_table(
            "subscriptions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column("stripe_subscription_id", sa.String(255), nullable=False),
            sa.Column("stripe_customer_id", sa.String(255), nullable=False),
            sa.Column("plan", sa.String(20), nullable=False),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("current_period_end", sa.DateTime(), nullable=True),
            sa.Column(
                "cancel_at_period_end",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"])
        op.create_index(
            "ix_subscriptions_stripe_subscription_id",
            "subscriptions",
            ["stripe_subscription_id"],
            unique=True,
        )

    # ── ai_usage_logs ────────────────────────────────────────────────
    if not _table_exists(conn, "ai_usage_logs"):
        op.create_table(
            "ai_usage_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column("feature", sa.String(50), nullable=False),
            sa.Column("model", sa.String(100), nullable=False),
            sa.Column("tokens_input", sa.Integer(), server_default="0"),
            sa.Column("tokens_output", sa.Integer(), server_default="0"),
            sa.Column("tokens_total", sa.Integer(), server_default="0"),
            sa.Column("cost_usd", sa.Float(), server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_ai_usage_logs_user_id", "ai_usage_logs", ["user_id"])
        op.create_index(
            "ix_ai_usage_logs_created_at", "ai_usage_logs", ["created_at"]
        )
        # Composite index for daily budget queries: WHERE user_id=? AND created_at>=?
        op.create_index(
            "ix_ai_usage_logs_user_created",
            "ai_usage_logs",
            ["user_id", "created_at"],
        )


def downgrade() -> None:
    conn = op.get_bind()

    if _table_exists(conn, "ai_usage_logs"):
        op.drop_index("ix_ai_usage_logs_user_created", table_name="ai_usage_logs")
        op.drop_index("ix_ai_usage_logs_created_at", table_name="ai_usage_logs")
        op.drop_index("ix_ai_usage_logs_user_id", table_name="ai_usage_logs")
        op.drop_table("ai_usage_logs")

    if _table_exists(conn, "subscriptions"):
        op.drop_index(
            "ix_subscriptions_stripe_subscription_id", table_name="subscriptions"
        )
        op.drop_index("ix_subscriptions_user_id", table_name="subscriptions")
        op.drop_table("subscriptions")

    if _column_exists(conn, "users", "stripe_customer_id"):
        op.drop_column("users", "stripe_customer_id")

    if _column_exists(conn, "users", "plan"):
        op.drop_column("users", "plan")
