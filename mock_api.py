"""
Mock API v3 — working mock solver + bulk import + periods CRUD + bulk lock.
Run: python mock_api.py
"""
from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any
import random
import re as _re
import os as _os
import json as _json
import datetime as _dt
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



def _room_reserved_for(room: dict[str, Any]) -> set[int]:
    """Teachers this room is kept for. Empty means anyone may use it.

    A room can belong to several teachers who share it — a department office
    with three desks, a lab two people run between them. It was a single
    teacher before, so that older shape is still read.
    """
    ids = room.get("reserved_teacher_ids")
    if isinstance(ids, list):
        return {int(x) for x in ids if x}
    one = room.get("reserved_teacher_id")
    return {int(one)} if one else set()


def _room_free_for(room: dict[str, Any], teacher_id: int | None) -> bool:
    kept = _room_reserved_for(room)
    return not kept or (teacher_id is not None and teacher_id in kept)


def _room_usable(room: dict[str, Any]) -> bool:
    """May a lesson be scheduled in this room?

    Schools have rooms that are not classrooms — staff rooms, offices, the
    canteen. Marking one ห้ามใช้ keeps the scheduler out of it. A capacity of 0
    meant the same thing before this setting existed, and is still honoured so
    older data keeps working.
    """
    if room.get("usable") is False:
        return False
    return (room.get("capacity", 1) or 0) > 0 or room.get("usable") is True


def _elective_option_teachers(slot: dict[str, Any]) -> set[int]:
    """Teachers occupied by a shared elective window.

    An elective the class has already settled on (selected_option_id set) books
    just that one teacher, and `teacher_id` already covers it. An unsettled
    shared window runs every option simultaneously, so all of its teachers are
    busy — that is what stops the solver handing them another class.
    """
    if not slot.get("is_elective") or slot.get("selected_option_id"):
        return set()
    return {o["teacher_id"] for o in slot.get("elective_options", []) if o.get("teacher_id")}


# ── วิชาเสรี: pools ───────────────────────────────────────────────────────────
# A pool is one elective WINDOW shared by several classes, holding the subject
# options a student may pick inside it. The staffing sheet writes these as
# "ม.1/7-12 กรีฑา 2 คาบ" — six classes, one window, กรีฑา being one of nine
# options — so a pool is the unit the school actually schedules, and placing it
# writes one elective slot per class at the same day/period.
ELECTIVE_POOLS: list[dict[str, Any]] = []

# ── Real school data (อัตรากำลัง) ─────────────────────────────────────────────
# school_data.json holds the school's actual departments, classes, teachers,
# subjects and teaching assignments, generated from the staffing workbook.
# When the file is present it replaces the small demo dataset above, so a fresh
# deploy comes up with the real timetable inputs already loaded.
def _load_school_data() -> bool:
    import os, json
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "school_data.json")
    if not os.path.exists(path):
        return False
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return False

    for key, target in (("departments", DEPARTMENTS), ("buildings", BUILDINGS),
                        ("rooms", ROOMS), ("teachers", TEACHERS),
                        ("subjects", SUBJECTS), ("requirements", REQUIREMENTS)):
        rows = data.get(key)
        if rows:
            target.clear()
            target.extend(rows)

    # Classes are stored flat with parent_id; the API serves them nested.
    rows = data.get("groups")
    if rows:
        by_id = {g["id"]: {**g, "children": []} for g in rows}
        GROUPS.clear()
        for g in by_id.values():
            parent = by_id.get(g.get("parent_id")) if g.get("parent_id") else None
            (parent["children"] if parent else GROUPS).append(g)

    pools = data.get("elective_pools")
    if pools:
        ELECTIVE_POOLS.clear()
        # Pools arrive unpinned: the staffing sheet says which classes share an
        # elective and what the choices are, never which period it runs in.
        # That is the school's decision, taken in the app.
        for i, p in enumerate(pools, start=1):
            p.setdefault("day", None)
            p.setdefault("period", None)
            for j, o in enumerate(p.get("options", []), start=1):
                o.setdefault("key", i * 1000 + j)
            ELECTIVE_POOLS.append(p)
    return True


_LOADED_REAL_DATA = _load_school_data()

# ── Sequential ID counters ─────────────────────────────────────────────────────
def _max_id(rows: list[dict[str, Any]]) -> int:
    """Highest id in a collection — new records continue from here."""
    return max((r.get("id", 0) for r in rows), default=0)


_counters: dict[str, int] = {
    "period": _max_id(PERIODS),
    "room": _max_id(ROOMS),
    "department": _max_id(DEPARTMENTS),
    # Walk the nested class tree here: _flat_groups() is defined further down.
    "group": _max_id([g for top in GROUPS for g in (top, *top.get("children", []))]),
    "teacher": _max_id(TEACHERS),
    "subject": _max_id(SUBJECTS),
    "requirement": _max_id(REQUIREMENTS),
    "slot": 0,
    # Option keys are seeded above the pool-derived range so a newly added
    # option can never collide with one loaded from school_data.json.
    "elective_option": (_max_id(ELECTIVE_POOLS) + 1) * 1000,
    "elective_pool": _max_id(ELECTIVE_POOLS),
}
def _next(key: str) -> int:
    _counters[key] += 1
    return _counters[key]


# ── วิชาที่มีปัญหา: find them, and let a run leave them out ───────────────────
# Some lessons cannot be placed however the timetable is arranged — a class
# already asked to sit 40 periods in a 35-period week, a teacher booked past
# their own limit, a subject whose teacher was deleted. Left in, they make the
# whole run look like a failure and bury the cases that could still be fixed.
# So they are found before the run, shown, and may be left out of it.

LAST_RUN: dict[str, Any] = {"unplaced_requirement_ids": [], "skipped_requirement_ids": []}


def _requirement_problems() -> list[dict[str, Any]]:
    """Every lesson requirement that cannot be scheduled, and why.

    "blocking" means it is impossible as written and will always fail.
    "warning" means it may well fail because something it depends on is
    over capacity — which of the class's lessons to drop is the school's
    call, not ours, so all of them are listed.
    """
    g_map = {g["id"]: g for g in _flat_groups()}
    t_map = {t["id"]: t for t in TEACHERS}
    s_map = {s["id"]: s for s in SUBJECTS}
    shares = _shares_students_fn()
    # ม.ต้น and ม.ปลาย do not get the same number of lesson periods, because
    # their lunch falls in different ones.
    week_capacity_for = {
        lvl: len(_class_periods_for_level(lvl)) * 5 for lvl in ("lower", "upper")
    }
    dep_out = {d["id"] for d in DEPARTMENTS if "พลศึกษา" in d.get("name", "")}

    # Weekly load per class. A subgroup's lesson also occupies its parent's
    # students, so a class owes its own lessons PLUS every ancestor's. Sibling
    # subgroups (ก/ข/ค) hold different students and run at the same time, so
    # they are never added together — summing across the whole family would
    # invent an overload that does not exist.
    own: dict[int, int] = defaultdict(int)
    load_teacher: dict[int, int] = defaultdict(int)
    for r in REQUIREMENTS:
        wc = r.get("weekly_count") or 0
        load_teacher[r["teacher_id"]] += wc
        own[r["group_id"]] += wc

    parent_of = {g["id"]: g.get("parent_id") for g in g_map.values()}

    def chain_load(gid: int) -> int:
        total, cur, seen = 0, gid, set()
        while cur is not None and cur not in seen:
            seen.add(cur)
            total += own.get(cur, 0)
            cur = parent_of.get(cur)
        return total

    # What a class is actually asked to sit through. For a class with
    # subgroups, the worst of its branches is what has to fit in the week.
    load_group: dict[int, int] = {}
    for gid in g_map:
        kids = [c for c, p in parent_of.items() if p == gid]
        load_group[gid] = max([chain_load(gid)] + [chain_load(c) for c in kids])

    def has_any_room(r: dict) -> bool:
        subj = s_map.get(r["subject_id"], {})
        outdoor = subj.get("department_id") in dep_out
        dept = subj.get("department_id")
        for room in ROOMS:
            if subj.get("fixed_room_id") and room["id"] == subj["fixed_room_id"]:
                return True
            if not _room_usable(room):
                continue          # ห้องห้ามใช้ — a staff room or office
            if room.get("specialized_dept_id") and room["specialized_dept_id"] != dept:
                continue
            if outdoor != (room["type"] == "outdoor"):
                continue
            return True
        return False

    last_failed = set(LAST_RUN.get("unplaced_requirement_ids") or [])
    out = []
    for r in REQUIREMENTS:
        grp  = g_map.get(r["group_id"])
        teach = t_map.get(r["teacher_id"])
        subj = s_map.get(r["subject_id"])
        wc = r.get("weekly_count") or 0
        reasons: list[tuple[str, str]] = []   # (severity, text)

        if not grp:
            reasons.append(("blocking", "ไม่พบห้องเรียนนี้แล้ว (อาจถูกลบไป)"))
        if not teach:
            reasons.append(("blocking", "ไม่พบครูผู้สอนคนนี้แล้ว (อาจถูกลบไป)"))
        if not subj:
            reasons.append(("blocking", "ไม่พบวิชานี้แล้ว (อาจถูกลบไป)"))
        if wc <= 0:
            reasons.append(("blocking", "จำนวนคาบ/สัปดาห์เป็น 0"))
        if grp and teach and subj and not has_any_room(r):
            reasons.append(("blocking", "ไม่มีห้องสอนไหนรองรับวิชานี้ได้เลย (ดูความจุ/ประเภทห้อง)"))

        if grp:
            cap = week_capacity_for[_level_key(grp)]
            over = load_group[r["group_id"]] - cap
            if over > 0:
                reasons.append(("warning",
                    f"{grp['name']} ถูกจัด {load_group[r['group_id']]} คาบ/สัปดาห์ "
                    f"แต่มีแค่ {cap} คาบ — เกิน {over} คาบ"))
        if teach:
            cap = (teach.get("max_slots_per_day") or 6) * 5
            if load_teacher[r["teacher_id"]] > cap:
                reasons.append(("warning",
                    f"{teach['name']} ถูกจัด {load_teacher[r['teacher_id']]} คาบ/สัปดาห์ "
                    f"เกินเพดาน {cap} คาบ"))
        if r["id"] in last_failed:
            reasons.append(("warning", "ครั้งที่แล้วจัดลงตารางไม่ได้"))

        if not reasons:
            continue
        severity = "blocking" if any(s == "blocking" for s, _ in reasons) else "warning"
        out.append({
            "requirement_id": r["id"],
            "group_id": r["group_id"],   "group_name": grp["name"] if grp else None,
            "teacher_id": r["teacher_id"], "teacher_name": teach["name"] if teach else None,
            "teacher_code": teach.get("code") if teach else None,
            "subject_id": r["subject_id"],
            "subject_code": subj.get("code") if subj else None,
            "subject_name": subj.get("name") if subj else None,
            "weekly_count": wc,
            "severity": severity,
            "reasons": [t for _, t in reasons],
        })
    out.sort(key=lambda x: (x["severity"] != "blocking", x["subject_code"] or ""))
    return out


def _excluded_requirement_ids(body: dict[str, Any]) -> set[int]:
    """Requirement ids this run must leave alone."""
    ids = set(body.get("exclude_requirement_ids") or [])
    if body.get("skip_problems"):
        only_blocking = body.get("skip_problems") == "blocking"
        for p in _requirement_problems():
            if not only_blocking or p["severity"] == "blocking":
                ids.add(p["requirement_id"])
    return ids


@app.get("/api/timetable/problems")
def get_requirement_problems():
    probs = _requirement_problems()
    return {
        "problems": probs,
        "blocking": sum(1 for p in probs if p["severity"] == "blocking"),
        "warning":  sum(1 for p in probs if p["severity"] == "warning"),
        "total_requirements": len(REQUIREMENTS),
        "last_run": LAST_RUN,
    }



# ── Teaching back to back ─────────────────────────────────────────────────────
# Nothing limited how many periods in a row a teacher could be given, and on
# the real data one ended up with seven consecutive. The school's rule: never
# more than three in a row, and two is better. A ten-minute break between two
# periods is not a rest, so it does not break a run; lunch does.

CONSEC_HARD = 3     # never more than this
CONSEC_SOFT = 2     # what we aim for


def _consec_settings(body: dict[str, Any] | None = None) -> tuple[int, int]:
    """(hard ceiling, soft target) for this run.

    The school sets these; a run may override them; a teacher may have the
    ceiling lifted individually.
    """
    cfg = SCHOOL_CONFIG if isinstance(SCHOOL_CONFIG, dict) else {}
    body = body or {}
    def pick(key: str, default: int) -> int:
        for src in (body, cfg):
            v = src.get(key)
            if v not in (None, ""):
                try:
                    return max(1, int(v))
                except (TypeError, ValueError):
                    pass
        return default
    hard = pick("max_consecutive", CONSEC_HARD)
    soft = min(pick("prefer_consecutive", CONSEC_SOFT), hard)
    return hard, soft
_GAP_IS_REST = 15   # minutes; shorter than this and the periods count as joined


def _consec_limit(teacher: dict[str, Any] | None, hard: int = CONSEC_HARD) -> int:
    """This teacher's ceiling, which they may have had lifted."""
    adv = (teacher or {}).get("advanced_settings") or {}
    if adv.get("ignore_consecutive_limit"):
        return 99
    try:
        return max(1, int(adv.get("max_consecutive") or hard))
    except (TypeError, ValueError):
        return hard


def _run_length(busy: list[tuple[int, int]], start: int, end: int) -> int:
    """How many periods in a row this one would sit in, including itself.

    Walks outwards from the new period rather than scanning once and keeping
    the longest run seen so far: a period dropped into a gap JOINS the runs on
    either side of it, and a single scan reports only the half it finished on.
    """
    spans = sorted([*busy, (start, end)])
    i = spans.index((start, end))
    total = 1
    for j in range(i, 0, -1):                       # backwards while joined
        if spans[j][0] - spans[j - 1][1] < _GAP_IS_REST:
            total += 1
        else:
            break
    for j in range(i, len(spans) - 1):              # forwards while joined
        if spans[j + 1][0] - spans[j][1] < _GAP_IS_REST:
            total += 1
        else:
            break
    return total


def _touches_lunch(period_rows: dict[int, dict[str, Any]], start: int, end: int) -> bool:
    """Is this period hard up against the lunch break?

    Teaching straight into lunch and straight out of it again is the tiring
    shape the school wants to avoid, so it costs a little when choosing.
    """
    for row in period_rows.values():
        if row.get("type") != "lunch":
            continue
        ls, le = _hhmm(row.get("start_time")), _hhmm(row.get("end_time"))
        if ls is None or le is None:
            continue
        if end == ls or start == le:
            return True
    return False


