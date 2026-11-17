"""
ขั้นที่ 3 งานที่ 2: แปลงรอบอัตรากำลังเป็นแผนการสอน คาบเสรี และหลักสูตรของเทอมใหม่ (term_from_round.plan_from_round — ฟังก์ชันล้วน)

ไม่ใช้ฐานข้อมูล · ข้อหน่วยเรียกฟังก์ชันล้วนตรง ๆ กับข้อมูลรูปสัญญาร่วมของแผน (source / outgoing / maps / counters)
ข้อไปกลับ (แบบข้อทดสอบ 1) เดินทั้งเส้นด้วยฟังก์ชันล้วนของขั้นที่ 2 และ 3: แผนของโปรแกรม → wl_round_proposal →
wl_curricula_from_proposal → แถว/ตัวเลือกพร้อมครูจาก wl_prefill (ยืนยันทุกแถว) → registry_plan → plan_from_round
แล้วเทียบกับแผนเดิม · รหัสฝั่งเว็บต่างจากรหัสฝั่งตารางเสมอ (ครู +1000 วิชา +2000) ถ้าที่ไหนลืมแปลงจะเห็นทันที
ชุด ข สร้างช่องคาบเสรีรายห้องและแถวแผนของวิชาเสรีด้วย route จริงของหน้าจัดคาบบนตัวแปรของโปรแกรม จึงเก็บสำเนาลึก
ของทุกตัวที่แตะไว้แล้วคืนใน finally (คำตัดสิน P1 ของผู้คุม)
"""
import collections
import contextlib
import copy
import sys

import curriculum
import mock_api
import term_from_round as T

fails: list[str] = []

FLAG = T.CO_UNEQUAL_FLAG
# ห้องของโปรแกรม 1–6 · ครูฝั่งเว็บ = ครูฝั่งตาราง + 100 · วิชาฝั่งเว็บ = วิชาฝั่งตาราง + 500
GROUPS = {g: {"id": g, "name": f"ม.1/{g}", "parent_id": None} for g in range(1, 7)}
TMAP = {t + 100: t for t in range(1, 30)}
SMAP = {s + 500: s for s in range(1, 30)}


# ── ตัวช่วยสร้างข้อมูลรูปสัญญาร่วม ─────────────────────────────────────────
def _line(i, subject_id=None, code="", name="", weekly=2, kind="basic"):
    return {"id": i, "subject_id": subject_id, "code": code, "name": name, "credits": 1.0, "weekly": weekly,
            "kind": kind, "department_id": 1}


def _cur(i, lines, group_ids, name=None):
    return {"id": i, "name": name or f"หลักสูตร {i}", "group_ids": list(group_ids), "lines": list(lines)}


def _row(i, line_id, group_id, subject_id=None, teacher_id=None, co_teacher_id=None, weekly=2, lab_room_id=None,
         is_double=False, flag=None):
    """แถวของรอบ รูปเดียวกับ _wl_round_rows_sql (subject_id = วิชาของบรรทัด ฝั่งเว็บ)"""
    return {"id": i, "round_id": 1, "line_id": line_id, "group_id": group_id, "subject_id": subject_id,
            "weekly": weekly, "teacher_id": teacher_id, "co_teacher_id": co_teacher_id, "lab_room_id": lab_room_id,
            "is_double": is_double, "confirmed": True, "flag": flag, "department_id": 1}


def _set(i, kind="elective", group_ids=(1, 2), weekly=2, is_double=False, name=None):
    return {"id": i, "year": 2569, "semester": 2, "kind": kind, "name": name or f"ชุด {i}",
            "group_ids": list(group_ids), "weekly": weekly, "is_double": is_double}


def _opt(i, st, subject_id=None, code="", name="", teachers=()):
    """ตัวเลือกรูป GET …/rows ของขั้นที่ 2 · teachers = [(id ของแถวครูของตัวเลือก, ครูฝั่งเว็บ, ห้อง)]"""
    return {"id": i, "set_id": st["id"], "subject_id": subject_id, "code": code, "name": name, "department_id": 1,
            "set": dict(st),
            "teachers": [{"id": e, "round_id": 1, "option_id": i, "set_id": st["id"], "teacher_id": t, "room_id": room,
                          "note": "", "confirmed": True, "from_plan": False} for e, t, room in teachers]}


def _src(**kw):
    s = {"round": {"id": 1, "year": 2569, "semester": 2, "label": "2/2569", "status": "closed", "exported_at": None},
         "rows": [], "options": [], "sets": [], "curricula": [], "wl_teachers": [], "wl_subjects": [],
         "dept_status": []}
    s.update(kw)
    return s


def _req(i, g, s, t, weekly=2, **kw):
    """แถวแผนของเทอมที่กำลังปิด (REQUIREMENTS)"""
    r = {"id": i, "group_id": g, "subject_id": s, "teacher_id": t, "weekly_count": weekly, "parallel_group_key": None}
    r.update(kw)
    return r


def _subjects(n=29):
    return [{"id": s, "code": f"S{s:03d}", "name": f"วิชา {s}", "type": "common", "duration": 1, "department_id": 1,
             "is_activity": False, "fixed_room_id": None, "credits": 1.0} for s in range(1, n + 1)]


def _out(requirements=(), subjects=None):
    return {"requirements": list(requirements), "pools": [], "slots": [], "served": set(),
            "sched_subjects": {}, "groups": copy.deepcopy(GROUPS), "teachers": [],
            "subjects": _subjects() if subjects is None else list(subjects), "curricula": []}


def _maps(typed=None, subjects=None):
    m = {"teacher_map": dict(TMAP), "subject_map": dict(SMAP), "typed_map": dict(typed or {})}
    if subjects is not None:
        m["subjects"] = subjects
    return m


def _counters(**kw):
    c = {"requirement": 1000, "elective_pool": 50, "elective_option": 9000, "curriculum": 0}
    c.update(kw)
    return c


def _plan(src, out=None, maps=None, counters=None):
    return T.plan_from_round(src, out if out is not None else _out(), maps or _maps(), counters or _counters())


def _curriculum_refusals(plan, groups, subjects):
    """แถวแผนที่ curriculum.check_row ตัวจริงปฏิเสธ เมื่อเทอมใหม่ใช้หลักสูตรและ curriculum_id ของห้องตามผล
    curriculum.DATA ผูกกับตัวแปรของโปรแกรมอยู่ (mock_api bind ไว้) จึง bind ชั่วคราวกับผลนี้แล้วคืนของเดิมใน finally"""
    rooms = {gid: {**g, "curriculum_id": plan["group_curricula"].get(gid)} for gid, g in groups.items()}
    books = {s["id"]: s for s in subjects}
    saved = dict(curriculum.DATA)
    try:
        curriculum.bind(curricula=lambda: plan["curricula"], groups_by_id=lambda: rooms, subjects_by_id=lambda: books)
        return [(r["group_id"], r["subject_id"], r["weekly_count"], why) for r in plan["requirements"]
                if (why := curriculum.check_row(r["group_id"], r["subject_id"], r["weekly_count"]))]
    finally:
        curriculum.DATA.clear()
        curriculum.DATA.update(saved)
        assert curriculum.DATA == saved


def _cells(plan):
    return collections.Counter((r["group_id"], r["subject_id"], r["teacher_id"]) for r in plan["requirements"])


