"""
เว็บลงอัตรากำลัง ขั้นที่ 2 งานที่ 4 (ส่วนแรก): หัวหน้ากลุ่มสาระใส่ครูตามสิทธิ์

wl_can_edit / wl_apply_teacher_change เป็นฟังก์ชันล้วน เรียกตรง ๆ · route คุยกับฐานข้อมูลปลอมชุดเดียวกับ wlcurriculum.py
(อ่านโครงตารางจาก _WL_SCHEMA ตรวจ UNIQUE/NOT NULL และ FK ตอนจบธุรกรรม) · ข้อมูลตั้งต้นของรอบมาจาก wlopen.py:
หลักสูตร ม.1/1-6 สามบรรทัด (ท21102 กลุ่ม 1 · ค21102 กลุ่ม 2 · ว21102 กลุ่ม 3) + ชุดคาบเสรีหนึ่งตัวเลือก (ศ21201 กลุ่ม 7)
ครูเทอมก่อนจากแผนชุดเล็กของ wlopen.py — ทุกการเขียนต้องบังคับสิทธิ์ที่เซิร์ฟเวอร์ ไม่ใช่แค่ซ่อนบนหน้าจอ
"""
import contextlib
import copy
import re
import sys

import mock_api
from wlcurriculum import ADMIN, NOREQ, REQ, FakeCur, _call, _code, _sess, _state, _term, _thai
from wlopen import _open, _rdb, _wl_teacher

fails: list[str] = []

HEAD1 = _sess("head", 1, "หัวหน้ากลุ่มสาระภาษาไทย")
HEAD2 = _sess("head", 2, "หัวหน้ากลุ่มสาระคณิตศาสตร์")
HEAD7 = _sess("head", 7, "หัวหน้ากลุ่มสาระศิลปะ")
ROW_KEYS = {"id", "round_id", "line_id", "curriculum_id", "curriculum_name", "group_id", "group_name", "subject_id",
            "code", "name", "credits", "weekly", "kind", "department_id", "teacher_id", "co_teacher_id", "lab_room_id",
            "is_double", "note", "confirmed", "from_plan", "flag"}
OT_KEYS = {"id", "round_id", "option_id", "set_id", "teacher_id", "room_id", "note", "confirmed", "from_plan"}


def _filling():
    """รอบ 2/2569 ที่เปิดให้กรอกแล้ว: แถว 18 แถว (3 บรรทัด × 6 ห้อง) · ครูของตัวเลือก ศ21201 สองคน (508 509)"""
    db, t = _rdb()
    rnd = _open(db)
    _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)
    return db, t, rnd


def _row(db, t, line, gid):
    """แถวของ (บรรทัดที่ line ของหลักสูตร, ห้อง gid) · line 0 = ท21102 (กลุ่ม 1) 1 = ค21102 (กลุ่ม 2) 2 = ว21102 (กลุ่ม 3)"""
    lid = t["lines"][line]["id"]
    return next(r for r in db.tables["wl_rows"] if r["line_id"] == lid and r["group_id"] == gid)


def _ots(db):
    return db.tables["wl_option_teachers"]


def _put(db, sess, row_id, body):
    return _call(db, sess, mock_api.wl_rows_update, row_id, REQ, body)


def _bulk(db, sess, body):
    return _call(db, sess, mock_api.wl_rows_bulk, REQ, body)


def _get(db, sess, rid, dept=None):
    return _call(db, sess, mock_api.wl_round_rows, rid, REQ, department_id=dept)


def _sql_as(db, sess, fn, *a):
    """เรียก route แล้วคืน SQL ที่ส่งตามลำดับ — ตัวทดสอบเรื่องล็อก"""
    cur = FakeCur(db, sess)

    @contextlib.contextmanager
    def fake():
        yield cur
    saved = mock_api._wl_db
    mock_api._wl_db = fake
    try:
        fn(*a)
    finally:
        mock_api._wl_db = saved
    return [q for q, _ in cur.log]


# ── ฟังก์ชันล้วน ───────────────────────────────────────────────────────────
def test_can_edit_table():
    ce = mock_api.wl_can_edit
    admin = {"role": "admin", "department_id": None}
    head = {"role": "head", "department_id": 2}
    for ds in (None, "filling", "submitted", "returned", "approved"):
        for d in (None, 1, 2):
            # admin: เตรียม/เปิดให้กรอก แก้ได้ทุกกลุ่มทุกสถานะ · ปิดแล้วห้ามทุกคน
            assert ce(admin, "preparing", ds, d) is None, (ds, d)
            assert ce(admin, "filling", ds, d) is None, (ds, d)
            assert _thai(ce(admin, "closed", ds, d)), (ds, d)
            assert _thai(ce(head, "closed", ds, d)), (ds, d)
            # หัวหน้า: รอบที่ยังเตรียมอยู่ยังไม่ใช่ของหัวหน้า
            assert _thai(ce(head, "preparing", ds, d)), (ds, d)
    assert ce(head, "filling", "filling", 2) is None
    assert ce(head, "filling", "returned", 2) is None
    for ds in ("submitted", "approved", None):
        assert _thai(ce(head, "filling", ds, 2)), ds
    for d in (1, None):                                   # กลุ่มอื่น หรือบรรทัดที่ไม่มีกลุ่ม
        assert _thai(ce(head, "filling", "filling", d)), d
    assert _thai(ce({"role": "other", "department_id": 2}, "filling", "filling", 2))
    assert _thai(ce(admin, "weird", "filling", 2)) and _thai(ce(head, "weird", "filling", 2))
    # ข้อความบอกเหตุผล: ส่งแล้ว / ตรวจผ่านแล้ว / ปิดแล้ว / กลุ่มอื่น
    assert "ส่งแล้ว" in ce(head, "filling", "submitted", 2)
    assert "ตรวจผ่าน" in ce(head, "filling", "approved", 2)
    assert "ปิด" in ce(head, "closed", "filling", 2)
    assert "กลุ่ม" in ce(head, "filling", "filling", 1)


