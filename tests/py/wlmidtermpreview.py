"""
ทาง ข. งานที่ 3: เปิดรอบที่ปิดแล้วให้แก้กลางเทอม · เกณฑ์รอบของทาง ข. · หน้าเทียบก่อนอัปเดต (ไม่เขียนข้อมูลของโปรแกรม)

ฟังก์ชันล้วน (wl_midterm_reasons · _term_running_identity) เรียกตรง ๆ · route คุยกับฐานข้อมูลปลอมของ wlcurriculum.py (ตาราง wl_*
จาก _WL_SCHEMA รวมคอลัมน์ที่ ALTER เพิ่ม) · รอบที่ส่งแล้วสร้างด้วยทาง ก. จริง (POST /api/terms + round_id บนฐานปลอมของ
wlexportcreate.py) · ตัวแปรของโปรแกรมเป็นชุดเล็กของ wlopen.py หรือข้อมูลตั้งต้นทั้งชุด และทุกตัวถูกคืนตอนจบไฟล์ (คำตัดสิน P1)
ของจริง (Postgres · เซิร์ฟเวอร์จริง) ลองแยกในรายงาน
"""
import contextlib
import copy
import inspect
import re
import sys
import time

import mock_api
import plan_diff as D
import wlexportcreate as C
import wlexportplan as P
from wlcurriculum import ADMIN, HEAD, REQ, DbError, FakeCur, FakeDb, _call, _code, _patched, _state, _thai
from wlexportpreview import _program, _run, _scenario
from wlopen import _open, _rdb, _wl_teacher

fails: list[str] = []

_WATCH = P._TOUCHED + ("CURRENT_TERM", "REVISION", "ROOMS", "PLAN_TODOS", "SCHOOL_CONFIG", "DEPARTMENTS")
_START = copy.deepcopy({k: getattr(mock_api, k) for k in _WATCH})
_IDS = {k: id(getattr(mock_api, k)) for k in _WATCH}

NO_TERM = {"id": None, "year": None, "semester": None, "label": None, "status": None}
ACTIVE_2 = {"id": 9, "year": 2569, "semester": 2, "label": "2/2569", "status": "active"}
ACTIVE_1 = {"id": 5, "year": 2569, "semester": 1, "label": "1/2569", "status": "active"}
CLOSED_2 = {**ACTIVE_2, "status": "closed"}
PREVIEW_KEYS = {"round", "usable", "reasons", "items", "unknown", "unmatched_sets", "token"}
ROUND_KEYS = {"id", "label", "year", "semester", "status", "amending_since", "exported_label"}
LIST_KEYS = {"id", "label", "status", "amending_since", "exported_label", "usable", "reasons"}
# ตัวแปรของโปรแกรมที่หน้าเทียบต้องไม่แตะ (deep-equal ก่อน/หลัง)
PROGRAM = ("REQUIREMENTS", "ELECTIVE_POOLS", "SLOTS", "PARKED", "SUBJECTS", "TEACHERS", "CURRICULA", "GROUPS",
           "CURRENT_TERM", "SCHOOL_CONFIG", "_counters", "REVISION", "PLAN_TODOS", "LAST_RUN", "ROOMS")


@contextlib.contextmanager
def _running(term=NO_TERM, year="2569", semester="2"):
    """ภาคเรียนที่เปิดอยู่: CURRENT_TERM + ปี/ภาคในหน้าตั้งค่า (ที่ running_term_identity ถอยไปอ่านเมื่อยังไม่เคยสร้างเทอม)"""
    config = {**copy.deepcopy(mock_api.SCHOOL_CONFIG), "year": year, "term": semester}
    with _patched(CURRENT_TERM=dict(term), SCHOOL_CONFIG=config, PLAN_TODOS=[], REVISION={"n": 3},
                  _counters=dict(mock_api._counters), _DB_HAD_DATA=False):
        yield


def _close(db, rid, label="2/2569"):
    return _call(db, ADMIN, mock_api.wl_rounds_close, rid, REQ, {"confirm_label": label})