# ── แถวของรอบ → REQUIREMENTS ───────────────────────────────────────────────
def test_row_maps_teacher_co_room_double():
    src = _src(curricula=[_cur(1, [_line(10, subject_id=501, weekly=3), _line(11, subject_id=502),
                                   _line(12, code=" ก1 ", name="พิมพ์เอง", weekly=1)], [1, 2])],
               rows=[_row(1, 10, 1, subject_id=501, teacher_id=105, co_teacher_id=106, weekly=3, lab_room_id=30,
                          is_double=True),
                     _row(2, 11, 1, subject_id=502, teacher_id=107),
                     _row(3, 12, 2, subject_id=None, teacher_id=108, weekly=1)])
    plan = _plan(src, maps=_maps(typed={"ก1": 21}))
    assert plan["requirements"] == [
        {"id": 1001, "group_id": 1, "subject_id": 1, "teacher_id": 5, "weekly_count": 3, "parallel_group_key": None,
         "co_teacher_id": 6, "room_id": 30, "pinned_double": True},
        # คาบคู่ใส่เฉพาะเมื่อจริง · ครูสอนร่วม/ห้องปฏิบัติการว่างได้ · ไม่ปักวัน/คาบ = ไม่มีช่อง pinned_day/pinned_period
        {"id": 1002, "group_id": 1, "subject_id": 2, "teacher_id": 7, "weekly_count": 2, "parallel_group_key": None,
         "co_teacher_id": None, "room_id": None},
        # บรรทัดที่พิมพ์รหัสเอง: วิชามาจาก typed_map ด้วยรหัสของบรรทัด (หลังตัดช่องว่าง)
        {"id": 1003, "group_id": 2, "subject_id": 21, "teacher_id": 8, "weekly_count": 1, "parallel_group_key": None,
         "co_teacher_id": None, "room_id": None}], plan["requirements"]
    rep = plan["report"]
    assert (rep["rows"], rep["periods"], rep["teachers_in_plan"]) == (3, 6, 4), rep
    assert rep["skipped"] == [] and rep["elective_rows"] == 0


# ── ยกช่องที่เว็บไม่มีจากแผนเดิม ─────────────────────────────────────────────
def test_carry_keys_when_group_agrees():
    src = _src(rows=[_row(1, 10, 1, subject_id=501, teacher_id=105), _row(2, 11, 2, subject_id=501, teacher_id=105),
                     _row(3, 12, 3, subject_id=503, teacher_id=105, is_double=True)])
    out = _out([_req(1, 1, 1, 9, parallel_group_key="SET-A", pinned_day=2, pinned_period=3, pinned_double=True),
                _req(2, 3, 3, 9, pinned_double=False)])
    plan = _plan(src, out)
    a, b, c = plan["requirements"]
    # ห้อง 1 วิชา 1 ยกทุกช่อง — ครูต่างจากแผนเดิมได้ จับคู่ด้วย (ห้อง, วิชา) เท่านั้น
    assert (a["parallel_group_key"], a["pinned_day"], a["pinned_period"], a["pinned_double"]) == ("SET-A", 2, 3, True)
    # ห้อง 2 ไม่มีในแผนเดิม → ว่าง (ไม่ใช่ "ยกไม่ได้" — ไม่มีอะไรจะยก)
    assert b["parallel_group_key"] is None and not {"pinned_day", "pinned_period", "pinned_double"} & set(b)
    # คาบคู่สุดท้าย = คาบคู่จากรอบ หรือ ค่าที่ยกมา (แผนเดิมไม่ได้ปักคาบคู่ แต่รอบบอกว่าคาบคู่)
    assert c["pinned_double"] is True and "pinned_day" not in c
    assert plan["report"]["carried"] == 1 and plan["report"]["not_carried"] == []


def test_two_row_coteach_still_carries():
    # สอนร่วมแบบสองแถวในแผนเดิม (ชี้กัน) → ขั้นที่ 2 รวมเป็นแถวเดียวของรอบ · ก้อน (ห้อง, วิชา) ของแผนเดิมมีสองแถว
    # ที่ปักไว้ตรงกัน จึงยกได้ — และเขียนกลับเป็นสองแถวชี้กันตามรูปเดิม (teacherLoads นับจาก teacher_id ของแถวเท่านั้น
    # ถ้าเหลือแถวเดียว ครู 6 จะหายจากยอดคาบของโปรแกรม 3 คาบ)
    src = _src(rows=[_row(1, 10, 1, subject_id=501, teacher_id=105, co_teacher_id=106, weekly=3, lab_room_id=8)])
    out = _out([_req(1, 1, 1, 5, 3, co_teacher_id=6, pinned_day=4, pinned_period=1),
                _req(2, 1, 1, 6, 3, co_teacher_id=5, pinned_day=4, pinned_period=1)])
    plan = _plan(src, out)
    got = [(r["id"], r["teacher_id"], r["co_teacher_id"], r["weekly_count"], r["room_id"], r["pinned_day"],
            r["pinned_period"]) for r in plan["requirements"]]
    assert got == [(1001, 5, 6, 3, 8, 4, 1), (1002, 6, 5, 3, 8, 4, 1)], got
    assert plan["report"]["carried"] == 2
    folded, agreed = mock_api._fold_coteaching(plan["requirements"])
    assert folded == {1002} and agreed == {1001: 3}       # โปรแกรมยังเห็นเป็นบทเรียนเดียว
    # แผนเดิมเป็นแถวเดียว (สอนร่วมที่เขียนแถวเดียว) → แถวเดียวตามเดิม
    one = _plan(src, _out([_req(1, 1, 1, 5, 3, co_teacher_id=6)]))["requirements"]
    assert [(r["teacher_id"], r["co_teacher_id"]) for r in one] == [(5, 6)]
    # ครูสอนร่วมคนใหม่ไม่ใช่คู่เดิม → แถวเดียว (รูปเดิมใช้ไม่ได้)
    src7 = _src(rows=[_row(1, 10, 1, subject_id=501, teacher_id=105, co_teacher_id=107, weekly=3)])
    assert len(_plan(src7, out)["requirements"]) == 1
    # รอบมีแถวของครู 6 ในห้อง+วิชานี้อยู่แล้ว → ไม่เขียนซ้ำ
    both = _src(rows=[_row(1, 10, 1, subject_id=501, teacher_id=105, co_teacher_id=106, weekly=3),
                      _row(2, 11, 1, subject_id=501, teacher_id=106, weekly=3)])
    assert [(r["teacher_id"], r["co_teacher_id"]) for r in _plan(both, out)["requirements"]] == [(5, 6), (6, None)]


