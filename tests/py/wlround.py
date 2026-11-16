"""
เว็บลงอัตรากำลัง ขั้นที่ 2 งานที่ 1: ตารางของรอบ และการแปลงแผนการสอน/คาบเสรี/ตารางเป็นรอบ

wl_round_proposal เป็นฟังก์ชันล้วน — สร้าง src ด้วยมือทุกตัวทดสอบ (ยกเว้นตัวที่อ่านข้อมูลตั้งต้น)
รหัสฝั่งเว็บนี้ตั้งให้ต่างจากฝั่งตารางเสมอ (ครู +100 · วิชา +500) ถ้าลืมแปลงที่ไหน ตัวทดสอบจะเห็นทันที
"""
import copy
import json
import re
import sys
from pathlib import Path

import mock_api

fails: list[str] = []

T = 100     # ครูฝั่งตาราง n → wl_teachers.id n + T
S = 500     # วิชาฝั่งตาราง n → wl_subjects.id n + S

SUBJECTS = {
    1: {"id": 1, "code": "ท21102", "name": "ภาษาไทยพื้นฐาน 2", "credits": 1.5, "is_activity": False},
    2: {"id": 2, "code": "ค21204", "name": "คณิตศาสตร์เพิ่มเติม 2", "credits": 1, "is_activity": False},
    3: {"id": 3, "code": "ก21902", "name": "แนะแนว 2", "credits": None, "is_activity": True},
    4: {"id": 4, "code": "ก21903", "name": "ลูกเสือ", "credits": None, "is_activity": True},
    5: {"id": 5, "code": "ง21201", "name": "งานประดิษฐ์", "credits": 0.5, "is_activity": False},
    6: {"id": 6, "code": "ศ21201", "name": "ดนตรีสากล", "credits": 0.5, "is_activity": False},
    7: {"id": 7, "code": "พ21201", "name": "ฟุตบอล", "credits": 0.5, "is_activity": False},
    8: {"id": 8, "code": "FREE", "name": "คาบว่าง", "credits": 0, "is_activity": True,
        "is_free_period": True},
}
DEPTS = {1: 1, 2: 2, 3: 9, 4: 9, 5: 5, 6: 6, 7: 7, 8: None}
GROUPS = {g: {"id": g, "name": f"ม.1/{g - 10}"} for g in (11, 12, 13, 14, 15)}


def _src(**over):
    src = {
        "requirements": [], "pools": [], "slots": [],
        "sched_subjects": copy.deepcopy(SUBJECTS),
        "groups": copy.deepcopy(GROUPS),
        "teacher_ids": {t: t + T for t in range(1, 30)},
        "subject_ids": {s: s + S for s in SUBJECTS},
        "subject_depts": {s + S: d for s, d in DEPTS.items()},
        "served": set(),
    }
    src.update(over)
    return src


def _req(rid, gid, sid, tid, weekly, **kw):
    return {"id": rid, "group_id": gid, "subject_id": sid, "teacher_id": tid,
            "weekly_count": weekly, "parallel_group_key": None, **kw}


def _slot(sid_, gid, day, period, **kw):
    """ช่องในตารางตามรูปของ TimetableSlot (คำตัดสินข้อ 4)"""
    s = {"id": sid_, "group_id": gid, "day": day, "period": period,
         "subject_id": None, "teacher_id": None, "is_elective": False,
         "elective_options": [], "is_activity_block": False, "activity_teacher_ids": [],
         "is_double_start": False, "is_double_cont": False}
    s.update(kw)
    return s


def _opt(sid, tid, **kw):
    return {"subject_id": sid, "teacher_id": tid, "label": SUBJECTS[sid]["name"],
            "code": SUBJECTS[sid]["code"], **kw}


def _load(prop, wl_tid):
    """ยอดคาบตามกฎข้อ 4.4 ข. — แถว: ครูผู้สอน+ครูสอนร่วมได้เท่ากัน · ชุด: ครั้งเดียวต่อชุด"""
    n = sum(r["weekly"] for r in prop["rows"] if wl_tid in (r["teacher_id"], r["co_teacher_id"]))
    n += sum(s["weekly"] for s in prop["sets"]
             if any(o["teacher_id"] == wl_tid for o in s["options"]))
    return n


# ── แถวแผน → แถวรอบ ───────────────────────────────────────────────────
def test_plan_row_becomes_unconfirmed_round_row():
    prop = mock_api.wl_round_proposal(_src(requirements=[_req(1, 11, 1, 3, 3)]))
    assert prop["rows"] == [{
        "department_id": 1, "group_id": 11, "subject_id": 1 + S,
        "code": "ท21102", "name": "ภาษาไทยพื้นฐาน 2", "credits": 1.5, "weekly": 3,
        "kind": "basic", "teacher_id": 3 + T, "co_teacher_id": None, "lab_room_id": None,
        "is_double": False, "note": "", "confirmed": False, "from_plan": True, "flag": None,
    }], prop["rows"]
    # แถวยังไม่มี id / round_id — งานที่ 2 เป็นคนเขียนลงฐานข้อมูล
    assert "id" not in prop["rows"][0] and "round_id" not in prop["rows"][0]
    assert prop["sets"] == [] and prop["unconverted"] == []
    assert prop["counts"] == {"rows": 1, "sets_elective": 0, "sets_activity": 0,
                              "co_merged": 0, "served_skipped": 0}


