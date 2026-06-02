from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import StudentGroup
from app.schemas import StudentGroupCreate, StudentGroupRead

router = APIRouter()


@router.get("/", response_model=List[StudentGroupRead])
async def list_groups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(StudentGroup)
        .options(selectinload(StudentGroup.children))
        .order_by(StudentGroup.id)
    )
    return result.scalars().all()


@router.post("/", response_model=StudentGroupRead, status_code=status.HTTP_201_CREATED)
async def create_group(data: StudentGroupCreate, db: AsyncSession = Depends(get_db)):
    group = StudentGroup(**data.model_dump())
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.get("/{group_id}", response_model=StudentGroupRead)
async def get_group(group_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(StudentGroup)
        .options(selectinload(StudentGroup.children))
        .where(StudentGroup.id == group_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.put("/{group_id}", response_model=StudentGroupRead)
async def update_group(group_id: int, data: StudentGroupCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudentGroup).where(StudentGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    for k, v in data.model_dump().items():
        setattr(group, k, v)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudentGroup).where(StudentGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.delete(group)
    await db.commit()