def test_conflicting_old_rows_do_not_carry_and_are_counted():
    src = _src(rows=[_row(1, 10, 1, subject_id=501, teacher_id=105), _row(2, 11, 2, subject_id=502, teacher_id=105)])
    out = _out([_req(1, 1, 1, 5, parallel_group_key="K", pinned_day=1, pinned_period=2),
                _req(2, 1, 1, 6, parallel_group_key="K", pinned_day=3, pinned_period=2, pinned_double=True),
                _req(3, 2, 2, 5, parallel_group_key="P"), _req(4, 2, 2, 6, parallel_group_key="Q")])
    plan = _plan(src, out)
    a, b = plan["requirements"]
    # ทีละช่อง: เซ็ตห้องย่อยและคาบตรงกันยกได้ · วันและคาบคู่ไม่ตรงกัน → ว่าง
    assert (a["parallel_group_key"], a["pinned_period"]) == ("K", 2) and not {"pinned_day", "pinned_double"} & set(a)
    assert b["parallel_group_key"] is None
    rep = plan["report"]
    assert rep["not_carried"] == [{"group_id": 1, "subject_id": 1, "fields": ["pinned_day", "pinned_double"]},
                                  {"group_id": 2, "subject_id": 2, "fields": ["parallel_group_key"]}], rep
    assert rep["carried"] == 1
    # วันจันทร์ = pinned_day 0 ก็ยกได้และนับว่ายกมา · ก้อนที่ได้สองแถว (สอนร่วมคาบไม่เท่ากัน) ขึ้นรายการเดียว
    two = _src(rows=[_row(1, 10, 1, subject_id=501, teacher_id=105, weekly=3, flag=FLAG),
                     _row(2, 11, 1, subject_id=501, teacher_id=106, weekly=2, flag=FLAG)])
    plan = _plan(two, _out([_req(1, 1, 1, 5, 3, co_teacher_id=6, pinned_day=0, pinned_period=1, parallel_group_key="X"),
                            _req(2, 1, 1, 6, 2, co_teacher_id=5, pinned_day=0, pinned_period=2)]))
    assert [(r["pinned_day"], "pinned_period" in r) for r in plan["requirements"]] == [(0, False), (0, False)]
    assert plan["report"]["carried"] == 2
    assert plan["report"]["not_carried"] == [{"group_id": 1, "subject_id": 1,
                                              "fields": ["parallel_group_key", "pinned_period"]}]


# ── สอนร่วมคาบไม่เท่ากัน ───────────────────────────────────────────────────
def test_unequal_coteach_rows_stay_two_and_point_at_each_other():
    assert T.CO_UNEQUAL_FLAG == mock_api.WL_CO_UNEQUAL_FLAG      # import mock_api ในโมดูลล้วนไม่ได้ จึงเทียบที่นี่
    src = _src(rows=[_row(1, 10, 1, subject_id=501, teacher_id=105, weekly=3, flag=FLAG),
                     _row(2, 11, 1, subject_id=501, teacher_id=106, weekly=2, flag=FLAG),
                     _row(3, 12, 2, subject_id=501, teacher_id=107, weekly=2, flag=FLAG),   # คู่หายไปแล้ว
                     _row(4, 13, 3, subject_id=502, teacher_id=108, co_teacher_id=109, flag=FLAG),
                     _row(5, 14, 3, subject_id=502, teacher_id=110, flag=FLAG)])
    reqs = _plan(src)["requirements"]
    got = [(r["group_id"], r["teacher_id"], r["co_teacher_id"], r["weekly_count"]) for r in reqs]
    # สองแถวเหมือนรูปเดิม แต่ละแถวชี้อีกแถว · แถวที่ไม่มีคู่ไม่ชี้ใคร · ครูสอนร่วมที่ระบุไว้ในรอบไม่ถูกทับ
    assert got == [(1, 5, 6, 3), (1, 6, 5, 2), (2, 7, None, 2), (3, 8, 9, 2), (3, 10, 8, 2)], got
    # โปรแกรมรวมเป็นบทเรียนเดียวเองได้ผลเท่าแผนเดิม (คาบที่มากกว่า)
    folded, agreed = mock_api._fold_coteaching(reqs)
    assert folded == {reqs[1]["id"], reqs[4]["id"]} and agreed[reqs[0]["id"]] == 3


# ── คาบเสรี ───────────────────────────────────────────────────────────────
def test_elective_set_becomes_unplaced_pool_with_one_option_per_teacher():
    st = _set(7, group_ids=(2, 1), weekly=2, is_double=True, name="คาบเสรี ม.1/1–ม.1/2")
    src = _src(sets=[st],
               options=[_opt(70, st, subject_id=507, teachers=[(2, 108, 40), (1, 109, None)]),
                        _opt(71, st, subject_id=508, teachers=[]),
                        _opt(72, st, subject_id=None, code="ก1", name="พิมพ์เอง", teachers=[(3, 110, 41)])])
    subjects = _subjects()
    subjects[6]["name"] = "ชื่อหลังซิงก์"
    plan = _plan(src, maps=_maps(typed={"ก1": 21}, subjects=subjects))
    [p] = plan["pools"]
    assert p == {"id": 51, "name": "คาบเสรี ม.1/1–ม.1/2", "raw_group": "", "group_ids": [2, 1], "weekly": 2,
                 "is_double": True, "day": None, "period": None,
                 # หนึ่งตัวเลือกต่อ (ตัวเลือก, ครู) เรียงครูของตัวเลือกตามรหัสแถว · ห้องจากครูของตัวเลือก ·
                 # ชื่อ/รหัสจากวิชาในโปรแกรมหลังซิงก์ · ตัวเลือกที่ยังไม่มีครูคงไว้แบบไม่มีครู (missing_teacher_count)
                 "options": [{"key": 9001, "subject_id": 7, "teacher_id": 9, "label": "ชื่อหลังซิงก์", "code": "S007",
                              "room_id": None},
                             {"key": 9002, "subject_id": 7, "teacher_id": 8, "label": "ชื่อหลังซิงก์", "code": "S007",
                              "room_id": 40},
                             {"key": 9003, "subject_id": 8, "teacher_id": None, "label": "วิชา 8", "code": "S008",
                              "room_id": None},
                             {"key": 9004, "subject_id": 21, "teacher_id": 10, "label": "วิชา 21", "code": "S021",
                              "room_id": 41}]}, p
    assert plan["elective_subjects"] == [7, 8, 21] and plan["requirements"] == []
    assert (plan["report"]["pools"], plan["report"]["pool_options"]) == (1, 4)


def test_elective_rows_follow_outgoing_shape():
    st = _set(1, group_ids=(1, 2, 3, 5), weekly=2)
    src = _src(sets=[st], options=[_opt(10, st, subject_id=507, teachers=[(2, 112, None), (1, 111, None)])],
               curricula=[_cur(1, [_line(50, subject_id=507)], [5])],
               rows=[_row(1, 50, 5, subject_id=507, teacher_id=111)])
    out = _out([_req(1, 1, 7, 12, 2, room_id=33),       # ครูเดิม 12 ยังสอนตัวเลือกนั้น → คนเดิม
                _req(2, 2, 7, 13, 3, co_teacher_id=12),  # ครูเดิม 13 ไม่สอนแล้ว → ครูคนแรก (รหัสแถวน้อยสุด = 11)
                _req(3, 4, 7, 12, 2),                    # ห้อง 4 ไม่อยู่ในชุด → ไม่เขียน
                _req(4, 5, 7, 11, 2)])                   # ห้อง 5 มีแถวของรอบอยู่แล้ว → ไม่เขียนซ้ำ
    plan = _plan(src, out)
    got = [(r["group_id"], r["subject_id"], r["teacher_id"], r["co_teacher_id"], r["weekly_count"], r["room_id"])
           for r in plan["requirements"]]
    # ห้อง 3 ไม่มีแถวเดิม → ชุดอย่างเดียว (แบบข้อมูลตั้งต้นที่มี 0 แถว) · คาบเท่าแถวเดิม · ห้องตามแถวเดิม
    assert got == [(5, 7, 11, None, 2, None), (1, 7, 12, None, 2, 33), (2, 7, 11, 12, 3, None)], got
    assert plan["report"]["elective_rows"] == 2 and plan["report"]["rows"] == 3
    # ไม่มีแถวแผนเลย (ข้อมูลตั้งต้น) → ชุดอย่างเดียว
    assert _plan(_src(sets=[st], options=[_opt(10, st, subject_id=507, teachers=[(1, 111, None)])]))[
        "requirements"] == []


