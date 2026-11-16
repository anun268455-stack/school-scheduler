"""
เว็บลงอัตรากำลัง ขั้นที่ 2 งานที่ 4 (ส่วนหลัง): ยอดคาบรายครู และขั้นงานส่ง-ตรวจผ่าน-ตีกลับ

wl_teacher_loads / wl_submit_blocker / wl_fill_counts เป็นฟังก์ชันล้วน · ข้อทดสอบความตรงกับโปรแกรมจัดตาราง (สเปก 4.4 ข.)
เดินทั้งเส้นด้วยฟังก์ชันล้วนบนข้อมูลตั้งต้น: แผนการสอน → ผลแปลง → หลักสูตร × ห้อง → ครูเทอมก่อน → ยอดคาบ แล้วเทียบกับ
ไฟล์คำตอบร่วม tests/fixtures/seed_teacher_loads.json ที่ฝั่ง TypeScript (tests/ts/wlloads.ts) เทียบกับ teacherLoads ตัวจริง
route คุยกับฐานข้อมูลปลอมของ wlcurriculum.py ด้วยรอบชุดเล็กของ wlrows.py
"""
import contextlib
import datetime as dt
import json
import re
import sys
from pathlib import Path

import mock_api
from wlcurriculum import ADMIN, NOREQ, REQ, FakeCur, _call, _code, _seed_src, _state, _thai
from wlopen import _open, _rdb, _wl_teacher
from wlrows import HEAD1, HEAD2, HEAD7, _bulk, _filling, _ots, _put, _row

fails: list[str] = []

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "seed_teacher_loads.json"
DEPT_KEYS = {"department_id", "status", "submitted_at", "submitted_by", "reviewed_at", "reviewed_by", "note",
             "rows", "confirmed", "missing_teacher"}
LOAD_KEYS = {"teacher_id", "name", "department_id", "total", "own"}


def _opt(set_id, weekly, teachers, oid=1, confirmed=True):
    return {"id": oid, "set_id": set_id, "department_id": 7, "set": {"id": set_id, "weekly": weekly},
            "teachers": [{"teacher_id": t, "confirmed": confirmed} for t in teachers]}


# ── ฟังก์ชันล้วน: ยอดคาบ ─────────────────────────────────────────────────────
def _pure_round(src):
    """ทั้งเส้นแบบไม่มีฐานข้อมูล: wl_round_proposal → wl_curricula_from_proposal (บรรทัด × ห้อง) → wl_prefill
    → แถว/ตัวเลือกรูปเดียวกับที่ GET /rounds/{id}/rows คืน (เท่าที่ยอดคาบใช้)"""
    prop = mock_api.wl_round_proposal(src)
    plan = mock_api.wl_curricula_from_proposal(prop, src["groups"])
    sched_of = {wl: s for s, wl in src["subject_ids"].items()}
    order = {g: i for i, g in enumerate(src["groups"])}
    cells, lid = [], 0
    for c in plan["curricula"]:
        for ln in c["lines"]:
            lid += 1
            for g in sorted(c["group_ids"], key=lambda g: order.get(g, len(order))):
                cells.append((lid, g, ln))
    opts, oid = [], 0
    for sid, s in enumerate(plan["sets"], 1):
        for o in s["options"]:
            oid += 1
            opts.append((oid, sid, s, o))
    pre = mock_api.wl_prefill(
        prop, [{"line_id": lid, "group_id": g, "sched_subject_id": sched_of.get(ln["subject_id"])} for lid, g, ln in cells],
        [{"option_id": oid, "group_ids": s["group_ids"], "sched_subject_id": sched_of.get(o["subject_id"])}
         for oid, sid, s, o in opts], src["subject_ids"])
    rows = [{"line_id": lid, "group_id": g, "weekly": ln["weekly"], "department_id": ln["department_id"],
             "teacher_id": pre["rows"].get((lid, g), {}).get("teacher_id"),
             "co_teacher_id": pre["rows"].get((lid, g), {}).get("co_teacher_id"), "confirmed": False}
            for lid, g, ln in cells]
    options = [{"id": oid, "set_id": sid, "department_id": o["department_id"],
                "set": {"id": sid, "weekly": s["weekly"], "group_ids": s["group_ids"]},
                "teachers": [{"teacher_id": t["teacher_id"], "confirmed": False} for t in pre["options"].get(oid, [])]}
               for oid, sid, s, o in opts]
    return rows, options


