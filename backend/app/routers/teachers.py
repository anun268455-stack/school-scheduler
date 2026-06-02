from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Teacher
from app.schemas import TeacherCreate, TeacherRead

router = APIRouter()


@router.get("/", response_model=List[TeacherRead])
async def list_teachers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Teacher).order_by(Teacher.name))
    return result.scalars().all()


@router.post("/", response_model=TeacherRead, status_code=status.HTTP_201_CREATED)
async def create_teacher(data: TeacherCreate, db: AsyncSession = Depends(get_db)):
    teacher = Teacher(**data.model_dump())
    db.add(teacher)
    await db.commit()
    await db.refresh(teacher)
    return teacher


@router.get("/{teacher_id}", response_model=TeacherRead)
async def get_teacher(teacher_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Teacher).where(Teacher.id == teacher_id))
    teacher = result.scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return teacher


@router.put("/{teacher_id}", response_model=TeacherRead)
async def update_teacher(teacher_id: int, data: TeacherCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Teacher).where(Teacher.id == teacher_id))
    teacher = result.scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    for k, v in data.model_dump().items():
        setattr(teacher, k, v)
    await db.commit()
    await db.refresh(teacher)
    return teacher


@router.delete("/{teacher_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_teacher(teacher_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Teacher).where(Teacher.id == teacher_id))
    teacher = result.scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    await db.delete(teacher)
    await db.commit()
