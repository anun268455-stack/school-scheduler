"""
ทาง ข. งานที่ 2: รายการงานที่ต้องไปแก้เอง — สถานะสดจากแผนเทียบคาบ · เก็บใน snapshot · สอง route

ข้อหน่วย: plan_diff.todo_status (ฟังก์ชันล้วน) · snapshot ไปกลับ และคีย์หาย = ว่าง · เทอมใหม่เริ่มว่างทั้งสองทาง (ใช้ฐานปลอมของ wlexportcreate.py)
· route GET/POST พร้อมตัวกันเทอมปิด · ไม่มีการเขียน SLOTS/PARKED ในโค้ดใหม่ (ตัวทดสอบ tests/py/terms.py termguard.py ไม่แก้)
ทุกตัวแปรของโปรแกรมที่แตะถูกคืนตอนจบไฟล์ (คำตัดสิน P1)
"""
import asyncio
import copy
import gzip
import inspect
import json
import os
import sys
from types import SimpleNamespace

import mock_api
import plan_diff as D
import wlexportcreate as C
import wlexportplan as P
from wlcurriculum import _patched

fails: list[str] = []

_WATCH = P._TOUCHED + ("CURRENT_TERM", "REVISION", "ROOMS", "PLAN_TODOS", "SCHOOL_CONFIG")
_START = copy.deepcopy({k: getattr(mock_api, k) for k in _WATCH})
_IDS = {k: id(getattr(mock_api, k)) for k in _WATCH}


def _req(i, g, s, t, weekly=2, **kw):
    return {"id": i, "group_id": g, "subject_id": s, "teacher_id": t, "weekly_count": weekly,
            "parallel_group_key": None, **kw}


def _slot(i, g, s, t, **kw):
    return {"id": i, "group_id": g, "subject_id": s, "teacher_id": t, "day": 0, "period": i, **kw}


def _todo(i, kind, g, s, **kw):
    return {"id": i, "update_id": 1, "kind": kind, "group_id": g, "subject_id": s, "text": f"ข้อ {i}", "done": False, **kw}


def _st(todos, reqs, slots):
    return {t["id"]: (t["state"], t["detail"]) for t in D.todo_status(todos, reqs, slots)}


# ── ฟังก์ชันล้วน ──────────────────────────────────────────────────────────
def test_four_kinds_open_then_resolved():
    reqs = [_req(1, 1, 1, 5, 3), _req(2, 1, 2, 4, 2)]            # ห้อง 2 วิชา 3 ไม่มีแถวแผนแล้ว
    slots = [_slot(1, 1, 1, 5), _slot(2, 1, 1, 5), _slot(3, 1, 2, 3), _slot(4, 1, 2, 3),
             _slot(5, 2, 3, 9), _slot(6, 2, 3, 9)]
    todos = [_todo(1, "missing", 1, 1), _todo(2, "teacher", 1, 2, teacher_id=4), _todo(3, "over", 2, 3),
             _todo(4, "set", 1, None)]
    before = copy.deepcopy((todos, reqs, slots))
    got = _st(todos, reqs, slots)
    assert (todos, reqs, slots) == before                              # ไม่แก้ของที่ส่งเข้ามา
    assert [got[i][0] for i in (1, 2, 3, 4)] == ["open"] * 4, got
    assert "ขาด 1 คาบ" in got[1][1] and "ครูผู้สอน 2 คาบ" in got[2][1] and "เกินแผน 2 คาบ" in got[3][1], got
    out = D.todo_status(todos, reqs, slots)
    assert [{k: v for k, v in t.items() if k not in ("state", "detail")} for t in out] == todos
    # ลงคาบเพิ่มจนครบ · เปลี่ยนครูของคาบ · ลบคาบที่เกิน · กด "ทำแล้ว" ของชุด
    slots2 = slots[:2] + [_slot(7, 1, 1, 5)] + [dict(slots[2], teacher_id=4), dict(slots[3], teacher_id=4)]
    todos2 = [dict(todos[0]), dict(todos[1]), dict(todos[2]), dict(todos[3], done=True)]
    got = _st(todos2, reqs, slots2)
    assert [got[i][0] for i in (1, 2, 3, 4)] == ["resolved"] * 4, got
    assert "เรียบร้อย" in got[1][1] and "ทำแล้ว" in got[4][1], got


