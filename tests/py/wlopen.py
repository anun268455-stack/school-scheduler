"""
เว็บลงอัตรากำลัง ขั้นที่ 2 งานที่ 3: เปิดรอบจากหลักสูตร ใส่ครูเทอมก่อนให้ยืนยัน และแถวที่ตามหลักสูตร

wl_prefill เป็นฟังก์ชันล้วน เรียกตรง ๆ · route คุยกับฐานข้อมูลปลอมชุดเดียวกับ wlcurriculum.py (อ่านโครงตารางจาก
_WL_SCHEMA ตรวจ UNIQUE/NOT NULL/CASCADE และตรวจ FK ตอนจบธุรกรรม) — sync ที่ลืมลบแถวค้างของรอบจึงล้มที่นี่
เหมือนล้มตอน COMMIT ของ Postgres · รหัสฝั่งเว็บนี้ต่างจากรหัสฝั่งตารางเสมอ ถ้าลืมแปลงที่ไหนตัวทดสอบเห็นทันที
"""
import collections
import contextlib
import copy
import re
import sys

import mock_api
from wlcurriculum import (ADMIN, GLOBALS, HEAD, NOREQ, REQ, FakeCur, FakeDb, _call, _code, _db, _patched, _state,
                          _term, _thai)

fails: list[str] = []


# ── ฟังก์ชันล้วน: wl_prefill ───────────────────────────────────────────────
# วิชาฝั่งตาราง n → wl_subjects.id n + 500 · ครูฝั่งตาราง n → wl_teachers.id n + 100
SUBJECT_IDS = {s: s + 500 for s in range(1, 20)}


def _row(gid, sched_sid, tid, co=None, **kw):
    """แถวรูปเดียวกับที่ wl_round_proposal คืน (วิชาเป็นรหัสของเว็บนี้แล้ว)"""
    return {"department_id": 1, "group_id": gid, "subject_id": SUBJECT_IDS[sched_sid], "code": f"C{sched_sid}",
            "name": f"วิชา {sched_sid}", "credits": 1, "weekly": kw.get("weekly", 2), "kind": "basic",
            "teacher_id": tid, "co_teacher_id": co, "lab_room_id": kw.get("lab"), "is_double": False, "note": "",
            "confirmed": False, "from_plan": True, "flag": kw.get("flag")}


def _set(gids, options, kind="elective"):
    return {"kind": kind, "name": "ชุด", "group_ids": gids, "weekly": 2, "is_double": False,
            "options": [{"subject_id": SUBJECT_IDS[s], "code": f"C{s}", "name": f"วิชา {s}", "department_id": 7,
                         "teacher_id": t, "room_id": room, "note": "", "confirmed": False, "from_plan": True}
                        for s, t, room in options]}


def _prop(rows=(), sets=()):
    return {"rows": list(rows), "sets": list(sets), "unconverted": [], "counts": {}}


def _lk(line_id, gid, sched_sid):
    return {"line_id": line_id, "group_id": gid, "sched_subject_id": sched_sid}


def test_prefill_same_room_and_subject_gets_last_term_teacher():
    prop = _prop([_row(11, 1, 103, lab=40), _row(12, 1, 104)])
    out = mock_api.wl_prefill(prop, [_lk(7, 11, 1), _lk(7, 12, 1)], [], SUBJECT_IDS)
    assert out == {"rows": {(7, 11): {"teacher_id": 103, "co_teacher_id": None, "lab_room_id": 40, "flag": None},
                            (7, 12): {"teacher_id": 104, "co_teacher_id": None, "lab_room_id": None, "flag": None}},
                   "options": {}}, out


def test_prefill_same_subject_in_another_room_is_not_filled():
    prop = _prop([_row(11, 1, 103)])
    out = mock_api.wl_prefill(prop, [_lk(7, 12, 1), _lk(8, 11, 2)], [], SUBJECT_IDS)
    assert out == {"rows": {}, "options": {}}, out


def test_prefill_matches_by_timetable_subject_id_not_by_code_or_wl_id():
    # บรรทัดที่ไม่มีวิชาในทะเบียน (พิมพ์รหัสเอง) ไม่มีครูเทอมก่อน แม้รหัสจะเหมือนกัน
    prop = _prop([_row(11, 1, 103)])
    assert mock_api.wl_prefill(prop, [_lk(7, 11, None)], [], SUBJECT_IDS)["rows"] == {}
    # sched_subject_id ต้องผ่านการแปลง: ส่งรหัสของเว็บนี้ (501) มาแทน sched (1) ต้องไม่ตรง
    assert mock_api.wl_prefill(prop, [_lk(7, 11, SUBJECT_IDS[1])], [], SUBJECT_IDS)["rows"] == {}


def test_prefill_co_teacher_pair_gives_co_teacher_id():
    # ผ่าน wl_round_proposal จริง: คู่สอนร่วมคาบเท่ากันเป็นแถวเดียว ครูคนที่สองเป็นครูสอนร่วม
    src = {"requirements": [{"id": 1, "group_id": 11, "subject_id": 1, "teacher_id": 3, "co_teacher_id": 4,
                             "weekly_count": 3},
                            {"id": 2, "group_id": 11, "subject_id": 1, "teacher_id": 4, "co_teacher_id": 3,
                             "weekly_count": 3}],
           "pools": [], "slots": [], "served": set(),
           "sched_subjects": {1: {"id": 1, "code": "ท21102", "name": "ไทย", "credits": 1.5}},
           "groups": {11: {"id": 11, "name": "ม.1/1"}},
           "teacher_ids": {3: 103, 4: 104}, "subject_ids": {1: 501}, "subject_depts": {501: 1}}
    prop = mock_api.wl_round_proposal(src)
    out = mock_api.wl_prefill(prop, [_lk(7, 11, 1)], [], src["subject_ids"])
    assert out["rows"] == {(7, 11): {"teacher_id": 103, "co_teacher_id": 104, "lab_room_id": None, "flag": None}}


def test_prefill_copies_the_flag_of_an_unequal_pair_and_fills_duplicate_lines_in_order():
    flag = mock_api.WL_CO_UNEQUAL_FLAG
    prop = _prop([_row(11, 1, 103, flag=flag, weekly=2), _row(11, 1, 104, flag=flag, weekly=1)])
    # หลักสูตรคงสองบรรทัดของวิชาเดียวกันในห้องนี้ → แถวละครู ตามลำดับ
    two = mock_api.wl_prefill(prop, [_lk(7, 11, 1), _lk(8, 11, 1)], [], SUBJECT_IDS)["rows"]
    assert two == {(7, 11): {"teacher_id": 103, "co_teacher_id": None, "lab_room_id": None, "flag": flag},
                   (8, 11): {"teacher_id": 104, "co_teacher_id": None, "lab_room_id": None, "flag": flag}}, two
    # บรรทัดเดียว → ครูคนแรก พร้อมธงให้หัวหน้าเห็นว่าแผนเดิมขัดกัน
    one = mock_api.wl_prefill(prop, [_lk(7, 11, 1)], [], SUBJECT_IDS)["rows"]
    assert one == {(7, 11): two[(7, 11)]}


