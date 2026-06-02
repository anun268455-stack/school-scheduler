from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Room, Building
from app.schemas import RoomCreate, RoomRead, BuildingCreate, BuildingRead

router = APIRouter()


# ── Buildings ──────────────────────────────────────────────────────────────
@router.get("/buildings", response_model=List[BuildingRead])
async def list_buildings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Building).order_by(Building.name))
    return result.scalars().all()


@router.post("/buildings", response_model=BuildingRead, status_code=status.HTTP_201_CREATED)
async def create_building(data: BuildingCreate, db: AsyncSession = Depends(get_db)):
    building = Building(**data.model_dump())
    db.add(building)
    await db.commit()
    await db.refresh(building)
    return building


# ── Rooms ──────────────────────────────────────────────────────────────────
@router.get("/", response_model=List[RoomRead])
async def list_rooms(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Room).options(selectinload(Room.building)).order_by(Room.name)
    )
    rooms = result.scalars().all()
    output = []
    for r in rooms:
        rd = RoomRead.model_validate(r)
        rd.building_name = r.building.name if r.building else None
        output.append(rd)
    return output


@router.post("/", response_model=RoomRead, status_code=status.HTTP_201_CREATED)
async def create_room(data: RoomCreate, db: AsyncSession = Depends(get_db)):
    room = Room(**data.model_dump())
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return room


@router.get("/{room_id}", response_model=RoomRead)
async def get_room(room_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Room).options(selectinload(Room.building)).where(Room.id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    rd = RoomRead.model_validate(room)
    rd.building_name = room.building.name if room.building else None
    return rd


@router.put("/{room_id}", response_model=RoomRead)
async def update_room(room_id: int, data: RoomCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    for k, v in data.model_dump().items():
        setattr(room, k, v)
    await db.commit()
    await db.refresh(room)
    return room


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(room_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    await db.delete(room)
    await db.commit()
