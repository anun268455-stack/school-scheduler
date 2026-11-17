"""
ขั้นที่ 3 งานที่ 5: ปลดล็อกเทอมย้อนการส่งของรอบ (แบบข้อ 4.8) และรอบที่ส่งแล้วแก้ไม่ได้ถาวร (แบบข้อ 4.7)

ฐานข้อมูลปลอมชุดเดียวกับ wlexportcreate.py (ตาราง wl_* จาก _WL_SCHEMA + app_terms / app_state บนการเชื่อมต่อที่ COMMIT/ROLLBACK
ได้จริง) เพิ่มคำสั่งเปิดเทอมของการปลดล็อก · ส่งรอบด้วยทางจริง (POST /api/terms + round_id) แล้วปลดล็อกเทอมเดิมด้วย route จริง
ของจริง (Postgres · psql · ปุ่มดึงครู · ทุก route ผ่าน HTTP) ลองแยกในรายงาน
"""
import contextlib
import copy
import inspect
import re
import sys
from types import SimpleNamespace

import mock_api
from wlcurriculum import ADMIN, HEAD, REQ, FakeCur, _call, _code, _patched, _thai
from wlexportcreate import (ACTIVE5, ENV, PROGRAM, ROTATE_UPDATE, TermConn, TermCur, _db_snapshot, _elective_on_program,
                            _expect, _post, _program_state, _rich, _world, _writes)
from wlopen import SCHED_SUBJECTS, _wl_teacher

fails: list[str] = []

ACTIVATE = "UPDATE app_terms SET status = 'active', closed_at = NULL WHERE id = %s AND status = 'closed'"
TERMS_DDL = [" ".join(mock_api._TERMS_SCHEMA.split()), " ".join(mock_api._TERMS_ONE_ACTIVE.split())]
LOCK = ("SELECT pg_advisory_xact_lock(%s)", (mock_api.WL_REGISTRY_LOCK_KEY,))
WL_TABLES = ("wl_teachers", "wl_subjects", "wl_curriculum_lines", "wl_term_set_options", "wl_rounds")


# ── ฐานข้อมูลปลอม: คำสั่งเปิดเทอมของ _term_swap_active ────────────────────────────
class UnlockCur(TermCur):
    def execute(self, sql, params=()):
        s = " ".join(sql.split())
        if s == ACTIVATE:
            self.log.append((s, tuple(params)))
            hit = [t for t in self.db.terms if t["id"] == params[0] and t["status"] == "closed"]
            if any(t["status"] == "active" for t in self.db.terms):
                raise mock_api.HTTPException(599, "ของปลอม: app_terms_one_active")   # ดัชนี one-active ของจริง
            for t in hit:
                t["status"] = "active"
            self._out, self.rowcount = [], len(hit)
            return
        return super().execute(sql, params)


class UnlockConn(TermConn):
    def __init__(self, db):
        super().__init__(db)
        self.cur = UnlockCur(db, None)


@contextlib.contextmanager
def _unlockable(rec):
    """route ปลดล็อกอ่านแถว/ไฟล์ของเทอมจากฐานปลอมของ _world และเปิดการเชื่อมต่อที่รู้จักคำสั่งเปิดเทอม"""
    def row(i):
        return next(({k: t[k] for k in ("id", "year", "semester", "label", "status")}
                     for t in rec.db.terms if t["id"] == i), None)

    def connect():
        conn = UnlockConn(rec.db)
        rec.conns.append(conn)
        return conn
    with _patched(_term_row=row, _term_blob=lambda i: next((t["data"] for t in rec.db.terms if t["id"] == i), None),
                  _db_connect=connect):
        yield


def _wl(db):
    return {t: copy.deepcopy(db.tables[t]) for t in WL_TABLES}