def test_missing_over_boundaries_and_overflow_slots():
    reqs = [_req(1, 1, 1, 5, 3)]
    todos = [_todo(1, "missing", 1, 1), _todo(2, "over", 1, 1)]
    for n, want in ((2, ("open", "resolved")), (3, ("resolved", "resolved")), (4, ("resolved", "open"))):
        got = _st(todos, reqs, [_slot(i, 1, 1, 5) for i in range(n)])
        assert (got[1][0], got[2][0]) == want, (n, got)
    # คาบกรอบแดง (is_overflow) ไม่นับเป็นคาบที่ลง — กฎเดียวกับ _placed_of
    got = _st(todos, reqs, [_slot(i, 1, 1, 5, is_overflow=(i == 2)) for i in range(3)])
    assert got[1][0] == "open", got
    # แถวแผนหายไปหมด (ถูกลบ): แผน = 0 → over เปิดจนไม่มีคาบเหลือ · แถวคู่สอนร่วมที่พับแล้วนับคาบครั้งเดียว
    assert _st([_todo(3, "over", 1, 9)], reqs, [_slot(1, 1, 9, 5)])[3][0] == "open"
    assert _st([_todo(3, "over", 1, 9)], reqs, [])[3][0] == "resolved"
    pair = [_req(1, 1, 1, 5, 3, co_teacher_id=6), _req(2, 1, 1, 6, 3, co_teacher_id=5)]
    got = _st([_todo(1, "missing", 1, 1), _todo(2, "over", 1, 1)], pair, [_slot(i, 1, 1, 5, co_teacher_id=6) for i in range(3)])
    assert (got[1][0], got[2][0]) == ("resolved", "resolved"), got


def test_done_does_not_force_resolved_and_reopens():
    # คำตัดสินผู้คุมข้อ 2: missing/teacher/over คิดสดเสมอ — done = ผู้ใช้รับทราบแล้ว แต่ถ้าเงื่อนไขยังอยู่/กลับมา ต้องเป็น open
    reqs = [_req(1, 1, 1, 4, 3)]
    todos = [_todo(1, "missing", 1, 1, done=True), _todo(2, "teacher", 1, 1, teacher_id=4, done=True),
             _todo(3, "over", 1, 1, done=True)]
    got = _st(todos, reqs, [_slot(1, 1, 1, 5)])
    assert (got[1][0], got[2][0], got[3][0]) == ("open", "open", "resolved"), got
    got = _st(todos, reqs, [_slot(i, 1, 1, 4) for i in range(4)])
    assert (got[1][0], got[3][0]) == ("resolved", "open"), got
    # ชุด: done → resolved เสมอ · ไม่ done → open · ชนิดแปลกก็เปิดจน done
    assert _st([_todo(1, "set", 1, None)], [], [])[1][0] == "open"
    assert _st([_todo(1, "set", 1, None, done=True)], [], [])[1][0] == "resolved"
    assert _st([_todo(1, "other", 1, None)], [], [])[1][0] == "open"