def test_loads_match_timetable_program_for_plain_teachers():
    data, src = _seed_src()
    want = {int(k): v for k, v in json.loads(FIXTURE.read_text(encoding="utf-8")).items()}
    rows, options = _pure_round(src)
    assert len(rows) == 1220 and len(options) == 44
    loads = mock_api.wl_teacher_loads(rows, options)
    sched = {wl: s for s, wl in src["teacher_ids"].items()}
    got = {sched[t]: n for t, n in loads.items()}
    # ครูธรรมดา = ไม่อยู่ในตัวเลือกคาบเสรี/กิจกรรม และไม่อยู่ในคู่สอนร่วม
    in_sets = {o.get("teacher_id") for p in data["elective_pools"] for o in p.get("options") or []}
    for s in data.get("slots") or []:
        in_sets |= {s.get("teacher_id"), *(s.get("activity_teacher_ids") or [])} if s.get("is_activity_block") else set()
        in_sets |= {o.get("teacher_id") for o in s.get("elective_options") or []}
    co = {r["teacher_id"] for r in data["requirements"] if r.get("co_teacher_id")} | \
         {r["co_teacher_id"] for r in data["requirements"] if r.get("co_teacher_id")}
    plain = [t for t in want if t not in in_sets and t not in co]
    assert len(plain) >= 100, len(plain)
    bad = [(t, want[t], got.get(t, 0)) for t in plain if got.get(t, 0) != want[t]]
    assert not bad, bad[:10]
    # ครูที่สอนคาบเสรีได้ยอดไม่น้อยกว่าโปรแกรมเดิม (โปรแกรมเดิมไม่นับ ELECTIVE_POOLS — สเปกหลักให้นับ) และมีคนที่มากกว่าจริง
    others = [t for t in want if t in in_sets]
    assert others and all(got.get(t, 0) >= want[t] for t in others), [(t, want[t], got.get(t)) for t in others]
    assert any(got.get(t, 0) > want[t] for t in others)


def test_elective_option_counts_set_weekly_once_not_per_class():
    opt = _opt(10, 2, [5])
    opt["set"]["group_ids"] = [1, 2, 3, 4, 5, 6]
    assert mock_api.wl_teacher_loads([], [opt]) == {5: 2}
    # ผ่าน route: ตัวเลือก ศ21201 ของชุดที่ใช้ 6 ห้อง คาบ/สัปดาห์ 2 → ครูแต่ละคนได้ 2 ไม่ใช่ 12
    db, t, rnd = _filling()
    loads = {x["teacher_id"]: x for x in _call(db, ADMIN, mock_api.wl_round_loads, rnd["id"], REQ)}
    assert loads[_wl_teacher(db, 508)]["total"] == 2 and loads[_wl_teacher(db, 509)]["total"] == 2


def test_co_teacher_gets_the_row_weekly():
    rows = [{"teacher_id": 1, "co_teacher_id": 2, "weekly": 3}, {"teacher_id": 1, "co_teacher_id": 1, "weekly": 2},
            {"teacher_id": None, "co_teacher_id": 3, "weekly": 4}, {"teacher_id": None, "co_teacher_id": None, "weekly": 9}]
    assert mock_api.wl_teacher_loads(rows, []) == {1: 5, 2: 3, 3: 4}
    db, t, rnd = _filling()
    loads = {x["teacher_id"]: x["total"] for x in _call(db, ADMIN, mock_api.wl_round_loads, rnd["id"], REQ)}
    assert loads[_wl_teacher(db, 503)] == 3 and loads[_wl_teacher(db, 504)] == 3      # ค21102 ม.1/1 สอนร่วม


