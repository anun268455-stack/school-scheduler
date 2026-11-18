"""
ขั้นที่ 3 งานที่ 4: สร้างเทอมใหม่จากรอบอัตรากำลัง — POST /api/terms + round_id + admin_code ในธุรกรรมเดียว

ฐานข้อมูลปลอม = ของ wlcurriculum.py (ตาราง wl_* จาก _WL_SCHEMA) + app_terms / app_state ของชั้นเทอม (TermCur) บนการเชื่อมต่อ
ปลอมที่ COMMIT/ROLLBACK ได้จริง (TermConn: ยกข้อผิดพลาดใน with = ย้อนทุกตารางกลับ · COMMIT ตรวจ FK) · ตัวแปรของโปรแกรม
จัดตารางเป็นชุดเล็กของ wlopen.py (_program) และทุกตัวที่การสร้างเทอมแตะถูกแทนด้วยสำเนาระหว่างตัวทดสอบ (Ruling P1)
ของจริง (Postgres สองเซสชัน · ฆ่าเซิร์ฟเวอร์หลัง COMMIT · ฉีดล้ม) ลองแยกในรายงาน
"""
import contextlib
import copy
import datetime as dt
import gzip
import inspect
import io
import json
import os
import sys
import types
from types import SimpleNamespace

import mock_api
from wlcurriculum import ADMIN, REQ, DbError, FakeCur, _call, _code, _patched, _thai
from wlexportpreview import _program, _ready, _scenario
from wlopen import SCHED_SUBJECTS, _wl_teacher

fails: list[str] = []

ADMIN_CODE = "admin-code-1234"
HEAD_CODE = "head-code-5678"
ENV = "SCHED_TEST_FAIL_AT"
STEPS = ("built", "apply", "pack", "rotate", "app_state", "writeback", "mark", "commit")
# ตัวแปรของโปรแกรมที่การสร้างเทอมจากรอบแตะ (หรือต้องไม่แตะ) — deep-equal ก่อน/หลังเมื่อล้ม
PROGRAM = ("TEACHERS", "SUBJECTS", "REQUIREMENTS", "ELECTIVE_POOLS", "CURRICULA", "GROUPS", "_counters", "SLOTS",
           "PARKED", "CURRENT_TERM", "SCHOOL_CONFIG", "LAST_RUN", "DEPARTMENTS", "ROOMS", "REVISION")
LISTS = ("TEACHERS", "SUBJECTS", "REQUIREMENTS", "ELECTIVE_POOLS", "CURRICULA", "SLOTS", "PARKED")
ACTIVE5 = {"id": 5, "year": 2569, "semester": 1, "label": "1/2569", "status": "active"}
UPSERT = " ".join(mock_api._DB_UPSERT.split())
ROTATE_UPDATE = "UPDATE app_terms SET status = 'closed', data = %s, slots = %s, closed_at = now() WHERE id = %s"
INSERT_CLOSED = ("INSERT INTO app_terms (year, semester, label, status, data, slots, closed_at) "
                 "VALUES (%s, %s, %s, 'closed', %s, %s, now()) RETURNING id")
INSERT_ACTIVE = ("INSERT INTO app_terms (year, semester, label, status, data, slots, closed_at) "
                 "VALUES (%s, %s, %s, 'active', %s, 0, NULL) RETURNING id")


# ── ฐานข้อมูลปลอมของชั้นเทอม ─────────────────────────────────────────────────
class TermCur(FakeCur):
    """ตาราง wl_* ตามของปลอมเดิม + app_terms / app_state เฉพาะรูปคำสั่งที่ชั้นเทอมใช้ (รูปอื่น = ล้มทันที)"""

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        s = " ".join(sql.split())
        if "app_terms" not in s and "app_state" not in s:
            return super().execute(sql, params)
        p = list(params or ())
        self.log.append((s, tuple(p)))
        db = self.db
        if s.startswith("CREATE "):                     # _terms_schema ของทางเดิม — ตารางมีอยู่แล้วในของปลอม
            self._out, self.rowcount = [], 0
        elif s == "SELECT id, year, semester, status FROM app_terms":
            self._out = [(t["id"], t["year"], t["semester"], t["status"]) for t in db.terms]
            self.rowcount = len(self._out)
        elif s == ROTATE_UPDATE:
            hit = [t for t in db.terms if t["id"] == p[2]]
            for t in hit:
                t.update(status="closed", data=p[0], slots=p[1])
            self._out, self.rowcount = [], len(hit)
        elif s in (INSERT_CLOSED, INSERT_ACTIVE):
            closed = s == INSERT_CLOSED
            year, semester, label, data = p[:4]
            if any((t["year"], t["semester"]) == (year, semester) for t in db.terms):
                raise DbError("23505", "app_terms ปี/ภาคซ้ำ")
            if not closed and any(t["status"] == "active" for t in db.terms):
                raise DbError("23505", "app_terms_one_active")
            db.term_seq += 1
            db.terms.append({"id": db.term_seq, "year": year, "semester": semester, "label": label,
                             "status": "closed" if closed else "active", "data": data, "slots": p[4] if closed else 0})
            self._out, self.rowcount = [(db.term_seq,)], 1
        elif s == UPSERT:
            db.app_state = p[0]
            self._out, self.rowcount = [], 1
        else:
            raise AssertionError(f"ของปลอมของชั้นเทอมไม่รู้จัก SQL: {s}")


def _db_snapshot(db):
    return copy.deepcopy((db.tables, db.seq, db.terms, db.term_seq, db.app_state))


def _db_restore(db, snap):
    db.tables, db.seq, db.terms, db.term_seq, db.app_state = copy.deepcopy(snap)


class TermConn:
    """การเชื่อมต่อปลอม: with ที่ยกข้อผิดพลาด = ROLLBACK (คืนทุกตารางเป็นตอน COMMIT ล่าสุด) · จบปกติ = COMMIT แบบ psycopg
    on_rollback (ตัวทดสอบตั้ง) ถูกเรียกทุกครั้งที่ ROLLBACK — จังหวะที่ของจริงปล่อยล็อกทะเบียน (ล็อกระดับธุรกรรม)"""
    on_rollback = None

    def __init__(self, db):
        self.db, self.cur, self.commits = db, TermCur(db, None), 0
        self._snap = _db_snapshot(db)

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        if et is not None:
            self.rollback()
        return False

    def rollback(self):
        if TermConn.on_rollback is not None:
            TermConn.on_rollback(self)
        _db_restore(self.db, self._snap)
        self.cur.log.append(("ROLLBACK", ()))

    def cursor(self):
        return self.cur

    def commit(self):
        self.db.check_fks()                              # FK แบบ DEFERRED ตรวจตอน COMMIT
        self.commits += 1
        self.cur.log.append(("COMMIT", ()))
        self._snap = _db_snapshot(self.db)


def _terms_view(db):
    return [{k: t[k] for k in ("id", "year", "semester", "label", "status")} for t in db.terms]