def test_teacher_todo_covers_teacher_co_teacher_and_room():
    reqs = [_req(1, 1, 1, 5, 3, co_teacher_id=7, room_id=30)]
    slots = [_slot(1, 1, 1, 5, co_teacher_id=6, room_id=31), _slot(2, 1, 1, 5, co_teacher_id=6, room_id=31)]
    todos = [_todo(1, "teacher", 1, 1, teacher_id=5, fields=["teacher_id"]),
             _todo(2, "teacher", 1, 1, teacher_id=5, fields=["co_teacher_id"]),
             _todo(3, "teacher", 1, 1, teacher_id=5, fields=["room_id"]),
             _todo(4, "teacher", 1, 1, teacher_id=5, fields=["teacher_id", "co_teacher_id", "room_id"]),
             _todo(5, "teacher", 1, 1, teacher_id=5)]                 # ข้อเก่าไม่มี fields = ["teacher_id"]
    # คาบ (5, สอนร่วม 6) ไม่ตรงแถวแผน (5, สอนร่วม 7) ทั้งแถว → ข้อที่ครอบครู/ครูสอนร่วมเปิด (รายงานช่องที่ผิดจริง คือครูสอนร่วม)
    # ข้อที่ครอบแต่ห้อง: คาบที่จับแถวไม่ได้ข้ามการตรวจห้อง
    got = _st(todos, reqs, slots)
    assert [got[i][0] for i in (1, 2, 3, 4, 5)] == ["open", "open", "resolved", "open", "open"], got
    assert all(got[i][1] == "ยังไม่ตรงแผน: ครูสอนร่วม 2 คาบ" for i in (1, 2, 4, 5)), got
    # คาบจับแถวได้ (5, สอนร่วม 7) แต่อยู่ห้อง 31 ≠ 30 → เฉพาะข้อที่ครอบห้องเปิด
    matched = [dict(s, co_teacher_id=7) for s in slots]
    got = _st(todos, reqs, matched)
    assert [got[i][0] for i in (1, 2, 3, 4, 5)] == ["resolved", "resolved", "open", "open", "resolved"], got
    assert "ห้องปฏิบัติการ 2 คาบ" in got[3][1] and got[4][1] == "ยังไม่ตรงแผน: ห้องปฏิบัติการ 2 คาบ", got
    fixed = [dict(s, co_teacher_id=7, room_id=30) for s in slots]
    got = _st(todos, reqs, fixed)
    assert all(v[0] == "resolved" for v in got.values()), got
    # แผนไม่กำหนดห้อง: ไม่ตรวจห้อง (ห้องของคาบเป็นอะไรก็ได้) · แผนไม่มีครูสอนร่วมแต่คาบมี = ไม่ตรง
    reqs2 = [_req(1, 1, 1, 5, 3)]
    got = _st(todos, reqs2, slots)
    assert (got[2][0], got[3][0]) == ("open", "resolved"), got
    got = _st(todos, reqs2, [_slot(1, 1, 1, 5, room_id=31)])
    assert (got[2][0], got[3][0], got[4][0]) == ("resolved", "resolved", "resolved"), got
    # ไม่มีแถวแผนของ (ห้อง, วิชา) แล้ว → ตรวจครูไม่ได้ ถือเรียบร้อย (ข้อ over ของแถวที่ลบเป็นตัวบอกคาบที่เหลือ)
    assert _st([_todo(1, "teacher", 1, 1, teacher_id=5)], [], slots)[1][0] == "resolved"


def test_coteach_pair_teacher_todo_matches_the_pair_not_each_seat():
    # I1: แผนหลังเปลี่ยน [8 สอนร่วม 6],[6 สอนร่วม 8] (ครู 5 ถูกแทนด้วย 8) · คาบเก็บได้ทั้งฝั่งแถวแรกและฝั่งคู่
    pair = [_req(1, 1, 1, 8, 3, co_teacher_id=6), _req(2, 1, 1, 6, 3, co_teacher_id=8)]
    t_todo, co_todo = _todo(1, "teacher", 1, 1, teacher_id=8, fields=["teacher_id"]), \
        _todo(2, "teacher", 1, 1, teacher_id=8, fields=["co_teacher_id"])
    for slot, want in ((_slot(1, 1, 1, 6, co_teacher_id=5), "open"),      # ครู 5 ยังอยู่ในคาบ (ฝั่งคู่)
                       (_slot(1, 1, 1, 5, co_teacher_id=6), "open"),      # ฝั่งแถวแรก
                       (_slot(1, 1, 1, 8, co_teacher_id=6), "resolved"),
                       (_slot(1, 1, 1, 6, co_teacher_id=8), "resolved"),  # ฝั่งคู่ ตรงแผน (สลับข้างได้)
                       (_slot(1, 1, 1, 8), "open")):                      # ขาดครูสอนร่วมของคู่
        got = _st([t_todo, co_todo], pair, [slot])
        assert (got[1][0], got[2][0]) == (want, want), (slot, got)
    # ครูสอนร่วมเปลี่ยน: แผน [5 สอนร่วม 8],[8 สอนร่วม 5] · คาบ (6, สอนร่วม 5) ยังมีครู 6 ที่ถูกแทน
    pair2 = [_req(1, 1, 1, 5, 3, co_teacher_id=8), _req(2, 1, 1, 8, 3, co_teacher_id=5)]
    got = _st([_todo(1, "teacher", 1, 1, teacher_id=5, fields=["co_teacher_id"])], pair2, [_slot(1, 1, 1, 6, co_teacher_id=5)])
    assert got[1][0] == "open", got
    got = _st([_todo(1, "teacher", 1, 1, teacher_id=5, fields=["co_teacher_id"])], pair2, [_slot(1, 1, 1, 8, co_teacher_id=5)])
    assert got[1][0] == "resolved", got
    # ครูกับครูสอนร่วมของแถวเดียวกันเท่านั้น: แถวเดี่ยว (5 สอนร่วม 7) คาบ (7, สอนร่วม 5) ไม่ตรงทั้งสองช่อง
    one = [_req(1, 1, 1, 5, 3, co_teacher_id=7)]
    got = _st([_todo(1, "teacher", 1, 1, teacher_id=5, fields=["teacher_id", "co_teacher_id"])], one,
              [_slot(1, 1, 1, 7, co_teacher_id=5)])
    assert got[1][0] == "open" and "ครูผู้สอน 1 คาบ" in got[1][1] and "ครูสอนร่วม 1 คาบ" in got[1][1], got