def _richer():
    """_rich() + ทุกทางของค่าที่การส่งเปลี่ยน: ครูของเว็บที่ sched_id ห้อย (ชี้ครูที่โปรแกรมไม่มี → สร้างใหม่ old ≠ None) ·
    วิชาของเว็บที่ยังไม่ผูกแต่รหัสตรงวิชาของโปรแกรม (ผูกด้วยรหัส → subjects) — ต้องอยู่ใน _world(subjects=…)"""
    db, ns = _rich()
    stale = db.add("wl_teachers", sched_id=598, name="ครูรหัสห้อย", department_id=2)
    row = next(r for r in db.tables["wl_rows"] if r["teacher_id"] is not None and r["id"] != ns.t["lines"][0]["id"]
               and r["teacher_id"] != ns.new_t["id"])
    row["teacher_id"] = stale["id"]
    wl_sub = db.add("wl_subjects", sched_id=None, code="ง21101", name="การงานอาชีพ", department_id=8)
    line = _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
                 {"curriculum_id": ns.t["curriculum"]["id"], "code": "ง21101", "weekly": 1, "department_id": 8})
    for r in db.tables["wl_rows"]:
        if r["line_id"] == line["id"]:
            r.update(teacher_id=_wl_teacher(db, 501), confirmed=True)
    ns.stale, ns.wl_sub, ns.line2 = stale, wl_sub, line
    return db, ns


def _subjects_with_906():
    return _elective_on_program() + [{"id": 906, "code": "ง21101", "name": "การงานอาชีพ", "credits": 1,
                                      "is_activity": False, "department_id": 8}]


def _round_row(db, rid):
    return next(r for r in db.tables["wl_rounds"] if r["id"] == rid)


def _apply_sql(db, stmts):
    cur = FakeCur(db, None)
    for sql, params in stmts:
        cur.execute(sql, params)
    return cur


# ── ฟังก์ชันล้วน: คำสั่งย้อนการส่ง ─────────────────────────────────────────────────
def test_undo_sql_restores_every_recorded_value():
    # ส่งด้วยทางจริงแล้วรันคำสั่งย้อนบนฐานเดียวกัน → ทุกค่าที่การส่งเปลี่ยนกลับเป็นค่าก่อนส่ง (แถววิชาที่สร้างอยู่ต่อ sched_id ว่าง)
    with _world(subjects=_subjects_with_906()) as rec:
        db, ns = _richer()
        rec.use(db)
        before = _wl(db)
        rep = _post(ns.rnd)["report"]
        # ฉากครบทุกทาง: ครูใหม่ (old None) · ครูรหัสห้อย (old 598) · วิชาผูกด้วยรหัส · วิชาที่สร้าง · บรรทัด/ตัวเลือกที่ผูก
        assert {w["id"]: w["old"] for w in rep["teachers"]} == {ns.new_t["id"]: None, ns.stale["id"]: 598}, rep["teachers"]
        assert [(w["id"], w["old"], w["new"]) for w in rep["subjects"]] == [(ns.wl_sub["id"], None, 906)], rep["subjects"]
        assert rep["created_wl_subjects"] and rep["bound_lines"] and rep["bound_options"]
        assert rep["prior_status"] == "filling"
        stmts = mock_api.wl_export_undo_sql(rep, ns.rnd["id"])
        assert all(isinstance(q, str) and isinstance(p, tuple) for q, p in stmts)
        _apply_sql(db, stmts)
        after = _wl(db)
        created = set(rep["created_wl_subjects"])
        assert [r for r in after["wl_subjects"] if r["id"] in created] == \
               [dict(r, sched_id=None) for r in db.tables["wl_subjects"] if r["id"] in created]   # แถวอยู่ต่อ sched_id ว่าง
        assert all(r["sched_id"] is None for r in after["wl_subjects"] if r["id"] in created)
        assert [r for r in after["wl_subjects"] if r["id"] not in created] == before["wl_subjects"]
        for t in ("wl_teachers", "wl_curriculum_lines", "wl_term_set_options"):
            assert after[t] == before[t], t
        rnd_a = next(r for r in after["wl_rounds"] if r["id"] == ns.rnd["id"])
        rnd_b = next(r for r in before["wl_rounds"] if r["id"] == ns.rnd["id"])
        assert rnd_a == rnd_b, (rnd_a, rnd_b)                                  # filling · closed_at ว่าง · ไม่มีเครื่องหมาย
        assert rnd_a["status"] == "filling" and rnd_a["closed_at"] is None and rnd_a["exported_at"] is None
    # รอบที่ปิดก่อนส่ง: คืนเป็น closed และเวลาปิดเดิม · ทุกช่องของเครื่องหมายส่งแล้วว่าง
    rep = {"prior_status": "closed", "teachers": [], "subjects": [], "created_wl_subjects": [], "bound_lines": [],
           "bound_options": []}
    (sql, params), = mock_api.wl_export_undo_sql(rep, 7)
    assert sql.startswith("UPDATE wl_rounds SET ") and "closed_at" not in sql and params[0] == "closed", (sql, params)
    for col in ("exported_at", "exported_term_id", "exported_label", "export_report"):
        assert f"{col} = %s" in sql, col
    assert params[-1] == 7 and sql.endswith("WHERE id = %s AND exported_at IS NOT NULL") and params[1:-1] == (None,) * 4
    # รอบอื่นถือช่อง "เปิดได้ทีละรอบ" อยู่ (wl_rounds_one_open) → คืนเป็น closed แทน filling (ไม่งั้นปลดล็อกล้มทุกครั้ง)
    (sql, params), = mock_api.wl_export_undo_sql({**rep, "prior_status": "filling"}, 7, keep_closed=True)
    assert params[0] == "closed" and "closed_at" not in sql
    (sql, params), = mock_api.wl_export_undo_sql({**rep, "prior_status": "filling"}, 7)
    assert params[:2] == ("filling", None) and "closed_at = %s" in sql
    # คืนเฉพาะค่าที่การส่งเขียนไว้: ครูที่ sched_id ไม่ใช่ค่า "new" แล้ว (ไม่ใช่ของการส่ง) ไม่ถูกแตะ · ลำดับคืน UNIQUE ไม่ชนกันเอง
    db = mock_api_db()
    a = db.add("wl_teachers", sched_id=144, name="ก", department_id=1)        # ส่ง: 5 → 144
    b = db.add("wl_teachers", sched_id=5, name="ข", department_id=1)          # ส่ง: None → 5 (เลข 5 ของ ก ถูกปล่อยแล้ว)
    c = db.add("wl_teachers", sched_id=77, name="ค", department_id=1)         # ส่งเขียน 145 แต่ภายหลังเป็น 77 (ไม่ใช่ของเรา)
    rep2 = {**rep, "teachers": [{"id": a["id"], "old": 5, "new": 144}, {"id": b["id"], "old": None, "new": 5},
                                {"id": c["id"], "old": None, "new": 145}]}
    _apply_sql(db, mock_api.wl_export_undo_sql(rep2, 9))
    assert [(r["id"], r["sched_id"]) for r in db.tables["wl_teachers"]] == [(a["id"], 5), (b["id"], None), (c["id"], 77)]


