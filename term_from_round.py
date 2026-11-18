# -*- coding: utf-8 -*-
"""สร้างเทอมใหม่จากรอบอัตรากำลัง — ตรรกะแปลงทั้งหมด (ฟังก์ชันล้วน)

ปุ่ม "สร้างเทอมใหม่" ของโปรแกรมจัดตารางเลือกรอบอัตรากำลังของเว็บลงอัตรากำลังได้ แล้วเทอมใหม่เริ่มด้วยทะเบียนครู/วิชาที่ซิงก์แล้ว
แผนการสอน คาบเสรี และหลักสูตรจากรอบ (แบบ docs/superpowers/specs/2026-11-17-workload-stage3-new-term-design.md)

กติกาของโมดูลนี้ — ห้ามละเมิด:
  - **ห้าม import mock_api และห้ามแตะตัวแปรของโปรแกรม** (TEACHERS SUBJECTS REQUIREMENTS ELECTIVE_POOLS CURRICULA _counters ฯลฯ)
    ผู้เรียกส่งข้อมูลเข้ามาเป็น dict แล้วได้สถานะใหม่เป็นสำเนากลับไป เหตุผล: คำขอสร้างเทอมต้องคำนวณสถานะใหม่ทั้งชุดให้เสร็จก่อน
    แตะของสด (แบบข้อ 4.4 ขั้น 3) — ล้มกลางทางแล้วย้อนได้ครบ และหน้าดูก่อนสร้างใช้ฟังก์ชันเดียวกันได้โดยไม่เขียนอะไรเลย
  - ไม่แก้สิ่งที่ส่งเข้ามา (source outgoing counters) และผลไม่แชร์ dict กับสิ่งที่ส่งเข้ามา — ผู้เรียกเอาผลไปใส่แทนของสดได้ตรง ๆ
  - อ้างครู/วิชาด้วยรหัสเท่านั้น ไม่จับคู่ด้วยชื่อ (รหัสวิชาที่ตรงกันหลังตัดช่องว่างใช้ผูกได้ตามแบบข้อ 4.3)

รูปข้อมูลขาเข้าตามสัญญาร่วมของแผน: source = ข้อมูลของรอบ (wl_teachers wl_subjects curricula options rows ...) ·
outgoing = ของเทอมที่กำลังปิด (รูป _wl_timetable_source: requirements pools slots served sched_subjects groups
+ teachers subjects curricula = สำเนาของ TEACHERS SUBJECTS CURRICULA) · counters = สำเนาของ _counters
ลำดับ: registry_plan (ทะเบียน) ก่อนเสมอ แล้ว plan_from_round (แผน คาบเสรี หลักสูตร) ใช้ map ที่ได้
"""
from __future__ import annotations

import copy
from typing import Any, Callable

import curriculum as _curriculum    # ตรรกะล้วนของหลักสูตร (normalise_rows) — ไม่ลากตัวแปรของโปรแกรมมา

# ── ทะเบียน: ช่องที่เว็บลงอัตรากำลังเป็นเจ้าของ และค่าตั้งต้นของรายการใหม่ ─────────────────────
# ช่องนอกจากนี้ (ห้องประจำ คาบสูงสุด/วัน วันที่ไม่สอน advanced_settings credits ฯลฯ) เป็นของโปรแกรมจัดตาราง
# ไม่ถูกแตะแม้ช่องเดียว (สเปกหลักข้อทดสอบ 10ก) — รวม active: ครูที่เว็บบอกว่าไม่ปฏิบัติงานแล้วไม่ถูกปิดในโปรแกรม
TEACHER_OWNED = ("name", "code", "department_id", "dept_order")
SUBJECT_OWNED = ("code", "name", "type", "department_id", "duration", "is_activity", "is_elective")

# ค่าเดียวกับที่ /api/teachers/bulk และ /api/subjects/bulk เติม (tests/py/wlexportreg.py เทียบกับสอง route นั้นจริง)
# ครู/วิชาที่สร้างจากรอบจึงหน้าตาเหมือนที่โรงเรียนเพิ่มเองทางหน้าทะเบียนทุกช่อง
TEACHER_DEFAULTS = {"fixed_room_id": None, "outdoor_score": 5, "max_slots_per_day": 6, "max_outdoor_per_week": 2,
                    "active": True}
SUBJECT_DEFAULTS = {"type": "common", "prefer_morning": False, "duration": 1, "fixed_room_id": None, "active": True}


def _text(v: Any) -> str | None:
    """ข้อความสำหรับเทียบ: ตัดช่องว่างหัวท้าย · ว่าง = None (รหัสว่างกับไม่มีรหัสคือสิ่งเดียวกัน)"""
    if v is None:
        return None
    return str(v).strip() or None


def _as_is(v: Any) -> Any:
    return v


# ค่าที่หมายถึงสิ่งเดียวกันต้องเทียบเท่ากัน: ข้อมูลตั้งต้นของโปรแกรมไม่มีช่อง dept_order / is_elective และปุ่มดึงจากโปรแกรม
# (_wl_teacher_from_sched / _wl_subject_from_sched) แปลงช่องว่างเป็นค่าตั้งต้นตอนเขียนลงเว็บ — เทียบดิบ ๆ แล้ววิชาทั้ง 271
# จะขึ้นเป็น "จะแก้" ในหน้าดูก่อนสร้างทั้งที่ไม่มีอะไรต่าง · ค่าที่เขียนลงโปรแกรมเมื่อต่างกันจริงคือค่าของเว็บหลังผ่านตัวนี้
_TEACHER_NORM: dict[str, Callable[[Any], Any]] = {
    "name": _text, "code": _text, "department_id": _as_is, "dept_order": _as_is}
_SUBJECT_NORM: dict[str, Callable[[Any], Any]] = {
    "code": _text, "name": _text, "type": lambda v: v or "common", "department_id": _as_is,
    "duration": lambda v: v or 1, "is_activity": bool, "is_elective": bool}


def _code_key(v: Any) -> str:
    """รหัสวิชาสำหรับจัดกลุ่ม/ผูก: ตัดช่องว่างหัวท้าย เทียบตรงตัวทุกตัวอักษร (แบบข้อ 4.3)"""
    return str(v or "").strip()


def _sched_id(v: Any) -> int | None:
    # bool เป็น int ในไพทอน — True ไม่ใช่รหัสครู/วิชา
    return v if type(v) is int else None


def _reserve(counters: dict[str, int], key: str, taken: set[int]) -> int:
    """จองรหัสใหม่แบบเดียวกับ _next ของโปรแกรม (counters[key] + 1) แต่ข้ามเลขที่ถูกถืออยู่

    "ถูกถือ" = มีรายการนั้นในโปรแกรมแล้ว หรือมี sched_id ของเว็บชี้อยู่ (รวมที่ห้อยและไม่ถูกสร้างใหม่ เช่นครูที่ไม่ปฏิบัติงาน)
    wl_teachers.sched_id / wl_subjects.sched_id เป็น UNIQUE: ถ้าครูใหม่ได้เลขที่แถวอื่นของเว็บถืออยู่ การเขียนกลับจะชนจนสร้างเทอม
    ไม่สำเร็จ — หรือแย่กว่า ครูสองคนของเว็บกลายเป็นคนเดียวกันในโปรแกรม"""
    while True:
        counters[key] = counters.get(key, 0) + 1
        if counters[key] not in taken:
            taken.add(counters[key])
            return counters[key]


def _patch(target: dict[str, Any], values: dict[str, Any], norm: dict[str, Callable[[Any], Any]],
           fields: tuple[str, ...]) -> dict[str, list[Any]]:
    """แก้ target (สำเนาของเรา) เฉพาะช่องใน fields ที่ต่างจาก values หลังเทียบแบบ norm → {ช่อง: [ค่าเดิม, ค่าใหม่]}

    ช่องที่เท่ากันไม่ถูกเขียน แม้ target ไม่มีคีย์นั้น — แถวของโปรแกรมจึงไม่ได้ช่องเพิ่มโดยไม่มีอะไรเปลี่ยน"""
    changes: dict[str, list[Any]] = {}
    for f in fields:
        new = norm[f](values.get(f))
        if norm[f](target.get(f)) != new:
            changes[f] = [target.get(f), new]
            target[f] = new
    return changes


