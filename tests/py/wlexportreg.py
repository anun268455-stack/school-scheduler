"""
ขั้นที่ 3 งานที่ 1: ซิงก์ทะเบียนครูและวิชาจากรอบเข้าโปรแกรมจัดตาราง (term_from_round.registry_plan — ฟังก์ชันล้วน)

ไม่ใช้ฐานข้อมูล · เรียกฟังก์ชันล้วนตรง ๆ กับข้อมูลรูปสัญญาร่วมของแผน (source / outgoing / counters)
ข้อเดียวที่เรียก route จริงของ mock_api คือการเทียบค่าตั้งต้นกับ /api/teachers/bulk และ /api/subjects/bulk
ซึ่งเขียน TEACHERS SUBJECTS และ _counters — จึงเก็บสำเนาลึกไว้แล้วคืนใน finally (คำตัดสิน P1 ของผู้คุม)
"""
import ast
import copy
import sys
from pathlib import Path

import mock_api
import term_from_round as T

fails: list[str] = []


# ── ตัวช่วยสร้างข้อมูลรูปสัญญาร่วม ─────────────────────────────────────────
def _wt(i, sched_id=None, name=None, code=None, department_id=1, dept_order=None, active=True):
    """ครูในทะเบียนของเว็บ (wl_teachers)"""
    return {"id": i, "sched_id": sched_id, "name": name or f"ครูเว็บ {i}", "code": code,
            "department_id": department_id, "dept_order": dept_order, "active": active}


def _ws(i, sched_id=None, code=None, name=None, type="common", department_id=1, duration=1,
        is_activity=False, is_elective=False, active=True):
    """วิชาในทะเบียนของเว็บ (wl_subjects)"""
    return {"id": i, "sched_id": sched_id, "code": code or f"W{i:05d}", "name": name or f"วิชาเว็บ {i}",
            "type": type, "department_id": department_id, "duration": duration,
            "is_activity": is_activity, "is_elective": is_elective, "active": active}


def _pt(i, **kw):
    """ครูของโปรแกรม รูปเดียวกับ school_data.json (ไม่มี dept_order / active เหมือนข้อมูลตั้งต้น)"""
    t = {"id": i, "code": f"T{i:03d}", "name": f"ครูโปรแกรม {i}", "department_id": 1, "fixed_room_id": None,
         "outdoor_score": 4, "max_slots_per_day": 6, "max_outdoor_per_week": 2}
    t.update(kw)
    return t


def _ps(i, code=None, **kw):
    """วิชาของโปรแกรม รูปเดียวกับ school_data.json (ไม่มี is_elective / prefer_morning / active)"""
    s = {"id": i, "code": code or f"P{i:05d}", "name": f"วิชาโปรแกรม {i}", "type": "common", "duration": 1,
         "department_id": 1, "is_activity": False, "fixed_room_id": None, "credits": 1.0}
    s.update(kw)
    return s


def _line(i, subject_id=None, code="", name="", credits=None, weekly=2, kind="basic", department_id=1):
    return {"id": i, "subject_id": subject_id, "code": code, "name": name, "credits": credits,
            "weekly": weekly, "kind": kind, "department_id": department_id}


def _cur(i, lines, group_ids=(1,)):
    return {"id": i, "name": f"หลักสูตร {i}", "group_ids": list(group_ids), "lines": list(lines)}


def _row(i, line_id, subject_id=None, teacher_id=None, co_teacher_id=None, group_id=1):
    return {"id": i, "group_id": group_id, "line_id": line_id, "subject_id": subject_id, "weekly": 2,
            "teacher_id": teacher_id, "co_teacher_id": co_teacher_id, "lab_room_id": None,
            "is_double": False, "confirmed": True, "flag": None, "department_id": 1}


def _opt(i, subject_id=None, code="", name="", department_id=1, teachers=(), set_id=1):
    return {"id": i, "set_id": set_id, "subject_id": subject_id, "code": code, "name": name,
            "department_id": department_id,
            "set": {"id": set_id, "kind": "elective", "name": "ชุด 1", "group_ids": [1], "weekly": 2,
                    "is_double": False},
            "teachers": [{"id": 900 + n, "option_id": i, "set_id": set_id, "teacher_id": t, "room_id": None,
                          "confirmed": True} for n, t in enumerate(teachers)]}


