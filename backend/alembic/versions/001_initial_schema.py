"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-01-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── buildings ────────────────────────────────────────────────────────────
    op.create_table(
        "buildings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("floor_count", sa.Integer(), nullable=False, server_default="1"),
    )

    # ── rooms ────────────────────────────────────────────────────────────────
    op.create_table(
        "rooms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "type",
            sa.Enum("physical", "special", "outdoor", name="room_type"),
            nullable=False,
            server_default="physical",
        ),
        sa.Column("building_id", sa.Integer(), sa.ForeignKey("buildings.id", ondelete="SET NULL"), nullable=True),
        sa.Column("floor", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="40"),
    )
    op.create_index("ix_rooms_building_id", "rooms", ["building_id"])

    # ── student_groups ───────────────────────────────────────────────────────
    op.create_table(
        "student_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("student_groups.id", ondelete="SET NULL"), nullable=True),
        sa.Column("level", sa.String(20), nullable=True),  # "M1", "M2", …
        sa.Column("size", sa.Integer(), nullable=False, server_default="40"),
    )
    op.create_index("ix_student_groups_parent_id", "student_groups", ["parent_id"])

    # ── teachers ─────────────────────────────────────────────────────────────
    op.create_table(
        "teachers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("fixed_room_id", sa.Integer(), sa.ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True),
        sa.Column("outdoor_score", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("max_slots_per_day", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("max_outdoor_per_week", sa.Integer(), nullable=False, server_default="2"),
    )

    # ── subjects ─────────────────────────────────────────────────────────────
    op.create_table(
        "subjects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "type",
            sa.Enum("common", "parallel", name="subject_type"),
            nullable=False,
            server_default="common",
        ),
        sa.Column("duration", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "weight",
            sa.Enum("heavy", "light", name="subject_weight"),
            nullable=False,
            server_default="light",
        ),
    )

    # ── lesson_requirements ─────────────────────────────────────────────────
    op.create_table(
        "lesson_requirements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("student_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weekly_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("parallel_group_key", sa.String(50), nullable=True),  # links siblings
    )
    op.create_index("ix_lr_group_subject", "lesson_requirements", ["group_id", "subject_id"])
    op.create_index("ix_lr_parallel", "lesson_requirements", ["parallel_group_key"])

    # ── timetable_slots ──────────────────────────────────────────────────────
    op.create_table(
        "timetable_slots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("day", sa.SmallInteger(), nullable=False),     # 0=Mon … 4=Fri
        sa.Column("period", sa.SmallInteger(), nullable=False),  # 0-based
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("student_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("room_id", sa.Integer(), sa.ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_double_start", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("parallel_group_key", sa.String(50), nullable=True),
        sa.Column("locked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_unique_constraint("uq_slot_teacher_day_period", "timetable_slots", ["teacher_id", "day", "period"])
    op.create_unique_constraint("uq_slot_group_day_period", "timetable_slots", ["group_id", "day", "period"])
    op.create_unique_constraint("uq_slot_room_day_period", "timetable_slots", ["room_id", "day", "period"])
    op.create_index("ix_slot_day_period", "timetable_slots", ["day", "period"])


def downgrade() -> None:
    op.drop_table("timetable_slots")
    op.drop_table("lesson_requirements")
    op.drop_table("subjects")
    op.drop_table("teachers")
    op.drop_table("student_groups")
    op.drop_table("rooms")
    op.drop_table("buildings")
    op.execute("DROP TYPE IF EXISTS room_type")
    op.execute("DROP TYPE IF EXISTS subject_type")
    op.execute("DROP TYPE IF EXISTS subject_weight")