def mock_api_db():
    from wlcurriculum import FakeDb
    return FakeDb()


# ── ปลดล็อกโดยไม่มีรอบที่ส่งเข้าเทอมนั้น: โค้ดเดิม ─────────────────────────────────
def test_unlock_without_export_is_unchanged():
    # เทอมที่เปิดอยู่สร้างด้วยปุ่มเดิม (ไม่มีรอบ exported_term_id = เทอมนั้น) → การสลับเทอมเป็นคำสั่งเดิมตรงตัวในการเชื่อมต่อของมันเอง
    # ไม่ถือล็อกทะเบียน ไม่แตะตาราง wl_* · คำตอบ ตัวแปร และบันทึกประวัติเหมือนก่อนงานนี้
    for other_round_exported in (False, True):
        with _world() as rec, _unlockable(rec):
            db, ns = _rich()
            rec.use(db)
            mock_api.create_term({"year": 2569, "semester": 2})            # ปุ่มเดิม → เทอม 16 active
            if other_round_exported:                                      # รอบของเทอมอื่นที่ส่งไปแล้วไม่เกี่ยว
                _round_row(db, ns.rnd["id"]).update(status="closed", exported_term_id=4, exported_label="1/2568",
                                                    exported_at=mock_api._dt.datetime.now(mock_api._dt.timezone.utc))
            wl_before, n_conns = _wl(db), len(rec.conns)
            del rec.logged[:]
            out = mock_api.unlock_term(5, {"confirm": "1/2569"})
            swap = rec.conns[n_conns:]
            assert len(swap) == 1, len(swap)
            log = swap[0].cur.log
            assert [s for s, _p in log] == TERMS_DDL + [ROTATE_UPDATE, ACTIVATE, "COMMIT"], [s for s, _p in log]
            assert log[2][1][1:] == (0, 16) and log[3][1] == (5,), (log[2][1][1:], log[3][1])
            assert _wl(db) == wl_before
            assert all(not _writes(lg) and not any("pg_advisory" in s for s, _p in lg) for lg in rec.wl_logs)
            assert set(out) == {"closed", "active", "save_error", "save_pending"}, set(out)
            assert out["closed"]["id"] == 16 and out["active"]["id"] == 5
            assert mock_api.CURRENT_TERM == ACTIVE5, mock_api.CURRENT_TERM
            assert rec.logged == [(16, "close", "ปิดเทอม 2/2569 (0 คาบ)"), (5, "unlock", "ปลดล็อกเทอม 1/2569")], rec.logged
    # ไม่มีแถว active (ทางเก็บเทอมแรก): ไม่มีเทอมที่จะถูกปิด จึงไม่ถามตารางของรอบเลย
    blank = {"id": None, "year": None, "semester": None, "label": None, "status": None}
    with _world(terms=({**ACTIVE5, "status": "closed"},), current=blank) as rec, _unlockable(rec):
        db, ns = _rich()
        rec.use(db)
        db.terms[0]["data"] = mock_api._pack(mock_api._snapshot())
        mock_api.SCHOOL_CONFIG.update({"term": "2", "year": "2569"})     # ตารางที่ลงอยู่ = 2/2569 (ยังไม่มีแถว)
        out = mock_api.unlock_term(5, {"confirm": "1/2569"})
        assert out["active"]["id"] == 5 and rec.wl_logs == [], rec.wl_logs
    # ทางเดิมยังผ่าน _term_swap_active แบบไม่ส่ง cursor (ตัวทดสอบเดิมของชั้นเทอมดูตรงนี้)
    src = inspect.getsource(mock_api.unlock_term)
    assert "closed_id = _term_swap_active(\n            old_id, old_blob, old_slots, term_id," in src