def test_apply_teacher_change():
    ap = mock_api.wl_apply_teacher_change
    assert ap({"teacher_id": 5}) == {"teacher_id": 5, "confirmed": True}
    assert ap({"teacher_id": 5, "note": "x"}) == {"teacher_id": 5, "note": "x", "confirmed": True}
    assert ap({"teacher_id": 5, "confirmed": False}) == {"teacher_id": 5, "confirmed": False}
    assert ap({"note": "x"}) == {"note": "x"}
    assert ap({"co_teacher_id": 5}) == {"co_teacher_id": 5}
    assert ap({"confirmed": True}) == {"confirmed": True}
    f = {"teacher_id": 5}
    out = ap(f)
    assert f == {"teacher_id": 5} and out is not f        # ไม่แก้ dict ที่รับมา


# ── route: เขียนแถว ────────────────────────────────────────────────────────
def test_teacher_change_confirms_row():
    db, t, rnd = _filling()
    r3 = _row(db, t, 0, 3)
    assert r3["teacher_id"] is None and r3["confirmed"] is False
    new = _wl_teacher(db, 506)
    out = _put(db, HEAD1, r3["id"], {"teacher_id": new})
    assert set(out) == ROW_KEYS, set(out) ^ ROW_KEYS
    assert (out["teacher_id"], out["confirmed"], out["from_plan"]) == (new, True, False), out
    assert out["code"] == "ท21102" and out["group_name"] == "ม.1/3" and out["department_id"] == 1
    assert (r3["teacher_id"], r3["confirmed"], r3["from_plan"]) == (new, True, False)
    # แถวที่มีครูเทอมก่อน: เลือกครูคนเดิมเอง = คนเลือก → ยืนยัน
    r1 = _row(db, t, 0, 1)
    assert r1["from_plan"] and not r1["confirmed"]
    _put(db, HEAD1, r1["id"], {"teacher_id": r1["teacher_id"]})
    assert r1["confirmed"] is True and r1["from_plan"] is False
    # เปลี่ยนครูพร้อมบอกว่ายังไม่ยืนยันเอง → ไม่ยืนยัน
    r4 = _row(db, t, 0, 4)
    _put(db, HEAD1, r4["id"], {"teacher_id": new, "confirmed": False})
    assert r4["teacher_id"] == new and r4["confirmed"] is False


def test_clearing_teacher_unconfirms_row():
    # คำตัดสินของผู้คุม (D1): ล้างครูไม่ใช่การเลือกครู → กลับเป็น "ยังไม่ยืนยัน" ไม่ใช่ "ยืนยันแล้วแต่ไม่มีครู"
    ap = mock_api.wl_apply_teacher_change
    assert ap({"teacher_id": None}) == {"teacher_id": None, "confirmed": False}
    assert ap({"teacher_id": None, "note": "x"}) == {"teacher_id": None, "note": "x", "confirmed": False}
    assert ap({"teacher_id": None, "confirmed": True}) == {"teacher_id": None, "confirmed": True}   # ส่งเองใช้ค่าที่ส่ง
    assert ap({"co_teacher_id": None}) == {"co_teacher_id": None}                                   # ครูสอนร่วมไม่แตะ
    db, t, rnd = _filling()
    g1, g2, g3 = (_row(db, t, 0, g)["id"] for g in (1, 2, 3))
    _bulk(db, HEAD1, {"ids": [g1, g2, g3], "set": {"confirmed": True}})
    # PUT ล้างครู → ยังไม่ยืนยัน
    out = _put(db, HEAD1, g1, {"teacher_id": None})
    assert (out["teacher_id"], out["confirmed"], out["from_plan"]) == (None, False, False), out
    # ส่ง confirmed มาเองพร้อมล้างครู → ใช้ค่าที่ส่ง
    assert _put(db, HEAD1, g2, {"teacher_id": None, "confirmed": True})["confirmed"] is True
    # ล้างครูสอนร่วมไม่แตะการยืนยัน
    _put(db, HEAD1, g3, {"co_teacher_id": _wl_teacher(db, 507)})
    assert _put(db, HEAD1, g3, {"co_teacher_id": None})["confirmed"] is True
    # bulk ล้างครู → ทุกแถวยังไม่ยืนยัน
    _bulk(db, HEAD1, {"ids": [g1, g2, g3], "set": {"teacher_id": _wl_teacher(db, 506)}})
    out = _bulk(db, HEAD1, {"ids": [g1, g2, g3], "set": {"teacher_id": None}})
    assert [(r["teacher_id"], r["confirmed"]) for r in out["rows"]] == [(None, False)] * 3, out["rows"]
    assert all(_row(db, t, 0, g)["confirmed"] is False for g in (1, 2, 3))
    out = _bulk(db, HEAD1, {"ids": [g1], "set": {"teacher_id": None, "confirmed": True}})
    assert out["rows"][0]["confirmed"] is True


