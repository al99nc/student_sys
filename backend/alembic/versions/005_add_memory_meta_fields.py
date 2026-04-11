"""add memory meta fields (type, importance, reason, last_accessed_at)

Revision ID: 005
Revises: f1a1e6dde3fe
Create Date: 2026-04-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "f1a1e6dde3fe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("student_memories", sa.Column("type", sa.String(50), nullable=False, server_default="context"))
    op.add_column("student_memories", sa.Column("importance", sa.Float(), nullable=False, server_default="0.5"))
    op.add_column("student_memories", sa.Column("reason", sa.Text(), nullable=True))
    op.add_column("student_memories", sa.Column("last_accessed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))


def downgrade() -> None:
    op.drop_column("student_memories", "last_accessed_at")
    op.drop_column("student_memories", "reason")
    op.drop_column("student_memories", "importance")
    op.drop_column("student_memories", "type")