def test_same_teacher_twice_in_one_set_counts_once():
    options = [_opt(10, 2, [5, 5], oid=1), _opt(10, 2, [5, 6], oid=2), _opt(11, 3, [5], oid=3),
               _opt(12, 4, [None], oid=4), _opt(13, 1, [], oid=5)]
    assert mock_api.wl_teacher_loads([], options) == {5: 5, 6: 2}
    rows = [{"teacher_id": 5, "co_teacher_id": None, "weekly": 3}]
    assert mock_api.wl_teacher_loads(rows, options) == {5: 8, 6: 2}
    # ไม่แก้ input
    snap = json.dumps(options, sort_keys=True)
    mock_api.wl_teacher_loads(rows, options)
    assert json.dumps(options, sort_keys=True) == snap
    # ผ่าน route: ครูคนเดียวกันในสองตัวเลือกของชุดเดียวกันได้คาบของชุดครั้งเดียว
    db, t, rnd = _filling()
    o2 = _call(db, ADMIN, mock_api.wl_term_set_options_create, REQ,
               {"set_id": t["set"]["id"], "code": "X1", "name": "ดนตรีไทย", "department_id": 7})
    _call(db, HEAD7, mock_api.wl_option_teachers_add, o2["id"], REQ, {"teacher_id": _wl_teacher(db, 508)})
    loads = {x["teacher_id"]: x["total"] for x in _call(db, ADMIN, mock_api.wl_round_loads, rnd["id"], REQ)}
    assert loads[_wl_teacher(db, 508)] == 2


# ── ฟังก์ชันล้วน: ส่งได้ไหม ──────────────────────────────────────────────────
def _r(teacher, confirmed):
    return {"teacher_id": teacher, "co_teacher_id": None, "confirmed": confirmed, "weekly": 1}


def test_submit_blocker_counts_rows_and_options():
    sb, fc = mock_api.wl_submit_blocker, mock_api.wl_fill_counts
    assert sb([], []) is None and fc([], []) == {"rows": 0, "confirmed": 0, "missing_teacher": 0}
    done_opt = {"teachers": [{"teacher_id": 2, "confirmed": True}, {"teacher_id": 3, "confirmed": True}]}
    assert sb([_r(1, True), _r(2, True)], [done_opt]) is None
    rows = [_r(None, False), _r(None, True), _r(1, False), _r(1, True)]
    options = [{"teachers": []}, {"teachers": [{"teacher_id": None, "confirmed": True}]}, done_opt,
               {"teachers": [{"teacher_id": 2, "confirmed": True}, {"teacher_id": 3, "confirmed": False}]}]
    msg = sb(rows, options)
    assert _thai(msg) and "ยังไม่มีครู 4" in msg and "ยังไม่ยืนยัน 2" in msg, msg
    assert fc(rows, options) == {"rows": 8, "confirmed": 2, "missing_teacher": 4}
    only_missing = sb([_r(None, False), _r(1, True)], [])
    assert "ยังไม่มีครู 1" in only_missing and "ยังไม่ยืนยัน" not in only_missing, only_missing
    only_unconfirmed = sb([_r(1, False), _r(1, False), _r(1, False)], [])
    assert "ยังไม่ยืนยัน 3" in only_unconfirmed and "ยังไม่มีครู" not in only_unconfirmed, only_unconfirmed


# ── route: ส่ง ตรวจผ่าน ตีกลับ ───────────────────────────────────────────────
def _submit(db, sess, rid, dept):
    return _call(db, sess, mock_api.wl_dept_submit, rid, dept, REQ)


def _approve(db, sess, rid, dept):
    return _call(db, sess, mock_api.wl_dept_approve, rid, dept, REQ)


def _return(db, sess, rid, dept, body):
    return _call(db, sess, mock_api.wl_dept_return, rid, dept, REQ, body)


def _iso_tz(v):
    return isinstance(v, str) and dt.datetime.fromisoformat(v).tzinfo is not None


def _fill_dept1(db, t):
    ids = [_row(db, t, 0, g)["id"] for g in range(1, 7)]
    _bulk(db, HEAD1, {"ids": ids[2:], "set": {"teacher_id": _wl_teacher(db, 506)}})
    _bulk(db, HEAD1, {"ids": ids[:2], "set": {"confirmed": True}})
    return ids


