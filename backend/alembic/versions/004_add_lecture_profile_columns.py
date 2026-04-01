"""add lecture profile columns

Revision ID: 004
Revises: 003
Create Date: 2026-04-01 12:10:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lectures", sa.Column("university", sa.String(255), nullable=True))
    op.add_column("lectures", sa.Column("college", sa.String(120), nullable=True))
    op.add_column("lectures", sa.Column("year_of_study", sa.Integer(), nullable=True))
    op.add_column("lectures", sa.Column("subject", sa.String(255), nullable=True))
    op.add_column("lectures", sa.Column("topic_area", sa.String(255), nullable=True))
    op.add_column("lectures", sa.Column("level", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("lectures", "level")
    op.drop_column("lectures", "topic_area")
    op.drop_column("lectures", "subject")
    op.drop_column("lectures", "year_of_study")
    op.drop_column("lectures", "college")
    op.drop_column("lectures", "university")
