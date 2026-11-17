"""
ขั้นที่ 3 งานที่ 3: อ่านรอบ เกณฑ์รอบ ล็อกทะเบียน และหน้าดูก่อนสร้างเทอมจากรอบ (เซิร์ฟเวอร์ ไม่เขียนอะไร)

ฟังก์ชันล้วน (wl_export_reasons) เรียกตรง ๆ กับข้อมูลรูป source ของสัญญาร่วม · route และ _wl_export_source คุยกับ
ฐานข้อมูลปลอมชุดเดียวกับ wlcurriculum.py (อ่านโครงตารางจาก _WL_SCHEMA รวมคอลัมน์ที่ ALTER เพิ่ม) · ตัวแปรของโปรแกรม
จัดตารางถูกแทนด้วยชุดเล็กของ wlopen.py ระหว่างตัวทดสอบ แล้วคืนของเดิม — ของจริง (Postgres สองเซสชัน) ลองแยกในรายงาน
"""
import contextlib
import copy
import datetime as dt
import decimal
import json
import re
import sys

import mock_api
from wlcurriculum import ADMIN, HEAD, REQ, FakeCur, _call, _code, _patched, _state, _thai
from wlopen import PLAN, POOLS, SCHED_SUBJECTS, _open, _rdb, _wl_teacher

fails: list[str] = []

# ตัวแปรของโปรแกรมที่หน้าดูก่อนสร้างต้องไม่แตะ (deep-equal ก่อน/หลัง)
PROGRAM = ("REQUIREMENTS", "ELECTIVE_POOLS", "SLOTS", "SUBJECTS", "TEACHERS", "CURRICULA", "GROUPS", "PARKED",
           "CURRENT_TERM", "SCHOOL_CONFIG", "_counters", "DEPARTMENTS", "LAST_RUN")
SCHED_TEACHERS = [{"id": t, "name": f"ครู {t}", "department_id": 1, "max_slots_per_day": 6} for t in range(501, 511)]


@contextlib.contextmanager
def _program(**over):
    """ตัวแปรของโปรแกรมชุดเล็กของ wlopen.py (แผน 8 แถว ชุดเสรี 1 ชุด วิชา 900-905 ครู 501-510) + ฐานข้อมูลจริง
    terms = แถวของ app_terms ที่รายการรอบ/หน้าดูก่อนสร้างเห็น (เหตุ "มีเทอมนี้อยู่แล้ว" — Task 4 addendum ข้อ 3) ค่าตั้งต้นว่าง"""
    with _patched(REQUIREMENTS=copy.deepcopy(over.get("requirements", PLAN)),
                  ELECTIVE_POOLS=copy.deepcopy(over.get("pools", POOLS)), SLOTS=[],
                  SUBJECTS=copy.deepcopy(over.get("subjects", SCHED_SUBJECTS)),
                  TEACHERS=copy.deepcopy(over.get("teachers", SCHED_TEACHERS)), CURRICULA=[], PARKED=[],
                  _STORE_KIND="postgres", _terms_list=lambda: copy.deepcopy(list(over.get("terms", [])))):
        yield


def _run(db, fn, *a, **kw):
    """เรียก route กับฐานข้อมูลปลอม (ไม่มีการล็อกอิน — route ของโปรแกรมจัดตาราง) → (ผล, SQL ที่ส่งตามลำดับ)"""
    cur = FakeCur(db, None)

    @contextlib.contextmanager
    def fake():
        yield cur
    with _patched(_wl_db=fake):
        out = fn(*a, **kw)
    db.check_fks()
    return out, cur.log


def _writes(log):
    return [s for s, _ in log if s.split()[0].upper() in ("INSERT", "UPDATE", "DELETE", "LOCK", "ALTER", "CREATE")]


def _ready(db, rnd, status="filling", approve=True):
    """ทำให้รอบผ่านเกณฑ์ข้อ 4.1: ทุกแถวมีครูและยืนยันแล้ว · ทุกครูของตัวเลือกยืนยันแล้ว · ทุกกลุ่มตรวจผ่าน"""
    for r in db.tables["wl_rounds"]:
        if r["id"] == rnd["id"]:
            r["status"] = status
    for r in db.tables["wl_rows"]:
        if r["teacher_id"] is None:
            r["teacher_id"] = _wl_teacher(db, 501)
        r["confirmed"] = True
    for o in db.tables["wl_option_teachers"]:
        o["confirmed"] = True
    if approve:
        for s in db.tables["wl_dept_status"]:
            s["status"] = "approved"


def _scenario():
    """รอบ 2/2569 จาก wlopen.py ที่ผ่านเกณฑ์แล้ว — ต้องอยู่ใน _program()"""
    db, t = _rdb()
    rnd = _open(db)
    _ready(db, rnd)
    return db, t, rnd


def _build(db, rnd, outgoing=None, year=2569, semester=2):
    cur = FakeCur(db, None)
    source = mock_api._wl_export_source(cur, rnd["id"])
    out = outgoing if outgoing is not None else mock_api._term_outgoing()
    return source, mock_api._term_build(source, out, dict(mock_api._counters), year, semester)


