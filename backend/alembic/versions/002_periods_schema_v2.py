"""Periods table + v2 schema additions

Revision ID: 002
Revises: 001
Create Date: 2026-01-02 00:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── periods ─────────────────────────────────────────────────────────────
    op.create_table(
        "periods",
        sa.Column("id",         sa.Integer(),     primary_key=True),
        sa.Column("period_num", sa.SmallInteger(), nullable=False),
        sa.Column("label",      sa.String(100),   nullable=False),
        sa.Column("start_time", sa.Time(),         nullable=False),
        sa.Column("end_time",   sa.Time(),         nullable=False),
        sa.Column(
            "type",
            sa.Enum("class","break","lunch","assembly","homeroom", name="period_type"),
            nullable=False,
            server_default="class",
        ),
        sa.Column(
            "applies_to",
            sa.Enum("all","lower","upper", name="period_applies"),
            nullable=False,
            server_default="all",
        ),
    )
    op.create_index("ix_periods_period_num", "periods", ["period_num"])

    # ── rooms: add specialized_dept_id, reserved_teacher_id ─────────────────
    op.add_column("rooms", sa.Column("specialized_dept_id", sa.Integer(), nullable=True))
    op.add_column("rooms", sa.Column("reserved_teacher_id",
        sa.Integer(), sa.ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True))

    # ── timetable_slots: rename locked→is_locked, add period_id FK ──────────
    op.add_column("timetable_slots",
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default="false"))
    # Migrate existing locked → is_locked (SQLite / PG compatible)
    op.execute("UPDATE timetable_slots SET is_locked = locked")
    op.drop_column("timetable_slots", "locked")

    # period_id FK (nullable to allow gradual migration)
    op.add_column("timetable_slots",
        sa.Column("period_id", sa.Integer(),
                  sa.ForeignKey("periods.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("timetable_slots", "period_id")
    op.add_column("timetable_slots",
        sa.Column("locked", sa.Boolean(), nullable=False, server_default="false"))
    op.execute("UPDATE timetable_slots SET locked = is_locked")
    op.drop_column("timetable_slots", "is_locked")
    op.drop_column("rooms", "reserved_teacher_id")
    op.drop_column("rooms", "specialized_dept_id")
    op.drop_table("periods")
    op.execute("DROP TYPE IF EXISTS period_type")
    op.execute("DROP TYPE IF EXISTS period_applies")
