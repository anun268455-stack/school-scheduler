"""FastAPI application entry-point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import groups, teachers, subjects, rooms, timetable

app = FastAPI(
    title="School Timetable Scheduler API",
    description="Production-grade CP-SAT powered timetabling system",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(groups.router,   prefix="/api/groups",   tags=["Student Groups"])
app.include_router(teachers.router, prefix="/api/teachers", tags=["Teachers"])
app.include_router(subjects.router, prefix="/api/subjects", tags=["Subjects"])
app.include_router(rooms.router,    prefix="/api/rooms",    tags=["Rooms"])
app.include_router(timetable.router, prefix="/api/timetable", tags=["Timetable"])


@app.get("/health")
async def health():
    return {"status": "ok"}
