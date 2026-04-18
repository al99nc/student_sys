"""add custom_context to results

Revision ID: 011
Revises: 010
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "results",
        sa.Column("custom_context", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("results", "custom_context")
