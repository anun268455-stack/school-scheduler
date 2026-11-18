"""
ขั้นที่ 3 งานที่ 5: ปลดล็อกเทอม — ทะเบียนของเว็บชี้ตามข้อมูลของเทอมที่เปิดอยู่ ไม่ว่าจะปลดล็อกลำดับใด (แบบข้อ 4.8 ตามคำตัดสินแก้รอบ 2:
ปรับเทียบทุกรอบที่ส่งแล้วหลังทุกการปลดล็อก) และรอบที่ส่งแล้วแก้ไม่ได้ถาวร (แบบข้อ 4.7 — ข้อความตามว่าเทอมของรอบเปิดอยู่ไหม)

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
from wlexportcreate import (ACTIVE5, ENV, PROGRAM, ROTATE_UPDATE, UPSERT, TermConn, TermCur, _db_snapshot,
                            _elective_on_program, _expect, _patched_attr, _post, _program_state, _rich, _world, _writes)
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


ACTIVE_MSG = "รอบนี้ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569"
CLOSED_MSG = "รอบนี้ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569 (ถูกปิดไว้ ปลดล็อกเทอมนั้นเพื่อใช้ต่อ)"
DONE_MSG = "รอบนี้ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569 (ปิดภาคเรียนแล้ว)"


def _exported(rec, richer=True):
    """ฉากครบทุกทาง → ส่งรอบด้วยทางจริง → (db, ns) · ns.before/after = wl_* ก่อน/หลังส่ง · ns.rep · ns.new_id (B)"""
    db, ns = (_richer() if richer else _rich())
    rec.use(db)
    ns.before = _wl(db)
    out = _post(ns.rnd)
    ns.rep, ns.new_id, ns.after = out["report"], out["active"]["id"], _wl(db)
    return db, ns


def _rows_of(snap, table):
    return {r["id"]: r for r in snap[table]}


def _unlock(term_id, label):
    return mock_api.unlock_term(term_id, {"confirm": label})


def _consistent(db, tag, rounds=None):
    """หลังทุกขั้น: ทุก sched_id ที่ไม่ว่างของเว็บอยู่ในเทอมที่เปิด · ปุ่มดึงครู/วิชา (ดูก่อน) สร้าง 0 แถว · รอบที่ส่งแล้วไม่ถูกแตะ"""
    open_t, open_s = {t["id"] for t in mock_api.TEACHERS}, {x["id"] for x in mock_api.SUBJECTS}
    wl_t = {r["sched_id"] for r in db.tables["wl_teachers"] if r["sched_id"] is not None}
    wl_s = {r["sched_id"] for r in db.tables["wl_subjects"] if r["sched_id"] is not None}
    assert wl_t <= open_t and wl_s <= open_s, (tag, sorted(wl_t - open_t), sorted(wl_s - open_s))
    pt = _call(db, ADMIN, mock_api.wl_teachers_import_preview, REQ)
    ps = _call(db, ADMIN, mock_api.wl_subjects_import_preview, REQ)
    assert pt["created"] == 0 and ps["created"] == 0, (tag, pt, ps)
    for rid, row in (rounds or {}).items():
        assert _round_row(db, rid) == row, (tag, rid)


# ── ฟังก์ชันล้วน: ปรับเทียบทะเบียน ──────────────────────────────────────────────────
def _rep(teachers=(), subjects=(), created=()):
    return {"teachers": [dict(id=i, old=o, new=n) for i, o, n in teachers],
            "subjects": [dict(id=i, old=o, new=n) for i, o, n in subjects],
            "created_subjects": [dict(id=i, old=None, new=n) for i, n in created]}


def _now(teachers=(), subjects=()):
    t = {i: (v, f"ครู{i}") for i, v in teachers}
    s_ = {i: (v, f"วิชา{i}") for i, v in subjects}
    return {"teachers": t, "subjects": s_,
            "teacher_held": {v: (i, n) for i, (v, n) in t.items() if v is not None},
            "subject_held": {v: (i, n) for i, (v, n) in s_.items() if v is not None}}


def _sets(res):
    return {(x["table"], x["id"]): (x["from"], x["to"]) for x in res["set"]}


def test_reconcile_follows_the_open_terms_data():
    rc = mock_api.wl_registry_reconcile
    r1 = _rep(teachers=[(1, None, 8), (2, 598, 9), (3, 5, 144)], subjects=[(21, None, 906)], created=[(22, 907)])
    after = _now(teachers=[(1, 8), (2, 9), (3, 144)], subjects=[(21, 906), (22, 907)])
    # เปิดเทอมก่อนส่ง (ไม่มี 8 9 144 907 · มี 5 906): ค่าใหม่ไม่อยู่ → ค่าเดิมของรอบที่เก่าสุดถ้าอยู่ในเทอมที่เปิด ไม่งั้นว่าง
    res = rc([r1], {5, 501}, {906}, after)
    assert _sets(res) == {("wl_teachers", 1): (8, None), ("wl_teachers", 2): (9, None), ("wl_teachers", 3): (144, 5),
                          ("wl_subjects", 22): (907, None)}, res
    assert res["skipped"] == []
    # เปิดเทอมของรอบ (หรือเทอมที่สืบมา) จากสถานะหลังย้อน → ค่าใหม่ทั้งหมด · แถวที่ตรงอยู่แล้วไม่อยู่ในรายการ
    back = _now(teachers=[(1, None), (2, None), (3, 5)], subjects=[(21, 906), (22, None)])
    res = rc([r1], {5, 8, 9, 144}, {906, 907}, back)
    assert _sets(res) == {("wl_teachers", 1): (None, 8), ("wl_teachers", 2): (None, 9), ("wl_teachers", 3): (5, 144),
                          ("wl_subjects", 22): (None, 907)}, res
    assert rc([r1], {8, 9, 144}, {906, 907}, after) == {"set": [], "skipped": []}
    # หลายรอบ: ไล่จากรอบใหม่ไปเก่า — รอบแรกที่ค่าใหม่อยู่ในเทอมที่เปิดชนะ
    r2 = _rep(teachers=[(1, 8, 20)])
    now2 = _now(teachers=[(1, 20)])
    assert _sets(rc([r1, r2], {8, 20}, set(), now2)) == {}
    assert _sets(rc([r1, r2], {8}, set(), now2)) == {("wl_teachers", 1): (20, 8)}
    assert _sets(rc([r1, r2], set(), set(), now2)) == {("wl_teachers", 1): (20, None)}
    # กฎให้สองแถวชี้รหัสเดียวกัน (ก. new 144 ไม่มี → old 5 · ข. new 5 มี) → แถวที่ถือ 5 อยู่และไม่ย้ายชนะ · ก. ข้าม และเพราะ 144 ไม่มี
    # ในเทอมที่เปิด จึงตั้งว่าง (ไม่ปล่อยชี้ของที่ไม่มี) · รหัสของโปรแกรมไม่เคยใช้ซ้ำ ข้อมูลการส่งจริงไม่ให้คู่แบบนี้ — นี่คือทางกันไว้
    clash = _rep(teachers=[(1, 5, 144), (2, None, 5)])
    res = rc([clash], {5}, set(), _now(teachers=[(1, 144), (2, 5)]))
    assert _sets(res) == {("wl_teachers", 1): (144, None)} and len(res["skipped"]) == 1, res
    # แถวที่ถือค่าปลายทางอยู่แต่กำลังย้ายออกในชุดเดียวกัน ไม่ถือว่าชน
    vacate = _now(teachers=[(1, None), (2, 8)])                       # ข. ถือ 8 อยู่ แต่ปลายทางของ ข. คือ 9
    res = rc([_rep(teachers=[(1, None, 8)]), _rep(teachers=[(2, None, 9)])], {8, 9}, set(), vacate)
    assert res["skipped"] == [] and _sets(res) == {("wl_teachers", 1): (None, 8), ("wl_teachers", 2): (8, 9)}, res
    assert mock_api.wl_registry_reconcile_sql(res) == [
        ("UPDATE wl_teachers SET sched_id = %s WHERE id = %s AND sched_id = %s", (None, 2, 8)),
        ("UPDATE wl_teachers SET sched_id = %s WHERE id = %s AND sched_id IS NULL", (8, 1)),
        ("UPDATE wl_teachers SET sched_id = %s WHERE id = %s AND sched_id IS NULL", (9, 2))]
    # ชน: ค่าปลายทางมีแถวอื่น (ไม่ได้อยู่ในชุดที่ย้าย) ถืออยู่ → ข้าม พร้อมชื่อทั้งสองฝ่าย · ค่าเดิมของแถวที่ข้ามไม่อยู่ในเทอมที่เปิด → ตั้งว่าง
    held = _now(teachers=[(1, None), (2, None)])
    held["teacher_held"][8] = (99, "ครูที่ผูกรหัสไปก่อน")
    res = rc([r1], {8, 9}, set(), held)
    assert _sets(res) == {("wl_teachers", 2): (None, 9)}, res
    (msg,) = res["skipped"]
    assert "ครู1" in msg and "ครูที่ผูกรหัสไปก่อน" in msg and "8" in msg and _thai(msg), msg
    stale = _now(teachers=[(1, 77)])
    stale["teacher_held"][8] = (99, "ครูที่ผูกรหัสไปก่อน")
    res = rc([_rep(teachers=[(1, None, 8)])], {8}, set(), stale)
    assert _sets(res) == {("wl_teachers", 1): (77, None)} and "ยังไม่ผูก" in res["skipped"][0], res
    # คำสั่ง: สองรอบ (ว่างก่อน แล้วค่อยใส่ — สลับเลขกันได้) ทุกคำสั่งระบุค่าปัจจุบัน
    sql = mock_api.wl_registry_reconcile_sql({"set": [{"table": "wl_teachers", "id": 1, "from": 144, "to": 5},
                                                      {"table": "wl_teachers", "id": 2, "from": 5, "to": None}],
                                              "skipped": []})
    assert sql == [("UPDATE wl_teachers SET sched_id = %s WHERE id = %s AND sched_id = %s", (None, 1, 144)),
                   ("UPDATE wl_teachers SET sched_id = %s WHERE id = %s AND sched_id = %s", (None, 2, 5)),
                   ("UPDATE wl_teachers SET sched_id = %s WHERE id = %s AND sched_id IS NULL", (5, 1))], sql


def test_reconcile_skips_every_row_moving_to_the_same_target():
    # รีวิวทั้งสาขา M7: หลายแถวจะย้ายไปค่าเป้าหมายเดียวกันที่ยังไม่มีใครถือ (เกิดได้จากกู้สำรอง/แก้ฐานเอง) — ปล่อยไป UNIQUE (sched_id)
    # ล้มทั้งการปลดล็อก และทุกการปลดล็อกถัดไปล้มเหมือนเดิมตลอด → ข้ามทุกแถวในกลุ่มนั้น + เหตุไทยมีชื่อทุกแถว · ค่าเดิมไม่อยู่ในเทอมที่เปิด = ตั้งว่าง
    rc = mock_api.wl_registry_reconcile
    reps = [_rep(teachers=[(1, 7, 10)]), _rep(teachers=[(2, 7, 11)])]
    res = rc(reps, {7}, set(), _now(teachers=[(1, 10), (2, 11)]))
    assert _sets(res) == {("wl_teachers", 1): (10, None), ("wl_teachers", 2): (11, None)}, res
    assert len(res["skipped"]) == 2 and all(_thai(m) and "ครู1" in m and "ครู2" in m and "7" in m
                                           for m in res["skipped"]), res["skipped"]
    assert not any(p[0] == 7 for _sql, p in mock_api.wl_registry_reconcile_sql(res)), res
    # ค่าเดิมยังอยู่ในเทอมที่เปิด → คงไว้ (ไม่อยู่ใน set) · แถวที่สามจะไปค่าที่แถวที่ถูกข้ามยังถืออยู่ → ข้ามต่อ (ไม่ชนกับค่าที่คงไว้)
    reps3 = [_rep(teachers=[(1, None, 7)]), _rep(teachers=[(2, None, 7)]), _rep(teachers=[(3, None, 10)])]
    res = rc(reps3, {7, 10}, set(), _now(teachers=[(1, 10), (2, None), (3, None)]))
    assert _sets(res) == {} and len(res["skipped"]) == 3, res
    assert any("ครู3" in m and "ครู1" in m for m in res["skipped"]), res["skipped"]
    # ไม่มีสองแถวไปเป้าเดียว = กฎเดิม (ไม่ข้ามอะไร)
    res = rc([_rep(teachers=[(1, 7, 10)]), _rep(teachers=[(2, 7, 11)]), _rep(teachers=[(3, 10, 7)])], {7, 10, 11},
             set(), _now(teachers=[(1, 12), (2, 13), (3, 14)]))
    # 3 → 7 ชนะ (รอบใหม่สุด ค่าใหม่อยู่ในเทอมที่เปิด) · 1 → 10 · 2 → 11 — ไม่มีสองแถวไปเป้าเดียว ไม่ข้าม
    assert _sets(res) == {("wl_teachers", 1): (12, 10), ("wl_teachers", 2): (13, 11), ("wl_teachers", 3): (14, 7)}, res
    assert res["skipped"] == []
    # วิชาก็ใช้กฎเดียวกัน · แถวที่ยังไม่ผูก (ค่าเดิมว่าง) ข้ามแล้วไม่มีอะไรต้องตั้ง
    res = rc([_rep(subjects=[(21, None, 906)]), _rep(subjects=[(22, None, 906)])], set(), {906},
             _now(subjects=[(21, None), (22, None)]))
    assert _sets(res) == {} and len(res["skipped"]) == 2 and all("วิชา" in m for m in res["skipped"]), res
    # ผ่านการปลดล็อกจริง (ฐานปลอมตรวจ UNIQUE): ปลดล็อกสำเร็จ แถวทั้งสองถูกข้ามและอยู่ในข้อความผล/บันทึกเทอม · ไม่ 500
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        new_sched = next(w["new"] for w in ns.rep["teachers"] if w["id"] == ns.new_t["id"])
        _unlock(5, "1/2569")                                             # เทอมก่อนส่ง: ครูใหม่ไม่มี → แถวของเว็บว่าง
        twin = db.add("wl_teachers", sched_id=None, name="ครูแฝดจากสำรอง", department_id=1)
        db.add("wl_rounds", year=2568, semester=2, label="2/2568", status="closed", exported_term_id=5,
               exported_label="2/2568", exported_at=mock_api._dt.datetime(2026, 1, 1, tzinfo=mock_api._dt.timezone.utc),
               export_report={"teachers": [{"id": twin["id"], "old": None, "new": new_sched}], "subjects": [],
                              "created_subjects": []})
        del rec.logged[:]
        res = _unlock(ns.new_id, "2/2569")                               # ครูใหม่กลับมา: สองแถวอยากชี้รหัสเดียวกัน
        rows = _rows_of(_wl(db), "wl_teachers")
        assert rows[ns.new_t["id"]]["sched_id"] is None and rows[twin["id"]]["sched_id"] is None, rows[twin["id"]]
        (note,) = res["workload"]
        assert "ข้าม 2 รายการ" in note and "ครูแฝดจากสำรอง" in note and "ครูใหม่" in note, note
        assert "ครูแฝดจากสำรอง" in rec.logged[-1][2], rec.logged


def test_export_records_created_subjects_for_reconcile():
    with _world(subjects=_subjects_with_906()) as rec:
        db, ns = _exported(rec)
        created = ns.rep["created_wl_subjects"]
        assert ns.rep["created_subjects"] == [{"id": i, "old": None, "new": _rows_of(ns.after, "wl_subjects")[i]["sched_id"]}
                                              for i in created] and created, ns.rep["created_subjects"]


# ── ปลดล็อกโดยไม่มีรอบที่ส่งแล้วเลย: โค้ดเดิม ─────────────────────────────────────
def test_unlock_without_export_is_unchanged():
    with _world() as rec, _unlockable(rec):
        db, ns = _rich()
        rec.use(db)
        mock_api.create_term({"year": 2569, "semester": 2})            # ปุ่มเดิม → เทอม 16 active · ไม่มีรอบที่ส่งแล้ว
        wl_before, n_conns = _wl(db), len(rec.conns)
        del rec.logged[:]
        out = _unlock(5, "1/2569")
        swap = rec.conns[n_conns:]
        assert len(swap) == 1, len(swap)
        log = swap[0].cur.log
        assert [s for s, _p in log] == TERMS_DDL + [ROTATE_UPDATE, ACTIVATE, "COMMIT"], [s for s, _p in log]
        assert log[2][1][1:] == (0, 16) and log[3][1] == (5,), (log[2][1][1:], log[3][1])
        assert _wl(db) == wl_before
        # ทาง ข. Task 4: ไม่มีรอบที่ส่งแล้ว → ถามต่อว่าเคยอัปเดตแผนกลางเทอมไหม (อ่านอย่างเดียว) · ไม่เคยทั้งสอง = ทางเดิม
        assert rec.wl_logs[-1] == [("SELECT id FROM wl_rounds WHERE export_report IS NOT NULL LIMIT 1", ()),
                                   ("SELECT id FROM wl_plan_updates LIMIT 1", ())], rec.wl_logs[-1]
        assert set(out) == {"closed", "active", "save_error", "save_pending"}, set(out)
        assert out["closed"]["id"] == 16 and out["active"]["id"] == 5 and mock_api.CURRENT_TERM == ACTIVE5
        assert rec.logged == [(16, "close", "ปิดเทอม 2/2569 (0 คาบ)"), (5, "unlock", "ปลดล็อกเทอม 1/2569")], rec.logged
    # ไม่มีแถว active (ทางเก็บเทอมแรก): ไม่ถามตารางของรอบเลย
    blank = {"id": None, "year": None, "semester": None, "label": None, "status": None}
    with _world(terms=({**ACTIVE5, "status": "closed"},), current=blank) as rec, _unlockable(rec):
        db, ns = _rich()
        rec.use(db)
        db.terms[0]["data"] = mock_api._pack(mock_api._snapshot())
        mock_api.SCHOOL_CONFIG.update({"term": "2", "year": "2569"})
        assert _unlock(5, "1/2569")["active"]["id"] == 5 and rec.wl_logs == [], rec.wl_logs
    src = inspect.getsource(mock_api.unlock_term)
    assert "closed_id = _term_swap_active(\n            old_id, old_blob, old_slots, term_id," in src


# ── A ↔ B: ปรับเทียบในธุรกรรมเดียวกับการสลับเทอม ─────────────────────────────────
def test_unlock_reconciles_in_the_swap_transaction():
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        mem_before_export = None
        rid, rnd_after = ns.rnd["id"], copy.deepcopy(_round_row(db, ns.rnd["id"]))
        for cycle in range(2):
            n_conns = len(rec.conns)
            del rec.logged[:]
            res = _unlock(5, "1/2569")                                   # A: เทอมก่อนส่ง
            conn = rec.conns[-1]
            log = conn.cur.log
            stmts = [s for s, _p in log]
            assert len(rec.conns) == n_conns + 1 and conn.commits == 1 and stmts[-1] == "COMMIT", stmts
            assert log[0] == LOCK, log[0]                                # ล็อกทะเบียนเป็นคำสั่งแรก
            # ทาง ข. Task 4: อ่านเวลาส่งด้วย แล้วรวมกับประวัติการอัปเดตกลางเทอมตามเวลา (wl_writeback_history)
            assert log[1] == ("SELECT export_report, exported_at FROM wl_rounds WHERE export_report IS NOT NULL "
                              "ORDER BY exported_at, id", ()), log[1]
            assert log[2] == ("SELECT report, at FROM wl_plan_updates ORDER BY at, id", ()), log[2]
            assert not any(s.split()[0].upper() in ("CREATE", "ALTER", "DROP", "LOCK") for s in stmts), stmts
            i_open = stmts.index(ACTIVATE)
            regs = [i for i, s in enumerate(stmts) if s.startswith("UPDATE wl_")]
            assert regs and min(regs) > i_open, stmts                    # ทะเบียนหลังสลับเทอม
            assert not any(s.startswith(("UPDATE wl_rounds", "UPDATE wl_curriculum_lines", "UPDATE wl_term_set_options"))
                           for s in stmts), stmts                        # ไม่แตะรอบ ไม่ถอดการผูก
            now = _wl(db)
            t_now, t_before = _rows_of(now, "wl_teachers"), _rows_of(ns.before, "wl_teachers")
            assert t_now[ns.new_t["id"]]["sched_id"] is None
            assert t_now[ns.stale["id"]]["sched_id"] is None             # 598 ไม่มีในเทอมที่เปิด → ว่าง (กฎใหม่)
            assert {i: r for i, r in t_now.items() if i not in (ns.stale["id"],)} == \
                   {i: r for i, r in t_before.items() if i not in (ns.stale["id"],)}
            s_now = _rows_of(now, "wl_subjects")
            assert s_now[ns.wl_sub["id"]]["sched_id"] == 906             # วิชาที่ผูกด้วยรหัส มีในเทอมที่เปิด → คงไว้
            assert all(s_now[i]["sched_id"] is None for i in ns.rep["created_wl_subjects"])
            for t in ("wl_curriculum_lines", "wl_term_set_options"):
                assert now[t] == ns.after[t], t                           # การผูกบรรทัด/ตัวเลือกไม่ถูกถอด
            assert _round_row(db, rid) == rnd_after                      # รอบไม่ถูกแตะ (exported_at เดิม)
            _consistent(db, f"A {cycle}", {rid: rnd_after})
            assert set(res) == {"closed", "active", "save_error", "save_pending", "workload"}
            (note,) = res["workload"]
            assert "ปรับทะเบียน" in note and "เทอม 1/2569" in note and "ครู 2 คน" in note and "วิชา 1 วิชา" in note, note
            assert rec.logged[-1] == (5, "unlock", "ปลดล็อกเทอม 1/2569 · ปรับทะเบียนของเว็บลงอัตรากำลังตามเทอมนี้ "
                                               "(ครู 2 คน · วิชา 1 วิชา)"), rec.logged
            code, detail = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_update, ns.line2["id"], REQ, None,
                                               {"name": "x"}))
            assert code == 409 and detail.startswith(CLOSED_MSG), (code, detail)
            res = _unlock(ns.new_id, "2/2569")                           # B: เทอมของรอบ
            now = _wl(db)
            for t in ("wl_teachers", "wl_subjects", "wl_curriculum_lines", "wl_term_set_options"):
                assert now[t] == ns.after[t], (cycle, t)                  # = หลังส่งตรงตัว
            _consistent(db, f"B {cycle}", {rid: rnd_after})
            assert "ครู 2 คน" in res["workload"][0] and "วิชา 1 วิชา" in res["workload"][0], res["workload"]
            code, detail = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_update, ns.line2["id"], REQ, None,
                                               {"name": "x"}))
            assert code == 409 and detail.startswith(ACTIVE_MSG) and "ถูกปิดไว้" not in detail, (code, detail)


# ── ลำดับอื่นของผู้ตรวจ (S1–S5): ทะเบียนตรงกับเทอมที่เปิดทุกขั้น ───────────────────────
def test_any_unlock_order_keeps_the_registry_on_the_open_term():
    def case(name, steps):
        with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
            db, ns = _exported(rec)
            rounds = {ns.rnd["id"]: copy.deepcopy(_round_row(db, ns.rnd["id"]))}
            terms = {"A": (5, "1/2569"), "B": (ns.new_id, "2/2569")}
            _consistent(db, f"{name} หลังส่ง", rounds)
            for step in steps:
                if step in ("C", "C'") and "C" not in terms:              # ครั้งแรก = สร้าง 1/2570 ด้วยปุ่มเดิม (ต่อจากเทอมที่เปิด)
                    terms["C"] = (mock_api.create_term({"year": 2570, "semester": 1})["active"]["id"], "1/2570")
                elif step in ("C", "C'"):                                  # ครั้งต่อไป = ปลดล็อก 1/2570
                    _unlock(*terms["C"])
                elif step == "R2":                                       # รอบที่สองส่งเข้า C: ครูใหม่ที่มีเฉพาะใน C
                    tid = mock_api.create_teacher({"name": "ครูของรอบสอง"})["id"]
                    z = db.add("wl_teachers", sched_id=tid, name="ครูของรอบสอง", department_id=1)
                    r2 = db.add("wl_rounds", year=2570, semester=1, label="1/2570", status="closed",
                                exported_term_id=terms["C"][0], exported_label="1/2570",
                                exported_at=mock_api._dt.datetime(2027, 5, 1, tzinfo=mock_api._dt.timezone.utc),
                                export_report={"teachers": [{"id": z["id"], "old": None, "new": tid}], "subjects": [],
                                               "created_subjects": [], "created_wl_subjects": [], "bound_lines": [],
                                               "bound_options": []})
                    rounds[r2["id"]] = copy.deepcopy(r2)
                    ns.z, ns.z_sched = z["id"], tid
                elif step == "pull":
                    _call(db, ADMIN, mock_api.wl_teachers_import, REQ)
                else:
                    _unlock(*terms[step])
                _consistent(db, f"{name} {step}", rounds)
                if hasattr(ns, "z"):
                    z_now = next(r for r in db.tables["wl_teachers"] if r["id"] == ns.z)["sched_id"]
                    assert z_now == (ns.z_sched if ns.z_sched in {t["id"] for t in mock_api.TEACHERS} else None), (name, step)
            return db, ns
    case("S1", ["C", "A", "B"])                      # ปลดล็อก A จาก C (ข้าม B) แล้ว B
    case("S2", ["C", "B", "A", "C", "pull", "B"])    # C → B → A → C (ทางเดิมเดิม) → ดึงครู → B
    case("S3", ["A", "C'", "B", "C"])                # ย้อน → ปุ่มเดิมจาก A → B → C'
    db, ns = case("S4", ["C", "B", "C"])             # ข้อค้นพบหลัก: C ต่อจาก B → ปลดล็อก B → ปลดล็อก C
    assert next(r for r in db.tables["wl_teachers"] if r["id"] == ns.new_t["id"])["sched_id"] is not None
    case("S5", ["C", "R2", "B", "C", "A", "C"])      # C จากรอบที่สอง → B → C → A → C


def test_unlock_writes_app_state_inside_the_transaction():
    # รีวิวทั้งสาขา I1 (แบบข้อ 4.4 ขั้น 7 ใช้กับการปลดล็อกที่ปรับเทียบด้วย): app_state เป็นสำเนาสดของเทอมที่เพิ่งเปิด ในธุรกรรมเดียวกับ
    # การสลับเทอมและการปรับทะเบียน — เครื่องดับหลัง COMMIT แล้วเริ่มใหม่ (โหลดจาก app_state อย่างเดียว) ต้องได้เทอมที่ฐานบอกว่าเปิด
    # ไม่ใช่เทอมที่เพิ่งปิด (ซึ่งครูที่ทะเบียนของเว็บไม่ชี้แล้ว → ปุ่มดึงครูสร้างแถวซ้ำ → ส่งรอบหน้าสร้างครูซ้ำในโปรแกรม)
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        for term_id, label in ((5, "1/2569"), (ns.new_id, "2/2569"), (5, "1/2569")):
            db.app_state = None
            steps = []
            real_fail = mock_api._term_test_fail

            def fail(step):
                steps.append((step, rec.conns[-1].commits if rec.conns else None))
                return real_fail(step)
            with _patched(_term_test_fail=fail):
                _unlock(term_id, label)
            log = [s_ for s_, _p in rec.conns[-1].cur.log]
            i_open, i_state = log.index(ACTIVATE), log.index(UPSERT)
            regs = [i for i, x in enumerate(log) if x.startswith("UPDATE wl_")]
            assert i_open < i_state < log.index("COMMIT") and log.count("COMMIT") == 1, log
            assert all(i < i_state for i in regs), log                  # สำเนาสดหลังปรับทะเบียน ก่อน COMMIT
            snap = mock_api._unpack(db.app_state)
            assert snap["current_term"] == {"id": term_id, "year": 2569, "semester": int(label[0]), "label": label,
                                            "status": "active"}, snap["current_term"]
            assert snap["teachers"] == mock_api.TEACHERS and snap["requirements"] == mock_api.REQUIREMENTS
            assert snap["slots"] == mock_api.SLOTS and snap["subjects"] == mock_api.SUBJECTS
            # จุดฉีด "เครื่องดับหลัง COMMIT" ของการปลดล็อก (SCHED_TEST_FAIL_AT=unlock_after_commit) อยู่หลัง COMMIT ทันที
            assert steps == [("unlock_after_commit", 1)], steps
            _consistent(db, f"app_state {label}")


def test_unlock_failure_restores_everything():
    # ล้มกลางธุรกรรม (หลังสลับเทอมและปรับทะเบียนแล้ว ก่อน COMMIT) → ฐานย้อนทั้งก้อน · หน่วยความจำกลับเป็นเทอมที่เปิดอยู่ · 500 ไทย
    # m4: คำขอเขียนอื่นจบระหว่างนั้น (รุ่นขยับ) → เซฟของที่คืนแล้วทับ + บวกรุ่น (แบบ _term_restore)
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        mem, snap = _program_state(), _db_snapshot(db)
        real_sql, real_swap = mock_api.wl_registry_reconcile_sql, mock_api._term_swap_active

        def miss(result):
            return real_sql(result) + [("UPDATE wl_teachers SET sched_id = %s WHERE id = %s AND sched_id IS NULL", (1, -1))]
        seen = []

        def at_rollback(_conn):                     # รีวิวทั้งสาขา M4: ROLLBACK ปล่อยล็อกทะเบียน — ตัวแปรต้องคืนแล้วก่อนถึงตรงนี้
            seen.append(_program_state())
        for concurrent in (False, True):
            def swap(*a, **kw):
                if concurrent:
                    mock_api.REVISION["n"] += 1
                    db.app_state = mock_api._pack(mock_api._snapshot())   # คิวเซฟของคำขออื่นเขียนเทอมที่ยังไม่ COMMIT ลงไปแล้ว
                    rec.conns[-1]._snap = _db_snapshot(db)                # (คนละการเชื่อมต่อ — ROLLBACK ของเราไม่ย้อนให้)
                return real_swap(*a, **kw)
            del rec.logged[:], seen[:]
            calls_before, rev = list(rec.calls), mock_api.REVISION["n"]
            with _patched(wl_registry_reconcile_sql=miss, _term_swap_active=swap), \
                    _patched_attr(TermConn, "on_rollback", at_rollback):
                _expect(lambda: _unlock(5, "1/2569"), 500, "ข้อมูลเดิมยังอยู่ครบ")
            # (ตัวนับไม่ถอย — _apply_snapshot เอาค่ามากสุด: ตรวจแค่ไม่น้อยกว่าเดิม เหมือนข้างล่าง)
            assert seen and all(not [k for k in PROGRAM if k not in ("REVISION", "_counters") and got[k] != mem[k]]
                                for got in seen), \
                [[k for k in PROGRAM if k not in ("REVISION", "_counters") and got[k] != mem[k]] for got in seen]
            now = _db_snapshot(db)
            assert now[:4] == snap[:4], concurrent                       # ตาราง wl_* และ app_terms เท่าเดิม
            after = _program_state()
            for k in PROGRAM:
                if k not in ("_counters", "REVISION"):
                    assert after[k] == mem[k], (concurrent, k)
            assert all(after["_counters"].get(k, 0) >= v for k, v in mem["_counters"].items()), after["_counters"]
            assert rec.logged == []
            saves = [c for c in rec.calls[len(calls_before):] if c[0] == "save"]
            assert len(saves) == (1 if concurrent else 0), (concurrent, rec.calls)
            assert mock_api.REVISION["n"] == rev + (2 if concurrent else 0), (concurrent, mock_api.REVISION)
            log = [s_ for s_, _p in rec.conns[-1].cur.log]
            if concurrent:
                # รีวิวทั้งสาขา M9: ของที่คืนแล้วลง app_state ตรง ๆ ก่อนตอบ (หลัง ROLLBACK การเชื่อมต่อเดียวกัน) ไม่รอคิวเซฟ
                i_rb = log.index("ROLLBACK")
                assert log[i_rb + 1:i_rb + 3] == [UPSERT, "COMMIT"] and rec.conns[-1].commits == 1, log[i_rb:]
                state = mock_api._unpack(db.app_state)
                assert state["current_term"] == mem["CURRENT_TERM"] and state["teachers"] == mem["TEACHERS"]
            else:
                assert now == snap and rec.conns[-1].commits == 0 and "COMMIT" not in log, log
        _unlock(5, "1/2569")
        _consistent(db, "ลองใหม่")


def test_unlock_records_the_running_term_after_the_registry_lock():
    # m2: ค่าที่ใช้คืน/บันทึก จดหลังได้ล็อกทะเบียน — ครูลงคาบระหว่างรอต้องนับในแถวเทอมที่ปิดและบันทึกประวัติ
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        real = mock_api._wl_registry_lock

        def lock_after_a_lesson(cur):
            mock_api.SLOTS.append({"id": 99, "group_id": 1, "day": 1, "period": 2})
            return real(cur)
        del rec.logged[:]
        with _patched(_wl_registry_lock=lock_after_a_lesson):
            _unlock(5, "1/2569")
        close = next(p for s, p in rec.conns[-1].cur.log if s == ROTATE_UPDATE)
        assert close[1] == 1 and len(mock_api._unpack(close[0])["slots"]) == 1, close[1:]
        assert rec.logged[0] == (ns.new_id, "close", "ปิดเทอม 2/2569 (1 คาบ)"), rec.logged


def test_reconcile_conflicts_are_listed_in_the_answer_and_the_term_log():
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        new_sched = next(w["new"] for w in ns.rep["teachers"] if w["id"] == ns.new_t["id"])
        _unlock(5, "1/2569")
        taker = db.add("wl_teachers", sched_id=new_sched, name="ครูที่ผูกรหัสไปก่อน", department_id=1)
        del rec.logged[:]
        res = _unlock(ns.new_id, "2/2569")
        now = _rows_of(_wl(db), "wl_teachers")
        assert now[ns.new_t["id"]]["sched_id"] is None and now[taker["id"]]["sched_id"] == new_sched
        _consistent(db, "หลังชน")
        (note,) = res["workload"]
        assert "ข้าม 1 รายการ" in note and "ครูใหม่" in note and "ครูที่ผูกรหัสไปก่อน" in note, note
        log = rec.logged[-1][2]
        assert "ข้าม: " in log and "ครูใหม่" in log and "ครูที่ผูกรหัสไปก่อน" in log, log   # รายการเต็มในบันทึกเทอม


def test_round_text_is_computed_from_the_open_term():
    # แบบข้อ 4.7 + รีวิวทั้งสาขา M1: เทอมของรอบเปิดอยู่ → "ส่งเข้าโปรแกรมแล้ว — เทอม X" · ถูกปิดตามปกติเพราะขึ้นเทอมที่ใหม่กว่า →
    # "… (ปิดภาคเรียนแล้ว)" (ไม่ชวนให้ปลดล็อกเทอมเก่ากลางภาคเรียน) · ถูกปิดและเทอมที่เปิดเก่ากว่า (ปลดล็อกย้อน) → "… (ถูกปิดไว้ ปลดล็อกเทอมนั้นเพื่อใช้ต่อ)"
    plain, done, parked = ("ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569", "ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569 (ปิดภาคเรียนแล้ว)",
                           "ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569 (ถูกปิดไว้ ปลดล็อกเทอมนั้นเพื่อใช้ต่อ)")
    with _world(subjects=_subjects_with_906()) as rec, _unlockable(rec):
        db, ns = _exported(rec)
        rid = ns.rnd["id"]
        for step, want, refusal in ((None, plain, ACTIVE_MSG), ("A", parked, CLOSED_MSG), ("B", plain, ACTIVE_MSG),
                                    ("C", done, DONE_MSG), ("B", plain, ACTIVE_MSG), ("C", done, DONE_MSG),
                                    ("A", parked, CLOSED_MSG)):
            if step == "A":
                _unlock(5, "1/2569")
            elif step == "B":
                _unlock(ns.new_id, "2/2569")
            elif step == "C" and not hasattr(ns, "c_id"):            # ขึ้นภาคเรียนถัดไปตามปกติด้วยปุ่มเดิม
                ns.c_id = mock_api.create_term({"year": 2570, "semester": 1})["active"]["id"]
            elif step == "C":
                _unlock(ns.c_id, "1/2570")
            row = _round_row(db, rid)
            assert mock_api.wl_round_export_text(row, mock_api.CURRENT_TERM) == want, (step, want)
            got = _call(db, ADMIN, mock_api.wl_round_get, rid, REQ)
            assert got["exported_text"] == want and got["exported_at"] is not None, (step, got["exported_text"])
            (listed,) = [x for x in _call(db, ADMIN, mock_api.wl_rounds_list, REQ) if x["id"] == rid]
            assert listed["exported_text"] == want, (step, listed["exported_text"])
            (r,) = [x for x in mock_api.terms_rounds() if x["id"] == rid]
            assert r["usable"] is False and any("ส่งเข้าโปรแกรมจัดตารางแล้ว" in x for x in r["reasons"]), r
            code, detail = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_update, ns.line2["id"], REQ, None,
                                               {"name": "x"}))
            assert code == 409 and detail.startswith(refusal), (step, detail)
            assert ("ถ้าส่งผิด" in detail) == (want == plain) and ("ปลดล็อกเทอมนั้น" in detail) == (want == parked), detail
    assert mock_api.wl_round_export_text({"exported_at": None, "exported_term_id": None}, {"id": 5}) is None
    # ฟังก์ชันล้วน: เทียบปี/ภาคของรอบ (= ของเทอมที่ส่งไป) กับเทอมที่เปิด · ไม่รู้ว่าเทอมที่เปิดคือเทอมไหน = แบบเดิม (ถูกปิดไว้)
    sent = {"exported_at": "x", "exported_term_id": 7, "exported_label": "2/2569", "year": 2569, "semester": 2}
    for active, want in (({"id": 7, "year": 2569, "semester": 2}, plain), ({"id": 9, "year": 2570, "semester": 1}, done),
                         ({"id": 9, "year": "2570", "semester": "1"}, done), ({"id": 3, "year": 2569, "semester": 1}, parked),
                         ({"id": 9, "year": None, "semester": None}, parked), (None, parked)):
        assert mock_api.wl_round_export_text(sent, active) == want, (active, want)


# ── รอบที่ส่งแล้ว: ทุก route ที่เขียนรอบ/หลักสูตรของภาคเรียนนั้น → 409 ─────────────────
_ROUTE_RE = re.compile(r'@app\.(post|put|delete)\("(/api/workload/[^"]+)"\)\s*\ndef (\w+)\(')
# route เขียนของเว็บลงอัตรากำลังที่ไม่ได้เขียนรอบหรือหลักสูตรของภาคเรียนใด (ทะเบียน · รหัส · ล็อกอิน)
_NOT_ROUND = {"wl_login", "wl_logout", "wl_setup", "wl_codes_create", "wl_codes_update", "wl_teachers_create",
              "wl_teachers_update", "wl_subjects_create", "wl_subjects_update", "wl_teachers_import", "wl_subjects_import"}
# ทาง ข.: route ที่ตั้งใจเปิดรอบที่ส่งแล้วให้แก้กลางเทอม (ไม่ใช่ทุกฉากจะ 409 — ดูในตัวทดสอบ)
_AMEND = {"wl_rounds_amend"}


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
    # เทอมของรอบเปิดอยู่ ("ส่งเข้าโปรแกรมแล้ว — เทอม X") และถูกปิดไว้ ("… (ถูกปิดไว้ ปลดล็อกเทอมนั้นเพื่อใช้ต่อ)") — ทุก route เขียน
    # ของรอบและหลักสูตรของภาคเรียนนั้น 409 ข้อความของสถานะนั้นทุกตัว ไม่มีอะไรเปลี่ยนในฐาน
    for state, want in (("open", ACTIVE_MSG), ("parked", CLOSED_MSG), ("done", DONE_MSG)):
        closed = state != "open"
        with _world() as rec, _unlockable(rec):
            db, ns = _exported(rec, richer=False)
            if state == "parked":
                _unlock(5, "1/2569")
            elif state == "done":
                mock_api.create_term({"year": 2570, "semester": 1})       # ขึ้นภาคเรียนถัดไปตามปกติ (ปุ่มเดิม)
            calls = _route_calls(db, ns)
            already = {"wl_rounds_create": (ADMIN, lambda: mock_api.wl_rounds_create(REQ, {"year": 2569, "semester": 2}))}
            if state != "open":
                # ทาง ข.: เปิดให้แก้กลางเทอม (_AMEND) เปิดรอบที่ปิดแล้วของภาคที่เปิดอยู่โดยตั้งใจ แม้ส่งแล้ว (ฉาก "open" ทดสอบใน
                # wlmidtermpreview.py) · เทอมของรอบถูกปิดไว้/ปิดภาคแล้ว = ไม่ใช่ภาคที่เปิดอยู่ → 409 ไม่มีอะไรเปลี่ยน
                already["wl_rounds_amend"] = (ADMIN, lambda: mock_api.wl_rounds_amend(ns.rnd["id"], REQ))
            routes = {fn for _m, _p, fn in _ROUTE_RE.findall(inspect.getsource(mock_api))}
            assert routes, "อ่าน route จากซอร์สไม่ได้"
            missing = routes - set(calls) - set(already) - _NOT_ROUND - _AMEND
            assert not missing, f"route เขียนของเว็บลงอัตรากำลังที่ตัวทดสอบนี้ยังไม่ครอบ: {sorted(missing)}"
            assert not (set(calls) | set(already) | _NOT_ROUND | _AMEND) - routes, "ชื่อ route ในตารางไม่มีจริง"
            for name, (sess, fn) in {**calls, **already}.items():
                snap = copy.deepcopy(db.tables)
                code, detail = _code(lambda: _call(db, sess, fn))
                assert code == 409 and isinstance(detail, str) and _thai(detail), (state, name, code, detail)
                if name in calls:
                    assert detail.startswith(want) and (("ถูกปิดไว้" in detail) == (state == "parked")) and \
                        (("ถ้าส่งผิด" in detail) == (not closed)), (state, name, detail)
                assert db.tables == snap, (state, name)
            assert mock_api.wl_round_exported_refusal(_round_row(db, ns.rnd["id"]), mock_api.CURRENT_TERM) \
                .startswith(want)
    assert mock_api.wl_round_exported_refusal({"exported_at": None, "exported_term_id": None}, {"id": 5}) is None
    with _world() as rec:
        db, ns = _rich()
        rec.use(db)
        _round_row(db, ns.rnd["id"])["status"] = "closed"
        code, detail = _code(lambda: _call(db, ADMIN, _route_calls(db, ns)["wl_curricula_update"][1]))
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