def test_activity_set_only_in_report():
    act = _set(3, kind="activity", group_ids=(1, 2, 3), weekly=1, name="ลูกเสือ ม.1/1–ม.1/3")
    src = _src(sets=[act], options=[_opt(30, act, subject_id=509, teachers=[(5, 113, None), (4, 114, None)]),
                                    _opt(31, act, subject_id=509, teachers=[(6, 113, None)])])
    plan = _plan(src)
    assert plan["pools"] == [] and plan["requirements"] == [] and plan["elective_subjects"] == []
    assert plan["report"]["activity_sets"] == [{"name": "ลูกเสือ ม.1/1–ม.1/3", "group_ids": [1, 2, 3], "weekly": 1,
                                                "teacher_ids": [14, 13]}], plan["report"]["activity_sets"]
    assert plan["counters"] == _counters()


# ── หลักสูตร ──────────────────────────────────────────────────────────────
def test_curricula_rows_and_group_attach():
    src = _src(curricula=[_cur(1, [_line(10, subject_id=501, weekly=3), _line(11, subject_id=502, weekly=2),
                                   _line(12, subject_id=501, weekly=4), _line(13, code="ก1", name="พิมพ์เอง", weekly=1)],
                               [1, 2], name="ม.1/1-2"),
                          _cur(2, [_line(20, subject_id=503, weekly=0)], [3, 99], name="ม.1/3")])
    plan = _plan(src, maps=_maps(typed={"ก1": 21}))
    # ซ้ำ → ค่ามากสุด (normalise_rows) · คาบ 0 คงไว้ (ห้องนี้ไม่เรียนวิชานี้)
    assert plan["curricula"] == [
        {"id": 1, "name": "ม.1/1-2", "rows": curriculum.normalise_rows(
            [{"subject_id": 1, "weekly_count": 3}, {"subject_id": 2, "weekly_count": 2},
             {"subject_id": 1, "weekly_count": 4}, {"subject_id": 21, "weekly_count": 1}])},
        {"id": 2, "name": "ม.1/3", "rows": [{"subject_id": 3, "weekly_count": 0}]}], plan["curricula"]
    assert plan["curricula"][0]["rows"] == [{"subject_id": 1, "weekly_count": 4}, {"subject_id": 2, "weekly_count": 2},
                                            {"subject_id": 21, "weekly_count": 1}]
    # ทุกห้องของโปรแกรมมีคำตอบ: ห้องที่ไม่อยู่หลักสูตรใด → None · ห้อง 99 ไม่มีในโปรแกรม ไม่ได้รับคำตอบ
    assert plan["group_curricula"] == {1: 1, 2: 1, 3: 2, 4: None, 5: None, 6: None}
    assert plan["counters"]["curriculum"] == 2


def test_written_rows_are_allowed_by_their_curriculum():
    # แบบข้อทดสอบ 9: แผนใหม่แก้ผ่านหน้าเดิมได้โดยไม่ถูกปฏิเสธเรื่องหลักสูตร — แถวแผนของวิชาเสรี (ขั้นที่ 2 ไม่ได้ทำบรรทัด
    # หลักสูตรให้ เพราะชุดสอนแทน) ต้องมีวิชานั้นในหลักสูตรของห้องด้วยคาบ ≥ คาบของแถว ไม่งั้นแก้คาบภายหลังได้ 400
    st = _set(1, group_ids=(1, 2, 3, 4))
    src = _src(curricula=[_cur(1, [_line(10, subject_id=501, weekly=3)], [1, 2], name="ก"),
                          _cur(2, [_line(20, subject_id=502), _line(21, subject_id=505, weekly=0)], [3], name="ข")],
               rows=[_row(1, 10, 1, subject_id=501, teacher_id=105, weekly=3),
                     _row(2, 10, 2, subject_id=501, teacher_id=105, weekly=3),
                     _row(3, 20, 3, subject_id=502, teacher_id=106)],
               sets=[st], options=[_opt(10, st, subject_id=507, teachers=[(1, 111, None)]),
                                   _opt(11, st, subject_id=505, teachers=[(2, 112, None)])])
    out = _out([_req(1, 1, 7, 11, 2), _req(2, 3, 7, 11, 3), _req(3, 4, 7, 11, 2),   # ห้อง 4 ไม่มีหลักสูตร
                _req(4, 3, 5, 12, 2), _req(5, 1, 7, 11, 1), _req(6, 2, 7, 11, 4)])   # ห้อง 2 ใช้หลักสูตร ก ร่วม
    plan = _plan(src, out)
    assert plan["report"]["elective_rows"] == 6
    # วิชาเสรีเข้าหลักสูตรของห้อง ด้วยคาบมากสุดของแถวในหลักสูตรนั้น · บรรทัดคาบ 0 (ห้องนี้ไม่เรียน) ถูกยกขึ้นเท่าแถว
    # (ซ้ำ → ค่ามากสุด ตาม normalise_rows) · ห้องที่ไม่มีหลักสูตรไม่ถูกตรวจอยู่แล้ว ไม่ต้องเพิ่ม
    assert [c["rows"] for c in plan["curricula"]] == [
        [{"subject_id": 1, "weekly_count": 3}, {"subject_id": 7, "weekly_count": 4}],
        [{"subject_id": 2, "weekly_count": 2}, {"subject_id": 5, "weekly_count": 2}, {"subject_id": 7, "weekly_count": 3}]]
    assert plan["report"]["curriculum_rows_added"] == [
        {"curriculum_id": 1, "subject_id": 7, "weekly_count": 4}, {"curriculum_id": 2, "subject_id": 7, "weekly_count": 3},
        {"curriculum_id": 2, "subject_id": 5, "weekly_count": 2}], plan["report"]["curriculum_rows_added"]
    assert _curriculum_refusals(plan, GROUPS, _subjects()) == []
    # แถวของรอบที่ตรงหลักสูตรอยู่แล้วไม่เพิ่มอะไร
    assert _plan(_src(curricula=src["curricula"], rows=src["rows"]))["report"]["curriculum_rows_added"] == []