def test_prefill_row_without_teacher_in_the_plan_is_left_empty():
    prop = _prop([_row(11, 1, None), _row(11, 2, 105)])
    out = mock_api.wl_prefill(prop, [_lk(7, 11, 1), _lk(8, 11, 2)], [], SUBJECT_IDS)
    assert set(out["rows"]) == {(8, 11)}


def test_prefill_elective_option_takes_every_teacher_of_overlapping_rooms_once():
    prop = _prop(sets=[_set([15, 16, 17], [(6, 108, 30), (6, 109, None), (7, 110, None), (6, None, None)]),
                       _set([16], [(6, 108, None), (6, 111, 31)]),
                       _set([18, 19], [(6, 112, None)])])                 # ห้องไม่ซ้อน → ไม่เอา
    keys = [{"option_id": 70, "group_ids": [11, 12, 13, 14, 15, 16], "sched_subject_id": 6},
            {"option_id": 71, "group_ids": [11, 12], "sched_subject_id": 6},     # ห้องไม่ซ้อนกับชุดไหนเลย
            {"option_id": 72, "group_ids": [17], "sched_subject_id": 7},
            {"option_id": 73, "group_ids": [15], "sched_subject_id": None}]
    out = mock_api.wl_prefill(prop, [], keys, SUBJECT_IDS)
    assert out == {"rows": {}, "options": {70: [{"teacher_id": 108, "room_id": 30}, {"teacher_id": 109, "room_id": None},
                                                {"teacher_id": 111, "room_id": 31}],
                                           72: [{"teacher_id": 110, "room_id": None}]}}, out


def test_prefill_does_not_mutate_its_input():
    prop = _prop([_row(11, 1, 103, co=104), _row(12, 1, 105)], [_set([11], [(6, 108, 30)])])
    lines = [_lk(7, 11, 1), _lk(7, 12, 1)]
    opts = [{"option_id": 70, "group_ids": [11], "sched_subject_id": 6}]
    snap = copy.deepcopy((prop, lines, opts, SUBJECT_IDS))
    out = mock_api.wl_prefill(prop, lines, opts, SUBJECT_IDS)
    assert (prop, lines, opts, SUBJECT_IDS) == snap
    out["rows"][(7, 11)]["teacher_id"] = -1
    out["options"][70][0]["teacher_id"] = -1
    assert (prop, lines, opts, SUBJECT_IDS) == snap


# ── route: ข้อมูลของโปรแกรมจัดตารางชุดเล็ก (แทนตัวแปรกลางระหว่างตัวทดสอบ) ──────────────
# ทะเบียนของ _db(): ท21102=900 ค21102=901 ว21102=902 ก21902=903 ศ21201=904 พ21201=905 (sched_id)
# ห้อง 1-12 = ม.1/1-ม.1/12 ในข้อมูลตั้งต้น · ครูฝั่งตาราง 501-512
SCHED_SUBJECTS = [{"id": 900 + i, "code": c, "name": n, "credits": 1, "is_activity": a, "department_id": d}
                  for i, (c, n, d, a) in enumerate([("ท21102", "ภาษาไทยพื้นฐาน 2", 1, False),
                                                     ("ค21102", "คณิตศาสตร์พื้นฐาน 2", 2, False),
                                                     ("ว21102", "วิทยาศาสตร์พื้นฐาน 2", 3, False),
                                                     ("ก21902", "แนะแนว 2", 10, True),
                                                     ("ศ21201", "ดนตรีสากล", 7, False),
                                                     ("พ21201", "ฟุตบอล", 6, False)])]


def _req(rid, gid, sid, tid, weekly=3, **kw):
    return {"id": rid, "group_id": gid, "subject_id": sid, "teacher_id": tid, "weekly_count": weekly, **kw}


PLAN = [_req(1, 1, 900, 501, room_id=40), _req(2, 2, 900, 502),
        _req(3, 1, 901, 503, co_teacher_id=504), _req(4, 1, 901, 504, co_teacher_id=503),    # สอนร่วมคาบเท่ากัน
        _req(5, 3, 902, 505, 2, co_teacher_id=506), _req(6, 3, 902, 506, 1, co_teacher_id=505),  # คาบไม่เท่ากัน
        _req(7, 7, 900, 507),                                     # ห้องที่ไม่อยู่ในหลักสูตร
        _req(8, 4, 900, 599)]                                     # ครูที่ไม่มีในทะเบียนของเว็บนี้
POOLS = [{"id": 1, "name": "เสรี ม.1/5-7", "group_ids": [5, 6, 7], "weekly": 2, "is_double": True,
          "day": 2, "period": 6,
          "options": [{"subject_id": 904, "teacher_id": 508, "room_id": 30, "code": "ศ21201", "label": "ดนตรี"},
                      {"subject_id": 904, "teacher_id": 509, "code": "ศ21201", "label": "ดนตรี"},
                      {"subject_id": 905, "teacher_id": 510, "code": "พ21201", "label": "ฟุตบอล"}]}]


def _timetable(**over):
    return _patched(REQUIREMENTS=over.get("requirements", PLAN), ELECTIVE_POOLS=over.get("pools", POOLS),
                    SLOTS=[], SUBJECTS=SCHED_SUBJECTS)


def _rdb():
    """ทะเบียน 6 วิชา + ครู 501-510 (wl id ≠ sched id) + หลักสูตรของ _term: ม.1/1-6 × 3 บรรทัด + ชุดเสรี ศ21201"""
    db = _db()
    for t in range(501, 511):
        db.add("wl_teachers", sched_id=t, name=f"ครู {t}", department_id=1)
    return db, _term(db)


def _wl_teacher(db, sched):
    return next(r["id"] for r in db.tables["wl_teachers"] if r["sched_id"] == sched)


def _open(db, year=2569, semester=2):
    with _timetable():
        return _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": year, "semester": semester})


def _rows(db, **where):
    return [r for r in db.tables["wl_rows"] if all(r[k] == v for k, v in where.items())]


def _cur(db):
    return FakeCur(db, None)


def _sql_of(db, fn, *a):
    """เรียก route กับฐานข้อมูลปลอม แล้วคืน SQL ที่มันส่งตามลำดับ (FakeCur เก็บไว้ใน log) — ตัวทดสอบเรื่องล็อก"""
    cur = FakeCur(db, ADMIN)

    @contextlib.contextmanager
    def fake():
        yield cur
    with _patched(_wl_db=fake):
        fn(*a)
    return [q for q, _ in cur.log]


ROUND_KEYS = {"id", "year", "semester", "label", "status", "opened_at", "closed_at", "counts"}