# ── ฐานข้อมูล: คอลัมน์ใหม่ของรอบ ─────────────────────────────────────────────
def test_schema_adds_columns_without_index():
    sql = mock_api._WL_SCHEMA
    alters = re.findall(r"ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+(\w+)", sql, re.I)
    assert alters == [("wl_rounds", "exported_at", "timestamptz"), ("wl_rounds", "exported_term_id", "bigint"),
                      ("wl_rounds", "exported_label", "text"), ("wl_rounds", "export_report", "jsonb")], alters
    # ALTER ทุกตัวเป็นแบบ ADD COLUMN IF NOT EXISTS (รันซ้ำได้ทุก process · ฐานเดิมอัปเกรดเอง) และอยู่หลังตารางของมัน
    assert len(re.findall(r"ALTER\s+TABLE", sql, re.I)) == 4
    assert sql.index("CREATE TABLE IF NOT EXISTS wl_rounds") < sql.index("ALTER TABLE wl_rounds")
    # ไม่มี index ใหม่ (ดัชนีทั้งหมดเท่าก่อนงานนี้พอดี) และไม่มี NOT NULL/DEFAULT ที่ต้องเขียนทับแถวเดิม
    idx = set(re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)", sql, re.I))
    assert idx == {"wl_codes_one_admin", "wl_codes_one_per_dept", "wl_curriculum_log_term", "wl_rounds_one_open"}, idx
    for line in re.findall(r"ALTER TABLE[^;]*", sql):
        assert "NOT NULL" not in line and "DEFAULT" not in line, line
    ran = []

    class Cur:
        def execute(self, s, *a):
            ran.append(s)
    mock_api._wl_schema(Cur())
    # Task 5 addendum ข้อ 3: ทีละคำสั่ง (แต่ละคำสั่งเป็นธุรกรรมของมันเองใน _wl_db) ครบทุกคำสั่งของชุด
    assert ran == [x.strip() for x in sql.split(";") if x.strip()] and len(ran) > 4, ran


# ── ล็อกทะเบียน ────────────────────────────────────────────────────────────
class _Spy(list):
    """ลิสต์ของโปรแกรม (TEACHERS/SUBJECTS) ที่จดว่าถูกอ่านครั้งแรกตอนคำสั่ง SQL ที่เท่าไร (log = cur.log)"""
    def __init__(self, rows, log):
        super().__init__(rows)
        self.log, self.read_at = log, None

    def __iter__(self):
        if self.read_at is None:
            self.read_at = len(self.log)
        return super().__iter__()


def test_registry_lock_is_first_statement_of_registry_writes():
    key = mock_api.WL_REGISTRY_LOCK_KEY
    assert type(key) is int and 0 < key < 2 ** 63
    lock = ("SELECT pg_advisory_xact_lock(%s)", (key,))
    log = []

    class Cur:
        def execute(self, s, p=None):
            log.append((s, p))
    assert mock_api._wl_registry_lock(Cur()) is None and log == [(lock[0], lock[1])]

    routes = [
        ("teachers_create", mock_api.wl_teachers_create, lambda db: (REQ, {"name": "ครูใหม่"})),
        ("teachers_update", mock_api.wl_teachers_update, lambda db: (_wl_teacher(db, 501), REQ, {"name": "แก้ชื่อ"})),
        ("subjects_create", mock_api.wl_subjects_create, lambda db: (REQ, {"code": "X9", "name": "วิชาใหม่"})),
        ("subjects_update", mock_api.wl_subjects_update, lambda db: (db.tables["wl_subjects"][0]["id"], REQ,
                                                                     {"name": "แก้ชื่อวิชา"})),
        ("teachers_import", mock_api.wl_teachers_import, lambda db: (REQ,)),
        ("subjects_import", mock_api.wl_subjects_import, lambda db: (REQ,)),
        # ตั้งต้นหลักสูตรจากโปรแกรมดึงครู/วิชาด้วยตัวเดียวกับปุ่มดึง (_wl_import_rows) — ต้องต่อคิวเหมือนกัน
        ("curricula_seed", mock_api.wl_curricula_seed, lambda db: (REQ, {"year": 2570, "semester": 1,
                                                                         "source": "timetable"})),
    ]
    for name, fn, args in routes:
        for sess in (ADMIN, HEAD, None):
            db, _t = _rdb()
            cur = FakeCur(db, sess)

            @contextlib.contextmanager
            def fake():
                yield cur
            with _program(), _patched(_wl_db=fake):
                with _patched(TEACHERS=_Spy(mock_api.TEACHERS, cur.log), SUBJECTS=_Spy(mock_api.SUBJECTS, cur.log)):
                    spies = (mock_api.TEACHERS, mock_api.SUBJECTS)
                    code, _d = _code(lambda: fn(*args(db)))
            assert code == (None if sess is ADMIN else 403 if sess is HEAD else 401), (name, sess, code, _d)
            # คำสั่งแรกของธุรกรรม — ก่อนตรวจสิทธิ์ ก่อนอ่านตัวแปรของโปรแกรม และก่อนเขียนตาราง
            assert cur.log[0] == lock, (name, cur.log[:2])
            assert sum(1 for s, _p in cur.log if "pg_advisory" in s) == 1, name
            for spy in spies:
                assert spy.read_at is None or spy.read_at >= 1, (name, spy.read_at)
            if name.endswith("import") and sess is ADMIN:
                assert any(s.read_at for s in spies), name          # ปุ่มดึงอ่านตัวแปรของโปรแกรมจริง (หลังล็อก)
    # route ที่ไม่เขียนทะเบียนไม่ถือล็อก (ดูก่อนดึง · อ่านรายการ)
    for fn in (mock_api.wl_teachers_import_preview, mock_api.wl_subjects_import_preview, mock_api.wl_teachers_list):
        db, _t = _rdb()
        cur = FakeCur(db, ADMIN)

        @contextlib.contextmanager
        def fake2():
            yield cur
        with _program(), _patched(_wl_db=fake2):
            fn(REQ)
        assert not any("pg_advisory" in s for s, _p in cur.log), fn.__name__


# ── เกณฑ์รอบ (แบบข้อ 4.1) — ฟังก์ชันล้วน ───────────────────────────────────────
def _row(i, dept, teacher=7, confirmed=True, line=1):
    return {"id": i, "round_id": 1, "line_id": line, "group_id": 1, "subject_id": 11, "code": "ค21101", "weekly": 2,
            "teacher_id": teacher, "co_teacher_id": None, "lab_room_id": None, "is_double": False,
            "confirmed": confirmed, "flag": None, "department_id": dept}