def test_ids_from_counters():
    st = _set(1)
    src = _src(curricula=[_cur(1, [_line(10, subject_id=501)], [1]), _cur(2, [], [2])],
               rows=[_row(1, 10, 1, subject_id=501, teacher_id=105), _row(2, 10, 2, subject_id=501, teacher_id=106)],
               sets=[st, _set(2), _set(3, kind="activity")],
               options=[_opt(10, st, subject_id=507, teachers=[(1, 111, None), (2, 112, None)])])
    counters = {"requirement": 1220, "elective_pool": 13, "elective_option": 14000, "teacher": 143}
    plan = _plan(src, counters=counters)
    assert [r["id"] for r in plan["requirements"]] == [1221, 1222]
    assert [p["id"] for p in plan["pools"]] == [14, 15]
    assert [o["key"] for p in plan["pools"] for o in p["options"]] == [14001, 14002]
    assert [c["id"] for c in plan["curricula"]] == [1, 2]     # ตัวนับที่ยังไม่มีคีย์เริ่มจาก 0 แบบ _next
    assert plan["counters"] == {"requirement": 1222, "elective_pool": 15, "elective_option": 14002, "teacher": 143,
                                "curriculum": 2}
    assert counters == {"requirement": 1220, "elective_pool": 13, "elective_option": 14000, "teacher": 143}


def test_unmapped_teachers_and_subjects_are_skipped_and_counted():
    # วิชา/ครูที่ติดเหตุไม่อยู่ใน map (Task 3 จะไม่ให้สร้าง) — ฟังก์ชันล้วนต้องไม่ล้ม หน้าดูก่อนสร้างยังต้องแสดงได้
    st = _set(1, group_ids=(1, 2))
    src = _src(curricula=[_cur(1, [_line(10, subject_id=501), _line(11, subject_id=599), _line(12, code="ข9")], [1])],
               rows=[_row(1, 10, 1, subject_id=501, teacher_id=105), _row(2, 11, 1, subject_id=599, teacher_id=105),
                     _row(3, 12, 1, subject_id=None, teacher_id=105), _row(4, 10, 2, subject_id=501, teacher_id=199),
                     _row(5, 10, 3, subject_id=501, teacher_id=105, co_teacher_id=198),
                     _row(6, 10, 77, subject_id=501, teacher_id=105)],
               sets=[st], options=[_opt(10, st, subject_id=507, teachers=[(1, 197, None), (2, 111, None)]),
                                   _opt(11, st, subject_id=598, teachers=[(3, 111, None)])])
    plan = _plan(src)
    assert [(r["group_id"], r["subject_id"], r["teacher_id"]) for r in plan["requirements"]] == [(1, 1, 5)]
    assert [(o["subject_id"], o["teacher_id"]) for o in plan["pools"][0]["options"]] == [(7, 11)]
    assert plan["curricula"][0]["rows"] == [{"subject_id": 1, "weekly_count": 2}]
    sk = plan["report"]["skipped"]
    assert [(s["source"], s["ref"]) for s in sk] == [
        ("row", 2), ("row", 3), ("row", 4), ("row", 5), ("row", 6), ("option_teacher", 1), ("option", 11),
        ("line", 11), ("line", 12)], sk
    assert all(isinstance(s["reason"], str) and s["reason"] for s in sk)


def test_inputs_not_mutated():
    st = _set(1, group_ids=(1, 2, 3), is_double=True)
    act = _set(2, kind="activity", group_ids=(4,))
    src = _src(curricula=[_cur(1, [_line(10, subject_id=501), _line(11, subject_id=502, weekly=3)], [1, 2])],
               rows=[_row(1, 10, 1, subject_id=501, teacher_id=105, is_double=True),
                     _row(2, 11, 1, subject_id=502, teacher_id=106, weekly=3, flag=FLAG),
                     _row(3, 11, 1, subject_id=502, teacher_id=107, weekly=1, flag=FLAG)],
               sets=[st, act], options=[_opt(10, st, subject_id=507, teachers=[(1, 111, 40)]),
                                        _opt(11, act, subject_id=508, teachers=[(2, 112, None)])])
    out = _out([_req(1, 1, 1, 5, parallel_group_key="K", pinned_day=1, pinned_period=1),
                _req(2, 2, 7, 11, 2, room_id=4)])
    maps, counters = _maps(subjects=_subjects()), _counters()
    before = copy.deepcopy((src, out, maps, counters))
    plan = T.plan_from_round(src, out, maps, counters)
    assert (src, out, maps, counters) == before
    # ผลเป็นของใหม่ทั้งหมด: แก้ผลแล้วต้องไม่ย้อนไปถึงขาเข้า
    for r in plan["requirements"]:
        r["teacher_id"] = -1
    for p in plan["pools"]:
        p["group_ids"].append(-1)
        p["options"][0]["teacher_id"] = -1
    for c in plan["curricula"]:
        c["rows"].append({"subject_id": -1, "weekly_count": 1})
    plan["report"]["activity_sets"][0]["group_ids"].append(-1)
    plan["counters"]["requirement"] = -1
    assert (src, out, maps, counters) == before
    assert len(plan["requirements"]) == 4 and plan["report"]["carried"] == 1


# ── ไปกลับ (แบบข้อทดสอบ 1) ─────────────────────────────────────────────────
# ตัวแปรของโปรแกรมทุกตัวที่ route ของหน้าจัดคาบในชุด ข แตะ (delete_elective_pool rebind SLOTS/ELECTIVE_POOLS ด้วย)
_TOUCHED = ("REQUIREMENTS", "ELECTIVE_POOLS", "SLOTS", "SUBJECTS", "TEACHERS", "GROUPS", "CURRICULA", "PARKED",
            "LAST_RUN", "_counters")


class _RegCur:
    """cursor ปลอมของ _wl_timetable_source: ตอบแค่สองคำสั่งที่มันอ่าน (sched_id ของทะเบียนเว็บ)"""

    def __init__(self, wl_teachers, wl_subjects):
        self.t, self.s, self.sql = wl_teachers, wl_subjects, ""

    def execute(self, sql, params=None):
        self.sql = sql

    def fetchall(self):
        if "wl_teachers" in self.sql:
            return [(w["id"], w["sched_id"]) for w in self.t]
        assert "wl_subjects" in self.sql, self.sql
        return [(w["id"], w["sched_id"], w["department_id"]) for w in self.s]


def _mirror_registry():
    """ทะเบียนของเว็บที่ได้จากปุ่มดึงจากโปรแกรม (ตัวแปลงของ _WL_IMPORTS) — รหัสของเว็บ ≠ รหัสของโปรแกรม"""
    _t, _n, t_cols, t_row = mock_api._WL_IMPORTS["teachers"]
    _s, _n, s_cols, s_row = mock_api._WL_IMPORTS["subjects"]
    wl_t = [{"id": t["id"] + 1000, **dict(zip(t_cols, t_row(t)))} for t in mock_api.TEACHERS]
    wl_s = [{"id": s["id"] + 2000, **dict(zip(s_cols, s_row(s)))} for s in mock_api.SUBJECTS]
    return wl_t, wl_s


def _outgoing():
    """ของเทอมที่กำลังปิด ณ ตอนนี้ (สำเนาลึก): รูป _wl_timetable_source + teachers subjects curricula + ตัวนับ"""
    wl_t, wl_s = _mirror_registry()
    out = mock_api._wl_timetable_source(_RegCur(wl_t, wl_s))
    out.update(teachers=copy.deepcopy(mock_api.TEACHERS), subjects=copy.deepcopy(mock_api.SUBJECTS),
               curricula=copy.deepcopy(mock_api.CURRICULA))
    return out, wl_t, wl_s, copy.deepcopy(mock_api._counters)