def test_kind_from_code():
    assert mock_api.wl_kind_from_code("ท21102", False) == "basic"
    assert mock_api.wl_kind_from_code("ท21204", False) == "additional"
    assert mock_api.wl_kind_from_code("ก21901", True) == "activity"
    # รหัสสั้นหรือว่างเดาไม่ได้ = พื้นฐาน (admin แก้ได้) ไม่ใช่พัง
    assert mock_api.wl_kind_from_code("", False) == "basic"
    assert mock_api.wl_kind_from_code("ก21", False) == "basic"


def test_plan_row_kind_and_credits_come_from_the_subject():
    prop = mock_api.wl_round_proposal(_src(requirements=[
        _req(1, 11, 2, 3, 2), _req(2, 11, 3, 4, 1)]))
    add, guide = prop["rows"]
    assert (add["kind"], add["credits"], add["department_id"]) == ("additional", 1, 2)
    # หน่วยกิตเป็น None ได้ ห้ามกลายเป็น 0 · ทศนิยมห้ามถูกปัด
    assert (guide["kind"], guide["credits"], guide["department_id"]) == ("activity", None, 9)


# ── สอนร่วม (กฎเดียวกับ coTeachHalves) ────────────────────────────────
def test_co_teach_pair_merges_when_weekly_equal():
    prop = mock_api.wl_round_proposal(_src(requirements=[
        _req(1, 11, 2, 3, 4, co_teacher_id=4), _req(2, 11, 2, 4, 4, co_teacher_id=3)]))
    assert len(prop["rows"]) == 1, prop["rows"]
    row = prop["rows"][0]
    assert (row["teacher_id"], row["co_teacher_id"], row["weekly"]) == (3 + T, 4 + T, 4)
    assert row["flag"] is None
    assert prop["counts"]["co_merged"] == 1 and prop["counts"]["rows"] == 1
    # ครูทั้งสองคนได้ 4 คาบ ไม่ใช่ 8 และไม่ใช่ 0
    assert _load(prop, 3 + T) == 4 and _load(prop, 4 + T) == 4


def test_co_teach_pair_named_from_one_side_only_still_merges():
    # coTeachHalves: แถวใดแถวหนึ่งชี้อีกแถวก็พอ
    prop = mock_api.wl_round_proposal(_src(requirements=[
        _req(1, 11, 2, 3, 4), _req(2, 11, 2, 4, 4, co_teacher_id=3)]))
    assert len(prop["rows"]) == 1
    assert (prop["rows"][0]["teacher_id"], prop["rows"][0]["co_teacher_id"]) == (3 + T, 4 + T)


def test_co_teach_pair_with_unequal_weekly_stays_two_rows_flagged():
    prop = mock_api.wl_round_proposal(_src(requirements=[
        _req(1, 11, 2, 3, 4, co_teacher_id=4), _req(2, 11, 2, 4, 2, co_teacher_id=3)]))
    assert len(prop["rows"]) == 2
    assert [r["flag"] for r in prop["rows"]] == ["สอนร่วมในแผนเดิมคาบไม่เท่ากัน"] * 2
    assert [(r["teacher_id"], r["weekly"]) for r in prop["rows"]] == [(3 + T, 4), (4 + T, 2)]
    # ไม่ชี้กันเองต่อ ไม่อย่างนั้นยอดของแต่ละคนจะนับแถวของอีกคนซ้ำ
    assert [r["co_teacher_id"] for r in prop["rows"]] == [None, None]
    assert prop["counts"]["co_merged"] == 0
    assert _load(prop, 3 + T) == 4 and _load(prop, 4 + T) == 2


def test_two_teachers_not_naming_each_other_stay_two_rows():
    # ครูสองคนต่างคิดว่าห้องนี้เป็นของตัวเอง = ความขัดแย้งจริง ไม่ใช่คู่สอนร่วม
    prop = mock_api.wl_round_proposal(_src(requirements=[
        _req(1, 11, 2, 3, 4), _req(2, 11, 2, 4, 4)]))
    assert [(r["teacher_id"], r["co_teacher_id"], r["flag"]) for r in prop["rows"]] == [
        (3 + T, None, None), (4 + T, None, None)]
    assert prop["counts"]["co_merged"] == 0


def test_rows_without_teachers_are_not_a_co_teach_pair():
    # ช่องครูสอนร่วมที่ว่างไม่ได้ชี้ใคร — None == None ในไพทอนต้องไม่กลายเป็นคู่สอนร่วม
    prop = mock_api.wl_round_proposal(_src(requirements=[
        _req(1, 11, 2, None, 4), _req(2, 11, 2, None, 2)]))
    assert len(prop["rows"]) == 2 and prop["counts"]["co_merged"] == 0
    assert [r["flag"] for r in prop["rows"]] == [None, None]