def test_room_checked_only_against_the_plan_row_the_slot_belongs_to():
    # m1: สองบทเรียนในห้อง+วิชาเดียว: ครู 5 มีห้องปฏิบัติการ 30 · ครู 7 ไม่กำหนดห้อง
    reqs = [_req(1, 1, 1, 5, 2, room_id=30), _req(2, 1, 1, 7, 2)]
    todo = [_todo(1, "teacher", 1, 1, teacher_id=5, fields=["room_id"])]
    got = _st(todo, reqs, [_slot(1, 1, 1, 5, room_id=30), _slot(2, 1, 1, 7, room_id=12)])
    assert got[1][0] == "resolved", got                              # คาบของครู 7 อยู่ห้องอะไรก็ได้ (แถวของมันไม่กำหนดห้อง)
    got = _st(todo, reqs, [_slot(1, 1, 1, 5, room_id=31), _slot(2, 1, 1, 7, room_id=12)])
    assert got[1][0] == "open" and "ห้องปฏิบัติการ 1 คาบ" in got[1][1], got
    # คาบที่จับคู่กับแถวแผนไม่ได้ (ครู 9) ข้ามการตรวจห้อง — ช่องครูเป็นตัวรายงาน
    got = _st(todo + [_todo(2, "teacher", 1, 1, teacher_id=5, fields=["teacher_id"])], reqs, [_slot(1, 1, 1, 9, room_id=12)])
    assert (got[1][0], got[2][0]) == ("resolved", "open"), got
    # คู่สอนร่วมที่มีห้อง: คาบทั้งสองฝั่งต้องอยู่ห้องของคู่
    pair = [_req(1, 1, 1, 5, 2, co_teacher_id=6, room_id=30), _req(2, 1, 1, 6, 2, co_teacher_id=5)]
    got = _st(todo, pair, [_slot(1, 1, 1, 5, co_teacher_id=6, room_id=30), _slot(2, 1, 1, 6, co_teacher_id=5, room_id=30)])
    assert got[1][0] == "resolved", got
    got = _st(todo, pair, [_slot(1, 1, 1, 6, co_teacher_id=5, room_id=12)])
    assert got[1][0] == "open", got