def test_preview_writes_nothing_and_requires_curriculum():
    db, t = _rdb()
    with _timetable():
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_preview, REQ, year="2570", semester="1"))
        assert c == 409 and "หลักสูตร" in d and _thai(d), (c, d)
        before = _state(db)
        p = _call(db, ADMIN, mock_api.wl_rounds_preview, REQ, year="2569", semester="2")
    assert _state(db) == before
    assert set(p) == {"label", "rows", "options", "prefilled_rows", "prefilled_options", "empty_rows",
                      "lines_without_department", "unconverted"}, p
    # 3 บรรทัด × 6 ห้อง · ครูเทอมก่อน: ท ม.1/1 ม.1/2 · ค ม.1/1 · ว ม.1/3 (ม.1/4 ครูไม่มีในทะเบียน)
    assert (p["label"], p["rows"], p["options"], p["prefilled_rows"], p["empty_rows"]) == ("2/2569", 18, 1, 4, 14), p
    assert p["prefilled_options"] == 1 and p["lines_without_department"] == 0
    assert any("599" in u["reason"] for u in p["unconverted"]) and all(_thai(u["reason"]) for u in p["unconverted"])
    # ปี/ภาคผิด → 400
    for kw in ({}, {"year": "2569"}, {"year": "2499", "semester": "1"}, {"year": "2569", "semester": "3"}):
        assert _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_preview, REQ, **kw))[0] == 400, kw


def test_create_round_rows_equal_lines_times_groups():
    db, t = _rdb()
    snaps = {k: copy.deepcopy(getattr(mock_api, k)) for k in GLOBALS}
    rnd = _open(db)
    for k, v in snaps.items():
        assert getattr(mock_api, k) == v, k
    assert set(rnd) == ROUND_KEYS | {"unconverted"}, rnd
    assert (rnd["label"], rnd["status"], rnd["year"], rnd["semester"], rnd["closed_at"]) == (
        "2/2569", "preparing", 2569, 2, None)
    assert rnd["counts"] == {"rows": 18, "sets": 1, "options": 1, "unconverted": len(rnd["unconverted"])}, rnd
    assert isinstance(rnd["opened_at"], str)
    cells = {(r["line_id"], r["group_id"]) for r in _rows(db, round_id=rnd["id"])}
    assert cells == {(ln["id"], g) for ln in t["lines"] for g in range(1, 7)}
    assert len(_rows(db)) == 18
    # ทุกกลุ่มสาระของโรงเรียนมีสถานะ filling
    st = [r for r in db.tables["wl_dept_status"] if r["round_id"] == rnd["id"]]
    assert sorted(r["department_id"] for r in st) == sorted(d["id"] for d in mock_api.DEPARTMENTS)
    assert {r["status"] for r in st} == {"filling"} and len(st) == 11
    # unconverted (ครู 599 ไม่มีในทะเบียน) เก็บในรอบ (jsonb) อ่านคืนได้ทาง GET
    assert any("599" in u["reason"] for u in rnd["unconverted"]), rnd["unconverted"]
    assert rnd["counts"]["unconverted"] >= 1
    got = _call(db, ADMIN, mock_api.wl_round_get, rnd["id"], REQ)
    assert got == rnd and db.tables["wl_rounds"][0]["unconverted"] == rnd["unconverted"]


def test_prefilled_rows_are_unconfirmed_and_from_plan():
    db, t = _rdb()
    rnd = _open(db)
    th, ma, sc = (ln["id"] for ln in t["lines"])
    by = {(r["line_id"], r["group_id"]): r for r in _rows(db, round_id=rnd["id"])}
    w = lambda s: _wl_teacher(db, s)            # noqa: E731
    assert (by[(th, 1)]["teacher_id"], by[(th, 1)]["lab_room_id"]) == (w(501), 40)
    assert by[(th, 2)]["teacher_id"] == w(502)
    assert (by[(ma, 1)]["teacher_id"], by[(ma, 1)]["co_teacher_id"]) == (w(503), w(504))
    assert (by[(sc, 3)]["teacher_id"], by[(sc, 3)]["flag"]) == (w(505), mock_api.WL_CO_UNEQUAL_FLAG)
    filled = {k for k, r in by.items() if r["teacher_id"] is not None}
    assert filled == {(th, 1), (th, 2), (ma, 1), (sc, 3)}, filled
    for k, r in by.items():
        assert r["confirmed"] is False, k                       # "ยังไม่ยืนยัน" หายได้เพราะคนกดเท่านั้น
        assert r["from_plan"] is (k in filled), k
        assert r["note"] == "" and r["is_double"] is False
        if k not in filled:
            assert (r["co_teacher_id"], r["lab_room_id"], r["flag"]) == (None, None, None), k
    # ครูของตัวเลือก: วิชาเดียวกัน ห้องของชุดซ้อนกัน (ม.1/5-6) → ครูทุกคนของตัวเลือกนั้น ไม่มีครู = ไม่มีแถว
    ots = [o for o in db.tables["wl_option_teachers"] if o["round_id"] == rnd["id"]]
    assert sorted((o["option_id"], o["teacher_id"], o["room_id"]) for o in ots) == sorted(
        [(t["option"]["id"], w(508), 30), (t["option"]["id"], w(509), None)])
    assert all(o["confirmed"] is False and o["from_plan"] is True for o in ots)


def test_round_rows_sql_gives_the_contract_row():
    db, t = _rdb()
    rnd = _open(db)
    _call(db, ADMIN, mock_api.wl_curriculum_lines_update, t["lines"][0]["id"], REQ, body={"credits": 1.5})
    cur = _cur(db)
    cur.execute(mock_api._wl_round_rows_sql("r.round_id = %s"), (rnd["id"],))
    rows = [mock_api._wl_round_row_out(v, mock_api._wl_group_names()) for v in cur.fetchall()]
    assert len(rows) == 18
    assert set(rows[0]) == {"id", "round_id", "line_id", "curriculum_id", "curriculum_name", "group_id",
                            "group_name", "subject_id", "code", "name", "credits", "weekly", "kind",
                            "department_id", "teacher_id", "co_teacher_id", "lab_room_id", "is_double", "note",
                            "confirmed", "from_plan", "flag"}, set(rows[0])
    first = next(r for r in rows if r["line_id"] == t["lines"][0]["id"] and r["group_id"] == 1)
    assert first["curriculum_name"] == "ม.1/1-6" and first["group_name"] == "ม.1/1"
    assert (first["code"], first["name"], first["weekly"], first["credits"], first["department_id"]) == (
        "ท21102", "ภาษาไทยพื้นฐาน 2", 3, 1.5, 1)
    assert first["curriculum_id"] == t["curriculum"]["id"] and first["round_id"] == rnd["id"]
    assert first["teacher_id"] == _wl_teacher(db, 501) and first["confirmed"] is False
    # แก้หลักสูตรแล้วแถวเปลี่ยนตาม (ช่องวิชาอ่านจากบรรทัด ไม่ได้ก๊อปไว้ในแถว)
    _call(db, ADMIN, mock_api.wl_curriculum_lines_update, t["lines"][0]["id"], REQ, body={"weekly": 5})
    cur.execute(mock_api._wl_round_rows_sql("r.round_id = %s AND r.group_id = %s"), (rnd["id"], 1))
    got = [mock_api._wl_round_row_out(v, mock_api._wl_group_names()) for v in cur.fetchall()]
    assert [r["weekly"] for r in got if r["line_id"] == t["lines"][0]["id"]] == [5]
    # ห้องที่ไม่มีแล้วในโปรแกรมจัดตาราง
    gone = tuple(99999 if n == "group_id" else rows[0][n] for n, _ in mock_api._WL_ROUND_ROW_SELECT)
    assert mock_api._wl_round_row_out(gone, {})["group_name"] == "ห้องที่ไม่มีแล้ว (รหัส 99999)"


