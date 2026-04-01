"""add user profile columns

Revision ID: 003
Revises: 5b05a8a624fe
Create Date: 2026-04-01 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "5b05a8a624fe"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("name", sa.String(120), nullable=True))
    op.add_column("users", sa.Column("university", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("college", sa.String(120), nullable=True))
    op.add_column("users", sa.Column("year_of_study", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("subject", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("topic_area", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("level", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "level")
    op.drop_column("users", "topic_area")
    op.drop_column("users", "subject")
    op.drop_column("users", "year_of_study")
    op.drop_column("users", "college")
    op.drop_column("users", "university")
    op.drop_column("users", "name")