def _amend(db, rid, sess=ADMIN):
    return _call(db, sess, mock_api.wl_rounds_amend, rid, REQ)


def _round(db, rid):
    return next(r for r in db.tables["wl_rounds"] if r["id"] == rid)


def _dept_row(db, t, dept=2, group=2):
    """แถวของรอบของบรรทัดกลุ่มสาระ dept (หัวหน้าใน HEAD = กลุ่ม 2 = ค21102) ห้อง group"""
    line = next(ln for ln in t["lines"] if ln["department_id"] == dept)
    return next(r for r in db.tables["wl_rows"] if r["line_id"] == line["id"] and r["group_id"] == group)


def _preview(db, rid):
    out, log = _run(db, mock_api.terms_plan_update_preview, str(rid))
    return out, log


def _snap():
    return copy.deepcopy({k: getattr(mock_api, k) for k in PROGRAM})


def _logs(db):
    return db.count("wl_curriculum_log", year=2569, semester=2)


# ── ฐานข้อมูล ────────────────────────────────────────────────────────────
def test_schema_adds_amending_since_and_plan_updates_table():
    sql = mock_api._WL_SCHEMA
    alter = "ALTER TABLE wl_rounds ADD COLUMN IF NOT EXISTS amending_since timestamptz"
    assert alter in sql and sql.index("CREATE TABLE IF NOT EXISTS wl_rounds") < sql.index(alter)
    m = re.search(r"CREATE TABLE IF NOT EXISTS wl_plan_updates \((.*?)\n\);", sql, re.S)
    assert m, "ไม่มีตาราง wl_plan_updates"
    cols = [ln.strip().rstrip(",").split(None, 1) for ln in m.group(1).strip().splitlines() if ln.strip()]
    assert [(c[0], c[1]) for c in cols] == [
        ("id", "bigserial PRIMARY KEY"), ("round_id", "bigint"), ("term_id", "bigint"), ("year", "int"),
        ("semester", "int"), ("at", "timestamptz DEFAULT now()"), ("by", "text"), ("accepted", "jsonb"),
        ("rejected", "jsonb"), ("report", "jsonb")], cols
    # ไม่มีดัชนีใหม่ (ไม่มี unique index บนตารางที่มีข้อมูล) · ALTER ใหม่ไม่มี NOT NULL/DEFAULT ที่เขียนทับแถวเดิม
    idx = set(re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)", sql, re.I))
    assert idx == {"wl_codes_one_admin", "wl_codes_one_per_dept", "wl_curriculum_log_term", "wl_rounds_one_open"}, idx
    assert all(s.split()[0] in ("CREATE", "ALTER") and ";" not in s for s in mock_api._WL_SCHEMA_STATEMENTS)
    db = FakeDb()
    assert "amending_since" in db.schema["wl_rounds"]["cols"] and "wl_plan_updates" in db.schema
    assert "amending_since" in mock_api._WL_ROUND_COLS and "amending_since" in mock_api._WL_ROUND_LOCK_COLS


# ── ภาคเรียนที่เปิดอยู่ ──────────────────────────────────────────────────────
def test_running_identity_active_or_never_created_closed_is_none():
    f = mock_api._term_running_identity
    with _running(ACTIVE_2, "2568", "1"):          # เทอม active ชนะหน้าตั้งค่า
        assert f() == {"year": 2569, "semester": 2, "label": "2/2569", "term_id": 9}, f()
    with _running(NO_TERM, "2569", "2"):           # ยังไม่เคยสร้างเทอม = ปี/ภาคของตารางปัจจุบันจากหน้าตั้งค่า
        assert f() == {"year": 2569, "semester": 2, "label": "2/2569", "term_id": None}, f()
    for status in ("closed", "Closed", "closed ", "archived"):     # ปิดอยู่หรือค่าแปลก = ไม่ใช่ภาคที่เปิดอยู่ (ปิดไว้ก่อน)
        with _running({**ACTIVE_2, "status": status}):
            assert f() is None, status
    with _running(NO_TERM, "", ""):               # บอกไม่ได้ว่าตารางเป็นของภาคไหน
        assert f() is None
    with _running(NO_TERM, "2569", "3"):
        assert f() is None