@contextlib.contextmanager
def _world(terms=(ACTIVE5,), current=ACTIVE5, slots=({"id": 1, "group_id": 1, "day": 1, "period": 1},),
           parked=(), **over):
    """ตัวแปรของโปรแกรมชุดเล็ก + สำเนาของทุกตัวที่การสร้างเทอมแตะ + ฐานข้อมูลปลอมของชั้นเทอม · ออกแล้วคืนของเดิมทุกตัว
    → rec: db (ตั้งด้วย rec.use(db)) conns (การเชื่อมต่อที่ _db_connect เปิด) wl_logs (log ของ _wl_db แต่ละครั้ง)
    calls (flush/save ตามลำดับ) logged (_term_log)"""
    rec = SimpleNamespace(db=None, conns=[], wl_logs=[], calls=[], logged=[])

    def use(db):
        db.terms = [dict(t, data=b"old", slots=0) for t in terms]
        db.term_seq = max([t["id"] for t in terms] or [0]) + 10
        db.app_state = None
        rec.db = db
        for role, dept, label, code in (("admin", None, "ผู้ดูแลระบบ", ADMIN_CODE),
                                        ("head", 2, "หัวหน้ากลุ่มสาระคณิตศาสตร์", HEAD_CODE)):
            salt = os.urandom(16)
            db.add("wl_codes", role=role, department_id=dept, label=label, salt=salt, hash=mock_api.wl_hash(code, salt))
        return db
    rec.use = use

    def connect():
        conn = TermConn(rec.db)
        rec.conns.append(conn)
        return conn

    @contextlib.contextmanager
    def wl_db():
        cur = FakeCur(rec.db, None)
        rec.wl_logs.append(cur.log)
        yield cur

    def active():
        return next(({k: t[k] for k in ("id", "year", "semester", "label", "status")}
                     for t in rec.db.terms if t["status"] == "active"), None)

    with _program(**over), _patched(
            GROUPS=copy.deepcopy(mock_api.GROUPS), _counters=dict(mock_api._counters),
            CURRENT_TERM=dict(current), SCHOOL_CONFIG=copy.deepcopy(mock_api.SCHOOL_CONFIG),
            LAST_RUN={"unplaced_requirement_ids": [3], "skipped_requirement_ids": [4]}, REVISION={"n": 7},
            SLOTS=[dict(s) for s in slots], PARKED=[dict(e) for e in parked],
            _db_connect=connect, _wl_db=wl_db, _terms_list=lambda: _terms_view(rec.db), _term_active=active,
            _term_row=lambda i: {"id": i},
            _flush_pending=lambda blocking=False: rec.calls.append(("flush", blocking)),
            _save_state=lambda: rec.calls.append(("save", sum(c.commits for c in rec.conns))),
            _term_log=lambda *a: rec.logged.append(a), _DB_HAD_DATA=False, _STATE_SOURCE="snapshot",
            WL_HASH_ROUNDS=10, _WL_FAILS={"login": [], "setup": []}):
        mock_api.SCHOOL_CONFIG.update({"term": "1", "year": "2569"})
        old_env = os.environ.pop(ENV, None)
        try:
            yield rec
        finally:
            os.environ.pop(ENV, None)
            if old_env is not None:
                os.environ[ENV] = old_env


def _program_state():
    return copy.deepcopy({k: getattr(mock_api, k) for k in PROGRAM})


def _ids():
    return {k: id(getattr(mock_api, k)) for k in LISTS}


def _post(rnd, code=ADMIN_CODE, year=2569, semester=2, **extra):
    body = {"year": year, "semester": semester, "round_id": rnd["id"], "admin_code": code, **extra}
    return mock_api.create_term(body)


def _expect(fn, status, *words):
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        c, d = _code(fn)
    assert c == status, (c, d, err.getvalue()[-800:])
    if status == 500:
        # ล้มกลางทาง: log มีชื่อชนิดและ stack ให้ตามรอย แต่ไม่มีข้อความของ exception (อาจมีค่าในแถว/รายละเอียดการเชื่อมต่อ)
        assert "RuntimeError" in err.getvalue() and f"{ENV}=" not in err.getvalue(), err.getvalue()[-800:]
    else:
        assert err.getvalue() == "", err.getvalue()[-800:]
    assert _thai(d), d
    for w in words:
        assert w in d, (w, d)
    return d


def _rich():
    """รอบ 2/2569 ที่ผ่านเกณฑ์ (ต้องอยู่ใน _world) + ทุกทางของการเขียนกลับ:
    ครูใหม่ของเว็บที่ยังไม่มี sched_id สอนแถวหนึ่ง · บรรทัดพิมพ์รหัสเอง ZZ9 (ไม่มีทั้งในเว็บและโปรแกรม → สร้างวิชาสองฝั่ง) ·
    ตัวเลือกคาบเสรีพิมพ์รหัส พ21201 ที่ไม่ได้ผูก (ตรงวิชาของเว็บ → ผูกกับวิชานั้น)"""
    db, t, rnd = _scenario()
    new_t = db.add("wl_teachers", sched_id=None, name="ครูใหม่", department_id=1)
    row = next(r for r in db.tables["wl_rows"] if r["line_id"] == t["lines"][0]["id"] and r["group_id"] == 1)
    row["teacher_id"] = new_t["id"]
    line = _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
                 {"curriculum_id": t["curriculum"]["id"], "code": "ZZ9", "name": "วิชาพิมพ์เอง", "department_id": 1,
                  "weekly": 1})
    opt = db.add("wl_term_set_options", set_id=t["set"]["id"], subject_id=None, code="พ21201", name="ฟุตบอล",
                 department_id=6)
    db.add("wl_option_teachers", round_id=rnd["id"], option_id=opt["id"], teacher_id=_wl_teacher(db, 510),
           confirmed=True)
    _ready(db, rnd)
    return db, SimpleNamespace(t=t, rnd=rnd, new_t=new_t, line=line, opt=opt)


def _elective_on_program():
    """วิชา 904 (ศ21201 ในชุดคาบเสรี) ติ๊กวิชาเสรีในโปรแกรม แต่ในเว็บไม่ติ๊ก (addendum ข้อ 2)"""
    subjects = copy.deepcopy(SCHED_SUBJECTS)
    next(s for s in subjects if s["id"] == 904)["is_elective"] = True
    return subjects


def _expected(db, rnd):
    """สถานะใหม่ที่ควรได้ = _term_build จากสถานะเดียวกัน (ฟังก์ชันล้วน ไม่แตะอะไร)"""
    source = mock_api._wl_export_source(FakeCur(db, None), rnd["id"])
    return mock_api._term_build(source, mock_api._term_outgoing(), dict(mock_api._counters), 2569, 2)


def _main_log(rec):
    assert len(rec.conns) == 1, len(rec.conns)
    return rec.conns[0].cur.log


def _writes(log):
    return [(s, p) for s, p in log if s.split()[0].upper() in ("INSERT", "UPDATE", "DELETE")]


@contextlib.contextmanager
def _frozen_clock():
    """_snapshot ใส่เวลาตอนบรรจุ (saved_at) — หยุดนาฬิกาไว้ ไฟล์จากสถานะเดียวกันจึงเทียบกันได้ทุกไบต์"""
    class Frozen(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 11, 17, 9, 0, 0, tzinfo=tz)
    shim = types.ModuleType("dt_frozen")
    shim.__dict__.update(vars(dt))
    shim.datetime = Frozen
    with _patched(_dt=shim):
        yield


def _closed_blob(log):
    """ไฟล์ของเทอมที่ถูกปิด (UPDATE แถวเดิม หรือ INSERT แถว closed) คลายแล้ว เป็นไบต์ของ JSON"""
    for s, p in log:
        if s == ROTATE_UPDATE:
            return gzip.decompress(p[0])
        if s == INSERT_CLOSED:
            return gzip.decompress(p[3])
    raise AssertionError("ไม่มีไฟล์เทอมที่ถูกปิด")