# ── ปลดล็อกเทอมที่สร้างจากรอบ: ย้อนการส่งในธุรกรรมเดียวกับการสลับเทอม ─────────────────────
def test_unlock_after_export_reverts_in_same_transaction():
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _richer()
        rec.use(db)
        wl_before = _wl(db)
        mem_before = _program_state()
        out = _post(ns.rnd)
        new_id = out["active"]["id"]
        rep = out["report"]
        n_conns = len(rec.conns)
        del rec.logged[:]
        res = mock_api.unlock_term(5, {"confirm": "1/2569"})
        assert len(rec.conns) == n_conns + 1, "ทั้งหมดในการเชื่อมต่อเดียว"
        conn = rec.conns[-1]
        log = conn.cur.log
        stmts = [s for s, _p in log]
        assert conn.commits == 1 and stmts.count("COMMIT") == 1 and stmts[-1] == "COMMIT", stmts
        # ล็อกทะเบียนเป็นคำสั่งแรก (addendum ข้อ 2) → ล็อกแถวรอบที่ส่งเข้าเทอมนี้ → สลับเทอม → ย้อน → ลบเครื่องหมาย → COMMIT
        assert log[0] == LOCK, log[0]
        assert log[1] == ("SELECT id, label, status, export_report FROM wl_rounds WHERE exported_term_id = %s FOR UPDATE",
                          (new_id,)), log[1]
        assert not any(s.split()[0].upper() in ("CREATE", "ALTER", "DROP", "LOCK") for s in stmts), stmts
        i_close, i_open = stmts.index(ROTATE_UPDATE), stmts.index(ACTIVATE)
        undo = [(q, p) for q, p in mock_api.wl_export_undo_sql(rep, ns.rnd["id"])]
        i_undo = stmts.index(undo[0][0])
        assert 1 < i_close < i_open < i_undo, stmts
        assert [(s, p) for s, p in log[i_undo:i_undo + len(undo)]] == [(" ".join(q.split()), p) for q, p in undo]
        assert log[i_close][1][2] == new_id and log[i_open][1] == (5,)
        # ฐาน: ทะเบียน หลักสูตร ตัวเลือก และรอบกลับเป็นค่าก่อนส่งทุกช่อง (วิชาที่สร้างอยู่ต่อ sched_id ว่าง)
        after = _wl(db)
        created = set(rep["created_wl_subjects"])
        for t in ("wl_teachers", "wl_curriculum_lines", "wl_term_set_options", "wl_rounds"):
            assert after[t] == wl_before[t], t
        assert [r for r in after["wl_subjects"] if r["id"] not in created] == wl_before["wl_subjects"]
        assert all(r["sched_id"] is None for r in after["wl_subjects"] if r["id"] in created) and created
        assert [(t["id"], t["status"]) for t in db.terms] == [(5, "active"), (new_id, "closed")]
        # หน่วยความจำ = เทอม 1/2569 ที่ปิดไว้ (ครู แผน หลักสูตร ทั้งก้อนจากไฟล์ของมัน) · คำตอบรูปเดิม
        mem = _program_state()
        for k in ("TEACHERS", "SUBJECTS", "REQUIREMENTS", "ELECTIVE_POOLS", "CURRICULA", "SLOTS", "CURRENT_TERM"):
            assert mem[k] == mem_before[k], k
        assert set(res) == {"closed", "active", "save_error", "save_pending"} and res["active"]["id"] == 5
        assert rec.logged == [(new_id, "close", "ปิดเทอม 2/2569 (0 คาบ)"),
                              (5, "unlock", "ปลดล็อกเทอม 1/2569 · ย้อนการส่งรอบอัตรากำลัง 2/2569")], rec.logged
        # ไม่มีแถวของเว็บชี้ครู/วิชาที่โปรแกรมไม่มี (นอกจากที่ห้อยอยู่ก่อนส่ง) · ปุ่มดึงครูจากโปรแกรมไม่สร้างแถวซ้ำ
        sched_t = {t["id"] for t in mock_api.TEACHERS}
        assert {r["sched_id"] for r in after["wl_teachers"] if r["sched_id"] is not None} - sched_t == {598}
        got = _call(db, ADMIN, mock_api.wl_teachers_import, REQ)
        assert got["created"] == 0, got
        assert len(db.tables["wl_teachers"]) == len(wl_before["wl_teachers"])
        # รอบกลับมาแก้ได้ตามสถานะเดิม (เครื่องหมายส่งแล้วหายจริง) — แก้หลักสูตรของภาคเรียนนั้นได้อีก
        _call(db, ADMIN, mock_api.wl_curriculum_lines_update, ns.line2["id"], REQ, None, {"name": "การงานอาชีพ ก"})