def typed_subjects(source: dict[str, Any]) -> list[dict[str, Any]]:
    """บรรทัดหลักสูตร/ตัวเลือกที่พิมพ์รหัสเองแต่ไม่ผูกวิชาในทะเบียน (subject_id ว่าง) จัดกลุ่มด้วยรหัสหลังตัดช่องว่าง

    สองบรรทัดที่พิมพ์รหัสเดียวกันต้องได้วิชาเดียวกัน (สเปกหลักข้อ 5) จึงรวมเป็นกลุ่มเดียวก่อนตัดสินว่าสร้างหรือผูก
    ลำดับ = ที่พบก่อน: หลักสูตรตามลำดับ บรรทัดตามลำดับ แล้วตัวเลือก · ชื่อ/กลุ่มสาระจากรายการแรกของกลุ่ม (ชื่อว่าง → ใช้รหัส) ·
    credits จากบรรทัดแรกของกลุ่ม (ตัวเลือกไม่มีหน่วยกิต — กลุ่มที่มีแต่ตัวเลือกได้ None)
    รายการที่รหัสว่างข้ามไป: จัดกลุ่มไม่ได้ และเกณฑ์รอบ (แบบข้อ 4.1 ข้อ 5 — Task 3) บอกเป็นเหตุอยู่แล้ว
    → [{code, name, department_id, credits, line_ids, option_ids}]
    """
    groups: dict[str, dict[str, Any]] = {}

    def add(item: dict[str, Any], credits: Any, ids_key: str) -> None:
        code = _code_key(item.get("code"))
        if not code:
            return
        g = groups.get(code)
        if g is None:
            g = groups[code] = {"code": code, "name": _text(item.get("name")) or code,
                                "department_id": item.get("department_id"), "credits": credits,
                                "line_ids": [], "option_ids": []}
        g[ids_key].append(item["id"])

    for c in source.get("curricula") or []:
        for ln in c.get("lines") or []:
            if ln.get("subject_id") is None:
                add(ln, ln.get("credits"), "line_ids")
    for o in source.get("options") or []:
        if o.get("subject_id") is None:
            add(o, None, "option_ids")
    return list(groups.values())


def _teachers_used(source: dict[str, Any]) -> set[Any]:
    """ครูของเว็บที่ถูกอ้างในรอบ: ครูผู้สอน/ครูสอนร่วมของแถว และครูของตัวเลือก"""
    used = set()
    for r in source.get("rows") or []:
        used |= {r.get("teacher_id"), r.get("co_teacher_id")}
    for o in source.get("options") or []:
        used |= {t.get("teacher_id") for t in o.get("teachers") or []}
    used.discard(None)
    return used


def _subjects_used(source: dict[str, Any]) -> set[Any]:
    """วิชาของเว็บที่ถูกอ้างในรอบ: วิชาของบรรทัดหลักสูตรของภาคเรียน และของตัวเลือกในชุด"""
    used = {ln.get("subject_id") for c in source.get("curricula") or [] for ln in c.get("lines") or []}
    used |= {o.get("subject_id") for o in source.get("options") or []}
    used.discard(None)
    return used


def _first_credits(source: dict[str, Any], typed_bound: dict[str, Any] | None = None) -> dict[Any, Any]:
    """หน่วยกิตของวิชาใหม่ = บรรทัดแรกที่อ้างถึงวิชานั้น ตามลำดับหลักสูตรแล้วบรรทัด (แม้บรรทัดนั้นหน่วยกิตว่าง)

    typed_bound = {รหัส: wl_id} ของบรรทัดที่พิมพ์รหัสเองแล้วผูกกับวิชาของเว็บ — บรรทัดเหล่านั้นก็ "อ้างถึง" วิชานั้น
    ถ้าไม่นับ วิชาที่ถูกอ้างทางนั้นทางเดียวจะได้หน่วยกิตว่าง ทั้งที่ทาง typed_new ของรหัสเดียวกันได้หน่วยกิตจากบรรทัด"""
    bound = typed_bound or {}
    out: dict[Any, Any] = {}
    for c in source.get("curricula") or []:
        for ln in c.get("lines") or []:
            wl_id = ln.get("subject_id")
            if wl_id is None:
                wl_id = bound.get(_code_key(ln.get("code")))
            if wl_id is not None:
                out.setdefault(wl_id, ln.get("credits"))
    return out