# ── ทางเดิม ────────────────────────────────────────────────────────────────
def test_old_path_untouched_without_round_id():
    # ไม่มี round_id (หรือเป็น None) → โค้ดเดิมทุกบรรทัด: คำสั่ง SQL ตัวแปร และคำตอบเท่าก่อนงานนี้ ไม่แตะเว็บลงอัตรากำลังเลย
    def boom(*_a, **_k):
        raise AssertionError("ทางเดิมต้องไม่ผ่านโค้ดใหม่")
    for body in ({"year": 2569, "semester": 2}, {"year": 2569, "semester": 2, "round_id": None, "admin_code": "x"}):
        with _world() as rec:
            db, _t, _rnd = _scenario()
            rec.use(db)
            wl_before = copy.deepcopy(db.tables)
            reqs, teachers = mock_api.REQUIREMENTS, copy.deepcopy(mock_api.TEACHERS)
            os.environ[ENV] = "rotate"                   # ตัวแปรฉีดล้มไม่มีผลกับทางเดิม
            with _patched(_wl_export_source=boom, _term_build=boom, _term_admin_check=boom, _term_outgoing=boom):
                out = mock_api.create_term(dict(body))
            log = _main_log(rec)
            assert [s for s, _p in log] == [" ".join(mock_api._TERMS_SCHEMA.split()),
                                            " ".join(mock_api._TERMS_ONE_ACTIVE.split()),
                                            ROTATE_UPDATE, INSERT_ACTIVE, "COMMIT"], [s for s, _p in log]
            upd, ins = log[2][1], log[3][1]
            assert upd[1:] == (1, 5) and ins[:3] == (2569, 2, "2/2569"), (upd[1:], ins[:3])
            assert rec.calls == [("flush", True), ("save", 1), ("flush", True)], rec.calls
            assert rec.wl_logs == [] and db.tables == wl_before          # ไม่เปิด _wl_db ไม่เขียน wl_*
            assert set(out) == {"closed", "active", "save_error", "save_pending"}, set(out)
            assert out["closed"] == {"id": 5} and out["active"] == {"id": 16}
            assert mock_api.REQUIREMENTS is reqs and mock_api.TEACHERS == teachers
            assert mock_api.SLOTS == [] and mock_api.CURRENT_TERM == {"id": 16, "year": 2569, "semester": 2,
                                                                      "label": "2/2569", "status": "active"}
            assert mock_api.LAST_RUN == {"unplaced_requirement_ids": [3], "skipped_requirement_ids": [4]}
            assert rec.logged == [(5, "close", "ปิดเทอม 1/2569 (1 คาบ)"), (16, "create", "สร้างเทอม 2/2569")]
    # ตัวทดสอบเดิมของชั้นเทอมยังดูว่า create_term เรียก _term_rotate (ทางเดิมต้องผ่านมันตามเดิม)
    assert "_term_rotate(" in inspect.getsource(mock_api.create_term)


def test_rotate_with_cursor_uses_it_and_never_connects_ddls_or_commits():
    log = []

    class Cur:
        def __init__(self, *seq):
            self.seq = list(seq)

        def execute(self, sql, params=None):
            log.append(" ".join(sql.split()))

        def fetchone(self):
            return (self.seq.pop(0),)

    def boom():
        raise AssertionError("ส่ง cursor แล้วต้องไม่เปิดการเชื่อมต่อเอง")
    with _patched(_db_connect=boom):
        got = mock_api._term_rotate(5, b"o", 2, 2569, 2, "2/2569", b"n", cur=Cur(41))
        assert got == (5, 41) and log == [ROTATE_UPDATE, INSERT_ACTIVE], log
        log.clear()
        got = mock_api._term_rotate(None, b"o", 2, 2569, 2, "2/2569", b"n", old_year=2569, old_semester=1,
                                    old_label="1/2569", cur=Cur(42, 43))
        assert got == (42, 43) and log == [INSERT_CLOSED, INSERT_ACTIVE], log
    # ไม่มี DDL: CREATE INDEX IF NOT EXISTS ถือ ShareLock ของ app_terms ถึง COMMIT แม้ดัชนีมีแล้ว
    assert not any(s.startswith(("CREATE", "ALTER", "COMMIT")) for s in log)
    sig = inspect.signature(mock_api._term_rotate)
    assert sig.parameters["cur"].default is None


# ── ไฟล์เทอมที่ถูกปิด = ของปุ่มเดิมทุกไบต์ ───────────────────────────────────────
def test_closed_term_blob_equals_plain_create():
    # สถานะเดียวกัน: ปุ่มเดิม (ไม่มีรอบ) กับปุ่มจากรอบ ต้องเก็บเทอมที่ปิดเป็น JSON เดียวกันทุกไบต์ (คลาย gzip แล้ว)
    # สองกรณี: มีแถว active (UPDATE แถวเดิม) · เทอมแรกที่ยังไม่มีแถว (INSERT แถว closed จาก SCHOOL_CONFIG)
    blank = {"id": None, "year": None, "semester": None, "label": None, "status": None}
    for terms, current in (((ACTIVE5,), ACTIVE5), ((), blank)):
        blobs = []
        for with_round in (False, True):
            with _world(terms=terms, current=current, parked=({"id": 1, "rows": [{"x": 1}]},),
                        subjects=_elective_on_program()) as rec:
                db, ns = _rich()
                rec.use(db)
                with _frozen_clock():
                    if with_round:
                        _post(ns.rnd)
                    else:
                        mock_api.create_term({"year": 2569, "semester": 2})
                blobs.append(_closed_blob(_main_log(rec)))
        assert blobs[0] == blobs[1], "ไฟล์เทอมที่ถูกปิดต่างจากปุ่มเดิม"
        snap = json.loads(blobs[0])
        assert snap["current_term"]["status"] == "closed" and snap["slots"] and snap["parked"]


# ── สร้างสำเร็จ ─────────────────────────────────────────────────────────────
def test_new_state_applied_and_counters_advanced():
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        want = _expected(db, ns.rnd)
        assert want["reasons"] == [], want["reasons"]
        ids = _ids()
        counters_before = dict(mock_api._counters)
        out = _post(ns.rnd)
        reg, plan = want["registry"], want["plan"]
        # แทนในที่ (ลิสต์ตัวเดิม) ด้วยสถานะใหม่ทั้งชุด
        assert _ids() == ids
        assert mock_api.TEACHERS == reg["teachers"]
        assert mock_api.REQUIREMENTS == plan["requirements"] and mock_api.ELECTIVE_POOLS == plan["pools"]
        assert mock_api.CURRICULA == plan["curricula"]
        new_teacher = next(t for t in mock_api.TEACHERS if t["name"] == "ครูใหม่")
        assert any(r["teacher_id"] == new_teacher["id"] for r in mock_api.REQUIREMENTS)
        # addendum ข้อ 2: วิชาในชุดคาบเสรีที่เว็บไม่ติ๊ก → หลังสร้างเป็น True · คำตัดสินรอบแก้สุดท้าย: สรุปไม่บอกว่า "ใช่ → ไม่ใช่"
        # (ไม่ใช่สิ่งที่เกิดหลังสร้าง) — ทดสอบละเอียดใน test_set_subjects_are_not_reported_as_losing_the_elective_flag
        assert not any(c["field"] == "is_elective"
                       for p in want["report"]["subjects_patched"] if p["id"] == 904 for c in p["changes"])
        by_id = {s["id"]: s for s in mock_api.SUBJECTS}
        for sid in plan["elective_subjects"]:
            assert by_id[sid]["is_elective"] is True, sid
        assert {k: v for k, v in by_id.items() if k not in plan["elective_subjects"]} == \
               {s["id"]: s for s in reg["subjects"] if s["id"] not in plan["elective_subjects"]}
        zz9 = next(s for s in mock_api.SUBJECTS if s.get("code") == "ZZ9")
        # curriculum_id ของทุกห้องตามหลักสูตรของรอบ (ห้องนอกหลักสูตร = ว่าง)
        for g in mock_api._flat_groups():
            assert g.get("curriculum_id") == plan["group_curricula"].get(g["id"]), g["id"]
        assert any(v is not None for v in plan["group_curricula"].values())
        # ตัวนับเดินต่อ ไม่ถอย
        for k, v in plan["counters"].items():
            assert mock_api._counters[k] == max(v, counters_before.get(k, 0)), k
        assert mock_api._counters["teacher"] >= new_teacher["id"] and mock_api._counters["subject"] >= zz9["id"]
        # ปุ่มเดิม: ล้างคาบ · เทอมใหม่ active · ปี/ภาคในการตั้งค่า · หลัง COMMIT ล้าง LAST_RUN
        assert mock_api.SLOTS == [] and mock_api.PARKED == []
        new_id = out["active"]["id"]
        assert mock_api.CURRENT_TERM == {"id": new_id, "year": 2569, "semester": 2, "label": "2/2569",
                                         "status": "active"}
        assert (mock_api.SCHOOL_CONFIG["term"], mock_api.SCHOOL_CONFIG["year"]) == ("2", "2569")
        assert mock_api.LAST_RUN == {"unplaced_requirement_ids": [], "skipped_requirement_ids": []}
        # ฐาน: เทอมเก่าปิด เทอมใหม่ active · sched_id กลับไปที่เว็บ · วิชาที่พิมพ์รหัสเองสร้างในเว็บและผูกบรรทัด/ตัวเลือก
        assert [(t["id"], t["status"]) for t in db.terms] == [(5, "closed"), (new_id, "active")]
        wl_t = next(r for r in db.tables["wl_teachers"] if r["id"] == ns.new_t["id"])
        assert wl_t["sched_id"] == new_teacher["id"]
        wl_zz9 = [r for r in db.tables["wl_subjects"] if r["code"] == "ZZ9"]
        assert len(wl_zz9) == 1 and wl_zz9[0]["sched_id"] == zz9["id"]
        assert {k: wl_zz9[0][k] for k in ("name", "type", "department_id", "duration", "is_activity", "is_elective")} \
            == {"name": "วิชาพิมพ์เอง", "type": "common", "department_id": 1, "duration": 1, "is_activity": False,
                "is_elective": False}
        line = next(r for r in db.tables["wl_curriculum_lines"] if r["id"] == ns.line["id"])
        assert line["subject_id"] == wl_zz9[0]["id"]
        opt = next(r for r in db.tables["wl_term_set_options"] if r["id"] == ns.opt["id"])
        assert opt["subject_id"] == next(r["id"] for r in db.tables["wl_subjects"] if r["code"] == "พ21201")
        rnd = next(r for r in db.tables["wl_rounds"] if r["id"] == ns.rnd["id"])
        assert rnd["status"] == "closed" and rnd["closed_at"] is not None and rnd["exported_at"] is not None
        assert (rnd["exported_term_id"], rnd["exported_label"]) == (new_id, "2/2569")
        # หลัง COMMIT: บันทึกประวัติเทอม · เซฟ (หลัง COMMIT เท่านั้น) · ไม่มีอะไรเรียก _save_state ก่อน
        assert rec.logged == [(5, "close", "ปิดเทอม 1/2569 (1 คาบ)"),
                              (new_id, "create", "สร้างเทอม 2/2569 จากรอบอัตรากำลัง 2/2569")], rec.logged
        assert rec.calls == [("flush", True), ("save", 1), ("flush", True)], rec.calls