def test_unlock_revert_failure_restores_everything():
    # ล้มกลางธุรกรรม (หลังสลับเทอมและย้อนแล้ว ก่อน COMMIT) → ฐานย้อนทั้งก้อน · หน่วยความจำกลับเป็นเทอมที่สร้างจากรอบ · 500 ไทย
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _richer()
        rec.use(db)
        _post(ns.rnd)
        mem, snap = _program_state(), _db_snapshot(db)
        # ลบเครื่องหมายได้ 0 แถว (มีอีกคำขอย้อนไปก่อนระหว่างนี้) → ย้อนทั้งหมด
        real_sql = mock_api.wl_export_undo_sql

        def mark_gone(report, round_id, **kw):
            stmts = real_sql(report, round_id, **kw)
            q, p = stmts[-1]
            return stmts[:-1] + [(q, p[:-1] + (-1,))]
        del rec.logged[:]
        calls_before = list(rec.calls)
        with _patched(wl_export_undo_sql=mark_gone):
            _expect(lambda: mock_api.unlock_term(5, {"confirm": "1/2569"}), 500, "ข้อมูลเดิมยังอยู่ครบ")
        assert _db_snapshot(db) == snap
        after = _program_state()
        for k in PROGRAM:
            if k != "_counters":
                assert after[k] == mem[k], k
        # ตัวนับไม่ถอย: การคืนแบบทางเดิม (_apply_snapshot) ดันตัวนับขึ้นตามรหัสที่มีอยู่เสมอ (ไม่ออกรหัสซ้ำ)
        assert all(after["_counters"].get(k, 0) >= v for k, v in mem["_counters"].items()), after["_counters"]
        assert rec.conns[-1].commits == 0 and rec.logged == []
        assert not [c for c in rec.calls[len(calls_before):] if c[0] == "save"], rec.calls   # ไม่เซฟของที่ย้อนแล้ว
        # ลองใหม่ได้ผล
        mock_api.unlock_term(5, {"confirm": "1/2569"})
        assert _round_row(db, ns.rnd["id"])["exported_at"] is None