def test_single_rows_in_a_cell_are_matched_whole_once_per_slot():
    # I1 (รอบ 2): ห้อง+วิชามีสองแถวเดี่ยว · คาบต้องตรง "ทั้งแถว" (ครู+ครูสอนร่วม) แถวใดแถวหนึ่ง ไม่ใช่ผ่านทีละช่องกับแถวใดก็ได้
    reqs = [_req(1, 1, 1, 6, 2, co_teacher_id=9), _req(2, 1, 1, 8, 2, co_teacher_id=7)]
    for fields in (["co_teacher_id"], ["teacher_id"], ["teacher_id", "co_teacher_id"]):
        got = _st([_todo(1, "teacher", 1, 1, teacher_id=6, fields=fields)], reqs, [_slot(1, 1, 1, 6, co_teacher_id=7)])
        assert got[1][0] == "open", (fields, got)
    # ช่องที่ผิดจริง: ใกล้แถว [8 สอนร่วม 7] หรือ [6 สอนร่วม 9] เท่ากัน → รายงานช่องที่ต่างจากแถวใกล้สุด (หนึ่งช่อง ไม่ใช่ "ครูผู้สอน" เสมอ)
    got = _st([_todo(1, "teacher", 1, 1, teacher_id=6, fields=["teacher_id"])], reqs, [_slot(1, 1, 1, 6, co_teacher_id=7)])
    assert got[1][1] in ("ยังไม่ตรงแผน: ครูสอนร่วม 1 คาบ", "ยังไม่ตรงแผน: ครูผู้สอน 1 คาบ"), got
    # แถวที่ไม่มีครูสอนร่วมจับได้เฉพาะคาบที่ไม่มีครูสอนร่วม: [5 สอนร่วม 7],[8] · คาบ (8, สอนร่วม 7)
    reqs2 = [_req(1, 1, 1, 5, 2, co_teacher_id=7), _req(2, 1, 1, 8, 2)]
    got = _st([_todo(1, "teacher", 1, 1, teacher_id=5, fields=["teacher_id"])], reqs2, [_slot(1, 1, 1, 8, co_teacher_id=7)])
    assert got[1][0] == "open" and got[1][1] in ("ยังไม่ตรงแผน: ครูสอนร่วม 1 คาบ", "ยังไม่ตรงแผน: ครูผู้สอน 1 คาบ"), got
    # ต้องยังเรียบร้อย: [6 สอนร่วม 9],[8 สอนร่วม 7] กับคาบ (6, 9) และ (8, 7) · คาบฝั่งคู่ (9 สอนร่วม 6) ของแถวคู่เท่านั้นที่สลับข้างได้
    ok = [_slot(1, 1, 1, 6, co_teacher_id=9), _slot(2, 1, 1, 8, co_teacher_id=7)]
    got = _st([_todo(1, "teacher", 1, 1, teacher_id=6, fields=["teacher_id", "co_teacher_id", "room_id"])], reqs, ok)
    assert got[1][0] == "resolved", got
    pair_plus = [_req(1, 1, 1, 6, 2, co_teacher_id=9), _req(2, 1, 1, 9, 2, co_teacher_id=6), _req(3, 1, 1, 8, 2, co_teacher_id=7)]
    got = _st([_todo(1, "teacher", 1, 1, teacher_id=6, fields=["teacher_id"])], pair_plus,
              [_slot(1, 1, 1, 9, co_teacher_id=6), _slot(2, 1, 1, 8, co_teacher_id=7)])
    assert got[1][0] == "resolved", got
    # ห้องตามแถวที่จับได้ทั้งแถว (ไม่จับด้วยครูอย่างเดียว): [6 สอนร่วม 9 ห้อง 30],[8 สอนร่วม 7]
    reqs3 = [_req(1, 1, 1, 6, 2, co_teacher_id=9, room_id=30), _req(2, 1, 1, 8, 2, co_teacher_id=7)]
    todo = [_todo(1, "teacher", 1, 1, teacher_id=6, fields=["room_id"])]
    assert _st(todo, reqs3, [_slot(1, 1, 1, 6, co_teacher_id=9, room_id=31)])[1][0] == "open"
    assert _st(todo, reqs3, [_slot(1, 1, 1, 6, co_teacher_id=9, room_id=30), _slot(2, 1, 1, 8, co_teacher_id=7, room_id=12)])[1][0] == "resolved"
    assert _st(todo, reqs3, [_slot(1, 1, 1, 6, co_teacher_id=7, room_id=31)])[1][0] == "resolved"      # จับแถวไม่ได้ → ข้ามห้อง