def test_confirm_only_by_explicit_true():
    db, t, rnd = _filling()
    r1 = _row(db, t, 0, 1)                                # ครูเทอมก่อน ยังไม่ยืนยัน
    room = mock_api.ROOMS[0]["id"]
    for body in ({"note": "ครูลาคลอดเทอมหน้า"}, {"lab_room_id": room}, {"is_double": True},
                 {"co_teacher_id": _wl_teacher(db, 507)}, {"lab_room_id": None}, {"note": ""}):
        out = _put(db, HEAD1, r1["id"], body)
        assert out["confirmed"] is False and r1["confirmed"] is False, body
        assert r1["from_plan"] is False, body             # งานของคนแล้ว (sync ต้องถาม force)
    for bad in ("true", 1, None, "ใช่"):
        before = _state(db)
        c, d = _code(lambda: _put(db, HEAD1, r1["id"], {"confirmed": bad}))
        assert c == 400 and _thai(d) and "confirmed" in d, (bad, c, d)
        assert _state(db) == before
    assert _put(db, HEAD1, r1["id"], {"confirmed": True})["confirmed"] is True
    assert _put(db, HEAD1, r1["id"], {"confirmed": False})["confirmed"] is False
    assert _row(db, t, 0, 1)["teacher_id"] == _wl_teacher(db, 501)    # ครูไม่หายเพราะยืนยัน/ไม่ยืนยัน


def test_row_put_rejects_subject_fields():
    db, t, rnd = _filling()
    r1 = _row(db, t, 0, 1)
    for sess in (HEAD1, ADMIN):
        for field, v in (("weekly", 5), ("code", "X1"), ("name", "อื่น"), ("subject_id", 1), ("credits", 2),
                         ("kind", "basic"), ("department_id", 2), ("group_id", 2), ("line_id", 1), ("round_id", 1),
                         ("from_plan", True), ("flag", None), ("curriculum_id", 1)):
            before = _state(db)
            c, d = _code(lambda: _put(db, sess, r1["id"], {field: v, "note": "x"}))
            assert c == 400 and _thai(d) and field in d, (field, c, d)
            assert _state(db) == before
    for body in ({}, [], "x", None):
        c, d = _code(lambda: _put(db, HEAD1, r1["id"], body))
        assert c == 400 and _thai(d), (body, c, d)
    for field, v in (("teacher_id", "501"), ("teacher_id", True), ("co_teacher_id", 1.5), ("lab_room_id", "40"),
                     ("is_double", 1), ("note", 5), ("note", "a\x00b"), ("teacher_id", 2 ** 70)):
        c, d = _code(lambda: _put(db, HEAD1, r1["id"], {field: v}))
        assert c == 400 and _thai(d) and field in d, (field, v, c, d)


def test_row_values_are_checked():
    db, t, rnd = _filling()
    r3 = _row(db, t, 0, 3)
    a, b = _wl_teacher(db, 506), _wl_teacher(db, 507)
    # ครูที่ไม่มีในทะเบียน → 400 · ห้องปฏิบัติการที่ไม่มีในโปรแกรมจัดตาราง → 400
    for body in ({"teacher_id": 999999}, {"co_teacher_id": 999999}, {"lab_room_id": 999999}):
        before = _state(db)
        c, d = _code(lambda: _put(db, HEAD1, r3["id"], body))
        assert c == 400 and _thai(d), (body, c, d)
        assert _state(db) == before
    # ครูผู้สอนกับครูสอนร่วมต้องเป็นคนละคน (ทั้งส่งพร้อมกัน และส่งทีละช่องให้ชนกับของเดิม)
    c, d = _code(lambda: _put(db, HEAD1, r3["id"], {"teacher_id": a, "co_teacher_id": a}))
    assert c == 400 and _thai(d), (c, d)
    _put(db, HEAD1, r3["id"], {"teacher_id": a, "co_teacher_id": b})
    c, d = _code(lambda: _put(db, HEAD1, r3["id"], {"co_teacher_id": a}))
    assert c == 400 and _thai(d), (c, d)
    out = _put(db, HEAD1, r3["id"], {"co_teacher_id": None, "lab_room_id": mock_api.ROOMS[1]["id"], "is_double": True,
                                     "note": "  ห้องคอม  "})
    assert (out["co_teacher_id"], out["lab_room_id"], out["is_double"]) == (None, mock_api.ROOMS[1]["id"], True)
    assert out["note"] == "ห้องคอม", out["note"]          # ตัดช่องว่างหัวท้าย (หมายเหตุว่าง = ไม่มีงานของคน)
    # ล้างครูได้ (ยังต้องเลือกใหม่ก่อนส่ง)
    assert _put(db, HEAD1, r3["id"], {"teacher_id": None})["teacher_id"] is None


