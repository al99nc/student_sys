"""add otp_code to magic_link_tokens

Revision ID: 015_add_otp_code_to_magic_link_tokens
Revises: 014_add_mode_to_results
Create Date: 2026-05-13 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = '015_add_otp_code_to_magic_link_tokens'
down_revision = '014_add_mode_to_results'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('magic_link_tokens', sa.Column('otp_code', sa.String(6), nullable=True))


def downgrade() -> None:
    op.drop_column('magic_link_tokens', 'otp_code')
