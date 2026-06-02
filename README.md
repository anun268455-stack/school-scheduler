# School Timetabling System

Production-grade school scheduling system powered by **Google OR-Tools CP-SAT** (Python backend) + **React + Tailwind CSS** (frontend).

---

## Architecture

```
school-scheduler/
├── backend/                   # FastAPI + OR-Tools Python service
│   ├── app/
│   │   ├── models.py          # SQLAlchemy ORM (PostgreSQL)
│   │   ├── schemas.py         # Pydantic v2 request/response models
│   │   ├── routers/           # REST endpoints (groups, teachers, subjects, rooms, timetable)
│   │   └── solver/
│   │       └── engine.py      # ★ CP-SAT solver – all hard + soft constraints
│   └── alembic/versions/      # DB migrations
└── frontend/                  # React 18 + Tailwind CSS
    └── src/
        ├── components/
        │   ├── timetable/     # Drag-and-drop grid (dnd-kit)
        │   └── print/         # A4 landscape print + PDF export
        ├── store/             # Zustand global state
        └── pages/             # Timetable view + CRUD dashboards
```

---

## Quick Start (Docker)

```bash
# 1. Clone and start
docker compose up --build

# 2. Run DB migrations
docker compose exec backend alembic upgrade head

# 3. Open UI
#    http://localhost:5173

# 4. API docs
#    http://localhost:8000/docs
```

---

## Development (local)

### Backend
```bash
cd backend
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
# Set DATABASE_URL in .env or environment
alembic upgrade head
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Solver Constraints

### Hard (zero violations)
| Constraint | Implementation |
|---|---|
| No teacher double-booking | `AddAtMostOne` over all `starts` that occupy same `(teacher, day, period)` |
| No group double-booking | `AddAtMostOne` over all `starts` that occupy same `(group, day, period)` |
| No room double-booking | `AddAtMostOne` over all `room_vars` at same `(room, day, period)` |
| Each occurrence placed exactly once | `AddExactlyOne` over all `(day, period)` choices per occurrence |
| Parallel sub-groups share slot | `Add(sib_var == base_var)` for every valid `(day, period)` |
| Double periods consecutive | Start var occupies `period` AND `period+1`; forbidden boundary crossing |
| No scheduling in fixed periods | Break / Assembly / Lunch / Homeroom periods excluded from `valid_starts` |
| Outdoor cap | Hard `Add(sum <= MAX_OUTDOOR_SIMULTANEOUS)` per slot |

### Soft (penalty-weighted objective)
| Constraint | Weight | Strategy |
|---|---|---|
| Teacher ≤ 3 consecutive periods | 50 | Sliding 4-period window penalty |
| Prefer fixed/same-building room | 30 | Penalise non-fixed room assignment |
| Heavy subjects not back-to-back | 40 | Pairwise consecutive heavy slot penalty |
| Outdoor rooms → high outdoor_score teachers | 20 | Penalise low-score teacher in outdoor room |
| Teacher daily slot cap | 80 | Penalise exceeding `max_slots_per_day` |

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/groups/` | List student groups (with children) |
| `POST` | `/api/groups/` | Create group / parallel track |
| `GET` | `/api/teachers/` | List teachers |
| `GET` | `/api/subjects/` | List subjects |
| `GET` | `/api/rooms/` | List rooms |
| `GET` | `/api/timetable/slots` | Fetch slots (filterable by group/teacher/day) |
| `PATCH` | `/api/timetable/slots/{id}` | Move slot (syncs parallel siblings) |
| `POST` | `/api/timetable/requirements` | Create lesson requirement |
| `POST` | `/api/timetable/solve` | **Run CP-SAT solver** |

---

## Fixed School Calendar (hardcoded UI)

| Period | Time | Event |
|---|---|---|
| 0 | 08:00–08:50 | เคารพธงชาติ / โฮมรูม (ทุกวัน) |
| 4 | 11:20–11:30 | พัก 10 นาที |
| 7 | 13:10–14:00 | กินข้าว ม.1–3 |
| 8 | 13:10–14:00 | กินข้าว ม.4–6 |
| 9 | 14:00–14:50 | โฮมรูม / กิจกรรม |

Periods 1–3 and 5–6 are schedulable (6 teachable periods/day).

---

## Parallel Groups

Set the same `parallel_group_key` on all sibling `LessonRequirement` records.  
The solver forces them to land on the same `(day, period)`.  
Dragging one parallel slot in the UI auto-moves all siblings.

---

## Print & Export

- **🖨 พิมพ์** — triggers browser print via `react-to-print`. Uses `@media print` CSS to strip all UI chrome and render exactly 1 A4 landscape schedule per page.
- **📥 PDF** — renders each `.print-page` div via `html2canvas`, stitches pages into a multi-page PDF via `jsPDF`, and downloads `timetable-YYYY-MM-DD.pdf`.
