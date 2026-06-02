"""Pydantic v2 schemas for request/response validation."""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field, model_validator


# ─────────────────────────────────────────────────────────────────────────────
# Building
# ─────────────────────────────────────────────────────────────────────────────
class BuildingBase(BaseModel):
    name: str
    floor_count: int = 1

class BuildingCreate(BuildingBase): ...
class BuildingRead(BuildingBase):
    id: int
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# Room
# ─────────────────────────────────────────────────────────────────────────────
class RoomBase(BaseModel):
    name: str
    type: str = "physical"
    building_id: Optional[int] = None
    floor: int = 1
    capacity: int = 40

class RoomCreate(RoomBase): ...
class RoomRead(RoomBase):
    id: int
    building_name: Optional[str] = None
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# StudentGroup
# ─────────────────────────────────────────────────────────────────────────────
class StudentGroupBase(BaseModel):
    name: str
    parent_id: Optional[int] = None
    level: Optional[str] = None
    size: int = 40

class StudentGroupCreate(StudentGroupBase): ...
class StudentGroupRead(StudentGroupBase):
    id: int
    children: List["StudentGroupRead"] = []
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# Teacher
# ─────────────────────────────────────────────────────────────────────────────
class TeacherBase(BaseModel):
    name: str
    fixed_room_id: Optional[int] = None
    outdoor_score: int = Field(default=5, ge=1, le=10)
    max_slots_per_day: int = Field(default=6, ge=1, le=10)
    max_outdoor_per_week: int = Field(default=2, ge=0, le=20)

class TeacherCreate(TeacherBase): ...
class TeacherRead(TeacherBase):
    id: int
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# Subject
# ─────────────────────────────────────────────────────────────────────────────
class SubjectBase(BaseModel):
    code: str
    name: str
    type: str = "common"
    duration: int = Field(default=1, ge=1, le=2)
    weight: str = "light"

class SubjectCreate(SubjectBase): ...
class SubjectRead(SubjectBase):
    id: int
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# LessonRequirement
# ─────────────────────────────────────────────────────────────────────────────
class LessonRequirementBase(BaseModel):
    group_id: int
    subject_id: int
    teacher_id: int
    weekly_count: int = Field(default=1, ge=1, le=10)
    parallel_group_key: Optional[str] = None

class LessonRequirementCreate(LessonRequirementBase): ...
class LessonRequirementRead(LessonRequirementBase):
    id: int
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# TimetableSlot
# ─────────────────────────────────────────────────────────────────────────────
class TimetableSlotBase(BaseModel):
    day: int = Field(ge=0, le=4)
    period: int = Field(ge=0, le=9)
    teacher_id: int
    group_id: int
    room_id: Optional[int] = None
    subject_id: int
    is_double_start: bool = False
    parallel_group_key: Optional[str] = None
    locked: bool = False

class TimetableSlotCreate(TimetableSlotBase): ...
class TimetableSlotUpdate(BaseModel):
    day: Optional[int] = None
    period: Optional[int] = None
    room_id: Optional[int] = None
    locked: Optional[bool] = None

class TimetableSlotRead(TimetableSlotBase):
    id: int
    teacher_name: Optional[str] = None
    group_name: Optional[str] = None
    room_name: Optional[str] = None
    room_type: Optional[str] = None
    subject_name: Optional[str] = None
    subject_code: Optional[str] = None
    subject_weight: Optional[str] = None
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# Solver
# ─────────────────────────────────────────────────────────────────────────────
class SolverRequest(BaseModel):
    clear_existing: bool = True
    time_limit_seconds: Optional[int] = None  # override settings default
    locked_slot_ids: List[int] = []  # slots that must not move

class SolverResult(BaseModel):
    status: str  # "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN"
    slots_created: int
    solve_time_seconds: float
    objective_value: Optional[float] = None
    violations: List[str] = []