def test_set_subjects_are_not_reported_as_losing_the_elective_flag():
    # คำตัดสินของผู้คุม (รอบแก้สุดท้าย): ค่า is_elective สุดท้าย = ค่าของเว็บ หรือ วิชานั้นอยู่ในชุดคาบเสรีของรอบนี้ — ทั้งตอนแก้ทะเบียนและในสรุป
    # ไม่งั้นสรุปบอก "N วิชาจะถูกแก้ · เป็นวิชาเสรี: ใช่ → ไม่ใช่" ทั้งที่หลังสร้าง _mark_elective ติ๊กกลับ = คำเตือนเท็จทุกภาคเรียน
    # · วิชาที่ไม่อยู่ในชุดยังตามเว็บ (Ruling T1 C4): โปรแกรมติ๊ก เว็บไม่ติ๊ก → ยังรายงานและแก้เป็นไม่ใช่
    subjects = copy.deepcopy(SCHED_SUBJECTS)
    for s_ in subjects:
        if s_["id"] in (904, 905, 901):                  # 904/905 = วิชาของตัวเลือกในชุดคาบเสรี · 901 ไม่อยู่ในชุด
            s_["is_elective"] = True
    with _world(subjects=subjects) as rec:
        db, ns = _rich()
        rec.use(db)
        assert all(not r.get("is_elective") for r in db.tables["wl_subjects"]), "เว็บไม่ติ๊กวิชาเสรีเลย"
        want = _expected(db, ns.rnd)
        in_set = set(want["plan"]["elective_subjects"])
        assert {904, 905} <= in_set and 901 not in in_set, in_set
        patched = {p["id"]: p for p in want["report"]["subjects_patched"]}
        assert not any(c["field"] == "is_elective" for sid in in_set if sid in patched for c in patched[sid]["changes"]), \
            [patched[sid] for sid in in_set if sid in patched]
        assert all(p["changes"] for p in want["report"]["subjects_patched"]), "ไม่มีรายการที่ไม่มีช่องเปลี่ยน"
        assert [c for c in patched[901]["changes"] if c["field"] == "is_elective"] == \
            [{"field": "is_elective", "label": "เป็นวิชาเสรี", "old": True, "new": False}], patched.get(901)
        reg = {x["id"]: x for x in want["registry"]["subjects"]}
        assert all(reg[sid]["is_elective"] is True for sid in in_set) and reg[901]["is_elective"] is False
        # สร้างจริง: วิชาในชุดยังเป็นวิชาเสรี · 901 ตามเว็บ · สรุปที่คืนมา = ที่เห็นก่อนกด
        out = _post(ns.rnd)
        by_id = {x["id"]: x for x in mock_api.SUBJECTS}
        assert all(by_id[sid]["is_elective"] is True for sid in in_set) and by_id[901]["is_elective"] is False
        assert out["report"]["subjects_patched"] == want["report"]["subjects_patched"]
    # ไม่มีอะไรต่างนอกจากธงวิชาเสรีของวิชาในชุด → ไม่มีรายการ is_elective (รูปของข้อมูลตั้งต้นบนฐานทดลอง: 44 วิชา)
    subjects = copy.deepcopy(SCHED_SUBJECTS)
    for s_ in subjects:
        if s_["id"] in (904, 905):
            s_["is_elective"] = True
    with _world(subjects=subjects) as rec:
        db, ns = _rich()
        rec.use(db)
        assert [p for p in _expected(db, ns.rnd)["report"]["subjects_patched"]
                if any(c["field"] == "is_elective" for c in p["changes"])] == []


def test_one_commit_one_connection():
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        _post(ns.rnd)
        log = _main_log(rec)                              # การเชื่อมต่อเดียวของธุรกรรม
        assert rec.conns[0].commits == 1 and [s for s, _p in log].count("COMMIT") == 1 and log[-1][0] == "COMMIT"
        # ล็อกทะเบียนเป็นคำสั่งแรก แล้วค่อยล็อกแถวรอบ ก่อนอ่านอะไรของรอบ · ไม่มี DDL ในธุรกรรมนี้เลย
        assert log[0] == ("SELECT pg_advisory_xact_lock(%s)", (mock_api.WL_REGISTRY_LOCK_KEY,)), log[0]
        assert log[1] == ("SELECT id FROM wl_rounds WHERE id = %s FOR UPDATE", (ns.rnd["id"],)), log[1]
        assert not any(s.split()[0].upper() in ("CREATE", "ALTER", "DROP", "LOCK") for s, _p in log)
        assert sum(1 for s, _p in log if "pg_advisory" in s) == 1
        # ทุกการเขียนอยู่ในการเชื่อมต่อนี้ก่อน COMMIT · _wl_db (ตรวจรหัส) อ่านอย่างเดียว
        w = [s for s, _p in _writes(log)]
        assert w[:3] == [ROTATE_UPDATE, INSERT_ACTIVE, UPSERT], w[:3]
        assert len(rec.wl_logs) == 1 and _writes(rec.wl_logs[0]) == []
        assert all("wl_codes" in s for s, _p in rec.wl_logs[0]), rec.wl_logs[0]