def _src(**kw):
    s = {"round": {"id": 1, "year": 2569, "semester": 2, "label": "2/2569", "status": "closed",
                   "exported_at": None},
         "rows": [], "options": [], "sets": [], "curricula": [], "wl_teachers": [], "wl_subjects": [],
         "dept_status": []}
    s.update(kw)
    return s


def _out(teachers=(), subjects=()):
    return {"requirements": [], "pools": [], "slots": [], "served": [], "sched_subjects": [], "groups": [],
            "teachers": list(teachers), "subjects": list(subjects), "curricula": []}


def _by_id(rows, i):
    hits = [r for r in rows if r["id"] == i]
    assert len(hits) == 1, (i, hits)
    return hits[0]


# ── ค่าตั้งต้นต้องเป็นค่าเดียวกับ route bulk ของโปรแกรม ────────────────────────
def test_defaults_match_bulk_routes():
    # เรียก route จริงบนตัวแปรของโปรแกรม แล้วคืนทุกตัวที่มันแตะ (คำตัดสิน P1)
    saved = (copy.deepcopy(mock_api.TEACHERS), copy.deepcopy(mock_api.SUBJECTS), copy.deepcopy(mock_api._counters))
    try:
        t_body = {"name": "ครูใหม่", "code": "T900", "department_id": 2, "dept_order": 4}
        made_t = mock_api.bulk_create_teachers([dict(t_body)])[0]
        for k, v in T.TEACHER_DEFAULTS.items():
            assert k in made_t and made_t[k] == v, (k, made_t.get(k), v)
        # bulk เพิ่มค่าตั้งต้นช่องใหม่เมื่อไร ตัวทดสอบนี้ต้องล้ม — ไม่งั้นครูที่ส่งจากรอบจะขาดช่องนั้นเงียบ ๆ
        assert set(made_t) - set(t_body) - {"id"} == set(T.TEACHER_DEFAULTS), set(made_t)

        s_body = {"code": "S900", "name": "วิชาใหม่", "type": "parallel", "department_id": 2, "duration": 2,
                  "is_activity": True, "is_elective": True}
        made_s = mock_api.bulk_create_subjects([dict(s_body)])[0]
        plain_s = mock_api.bulk_create_subjects([{"code": "S901", "name": "วิชาเปล่า"}])[0]
        for k, v in T.SUBJECT_DEFAULTS.items():
            assert k in plain_s and plain_s[k] == v, (k, plain_s.get(k), v)
        assert set(plain_s) - {"code", "name", "id"} == set(T.SUBJECT_DEFAULTS), set(plain_s)

        # ครู/วิชาที่ registry_plan สร้าง = สิ่งที่ bulk สร้างจากช่องตัวตนชุดเดียวกัน (ต่างกันแค่รหัส และ credits ของวิชา)
        src = _src(wl_teachers=[_wt(1, **{k: t_body[k] for k in T.TEACHER_OWNED})],
                   wl_subjects=[_ws(1, **{k: s_body[k] for k in T.SUBJECT_OWNED})])
        plan = T.registry_plan(src, _out(), {"teacher": 500, "subject": 700})
        new_t = _by_id(plan["teachers"], 501)
        assert {k: v for k, v in new_t.items() if k != "id"} == {k: v for k, v in made_t.items() if k != "id"}
        new_s = _by_id(plan["subjects"], 701)
        assert {k: v for k, v in new_s.items() if k not in ("id", "credits")} == \
            {k: v for k, v in made_s.items() if k != "id"}
    finally:
        mock_api.TEACHERS[:] = saved[0]
        mock_api.SUBJECTS[:] = saved[1]
        mock_api._counters.clear()
        mock_api._counters.update(saved[2])
    assert mock_api.TEACHERS == saved[0] and mock_api.SUBJECTS == saved[1] and mock_api._counters == saved[2]


def test_module_does_not_import_mock_api():
    # โมดูลล้วนต้องไม่ลากตัวแปรของโปรแกรมเข้ามา — ทั้ง import ตรงและ from-import
    tree = ast.parse(Path(T.__file__).read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module.split(".")[0])
    assert "mock_api" not in names, names