# ── What each teacher has asked for ───────────────────────────────────────────
# Days off, periods to avoid and "ground floor only" were all settable in the
# app and read by nothing: the solver never looked at advanced_settings beyond
# the consecutive limit, so a teacher's day off was decoration. They are
# honoured now, together with two new rules the school asked for.

LAST_PERIOD_MIN = 1     # เวรคาบสุดท้าย: lessons each teacher takes in the last period

def _teacher_prefs(teacher: dict[str, Any] | None) -> dict[str, Any]:
    adv = (teacher or {}).get("advanced_settings") or {}
    def num(key, default):
        try:
            v = adv.get(key)
            return default if v in (None, "") else int(v)
        except (TypeError, ValueError):
            return default
    return {
        "days_off": {int(d) for d in (adv.get("days_off") or []) if str(d).isdigit() or isinstance(d, int)},
        "avoid_periods": {int(p) for p in (adv.get("avoid_periods") or [])
                          if str(p).isdigit() or isinstance(p, int)},
        "ground_floor": bool(adv.get("require_ground_floor")),
        # None = follow the school's figure; 0 = exempt this teacher.
        "min_last_period": None if adv.get("min_last_period") in (None, "") else num("min_last_period", 0),
    }


def _school_min_last_period(body: dict[str, Any] | None = None) -> int:
    for src in (body or {}, SCHOOL_CONFIG if isinstance(SCHOOL_CONFIG, dict) else {}):
        v = src.get("min_last_period")
        if v not in (None, ""):
            try:
                return max(0, int(v))
            except (TypeError, ValueError):
                pass
    return LAST_PERIOD_MIN


def _last_period_for(level: str) -> int | None:
    """The final lesson period of the day for this level."""
    nums = _class_periods_for_level(level)
    return nums[-1] if nums else None


# ── วิชายากควรอยู่ช่วงเช้า ────────────────────────────────────────────────────
# Maths and science in the last period of the afternoon is a lesson half the
# room sleeps through. This is a nudge, not a rule: a subject marked this way
# is tried in the morning first and only drops into the afternoon when nothing
# else fits, so it never costs a lesson its place in the timetable.

def _morning_cutoff(level: str) -> int | None:
    """The period a morning ends at — the last one starting before noon."""
    rows = _periods_for_level(level)
    best = None
    for num in _class_periods_for_level(level):
        start = _hhmm(rows.get(num, {}).get("start_time"))
        if start is not None and start < 12 * 60:
            best = num
    return best


def _prefers_morning(subject: dict[str, Any] | None) -> bool:
    return bool((subject or {}).get("prefer_morning"))


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
    except MemoryError as e:
        # The model was refused before it was built — expected for a large
        # school on a small host, so say what happened in plain words rather
        # than leaving the person with a failure they cannot interpret.
        res = _solve_greedy(body)
        res.setdefault("violations", [])
        res["violations"].append(f"ℹ {e} จึงใช้ตัวจัดสำรอง (heuristic) แทน — ผลที่ได้ยังครบเงื่อนไขทุกข้อ")
        res["engine"] = "greedy-fallback"
        return res
    except Exception as e:  # never break the app on a solver bug
        res = _solve_greedy(body)
        res.setdefault("violations", [])
        res["violations"].append(f"(CP-SAT ใช้ไม่ได้ จึงใช้วิธีสำรอง: {type(e).__name__}: {e})")
        res["engine"] = "greedy-fallback"
        return res