def test_submit_approve_return_flow():
    db, t, rnd = _filling()
    rid = rnd["id"]
    ids = [_row(db, t, 0, g)["id"] for g in range(1, 7)]
    # ม.1/1-2 มีครูเทอมก่อนที่ยังไม่ยืนยัน · ม.1/3-6 ยังไม่มีครู
    before = _state(db)
    c, d = _code(lambda: _submit(db, HEAD1, rid, 1))
    assert c == 409 and "ยังไม่มีครู 4" in d and "ยังไม่ยืนยัน 2" in d, (c, d)
    assert _state(db) == before
    _bulk(db, HEAD1, {"ids": ids[2:], "set": {"teacher_id": _wl_teacher(db, 506)}})
    c, d = _code(lambda: _submit(db, HEAD1, rid, 1))
    assert c == 409 and "ยังไม่ยืนยัน 2" in d and "ยังไม่มีครู" not in d, (c, d)
    _bulk(db, HEAD1, {"ids": ids[:2], "set": {"confirmed": True}})
    out = _submit(db, HEAD1, rid, 1)
    assert set(out) == DEPT_KEYS, set(out) ^ DEPT_KEYS
    assert (out["department_id"], out["status"], out["submitted_by"]) == (1, "submitted", "หัวหน้ากลุ่มสาระภาษาไทย")
    assert _iso_tz(out["submitted_at"]) and out["reviewed_at"] is None
    assert (out["rows"], out["confirmed"], out["missing_teacher"]) == (6, 6, 0)
    # ส่งแล้ว: หัวหน้าแก้ไม่ได้ ส่งซ้ำไม่ได้ · admin ยังแก้ได้
    for fn in (lambda: _put(db, HEAD1, ids[0], {"note": "x"}),
               lambda: _bulk(db, HEAD1, {"ids": ids[:1], "set": {"confirmed": False}}),
               lambda: _submit(db, HEAD1, rid, 1)):
        before = _state(db)
        c, d = _code(fn)
        assert c == 409 and _thai(d) and "ส่งแล้ว" in d, (c, d)
        assert _state(db) == before
    assert _put(db, ADMIN, ids[0], {"note": "admin แก้ได้"})["note"] == "admin แก้ได้"
    # ตรวจผ่าน
    out = _approve(db, ADMIN, rid, 1)
    assert (out["status"], out["reviewed_by"]) == ("approved", "ผู้ดูแลระบบ") and _iso_tz(out["reviewed_at"])
    c, d = _code(lambda: _put(db, HEAD1, ids[0], {"note": "x"}))
    assert c == 409 and "ตรวจผ่าน" in d, (c, d)
    c, d = _code(lambda: _approve(db, ADMIN, rid, 1))
    assert c == 409 and _thai(d), (c, d)
    # ตีกลับ: ต้องมีหมายเหตุ
    for body in ({}, {"note": ""}, {"note": "   "}, {"note": None}, {"note": 5}, {"note": "x", "status": "filling"}, None):
        before = _state(db)
        c, d = _code(lambda: _return(db, ADMIN, rid, 1, body))
        assert c == 400 and _thai(d), (body, c, d)
        if isinstance(body, dict) and "status" in body:
            assert "status" in d, d                        # ช่องแปลกปลอมบอกชื่อ
        elif isinstance(body, dict):
            assert "หมายเหตุ" in d, d                      # บอกว่าต้องเขียนหมายเหตุ ไม่ใช่แค่ "ห้ามว่าง"
        assert _state(db) == before
    out = _return(db, ADMIN, rid, 1, {"note": "  ม.1/3 ครูสอนชนกับกลุ่มอื่น  "})
    assert (out["status"], out["note"], out["reviewed_by"]) == ("returned", "ม.1/3 ครูสอนชนกับกลุ่มอื่น", "ผู้ดูแลระบบ")
    # ตีกลับแล้ว: แก้ได้ ส่งใหม่ได้ ตรวจผ่านได้
    assert _put(db, HEAD1, ids[2], {"teacher_id": _wl_teacher(db, 507)})["confirmed"] is True
    assert _submit(db, HEAD1, rid, 1)["status"] == "submitted"
    # ตีกลับจาก submitted ก็ได้
    assert _return(db, ADMIN, rid, 1, {"note": "อีกรอบ"})["status"] == "returned"
    c, d = _code(lambda: _approve(db, ADMIN, rid, 1))           # ตรวจผ่านได้เฉพาะที่ส่งแล้ว
    assert c == 409 and _thai(d), (c, d)
    c, d = _code(lambda: _return(db, ADMIN, rid, 1, {"note": "x"}))
    assert c == 409 and _thai(d), (c, d)
    _submit(db, HEAD1, rid, 1)
    assert _approve(db, ADMIN, rid, 1)["status"] == "approved"