def test_plan_apply_makes_teacher_todo_with_fields():
    live = {"teachers": [{"id": 5, "name": "ครู ก"}, {"id": 6, "name": "ครู ข"}, {"id": 7, "name": "ครู ค"}],
            "subjects": [{"id": 1, "code": "ค1", "name": "คณิต"}], "groups": {1: {"id": 1, "name": "ม.1/1"}},
            "requirements": [_req(1, 1, 1, 5, 3, co_teacher_id=6, room_id=30)], "pools": [], "curricula": [], "slots":
            [_slot(1, 1, 1, 5, co_teacher_id=6, room_id=30)]}
    after = {"teacher_id": 5, "co_teacher_id": 7, "room_id": None}
    item = {"key": "teacher:1:1:1", "pile": "teacher", "group_id": 1, "subject_id": 1, "placed": 1, "auto": True,
            "requires": [], "before": {"teacher_id": 5, "co_teacher_id": 6, "room_id": 30}, "after": after,
            "apply": {"op": "teacher", "rows": [[1, {"co_teacher_id": 7, "room_id": None}]], "delete": [], "add": []}}
    res = D.plan_apply({"items": [item]}, live, {item["key"]}, {"requirement": 5})
    t, = res["todos"]
    assert (t["kind"], t["teacher_id"], t["fields"], t["done"]) == ("teacher", 5, ["co_teacher_id", "room_id"], False), t
    assert "ครูสอนร่วม" in t["text"] and "ห้องปฏิบัติการ" in t["text"] and "ครูผู้สอน" not in t["text"], t["text"]
    # ผลของ todo_status ต่อข้อนี้: คาบยังเป็นครูสอนร่วม/ห้องเดิม → open · ลงใหม่ตามแผน → resolved
    assert D.todo_status(res["todos"], res["requirements"], live["slots"])[0]["state"] == "open"
    fixed = [dict(live["slots"][0], co_teacher_id=7, room_id=None)]
    assert D.todo_status(res["todos"], res["requirements"], fixed)[0]["state"] == "resolved"
    # ไม่ลงคาบไว้ / ไม่มีช่องเปลี่ยน = ไม่มีข้อ
    assert D.plan_apply({"items": [dict(item, placed=0)]}, live, {item["key"]}, {"requirement": 5})["todos"] == []


# ── snapshot ─────────────────────────────────────────────────────────────
def _scratch():
    return P._scratch()


def test_snapshot_roundtrip_and_missing_key_is_empty():
    todos = [_todo(1, "missing", 1, 1, done=True), _todo(2, "teacher", 1, 2, teacher_id=4, fields=["room_id"]),
             _todo(7, "set", 1, None)]
    with _scratch(), _patched(CURRENT_TERM=dict(mock_api.CURRENT_TERM), REVISION=dict(mock_api.REVISION),
                              SCHOOL_CONFIG=copy.deepcopy(mock_api.SCHOOL_CONFIG), PLAN_TODOS=copy.deepcopy(todos)):
        snap = mock_api._snapshot()
        assert snap["plan_todos"] == todos and snap["plan_todos"] is not mock_api.PLAN_TODOS
        assert snap["plan_todos"][0] is not mock_api.PLAN_TODOS[0]         # สำเนา: ล้างตารางแล้ว snapshot ไม่ว่างตาม
        blob = mock_api._unpack(mock_api._pack(snap))                      # ผ่านไฟล์เทอม/สำรองจริง (บีบอัด JSON)
        assert blob["plan_todos"] == todos
        mock_api.PLAN_TODOS.clear()
        mock_api.PLAN_TODOS.append(_todo(99, "over", 3, 3))                # ของภาคก่อนที่ค้างในหน่วยความจำ
        ident = id(mock_api.PLAN_TODOS)
        mock_api._apply_snapshot(blob)
        assert mock_api.PLAN_TODOS == todos and id(mock_api.PLAN_TODOS) == ident
        assert mock_api._counters["todo"] >= 7                             # ตัวนับเดินต่อเหนือรหัสที่มี (Task 4 ใช้ออกรหัส)
        # ไฟล์เก่าไม่มีคีย์ → ว่าง (ไม่ใช่คงของเดิมไว้)
        old = {k: v for k, v in blob.items() if k != "plan_todos"}
        mock_api._apply_snapshot(old)
        assert mock_api.PLAN_TODOS == [] and id(mock_api.PLAN_TODOS) == ident
        mock_api.PLAN_TODOS.append(_todo(5, "over", 1, 1))
        mock_api._apply_snapshot({**old, "plan_todos": None})
        assert mock_api.PLAN_TODOS == []


# ── สร้างเทอมใหม่ทั้งสองทางเริ่มว่าง ────────────────────────────────────────────
OLD = [_todo(1, "missing", 1, 1), _todo(2, "set", 1, None, done=True)]


def test_create_term_old_path_starts_empty_and_old_file_keeps_todos():
    with _patched(PLAN_TODOS=copy.deepcopy(OLD)), C._world() as rec:
        db, _t, _rnd = C._scenario()
        rec.use(db)
        ident = id(mock_api.PLAN_TODOS)
        mock_api.create_term({"year": 2569, "semester": 2})
        assert mock_api.PLAN_TODOS == [] and id(mock_api.PLAN_TODOS) == ident
        old = json.loads(C._closed_blob(C._main_log(rec)))
        assert old["plan_todos"] == OLD, old.get("plan_todos")             # ไฟล์ของเทอมที่ปิดเก็บของเดิมไว้ครบ
        new = json.loads(gzip.decompress(next(p[3] for s, p in C._main_log(rec) if s == C.INSERT_ACTIVE)))
        assert new["plan_todos"] == []