def registry_plan(source: dict[str, Any], outgoing: dict[str, Any], counters: dict[str, int]) -> dict[str, Any]:
    """ซิงก์ทะเบียนครูและวิชาของเว็บเข้าโปรแกรมจัดตาราง (แบบข้อ 4.3) — เพิ่มใหม่และแก้ช่องตัวตนเท่านั้น ไม่ลบอะไรเลย

    ครู: ของเว็บที่ (ยังปฏิบัติงาน หรือถูกอ้างในรอบ) และ sched_id ว่างหรือชี้ไปครูที่ไม่มีในโปรแกรมแล้ว → สร้างใหม่ด้วย
    TEACHER_DEFAULTS · มีทั้งสองฝั่ง → แก้เฉพาะช่องใน TEACHER_OWNED ที่ต่าง · ไม่ปฏิบัติงานแต่ยังเปิดในโปรแกรม → inactive_open
    (ไม่แก้ active) · ครูของโปรแกรมที่ไม่มี sched_id ของเว็บชี้ถึง → unknown_teachers (ไม่ทำอะไร)
    วิชา: กฎเดียวกัน (SUBJECT_OWNED · SUBJECT_DEFAULTS · credits จากบรรทัดแรกที่อ้างถึง) บวกสองข้อ —
      - วิชาที่ต้องสร้างในโปรแกรม แต่โปรแกรมมีรหัสนั้นอยู่ **วิชาเดียว** ที่ยังไม่ผูกกับวิชาของเว็บ → ผูกด้วยรหัสแทนการสร้าง แล้วแก้ช่องตัวตน
        (code_links) · รหัสนั้นมีหลายวิชา หรือผูกกับวิชาอื่นของเว็บแล้ว → reasons (ไม่สร้าง ไม่ผูก)
        รหัสของโปรแกรมดูหลังแก้ช่องตัวตนของวิชาที่ผูกอยู่แล้ว (วิชาที่เว็บเปลี่ยนรหัสไปแล้วไม่ขวางรหัสเดิมของมัน)
      - บรรทัด/ตัวเลือกที่พิมพ์รหัสเอง (typed_subjects): รหัสตรงกับวิชาในทะเบียนของเว็บ → ผูกกับวิชานั้น (bind_wl_subjects —
        วิชานั้นนับว่าถูกอ้างในรอบ) · ไม่ตรง → สร้างวิชาใหม่ทั้งในเว็บ (new_wl_subjects) และในโปรแกรม (หรือผูกด้วยรหัสตามข้อบน) ·
        ตรงกับวิชาของเว็บหลายวิชา → reasons
    รหัสใหม่จองจาก counters แบบ _next (ข้ามเลขที่ถูกถือ — ดู _reserve) · ไม่แก้สิ่งที่ส่งเข้ามา

    คืน {"teachers": TEACHERS ใหม่ทั้งชุด, "subjects": SUBJECTS ใหม่ทั้งชุด, "counters": ตัวนับใหม่,
         "teacher_map": {wl_id: sched_id}, "subject_map": {wl_id: sched_id}, "typed_map": {รหัส: sched_id},
         "writeback": {"teachers": [{id, old, new}], "subjects": [{id, old, new}],
                       "new_wl_subjects": [{code, name, department_id, type, duration, is_activity, is_elective,
                                            sched_id, line_ids, option_ids}],
                       "bind_wl_subjects": [{id, code, line_ids, option_ids}]},
         "report": {teachers_created, teachers_patched, subjects_created, subjects_patched, code_links,
                    inactive_open, unknown_teachers — แต่ละตัวเป็นรายการ จำนวน = len},
         "reasons": [ข้อความไทย]}
    map มีเฉพาะรายการที่จบด้วยรหัสของโปรแกรมที่มีอยู่จริง — วิชาที่ติดเหตุไม่อยู่ใน map (และ reasons ไม่ว่าง ผู้เรียกต้องไม่สร้างเทอม)
    """
    wl_teachers = list(source.get("wl_teachers") or [])
    wl_subjects = list(source.get("wl_subjects") or [])
    teachers = copy.deepcopy(list(outgoing.get("teachers") or []))
    subjects = copy.deepcopy(list(outgoing.get("subjects") or []))
    counters = dict(counters)
    reasons: list[str] = []
    report: dict[str, list[dict[str, Any]]] = {
        "teachers_created": [], "teachers_patched": [], "subjects_created": [], "subjects_patched": [],
        "code_links": [], "inactive_open": [], "unknown_teachers": []}
    writeback: dict[str, list[dict[str, Any]]] = {
        "teachers": [], "subjects": [], "new_wl_subjects": [], "bind_wl_subjects": []}

    # ── ครู ──────────────────────────────────────────────────────────────
    t_by_id = {t["id"]: t for t in teachers}
    t_taken = set(t_by_id) | {s for s in (_sched_id(w.get("sched_id")) for w in wl_teachers) if s is not None}
    t_used = _teachers_used(source)
    teacher_map: dict[Any, int] = {}
    known: set[int] = set()
    for w in wl_teachers:
        sid = _sched_id(w.get("sched_id"))
        t = t_by_id.get(sid) if sid is not None else None
        if t is not None:
            known.add(sid)
            teacher_map[w["id"]] = sid
            changes = _patch(t, w, _TEACHER_NORM, TEACHER_OWNED)
            if changes:
                report["teachers_patched"].append(
                    {"wl_id": w["id"], "id": sid, "name": t.get("name"), "changes": changes})
            continue
        if not (w.get("active", True) or w["id"] in t_used):
            continue    # ไม่ปฏิบัติงานและไม่ถูกอ้าง — ไม่สร้าง (ไม่มีใครต้องการครูคนนี้ในเทอมใหม่)
        new_id = _reserve(counters, "teacher", t_taken)
        row = {k: _TEACHER_NORM[k](w.get(k)) for k in TEACHER_OWNED}
        row["id"] = new_id
        for k, v in TEACHER_DEFAULTS.items():
            row.setdefault(k, v)
        teachers.append(row)
        t_by_id[new_id] = row
        teacher_map[w["id"]] = new_id
        writeback["teachers"].append({"id": w["id"], "old": w.get("sched_id"), "new": new_id})
        report["teachers_created"].append({"wl_id": w["id"], "id": new_id, "name": row["name"],
                                           "code": row["code"], "department_id": row["department_id"]})
    for w in wl_teachers:
        sid = teacher_map.get(w["id"])
        if not w.get("active", True) and sid is not None and t_by_id[sid].get("active", True):
            report["inactive_open"].append({"wl_id": w["id"], "id": sid, "name": t_by_id[sid].get("name")})
    report["unknown_teachers"] = [
        {"id": t["id"], "name": t.get("name"), "code": t.get("code"), "department_id": t.get("department_id"),
         "active": bool(t.get("active", True))}
        for t in outgoing.get("teachers") or [] if t["id"] not in known]

    # ── วิชา ─────────────────────────────────────────────────────────────
    s_by_id = {s["id"]: s for s in subjects}
    s_taken = set(s_by_id) | {s for s in (_sched_id(w.get("sched_id")) for w in wl_subjects) if s is not None}
    s_used = _subjects_used(source)
    subject_map: dict[Any, int] = {}
    typed_map: dict[str, int] = {}
    linked: set[int] = set()        # วิชาของโปรแกรมที่มีวิชาของเว็บผูกอยู่ (หรือผูกในรอบนี้)
    created: set[int] = set()       # วิชาของโปรแกรมที่สร้างในรอบนี้

    # บรรทัด/ตัวเลือกที่พิมพ์รหัสเอง: ตัดสินก่อน เพราะการผูกกับวิชาของเว็บทำให้วิชานั้น "ถูกอ้างในรอบ"
    wl_by_code: dict[str, list[dict[str, Any]]] = {}
    for w in wl_subjects:
        if _code_key(w.get("code")):
            wl_by_code.setdefault(_code_key(w.get("code")), []).append(w)
    typed_bind: list[tuple[dict[str, Any], dict[str, Any]]] = []
    typed_new: list[dict[str, Any]] = []
    for g in typed_subjects(source):
        hits = wl_by_code.get(g["code"], [])
        if len(hits) > 1:
            reasons.append(f"รหัสวิชา {g['code']} ที่พิมพ์ไว้ในหลักสูตร/คาบเสรี ตรงกับวิชาในทะเบียนของเว็บลงอัตรากำลัง "
                           f"{len(hits)} วิชา ({', '.join(str(h.get('name')) for h in hits)}) จึงไม่รู้ว่าจะผูกกับวิชาใด "
                           "— แก้รหัสในทะเบียนวิชาให้ไม่ซ้ำก่อน")
        elif hits:
            typed_bind.append((g, hits[0]))
            s_used.add(hits[0]["id"])
        else:
            typed_new.append(g)
    credits_of = _first_credits(source, {g["code"]: w["id"] for g, w in typed_bind})

    # วิชาของเว็บที่ผูกอยู่แล้ว: แก้ช่องตัวตนก่อน แล้วค่อยสร้างดัชนีรหัสของโปรแกรมจากค่าหลังแก้
    need: list[dict[str, Any]] = []
    for w in wl_subjects:
        sid = _sched_id(w.get("sched_id"))
        s = s_by_id.get(sid) if sid is not None else None
        if s is not None:
            linked.add(sid)
            subject_map[w["id"]] = sid
            changes = _patch(s, w, _SUBJECT_NORM, SUBJECT_OWNED)
            if changes:
                report["subjects_patched"].append({"wl_id": w["id"], "id": sid, "code": s.get("code"),
                                                   "name": s.get("name"), "changes": changes})
        elif w.get("active", True) or w["id"] in s_used:
            need.append(w)
    prog_by_code: dict[str, list[dict[str, Any]]] = {}
    for s in subjects:
        if _code_key(s.get("code")):
            prog_by_code.setdefault(_code_key(s.get("code")), []).append(s)

    def place(wl_id: Any, label: str, values: dict[str, Any], fields: tuple[str, ...],
              credits: Any) -> int | None:
        """วิชาที่ต้องมีในโปรแกรมแต่ยังไม่มี: ผูกด้วยรหัส สร้างใหม่ หรือเป็นเหตุ (None) — คืนรหัสของโปรแกรม"""
        code = _code_key(values.get("code"))
        hits = prog_by_code.get(code, []) if code else []
        if len(hits) > 1:
            reasons.append(f"รหัสวิชา {code} ({label}) มีในโปรแกรมจัดตาราง {len(hits)} วิชา "
                           f"({', '.join(str(h.get('name')) for h in hits)}) จึงผูกด้วยรหัสวิชาไม่ได้ "
                           "— แก้รหัสวิชาในโปรแกรมจัดตารางให้ไม่ซ้ำก่อน")
            return None
        if hits:
            s = hits[0]
            if s["id"] in created:
                # วิชานั้นเพิ่งถูกสร้างจากวิชาของเว็บอีกตัวในรอบนี้ — ทะเบียนของเว็บมีรหัสซ้ำ (ค้างจากขั้นที่ 1)
                reasons.append(f"รหัสวิชา {code} ({label}) ซ้ำกับวิชา {s.get('name')} ที่จะสร้างในโปรแกรมจัดตารางในรอบนี้ "
                               "— ทะเบียนวิชาของเว็บลงอัตรากำลังมีวิชารหัสนี้มากกว่าหนึ่งวิชา จึงสร้างได้วิชาเดียว "
                               "— แก้รหัสวิชาในทะเบียนของเว็บให้ไม่ซ้ำก่อน")
                return None
            if s["id"] in linked:
                reasons.append(f"รหัสวิชา {code} ({label}) ซ้ำกับวิชา {s.get('name')} ในโปรแกรมจัดตาราง "
                               "ที่ผูกกับวิชาอื่นของเว็บลงอัตรากำลังแล้ว จึงสร้างหรือผูกไม่ได้ "
                               "— แก้รหัสวิชาในทะเบียนของเว็บให้ไม่ซ้ำก่อน")
                return None
            linked.add(s["id"])
            changes = _patch(s, values, _SUBJECT_NORM, fields)
            if changes:
                report["subjects_patched"].append({"wl_id": wl_id, "id": s["id"], "code": s.get("code"),
                                                   "name": s.get("name"), "changes": changes})
            report["code_links"].append({"wl_id": wl_id, "id": s["id"], "code": s.get("code"),
                                         "name": s.get("name")})
            return s["id"]
        new_id = _reserve(counters, "subject", s_taken)
        row = {k: _SUBJECT_NORM[k](values.get(k)) for k in SUBJECT_OWNED}
        row["credits"] = credits
        row["id"] = new_id
        for k, v in SUBJECT_DEFAULTS.items():
            row.setdefault(k, v)
        subjects.append(row)
        s_by_id[new_id] = row
        linked.add(new_id)
        created.add(new_id)
        if code:
            prog_by_code.setdefault(code, []).append(row)   # วิชาเว็บรหัสซ้ำตัวถัดไปต้องไม่ได้วิชาซ้ำรหัสในโปรแกรม
        report["subjects_created"].append({"wl_id": wl_id, "id": new_id, "code": row["code"], "name": row["name"]})
        return new_id

    for w in need:
        sid = place(w["id"], str(w.get("name")), w, SUBJECT_OWNED, credits_of.get(w["id"]))
        if sid is not None:
            subject_map[w["id"]] = sid
            writeback["subjects"].append({"id": w["id"], "old": w.get("sched_id"), "new": sid})

    # วิชาที่พิมพ์รหัสเองและไม่มีในทะเบียนของเว็บ: บรรทัดบอกได้แค่รหัส ชื่อ กลุ่มสาระ จึงแก้แค่สามช่องนั้นเมื่อผูกด้วยรหัส
    # ช่องตัวตนอื่นของวิชาในโปรแกรมคงไว้ และแถวใหม่ในทะเบียนของเว็บรับค่าทุกช่องตัวตนจากวิชาในโปรแกรม
    # — ไม่งั้นรอบหน้าวิชานี้ "ต่างกัน" แล้วค่าตั้งต้นของเว็บไปทับคาบคู่/กิจกรรมของโปรแกรม
    # และแก้เฉพาะช่องที่บรรทัดมีค่าจริง: บรรทัดที่ไม่มีชื่อ (typed_subjects ใช้รหัสแทนชื่อ) หรือไม่มีกลุ่มสาระ ไม่ได้บอกว่า
    # ชื่อ/กลุ่มสาระคืออะไร — ถ้าส่งเข้า _patch ชื่อจริงของวิชาในโปรแกรมจะกลายเป็นรหัส และกลุ่มสาระถูกล้างเป็นว่าง
    # (ตอนสร้างวิชาใหม่ยังใช้รหัสแทนชื่อได้ เพราะไม่มีชื่อเดิมให้เสีย)
    for g in typed_new:
        values = {"code": g["code"], "name": g["name"], "department_id": g["department_id"],
                  "is_activity": False, "is_elective": False}
        fields = ("code",) + (("name",) if g["name"] != g["code"] else ()) + \
            (("department_id",) if g["department_id"] is not None else ())
        sid = place(None, g["name"], values, fields, g["credits"])
        if sid is not None:
            typed_map[g["code"]] = sid
            s = s_by_id[sid]
            writeback["new_wl_subjects"].append(
                {**{k: _SUBJECT_NORM[k](s.get(k)) for k in SUBJECT_OWNED}, "sched_id": sid,
                 "line_ids": list(g["line_ids"]), "option_ids": list(g["option_ids"])})
    for g, w in typed_bind:
        writeback["bind_wl_subjects"].append({"id": w["id"], "code": g["code"], "line_ids": list(g["line_ids"]),
                                              "option_ids": list(g["option_ids"])})
        if w["id"] in subject_map:
            typed_map[g["code"]] = subject_map[w["id"]]

    return {"teachers": teachers, "subjects": subjects, "counters": counters,
            "teacher_map": teacher_map, "subject_map": subject_map, "typed_map": typed_map,
            "writeback": writeback, "report": report, "reasons": reasons}


