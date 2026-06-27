"""
Mock API v3 — working mock solver + bulk import + periods CRUD + bulk lock.
Run: python mock_api.py
"""
from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any
import random

app = FastAPI(title="School Scheduler Mock API v3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Data ───────────────────────────────────────────────────────────────────────
PERIODS: list[dict[str, Any]] = [
    {"id":1,  "period_num":0, "label":"เคารพธงชาติ/โฮมรูม", "start_time":"07:50","end_time":"08:30","type":"assembly","applies_to":"all"},
    {"id":2,  "period_num":1, "label":"คาบ 1",               "start_time":"08:30","end_time":"09:20","type":"class",   "applies_to":"all"},
    {"id":3,  "period_num":2, "label":"คาบ 2",               "start_time":"09:20","end_time":"10:10","type":"class",   "applies_to":"all"},
    {"id":4,  "period_num":3, "label":"คาบ 3",               "start_time":"10:10","end_time":"11:00","type":"class",   "applies_to":"all"},
    {"id":5,  "period_num":4, "label":"คาบ 4",               "start_time":"11:00","end_time":"11:50","type":"class",   "applies_to":"all"},
    {"id":6,  "period_num":5, "label":"พัก (ม.1-3)",         "start_time":"11:50","end_time":"12:00","type":"break",   "applies_to":"lower"},
    {"id":7,  "period_num":6, "label":"กินข้าว (ม.1-3)",     "start_time":"12:00","end_time":"12:50","type":"lunch",   "applies_to":"lower"},
    {"id":8,  "period_num":5, "label":"คาบ 5",               "start_time":"11:50","end_time":"12:40","type":"class",   "applies_to":"upper"},
    {"id":9,  "period_num":6, "label":"พัก (ม.4-6)",         "start_time":"12:40","end_time":"12:50","type":"break",   "applies_to":"upper"},
    {"id":10, "period_num":7, "label":"คาบ 6",               "start_time":"12:50","end_time":"13:40","type":"class",   "applies_to":"all"},
    {"id":11, "period_num":8, "label":"คาบ 7",               "start_time":"13:40","end_time":"14:30","type":"class",   "applies_to":"all"},
    {"id":12, "period_num":9, "label":"โฮมรูม/กิจกรรม",     "start_time":"14:30","end_time":"15:00","type":"homeroom","applies_to":"all"},
]

DEPARTMENTS: list[dict[str, Any]] = [
    {"id":1,"name":"กลุ่มสาระคณิตศาสตร์"},
    {"id":2,"name":"กลุ่มสาระวิทยาศาสตร์"},
    {"id":3,"name":"กลุ่มสาระภาษาต่างประเทศ"},
    {"id":4,"name":"กลุ่มสาระภาษาไทย"},
    {"id":5,"name":"กลุ่มสาระสังคมศึกษา"},
    {"id":6,"name":"กลุ่มสาระพลศึกษา"},
    {"id":7,"name":"กลุ่มสาระการงานอาชีพ"},
    {"id":8,"name":"กลุ่มสาระศิลปะ"},
]

BUILDINGS: list[dict[str, Any]] = [
    {"id":1,"name":"อาคาร 1 (หลัก)","floor_count":4},
    {"id":2,"name":"อาคาร 2 (วิทย์)","floor_count":3},
]

ROOMS: list[dict[str, Any]] = [
    {"id":1,"name":"ห้อง 101","type":"physical","building_id":1,"building_name":"อาคาร 1 (หลัก)","floor":1,"capacity":40,"specialized_dept_id":None,"reserved_teacher_id":None},
    {"id":2,"name":"ห้อง 102","type":"physical","building_id":1,"building_name":"อาคาร 1 (หลัก)","floor":1,"capacity":40,"specialized_dept_id":None,"reserved_teacher_id":None},
    {"id":3,"name":"ห้อง 201","type":"physical","building_id":1,"building_name":"อาคาร 1 (หลัก)","floor":2,"capacity":40,"specialized_dept_id":None,"reserved_teacher_id":None},
    {"id":4,"name":"ห้อง 202","type":"physical","building_id":1,"building_name":"อาคาร 1 (หลัก)","floor":2,"capacity":40,"specialized_dept_id":None,"reserved_teacher_id":None},
    {"id":5,"name":"ห้องวิทย์ 1","type":"special","building_id":2,"building_name":"อาคาร 2 (วิทย์)","floor":1,"capacity":35,"specialized_dept_id":2,"reserved_teacher_id":3},
    {"id":6,"name":"ห้องคอมพิวเตอร์","type":"special","building_id":2,"building_name":"อาคาร 2 (วิทย์)","floor":2,"capacity":30,"specialized_dept_id":None,"reserved_teacher_id":5},
    {"id":7,"name":"ลานนนทฯ 1","type":"outdoor","building_id":None,"building_name":None,"floor":1,"capacity":80,"specialized_dept_id":None,"reserved_teacher_id":None},
    {"id":8,"name":"สนามกีฬา","type":"outdoor","building_id":None,"building_name":None,"floor":1,"capacity":120,"specialized_dept_id":None,"reserved_teacher_id":None},
]

GROUPS: list[dict[str, Any]] = [
    {"id":1,"name":"ม.1/1","parent_id":None,"level":"M1","size":40,"homeroom_room_id":None,"children":[]},
    {"id":2,"name":"ม.1/2","parent_id":None,"level":"M1","size":40,"homeroom_room_id":None,"children":[]},
    {"id":3,"name":"ม.2/1","parent_id":None,"level":"M2","size":42,"homeroom_room_id":None,"children":[]},
    {"id":4,"name":"ม.3/1","parent_id":None,"level":"M3","size":38,"homeroom_room_id":None,"children":[]},
    {"id":5,"name":"ม.4/1","parent_id":None,"level":"M4","size":35,"homeroom_room_id":None,"children":[
        {"id":6,"name":"ม.4/1 ก","parent_id":5,"level":"M4","size":12,"homeroom_room_id":None,"children":[]},
        {"id":7,"name":"ม.4/1 ข","parent_id":5,"level":"M4","size":12,"homeroom_room_id":None,"children":[]},
        {"id":8,"name":"ม.4/1 ค","parent_id":5,"level":"M4","size":11,"homeroom_room_id":None,"children":[]},
    ]},
]

TEACHERS: list[dict[str, Any]] = [
    {"id":1,"name":"ครูสมชาย ใจดี",     "fixed_room_id":1, "department_id":1,"outdoor_score":3, "max_slots_per_day":6,"max_outdoor_per_week":1},
    {"id":2,"name":"ครูสมหญิง ขยัน",     "fixed_room_id":2, "department_id":3,"outdoor_score":4, "max_slots_per_day":5,"max_outdoor_per_week":2},
    {"id":3,"name":"ครูวิทยา ฉลาด",      "fixed_room_id":5, "department_id":2,"outdoor_score":6, "max_slots_per_day":6,"max_outdoor_per_week":2},
    {"id":4,"name":"ครูพลศึกษา แข็งแรง", "fixed_room_id":None,"department_id":6,"outdoor_score":10,"max_slots_per_day":8,"max_outdoor_per_week":10},
    {"id":5,"name":"ครูคอมพ์ เก่ง",      "fixed_room_id":6, "department_id":7,"outdoor_score":2, "max_slots_per_day":6,"max_outdoor_per_week":0},
    {"id":6,"name":"ครูภาษาไทย ดี",      "fixed_room_id":3, "department_id":4,"outdoor_score":5, "max_slots_per_day":6,"max_outdoor_per_week":1},
    {"id":7,"name":"ครูพลศึกษา มั่นคง",  "fixed_room_id":None,"department_id":6,"outdoor_score":9,"max_slots_per_day":8,"max_outdoor_per_week":10},
]

SUBJECTS: list[dict[str, Any]] = [
    {"id":1,"code":"MATH101","name":"คณิตศาสตร์", "type":"common",  "duration":1,"department_id":1,"is_activity":False},
    {"id":2,"code":"SCI101", "name":"วิทยาศาสตร์","type":"common",  "duration":1,"department_id":2,"is_activity":False},
    {"id":3,"code":"ENG101", "name":"ภาษาอังกฤษ", "type":"common",  "duration":1,"department_id":3,"is_activity":False},
    {"id":4,"code":"THAI101","name":"ภาษาไทย",     "type":"common",  "duration":1,"department_id":4,"is_activity":False},
    {"id":5,"code":"SOC101", "name":"สังคมศึกษา", "type":"common",  "duration":1,"department_id":5,"is_activity":False},
    {"id":6,"code":"PE101",  "name":"พลศึกษา",     "type":"parallel","duration":2,"department_id":6,"is_activity":False},
    {"id":7,"code":"COM101", "name":"คอมพิวเตอร์", "type":"parallel","duration":1,"department_id":7,"is_activity":False},
    {"id":8,"code":"ART101", "name":"ศิลปะ",        "type":"common",  "duration":1,"department_id":8,"is_activity":False},
    {"id":9,"code":"ACT001", "name":"ชุมนุม",       "type":"common",  "duration":1,"department_id":None,"is_activity":True},
    {"id":10,"code":"ACT002","name":"ลูกเสือ/ยุวกาชาด","type":"common","duration":1,"department_id":None,"is_activity":True},
]

REQUIREMENTS: list[dict[str, Any]] = [
    {"id":1,"group_id":1,"subject_id":1,"teacher_id":1,"weekly_count":3,"parallel_group_key":None},
    {"id":2,"group_id":1,"subject_id":2,"teacher_id":3,"weekly_count":2,"parallel_group_key":None},
    {"id":3,"group_id":1,"subject_id":3,"teacher_id":2,"weekly_count":3,"parallel_group_key":None},
    {"id":4,"group_id":1,"subject_id":4,"teacher_id":6,"weekly_count":2,"parallel_group_key":None},
    {"id":5,"group_id":1,"subject_id":6,"teacher_id":4,"weekly_count":2,"parallel_group_key":"PE-M1-001"},
    {"id":6,"group_id":2,"subject_id":6,"teacher_id":7,"weekly_count":2,"parallel_group_key":"PE-M1-001"},
    {"id":7,"group_id":1,"subject_id":7,"teacher_id":5,"weekly_count":1,"parallel_group_key":None},
    {"id":8,"group_id":1,"subject_id":8,"teacher_id":6,"weekly_count":1,"parallel_group_key":None},
]

SLOTS: list[dict[str, Any]] = []

# ── Sequential ID counters ─────────────────────────────────────────────────────
_counters: dict[str, int] = {
    "period": max(p["id"] for p in PERIODS),
    "room": max(r["id"] for r in ROOMS),
    "department": max(d["id"] for d in DEPARTMENTS),
    "group": 8, "teacher": 7, "subject": 10,
    "requirement": max(r["id"] for r in REQUIREMENTS),
    "slot": 0,
    "elective_option": 0,
}
def _next(key: str) -> int:
    _counters[key] += 1
    return _counters[key]


# ── Greedy Mock Solver ─────────────────────────────────────────────────────────
def _run_solver(body: dict[str, Any]) -> dict[str, Any]:
    global SLOTS
    clear      = body.get("clear_existing", True)
    locked_ids = set(body.get("locked_slot_ids", []))

    # Keep only locked slots when clearing — elective slots always survive,
    # regardless of is_locked, so the solver never double-books their teacher/room.
    if clear:
        SLOTS = [s for s in SLOTS if s["id"] in locked_ids or s.get("is_locked") or s.get("is_elective")]

    # Build occupation sets
    teacher_busy: set[tuple] = set()
    group_busy:   set[tuple] = set()
    room_busy:    set[tuple] = set()
    for s in SLOTS:
        teacher_busy.add((s["teacher_id"], s["day"], s["period"]))
        group_busy.add((s["group_id"],   s["day"], s["period"]))
        if s.get("room_id"):
            room_busy.add((s["room_id"], s["day"], s["period"]))

    class_periods = sorted({p["period_num"] for p in PERIODS if p["type"] == "class"})
    all_cells     = [(d, p) for d in range(5) for p in class_periods]

    t_map = {t["id"]: t for t in TEACHERS}
    g_map = {g["id"]: g for g in _flat_groups()}
    s_map = {s["id"]: s for s in SUBJECTS}
    r_map = {r["id"]: r for r in ROOMS}

    created    = 0
    violations = []

    def find_room(teacher_id: int, day: int, period: int):
        t  = t_map.get(teacher_id, {})
        fr = t.get("fixed_room_id")
        if fr and (fr, day, period) not in room_busy:
            r = r_map.get(fr)
            if r:
                return fr, r["name"], r["type"]
        for r in ROOMS:
            if (r["id"], day, period) not in room_busy:
                return r["id"], r["name"], r["type"]
        return None, None, None

    def make_slot(req: dict, day: int, period: int) -> dict:
        rid, rname, rtype = find_room(req["teacher_id"], day, period)
        subj    = s_map.get(req["subject_id"], {})
        teacher = t_map.get(req["teacher_id"], {})
        group   = g_map.get(req["group_id"],   {})
        slot    = {
            "id": _next("slot"),
            "day": day, "period": period,
            "teacher_id": req["teacher_id"],
            "group_id":   req["group_id"],
            "room_id":    rid,
            "subject_id": req["subject_id"],
            "is_double_start":    False,
            "parallel_group_key": req.get("parallel_group_key"),
            "is_locked":   False,
            "teacher_name": teacher.get("name"),
            "group_name":   group.get("name"),
            "room_name":    rname,
            "room_type":    rtype,
            "subject_name": subj.get("name"),
            "subject_code": subj.get("code"),
        }
        if rid:
            room_busy.add((rid, day, period))
        return slot

    # Separate parallel vs solo
    parallel: dict[str, list] = {}
    solo: list[dict] = []
    for req in REQUIREMENTS:
        pgk = req.get("parallel_group_key")
        if pgk:
            parallel.setdefault(pgk, []).append(req)
        else:
            solo.append(req)

    # ── Place solo requirements ──
    for req in solo:
        gid, tid = req["group_id"], req["teacher_id"]
        already  = sum(1 for s in SLOTS
                       if s["group_id"] == gid and s["subject_id"] == req["subject_id"])
        needed   = max(0, req["weekly_count"] - already)
        cells    = list(all_cells)
        random.shuffle(cells)
        placed   = 0
        for day, period in cells:
            if placed >= needed:
                break
            if (tid, day, period) in teacher_busy:
                continue
            if (gid, day, period) in group_busy:
                continue
            slot = make_slot(req, day, period)
            SLOTS.append(slot)
            teacher_busy.add((tid, day, period))
            group_busy.add((gid, day, period))
            placed  += 1
            created += 1
        if placed < needed:
            code = s_map.get(req["subject_id"], {}).get("code", "?")
            violations.append(
                f"ไม่สามารถจัด {code} ครบ {req['weekly_count']} คาบ "
                f"(จัดได้ {placed + already}/{req['weekly_count']})"
            )

    # ── Place parallel groups (all siblings share same day+period) ──
    for pgk, reqs in parallel.items():
        # Use max weekly_count across all siblings (most conservative)
        max_weekly = max(r["weekly_count"] for r in reqs)
        already    = sum(1 for s in SLOTS if s.get("parallel_group_key") == pgk) // max(len(reqs), 1)
        needed     = max(0, max_weekly - already)

        # Detect same-teacher assignment (warn but still try)
        teacher_ids = [r["teacher_id"] for r in reqs]
        if len(set(teacher_ids)) < len(teacher_ids):
            violations.append(
                f"[{pgk}] ครูคนเดียวสอนหลายห้องพร้อมกันไม่ได้ "
                f"กรุณาตั้งครูคนละคนสำหรับแต่ละห้อง"
            )

        cells  = list(all_cells)
        random.shuffle(cells)
        placed = 0
        for day, period in cells:
            if placed >= needed:
                break
            # Check ALL sibling teachers AND groups are free
            conflict = False
            for r in reqs:
                if (r["teacher_id"], day, period) in teacher_busy:
                    conflict = True; break
                if (r["group_id"], day, period) in group_busy:
                    conflict = True; break
            if conflict:
                continue

            # Place all siblings at this (day, period)
            for req in reqs:
                slot = make_slot(req, day, period)
                SLOTS.append(slot)
                teacher_busy.add((req["teacher_id"], day, period))
                group_busy.add((req["group_id"],   day, period))
                created += 1
            placed += 1

        if placed < needed:
            violations.append(
                f"[{pgk}] วิชาคู่ขนานจัดได้ {placed}/{needed} คาบ "
                f"(ห้อง: {', '.join(str(r['group_id']) for r in reqs)})"
            )

    status = "FEASIBLE" if not violations else "INFEASIBLE"
    return {
        "status": status,
        "slots_created": created,
        "solve_time_seconds": round(len(REQUIREMENTS) * 0.12 + random.uniform(0.1, 0.5), 2),
        "objective_value": float(created * 10),
        "violations": violations,
    }


def _flat_groups() -> list[dict]:
    """Flatten nested GROUPS (including children)."""
    result = []
    def _walk(groups: list):
        for g in groups:
            result.append(g)
            _walk(g.get("children", []))
    _walk(GROUPS)
    return result


# ══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════════════════════

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "version": "3.0"}

