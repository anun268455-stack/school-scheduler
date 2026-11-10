"""
เว็บลงอัตรากำลัง ขั้นที่ 1 งานที่ 3: ทะเบียนครู/วิชาของเว็บใหม่ และการดึงครูวันแรก

ฟังก์ชันล้วนเรียกตรง ๆ · route ใช้ cursor ปลอมที่จดคำสั่ง SQL (ของจริงลองกับ Postgres แยก)
"""
import copy
import sys
from types import SimpleNamespace

from fastapi import HTTPException

import mock_api

fails: list[str] = []


def _code(fn):
    try:
        fn()
    except HTTPException as e:
        return e.status_code, e.detail
    return None, None


# ── wl_import_plan: จับคู่ด้วยรหัสเท่านั้น ──────────────────────────────
def test_import_links_by_sched_id_never_by_name():
    # Review Focus ข้อ 1 — ชื่อสะกดต่างกันแต่รหัสเดียวกัน = คนเดียวกัน
    sched = [{"id": 12, "name": "ชนะพันธ์ ก.", "department_id": 3}]
    existing = [{"id": 1, "sched_id": 12, "name": "ชนะพันธ ก."}]
    plan = mock_api.wl_import_plan(sched, existing)
    assert plan["create"] == []
    assert plan["already"] == [12]


def test_import_creates_only_teachers_not_seen_before():
    sched = [{"id": 12, "name": "ก"}, {"id": 13, "name": "ข"}]
    existing = [{"id": 1, "sched_id": 12, "name": "ก"}]
    plan = mock_api.wl_import_plan(sched, existing)
    assert [t["id"] for t in plan["create"]] == [13]


def test_import_twice_creates_nothing_the_second_time():
    sched = [{"id": 12, "name": "ก"}, {"id": 13, "name": "ข"}]
    first = mock_api.wl_import_plan(sched, [])
    after = [{"id": i + 1, "sched_id": t["id"], "name": t["name"]}
             for i, t in enumerate(first["create"])]
    assert mock_api.wl_import_plan(sched, after)["create"] == []


def test_same_name_different_sched_id_makes_two_rows():
    # ครูชื่อซ้ำกันจริงมีในโรงเรียน ต้องไม่ยุบเป็นคนเดียว
    sched = [{"id": 12, "name": "สมชาย"}, {"id": 99, "name": "สมชาย"}]
    assert len(mock_api.wl_import_plan(sched, [])["create"]) == 2


def test_same_name_as_a_hand_made_row_still_creates():
    # แถวที่เพิ่มมือ (sched_id ว่าง) ชื่อเดียวกัน ไม่ใช่คนเดียวกันโดยอัตโนมัติ
    existing = [{"id": 1, "sched_id": None, "name": "สมชาย"}]
    plan = mock_api.wl_import_plan([{"id": 5, "name": "สมชาย"}], existing)
    assert [t["id"] for t in plan["create"]] == [5] and plan["already"] == []


def test_import_skips_bad_and_duplicate_ids():
    sched = [{"name": "ไม่มีรหัส"}, {"id": True, "name": "บูล"}, {"id": "7", "name": "ข้อความ"},
             {"id": 1.0, "name": "ทศนิยม"}, {"id": 8, "name": "ดี"}, {"id": 8, "name": "ซ้ำ"}]
    plan = mock_api.wl_import_plan(sched, [])
    assert [t["id"] for t in plan["create"]] == [8]
    assert len(plan["skipped"]) == 5
    assert plan["skipped"][-1]["name"] == "ซ้ำ"


def test_import_plan_does_not_mutate_inputs():
    sched = [{"id": 2, "name": "ข"}, {"id": 1, "name": "ก"}, {"id": 1, "name": "ซ้ำ"}, {"name": "x"}]
    existing = [{"id": 9, "sched_id": 2, "name": "ข"}]
    s0, e0 = copy.deepcopy(sched), copy.deepcopy(existing)
    mock_api.wl_import_plan(sched, existing)
    assert sched == s0 and existing == e0


# ── ช่องที่รับ ─────────────────────────────────────────────────────────
def test_scheduler_only_fields_are_refused():
    for allowed in (mock_api.WL_TEACHER_FIELDS, mock_api.WL_SUBJECT_FIELDS):
        for bad in ("fixed_room_id", "advanced_settings", "max_slots_per_day",
                    "prefer_morning", "sched_id", "id"):
            c, d = _code(lambda: mock_api.wl_clean_fields({"name": "x", bad: 1}, allowed))
            assert c == 400, (bad, c)
            assert bad in d and not d.isascii(), (bad, d)