def test_submit_approve_return_refusals():
    db, t, rnd = _filling()
    rid = rnd["id"]
    _fill_dept1(db, t)
    before = _state(db)
    for code, fn in ((403, lambda: _submit(db, ADMIN, rid, 1)),             # การส่งเป็นของหัวหน้ากลุ่ม
                     (403, lambda: _submit(db, HEAD2, rid, 1)),             # กลุ่มอื่น
                     (403, lambda: _approve(db, HEAD1, rid, 1)),
                     (403, lambda: _return(db, HEAD1, rid, 1, {"note": "x"})),
                     (409, lambda: _approve(db, ADMIN, rid, 1)),            # ยังไม่ได้ส่ง
                     (409, lambda: _return(db, ADMIN, rid, 1, {"note": "x"})),
                     (404, lambda: _approve(db, ADMIN, rid, 99)),
                     (404, lambda: _approve(db, ADMIN, 999999, 1)),
                     (404, lambda: _submit(db, HEAD1, 999999, 1)),
                     (404, lambda: _approve(db, ADMIN, 2 ** 70, 1)),
                     (401, lambda: _call(db, None, mock_api.wl_dept_submit, rid, 1, NOREQ))):
        c, d = _code(fn)
        assert c == code and _thai(d), (code, c, d)
    assert _state(db) == before
    # รอบที่ยังเตรียม: หัวหน้ายังไม่เห็น
    db2, t2 = _rdb()
    r2 = _open(db2)
    c, d = _code(lambda: _submit(db2, HEAD1, r2["id"], 1))
    assert c == 403 and _thai(d), (c, d)
    # รอบปิดแล้ว: ทุกอย่าง 409
    _submit(db, HEAD1, rid, 1)
    _call(db, ADMIN, mock_api.wl_rounds_close, rid, REQ, {"confirm_label": "2/2569"})
    for fn in (lambda: _approve(db, ADMIN, rid, 1), lambda: _return(db, ADMIN, rid, 1, {"note": "x"})):
        c, d = _code(fn)
        assert c == 409 and "ปิด" in d, (c, d)
    db3, t3, r3 = _filling()
    _fill_dept1(db3, t3)
    _call(db3, ADMIN, mock_api.wl_rounds_close, r3["id"], REQ, {"confirm_label": "2/2569"})
    c, d = _code(lambda: _submit(db3, HEAD1, r3["id"], 1))
    assert c == 409 and "ปิด" in d, (c, d)


def test_options_block_submit_of_their_department():
    db, t, rnd = _filling()
    c, d = _code(lambda: _submit(db, HEAD7, rnd["id"], 7))
    assert c == 409 and "ยังไม่ยืนยัน 1" in d, (c, d)                   # ตัวเลือกเดียว ครูเทอมก่อนสองคนยังไม่ยืนยัน
    for o in list(_ots(db)):
        _call(db, HEAD7, mock_api.wl_option_teachers_update, o["id"], REQ, {"confirmed": True})
    assert _submit(db, HEAD7, rnd["id"], 7)["status"] == "submitted"
    # ส่งแล้ว: ครูของตัวเลือกแก้ไม่ได้
    c, d = _code(lambda: _call(db, HEAD7, mock_api.wl_option_teachers_add, t["option"]["id"], REQ,
                               {"teacher_id": _wl_teacher(db, 510)}))
    assert c == 409 and "ส่งแล้ว" in d, (c, d)
    # ตัวเลือกที่ไม่มีครูเลย = ยังไม่มีครู
    db2, t2, r2 = _filling()
    for o in list(_ots(db2)):
        _call(db2, HEAD7, mock_api.wl_option_teachers_delete, o["id"], REQ)
    c, d = _code(lambda: _submit(db2, HEAD7, r2["id"], 7))
    assert c == 409 and "ยังไม่มีครู 1" in d and "ยังไม่ยืนยัน" not in d, (c, d)