# ── Periods CRUD ──────────────────────────────────────────────────────────────
@app.get("/api/periods/")
def get_periods():
    return PERIODS

@app.post("/api/periods/")
def create_period(body: dict[str, Any]):
    body["id"] = _next("period")
    PERIODS.append(body)
    return body

@app.put("/api/periods/{pid}")
def update_period(pid: int, body: dict[str, Any]):
    for p in PERIODS:
        if p["id"] == pid:
            p.update(body)
            return p
    raise HTTPException(404, "Period not found")

@app.delete("/api/periods/{pid}")
def delete_period(pid: int):
    global PERIODS
    PERIODS = [p for p in PERIODS if p["id"] != pid]
    return {}

# ── Buildings & Rooms ─────────────────────────────────────────────────────────
@app.get("/api/rooms/buildings")
def get_buildings():
    return BUILDINGS

@app.post("/api/rooms/buildings")
def create_building(body: dict[str, Any]):
    body["id"] = max((b["id"] for b in BUILDINGS), default=0) + 1
    BUILDINGS.append(body)
    return body

@app.get("/api/rooms/")
def get_rooms():
    return ROOMS

@app.post("/api/rooms/")
def create_room(body: dict[str, Any]):
    body["id"] = _next("room")
    ROOMS.append(body)
    return body