def keep_set_electives(registry: dict[str, Any], elective_subjects: list[Any]) -> None:
    """ค่า is_elective สุดท้าย = ค่าของเว็บ **หรือ** วิชานั้นอยู่ในชุดคาบเสรีของรอบนี้ (คำตัดสินของผู้คุม รอบแก้สุดท้ายของขั้นที่ 3) — แก้ผลของ
    registry_plan ในที่ (registry_plan ทำงานบนสำเนาลึกของทะเบียน การแก้จึงไม่ย้อนถึงของสด)
    registry_plan แก้ is_elective ตามเว็บ (Ruling T1 C4) แล้วการสร้างเทอมติดธงวิชาของตัวเลือกในชุดกลับเป็นใช่ (_mark_elective) — สรุปจึงเคยบอก
    "N วิชาจะถูกแก้ · เป็นวิชาเสรี: ใช่ → ไม่ใช่" ทั้งที่ไม่เกิดจริงหลังสร้าง (คำเตือนเท็จทุกภาคเรียน เมื่อทะเบียนของเว็บถูกดึงก่อนโปรแกรมติ๊กเอง) ·
    วิชาในชุด: ทะเบียนที่จะใส่ = ใช่ · ช่องที่เปลี่ยน: เดิมใช่ = ไม่เปลี่ยน (ตัดออก) · เดิมไม่ใช่ = ไม่ใช่ → ใช่ · รายการที่ไม่เหลือช่องเปลี่ยนตัดออก ·
    วิชาที่ไม่อยู่ในชุดตามเว็บเหมือนเดิม · ใช้ทั้งการสร้างเทอมจากรอบ (mock_api._term_build) และหน้าเทียบกลางเทอม (plan_diff — ไม่งั้นวิชาที่โปรแกรม
    ติดธงเองขึ้นเป็นข้อเท็จ "ใช่ → ไม่ใช่" ในรอบที่เพิ่งเปิด) — อยู่ที่นี่ที่เดียว"""
    in_set = set(elective_subjects)
    if not in_set:
        return
    for s in registry["subjects"]:
        if s.get("id") in in_set:
            s["is_elective"] = True
    report = registry["report"]
    for p in report["subjects_patched"]:
        change = p["changes"].get("is_elective") if p.get("id") in in_set else None
        if change is None:
            continue
        if bool(change[0]):
            del p["changes"]["is_elective"]
        else:
            p["changes"]["is_elective"] = [change[0], True]
    report["subjects_patched"] = [p for p in report["subjects_patched"] if p["changes"]]