def test_co_teacher_on_a_single_row_is_carried():
    # แผนที่เขียนสอนร่วมไว้แถวเดียว (ไม่มีแถวคู่) — ครูสอนร่วมยังต้องมาด้วย
    prop = mock_api.wl_round_proposal(_src(requirements=[_req(1, 11, 2, 3, 4, co_teacher_id=9)]))
    assert [(r["teacher_id"], r["co_teacher_id"]) for r in prop["rows"]] == [(3 + T, 9 + T)]
    assert prop["counts"]["co_merged"] == 0


def test_rows_taught_in_elective_window_are_skipped():
    prop = mock_api.wl_round_proposal(_src(
        requirements=[_req(1, 11, 5, 3, 1), _req(2, 11, 1, 4, 3)], served={1}))
    assert [r["subject_id"] for r in prop["rows"]] == [1 + S]
    assert prop["counts"]["served_skipped"] == 1 and prop["counts"]["rows"] == 1


def test_room_choices_are_carried_over():
    # คำตัดสินข้อ Q2b: ห้องที่โรงเรียนเลือกไว้แล้วยกมาด้วย หัวหน้าจะได้แก้แค่ที่เปลี่ยน
    prop = mock_api.wl_round_proposal(_src(
        requirements=[_req(1, 11, 2, 3, 2, room_id=353)],
        pools=[{"id": 1, "name": "วิชาเสรี ม.1", "group_ids": [11], "weekly": 1, "is_double": False,
                "options": [_opt(5, 7, room_id=88), _opt(6, 8)]}]))
    assert prop["rows"][0]["lab_room_id"] == 353
    assert [o["room_id"] for o in prop["sets"][0]["options"]] == [88, None]


# ── คาบเสรีจาก ELECTIVE_POOLS ─────────────────────────────────────────
def test_pool_becomes_elective_set_with_unconfirmed_options():
    pool = {"id": 4, "name": "วิชาเสรี ม.1/1-3", "raw_group": "ม.1/1-3", "group_ids": [11, 12, 13],
            "weekly": 2, "is_double": True, "day": 2, "period": 6,
            "options": [_opt(5, 7), _opt(6, None)]}
    prop = mock_api.wl_round_proposal(_src(pools=[pool]))
    assert prop["rows"] == []
    assert prop["sets"] == [{
        "kind": "elective", "name": "วิชาเสรี ม.1/1-3", "group_ids": [11, 12, 13],
        "weekly": 2, "is_double": True,
        "options": [
            {"subject_id": 5 + S, "code": "ง21201", "name": "งานประดิษฐ์", "department_id": 5,
             "teacher_id": 7 + T, "room_id": None, "note": "", "confirmed": False, "from_plan": True},
            # ตัวเลือกที่ยังไม่มีครู ยกมาแบบช่องครูว่าง — ไม่ใช่สิ่งที่แปลงไม่ได้
            {"subject_id": 6 + S, "code": "ศ21201", "name": "ดนตรีสากล", "department_id": 6,
             "teacher_id": None, "room_id": None, "note": "", "confirmed": False, "from_plan": True},
        ],
    }], prop["sets"]
    assert prop["unconverted"] == []
    assert prop["counts"]["sets_elective"] == 1 and prop["counts"]["sets_activity"] == 0


# ── คาบเสรีรายห้องที่อยู่แค่ในตาราง ─────────────────────────────────────
def _elective_slot(sid_, gid, day, period, opts, **kw):
    return _slot(sid_, gid, day, period, is_elective=True,
                 elective_options=[{"id": sid_ * 10 + i, **o} for i, o in enumerate(opts)], **kw)


def test_per_class_elective_slots_become_sets_grouped_by_options():
    same = [_opt(5, 7), _opt(6, 8)]
    other = [_opt(5, 7), _opt(7, 9)]
    slots, n = [], 0
    for gid in (11, 12, 13):
        for period in (6, 7):
            n += 1
            slots.append(_elective_slot(n, gid, 2, period, same))
    slots += [_elective_slot(90, 14, 3, 6, other), _elective_slot(91, 14, 3, 7, other)]
    prop = mock_api.wl_round_proposal(_src(slots=slots))
    sets = prop["sets"]
    assert len(sets) == 2, sets
    first = next(s for s in sets if s["group_ids"] == [11, 12, 13])
    assert (first["kind"], first["weekly"], first["is_double"]) == ("elective", 2, False)
    assert first["name"].startswith("คาบเสรี ") and "ม.1/1" in first["name"]
    assert sorted((o["subject_id"], o["teacher_id"]) for o in first["options"]) == [
        (5 + S, 7 + T), (6 + S, 8 + T)]
    assert all(o["confirmed"] is False and o["from_plan"] is True for o in first["options"])
    second = next(s for s in sets if s["group_ids"] == [14])
    assert second["weekly"] == 2
    assert sorted((o["subject_id"], o["teacher_id"]) for o in second["options"]) == [
        (5 + S, 7 + T), (7 + S, 9 + T)]
    assert prop["counts"]["sets_elective"] == 2
    # ชุดนับครั้งเดียว ไม่คูณจำนวนห้อง: ครู 7 อยู่สองชุด ชุดละ 2 คาบ
    assert _load(prop, 7 + T) == 4 and _load(prop, 8 + T) == 2