def _opt(i, dept, teachers=((7, True),), set_id=1, subject_id=12, code="ศ21201"):
    st = {"id": set_id, "kind": "elective", "name": "เสรี ม.1", "group_ids": [1], "weekly": 2, "is_double": False}
    return {"id": i, "set_id": set_id, "subject_id": subject_id, "code": code, "name": "ดนตรี", "department_id": dept,
            "set": st, "teachers": [{"id": 100 + n, "teacher_id": t, "room_id": None, "confirmed": c}
                                    for n, (t, c) in enumerate(teachers)]}


def _source(status="filling", exported_at=None, rows=None, options=None, dept_status=None, lines=None,
            wl_subjects=None, wl_teachers=None, exported_label=None):
    rows = [_row(1, 2), _row(2, 2), _row(3, 3)] if rows is None else rows
    options = [_opt(1, 7)] if options is None else options
    lines = [{"id": 1, "subject_id": 11, "code": "ค21101", "name": "คณิต", "credits": 1, "weekly": 2, "kind": "basic",
              "department_id": 2}] if lines is None else lines
    st = {"id": 1, "kind": "elective", "name": "เสรี ม.1", "group_ids": [1], "weekly": 2, "is_double": False}
    return {"round": {"id": 1, "year": 2569, "semester": 2, "label": "2/2569", "status": status,
                      "exported_at": exported_at, "exported_label": exported_label},
            "rows": rows, "options": options, "sets": [st],
            "curricula": [{"id": 1, "name": "ม.1/1", "group_ids": [1], "lines": lines}],
            "wl_teachers": wl_teachers if wl_teachers is not None else
            [{"id": 7, "sched_id": 1, "name": "ครู", "code": None, "department_id": 2, "dept_order": 1, "active": True}],
            "wl_subjects": wl_subjects if wl_subjects is not None else
            [{"id": 11, "sched_id": 1, "code": "ค21101", "name": "คณิต", "type": "common", "department_id": 2,
              "duration": 1, "is_activity": False, "is_elective": False, "active": True},
             {"id": 12, "sched_id": 2, "code": "ศ21201", "name": "ดนตรี", "type": "common", "department_id": 7,
              "duration": 1, "is_activity": False, "is_elective": False, "active": True}],
            "dept_status": dept_status if dept_status is not None else
            [{"department_id": d, "status": "approved"} for d in (2, 3, 7)] + [{"department_id": 5, "status": "filling"}]}


def test_reasons_each_rule():
    R = mock_api.wl_export_reasons
    dname = mock_api._wl_dept_text
    assert R(_source(), 2569, 2) == []
    # กลุ่มที่ไม่มีรายการไม่นับ: กลุ่ม 5 ยังกำลังกรอกอยู่ แต่ไม่มีแถว/ตัวเลือกของกลุ่มนี้ (ข้างบนจึงใช้ได้)
    # 1) ปี/ภาคเรียนไม่ตรงกับเทอมใหม่
    got = R(_source(), 2570, 1)
    assert len(got) == 1 and "2/2569" in got[0] and "1/2570" in got[0] and _thai(got[0]), got
    # 2) ส่งแล้ว (บอกเทอมที่ส่งไป) · ยังกำลังเตรียม
    got = R(_source(exported_at="2026-11-17T09:00:00+00:00", exported_label="2/2569"), 2569, 2)
    assert len(got) == 1 and "ส่ง" in got[0] and "2/2569" in got[0], got
    got = R(_source(status="preparing"), 2569, 2)
    assert any("กำลังเตรียม" in g for g in got) and all(_thai(g) for g in got), got
    # 3) ขาดครู / ยังไม่ยืนยัน — ระบุกลุ่มสาระและจำนวน (นับทั้งแถวและตัวเลือก)
    rows = [_row(1, 2, teacher=None), _row(2, 2, confirmed=False), _row(3, 2, confirmed=False), _row(4, 3)]
    got = R(_source(rows=rows, options=[_opt(1, 2, ((7, False),)), _opt(2, 7, ())]), 2569, 2)
    two = [g for g in got if dname(2) in g]
    assert len(two) == 1 and "ยังไม่มีครู 1 รายการ" in two[0] and "ยังไม่ยืนยัน 3 รายการ" in two[0], got
    seven = [g for g in got if dname(7) in g]
    assert len(seven) == 1 and "ยังไม่มีครู 1 รายการ" in seven[0] and "ยังไม่ยืนยัน" not in seven[0], got
    assert not any(dname(3) in g for g in got), got
    # 4) กลุ่มยังไม่ตรวจผ่านขณะรอบยังเปิดให้กรอก — ระบุกลุ่มสาระ
    pending = [{"department_id": 2, "status": "submitted"}, {"department_id": 3, "status": "approved"},
               {"department_id": 7, "status": "returned"}]
    got = R(_source(dept_status=pending), 2569, 2)
    assert len(got) == 2 and all("ยังไม่ตรวจผ่าน" in g for g in got), got
    assert dname(2) in got[0] and dname(7) in got[1] and "ส่งแล้ว" in got[0] and "ตีกลับ" in got[1], got
    # รอบปิดแล้วไม่ต้องตรวจผ่าน (การปิดรอบคือคำยืนยันสุดท้ายของ admin) — แต่ยังต้องครบ (ข้อ 3)
    assert R(_source(status="closed", dept_status=pending), 2569, 2) == []
    got = R(_source(status="closed", dept_status=pending, rows=[_row(1, 2, teacher=None)]), 2569, 2)
    assert len(got) == 1 and "ยังไม่มีครู 1 รายการ" in got[0], got
    # กลุ่มที่มีรายการแต่ไม่มีสถานะในรอบ (กลุ่มที่เพิ่มหลังเปิดรอบ) = ยังไม่ตรวจผ่าน
    got = R(_source(dept_status=[{"department_id": 2, "status": "approved"}, {"department_id": 7,
                                                                            "status": "approved"}]), 2569, 2)
    assert len(got) == 1 and dname(3) in got[0], got
    # รายการที่ไม่ได้ระบุกลุ่มสาระ: ไม่มีกลุ่มใดตรวจผ่านให้ได้ → เหตุขณะรอบยังเปิด · รอบปิดแล้วผ่าน
    got = R(_source(rows=[_row(1, None), _row(2, 2)]), 2569, 2)
    assert len(got) == 1 and "ไม่ได้ระบุกลุ่มสาระ" in got[0] and "1 รายการ" in got[0], got
    assert R(_source(status="closed", rows=[_row(1, None), _row(2, 2)]), 2569, 2) == []
    # 5) วิชาไม่มีรหัส — บรรทัดที่พิมพ์รหัสว่าง · บรรทัดที่ผูกวิชาของเว็บที่รหัสว่าง · ตัวเลือกไม่มีรหัส
    lines = [{"id": 1, "subject_id": 11, "code": "ค21101", "name": "คณิต", "credits": 1, "weekly": 2, "kind": "basic",
              "department_id": 2},
             {"id": 2, "subject_id": None, "code": "  ", "name": "วิชาพิมพ์เอง", "credits": 1, "weekly": 1,
              "kind": "additional", "department_id": 2}]
    got = R(_source(lines=lines), 2569, 2)
    assert len(got) == 1 and "ม.1/1" in got[0] and "วิชาพิมพ์เอง" in got[0] and "รหัสวิชา" in got[0], got
    subs = _source()["wl_subjects"]
    subs[0] = {**subs[0], "code": " "}
    got = R(_source(wl_subjects=subs), 2569, 2)
    assert len(got) == 1 and "ม.1/1" in got[0] and "คณิต" in got[0], got
    got = R(_source(options=[_opt(1, 7, subject_id=None, code="")]), 2569, 2)
    assert len(got) == 1 and "เสรี ม.1" in got[0] and "รหัสวิชา" in got[0], got
    # 5) ครูที่ถูกอ้างต้องยังมีในทะเบียนของเว็บ
    got = R(_source(rows=[_row(1, 2, teacher=99)]), 2569, 2)
    assert len(got) == 1 and "99" in got[0] and "ทะเบียนครู" in got[0], got
    # ไม่แก้สิ่งที่ส่งเข้ามา
    s = _source(rows=rows)
    snap = copy.deepcopy(s)
    R(s, 2570, 1)
    assert s == snap