@app.put("/api/rooms/{i}")
def update_room(i: int, body: dict[str, Any]):
    for r in ROOMS:
        if r["id"] == i:
            r.update(body)
            return r
    return {}

@app.delete("/api/rooms/{i}")
def del_room(i: int):
    global ROOMS
    ROOMS = [r for r in ROOMS if r["id"] != i]
    return {}

@app.post("/api/rooms/bulk")
def bulk_create_rooms(body: list[dict[str, Any]]):
    created = []
    for row in body:
        row["id"] = _next("room")
        row.setdefault("building_name", None)
        row.setdefault("specialized_dept_id", None)
        row.setdefault("reserved_teacher_id", None)
        ROOMS.append(row)
        created.append(row)
    return created

# ── Departments ──────────────────────────────────────────────────────────────
@app.get("/api/departments/")
def get_departments():
    return DEPARTMENTS

@app.post("/api/departments/")
def create_department(body: dict[str, Any]):
    body["id"] = _next("department")
    DEPARTMENTS.append(body)
    return body

@app.put("/api/departments/{i}")
def update_department(i: int, body: dict[str, Any]):
    for d in DEPARTMENTS:
        if d["id"] == i:
            d.update(body)
            return d
    raise HTTPException(404)

@app.delete("/api/departments/{i}")
def del_department(i: int):
    global DEPARTMENTS
    DEPARTMENTS = [d for d in DEPARTMENTS if d["id"] != i]
    return {}