# ── เกณฑ์ (ฟังก์ชันล้วน) ─────────────────────────────────────────────────────
RUN_2 = {"year": 2569, "semester": 2, "label": "2/2569", "term_id": None}


def _ready_source(status="closed"):
    """source ของรอบ 2/2569 ที่ผ่านเกณฑ์ (ต้องอยู่ใน _program)"""
    db, t, rnd = _scenario()
    if status == "closed":
        _round(db, rnd["id"])["status"] = "closed"
    return db, t, rnd, mock_api._wl_export_source(FakeCur(db, None), rnd["id"])


def test_midterm_reasons_follow_path_a_except_exported_and_term_exists():
    f = mock_api.wl_midterm_reasons
    with _program():
        db, t, rnd, src = _ready_source()
        before = copy.deepcopy(src)
        assert f(src, RUN_2) == [] and src == before                     # ไม่แก้ source
        # ส่งแล้ว (รวมกำลังแก้กลางเทอม) ไม่ใช่เหตุของทาง ข. — แต่ทาง ก. ยังปฏิเสธ
        sent = copy.deepcopy(src)
        sent["round"].update(exported_at="2026-11-17T09:00:00+00:00", exported_label="2/2569")
        assert f(sent, RUN_2) == []
        assert any("ส่งซ้ำไม่ได้" in r for r in mock_api.wl_export_reasons(sent, 2569, 2))
        # ไม่มีภาคที่เปิดอยู่ (เทอมปิด/บอกไม่ได้) · ภาคไม่ตรง
        got = f(src, None)
        assert len(got) == 1 and _thai(got[0]) and "ภาคเรียนที่เปิดอยู่" in got[0], got
        got = f(src, {"year": 2569, "semester": 1, "label": "1/2569", "term_id": 5})
        assert len(got) == 1 and "2/2569" in got[0] and "1/2569" in got[0], got
        # กำลังเตรียม
        prep = copy.deepcopy(src)
        prep["round"]["status"] = "preparing"
        assert any("กำลังเตรียม" in r for r in f(prep, RUN_2)), f(prep, RUN_2)
        # รอบยังเปิดให้กรอก: ทุกกลุ่มต้องตรวจผ่าน · รอบปิดแล้วไม่ดูสถานะกลุ่ม
        filling = copy.deepcopy(src)
        filling["round"]["status"] = "filling"
        assert f(filling, RUN_2) == []
        filling["dept_status"][0]["status"] = "submitted"
        got = f(filling, RUN_2)
        assert len(got) == 1 and "ยังไม่ตรวจผ่าน" in got[0], got
        closed = copy.deepcopy(src)
        closed["dept_status"][0]["status"] = "filling"
        assert f(closed, RUN_2) == []
        # รายการไม่ครบ: ไม่มีครู · ไม่ยืนยัน (ทั้งรอบ — รอบปิดแล้วก็ตาม)
        miss = copy.deepcopy(src)
        miss["rows"][0]["teacher_id"] = None
        miss["rows"][1]["confirmed"] = False
        got = f(miss, RUN_2)
        assert any("ยังไม่มีครู 1 รายการ" in r and "ยังไม่ยืนยัน 1 รายการ" in r for r in got), got
        # รหัสวิชา · ครูที่ไม่มีในทะเบียนของเว็บ
        bad = copy.deepcopy(src)
        bad["curricula"][0]["lines"][0].update(subject_id=None, code="")
        gone = max(x["id"] for x in bad["wl_teachers"]) + 50
        bad["rows"][2]["teacher_id"] = gone
        got = f(bad, RUN_2)
        assert any("ไม่มีรหัสวิชา" in r for r in got) and any(str(gone) in r for r in got), got
        # หลายเหตุ: ภาคไม่ตรงมาก่อน แล้วตามด้วยเกณฑ์ของรอบ
        got = f(miss, {"year": 2570, "semester": 1, "label": "1/2570", "term_id": None})
        assert "1/2570" in got[0] and len(got) == 2, got