# ── อ่านรอบด้วย cursor เดียว ─────────────────────────────────────────────────
def test_export_source_reads_the_whole_round():
    with _program():
        db, t, rnd = _scenario()
        # ชุดที่ไม่มีตัวเลือก (ต้องอยู่ใน sets ด้วย) · บรรทัดที่ไม่มีห้อง (ต้องอยู่ในหลักสูตรด้วย) · หน่วยกิต numeric
        empty = _call(db, ADMIN, mock_api.wl_term_sets_create, REQ,
                      {"year": 2569, "semester": 2, "kind": "activity", "name": "ชุมนุม", "group_ids": [1, 2],
                       "weekly": 1})
        c2 = _call(db, ADMIN, mock_api.wl_curricula_create, REQ,
                   {"year": 2569, "semester": 2, "name": "ไม่มีห้อง", "group_ids": []})
        _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
              {"curriculum_id": c2["id"], "code": "ท21102", "weekly": 1, "sort": 5})
        _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
              {"curriculum_id": c2["id"], "code": "ค21102", "weekly": 1, "sort": 1})
        db.tables["wl_curriculum_lines"][0]["credits"] = decimal.Decimal("1.5")      # Postgres numeric
        _ready(db, rnd)
        cur = FakeCur(db, None)
        src = mock_api._wl_export_source(cur, rnd["id"])
    assert not _writes(cur.log)
    assert set(src) == {"round", "rows", "options", "sets", "curricula", "wl_teachers", "wl_subjects", "dept_status"}
    assert src["round"] == {"id": rnd["id"], "year": 2569, "semester": 2, "label": "2/2569", "status": "filling",
                            "exported_at": None, "exported_label": None}, src["round"]
    assert len(src["rows"]) == 18 and {"line_id", "subject_id", "weekly", "teacher_id", "co_teacher_id", "lab_room_id",
                                       "is_double", "confirmed", "flag", "department_id"} <= set(src["rows"][0])
    assert len(src["options"]) == 1 and len(src["options"][0]["teachers"]) == 2
    assert [s["name"] for s in src["sets"]] == ["วิชาเสรี ม.1/1-6", "ชุมนุม"]
    assert src["sets"][1] == {"id": empty["id"], "kind": "activity", "name": "ชุมนุม", "group_ids": [1, 2],
                              "weekly": 1, "is_double": False}, src["sets"][1]
    # หลักสูตรตามลำดับหลักสูตร · บรรทัดตาม sort แล้ว id · ทุกบรรทัดของภาคเรียน (รวมหลักสูตรที่ไม่มีห้อง)
    assert [c["name"] for c in src["curricula"]] == ["ม.1/1-6", "ไม่มีห้อง"]
    assert src["curricula"][0]["group_ids"] == [1, 2, 3, 4, 5, 6] and src["curricula"][1]["group_ids"] == []
    assert [ln["code"] for ln in src["curricula"][0]["lines"]] == ["ท21102", "ค21102", "ว21102"]
    assert [ln["code"] for ln in src["curricula"][1]["lines"]] == ["ค21102", "ท21102"]
    first = src["curricula"][0]["lines"][0]
    assert first["credits"] == 1.5 and type(first["credits"]) is float, first
    assert {"id", "subject_id", "code", "name", "credits", "weekly", "kind", "department_id"} <= set(first)
    assert len(src["wl_teachers"]) == 10 and set(src["wl_teachers"][0]) == {
        "id", "sched_id", "name", "code", "department_id", "dept_order", "active"}
    assert len(src["wl_subjects"]) == 6 and "is_elective" in src["wl_subjects"][0]
    assert sorted(d["department_id"] for d in src["dept_status"]) == sorted(d["id"] for d in mock_api.DEPARTMENTS)
    assert {d["status"] for d in src["dept_status"]} == {"approved"}
    # ไม่มีรอบ → 404 ไทย
    c, d = _code(lambda: mock_api._wl_export_source(FakeCur(db, None), 9999))
    assert c == 404 and _thai(d), (c, d)