def test_all_bad_keys_are_named():
    c, d = _code(lambda: mock_api.wl_clean_fields(
        {"fixed_room_id": 1, "prefer_morning": 2}, mock_api.WL_TEACHER_FIELDS))
    assert c == 400 and "fixed_room_id" in d and "prefer_morning" in d


def test_clean_fields_passes_good_and_refuses_non_dict():
    b = {"name": "ก", "active": False}
    assert mock_api.wl_clean_fields(b, mock_api.WL_TEACHER_FIELDS) is b
    for bad in (None, [], "x", 3):
        assert _code(lambda: mock_api.wl_clean_fields(bad, mock_api.WL_TEACHER_FIELDS))[0] == 400


def test_field_sets_are_exactly_the_spec():
    assert mock_api.WL_TEACHER_FIELDS == frozenset(
        {"name", "code", "department_id", "dept_order", "active"})
    assert mock_api.WL_SUBJECT_FIELDS == frozenset(
        {"code", "name", "type", "department_id", "duration", "is_activity", "is_elective", "active"})


# ── ตรวจค่า ────────────────────────────────────────────────────────────
def _t(f, creating=False):
    return mock_api.wl_check_teacher(f, creating)


def _s(f, creating=False):
    return mock_api.wl_check_subject(f, creating)


def test_teacher_values():
    assert _t({"name": "  สมชาย "}, True) == {
        "name": "สมชาย", "code": None, "department_id": None, "dept_order": None, "active": True}
    assert _t({"department_id": 1, "dept_order": 3, "code": "T1", "active": False}) == {
        "department_id": 1, "dept_order": 3, "code": "T1", "active": False}
    assert _t({"department_id": None, "code": None}) == {"department_id": None, "code": None}
    for bad, field in (({"name": "   "}, "name"), ({"name": 5}, "name"), ({}, "name"),
                       ({"name": "ก", "code": 5}, "code"),
                       ({"name": "ก", "department_id": 999}, "department_id"),
                       ({"name": "ก", "department_id": True}, "department_id"),
                       ({"name": "ก", "department_id": "1"}, "department_id"),
                       ({"name": "ก", "dept_order": True}, "dept_order"),
                       ({"name": "ก", "dept_order": 1.5}, "dept_order"),
                       ({"name": "ก", "dept_order": 10 ** 12}, "dept_order"),
                       ({"name": "ก", "active": 1}, "active"),
                       ({"name": "ก", "active": "true"}, "active"),
                       ({"name": "a\x00b"}, "name"),
                       ({"name": "\ud800"}, "name")):
        c, d = _code(lambda: _t(bad, True))
        assert c == 400 and field in d, (bad, c, d)
    # PUT: name ไม่บังคับ แต่ถ้าส่งมาต้องไม่ว่าง
    assert _t({"active": False}, False) == {"active": False}
    assert _code(lambda: _t({"name": " "}, False))[0] == 400


def test_subject_values():
    got = _s({"code": " MA1 ", "name": "คณิต"}, True)
    assert got == {"code": "MA1", "name": "คณิต", "type": "common", "department_id": None,
                   "duration": 1, "is_activity": False, "is_elective": False, "active": True}
    assert _s({"type": "parallel", "duration": 2}) == {"type": "parallel", "duration": 2}
    for bad, field in (({"name": "x"}, "code"), ({"code": "x"}, "name"),
                       ({"code": "", "name": "x"}, "code"),
                       ({"code": "x", "name": "x", "type": "x"}, "type"),
                       ({"code": "x", "name": "x", "type": None}, "type"),
                       ({"code": "x", "name": "x", "duration": 3}, "duration"),
                       ({"code": "x", "name": "x", "duration": True}, "duration"),
                       ({"code": "x", "name": "x", "duration": "1"}, "duration"),
                       ({"code": "x", "name": "x", "is_activity": 0}, "is_activity"),
                       ({"code": "x", "name": "x", "is_elective": "no"}, "is_elective"),
                       ({"code": "x", "name": "x", "active": None}, "active"),
                       ({"code": "x", "name": "x", "department_id": 0}, "department_id")):
        c, d = _code(lambda: _t_s(bad))
        assert c == 400 and field in d, (bad, c, d)


def _t_s(bad):
    return _s(bad, True)