def _round_source(out, prop, wl_t, wl_s):
    """รอบที่เปิดจากแผนของโปรแกรมแล้ว "ยืนยันทุกแถว": หลักสูตรตั้งต้น (wl_curricula_from_proposal) × ห้อง →
    แถว/ตัวเลือกพร้อมครูเทอมก่อน (wl_prefill) ในรูป source ของสัญญาร่วม (เหมือนที่ Task 3 อ่านจากฐาน)"""
    seed = mock_api.wl_curricula_from_proposal(prop, out["groups"])
    sched_of = {wl: s for s, wl in out["subject_ids"].items()}
    order = {g: i for i, g in enumerate(out["groups"])}
    curricula, cells, lid = [], [], 0
    for cid, c in enumerate(seed["curricula"], 1):
        lines = []
        for ln in c["lines"]:
            lid += 1
            lines.append({"id": lid, **{k: ln[k] for k in ("subject_id", "code", "name", "credits", "weekly", "kind",
                                                           "department_id")}})
            cells += [(lid, g, ln) for g in sorted(c["group_ids"], key=lambda g: order.get(g, len(order)))]
        curricula.append({"id": cid, "name": c["name"], "group_ids": list(c["group_ids"]), "lines": lines})
    sets, opts, oid = [], [], 0
    for sid, s in enumerate(seed["sets"], 1):
        sets.append({"id": sid, "year": 2569, "semester": 2,
                     **{k: copy.deepcopy(s[k]) for k in ("kind", "name", "group_ids", "weekly", "is_double")}})
        for o in s["options"]:
            oid += 1
            opts.append((oid, sets[-1], o))
    pre = mock_api.wl_prefill(
        prop, [{"line_id": lid, "group_id": g, "sched_subject_id": sched_of.get(ln["subject_id"])} for lid, g, ln in cells],
        [{"option_id": oid, "group_ids": st["group_ids"], "sched_subject_id": sched_of.get(o["subject_id"])}
         for oid, st, o in opts], out["subject_ids"])
    rows = []
    for n, (lid, g, ln) in enumerate(cells, 1):
        p = pre["rows"].get((lid, g), {})
        rows.append({"id": n, "round_id": 1, "line_id": lid, "group_id": g, "subject_id": ln["subject_id"],
                     "code": ln["code"], "weekly": ln["weekly"], "teacher_id": p.get("teacher_id"),
                     "co_teacher_id": p.get("co_teacher_id"), "lab_room_id": p.get("lab_room_id"), "is_double": False,
                     "confirmed": True, "flag": p.get("flag"), "department_id": ln["department_id"]})
    options, eid = [], 0
    for oid, st, o in opts:
        teachers = []
        for t in pre["options"].get(oid, []):
            eid += 1
            teachers.append({"id": eid, "round_id": 1, "option_id": oid, "set_id": st["id"],
                             "teacher_id": t["teacher_id"], "room_id": t["room_id"], "note": "", "confirmed": True,
                             "from_plan": True})
        options.append({"id": oid, "set_id": st["id"], "subject_id": o["subject_id"], "code": o["code"],
                        "name": o["name"], "department_id": o["department_id"], "set": dict(st), "teachers": teachers})
    return _src(rows=rows, options=options, sets=sets, curricula=curricula, wl_teachers=wl_t, wl_subjects=wl_s)


def _lessons(reqs, drop=()):
    """แผนเป็นหลายเซตของบทเรียน หลังโปรแกรมรวมสอนร่วมแบบสองแถว (_fold_coteaching)"""
    folded, agreed = mock_api._fold_coteaching(reqs)
    return collections.Counter(
        (r["group_id"], r["subject_id"], r.get("teacher_id") or None, r.get("co_teacher_id") or None,
         agreed.get(r["id"], r.get("weekly_count") or 0), r.get("room_id"), r.get("parallel_group_key"),
         r.get("pinned_day"), r.get("pinned_period"), bool(r.get("pinned_double")))
        for r in reqs if r["id"] not in folded and r["id"] not in drop)


def _electives(subjects, pools, slots=(), extra=()):
    """เซตวิชาเสรีของโปรแกรม — กฎเดียวกับ electiveSubjectIds (frontend/src/utils/teachingLoad.ts)"""
    out = {s["id"] for s in subjects if s.get("is_elective")} | set(extra)
    out |= {o["subject_id"] for p in pools for o in p.get("options") or [] if o.get("subject_id")}
    out |= {o["subject_id"] for s in slots if s.get("is_elective")
            for o in s.get("elective_options") or [] if o.get("subject_id")}
    return out


def _teacher_loads(reqs, elective):
    """ยอดคาบรายครูของโปรแกรม — กฎเดียวกับ teacherLoads/teacherLoad (frontend/src/utils/teachingLoad.ts):
    วิชาเสรีนับวิชาละครั้งที่คาบมากสุด วิชาอื่นบวกกัน · รวมด้วย teacher_id ของแถว"""
    by: dict = collections.defaultdict(list)
    for r in reqs:
        by[r["teacher_id"] or None].append(r)
    out = {}
    for t, rs in by.items():
        total, best = 0, {}
        for r in rs:
            wc = r.get("weekly_count") or 0
            if r["subject_id"] in elective:
                best[r["subject_id"]] = max(best.get(r["subject_id"], 0), wc)
            else:
                total += wc
        out[t] = total + sum(best.values())
    return out


def _pool_key(p):
    return (frozenset(p["group_ids"]), int(p["weekly"]), bool(p["is_double"]),
            frozenset((o["subject_id"], o.get("teacher_id")) for o in p["options"]))