def test_second_open_round_is_409():
    db, t = _rdb()
    _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2570, "semester": 1, "name": "ม.1/1",
                                                        "group_ids": [1]})
    rnd = _open(db)
    before = _state(db)
    with _timetable():
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": 2570, "semester": 1}))
    assert c == 409 and "2/2569" in d and _thai(d), (c, d)
    assert _state(db) == before
    # รอบที่กรอกอยู่ก็นับว่ายังไม่ปิด · ปิดแล้วเปิดรอบใหม่ได้
    _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)
    with _timetable():
        assert _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": 2570, "semester": 1}))[0] == 409
    _call(db, ADMIN, mock_api.wl_rounds_close, rnd["id"], REQ, {"confirm_label": "2/2569"})
    assert _open(db, 2570, 1)["status"] == "preparing"


def test_round_race_on_the_open_index_is_409_not_500():
    # สองคำขอเปิดรอบพร้อมกัน: ด่านในโค้ดผ่านทั้งคู่ — ดัชนี wl_rounds_one_open / UNIQUE ต้องกลายเป็น 409
    db, t = _rdb()
    db.add("wl_rounds", year=2569, semester=2, label="2/2569", status="filling")
    before = _state(db)
    with _timetable(), _patched(_wl_refuse_round_exists=lambda cur, y, s: None):
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": 2569, "semester": 2}))
    assert c == 409 and _thai(d), (c, d)
    assert _state(db) == before


def test_duplicate_year_semester_is_409():
    db, t = _rdb()
    rnd = _open(db)
    _call(db, ADMIN, mock_api.wl_rounds_close, rnd["id"], REQ, {"confirm_label": "2/2569"})
    before = _state(db)
    with _timetable():
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": 2569, "semester": 2}))
    assert c == 409 and "2/2569" in d and _thai(d), (c, d)
    assert _state(db) == before


def test_bad_year_or_semester_is_400():
    db, t = _rdb()
    with _timetable():
        for bad in ({"year": 2499, "semester": 1}, {"year": 2701, "semester": 1}, {"year": 2569, "semester": 3},
                    {"year": 2569, "semester": 0}, {"year": "2569x", "semester": 1}, {"year": True, "semester": 1},
                    {"year": 2569}, {"semester": 1}, {"year": 2569, "semester": 2, "status": "filling"}, [], None):
            c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_create, REQ, bad))
            assert c == 400 and _thai(d), (bad, c, d)
    assert db.count("wl_rounds") == 0 and db.count("wl_rows") == 0


def test_create_requires_curriculum():
    db, t = _rdb()
    with _timetable():
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": 2570, "semester": 1}))
    assert c == 409 and "หลักสูตร" in d, (c, d)
    assert db.count("wl_rounds") == 0


def test_open_refuses_lines_without_department():
    db, t = _rdb()
    rnd = _open(db)
    for ln in t["lines"][:2]:
        _call(db, ADMIN, mock_api.wl_curriculum_lines_update, ln["id"], REQ, body={"department_id": None})
    before = _state(db)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ))
    assert c == 409 and "2" in d and "กลุ่มสาระ" in d, (c, d)
    assert _state(db) == before
    with _timetable():
        assert _call(db, ADMIN, mock_api.wl_rounds_preview, REQ, year="2569", semester="2")[
            "lines_without_department"] == 2
    for ln in t["lines"][:2]:
        _call(db, ADMIN, mock_api.wl_curriculum_lines_update, ln["id"], REQ, body={"department_id": 1})
    got = _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)
    assert got["status"] == "filling" and set(got) == ROUND_KEYS | {"unconverted"}
    # เปิดซ้ำ / รอบที่ไม่มี
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ))[0] == 409
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_open, 9999, REQ))[0] == 404
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_open, 2 ** 70, REQ))[0] == 404


def test_close_requires_typed_label():
    db, t = _rdb()
    rnd = _open(db)
    _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)
    before = _state(db)
    for bad in ({"confirm_label": "1/2569"}, {"confirm_label": ""}, {"confirm_label": "2/2570"}, {},
                {"confirm_label": 2569}, {"confirm_label": "2/2569", "force": True}, None):
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_close, rnd["id"], REQ, bad))
        assert c == 400 and _thai(d), (bad, c, d)
        assert _state(db) == before
    got = _call(db, ADMIN, mock_api.wl_rounds_close, rnd["id"], REQ, {"confirm_label": " 2/2569 "})
    assert got["status"] == "closed" and isinstance(got["closed_at"], str)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_close, rnd["id"], REQ, {"confirm_label": "2/2569"}))
    assert c == 409 and _thai(d)
    # รอบที่ยังเตรียมอยู่ปิดได้ (เปิดผิดภาคเรียน ต้องมีทางออก ไม่งั้นค้างเป็นรอบเดียวที่ยังไม่ปิดตลอดไป)
    _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2570, "semester": 1, "name": "x", "group_ids": [1]})
    r2 = _open(db, 2570, 1)
    assert _call(db, ADMIN, mock_api.wl_rounds_close, r2["id"], REQ, {"confirm_label": "1/2570"})["status"] == "closed"


def test_close_locks_the_round_row_and_curriculum_writes_read_it_for_share():
    # ปิดรอบอ่านแถวรอบ FOR UPDATE · ด่านล็อกของหลักสูตรอ่านแถวรอบของภาคเรียน FOR SHARE โดยไม่กรองสถานะ
    # ฝั่งไหนได้ล็อกก่อน อีกฝั่งรอจน commit แล้วเห็นสถานะล่าสุด — แก้หลักสูตรหลุดเข้ามาหลังปิดรอบไม่ได้
    db, t = _rdb()
    rnd = _open(db)
    seen = _sql_of(db, mock_api.wl_curriculum_lines_update, t["lines"][0]["id"], REQ, None, {"weekly": 2})
    reads = [q for q in seen if "FROM wl_rounds" in q]
    assert re.fullmatch(r"SELECT \w+(, \w+)* FROM wl_rounds WHERE year = %s AND semester = %s FOR SHARE", reads[0]), reads
    seen = _sql_of(db, mock_api.wl_rounds_close, rnd["id"], REQ, {"confirm_label": "2/2569"})
    reads = [q for q in seen if "FROM wl_rounds" in q]
    assert reads and reads[0].endswith("FOR UPDATE") and "WHERE id = %s" in reads[0], reads


