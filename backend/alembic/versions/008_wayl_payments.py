"""add wayl_payments table

Revision ID: 008
Revises: 007_plan_subscriptions_usage
Create Date: 2026-04-17
"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wayl_payments",
        sa.Column("wayl_reference_id", sa.String(255), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_wayl_payments_user_id", "wayl_payments", ["user_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_wayl_payments_user_id", table_name="wayl_payments")
    op.drop_table("wayl_payments")