def test_departments_admin_sees_all_head_sees_own():
    db, t, rnd = _filling()
    rid = rnd["id"]
    out = _call(db, ADMIN, mock_api.wl_round_departments, rid, REQ)
    assert [x["department_id"] for x in out] == list(range(1, 12))
    assert all(set(x) == DEPT_KEYS and x["status"] == "filling" for x in out)
    by = {x["department_id"]: (x["rows"], x["confirmed"], x["missing_teacher"]) for x in out}
    assert by[1] == (6, 0, 4) and by[2] == (6, 0, 5) and by[3] == (6, 0, 5) and by[7] == (1, 0, 0), by
    assert all(by[d] == (0, 0, 0) for d in (4, 5, 6, 8, 9, 10, 11)), by
    mine = _call(db, HEAD2, mock_api.wl_round_departments, rid, REQ)
    assert len(mine) == 1 and mine[0]["department_id"] == 2 and set(mine[0]) == DEPT_KEYS
    _fill_dept1(db, t)
    _submit(db, HEAD1, rid, 1)
    one = _call(db, HEAD1, mock_api.wl_round_departments, rid, REQ)
    assert (one[0]["status"], one[0]["rows"], one[0]["confirmed"]) == ("submitted", 6, 6)
    assert _call(db, ADMIN, mock_api.wl_round_departments, rid, REQ)[0]["status"] == "submitted"
    for code, fn in ((404, lambda: _call(db, ADMIN, mock_api.wl_round_departments, 999999, REQ)),
                     (401, lambda: _call(db, None, mock_api.wl_round_departments, rid, NOREQ))):
        c, d = _code(fn)
        assert c == code and _thai(d), (c, d)
    db2, t2 = _rdb()
    r2 = _open(db2)
    c, d = _code(lambda: _call(db2, HEAD1, mock_api.wl_round_departments, r2["id"], REQ))
    assert c == 403 and _thai(d), (c, d)
    assert len(_call(db2, ADMIN, mock_api.wl_round_departments, r2["id"], REQ)) == 11


def test_submit_locks_department_status_before_reading_rows():
    db, t, rnd = _filling()
    _fill_dept1(db, t)
    for sess, fn, a in ((HEAD1, mock_api.wl_dept_submit, (rnd["id"], 1, REQ)),
                        (ADMIN, mock_api.wl_dept_approve, (rnd["id"], 1, REQ)),
                        (ADMIN, mock_api.wl_dept_return, (rnd["id"], 1, REQ, {"note": "x"}))):
        cur = FakeCur(db, sess)

        @contextlib.contextmanager
        def fake(cur=cur):
            yield cur
        saved = mock_api._wl_db
        mock_api._wl_db = fake
        try:
            fn(*a)
        finally:
            mock_api._wl_db = saved
        sql = [q for q, _ in cur.log]
        rnd_lock = [i for i, q in enumerate(sql) if re.match(r"SELECT .* FROM wl_rounds WHERE .* FOR SHARE$", q)]
        st_lock = [i for i, q in enumerate(sql) if re.match(r"SELECT .* FROM wl_dept_status WHERE .* FOR UPDATE$", q)]
        upd = [i for i, q in enumerate(sql) if q.startswith("UPDATE wl_dept_status")]
        reads = [i for i, q in enumerate(sql) if "FROM wl_rows" in q]
        assert rnd_lock and st_lock and upd and rnd_lock[0] < st_lock[0] < upd[0], (fn.__name__, sql)
        if fn is mock_api.wl_dept_submit:
            assert reads and st_lock[0] < reads[0], sql


# ── route: ยอดคาบรายครู ─────────────────────────────────────────────────────
def _loads_fixture():
    db, t, rnd = _filling()
    extra = {}
    for key, dept, active in (("A", 2, True), ("B", 2, True), ("C", 3, True), ("D", 2, False)):
        extra[key] = db.add("wl_teachers", sched_id=None, name=f"ครูเพิ่ม {key}", department_id=dept, active=active)["id"]
    # หัวหน้ากลุ่ม 1 ยืมครูกลุ่ม 2 (A) ไปสอน ท21102 ม.1/3 · หัวหน้ากลุ่ม 2 ยืมครู 501 ไปสอน ค21102 ม.1/2
    _put(db, HEAD1, _row(db, t, 0, 3)["id"], {"teacher_id": extra["A"]})
    _put(db, HEAD2, _row(db, t, 1, 2)["id"], {"teacher_id": _wl_teacher(db, 501)})
    # 505 ไม่ปฏิบัติงานแล้ว แต่ยังอยู่ในแถว ว21102 ม.1/3 (ครูเทอมก่อน)
    _call(db, ADMIN, mock_api.wl_teachers_update, _wl_teacher(db, 505), REQ, {"active": False})
    return db, t, rnd, extra


