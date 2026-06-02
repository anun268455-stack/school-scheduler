"""
Timetable router – CRUD for slots + solver trigger endpoint.
All heavy lifting is delegated to the solver engine; this layer
is purely DB orchestration and HTTP transport.
"""
from __future__ import annotations

import asyncio
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models import (
    LessonRequirement, Room, StudentGroup, Subject, Teacher, TimetableSlot
)
from app.schemas import (
    LessonRequirementCreate, LessonRequirementRead,
    SolverRequest, SolverResult,
    TimetableSlotCreate, TimetableSlotRead, TimetableSlotUpdate,
)
from app.solver.engine import (
    LockedSlot, SGroup, SRequirement, SRoom, SSubject, STeacher,
    SolverInput, TimetableSolver,
)

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Lesson Requirements CRUD
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/requirements", response_model=List[LessonRequirementRead])
async def list_requirements(
    group_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(LessonRequirement)
    if group_id:
        q = q.where(LessonRequirement.group_id == group_id)
    result = await db.execute(q.order_by(LessonRequirement.id))
    return result.scalars().all()


@router.post("/requirements", response_model=LessonRequirementRead, status_code=status.HTTP_201_CREATED)
async def create_requirement(data: LessonRequirementCreate, db: AsyncSession = Depends(get_db)):
    req = LessonRequirement(**data.model_dump())
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


@router.delete("/requirements/{req_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_requirement(req_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LessonRequirement).where(LessonRequirement.id == req_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    await db.delete(req)
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Timetable Slot CRUD
# ─────────────────────────────────────────────────────────────────────────────
def _enrich_slot(slot: TimetableSlot) -> TimetableSlotRead:
    rd = TimetableSlotRead.model_validate(slot)
    rd.teacher_name = slot.teacher.name if slot.teacher else None
    rd.group_name = slot.group.name if slot.group else None
    rd.room_name = slot.room.name if slot.room else None
    rd.room_type = slot.room.type.value if slot.room else None
    rd.subject_name = slot.subject.name if slot.subject else None
    rd.subject_code = slot.subject.code if slot.subject else None
    rd.subject_weight = slot.subject.weight.value if slot.subject else None
    return rd


@router.get("/slots", response_model=List[TimetableSlotRead])
async def list_slots(
    group_id: Optional[int] = Query(None),
    teacher_id: Optional[int] = Query(None),
    day: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(TimetableSlot)
        .options(
            selectinload(TimetableSlot.teacher),
            selectinload(TimetableSlot.group),
            selectinload(TimetableSlot.room),
            selectinload(TimetableSlot.subject),
        )
    )
    if group_id is not None:
        q = q.where(TimetableSlot.group_id == group_id)
    if teacher_id is not None:
        q = q.where(TimetableSlot.teacher_id == teacher_id)
    if day is not None:
        q = q.where(TimetableSlot.day == day)
    result = await db.execute(q.order_by(TimetableSlot.group_id, TimetableSlot.day, TimetableSlot.period))
    return [_enrich_slot(s) for s in result.scalars().all()]


@router.post("/slots", response_model=TimetableSlotRead, status_code=status.HTTP_201_CREATED)
async def create_slot(data: TimetableSlotCreate, db: AsyncSession = Depends(get_db)):
    slot = TimetableSlot(**data.model_dump())
    db.add(slot)
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Conflict: {exc}")
    await db.refresh(slot)
    # Re-load with relationships
    result = await db.execute(
        select(TimetableSlot)
        .options(
            selectinload(TimetableSlot.teacher),
            selectinload(TimetableSlot.group),
            selectinload(TimetableSlot.room),
            selectinload(TimetableSlot.subject),
        )
        .where(TimetableSlot.id == slot.id)
    )
    return _enrich_slot(result.scalar_one())


@router.patch("/slots/{slot_id}", response_model=TimetableSlotRead)
async def update_slot(slot_id: int, data: TimetableSlotUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TimetableSlot).where(TimetableSlot.id == slot_id))
    slot = result.scalar_one_or_none()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    if slot.locked and (data.day is not None or data.period is not None):
        raise HTTPException(status_code=400, detail="Slot is locked – unlock before moving")

    for k, v in data.model_dump(exclude_none=True).items():
        setattr(slot, k, v)
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Conflict: {exc}")
    await db.refresh(slot)

    # Sync parallel siblings
    if slot.parallel_group_key and (data.day is not None or data.period is not None):
        await _sync_parallel_siblings(slot, db)

    result = await db.execute(
        select(TimetableSlot)
        .options(
            selectinload(TimetableSlot.teacher),
            selectinload(TimetableSlot.group),
            selectinload(TimetableSlot.room),
            selectinload(TimetableSlot.subject),
        )
        .where(TimetableSlot.id == slot.id)
    )
    return _enrich_slot(result.scalar_one())


async def _sync_parallel_siblings(moved_slot: TimetableSlot, db: AsyncSession):
    """Move all siblings of a parallel slot to the same (day, period)."""
    siblings = await db.execute(
        select(TimetableSlot).where(
            TimetableSlot.parallel_group_key == moved_slot.parallel_group_key,
            TimetableSlot.id != moved_slot.id,
            TimetableSlot.period == moved_slot.period - (0 if not moved_slot.is_double_start else 0),
        )
    )
    for sib in siblings.scalars().all():
        sib.day = moved_slot.day
        sib.period = moved_slot.period
    try:
        await db.commit()
    except Exception:
        await db.rollback()


@router.delete("/slots/{slot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_slot(slot_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TimetableSlot).where(TimetableSlot.id == slot_id))
    slot = result.scalar_one_or_none()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    await db.delete(slot)
    await db.commit()


@router.delete("/slots", status_code=status.HTTP_204_NO_CONTENT)
async def clear_all_slots(db: AsyncSession = Depends(get_db)):
    await db.execute(delete(TimetableSlot).where(TimetableSlot.locked == False))  # noqa: E712
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Solver endpoint
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/solve", response_model=SolverResult)
async def solve_timetable(request: SolverRequest, db: AsyncSession = Depends(get_db)):
    """
    Run the CP-SAT solver against all LessonRequirements and persist the result.
    This is a synchronous (blocking) endpoint; for production consider offloading
    to a task queue (Celery / ARQ) and polling for completion.
    """
    # ── Load all data ────────────────────────────────────────────────────────
    teachers_db = (await db.execute(select(Teacher))).scalars().all()
    groups_db = (await db.execute(select(StudentGroup))).scalars().all()
    subjects_db = (await db.execute(select(Subject))).scalars().all()
    rooms_db = (await db.execute(select(Room))).scalars().all()
    reqs_db = (await db.execute(select(LessonRequirement))).scalars().all()

    if not reqs_db:
        raise HTTPException(status_code=400, detail="No lesson requirements defined")

    # Build room → building map
    room_building: dict = {r.id: r.building_id for r in rooms_db}

    s_teachers = [
        STeacher(
            id=t.id,
            fixed_room_id=t.fixed_room_id,
            outdoor_score=t.outdoor_score,
            max_slots_per_day=t.max_slots_per_day,
            max_outdoor_per_week=t.max_outdoor_per_week,
            building_id=room_building.get(t.fixed_room_id) if t.fixed_room_id else None,
        )
        for t in teachers_db
    ]
    s_groups = [
        SGroup(id=g.id, level=g.level, parent_id=g.parent_id)
        for g in groups_db
    ]
    s_subjects = [
        SSubject(id=s.id, code=s.code, type=s.type.value, duration=s.duration, weight=s.weight.value)
        for s in subjects_db
    ]
    s_rooms = [
        SRoom(id=r.id, type=r.type.value, building_id=r.building_id, floor=r.floor, capacity=r.capacity)
        for r in rooms_db
    ]
    s_reqs = [
        SRequirement(
            id=r.id,
            group_id=r.group_id,
            subject_id=r.subject_id,
            teacher_id=r.teacher_id,
            weekly_count=r.weekly_count,
            parallel_group_key=r.parallel_group_key,
        )
        for r in reqs_db
    ]

    # Locked slots
    locked_slots_list: List[LockedSlot] = []
    if request.locked_slot_ids:
        locked_db = (
            await db.execute(
                select(TimetableSlot).where(TimetableSlot.id.in_(request.locked_slot_ids))
            )
        ).scalars().all()
        locked_slots_list = [
            LockedSlot(
                teacher_id=ls.teacher_id,
                group_id=ls.group_id,
                room_id=ls.room_id,
                subject_id=ls.subject_id,
                day=ls.day,
                period=ls.period,
                is_double_start=ls.is_double_start,
            )
            for ls in locked_db
        ]

    inp = SolverInput(
        teachers=s_teachers,
        groups=s_groups,
        subjects=s_subjects,
        rooms=s_rooms,
        requirements=s_reqs,
        locked_slots=locked_slots_list,
        time_limit_seconds=request.time_limit_seconds or settings.SOLVER_TIME_LIMIT_SECONDS,
    )

    # ── Run solver (in thread pool to avoid blocking the event loop) ─────────
    loop = asyncio.get_event_loop()
    solver = TimetableSolver(inp)
    output = await loop.run_in_executor(None, solver.solve)

    if output.status == "INFEASIBLE":
        raise HTTPException(
            status_code=422,
            detail={"status": "INFEASIBLE", "violations": output.violations},
        )

    # ── Persist results ──────────────────────────────────────────────────────
    if request.clear_existing:
        await db.execute(delete(TimetableSlot).where(TimetableSlot.locked == False))  # noqa: E712
        await db.commit()

    new_slots: List[TimetableSlot] = []
    for a in output.slots:
        slot = TimetableSlot(
            day=a.day,
            period=a.period,
            teacher_id=a.teacher_id,
            group_id=a.group_id,
            room_id=a.room_id,
            subject_id=a.subject_id,
            is_double_start=a.is_double_start,
            parallel_group_key=a.parallel_group_key,
        )
        db.add(slot)
        new_slots.append(slot)

    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"DB write failed: {exc}")

    return SolverResult(
        status=output.status,
        slots_created=len(new_slots),
        solve_time_seconds=output.solve_time_seconds,
        objective_value=output.objective_value,
        violations=output.violations,
    )