# ── Groups ────────────────────────────────────────────────────────────────────
@app.get("/api/groups/")
def get_groups():
    return GROUPS

@app.post("/api/groups/")
def create_group(body: dict[str, Any]):
    body["id"] = _next("group")
    body.setdefault("children", [])
    body.setdefault("homeroom_room_id", None)
    GROUPS.append(body)
    return body

@app.put("/api/groups/{i}")
def update_group(i: int, body: dict[str, Any]):
    for g in _flat_groups():
        if g["id"] == i:
            g.update(body)
            return g
    return {}

@app.delete("/api/groups/{i}")
def del_group(i: int):
    global GROUPS
    GROUPS = [g for g in GROUPS if g["id"] != i]
    return {}

@app.post("/api/groups/bulk")
def bulk_create_groups(body: list[dict[str, Any]]):
    created = []
    for row in body:
        row["id"] = _next("group")
        row.setdefault("children", [])
        row.setdefault("parent_id", None)
        GROUPS.append(row)
        created.append(row)
    return created

# ── Teachers ──────────────────────────────────────────────────────────────────
@app.get("/api/teachers/")
def get_teachers():
    return TEACHERS

@app.post("/api/teachers/")
def create_teacher(body: dict[str, Any]):
    body["id"] = _next("teacher")
    TEACHERS.append(body)
    return body