def test_missing_rows_and_rounds_are_404():
    db, t, rnd = _filling()
    for rid in (999999, 0, -1, 2 ** 70):
        c, d = _code(lambda: _put(db, ADMIN, rid, {"note": "x"}))
        assert c == 404 and _thai(d), (rid, c, d)
        c, d = _code(lambda: _get(db, ADMIN, rid))
        assert c == 404 and _thai(d), (rid, c, d)
        for fn, a in ((mock_api.wl_option_teachers_add, (rid, REQ, {"teacher_id": _wl_teacher(db, 501)})),
                      (mock_api.wl_option_teachers_update, (rid, REQ, {"note": "x"})),
                      (mock_api.wl_option_teachers_delete, (rid, REQ))):
            c, d = _code(lambda: _call(db, ADMIN, fn, *a))
            assert c == 404 and _thai(d), (fn.__name__, rid, c, d)
    # ไม่ได้ล็อกอิน → 401 ทุกตัว
    for fn, a in ((mock_api.wl_round_rows, (rnd["id"], NOREQ)), (mock_api.wl_rows_update, (1, NOREQ, {"note": "x"})),
                  (mock_api.wl_rows_bulk, (NOREQ, {"ids": [1], "set": {"confirmed": True}})),
                  (mock_api.wl_option_teachers_add, (1, NOREQ, {"teacher_id": 1})),
                  (mock_api.wl_option_teachers_update, (1, NOREQ, {"note": "x"})),
                  (mock_api.wl_option_teachers_delete, (1, NOREQ))):
        c, d = _code(lambda: _call(db, None, fn, *a))
        assert c == 401 and _thai(d), (fn.__name__, c, d)


# ── route: อ่านแถว ─────────────────────────────────────────────────────────
def test_head_reads_only_own_department_even_if_another_is_requested():
    db, t, rnd = _filling()
    for dept in (None, "1", "3", "none", "abc", ""):
        out = _get(db, HEAD2, rnd["id"], dept)
        assert set(out) == {"rows", "options"}
        assert len(out["rows"]) == 6 and {r["department_id"] for r in out["rows"]} == {2}, (dept, out["rows"])
        assert all(set(r) == ROW_KEYS for r in out["rows"])
        assert [r["group_name"] for r in out["rows"]] == [f"ม.1/{i}" for i in range(1, 7)]
    assert {r["code"] for r in _get(db, HEAD1, rnd["id"], "2")["rows"]} == {"ท21102"}
    # ครูสอนร่วมเทอมก่อนของ ค21102 ม.1/1 อ่านได้
    g1 = _get(db, HEAD2, rnd["id"])["rows"][0]
    assert (g1["teacher_id"], g1["co_teacher_id"]) == (_wl_teacher(db, 503), _wl_teacher(db, 504))
    # admin: ไม่ส่ง = ทุกกลุ่ม · ตัวเลข = กลุ่มนั้น · none = บรรทัดที่ไม่มีกลุ่ม · อื่น ๆ = 400
    assert len(_get(db, ADMIN, rnd["id"])["rows"]) == 18
    assert {r["code"] for r in _get(db, ADMIN, rnd["id"], "3")["rows"]} == {"ว21102"}
    assert _get(db, ADMIN, rnd["id"], "none")["rows"] == []
    _call(db, ADMIN, mock_api.wl_curriculum_lines_update, t["lines"][2]["id"], REQ, body={"department_id": None})
    none = _get(db, ADMIN, rnd["id"], "none")["rows"]
    assert len(none) == 6 and {r["department_id"] for r in none} == {None}
    for bad in ("abc", "1.5", "-"):
        c, d = _code(lambda: _get(db, ADMIN, rnd["id"], bad))
        assert c == 400 and _thai(d), (bad, c, d)
    # หัวหน้ากลุ่ม 3 ไม่เห็นบรรทัดที่ไม่มีกลุ่มแล้ว
    assert _get(db, _sess("head", 3, "หัวหน้า 3"), rnd["id"])["rows"] == []


def test_head_sees_only_own_options():
    db, t, rnd = _filling()
    out = _get(db, HEAD7, rnd["id"])
    assert len(out["options"]) == 1 and out["rows"] == []
    o = out["options"][0]
    assert o["id"] == t["option"]["id"] and o["code"] == "ศ21201" and o["department_id"] == 7
    assert o["set"]["id"] == t["set"]["id"] and o["set"]["weekly"] == 2 and o["set"]["is_double"] is True
    assert o["set"]["group_names"] == [f"ม.1/{i}" for i in range(1, 7)] and "options" not in o["set"]
    assert [x["teacher_id"] for x in o["teachers"]] == [_wl_teacher(db, 508), _wl_teacher(db, 509)]
    assert all(set(x) == OT_KEYS and x["set_id"] == t["set"]["id"] for x in o["teachers"])
    assert o["teachers"][0]["room_id"] == 30 and o["teachers"][0]["confirmed"] is False
    for sess in (HEAD1, HEAD2):
        assert _get(db, sess, rnd["id"], "7")["options"] == []
    assert len(_get(db, ADMIN, rnd["id"])["options"]) == 1
    assert len(_get(db, ADMIN, rnd["id"], "7")["options"]) == 1
    assert _get(db, ADMIN, rnd["id"], "2")["options"] == []
    # ตัวเลือกที่ไม่มีกลุ่มสาระ: admin เห็นใน none · หัวหน้าไม่มีใครเห็น
    x = _call(db, ADMIN, mock_api.wl_term_set_options_create, REQ, {"set_id": t["set"]["id"], "code": "X9", "name": "พิมพ์เอง"})
    assert [o["id"] for o in _get(db, ADMIN, rnd["id"], "none")["options"]] == [x["id"]]
    assert _get(db, ADMIN, rnd["id"], "none")["options"][0]["teachers"] == []
    assert [o["id"] for o in _get(db, HEAD7, rnd["id"])["options"]] == [t["option"]["id"]]