def test_create_locks_the_curriculum_tables_before_reading_them():
    # การแก้หลักสูตรล็อกแถวรอบ (FOR SHARE) แต่รอบที่กำลังเปิดยังไม่ commit จึงไม่มีแถวให้ล็อก — การเปิดรอบต้องล็อก
    # ตารางหลักสูตรก่อนอ่าน ไม่อย่างนั้นบรรทัดที่เพิ่มพร้อมกันไม่มีแถว และห้องที่เอาออกพร้อมกันเหลือแถวค้าง
    db, t = _rdb()
    with _timetable():
        seen = _sql_of(db, mock_api.wl_rounds_create, REQ, {"year": 2569, "semester": 2})
    lock = next(i for i, q in enumerate(seen) if q.startswith("LOCK TABLE"))
    for table in ("wl_curricula", "wl_curriculum_groups", "wl_curriculum_lines", "wl_term_sets",
                  "wl_term_set_options"):
        assert table in seen[lock] and seen[lock].endswith("IN SHARE MODE"), seen[lock]
        first_read = next(i for i, q in enumerate(seen) if f"FROM {table} " in q + " ")
        assert lock < first_read, (table, seen[:first_read + 1])


def test_closed_round_locks_its_curriculum():
    db, t = _rdb()
    rnd = _open(db)
    _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)
    _call(db, ADMIN, mock_api.wl_rounds_close, rnd["id"], REQ, {"confirm_label": "2/2569"})
    before = _state(db)
    for fn, args, kw in ((mock_api.wl_curriculum_lines_update, (t["lines"][0]["id"], REQ), {"body": {"weekly": 1}}),
                         (mock_api.wl_curriculum_lines_delete, (t["lines"][0]["id"], REQ), {"force": "1"}),
                         (mock_api.wl_curricula_update, (t["curriculum"]["id"], REQ), {"body": {"note": "x"}}),
                         (mock_api.wl_term_sets_delete, (t["set"]["id"], REQ), {"force": "1"}),
                         (mock_api.wl_curriculum_lines_create, (REQ, {"curriculum_id": t["curriculum"]["id"],
                                                                      "code": "ก21902", "weekly": 1}), {})):
        c, d = _code(lambda: _call(db, ADMIN, fn, *args, **kw))
        assert c == 409 and "ปิด" in d, (fn.__name__, c, d)
        assert _state(db) == before, fn.__name__
    view = _call(db, HEAD, mock_api.wl_curricula_get, REQ, year="2569", semester="2")
    assert view["locked"] is True


def test_head_sees_only_filling_and_closed_rounds():
    db, t = _rdb()
    _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2570, "semester": 1, "name": "x", "group_ids": [1]})
    old = _open(db)
    assert _call(db, HEAD, mock_api.wl_rounds_list, REQ) == []
    _call(db, ADMIN, mock_api.wl_rounds_open, old["id"], REQ)
    got = _call(db, HEAD, mock_api.wl_rounds_list, REQ)
    assert [r["label"] for r in got] == ["2/2569"] and set(got[0]) == ROUND_KEYS, got
    assert "unconverted" not in got[0]
    _call(db, ADMIN, mock_api.wl_rounds_close, old["id"], REQ, {"confirm_label": "2/2569"})
    new = _open(db, 2570, 1)
    assert [(r["label"], r["status"]) for r in _call(db, HEAD, mock_api.wl_rounds_list, REQ)] == [("2/2569", "closed")]
    admin = _call(db, ADMIN, mock_api.wl_rounds_list, REQ)
    assert [(r["label"], r["status"]) for r in admin] == [("1/2570", "preparing"), ("2/2569", "closed")]
    assert admin[1]["counts"] == {"rows": 18, "sets": 1, "options": 1, "unconverted": len(old["unconverted"])}
    assert admin[0]["counts"]["rows"] == 0 and admin[0]["id"] == new["id"]
    assert _code(lambda: _call(db, None, mock_api.wl_rounds_list, NOREQ))[0] == 401


def test_head_cannot_preview_create_open_close():
    db, t = _rdb()
    rnd = _open(db)
    before = _state(db)
    with _timetable():
        for fn, args, kw in ((mock_api.wl_rounds_preview, (REQ,), {"year": "2569", "semester": "2"}),
                             (mock_api.wl_rounds_create, (REQ, {"year": 2570, "semester": 1}), {}),
                             (mock_api.wl_round_get, (rnd["id"], REQ), {}),
                             (mock_api.wl_rounds_open, (rnd["id"], REQ), {}),
                             (mock_api.wl_rounds_close, (rnd["id"], REQ, {"confirm_label": "2/2569"}), {})):
            c, d = _code(lambda: _call(db, HEAD, fn, *args, **kw))
            assert c == 403 and _thai(d), (fn.__name__, c, d)
            anon = tuple(NOREQ if a is REQ else a for a in args)
            assert _code(lambda: _call(db, None, fn, *anon, **kw))[0] == 401, fn.__name__
            assert _state(db) == before, fn.__name__


def test_write_blocked_is_503():
    db, t = _rdb()
    with _timetable(), _patched(_db_write_blocked=lambda: True):
        for fn, args, kw in ((mock_api.wl_rounds_preview, (REQ,), {"year": "2569", "semester": "2"}),
                             (mock_api.wl_rounds_create, (REQ, {"year": 2569, "semester": 2}), {})):
            c, d = _code(lambda: _call(db, ADMIN, fn, *args, **kw))
            assert c == 503 and _thai(d), (fn.__name__, c, d)
    assert db.count("wl_rounds") == 0
    # route อื่นของรอบไม่อ่านแผนของโรงเรียน จึงไม่ติดด่านนี้
    rnd = _open(db)
    with _patched(_db_write_blocked=lambda: True):
        _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)
        assert len(_call(db, ADMIN, mock_api.wl_rounds_list, REQ)) == 1


def test_round_get_is_404_for_a_missing_round():
    db, t = _rdb()
    for rid in (1, 9999, 0, -1, 2 ** 70):
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_round_get, rid, REQ))
        assert c == 404 and _thai(d), (rid, c, d)


# ── sync: แถวของรอบตามหลักสูตร ───────────────────────────────────────────────
def _with_teachers(db, rnd, line_id, groups):
    w = _wl_teacher(db, 510)
    for r in _rows(db, round_id=rnd["id"], line_id=line_id):
        if r["group_id"] in groups:
            r["teacher_id"], r["confirmed"] = w, True
        else:
            r["teacher_id"] = r["co_teacher_id"] = None


