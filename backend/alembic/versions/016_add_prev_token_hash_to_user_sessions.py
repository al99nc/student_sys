"""add previous token hash to user sessions

Revision ID: 016_add_prev_token_hash_to_user_sessions
Revises: 015_add_otp_code_to_magic_link_tokens
Create Date: 2026-05-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = '016_add_prev_token_hash_to_user_sessions'
down_revision = '015_add_otp_code_to_magic_link_tokens'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_sessions', sa.Column('previous_token_hash', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('user_sessions', 'previous_token_hash')