# ── ครู ───────────────────────────────────────────────────────────────────
def test_creates_teacher_without_sched_id_and_maps_back():
    src = _src(wl_teachers=[_wt(10, sched_id=1), _wt(11, name="ครูใหม่", code="T050", department_id=3, dept_order=2)])
    out = _out(teachers=[_pt(1, name="ครูเว็บ 10", code=None)])
    plan = T.registry_plan(src, out, {"teacher": 1})
    assert len(plan["teachers"]) == 2
    new = _by_id(plan["teachers"], 2)
    assert (new["name"], new["code"], new["department_id"], new["dept_order"]) == ("ครูใหม่", "T050", 3, 2)
    assert plan["teacher_map"] == {10: 1, 11: 2}
    assert plan["writeback"]["teachers"] == [{"id": 11, "old": None, "new": 2}]
    assert [(r["wl_id"], r["id"]) for r in plan["report"]["teachers_created"]] == [(11, 2)]
    assert plan["reasons"] == []


def test_creates_inactive_teacher_only_when_used_by_round():
    src = _src(wl_teachers=[_wt(20, active=False), _wt(21, active=False), _wt(22, active=False),
                            _wt(23, active=False)],
               curricula=[_cur(1, [_line(100, subject_id=None, code="X1", name="x")])],
               rows=[_row(1, 100, teacher_id=21), _row(2, 100, co_teacher_id=22, group_id=2)],
               options=[_opt(5, subject_id=None, code="X1", teachers=[23])])
    plan = T.registry_plan(src, _out(), {"teacher": 0})
    # 20 ไม่ปฏิบัติงานและไม่ถูกอ้าง → ไม่สร้าง · 21 22 23 ถูกอ้าง (ครูผู้สอน ครูสอนร่วม ครูของตัวเลือก) → สร้าง
    assert sorted(plan["teacher_map"]) == [21, 22, 23]
    assert [w["id"] for w in plan["writeback"]["teachers"]] == [21, 22, 23]
    assert all(t["active"] is True for t in plan["teachers"])


def test_dangling_sched_id_is_recreated():
    src = _src(wl_teachers=[_wt(30, sched_id=77, name="ครูที่ถูกลบในโปรแกรม"),
                            _wt(31, sched_id=78, active=False)])
    plan = T.registry_plan(src, _out(teachers=[_pt(1)]), {"teacher": 1})
    # 77 ไม่มีในโปรแกรมแล้ว → สร้างใหม่และเขียนกลับ · 78 ก็ไม่มี แต่ไม่ปฏิบัติงานและไม่ถูกอ้าง → ไม่สร้าง
    assert plan["writeback"]["teachers"] == [{"id": 30, "old": 77, "new": 2}]
    assert _by_id(plan["teachers"], 2)["name"] == "ครูที่ถูกลบในโปรแกรม"
    assert 31 not in plan["teacher_map"]


def test_patch_touches_only_owned_fields():
    # ข้อทดสอบ 10ก ของสเปกหลัก: แก้ชื่อในเว็บแล้ว ช่องอื่นของครูในโปรแกรมต้องเท่าเดิมทุกช่อง
    prog = _pt(5, name="ชื่อเดิม", code="T005", department_id=1, fixed_room_id=42, max_slots_per_day=4,
               outdoor_score=1, max_outdoor_per_week=0, active=True,
               advanced_settings={"unavailable": [[1, 2], [3, 4]], "note": "ห้ามเช้าวันจันทร์"})
    src = _src(wl_teachers=[_wt(50, sched_id=5, name="ชื่อใหม่", code="T005", department_id=4, dept_order=3)])
    plan = T.registry_plan(src, _out(teachers=[prog]), {"teacher": 5})
    after = _by_id(plan["teachers"], 5)
    owned = set(T.TEACHER_OWNED)
    assert {k: v for k, v in after.items() if k not in owned} == {k: v for k, v in prog.items() if k not in owned}
    assert (after["name"], after["department_id"], after["dept_order"]) == ("ชื่อใหม่", 4, 3)
    [p] = plan["report"]["teachers_patched"]
    assert (p["wl_id"], p["id"]) == (50, 5)
    assert p["changes"] == {"name": ["ชื่อเดิม", "ชื่อใหม่"], "department_id": [1, 4], "dept_order": [None, 3]}
    assert plan["writeback"]["teachers"] == []