# ── เปิดรอบให้แก้กลางเทอม ──────────────────────────────────────────────────
def test_amend_never_exported_closed_round():
    with _program(), _running(NO_TERM):
        db, t, rnd = _scenario()
        rid = rnd["id"]
        line = t["lines"][2]
        _close(db, rid)
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_update, line["id"], REQ, None, {"weekly": 3}))
        assert c == 409 and "ปิดแล้ว" in d, (c, d)                       # รอบปิดแล้ว หลักสูตรแก้ไม่ได้
        confirmed = {r["id"]: (r["teacher_id"], r["confirmed"]) for r in db.tables["wl_rows"]}
        out = _amend(db, rid)
        row = _round(db, rid)
        assert out["status"] == "filling" and row["status"] == "filling", out
        assert row["amending_since"] is not None and out["amending_since"] == row["amending_since"].isoformat(), out
        assert out["exported_at"] is None and out["exported_text"] is None
        assert {s["status"] for s in db.tables["wl_dept_status"] if s["round_id"] == rid} == {"filling"}
        assert {r["id"]: (r["teacher_id"], r["confirmed"]) for r in db.tables["wl_rows"]} == confirmed   # แถวยังยืนยันอยู่
        listed = _call(db, ADMIN, mock_api.wl_rounds_list, REQ)
        one = _call(db, ADMIN, mock_api.wl_round_get, rid, REQ)
        assert listed[0]["amending_since"] == one["amending_since"] == out["amending_since"], (listed, one)
        # หัวหน้ากลุ่มเขียนได้ · หลักสูตรแก้ได้และบันทึกตามเดิม
        row2 = _dept_row(db, t)
        got = _call(db, HEAD, mock_api.wl_rows_update, row2["id"], REQ, {"teacher_id": _wl_teacher(db, 502)})
        assert got["teacher_id"] == _wl_teacher(db, 502)
        n = _logs(db)
        _call(db, ADMIN, mock_api.wl_curriculum_lines_update, line["id"], REQ, None, {"weekly": 3})
        assert _logs(db) == n + 1
        assert next(ln for ln in db.tables["wl_curriculum_lines"] if ln["id"] == line["id"])["weekly"] == 3
        # ปิดรอบอีกครั้ง → อ่านอย่างเดียว ไม่มีเครื่องหมายแก้กลางเทอม
        closed = _close(db, rid)
        assert closed["status"] == "closed" and closed["amending_since"] is None and _round(db, rid)["amending_since"] is None
        c, d = _code(lambda: _call(db, HEAD, mock_api.wl_rows_update, row2["id"], REQ, {"note": "x"}))
        assert c == 409 and "ปิดแล้ว" in d, (c, d)