def _round_trip(out, wl_t, wl_s, counters, want_pools, label):
    """เดินทั้งเส้นแล้วเทียบ · คืนตัวเลขของไปกลับไว้รายงาน"""
    prop = mock_api.wl_round_proposal(out)
    source = _round_source(out, prop, wl_t, wl_s)
    assert source["rows"] and all(r["teacher_id"] for r in source["rows"]), "ยังมีแถวที่ไม่มีครู — ยืนยันไม่ได้"
    assert all(o["teachers"] for o in source["options"]), "ยังมีตัวเลือกที่ไม่มีครู"
    reg = T.registry_plan(source, out, counters)
    # ทะเบียนของเว็บเป็นกระจกของโปรแกรม → ไม่สร้าง ไม่แก้ ไม่มีเหตุ (ไม่งั้นข้อเทียบข้างล่างไม่ได้วัดการแปลงแผน)
    assert reg["reasons"] == [] and not any(reg["report"][k] for k in ("teachers_created", "subjects_created",
                                                                       "teachers_patched", "subjects_patched"))
    plan = T.plan_from_round(source, out, reg, reg["counters"])
    rep = plan["report"]
    assert rep["skipped"] == [] and rep["not_carried"] == [], (rep["skipped"][:3], rep["not_carried"][:3])

    # 1) แผนการสอน: หลายเซตของ (ห้อง, วิชา, ครู, ครูสอนร่วม, คาบ, room_id, เซ็ตห้องย่อย, ที่ปักไว้) เท่าแผนเดิม
    #    ยกเว้นแถวที่ขั้นที่ 2 แปลงไม่ได้ (unconverted) ซึ่งหักออกพร้อมนับ
    lost = {u["ref"] for u in prop["unconverted"] if u["source"] == "plan"}
    old, new = _lessons(out["requirements"], lost), _lessons(plan["requirements"])
    assert old == new, (label, list((old - new).items())[:5], list((new - old).items())[:5])
    # 2) ชุดคาบเสรี: (ห้อง, คาบ/สัปดาห์, คาบคู่, {(วิชา, ครู)}) ครบทุกชุดทุกตัวเลือก · ยังไม่ลงคาบ
    assert collections.Counter(map(_pool_key, plan["pools"])) == collections.Counter(map(_pool_key, want_pools)), label
    assert all(p["day"] is None and p["period"] is None for p in plan["pools"])
    keys = [o["key"] for p in plan["pools"] for o in p["options"]]
    assert len(keys) == len(set(keys))
    # 3) เซตวิชาเสรี (pools ∪ is_elective ∪ ตัวเลือกของช่องคาบเสรีในตาราง) เท่าเดิม — เทอมใหม่ตารางว่าง จึงไม่มีช่อง
    #    และวิชาของชุดถูกติดธงวิชาเสรีด้วย _mark_elective(elective_subjects) (Task 4)
    old_el = _electives(out["subjects"], out["pools"], out["slots"])
    new_el = _electives(reg["subjects"], plan["pools"], extra=plan["elective_subjects"])
    assert old_el == new_el, (label, sorted(old_el ^ new_el))
    assert plan["elective_subjects"] == sorted({o["subject_id"] for p in plan["pools"] for o in p["options"]})
    # 4) ยอดคาบรายครูของโปรแกรม (teacherLoads) เท่าเดิมทุกคน — สามอย่างข้างบนเท่ากัน = ยอดเท่ากัน ยืนยันตรงนี้อีกชั้น
    old_load, new_load = _teacher_loads(out["requirements"], old_el), _teacher_loads(plan["requirements"], new_el)
    assert old_load == new_load, (label, [(t, old_load.get(t), new_load.get(t))
                                          for t in set(old_load) | set(new_load) if old_load.get(t) != new_load.get(t)][:5])
    # 5) หลักสูตร (แบบข้อทดสอบ 9): ทุกห้องที่มีแถวของรอบอยู่ในหลักสูตร และ **ทุกแถวแผน** (รวมแถวแผนของวิชาเสรี)
    #    ผ่าน curriculum.check_row ตัวจริง — แก้คาบ/ครูของแถวไหนก็ได้ผ่านหน้าเดิมโดยไม่ถูกปฏิเสธเรื่องหลักสูตร
    gc = plan["group_curricula"]
    assert set(gc) == set(out["groups"])
    ordinary = plan["requirements"][:len(plan["requirements"]) - rep["elective_rows"]]
    assert all(gc[r["group_id"]] is not None for r in ordinary)
    refused = _curriculum_refusals(plan, out["groups"], reg["subjects"])
    assert refused == [], (label, len(refused), refused[:3])
    nums = {"old_rows": len(out["requirements"]), "new_rows": rep["rows"], "round_rows": len(source["rows"]),
            "lessons": sum(new.values()), "periods": rep["periods"], "teachers_in_plan": rep["teachers_in_plan"],
            "pools": rep["pools"], "pool_options": rep["pool_options"], "activity_sets": len(rep["activity_sets"]),
            "elective_rows": rep["elective_rows"], "carried": rep["carried"], "not_carried": len(rep["not_carried"]),
            "unconverted": len(prop["unconverted"]), "unconverted_plan_rows": len(lost),
            "unequal_coteach_rows": sum(1 for r in source["rows"] if r["flag"] == FLAG),
            "curricula": len(plan["curricula"]), "teachers_compared": len(old_load),
            "elective_subjects": len(new_el), "curriculum_rows_added": len(rep["curriculum_rows_added"]),
            "check_row_refusals": len(refused)}
    print(f"ไปกลับ {label}: " + " · ".join(f"{k} {v}" for k, v in nums.items()))
    return nums


def test_round_trip_seed():
    # ชุด ก: ข้อมูลตั้งต้น school_data.json (13 ชุด 44 ตัวเลือก · 0 แถวแผนของวิชาเสรี)
    snaps = copy.deepcopy([getattr(mock_api, k) for k in _TOUCHED])
    out, wl_t, wl_s, counters = _outgoing()
    assert [getattr(mock_api, k) for k in _TOUCHED] == snaps      # อ่านอย่างเดียว
    assert out["slots"] == [] and out["served"] == set()
    n = _round_trip(out, wl_t, wl_s, counters, out["pools"], "ชุด ก")
    assert (n["old_rows"], n["new_rows"], n["pools"], n["pool_options"], n["elective_rows"]) == (1220, 1220, 13, 44, 0), n
    assert n["unconverted"] == 0 and n["activity_sets"] == 0
    assert n["curriculum_rows_added"] == 0       # แถวของรอบตรงหลักสูตรตั้งต้นอยู่แล้ว ไม่มีแถววิชาเสรี


# ── ชุด ข: ช่องคาบเสรีรายห้อง + แถวแผนของวิชาเสรีรายห้อง แบบข้อมูลจริงของโรงเรียน ─────────────────
@contextlib.contextmanager
def _scratch():
    """ใช้ตัวแปรของโปรแกรมเป็นกระดาษทด แล้วคืนทั้งเนื้อหาและตัวตนของ list/dict เดิม (คำตัดสิน P1)"""
    saved = {k: (getattr(mock_api, k), copy.deepcopy(getattr(mock_api, k))) for k in _TOUCHED}
    try:
        yield
    finally:
        for k, (obj, snap) in saved.items():
            if isinstance(obj, list):
                obj[:] = snap
            else:
                obj.clear()
                obj.update(snap)
            setattr(mock_api, k, obj)
    for k, (obj, snap) in saved.items():
        assert getattr(mock_api, k) is obj and obj == snap, k


# ชุดคาบเสรีที่แปลงเป็นช่องรายห้อง: รหัสชุดในข้อมูลตั้งต้น → [(วัน, คาบ, คาบคู่)] ทุกห้องของชุดได้ช่องเดียวกัน
# (ห้องของหกชุดนี้ไม่ซ้อนกัน) · คาบ/สัปดาห์ของชุด = จำนวนชั่วโมงของช่อง (คาบคู่ = สองชั่วโมง)
LIVE_CELLS = {1: [(0, 1, True), (0, 3, False)], 3: [(1, 1, True)], 4: [(2, 1, True)], 5: [(3, 1, True)],
              7: [(4, 1, True)], 13: [(1, 3, True)]}
NO_PLAN_ROWS = {7}                          # ชุดที่ไม่มีแถวแผนของวิชาเสรีเลย (ชุดอย่างเดียว)
EXTRA_TEACHER = (13, 269, 7)                # ชุด 13 วิชา 269 มีครูคนที่สอง (ครู 7) · ห้อง 29 เรียนกับครู 7