def test_equal_after_normalising_is_not_a_patch():
    # ข้อมูลตั้งต้นไม่มีช่อง dept_order / is_elective · การดึงเข้าเว็บแปลงช่องว่างเป็นค่าตั้งต้น
    # สองฝั่งที่หมายถึงสิ่งเดียวกันต้องไม่ขึ้นเป็น "จะแก้" ในสรุป และไม่เติมช่องใหม่ให้แถวของโปรแกรม
    prog_t = _pt(1, code="T001")
    prog_s = _ps(1, code="ค21101", type=None, duration=None)
    del prog_s["is_activity"]
    src = _src(wl_teachers=[_wt(1, sched_id=1, name="ครูโปรแกรม 1", code=" T001 ", dept_order=None)],
               wl_subjects=[_ws(1, sched_id=1, code="ค21101", name="วิชาโปรแกรม 1")])
    plan = T.registry_plan(src, _out(teachers=[prog_t], subjects=[prog_s]), {})
    assert plan["report"]["teachers_patched"] == [] and plan["report"]["subjects_patched"] == []
    assert plan["teachers"] == [prog_t] and plan["subjects"] == [prog_s]


def test_mirror_of_seed_registry_changes_nothing():
    # ทะเบียนของเว็บที่ได้จากปุ่มดึงจากโปรแกรม (รูปเดียวกับที่ _wl_import_rows เขียน) กับข้อมูลตั้งต้นทั้งชุด
    # → ไม่สร้าง ไม่แก้ ไม่มีครูที่เว็บไม่รู้จัก (กันสรุปหน้าดูก่อนสร้างที่ขึ้น "จะแก้ 271 วิชา" ทั้งที่ไม่มีอะไรต่าง)
    teachers, subjects = copy.deepcopy(mock_api.TEACHERS), copy.deepcopy(mock_api.SUBJECTS)
    _t, _n, t_cols, t_row = mock_api._WL_IMPORTS["teachers"]
    _s, _n, s_cols, s_row = mock_api._WL_IMPORTS["subjects"]
    wl_t = [{"id": n + 1, **dict(zip(t_cols, t_row(t)))} for n, t in enumerate(teachers)]
    wl_s = [{"id": n + 1, **dict(zip(s_cols, s_row(s)))} for n, s in enumerate(subjects)]
    plan = T.registry_plan(_src(wl_teachers=wl_t, wl_subjects=wl_s),
                           _out(teachers=teachers, subjects=subjects), copy.deepcopy(mock_api._counters))
    assert len(teachers) == 143 and len(subjects) == 271
    rep = plan["report"]
    assert {k: len(v) for k, v in rep.items()} == {k: 0 for k in rep}, {k: v[:3] for k, v in rep.items() if v}
    assert plan["teachers"] == teachers and plan["subjects"] == subjects
    assert len(plan["teacher_map"]) == 143 and len(plan["subject_map"]) == 271
    assert plan["reasons"] == []


def test_inactive_in_web_is_reported_not_closed():
    src = _src(wl_teachers=[_wt(60, sched_id=6, name="ครูโปรแกรม 6", code="T006", active=False),
                            _wt(61, sched_id=7, name="ครูโปรแกรม 7", code="T007", active=False)])
    out = _out(teachers=[_pt(6, active=True), _pt(7, active=False)])
    plan = T.registry_plan(src, out, {"teacher": 7})
    # ไม่ส่งสถานะไม่ปฏิบัติงานไปปิดในโปรแกรม — ขึ้นในสรุปอย่างเดียว · 7 ปิดในโปรแกรมอยู่แล้ว ไม่นับ
    assert _by_id(plan["teachers"], 6)["active"] is True
    assert [(r["wl_id"], r["id"]) for r in plan["report"]["inactive_open"]] == [(60, 6)]
    assert plan["report"]["teachers_patched"] == []