def test_amend_exported_round_relaxes_guards_but_path_a_still_refuses():
    with C._world() as rec, _patched(PLAN_TODOS=[]):
        db, ns = C._rich()
        rec.use(db)
        C._post(ns.rnd)                                           # ส่งด้วยทาง ก. จริง → รอบปิด + ส่งแล้ว · เทอม 2/2569 เปิดอยู่
        rid, t = ns.rnd["id"], ns.t
        assert _round(db, rid)["status"] == "closed" and _round(db, rid)["exported_at"] is not None
        assert mock_api.CURRENT_TERM["status"] == "active" and mock_api.CURRENT_TERM["semester"] == 2
        row2 = _dept_row(db, t)
        c, d = _code(lambda: _call(db, HEAD, mock_api.wl_rows_update, row2["id"], REQ, {"note": "x"}))
        assert c == 409 and "ส่งเข้าโปรแกรมแล้ว" in d, (c, d)
        out = _amend(db, rid)
        assert out["status"] == "filling" and out["amending_since"] is not None, out
        assert out["exported_at"] is not None and out["exported_text"].startswith("ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569")
        # ตัวกันรอบที่ส่งแล้วยอมรอบที่กำลังแก้กลางเทอม: หัวหน้าเขียนได้ · หลักสูตรแก้ได้และบันทึก
        got = _call(db, HEAD, mock_api.wl_rows_update, row2["id"], REQ, {"teacher_id": _wl_teacher(db, 502)})
        assert got["teacher_id"] == _wl_teacher(db, 502)
        n = _logs(db)
        _call(db, ADMIN, mock_api.wl_curricula_update, t["curriculum"]["id"], REQ, None, {"note": "แก้กลางเทอม"})
        assert _logs(db) == n + 1
        assert mock_api.wl_round_exported_refusal(_round(db, rid), mock_api.CURRENT_TERM) is None
        # ทาง ก. ยังส่งรอบนี้ซ้ำไม่ได้: เกณฑ์ · รายการรอบ · POST
        src = mock_api._wl_export_source(FakeCur(db, None), rid)
        assert any("ส่งซ้ำไม่ได้" in r for r in mock_api.wl_export_reasons(src, 2569, 2))
        listed = next(r for r in mock_api.terms_rounds() if r["id"] == rid)
        assert listed["usable"] is False and any("ส่งซ้ำไม่ได้" in r for r in listed["reasons"]), listed
        before, db_before = C._program_state(), C._db_snapshot(db)
        C._expect(lambda: C._post(ns.rnd), 409)
        assert C._program_state() == before and C._db_snapshot(db) == db_before
        # หน้าเทียบระหว่างแก้: กลุ่มกลับเป็นกำลังกรอก → ใช้ไม่ได้ (ไม่ใช่เพราะส่งแล้ว) · ตรวจผ่านครบ → ใช้ได้ เห็นข้อเปลี่ยนครู
        p, _log = _preview(db, rid)
        assert p["usable"] is False and p["reasons"] and not any("ส่ง" in r and "ซ้ำ" in r for r in p["reasons"]), p["reasons"]
        assert all("ยังไม่ตรวจผ่าน" in r for r in p["reasons"]), p["reasons"]
        for s in db.tables["wl_dept_status"]:
            s["status"] = "approved"
        p, _log = _preview(db, rid)
        assert p["usable"] is True and p["reasons"] == [], p["reasons"]
        assert p["round"]["amending_since"] is not None and p["round"]["exported_label"] == "2/2569", p["round"]
        assert [(it["pile"], it["group_id"], it["subject_id"]) for it in p["items"]] == [("teacher", 2, 901)], \
            [(it["pile"], it["label"]) for it in p["items"]]
        # ปิดรอบ → กลับเป็นปิด ตัวกันรอบที่ส่งแล้วกลับมา · หน้าเทียบยังใช้ได้และเหมือนเดิม
        closed = _close(db, rid)
        assert closed["amending_since"] is None and _round(db, rid)["status"] == "closed"
        c, d = _code(lambda: _call(db, HEAD, mock_api.wl_rows_update, row2["id"], REQ, {"note": "x"}))
        assert c == 409 and "ส่งเข้าโปรแกรมแล้ว" in d, (c, d)
        q, _log = _preview(db, rid)
        assert q["usable"] is True and q["round"]["amending_since"] is None and q["token"] == p["token"]
        assert q["items"] == p["items"]


class _RaceCur(FakeCur):
    """ด่านในโค้ดผ่าน แต่ดัชนี wl_rounds_one_open ของจริงชนตอน UPDATE (อีกคำขอเปิดรอบพร้อมกัน)"""

    def execute(self, sql, params=()):
        if " ".join(sql.split()).startswith("UPDATE wl_rounds SET status"):
            raise DbError("23505", "wl_rounds_one_open")
        return super().execute(sql, params)