def test_unlock_revert_keeps_the_round_closed_when_another_round_is_open():
    # หลังส่ง เปิดรอบของภาคเรียนถัดไปแล้ว (เปิดได้ทีละรอบ) → รอบที่ย้อนกลับไปเป็น filling ไม่ได้ → คืนเป็น closed (เวลาปิดเดิม)
    with _world() as rec, _unlockable(rec):
        db, ns = _rich()
        rec.use(db)
        _post(ns.rnd)
        closed_at = _round_row(db, ns.rnd["id"])["closed_at"]
        db.add("wl_rounds", year=2570, semester=1, label="1/2570", status="preparing")
        mock_api.unlock_term(5, {"confirm": "1/2569"})
        r = _round_row(db, ns.rnd["id"])
        assert (r["status"], r["closed_at"], r["exported_at"], r["export_report"]) == ("closed", closed_at, None, None), r


# ── รอบที่ส่งแล้ว: ทุก route ที่เขียนรอบ/หลักสูตรของภาคเรียนนั้น → 409 ─────────────────────
_ROUTE_RE = re.compile(r'@app\.(post|put|delete)\("(/api/workload/[^"]+)"\)\s*\ndef (\w+)\(')
# route เขียนของเว็บลงอัตรากำลังที่ไม่ได้เขียนรอบหรือหลักสูตรของภาคเรียนใด (ทะเบียน · รหัส · ล็อกอิน)
_NOT_ROUND = {"wl_login", "wl_logout", "wl_setup", "wl_codes_create", "wl_codes_update", "wl_teachers_create",
              "wl_teachers_update", "wl_subjects_create", "wl_subjects_update", "wl_teachers_import", "wl_subjects_import"}