def test_unknown_program_teachers_are_listed():
    src = _src(wl_teachers=[_wt(70, sched_id=1, name="ครูโปรแกรม 1", code="T001"),
                            _wt(71, sched_id=99)])   # 99 ห้อยอยู่ ไม่ได้ชี้ครูคนไหนของโปรแกรม
    out = _out(teachers=[_pt(1), _pt(2, name="ครูที่เว็บไม่รู้จัก"), _pt(3, active=False)])
    plan = T.registry_plan(src, out, {"teacher": 3})
    unk = plan["report"]["unknown_teachers"]
    assert [(u["id"], u["name"]) for u in unk] == [(2, "ครูที่เว็บไม่รู้จัก"), (3, "ครูโปรแกรม 3")]
    assert [u["active"] for u in unk] == [True, False]
    # ไม่ทำอะไรกับครูเหล่านี้
    assert _by_id(plan["teachers"], 2) == out["teachers"][1] and _by_id(plan["teachers"], 3) == out["teachers"][2]


# ── วิชา ─────────────────────────────────────────────────────────────────
def test_subject_rules_follow_teacher_rules():
    src = _src(wl_subjects=[_ws(1, sched_id=None), _ws(2, active=False), _ws(3, active=False),
                            _ws(4, active=False), _ws(5, sched_id=55)],
               curricula=[_cur(1, [_line(100, subject_id=3, credits=2)])],
               options=[_opt(7, subject_id=4)])
    plan = T.registry_plan(src, _out(subjects=[_ps(1)]), {"subject": 1})
    # 1 ปฏิบัติงาน → สร้าง · 2 ไม่ปฏิบัติงาน ไม่ถูกอ้าง → ไม่สร้าง · 3 (บรรทัด) 4 (ตัวเลือก) ถูกอ้าง → สร้าง · 5 ห้อย → สร้างใหม่
    assert sorted(plan["subject_map"]) == [1, 3, 4, 5]
    assert plan["writeback"]["subjects"] == [{"id": 1, "old": None, "new": 2}, {"id": 3, "old": None, "new": 3},
                                             {"id": 4, "old": None, "new": 4}, {"id": 5, "old": 55, "new": 5}]
    assert [s["id"] for s in plan["report"]["subjects_created"]] == [2, 3, 4, 5]


def test_typed_code_used_by_three_lines_creates_one_subject():
    lines_a = [_line(101, code=" ว30999 ", name="วิทยาการคำนวณพิเศษ", credits=1.5, department_id=4),
               _line(102, code="ว30999", name="ชื่ออื่น", credits=2)]
    src = _src(curricula=[_cur(1, lines_a), _cur(2, [_line(103, code="ว30999 ", name="ชื่อที่สาม")])],
               options=[_opt(8, code="ว30999", name="ตัวเลือก")])
    typed = T.typed_subjects(src)
    assert typed == [{"code": "ว30999", "name": "วิทยาการคำนวณพิเศษ", "department_id": 4, "credits": 1.5,
                      "line_ids": [101, 102, 103], "option_ids": [8]}]
    plan = T.registry_plan(src, _out(subjects=[_ps(1)]), {"subject": 1})
    assert len(plan["subjects"]) == 2
    new = _by_id(plan["subjects"], 2)
    assert (new["code"], new["name"], new["department_id"], new["credits"]) == ("ว30999", "วิทยาการคำนวณพิเศษ", 4, 1.5)
    assert plan["typed_map"] == {"ว30999": 2}
    [w] = plan["writeback"]["new_wl_subjects"]
    assert (w["code"], w["name"], w["department_id"], w["sched_id"]) == ("ว30999", "วิทยาการคำนวณพิเศษ", 4, 2)
    assert (w["line_ids"], w["option_ids"]) == ([101, 102, 103], [8])
    # แถวที่จะใส่ในทะเบียนของเว็บต้องตรงกับวิชาในโปรแกรมทุกช่องตัวตน — ไม่งั้นรอบหน้าจะ "แก้" วิชานี้ในโปรแกรม
    assert {k: w[k] for k in T.SUBJECT_OWNED} == {k: new[k] for k in T.SUBJECT_OWNED}
    assert plan["writeback"]["bind_wl_subjects"] == []


