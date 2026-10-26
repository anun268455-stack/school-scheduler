"""
Mock API v3 — working mock solver + bulk import + periods CRUD + bulk lock.
Run: python mock_api.py
"""
from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Callable
import copy as _copy
import random
import re as _re
import os as _os
import json as _json
import datetime as _dt
import time as _time
from collections import Counter, defaultdict
from contextvars import ContextVar
import substitution as _SUB
import curriculum as _CUR

app = FastAPI(title="School Scheduler Mock API v3")

# รุ่นของตัวจัดตาราง — เลขนี้ต้องขยับทุกครั้งที่แก้พฤติกรรมของเซิร์ฟเวอร์
#
# หน้าเว็บอยู่บน GitHub Pages ส่วนตัวจัดตารางอยู่บน Render คนละที่กัน และ
# อัปเดตแยกกัน หน้าเว็บจึงใหม่ได้ทั้งที่ตัวจัดตารางยังเป็นรุ่นเก่า — ข้อความ
# บนจอเปลี่ยนไปหมดแล้ว แต่ตารางที่ออกมายังเป็นของเดิม ซึ่งมองไม่เห็นเลยว่า
# เกิดอะไรขึ้น และคนก็กดสร้างตารางซ้ำอยู่อย่างนั้น
#
# หน้าเว็บเทียบเลขนี้กับที่ตัวเองรู้ แล้วขึ้นแถบเตือนเมื่อไม่ตรง
API_BUILD = "2026-10-26.6"
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Live collaboration: data revision counter ─────────────────────────────────
# Every successful write bumps REVISION. Clients poll /api/state/version (a tiny
# response) and reload only when the number changed, so two people editing at the
# same time see each other's work without refreshing the page.
REVISION = {"n": 0}

# A write that changed nothing says so, and the middleware below then leaves the
# revision and the saved copy alone: every open browser reads a bump as "someone
# changed the data" and re-fetches, so a button press that did nothing must be
# silent. A handler cannot reach the response from where it sits, so it flags the
# request through this instead. The middleware puts a fresh list here before the
# handler runs (a mutable object, because a value the handler sets would not be
# seen from the middleware's side); a handler called on its own finds None and
# the flag does nothing.
_NOTHING_CHANGED: ContextVar[list | None] = ContextVar("nothing_changed", default=None)


def _nothing_changed() -> None:
    """Call from a write handler that ended up changing nothing."""
    flag = _NOTHING_CHANGED.get()
    if flag is not None:
        flag.append(True)


@app.middleware("http")
async def _bump_revision(request, call_next):
    unchanged: list[bool] = []
    _NOTHING_CHANGED.set(unchanged)
    response = await call_next(request)
    if (request.method in ("POST", "PUT", "PATCH", "DELETE")
            and response.status_code < 400 and not unchanged):
        REVISION["n"] += 1
        # The substitution engine caches who is busy when; any write may have
        # changed that, and a stale cache would offer a teacher who has just
        # been booked.
        _SUB.invalidate()
        # เหตุผลเดียวกันกับตารางค้นหาผังคาบ: การเขียนครั้งนี้อาจเป็นการแก้ผังคาบ
        # ถ้าไม่ล้าง คำตอบที่เก็บไว้จะค้างผังเดิมทั้งที่โรงเรียนเพิ่งเปลี่ยน
        _lookup_cache_clear()
        # …and keep it. This is the line the whole storage layer was written
        # for and never had: _save_state was reachable only from the restore
        # endpoints, so an ordinary afternoon of work — every lesson dragged,
        # every teacher assigned — was held in memory and nowhere else. It
        # looked saved, because the screen and every other browser showed it,
        # right up to the next restart. On a host that sleeps when nobody is
        # using it, that is most evenings.
        #
        # Every write, not every few: a save that waits for a timer is a save
        # that is not there when the process is stopped between ticks. The
        # cost is one snapshot built here (~60ms) and handed to the writer
        # thread, which coalesces a burst of edits into a single round trip.
        _save_state()
    return response


@app.get("/api/state/version")
def state_version():
    """Tiny polling endpoint — lets clients detect other people's edits.

    It carries the save state too. "Is what I am doing saved?" is a question
    about the server, and answering it from the browser's own copy was only
    ever half an answer.
    """
    return {
        "revision": REVISION["n"],
        "slots": len(SLOTS),
        "saved_at": _LAST_SAVED_AT,
        "pending": _pending_blob is not None,
        "store": _STORE_KIND,
        "store_error": _STORE_ERROR,
    }

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

# ── คำตอบเดิมที่ถูกคิดใหม่เก้าแสนครั้ง ────────────────────────────────────────
#
# "เหมือนว่าเซิฟเวอร์จะช้าหรือความจำไม่พอ ช่วยแก้ไขให้หน่อย"
#
# จับเวลาการจัดตารางหนึ่งรอบแล้วพบว่า _periods_for_level ถูกเรียก 934,337 ครั้ง
# ทุกครั้งมันไล่ PERIODS ทั้งแถวแล้วสร้าง dict ใหม่ ทั้งที่ผังคาบไม่ได้เปลี่ยน
# แม้แต่ครั้งเดียวระหว่างการจัด ครึ่งหนึ่งของเวลาทั้งหมดจึงหมดไปกับการคิดคำตอบ
# เดิมซ้ำ และบนเครื่องของโรงเรียนมันกลายเป็น 109 วินาที จนหน้าเว็บรอไม่ไหว
#
# แคชนี้มีสองแบบ และแยกกันด้วยเหตุผลเรื่องความถูกต้อง ไม่ใช่ความเร็ว:
#
#   คีย์ด้วยค่า   _level_key, _hhmm — คีย์คือค่าที่ฟังก์ชันอ่านจริงๆ ค่าเดิมให้
#                 คำตอบเดิมเสมอ จึงไม่มีทางค้างของเก่า ไม่ต้องล้าง
#   คีย์ด้วยชั้น  ตารางคาบของแต่ละชั้น — ขึ้นกับ PERIODS ทั้งก้อน ถ้าโรงเรียน
#                 แก้ผังคาบแล้วไม่ล้าง คำตอบจะค้างของเก่า ซึ่งเป็นความผิดพลาด
#                 ที่แคชทำบ่อยที่สุด จึงล้างทุกครั้งที่เริ่มงานใหม่ (จัดตาราง
#                 โหลดข้อมูล แก้ผังคาบ) ระหว่างงานหนึ่งงาน PERIODS ไม่เปลี่ยน
#                 คำตอบที่เก็บไว้จึงตรงเสมอ
_LOOKUP_CACHE: dict[tuple, Any] = {}


def _lookup_cache_clear() -> None:
    """ล้างแคชตารางค้นหา — เรียกเมื่อเริ่มงานใหม่ หรือข้อมูลที่แคชอ้างอิงเปลี่ยน"""
    _LOOKUP_CACHE.clear()


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

# เซ็ตว่างที่ใช้ร่วมกัน — ไม่ต้องสร้างใหม่ทุกครั้งที่ห้องไม่ได้กันไว้ให้ใคร
_EMPTY_RESERVED: set[int] = set()



def _room_reserved_for(room: dict[str, Any]) -> set[int]:
    """Teachers this room is kept for. Empty means anyone may use it.

    A room can belong to several teachers who share it — a department office
    with three desks, a lab two people run between them. It was a single
    teacher before, so that older shape is still read.
    """
    # ไม่แคชตรงนี้ — ลองแล้วพัง: หน้าตรวจความถูกต้องแก้ ROOMS ตรง ๆ แล้วถามซ้ำ
    # ทันที (เช่น "ห้องกันไว้ให้ครูที่ไม่มีแล้ว") คำตอบที่แคชไว้จึงเป็นของเก่า
    # การแคชค่าที่อ่านจาก dict ที่คนอื่นแก้ได้ตลอดเวลา ต้องมีคนคอยล้างให้ถูกจุด
    # ซึ่งเป็นสัญญาที่ผิดพลาดง่ายเกินไป
    #
    # ฟังก์ชันนี้ถูกเรียก 107 ล้านครั้งต่อการจัดหนึ่งรอบบนข้อมูลจริง ซึ่งแพงจริง
    # แต่ที่มาทั้งหมดอยู่ในตัวจัดตาราง ซึ่งระหว่างนั้น ROOMS ไม่เปลี่ยน จึงไปทำ
    # ตารางไว้ครั้งเดียวที่นั่นแทน (reserved_of) — ได้ความเร็วโดยไม่ต้องเชื่อใจ
    # ว่าจะมีใครล้างแคชให้ถูกเวลา
    ids = room.get("reserved_teacher_ids")
    if isinstance(ids, list):
        return {int(x) for x in ids if x}
    one = room.get("reserved_teacher_id")
    return {int(one)} if one else set()


def _room_kept_for_group(room: dict[str, Any], family: "set[int] | None") -> bool:
    """Is this room given to THIS class in particular?

    Not "may they sit here" — that is _room_allows_group, which is true of
    every ordinary room. This is the stronger thing the school says when it
    writes a class's name on a door: the room is theirs, so an ordinary lesson
    does not move them out of it.
    """
    kept = room.get("reserved_group_ids")
    if not isinstance(kept, list) or not kept:
        return False
    return bool({int(x) for x in kept if x} & set(family or ()))


def _group_stays_home(group: dict[str, Any], room: dict[str, Any],
                      family: "set[int] | None" = None) -> bool:
    """Does this class stay in its own room rather than walk to a facility?

    ห้องเพชร and the other programme classes have a room of their own and are
    meant to sit in it: ม.6/3 was being walked to another building for a
    science period while 255 — theirs, and empty — stood two floors below.

    The school says so in one of two ways, and either is enough:
      · ticking "เรียนในห้องประจำชั้น" on the class, or
      · writing the class's name on the room (กันไว้ให้ชั้นเรียน).

    Ticking it off wins over both. And it never holds a class back from a
    subject that must have its facility — a วิชา marked ต้องเรียนที่ห้อง
    ประจำวิชา, or one with a room of its own, is placed before this is asked.
    """
    said = group.get("stay_in_homeroom")
    if isinstance(said, bool):
        return said
    return _room_kept_for_group(room, family)


def _group_family(group_id: int | None, group: dict[str, Any] | None) -> set[int]:
    """The class, its parent and its sub-classes — one roomful of students.

    ม.5/1ก is ม.5/1 for the purpose of a room reserved for ม.5/1.
    """
    family = {group_id} if group_id is not None else set()
    group = group or {}
    if group.get("parent_id"):
        family.add(group["parent_id"])
    for ch in (group.get("children") or []):
        family.add(ch["id"] if isinstance(ch, dict) else ch)
    return family


def _stays_home_for(group: dict[str, Any] | None, subj: dict[str, Any] | None,
                    home: dict[str, Any] | None, outdoor: bool = False) -> bool:
    """Is THIS lesson one the class's "เรียนในห้องประจำชั้น" applies to?

    The class says it stays in its own room (_group_stays_home), but a few
    lessons were never the room's to decide:

      · a subject with a ห้องประจำวิชา — the facility is why the room exists;
      · a subject marked ต้องเรียนที่ห้องประจำวิชา — the school said so outright;
      · พลศึกษา and anything else that belongs outdoors.

    CP-SAT and the end-of-run report both ask this, so that the weight the
    optimiser charges and the exception the school is shown are about the
    same lessons. (The heuristic placer reaches the same answer by position:
    it asks _group_stays_home only after the first two have been placed, and
    keeps outdoor lessons out of it with its own wants_outdoor test.)
    """
    if not group or not home or outdoor:
        return False
    if _subject_rooms(subj) or _subject_room_rule(subj or {}) == "subject":
        return False
    return _group_stays_home(group, home, _group_family(group.get("id"), group))


def _choose_anchor(group: dict[str, Any], candidates: list[dict[str, Any]],
                   taken: set[int], homeroom_ids: set[int]) -> dict[str, Any] | None:
    """The one ordinary room a class without a ห้องประจำชั้น comes back to.

    A room nobody calls home first; but when the school is short of rooms
    there may be none — every open room is somebody's — and another class's
    room beats no room. Among those, one no other class has already been
    given, then one the class fits in, then the roomiest, then the lowest id:
    the order is arbitrary only at the very end, and it is the same order
    every time.
    """
    free = [r for r in candidates if r["id"] not in homeroom_ids] or candidates
    if not free:
        return None
    return min(free, key=lambda r: (
        r["id"] in taken,
        0 if r.get("capacity", 40) >= group.get("size", 40) else 1,
        -int(r.get("capacity") or 0),
        r["id"]))


def _room_free_for(room: dict[str, Any], teacher_id: int | None) -> bool:
    kept = _room_reserved_for(room)
    return not kept or (teacher_id is not None and teacher_id in kept)


def _room_allows_group(room: dict[str, Any], group_id: int | None,
                       family: "set[int] | None" = None) -> bool:
    """ห้องเรียนพิเศษของชั้นไหน — may this class be seated in this room?

    A school short of rooms gives one to a class outright: 247 is ม.5/1's and
    nobody else's. Empty means anyone. A sub-class counts as its parent, so
    reserving a room for ม.5/1 does not shut out ม.5/1ก.
    """
    kept = room.get("reserved_group_ids")
    if not isinstance(kept, list) or not kept:
        return True
    want = {int(x) for x in kept if x}
    mine = set(family or ())
    if group_id is not None:
        mine.add(group_id)
    return bool(want & mine)


def _subject_room_rule(subj: dict[str, Any]) -> str:
    """Where this subject is taught: "subject" | "homeroom" | "auto".

    "subject"  always its own facility — พละ on the field, นาฏศิลป์ in the
               studio — whatever room the class or the teacher would get.
    "homeroom" always the students' own room: แนะแนว is the teacher walking
               to the class, even when that teacher has a room of their own.
    "auto"     the ordinary rules.
    """
    rule = subj.get("room_rule")
    return rule if rule in ("subject", "homeroom") else "auto"


def _subject_rooms(subj: dict[str, Any] | None) -> list[int]:
    """ห้องที่วิชานี้ใช้ได้ — one room, or several.

    ฟิสิกส์ does not fit in 353 alone: there are more physics periods in a
    week than the room has hours, and the overflow was landing in ordinary
    classrooms. The school would rather it went to เคมี or ชีววิทยา, which
    are the same kind of room with the same benches — so a subject may name
    as many as it likes, in the order it prefers them.

    The old single `fixed_room_id` is still read, so nothing has to be
    re-entered.
    """
    if not subj:
        return []
    many = subj.get("fixed_room_ids")
    if isinstance(many, list):
        out = [int(x) for x in many if x]
        if out:
            return out
    one = subj.get("fixed_room_id")
    return [int(one)] if one else []


# ── รหัสวิชาบอกชั้นอยู่ในตัวมันเอง ────────────────────────────────────────────
#
# "วิชา พ21104 ที่อยู่กับ ม.2 ให้เปลี่ยนเป็น พ22104 พลศึกษาพื้นฐาน 4"
#
# พ22104 = พ(สุขศึกษาและพลศึกษา) + 2(มัธยม) + 2(ปีที่สองของระดับ คือ ม.2)
# + 104(ภาคเรียนและลำดับ) ห้อง ม.2 ที่ถือ พ21104 จึงไม่ใช่เรื่องรสนิยม แต่เป็น
# ข้อมูลผิดที่ตรวจจับได้จากตัวรหัสเอง โดยไม่ต้องมีไฟล์หลักสูตรมาเทียบ
#
# ข้อยกเว้นที่ต้องระวัง: เลขปี 0 (พ20202, ศ30201) คือรายวิชาเพิ่มเติมที่ใช้ได้
# ทุกชั้นในระดับนั้น ไม่ได้ผูกกับปีใดปีหนึ่ง การไปแก้มันคือการทำข้อมูลพัง
# วัดบนข้อมูลจริง: ตรวจได้ 1120 แถว มีแบบนี้ 100 แถว ต้องข้ามทั้งหมด

def _code_year_digits(code: str | None) -> tuple[int, int] | None:
    """(เลขระดับ, เลขปี) ที่ฝังอยู่ในรหัสวิชา — None ถ้าอ่านไม่ออก"""
    m = _re.match(r"^\D+(\d)(\d)\d{3}$", (code or "").strip())
    return (int(m.group(1)), int(m.group(2))) if m else None


def _class_year(name: str | None) -> int | None:
    """ม.1 ถึง ม.6 จากชื่อห้อง — None ถ้าอ่านไม่ออก"""
    m = _re.search(r"ม\.?\s*([1-6])", name or "")
    return int(m.group(1)) if m else None


def _year_digits_for_class(year: int) -> tuple[int, int]:
    """ชั้นที่เรียน -> (เลขระดับ, เลขปี) ที่รหัสวิชาควรเป็น"""
    return (2, year) if year <= 3 else (3, year - 3)


def _subject_year_mismatches() -> list[dict[str, Any]]:
    """แถวหลักสูตรที่รหัสวิชาบอกชั้นหนึ่ง แต่ห้องที่เรียนเป็นอีกชั้นหนึ่ง"""
    s_map = {s["id"]: s for s in SUBJECTS}
    g_map = {g["id"]: g for g in _flat_groups()}
    by_code: dict[str, dict] = {}
    for s in SUBJECTS:
        c = (s.get("code") or "").strip()
        if c and c not in by_code:
            by_code[c] = s
    out: list[dict[str, Any]] = []
    for r in REQUIREMENTS:
        subj, grp = s_map.get(r.get("subject_id")), g_map.get(r.get("group_id"))
        if not subj or not grp:
            continue
        code = (subj.get("code") or "").strip()
        dig, year = _code_year_digits(code), _class_year(grp.get("name"))
        if dig is None or year is None or dig[1] == 0:
            continue
        want = _year_digits_for_class(year)
        if dig == want:
            continue
        head = code[:-5]
        want_code = f"{head}{want[0]}{want[1]}{code[-3:]}"
        out.append({"req": r, "code": code, "want_code": want_code,
                    "group": grp.get("name") or f"#{grp['id']}",
                    "subject": subj, "target": by_code.get(want_code)})
    return out


def _name_for_new_code(code: str, like: dict[str, Any]) -> str:
    """ชื่อของวิชาที่ต้องสร้างใหม่ — เอาจากวิชาพี่น้อง ไม่ใช่เดาเอง

    พ22104 ยังไม่มีในระบบ แต่ พ21104 กับ พ23104 มีและชื่อ "พลศึกษา" เหมือนกัน
    ชื่อที่พี่น้องใช้ตรงกันจึงเป็นคำตอบที่มาจากข้อมูล ไม่ใช่จากการเดา ถ้าพี่น้อง
    ตั้งชื่อไม่ตรงกัน ก็ใช้ชื่อของวิชาที่กำลังแก้ แล้วให้โรงเรียนแก้ชื่อเอง
    """
    head, tail = code[:-5], code[-3:]
    names = [(s.get("name") or "").strip() for s in SUBJECTS
             if (s.get("code") or "").startswith(head)
             and (s.get("code") or "").endswith(tail)
             and len(s.get("code") or "") == len(code)
             and (s.get("name") or "").strip()]
    if names:
        best, n = Counter(names).most_common(1)[0]
        if n > 1 or len(set(names)) == 1:
            return best
    return (like.get("name") or code).strip()


def _subject_blocked_days(subj: dict[str, Any] | None) -> set[int]:
    """วันที่วิชานี้ห้ามเรียน — ว่างแปลว่าเรียนได้ทุกวัน

      "มีวิชาพละที่ต้องไม่เรียนในวันพฤ เพราะเป็นวันเรียนลูกเสือ"

    ไม่ใช่ความชอบ แต่เป็นวันที่ทั้งโรงเรียนไปทำอย่างอื่น — เหมือน "วันที่ครู
    ไม่มาสอน" คือครูไม่ได้อยู่ในโรงเรียน ไม่ใช่ครูไม่อยากสอน วิชาที่ถูกห้ามไว้
    จึงต้องไม่โผล่ในวันนั้นเลยแม้แต่คาบเดียว และถ้าลงไม่ครบเพราะกฎนี้ ต้องบอก
    ให้โรงเรียนตัดสินใจเอง ไม่ใช่แอบลงวันนั้นให้ครบๆ ไป

    0 = จันทร์ ถึง 4 = ศุกร์ ค่าที่อ่านไม่ได้หรืออยู่นอกช่วงถูกทิ้งเงียบๆ เพราะ
    ค่าขยะหนึ่งตัวไม่ควรทำให้ทั้งโรงเรียนจัดตารางไม่ได้
    """
    if not subj:
        return set()
    out: set[int] = set()
    for d in (subj.get("blocked_days") or []):
        try:
            n = int(d)
        except (TypeError, ValueError):
            continue
        if 0 <= n < 5:
            out.add(n)
    return out


def _subject_buildings(subj: dict[str, Any] | None) -> set[int]:
    """อาคารที่วิชานี้เรียนได้ — empty means anywhere.

    แนะแนว ม.6 needs a room, and it has to be in อาคาร 1: the teachers and the
    records are there and the period is too short to walk. Naming every room
    of อาคาร 1 one by one would say the same thing, until the school adds a
    room and has to remember to add it here too. The building is the rule.
    """
    if not subj:
        return set()
    many = subj.get("building_ids")
    if isinstance(many, list):
        out = {int(x) for x in many if x}
        if out:
            return out
    one = subj.get("building_id")
    return {int(one)} if one else set()


def _subject_outdoor(subj: dict[str, Any]) -> bool | None:
    """เรียนที่ลานได้ไหม — True yes, False never, None not said."""
    v = subj.get("allow_outdoor")
    return v if isinstance(v, bool) else None


def _may_use_outdoor(subj: dict[str, Any] | None,
                     req: dict[str, Any] | None = None,
                     group: dict[str, Any] | None = None) -> bool:
    """A class goes outdoors only when the school has said it may.

    This has been both ways round. Nothing outdoors unless ticked left the
    yards empty all week while the school was short of rooms, because nobody
    had been through 271 subjects ticking boxes; the opposite filled the gap
    but put classes outside that nobody had chosen, and they found out when
    one was standing on the ลาน in the rain.

    What settles it is that neither default costs anything here. With 99
    indoor rooms for 93 classes, refusing the ลาน outright still places every
    lesson — measured on the school's own data, 2,156 placed with no ลาน
    against 2,155 with it, and no lesson left without a room either way. When
    a default is free, it should be the one that does nothing surprising. The
    ticks are now a few clicks (ทุกห้องออกลานได้ in the subject dialog), so
    a school that is genuinely short of rooms can open it up in seconds.

    Asked from the most specific side first, because "which classes" is the
    real question. A school short of rooms decides who goes outside, and the
    answer is rarely a whole subject: ห้องวิทย์-คณิต keep the classrooms and
    another class takes the ลาน for the same period of the same subject. So
    one lesson's own setting beats the class's, and the class's beats the
    subject's.
    """
    for src in (req, group, subj):
        if src is None:
            continue
        v = src.get("allow_outdoor")
        if isinstance(v, bool):
            return v
    return False


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


# ── Does this room suit this lesson? ─────────────────────────────────────────
# The rule the solver applies to every room it considers, with "is anybody in
# it right now" left out. It lives here, not inside _solve_greedy's find_room,
# so that find_room and the yard-rescue advice (GET /api/yard-rescue) ask the
# same question and cannot drift apart.

def _lesson_want_dept(subj: dict[str, Any] | None, teacher: dict[str, Any] | None) -> int | None:
    """The กลุ่มสาระ whose specialised rooms this lesson is matched against.

    The SUBJECT's department — a maths teacher covering a computer period
    still needs the lab — and the teacher's own only when the subject has none.
    """
    return (subj or {}).get("department_id") or (teacher or {}).get("department_id")


def _room_in_buildings(room: dict[str, Any] | None, want_buildings: set[int]) -> bool:
    """อาคารที่วิชานี้เรียนได้ — empty means anywhere; no room is in no building."""
    if not want_buildings or not room:
        return not want_buildings
    return room.get("building_id") in want_buildings


def _room_suits(room: dict[str, Any], *, teacher_id: int | None, group_id: int | None,
                family: "set[int] | None", want_dept: int | None,
                want_buildings: set[int], may_outdoor: bool) -> bool:
    """May this lesson be seated in this room, were nobody in it?

    Building, ห้องห้ามใช้, a room kept for other classes, a room kept for other
    teachers, a room belonging to another กลุ่มสาระ, and ลาน for a subject that
    may not go outside. Capacity is not here on purpose: the solver only ranks
    by it ("a tight room still beats no room"), it never refuses a room for it.
    """
    if not _room_in_buildings(room, want_buildings):
        return False
    # ห้องห้ามใช้ — a staff room, an office, anything the school has
    # said is not a classroom. (capacity 0 meant this before the
    # setting existed, and still does.)
    if not _room_usable(room):
        return False
    if not _room_allows_group(room, group_id, family):
        return False
    # A room held for named teachers is held for THEM, not for their
    # กลุ่มสาระ: this school has one room three teachers of three
    # different subjects share, and asking for both shut all three out.
    reserved = bool(_room_reserved_for(room))
    owns_it = (room.get("specialized_dept_id")
               and room["specialized_dept_id"] == want_dept)
    if reserved and not _room_free_for(room, teacher_id):
        # …unless it is this department's own facility. 353 ฟิสิกส์ has
        # one teacher's name on it, which shut every other science
        # teacher out: their lessons went to an ordinary room while the
        # lab stood empty half the week. A name on a lab means first
        # refusal, not sole use, so the owner is still preferred in
        # find_room's ranking — but an empty lab beats a physics lesson in a
        # general classroom.
        if not owns_it:
            return False
    if not reserved and room.get("specialized_dept_id") and not owns_it:
        return False
    # ลาน: open ground is a last resort for an ordinary subject and
    # only when the school has said this one may go outside.
    # (allow_outdoor decides what the solver may do on its own. A
    # คาบเรียนลาน never comes through here: find_room returns it from its
    # pinned_room_id branch, before eligible() is ever asked.)
    if room["type"] == "outdoor" and not may_outdoor:
        return False
    return True


def _is_subjects_own_room(room: dict[str, Any], subj_rooms: list[int],
                          want_dept: int | None) -> bool:
    """A facility of this subject: one it names, or one its กลุ่มสาระ owns.

    The only rooms a "ต้องเรียนที่ห้องประจำวิชา" lesson will take."""
    return room["id"] in subj_rooms or room.get("specialized_dept_id") == want_dept


def _elective_option_teachers(slot: dict[str, Any]) -> set[int]:
    """Teachers occupied by a shared elective window — all of them.

    There used to be a notion of the class having "settled on" one option, and
    the window then booked only that teacher. That is not what these periods
    are: when the hour comes the students sign up for whichever subject they
    want and go to that teacher, so every option runs at once and every one of
    those teachers is busy. The school's job is to put the subjects in the
    period and have them show up on both the teacher's sheet and the class's —
    not to pick one on their behalf.
    """
    if not slot.get("is_elective"):
        return set()
    return {o["teacher_id"] for o in slot.get("elective_options", []) if o.get("teacher_id")}


def _slot_teachers(slot: dict[str, Any]) -> set[int]:
    """Everyone who is in the room for this lesson, and therefore busy.

    The one chokepoint for the question, because getting it wrong in any one
    place does not look like a bug — it looks like the solver handing somebody
    a second class at an hour they were already teaching. Three callers used
    to assemble this set themselves and a สอนร่วม partner would have been
    missed by whichever one was forgotten.
    """
    out: set[int] = set()
    # 0 means ยังไม่ได้เลือกครู, not a teacher. Counted as one, every lesson
    # still waiting for a teacher would be "the same person" and they could
    # never share an hour.
    if slot.get("teacher_id"):
        out.add(slot["teacher_id"])
    if slot.get("co_teacher_id"):
        out.add(slot["co_teacher_id"])
    # ครูผู้ดูแลคาบกิจกรรม — ลูกเสือ, เนตรนารี, ชุมนุม. The roster belongs to
    # the activity, not to one classroom, so the same names sit on every slot
    # of it. They are busy for that hour once; see _same_activity.
    out |= {t for t in (slot.get("activity_teacher_ids") or []) if t}
    return out | _elective_option_teachers(slot)


def _shared_lesson_key(s: dict[str, Any]) -> str | None:
    """What makes several classes' cells ONE lesson for the teacher in it.

    Two shapes do this, and they do it for the same reason: the cell belongs to
    a class, but the teaching does not.

      คาบกิจกรรม — ลูกเสือ runs in fourteen classrooms at once and its
      ครูผู้ดูแล are listed on all fourteen, because the school divides the
      หมู่ among themselves rather than through the timetable.

      คาบเสรี — a window across ten classes, where the students scatter across
      twenty subjects. Each subject's teacher takes one group drawn from all ten
      rooms, so her name sits on all ten cells and she teaches one lesson.

    Anything counting a teacher's hours, or hunting for double-bookings, has to
    know this or it reports ten clashes for a period that has none and bills her
    for ten hours she did not work.

    None means an ordinary lesson, which belongs to its class alone.
    """
    k = s.get("activity_key")
    if k:
        return f"ACT:{k}"
    pool = s.get("elective_pool_id")
    # The two halves of a double are two real hours, so the period is part of it.
    if pool:
        return f"POOL:{pool}:{s.get('day')}:{s.get('period')}"
    # A คาบเสรี built class by class is the same window, written out one cell
    # per class. It carries no pool id — which is how a teacher standing in one
    # window facing ten classes was billed for ten hours of the same Wednesday,
    # and how the warning panel decided she was ten times over her daily quota.
    if s.get("is_elective"):
        return f"ELEC:{s.get('day')}:{s.get('period')}"
    return None


def _elective_option_pairs(s: dict[str, Any]) -> set[tuple]:
    return {(o.get("subject_id"), o.get("teacher_id"))
            for o in (s.get("elective_options") or [])}


def _repair_activity_keys() -> int:
    """Give any คาบกิจกรรม with an unsafe key a safe one.

    Keys used to be built from the activity's own name — "ACT-ลูกเสือ/
    เนตรนารี-3-1-7". A slash in a URL path is a new segment, so แก้ไข and ลบ
    answered Not Found for precisely those activities. Renaming them costs
    nothing: the key only has to be unique, and the name lives on the slots.
    """
    bad: dict[str, str] = {}
    for s in SLOTS:
        k = s.get("activity_key")
        if not k or not any(c in k for c in "/?#%\\"):
            continue
        if k not in bad:
            bad[k] = f"ACT-{s.get('day')}-{s.get('period')}-{_next('activity')}"
        s["activity_key"] = bad[k]
    return len(bad)



def _merge_sibling_rooms() -> int:
    """ห้องย่อยพี่น้องที่เรียนวิชาเดียวกันกับครูคนเดียวกัน = ห้องเดียวกัน

    "มีการแจ้งเตือนห้องซ้ำแบบนี้ ถ้าไม่มีผลต่อระบบไม่ต้องแก้ไข"

    ม.4/6ข and ม.4/6ค both taking ค31218 from ครูศศิกัลป์ in the one hour are
    one roomful, not two — the teacher cannot stand in two rooms. The placer
    knows that and seats them together, but the room-shuffling chains that run
    afterwards do not: moving one of them along to free a room for somebody
    else splits the lesson in half, and the แจ้งเตือน the school then sees
    ("ห้อง 001 ศูนย์1 ซ้ำ · ครูศศิกัลป์ ซ้ำ") is the symptom of it.

    So the invariant is restored here, last of all: everyone in such a group
    is put back in the room most of them are already in. That room is safe by
    construction — a sibling of theirs is holding it, and nobody else can be.
    """
    parent_of = {g["id"]: g.get("parent_id") for g in _flat_groups()}
    rooms = {r["id"]: r for r in ROOMS}
    groups: dict[tuple, list] = defaultdict(list)
    for s in SLOTS:
        if s.get("is_elective") or s.get("is_activity_block"):
            continue
        pid = parent_of.get(s["group_id"])
        if pid is None or not s.get("teacher_id") or s.get("subject_id") is None:
            continue
        groups[(pid, s["day"], s["period"], s["subject_id"], s["teacher_id"])].append(s)
    fixed = 0
    for same_hour in groups.values():
        if len(same_hour) < 2:
            continue
        # ซ่อมเฉพาะห้องที่เลือก: a roomful with a lesson frozen for this run stays
        # as it stands. (A repair run never splits one — a subgroup tied to a
        # sibling left out is frozen with it — so this only ever leaves a roomful
        # the school itself arranged that way.)
        if any(_repair_frozen(s) for s in same_hour):
            continue
        held = [s["room_id"] for s in same_hour if s.get("room_id")]
        if not held:
            continue
        # คาบเรียนลาน: a subgroup sitting on the ลาน the school picked for its
        # hour brings the rest of its roomful there. Merged the other way the
        # pick would be undone by a pass that only knows about counting heads.
        picked = [s["room_id"] for s in same_hour
                  if s.get("room_id")
                  and _yard_pick_for(s["group_id"], s["day"], s["period"]) == s["room_id"]]
        rid = Counter(picked or held).most_common(1)[0][0]
        r = rooms.get(rid) or {}
        for s in same_hour:
            if s.get("room_id") != rid:
                s["room_id"], s["room_name"], s["room_type"] = \
                    rid, r.get("name"), r.get("type")
                fixed += 1
    return fixed


def _tie_adjacent_doubles() -> int:
    """จับสองคาบติดกันของวิชาคาบคู่ ให้เป็นคาบคู่ก้อนเดียว

    A school with subgroups writes its doubles in a way the solver cannot see
    as one lesson. ม.4/6ข does ว30286 for two periods running while ม.4/6ก,
    beside it, does a different subject in each of those two hours — so the
    school writes two small เซ็ต, one per hour, and says which subject each
    subgroup takes in each. That is exactly right, and it lands correctly.

    What it does not do by itself is say that ข's two hours are ONE lesson.
    The two slots come from two different เซ็ต, so nothing ties them: the grid
    draws two cards where the school expects one block, and the วิชาคาบคู่
    setting the school made on ว30286 is nowhere to be seen on its own
    timetable.

    So afterwards: two adjacent periods, one class, one subject, one teacher,
    and the subject marked คาบคู่ — that is a double, however it was written
    down. Tied together here, the pair moves and clears as one, and the second
    half sits in the first half's room.
    """
    s_map = {s["id"]: s for s in SUBJECTS}
    g_map = {g["id"]: g for g in _flat_groups()}
    r_map = {r["id"]: r for r in ROOMS}
    by_class: dict[tuple, dict[int, dict]] = defaultdict(dict)
    for s in SLOTS:
        if (s.get("subject_id") is None or s.get("is_elective")
                or s.get("is_activity_block")):
            continue
        by_class[(s["group_id"], s["day"])][s["period"]] = s

    tied = 0
    for (gid, _day), cells in by_class.items():
        nums = _class_periods_for_level(_level_key(g_map.get(gid)))
        for i in range(len(nums) - 1):
            a, b = cells.get(nums[i]), cells.get(nums[i + 1])
            if not a or not b or a.get("double_group_key") or b.get("double_group_key"):
                continue
            if _repair_frozen(a) or _repair_frozen(b):
                continue            # ซ่อมเฉพาะห้องที่เลือก: not this pass's to touch
            if (a.get("subject_id") != b.get("subject_id")
                    or a.get("teacher_id") != b.get("teacher_id")):
                continue
            if ((s_map.get(a["subject_id"], {}) or {}).get("duration", 1) or 1) != 2:
                continue        # the school has not called this one a คาบคู่
            key = f"DBL-{_next('slot')}"
            a["double_group_key"] = b["double_group_key"] = key
            a["is_double_start"], a["is_double_cont"] = True, False
            b["is_double_start"], b["is_double_cont"] = False, True
            # One lesson, one room — the class does not pack up halfway. Unless
            # the school picked a ลาน for either hour (คาบเรียนลาน): that is
            # its own answer for that hour, and not this tidy-up's to undo or
            # to copy onto the other half, where the ลาน may not be free.
            if (a.get("room_id") and b.get("room_id") != a["room_id"]
                    and _yard_pick_for(gid, _day, a["period"]) is None
                    and _yard_pick_for(gid, _day, b["period"]) is None):
                room = r_map.get(a["room_id"]) or {}
                b["room_id"] = a["room_id"]
                b["room_name"] = room.get("name")
                b["room_type"] = room.get("type")
            tied += 1
    return tied


def _merge_teacherless_rows(only: "set[int] | None" = None) -> int:
    """วิชาเดียวกันของห้องเดียวกันที่เขียนไว้ซ้ำโดยไม่มีครู คือคาบเดียวกัน

    Saving a เซ็ตห้องย่อย with the teacher left blank used to write a SECOND
    row for a class that already had that subject: ม.5/10ก ended up with
    จ32221 twice, once with ครูทิพิชา and once with nobody. The timetable then
    did as it was told and scheduled both — "มีวิชาเกินมา", six periods of
    ก32208 for a class that takes two.

    A row with no teacher is never a second lesson. Nobody writes down "this
    class also studies this subject, taught by no one": it is the same lesson
    written again, from the other screen. So the rows are folded into one.

    The surviving row is the one that says WHEN (the set, which carries the
    hour its subgroups share) and it takes the teacher, the สอนร่วม partner
    and the room from the row that says WHO. Nothing is lost — the blank row
    held no information that the other one did not.
    """
    global REQUIREMENTS
    by_pair: dict[tuple, list[dict]] = defaultdict(list)
    for r in REQUIREMENTS:
        if only is not None and r.get("group_id") not in only:
            continue            # ซ่อมเฉพาะห้องที่เลือก: other classes' rows stay as written
        by_pair[(r.get("group_id"), r.get("subject_id"))].append(r)

    doomed: set[int] = set()
    merged = 0
    for rows in by_pair.values():
        if len(rows) < 2:
            continue
        # Two rows naming two DIFFERENT teachers are สอนร่วม written from each
        # side, or two teachers splitting the week. Left alone — _fold_coteaching
        # understands those. Rows that agree on the teacher, or say nothing
        # about one, are the same lesson written twice.
        if len({r["teacher_id"] for r in rows if r.get("teacher_id")}) > 1:
            continue
        # Two different เซ็ต naming the same subject for the same class are two
        # hours the school arranged separately, not one written twice.
        if len({r["parallel_group_key"] for r in rows
                if r.get("parallel_group_key")}) > 1:
            continue
        keeper = (next((r for r in rows if r.get("parallel_group_key")), None)
                  or next((r for r in rows if r.get("teacher_id")), rows[0]))
        for r in rows:
            if r is keeper:
                continue
            if not keeper.get("teacher_id") and r.get("teacher_id"):
                keeper["teacher_id"] = r["teacher_id"]
                if r.get("co_teacher_id") and not keeper.get("co_teacher_id"):
                    keeper["co_teacher_id"] = r["co_teacher_id"]
            for k in ("parallel_group_key", "pinned_day", "pinned_period",
                      "pinned_double", "room_id"):
                if not keeper.get(k) and r.get(k):
                    keeper[k] = r[k]
            # The class studies it as many times as the fuller row says, not
            # the two added together — that is the "extra lessons" complaint.
            keeper["weekly_count"] = max(keeper.get("weekly_count") or 0,
                                         r.get("weekly_count") or 0)
            doomed.add(id(r))
            merged += 1
    if doomed:
        REQUIREMENTS = [r for r in REQUIREMENTS if id(r) not in doomed]
    return merged


def _fill_set_teachers(only: "set[int] | None" = None) -> int:
    """เซ็ตที่เว้นช่องครูไว้ — ยืมครูของวิชานั้นมาให้ เมื่อบอกได้แน่ชัด

    "เปลี่ยนเป็นเวลาที่เลือกเว้นให้ เอามาจากวิชาของครูที่สอนวิชานั้นมา."

    Only when there is one answer: exactly one teacher in the school teaches
    that subject, and they are not already taking another subgroup of the same
    เซ็ต — sibling subgroups sit down at the same hour, so one teacher cannot
    have two of them. Anything less certain is left blank rather than guessed,
    and the cell says so.
    """
    by_subject: dict[int, set[int]] = defaultdict(set)
    for r in REQUIREMENTS:
        if r.get("teacher_id"):
            by_subject[r.get("subject_id")].add(r["teacher_id"])

    filled = 0
    for r in REQUIREMENTS:
        if r.get("teacher_id") or not r.get("parallel_group_key"):
            continue
        if only is not None and r.get("group_id") not in only:
            continue
        cands = by_subject.get(r.get("subject_id")) or set()
        if len(cands) != 1:
            continue
        tid = next(iter(cands))
        if any(x is not r and x.get("parallel_group_key") == r["parallel_group_key"]
               and x.get("teacher_id") == tid for x in REQUIREMENTS):
            continue
        r["teacher_id"] = tid
        filled += 1
    return filled


def _tidy_requirements(only: "set[int] | None" = None) -> dict[str, int]:
    """Both repairs, in the order they have to happen.

    `only` limits them to these classes' rows (ซ่อมเฉพาะห้องที่เลือก): a repair
    run has no business rewriting the plan of a class it was told to leave alone."""
    merged = _merge_teacherless_rows(only)
    filled = _fill_set_teachers(only)
    return {"merged": merged, "teachers_filled": filled}


def _repair_elective_doubles(only: "set[int] | None" = None) -> int:
    """Put back the missing half of a คาบเสรี that was set up as a คาบคู่.

    A double-period elective is two linked slots. Several things can take one
    of them away on its own — the school editing the period list, a lesson
    being dropped into the second hour, an older version of this file — and
    what is left is a single cell still wearing the 2× badge: "คาบเสรีทั้งที่
    เป็นคาบคู่กลับเหลือคาบเดี่ยว".

    So: if the other hour is free for that class, the half is re-created and
    the pair is whole again. If something is sitting in it that cannot be
    moved, the stale คาบคู่ marking is cleared instead — a single period
    honestly labelled beats a pair that only exists on one cell.
    """
    fixed = 0
    by_key: dict[str, list[dict]] = defaultdict(list)
    for s in SLOTS:
        if s.get("double_group_key"):
            by_key[s["double_group_key"]].append(s)

    for key, halves in by_key.items():
        if len(halves) >= 2:
            continue
        s = halves[0]
        if only is not None and s.get("group_id") not in only:
            continue            # ซ่อมเฉพาะห้องที่เลือก: not this class's to heal
        # An ordinary lesson that has lost its partner cannot be re-created
        # from here — nothing says who was meant to teach the other half or
        # where. What it must stop doing is wearing the 2× badge on its own.
        if not s.get("is_elective"):
            s["double_group_key"] = None
            s["is_double_start"] = False
            s["is_double_cont"] = False
            fixed += 1
            continue
        grp = _find_group(s["group_id"])
        p2 = _next_class_period_for(_level_key(grp), s["period"]) if grp else None
        # The missing half may be the FIRST one, if that is the end that went.
        if s.get("is_double_cont"):
            nums = _class_periods_for_level(_level_key(grp)) if grp else []
            i = nums.index(s["period"]) if s["period"] in nums else 0
            p2 = nums[i - 1] if i > 0 else None
        hits = [x for x in SLOTS
                if x["day"] == s["day"] and x["period"] == p2
                and x["group_id"] == s["group_id"]] if p2 is not None else []
        if p2 is None or (hits and not _evict_ordinary(s["day"], [p2], hits)):
            # Nowhere to put it: stop claiming this is half of a pair.
            s["double_group_key"] = None
            s["is_double_start"] = False
            s["is_double_cont"] = False
            fixed += 1
            continue
        mate = {**{k: v for k, v in s.items() if k not in ("id",)},
                "id": _next("slot"), "period": p2,
                "elective_options": [{**o, "id": _next("elective_option")}
                                     for o in (s.get("elective_options") or [])]}
        if s.get("is_double_cont"):
            mate["is_double_start"], mate["is_double_cont"] = True, False
        else:
            mate["is_double_start"], mate["is_double_cont"] = False, True
        SLOTS.append(mate)
        _apply_selected_option(mate)
        fixed += 1
    return fixed


def _fold_coteaching(rows: list[dict[str, Any]]) -> tuple[set[int], dict[int, int]]:
    """สอนร่วม written from both sides: two rows, one lesson.

    A school that imports its teaching plan gets a row per teacher — the Thai
    teacher has ม.1/1 EN21204 and the foreign teacher has ม.1/1 EN21204 — and
    both are true: each of them walks into that room. But the CLASS sits
    through the lesson once. Counted row by row, ม.1/1 was asked for 49
    periods in a 45-period week and the school was told to cut four lessons
    that do not exist.

    Returns the ids of the second halves, and for each surviving row the
    period count the pair agreed on (the larger of the two, so a 2+3
    disagreement is not silently rounded down).
    """
    by_cell: dict[tuple, list] = defaultdict(list)
    for r in rows:
        by_cell[(r["group_id"], r["subject_id"])].append(r)
    folded: set[int] = set()
    pair_count: dict[int, int] = {}
    for cell in by_cell.values():
        for i, a in enumerate(cell):
            if a["id"] in folded:
                continue
            for b in cell[i + 1:]:
                if b["id"] in folded:
                    continue
                # They have to name each other. Two teachers who each think
                # the class is theirs are a real disagreement, and the
                # ตรวจสอบวิชาซ้ำ warning should still say so.
                if a.get("co_teacher_id") == b["teacher_id"] or \
                   b.get("co_teacher_id") == a["teacher_id"]:
                    folded.add(b["id"])
                    pair_count[a["id"]] = max(a.get("weekly_count") or 0,
                                              b.get("weekly_count") or 0)
                    break
    return folded, pair_count


def _same_activity(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Two cells of one shared lesson — ลูกเสือ in ม.1/1 and ลูกเสือ in ม.1/2."""
    k = _shared_lesson_key(a)
    if not k or k != _shared_lesson_key(b):
        return False
    # Two per-class คาบเสรี cells share an hour, which is not on its own proof
    # they are the same window: ม.2 and ม.3 may both hold one at พุธ คาบ 7, and
    # a teacher who offers something in both really is in two places at once.
    # They are one window when they put the same thing on offer.
    if k.startswith("ELEC:"):
        return bool(_elective_option_pairs(a) & _elective_option_pairs(b))
    return True


def _teacher_view(slots: list[dict[str, Any]], teacher_id: int) -> list[dict[str, Any]]:
    """One teacher's own week: what they teach, each thing once.

    ลูกเสือ across fourteen classrooms is one hour of this teacher's Monday,
    so it appears once — and so does her subject in a คาบเสรี spanning ten
    classes. The classroom kept is simply the first: which room they end up
    with is theirs to sort out, and the sheet says the scope rather than
    pretending to know.
    """
    out, seen = [], set()
    for s in slots:
        if teacher_id not in _slot_teachers(s):
            continue
        k = _shared_lesson_key(s)
        if k:
            if k in seen:
                continue
            seen.add(k)
        out.append(s)
    return out


# ── วิชาเสรี: pools ───────────────────────────────────────────────────────────
# A pool is one elective WINDOW shared by several classes, holding the subject
# options a student may pick inside it. The staffing sheet writes these as
# "ม.1/7-12 กรีฑา 2 คาบ" — six classes, one window, กรีฑา being one of nine
# options — so a pool is the unit the school actually schedules, and placing it
# writes one elective slot per class at the same day/period.
ELECTIVE_POOLS: list[dict[str, Any]] = []

# หลักสูตร: the reference for which subjects a class may take, and how many
# periods a week. Rows hold only subject_id and weekly_count; a class points at
# its curriculum with `curriculum_id`. Changed in place by convention (append,
# remove, and the restore's clear() + extend()) so that anything which did
# `from mock_api import CURRICULA` keeps seeing the live list. curriculum.py
# would survive a rebind regardless: it reads the table through
# `lambda: CURRICULA`, which looks the name up each time it is called.
CURRICULA: list[dict[str, Any]] = []

# คาบเรียนลาน: the school decides, by hand and in advance, that one class's one
# hour happens outdoors on a named ลาน — which frees an indoor room for a lesson
# that would otherwise have nowhere to go. Rows are
# {"id", "group_id", "day", "period", "room_id"}, at most one per
# (group_id, day, period), and room_id is always an outdoor room. A pick holds
# whatever lesson sits in that cell, and holds the hour on the ลาน even when no
# lesson sits there yet. Changed in place only (append, remove, and the
# restore's clear() + extend()), like CURRICULA. The order the school prefers
# its ลาน in lives in SCHOOL_CONFIG["yard_order"], not here.
YARD_PICKS: list[dict[str, Any]] = []

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
    # A new kind of row should not have to remember to register itself here;
    # forgetting raised KeyError at the moment a teacher pressed save.
    _counters[key] = _counters.get(key, 0) + 1
    return _counters[key]


# ── วิชาที่มีปัญหา: find them, and let a run leave them out ───────────────────
# Some lessons cannot be placed however the timetable is arranged — a class
# already asked to sit 40 periods in a 35-period week, a teacher booked past
# their own limit, a subject whose teacher was deleted. Left in, they make the
# whole run look like a failure and bury the cases that could still be fixed.
# So they are found before the run, shown, and may be left out of it.

LAST_RUN: dict[str, Any] = {"unplaced_requirement_ids": [], "skipped_requirement_ids": []}


def _mark_elective(*subject_ids: Any) -> None:
    """A subject put into an elective period IS an elective subject.

    Asking the school to tick a box as well would mean the counting is wrong
    until somebody remembers — and the whole reason the warning list was full
    of imaginary overloads is that nothing knew these subjects were shared.
    Putting one into a คาบเสรี says so plainly enough.
    """
    want = {int(i) for i in subject_ids if i}
    if not want:
        return
    for s in SUBJECTS:
        if s["id"] in want and not s.get("is_elective"):
            s["is_elective"] = True


def _elective_subject_ids() -> set[int]:
    """Subjects a student CHOOSES rather than one the whole class sits.

    Three ways in, and the third was the one that was missing: the school
    ticks วิชาเสรี on the subject; the subject is an option in a คาบเสรี pool;
    or it is an option in a per-class คาบเสรี cell. The last is how most of
    this school's electives are actually held, so leaving it out meant the
    tick never appeared for them and every one was still counted per class.

    Reading also writes the tick back, so a subject that was put into a window
    before any of this existed is marked from the next time anything looks —
    rather than waiting for somebody to notice and tick it by hand.
    """
    out = {s["id"] for s in SUBJECTS if s.get("is_elective")}
    found: set[int] = set()
    for p in ELECTIVE_POOLS:
        for o in p.get("options", []):
            if o.get("subject_id"):
                found.add(o["subject_id"])
    for sl in SLOTS:
        if not sl.get("is_elective"):
            continue
        for o in sl.get("elective_options") or []:
            if o.get("subject_id"):
                found.add(o["subject_id"])
    if found - out:
        _mark_elective(*(found - out))
    return out | found


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
    # วิชาเสรี are counted once, not once per classroom.
    #
    # Ten classes "taking" ศิลปะตกแต่ง does not mean ten lessons: the students
    # who chose it come out of all ten and sit together, so it is one hour of
    # one teacher's week and one hour of each of those classes'. Added up the
    # old way it read as twenty hours for the teacher and put every one of the
    # ten classes over the size of the week — which is what filled the warning
    # list with classes and teachers that were never actually overloaded.
    #
    # For the teacher: one entry per subject, the largest weekly_count asked
    # for it. For the class: all its electives together are one block, the
    # largest of them, because a student picks one of them, not all.
    elective_ids = _elective_subject_ids()
    # สอนร่วม is written as a row per teacher. Both teachers are in the room,
    # so both carry the hours — but the class sits through the lesson once,
    # and counting both halves is what told ม.1/1 to cut four periods it was
    # never asked for.
    co_halves, _ = _fold_coteaching(REQUIREMENTS)
    own: dict[int, int] = defaultdict(int)
    load_teacher: dict[int, int] = defaultdict(int)
    t_elect: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    g_elect: dict[int, int] = defaultdict(int)
    for r in REQUIREMENTS:
        wc = r.get("weekly_count") or 0
        mine = r["id"] not in co_halves          # only one half bills the class
        if r["subject_id"] in elective_ids:
            t = t_elect[r["teacher_id"]]
            t[r["subject_id"]] = max(t[r["subject_id"]], wc)
            if mine:
                g_elect[r["group_id"]] = max(g_elect[r["group_id"]], wc)
            continue
        load_teacher[r["teacher_id"]] += wc
        if mine:
            own[r["group_id"]] += wc
    for tid, subs in t_elect.items():
        load_teacher[tid] += sum(subs.values())
    for gid, wc in g_elect.items():
        own[gid] += wc

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
        # วิชาที่สั่งว่า "ไม่เรียนนอกอาคาร" ชนะกลุ่มสาระ เหมือนในตัวจัดตาราง
        # ทั้งสองตัว — ไม่งั้นที่นี่จะตอบว่าวิชาสุขศึกษาที่ติ๊กไว้ "มีห้องให้ใช้"
        # เพราะยังมีลานว่าง ทั้งที่มันต้องอยู่ในห้อง
        outdoor = (subj.get("department_id") in dep_out
                   and _subject_outdoor(subj) is not False)
        dept = subj.get("department_id")
        for room in ROOMS:
            if room["id"] in _subject_rooms(subj):
                return True
            if not _room_usable(room):
                continue          # ห้องห้ามใช้ — a staff room or office
            if room.get("specialized_dept_id") and room["specialized_dept_id"] != dept:
                continue
            if outdoor != (room["type"] == "outdoor"):
                continue
            return True
        return False

    # Ticked as เสรี, but no คาบเสรี window offers it yet. Both kinds of
    # window count — the pool and the per-class cell — or a subject already
    # being taught in one would be told it is not scheduled.
    pooled = {o["subject_id"] for p in ELECTIVE_POOLS for o in p.get("options", [])
              if o.get("subject_id")}
    pooled |= {o["subject_id"] for sl in SLOTS if sl.get("is_elective")
               for o in (sl.get("elective_options") or []) if o.get("subject_id")}
    ticked_not_pooled = {x["id"] for x in SUBJECTS
                         if x.get("is_elective") and x["id"] not in pooled}

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
            # Two different things, and the school can only act on one of
            # them: a row saved without a teacher on purpose (a เซ็ตห้องย่อย
            # is about which subjects run together, and who teaches them is
            # often settled later), and a row pointing at a teacher who has
            # since been removed.
            reasons.append(("blocking",
                "ยังไม่ได้เลือกครู — เลือกที่ปุ่ม จัดห้อง/ครู ของวิชานี้ แล้วระบบจะจัดให้"
                if r.get("teacher_id") in (None, "", 0)
                else "ไม่พบครูผู้สอนคนนี้แล้ว (อาจถูกลบไป)"))
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
        # Ticking วิชาเสรี fixes the counting; it does not by itself make the
        # solver run one window for all the classes. Said here, because the
        # warning going quiet would otherwise look like the problem solved —
        # and the run would still try to place ten separate lessons.
        if r["subject_id"] in ticked_not_pooled:
            reasons.append(("warning",
                "ติ๊กเป็นวิชาเสรีแล้ว แต่ยังไม่ได้อยู่ในคาบเสรี — "
                "ตัวจัดตารางจะยังจัดแยกทีละห้อง ให้ไปสร้าง 'คาบเสรี' "
                "แล้วใส่วิชานี้เข้าไป ทุกห้องจึงจะเรียนพร้อมกันจริง"))
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


def _elective_window_groups(subject_id: int) -> set[int]:
    """Classes sitting in a คาบเสรี that offers this subject."""
    out: set[int] = set()
    for p in ELECTIVE_POOLS:
        if any(o.get("subject_id") == subject_id for o in p.get("options", [])):
            out |= {g for g in (p.get("group_ids") or [])}
    for s in SLOTS:
        if not s.get("is_elective"):
            continue
        if any(o.get("subject_id") == subject_id
               for o in (s.get("elective_options") or [])):
            out.add(s["group_id"])
    return out


def _reqs_served_by_elective() -> set[int]:
    """Plan rows whose teaching already happens inside a คาบเสรี.

    The school writes a วิชาเสรี down twice, and both are right: the plan says
    which classes may choose it, and the คาบเสรี is the hour it is actually
    taught in. Read as two separate instructions, the solver placed the window
    AND an ordinary lesson of the same subject for every class — ยิมนาสติก in
    the Tuesday window and again on Thursday, with one teacher in two places.

    So a plan row is left alone once the class it belongs to sits in a window
    offering that subject. A class NOT in any window keeps its ordinary
    lesson, which is the whole point of the coverage warning.
    """
    shares = _shares_students_fn()
    by_subject: dict[int, set[int]] = {}
    out: set[int] = set()
    for r in REQUIREMENTS:
        sid = r["subject_id"]
        if sid not in by_subject:
            by_subject[sid] = _elective_window_groups(sid)
        here = by_subject[sid]
        if not here:
            continue
        if any(shares(r["group_id"], g) for g in here):
            out.add(r["id"])
    return out


def _excluded_requirement_ids(body: dict[str, Any]) -> set[int]:
    """Requirement ids this run must leave alone."""
    ids = set(body.get("exclude_requirement_ids") or [])
    if body.get("skip_problems"):
        only_blocking = body.get("skip_problems") == "blocking"
        for p in _requirement_problems():
            if not only_blocking or p["severity"] == "blocking":
                ids.add(p["requirement_id"])
    # Already taught in a คาบเสรี — placing it again is a second lesson of a
    # subject the class takes once, with the teacher booked twice for it.
    ids |= _reqs_served_by_elective()
    # ยังไม่ได้เลือกครู.
    #
    # A plain row with no teacher is not a lesson — nothing says when it
    # happens or who is in the room — so it is reported rather than placed.
    #
    # A row in a เซ็ตห้องย่อย is different, and the set screen says so on the
    # field itself ("ครู (เว้นว่างได้)"). The point of a set is the HOUR: ก and
    # ข sit down at the same time, whoever ends up teaching them. Skipping
    # those rows meant a set saved without teachers placed nothing at all —
    # the subgroups' own ordinary lessons were then scheduled independently
    # and the school saw exactly what it did not ask for: "วิชาที่ทำเป็นเซ็ต
    # มาแค่วิชาเดี่ยวเอง". So they are placed, with no teacher booked.
    ids |= {r["id"] for r in REQUIREMENTS
            if not r.get("teacher_id") and not r.get("parallel_group_key")}
    return ids


# ── คาบที่ลงไม่ได้ ───────────────────────────────────────────────────────────
#
# "ไม่สามารถจัด ค32205 ครบ 3 คาบ (จัดได้ 1/3)" says what happened and nothing
# about why, so the only way forward was to guess: cut a period, add a teacher,
# unlock something, run it again. The answer is knowable — every cell of that
# class's week was rejected for a reason, and the reasons can be counted.
#
# So for each lesson that did not fit, this walks the week cell by cell and
# reports what stood in the way, how often, and which of the class's existing
# lessons could move outdoors to free a room. The school reads it and decides.

def _unplaced_report(limit: int = 80) -> dict[str, Any]:
    """Every lesson the plan asks for and the timetable does not hold, with
    the reason each cell of that class's week refused it.

    Everything it needs is indexed once up front. Asked the obvious way — a
    scan of all 2,100 slots inside a loop over 1,700 rows × 30 cells — the
    page sat on "กำลังตรวจ…" long enough to look broken.
    """
    g_map  = {g["id"]: g for g in _flat_groups()}
    s_map  = {x["id"]: x for x in SUBJECTS}
    t_map  = {t["id"]: t for t in TEACHERS}
    r_name = {r["id"]: r["name"] for r in ROOMS}
    shares = _shares_students_fn()

    cell_slots: dict[tuple, list] = defaultdict(list)     # (day, period)
    teach_cell: dict[tuple, list] = defaultdict(list)     # (tid, day, period)
    class_week: dict[int, list]   = defaultdict(list)     # group_id
    placed_of:  dict[tuple, int]  = defaultdict(int)      # (group, subject)
    roomless_of: dict[tuple, int] = defaultdict(int)      # …and with no room
    room_busy:  dict[tuple, set]  = defaultdict(set)      # (day, bucket)
    for s in SLOTS:
        cell_slots[(s["day"], s["period"])].append(s)
        class_week[s["group_id"]].append(s)
        if s.get("subject_id") is not None:
            # คาบกรอบแดง = คาบที่ยังจัดไม่ลงตัว วางไว้ให้เห็นเฉยๆ ยังไม่มีห้อง
            # จึงไม่นับว่าลงแล้ว — มิฉะนั้นมันจะหายไปจากรายการ "ยังลงไม่ได้"
            # ซึ่งเป็นที่เดียวที่โรงเรียนจะเห็นว่ายังต้องแก้
            if not s.get("is_overflow"):
                placed_of[(s["group_id"], s["subject_id"])] += 1
                if not s.get("room_id"):
                    roomless_of[(s["group_id"], s["subject_id"])] += 1
        for t in _slot_teachers(s):
            teach_cell[(t, s["day"], s["period"])].append(s)
        if s.get("room_id"):
            for b in _slot_buckets(g_map.get(s["group_id"]), s["period"]):
                room_busy[(s["day"], b)].add(s["room_id"])

    prefs = {t["id"]: _teacher_prefs(t) for t in TEACHERS}
    caps  = {t["id"]: _consec_limit(t) for t in TEACHERS}

    def rooms_free(req, grp, subj, day, period) -> int:
        """How many rooms this lesson could actually use at this hour."""
        busy = set()
        for b in _slot_buckets(grp, period):
            busy |= room_busy[(day, b)]
        family = {req["group_id"], grp.get("parent_id")} | {
            (c["id"] if isinstance(c, dict) else c) for c in (grp.get("children") or [])}
        family.discard(None)
        want = set(_subject_rooms(subj))
        n = 0
        for r in ROOMS:
            if r["id"] in busy or not _room_usable(r):
                continue
            if not _room_allows_group(r, req["group_id"], family):
                continue
            if r["id"] in want:
                n += 1; continue
            if _room_reserved_for(r) and not _room_free_for(r, req["teacher_id"]):
                continue
            if (r.get("specialized_dept_id")
                    and r["specialized_dept_id"] != subj.get("department_id")):
                continue
            if r["type"] == "outdoor" and not _may_use_outdoor(subj, req, grp):
                continue
            n += 1
        return n

    def blocker(req, grp, subj, nums, day, period) -> tuple[str, str]:
        """Why this lesson cannot go in this cell. ("", "") means it can."""
        tid = req["teacher_id"]
        if day in prefs.get(tid, {}).get("days_off", ()):
            return "teacher_off", "ครูหยุดวันนี้"

        for s in cell_slots.get((day, period), ()):
            if shares(s["group_id"], req["group_id"]):
                label = s.get("subject_code") or s.get("activity_name") or "คาบอื่น"
                where = g_map.get(s["group_id"], {})
                same  = s["group_id"] == req["group_id"]
                return "group_busy", (f"ห้องนี้เรียน {label} อยู่แล้ว" if same
                                      else f"{where.get('name','ห้องแม่/ห้องลูก')} เรียน {label} อยู่")

        for s in teach_cell.get((tid, day, period), ()):
            where = g_map.get(s["group_id"], {})
            label = s.get("subject_code") or "คาบอื่น"
            return "teacher_busy", f"ครูสอน {where.get('name','ห้องอื่น')} {label} อยู่"

        # Back-to-back ceiling for this teacher on this day.
        idx = nums.index(period) if period in nums else -1
        if idx >= 0:
            run, i = 1, idx - 1
            while i >= 0 and teach_cell.get((tid, day, nums[i])):
                run += 1; i -= 1
            i = idx + 1
            while i < len(nums) and teach_cell.get((tid, day, nums[i])):
                run += 1; i += 1
            cap = caps.get(tid, CONSEC_HARD)
            if run > cap:
                return "consecutive", f"จะทำให้ครูสอนติดกัน {run} คาบ (เพดาน {cap})"

        if not rooms_free(req, grp, subj, day, period):
            return "no_room", "ไม่มีห้องว่างที่วิชานี้ใช้ได้"
        return "", ""

    co_halves, _ = _fold_coteaching(REQUIREMENTS)
    served       = _reqs_served_by_elective()
    elective_ids = _elective_subject_ids()

    short = []
    for req in REQUIREMENTS:
        want = req.get("weekly_count") or 0
        if want <= 0 or req["id"] in co_halves or req["id"] in served:
            continue
        got  = placed_of.get((req["group_id"], req["subject_id"]), 0)
        # A lesson sitting in the week with no room at all is not "placed" in
        # any sense the school cares about — it is the same question ("why
        # can this not go in?") with the same answers, so it belongs in the
        # same list.
        bare = roomless_of.get((req["group_id"], req["subject_id"]), 0)
        if got < want or bare:
            short.append((want - got, got, req, bare))
    short.sort(key=lambda x: (-(x[0] + x[3])))
    cut = short[:limit]

    rows = []
    for missing, got, req, bare in cut:
        grp  = g_map.get(req["group_id"], {})
        subj = s_map.get(req["subject_id"], {}) or {}
        nums = _class_periods_for_level(_level_key(grp))
        tally: dict[str, int] = defaultdict(int)
        examples: dict[str, str] = {}
        free_cells = []
        # Two things make a row unplaceable before the week is even looked at,
        # and walking thirty cells to say "the class is busy" about a class
        # that does not exist is how these came back as a nameless "?" with
        # no reason attached — 115 of the school's 184 missing periods.
        if not grp:
            tally["no_group"] = len(nums) * 5
            examples["no_group"] = f"ไม่มีห้องเรียนรหัส {req['group_id']} ในระบบแล้ว"
        elif not req.get("teacher_id") and not req.get("parallel_group_key"):
            tally["no_teacher"] = len(nums) * 5
            examples["no_teacher"] = "ยังไม่ได้เลือกครูผู้สอน"
        else:
            for day in range(5):
                for period in nums:
                    kind, why = blocker(req, grp, subj, nums, day, period)
                    if not kind:
                        free_cells.append({"day": day, "period": period})
                        continue
                    tally[kind] += 1
                    examples.setdefault(kind, why)

        # วิชาที่ห้องนี้เรียนอยู่ และย้ายลงลานได้ — the lever the school has
        # when it is short of rooms.
        movable = []
        for s in sorted(class_week.get(req["group_id"], ()),
                        key=lambda s: (s["day"], s["period"])):
            sb = s_map.get(s.get("subject_id") or -1) or {}
            if not sb or s.get("room_type") == "outdoor":
                continue
            if _subject_outdoor(sb) is False:
                continue
            movable.append({
                "slot_id": s["id"], "day": s["day"], "period": s["period"],
                "subject_id": sb.get("id"), "subject_code": sb.get("code"),
                "subject_name": sb.get("name"),
                "room_name": r_name.get(s.get("room_id")),
                "already_allowed": _may_use_outdoor(sb, None, grp),
            })
            if len(movable) >= 12:
                break

        rows.append({
            "requirement_id": req["id"],
            "group_id": req["group_id"],
            # Never blank. A row the school cannot name is a row it cannot act
            # on, and these are exactly the rows that most need acting on.
            "group_name": grp.get("name") or f"⚠ ไม่พบห้องเรียน #{req['group_id']}",
            "orphan": not grp,
            "subject_id": req["subject_id"], "subject_code": subj.get("code"),
            "subject_name": subj.get("name"),
            "teacher_id": req["teacher_id"],
            "teacher_name": (t_map.get(req["teacher_id"]) or {}).get("name"),
            "wanted": req.get("weekly_count") or 0, "placed": got, "missing": missing,
            "roomless": bare,
            "is_elective": req["subject_id"] in elective_ids,
            "free_cells": free_cells,
            "blockers": [{"kind": k, "count": n, "example": examples.get(k, "")}
                         for k, n in sorted(tally.items(), key=lambda kv: -kv[1])],
            "movable_outdoor": movable,
            "week_size": len(nums) * 5,
        })

    rows.sort(key=lambda r: (-(r["missing"] + r["roomless"]), r["group_name"] or ""))
    return {
        "unplaced": rows,
        "total_missing": sum(m for m, _g, _r, _b in short),
        "total_roomless": sum(b for _m, _g, _r, b in short),
        "total_rows": len(short),
        "shown": len(rows),
        "last_run": LAST_RUN,
    }


@app.get("/api/timetable/unplaced")
def get_unplaced():
    return _unplaced_report()


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
LAST_PERIOD_MAX = 3     # เพดานคาบสุดท้าย/สัปดาห์ต่อครู — 0 = ไม่จำกัด

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
        # ห้องของครูคนนี้สำคัญกว่าห้องประจำชั้นไหม — True ครูอยู่กับที่
        # นักเรียนเดินมาหา, False นักเรียนอยู่กับที่ ครูเดินไปสอน,
        # None ตามค่าของโรงเรียน
        "room_wins": (adv.get("room_over_homeroom")
                      if isinstance(adv.get("room_over_homeroom"), bool) else None),
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


def _school_max_last_period(body: dict[str, Any] | None = None) -> int:
    """เพดานคาบสุดท้าย/สัปดาห์ต่อครู — 0 means no ceiling.

    A real trade, so the school sets it rather than us. Capped at three, this
    school loses about ten lessons a week: the cells still free at the end of
    a solve really are the late ones, and a limit that cannot be lifted turns
    "this teacher goes home late four times" into "this class never gets the
    subject". Lifting it places everything and puts a handful of teachers on
    the last period four or five days running — which is the complaint that
    brought the setting into being.
    """
    for src in (body or {}, SCHOOL_CONFIG if isinstance(SCHOOL_CONFIG, dict) else {}):
        v = src.get("max_last_period")
        if v not in (None, ""):
            try:
                return max(0, int(v))
            except (TypeError, ValueError):
                pass
    return LAST_PERIOD_MAX


def _last_period_for(level: str) -> int | None:
    """The final lesson period of the day for this level."""
    key = ("lastnum", level)
    if key in _LOOKUP_CACHE:
        return _LOOKUP_CACHE[key]
    nums = _class_periods_for_level(level)
    out = nums[-1] if nums else None
    _LOOKUP_CACHE[key] = out
    return out


# ── คาบสุดท้ายของวัน: ใช้เมื่อจำเป็นเท่านั้น ──────────────────────────────────
#
# "ช่วยทำให้ไม่มีคาบ 9 เลย เพราะยังมีคาบว่างอยู่ ... ถ้าระบบลงไม่ได้จริงๆ
#  ก็ไม่ต้องลงให้ เพราะเดี๋ยวฉันจะไปกำหนดเอง"
#
# A class whose lessons fit inside คาบ 1-8 should go home when คาบ 8 ends.
# The last period is not another cell like the rest: it is the one the school
# would rather leave empty, and only a class with more lessons than the rest
# of the day can hold has any business sitting through it. Before this, the
# last period was simply discouraged by a tie-break inside the single-lesson
# placer — which left เซ็ตห้องย่อย, คาบคู่ and everything placed by the other
# loops free to fill it while คาบ 1 of the same class stood empty.

LAST_PERIOD_MODE = "reserve"      # reserve | never | free

_LAST_PERIOD_MODES = ("reserve", "never", "free")

# What CP-SAT is charged for sending a class home at the last period of the day.
# It is a price rather than a ban, and where it sits between the other prices is
# the rule itself: above every walking penalty put together (60 + 8 + 5 for the
# worst room), so any amount of walking is preferred to a late finish; well
# under the 1000 an unplaced lesson costs, so a class whose week does not fit in
# the earlier hours still gets taught.
TAIL_COST = 200

# What CP-SAT is charged for seating a class that stays in its own room
# (เรียนในห้องประจำชั้น — ห้องเพชร) anywhere else. The greedy placer takes the
# homeroom the moment it is free; CP-SAT has no "moment", only prices, so the
# rule is where this number sits among the others:
#
#   · above TAIL_COST (200): the school would rather a ห้องเพชร class go home
#     late in its own room than finish early in someone else's. Were it below,
#     the optimiser would happily move them out of their room to buy an earlier
#     bell, which is exactly the trade the school said it does not want.
#   · above every walking penalty put together (60 + 8 + 5, as for TAIL_COST),
#     so no department lab or teacher's room ever pulls them out of it. A
#     ห้องประจำวิชา is the one exception, and it is not priced against this at
#     all: those lessons are left out of the rule (see _stays_home_for).
#   · far below 1000, the price of a lesson not taught. A homeroom that is
#     genuinely taken at every hour that suits the class must still yield a
#     lesson in another room, not an empty cell: 400 + 200 + 73 = 673 is still
#     a lesson worth placing. A hard rule here would lose lessons on a day the
#     room is full, which helps nobody; the run reports those lessons by class
#     instead (_stay_home_notes), so the school can see the exceptions.
STAY_HOME_COST = 400

_DAYS_TH = ("จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์")


def _stay_home_notes(slots: list[dict[str, Any]], homes: dict[int, int | None],
                     named: Any = None) -> list[str]:
    """Say which lessons of the classes that stay home did NOT stay home.

    Both solvers treat the rule as a very strong preference rather than a
    filter, so a lesson can end up elsewhere on the day the homeroom is
    genuinely taken. Said out loud and by class, because the alternative is
    the office finding a ห้องเพชร class in the wrong room and wondering why.

    `slots` are the lessons this run placed. `homes` is the room each class
    is meant to stay in — its ห้องประจำชั้น, or the one the run settled on
    for a class that has none. `named` says a lesson's room was written by
    the school itself (a requirement's room, a ลาน picked for the hour): that
    is an instruction, not a yielded preference, and is not an exception.
    """
    g_map = {g["id"]: g for g in _flat_groups()}
    s_map = {s["id"]: s for s in SUBJECTS}
    r_map = {r["id"]: r for r in ROOMS}
    outdoor_depts = {d["id"] for d in DEPARTMENTS if "พลศึกษา" in d.get("name", "")}
    covered: dict[int, int] = defaultdict(int)
    away: dict[int, list[dict]] = defaultdict(list)
    # ห้องเพชร pulled out of its room by a ห้องประจำวิชา, counted per
    # (subject, room) so the line can name what to go and change.
    by_subject: dict[int, dict[tuple, int]] = defaultdict(lambda: defaultdict(int))
    for s in slots:
        gid = s.get("group_id")
        grp = g_map.get(gid)
        home = r_map.get(homes.get(gid))
        subj = s_map.get(s.get("subject_id"))
        if (grp is None or subj is None
                or s.get("is_elective") or s.get("is_activity_block")
                or s.get("is_overflow")):
            continue
        if not _stays_home_for(grp, subj, home, subj.get("department_id") in outdoor_depts):
            # Exempt, not yielded — but say so anyway when it is a ห้องประจำวิชา
            # that took the class out of its room.
            #
            # The school ticked ม.1/1 ห้องเพชร, pressed สร้างตาราง, and still
            # found it in 322 ToBeNumberOne with nothing anywhere saying why.
            # The rule was working exactly as written: a subject with a room of
            # its own is not the class's to decide. But "ห้องประจำวิชา" is a
            # setting on the SUBJECT, made once, possibly years ago, and
            # nothing on the timetable screen shows it. So the office sees a
            # rule it set being ignored, and has no way to find the setting
            # that is overriding it.
            #
            # Not an exception and not a fault — the school may well want it —
            # so it is reported separately, with the subject and the room
            # named, because that is what you need to go and change.
            if (grp.get("stay_in_homeroom") is True and home
                    and s.get("room_id") and s.get("room_id") != home["id"]
                    and _subject_rooms(subj)
                    and subj.get("department_id") not in outdoor_depts
                    and not (named is not None and named(s))):
                by_subject[gid][(s.get("subject_id"), s.get("room_id"))] += 1
            continue
        if named is not None and named(s):
            continue
        covered[gid] += 1
        if s.get("room_id") != home["id"]:
            away[gid].append(s)
    out: list[str] = []
    for gid in sorted(by_subject, key=lambda i: str(g_map[i].get("name"))):
        grp = g_map[gid]
        home = r_map.get(homes.get(gid))
        items = sorted(by_subject[gid].items(), key=lambda kv: -kv[1])
        shown = "; ".join(
            f"{(s_map.get(sid) or {}).get('code') or (s_map.get(sid) or {}).get('name') or sid}"
            f" → {(r_map.get(rid) or {}).get('name') or rid} ({n} คาบ)"
            for (sid, rid), n in items[:4])
        out.append(
            f"{grp.get('name')}: ตั้งเป็นห้องเพชรไว้ แต่ "
            f"{sum(n for _k, n in items)} คาบยังออกไปเรียนห้องอื่น "
            f"เพราะวิชานั้นตั้งห้องประจำวิชาไว้ ซึ่งมาก่อนห้องประจำชั้นเสมอ "
            f"({shown}{' …' if len(items) > 4 else ''}) "
            f"— ถ้าไม่ได้ตั้งใจ ให้เอาห้องประจำวิชาออกจากวิชานั้นที่หน้ารายวิชา "
            f"แล้วกดแก้เฉพาะห้องนี้อีกครั้ง")
    for gid in sorted(covered, key=lambda i: str(g_map[i].get("name"))):
        grp, home = g_map[gid], r_map[homes[gid]]
        if not grp.get("homeroom_room_id"):
            out.append(
                f"{grp.get('name')}: ติ๊กให้เรียนในห้องประจำชั้น แต่ยังไม่ได้บันทึกห้องประจำชั้นไว้ "
                f"จึงใช้ห้อง {home.get('name')} เป็นห้องประจำแทนตลอดสัปดาห์ "
                f"— บันทึกห้องจริงที่หน้าห้องเรียนได้")
        if not away[gid]:
            continue
        where = sorted(away[gid], key=lambda s: (s["day"], s["period"]))
        shown = "; ".join(
            f"วัน{_DAYS_TH[s['day']] if 0 <= s['day'] < len(_DAYS_TH) else s['day']} "
            f"คาบ {s['period']} → {s.get('room_name') or 'ไม่มีห้อง'}"
            for s in where[:4])
        out.append(
            f"{grp.get('name')}: ตั้งให้เรียนในห้องประจำชั้น ({home.get('name')}) "
            f"แต่ {len(where)} จาก {covered[gid]} คาบต้องเรียนห้องอื่น เพราะห้องประจำชั้นไม่ว่างหรือใช้ไม่ได้ในชั่วโมงนั้น "
            f"({shown}{' …' if len(where) > 4 else ''})")
    return out


def _school_last_period_mode(body: dict[str, Any] | None = None) -> str:
    """How the school wants the last period of the day used.

    reserve  ใช้เมื่อจำเป็น — fill every other period first; a class only gets
             the last period when its own week has nowhere else to put the
             lesson. (the default)
    never    ไม่ใช้เลย — never place anything there. What will not fit is
             reported instead, for the school to seat by hand.
    free     ใช้ได้ตามปกติ — the old behaviour, just another cell.
    """
    for src in (body or {}, SCHOOL_CONFIG if isinstance(SCHOOL_CONFIG, dict) else {}):
        v = src.get("last_period_mode")
        if isinstance(v, bool):
            return "free" if v else "reserve"
        if isinstance(v, str) and v in _LAST_PERIOD_MODES:
            return v
    return LAST_PERIOD_MODE


# ── วิชายากควรอยู่ช่วงเช้า ────────────────────────────────────────────────────
# Maths and science in the last period of the afternoon is a lesson half the
# room sleeps through. This is a nudge, not a rule: a subject marked this way
# is tried in the morning first and only drops into the afternoon when nothing
# else fits, so it never costs a lesson its place in the timetable.

def _morning_cutoff(level: str) -> int | None:
    """The period a morning ends at — the last one starting before noon."""
    key = ("morning", level)
    if key in _LOOKUP_CACHE:
        return _LOOKUP_CACHE[key]
    rows = _periods_for_level(level)
    best = None
    for num in _class_periods_for_level(level):
        start = _hhmm(rows.get(num, {}).get("start_time"))
        if start is not None and start < 12 * 60:
            best = num
    _LOOKUP_CACHE[key] = best
    return best


def _prefers_morning(subject: dict[str, Any] | None) -> bool:
    return bool((subject or {}).get("prefer_morning"))


# ── ซ่อมเฉพาะห้องที่เลือก ─────────────────────────────────────────────────────
#
# "ห้องที่บอกว่าล็อกไว้ ต้องล็อคเอาไว้นะ ทุกอย่างยังเหมือนเดิม เพิ่มเติมแค่ฉันจะไป
#  กดว่าห้องไหนที่ต้องไปเรียนลาน แล้วกดแก้ไขตารางใหม่ ตารางเรียนนั้นก็จะจัดใหม่
#  ให้เหมาะสมสำหรับห้องนั้น"
#
# body.repair_group_ids = [ห้อง, ...]: only those classes' lessons are cleared and
# placed again. Every other class stays EXACTLY as it is — same day, same period,
# same room, same teacher.
#
# Why this is its own thing and not locked_slot_ids. That flag keeps the slots
# across the clear, but the tidy passes afterwards (draining the last period,
# spreading gaps, the room chains, the rescue of lessons with no room) are only
# told to leave alone what is_locked, so they went on moving and re-rooming the
# very lessons the flag had kept. is_locked, on the other hand, is honoured by
# every pass — measured on the school's own data, locking the untouched classes
# moved 0 lessons in time, changed 0 rooms and lost 0.
#
# So the freeze is is_locked's own mechanism: _held() is "locked, or frozen for
# this run", and every place the solver asked "is it locked?" asks that instead.
# The frozen set is transient — it exists for the length of one run and is never
# written onto a lesson, because 🔒 is the school's own mark and has to go on
# meaning only what the school set it to mean.
#
# Three passes did NOT ask about locks at all (the room rescue for lessons with
# no room, the sibling room merge, the double-period tie), so a lock would not
# have protected a frozen lesson there; they are told about the freeze directly.
_REPAIR_FROZEN: set[int] = set()        # ids of lessons that must not change this run
_REPAIR_ONLY: "set[int] | None" = None  # classes this run may place lessons for; None = all
_REPAIR_HELD_REQS: set[int] = set()     # their rows tied to a class left out (see _repair_plan)


def _held(s: dict[str, Any]) -> bool:
    """Is this lesson off limits to the solver — locked by the school, or frozen
    for this run?"""
    return bool(s.get("is_locked")) or s.get("id") in _REPAIR_FROZEN


def _repair_frozen(s: dict[str, Any]) -> bool:
    """Frozen for this run only. For the passes that never looked at a lock."""
    return s.get("id") in _REPAIR_FROZEN


def _one_roomful(v: "list[dict[str, Any]]", g_map: dict) -> bool:
    """ห้องย่อยพี่น้องที่เรียนวิชาเดียวกันกับครูคนเดียวกัน = คาบเดียว.

    ม.4/6ขค นั่งด้วยกันใน ค31218 กับครูคนเดียว — ไม่ใช่การชนกัน. แต่สอง
    ห้องเรียนที่ไม่ได้เป็นพี่น้องกัน ต่อให้วิชาและครูตรงกัน ก็คือครูคนเดียวถูก
    จองไว้สองที่จริง ๆ และห้องเดียวที่มีนักเรียนสองห้องจริง ๆ

    หนึ่งกฎ สองคนอ่าน — หน้าตรวจความสอดคล้อง (clash_room, clash_teacher) กับ
    ตัวนับปัญหาของห้อง (_class_problem_counts) ใช้ตัวนี้ตัวเดียวกัน จึงไม่มีทาง
    ที่กรอบแดงในตารางกับรายการในหน้าตรวจจะไม่ตรงกัน
    """
    if len({(x.get("subject_id"), x.get("teacher_id")) for x in v}) > 1:
        return False
    parents = {(g_map.get(x.get("group_id")) or {}).get("parent_id") for x in v}
    return len(parents) == 1 and None not in parents


def _slots_in_room_clash(slots: "list[dict[str, Any]] | None" = None) -> set[int]:
    """id() ของทุกคาบที่มีอีกห้องเรียนหนึ่งนั่งอยู่ในห้องสอนเดียวกันในนาทีเดียวกัน

      "ห้อง 1 ไม่ควรมีนักเรียน 2 ห้อง ถ้าไม่ใช้ห้องแม่ลูก"

    ห้องเดียวที่มีนักเรียนสองห้องในเวลาเดียวกันคือคาบที่สอนจริงไม่ได้ ตัวจัด
    ตารางไม่สร้างมันขึ้นมา (วัดแล้ว 0 คู่ จาก 6 รอบ สองผังคาบ) และการลาก/เพิ่ม
    คาบด้วยมือก็ถูก _validate_moves ตรวจอยู่แล้ว — แต่ข้อมูลที่มีมันอยู่แล้ว
    ต้องมีคนบอก ไม่ใช่ปล่อยให้เห็นสองคาบซ้อนกันในช่องแล้วตารางเงียบ

    เทียบด้วยเวลานาฬิกา ไม่ใช่เลขคาบ เพราะ ม.ต้นกับ ม.ปลายนับคาบเหมือนกันแต่
    นั่งต่างเวลา · คาบที่ยังไม่มีห้องไม่นับ (นั่นคือ "ไม่มีห้อง" ซึ่งนับแยกอยู่)
    """
    slots = SLOTS if slots is None else slots
    g_map = {g["id"]: g for g in _flat_groups()}
    cache: dict[tuple, frozenset[int]] = {}

    def buckets(s: dict[str, Any]) -> frozenset[int]:
        key = (s.get("group_id"), s.get("period"))
        if key not in cache:
            cache[key] = _slot_buckets(g_map.get(s.get("group_id")), s.get("period"))
        return cache[key]

    at: dict[tuple, list] = defaultdict(list)       # (room, day, minute) -> lessons
    for x in slots:
        if not x.get("room_id"):
            continue
        for b in buckets(x):
            at[(x["room_id"], x.get("day"), b)].append(x)

    out: set[int] = set()
    for s in slots:
        if not s.get("room_id"):
            continue
        for b in buckets(s):
            for x in at.get((s["room_id"], s.get("day"), b), ()):
                if x is s or x.get("group_id") == s.get("group_id"):
                    continue
                if _same_activity(s, x) or _one_roomful([s, x], g_map):
                    continue
                out.add(id(s))
                break
            else:
                continue
            break
    return out


def _slots_in_teacher_clash(slots: "list[dict[str, Any]] | None" = None) -> set[int]:
    """id() of every lesson whose teacher is still teaching another class in the
    same minutes — _teacher_clash_with answered for all of them at once.

    The same rule, one pass: that function walks every lesson for every lesson
    it is asked about, which is fine for one red cell and far too slow for a
    list of classes. (Overflow lessons do not count as the OTHER side, exactly
    as there.)"""
    slots = SLOTS if slots is None else slots
    g_map = {g["id"]: g for g in _flat_groups()}
    cache: dict[tuple, frozenset[int]] = {}

    def buckets(s: dict[str, Any]) -> frozenset[int]:
        key = (s.get("group_id"), s.get("period"))
        if key not in cache:
            cache[key] = _slot_buckets(g_map.get(s.get("group_id")), s.get("period"))
        return cache[key]

    at: dict[tuple, list] = defaultdict(list)       # (day, teacher, minute) -> lessons
    for x in slots:
        if x.get("is_overflow"):
            continue
        for t in _slot_teachers(x):
            for b in buckets(x):
                at[(x.get("day"), t, b)].append(x)
    out: set[int] = set()
    for s in slots:
        mine = _slot_teachers(s)
        if not mine:
            continue
        if any(x is not s for t in mine for b in buckets(s)
               for x in at.get((s.get("day"), t, b), ())):
            out.add(id(s))
    return out


def _class_problem_counts() -> dict[int, dict[str, int]]:
    """For each class with lessons: how many have no room, how many have a
    teacher clash, how many are red-framed, and how many have any of the three.

    The red frame's own definition (frontend slotProblems.ts), counted on the
    server so that the list of classes worth repairing and the before/after of a
    repair come from one place."""
    clash = _slots_in_teacher_clash()
    shared = _slots_in_room_clash()
    out: dict[int, dict[str, int]] = {}
    for s in SLOTS:
        row = out.setdefault(s["group_id"], {"lessons": 0, "roomless": 0,
                                             "teacher_clash": 0, "room_clash": 0,
                                             "overflow": 0, "problems": 0})
        row["lessons"] += 1
        # A คาบเสรี or a กิจกรรม has no room of its own — not a fault.
        bare = (not s.get("room_id")
                and not (s.get("is_elective") or s.get("is_activity_block")
                         or s.get("elective_pool_id")))
        clashing = id(s) in clash
        # ห้องสอนเดียวกันกับอีกห้องเรียนหนึ่งในนาทีเดียวกัน — สอนจริงไม่ได้ และ
        # เป็นคาบที่ "แก้เฉพาะห้องที่เลือก" ซ่อมได้ (จัดห้องนี้ใหม่รอบเดียวจบ)
        # จึงต้องนับรวมในปัญหาของห้อง ไม่งั้นห้องนั้นไม่ขึ้นในรายการให้กดเลย
        roomshared = id(s) in shared
        framed = bool(s.get("is_overflow"))
        row["roomless"] += bare
        row["teacher_clash"] += clashing
        row["room_clash"] += roomshared
        row["overflow"] += framed
        row["problems"] += bare or clashing or roomshared or framed
    return out


def _repair_plan(raw: Any, keep_ids: "set[int] | None" = None) -> dict[str, Any]:
    """Work out, before anything moves, what a repair run may touch.

    scope   — the classes whose lessons are cleared and placed again: exactly
              the ones asked for. A parent class does not drag its subgroups in
              with it (the caller names them if it means them); they simply stay
              as they are, and the parent is placed around them.
    held    — requirement rows of those classes that are tied to a class left
              out: the same เซ็ตห้องย่อย (parallel_group_key), or the same
              subject and teacher across sibling subgroups, which the solver
              seats as one roomful. Placed again alone they would leave their
              partner behind, so they stay where they are, and the result says so.
    kept    — lessons of the chosen classes the caller asked to keep
              (locked_slot_ids). In an ordinary run that flag only survives the
              clear; here it is the same freeze as everything else.
    frozen  — every lesson that must not change: all of the other classes', the
              held rows' lessons, and the kept ones.
    """
    groups = {g["id"]: g for g in _flat_groups()}
    asked: list[int] = []
    junk: list[Any] = []
    for v in (raw if isinstance(raw, (list, tuple, set)) else [raw]):
        if isinstance(v, str) and v.strip().isdigit():
            v = int(v)
        if isinstance(v, int) and not isinstance(v, bool):
            if v not in asked:
                asked.append(v)
        else:
            junk.append(v)
    chosen = [i for i in asked if i in groups]
    unknown = [i for i in asked if i not in groups] + junk
    scope = set(chosen)

    tied: dict[tuple, list[dict]] = defaultdict(list)
    for r in REQUIREMENTS:
        if r.get("parallel_group_key"):
            tied[("set", r["parallel_group_key"])].append(r)
        else:
            parent = (groups.get(r.get("group_id")) or {}).get("parent_id")
            if parent is not None and r.get("teacher_id"):
                tied[("sib", parent, r.get("subject_id"), r["teacher_id"])].append(r)
    held_reqs: set[int] = set()
    for rows in tied.values():
        inside = [r for r in rows if r.get("group_id") in scope]
        if inside and len(inside) < len(rows):
            held_reqs |= {r["id"] for r in inside}
    held_pairs = {(r["group_id"], r.get("subject_id")) for r in REQUIREMENTS
                  if r["id"] in held_reqs}
    keep_ids = keep_ids or set()
    kept = {s["id"] for s in SLOTS if s["id"] in keep_ids and s["group_id"] in scope}
    frozen = {s["id"] for s in SLOTS
              if s["group_id"] not in scope
              or (s["group_id"], s.get("subject_id")) in held_pairs
              or s["id"] in kept}
    return {"asked": asked, "chosen": chosen, "unknown": unknown, "scope": scope,
            "held_reqs": held_reqs, "held_pairs": held_pairs, "kept": kept,
            "frozen": frozen, "groups": groups}


def _names_th(ids, groups: dict[int, dict], limit: int = 8) -> str:
    names = [(groups.get(i) or {}).get("name") or f"#{i}" for i in ids]
    return ", ".join(names[:limit]) + (" …" if len(names) > limit else "")


def _repair_solve(body: dict[str, Any], raw: Any) -> dict[str, Any]:
    """Place only the chosen classes again; leave every other lesson exactly as is.

    The rest of the body is the ordinary run's, and means what it always did for
    the classes being placed: skip lists still skip, the consecutive and
    last-period settings steer where their lessons go, locked_slot_ids keeps the
    lessons it names. `clear_existing` is the one option that cannot mean what it
    says here — honoured as written it would empty the whole school — so it is
    ignored: a repair run clears the chosen classes and nothing else."""
    global _REPAIR_ONLY
    keep = set()
    for v in (body.get("locked_slot_ids") or []) if isinstance(body.get("locked_slot_ids"), (list, tuple, set)) else []:
        if isinstance(v, int) and not isinstance(v, bool):
            keep.add(v)
    plan = _repair_plan(raw, keep)
    groups = plan["groups"]
    if not plan["scope"]:
        # Nothing to repair is not "repair everything": the one thing this run
        # must never do is clear a timetable because a class id went stale.
        _nothing_changed()
        shown = ", ".join(str(x) for x in plan["unknown"][:5])
        msg = (f"ไม่พบห้องที่เลือกในระบบ ({shown}) — ยังไม่ได้แก้ตารางเลย "
               f"(ห้องอาจถูกลบไปแล้ว ลองโหลดหน้าใหม่)")
        return {
            "status": "INFEASIBLE", "mode": "repair", "engine": "greedy",
            "slots_created": 0, "solve_time_seconds": 0.0, "objective_value": 0.0,
            "violations": [msg], "notes": [],
            "unplaced_requirement_ids": [], "skipped_requirement_ids": [],
            "repair_summary": msg, "repair_outside_changed": 0,
            "repair": {"ok": False, "refused": True, "requested_group_ids": plan["asked"],
                       "unknown_group_ids": plan["unknown"], "group_ids": [],
                       "classes": [], "summary": msg,
                       "outside": {"frozen": 0, "changed": 0}},
        }

    scope, frozen = plan["scope"], plan["frozen"]
    problems_before = _class_problem_counts()
    pre_ids = {s["id"] for s in SLOTS}
    frozen_before = {s["id"]: _copy.deepcopy(s) for s in SLOTS if s["id"] in frozen}
    req_group = {r["id"]: r.get("group_id") for r in REQUIREMENTS}
    prev_unplaced = set(LAST_RUN.get("unplaced_requirement_ids") or [])

    _REPAIR_FROZEN.clear(); _REPAIR_FROZEN.update(frozen)
    _REPAIR_HELD_REQS.clear(); _REPAIR_HELD_REQS.update(plan["held_reqs"])
    _REPAIR_ONLY = set(scope)
    try:
        res = _solve_greedy_run({**body, "clear_existing": True})
    finally:
        _REPAIR_FROZEN.clear()
        _REPAIR_HELD_REQS.clear()
        _REPAIR_ONLY = None

    # The classes left out were not asked for anything, so what they were still
    # missing before is still missing — keep it on the books.
    mine = set(res.get("unplaced_requirement_ids") or [])
    req_group_now = {r["id"]: r.get("group_id") for r in REQUIREMENTS}
    kept_unplaced = {rid for rid in prev_unplaced
                     if rid in req_group_now and (req_group.get(rid) not in scope
                                                  or rid in plan["held_reqs"])}
    LAST_RUN["unplaced_requirement_ids"] = sorted(kept_unplaced | mine)

    # ── Did anything that should have stayed put change? Judged against a copy
    # of each lesson taken before the run, field for field. Two tallies: the
    # classes that were not chosen (the promise — and the number the screen
    # shows), and the chosen classes' own lessons that were held back.
    now = {s["id"]: s for s in SLOTS}
    out = {"changed": 0, "moved": 0, "re_roomed": 0, "teacher_changed": 0,
           "lost": 0, "added": 0, "other_fields": 0}
    held = {k: 0 for k in out}
    for sid, old in frozen_before.items():
        t = out if old["group_id"] not in scope else held
        cur = now.get(sid)
        if cur is None:
            t["lost"] += 1; t["changed"] += 1
            continue
        if cur == old:
            continue
        t["changed"] += 1
        same_cell = (cur.get("day"), cur.get("period")) == (old.get("day"), old.get("period"))
        same_room = cur.get("room_id") == old.get("room_id")
        same_who = ((cur.get("teacher_id"), cur.get("co_teacher_id"))
                    == (old.get("teacher_id"), old.get("co_teacher_id")))
        t["moved"] += not same_cell
        t["re_roomed"] += not same_room
        t["teacher_changed"] += not same_who
        t["other_fields"] += same_cell and same_room and same_who
    for s in SLOTS:
        if s["id"] in pre_ids:
            continue
        if s["group_id"] not in scope:
            out["added"] += 1; out["changed"] += 1
        elif (s["group_id"], s.get("subject_id")) in plan["held_pairs"]:
            held["added"] += 1; held["changed"] += 1
    ok = out["changed"] == 0 and held["changed"] == 0

    problems_after = _class_problem_counts()
    zero = {"lessons": 0, "roomless": 0, "teacher_clash": 0, "room_clash": 0,
            "overflow": 0, "problems": 0}

    def tally(counts: dict) -> dict[str, int]:
        rows = [counts.get(g, zero) for g in scope]
        return {"lessons": sum(r["lessons"] for r in rows),
                "roomless": sum(r["roomless"] for r in rows),
                "teacher_clash": sum(r["teacher_clash"] for r in rows),
                "room_clash": sum(r.get("room_clash", 0) for r in rows),
                "overflow": sum(r["overflow"] for r in rows),
                "problems": sum(r["problems"] for r in rows),
                "classes_with_problems": sum(1 for r in rows if r["problems"])}

    before, after = tally(problems_before), tally(problems_after)
    order = sorted(scope, key=lambda g: ((groups.get(g) or {}).get("name") or "", g))
    classes = [{"group_id": g, "name": (groups.get(g) or {}).get("name"),
                "before": problems_before.get(g, zero), "after": problems_after.get(g, zero)}
               for g in order]
    outside_groups = {s["group_id"] for s in SLOTS if s["group_id"] not in scope}
    outside_lessons = sum(1 for o in frozen_before.values() if o["group_id"] not in scope)

    summary = (
        f"ซ่อมตารางเฉพาะ {len(scope)} ห้อง ({_names_th(order, groups)}) "
        f"จัดใหม่ {res.get('slots_created', 0)} คาบ — "
        f"ห้องที่มีปัญหา {before['classes_with_problems']} → {after['classes_with_problems']} ห้อง · "
        f"คาบไม่มีห้อง {before['roomless']} → {after['roomless']} คาบ · "
        f"ครูชนกัน {before['teacher_clash']} → {after['teacher_clash']} คาบ · "
        f"ห้องสอนมีสองห้องเรียน {before['room_clash']} → {after['room_clash']} คาบ · "
        f"ห้องอื่นอีก {len(outside_groups)} ห้อง ({outside_lessons} คาบ) เปลี่ยนไป {out['changed']} คาบ")
    lines = [summary]
    if ok:
        lines.append(
            "ตรวจแล้ว: คาบของห้องที่ไม่ได้เลือกเปลี่ยนไป 0 คาบ — ทุกคาบยังอยู่วัน คาบ ห้อง "
            "และครูเดิม")
    else:
        def kinds(t: dict) -> str:
            parts = [f"ย้ายเวลา {t['moved']}" if t["moved"] else "",
                     f"เปลี่ยนห้อง {t['re_roomed']}" if t["re_roomed"] else "",
                     f"เปลี่ยนครู {t['teacher_changed']}" if t["teacher_changed"] else "",
                     f"หายไป {t['lost']}" if t["lost"] else "",
                     f"มีคาบเพิ่มมา {t['added']}" if t["added"] else "",
                     f"แก้ข้อมูลอื่นของคาบ {t['other_fields']}" if t["other_fields"] else ""]
            return " · ".join(p for p in parts if p)
        said = []
        if out["changed"]:
            said.append(f"คาบของห้องที่ไม่ได้เลือกเปลี่ยนไป {out['changed']} คาบ ({kinds(out)})")
        if held["changed"]:
            said.append(f"คาบของห้องที่เลือกที่ต้องคงไว้เปลี่ยนไป {held['changed']} คาบ ({kinds(held)})")
        warn = ("⚠ " + " และ ".join(said) + " — ไม่ควรเกิดขึ้น: ตัวซ่อมต้องไม่แตะคาบเหล่านี้เลย "
                "กรุณาตรวจตารางก่อนใช้งาน หรือกู้คืนจากประวัติ แล้วแจ้งผู้ดูแลระบบ")
        lines.insert(0, warn)
        res.setdefault("violations", []).insert(0, warn)
        res["status"] = "INFEASIBLE"
    if plan["unknown"]:
        lines.append("ข้ามห้องที่ไม่พบในระบบ: " + ", ".join(str(x) for x in plan["unknown"][:5]))
    held_slots = sum(1 for o in frozen_before.values()
                     if o["group_id"] in scope and (o["group_id"], o.get("subject_id")) in plan["held_pairs"]
                     and o["id"] not in plan["kept"])
    if held_slots:
        held_groups = sorted({g for g, _sid in plan["held_pairs"] if g in scope})
        lines.append(
            f"ไม่ได้ขยับ {held_slots} คาบของ {_names_th(held_groups, groups)} — เรียนพร้อมกันกับห้องย่อย"
            f"ที่ไม่ได้เลือก (เซ็ตหรือครูคนเดียวกัน) ถ้าจะให้ขยับต้องเลือกห้องที่เรียนพร้อมกันด้วย")
    if plan["kept"]:
        lines.append(f"คาบของห้องที่เลือกที่ขอให้คงไว้ {len(plan['kept'])} คาบ ไม่ถูกขยับ เหมือนห้องอื่น")

    res["mode"] = "repair"
    res["notes"] = lines + list(res.get("notes") or [])
    # Flat on the result, for the screen: what was done, and how many lessons
    # outside the chosen classes are not exactly as they were (always 0).
    res["repair_summary"] = summary
    res["repair_outside_changed"] = out["changed"]
    res["repair"] = {
        "ok": ok,
        "requested_group_ids": plan["asked"], "unknown_group_ids": plan["unknown"],
        "group_ids": order,
        "classes": classes, "before": before, "after": after,
        "outside": {"frozen": len(frozen_before), "lessons_outside": outside_lessons,
                    "classes_untouched": len(outside_groups), **out},
        "held": held,
        "held_lessons": held_slots, "kept_lessons": len(plan["kept"]),
        "summary": summary,
    }
    return res


def _solve_greedy(body: dict[str, Any]) -> dict[str, Any]:
    """The heuristic placer. With body.repair_group_ids it places only those
    classes again and freezes the rest (see ซ่อมเฉพาะห้องที่เลือก above);
    absent or empty it is the whole-school run it always was."""
    # เริ่มงานใหม่ = ล้างแคชตารางค้นหา ระหว่างการจัดผังคาบไม่เปลี่ยนอีก
    _lookup_cache_clear()
    ids = body.get("repair_group_ids")
    if not ids:
        return _solve_greedy_run(body)
    return _repair_solve(body, ids)


# ── ความคืบหน้าระหว่างจัดตาราง ────────────────────────────────────────────────
#
# "ในหน้าโหลดช่วยทำเป็นเปอร์เซ็นต์หรือคาบที่กำลังลงอยู่ได้ไหม จะได้รู้ว่ามัน
#  กำลังทำงานอยู่"
#
# การจัดตารางเป็นคำขอเดียวที่ค้างอยู่เป็นนาที หน้าจอจึงไม่มีอะไรบอกเลยว่าระหว่าง
# นั้นเกิดอะไรขึ้น — ค้างอยู่กับทำงานอยู่หน้าตาเหมือนกันเป๊ะ และโรงเรียนเคยเจอ
# เซิร์ฟเวอร์ไม่ตอบจริงๆ มาแล้ว จึงไม่มีทางรู้ว่าควรจะรอต่อหรือกดใหม่
#
# ตัวจัดเขียนความคืบหน้าลงตรงนี้ หน้าจอถามเป็นระยะด้วยคำขออีกเส้นหนึ่ง ซึ่ง
# FastAPI ตอบได้พร้อมกันเพราะ handler เป็น def ธรรมดา (วิ่งใน threadpool)
SOLVE_PROGRESS: dict[str, Any] = {
    "running": False, "phase": "", "done": 0, "total": 0,
    "started_at": 0.0, "note": "", "seq": 0,
}


def _progress(phase: str | None = None, done: int | None = None,
              total: int | None = None, note: str | None = None) -> None:
    """บอกว่าตอนนี้ทำอะไรอยู่ ถึงไหนแล้ว — ค่าไหนไม่ส่งมาก็คงของเดิม"""
    if phase is not None:
        SOLVE_PROGRESS["phase"] = phase
    if done is not None:
        SOLVE_PROGRESS["done"] = done
    if total is not None:
        SOLVE_PROGRESS["total"] = total
    if note is not None:
        SOLVE_PROGRESS["note"] = note
    SOLVE_PROGRESS["seq"] += 1


def _progress_start(note: str = "") -> None:
    SOLVE_PROGRESS.update(running=True, phase="เริ่มต้น", done=0, total=0,
                          started_at=_time.time(), note=note)
    SOLVE_PROGRESS["seq"] += 1


def _progress_end() -> None:
    SOLVE_PROGRESS.update(running=False, phase="เสร็จแล้ว")
    SOLVE_PROGRESS["seq"] += 1


@app.get("/api/timetable/solve/progress")
def solve_progress():
    """ตัวจัดตารางถึงไหนแล้ว — หน้าจอถามเส้นนี้ระหว่างรอคำตอบของการจัด

    ไม่มีการจัดอยู่ ก็ตอบสถานะล่าสุดพร้อม running=False ซึ่งหน้าจอใช้เป็นสัญญาณ
    ว่าเลิกถามได้แล้ว
    """
    p = dict(SOLVE_PROGRESS)
    p["elapsed_seconds"] = round(_time.time() - (p.get("started_at") or _time.time()), 1)
    tot = p.get("total") or 0
    p["percent"] = round(100 * (p.get("done") or 0) / tot) if tot else None
    return p


# ── Solver entry point: prefer CP-SAT (real optimiser), fall back to greedy ────
def _run_solver(body: dict[str, Any]) -> dict[str, Any]:
    """Run the timetable solver.

    Uses Google OR-Tools CP-SAT when available (real optimisation that minimises
    student/teacher walking and respects every hard constraint). If OR-Tools is
    not installed, or the CP-SAT model errors for any reason, we fall back to the
    fast greedy heuristic so the app always produces a result.
    """
    # ซ่อมเฉพาะห้องที่เลือก: only the heuristic placer can promise that every
    # other class stays exactly as it is (every pass of it asks _held). CP-SAT
    # builds the week afresh and would put them somewhere of its own choosing.
    _progress_start("กำลังอ่านข้อกำหนดคาบและเงื่อนไขห้อง")
    try:
        return _run_solver_inner(body)
    finally:
        # ปิดเสมอ แม้จะพัง — ไม่งั้นหน้าจอจะถามความคืบหน้าของงานที่ตายไปแล้ว
        # ไปเรื่อยๆ และขึ้นว่ากำลังทำงานอยู่ทั้งที่ไม่มีอะไรวิ่ง
        _progress_end()


def _run_solver_inner(body: dict[str, Any]) -> dict[str, Any]:
    if body.get("repair_group_ids"):
        return _solve_greedy(body)
    # ── ไม่โหลดของหนักมาเพื่อทิ้ง ────────────────────────────────────────────
    #
    # ตัวกันขนาดข้างล่าง (_solve_cpsat) ปฏิเสธโรงเรียนขนาดนี้ทุกครั้งอยู่แล้ว
    # แต่การ import ortools เกิดขึ้นก่อนที่จะรู้ ซึ่งกินหน่วยความจำร้อยกว่าเมกะไบต์
    # บนเครื่องแพ็กเกจฟรีที่มี 512 MB เพื่อไลบรารีที่ไม่มีวันได้ใช้ — และนั่นคือ
    # ส่วนหนึ่งของอาการ "เซิร์ฟเวอร์ไม่ตอบกลับ" ที่โรงเรียนเจอ
    #
    # จึงนับขนาดก่อนด้วยสูตรเดียวกับที่ _solve_cpsat ใช้เป๊ะๆ: จำนวนก้อนคาบ คูณ
    # ช่องเริ่มที่เป็นไปได้ คูณจำนวนห้องที่น้อยที่สุดที่มันยอมลดลงไปถึง (2)
    #
    # ต้องเป็นสูตรเดียวกันจริงๆ ไม่ใช่ประมาณเอา — ครั้งแรกเขียนเป็น "รวม
    # weekly_count" ซึ่งสูงกว่าของจริง เพราะวิชาคาบคู่สองคาบนับเป็นก้อนเดียว
    # ตัวเลขที่สูงเกินไปจะไปปฏิเสธ CP-SAT ของโรงเรียนที่จริงๆ แล้วใช้ได้
    skipped = _excluded_requirement_ids(body)
    _subj = {s["id"]: s for s in SUBJECTS}
    want = 0
    for r in REQUIREMENTS:
        if r["id"] in skipped:
            continue
        wc = r.get("weekly_count", 1) or 0
        dur = (_subj.get(r.get("subject_id")) or {}).get("duration", 1) or 1
        want += (wc // 2 + wc % 2) if dur == 2 else wc
    floor_est = want * 5 * len(_class_period_nums()) * 2
    budget = int(body.get("max_model_vars") or 150_000)
    if floor_est > budget:
        res = _solve_greedy(body)
        res.setdefault("violations", [])
        res["violations"].append(
            f"ℹ ตารางนี้ใหญ่เกินกว่าจะใช้ CP-SAT บนเซิร์ฟเวอร์ปัจจุบัน "
            f"({want} คาบ ≈ {floor_est:,} ตัวแปรเป็นอย่างน้อย) จึงใช้ตัวจัดสำรอง "
            f"(heuristic) แทน — ผลที่ได้ยังครบเงื่อนไขทุกข้อ")
        res["engine"] = "greedy-fallback"
        return res
    try:
        from ortools.sat.python import cp_model  # noqa: F401
    except Exception:
        return _solve_greedy(body)
    # คาบเรียนลาน: only the heuristic placer knows how to hold a ลาน for a pick.
    # CP-SAT chooses its own rooms and has no notion of one being named for a
    # class's hour, so with picks on the books it would quietly ignore them —
    # the one thing a pick must never do. Say so, and use the placer that
    # keeps them.
    picked = len(_yard_pick_index()[0])
    if picked:
        res = _solve_greedy(body)
        res.setdefault("notes", []).append(
            f"มีคาบเรียนลาน {picked} คาบ จึงจัดด้วยตัวจัดแบบ heuristic แทน CP-SAT "
            f"— CP-SAT ยังไม่รู้จักคาบเรียนลาน จะข้ามไปโดยไม่บอกไม่ได้")
        return res
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
def _solve_greedy_run(body: dict[str, Any]) -> dict[str, Any]:
    global SLOTS
    import time as _time
    _t0 = _time.perf_counter()
    clear      = body.get("clear_existing", True)
    locked_ids = set(body.get("locked_slot_ids", []))
    skipped_reqs = _excluded_requirement_ids(body)
    unplaced_ids: list[int] = []
    consec_hard, consec_soft = _consec_settings(body)
    # คาบเสรีมาก่อนทุกอย่าง, so before anything is placed the elective windows
    # are made whole: a คาบคู่ that has lost a half gets it back now, while
    # the hour beside it is still empty, rather than after the ordinary
    # lessons have filled it.
    healed_doubles = _repair_elective_doubles(_REPAIR_ONLY)
    # วิชาซ้ำที่เกิดจากเซ็ตที่เว้นครูไว้ — folded before anything is counted or
    # placed, so the class is not scheduled for the same lesson twice.
    tidy = _tidy_requirements(_REPAIR_ONLY)

    # Keep only locked slots when clearing — elective slots always survive,
    # regardless of is_locked, so the solver never double-books their teacher/room.
    # (_held is is_locked, plus the lessons a ซ่อมเฉพาะห้องที่เลือก run is
    # freezing — empty outside such a run, so this is the old line.)
    if clear:
        SLOTS = [s for s in SLOTS if s["id"] in locked_ids or _held(s) or s.get("is_elective")]
    # What stood before this run placed anything, so the end-of-run report
    # about ห้องประจำชั้น speaks only for lessons THIS run seated.
    slots_before = {s["id"] for s in SLOTS}

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
    # ห้องประจำชั้นของ ม.ต้น -> ห้องเรียนที่เป็นเจ้าของ
    #
    # ใช้ในรอบซ่อมท้ายสุด (ดู "ม.ต้นไม่มีห้อง แต่ห้องประจำชั้นถูกห้องอื่นนั่งอยู่")
    # ไม่ได้ใช้เป็นตัวกรองตอนเลือกห้อง: ลองแล้ววัด — กันห้องไว้ตั้งแต่ตอนเลือก
    # ทำให้เวลาจัดขึ้นจาก 1.77 เป็น 4.06 วินาที (ตัวจัดต้องไล่หาห้องไกลขึ้นทุกคาบ)
    # โดยที่บนข้อมูลที่วัดได้ ม.ต้นไม่มีคาบไม่มีห้องอยู่แล้วทั้งก่อนและหลัง
    # เซิร์ฟเวอร์ของโรงเรียนเคยหมดเวลาเพราะจัดนาน จึงไม่คุ้มที่จะแลก
    # ห้องไหนกันไว้ให้ครูคนไหน — ทำครั้งเดียวต่อการจัดหนึ่งรอบ
    #
    # _room_reserved_for ถูกเรียก 107 ล้านครั้งต่อรอบบนข้อมูลจริงของโรงเรียน
    # และสร้างเซ็ตใหม่ทุกครั้ง รวมเป็นราวหนึ่งในห้าของเวลาทั้งหมด ระหว่างการจัด
    # หนึ่งรอบ ROOMS ไม่เปลี่ยน ตารางนี้จึงตรงเสมอ และไม่ต้องพึ่งการล้างแคช
    reserved_of: dict[int, set[int]] = {r["id"]: _room_reserved_for(r) for r in ROOMS}

    def room_reserved_for(room: dict[str, Any]) -> set[int]:
        return reserved_of.get(room["id"], _EMPTY_RESERVED)

    homeroom_owner: dict[int, int] = {}
    for _g in g_map.values():
        _hr = _g.get("homeroom_room_id")
        if _hr and _hr not in homeroom_owner and _level_key(_g) == "lower":
            homeroom_owner[_hr] = _g["id"]

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
        # Activity periods may have no teacher; a shared elective has one per
        # option; a สอนร่วม lesson has two. All of it lives in _slot_teachers.
        tids = _slot_teachers(s)
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

    # The school eats in two shifts — ม.1-3 break at 11:10 while ม.4-6 are in
    # class, then the other way round. So "lunch" is not one window but two,
    # and a teacher who takes a lesson in both of them eats in neither. That
    # is the trap in filling คาบ 4 and คาบ 5 harder: they are the two shifts.
    # Read off the period rows rather than hard-coded, because the shifts are
    # the school's to move.
    lunch_windows: list[frozenset[int]] = []
    _seen_lunch: set[tuple[int, int]] = set()
    for _lvl in ("lower", "upper"):
        for _row in _periods_for_level(_lvl).values():
            if _row.get("type") != "lunch":
                continue
            _a, _b = _hhmm(_row.get("start_time")), _hhmm(_row.get("end_time"))
            if _a is None or _b is None or _b <= _a or (_a, _b) in _seen_lunch:
                continue
            _seen_lunch.add((_a, _b))
            lunch_windows.append(
                frozenset(range(_a // _BUCKET, (_b + _BUCKET - 1) // _BUCKET)))

    def keeps_a_lunch(tid: int, gid: int, day: int, period: int) -> bool:
        """Would this teacher still get one of the lunch shifts to themselves?"""
        if len(lunch_windows) < 2:
            return True        # a single shift — there is nothing to choose
        taking = cell_buckets(gid, period)
        for win in lunch_windows:
            if taking & win:
                continue       # the shift this lesson would eat into
            if any((tid, day, b) in teacher_busy for b in win):
                continue       # already teaching through this one
            return True        # this shift stays free
        return False

    # Each level has its own lesson periods — ม.1-3 are at lunch while ม.4-6
    # are in class — so the cells a lesson may use depend on whose lesson it is.
    def tail_cost(level: str, period: int) -> int:
        """How much this period is discouraged, so a class can finish early.

        ONLY the final period. Discouraging the last two looked reasonable
        until the day was counted: this school has four or five morning
        periods and exactly two afternoon ones, so "the last two" and "the
        whole afternoon" are the same thing. Penalising both is what pushed
        79% of all teaching before noon. Leaving only the final period
        discouraged still lets a class go home a period early, while คาบ 7
        stays freely available to balance teachers' days.
        """
        nums = _class_periods_for_level(level)
        try:
            return 1 if nums.index(period) == len(nums) - 1 else 0
        except ValueError:
            return 0

    def half_rate(tid: int, gid: int, period: int) -> float:
        """How full this teacher's morning (or afternoon) already is, as a rate.

        A rate, not a count: the halves are not the same size — four or five
        periods against two — so comparing raw counts would chase a 50/50 split
        that the timetable cannot give and drag everything into the afternoon.
        """
        lvl = _level_key(g_map.get(gid))
        nums = _class_periods_for_level(lvl)
        cut = _morning_cutoff(lvl)
        h = _half(gid, period)
        size = sum(1 for n in nums if (cut is not None and n <= cut) == (h == 0))
        return teacher_half[(tid, h)] / max(1, size)

    def cells_for(gid: int):
        lvl = _level_key(g_map.get(gid))
        return [(d, p) for d in range(5) for p in _class_periods_for_level(lvl)]

    # ── คาบสุดท้ายของวันไว้ใช้เมื่อจำเป็น ─────────────────────────────────────
    tail_mode = _school_last_period_mode(body)

    def uses_tail(lvl: str, period: int, pair: bool = False) -> bool:
        """Would seating a lesson here use the last period of the day?

        `pair` asks the question for a คาบคู่ STARTING at this period: the
        second half lands an hour later, so a double beginning at คาบ 8 is
        every bit as much a คาบ 9 as one beginning at คาบ 9.
        """
        last = _last_period_for(lvl)
        if last is None:
            return False
        return period == last or (pair and _next_class_period_for(lvl, period) == last)

    def by_tail(cells: list, lvl: str, pair: bool = False) -> list:
        """Shuffle, then send the last period's cells to the back of the queue.

        Every loop that picks a cell goes through here, so เซ็ตห้องย่อย and
        คาบคู่ obey the rule as well as ordinary lessons — they are placed
        first, on an empty grid, so left to themselves they were the ones
        most likely to take คาบ 9 when the whole week was still free.
        """
        random.shuffle(cells)
        if tail_mode == "free":
            return cells
        if tail_mode == "never":
            return [c for c in cells if not uses_tail(lvl, c[1], pair)]
        return sorted(cells, key=lambda c: uses_tail(lvl, c[1], pair))

    class_periods = sorted({p["period_num"] for p in PERIODS if p["type"] == "class"})
    all_cells     = [(d, p) for d in range(5) for p in class_periods]
    s_map = {s["id"]: s for s in SUBJECTS}
    r_map = {r["id"]: r for r in ROOMS}

    # ── วันที่วิชาห้ามเรียน ───────────────────────────────────────────────────
    #
    # "มีวิชาพละที่ต้องไม่เรียนในวันพฤ เพราะเป็นวันเรียนลูกเสือ"
    #
    # ตัวจัดลงคาบได้หลายทาง — คาบเดี่ยว คาบคู่ เซ็ตห้องย่อย คาบที่ยัดลงตอนท้าย
    # และการย้ายคาบไปมาอีกหลายรอบ กฎที่ต้องไปจำไว้ในทุกทางคือกฎที่จะหลุดสักทาง
    # จึงกรองวันต้องห้ามออกตั้งแต่ตอน "สร้างรายการช่องที่ลงได้" ทางที่เหลือ
    # มองไม่เห็นวันนั้นเลยตั้งแต่แรก
    _blocked_cache: dict[Any, set] = {}

    def blocked_days_of(sid) -> set:
        got = _blocked_cache.get(sid)
        if got is None:
            got = _subject_blocked_days(s_map.get(sid))
            _blocked_cache[sid] = got
        return got

    def allow_days(cells: list, sid) -> list:
        """เอาวันที่วิชานี้ห้ามเรียนออกจากรายการช่อง"""
        bad = blocked_days_of(sid)
        return [c for c in cells if c[0] not in bad] if bad else cells

    def is_double_subject(sid) -> bool:
        """วิชานี้ตั้งไว้ว่าเรียนครั้งละสองคาบติดกันหรือเปล่า"""
        return ((s_map.get(sid) or {}).get("duration", 1) or 1) == 2

    def allow_days_many(cells: list, sids) -> list:
        """เซ็ตห้องย่อยเรียนพร้อมกัน ห้ามวันไหนสักวิชาก็ห้ามทั้งเซ็ต"""
        bad: set = set()
        for sid in sids:
            bad |= blocked_days_of(sid)
        return [c for c in cells if c[0] not in bad] if bad else cells

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

    # ── คาบเรียนลาน ────────────────────────────────────────────────────────────
    # The school decided, by hand and before this run, that these classes spend
    # these hours on these ลาน. pick_at: (class, day, period) -> the ลาน.
    # yard_owner: (ลาน, day, 5-minute bucket) -> the class whose pick holds it,
    # the earlier pick winning where two overlap. A class and the classes that
    # share its students (its subgroups, its parent) can never be in the room
    # together, so for this purpose they are the same class.
    pick_at, yard_owner = _yard_pick_index()

    def yard_reserved_away(gid: int | None, rid: int, day: int, bks) -> bool:
        """Is this ลาน, at this hour, held for some OTHER class's pick?"""
        mine = group_conflict_ids(gid) if gid is not None else frozenset()
        for b in bks:
            owner = yard_owner.get((rid, day, b))
            if owner is not None and owner not in mine:
                return True
        return False

    # The cells whose pick this class actually owns: a lesson put there will be
    # given the ลาน, which is what makes the cell worth choosing (see rank in
    # place_single). A pick that lost to an earlier one is not worth choosing.
    pick_owned = {key for key, rid in pick_at.items()
                  if not yard_reserved_away(key[0], rid, key[1], cell_buckets(key[0], key[2]))}

    # ลำดับลาน: where each ลาน stands in the order the school saved. Empty when
    # none is saved, which leaves every choice below exactly as it was.
    yard_pos = _yard_position(_yard_order())

    created    = 0
    violations = []
    # Lessons that did not fit on the first run, kept so the room-shuffling
    # pass at the end can have one more go at them before they are reported.
    short_rows: list[tuple] = []
    # Lessons lifted out of a cell that a pinned lesson claimed. They are owed
    # a period somewhere else, and the repair pass at the end gives it to them.
    displaced: list[dict] = []
    rescued_by_shuffle = 0
    # Things worth saying that are not faults — a timetable with these is
    # still a good one, so they must not turn the run INFEASIBLE.
    notes: list[str] = []

    # Departments whose lessons belong outdoors (พลศึกษา etc.) — used to steer
    # room ranking so PE still lands on the field, not a classroom.
    outdoor_dept_ids = {d["id"] for d in DEPARTMENTS if "พลศึกษา" in d.get("name", "")}

    def find_room(teacher_id: int, day: int, period: int, subject_id: int | None = None,
                  group_id: int | None = None, also_period: int | None = None,
                  allow_out_override: bool | None = None,
                  pinned_room_id: int | None = None,
                  pretend_free: bool = False,
                  avoid: frozenset[int] = frozenset()):
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
        want_dept = _lesson_want_dept(subj, t)
        # พละ belongs outdoors by its department; any other subject goes out
        # only if the school has ticked เรียนที่ลานได้, and then only once the
        # indoor rooms are full — see `eligible` and `rank` below.
        rule = _subject_room_rule(subj)
        grp = g_map.get(group_id, {}) if group_id is not None else {}
        # Who may go outdoors is decided in one place, _may_use_outdoor, which
        # asks the lesson, then the class, then the subject, and says no when
        # none of them has an opinion.
        #
        # This used to work it out again here, as "not explicitly forbidden",
        # which is the opposite answer for anything nobody had ticked — so a
        # class could still be sent to a ลาน after the school had set the
        # default to keep everyone indoors. Two rules for one question is one
        # rule too many.
        allow_out = _may_use_outdoor(subj, None, grp or None)
        if allow_out_override is not None:
            allow_out = bool(allow_out_override)
        # พละ is the exception the school never has to tick: a department that
        # owns the ลาน owns it because that is where its lessons happen.
        #
        # …but a subject that says "ไม่เรียนนอกอาคาร" means it, department or
        # not. กลุ่มสาระสุขศึกษาและพลศึกษา holds both พละ, which belongs on a
        # field, and สุขศึกษา, which is a lesson at a desk — and the department
        # was sending both outside with no way for the school to say otherwise.
        # Ticking it off on the subject now keeps those classes in their own
        # ห้องประจำชั้น, which is what the school asked for.
        wants_outdoor = (subj.get("department_id") in outdoor_dept_ids
                         and _subject_outdoor(subj) is not False)
        may_outdoor = wants_outdoor or allow_out
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
        prefs = _teacher_prefs(t)
        ground_only = prefs.get("ground_floor")
        # Whose room comes first, the teacher's or the class's (see 2a' below).
        teacher_room_wins = prefs.get("room_wins")
        if teacher_room_wins is None:
            teacher_room_wins = bool(
                (SCHOOL_CONFIG if isinstance(SCHOOL_CONFIG, dict) else {})
                .get("teacher_room_over_homeroom"))

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
        # A คาบคู่ asks for one room for two periods running. Taking the first
        # half's room and reusing it for the second without asking put a class
        # into a room somebody else had already booked for that hour, so the
        # pair is judged against both periods here, before either is taken.
        if also_period is not None:
            bks = frozenset(bks) | _slot_buckets(grp, also_period)

        # คาบเรียนลาน — the school has named the ลาน for this class at this
        # hour, so the question this function exists to ask is already
        # answered. It goes through pinned_room_id like the room a school
        # writes for a lesson, and beats it: a pick is about one hour, the
        # other is about the lesson in every hour.
        #
        # A คาบคู่ shares one room across both its periods, so a pick on either
        # period takes the whole pair. Two different ลาน picked for the two
        # periods cannot be one room: this says no, and the room-repair pass
        # at the end then seats each hour on the ลาน picked for it (it asks
        # about one period at a time), so neither pick is dropped.
        if pick_at and group_id is not None:
            named = {pick_at[(group_id, day, p)]
                     for p in (period, also_period)
                     if p is not None and (group_id, day, p) in pick_at}
            if len(named) > 1:
                return None, None, None
            if named:
                pinned_room_id = next(iter(named))

        def room_taken(rid: int) -> bool:
            # `pretend_free` asks a different question: not "which room is free"
            # but "which rooms would this lesson accept at all" — the list the
            # room-shuffling pass walks when it looks for a way to move the
            # current occupants around. `avoid` are the rooms that pass has
            # already tried, and they count as taken so it never goes in
            # circles. Everything below is unchanged by either.
            if rid in avoid:
                return True
            # A ลาน held for another class's pick is not free at that hour even
            # while nobody is in it: holding it is what a pick on an empty cell
            # is for. Not waived by pretend_free — this lesson would not be
            # accepted there however the others were moved.
            if yard_owner and yard_reserved_away(group_id, rid, day, bks):
                return True
            if pretend_free:
                return False
            return any((rid, day, b) in room_busy for b in bks)

        # ม.5/1ก is ม.5/1 for the purpose of a room reserved for ม.5/1.
        family = _group_family(group_id, grp)

        # อาคารที่วิชานี้เรียนได้ — a hard filter, checked everywhere a room
        # is returned, including the shortcuts that skip `eligible` below.
        # "ต้องอยู่ตึก 1 เท่านั้น" has to beat the class's own homeroom too,
        # or the rule would hold for every room except the one they are
        # already sitting in.
        want_buildings = _subject_buildings(subj)

        def building_ok(r: dict | None) -> bool:
            return _room_in_buildings(r, want_buildings)

        def eligible(r: dict) -> bool:
            # Free at this hour, and a room this lesson may sit in at all —
            # the second half is _room_suits, shared with the yard-rescue
            # advice so the two cannot disagree about what "suits" means.
            return (not room_taken(r["id"])
                    and _room_suits(r, teacher_id=teacher_id, group_id=group_id,
                                    family=family, want_dept=want_dept,
                                    want_buildings=want_buildings,
                                    may_outdoor=may_outdoor))

        def pick_anchor() -> dict | None:
            """Settle on the ordinary room this class comes back to all week.

            Recorded in anchor_room, so every later lesson of the class finds
            it as its `home`. Only an ordinary classroom no department owns,
            and only one this lesson could actually be seated in right now.
            """
            indoor = [r for r in ROOMS
                      if r["type"] in ("physical", "floating")
                      and not r.get("specialized_dept_id") and eligible(r)]
            pick = _choose_anchor(grp, indoor, set(anchor_room.values()), homeroom_ids)
            if pick:
                anchor_room[group_id] = pick["id"]
            return pick

        # ห้องที่โรงเรียนกำหนดไว้เองสำหรับคาบนี้. Nothing outranks it — the
        # school has already answered the question this function exists to
        # ask. If it is busy at this hour the cell is left for another time,
        # the same way ต้องเรียนที่ห้องประจำวิชา behaves.
        #
        # That includes a ลาน picked for this cell, whatever the lesson, the
        # class or the subject say about allow_outdoor: an explicit instruction
        # from the school beats the flags that only decide what the solver may
        # do by itself. _may_use_outdoor is not asked, and not changed.
        if pinned_room_id:
            r = r_map.get(pinned_room_id)
            if r and not room_taken(pinned_room_id):
                return pinned_room_id, r["name"], r["type"]
            return None, None, None

        # 0. "เรียนที่ห้องของนักเรียน" — แนะแนว, โฮมรูม, anything where the
        #    teacher walks to the class. Ahead of everything, including the
        #    teacher's own room, because that room is exactly what the setting
        #    exists to override: a guidance teacher with an office was pulling
        #    the whole class across the school to sit in it.
        if rule == "homeroom" and home and not room_taken(home):
            r = r_map.get(home)
            if r and building_ok(r):
                return home, r["name"], r["type"]

        # 1. ห้องประจำวิชา — a room tied to the subject itself (gym, computer
        #    lab, music room). This outranks the class's homeroom: the students
        #    walk to the facility the subject needs.
        #    A subject may name several: ฟิสิกส์ does not fit in 353 alone, so
        #    the school adds เคมี and ชีววิทยา as places it will also do. Any
        #    of them is right; the one in the class's own building is better.
        subj_rooms = _subject_rooms(subj)
        if subj_rooms:
            here = room_building((grp.get("homeroom_room_id")
                                  or anchor_room.get(group_id)) if group_id else None)
            open_ = [r_map[i] for i in subj_rooms
                     if i in r_map and not room_taken(i) and building_ok(r_map[i])]
            if open_:
                r = min(open_, key=lambda r: (
                    0 if (here is not None and r.get("building_id") == here) else 1,
                    subj_rooms.index(r["id"])))
                return r["id"], r["name"], r["type"]
        # "ต้องเรียนที่ห้องประจำวิชา" and it is busy: wait for it rather than
        # take an ordinary classroom. A นาฏศิลป์ period in 247 is not the
        # lesson the school planned, so the cell is left for another time.
        if rule == "subject" and (subj_rooms or want_dept):
            own = [r for r in ROOMS
                   if _is_subjects_own_room(r, subj_rooms, want_dept) and eligible(r)]
            if own:
                r = min(own, key=lambda r: r["id"])
                return r["id"], r["name"], r["type"]
            return None, None, None

        # 1a. ห้องประจำของชั้นนี้จริง ๆ — a room the school has kept for this
        #     class, and which is also where they sit.
        #
        #     ม.6/3 ห้องเพชร has 255 to itself, and was still being walked to
        #     another building for a science period because the department
        #     owns a lab there. A room given to one class is that class's room:
        #     they are not moved out of it for an ordinary lesson. A subject
        #     that must have its facility (ห้องประจำวิชา, or ต้องเรียนที่ห้อง
        #     ประจำวิชา) has already been handled above and is unaffected.
        #
        #     Ahead of EVERYTHING that belongs to the teacher, the ห้องพิเศษ of
        #     1b included. It used to sit below it, so a ห้องเพชร class whose
        #     teacher runs the band room was walked there. The teacher's
        #     ordinary fixed room (2a) — and with it teacher_room_over_homeroom
        #     and the teacher's own room_wins — were already further down, and
        #     still are: none of the three can pull this class out of its room.
        #
        #     Still a ranking, not a filter: if the room is taken at this hour,
        #     or the teacher cannot manage the stairs to it, the lesson goes on
        #     down the list and lands somewhere else for that one period. The
        #     run says so, class by class — see _stay_home_notes.
        #
        #     A class the school has ticked but never given a room is settled
        #     in one NOW, on its first lesson. Left to step 3b, that first
        #     lesson would already have gone to the teacher's room, and "one
        #     room, always the same one" would be broken before it began.
        if (group_id is not None and not wants_outdoor and not home
                and grp.get("stay_in_homeroom") is True):
            pick = pick_anchor()
            if pick:
                home = pick["id"]
                # Now it is this class's room: other classes' lessons that fall
                # back to "any free room" rank it last (see `squat`), and no
                # later class is handed it as theirs.
                homeroom_ids.add(home)
        if (home and not wants_outdoor and not room_taken(home)
                and group_id is not None):
            r = r_map.get(home)
            if (r and building_ok(r)
                    and _group_stays_home(grp, r, family) and _room_free_for(r, teacher_id)
                    and not upstairs(r)
                    and (r["type"] != "outdoor" or may_outdoor)):
                return home, r["name"], r["type"]

        # 1b. ห้องพิเศษที่เป็นของครูคนนี้ — the band room, the lab they run.
        #
        #     The school's rule is that students stay put and the teacher
        #     walks to them, and that is right for an ordinary lesson. It is
        #     not right for a ห้องพิเศษ: the instruments, the microscopes and
        #     the kiln do not travel, so for those the class comes to the
        #     teacher. 138 ห้องวงโยฯ with a teacher's name on it is exactly
        #     this case.
        if teacher_id is not None and rule != "homeroom":
            special = [r for r in ROOMS
                       if (r["id"] == fr or teacher_id in room_reserved_for(r))
                       and r.get("type") == "special"
                       and eligible(r) and not upstairs(r)]
            if special:
                r = min(special, key=lambda r: (r["id"] != fr, r["id"]))
                return r["id"], r["name"], r["type"]

        # 2'. ห้องประจำชั้นของนักเรียน, ahead of the department's facility
        #     and of the teacher's own room.
        #
        #     Which of the three comes first is the school's decision, not
        #     ours: "ครูอยู่กับที่ นักเรียนเดินมาหา" and "นักเรียนอยู่กับที่
        #     ครูเดินไปสอน" are both real ways to run a school, and this one
        #     runs the second — a class with a room of its own sits in it, and
        #     only a subject that has been marked as needing its facility
        #     (ต้องเรียนที่ห้องประจำวิชา, or a ห้องประจำวิชา of its own) takes
        #     them out of it. Those two are decided above, before this.
        #
        #     Only a REAL ห้องประจำชั้น counts here. A class that has none is
        #     given an anchor room further down, and an invented room is no
        #     reason to keep anyone out of a lab or their own room.
        #     ม.ต้นเป็นข้อยกเว้นของ teacher_room_wins
        #
        #     "ถ้า ม.ต้นมีห้องประจำ ต้องเรียนที่ห้องประจำก่อน"
        #
        #     เด็กเล็กเดินข้ามโรงเรียนทุกคาบไม่ใช่เรื่องเดียวกับ ม.ปลายเดิน
        #     โรงเรียนจึงตอบมาว่าสำหรับ ม.ต้นให้ห้องประจำชั้นชนะห้องของครู
        #     ส่วน ม.ปลายยังเป็นไปตามที่ตั้งไว้เหมือนเดิม — และยังเป็นการจัด
        #     ลำดับ ไม่ใช่การห้าม ห้องไม่ว่างก็ยังไหลลงไปหาห้องอื่นข้างล่าง
        #     ("บังคับก่อน แต่ถ้าจนตรอกให้ไปห้องอื่นได้")
        real_home = grp.get("homeroom_room_id")
        home_beats_teacher = (not teacher_room_wins) or (
            _lower_homeroom_first() and _level_key(grp) == "lower")
        # ม.ปลาย: ห้องที่โรงเรียนเขียนชื่อครูไว้ เรียกนักเรียนเข้ามาเรียนได้
        #
        # เฉพาะห้องที่เขียนชื่อ "ครูคนนี้" ไว้ และเข้าได้จริงในชั่วโมงนี้
        #
        # เคยนับห้องของกลุ่มสาระที่มีชื่อครูคนใดคนหนึ่งอยู่ด้วย เพื่อให้ลูกหมวด
        # เข้ามาเติมห้องได้ — ซึ่งผิดและผิดแรง วัดบนข้อมูลจริง: กันห้องวิทย์ไว้
        # ให้ครูวิทย์คนเดียวคนหนึ่ง แล้ว ม.ปลายเสียห้องประจำชั้นไป 78 คาบจาก 214
        # (206 -> 128) เพราะทั้งกลุ่มสาระเลิกใช้ห้องประจำชั้น แล้วไหลลงไปขั้นที่ 2
        # ซึ่งเรียง "ห้องที่ไม่มีใครจอง" ไว้ก่อน — คาบเหล่านั้นจึงไปอยู่เคมี
        # ชีววิทยา ฟิสิกส์ ห้องที่ไม่ได้ถูกกันไว้เลย และคาบในห้องที่กันไว้เอง
        # กลับลดลง (31 -> 29) คือเสียทั้งสองทาง
        #
        # ลูกหมวดเข้าห้องที่กันไว้ได้อยู่แล้วตามกติกาเดิม (ห้องของกลุ่มสาระ
        # ขั้นที่ 2) เมื่อห้องประจำชั้นของเขาไม่ว่าง — "เติมลูกหมวดเข้าไป" คือ
        # ใช้ชั่วโมงที่เหลือของห้องนั้น ไม่ใช่ไล่ห้องเรียนอื่นออกจากห้องตัวเอง
        # ส่วน "เจ้าของได้ก่อน" ทำด้วยลำดับการลงใน place_order
        #
        # upstairs เหมือนกับขั้น 1b และ 2a ที่เป็นคนใช้ห้องนี้จริง: ครูที่ขึ้น
        # บันไดไม่ได้และห้องที่กันไว้อยู่ชั้นสอง จะไม่ได้ห้องนั้นอยู่ดี จึงไม่
        # ควรเสียห้องประจำชั้นไปเพราะห้องที่ตัวเองไปไม่ได้
        if (home_beats_teacher and teacher_id is not None and rule != "homeroom"
                and not wants_outdoor and _upper_teacher_room_first()
                and _level_key(grp) == "upper"
                and any(teacher_id in room_reserved_for(r)
                        and eligible(r) and not upstairs(r)
                        for r in ROOMS)):
            home_beats_teacher = False
        if (real_home and not wants_outdoor and home_beats_teacher
                and not room_taken(real_home)):
            r = r_map.get(real_home)
            if (r and building_ok(r) and _room_free_for(r, teacher_id) and not upstairs(r)
                    and (r["type"] != "outdoor" or may_outdoor)):
                return real_home, r["name"], r["type"]

        # 2. A room this department owns. Several labs may serve one subject
        #    (5 computer rooms for 156 periods a week), so pin by department
        #    rather than by subject and take whichever is free.
        if want_dept:
            own = [r for r in ROOMS if r.get("specialized_dept_id") == want_dept and eligible(r)]
            if own:
                # Five computer rooms serve one subject, and picking by id sent
                # a class to whichever happened to be numbered lowest — across
                # the school from where they were sitting. Among the labs that
                # will do, take one in the building the class is already in.
                here = room_building((grp.get("homeroom_room_id")
                                      or anchor_room.get(group_id)) if group_id else None)
                r = min(own, key=lambda r: (
                    r["type"] != "special",
                    # A lab with a teacher's name on it is theirs first: taken
                    # only when no unclaimed lab of the department is free.
                    0 if _room_free_for(r, teacher_id) else 1,
                    0 if (here is not None and r.get("building_id") == here) else 1,
                    r["id"]))
                return r["id"], r["name"], r["type"]

        # 2a. ห้องของครูคนนี้ — their fixed room, or one the school has written
        #     their name on.
        #
        #     Writing a teacher's name on a room used to do one thing only:
        #     keep everyone else out. It never brought that teacher's own
        #     lessons in, because the class's homeroom was decided first and
        #     almost always free — so 261 ห้องสมุด sat empty all week with a
        #     name on the door. A room given to a teacher is where they teach.
        #
        #     Two things still outrank it: the subject's own facility (step 1),
        #     and a subject marked เรียนที่ห้องของนักเรียน (step 0), which
        #     exists precisely to say "not the teacher's room, theirs".
        if teacher_id is not None and rule != "homeroom":
            own_rooms = [r for r in ROOMS
                         if (r["id"] == fr or teacher_id in room_reserved_for(r))
                         and eligible(r) and not upstairs(r)]
            if own_rooms:
                r = min(own_rooms, key=lambda r: (r["id"] != fr, r["id"]))
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
                if r and eligible(r) and not upstairs(r):
                    return r["id"], r["name"], r["type"]

        # 3. Stay in the group's homeroom for ordinary subjects.
        if home and not wants_outdoor and not room_taken(home):
            r = r_map.get(home)
            if (r and building_ok(r) and _room_free_for(r, teacher_id) and not upstairs(r)
                    # …unless "home" is open ground and this subject is not
                    # allowed outside. A few classes here are recorded with a
                    # ลาน as their ห้องประจำชั้น, which quietly put ordinary
                    # lessons outdoors whatever the subject said.
                    and (r["type"] != "outdoor" or may_outdoor)):
                return home, r["name"], r["type"]

        # 3b. A class with no ห้องประจำชั้น gets one chosen for it now, BEFORE it
        #     would otherwise be sent to the teacher's own room. Without this
        #     the class follows a different teacher every period and walks all
        #     day; one class staying put costs one teacher a walk instead of
        #     forty students. Preferring a room no other class has claimed
        #     keeps the classes from fighting over the same few rooms.
        if (group_id is not None and not grp.get("homeroom_room_id")
                and group_id not in anchor_room and not wants_outdoor):
            # A room nobody calls home first (see _choose_anchor). Another
            # class's room beats no room: refusing to look further sent the
            # class outside while five classrooms stood empty.
            pick = pick_anchor()
            if pick:
                return pick["id"], pick["name"], pick["type"]
            # Nothing indoors free this hour. A ลาน will hold the lesson, but
            # it is NOT recorded as the class's anchor: anchoring them outside
            # sent the class back out every period for the rest of the week,
            # with classrooms standing empty — which is the opposite of
            # "fill the rooms first, then the open ground".
            if may_outdoor:
                yard = [r for r in ROOMS if r["type"] == "outdoor" and eligible(r)]
                if yard:
                    # The first ลาน in the school's order that is free this
                    # hour, moving to the next only because the one before is
                    # taken (eligible() has already dropped the taken ones).
                    # With no order saved every position is the same, and this
                    # is the roomiest first, then by id, exactly as before.
                    r = min(yard, key=lambda r: (yard_pos.get(r["id"], len(yard_pos)),
                                                 -int(r.get("capacity") or 0), r["id"]))
                    return r["id"], r["name"], r["type"]

        # 4. Teacher's own fixed room, as a late fallback: step 2a already
        #    tried it, so reaching here means it was busy or not allowed then
        #    and something has freed up since — or `rule` sent us past it.
        if fr and not wants_outdoor and not room_taken(fr):
            r = r_map.get(fr)
            # Not if it is open ground and this subject stays indoors: some
            # teachers here are recorded against a ลาน, and that alone was
            # sending ninety ordinary lessons outside with classrooms free.
            if r and (r["type"] != "outdoor" or may_outdoor) \
                    and _room_allows_group(r, group_id, family):
                return fr, r["name"], r["type"]

        group_size = grp.get("size", 40)

        def rank(r: dict) -> tuple:
            if wants_outdoor:
                pref = {"outdoor": 0, "physical": 1, "floating": 2, "special": 3}
            else:
                # ลาน last, and by a wide margin: the school asked that the
                # classrooms fill up first and open ground take only what is
                # left over, so it sits below even a special room.
                pref = {"physical": 0, "floating": 1, "special": 2, "outdoor": 9}
            # Seat the class somewhere it fits when we can — but a tight room
            # still beats no room, so this orders rather than excludes.
            too_small = 1 if r.get("capacity", 40) < group_size else 0
            # Somebody else's ห้องประจำชั้น is their desks, their things on the
            # wall, and the room they come back to. Taking it because it
            # happened to be free this hour is what left ม.3/6 unable to hold
            # its own แนะแนว in its own room. A preference, not a rule: an
            # empty room still beats no room at all.
            squat = 1 if (r["id"] in homeroom_ids and r["id"] != home) else 0
            kind = pref.get(r["type"], 4)
            # "Fill the classrooms first" means FIRST — ahead of the stairs
            # preference too. Ranked under it, every upstairs classroom came
            # after the ลาน for a teacher who cannot manage stairs, and the
            # class went outside with the first floor empty. A flight of
            # stairs is a cost; sitting in the open because of it is not the
            # trade the school asked for.
            #
            # Among the ลาน themselves, the school's ลำดับลาน decides which one.
            #
            # "ลานแนะแนวก็ยังมีห้อง ม.ต้น ออกมา"
            #
            # This read the order only for kind 9 — an ordinary subject pushed
            # outside because every room was full. คาบพละ, which is the lesson
            # that actually goes out to a ลาน and the only one that belongs
            # there, never looked at the order at all: with every ลาน the same
            # type and the same capacity, the tuple ended on r["id"] and it
            # picked by database id. The school has 37 of them, from ส.ฟุตบอล
            # to ลานแนะแนว, and ลานแนะแนว got its turn as soon as the
            # lower-numbered ones were taken — while the order the school had
            # written down sat unread.
            #
            # Placed after `kind` so it only ever chooses between ลาน: ahead of
            # it, an ordinary classroom (order 0) would have outranked a ลาน
            # the school had put second, and sent คาบพละ indoors.
            # Zero for every room when no order is saved, so nothing moves.
            yard_rank = (yard_pos.get(r["id"], len(yard_pos))
                         if r["type"] == "outdoor" else 0)
            # ลำดับต้องอยู่หลัง kind เพื่อให้มันเลือกได้แค่ "ลานไหน" ไม่ใช่
            # "ลานหรือในห้อง": ย้ายขึ้นไปไว้ต้นๆ แล้ววัด คาบที่ไปลานหายไป
            # 36 -> 19 เพราะห้องเรียนธรรมดา (ลำดับ 0) ชนะลานที่โรงเรียนจัดไว้
            # ลำดับที่สอง แล้วคาบพละก็เข้าไปนั่งในห้อง
            #
            # แต่ squat กับ too_small ไม่มีความหมายกับลาน — ลานที่เผลอถูกบันทึก
            # เป็นห้องประจำชั้นของห้องไหน หรือที่กรอกความจุไว้น้อย ไม่ควรชนะ
            # ลำดับที่โรงเรียนสั่ง จึงปิดสองตัวนั้นสำหรับลาน เพื่อให้ในกลุ่มลาน
            # เหลือลำดับเป็นตัวตัดสินจริง เท่ากับทางของวิชาที่ถูกดันออกไป
            # ข้างนอก (kind >= 9) · ของในร่มไม่ขยับเลย
            if r["type"] == "outdoor":
                squat = too_small = 0
            return (1 if kind >= 9 else 0,
                    yard_rank if kind >= 9 else 0,
                    1 if upstairs(r) else 0, squat,
                    too_small, kind, yard_rank, r["id"])

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

    # How many periods of one subject a class already has on one day.
    #
    # A subject that is not a คาบคู่ should not come round twice in a day: the
    # class sits through สังคม in คาบ 7 and again in คาบ 8, which is the shape
    # the school asked to stop. Counted here rather than scanned out of SLOTS,
    # because the question is asked of every candidate cell.
    subj_day: dict[tuple[int, int, int], int] = defaultdict(int)

    def note_subject(gid: int, sid: int | None, day: int, delta: int = 1) -> None:
        if sid is not None:
            subj_day[(gid, sid, day)] += delta

    # ── ขยับห้องให้คาบที่ลงไม่ได้ (หาเส้นทางเหมาะสมที่สุด) ────────────────────
    #
    # "ถ้ายังไม่ได้ให้กลับไปเลื่อนห้องต่างๆให้ลงได้"
    #
    # The usual search asks one question of each room — is it free? — and gives
    # up when the answer is no everywhere. But "no room free" is rarely the
    # truth. The truth is usually that one of the rooms this lesson needs is
    # being used by a lesson that would have been just as happy next door.
    #
    # So when a lesson has nowhere to go, this walks a chain instead: take the
    # room somebody else is in, move THEM to another room they are equally
    # allowed to use, and if that one is occupied too, move its occupant on
    # again — until the chain ends on a room that is genuinely empty. Then the
    # whole chain shifts along by one and everybody, including the new lesson,
    # has a room. If no chain ends on an empty room, nothing is moved at all.
    #
    # Nobody changes day or period, only which door they walk through, so no
    # teacher, class or back-to-back rule can break: the only thing being
    # re-decided is the room, which is the one thing that was blocking.
    # How long a chain may get, and how far down each lesson's room
    # preferences to look for the next link. Measured on this school's data
    # with twenty ordinary rooms closed, which is the shortage the school
    # describes: a chain of 5 across 8 rooms got 3 lessons of 11 into a room,
    # 9 across 20 got 7, and the solve took the same four seconds either way.
    # ลึก 9 มาจากการวัดบนข้อมูลตัวอย่าง ซึ่ง "ใช้เวลาเท่ากันทั้งสองแบบ" จริง
    # — แต่ข้อมูลตัวอย่างจัดเสร็จใน ~2 วินาที ความต่างจึงมองไม่เห็น
    #
    # บนข้อมูลจริงของโรงเรียน (26 ต.ค. · แผนการสอน 1,720 แถว · 2,425 คาบ)
    # การไล่สลับห้องเป็นลูกโซ่คือเกือบทั้งหมดของเวลาที่ใช้: shuffle_for ถูกเรียก
    # 918 ครั้งจากข้างนอก แต่เรียกตัวเองต่อจนเป็น 134,530 ครั้ง และ eligible()
    # ถูกเรียก 33 ล้านครั้ง วัดเทียบความลึกบนข้อมูลจริง 2 เมล็ด:
    #
    #   ลึก 9   119.3 / 58.6 วินาที · ถูกนั่ง 330/333 · ไม่มีห้อง 26/28
    #   ลึก 5    78.6 / 36.4 วินาที · ถูกนั่ง 324/329 · ไม่มีห้อง 27/27
    #   ลึก 3    34.8 / 23.9 วินาที · ถูกนั่ง 327/326 · ไม่มีห้อง 27/24
    #
    # เร็วขึ้น 3.4 เท่า โดยคาบที่จัดได้เท่าเดิมทุกเมล็ด (2,425/2,423) และคุณภาพ
    # อยู่ในช่วงความคลาดเคลื่อนเดียวกัน บนข้อมูลตัวอย่างก็เท่ากันทุกตัว
    # (คาบ 2,209 · ไม่มีห้อง 0 · ห้องชนกัน 0 ทั้งลึก 9 และลึก 3)
    #
    # เรื่องนี้สำคัญกว่าความสวยของตาราง: โรงเรียนรันบน Render รุ่นฟรี และอาการ
    # ที่แจ้งซ้ำมาหลายรอบคือ "สร้างตารางแล้วเซิร์ฟเวอร์ไม่ตอบ" — ตารางที่ดีขึ้น
    # นิดหน่อยแต่จัดไม่เสร็จ ไม่มีประโยชน์กับใครเลย
    #
    # แต่ลดเป็น 3 ตลอดเวลาไม่ได้: วัดแล้วรอบซ่อมกับรอบตรวจความถูกต้องแย่ลงจริง
    # (consistency · repair · repair_new · yardrescue ล้ม) ความลึกจึงมีค่าของมัน
    # อยู่ เพียงแต่ราคามันแพงขึ้นตามขนาดงาน
    #
    # ตัดสินด้วย "เวลาที่ใช้ไปแล้ว" ไม่ใช่ขนาดข้อมูล เพราะเส้นแบ่งตามจำนวนแถว
    # จะเป็นการวัดให้พอดีกับข้อมูลสองชุดที่บังเอิญมีอยู่ตรงหน้า ส่วนเวลาปรับ
    # ตัวตามเครื่องจริง — Render ช้ากว่าเครื่องที่วัด เส้นนี้ก็จะมาถึงเร็วขึ้นเอง
    #
    # งานขนาดปกติจัดเสร็จใน ~2 วินาที จึงไม่มีวันแตะเส้นนี้ และได้ความลึกเต็ม 9
    # เหมือนเดิมทุกประการ ส่วนงานของโรงเรียนที่ใช้เวลาเป็นนาที จะลดความลึกลง
    # หลังผ่านไป 20 วินาที ซึ่งตอนนั้นคาบส่วนใหญ่ลงที่แล้ว เหลือแต่การไล่หา
    # ห้องให้คาบที่ยากที่สุด
    SHUFFLE_DEPTH = 9
    SHUFFLE_DEPTH_LATE = 3
    SHUFFLE_BUDGET_S = 20.0
    SHUFFLE_WIDTH = 20
    shuffle_on = False         # switched on for the repair pass at the end
    # Who is sitting in each room at each hour. Kept as an index because the
    # chain asks the question thousands of times.
    room_holder: dict[tuple[int, int, int], dict] = {}

    def index_rooms() -> None:
        room_holder.clear()
        for s in SLOTS:
            if not s.get("room_id"):
                continue
            for b in cell_buckets(s["group_id"], s["period"]):
                room_holder[(s["room_id"], s["day"], b)] = s

    def hold_room(s: dict, rid: int | None) -> None:
        """Move a placed lesson into a room (or out of the one it is in)."""
        old = s.get("room_id")
        bks = cell_buckets(s["group_id"], s["period"])
        if old:
            for b in bks:
                room_busy.discard((old, s["day"], b))
                room_holder.pop((old, s["day"], b), None)
        s["room_id"] = rid
        r = r_map.get(rid) if rid else None
        s["room_name"] = r["name"] if r else None
        s["room_type"] = r["type"] if r else None
        if rid:
            for b in bks:
                room_busy.add((rid, s["day"], b))
                room_holder[(rid, s["day"], b)] = s

    def may_move_room(s: dict) -> bool:
        """Lessons that must not be shuffled out of the room they are in."""
        if _held(s) or s.get("is_elective") or s.get("is_activity_block"):
            return False
        # A คาบคู่ is one lesson two periods long and both halves share a room;
        # moving one half alone would make the class pack up halfway through.
        if s.get("double_group_key"):
            return False
        # ห้องย่อยที่นั่งเรียนด้วยกัน — same subject, same teacher, same hour,
        # two subgroups of one class. They are one roomful, and walking one of
        # them next door to free a room splits the lesson in two, which is
        # where "ห้อง ... ซ้ำ · ครู ... ซ้ำ" comes from.
        if s.get("teacher_id") and s.get("subject_id") is not None:
            kin = parent_of.get(s["group_id"])
            if kin is not None and any(
                    x is not s and x["day"] == s["day"] and x["period"] == s["period"]
                    and x.get("subject_id") == s.get("subject_id")
                    and x.get("teacher_id") == s.get("teacher_id")
                    and parent_of.get(x["group_id"]) == kin
                    for x in SLOTS):
                return False
        # (No check for คาบเรียนลาน here, on purpose: a ลาน held by a pick is
        # "taken" for every other class at that hour — room_taken says so even
        # under pretend_free — so no repair ever asks for it, and a lesson
        # sitting on its picked ลาน is never the one in the way.)
        # The school wrote this room down for this lesson itself.
        return not any(r.get("room_id") == s.get("room_id")
                       and r["group_id"] == s["group_id"]
                       and r["subject_id"] == s.get("subject_id")
                       for r in REQUIREMENTS if r.get("room_id"))

    def rooms_for(tid: int, gid: int, sid: int | None, day: int, period: int,
                  also_period: int | None, pinned: int | None,
                  allow_out: bool | None, tried: set[int]) -> list[int]:
        """Rooms this lesson would accept at this hour, best first.

        Occupancy is ignored — that is the whole point — so this is the list
        the chain may walk. Everything else (ตึก, ห้องประจำวิชา, ห้องที่กันไว้,
        ลาน) still decides, because it is the same function that places a
        lesson normally, asked with one question switched off.
        """
        out: list[int] = []
        seen = set(tried)
        for _ in range(SHUFFLE_WIDTH):
            rid, _n, _t = find_room(tid, day, period, sid, gid, also_period,
                                    allow_out, pinned, pretend_free=True,
                                    avoid=frozenset(seen))
            if not rid:
                break
            out.append(rid)
            seen.add(rid)
        return out

    def shuffle_for(tid: int, gid: int, sid: int | None, day: int, period: int,
                    also_period: int | None = None, pinned: int | None = None,
                    allow_out: bool | None = None,
                    tried: set[int] | None = None, depth: int = 0) -> int | None:
        """A room for this lesson, moving other lessons along if that is what it takes.

        Returns the room id and leaves every lesson it moved in its new room,
        or returns None having moved nothing.
        """
        tried = tried if tried is not None else set()
        limit = (SHUFFLE_DEPTH
                 if _time.perf_counter() - _t0 < SHUFFLE_BUDGET_S
                 else SHUFFLE_DEPTH_LATE)
        if depth >= limit:
            return None
        bks = cell_buckets(gid, period)
        if also_period is not None:
            bks = frozenset(bks) | cell_buckets(gid, also_period)
        for rid in rooms_for(tid, gid, sid, day, period, also_period,
                             pinned, allow_out, tried):
            tried.add(rid)
            here = [room_holder.get((rid, day, b)) for b in bks]
            here = [s for s in here if s is not None]
            if not here:
                return rid                       # empty after all — take it
            if len(set(id(s) for s in here)) > 1:
                continue                         # two lessons to move, not one
            occ = here[0]
            if not may_move_room(occ):
                continue
            was = occ["room_id"]
            hold_room(occ, None)                 # free it, then look for a chain
            moved = shuffle_for(occ["teacher_id"], occ["group_id"],
                                occ.get("subject_id"), occ["day"], occ["period"],
                                None, None, None, tried, depth + 1)
            if moved:
                hold_room(occ, moved)
                return rid
            hold_room(occ, was)                  # put them back, try the next room
        return None

    def make_slot(req: dict, day: int, period: int,
                  room: tuple | None = None, also_period: int | None = None) -> dict:
        """One lesson in one cell. `room` pins it to a room already chosen.

        A คาบคู่ is one lesson two periods long, so both halves belong in the
        same room: chosen separately they came out as ราชวินิตภิรมย์4 then
        ราชวินิตภิรมย์3, and the class packed up and moved halfway through
        its own double.
        """
        rid, rname, rtype = room if room else find_room(
            req["teacher_id"], day, period, req["subject_id"], req["group_id"],
            also_period,
            _may_use_outdoor(s_map.get(req["subject_id"]), req,
                             g_map.get(req["group_id"])),
            # ห้องที่โรงเรียนกำหนดไว้เองสำหรับคาบนี้ของห้องนี้ — above every
            # rule, because it is not a rule, it is an answer. One subject
            # taught by six teachers in four rooms cannot be written as a
            # single ห้องประจำวิชา, so the school writes it out class by class.
            req.get("room_id"))
        # Nothing free — but maybe only because the rooms this lesson needs are
        # held by lessons that could sit elsewhere. Walk the chain.
        if not rid and shuffle_on:
            rid = shuffle_for(
                req["teacher_id"], req["group_id"], req["subject_id"], day, period,
                also_period, req.get("room_id"),
                _may_use_outdoor(s_map.get(req["subject_id"]), req,
                                 g_map.get(req["group_id"])))
            if rid:
                r = r_map.get(rid) or {}
                rname, rtype = r.get("name"), r.get("type")
        if rid:                       # so the next cell knows where they are
            teacher_room[(req["teacher_id"], day, period)] = rid
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
        co = req.get("co_teacher_id")
        if co and co != req["teacher_id"]:
            slot["co_teacher_id"] = co
            slot["co_teacher_name"] = (t_map.get(co) or {}).get("name")
        if rid:
            for b in cell_buckets(req["group_id"], period):
                room_busy.add((rid, day, b))
                room_holder[(rid, day, b)] = slot
        return slot

    # สอนร่วมที่เขียนไว้สองแถว — one lesson, written from each teacher's side.
    #
    # An imported teaching plan has a row per teacher, so a Thai teacher and a
    # foreign teacher who share ม.2/1 ค22102 arrive as two rows of three
    # periods. Taken at face value the class gets six periods of the subject
    # and the pair are never in the room together. Where the two rows name
    # each other, they are folded into one here: three periods, both teachers
    # booked, which is what the school meant and what สอนร่วม on a single row
    # already does. Rows that do NOT name each other are left alone and the
    # ตรวจสอบวิชาซ้ำ warning stands.
    wanted = [r for r in REQUIREMENTS if r["id"] not in skipped_reqs]
    if _REPAIR_ONLY is not None:
        # ซ่อมเฉพาะห้องที่เลือก: a class left out of the run is not asked for
        # anything — not even the lesson it was already short of. Seating it
        # now would be a change to a class that was meant to stay as it is.
        wanted = [r for r in wanted if r.get("group_id") in _REPAIR_ONLY
                  and r["id"] not in _REPAIR_HELD_REQS]
    by_cell: dict[tuple, list] = defaultdict(list)
    for r in wanted:
        by_cell[(r["group_id"], r["subject_id"])].append(r)
    folded, pair_count = _fold_coteaching(wanted)

    # Separate parallel vs solo
    parallel: dict[str, list] = {}
    solo: list[dict] = []
    for req in wanted:
        if req["id"] in folded:
            continue          # the other half of a สอนร่วม pair
        if req["id"] in pair_count:
            # A copy, so the fold never reaches the school's saved rows: the
            # partner and the agreed period count live only in this solve.
            req = {**req, "weekly_count": pair_count[req["id"]],
                   "co_teacher_id": next(
                       (o["teacher_id"] for o in by_cell[(req["group_id"], req["subject_id"])]
                        if o["id"] in folded and o["teacher_id"] != req["teacher_id"]),
                       req.get("co_teacher_id"))}
        pgk = req.get("parallel_group_key")
        if pgk:
            parallel.setdefault(pgk, []).append(req)
        else:
            solo.append(req)

    # One teacher, one subject, two sub-classes of the same class: that is one
    # lesson, not two.
    #
    # ม.6/9ก and ม.6/9ข sitting with the same teacher for ว33286 are a single
    # roomful — the school writes it "ม.6/9กข" on their sheet, meaning the two
    # halves come together for it. Taken as separate requirements it became
    # four periods in the teacher's week instead of two, and the sub-classes
    # were taught the same thing at different times. Merged here rather than
    # asked for, because nothing about the pair is ambiguous: a teacher cannot
    # be in two places at once, so two sibling classes with one teacher and one
    # subject can only ever have meant together.
    merged_keys: set[str] = set()
    sibling: dict[tuple, list] = defaultdict(list)
    for req in solo:
        g = g_map.get(req["group_id"]) or {}
        parent = g.get("parent_id")
        if parent:
            sibling[(parent, req["subject_id"], req["teacher_id"])].append(req)
    for (parent, sid, tid), group in sibling.items():
        if len(group) < 2:
            continue
        key = f"พร้อมกัน-{parent}-{sid}-{tid}"
        merged_keys.add(key)
        # Copies, so the key exists for this solve and on the lessons it
        # produces — which is what makes the pair move together when somebody
        # drags one — without being written back onto the school's saved
        # requirement rows, where it would look like a คู่ขนาน they set up.
        for req in group:
            solo.remove(req)
        parallel[key] = [{**req, "parallel_group_key": key} for req in group]

    class_period_set = set(class_periods)
    def teacher_free(tid, day, gid, period) -> bool:
        # ยังไม่ได้เลือกครู (tid 0). Nobody is booked, so nobody can clash — and
        # two such lessons must not be treated as "the same teacher" and kept
        # apart, which is what happened while 0 was handled like a real id.
        if not tid:
            return True
        return not any((tid, day, b) in teacher_busy for b in cell_buckets(gid, period))

    def home_free(req: dict, day: int, period: int) -> bool:
        """เรียนที่ห้องของนักเรียน — is their own room free at this hour?

        แนะแนว in whatever room happened to be spare is not แนะแนว at the
        students' desks, which is the whole point of the setting. Finding the
        room busy, the old code shrugged and took another one; this looks for
        an hour when the room is free instead, and only gives up on the last
        passes, where a lesson placed beats a lesson lost.
        """
        subj = s_map.get(req.get("subject_id")) or {}
        if _subject_room_rule(subj) != "homeroom":
            return True
        grp = g_map.get(req["group_id"]) or {}
        home = grp.get("homeroom_room_id")
        if not home:
            return True
        return not any((home, day, b) in room_busy
                       for b in cell_buckets(req["group_id"], period))

    def facility_free(req: dict, day: int, period: int) -> bool:
        """ต้องเรียนที่ห้องประจำวิชา — is that room free at this hour?

        Without this the setting only chose the room; a cell where the gym was
        already busy still took the lesson and left it with no room at all,
        which is neither the facility nor an honest "could not place it".
        """
        subj = s_map.get(req.get("subject_id")) or {}
        if _subject_room_rule(subj) != "subject":
            return True
        want = _subject_rooms(subj)
        dept = subj.get("department_id")
        rooms = [r for r in ROOMS
                 if r["id"] in want or (dept and r.get("specialized_dept_id") == dept)]
        if not rooms:
            return True
        bks = cell_buckets(req["group_id"], period)
        return any(not any((r["id"], day, b) in room_busy for b in bks)
                   and _room_usable(r) for r in rooms)

    def co_of(req: dict) -> int | None:
        """The สอนร่วม partner on this requirement, if there is a real one."""
        co = req.get("co_teacher_id")
        return co if co and co != req.get("teacher_id") else None

    def pair_free(req: dict, day: int, period: int) -> bool:
        """Both of them must be free — the lesson puts both in the room."""
        co = co_of(req)
        return co is None or teacher_free(co, day, req["group_id"], period)

    def book_pair(req: dict, day: int, period: int) -> None:
        co = co_of(req)
        if co is not None:
            book(co, req["group_id"], day, period)

    # How many of this class's five days already have a lesson in this period.
    # Used to spread a class's lessons across its periods: without it the slack
    # in a timetable all pools into whichever period is chosen last, leaving
    # one column empty across the week while the rest run full.
    class_period_load: dict[tuple[int, int], int] = defaultdict(int)

    # How much of each teacher's week sits in the morning against the
    # afternoon. Filling every class's day from the front put 79% of all
    # lessons before noon and left 53 teachers teaching mornings only, which
    # is a worse day than the one it replaced.
    teacher_half: dict[tuple[int, int], int] = defaultdict(int)   # (tid, 0=am 1=pm)

    # How many days this teacher already occupies this period.
    #
    # Spreading each CLASS across its periods is not the same thing, and the
    # difference is what the staffroom noticed: a teacher with five different
    # classes can sit in คาบ 1 on all five days while every one of those classes
    # sees only a single คาบ 1 lesson, so nothing above objected. 52 teachers
    # were teaching one period every day of the week.
    teacher_period: dict[tuple[int, int], int] = defaultdict(int)

    # How many lessons each teacher already has on each DAY, which is a
    # different question from which period of the day they sit in. A week of
    # 3, 4, 1, 4, 5 is what the staffroom noticed: a Wednesday worth coming in
    # for one lesson, and a Friday with five. Nothing above was counting it —
    # spreading a teacher across the periods of a day says nothing about how
    # many land on each day.
    teacher_day: dict[tuple[int, int], int] = defaultdict(int)

    # Which room each teacher ends up in, by cell, so the next placement can
    # see where they will be walking from.
    #
    # Not one teacher in this school has a room of their own: they go to the
    # students, so two back-to-back lessons with two different classes mean a
    # walk whatever we do — 280 of the 402 walks are exactly that, and no
    # amount of scheduling removes them. What can be removed is the LENGTH of
    # the walk. Crossing from อาคาร 1 to อาคาร 3 in the ten minutes between two
    # periods is a different thing from stepping along a corridor, and that is
    # the part this makes cheaper.
    teacher_room: dict[tuple[int, int, int], int] = {}

    def room_building(rid: int | None) -> int | None:
        r = r_map.get(rid) if rid else None
        return r.get("building_id") if r else None

    def group_building(gid: int) -> int | None:
        """Where a class sits when nothing drags it elsewhere."""
        g = g_map.get(gid, {})
        return room_building(g.get("homeroom_room_id") or anchor_room.get(gid))

    def building_hop(tid: int, gid: int, day: int, period: int) -> int:
        """Would taking this cell make the teacher cross buildings on the bell?"""
        here = group_building(gid)
        if here is None:
            return 0
        lvl_ = _level_key(g_map.get(gid))
        nums = _class_periods_for_level(lvl_)
        if period not in nums:
            return 0
        i = nums.index(period)
        for j in (i - 1, i + 1):
            if not (0 <= j < len(nums)):
                continue
            there = room_building(teacher_room.get((tid, day, nums[j])))
            if there is not None and there != here:
                return 1
        return 0

    def _half(gid: int, period: int) -> int:
        cut = _morning_cutoff(_level_key(g_map.get(gid)))
        return 0 if (cut is not None and period <= cut) else 1

    def book(tid, gid, day, period) -> None:
        # The class is always booked; the teacher only when there is one.
        group_busy.add((gid, day, period))
        class_period_load[(gid, period)] += 1
        if not tid:
            return
        for b in cell_buckets(gid, period):
            teacher_busy.add((tid, day, b))
        sp = span_of(gid, period)
        if sp:
            teacher_spans[(tid, day)].append(sp)
        teacher_half[(tid, _half(gid, period))] += 1
        teacher_period[(tid, period)] += 1
        teacher_day[(tid, day)] += 1

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
        if teacher_half[(tid, _half(gid, period))] > 0:
            teacher_half[(tid, _half(gid, period))] -= 1
        if teacher_period[(tid, period)] > 0:
            teacher_period[(tid, period)] -= 1
        if teacher_day[(tid, day)] > 0:
            teacher_day[(tid, day)] -= 1
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
    last_cap = _school_max_last_period(body)
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

    # Which lessons cannot do without a room of their own. Defined here, ahead
    # of every placer that asks, so it is never reached before it exists.
    facility_depts = {r["specialized_dept_id"] for r in ROOMS
                      if r.get("specialized_dept_id")}

    def needs_facility(r: dict) -> bool:
        """Is there a room this lesson cannot do without?"""
        subj = s_map.get(r["subject_id"], {}) or {}
        return bool(
            _subject_room_rule(subj) == "subject"
            or _subject_rooms(subj)
            # ห้องที่โรงเรียนเขียนไว้เองสำหรับห้องเรียนนี้ (ตารางห้องประจำวิชา).
            # One room and no alternative is as tight as a lab, and placing it
            # late is why those lessons came back as "ไม่มีห้องว่าง": by then
            # an ordinary lesson that could sit anywhere was already in it.
            or r.get("room_id")
            or subj.get("department_id") in facility_depts)

    def place_single(req, gid, tid, needed):
        """Place up to `needed` single periods; returns how many placed.

        Tried in six passes, each loosening what we will settle for:
          1. the teacher's own preferences AND a short run away from lunch
          2. preferences honoured, run still short, lunch allowed
          3. preferences honoured, up to the teacher's hard ceiling
          4. preferences dropped — better a lesson placed than a lesson lost
          5. the same-hour limits dropped, but still one period of a subject
             a day
          6. that last rule dropped too, as the very last thing tried
        A lesson that cannot be placed even then is reported, rather than
        stacking a teacher up to seven periods in a row as it used to.

        Pass 5 exists because pass 4 alone cost twelve lessons a week: the
        cells left over at the end are often all in one column, and a limit
        that cannot be lifted turns "this teacher's week is lopsided" into
        "this class never gets the subject". Lopsided is the lesser harm, so
        it is tried only once everything else has failed.

        Pass 6 is the same argument one step further, and the order of those
        last two matters: a teacher taking the same hour four days running is
        a worse week for one person, but a class sitting through อ22102 twice
        in one Tuesday is a worse DAY for forty of them. So the teacher's
        spread gives way first, and the one-a-day rule is the very last thing
        this gives up — which took the school's repeated subjects from 42 a
        week to single figures.
        """
        hard = _consec_limit(t_map.get(tid), consec_hard)
        prefs = _teacher_prefs(t_map.get(tid))
        lvl = _level_key(g_map.get(gid))
        morning_end = _morning_cutoff(lvl)
        wants_morning = _prefers_morning(s_map.get(req["subject_id"]))
        # A คาบคู่ is meant to sit twice in a day; everything else is not.
        duration = (s_map.get(req["subject_id"], {}) or {}).get("duration", 1) or 1
        if req.get("pinned_double"):
            duration = 2            # this lesson is a pair, whatever the subject is
            needed = max(needed, 2)         # …and a pair is two periods
        placed = 0
        # ล็อกวัน/คาบไว้ = บังคับลงตรงนั้น, for an ordinary lesson too: an
        # unlocked lesson sitting in the cell the school named is lifted out
        # and re-placed later, rather than the pinned lesson being the one
        # reported as not fitting.
        pin_d, pin_p = req.get("pinned_day"), req.get("pinned_period")
        if pin_d is not None and pin_p is not None:
            want_cells = [(int(pin_d), int(pin_p))]
            if duration == 2:
                nxt = _next_class_period_for(lvl, int(pin_p))
                if nxt is not None:
                    want_cells.append((int(pin_d), nxt))
            for cd, cp in want_cells:
                force_pin_cell(gid, cd, cp, req.get("subject_id"))
        for attempt in range(6):
            if placed >= needed:
                break
            cells = allow_days(cells_for(gid), req.get("subject_id"))
            # ล็อควัน/คาบไว้แล้ว — the school has decided when this lesson
            # happens, so there is nothing to search: the only candidates are
            # the cells it named. If they are taken, the lesson is reported
            # rather than quietly moved somewhere else, which is the whole
            # point of pinning it.
            pin_day, pin_period = req.get("pinned_day"), req.get("pinned_period")
            if pin_day is not None and pin_period is not None:
                cells = [(int(pin_day), int(pin_period))]
                if duration == 2:
                    nxt = _next_class_period_for(_level_key(g_map.get(gid)),
                                                 int(pin_period))
                    if nxt is not None:
                        cells.append((int(pin_day), nxt))
            # คาบสุดท้ายของวัน — "ไม่ใช้เลย" takes those cells off the board
            # entirely, and a lesson left with nowhere to go is reported so the
            # school can seat it by hand. In "ใช้เมื่อจำเป็น" they stay, ranked
            # last by tail_cost below. A cell the school pinned is its own
            # decision and is never filtered out.
            if tail_mode == "never" and (pin_day is None or pin_period is None):
                cells = [c for c in cells if not uses_tail(lvl, c[1])]
            random.shuffle(cells)
            # Teachers still short of their last-period duty get those cells
            # first; a morning subject gets the morning first. Both are only an
            # ordering — nothing is excluded by them.
            last_num = _last_period_for(lvl)
            # An hour the school picked a ลาน for is an hour with a room in it
            # — the whole reason for picking it — so an ordinary lesson is put
            # there before anywhere else. A lesson that needs a facility of its
            # own (a lab, a studio) goes last: a pick would take it out of the
            # room it cannot do without, and that is for the school to decide
            # rather than for this ranking to stumble into.
            needs_fac = needs_facility(req)

            def rank(cell):
                day, period = cell
                morning = wants_morning and morning_end is not None and period <= morning_end
                lean = 0
                if (gid, day, period) in pick_owned:
                    lean = 2 if needs_fac else -1
                # เวรคาบสุดท้าย is NOT steered from here any more. Sending every
                # teacher who still owes a last period straight to it filled
                # the last period ahead of the one before it, which is exactly
                # backwards: the leftover cells then landed in the middle of
                # the afternoon instead of at the end of the day. The repair
                # pass after placement gives each teacher their duty, and by
                # then the last period has the free cells to do it with.
                return (
                    lean,
                    0 if morning or not wants_morning else 1,
                    # Keep the END of the day free so classes can go home, but
                    # only the end. Ordering strictly by period number instead
                    # packed everything into คาบ 1-4 and left teachers with
                    # mornings only; what the school actually wanted was the
                    # last periods empty, not the first ones full. So only the
                    # final two periods are discouraged and the rest rank
                    # equal, which leaves room for the two rules below.
                    tail_cost(lvl, period),
                    # Level the teacher's WEEK before levelling their day. A
                    # teacher with one lesson on Wednesday and five on Friday
                    # has a bad week however neatly those five are spread
                    # across the hours, and the five are what makes the day
                    # hard. Ahead of the period rule because the period rule
                    # cannot see days at all, so left to itself it will keep
                    # filling the day that is already full.
                    teacher_day[(tid, day)],
                    # Spread the teacher across the periods of the day, so
                    # their week is not the same hour five times over. This
                    # also settles the morning/afternoon balance on its own —
                    # levelling every period levels the halves with it — so the
                    # separate half-rate rule it replaced is gone.
                    teacher_period[(tid, period)],
                    round(half_rate(tid, gid, period), 3),
                    # Among equals, the class's emptiest day for that period —
                    # keeps one day from taking the lot.
                    class_period_load[(gid, period)],
                    # Don't send a teacher across the school on the bell when
                    # an otherwise equal cell keeps them in the building they
                    # are already in. Ranked below the fairness rules on
                    # purpose: a short walk is worth having, but not worth
                    # giving somebody a five-lesson day to get.
                    #
                    # Switched off for a period this teacher does not yet
                    # teach at all. Left on, it argued against the very cells
                    # that fill คาบ 4 and คาบ 5 — the staggered-lunch periods,
                    # whose classes are the ones most likely to sit in another
                    # building — and three more teachers a week ended up with
                    # that column blank. A hole in the day is worse than a
                    # longer walk between two lessons.
                    building_hop(tid, gid, day, period)
                    if teacher_period[(tid, period)] else 0,
                    # Sitting down straight after lunch is slightly worse than
                    # not; a tie-break, never a reason to skip the period.
                    1 if lunch_adjacent(gid, period) else 0,
                )
            # Ranked again after every placement rather than sorted once.
            # Sorting once and then walking the list handed every lesson of a
            # requirement the same winner: each placement raised that period's
            # counter, but the frozen order never saw it, so the cell that
            # ranked best for the first lesson still ranked best for the
            # second and the third. That is how a teacher ended up teaching
            # one period all week while คาบ 4 and คาบ 5 stayed empty. Choosing
            # the best remaining cell each time is what actually spreads them.
            pool = list(cells)
            while placed < needed and pool:
                pool.sort(key=rank)
                taken = -1
                for idx, (day, period) in enumerate(pool):
                    # วันที่ไม่สอน is not a preference — the teacher is not in
                    # the building. It used to be dropped on the last pass
                    # along with the soft wishes, which is how a teacher who
                    # had Friday off was given a Friday คาบ 9. A lesson that
                    # cannot fit the other four days is reported as unplaced
                    # instead, which is a question for the school to answer.
                    if day in prefs["days_off"]:
                        continue
                    if attempt < 3 and period in prefs["avoid_periods"]:
                        continue        # คาบที่ขอเลี่ยง is a wish, and gives way
                    if not teacher_free(tid, day, gid, period):
                        continue
                    if not pair_free(req, day, period):
                        continue          # สอนร่วม: คู่สอนติดคาบอื่นอยู่
                    if attempt < 3 and not home_free(req, day, period):
                        continue          # เรียนที่ห้องของนักเรียน: ห้องไม่ว่าง
                    if attempt < 3 and not facility_free(req, day, period):
                        continue          # ต้องเรียนที่ห้องประจำวิชา: ห้องไม่ว่าง
                    if group_occupied(gid, day, period):
                        continue
                    run = run_if_placed(tid, gid, day, period)
                    # The run limit is a real rule and stays. "Next to lunch"
                    # is not: refusing it outright starved the one period that
                    # sits after lunch — 54% full against 97-100% everywhere
                    # else, with six classes free in it all week — so it is now
                    # only an ordering preference, applied in rank() above.
                    if attempt == 0 and run > consec_soft:
                        continue

                    # หนึ่งรหัสวิชา หนึ่งครั้งต่อวัน — a class should not sit
                    # through the same subject twice in one day.
                    #
                    # Held to the very last pass now, and held for every
                    # lesson, not only the single-period ones. The old rule
                    # let go at pass 4 of 5 and skipped anything whose subject
                    # is taught in pairs, which is how ม.4/10ก came out with
                    # ย31206 twice on a Tuesday: the leftover periods of a
                    # คาบคู่ subject were never asked the question at all.
                    #
                    # Released only on the final pass, because a subject with
                    # more periods a week than there are days has no other way
                    # to fit, and a lesson placed twice in a day still beats a
                    # lesson not placed at all.
                    # วิชาคาบคู่ไม่เคยผ่อนข้อนี้
                    #
                    # "ถ้ามี 3 คาบก็ไม่ให้สอนในวันเดียวกัน และถ้ามี 4 คาบก็แบ่ง
                    #  เป็น 2 คู่ ไม่ให้เรียนวันเดียวกัน"
                    #
                    # การผ่อนรอบสุดท้ายมีไว้สำหรับวิชาที่สัปดาห์ละหลายคาบจน
                    # ห้าวันไม่พอ ซึ่งเป็นคนละเรื่องกับวิชาคาบคู่ — คาบคู่
                    # สัปดาห์ละสี่คาบคือสองก้อน ห้าวันเหลือเฟือ ถ้าปล่อยให้ผ่อน
                    # เด็กจะได้วิชาเดียวกันสี่คาบรวดในวันเดียว
                    if ((attempt < 5 or is_double_subject(req.get("subject_id")))
                            and subj_day[(gid, req.get("subject_id"), day)] > 0):
                        continue

                    # Leave the teacher one of the two lunch shifts. Without
                    # this, spreading lessons into คาบ 4 and คาบ 5 quietly
                    # buys the coverage with somebody's lunch hour.
                    if attempt < 3 and not keeps_a_lunch(tid, gid, day, period):
                        continue

                    # Never let a teacher end up in the same period all five
                    # days. The ranking prefers the period they use least, but
                    # a preference only holds while nothing else is pulling:
                    # add a rule about buildings underneath it and the week
                    # quietly slides back into คาบ 2 every single day, which is
                    # the complaint that rule was meant to live alongside, not
                    # undo. Said outright here it cannot be traded away.
                    # The same hour over and over is the complaint; the last
                    # pass loosens the limit rather than dropping it, because
                    # an unlimited last resort is where every five-day column
                    # came from — the cells it could not fill earlier are
                    # exactly the ones it then filled all in one row.
                    if attempt < 4 and teacher_period[(tid, period)] >= (3 if attempt < 3 else 4):
                        continue
                    # The LAST period of the day is tighter still. Three days
                    # of คาบ 8 is a teacher who goes home late three times a
                    # week while somebody else never does, and the duty pass
                    # below only ever hands those cells OUT — nothing was
                    # counting how many one teacher had already collected.
                    # Kept even on the last pass, where the general limit is
                    # let go. Spread across the hours is a comfort; the last
                    # period is the one a teacher goes home on, and four of
                    # them is the complaint that started this. Three stands.
                    if (last_cap and period == last_num
                            and teacher_period[(tid, period)]
                                >= (max(1, last_cap - 1) if attempt < 3 else last_cap)):
                        continue
                    if attempt == 1 and run > consec_soft:
                        continue
                    if run > hard:
                        continue
                    slot = make_slot(req, day, period)
                    SLOTS.append(slot)
                    note_subject(gid, req.get("subject_id"), day)
                    book(tid, gid, day, period)
                    book_pair(req, day, period)
                    if period == last_num:
                        last_period_done[tid] += 1
                    placed += 1
                    taken = idx
                    break
                if taken < 0:
                    break           # nothing left this pass can take
                pool.pop(taken)
        return placed

    # ── ล็อกวัน/คาบไว้ = บังคับลงตรงนั้น ──────────────────────────────────────
    #
    # "วิชา ว30286 ได้ล็อคคาบเอาไว้ ทีนี้ฉันอยากให้เป็นการบังคับลงไปเลย"
    #
    # A pin is the school answering the question this program exists to ask.
    # It was being treated as a wish: if anything at all was sitting in that
    # cell the lesson was quietly reported as unplaced — and for a เซ็ต, ALL
    # of its subgroups with it. ม.4/6ข already had ว30286 locked into พฤหัส
    # คาบ 1 from an earlier run, so the เซ็ต that wanted exactly that hour
    # found the cell busy and ก and ค got nothing.
    #
    # Now the pin is taken. Three cases, in this order:
    #   · the SAME lesson is already there — it is adopted, not fought over.
    #     A lesson the school locked into the cell it asked for is the right
    #     answer already, and it keeps its lock.
    #   · an ordinary lesson is in the way — it is lifted out and re-placed
    #     later, the same way a คาบเสรี window takes its hour.
    #   · a คาบเสรี, a คาบกิจกรรม, or a lesson the school locked there itself
    #     stays. Two deliberate decisions about one cell is a question only
    #     the school can answer, so it is reported rather than guessed at.
    def free_teacher_for_pin(tid: int | None, gid: int, day: int, period: int) -> str:
        """ปลดครูให้ว่างในชั่วโมงที่ถูกล็อกไว้

        "ข้อมูลที่สร้างเงื่อนไขห้องนี้เป็นเงื่อนไขพิเศษ"

        A pinned hour is the school's own decision, and the lesson that most
        often stands in its way is not in that class's own column at all — it
        is the teacher, booked at that hour by some other class that the
        timetable filled in without knowing. ม.4/6ก's ครูศิรวิทย์ teaching
        somebody else at พุธ คาบ 7 is why ง31231 never appeared, while ข and
        ค sat down together in the hour that had been chosen for all three.

        So an ordinary lesson of another class is moved off that teacher's
        hour and given another one later. Anything the school decided itself —
        a locked lesson, a คาบเสรี, a คาบกิจกรรม, another เซ็ต — is left where
        it is and reported instead.
        """
        if not tid:
            return "free"
        bks = cell_buckets(gid, period)
        clash = [s for s in SLOTS
                 if s["day"] == day and s["group_id"] != gid
                 and tid in _slot_teachers(s)
                 and (cell_buckets(s["group_id"], s["period"]) & bks)]
        if not clash:
            return "free"
        kept = []
        for s in clash:
            if (_held(s) or s.get("is_elective")
                    or s.get("is_activity_block") or s.get("parallel_group_key")
                    or s.get("double_group_key")):
                kept.append(s)
                continue
            unbook(s.get("teacher_id"), s["group_id"], s["day"], s["period"],
                   s.get("room_id"))
            note_subject(s["group_id"], s.get("subject_id"), s["day"], -1)
            SLOTS.remove(s)
            owner = next((r for r in REQUIREMENTS
                          if r.get("group_id") == s.get("group_id")
                          and r.get("subject_id") == s.get("subject_id")
                          and r.get("teacher_id") == s.get("teacher_id")), None)
            if owner is not None:
                displaced.append(owner)
        return "blocked" if kept else "evicted"

    def force_pin_cell(gid: int, day: int, period: int, sid: int | None,
                       pgk: str | None = None) -> str:
        here = [s for s in SLOTS if s["group_id"] == gid
                and s["day"] == day and s["period"] == period]
        if not here:
            return "free"
        same = next((s for s in here if s.get("subject_id") == sid), None)
        if same is not None and len(here) == 1:
            if pgk and not same.get("parallel_group_key"):
                same["parallel_group_key"] = pgk
            return "adopted"
        kept = []
        for s in here:
            # A lesson the school locked, a คาบเสรี, a คาบกิจกรรม — and a
            # lesson of another เซ็ตห้องย่อย, which is a pinned arrangement of
            # its own and must not be taken apart to serve this one.
            if (_held(s) or s.get("is_elective")
                    or s.get("is_activity_block") or s.get("parallel_group_key")):
                kept.append(s)
                continue
            unbook(s.get("teacher_id"), s["group_id"], s["day"], s["period"],
                   s.get("room_id"))
            note_subject(s["group_id"], s.get("subject_id"), s["day"], -1)
            SLOTS.remove(s)
            # It owes its class a period again. Remembered so the repair pass
            # at the end gives it one somewhere else, rather than the lesson
            # simply vanishing to make room for the pinned one.
            owner = next((r for r in REQUIREMENTS
                          if r.get("group_id") == s.get("group_id")
                          and r.get("subject_id") == s.get("subject_id")
                          and r.get("teacher_id") == s.get("teacher_id")), None)
            if owner is not None:
                displaced.append(owner)
        return "blocked" if kept else "evicted"

    # ── Place parallel groups first (ห้องย่อย ก/ข/ค และวิชาคู่ขนาน) ──────────
    #
    # A เซ็ตห้องย่อย is the hardest thing in the timetable to place, and it was
    # being placed last. It needs ONE hour where the parent class is free (so
    # all its subgroups are), three different teachers are free, and three
    # rooms are free — all at once. ม.4/6 has eleven of those to fit into the
    # same thirty hours its own ordinary lessons are competing for.
    #
    # Ordinary lessons have thirty hours each and no such coupling, so they
    # fit around anything. Placed first, they took the hours the sets needed
    # and the sets were left with the gaps — which is why a set would come
    # out with two of its three subgroups placed and the third missing.
    #
    # Hardest first: the sets choose, then everything else fits around them.
    if parallel:
        _progress("กำลังลงเซ็ตห้องย่อย", done=0, total=len(parallel))
    for _i_set, (pgk, reqs) in enumerate(parallel.items()):
        _progress(done=_i_set, note=pgk.split(":")[-1])
        # ── คาบของแต่ละห้องย่อยไม่จำเป็นต้องเท่ากัน ──────────────────────────
        #
        # "ห้อง ข ต้องเรียนวิชาหนึ่ง 3 คาบ ซึ่งไม่เหมือนอีกห้องที่ต้องเรียน
        #  สามวิชาถึงได้ชั่วโมงเท่ากับห้อง ข"
        #
        # ม.4/6ข does ค31218 for three periods while ม.4/6ก does ท30214 for
        # two and fills its third hour with something else entirely. The set
        # says WHEN they sit down together; it does not say they all study
        # for the same number of hours.
        #
        # Taking the largest count and giving it to everyone — which is what
        # this did — hands ม.4/6ก a third period of a two-period subject, and
        # the school then has to go and change the subject's real hours to
        # make the set stop doing it. So each row owes what its own plan says,
        # the set runs for as long as the longest of them, and a row that has
        # had its hours simply sits out the rest.
        owed = {}
        for i, r in enumerate(reqs):
            done = sum(1 for s in SLOTS if s.get("parallel_group_key") == pgk
                       and s["group_id"] == r["group_id"]
                       and s.get("subject_id") == r.get("subject_id"))
            owed[i] = max(0, (r.get("weekly_count") or 0) - done)
        max_weekly = max(r["weekly_count"] for r in reqs)
        already    = sum(1 for s in SLOTS if s.get("parallel_group_key") == pgk) // max(len(reqs), 1)
        needed     = max(owed.values()) if owed else 0
        # A เซ็ต marked คาบคู่ is at least one pair: "ศุกร์ คาบ 3-4" written
        # with 1 คาบ/สัปดาห์ means one block of two, not a single period.
        if already == 0 and any(r.get("pinned_double") for r in reqs):
            for i in owed:
                if owed[i] == 1:
                    owed[i] = 2
            needed = max(owed.values()) if owed else 0
        # If any subject in the block is a double-period subject, place as pairs.
        # คาบคู่: either the subject is always taught in pairs, or this เซ็ต
        # was written down as one — "ศุกร์ คาบ 3-4" is a property of the
        # arrangement, not of the subject, and the school writes it per set.
        is_double  = (any((s_map.get(r["subject_id"], {}).get("duration", 1) or 1) == 2
                          for r in reqs)
                      or any(r.get("pinned_double") for r in reqs))

        # Detect same-teacher assignment (warn but still try). Not for a
        # sibling merge: one teacher taking both halves of a class at once is
        # the whole point of it, and the two halves sit in one room together.
        # Rows still waiting for a teacher are not "the same teacher twice".
        # Two rows with one teacher and ONE subject are that teacher taking the
        # two subgroups together — the school's "ม.4/6ขค". Only two different
        # subjects in one hour would actually need them in two places.
        teacher_subjects = [(r["teacher_id"], r.get("subject_id"))
                            for r in reqs if r.get("teacher_id")]
        teacher_ids = [t for t, _s in set(teacher_subjects)]
        if pgk not in merged_keys and len(set(teacher_ids)) < len(teacher_ids):
            violations.append(
                f"[{pgk}] ครูคนเดียวสอนหลายห้องพร้อมกันไม่ได้ "
                f"กรุณาตั้งครูคนละคนสำหรับแต่ละห้อง"
            )

        def live_rows(n: int = 1) -> list[dict]:
            """The rows that still owe at least n more periods of this set."""
            return [r for i, r in enumerate(reqs) if owed[i] >= n]

        def usable_rows(rows, cells_to_use):
            """Which of these rows can actually take this hour.

            Unpinned, the answer has to be all of them: the whole point of a
            เซ็ต is that the subgroups sit down together, and if one cannot
            make this hour there is another hour to go and look for.

            Pinned, there is no other hour. The school has named it. One
            subgroup's teacher being busy elsewhere then took the entire set
            down with it — ม.4/6ก's ครูศิรวิทย์ teaching another class at
            พุธ คาบ 7 meant ข and ค got nothing either, and the hour the
            school had chosen stood empty for two of the three. So the ones
            who can make it are seated, together, and the one who cannot is
            reported — which is the question the school has to answer anyway,
            and it can now answer it with the rest of the set already in place.
            """
            if pinned is None:
                return rows if all_free(cells_to_use, rows) else []
            return [r for r in rows if all_free(cells_to_use, [r])]

        def all_free(periods_to_check, rows=None):
            for day_, per_ in periods_to_check:
                for r in (reqs if rows is None else rows):
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

        merged = pgk in merged_keys

        def place_block(day_, periods_to_fill, rows=None):
            # Only the rows that still owe periods take part — the others have
            # had their hours and sit this one out (see owed above).
            rows = reqs if rows is None else rows
            # A block of two is one lesson, and each class's two halves have
            # to say so — otherwise the grid draws them as two cards, and
            # anything that moves or clears a cell can take half the lesson
            # away. One key per class, since each sits in its own room.
            dkeys = {r["group_id"]: f"DBL-{_next('slot')}"
                     for r in rows} if len(periods_to_fill) > 1 else {}
            # ห้องย่อยที่เรียนวิชาเดียวกันกับครูคนเดียวกัน = ห้องเดียวกัน.
            #
            # ม.4/6ข and ม.4/6ค both doing ค31218 with ครูศศิกัลป์ are one
            # roomful, not two: the teacher cannot be in two places, so the
            # school meant them together. ม.4/6ก, doing a different subject in
            # the same hour, is beside them in its own room as usual — so this
            # is decided per pair of (วิชา, ครู), not for the whole set.
            together = {}
            for r_ in rows:
                if r_.get("teacher_id"):
                    together.setdefault(
                        (r_.get("subject_id"), r_["teacher_id"]), []).append(r_)
            shares = {k for k, v in together.items() if len(v) > 1}
            for i, per_ in enumerate(periods_to_fill):
                room_of: dict[tuple, tuple] = {}
                booked: set[tuple] = set()
                for req in rows:
                    slot = make_slot(req, day_, per_)
                    pair = (req.get("subject_id"), req.get("teacher_id"))
                    shared = pair in shares
                    if shared:
                        if pair in room_of and (req["group_id"], day_, per_) in pick_at:
                            # The school picked a ลาน for this subgroup's hour.
                            # It stays where it was put; _merge_sibling_rooms
                            # brings the rest of the roomful to it at the end.
                            pass
                        elif pair in room_of:
                            # Same room as the sibling it sits with. Released
                            # properly, so the room make_slot had picked for
                            # this one does not stay held by nobody.
                            hold_room(slot, room_of[pair][0])
                        else:
                            room_of[pair] = (slot.get("room_id"), slot.get("room_name"),
                                             slot.get("room_type"))
                    if len(periods_to_fill) > 1:
                        slot["double_group_key"] = dkeys.get(req["group_id"])
                        slot["is_double_start"] = i == 0
                        slot["is_double_cont"] = i > 0
                    SLOTS.append(slot)
                    note_subject(req["group_id"], req.get("subject_id"), day_)
                    # One lesson for the teacher however many halves are in
                    # the room: booking them twice counts the same hour twice
                    # against their run of back-to-back periods.
                    if shared and pair in booked:
                        group_busy.add((req["group_id"], day_, per_))
                        class_period_load[(req["group_id"], per_)] += 1
                    else:
                        book(req["teacher_id"], req["group_id"], day_, per_)
                        book_pair(req, day_, per_)
                        booked.add(pair)

        placed = 0
        created_here = 0
        # ล็อกวัน/คาบไว้ทั้งเซ็ต — every row of a เซ็ตห้องย่อย carries the
        # same pin, because they are one hour by definition. With it set,
        # there is nothing to search for.
        pinned = next(((r.get("pinned_day"), r.get("pinned_period")) for r in reqs
                       if r.get("pinned_day") is not None
                       and r.get("pinned_period") is not None), None)
        # ล็อกไว้แล้ว = บังคับลงตรงนั้น. Clear the hour for every subgroup of
        # the set before asking whether it is free, so one class's leftover
        # lesson cannot take the whole set down with it.
        if pinned is not None:
            pin_d, pin_p = int(pinned[0]), int(pinned[1])
            cells_to_clear = [(pin_d, pin_p)]
            if is_double or any(r.get("pinned_double") for r in reqs):
                nxt = _next_class_period_for(
                    _level_key(g_map.get(reqs[0]["group_id"])), pin_p)
                if nxt is not None and max(owed.values(), default=0) >= 2:
                    cells_to_clear.append((pin_d, nxt))
            for i, r in enumerate(reqs):
                for cd, cp in cells_to_clear:
                    what = force_pin_cell(r["group_id"], cd, cp,
                                          r.get("subject_id"), pgk)
                    # …and the teacher's own hour, which is where the real
                    # obstacle usually is: another class holding them at the
                    # very hour this set was promised.
                    held = free_teacher_for_pin(r.get("teacher_id"),
                                                r["group_id"], cd, cp)
                    if what == "adopted":
                        owed[i] = max(0, owed[i] - 1)
                    elif held == "blocked" and what != "blocked":
                        violations.append(
                            f"[{pgk}] ครู {(t_map.get(r.get('teacher_id')) or {}).get('name', '')} "
                            f"ติดคาบที่ล็อกไว้หรือคาบเสรีของห้องอื่นในชั่วโมงนี้ "
                            f"— ต้องปลดคาบนั้นก่อน หรือเปลี่ยนครูของแถวนี้")
                    elif what == "blocked":
                        violations.append(
                            f"[{pgk}] {(g_map.get(r['group_id']) or {}).get('name', r['group_id'])} "
                            f"มีคาบที่ล็อกไว้หรือคาบเสรีอยู่ในวัน/คาบที่เซ็ตนี้ล็อกไว้แล้ว "
                            f"— ต้องปลดคาบนั้นก่อน หรือย้ายเซ็ตไปคาบอื่น")
            needed = max(owed.values()) if owed else 0
        if is_double and needed >= 2:
            pairs = needed // 2
            lead_lvl = _level_key(g_map.get(reqs[0]["group_id"]))
            # ล็อกเวลาไว้ = ชั่วโมงนั้นชั่วโมงเดียว, คาบสุดท้ายหรือไม่ก็ตาม —
            # โรงเรียนเลือกเอง by_tail จึงไม่แตะ
            cells = (by_tail(double_starts(reqs[0]["group_id"]), lead_lvl, pair=True)
                     if pinned is None else [(int(pinned[0]), int(pinned[1]))])
            cells = allow_days_many(cells, {r.get("subject_id") for r in reqs})
            # หนึ่งรหัสวิชา หนึ่งครั้งต่อวัน, here too. This loop never asked,
            # so a เซ็ต of two คาบคู่ could put both of them on one day —
            # ม.4/10ก sat through ย31206 for four periods of one Tuesday.
            # Tried first with the rule on, then again without, so a set that
            # genuinely cannot spread any further is still placed.
            for spread in (True, False):
                if pairs <= 0:
                    break
                for day, p in cells:
                    if pairs <= 0:
                        break
                    rows = live_rows(2)      # a pair costs two of a row's hours
                    if not rows:
                        break
                    if spread and any(subj_day[(r["group_id"], r.get("subject_id"), day)] > 0
                                      for r in rows):
                        continue
                    p2 = _next_class_period_for(lead_lvl, p)
                    if p2 is None:
                        continue
                    rows = usable_rows(rows, [(day, p), (day, p2)])
                    if not rows:
                        continue
                    place_block(day, [p, p2], rows)
                    alive = {id(x) for x in rows}
                    for i, r in enumerate(reqs):
                        if id(r) in alive:
                            owed[i] -= 2
                    created_here += 2 * len(rows)
                    placed       += 2
                    pairs        -= 1

        # Remaining single periods
        remaining = needed - placed
        if remaining > 0:
            cells = (by_tail(cells_for(reqs[0]["group_id"]),
                             _level_key(g_map.get(reqs[0]["group_id"])))
                     if pinned is None else [(int(pinned[0]), int(pinned[1]))])
            cells = allow_days_many(cells, {r.get("subject_id") for r in reqs})

            def already_today(day_: int) -> bool:
                return any(subj_day[(r["group_id"], r.get("subject_id"), day_)] > 0
                           for r in live_rows())

            # Same rule as an ordinary lesson: one period of the subject a day
            # for every class in the block. Tried first with the rule on and
            # again with it off, so a subject that cannot spread any further
            # still gets placed rather than being dropped.
            for spread in (True, False):
                for day, period in cells:
                    if remaining <= 0:
                        break
                    rows = live_rows()
                    if not rows:
                        remaining = 0
                        break
                    if spread and already_today(day):
                        continue
                    rows = usable_rows(rows, [(day, period)])
                    if not rows:
                        continue
                    place_block(day, [period], rows)
                    alive = {id(x) for x in rows}
                    for i, r in enumerate(reqs):
                        if id(r) in alive:
                            owed[i] -= 1
                    created_here += len(rows)
                    placed       += 1
                    remaining    -= 1
                if remaining <= 0:
                    break

        created += created_here

        # Reported per subgroup now, because they no longer stand or fall
        # together: naming the one that could not make the hour, and why, is
        # what the school needs in order to fix it.
        short_now = [(i, r) for i, r in enumerate(reqs) if owed[i] > 0]
        if short_now:
            def why(r, i):
                if pinned is None:
                    return "หาชั่วโมงที่ทุกห้องย่อยว่างพร้อมกันไม่ได้"
                d, pr = int(pinned[0]), int(pinned[1])
                if not r.get("teacher_id"):
                    return "ยังไม่ได้เลือกครู"
                if not teacher_free(r["teacher_id"], d, r["group_id"], pr):
                    # Their own lesson, just seated in this very hour, is not
                    # what is stopping them.
                    clash = next((x for x in SLOTS
                                  if x["day"] == d and x["period"] == pr
                                  and r["teacher_id"] in _slot_teachers(x)
                                  and x["group_id"] != r["group_id"]), None)
                    if clash is None:
                        return "ชั่วโมงที่ล็อกไว้ไม่พอกับจำนวนคาบที่ตั้งไว้"
                    where = (g_map.get(clash["group_id"], {}) or {}).get("name") if clash else None
                    return ("ครู " + (t_map.get(r["teacher_id"], {}) or {}).get("name", "")
                            + " ติดสอน" + (f" {where}" if where else "ห้องอื่น") + " ในคาบนี้")
                if group_occupied(r["group_id"], d, pr):
                    return "ห้องย่อยนี้มีคาบอื่นอยู่ในชั่วโมงนี้แล้ว"
                if run_if_placed(r["teacher_id"], r["group_id"], d, pr) > _consec_limit(
                        t_map.get(r["teacher_id"]), consec_hard):
                    return "จะทำให้ครูสอนติดกันเกินเพดาน"
                return "ชั่วโมงที่ล็อกไว้ไม่พอกับจำนวนคาบที่ตั้งไว้"
            name = pgk.split(":")[-1]
            for i, r in short_now:
                violations.append(
                    f"[{name}] {(g_map.get(r['group_id']) or {}).get('name', r['group_id'])} "
                    f"ยังขาด {owed[i]} คาบ — {why(r, i)}")


    # ── Place solo requirements ──
    #
    # คาบคู่ first. A double needs two free periods in a row AND one room that
    # is free for both of them; by the time the singles have taken their pick
    # there may be no such pair left, and the double breaks into two halves in
    # two rooms. Everything else can fit around them afterwards.
    #
    # Then the order the school asked for, and it is the order a person would
    # use: hardest first. A lesson that can only happen in one of five labs
    # has far fewer places to go than a lesson that fits any classroom, and
    # whoever books last gets what is left — which is how science lessons
    # ended up in ordinary rooms with the labs still half empty. So:
    #
    #   1. lessons that need a facility (ห้องพิเศษ) — fill those rooms first
    #   2. classes that have a room of their own — seat them in it
    #   3. everything else, which can go anywhere
    # ครูที่โรงเรียน "กันห้องไว้ให้" ที่หน้าห้องสอน
    #
    # เฉพาะช่องนั้นช่องเดียว ไม่รวม "ห้องประจำของครู" ที่ตั้งจากหน้าครู ซึ่งเป็น
    # คนละการตั้งค่า (ตาม teacher_room_over_homeroom) — ถ้ารวมเข้ามา โรงเรียนที่
    # ตั้งแต่ห้องประจำของครูไว้และไม่ได้กันห้องไว้ให้ใครเลย จะถูกสลับลำดับการลง
    # คาบด้วยฟีเจอร์เรื่องห้องที่กันไว้ ซึ่งไม่เกี่ยวกันเลย
    #
    # และปิดตามการตั้งค่าเดียวกัน เพื่อให้การติ๊กออกคืนตารางเดิมได้จริง
    room_owners: set[int] = set()
    if _upper_teacher_room_first():
        for _r in ROOMS:
            room_owners |= room_reserved_for(_r)

    def place_order(r: dict) -> tuple:
        subj = s_map.get(r["subject_id"], {}) or {}
        grp  = g_map.get(r["group_id"], {}) or {}
        # A teacher who is off on Fridays has four days to fit a week into,
        # and วันที่ไม่สอน is now a hard rule — so their lessons are placed
        # while there is still room, rather than being handed whatever is
        # left and reported as unplaceable.
        tp = _teacher_prefs(t_map.get(r["teacher_id"]))
        # วันที่วิชาห้ามเรียนบีบพื้นที่แบบเดียวกับวันที่ครูไม่มาสอน — พละที่ห้าม
        # วันพฤหัสเหลือสี่วันให้ลง เท่ากับครูที่หยุดวันศุกร์
        tight = (len(tp["days_off"]) + len(_subject_blocked_days(subj))
                 + (1 if tp["avoid_periods"] else 0))
        return (
            # ล็อกวัน/คาบไว้ = ไม่มีอะไรให้เลือกเลย. Placed before anything
            # else, so the cell it names is still empty when it gets there —
            # otherwise it has to turn an ordinary lesson out of the cell and
            # that lesson has to be found somewhere else to go.
            0 if (r.get("pinned_day") is not None
                  and r.get("pinned_period") is not None) else 1,
            0 if subj.get("duration") == 2 else 1,   # คาบคู่ still first
            -tight,                                  # the most constrained next
            0 if needs_facility(r) else 1,
            # ม.ต้นเลือกก่อน ม.ปลาย
            #
            # "ห้องของครูบางคนที่มีห้องประจำ ให้เต็มก่อนสำหรับ ม.ต้น แล้วถ้ามี
            #  คาบว่างค่อยให้พี่ๆ ม.ปลายมาใช้ห้อง … ม.ต้นไม่ควรที่จะมีปัญหาใน
            #  การลงคาบ ฉันควรจะได้แก้ปัญหาสำหรับ ม.ปลายเป็นหลัก"
            #
            # ใครลงก่อนได้เลือกก่อน ทั้งเรื่องห้องและเรื่องชั่วโมง การวางลำดับ
            # ตรงนี้จึงเป็นวิธีที่ตรงที่สุดที่จะทำให้ส่วนที่เหลือไปตกกับ ม.ปลาย
            # ซึ่งเป็นฝั่งที่โรงเรียนบอกว่าจะแก้มือเอง
            #
            # วัดบนข้อมูลที่มีแล้วขยับน้อยมาก (คาบไม่มีห้อง 50 -> 48) เพราะใน
            # สำเนานี้ ม.ต้นไม่ได้กำลังแพ้การแย่งห้องอยู่แล้ว เก็บไว้เพราะเป็น
            # ลำดับที่โรงเรียนสั่ง และวัดแล้วว่าไม่ได้ทำให้แย่ลง
            0 if _level_key(grp) == "lower" else 1,
            # ครูที่โรงเรียนกันห้องไว้ให้ ได้เลือกก่อนลูกหมวดในกลุ่มสาระเดียวกัน
            #
            # "เน้นให้ครูที่สำคัญมีห้องสอนก่อนแล้วค่อยเติมลูกหมวดเข้าไป"
            #
            # ลูกหมวดใช้ห้องของกลุ่มสาระได้เหมือนกัน และใครลงก่อนได้เลือกก่อน
            # — เรียงไว้แบบนี้ ชั่วโมงที่เจ้าของต้องการจึงยังว่างเมื่อถึงคิวเขา
            # แล้วที่เหลือค่อยตกเป็นของลูกหมวด ซึ่งเป็นลำดับที่โรงเรียนสั่ง
            0 if r["teacher_id"] in room_owners else 1,
            0 if grp.get("homeroom_room_id") else 1,
        )

    solo.sort(key=place_order)
    # จำนวนคาบที่แผนการสอนขอไว้ทั้งหมด — ตัวหารของเปอร์เซ็นต์ที่หน้าจอแสดง
    _want_total = sum(r.get("weekly_count") or 0 for r in solo)
    _progress("กำลังลงคาบ", done=0, total=_want_total,
              note=f"{len(solo)} รายการในแผนการสอน")
    for _i_req, req in enumerate(solo):
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
            #
            # Three passes, and the third exists because of ว32202: four
            # periods a week is two doubles, and when only one of them fitted
            # the other two periods fell through to the singles pass and were
            # placed apart — the school saw "a คาบคู่ with its partner
            # missing". Trying the pair once more, with the one-a-day rule
            # lifted, keeps it a pair.
            for attempt in range(3):
                if pairs_needed <= 0:
                    break
                cells = allow_days(by_tail(double_starts(gid), lvl, pair=True),
                                   req.get("subject_id"))
                for day, p in cells:
                    if pairs_needed <= 0:
                        break
                    p2 = _next_class_period_for(lvl, p)
                    if p2 is None:
                        continue
                    # Two doubles of one subject belong on two different days:
                    # a class sitting through four periods of ฟิสิกส์ on one
                    # Thursday is the timetable nobody wants, and nothing was
                    # stopping it — the one-a-day rule was only ever applied
                    # to single periods.
                    # เดิมปล่อยกฎนี้ในรอบที่สาม ซึ่งเป็นรอบที่ทำให้สองคาบคู่
                    # ของวิชาเดียวกันมาอยู่วันเดียวกันได้จริง โรงเรียนบอกชัดว่า
                    # ไม่เอา จึงไม่ปล่อยอีกต่อไป ก้อนที่ลงไม่ได้จะถูกรายงานแทน
                    if subj_day[(gid, req.get("subject_id"), day)] > 0:
                        continue      # สองคาบคู่ของวิชาเดียวกัน คนละวัน
                    # วันที่ไม่สอน, here too: the double loop never asked, so a
                    # teacher's day off could be filled by a คาบคู่ whatever
                    # the single-period rules said.
                    if day in _teacher_prefs(t_map.get(tid))["days_off"]:
                        continue
                    if not pair_free(req, day, p) or not pair_free(req, day, p2):
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
                    s1 = make_slot(req, day, p, also_period=p2)
                    # The two halves are one lesson, and they have to say so.
                    # Marked only with is_double_start, the pair was two
                    # ordinary lessons that happened to touch: the grid drew
                    # the 2x badge on one of them, and anything that moved or
                    # cleared a cell could take half the lesson away and leave
                    # the other half stranded — "คาบคู่มีคู่หนึ่งที่หายไป".
                    dkey = f"DBL-{s1['id']}"
                    s1["is_double_start"] = True
                    s1["double_group_key"] = dkey
                    # The second half stays put. find_room would be asked
                    # again and could answer differently — the first half has
                    # just booked the room, so the second would be told it is
                    # busy and sent somewhere else.
                    s2 = make_slot(req, day, p2,
                                   (s1.get("room_id"), s1.get("room_name"), s1.get("room_type")))
                    s2["double_group_key"] = dkey
                    s2["is_double_cont"] = True
                    SLOTS.append(s1); SLOTS.append(s2)
                    note_subject(gid, req.get("subject_id"), day, 2)
                    for pp in (p, p2):
                        book(tid, gid, day, pp)
                        book_pair(req, day, pp)
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
            short_rows.append((req, gid, tid, needed - placed, placed + already))

        # บอกความคืบหน้าทุกๆ 10 รายการ — ถี่กว่านี้ไม่ได้ช่วยให้คนอ่านรู้อะไร
        # เพิ่ม และการเขียน dict ทุกรอบในลูปที่วิ่งพันกว่ารอบก็ไม่ฟรี
        if _i_req % 10 == 0 or _i_req == len(solo) - 1:
            _progress(done=len(SLOTS),
                      note=f"{(g_map.get(gid) or {}).get('name', '')} "
                           f"{subj.get('code') or ''}".strip())

    _progress("กำลังขยับห้องให้คาบที่ยังลงไม่ได้", done=len(SLOTS))
    # ── ยังลงไม่ได้: กลับไปขยับห้อง แล้วลองใหม่ ───────────────────────────────
    #
    # "ถ้ายังไม่ได้ให้กลับไปเลื่อนห้องต่างๆให้ลงได้ หาเส้นทางเหมาะสมที่สุด"
    #
    # Everything that was going to fit has now fitted, and what is left is the
    # lessons that found every room they are allowed to use already occupied.
    # Most of those rooms are held by lessons with somewhere else to go. So
    # the same placement runs once more, this time allowed to move the
    # occupants along a chain (shuffle_for above) rather than give up.
    #
    # Last, not first: a chain only knows about rooms, so it would happily
    # walk a dozen classes into other people's rooms to save one lesson that
    # would have fitted on its own five minutes later. Tried at the end, every
    # move it makes is one that genuinely bought a lesson.
    if displaced:
        names = sorted({(g_map.get(r["group_id"]) or {}).get("name", "?")
                        for r in displaced})
        notes.append(
            f"ชั่วโมงที่ล็อกไว้เป็นเงื่อนไขพิเศษ — ย้ายคาบของห้องอื่นออกให้ "
            f"{len(displaced)} คาบ แล้วจัดใหม่ให้ที่อื่น "
            f"({', '.join(names[:5])}{' …' if len(names) > 5 else ''})")

    # Anything turned out of its cell by a pin is owed a period again.
    for req in displaced:
        gid, tid = req["group_id"], req["teacher_id"]
        want = req.get("weekly_count") or 0
        got = sum(1 for s in SLOTS
                  if s["group_id"] == gid and s.get("subject_id") == req["subject_id"])
        if got < want:
            short_rows.append((req, gid, tid, want - got, got))

    if short_rows:
        index_rooms()
        shuffle_on = True
        still_short, rescued = [], 0
        for req, gid, tid, missing, already in short_rows:
            got = place_single(req, gid, tid, missing)
            rescued += got
            if got < missing:
                still_short.append((req, gid, tid, missing - got, already + got))
        shuffle_on = False
        short_rows = still_short
        created += rescued
        rescued_by_shuffle = rescued

    for req, gid, tid, missing, done in short_rows:
        code = s_map.get(req["subject_id"], {}).get("code", "?")
        unplaced_ids.append(req["id"])
        # บอกห้องด้วย ไม่ใช่แค่รหัสวิชา
        #
        # "ไม่สามารถจัด ท21204 ครบ 2 คาบ (จัดได้ 1/2)" เป็นจริงแต่ทำอะไรต่อ
        # ไม่ได้ โรงเรียนมี 93 ห้อง และวิชาเดียวกันสอนหลายห้อง คนอ่านจึงไม่รู้
        # ว่าต้องไปเปิดห้องไหน และถ้าแถวนั้นอยู่ในเซ็ตห้องย่อย ก็ยิ่งหายาก
        # เพราะห้องย่อยไม่ได้อยู่ในรายการห้องปกติ
        #
        # เหตุผลรายคาบมีอยู่แล้วใน _unplaced_report — สิ่งที่ขาดคือป้ายบอกทาง
        # ไปหามัน
        who = (g_map.get(gid) or {}).get("name") or f"ห้อง #{gid}"
        key = req.get("parallel_group_key")
        in_set = ""
        if key:
            label = str(key).split(":")[-1] if ":" in str(key) else str(key)
            in_set = f" · อยู่ในเซ็ตห้องย่อย “{label}”"
        pinned = ""
        if req.get("pinned_day") is not None and req.get("pinned_period") is not None:
            d = int(req["pinned_day"])
            pinned = (f" · ล็อกเวลาไว้ที่ "
                      f"{_DAYS_TH[d] if 0 <= d < len(_DAYS_TH) else d} "
                      f"คาบ {req['pinned_period']}")
        violations.append(
            f"ไม่สามารถจัด {code} ของ {who} ครบ {req['weekly_count']} คาบ "
            f"(จัดได้ {done}/{req['weekly_count']}){in_set}{pinned}"
        )


    # ── เวรคาบสุดท้าย: a repair pass ──────────────────────────────────────────
    # Preferring the last period while placing gets most teachers there, but a
    # teacher whose lessons all happened to land early has no way back. So,
    # afterwards, look for one of their lessons that could simply move into a
    # free last period and move it. Nothing is created or deleted — a lesson
    # changes cell, and only if every rule still holds at the new one.
    # A lesson this pass is allowed to pick up and move.
    #
    # สอนร่วม is excluded for the same reason คู่ขนาน is: the cell holds two
    # people's time, and everything below — unbook, can_take, reseat — is
    # written around the one teacher_id. Moved by this pass, the partner went
    # with the lesson without anyone checking they were free, and their own
    # lessons then stacked up on the hour they had just been moved onto.
    # Spreading เวรคาบสุดท้าย is worth having, but not at that price.
    def swappable(x: dict) -> bool:
        return (not _held(x) and not x.get("is_elective")
                and not x.get("parallel_group_key")
                # A คาบคู่ is one lesson two periods long. Moving half of it
                # leaves the class packing up in the middle of its own double
                # — the "คาบคู่เหลือครึ่งเดียว" the school has reported before.
                # Both halves would have to travel together, and no pass here
                # does that, so neither touches one.
                and not x.get("double_group_key")
                and x.get("co_teacher_id") is None
                and not x.get("activity_teacher_ids")
                # An hour the school picked a ลาน for stays that hour: lifting
                # its lesson out would leave the ลาน empty and send the lesson
                # to an indoor room, which is the opposite of what was asked.
                and (x["group_id"], x["day"], x["period"]) not in pick_owned)

    def movable_of(tid: int) -> list[dict]:
        return [x for x in SLOTS if x.get("teacher_id") == tid and swappable(x)]

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
    # เวรคาบสุดท้าย shares out whatever lessons the last period holds. Asked to
    # keep that period clear, there is nothing left to share: spreading a duty
    # across the staff only makes sense when the duty exists. So the trade is
    # skipped, and the note about teachers who did not get one is skipped with
    # it — it would be a warning about the very thing the school asked for.
    for teacher in (TEACHERS if tail_mode == "free" else []):
        tid = teacher["id"]
        short = last_period_shortfall(tid)
        if short <= 0:
            continue
        mine = movable_of(tid)
        random.shuffle(mine)

        # เวรคาบสุดท้าย is settled by TRADING, never by adding a lesson to the
        # end of the day.
        #
        # There used to be an easier pass before this one: find a free cell in
        # the last period and move one of the teacher's lessons into it. It
        # worked — and it fired 82 times on the school's own data, which means
        # it took 82 classes that had finished early and gave them one more
        # period, purely so an adult could tick a box. The school's rule is
        # that the students' day comes first and a teacher without a last
        # period is no great matter, so that pass is gone.
        #
        # What is left changes nothing for any class. Take a class this teacher
        # already teaches, find whoever has that class's last period, and
        # exchange the two lessons: the same cell stays filled, the same class
        # goes home at the same time, and only the name in it changes. Both
        # teachers must end up legal, and the other must not be left short of
        # their own duty.
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
                              and swappable(x)), None)
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

    # ── วิชาเดียวกันซ้ำวันเดียวกัน: ย้ายไปวันอื่น ────────────────────────────
    #
    # "ไม่ให้รหัสเดียวเรียนในวันเดียวกัน"
    #
    # The placement rules hold this as hard as they can, but a lesson placed
    # near the end has only the cells nobody else wanted, and sometimes every
    # one of them is on a day the class already has that subject. By then the
    # week is full and there is nothing more the placer can do about it.
    #
    # Afterwards there is: the rest of the week has been arranged, so a cell
    # on another day may well have come free. This looks at every subject a
    # class has twice in one day and tries to move the second one — first to
    # a free cell on a day the subject is not on yet, then by trading places
    # with one of the class's own lessons from such a day. Nothing is created
    # or lost; a lesson changes cell, and only if every rule still holds there.
    dup_moved = 0
    dup_swapped = 0

    def day_of_subject(gid: int, sid: int) -> set[int]:
        return {x["day"] for x in SLOTS
                if x["group_id"] == gid and x.get("subject_id") == sid}

    def lift(x: dict) -> None:
        unbook(x["teacher_id"], x["group_id"], x["day"], x["period"], x.get("room_id"))
        note_subject(x["group_id"], x.get("subject_id"), x["day"], -1)

    def drop(x: dict, day: int, period: int) -> None:
        reseat(x, day, period)
        note_subject(x["group_id"], x.get("subject_id"), day)

    repeats: dict[tuple, list] = defaultdict(list)
    for x in SLOTS:
        if x.get("subject_id") is not None and swappable(x):
            repeats[(x["group_id"], x["subject_id"], x["day"])].append(x)
    for (gid, sid, day), group in sorted(repeats.items(), key=lambda kv: kv[0][:2]):
        if len(group) < 2:
            continue
        lvl = _level_key(g_map.get(gid))
        nums = _class_periods_for_level(lvl)
        for x in group[1:]:
            teacher = t_map.get(x["teacher_id"])
            if not teacher:
                continue
            used = day_of_subject(gid, sid)
            home_day, home_period = x["day"], x["period"]
            lift(x)
            moved = False
            # 1. a free cell on a day this class does not have the subject
            cells = allow_days([(d, p) for d in range(5) for p in nums
                                if d not in used], sid)
            random.shuffle(cells)
            for d, pr in cells:
                if group_occupied(gid, d, pr) or not can_take(teacher, gid, d, pr):
                    continue
                drop(x, d, pr)
                dup_moved += 1
                moved = True
                break
            if moved:
                continue
            # 2. trade with one of the class's own lessons on such a day
            others = [y for y in SLOTS
                      if y["group_id"] == gid and y is not x and swappable(y)
                      and y["day"] not in used
                      and y.get("subject_id") != sid]
            random.shuffle(others)
            for y in others:
                y_teacher = t_map.get(y["teacher_id"])
                if not y_teacher:
                    continue
                d, pr = y["day"], y["period"]
                lift(y)
                # The two must be able to stand in each other's cell, and the
                # lesson coming back must not itself land on a day its class
                # already studies that subject — one repeat traded for another
                # is no trade at all.
                # การแลกย้ายทั้งสองฝั่ง ทั้งสองฝั่งจึงต้องไม่ตกวันที่วิชาของ
                # ตัวเองห้ามเรียน — ตรวจแค่ฝั่งเดียวคือเปิดรูไว้อีกฝั่ง
                if (can_take(teacher, gid, d, pr)
                        and can_take(y_teacher, gid, home_day, home_period)
                        and d not in blocked_days_of(sid)
                        and home_day not in blocked_days_of(y.get("subject_id"))
                        and subj_day[(gid, y.get("subject_id"), home_day)] == 0):
                    drop(x, d, pr)
                    drop(y, home_day, home_period)
                    dup_swapped += 1
                    moved = True
                    break
                drop(y, d, pr)          # put it back, try the next one
            if not moved:
                drop(x, home_day, home_period)   # nothing better — leave it
    if dup_moved or dup_swapped:
        notes.append(
            f"ย้ายวิชาที่ซ้ำวันเดียวกันออกไปวันอื่น {dup_moved + dup_swapped} คาบ"
            f"{f' (สลับที่กับคาบอื่น {dup_swapped})' if dup_swapped else ''}"
        )

    # ── คาบสุดท้ายของวัน: ดึงที่ลงไว้แล้วกลับลงมา ─────────────────────────────
    #
    # "ช่วยทำให้ไม่มีคาบ 9 เลย เพราะยังมีคาบว่างอยู่"
    #
    # The ordering rules keep the last period for last, but they decide one
    # lesson at a time and cannot see the week that comes after. A lesson
    # seated in คาบ 9 early on — when คาบ 1 was still held by something that
    # has since moved — then stays there for no reason at all.
    #
    # This is the pass that goes back and looks. Every lesson sitting in the
    # last period is offered the class's free cells earlier in the week and
    # takes one if every rule still holds there: the teacher free and willing,
    # a room free, the run not too long, and the class not already studying
    # that subject that day. Failing that it offers to trade places with one
    # of the class's own earlier lessons. Rooms may be chained, as they are
    # during placement, so "the only free cell has no room" is not the end of
    # it either.
    #
    # Nothing is created, nothing is lost, and nothing NEW lands in the last
    # period. A lesson with nowhere earlier to go stays where it is: that
    # class genuinely has more lessons than the rest of the day can hold,
    # which is the one case the school accepts a last period for.
    # Moving a lesson that is already seated takes the same three steps every
    # time — lift it, find it a room where it is going, put it down — and two
    # passes below do it, so they are written once here.
    index_rooms()
    pinned_pairs = {(r["group_id"], r.get("subject_id")) for r in REQUIREMENTS
                    if r.get("pinned_day") is not None
                    and r.get("pinned_period") is not None}
    req_room = {(r["group_id"], r.get("subject_id"), r.get("teacher_id")):
                r.get("room_id")
                for r in REQUIREMENTS if r.get("room_id")}

    def can_leave(x: dict) -> bool:
        """May this lesson be moved out of the cell it is in?

        The school's own decisions stay where the school put them: a locked
        lesson, คาบเสรี, กิจกรรม, a เซ็ตห้องย่อย (every subgroup would have to
        travel together) and anything pinned to an hour.
        """
        return (not _held(x) and not x.get("is_elective")
                and not x.get("is_activity_block")
                and not x.get("parallel_group_key")
                and x.get("co_teacher_id") is None
                and not x.get("activity_teacher_ids")
                and bool(x.get("teacher_id"))
                and t_map.get(x["teacher_id"]) is not None
                and (x["group_id"], x.get("subject_id")) not in pinned_pairs
                # …nor out of an hour the school picked a ลาน for (see swappable).
                and (x["group_id"], x["day"], x["period"]) not in pick_owned)

    def proper_rooms(x: dict) -> set[int]:
        """ห้องที่วิชานี้ควรอยู่ — ห้องประจำวิชา หรือห้องของกลุ่มสาระนั้น"""
        subj = s_map.get(x.get("subject_id")) or {}
        ids = set(_subject_rooms(subj))
        dept = subj.get("department_id")
        if dept:
            ids |= {r["id"] for r in ROOMS if r.get("specialized_dept_id") == dept}
        return ids

    def room_for(x: dict, day: int, period: int, also: int | None = None,
                 was: int | None = None):
        """A room for this lesson at this cell, chaining if need be.

        Asked only once every other rule has said yes, because a chain that
        succeeds leaves other lessons in new rooms — worth doing for a move
        that will happen, not for one that is about to be refused.

        A lesson that is already in the room it belongs in — a lab, a computer
        room, a ห้องประจำวิชา — will not be moved into one it does not. Tidying
        the students' week is worth having; it is not worth walking ฟิสิกส์
        out of the physics lab to get it, which is what the gap-filling pass
        was quietly doing (ten lessons of one subject left their labs).
        """
        pin = req_room.get((x["group_id"], x.get("subject_id"), x.get("teacher_id")))
        want = proper_rooms(x)
        # `was` because the lesson has been lifted out by now and its room
        # released — x itself no longer remembers where it was sitting.
        home = was if was is not None else x.get("room_id")
        rid, _n, _t = find_room(x["teacher_id"], day, period, x.get("subject_id"),
                                x["group_id"], also, None, pin)
        if not rid:
            rid = shuffle_for(x["teacher_id"], x["group_id"], x.get("subject_id"),
                              day, period, also, pin)
        if rid and home in want and rid not in want:
            return None
        return rid

    def pull(x: dict) -> tuple:
        """Lift the lesson out of its cell, remembering where it sat."""
        home = (x["day"], x["period"], x.get("room_id"))
        hold_room(x, None)
        lift(x)
        return home

    def seat(x: dict, day: int, period: int, rid: int | None) -> None:
        x["day"], x["period"] = day, period
        hold_room(x, rid)
        book(x["teacher_id"], x["group_id"], day, period)
        note_subject(x["group_id"], x.get("subject_id"), day)

    drained = 0
    drained_pairs = 0
    if tail_mode != "free":
        _progress("กำลังย้ายคาบออกจากคาบสุดท้ายของวัน", done=len(SLOTS))

        def tail_total() -> int:
            return sum(1 for x in SLOTS
                       if x["period"] == _last_period_for(
                           _level_key(g_map.get(x["group_id"]))))

        def drain_round() -> int:
            moved_here = 0
            # The tail half of a คาบคู่ is dealt with as the pair it belongs
            # to, so a double beginning one period before the end travels
            # whole or not at all.
            for s in sorted(list(SLOTS),
                            key=lambda x: (x["group_id"], x["day"], x["period"])):
                lvl  = _level_key(g_map.get(s["group_id"]))
                last = _last_period_for(lvl)
                if last is None or s["period"] != last or not can_leave(s):
                    continue
                gid, tid = s["group_id"], s["teacher_id"]
                teacher  = t_map.get(tid)
                sid      = s.get("subject_id")
                nums     = [p for p in _class_periods_for_level(lvl) if p != last]

                if s.get("double_group_key"):
                    pair = [x for x in SLOTS
                            if x.get("double_group_key") == s["double_group_key"]]
                    if len(pair) != 2 or any(not can_leave(x) for x in pair):
                        continue
                    pair.sort(key=lambda x: x["period"])
                    head, tailh = pair
                    homes = [pull(x) for x in pair]
                    starts = allow_days([(d, p) for d in range(5) for p in nums
                                         if _next_class_period_for(lvl, p) in nums], sid)
                    random.shuffle(starts)
                    moved = False
                    for d, p in starts:
                        p2 = _next_class_period_for(lvl, p)
                        if subj_day[(gid, sid, d)] > 0:
                            continue
                        if group_occupied(gid, d, p) or group_occupied(gid, d, p2):
                            continue
                        if not can_take(teacher, gid, d, p) or not can_take(teacher, gid, d, p2):
                            continue
                        rid = room_for(head, d, p, p2, homes[0][2])
                        if not rid and homes[0][2]:
                            continue
                        # Both halves of a คาบคู่ sit in the one room.
                        seat(head, d, p, rid)
                        seat(tailh, d, p2, rid)
                        pairs_moved[0] += 1
                        moved_here += 2
                        moved = True
                        break
                    if not moved:
                        for x, home in zip(pair, homes):
                            seat(x, home[0], home[1], home[2])
                    continue

                if not swappable(s):
                    continue
                home = pull(s)
                cells = allow_days([(d, p) for d in range(5) for p in nums], sid)
                random.shuffle(cells)
                moved = False
                for d, p in cells:
                    if subj_day[(gid, sid, d)] > 0 or group_occupied(gid, d, p):
                        continue
                    if not can_take(teacher, gid, d, p):
                        continue
                    rid = room_for(s, d, p, None, home[2])
                    if not rid and home[2]:
                        continue
                    seat(s, d, p, rid)
                    moved_here += 1
                    moved = True
                    break
                if moved:
                    continue
                # Nowhere this lesson itself can go — so move somebody else
                # out of the way and take THEIR cell.
                #
                # Two steps, never one. A straight trade with an earlier
                # lesson would simply put that lesson at the end of the day
                # instead: the class finishes just as late, with a different
                # subject. What actually empties the cell is finding a lesson
                # of this class that CAN reach one of the free hours this one
                # cannot — a different teacher, a different day for the
                # one-a-day rule — moving it there, and stepping into the cell
                # it leaves behind.
                free_now = [(d, p) for d in range(5) for p in nums
                            if not group_occupied(gid, d, p)]
                random.shuffle(free_now)
                others = [y for y in SLOTS
                          if y["group_id"] == gid and y is not s and swappable(y)
                          and can_leave(y) and y["period"] != last
                          and y.get("subject_id") != sid]
                random.shuffle(others)
                for y in others:
                    y_teacher = t_map.get(y["teacher_id"])
                    if not y_teacher:
                        continue
                    yd, yp = y["day"], y["period"]
                    # This lesson has to be able to stand where the other one
                    # is now, or there is no point moving them at all.
                    if subj_day[(gid, sid, yd)] > 0 or not can_take(teacher, gid, yd, yp):
                        continue
                    if yd in blocked_days_of(sid):
                        continue          # วันที่วิชานี้ห้ามเรียน
                    y_home = pull(y)
                    for d, p in free_now:
                        if subj_day[(gid, y.get("subject_id"), d)] > 0:
                            continue
                        if d in blocked_days_of(y.get("subject_id")):
                            continue      # วันที่วิชาของคาบที่ขยับห้ามเรียน
                        if group_occupied(gid, d, p) or not can_take(y_teacher, gid, d, p):
                            continue
                        rid_b = room_for(y, d, p, None, y_home[2])
                        if not rid_b and y_home[2]:
                            continue
                        rid_a = room_for(s, yd, yp, None, home[2])
                        if not rid_a and home[2]:
                            continue
                        seat(y, d, p, rid_b)
                        seat(s, yd, yp, rid_a)
                        moved_here += 1
                        moved = True
                        break
                    if moved:
                        break
                    seat(y, y_home[0], y_home[1], y_home[2])
                if not moved:
                    seat(s, home[0], home[1], home[2])
            return moved_here

        # A second round, because a trade in the first can free the very cell
        # another class needed. It stops as soon as a round moves nothing.
        pairs_moved = [0]          # คาบคู่ที่ย้ายไปทั้งคู่
        before_tail = tail_total()
        for _round in range(2):
            if not drain_round():
                break
        # Counted as the last period actually emptying, not as moves made: a
        # trade moves two lessons and empties one cell.
        drained = max(0, before_tail - tail_total())
        drained_pairs = pairs_moved[0]

    if drained:
        notes.append(
            f"คาบสุดท้ายของวันไว้ใช้เมื่อจำเป็น — ย้ายลงมาคาบก่อนหน้าได้ {drained} คาบ"
            f"{f' (คาบคู่ {drained_pairs} คู่)' if drained_pairs else ''}"
        )

    # ── คาบว่างของนักเรียน: ไม่ให้กองอยู่วันเดียวกัน ──────────────────────────
    #
    # "คาบว่างของนักเรียนช่วยไม่ให้อยู่ในวันเดียวกัน ยกเว้นว่าจำเป็นจริงๆ"
    #
    # A free period is a hole in the middle of a day — คาบ 1 and คาบ 4 taught
    # with คาบ 2 and คาบ 3 empty, forty students with nowhere to be for a
    # hundred minutes. An empty cell at the END of the day is not that: it is
    # going home early, which is what the school asked for one request ago.
    #
    # The move is always the same, and it is the only one that costs nothing:
    # take the LAST lesson of some day and slide it into the hole. The day it
    # leaves simply finishes earlier — no new hole can appear there, because
    # there was nothing after it — and the day it joins has one hole fewer.
    # So every move here is a strict improvement, and the pass can simply keep
    # going until no move is left.
    _progress("กำลังปิดคาบว่างกลางวัน", done=len(SLOTS))
    gaps_filled = 0
    gaps_cost = 0        # ในนั้น กี่คาบที่ต้องยอมให้วิชาซ้ำวัน

    def holes_of(gid: int, nums: list[int]) -> list[tuple[int, int]]:
        """ช่องว่างกลางวันของห้องนี้ — นับเวลาของห้องแม่และห้องย่อยรวมกัน

        "ไม่อยากให้มีคาบว่างสองคาบขึ้นไปในวันเดียวกัน"

        ห้องแม่กับห้องย่อยเป็นนักเรียนกลุ่มเดียวกัน ม.4/6ค ที่มีคาบของตัวเอง
        ถึงคาบ 2 แล้วไปเรียนรวมกับห้องแม่ตอนคาบ 7 นั้น เด็กเลิกคาบ 7 ไม่ใช่
        คาบ 2 — คาบ 3 ถึง 6 คือคาบว่างกลางวันจริงๆ
        เดิมนับเฉพาะคาบของห้องตัวเอง วันนั้นจึงดูเหมือนเลิกตั้งแต่คาบ 2 และ
        ไม่มีช่องว่างเลย ทั้งที่ว่างอยู่สี่คาบ ตัวปิดคาบว่างใช้ตัวนี้หาช่อง
        มันจึงไล่ปิดผิดช่องมาตลอด และรายงานก็บอกตัวเลขต่ำกว่าความจริง
        """
        kin = group_conflict_ids(gid)
        used: dict[int, set] = defaultdict(set)
        for x in SLOTS:
            if x["group_id"] in kin:
                used[x["day"]].add(x["period"])
        out = []
        for d in range(5):
            if not used[d]:
                continue
            ends = max(used[d])
            out += [(d, p) for p in nums
                    if p < ends and p not in used[d] and not group_occupied(gid, d, p)]
        return out

    def day_enders(gid: int) -> list[dict]:
        """คาบสุดท้ายของแต่ละวันของห้องนี้ — ย้ายออกแล้ววันนั้นเลิกเร็วขึ้น
        โดยไม่เกิดคาบว่างใหม่"""
        best: dict[int, dict] = {}
        for x in SLOTS:
            if x["group_id"] != gid:
                continue
            cur = best.get(x["day"])
            if cur is None or x["period"] > cur["period"]:
                best[x["day"]] = x
        return [x for x in best.values() if swappable(x) and can_leave(x)]

    # รอบท้ายๆ ผ่อนกฎ "หนึ่งวิชาวันละครั้ง" เพื่อปิดรูที่เหลือ
    #
    # "ตัวอย่างแบบนี้ซึ่งมีหลายห้องเลย ช่วยทำให้ลงตารางให้ได้หน่อยไม่ว่าจะยังไง"
    #
    # วัดการย้ายที่ถูกปฏิเสธบนผังคาบจริง: ย้ายสำเร็จ 628 คาบ แต่ถูกปฏิเสธเพราะ
    # "วันนั้นเรียนวิชานี้ไปแล้ว" 1,115 ครั้ง และ "ครูไม่ว่าง" 1,114 ครั้ง —
    # ข้อแรกเป็นกฎที่ผ่อนได้ ข้อหลังผ่อนไม่ได้เพราะครูอยู่สองที่พร้อมกันไม่ได้
    #
    # วันจันทร์ของโรงเรียนนี้จบด้วยคาบกิจกรรม (คุณธรรม ชุมนุม) ซึ่งย้ายไม่ได้
    # ห้องที่มีคาบเรียนธรรมดาวันจันทร์แค่สามคาบ จึงเหลือรูกลางวันสองรูเสมอ
    # ไม่ว่าจะสลับยังไง ทางเดียวที่ปิดได้คือย้ายคาบจากวันอื่นเข้ามา
    #
    # เรียนวิชาเดียวกันสองครั้งในวันเดียว แย่น้อยกว่านั่งว่างกลางวันสองคาบ
    # ("ไม่อยากให้มีคาบว่างสองคาบขึ้นไปในวันเดียวกัน ถ้าจำเป็นจริงๆ ค่อยให้")
    # แต่ไม่ผ่อนให้วิชาคาบคู่ เพราะโรงเรียนสั่งไว้ชัดว่าก้อนของวิชาคาบคู่ต้อง
    # อยู่คนละวัน และสี่คาบรวดในวันเดียวคือสิ่งที่โรงเรียนเคยเจอมาแล้ว
    # นับรูไว้ก่อนเริ่ม เพื่อบอกทีหลังได้ว่า "ย้ายกี่ครั้ง" ปิดรูได้จริงกี่รู
    holes_before = 0
    for _g in g_map.values():
        _nums = _class_periods_for_level(_level_key(_g))
        if _nums:
            holes_before += len(holes_of(_g["id"], _nums))

    for _round in range(6):
        relax_one_a_day = _round >= 4
        moved_any = False
        for grp in sorted(g_map.values(), key=lambda g: g["id"]):
            gid  = grp["id"]
            nums = _class_periods_for_level(_level_key(grp))
            if not nums:
                continue
            for _try in range(12):
                holes = holes_of(gid, nums)
                if not holes:
                    break
                # วันที่ว่างหลายคาบก่อน — that is the day the school is asking
                # about, and the one a single move helps most.
                per_day = Counter(d for d, _ in holes)
                holes.sort(key=lambda c: (-per_day[c[0]], c[0], c[1]))
                filled = False
                for d, p in holes:
                    cands = [x for x in day_enders(gid)
                             if not (x["day"] == d and x["period"] < p)]
                    random.shuffle(cands)
                    for x in cands:
                        owner = x["group_id"]
                        teacher = t_map.get(x["teacher_id"])
                        home = pull(x)
                        # ลองจำกัดให้ผ่อนเฉพาะวันที่ว่างตั้งแต่สองคาบขึ้นไป
                        # (เส้นที่โรงเรียนขีดไว้เอง) แล้ววัด — แทบไม่ได้ผลเลย
                        # ม.ต้นกลับไปที่ 8/6/10 รูเท่าเดิม เพราะพอรอบก่อนหน้า
                        # ปิดไปรูหนึ่ง วันนั้นก็เหลือรูเดียว เงื่อนไขจึงไม่เข้า
                        was_dup = subj_day[(owner, x.get("subject_id"), d)] != 0
                        once_a_day = (
                            not was_dup
                            or (relax_one_a_day
                                and not is_double_subject(x.get("subject_id"))))
                        if (once_a_day
                                and d not in blocked_days_of(x.get("subject_id"))
                                and not group_occupied(owner, d, p)
                                and can_take(teacher, owner, d, p)):
                            rid = room_for(x, d, p, None, home[2])
                            if rid or not home[2]:
                                seat(x, d, p, rid)
                                gaps_filled += 1
                                gaps_cost += was_dup
                                filled = moved_any = True
                                break
                        seat(x, home[0], home[1], home[2])
                    if filled:
                        break
                if not filled:
                    break
        if not moved_any:
            break

    if gaps_filled:
        # "ย้ายกี่ครั้ง" กับ "ปิดรูได้กี่รู" ไม่ใช่เลขเดียวกัน และต่างกันมาก
        #
        # การย้ายหนึ่งครั้งปิดรูตรงนี้ แต่เปิดรูใหม่ที่ห้องเดิมได้ รายงานที่บอก
        # แต่จำนวนครั้งที่ย้ายจึงฟังดูเหมือนทำงานได้ผลกว่าความจริงมาก — วัดบน
        # ข้อมูลจริง ย้าย 898 ครั้ง แต่รูที่หายไปจริงมี 539 อีก 359 ครั้งคือ
        # ย้ายแล้วรูไปโผล่ที่อื่น โรงเรียนต้องเห็นทั้งสองเลขถึงจะรู้ว่าควร
        # ปล่อยให้วนต่อ หรือปัญหาอยู่ที่อื่นแล้ว
        holes_after = 0
        for _g in g_map.values():
            _nums = _class_periods_for_level(_level_key(_g))
            if _nums:
                holes_after += len(holes_of(_g["id"], _nums))
        closed = max(0, holes_before - holes_after)
        idle = max(0, gaps_filled - closed)
        line = (f"ปิดคาบว่างกลางวันของนักเรียนได้ {closed} คาบ "
                f"— เอาคาบสุดท้ายของอีกวันมาลง วันนั้นจึงเลิกเร็วขึ้นแทน "
                f"(ย้ายทั้งหมด {gaps_filled} ครั้ง "
                f"ในนั้น {idle} ครั้งย้ายแล้วไม่ได้ปิดรูเพิ่ม)")
        if gaps_cost:
            # ราคาที่จ่ายไป ต้องเห็น ไม่ใช่เกิดขึ้นเงียบๆ — โรงเรียนเป็นคนบอก
            # ว่ากฎไหนยอมได้ จึงต้องรู้ว่ายอมไปกี่คาบ
            line += (f" · ในนั้นมี {gaps_cost} คาบที่ต้องยอมให้ห้องนั้นเรียน"
                     f"วิชาเดิมซ้ำในวันเดียวกัน เพื่อไม่ให้เหลือคาบว่างกลางวัน "
                     f"(วิชาคาบคู่ไม่ถูกผ่อนให้)")
        notes.append(line)

    _progress("กำลังหาห้องให้คาบที่ยังไม่มีห้อง", done=len(SLOTS))
    # ── คาบที่ลงแล้วแต่ไม่มีห้อง: ขยับห้องให้เหมือนกัน ────────────────────────
    #
    # Last of all, because the passes above move lessons between cells and a
    # lesson that had a room can lose it on the way. A chain may well find one
    # without putting anybody into a room they would not have accepted anyway.
    roomless = [s for s in SLOTS if not s.get("room_id") and not s.get("is_elective")
                and not s.get("is_activity_block")
                and not _repair_frozen(s)]        # a frozen class keeps its red cells as they are
    if roomless:
        index_rooms()
        # A room the school wrote down for this lesson still outranks anything
        # the chain would pick on its own, so carry it through.
        pin_of = {(r["group_id"], r["subject_id"], r["teacher_id"]): r["room_id"]
                  for r in REQUIREMENTS if r.get("room_id")}
        for s in roomless:
            rid = shuffle_for(
                s.get("teacher_id"), s["group_id"], s.get("subject_id"),
                s["day"], s["period"],
                pinned=pin_of.get((s["group_id"], s.get("subject_id"), s.get("teacher_id"))))
            if rid:
                hold_room(s, rid)
                rescued_by_shuffle += 1

    # ── ยังไม่มีห้อง: สลับคาบกันเองในห้องเรียนเดียวกัน ────────────────────────
    #
    # "ที่ฉันบอกว่าลงไปได้เลย ให้ลงไปก่อน"
    #
    # The chain above asks "is another room free at this hour", and sometimes
    # the honest answer is no — every room this lesson may use is taken at
    # ten past one on a Thursday. But the class's own week has other hours in
    # it, and one of its other lessons may be far easier to house: ค31102
    # needs an ordinary classroom and they are all full, while the ง31231 two
    # hours later is in a ห้องการงาน nobody else wants.
    #
    # So the two trade places. The class is busy in both cells either way, so
    # nothing about its week changes except which subject is when — and both
    # lessons end up in a room. Only done when BOTH come out housed; anything
    # less and they go straight back where they were.
    swapped_for_room = 0
    stranded = [s for s in SLOTS if not s.get("room_id") and not s.get("is_elective")
                and not s.get("is_activity_block") and swappable(s) and can_leave(s)]
    for lesson in stranded:
        gid = lesson["group_id"]
        mates = [m for m in SLOTS
                 if m["group_id"] == gid and m is not lesson and m.get("room_id")
                 and swappable(m) and can_leave(m)]
        random.shuffle(mates)
        for mate in mates:
            here = (lesson["day"], lesson["period"])
            there = (mate["day"], mate["period"])
            if here == there:
                continue
            l_home = pull(lesson)
            m_home = pull(mate)
            done = False
            if (can_take(t_map.get(lesson["teacher_id"]), gid, there[0], there[1])
                    and can_take(t_map.get(mate["teacher_id"]), gid, here[0], here[1])
                    and subj_day[(gid, lesson.get("subject_id"), there[0])] == 0
                    and subj_day[(gid, mate.get("subject_id"), here[0])] == 0):
                rid_l = room_for(lesson, there[0], there[1])
                rid_m = room_for(mate, here[0], here[1], None, m_home[2])
                if rid_l and rid_m:
                    seat(lesson, there[0], there[1], rid_l)
                    seat(mate, here[0], here[1], rid_m)
                    swapped_for_room += 1
                    done = True
            if not done:
                seat(mate, m_home[0], m_home[1], m_home[2])
                seat(lesson, l_home[0], l_home[1], l_home[2])
            else:
                break
    if swapped_for_room:
        notes.append(
            f"สลับคาบกันเองในห้องเรียนเดิมเพื่อหาห้องให้ {swapped_for_room} คาบ "
            f"— ห้องเรียนยังเรียนครบชั่วโมงเดิมทุกประการ")

    # ── จับคาบคู่ที่กระจายอยู่สองเซ็ตให้เป็นก้อนเดียว ────────────────────────
    # Last, once nothing else will move a lesson: two adjacent periods of one
    # คาบคู่ subject are one lesson whether they were written as one or as two
    # small เซ็ต, and the grid should show them that way.
    tied_doubles = _tie_adjacent_doubles()
    if tied_doubles:
        notes.append(f"จับคาบติดกันของวิชาคาบคู่ให้เป็นก้อนเดียว {tied_doubles} คู่")

    # ห้องย่อยที่เรียนด้วยกันต้องอยู่ห้องเดียวกัน — after every pass that can
    # move a room, including the chains above.
    rejoined = _merge_sibling_rooms()
    if rejoined:
        notes.append(
            f"จัดห้องย่อยที่เรียนวิชาเดียวกันกับครูคนเดียวกันให้กลับมานั่งห้องเดียวกัน "
            f"{rejoined} คาบ")

    # ── คาบที่ยังจัดไม่ลงตัว: วางไว้ให้เห็น กรอบแดง ไม่กำหนดห้อง ──────────────
    #
    # "คาบที่ลงไม่ได้ช่วยลงให้ได้หน่อย แต่ใช้กรอบสีแดงและไม่ต้องลงห้องเอาไว้"
    #
    # A lesson that is simply absent is the hardest kind of fault to act on:
    # the school has to go and read a list to find out it exists at all. Put
    # in the class's own column, framed red and with no room, it is in front
    # of whoever is looking at that class, and it says what has to be settled
    # by hand.
    #
    # Only where the STUDENTS are free. Two lessons in one cell of one class
    # is the single clash nobody can resolve — there is no second room and no
    # second teacher that puts forty children in two places. A teacher already
    # booked elsewhere IS allowed here, because that is exactly the decision
    # being handed back: either that teacher's other class moves, or this
    # lesson does, and only the school can say which.
    #
    # Last of all, so nothing that runs before it has to know these exist:
    # they hold no room, book no teacher, and are not counted as placed.
    # Every rule the school set is still kept here. The ONLY one given up is
    # the one that could not be kept in the first place — the teacher being
    # free, or a room existing — because that is the question being handed
    # back. A red cell on a teacher's day off, or a second ค31102 on a Tuesday,
    # would be a second fault invented on top of the first one.
    def clear_for_overflow(gid: int, tid: int, free_cells: list,
                           sid=None) -> tuple | None:
        """Move one of this class's lessons aside so a คาบล้น can land on an
        hour where its teacher is actually free.

        Why this is worth doing rather than handing the clash back:

        Measured on the school's own data, every red cell that also had a
        teacher clash looked the same. The class had one to three empty hours
        left in its week and the teacher was busy in every one of them — so
        the cell above picks an hour the teacher cannot be in, and the red
        frame then says two things at once, only one of which anybody can act
        on. But those same classes had five to twenty hours where the teacher
        WAS free and some other lesson of theirs happened to be sitting. None
        of the teachers were overloaded: each needed fifteen to twenty-one
        hours out of thirty-five.

        So the clash was never a fact about the teacher's week. It was the
        order things were placed in. One lesson steps aside — into an hour its
        own teacher is free in, obeying every rule it would have obeyed
        anyway — and the คาบล้น takes the hour it leaves. The class is no
        busier, the displaced lesson is no worse off, and what remains on the
        red cell is the one problem the school can actually solve: no room.

        Returns the freed (day, period), or None when nothing could step aside.
        """
        lvl  = _level_key(g_map.get(gid))
        nums = _class_periods_for_level(lvl)
        # Hours this teacher is free but the class is not — each holds one
        # lesson that might be able to move.
        # ช่องที่จะคืนให้คาบล้นไปลง ต้องไม่ใช่วันที่วิชานั้นห้ามเรียน — รายการ
        # free ข้างนอกถูกกรองวันมาแล้ว แต่รายการนี้สร้างขึ้นเองคนละชุด
        bad_days = blocked_days_of(sid)
        want = [(d, p) for d in range(5) for p in nums
                if group_occupied(gid, d, p) and teacher_free(tid, d, gid, p)
                and d not in bad_days]
        random.shuffle(want)
        for d, p in want:
            y = next((x for x in SLOTS if x["group_id"] == gid
                      and x["day"] == d and x["period"] == p), None)
            # A คาบล้น has no room and books no teacher; moving one would be
            # shuffling the problem rather than solving it.
            if y is None or y.get("is_overflow"):
                continue
            if not can_leave(y) or not swappable(y):
                continue
            y_teacher = t_map.get(y["teacher_id"])
            home = pull(y)
            for fd, fp in free_cells:
                if (fd, fp) == (d, p):
                    continue
                if subj_day[(gid, y.get("subject_id"), fd)] > 0:
                    continue
                # คาบที่ถูกขอให้ขยับก็มีวันต้องห้ามของมันเอง — ย้ายมันไปวันนั้น
                # คือการแหกกฎด้วยมือของเราเอง
                if fd in blocked_days_of(y.get("subject_id")):
                    continue
                if not can_take(y_teacher, gid, fd, fp):
                    continue
                rid = room_for(y, fd, fp, None, home[2])
                if not rid and home[2]:
                    continue
                seat(y, fd, fp, rid)
                return (d, p)
            seat(y, home[0], home[1], home[2])
        return None

    overflow_placed = 0
    for req, gid, tid, missing, done in short_rows:
        lvl   = _level_key(g_map.get(gid))
        nums  = _class_periods_for_level(lvl)
        last  = _last_period_for(lvl)
        sid   = req.get("subject_id")
        prefs = _teacher_prefs(t_map.get(tid))
        pin_d, pin_p = req.get("pinned_day"), req.get("pinned_period")
        for _ in range(missing):
            # ล็อกวัน/คาบไว้ = ที่ของมันคือตรงนั้น ที่เดียว
            if pin_d is not None and pin_p is not None:
                free = ([(int(pin_d), int(pin_p))]
                        if not group_occupied(gid, int(pin_d), int(pin_p)) else [])
            else:
                blocked = blocked_days_of(sid)
                free = [(d, p) for d in range(5) for p in nums
                        if not group_occupied(gid, d, p)
                        and d not in prefs["days_off"]       # วันที่ครูไม่สอน
                        and d not in blocked                 # วันที่วิชานี้ห้ามเรียน
                        and p not in prefs["avoid_periods"]  # คาบที่ครูเลี่ยง
                        and not (tail_mode == "never" and p == last)]
                # หนึ่งรหัสวิชา หนึ่งครั้งต่อวัน — ผ่อนให้ก็ต่อเมื่อไม่เหลือวันอื่นจริงๆ
                spread = [c for c in free if not subj_day[(gid, sid, c[0])]]
                free = spread or free
            if not free:
                break
            random.shuffle(free)
            free.sort(key=lambda c: (
                # ชั่วโมงที่ครูว่างอยู่แล้วก่อน — คาบนั้นเหลือแค่เรื่องห้อง
                0 if teacher_free(tid, c[0], gid, c[1]) else 1,
                # …and among those, an hour the school kept a ลาน for: the room
                # this lesson is missing is already waiting there.
                0 if (gid, c[0], c[1]) in pick_owned else 1,
                # และยังเก็บคาบสุดท้ายของวันไว้เหมือนเดิม
                1 if c[1] == last else 0,
            ))
            d, p = free[0]
            # The sort above already put any teacher-free hour first, so if
            # the best one still clashes there was none — ask a lesson to step
            # aside before handing the school a clash it did not have to have.
            if not teacher_free(tid, d, gid, p):
                spot = clear_for_overflow(gid, tid, free, sid)
                if spot is not None:
                    d, p = spot
            slot = make_slot(req, d, p, (None, None, None))
            slot["is_overflow"] = True
            # คาบเรียนลาน: a cell with a pick holds its lesson on the ลาน, a
            # red-framed one too. Only the frame stays — it still says whatever
            # else (the teacher being busy) is left to settle.
            if (gid, d, p) in pick_owned:
                rid, rname, rtype = find_room(tid, d, p, sid, gid)
                if rid:
                    hold_room(slot, rid)
            SLOTS.append(slot)
            group_busy.add((gid, d, p))
            note_subject(gid, sid, d)
            overflow_placed += 1
    # ── คาบว่างกลางวันที่เหลืออยู่ นับตอนนี้ ไม่ใช่ตอนที่ปิดเสร็จ ────────────
    #
    # "ไม่อยากให้มีคาบว่างสองคาบขึ้นไปในวันเดียวกัน (ถ้าจำเป็นจริงๆ ค่อยให้)"
    #
    # ตัวเลขนี้เคยนับทันทีหลังรอบปิดคาบว่าง ซึ่งยังไม่ใช่ตารางสุดท้าย — ตัวยัด
    # คาบล้นข้างบนลงคาบเพิ่มทีหลัง และคาบที่ลงท้ายวันทำให้วันนั้นเลิกช้าลง
    # ช่องที่เคยเป็น "เลิกเร็ว" จึงกลายเป็นรูกลางวัน รายงานที่นับก่อนหน้านั้น
    # จึงบอกตัวเลขต่ำกว่าความจริง (13 ทั้งที่จริง 14)
    #
    # สิ่งที่โรงเรียนอ่านคือตารางที่ออกมา ตัวเลขจึงต้องเป็นของตารางนั้น
    gap_days, gap_classes = 0, []
    for grp in g_map.values():
        nums = _class_periods_for_level(_level_key(grp))
        if not nums:
            continue
        per_day = Counter(d for d, _ in holes_of(grp["id"], nums))
        crowded = [d for d, n in per_day.items() if n > 1]
        if crowded:
            gap_days += len(crowded)
            gap_classes.append(grp.get("name", "?"))
    if gap_days:
        notes.append(
            f"ยังเหลือ {gap_days} วันที่ห้องเรียนว่างเกินหนึ่งคาบในวันเดียว "
            f"({', '.join(sorted(gap_classes)[:5])}"
            f"{' …' if len(gap_classes) > 5 else ''}) — ย้ายต่อไม่ได้แล้ว "
            f"ติดครูหรือห้องในชั่วโมงนั้น")

    if overflow_placed:
        notes.append(
            f"วางคาบที่ยังจัดไม่ลงตัวไว้ให้เห็น {overflow_placed} คาบ — "
            f"ขึ้นกรอบแดง ไม่ได้กำหนดห้อง และไม่นับเป็นคาบที่จัดสำเร็จ "
            f"ย้ายหรือเปลี่ยนครู/ห้องเองได้ แล้วกรอบแดงจะหายไป")

    # ── ห้องประจำชั้นของนักเรียน เป็นทางสุดท้ายที่ยังเหลือ ────────────────────
    #
    # "ทำไมยังมีตัวแดงอยู่ ในเมื่อห้องนี้มีห้องประจำอยู่ … มันไม่ควรจะมีวิชาที่
    #  ลงไม่ได้ถ้าเป็นของ ม.ต้น"
    #
    # วัดบนตารางจริงของโรงเรียน: ม.ต้นมีคาบขึ้นกรอบแดง "ไม่มีห้อง" 16 คาบ และ
    # 15 คาบในนั้น ห้องประจำชั้นของตัวเองว่างอยู่จริงในชั่วโมงนั้น (เทียบด้วย
    # เวลานาฬิกา ไม่ใช่เลขคาบ เพราะ ม.ต้นกับ ม.ปลายใช้เลขคาบคนละชุด)
    #
    # กฎข้างบนมีเหตุผลของมันทีละข้อ — ห้องประจำวิชาต้องมาก่อน ห้องที่จองให้ครู
    # คนอื่นเข้าไม่ได้ วิชาที่ต้องอยู่ตึกนั้น — แต่ปลายทางของการปฏิเสธทุกข้อ
    # รวมกันคือ "ไม่มีห้องให้" ทั้งที่ห้องของนักเรียนเองว่างอยู่ ซึ่งเป็นคำตอบ
    # ที่ผิดเสมอ ไม่ว่าจะมาจากกฎข้อไหน ห้องที่ไม่เหมาะดีกว่าไม่มีห้อง
    #
    # ทำท้ายสุด หลังทุกวิธีที่ดีกว่านี้ลองหมดแล้ว และแตะเฉพาะคาบที่ยังไม่มีห้อง
    sent_home = 0
    for s in SLOTS:
        if (s.get("room_id") or s.get("is_elective") or s.get("is_activity_block")
                or _repair_frozen(s)):
            continue
        # ทุกชั่วโมงที่โรงเรียนเลือกลานไว้ ไม่ใช่เฉพาะอันที่ได้ลานจริง — ถ้าลาน
        # ถูกอีกห้องจองไปก่อน กรอบแดงคือสิ่งที่บอกว่าลานชนกัน การยัดห้องธรรมดา
        # ให้แทนคือการกลบเรื่องที่โรงเรียนสั่งไว้เอง
        if (s["group_id"], s["day"], s["period"]) in pick_at:
            continue
        grp_ = g_map.get(s["group_id"]) or {}
        hr = grp_.get("homeroom_room_id")
        room = r_map.get(hr) if hr else None
        if not room or not _room_usable(room) or room.get("type") == "outdoor":
            continue
        # ข้อห้ามที่มีเหตุผลของตัวเอง ยังต้องเคารพ — ไม่ใช่ทุกคาบที่ "ห้องไหน
        # ก็ได้ดีกว่าไม่มีห้อง" คาบคอมในห้องเรียนธรรมดาคือคาบที่สอนไม่ได้จริง
        # และ "แนะแนว ม.6 ต้องอยู่อาคาร 1 เท่านั้น" ก็เป็นคำสั่งของโรงเรียนเอง
        # ทางถอยนี้จึงมีไว้สำหรับคาบธรรมดาที่แค่แพ้การแย่งห้อง
        subj_ = s_map.get(s.get("subject_id")) or {}
        if _subject_room_rule(subj_) == "subject":
            continue                     # ต้องเรียนที่ห้องประจำวิชาเท่านั้น
        want_b = _subject_buildings(subj_)
        if want_b and room.get("building_id") not in want_b:
            continue                     # วิชานี้เรียนได้เฉพาะบางอาคาร
        if (_teacher_prefs(t_map.get(s.get("teacher_id")))["ground_floor"]
                and (room.get("floor") or 1) > 1):
            continue                     # ครูขึ้นชั้นบนไม่ได้
        if any((hr, s["day"], b) in room_busy
               for b in cell_buckets(s["group_id"], s["period"])):
            continue                     # ห้องตัวเองไม่ว่างจริงๆ ชั่วโมงนั้น
        hold_room(s, hr)
        # ให้ห้องอย่างเดียว ไม่ปลดธงคาบล้นเอง
        #
        # คาบล้นถูกวางโดยตัวยัดท้ายสุด ซึ่งผ่อนกฎ "วิชาเดียวกันวันละครั้ง" ได้
        # ถ้าปลดธงตรงนี้ มันจะกลายเป็นคาบปกติที่แหกกฎนั้นอยู่เงียบๆ โดยไม่มี
        # อะไรบอก — วัดแล้วเกิดจริง 2 ห้อง การให้ห้องแก้เรื่องห้อง ไม่ได้แปลว่า
        # คาบนั้นลงตัวแล้ว ส่วนกรอบแดงบนจอ ระบบปลดให้เองตอนอ่านตาราง ถ้าได้ห้อง
        # แล้วและครูก็ว่าง (ดู _settle_overflow)
        sent_home += 1
    if sent_home:
        notes.append(
            f"ส่ง {sent_home} คาบที่หาห้องไม่ได้กลับไปเรียนที่ห้องประจำชั้นของตัวเอง "
            f"— ห้องนั้นว่างอยู่ และห้องที่ไม่เหมาะดีกว่าไม่มีห้อง "
            f"(ถ้าวิชาไหนต้องใช้ห้องเฉพาะจริงๆ ให้ย้ายเองอีกที)")

    # ── ม.ต้นไม่มีห้อง แต่ห้องประจำชั้นของตัวเองถูกห้องอื่นนั่งอยู่ ───────────
    #
    # "นักเรียน ม.ต้นที่มีห้องประจำจะต้องลงวิชาก่อน … ม.ต้นต้องมีวิชาครบก่อน
    #  ต้องไม่มีปัญหา ส่วนนักเรียน ม.ปลายฉันจะไปจัดหาลานเอง คือถ้านักเรียน
    #  ม.ปลายไม่มีห้อง สามารถมาห้องครูที่สอนห้องประจำได้"
    #
    # ห้องประจำชั้นเป็นของห้องเรียนนั้น ถ้าเจ้าของต้องใช้ในชั่วโมงนั้นจริงๆ แล้ว
    # ไม่มีห้องเลย คนที่มานั่งอยู่ต้องลุกให้ — โรงเรียนบอกไว้ชัดว่าฝั่งไหนยอมได้
    #
    # ทำที่นี่ ไม่ใช่ตอนเลือกห้อง: กันห้องไว้ตั้งแต่ตอนเลือกวัดแล้วเวลาจัดขึ้นจาก
    # 1.77 เป็น 4.06 วินาที เพราะทุกคาบต้องไล่หาห้องไกลขึ้น ส่วนรอบนี้วิ่งเฉพาะ
    # คาบของ ม.ต้นที่ไม่มีห้องจริงๆ ซึ่งมีไม่กี่คาบ จึงแทบไม่มีราคา
    evicted = 0
    reclaimed = 0
    for s_ in SLOTS:
        if (s_.get("is_elective") or s_.get("is_activity_block")
                or _repair_frozen(s_) or _held(s_)):
            continue
        grp_ = g_map.get(s_["group_id"]) or {}
        if _level_key(grp_) != "lower":
            continue
        hr = homeroom_owner.get(grp_.get("homeroom_room_id") or -1)
        if hr is None or hr not in group_conflict_ids(s_["group_id"]):
            continue                       # ไม่ใช่ห้องประจำชั้นของตัวเอง
        room = r_map.get(grp_["homeroom_room_id"])
        if not room or not _room_usable(room) or room.get("type") == "outdoor":
            continue
        if s_.get("room_id") == room["id"]:
            continue                       # อยู่ห้องตัวเองอยู่แล้ว
        subj_ = s_map.get(s_.get("subject_id")) or {}
        if _subject_room_rule(subj_) == "subject":
            continue                       # ต้องเรียนที่ห้องประจำวิชาเท่านั้น
        # ── คาบที่ "มีห้องแล้ว แต่ไม่ใช่ห้องตัวเอง" ────────────────────────
        #
        # "ห้องเรียนห้อง 332 ควรจะเป็นของ 1/5 แต่ทำไมมีห้อง 4/12 มาแทนล่ะ
        #  คือช่วยจัด ม.ต้นให้เสร็จก่อนแล้วค่อยว่ากันใหม่"
        #
        # รอบนี้เคยแตะเฉพาะคาบที่ "ไม่มีห้อง" ซึ่งพลาดอาการที่โรงเรียนเห็นจริง:
        # ม.1/5 ไม่ได้ไม่มีห้อง แต่ถูกไล่ไป 363 / 362 / ห้องสมุด แล้ว ม.4/12
        # กับ ม.6/x เข้ามานั่งใน 332 แทน — วัดบนข้อมูลจริงของโรงเรียน (26 ต.ค.)
        # ห้องประจำของ ม.ต้นถูกชั้นอื่นนั่งไป 398 คาบ ใน 30 ห้อง (ม.ปลาย 341)
        # และของ ม.1/5 ทั้ง 7 คาบที่ถูกยึด เป็นชั่วโมงที่เจ้าของไปอยู่ห้องอื่นพอดี
        #
        # แต่ไม่ใช่ทุกคาบที่ออกจากห้องแล้วผิด — ของ ม.1/5 เก้าคาบที่ออกไป มีห้า
        # คาบที่ถูกต้อง (ว21286/ว21184 ไปห้องคอมฯ ซึ่งเป็นห้องของกลุ่มสาระนั้น
        # และ พ21103/พ21104 ไปลาน) เหลือสี่คาบที่ออกไปเพราะแพ้การแย่งห้องเฉยๆ
        # ด่านล่างนี้จึงแยกสองอย่างนั้นออกจากกัน
        if s_.get("room_id"):
            at = r_map.get(s_["room_id"]) or {}
            # ห้องที่ถูกเลือกไว้ "ตั้งใจ" ต้องไม่ถูกเรียกกลับ — ไม่งั้นรอบนี้จะ
            # ไปล้มการตั้งค่าที่โรงเรียนทำไว้เอง สามทางที่ตั้งใจได้:
            #   · โรงเรียนกำหนดห้องให้แถวนั้นในแผนการสอน (req_room)
            #   · วิชาผูกห้องไว้เอง
            #   · เป็นห้องของครูคนนั้น (ห้องประจำครู หรือห้องที่เขียนชื่อไว้)
            if req_room.get((s_["group_id"], s_.get("subject_id"),
                             s_.get("teacher_id"))) == s_["room_id"]:
                continue                   # โรงเรียนกำหนดห้องนี้ไว้เอง
            _t = t_map.get(s_.get("teacher_id")) or {}
            if (at.get("id") == _t.get("fixed_room_id")
                    or (s_.get("teacher_id") is not None
                        and s_["teacher_id"] in room_reserved_for(at))):
                continue                   # ห้องของครูคนนี้เอง
            if _subject_rooms(subj_):
                continue                   # วิชาผูกห้องไว้เอง
            if at.get("type") == "outdoor" or _subject_outdoor(subj_):
                continue                   # วิชาเรียนนอกอาคาร
            dept_ = subj_.get("department_id")
            if dept_ and at.get("specialized_dept_id") == dept_:
                continue                   # อยู่ห้องของกลุ่มสาระตัวเอง ถูกแล้ว
            if (s_["group_id"], s_["day"], s_["period"]) in pick_at:
                continue                   # โรงเรียนเลือกลานไว้ให้ชั่วโมงนี้
        want_b = _subject_buildings(subj_)
        if want_b and room.get("building_id") not in want_b:
            continue                       # วิชานี้เรียนได้เฉพาะบางอาคาร
        if (_teacher_prefs(t_map.get(s_.get("teacher_id")))["ground_floor"]
                and (room.get("floor") or 1) > 1):
            continue                       # ครูขึ้นชั้นบนไม่ได้
        bks = cell_buckets(s_["group_id"], s_["period"])
        here = [room_holder.get((room["id"], s_["day"], b)) for b in bks]
        here = [x for x in here if x is not None]
        if len({id(x) for x in here}) > 1:
            continue                       # มีหลายคาบคาอยู่ ไม่ใช่การแย่งห้องเดี่ยวๆ
        if not here:
            # ห้องของตัวเองว่างอยู่ แต่คาบนี้ไปนั่งห้องอื่น — เดินกลับบ้านได้เลย
            # ไม่ต้องไล่ใคร (คาบที่ "ไม่มีห้อง" รอบก่อนหน้าจัดการไปแล้ว)
            if s_.get("room_id"):
                hold_room(s_, room["id"])
                reclaimed += 1
            continue
        occ = here[0]
        if (occ["group_id"] in group_conflict_ids(s_["group_id"])
                or _held(occ) or _repair_frozen(occ)
                or (occ["group_id"], occ["day"], occ["period"]) in pick_at):
            continue                       # ครอบครัวเดียวกัน ล็อกไว้ หรือมีลานของมันเอง
        # ── สลับห้องกันตรง ๆ ก่อน ────────────────────────────────────────
        #
        # เจ้าของอยู่ห้อง X ส่วนคนที่มานั่งอยู่ในห้องประจำ H ของเจ้าของ และ
        # ทั้งคู่อยู่ชั่วโมงเดียวกัน — สลับกันจึงได้ห้องครบทั้งสองฝ่าย ไม่ต้อง
        # ไล่ใครออกไปไม่มีห้อง
        #
        # ลองแบบไล่ออกอย่างเดียวมาแล้ว: ห้องประจำที่ถูกยึดลดจาก 398 เหลือ 335
        # แต่คาบที่ไม่มีห้องเพิ่มจาก 26 เป็น 57 เพราะ shuffle_for หาห้องใหม่
        # ให้คนที่ลุกไม่ได้ การสลับไม่มีราคานั้น เพราะห้องที่เจ้าของเพิ่งว่าง
        # ลงคือห้องที่คนนั้นเข้าได้อยู่แล้วในชั่วโมงนั้น
        mine_room = s_.get("room_id")
        swapped = False
        if mine_room and mine_room != room["id"]:
            occ_subj = s_map.get(occ.get("subject_id")) or {}
            at = r_map.get(mine_room) or {}
            occ_dept = occ_subj.get("department_id")
            # คนที่ลุกต้องเข้าห้อง X ได้จริง ด้วยกฎเดียวกับตอนเลือกห้อง
            # ม.ต้นกับ ม.ปลายใช้เลขคาบคนละชุด "คาบ 6" ของสองชั้นจึงไม่ใช่เวลา
            # เดียวกันเสมอไป ถ้าช่วงเวลาที่สองคาบกินไม่ตรงกันเป๊ะ การสลับห้อง
            # จะปล่อยช่องเวลาไม่ครบ แล้วกลายเป็นห้องเดียวสองห้องเรียน
            # (วัดแล้วเกิดจริง 4-7 ที่) — ไม่ตรงกันก็ไม่สลับ ใช้ทางไล่ออกแทน
            ok_for_occ = (
                cell_buckets(occ["group_id"], occ["period"]) == bks
                and _subject_room_rule(occ_subj) != "subject"
                and not _subject_rooms(occ_subj)
                and at.get("type") != "outdoor"
                and not _subject_outdoor(occ_subj)
                and _room_usable(at)
                and (not at.get("specialized_dept_id")
                     or at["specialized_dept_id"] == occ_dept)
                and (not _subject_buildings(occ_subj)
                     or at.get("building_id") in _subject_buildings(occ_subj))
                and not (_teacher_prefs(t_map.get(occ.get("teacher_id")))["ground_floor"]
                         and (at.get("floor") or 1) > 1))
            if ok_for_occ:
                hold_room(occ, None)
                hold_room(s_, None)
                hold_room(s_, room["id"])
                hold_room(occ, mine_room)
                swapped = True
        if not swapped:
            # ลำดับสำคัญ: ให้เจ้าของเข้าห้องก่อน แล้วค่อยหาห้องใหม่ให้คนที่ลุก
            #
            # ทำกลับกันแล้วพัง — พอปล่อยห้องว่าง ตัวหาห้องของคนที่ลุกเห็นห้อง
            # นั้นว่างพอดี ก็ย้ายกลับเข้าไปที่เดิม แล้วเจ้าของก็เข้าไปซ้อนอีกที
            # กลายเป็นห้องเดียวสองห้องเรียน ซึ่งเป็นอาการที่เพิ่งแก้ไปเมื่อกี้
            hold_room(occ, None)
            hold_room(s_, room["id"])
            moved = shuffle_for(occ.get("teacher_id"), occ["group_id"],
                                occ.get("subject_id"), occ["day"], occ["period"])
            if moved:
                hold_room(occ, moved)
            # ย้ายไม่ได้ก็ยังให้เจ้าของเข้าห้อง — คาบที่ลุกออกไปกลายเป็น
            # "ไม่มีห้อง" ซึ่งเป็นฝั่งที่โรงเรียนบอกว่าจะไปจัดเอง และมันขึ้น
            # กรอบแดงให้เห็น
        evicted += 1
    if evicted or reclaimed:
        parts = []
        if evicted:
            parts.append(f"ไล่ห้องที่มานั่งแทนออกไป {evicted} คาบ")
        if reclaimed:
            parts.append(f"เรียกเจ้าของที่ไปนั่งห้องอื่นกลับเข้าห้องตัวเอง "
                         f"{reclaimed} คาบ")
        notes.append(
            f"คืนห้องประจำชั้นให้ ม.ต้น {evicted + reclaimed} คาบ "
            f"({' · '.join(parts)}) — ห้องประจำชั้นเป็นของห้องเรียนนั้น "
            f"ชั้นอื่นเข้าได้เฉพาะชั่วโมงที่เจ้าของไม่ได้ใช้ "
            f"ส่วนคาบที่ต้องเรียนห้องเฉพาะ (คอมฯ ลาน ห้องกลุ่มสาระ) ไม่ถูกเรียกกลับ "
            f"(ถ้าไม่มีห้องว่างให้คนที่ลุก จะขึ้นกรอบแดงให้จัดเอง)")

    # ── ห้องที่กันไว้ให้ครู ใครได้สอนในนั้น ──────────────────────────────────
    #
    # "เน้นให้ครูที่สำคัญมีห้องสอนก่อนแล้วค่อยเติมลูกหมวดเข้าไป"
    #
    # โรงเรียนเขียนชื่อครูไว้บนห้องแล้วก็ไม่มีทางรู้ว่ามันได้ผลหรือเปล่า นอกจาก
    # ไปเปิดตารางห้องนั้นดูทีละห้อง บรรทัดนี้ตอบให้ทีเดียว: ห้องที่กันไว้มีคาบ
    # ของเจ้าของกี่คาบ ของลูกหมวดกี่คาบ และห้องไหนยังว่างทั้งสัปดาห์
    _res_rooms = {r["id"]: r for r in ROOMS if room_reserved_for(r)}
    if _res_rooms:
        _own = _other = 0
        _used: set[int] = set()
        for s_ in SLOTS:
            _rid = s_.get("room_id")
            _r = _res_rooms.get(_rid) if _rid else None
            if _r is None:
                continue
            _used.add(_rid)
            if s_.get("teacher_id") in room_reserved_for(_r):
                _own += 1
            else:
                _other += 1
        _empty = [r["name"] for rid, r in _res_rooms.items() if rid not in _used]
        _line = (f"ห้องที่กันไว้ให้ครู {len(_res_rooms)} ห้อง — คาบของครูเจ้าของห้อง "
                 f"{_own} คาบ · ของครูคนอื่นในกลุ่มสาระเดียวกัน {_other} คาบ")
        if _empty:
            _line += (f" · ยังไม่มีคาบเลย {len(_empty)} ห้อง "
                      f"({', '.join(_empty[:4])}{' …' if len(_empty) > 4 else ''})")
        notes.append(_line)


    # Only teachers who actually have lessons can be given a last period.
    teaching = [t for t in TEACHERS if any(r["teacher_id"] == t["id"] for r in REQUIREMENTS)]
    expected = [t for t in teaching if last_period_target(t["id"]) > 0]
    # ห้องที่ยังต้องเรียนถึงคาบสุดท้าย — the ones whose week genuinely does not
    # fit in คาบ 1-8, named so the school can see at a glance whether that
    # matches what it expects of each class.
    tail_left: dict[str, int] = defaultdict(int)
    tail_slots: dict[int, list] = defaultdict(list)
    for s_ in SLOTS:
        if s_["period"] == _last_period_for(_level_key(g_map.get(s_["group_id"]))):
            tail_left[(g_map.get(s_["group_id"]) or {}).get("name", "?")] += 1
            tail_slots[s_["group_id"]].append(s_)

    # ── ห้องที่ยังนั่งถึงคาบสุดท้ายทั้งที่สัปดาห์ยังมีช่องว่าง ───────────────
    #
    # "ลงคาบให้ครบก่อน ไม่ให้มีคาบว่าง ถ้ามีคาบว่างต้องไม่มีคาบ 9"
    #
    # ข้อความเดิมบอกกับทุกห้องที่มีคาบอยู่คาบสุดท้ายว่า "ห้องเหล่านี้มีวิชาเกิน
    # กว่าคาบ 1-8 จะรับไหว" โดยไม่เคยตรวจว่าจริงหรือเปล่า ห้องที่สัปดาห์ยังมี
    # ช่องว่างเหลืออยู่จึงถูกอธิบายผิด แล้วโรงเรียนก็ไปแก้ผิดที่ — ไปลดหลักสูตร
    # ทั้งที่เหตุจริงคือครูติดสอนห้องอื่นอยู่ในชั่วโมงที่ว่างนั้น
    #
    # สองกรณีนี้ทางแก้อยู่คนละขั้วกัน จึงต้องแยกให้ขาด
    #   สัปดาห์เต็มจริง      ลดคาบในหลักสูตร หรือเพิ่มคาบในผังคาบ
    #   ยังมีช่องว่างเหลือ   ไปดูครู/ห้อง/กฎวันละวิชาเดียวในชั่วโมงนั้น
    busy_cells: dict[int, set] = defaultdict(set)
    for s_ in SLOTS:
        busy_cells[s_["group_id"]].add((s_["day"], s_["period"]))

    def tail_free_cells(gid: int) -> list:
        """ช่องว่างก่อนคาบสุดท้ายของห้องนี้ นับเวลาของห้องแม่และห้องย่อยด้วย

        ห้องแม่กับห้องย่อยเป็นนักเรียนกลุ่มเดียวกัน ถ้านับแยก ห้องแม่จะดู
        เหมือนว่างสิบกว่าช่องทั้งที่เด็กนั่งเรียนอยู่ในห้องย่อย
        """
        g = g_map.get(gid) or {}
        nums = _class_periods_for_level(_level_key(g))
        if not nums:
            return []
        last = nums[-1]
        taken: set = set()
        for k in _group_family(gid, g):
            taken |= busy_cells.get(k, set())
        return [(d, p) for d in range(5) for p in nums
                if p != last and (d, p) not in taken]

    def tail_block_reason(s_: dict, free: list) -> str:
        """ทำไมคาบนี้ดึงขึ้นมาไม่ได้ ทั้งที่ห้องยังมีช่องว่าง

        ตอบด้วยเหตุที่พบบ่อยที่สุดในบรรดาช่องว่างที่มี เพราะโรงเรียนต้องการ
        รู้ว่า "ไปแก้ตรงไหน" ไม่ใช่รายการเหตุผลของทุกช่อง
        """
        if not can_leave(s_) or not swappable(s_):
            return "คาบนี้ถูกล็อกไว้ หรือเป็นคาบคู่/เซ็ตห้องย่อย/คาบเสรี จึงย้ายไม่ได้"
        gid, sid = s_["group_id"], s_.get("subject_id")
        teacher = t_map.get(s_.get("teacher_id"))
        counts: Counter = Counter()
        for d, p in free:
            if subj_day[(gid, sid, d)] > 0:
                counts["วันนั้นห้องนี้เรียนวิชาเดียวกันไปแล้ว"] += 1
            elif teacher is None or not can_take(teacher, gid, d, p):
                counts["ครูติดสอนห้องอื่นหรือไม่ว่างในชั่วโมงนั้น"] += 1
            else:
                counts["ไม่มีห้องว่างให้ในชั่วโมงนั้น"] += 1
        return counts.most_common(1)[0][0] if counts else ""

    tail_open: list[tuple] = []       # (ชื่อห้อง, ช่องว่างที่เหลือ, เหตุที่ย้ายไม่ได้)
    for gid, rows in tail_slots.items():
        free = tail_free_cells(gid)
        if not free:
            continue                  # สัปดาห์เต็มจริง อธิบายด้วยข้อความเดิม
        name = (g_map.get(gid) or {}).get("name", "?")
        tail_open.append((name, len(free), tail_block_reason(rows[0], free)))
    tail_open.sort(key=lambda r: (-r[1], r[0]))
    last_period_stats = {
        "teachers": len(expected),
        "met": sum(1 for t in expected if last_period_shortfall(t["id"]) <= 0),
        "moved": last_period_fixed,
        "swapped": last_period_swapped,
        "school_min": school_last_min,
        "mode": tail_mode,
        "drained": drained,
        "left": sum(tail_left.values()),
        "classes": dict(sorted(tail_left.items())),
    }
    if tail_mode != "free":
        open_names = {n for n, _c, _w in tail_open}
        full = {n: c for n, c in tail_left.items() if n not in open_names}
        if full:
            top = sorted(full.items(), key=lambda kv: (-kv[1], kv[0]))
            nums_hint = _class_periods_for_level("lower")
            upto = nums_hint[-2] if len(nums_hint) > 1 else "ก่อนคาบสุดท้าย"
            notes.append(
                f"ยังต้องใช้คาบสุดท้ายอยู่ {sum(full.values())} คาบ ใน "
                f"{len(full)} ห้อง — ห้องเหล่านี้มีวิชาเกินกว่าคาบ 1-{upto} จะรับไหว "
                f"({', '.join(f'{n} {c}' for n, c in top[:5])}"
                f"{' …' if len(top) > 5 else ''})"
            )
        if tail_open:
            # ห้องกลุ่มนี้ไม่ได้วิชาล้น ช่องว่างยังเหลือ แต่ย้ายขึ้นมาไม่ได้
            # บอกชื่อห้อง จำนวนช่องที่เหลือ และเหตุที่ติด เพื่อให้ไปแก้ถูกที่
            shown = ", ".join(f"{n} (ว่าง {w} ช่อง — {why})"
                              for n, w, why in tail_open[:4])
            notes.append(
                f"มี {len(tail_open)} ห้องที่ยังนั่งถึงคาบสุดท้าย ทั้งที่สัปดาห์ยัง"
                f"มีช่องว่างเหลือ — ไม่ใช่เพราะวิชาล้น แต่ย้ายขึ้นมาไม่ได้: {shown}"
                f"{' …' if len(tail_open) > 4 else ''}"
            )
        if not tail_left:
            notes.append("ไม่มีห้องไหนต้องเรียนถึงคาบสุดท้ายเลย")

    # Not a violation. Nothing is wrong with a timetable in which a teacher
    # has no last period — the school would rather that than keep a class
    # back — so this is reported as a note and does not make the run
    # INFEASIBLE the way an unplaced lesson does.
    missing_last = sorted(
        t["name"] for t in teaching
        if last_period_shortfall(t["id"]) > 0
    ) if tail_mode == "free" else []
    if missing_last:
        notes.append(
            f"ครู {len(missing_last)} คนไม่ได้เวรคาบสุดท้าย — "
            f"ไม่ใช่ข้อผิดพลาด ระบบจัดให้นักเรียนเลิกเรียนเร็วไว้ก่อน "
            f"({', '.join(missing_last[:4])}{' …' if len(missing_last) > 4 else ''})"
        )

    # Said out loud, because it changes what the school will see on the other
    # screens: rows they may remember adding are no longer there.
    if tidy["merged"]:
        notes.append(
            f"รวมรายวิชาที่เขียนซ้ำ {tidy['merged']} แถว — ห้องเดียวกันวิชาเดียวกัน "
            f"ที่มีแถวหนึ่งยังไม่ได้เลือกครู ถือเป็นคาบเดียวกัน จึงไม่ถูกจัดซ้ำสองรอบ"
        )
    if tidy["teachers_filled"]:
        notes.append(
            f"เติมครูให้แถวในเซ็ตที่เว้นไว้ {tidy['teachers_filled']} แถว "
            f"โดยใช้ครูที่สอนวิชานั้นอยู่แล้ว"
        )

    # ห้องที่อยู่ประจำชั้น: the lessons that could not stay in their room.
    # A note, not a violation — the lesson is taught, just not where the class
    # wanted it, and that is the school's to know rather than to fix by hand.
    notes.extend(_stay_home_notes(
        [s for s in SLOTS if s["id"] not in slots_before],
        {gid: g.get("homeroom_room_id") or anchor_room.get(gid)
         for gid, g in g_map.items()},
        lambda s: (req_room.get((s["group_id"], s.get("subject_id"), s.get("teacher_id")))
                   == s.get("room_id") and s.get("room_id") is not None)
                  or (s["group_id"], s["day"], s["period"]) in pick_at))

    status = "FEASIBLE" if not violations else "INFEASIBLE"
    LAST_RUN["unplaced_requirement_ids"] = unplaced_ids
    LAST_RUN["skipped_requirement_ids"] = sorted(skipped_reqs)
    return {
        "status": status,
        "slots_created": created,
        "solve_time_seconds": round(_time.perf_counter() - _t0, 2),
        "objective_value": float(created * 10),
        "violations": violations,
        "notes": notes,
        "engine": "greedy",
        "unplaced_requirement_ids": unplaced_ids,
        "skipped_requirement_ids": sorted(skipped_reqs),
        "max_consecutive": consec_hard,
        "prefer_consecutive": consec_soft,
        "consecutive": _consecutive_report(),
        "walking": _walking_report(),
        "last_period": last_period_stats,
        # คาบที่ลงได้เพราะขยับห้องให้ — worth saying out loud, because it is
        # the difference between "ลงไม่ได้" and a lesson in a room.
        "rescued_by_room_shuffle": rescued_by_shuffle,
        "elective_doubles_repaired": healed_doubles,
        # แถวที่ถูกรวมเพราะเป็นคาบเดียวกัน และครูที่ยืมมาให้เซ็ต
        "rows_merged": tidy["merged"],
        "set_teachers_filled": tidy["teachers_filled"],
    }





# ── ตรวจความสอดคล้องของข้อมูล ────────────────────────────────────────────────
#
# "ฉันแก้จุดหนึ่ง อีกจุดก็มีปัญหา เหมือนกับว่าข้อมูลทั้งหมดไม่ซิงค์กัน"
#
# The school's data says the same thing in more than one place on purpose —
# a class names its ห้องประจำชั้น and the room names its class; a lesson in
# the timetable carries the teacher's NAME as well as their id, so a printed
# sheet needs nothing else. That is fine while the two agree. The trouble is
# that nothing was checking, so a rename here and a delete there left the
# halves disagreeing, and the only way to find out was for a timetable to
# come out wrong weeks later.
#
# This walks every one of those pairs and reports where they have come apart.
# Each finding says how many, shows a few, and whether ซ่อมอัตโนมัติ can put
# it right — which it only claims when the answer is not a judgement call.

def _consistency_findings() -> list[dict[str, Any]]:
    g_map = {g["id"]: g for g in _flat_groups()}
    t_map = {t["id"]: t for t in TEACHERS}
    s_map = {s["id"]: s for s in SUBJECTS}
    r_map = {r["id"]: r for r in ROOMS}
    d_map = {d["id"]: d for d in DEPARTMENTS}
    b_ids = {b["id"] for b in BUILDINGS}
    out: list[dict[str, Any]] = []

    def add(code, title, why, rows, fix=None, severity="warning", examples=None,
            collapsed=False):
        """examples: ข้อความที่จะโชว์ ถ้าไม่ส่งมาก็เอาแปดบรรทัดแรกของ rows

        มีไว้สำหรับหัวข้อที่บรรทัดส่วนใหญ่ซ้ำกันเอง — ถ้าปัญหาเดียวกันเกิด 14
        ห้อง มันจะกินช่องตัวอย่างทั้งแปดช่อง แล้วปัญหาอีกแบบที่เกิดห้องเดียว
        จะมองไม่เห็นเลย ทั้งที่เป็นคนละเรื่องกันและต้องแก้คนละแบบ
        """
        if rows:
            out.append({"code": code, "title": title, "why": why,
                        "count": len(rows),
                        "examples": (examples if examples is not None else rows)[:8],
                        "fixable": bool(fix), "fix": fix, "severity": severity,
                        # ตัวอย่างถูกยุบรวมแล้ว หน้าจอจึงต้องไม่พูดว่า "และอีก N
                        # รายการ" เพราะบรรทัดที่เห็นครอบคลุมทั้งหมดอยู่แล้ว
                        "collapsed": collapsed})

    def gname(i):
        g = g_map.get(i)
        return g["name"] if g else f"#{i}"

    # ── 1. อ้างถึงของที่ไม่มีอยู่แล้ว ────────────────────────────────────────
    rows = [f"{gname(r['group_id'])} · {(s_map.get(r.get('subject_id')) or {}).get('code', r.get('subject_id'))}"
            for r in REQUIREMENTS if r.get("group_id") not in g_map]
    add("req_group", "รายวิชาที่ผูกกับห้องเรียนที่ไม่มีแล้ว",
        "ลงตารางไม่ได้เลย และแก้จากหน้าห้องเรียนก็ไม่ได้", rows,
        fix="ลบแถวเหล่านี้", severity="blocking")

    rows = [f"{gname(r['group_id'])} · วิชา #{r.get('subject_id')}"
            for r in REQUIREMENTS if r.get("subject_id") not in s_map]
    add("req_subject", "รายวิชาที่ผูกกับวิชาที่ถูกลบไปแล้ว",
        "ลงตารางไม่ได้ และไม่มีชื่อวิชาให้อ่าน", rows,
        fix="ลบแถวเหล่านี้", severity="blocking")

    rows = [f"{gname(r['group_id'])} · {(s_map.get(r.get('subject_id')) or {}).get('code', '?')} → ครู #{r['teacher_id']}"
            for r in REQUIREMENTS if r.get("teacher_id") and r["teacher_id"] not in t_map]
    add("req_teacher", "รายวิชาที่ผูกกับครูที่ถูกลบไปแล้ว",
        "ตารางจะจองเวลาให้ครูที่ไม่มีอยู่", rows,
        fix="ล้างครูออกจากแถวเหล่านี้", severity="blocking")

    rows = [f"{gname(r['group_id'])} · {(s_map.get(r.get('subject_id')) or {}).get('code', '?')}"
            for r in REQUIREMENTS
            if r.get("co_teacher_id") and r["co_teacher_id"] not in t_map]
    add("req_coteacher", "ครูสอนร่วมที่ถูกลบไปแล้ว",
        "คาบจะถูกจองให้ครูที่ไม่มีอยู่", rows, fix="ล้างครูสอนร่วมออก")

    rows = [f"{gname(r['group_id'])} · {(s_map.get(r.get('subject_id')) or {}).get('code', '?')} → ห้อง #{r['room_id']}"
            for r in REQUIREMENTS if r.get("room_id") and r["room_id"] not in r_map]
    add("req_room", "รายวิชาที่กำหนดห้องเรียนที่ถูกลบไปแล้ว",
        "วิชานี้จะหาห้องไม่ได้ตลอดไป เพราะห้องที่กำหนดไว้ไม่มีอยู่", rows,
        fix="ล้างห้องที่กำหนดไว้ออก", severity="blocking")

    # ── 2. คาบในตารางที่อ้างถึงของที่หายไป ───────────────────────────────────
    rows = [f"วัน {s.get('day')} คาบ {s.get('period')} · {gname(s.get('group_id'))}"
            for s in SLOTS if s.get("group_id") not in g_map]
    add("slot_group", "คาบในตารางของห้องเรียนที่ไม่มีแล้ว",
        "ขึ้นในตารางแต่ไม่มีใครเรียน", rows, fix="ลบคาบเหล่านี้")

    rows = [f"วัน {s.get('day')} คาบ {s.get('period')} · {gname(s.get('group_id'))}"
            for s in SLOTS if s.get("teacher_id") and s["teacher_id"] not in t_map]
    add("slot_teacher", "คาบในตารางของครูที่ถูกลบไปแล้ว",
        "ตารางครูจะไม่ตรงกับตารางห้อง", rows, fix="ลบคาบเหล่านี้")

    rows = [f"วัน {s.get('day')} คาบ {s.get('period')} · {gname(s.get('group_id'))} → ห้อง #{s['room_id']}"
            for s in SLOTS if s.get("room_id") and s["room_id"] not in r_map]
    add("slot_room", "คาบในตารางที่อยู่ในห้องที่ถูกลบไปแล้ว",
        "ตารางห้องสอนจะว่าง ทั้งที่ตารางเรียนบอกว่ามีคาบ", rows,
        fix="ล้างห้องออกจากคาบเหล่านี้")

    # ── 3. ชื่อที่ค้างอยู่ในตาราง หลังเปลี่ยนชื่อจริง ────────────────────────
    stale = []
    for s in SLOTS:
        for field, src, key in (("teacher_name", t_map.get(s.get("teacher_id")), "name"),
                                ("group_name",   g_map.get(s.get("group_id")), "name"),
                                ("subject_name", s_map.get(s.get("subject_id")), "name"),
                                ("subject_code", s_map.get(s.get("subject_id")), "code"),
                                ("room_name",    r_map.get(s.get("room_id")), "name")):
            if src and s.get(field) is not None and s.get(field) != src.get(key):
                stale.append(f"{gname(s.get('group_id'))} วัน {s.get('day')} คาบ {s.get('period')}: "
                             f"{s.get(field)} → {src.get(key)}")
                break
    add("stale_names", "ชื่อที่ค้างอยู่ในตาราง",
        "เปลี่ยนชื่อครู/ห้อง/วิชาแล้ว แต่คาบที่ลงไว้ยังเป็นชื่อเดิม "
        "ตารางที่พิมพ์ออกไปจึงเป็นชื่อเก่า", stale,
        fix="อัปเดตชื่อในคาบเหล่านี้")

    # ── 4. ของที่กันไว้ให้คนหรือห้องที่ไม่มีแล้ว ─────────────────────────────
    rows = [f"{r['name']} → ครู #{', '.join(str(x) for x in sorted(_room_reserved_for(r) - set(t_map)))}"
            for r in ROOMS if _room_reserved_for(r) - set(t_map)]
    add("room_teacher_gone", "ห้องที่กันไว้ให้ครูที่ถูกลบไปแล้ว",
        "ห้องนั้นถูกล็อกไว้ให้คนที่ไม่มีอยู่ ครูคนอื่นจึงใช้ไม่ได้เลย", rows,
        fix="ปลดชื่อครูที่ไม่มีแล้วออกจากห้อง", severity="blocking")

    rows = [f"{r['name']} → ห้องเรียน #{', '.join(str(x) for x in sorted(set(r.get('reserved_group_ids') or []) - set(g_map)))}"
            for r in ROOMS
            if set(r.get("reserved_group_ids") or []) - set(g_map)]
    add("room_group_gone", "ห้องที่กันไว้ให้ชั้นเรียนที่ไม่มีแล้ว",
        "ห้องถูกกันไว้ให้ห้องเรียนที่ถูกลบไปแล้ว", rows,
        fix="ปลดชั้นเรียนที่ไม่มีแล้วออกจากห้อง")

    rows = [f"{t['name']} → ห้อง #{t['fixed_room_id']}"
            for t in TEACHERS if t.get("fixed_room_id") and t["fixed_room_id"] not in r_map]
    add("teacher_room_gone", "ครูที่ผูกกับห้องประจำที่ถูกลบไปแล้ว",
        "ระบบจะพยายามพาคาบของครูไปห้องที่ไม่มีอยู่", rows,
        fix="ล้างห้องประจำของครูเหล่านี้")

    rows = [f"{g['name']} → ห้อง #{g['homeroom_room_id']}"
            for g in _flat_groups()
            if g.get("homeroom_room_id") and g["homeroom_room_id"] not in r_map]
    add("group_room_gone", "ห้องเรียนที่ผูกกับห้องประจำชั้นที่ถูกลบไปแล้ว",
        "นักเรียนจะถูกจัดไปห้องที่ไม่มีอยู่", rows,
        fix="ล้างห้องประจำชั้นเหล่านี้")

    rows = [f"{g['name']} → ครู #{i}" for g in _flat_groups()
            for i in _homeroom_ids(g) if i not in t_map]
    add("group_teacher_gone", "ครูประจำชั้นที่ถูกลบไปแล้ว",
        "ใบรายชื่อจะพิมพ์ออกมาว่าง", rows, fix="ปลดครูที่ไม่มีแล้วออก")

    rows = [f"{s.get('code')} → ห้อง #{i}" for s in SUBJECTS
            for i in _subject_rooms(s) if i not in r_map]
    add("subject_room_gone", "วิชาที่กำหนดห้องประจำวิชาที่ถูกลบไปแล้ว",
        "วิชานี้จะหาห้องไม่ได้", rows, fix="ล้างห้องที่ไม่มีแล้วออกจากวิชา",
        severity="blocking")

    rows = [f"{s.get('code')} → ตึก #{i}" for s in SUBJECTS
            for i in _subject_buildings(s) if i not in b_ids]
    add("subject_building_gone", "วิชาที่จำกัดตึกที่ถูกลบไปแล้ว",
        "ไม่มีห้องไหนอยู่ในตึกนั้น วิชานี้จึงลงไม่ได้เลย", rows,
        fix="ล้างตึกที่ไม่มีแล้วออกจากวิชา", severity="blocking")

    rows = [f"{s.get('code')} → กลุ่มสาระ #{s['department_id']}" for s in SUBJECTS
            if s.get("department_id") and s["department_id"] not in d_map]
    add("subject_dept_gone", "วิชาที่อยู่ในกลุ่มสาระที่ถูกลบไปแล้ว",
        "การจัดห้องตามกลุ่มสาระจะไม่ทำงานกับวิชานี้", rows,
        fix="ล้างกลุ่มสาระออกจากวิชา")

    # ── 5. สองฝั่งไม่ตรงกัน ──────────────────────────────────────────────────
    rows = []
    for r in ROOMS:
        gid = r.get("homeroom_group_id")
        if gid and g_map.get(gid, {}).get("homeroom_room_id") not in (None, r["id"]):
            rows.append(f"ห้อง {r['name']} บอกว่าเป็นของ {gname(gid)} "
                        f"แต่ {gname(gid)} บอกว่าอยู่ห้องอื่น")
    add("homeroom_disagree", "ห้องประจำชั้นสองฝั่งไม่ตรงกัน",
        "หน้าห้องเรียนกับหน้าห้องสอนบอกคนละอย่าง", rows,
        fix="ให้ยึดตามที่ตั้งไว้ในหน้าห้องเรียน")

    rows = []
    for g in _flat_groups():
        p = g.get("parent_id")
        if p and (p not in g_map
                  or not any((c["id"] if isinstance(c, dict) else c) == g["id"]
                             for c in (g_map.get(p, {}).get("children") or []))):
            rows.append(f"{g['name']} บอกว่าเป็นห้องย่อยของ #{p}")
    add("group_tree", "ห้องย่อยที่หลุดจากห้องแม่",
        "ห้องย่อยบอกว่ามีห้องแม่ แต่ห้องแม่ไม่มีมันอยู่ในรายการ "
        "การตรวจคาบซ้อนของห้องแม่-ห้องลูกจะพลาด", rows,
        fix="ผูกกลับเข้าห้องแม่", severity="blocking")

    # ── 5b. รหัสวิชาไม่ตรงกับชั้นที่เรียน ───────────────────────────────────
    miss = _subject_year_mismatches()
    rows = [f"{m['group']} · {m['code']} → ควรเป็น {m['want_code']}"
            f"{'' if m['target'] else ' (ยังไม่มีวิชานี้ในระบบ จะสร้างให้)'}"
            for m in miss]
    # ยุบบรรทัดที่เป็นปัญหาเดียวกันให้เหลือบรรทัดเดียว พร้อมบอกว่ากี่ห้อง
    # ไม่งั้น พ21104 ที่ผิดอยู่ 14 ห้องจะกินช่องตัวอย่างทั้งหมด แล้วรหัสอื่นที่
    # ผิดอยู่ห้องเดียวจะไม่มีวันถูกเห็น
    by_pair: dict[tuple, list] = defaultdict(list)
    for m in miss:
        by_pair[(m["code"], m["want_code"], m["target"] is None)].append(m["group"])
    examples = []
    for (code_, want_, is_new), names in sorted(
            by_pair.items(), key=lambda kv: (-len(kv[1]), kv[0][0])):
        who = ", ".join(sorted(names)[:3]) + (" …" if len(names) > 3 else "")
        examples.append(
            f"{code_} → ควรเป็น {want_} · {len(names)} ห้อง ({who})"
            f"{' — ยังไม่มีวิชานี้ในระบบ จะสร้างให้' if is_new else ''}")
    add("subject_year", "รหัสวิชาไม่ตรงกับชั้นที่เรียน",
        "รหัสวิชาบอกชั้นอยู่ในตัวมันเอง — พ22104 คือ ม.2 ส่วน พ21104 คือ ม.1 "
        "ห้องที่ถือรหัสผิดชั้นจะพิมพ์ออกใบ ปพ. ผิด และเทียบกับหลักสูตรไม่ตรง "
        "(รายวิชาเพิ่มเติมที่เลขปีเป็น 0 เช่น พ20202 ใช้ได้ทุกชั้น ไม่นับว่าผิด) · "
        "กดซ่อมแล้วแถวเหล่านี้จะย้ายไปใช้วิชาที่รหัสตรงชั้น ถ้ายังไม่มีวิชานั้นในระบบ "
        "จะสร้างให้ โดยยกกลุ่มสาระ คาบคู่/คาบเดี่ยว และหน่วยกิตมาจากวิชาเดิม "
        "ส่วนชื่อเอามาจากวิชาพี่น้องที่รหัสลงท้ายเหมือนกัน ควรเปิดดูแล้วแก้ชื่อให้ตรง "
        "หลักสูตรอีกครั้ง · วิชาเดิมไม่ถูกแตะ เพราะห้องชั้นอื่นยังใช้รหัสนั้นถูกต้องอยู่",
        rows,
        fix="ย้ายไปใช้วิชาที่รหัสตรงชั้น",
        examples=examples, collapsed=True)

    # ── 6. เซ็ตห้องย่อยที่ข้อมูลในเซ็ตไม่ตรงกันเอง ───────────────────────────
    by_key: dict[str, list] = defaultdict(list)
    for r in REQUIREMENTS:
        if r.get("parallel_group_key"):
            by_key[r["parallel_group_key"]].append(r)
    rows = []
    for key, grp in by_key.items():
        pins = {(r.get("pinned_day"), r.get("pinned_period"), bool(r.get("pinned_double")))
                for r in grp}
        if len(pins) > 1:
            rows.append(f"{key.split(':')[-1]} — {len(pins)} แบบ: {sorted(pins)}")
    add("set_pins", "เซ็ตห้องย่อยที่แต่ละห้องล็อกเวลาไว้ไม่ตรงกัน",
        "ทุกห้องในเซ็ตต้องเรียนชั่วโมงเดียวกัน ถ้าล็อกไว้คนละคาบ เซ็ตจะลงไม่ได้", rows,
        fix="ใช้เวลาที่ล็อกไว้ของแถวแรกกับทุกแถวในเซ็ต", severity="blocking")

    # ── 7. วิชาเดียวกันของห้องเดียวกัน เขียนไว้ซ้ำ ───────────────────────────
    pair: dict[tuple, list] = defaultdict(list)
    for r in REQUIREMENTS:
        pair[(r.get("group_id"), r.get("subject_id"))].append(r)
    rows = [f"{gname(k[0])} · {(s_map.get(k[1]) or {}).get('code', k[1])} ({len(v)} แถว)"
            for k, v in pair.items() if len(v) > 1
            and len({x["teacher_id"] for x in v if x.get("teacher_id")}) <= 1
            and len({x["parallel_group_key"] for x in v if x.get("parallel_group_key")}) <= 1]
    add("dup_rows", "วิชาเดียวกันของห้องเดียวกันเขียนไว้หลายแถว",
        "คาบจะถูกจัดซ้ำ ห้องเรียนได้คาบเกินที่ควรเป็น", rows,
        fix="รวมเป็นแถวเดียว")

    # ── 8. คาบที่ล็อกเวลาไว้บนคาบที่ไม่มีอยู่จริง ────────────────────────────
    rows = []
    for r in REQUIREMENTS:
        p = r.get("pinned_period")
        if p is None:
            continue
        lvl = _level_key(g_map.get(r.get("group_id")))
        if p not in _class_periods_for_level(lvl):
            rows.append(f"{gname(r['group_id'])} · "
                        f"{(s_map.get(r.get('subject_id')) or {}).get('code', '?')} → คาบ {p}")
    add("pin_period", "คาบที่ล็อกไว้บนคาบที่ไม่ใช่คาบเรียนของระดับชั้นนั้น",
        "เช่น ล็อกไว้ที่คาบพัก หรือคาบที่ระดับชั้นนั้นไม่มี — จะลงไม่ได้ตลอดไป", rows,
        fix="ปลดล็อกเวลาของแถวเหล่านี้", severity="blocking")

    rows = []
    for s in SLOTS:
        lvl = _level_key(g_map.get(s.get("group_id")))
        if s.get("period") not in _class_periods_for_level(lvl):
            rows.append(f"{gname(s.get('group_id'))} วัน {s.get('day')} คาบ {s.get('period')}")
    add("slot_period", "คาบในตารางที่ตกอยู่บนคาบพักหรือคาบที่ระดับชั้นนั้นไม่มี",
        "มักเกิดหลังแก้ตารางเวลา — คาบยังอยู่ที่เดิมทั้งที่คาบนั้นไม่มีแล้ว", rows,
        fix="ลบคาบเหล่านี้")

    # ── 9. วงคาบเสรี ─────────────────────────────────────────────────────────
    rows = [f"{p.get('name')} → ห้องเรียน #{i}" for p in ELECTIVE_POOLS
            for i in (p.get("group_ids") or []) if i not in g_map]
    add("pool_group", "วงคาบเสรีที่มีห้องเรียนที่ถูกลบไปแล้ว",
        "จำนวนห้องที่เรียนวิชาเสรีจะไม่ตรง", rows, fix="ปลดห้องที่ไม่มีแล้วออกจากวง")

    rows = [f"{p.get('name')} → วิชา #{o.get('subject_id')} / ครู #{o.get('teacher_id')}"
            for p in ELECTIVE_POOLS for o in (p.get("options") or [])
            if o.get("subject_id") not in s_map
            or (o.get("teacher_id") and o["teacher_id"] not in t_map)]
    add("pool_option", "ตัวเลือกในวงคาบเสรีที่วิชาหรือครูถูกลบไปแล้ว",
        "นักเรียนเลือกวิชาที่ไม่มีอยู่", rows, fix="ลบตัวเลือกเหล่านี้")

    rows = [f"วัน {s.get('day')} คาบ {s.get('period')} · {gname(s.get('group_id'))}"
            for s in SLOTS if s.get("elective_pool_id")
            and s["elective_pool_id"] not in {p["id"] for p in ELECTIVE_POOLS}]
    add("slot_pool", "คาบเสรีในตารางที่วงของมันถูกลบไปแล้ว",
        "ลบวงแล้วแต่คาบยังค้างอยู่ในตาราง", rows, fix="ลบคาบเหล่านี้")

    # ── 10. คาบคู่ที่เหลือครึ่งเดียว ─────────────────────────────────────────
    halves: dict[str, list] = defaultdict(list)
    for s in SLOTS:
        if s.get("double_group_key"):
            halves[s["double_group_key"]].append(s)
    rows = [f"{gname(v[0].get('group_id'))} วัน {v[0].get('day')} คาบ {v[0].get('period')}"
            for v in halves.values() if len(v) == 1]
    add("half_double", "คาบคู่ที่เหลือครึ่งเดียว",
        "ขึ้นป้าย 2× แต่มีคาบเดียว", rows, fix="ซ่อมให้เป็นคาบคู่ หรือลบป้ายออก")

    # ── 11. กิจกรรมที่คาบไม่ตรงกันทั้งระดับ ──────────────────────────────────
    acts: dict[str, set] = defaultdict(set)
    for s in SLOTS:
        if s.get("activity_key"):
            acts[s["activity_key"]].add((s.get("day"), s.get("period")))
    rows = [f"{k} — {len(v)} เวลา" for k, v in acts.items() if len(v) > 1]
    add("activity_split", "คาบกิจกรรมที่กระจายอยู่หลายเวลา",
        "กิจกรรมเดียวกันควรอยู่เวลาเดียวกันทุกห้อง", rows)

    # ── 12. คาบที่ชนกันจริง ๆ ในตาราง ────────────────────────────────────────
    seen_t: dict[tuple, list] = defaultdict(list)
    seen_r: dict[tuple, list] = defaultdict(list)
    seen_g: dict[tuple, list] = defaultdict(list)
    for s in SLOTS:
        grp = g_map.get(s.get("group_id"))
        for bk in _slot_buckets(grp, s.get("period")):
            # คาบกรอบแดงถูกวางไว้ทั้งที่ยังชนครูอยู่ โดยตั้งใจ — มันคือคำถามที่
            # โรงเรียนต้องตอบ ไม่ใช่คำตอบที่ระบบให้ไว้ผิด จึงรายงานแยกต่างหาก
            # ข้างล่าง แทนที่จะปนอยู่ในรายการครูชนกัน
            if not s.get("is_overflow"):
                for t in _slot_teachers(s):
                    seen_t[(t, s.get("day"), bk)].append(s)
            if s.get("room_id"):
                seen_r[(s["room_id"], s.get("day"), bk)].append(s)
        seen_g[(s.get("group_id"), s.get("day"), s.get("period"))].append(s)

    def real_clash(group_of_slots):
        """More than one lesson, and not the same shared lesson seen twice."""
        if len(group_of_slots) < 2:
            return False
        first = group_of_slots[0]
        return not all(_same_activity(first, x) for x in group_of_slots[1:])

    def clash_rows(seen: dict, label) -> list[str]:
        """หนึ่งการชน หนึ่งบรรทัด — และบอกคาบไว้ด้วยว่าไปดูที่ไหน

        ดัชนีข้างบนเป็นช่วงละ 5 นาที คาบละ 50 นาทีจึงเป็น 10 ช่วง การชนครั้ง
        เดียวเคยกลายเป็น 10 รายการ หน้านี้จึงขึ้นว่า "ห้องเรียนถูกใช้สองคาบ
        พร้อมกัน 10 รายการ" ทั้งที่มีอยู่คู่เดียว — ตัวเลขที่โรงเรียนอ่านต้อง
        เป็นจำนวนเรื่องที่ต้องไปแก้ ไม่ใช่จำนวนนาทีที่เรื่องนั้นกินเวลา
        และบรรทัดเดิมไม่มีเลขคาบอยู่เลย จึงไม่มีทางรู้ว่าต้องไปเปิดช่องไหน
        """
        out: dict[tuple, str] = {}
        for k, v in seen.items():
            if not (real_clash(v) and len({x.get("group_id") for x in v}) > 1
                    and not _one_roomful(v, g_map)):
                continue
            key = (k[0], k[1], frozenset(id(x) for x in v))
            if key in out:
                continue
            day = (_DAYS_TH[k[1]] if isinstance(k[1], int) and 0 <= k[1] < len(_DAYS_TH)
                   else f"วัน {k[1]}")
            per = "/".join(str(p) for p in sorted(
                {x.get("period") for x in v if x.get("period") is not None}))
            out[key] = (f"{label(k[0])} {day} คาบ {per}: "
                        + " / ".join(sorted({gname(x.get('group_id')) for x in v})))
        return list(out.values())

    rows = clash_rows(seen_t, lambda t: f"ครู {t_map.get(t, {}).get('name', t)}")
    add("clash_teacher", "ครูอยู่สองที่พร้อมกัน",
        "ยกเว้นกรณีสอนร่วมหรือสอนห้องย่อยพี่น้องพร้อมกันในวิชาเดียวกัน", rows,
        severity="blocking")

    rows = clash_rows(seen_r, lambda r: f"ห้อง {r_map.get(r, {}).get('name', r)}")
    add("clash_room", "ห้องเรียนถูกใช้สองคาบพร้อมกัน",
        "ยกเว้นห้องย่อยพี่น้องที่เรียนวิชาเดียวกันกับครูคนเดียวกัน", rows,
        severity="blocking")

    rows = [f"{gname(k[0])} วัน {k[1]} คาบ {k[2]}" for k, v in seen_g.items()
            if real_clash(v)]
    add("clash_group", "ห้องเรียนมีสองคาบในชั่วโมงเดียวกัน",
        "นักเรียนห้องเดียวอยู่สองที่พร้อมกันไม่ได้", rows, severity="blocking")

    # คาบกรอบแดงไม่ถูกนับที่นี่ — หน้านี้ตรวจว่า "ข้อมูลตรงกันไหม" ไม่ใช่
    # "จัดครบไหม" คาบที่ยังจัดไม่ลงตัวมีที่ของมันอยู่แล้วสองที่: รายการวิชาที่
    # ลงไม่ได้ และหน้าตรวจคาบ 9/คาบว่าง

    # ── 13. แผนกับตารางไม่ตรงกัน ─────────────────────────────────────────────
    skipped = _excluded_requirement_ids({})
    co_halves, _ = _fold_coteaching(REQUIREMENTS)
    placed: dict[tuple, int] = defaultdict(int)
    for s in SLOTS:
        if s.get("subject_id") is not None:
            placed[(s.get("group_id"), s.get("subject_id"))] += 1
    # Summed per (ห้องเรียน, วิชา), not per row. A class can take one subject
    # from two different เซ็ต — ม.4/6ข does ว30286 in the first hour's set and
    # again in the second's, one period each — and asking each row on its own
    # whether the timetable has too many made every one of those look wrong.
    asked: dict[tuple, int] = defaultdict(int)
    for r in REQUIREMENTS:
        if r["id"] in skipped or r["id"] in co_halves:
            continue
        asked[(r.get("group_id"), r.get("subject_id"))] += r.get("weekly_count") or 0
    rows = []
    for key, want in asked.items():
        got = placed.get(key, 0)
        if got > want:
            rows.append(f"{gname(key[0])} · "
                        f"{(s_map.get(key[1]) or {}).get('code', '?')} "
                        f"— แผนว่า {want} คาบ แต่ในตารางมี {got}")
    add("over_placed", "ในตารางมีคาบมากกว่าที่แผนการสอนบอกไว้",
        "มักเกิดจากการเพิ่มคาบในตารางด้วยมือ หรือแถวที่เขียนซ้ำ", rows)

    order = {"blocking": 0, "warning": 1}
    out.sort(key=lambda f: (order.get(f["severity"], 2), -f["count"]))
    return out


@app.get("/api/diagnostics/consistency")
def consistency_check():
    findings = _consistency_findings()
    return {
        "findings": findings,
        "total": sum(f["count"] for f in findings),
        "blocking": sum(f["count"] for f in findings if f["severity"] == "blocking"),
        "checked": {
            "requirements": len(REQUIREMENTS), "slots": len(SLOTS),
            "groups": len(_flat_groups()), "teachers": len(TEACHERS),
            "subjects": len(SUBJECTS), "rooms": len(ROOMS),
            "pools": len(ELECTIVE_POOLS),
        },
    }


# ── ของที่สั่งไว้ ใส่ลงได้ไหม ─────────────────────────────────────────────────
#
# "คุณช่วยลองหาแนวทางในการลงวิชาต่างๆให้ได้หน่อย โดยยังมีคาบว่างอยู่ให้ลงคาบให้
#  พอดีให้ได้"
#
# เวลาตารางออกมาไม่พอดี สิ่งแรกที่ทุกคนมองคือวิธีจัด แต่บางครั้งมันไม่ใช่วิธีจัด
# ที่ลงให้ไม่ได้ — มันคือของที่สั่งไว้เกินกว่าที่โรงเรียนมี และไม่มีวิธีจัดแบบไหน
# ที่ใส่ 92 คาบลงในห้องที่มี 35 ช่องได้
#
# หน้านี้จึงนับของสองฝั่งมาวางเทียบกันตรงๆ ก่อนจะกดจัดตาราง: ฝั่งที่สั่งไว้
# (หลักสูตรกี่คาบ ผูกห้องอะไรไว้) กับฝั่งที่มี (คาบในผัง ห้องที่ใช้ได้) ส่วนที่
# เกินคือส่วนที่จะไปโผล่เป็นคาบสุดท้าย เป็นคาบไม่มีห้อง หรือลงไม่ครบ ไม่ว่าจะ
# กดจัดใหม่อีกกี่ครั้ง

def _room_week_capacity() -> int:
    """ห้องหนึ่งห้องรับได้กี่คาบต่อสัปดาห์

    นับทุกเลขคาบที่มีชั้นใดชั้นหนึ่งใช้เรียน คูณห้าวัน — ห้องหนึ่งห้องอยู่ได้
    ห้องเดียวต่อหนึ่งช่องเวลา ไม่ว่าชั้นไหนจะมาใช้ เพดานจึงคิดจากผังคาบจริง
    ไม่ใช่เลขตายตัว เพราะโรงเรียนเพิ่มหรือลดคาบได้ตลอด
    """
    levels = {_level_key(g) for g in _flat_groups()} or {"all"}
    nums = {p for lvl in levels for p in _class_periods_for_level(lvl)}
    return len(nums) * 5


def _capacity_findings() -> list[dict[str, Any]]:
    """ของที่สั่งไว้ กับช่องที่มีจริง — ส่วนที่เกินคือส่วนที่ลงไม่ได้"""
    _lookup_cache_clear()
    groups = _flat_groups()
    g_map = {g["id"]: g for g in groups}
    s_map = {s["id"]: s for s in SUBJECTS}
    r_map = {r["id"]: r for r in ROOMS}
    t_map = {t["id"]: t for t in TEACHERS}
    d_map = {d["id"]: d for d in DEPARTMENTS}
    out: list[dict[str, Any]] = []

    def add(code, title, why, rows, examples, fix, kind="over"):
        """kind="short" = สั่งไว้ "น้อยกว่า" ที่มี ซึ่งเป็นคนละเรื่องกับส่วนเกิน

        หน้าจอนี้พูดเรื่องส่วนเกินทั้งหน้า ("ทุกบรรทัดคือส่วนที่เกินกว่าที่มี")
        การเอาส่วนที่ขาดมานับรวมในเลขเดียวกันจะทำให้ตัวเลขบนหัวจอผิดความหมาย
        จึงแยก kind ไว้ แล้วให้หน้าจอกับ total เลือกเองว่าจะนับอันไหน
        """
        if rows:
            out.append({"code": code, "title": title, "why": why,
                        "count": len(rows), "rows": rows, "kind": kind,
                        "examples": examples[:8], "fixable": True,
                        "fix": fix, "severity": "warning"})

    # ── 1. ห้องเรียนที่หลักสูตรสั่งเกินกว่าสัปดาห์จะรับไหว ──────────────────
    #
    # เทียบกับคาบ 1 ถึงคาบก่อนคาบสุดท้าย เพราะคาบสุดท้ายโรงเรียนขอให้ไว้ใช้
    # เมื่อจำเป็น ส่วนที่เกินคือจำนวนคาบที่ต้องไปนอนคาบสุดท้ายอย่างเลี่ยงไม่ได้
    need = Counter()
    for q in REQUIREMENTS:
        need[q["group_id"]] += q.get("weekly_count") or 0
    rows = []
    for g in groups:
        if g.get("parent_id"):
            continue                      # นับรวมอยู่ในห้องแม่แล้ว
        kids = [c["id"] for c in (g.get("children") or [])]
        # ห้องย่อยเรียนพร้อมกัน ครอบครัวจึงกินเวลาเท่าห้องย่อยที่หนักที่สุด
        want = need[g["id"]] + max([need[k] for k in kids] or [0])
        nums = _class_periods_for_level(_level_key(g))
        cap = max(0, len(nums) - 1) * 5
        if not nums or want <= cap:
            continue
        rows.append({"group_id": g["id"], "name": g.get("name"),
                     "need": want, "capacity": cap, "over": want - cap,
                     "last_period_num": nums[-1],
                     "before_last_num": nums[-2] if len(nums) > 1 else nums[-1]})
    rows.sort(key=lambda r: -r["over"])
    add("class_over_week", "ห้องเรียนที่หลักสูตรสั่งเกินกว่าคาบที่มี",
        "ส่วนที่เกินต้องไปอยู่คาบสุดท้ายของวัน ไม่ว่าจะกดจัดตารางใหม่อีกกี่ครั้ง "
        "เพราะคาบก่อนหน้าเต็มไปแล้วจริงๆ",
        rows,
        [f"{r['name']} — หลักสูตรสั่ง {r['need']} คาบ แต่คาบ 1 ถึงคาบ "
         f"{r['before_last_num']} มี {r['capacity']} ช่อง เกิน {r['over']} คาบ"
         for r in rows],
        fix="ลดคาบในหลักสูตรของห้องนี้ หรือเพิ่มคาบเรียนในผังคาบ "
            "ถ้ายอมให้ใช้คาบสุดท้ายได้ ก็ตั้งที่หน้าตั้งค่าว่าใช้ได้ตามปกติ")

    # ── 1ข. ห้องเรียนที่แผนการสอนสั่งไม่เต็มสัปดาห์ ─────────────────────────
    #
    # ด้านตรงข้ามของข้อบน และเป็นคำตอบของคำถามที่ถามซ้ำมาหลายรอบว่า
    #
    #   "ปัญหายังอยู่เหมือนเดิมคือมีคาบว่าง แต่ก็ไม่สามารถลงคาบได้"
    #   "ช่วยทำให้ลงตารางให้ได้หน่อยไม่ว่าจะยังไง อาจจะทำสูตรการหาใหม่ก็ได้"
    #   "ม.1/5 มีห้องประจำแต่ไม่มีห้องเรียน"
    #
    # คาบว่างมีสองแบบคนละเรื่องกัน และแก้คนละทาง:
    #   ลงไม่ได้      — มีวิชาที่ต้องลง แต่หาที่ลงไม่ได้ → เรื่องของตัวจัดตาราง
    #   ไม่มีอะไรจะลง — แผนการสอนสั่งชั่วโมงน้อยกว่าช่องที่มี → เรื่องของแผน
    #
    # วัดบนข้อมูลของโรงเรียนด้วยผังคาบจริง: ลงไม่ได้ 0 คาบ ทุกวิชาที่แผนสั่งลง
    # ครบแล้ว ช่องที่เหลือจึงว่างเพราะไม่มีวิชาไหนขอใช้ ไม่ใช่เพราะหาที่ลงไม่ได้
    # — กดจัดใหม่อีกกี่ครั้งก็ไม่เปลี่ยน และเดิมไม่มีอะไรบนจอบอกเรื่องนี้เลย
    # กล่องเขียว "ทุกอย่างอยู่ในวิสัยที่จัดลงได้" ยังบอกต่อว่าถ้าตารางไม่ดีให้
    # ไปดูวิธีจัดวาง ซึ่งพาไปผิดทางเต็มที่
    #
    # เทียบกับคาบ 1 ถึงคาบก่อนคาบสุดท้าย ฐานเดียวกับข้อบน สองข้อนี้จึงเป็นด้าน
    # ตรงข้ามกันจริง ๆ และห้องหนึ่งเข้าได้ข้อเดียวเท่านั้น
    MIN_SHORT = 3        # ขาดหนึ่งสองคาบคือเรื่องปกติ ไม่ต้องรบกวนให้มาดู
    rows = []
    for g in groups:
        if g.get("parent_id"):
            continue                      # นับรวมอยู่ในห้องแม่แล้ว
        kids = [c["id"] for c in (g.get("children") or [])]
        want = need[g["id"]] + max([need[k] for k in kids] or [0])
        nums = _class_periods_for_level(_level_key(g))
        cap = max(0, len(nums) - 1) * 5
        if not nums or not want or cap - want < MIN_SHORT:
            continue
        rows.append({"group_id": g["id"], "name": g.get("name"),
                     "need": want, "capacity": cap, "short": cap - want,
                     # ช่องทั้งสัปดาห์รวมคาบสุดท้าย — capacity ข้างบนตัดคาบ
                     # สุดท้ายออกเพราะโรงเรียนขอเก็บไว้ใช้เมื่อจำเป็น สองเลข
                     # นี้ต่างกัน และหน้าจอต้องพูดถึงได้ทั้งคู่
                     "week": len(nums) * 5,
                     "last_period_num": nums[-1],
                     "before_last_num": nums[-2] if len(nums) > 1 else nums[-1]})
    rows.sort(key=lambda r: -r["short"])
    add("class_under_week", "ห้องเรียนที่แผนการสอนสั่งไม่เต็มสัปดาห์",
        "ช่องที่เหลือว่างเพราะไม่มีวิชาไหนขอใช้ ไม่ใช่เพราะตัวจัดตารางหาที่ลง "
        "ไม่ได้ — กดสร้างตารางใหม่อีกกี่ครั้งก็เท่าเดิม",
        rows,
        [f"{r['name']} — แผนการสอนสั่ง {r['need']} คาบ แต่คาบ 1 ถึงคาบ "
         f"{r['before_last_num']} มี {r['capacity']} ช่อง จึงว่าง {r['short']} คาบ"
         for r in rows],
        fix="ถ้าตั้งใจให้นักเรียนเลิกเร็วก็ถือว่าปกติ ไม่ต้องแก้ "
            "ถ้าไม่ใช่ ต้องไปเพิ่มชั่วโมงในแผนการสอนของห้องนี้",
        kind="short")

    # ── 2. ห้องประจำวิชาที่รับไม่ไหว ────────────────────────────────────────
    #
    # วิชาที่ผูกห้องไว้ต้องมาเรียนที่ห้องนั้น ทุกห้องเรียนในโรงเรียนจึงมาแย่ง
    # ห้องเดียวกัน ถ้าวิชาผูกไว้หลายห้อง (ห้องของกลุ่มสาระ) ก็หารกันในกลุ่มนั้น
    cap_room = _room_week_capacity()
    dept_rooms: dict[int, list[int]] = defaultdict(list)
    for r in ROOMS:
        if r.get("specialized_dept_id"):
            dept_rooms[r["specialized_dept_id"]].append(r["id"])
    # วิชามาถึงห้องได้สองทาง และวิธีแก้ของสองทางนี้ไม่เหมือนกัน จึงต้องแยกให้ชัด
    # ว่าแถวนี้มาจากทางไหน:
    #   subject     วิชาตั้งห้องประจำวิชาของตัวเองไว้ (fixed_room_ids) — แก้ที่วิชา
    #   department  ห้องถูกขึ้นทะเบียนเป็นห้องของกลุ่มสาระ แล้ววิชาในกลุ่มนั้นถูก
    #               พาไปลงห้องของกลุ่มก่อน — แก้ที่ห้องหรือที่กลุ่มสาระ
    pool_need: Counter = Counter()
    pool_subj: dict[frozenset, set] = defaultdict(set)
    pool_src: dict[frozenset, set] = defaultdict(set)
    pool_dept: dict[frozenset, set] = defaultdict(set)
    for q in REQUIREMENTS:
        n = q.get("weekly_count") or 0
        if not n:
            continue
        subj = s_map.get(q.get("subject_id")) or {}
        ids = [i for i in _subject_rooms(subj) if i in r_map]
        src = "subject"
        if not ids:
            ids = [i for i in (dept_rooms.get(subj.get("department_id")) or [])
                   if i in r_map]
            src = "department"
        if not ids:
            continue                      # วิชาที่ไม่ผูกห้อง ลงห้องไหนก็ได้
        key = frozenset(ids)
        pool_need[key] += n
        pool_subj[key].add(subj.get("code") or f"#{q.get('subject_id')}")
        pool_src[key].add(src)
        if src == "department":
            dept = d_map.get(subj.get("department_id")) or {}
            if dept.get("name"):
                pool_dept[key].add(dept["name"])
    rows = []
    for key, want in pool_need.items():
        cap = cap_room * len(key)
        if want <= cap:
            continue
        names = sorted((r_map.get(i) or {}).get("name") or f"#{i}" for i in key)
        srcs = pool_src[key]
        rows.append({"room_ids": sorted(key), "rooms": names,
                     "need": want, "capacity": cap, "over": want - cap,
                     "subjects": sorted(pool_subj[key]),
                     "source": ("both" if len(srcs) > 1 else next(iter(srcs))),
                     "departments": sorted(pool_dept[key])})
    rows.sort(key=lambda r: -r["over"])
    examples = []
    for r in rows:
        where = (f"{r['rooms'][0]} (ห้องเดียว)" if len(r["rooms"]) == 1
                 else f"{len(r['rooms'])} ห้อง: {', '.join(r['rooms'][:3])}"
                      + ("…" if len(r["rooms"]) > 3 else ""))
        if r["source"] == "subject":
            how = f"วิชา {len(r['subjects'])} รายการตั้งห้องนี้เป็นห้องประจำวิชา"
        elif r["departments"]:
            how = (f"เป็นห้องของ{'/'.join(r['departments'])} "
                   f"ซึ่งมีวิชา {len(r['subjects'])} รายการ")
        else:
            how = f"วิชา {len(r['subjects'])} รายการมาลงห้องนี้"
        examples.append(f"{where} — {how} รวม {r['need']} คาบ/สัปดาห์ "
                        f"แต่รับได้ {r['capacity']} เกิน {r['over']} คาบ")
    add("room_over_week", "ห้องของวิชาที่รับคาบไม่ไหว",
        f"ห้องหนึ่งห้องมีได้ {cap_room} คาบต่อสัปดาห์ตามผังคาบที่ตั้งไว้ "
        "ส่วนที่เกินระบบเอาไปลงห้องอื่นให้เงียบๆ อยู่แล้ว — โรงเรียนจึงเข้าใจว่า "
        "ทุกคาบของวิชานั้นอยู่ในห้องของมัน ทั้งที่จริงอยู่ได้เท่าที่ห้องรับไหว "
        "และในห้องที่ติ๊กว่าเรียนในห้องประจำชั้น ส่วนเกินนี้กลายเป็นคาบไม่มีห้อง",
        rows, examples,
        fix="เพิ่มห้องให้กลุ่มสาระนั้น (ตั้งที่หน้าห้องเรียน ช่องกลุ่มสาระของห้อง) "
            "หรือยอมรับว่าส่วนเกินเรียนในห้องธรรมดา · ถ้าแถวไหนขึ้นว่าเป็น"
            "ห้องประจำวิชา ก็ปลดออกจากวิชาที่ไม่ต้องใช้ห้องนั้นจริงๆ")

    # ── 3. ครูที่ชั่วโมงเกินเวลาที่ตัวเองมี ─────────────────────────────────
    t_need = Counter()
    for q in REQUIREMENTS:
        if q.get("teacher_id"):
            t_need[q["teacher_id"]] += q.get("weekly_count") or 0
    rows, examples = [], []
    for tid, want in t_need.items():
        teacher = t_map.get(tid)
        if not teacher or not tid:
            continue
        prefs = _teacher_prefs(teacher)
        days = 5 - len({d for d in prefs["days_off"] if 0 <= d < 5})
        per_day = cap_room // 5 - len(set(prefs["avoid_periods"]))
        cap = max(0, days * max(0, per_day))
        if want <= cap:
            continue
        rows.append({"teacher_id": tid, "name": teacher.get("name"),
                     "need": want, "capacity": cap, "over": want - cap})
        examples.append(f"{teacher.get('name')} — สอน {want} คาบ/สัปดาห์ "
                        f"แต่เวลาที่ว่างมี {cap} คาบ เกิน {want - cap} คาบ")
    rows.sort(key=lambda r: -r["over"])
    add("teacher_over_week", "ครูที่ชั่วโมงสอนเกินเวลาที่มี",
        "ส่วนที่เกินลงตารางไม่ได้เลย เพราะครูอยู่ได้ห้องเดียวต่อหนึ่งคาบ",
        rows, examples,
        fix="แบ่งวิชาบางรายการไปให้ครูคนอื่น หรือลดวันหยุด/คาบที่เลี่ยงของครูคนนี้")

    return out


@app.get("/api/diagnostics/capacity")
def capacity_check():
    """ของที่สั่งไว้ใส่ลงได้ไหม — อ่านเท่านั้น ไม่แก้ข้อมูล"""
    found = _capacity_findings()
    return {
        "findings": found,
        # total = ส่วนที่ "เกิน" เท่านั้น ส่วนที่ขาดนับแยก เพราะไม่ใช่ปัญหา
        # ของการจัดตาราง และหัวจอพูดถึงสองอย่างนี้คนละประโยค
        "total": sum(f["count"] for f in found if f.get("kind") != "short"),
        "short_total": sum(f["count"] for f in found if f.get("kind") == "short"),
        "room_week_capacity": _room_week_capacity(),
        "checked": {
            "requirements": len(REQUIREMENTS), "groups": len(_flat_groups()),
            "rooms": len(ROOMS), "teachers": len(TEACHERS),
        },
    }


def _period_check_rows() -> list[dict[str, Any]]:
    """คาบสุดท้ายกับคาบว่างของแต่ละห้อง เทียบกับที่โรงเรียนตั้งไว้

    "ฉันอยากได้ระบบเช็ค คาบ 9 กับ คาบว่าง ที่แต่ละห้องมี ถ้าตรงหรือเกินหรือขาด
     จะได้ช่วยกันดูได้"

    คาบว่าง นับเฉพาะช่องในคาบก่อนคาบสุดท้าย — คอลัมน์คาบสุดท้ายที่ว่างคือเลิก
    เรียนแล้ว ไม่ใช่คาบว่าง ซึ่งตรงกับที่โรงเรียนเขียนตารางมาให้ ("ม.4/6 ก ข
     ว่าง 2 คาบ" ทั้งที่คาบ 9 ว่างทั้งสัปดาห์อยู่แล้ว)

    ห้องย่อยนับเวลาของห้องแม่และพี่น้องสายตรงเป็นเวลาที่ไม่ว่างด้วย เพราะเป็น
    นักเรียนกลุ่มเดียวกัน
    """
    groups = _flat_groups()
    g_map = {g["id"]: g for g in groups}
    parent_of = {g["id"]: g.get("parent_id") for g in groups}
    kids: dict[int, list[int]] = defaultdict(list)
    for gid, pid in parent_of.items():
        if pid is not None:
            kids[pid].append(gid)

    def family(gid: int) -> set[int]:
        out, cur = {gid}, parent_of.get(gid)
        while cur is not None:
            out.add(cur)
            cur = parent_of.get(cur)
        stack = list(kids.get(gid, []))
        while stack:
            c = stack.pop()
            out.add(c)
            stack.extend(kids.get(c, []))
        return out

    busy: dict[int, set] = defaultdict(set)
    kept_free: dict[int, set] = defaultdict(set)
    mine: dict[int, list] = defaultdict(list)
    for s in SLOTS:
        # คาบว่างที่โรงเรียนจองไว้ให้ว่างพร้อมกัน ไม่ใช่คาบเรียน — ตัวจัดตาราง
        # เห็นว่าช่องนี้ไม่ว่าง (จะได้ไม่เอาวิชาอื่นมาทับ) แต่ตรงนี้เป็นรายงาน
        # ที่คนอ่าน และโรงเรียนขอให้ "นับเป็นคาบว่างไปเลย"
        if s.get("is_free_period"):
            kept_free[s["group_id"]].add((s["day"], s["period"]))
            continue
        busy[s["group_id"]].add((s["day"], s["period"]))
        mine[s["group_id"]].append(s)

    problems = _class_problem_counts()
    rows = []
    for g in groups:
        nums = _class_periods_for_level(_level_key(g))
        if not nums or not mine.get(g["id"]):
            continue           # ห้องที่ยังไม่มีคาบเลย ไม่ต้องรายงาน
        last = nums[-1]
        taken: set = set()
        held: set = set()
        for k in family(g["id"]):
            taken |= busy.get(k, set())
            held |= kept_free.get(k, set())
        free = sum(1 for d in range(5) for p in nums[:-1] if (d, p) not in taken)
        gaps = 0
        for d in range(5):
            day_used = {p for (dd, p) in taken if dd == d}
            if not day_used:
                continue
            ends = max(day_used)
            # ช่องที่โรงเรียนจองไว้ให้ว่างไม่ใช่ "คาบว่างที่ต้องตามไปปิด" มัน
            # ว่างเพราะตั้งใจ การรายงานมันเป็นปัญหาคือการรบกวนเปล่าๆ
            gaps += sum(1 for p in nums if p < ends and p not in day_used
                        and (d, p) not in held)
        want_last = g.get("expected_last_period")
        want_free = g.get("expected_free")

        def verdict(actual: int, want) -> str | None:
            if want is None or want == "":
                return None
            try:
                want = int(want)
            except (TypeError, ValueError):
                return None
            return "ตรง" if actual == want else ("เกิน" if actual > want else "ขาด")

        n_last = sum(1 for c in busy.get(g["id"], set()) if c[1] == last)
        rows.append({
            "group_id": g["id"], "name": g.get("name"),
            "parent_id": g.get("parent_id"),
            "level": _level_key(g),
            "last_period_num": last,
            "last": n_last,
            "free": free,
            "gaps": gaps,
            "overflow": sum(1 for s in mine[g["id"]] if s.get("is_overflow")),
            # ห้องไหนควรซ่อม: คาบที่ไม่มีห้อง, คาบที่ครูติดสอนห้องอื่นในชั่วโมงเดียวกัน,
            # และคาบทั้งหมดที่มีอย่างใดอย่างหนึ่ง (รวมกรอบแดง) — นับของห้องนี้เอง
            # ไม่รวมห้องย่อย เหมือน overflow
            "roomless": problems.get(g["id"], {}).get("roomless", 0),
            "teacher_clash": problems.get(g["id"], {}).get("teacher_clash", 0),
            "room_clash": problems.get(g["id"], {}).get("room_clash", 0),
            "problems": problems.get(g["id"], {}).get("problems", 0),
            "lessons": len(mine[g["id"]]),
            "want_last": want_last if want_last not in ("",) else None,
            "want_free": want_free if want_free not in ("",) else None,
            "verdict_last": verdict(n_last, want_last),
            "verdict_free": verdict(free, want_free),
        })
    def class_key(name: str) -> tuple:
        """ม.4/6ก มาก่อน ม.4/10 — เรียงตามตัวเลขจริง ไม่ใช่ตามตัวอักษร"""
        nums = _re.findall(r"\d+", name or "")
        return ([int(n) for n in nums[:2]] + [0, 0])[:2] + [name or ""]

    rows.sort(key=lambda r: class_key(r["name"] or ""))
    return rows


@app.get("/api/diagnostics/period-check")
def period_check():
    rows = _period_check_rows()
    return {
        "rows": rows,
        "total": len(rows),
        "with_last": sum(1 for r in rows if r["last"]),
        "last_slots": sum(r["last"] for r in rows),
        "overflow": sum(r["overflow"] for r in rows),
        "roomless": sum(r["roomless"] for r in rows),
        "teacher_clash": sum(r["teacher_clash"] for r in rows),
        "room_clash": sum(r["room_clash"] for r in rows),
        "problem_classes": sum(1 for r in rows if r["problems"]),
        "set": sum(1 for r in rows
                   if r["want_last"] is not None or r["want_free"] is not None),
        "off": sum(1 for r in rows
                   if r["verdict_last"] not in (None, "ตรง")
                   or r["verdict_free"] not in (None, "ตรง")),
    }


@app.put("/api/diagnostics/period-check")
def set_period_targets(body: dict[str, Any]):
    """บันทึกจำนวนคาบสุดท้าย/คาบว่างที่โรงเรียนตั้งไว้ให้แต่ละห้อง"""
    wanted = {int(t["group_id"]): t for t in (body.get("targets") or [])
              if t.get("group_id") is not None}
    touched = 0
    for g in _flat_groups():
        t = wanted.get(g["id"])
        if not t:
            continue
        for key, field in (("last", "expected_last_period"), ("free", "expected_free")):
            if key in t:
                v = t[key]
                if v in (None, ""):
                    g.pop(field, None)
                else:
                    try:
                        g[field] = max(0, int(v))
                    except (TypeError, ValueError):
                        continue
        touched += 1
    _save_state()
    return {"saved": touched, **period_check()}


@app.post("/api/diagnostics/repair")
def consistency_repair(body: dict[str, Any] | None = None):
    """ซ่อมเฉพาะข้อที่คำตอบไม่กำกวม. Asked for explicitly, never automatic."""
    global SLOTS, REQUIREMENTS
    only = set((body or {}).get("codes") or [])
    def want(code: str) -> bool:
        return not only or code in only
    fixed: dict[str, int] = {}

    def note(code: str, n: int) -> None:
        if n:
            fixed[code] = fixed.get(code, 0) + n

    g_map = {g["id"]: g for g in _flat_groups()}
    t_ids = {t["id"] for t in TEACHERS}
    s_ids = {s["id"] for s in SUBJECTS}
    r_ids = {r["id"] for r in ROOMS}
    b_ids = {b["id"] for b in BUILDINGS}
    d_ids = {d["id"] for d in DEPARTMENTS}

    if want("req_group") or want("req_subject"):
        before = len(REQUIREMENTS)
        REQUIREMENTS = [r for r in REQUIREMENTS
                        if (r.get("group_id") in g_map or not want("req_group"))
                        and (r.get("subject_id") in s_ids or not want("req_subject"))]
        note("req_rows_removed", before - len(REQUIREMENTS))

    if want("req_teacher"):
        n = 0
        for r in REQUIREMENTS:
            if r.get("teacher_id") and r["teacher_id"] not in t_ids:
                r["teacher_id"] = 0; n += 1
        note("req_teacher", n)
    if want("req_coteacher"):
        n = 0
        for r in REQUIREMENTS:
            if r.get("co_teacher_id") and r["co_teacher_id"] not in t_ids:
                r["co_teacher_id"] = None; n += 1
        note("req_coteacher", n)
    if want("req_room"):
        n = 0
        for r in REQUIREMENTS:
            if r.get("room_id") and r["room_id"] not in r_ids:
                r["room_id"] = None; n += 1
        note("req_room", n)

    if want("slot_group") or want("slot_teacher") or want("slot_pool") or want("slot_period"):
        pool_ids = {p["id"] for p in ELECTIVE_POOLS}
        def keep(s):
            if want("slot_group") and s.get("group_id") not in g_map:
                return False
            if want("slot_teacher") and s.get("teacher_id") and s["teacher_id"] not in t_ids:
                return False
            if want("slot_pool") and s.get("elective_pool_id") and s["elective_pool_id"] not in pool_ids:
                return False
            if want("slot_period"):
                lvl = _level_key(g_map.get(s.get("group_id")))
                if s.get("period") not in _class_periods_for_level(lvl):
                    return False
            return True
        before = len(SLOTS)
        SLOTS = [s for s in SLOTS if keep(s)]
        note("slots_removed", before - len(SLOTS))

    if want("slot_room"):
        n = 0
        for s in SLOTS:
            if s.get("room_id") and s["room_id"] not in r_ids:
                s["room_id"] = None; s["room_name"] = None; s["room_type"] = None; n += 1
        note("slot_room", n)

    if want("stale_names"):
        n = 0
        for s in SLOTS:
            before = (s.get("teacher_name"), s.get("group_name"),
                      s.get("subject_name"), s.get("subject_code"), s.get("room_name"))
            _enrich_slot(s)
            if before != (s.get("teacher_name"), s.get("group_name"),
                          s.get("subject_name"), s.get("subject_code"), s.get("room_name")):
                n += 1
        note("stale_names", n)

    if want("room_teacher_gone"):
        n = 0
        for r in ROOMS:
            ids = _room_reserved_for(r)
            if ids - t_ids:
                r["reserved_teacher_ids"] = sorted(ids & t_ids)
                r.pop("reserved_teacher_id", None)
                n += 1
        note("room_teacher_gone", n)
    if want("room_group_gone"):
        n = 0
        for r in ROOMS:
            kept = [x for x in (r.get("reserved_group_ids") or []) if x in g_map]
            if len(kept) != len(r.get("reserved_group_ids") or []):
                r["reserved_group_ids"] = kept; n += 1
        note("room_group_gone", n)
    if want("teacher_room_gone"):
        n = 0
        for t in TEACHERS:
            if t.get("fixed_room_id") and t["fixed_room_id"] not in r_ids:
                t["fixed_room_id"] = None; n += 1
        note("teacher_room_gone", n)
    if want("group_room_gone"):
        n = 0
        for g in _flat_groups():
            if g.get("homeroom_room_id") and g["homeroom_room_id"] not in r_ids:
                g["homeroom_room_id"] = None; n += 1
        note("group_room_gone", n)
    if want("group_teacher_gone"):
        n = 0
        for g in _flat_groups():
            ids = _homeroom_ids(g)
            if set(ids) - t_ids:
                g["homeroom_teacher_ids"] = [i for i in ids if i in t_ids]
                _sync_homeroom(g); n += 1
        note("group_teacher_gone", n)
    if want("subject_room_gone"):
        n = 0
        for s in SUBJECTS:
            rooms = [i for i in _subject_rooms(s) if i in r_ids]
            if rooms != _subject_rooms(s):
                s["fixed_room_ids"] = rooms
                s["fixed_room_id"] = rooms[0] if rooms else None
                n += 1
        note("subject_room_gone", n)
    if want("subject_building_gone"):
        n = 0
        for s in SUBJECTS:
            bs = {i for i in _subject_buildings(s) if i in b_ids}
            if bs != _subject_buildings(s):
                s["building_ids"] = sorted(bs)
                s["building_id"] = sorted(bs)[0] if bs else None
                n += 1
        note("subject_building_gone", n)
    if want("subject_dept_gone"):
        n = 0
        for s in SUBJECTS:
            if s.get("department_id") and s["department_id"] not in d_ids:
                s["department_id"] = None; n += 1
        note("subject_dept_gone", n)

    if want("homeroom_disagree"):
        n = 0
        for r in ROOMS:
            gid = r.get("homeroom_group_id")
            if gid and g_map.get(gid, {}).get("homeroom_room_id") not in (None, r["id"]):
                r["homeroom_group_id"] = None; n += 1
        note("homeroom_disagree", n)

    if want("group_tree"):
        n = 0
        for g in list(_flat_groups()):
            p = g.get("parent_id")
            if not p:
                continue
            parent = g_map.get(p)
            if parent is None:
                g["parent_id"] = None; n += 1
                continue
            kids = parent.setdefault("children", [])
            if not any((c["id"] if isinstance(c, dict) else c) == g["id"] for c in kids):
                _detach_group(g["id"]); kids.append(g); n += 1
        note("group_tree", n)

    if want("set_pins"):
        by_key: dict[str, list] = defaultdict(list)
        for r in REQUIREMENTS:
            if r.get("parallel_group_key"):
                by_key[r["parallel_group_key"]].append(r)
        n = 0
        for grp in by_key.values():
            lead = next((r for r in grp if r.get("pinned_day") is not None
                         and r.get("pinned_period") is not None), grp[0])
            for r in grp:
                if (r.get("pinned_day"), r.get("pinned_period"),
                        bool(r.get("pinned_double"))) != (
                        lead.get("pinned_day"), lead.get("pinned_period"),
                        bool(lead.get("pinned_double"))):
                    r["pinned_day"] = lead.get("pinned_day")
                    r["pinned_period"] = lead.get("pinned_period")
                    r["pinned_double"] = bool(lead.get("pinned_double"))
                    n += 1
        note("set_pins", n)

    if want("pin_period"):
        n = 0
        for r in REQUIREMENTS:
            p = r.get("pinned_period")
            if p is None:
                continue
            lvl = _level_key(g_map.get(r.get("group_id")))
            if p not in _class_periods_for_level(lvl):
                r["pinned_day"] = None; r["pinned_period"] = None; n += 1
        note("pin_period", n)

    if want("pool_group"):
        n = 0
        for p in ELECTIVE_POOLS:
            kept = [i for i in (p.get("group_ids") or []) if i in g_map]
            if len(kept) != len(p.get("group_ids") or []):
                p["group_ids"] = kept; _sync_pool_slots(p); n += 1
        note("pool_group", n)
    if want("pool_option"):
        n = 0
        for p in ELECTIVE_POOLS:
            kept = [o for o in (p.get("options") or [])
                    if o.get("subject_id") in s_ids
                    and (not o.get("teacher_id") or o["teacher_id"] in t_ids)]
            if len(kept) != len(p.get("options") or []):
                p["options"] = kept; _sync_pool_slots(p); n += 1
        note("pool_option", n)

    if want("subject_year"):
        # ย้ายแถวไปใช้วิชาที่รหัสตรงชั้น สร้างวิชาให้ถ้ายังไม่มี
        #
        # ไม่แตะรหัสของวิชาเดิม เพราะ พ21104 ยังถูกต้องสำหรับห้อง ม.1 ที่ใช้อยู่
        # การแก้รหัสวิชาจะลากห้อง ม.1 ผิดไปด้วยทั้งหมด สิ่งที่ผิดคือ "แถวนี้ชี้
        # ไปวิชาผิดตัว" ไม่ใช่ "วิชานี้มีรหัสผิด"
        n = 0
        for m in _subject_year_mismatches():
            target = m["target"]
            if target is None:
                old = m["subject"]
                target = {
                    "id": _next("subject"),
                    "code": m["want_code"],
                    "name": _name_for_new_code(m["want_code"], old),
                    "type": old.get("type", "common"),
                    "duration": old.get("duration", 1) or 1,
                    "department_id": old.get("department_id"),
                    "is_activity": bool(old.get("is_activity")),
                    "fixed_room_id": None,
                    "credits": old.get("credits"),
                }
                SUBJECTS.append(target)
            m["req"]["subject_id"] = target["id"]
            _refresh_names_for(subject_id=target["id"])
            n += 1
        note("subject_year", n)

    if want("half_double"):
        note("half_double", _repair_elective_doubles())
    if want("dup_rows"):
        note("dup_rows", _merge_teacherless_rows())

    # The revision counter is bumped by the middleware on every POST, so
    # browsers watching for each other's edits pick this up like any other.
    return {"fixed": fixed, "total": sum(fixed.values()),
            "remaining": _consistency_findings()}

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
            # คาบกรอบแดงยังไม่มีห้อง และยังไม่ใช่คาบที่จัดลงตัว นับระยะเดินจาก
            # มันก็จะได้ตัวเลขของตารางที่ยังไม่มีจริง
            if who is None or s.get("is_overflow"):
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
            # Only by time: two lessons in one hour would otherwise be ordered
            # by room id, and a room id of None cannot be compared with one.
            spans.sort(key=lambda x: (x[0], x[1]))
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
        tids = _slot_teachers(s)
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
    _lookup_cache_clear()
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
    tail_mode = _school_last_period_mode(body)
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
        tids = _slot_teachers(s)
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
        # วิชาที่สั่งว่า "ไม่เรียนนอกอาคาร" ชนะกลุ่มสาระ เหมือนใน _solve_greedy
        #
        # ที่นี่เป็นตัวกรองแบบตายตัว (ข้างล่าง: wants_outdoor แล้วห้องไม่ใช่ลาน
        # = ข้าม) ถ้าไม่เคารพธง วิชาสุขศึกษาที่ติ๊กว่าไม่เรียนนอกอาคารจะได้
        # เฉพาะลานเท่านั้น ซึ่งตรงข้ามกับที่สั่งเป๊ะๆ · สองที่ หนึ่งกฎ
        wants_outdoor = (subj.get("department_id") in dep_out
                         and _subject_outdoor(subj) is not False)
        # A specialised room belongs to whoever teaches the subject, not to the
        # teacher's own กลุ่มสาระ — a maths teacher taking a computer period
        # still needs the lab.
        t_dept = subj.get("department_id") or teacher.get("department_id")
        subj_rooms = _subject_rooms(subj)
        out = []
        for r in ROOMS:
            # The subject's own designated rooms are always allowed — the
            # school chose them deliberately, so capacity/type rules do not
            # exclude them.
            if r["id"] in subj_rooms:
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

    # ห้องที่อยู่ประจำชั้นแต่ไม่มีห้องประจำชั้นที่บันทึกไว้ — the heuristic placer
    # settles such a class in one ordinary room on its first lesson and keeps
    # it there all week. CP-SAT has no "first lesson", so the same room is
    # chosen up front, by the same rule (_choose_anchor), once per class, in
    # id order so two classes are not handed the same one.
    stay_anchor: dict[int, int] = {}
    _homerooms = {g["homeroom_room_id"] for g in flat_groups if g.get("homeroom_room_id")}
    for _gid in sorted({o["group_id"] for o in occurrences}):
        _g = g_map.get(_gid) or {}
        if _g.get("stay_in_homeroom") is not True or _g.get("homeroom_room_id"):
            continue
        _fam = _group_family(_gid, _g)
        _pick = _choose_anchor(
            _g,
            [r for r in ROOMS
             if r["type"] in ("physical", "floating")
             and not r.get("specialized_dept_id") and _room_usable(r)
             and not _room_reserved_for(r) and _room_allows_group(r, _gid, _fam)],
            set(stay_anchor.values()), _homerooms)
        if _pick:
            stay_anchor[_gid] = _pick["id"]

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

        for _sr in _subject_rooms(subj):
            take(_sr)
        for r in rooms:
            if want_dept and r.get("specialized_dept_id") == want_dept:
                take(r["id"])
        take(home)
        take(stay_anchor.get(occ["group_id"]))   # a ticked class with no room recorded
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
        # กฎเดียวกับ compatible_rooms ข้างบน — วิชาที่ติ๊กว่าไม่เรียนนอกอาคาร
        # ต้องถูกตีราคาเหมือนวิชาในห้อง ไม่ใช่เหมือนพละ
        wants_outdoor = (subj.get("department_id") in dep_out
                         and _subject_outdoor(subj) is not False)
        subj_room = set(_subject_rooms(subj))   # ห้องประจำวิชา (ได้หลายห้อง)
        own_rooms = dept_rooms.get(subj.get("department_id") or -1, set())
        lvl_last = _last_period_for(occ_level(occ))
        # The room this class stays in, if the rule covers THIS lesson. None
        # for a subject with its own room, for พลศึกษา, and for a class that
        # does not stay home — so every one of those is priced exactly as it
        # was before this rule existed.
        _hid = homeroom or stay_anchor.get(occ["group_id"])
        stay_room = (_hid if _stays_home_for(g_map.get(occ["group_id"]), subj,
                                             r_map.get(_hid), wants_outdoor) else None)
        # Only when the room is one of the choices at all: if it was left out
        # of the shortlist every option would carry the same price, which
        # steers nothing and only inflates the objective.
        if stay_room is not None and stay_room not in {r["id"] for r in rooms}:
            stay_room = None

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
            # คาบสุดท้ายของวันไว้ใช้เมื่อจำเป็น
            #
            # "ยังมีคาบว่างแต่ยังมีคาบ 9 ออกมาให้เห็น ช่วยจัดให้คาบเต็มก่อน"
            #
            # The heuristic placer has reserved the tail for years; CP-SAT
            # never learnt the rule, so whichever solver ran decided whether
            # the school got it. It does not place lessons as late as it can
            # out of malice — every cell simply costs the same, so คาบ 9 is as
            # good as คาบ 2 and the hour a class goes home is decided by
            # nothing at all.
            #
            # Priced, not forbidden, and that pricing is the whole rule.
            # TAIL_COST sits far above the walking penalties, so the solver
            # will accept any amount of walking before it sends a class home
            # late; and far below the 1000 an unplaced lesson costs, so a
            # class whose week genuinely does not fit in the earlier hours
            # still gets its lesson. Use it when necessary, never by accident.
            # "never" is the school saying the tail does not exist at all, so
            # the start is not offered.
            tail_here = lvl_last is not None and any(cp_ == lvl_last for _cd, cp_ in cells)
            if tail_here and tail_mode == "never":
                continue
            sv = model.NewBoolVar(f"s_{idx}_{d}_{p}")
            if tail_here and tail_mode != "free":
                penalty_terms.append((TAIL_COST, sv))
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
                    if r["id"] not in subj_room:
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
                # เรียนในห้องประจำชั้น: a class that stays in its own room pays
                # STAY_HOME_COST for every other one — more than finishing
                # early (TAIL_COST), far less than not being taught (1000).
                # Where it sits among those is the rule; see the constant.
                if stay_room is not None and r["id"] != stay_room:
                    penalty_terms.append((STAY_HOME_COST, rv))
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
    # Things worth saying that are not faults — a timetable with these is
    # still a good one, so they must not turn the run INFEASIBLE.
    notes: list[str] = []
    unplaced_ids: set[int] = set()
    seated: list[dict] = []      # the lessons this run placed, for the report below

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
                seated.append(slot)
                created += 1
        # ห้องที่อยู่ประจำชั้น: the lessons that could not stay in their room.
        notes.extend(_stay_home_notes(
            seated,
            {gid: g.get("homeroom_room_id") or stay_anchor.get(gid)
             for gid, g in g_map.items()}))
    else:
        violations.append("ไม่พบคำตอบที่เป็นไปได้ — ลองลดจำนวนคาบ เพิ่มครู/ห้อง หรือปลดล็อกบางคาบ")

    LAST_RUN["unplaced_requirement_ids"] = sorted(unplaced_ids)
    LAST_RUN["skipped_requirement_ids"] = sorted(skipped_reqs)
    # ห้องที่ CP-SAT แจกให้ชั้นที่ติ๊กแต่ไม่มีห้องประจำ — ไว้ให้เห็นและตรวจ
    LAST_RUN["stay_home_anchors"] = dict(stay_anchor)
    return {
        "status": "OPTIMAL" if status == cp_model.OPTIMAL else ("FEASIBLE" if ok else "INFEASIBLE"),
        "slots_created": created,
        "solve_time_seconds": round(_time.time() - t0, 2),
        "objective_value": float(solver.ObjectiveValue()) if (ok and penalty_terms) else None,
        "violations": violations,
        "notes": notes,
        "engine": "cp-sat",
        "unplaced_requirement_ids": sorted(unplaced_ids),
        "skipped_requirement_ids": sorted(skipped_reqs),
        "max_consecutive": consec_hard,
        "consecutive": _consecutive_report(),
        "walking": _walking_report(),
        # Counted from the result rather than borrowed from the other solver.
        # This line used to read `last_period_stats`, a name that only exists
        # inside _solve_greedy — so the very last statement of a CP-SAT run
        # raised NameError and threw the whole timetable away. It never
        # surfaced because this school is too large for CP-SAT to attempt at
        # all (the size guard refuses ~155,000 variables and hands over to the
        # heuristic), so the crash sat behind a door nobody opened. A small
        # school would have walked straight into it.
        "last_period": _last_period_report(),
    }


def _last_period_report() -> dict[str, Any]:
    """How much of the day's last period the timetable ended up using."""
    g_map = {g["id"]: g for g in _flat_groups()}
    used: dict[int, int] = defaultdict(int)
    for s in SLOTS:
        grp = g_map.get(s["group_id"])
        if grp is None:
            continue
        last = _last_period_for(_level_key(grp))
        if last is not None and s["period"] == last:
            used[s["group_id"]] += 1
    return {"slots": sum(used.values()),
            "classes_using": len(used),
            "classes_clear": sum(1 for gid in g_map if gid not in used)}


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
    # ผังคาบกำลังจะเปลี่ยน ล้างแคชทันทีที่เปลี่ยนจริง ไม่รอตัวกลางล้างตอนจบคำขอ
    # เพราะโค้ดที่เหลือในคำขอนี้ยังอ่านผังคาบต่อ ถ้ารอ มันจะอ่านของเก่า
    body["id"] = _next("period")
    body.setdefault("applies_to", "all")
    # The number is the column this lands in, worked out from its time — the
    # caller does not have to know or guess it.
    if body.get("period_num") is None or body.get("auto_number"):
        body.pop("auto_number", None)
        PERIODS.append(body)
        _lookup_cache_clear()
        cols = _column_groups()
        for i, col in enumerate(cols):
            if any(r is body for r in col):
                body["period_num"] = i
                break
        else:
            body["period_num"] = _max_id([{"id": p.get("period_num", 0)} for p in PERIODS]) + 1
        return body
    PERIODS.append(body)
    _lookup_cache_clear()
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
    # เลขคาบเพิ่งเปลี่ยนทั้งแถว ต้องล้างก่อนบรรทัดถัดไปที่อ่านผังคาบ ไม่ใช่รอ
    # ตัวกลางล้างตอนจบคำขอ เพราะ period_plan() ด้านล่างอ่านผังคาบทันที
    _lookup_cache_clear()

    return {"columns": len(cols), "slots_moved": moved,
            "plan": period_plan()}



@app.put("/api/periods/{pid}")
def update_period(pid: int, body: dict[str, Any]):
    for p in PERIODS:
        if p["id"] == pid:
            p.update(body)
            _lookup_cache_clear()   # ผังคาบเพิ่งเปลี่ยน ของที่จำไว้ใช้ไม่ได้แล้ว
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
    _lookup_cache_clear()   # ผังคาบเพิ่งเปลี่ยน ของที่จำไว้ใช้ไม่ได้แล้ว
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
    # A deleted teacher must stop being anybody's ครูประจำชั้น, or the class
    # keeps pointing at someone who is gone and the sheet prints a blank name.
    homerooms = 0
    for g in _flat_groups():
        ids = _homeroom_ids(g)
        if tid in ids:
            g["homeroom_teacher_ids"] = [x for x in ids if x != tid]
            _sync_homeroom(g)
            homerooms += 1
    # ครูสอนร่วม. The lesson belongs to the other teacher and stays — but with
    # a partner who is gone, the cell showed two names and booked an id that
    # no longer answers to anybody.
    co = 0
    for row in (*SLOTS, *REQUIREMENTS):
        if row.get("co_teacher_id") == tid:
            row["co_teacher_id"] = None
            row.pop("co_teacher_name", None)
            co += 1
    # ครูผู้ดูแลคาบกิจกรรม — ลูกเสือ, ชุมนุม. Their hour is still busy for
    # everyone else on the roster; only this name comes off.
    roster = 0
    for sl in SLOTS:
        ids = sl.get("activity_teacher_ids") or []
        if tid in ids:
            sl["activity_teacher_ids"] = [x for x in ids if x != tid]
            sl["activity_teacher_names"] = [
                t["name"] for t in TEACHERS if t["id"] in sl["activity_teacher_ids"]]
            roster += 1
    # ห้องที่เขียนชื่อครูคนนี้ไว้. Left behind, the room stays locked to
    # somebody who is gone and every other teacher is shut out of it.
    rooms = 0
    for room in ROOMS:
        ids = _room_reserved_for(room)
        if tid in ids:
            room["reserved_teacher_ids"] = sorted(ids - {tid})
            room.pop("reserved_teacher_id", None)
            rooms += 1
    return {"slots": before_s - len(SLOTS), "requirements": before_r - len(REQUIREMENTS),
            "elective_options": opts, "homerooms": homerooms,
            "co_teacher": co, "activity_roster": roster, "rooms_freed": rooms}


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
    _drop_yard_picks(group_ids=doomed)

    for pool in ELECTIVE_POOLS:
        keep = [x for x in pool.get("group_ids", []) if x not in doomed]
        if len(keep) != len(pool.get("group_ids", [])):
            pool["group_ids"] = keep
            _sync_pool_slots(pool)
    # A homeroom that no longer belongs to anyone must not stay reserved —
    # nor a room kept for a class that is gone (ห้องเพชร of a class that has
    # been removed went on being treated as somebody's own room).
    for r in ROOMS:
        if r.get("homeroom_group_id") in doomed:
            r["homeroom_group_id"] = None
        kept = r.get("reserved_group_ids")
        if isinstance(kept, list) and any(x in doomed for x in kept):
            r["reserved_group_ids"] = [x for x in kept if x not in doomed]
    return {"groups": len(doomed), "slots": before_s - len(SLOTS),
            "requirements": before_r - len(REQUIREMENTS)}


def _purge_room(rid: int) -> dict[str, int]:
    """Free the room from the timetable. The lessons themselves survive —
    losing a room is not a reason to lose the period it was taught in."""
    # A pick that pointed at this ลาน has nothing left to point at.
    _drop_yard_picks(room_id=rid)
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
        if isinstance(sub.get("fixed_room_ids"), list):
            sub["fixed_room_ids"] = [x for x in sub["fixed_room_ids"] if x != rid]
    # ห้องที่โรงเรียนกำหนดไว้ให้ห้องเรียนนี้เรียนวิชานี้ (ตารางห้องประจำวิชา).
    # Left pointing at a room that is gone, find_room answers "นัดไว้ที่ห้องนี้
    # เท่านั้น" for a room that does not exist and the lesson never gets one.
    pinned = 0
    for req in REQUIREMENTS:
        if req.get("room_id") == rid:
            req["room_id"] = None
            pinned += 1
    return {"slots_unassigned": freed, "requirements_unpinned": pinned}


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


def _refresh_names_for(*, teacher_id=None, room_id=None, subject_id=None,
                       group_id=None) -> int:
    """ไล่แก้ชื่อที่ค้างอยู่ในคาบที่ลงไว้แล้ว หลังเปลี่ยนชื่อจริง

    Every lesson in the timetable carries the teacher's name, the room's name
    and the subject's code as well as their ids — that is what lets a printed
    sheet, an export or another browser show a cell without looking anything
    up. The cost is that renaming the teacher leaves eighty-one cells still
    showing the old name, and the school only finds out when the sheet comes
    off the printer. So a rename comes through here.
    """
    hit = 0
    for s in SLOTS:
        if ((teacher_id is not None and (s.get("teacher_id") == teacher_id
                                         or s.get("co_teacher_id") == teacher_id
                                         or teacher_id in (s.get("activity_teacher_ids") or [])))
                or (room_id is not None and s.get("room_id") == room_id)
                or (subject_id is not None and s.get("subject_id") == subject_id)
                or (group_id is not None and s.get("group_id") == group_id)):
            _enrich_slot(s)
            hit += 1
    return hit


@app.put("/api/rooms/{i}")
def update_room(i: int, body: dict[str, Any]):
    for r in ROOMS:
        if r["id"] == i:
            r.update(body)
            if r.get("type") != "outdoor":
                _drop_yard_picks(room_id=i)       # no longer a ลาน
            _refresh_names_for(room_id=i)
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

# ── รหัสประจำตัวครูตามกลุ่มสาระ ──────────────────────────────────────────────
# ภาษาไทย starts at 101, so its first teacher is 101, the second 102, and so on.
# Each กลุ่มสาระ sets its own starting number; the tail always runs in order.
# The order is the school's to decide — seniority, not the alphabet — so it is
# stored per teacher and set by dragging the list about, not computed here.

DEPT_CODE_BASE_DEFAULT = 101


def _dept_teachers(dept_id: int) -> list[dict[str, Any]]:
    """This department's teachers in the order the school put them in.

    Anyone without an order yet goes to the end rather than to the front, so
    adding a teacher does not renumber everybody above them.
    """
    rows = [t for t in TEACHERS if t.get("department_id") == dept_id]
    return sorted(rows, key=lambda t: (t.get("dept_order") is None,
                                       t.get("dept_order") or 0,
                                       t.get("name") or ""))


@app.get("/api/departments/{i}/teachers")
def dept_teachers(i: int):
    dept = next((d for d in DEPARTMENTS if d["id"] == i), None)
    if dept is None:
        raise HTTPException(404, "ไม่พบกลุ่มสาระนี้")
    base = int(dept.get("code_base") or DEPT_CODE_BASE_DEFAULT)
    rows = _dept_teachers(i)
    return {
        "department": dept,
        "code_base": base,
        "teachers": [{"id": t["id"], "name": t.get("name"), "code": t.get("code"),
                      "dept_order": t.get("dept_order"),
                      "would_be": str(base + n)} for n, t in enumerate(rows)],
    }


@app.post("/api/departments/{i}/renumber")
def dept_renumber(i: int, body: dict[str, Any]):
    """Write the order the school dragged into place, and the codes it implies."""
    dept = next((d for d in DEPARTMENTS if d["id"] == i), None)
    if dept is None:
        raise HTTPException(404, "ไม่พบกลุ่มสาระนี้")

    base_raw = body.get("code_base")
    if base_raw not in (None, ""):
        try:
            base = int(base_raw)
        except (TypeError, ValueError):
            raise HTTPException(400, "รหัสเริ่มต้นต้องเป็นตัวเลข")
        if base < 0:
            raise HTTPException(400, "รหัสเริ่มต้นต้องไม่ติดลบ")
        dept["code_base"] = base
    base = int(dept.get("code_base") or DEPT_CODE_BASE_DEFAULT)

    by_id = {t["id"]: t for t in TEACHERS}
    wanted = [int(x) for x in (body.get("teacher_ids") or [])
              if str(x).lstrip("-").isdigit() and int(x) in by_id]
    # Only this department's teachers, and only once each. A list that has
    # drifted — a teacher moved department in another tab — must not drag a
    # stranger's code along with it.
    seen: list[int] = []
    for tid in wanted:
        if by_id[tid].get("department_id") == i and tid not in seen:
            seen.append(tid)
    # Anyone the caller left out keeps their place, at the end.
    for t in _dept_teachers(i):
        if t["id"] not in seen:
            seen.append(t["id"])

    changed = []
    for n, tid in enumerate(seen):
        t = by_id[tid]
        code = str(base + n)
        if t.get("code") != code or t.get("dept_order") != n:
            changed.append({"id": tid, "name": t.get("name"),
                            "was": t.get("code"), "now": code})
        t["dept_order"] = n
        t["code"] = code

    return {"code_base": base, "count": len(seen), "changed": changed,
            "teachers": [{"id": by_id[x]["id"], "name": by_id[x].get("name"),
                          "code": by_id[x].get("code"),
                          "dept_order": by_id[x].get("dept_order")} for x in seen]}


@app.delete("/api/departments/{i}")
def del_department(i: int):
    global DEPARTMENTS
    DEPARTMENTS = [d for d in DEPARTMENTS if d["id"] != i]
    return {}

# ── Groups ────────────────────────────────────────────────────────────────────
@app.get("/api/groups/")
def get_groups():
    return GROUPS

# ครูประจำชั้น — a class may have two.
#
# It was one id, and the picker greyed out every class that already had a
# teacher, so a newly added teacher could not be made ครูประจำชั้น of anything:
# every class in the school was already taken. Two is what the school actually
# wants, and it removes that dead end as a side effect.
#
# The list is the truth. The old single field is kept in step as the first of
# them, so anything still reading it — the printed sheet, the activity blocks,
# an older backup file — keeps working.
# Two at first, because that is what the school asked for; three now, since
# their bigger classes are advised by a team and the third name was being
# dropped on the way in. Raising it is safe in both directions: a class that
# already has two keeps them, and the cap only ever trims a longer list.
HOMEROOM_MAX = 3


def _homeroom_ids(g: dict[str, Any] | None) -> list[int]:
    """This class's ครูประจำชั้น, however the row happens to store them."""
    if not g:
        return []
    ids = g.get("homeroom_teacher_ids")
    if isinstance(ids, list):
        out = [int(x) for x in ids if str(x).lstrip("-").isdigit()]
    elif g.get("homeroom_teacher_id"):
        out = [int(g["homeroom_teacher_id"])]
    else:
        out = []
    seen: list[int] = []
    for x in out:                      # keep order, drop repeats
        if x not in seen:
            seen.append(x)
    return seen[:HOMEROOM_MAX]


def _sync_homeroom(g: dict[str, Any]) -> None:
    ids = _homeroom_ids(g)
    g["homeroom_teacher_ids"] = ids
    g["homeroom_teacher_id"] = ids[0] if ids else None


def _family_root(gid: int | None) -> int | None:
    """The class an advisor is recorded on: this one, or the one above it.

    ม.4/6 is one roomful of students and ม.4/6ก, ข, ค are that roomful split
    for electives — one class with one set of ครูประจำชั้น between them. The
    hop count is bounded because a row whose parent points back into its own
    ancestry would otherwise loop here forever.
    """
    if gid is None:
        return None
    by = {g["id"]: g for g in _flat_groups()}
    cur = by.get(gid)
    for _ in range(8):
        if not cur:
            return gid
        pid = cur.get("parent_id")
        if not pid or pid == cur["id"] or pid not in by:
            return cur["id"]
        cur = by[pid]
    return cur["id"] if cur else gid


def _effective_homeroom_ids(g: dict[str, Any] | None) -> list[int]:
    """This class's ครูประจำชั้น, falling back to the class above it."""
    own = _homeroom_ids(g)
    if own or not g:
        return own
    root = _family_root(g.get("id"))
    if root is None or root == g.get("id"):
        return []
    return _homeroom_ids(next((x for x in _flat_groups() if x["id"] == root), None))


def _release_other_classes(teacher_ids: list[int], keep_root: int | None) -> None:
    """One teacher, one class.

    Taking a teacher for this class gives up whatever they held before, rather
    than refusing the change: the office is telling us where this teacher
    belongs now, and making them go and clear the old row first would be a
    rule that only gets in the way. A parent and its sub-classes are one
    class, so moving within a family releases nothing.
    """
    if not teacher_ids:
        return
    wanted = set(teacher_ids)
    for other in _flat_groups():
        if _family_root(other["id"]) == keep_root:
            continue
        ids = _homeroom_ids(other)
        left = [x for x in ids if x not in wanted]
        if len(left) != len(ids):
            other["homeroom_teacher_ids"] = left
            _sync_homeroom(other)


@app.post("/api/groups/")
def create_group(body: dict[str, Any]):
    body["id"] = _next("group")
    body.setdefault("children", [])
    body.setdefault("homeroom_room_id", None)
    body.setdefault("homeroom_teacher_id", None)
    _sync_homeroom(body)
    GROUPS.append(body)
    return body

def _norm_name(s: Any) -> str:
    return "".join(str(s or "").split())


def _detach_group(gid: int) -> None:
    """Take a class out of whatever list is currently holding it."""
    for container in [GROUPS] + [g.get("children") or [] for g in _flat_groups()]:
        for i, g in enumerate(container):
            if g["id"] == gid:
                container.pop(i)
                return


def _is_ancestor(maybe_parent: int, gid: int) -> bool:
    by_id = {g["id"]: g for g in _flat_groups()}
    seen, cur = set(), by_id.get(maybe_parent)
    while cur is not None and cur["id"] not in seen:
        if cur["id"] == gid:
            return True
        seen.add(cur["id"])
        cur = by_id.get(cur.get("parent_id"))
    return False


def _reparent_group(g: dict[str, Any], parent_id: int | None) -> None:
    """Move a class under another one, or back out to the top.

    Setting parent_id alone only wrote the number down: the class stayed in
    whichever list already held it, so an imported ม.4/6ก said it belonged to
    ม.4/6 while still sitting beside it as a class of its own. Everything that
    walks the tree then saw it twice, and everything that reads parent_id saw
    it once — which is how a subgroup can be both present and missing.
    """
    if parent_id is not None and (parent_id == g["id"] or _is_ancestor(parent_id, g["id"])):
        raise HTTPException(400, "ห้องย่อยอยู่ใต้ตัวเองหรือใต้ลูกของตัวเองไม่ได้")
    parent = next((x for x in _flat_groups() if x["id"] == parent_id), None) if parent_id else None
    if parent_id is not None and parent is None:
        raise HTTPException(400, "ไม่พบห้องแม่ที่ระบุ")
    _detach_group(g["id"])
    g["parent_id"] = parent["id"] if parent else None
    g.setdefault("children", [])
    (parent.setdefault("children", []) if parent else GROUPS).append(g)


@app.put("/api/groups/{i}")
def update_group(i: int, body: dict[str, Any]):
    for g in _flat_groups():
        if g["id"] == i:
            # Moving between parents has to move the node, not just the field.
            if "parent_id" in body:
                want = body["parent_id"]
                want = int(want) if want not in (None, "", 0) else None
                if want != g.get("parent_id"):
                    _reparent_group(g, want)
                body = {k: v for k, v in body.items() if k != "parent_id"}
            # A caller that sends only the single field means to replace the
            # whole list with it, not to add to what is there.
            if "homeroom_teacher_ids" not in body and "homeroom_teacher_id" in body:
                body = {**body, "homeroom_teacher_ids":
                        [body["homeroom_teacher_id"]] if body["homeroom_teacher_id"] else []}
            g.update(body)
            _sync_homeroom(g)
            # Enforced here as well as in the dialog, because the bulk import
            # and any later caller write through this same door.
            if "homeroom_teacher_ids" in body:
                _release_other_classes(_homeroom_ids(g), _family_root(g["id"]))
            return g
    return {}

@app.delete("/api/groups/{i}")
def del_group(i: int):
    # Walks the tree, so a subgroup (ม.4/6ก) deletes too — the old top-level
    # filter silently did nothing for those.
    return {"removed": _purge_group(i)}

@app.post("/api/groups/bulk")
def bulk_create_groups(body: list[dict[str, Any]]):
    """Import classes. A name that already exists is UPDATED, not duplicated.

    Importing used to append whatever it was given, so a file run twice — or
    run to add the subgroups a school already half had — left two ม.4/6ก, each
    with its own id, its own lessons and half the timetable each. The school
    cannot tell them apart on screen, and deleting the wrong one takes the
    lessons with it.

    So the name is the identity. Re-importing the same file is then a no-op
    rather than a mess, which is what makes it safe to hand someone a file and
    say "run this".

    A row only carries what it carries: fields the file leaves blank keep
    whatever the class already had, so adding a parent to ม.4/6ก does not wipe
    its ครูประจำชั้น.
    """
    existing = {_norm_name(g.get("name")): g for g in _flat_groups()}
    out = []
    for row in body:
        row = {k: v for k, v in row.items() if v is not None or k == "parent_id"}
        parent_id = row.pop("parent_id", None)
        found = existing.get(_norm_name(row.get("name")))
        if found:
            # Don't let an import move a class out of its parent by omission.
            found.update({k: v for k, v in row.items() if k not in ("id", "children")})
            _sync_homeroom(found)
            if parent_id is not None and parent_id != found.get("parent_id"):
                _reparent_group(found, int(parent_id))
            out.append(found)
            continue
        row["id"] = _next("group")
        row["children"] = []
        row["parent_id"] = None
        row.setdefault("homeroom_room_id", None)
        row.setdefault("homeroom_teacher_id", None)
        _sync_homeroom(row)
        GROUPS.append(row)
        existing[_norm_name(row.get("name"))] = row
        # Placed under its parent here rather than left at the top level with
        # the field set, which read as "a class of its own that claims a parent".
        if parent_id is not None:
            _reparent_group(row, int(parent_id))
        out.append(row)
    return out

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
            _refresh_names_for(teacher_id=i)
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


# ── ส่งต่อครู ────────────────────────────────────────────────────────────────
#
# "จะมีครูย้าย เราสามารถกดเลือกครูสองท่าน ซึ่งต้องมาเลือกรายวิชาที่จะโอนไปให้
#  ซึ่งก็มีปุ่มที่โอนทั้งหมดเหมือนกัน"
#
# ครูคนหนึ่งลาออกกลางปี และงานของเขาไม่ได้อยู่ที่เดียว: แผนการสอนบอกว่าเขาสอน
# วิชาอะไรให้ห้องไหน ตารางที่จัดไว้แล้วถือชื่อเขาอยู่ในทุกคาบ และคาบเสรีบางชุด
# เปิดวิชาของเขาให้นักเรียนเลือก ก่อนหน้านี้ต้องไล่แก้ทีละแถวสี่สิบกว่าที่ ซึ่ง
# แปลว่าจะมีสักที่ที่ลืม
#
# ย้ายทางเดียวเสมอ ก → ข ไม่ใช่การสลับ เพราะเคสจริงคือคนหนึ่งไม่อยู่แล้ว
# และไม่มีการขยับวัน/คาบ/ห้องของคาบไหนเลย — เปลี่ยนแค่ว่าใครยืนอยู่ในห้องนั้น

def _elective_sites(teacher_id: int | None = None):
    """ทุกที่ที่ตัวเลือกของคาบเสรีถูกเก็บไว้ — ในชุด และในคาบที่ลงไว้แล้ว

    ชุด (ELECTIVE_POOLS) คือสิ่งที่โรงเรียนตั้งไว้ ส่วนคาบที่ลงแล้วถือสำเนาของ
    ตัวเลือกไว้เองเพื่อให้พิมพ์ตารางได้โดยไม่ต้องย้อนไปหาชุด ถ้าโอนแค่ที่เดียว
    อีกที่จะยังโชว์ชื่อครูคนเก่าอยู่
    """
    for pool in ELECTIVE_POOLS:
        for opt in pool.get("options") or []:
            if teacher_id is None or opt.get("teacher_id") == teacher_id:
                yield pool, opt
    for slot in SLOTS:
        for opt in slot.get("elective_options") or []:
            if teacher_id is None or opt.get("teacher_id") == teacher_id:
                yield slot, opt


def _teacher_record(tid: int) -> dict[str, Any]:
    t = next((x for x in TEACHERS if x["id"] == tid), None)
    if not t:
        raise HTTPException(404, f"ไม่พบครูรหัส {tid}")
    return t


@app.get("/api/teachers/{tid}/holdings")
def teacher_holdings(tid: int):
    """ของที่ครูคนนี้ถืออยู่ จัดกลุ่มตามวิชา แล้วกางเป็นรายห้อง"""
    t = _teacher_record(tid)
    g_map = {g["id"]: g for g in _flat_groups()}
    s_map = {s["id"]: s for s in SUBJECTS}
    placed: dict[tuple, int] = defaultdict(int)
    for s in SLOTS:
        if s.get("teacher_id") == tid and s.get("subject_id") is not None:
            placed[(s["group_id"], s["subject_id"])] += 1

    by_sub: dict[int, dict[str, Any]] = {}
    for r in REQUIREMENTS:
        if r.get("teacher_id") != tid:
            continue
        subj = s_map.get(r.get("subject_id")) or {}
        e = by_sub.setdefault(r["subject_id"], {
            "subject_id": r["subject_id"],
            "code": subj.get("code") or f"#{r.get('subject_id')}",
            "name": subj.get("name") or "",
            "weekly": 0, "placed": 0, "classes": [],
        })
        grp = g_map.get(r["group_id"]) or {}
        got = placed.get((r["group_id"], r["subject_id"]), 0)
        e["classes"].append({
            "requirement_id": r["id"],
            "group_id": r["group_id"],
            "group_name": grp.get("name") or f"#{r['group_id']}",
            "weekly_count": r.get("weekly_count") or 0,
            "placed": got,
        })
        e["weekly"] += r.get("weekly_count") or 0
        e["placed"] += got

    def class_key(c):
        nums = _re.findall(r"\d+", c["group_name"])
        return ([int(n) for n in nums[:2]] + [0, 0])[:2] + [c["group_name"]]

    for e in by_sub.values():
        e["classes"].sort(key=class_key)

    electives: dict[int, dict[str, Any]] = {}
    for holder, opt in _elective_sites(tid):
        sid = opt.get("subject_id")
        subj = s_map.get(sid) or {}
        e = electives.setdefault(sid, {
            "subject_id": sid,
            "code": opt.get("code") or subj.get("code") or f"#{sid}",
            "name": opt.get("label") or subj.get("name") or "",
            "pools": 0, "slots": 0, "where": [],
        })
        if "options" in holder and "group_ids" in holder:
            e["pools"] += 1
            label = holder.get("name") or "ชุดคาบเสรี"
        else:
            e["slots"] += 1
            label = (g_map.get(holder.get("group_id")) or {}).get("name") or "คาบเสรี"
        if label not in e["where"]:
            e["where"].append(label)

    # หน้าที่ดูแลกิจกรรม — แสดงให้เห็นว่ายังค้างอยู่ แต่ยังไม่ได้โอนให้
    acts: dict[str, dict[str, Any]] = {}
    for s in SLOTS:
        if not s.get("is_activity_block") or tid not in _slot_teachers(s):
            continue
        key = s.get("activity_key") or f"SLOT-{s['id']}"
        a = acts.setdefault(key, {
            "activity_key": key,
            "name": s.get("subject_name") or s.get("activity_scope") or "กิจกรรม",
            "slots": 0,
        })
        a["slots"] += 1

    subjects = sorted(by_sub.values(), key=lambda e: e["code"])
    return {
        "teacher": {"id": t["id"], "name": t.get("name")},
        "subjects": subjects,
        "electives": sorted(electives.values(), key=lambda e: e["code"]),
        "activities": sorted(acts.values(), key=lambda a: a["name"]),
        "totals": {
            "rows": sum(len(e["classes"]) for e in subjects),
            "weekly": sum(e["weekly"] for e in subjects),
            "slots": sum(e["placed"] for e in subjects),
        },
    }


def _handover_clashes(to_id: int, moving: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """คาบที่ครูผู้รับช่วงจะต้องยืนสองที่พร้อมกัน ถ้าโอนตามที่เลือกไว้

    ถามก่อนลงมือเสมอ เพราะมันคือสิ่งเดียวที่การโอนทำให้แย่ลงได้ และเป็นเรื่องที่
    โรงเรียนต้องตัดสินใจเอง ไม่ใช่ระบบ
    """
    g_map = {g["id"]: g for g in _flat_groups()}
    s_map = {s["id"]: s for s in SUBJECTS}
    mine = {id(x) for x in moving}
    seen: set[tuple] = set()
    out: list[dict[str, Any]] = []

    def parent_of(gid):
        return (g_map.get(gid) or {}).get("parent_id")

    for s in moving:
        bks = _slot_buckets(g_map.get(s.get("group_id")), s.get("period"))
        for x in SLOTS:
            if x is s or x.get("day") != s.get("day"):
                continue
            # ครูใหม่อยู่ในคาบนั้นอยู่แล้ว หรือกำลังจะถูกโอนมาพร้อมกัน
            if to_id not in _slot_teachers(x) and id(x) not in mine:
                continue
            if x.get("group_id") == s.get("group_id"):
                continue
            if _same_activity(s, x):
                continue
            # ห้องย่อยพี่น้องที่เรียนวิชาเดียวกัน = คาบเดียว ครูสอนทีเดียว
            if (x.get("subject_id") == s.get("subject_id")
                    and parent_of(x.get("group_id")) is not None
                    and parent_of(x.get("group_id")) == parent_of(s.get("group_id"))):
                continue
            if not (bks & _slot_buckets(g_map.get(x.get("group_id")), x.get("period"))):
                continue
            key = tuple(sorted([s.get("group_id"), x.get("group_id")])) + (
                s.get("day"), s.get("period"))
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "day": s.get("day"), "period": s.get("period"),
                "group_name": (g_map.get(s.get("group_id")) or {}).get("name"),
                "subject_code": (s_map.get(s.get("subject_id")) or {}).get("code"),
                "with_group": (g_map.get(x.get("group_id")) or {}).get("name"),
                "with_subject": (s_map.get(x.get("subject_id")) or {}).get("code")
                                or ("คาบเสรี" if x.get("is_elective") else
                                    "กิจกรรม" if x.get("is_activity_block") else None),
            })
    out.sort(key=lambda c: (c["day"], c["period"], c["group_name"] or ""))
    return out


@app.post("/api/teachers/handover")
def teacher_handover(body: dict[str, Any]):
    """โอนวิชาที่เลือกจากครูคนหนึ่งไปอีกคน

    dry_run=True คือพรีวิว: นับให้ว่าจะย้ายกี่แถวกี่คาบ และชนกี่คาบ โดยไม่แตะ
    ข้อมูลเลยสักตัว หน้าจอเรียกอันนี้ทุกครั้งที่ติ๊กเปลี่ยน
    """
    from_id = body.get("from_teacher_id")
    to_id = body.get("to_teacher_id")
    if from_id is None or to_id is None:
        raise HTTPException(400, "ต้องเลือกครูทั้งสองคน")
    if from_id == to_id:
        raise HTTPException(400, "เลือกครูคนเดียวกันทั้งสองช่อง — ต้องเป็นคนละคน")
    _teacher_record(int(from_id))
    to_t = _teacher_record(int(to_id))
    from_id, to_id = int(from_id), int(to_id)

    want_reqs = {int(i) for i in (body.get("requirement_ids") or [])}
    want_elec = {int(i) for i in (body.get("elective_subject_ids") or [])}
    dry = bool(body.get("dry_run"))

    # แถวที่เป็นของครูคนนี้จริงๆ เท่านั้น — รหัสที่ส่งมาปนจากครูคนอื่นถูกข้าม
    rows = [r for r in REQUIREMENTS
            if r["id"] in want_reqs and r.get("teacher_id") == from_id]
    pairs = {(r["group_id"], r.get("subject_id")) for r in rows}
    moving = [s for s in SLOTS
              if s.get("teacher_id") == from_id
              and (s.get("group_id"), s.get("subject_id")) in pairs]
    opts = [(h, o) for h, o in _elective_sites(from_id)
            if o.get("subject_id") in want_elec]

    clashes = _handover_clashes(to_id, moving)
    result = {
        "ok": True, "applied": False,
        "rows": len(rows), "slots": len(moving), "electives": len(opts),
        "clashes": clashes,
        "activities_left": sum(
            1 for s in SLOTS
            if s.get("is_activity_block") and from_id in _slot_teachers(s)),
        "to_teacher": {"id": to_t["id"], "name": to_t.get("name")},
    }
    if dry:
        return result

    for r in rows:
        r["teacher_id"] = to_id
    for s in moving:
        s["teacher_id"] = to_id
        s["teacher_name"] = to_t.get("name")
        # ถ้าครูผู้รับช่วงเป็นคู่สอนร่วมของคาบนี้อยู่แล้ว ก็ไม่ต้องนับสองครั้ง
        if s.get("co_teacher_id") == to_id:
            s.pop("co_teacher_id", None)
            s.pop("co_teacher_name", None)
    for _holder, o in opts:
        o["teacher_id"] = to_id
    _save_state()
    result["applied"] = True
    return result


# ── Subjects ──────────────────────────────────────────────────────────────────
@app.get("/api/subjects/")
def get_subjects():
    # Reconcile the วิชาเสรี tick on the way out, so a subject already sitting
    # in a คาบเสรี arrives marked instead of waiting to be ticked by hand.
    _elective_subject_ids()
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
            _refresh_names_for(subject_id=i)
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
# สองอย่างที่คิดจากข้อมูลอื่น ไม่ได้เก็บไว้ในแถว — ส่งออกไปให้หน้าจอใช้ แต่ถ้า
# หน้าจอส่งกลับมาตอนแก้ไข ต้องทิ้ง ไม่งั้นค่าที่คิดไว้วันนี้จะถูกฝังไว้เป็นของจริง
_DERIVED_REQ_KEYS = ("served_by_elective", "co_half")


def _requirement_rows() -> list[dict[str, Any]]:
    """แถวของแผนการสอน พร้อมบอกว่าแถวไหน "ไม่ต้องจัดเอง"

    สองกรณีที่แถวหนึ่งไม่ใช่คาบที่ต้องหาที่ลงให้:

      วิชาเสรี   ห้องนี้นั่งอยู่ในคาบเสรีที่เปิดวิชานี้ให้เลือกอยู่แล้ว คาบเสรี
                 คือชั่วโมงที่สอนจริง แถวในแผนคือ "ห้องนี้เลือกวิชานี้ได้"
      สอนร่วม    สองแถวที่อ้างถึงกัน คือคาบเดียวที่เขียนจากมุมครูสองคน

    ตัวจัดตารางกับรายการ "คาบที่ลงไม่ได้" รู้เรื่องนี้อยู่แล้ว แต่หน้าจอที่
    นับเองไม่รู้ — ม.4/6ข จึงขึ้นว่า ศ31210 ลงได้ 0/2 คาบ ทั้งที่มันอยู่ใน
    คาบเสรีบ่ายอังคารเรียบร้อยแล้ว ส่งออกไปจากที่เดียวกันเสียเลย จะได้ไม่มีสอง
    คำตอบสำหรับคำถามเดียว
    """
    served = _reqs_served_by_elective()
    halves, _pairs = _fold_coteaching(REQUIREMENTS)
    out = []
    for r in REQUIREMENTS:
        row = dict(r)
        if r["id"] in served:
            row["served_by_elective"] = True
        if r["id"] in halves:
            row["co_half"] = True
        out.append(row)
    return out


def _curriculum_refusal(group_id: Any, subject_id: Any, weekly_count: Any) -> str | None:
    """Why this plan row may not be written to this class's curriculum, or None.

    check_row, with a curriculum that cannot be read counted as a refusal too
    (its message names the curriculum). One function for the three places a row
    is written, so each only has to decide what to do with a message."""
    try:
        return _CUR.check_row(group_id, subject_id, weekly_count)
    except ValueError as exc:
        return str(exc)


@app.get("/api/timetable/requirements")
def get_requirements(group_id: int | None = None):
    rows = _requirement_rows()
    if group_id:
        return [r for r in rows if r["group_id"] == group_id]
    return rows

@app.post("/api/timetable/requirements")
def create_req(body: dict[str, Any]):
    # Checked here as well as in the bulk import. A row naming a class that is
    # not there can never be placed, and nothing downstream can tell the school
    # why: it simply turns up in คาบที่ลงไม่ได้ for ever, with no class name
    # against it. Far better to refuse it at the door.
    if body.get("group_id") not in {g["id"] for g in _flat_groups()}:
        raise HTTPException(400, "ไม่พบห้องเรียนที่อ้างถึง")
    if body.get("subject_id") not in {s["id"] for s in SUBJECTS}:
        raise HTTPException(400, "ไม่พบรายวิชาที่อ้างถึง")
    # A class on a หลักสูตร takes only what it says (see check_row). Before
    # anything is written, so a refusal does not use up a row number either.
    refusal = _curriculum_refusal(body.get("group_id"), body.get("subject_id"), body.get("weekly_count"))
    if refusal:
        raise HTTPException(400, refusal)
    for k in _DERIVED_REQ_KEYS:
        body.pop(k, None)
    body["id"] = _next("requirement")
    REQUIREMENTS.append(body)
    return body


@app.get("/api/timetable/requirements/orphans")
def list_orphan_reqs():
    """Rows whose ห้องเรียน is no longer in the system.

    They cannot be placed and cannot be fixed from the timetable screen, so
    they sat in คาบที่ลงไม่ได้ as a nameless "?" — the school's biggest single
    block of missing periods was rows for classes that no longer exist.
    """
    gids = {g["id"] for g in _flat_groups()}
    s_map = {s["id"]: s for s in SUBJECTS}
    t_map = {t["id"]: t for t in TEACHERS}
    rows = [r for r in REQUIREMENTS if r.get("group_id") not in gids]
    return {
        "count": len(rows),
        "periods": sum(r.get("weekly_count") or 0 for r in rows),
        "rows": [{"id": r["id"], "group_id": r.get("group_id"),
                  "subject_code": (s_map.get(r.get("subject_id")) or {}).get("code"),
                  "subject_name": (s_map.get(r.get("subject_id")) or {}).get("name"),
                  "teacher_name": (t_map.get(r.get("teacher_id")) or {}).get("name"),
                  "weekly_count": r.get("weekly_count") or 0}
                 for r in rows[:200]],
    }


@app.delete("/api/timetable/requirements/orphans")
def purge_orphan_reqs():
    """Delete those rows. Asked for explicitly — never done behind the school's back."""
    global REQUIREMENTS
    gids = {g["id"] for g in _flat_groups()}
    before = len(REQUIREMENTS)
    REQUIREMENTS = [r for r in REQUIREMENTS if r.get("group_id") in gids]
    return {"deleted": before - len(REQUIREMENTS)}

@app.put("/api/timetable/requirements/{i}")
def update_req(i: int, body: dict[str, Any]):
    # แก้ไขแถว: the class and the subject can both be changed from the teacher's
    # page now, so they are checked here the same way the import checks them.
    # A row may only ever be moved to a class that exists — moving it to one
    # that does not is how a row becomes unplaceable and unexplainable.
    if "group_id" in body and body["group_id"] not in {g["id"] for g in _flat_groups()}:
        raise HTTPException(400, "ไม่พบห้องเรียนที่อ้างถึง")
    if "subject_id" in body and body["subject_id"] not in {s["id"] for s in SUBJECTS}:
        raise HTTPException(400, "ไม่พบรายวิชาที่อ้างถึง")
    for k in _DERIVED_REQ_KEYS:
        body.pop(k, None)
    for r in REQUIREMENTS:
        if r["id"] == i:
            # The curriculum is asked about the row as it WILL be, against the
            # class it will be in (a move is judged by the destination's
            # curriculum). Only when the class, subject or periods change: a row
            # that was already outside a curriculum attached later must still
            # take a new teacher or a pinned period, and a screen that sends the
            # whole row back changes none of the three.
            merged = {**r, **body}
            if any(merged.get(k) != r.get(k) for k in ("group_id", "subject_id", "weekly_count")):
                refusal = _curriculum_refusal(merged.get("group_id"), merged.get("subject_id"),
                                              merged.get("weekly_count"))
                if refusal:
                    raise HTTPException(400, refusal)
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
    created, rejected, updated = [], [], []
    unchanged = 0
    for i, row in enumerate(body):
        for k in _DERIVED_REQ_KEYS:
            row.pop(k, None)
        if not row.get("group_id") or not row.get("subject_id"):
            rejected.append({"row": i, "reason": "ข้อมูลไม่ครบ (ต้องมีห้องเรียนและวิชา)"})
            continue
        # ครูเว้นว่างได้. A เซ็ตห้องย่อย is written down before anyone knows
        # who will teach it, and rejecting those rows meant the เซ็ต saved
        # nothing at all: the list stayed empty and there was nothing to edit.
        # The row is kept with no teacher, reported as "ยังไม่ได้เลือกครู",
        # and never placed until one is chosen.
        row["teacher_id"] = row.get("teacher_id") or 0
        missing = [label for label, val, pool in
                   (("ห้องเรียน", row["group_id"], gids),
                    ("วิชา", row["subject_id"], sids))
                   if val not in pool]
        if row["teacher_id"] and row["teacher_id"] not in tids:
            missing.append("ครู")
        if missing:
            rejected.append({"row": i, "reason": f"ไม่พบ{'/'.join(missing)}ที่อ้างถึง"})
            continue
        # Row by row like the checks above, so one row outside a หลักสูตร never
        # fails the file. Before the "same assignment" merge below, which can
        # change the periods of a row that is already there.
        refusal = _curriculum_refusal(row["group_id"], row["subject_id"], row.get("weekly_count"))
        if refusal:
            rejected.append({"row": i, "reason": refusal})
            continue
        # สอนร่วม: a second teacher nobody knows would be booked into the cell
        # and never show up, so an unknown one is dropped rather than kept.
        # Naming the same teacher twice is a typo, not a pair.
        co = row.get("co_teacher_id")
        if co is not None and (co not in tids or co == row["teacher_id"]):
            row["co_teacher_id"] = None
        # The same class, subject and teacher is the same assignment, not a
        # second one. Importing a plan is something a school does more than
        # once — a sheet gets corrected and sent round again — and without
        # this, the second import silently doubles every lesson that was
        # already there. Matching rows have their คาบ/สัปดาห์ brought up to
        # date instead, so re-importing settles rather than piles up.
        key = (row["group_id"], row["subject_id"], row["teacher_id"],
               row.get("parallel_group_key"))
        same = next((r for r in REQUIREMENTS
                     if (r["group_id"], r["subject_id"], r["teacher_id"],
                         r.get("parallel_group_key")) == key), None)
        if same:
            changed = False
            want = row.get("weekly_count")
            if want is not None and want != same.get("weekly_count"):
                same["weekly_count"] = want
                changed = True
            if "co_teacher_id" in row and row["co_teacher_id"] != same.get("co_teacher_id"):
                same["co_teacher_id"] = row["co_teacher_id"]
                changed = True
            if changed:
                updated.append(same)
            else:
                unchanged += 1
            continue
        row["id"] = _next("requirement")
        row.setdefault("weekly_count", 1)
        row.setdefault("parallel_group_key", None)
        REQUIREMENTS.append(row)
        created.append(row)
    # Folded here, where the duplicates are born: a เซ็ต saved with the teacher
    # left blank writes a row for a class that may already have that subject,
    # and two rows for one lesson is how the school ended up with six periods
    # of a two-period subject. Merging now means the screen the school goes
    # back to already shows one row, with its teacher.
    tidy = _tidy_requirements()
    created = [r for r in created if r in REQUIREMENTS]
    if rejected or updated or unchanged or tidy["merged"] or tidy["teachers_filled"]:
        return {"created": created, "rejected": rejected,
                "updated": updated, "unchanged": unchanged,
                "merged": tidy["merged"], "teachers_filled": tidy["teachers_filled"]}
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
    # A สอนร่วม lesson is on both teachers' timetables, so asking for one
    # teacher's slots has to include the ones where they are the second —
    # and a คาบกิจกรรม they help run is one period on their sheet, not one
    # per classroom taking part.
    if teacher_id is not None: result = _teacher_view(result, teacher_id)
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

    group = _find_group(int(body["group_id"]))
    day, period = int(body["day"]), int(body["period"])

    # คาบคู่ added by hand. Two periods back to back, one lesson: the school
    # builds these as a pair or not at all, so the second half is found and
    # judged here rather than left for somebody to add separately and get
    # wrong. The next period is the next one THIS class has — ม.ต้น and
    # ม.ปลาย break at different times, so "the one after" is not the same
    # period number for both.
    second = _next_class_period_for(_level_key(group), period) if body.get("is_double") else None
    if body.get("is_double") and second is None:
        raise HTTPException(400, "คาบนี้ต่อคาบคู่ไม่ได้ — เป็นคาบสุดท้ายของวัน "
                                 "หรือคาบถัดไปเป็นเวลาพัก")

    key = f"MAN-{_next('activity')}" if second is not None else None
    made: list[dict[str, Any]] = []
    for i, p in enumerate([period] + ([second] if second is not None else [])):
        made.append({
            "id": _next("slot"),
            "day": day, "period": p,
            "group_id": int(body["group_id"]),
            "teacher_id": int(body["teacher_id"]),
            "subject_id": int(body["subject_id"]),
            "room_id": body.get("room_id"),
            # Both halves share a room: a คาบคู่ that moves rooms halfway
            # through is two lessons wearing one name.
            "is_double_start": second is not None and i == 0,
            "is_double_cont": second is not None and i > 0,
            "double_group_key": key,
            "parallel_group_key": body.get("parallel_group_key"),
            "is_locked": bool(body.get("is_locked", False)),
        })

    SLOTS.extend(made)
    # คาบเรียนลาน: a lesson put down by hand on a picked cell takes that ลาน —
    # this is how a lesson with no room is given the hour the school kept for it.
    for x in made:
        _settle_yard(x)
    if not body.get("force"):
        # Judge the cells with the new lesson in place — both of them, so a
        # double is never half-created.
        problems = _validate_moves([{"slot_id": x["id"]} for x in made])
        if problems:
            for x in made:
                SLOTS.remove(x)
            _counters["slot"] -= len(made)
            raise HTTPException(409, " · ".join(problems[:3]))
    return _enrich_slot(made[0])

def _teacher_clash_with(s: dict[str, Any]) -> tuple[int, dict[str, Any]] | None:
    """ครูของคาบนี้ยังติดสอนคาบอื่นอยู่ในชั่วโมงเดียวกันไหม — (ครู, คาบนั้น)

    The one place that decides whether a red frame's teacher half is settled.
    _settle_overflow lifts the frame only when this finds nothing, and the
    yard-rescue answer reads the same function to tell the school that a ลาน
    will give the lesson a room but not clear its frame — so the advice and the
    frame cannot disagree about whether a clash exists.

    Judged by the clock (a lesson in คาบ 7 of ม.4 and one in คาบ 7 of ม.2 are
    the same minutes), over every teacher in the room (สอนร่วม, ครูผู้ดูแล), and
    a lesson that is itself red-framed does not count: it has not been settled
    anywhere yet. With several teachers in the clash it names the lesson's own
    teacher first."""
    mine = set(_slot_teachers(s))
    if not mine:
        return None
    g_map = {g["id"]: g for g in _flat_groups()}
    bks = _slot_buckets(g_map.get(s.get("group_id")), s.get("period"))
    for x in SLOTS:
        if x is s or x.get("is_overflow") or x.get("day") != s.get("day"):
            continue
        both = mine & set(_slot_teachers(x))
        if not both:
            continue
        if bks & _slot_buckets(g_map.get(x.get("group_id")), x.get("period")):
            own = s.get("teacher_id")
            return (own if own in both else min(both)), x    # ครูยังติดสอนอยู่ในชั่วโมงนี้
    return None


def _settle_overflow(s: dict[str, Any]) -> dict[str, Any]:
    """คาบกรอบแดงที่แก้เรียบร้อยแล้ว ให้กรอบหายไปเอง

    กรอบแดงบอกอยู่สองเรื่องเท่านั้น — ยังไม่ได้กำหนดห้อง หรือครูยังติดสอน
    ห้องอื่นในชั่วโมงนั้น พอทั้งสองเรื่องเรียบร้อย มันก็เป็นคาบธรรมดาคาบหนึ่ง
    ไม่ต้องให้โรงเรียนมานั่งกดปลดเองอีกที
    """
    if not s.get("is_overflow") or not s.get("room_id"):
        return s
    if _teacher_clash_with(s) is not None:
        return s                          # ครูยังติดสอนอยู่ในชั่วโมงนี้
    s.pop("is_overflow", None)
    return s


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
    # สอนร่วม and the supervisors of an activity block are teachers too, and a
    # slot re-enriched after an edit used to come back with their names gone
    # while their ids stayed — the cell then showed one name and booked two.
    co = s.get("co_teacher_id")
    s["co_teacher_name"] = t_map.get(co, {}).get("name") if co else None
    sup = s.get("activity_teacher_ids") or []
    s["activity_teacher_names"] = [t_map[i]["name"] for i in sup if i in t_map]
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
    """Kept as the one door every elective-slot reply goes through.

    It used to copy the chosen option onto the cell. Nothing is chosen any
    more — the cell is the window itself — so the cell names no subject and no
    single teacher, and the options carry the detail.
    """
    s["selected_option_id"] = None
    s["subject_id"] = None
    s["teacher_id"] = None
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
    # คีย์คือค่าที่ฟังก์ชันนี้อ่านจริงๆ ไม่ใช่ id ของห้อง — ห้องคนละก้อนที่ id
    # ซ้ำกัน (ตอนโหลดข้อมูลใหม่ หรือในชุดทดสอบ) จึงไม่หยิบคำตอบของกันและกัน
    key = ("level", group.get("level"), group.get("name"))
    hit = _LOOKUP_CACHE.get(key)
    if hit is not None:
        return hit
    out = "upper"
    for text in (group.get("level"), group.get("name")):
        m = _re.search(r"(\d)", str(text or ""))
        if m:
            out = "lower" if int(m.group(1)) <= 3 else "upper"
            break
    _LOOKUP_CACHE[key] = out
    return out


def _periods_for_level(level: str) -> dict[int, dict[str, Any]]:
    """The day as this level actually experiences it, by period number.

    ผลที่คืนไปใช้ร่วมกันทั้งระบบ ห้ามแก้ — ทุกที่ที่เรียกอ่านอย่างเดียว
    (ตรวจครบทั้ง 13 จุดแล้ว) ถ้าจะแก้ ให้ dict(...) ของตัวเองก่อน
    """
    key = ("periods", level)
    hit = _LOOKUP_CACHE.get(key)
    if hit is not None:
        return hit
    out: dict[int, dict[str, Any]] = {}
    for p in PERIODS:
        applies = p.get("applies_to", "all") or "all"
        if applies == "all" or applies == level or level == "all":
            # A level-specific row wins over the "all" row for the same number.
            if p["period_num"] in out and applies == "all":
                continue
            out[p["period_num"]] = p
    _LOOKUP_CACHE[key] = out
    return out


def _class_periods_for_level(level: str) -> list[int]:
    """ห้ามแก้ลิสต์ที่ได้ไป ใช้ร่วมกันทั้งระบบเหมือน _periods_for_level"""
    key = ("classnums", level)
    hit = _LOOKUP_CACHE.get(key)
    if hit is not None:
        return hit
    out = sorted(n for n, p in _periods_for_level(level).items() if p["type"] == "class")
    _LOOKUP_CACHE[key] = out
    return out


def _hhmm(t: str | None) -> int | None:
    key = ("hhmm", t)
    if key in _LOOKUP_CACHE:
        return _LOOKUP_CACHE[key]
    try:
        h, m = str(t).split(":")
        out: int | None = int(h) * 60 + int(m)
    except Exception:
        out = None
    _LOOKUP_CACHE[key] = out
    return out


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

def _free_period_subject() -> dict[str, Any]:
    """วิชาสำหรับคาบว่างที่จองไว้ — มีตัวเดียวทั้งโรงเรียน สร้างให้ครั้งแรกที่ใช้

    มันต้องเป็น "วิชา" เพราะทุกคาบในตารางอ้างวิชา แต่ไม่ใช่วิชาที่ใครต้องสอน
    จึงไม่มีกลุ่มสาระ ไม่มีหน่วยกิต และไม่เคยปรากฏในแผนการสอนของห้องไหน
    """
    for s in SUBJECTS:
        if s.get("is_free_period"):
            return s
    made = {"id": _next("subject"), "code": "FREE", "name": "คาบว่าง",
            "type": "common", "duration": 1, "department_id": None,
            "is_activity": True, "is_free_period": True,
            "fixed_room_id": None, "credits": 0}
    SUBJECTS.append(made)
    return made


@app.post("/api/timetable/level-activity")
def create_level_activity(body: dict[str, Any]):
    day        = int(body["day"])
    period     = int(body["period"])
    # ── คาบว่างที่ตรงกันทั้งกลุ่ม ──────────────────────────────────────────
    #
    # "อยากให้ ม.3/5 - 3/14 มีคาบว่างที่ตรงกัน จะได้จัดกิจกรรมต่างๆ ได้
    #  ก็ให้นับเป็นคาบว่างไปเลย"
    #
    # ต่างจากคาบว่างที่เหลือจากการจัดตาราง: อันนี้คือชั่วโมงที่โรงเรียนจองไว้
    # ให้ว่างพร้อมกันทั้งกลุ่ม จะได้เรียกเด็กมารวมกันได้ มันจึงต้องเป็นสองอย่าง
    # ที่ดูขัดกัน — ตัวจัดตารางต้องเห็นว่า "ไม่ว่าง" จะได้ไม่เอาวิชาอื่นมาทับ
    # แต่คนอ่านตารางกับรายงานต้องเห็นว่า "ว่าง" เพราะมันว่างจริงๆ
    #
    # ไม่จองครูและไม่จองห้อง เพราะไม่มีใครต้องมาคุมและไม่มีใครต้องใช้ห้อง
    free_period = bool(body.get("free_period"))
    if free_period:
        subject_id = _free_period_subject()["id"]
    else:
        subject_id = int(body["subject_id"])
    room_mode  = body.get("room_mode", "homeroom")   # "homeroom" | "none"
    if free_period:
        room_mode = "none"
    # teacher_mode: "homeroom" → each class is supervised by its own ครูประจำชั้น
    #               "single"   → one named teacher for every class
    #               "none"     → no teacher assigned
    teacher_mode = body.get("teacher_mode", "none")
    teacher_id   = body.get("teacher_id")
    teacher_id   = int(teacher_id) if teacher_id not in (None, "") else None
    if teacher_id is not None and teacher_mode == "none":
        teacher_mode = "single"
    if free_period:
        teacher_mode, teacher_id = "none", None
    # ครูผู้ดูแล — one list for the whole activity, not one per class.
    #
    # The school picks the twelve teachers who run ลูกเสือ and sorts out which
    # หมู่ each of them takes between themselves; that split is not something
    # the timetable needs to know or would get right. What the timetable owes
    # them is the hour: every name on this list is busy then, and sees the
    # period on their own sheet.
    known = {t["id"] for t in TEACHERS}
    roster: list[int] = []
    for t in ([] if free_period else (body.get("teacher_ids") or [])):
        t = int(t)
        if t in known and t not in roster:
            roster.append(t)

    # Which classes. The school names them outright now: ลูกเสือ is ม.1–3 but
    # ชุมนุม is everybody, and no level ever described either of them well.
    # `level` is still accepted so activities saved by the old screen reload.
    by_id = {g["id"]: g for g in _flat_groups()}
    if body.get("group_ids"):
        targets = [by_id[int(i)] for i in body["group_ids"] if int(i) in by_id]
        label = body.get("label") or ""
    else:
        level = body.get("level") or ""
        # Whole-class activity → top-level classes only, never the subgroups
        # (ก/ข/ค), so the parent and its children can't double-book.
        targets = [g for g in _flat_groups()
                   if g.get("level") == level and not g.get("parent_id")]
        label = level
    if not targets:
        raise HTTPException(400, "ยังไม่ได้เลือกห้องเรียน")

    t_names = {t["id"]: t["name"] for t in TEACHERS}

    # Anyone on the roster who is already teaching then is dropped once, with
    # one warning — not once per classroom, which for ชุมนุม would be sixty
    # copies of the same sentence.
    created, skipped, warnings = [], [], []
    scope = f"{label} {len(targets)} ห้อง" if label else f"{len(targets)} ห้อง"
    # ชุมนุม/สาธารณประโยชน์ มาก่อนคาบธรรมดา: ordinary lessons sitting in this
    # hour are moved out and re-placed by the next จัดตาราง, rather than the
    # class being the one room of the level that misses the activity.
    #
    # Done BEFORE the roster is checked, not after. The teachers who run an
    # activity are often the same teachers who were teaching the lessons it
    # displaces, and asking "are you free then?" while their lesson was still
    # in the way dropped four of this school's five ลูกเสือ supervisors from
    # their own activity.
    evicted: list[dict] = []
    blocked: set[int] = set()
    for g in targets:
        hits = [s for s in SLOTS
                if s["day"] == day and s["period"] == period
                and s["group_id"] == g["id"]]
        gone = _evict_ordinary(day, [period], hits)
        evicted.extend(gone)
        if len(gone) < len(hits):
            keeper = next(s for s in hits if s not in gone)
            blocked.add(g["id"])
            skipped.append({"group": g["name"],
                            "reason": keeper.get("subject_code") or "มีคาบที่ล็อกไว้อยู่แล้ว"})

    free_roster = []
    for t in roster:
        if any(s["day"] == day and s["period"] == period and t in _slot_teachers(s)
               for s in SLOTS):
            warnings.append(f"ครู {t_names.get(t, t)} ติดสอนคาบนี้อยู่ จึงไม่ได้ใส่ให้")
        else:
            free_roster.append(t)

    # The key goes in a URL, so it carries no text the school typed. It used
    # to be f"ACT-{label}-…", and a label like "ลูกเสือ/เนตรนารี" put a slash
    # in the middle of the path: the route stopped matching and both แก้ไข and
    # ลบ answered Not Found for exactly the activities the school most wanted
    # to fix. The name lives on the slots; the key only has to be unique.
    key = f"ACT-{day}-{period}-{_next('activity')}"
    for g in targets:
        if g["id"] in blocked:
            continue

        # The roster covers the activity as a whole, so it goes on every
        # classroom's slot unchanged. Those slots all share one activity_key,
        # and everything that counts a teacher's time treats them as the one
        # hour they are — see _same_activity below.
        if free_roster:
            slot_teacher, extra = None, list(free_roster)
        elif teacher_mode == "homeroom":
            # Sub-classes take theirs from the class above, so ม.4/6ก gets
            # ม.4/6's advisor instead of being skipped for having none.
            ids = [t for t in _effective_homeroom_ids(g)
                   if not any(s["day"] == day and s["period"] == period
                              and t in _slot_teachers(s) for s in SLOTS)]
            slot_teacher, extra = (ids[0] if ids else None), ids[1:]
            if slot_teacher is None:
                warnings.append(f"{g['name']}: ไม่มีครูประจำชั้นที่ว่างในคาบนี้")
        elif teacher_mode == "single":
            slot_teacher, extra = teacher_id, []
        else:
            slot_teacher, extra = None, []

        slot = {
            "id": _next("slot"),
            "day": day, "period": period,
            "group_id": g["id"],
            "teacher_id": slot_teacher,
            "activity_teacher_ids": extra,
            "subject_id": subject_id,
            "room_id": g.get("homeroom_room_id") if room_mode == "homeroom" else None,
            "is_double_start": False,
            "parallel_group_key": None,
            "is_locked": True,
            "is_activity_block": True,
            # ช่องนี้ถูกจองไว้ให้ว่าง ไม่ใช่คาบเรียน — ตัวจัดตารางเห็นว่าไม่ว่าง
            # แต่รายงานกับตารางที่คนอ่านนับเป็นคาบว่าง
            "is_free_period": free_period or None,
            "activity_key": key,
            "activity_level": g.get("level") or label,
            # What to show on a teacher's own sheet, where naming one of the
            # fourteen classrooms would be picking a room at random.
            "activity_scope": scope,
        }
        SLOTS.append(slot)
        created.append(_enrich_slot(slot))
    if evicted:
        warnings.append(
            f"ย้ายคาบเรียนออกจากชั่วโมงนี้ {len(evicted)} คาบ "
            f"({', '.join(sorted({s.get('subject_code') or '?' for s in evicted})[:6])}) "
            f"— กดจัดตารางอีกครั้งเพื่อหาที่ให้ใหม่")
    return {"created": created, "skipped": skipped, "warnings": warnings,
            "activity_key": key, "evicted": len(evicted)}


@app.put("/api/timetable/level-activity/{activity_key}")
def update_level_activity(activity_key: str, body: dict[str, Any]):
    """Change an activity that already exists — day, period, classes, roster.

    Deleting and re-creating is what the school had to do before, and it is the
    wrong shape for a mistake: ชุมนุม covers sixty classrooms and a roster of a
    hundred and thirty, so "I put it on the wrong period" cost all of that typed
    again. Worse, the delete happens first, so a re-creation that then collides
    with something leaves the school with neither the old activity nor the new.

    So the old slots are lifted out, the new ones built in their place, and if
    nothing could be built the old ones go straight back. The hour is either
    changed or untouched — never lost.
    """
    global SLOTS
    old = [s for s in SLOTS if s.get("activity_key") == activity_key]
    if not old:
        raise HTTPException(404, "ไม่พบกิจกรรมนี้")

    # Anything the caller leaves out keeps what the activity already had.
    first = old[0]
    merged = {
        "day":        body.get("day",        first["day"]),
        "period":     body.get("period",     first["period"]),
        "subject_id": body.get("subject_id", first["subject_id"]),
        "group_ids":  body.get("group_ids",  [s["group_id"] for s in old]),
        "teacher_ids": body.get("teacher_ids", first.get("activity_teacher_ids") or []),
        "room_mode":  body.get("room_mode",
                               "homeroom" if any(s.get("room_id") for s in old) else "none"),
        "label":      body.get("label", ""),
        # คาบว่างที่จองไว้ ยังเป็นคาบว่างหลังแก้วัน/คาบ ถ้าไม่พกค่านี้ไปด้วย
        # การย้ายเวลาจะกลายเป็นการเปลี่ยนมันเป็นคาบเรียนเงียบๆ
        "free_period": body.get("free_period",
                                bool(first.get("is_free_period"))),
    }
    for k in ("teacher_mode", "teacher_id"):
        if k in body:
            merged[k] = body[k]

    SLOTS = [s for s in SLOTS if s.get("activity_key") != activity_key]
    try:
        result = create_level_activity(merged)
    except Exception:
        SLOTS.extend(old)          # put it back exactly as it was
        raise
    if not result["created"]:
        SLOTS = [s for s in SLOTS if s.get("activity_key") != result["activity_key"]]
        SLOTS.extend(old)
        raise HTTPException(
            409, "แก้ไขไม่ได้ — ทุกห้องที่เลือกมีคาบอื่นอยู่ในวัน/คาบใหม่แล้ว "
                 "(กิจกรรมเดิมยังอยู่ครบ)")
    return {**result, "replaced": len(old)}


@app.delete("/api/timetable/level-activity/{activity_key}")
def delete_level_activity(activity_key: str):
    """Remove every slot belonging to one level-wide activity."""
    global SLOTS
    before = len(SLOTS)
    SLOTS = [s for s in SLOTS if s.get("activity_key") != activity_key]
    return {"removed": before - len(SLOTS)}


# The same two, with the key in the body instead of the path.
#
# A key is a key, and some of the ones already saved have a "/" in them from
# when the activity's name was part of it — in a URL that is a new path
# segment, so the route never matched and the school was told Not Found for
# the activities it most wanted to delete. Old keys are repaired on load, but
# these doors do not depend on the key being URL-safe at all.

@app.post("/api/timetable/level-activity/delete")
def delete_level_activity_body(body: dict[str, Any]):
    return delete_level_activity(str(body.get("activity_key") or ""))


@app.post("/api/timetable/level-activity/update")
def update_level_activity_body(body: dict[str, Any]):
    key = str(body.pop("activity_key", "") or "")
    return update_level_activity(key, body)


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


def _evict_ordinary(day: int, periods: list[int], hits: list[dict]) -> list[dict]:
    """Lift ordinary lessons out of a window so a คาบเสรี/กิจกรรม can have it.

    "ลงคาบเสรีก่อนอะไรทั้งหมด (รวมถึงชุมนุมสาธารณะ)."

    A คาบเสรี or a ชุมนุม is a decision about one hour of the whole school's
    week, taken once and the same for everybody. An ordinary lesson is one of
    thirty cells and can sit in any of them. So when the two want the same
    cell, the window wins and the lesson goes back into the pile — the next
    จัดตาราง finds it somewhere else.

    What is NOT evicted: a lesson the school locked itself, another elective,
    and another activity period. Those are decisions of the same kind, and the
    newer one does not get to overrule them silently.
    """
    movable = [s for s in hits
               if not _held(s) and not s.get("is_elective")
               and not s.get("is_activity_block")]
    if not movable:
        return []
    doomed = {id(s) for s in movable}
    SLOTS[:] = [s for s in SLOTS if id(s) not in doomed]
    return movable


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
    placed, skipped, evicted = 0, [], []
    for gid in pool["group_ids"]:
        grp = _find_group(gid)
        if not grp:
            skipped.append({"group_id": gid, "reason": "ไม่พบห้องเรียน"})
            continue
        # A parent class and its subgroups hold the same students, so a lesson
        # on either blocks this window for the other.
        hits = [s for s in SLOTS
                if s["day"] == day and s["period"] in periods
                and shares(s["group_id"], gid)]
        # คาบเสรีมาก่อน: an ordinary lesson in the way is moved out rather
        # than the class being left without its elective. Anything the school
        # locked, or another elective or activity, still wins.
        gone = _evict_ordinary(day, periods, hits)
        evicted.extend(gone)
        if len(gone) < len(hits):
            skipped.append({"group_id": gid, "group_name": grp.get("name"),
                            "reason": "มีคาบที่ล็อกไว้อยู่แล้ว"})
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

    return {"placed": placed, "skipped": skipped,
            "evicted": [{"group_id": s["group_id"], "group_name": s.get("group_name"),
                         "subject_code": s.get("subject_code"),
                         "day": s["day"], "period": s["period"]}
                        for s in evicted]}


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
        if teacher_id in _slot_teachers(s):
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
        # Subjects in this window with nobody recorded as teaching them. An
        # imported elective list starts this way, and it is the one thing left
        # to do before the window is finished.
        "missing_teacher_count": sum(1 for o in options if not o.get("teacher_id")),
    }


@app.get("/api/elective-pools")
def get_elective_pools():
    return [_decorate_pool(p) for p in ELECTIVE_POOLS]


def _find_pool(pool_id: int) -> dict[str, Any]:
    pool = next((p for p in ELECTIVE_POOLS if p["id"] == pool_id), None)
    if not pool:
        raise HTTPException(404, "ไม่พบคาบเสรีนี้")
    return pool


def _who_teaches(subject_id: int) -> int | None:
    """Who the staffing data says takes this subject, if anybody does.

    The ordinary lesson assignments first, then any other elective window that
    already offers it — an elective subject has no ordinary lessons, so for the
    newly-arrived ones that second source is the only one there is.
    """
    teaches = [r["teacher_id"] for r in REQUIREMENTS if r["subject_id"] == subject_id]
    teaches += [o["teacher_id"] for q in ELECTIVE_POOLS for o in q.get("options", [])
                if o.get("subject_id") == subject_id and o.get("teacher_id")]
    return max(set(teaches), key=teaches.count) if teaches else None


def _clean_pool_options(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Subjects handed to a window all at once, as an import does.

    Adding them one at a time refuses a subject nobody is recorded as teaching,
    which is right for a single click — but a whole year's elective list arrives
    before the teaching is shared out, and stopping on the first unstaffed
    subject would mean none of the other hundred got in either. So the option is
    kept with no teacher and counted as outstanding (missing_teacher_count), for
    the school to fill in from the window itself.
    """
    s_map = {s["id"]: s for s in SUBJECTS}
    out: list[dict[str, Any]] = []
    for o in raw:
        subj = s_map.get(o.get("subject_id"))
        if not subj:
            continue                      # a subject that isn't there teaches nobody
        tid = o.get("teacher_id") or _who_teaches(subj["id"])
        if any(x["subject_id"] == subj["id"] and x.get("teacher_id") == tid for x in out):
            continue                      # the same row twice in one sheet
        out.append({
            "key": _next("elective_option"),
            "subject_id": subj["id"],
            "teacher_id": tid,
            "label": o.get("label") or subj["name"],
            "code": subj.get("code"),
        })
    return out


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
        "options": _clean_pool_options(body.get("options") or []),
    }
    _mark_elective(*[o["subject_id"] for o in pool["options"]])
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
    teacher_id = body.get("teacher_id") or _who_teaches(subject_id)
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
    _mark_elective(subject_id)
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
        _mark_elective(body["subject_id"])
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
    _mark_elective(option["subject_id"])
    common = {
        "group_id": body["group_id"],
        "room_id": body.get("room_id"),
        "parallel_group_key": None,
        "is_locked": True,
        "is_elective": True,
        # No option is "the" one: the cell is the window, and every option in
        # it runs at the same time.
        "selected_option_id": None,
        "subject_id": None,
        "teacher_id": None,
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
    _mark_elective(option["subject_id"])
    _sync_doubles(slot)
    return _enrich_slot(slot)

@app.delete("/api/timetable/elective-slots/{slot_id}/options/{option_id}")
def delete_elective_option(slot_id: int, option_id: int):
    slot = next((s for s in SLOTS if s["id"] == slot_id and s.get("is_elective")), None)
    if not slot:
        raise HTTPException(404, "Elective slot not found")
    # Removing the last วง leaves the window empty but still locked — the
    # period is the school's decision and should not evaporate because its
    # subject list was cleared out to be rebuilt.
    slot["elective_options"] = [o for o in slot["elective_options"] if o["id"] != option_id]
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

def _validate_moves(moves: list[dict[str, Any]],
                    allow_conflicts: bool = False) -> list[str]:
    """Problems with applying these moves together. Empty means it is fine.

    allow_conflicts = โหมดจัดเอง

      "ช่วยมีโหมดในการสลับคาบโดยใช้มือเลย โดยจะมีแจ้งเตือนเฉย ๆ แต่จะไม่บังคับ
       ใด ๆ เราสามารถเปลี่ยนห้องได้ (ยกเว้นจะไปชนกับคาบที่ล็อกเอาไว้)
       เราสามารถวางคาบลงไปได้ ถ้าชนกันก็จะขึ้นสีแดงให้ไปเลื่อนคาบที่ชนแทน"

    ในโหมดนี้ "ชนกัน" ไม่ใช่เหตุให้ปฏิเสธอีกต่อไป — คาบลงไปได้ แล้วขึ้นสีแดง
    ให้คนตัดสินใจเอง สิ่งที่ยังปฏิเสธมีสองอย่างเท่านั้น:

      · เรื่องเชิงโครงสร้าง — ไม่พบคาบ · วันไม่ถูกต้อง · ช่องนั้นไม่ใช่คาบเรียน
        ของชั้นนั้น (เช่นเอาคาบ ม.ต้นไปวางในคาบพักกลางวันของ ม.ต้น) อันนี้ไม่ใช่
        การชนกัน แต่เป็นช่องที่ไม่มีอยู่จริง
      · คาบที่ล็อกไว้ — โรงเรียนกำหนดเองว่าห้ามขยับ จึงห้ามทับด้วย
    """
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
            # โหมดจัดเอง: ชนกันได้ ยกเว้นชนกับคาบที่ล็อกไว้
            #
            # overlapping คือทุกคาบของทั้งโรงเรียนที่อยู่ในเวลาเดียวกัน ไม่ใช่
            # เฉพาะคาบที่ชนกันจริง ๆ การเช็ค is_locked ตรงนี้เฉย ๆ จึงเท่ากับ
            # ห้ามวางทุกครั้งที่มีคาบล็อกอยู่ที่ไหนสักแห่งในเวลานั้น — ต้องดูก่อน
            # ว่า "ชนกันจริงไหม" (นักเรียนกลุ่มเดียวกัน ครูคนเดียวกัน หรือห้อง
            # เดียวกัน) แล้วค่อยตัดสินว่าปล่อยผ่านหรือปฏิเสธ
            if allow_conflicts and not o.get("is_locked"):
                continue
            if shares(o["group_id"], s["group_id"]):
                a, b = g_name.get(s["group_id"], "?"), g_name.get(o["group_id"], "?")
                msgs.append(f"{a} มีคาบอื่นอยู่แล้ว" if a == b
                            else f"{a} กับ {b} ใช้นักเรียนกลุ่มเดียวกัน จึงเรียนพร้อมกันไม่ได้")
            mine, yours = _slot_teachers(s), _slot_teachers(o)
            if _same_activity(s, o):
                mine = yours = set()
            for tid in mine & yours:
                msgs.append(f"{t_name.get(tid, '?')} สอนคาบนี้อยู่แล้ว")
            if s.get("room_id") and s["room_id"] == o.get("room_id"):
                msgs.append(f"ห้อง {r_name.get(s['room_id'], '?')} ถูกใช้อยู่แล้ว")
            # ถึงตรงนี้ในโหมดจัดเอง แปลว่าคู่กรณีเป็นคาบที่ล็อกไว้ — ถ้าชนกันจริง
            # ค่อยปฏิเสธ พร้อมบอกว่าชนกับคาบล็อกตัวไหน
            if allow_conflicts:
                if not msgs:
                    continue
                who = g_name.get(o["group_id"], "?")
                msgs = [f"{m} (คาบที่ล็อกไว้ของ {who})" for m in msgs]
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
    conflicts = ([] if body.get("force")
                 else _validate_moves(moves, allow_conflicts=bool(body.get("manual"))))
    if conflicts:
        return {"ok": False, "conflicts": conflicts, "slots": []}

    by_id = {s["id"]: s for s in SLOTS}
    # Every move is applied before any lesson is settled onto a ลาน: in a swap,
    # the lesson leaving a picked cell has to have let go of the ลาน before the
    # one arriving is asked whether it is free, whichever of the two comes
    # first in the list.
    landed: list[tuple[dict[str, Any], tuple[int, int], bool]] = []
    for mv in moves:
        slot = by_id.get(mv.get("slot_id"))
        if not slot:
            continue
        came_from = (slot["day"], slot["period"])
        for k in ("day", "period", "room_id"):
            if k in mv:
                slot[k] = mv[k]
        _sync_doubles(slot)
        landed.append((slot, came_from, "room_id" in mv))
    out = []
    for slot, came_from, room_given in landed:
        # คาบเรียนลาน: a lesson that comes to rest on a picked cell takes that
        # ลาน, and one that has left a picked cell gives it up.
        _settle_yard(slot, came_from, room_given)
        out.append(_enrich_slot(_settle_overflow(slot)))
    return {"ok": True, "conflicts": [], "slots": out}


@app.patch("/api/timetable/slots/{slot_id}")
def patch_slot(slot_id: int, body: dict[str, Any]):
    # โหมดจัดเอง — ชนกันได้ ขึ้นสีแดงให้เห็น แต่ทับคาบที่ล็อกไว้ไม่ได้
    manual = bool(body.get("manual"))
    force = bool(body.get("force"))
    # ธงสองตัวนี้เป็นคำสั่ง ไม่ใช่ข้อมูลของคาบ ถ้าปล่อยไว้มันจะถูกเขียนลงไปใน
    # คาบตอน s.update(body) แล้วติดไปกับข้อมูลที่บันทึก
    body = {k: v for k, v in body.items() if k not in ("force", "manual")}
    if ("day" in body or "period" in body or "room_id" in body) and not force:
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
        problems = _validate_moves(batch, allow_conflicts=manual)
        if problems:
            raise HTTPException(409, " · ".join(problems[:3]))
    for s in SLOTS:
        if s["id"] == slot_id:
            old_day, old_period = s["day"], s["period"]
            pgk = s.get("parallel_group_key")
            travelled = []
            if ("day" in body or "period" in body) and pgk:
                for sib in SLOTS:
                    if (sib.get("parallel_group_key") == pgk and sib["id"] != slot_id
                            and sib["day"] == old_day and sib["period"] == old_period):
                        sib.update({k: v for k, v in body.items() if k in ("day", "period")})
                        travelled.append(sib)
            s.update(body)
            # คาบเรียนลาน: a lesson that comes to rest on a picked cell takes
            # that ลาน, and one that has left a picked cell gives it up. Only
            # when the edit is about WHERE the lesson is — locking it or
            # renaming its teacher must not move it onto a ลาน picked later.
            if any(k in body for k in ("day", "period", "room_id")):
                for sib in travelled:
                    _settle_yard(sib, (old_day, old_period))
                _settle_yard(s, (old_day, old_period), "room_id" in body)
            return _enrich_slot(_settle_overflow(s))
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
    mine = _slot_teachers(slot)
    if mine and any(mine & _slot_teachers(s) for s in at_target if not _same_activity(slot, s)):
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
    # เวรคาบสุดท้าย: how many last-period lessons each teacher should carry,
    # and how many they may be given at most. 0 = ไม่จำกัด.
    "min_last_period": LAST_PERIOD_MIN,
    "max_last_period": LAST_PERIOD_MAX,
    # ห้องของครู กับ ห้องประจำชั้นของนักเรียน — อันไหนมาก่อน.
    #
    # False (ค่าเริ่มต้น): the class stays in its own room and the teacher
    # walks to them. True: the students walk to the teacher's room.
    # A วิชา that needs a facility, and a class with a room kept for it,
    # are both decided before this is asked. One teacher can be set either
    # way on their own card, which overrides this.
    "teacher_room_over_homeroom": False,
    # ม.ต้นอยู่ห้องประจำชั้นก่อน แม้ครูจะตั้งว่าห้องของครูมาก่อน
    #
    # "ถ้า ม.ต้นมีห้องประจำ ต้องเรียนที่ห้องประจำก่อน"
    #
    # เด็กเล็กเดินข้ามโรงเรียนทุกคาบไม่ใช่เรื่องเดียวกับ ม.ปลายเดิน ห้องพิเศษ
    # ของวิชา (คอม นาฏศิลป์) ยังมาก่อนทั้งคู่เสมอ ปิดได้ถ้าโรงเรียนเปลี่ยนใจ
    "lower_homeroom_first": True,
    # ม.ปลายเดินไปเรียนที่ห้องที่โรงเรียน "กันไว้ให้ครู" ที่หน้าห้องสอน
    #
    # "ห้องที่มีครูประจำอยู่ ที่จะให้นักเรียนเข้ามาเรียนในนี้ ถ้าเป็น ม.ปลาย
    #  บังคับให้ลงครูที่มีชื่อก่อน แล้วค่อยลงครูในหมวดกลุ่มสาระ"
    #
    # คนละช่องกับ "ห้องประจำของครู" ที่ตั้งจากหน้าครู ซึ่งยังตาม
    # teacher_room_over_homeroom เหมือนเดิม — ชื่อครูบนห้องคือห้องที่มีไว้ให้
    # สอน เจ้าของได้ก่อน (place_order) แล้วลูกหมวดในกลุ่มสาระที่ห้องนั้นเป็นของ
    # ค่อยเติมเข้าไป · ม.ต้นไม่เกี่ยว ยังอยู่ห้องประจำชั้นของตัวเอง
    "upper_teacher_room_first": True,
}


def _lower_homeroom_first() -> bool:
    v = (SCHOOL_CONFIG or {}).get("lower_homeroom_first")
    return True if v is None else bool(v)


def _upper_teacher_room_first() -> bool:
    """ม.ปลาย: ห้องที่โรงเรียนเขียนชื่อครูไว้ ชนะห้องประจำชั้นของนักเรียน

      "ห้องที่มีครูประจำอยู่ ที่จะให้นักเรียนเข้ามาเรียนในนี้ ถ้าเป็น ม.ปลาย
       บังคับให้ลงครูที่มีชื่อก่อน แล้วค่อยลงครูในหมวดกลุ่มสาระ เน้นให้ครูที่
       สำคัญมีห้องสอนก่อนแล้วค่อยเติมลูกหมวดเข้าไป ทำแบบนี้กับทุกๆห้องเลย"

    คู่กับ lower_homeroom_first ที่สั่งตรงกันข้ามสำหรับ ม.ต้น: เด็กเล็กอยู่กับ
    ที่และครูเดินไปสอน ส่วน ม.ปลายเดินไปเรียนที่ห้องของครูได้ โรงเรียนนี้ตั้ง
    teacher_room_over_homeroom ไว้เป็น "นักเรียนอยู่กับที่" ทั้งโรงเรียน ซึ่ง
    ทำให้ห้องที่เขียนชื่อครูไว้ว่างทั้งสัปดาห์ — ข้อนี้เปิดเฉพาะ ม.ปลาย และ
    เฉพาะห้องที่มีชื่อครูอยู่จริง ที่เหลือไม่ขยับ

    เป็นการจัดลำดับ ไม่ใช่การบังคับ: ห้องไม่ว่างก็ยังไหลกลับไปห้องประจำชั้น
    ("บังคับก่อน แต่ถ้าจนตรอกให้ไปห้องอื่นได้")
    """
    v = (SCHOOL_CONFIG or {}).get("upper_teacher_room_first")
    return True if v is None else bool(v)

_STATE_PATH = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "data_state.json")
_SAVE_KEYS = ("departments", "buildings", "rooms", "teachers", "subjects",
              "requirements", "periods", "slots", "elective_pools", "school_config",
              "absences", "substitutions", "repayments", "curricula", "yard_picks")


def _snapshot() -> dict[str, Any]:
    """Everything worth keeping, in one plain structure."""
    return {
        "version": 1,
        "saved_at": _dt.datetime.now().isoformat(timespec="seconds"),
        # Carried so a restore can land ABOVE the number the browsers polling
        # this server have already seen. Without it a restore after a restart
        # sets the counter to 1, every open tab reads that as "older than what
        # I have" and none of them pick the recovered data up.
        "revision": REVISION["n"],
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
        # สอนแทน — a teacher's arrangements must outlive a redeploy just as the
        # timetable does; losing them silently is how people stop trusting it.
        "absences": ABSENCES,
        "substitutions": SUBSTITUTIONS,
        "repayments": REPAYMENTS,
        # หลักสูตร — losing these on a redeploy would leave every class
        # "unchecked" without saying so. Copied rather than handed over live
        # (unlike the lists above): a snapshot that IS the table is emptied by
        # anything that clears the table before restoring from it.
        "curricula": [{**c, "rows": [dict(r) for r in c.get("rows") or []]}
                      for c in CURRICULA],
        # คาบเรียนลาน — a pick is the school's own decision, made by hand before
        # the timetable is built; losing it on a redeploy would send those
        # classes back indoors without a word. Copied for the same reason as
        # the curricula above. The order of the ลาน rides inside school_config.
        "yard_picks": [dict(r) for r in YARD_PICKS],
        "counters": _counters,
    }


def _apply_snapshot(data: dict[str, Any]) -> None:
    """Replace the whole dataset. Anything absent is left as it is.

    Every incoming list is copied before the target is emptied. A snapshot
    taken from this same server hands back the live lists themselves, so
    clearing the target would empty the data being restored from it and leave
    nothing behind.
    """
    _lookup_cache_clear()   # ผังคาบอาจมาใหม่ทั้งก้อน
    for key, target in (("departments", DEPARTMENTS), ("buildings", BUILDINGS),
                        ("rooms", ROOMS), ("teachers", TEACHERS),
                        ("subjects", SUBJECTS), ("requirements", REQUIREMENTS),
                        ("periods", PERIODS), ("slots", SLOTS),
                        ("elective_pools", ELECTIVE_POOLS),
                        ("absences", ABSENCES), ("substitutions", SUBSTITUTIONS),
                        ("repayments", REPAYMENTS), ("curricula", CURRICULA),
                        ("yard_picks", YARD_PICKS)):
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

    _repair_activity_keys()
    _repair_elective_doubles()
    _tidy_requirements()

    if data.get("school_config"):
        SCHOOL_CONFIG.update(dict(data["school_config"]))

    # The revision counter has to come back with the data.
    #
    # Browsers watch this number to notice each other's edits, and they read it
    # going BACKWARDS as "the server restarted and lost everything" — which is
    # the only thing it can mean while the counter starts from zero on every
    # boot. So a restart that loaded the school's timetable perfectly still
    # announced itself as a disaster, every time the free host put the service
    # to sleep, and the warning that followed switched off live sync and the
    # automatic copies with it.
    #
    # The snapshot has carried this number all along; it was simply never read
    # back. max() because this process may already have served writes.
    saved_rev = data.get("revision")
    if isinstance(saved_rev, int):
        REVISION["n"] = max(REVISION["n"], saved_rev)

    # Keep issuing ids above everything that exists, however the data arrived.
    saved = dict(data.get("counters") or {})
    for key, value in saved.items():
        if isinstance(value, int):
            _counters[key] = max(_counters.get(key, 0), value)
    for key, rows in (("room", ROOMS), ("teacher", TEACHERS), ("subject", SUBJECTS),
                      ("requirement", REQUIREMENTS), ("department", DEPARTMENTS),
                      ("period", PERIODS), ("slot", SLOTS),
                      ("elective_pool", ELECTIVE_POOLS),
                      ("absence", ABSENCES), ("substitution", SUBSTITUTIONS),
                      ("repayment", REPAYMENTS), ("curriculum", CURRICULA),
                      ("yard_pick", YARD_PICKS)):
        _counters[key] = max(_counters.get(key, 0), _max_id(rows))
    _SUB.invalidate()
    _counters["group"] = max(_counters.get("group", 0), _max_id(_flat_groups()))


# ── Where the data actually lives ─────────────────────────────────────────────
# The file beside this code is not storage on a host with no permanent disk: the
# server sleeps when nobody is using it and comes back a different machine, with
# the file gone and the school's timetable with it. When DATABASE_URL is set the
# snapshot goes to Postgres instead and survives that, and the file stays as the
# fallback for running this locally or if the database cannot be reached.
_DB_URL = _os.environ.get("DATABASE_URL", "").strip()
# What is actually in use, which is not the same as what was configured —
# reported by /api/state/info so a silent fallback cannot look like success.
_STORE_KIND = "file"
_STORE_ERROR: str | None = None
_LAST_SAVED_AT: str | None = None

# Gzip, because the snapshot is 1.2 MB of JSON that compresses to about 70 KB,
# and every save crosses a network now rather than going to a local disk.
import gzip as _gzip
import threading as _threading
import time as _time
import atexit as _atexit


def _pack(snapshot: dict[str, Any]) -> bytes:
    # Level 3, not 6. This now runs inside every write request, and the extra
    # 16 KB over the wire costs less than the 9 ms it saves on each lesson the
    # school drags across the grid.
    return _gzip.compress(_json.dumps(snapshot, ensure_ascii=False).encode("utf-8"), 3)


def _unpack(blob: bytes) -> dict[str, Any]:
    return _json.loads(_gzip.decompress(bytes(blob)).decode("utf-8"))


def _db_connect():
    import psycopg
    return psycopg.connect(_DB_URL, connect_timeout=15)


_DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS app_state (
    id       integer PRIMARY KEY,
    data     bytea NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now()
)
"""
# One row, overwritten on every save, was the whole of the school's storage.
# That is a one-way door: whatever goes wrong — a restart that comes back on
# the shipped data, a bad restore, a timetable cleared by accident — the next
# save writes over the only copy there is, and the work is gone with no way
# back. So every save also leaves a dated copy here, and the school can look
# at the list and go back to any of them.
#
# A snapshot is ~70 KB packed, so thirty of them is about 2 MB. That is
# nothing next to a term's timetable.
_DB_HISTORY_SCHEMA = """
CREATE TABLE IF NOT EXISTS app_state_history (
    id       bigserial PRIMARY KEY,
    data     bytea NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now(),
    slots    integer,
    note     text
)
"""
_DB_UPSERT = """
INSERT INTO app_state (id, data, saved_at) VALUES (1, %s, now())
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, saved_at = now()
"""

HISTORY_KEEP = 30               # how many dated copies to keep
_HISTORY_EVERY = 10 * 60        # seconds between ordinary history rows
_last_history_at = 0.0
_last_history_slots: int | None = None


def _history_worth_keeping(slots: int) -> tuple[bool, str]:
    """Should this save also leave a dated copy, and why.

    Time alone is not enough. The save that matters most is the one taken
    just before the count falls off a cliff — that is what somebody will be
    reaching for — so a big drop always earns its own row, immediately.
    """
    global _last_history_at, _last_history_slots
    now = _time.time()
    prev = _last_history_slots
    if prev is not None and slots < prev * 0.8:
        return True, f"คาบลดจาก {prev} เหลือ {slots}"
    if now - _last_history_at >= _HISTORY_EVERY:
        return True, ""
    return False, ""


def _db_write(blob: bytes, slots: int | None = None) -> None:
    global _last_history_at, _last_history_slots
    keep, note = (False, "")
    if slots is not None:
        keep, note = _history_worth_keeping(slots)
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_DB_SCHEMA)
            cur.execute(_DB_HISTORY_SCHEMA)
            cur.execute(_DB_UPSERT, (blob,))
            if keep:
                cur.execute(
                    "INSERT INTO app_state_history (data, slots, note) VALUES (%s, %s, %s)",
                    (blob, slots, note or None))
                cur.execute(
                    "DELETE FROM app_state_history WHERE id NOT IN "
                    "(SELECT id FROM app_state_history ORDER BY id DESC LIMIT %s)",
                    (HISTORY_KEEP,))
        conn.commit()
    if keep:
        _last_history_at = _time.time()
    if slots is not None:
        _last_history_slots = slots


def _db_read() -> bytes | None:
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_DB_SCHEMA)
            cur.execute(_DB_HISTORY_SCHEMA)
            cur.execute("SELECT data FROM app_state WHERE id = 1")
            row = cur.fetchone()
        conn.commit()
    return bytes(row[0]) if row else None


def _db_history() -> list[dict[str, Any]]:
    """The dated copies, newest first — enough to choose one, not to load it."""
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_DB_HISTORY_SCHEMA)
            cur.execute("SELECT id, saved_at, slots, note, length(data) "
                        "FROM app_state_history ORDER BY id DESC")
            rows = cur.fetchall()
        conn.commit()
    return [{"id": r[0], "saved_at": r[1].isoformat() if r[1] else None,
             "slots": r[2], "note": r[3], "bytes": r[4]} for r in rows]


def _db_history_blob(hid: int) -> bytes | None:
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_DB_HISTORY_SCHEMA)
            cur.execute("SELECT data FROM app_state_history WHERE id = %s", (hid,))
            row = cur.fetchone()
        conn.commit()
    return bytes(row[0]) if row else None


# The newest snapshot waiting to go out, and the thread that sends it.
#
# Saving runs after every edit, and a save now means a network round trip to
# another continent. Doing that inside the request would put it between the
# teacher dragging a lesson and the lesson landing. So the snapshot is built
# and compressed in the request — where the data is guaranteed to be sitting
# still — and only the sending is handed to this thread. A burst of edits
# collapses into one write because each new snapshot replaces the one still
# queued; the whole state goes out every time, so an overtaken save loses
# nothing.
# Seconds to coalesce a burst of edits. Every bit of this window is work a
# hard stop would take with it, so it is as short as it can be while still
# turning a dragged-across-the-grid burst into one round trip.
_FLUSH_DELAY = 0.5
_pending_blob: tuple[bytes, int] | None = None   # (packed snapshot, slot count)
_pending_lock = _threading.Lock()
_pending_signal = _threading.Event()

# True when the database turned out to be holding a snapshot already. A fresh
# database is a different thing entirely: there is nothing to protect, and the
# first save is supposed to seed it.
_DB_HAD_DATA = False


def _mark_state_saved() -> None:
    """Record that what is stored is now the school's own data, not the seed."""
    global _STATE_SOURCE
    if globals().get("_STATE_SOURCE") != "snapshot":
        _STATE_SOURCE = "snapshot"


def _flush_pending(blocking: bool = False) -> None:
    """Send whatever is queued. Called by the writer thread and at shutdown."""
    global _pending_blob, _STORE_ERROR, _LAST_SAVED_AT
    with _pending_lock:
        pending, _pending_blob = _pending_blob, None
    if pending is None:
        return
    blob, slots = pending
    try:
        _db_write(blob, slots)
        _STORE_ERROR = None
        # With the offset attached, so the browser can show it in the reader's
        # own time. Bare local time reads as hours stale to anyone not sitting
        # in the server's timezone, which is everybody.
        _LAST_SAVED_AT = _dt.datetime.now().astimezone().isoformat(timespec="seconds")
        # The copy in the database is now the school's own data, whatever this
        # process happened to start from. Leaving this at "seed" told them they
        # were working on the shipped data while it was being kept properly.
        _mark_state_saved()
    except Exception as exc:                       # noqa: BLE001
        _STORE_ERROR = f"{type(exc).__name__}: {exc}"[:200]
        # Put it back so the next pass retries, unless something newer is
        # already waiting — that one is the better copy to send.
        with _pending_lock:
            if _pending_blob is None:
                _pending_blob = pending
        _save_state_to_file()                      # a local copy is still worth having
        if blocking:
            raise


def _writer_loop() -> None:
    while True:
        _pending_signal.wait()
        _pending_signal.clear()
        _time.sleep(_FLUSH_DELAY)
        try:
            _flush_pending()
        except Exception:                          # noqa: BLE001
            pass


def _save_state_to_file() -> None:
    """The original on-disk save, now the fallback rather than the plan."""
    try:
        tmp = _STATE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            _json.dump(_snapshot(), fh, ensure_ascii=False)
        _os.replace(tmp, _STATE_PATH)      # atomic: a crash mid-write cannot truncate it
    except Exception:
        pass


def _save_state() -> None:
    """Keep the data. Never let a failed save break a request.

    One refusal: a process that never managed to load the school's data is
    running on the data this code ships with, and writing that to the database
    would put the shipped data where the school's timetable was. That is not a
    save, it is the loss — the restart only hid the work, the save destroyed
    it. So while the data on this server is the seed, the stored copy is left
    alone and the save goes to the local file instead.
    """
    global _pending_blob
    if _STORE_KIND != "postgres":
        _save_state_to_file()
        return
    if _DB_HAD_DATA and globals().get("_STATE_SOURCE") not in ("snapshot", None):
        # Something is stored, and it is not what this process is holding.
        # Keep it on disk only; /api/state/info reports the refusal so the
        # school is told rather than left to find out.
        _save_state_to_file()
        return
    try:
        blob = _pack(_snapshot())           # built here, where the data is still
        with _pending_lock:
            _pending_blob = (blob, len(SLOTS))
        _pending_signal.set()
    except Exception:
        _save_state_to_file()


def _load_state() -> bool:
    """Bring the data back, preferring the copy that survives a restart.

    The read is retried. A serverless database suspends when nobody has used
    it, and the first connection after that has to wake it — which can take
    longer than one attempt allows, exactly when the school's server is also
    starting cold. Giving up on the first timeout means coming up on the
    shipped data with the real timetable sitting untouched in a database this
    process decided it could not reach.
    """
    global _STORE_KIND, _STORE_ERROR, _DB_HAD_DATA
    if _DB_URL:
        blob, last = None, None
        for attempt in range(4):
            try:
                blob = _db_read()
                last = None
                break
            except Exception as exc:               # noqa: BLE001
                last = exc
                if attempt < 3:
                    _time.sleep(2 * (attempt + 1))  # 2s, 4s, 6s — ~12s of waking
        if last is None:
            _STORE_KIND, _STORE_ERROR = "postgres", None
            _threading.Thread(target=_writer_loop, daemon=True).start()
            if blob:
                _DB_HAD_DATA = True
                _apply_snapshot(_unpack(blob))
                return True
            # Connected, but nothing stored yet — a fresh database. Anything
            # the file still holds is seeded into it by the first save.
        else:
            _STORE_ERROR = f"{type(last).__name__}: {last}"[:200]
            _STORE_KIND = "file"
    if not _os.path.exists(_STATE_PATH):
        return False
    try:
        with open(_STATE_PATH, encoding="utf-8") as fh:
            _apply_snapshot(_json.load(fh))
        return True
    except Exception:
        return False


@app.get("/api/state/history")
def state_history():
    """The dated copies the server has kept, newest first.

    Listing them is what makes them real: a backup nobody can see is a backup
    nobody reaches for.
    """
    if _STORE_KIND != "postgres":
        return {"available": False, "reason": "ยังไม่ได้ต่อฐานข้อมูล จึงไม่มีประวัติย้อนหลัง",
                "points": []}
    try:
        return {"available": True, "keep": HISTORY_KEEP, "points": _db_history()}
    except Exception as exc:                       # noqa: BLE001
        return {"available": False, "reason": f"{type(exc).__name__}: {exc}"[:200],
                "points": []}


@app.post("/api/state/history/{history_id}/restore")
def restore_history(history_id: int):
    """Go back to one of the dated copies."""
    if _STORE_KIND != "postgres":
        raise HTTPException(400, "ยังไม่ได้ต่อฐานข้อมูล จึงกู้คืนจากประวัติไม่ได้")
    try:
        blob = _db_history_blob(history_id)
    except Exception as exc:                       # noqa: BLE001
        raise HTTPException(500, f"อ่านประวัติไม่สำเร็จ: {exc}"[:200]) from exc
    if not blob:
        raise HTTPException(404, "ไม่พบสำเนานี้แล้ว")
    data = _unpack(blob)
    _apply_snapshot(data)
    global _STATE_SOURCE
    _STATE_SOURCE = "snapshot"        # the school has said this is their data
    was = data.get("revision")
    if isinstance(was, int):
        REVISION["n"] = max(REVISION["n"], was)
    _save_state()
    return {"restored": {k: len(data.get(k) or []) for k in
                         ("groups", "teachers", "subjects", "rooms",
                          "requirements", "slots", "elective_pools")},
            "saved_at": data.get("saved_at")}


@app.post("/api/state/adopt")
def adopt_current_state():
    """Keep what this server is holding, even though it is not what was stored.

    Only reached from the warning that says the server came back without the
    school's data. Saying yes there has to actually mean yes, or the refusal
    that protects them becomes a wall they cannot get past.
    """
    global _STATE_SOURCE
    _STATE_SOURCE = "snapshot"
    _save_state()
    return {"ok": True, "slots": len(SLOTS)}


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
    global _STATE_SOURCE
    _STATE_SOURCE = "snapshot"      # restoring is the school naming their data
    # Put the counter past whatever the backup was taken at, so every browser
    # still holding a higher number sees this restore as newer and pulls it.
    # The middleware adds one more on the way out of this request.
    was = body.get("revision")
    if isinstance(was, int):
        REVISION["n"] = max(REVISION["n"], was)
    _save_state()
    return {
        "restored": {k: len(body.get(k) or []) for k in
                     ("groups", "teachers", "subjects", "rooms", "requirements",
                      "slots", "elective_pools")},
        "saved_at": body.get("saved_at"),
    }


# ── หลักสูตร ──────────────────────────────────────────────────────────────────
# Which subjects each class may take, and how many periods a week. Kept apart
# from the staffing sheet on purpose: the sheet says what IS assigned, this says
# what SHOULD be, and the difference between the two is the thing worth seeing.
# This section is the reference itself: creating, editing and deleting it, the
# three ways of making one without typing it (copy, from a class, and derived
# from every class's teaching plan at once), putting classes on it, and the
# diff of one class against it. It never changes a teaching plan.

_CUR.bind(
    curricula=lambda: CURRICULA,
    groups_by_id=lambda: {g["id"]: g for g in _flat_groups()},
    subjects_by_id=lambda: {s["id"]: s for s in SUBJECTS},
    requirements=lambda: REQUIREMENTS,
    fold_coteaching=_fold_coteaching,
    served_by_elective=_reqs_served_by_elective,
    slots=lambda: SLOTS,
    next_requirement_id=lambda: _next("requirement"),
)


def _find_curriculum(cid: int) -> dict[str, Any]:
    cur = next((c for c in CURRICULA if c["id"] == cid), None)
    if not cur:
        raise HTTPException(404, "ไม่พบหลักสูตรนี้")
    return cur


def _add_curriculum(name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Store a new curriculum and hand it back. The one place its shape is written.

    Stored is `id`, `name` and `rows`, and nothing else: which classes use it is
    worked out from the classes (see _curriculum_view), never kept here. `rows`
    must already have been through normalise_rows; this does not check them."""
    cur = {"id": _next("curriculum"), "name": name, "rows": rows}
    CURRICULA.append(cur)
    return cur


def _curriculum_view(cur: dict[str, Any], attached: dict[int, list[dict]]) -> dict[str, Any]:
    """A curriculum as the screen reads it: what is stored, plus who uses it.

    `groups` and `group_names` are worked out here from the classes that exist
    and are never written back into CURRICULA — a stored list of class ids is
    one more thing that goes stale the moment a class is deleted."""
    using = attached.get(cur["id"], [])
    return {**cur,
            "rows": [dict(r) for r in cur.get("rows") or []],
            "groups": [g["id"] for g in using],
            "group_names": [g.get("name") for g in using]}


def _clean_rows(raw: Any) -> list[dict[str, Any]]:
    """normalise_rows, with its Thai ValueError turned into a 400."""
    try:
        return _CUR.normalise_rows(raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/curricula")
def get_curricula():
    attached = _CUR.groups_by_curriculum()
    return [_curriculum_view(c, attached) for c in CURRICULA]


# Static paths first. /api/curricula/derive is registered above every {cid:int}
# route as well as being safe from them, so a parameter route added later
# cannot end up answering for it by position alone.

def _derive_proposals() -> list[dict[str, Any]]:
    """derive_all, with a damaged teaching plan turned into a 400 naming the class."""
    try:
        return _CUR.derive_all()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/curricula/derive")
def derive_curricula():
    """The curricula the classes' existing teaching plans imply. Writes nothing."""
    return {"proposals": _derive_proposals()}


@app.post("/api/curricula/derive")
def apply_derived_curricula(body: dict[str, Any] | None = None):
    """Create every proposed curriculum and attach its classes to it.

    `body` is accepted and not read: there is nothing to choose, the proposals
    are exactly what the GET shows. All of them are worked out before the first
    one is written, so a plan that cannot be read stops the whole thing instead
    of leaving half the school attached. Attaching is setting `curriculum_id` on
    the class and nothing else. When there is nothing left to propose the call
    changes nothing, and says so (_nothing_changed), so it does not bump the
    revision or save."""
    proposals = _derive_proposals()
    live = {g["id"]: g for g in _flat_groups()}
    made, attached = [], 0
    for p in proposals:
        cur = _add_curriculum(p["name"], [dict(r) for r in p["rows"]])
        made.append(cur)
        for gid in p["group_ids"]:
            live[gid]["curriculum_id"] = cur["id"]
            attached += 1
    if not made:
        # Nothing was proposed, so nothing was written: not a change.
        _nothing_changed()
    using = _CUR.groups_by_curriculum()
    return {"created": len(made), "attached": attached,
            "curricula": [_curriculum_view(c, using) for c in made]}


@app.get("/api/curricula/diff/{gid:int}")
def curriculum_diff(gid: int):
    """One class's curriculum set against its teaching plan. Writes nothing.

    Under /diff/ rather than /{gid}/diff so it sits in this static block and can
    never be answered for by a {cid:int} route; the whole-school /audit goes in
    this block too."""
    if _find_group(gid) is None:
        raise HTTPException(404, "ไม่พบห้องเรียนนี้")
    try:
        return _CUR.diff(gid)
    except ValueError as exc:                # a plan row that cannot be read
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/curricula/apply/{gid:int}")
def curriculum_apply(gid: int, body: dict[str, Any]):
    """Do what was ticked on one class's diff: `{"add": [...], "fix": [...], "remove": [...]}`.

    Lists of subject ids; only a subject the diff currently puts in that bucket
    is acted on. Answers `{"added", "fixed", "removed", "slots_left", "warn"}`:
    `warn` lists the "fix"es that were refused and why, `slots_left` the placed
    lessons of removed subjects that no plan row backs any more. The timetable
    is never written. Under /apply/ for the same reason as /diff/: static, and
    above the {cid:int} routes. A request that ends up changing nothing says
    so, so it does not bump the revision or save."""
    if _find_group(gid) is None:
        raise HTTPException(404, "ไม่พบห้องเรียนนี้")
    try:
        done = _CUR.apply(gid, body.get("add"), body.get("fix"), body.get("remove"))
    except ValueError as exc:                # a list or plan row that cannot be read
        raise HTTPException(400, str(exc)) from exc
    if not (done["added"] or done["fixed"] or done["removed"]):
        _nothing_changed()
    return done


@app.get("/api/curricula/audit")
def curriculum_audit():
    """Every class set against its curriculum, in one table. Writes nothing.

    A class that cannot be read is listed with an `error` instead of failing the
    whole table (see curriculum.audit), so this has no 400 of its own."""
    return _CUR.audit()


# {cid:int}, not {cid}: a bare {cid} also matches "derive" and "audit", and a
# route registered above them would answer for them.
@app.get("/api/curricula/{cid:int}")
def get_curriculum(cid: int):
    return _curriculum_view(_find_curriculum(cid), _CUR.groups_by_curriculum())


@app.post("/api/curricula")
def create_curriculum(body: dict[str, Any]):
    # Rows are checked before an id is taken, so a rejected request leaves
    # nothing behind — not even a used-up number.
    rows = _clean_rows(body["rows"]) if "rows" in body else []
    cur = _add_curriculum(str(body.get("name") or "").strip() or "หลักสูตรใหม่", rows)
    return _curriculum_view(cur, _CUR.groups_by_curriculum())


@app.put("/api/curricula/{cid:int}")
def update_curriculum(cid: int, body: dict[str, Any]):
    """Rename it, replace its rows, or both. Only what is sent is changed.

    `rows` left out keeps the stored rows; `rows: []` empties them. Everything
    is checked before anything is written, so a request that is refused for its
    rows does not leave the new name behind."""
    cur = _find_curriculum(cid)
    name = None
    if "name" in body:
        name = str(body["name"] or "").strip()
        if not name:
            raise HTTPException(400, "ชื่อหลักสูตรต้องไม่ว่าง")
    rows = _clean_rows(body["rows"]) if "rows" in body else None
    if name is not None:
        cur["name"] = name
    if rows is not None:
        cur["rows"] = rows
    return _curriculum_view(cur, _CUR.groups_by_curriculum())


@app.delete("/api/curricula/{cid:int}")
def delete_curriculum(cid: int):
    cur = _find_curriculum(cid)
    using = _CUR.groups_by_curriculum().get(cid, [])
    if using:
        # A class left pointing at a curriculum that is gone would quietly stop
        # being checked, so the delete is refused and says who is in the way.
        names = ", ".join(str(g.get("name")) for g in using[:3])
        more = f" และอีก {len(using) - 3} ห้อง" if len(using) > 3 else ""
        raise HTTPException(
            400, f"ลบหลักสูตร “{cur['name']}” ไม่ได้ เพราะยังมีห้องใช้อยู่: {names}{more} "
                 f"— ปลดหลักสูตรออกจากห้องเหล่านี้ก่อน")
    CURRICULA.remove(cur)
    return {"removed": 1}


# Making one without typing it. Neither attaches a class: the new curriculum
# starts with no classes, and putting one on is a separate, deliberate step.

@app.post("/api/curricula/{cid:int}/copy")
def copy_curriculum(cid: int):
    src = _find_curriculum(cid)
    # Through normalise_rows like every other path that writes a row, so the two
    # keys are enforced rather than carried over: a restored or hand-edited
    # source row holding `duration` or `credits` must not copy straight across.
    # It also gives the copy its own row dicts, and runs before an id is taken.
    rows = _clean_rows(src.get("rows") or [])
    cur = _add_curriculum(f"{src['name']} (สำเนา)", rows)
    return _curriculum_view(cur, _CUR.groups_by_curriculum())


@app.post("/api/curricula/from-group/{gid:int}")
def curriculum_from_group(gid: int):
    """A curriculum holding what this class is taught now."""
    group = _find_group(gid)
    if not group:
        raise HTTPException(404, "ไม่พบห้องเรียนนี้")
    try:
        rows = _CUR.rows_from_group(gid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not rows:
        # An empty curriculum would be a class allowed nothing; say so instead.
        raise HTTPException(400, f"ห้อง {group.get('name')} ยังไม่มีวิชาในแผนการสอน "
                                 f"จึงสร้างหลักสูตรจากห้องนี้ไม่ได้")
    cur = _add_curriculum(f"หลักสูตรจาก {group.get('name')}", rows)
    return _curriculum_view(cur, _CUR.groups_by_curriculum())


# Putting classes on a curriculum. Only each class's own curriculum_id is
# written; no teaching-plan row is read, added, changed or removed here.

@app.put("/api/curricula/{cid:int}/groups")
def set_curriculum_groups(cid: int, body: dict[str, Any]):
    """Attach exactly the classes in `group_ids`; let go of the rest.

    The list is the whole answer: a class that follows this curriculum and is
    not in the list is detached. Classes of other curricula are not touched
    unless named, in which case they move here. Answers with the curriculum
    as the screen reads it, plus `attached` and `detached` (the class ids that
    changed). A request that changes nothing says so, so it does not bump the
    revision or save."""
    cur = _find_curriculum(cid)
    try:
        changed = _CUR.attach(cid, body.get("group_ids"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not changed["attached"] and not changed["detached"]:
        _nothing_changed()
    return {**_curriculum_view(cur, _CUR.groups_by_curriculum()), **changed}


# ── คาบเรียนลาน และลำดับลาน ────────────────────────────────────────────────────
# The school is short of indoor rooms, and has two ways of stretching them that
# only a person can decide, both about the ลาน (a room whose type is "outdoor"):
#
#   คาบเรียนลาน  this class's this hour is taught on that ลาน. The indoor room the
#                class would have sat in is free for a lesson that would
#                otherwise have nowhere to go.
#   ลำดับลาน    which ลาน the solver reaches for first when it sends a class
#                outside on its own.
#
# A pick is an instruction, not a permission. allow_outdoor (on the lesson, the
# class or the subject) decides what the solver may do by itself; it has
# nothing to say about what a person has told it to do, so a pick bypasses
# _may_use_outdoor altogether — which is itself left exactly as it was.
#
# A pick is set BEFORE the timetable is built, and the solver honours it every
# time: whatever lesson lands in that cell takes the ลาน, and the ลาน is held
# for that class at that hour whether a lesson has landed there yet or not.
# That second half is the point. A pick on an empty cell is how the school says
# "this hour has a room", so a lesson with none can be put there.
#
# A ลาน is still a room: two classes cannot hold it in the same hour. Two picks
# on one ลาน and hour are not an error to refuse (the school may be mid-edit);
# the EARLIER pick keeps it and the later one's lesson is left without a room,
# which the unplaced report already shows like any other lesson with no room.

def _as_int(v: Any) -> int | None:
    """An integer from what a request carried, or None. A bool is not a number
    here: `True` would otherwise read as room 1."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and v.strip().lstrip("-").isdigit():
        return int(v.strip())
    return None


def _outdoor_rooms() -> list[dict[str, Any]]:
    return [r for r in ROOMS if r.get("type") == "outdoor"]


def _yard_order() -> list[int]:
    """The saved ลำดับลาน, most-preferred first; [] when none is saved.

    Ids that no longer name an outdoor room (the room was deleted, or retyped)
    are left out rather than trusted, so the order can never point the solver
    at a room that is not a ลาน."""
    saved = SCHOOL_CONFIG.get("yard_order") if isinstance(SCHOOL_CONFIG, dict) else None
    if not isinstance(saved, list):
        return []
    yards = {r["id"] for r in _outdoor_rooms()}
    out: list[int] = []
    for x in saved:
        if isinstance(x, int) and not isinstance(x, bool) and x in yards and x not in out:
            out.append(x)
    return out


def _yard_position(order: list[int]) -> dict[int, int]:
    return {rid: i for i, rid in enumerate(order)}


def _yards_in_order() -> list[dict[str, Any]]:
    """Every ลาน: the ones in the saved order first, then the rest the way the
    solver ranks them when there is no order (roomiest first, then by id)."""
    pos = _yard_position(_yard_order())
    return sorted(_outdoor_rooms(), key=lambda r: (
        pos.get(r["id"], len(pos)), -int(r.get("capacity") or 0), r["id"]))


def _yard_pick_for(group_id: int | None, day: int | None, period: int | None) -> int | None:
    """The ลาน the school has picked for this class at this hour, or None.

    A pick whose room is gone, or is no longer outdoors, counts as no pick."""
    for row in YARD_PICKS:
        if (row.get("group_id") == group_id and row.get("day") == day
                and row.get("period") == period):
            room = next((r for r in ROOMS if r["id"] == row.get("room_id")), None)
            return room["id"] if room and room.get("type") == "outdoor" else None
    return None


def _yard_pick_index() -> tuple[dict[tuple, int], dict[tuple, int]]:
    """The picks that can be honoured, and who holds each ลาน at each hour.

    Returns (pick_at, owner). pick_at maps (class, day, period) to the ลาน.
    owner maps (ลาน, day, 5-minute bucket) to the class whose pick holds it —
    keyed by the clock, like every other room booking, because ม.ต้น and
    ม.ปลาย sit the same period number at different times. Where two picks
    overlap, the one made first (the lower id) is the owner, so the result
    does not depend on which lesson the solver happens to place first."""
    g_map = {g["id"]: g for g in _flat_groups()}
    r_map = {r["id"]: r for r in ROOMS}
    pick_at: dict[tuple, int] = {}
    owner: dict[tuple, int] = {}
    for row in sorted(YARD_PICKS, key=lambda r: r.get("id", 0)):
        gid, day, period, rid = (row.get(k) for k in ("group_id", "day", "period", "room_id"))
        grp, room = g_map.get(gid), r_map.get(rid)
        if grp is None or room is None or room.get("type") != "outdoor":
            continue
        if period not in _class_periods_for_level(_level_key(grp)):
            continue            # the period was taken off the timetable since
        if (gid, day, period) in pick_at:
            continue            # one row per cell; if a restore left two, the first stands
        pick_at[(gid, day, period)] = rid
        for b in _slot_buckets(grp, period):
            owner.setdefault((rid, day, b), gid)
    return pick_at, owner


def _yard_lost(owner: dict[tuple, int], shares, gid: int, rid: int, day: int,
               buckets: frozenset[int]) -> bool:
    """Is this ลาน, at this hour, held by another class's earlier pick?

    A class and its subgroups hold the same students, so they can never both
    be in the room and do not count as another class."""
    for b in buckets:
        o = owner.get((rid, day, b))
        if o is not None and not shares(o, gid):
            return True
    return False


def _yard_held_by_other(s: dict[str, Any], rid: int) -> bool:
    """Is some other lesson already in this room at any minute of this one?"""
    g_map = {g["id"]: g for g in _flat_groups()}
    mine = _slot_buckets(g_map.get(s.get("group_id")), s.get("period"))
    for x in SLOTS:
        if x is s or x.get("room_id") != rid or x.get("day") != s.get("day"):
            continue
        if mine & _slot_buckets(g_map.get(x.get("group_id")), x.get("period")):
            return True
    return False


def _yard_blocked(s: dict[str, Any], rid: int) -> bool:
    """Can this lesson not have this ลาน at its hour — somebody is in it, or an
    earlier pick of another class holds it?"""
    _, owner = _yard_pick_index()
    return (_yard_held_by_other(s, rid)
            or _yard_lost(owner, _shares_students_fn(), s.get("group_id"), rid, s["day"],
                          _slot_buckets(_find_group(s.get("group_id")), s["period"])))


def _settle_yard(s: dict[str, Any], was: tuple[int, int] | None = None,
                 room_given: bool = False) -> dict[str, Any]:
    """After a lesson has been put down by hand, give it or take from it the ลาน.

    A lesson that comes to rest on a picked cell takes that ลาน; one that has
    just left a picked cell gives it up (it is left without a room, for the
    school to choose one — the solver's room search is not available here).
    `was` is the (day, period) the lesson came from, None for a new lesson;
    `room_given` says the edit named a room itself, which is honoured when the
    lesson has left a pick but never over a pick on the cell it lands in.

    If the ลาน is already in use at that hour (another lesson sits in it, or an
    earlier pick of another class holds it) the lesson is left without a room
    rather than double-booked, and nobody else's room is taken away."""
    if s.get("is_elective") or s.get("is_activity_block"):
        return s
    gid = s.get("group_id")
    want = _yard_pick_for(gid, s.get("day"), s.get("period"))
    changed = False
    if want is not None:
        if s.get("room_id") != want:
            s["room_id"] = None if _yard_blocked(s, want) else want
            changed = True
        # One lesson, one room: the other half of a คาบคู่ goes where this half
        # went — unless it has a pick of its own, which then speaks for it.
        key = s.get("double_group_key")
        if key and s.get("room_id") == want:
            for t in SLOTS:
                if (t is not s and t.get("double_group_key") == key and t.get("group_id") == gid
                        and t.get("room_id") != want
                        and _yard_pick_for(gid, t.get("day"), t.get("period")) is None
                        and not _yard_blocked(t, want)):
                    t["room_id"] = want
                    _enrich_slot(t)
    elif was is not None and not room_given:
        old = _yard_pick_for(gid, was[0], was[1])
        if old is not None and s.get("room_id") == old:
            s["room_id"] = None
            changed = True
    if changed:
        _enrich_slot(s)
    return s


def _drop_yard_picks(*, room_id: int | None = None, group_ids=()) -> int:
    """Forget the picks that point at a room or a class that has been deleted,
    and take the room out of the ลำดับลาน. Returns how many picks went."""
    doomed = set(group_ids)
    keep = [r for r in YARD_PICKS
            if not ((room_id is not None and r.get("room_id") == room_id)
                    or r.get("group_id") in doomed)]
    gone = len(YARD_PICKS) - len(keep)
    YARD_PICKS[:] = keep
    saved = SCHOOL_CONFIG.get("yard_order") if isinstance(SCHOOL_CONFIG, dict) else None
    if room_id is not None and isinstance(saved, list):
        SCHOOL_CONFIG["yard_order"] = [x for x in saved if x != room_id]
    return gone


def _check_pick_cell(gid: int, day: int, period: int) -> dict[str, Any]:
    """The class, if (class, day, period) is a place a lesson can be taught."""
    grp = _find_group(gid)
    if grp is None:
        raise HTTPException(400, "ไม่พบห้องเรียนที่เลือก (อาจถูกลบไปแล้ว)")
    if not (0 <= day <= 4):
        raise HTTPException(400, f"วันที่ {day} ไม่ถูกต้อง")
    lvl = _level_key(grp)
    if period not in _class_periods_for_level(lvl):
        row = _periods_for_level(lvl).get(period)
        label = row["label"] if row else f"คาบ {period}"
        who = "ม.1-3" if lvl == "lower" else "ม.4-6"
        raise HTTPException(400, f"{label} ไม่ใช่คาบเรียนของ {who} จึงกำหนดคาบเรียนลานไม่ได้")
    return grp


def _yard_view(with_picks: bool = False) -> list[dict[str, Any]]:
    count: Counter = Counter(r.get("room_id") for r in YARD_PICKS)
    out = []
    for r in _yards_in_order():
        row = {"id": r["id"], "name": r.get("name"), "capacity": r.get("capacity")}
        if with_picks:
            row["picks"] = count.get(r["id"], 0)
        out.append(row)
    return out


@app.get("/api/yard-picks")
def get_yard_picks():
    return {"rows": [dict(r) for r in YARD_PICKS], "yards": _yard_view()}


@app.put("/api/yard-picks")
def put_yard_pick(body: dict[str, Any]):
    """Set the ลาน for one class's one hour, or take it away with room_id null."""
    if not isinstance(body, dict):
        raise HTTPException(400, "ข้อมูลที่ส่งมาไม่ถูกต้อง")
    gid, day, period = (_as_int(body.get(k)) for k in ("group_id", "day", "period"))
    if gid is None or day is None or period is None:
        raise HTTPException(400, "ต้องระบุห้องเรียน วัน และคาบ")

    def same_cell(r: dict[str, Any]) -> bool:
        return r.get("group_id") == gid and r.get("day") == day and r.get("period") == period

    mine = next((r for r in YARD_PICKS if same_cell(r)), None)

    # Taking a pick away is asked for by saying room_id is null — not by leaving
    # it out, which is far more likely to be a caller's mistake than a decision.
    if "room_id" not in body:
        raise HTTPException(400, "ต้องระบุลาน (หรือส่ง room_id เป็น null เพื่อถอนคาบเรียนลาน)")
    if body["room_id"] is None:
        if mine is None:
            # Nothing to take away. Input that could never have been a pick is
            # still refused; a stale row (its period since removed) never gets
            # here, because it matched above and can always be removed.
            _check_pick_cell(gid, day, period)
            _nothing_changed()
        YARD_PICKS[:] = [r for r in YARD_PICKS if not same_cell(r)]
        return {"removed": True}

    rid = _as_int(body.get("room_id"))
    room = next((r for r in ROOMS if r["id"] == rid), None) if rid is not None else None
    if room is None:
        raise HTTPException(400, "ไม่พบลานที่เลือก (อาจถูกลบไปแล้ว)")
    if room.get("type") != "outdoor":
        raise HTTPException(400, f"ห้อง {room.get('name')} ไม่ใช่ลาน — "
                                 "คาบเรียนลานเลือกได้เฉพาะห้องประเภทกลางแจ้ง")
    _check_pick_cell(gid, day, period)

    if mine is None:
        mine = {"id": _next("yard_pick"), "group_id": gid, "day": day,
                "period": period, "room_id": room["id"]}
        YARD_PICKS.append(mine)
    elif mine.get("room_id") == room["id"]:
        _nothing_changed()
    else:
        mine["room_id"] = room["id"]
    return dict(mine)


def _yard_order_view() -> dict[str, Any]:
    return {"order": _yard_order(), "yards": _yard_view(with_picks=True)}


@app.get("/api/yard-order")
def get_yard_order():
    return _yard_order_view()


@app.put("/api/yard-order")
def put_yard_order(body: dict[str, Any]):
    """Save the ลำดับลาน. All of it is checked before any of it is kept."""
    raw = body.get("order") if isinstance(body, dict) else None
    if not isinstance(raw, list):
        raise HTTPException(400, "ต้องส่งลำดับลานเป็นรายการรหัสห้อง")
    r_map = {r["id"]: r for r in ROOMS}
    order: list[int] = []
    for x in raw:
        rid = _as_int(x)
        room = r_map.get(rid) if rid is not None else None
        if room is None:
            raise HTTPException(400, f"ไม่พบห้องรหัส {x} ในระบบ")
        if room.get("type") != "outdoor":
            raise HTTPException(400, f"ห้อง {room.get('name')} ไม่ใช่ลาน — "
                                     "ลำดับลานเรียงได้เฉพาะห้องประเภทกลางแจ้ง")
        if rid not in order:
            order.append(rid)        # a ลาน listed twice is listed once, where it first stood
    if order == list(SCHOOL_CONFIG.get("yard_order") or []):
        _nothing_changed()
    SCHOOL_CONFIG["yard_order"] = order
    return _yard_order_view()


# ── ควรเลือกลานไหนให้คาบที่ไม่มีห้อง ─────────────────────────────────────────
# A lesson with no room can be helped by คาบเรียนลาน in two ways, and only one of
# them is certain. The certain one: a ลาน nobody is using at that hour — pick it
# for this very cell. The other goes through a second class: if a class that sits
# in an indoor room that same hour went to a ลาน, its room would fall free, and
# if that room is one this lesson may legally sit in, the lesson has somewhere to
# go. Measured on the school's own data, picks aimed blind at one ลาน made things
# worse (one ลาน holds one class an hour), while picks spread over free ลาน
# rescued almost every lesson — so the school is told WHICH picks help.
#
# Read-only: nothing here changes a table. A suggestion is applied by the school
# through PUT /api/yard-picks, and takes effect when the timetable is next made.

_YARD_RESCUE_MAX_DONORS = 8


def _lesson_slots(s: dict[str, Any]) -> list[dict[str, Any]]:
    """The slots that make up one lesson: itself, and the other half of a คาบคู่.

    A pair shares one room across both periods, so a ลาน (or a room) that is
    free for one half and busy for the other is no use to it."""
    key = s.get("double_group_key")
    if not key:
        return [s]
    return [s] + [t for t in SLOTS if t is not s and t.get("double_group_key") == key
                  and t.get("group_id") == s.get("group_id")]


def _room_test_for_lesson(slot: dict[str, Any]) -> Callable[[dict[str, Any]], bool]:
    """A test: would the solver seat this lesson in this room, were it empty?

    Asked the way find_room asks it, from the same rules — _room_suits for the
    ordinary run of checks — plus the three things find_room decides before
    or around them: a room the school wrote down for this lesson (nothing else
    will do), a ห้องประจำวิชา of the subject (taken first, ahead of the checks),
    and "ต้องเรียนที่ห้องประจำวิชา" (only the subject's own facilities).
    The room is always one a class sits in indoors, so ลาน never decide it."""
    tid, sid, gid = slot.get("teacher_id"), slot.get("subject_id"), slot["group_id"]
    teacher = next((t for t in TEACHERS if t["id"] == tid), {})
    subj = next((x for x in SUBJECTS if x["id"] == sid), {}) if sid is not None else {}
    grp = _find_group(gid) or {}
    want_dept = _lesson_want_dept(subj, teacher)
    family = _group_family(gid, grp)
    buildings = _subject_buildings(subj)
    subj_rooms = _subject_rooms(subj)
    must_be_facility = _subject_room_rule(subj) == "subject" and bool(subj_rooms or want_dept)
    may_out = _may_use_outdoor(subj, None, grp or None)
    # The requirement this lesson came from, the one for this teacher first.
    reqs = [r for r in REQUIREMENTS if r.get("group_id") == gid and r.get("subject_id") == sid]
    mine = next((r for r in reqs if r.get("teacher_id") == tid), None) or next(iter(reqs), None)
    pinned = (mine or {}).get("room_id")

    def accepts(room: dict[str, Any]) -> bool:
        if pinned:
            return room["id"] == pinned
        if room["id"] in subj_rooms:
            return _room_in_buildings(room, buildings)
        if must_be_facility and not _is_subjects_own_room(room, subj_rooms, want_dept):
            return False
        return _room_suits(room, teacher_id=tid, group_id=gid, family=family,
                           want_dept=want_dept, want_buildings=buildings, may_outdoor=may_out)

    return accepts


def _yard_rescue(group_id: int, day: int, period: int) -> dict[str, Any]:
    """Which yard picks would give this class's lesson, at this hour, a room.

    `direct` are ลาน free for the lesson's own cell, in the school's ลำดับลาน;
    `rank` is each one's 1-based position in that whole order (so it can be
    higher than its place in this list when ลาน above it are taken).
    `donors` are other classes that could go out to a ลาน this hour and free
    an indoor room this lesson may take. `lesson.teacher_clash` names the
    other class that has the lesson's teacher busy this hour (null when the
    teacher is free): a ลาน gives the lesson a room but not a clear frame
    while that stands. The clash is reported there and nowhere else — never
    in `note`, so the field and the prose cannot drift apart. `note` says only
    why there is nothing to offer, and is "" when there is something."""
    s_map = {x["id"]: x for x in SUBJECTS}
    t_map = {t["id"]: t for t in TEACHERS}
    r_map = {r["id"]: r for r in ROOMS}

    def answer(lesson: dict[str, Any] | None, direct=(), donors=(), note: str = ""):
        return {"lesson": lesson or {"subject": "", "teacher": "", "room_name": None,
                                     "found": False, "teacher_clash": None},
                "direct": list(direct), "donors": list(donors), "note": note}

    def subject_of(s: dict[str, Any]) -> str:
        if s.get("is_elective"):
            return "คาบเสรี"
        return ((s_map.get(s.get("subject_id")) or {}).get("name")
                or s.get("activity_name") or "")

    def describe(s: dict[str, Any], found: bool) -> dict[str, Any]:
        room = r_map.get(s.get("room_id")) if s.get("room_id") else None
        return {"subject": subject_of(s),
                "teacher": (t_map.get(s.get("teacher_id")) or {}).get("name") or "",
                "room_name": room["name"] if room else None, "found": found,
                "teacher_clash": None}

    grp = _find_group(group_id)
    if grp is None:
        return answer(None, note="ไม่พบห้องเรียนนี้ในระบบ (อาจถูกลบไปแล้ว)")
    here = [s for s in SLOTS if s.get("group_id") == group_id
            and s.get("day") == day and s.get("period") == period]
    if not here:
        return answer(None, note="ช่องนี้ไม่มีคาบเรียน จึงไม่มีอะไรต้องช่วย")
    stuck = next((s for s in here if not s.get("room_id")), None)
    if stuck is None:
        shown = describe(here[0], False)
        return answer(shown, note=f"คาบนี้มีห้องแล้ว ({shown['room_name']}) ไม่ต้องหาลานช่วย")
    lesson = describe(stuck, True)
    if stuck.get("is_elective") or stuck.get("is_activity_block"):
        return answer(lesson, note="คาบเสรีและคาบกิจกรรมไม่ได้จัดห้องแบบคาบทั่วไป "
                                   "การเลือกลานจึงช่วยไม่ได้")
    # The same question the red frame asks (see _teacher_clash_with).
    clash = _teacher_clash_with(stuck)
    if clash is not None:
        who, other = clash
        lesson["teacher_clash"] = {
            "teacher": (t_map.get(who) or {}).get("name") or "",
            "with_group": (_find_group(other.get("group_id")) or {}).get("name") or "",
            "with_subject": subject_of(other)}

    # The school's ลาน, most-preferred first; a ลาน marked ห้ามใช้ is not on offer.
    order = _yards_in_order()
    position = {y["id"]: i + 1 for i, y in enumerate(order)}
    yards = [y for y in order if _room_usable(y)]
    if not yards:
        return answer(lesson, note="โรงเรียนยังไม่มีลานที่ใช้ได้ จึงไม่มีลานให้เลือก")

    mine = _lesson_slots(stuck)
    own_pick = _yard_pick_for(group_id, day, period)

    def free_for(lesson_slots: list[dict[str, Any]], rid: int) -> bool:
        return not any(_yard_blocked(t, rid) for t in lesson_slots)

    free_yards = [y for y in yards if free_for(mine, y["id"])]
    # A ลาน this cell already has picked is not news: it takes effect when the
    # timetable is next made, and picking it again would change nothing.
    direct = [{"room_id": y["id"], "room_name": y["name"], "rank": position[y["id"]]}
              for y in free_yards if y["id"] != own_pick]

    donors: list[dict[str, Any]] = []
    # A cell with a pick holds its lesson on that ลาน whatever room is freed,
    # so a room freed for it would not be taken.
    if own_pick is None:
        donors = _yard_rescue_donors(stuck, mine, yards, day, period)

    note = ""
    if not direct and not donors:
        if own_pick is not None and any(y["id"] == own_pick for y in free_yards):
            note = (f"ช่องนี้เลือก {r_map[own_pick]['name']} ไว้แล้ว "
                    f"และลานนั้นว่างอยู่ — จัดตารางใหม่เพื่อให้คาบนี้ได้ลานนั้น")
        else:
            note = ("ทุกลานมีคนใช้อยู่ในชั่วโมงนี้แล้ว "
                    "จึงยังหาลานให้คาบนี้ไม่ได้")
    return answer(lesson, direct, donors, note)


def _yard_rescue_donors(stuck: dict[str, Any], mine: list[dict[str, Any]],
                        yards: list[dict[str, Any]], day: int, period: int
                        ) -> list[dict[str, Any]]:
    """Other classes that could go out to a ลาน this hour and free a room the
    stuck lesson may take, the most plausible first, each with a ลาน of its own."""
    g_map = {g["id"]: g for g in _flat_groups()}
    s_map = {x["id"]: x for x in SUBJECTS}
    r_map = {r["id"]: r for r in ROOMS}
    shares = _shares_students_fn()
    accepts = _room_test_for_lesson(stuck)
    gid = stuck["group_id"]
    my_group = g_map.get(gid) or {}
    t_map = {t["id"]: t for t in TEACHERS}
    teacher = t_map.get(stuck.get("teacher_id")) or {}
    subj = s_map.get(stuck.get("subject_id")) or {}
    subj_rooms = _subject_rooms(subj)
    ground_only = _teacher_prefs(teacher).get("ground_floor")

    def buckets(s: dict[str, Any]) -> frozenset[int]:
        return _slot_buckets(g_map.get(s["group_id"]), s["period"])

    # Who is in each room at each minute, so "free once the donor has left" is
    # a lookup, not a scan of the week for every candidate.
    inside: dict[tuple, set[int]] = defaultdict(set)
    for s in SLOTS:
        if s.get("room_id"):
            for b in buckets(s):
                inside[(s["room_id"], s["day"], b)].add(id(s))

    def pending(t: dict[str, Any]) -> bool:
        picked = _yard_pick_for(t["group_id"], t["day"], t["period"])
        return picked is not None and not _yard_blocked(t, picked)

    candidates = []
    for x in SLOTS:
        if x is stuck or x.get("day") != day or x.get("period") != period:
            continue
        # Only an ordinary lesson sitting in a room can be sent out: a lesson
        # the school locked is not moved by a pick, and an elective window or
        # an activity block is not seated by the room search at all.
        if x.get("is_locked") or x.get("is_elective") or x.get("is_activity_block"):
            continue
        if shares(x["group_id"], gid):
            continue
        # A lesson with no room, or in a room that has since been deleted, frees
        # nothing; one already on a ลาน has no indoor room to give up.
        room = r_map.get(x.get("room_id"))
        if room is None or room.get("type") == "outdoor" or not accepts(room):
            continue
        pair = _lesson_slots(x)
        # A class whose hour already has a pick that holds is on its way out:
        # its room is freed when the timetable is next made, and asking it to
        # go again would change nothing. (A pick that cannot hold — the ลาน is
        # taken — does not count: that class may be sent somewhere else.)
        if any(pending(t) for t in pair):
            continue
        # The room must be empty for the stuck lesson at every minute it needs
        # it once the donor's whole lesson is gone — not merely emptied here.
        leaving = {id(t) for t in pair}
        if any(inside[(room["id"], c["day"], b)] - leaving
               for c in mine for b in buckets(c)):
            continue
        candidates.append((x, room, pair))

    def plausibility(c) -> tuple:
        x, room, _pair = c
        grp_x = g_map.get(x["group_id"]) or {}
        sub_x = s_map.get(x.get("subject_id")) or {}
        # Has the school said this class or subject may go outdoors? A pick
        # beats the flags, but a class told "never" is the last to ask.
        said = next((v for v in (grp_x.get("allow_outdoor"), sub_x.get("allow_outdoor"))
                     if isinstance(v, bool)), None)
        # A lesson that belongs in its room (a lab, a ห้องประจำวิชา) is a poor
        # one to move.
        tied = (room.get("type") == "special" or bool(room.get("specialized_dept_id"))
                or room["id"] in _subject_rooms(sub_x)
                or _subject_room_rule(sub_x) == "subject")
        # How well the freed room suits the stuck lesson: its own class's room
        # or its subject's ห้องประจำวิชา is best; a room too small, or upstairs
        # for a teacher who cannot manage stairs, is worse. (Rankings only —
        # the solver refuses none of them.)
        fits = room["id"] == my_group.get("homeroom_room_id") or room["id"] in subj_rooms
        small = (room.get("capacity", 40) or 0) < (my_group.get("size") or 40)
        try:
            stairs = bool(ground_only) and int(room.get("floor") or 1) > 1
        except (TypeError, ValueError):
            stairs = False
        return ((0 if said is True else 2 if said is False else 1), int(tied),
                0 if fits else 1, int(small), int(stairs), x["group_id"], x["id"])

    donors: list[dict[str, Any]] = []
    taken: set[int] = set()
    for x, room, pair in sorted(candidates, key=plausibility):
        if len(donors) >= _YARD_RESCUE_MAX_DONORS:
            break
        # The school's most-preferred ลาน this class can have that no donor
        # above it has been given: two classes cannot share one ลาน an hour.
        yard = next((y for y in yards if y["id"] not in taken
                     and not any(_yard_blocked(t, y["id"]) for t in pair)), None)
        if yard is None:
            continue
        taken.add(yard["id"])
        donors.append({
            "group_id": x["group_id"],
            "group_name": (g_map.get(x["group_id"]) or {}).get("name") or "",
            "subject": (s_map.get(x.get("subject_id")) or {}).get("name") or "",
            "frees_room_id": room["id"], "frees_room_name": room["name"],
            "yard_id": yard["id"], "yard_name": yard["name"],
        })
    return donors


@app.get("/api/yard-rescue")
def get_yard_rescue(group_id: int, day: int, period: int):
    """For one lesson with no room: the ลาน that would give it one."""
    return _yard_rescue(group_id, day, period)


# ── สอนแทน / แลกคาบ ───────────────────────────────────────────────────────────
# Teachers arrange their own cover here. None of it writes to SLOTS: the master
# timetable stays exactly as the academic office built it, and an arrangement
# is recorded alongside it. That is deliberate — the people using this are not
# the people who own the timetable.

ABSENCES: list[dict[str, Any]] = []        # ครูแจ้งไปราชการ
SUBSTITUTIONS: list[dict[str, Any]] = []   # คาบที่มีคนรับสอนแทนแล้ว
REPAYMENTS: list[dict[str, Any]] = []      # คาบที่คืนแล้ว

_SUB.bind(
    slots=lambda: SLOTS,
    teachers=lambda: TEACHERS,
    requirements=lambda: REQUIREMENTS,
    absences=lambda: ABSENCES,
    substitutions=lambda: SUBSTITUTIONS,
    repayments=lambda: REPAYMENTS,
    teachers_by_id=lambda: {t["id"]: t for t in TEACHERS},
    subjects_by_id=lambda: {s["id"]: s for s in SUBJECTS},
    groups_by_id=lambda: {g["id"]: g for g in _flat_groups()},
    slot_buckets=_slot_buckets,
    elective_option_teachers=_elective_option_teachers,
    teacher_prefs=_teacher_prefs,
    level_key=_level_key,
    class_periods_for_level=_class_periods_for_level,
    next_class_period_for=_next_class_period_for,
)


def _enrich_lesson(s: dict[str, Any]) -> dict[str, Any]:
    """A lesson as a teacher reads it, not as the database stores it."""
    rows = _periods_for_level(_level_key({g["id"]: g for g in _flat_groups()}.get(s["group_id"])))
    row = rows.get(s["period"], {})
    return {
        "slot_id": s["id"], "day": s["day"], "period": s["period"],
        "period_label": row.get("label"),
        "start_time": row.get("start_time"), "end_time": row.get("end_time"),
        "group_id": s["group_id"], "group_name": s.get("group_name"),
        "subject_id": s.get("subject_id"), "subject_code": s.get("subject_code"),
        "subject_name": s.get("subject_name"),
        "room_id": s.get("room_id"), "room_name": s.get("room_name"),
        "teacher_id": s.get("teacher_id"), "teacher_name": s.get("teacher_name"),
        "is_elective": bool(s.get("is_elective")),
        "is_locked": bool(s.get("is_locked")),
    }


@app.get("/api/sub/day")
def sub_day(teacher_id: int, date: str):
    """What this teacher teaches on this date — the starting point for everything."""
    day = _SUB.weekday_of(date)
    if day is None:
        return {"date": date, "day": None, "lessons": [],
                "message": "วันที่เลือกเป็นวันหยุด ไม่มีคาบสอน"}
    lessons = [_enrich_lesson(s) for s in _SUB.affected_lessons(teacher_id, date, None)]
    return {"date": date, "day": day, "lessons": lessons}


@app.post("/api/sub/options")
def sub_options(body: dict[str, Any]):
    """For one lesson: who can cover it, and who can swap for it.

    Both are returned together because they are the same question asked twice —
    the school decides between "someone takes it" and "someone takes it and I
    owe them" when it sees the two lists side by side.
    """
    date = str(body.get("date") or "")
    if _SUB.weekday_of(date) is None:
        raise HTTPException(status_code=400, detail="วันที่เลือกเป็นวันหยุด")

    # One lesson, or a คาบคู่ handed over whole. A block is judged together:
    # a teacher free for the first period and busy for the second cannot take
    # the pair, and the debt is one period per lesson handed over.
    ids = [int(x) for x in (body.get("slot_ids") or []) if str(x).lstrip("-").isdigit()]
    if not ids and body.get("slot_id"):
        ids = [int(body["slot_id"])]
    by_id = {s["id"]: s for s in SLOTS}
    block = [by_id[i] for i in ids if i in by_id]
    if not block:
        raise HTTPException(status_code=404, detail="ไม่พบคาบนี้ในตาราง")

    lesson = block[0]
    absent = lesson.get("teacher_id")
    owed = max(1, int(body.get("owed") or len(block)))
    cover = (_SUB.cover_candidates_for_block(block, date) if len(block) > 1
             else _SUB.cover_candidates(lesson, date))
    return {
        "lesson": _enrich_lesson(lesson),
        "lessons": [_enrich_lesson(b) for b in block],
        "owed": owed,
        "cover": cover,
        "swap": _SUB.swap_routes(lesson, date, absent, owed=owed, block=block) if absent else [],
    }


@app.get("/api/sub/absences")
def list_absences(teacher_id: int | None = None):
    rows = [a for a in ABSENCES if a.get("status") != "cancelled"]
    if teacher_id is not None:
        rows = [a for a in rows if a["teacher_id"] == teacher_id]
    return sorted(rows, key=lambda a: a.get("date") or "")


@app.post("/api/sub/absences")
def create_absence(body: dict[str, Any]):
    date = str(body.get("date") or "")
    if _SUB.weekday_of(date) is None:
        raise HTTPException(status_code=400, detail="วันที่ไม่ถูกต้อง หรือเป็นวันหยุด")
    row = {
        "id": _next("absence"),
        "teacher_id": int(body["teacher_id"]),
        "date": date,
        "periods": [int(p) for p in (body.get("periods") or [])],
        "reason": str(body.get("reason") or "").strip(),
        "status": "open",
    }
    ABSENCES.append(row)
    _SUB.invalidate()
    return row


@app.delete("/api/sub/absences/{i}")
def delete_absence(i: int):
    global ABSENCES, SUBSTITUTIONS
    # The cover arranged for an absence has no meaning once the absence is
    # withdrawn, so it goes too — along with any debt it created, which is
    # why the repayments tied to it are cleared rather than left owing.
    gone = [r["id"] for r in SUBSTITUTIONS if r.get("absence_id") == i]
    REPAYMENTS[:] = [r for r in REPAYMENTS if r.get("substitution_id") not in gone]
    SUBSTITUTIONS[:] = [r for r in SUBSTITUTIONS if r.get("absence_id") != i]
    ABSENCES = [a for a in ABSENCES if a["id"] != i]
    _SUB.invalidate()
    return {"removed": len(gone)}


@app.get("/api/sub/substitutions")
def list_substitutions(teacher_id: int | None = None):
    rows = [r for r in SUBSTITUTIONS if r.get("status") != "cancelled"]
    if teacher_id is not None:
        rows = [r for r in rows
                if r["absent_teacher_id"] == teacher_id or r["cover_teacher_id"] == teacher_id]
    return sorted(rows, key=lambda r: (r.get("date") or "", r.get("period") or 0))


@app.post("/api/sub/substitutions")
def create_substitution(body: dict[str, Any]):
    """Record that somebody is taking a lesson, and any repayment agreed for it."""
    slot_id = int(body.get("slot_id") or 0)
    lesson = next((s for s in SLOTS if s["id"] == slot_id), None)
    if lesson is None:
        raise HTTPException(status_code=404, detail="ไม่พบคาบนี้ในตาราง")
    date = str(body.get("date") or "")
    if _SUB.weekday_of(date) is None:
        raise HTTPException(status_code=400, detail="วันที่ไม่ถูกต้อง หรือเป็นวันหยุด")
    cover = int(body.get("cover_teacher_id") or 0)

    # Refuse a cover the teacher cannot actually give. The page only offers
    # free teachers, but the page is not the only way in here, and a double
    # booking printed on a cover sheet is worse than an error message.
    busy = _SUB.busy_map(date)
    if not _SUB.is_free(cover, lesson["group_id"], lesson["period"], busy):
        raise HTTPException(status_code=409,
                            detail="ครูท่านนี้ไม่ว่างในคาบนั้นแล้ว — มีคนจองไปก่อน ลองดูตัวเลือกใหม่อีกครั้ง")

    row = {
        "id": _next("substitution"),
        "absence_id": body.get("absence_id"),
        "slot_id": slot_id, "date": date,
        "day": lesson["day"], "period": lesson["period"],
        "group_id": lesson["group_id"], "group_name": lesson.get("group_name"),
        "subject_id": lesson.get("subject_id"), "subject_code": lesson.get("subject_code"),
        "subject_name": lesson.get("subject_name"), "room_name": lesson.get("room_name"),
        "absent_teacher_id": lesson.get("teacher_id"),
        "absent_teacher_name": lesson.get("teacher_name"),
        "cover_teacher_id": cover,
        "cover_teacher_name": {t["id"]: t for t in TEACHERS}.get(cover, {}).get("name"),
        # แลกคาบ owes a period back; สอนแทน does not.
        "creates_debt": bool(body.get("creates_debt")),
        "note": str(body.get("note") or "").strip(),
        "status": "agreed",
    }
    SUBSTITUTIONS.append(row)
    _SUB.invalidate()

    for rp in (body.get("repayments") or []):
        _add_repayment(row, rp)
    return row


def _add_repayment(sub: dict[str, Any], rp: dict[str, Any]) -> dict[str, Any] | None:
    slot = next((s for s in SLOTS if s["id"] == int(rp.get("slot_id") or 0)), None)
    if slot is None:
        return None
    row = {
        "id": _next("repayment"),
        "substitution_id": sub["id"],
        "slot_id": slot["id"], "date": str(rp.get("date") or ""),
        "day": slot["day"], "period": slot["period"],
        "group_id": slot["group_id"], "group_name": slot.get("group_name"),
        "subject_code": slot.get("subject_code"), "subject_name": slot.get("subject_name"),
        # The absent teacher pays the cover teacher back.
        "teacher_id": sub["absent_teacher_id"],
        "to_teacher_id": sub["cover_teacher_id"],
        "status": "agreed",
    }
    REPAYMENTS.append(row)
    _SUB.invalidate()
    return row


@app.delete("/api/sub/substitutions/{i}")
def delete_substitution(i: int):
    REPAYMENTS[:] = [r for r in REPAYMENTS if r.get("substitution_id") != i]
    SUBSTITUTIONS[:] = [r for r in SUBSTITUTIONS if r["id"] != i]
    _SUB.invalidate()
    return {"ok": True}


@app.get("/api/sub/repayments")
def list_repayments(teacher_id: int | None = None):
    rows = [r for r in REPAYMENTS if r.get("status") != "cancelled"]
    if teacher_id is not None:
        rows = [r for r in rows
                if r["teacher_id"] == teacher_id or r["to_teacher_id"] == teacher_id]
    return sorted(rows, key=lambda r: (r.get("date") or "", r.get("period") or 0))


@app.get("/api/sub/ledger")
def sub_ledger():
    return {"rows": _SUB.ledger()}


@app.get("/api/school/config")
def get_school_config():
    return SCHOOL_CONFIG


# การตั้งค่าแบบเปิด/ปิด ที่หน้าตั้งค่ากดได้ และตัวจัดตารางอ่าน
#
# หน้าตั้งค่ามีตัวเลือก "ใครเดินไปหาใคร" มาตลอด กดได้ เห็นผลบนจอทันที แต่
# เซิร์ฟเวอร์ไม่เคยเก็บไว้เลย เพราะคีย์นี้ไม่อยู่ในรายการข้างล่าง — กดแล้ว
# รีเฟรช ค่าก็กลับไปเป็นของเดิม และตัวจัดตารางก็ยังใช้ค่าเดิม เป็นอาการเดียวกับ
# "ตั้งค่าแล้วทำไมไม่เห็นอัปเดตข้อมูลเลย" แต่เงียบกว่า เพราะจอโชว์ค่าที่กดไว้
# จนกว่าจะรีเฟรช
_CONFIG_FLAGS = ("teacher_room_over_homeroom", "lower_homeroom_first",
                 "upper_teacher_room_first")


@app.put("/api/school/config")
def update_school_config(body: dict[str, Any]):
    for k in ("schoolName", "term", "year", "directorName", "deputyName", "logoUrl",
              "max_consecutive", "prefer_consecutive", "min_last_period"):
        if k in body:
            SCHOOL_CONFIG[k] = body[k]
    for k in _CONFIG_FLAGS:
        if k not in body:
            continue
        v = body[k]
        # เก็บเป็นบูลีนจริง ไม่ใช่ตามที่ส่งมา — "false" เป็นสตริงที่ไม่ว่าง
        # ซึ่งเป็นจริงถ้าไม่แปลง และตัวจัดตารางจะทำตรงข้ามกับที่กด
        if isinstance(v, str):
            SCHOOL_CONFIG[k] = v.strip().lower() not in ("", "0", "false", "no", "off")
        else:
            SCHOOL_CONFIG[k] = bool(v)
    return SCHOOL_CONFIG


@app.get("/api/state/info")
def state_info():
    """What the data is and where it came from — shown on the backup screen."""
    return {
        "revision": REVISION["n"],
        # รุ่นของเซิร์ฟเวอร์ — หน้าเว็บกับเซิร์ฟเวอร์อยู่คนละที่ (GitHub Pages
        # กับ Render) และอัปเดตแยกกัน หน้าเว็บจึงใหม่ได้ทั้งที่ตัวจัดตารางยัง
        # เป็นรุ่นเก่า ซึ่งมองไม่เห็นเลย: ข้อความบนจอเปลี่ยน แต่ตารางที่ออกมา
        # ยังเป็นของเดิม และโรงเรียนก็กดสร้างตารางซ้ำอยู่อย่างนั้น
        "api_build": API_BUILD,
        "source": _STATE_SOURCE,
        "disk_snapshot": _os.path.exists(_STATE_PATH),
        # Which store is really in use. A database that was configured but
        # could not be reached falls back to the file and keeps working, and
        # without this that failure would look exactly like success until the
        # next restart threw the data away again.
        "store": _STORE_KIND,
        "store_configured": bool(_DB_URL),
        "store_error": _STORE_ERROR,
        "last_saved_at": _LAST_SAVED_AT,
        # True when this server is NOT writing to the database because what it
        # is holding is the shipped data and the school's own copy is still
        # stored. Said out loud, because a server that quietly stops saving
        # looks exactly like one that is saving.
        "write_blocked": bool(_DB_HAD_DATA and _STATE_SOURCE != "snapshot"),
        "counts": {
            "groups": len(_flat_groups()), "teachers": len(TEACHERS),
            "subjects": len(SUBJECTS), "rooms": len(ROOMS),
            "requirements": len(REQUIREMENTS), "slots": len(SLOTS),
            "elective_pools": len(ELECTIVE_POOLS),
        },
    }


# Prefer what the school actually edited over the seed file.
_STATE_SOURCE = "snapshot" if _load_state() else ("seed" if _LOADED_REAL_DATA else "demo")

# A queued save must not die with the process. Render stops a service by
# signalling it, and the second or so of edits still waiting to go out is
# exactly the work somebody just did.
_atexit.register(lambda: _flush_pending())


@app.on_event("shutdown")
def _flush_on_shutdown() -> None:
    _flush_pending()


if __name__ == "__main__":
    import os, uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