@app.put("/api/teachers/{i}")
def update_teacher(i: int, body: dict[str, Any]):
    for t in TEACHERS:
        if t["id"] == i:
            t.update(body)
            return t
    return {}

@app.delete("/api/teachers/{i}")
def del_teacher(i: int):
    global TEACHERS
    TEACHERS = [t for t in TEACHERS if t["id"] != i]
    return {}

@app.post("/api/teachers/bulk")
def bulk_create_teachers(body: list[dict[str, Any]]):
    created = []
    for row in body:
        row["id"] = _next("teacher")
        row.setdefault("fixed_room_id", None)
        row.setdefault("outdoor_score", 5)
        row.setdefault("max_slots_per_day", 6)
        row.setdefault("max_outdoor_per_week", 2)
        TEACHERS.append(row)
        created.append(row)
    return created

# ── Subjects ──────────────────────────────────────────────────────────────────
@app.get("/api/subjects/")
def get_subjects():
    return SUBJECTS

@app.post("/api/subjects/")
def create_subject(body: dict[str, Any]):
    body["id"] = _next("subject")
    SUBJECTS.append(body)
    return body

@app.put("/api/subjects/{i}")
def update_subject(i: int, body: dict[str, Any]):
    for s in SUBJECTS:
        if s["id"] == i:
            s.update(body)
            return s
    return {}