def test_amend_refusals():
    with _program(), _running(NO_TERM):
        db, t, rnd = _scenario()                   # filling + ตรวจผ่าน
        rid = rnd["id"]
        for sess, want in ((ADMIN, 409), (HEAD, 403)):
            before = _state(db)
            c, d = _code(lambda: _amend(db, rid, sess))
            assert c == want and _thai(d) and _state(db) == before, (sess, c, d)
        c, d = _code(lambda: _amend(db, rid))
        assert "เปิดให้กลุ่มสาระกรอกอยู่" in d and "เฉพาะรอบที่ปิดแล้ว" in d, d
        c, d = _code(lambda: _amend(db, rid + 999))
        assert c == 404 and _thai(d), (c, d)
        _close(db, rid)
        # รอบอื่นที่ยังไม่ปิด → 409 บอกชื่อ
        other = db.add("wl_rounds", year=2570, semester=1, label="1/2570", status="preparing")
        before = _state(db)
        c, d = _code(lambda: _amend(db, rid))
        assert c == 409 and "1/2570" in d and _thai(d) and _state(db) == before, (c, d)
        db.tables["wl_rounds"] = [r for r in db.tables["wl_rounds"] if r is not other]
        # ไม่ใช่ภาคที่เปิดอยู่: เทอมปิด · เทอมอื่น active · ยังไม่เคยสร้างเทอมแต่หน้าตั้งค่าเป็นภาคอื่น/ว่าง
        for term, year, sem, word in ((CLOSED_2, "2569", "2", "ปิดแล้ว"), (ACTIVE_1, "2569", "1", "1/2569"),
                                      (NO_TERM, "2568", "1", "1/2568"), (NO_TERM, "", "", "ภาคเรียน")):
            with _running(term, year, sem):
                before = _state(db)
                c, d = _code(lambda: _amend(db, rid))
                assert c == 409 and word in d and _thai(d) and _state(db) == before, (term, c, d)
        # กดพร้อมกับการเปิดรอบอื่น: ดัชนีของจริงชน → 409 ไม่ใช่ 500
        before = _state(db)

        @contextlib.contextmanager
        def race():
            yield _RaceCur(db, ADMIN)
        with _patched(_wl_db=race):
            c, d = _code(lambda: mock_api.wl_rounds_amend(rid, REQ))
        assert c == 409 and _thai(d) and _state(db) == before, (c, d)
    # รอบกำลังเตรียม → 409
    with _program(), _running(NO_TERM):
        db2, _t2 = _rdb()
        r2 = _open(db2)
        c, d = _code(lambda: _amend(db2, r2["id"]))
        assert c == 409 and "กำลังเตรียม" in d, (c, d)


# ── หน้าเทียบ ─────────────────────────────────────────────────────────────
def _closed_round():
    db, t, rnd = _scenario()
    _close(db, rnd["id"])
    return db, t, rnd


def test_preview_writes_nothing_and_equals_plan_diff_of_live_state():
    with _program(), _running(NO_TERM):
        db, t, rnd = _closed_round()
        rid = rnd["id"]
        db_before, prog_before = _state(db), _snap()
        p, log = _preview(db, rid)
        lst, log2 = _run(db, mock_api.terms_plan_update_rounds)
        assert _state(db) == db_before and _snap() == prog_before
        assert all(s.split()[0].upper() == "SELECT" for s, _ in log + log2), [s for s, _ in log + log2]
        assert set(p) == PREVIEW_KEYS and set(p["round"]) == ROUND_KEYS, (set(p), set(p["round"]))
        assert p["round"] == {"id": rid, "label": "2/2569", "year": 2569, "semester": 2, "status": "closed",
                              "amending_since": None, "exported_label": None}, p["round"]
        # เท่ากับ plan_diff ที่ประกอบเองจากสถานะเดียวกัน (ของสด = _term_outgoing · live_proposal = wl_round_proposal ของของสด)
        cur = FakeCur(db, None)
        source = mock_api._wl_export_source(cur, rid)
        want = D.plan_diff(source, mock_api._term_outgoing(), mock_api.wl_round_proposal(mock_api._wl_timetable_source(cur)),
                           dict(mock_api._counters))
        assert (p["items"], p["unknown"], p["unmatched_sets"], p["token"]) == \
            (want["items"], want["unknown"], want["unmatched_sets"], want["token"])
        assert p["token"] == D.diff_token(p["items"]) and p["items"], p["items"]       # โลกเล็กนี้มีข้อ (ชุดคาบเสรีต่างกัน)
        assert p["usable"] is True and p["reasons"] == [], p["reasons"]
        assert lst == [{"id": rid, "label": "2/2569", "status": "closed", "amending_since": None, "exported_label": None,
                        "usable": True, "reasons": []}], lst