def test_app_state_written_inside_transaction():
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        out = _post(ns.rnd)
        log = [s for s, _p in _main_log(rec)]
        # ลำดับตามแบบข้อ 4.4: หมุนเทอม → app_state → เขียน sched_id กลับ / สร้าง-ผูกวิชา → ทำเครื่องหมายรอบ → COMMIT
        i_rot, i_ins = log.index(ROTATE_UPDATE), log.index(INSERT_ACTIVE)
        i_state = log.index(UPSERT)
        i_wb = next(i for i, s in enumerate(log) if s.startswith("UPDATE wl_teachers SET sched_id"))
        i_new = next(i for i, s in enumerate(log) if s.startswith("INSERT INTO wl_subjects"))
        i_bind = next(i for i, s in enumerate(log) if s.startswith("UPDATE wl_curriculum_lines SET subject_id"))
        i_mark = next(i for i, s in enumerate(log) if s.startswith("UPDATE wl_rounds"))
        assert i_rot < i_ins < i_state < i_wb < i_new < i_bind < i_mark < log.index("COMMIT"), log
        assert log[i_mark] == ("UPDATE wl_rounds SET status = 'closed', closed_at = coalesce(closed_at, now()), "
                               "exported_at = now(), exported_term_id = %s, exported_label = %s, "
                               "export_report = %s::jsonb, amending_since = %s WHERE id = %s AND exported_at IS NULL"), \
            log[i_mark]                                  # amending_since = NULL: ทาง ข. (รีวิว Task 3 m1)
        # สำเนาสดในฐาน = เทอมใหม่ทั้งชุด พร้อมรหัสแถวเทอม (เซิร์ฟเวอร์เริ่มใหม่โหลดจากตรงนี้อย่างเดียว)
        snap = mock_api._unpack(db.app_state)
        assert snap["current_term"] == {"id": out["active"]["id"], "year": 2569, "semester": 2, "label": "2/2569",
                                        "status": "active"}
        assert snap["teachers"] == mock_api.TEACHERS and snap["requirements"] == mock_api.REQUIREMENTS
        assert snap["subjects"] == mock_api.SUBJECTS and snap["elective_pools"] == mock_api.ELECTIVE_POOLS
        assert snap["curricula"] == mock_api.CURRICULA and snap["slots"] == []
        assert {g["id"]: g.get("curriculum_id") for g in snap["groups"]} == \
               {g["id"]: g.get("curriculum_id") for g in mock_api._flat_groups()}
        # ไฟล์ของแถว active = เทอมใหม่เหมือนกัน (รหัสแถวยังไม่รู้ตอนบรรจุ — แถวเป็นเจ้าของ id ตามปุ่มเดิม)
        row_snap = mock_api._unpack(next(t for t in db.terms if t["status"] == "active")["data"])
        assert row_snap["current_term"]["id"] is None and row_snap["teachers"] == snap["teachers"]


def test_failure_at_each_step_restores_everything():
    # ฉีดล้มทุกขั้นหลังบรรจุเทอมเก่า: ตัวแปรของโปรแกรมทุกตัว deep-equal ก่อนกด (ลิสต์ตัวเดิม) · ฐานเท่าเดิมทุกตาราง
    # (ไม่มีเทอมใหม่ · sched_id ไม่เปลี่ยน · รอบไม่ถูกทำเครื่องหมาย · ไม่มีวิชาใหม่) · ไม่มี COMMIT · ไม่เซฟ ไม่บันทึกประวัติ
    for step in STEPS:
        with _world(subjects=_elective_on_program()) as rec:
            db, ns = _rich()
            rec.use(db)
            before, ids, db_before = _program_state(), _ids(), _db_snapshot(db)
            os.environ[ENV] = step
            _expect(lambda: _post(ns.rnd), 500, "ข้อมูลเดิมยังอยู่ครบ")
            assert _program_state() == before, step
            assert _ids() == ids, step
            assert _db_snapshot(db) == db_before, step
            log = _main_log(rec)
            assert "COMMIT" not in [s for s, _p in log] and rec.conns[0].commits == 0, step
            assert ("save", 0) not in rec.calls and ("save", 1) not in rec.calls and rec.logged == [], step
            # ล้มจริงหลังขั้นที่ฉีด (ไม่ใช่ล้มก่อนถึง): ขั้นหลังบรรจุใหม่มีการเขียนในธุรกรรมไปแล้วก่อนย้อน
            if step in ("rotate", "app_state", "writeback", "mark", "commit"):
                assert _writes(log), step
            os.environ.pop(ENV)
            # ลองใหม่หลังล้มได้ผลเหมือนไม่เคยล้ม (ไม่มีครู/วิชาซ้ำ)
            out = _post(ns.rnd)
            assert out["active"]["id"] and sum(1 for t in mock_api.TEACHERS if t["name"] == "ครูใหม่") == 1
            assert sum(1 for r in db.tables["wl_subjects"] if r["code"] == "ZZ9") == 1


def test_failure_after_a_concurrent_save_saves_the_restored_state():
    # ระหว่างใส่สถานะใหม่จนถึง COMMIT คำขอเขียนอื่นที่จบก่อนอาจเซฟสถานะใหม่ที่ยังไม่ COMMIT ลงคิว — ล้มแล้วต้องเซฟของเดิมทับ
    # รีวิวทั้งสาขา M9: เขียนของที่คืนแล้วลง app_state ตรง ๆ ก่อนตอบ (การเชื่อมต่อเดียวกัน หลัง ROLLBACK) ไม่รอคิวเซฟ ~1 วินาที —
    # เครื่องดับหลังได้คำตอบต้องไม่โหลดเทอมที่ไม่เคยเกิด · คิวเซฟยังอยู่ด้วย (ถ้ามีการเขียนสถานะใหม่ค้างอยู่กลางทาง ตัวที่ตามมาทับให้)
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        real_pack = mock_api._pack
        packs = []

        def pack(snap):
            packs.append(1)
            if len(packs) == 2:                          # บรรจุไฟล์เทอมใหม่ = หลังใส่สถานะใหม่แล้ว (ก่อนใส่ = 409 ของ m3)
                mock_api.REVISION["n"] += 1              # มีคำขอเขียนอื่นจบและบวกรุ่นระหว่างนั้น
                db.app_state = real_pack(snap)           # …และคิวเซฟของมันเขียนสถานะที่ยังไม่ COMMIT ลงไปแล้ว
                rec.conns[0]._snap = _db_snapshot(db)    # (คนละการเชื่อมต่อ — ROLLBACK ของเราไม่ย้อนให้)
            return real_pack(snap)
        os.environ[ENV] = "writeback"                    # ล้มก่อนถึงการเทียบรุ่นก่อน COMMIT
        before, mem = mock_api.REVISION["n"], _program_state()
        at_rb = []
        with _patched(_pack=pack), _patched_attr(TermConn, "on_rollback", lambda _c: at_rb.append(len(packs))):
            _expect(lambda: _post(ns.rnd), 500)
        assert ("save", 0) in rec.calls, rec.calls
        # บรรจุของที่คืนแล้วก่อน ROLLBACK (ยังถือล็อกทะเบียน) — หลัง ROLLBACK คำขออื่นที่รอล็อกอาจเริ่มใส่สถานะของมันแล้ว
        assert at_rb and at_rb[0] == len(packs), (at_rb, len(packs))
        # คืนแล้วบวกรุ่นอีกหนึ่ง: หน้าเว็บที่โหลดสถานะใหม่ (ยังไม่ COMMIT) ไปแล้วต้องเห็นว่าต้องโหลดใหม่
        assert mock_api.REVISION["n"] == before + 2, (before, mock_api.REVISION)
        log = [s for s, _p in _main_log(rec)]
        i_rb = log.index("ROLLBACK")
        assert log[i_rb + 1:] == [UPSERT, "COMMIT"] + (["ROLLBACK"] if log[-1] == "ROLLBACK" else []), log[i_rb:]
        snap = mock_api._unpack(db.app_state)            # app_state = ของที่คืนแล้ว (เทอมเดิม ครูเดิม แผนเดิม คาบเดิม)
        assert snap["current_term"] == mem["CURRENT_TERM"] and snap["teachers"] == mem["TEACHERS"], snap["current_term"]
        assert snap["requirements"] == mem["REQUIREMENTS"] and snap["slots"] == mem["SLOTS"]
        assert [t["status"] for t in db.terms] == ["active"] and rec.logged == []    # ไม่มีเทอมใหม่ (ย้อนแล้ว)
    # ไม่มีคำขออื่นจบระหว่างนั้น → ไม่เขียน app_state (ฐานเท่าเดิมทุกไบต์ — test_failure_at_each_step_restores_everything)


