"""add site_content table

Revision ID: 013_add_site_content_table
Revises: 012_add_signup_ip_to_users
Create Date: 2026-04-29 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import func

# revision identifiers
revision = '013_add_site_content_table'
down_revision = '012_add_signup_ip_to_users'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'site_content',
        sa.Column('key', sa.String(50), primary_key=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=func.now(), onupdate=func.now()),
    )


def downgrade() -> None:
    op.drop_table('site_content')