def shares_students(groups: Any) -> Callable[[Any, Any], bool]:
    """ห้องสองห้องมีนักเรียนชุดเดียวกันไหม — กฎเดียวกับ mock_api._shares_students_fn (ตัวทดสอบเทียบทุกคู่ของห้องตั้งต้น):
    ห้องเดียวกัน หรือห้องหนึ่งเป็นห้องแม่ (ทุกชั้น) ของอีกห้อง (ม.6/9 กับ ม.6/9ก) · ห้องพี่น้อง (ม.6/9ก กับ ม.6/9ข) ไม่ใช่
    groups = {รหัสห้อง: ห้อง} หรือรายการห้อง (อ่าน parent_id) · ไม่แตะตัวแปรของโปรแกรม"""
    rows = groups.values() if isinstance(groups, dict) else groups
    parent_of = {g.get("id"): g.get("parent_id") for g in rows}

    def chain(gid: Any) -> set[Any]:
        out, cur = {gid}, parent_of.get(gid)
        while cur is not None and cur not in out:
            out.add(cur)
            cur = parent_of.get(cur)
        return out

    def shares(a: Any, b: Any) -> bool:
        return a == b or b in chain(a) or a in chain(b)
    return shares


# ── แผนการสอน คาบเสรี และหลักสูตรของเทอมใหม่ (แบบข้อ 4.2) ────────────────────────────────────
# ข้อความเดียวกับ mock_api.WL_CO_UNEQUAL_FLAG ทุกตัวอักษร (import mock_api ไม่ได้ — tests/py/wlexportplan.py เทียบให้)
# ขั้นที่ 2 ติดธงนี้ให้คู่สอนร่วมในแผนเดิมที่คาบไม่เท่ากัน แล้วเก็บเป็นสองแถวที่ไม่ชี้กัน
CO_UNEQUAL_FLAG = "สอนร่วมในแผนเดิมคาบไม่เท่ากัน"
# ช่องของแถวแผนที่เว็บไม่มี — ยกมาจากแผนเดิมของเทอมที่กำลังปิด
CARRY_KEYS = ("parallel_group_key", "pinned_day", "pinned_period", "pinned_double")


def _next_id(counters: dict[str, int], key: str) -> int:
    """จองรหัสแบบเดียวกับ _next ของโปรแกรม · แผน คาบเสรี และหลักสูตรถูกแทนทั้งชุด รหัสเดิมจึงไม่มีอะไรให้ชน"""
    counters[key] = counters.get(key, 0) + 1
    return counters[key]


def _old_pair(block: list[dict[str, Any]], t1: Any, t2: Any) -> bool:
    """แผนเดิมของห้อง+วิชานี้เป็นสอนร่วมแบบสองแถวของครูคู่นี้ไหม (กฎเดียวกับ _fold_coteaching: แถวหนึ่งชี้ครูของอีกแถว)"""
    for i, a in enumerate(block):
        for b in block[i + 1:]:
            if {a.get("teacher_id"), b.get("teacher_id")} == {t1, t2} and \
                    (a.get("co_teacher_id") == b.get("teacher_id") or b.get("co_teacher_id") == a.get("teacher_id")):
                return True
    return False