def test_failure_restores_memory_before_the_rollback_releases_the_lock():
    # รีวิวทั้งสาขา M4: ROLLBACK ปล่อยล็อกทะเบียน — ปุ่มดึงครูที่รอล็อกอยู่อ่าน TEACHERS ทันที จึงต้องคืนตัวแปรก่อน ROLLBACK ทุกทาง
    # (ล้มทุกขั้น 500 · 409 เพราะมีคนแก้ข้อมูลระหว่างนี้ · 409 รอบถูกส่งไปแล้วระหว่างนี้)
    seen = []

    def at_rollback(_conn):
        seen.append(_program_state())
    for case in STEPS + ("edited", "marked"):
        with _world(subjects=_elective_on_program()) as rec:
            db, ns = _rich()
            rec.use(db)
            before = _program_state()
            real_pack, real_source = mock_api._pack, mock_api._wl_export_source
            packs = []

            def pack(snap):                              # "edited": คำขออื่นจบหลังใส่สถานะใหม่ → 409 ก่อน COMMIT
                packs.append(1)
                if case == "edited" and len(packs) == 2:
                    mock_api.REVISION["n"] += 1
                return real_pack(snap)

            def source(cur, rid):                        # "marked": อีกเครื่องส่งรอบนี้ไปก่อน → UPDATE ได้ 0 แถว → 409
                src = real_source(cur, rid)
                if case == "marked":
                    next(x for x in db.tables["wl_rounds"] if x["id"] == rid)["exported_at"] = \
                        dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc)
                return src
            if case in STEPS:
                os.environ[ENV] = case
            del seen[:]
            with _patched(_pack=pack, _wl_export_source=source), _patched_attr(TermConn, "on_rollback", at_rollback):
                _expect(lambda: _post(ns.rnd), 500 if case in STEPS else 409)
            assert seen, case
            for got in seen:
                diff = [k for k in PROGRAM if k != "REVISION" and got[k] != before[k]]
                assert not diff, (case, diff)


@contextlib.contextmanager
def _patched_attr(obj, name, value):
    old = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, old)


def test_program_edited_before_apply_is_409_and_keeps_the_other_edit():
    # Task 5 addendum ข้อ 5 (รีวิว Task 4 m3): สำเนาของโปรแกรมอ่านตอน _term_outgoing แต่ใส่จริงทีหลัง — คำขอเขียนอื่นที่จบในช่องนั้น
    # (เพิ่มครูในโปรแกรม: TEACHERS.append แล้วบวกรุ่น) ต้องไม่ถูกทับเงียบ → 409 ไทย ไม่มีอะไรถูกสร้าง และงานของอีกคำขอยังอยู่
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        before, ids, db_before = _program_state(), _ids(), _db_snapshot(db)
        real_pack, other = mock_api._pack, {"id": 777, "name": "ครูที่เพิ่มระหว่างสร้าง", "department_id": 1}

        def pack(snap):                                  # ครั้งแรก = บรรจุเทอมเก่า (หลังจุดย้อน ก่อนใส่สถานะใหม่)
            if not mock_api.TEACHERS or mock_api.TEACHERS[-1] is not other:
                mock_api.TEACHERS.append(other)
                mock_api.REVISION["n"] += 1
            return real_pack(snap)
        with _patched(_pack=pack):
            d = _expect(lambda: _post(ns.rnd), 409, "ลองกดใหม่")
        assert d == mock_api.TERM_PROGRAM_EDITED, d
        assert mock_api.TEACHERS[-1] is other and mock_api.TEACHERS[:-1] == before["TEACHERS"]
        after = _program_state()
        for k in PROGRAM:
            if k not in ("TEACHERS", "REVISION"):
                assert after[k] == before[k], k
        assert _ids() == ids and _db_snapshot(db)[:4] == db_before[:4]
        log = _main_log(rec)
        assert [x for x in _writes(log) if x[0] != UPSERT] == [], log
        # คำขอที่จบระหว่างนั้นอาจเซฟสแนปช็อตที่คาบถูกล้างไปแล้ว → เซฟของที่คืนทับ + บวกรุ่นให้หน้าเว็บโหลดใหม่ ·
        # รีวิวทั้งสาขา M9: ของที่คืนแล้ว (รวมงานของอีกคำขอ) ลง app_state ตรง ๆ หลัง ROLLBACK ก่อนตอบ
        assert ("save", 0) in rec.calls and mock_api.REVISION["n"] == before["REVISION"]["n"] + 2
        stmts = [x for x, _p in log]
        assert stmts[stmts.index("ROLLBACK") + 1:stmts.index("ROLLBACK") + 3] == [UPSERT, "COMMIT"], stmts
        state = mock_api._unpack(db.app_state)
        assert state["teachers"][-1] == other and state["slots"] == before["SLOTS"], state["teachers"][-1]
        assert rec.logged == []


def test_program_edited_before_commit_is_409_and_restores_everything():
    # คำขอเขียนอื่นจบหลังใส่สถานะใหม่ (เช่นแก้ครูผ่าน PUT /api/teachers/{id}) → เทียบรุ่นก่อน COMMIT → ย้อนทั้งฐานและหน่วยความจำ
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        before, ids, db_before = _program_state(), _ids(), _db_snapshot(db)
        real = mock_api._term_writeback

        def writeback(cur, wb):
            out = real(cur, wb)
            mock_api.update_teacher(mock_api.TEACHERS[0]["id"], {"max_slots_per_day": 3})
            mock_api.REVISION["n"] += 1                  # = มิดเดิลแวร์ของ PUT ที่จบระหว่างนั้น
            return out
        with _patched(_term_writeback=writeback):
            d = _expect(lambda: _post(ns.rnd), 409)
        assert d == mock_api.TERM_PROGRAM_EDITED, d
        after = _program_state()
        for k in PROGRAM:
            if k != "REVISION":
                assert after[k] == before[k], k
        assert _ids() == ids and _db_snapshot(db)[:4] == db_before[:4]
        log = _main_log(rec)
        stmts = [x for x, _p in log]
        i_rb = stmts.index("ROLLBACK")
        assert _writes(log[:i_rb]) and "COMMIT" not in stmts[:i_rb], stmts      # งานของการสร้างไม่เคย COMMIT
        assert stmts[i_rb + 1:i_rb + 3] == [UPSERT, "COMMIT"], stmts[i_rb:]     # M9: ของที่คืนแล้วลง app_state ตรง ๆ
        state = mock_api._unpack(db.app_state)
        assert state["teachers"] == before["TEACHERS"] and state["current_term"] == before["CURRENT_TERM"]
        assert ("save", 0) in rec.calls and rec.logged == []
        # ลองกดใหม่ (ไม่มีใครแก้แล้ว) ได้ผลครั้งเดียว
        out = _post(ns.rnd)
        assert out["active"]["id"] and sum(1 for t in mock_api.TEACHERS if t["name"] == "ครูใหม่") == 1


def test_revision_is_read_with_the_program_copy_and_checked_twice():
    # จดรุ่นคู่กับสำเนา (ก่อน _term_outgoing) · เทียบก่อนใส่ และก่อน COMMIT (หลังทำเครื่องหมายรอบ) — ไม่ใช่ตอนอื่น
    src = inspect.getsource(mock_api._create_term_from_round)
    i_rev, i_out = src.index('REVISION["n"]'), src.index("_term_outgoing()")
    assert i_rev < i_out, "จดรุ่นก่อนอ่านสำเนาของโปรแกรม"
    checks = [i for i in range(len(src)) if src.startswith("_term_refuse_program_edited(", i)]
    assert len(checks) == 2, checks
    assert checks[0] < src.index("_term_apply(built") < src.index('_term_test_fail("mark")') < checks[1] \
        < src.index("conn.commit()"), checks


def test_admin_check_shares_the_login_in_flight_cap():
    # Task 5 addendum ข้อ 4 (รีวิว Task 4 m2): คำขอที่รอแฮชถือ thread ของ pool ที่เว็บตารางใช้ร่วม — เพดานเดียวกับล็อกอิน
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        gate = mock_api._threading.BoundedSemaphore(2)
        with _patched(_WL_LOGIN_INFLIGHT=gate):
            assert gate.acquire(blocking=False) and gate.acquire(blocking=False)     # มีคนรอแฮชเต็มเพดานแล้ว
            before = _program_state()
            d = _expect(lambda: _post(ns.rnd), 429)
            # รีวิวทั้งสาขา M11: ข้อความขึ้นในหน้าต่างสร้างเทอม ไม่ใช่หน้าล็อกอิน — ไม่พูดว่า "เข้าสู่ระบบ"
            assert d == mock_api.TERM_ADMIN_CODE_BUSY and "เข้าสู่ระบบ" not in d and "ยังไม่ได้สร้างเทอมใหม่" in d, d
            assert rec.wl_logs == [] and rec.conns == [] and mock_api._WL_FAILS["login"] == []   # ไม่แฮช ไม่นับว่าผิด
            assert _program_state() == before
            gate.release()
            gate.release()
            # คืนช่องทุกทาง: รหัสผิด (403) และสำเร็จ
            _expect(lambda: _post(ns.rnd, code="wrong-code-000"), 403)
            out = _post(ns.rnd)
            assert out["active"]["id"]
            assert gate.acquire(blocking=False) and gate.acquire(blocking=False), "ช่องถูกคืนครบ"
    # ล็อกอินยังใช้ข้อความของตัวเอง
    assert "WL_LOGIN_BUSY" in inspect.getsource(mock_api.wl_login)