def test_new_line_adds_rows_without_teacher():
    db, t = _rdb()
    rnd = _open(db)
    ln = _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
               {"curriculum_id": t["curriculum"]["id"], "code": "ก21902", "weekly": 1})
    new = _rows(db, round_id=rnd["id"], line_id=ln["id"])
    assert sorted(r["group_id"] for r in new) == [1, 2, 3, 4, 5, 6]
    assert all(r["teacher_id"] is None and r["co_teacher_id"] is None and not r["confirmed"] and not r["from_plan"]
               for r in new)
    # เพิ่มห้องให้หลักสูตร → ทุกบรรทัดได้แถวของห้องนั้น
    _call(db, ADMIN, mock_api.wl_curricula_update, t["curriculum"]["id"], REQ, body={"group_ids": [1, 2, 3, 4, 5, 6, 8]})
    assert len(_rows(db, round_id=rnd["id"], group_id=8)) == 4 and len(_rows(db)) == 28
    # หลักสูตรใหม่ทั้งชุด (ห้องใหม่) ระหว่างรอบเปิด
    c2 = _call(db, ADMIN, mock_api.wl_curricula_create, REQ,
               {"year": 2569, "semester": 2, "name": "ม.1/9", "group_ids": [9]})
    l2 = _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
               {"curriculum_id": c2["id"], "code": "ท21102", "weekly": 3})
    assert [(r["line_id"], r["group_id"]) for r in _rows(db, group_id=9)] == [(l2["id"], 9)]
    # ภาคเรียนอื่นไม่เกี่ยว
    _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2570, "semester": 1, "name": "y", "group_ids": [1]})
    assert len(_rows(db)) == 29


def test_removing_line_with_teacher_is_409_and_writes_nothing():
    db, t = _rdb()
    rnd = _open(db)
    lid = t["lines"][2]["id"]
    _with_teachers(db, rnd, lid, {2, 5})
    before = _state(db)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, lid, REQ))
    assert c == 409 and re.search(r"\b2 แถว", d) and _thai(d), (c, d)
    assert _state(db) == before                                      # บรรทัดยังอยู่ ไม่มีบันทึกใหม่
    assert any(ln["id"] == lid for ln in db.tables["wl_curriculum_lines"])
    # เอาห้องที่มีครูออกจากหลักสูตร ก็ 409 เหมือนกัน (บอกจำนวนแถว)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_update, t["curriculum"]["id"], REQ,
                               body={"group_ids": [1, 2, 3, 4]}))
    assert c == 409 and re.search(r"\b1 แถว", d), (c, d)
    assert _state(db) == before


def test_removing_with_force_deletes_rows():
    db, t = _rdb()
    rnd = _open(db)
    lid = t["lines"][2]["id"]
    _with_teachers(db, rnd, lid, {2, 5})
    _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, lid, REQ, force="1")
    assert not any(ln["id"] == lid for ln in db.tables["wl_curriculum_lines"])
    assert _rows(db, line_id=lid) == [] and len(_rows(db, round_id=rnd["id"])) == 12
    # บันทึกบอกว่าลบครูที่ใส่ไว้กี่แถว — ตรวจย้อนได้ว่าครูหายไปเพราะใคร เมื่อไหร่
    last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert last["detail"].startswith("ลบ ว21102 วิทยาศาสตร์พื้นฐาน 2 (2 คาบ) ออกจากหลักสูตร ม.1/1-6"), last
    assert "(ลบครูที่ใส่ไว้ 2 แถว ในรอบ 2/2569)" in last["detail"], last["detail"]
    # ไม่มีครูในแถวที่จะหาย → ลบได้โดยไม่ต้อง force และบันทึกไม่มีส่วนต่อท้าย
    for r in _rows(db, round_id=rnd["id"], line_id=t["lines"][1]["id"]):
        r["teacher_id"] = r["co_teacher_id"] = None
    _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, t["lines"][1]["id"], REQ)
    last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert "ลบครู" not in last["detail"] and len(_rows(db)) == 6, last


def test_removing_group_from_curriculum_removes_its_rows():
    db, t = _rdb()
    rnd = _open(db)
    for r in _rows(db, round_id=rnd["id"]):
        r["teacher_id"] = r["co_teacher_id"] = None
    _call(db, ADMIN, mock_api.wl_curricula_update, t["curriculum"]["id"], REQ, body={"group_ids": [1, 2, 3, 4]})
    assert sorted({r["group_id"] for r in _rows(db, round_id=rnd["id"])}) == [1, 2, 3, 4]
    assert len(_rows(db)) == 12
    # ห้องที่มีครู (ม.1/1 ของบรรทัดแรก) → 409 แล้ว force ลบ
    _with_teachers(db, rnd, t["lines"][0]["id"], {1})
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_update, t["curriculum"]["id"], REQ,
                               body={"group_ids": [2, 3, 4]}))
    assert c == 409
    _call(db, ADMIN, mock_api.wl_curricula_update, t["curriculum"]["id"], REQ, body={"group_ids": [2, 3, 4],
                                                                                    "force": True})
    assert sorted({r["group_id"] for r in _rows(db)}) == [2, 3, 4]
    last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert "เอาห้อง ม.1/1 ออก" in last["detail"] and "ลบครูที่ใส่ไว้ 1 แถว" in last["detail"], last["detail"]


def test_removing_option_or_set_with_teachers_is_409_then_force_deletes_them():
    db, t = _rdb()
    rnd = _open(db)
    ots = [o for o in db.tables["wl_option_teachers"] if o["round_id"] == rnd["id"]]
    assert len(ots) == 2 and all(o["from_plan"] and not o["confirmed"] for o in ots)
    # หัวหน้ายืนยันครูเทอมก่อนไว้หนึ่งคน + เพิ่มครูเองอีกหนึ่งคน (ไม่ได้มาจากแผนเดิม) = งานของคน 2 คน
    ots[0]["confirmed"] = True
    db.add("wl_option_teachers", round_id=rnd["id"], option_id=t["option"]["id"], teacher_id=_wl_teacher(db, 510))
    before = _state(db)
    for fn, rid in ((mock_api.wl_term_set_options_delete, t["option"]["id"]),
                    (mock_api.wl_term_sets_delete, t["set"]["id"])):           # ลบชุด = ตัวเลือกหายตาม (CASCADE)
        c, d = _code(lambda: _call(db, ADMIN, fn, rid, REQ))
        assert c == 409 and "ครูของตัวเลือก 2 คน" in d, (fn.__name__, c, d)
        assert _state(db) == before
    _call(db, ADMIN, mock_api.wl_term_sets_delete, t["set"]["id"], REQ, body={"force": True})
    assert db.count("wl_option_teachers") == 0 and db.count("wl_term_set_options") == 0
    last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert "(ลบครูของตัวเลือก 2 คน ในรอบ 2/2569)" in last["detail"], last["detail"]


def test_prefilled_unconfirmed_option_teachers_are_removed_without_force():
    db, t = _rdb()
    rnd = _open(db)
    assert db.count("wl_option_teachers", round_id=rnd["id"]) == 2                  # ครูเทอมก่อน ยังไม่ยืนยัน
    _call(db, ADMIN, mock_api.wl_term_set_options_delete, t["option"]["id"], REQ)
    assert db.count("wl_option_teachers") == 0
    last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert "ลบครู" not in last["detail"], last["detail"]