def test_head_cannot_read_or_write_a_preparing_round():
    db, t = _rdb()
    rnd = _open(db)
    r1 = _row(db, t, 0, 1)
    before = _state(db)
    for fn in (lambda: _get(db, HEAD1, rnd["id"]), lambda: _put(db, HEAD1, r1["id"], {"confirmed": True}),
               lambda: _bulk(db, HEAD1, {"ids": [r1["id"]], "set": {"confirmed": True}}),
               lambda: _call(db, HEAD7, mock_api.wl_option_teachers_add, t["option"]["id"], REQ,
                             {"teacher_id": _wl_teacher(db, 510)})):
        c, d = _code(fn)
        assert c == 403 and _thai(d), (c, d)
    assert _state(db) == before
    # admin ตรวจและแก้ได้ตั้งแต่ยังเตรียม
    assert len(_get(db, ADMIN, rnd["id"])["rows"]) == 18
    assert _put(db, ADMIN, r1["id"], {"confirmed": True})["confirmed"] is True


def test_head_put_on_other_department_row_is_403():
    db, t, rnd = _filling()
    mine, other = _row(db, t, 1, 2), _row(db, t, 0, 2)
    ot = _ots(db)[0]
    before = _state(db)
    for fn in (lambda: _put(db, HEAD2, other["id"], {"confirmed": True}),
               lambda: _put(db, HEAD2, other["id"], {"teacher_id": _wl_teacher(db, 506)}),
               lambda: _bulk(db, HEAD2, {"ids": [mine["id"], other["id"]], "set": {"confirmed": True}}),
               lambda: _call(db, HEAD2, mock_api.wl_option_teachers_add, t["option"]["id"], REQ,
                             {"teacher_id": _wl_teacher(db, 510)}),
               lambda: _call(db, HEAD2, mock_api.wl_option_teachers_update, ot["id"], REQ, {"confirmed": True}),
               lambda: _call(db, HEAD2, mock_api.wl_option_teachers_delete, ot["id"], REQ)):
        c, d = _code(fn)
        assert c == 403 and _thai(d), (c, d)
    assert _state(db) == before                            # รวมแถวของกลุ่มตัวเองใน bulk ก็ไม่ถูกแตะ
    # บรรทัดที่ไม่มีกลุ่มสาระ: ไม่ใช่ของหัวหน้าคนไหน
    _call(db, ADMIN, mock_api.wl_curriculum_lines_update, t["lines"][1]["id"], REQ, body={"department_id": None})
    c, d = _code(lambda: _put(db, HEAD2, mine["id"], {"confirmed": True}))
    assert c == 403 and _thai(d), (c, d)
    assert _put(db, ADMIN, mine["id"], {"confirmed": True})["confirmed"] is True


def test_put_after_round_closed_is_409_with_thai_reason():
    db, t, rnd = _filling()
    r1 = _row(db, t, 0, 1)
    ot = _ots(db)[0]
    _call(db, ADMIN, mock_api.wl_rounds_close, rnd["id"], REQ, {"confirm_label": "2/2569"})
    before = _state(db)
    for sess, fn in ((HEAD1, lambda s: _put(db, s, r1["id"], {"confirmed": True})),
                     (ADMIN, lambda s: _put(db, s, r1["id"], {"note": "x"})),
                     (HEAD1, lambda s: _bulk(db, s, {"ids": [r1["id"]], "set": {"confirmed": True}})),
                     (HEAD7, lambda s: _call(db, s, mock_api.wl_option_teachers_add, t["option"]["id"], REQ,
                                             {"teacher_id": _wl_teacher(db, 510)})),
                     (HEAD7, lambda s: _call(db, s, mock_api.wl_option_teachers_update, ot["id"], REQ,
                                             {"confirmed": True})),
                     (ADMIN, lambda s: _call(db, s, mock_api.wl_option_teachers_delete, ot["id"], REQ))):
        c, d = _code(lambda: fn(sess))
        assert c == 409 and _thai(d) and "ปิด" in d, (c, d)
    assert _state(db) == before
    # อ่านได้ตามเดิม (หลักฐานย้อนหลัง)
    assert len(_get(db, HEAD1, rnd["id"])["rows"]) == 6