@app.delete("/api/subjects/{i}")
def del_subject(i: int):
    global SUBJECTS
    SUBJECTS = [s for s in SUBJECTS if s["id"] != i]
    return {}

@app.post("/api/subjects/bulk")
def bulk_create_subjects(body: list[dict[str, Any]]):
    created = []
    for row in body:
        row["id"] = _next("subject")
        row.setdefault("type", "common")
        row.setdefault("duration", 1)
        SUBJECTS.append(row)
        created.append(row)
    return created

# ── Requirements ──────────────────────────────────────────────────────────────
@app.get("/api/timetable/requirements")
def get_requirements(group_id: int | None = None):
    if group_id:
        return [r for r in REQUIREMENTS if r["group_id"] == group_id]
    return REQUIREMENTS

@app.post("/api/timetable/requirements")
def create_req(body: dict[str, Any]):
    body["id"] = _next("requirement")
    REQUIREMENTS.append(body)
    return body

@app.delete("/api/timetable/requirements/{i}")
def del_req(i: int):
    global REQUIREMENTS
    REQUIREMENTS = [r for r in REQUIREMENTS if r["id"] != i]
    return {}

# ── Timetable Slots ───────────────────────────────────────────────────────────
@app.get("/api/timetable/slots")
def get_slots(group_id: int | None = None, teacher_id: int | None = None,
              day: int | None = None, room_id: int | None = None):
    result = list(SLOTS)
    if group_id   is not None: result = [s for s in result if s["group_id"]   == group_id]
    if teacher_id is not None: result = [s for s in result if s["teacher_id"] == teacher_id]
    if day        is not None: result = [s for s in result if s["day"]        == day]
    if room_id    is not None: result = [s for s in result if s["room_id"]    == room_id]
    return result

@app.post("/api/timetable/slots")
def create_slot(body: dict[str, Any]):
    body["id"] = _next("slot")
    SLOTS.append(body)
    return body

def _enrich_slot(s: dict[str, Any]) -> dict[str, Any]:
    """Re-derive display fields (name/type lookups) from current id fields."""
    t_map = {t["id"]: t for t in TEACHERS}
    g_map = {g["id"]: g for g in _flat_groups()}
    s_map = {sub["id"]: sub for sub in SUBJECTS}
    r_map = {r["id"]: r for r in ROOMS}
    teacher = t_map.get(s.get("teacher_id"), {})
    group   = g_map.get(s.get("group_id"), {})
    subj    = s_map.get(s.get("subject_id"), {})
    room    = r_map.get(s.get("room_id")) if s.get("room_id") else None
    s["teacher_name"] = teacher.get("name")
    s["group_name"]   = group.get("name")
    s["subject_name"] = subj.get("name")
    s["subject_code"] = subj.get("code")
    s["room_name"]    = room.get("name") if room else None
    s["room_type"]    = room.get("type") if room else None
    return s