# ── ปฏิเสธ ─────────────────────────────────────────────────────────────────
def test_reasons_give_409_and_nothing_changes():
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        next(r for r in db.tables["wl_rows"] if r["teacher_id"] is not None)["confirmed"] = False
        before, db_before = _program_state(), _db_snapshot(db)
        d = _expect(lambda: _post(ns.rnd), 409, "ยังไม่ยืนยัน 1 รายการ")
        assert _program_state() == before and _db_snapshot(db) == db_before
        log = _main_log(rec)
        assert _writes(log) == [] and "COMMIT" not in [s for s, _p in log], log
        assert log[0][0] == "SELECT pg_advisory_xact_lock(%s)", log[0]      # ตรวจซ้ำในธุรกรรม หลังถือล็อก
        assert rec.calls == [("flush", True)] and rec.logged == []
    # addendum ข้อ 3 (Ruling T3 C2): มีเทอมปี/ภาคนี้ในโปรแกรมอยู่แล้ว → ข้อความเดียวกับรายการรอบ/หน้าดูก่อนสร้าง
    with _world(terms=(ACTIVE5, {"id": 6, "year": 2569, "semester": 2, "label": "2/2569", "status": "closed"})) as rec:
        db, ns = _rich()
        rec.use(db)
        before, db_before = _program_state(), _db_snapshot(db)
        d = _expect(lambda: _post(ns.rnd), 409)
        assert d == mock_api._term_exists_reasons([{"year": 2569, "semester": 2}], 2569, 2)[0], d
        assert "มีเทอม 2/2569" in d
        assert _program_state() == before and _db_snapshot(db) == db_before and rec.conns == []
    # ปี/ภาคไม่ตรงรอบ → เหตุข้อ 1 · ไม่มีรอบ → 404
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        _expect(lambda: _post(ns.rnd, year=2570, semester=1), 409, "รอบนี้เป็นของภาคเรียน 2/2569")
        _expect(lambda: mock_api.create_term({"year": 2569, "semester": 2, "round_id": 9999,
                                              "admin_code": ADMIN_CODE}), 404)
        assert all(_writes(c.cur.log) == [] and c.commits == 0 for c in rec.conns)


def test_running_unsaved_term_is_a_reason_in_the_list_preview_and_post():
    # รีวิวทั้งสาขา M2: เว็บจริงยังไม่มีแถวใน app_terms — ปุ่มสร้างเทอมเก็บตารางที่ลงไว้เป็นเทอมปี/ภาคตามการตั้งค่า (_archive_target_or_refuse)
    # รอบของภาคเรียนนั้นเองจึงสร้างไม่ได้ (409) — รายการรอบและหน้าดูก่อนสร้างต้องบอกเหตุเดียวกัน ข้อความเดียวกัน ไม่ขึ้น "ใช้ได้"
    blank = {"id": None, "year": None, "semester": None, "label": None, "status": None}

    def three(rec, ns):
        (row,) = [r for r in mock_api.terms_rounds() if r["id"] == ns.rnd["id"]]
        prev = mock_api.terms_preview(round_id=str(ns.rnd["id"]))["round"]
        return row, prev
    # (ก) การกดครั้งแรกบนเว็บจริง: ไม่มีเทอมที่บันทึกไว้ · มีคาบ · ตั้งค่า 2/2569 = ภาคเรียนของรอบ
    with _world(terms=(), current=blank, subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        mock_api.SCHOOL_CONFIG.update({"term": "2", "year": "2569"})
        want = mock_api._term_running_reasons([], 2569, 2)
        assert len(want) == 1 and _thai(want[0]) and "มีเทอม 2/2569" in want[0] and "กำลังใช้อยู่" in want[0], want
        row, prev = three(rec, ns)
        assert row["usable"] is False and row["reasons"][0] == want[0], row
        assert prev["usable"] is False and prev["reasons"][0] == want[0], prev
        before, db_before = _program_state(), _db_snapshot(db)
        d = _expect(lambda: _post(ns.rnd), 409)
        assert d == want[0], d                                          # ข้อความเดียวกันทั้งสามที่
        assert _program_state() == before and _db_snapshot(db) == db_before and rec.conns == []
        # ไม่มีคาบ = ไม่มีตารางให้เก็บ → ไม่ใช่เหตุ (ปุ่มไม่เก็บเทอม ตามเดิม)
        with _patched(SLOTS=[], PARKED=[]):
            assert mock_api._term_running_reasons([], 2569, 2) == []
            row, prev = three(rec, ns)
            assert row["usable"] is True and prev["reasons"] == [], (row, prev)
    # (ข) ตั้งค่า 1/2569 → รอบ 2/2569 คือภาคเรียนถัดไป: ใช้ได้ทั้งสามที่ และสร้างได้จริง (ตารางเดิมถูกเก็บเป็นเทอม 1/2569)
    with _world(terms=(), current=blank, subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        row, prev = three(rec, ns)
        assert row["usable"] is True and prev["usable"] is True and prev["reasons"] == [], (row, prev)
        out = _post(ns.rnd)
        assert [(t["year"], t["semester"], t["status"]) for t in db.terms] == [(2569, 1, "closed"), (2569, 2, "active")]
        assert out["active"]["id"] == db.terms[1]["id"]
    # (ค) บอกไม่ได้ว่าตารางเป็นของเทอมไหน (การตั้งค่าว่าง) / ปี-ภาคนั้นมีแถวเก็บไว้แล้ว → ปุ่มปฏิเสธทุกรอบ:
    #     รายการ/หน้าดูก่อนสร้างบอกเหตุเดียวกับ 409 ของ POST
    for terms, cfg in (((), {"term": "", "year": ""}),
                       (({"id": 3, "year": 2569, "semester": 1, "label": "1/2569", "status": "closed"},),
                        {"term": "1", "year": "2569"})):
        with _world(terms=terms, current=blank, subjects=_elective_on_program()) as rec:
            db, ns = _rich()
            rec.use(db)
            mock_api.SCHOOL_CONFIG.update(cfg)
            row, prev = three(rec, ns)
            d = _expect(lambda: _post(ns.rnd), 409)
            assert row["reasons"] == [d] and prev["reasons"] == [d] and "ตารางเดิมจะไม่มีที่เก็บ" in d, (row, prev, d)
    # (ง) มีแถว active = ปุ่มปิดแถวนั้น ไม่ได้เก็บตารางเป็นเทอมใหม่ → ไม่มีเหตุนี้ (เหตุ "มีเทอมนี้แล้ว" ของ app_terms ตามเดิม)
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        mock_api.SCHOOL_CONFIG.update({"term": "2", "year": "2569"})
        assert mock_api._term_running_reasons(_terms_view(db), 2569, 2) == []


def test_active_term_changed_meanwhile_is_409():
    # อ่านแถว active ก่อนเปิดธุรกรรม (เหมือนปุ่มเดิม) แล้วอีกคำขอสร้างเทอมไปก่อน → ตรวจซ้ำในธุรกรรม ไม่ทับแถวของอีกฝั่ง
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        stale = dict(ACTIVE5, id=4)
        with _patched(_term_active=lambda: stale):
            before, db_before = _program_state(), _db_snapshot(db)
            _expect(lambda: _post(ns.rnd), 409, "ข้อมูลเดิมยังอยู่ครบ", mock_api.TERM_ACTIVE_MOVED)
        assert _program_state() == before and _db_snapshot(db) == db_before
        assert _writes(_main_log(rec)) == []


def test_wrong_code_403_and_counted():
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        before, db_before = _program_state(), _db_snapshot(db)
        for bad in ("wrong-code-000", HEAD_CODE, "  " + HEAD_CODE + " "):   # รหัสหัวหน้ากลุ่มไม่ใช่รหัส admin
            n = len(mock_api._WL_FAILS["login"])
            _expect(lambda: _post(ns.rnd, code=bad), 403)
            assert len(mock_api._WL_FAILS["login"]) == n + 1, bad   # นับร่วมกับการล็อกอินของเว็บ
        assert _program_state() == before and _db_snapshot(db) == db_before
        assert rec.conns == [] and rec.calls == [], (rec.conns, rec.calls)   # ยังไม่เปิดธุรกรรม ยังไม่ล้างคิว
        # รหัส admin ที่ปิดใช้แล้ว = ผิด
        for r in db.tables["wl_codes"]:
            if r["role"] == "admin":
                r["active"] = False
        _expect(lambda: _post(ns.rnd), 403)
        for r in db.tables["wl_codes"]:
            r["active"] = True
        # ผิดเกินเกณฑ์ → ถูกจำกัดเหมือนล็อกอิน (ก่อนแฮช แม้รหัสถูก)
        mock_api._WL_FAILS["login"][:] = [mock_api._time.monotonic()] * mock_api.WL_LOGIN_FAIL_LIMIT
        d = _expect(lambda: _post(ns.rnd), 429)
        assert "เข้าสู่ระบบ" not in d, d                  # รีวิวทั้งสาขา M11: ข้อความของหน้าต่างสร้างเทอม
        assert rec.conns == [] and _program_state() == before
        mock_api._WL_FAILS["login"].clear()
        # รหัสถูก (ตัดช่องว่างหัวท้ายเหมือนล็อกอิน) → ผ่าน
        out = _post(ns.rnd, code=f" {ADMIN_CODE} ")
        assert out["active"]["id"]


def test_missing_code_400():
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        before = _program_state()
        for bad in ({"admin_code": None}, {"admin_code": ""}, {"admin_code": "   "}, {"admin_code": 1234}, {}):
            body = {"year": 2569, "semester": 2, "round_id": ns.rnd["id"], **bad}
            _expect(lambda: mock_api.create_term(body), 400, "รหัสผู้ดูแลระบบ")
        for bad_round in ("1", 1.0, True, 0, -1, 2 ** 63, [1]):
            _expect(lambda: mock_api.create_term({"year": 2569, "semester": 2, "round_id": bad_round,
                                                  "admin_code": ADMIN_CODE}), 400)
        for y, s in ((2569, 3), (1999, 2), ("2569", 2), (2569, True)):
            _expect(lambda: mock_api.create_term({"year": y, "semester": s, "round_id": ns.rnd["id"],
                                                  "admin_code": ADMIN_CODE}), 400)
        assert mock_api._WL_FAILS["login"] == [] and rec.wl_logs == [] and rec.conns == []
        assert _program_state() == before
        with _patched(_STORE_KIND="file"):
            _expect(lambda: _post(ns.rnd), 400)       # ไม่ได้ต่อฐานข้อมูล — เหมือนปุ่มเดิม


def test_round_already_exported_409():
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        r = next(x for x in db.tables["wl_rounds"] if x["id"] == ns.rnd["id"])
        r.update(status="closed", exported_at=dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc), exported_label="2/2569")
        before, db_before = _program_state(), _db_snapshot(db)
        _expect(lambda: _post(ns.rnd), 409, "ส่งเข้าโปรแกรมจัดตารางแล้ว")
        assert _program_state() == before and _db_snapshot(db) == db_before
    # รอบถูกทำเครื่องหมายไปแล้วระหว่างนี้ (UPDATE … AND exported_at IS NULL ได้ 0 แถว) → 409 และย้อนทุกอย่าง
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        real = mock_api._wl_export_source

        def source_then_mark(cur, rid):
            src = real(cur, rid)
            next(x for x in db.tables["wl_rounds"] if x["id"] == rid)["exported_at"] = \
                dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc)
            return src
        before = _program_state()
        with _patched(_wl_export_source=source_then_mark):
            _expect(lambda: _post(ns.rnd), 409, "ข้อมูลเดิมยังอยู่ครบ")
        assert _program_state() == before
        assert [t["status"] for t in db.terms] == ["active"] and db.app_state is None
        assert all(w["sched_id"] is not None or w["id"] == ns.new_t["id"] for w in db.tables["wl_teachers"])
        assert next(w for w in db.tables["wl_teachers"] if w["id"] == ns.new_t["id"])["sched_id"] is None