def test_bulk_is_all_or_nothing():
    db, t, rnd = _filling()
    g3, g4, g5 = (_row(db, t, 0, g) for g in (3, 4, 5))
    other = _row(db, t, 1, 3)
    a = _wl_teacher(db, 506)
    # กลุ่มอื่นปนมาหนึ่งแถว → 403 ไม่มีแถวไหนถูกแตะ
    before = _state(db)
    c, d = _code(lambda: _bulk(db, HEAD1, {"ids": [g3["id"], other["id"]], "set": {"teacher_id": a}}))
    assert c == 403 and _thai(d), (c, d)
    assert _state(db) == before
    # แถวที่ไม่มีอยู่ปนมา → 404 ไม่มีแถวไหนถูกแตะ
    c, d = _code(lambda: _bulk(db, HEAD1, {"ids": [g3["id"], 999999], "set": {"teacher_id": a}}))
    assert c == 404 and "ไม่พบ 1 แถว" in d, (c, d)
    assert _state(db) == before
    # body ผิด → 400
    for body in ({}, {"ids": [], "set": {"confirmed": True}}, {"ids": "1", "set": {"confirmed": True}},
                 {"ids": ["x"], "set": {"confirmed": True}}, {"ids": [True], "set": {"confirmed": True}},
                 {"ids": [g3["id"]], "set": {}}, {"ids": [g3["id"]]}, {"ids": [g3["id"]], "set": {"note": "x"}},
                 {"ids": [g3["id"]], "set": {"confirmed": "yes"}}, {"ids": [g3["id"]], "set": {"teacher_id": "x"}},
                 {"ids": [g3["id"]], "set": {"confirmed": True}, "extra": 1}, {"ids": [g3["id"]], "set": []},
                 {"ids": list(range(1, mock_api.WL_BULK_MAX + 2)), "set": {"confirmed": True}}):
        c, d = _code(lambda: _bulk(db, HEAD1, body))
        assert c == 400 and _thai(d), (str(body)[:80], c, d)
    assert _state(db) == before
    c, d = _code(lambda: _bulk(db, HEAD1, {"ids": [g3["id"]], "set": {"note": "x"}}))
    assert "note" in d
    # สำเร็จ: ทุกแถวได้ครูคนเดียวกันและยืนยันแล้ว · id ซ้ำนับครั้งเดียว
    # (คำขอที่ล้มย้อนฐานข้อมูลปลอมกลับเป็นสำเนา dict ของแถวที่ถือไว้ก่อนหน้าจึงเก่า ต้องหยิบใหม่)
    g3, g4, g5 = (_row(db, t, 0, g) for g in (3, 4, 5))
    out = _bulk(db, HEAD1, {"ids": [g3["id"], g4["id"], g5["id"], g4["id"]], "set": {"teacher_id": a}})
    assert sorted(r["id"] for r in out["rows"]) == sorted([g3["id"], g4["id"], g5["id"]])
    assert all(set(r) == ROW_KEYS for r in out["rows"])
    for r in (g3, g4, g5):
        assert (r["teacher_id"], r["confirmed"], r["from_plan"]) == (a, True, False), r
    # ยืนยันอย่างเดียว: ครูเดิมยังอยู่
    g1, g2 = _row(db, t, 0, 1), _row(db, t, 0, 2)
    t1, t2 = g1["teacher_id"], g2["teacher_id"]
    _bulk(db, HEAD1, {"ids": [g1["id"], g2["id"]], "set": {"confirmed": True}})
    assert (g1["teacher_id"], g2["teacher_id"], g1["confirmed"], g2["confirmed"]) == (t1, t2, True, True)
    assert g1["from_plan"] is False and g2["from_plan"] is False
    # ตั้งครูที่ชนกับครูสอนร่วมของแถวใดแถวหนึ่ง → 400 ทั้งชุด
    _put(db, HEAD1, g5["id"], {"co_teacher_id": _wl_teacher(db, 507)})
    before = _state(db)
    c, d = _code(lambda: _bulk(db, HEAD1, {"ids": [g3["id"], g5["id"]], "set": {"teacher_id": _wl_teacher(db, 507)}}))
    assert c == 400 and _thai(d), (c, d)
    assert _state(db) == before


def test_bulk_rows_must_be_in_one_round():
    db, t, rnd = _filling()
    first = _row(db, t, 0, 1)
    _call(db, ADMIN, mock_api.wl_rounds_close, rnd["id"], REQ, {"confirm_label": "2/2569"})
    t2 = _term(db, 2570, 1)
    r2 = _open(db, 2570, 1)
    second = next(r for r in db.tables["wl_rows"] if r["round_id"] == r2["id"] and r["line_id"] == t2["lines"][0]["id"])
    before = _state(db)
    c, d = _code(lambda: _bulk(db, ADMIN, {"ids": [first["id"], second["id"]], "set": {"confirmed": True}}))
    assert c == 400 and _thai(d) and "รอบ" in d, (c, d)
    assert _state(db) == before
    assert len(_bulk(db, ADMIN, {"ids": [second["id"]], "set": {"confirmed": True}})["rows"]) == 1


def test_inactive_teacher_cannot_be_newly_assigned_but_existing_row_still_reads():
    db, t, rnd = _filling()
    old = _wl_teacher(db, 501)
    _call(db, ADMIN, mock_api.wl_teachers_update, old, REQ, {"active": False})
    g1, g3 = _row(db, t, 0, 1), _row(db, t, 0, 3)
    assert g1["teacher_id"] == old
    # ยังอ่านได้ในแถวเดิม ไม่กลายเป็นช่องว่าง
    assert _get(db, HEAD1, rnd["id"])["rows"][0]["teacher_id"] == old
    # ค่าเดิมที่ไม่เปลี่ยนไม่ตรวจ
    assert _put(db, HEAD1, g1["id"], {"note": "ย้ายแล้ว"})["teacher_id"] == old
    assert _put(db, HEAD1, g1["id"], {"teacher_id": old})["confirmed"] is True
    # เลือกใหม่ไม่ได้ — ทุกทาง
    before = _state(db)
    for fn in (lambda: _put(db, HEAD1, g3["id"], {"teacher_id": old}),
               lambda: _put(db, HEAD1, g3["id"], {"co_teacher_id": old}),
               lambda: _bulk(db, HEAD1, {"ids": [g1["id"], g3["id"]], "set": {"teacher_id": old}}),
               lambda: _call(db, HEAD7, mock_api.wl_option_teachers_add, t["option"]["id"], REQ, {"teacher_id": old}),
               lambda: _call(db, HEAD7, mock_api.wl_option_teachers_update, _ots(db)[0]["id"], REQ,
                             {"teacher_id": old})):
        c, d = _code(fn)
        assert c == 409 and _thai(d) and "ไม่ปฏิบัติงาน" in d, (c, d)
    assert _state(db) == before
    # bulk ที่ทุกแถวมีครูคนนั้นอยู่แล้ว = ไม่ได้เลือกใหม่ → ผ่าน
    assert len(_bulk(db, HEAD1, {"ids": [g1["id"]], "set": {"teacher_id": old}})["rows"]) == 1