# ── หน้าดูก่อนสร้าง ─────────────────────────────────────────────────────────
def test_preview_without_round_is_unchanged():
    want = mock_api.new_term_preview()
    assert set(want) == {"requirements", "teachers", "periods_total", "curricula", "slots_to_clear"}

    def boom(*_a, **_k):
        raise AssertionError("ทางเดิมต้องไม่แตะฐานข้อมูล")
    with _patched(_wl_db=boom, _db_connect=boom, _STORE_KIND="file"):
        assert mock_api.terms_preview() == want
        assert mock_api.terms_preview(round_id=None) == want
        assert mock_api.terms_preview(round_id="") == want


def test_preview_with_round_writes_nothing():
    with _program():
        db, t, rnd = _scenario()
        before_db = _state(db)
        before = copy.deepcopy({k: getattr(mock_api, k) for k in PROGRAM})
        out, log = _run(db, mock_api.terms_preview, round_id=str(rnd["id"]))
        after = {k: getattr(mock_api, k) for k in PROGRAM}
        plain = mock_api.new_term_preview()
    assert after == before                       # ตัวแปรของโปรแกรม deep-equal
    assert _state(db) == before_db and _writes(log) == [], _writes(log)
    assert not any("pg_advisory" in s or " FOR " in s for s, _p in log)     # GET ไม่ล็อกอะไร
    # ตัวเลขเดิม 5 ตัว + round
    assert {k: out[k] for k in plain} == plain and set(out) == set(plain) | {"round"}, set(out)
    r = out["round"]
    assert set(r) == {"id", "label", "year", "semester", "usable", "reasons", "report"}, set(r)
    assert (r["id"], r["label"], r["year"], r["semester"], r["usable"], r["reasons"]) == (
        rnd["id"], "2/2569", 2569, 2, True, []), r["reasons"]
    rep = r["report"]
    # แผน 18 แถวของรอบ + แถวคู่ของสอนร่วมคาบเท่ากัน (ห้อง 1 ค21102 ครู 503/504) ตามรูปของแผนเดิม
    assert (rep["requirements"], rep["periods"], rep["pools"], rep["pool_options"], rep["curricula"]) == (
        19, 51, 1, 2, 1), rep
    assert rep["teachers_created"] == [] and rep["subjects_created"] == [] and rep["skipped"] == []
    assert rep["teachers_patched"] == [] and rep["subjects_patched"] == []
    json.dumps(rep)                              # Task 4 ใส่ export_report (jsonb) ได้ตรง
    # ไม่ส่งรอบ / ไม่มีฐานข้อมูล / รหัสรอบผิด / ไม่มีรอบ
    with _program(), _patched(_STORE_KIND="file"):
        c, d = _code(lambda: mock_api.terms_preview(round_id=str(rnd["id"])))
    assert c == 503 and _thai(d), (c, d)
    with _program():
        for bad in ("abc", "1.5", "-1", "9" * 30):
            c, d = _code(lambda: _run(db, mock_api.terms_preview, round_id=bad))
            assert c == 400 and _thai(d), (bad, c, d)
        c, d = _code(lambda: _run(db, mock_api.terms_preview, round_id="9999"))
        assert c == 404 and _thai(d), (c, d)
        # ข้อมูลของโรงเรียนยังโหลดไม่สำเร็จ: สิ่งที่อยู่ในหน่วยความจำคือข้อมูลตั้งต้น — สรุปจากมันคือสรุปผิด
        with _patched(_db_write_blocked=lambda: True):
            c, d = _code(lambda: _run(db, mock_api.terms_preview, round_id=str(rnd["id"])))
        assert c == 503 and _thai(d), (c, d)


def test_preview_reasons_include_round_rules_registry_and_skipped():
    # เหตุครบทุกแหล่งตามลำดับ: เกณฑ์รอบ (ข้อ 3 · 4) → ทะเบียน (registry_plan) → รายการที่ถูกข้าม · รอบที่ใช้ไม่ได้ยังดูสรุปได้
    subjects = copy.deepcopy(SCHED_SUBJECTS) + [
        {"id": 950 + i, "code": "ZZ1", "name": f"วิชาซ้ำ {i}", "credits": 1, "department_id": 1} for i in range(2)]
    with _program(subjects=subjects):
        db, t, rnd = _scenario()
        # บรรทัดที่พิมพ์รหัสเอง ZZ1 (ไม่มีในทะเบียนของเว็บ) แต่โปรแกรมมีวิชารหัสนี้สองวิชา → ผูกด้วยรหัสไม่ได้ · แถวใหม่ 6 แถวยังไม่มีครู
        _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
              {"curriculum_id": t["curriculum"]["id"], "code": "ZZ1", "name": "วิชาพิมพ์เอง", "department_id": 1,
               "weekly": 1})
        next(s for s in db.tables["wl_dept_status"] if s["department_id"] == 2)["status"] = "submitted"
        out, log = _run(db, mock_api.terms_preview, round_id=str(rnd["id"]))
    assert _writes(log) == []
    r = out["round"]
    assert r["usable"] is False and all(_thai(g) for g in r["reasons"]), r["reasons"]
    got = r["reasons"]
    assert len(got) == 5, got
    assert "ยังไม่มีครู 6 รายการ" in got[0] and mock_api._wl_dept_text(1) in got[0], got[0]
    assert "ยังไม่ตรวจผ่าน" in got[1] and mock_api._wl_dept_text(2) in got[1], got[1]
    assert "ZZ1" in got[2] and "2 วิชา" in got[2], got[2]
    assert got[3].startswith("แถวของรอบ 6 รายการ") and got[4].startswith("บรรทัดหลักสูตร 1 รายการ"), got[3:]
    rep = r["report"]
    assert rep["requirements"] == 19 and len(rep["skipped"]) == 7, rep["skipped"]


