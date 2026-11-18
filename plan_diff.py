# -*- coding: utf-8 -*-
"""อัปเดตแผนกลางเทอมจากรอบอัตรากำลัง (ทาง ข.) — เครื่องเทียบรอบกับแผนสดเป็นกอง และเครื่องใส่เฉพาะข้อที่ติ๊ก (ฟังก์ชันล้วน)

ระหว่างภาคเรียน ฝ่ายวิชาการแก้อัตรากำลังในเว็บลงอัตรากำลัง แล้วกด "อัปเดตแผนจากรอบอัตรากำลัง" ในโปรแกรมจัดตาราง: เห็นสิ่งที่ต่าง
แยกเป็นกอง ติ๊กยอมรับทีละข้อ แผนเปลี่ยนเฉพาะที่ติ๊ก และได้รายการงานที่ต้องไปแก้เอง (แบบ
docs/superpowers/specs/2026-11-18-workload-midterm-update-design.md ข้อ 4.2 · สัญญาร่วมของแผน: รูปข้อ item และข้องาน todo)

กติกาของโมดูลนี้ — ห้ามละเมิด:
  - **ห้าม import mock_api และห้ามแตะตัวแปรของโปรแกรม** (แบบ term_from_round) ผู้เรียกส่งสำเนาเข้ามา ได้สถานะใหม่เป็นสำเนากลับไป
    ผลของ wl_round_proposal (อยู่ใน mock_api) ผู้เรียกเตรียมมาเป็น live_proposal · กฎพับคู่สอนร่วม (_fold_coteaching) เขียนในรูปที่คืนคู่ด้วย
    (_fold) แล้ว tests/py/wlmidtermdiff.py เทียบกับตัวจริงบนแผนจริง · กฎ is_elective ของวิชาในชุด (keep_set_electives) และ
    "ห้องสองห้องมีนักเรียนชุดเดียวกัน" (shares_students) ใช้ตัวใน term_from_round ที่เดียวกับทาง ก. — ส่งฟังก์ชันเข้ามาเป็นพารามิเตอร์จะเปลี่ยน signature ของแผน
  - **ผลของ plan_apply ไม่มีคีย์ slots / parked** — คาบที่ลงไว้แล้วไม่ถูกแตะไม่ว่าติ๊กข้อใด (ข้อห้ามของผู้ใช้: ห้ามมีโค้ดใหม่ที่เขียน SLOTS)
    อ่าน live["slots"] เพื่อนับคาบที่ลงไว้เท่านั้น
  - ไม่แก้สิ่งที่ส่งเข้ามา และผลไม่แชร์ dict กับสิ่งที่ส่งเข้ามา (รวมหน้าเทียบ diff) · ไม่ติ๊กเลย = ผลเท่าของสดทุกตัว
  - **หน้าเทียบที่ admin เห็น = สิ่งที่ถูกเขียน**: plan_apply ใส่จากข้อมูลในข้อ (item["apply"]) เท่านั้น ไม่คำนวณใหม่ และ token คลุมทั้งข้อ
    ผู้เรียก (Task 4) คำนวณ plan_diff ใหม่ในธุรกรรม เทียบ token กับที่ admin เห็น แล้วใส่ด้วยหน้าเทียบที่คำนวณใหม่นั้น

กอง (pile) ตามแบบข้อ 4.2: registry (ข้อมูลครู/วิชา) · new (แถวใหม่) · weekly (คาบเปลี่ยน) · teacher (เปลี่ยนครู/ครูสอนร่วม/ห้องปฏิบัติการ) ·
removed (แถวที่หายไป) · sets (คาบเสรี/กิจกรรม) — ข้อ "ไม่อยู่ในรอบ" (unknown) และ "จับคู่ชุดไม่ได้" (unmatched_sets) ไม่ใช่ข้อ ไม่ทำอะไร
"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any, Callable, Iterable

import curriculum as _curriculum        # normalise_rows (ตรรกะล้วน) — กฎหลักสูตรของแถวที่เขียนแบบทาง ก.
import term_from_round as _tfr          # registry_plan · plan_from_round (ทาง ก.) — "แผนที่รอบต้องการ" · keep_set_electives · shares_students

TEACHER_FIELDS = ("teacher_id", "co_teacher_id", "room_id")   # ช่องที่ข้อ "เปลี่ยนครู" และข้องานชนิด teacher ครอบ
PILES = ("registry", "new", "weekly", "teacher", "removed", "sets")
_PILE_ORDER = {p: i for i, p in enumerate(PILES)}
_WRITEBACK_KEYS = ("teachers", "subjects", "new_wl_subjects", "bind_wl_subjects")
_SET_KIND_TEXT = {"elective": "คาบเสรี", "activity": "กิจกรรม"}
_FIELD_TEXT = {"name": "ชื่อ", "code": "รหัส", "department_id": "กลุ่มสาระ", "dept_order": "ลำดับในกลุ่มสาระ",
               "type": "ประเภท", "duration": "จำนวนคาบต่อครั้ง", "is_activity": "เป็นกิจกรรม", "is_elective": "เป็นวิชาเสรี"}


# ── กฎพับคู่สอนร่วมของ mock_api ในรูปที่คืนคู่ (ตัวทดสอบเทียบกับตัวจริง) ───────────────────────────
def _fold(rows: list[dict[str, Any]]) -> tuple[set[Any], dict[Any, dict[str, Any]]]:
    """กฎเดียวกับ mock_api._fold_coteaching ทุกข้อ (สองแถวของห้อง+วิชาเดียวกันที่แถวหนึ่งชี้ครูของอีกแถว = บทเรียนเดียว
    เก็บแถวแรก · None == None เป็นจริงเหมือนตัวจริง) แต่คืนคู่ของแต่ละแถวที่เหลือด้วย — ตัวจริงคืนแค่จำนวนคาบที่ตกลงกัน
    และเครื่องใส่ต้องรู้ว่าแถวไหนคู่กับแถวไหน → (รหัสแถวที่สองของคู่, {รหัสแถวที่เหลือ: แถวที่สอง})"""
    by_cell: dict[tuple, list[dict[str, Any]]] = {}
    for r in rows:
        by_cell.setdefault((r.get("group_id"), r.get("subject_id")), []).append(r)
    folded: set[Any] = set()
    partner: dict[Any, dict[str, Any]] = {}
    for cell in by_cell.values():
        for i, a in enumerate(cell):
            if a["id"] in folded:
                continue
            for b in cell[i + 1:]:
                if b["id"] in folded:
                    continue
                if a.get("co_teacher_id") == b.get("teacher_id") or b.get("co_teacher_id") == a.get("teacher_id"):
                    folded.add(b["id"])
                    partner[a["id"]] = b
                    break
    return folded, partner


# ── ตัวช่วยทั่วไป ──────────────────────────────────────────────────────────
def _next_id(counters: dict[str, int], key: str) -> int:
    """รหัสใหม่แบบ _next ของโปรแกรม (ตัวนับ + 1)"""
    counters[key] = counters.get(key, 0) + 1
    return counters[key]


def _cid(v: Any) -> int | None:
    """curriculum_id ที่เก็บบนห้อง อ่านแบบเดียวกับ curriculum._id (ตัวเลขหรือข้อความ · 0/"" = ไม่มี)"""
    try:
        return int(v) or None
    except (TypeError, ValueError, OverflowError):
        return None


def _groups_of(live: dict[str, Any]) -> dict[Any, dict[str, Any]]:
    groups = live.get("groups") or {}
    return dict(groups) if isinstance(groups, dict) else {g.get("id"): g for g in groups}


def _w(r: dict[str, Any]) -> int:
    try:
        return int(r.get("weekly_count") or 0)
    except (TypeError, ValueError):
        return 0


def _placed_of(slots: list[dict[str, Any]]) -> dict[tuple, int]:
    """คาบที่ลงไว้ของ (ห้อง, วิชา) — กฎเดียวกับ placed_of ของ _unplaced_report: คาบที่มีวิชาและไม่ใช่คาบกรอบแดง (is_overflow)"""
    out: dict[tuple, int] = {}
    for s in slots:
        if s.get("subject_id") is not None and not s.get("is_overflow"):
            cell = (s.get("group_id"), s.get("subject_id"))
            out[cell] = out.get(cell, 0) + 1
    return out


class _Names:
    """ชื่อที่ผู้ใช้อ่านในข้อความไทย — ห้องเรียนและห้องปฏิบัติการจากของสด · ครู/วิชาจากทะเบียนหลังซิงก์ (รวมรายการที่จะสร้าง)
    rooms = live["rooms"] (ROOMS ของโปรแกรม — ผู้เรียกใส่ให้) · ไม่มี = ข้อความรหัสแบบเดิม (Task 4 addendum ข้อ 5: ข้อ/ข้องานต้องบอกชื่อห้องจริง)"""

    def __init__(self, groups: dict[Any, dict[str, Any]], teachers: list[dict[str, Any]],
                 subjects: list[dict[str, Any]], rooms: Iterable[dict[str, Any]] | None = None) -> None:
        self.groups = groups
        self.order = {g: i for i, g in enumerate(groups)}
        self.teachers = {t.get("id"): t for t in teachers}
        self.subjects = {s.get("id"): s for s in subjects}
        self.rooms = {r.get("id"): r for r in rooms or ()}

    def g(self, gid: Any) -> str:
        return str((self.groups.get(gid) or {}).get("name") or f"ห้องรหัส {gid}")

    def s(self, sid: Any) -> str:
        subj = self.subjects.get(sid)
        if not subj:
            return f"วิชารหัส {sid}"
        return " ".join(str(x) for x in (subj.get("code"), subj.get("name")) if x) or f"วิชารหัส {sid}"

    def t(self, tid: Any) -> str:
        if not tid:
            return "ยังไม่มีครู"
        return str((self.teachers.get(tid) or {}).get("name") or f"ครูรหัส {tid}")

    def room(self, rid: Any) -> str:
        if rid is None:
            return "ไม่ระบุห้อง"
        return str((self.rooms.get(rid) or {}).get("name") or f"ห้องรหัส {rid}")

    def rng(self, gids: list[Any]) -> str:
        names = [self.g(g) for g in gids]
        if not names:
            return "(ยังไม่เลือกห้อง)"
        return names[0] if len(names) == 1 else f"{names[0]}–{names[-1]} ({len(names)} ห้อง)"

    def gkey(self, gid: Any) -> tuple:
        return (self.order.get(gid, len(self.order)), str(gid))


def _item(key: str, pile: str, label: str, *, auto: bool = True, placed: int = 0, effect: str | None = None,
          requires: Iterable[str] = (), apply: dict[str, Any] | None = None, **fields: Any) -> dict[str, Any]:
    """ข้อของหน้าเทียบตามสัญญาร่วม + apply (สิ่งที่เครื่องใส่จะเขียนเมื่อติ๊ก — token คลุมด้วย หน้าเทียบจึงเท่ากับสิ่งที่ถูกเขียน)"""
    out = {"key": key, "pile": pile, "label": label, **fields, "placed": int(placed), "effect": effect,
           "requires": sorted(set(requires)), "auto": bool(auto), "apply": apply or {}}
    return out


def diff_token(items: list[dict[str, Any]]) -> str:
    """ลายนิ้วมือของหน้าเทียบ = sha256 ของรายการข้อแบบเรียงคีย์ (เรียงข้อตาม key และเรียงคีย์ใน dict) — ลำดับไม่มีผล
    ข้อไม่มีรหัสที่มาจากตัวนับของแผนที่รอบต้องการ ตัวนับที่ขยับเพราะคำขออื่นจึงไม่ทำให้หน้าเทียบเก่าเปล่า ๆ"""
    blob = json.dumps(sorted(items, key=lambda i: str(i.get("key"))), sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ── กองทะเบียน ─────────────────────────────────────────────────────────────
def _registry_items(reg: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[tuple, str]]:
    """ข้อทะเบียนจากผลของ registry_plan (กฎทาง ก. ข้อ 4.3: สร้าง/แก้ช่องตัวตน/ผูกด้วยรหัส · ไม่ลบ)
    → (ข้อ, {("t"|"s", รหัสของโปรแกรมที่จะสร้าง): key}) — ข้ออื่นที่อ้างรายการที่จะสร้างต้อง requires ข้อนั้น"""
    rep, wb = reg["report"], reg["writeback"]
    t_rows = {t["id"]: t for t in reg["teachers"]}
    s_rows = {s["id"]: s for s in reg["subjects"]}
    wb_t = {w["id"]: w for w in wb["teachers"]}
    wb_s = {w["id"]: w for w in wb["subjects"]}
    items: list[dict[str, Any]] = []
    created: dict[tuple, str] = {}

    def code(x: dict[str, Any]) -> str:
        return f" ({x['code']})" if x.get("code") else ""

    def changes(p: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]]:
        ch = (p or {}).get("changes") or {}
        return {f: v[0] for f, v in ch.items()}, {f: v[1] for f, v in ch.items()}

    def what(after: dict[str, Any]) -> str:
        return " · ".join(_FIELD_TEXT.get(f, f) for f in after)

    for c in rep["teachers_created"]:
        row, key = t_rows[c["id"]], f"registry:teacher:{c['wl_id']}"
        created[("t", c["id"])] = key
        items.append(_item(key, "registry", f"สร้างครู {row.get('name')}{code(row)} ในโปรแกรมจัดตาราง",
                           after={k: row.get(k) for k in _tfr.TEACHER_OWNED},
                           apply={"op": "teacher_create", "row": copy.deepcopy(row),
                                  "writeback": {"teachers": [copy.deepcopy(wb_t[c["wl_id"]])]}}))
    for p in rep["teachers_patched"]:
        before, after = changes(p)
        items.append(_item(f"registry:teacher-edit:{p['wl_id']}", "registry",
                           f"แก้ข้อมูลครู {p.get('name')} ตามทะเบียนของเว็บ: {what(after)}", before=before, after=after,
                           apply={"op": "teacher_edit", "id": p["id"], "set": copy.deepcopy(after)}))

    linked = {x["wl_id"] for x in rep["code_links"] if x.get("wl_id") is not None}
    patch_wl = {p["wl_id"]: p for p in rep["subjects_patched"] if p.get("wl_id") is not None}
    patch_typed = {p["id"]: p for p in rep["subjects_patched"] if p.get("wl_id") is None}
    made_typed = {c["id"] for c in rep["subjects_created"] if c.get("wl_id") is None}
    for c in rep["subjects_created"]:
        if c.get("wl_id") is None:
            continue
        row, key = s_rows[c["id"]], f"registry:subject:{c['wl_id']}"
        created[("s", c["id"])] = key
        items.append(_item(key, "registry", f"สร้างวิชา {row.get('code') or ''} {row.get('name') or ''} ในโปรแกรมจัดตาราง",
                           after={k: row.get(k) for k in _tfr.SUBJECT_OWNED},
                           apply={"op": "subject_create", "row": copy.deepcopy(row),
                                  "writeback": {"subjects": [copy.deepcopy(wb_s[c["wl_id"]])]}}))
    for x in rep["code_links"]:
        if x.get("wl_id") is None:
            continue
        before, after = changes(patch_wl.get(x["wl_id"]))
        items.append(_item(f"registry:subject:{x['wl_id']}", "registry",
                           f"ผูกวิชา {x.get('code') or ''} {x.get('name') or ''} ของเว็บกับวิชาในโปรแกรมด้วยรหัสวิชา"
                           + (f" แล้วแก้ {what(after)}" if after else ""), before=before, after=after,
                           apply={"op": "subject_edit", "id": x["id"], "set": copy.deepcopy(after),
                                  "writeback": {"subjects": [copy.deepcopy(wb_s[x["wl_id"]])]}}))
    for p in rep["subjects_patched"]:
        if p.get("wl_id") is None or p["wl_id"] in linked:
            continue
        before, after = changes(p)
        items.append(_item(f"registry:subject-edit:{p['wl_id']}", "registry",
                           f"แก้ข้อมูลวิชา {p.get('code') or ''} {p.get('name') or ''} ตามทะเบียนของเว็บ: {what(after)}",
                           before=before, after=after, apply={"op": "subject_edit", "id": p["id"],
                                                              "set": copy.deepcopy(after)}))
    # บรรทัด/ตัวเลือกที่พิมพ์รหัสเอง: สร้างวิชาในโปรแกรม (หรือผูกด้วยรหัส) + แถวใหม่ในทะเบียนของเว็บ และผูกบรรทัดเหล่านั้น
    for n in wb["new_wl_subjects"]:
        sid, key = n["sched_id"], f"registry:typed:{n['code']}"
        wb_n = {"new_wl_subjects": [copy.deepcopy(n)]}
        if sid in made_typed:
            created[("s", sid)] = key
            items.append(_item(key, "registry", f"สร้างวิชา {n['code']} {n.get('name') or ''} ที่พิมพ์รหัสไว้ในรอบ "
                                                "(ทั้งในโปรแกรมและในทะเบียนของเว็บ)",
                               after={k: n.get(k) for k in _tfr.SUBJECT_OWNED},
                               apply={"op": "subject_create", "row": copy.deepcopy(s_rows[sid]), "writeback": wb_n}))
        else:
            before, after = changes(patch_typed.get(sid))
            items.append(_item(key, "registry", f"วิชา {n['code']} ที่พิมพ์รหัสไว้ในรอบ ผูกกับวิชาในโปรแกรมด้วยรหัสวิชา "
                                                "แล้วเพิ่มในทะเบียนของเว็บ" + (f" · แก้ {what(after)}" if after else ""),
                               before=before, after=after,
                               apply={"op": "subject_edit", "id": sid, "set": copy.deepcopy(after), "writeback": wb_n}))
    for b in wb["bind_wl_subjects"]:
        items.append(_item(f"registry:bind:{b['code']}", "registry",
                           f"ผูกรหัสวิชา {b['code']} ที่พิมพ์ไว้ในหลักสูตร/คาบเสรีกับวิชารหัสเดียวกันในทะเบียนของเว็บ",
                           apply={"op": "bind", "writeback": {"bind_wl_subjects": [copy.deepcopy(b)]}}))
    return items, created


def _requires(created: dict[tuple, str], teachers: Iterable[Any], subjects: Iterable[Any]) -> set[str]:
    out = {created[("t", t)] for t in teachers if ("t", t) in created}
    return out | {created[("s", s)] for s in subjects if ("s", s) in created}


# ── แถวแผน: เทียบเป็นก้อน (ห้อง, วิชา) หลังพับคู่สอนร่วม ─────────────────────────────────
def _lessons(rows: list[dict[str, Any]]) -> dict[tuple, list[dict[str, Any]]]:
    """{(ห้อง, วิชา): [บทเรียน]} ตามลำดับแผน · บทเรียน = แถวที่เหลือหลังพับ (+ แถวคู่)
    t = (ครูผู้สอน, ครูสอนร่วม, ห้องปฏิบัติการ) แบบที่รอบเห็น (wl_round_proposal: คู่ที่ชี้กัน → ครูสอนร่วม = ครูของแถวคู่ ·
    ห้อง = ห้องของแถวแรก ไม่มีก็ของแถวคู่) · w = คาบของแต่ละแถวตามลำดับ (คู่คาบไม่เท่ากันต่างกันได้ที่แถวที่สอง)"""
    folded, partner = _fold(rows)
    out: dict[tuple, list[dict[str, Any]]] = {}
    for r in rows:
        if r["id"] in folded:
            continue
        b = partner.get(r["id"])
        members = [r] + ([b] if b is not None else [])
        co = (b.get("teacher_id") if b is not None else r.get("co_teacher_id")) or None
        room = r.get("room_id") or (b.get("room_id") if b is not None else None) or None
        out.setdefault((r.get("group_id"), r.get("subject_id")), []).append(
            {"rows": members, "t": (r.get("teacher_id") or None, co, room), "w": tuple(_w(x) for x in members)})
    return out


def _match(live: list[dict[str, Any]], want: list[dict[str, Any]]) -> tuple[list[tuple], list[dict], list[dict]]:
    """จับบทเรียนของก้อนเดียวกัน: เหมือนทุกอย่าง → ครู/ห้องเหมือน → ครูผู้สอนคนเดียวกัน → ตามลำดับ
    → (คู่, บทเรียนสดที่เหลือ = แถวที่หายไป, บทเรียนของรอบที่เหลือ = แถวใหม่)"""
    left_l, left_d = list(range(len(live))), list(range(len(want)))
    pairs: list[tuple] = []
    rules = (lambda l, d: l["t"] == d["t"] and l["w"] == d["w"], lambda l, d: l["t"] == d["t"],
             lambda l, d: l["t"][0] == d["t"][0], lambda l, d: True)
    for same in rules:
        for i in list(left_l):
            j = next((j for j in left_d if same(live[i], want[j])), None)
            if j is not None:
                pairs.append((live[i], want[j]))
                left_l.remove(i)
                left_d.remove(j)
    return pairs, [live[i] for i in left_l], [want[j] for j in left_d]


def _weekly_changed(l: dict[str, Any], d: dict[str, Any]) -> bool:
    # รูปเดียวกัน (แถวเดียว/คู่) เทียบคาบทีละแถว · รูปต่างกันเทียบคาบที่ตกลงกัน (คาบมากสุด แบบ _fold_coteaching)
    return l["w"] != d["w"] if len(l["w"]) == len(d["w"]) else max(l["w"]) != max(d["w"])


def _row_out(r: dict[str, Any]) -> dict[str, Any]:
    """แถวของแผนที่รอบต้องการ ไม่เอารหัส (รหัสออกตอนใส่จากตัวนับของโปรแกรม — token จึงไม่ขึ้นกับตัวนับ)"""
    return {k: copy.deepcopy(v) for k, v in r.items() if k != "id"}


def _round_cell(r: dict[str, Any], lines: dict[Any, dict[str, Any]], reg: dict[str, Any]) -> tuple | None:
    """(ห้อง, วิชาของโปรแกรม) ของแถวของรอบ — แบบเดียวกับที่ plan_from_round คิด round_cells: วิชาของแถว ไม่มีก็ของบรรทัด
    ผ่าน subject_map · บรรทัดที่พิมพ์รหัสเองผ่าน typed_map · หาวิชาไม่ได้ → None"""
    line = lines.get(r.get("line_id")) or {}
    wl_sid = r.get("subject_id") if r.get("subject_id") is not None else line.get("subject_id")
    code = line.get("code") if line else r.get("code")
    sid = reg["subject_map"].get(wl_sid) if wl_sid is not None else reg["typed_map"].get(str(code or "").strip())
    return (r.get("group_id"), sid) if sid is not None else None


def _round_lines(source: dict[str, Any]) -> dict[Any, dict[str, Any]]:
    return {ln.get("id"): ln for c in source.get("curricula") or [] for ln in c.get("lines") or []}


def _unknown_cells(source: dict[str, Any], live: dict[str, Any], live_proposal: dict[str, Any],
                   desired: dict[str, Any], reg: dict[str, Any]) -> dict[tuple, str]:
    """ห้อง+วิชาของแผนสดที่รอบไม่รู้จัก → เหตุ (แบบข้อ 4.2 "แถวที่รอบรู้จัก"):
    - แถวใดของก้อนอยู่ใน unconverted ของ wl_round_proposal ของของสดตอนนี้ (ไม่ใช้ unconverted ที่เก็บไว้ในรอบ)
    - ห้องไม่อยู่ในหลักสูตรของภาคเรียนในรอบ
    - แถวของรอบของห้อง+วิชานั้นที่ plan_from_round ใส่ไม่ได้ (report.skipped) — ไม่งั้นแถวสดจะขึ้นเป็น "แถวที่หายไป" ทั้งที่รอบมีแถวนั้น
    ก้อนเหล่านี้ไม่ถูกเทียบเลย (ไม่เสนอลบ ไม่เสนอแก้จากช่องที่รอบแปลงไม่ได้)"""
    why_ref: dict[Any, str] = {}
    for u in live_proposal.get("unconverted") or []:
        if u.get("source") == "plan":
            why_ref.setdefault(u.get("ref"), str(u.get("reason") or ""))
    in_round = {g for c in source.get("curricula") or [] for g in c.get("group_ids") or []}
    out: dict[tuple, str] = {}
    by_cell: dict[tuple, list[dict[str, Any]]] = {}
    for r in live.get("requirements") or []:
        by_cell.setdefault((r.get("group_id"), r.get("subject_id")), []).append(r)
    for cell, rows in by_cell.items():
        bad = next((why_ref[r.get("id")] for r in rows if r.get("id") in why_ref), None)
        if bad is not None:
            out[cell] = f"รอบแปลงแถวนี้ไม่ได้ — {bad}"
        elif cell[0] not in in_round:
            out[cell] = "ห้องนี้ไม่อยู่ในหลักสูตรของภาคเรียนในรอบ"
    rows_by_id = {r.get("id"): r for r in source.get("rows") or []}
    lines = _round_lines(source)
    live_by_id = {r.get("id"): r for r in live.get("requirements") or []}
    for s in desired["report"]["skipped"]:
        cell = None
        if s.get("source") == "row" and s.get("ref") in rows_by_id:
            cell = _round_cell(rows_by_id[s["ref"]], lines, reg)
        elif s.get("source") in ("elective_row", "activity_row") and s.get("ref") in live_by_id:
            r = live_by_id[s["ref"]]
            cell = (r.get("group_id"), r.get("subject_id"))
        if cell in by_cell:
            out.setdefault(cell, f"แถวของรอบใส่ในแผนไม่ได้ — {s.get('reason')}")
    return out


def _curriculum_note(live: dict[str, Any], groups: dict[Any, dict[str, Any]], rows: Iterable[dict[str, Any]]) -> str:
    """ข้อความ "จะเพิ่มวิชาเข้าหลักสูตร" ของแถวที่ข้อนี้เขียน — กฎเดียวกับที่ plan_apply ใช้ (_extend_curricula)"""
    curricula = {c.get("id"): c for c in live.get("curricula") or []}
    notes = []
    for r in rows:
        n = _w(r)
        cur = curricula.get(_cid((groups.get(r.get("group_id")) or {}).get("curriculum_id")))
        if cur is None or n <= 0:
            continue
        try:
            allowed = {x["subject_id"]: x["weekly_count"] for x in _curriculum.normalise_rows(cur.get("rows") or [])}
        except ValueError:
            continue
        if allowed.get(r.get("subject_id")) is None or allowed[r.get("subject_id")] < n:
            note = f"จะเพิ่มวิชานี้ในหลักสูตร “{cur.get('name')}” ({n} คาบ)"
            if note not in notes:
                notes.append(note)
    return " · ".join(notes)


def _effect(placed: int, total: int, idle: str | None) -> str | None:
    """ผลต่อคาบที่ลงแล้วของห้อง+วิชาเมื่อใส่ข้อนี้ (แผน total คาบ · ลงไว้ placed คาบ) · idle = ข้อความเมื่อยังไม่ได้ลงคาบเลย"""
    if placed <= 0:
        return idle
    if placed < total:
        return f"ลงไว้แล้ว {placed} คาบ ขาด {total - placed} คาบ — จะเข้ารายการงาน"
    if placed > total:
        return f"ลงไว้แล้ว {placed} คาบ เกินแผน {placed - total} คาบ (คาบยังอยู่) — จะเข้ารายการงาน"
    return f"ลงไว้แล้ว {placed} คาบ ครบตามแผน"


def _join(*parts: str | None) -> str | None:
    text = " · ".join(p for p in parts if p)
    return text or None


def _row_items(live: dict[str, Any], desired: dict[str, Any], unknown_cells: dict[tuple, str],
               taught: Callable[[tuple], tuple | None], created: dict[tuple, str],
               names: _Names) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    groups = _groups_of(live)
    placed_of = _placed_of(live.get("slots") or [])
    live_by = _lessons(list(live.get("requirements") or []))
    want_by = _lessons(list(desired["requirements"]))
    items: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for cell in list(live_by) + [c for c in want_by if c not in live_by]:
        g, s = cell
        where = f"{names.g(g)} {names.s(s)}"
        if cell in live_by and cell in unknown_cells:
            unknown.append({"group_id": g, "subject_id": s, "label": f"{where} — {unknown_cells[cell]}"})
            continue
        how = taught(cell) if cell in live_by else None
        if how is not None:
            if how[0] == "unknown":
                unknown.append({"group_id": g, "subject_id": s, "label": f"{where} — {how[1]}"})
            continue
        lv, wt = live_by.get(cell, []), want_by.get(cell, [])
        placed = placed_of.get(cell, 0)
        total = sum(max(x["w"]) for x in lv)
        pairs, gone, new = _match(lv, wt)
        for l, d in pairs:
            rid = l["rows"][0]["id"]
            if _weekly_changed(l, d):
                sets = []
                for i, r in enumerate(l["rows"]):
                    to = d["w"][i] if i < len(d["w"]) else max(d["w"])
                    if to != _w(r):
                        sets.append([r["id"], to])
                detail = "" if len(l["w"]) == len(d["w"]) == 1 else \
                    " (" + " · ".join(f"ครู {names.t(r.get('teacher_id'))} {_w(r)} → {d['w'][min(i, len(d['w']) - 1)]}"
                                      for i, r in enumerate(l["rows"])) + ")"
                after_total = total - max(l["w"]) + max(d["w"])
                written = [{**r, "weekly_count": to} for r in l["rows"] for rr, to in sets if rr == r["id"]]
                items.append(_item(
                    f"weekly:{g}:{s}:{rid}", "weekly",
                    f"{where} ครู {names.t(l['t'][0])}: คาบ/สัปดาห์ {max(l['w'])} → {max(d['w'])}{detail}",
                    group_id=g, subject_id=s, before=max(l["w"]), after=max(d["w"]), placed=placed,
                    effect=_join(_effect(placed, after_total, None), _curriculum_note(live, groups, written)),
                    apply={"op": "weekly", "rows": sets}))
            if l["t"] != d["t"]:
                who = l["t"][0] != d["t"][0] or l["t"][1] != d["t"][1]
                sets = []
                for i, r in enumerate(l["rows"][:len(d["rows"])]):
                    want = {}
                    if who:
                        want.update(teacher_id=d["rows"][i].get("teacher_id"), co_teacher_id=d["rows"][i].get("co_teacher_id"))
                    if l["t"][2] != d["t"][2]:
                        want["room_id"] = d["rows"][i].get("room_id")
                    sets.append([r["id"], want])
                add = [_row_out(x) for x in d["rows"][len(l["rows"]):]]
                parts = []
                if l["t"][0] != d["t"][0]:
                    parts.append(f"ครู {names.t(l['t'][0])} → {names.t(d['t'][0])}")
                if l["t"][1] != d["t"][1]:
                    parts.append(f"ครูสอนร่วม {names.t(l['t'][1]) if l['t'][1] else 'ไม่มี'} → "
                                 f"{names.t(d['t'][1]) if d['t'][1] else 'ไม่มี'}")
                if l["t"][2] != d["t"][2]:
                    parts.append(f"ห้องปฏิบัติการ {names.room(l['t'][2])} → {names.room(d['t'][2])}")
                if placed and l["t"][0] != d["t"][0]:
                    eff = f"ลงไว้แล้ว {placed} คาบ ยังเป็นครูเดิม ({names.t(l['t'][0])}) — จะเข้ารายการงาน"
                elif placed:
                    eff = f"ลงไว้แล้ว {placed} คาบ — คาบที่ลงไว้ยังเป็นครูสอนร่วม/ห้องเดิม — จะเข้ารายการงานที่ต้องแก้เอง"
                else:
                    eff = None
                items.append(_item(
                    f"teacher:{g}:{s}:{rid}", "teacher", f"{where}: " + " · ".join(parts),
                    group_id=g, subject_id=s, placed=placed, effect=_join(eff, _curriculum_note(live, groups, add)),
                    before={"teacher_id": l["t"][0], "co_teacher_id": l["t"][1], "room_id": l["t"][2]},
                    after={"teacher_id": d["t"][0], "co_teacher_id": d["t"][1], "room_id": d["t"][2]},
                    requires=_requires(created, [x.get("teacher_id") for x in d["rows"]] +
                                       [x.get("co_teacher_id") for x in d["rows"]], []),
                    apply={"op": "teacher", "rows": sets, "delete": [r["id"] for r in l["rows"][len(d["rows"]):]],
                           "add": add}))
        for d in new:
            add = [_row_out(x) for x in d["rows"]]
            co = f" สอนร่วมกับ {names.t(d['t'][1])}" if d["t"][1] else ""
            items.append(_item(
                f"new:{g}:{s}:{d['t'][0] or 0}", "new",
                f"{where}: เพิ่มแถว ครู {names.t(d['t'][0])}{co} {max(d['w'])} คาบ/สัปดาห์",
                group_id=g, subject_id=s, placed=placed,
                after={"teacher_id": d["t"][0], "co_teacher_id": d["t"][1], "room_id": d["t"][2],
                       "weekly_count": max(d["w"])},
                effect=_join(_effect(placed, total + max(d["w"]), f"ยังไม่ลง {max(d['w'])} คาบ"),
                             _curriculum_note(live, groups, add)),
                requires=_requires(created, [x.get("teacher_id") for x in d["rows"]] +
                                   [x.get("co_teacher_id") for x in d["rows"]], [s]),
                apply={"op": "add", "add": add}))
        for l in gone:
            items.append(_item(
                f"removed:{g}:{s}:{l['rows'][0]['id']}", "removed",
                f"{where}: ลบแถว ครู {names.t(l['t'][0])} {max(l['w'])} คาบ/สัปดาห์ (รอบไม่มีแถวนี้แล้ว)",
                group_id=g, subject_id=s, placed=placed,
                before={"teacher_id": l["t"][0], "co_teacher_id": l["t"][1], "room_id": l["t"][2],
                        "weekly_count": max(l["w"])},
                effect=_effect(placed, total - max(l["w"]), None),
                apply={"op": "delete", "delete": [r["id"] for r in l["rows"]]}))
    return items, unknown


# ── คาบเสรี/กิจกรรม: เทียบในรูปชุดทั้งสองฝั่ง ───────────────────────────────────────
def _live_sets(live: dict[str, Any], live_proposal: dict[str, Any], reg: dict[str, Any]) -> list[dict[str, Any]]:
    """ชุดฝั่งสด = ชุดที่ wl_round_proposal สร้างจากของสด · ชุดลำดับแรกคือ pool ตามลำดับ (wl_round_proposal ยก pool ทุกตัว
    เป็นชุดก่อนเสมอ) ตามด้วยคาบเสรีรายห้องที่ไม่มี pool รองรับ แล้วกิจกรรม · ตัวเลือกเป็น (วิชา, ครู) รหัสของโปรแกรม:
    pool อ่านจาก pool ตรง ๆ · ชุดอื่นแปลงรหัสของเว็บกลับด้วย map ของทะเบียน"""
    pools = list(live.get("pools") or [])
    psets = list(live_proposal.get("sets") or [])
    if len(psets) < len(pools) or any(
            psets[i].get("kind") != "elective" or list(psets[i].get("group_ids") or []) != list(p.get("group_ids") or [])
            for i, p in enumerate(pools)):
        raise ValueError("live_proposal ต้องเป็นผลของ wl_round_proposal จากของสดชุดเดียวกับ live "
                         "(ชุดลำดับแรกต้องตรงกับ pool ทีละตัว)")
    slots = list(live.get("slots") or [])
    pool_ids = {p.get("id") for p in pools}
    tmap, smap = reg["teacher_map"], reg["subject_map"]
    out = []
    for i, st in enumerate(psets):
        form = {"side": "live", "kind": st.get("kind"), "name": str(st.get("name") or ""),
                "group_ids": list(st.get("group_ids") or []), "weekly": int(st.get("weekly") or 0),
                "is_double": bool(st.get("is_double")), "pool": None}
        if i < len(pools):
            p = pools[i]
            form["pool"] = p
            form["pairs"] = frozenset((o.get("subject_id"), o.get("teacher_id") or None) for o in p.get("options") or [])
            form["placed_n"] = sum(1 for s in slots if s.get("elective_pool_id") == p.get("id"))
            form["placed"] = p.get("day") is not None or p.get("period") is not None or form["placed_n"] > 0
        else:
            form["pairs"] = frozenset(
                (smap.get(o.get("subject_id"), ("code", str(o.get("code") or ""))) if o.get("subject_id") is not None
                 else ("code", str(o.get("code") or "")), tmap.get(o.get("teacher_id")) if o.get("teacher_id") else None)
                for o in st.get("options") or [])
            gids, subs = set(form["group_ids"]), {sid for sid, _t in form["pairs"]}
            if form["kind"] == "elective":
                form["placed_n"] = sum(1 for s in slots if s.get("is_elective") and s.get("group_id") in gids
                                       and s.get("elective_pool_id") not in pool_ids
                                       and {(o.get("subject_id"), o.get("teacher_id") or None)
                                            for o in s.get("elective_options") or []} & form["pairs"])
            else:
                form["placed_n"] = sum(1 for s in slots if not s.get("is_elective") and s.get("group_id") in gids
                                       and s.get("subject_id") in subs)
            form["placed"] = True       # ชุดจากช่องในตาราง = ลงคาบแล้วโดยนิยาม
        out.append(form)
    return out


def _round_sets(source: dict[str, Any], desired: dict[str, Any], reg: dict[str, Any]) -> list[dict[str, Any]]:
    """ชุดฝั่งรอบ = ชุดของภาคเรียน · คาบเสรี: ตัวเลือกจาก pool ที่ plan_from_round สร้าง (ชุด elective ตามลำดับ = pool ตามลำดับ)
    · กิจกรรม: แปลงตัวเลือกของรอบด้วย map ของทะเบียนแบบเดียวกับ plan_from_round"""
    tmap, smap, typed = reg["teacher_map"], reg["subject_map"], reg["typed_map"]
    options_of: dict[Any, list[dict[str, Any]]] = {}
    for o in source.get("options") or []:
        options_of.setdefault(o.get("set_id"), []).append(o)
    pools = iter(desired["pools"])
    out = []
    for st in source.get("sets") or []:
        kind = st.get("kind")
        if kind not in ("elective", "activity"):
            continue
        form = {"side": "round", "kind": kind, "name": str(st.get("name") or ""), "set_id": st.get("id"),
                "group_ids": list(st.get("group_ids") or []), "weekly": int(st.get("weekly") or 0),
                "is_double": bool(st.get("is_double")), "pool": None}
        if kind == "elective":
            form["pool"] = next(pools)
            form["pairs"] = frozenset((o.get("subject_id"), o.get("teacher_id") or None) for o in form["pool"]["options"])
        else:
            pairs = set()
            for o in options_of.get(st.get("id"), []):
                sid = smap.get(o.get("subject_id")) if o.get("subject_id") is not None else \
                    typed.get(str(o.get("code") or "").strip())
                if sid is None:
                    continue
                tids = [tmap[t.get("teacher_id")] for t in o.get("teachers") or [] if t.get("teacher_id") in tmap]
                pairs |= {(sid, t) for t in tids} if tids else {(sid, None)}
            form["pairs"] = frozenset(pairs)
        out.append(form)
    return out


def _content(f: dict[str, Any]) -> tuple:
    return (f["weekly"], f["is_double"], f["pairs"])


def _match_sets(rounds: list[dict[str, Any]], lives: list[dict[str, Any]]) -> tuple[list[tuple], list, list, list]:
    """ชุดของชนิด+ห้องเดียวกัน: คู่เดียว → จับ · ชื่อเดียวกันที่ไม่ซ้ำ → จับ · เนื้อหาเหมือนกันทุกอย่าง → จับ · เหลือฝั่งละหนึ่ง → จับ
    · ยังเหลือทั้งสองฝั่ง → จับคู่ไม่ได้ (ไม่ทำอะไร) → (คู่, ชุดของรอบที่ไม่มีในของสด, ชุดสดที่รอบไม่มี, จับคู่ไม่ได้)"""
    r_left, l_left = list(range(len(rounds))), list(range(len(lives)))
    pairs: list[tuple] = []

    def take(i: int, j: int) -> None:
        pairs.append((rounds[i], lives[j]))
        r_left.remove(i)
        l_left.remove(j)
    for i in list(r_left):
        name = rounds[i]["name"]
        rs = [x for x in r_left if rounds[x]["name"] == name]
        ls = [y for y in l_left if lives[y]["name"] == name]
        if len(rs) == 1 and len(ls) == 1:
            take(i, ls[0])
    for i in list(r_left):
        j = next((j for j in l_left if _content(lives[j]) == _content(rounds[i])), None)
        if j is not None:
            take(i, j)
    if len(r_left) == 1 and len(l_left) == 1:
        take(r_left[0], l_left[0])
    if r_left and l_left:
        return pairs, [], [], [rounds[i] for i in r_left] + [lives[j] for j in l_left]
    return pairs, [rounds[i] for i in r_left], [lives[j] for j in l_left], []


def _sets_matched(source: dict[str, Any], live: dict[str, Any], live_proposal: dict[str, Any], desired: dict[str, Any],
                  reg: dict[str, Any]) -> dict[str, Any]:
    """จับชุดทั้งสองฝั่งครั้งเดียว (ถัง ชนิด+ห้อง → _match_sets) — ข้อชุดและการตัดสินแถวที่ชุดสอนแทน (_set_taught) ใช้ผลเดียวกัน
    ชุดที่จับได้มี f["match"] = ชุดอีกฝั่ง · จับคู่ไม่ได้มี f["odd"] = True
    → {"rounds", "lives", "buckets": [(คู่, ใหม่, หาย, จับไม่ได้)] ตามลำดับถัง}"""
    rounds, lives = _round_sets(source, desired, reg), _live_sets(live, live_proposal, reg)
    buckets: dict[tuple, dict[str, list]] = {}
    for f in rounds + lives:
        b = buckets.setdefault((f["kind"], frozenset(f["group_ids"])), {"round": [], "live": []})
        b[f["side"]].append(f)
    out = []
    for _key, b in sorted(buckets.items(), key=lambda kv: (kv[0][0], sorted(map(str, kv[0][1])))):
        pairs, new, gone, odd = _match_sets(b["round"], b["live"])
        for r, l in pairs:
            r["match"], l["match"] = l, r
        for f in odd:
            f["odd"] = True
        out.append((pairs, new, gone, odd))
    return {"rounds": rounds, "lives": lives, "buckets": out}


def _set_items(matched: dict[str, Any], live: dict[str, Any], created: dict[tuple, str],
               names: _Names) -> tuple[list[dict], list[dict]]:
    items: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    known = {s.get("id"): bool(s.get("is_elective")) for s in live.get("subjects") or []}

    def marks(subject_ids: Iterable[Any]) -> list[Any]:
        # วิชาของตัวเลือกที่ใส่เข้า pool ที่จะถูกติดธงวิชาเสรี (แบบ _mark_elective) — เฉพาะวิชาในโปรแกรมที่ยังไม่ใช่วิชาเสรี
        # (วิชาที่ข้อทะเบียนจะสร้างได้ธงจาก keep_set_electives อยู่แล้ว) · อยู่ใน apply → token คลุม หน้าเทียบ = สิ่งที่เขียน
        return sorted({x for x in subject_ids if x in known and not known[x]}, key=str)

    def mark_text(ids: list[Any]) -> str | None:
        return f"ติดธงวิชาเสรีให้ {', '.join(names.s(x) for x in ids)}" if ids else None

    def pair_text(sid: Any, tid: Any) -> str:
        subj = names.s(sid) if not isinstance(sid, tuple) else f"วิชารหัส {sid[1]}"
        return f"{subj} ({names.t(tid)})" if tid else f"{subj} (ยังไม่มีครู)"

    def show(f: dict[str, Any]) -> dict[str, Any]:
        return {"name": f["name"], "group_ids": list(f["group_ids"]), "weekly": f["weekly"], "is_double": f["is_double"],
                "options": sorted(([list(p) if not isinstance(p[0], tuple) else [list(p[0]), p[1]] for p in f["pairs"]]),
                                  key=str)}

    def title(f: dict[str, Any], word: str = "") -> str:
        cell = "รายห้อง" if f["side"] == "live" and f["kind"] == "elective" and f["pool"] is None else ""
        return f"{_SET_KIND_TEXT.get(f['kind'], 'ชุด')}{cell}{word} “{f['name']}” ({names.rng(f['group_ids'])})"

    def summary(r: dict[str, Any], l: dict[str, Any]) -> str:
        parts = []
        r_sub, l_sub = {s for s, _t in r["pairs"]}, {s for s, _t in l["pairs"]}
        changed = sorted((s for s in r_sub & l_sub if {t for x, t in r["pairs"] if x == s} !=
                          {t for x, t in l["pairs"] if x == s}), key=str)
        add = sorted((p for p in r["pairs"] - l["pairs"] if p[0] not in changed), key=str)
        rem = sorted((p for p in l["pairs"] - r["pairs"] if p[0] not in changed), key=str)
        if add:
            parts.append("ตัวเลือกใหม่ " + ", ".join(pair_text(*p) for p in add))
        if rem:
            parts.append("เอาตัวเลือกออก " + ", ".join(pair_text(*p) for p in rem))
        for s in changed:
            old = ", ".join(names.t(t) for _x, t in sorted((p for p in l["pairs"] if p[0] == s), key=str))
            new = ", ".join(names.t(t) for _x, t in sorted((p for p in r["pairs"] if p[0] == s), key=str))
            parts.append(f"เปลี่ยนครูของ {names.s(s)}: {old} → {new}")
        if r["weekly"] != l["weekly"]:
            parts.append(f"คาบ/สัปดาห์ {l['weekly']} → {r['weekly']}")
        if r["is_double"] != l["is_double"]:
            parts.append(f"คาบคู่ {'ใช่' if l['is_double'] else 'ไม่ใช่'} → {'ใช่' if r['is_double'] else 'ไม่ใช่'}")
        return " · ".join(parts)

    manual = "ไม่แก้ให้อัตโนมัติ — แก้/ลงคาบเสรีหรือกิจกรรมในหน้าจัดคาบเอง (เข้ารายการงาน)"
    for pairs, new, gone, odd in matched["buckets"]:
        for r, l in pairs:
            if _content(r) == _content(l):
                continue
            label = f"{title(l)}: {summary(r, l)}"
            reqs = _requires(created, [t for _s, t in r["pairs"] - l["pairs"]], [s for s, _t in r["pairs"] - l["pairs"]])
            if l["pool"] is not None and not l["placed"] and r["kind"] == "elective":
                add = [{k: copy.deepcopy(v) for k, v in o.items() if k != "key"} for o in r["pool"]["options"]
                       if (o.get("subject_id"), o.get("teacher_id") or None) not in l["pairs"]]
                mark = marks(o.get("subject_id") for o in add)
                items.append(_item(f"sets:edit:{r['set_id']}", "sets", label, before=show(l), after=show(r), placed=0,
                                   effect=_join("ชุดนี้ยังไม่ลงคาบ — แก้รายการตัวเลือกให้", mark_text(mark)), requires=reqs,
                                   apply={"op": "pool_edit", "pool_id": l["pool"].get("id"), "weekly": r["weekly"],
                                          "is_double": r["is_double"], "add": add,
                                          "remove": sorted((list(p) for p in l["pairs"] - r["pairs"]), key=str),
                                          "mark_elective": mark}))
            else:
                items.append(_item(f"sets:edit:{r['set_id']}", "sets", label, before=show(l), after=show(r),
                                   placed=l["placed_n"], auto=False,
                                   effect=f"ลงไว้แล้ว {l['placed_n']} คาบ · {manual}" if l["placed_n"] else manual,
                                   apply={"op": "todo", "todo": f"{label} — แก้ในหน้าจัดคาบเอง"}))
        for r in new:
            label = f"{title(r, 'ใหม่')}: {len(r['pairs'])} ตัวเลือก {r['weekly']} คาบ/สัปดาห์"
            if r["kind"] == "elective":
                pool = {k: copy.deepcopy(v) for k, v in r["pool"].items() if k != "id"}
                pool["options"] = [{k: v for k, v in o.items() if k != "key"} for o in pool["options"]]
                mark = marks(o.get("subject_id") for o in pool["options"])
                items.append(_item(
                    f"sets:new:{r['set_id']}", "sets", label, after=show(r),
                    effect=_join("สร้างคาบเสรีแบบยังไม่ลงคาบ — ต้องลงคาบเองในหน้าจัดคาบ (เข้ารายการงาน)", mark_text(mark)),
                    requires=_requires(created, [t for _s, t in r["pairs"]], [s for s, _t in r["pairs"]]),
                    apply={"op": "pool_add", "pool": pool, "mark_elective": mark,
                           "todo": f"ลงคาบเสรี “{r['name']}” ({names.rng(r['group_ids'])}) ในหน้าจัดคาบ — "
                                   "สร้างไว้แล้วแต่ยังไม่ลงคาบ"}))
            else:
                items.append(_item(f"sets:new:{r['set_id']}", "sets", label, after=show(r), auto=False,
                                   effect="ต้องลงกิจกรรมเองในหน้าจัดคาบ (เข้ารายการงาน)",
                                   apply={"op": "todo", "todo": f"{label} — ลงกิจกรรมเองในหน้าจัดคาบ"}))
        for l in gone:
            label = f"{title(l)} ไม่มีในรอบแล้ว"
            key = f"sets:gone:pool:{l['pool'].get('id')}" if l["pool"] is not None else \
                f"sets:gone:{l['kind']}:{','.join(map(str, sorted(l['group_ids'], key=names.gkey)))}:{l['name']}"
            if l["pool"] is not None and not l["placed"]:
                items.append(_item(key, "sets", label, before=show(l), effect="ชุดนี้ยังไม่ลงคาบ — ลบชุดออกให้",
                                   apply={"op": "pool_delete", "pool_id": l["pool"].get("id")}))
            else:
                items.append(_item(key, "sets", label, before=show(l), placed=l["placed_n"], auto=False,
                                   effect=f"ลงไว้แล้ว {l['placed_n']} คาบ · {manual}" if l["placed_n"] else manual,
                                   apply={"op": "todo", "todo": f"{label} — เอาออกในหน้าจัดคาบเองถ้าไม่สอนแล้ว"}))
        for f in odd:
            unmatched.append({"side": f["side"], "kind": f["kind"], "name": f["name"], "group_ids": list(f["group_ids"]),
                              "label": f"{title(f)} ({'ในรอบ' if f['side'] == 'round' else 'ในโปรแกรม'}) — "
                                       "จับคู่ไม่ได้ (ชนิดและห้องซ้ำกับชุดอื่น และชื่อแยกไม่ออก) ไม่ทำอะไร"})
    return items, unmatched


def _set_taught(source: dict[str, Any], live: dict[str, Any], live_proposal: dict[str, Any], reg: dict[str, Any],
                matched: dict[str, Any]) -> Callable[[tuple], tuple | None]:
    """ห้อง+วิชาของแผนสดที่คาบเสรี/กิจกรรมสอนแทน (ขั้นที่ 2 ข้ามทั้งก้อน — served ผ่าน shares หรือ block_cells — จึงไม่มีแถวของ
    ก้อนนั้นใน live_proposal["rows"]) → วิธีเทียบ (รอบแก้ 1 ข้อ 1–2):
    - ("keep",) = ชุดที่ครอบก้อนนี้ไม่เปลี่ยนทั้งสองฝั่ง → ไม่มีข้อ คงของสด · กฎ "ตามรูปของแผนเดิม" ของทาง ก. เขียนครูของชุดแทนครูในแผน
      ได้ (ครูในแผนไม่ใช่ครูของชุด) แม้ชุดไม่เปลี่ยน — เทียบตอนนั้นคือข้อเท็จ auto ในรอบที่เพิ่งเปิด
      "ไม่เปลี่ยน" ตัดสินจากสิ่งที่กฎนั้นอ่านสำหรับก้อนนี้: ชุดที่ครอบ (คู่กันได้ทุกตัวทั้งสองฝั่ง) และครูของวิชานั้นในแต่ละชุด —
      ตัวเลือกวิชาอื่นของชุดเปลี่ยน ไม่เปลี่ยนแถวนี้ตามกฎนั้น จึงไม่เทียบ
    - None = ชุดที่ครอบเปลี่ยน หรือ**รอบมีแถวของตัวเองสำหรับก้อนนี้** (หัวหน้าเพิ่ม/แก้ในรอบ — ทาง ก. เขียนแถวนั้นแทนกฎตามรูปของแผนเดิม
      จึงต้องเห็นในหน้าเทียบ ไม่งั้นงานในรอบหายเงียบ — รอบแก้ 2) หรือไม่ใช่ก้อนที่ชุดสอนแทน → เทียบตามปกติด้วยแผนที่รอบต้องการ (กฎทาง ก.)
    - ("unknown", เหตุ) = หาชุดที่ครอบในโปรแกรมไม่เจอ หรือชุดที่ครอบจับคู่ไม่ได้ → ตัดสินไม่ได้ ไม่เทียบ (ไม่เสนอลบ)
    ครอบ: คาบเสรี = ชุดเปิดวิชานั้นและห้องในชุดมีนักเรียนชุดเดียวกับห้องนี้ (shares_students — ห้องแม่/ห้องย่อยด้วย) ·
    กิจกรรม = ชุดเปิดวิชานั้นและห้องนี้อยู่ในชุด"""
    wl_of = {sched: wl for wl, sched in reg["subject_map"].items()}
    in_proposal = {(r.get("group_id"), r.get("subject_id")) for r in live_proposal.get("rows") or []}
    lines = _round_lines(source)
    in_round = {c for c in (_round_cell(r, lines, reg) for r in source.get("rows") or []) if c is not None}
    shares = _tfr.shares_students(_groups_of(live))

    def covers(f: dict[str, Any], g: Any, s: Any) -> bool:
        if not any(x == s for x, _t in f["pairs"]):
            return False
        return any(shares(g, h) for h in f["group_ids"]) if f["kind"] == "elective" else g in f["group_ids"]

    def teachers(f: dict[str, Any], s: Any) -> frozenset:
        return frozenset(t for x, t in f["pairs"] if x == s)

    def state(cell: tuple) -> tuple | None:
        g, s = cell
        wl = wl_of.get(s)
        if wl is None or (g, wl) in in_proposal:
            return None     # ขั้นที่ 2 แปลงก้อนนี้เป็นแถวของรอบ (หรือแปลงวิชาไม่ได้ — unconverted จับไว้ก่อนแล้ว)
        if cell in in_round:
            return None     # รอบมีแถวของตัวเอง → plan_from_round เขียนแถวนั้น (ไม่ใช้กฎตามรูปของแผนเดิม) → เทียบตามปกติ
        lives = [f for f in matched["lives"] if covers(f, g, s)]
        rounds = [f for f in matched["rounds"] if covers(f, g, s)]
        if not lives:
            return ("unknown", "สอนในคาบเสรี/กิจกรรม แต่หาชุดที่ครอบห้อง+วิชานี้ในโปรแกรมไม่เจอ")
        if any(f.get("odd") for f in lives + rounds):
            return ("unknown", "ชุดคาบเสรี/กิจกรรมที่ครอบห้อง+วิชานี้จับคู่กับรอบไม่ได้")
        same = all(f.get("match") is not None and any(f["match"] is r for r in rounds)
                   and teachers(f, s) == teachers(f["match"], s) for f in lives) and \
            all(f.get("match") is not None and any(f["match"] is x for x in lives) for f in rounds)
        return ("keep",) if same else None
    return state


# ── เครื่องเทียบ ────────────────────────────────────────────────────────────
def plan_diff(source: dict[str, Any], live: dict[str, Any], live_proposal: dict[str, Any],
              counters: dict[str, int]) -> dict[str, Any]:
    """เทียบรอบอัตรากำลังกับแผนสดเป็นกอง (แบบข้อ 4.2) — ไม่แก้ข้อมูลขาเข้า

    source = ข้อมูลของรอบ (รูป _wl_export_source) · live = ของสดรูป outgoing ของทาง ก. (_term_outgoing: requirements pools slots
    served sched_subjects groups teachers subjects curricula) + rooms (ห้องของโปรแกรม — ชื่อห้องปฏิบัติการในข้อความ · ไม่มีได้)
    · live_proposal = wl_round_proposal ของของสดตอนนี้ (ผู้เรียกเตรียม
    จาก _wl_timetable_source ของสถานะเดียวกับ live) · counters = สำเนาของ _counters
    "แผนที่รอบต้องการ" = registry_plan + plan_from_round ของทาง ก. โดยใช้ของสดเป็นแผนเดิม (แถวที่คาบเสรี/กิจกรรมสอนแทน
    จึงเทียบผ่านกฎ "ตามรูปของแผนเดิม" เมื่อชุดที่ครอบเปลี่ยน — ชุดไม่เปลี่ยน = คงของสด ดู _set_taught) · ค่า is_elective ของวิชาในชุดตาม
    term_from_round.keep_set_electives
    - แถว: ก้อน (ห้อง, วิชา) หลังพับคู่สอนร่วม → บทเรียน (_lessons) จับคู่ด้วย _match แล้ว คาบต่าง → weekly ·
      ครู/ครูสอนร่วม/ห้องปฏิบัติการต่าง → teacher · บทเรียนของรอบที่ไม่มีคู่ → new · บทเรียนสดที่ไม่มีคู่ → removed
      ก้อนที่รอบไม่รู้จัก (_unknown_cells) และก้อนที่ชุดสอนแทนแต่ตัดสินไม่ได้ (_set_taught) ไม่ถูกเทียบ → unknown
    - ชุด: ชนิด + ห้อง แล้วชื่อ (_match_sets) · pool ยังไม่ลงคาบ → auto · ลงแล้ว/ชุดจากช่องรายห้อง/กิจกรรม → auto=False ·
      ชุดใหม่ของรอบ (คาบเสรี) → pool ยังไม่ลงคาบ + ข้องาน "ลงคาบ" · กิจกรรมใหม่ → auto=False · จับคู่ไม่ได้ → unmatched_sets
    - ทะเบียน: สร้าง/แก้ช่องตัวตน/ผูกด้วยรหัส (กฎทาง ก.) · ข้ออื่นที่อ้างครู/วิชาที่จะสร้าง requires ข้อทะเบียนนั้น
    key: registry:teacher:{wl} · registry:teacher-edit:{wl} · registry:subject:{wl} · registry:subject-edit:{wl} ·
         registry:typed:{รหัส} · registry:bind:{รหัส} · new:{ห้อง}:{วิชา}:{ครู}[:n] · weekly|teacher|removed:{ห้อง}:{วิชา}:{รหัสแถวสด} ·
         sets:edit:{รหัสชุดของรอบ} · sets:new:{รหัสชุดของรอบ} · sets:gone:pool:{รหัส pool} · sets:gone:{ชนิด}:{ห้อง,…}:{ชื่อ}
    → {"items": [ข้อ], "unknown": [{group_id, subject_id, label}], "unmatched_sets": [{side, kind, name, group_ids, label}],
       "token": diff_token(items), "registry": ผลของ registry_plan, "desired": ผลของ plan_from_round}
    """
    registry = _tfr.registry_plan(source, live, counters)
    desired = _tfr.plan_from_round(source, live, registry, registry["counters"])
    _tfr.keep_set_electives(registry, desired["elective_subjects"])
    names = _Names(_groups_of(live), registry["teachers"], registry["subjects"], live.get("rooms"))
    reg_items, created = _registry_items(registry)
    matched = _sets_matched(source, live, live_proposal, desired, registry)
    row_items, unknown = _row_items(live, desired, _unknown_cells(source, live, live_proposal, desired, registry),
                                    _set_taught(source, live, live_proposal, registry, matched), created, names)
    set_items, unmatched = _set_items(matched, live, created, names)

    def order(it: dict[str, Any]) -> tuple:
        g = it.get("group_id")
        return (_PILE_ORDER[it["pile"]], names.gkey(g) if g is not None else (-1, ""), str(it.get("subject_id")),
                it["key"])
    items = sorted(reg_items + row_items + set_items, key=order)
    # key ต้องไม่ซ้ำ (เครื่องใส่หาข้อด้วย key): บทเรียนใหม่ของครูคนเดียวกันในห้อง+วิชาเดียวกัน · ชุดรายห้องที่ห้องและชื่อ (ตั้งจากห้อง)
    # ตรงกันสองชุดแล้วรอบไม่มีทั้งคู่ — ตัวที่สองขึ้นไปต่อท้าย :2 :3 ตามลำดับที่สร้าง (ลำดับคงที่ เพราะสร้างจากข้อมูลเดียวกัน)
    seen: dict[str, int] = {}
    for it in items:
        seen[it["key"]] = seen.get(it["key"], 0) + 1
        if seen[it["key"]] > 1:
            it["key"] = f"{it['key']}:{seen[it['key']]}"
    return {"items": items, "unknown": unknown, "unmatched_sets": unmatched, "token": diff_token(items),
            "registry": registry, "desired": desired}


# ── เครื่องใส่ ──────────────────────────────────────────────────────────────
def _extend_curricula(curricula: list[dict[str, Any]], groups: dict[Any, dict[str, Any]],
                      written: list[dict[str, Any]]) -> None:
    """แถวแผนที่เขียน (แถวใหม่ · คาบที่เปลี่ยน) ที่วิชาไม่อยู่ในหลักสูตรของห้อง หรือคาบน้อยกว่าแถว → เพิ่ม (วิชา, คาบ) เข้าหลักสูตรนั้น
    แล้ว normalise_rows เก็บค่ามากสุด (กฎทาง ก. — แก้แถวนั้นภายหลังผ่านหน้าเดิมได้โดยไม่ถูก check_row ปฏิเสธ) · แก้เฉพาะหลักสูตร
    ที่ต้องเพิ่ม · ห้องที่ไม่มีหลักสูตรไม่ถูกตรวจอยู่แล้ว · หลักสูตรที่อ่านไม่ได้คงไว้ (check_row ของโปรแกรมบอกเองว่าอ่านไม่ได้)"""
    by_id = {c.get("id"): c for c in curricula}
    for r in written:
        n = _w(r)
        cur = by_id.get(_cid((groups.get(r.get("group_id")) or {}).get("curriculum_id")))
        if cur is None or n <= 0:
            continue
        try:
            allowed = {x["subject_id"]: x["weekly_count"] for x in _curriculum.normalise_rows(cur.get("rows") or [])}
        except ValueError:
            continue
        if allowed.get(r.get("subject_id")) is None or allowed[r.get("subject_id")] < n:
            cur["rows"] = _curriculum.normalise_rows(list(cur.get("rows") or []) +
                                                     [{"subject_id": r.get("subject_id"), "weekly_count": n}])


def plan_apply(diff: dict[str, Any], live: dict[str, Any], accepted: set[str], counters: dict[str, int]) -> dict[str, Any]:
    """ใส่เฉพาะข้อที่ติ๊กลงสำเนาของของสด — ใช้ข้อมูลในข้อ (item["apply"]) เท่านั้น · ไม่แก้ diff live accepted counters

    ข้อที่ requires ไม่ถูกติ๊กครบ → ติ๊กให้อัตโนมัติ (อยู่ใน applied) · ข้อ auto=False → เข้า todos เท่านั้น ไม่แก้ข้อมูล ·
    ข้อที่ไม่มีในหน้าเทียบ → ValueError (หน้าเทียบเก่า — ผู้เรียกตอบ 400/409 ไม่เดา) · ไม่ติ๊กเลย = ทุกตัวเท่าของสด
    รหัสใหม่: แถวแผน/pool/ตัวเลือกจาก counters (ของโปรแกรม ณ ตอนใส่) · ครู/วิชาใช้รหัสที่ registry_plan จองไว้ในหน้าเทียบ
    (ตัวนับ teacher/subject ขยับถึงรหัสที่ใช้จริง) · วิชาใน apply["mark_elective"] ของข้อชุดติดธง is_elective (แบบ _mark_elective)
    ข้องาน (ไม่มี id/update_id — ผู้เรียกใส่) ของข้อที่ติ๊กและห้อง+วิชามีคาบลงไว้แล้ว: แถวใหม่/คาบเปลี่ยน/ลบแถว → missing หรือ over
    ตามแผนหลังใส่เทียบคาบที่ลง (ก้อนละหนึ่งข้อ · ลงพอดีไม่มีข้อ) · เปลี่ยนครูผู้สอน/ครูสอนร่วม/ห้องปฏิบัติการ → teacher (teacher_id = ครูใหม่ในแผน · fields = ช่องที่เปลี่ยน) ·
    ชุด auto=False และชุดคาบเสรีใหม่ → set
    → {"teachers", "subjects", "requirements", "pools", "curricula" (ทั้งชุดใหม่), "group_curricula" ({ห้อง: curriculum_id เดิม}),
       "counters", "writeback" (รูป registry_plan สำหรับ _term_writeback), "todos", "applied", "skipped"} — **ไม่มี slots / parked**
    """
    items = list(diff.get("items") or [])
    by_key = {it["key"]: it for it in items}
    stale = sorted(set(accepted) - set(by_key))
    if stale:
        raise ValueError(f"ไม่พบข้อ {', '.join(stale)} ในหน้าเทียบ — ข้อมูลอาจเปลี่ยนแล้ว ดูหน้าเทียบใหม่อีกครั้ง")
    chosen = set(accepted)
    for k in list(chosen):
        chosen.update(by_key[k].get("requires") or [])
    missing = sorted(chosen - set(by_key))
    if missing:
        raise ValueError(f"หน้าเทียบอ้างข้อ {', '.join(missing)} ที่ไม่มีอยู่")
    applied = [it for it in items if it["key"] in chosen]

    counters = dict(counters)
    groups = _groups_of(live)
    teachers = copy.deepcopy(list(live.get("teachers") or []))
    subjects = copy.deepcopy(list(live.get("subjects") or []))
    pools = copy.deepcopy(list(live.get("pools") or []))
    curricula = copy.deepcopy(list(live.get("curricula") or []))
    writeback: dict[str, list[dict[str, Any]]] = {k: [] for k in _WRITEBACK_KEYS}

    # 1) ทะเบียน
    t_by, s_by = {t.get("id"): t for t in teachers}, {s.get("id"): s for s in subjects}
    for it in applied:
        op = it["apply"]
        if it["pile"] != "registry":
            continue
        if op["op"] in ("teacher_create", "subject_create"):
            rows, by, key = (teachers, t_by, "teacher") if op["op"] == "teacher_create" else (subjects, s_by, "subject")
            row = copy.deepcopy(op["row"])
            rows.append(row)
            by[row["id"]] = row
            if row["id"] > counters.get(key, 0):
                counters[key] = row["id"]
        elif op["op"] in ("teacher_edit", "subject_edit"):
            target = (t_by if op["op"] == "teacher_edit" else s_by).get(op["id"])
            if target is None:
                raise ValueError(f"ไม่พบรายการรหัส {op['id']} ที่ข้อ {it['key']} จะแก้ — ดูหน้าเทียบใหม่อีกครั้ง")
            target.update(copy.deepcopy(op.get("set") or {}))
        for k, rows in (op.get("writeback") or {}).items():
            writeback[k].extend(copy.deepcopy(rows))

    # 2) แถวแผน — คาบก่อน แล้วครู (แถวคู่ที่ข้อเปลี่ยนครูลบ ไม่ถูกแก้คาบ) · แถวใหม่ต่อท้ายตามลำดับข้อ
    weekly: dict[Any, int] = {}
    fields: dict[Any, dict[str, Any]] = {}
    delete: set[Any] = set()
    add: list[dict[str, Any]] = []
    for it in applied:
        op = it["apply"]
        if it["pile"] == "weekly":
            weekly.update({rid: w for rid, w in op["rows"]})
        elif it["pile"] == "teacher":
            for rid, want in op["rows"]:
                fields.setdefault(rid, {}).update(want)
            delete.update(op["delete"])
            add.extend(op["add"])
        elif it["pile"] == "new":
            add.extend(op["add"])
        elif it["pile"] == "removed":
            delete.update(op["delete"])
    requirements: list[dict[str, Any]] = []
    written: list[dict[str, Any]] = []
    for r in live.get("requirements") or []:
        if r.get("id") in delete:
            continue
        r = copy.deepcopy(r)
        if r.get("id") in weekly:
            r["weekly_count"] = weekly[r["id"]]
            written.append(r)
        r.update(copy.deepcopy(fields.get(r.get("id")) or {}))
        requirements.append(r)
    for row in add:
        r = {"id": _next_id(counters, "requirement"), **copy.deepcopy(row)}
        requirements.append(r)
        written.append(r)

    # 3) หลักสูตร
    _extend_curricula(curricula, groups, written)

    # 4) คาบเสรี — pool ยังไม่ลงคาบเท่านั้น (ข้อ auto=False ไม่แตะ pool)
    marked: set[Any] = set()
    for it in applied:
        op = it["apply"]
        if it["pile"] != "sets" or not it["auto"]:
            continue
        marked |= set(op.get("mark_elective") or [])
        if op["op"] == "pool_add":
            p = copy.deepcopy(op["pool"])
            p["id"] = _next_id(counters, "elective_pool")
            p["options"] = [{"key": _next_id(counters, "elective_option"), **o} for o in p["options"]]
            pools.append(p)
            continue
        p = next((x for x in pools if x.get("id") == op["pool_id"]), None)
        if p is None:
            raise ValueError(f"ไม่พบคาบเสรีรหัส {op['pool_id']} ที่ข้อ {it['key']} จะแก้ — ดูหน้าเทียบใหม่อีกครั้ง")
        if op["op"] == "pool_delete":
            pools.remove(p)
            continue
        gone = {(s, t) for s, t in op["remove"]}
        new = [{"key": _next_id(counters, "elective_option"), **copy.deepcopy(o)} for o in op["add"]]
        p["options"] = [o for o in p.get("options") or [] if (o.get("subject_id"), o.get("teacher_id") or None) not in gone]
        p["options"] += new
        p["weekly"], p["is_double"] = op["weekly"], op["is_double"]
    for s in subjects:
        if s.get("id") in marked and not s.get("is_elective"):
            s["is_elective"] = True

    # 5) รายการงาน — ตามลำดับข้อ
    names = _Names(groups, teachers, subjects, live.get("rooms"))
    placed_of = _placed_of(live.get("slots") or [])
    final = _lessons(requirements)
    todos: list[dict[str, Any]] = []
    done_cells: set[tuple] = set()
    for it in applied:
        op, pile = it["apply"], it["pile"]
        if pile in ("new", "weekly", "removed"):
            cell = (it["group_id"], it["subject_id"])
            placed = placed_of.get(cell, 0)
            if not placed or cell in done_cells:
                continue
            done_cells.add(cell)
            total = sum(max(x["w"]) for x in final.get(cell, []))
            where = f"{names.g(cell[0])} {names.s(cell[1])}"
            if placed < total:
                todos.append({"kind": "missing", "group_id": cell[0], "subject_id": cell[1], "done": False,
                              "text": f"{where}: ขาด {total - placed} คาบ (แผน {total} คาบ · ลงไว้ {placed} คาบ) "
                                      "— ลงคาบเพิ่มในหน้าจัดคาบ"})
            elif placed > total:
                gone = "แถวแผนถูกลบแล้ว แต่" if total == 0 else ""
                todos.append({"kind": "over", "group_id": cell[0], "subject_id": cell[1], "done": False,
                              "text": f"{where}: {gone}เกินแผน {placed - total} คาบ (แผน {total} คาบ · ลงไว้ {placed} คาบ) "
                                      "— คาบยังอยู่ ลบเองในหน้าจัดคาบถ้าไม่สอนแล้ว"})
        elif pile == "teacher":
            before, after = it["before"], it["after"]
            # ช่องที่เปลี่ยน (ครูผู้สอน · ครูสอนร่วม · ห้องปฏิบัติการ) — todo_status ตรวจเฉพาะช่องเหล่านี้กับคาบที่ลงไว้
            changed = [f for f in TEACHER_FIELDS if before.get(f) != after.get(f)]
            if it["placed"] and changed:
                parts = []
                if "teacher_id" in changed:
                    parts.append(f"ครู {names.t(before['teacher_id'])} — แผนเปลี่ยนเป็นครู {names.t(after['teacher_id'])}")
                if "co_teacher_id" in changed:
                    parts.append(f"ครูสอนร่วม {names.t(before['co_teacher_id']) if before['co_teacher_id'] else 'ไม่มี'}"
                                 f" — แผนเปลี่ยนเป็น {names.t(after['co_teacher_id']) if after['co_teacher_id'] else 'ไม่มี'}")
                if "room_id" in changed:
                    parts.append(f"ห้องปฏิบัติการ ({names.room(before['room_id'])}) — "
                                 f"แผนเปลี่ยนเป็น ({names.room(after['room_id'])})")
                todos.append({"kind": "teacher", "group_id": it["group_id"], "subject_id": it["subject_id"],
                              "teacher_id": after["teacher_id"], "fields": changed, "done": False,
                              "text": f"{names.g(it['group_id'])} {names.s(it['subject_id'])}: คาบที่ลงไว้ยังเป็น "
                                      + " · ".join(parts) + " แก้ในหน้าจัดคาบ"})
        elif pile == "sets" and op.get("todo"):
            todos.append(set_todo(it))

    return {"teachers": teachers, "subjects": subjects, "requirements": requirements, "pools": pools,
            "curricula": curricula, "group_curricula": {gid: g.get("curriculum_id") for gid, g in groups.items()},
            "counters": counters, "writeback": writeback, "todos": todos,
            "applied": [it["key"] for it in applied], "skipped": [it["key"] for it in items if it["key"] not in chosen]}


def set_todo(item: dict[str, Any]) -> dict[str, Any] | None:
    """ข้องานชนิด set ที่ข้อในกองชุดสร้างเมื่อถูกติ๊ก (apply มี "todo") — ตัวเดียวที่ plan_apply ใช้ · ไม่ใช่ข้อแบบนั้น = None · ไม่แก้ item"""
    op = item.get("apply") or {}
    if item.get("pile") != "sets" or not op.get("todo"):
        return None
    gids = (item.get("after") or item.get("before") or {}).get("group_ids") or [None]
    return {"kind": "set", "group_id": gids[0], "subject_id": None, "done": False, "text": op["todo"]}


def split_listed(items: list[dict[str, Any]], todos: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """แยกข้อที่ "เข้ารายการงานอย่างเดียว" (apply.op = todo — ไม่เปลี่ยนข้อมูล จึงขึ้นทุกครั้งที่ดูหน้าเทียบ) ซึ่งมีข้องานเดียวกัน (kind
    group_id subject_id text) ที่ยังไม่กด "ทำแล้ว" อยู่ในรายการงานแล้ว ออกจากข้อที่ติ๊กได้ — ไม่งั้น "เลือกทั้งกอง" ครั้งถัดไปต่อข้องานซ้ำ
    (คำตัดสินผู้คุม Task 4 รอบแก้ 1) · ข้อที่เปลี่ยนข้อมูลด้วย (เช่นสร้าง pool + ข้องานให้ลงคาบ) ไม่ถูกแยก · ข้องานที่กด "ทำแล้ว" แต่ปัญหา
    ยังอยู่ = ข้อกลับมาให้ติ๊กได้ → (items ที่เหลือตามลำดับเดิม, [{key, pile, label}] ของข้อที่อยู่ในรายการงานแล้ว) · ไม่แก้ขาเข้า"""
    have = {(t.get("kind"), t.get("group_id"), t.get("subject_id"), t.get("text")) for t in todos if not t.get("done")}
    keep: list[dict[str, Any]] = []
    listed: list[dict[str, Any]] = []
    for it in items:
        t = set_todo(it) if (it.get("apply") or {}).get("op") == "todo" else None
        if t is not None and (t["kind"], t["group_id"], t["subject_id"], t["text"]) in have:
            listed.append({"key": it["key"], "pile": it["pile"], "label": it["label"]})
        else:
            keep.append(it)
    return keep, listed


# ── สถานะสดของรายการงานที่ต้องไปแก้เอง (แบบข้อ 4.4) ───────────────────────────────────────────
def todo_status(todos: list[dict[str, Any]], requirements: list[dict[str, Any]],
                slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """เพิ่ม state ("open"|"resolved") และ detail (ไทย) ให้แต่ละข้อ — คิดสดจากแผน (requirements) เทียบคาบที่ลงจริง (slots) · ฟังก์ชันล้วน

    missing = คาบในแผนของ (ห้อง, วิชา) มากกว่าคาบที่ลง · over = คาบที่ลงมากกว่าแผน (ไม่มีแถวแผนแล้ว = แผนเป็น 0) ·
    teacher = มีคาบของ (ห้อง, วิชา) ที่ช่องใน fields (ไม่มี = ["teacher_id"]) ไม่ตรงแถวแผน (ห้อง: เฉพาะเมื่อแผนกำหนดห้อง) ·
    set = ไม่มีเงื่อนไขอัตโนมัติ เปิดจน done · ชนิดอื่นนอกจากนี้ = เปิดจน done
    done ไม่บังคับ resolved ของ missing/teacher/over (คำตัดสินผู้คุม): done = ผู้ใช้กดรับทราบ/ซ่อน ถ้าเงื่อนไขกลับมา (มีคนย้ายคาบ)
    ต้องคืน open ตามจริง · ไม่แก้ที่ส่งเข้ามา · แต่ละข้อได้ dict ใหม่ (คีย์เดิมครบ)
    """
    placed_of = _placed_of(slots)
    lessons = _lessons(list(requirements))
    by_cell: dict[tuple, list[dict[str, Any]]] = {}
    for s in slots:
        if s.get("subject_id") is not None and not s.get("is_overflow"):
            by_cell.setdefault((s.get("group_id"), s.get("subject_id")), []).append(s)
    field_text = {"teacher_id": "ครูผู้สอน", "co_teacher_id": "ครูสอนร่วม", "room_id": "ห้องปฏิบัติการ"}
    out: list[dict[str, Any]] = []
    for todo in todos:
        cell = (todo.get("group_id"), todo.get("subject_id"))
        kind = todo.get("kind")
        state, detail = "open", ""
        if kind in ("missing", "over"):
            plan = sum(max(x["w"]) for x in lessons.get(cell, []))
            placed = placed_of.get(cell, 0)
            if kind == "missing" and plan > placed:
                detail = f"ยังขาด {plan - placed} คาบ (แผน {plan} คาบ · ลงไว้ {placed} คาบ)"
            elif kind == "over" and placed > plan:
                detail = f"ยังเกินแผน {placed - plan} คาบ (แผน {plan} คาบ · ลงไว้ {placed} คาบ)"
            else:
                state, detail = "resolved", f"เรียบร้อย — แผน {plan} คาบ · ลงไว้ {placed} คาบ"
        elif kind == "teacher":
            wanted = [f for f in (todo.get("fields") or ["teacher_id"]) if f in TEACHER_FIELDS]
            lv = lessons.get(cell, [])
            if not lv:
                state, detail = "resolved", "ไม่มีแถวแผนของห้องและวิชานี้แล้ว"
            else:
                tc = [f for f in wanted if f != "room_id"]

                def wrong(l: dict[str, Any], s: dict[str, Any]) -> list[str]:
                    """ช่อง (ครูผู้สอน/ครูสอนร่วม) ของคาบที่ไม่ตรงแถวแผน l — ว่าง = ตรงทั้งแถว · คู่สอนร่วม (พับสองแถว) เทียบเป็นคู่ไม่เรียงลำดับ
                    (คาบเก็บจากฝั่งคู่ได้) · แถวเดี่ยวที่ไม่มีครูสอนร่วมจับได้เฉพาะคาบที่ไม่มีครูสอนร่วม"""
                    t, co = s.get("teacher_id") or None, s.get("co_teacher_id") or None
                    if len(l["rows"]) == 2:
                        pair = {l["t"][0], l["t"][1]}
                        if {t, co} == pair:
                            return []
                        return [f for f, v in (("teacher_id", t), ("co_teacher_id", co)) if v not in pair] or ["co_teacher_id"]
                    return [f for f, v, w in (("teacher_id", t, l["t"][0]), ("co_teacher_id", co, l["t"][1])) if v != w]
                bad: dict[str, int] = {}
                for s in by_cell.get(cell, []):
                    # จับคาบกับแถวแผน "ทั้งแถว" ครั้งเดียวต่อคาบ แล้วค่อยรายงานช่อง — ไม่เทียบทีละช่องกับแถวใดก็ได้
                    # (คาบ (6, สอนร่วม 7) ไม่ตรงทั้ง [6 สอนร่วม 9] และ [8 สอนร่วม 7] แต่ทีละช่องจะผ่านทั้งคู่)
                    fits = [(wrong(l, s), l) for l in lv]
                    hit = next((l for w, l in fits if not w), None)
                    if hit is None:
                        if tc:
                            for f in min((w for w, _l in fits), key=len):
                                bad[f] = bad.get(f, 0) + 1
                        continue                # จับแถวไม่ได้ = ข้ามการตรวจห้อง (ช่องครูรายงานแล้ว)
                    if "room_id" in wanted and hit["t"][2] and (s.get("room_id") or None) != hit["t"][2]:
                        bad["room_id"] = bad.get("room_id", 0) + 1
                if bad:
                    detail = "ยังไม่ตรงแผน: " + " · ".join(f"{field_text[f]} {n} คาบ" for f, n in bad.items())
                else:
                    state, detail = "resolved", "เรียบร้อย — คาบที่ลงไว้ตรงแผนแล้ว"
        elif todo.get("done"):
            state, detail = "resolved", "ทำแล้ว"
        else:
            detail = "ต้องไปแก้เอง แล้วกด “ทำแล้ว”"
        out.append({**todo, "state": state, "detail": detail})
    return out