def test_midterm_build_reasons_include_registry_and_skipped():
    real = D.plan_diff

    def fake(*a):
        d = real(*a)
        d["registry"]["reasons"].append("เหตุของทะเบียน (ทดสอบ)")
        d["desired"]["report"]["skipped"].append({"source": "row", "ref": 1, "reason": "ห้องรหัส 999 ไม่มีในโปรแกรม"})
        return d
    with _program(), _running(NO_TERM):
        db, t, rnd = _closed_round()
        D.plan_diff = fake
        try:
            built = mock_api._midterm_build(FakeCur(db, None), rnd["id"])
            p, _log = _preview(db, rnd["id"])
        finally:
            D.plan_diff = real
        assert set(built) == {"round", "reasons", "diff"} and built["diff"]["token"] == p["token"]
        assert built["reasons"] == p["reasons"] and p["usable"] is False
        assert p["reasons"][0] == "เหตุของทะเบียน (ทดสอบ)", p["reasons"]
        assert len(p["reasons"]) == 2 and "แถวของรอบ 1 รายการ" in p["reasons"][1] and "ห้องรหัส 999" in p["reasons"][1]
        assert "อัปเดตแผน" in p["reasons"][1] and "เทอมใหม่" not in p["reasons"][1], p["reasons"][1]
        # ภาคไม่ตรงนำหน้าเหตุอื่น (wl_midterm_reasons ก่อน)
        with _running(ACTIVE_1):
            D.plan_diff = fake
            try:
                p, _log = _preview(db, rnd["id"])
            finally:
                D.plan_diff = real
        assert "1/2569" in p["reasons"][0] and len(p["reasons"]) == 3, p["reasons"]
    # ทาง ก. ไม่เปลี่ยนถ้อยคำ
    got = mock_api._term_skipped_reasons([{"source": "row", "ref": 1, "reason": "x"}])
    assert got == ["แถวของรอบ 1 รายการจะไม่ได้เข้าเทอมใหม่ จึงยังสร้างเทอมไม่ได้ (ไม่สร้างเทอมที่ขาดรายการเงียบ ๆ): x"], got