def test_per_class_elective_rooms_with_different_counts_split_by_count():
    same = [_opt(5, 7), _opt(6, 8)]
    slots = [
        _elective_slot(1, 11, 2, 6, same, is_double_start=True),
        _elective_slot(2, 11, 2, 7, same, is_double_cont=True),   # คาบคู่ = อีกหนึ่งคาบของชุดเดียวกัน
        _elective_slot(3, 12, 2, 6, same, is_double_start=True),
        _elective_slot(4, 12, 2, 7, same, is_double_cont=True),
        _elective_slot(5, 13, 4, 1, same),                           # ห้องนี้มีแค่คาบเดียว
    ]
    sets = mock_api.wl_round_proposal(_src(slots=slots))["sets"]
    got = sorted((s["group_ids"], s["weekly"], s["is_double"]) for s in sets)
    assert got == [([11, 12], 2, True), ([13], 1, False)], got


def test_same_options_at_different_hours_are_separate_sets():
    # ครู 7 สอนงานประดิษฐ์ให้ ม.1/1 วันจันทร์ และ ม.1/2 วันอังคาร = สองชั่วโมงจริง
    # รวมเป็นชุดเดียว (นับชุดละครั้ง) จะเหลือ 1 คาบ
    opts = [_opt(5, 7), _opt(6, 8)]
    prop = mock_api.wl_round_proposal(_src(slots=[_elective_slot(1, 11, 0, 6, opts),
                                                  _elective_slot(2, 12, 1, 6, opts),
                                                  _elective_slot(3, 13, 1, 6, opts)]))
    got = sorted((s["group_ids"], s["weekly"]) for s in prop["sets"])
    assert got == [([11], 1), ([12, 13], 1)], got
    assert _load(prop, 7 + T) == 2


def test_activity_windows_at_different_hours_are_separate_sets():
    # ลูกเสือมีหลายหน้าต่างต่อสัปดาห์ ครูคุมชุดเดียวกันคุม ม.1 วันพฤหัส และ ม.2 วันศุกร์
    slots = [_slot(1, 11, 3, 7, subject_id=4, activity_teacher_ids=[5, 6], is_activity_block=True),
             _slot(2, 12, 3, 7, subject_id=4, activity_teacher_ids=[5, 6], is_activity_block=True),
             _slot(3, 13, 4, 7, subject_id=4, activity_teacher_ids=[5, 6], is_activity_block=True)]
    prop = mock_api.wl_round_proposal(_src(slots=slots))
    got = sorted((s["group_ids"], s["weekly"]) for s in prop["sets"])
    assert got == [([11, 12], 1), ([13], 1)], got
    assert _load(prop, 5 + T) == 2


def test_elective_slots_already_in_a_pool_are_not_duplicated():
    pool = {"id": 4, "name": "วิชาเสรี ม.1/1-2", "group_ids": [11, 12], "weekly": 1,
            "is_double": False, "options": [_opt(5, 7), _opt(6, 8)]}
    # ช่องที่การวางคาบเสรีเขียนลงตาราง: ห้องอยู่ในชุด และวิชาชุดเดียวกัน
    placed = [_elective_slot(1, 11, 2, 6, pool["options"], elective_pool_id=4),
              _elective_slot(2, 12, 2, 6, pool["options"], elective_pool_id=4)]
    # ห้องเดียวกันแต่วิชาคนละชุด = คาบเสรีอีกอันที่อยู่แค่ในตาราง ต้องยกมา
    extra = _elective_slot(3, 11, 4, 1, [_opt(7, 9)])
    prop = mock_api.wl_round_proposal(_src(pools=[pool], slots=placed + [extra]))
    assert len(prop["sets"]) == 2, prop["sets"]
    assert prop["sets"][0]["name"] == "วิชาเสรี ม.1/1-2"
    assert [(o["subject_id"], o["teacher_id"]) for o in prop["sets"][1]["options"]] == [(7 + S, 9 + T)]
    assert prop["counts"]["sets_elective"] == 2
    assert _load(prop, 7 + T) == 1      # ไม่ได้ 1 + 1 จากช่องที่ซ้ำกับชุด


def test_empty_elective_window_is_reported_not_made_into_a_set():
    prop = mock_api.wl_round_proposal(_src(slots=[_elective_slot(1, 11, 2, 6, [])]))
    assert prop["sets"] == []
    assert [(u["source"], u["ref"]) for u in prop["unconverted"]] == [("slot", 1)]