# ── route: ครูของตัวเลือก ──────────────────────────────────────────────────
def test_option_can_have_several_teachers():
    db, t, rnd = _filling()
    oid = t["option"]["id"]
    a, b = _wl_teacher(db, 510), _wl_teacher(db, 507)
    out = _call(db, HEAD7, mock_api.wl_option_teachers_add, oid, REQ, {"teacher_id": a, "room_id": 30, "note": "ห้องดนตรี"})
    assert set(out) == OT_KEYS, set(out) ^ OT_KEYS
    assert (out["option_id"], out["set_id"], out["round_id"]) == (oid, t["set"]["id"], rnd["id"])
    assert (out["teacher_id"], out["room_id"], out["note"], out["confirmed"], out["from_plan"]) == \
           (a, 30, "ห้องดนตรี", True, False), out
    _call(db, HEAD7, mock_api.wl_option_teachers_add, oid, REQ, {"teacher_id": b})
    got = _get(db, HEAD7, rnd["id"])["options"][0]["teachers"]
    assert [x["teacher_id"] for x in got] == [_wl_teacher(db, 508), _wl_teacher(db, 509), a, b]
    # ครูคนเดิมซ้ำในตัวเลือกเดียวกัน → 409
    before = _state(db)
    c, d = _code(lambda: _call(db, HEAD7, mock_api.wl_option_teachers_add, oid, REQ, {"teacher_id": a}))
    assert c == 409 and _thai(d), (c, d)
    assert _state(db) == before
    # body ผิด → 400
    for body in ({}, {"teacher_id": None}, {"teacher_id": "1"}, {"teacher_id": a, "confirmed": True},
                 {"teacher_id": a, "room_id": 999999}, {"teacher_id": 999999}, {"teacher_id": a, "note": 1}):
        c, d = _code(lambda: _call(db, HEAD7, mock_api.wl_option_teachers_add, oid, REQ, body))
        assert c == 400 and _thai(d), (body, c, d)
    assert _state(db) == before
    # แก้: ห้อง/หมายเหตุไม่ยืนยัน · ยืนยันต้องส่ง true เอง · เปลี่ยนครู = ยืนยัน
    first = _ots(db)[0]
    assert first["from_plan"] and not first["confirmed"]
    r = _call(db, HEAD7, mock_api.wl_option_teachers_update, first["id"], REQ, {"room_id": 31, "note": "x"})
    assert (r["room_id"], r["confirmed"], r["from_plan"]) == (31, False, False) and set(r) == OT_KEYS
    assert _call(db, HEAD7, mock_api.wl_option_teachers_update, first["id"], REQ, {"confirmed": True})["confirmed"]
    second = _ots(db)[1]
    r = _call(db, HEAD7, mock_api.wl_option_teachers_update, second["id"], REQ, {"teacher_id": _wl_teacher(db, 506)})
    assert (r["teacher_id"], r["confirmed"]) == (_wl_teacher(db, 506), True)
    for body in ({"teacher_id": None}, {"teacher_id": a}, {"confirmed": 1}, {"option_id": 1}, {}):
        c, d = _code(lambda: _call(db, HEAD7, mock_api.wl_option_teachers_update, second["id"], REQ, body))
        assert c in (400, 409) and _thai(d), (body, c, d)
    # เอาครูออก
    n = len(_ots(db))
    assert _call(db, HEAD7, mock_api.wl_option_teachers_delete, second["id"], REQ) == {"ok": True}
    assert len(_ots(db)) == n - 1 and all(o["id"] != second["id"] for o in _ots(db))
    c, d = _code(lambda: _call(db, HEAD7, mock_api.wl_option_teachers_delete, second["id"], REQ))
    assert c == 404 and _thai(d)


def test_every_write_sets_from_plan_false():
    db, t, rnd = _filling()
    g1, g2 = _row(db, t, 0, 1), _row(db, t, 0, 2)
    assert g1["from_plan"] and g2["from_plan"] and all(o["from_plan"] for o in _ots(db))
    _put(db, ADMIN, g1["id"], {"note": "admin เขียน"})
    _bulk(db, HEAD1, {"ids": [g2["id"]], "set": {"confirmed": False}})
    _call(db, HEAD7, mock_api.wl_option_teachers_update, _ots(db)[0]["id"], REQ, {"note": "x"})
    assert g1["from_plan"] is False and g2["from_plan"] is False and _ots(db)[0]["from_plan"] is False
    assert _ots(db)[1]["from_plan"] is True                 # แถวที่ไม่มีใครแตะยังเป็นของเครื่อง