def test_empty_term_status_is_usable_closed_term_is_not():
    with _program():
        with _running(NO_TERM):
            db, t, rnd = _closed_round()
            rid = rnd["id"]
            db.add("wl_rounds", year=2569, semester=1, label="1/2569", status="closed")    # รอบของภาคอื่นไม่อยู่ในรายการ
            lst, _log = _run(db, mock_api.terms_plan_update_rounds)
            assert [(r["id"], r["usable"]) for r in lst] == [(rid, True)] and set(lst[0]) == LIST_KEYS, lst
            assert _preview(db, rid)[0]["usable"] is True
        with _running(ACTIVE_2, "2568", "1"):          # เทอม 2/2569 active (ไม่สนหน้าตั้งค่า)
            lst, _log = _run(db, mock_api.terms_plan_update_rounds)
            assert [(r["id"], r["usable"]) for r in lst] == [(rid, True)], lst
        with _running(CLOSED_2):                        # กำลังเปิดดูเทอมที่ปิด → ไม่มีภาคที่เปิดอยู่
            lst, _log = _run(db, mock_api.terms_plan_update_rounds)
            assert lst == [], lst
            p, _log = _preview(db, rid)
            assert p["usable"] is False and any("ภาคเรียนที่เปิดอยู่" in r for r in p["reasons"]), p["reasons"]
        with _running(ACTIVE_1):                        # รอบของภาคอื่น
            assert [r["label"] for r in _run(db, mock_api.terms_plan_update_rounds)[0]] == ["1/2569"]
            p, _log = _preview(db, rid)
            assert p["usable"] is False and "1/2569" in p["reasons"][0], p["reasons"]
        with _running(NO_TERM):
            # ไม่ได้ต่อฐาน = ไม่มีรอบ · หน้าเทียบ 503 · ข้อมูลของโรงเรียนยังโหลดไม่สำเร็จ → เหตุในรายการ / 503 · รหัสผิดรูป 400 · ไม่มี 404
            with _patched(_STORE_KIND="file"):
                assert mock_api.terms_plan_update_rounds() == []
                assert _code(lambda: mock_api.terms_plan_update_preview(str(rid)))[0] == 503
            with _patched(_DB_HAD_DATA=True, _STATE_SOURCE="seed"):
                lst, _log = _run(db, mock_api.terms_plan_update_rounds)
                assert lst[0]["usable"] is False and any("โหลดข้อมูลของโรงเรียน" in r for r in lst[0]["reasons"]), lst
                c, d = _code(lambda: _run(db, mock_api.terms_plan_update_preview, str(rid)))
                assert c == 503 and _thai(d), (c, d)
            for bad in (None, "", "abc", "-1", "1" * 19):
                c, d = _code(lambda: _run(db, mock_api.terms_plan_update_preview, bad))
                assert c == 400 and _thai(d), (bad, c, d)
            c, d = _code(lambda: _run(db, mock_api.terms_plan_update_preview, str(rid + 999)))
            assert c == 404 and _thai(d), (c, d)


def test_fresh_round_from_seed_data_preview_is_empty_in_every_pile():
    """ข้อมูลตั้งต้นทั้งชุด: ตั้งต้นหลักสูตรจากโปรแกรม → เปิดรอบ → ยืนยันทุกแถว → ปิด → หน้าเทียบว่างทุกกอง (เส้นเดียวกับ Step 5 ของจริง)"""
    db = FakeDb()
    with _running(NO_TERM), _patched(_STORE_KIND="postgres"):
        before = _snap()
        _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, {"year": 2569, "semester": 2, "source": "timetable"})
        rnd = _call(db, ADMIN, mock_api.wl_rounds_create, REQ, {"year": 2569, "semester": 2})
        for r in db.tables["wl_rows"] + db.tables["wl_option_teachers"]:
            r["confirmed"] = True
        _call(db, ADMIN, mock_api.wl_rounds_open, rnd["id"], REQ)
        _close(db, rnd["id"])
        t0 = time.perf_counter()
        p, _log = _preview(db, rnd["id"])
        ms = (time.perf_counter() - t0) * 1000
        assert (p["items"], p["unknown"], p["unmatched_sets"]) == ([], [], []), \
            ([(it["pile"], it["label"]) for it in p["items"]][:10], p["unknown"][:5], p["unmatched_sets"][:5])
        assert p["usable"] is True and p["reasons"] == [] and p["token"] == D.diff_token([]), p["reasons"]
        assert _snap() == before
        print(f"หน้าเทียบรอบที่เพิ่งเปิดจากข้อมูลตั้งต้น: ข้อ 0 · ไม่อยู่ในรอบ 0 · จับคู่ชุดไม่ได้ 0 · {ms:.0f} ms")


def test_new_code_never_writes_slots_or_parked():
    for fn in (mock_api.wl_rounds_amend, mock_api._term_running_identity, mock_api.wl_midterm_reasons,
               mock_api._midterm_build, mock_api.terms_plan_update_rounds, mock_api.terms_plan_update_preview):
        src = inspect.getsource(fn)
        for bad in ("SLOTS", "PARKED", "_sync_pool_slots", "REQUIREMENTS", "_save_state", "PLAN_TODOS"):
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
