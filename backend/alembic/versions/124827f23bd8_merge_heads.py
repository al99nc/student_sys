"""merge heads

Revision ID: 124827f23bd8
Revises: 005, 016_add_prev_token_hash_to_user_sessions
Create Date: 2026-05-25 18:47:17.362887

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '124827f23bd8'
down_revision: Union[str, None] = ('005', '016_add_prev_token_hash_to_user_sessions')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