def test_create_term_old_path_failure_restores_todos():
    def boom(*a, **k):
        raise RuntimeError("หมุนเทอมล้ม")
    with _patched(PLAN_TODOS=copy.deepcopy(OLD)), C._world() as rec:
        db, _t, _rnd = C._scenario()
        rec.use(db)
        with _patched(_term_rotate=boom):
            err = None
            try:
                mock_api.create_term({"year": 2569, "semester": 2})
            except mock_api.HTTPException as e:
                err = e
        assert err is not None and err.status_code == 500
        assert mock_api.PLAN_TODOS == OLD and mock_api.SLOTS


def test_create_term_from_round_starts_empty_and_failure_restores():
    for step in (None, "rotate", "commit"):
        with _patched(PLAN_TODOS=copy.deepcopy(OLD)), C._world(subjects=C._elective_on_program()) as rec:
            db, ns = C._rich()
            rec.use(db)
            ident = id(mock_api.PLAN_TODOS)
            if step is None:
                C._post(ns.rnd)
                assert mock_api.PLAN_TODOS == [] and id(mock_api.PLAN_TODOS) == ident
                old = json.loads(C._closed_blob(C._main_log(rec)))
                assert old["plan_todos"] == OLD
                new = json.loads(gzip.decompress(next(p[3] for s, p in C._main_log(rec) if s == C.INSERT_ACTIVE)))
                assert new["plan_todos"] == []
            else:
                os.environ[C.ENV] = step
                try:
                    C._expect(lambda: C._post(ns.rnd), 500)
                finally:
                    os.environ.pop(C.ENV, None)
                assert mock_api.PLAN_TODOS == OLD and id(mock_api.PLAN_TODOS) == ident, step


# ── route ────────────────────────────────────────────────────────────────
def _with_todos(term, todos, reqs, slots):
    return _patched(PLAN_TODOS=copy.deepcopy(todos), CURRENT_TERM=dict(term), REQUIREMENTS=copy.deepcopy(reqs),
                    SLOTS=copy.deepcopy(slots), REVISION={"n": 3})


ACTIVE = {"id": 4, "year": 2569, "semester": 1, "label": "1/2569", "status": "active"}
CLOSED = dict(ACTIVE, status="closed")
NONE_YET = {"id": None, "year": None, "semester": None, "label": None, "status": None}


def _code_of(fn):
    try:
        return 200, fn()
    except mock_api.HTTPException as e:
        return e.status_code, e.detail


def test_get_todos_shows_live_status_and_reads_when_closed():
    reqs = [_req(1, 1, 1, 5, 3)]
    todos = [_todo(1, "missing", 1, 1), _todo(2, "set", 1, None)]
    for term in (ACTIVE, CLOSED, NONE_YET):
        with _with_todos(term, todos, reqs, [_slot(1, 1, 1, 5)]):
            out = mock_api.terms_todos()
            assert [(t["id"], t["state"]) for t in out] == [(1, "open"), (2, "open")], out
            assert all(t["detail"] for t in out)
            before = (copy.deepcopy(mock_api.PLAN_TODOS), copy.deepcopy(mock_api.SLOTS), dict(mock_api.REVISION))
            mock_api.SLOTS.extend([_slot(2, 1, 1, 5), _slot(3, 1, 1, 5)])
            assert [(t["id"], t["state"]) for t in mock_api.terms_todos()] == [(1, "resolved"), (2, "open")]
            out[0]["text"] = "แก้ท้ายคำตอบ"                                       # คำตอบเป็นสำเนา ไม่ย้อนถึงรายการ
            assert mock_api.PLAN_TODOS == before[0] and mock_api.REVISION == before[2]
    with _with_todos(ACTIVE, [], [], []):
        assert mock_api.terms_todos() == []