def test_build_report_lists_every_change_field_by_field():
    # Ruling T1 C4: admin ต้องเห็นครู/วิชาที่จะถูกแก้ทีละรายการ ทีละช่อง (ค่าเดิม → ค่าใหม่) ก่อนยืนยัน
    # โดยเฉพาะ is_elective / duration ที่กระทบยอดคาบและการจัดคาบ
    teachers = copy.deepcopy(SCHED_TEACHERS)
    teachers[1]["active"] = False                                  # ครู 502 ปิดอยู่ในโปรแกรม แต่รอบใช้ (ห้อง 2 ท21102)
    subjects = copy.deepcopy(SCHED_SUBJECTS)
    subjects[1]["active"] = False                                  # วิชา 901 (ค21102) ปิดอยู่ในโปรแกรม
    with _program(teachers=teachers, subjects=subjects):
        db, t, rnd = _scenario()
        w501 = next(r for r in db.tables["wl_teachers"] if r["sched_id"] == 501)
        w501["name"], w501["dept_order"] = "ครูห้าศูนย์หนึ่ง", 4
        s900 = next(r for r in db.tables["wl_subjects"] if r["sched_id"] == 900)
        s900["duration"], s900["is_elective"] = 2, True
        snap = copy.deepcopy({k: getattr(mock_api, k) for k in PROGRAM})
        source, built = _build(db, rnd)
        assert {k: getattr(mock_api, k) for k in PROGRAM} == snap
    assert set(built) == {"registry", "plan", "reasons", "report"}
    assert built["reasons"] == [], built["reasons"]
    rep = built["report"]
    assert rep["teachers_patched"] == [{"wl_id": w501["id"], "id": 501, "name": "ครูห้าศูนย์หนึ่ง", "changes": [
        {"field": "name", "label": "ชื่อ", "old": "ครู 501", "new": "ครูห้าศูนย์หนึ่ง"},
        {"field": "dept_order", "label": "ลำดับในกลุ่มสาระ", "old": None, "new": 4}]}], rep["teachers_patched"]
    assert rep["subjects_patched"] == [{"wl_id": s900["id"], "id": 900, "code": "ท21102", "name": "ภาษาไทยพื้นฐาน 2",
                                        "changes": [
        {"field": "duration", "label": "คาบคู่", "old": None, "new": 2},
        {"field": "is_elective", "label": "เป็นวิชาเสรี", "old": None, "new": True}]}], rep["subjects_patched"]
    # addendum ข้อ 4: ครู/วิชาที่ถูกอ้างในรอบแต่ปิดใช้งานในโปรแกรม — ให้เห็น ไม่แก้ active
    assert rep["inactive_teachers_used"] == [{"id": 502, "name": "ครู 502"}], rep["inactive_teachers_used"]
    assert rep["inactive_subjects_used"] == [{"id": 901, "code": "ค21102", "name": "คณิตศาสตร์พื้นฐาน 2"}]
    assert all(t.get("active", True) is False for t in built["registry"]["teachers"] if t["id"] == 502)
    # ชุดคาบเสรี/กิจกรรม ครูที่โปรแกรมมีแต่เว็บไม่รู้จัก ฯลฯ อยู่ในรายงานครบ (เป็นรายการ ใช้แสดง "ดูรายการ")
    for k in ("teachers_created", "subjects_created", "code_links", "inactive_open", "unknown_teachers",
              "activity_sets", "not_carried", "new_cells", "curriculum_rows_added", "merged_options", "skipped"):
        assert isinstance(rep[k], list), k
    for k in ("requirements", "periods", "teachers_in_plan", "pools", "pool_options", "curricula", "carried",
              "elective_rows", "activity_rows"):
        assert type(rep[k]) is int, k


def test_build_names_activity_sets_and_curricula_that_got_subjects():
    # m6: หลักสูตรที่ถูกเพิ่มวิชาเพราะแถวแผนของวิชาเสรี/กิจกรรม ต้องบอกชื่อหลักสูตรและวิชาในสรุป
    plan = copy.deepcopy(PLAN) + [{"id": 30, "group_id": 1, "subject_id": 904, "teacher_id": 508, "weekly_count": 2}]
    with _program(requirements=plan):
        db, t, rnd = _scenario()
        s = _call(db, ADMIN, mock_api.wl_term_sets_create, REQ,
                  {"year": 2569, "semester": 2, "kind": "activity", "name": "แนะแนวรวม", "group_ids": [2, 1],
                   "weekly": 1})
        o = _call(db, ADMIN, mock_api.wl_term_set_options_create, REQ, {"set_id": s["id"], "code": "ก21902"})
        db.add("wl_option_teachers", round_id=rnd["id"], option_id=o["id"], teacher_id=_wl_teacher(db, 510),
               confirmed=True)
        source, built = _build(db, rnd)
    assert built["reasons"] == [], built["reasons"]
    rep = built["report"]
    assert rep["elective_rows"] == 1 and rep["curriculum_rows_added"] == [
        {"curriculum_id": built["plan"]["curricula"][0]["id"], "curriculum_name": "ม.1/1-6", "subject_id": 904,
         "code": "ศ21201", "name": "ดนตรีสากล", "weekly_count": 2}], rep["curriculum_rows_added"]
    assert rep["activity_sets"] == [{"name": "แนะแนวรวม", "group_ids": [2, 1], "group_names": ["ม.1/2", "ม.1/1"],
                                     "weekly": 1, "teacher_ids": [510], "teacher_names": ["ครู 510"]}], rep["activity_sets"]