# ── route: ใครเรียกอะไรได้ + SQL ───────────────────────────────────────
class _Cur:
    """cursor ปลอม: จดทุกคำสั่ง · คิวผลของ fetchall/fetchone/rowcount ตามลำดับ"""
    def __init__(self, session_row, results=()):
        self.session_row = session_row
        self.results = list(results)
        self.log: list[tuple[str, object]] = []
        self.rowcount = 0
        self._cur = None

    def execute(self, sql, params=None):
        self.log.append((sql, params))
        if "wl_sessions" in sql:
            self._cur = [self.session_row] if self.session_row else []
            return
        nxt = self.results.pop(0) if self.results else []
        if isinstance(nxt, int):
            self.rowcount, self._cur = nxt, []
        else:
            self._cur = nxt

    def fetchall(self): return list(self._cur)
    def fetchone(self): return self._cur[0] if self._cur else None


def _sess(role):
    import datetime as dt
    h = mock_api.wl_token_hash("tok")
    exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
    return (h, 7, role, None if role == "admin" else 2, "x", exp)


def _call(fn, cur, *a, **kw):
    import contextlib

    @contextlib.contextmanager
    def fake():
        yield cur
    saved = mock_api._wl_db
    mock_api._wl_db = fake
    try:
        return fn(*a, **kw)
    finally:
        mock_api._wl_db = saved


REQ = SimpleNamespace(headers={"authorization": "Bearer tok"})
NOREQ = SimpleNamespace(headers={})
TROW = (1, None, "ก", None, 1, 1, True)


def _writes(cur):
    return [s for s, _ in cur.log if s.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]


def test_reads_need_login_but_not_admin():
    c, _ = _code(lambda: _call(mock_api.wl_teachers_list, _Cur(None), NOREQ))
    assert c == 401
    cur = _Cur(_sess("head"), [[TROW]])
    out = _call(mock_api.wl_teachers_list, cur, REQ)
    assert out == [{"id": 1, "sched_id": None, "name": "ก", "code": None,
                    "department_id": 1, "dept_order": 1, "active": True}]
    assert _call(mock_api.wl_subjects_list, _Cur(_sess("head"), [[]]), REQ) == []


def test_writes_are_admin_only_and_write_nothing_for_heads():
    cases = [
        (mock_api.wl_teachers_create, (REQ, {"name": "ก"})),
        (mock_api.wl_teachers_update, (1, REQ, {"active": False})),
        (mock_api.wl_subjects_create, (REQ, {"code": "a", "name": "b"})),
        (mock_api.wl_subjects_update, (1, REQ, {"active": False})),
        (mock_api.wl_teachers_import_preview, (REQ,)),
        (mock_api.wl_teachers_import, (REQ,)),
        (mock_api.wl_subjects_import_preview, (REQ,)),
        (mock_api.wl_subjects_import, (REQ,)),
    ]
    for fn, args in cases:
        cur = _Cur(_sess("head"), [[TROW]])
        c, _ = _code(lambda: _call(fn, cur, *args))
        assert c == 403, fn.__name__
        assert _writes(cur) == [], fn.__name__
        c, _ = _code(lambda: _call(fn, _Cur(None), *((NOREQ,) + args[1:])))
        assert c == 401, fn.__name__


def test_teacher_update_sql_uses_params_and_only_sent_keys():
    cur = _Cur(_sess("admin"), [[TROW]])
    _call(mock_api.wl_teachers_update, cur, 1, REQ, {"active": False})
    sql, params = cur.log[-1]
    assert "active = %s" in sql and "name" not in sql.split("WHERE")[0]
    assert params == (False, 1)
    # ค่าจากผู้ใช้ไม่ปรากฏในข้อความ SQL
    cur = _Cur(_sess("admin"), [[TROW]])
    _call(mock_api.wl_teachers_update, cur, 1, REQ, {"name": "x'; DROP TABLE wl_teachers;--"})
    assert "DROP" not in cur.log[-1][0]


def test_update_empty_body_400_and_missing_row_404():
    assert _code(lambda: _call(mock_api.wl_teachers_update, _Cur(_sess("admin")), 1, REQ, {}))[0] == 400
    assert _code(lambda: _call(mock_api.wl_teachers_update, _Cur(_sess("admin")), 1, REQ, None))[0] == 400
    assert _code(lambda: _call(mock_api.wl_teachers_update, _Cur(_sess("admin"), [[]]),
                               1, REQ, {"active": False}))[0] == 404
    assert _code(lambda: _call(mock_api.wl_subjects_update, _Cur(_sess("admin"), [[]]),
                               1, REQ, {"active": False}))[0] == 404