def test_head_loads_list_only_related_teachers():
    db, t, rnd, extra = _loads_fixture()
    w = lambda s: _wl_teacher(db, s)        # noqa: E731
    out = _call(db, HEAD2, mock_api.wl_round_loads, rnd["id"], REQ)
    assert all(set(x) == LOAD_KEYS for x in out)
    by = {x["teacher_id"]: x for x in out}
    # ครูกลุ่ม 2 (A B · D ไม่ปฏิบัติงานและไม่มีคาบ) ∪ ครูในแถวของกลุ่ม 2 (503 504 สอนร่วม · 501 ที่ยืมมา)
    assert set(by) == {extra["A"], extra["B"], w(503), w(504), w(501)}, set(by)
    assert (by[w(501)]["total"], by[w(501)]["own"]) == (6, 3)              # ท ม.1/1 (3) + ค ม.1/2 (3)
    assert (by[extra["A"]]["total"], by[extra["A"]]["own"]) == (3, 0)       # สอนข้ามกลุ่ม: เห็นยอดจริง
    assert (by[extra["B"]]["total"], by[extra["B"]]["own"]) == (0, 0)
    assert (by[w(503)]["total"], by[w(503)]["own"]) == (3, 3) and by[w(504)]["own"] == 3
    assert by[extra["A"]]["name"] == "ครูเพิ่ม A" and by[extra["A"]]["department_id"] == 2
    # ไม่มีชื่อของครูที่ไม่เกี่ยว
    names = {x["name"] for x in out}
    assert "ครู 502" not in names and "ครูเพิ่ม C" not in names and "ครู 508" not in names
    # กลุ่ม 1: ครูกลุ่ม 1 ทุกคน (505 ไม่ปฏิบัติงานแต่ยังมีคาบ) ∪ A ที่ยืมมา
    h1 = {x["teacher_id"]: x for x in _call(db, HEAD1, mock_api.wl_round_loads, rnd["id"], REQ)}
    assert set(h1) == {w(s) for s in range(501, 511)} | {extra["A"]}, set(h1)
    assert (h1[w(505)]["total"], h1[w(505)]["own"]) == (2, 0)
    assert (h1[extra["A"]]["total"], h1[extra["A"]]["own"]) == (3, 3)
    assert (h1[w(501)]["total"], h1[w(501)]["own"]) == (6, 3)
    # กลุ่ม 7: ครูของตัวเลือก ศ21201
    h7 = {x["teacher_id"]: x for x in _call(db, HEAD7, mock_api.wl_round_loads, rnd["id"], REQ)}
    assert set(h7) == {w(508), w(509)} and h7[w(508)]["own"] == 2 == h7[w(508)]["total"]
    # รอบที่ยังเตรียม → 403 · รอบที่ไม่มี → 404 · ไม่ได้ล็อกอิน → 401
    db2, t2 = _rdb()
    r2 = _open(db2)
    for code, fn in ((403, lambda: _call(db2, HEAD1, mock_api.wl_round_loads, r2["id"], REQ)),
                     (404, lambda: _call(db, HEAD1, mock_api.wl_round_loads, 999999, REQ)),
                     (401, lambda: _call(db, None, mock_api.wl_round_loads, rnd["id"], NOREQ))):
        c, d = _code(fn)
        assert c == code and _thai(d), (code, c, d)


def test_admin_loads_every_teacher_own_equals_total():
    db, t, rnd, extra = _loads_fixture()
    w = lambda s: _wl_teacher(db, s)        # noqa: E731
    out = _call(db, ADMIN, mock_api.wl_round_loads, rnd["id"], REQ)
    by = {x["teacher_id"]: x for x in out}
    # ทุกคนที่ปฏิบัติงาน + คนที่ไม่ปฏิบัติงานแต่ยังมีคาบในรอบ (505) · D ไม่ปฏิบัติงานและไม่มีคาบ ไม่ต้องแสดง
    assert set(by) == {w(s) for s in range(501, 511)} | {extra["A"], extra["B"], extra["C"]}, set(by)
    assert all(x["own"] == x["total"] for x in out)
    want = {w(501): 6, w(502): 3, w(503): 3, w(504): 3, w(505): 2, w(508): 2, w(509): 2, extra["A"]: 3}
    assert {k: by[k]["total"] for k in want} == want
    assert all(by[k]["total"] == 0 for k in by if k not in want)
    # เรียงตามกลุ่มสาระ แล้วลำดับในกลุ่ม แล้วรหัส
    depts = [x["department_id"] for x in out]
    assert depts == sorted(depts, key=lambda d: (d is None, d or 0)), depts
    # admin ดูได้ตั้งแต่รอบยังเตรียม
    db2, t2 = _rdb()
    r2 = _open(db2)
    assert _call(db2, ADMIN, mock_api.wl_round_loads, r2["id"], REQ)


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
