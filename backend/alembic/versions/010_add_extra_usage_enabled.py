"""add extra_usage_enabled to users

Revision ID: 010
Revises: 009
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "extra_usage_enabled",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade():
    op.drop_column("users", "extra_usage_enabled")
