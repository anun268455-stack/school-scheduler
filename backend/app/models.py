"""SQLAlchemy ORM models – mirrors the Alembic migration exactly."""
from __future__ import annotations

import enum
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ─────────────────────────────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────────────────────────────
class RoomType(str, enum.Enum):
    physical = "physical"
    special = "special"
    outdoor = "outdoor"


class SubjectType(str, enum.Enum):
    common = "common"
    parallel = "parallel"


class SubjectWeight(str, enum.Enum):
    heavy = "heavy"
    light = "light"


# ─────────────────────────────────────────────────────────────────────────────
# Building
# ─────────────────────────────────────────────────────────────────────────────
class Building(Base):
    __tablename__ = "buildings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    floor_count: Mapped[int] = mapped_column(Integer, default=1)

    rooms: Mapped[List[Room]] = relationship("Room", back_populates="building")


# ─────────────────────────────────────────────────────────────────────────────
# Room
# ─────────────────────────────────────────────────────────────────────────────
class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[RoomType] = mapped_column(Enum(RoomType, name="room_type"), default=RoomType.physical)
    building_id: Mapped[Optional[int]] = mapped_column(ForeignKey("buildings.id", ondelete="SET NULL"), nullable=True)
    floor: Mapped[int] = mapped_column(Integer, default=1)
    capacity: Mapped[int] = mapped_column(Integer, default=40)

    building: Mapped[Optional[Building]] = relationship("Building", back_populates="rooms")
    teacher_fixed: Mapped[Optional[Teacher]] = relationship("Teacher", back_populates="fixed_room", foreign_keys="Teacher.fixed_room_id")
    slots: Mapped[List[TimetableSlot]] = relationship("TimetableSlot", back_populates="room")


# ─────────────────────────────────────────────────────────────────────────────
# StudentGroup
# ─────────────────────────────────────────────────────────────────────────────
class StudentGroup(Base):
    __tablename__ = "student_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("student_groups.id", ondelete="SET NULL"), nullable=True
    )
    level: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=40)

    parent: Mapped[Optional[StudentGroup]] = relationship("StudentGroup", remote_side="StudentGroup.id", back_populates="children")
    children: Mapped[List[StudentGroup]] = relationship("StudentGroup", back_populates="parent")
    slots: Mapped[List[TimetableSlot]] = relationship("TimetableSlot", back_populates="group")
    requirements: Mapped[List[LessonRequirement]] = relationship("LessonRequirement", back_populates="group")


# ─────────────────────────────────────────────────────────────────────────────
# Teacher
# ─────────────────────────────────────────────────────────────────────────────
class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    fixed_room_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True
    )
    outdoor_score: Mapped[int] = mapped_column(Integer, default=5)
    max_slots_per_day: Mapped[int] = mapped_column(Integer, default=6)
    max_outdoor_per_week: Mapped[int] = mapped_column(Integer, default=2)

    fixed_room: Mapped[Optional[Room]] = relationship("Room", back_populates="teacher_fixed", foreign_keys=[fixed_room_id])
    slots: Mapped[List[TimetableSlot]] = relationship("TimetableSlot", back_populates="teacher")
    requirements: Mapped[List[LessonRequirement]] = relationship("LessonRequirement", back_populates="teacher")


# ─────────────────────────────────────────────────────────────────────────────
# Subject
# ─────────────────────────────────────────────────────────────────────────────
class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[SubjectType] = mapped_column(Enum(SubjectType, name="subject_type"), default=SubjectType.common)
    duration: Mapped[int] = mapped_column(Integer, default=1)
    weight: Mapped[SubjectWeight] = mapped_column(Enum(SubjectWeight, name="subject_weight"), default=SubjectWeight.light)

    slots: Mapped[List[TimetableSlot]] = relationship("TimetableSlot", back_populates="subject")
    requirements: Mapped[List[LessonRequirement]] = relationship("LessonRequirement", back_populates="subject")


# ─────────────────────────────────────────────────────────────────────────────
# LessonRequirement
# ─────────────────────────────────────────────────────────────────────────────
class LessonRequirement(Base):
    __tablename__ = "lesson_requirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("student_groups.id", ondelete="CASCADE"), nullable=False)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False)
    weekly_count: Mapped[int] = mapped_column(Integer, default=1)
    parallel_group_key: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    group: Mapped[StudentGroup] = relationship("StudentGroup", back_populates="requirements")
    subject: Mapped[Subject] = relationship("Subject", back_populates="requirements")
    teacher: Mapped[Teacher] = relationship("Teacher", back_populates="requirements")


# ─────────────────────────────────────────────────────────────────────────────
# TimetableSlot
# ─────────────────────────────────────────────────────────────────────────────
class TimetableSlot(Base):
    __tablename__ = "timetable_slots"
    __table_args__ = (
        UniqueConstraint("teacher_id", "day", "period", name="uq_slot_teacher_day_period"),
        UniqueConstraint("group_id", "day", "period", name="uq_slot_group_day_period"),
        UniqueConstraint("room_id", "day", "period", name="uq_slot_room_day_period"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[int] = mapped_column(SmallInteger, nullable=False)       # 0=Mon … 4=Fri
    period: Mapped[int] = mapped_column(SmallInteger, nullable=False)    # 0-based
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False)
    group_id: Mapped[int] = mapped_column(ForeignKey("student_groups.id", ondelete="CASCADE"), nullable=False)
    room_id: Mapped[Optional[int]] = mapped_column(ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    is_double_start: Mapped[bool] = mapped_column(Boolean, default=False)
    parallel_group_key: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    teacher: Mapped[Teacher] = relationship("Teacher", back_populates="slots")
    group: Mapped[StudentGroup] = relationship("StudentGroup", back_populates="slots")
    room: Mapped[Optional[Room]] = relationship("Room", back_populates="slots")
    subject: Mapped[Subject] = relationship("Subject", back_populates="slots")