def test_writes_lock_the_round_row_for_share_before_the_first_write():
    db, t, rnd = _filling()
    g1 = _row(db, t, 0, 1)
    ot = _ots(db)[0]
    cases = [(HEAD1, mock_api.wl_rows_update, (g1["id"], REQ, {"note": "x"}), "wl_rows"),
             (HEAD1, mock_api.wl_rows_bulk, (REQ, {"ids": [g1["id"]], "set": {"confirmed": True}}), "wl_rows"),
             (HEAD7, mock_api.wl_option_teachers_add, (t["option"]["id"], REQ, {"teacher_id": _wl_teacher(db, 510)}),
              "wl_option_teachers"),
             (HEAD7, mock_api.wl_option_teachers_update, (ot["id"], REQ, {"note": "x"}), "wl_option_teachers"),
             (HEAD7, mock_api.wl_option_teachers_delete, (ot["id"], REQ), "wl_option_teachers")]
    for sess, fn, a, table in cases:
        sql = _sql_as(db, sess, fn, *a)
        writes = [i for i, q in enumerate(sql) if re.match(rf"(UPDATE {table}|INSERT INTO {table}|DELETE FROM {table})\b", q)]
        lock = [i for i, q in enumerate(sql) if re.match(r"SELECT .* FROM wl_rounds WHERE .* FOR SHARE$", q)]
        dept = [i for i, q in enumerate(sql) if re.match(r"SELECT .* FROM wl_dept_status WHERE .* FOR SHARE$", q)]
        assert writes and lock and dept, (fn.__name__, sql)
        assert lock[0] < dept[0] < writes[0], (fn.__name__, sql)
        if fn is mock_api.wl_option_teachers_add:
            key = [i for i, q in enumerate(sql) if re.match(r"SELECT .* FROM wl_term_set_options WHERE .* FOR KEY SHARE$", q)]
            assert key and lock[0] < key[0] < writes[0], sql


class _VanishCur(FakeCur):
    """แถวถูก sync ลบไปพร้อมกันพอดี: ลบแถวเป้าหมายทิ้งก่อนคำสั่งเขียนแรกของตารางนั้นจะทำงาน"""
    def __init__(self, db, sess, table, row_id):
        super().__init__(db, sess)
        self.table, self.row_id, self.done = table, row_id, False

    def execute(self, sql, params=()):
        s = " ".join(sql.split())
        if not self.done and re.match(rf"(UPDATE {self.table}|DELETE FROM {self.table})\b", s):
            self.done = True
            self.db.tables[self.table] = [r for r in self.db.tables[self.table] if r["id"] != self.row_id]
        return super().execute(sql, params)


def _vanish(db, sess, table, row_id, fn, *a):
    cur = _VanishCur(db, sess, table, row_id)

    @contextlib.contextmanager
    def fake():
        yield cur
    saved = mock_api._wl_db
    mock_api._wl_db = fake
    try:
        return _code(lambda: fn(*a))
    finally:
        mock_api._wl_db = saved


def test_write_that_hits_no_row_is_404_not_silent_success():
    db, t, rnd = _filling()
    g1, g2 = _row(db, t, 0, 1), _row(db, t, 0, 2)
    c, d = _vanish(copy.deepcopy(db), HEAD1, "wl_rows", g1["id"], mock_api.wl_rows_update, g1["id"], REQ, {"note": "x"})
    assert c == 404 and _thai(d), (c, d)
    c, d = _vanish(copy.deepcopy(db), HEAD1, "wl_rows", g2["id"], mock_api.wl_rows_bulk, REQ,
                   {"ids": [g1["id"], g2["id"]], "set": {"confirmed": True}})
    assert c == 404 and _thai(d), (c, d)
    ot = _ots(db)[0]
    c, d = _vanish(copy.deepcopy(db), HEAD7, "wl_option_teachers", ot["id"], mock_api.wl_option_teachers_update,
                   ot["id"], REQ, {"note": "x"})
    assert c == 404 and _thai(d), (c, d)
    c, d = _vanish(copy.deepcopy(db), HEAD7, "wl_option_teachers", ot["id"], mock_api.wl_option_teachers_delete,
                   ot["id"], REQ)
    assert c == 404 and _thai(d), (c, d)


def test_admin_edits_any_department_in_preparing_and_filling():
    db, t, rnd = _filling()
    for line in (0, 1, 2):
        r = _row(db, t, line, 6)
        assert _put(db, ADMIN, r["id"], {"teacher_id": _wl_teacher(db, 510)})["confirmed"] is True
    out = _call(db, ADMIN, mock_api.wl_option_teachers_add, t["option"]["id"], REQ, {"teacher_id": _wl_teacher(db, 510)})
    assert out["confirmed"] is True


def test_no_route_deletes_teachers_or_subjects():
    routes = [(v, p) for v, p, _ in mock_api.app.routes if p.startswith("/api/workload")]
    deletes = [p for v, p in routes if v == "delete"]
    assert not [p for p in deletes if re.match(r"/api/workload/(teachers|subjects)\b", p)], deletes
    for want in (("get", "/api/workload/rounds/{round_id}/rows"), ("put", "/api/workload/rows/{row_id}"),
                 ("post", "/api/workload/rows/bulk"), ("post", "/api/workload/options/{option_id}/teachers"),
                 ("put", "/api/workload/option-teachers/{option_teacher_id}"),
                 ("delete", "/api/workload/option-teachers/{option_teacher_id}")):
        assert want in routes, want
    # เอาครูออกจากตัวเลือก = ลบแถวของ wl_option_teachers เท่านั้น ทะเบียนครู/วิชาไม่ถูกแตะ
    db, t, rnd = _filling()
    reg = copy.deepcopy((db.tables["wl_teachers"], db.tables["wl_subjects"]))
    _call(db, HEAD7, mock_api.wl_option_teachers_delete, _ots(db)[0]["id"], REQ)
    assert (db.tables["wl_teachers"], db.tables["wl_subjects"]) == reg


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