# ── Elective Slots (วิชาเสรี) ────────────────────────────────────────────────
# An elective slot is a TimetableSlot pinned to one classroom/day/period with
# is_elective=True. It carries a catalog of "elective_options" (each a
# subject+teacher+label choice) plus a "selected_option_id" pointing at the
# option currently shown on the timetable. Always treated as occupied by the
# solver, regardless of is_locked.

def _apply_selected_option(s: dict[str, Any]) -> dict[str, Any]:
    opt = next((o for o in s.get("elective_options", []) if o["id"] == s.get("selected_option_id")), None)
    if opt:
        s["subject_id"] = opt["subject_id"]
        s["teacher_id"] = opt["teacher_id"]
    return _enrich_slot(s)

@app.post("/api/timetable/elective-slots")
def create_elective_slot(body: dict[str, Any]):
    option = {
        "id": _next("elective_option"),
        "subject_id": body["subject_id"],
        "teacher_id": body["teacher_id"],
        "label": body.get("label") or "วงที่ 1",
    }
    slot = {
        "id": _next("slot"),
        "day": body["day"], "period": body["period"],
        "group_id": body["group_id"],
        "room_id": body.get("room_id"),
        "is_double_start": False,
        "parallel_group_key": None,
        "is_locked": True,
        "is_elective": True,
        "elective_options": [option],
        "selected_option_id": option["id"],
        "subject_id": option["subject_id"],
        "teacher_id": option["teacher_id"],
    }
    SLOTS.append(slot)
    return _apply_selected_option(slot)

@app.post("/api/timetable/elective-slots/{slot_id}/options")
def add_elective_option(slot_id: int, body: dict[str, Any]):
    slot = next((s for s in SLOTS if s["id"] == slot_id and s.get("is_elective")), None)
    if not slot:
        raise HTTPException(404, "Elective slot not found")
    option = {
        "id": _next("elective_option"),
        "subject_id": body["subject_id"],
        "teacher_id": body["teacher_id"],
        "label": body.get("label") or f"วงที่ {len(slot['elective_options']) + 1}",
    }
    slot["elective_options"].append(option)
    return _enrich_slot(slot)

@app.delete("/api/timetable/elective-slots/{slot_id}/options/{option_id}")
def delete_elective_option(slot_id: int, option_id: int):
    slot = next((s for s in SLOTS if s["id"] == slot_id and s.get("is_elective")), None)
    if not slot:
        raise HTTPException(404, "Elective slot not found")
    if len(slot["elective_options"]) <= 1:
        raise HTTPException(400, "ต้องมีอย่างน้อย 1 วงเสมอ")
    slot["elective_options"] = [o for o in slot["elective_options"] if o["id"] != option_id]
    if slot["selected_option_id"] == option_id:
        slot["selected_option_id"] = slot["elective_options"][0]["id"]
    return _apply_selected_option(slot)

@app.patch("/api/timetable/elective-slots/{slot_id}/select")
def select_elective_option(slot_id: int, body: dict[str, Any]):
    slot = next((s for s in SLOTS if s["id"] == slot_id and s.get("is_elective")), None)
    if not slot:
        raise HTTPException(404, "Elective slot not found")
    option_id = body["option_id"]
    if not any(o["id"] == option_id for o in slot["elective_options"]):
        raise HTTPException(404, "Option not found")
    slot["selected_option_id"] = option_id
    return _apply_selected_option(slot)

@app.post("/api/timetable/elective-slots/{slot_id}/copy")
def copy_elective_slot(slot_id: int, body: dict[str, Any]):
    src = next((s for s in SLOTS if s["id"] == slot_id and s.get("is_elective")), None)
    if not src:
        raise HTTPException(404, "Elective slot not found")
    created = []
    for target_group_id in body.get("target_group_ids", []):
        id_map: dict[int, int] = {}
        new_options = []
        for o in src["elective_options"]:
            new_id = _next("elective_option")
            id_map[o["id"]] = new_id
            new_options.append({**o, "id": new_id})
        new_slot = {
            **src,
            "id": _next("slot"),
            "group_id": target_group_id,
            "elective_options": new_options,
            "selected_option_id": id_map[src["selected_option_id"]],
        }
        SLOTS.append(new_slot)
        created.append(_apply_selected_option(new_slot))
    return created