def _live_shape():
    """สร้างข้อมูลแบบที่โรงเรียนเก็บจริงจากข้อมูลตั้งต้น ด้วย route ของหน้าจัดคาบ (เรียกบนตัวแปรของโปรแกรม — ต้องอยู่ใน _scratch)
    คืน (ชุดคาบเสรีที่คาดว่าเทอมใหม่จะได้, ตัวเลขของการสร้าง)"""
    want = []
    elective_rows = 0
    for pool in copy.deepcopy(mock_api.ELECTIVE_POOLS):
        if pool["id"] not in LIVE_CELLS:
            want.append(pool)
            continue
        opts = [(o["subject_id"], o["teacher_id"], o.get("label")) for o in pool["options"]]
        if pool["id"] == EXTRA_TEACHER[0]:
            opts.append((EXTRA_TEACHER[1], EXTRA_TEACHER[2], "วงที่สอง"))
        mock_api.delete_elective_pool(pool["id"])
        first, rest = pool["group_ids"][0], pool["group_ids"][1:]
        for day, period, double in LIVE_CELLS[pool["id"]]:
            (sid, tid, label), more = opts[0], opts[1:]
            cell = mock_api.create_elective_slot({"group_id": first, "subject_id": sid, "teacher_id": tid,
                                                  "label": label, "day": day, "period": period, "is_double": double})
            for sid, tid, label in more:
                mock_api.add_elective_option(cell["id"], {"subject_id": sid, "teacher_id": tid, "label": label})
            res = mock_api.copy_elective_slot(cell["id"], {"target_group_ids": rest})
            assert res["skipped"] == [], res["skipped"]
        # แถวแผนของวิชาเสรีรายห้อง (ขั้นที่ 2 ข้ามแถวเหล่านี้เพราะชุดนับคาบแทน)
        if pool["id"] in NO_PLAN_ROWS:
            want.append({**pool, "options": [{"subject_id": s, "teacher_id": t} for s, t, _l in opts]})
            continue
        for g in pool["group_ids"]:
            for sid in dict.fromkeys(s for s, _t, _l in opts):
                tid = next(t for s, t, _l in opts if s == sid)
                if (pool["id"], sid) == EXTRA_TEACHER[:2] and g == pool["group_ids"][1]:
                    tid = EXTRA_TEACHER[2]
                mock_api.create_req({"group_id": g, "subject_id": sid, "teacher_id": tid,
                                     "weekly_count": pool["weekly"], "parallel_group_key": None})
                elective_rows += 1
        want.append({**pool, "options": [{"subject_id": s, "teacher_id": t} for s, t, _l in opts]})

    # ช่องที่เว็บไม่มีบนแถวธรรมดา (ปักวัน/คาบ คาบคู่ ห้องปฏิบัติการ เซ็ตห้องย่อย สอนร่วม) ผ่าน route แก้แถวของโปรแกรม
    by_id = {r["id"]: r for r in mock_api.REQUIREMENTS}
    mock_api.update_req(10, {"pinned_day": 0, "pinned_period": 2})
    mock_api.update_req(20, {"pinned_day": 3, "pinned_period": 7, "pinned_double": True})
    mock_api.update_req(30, {"room_id": mock_api.ROOMS[5]["id"]})
    mock_api.update_req(40, {"co_teacher_id": 1 if by_id[40]["teacher_id"] != 1 else 2})
    # เซ็ตห้องย่อย: วิชาเดียวกันของห้องย่อยสองห้อง (ม.4/6ข ม.4/6ค) ชั่วโมงเดียวกัน
    common = sorted({r["subject_id"] for r in mock_api.REQUIREMENTS if r["group_id"] == 80}
                    & {r["subject_id"] for r in mock_api.REQUIREMENTS if r["group_id"] == 81})
    pair = [r for r in mock_api.REQUIREMENTS if r["group_id"] in (80, 81) and r["subject_id"] == common[0]]
    for r in pair:
        mock_api.update_req(r["id"], {"parallel_group_key": "SET-T2", "pinned_day": 2, "pinned_period": 4})
    # สอนร่วมแบบสองแถวที่ชี้กัน คาบเท่ากัน และปักไว้ตรงกัน
    a = by_id[50]
    other = 3 if a["teacher_id"] != 3 else 4
    b = mock_api.create_req({"group_id": a["group_id"], "subject_id": a["subject_id"], "teacher_id": other,
                             "weekly_count": a["weekly_count"], "co_teacher_id": a["teacher_id"],
                             "parallel_group_key": None, "pinned_day": 4, "pinned_period": 1})
    mock_api.update_req(50, {"co_teacher_id": other, "pinned_day": 4, "pinned_period": 1})
    # สอนร่วมแบบสองแถวที่ชี้กันแต่คาบไม่เท่ากัน → ขั้นที่ 2 ติดธง WL_CO_UNEQUAL_FLAG เก็บสองแถว
    # แถวแรกในแผนต้องคาบน้อยกว่า: wl_prefill (ขั้นที่ 2) จับคู่แถวแผนกับบรรทัดหลักสูตรซ้ำของห้อง+วิชาเดียวกันตามลำดับ
    # โดยไม่ดูคาบ แต่ wl_curricula_from_proposal เรียงบรรทัดตามคาบ — ลำดับกลับกันครูสองคนสลับคาบกันตั้งแต่เปิดรอบ
    # (บั๊กของขั้นที่ 2 ไม่ใช่ของการแปลงนี้ — รายงาน Task 2 ข้อกังวล)
    u = next(r for r in mock_api.REQUIREMENTS if r["id"] >= 60)
    other = 5 if u["teacher_id"] != 5 else 6
    v = mock_api.create_req({"group_id": u["group_id"], "subject_id": u["subject_id"], "teacher_id": other,
                             "weekly_count": u["weekly_count"] + 1, "co_teacher_id": u["teacher_id"],
                             "parallel_group_key": None})
    mock_api.update_req(u["id"], {"co_teacher_id": other})
    return want, {"elective_rows": elective_rows, "cells": sum(1 for s in mock_api.SLOTS if s.get("is_elective")),
                  "co_pair": (50, b["id"]), "unequal_pair": (u["id"], v["id"])}


def test_round_trip_live_shape():
    with _scratch():
        want, made = _live_shape()
        out, wl_t, wl_s, counters = _outgoing()
    assert len(LIVE_CELLS) >= 5
    assert made["cells"] > 0 and made["elective_rows"] > 0
    # ช่องของชุดที่แปลงไม่ได้ผูกกับชุดใด (ช่องรายห้องจริง) และแถวแผนของวิชาเสรีถูกโปรแกรมนับว่าสอนในคาบเสรีแล้ว
    assert all(s.get("elective_pool_id") is None for s in out["slots"])
    assert len(out["served"]) == made["elective_rows"]
    n = _round_trip(out, wl_t, wl_s, counters, want, "ชุด ข")
    assert n["pools"] == 13 and n["elective_rows"] == made["elective_rows"], (n, made)
    assert n["carried"] >= 5 and n["unconverted"] == 0, n
    # สอนร่วมสองแถว: คาบเท่ากัน 1 คู่ (รอบรวมเป็นแถวเดียว แล้วเขียนกลับสองแถวตามรูปเดิม) + คาบไม่เท่ากัน 1 คู่ (ธง) →
    # แถวแผนเท่าเดิม และโปรแกรมพับเหลือบทเรียนละหนึ่ง
    assert n["new_rows"] == n["old_rows"] == 1220 + made["elective_rows"] + 2 and n["lessons"] == n["old_rows"] - 2, n
    assert n["unequal_coteach_rows"] == 2 and n["round_rows"] == 1221, n
    assert n["curriculum_rows_added"] > 0 and n["check_row_refusals"] == 0, n    # วิชาเสรีเข้าหลักสูตรของห้อง


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