def test_skipped_items_are_reasons():
    # addendum ข้อ 6/9: แถว/ตัวเลือก/บรรทัดที่ถูกข้ามเพราะอ้างไม่ได้ = เหตุที่สร้างไม่ได้ (ห้ามสร้างเทอมที่หายแถวเงียบ ๆ)
    with _program():
        db, t, rnd = _scenario()
        out = mock_api._term_outgoing()
        out["groups"].pop(6)                     # ห้อง ม.1/6 ไม่มีในโปรแกรมแล้ว แต่หลักสูตรของรอบยังมี
        source, built = _build(db, rnd, outgoing=out)
    rep = built["report"]
    assert len(rep["skipped"]) == 3 and {s["source"] for s in rep["skipped"]} == {"row"}, rep["skipped"]
    assert len(built["reasons"]) == 1, built["reasons"]
    why = built["reasons"][0]
    assert "แถวของรอบ 3 รายการ" in why and "ไม่พบห้องเรียนรหัส 6" in why and _thai(why), why
    # หลายชนิดรวมกัน → หนึ่งเหตุต่อชนิด ตัวอย่างไม่เกินห้ารายการ
    many = [{"source": "line", "ref": i, "reason": f"บรรทัด {i}"} for i in range(8)] + \
           [{"source": "option", "ref": 1, "reason": "ตัวเลือก ก"}]
    got = mock_api._term_skipped_reasons(many)
    assert len(got) == 2 and "บรรทัดหลักสูตร 8 รายการ" in got[0] and "บรรทัด 4" in got[0] and "บรรทัด 5" not in got[0]
    assert "อีก 3 รายการ" in got[0] and "ตัวเลือก ก" in got[1], got


# ── รายการรอบ ──────────────────────────────────────────────────────────────
def test_rounds_list_shape():
    with _program():
        db, t, rnd = _scenario()
        for r in db.tables["wl_rounds"]:
            r["status"] = "preparing"
        db.add("wl_rounds", year=2569, semester=1, label="1/2569", status="closed",
               exported_at=dt.datetime(2026, 5, 1, 9, 0, tzinfo=dt.timezone.utc), exported_term_id=3,
               exported_label="1/2569", export_report={"requirements": 1})
        before = _state(db)
        got, log = _run(db, mock_api.terms_rounds)
    assert _state(db) == before and _writes(log) == []
    keys = {"id", "label", "year", "semester", "status", "exported_at", "exported_label", "usable", "reasons"}
    assert [r["label"] for r in got] == ["2/2569", "1/2569"] and all(set(r) == keys for r in got), got
    new, old = got
    assert new["status"] == "preparing" and new["usable"] is False and new["exported_at"] is None
    assert any("กำลังเตรียม" in g for g in new["reasons"]) and all(_thai(g) for g in new["reasons"]), new
    assert old["usable"] is False and old["exported_at"].startswith("2026-05-01") and old["exported_label"] == "1/2569"
    assert len(old["reasons"]) == 1 and "ส่ง" in old["reasons"][0], old
    # รอบที่ส่งแล้วไม่ต้องอ่านแถวของมัน
    assert not any(p and old["id"] in tuple(p) and "wl_rows" in s for s, p in log)
    # ใช้ได้ = ฟังก์ชันคำนวณเดียวกับหน้าดูก่อนสร้าง (ปี/ภาค = ของรอบเอง)
    with _program():
        for r in db.tables["wl_rounds"]:
            if r["id"] == rnd["id"]:
                r["status"] = "closed"
        got, _log = _run(db, mock_api.terms_rounds)
        prev, _log = _run(db, mock_api.terms_preview, round_id=str(rnd["id"]))
    assert got[0]["usable"] is True and got[0]["reasons"] == [] == prev["round"]["reasons"], got[0]
    # ไม่มีฐานข้อมูล → ไม่มีรอบ (หน้าต่างสร้างเทอมเหมือนเดิมทุกอย่าง)
    with _patched(_STORE_KIND="file", _wl_db=None):
        assert mock_api.terms_rounds() == []
    paths = {(v, p) for v, p, _ in mock_api.app.routes}
    assert ("get", "/api/terms/rounds") in paths and ("get", "/api/terms/preview") in paths