@app.patch("/api/timetable/slots/{slot_id}")
def patch_slot(slot_id: int, body: dict[str, Any]):
    for s in SLOTS:
        if s["id"] == slot_id:
            old_day, old_period = s["day"], s["period"]
            pgk = s.get("parallel_group_key")
            if ("day" in body or "period" in body) and pgk:
                for sib in SLOTS:
                    if (sib.get("parallel_group_key") == pgk and sib["id"] != slot_id
                            and sib["day"] == old_day and sib["period"] == old_period):
                        sib.update({k: v for k, v in body.items() if k in ("day", "period")})
            s.update(body)
            return _enrich_slot(s)
    return {}

@app.delete("/api/timetable/slots/{slot_id}")
def delete_slot(slot_id: int):
    global SLOTS
    SLOTS = [s for s in SLOTS if s["id"] != slot_id]
    return {}

@app.delete("/api/timetable/slots")
def clear_slots():
    global SLOTS
    SLOTS = [s for s in SLOTS if s.get("is_locked")]
    return {}

# Bulk lock/unlock by filter criteria
@app.post("/api/timetable/slots/bulk-lock")
def bulk_lock(body: dict[str, Any]):
    """
    body: { is_locked: bool, filters: { group_level?, day?, period?, subject_id? } }
    Applies is_locked to all matching slots.
    """
    is_locked = body.get("is_locked", True)
    filters   = body.get("filters", {})

    level_groups: set[int] = set()
    if filters.get("group_level"):
        lvl = filters["group_level"]
        level_groups = {g["id"] for g in _flat_groups() if g.get("level") == lvl}

    affected = 0
    for s in SLOTS:
        if filters.get("group_level") and s["group_id"] not in level_groups:
            continue
        if filters.get("day") is not None and s["day"] != filters["day"]:
            continue
        if filters.get("period") is not None and s["period"] != filters["period"]:
            continue
        if filters.get("subject_id") and s["subject_id"] != filters["subject_id"]:
            continue
        s["is_locked"] = is_locked
        affected += 1
    return {"affected": affected}

# ── Solver ────────────────────────────────────────────────────────────────────
@app.post("/api/timetable/solve")
def solve(body: dict[str, Any] = {}):
    return _run_solver(body)

# ── Conflict analysis ─────────────────────────────────────────────────────────
@app.get("/api/timetable/conflict")
def analyze_conflict(slot_id: int, target_day: int, target_period: int):
    slot = next((s for s in SLOTS if s["id"] == slot_id), None)
    if not slot:
        return {"level": "red", "cascades": 0, "reason": "ไม่พบคาบ"}
    period_def = next((p for p in PERIODS if p["period_num"] == target_period), None)
    if not period_def or period_def["type"] != "class":
        label = period_def["label"] if period_def else "?"
        return {"level": "fixed", "cascades": 0, "reason": f"{label} – จัดไม่ได้"}
    at_target = [s for s in SLOTS
                 if s["day"] == target_day and s["period"] == target_period and s["id"] != slot_id]
    if any(s["group_id"]   == slot["group_id"]   for s in at_target):
        return {"level": "red",   "cascades": 0, "reason": "ห้องซ้อนกัน"}
    if any(s["teacher_id"] == slot["teacher_id"] for s in at_target):
        return {"level": "red",   "cascades": 0, "reason": "ครูสอนอยู่แล้ว"}
    if any(s.get("is_locked") for s in at_target):
        return {"level": "red",   "cascades": 0, "reason": "มีคาบล็อก"}
    if not at_target:
        return {"level": "green", "cascades": 0, "reason": "ว่าง – วางได้ทันที"}
    n = len(at_target)
    if n <= 4:
        return {"level": "yellow", "cascades": n, "reason": f"ต้องสลับ {n} คาบ"}
    return {"level": "red", "cascades": n, "reason": f"สลับมากเกิน ({n})"}


if __name__ == "__main__":
    import os, uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
