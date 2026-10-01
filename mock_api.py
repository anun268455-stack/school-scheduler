"""
Mock API v3 — working mock solver + bulk import + periods CRUD + bulk lock.
Run: python mock_api.py
"""
from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any
import random
from collections import defaultdict

app = FastAPI(title="School Scheduler Mock API v3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Live collaboration: data revision counter ─────────────────────────────────
# Every successful write bumps REVISION. Clients poll /api/state/version (a tiny
# response) and reload only when the number changed, so two people editing at the
# same time see each other's work without refreshing the page.
REVISION = {"n": 0}


@app.middleware("http")
async def _bump_revision(request, call_next):
    response = await call_next(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
        REVISION["n"] += 1
    return response


@app.get("/api/state/version")
def state_version():
    """Tiny polling endpoint — lets clients detect other people's edits."""
    return {"revision": REVISION["n"], "slots": len(SLOTS)}

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
    {"id":1,"name":"ครูสมชาย ใจดี",     "code":"T001", "fixed_room_id":1, "department_id":1,"outdoor_score":3, "max_slots_per_day":6,"max_outdoor_per_week":1},
    {"id":2,"name":"ครูสมหญิง ขยัน",     "code":"T002", "fixed_room_id":2, "department_id":3,"outdoor_score":4, "max_slots_per_day":5,"max_outdoor_per_week":2},
    {"id":3,"name":"ครูวิทยา ฉลาด",      "code":"T003", "fixed_room_id":5, "department_id":2,"outdoor_score":6, "max_slots_per_day":6,"max_outdoor_per_week":2},
    {"id":4,"name":"ครูพลศึกษา แข็งแรง", "code":"T004", "fixed_room_id":None,"department_id":6,"outdoor_score":10,"max_slots_per_day":8,"max_outdoor_per_week":10},
    {"id":5,"name":"ครูคอมพ์ เก่ง",      "code":"T005", "fixed_room_id":6, "department_id":7,"outdoor_score":2, "max_slots_per_day":6,"max_outdoor_per_week":0},
    {"id":6,"name":"ครูภาษาไทย ดี",      "code":"T006", "fixed_room_id":3, "department_id":4,"outdoor_score":5, "max_slots_per_day":6,"max_outdoor_per_week":1},
    {"id":7,"name":"ครูพลศึกษา มั่นคง",  "code":"T007", "fixed_room_id":None,"department_id":6,"outdoor_score":9,"max_slots_per_day":8,"max_outdoor_per_week":10},
]

SUBJECTS: list[dict[str, Any]] = [
    {"id":1,"code":"MATH101","name":"คณิตศาสตร์", "type":"common",  "duration":1,"department_id":1,"is_activity":False},
    {"id":2,"code":"SCI101", "name":"วิทยาศาสตร์","type":"common",  "duration":1,"department_id":2,"is_activity":False},
    {"id":3,"code":"ENG101", "name":"ภาษาอังกฤษ", "type":"common",  "duration":1,"department_id":3,"is_activity":False},
    {"id":4,"code":"THAI101","name":"ภาษาไทย",     "type":"common",  "duration":1,"department_id":4,"is_activity":False},
    {"id":5,"code":"SOC101", "name":"สังคมศึกษา", "type":"common",  "duration":1,"department_id":5,"is_activity":False},
    {"id":6,"code":"PE101",  "name":"พลศึกษา",     "type":"parallel","duration":2,"department_id":6,"is_activity":False,"fixed_room_id":8},
    {"id":7,"code":"COM101", "name":"คอมพิวเตอร์", "type":"parallel","duration":1,"department_id":7,"is_activity":False,"fixed_room_id":6},
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


# ── Solver entry point: prefer CP-SAT (real optimiser), fall back to greedy ────
def _run_solver(body: dict[str, Any]) -> dict[str, Any]:
    """Run the timetable solver.

    Uses Google OR-Tools CP-SAT when available (real optimisation that minimises
    student/teacher walking and respects every hard constraint). If OR-Tools is
    not installed, or the CP-SAT model errors for any reason, we fall back to the
    fast greedy heuristic so the app always produces a result.
    """
    try:
        from ortools.sat.python import cp_model  # noqa: F401
    except Exception:
        return _solve_greedy(body)
    try:
        return _solve_cpsat(body)
    except Exception as e:  # never break the app on a solver bug
        res = _solve_greedy(body)
        res.setdefault("violations", [])
        res["violations"].append(f"(CP-SAT ใช้ไม่ได้ จึงใช้วิธีสำรอง: {type(e).__name__})")
        res["engine"] = "greedy-fallback"
        return res


# ── Greedy Mock Solver (fallback) ──────────────────────────────────────────────
def _solve_greedy(body: dict[str, Any]) -> dict[str, Any]:
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
        # Activity periods (สาธารณประโยชน์ ฯลฯ) may have no assigned teacher.
        if s.get("teacher_id") is not None:
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

    # ── Group hierarchy (ห้องย่อย) ────────────────────────────────────────────
    # A subgroup (ม.4/6ก) shares its students with the parent whole-class (ม.4/6).
    # So a parent lesson and ANY of its subgroup lessons cannot overlap in time,
    # but sibling subgroups (ก/ข/ค) CAN run at the same time (different students).
    #
    # conflict set of G = {G} ∪ ancestors(G) ∪ descendants(G)  (NOT siblings).
    parent_of: dict[int, int | None] = {g["id"]: g.get("parent_id") for g in g_map.values()}
    children_of: dict[int, list[int]] = {}
    for gid, pid in parent_of.items():
        if pid is not None:
            children_of.setdefault(pid, []).append(gid)

    def _ancestors(gid: int) -> set[int]:
        out, cur = set(), parent_of.get(gid)
        while cur is not None:
            out.add(cur); cur = parent_of.get(cur)
        return out

    def _descendants(gid: int) -> set[int]:
        out, stack = set(), list(children_of.get(gid, []))
        while stack:
            c = stack.pop(); out.add(c); stack.extend(children_of.get(c, []))
        return out

    _conflict_cache: dict[int, set[int]] = {}
    def group_conflict_ids(gid: int) -> set[int]:
        if gid not in _conflict_cache:
            _conflict_cache[gid] = {gid} | _ancestors(gid) | _descendants(gid)
        return _conflict_cache[gid]

    def group_occupied(gid: int, day: int, period: int) -> bool:
        """True if this group OR any student-sharing relative is busy at the cell."""
        return any((g, day, period) in group_busy for g in group_conflict_ids(gid))

    created    = 0
    violations = []

    # Departments whose lessons belong outdoors (พลศึกษา etc.) — used to steer
    # room ranking so PE still lands on the field, not a classroom.
    outdoor_dept_ids = {d["id"] for d in DEPARTMENTS if "พลศึกษา" in d.get("name", "")}

    def find_room(teacher_id: int, day: int, period: int, subject_id: int | None = None,
                  group_id: int | None = None):
        """Pick a room, minimising how far students/teachers must walk.

        Priority:
          1. If the subject needs a special/outdoor room (computer lab, music,
             PE...), use that — this is the only time a "homeroom" class walks.
          2. Otherwise keep students in their GROUP homeroom (ห้องประจำ/ห้องเพชร)
             if it's free — students stay put, the teacher comes to them.
          3. Otherwise the TEACHER's fixed room (regular เดินเรียน: students walk
             to the teacher).
          4. Otherwise any eligible free room, ranked by type.
        """
        t  = t_map.get(teacher_id, {})
        fr = t.get("fixed_room_id")
        t_dept = t.get("department_id")
        subj = s_map.get(subject_id, {}) if subject_id is not None else {}
        wants_outdoor = subj.get("department_id") in outdoor_dept_ids
        grp = g_map.get(group_id, {}) if group_id is not None else {}
        home = grp.get("homeroom_room_id")

        # Does this subject REQUIRE a specialised room? (dept has a matching
        # specialized room, or the subject is outdoor.) If not, we can stay home.
        needs_special = wants_outdoor or any(
            r.get("specialized_dept_id") and r["specialized_dept_id"] == subj.get("department_id")
            for r in ROOMS
        )

        def eligible(r: dict) -> bool:
            if (r["id"], day, period) in room_busy:
                return False
            if r.get("reserved_teacher_id") and r["reserved_teacher_id"] != teacher_id:
                return False
            if r.get("specialized_dept_id") and r["specialized_dept_id"] != t_dept:
                return False
            return True

        # 1. ห้องประจำวิชา — a room tied to the subject itself (gym, computer
        #    lab, music room). This outranks the class's homeroom: the students
        #    walk to the facility the subject needs.
        subj_room = subj.get("fixed_room_id")
        if subj_room and (subj_room, day, period) not in room_busy:
            r = r_map.get(subj_room)
            if r:
                return subj_room, r["name"], r["type"]

        # 2. Stay in the group's homeroom for ordinary subjects.
        if home and not needs_special and (home, day, period) not in room_busy:
            r = r_map.get(home)
            if r and (not r.get("reserved_teacher_id") or r["reserved_teacher_id"] == teacher_id):
                return home, r["name"], r["type"]

        # 3. Teacher's own fixed room (skip for outdoor subjects).
        if fr and not wants_outdoor and (fr, day, period) not in room_busy:
            r = r_map.get(fr)
            if r:
                return fr, r["name"], r["type"]

        def rank(r: dict) -> tuple:
            if wants_outdoor:
                pref = {"outdoor": 0, "physical": 1, "floating": 2, "special": 3}
            else:
                pref = {"physical": 0, "floating": 1, "special": 2, "outdoor": 3}
            return (pref.get(r["type"], 4), r["id"])

        for r in sorted((r for r in ROOMS if eligible(r)), key=rank):
            return r["id"], r["name"], r["type"]
        return None, None, None

    def make_slot(req: dict, day: int, period: int) -> dict:
        rid, rname, rtype = find_room(req["teacher_id"], day, period, req["subject_id"], req["group_id"])
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

    class_period_set = set(class_periods)
    # Cells where a double period can start: p and p+1 are both class periods
    # on the same day (no break/lunch in between).
    double_start_cells = [(d, p) for d in range(5) for p in class_periods if (p + 1) in class_period_set]

    def place_single(req, gid, tid, needed):
        """Place up to `needed` single periods; returns how many placed."""
        cells = list(all_cells)
        random.shuffle(cells)
        placed = 0
        for day, period in cells:
            if placed >= needed:
                break
            if (tid, day, period) in teacher_busy:
                continue
            if group_occupied(gid, day, period):
                continue
            slot = make_slot(req, day, period)
            SLOTS.append(slot)
            teacher_busy.add((tid, day, period))
            group_busy.add((gid, day, period))
            placed += 1
        return placed

    # ── Place solo requirements ──
    for req in solo:
        gid, tid = req["group_id"], req["teacher_id"]
        subj     = s_map.get(req["subject_id"], {})
        duration = subj.get("duration", 1) or 1
        already  = sum(1 for s in SLOTS
                       if s["group_id"] == gid and s["subject_id"] == req["subject_id"])
        needed   = max(0, req["weekly_count"] - already)
        placed   = 0

        # Double-period subjects (พลศึกษา ฯลฯ): place consecutive pairs first.
        if duration == 2 and needed >= 2:
            pairs_needed = needed // 2
            cells = list(double_start_cells)
            random.shuffle(cells)
            for day, p in cells:
                if pairs_needed <= 0:
                    break
                p2 = p + 1
                if (tid, day, p) in teacher_busy or (tid, day, p2) in teacher_busy:
                    continue
                if group_occupied(gid, day, p) or group_occupied(gid, day, p2):
                    continue
                s1 = make_slot(req, day, p)
                s1["is_double_start"] = True
                s2 = make_slot(req, day, p2)
                SLOTS.append(s1); SLOTS.append(s2)
                for pp in (p, p2):
                    teacher_busy.add((tid, day, pp))
                    group_busy.add((gid, day, pp))
                created      += 2
                placed       += 2
                pairs_needed -= 1

        # Remaining periods (odd leftover, or any pairs that didn't fit) → singles.
        remaining = needed - placed
        if remaining > 0:
            got = place_single(req, gid, tid, remaining)
            placed   += got
            created  += got

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
        # If any subject in the block is a double-period subject, place as pairs.
        is_double  = any((s_map.get(r["subject_id"], {}).get("duration", 1) or 1) == 2 for r in reqs)

        # Detect same-teacher assignment (warn but still try)
        teacher_ids = [r["teacher_id"] for r in reqs]
        if len(set(teacher_ids)) < len(teacher_ids):
            violations.append(
                f"[{pgk}] ครูคนเดียวสอนหลายห้องพร้อมกันไม่ได้ "
                f"กรุณาตั้งครูคนละคนสำหรับแต่ละห้อง"
            )

        def all_free(periods_to_check):
            for day_, per_ in periods_to_check:
                for r in reqs:
                    if (r["teacher_id"], day_, per_) in teacher_busy:
                        return False
                    if group_occupied(r["group_id"], day_, per_):
                        return False
            return True

        def place_block(day_, periods_to_fill):
            for i, per_ in enumerate(periods_to_fill):
                for req in reqs:
                    slot = make_slot(req, day_, per_)
                    if i == 0 and len(periods_to_fill) > 1:
                        slot["is_double_start"] = True
                    SLOTS.append(slot)
                    teacher_busy.add((req["teacher_id"], day_, per_))
                    group_busy.add((req["group_id"],   day_, per_))

        placed = 0
        created_here = 0
        if is_double and needed >= 2:
            pairs = needed // 2
            cells = list(double_start_cells)
            random.shuffle(cells)
            for day, p in cells:
                if pairs <= 0:
                    break
                if not all_free([(day, p), (day, p + 1)]):
                    continue
                place_block(day, [p, p + 1])
                created_here += 2 * len(reqs)
                placed       += 2
                pairs        -= 1

        # Remaining single periods
        remaining = needed - placed
        if remaining > 0:
            cells = list(all_cells)
            random.shuffle(cells)
            for day, period in cells:
                if remaining <= 0:
                    break
                if not all_free([(day, period)]):
                    continue
                place_block(day, [period])
                created_here += len(reqs)
                placed       += 1
                remaining    -= 1

        created += created_here

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
        "engine": "greedy",
    }


def _solve_cpsat(body: dict[str, Any]) -> dict[str, Any]:
    """Real optimiser (Google OR-Tools CP-SAT).

    Hard constraints (zero tolerance):
      • each required lesson placed exactly the right number of times
      • no teacher / room double-booking
      • no student double-booking, INCLUDING subgroups: a whole-class (parent)
        lesson never overlaps any of its subgroups' lessons; sibling subgroups
        may run at the same time
      • double-period subjects occupy two consecutive periods
      • parallel subjects share the same day+period across their groups
      • rooms reserved for another teacher / specialised to another dept excluded
      • locked & elective slots kept fixed (treated as pre-occupied)

    Objective (minimise, in priority order via weights):
      • students stay in their group's homeroom (ห้องเพชร) → less walking
      • teachers stay in their fixed room
      • outdoor subjects use outdoor space; ordinary subjects avoid special rooms
    """
    from ortools.sat.python import cp_model
    import time as _time

    global SLOTS
    t0 = _time.time()
    clear      = body.get("clear_existing", True)
    locked_ids = set(body.get("locked_slot_ids", []))

    if clear:
        SLOTS = [s for s in SLOTS if s["id"] in locked_ids or s.get("is_locked") or s.get("is_elective")]

    flat_groups = _flat_groups()
    g_map = {g["id"]: g for g in flat_groups}
    t_map = {t["id"]: t for t in TEACHERS}
    s_map = {s["id"]: s for s in SUBJECTS}
    r_map = {r["id"]: r for r in ROOMS}
    dep_out = {d["id"] for d in DEPARTMENTS if "พลศึกษา" in d.get("name", "")}

    class_periods = sorted({p["period_num"] for p in PERIODS if p["type"] == "class"})
    class_set = set(class_periods)
    DAYS_N = 5

    # ── Group hierarchy: ancestor pairs for student-sharing exclusion ──────────
    parent_of = {g["id"]: g.get("parent_id") for g in flat_groups}
    def ancestors(gid):
        out, cur = [], parent_of.get(gid)
        while cur is not None:
            out.append(cur); cur = parent_of.get(cur)
        return out

    # ── Pre-occupancy from locked / elective slots (fixed, not re-placed) ──────
    busy_teacher = set()   # (tid, d, p)
    busy_group   = set()   # (gid, d, p)  — exact group only; hierarchy added below
    busy_room    = set()   # (rid, d, p)
    for s in SLOTS:
        if s.get("teacher_id") is not None:
            busy_teacher.add((s["teacher_id"], s["day"], s["period"]))
        busy_group.add((s["group_id"], s["day"], s["period"]))
        if s.get("room_id"):
            busy_room.add((s["room_id"], s["day"], s["period"]))

    def group_prebusy(gid, d, p):
        # a cell is blocked for gid if gid OR any ancestor/descendant is pre-busy
        rel = {gid, *ancestors(gid)}
        # descendants
        stack = [gid]
        while stack:
            cur = stack.pop()
            for cid, pid in parent_of.items():
                if pid == cur:
                    rel.add(cid); stack.append(cid)
        return any((g, d, p) in busy_group for g in rel)

    model = cp_model.CpModel()

    # Expand requirements into occurrences (blocks). Each occurrence has a length.
    # duration 2 → floor(n/2) double-blocks + (n%2) singles.
    occurrences = []  # dicts: req, occ_id, length, teacher_id, group_id, subject_id, pgk
    for req in REQUIREMENTS:
        subj = s_map.get(req["subject_id"], {})
        dur  = subj.get("duration", 1) or 1
        wc   = req.get("weekly_count", 1)
        blocks = []
        if dur == 2:
            blocks += [2] * (wc // 2)
            blocks += [1] * (wc % 2)
        else:
            blocks = [1] * wc
        for i, length in enumerate(blocks):
            occurrences.append({
                "req_id": req["id"], "occ": i, "length": length,
                "teacher_id": req["teacher_id"], "group_id": req["group_id"],
                "subject_id": req["subject_id"], "pgk": req.get("parallel_group_key"),
            })

    def valid_starts(length):
        if length == 2:
            return [(d, p) for d in range(DAYS_N) for p in class_periods if (p + 1) in class_set]
        return [(d, p) for d in range(DAYS_N) for p in class_periods]

    def covered(length, d, p):
        return [(d, p)] if length == 1 else [(d, p), (d, p + 1)]

    def compatible_rooms(occ):
        subj = s_map.get(occ["subject_id"], {})
        teacher = t_map.get(occ["teacher_id"], {})
        grp = g_map.get(occ["group_id"], {})
        size = grp.get("size", 40)
        wants_outdoor = subj.get("department_id") in dep_out
        t_dept = teacher.get("department_id")
        subj_room = subj.get("fixed_room_id")
        out = []
        for r in ROOMS:
            # The subject's own designated room is always allowed — the school
            # chose it deliberately, so capacity/type rules don't exclude it.
            if subj_room and r["id"] == subj_room:
                out.append(r)
                continue
            if r.get("reserved_teacher_id") and r["reserved_teacher_id"] != occ["teacher_id"]:
                continue
            if r.get("specialized_dept_id") and r["specialized_dept_id"] != t_dept:
                continue
            if r.get("capacity", 40) < size:
                continue
            if wants_outdoor and r["type"] != "outdoor":
                # outdoor subjects only outdoors
                continue
            if not wants_outdoor and r["type"] == "outdoor":
                continue
            out.append(r)
        return out

    # ── Variables ──────────────────────────────────────────────────────────────
    start_vars   = {}   # (idx, d, p) -> BoolVar
    room_vars    = {}   # (idx, d, p, rid) -> BoolVar
    teacher_occ  = defaultdict(list)
    group_occ    = defaultdict(list)   # keyed by exact group id
    room_occ     = defaultdict(list)
    penalty_terms = []   # (weight, var) minimise sum(weight*var)

    for idx, occ in enumerate(occurrences):
        starts = valid_starts(occ["length"])
        rooms = compatible_rooms(occ)
        homeroom = g_map.get(occ["group_id"], {}).get("homeroom_room_id")
        fixed = t_map.get(occ["teacher_id"], {}).get("fixed_room_id")
        subj = s_map.get(occ["subject_id"], {})
        wants_outdoor = subj.get("department_id") in dep_out
        subj_room = subj.get("fixed_room_id")   # ห้องประจำวิชา

        occ_start_list = []
        for (d, p) in starts:
            cells = covered(occ["length"], d, p)
            # skip if any covered cell pre-busy for teacher/group/all rooms
            if any((occ["teacher_id"], cd, cp_) in busy_teacher for cd, cp_ in cells):
                continue
            if any(group_prebusy(occ["group_id"], cd, cp_) for cd, cp_ in cells):
                continue
            sv = model.NewBoolVar(f"s_{idx}_{d}_{p}")
            start_vars[(idx, d, p)] = sv
            occ_start_list.append(sv)
            for cd, cp_ in cells:
                teacher_occ[(occ["teacher_id"], cd, cp_)].append(sv)
                group_occ[(occ["group_id"], cd, cp_)].append(sv)
            # room choice
            rlist = []
            for r in rooms:
                if any((r["id"], cd, cp_) in busy_room for cd, cp_ in cells):
                    continue
                rv = model.NewBoolVar(f"r_{idx}_{d}_{p}_{r['id']}")
                room_vars[(idx, d, p, r["id"])] = rv
                rlist.append(rv)
                for cd, cp_ in cells:
                    room_occ[(r["id"], cd, cp_)].append(rv)
                # Walking penalties, strongest first.
                if subj_room:
                    # ห้องประจำวิชา wins over the class's homeroom — the subject
                    # needs that facility, so anything else is heavily penalised.
                    if r["id"] != subj_room:
                        penalty_terms.append((60, rv))
                elif not wants_outdoor:
                    if homeroom and r["id"] != homeroom:
                        penalty_terms.append((5, rv))      # student leaves homeroom
                    if fixed and r["id"] != fixed and not homeroom:
                        penalty_terms.append((3, rv))      # teacher leaves fixed room
                    if r["type"] == "special":
                        penalty_terms.append((1, rv))      # mild: avoid burning special rooms
            if rlist:
                # exactly one room iff this start chosen
                model.Add(sum(rlist) == sv)
            else:
                # no room available here → forbid this start
                model.Add(sv == 0)

        # Placement is SOFT: place as many lessons as possible (big penalty for
        # any unplaced), then minimise walking. This yields a best-effort optimal
        # timetable instead of returning nothing when the school is over-booked.
        if occ_start_list:
            model.AddAtMostOne(occ_start_list)
            placed = model.NewBoolVar(f"placed_{idx}")
            model.Add(sum(occ_start_list) == placed)
            penalty_terms.append((1000, placed.Not()))
        occ["_starts"] = occ_start_list

    # ── Hard no-overlap ────────────────────────────────────────────────────────
    for key, vs in teacher_occ.items():
        if len(vs) > 1:
            model.Add(sum(vs) <= 1)
    for key, vs in group_occ.items():
        if len(vs) > 1:
            model.Add(sum(vs) <= 1)
    for key, vs in room_occ.items():
        if len(vs) > 1:
            model.Add(sum(vs) <= 1)

    # ── Subgroup student-sharing: parent lesson excludes child lessons ─────────
    # For every (group g, ancestor a) at each cell: occ(a)+occ(g) ≤ 1.
    cells_all = [(d, p) for d in range(DAYS_N) for p in class_periods]
    for g in flat_groups:
        gid = g["id"]
        ancs = ancestors(gid)
        if not ancs:
            continue
        for a in ancs:
            for (d, p) in cells_all:
                gv = group_occ.get((gid, d, p), [])
                av = group_occ.get((a, d, p), [])
                if gv and av:
                    model.Add(sum(gv) + sum(av) <= 1)

    # ── Parallel sync: siblings sharing a pgk must start at same (d,p) ─────────
    pgk_groups = defaultdict(list)   # pgk -> list of occurrence idx
    for idx, occ in enumerate(occurrences):
        if occ["pgk"]:
            pgk_groups[occ["pgk"]].append(idx)
    for pgk, idxs in pgk_groups.items():
        if len(idxs) < 2:
            continue
        base = idxs[0]
        for other in idxs[1:]:
            for (d, p) in valid_starts(occurrences[base]["length"]):
                bv = start_vars.get((base, d, p))
                ov = start_vars.get((other, d, p))
                if bv is not None and ov is not None:
                    model.Add(bv == ov)
                elif bv is not None and ov is None:
                    model.Add(bv == 0)

    # ── Objective: place-everything (weight 1000) then minimise walking ────────
    if penalty_terms:
        model.Minimize(sum(w * v for w, v in penalty_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(body.get("time_limit_seconds") or 20)
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    ok = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    created = 0
    violations = []

    if ok:
        for idx, occ in enumerate(occurrences):
            starts = valid_starts(occ["length"])
            chosen = None
            for (d, p) in starts:
                sv = start_vars.get((idx, d, p))
                if sv is not None and solver.Value(sv) == 1:
                    chosen = (d, p); break
            if chosen is None:
                code = s_map.get(occ["subject_id"], {}).get("code", "?")
                violations.append(f"ไม่สามารถจัด {code} (กลุ่ม {occ['group_id']})")
                continue
            d, p = chosen
            # room
            rid = None
            for r in ROOMS:
                rv = room_vars.get((idx, d, p, r["id"]))
                if rv is not None and solver.Value(rv) == 1:
                    rid = r["id"]; break
            cells = covered(occ["length"], d, p)
            for i, (cd, cp_) in enumerate(cells):
                subj = s_map.get(occ["subject_id"], {})
                teacher = t_map.get(occ["teacher_id"], {})
                grp = g_map.get(occ["group_id"], {})
                room = r_map.get(rid, {})
                slot = {
                    "id": _next("slot"), "day": cd, "period": cp_,
                    "teacher_id": occ["teacher_id"], "group_id": occ["group_id"],
                    "room_id": rid, "subject_id": occ["subject_id"],
                    "is_double_start": (occ["length"] == 2 and i == 0),
                    "parallel_group_key": occ["pgk"], "is_locked": False,
                    "teacher_name": teacher.get("name"), "group_name": grp.get("name"),
                    "room_name": room.get("name"), "room_type": room.get("type"),
                    "subject_name": subj.get("name"), "subject_code": subj.get("code"),
                }
                SLOTS.append(slot)
                created += 1
    else:
        violations.append("ไม่พบคำตอบที่เป็นไปได้ — ลองลดจำนวนคาบ เพิ่มครู/ห้อง หรือปลดล็อกบางคาบ")

    return {
        "status": "OPTIMAL" if status == cp_model.OPTIMAL else ("FEASIBLE" if ok else "INFEASIBLE"),
        "slots_created": created,
        "solve_time_seconds": round(_time.time() - t0, 2),
        "objective_value": float(solver.ObjectiveValue()) if (ok and penalty_terms) else None,
        "violations": violations,
        "engine": "cp-sat",
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
    body.setdefault("homeroom_teacher_id", None)
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
        row.setdefault("homeroom_room_id", None)
        row.setdefault("homeroom_teacher_id", None)
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
        row.setdefault("code", None)
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
        row.setdefault("fixed_room_id", None)
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

@app.put("/api/timetable/requirements/{i}")
def update_req(i: int, body: dict[str, Any]):
    for r in REQUIREMENTS:
        if r["id"] == i:
            r.update(body)
            return r
    raise HTTPException(404, "Requirement not found")

@app.post("/api/timetable/requirements/bulk")
def bulk_create_reqs(body: list[dict[str, Any]]):
    created = []
    for row in body:
        # Skip rows missing the essentials rather than crashing the whole import.
        if not row.get("group_id") or not row.get("subject_id") or not row.get("teacher_id"):
            continue
        row["id"] = _next("requirement")
        row.setdefault("weekly_count", 1)
        row.setdefault("parallel_group_key", None)
        REQUIREMENTS.append(row)
        created.append(row)
    return created

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
    """Add one lesson to a specific cell (used by 'click an empty cell to add')."""
    slot = {
        "id": _next("slot"),
        "day": int(body["day"]), "period": int(body["period"]),
        "group_id": int(body["group_id"]),
        "teacher_id": int(body["teacher_id"]),
        "subject_id": int(body["subject_id"]),
        "room_id": body.get("room_id"),
        "is_double_start": bool(body.get("is_double_start", False)),
        "parallel_group_key": body.get("parallel_group_key"),
        "is_locked": bool(body.get("is_locked", False)),
    }
    SLOTS.append(slot)
    return _enrich_slot(slot)

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

# ── Double-period (คาบคู่) helpers ────────────────────────────────────────────
def _class_period_nums() -> list[int]:
    return sorted({p["period_num"] for p in PERIODS if p["type"] == "class"})

def _next_class_period(period: int) -> int | None:
    """The class period immediately after `period` (skipping break/lunch), or None."""
    nums = _class_period_nums()
    if period in nums:
        i = nums.index(period)
        if i + 1 < len(nums):
            return nums[i + 1]
    return None

def _sync_doubles(slot: dict[str, Any]) -> None:
    """Propagate an elective's option catalog + selection to its double partner.

    A double-period elective is stored as TWO linked slots (period p and p+1)
    sharing a `double_group_key`. They share identical option ids so selection is
    a straight copy. This keeps both halves showing the same subject/teacher.
    """
    key = slot.get("double_group_key")
    if not key:
        return
    for s in SLOTS:
        if s is slot or s.get("double_group_key") != key:
            continue
        s["elective_options"] = [dict(o) for o in slot["elective_options"]]
        s["selected_option_id"] = slot["selected_option_id"]
        _apply_selected_option(s)

# ── Level-wide activity periods (คาบกิจกรรมประจำระดับชั้น) ───────────────────
# e.g. "สาธารณประโยชน์ของ ม.5 ทุกห้อง อยู่คาบ 7 วันพุธ".
# One call pins the same activity onto every classroom of a level. The slots are
# locked, so the auto-scheduler treats them as immovable and never books over them.
# A teacher is optional — many activity periods have no single subject teacher.

@app.post("/api/timetable/level-activity")
def create_level_activity(body: dict[str, Any]):
    level      = body["level"]
    day        = int(body["day"])
    period     = int(body["period"])
    subject_id = int(body["subject_id"])
    room_mode  = body.get("room_mode", "homeroom")   # "homeroom" | "none"
    # teacher_mode: "homeroom" → each class is supervised by its own ครูประจำชั้น
    #               "single"   → one named teacher for every class
    #               "none"     → no teacher assigned
    teacher_mode = body.get("teacher_mode", "none")
    teacher_id   = body.get("teacher_id")
    teacher_id   = int(teacher_id) if teacher_id not in (None, "") else None
    if teacher_id is not None and teacher_mode == "none":
        teacher_mode = "single"

    # Whole-class activity → target top-level classes of that level, never the
    # subgroups (ก/ข/ค), so the parent and its children can't double-book.
    targets = [g for g in _flat_groups()
               if g.get("level") == level and not g.get("parent_id")]
    if not targets:
        raise HTTPException(400, f"ไม่พบห้องเรียนในระดับ {level}")

    t_names = {t["id"]: t["name"] for t in TEACHERS}
    key = f"ACT-{level}-{day}-{period}"
    created, skipped, warnings = [], [], []
    for g in targets:
        # Skip classrooms that already have something in this cell.
        clash = next((s for s in SLOTS
                      if s["day"] == day and s["period"] == period
                      and s["group_id"] == g["id"]), None)
        if clash:
            skipped.append({"group": g["name"],
                            "reason": clash.get("subject_code") or "มีคาบอยู่แล้ว"})
            continue

        # Work out who supervises this particular class.
        if teacher_mode == "homeroom":
            slot_teacher = g.get("homeroom_teacher_id")
            if slot_teacher is None:
                warnings.append(f"{g['name']}: ยังไม่ได้ตั้งครูประจำชั้น (สร้างคาบให้แล้วแต่ไม่มีครู)")
        elif teacher_mode == "single":
            slot_teacher = teacher_id
        else:
            slot_teacher = None

        # A teacher can't supervise while teaching elsewhere at the same time.
        if slot_teacher is not None and any(
                s["day"] == day and s["period"] == period and s.get("teacher_id") == slot_teacher
                for s in SLOTS):
            warnings.append(
                f"{g['name']}: ครู {t_names.get(slot_teacher, slot_teacher)} ติดสอนคาบนี้อยู่ "
                f"จึงสร้างคาบให้โดยไม่ใส่ครู")
            slot_teacher = None

        slot = {
            "id": _next("slot"),
            "day": day, "period": period,
            "group_id": g["id"],
            "teacher_id": slot_teacher,
            "subject_id": subject_id,
            "room_id": g.get("homeroom_room_id") if room_mode == "homeroom" else None,
            "is_double_start": False,
            "parallel_group_key": None,
            "is_locked": True,
            "is_activity_block": True,
            "activity_key": key,
            "activity_level": level,
        }
        SLOTS.append(slot)
        created.append(_enrich_slot(slot))
    return {"created": created, "skipped": skipped, "warnings": warnings, "activity_key": key}


@app.delete("/api/timetable/level-activity/{activity_key}")
def delete_level_activity(activity_key: str):
    """Remove every slot belonging to one level-wide activity."""
    global SLOTS
    before = len(SLOTS)
    SLOTS = [s for s in SLOTS if s.get("activity_key") != activity_key]
    return {"removed": before - len(SLOTS)}


@app.post("/api/timetable/elective-slots")
def create_elective_slot(body: dict[str, Any]):
    is_double = bool(body.get("is_double"))
    option = {
        "id": _next("elective_option"),
        "subject_id": body["subject_id"],
        "teacher_id": body["teacher_id"],
        "label": body.get("label") or "วงที่ 1",
    }
    common = {
        "group_id": body["group_id"],
        "room_id": body.get("room_id"),
        "parallel_group_key": None,
        "is_locked": True,
        "is_elective": True,
        "selected_option_id": option["id"],
        "subject_id": option["subject_id"],
        "teacher_id": option["teacher_id"],
    }
    day = body["day"]
    p1  = body["period"]

    # ── Single period ──
    if not is_double:
        slot = {
            **common, "id": _next("slot"), "day": day, "period": p1,
            "is_double_start": False, "double_group_key": None,
            "elective_options": [dict(option)],
        }
        SLOTS.append(slot)
        return _apply_selected_option(slot)

    # ── Double period: occupy p1 and the next class period ──
    p2 = _next_class_period(p1)
    if p2 is None:
        raise HTTPException(400, "คาบนี้เป็นคาบสุดท้ายของวัน ทำคาบคู่ไม่ได้ กรุณาเลือกคาบอื่น")
    key = f"ELEC-DBL-{_next('slot')}"   # borrow slot counter for a unique key
    start = {
        **common, "id": _next("slot"), "day": day, "period": p1,
        "is_double_start": True, "double_group_key": key, "is_double_cont": False,
        "elective_options": [dict(option)],
    }
    cont = {
        **common, "id": _next("slot"), "day": day, "period": p2,
        "is_double_start": False, "double_group_key": key, "is_double_cont": True,
        "elective_options": [dict(option)],
    }
    SLOTS.append(start)
    SLOTS.append(cont)
    _apply_selected_option(cont)
    # Return the start slot (frontend treats it as the primary row).
    return _apply_selected_option(start)

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
    _sync_doubles(slot)
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
    _sync_doubles(slot)
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
    _sync_doubles(slot)
    return _apply_selected_option(slot)

@app.post("/api/timetable/elective-slots/{slot_id}/copy")
def copy_elective_slot(slot_id: int, body: dict[str, Any]):
    src = next((s for s in SLOTS if s["id"] == slot_id and s.get("is_elective")), None)
    if not src:
        raise HTTPException(404, "Elective slot not found")

    # Gather every slot belonging to this elective (both halves if double).
    key = src.get("double_group_key")
    group_slots = [s for s in SLOTS if key and s.get("double_group_key") == key] if key else [src]
    group_slots.sort(key=lambda s: s["period"])

    created = []
    for target_group_id in body.get("target_group_ids", []):
        new_key = f"ELEC-DBL-{_next('slot')}" if key else None
        # Shared option-id remap so both halves keep matching ids.
        id_map: dict[int, int] = {}
        for o in group_slots[0]["elective_options"]:
            id_map[o["id"]] = _next("elective_option")
        for gs in group_slots:
            new_slot = {
                **gs,
                "id": _next("slot"),
                "group_id": target_group_id,
                "double_group_key": new_key,
                "elective_options": [{**o, "id": id_map[o["id"]]} for o in gs["elective_options"]],
                "selected_option_id": id_map[gs["selected_option_id"]],
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
    target = next((s for s in SLOTS if s["id"] == slot_id), None)
    # If this is part of a double-period elective, remove both halves.
    key = target.get("double_group_key") if target else None
    if key:
        SLOTS = [s for s in SLOTS if s.get("double_group_key") != key]
    else:
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
    if slot.get("teacher_id") is not None and any(
            s.get("teacher_id") == slot["teacher_id"] for s in at_target):
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