# ── กิจกรรม ────────────────────────────────────────────────────────────
def test_activity_block_becomes_activity_set_one_option_per_supervisor():
    slots = [_slot(i, gid, 3, 7, subject_id=4, teacher_id=None, activity_teacher_ids=[5, 6, 7],
                   is_activity_block=True, activity_key="ACT-3-7-1")
             for i, gid in enumerate((11, 12, 13), start=1)]
    prop = mock_api.wl_round_proposal(_src(slots=slots))
    assert prop["rows"] == []
    assert len(prop["sets"]) == 1, prop["sets"]
    s = prop["sets"][0]
    assert (s["kind"], s["group_ids"], s["weekly"], s["is_double"]) == ("activity", [11, 12, 13], 1, False)
    assert s["name"].startswith("ลูกเสือ")
    assert [(o["subject_id"], o["teacher_id"], o["department_id"]) for o in s["options"]] == [
        (4 + S, 5 + T, 9), (4 + S, 6 + T, 9), (4 + S, 7 + T, 9)]
    assert all(o["confirmed"] is False for o in s["options"])
    assert prop["counts"]["sets_activity"] == 1 and prop["counts"]["sets_elective"] == 0
    # ครูคุมได้ 1 คาบ ไม่ใช่ 3 (ชุดนับครั้งเดียว ไม่คูณห้อง)
    assert _load(prop, 5 + T) == 1


def test_activity_slot_teacher_id_is_a_supervisor_too():
    slots = [_slot(1, 11, 3, 7, subject_id=4, teacher_id=5, activity_teacher_ids=[6],
                   is_activity_block=True),
             _slot(2, 12, 3, 7, subject_id=4, teacher_id=5, activity_teacher_ids=[6],
                   is_activity_block=True),
             # ครูคุมคนละชุด = อีกชุดหนึ่ง
             _slot(3, 13, 3, 7, subject_id=4, teacher_id=8, activity_teacher_ids=[],
                   is_activity_block=True)]
    sets = mock_api.wl_round_proposal(_src(slots=slots))["sets"]
    got = sorted((s["group_ids"], sorted(o["teacher_id"] for o in s["options"])) for s in sets)
    assert got == [([11, 12], [5 + T, 6 + T]), ([13], [8 + T])], got


def test_activity_subject_slot_without_plan_row_is_lifted():
    # วิชากิจกรรมที่ลงตารางไว้เอง ไม่มีแถวแผนของห้องนั้น = การสอนที่อยู่แค่ในตาราง
    prop = mock_api.wl_round_proposal(_src(slots=[
        _slot(1, 11, 1, 3, subject_id=3, teacher_id=6), _slot(2, 12, 1, 3, subject_id=3, teacher_id=6)]))
    assert [(s["kind"], s["group_ids"], s["weekly"]) for s in prop["sets"]] == [("activity", [11, 12], 1)]


def test_activity_subject_slot_with_a_plan_row_is_not_lifted_again():
    # คำตัดสินข้อ Q1: ตารางที่จัดเสร็จแล้ว แนะแนวอยู่ทั้งในแผน (แถวละห้อง) และเป็นคาบธรรมดาในตาราง
    # ที่ตัวจัดตารางวางจากแถวแผนนั้นเอง — ยกซ้ำจะนับคาบของครูแนะแนวสองครั้ง
    reqs = [_req(i, gid, 3, 6, 1) for i, gid in enumerate((11, 12, 13, 14), start=1)]
    slots = [_slot(i, gid, 1, 3, subject_id=3, teacher_id=6)
             for i, gid in enumerate((11, 12, 13, 14), start=1)]
    prop = mock_api.wl_round_proposal(_src(requirements=reqs, slots=slots))
    assert len(prop["rows"]) == 4 and all(r["kind"] == "activity" for r in prop["rows"])
    assert prop["sets"] == [], prop["sets"]
    assert prop["counts"]["sets_activity"] == 0
    assert _load(prop, 6 + T) == 4          # นับครั้งเดียว: 4 ห้อง ห้องละ 1 คาบ
    assert prop["unconverted"] == []


def test_activity_without_supervisor_is_reported_not_made_into_a_set():
    # คำตัดสินข้อ Q2a: ไม่มีครูคุมเลย → ไม่สร้างชุด แต่ต้องบอก admin ไม่ทิ้งเงียบ ๆ
    slots = [_slot(1, 11, 3, 7, subject_id=4, is_activity_block=True),
             _slot(2, 11, 4, 7, subject_id=4, is_activity_block=True),   # ห้องเดียวกันสองคาบ = บอกครั้งเดียว
             _slot(3, 12, 3, 7, subject_id=4, is_activity_block=True)]
    prop = mock_api.wl_round_proposal(_src(slots=slots))
    assert prop["sets"] == []
    assert [(u["source"], u["ref"]) for u in prop["unconverted"]] == [("slot", 1), ("slot", 3)]
    reason = prop["unconverted"][0]["reason"]
    assert "ก21903" in reason and "ม.1/1" in reason and "ยังไม่มีครูคุม" in reason, reason