def test_deleting_a_whole_curriculum_needs_force_only_for_rows_a_person_entered():
    db, t = _rdb()
    rnd = _open(db)
    th = t["lines"][0]["id"]
    r1 = next(r for r in _rows(db, round_id=rnd["id"], line_id=th) if r["group_id"] == 1)
    r1["confirmed"] = True                                       # หัวหน้ายืนยันครูเทอมก่อนไว้หนึ่งแถว
    before = _state(db)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_delete, t["curriculum"]["id"], REQ))
    assert c == 409 and re.search(r"\b1 แถว", d), (c, d)          # ครูเทอมก่อนอีก 3 แถวที่ยังไม่ยืนยัน ไม่นับ
    assert _state(db) == before
    # ของปลอมย้อนกลับด้วยสำเนาลึก จึงหยิบแถวใหม่ · เหลือแต่ข้อเสนอของเครื่อง → ลบได้โดยไม่ต้อง force
    next(r for r in _rows(db, round_id=rnd["id"], line_id=th) if r["group_id"] == 1)["confirmed"] = False
    _call(db, ADMIN, mock_api.wl_curricula_delete, t["curriculum"]["id"], REQ)
    assert db.count("wl_rows") == 0 and db.count("wl_curricula") == 0
    # ตั้งต้นใหม่ทั้งภาคเรียนระหว่างรอบเปิด → แถวของรอบกลับมาตามหลักสูตรใหม่ (ไม่มีครู — ครูเทอมก่อนใส่ตอนเปิดรอบเท่านั้น)
    _call(db, ADMIN, mock_api.wl_term_sets_delete, t["set"]["id"], REQ, force="1")
    with _timetable():
        _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, {"year": 2569, "semester": 2, "source": "timetable"})
    rows = _rows(db, round_id=rnd["id"])
    assert rows and all(r["teacher_id"] is None and not r["from_plan"] for r in rows)
    assert {r["group_id"] for r in rows} == {1, 2, 3, 4, 7}


def test_sync_without_an_open_round_writes_no_rows():
    db, t = _rdb()
    _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, t["lines"][0]["id"], REQ)
    assert db.count("wl_rows") == 0
    cur = _cur(db)
    res = mock_api._wl_sync_round(cur, 2569, 2, False)
    assert res["round_id"] is None and res["rows_added"] == 0
    # รอบที่ปิดแล้ว: ไม่ตามอีก (หลักสูตรล็อก Task 2 ปฏิเสธก่อนถึงนี่อยู่แล้ว)
    rnd = _open(db)
    db.tables["wl_rounds"][0]["status"] = "closed"
    db.tables["wl_rows"] = [r for r in db.tables["wl_rows"] if r["group_id"] != 1]
    res = mock_api._wl_sync_round(cur, 2569, 2, False)
    assert res["rows_added"] == 0 and len(_rows(db, round_id=rnd["id"])) == 10


def test_sync_returns_what_it_did():
    db, t = _rdb()
    rnd = _open(db)
    cur = _cur(db)
    assert mock_api._wl_sync_round(cur, 2569, 2, False) == {
        "round_id": rnd["id"], "label": "2/2569", "rows_added": 0, "rows_removed": 0, "rows_removed_entered": 0,
        "option_teachers_removed": 0, "option_teachers_removed_entered": 0}
    db.tables["wl_rows"] = [r for r in db.tables["wl_rows"] if r["group_id"] != 6]
    db.add("wl_rows", round_id=rnd["id"], line_id=t["lines"][0]["id"], group_id=12, teacher_id=None)
    # ครูเทอมก่อนที่ยังไม่ยืนยัน = ข้อเสนอของเครื่อง ไม่ใช่งานของคน
    db.add("wl_rows", round_id=rnd["id"], line_id=t["lines"][1]["id"], group_id=12,
           teacher_id=_wl_teacher(db, 510), from_plan=True)
    got = mock_api._wl_sync_round(cur, 2569, 2, False)
    assert (got["rows_added"], got["rows_removed"], got["rows_removed_entered"]) == (3, 2, 0), got
    # ใส่ครูเอง (ไม่ได้มาจากแผนเดิม) — ครูสอนร่วมอย่างเดียวก็นับ · ยืนยันแล้วนับแม้ไม่มีครู
    db.add("wl_rows", round_id=rnd["id"], line_id=t["lines"][0]["id"], group_id=12,
           co_teacher_id=_wl_teacher(db, 510))
    db.add("wl_rows", round_id=rnd["id"], line_id=t["lines"][1]["id"], group_id=12, from_plan=True, confirmed=True)
    db.add("wl_rows", round_id=rnd["id"], line_id=t["lines"][2]["id"], group_id=12, from_plan=False)  # ว่างเปล่า
    c, d = _code(lambda: mock_api._wl_sync_round(cur, 2569, 2, False))
    assert c == 409 and re.search(r"\b2 แถว", d), (c, d)
    got = mock_api._wl_sync_round(cur, 2569, 2, True)
    assert (got["rows_removed"], got["rows_removed_entered"]) == (3, 2), got


def test_entered_means_confirmed_or_a_teacher_not_from_the_plan():
    e = mock_api._wl_entered
    assert e(True, True, 5) and e(True, False) and e(True, True, None, None)       # ยืนยันแล้ว
    assert e(False, False, 5) and e(False, False, None, 7)                         # ใส่ครูเอง
    assert not e(False, True, 5, 7)                                                # ครูเทอมก่อน ยังไม่ยืนยัน
    assert not e(False, False, None, None)                                         # แถวว่าง


# ── ข้อมูลตั้งต้นทั้งเส้น ─────────────────────────────────────────────────────
def test_seed_data_end_to_end_every_row_has_last_term_teacher_unconfirmed():
    db = FakeDb()
    snaps = {k: copy.deepcopy(getattr(mock_api, k)) for k in GLOBALS}
    _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, {"year": 2569, "semester": 2, "source": "timetable"})
    before = _state(db)
    p = _call(db, ADMIN, mock_api.wl_rounds_preview, REQ, year="2569", semester="2")
    assert _state(db) == before
    assert (p["rows"], p["prefilled_rows"], p["empty_rows"], p["lines_without_department"]) == (1220, 1220, 0, 0), p
    assert p["options"] == 44 and p["prefilled_options"] == 44 and p["unconverted"] == [], p
    rnd = _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": 2569, "semester": 2})
    assert rnd["counts"] == {"rows": 1220, "sets": 13, "options": 44, "unconverted": 0}, rnd["counts"]
    rows = db.tables["wl_rows"]
    assert len(rows) == 1220 and all(r["teacher_id"] is not None for r in rows)
    assert all(r["confirmed"] is False and r["from_plan"] is True for r in rows)
    assert db.count("wl_dept_status", round_id=rnd["id"]) == 11
    # ครูในแถวตรงกับแผนการสอน: (ห้อง, วิชาฝั่งตาราง) → ครูฝั่งตาราง ผ่านทะเบียน (sched_id) ไม่ใช่ชื่อ
    t_sched = {r["id"]: r["sched_id"] for r in db.tables["wl_teachers"]}
    s_sched = {r["id"]: r["sched_id"] for r in db.tables["wl_subjects"]}
    line = {r["id"]: r for r in db.tables["wl_curriculum_lines"]}
    got = collections.Counter((r["group_id"], s_sched[line[r["line_id"]]["subject_id"]], t_sched[r["teacher_id"]])
                              for r in rows)
    want = collections.Counter((q["group_id"], q["subject_id"], q["teacher_id"]) for q in mock_api.REQUIREMENTS)
    assert got == want
    ots = db.tables["wl_option_teachers"]
    assert ots and all(o["confirmed"] is False and o["from_plan"] is True and o["teacher_id"] for o in ots)
    pool_pairs = {(o["subject_id"], o["teacher_id"]) for p_ in mock_api.ELECTIVE_POOLS for o in p_["options"]}
    opt_subject = {o["id"]: s_sched[o["subject_id"]] for o in db.tables["wl_term_set_options"]}
    assert {(opt_subject[o["option_id"]], t_sched[o["teacher_id"]]) for o in ots} == pool_pairs
    for k, v in snaps.items():
        assert getattr(mock_api, k) == v, k
    # เปิดให้กรอกได้เลย (ทุกบรรทัดมีกลุ่มสาระ)
    assert _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)["status"] == "filling"