def test_rounds_and_preview_say_the_term_already_exists():
    # Task 4 addendum ข้อ 3 (Ruling T3 C2): app_terms มีปี/ภาคของรอบแล้ว → เหตุนำหน้า ข้อความเดียวกับ POST /api/terms ·
    # รอบที่ส่งแล้วบอกแค่ว่าส่งแล้ว (เทอมของมันมีอยู่แน่นอน ไม่ซ้ำเหตุ) · ปี/ภาคอื่นไม่เป็นเหตุ
    want = mock_api._term_exists_reasons([{"year": 2569, "semester": 2}], 2569, 2)
    assert len(want) == 1 and "มีเทอม 2/2569" in want[0] and _thai(want[0]), want
    assert mock_api._term_exists_reasons([{"year": 2569, "semester": 1}], 2569, 2) == []
    for terms in ([{"id": 9, "year": 2569, "semester": 2, "label": "2/2569", "status": "closed"}], []):
        with _program(terms=terms):
            db, t, rnd = _scenario()
            got, _log = _run(db, mock_api.terms_rounds)
            prev, _log = _run(db, mock_api.terms_preview, round_id=str(rnd["id"]))
            with _patched(_db_write_blocked=lambda: True):
                blocked, _log = _run(db, mock_api.terms_rounds)
        if terms:
            assert got[0]["usable"] is False and got[0]["reasons"] == want, got[0]
            assert prev["round"]["usable"] is False and prev["round"]["reasons"] == want, prev["round"]
            assert blocked[0]["reasons"][0] == want[0] and blocked[0]["reasons"][-1] == mock_api.TERM_FROM_ROUND_BLOCKED
        else:
            assert got[0]["usable"] is True and prev["round"]["reasons"] == [], (got[0], prev["round"])
    with _program(terms=[{"year": 2569, "semester": 2}]):
        db, t, rnd = _scenario()
        for r in db.tables["wl_rounds"]:
            r.update(status="closed", exported_at=dt.datetime(2026, 11, 17, tzinfo=dt.timezone.utc),
                     exported_label="2/2569")
        got, _log = _run(db, mock_api.terms_rounds)
    assert len(got[0]["reasons"]) == 1 and "ส่งเข้าโปรแกรมจัดตารางแล้ว" in got[0]["reasons"][0], got[0]
    # อ่านรายการเทอมไม่ได้ → 503 ไทย (หน้าต่างถอยไปแบบเดิม — Task 6)
    def boom():
        raise RuntimeError("postgresql://u:SECRET@h/d")
    with _program(), _patched(_terms_list=boom):
        db, t, rnd = _scenario()
        for fn in (lambda: _run(db, mock_api.terms_rounds), lambda: _run(db, mock_api.terms_preview,
                                                                           round_id=str(rnd["id"]))):
            c, d = _code(fn)
            assert c == 503 and _thai(d) and "SECRET" not in d, (c, d)


def test_line_bound_to_a_subject_without_code_points_to_the_registry():
    # Task 4 addendum ข้อ 6 (รีวิว Task 3 m2): บรรทัด/ตัวเลือกที่ผูกวิชาแล้วแต่วิชาในทะเบียนไม่มีรหัส ต้องแก้ที่ "ทะเบียนวิชา"
    # ส่วนบรรทัดที่ไม่ได้ผูกและไม่ได้พิมพ์รหัสยังบอกให้แก้ที่หน้าหลักสูตรเหมือนเดิม
    lines = [{"id": 1, "subject_id": 11, "code": "", "name": "คณิตในบรรทัด", "credits": 1, "weekly": 2, "kind": "basic",
              "department_id": 2},
             {"id": 2, "subject_id": None, "code": " ", "name": "พิมพ์ไม่ครบ", "credits": 1, "weekly": 1,
              "kind": "basic", "department_id": 2}]
    subj = [{"id": 11, "sched_id": 900, "code": "  ", "name": "คณิตศาสตร์ในทะเบียน", "type": None, "department_id": 2,
             "duration": 1, "is_activity": False, "is_elective": False, "active": True},
            {"id": 12, "sched_id": 904, "code": "", "name": "ดนตรีในทะเบียน", "type": None, "department_id": 7,
             "duration": 1, "is_activity": False, "is_elective": False, "active": True}]
    src = _source(rows=[], options=[_opt(1, 7, subject_id=12, code="ศ21201"), _opt(2, 7, subject_id=None, code="")],
                  lines=lines, wl_subjects=subj)
    got = mock_api.wl_export_reasons(src, 2569, 2)
    reg = [g for g in got if "ทะเบียนวิชา" in g]
    cur = [g for g in got if "ในหน้าหลักสูตร" in g]
    assert len(reg) == 2 and len(cur) == 2, got
    assert "คณิตศาสตร์ในทะเบียน" in reg[0] and "1 บรรทัด" in reg[0] and "หน้าหลักสูตร" not in reg[0], reg[0]
    assert "ดนตรีในทะเบียน" in reg[1] and "1 ตัวเลือก" in reg[1] and "หน้าหลักสูตร" not in reg[1], reg[1]
    assert "พิมพ์ไม่ครบ" in cur[0] and "1 บรรทัด" in cur[0], cur[0]
    assert "1 ตัวเลือก" in cur[1], cur[1]


def test_round_view_has_export_fields():
    base = {"id": 1, "year": 2569, "semester": 2, "label": "2/2569", "status": "closed", "unconverted": [],
            "opened_at": dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc), "closed_at": None}
    v = mock_api.wl_round_view(base)
    assert (v["exported_at"], v["exported_label"], v["export_report"]) == (None, None, None), v
    rep = {"requirements": 1220, "activity_sets": [{"name": "แนะแนว"}]}
    v = mock_api.wl_round_view({**base, "exported_at": dt.datetime(2026, 11, 17, 9, tzinfo=dt.timezone.utc),
                                "exported_term_id": 5, "exported_label": "2/2569", "export_report": rep})
    assert v["exported_at"] == "2026-11-17T09:00:00+00:00" and v["exported_label"] == "2/2569"
    assert v["export_report"] == rep
    assert {"exported_at", "exported_term_id", "exported_label", "export_report"} <= set(mock_api._WL_ROUND_COLS)
    # route จริงของเว็บลงอัตรากำลังคืนช่องใหม่ (รายการรอบ · รอบเดียว)
    with _program():
        db, t = _rdb()
        rnd = _open(db)
        for r in db.tables["wl_rounds"]:
            r.update(exported_at=dt.datetime(2026, 11, 17, 9, tzinfo=dt.timezone.utc), exported_label="2/2569",
                     export_report=rep, exported_term_id=5)
        listed = _call(db, ADMIN, mock_api.wl_rounds_list, REQ)
        one = _call(db, ADMIN, mock_api.wl_round_get, rnd["id"], REQ)
    for got in (listed[0], one):
        assert got["exported_label"] == "2/2569" and got["export_report"] == rep, got
        assert got["exported_at"] == "2026-11-17T09:00:00+00:00"


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
