"""
ขั้นที่ 3 งานที่ 5: ปลดล็อกเทอม — ทะเบียนของเว็บตามเทอมที่เปิดอยู่ทั้งสองทิศ (แบบข้อ 4.8 ตามคำตัดสินแก้รอบ 1) และรอบที่ส่งแล้ว/
ย้อนแล้วแก้ไม่ได้ (แบบข้อ 4.7): ปลดล็อกเทอมเก่า = ย้อนการส่ง (รอบยังปิด เก็บรายงาน) · ปลดล็อกเทอมที่สร้างจากรอบกลับมา = ผูกกลับ

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


NOW_AT = "2026-11-17T09:00:00+07:00"
UNDONE_MSG = "แผนของรอบนี้อยู่ในเทอม 2/2569 ที่ถูกปิดไว้ — ปลดล็อกเทอมนั้นเพื่อใช้ต่อ"
EXPORTED_MSG = "รอบนี้ส่งเข้าโปรแกรมแล้ว (เทอม 2/2569) แก้ไม่ได้"


def _without(d, *keys):
    return {k: v for k, v in d.items() if k not in keys}


def _exported(rec, subjects=None, richer=True):
    """ฉากครบทุกทาง → ส่งรอบด้วยทางจริง → (db, ns) · ns.before = ทะเบียน/หลักสูตร/รอบก่อนส่ง · ns.after = หลังส่ง · ns.rep · ns.new_id"""
    db, ns = (_richer() if richer else _rich())
    rec.use(db)
    ns.before = _wl(db)
    out = _post(ns.rnd)
    ns.rep, ns.new_id, ns.after = out["report"], out["active"]["id"], _wl(db)
    return db, ns


def _rows_of(snap, table):
    return {r["id"]: r for r in snap[table]}


# ── ฟังก์ชันล้วน: คำสั่งย้อน / ผูกกลับ ───────────────────────────────────────────────
def test_undo_sql_restores_every_recorded_value():
    # ส่งด้วยทางจริงแล้วรันคำสั่งย้อนบนฐานเดียวกัน → ทะเบียน บรรทัด ตัวเลือก กลับเป็นค่าก่อนส่ง (แถววิชาที่สร้างอยู่ต่อ sched_id ว่าง)
    # รอบ: ยังปิด (สถานะ/เวลาปิดของการส่ง) · ลบแค่ exported_at · เก็บเทอม ชื่อเทอม รายงาน + บันทึก "ย้อนแล้ว" (ค่าที่ต้องใช้ผูกกลับ)
    with _world(subjects=_subjects_with_906()) as rec:
        db, ns = _exported(rec)
        rep = ns.rep
        assert {w["id"]: w["old"] for w in rep["teachers"]} == {ns.new_t["id"]: None, ns.stale["id"]: 598}, rep["teachers"]
        assert [(w["id"], w["old"], w["new"]) for w in rep["subjects"]] == [(ns.wl_sub["id"], None, 906)], rep["subjects"]
        assert rep["created_wl_subjects"] and rep["bound_lines"] and rep["bound_options"]
        now = mock_api._wl_export_now(FakeCur(db, None), rep)
        stmts = mock_api.wl_export_undo_sql(rep, ns.rnd["id"], now, NOW_AT)
        assert all(isinstance(q, str) and isinstance(p, tuple) for q, p in stmts)
        _apply_sql(db, stmts)
        after = _wl(db)
        created = set(rep["created_wl_subjects"])
        for t in ("wl_teachers", "wl_curriculum_lines", "wl_term_set_options"):
            assert after[t] == ns.before[t], t
        assert [r for r in after["wl_subjects"] if r["id"] not in created] == ns.before["wl_subjects"]
        assert [r["sched_id"] for r in after["wl_subjects"] if r["id"] in created] == [None] * len(created)
        r_exp, r_now = _rows_of(ns.after, "wl_rounds")[ns.rnd["id"]], _rows_of(after, "wl_rounds")[ns.rnd["id"]]
        assert _without(r_now, "exported_at", "export_report") == _without(r_exp, "exported_at", "export_report")
        assert r_now["status"] == "closed" and r_now["closed_at"] is not None and r_now["exported_at"] is None
        assert (r_now["exported_term_id"], r_now["exported_label"]) == (ns.new_id, "2/2569")
        undone = r_now["export_report"].pop("undone")
        assert r_now["export_report"] == rep, "รายงานเดิมอยู่ครบ"
        assert undone["at"] == NOW_AT
        assert undone["created"] == [[i, r["sched_id"]] for i, r in sorted(_rows_of(ns.after, "wl_subjects").items())
                                     if i in created]
        assert undone["lines"] == [[i, _rows_of(ns.after, "wl_curriculum_lines")[i]["subject_id"]]
                                   for i in sorted(rep["bound_lines"])]
        assert undone["options"] == [[i, _rows_of(ns.after, "wl_term_set_options")[i]["subject_id"]]
                                     for i in sorted(rep["bound_options"])]
    # คืนเฉพาะค่าที่การส่งเขียนไว้ · ลำดับคืน UNIQUE ไม่ชนกันเอง (ก. 5→144 · ข. ว่าง→5 · ค. ไม่ใช่ของเรา)
    from wlcurriculum import FakeDb
    db = FakeDb()
    a = db.add("wl_teachers", sched_id=144, name="ก", department_id=1)
    b = db.add("wl_teachers", sched_id=5, name="ข", department_id=1)
    c = db.add("wl_teachers", sched_id=77, name="ค", department_id=1)
    db.add("wl_rounds", year=2569, semester=2, label="2/2569", status="closed", exported_term_id=3,
           exported_label="2/2569", exported_at=mock_api._dt.datetime(2026, 11, 1, tzinfo=mock_api._dt.timezone.utc))
    rep2 = {"prior_status": "filling", "subjects": [], "created_wl_subjects": [], "bound_lines": [], "bound_options": [],
            "teachers": [{"id": a["id"], "old": 5, "new": 144}, {"id": b["id"], "old": None, "new": 5},
                         {"id": c["id"], "old": None, "new": 145}]}
    _apply_sql(db, mock_api.wl_export_undo_sql(rep2, 1, mock_api._wl_export_now(FakeCur(db, None), rep2), NOW_AT))
    assert [(r["id"], r["sched_id"]) for r in db.tables["wl_teachers"]] == [(a["id"], 5), (b["id"], None), (c["id"], 77)]
    assert db.tables["wl_rounds"][0]["status"] == "closed" and db.tables["wl_rounds"][0]["exported_at"] is None
    # ผูกกลับบนฐานเดียวกัน: สลับเลขกลับได้โดยไม่ชน UNIQUE · ค. (ไม่ใช่ค่าที่การย้อนทิ้งไว้) ถูกข้ามพร้อมเหตุ
    rep3 = db.tables["wl_rounds"][0]["export_report"]
    stmts, notes = mock_api.wl_export_redo_sql(rep3, 1, mock_api._wl_export_now(FakeCur(db, None), rep3), {5, 144, 145}, set())
    _apply_sql(db, stmts)
    assert [(r["id"], r["sched_id"]) for r in db.tables["wl_teachers"]] == [(a["id"], 144), (b["id"], 5), (c["id"], 77)]
    assert len(notes) == 1 and "ครู ค" in notes[0] and _thai(notes[0]), notes
    assert db.tables["wl_rounds"][0]["exported_at"] is not None and "undone" not in db.tables["wl_rounds"][0]["export_report"]


# ── ปลดล็อกโดยไม่มีรอบที่ส่งเข้าเทอมนั้น: โค้ดเดิม ─────────────────────────────────
def test_unlock_without_export_is_unchanged():
    # เทอมที่เปิดอยู่สร้างด้วยปุ่มเดิม (ไม่มีรอบที่ผูกกับเทอมที่ปิดหรือเทอมที่เปิด) → การสลับเทอมเป็นคำสั่งเดิมตรงตัวในการเชื่อมต่อของมันเอง
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
            assert rec.wl_logs[-1] == [("SELECT id FROM wl_rounds WHERE exported_term_id = ANY(%s)", ([16, 5],))]
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


# ── ปลดล็อกเทอมเก่า: ย้อนการส่งในธุรกรรมเดียวกับการสลับเทอม ────────────────────────────
def test_unlock_after_export_reverts_in_same_transaction():
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _richer()
        rec.use(db)
        wl_before, mem_before = _wl(db), _program_state()
        out = _post(ns.rnd)
        new_id, rep = out["active"]["id"], out["report"]
        exported = _wl(db)
        n_conns = len(rec.conns)
        del rec.logged[:]
        res = mock_api.unlock_term(5, {"confirm": "1/2569"})
        assert len(rec.conns) == n_conns + 1, "ทั้งหมดในการเชื่อมต่อเดียว"
        conn = rec.conns[-1]
        log = conn.cur.log
        stmts = [s for s, _p in log]
        assert conn.commits == 1 and stmts.count("COMMIT") == 1 and stmts[-1] == "COMMIT", stmts
        # ล็อกทะเบียนเป็นคำสั่งแรก → ล็อกแถวรอบที่ผูกกับสองเทอม → สลับเทอม → ย้อน → ลบเครื่องหมาย (คำสั่งเขียนสุดท้าย) → COMMIT
        assert log[0] == LOCK, log[0]
        assert log[1] == ("SELECT id, label, exported_at, exported_term_id, export_report FROM wl_rounds "
                          "WHERE exported_term_id = ANY(%s) FOR UPDATE", ([new_id, 5],)), log[1]
        assert not any(s.split()[0].upper() in ("CREATE", "ALTER", "DROP", "LOCK") for s in stmts), stmts
        i_close, i_open = stmts.index(ROTATE_UPDATE), stmts.index(ACTIVATE)
        i_undo = next(i for i, s in enumerate(stmts) if s.startswith("UPDATE wl_"))
        assert 1 < i_close < i_open < i_undo, stmts
        writes = [s for s in stmts if s.split()[0] == "UPDATE"]
        assert writes[-1] == "UPDATE wl_rounds SET exported_at = %s, export_report = %s::jsonb " \
                             "WHERE id = %s AND exported_at IS NOT NULL", writes[-1]
        assert log[i_close][1][2] == new_id and log[i_open][1] == (5,)
        # ฐาน: ทะเบียน หลักสูตร ตัวเลือก = ก่อนส่ง (วิชาที่สร้างอยู่ต่อ sched_id ว่าง) · รอบ = ยังปิด เก็บรายงาน ลบแค่ exported_at
        after = _wl(db)
        created = set(rep["created_wl_subjects"])
        for t in ("wl_teachers", "wl_curriculum_lines", "wl_term_set_options"):
            assert after[t] == wl_before[t], t
        assert [r for r in after["wl_subjects"] if r["id"] not in created] == wl_before["wl_subjects"]
        assert all(r["sched_id"] is None for r in after["wl_subjects"] if r["id"] in created) and created
        r_exp, r_now = _rows_of(exported, "wl_rounds")[ns.rnd["id"]], _rows_of(after, "wl_rounds")[ns.rnd["id"]]
        assert _without(r_now, "exported_at", "export_report") == _without(r_exp, "exported_at", "export_report")
        assert r_now["exported_at"] is None and "undone" in r_now["export_report"]
        assert [(t["id"], t["status"]) for t in db.terms] == [(5, "active"), (new_id, "closed")]
        # หน่วยความจำ = เทอม 1/2569 ที่ปิดไว้ · คำตอบ = รูปเดิม + ข้อความของรอบ (m5)
        mem = _program_state()
        for k in ("TEACHERS", "SUBJECTS", "REQUIREMENTS", "ELECTIVE_POOLS", "CURRICULA", "SLOTS", "CURRENT_TERM"):
            assert mem[k] == mem_before[k], k
        assert set(res) == {"closed", "active", "save_error", "save_pending", "workload"} and res["active"]["id"] == 5
        (note,) = res["workload"]
        assert "ย้อนการส่งรอบอัตรากำลัง 2/2569" in note and "รอบยังปิดอยู่" in note and UNDONE_MSG in note, note
        assert rec.logged == [(new_id, "close", "ปิดเทอม 2/2569 (0 คาบ)"),
                              (5, "unlock", "ปลดล็อกเทอม 1/2569 · ย้อนการส่งรอบอัตรากำลัง 2/2569 (รอบยังปิดอยู่)")], rec.logged
        # ไม่มีแถวของเว็บชี้ครูที่โปรแกรมไม่มี (นอกจากที่ห้อยอยู่ก่อนส่ง) · ปุ่มดึงครูจากโปรแกรมไม่สร้างแถวซ้ำ
        sched_t = {t["id"] for t in mock_api.TEACHERS}
        assert {r["sched_id"] for r in after["wl_teachers"] if r["sched_id"] is not None} - sched_t == {598}
        got = _call(db, ADMIN, mock_api.wl_teachers_import, REQ)
        assert got["created"] == 0 and len(db.tables["wl_teachers"]) == len(wl_before["wl_teachers"]), got
        # รอบแก้ไม่ได้ (ทางตันที่หลอกผู้ใช้ — คำตัดสินแก้รอบ 1) · บอกให้ปลดล็อกเทอมที่ถือแผนของรอบ
        code, detail = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_update, ns.line2["id"], REQ, None,
                                           {"name": "การงานอาชีพ ก"}))
        assert code == 409 and detail.startswith(UNDONE_MSG), (code, detail)


def test_reopening_the_round_term_puts_the_registry_back_and_cycles():
    # ย้อน → ปลดล็อกเทอม 2/2569 กลับ (ผูกกลับ) → ทะเบียน/การผูก/exported_at = หลังส่งตรงตัว · ย้อนอีกครั้ง = ก่อนส่ง · ผูกกลับอีกครั้ง = หลังส่ง
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        for cycle in range(2):
            mock_api.unlock_term(5, {"confirm": "1/2569"})                     # ย้อน
            now = _wl(db)
            for t in ("wl_teachers", "wl_curriculum_lines", "wl_term_set_options"):
                assert now[t] == ns.before[t], (cycle, t)
            n_conns = len(rec.conns)
            del rec.logged[:]
            res = mock_api.unlock_term(ns.new_id, {"confirm": "2/2569"})        # ผูกกลับ
            conn = rec.conns[-1]
            assert len(rec.conns) == n_conns + 1 and conn.commits == 1 and conn.cur.log[0] == LOCK, cycle
            assert not any(s.split()[0].upper() in ("CREATE", "ALTER") for s, _p in conn.cur.log)
            now = _wl(db)
            for t in ("wl_teachers", "wl_subjects", "wl_curriculum_lines", "wl_term_set_options"):
                assert now[t] == ns.after[t], (cycle, t)
            r_exp, r_now = _rows_of(ns.after, "wl_rounds")[ns.rnd["id"]], _rows_of(now, "wl_rounds")[ns.rnd["id"]]
            assert _without(r_now, "exported_at") == _without(r_exp, "exported_at"), (cycle, r_now)   # รายงานเดิม ไม่มี "undone"
            assert r_now["exported_at"] is not None
            # ทะเบียนตรงกับเทอมที่เปิด (ครูของเว็บชี้ครูที่โปรแกรมมีเท่านั้น) · ปุ่มดึงครูไม่สร้างแถวซ้ำ
            sched_t = {t["id"] for t in mock_api.TEACHERS}
            assert {r["sched_id"] for r in now["wl_teachers"] if r["sched_id"] is not None} <= sched_t
            assert _call(db, ADMIN, mock_api.wl_teachers_import, REQ)["created"] == 0
            assert _call(db, ADMIN, mock_api.wl_subjects_import, REQ)["created"] == 0
            (note,) = res["workload"]
            assert "ผูกทะเบียน" in note and "รอบอัตรากำลัง 2/2569" in note and "ข้าม" not in note, note
            assert rec.logged[-1] == (ns.new_id, "unlock", "ปลดล็อกเทอม 2/2569 · ผูกทะเบียนตามรอบอัตรากำลัง 2/2569 อีกครั้ง")
            # รอบกลับเป็น "ส่งแล้ว" — route เขียนได้ 409 ข้อความของรอบที่ส่งแล้ว
            code, detail = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_update, ns.line2["id"], REQ, None,
                                               {"name": "x"}))
            assert code == 409 and detail.startswith(EXPORTED_MSG), (code, detail)


def test_reopening_skips_what_others_changed_and_says_so():
    # ระหว่างย้อนกับผูกกลับ: มีแถวอื่นในทะเบียนถือรหัสครูใหม่ไปแล้ว และครูรหัสห้อยถูกแก้รหัสไปแล้ว → สองรายการนั้นข้าม (ไม่ชน UNIQUE
    # ไม่ทับ) พร้อมเหตุไทยในคำตอบ · ที่เหลือผูกกลับครบ · รอบกลับเป็นส่งแล้ว
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        new_sched = next(w["new"] for w in ns.rep["teachers"] if w["id"] == ns.new_t["id"])
        mock_api.unlock_term(5, {"confirm": "1/2569"})
        taker = db.add("wl_teachers", sched_id=new_sched, name="ครูที่ผูกรหัสนั้นไปก่อน", department_id=1)
        next(r for r in db.tables["wl_teachers"] if r["id"] == ns.stale["id"])["sched_id"] = 597
        res = mock_api.unlock_term(ns.new_id, {"confirm": "2/2569"})
        now = _rows_of(_wl(db), "wl_teachers")
        assert now[ns.new_t["id"]]["sched_id"] is None and now[taker["id"]]["sched_id"] == new_sched
        assert now[ns.stale["id"]]["sched_id"] == 597
        for t in ("wl_subjects", "wl_curriculum_lines", "wl_term_set_options"):
            assert _wl(db)[t] == ns.after[t], t
        assert _round_row(db, ns.rnd["id"])["exported_at"] is not None
        (note,) = res["workload"]
        assert "ข้าม 2 รายการ" in note and "ครูใหม่" in note and "ครูที่ผูกรหัสนั้นไปก่อน" in note and "ครูรหัสห้อย" in note, note


def test_unlock_revert_failure_restores_everything():
    # ล้มกลางธุรกรรม (หลังสลับเทอมและย้อนแล้ว ก่อน COMMIT) → ฐานย้อนทั้งก้อน · หน่วยความจำกลับเป็นเทอมที่สร้างจากรอบ · 500 ไทย
    # m4: คำขอเขียนอื่นจบระหว่างนั้น (รุ่นขยับ) → เซฟของที่คืนแล้วทับ + บวกรุ่น (แบบ _term_restore)
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        mem, snap = _program_state(), _db_snapshot(db)
        real_sql, real_swap = mock_api.wl_export_undo_sql, mock_api._term_swap_active

        def mark_gone(report, round_id, now, at):
            stmts = real_sql(report, round_id, now, at)
            q, p = stmts[-1]
            return stmts[:-1] + [(q, p[:-1] + (-1,))]          # ลบเครื่องหมายได้ 0 แถว (มีอีกคำขอย้อนไปก่อน)
        for concurrent in (False, True):
            def swap(*a, **kw):
                if concurrent:
                    mock_api.REVISION["n"] += 1                # = มิดเดิลแวร์ของคำขอเขียนอื่นที่จบระหว่างนั้น
                return real_swap(*a, **kw)
            del rec.logged[:]
            calls_before, rev = list(rec.calls), mock_api.REVISION["n"]
            with _patched(wl_export_undo_sql=mark_gone, _term_swap_active=swap):
                _expect(lambda: mock_api.unlock_term(5, {"confirm": "1/2569"}), 500, "ข้อมูลเดิมยังอยู่ครบ")
            assert _db_snapshot(db) == snap
            after = _program_state()
            for k in PROGRAM:
                if k not in ("_counters", "REVISION"):
                    assert after[k] == mem[k], (concurrent, k)
            # ตัวนับไม่ถอย: การคืนแบบทางเดิม (_apply_snapshot) ดันตัวนับขึ้นตามรหัสที่มีอยู่เสมอ (ไม่ออกรหัสซ้ำ)
            assert all(after["_counters"].get(k, 0) >= v for k, v in mem["_counters"].items()), after["_counters"]
            assert rec.conns[-1].commits == 0 and rec.logged == []
            saves = [c for c in rec.calls[len(calls_before):] if c[0] == "save"]
            assert saves == ([("save", saves[0][1])] if concurrent else []), (concurrent, rec.calls)
            assert mock_api.REVISION["n"] == rev + (2 if concurrent else 0), (concurrent, mock_api.REVISION)
        # ลองใหม่ได้ผล
        mock_api.unlock_term(5, {"confirm": "1/2569"})
        assert _round_row(db, ns.rnd["id"])["exported_at"] is None


def test_unlock_records_the_running_term_after_the_registry_lock():
    # m2: ค่าที่ใช้คืน/บันทึก (CURRENT_TERM · จำนวนคาบ · ปี/ภาคในการตั้งค่า) จดหลังได้ล็อกทะเบียน — ครูลงคาบระหว่างรอ
    # ต้องนับในแถวเทอมที่ปิดและบันทึกประวัติ ตรงกับคาบในไฟล์ของมัน
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        real = mock_api._wl_registry_lock

        def lock_after_a_lesson(cur):
            mock_api.SLOTS.append({"id": 99, "group_id": 1, "day": 1, "period": 2})
            return real(cur)
        del rec.logged[:]
        with _patched(_wl_registry_lock=lock_after_a_lesson):
            mock_api.unlock_term(5, {"confirm": "1/2569"})
        close = next(p for s, p in rec.conns[-1].cur.log if s == ROTATE_UPDATE)
        assert close[1] == 1 and len(mock_api._unpack(close[0])["slots"]) == 1, close[1:]
        assert rec.logged[0] == (ns.new_id, "close", "ปิดเทอม 2/2569 (1 คาบ)"), rec.logged


def test_undone_round_cannot_be_sent_again():
    # รอบที่ย้อนแล้ว: รายการรอบ หน้าดูก่อนสร้าง และการสร้างจริง บอกเหตุเดียวกัน (ปลดล็อกเทอมที่ถือแผนของรอบ) — ไม่ใช่ "ใช้ได้"
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        mock_api.unlock_term(5, {"confirm": "1/2569"})
        rnd = mock_api._wl_get(FakeCur(db, None), "wl_rounds", mock_api._WL_EXPORT_ROUND_COLS, ns.rnd["id"], "x")
        reasons = mock_api.wl_export_reasons({"round": rnd}, 2569, 2)
        assert any(UNDONE_MSG in r for r in reasons), reasons
        (r,) = [x for x in mock_api.terms_rounds() if x["id"] == ns.rnd["id"]]
        assert r["usable"] is False and any(UNDONE_MSG in x for x in r["reasons"]), r
        pv = mock_api.terms_preview(round_id=str(ns.rnd["id"]))["round"]
        assert pv["usable"] is False and any(UNDONE_MSG in x for x in pv["reasons"]), pv["reasons"]
        # ยิงตรง: ขั้น 1 ของการสร้างปฏิเสธก่อนอ่านรอบ (เทอม 2/2569 ยังมีแถว — ข้อความเดิมของ Task 4) · ไม่มีอะไรถูกสร้าง/เปลี่ยน
        before = _db_snapshot(db)
        d = _expect(lambda: _post(ns.rnd), 409, "มีเทอม 2/2569")
        assert _db_snapshot(db) == before, d


# ── รอบที่ส่งแล้ว / ย้อนแล้ว: ทุก route ที่เขียนรอบ/หลักสูตรของภาคเรียนนั้น → 409 ─────────────────
_ROUTE_RE = re.compile(r'@app\.(post|put|delete)\("(/api/workload/[^"]+)"\)\s*\ndef (\w+)\(')
# route เขียนของเว็บลงอัตรากำลังที่ไม่ได้เขียนรอบหรือหลักสูตรของภาคเรียนใด (ทะเบียน · รหัส · ล็อกอิน)
_NOT_ROUND = {"wl_login", "wl_logout", "wl_setup", "wl_codes_create", "wl_codes_update", "wl_teachers_create",
              "wl_teachers_update", "wl_subjects_create", "wl_subjects_update", "wl_teachers_import", "wl_subjects_import"}


def _route_calls(db, ns):
    rid, t = ns.rnd["id"], ns.t
    row = next(r for r in db.tables["wl_rows"] if r["teacher_id"] is not None)
    dept = next(r["department_id"] for r in db.tables["wl_dept_status"] if r["round_id"] == rid)
    ot = next(r for r in db.tables["wl_option_teachers"] if r["round_id"] == rid)
    opt, line, y, s = t["option"], t["lines"][1], 2569, 2
    return {
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
        "wl_curricula_update": (ADMIN, lambda: mock_api.wl_curricula_update(t["curriculum"]["id"], REQ, None, {"note": "x"})),
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


def test_exported_round_refuses_every_write_route():
    # ส่งแล้ว (ข้อความ "ส่งเข้าโปรแกรมแล้ว") และย้อนแล้ว (ข้อความ "แผนของรอบนี้อยู่ในเทอม … ที่ถูกปิดไว้") — ทุก route เขียนของรอบ
    # และหลักสูตรของภาคเรียนนั้น 409 ข้อความเดียวกันทุกตัว ไม่มีอะไรเปลี่ยนในฐาน
    for undone, want in ((False, EXPORTED_MSG), (True, UNDONE_MSG)):
        with _world() as rec, _unlockable(rec):
            db, ns = _exported(rec, richer=False)
            if undone:
                mock_api.unlock_term(5, {"confirm": "1/2569"})
            rnd = _round_row(db, ns.rnd["id"])
            assert (rnd["exported_at"] is None) == undone and rnd["exported_label"] == "2/2569"
            calls = _route_calls(db, ns)
            # เปิดรอบใหม่ของภาคเรียนเดียวกัน: UNIQUE (year, semester) ปฏิเสธอยู่แล้ว (ข้อความเดิม "มีรอบแล้ว")
            already = {"wl_rounds_create": (ADMIN, lambda: mock_api.wl_rounds_create(REQ, {"year": 2569, "semester": 2}))}
            routes = {fn for _m, _p, fn in _ROUTE_RE.findall(inspect.getsource(mock_api))}
            assert routes, "อ่าน route จากซอร์สไม่ได้"
            missing = routes - set(calls) - set(already) - _NOT_ROUND
            assert not missing, f"route เขียนของเว็บลงอัตรากำลังที่ตัวทดสอบนี้ยังไม่ครอบ: {sorted(missing)}"
            assert not (set(calls) | set(already) | _NOT_ROUND) - routes, "ชื่อ route ในตารางไม่มีจริง"
            for name, (sess, fn) in {**calls, **already}.items():
                snap = copy.deepcopy(db.tables)
                code, detail = _code(lambda: _call(db, sess, fn))
                assert code == 409 and isinstance(detail, str) and _thai(detail), (undone, name, code, detail)
                if name in calls:
                    assert detail.startswith(want), (undone, name, detail)
                assert db.tables == snap, (undone, name)
            # ทุก route ผ่านตัวตรวจร่วม (ฟังก์ชันล้วน) ตัวเดียว
            assert mock_api.wl_round_exported_refusal(_round_row(db, ns.rnd["id"])).startswith(want)
    assert mock_api.wl_round_exported_refusal({"exported_at": None, "exported_term_id": None}) is None
    # รอบที่ยังไม่ส่ง (ปิดแล้วธรรมดา) ยังได้ข้อความเดิมของรอบปิด
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        _round_row(db, ns.rnd["id"])["status"] = "closed"
        code, detail = _code(lambda: _call(db, ADMIN, _route_calls(db, ns)["wl_curricula_update"][1]))
        assert code == 409 and "ปิดแล้ว" in detail and "ส่งเข้าโปรแกรม" not in detail and "ถูกปิดไว้" not in detail, detail


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