def test_typed_code_matching_web_subject_binds_instead_of_create():
    src = _src(wl_subjects=[_ws(9, sched_id=None, code="ส31234", active=False)],
               curricula=[_cur(1, [_line(110, code="ส31234 ", name="สังคม"), _line(111, code="ส31234")])],
               options=[_opt(12, code=" ส31234")])
    plan = T.registry_plan(src, _out(subjects=[_ps(1)]), {"subject": 1})
    # ไม่สร้างวิชาในทะเบียนของเว็บ ผูกบรรทัดกับวิชา 9 แทน · วิชา 9 ไม่ปฏิบัติงาน แต่ตอนนี้ถูกอ้าง จึงสร้างในโปรแกรม
    assert plan["writeback"]["new_wl_subjects"] == []
    assert plan["writeback"]["bind_wl_subjects"] == [{"id": 9, "code": "ส31234", "line_ids": [110, 111],
                                                      "option_ids": [12]}]
    assert plan["subject_map"] == {9: 2} and plan["typed_map"] == {"ส31234": 2}
    assert len(plan["subjects"]) == 2


def test_typed_code_on_web_subject_that_is_twice_in_web_is_a_reason():
    src = _src(wl_subjects=[_ws(1, sched_id=1, code="ส31234"), _ws(2, sched_id=2, code="ส31234")],
               curricula=[_cur(1, [_line(110, code="ส31234", name="สังคม")])])
    plan = T.registry_plan(src, _out(subjects=[_ps(1, code="ส31234"), _ps(2, code="ส31234")]), {"subject": 2})
    assert plan["typed_map"] == {} and plan["writeback"]["new_wl_subjects"] == []
    assert len(plan["reasons"]) == 1 and "ส31234" in plan["reasons"][0]


def test_code_link_to_single_unlinked_program_subject():
    prog = _ps(40, code="ค31101", name="คณิต ชื่อในโปรแกรม", department_id=2, fixed_room_id=8, credits=1.5,
               prefer_morning=True)
    src = _src(wl_subjects=[_ws(4, sched_id=None, code=" ค31101", name="คณิตศาสตร์พื้นฐาน", department_id=2)])
    plan = T.registry_plan(src, _out(subjects=[prog]), {"subject": 40})
    assert len(plan["subjects"]) == 1 and plan["counters"]["subject"] == 40
    assert plan["subject_map"] == {4: 40}
    assert plan["writeback"]["subjects"] == [{"id": 4, "old": None, "new": 40}]
    assert [(c["wl_id"], c["id"], c["code"]) for c in plan["report"]["code_links"]] == [(4, 40, "ค31101")]
    after = _by_id(plan["subjects"], 40)
    assert after["name"] == "คณิตศาสตร์พื้นฐาน"           # แก้ช่องตัวตนที่ต่าง
    assert (after["fixed_room_id"], after["credits"], after["prefer_morning"]) == (8, 1.5, True)
    assert [p["changes"] for p in plan["report"]["subjects_patched"]] == \
        [{"name": ["คณิต ชื่อในโปรแกรม", "คณิตศาสตร์พื้นฐาน"]}]
    assert plan["reasons"] == []


