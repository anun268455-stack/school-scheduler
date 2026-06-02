from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Subject
from app.schemas import SubjectCreate, SubjectRead

router = APIRouter()


@router.get("/", response_model=List[SubjectRead])
async def list_subjects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subject).order_by(Subject.code))
    return result.scalars().all()


@router.post("/", response_model=SubjectRead, status_code=status.HTTP_201_CREATED)
async def create_subject(data: SubjectCreate, db: AsyncSession = Depends(get_db)):
    subject = Subject(**data.model_dump())
    db.add(subject)
    await db.commit()
    await db.refresh(subject)
    return subject


@router.get("/{subject_id}", response_model=SubjectRead)
async def get_subject(subject_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subject).where(Subject.id == subject_id))
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    return subject


@router.put("/{subject_id}", response_model=SubjectRead)
async def update_subject(subject_id: int, data: SubjectCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subject).where(Subject.id == subject_id))
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    for k, v in data.model_dump().items():
        setattr(subject, k, v)
    await db.commit()
    await db.refresh(subject)
    return subject


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subject(subject_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subject).where(Subject.id == subject_id))
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    await db.delete(subject)
    await db.commit()