def test_free_period_is_not_lifted():
    # คาบว่างที่จองไว้ไม่ใช่คาบเรียน (คำตัดสินข้อ Q2a) — ไม่ยก และไม่ใช่สิ่งที่แปลงไม่ได้
    slots = [_slot(1, 11, 3, 7, subject_id=8, is_activity_block=True, is_free_period=True),
             _slot(2, 12, 3, 7, subject_id=8, is_activity_block=True, is_free_period=True)]
    prop = mock_api.wl_round_proposal(_src(slots=slots))
    assert prop["sets"] == [] and prop["rows"] == [] and prop["unconverted"] == []


def test_ordinary_slots_are_not_lifted():
    prop = mock_api.wl_round_proposal(_src(
        requirements=[_req(1, 11, 1, 3, 1)],
        slots=[_slot(1, 11, 0, 0, subject_id=1, teacher_id=3)]))
    assert len(prop["rows"]) == 1 and prop["sets"] == []


# ── ทุกการสอนในตารางไปโผล่ในรอบ ─────────────────────────────────────────
def _slot_teachings(slot):
    """(ครู, วิชา) ทุกคู่ที่ช่องนี้มีครูอยู่จริง — ฝั่งตาราง"""
    out = set()
    if slot.get("is_free_period"):
        return out
    sid = slot.get("subject_id")
    for t in [slot.get("teacher_id"), slot.get("co_teacher_id"), *(slot.get("activity_teacher_ids") or [])]:
        if t:
            out.add((t, sid))
    for o in slot.get("elective_options") or []:
        if o.get("teacher_id"):
            out.add((o["teacher_id"], o["subject_id"]))
    return out


def test_every_taught_slot_appears_somewhere_in_the_round():
    reqs = [
        _req(1, 11, 1, 3, 2), _req(2, 12, 1, 3, 2),                          # ภาษาไทย ครู 3
        _req(3, 11, 2, 4, 1, co_teacher_id=10), _req(4, 11, 2, 10, 1, co_teacher_id=4),   # สอนร่วม
        _req(5, 13, 3, 6, 1),                                                # แนะแนว (มีแถวแผน)
        _req(6, 11, 5, 7, 1),                                                # อยู่ในคาบเสรีแล้ว (served)
    ]
    pool = {"id": 1, "name": "วิชาเสรี ม.1/4-5", "group_ids": [14, 15], "weekly": 1, "is_double": False,
            "options": [_opt(6, 8), _opt(7, 11)]}
    slots = [
        _slot(1, 11, 0, 0, subject_id=1, teacher_id=3), _slot(2, 11, 1, 0, subject_id=1, teacher_id=3),
        _slot(3, 12, 0, 1, subject_id=1, teacher_id=3), _slot(4, 12, 1, 1, subject_id=1, teacher_id=3),
        _slot(5, 11, 2, 2, subject_id=2, teacher_id=4, co_teacher_id=10),
        _slot(6, 13, 2, 3, subject_id=3, teacher_id=6),                       # แนะแนวคาบธรรมดา
        _slot(7, 12, 2, 3, subject_id=3, teacher_id=12),                      # แนะแนวที่อยู่แค่ในตาราง
        _elective_slot(8, 11, 3, 6, [_opt(5, 7), _opt(6, 13)]),               # คาบเสรีรายห้อง
        _elective_slot(9, 14, 4, 6, pool["options"], elective_pool_id=1),     # มาจากชุด
        _elective_slot(10, 15, 4, 6, pool["options"], elective_pool_id=1),
        _slot(11, 11, 3, 7, subject_id=4, activity_teacher_ids=[14, 15], is_activity_block=True),
        _slot(12, 12, 3, 7, subject_id=4, activity_teacher_ids=[14, 15], is_activity_block=True),
        _slot(13, 13, 3, 7, subject_id=4, teacher_id=16, is_activity_block=True),
        _slot(14, 14, 4, 0, subject_id=8, is_activity_block=True, is_free_period=True),
    ]
    prop = mock_api.wl_round_proposal(_src(requirements=reqs, pools=[pool], slots=slots, served={6}))
    have = set()
    for r in prop["rows"]:
        for t in (r["teacher_id"], r["co_teacher_id"]):
            if t is not None:
                have.add((t, r["subject_id"]))
    for s in prop["sets"]:
        have |= {(o["teacher_id"], o["subject_id"]) for o in s["options"] if o["teacher_id"] is not None}
    want = set()
    for slot in slots:
        want |= {(t + T, sid + S) for t, sid in _slot_teachings(slot)}
    assert want, "ตารางสังเคราะห์ไม่มีการสอนเลย — ตัวทดสอบนี้ไม่ได้ตรวจอะไร"
    missing = want - have
    assert not missing, sorted(missing)
    assert prop["unconverted"] == [], prop["unconverted"]
    # ไม่มีอะไรถูกนับซ้ำ: แนะแนวของครู 6 ได้ 1 · ครู 7 สอนวิชาเสรีในคาบเสรีรายห้อง 1 (แถวแผนถูกข้าม)
    assert _load(prop, 6 + T) == 1 and _load(prop, 7 + T) == 1
    assert prop["counts"] == {"rows": 4, "sets_elective": 2, "sets_activity": 3,
                              "co_merged": 1, "served_skipped": 1}, prop["counts"]