def test_seed_data_prefilled_rows_are_removed_without_force_but_entered_ones_need_it():
    db = FakeDb()
    _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, {"year": 2569, "semester": 2, "source": "timetable"})
    rnd = _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": 2569, "semester": 2})
    groups = collections.Counter(g["curriculum_id"] for g in db.tables["wl_curriculum_groups"])
    a, b = [ln["id"] for ln in db.tables["wl_curriculum_lines"] if groups[ln["curriculum_id"]] >= 2][:2]
    na, nb = len(_rows(db, line_id=a)), len(_rows(db, line_id=b))
    # บรรทัดที่ทุกแถวเป็นครูเทอมก่อนที่ยังไม่ยืนยัน → ลบได้เลย ไม่ต้อง force และบันทึกไม่มีส่วนต่อท้าย
    assert all(r["from_plan"] and not r["confirmed"] and r["teacher_id"] for r in _rows(db, line_id=a))
    _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, a, REQ)
    assert _rows(db, line_id=a) == []
    assert "ลบครู" not in max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])["detail"]
    # ยืนยันหนึ่งแถว → 409 นับ 1 · force → ลบ
    _rows(db, line_id=b)[0]["confirmed"] = True
    before = _state(db)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, b, REQ))
    assert c == 409 and re.search(r"\b1 แถว", d), (c, d)
    assert _state(db) == before
    _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, b, REQ, force="1")
    assert _rows(db, line_id=b) == []
    assert "(ลบครูที่ใส่ไว้ 1 แถว ในรอบ 2/2569)" in max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])["detail"]
    # แถวที่ไม่ได้มาจากแผนเดิม (บรรทัดใหม่) แล้วมีคนใส่ครู → 409 นับ 1 · force → ลบ
    cid = next(c for c, n in groups.items() if n >= 2)
    ln = _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ, {"curriculum_id": cid, "code": "Z1", "name": "ใหม่",
                                                                    "weekly": 1, "department_id": 1})
    new = _rows(db, line_id=ln["id"])
    assert len(new) >= 2 and not any(r["from_plan"] for r in new)
    new[0]["teacher_id"] = db.tables["wl_teachers"][0]["id"]
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, ln["id"], REQ))
    assert c == 409 and re.search(r"\b1 แถว", d), (c, d)
    _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, ln["id"], REQ, body={"force": True})
    assert _rows(db, line_id=ln["id"]) == [] and len(_rows(db, round_id=rnd["id"])) == 1220 - na - nb


def test_open_refuses_options_without_department():
    db, t = _rdb()
    rnd = _open(db)
    o = _call(db, ADMIN, mock_api.wl_term_set_options_create, REQ,
              {"set_id": t["set"]["id"], "code": "X9", "name": "วิชาพิมพ์เอง"})
    assert o["department_id"] is None
    before = _state(db)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ))
    assert c == 409 and "1 ตัวเลือก" in d and "กลุ่มสาระ" in d and "บรรทัด" not in d, (c, d)
    assert _state(db) == before
    # บรรทัดและตัวเลือกพร้อมกัน → บอกทั้งสองจำนวน
    _call(db, ADMIN, mock_api.wl_curriculum_lines_update, t["lines"][0]["id"], REQ, body={"department_id": None})
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ))
    assert c == 409 and "1 บรรทัด" in d and "1 ตัวเลือก" in d, (c, d)
    _call(db, ADMIN, mock_api.wl_curriculum_lines_update, t["lines"][0]["id"], REQ, body={"department_id": 1})
    _call(db, ADMIN, mock_api.wl_term_set_options_delete, o["id"], REQ)
    assert _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)["status"] == "filling"


def test_option_edit_keeps_its_teachers_and_unblocks_open():
    # ทางเดียวที่ระบุกลุ่มสาระให้ตัวเลือกได้โดยไม่ต้องลบแล้วเพิ่มใหม่ (ซึ่งจะทำให้ครูของตัวเลือกหาย) — การแก้ต้องไม่ลบครู
    db, t = _rdb()
    rnd = _open(db)
    o = _call(db, ADMIN, mock_api.wl_term_set_options_create, REQ,
              {"set_id": t["set"]["id"], "code": "X9", "name": "วิชาพิมพ์เอง"})
    mine = db.add("wl_option_teachers", round_id=rnd["id"], option_id=o["id"], teacher_id=_wl_teacher(db, 510),
                  confirmed=True)
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ))[0] == 409
    _call(db, ADMIN, mock_api.wl_term_set_options_update, o["id"], REQ, {"department_id": 7})
    kept = [x for x in db.tables["wl_option_teachers"] if x["option_id"] == o["id"]]
    assert kept == [mine], kept
    # แก้รหัสของตัวเลือกที่มีครูเทอมก่อน (ผูกวิชาใหม่) ครูก็ยังอยู่ครบ
    n = db.count("wl_option_teachers", option_id=t["option"]["id"])
    _call(db, ADMIN, mock_api.wl_term_set_options_update, t["option"]["id"], REQ, {"code": "พ21201"})
    assert n == 2 and db.count("wl_option_teachers", option_id=t["option"]["id"]) == 2
    assert _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)["status"] == "filling"


# ── ตาราง route ─────────────────────────────────────────────────────────────
def test_round_routes_are_registered_and_preview_comes_before_round_id():
    routes = [(v, p) for v, p, _ in mock_api.app.routes]
    for want in (("get", "/api/workload/rounds"), ("get", "/api/workload/rounds/preview"),
                 ("post", "/api/workload/rounds"), ("get", "/api/workload/rounds/{round_id}"),
                 ("post", "/api/workload/rounds/{round_id}/open"), ("post", "/api/workload/rounds/{round_id}/close")):
        assert want in routes, want
    # ประกาศ /rounds/preview ก่อน /rounds/{round_id} ไม่งั้นคำว่า preview ถูกอ่านเป็นรหัสรอบ
    assert routes.index(("get", "/api/workload/rounds/preview")) < routes.index(("get", "/api/workload/rounds/{round_id}"))
    assert not any(v == "delete" and "/rounds" in p for v, p in routes)


if __name__ == "__main__":
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