def test_report_returned():
    with _world(subjects=_elective_on_program()) as rec:
        db, ns = _rich()
        rec.use(db)
        want = _expected(db, ns.rnd)
        new_teacher_wl = ns.new_t["id"]
        out = _post(ns.rnd)
        rep = out["report"]
        assert set(out) == {"closed", "active", "save_error", "save_pending", "report"}, set(out)
        # report ของ _term_build ทั้งก้อน + ค่าก่อนเปลี่ยนให้ปลดล็อกเทอมย้อนได้ (Task 5)
        assert {k: rep[k] for k in want["report"]} == want["report"]
        assert set(rep) == set(want["report"]) | {"prior_status", "teachers", "subjects", "created_wl_subjects",
                                                  "created_subjects", "bound_lines", "bound_options"}, set(rep)
        assert rep["prior_status"] == "filling"
        new_id = next(t["id"] for t in mock_api.TEACHERS if t["name"] == "ครูใหม่")
        assert rep["teachers"] == [{"id": new_teacher_wl, "old": None, "new": new_id}], rep["teachers"]
        assert rep["subjects"] == [], rep["subjects"]
        wl_zz9 = next(r["id"] for r in db.tables["wl_subjects"] if r["code"] == "ZZ9")
        assert rep["created_wl_subjects"] == [wl_zz9]
        zz9_sched = next(r["sched_id"] for r in db.tables["wl_subjects"] if r["id"] == wl_zz9)
        assert rep["created_subjects"] == [{"id": wl_zz9, "old": None, "new": zz9_sched}] and zz9_sched, rep["created_subjects"]
        assert rep["bound_lines"] == [ns.line["id"]] and rep["bound_options"] == [ns.opt["id"]]
        assert len(rep["activity_sets"]) == len(want["report"]["activity_sets"])
        stored = next(r for r in db.tables["wl_rounds"] if r["id"] == ns.rnd["id"])["export_report"]
        assert stored == json.loads(json.dumps(rep)) and json.dumps(rep, ensure_ascii=False)


def test_test_hook_is_one_env_var_read_at_call_time():
    # Ruling P2: ตัวแปรเดียว อ่านตอนเรียก ไม่ตั้ง = ไม่มีผล · ค่าที่ไม่รู้จักไม่มีผล
    assert mock_api.TERM_TEST_FAIL_ENV == ENV
    os.environ.pop(ENV, None)
    for step in STEPS:
        mock_api._term_test_fail(step)
    os.environ[ENV] = "nonsense"
    try:
        for step in STEPS:
            mock_api._term_test_fail(step)
        os.environ[ENV] = "mark"
        try:
            mock_api._term_test_fail("mark")
        except RuntimeError:
            pass
        else:
            raise AssertionError("ตั้งแล้วต้องล้ม")
        # wait:<ขั้น> = หน่วงที่ขั้นนั้นแทนการล้ม (ลองกับของจริงว่าคำขอที่แทรกในช่องนั้นถูกจับ — addendum ข้อ 5) · ขั้นอื่นไม่หน่วง
        slept = []
        with _patched(_time=SimpleNamespace(sleep=slept.append, monotonic=mock_api._time.monotonic)):
            os.environ[ENV] = "wait:built"
            for step in STEPS:
                mock_api._term_test_fail(step)
        assert slept == [mock_api.TERM_TEST_WAIT_SECONDS], slept
    finally:
        os.environ.pop(ENV, None)


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