# ── สิ่งที่แปลงไม่ได้ ───────────────────────────────────────────────────
def test_unknown_teacher_and_group_are_reported_not_fatal():
    src = _src(
        requirements=[_req(1, 11, 1, 77, 3),        # ครู 77 ยังไม่มีในทะเบียนของเว็บนี้
                      _req(2, 99, 1, 3, 2),         # ห้อง 99 ไม่มีแล้ว
                      _req(3, 11, 42, 3, 1),        # วิชา 42 ไม่มีทั้งในโปรแกรมและทะเบียน
                      _req(4, 12, 2, 0, 1)],        # 0 = ยังไม่ได้เลือกครู ไม่ใช่ครูที่แปลงไม่ได้
        pools=[{"id": 5, "name": "ชุด", "group_ids": [11], "weekly": 1, "is_double": False,
                "options": [_opt(5, 78)]}])
    prop = mock_api.wl_round_proposal(src)
    assert len(prop["rows"]) == 4
    r1, r2, r3, r4 = prop["rows"]
    assert r1["teacher_id"] is None and r1["subject_id"] == 1 + S
    assert r2["group_id"] == 99 and r2["teacher_id"] == 3 + T
    assert r3["subject_id"] is None and r3["department_id"] is None and r3["teacher_id"] == 3 + T
    assert r4["teacher_id"] is None
    assert prop["sets"][0]["options"][0]["teacher_id"] is None
    got = [(u["source"], u["ref"]) for u in prop["unconverted"]]
    assert got == [("plan", 1), ("plan", 2), ("plan", 3), ("pool", 5)], prop["unconverted"]
    for u in prop["unconverted"]:
        assert set(u) == {"source", "ref", "reason"}
        assert re.search(r"[฀-๿]", u["reason"]), u["reason"]     # เหตุผลภาษาไทย
    assert "77" in prop["unconverted"][0]["reason"]
    assert "99" in prop["unconverted"][1]["reason"]


def test_one_problem_is_reported_once():
    # วิชากิจกรรมที่ยังไม่มีในทะเบียน ครูคุมสามคน = เรื่องเดียว ไม่ใช่สามบรรทัดเหมือนกัน
    subjects = copy.deepcopy(SUBJECTS)
    subjects[9] = {"id": 9, "code": "ก21904", "name": "ชุมนุม", "credits": None, "is_activity": True}
    slots = [_slot(1, 11, 3, 7, subject_id=9, activity_teacher_ids=[5, 6, 7], is_activity_block=True)]
    prop = mock_api.wl_round_proposal(_src(sched_subjects=subjects, slots=slots))
    assert len(prop["sets"]) == 1 and len(prop["sets"][0]["options"]) == 3
    assert all(o["subject_id"] is None and o["code"] == "ก21904" for o in prop["sets"][0]["options"])
    assert len(prop["unconverted"]) == 1, prop["unconverted"]
    assert "9" in prop["unconverted"][0]["reason"]


def test_input_is_not_mutated():
    pool = {"id": 1, "name": "วิชาเสรี", "group_ids": [14, 15], "weekly": 1, "is_double": False,
            "options": [_opt(6, 8, room_id=5)]}
    src = _src(
        requirements=[_req(1, 11, 2, 4, 1, co_teacher_id=10), _req(2, 11, 2, 10, 1, co_teacher_id=4),
                      _req(3, 12, 2, 4, 3, co_teacher_id=10), _req(4, 12, 2, 10, 1, co_teacher_id=4),
                      _req(5, 13, 1, 77, 2), _req(6, 13, 5, 3, 1)],
        pools=[pool], served={6},
        slots=[_elective_slot(1, 11, 3, 6, [_opt(5, 7)]),
               _slot(2, 11, 3, 7, subject_id=4, activity_teacher_ids=[14], is_activity_block=True),
               _slot(3, 12, 3, 7, subject_id=4, is_activity_block=True)])
    before = copy.deepcopy(src)
    prop = mock_api.wl_round_proposal(src)
    assert src == before
    # ผลที่คืนไม่ใช้ลิสต์ร่วมกับ src — งานที่ 2 แก้ผลได้โดยไม่ไปแตะแหล่งข้อมูล
    prop["sets"][0]["group_ids"].append(0)
    assert src["pools"][0]["group_ids"] == [14, 15]