def test_bad_body_rejected_before_any_write():
    cur = _Cur(_sess("admin"))
    c, d = _code(lambda: _call(mock_api.wl_teachers_create, cur, REQ, {"name": "ก", "fixed_room_id": 3}))
    assert c == 400 and "fixed_room_id" in d and _writes(cur) == []


# ── ดึงครู ─────────────────────────────────────────────────────────────
class _Sched:
    """แทนลิสต์ของโปรแกรมจัดตาราง (TEACHERS หรือ SUBJECTS) ชั่วคราว + สถานะ write-blocked"""
    attr = "TEACHERS"

    def __init__(self, rows, blocked=False):
        self.rows, self.blocked = rows, blocked

    def __enter__(self):
        self.t0, self.b0 = getattr(mock_api, self.attr), mock_api._db_write_blocked
        setattr(mock_api, self.attr, self.rows)
        mock_api._db_write_blocked = lambda: self.blocked
        return self

    def __exit__(self, *a):
        setattr(mock_api, self.attr, self.t0)
        mock_api._db_write_blocked = self.b0


class _Teachers(_Sched):
    attr = "TEACHERS"


class _Subjects(_Sched):
    attr = "SUBJECTS"


def test_import_refused_while_school_data_not_loaded():
    with _Teachers([{"id": 1, "name": "ก"}], blocked=True):
        for fn in (mock_api.wl_teachers_import_preview, mock_api.wl_teachers_import):
            cur = _Cur(_sess("admin"), [[]])
            c, d = _code(lambda: _call(fn, cur, REQ))
            assert c == 503 and not d.isascii(), fn.__name__
            assert _writes(cur) == []


def test_import_preview_counts_and_writes_nothing():
    sched = [{"id": 1, "name": "ก"}, {"id": 2, "name": "ข"}, {"id": 3, "name": "ค"}, {"name": "ไม่มีรหัส"}]
    with _Teachers(sched):
        cur = _Cur(_sess("admin"), [[(10, 1, "ก")]])
        out = _call(mock_api.wl_teachers_import_preview, cur, REQ)
    assert out == {"created": 2, "linked": 1, "skipped": 1}
    assert _writes(cur) == []


def test_import_post_counts_real_rowcount_and_copies_only_registry_fields():
    sched = [{"id": 1, "name": "ก", "code": "T1", "department_id": 2, "dept_order": 4,
              "fixed_room_id": 9, "max_slots_per_day": 6, "active": False},
             {"id": 2, "name": None},
             {"id": 3, "name": "ค"}]
    snap = copy.deepcopy(sched)

    class Cur(_Cur):
        def execute(self, sql, params=None):
            super().execute(sql, params)
            if sql.lstrip().upper().startswith("INSERT"):
                # รายการที่สามชนกับอีก admin ที่กดพร้อมกัน
                self.rowcount = 0 if params[0] == 3 else 1
    with _Teachers(sched):
        cur = Cur(_sess("admin"), [[]])
        out = _call(mock_api.wl_teachers_import, cur, REQ)
    assert out == {"created": 2, "linked": 1, "skipped": 0}
    inserts = [(s, p) for s, p in cur.log if s.lstrip().upper().startswith("INSERT")]
    assert len(inserts) == 3
    assert all("ON CONFLICT (sched_id) DO NOTHING" in s for s, _ in inserts)
    assert all("fixed_room_id" not in s and "max_slots" not in s for s, _ in inserts)
    assert inserts[0][1] == (1, "ก", "T1", 2, 4, False)
    assert inserts[1][1] == (2, "", None, None, None, True)
    assert sched == snap


# ── ดึงวิชา (พฤติกรรมเดียวกับดึงครู) ───────────────────────────────────
def _inserts(cur):
    return [(s, p) for s, p in cur.log if s.lstrip().upper().startswith("INSERT")]


def test_subject_import_refused_while_school_data_not_loaded():
    with _Subjects([{"id": 1, "code": "a", "name": "ก"}], blocked=True):
        for fn in (mock_api.wl_subjects_import_preview, mock_api.wl_subjects_import):
            cur = _Cur(_sess("admin"), [[]])
            c, d = _code(lambda: _call(fn, cur, REQ))
            assert c == 503 and not d.isascii() and "วิชา" in d, (fn.__name__, d)
            assert _writes(cur) == []