def test_post_done_sets_flag_and_answers_with_status():
    reqs = [_req(1, 1, 1, 5, 3)]
    todos = [_todo(1, "missing", 1, 1), _todo(2, "set", 1, None)]
    for term in (ACTIVE, NONE_YET):
        with _with_todos(term, todos, reqs, [_slot(1, 1, 1, 5)]):
            slots_before = copy.deepcopy(mock_api.SLOTS)
            parked = copy.deepcopy(mock_api.PARKED)
            code, out = _code_of(lambda: mock_api.terms_todo_done(2))
            assert code == 200 and out["id"] == 2 and out["done"] is True and out["state"] == "resolved", out
            assert [t["done"] for t in mock_api.PLAN_TODOS] == [False, True]
            code, out = _code_of(lambda: mock_api.terms_todo_done(1))
            assert out["done"] is True and out["state"] == "open"            # รับทราบแล้ว แต่คาบยังขาด → ยังเปิดตามจริง
            assert mock_api.SLOTS == slots_before and mock_api.PARKED == parked
            code, out = _code_of(lambda: mock_api.terms_todo_done(1, {"done": False}))
            assert code == 200 and out["done"] is False and mock_api.PLAN_TODOS[0]["done"] is False
            for bad in ({"done": "no"}, {"done": 1}, {"done": None}):
                code, out = _code_of(lambda b=bad: mock_api.terms_todo_done(1, b))
                assert code == 400 and "done" in out, (bad, code)
            code, out = _code_of(lambda: mock_api.terms_todo_done(99))
            assert code == 404 and "ไม่พบ" in out, (code, out)


def test_post_done_refused_when_term_closed():
    with _with_todos(CLOSED, [_todo(1, "set", 1, None)], [], []):
        code, out = _code_of(lambda: mock_api.terms_todo_done(1))
        assert code == 409 and "ปิดแล้ว" in out and "1/2569" in out, (code, out)
        assert mock_api.PLAN_TODOS[0]["done"] is False
    # สถานะแปลก = ปิดไว้ก่อน (fail closed) เหมือนตัวกันของมิดเดิลแวร์
    with _with_todos(dict(CLOSED, status="Closed"), [_todo(1, "set", 1, None)], [], []):
        assert _code_of(lambda: mock_api.terms_todo_done(1))[0] == 409


def test_post_goes_through_revision_and_snapshot_but_middleware_does_not_guard_it():
    # ใต้ /api/terms/ มิดเดิลแวร์ปล่อยเขียนตลอด (ปลดล็อกต้องใช้) → ตัวกันอยู่ใน route เอง (ทดสอบข้างบน) · แต่ต้องผ่านตัวนับรุ่น+เซฟ
    path = "/api/terms/todos/1/done"
    assert mock_api.term_blocks_write(CLOSED, "POST", path) is None
    assert mock_api.skip_revision_bump("POST", path) is False and mock_api.skip_revision_bump("GET", "/api/terms/todos") is True

    def run(handler):
        calls = {"save": 0}
        resp = SimpleNamespace(status_code=200)

        async def call_next(_req):
            handler()
            return resp
        req = SimpleNamespace(method="POST", url=SimpleNamespace(path=path))
        with _patched(_save_state=lambda: calls.__setitem__("save", calls["save"] + 1)):
            rev0 = mock_api.REVISION["n"]
            asyncio.run(mock_api._bump_revision(req, call_next))
            return mock_api.REVISION["n"] - rev0, calls["save"]
    with _with_todos(ACTIVE, [_todo(1, "set", 1, None)], [], []):
        assert run(lambda: mock_api.terms_todo_done(1)) == (1, 1)           # เปลี่ยนจริง → บวกรุ่น + เซฟ snapshot
        assert run(lambda: mock_api.terms_todo_done(1)) == (0, 0)           # ซ้ำ ไม่เปลี่ยน → เงียบ


def test_new_code_never_writes_slots_or_parked():
    for fn in (D.todo_status, mock_api.terms_todos, mock_api.terms_todo_done):
        src = inspect.getsource(fn)
        for bad in ("SLOTS[", "SLOTS.append", "SLOTS.clear", "SLOTS.extend", "PARKED[", "PARKED.append", "PARKED.clear",
                    "_sync_pool_slots"):
            assert bad not in src, (fn.__name__, bad)


def test_program_state_restored():
    for k in _WATCH:
        obj = getattr(mock_api, k)
        assert id(obj) == _IDS[k] and obj == _START[k], k


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                import traceback
                fails.append(f"{name}: {type(e).__name__} {e}\n{traceback.format_exc()[-1500:]}")
    if fails:
        for f in fails:
            print("FAIL:", f)
        sys.exit(1)
    print("ALL PASS")