# ── ข้อมูลตั้งต้นของโรงเรียน ────────────────────────────────────────────
def test_seed_plan_converts_fully():
    data = json.loads((Path(mock_api.__file__).parent / "school_data.json").read_text(encoding="utf-8"))
    flat = []

    def walk(gs):
        for g in gs:
            flat.append(g)
            walk(g.get("children") or [])
    walk(data["groups"])
    src = {
        "requirements": data["requirements"], "pools": data["elective_pools"], "slots": [],
        "sched_subjects": {s["id"]: s for s in data["subjects"]},
        "groups": {g["id"]: g for g in flat},
        "teacher_ids": {t["id"]: t["id"] + 1000 for t in data["teachers"]},
        "subject_ids": {s["id"]: s["id"] + 2000 for s in data["subjects"]},
        "subject_depts": {s["id"] + 2000: s.get("department_id") for s in data["subjects"]},
        # ข้อมูลตั้งต้นไม่มีแถวที่สอนในคาบเสรีอยู่แล้ว (_reqs_served_by_elective() ว่าง)
        "served": set(),
    }
    prop = mock_api.wl_round_proposal(src)
    assert len(prop["rows"]) == 1220, len(prop["rows"])
    assert prop["counts"] == {"rows": 1220, "sets_elective": 13, "sets_activity": 0,
                              "co_merged": 0, "served_skipped": 0}, prop["counts"]
    assert prop["unconverted"] == [], prop["unconverted"][:5]
    assert sum(1 for r in prop["rows"] if r["kind"] == "activity") == 75     # แนะแนว
    assert all(r["department_id"] is not None for r in prop["rows"])
    assert all(r["confirmed"] is False and r["from_plan"] is True for r in prop["rows"])
    assert sum(r["weekly"] for r in prop["rows"]) == sum(r["weekly_count"] for r in data["requirements"])


# ── ตาราง SQL ───────────────────────────────────────────────────────────
def test_schema_has_one_open_round_index_and_no_new_index_on_existing_tables():
    sql = mock_api._WL_SCHEMA
    uniq = re.findall(r"CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)", sql, re.I)
    # คำตัดสินข้อ 1: ดัชนี unique บนตารางที่มีข้อมูลจริงต้องเท่ากับของเดิมพอดี
    # (สร้างใหม่บนข้อมูลที่ซ้ำอยู่แล้วจะล้ม แล้วทุก route ของเว็บนี้ตอบ 503)
    old = {name for name, table in uniq if table.lower() in ("wl_codes", "wl_teachers", "wl_subjects")}
    assert old == {"wl_codes_one_admin", "wl_codes_one_per_dept"}, old
    assert ("wl_rounds_one_open", "wl_rounds") in uniq, uniq
    assert not re.search(r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(wl_codes|wl_teachers|wl_subjects)\b", sql, re.I)
    for table in ("wl_rounds", "wl_rows", "wl_sets", "wl_set_options", "wl_dept_status"):
        assert re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{table}\s*\(", sql), table
    # รันซ้ำได้ทุก process — ทุกคำสั่งต้องเป็นแบบ IF NOT EXISTS
    for stmt in re.findall(r"CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(\S+)", sql, re.I):
        assert stmt.upper() == "IF", stmt


def test_schema_columns_match_the_contract():
    sql = mock_api._WL_SCHEMA

    def cols(table):
        body = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\n\);", sql, re.S).group(1)
        return {line.split()[0] for line in body.strip().splitlines()
                if line.strip() and not line.strip().upper().startswith(("UNIQUE", "CHECK", "PRIMARY"))}
    assert {"id", "year", "semester", "label", "status", "opened_at", "closed_at"} <= cols("wl_rounds")
    assert cols("wl_rows") == {"id", "round_id", "department_id", "group_id", "subject_id", "code", "name",
                               "credits", "weekly", "kind", "teacher_id", "co_teacher_id", "lab_room_id",
                               "is_double", "note", "confirmed", "from_plan", "flag"}
    assert cols("wl_sets") == {"id", "round_id", "kind", "name", "group_ids", "weekly", "is_double"}
    assert cols("wl_set_options") == {"id", "set_id", "subject_id", "code", "name", "department_id",
                                      "teacher_id", "room_id", "note", "confirmed", "from_plan"}
    assert cols("wl_dept_status") == {"round_id", "department_id", "status", "submitted_at", "submitted_by",
                                      "reviewed_at", "reviewed_by", "note"}
    # แถวของรอบใส่ได้ทุกช่องที่ wl_round_proposal คืน (ยกเว้น id/round_id ที่ฐานข้อมูลแจก)
    prop = mock_api.wl_round_proposal(_src(requirements=[_req(1, 11, 1, 3, 3)],
                                           pools=[{"id": 1, "name": "x", "group_ids": [11], "weekly": 1,
                                                   "is_double": False, "options": [_opt(5, 7)]}]))
    assert set(prop["rows"][0]) == cols("wl_rows") - {"id", "round_id"}
    assert set(prop["sets"][0]) - {"options"} == cols("wl_sets") - {"id", "round_id"}
    assert set(prop["sets"][0]["options"][0]) == cols("wl_set_options") - {"id", "set_id"}


for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            fails.append(f"{name}: {type(e).__name__} {e}")

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
