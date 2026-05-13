"""add mode column to results

Revision ID: 014_add_mode_to_results
Revises: 013_add_site_content_table
Create Date: 2026-05-13 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = '014_add_mode_to_results'
down_revision = '013_add_site_content_table'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('results', sa.Column('mode', sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column('results', 'mode')