def test_typed_code_on_lines_and_option_matching_program_subject_gives_one_subject():
    # Review Focus ข้อ 5: วิชาที่พิมพ์รหัสเองถูกอ้างหลายบรรทัด และรหัสชนกับวิชาที่มีอยู่ในโปรแกรม → ได้วิชาเดียว
    prog = _ps(40, code="ง30200", name="งานช่าง", duration=2, is_activity=True, department_id=6)
    src = _src(curricula=[_cur(1, [_line(120, code="ง30200", name="งานช่างพื้นฐาน", department_id=6)]),
                          _cur(2, [_line(121, code="ง30200 ", name="งานช่าง ม.ปลาย", department_id=6)])],
               options=[_opt(30, code="ง30200", department_id=6)])
    plan = T.registry_plan(src, _out(subjects=[prog]), {"subject": 40})
    assert len(plan["subjects"]) == 1 and plan["typed_map"] == {"ง30200": 40}
    [w] = plan["writeback"]["new_wl_subjects"]
    assert (w["sched_id"], w["line_ids"], w["option_ids"]) == (40, [120, 121], [30])
    after = _by_id(plan["subjects"], 40)
    # บรรทัดบอกได้แค่รหัส ชื่อ กลุ่มสาระ — ช่องตัวตนอื่นของวิชาในโปรแกรมคงไว้ และแถวในทะเบียนของเว็บรับค่าเหล่านั้นไป
    assert (after["name"], after["duration"], after["is_activity"]) == ("งานช่างพื้นฐาน", 2, True)
    assert {k: w[k] for k in T.SUBJECT_OWNED} == \
        {"code": "ง30200", "name": "งานช่างพื้นฐาน", "type": "common", "department_id": 6, "duration": 2,
         "is_activity": True, "is_elective": False}
    assert [(c["wl_id"], c["id"]) for c in plan["report"]["code_links"]] == [(None, 40)]


def test_code_on_two_program_subjects_is_a_reason():
    src = _src(wl_subjects=[_ws(4, sched_id=None, code="ค31101", name="คณิต")],
               curricula=[_cur(1, [_line(130, code="อ31999", name="อังกฤษพิเศษ")])])
    out = _out(subjects=[_ps(40, code="ค31101"), _ps(41, code=" ค31101"), _ps(50, code="อ31999"),
                         _ps(51, code="อ31999")])
    plan = T.registry_plan(src, out, {"subject": 51})
    assert len(plan["subjects"]) == 4 and plan["subject_map"] == {} and plan["typed_map"] == {}
    assert len(plan["reasons"]) == 2
    assert "ค31101" in plan["reasons"][0] and "อ31999" in plan["reasons"][1]
    assert plan["writeback"]["subjects"] == [] and plan["writeback"]["new_wl_subjects"] == []


def test_code_of_program_subject_owned_by_other_web_subject_is_a_reason():
    # ทะเบียนของเว็บมีรหัสซ้ำค้างจากขั้นที่ 1: วิชา 1 ผูกวิชา 40 อยู่แล้ว วิชา 2 รหัสเดียวกันต้องไม่แย่งไปผูก
    src = _src(wl_subjects=[_ws(1, sched_id=40, code="ค31101", name="วิชาโปรแกรม 40"),
                            _ws(2, sched_id=None, code="ค31101", name="คณิตซ้ำ")])
    plan = T.registry_plan(src, _out(subjects=[_ps(40, code="ค31101")]), {"subject": 40})
    assert plan["subject_map"] == {1: 40}
    assert len(plan["reasons"]) == 1 and "ค31101" in plan["reasons"][0]
    assert len(plan["subjects"]) == 1


def test_code_linked_after_patch_of_linked_subject():
    # วิชา 1 ผูกวิชา 40 และแก้รหัสในเว็บจาก ค31101 เป็น ค31102 · วิชา 2 ใหม่ใช้รหัส ค31101
    # รหัสของโปรแกรมให้ดูหลังแก้ช่องตัวตน: 40 จะเป็น ค31102 แล้ว ค31101 จึงว่าง → สร้างวิชาใหม่ ไม่ใช่เหตุ
    src = _src(wl_subjects=[_ws(1, sched_id=40, code="ค31102", name="วิชาโปรแกรม 40"),
                            _ws(2, sched_id=None, code="ค31101", name="คณิตใหม่")])
    plan = T.registry_plan(src, _out(subjects=[_ps(40, code="ค31101")]), {"subject": 40})
    assert plan["reasons"] == []
    assert plan["subject_map"] == {1: 40, 2: 41}
    assert (_by_id(plan["subjects"], 40)["code"], _by_id(plan["subjects"], 41)["code"]) == ("ค31102", "ค31101")