def plan_from_round(source: dict[str, Any], outgoing: dict[str, Any], maps: dict[str, Any],
                    counters: dict[str, int]) -> dict[str, Any]:
    """รอบอัตรากำลัง → REQUIREMENTS ELECTIVE_POOLS CURRICULA และ curriculum_id ของห้อง ของเทอมใหม่ (แบบข้อ 4.2)

    maps = ผลของ registry_plan: teacher_map subject_map typed_map (wl → รหัสของโปรแกรม) และ subjects (SUBJECTS ใหม่ —
    ใช้ชื่อ/รหัสวิชาของตัวเลือกในคาบเสรี ไม่มีก็ใช้ outgoing["subjects"])
    - แถวของรอบ → หนึ่งแถวแผน: ครู ครูสอนร่วม คาบ/สัปดาห์ของบรรทัด room_id = ห้องปฏิบัติการ pinned_double เมื่อคาบคู่ ·
      บรรทัดที่พิมพ์รหัสเองหาวิชาจาก typed_map ด้วยรหัสของบรรทัด · แถวที่มีธง CO_UNEQUAL_FLAG ของห้อง+วิชาเดียวกัน
      จับคู่ตามลำดับเป็นสองแถวที่ชี้กัน เรียงคู่ตามแผนเดิม (โปรแกรมรวมเป็นบทเรียนเดียวเองด้วย _fold_coteaching โดยเก็บแถวแรก
      — ได้บทเรียนเดียวกับแผนเดิม)
    - สอนร่วมที่แผนเดิมเขียนเป็นสองแถวชี้กัน (ขั้นที่ 2 รวมเป็นแถวเดียวของรอบเพราะคาบเท่ากัน) → สองแถวชี้กันตามรูปเดิม
      เมื่อครูคู่เดียวกันและรอบไม่มีแถวของครูสอนร่วมคนนั้นในห้อง+วิชานี้อยู่แล้ว — ยอดคาบรายครูของโปรแกรม (teacherLoads)
      นับจาก teacher_id ของแถวเท่านั้น ถ้าเหลือแถวเดียว ครูสอนร่วมจะหายจากยอดทั้งที่ยังสอนเท่าเดิม (แบบข้อทดสอบ 1)
    - ชุดคาบเสรี → หนึ่ง pool ยังไม่ลงคาบ · ตัวเลือก = หนึ่งต่อ (ตัวเลือก, ครู) เรียงครูตามรหัสแถวครูของตัวเลือก ·
      ห้องจากครูของตัวเลือก · ตัวเลือกที่ไม่มีครูคงไว้แบบไม่มีครู (โปรแกรมนับเป็น missing_teacher_count) · (วิชา, ครู)
      ที่ซ้ำกับตัวที่มีแล้วในชุดเดียวถูกรวม และบอกใน report.merged_options
    - แถวแผนของวิชาเสรี "ตามรูปของแผนเดิม": วิชา S ของตัวเลือก × ห้อง g ของชุด **หรือห้องแม่/ห้องย่อยของห้องในชุด**
      (shares_students — กฎเดียวกับ _reqs_served_by_elective ที่ขั้นที่ 2 ใช้ข้ามแถว) ที่แผนเดิมมีแถว (g, S) และรอบไม่มีแถวของ
      (g, S) อยู่แล้ว → หนึ่งแถวต่อแถวเดิม: ครูคนเดิมถ้ายังเป็นครูของตัวเลือกนั้น ไม่งั้นครูของตัวเลือกคนแรก · คาบและ room_id
      เท่าแถวเดิม · ครูสอนร่วมเดิมคงไว้ถ้ายังเป็นครูของตัวเลือกนั้น · ไม่มีแถวเดิม → ชุดอย่างเดียว
      (ขั้นที่ 2 ข้ามแถวเหล่านี้เพราะชุดนับคาบแทน แต่ยอดคาบรายครูของโปรแกรมนับจากแถวแผนเท่านั้น — ทิ้งไปยอดของครูวิชาเสรีหาย
      · โปรแกรมรู้เองว่าแถวเหล่านี้สอนในคาบเสรีแล้ว _reqs_served_by_elective จึงไม่จัดซ้ำ)
    - ช่องที่เว็บไม่มี (CARRY_KEYS) ยกจากแผนเดิมด้วยก้อน (ห้อง, วิชา) ทีละช่อง เมื่อทุกแถวในก้อนเห็นตรงกัน — ครูสอนร่วมแบบ
      สองแถวจึงยังยกได้ (parallel_group_key "" กับ None คือค่าเดียวกัน) · ไม่ตรงกัน → ว่าง และบอกใน report.not_carried ·
      ห้อง+วิชาที่ไม่มีในแผนเดิม → ว่าง และบอกใน report.new_cells · pinned_double สุดท้าย = คาบคู่จากรอบ หรือ ค่าที่ยกมา
    - ชุดกิจกรรม → report.activity_sets (ต้องลงคาบเอง: โปรแกรมเก็บกิจกรรมไว้ในคาบ และตารางของเทอมใหม่เริ่มว่าง) ไม่เป็น pool
      · แถวแผนของห้อง+วิชาที่กิจกรรมทั้งระดับครอบไว้ (ขั้นที่ 2 ข้ามแล้วยกเป็นชุดกิจกรรม) ใช้กฎ "ตามรูปของแผนเดิม" ข้างบน
      ครูคนเดิมถ้ายังเป็นครูที่คุมของชุด ไม่งั้นครูที่คุมคนแรก (รหัสรายการน้อยสุด) · คาบเท่าแถวเดิม (คำตัดสินแก้รอบ 1)
    - หลักสูตร → {id, name, rows: normalise_rows(บรรทัด)} · group_curricula ให้คำตอบทุกห้องของโปรแกรม (ไม่อยู่หลักสูตรใด → None)
      · แถวแผนที่เขียน (รวมแถวแผนของวิชาเสรี) ที่วิชาไม่อยู่ในหลักสูตรของห้อง หรือคาบน้อยกว่าแถว → เพิ่ม (วิชา, คาบ) เข้าหลักสูตรนั้น
      ทุกแถวจึงผ่าน check_row (แบบข้อทดสอบ 9) · บอกใน report.curriculum_rows_added
    - วิชา/ครูที่ไม่อยู่ใน map (ติดเหตุของทะเบียน) หรือห้องที่ไม่มีในโปรแกรมแล้ว: ข้ามรายการที่อ้างถึง แล้วบอกใน report.skipped
      ไม่ล้ม (หน้าดูก่อนสร้างยังต้องแสดงได้ — ผู้เรียกไม่สร้างเทอมเมื่อทะเบียนมีเหตุอยู่แล้ว)
    รหัสใหม่จาก counters (requirement elective_pool elective_option curriculum) · ไม่แก้สิ่งที่ส่งเข้ามา

    คืน {"requirements", "pools", "curricula", "group_curricula": {group_id: curriculum_id|None},
         "elective_subjects": [รหัสวิชาของตัวเลือกในชุด — ผู้เรียกติดธงด้วย _mark_elective หลังใส่ SUBJECTS], "counters",
         "report": {"rows", "periods", "teachers_in_plan", "pools", "pool_options" (ตัวเลข),
                    "activity_sets": [{name, group_ids, weekly, teacher_ids}], "carried" (จำนวนแถวที่ได้ค่าที่ยกมา),
                    "not_carried": [{group_id, subject_id, fields}] (ละห้อง+วิชา),
                    "new_cells": [{group_id, subject_id}] (ห้อง+วิชาที่ไม่มีในแผนเดิม ละห้อง+วิชา),
                    "elective_rows" (จำนวนแถวแผนของวิชาเสรี),
                    "activity_rows" (จำนวนแถวแผนที่กิจกรรมทั้งระดับครอบ),
                    "pattern_rows": [{kind (elective|activity), group_id, subject_id, teacher_id, weekly_count}]
                    (แถวแผนของวิชาเสรี/กิจกรรมที่เขียนตามรูปของแผนเดิม ตามลำดับที่เขียน),
                    "curriculum_rows_added": [{curriculum_id, subject_id, weekly_count}] (ละหลักสูตร+วิชา),
                    "merged_options": [{set, option_id, subject_id, teacher_id}] (ตัวเลือกคาบเสรีซ้ำที่ถูกรวม),
                    "skipped": [{source (row option option_teacher line elective_row activity_row), ref, reason}]}}
    """
    counters = dict(counters)
    teacher_map = maps.get("teacher_map") or {}
    subject_map = maps.get("subject_map") or {}
    typed_map = maps.get("typed_map") or {}
    subj_rows = maps.get("subjects")
    subj_by_id = {s["id"]: s for s in (subj_rows if subj_rows is not None else outgoing.get("subjects") or [])}
    groups = outgoing.get("groups") or {}
    group_by_id = dict(groups) if isinstance(groups, dict) else {g.get("id"): g for g in groups}
    skipped: list[dict[str, Any]] = []

    def skip(kind: str, ref: Any, reason: str) -> None:
        skipped.append({"source": kind, "ref": ref, "reason": reason})

    def gname(gid: Any) -> str:
        return str((group_by_id.get(gid) or {}).get("name") or f"ห้องรหัส {gid}")

    def subject_of(wl_id: Any, code: Any) -> int | None:
        # วิชาของเว็บผ่าน subject_map · บรรทัด/ตัวเลือกที่พิมพ์รหัสเองผ่าน typed_map ด้วยรหัสหลังตัดช่องว่าง
        if wl_id is not None:
            return subject_map.get(wl_id)
        return typed_map.get(_code_key(code)) if _code_key(code) else None

    lines_by_id = {ln.get("id"): ln for c in source.get("curricula") or [] for ln in c.get("lines") or []}

    # ── แถวของรอบ ──────────────────────────────────────────────────────────
    requirements: list[dict[str, Any]] = []
    round_cells: set[tuple] = set()
    unequal: dict[tuple, list[dict[str, Any]]] = {}
    for r in source.get("rows") or []:
        line = lines_by_id.get(r.get("line_id")) or {}
        wl_sid = r.get("subject_id") if r.get("subject_id") is not None else line.get("subject_id")
        code = line.get("code") if line else r.get("code")
        gid = r.get("group_id")
        where = f"แถวของรอบ {gname(gid)} {_code_key(code) or ''}".rstrip()
        sid = subject_of(wl_sid, code)
        if sid is None:
            skip("row", r.get("id"), f"{where}: วิชานี้ยังไม่มีในโปรแกรมจัดตาราง (ติดเหตุของทะเบียนวิชา) จึงไม่ได้ใส่ในแผน")
            continue
        round_cells.add((gid, sid))
        if gid not in group_by_id:
            skip("row", r.get("id"), f"{where}: ไม่พบห้องเรียนรหัส {gid} ในโปรแกรมจัดตารางแล้ว จึงไม่ได้ใส่ในแผน")
            continue
        missing = [t for t in (r.get("teacher_id"), r.get("co_teacher_id")) if t is not None and t not in teacher_map]
        if missing:
            skip("row", r.get("id"), f"{where}: ครูรหัส {missing[0]} ของเว็บยังไม่มีในโปรแกรมจัดตาราง "
                                     "(ติดเหตุของทะเบียนครู) จึงไม่ได้ใส่ในแผน")
            continue
        co = teacher_map.get(r.get("co_teacher_id")) if r.get("co_teacher_id") is not None else None
        row: dict[str, Any] = {
            "id": None, "group_id": gid, "subject_id": sid,
            # 0 = ยังไม่ได้เลือกครู แบบที่ /api/timetable/requirements/bulk เก็บ (None == None ทำให้ _fold_coteaching
            # พับสองแถวที่ไม่มีครูเป็นบทเรียนเดียว) — รอบที่ผ่านเกณฑ์มีครูทุกแถวอยู่แล้ว
            "teacher_id": teacher_map.get(r.get("teacher_id")) or 0,
            "weekly_count": int(r.get("weekly") or 0), "parallel_group_key": None,
            "co_teacher_id": co, "room_id": r.get("lab_room_id")}
        if r.get("is_double"):
            row["pinned_double"] = True
        requirements.append(row)
        if r.get("flag") == CO_UNEQUAL_FLAG:
            unequal.setdefault((gid, sid), []).append(row)
    old_by_cell: dict[tuple, list[dict[str, Any]]] = {}
    for r in outgoing.get("requirements") or []:
        old_by_cell.setdefault((r.get("group_id"), r.get("subject_id")), []).append(r)
    for cell, halves in unequal.items():
        old_order = [r.get("teacher_id") for r in old_by_cell.get(cell, [])]
        for a, b in zip(halves[0::2], halves[1::2]):
            for x, y in ((a, b), (b, a)):
                if x["co_teacher_id"] is None and y["teacher_id"] and y["teacher_id"] != x["teacher_id"]:
                    x["co_teacher_id"] = y["teacher_id"]
            # ลำดับของคู่ตามแผนเดิม: _fold_coteaching เก็บแถวแรกของคู่เป็นบทเรียน (ครูหลัก ห้อง) แต่แถวของรอบเรียงตาม
            # บรรทัดหลักสูตร (ตั้งต้นเรียงบรรทัดซ้ำตามคาบ) — แผนเดิมเขียนแถวคาบมากก่อนแล้วบทเรียนจะเปลี่ยนห้อง/ครูหลัก
            if a["teacher_id"] in old_order and b["teacher_id"] in old_order and \
                    old_order.index(b["teacher_id"]) < old_order.index(a["teacher_id"]):
                ia = next(i for i, r in enumerate(requirements) if r is a)
                ib = next(i for i, r in enumerate(requirements) if r is b)
                requirements[ia], requirements[ib] = b, a
    teaching: dict[tuple, set[int]] = {}
    for row in requirements:
        teaching.setdefault((row["group_id"], row["subject_id"]), set()).add(row["teacher_id"])
    shaped: list[dict[str, Any]] = []
    for row in requirements:
        shaped.append(row)
        cell, t, co = (row["group_id"], row["subject_id"]), row["teacher_id"], row["co_teacher_id"]
        if co and t and co != t and co not in teaching[cell] and _old_pair(old_by_cell.get(cell, []), t, co):
            teaching[cell].add(co)
            shaped.append({**row, "teacher_id": co, "co_teacher_id": t})
    requirements = shaped
    for row in requirements:
        row["id"] = _next_id(counters, "requirement")

    # ── ชุดคาบเสรี / ชุดกิจกรรม ────────────────────────────────────────────
    options_of: dict[Any, list[dict[str, Any]]] = {}
    for o in source.get("options") or []:
        options_of.setdefault(o.get("set_id"), []).append(o)

    def option_teachers(o: dict[str, Any], where: str) -> list[tuple[int, Any]]:
        """[(ครูของโปรแกรม, ห้อง)] ของตัวเลือก เรียงตามรหัสแถวครูของตัวเลือก (= ลำดับที่ใส่) ไม่ซ้ำคน"""
        out: list[tuple[int, Any]] = []
        entries = sorted(o.get("teachers") or [], key=lambda t: (t.get("id") is None, t.get("id") or 0))
        for t in entries:
            wl_tid = t.get("teacher_id")
            if wl_tid is None:
                continue
            tid = teacher_map.get(wl_tid)
            if tid is None:
                skip("option_teacher", t.get("id"), f"{where}: ครูรหัส {wl_tid} ของเว็บยังไม่มีในโปรแกรมจัดตาราง "
                                                    "(ติดเหตุของทะเบียนครู) จึงไม่ได้ใส่เป็นครูของตัวเลือก")
                continue
            if all(tid != have for have, _room in out):
                out.append((tid, t.get("room_id")))
        return out

    pools: list[dict[str, Any]] = []
    activity_sets: list[dict[str, Any]] = []
    merged: list[dict[str, Any]] = []       # ตัวเลือก (วิชา, ครู) ที่ซ้ำกับตัวที่มีแล้วในชุดเดียว → รวม (บันทึกไว้ ไม่หายเงียบ)
    # (ห้อง, วิชา) ของชุดคาบเสรี/ชุดกิจกรรม → {"kind": ชนิดของชุดแรกที่ครอบ, "teachers": ครูของตัวเลือกวิชานั้นทุกชุดที่ครอบห้องนั้น}
    cell_teachers: dict[tuple, dict[str, Any]] = {}
    shares = shares_students(group_by_id)

    def cover(kind: str, gids: list[Any], sid: int, teachers: list[tuple[int, Any]]) -> None:
        if kind == "elective":
            # คาบเสรีของห้องแม่สอนแทนแถวของห้องย่อย (และกลับกัน) — ขั้นที่ 2 ข้ามแถวเหล่านั้นด้วย _reqs_served_by_elective ซึ่งใช้ shares
            # ถ้าครอบแค่ห้องในชุดตรง ๆ แถวของ ม.6/9ก ที่เรียนวิชาเสรีในคาบเสรีของ ม.6/9 หายจากเทอมใหม่เงียบ ๆ (รอบแก้ 1 ของทาง ข.)
            # · กิจกรรมทั้งระดับไม่ต้อง: ขั้นที่ 2 ข้ามเฉพาะห้อง+วิชาที่มีช่องกิจกรรมของห้องนั้นเอง (block_cells)
            gids = list(gids) + [g for g in group_by_id if g not in gids and any(shares(g, h) for h in gids)]
        for gid in gids:
            have = cell_teachers.setdefault((gid, sid), {"kind": kind, "teachers": []})["teachers"]
            have += [t for t, _room in teachers if t not in have]

    for st in source.get("sets") or []:
        where = f"ชุด {st.get('name') or ''}".rstrip()
        gids = list(st.get("group_ids") or [])
        if st.get("kind") == "activity":
            tids: list[int] = []
            for o in options_of.get(st.get("id"), []):
                teachers = option_teachers(o, where)
                tids += [t for t, _room in teachers if t not in tids]
                sid = subject_of(o.get("subject_id"), o.get("code"))
                if sid is None:
                    skip("option", o.get("id"), f"{where}: วิชา {_code_key(o.get('code')) or o.get('name') or ''} "
                                                "ยังไม่มีในโปรแกรมจัดตาราง (ติดเหตุของทะเบียนวิชา) จึงไม่ได้ใส่แถวแผนของกิจกรรม")
                    continue
                cover("activity", gids, sid, teachers)
            activity_sets.append({"name": str(st.get("name") or ""), "group_ids": gids,
                                  "weekly": int(st.get("weekly") or 0), "teacher_ids": tids})
            continue
        if st.get("kind") != "elective":
            continue
        pool: dict[str, Any] = {"id": _next_id(counters, "elective_pool"), "name": str(st.get("name") or "คาบเสรีใหม่"),
                                "raw_group": "", "group_ids": gids, "weekly": int(st.get("weekly") or 0),
                                "is_double": bool(st.get("is_double")), "day": None, "period": None, "options": []}
        for o in options_of.get(st.get("id"), []):
            sid = subject_of(o.get("subject_id"), o.get("code"))
            if sid is None:
                skip("option", o.get("id"), f"{where}: วิชา {_code_key(o.get('code')) or o.get('name') or ''} "
                                            "ยังไม่มีในโปรแกรมจัดตาราง (ติดเหตุของทะเบียนวิชา) จึงไม่ได้ใส่เป็นตัวเลือก")
                continue
            subj = subj_by_id.get(sid) or {}
            teachers = option_teachers(o, where)
            for tid, room in teachers or [(None, None)]:
                if any(x["subject_id"] == sid and x["teacher_id"] == tid for x in pool["options"]):
                    # โปรแกรมเก็บตัวเลือกละ (วิชา, ครู) อยู่แล้ว (_clean_pool_options ตัดแบบเดียวกัน) รวมแล้วไม่เสียอะไร
                    merged.append({"set": pool["name"], "option_id": o.get("id"), "subject_id": sid, "teacher_id": tid})
                    continue
                pool["options"].append({"key": _next_id(counters, "elective_option"), "subject_id": sid,
                                        "teacher_id": tid, "label": subj.get("name") or o.get("name") or "",
                                        "code": subj.get("code") or o.get("code"), "room_id": room})
            cover("elective", gids, sid, teachers)
        pools.append(pool)

    # ── แถวแผนของวิชาในชุดคาบเสรี/ชุดกิจกรรม: ตามรูปของแผนเดิม ─────────────────────
    # ขั้นที่ 2 ข้ามแถวแผนที่คาบเสรีสอนแทน (served) และแถวที่กิจกรรมทั้งระดับครอบไว้ (block_cells) แล้วยกเป็นชุด
    # ยอดคาบรายครูของโปรแกรมนับจากแถวแผนเท่านั้น — ไม่เขียนกลับ ยอดของครูวิชาเสรี/ครูที่คุมกิจกรรมหาย (แนะแนว: ครู 141 20 → 8)
    # ชุดกิจกรรมยังต้องลงคาบเอง (report.activity_sets) — เมื่อลงแล้ว ตารางนับช่องกิจกรรมว่าลงแถวแผนนั้นแล้ว เหมือนเทอมเดิม
    elective_rows = activity_rows = 0
    pattern_rows: list[dict[str, Any]] = []     # รายการของแถวเหล่านี้ให้สรุปก่อนสร้างแสดง (แบบข้อ 4.2 — รีวิวทั้งสาขา M3)
    for (gid, sid), cell in cell_teachers.items():
        if (gid, sid) in round_cells or gid not in group_by_id:
            continue    # รอบมีแถวของห้อง+วิชานี้อยู่แล้ว (เขียนอีกแถวคือสอนซ้ำ) · ห้องที่ไม่มีแล้วไม่มีแถวเดิมให้ตาม
        teachers, kind = cell["teachers"], cell["kind"]
        for old in old_by_cell.get((gid, sid), []):
            if not teachers:
                skip(f"{kind}_row", old.get("id"), f"แถวแผนเดิม {gname(gid)} วิชารหัส {sid}: ตัวเลือกของวิชานี้ใน"
                                                    f"{'ชุดคาบเสรี' if kind == 'elective' else 'ชุดกิจกรรม'}ยังไม่มีครูใน"
                                                    "โปรแกรมจัดตาราง จึงไม่ได้ใส่ในแผน")
                continue
            tid = old.get("teacher_id") if old.get("teacher_id") in teachers else teachers[0]
            co = old.get("co_teacher_id")
            requirements.append({
                "id": _next_id(counters, "requirement"), "group_id": gid, "subject_id": sid, "teacher_id": tid,
                "weekly_count": old.get("weekly_count"), "parallel_group_key": None,
                "co_teacher_id": co if co in teachers and co != tid else None, "room_id": old.get("room_id")})
            pattern_rows.append({"kind": kind, "group_id": gid, "subject_id": sid, "teacher_id": tid,
                                 "weekly_count": old.get("weekly_count")})
            if kind == "elective":
                elective_rows += 1
            else:
                activity_rows += 1

    # ── ยกช่องที่เว็บไม่มีจากแผนเดิม ด้วยก้อน (ห้อง, วิชา) ทีละช่อง ─────────────────
    carried = 0
    not_carried: list[dict[str, Any]] = []
    new_cells: list[dict[str, Any]] = []
    for row in requirements:
        block = old_by_cell.get((row["group_id"], row["subject_id"]))
        if not block:
            # ห้อง+วิชาที่ไม่มีในแผนเดิม: ไม่มีอะไรให้ยก ช่องที่เว็บไม่มีจึงว่าง — นับไว้บอกในสรุป (แบบข้อ 4.2) ละห้อง+วิชา
            cell = {"group_id": row["group_id"], "subject_id": row["subject_id"]}
            if cell not in new_cells:
                new_cells.append(cell)
            continue
        got, lost = False, []
        for k in CARRY_KEYS:
            # เซ็ตห้องย่อย: แบบนำเข้าของโปรแกรมใส่ "" หน้าแก้แถวใส่ null — โปรแกรมดูแค่ว่ามีค่าหรือไม่ จึงเป็นค่าเดียวกัน
            seen = {bool(r.get(k)) if k == "pinned_double" else (r.get(k) or None) if k == "parallel_group_key"
                    else r.get(k) for r in block}
            if len(seen) != 1:
                lost.append(k)
                continue
            v = seen.pop()
            if k == "parallel_group_key":
                row[k] = v
            elif k == "pinned_double":
                if v:
                    row[k] = True
            elif v is not None:
                row[k] = v
            got = got or (bool(v) if k == "pinned_double" else v is not None)    # วันจันทร์คือ pinned_day 0
        carried += got
        miss = {"group_id": row["group_id"], "subject_id": row["subject_id"], "fields": lost}
        if lost and miss not in not_carried:    # รายการละห้อง+วิชา แม้ก้อนนั้นได้สองแถว (สอนร่วมสองแถว)
            not_carried.append(miss)

    # ── หลักสูตร ────────────────────────────────────────────────────────────
    curricula: list[dict[str, Any]] = []
    group_curricula: dict[Any, int | None] = {gid: None for gid in group_by_id}
    for c in source.get("curricula") or []:
        rows_in = []
        for ln in c.get("lines") or []:
            sid = subject_of(ln.get("subject_id"), ln.get("code"))
            if sid is None:
                skip("line", ln.get("id"), f"หลักสูตร {c.get('name') or ''}: วิชา {_code_key(ln.get('code'))} ยังไม่มีใน"
                                           "โปรแกรมจัดตาราง (ติดเหตุของทะเบียนวิชา) จึงไม่ได้ใส่ในหลักสูตร")
                continue
            rows_in.append({"subject_id": sid, "weekly_count": int(ln.get("weekly") or 0)})
        cid = _next_id(counters, "curriculum")
        curricula.append({"id": cid, "name": str(c.get("name") or ""), "rows": rows_in})
        for gid in c.get("group_ids") or []:
            if gid in group_curricula and group_curricula[gid] is None:
                group_curricula[gid] = cid
    # ทุกแถวแผนที่เขียนต้องผ่าน check_row ของหลักสูตรที่ผูกกับห้องนั้น (แบบข้อทดสอบ 9: แก้ผ่านหน้าเดิมได้โดยไม่ถูกปฏิเสธ
    # เรื่องหลักสูตร) — แถวแผนของวิชาเสรีไม่มีบรรทัดหลักสูตร เพราะขั้นที่ 2 ข้ามแถวที่คาบเสรีสอนแทน ถ้าไม่เพิ่ม แก้คาบ/ย้ายแถว
    # เหล่านั้นภายหลังได้ 400 "ไม่มีวิชา … เพิ่มวิชานี้ลงในหลักสูตรก่อน" · วิชาที่ขาดหรือคาบน้อยกว่าแถว (รวมบรรทัดคาบ 0)
    # → เพิ่ม (วิชา, คาบของแถว) แล้ว normalise_rows เก็บค่ามากสุด · หลักสูตรที่หลายห้องใช้ร่วมจึงอนุญาตวิชานั้นให้ทุกห้องของมัน
    # · ห้องที่ไม่มีหลักสูตรไม่ถูกตรวจอยู่แล้ว · แถว 0 คาบไม่สอนอะไร ไม่เพิ่ม (บรรทัด 0 คาบแปลว่า "ห้องนี้ไม่เรียนวิชานี้")
    by_cid = {c["id"]: c for c in curricula}
    added: dict[tuple, dict[str, Any]] = {}
    for row in requirements:
        cid, sid, n = group_curricula.get(row["group_id"]), row["subject_id"], int(row["weekly_count"] or 0)
        if cid is None or n <= 0:
            continue
        cur_rows = by_cid[cid]["rows"]
        if max((x["weekly_count"] for x in cur_rows if x["subject_id"] == sid), default=-1) >= n:
            continue
        cur_rows.append({"subject_id": sid, "weekly_count": n})
        entry = added.setdefault((cid, sid), {"curriculum_id": cid, "subject_id": sid, "weekly_count": n})
        entry["weekly_count"] = max(entry["weekly_count"], n)
    for c in curricula:
        c["rows"] = _curriculum.normalise_rows(c["rows"])

    teachers_in_plan = {t for r in requirements for t in (r["teacher_id"], r["co_teacher_id"]) if t}
    report = {"rows": len(requirements), "periods": sum(int(r["weekly_count"] or 0) for r in requirements),
              "teachers_in_plan": len(teachers_in_plan), "pools": len(pools),
              "pool_options": sum(len(p["options"]) for p in pools), "activity_sets": activity_sets,
              "carried": carried, "not_carried": not_carried, "new_cells": new_cells, "elective_rows": elective_rows,
              "activity_rows": activity_rows, "pattern_rows": pattern_rows,
              "curriculum_rows_added": list(added.values()), "merged_options": merged, "skipped": skipped}
    return {"requirements": requirements, "pools": pools, "curricula": curricula, "group_curricula": group_curricula,
            "elective_subjects": sorted({o["subject_id"] for p in pools for o in p["options"]}),
            "counters": counters, "report": report}
