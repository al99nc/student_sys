"""add signup_ip to users

Revision ID: 012_add_signup_ip_to_users
Revises: f1a1e6dde3fe
Create Date: 2026-04-29 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = '012_add_signup_ip_to_users'
down_revision = 'f1a1e6dde3fe'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('signup_ip', sa.String(45), nullable=True))
    op.create_index('ix_users_signup_ip', 'users', ['signup_ip'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_users_signup_ip', table_name='users')
    op.drop_column('users', 'signup_ip')