def test_exported_round_refuses_every_write_route():
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        _post(ns.rnd)
        rid, t = ns.rnd["id"], ns.t
        rnd = _round_row(db, rid)
        assert rnd["exported_at"] is not None and rnd["exported_label"] == "2/2569"
        row = next(r for r in db.tables["wl_rows"] if r["teacher_id"] is not None)
        dept = next(r["department_id"] for r in db.tables["wl_dept_status"] if r["round_id"] == rid)
        ot = next(r for r in db.tables["wl_option_teachers"] if r["round_id"] == rid)
        opt = t["option"]
        line = t["lines"][1]
        # route → (session, เรียกอย่างไร) — ทุกตัวต้อง 409 ข้อความเดียวกัน ไม่มีอะไรเปลี่ยนในฐาน
        y, s = 2569, 2
        calls = {
            "wl_rounds_cancel": (ADMIN, lambda: mock_api.wl_rounds_cancel(rid, REQ)),
            "wl_rounds_open": (ADMIN, lambda: mock_api.wl_rounds_open(rid, REQ)),
            "wl_rounds_close": (ADMIN, lambda: mock_api.wl_rounds_close(rid, REQ, {"confirm_label": "2/2569"})),
            "wl_rows_bulk": (ADMIN, lambda: mock_api.wl_rows_bulk(REQ, {"ids": [row["id"]], "set": {"confirmed": True}})),
            "wl_rows_update": (HEAD, lambda: mock_api.wl_rows_update(row["id"], REQ, {"note": "x"})),
            "wl_option_teachers_add": (ADMIN, lambda: mock_api.wl_option_teachers_add(
                opt["id"], REQ, {"teacher_id": _wl_teacher(db, 502)})),
            "wl_option_teachers_update": (ADMIN, lambda: mock_api.wl_option_teachers_update(ot["id"], REQ, {"note": "x"})),
            "wl_option_teachers_delete": (ADMIN, lambda: mock_api.wl_option_teachers_delete(ot["id"], REQ)),
            "wl_dept_submit": (HEAD, lambda: mock_api.wl_dept_submit(rid, 2, REQ)),
            "wl_dept_approve": (ADMIN, lambda: mock_api.wl_dept_approve(rid, dept, REQ)),
            "wl_dept_return": (ADMIN, lambda: mock_api.wl_dept_return(rid, dept, REQ, {"note": "แก้"})),
            "wl_curricula_seed": (ADMIN, lambda: mock_api.wl_curricula_seed(
                REQ, {"year": y, "semester": s, "source": "copy", "from_year": 2569, "from_semester": 1})),
            "wl_curricula_create": (ADMIN, lambda: mock_api.wl_curricula_create(
                REQ, {"year": y, "semester": s, "name": "ใหม่", "group_ids": [8]})),
            "wl_curricula_update": (ADMIN, lambda: mock_api.wl_curricula_update(t["curriculum"]["id"], REQ, None,
                                                                                {"note": "x"})),
            "wl_curricula_delete": (ADMIN, lambda: mock_api.wl_curricula_delete(t["curriculum"]["id"], REQ, "1", None)),
            "wl_curriculum_lines_create": (ADMIN, lambda: mock_api.wl_curriculum_lines_create(
                REQ, {"curriculum_id": t["curriculum"]["id"], "code": "ท21103", "weekly": 1})),
            "wl_curriculum_lines_update": (ADMIN, lambda: mock_api.wl_curriculum_lines_update(line["id"], REQ, None,
                                                                                              {"weekly": 4})),
            "wl_curriculum_lines_delete": (ADMIN, lambda: mock_api.wl_curriculum_lines_delete(line["id"], REQ, "1", None)),
            "wl_term_sets_create": (ADMIN, lambda: mock_api.wl_term_sets_create(
                REQ, {"year": y, "semester": s, "kind": "activity", "name": "ชุมนุม", "group_ids": [1], "weekly": 1})),
            "wl_term_sets_update": (ADMIN, lambda: mock_api.wl_term_sets_update(t["set"]["id"], REQ, None, {"weekly": 3})),
            "wl_term_sets_delete": (ADMIN, lambda: mock_api.wl_term_sets_delete(t["set"]["id"], REQ, "1", None)),
            "wl_term_set_options_create": (ADMIN, lambda: mock_api.wl_term_set_options_create(
                REQ, {"set_id": t["set"]["id"], "code": "พ21201"})),
            "wl_term_set_options_update": (ADMIN, lambda: mock_api.wl_term_set_options_update(opt["id"], REQ,
                                                                                              {"name": "ดนตรี ก"})),
            "wl_term_set_options_delete": (ADMIN, lambda: mock_api.wl_term_set_options_delete(opt["id"], REQ, "1", None)),
        }
        # เปิดรอบใหม่ของภาคเรียนเดียวกัน: UNIQUE (year, semester) ปฏิเสธอยู่แล้ว (ข้อความเดิม "มีรอบแล้ว")
        already = {"wl_rounds_create": (ADMIN, lambda: mock_api.wl_rounds_create(REQ, {"year": y, "semester": s}))}
        src = inspect.getsource(mock_api)
        routes = {fn for _m, _p, fn in _ROUTE_RE.findall(src)}
        assert routes, "อ่าน route จากซอร์สไม่ได้"
        missing = routes - set(calls) - set(already) - _NOT_ROUND
        assert not missing, f"route เขียนของเว็บลงอัตรากำลังที่ตัวทดสอบนี้ยังไม่ครอบ: {sorted(missing)}"
        assert not (set(calls) | set(already) | _NOT_ROUND) - routes, "ชื่อ route ในตารางไม่มีจริง"
        want = "รอบนี้ส่งเข้าโปรแกรมแล้ว (เทอม 2/2569) แก้ไม่ได้"
        for name, (sess, fn) in calls.items():
            snap = copy.deepcopy(db.tables)
            code, detail = _code(lambda: _call(db, sess, fn))
            assert code == 409 and isinstance(detail, str) and detail.startswith(want), (name, code, detail)
            assert db.tables == snap, name
        for name, (sess, fn) in already.items():
            snap = copy.deepcopy(db.tables)
            code, detail = _code(lambda: _call(db, sess, fn))
            assert code == 409 and _thai(detail), (name, code, detail)
            assert db.tables == snap, name
        # ทุก route ผ่านตัวตรวจร่วม (ฟังก์ชันล้วน) ตัวเดียว
        assert mock_api.wl_round_exported_refusal({"exported_at": None, "exported_label": None}) is None
        assert mock_api.wl_round_exported_refusal(rnd).startswith(want)
        # รอบที่ยังไม่ส่ง (ปิดแล้วธรรมดา) ยังได้ข้อความเดิมของรอบปิด
        _round_row(db, rid).update(exported_at=None, exported_term_id=None, exported_label=None)   # _call คืนสำเนาเมื่อล้ม
        code, detail = _code(lambda: _call(db, ADMIN, calls["wl_curricula_update"][1]))
        assert code == 409 and "ปิดแล้ว" in detail and "ส่งเข้าโปรแกรม" not in detail, detail


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