def test_subject_import_preview_counts_and_writes_nothing():
    sched = [{"id": 1, "code": "a", "name": "ก"}, {"id": 2, "code": "b", "name": "ข"},
             {"id": 3, "code": "c", "name": "ค"}, {"code": "x", "name": "ไม่มีรหัส"}]
    with _Subjects(sched):
        cur = _Cur(_sess("admin"), [[(10, 1, "ก")]])
        out = _call(mock_api.wl_subjects_import_preview, cur, REQ)
    assert out == {"created": 2, "linked": 1, "skipped": 1}
    assert _writes(cur) == []
    assert any("FROM wl_subjects" in s for s, _ in cur.log)


def test_subject_import_post_copies_only_identity_fields():
    sched = [{"id": 1, "code": "MA1", "name": "คณิต", "type": "parallel", "department_id": 2,
              "duration": 2, "is_activity": True, "is_elective": True, "active": False,
              "fixed_room_id": 9, "credits": 1.5, "allowed_rooms": [1, 2], "prefer_morning": True},
             {"id": 2, "code": None, "name": None},
             {"id": 3, "code": "SC1", "name": "วิทย์"}]
    snap = copy.deepcopy(sched)

    class Cur(_Cur):
        def execute(self, sql, params=None):
            super().execute(sql, params)
            if sql.lstrip().upper().startswith("INSERT"):
                self.rowcount = 0 if params[0] == 3 else 1   # รายการที่สามชนกับ admin อีกคน
    with _Subjects(sched):
        cur = Cur(_sess("admin"), [[]])
        out = _call(mock_api.wl_subjects_import, cur, REQ)
    assert out == {"created": 2, "linked": 1, "skipped": 0}
    ins = _inserts(cur)
    assert len(ins) == 3
    for sql, params in ins:
        assert "INTO wl_subjects" in sql and "ON CONFLICT (sched_id) DO NOTHING" in sql
        for bad in ("fixed_room_id", "credits", "room", "prefer"):
            assert bad not in sql, bad
        assert 9 not in params and 1.5 not in params and [1, 2] not in params
    assert ins[0][1] == (1, "MA1", "คณิต", "parallel", 2, 2, True, True, False)
    assert ins[1][1] == (2, "", "", "common", None, 1, False, False, True)
    assert sched == snap, "ห้ามแก้ dict ใน SUBJECTS"


def test_subject_import_same_name_and_code_different_id_makes_two_rows():
    sched = [{"id": 5, "code": "MA1", "name": "คณิต"}, {"id": 6, "code": "MA1", "name": "คณิต"}]

    class Cur(_Cur):
        def execute(self, sql, params=None):
            super().execute(sql, params)
            if sql.lstrip().upper().startswith("INSERT"):
                self.rowcount = 1
    with _Subjects(sched):
        cur = Cur(_sess("admin"), [[(1, None, "คณิต")]])   # แถวพิมพ์เองชื่อเดียวกันไม่ถูกนับว่ามีแล้ว
        out = _call(mock_api.wl_subjects_import, cur, REQ)
    assert out == {"created": 2, "linked": 0, "skipped": 0}
    assert [p[0] for _, p in _inserts(cur)] == [5, 6]


def test_teacher_import_reads_teachers_not_subjects():
    with _Teachers([{"id": 1, "name": "ก"}]), _Subjects([{"id": 1, "code": "a", "name": "ข"},
                                                         {"id": 2, "code": "b", "name": "ค"}]):
        out = _call(mock_api.wl_teachers_import_preview, _Cur(_sess("admin"), [[]]), REQ)
    assert out == {"created": 1, "linked": 0, "skipped": 0}


# ── ไม่มี endpoint ลบ ──────────────────────────────────────────────────
def test_no_delete_route_under_workload():
    verbs = [(v, p) for v, p, _ in mock_api.app.routes if p.startswith("/api/workload")]
    assert verbs, "ไม่พบ route ของเว็บใหม่เลย — ตัวทดสอบนี้ไม่ได้ตรวจอะไร"
    assert not [x for x in verbs if x[0].lower() == "delete"]
    paths = {(v, p) for v, p in verbs}
    for want in (("get", "/api/workload/teachers"), ("post", "/api/workload/teachers"),
                 ("put", "/api/workload/teachers/{teacher_id}"),
                 ("get", "/api/workload/subjects"), ("post", "/api/workload/subjects"),
                 ("put", "/api/workload/subjects/{subject_id}"),
                 ("get", "/api/workload/teachers/import-from-scheduler"),
                 ("post", "/api/workload/teachers/import-from-scheduler"),
                 ("get", "/api/workload/subjects/import-from-scheduler"),
                 ("post", "/api/workload/subjects/import-from-scheduler")):
        assert want in paths, want


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