# ── Greedy Mock Solver (fallback) ──────────────────────────────────────────────
def _solve_greedy(body: dict[str, Any]) -> dict[str, Any]:
    global SLOTS
    import time as _time
    _t0 = _time.perf_counter()
    clear      = body.get("clear_existing", True)
    locked_ids = set(body.get("locked_slot_ids", []))
    skipped_reqs = _excluded_requirement_ids(body)
    unplaced_ids: list[int] = []
    consec_hard, consec_soft = _consec_settings(body)

    # Keep only locked slots when clearing — elective slots always survive,
    # regardless of is_locked, so the solver never double-books their teacher/room.
    if clear:
        SLOTS = [s for s in SLOTS if s["id"] in locked_ids or s.get("is_locked") or s.get("is_elective")]

    # Build occupation sets
    t_map = {t["id"]: t for t in TEACHERS}
    g_map = {g["id"]: g for g in _flat_groups()}

    # Teachers and rooms are booked by the CLOCK, not by period number: the two
    # levels number their periods the same but sit them at different times.
    # One ordinary room per class that has no ห้องประจำชั้น recorded, settled on
    # the first time the class needs a room and reused for the rest of the week.
    anchor_room: dict[int, int] = {}
    # Rooms that already belong to a class. An anchor must not be chosen from
    # these, or it takes a room another class is entitled to sit in all week.
    homeroom_ids: set[int] = {g["homeroom_room_id"] for g in g_map.values()
                              if g.get("homeroom_room_id")}

    def cell_buckets(gid: int, period: int) -> frozenset[int]:
        return _slot_buckets(g_map.get(gid), period)

    teacher_busy: set[tuple] = set()   # (teacher, day, 5-minute bucket)
    group_busy:   set[tuple] = set()   # (group,   day, period number)
    room_busy:    set[tuple] = set()   # (room,    day, 5-minute bucket)
    # (teacher, day) -> the clock intervals they already teach, so we can see
    # how long a run of back-to-back periods would become.
    teacher_spans: dict[tuple, list[tuple[int, int]]] = defaultdict(list)

    def span_of(gid: int, period: int) -> tuple[int, int] | None:
        row = _periods_for_level(_level_key(g_map.get(gid))).get(period)
        if not row:
            return None
        a, b = _hhmm(row.get("start_time")), _hhmm(row.get("end_time"))
        return (a, b) if a is not None and b is not None else None

    for s in SLOTS:
        bks = cell_buckets(s["group_id"], s["period"])
        # Activity periods (สาธารณประโยชน์ ฯลฯ) may have no assigned teacher.
        tids = set()
        if s.get("teacher_id") is not None:
            tids.add(s["teacher_id"])
        # A shared elective runs every option at once, so each option's teacher
        # is teaching in this window even though the class cell names none.
        tids |= _elective_option_teachers(s)
        for tid in tids:
            for b in bks:
                teacher_busy.add((tid, s["day"], b))
        sp = span_of(s["group_id"], s["period"])
        if sp:
            for tid in tids:
                teacher_spans[(tid, s["day"])].append(sp)
        group_busy.add((s["group_id"], s["day"], s["period"]))
        if s.get("room_id"):
            for b in bks:
                room_busy.add((s["room_id"], s["day"], b))

    # Each level has its own lesson periods — ม.1-3 are at lunch while ม.4-6
    # are in class — so the cells a lesson may use depend on whose lesson it is.
    def cells_for(gid: int):
        lvl = _level_key(g_map.get(gid))
        return [(d, p) for d in range(5) for p in _class_periods_for_level(lvl)]

    class_periods = sorted({p["period_num"] for p in PERIODS if p["type"] == "class"})
    all_cells     = [(d, p) for d in range(5) for p in class_periods]
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
          1. ห้องประจำวิชา — a room pinned to the subject itself.
          2. A room reserved for the subject's own กลุ่มสาระ (computer lab,
             science lab, music room). Those rooms exist because the lesson
             cannot happen anywhere else, so they outrank the homeroom.
          3. Otherwise keep students in their GROUP homeroom (ห้องประจำ/ห้องเพชร)
             if it's free — students stay put, the teacher comes to them.
          4. Otherwise the TEACHER's fixed room (regular เดินเรียน: students walk
             to the teacher).
          5. Otherwise any eligible free room, ranked by type.
        """
        t  = t_map.get(teacher_id, {})
        fr = t.get("fixed_room_id")
        subj = s_map.get(subject_id, {}) if subject_id is not None else {}
        # Match specialised rooms against the SUBJECT's department — a maths
        # teacher covering a computer period still needs the lab.
        want_dept = subj.get("department_id") or t.get("department_id")
        wants_outdoor = subj.get("department_id") in outdoor_dept_ids
        grp = g_map.get(group_id, {}) if group_id is not None else {}
        # ห้องประจำชั้น, or the one this run has settled on for a class that has
        # none. Forty of this school's classes have no homeroom recorded, which
        # left 862 lessons with nothing to hold them in place — they took
        # whatever was free and the class walked all week. Picking one ordinary
        # room per class and coming back to it costs nothing and behaves like a
        # homeroom until the school records a real one.
        home = grp.get("homeroom_room_id") or anchor_room.get(group_id)
        # สอนได้เฉพาะชั้น 1 — a teacher who cannot manage stairs. Honoured as a
        # ranking, not a filter: a hard rule here would simply lose the lesson
        # on a day the ground floor is full, which helps nobody.
        ground_only = _teacher_prefs(t).get("ground_floor")

        def upstairs(r: dict | None) -> bool:
            if not ground_only or not r:
                return False
            try:
                return int(r.get("floor") or 1) > 1
            except (TypeError, ValueError):
                return False
        # A room is taken if it is in use at this time of day — which, between
        # the two levels, is not the same thing as the same period number.
        bks = _slot_buckets(grp, period)

        def room_taken(rid: int) -> bool:
            return any((rid, day, b) in room_busy for b in bks)

        def eligible(r: dict) -> bool:
            if room_taken(r["id"]):
                return False
            # ห้องห้ามใช้ — a staff room, an office, anything the school has
            # said is not a classroom. (capacity 0 meant this before the
            # setting existed, and still does.)
            if not _room_usable(r):
                return False
            if not _room_free_for(r, teacher_id):
                return False
            if r.get("specialized_dept_id") and r["specialized_dept_id"] != want_dept:
                return False
            return True

        # 1. ห้องประจำวิชา — a room tied to the subject itself (gym, computer
        #    lab, music room). This outranks the class's homeroom: the students
        #    walk to the facility the subject needs.
        subj_room = subj.get("fixed_room_id")
        if subj_room and not room_taken(subj_room):
            r = r_map.get(subj_room)
            if r:
                return subj_room, r["name"], r["type"]

        # 2. A room this department owns. Several labs may serve one subject
        #    (5 computer rooms for 156 periods a week), so pin by department
        #    rather than by subject and take whichever is free.
        if want_dept:
            own = [r for r in ROOMS if r.get("specialized_dept_id") == want_dept and eligible(r)]
            if own:
                r = min(own, key=lambda r: (r["type"] != "special", r["id"]))
                return r["id"], r["name"], r["type"]

        # 2b. Already in a room next door in time? Stay in it.
        #     Walking is what happens BETWEEN back-to-back periods, so the
        #     cheapest room is the one the class is in either side of this one —
        #     and that is invisible to a rule that only knows about homerooms.
        if group_id is not None and not wants_outdoor:
            lvl_ = _level_key(grp)
            nums = _class_periods_for_level(lvl_)
            neighbours = []
            if period in nums:
                i = nums.index(period)
                if i > 0:
                    neighbours.append(nums[i - 1])
                if i + 1 < len(nums):
                    neighbours.append(nums[i + 1])
            for n in neighbours:
                near = next((x for x in SLOTS
                             if x["group_id"] == group_id and x["day"] == day
                             and x["period"] == n and x.get("room_id")), None)
                if not near:
                    continue
                r = r_map.get(near["room_id"])
                if r and not room_taken(r["id"]) and _room_usable(r) \
                        and _room_free_for(r, teacher_id) and not upstairs(r) \
                        and not (r.get("specialized_dept_id")
                                 and r["specialized_dept_id"] != want_dept):
                    return r["id"], r["name"], r["type"]

        # 3. Stay in the group's homeroom for ordinary subjects.
        if home and not wants_outdoor and not room_taken(home):
            r = r_map.get(home)
            if r and _room_free_for(r, teacher_id) and not upstairs(r):
                return home, r["name"], r["type"]

        # 3b. A class with no ห้องประจำชั้น gets one chosen for it now, BEFORE it
        #     would otherwise be sent to the teacher's own room. Without this
        #     the class follows a different teacher every period and walks all
        #     day; one class staying put costs one teacher a walk instead of
        #     forty students. Preferring a room no other class has claimed
        #     keeps the classes from fighting over the same few rooms.
        if (group_id is not None and not grp.get("homeroom_room_id")
                and group_id not in anchor_room and not wants_outdoor):
            taken_anchors = set(anchor_room.values())
            free = [r for r in ROOMS
                    if r["type"] in ("physical", "floating")
                    and not r.get("specialized_dept_id")
                    and r["id"] not in homeroom_ids and eligible(r)]
            if free:
                pick = min(free, key=lambda r: (
                    r["id"] in taken_anchors,
                    0 if r.get("capacity", 40) >= grp.get("size", 40) else 1,
                    -int(r.get("capacity") or 0),
                    r["id"]))
                anchor_room[group_id] = pick["id"]
                return pick["id"], pick["name"], pick["type"]

        # 4. Teacher's own fixed room (skip for outdoor subjects).
        if fr and not wants_outdoor and not room_taken(fr):
            r = r_map.get(fr)
            if r:
                return fr, r["name"], r["type"]

        group_size = grp.get("size", 40)

        def rank(r: dict) -> tuple:
            if wants_outdoor:
                pref = {"outdoor": 0, "physical": 1, "floating": 2, "special": 3}
            else:
                pref = {"physical": 0, "floating": 1, "special": 2, "outdoor": 3}
            # Seat the class somewhere it fits when we can — but a tight room
            # still beats no room, so this orders rather than excludes.
            too_small = 1 if r.get("capacity", 40) < group_size else 0
            return (1 if upstairs(r) else 0, too_small, pref.get(r["type"], 4), r["id"])

        for r in sorted((r for r in ROOMS if eligible(r)), key=rank):
            # First ordinary room this class gets becomes its anchor, so the
            # rest of its week comes back here instead of wandering.
            if (group_id is not None and not grp.get("homeroom_room_id")
                    and group_id not in anchor_room
                    and not wants_outdoor and r["type"] in ("physical", "floating")
                    and not r.get("specialized_dept_id")):
                anchor_room[group_id] = r["id"]
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
            for b in cell_buckets(req["group_id"], period):
                room_busy.add((rid, day, b))
        return slot

    # Separate parallel vs solo
    parallel: dict[str, list] = {}
    solo: list[dict] = []
    for req in REQUIREMENTS:
        if req["id"] in skipped_reqs:
            continue          # วิชาที่ผู้ใช้สั่งไม่ให้นำมาลงตาราง
        pgk = req.get("parallel_group_key")
        if pgk:
            parallel.setdefault(pgk, []).append(req)
        else:
            solo.append(req)

    class_period_set = set(class_periods)
    def teacher_free(tid, day, gid, period) -> bool:
        return not any((tid, day, b) in teacher_busy for b in cell_buckets(gid, period))

    # How many of this class's five days already have a lesson in this period.
    # Used to spread a class's lessons across its periods: without it the slack
    # in a timetable all pools into whichever period is chosen last, leaving
    # one column empty across the week while the rest run full.
    class_period_load: dict[tuple[int, int], int] = defaultdict(int)

    def book(tid, gid, day, period) -> None:
        for b in cell_buckets(gid, period):
            teacher_busy.add((tid, day, b))
        sp = span_of(gid, period)
        if sp:
            teacher_spans[(tid, day)].append(sp)
        group_busy.add((gid, day, period))
        class_period_load[(gid, period)] += 1

    def unbook(tid, gid, day, period, room_id=None) -> None:
        """Release a cell, so a proposed move can be judged without the lesson
        blocking itself. The exact inverse of book()."""
        for b in cell_buckets(gid, period):
            teacher_busy.discard((tid, day, b))
            if room_id:
                room_busy.discard((room_id, day, b))
        group_busy.discard((gid, day, period))
        if class_period_load[(gid, period)] > 0:
            class_period_load[(gid, period)] -= 1
        sp = span_of(gid, period)
        if sp and sp in teacher_spans[(tid, day)]:
            teacher_spans[(tid, day)].remove(sp)

    def rebook(tid, gid, day, period, room_id=None) -> None:
        book(tid, gid, day, period)
        if room_id:
            for b in cell_buckets(gid, period):
                room_busy.add((room_id, day, b))

    # เวรคาบสุดท้าย — how many last-period lessons each teacher already has,
    # and how many they still owe.
    school_last_min = _school_min_last_period(body)
    last_period_done: dict[int, int] = defaultdict(int)
    for s_ in SLOTS:
        if s_.get("teacher_id") is None:
            continue
        lvl_ = _level_key(g_map.get(s_["group_id"]))
        if s_["period"] == _last_period_for(lvl_):
            last_period_done[s_["teacher_id"]] += 1

    def last_period_target(tid: int) -> int:
        own = _teacher_prefs(t_map.get(tid))["min_last_period"]
        return school_last_min if own is None else own

    def last_period_shortfall(tid: int) -> int:
        return max(0, last_period_target(tid) - last_period_done[tid])

    def run_if_placed(tid, gid, day, period) -> int:
        """Length of the back-to-back run this placement would create."""
        sp = span_of(gid, period)
        if not sp:
            return 1
        return _run_length(teacher_spans[(tid, day)], sp[0], sp[1])

    def lunch_adjacent(gid: int, period: int) -> bool:
        sp = span_of(gid, period)
        if not sp:
            return False
        return _touches_lunch(_periods_for_level(_level_key(g_map.get(gid))), sp[0], sp[1])

    def double_starts(gid: int):
        """Where a double may start for this class — truly back-to-back only."""
        lvl = _level_key(g_map.get(gid))
        return [(d, p) for d in range(5) for p in _class_periods_for_level(lvl)
                if _next_class_period_for(lvl, p) is not None]

    def place_single(req, gid, tid, needed):
        """Place up to `needed` single periods; returns how many placed.

        Tried in four passes, each loosening what we will settle for:
          1. the teacher's own preferences AND a short run away from lunch
          2. preferences honoured, run still short, lunch allowed
          3. preferences honoured, up to the teacher's hard ceiling
          4. preferences dropped — better a lesson placed than a lesson lost
        A lesson that cannot be placed even then is reported, rather than
        stacking a teacher up to seven periods in a row as it used to.
        """
        hard = _consec_limit(t_map.get(tid), consec_hard)
        prefs = _teacher_prefs(t_map.get(tid))
        lvl = _level_key(g_map.get(gid))
        morning_end = _morning_cutoff(lvl)
        wants_morning = _prefers_morning(s_map.get(req["subject_id"]))
        placed = 0
        for attempt in range(4):
            if placed >= needed:
                break
            cells = cells_for(gid)
            random.shuffle(cells)
            # Teachers still short of their last-period duty get those cells
            # first; a morning subject gets the morning first. Both are only an
            # ordering — nothing is excluded by them.
            needs_last = last_period_shortfall(tid) > 0
            last_num = _last_period_for(lvl)
            def rank(cell):
                day, period = cell
                morning = wants_morning and morning_end is not None and period <= morning_end
                duty = needs_last and period == last_num
                return (
                    0 if duty else 1,
                    0 if morning or not wants_morning else 1,
                    # Spread: this class's emptiest period first. Every period
                    # then fills at about the same rate, so whatever slack the
                    # timetable has is shared out instead of hollowing out one
                    # column of the week.
                    class_period_load[(gid, period)],
                    # Sitting down straight after lunch is slightly worse than
                    # not; a tie-break, never a reason to skip the period.
                    1 if lunch_adjacent(gid, period) else 0,
                )
            cells.sort(key=rank)

            for day, period in cells:
                if placed >= needed:
                    break
                if attempt < 3:
                    if day in prefs["days_off"]:
                        continue            # the teacher does not work this day
                    if period in prefs["avoid_periods"]:
                        continue
                if not teacher_free(tid, day, gid, period):
                    continue
                if group_occupied(gid, day, period):
                    continue
                run = run_if_placed(tid, gid, day, period)
                # The run limit is a real rule and stays. "Next to lunch" is
                # not: refusing it outright starved the one period that sits
                # after lunch — 54% full against 97-100% everywhere else, with
                # six classes free in it all week — so it is now only an
                # ordering preference, applied in rank() above.
                if attempt == 0 and run > consec_soft:
                    continue
                if attempt == 1 and run > consec_soft:
                    continue
                if run > hard:
                    continue
                slot = make_slot(req, day, period)
                SLOTS.append(slot)
                book(tid, gid, day, period)
                if period == last_num:
                    last_period_done[tid] += 1
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
            hard = _consec_limit(t_map.get(tid), consec_hard)
            lvl = _level_key(g_map.get(gid))
            # A double is two in a row by definition, so it only has room to
            # sit beside one more period before hitting the ceiling.
            for attempt in range(2):
                if pairs_needed <= 0:
                    break
                cells = double_starts(gid)
                random.shuffle(cells)
                for day, p in cells:
                    if pairs_needed <= 0:
                        break
                    p2 = _next_class_period_for(lvl, p)
                    if p2 is None:
                        continue
                    if not teacher_free(tid, day, gid, p) or not teacher_free(tid, day, gid, p2):
                        continue
                    if group_occupied(gid, day, p) or group_occupied(gid, day, p2):
                        continue
                    # Measure the pair as a whole: placing the first then the
                    # second separately would under-count the run.
                    sp1, sp2 = span_of(gid, p), span_of(gid, p2)
                    if sp1 and sp2:
                        run = _run_length([*teacher_spans[(tid, day)], sp2], sp1[0], sp1[1])
                        if attempt == 0 and run > consec_soft:
                            continue
                        if run > hard:
                            continue
                    s1 = make_slot(req, day, p)
                    s1["is_double_start"] = True
                    s2 = make_slot(req, day, p2)
                    SLOTS.append(s1); SLOTS.append(s2)
                    for pp in (p, p2):
                        book(tid, gid, day, pp)
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
            unplaced_ids.append(req["id"])
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
                    # The period must be a lesson period for THIS class's level
                    # and the teacher free at the matching time of day.
                    lvl = _level_key(g_map.get(r["group_id"]))
                    if per_ not in _class_periods_for_level(lvl):
                        return False
                    if not teacher_free(r["teacher_id"], day_, r["group_id"], per_):
                        return False
                    if group_occupied(r["group_id"], day_, per_):
                        return False
                    # Parallel lessons went in without any run check, so a
                    # teacher could be stacked up here however long.
                    if run_if_placed(r["teacher_id"], r["group_id"], day_, per_) \
                            > _consec_limit(t_map.get(r["teacher_id"]), consec_hard):
                        return False
            return True

        def place_block(day_, periods_to_fill):
            for i, per_ in enumerate(periods_to_fill):
                for req in reqs:
                    slot = make_slot(req, day_, per_)
                    if i == 0 and len(periods_to_fill) > 1:
                        slot["is_double_start"] = True
                    SLOTS.append(slot)
                    book(req["teacher_id"], req["group_id"], day_, per_)

        placed = 0
        created_here = 0
        if is_double and needed >= 2:
            pairs = needed // 2
            lead_lvl = _level_key(g_map.get(reqs[0]["group_id"]))
            cells = double_starts(reqs[0]["group_id"])
            random.shuffle(cells)
            for day, p in cells:
                if pairs <= 0:
                    break
                p2 = _next_class_period_for(lead_lvl, p)
                if p2 is None or not all_free([(day, p), (day, p2)]):
                    continue
                place_block(day, [p, p2])
                created_here += 2 * len(reqs)
                placed       += 2
                pairs        -= 1

        # Remaining single periods
        remaining = needed - placed
        if remaining > 0:
            cells = cells_for(reqs[0]["group_id"])
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


    # ── เวรคาบสุดท้าย: a repair pass ──────────────────────────────────────────
    # Preferring the last period while placing gets most teachers there, but a
    # teacher whose lessons all happened to land early has no way back. So,
    # afterwards, look for one of their lessons that could simply move into a
    # free last period and move it. Nothing is created or deleted — a lesson
    # changes cell, and only if every rule still holds at the new one.
    def movable_of(tid: int) -> list[dict]:
        return [x for x in SLOTS
                if x.get("teacher_id") == tid and not x.get("is_locked")
                and not x.get("is_elective") and not x.get("parallel_group_key")]

    def reseat(slot: dict, day: int, period: int) -> None:
        """Put a lesson in a new cell and give it a room there."""
        tid, gid = slot["teacher_id"], slot["group_id"]
        rid, rname, rtype = find_room(tid, day, period, slot.get("subject_id"), gid)
        slot["day"], slot["period"] = day, period
        slot["room_id"], slot["room_name"], slot["room_type"] = rid, rname, rtype
        book(tid, gid, day, period)
        if rid:
            for b in cell_buckets(gid, period):
                room_busy.add((rid, day, b))

    def can_take(teacher: dict, gid: int, day: int, period: int) -> bool:
        prefs = _teacher_prefs(teacher)
        if day in prefs["days_off"] or period in prefs["avoid_periods"]:
            return False
        return (teacher_free(teacher["id"], day, gid, period)
                and run_if_placed(teacher["id"], gid, day, period)
                <= _consec_limit(teacher, consec_hard))

    last_period_fixed = 0
    last_period_swapped = 0
    for teacher in TEACHERS:
        tid = teacher["id"]
        short = last_period_shortfall(tid)
        if short <= 0:
            continue
        mine = movable_of(tid)
        random.shuffle(mine)

        # (a) The easy case: a free last period to move a lesson into.
        for slot in mine:
            if short <= 0:
                break
            gid = slot["group_id"]
            target = _last_period_for(_level_key(g_map.get(gid)))
            if target is None or slot["period"] == target:
                continue
            for day in random.sample(range(5), 5):
                if group_occupied(gid, day, target):
                    continue
                # Free the lesson's current cell before judging the new one,
                # or it collides with itself.
                old_day, old_period = slot["day"], slot["period"]
                unbook(tid, gid, old_day, old_period, slot.get("room_id"))
                if not can_take(teacher, gid, day, target):
                    rebook(tid, gid, old_day, old_period, slot.get("room_id"))
                    continue
                reseat(slot, day, target)
                last_period_done[tid] += 1
                last_period_fixed += 1
                short -= 1
                break

        # (b) The real case. In this school the last period is the fullest of
        #     the day — every class already has a lesson in it, so there is no
        #     empty cell to move into and (a) can never fire. The only way to
        #     give this teacher a last period is to trade one: take a class
        #     they already teach, find whoever has that class's last period,
        #     and exchange the two lessons. Both teachers must end up legal,
        #     and the other one must not be left short of their own duty.
        if short <= 0:
            continue
        for slot in mine:
            if short <= 0:
                break
            gid = slot["group_id"]
            target = _last_period_for(_level_key(g_map.get(gid)))
            if target is None or slot["period"] == target:
                continue
            for day in random.sample(range(5), 5):
                other = next((x for x in SLOTS
                              if x["group_id"] == gid and x["day"] == day
                              and x["period"] == target
                              and x.get("teacher_id") not in (None, tid)
                              and not x.get("is_locked") and not x.get("is_elective")
                              and not x.get("parallel_group_key")), None)
                if other is None:
                    continue
                o_teacher = t_map.get(other["teacher_id"])
                if not o_teacher:
                    continue
                oid = o_teacher["id"]
                # Don't rob a teacher who needs the duty themselves.
                if last_period_done[oid] - 1 < last_period_target(oid):
                    continue
                a_day, a_period, a_room = slot["day"], slot["period"], slot.get("room_id")
                b_room = other.get("room_id")
                # Vacate both cells, then judge each teacher in the other's.
                unbook(tid, gid, a_day, a_period, a_room)
                unbook(oid, gid, day, target, b_room)
                if can_take(teacher, gid, day, target) and can_take(o_teacher, gid, a_day, a_period):
                    reseat(slot, day, target)
                    reseat(other, a_day, a_period)
                    last_period_done[tid] += 1
                    last_period_done[oid] -= 1
                    last_period_swapped += 1
                    short -= 1
                    break
                rebook(tid, gid, a_day, a_period, a_room)
                rebook(oid, gid, day, target, b_room)

    # Only teachers who actually have lessons can be given a last period.
    teaching = [t for t in TEACHERS if any(r["teacher_id"] == t["id"] for r in REQUIREMENTS)]
    expected = [t for t in teaching if last_period_target(t["id"]) > 0]
    last_period_stats = {
        "teachers": len(expected),
        "met": sum(1 for t in expected if last_period_shortfall(t["id"]) <= 0),
        "moved": last_period_fixed,
        "swapped": last_period_swapped,
        "school_min": school_last_min,
    }

    missing_last = sorted(
        t["name"] for t in teaching
        if last_period_shortfall(t["id"]) > 0
    )
    if missing_last:
        violations.append(
            f"ครู {len(missing_last)} คนยังไม่ได้เวรคาบสุดท้ายครบ "
            f"({', '.join(missing_last[:4])}{' …' if len(missing_last) > 4 else ''})"
        )

    status = "FEASIBLE" if not violations else "INFEASIBLE"
    LAST_RUN["unplaced_requirement_ids"] = unplaced_ids
    LAST_RUN["skipped_requirement_ids"] = sorted(skipped_reqs)
    return {
        "status": status,
        "slots_created": created,
        "solve_time_seconds": round(_time.perf_counter() - _t0, 2),
        "objective_value": float(created * 10),
        "violations": violations,
        "engine": "greedy",
        "unplaced_requirement_ids": unplaced_ids,
        "skipped_requirement_ids": sorted(skipped_reqs),
        "max_consecutive": consec_hard,
        "prefer_consecutive": consec_soft,
        "consecutive": _consecutive_report(),
        "walking": _walking_report(),
        "last_period": last_period_stats,
    }




def _walking_report() -> dict[str, Any]:
    """How much walking the timetable actually asks for.

    A room change between back-to-back periods is a walk; a change with a break
    in between is not, so only adjacent pairs are counted. Reported for classes
    and teachers separately, because the two are traded against each other —
    keeping a class in its homeroom means the teacher comes to them instead.
    """
    g_map = {g["id"]: g for g in _flat_groups()}

    def moves(key: str) -> tuple[int, int]:
        by_day: dict[tuple, list[tuple[int, int, int | None]]] = defaultdict(list)
        for s in SLOTS:
            who = s.get(key)
            if who is None:
                continue
            lvl = _level_key(g_map.get(s["group_id"]))
            row = _periods_for_level(lvl).get(s["period"])
            if not row:
                continue
            start, end = _hhmm(row.get("start_time")), _hhmm(row.get("end_time"))
            if start is None or end is None:
                continue
            by_day[(who, s["day"])].append((start, end, s.get("room_id")))
        walks = total = 0
        for spans in by_day.values():
            spans.sort()
            for a, b in zip(spans, spans[1:]):
                if b[0] - a[1] >= _GAP_IS_REST:
                    continue              # a real break — not a dash between rooms
                total += 1
                if a[2] != b[2]:
                    walks += 1
        return walks, total

    cls_walk, cls_pairs = moves("group_id")
    tch_walk, tch_pairs = moves("teacher_id")

    # How often a class is taught in its own homeroom at all.
    home_hit = home_total = 0
    for s in SLOTS:
        home = g_map.get(s["group_id"], {}).get("homeroom_room_id")
        if not home:
            continue
        home_total += 1
        if s.get("room_id") == home:
            home_hit += 1

    def pct(a: int, b: int) -> int:
        return round(a * 100 / b) if b else 0

    # Why the walking is as high as it is. A class with no ห้องประจำชั้น has
    # nothing holding it in place, so it goes wherever is free and walks all
    # week. The solver settles on a room for such a class where it can, but it
    # cannot invent classrooms: if there is no spare ordinary room, the class
    # has to move whatever the solver does. Those two numbers are the honest
    # answer to "why do the students walk so much", and both are the school's
    # to fix, not the solver's — so they are reported rather than buried.
    leaves = [g for g in g_map.values() if not g.get("children")]
    homeroom_ids = {g["homeroom_room_id"] for g in leaves if g.get("homeroom_room_id")}
    no_home = [g for g in leaves if not g.get("homeroom_room_id")]
    spare = [r for r in ROOMS
             if r.get("type") in ("physical", "floating")
             and not r.get("specialized_dept_id")
             and _room_usable(r) and r["id"] not in homeroom_ids]

    return {
        "class_moves": cls_walk, "class_pairs": cls_pairs,
        "class_move_pct": pct(cls_walk, cls_pairs),
        "teacher_moves": tch_walk, "teacher_pairs": tch_pairs,
        "teacher_move_pct": pct(tch_walk, tch_pairs),
        "homeroom_hits": home_hit, "homeroom_total": home_total,
        "homeroom_pct": pct(home_hit, home_total),
        "classes_without_homeroom": len(no_home),
        "spare_ordinary_rooms": len(spare),
    }


def _consecutive_report() -> dict[str, Any]:
    """How long the teaching runs actually came out, measured on the clock.

    The solver promises a ceiling; this is the check on that promise, shown
    after a run so the school can see the shape of the week rather than take
    it on trust. A gap shorter than a proper break does not end a run, so two
    periods either side of a ten-minute break count as one stretch.
    """
    g_map = {g["id"]: g for g in _flat_groups()}
    by_day: dict[tuple[int, int], set[tuple[int, int]]] = defaultdict(set)
    for s in SLOTS:
        lvl = _level_key(g_map.get(s["group_id"]))
        row = _periods_for_level(lvl).get(s["period"])
        if not row:
            continue
        span = (_hhmm(row.get("start_time")), _hhmm(row.get("end_time")))
        if None in span:
            continue
        tids = {s["teacher_id"]} if s.get("teacher_id") else set()
        tids |= _elective_option_teachers(s)
        for tid in tids:
            by_day[(tid, s["day"])].add(span)

    lengths: dict[int, int] = defaultdict(int)
    worst_teacher: int | None = None
    worst = 0
    for (tid, _day), spans in by_day.items():
        ordered = sorted(spans)
        run = 1
        for a, b in zip(ordered, ordered[1:]):
            if b[0] - a[1] < _GAP_IS_REST:
                run += 1
            else:
                lengths[run] += 1
                if run > worst:
                    worst, worst_teacher = run, tid
                run = 1
        lengths[run] += 1
        if run > worst:
            worst, worst_teacher = run, tid
    name = next((t["name"] for t in TEACHERS if t["id"] == worst_teacher), None)
    return {
        "runs": {str(k): lengths[k] for k in sorted(lengths)},
        "longest": worst,
        "longest_teacher": name,
    }


def _solve_cpsat(body: dict[str, Any]) -> dict[str, Any]:
    skipped_reqs = _excluded_requirement_ids(body)
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
        bks = _slot_buckets(g_map.get(s["group_id"]), s["period"])
        tids = set()
        if s.get("teacher_id") is not None:
            tids.add(s["teacher_id"])
        # Shared electives run all options at once — hold every option's teacher.
        tids |= _elective_option_teachers(s)
        for tid in tids:
            for b in bks:
                busy_teacher.add((tid, s["day"], b))
        busy_group.add((s["group_id"], s["day"], s["period"]))
        if s.get("room_id"):
            for b in bks:
                busy_room.add((s["room_id"], s["day"], b))

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
        if req["id"] in skipped_reqs:
            continue          # วิชาที่ผู้ใช้สั่งไม่ให้นำมาลงตาราง
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

    def occ_level(occ) -> str:
        return _level_key(g_map.get(occ["group_id"]))

    def valid_starts(occ, length):
        """Where this lesson may start — in its own class's version of the day."""
        lvl = occ_level(occ)
        nums = _class_periods_for_level(lvl)
        if length == 2:
            return [(d, p) for d in range(DAYS_N) for p in nums
                    if _next_class_period_for(lvl, p) is not None]
        return [(d, p) for d in range(DAYS_N) for p in nums]

    def covered(occ, length, d, p):
        if length == 1:
            return [(d, p)]
        return [(d, p), (d, _next_class_period_for(occ_level(occ), p))]

    def occ_buckets(occ, d, p):
        """(day, 5-minute bucket) pairs this lesson would occupy on the clock."""
        lvl = occ_level(occ)
        return [(d, b) for b in _period_buckets(lvl, p)]

    def compatible_rooms(occ):
        subj = s_map.get(occ["subject_id"], {})
        teacher = t_map.get(occ["teacher_id"], {})
        grp = g_map.get(occ["group_id"], {})
        size = grp.get("size", 40)
        wants_outdoor = subj.get("department_id") in dep_out
        # A specialised room belongs to whoever teaches the subject, not to the
        # teacher's own กลุ่มสาระ — a maths teacher taking a computer period
        # still needs the lab.
        t_dept = subj.get("department_id") or teacher.get("department_id")
        subj_room = subj.get("fixed_room_id")
        out = []
        for r in ROOMS:
            # The subject's own designated room is always allowed — the school
            # chose it deliberately, so capacity/type rules don't exclude it.
            if subj_room and r["id"] == subj_room:
                out.append(r)
                continue
            if not _room_usable(r):
                continue
            if not _room_free_for(r, occ["teacher_id"]):
                continue
            if r.get("specialized_dept_id") and r["specialized_dept_id"] != t_dept:
                continue
            # Capacity is advisory, not a veto. The seat counts were estimated
            # when the rooms were imported, and the school's largest classes
            # (ม.6/10 has 48) exceed every one of them — treating that as
            # impossible would leave those classes with no timetable at all,
            # while the greedy solver seats them happily. A room that is too
            # small is penalised below instead, so roomier ones win when free.
            if wants_outdoor and r["type"] != "outdoor":
                # outdoor subjects only outdoors
                continue
            if not wants_outdoor and r["type"] == "outdoor":
                continue
            out.append(r)
        return out

    def shortlist_rooms(occ: dict, limit: int) -> list[dict]:
        """The few rooms worth considering for this lesson.

        Every room a lesson *could* use becomes a boolean variable at every
        candidate time, so handing CP-SAT all 136 rooms costs millions of
        variables and the solver process is killed before it answers. The rooms
        that actually matter are few and known: the subject's own room, the
        department's labs, the class's homeroom, the teacher's room. Beyond
        those, one ordinary classroom is as good as another.

        The generic fallbacks start at an offset derived from the class, so two
        classes do not shortlist the same handful and make the model
        unsatisfiable for want of somewhere to sit.
        """
        rooms = compatible_rooms(occ)
        subj = s_map.get(occ["subject_id"], {})
        want_dept = subj.get("department_id")
        home  = g_map.get(occ["group_id"], {}).get("homeroom_room_id")
        fixed = t_map.get(occ["teacher_id"], {}).get("fixed_room_id")

        by_id = {r["id"]: r for r in rooms}
        picked: dict[int, dict] = {}

        def take(rid):
            if rid and rid in by_id and rid not in picked:
                picked[rid] = by_id[rid]

        take(subj.get("fixed_room_id"))
        for r in rooms:
            if want_dept and r.get("specialized_dept_id") == want_dept:
                take(r["id"])
        take(home)
        take(fixed)

        generic = [r for r in rooms if r["id"] not in picked]
        if generic:
            start = (occ["group_id"] * 7) % len(generic)
            for i in range(len(generic)):
                if len(picked) >= limit:
                    break
                take(generic[(start + i) % len(generic)]["id"])
        return list(picked.values())

    # How many rooms each lesson may choose between. Trimmed below if the model
    # would still be too large to build.
    room_limit = int(body.get("room_choices") or 6)
    n_starts = DAYS_N * len(class_periods)
    est = len(occurrences) * n_starts * room_limit
    # Booleans we can build and search without the host running out of memory.
    # The free Render box has 512MB, and each search worker holds its own copy
    # of the model, so the ceiling is far lower than the maths alone suggests.
    # Move this up when the backend moves to a bigger machine.
    BUDGET = int(body.get("max_model_vars") or 150_000)
    while room_limit > 2 and est > BUDGET:
        room_limit -= 1
        est = len(occurrences) * n_starts * room_limit
    if est > BUDGET:
        # Even at the floor this will not fit. Say so and let the caller fall
        # back, rather than being killed mid-build and returning nothing.
        raise MemoryError(
            f"ตารางนี้ใหญ่เกินกว่าจะใช้ CP-SAT บนเซิร์ฟเวอร์ปัจจุบัน "
            f"({len(occurrences)} คาบ ≈ {est:,} ตัวแปร)"
        )

    # ── Variables ──────────────────────────────────────────────────────────────
    start_vars   = {}   # (idx, d, p) -> BoolVar
    room_vars    = {}   # (idx, d, p, rid) -> BoolVar
    teacher_occ  = defaultdict(list)
    # (teacher, day, period number) -> the starts that would occupy it, used by
    # the back-to-back limit, which reasons in periods rather than minutes.
    teacher_occ_by_period = defaultdict(list)
    group_occ    = defaultdict(list)   # keyed by exact group id
    room_occ     = defaultdict(list)
    penalty_terms = []   # (weight, var) minimise sum(weight*var)

    # Rooms each กลุ่มสาระ owns (ห้องเฉพาะกลุ่มสาระ). A lesson whose department
    # owns rooms should land in one of them; there may be several (five computer
    # labs serve one subject), so this is a per-department set, not one room.
    dept_rooms: dict[int, set[int]] = defaultdict(set)
    for r in ROOMS:
        if r.get("specialized_dept_id"):
            dept_rooms[r["specialized_dept_id"]].add(r["id"])

    for idx, occ in enumerate(occurrences):
        starts = valid_starts(occ, occ["length"])
        rooms = shortlist_rooms(occ, room_limit)
        group_size = g_map.get(occ["group_id"], {}).get("size", 40)
        homeroom = g_map.get(occ["group_id"], {}).get("homeroom_room_id")
        fixed = t_map.get(occ["teacher_id"], {}).get("fixed_room_id")
        subj = s_map.get(occ["subject_id"], {})
        wants_outdoor = subj.get("department_id") in dep_out
        subj_room = subj.get("fixed_room_id")   # ห้องประจำวิชา
        own_rooms = dept_rooms.get(subj.get("department_id") or -1, set())

        occ_start_list = []
        for (d, p) in starts:
            cells = covered(occ, occ["length"], d, p)
            # Teachers and rooms are held by the clock, so the keys are
            # (day, 5-minute bucket) — the two levels number the same period
            # differently and sit it at a different time.
            tslots = [t for cd, cp_ in cells for t in occ_buckets(occ, cd, cp_)]
            if any((occ["teacher_id"], cd, b) in busy_teacher for cd, b in tslots):
                continue
            if any(group_prebusy(occ["group_id"], cd, cp_) for cd, cp_ in cells):
                continue
            sv = model.NewBoolVar(f"s_{idx}_{d}_{p}")
            start_vars[(idx, d, p)] = sv
            occ_start_list.append(sv)
            for cd, b in tslots:
                teacher_occ[(occ["teacher_id"], cd, b)].append(sv)
            for cd, cp_ in cells:
                teacher_occ_by_period[(occ["teacher_id"], cd, cp_)].append(sv)
                group_occ[(occ["group_id"], cd, cp_)].append(sv)
            # room choice
            rlist = []
            for r in rooms:
                if any((r["id"], cd, b) in busy_room for cd, b in tslots):
                    continue
                rv = model.NewBoolVar(f"r_{idx}_{d}_{p}_{r['id']}")
                room_vars[(idx, d, p, r["id"])] = rv
                rlist.append(rv)
                for cd, b in tslots:
                    room_occ[(r["id"], cd, b)].append(rv)
                # Walking penalties, strongest first.
                if subj_room:
                    # ห้องประจำวิชา wins over the class's homeroom — the subject
                    # needs that facility, so anything else is heavily penalised.
                    if r["id"] != subj_room:
                        penalty_terms.append((60, rv))
                elif own_rooms:
                    # The department owns labs/studios. Use one if at all
                    # possible; there may be fewer than the weekly load needs,
                    # so this is a strong preference, not a hard rule.
                    if r["id"] not in own_rooms:
                        penalty_terms.append((40, rv))
                        if homeroom and r["id"] != homeroom:
                            penalty_terms.append((5, rv))
                elif not wants_outdoor:
                    if homeroom and r["id"] != homeroom:
                        penalty_terms.append((5, rv))      # student leaves homeroom
                    if fixed and r["id"] != fixed and not homeroom:
                        penalty_terms.append((3, rv))      # teacher leaves fixed room
                    if r["type"] == "special":
                        penalty_terms.append((1, rv))      # mild: avoid burning special rooms
                # Prefer a room the class actually fits in, without ruling the
                # tight ones out — see compatible_rooms.
                if r.get("capacity", 40) < group_size:
                    penalty_terms.append((8, rv))
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

    # ── No teacher gets too many periods back to back ──────────────────────────
    # The same ceiling the greedy solver applies, as a hard constraint: for
    # every run of (limit + 1) touching time bands on a day, a teacher may
    # occupy at most `limit` of them.
    consec_hard, _soft = _consec_settings(body)
    bands_by_day: dict[int, list[list[int]]] = {}
    for d in range(DAYS_N):
        # Distinct time bands either level is taught in, in clock order.
        bands: dict[tuple[int, int], set[int]] = {}
        for lvl in ("lower", "upper"):
            for num in _class_periods_for_level(lvl):
                row = _periods_for_level(lvl).get(num)
                a, b = _hhmm(row.get("start_time")), _hhmm(row.get("end_time"))
                if a is None or b is None:
                    continue
                bands.setdefault((a, b), set()).add(num)
        ordered = sorted(bands.items())
        # Keep only bands that genuinely touch the next one.
        chains: list[list[int]] = []
        current: list[set[int]] = []
        prev_end = None
        for (a, b), nums in ordered:
            if prev_end is not None and a - prev_end >= _GAP_IS_REST:
                if current:
                    chains.append([n for st in current for n in st])
                current = []
            current.append(nums)
            prev_end = b
        if current:
            chains.append([n for st in current for n in st])
        bands_by_day[d] = chains

    for tid in {occ["teacher_id"] for occ in occurrences}:
        limit = _consec_limit(t_map.get(tid), consec_hard)
        if limit >= 99:
            continue
        for d in range(DAYS_N):
            # Rebuild the chain as a list of band-groups so we can slide a
            # window of limit+1 over it.
            groups: list[list[int]] = []
            seen_nums: set[int] = set()
            for lvl in ("lower", "upper"):
                for num in _class_periods_for_level(lvl):
                    seen_nums.add(num)
            ordered_nums = sorted(seen_nums)
            if len(ordered_nums) <= limit:
                continue
            groups = [[n] for n in ordered_nums]
            for i in range(len(groups) - limit):
                window = [n for grp in groups[i:i + limit + 1] for n in grp]
                vs = [v for n in window for v in teacher_occ_by_period.get((tid, d, n), [])]
                if len(vs) > limit:
                    model.Add(sum(vs) <= limit)

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
            for (d, p) in valid_starts(occurrences[base], occurrences[base]["length"]):
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
    # Render's free tier cuts a request off at ~100s, so stay well inside it:
    # an answer that never arrives looks like a crash to the person waiting.
    solver.parameters.max_time_in_seconds = float(body.get("time_limit_seconds") or 45)
    # Each worker keeps its own copy of the model, so 8 of them multiply memory
    # by 8 on a 512MB box. Four is the most this host can carry.
    solver.parameters.num_search_workers = 4
    status = solver.Solve(model)

    ok = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    created = 0
    violations = []
    unplaced_ids: set[int] = set()

    if ok:
        for idx, occ in enumerate(occurrences):
            starts = valid_starts(occ, occ["length"])
            chosen = None
            for (d, p) in starts:
                sv = start_vars.get((idx, d, p))
                if sv is not None and solver.Value(sv) == 1:
                    chosen = (d, p); break
            if chosen is None:
                code = s_map.get(occ["subject_id"], {}).get("code", "?")
                unplaced_ids.add(occ["req_id"])
                violations.append(f"ไม่สามารถจัด {code} (กลุ่ม {occ['group_id']})")
                continue
            d, p = chosen
            # room
            rid = None
            for r in ROOMS:
                rv = room_vars.get((idx, d, p, r["id"]))
                if rv is not None and solver.Value(rv) == 1:
                    rid = r["id"]; break
            cells = covered(occ, occ["length"], d, p)
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

    LAST_RUN["unplaced_requirement_ids"] = sorted(unplaced_ids)
    LAST_RUN["skipped_requirement_ids"] = sorted(skipped_reqs)
    return {
        "status": "OPTIMAL" if status == cp_model.OPTIMAL else ("FEASIBLE" if ok else "INFEASIBLE"),
        "slots_created": created,
        "solve_time_seconds": round(_time.time() - t0, 2),
        "objective_value": float(solver.ObjectiveValue()) if (ok and penalty_terms) else None,
        "violations": violations,
        "engine": "cp-sat",
        "unplaced_requirement_ids": sorted(unplaced_ids),
        "skipped_requirement_ids": sorted(skipped_reqs),
        "max_consecutive": consec_hard,
        "consecutive": _consecutive_report(),
        "walking": _walking_report(),
        "last_period": last_period_stats,
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


def _find_group(gid: int) -> dict | None:
    return next((g for g in _flat_groups() if g["id"] == gid), None)


def _shares_students_fn():
    """Build "do these two classes hold the same students?".

    True for a class and itself, and for a class and any ancestor or descendant
    of it (ม.4/6 vs ม.4/6ก). False between siblings — ม.4/6ก and ม.4/6ข are
    different children and may well be taught at the same time.
    """
    parent_of = {g["id"]: g.get("parent_id") for g in _flat_groups()}

    def chain(gid: int) -> set[int]:
        out, cur = {gid}, parent_of.get(gid)
        while cur is not None and cur not in out:
            out.add(cur)
            cur = parent_of.get(cur)
        return out

    def shares(a: int, b: int) -> bool:
        return a == b or b in chain(a) or a in chain(b)

    return shares


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
    body.setdefault("applies_to", "all")
    # The number is the column this lands in, worked out from its time — the
    # caller does not have to know or guess it.
    if body.get("period_num") is None or body.get("auto_number"):
        body.pop("auto_number", None)
        PERIODS.append(body)
        cols = _column_groups()
        for i, col in enumerate(cols):
            if any(r is body for r in col):
                body["period_num"] = i
                break
        else:
            body["period_num"] = _max_id([{"id": p.get("period_num", 0)} for p in PERIODS]) + 1
        return body
    PERIODS.append(body)
    return body

# ── Period numbers should not be the school's problem ─────────────────────────
# period_num is an internal column index. It has to have gaps (a break is a
# column too) and duplicates (ม.1-3 and ม.4-6 each describe the same column
# differently), and every slot in the timetable refers to it. Asking a person to
# type it correctly means a stray number silently drops a period off the grid or
# merges two that should be apart.
#
# So it is derived instead: rows are sorted by the clock, rows that cover the
# same stretch of time are one column, and columns are numbered from zero. Any
# slot already placed is carried over to the new number of the column it was in.

def _period_sort_key(p: dict[str, Any]) -> tuple:
    start = _hhmm(p.get("start_time"))
    end = _hhmm(p.get("end_time"))
    return (start if start is not None else 9999,
            end if end is not None else 9999,
            p.get("period_num", 0))


def _column_groups() -> list[list[dict[str, Any]]]:
    """Rows grouped into columns: same time band, possibly one row per level."""
    rows = sorted(PERIODS, key=_period_sort_key)
    cols: list[list[dict[str, Any]]] = []
    for row in rows:
        start, end = _hhmm(row.get("start_time")), _hhmm(row.get("end_time"))
        placed = False
        for col in cols:
            # Same column when they overlap in time AND describe different
            # levels — two rows for the same level at the same time is a
            # mistake, not a column, and is reported rather than merged.
            levels = {c.get("applies_to", "all") or "all" for c in col}
            mine = row.get("applies_to", "all") or "all"
            if mine in levels or "all" in levels and mine != "all" and len(levels) > 1:
                continue
            ref = col[0]
            rs, re_ = _hhmm(ref.get("start_time")), _hhmm(ref.get("end_time"))
            if None in (start, end, rs, re_):
                continue
            if start < re_ and rs < end:          # the bands overlap
                col.append(row)
                placed = True
                break
        if not placed:
            cols.append([row])
    return cols


@app.get("/api/periods/plan")
def period_plan():
    """What the numbering would become, and anything wrong with the day.

    Shown before renumbering so nothing changes by surprise, and used on its own
    to point out gaps and clashes in the timetable's shape.
    """
    cols = _column_groups()
    plan, moves = [], []
    for new_num, col in enumerate(cols):
        for row in col:
            if row.get("period_num") != new_num:
                moves.append({"id": row["id"], "label": row.get("label"),
                              "from": row.get("period_num"), "to": new_num})
        plan.append({
            "period_num": new_num,
            "rows": [{"id": r["id"], "label": r.get("label"), "type": r.get("type"),
                      "start_time": r.get("start_time"), "end_time": r.get("end_time"),
                      "applies_to": r.get("applies_to", "all"),
                      "period_num": r.get("period_num")} for r in col],
        })

    # Gaps and overlaps, judged per level — the two have different days.
    issues = []
    for lvl in ("lower", "upper"):
        rows = sorted(
            (p for p in PERIODS if (p.get("applies_to", "all") or "all") in ("all", lvl)),
            key=_period_sort_key)
        who = "ม.1-3" if lvl == "lower" else "ม.4-6"
        seen_times: dict[tuple, list[str]] = {}
        for a, b in zip(rows, rows[1:]):
            ae, bs = _hhmm(a.get("end_time")), _hhmm(b.get("start_time"))
            if ae is None or bs is None:
                continue
            if bs > ae:
                issues.append({"level": lvl, "kind": "gap", "minutes": bs - ae,
                               "text": f"{who}: ว่าง {bs - ae} นาที ระหว่าง {a.get('end_time')} "
                                       f"ถึง {b.get('start_time')} (หลัง \"{a.get('label')}\")"})
            elif bs < ae:
                issues.append({"level": lvl, "kind": "overlap", "minutes": ae - bs,
                               "text": f"{who}: \"{a.get('label')}\" กับ \"{b.get('label')}\" "
                                       f"เวลาทับกัน {ae - bs} นาที"})
        for r in rows:
            key = (r.get("start_time"), r.get("end_time"))
            seen_times.setdefault(key, []).append(r.get("label") or "")
        for (st, en), labels in seen_times.items():
            if len(labels) > 1:
                issues.append({"level": lvl, "kind": "duplicate",
                               "text": f"{who}: มี {len(labels)} คาบที่เวลา {st}-{en} ซ้ำกัน "
                                       f"({', '.join(labels)})"})

    for lvl in ("lower", "upper"):
        nums = _class_periods_for_level(lvl)
        who = "ม.1-3" if lvl == "lower" else "ม.4-6"
        issues.append({"level": lvl, "kind": "capacity",
                       "text": f"{who}: เรียนได้ {len(nums)} คาบ/วัน = {len(nums) * 5} คาบ/สัปดาห์"})

    return {"plan": plan, "moves": moves, "issues": issues,
            "needs_renumber": len(moves) > 0}


@app.post("/api/periods/renumber")
def renumber_periods():
    """Renumber the columns from the clock, carrying the timetable with them."""
    cols = _column_groups()

    # (old number, level) -> new number, so a slot lands in the column it was
    # already in rather than on a number that now means something else.
    remap: dict[tuple[int, str], int] = {}
    for new_num, col in enumerate(cols):
        for row in col:
            old = row.get("period_num")
            lvl = row.get("applies_to", "all") or "all"
            if old is None:
                continue
            for key in (("all",) if lvl == "all" else (lvl,)):
                remap[(old, key)] = new_num
            if lvl == "all":
                remap[(old, "lower")] = new_num
                remap[(old, "upper")] = new_num

    moved = 0
    for s in SLOTS:
        lvl = _level_key(_find_group(s["group_id"]))
        new = remap.get((s["period"], lvl), remap.get((s["period"], "all")))
        if new is not None and new != s["period"]:
            s["period"] = new
            moved += 1
    for pool in ELECTIVE_POOLS:
        if pool.get("period") is None:
            continue
        lvls = {_level_key(_find_group(g)) for g in pool.get("group_ids", [])} or {"upper"}
        new = remap.get((pool["period"], next(iter(lvls))), remap.get((pool["period"], "all")))
        if new is not None:
            pool["period"] = new

    for new_num, col in enumerate(cols):
        for row in col:
            row["period_num"] = new_num

    return {"columns": len(cols), "slots_moved": moved,
            "plan": period_plan()}



@app.put("/api/periods/{pid}")
def update_period(pid: int, body: dict[str, Any]):
    for p in PERIODS:
        if p["id"] == pid:
            p.update(body)
            return p
    raise HTTPException(404, "Period not found")

@app.delete("/api/periods/{pid}")
def delete_period(pid: int):
    """Remove a period from the day.

    Any lesson taught in it goes too: the timetable has no column to show it
    in any more, so it would sit there invisible while still holding its
    teacher and room against everything else.
    """
    global PERIODS, SLOTS
    gone = next((p for p in PERIODS if p["id"] == pid), None)
    PERIODS = [p for p in PERIODS if p["id"] != pid]
    removed = 0
    if gone is not None:
        # Only if no other period definition still uses that number.
        still_used = any(p["period_num"] == gone["period_num"] and p["type"] == "class"
                         for p in PERIODS)
        if not still_used:
            before = len(SLOTS)
            SLOTS = [s for s in SLOTS if s["period"] != gone["period_num"]]
            removed = before - len(SLOTS)
            for pool in ELECTIVE_POOLS:
                if pool.get("period") == gone["period_num"]:
                    pool["day"] = None
                    pool["period"] = None
    return {"removed_slots": removed}

# ── Buildings & Rooms ─────────────────────────────────────────────────────────
@app.get("/api/rooms/buildings")
def get_buildings():
    return BUILDINGS

@app.post("/api/rooms/buildings")
def create_building(body: dict[str, Any]):
    body["id"] = max((b["id"] for b in BUILDINGS), default=0) + 1
    BUILDINGS.append(body)
    return body


# ── Deleting something that is still referenced ───────────────────────────────
# A bare `del` leaves the timetable pointing at a teacher, class or subject that
# no longer exists: the lessons stay on the board with blank names, keep their
# teacher and room reserved against everything else, and cannot be reached in
# the UI to be removed. So every delete cleans up after itself.

def _purge_teacher(tid: int) -> dict[str, int]:
    global SLOTS, REQUIREMENTS
    before_s, before_r = len(SLOTS), len(REQUIREMENTS)
    SLOTS = [s for s in SLOTS if s.get("teacher_id") != tid]
    REQUIREMENTS = [r for r in REQUIREMENTS if r.get("teacher_id") != tid]
    opts = 0
    for pool in ELECTIVE_POOLS:
        keep = [o for o in pool.get("options", []) if o.get("teacher_id") != tid]
        opts += len(pool.get("options", [])) - len(keep)
        if len(keep) != len(pool.get("options", [])):
            pool["options"] = keep
            _sync_pool_slots(pool)
    for s in SLOTS:
        if s.get("is_elective"):
            s["elective_options"] = [o for o in s.get("elective_options", [])
                                     if o.get("teacher_id") != tid]
    return {"slots": before_s - len(SLOTS), "requirements": before_r - len(REQUIREMENTS),
            "elective_options": opts}


def _purge_subject(sid: int) -> dict[str, int]:
    global SLOTS, REQUIREMENTS
    before_s, before_r = len(SLOTS), len(REQUIREMENTS)
    SLOTS = [s for s in SLOTS if s.get("subject_id") != sid]
    REQUIREMENTS = [r for r in REQUIREMENTS if r.get("subject_id") != sid]
    opts = 0
    for pool in ELECTIVE_POOLS:
        keep = [o for o in pool.get("options", []) if o.get("subject_id") != sid]
        opts += len(pool.get("options", [])) - len(keep)
        if len(keep) != len(pool.get("options", [])):
            pool["options"] = keep
            _sync_pool_slots(pool)
    for s in SLOTS:
        if s.get("is_elective"):
            s["elective_options"] = [o for o in s.get("elective_options", [])
                                     if o.get("subject_id") != sid]
    return {"slots": before_s - len(SLOTS), "requirements": before_r - len(REQUIREMENTS),
            "elective_options": opts}


def _purge_group(gid: int) -> dict[str, int]:
    """Remove a class and every subgroup under it."""
    doomed = {gid}
    stack = [gid]
    while stack:
        cur = stack.pop()
        for g in _flat_groups():
            if g.get("parent_id") == cur and g["id"] not in doomed:
                doomed.add(g["id"]); stack.append(g["id"])

    global SLOTS, REQUIREMENTS, GROUPS
    before_s, before_r = len(SLOTS), len(REQUIREMENTS)
    SLOTS = [s for s in SLOTS if s.get("group_id") not in doomed]
    REQUIREMENTS = [r for r in REQUIREMENTS if r.get("group_id") not in doomed]

    # A class may be a subgroup, so prune the tree rather than the top level.
    def prune(nodes: list) -> list:
        out = []
        for g in nodes:
            if g["id"] in doomed:
                continue
            if g.get("children"):
                g["children"] = prune(g["children"])
            out.append(g)
        return out
    GROUPS = prune(GROUPS)

    for pool in ELECTIVE_POOLS:
        keep = [x for x in pool.get("group_ids", []) if x not in doomed]
        if len(keep) != len(pool.get("group_ids", [])):
            pool["group_ids"] = keep
            _sync_pool_slots(pool)
    # A homeroom that no longer belongs to anyone must not stay reserved.
    for r in ROOMS:
        if r.get("homeroom_group_id") in doomed:
            r["homeroom_group_id"] = None
    return {"groups": len(doomed), "slots": before_s - len(SLOTS),
            "requirements": before_r - len(REQUIREMENTS)}


def _purge_room(rid: int) -> dict[str, int]:
    """Free the room from the timetable. The lessons themselves survive —
    losing a room is not a reason to lose the period it was taught in."""
    freed = 0
    for s in SLOTS:
        if s.get("room_id") == rid:
            s["room_id"] = None
            s["room_name"] = None
            s["room_type"] = None
            freed += 1
    for g in _flat_groups():
        if g.get("homeroom_room_id") == rid:
            g["homeroom_room_id"] = None
    for t in TEACHERS:
        if t.get("fixed_room_id") == rid:
            t["fixed_room_id"] = None
    for sub in SUBJECTS:
        if sub.get("fixed_room_id") == rid:
            sub["fixed_room_id"] = None
    return {"slots_unassigned": freed}


@app.get("/api/rooms/")
def get_rooms():
    return ROOMS

@app.post("/api/rooms/")
def create_room(body: dict[str, Any]):
    body["id"] = _next("room")
    body.setdefault("usable", True)
    body.setdefault("reserved_teacher_ids", [])
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
    removed = _purge_room(i)
    ROOMS = [r for r in ROOMS if r["id"] != i]
    return {"removed": removed}

@app.post("/api/rooms/bulk")
def bulk_create_rooms(body: list[dict[str, Any]]):
    created = []
    for row in body:
        row["id"] = _next("room")
        row.setdefault("building_name", None)
        row.setdefault("specialized_dept_id", None)
        row.setdefault("reserved_teacher_ids", [])
        row.setdefault("usable", True)
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
    # Walks the tree, so a subgroup (ม.4/6ก) deletes too — the old top-level
    # filter silently did nothing for those.
    return {"removed": _purge_group(i)}

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
    removed = _purge_teacher(i)
    TEACHERS = [t for t in TEACHERS if t["id"] != i]
    return {"removed": removed}

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
    body.setdefault("prefer_morning", False)
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
    removed = _purge_subject(i)
    SUBJECTS = [s for s in SUBJECTS if s["id"] != i]
    return {"removed": removed}

@app.post("/api/subjects/bulk")
def bulk_create_subjects(body: list[dict[str, Any]]):
    created = []
    for row in body:
        row["id"] = _next("subject")
        row.setdefault("type", "common")
        row.setdefault("prefer_morning", False)
        row.setdefault("duration", 1)
        row.setdefault("fixed_room_id", None)
        SUBJECTS.append(row)
        created.append(row)
    return created

@app.post("/api/subjects/prefer-morning")
def set_prefer_morning(body: dict[str, Any]):
    """Set ☀️ เช้า on many subjects at once.

    This school has 271 subjects. Marking a whole กลุ่มสาระ one row at a time
    is 40-odd clicks and 40-odd requests, so the choice is made once here.

    Which subjects: explicit "ids" if given, otherwise every subject in
    "department_id", otherwise — only when "all" is set — all of them. An
    empty body changes nothing rather than quietly flagging the whole school.
    """
    want = bool(body.get("prefer_morning"))
    ids = body.get("ids")

    if isinstance(ids, list):
        wanted = {int(x) for x in ids if str(x).lstrip("-").isdigit()}
        targets = [s for s in SUBJECTS if s["id"] in wanted]
    elif body.get("department_id") not in (None, ""):
        dept = int(body["department_id"])
        targets = [s for s in SUBJECTS if s.get("department_id") == dept]
    elif body.get("all"):
        targets = list(SUBJECTS)
    else:
        return {"changed": 0, "matched": 0, "subjects": []}

    changed = 0
    for s in targets:
        if bool(s.get("prefer_morning")) != want:
            s["prefer_morning"] = want
            changed += 1
    return {
        "changed": changed,
        "matched": len(targets),
        # The rows as they now are, so the page can update without refetching.
        "subjects": [{"id": s["id"], "prefer_morning": bool(s.get("prefer_morning"))}
                     for s in targets],
    }


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
    # Skip rows missing or pointing at something that is not there, rather than
    # crashing the whole import — or, worse, accepting a row that names a class
    # or teacher that does not exist and only failing when the timetable runs.
    gids = {g["id"] for g in _flat_groups()}
    tids = {t["id"] for t in TEACHERS}
    sids = {x["id"] for x in SUBJECTS}
    created, rejected = [], []
    for i, row in enumerate(body):
        if not row.get("group_id") or not row.get("subject_id") or not row.get("teacher_id"):
            rejected.append({"row": i, "reason": "ข้อมูลไม่ครบ (ต้องมีห้องเรียน วิชา และครู)"})
            continue
        missing = [label for label, val, pool in
                   (("ห้องเรียน", row["group_id"], gids),
                    ("วิชา", row["subject_id"], sids),
                    ("ครู", row["teacher_id"], tids)) if val not in pool]
        if missing:
            rejected.append({"row": i, "reason": f"ไม่พบ{'/'.join(missing)}ที่อ้างถึง"})
            continue
        row["id"] = _next("requirement")
        row.setdefault("weekly_count", 1)
        row.setdefault("parallel_group_key", None)
        REQUIREMENTS.append(row)
        created.append(row)
    if rejected:
        return {"created": created, "rejected": rejected}
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
    # Refuse a lesson that cannot exist: a teacher, class or subject that was
    # deleted, or a cell that is a break or already taken. Without this the
    # lesson lands on the board and only turns out to be impossible later.
    if not body.get("force"):
        for key, rows, label in (("group_id", _flat_groups(), "ห้องเรียน"),
                                 ("teacher_id", TEACHERS, "ครู"),
                                 ("subject_id", SUBJECTS, "วิชา")):
            val = body.get(key)
            if val is None or not any(r["id"] == int(val) for r in rows):
                raise HTTPException(400, f"ไม่พบ{label}ที่เลือก (อาจถูกลบไปแล้ว)")
        if body.get("room_id") and not any(r["id"] == int(body["room_id"]) for r in ROOMS):
            raise HTTPException(400, "ไม่พบห้องสอนที่เลือก (อาจถูกลบไปแล้ว)")

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
    if not body.get("force"):
        # Judge the cell with the new lesson in place.
        SLOTS.append(slot)
        problems = _validate_moves([{"slot_id": slot["id"]}])
        if problems:
            SLOTS.remove(slot)
            _counters["slot"] -= 1
            raise HTTPException(409, " · ".join(problems[:3]))
        return _enrich_slot(slot)

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

# ── Levels eat at different times ─────────────────────────────────────────────
# ม.1-3 and ม.4-6 break for lunch in different periods, so the school's day is
# really TWO timetables sharing most of their columns. A period row says who it
# applies to ("lower", "upper" or "all"), and period 5 is a ten-minute break for
# ม.ต้น while being a full lesson for ม.ปลาย — at an overlapping but different
# time of day.
#
# Two consequences the scheduler has to respect:
#   1. A lesson may only go where that class's own level has a lesson period.
#      Ignoring this put 159 periods into ม.1-3's lunch break.
#   2. Two lessons clash when they overlap on the CLOCK, not when they share a
#      period number. ม.1's period 5 (12:00-12:50) and ม.4's period 5
#      (11:50-12:40) are different periods at overlapping times; the same
#      number is not the same hour, and a teacher cannot be in both.

def _level_key(group: dict[str, Any] | None) -> str:
    """"lower" for ม.1-3, "upper" for ม.4-6.

    Reads the first digit out of whatever form the year is in — the imported
    data writes it "M1" while the class is named "ม.1/1", and taking the wrong
    one silently files every junior class as a senior one.
    """
    if not group:
        return "all"
    for text in (group.get("level"), group.get("name")):
        m = _re.search(r"(\d)", str(text or ""))
        if m:
            return "lower" if int(m.group(1)) <= 3 else "upper"
    return "upper"


def _periods_for_level(level: str) -> dict[int, dict[str, Any]]:
    """The day as this level actually experiences it, by period number."""
    out: dict[int, dict[str, Any]] = {}
    for p in PERIODS:
        applies = p.get("applies_to", "all") or "all"
        if applies == "all" or applies == level or level == "all":
            # A level-specific row wins over the "all" row for the same number.
            if p["period_num"] in out and applies == "all":
                continue
            out[p["period_num"]] = p
    return out


def _class_periods_for_level(level: str) -> list[int]:
    return sorted(n for n, p in _periods_for_level(level).items() if p["type"] == "class")


def _hhmm(t: str | None) -> int | None:
    try:
        h, m = str(t).split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return None


_BUCKET = 5   # minutes; every time in the data lands on a 5-minute boundary


def _period_buckets(level: str, period_num: int) -> frozenset[int]:
    """The minutes of the day this period occupies, as 5-minute buckets.

    Buckets, not start times, because the two levels' periods only partly line
    up: ม.ต้น's 12:00-12:50 lesson runs inside ม.ปลาย's 11:50-12:40 one.
    """
    row = _periods_for_level(level).get(period_num)
    if not row:
        return frozenset()
    a, b = _hhmm(row.get("start_time")), _hhmm(row.get("end_time"))
    if a is None or b is None or b <= a:
        # No usable time on the row — fall back to the period number itself so
        # the slot still collides with the same number on the other level.
        return frozenset({-1000 - period_num})
    return frozenset(range(a // _BUCKET, (b + _BUCKET - 1) // _BUCKET))


def _slot_buckets(group: dict[str, Any] | None, period_num: int) -> frozenset[int]:
    return _period_buckets(_level_key(group), period_num)


def _next_class_period_for(level: str, period: int) -> int | None:
    """The next lesson period for this level, and only if it really follows on.

    A gap means they are not a pair: a "double" either side of lunch is two
    separate lessons, not one long one.
    """
    nums = _class_periods_for_level(level)
    if period not in nums:
        return None
    i = nums.index(period)
    if i + 1 >= len(nums):
        return None
    nxt = nums[i + 1]
    rows = _periods_for_level(level)
    end = _hhmm(rows[period].get("end_time"))
    start = _hhmm(rows[nxt].get("start_time"))
    if end is not None and start is not None and start != end:
        return None          # something sits between them
    return nxt


def _class_period_nums() -> list[int]:
    return sorted({p["period_num"] for p in PERIODS if p["type"] == "class"})

def _next_class_period(period: int, level: str = "upper") -> int | None:
    """The lesson period straight after `period` for this level, or None.

    Defaults to "upper" because ม.4-6 have the fuller day; callers that know
    which class they are placing should pass its level.
    """
    return _next_class_period_for(level, period)

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


# ── วิชาเสรี: pools ───────────────────────────────────────────────────────────
# A pool is a LOCKED WINDOW first and a list of subjects second: the school says
# "ม.1/7-12 has its elective on Wednesday, period 7", the window goes into the
# timetable and is locked there, and the subject options are filled in
# afterwards — which is the order the work actually happens in.
#
# The pool is the single source of truth. Its slots are rebuilt from it by
# _sync_pool_slots on every change, so a day/period move or an added subject can
# never leave the timetable disagreeing with the pool.

def _pool_periods(pool: dict[str, Any]) -> list[int]:
    """The class periods this pool covers, or [] if it isn't pinned anywhere."""
    if pool.get("day") is None or pool.get("period") is None:
        return []
    periods = [pool["period"]]
    if pool.get("is_double"):
        # Every class in the window must have the same second period available,
        # or the "double" means different things to different classes.
        levels = {_level_key(_find_group(g)) for g in pool.get("group_ids", [])} or {"upper"}
        seconds = {_next_class_period_for(lv, pool["period"]) for lv in levels}
        if None in seconds or len(seconds) != 1:
            raise HTTPException(
                400, "คาบนี้ต่อคาบคู่ไม่ได้ — เป็นคาบสุดท้าย หรือติดคาบพัก "
                     "หรือ ม.ต้นกับ ม.ปลายต่อคาบไม่ตรงกัน กรุณาเลือกคาบอื่น")
        periods.append(seconds.pop())
    return periods


def _sync_pool_slots(pool: dict[str, Any]) -> dict[str, Any]:
    """Rewrite this pool's slots so the timetable matches the pool.

    Called after every change. Classes whose window is already taken by another
    lesson are reported rather than forced — one clash should not stop the other
    eleven classes getting their elective.
    """
    global SLOTS
    SLOTS = [s for s in SLOTS if s.get("elective_pool_id") != pool["id"]]

    periods = _pool_periods(pool)
    if not periods:
        return {"placed": 0, "skipped": []}

    day = pool["day"]
    shares = _shares_students_fn()
    placed, skipped = 0, []
    for gid in pool["group_ids"]:
        grp = _find_group(gid)
        if not grp:
            skipped.append({"group_id": gid, "reason": "ไม่พบห้องเรียน"})
            continue
        # A parent class and its subgroups hold the same students, so a lesson
        # on either blocks this window for the other.
        clash = next(
            (s for s in SLOTS
             if s["day"] == day and s["period"] in periods and shares(s["group_id"], gid)),
            None,
        )
        if clash:
            skipped.append({"group_id": gid, "group_name": grp.get("name"),
                            "reason": "มีคาบอื่นอยู่แล้ว"})
            continue

        key = f"ELEC-POOL-{pool['id']}-{gid}" if pool.get("is_double") else None
        # No option is selected for the class. In a shared elective the class
        # does not sit together — its students scatter across every option at
        # once — so pinning one subject here would be a lie, and worse, it would
        # book that one teacher into all N classrooms simultaneously. The cell
        # reads "วิชาเสรี"; each option's teacher is held busy by the solver.
        common = {
            "group_id": gid, "room_id": None, "parallel_group_key": None,
            "is_locked": True, "is_elective": True,
            "elective_pool_id": pool["id"],
            "elective_label": pool.get("name") or "วิชาเสรี",
            "selected_option_id": None,
            "subject_id": None,
            "teacher_id": None,
        }
        for i, p in enumerate(periods):
            SLOTS.append({
                **common, "id": _next("slot"), "day": day, "period": p,
                "elective_options": [
                    {**o, "id": _next("elective_option")} for o in pool["options"]
                ],
                "is_double_start": bool(pool.get("is_double")) and i == 0,
                "double_group_key": key,
                "is_double_cont": bool(pool.get("is_double")) and i > 0,
            })
        placed += 1

    return {"placed": placed, "skipped": skipped}


def _teacher_busy_outside_pool(teacher_id: int, pool: dict[str, Any]) -> list[dict[str, Any]]:
    """Where else this teacher is teaching during this pool's window.

    Checked when a subject is added, so a double-booked teacher is caught while
    it is still one click to fix — not after the whole timetable is generated.
    """
    periods = _pool_periods(pool)
    if not periods or teacher_id is None:
        return []
    # One row per clashing lesson, not per cell: a double period across six
    # classes is one problem to fix, so reporting it twelve times only buries it.
    seen, out = set(), []
    for s in SLOTS:
        if s["day"] != pool["day"] or s["period"] not in periods:
            continue
        if s.get("elective_pool_id") == pool["id"]:
            continue
        if s.get("teacher_id") == teacher_id or teacher_id in _elective_option_teachers(s):
            grp = _find_group(s["group_id"]) or {}
            subj = next((x for x in SUBJECTS if x["id"] == s.get("subject_id")), {})
            label = subj.get("name") or s.get("elective_label") or "วิชาเสรี"
            key = (label, grp.get("name"))
            if key in seen:
                continue
            seen.add(key)
            out.append({"group_name": grp.get("name"), "subject_name": label,
                        "period": s["period"]})
    return out


def _decorate_pool(p: dict[str, Any]) -> dict[str, Any]:
    """A pool as the UI needs it: who teaches what, and who is double-booked."""
    t_map = {t["id"]: t for t in TEACHERS}
    s_map = {s["id"]: s for s in SUBJECTS}
    d_map = {d["id"]: d for d in DEPARTMENTS}

    # Two options in the SAME window sharing a teacher is a clash too — she
    # cannot run both at once — and it is the easiest one to create by accident,
    # since the whole point of a window is that its options run simultaneously.
    inside = defaultdict(list)
    for o in p.get("options", []):
        if o.get("teacher_id"):
            inside[o["teacher_id"]].append(o)

    options = []
    for o in p.get("options", []):
        t = t_map.get(o.get("teacher_id"), {})
        subj = s_map.get(o.get("subject_id"), {})
        conflicts = _teacher_busy_outside_pool(o.get("teacher_id"), p)
        for other in inside.get(o.get("teacher_id"), []):
            if other is o:
                continue
            osubj = s_map.get(other.get("subject_id"), {})
            conflicts.append({
                "group_name": "ในคาบเสรีนี้",
                "subject_name": osubj.get("name") or other.get("label"),
                "period": p.get("period"),
            })
        options.append({
            **o,
            "subject_code": subj.get("code") or o.get("code"),
            "subject_name": subj.get("name") or o.get("label"),
            "teacher_name": t.get("name"),
            "teacher_code": t.get("code"),
            "department_name": d_map.get(subj.get("department_id"), {}).get("name"),
            "conflicts": conflicts,
        })

    placed = [s for s in SLOTS if s.get("elective_pool_id") == p["id"]]
    skipped = []
    if p.get("day") is not None and p.get("period") is not None:
        done = {s["group_id"] for s in placed}
        for gid in p["group_ids"]:
            if gid not in done:
                grp = _find_group(gid) or {}
                skipped.append({"group_id": gid, "group_name": grp.get("name")})

    return {
        **p,
        "options": options,
        "placed_count": len({s["group_id"] for s in placed}),
        "unplaced_groups": skipped,
        "conflict_count": sum(1 for o in options if o["conflicts"]),
    }


@app.get("/api/elective-pools")
def get_elective_pools():
    return [_decorate_pool(p) for p in ELECTIVE_POOLS]


def _find_pool(pool_id: int) -> dict[str, Any]:
    pool = next((p for p in ELECTIVE_POOLS if p["id"] == pool_id), None)
    if not pool:
        raise HTTPException(404, "ไม่พบคาบเสรีนี้")
    return pool


@app.post("/api/elective-pools")
def create_elective_pool(body: dict[str, Any]):
    """Create the WINDOW. Subjects are added afterwards, and may start empty."""
    if not body.get("group_ids"):
        raise HTTPException(400, "ต้องเลือกห้องเรียนอย่างน้อย 1 ห้อง")
    pool = {
        "id": _next("elective_pool"),
        "name": body.get("name") or "คาบเสรีใหม่",
        "raw_group": body.get("raw_group") or "",
        "group_ids": body["group_ids"],
        "weekly": body.get("weekly") or (2 if body.get("is_double", True) else 1),
        "is_double": bool(body.get("is_double", True)),
        "day": body.get("day"),
        "period": body.get("period"),
        "options": [
            {**o, "key": _next("elective_option")} for o in (body.get("options") or [])
        ],
    }
    ELECTIVE_POOLS.append(pool)
    _sync_pool_slots(pool)
    return _decorate_pool(pool)


@app.put("/api/elective-pools/{pool_id}")
def update_elective_pool(pool_id: int, body: dict[str, Any]):
    """Rename, move to another day/period, change its classes, or un-pin it.

    Pass day/period as null to lift the window out of the timetable while
    keeping its subject list.
    """
    pool = _find_pool(pool_id)
    for k in ("name", "group_ids", "is_double", "weekly", "day", "period", "raw_group"):
        if k in body:
            pool[k] = body[k]
    result = _sync_pool_slots(pool)
    return {**_decorate_pool(pool), "sync": result}


@app.delete("/api/elective-pools/{pool_id}")
def delete_elective_pool(pool_id: int):
    global SLOTS, ELECTIVE_POOLS
    SLOTS = [s for s in SLOTS if s.get("elective_pool_id") != pool_id]
    ELECTIVE_POOLS = [p for p in ELECTIVE_POOLS if p["id"] != pool_id]
    return {}


@app.post("/api/elective-pools/{pool_id}/options")
def add_pool_option(pool_id: int, body: dict[str, Any]):
    """Add a subject to the window, together with the teacher who takes it.

    The teacher may be left out, in which case whoever already teaches this
    subject elsewhere is used — the staffing sheet usually settles it, so there
    is no need to pick by hand. The reply says plainly whether that teacher is
    free in this window.
    """
    pool = _find_pool(pool_id)
    subject_id = body.get("subject_id")
    subj = next((s for s in SUBJECTS if s["id"] == subject_id), None)
    if not subj:
        raise HTTPException(400, "ไม่พบวิชานี้")

    # Who teaches this? Ask the staffing data before asking the user: the
    # ordinary lesson assignments first, then any other elective window that
    # already offers this subject (elective subjects have no ordinary lessons,
    # so for them this second source is the only one).
    teacher_id = body.get("teacher_id")
    if not teacher_id:
        teaches = [r["teacher_id"] for r in REQUIREMENTS if r["subject_id"] == subject_id]
        teaches += [o["teacher_id"] for q in ELECTIVE_POOLS for o in q.get("options", [])
                    if o.get("subject_id") == subject_id and o.get("teacher_id")]
        if teaches:
            teacher_id = max(set(teaches), key=teaches.count)
    if not teacher_id:
        raise HTTPException(
            400, f"ยังไม่มีข้อมูลว่าใครสอน {subj.get('code', '')} {subj.get('name', '')} "
                 "— กรุณาเลือกครูผู้สอน")

    if any(o.get("subject_id") == subject_id and o.get("teacher_id") == teacher_id
           for o in pool["options"]):
        raise HTTPException(400, "วิชาและครูคู่นี้อยู่ในคาบเสรีนี้แล้ว")

    pool["options"].append({
        "key": _next("elective_option"),
        "subject_id": subject_id,
        "teacher_id": teacher_id,
        "label": body.get("label") or subj["name"],
        "code": subj.get("code"),
    })
    _sync_pool_slots(pool)
    return _decorate_pool(pool)


@app.delete("/api/elective-pools/{pool_id}/options/{option_key}")
def delete_pool_option(pool_id: int, option_key: int):
    pool = _find_pool(pool_id)
    before = len(pool["options"])
    pool["options"] = [o for o in pool["options"] if o.get("key") != option_key]
    if len(pool["options"]) == before:
        raise HTTPException(404, "ไม่พบตัวเลือกนี้")
    _sync_pool_slots(pool)
    return _decorate_pool(pool)


@app.put("/api/elective-pools/{pool_id}/options/{option_key}")
def update_pool_option(pool_id: int, option_key: int, body: dict[str, Any]):
    """Change which teacher takes an option — the usual fix for a clash."""
    pool = _find_pool(pool_id)
    opt = next((o for o in pool["options"] if o.get("key") == option_key), None)
    if not opt:
        raise HTTPException(404, "ไม่พบตัวเลือกนี้")
    for k in ("teacher_id", "subject_id", "label"):
        if k in body:
            opt[k] = body[k]
    if "subject_id" in body:
        subj = next((s for s in SUBJECTS if s["id"] == body["subject_id"]), {})
        opt["code"] = subj.get("code")
    _sync_pool_slots(pool)
    return _decorate_pool(pool)


@app.get("/api/elective-pools/{pool_id}/teachers")
def pool_teacher_candidates(pool_id: int, subject_id: int | None = None):
    """Who could take a subject in this window, and who is free.

    Teachers of the subject's own กลุ่มสาระ come first, with those who already
    teach it marked, so picking is a matter of recognising a name rather than
    scrolling 143 of them.
    """
    pool = _find_pool(pool_id)
    subj = next((s for s in SUBJECTS if s["id"] == subject_id), {}) if subject_id else {}
    dept = subj.get("department_id")
    already = {r["teacher_id"] for r in REQUIREMENTS if r["subject_id"] == subject_id}

    out = []
    for t in TEACHERS:
        conflicts = _teacher_busy_outside_pool(t["id"], pool)
        out.append({
            "id": t["id"], "name": t["name"], "code": t.get("code"),
            "department_id": t.get("department_id"),
            "same_department": dept is not None and t.get("department_id") == dept,
            "teaches_subject": t["id"] in already,
            "free": not conflicts,
            "conflicts": conflicts,
        })
    out.sort(key=lambda t: (not t["teaches_subject"], not t["same_department"],
                            not t["free"], t["code"] or ""))
    return out


@app.post("/api/elective-pools/{pool_id}/place")
def place_elective_pool(pool_id: int, body: dict[str, Any]):
    """Pin the window to a day/period (and re-pin it when it moves)."""
    pool = _find_pool(pool_id)
    pool["day"] = body["day"]
    pool["period"] = body["period"]
    if "is_double" in body:
        pool["is_double"] = bool(body["is_double"])
    result = _sync_pool_slots(pool)
    return {"created": result["placed"], "skipped": result["skipped"],
            "pool": _decorate_pool(pool)}


@app.delete("/api/elective-pools/{pool_id}/placement")
def unplace_elective_pool(pool_id: int):
    """Lift the window out of the timetable, keeping the pool and its subjects."""
    pool = _find_pool(pool_id)
    pool["day"] = None
    pool["period"] = None
    before = len(SLOTS)
    _sync_pool_slots(pool)
    return {"deleted": before - len(SLOTS)}

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
    p2 = _next_class_period(p1, _level_key(_find_group(body["group_id"])))
    if p2 is None:
        raise HTTPException(400, "คาบนี้ต่อคาบคู่ไม่ได้ — เป็นคาบสุดท้ายของวัน หรือมีคาบพักคั่น กรุณาเลือกคาบอื่น")
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
    slot["elective_options"] = [o for o in slot["elective_options"] if o["id"] != option_id]
    if slot["selected_option_id"] == option_id:
        # Removing the last วง leaves the window empty but still locked — the
        # period is the school's decision and should not evaporate because its
        # subject list was cleared out to be rebuilt.
        slot["selected_option_id"] = (
            slot["elective_options"][0]["id"] if slot["elective_options"] else None
        )
        if slot["selected_option_id"] is None:
            slot["subject_id"] = None
            slot["teacher_id"] = None
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

    shares = _shares_students_fn()
    cells = [(gs["day"], gs["period"]) for gs in group_slots]

    created, skipped = [], []
    for target_group_id in body.get("target_group_ids", []):
        grp = _find_group(target_group_id)
        if not grp:
            skipped.append({"group_id": target_group_id, "reason": "ไม่พบห้องเรียน"})
            continue
        # Do not drop the elective on top of a lesson the class already has.
        # A parent class and its subgroups hold the same students, so a clash
        # with either of those counts — copying ม.4/6's elective onto ม.4/6ก
        # would put one set of students in two places at once.
        clash = next((s for s in SLOTS
                      if (s["day"], s["period"]) in cells
                      and shares(s["group_id"], target_group_id)), None)
        if clash:
            other = _find_group(clash["group_id"]) or {}
            skipped.append({
                "group_id": target_group_id, "group_name": grp.get("name"),
                "reason": ("มีคาบอื่นอยู่แล้ว" if clash["group_id"] == target_group_id
                           else f"ชนกับ {other.get('name')} ซึ่งใช้นักเรียนกลุ่มเดียวกัน"),
            })
            continue

        new_key = f"ELEC-DBL-{_next('slot')}" if key else None
        # Shared option-id remap so both halves keep matching ids.
        id_map: dict[int, int] = {}
        for o in group_slots[0]["elective_options"]:
            id_map[o["id"]] = _next("elective_option")
        for gs in group_slots:
            sel = gs.get("selected_option_id")
            new_slot = {
                **gs,
                "id": _next("slot"),
                "group_id": target_group_id,
                "double_group_key": new_key,
                "elective_options": [{**o, "id": id_map[o["id"]]} for o in gs["elective_options"]],
                # A shared window has no selected option, and None is not a key.
                "selected_option_id": id_map.get(sel) if sel is not None else None,
            }
            SLOTS.append(new_slot)
            created.append(_apply_selected_option(new_slot))
    return {"created": created, "skipped": skipped}


# ── Is this move legal? ───────────────────────────────────────────────────────
# Nothing stopped a lesson being dropped on an occupied cell, on a break period,
# or on day 99. The grid warns before a drag, but a warning is not a rule: two
# people editing at once both get a green cell and both drops land.
#
# A swap moves two lessons through each other, so the first half always looks
# like a clash on its own. Moves are therefore checked as a SET, against the
# state they would produce — which is also what makes a swap safe to validate
# at all.

def _validate_moves(moves: list[dict[str, Any]]) -> list[str]:
    """Problems with applying these moves together. Empty means it is fine."""
    by_id = {s["id"]: s for s in SLOTS}
    shares = _shares_students_fn()
    problems: list[str] = []

    moved: dict[int, dict[str, Any]] = {}
    for mv in moves:
        sid = mv.get("slot_id")
        cur = by_id.get(sid)
        if cur is None:
            problems.append(f"ไม่พบคาบ id {sid}")
            continue
        day    = mv.get("day",    cur["day"])
        period = mv.get("period", cur["period"])
        if not (0 <= int(day) <= 4):
            problems.append(f"วันที่ {day} ไม่ถูกต้อง")
            continue
        # "Is this a lesson period?" depends on the class: period 5 is a lesson
        # for ม.4-6 and lunch for ม.1-3.
        grp = _find_group(cur["group_id"])
        lvl = _level_key(grp)
        if int(period) not in _class_periods_for_level(lvl):
            row = _periods_for_level(lvl).get(int(period))
            label = row["label"] if row else f"คาบ {period}"
            who = "ม.1-3" if lvl == "lower" else "ม.4-6"
            problems.append(f"{label} ไม่ใช่คาบเรียนของ {who} จึงวางคาบสอนไม่ได้")
            continue
        moved[sid] = {**cur, "day": int(day), "period": int(period),
                      "room_id": mv.get("room_id", cur.get("room_id"))}
    if problems:
        return problems

    # The timetable as it would be once every move has been applied.
    after = [moved.get(s["id"], s) for s in SLOTS]
    g_name = {g["id"]: g["name"] for g in _flat_groups()}
    t_name = {t["id"]: t["name"] for t in TEACHERS}
    r_name = {r["id"]: r["name"] for r in ROOMS}

    # Index by the clock, not the period number, so a move is judged against
    # whatever is genuinely happening at that time of day.
    by_time: dict[tuple, list[dict]] = defaultdict(list)
    by_cell: dict[tuple, list[dict]] = defaultdict(list)
    g_of = {g["id"]: g for g in _flat_groups()}
    for s in after:
        by_cell[(s["day"], s["period"])].append(s)
        for b in _slot_buckets(g_of.get(s["group_id"]), s["period"]):
            by_time[(s["day"], b)].append(s)

    seen: set[str] = set()
    for sid in moved:
        s = moved[sid]
        overlapping = {o["id"]: o for b in _slot_buckets(g_of.get(s["group_id"]), s["period"])
                       for o in by_time[(s["day"], b)] if o["id"] != sid}
        for o in by_cell[(s["day"], s["period"])]:
            if o["id"] != sid:
                overlapping.setdefault(o["id"], o)
        for o in overlapping.values():
            msgs = []
            if shares(o["group_id"], s["group_id"]):
                a, b = g_name.get(s["group_id"], "?"), g_name.get(o["group_id"], "?")
                msgs.append(f"{a} มีคาบอื่นอยู่แล้ว" if a == b
                            else f"{a} กับ {b} ใช้นักเรียนกลุ่มเดียวกัน จึงเรียนพร้อมกันไม่ได้")
            mine  = ({s["teacher_id"]} if s.get("teacher_id") else set()) | _elective_option_teachers(s)
            yours = ({o["teacher_id"]} if o.get("teacher_id") else set()) | _elective_option_teachers(o)
            for tid in mine & yours:
                msgs.append(f"{t_name.get(tid, '?')} สอนคาบนี้อยู่แล้ว")
            if s.get("room_id") and s["room_id"] == o.get("room_id"):
                msgs.append(f"ห้อง {r_name.get(s['room_id'], '?')} ถูกใช้อยู่แล้ว")
            for m in msgs:
                if m not in seen:
                    seen.add(m); problems.append(m)
    return problems


@app.post("/api/timetable/slots/move")
def move_slots(body: dict[str, Any]):
    """Apply several moves at once, all or nothing.

    This is how a swap travels: both halves are judged against the result, so
    two lessons can trade places even though each half alone looks like a clash.
    """
    moves = body.get("moves") or []
    if not moves:
        return {"ok": True, "conflicts": [], "slots": []}
    conflicts = [] if body.get("force") else _validate_moves(moves)
    if conflicts:
        return {"ok": False, "conflicts": conflicts, "slots": []}

    by_id = {s["id"]: s for s in SLOTS}
    out = []
    for mv in moves:
        slot = by_id.get(mv.get("slot_id"))
        if not slot:
            continue
        for k in ("day", "period", "room_id"):
            if k in mv:
                slot[k] = mv[k]
        _sync_doubles(slot)
        out.append(_enrich_slot(slot))
    return {"ok": True, "conflicts": [], "slots": out}


@app.patch("/api/timetable/slots/{slot_id}")
def patch_slot(slot_id: int, body: dict[str, Any]):
    if ("day" in body or "period" in body or "room_id" in body) and not body.get("force"):
        delta = {k: body[k] for k in ("day", "period", "room_id") if k in body}
        batch = [{"slot_id": slot_id, **delta}]
        # Parallel lessons travel together (they are moved below), so they are
        # judged together too — otherwise a sibling lands on an occupied cell
        # that nothing checked.
        cur = next((x for x in SLOTS if x["id"] == slot_id), None)
        pgk = cur.get("parallel_group_key") if cur else None
        if pgk and ("day" in body or "period" in body):
            for sib in SLOTS:
                if (sib.get("parallel_group_key") == pgk and sib["id"] != slot_id
                        and sib["day"] == cur["day"] and sib["period"] == cur["period"]):
                    batch.append({"slot_id": sib["id"],
                                  **{k: v for k, v in delta.items() if k != "room_id"}})
        problems = _validate_moves(batch)
        if problems:
            raise HTTPException(409, " · ".join(problems[:3]))
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
def clear_slots(scope: str = "unlocked", group_id: int | None = None,
                teacher_id: int | None = None):
    """Empty the timetable.

    scope="unlocked" (default) keeps คาบที่ล็อกไว้ — the usual "start the
    generator over" button. scope="all" wipes those too. Passing group_id or
    teacher_id clears only that class's or that teacher's periods.
    """
    global SLOTS
    before = len(SLOTS)

    def doomed(s: dict) -> bool:
        if scope != "all" and s.get("is_locked"):
            return False
        if group_id is not None and s.get("group_id") != group_id:
            return False
        if teacher_id is not None and s.get("teacher_id") != teacher_id:
            return False
        return True

    SLOTS = [s for s in SLOTS if not doomed(s)]

    # Wiping everything must leave the คาบเสรี windows un-pinned too, or they
    # would still claim a day and period the timetable no longer shows and
    # report every class as blocked.
    if scope == "all" and group_id is None and teacher_id is None:
        for p in ELECTIVE_POOLS:
            p["day"] = None
            p["period"] = None

    return {"deleted": before - len(SLOTS), "remaining": len(SLOTS)}

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



# ── Keeping the data ──────────────────────────────────────────────────────────
# Everything above lives in memory, which is gone the moment the server
# restarts — and the free Render instance restarts whenever it is redeployed or
# has been idle for a quarter of an hour. Every edit the school made would be
# back to the seed file the next morning.
#
# Two layers. A snapshot on disk, rewritten after each change, carries the data
# across a restart of the same container. That is not enough on its own: a free
# instance gets a fresh, empty filesystem on redeploy, so the disk copy goes
# too. The backup file is what actually survives that — the school downloads
# one, and uploads it again afterwards, or sends it to be committed as the new
# starting point.

SCHOOL_CONFIG: dict[str, Any] = {
    "schoolName": "", "term": "1", "year": "2568",
    "directorName": "", "deputyName": "", "logoUrl": "",
    # How many periods in a row a teacher may be given, and what to aim for.
    "max_consecutive": CONSEC_HARD, "prefer_consecutive": CONSEC_SOFT,
    # เวรคาบสุดท้าย: how many last-period lessons each teacher should carry.
    "min_last_period": LAST_PERIOD_MIN,
}

_STATE_PATH = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "data_state.json")
_SAVE_KEYS = ("departments", "buildings", "rooms", "teachers", "subjects",
              "requirements", "periods", "slots", "elective_pools", "school_config")


def _snapshot() -> dict[str, Any]:
    """Everything worth keeping, in one plain structure."""
    return {
        "version": 1,
        "saved_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "departments": DEPARTMENTS,
        "buildings": BUILDINGS,
        "rooms": ROOMS,
        # Classes are stored flat with parent_id; the tree is rebuilt on load.
        "groups": [{k: v for k, v in g.items() if k != "children"} for g in _flat_groups()],
        "teachers": TEACHERS,
        "subjects": SUBJECTS,
        "requirements": REQUIREMENTS,
        "periods": PERIODS,
        "slots": SLOTS,
        "elective_pools": ELECTIVE_POOLS,
        "school_config": SCHOOL_CONFIG,
        "counters": _counters,
    }


def _apply_snapshot(data: dict[str, Any]) -> None:
    """Replace the whole dataset. Anything absent is left as it is.

    Every incoming list is copied before the target is emptied. A snapshot
    taken from this same server hands back the live lists themselves, so
    clearing the target would empty the data being restored from it and leave
    nothing behind.
    """
    for key, target in (("departments", DEPARTMENTS), ("buildings", BUILDINGS),
                        ("rooms", ROOMS), ("teachers", TEACHERS),
                        ("subjects", SUBJECTS), ("requirements", REQUIREMENTS),
                        ("periods", PERIODS), ("slots", SLOTS),
                        ("elective_pools", ELECTIVE_POOLS)):
        rows = data.get(key)
        if rows is not None:
            rows = [dict(r) for r in rows]
            target.clear()
            target.extend(rows)

    rows = data.get("groups")
    if rows is not None:
        rows = [dict(g) for g in rows]
        by_id = {g["id"]: {**g, "children": []} for g in rows}
        GROUPS.clear()
        for g in by_id.values():
            parent = by_id.get(g.get("parent_id")) if g.get("parent_id") else None
            (parent["children"] if parent else GROUPS).append(g)

    if data.get("school_config"):
        SCHOOL_CONFIG.update(dict(data["school_config"]))

    # Keep issuing ids above everything that exists, however the data arrived.
    saved = dict(data.get("counters") or {})
    for key, value in saved.items():
        if isinstance(value, int):
            _counters[key] = max(_counters.get(key, 0), value)
    for key, rows in (("room", ROOMS), ("teacher", TEACHERS), ("subject", SUBJECTS),
                      ("requirement", REQUIREMENTS), ("department", DEPARTMENTS),
                      ("period", PERIODS), ("slot", SLOTS),
                      ("elective_pool", ELECTIVE_POOLS)):
        _counters[key] = max(_counters.get(key, 0), _max_id(rows))
    _counters["group"] = max(_counters.get("group", 0), _max_id(_flat_groups()))


def _save_state() -> None:
    """Write the snapshot to disk. Never let a failed save break a request."""
    try:
        tmp = _STATE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            _json.dump(_snapshot(), fh, ensure_ascii=False)
        _os.replace(tmp, _STATE_PATH)      # atomic: a crash mid-write cannot truncate it
    except Exception:
        pass


def _load_state() -> bool:
    if not _os.path.exists(_STATE_PATH):
        return False
    try:
        with open(_STATE_PATH, encoding="utf-8") as fh:
            _apply_snapshot(_json.load(fh))
        return True
    except Exception:
        return False


@app.get("/api/backup")
def download_backup():
    """The whole dataset, to be saved somewhere that outlives this server."""
    return _snapshot()


@app.post("/api/restore")
def restore_backup(body: dict[str, Any]):
    """Replace everything with a previously downloaded backup."""
    if not isinstance(body, dict) or not any(body.get(k) for k in _SAVE_KEYS):
        raise HTTPException(400, "ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของระบบ")
    _apply_snapshot(body)
    _save_state()
    return {
        "restored": {k: len(body.get(k) or []) for k in
                     ("groups", "teachers", "subjects", "rooms", "requirements",
                      "slots", "elective_pools")},
        "saved_at": body.get("saved_at"),
    }


@app.get("/api/school/config")
def get_school_config():
    return SCHOOL_CONFIG


@app.put("/api/school/config")
def update_school_config(body: dict[str, Any]):
    for k in ("schoolName", "term", "year", "directorName", "deputyName", "logoUrl",
              "max_consecutive", "prefer_consecutive", "min_last_period"):
        if k in body:
            SCHOOL_CONFIG[k] = body[k]
    return SCHOOL_CONFIG


@app.get("/api/state/info")
def state_info():
    """What the data is and where it came from — shown on the backup screen."""
    return {
        "revision": REVISION["n"],
        "source": _STATE_SOURCE,
        "disk_snapshot": _os.path.exists(_STATE_PATH),
        "counts": {
            "groups": len(_flat_groups()), "teachers": len(TEACHERS),
            "subjects": len(SUBJECTS), "rooms": len(ROOMS),
            "requirements": len(REQUIREMENTS), "slots": len(SLOTS),
            "elective_pools": len(ELECTIVE_POOLS),
        },
    }


# Prefer what the school actually edited over the seed file.
_STATE_SOURCE = "snapshot" if _load_state() else ("seed" if _LOADED_REAL_DATA else "demo")


if __name__ == "__main__":
    import os, uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