def test_new_subject_credits_from_first_line():
    src = _src(wl_subjects=[_ws(1), _ws(2), _ws(3)],
               curricula=[_cur(1, [_line(10, subject_id=3, credits=None), _line(11, subject_id=1, credits=1.5)]),
                          _cur(2, [_line(12, subject_id=1, credits=2.0), _line(13, subject_id=3, credits=0.5)])],
               options=[_opt(5, subject_id=2)])
    plan = T.registry_plan(src, _out(), {"subject": 0})
    by_wl = {w: _by_id(plan["subjects"], s) for w, s in plan["subject_map"].items()}
    # บรรทัดแรกที่อ้างถึงตามลำดับหลักสูตรแล้วบรรทัด — แม้หน่วยกิตของบรรทัดแรกว่าง · ไม่มีบรรทัดอ้าง → ว่าง
    assert (by_wl[1]["credits"], by_wl[2]["credits"], by_wl[3]["credits"]) == (1.5, None, None)


def test_ids_come_from_counters_and_counters_advance():
    src = _src(wl_teachers=[_wt(1), _wt(2)], wl_subjects=[_ws(1)],
               curricula=[_cur(1, [_line(10, code="ก1", name="ก")])])
    counters = {"teacher": 143, "subject": 271, "requirement": 1220}
    plan = T.registry_plan(src, _out(teachers=[_pt(143)], subjects=[_ps(271)]), counters)
    assert plan["teacher_map"] == {1: 144, 2: 145}
    assert plan["subject_map"] == {1: 272} and plan["typed_map"] == {"ก1": 273}
    assert plan["counters"] == {"teacher": 145, "subject": 273, "requirement": 1220}
    assert counters == {"teacher": 143, "subject": 271, "requirement": 1220}
    # ตัวนับที่ยังไม่มีคีย์เริ่มจาก 0 แบบ _next
    plan = T.registry_plan(_src(wl_teachers=[_wt(1)]), _out(), {})
    assert plan["teacher_map"] == {1: 1} and plan["counters"] == {"teacher": 1}


def test_new_ids_skip_numbers_held_by_web_sched_ids():
    # ครู 30 ไม่ปฏิบัติงาน ถือ sched_id 6 ที่ห้อยอยู่ (ไม่สร้างใหม่ จึงถือต่อ) · wl_teachers.sched_id เป็น UNIQUE
    # ถ้าให้ครูใหม่ได้รหัส 6 การเขียนกลับจะชนกัน (หรือแย่กว่า: ครู 30 กลายเป็นคนเดียวกับครูใหม่)
    src = _src(wl_teachers=[_wt(30, sched_id=6, active=False), _wt(31)],
               wl_subjects=[_ws(40, sched_id=4, active=False), _ws(41)])
    plan = T.registry_plan(src, _out(teachers=[_pt(5)], subjects=[_ps(3)]), {"teacher": 5, "subject": 3})
    assert plan["teacher_map"] == {31: 7} and plan["counters"]["teacher"] == 7
    assert plan["subject_map"] == {41: 5} and plan["counters"]["subject"] == 5


def test_inputs_not_mutated():
    src = _src(wl_teachers=[_wt(1, sched_id=1, name="ชื่อใหม่"), _wt(2), _wt(3, sched_id=99)],
               wl_subjects=[_ws(1, sched_id=1, name="ชื่อวิชาใหม่"), _ws(2, code="ค31101"), _ws(3)],
               curricula=[_cur(1, [_line(10, subject_id=3, credits=1), _line(11, code="ก1", name="ก")])],
               rows=[_row(1, 10, subject_id=3, teacher_id=2)],
               options=[_opt(5, code="ก1", teachers=[3])])
    out = _out(teachers=[_pt(1)], subjects=[_ps(1), _ps(2, code="ค31101")])
    counters = {"teacher": 1, "subject": 2}
    before = copy.deepcopy((src, out, counters))
    plan = T.registry_plan(src, out, counters)
    T.typed_subjects(src)
    assert (src, out, counters) == before
    # ผลเป็นของใหม่ทั้งหมด: แก้ผลแล้วต้องไม่ย้อนไปถึงรายการที่ส่งเข้ามา
    for row in plan["teachers"] + plan["subjects"]:
        row["name"] = "เปลี่ยน"
    plan["counters"]["teacher"] = 999
    assert (src, out, counters) == before
    assert plan["report"]["teachers_patched"] and plan["report"]["code_links"] and plan["writeback"]["teachers"]


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
