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
outgoing = ของเทอมที่กำลังปิด (teachers subjects = สำเนาของ TEACHERS SUBJECTS) · counters = สำเนาของ _counters
"""
from __future__ import annotations

import copy
from typing import Any, Callable

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


def _first_credits(source: dict[str, Any]) -> dict[Any, Any]:
    """หน่วยกิตของวิชาใหม่ = บรรทัดแรกที่อ้างถึงวิชานั้น ตามลำดับหลักสูตรแล้วบรรทัด (แม้บรรทัดนั้นหน่วยกิตว่าง)"""
    out: dict[Any, Any] = {}
    for c in source.get("curricula") or []:
        for ln in c.get("lines") or []:
            if ln.get("subject_id") is not None:
                out.setdefault(ln["subject_id"], ln.get("credits"))
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
    credits_of = _first_credits(source)
    subject_map: dict[Any, int] = {}
    typed_map: dict[str, int] = {}
    linked: set[int] = set()        # วิชาของโปรแกรมที่มีวิชาของเว็บผูกอยู่ (หรือผูกในรอบนี้)

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
    for g in typed_new:
        values = {"code": g["code"], "name": g["name"], "department_id": g["department_id"],
                  "is_activity": False, "is_elective": False}
        sid = place(None, g["name"], values, ("code", "name", "department_id"), g["credits"])
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
