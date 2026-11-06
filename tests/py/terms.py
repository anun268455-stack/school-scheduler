"""
เทอม: ตารางเก็บไฟล์เทอมในฐานข้อมูล และรายการเทอม

ตัวทดสอบชุดนี้ไม่ต่อฐานข้อมูลจริง — ตรวจสิ่งที่ตรวจได้โดยไม่มีฐานข้อมูล
คือชื่อเทอม ข้อความปฏิเสธ รูปแบบคำตอบเมื่อไม่มีฐานข้อมูล และคำสั่งสร้างตาราง
"""
import sys

import mock_api

fails: list[str] = []


def ok(cond: object, what: str) -> None:
    if not cond:
        fails.append(what)


def test_term_label():
    assert mock_api.term_label(2569, 1) == "1/2569"
    assert mock_api.term_label(2568, 2) == "2/2568"


def test_require_db_refuses_without_postgres():
    mock_api._STORE_KIND = "file"
    try:
        mock_api._require_db()
        assert False, "ต้องยก HTTPException"
    except Exception as exc:
        assert "ยังไม่ได้ต่อฐานข้อมูล" in str(exc)
        ok(isinstance(exc, mock_api.HTTPException) and exc.status_code == 400,
           "ปฏิเสธด้วย HTTPException 400")


def test_terms_list_reports_unavailable_without_postgres():
    mock_api._STORE_KIND = "file"
    out = mock_api.list_terms()
    assert out["available"] is False
    assert out["terms"] == []
    ok("ยังไม่ได้ต่อฐานข้อมูล" in out.get("reason", ""), "บอกเหตุผลเป็นภาษาไทย")


def test_terms_schema_has_unique_year_semester():
    # ปี+ภาคเรียนซ้ำต้องถูกฐานข้อมูลปฏิเสธ ไม่ใช่แค่โค้ดตรวจ (Review Focus 3)
    assert "UNIQUE (year, semester)" in mock_api._TERMS_SCHEMA
    assert "app_terms" in mock_api._TERMS_SCHEMA


def test_terms_one_active_index_present():
    assert "app_terms_one_active" in mock_api._TERMS_ONE_ACTIVE
    assert "UNIQUE INDEX IF NOT EXISTS" in mock_api._TERMS_ONE_ACTIVE
    assert "WHERE status = 'active'" in mock_api._TERMS_ONE_ACTIVE


def test_schema_helper_runs_both_statements():
    ran = []

    class Cur:
        def execute(self, sql, *a):
            ran.append(sql)
    mock_api._terms_schema(Cur())
    assert ran == [mock_api._TERMS_SCHEMA, mock_api._TERMS_ONE_ACTIVE]


def test_every_term_function_uses_schema_helper():
    import inspect
    for fn in (mock_api._terms_list, mock_api._term_row, mock_api._term_blob,
               mock_api._term_insert, mock_api._term_set_status):
        src = inspect.getsource(fn)
        assert "_terms_schema(cur)" in src, fn.__name__
        assert "execute(_TERMS_SCHEMA)" not in src, fn.__name__


def test_bad_status_rejected_before_database():
    def boom():
        raise AssertionError("ต้องปฏิเสธก่อนต่อฐานข้อมูล")
    saved = mock_api._db_connect
    mock_api._db_connect = boom
    try:
        for bad in ("Closed", "open", ""):
            for call in (lambda b=bad: mock_api._term_insert(2569, 1, "1/2569", b, b"", 0),
                         lambda b=bad: mock_api._term_set_status(1, b)):
                try:
                    call()
                    assert False, f"ต้องปฏิเสธ {bad!r}"
                except ValueError as exc:
                    assert "สถานะเทอมไม่ถูกต้อง" in str(exc)
    finally:
        mock_api._db_connect = saved
    assert mock_api.TERM_STATUSES == frozenset({"active", "closed"})


def test_terms_list_survives_database_error():
    # ฐานข้อมูลล่ม: หน้าจอยังต้องเปิดได้ และข้อความต้องไม่รั่วรายละเอียดการเชื่อมต่อ
    saved = mock_api._db_connect

    def boom():
        raise RuntimeError("postgresql://user:SECRET@host/db")
    mock_api._STORE_KIND = "postgres"
    mock_api._db_connect = boom
    try:
        out = mock_api.list_terms()
    finally:
        mock_api._db_connect = saved
        mock_api._STORE_KIND = "file"
    ok(out["available"] is False and out["terms"] == [], "ฐานข้อมูลล่ม = available False")
    ok("SECRET" not in str(out), "ไม่เอาข้อความผิดพลาดดิบ (อาจมีรหัสผ่าน) ไปให้หน้าจอ")


def test_terms_schema_columns_and_list_has_no_data():
    s = mock_api._TERMS_SCHEMA
    for col in ("id        bigserial PRIMARY KEY", "status    text NOT NULL",
                "data      bytea NOT NULL", "closed_at timestamptz"):
        ok(col in s, f"คอลัมน์ {col}")
    ok("length(data)" in mock_api._TERM_COLUMNS and "data," not in mock_api._TERM_COLUMNS,
       "รายการวัดขนาดด้วย length(data) ไม่โหลดก้อนข้อมูล")


BLANK = {"id": None, "year": None, "semester": None, "label": None, "status": None}


def test_preview_counts_what_the_new_term_will_hold():
    mock_api.REQUIREMENTS[:] = [
        {"id": 1, "weekly_count": 3}, {"id": 2, "weekly_count": 2},
    ]
    mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}, {"id": 3}]
    out = mock_api.new_term_preview()
    assert out["requirements"] == 2
    assert out["periods_total"] == 5
    assert out["slots_to_clear"] == 3


def test_preview_tolerates_missing_weekly_count():
    mock_api.REQUIREMENTS[:] = [{"id": 1}, {"id": 2, "weekly_count": None},
                                {"id": 3, "weekly_count": 4}]
    assert mock_api.new_term_preview()["periods_total"] == 4


def test_snapshot_carries_current_term():
    mock_api.CURRENT_TERM.update({"id": 7, "year": 2569, "semester": 1, "label": "1/2569"})
    snap = mock_api._snapshot()
    assert snap["current_term"]["label"] == "1/2569"


def test_current_term_has_status_key_for_the_write_guard():
    assert set(mock_api.CURRENT_TERM) == {"id", "year", "semester", "label", "status"}
    mock_api.CURRENT_TERM.update({**BLANK, "id": 7, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "closed"})
    assert mock_api._snapshot()["current_term"]["status"] == "closed"
    snap = mock_api._snapshot()
    mock_api.CURRENT_TERM.update(BLANK)
    mock_api._apply_snapshot(snap)
    assert mock_api.CURRENT_TERM["status"] == "closed"


def test_snapshot_current_term_is_a_copy():
    mock_api.CURRENT_TERM.update({**BLANK, "id": 7})
    snap = mock_api._snapshot()
    mock_api.CURRENT_TERM["id"] = 8
    assert snap["current_term"]["id"] == 7


def test_apply_snapshot_restores_current_term():
    mock_api.CURRENT_TERM.update({"id": None, "year": None, "semester": None, "label": None})
    mock_api._apply_snapshot({"current_term":
        {"id": 7, "year": 2569, "semester": 1, "label": "1/2569"}})
    assert mock_api.CURRENT_TERM["year"] == 2569
    assert mock_api.CURRENT_TERM["status"] is None   # ไฟล์เก่าไม่มีสถานะ ต้องไม่พัง


def test_apply_snapshot_without_current_term_leaves_it_blank():
    # ไฟล์สำรองเก่าที่ทำไว้ก่อนมีระบบเทอม ต้องโหลดได้ ไม่พัง
    mock_api.CURRENT_TERM.update({"id": 7, "year": 2569, "semester": 1, "label": "1/2569"})
    mock_api._apply_snapshot({})
    assert mock_api.CURRENT_TERM["year"] is None
    assert mock_api.CURRENT_TERM["status"] is None


def test_apply_snapshot_with_garbage_current_term_leaves_it_blank():
    for bad in (None, "x", 5, []):
        mock_api.CURRENT_TERM.update({**BLANK, "id": 7, "status": "active"})
        mock_api._apply_snapshot({"current_term": bad})
        assert mock_api.CURRENT_TERM == BLANK


def test_config_cannot_change_term_once_a_term_exists():
    mock_api.CURRENT_TERM.update({"id": 7, "year": 2569, "semester": 1, "label": "1/2569"})
    mock_api.SCHOOL_CONFIG.update({"term": "1", "year": "2569"})
    mock_api.update_school_config({"term": "2", "year": "2570", "schoolName": "ทดสอบ"})
    assert mock_api.SCHOOL_CONFIG["term"] == "1"      # ไม่ถูกเปลี่ยน
    assert mock_api.SCHOOL_CONFIG["year"] == "2569"
    assert mock_api.SCHOOL_CONFIG["schoolName"] == "ทดสอบ"   # ช่องอื่นยังแก้ได้


def test_config_still_editable_before_any_term_exists():
    mock_api.CURRENT_TERM.update({"id": None, "year": None, "semester": None, "label": None})
    mock_api.update_school_config({"term": "2", "year": "2570"})
    assert mock_api.SCHOOL_CONFIG["term"] == "2"
    assert mock_api.SCHOOL_CONFIG["year"] == "2570"


def test_create_term_rejects_bad_year_and_semester():
    mock_api._STORE_KIND = "postgres"
    for body in ({"year": 1999, "semester": 1}, {"year": 2569, "semester": 3},
                 {"year": "สองพัน", "semester": 1}):
        try:
            mock_api.create_term(body)
            assert False, f"ต้องปฏิเสธ {body}"
        except Exception as exc:
            assert "400" in repr(exc) or "ภาคเรียน" in str(exc) or "ปีการศึกษา" in str(exc)


def test_create_term_rejects_more_bad_input():
    mock_api._STORE_KIND = "postgres"
    for body in ({}, {"year": 2569}, {"semester": 1}, {"year": 2701, "semester": 1},
                 {"year": 2499, "semester": 1}, {"year": 2569.0, "semester": 1},
                 {"year": "2569", "semester": 1}, {"year": True, "semester": 1},
                 {"year": 2569, "semester": 0}, {"year": 2569, "semester": "1"},
                 {"year": 2569, "semester": None}, {"year": 2569, "semester": True}):
        try:
            mock_api.create_term(body)
            assert False, f"ต้องปฏิเสธ {body}"
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 400, (body, repr(exc))
    mock_api._STORE_KIND = "file"


def test_create_term_needs_database_first():
    mock_api._STORE_KIND = "file"
    try:
        mock_api.create_term({"year": 2569, "semester": 1})
        assert False
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400
        assert "ยังไม่ได้ต่อฐานข้อมูล" in str(exc.detail)


def test_write_blocked_helper_matches_the_state_info_report():
    saved = (mock_api._DB_HAD_DATA, mock_api._STATE_SOURCE)
    try:
        for had in (True, False):
            for src in ("snapshot", "seed", "demo"):
                mock_api._DB_HAD_DATA, mock_api._STATE_SOURCE = had, src
                assert mock_api._db_write_blocked() == (had and src != "snapshot")
                assert mock_api.state_info()["write_blocked"] == mock_api._db_write_blocked()
    finally:
        mock_api._DB_HAD_DATA, mock_api._STATE_SOURCE = saved


class _FakeCur:
    def __init__(self, log, rows):
        self.log, self.rows = log, rows
        self.rowcount = 1

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.log.append((" ".join(sql.split()), params))

    def fetchone(self):
        return (99,)


class _FakeConn:
    def __init__(self, log, fail_on=None):
        self.log, self.fail_on = log, fail_on

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def cursor(self):
        if self.fail_on:
            log, fail = self.log, self.fail_on

            class Failing(_FakeCur):
                def execute(s, sql, params=None):
                    if fail in sql:
                        raise RuntimeError("postgresql://user:SECRET@host/db")
                    super().execute(sql, params)
            return Failing(self.log, None)
        return _FakeCur(self.log, None)

    def commit(self):
        self.log.append(("COMMIT", None))


_FROM_MEMORY = object()
LOGGED: list = []


def _with_fake_db(fn, fail_on=None, existing=(), active=_FROM_MEMORY):
    saved = {k: getattr(mock_api, k) for k in
             ("_db_connect", "_term_active", "_terms_list", "_term_row", "_flush_pending", "_save_state",
              "_STORE_KIND", "_DB_HAD_DATA", "_STATE_SOURCE", "_term_log")}
    log: list = []
    calls: list = []
    mock_api._db_connect = lambda: _FakeConn(log, fail_on)
    mock_api._terms_list = lambda: list(existing)
    if active is _FROM_MEMORY:
        mock_api._term_active = lambda: (
            {"id": mock_api.CURRENT_TERM["id"]}
            if mock_api.CURRENT_TERM["id"] is not None else None)
    else:
        mock_api._term_active = lambda: active
    mock_api._term_row = lambda i: {"id": i}
    mock_api._flush_pending = lambda blocking=False: calls.append(("flush", blocking))
    mock_api._save_state = lambda: calls.append(("save", None))
    mock_api._term_log = lambda tid, action, detail: LOGGED.append((tid, action, detail))
    mock_api._STORE_KIND = "postgres"
    mock_api._DB_HAD_DATA, mock_api._STATE_SOURCE = False, "snapshot"
    del LOGGED[:]
    try:
        return fn(log, calls)
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)


def test_create_first_term_inserts_active_only_and_clears_slots():
    mock_api.CURRENT_TERM.update(BLANK)
    mock_api.SLOTS[:] = [{"id": 1}]
    alias = mock_api.SLOTS

    def run(log, calls):
        out = mock_api.create_term({"year": 2569, "semester": 1})
        sqls = [q for q, _ in log]
        assert not any(q.startswith("UPDATE") for q in sqls), "ยังไม่มีเทอมเก่าให้ปิด"
        assert any("INSERT INTO app_terms" in q for q in sqls)
        assert calls == [("flush", True), ("save", None), ("flush", True)]
        assert out["closed"] is None and out["active"] == {"id": 99}
    _with_fake_db(run)
    assert mock_api.SLOTS is alias and alias == [], "ล้างในที่เดิม ไม่ผูกชื่อใหม่"
    assert mock_api.CURRENT_TERM == {"id": 99, "year": 2569, "semester": 1,
                                     "label": "1/2569", "status": "active"}
    assert mock_api.SCHOOL_CONFIG["term"] == "1" and mock_api.SCHOOL_CONFIG["year"] == "2569"


def test_create_second_term_closes_old_row_before_inserting_new_active():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}]

    def run(log, calls):
        out = mock_api.create_term({"year": 2569, "semester": 2})
        kinds = [q.split()[0] for q, _ in log if not q.startswith("CREATE")]
        # ปิดแถวเก่าก่อน (index ใช้งานได้แถวเดียว) แล้วค่อยแทรกแถวใหม่ ในธุรกรรมเดียว
        assert kinds == ["UPDATE", "INSERT", "COMMIT"], kinds
        upd = [p for q, p in log if q.startswith("UPDATE")][0]
        assert upd[1] == 2 and upd[2] == 5, "แถวเก่าเก็บจำนวนคาบก่อนล้าง และแก้ตาม id"
        assert out["closed"] == {"id": 5}
    _with_fake_db(run, existing=[{"year": 2569, "semester": 1}])
    assert mock_api.CURRENT_TERM["label"] == "2/2569" and mock_api.SLOTS == []


def test_create_term_duplicate_is_409_and_changes_nothing():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.SLOTS[:] = [{"id": 1}]

    def run(log, calls):
        try:
            mock_api.create_term({"year": 2569, "semester": 1})
            assert False
        except Exception as exc:
            assert exc.status_code == 409 and "มีเทอม 1/2569 อยู่แล้ว" in exc.detail
        assert log == [] and calls == []
    _with_fake_db(run, existing=[{"year": 2569, "semester": 1}])
    assert mock_api.SLOTS == [{"id": 1}]


def test_create_term_refuses_while_database_writes_are_blocked():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.SLOTS[:] = [{"id": 1}]

    def run(log, calls):
        mock_api._DB_HAD_DATA, mock_api._STATE_SOURCE = True, "seed"
        try:
            mock_api.create_term({"year": 2569, "semester": 2})
            assert False
        except Exception as exc:
            assert exc.status_code == 409 and "ยืนยันข้อมูลที่ถืออยู่ก่อน" in exc.detail
        assert log == [] and ("flush", True) in calls
    _with_fake_db(run)
    assert mock_api.SLOTS == [{"id": 1}] and mock_api.CURRENT_TERM["id"] == 5


def test_create_term_database_failure_restores_memory_and_hides_secret():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.SCHOOL_CONFIG.update({"term": "1", "year": "2569"})
    mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}]

    def run(log, calls):
        try:
            mock_api.create_term({"year": 2569, "semester": 2})
            assert False
        except Exception as exc:
            assert exc.status_code == 500 and "SECRET" not in str(exc.detail)
        assert ("save", None) not in calls
    _with_fake_db(run, fail_on="INSERT")
    assert mock_api.SLOTS == [{"id": 1}, {"id": 2}]
    assert mock_api.CURRENT_TERM["id"] == 5 and mock_api.CURRENT_TERM["status"] == "active"
    assert mock_api.SCHOOL_CONFIG["term"] == "1" and mock_api.SCHOOL_CONFIG["year"] == "2569"


def test_closing_blob_says_closed_and_clears_parked():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.SLOTS[:] = [{"id": 1}]
    parked = mock_api.PARKED
    parked[:] = [{"id": 1, "rows": []}]
    packed: list = []
    saved_pack = mock_api._pack

    def run(log, calls):
        mock_api._pack = lambda snap: packed.append(
            (dict(snap["current_term"]), list(snap["parked"]))) or b"x"
        out = mock_api.create_term({"year": 2569, "semester": 2})
        assert out["save_error"] is None
        kinds = [q.split()[0] for q, _ in log if not q.startswith("CREATE")]
        assert kinds.index("UPDATE") < kinds.index("INSERT"), "ปิดแถวเก่าก่อนแทรกแถวใหม่"
    try:
        _with_fake_db(run, existing=[{"year": 2569, "semester": 1}])
    finally:
        mock_api._pack = saved_pack
    assert packed[0][0]["status"] == "closed" and packed[0][1] == [{"id": 1, "rows": []}]
    assert packed[1][0]["status"] == "active" and packed[1][0]["id"] is None
    assert packed[1][1] == []
    assert mock_api.PARKED is parked and parked == []


def test_create_term_failure_restores_parked_and_status():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.PARKED[:] = [{"id": 1, "rows": []}]

    def run(log, calls):
        try:
            mock_api.create_term({"year": 2569, "semester": 2})
            assert False
        except Exception as exc:
            assert exc.status_code == 500
    _with_fake_db(run, fail_on="INSERT")
    assert mock_api.PARKED == [{"id": 1, "rows": []}]
    assert mock_api.CURRENT_TERM["status"] == "active"
    mock_api.PARKED.clear()


def test_create_term_reports_save_error_in_fixed_thai_without_raising():
    mock_api.CURRENT_TERM.update(BLANK)
    saved = (mock_api._STORE_ERROR, mock_api._pending_blob)

    def run(log, calls):
        # asynchronous like the real one: only queues; the blocking flush after it fails
        def fake_save():
            mock_api._pending_blob = (b"x", 0)

        def fake_flush(blocking=False):
            calls.append(("flush", blocking))
            if mock_api._pending_blob is not None and len(calls) > 1:
                mock_api._STORE_ERROR = "OperationalError: postgresql://u:SECRET@h/d"
        mock_api._save_state = fake_save
        mock_api._flush_pending = fake_flush
        out = mock_api.create_term({"year": 2570, "semester": 1})
        assert calls == [("flush", True), ("flush", True)], "ต้องล้างคิวอีกรอบหลังเข้าคิว"
        assert out["save_error"] and "SECRET" not in out["save_error"]
        assert "OperationalError" not in out["save_error"]
        assert "สร้างเทอมใหม่แล้ว" in out["save_error"] and out["active"] == {"id": 99}
    try:
        _with_fake_db(run)
    finally:
        mock_api._STORE_ERROR, mock_api._pending_blob = saved


def test_create_term_flush_raising_after_commit_still_reports_created_term():
    mock_api.CURRENT_TERM.update(BLANK)
    saved = (mock_api._STORE_ERROR, mock_api._pending_blob)

    def run(log, calls):
        def fake_flush(blocking=False):
            calls.append(("flush", blocking))
            if len(calls) > 1:
                raise RuntimeError("postgresql://u:SECRET@h/d")
        mock_api._flush_pending = fake_flush
        mock_api._save_state = lambda: setattr(mock_api, "_pending_blob", (b"x", 0))
        out = mock_api.create_term({"year": 2570, "semester": 1})   # must not raise
        assert out["active"] == {"id": 99}
        assert out["save_error"] and "SECRET" not in out["save_error"]
        assert out["save_pending"] is True
    try:
        _with_fake_db(run)
    finally:
        mock_api._STORE_ERROR, mock_api._pending_blob = saved
    assert mock_api.CURRENT_TERM["id"] == 99


def test_create_term_save_error_none_when_flush_lands():
    mock_api.CURRENT_TERM.update(BLANK)
    saved = (mock_api._STORE_ERROR, mock_api._pending_blob)
    mock_api._STORE_ERROR = None

    def run(log, calls):
        out = mock_api.create_term({"year": 2570, "semester": 1})
        assert out["save_error"] is None and out["save_pending"] is False
    try:
        _with_fake_db(run)
    finally:
        mock_api._STORE_ERROR, mock_api._pending_blob = saved


def test_pack_failure_restores_status_and_slots():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}]
    mock_api.PARKED[:] = [{"id": 1, "rows": []}]
    saved_pack = mock_api._pack

    for nth in (1, 2):          # the closing pack, then the new-term pack
        n = [0]

        def pack(snap, n=n, nth=nth):
            n[0] += 1
            if n[0] == nth:
                raise MemoryError("x")
            return b"x"
        mock_api._pack = pack

        def run(log, calls):
            try:
                mock_api.create_term({"year": 2569, "semester": 2})
                assert False
            except Exception as exc:
                assert exc.status_code == 500
            assert not any(q.startswith("UPDATE") for q, _ in log)
        try:
            _with_fake_db(run)
        finally:
            mock_api._pack = saved_pack
        assert mock_api.CURRENT_TERM["status"] == "active" and mock_api.CURRENT_TERM["id"] == 5
        assert mock_api.SLOTS == [{"id": 1}, {"id": 2}]
        assert mock_api.PARKED == [{"id": 1, "rows": []}]
    mock_api.PARKED.clear()


def test_active_row_wins_when_memory_is_blank_the_wedge():
    # a backup from before the term system blanked CURRENT_TERM; the table still has an active row
    mock_api.CURRENT_TERM.update(BLANK)
    mock_api.SLOTS[:] = [{"id": 1}]

    def run(log, calls):
        out = mock_api.create_term({"year": 2569, "semester": 2})
        kinds = [q.split()[0] for q, _ in log if not q.startswith("CREATE")]
        assert kinds == ["UPDATE", "INSERT", "COMMIT"], kinds
        assert [p for q, p in log if q.startswith("UPDATE")][0][2] == 41, "ปิดแถวที่ฐานข้อมูลบอกว่า active"
        assert out["closed"] == {"id": 41} and out["active"] == {"id": 99}
    _with_fake_db(run, active={"id": 41, "year": 2569, "semester": 1})
    assert mock_api.CURRENT_TERM["id"] == 99


def test_active_row_wins_when_it_disagrees_with_memory():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})

    def run(log, calls):
        mock_api.create_term({"year": 2569, "semester": 2})
        assert [p for q, p in log if q.startswith("UPDATE")][0][2] == 41
    _with_fake_db(run, active={"id": 41})


def test_no_active_row_means_nothing_to_close_even_if_memory_has_an_id():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})

    def run(log, calls):
        out = mock_api.create_term({"year": 2569, "semester": 2})
        assert not any(q.startswith("UPDATE") for q, _ in log) and out["closed"] is None
    _with_fake_db(run, active=None)


def test_term_active_selects_the_active_row_only():
    log: list = []

    class Conn(_FakeConn):
        def cursor(self):
            c = _FakeCur(log, None)
            c.fetchone = lambda: None
            return c
    saved = mock_api._db_connect
    mock_api._db_connect = lambda: Conn(log)
    try:
        assert mock_api._term_active() is None
    finally:
        mock_api._db_connect = saved
    assert any("WHERE status = 'active'" in q for q, _ in log)


# ---------- Task 4: เปิดดูเทอมเก่า · ปลดล็อก · log ----------

def test_unlock_requires_exact_label():
    t = {"id": 3, "label": "2/2568", "status": "closed"}
    assert mock_api.unlock_check(t, "2/2568") is None
    assert mock_api.unlock_check(t, "  2/2568  ") is None
    assert mock_api.unlock_check(t, "2/2569") is not None
    assert mock_api.unlock_check(t, "") is not None


def test_unlock_refuses_a_term_that_is_not_closed():
    t = {"id": 4, "label": "1/2569", "status": "active"}
    assert mock_api.unlock_check(t, "1/2569") == "เทอมนี้ไม่ได้ปิดอยู่"
    assert mock_api.unlock_check({"id": 4, "label": "x", "status": "closed"}, "y") \
        == "พิมพ์ชื่อเทอมให้ตรงก่อน"


def test_term_data_endpoint_does_not_touch_server_state():
    mock_api._STORE_KIND = "file"
    mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}]
    before = list(mock_api.SLOTS)
    try:
        mock_api.term_data(999)
    except Exception:
        pass
    assert mock_api.SLOTS == before


def _term_data_with(row, blob):
    saved = {k: getattr(mock_api, k) for k in ("_term_row", "_term_blob", "_apply_snapshot", "_STORE_KIND")}
    applied = []
    mock_api._STORE_KIND = "postgres"
    mock_api._term_row = lambda i: row
    mock_api._term_blob = lambda i: blob
    mock_api._apply_snapshot = lambda d: applied.append(d)
    cur_before = dict(mock_api.CURRENT_TERM)
    slots_before = list(mock_api.SLOTS)
    try:
        out = mock_api.term_data(7)
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)
    assert not applied, "ห้ามเรียก _apply_snapshot"
    assert mock_api.CURRENT_TERM == cur_before and mock_api.SLOTS == slots_before
    return out


def test_term_data_takes_current_term_from_the_row_not_the_blob():
    blob = mock_api._pack({"slots": [{"id": 5}],
                           "current_term": {"id": None, "status": "active"}})
    row = {"id": 7, "year": 2568, "semester": 2, "label": "2/2568", "status": "closed"}
    out = _term_data_with(row, blob)
    assert out["current_term"] == {"id": 7, "year": 2568, "semester": 2,
                                   "label": "2/2568", "status": "closed"}
    assert out["slots"] == [{"id": 5}]


def test_term_data_overwrites_even_when_blob_has_no_current_term():
    blob = mock_api._pack({"slots": []})
    row = {"id": 7, "year": 2568, "semester": 2, "label": "2/2568", "status": "closed"}
    assert _term_data_with(row, blob)["current_term"]["status"] == "closed"


def _http(fn, *a):
    try:
        fn(*a)
    except mock_api.HTTPException as exc:
        return exc
    return None


def test_term_data_refuses_the_active_term_with_409_and_no_snapshot():
    blob = mock_api._pack({"slots": [{"id": 5}]})
    mock_api._STORE_KIND = "postgres"
    for status in ("active", "Closed", None):
        row = {"id": 4, "year": 2569, "semester": 1, "label": "1/2569", "status": status}
        saved = {k: getattr(mock_api, k) for k in ("_term_row", "_term_blob", "_apply_snapshot", "_STORE_KIND")}
        read = []
        mock_api._term_row = lambda i, r=row: r
        mock_api._term_blob = lambda i: read.append(i) or blob
        mock_api._apply_snapshot = lambda d: read.append("apply")
        mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}]
        cur_before = dict(mock_api.CURRENT_TERM)
        try:
            result = None
            try:
                result = mock_api.term_data(4)
            except mock_api.HTTPException as exc:
                err = exc
        finally:
            for k, v in saved.items():
                setattr(mock_api, k, v)
        assert result is None, "ห้ามมีสำเนาในคำตอบ"
        assert err.status_code == 409 and "เทอมที่ใช้งานอยู่" in err.detail, status
        assert read == [], "ไม่อ่านก้อนข้อมูลและไม่แตะ _apply_snapshot"
        assert mock_api.SLOTS == [{"id": 1}, {"id": 2}] and mock_api.CURRENT_TERM == cur_before
    mock_api._STORE_KIND = "file"


def test_term_data_404_when_no_row_and_503_when_database_down():
    saved = {k: getattr(mock_api, k) for k in ("_term_row", "_term_blob", "_STORE_KIND")}
    mock_api._STORE_KIND = "postgres"
    try:
        mock_api._term_row = lambda i: None
        exc = _http(mock_api.term_data, 9)
        assert exc and exc.status_code == 404 and "ไม่พบเทอม" in exc.detail

        def boom(i):
            raise RuntimeError("postgresql://user:SECRET@host/db")
        mock_api._term_row = boom
        exc = _http(mock_api.term_data, 9)
        assert exc and exc.status_code == 503 and "SECRET" not in exc.detail
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)


def _unlock_setup(blob_term_id=None):
    """memory = term 5 (active, 2 lessons); term 3 is closed and holds 1 lesson."""
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}]
    mock_api.PARKED.clear()
    return mock_api._pack({"slots": [{"id": 77}],
                           "current_term": {"id": None, "year": 2568, "semester": 2,
                                            "label": "2/2568", "status": "active"}})


CLOSED3 = {"id": 3, "year": 2568, "semester": 2, "label": "2/2568", "status": "closed"}


def _run_unlock(body, row=CLOSED3, active=None, blob=None, fail_on=None, extra=None):
    blob = blob if blob is not None else _unlock_setup()
    active = active if active is not None else {"id": 5, "label": "1/2569"}
    saved_blob = mock_api._term_blob
    mock_api._term_blob = lambda i: blob

    def run(log, calls):
        mock_api._term_row = lambda i: row if i == row["id"] else {"id": i}
        if extra:
            extra(log, calls)
        try:
            return mock_api.unlock_term(row["id"], body), log, calls
        except mock_api.HTTPException as exc:
            return exc, log, calls
    try:
        return _with_fake_db(run, active=active, fail_on=fail_on)
    finally:
        mock_api._term_blob = saved_blob


def test_unlock_swaps_in_one_transaction_closing_active_first():
    out, log, calls = _run_unlock({"confirm": " 2/2568 "})
    kinds = [q.split()[0] for q, _ in log if not q.startswith("CREATE")]
    assert kinds == ["UPDATE", "UPDATE", "COMMIT"], kinds
    close, activate = [(q, p) for q, p in log if q.startswith("UPDATE")]
    assert "status = 'closed'" in close[0] and close[1][1] == 2 and close[1][2] == 5, "ปิด active ในฐานข้อมูล พร้อมเก็บข้อมูลล่าสุด"
    assert "status = 'active'" in activate[0] and activate[1] == (3,)
    assert calls[0] == ("flush", True) and ("save", None) in calls
    assert calls.index(("flush", True)) < calls.index(("save", None))
    assert out["active"] == CLOSED3 and out["closed"] == {"id": 5}
    assert mock_api.SLOTS == [{"id": 77}]
    assert mock_api.CURRENT_TERM == {"id": 3, "year": 2568, "semester": 2,
                                     "label": "2/2568", "status": "active"}, "จากแถว ไม่ใช่จากไฟล์ (id ในไฟล์เป็น None)"
    assert LOGGED == [(5, "close", "ปิดเทอม 1/2569 (2 คาบ)"), (3, "unlock", "ปลดล็อกเทอม 2/2568")]


def test_unlock_closing_blob_carries_the_old_lessons_and_says_closed():
    out, log, calls = _run_unlock({"confirm": "2/2568"})
    upd = [p for q, p in log if q.startswith("UPDATE") and "status = 'closed'" in q][0]
    snap = mock_api._unpack(upd[0])
    assert snap["slots"] == [{"id": 1}, {"id": 2}] and snap["current_term"]["status"] == "closed"


def test_unlock_decides_from_the_database_not_from_current_term():
    mock_api.CURRENT_TERM.update(BLANK)       # backup restore blanked it
    blob = _unlock_setup()
    mock_api.CURRENT_TERM.update(BLANK)
    out, log, calls = _run_unlock({"confirm": "2/2568"}, active={"id": 41, "label": "x"}, blob=blob)
    close = [p for q, p in log if q.startswith("UPDATE") and "status = 'closed'" in q][0]
    assert close[2] == 41 and out["closed"] == {"id": 41}


def test_unlock_with_no_active_row_only_activates():
    blob = _unlock_setup()
    saved = None

    def run(log, calls):
        mock_api._term_row = lambda i: CLOSED3 if i == 3 else {"id": i}
        mock_api._term_blob = lambda i: blob
        out = mock_api.unlock_term(3, {"confirm": "2/2568"})
        kinds = [q.split()[0] for q, _ in log if not q.startswith("CREATE")]
        assert kinds == ["UPDATE", "COMMIT"] and out["closed"] is None
    saved = mock_api._term_blob
    try:
        _with_fake_db(run, active=None)
    finally:
        mock_api._term_blob = saved


def test_unlock_refusals_change_nothing():
    for body, row, code in (({"confirm": "2/2569"}, CLOSED3, 400),
                            ({"confirm": 5}, CLOSED3, 400),
                            ({}, CLOSED3, 400),
                            ({"confirm": "1/2569"}, {**CLOSED3, "status": "active", "label": "1/2569"}, 409)):
        out, log, calls = _run_unlock(body, row=row)
        assert isinstance(out, mock_api.HTTPException) and out.status_code == code, (body, out)
        assert not log and not calls, "ยังไม่แตะฐานข้อมูลหรือคิวบันทึก"
        assert mock_api.SLOTS == [{"id": 1}, {"id": 2}] and mock_api.CURRENT_TERM["id"] == 5


def test_unlock_404_for_unknown_term():
    saved = {k: getattr(mock_api, k) for k in ("_term_row", "_STORE_KIND")}
    mock_api._STORE_KIND = "postgres"
    mock_api._term_row = lambda i: None
    try:
        exc = _http(mock_api.unlock_term, 9, {"confirm": "x"})
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)
    assert exc and exc.status_code == 404


def test_unlock_needs_database_and_refuses_while_writes_blocked():
    mock_api._STORE_KIND = "file"
    exc = _http(mock_api.unlock_term, 3, {"confirm": "x"})
    assert exc and exc.status_code == 400

    def run(log, calls):
        mock_api._DB_HAD_DATA, mock_api._STATE_SOURCE = True, "seed"
        mock_api._term_row = lambda i: CLOSED3
        exc = _http(mock_api.unlock_term, 3, {"confirm": "2/2568"})
        assert exc and exc.status_code == 409 and not log
        assert mock_api.SLOTS == [{"id": 1}, {"id": 2}]
    _unlock_setup()
    _with_fake_db(run, active={"id": 5})


def test_unlock_database_failure_restores_memory_and_hides_secret():
    out, log, calls = _run_unlock({"confirm": "2/2568"}, fail_on="UPDATE app_terms SET status = 'active'")
    assert isinstance(out, mock_api.HTTPException) and out.status_code == 500
    assert "SECRET" not in out.detail and "postgresql" not in out.detail
    assert "COMMIT" not in [q for q, _ in log], "ไม่ commit"
    assert mock_api.SLOTS == [{"id": 1}, {"id": 2}]
    assert mock_api.CURRENT_TERM == {"id": 5, "year": 2569, "semester": 1,
                                     "label": "1/2569", "status": "active"}
    assert not LOGGED and ("save", None) not in calls


def test_unlock_row_vanishing_aborts_without_commit():
    def extra(log, calls):
        class C(_FakeCur):
            pass
    saved = _FakeCur.__init__

    def init(self, log, rows):
        saved(self, log, rows)
        self.rowcount = 0
    _FakeCur.__init__ = init
    try:
        out, log, calls = _run_unlock({"confirm": "2/2568"})
    finally:
        _FakeCur.__init__ = saved
    assert out.status_code == 500 and "COMMIT" not in [q for q, _ in log]
    assert mock_api.SLOTS == [{"id": 1}, {"id": 2}] and mock_api.CURRENT_TERM["id"] == 5


def test_unlock_corrupt_blob_is_500_before_anything_changes():
    _unlock_setup()
    out, log, calls = _run_unlock({"confirm": "2/2568"}, blob=b"not gzip")
    assert out.status_code == 500 and not log
    assert mock_api.SLOTS == [{"id": 1}, {"id": 2}]


def test_create_term_writes_close_and_create_log_rows():
    mock_api.CURRENT_TERM.update({"id": 5, "year": 2569, "semester": 1,
                                  "label": "1/2569", "status": "active"})
    mock_api.SLOTS[:] = [{"id": 1}]

    def run(log, calls):
        mock_api.create_term({"year": 2569, "semester": 2})
        assert LOGGED == [(5, "close", "ปิดเทอม 5 (1 คาบ)"), (99, "create", "สร้างเทอม 2/2569")]
    _with_fake_db(run, active={"id": 5})


def test_term_log_schema_and_insert_columns():
    s = mock_api._TERM_LOG_SCHEMA
    for col in ("app_term_log", "id      bigserial", "term_id bigint", "action  text",
                "detail  text", "at      timestamptz NOT NULL DEFAULT now()"):
        assert col in s, col
    log: list = []
    saved = mock_api._db_connect
    mock_api._db_connect = lambda: _FakeConn(log)
    try:
        mock_api._term_log(3, "unlock", "ปลดล็อกเทอม 2/2568")
    finally:
        mock_api._db_connect = saved
    ins = [(q, p) for q, p in log if q.startswith("INSERT INTO app_term_log")]
    assert ins and ins[0][1] == (3, "unlock", "ปลดล็อกเทอม 2/2568") and ("COMMIT", None) in log


def test_term_log_never_raises_and_a_broken_log_cannot_stop_create_term():
    saved = mock_api._db_connect
    mock_api._db_connect = lambda: (_ for _ in ()).throw(RuntimeError("postgresql://u:SECRET@h/d"))
    try:
        assert mock_api._term_log(1, "create", "x") is None
    finally:
        mock_api._db_connect = saved
    # the real _term_log, with only the log table broken, inside a real create_term
    mock_api.CURRENT_TERM.update(BLANK)
    mock_api.SLOTS[:] = []

    def run(log, calls):
        mock_api._term_log = _REAL_TERM_LOG
        out = mock_api.create_term({"year": 2570, "semester": 1})
        assert out["active"] == {"id": 99} and mock_api.CURRENT_TERM["id"] == 99
    _REAL_TERM_LOG = mock_api._term_log
    _with_fake_db(run, fail_on="app_term_log", existing=[])


def test_terms_log_endpoint_newest_first_and_degrades():
    mock_api._STORE_KIND = "file"
    assert mock_api.terms_log()["available"] is False
    import datetime as dt
    rows = [(2, 3, "unlock", "d2", dt.datetime(2026, 11, 6)), (1, 3, "create", "d1", None)]

    class Cur(_FakeCur):
        def fetchall(self):
            return rows
    class Conn(_FakeConn):
        def cursor(self):
            return Cur(self.log, None)
    log: list = []
    saved = mock_api._db_connect
    mock_api._STORE_KIND = "postgres"
    mock_api._db_connect = lambda: Conn(log)
    try:
        out = mock_api.terms_log()
    finally:
        mock_api._db_connect = saved
        mock_api._STORE_KIND = "file"
    assert out["available"] and [r["id"] for r in out["log"]] == [2, 1]
    assert any("ORDER BY at DESC" in q for q, _ in log)

    def boom():
        raise RuntimeError("SECRET")
    mock_api._STORE_KIND = "postgres"
    mock_api._db_connect = boom
    try:
        out = mock_api.terms_log()
    finally:
        mock_api._db_connect = saved
        mock_api._STORE_KIND = "file"
    assert out["available"] is False and "SECRET" not in str(out)


def test_terms_routes_do_not_shadow_each_other_and_stay_write_safe():
    paths = {(r[0].upper(), r[1]) for r in mock_api.app.routes}
    for want in (("GET", "/api/terms/log"), ("GET", "/api/terms/{term_id}/data"),
                 ("POST", "/api/terms/{term_id}/unlock")):
        assert want in paths, want
    assert mock_api.term_blocks_write({"status": "closed", "label": "2/2568"}, "POST",
                                      "/api/terms/3/unlock") is None


# ── งานที่ 6: สถิติย้อนหลัง ─────────────────────────────────────────────────
def test_stats_counts_periods_per_teacher_and_department():
    snap = {
        "departments": [{"id": 1, "name": "ภาษาไทย"}, {"id": 2, "name": "คณิตศาสตร์"}],
        "teachers": [{"id": 10, "department_id": 1}, {"id": 11, "department_id": 2}],
        "rooms": [{"id": 1}, {"id": 2}, {"id": 3}],
        "subjects": [{"id": 100}, {"id": 101}],
        "slots": [
            {"id": 1, "teacher_id": 10, "room_id": 1, "subject_id": 100},
            {"id": 2, "teacher_id": 10, "room_id": 1, "subject_id": 100},
            {"id": 3, "teacher_id": 11, "room_id": 2, "subject_id": 101},
        ],
    }
    out = mock_api.term_stats_of(snap)
    assert out["slots"] == 3
    assert out["by_teacher"][10] == 2
    assert out["by_department"]["ภาษาไทย"] == 2
    assert out["by_department"]["คณิตศาสตร์"] == 1
    assert out["rooms_used"] == 2        # ห้อง 3 ไม่ถูกใช้
    assert out["subjects_open"] == 2


def test_stats_of_an_empty_or_partial_snapshot():
    assert mock_api.term_stats_of({})["slots"] == 0
    assert mock_api.term_stats_of({"slots": [{"id": 1}]})["slots"] == 1


def test_stats_shape_and_missing_keys_everywhere():
    out = mock_api.term_stats_of({})
    assert out == {"slots": 0, "by_department": {}, "by_teacher": {},
                   "rooms_used": 0, "subjects_open": 0}
    for bad in (None, [], "x"):
        assert mock_api.term_stats_of(bad)["slots"] == 0
    # คีย์เป็น None / รายการมีของแปลก ๆ
    out = mock_api.term_stats_of({"slots": [None, "x", {"teacher_id": 0}], "teachers": None,
                                  "departments": None, "subjects": [None]})
    assert out["slots"] == 1 and out["by_teacher"] == {}
    assert out["by_department"] == {"ไม่ระบุ": 1}


def test_stats_department_prefers_subject_then_teacher():
    snap = {"departments": [{"id": 1, "name": "A"}, {"id": 2, "name": "B"}],
            "teachers": [{"id": 10, "department_id": 1}],
            "subjects": [{"id": 5, "department_id": 2}, {"id": 6}],
            "slots": [{"teacher_id": 10, "subject_id": 5},
                      {"teacher_id": 10, "subject_id": 6}]}
    assert mock_api.term_stats_of(snap)["by_department"] == {"B": 1, "A": 1}


def test_stats_counts_every_teacher_and_room_a_period_names():
    snap = {"slots": [
        {"teacher_id": 1, "co_teacher_id": 2, "room_id": 7, "subject_id": 50},
        {"teacher_id": 0, "activity_teacher_ids": [3, 4], "room_id": 8, "subject_id": 51},
        {"teacher_id": 0, "is_elective": True, "room_id": None,
         "elective_options": [{"teacher_id": 5, "room_id": 9, "subject_id": 52},
                              {"teacher_id": 6, "room_id": 10, "subject_id": 53}]}]}
    out = mock_api.term_stats_of(snap)
    assert out["by_teacher"] == {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1}
    assert out["rooms_used"] == 4 and out["subjects_open"] == 4


def test_stats_is_pure():
    snap = {"slots": [{"teacher_id": 1, "room_id": 2}]}
    import copy
    before = copy.deepcopy(snap)
    saved = mock_api._STORE_KIND
    mock_api._STORE_KIND = "boom"      # ไม่แตะตัวแปรกลางหรือฐานข้อมูล
    try:
        mock_api.term_stats_of(snap)
    finally:
        mock_api._STORE_KIND = saved
    assert snap == before


def _stats_with_fake(terms, snapshot_live=None, unreadable=()):
    names = ("_STORE_KIND", "_terms_list", "_term_blob", "_snapshot")
    saved = {k: getattr(mock_api, k) for k in names}
    mock_api._STORE_KIND = "postgres"
    mock_api._terms_list = lambda: [
        {"id": i, "year": y, "semester": sm, "label": f"{sm}/{y}", "status": st}
        for i, y, sm, st, _ in terms]
    blobs = {i: b for i, _, _, _, b in terms}
    def blob(i):
        if i in unreadable:
            raise RuntimeError("SECRET")
        return blobs[i]
    mock_api._term_blob = blob
    mock_api._snapshot = lambda: snapshot_live or {}
    try:
        return mock_api.terms_stats()
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)


def test_terms_stats_endpoint_oldest_first_and_active_from_memory():
    pk = mock_api._pack
    out = _stats_with_fake(
        [(3, 2569, 1, "active", pk({"slots": [{"id": 1}]})),
         (2, 2568, 2, "closed", pk({"slots": [{"id": 1}, {"id": 2}]})),
         (1, 2568, 1, "closed", pk({"slots": []}))],
        snapshot_live={"slots": [{"id": 1}, {"id": 2}, {"id": 3}]})
    got = [(t["id"], t["label"], t["slots"]) for t in out["terms"]]
    assert got == [(1, "1/2568", 0), (2, "2/2568", 2), (3, "1/2569", 3)], got
    for t in out["terms"]:
        assert {"by_department", "by_teacher", "rooms_used", "subjects_open"} <= set(t)


def test_terms_stats_endpoint_survives_a_corrupt_term():
    pk = mock_api._pack
    out = _stats_with_fake(
        [(1, 2568, 1, "closed", b"junk"),
         (2, 2568, 2, "closed", pk({"slots": [{"id": 1}]})),
         (3, 2569, 1, "closed", pk({"slots": []}))], unreadable={3})
    by = {t["id"]: t for t in out["terms"]}
    ok("error" in by[1] and by[1]["slots"] == 0, "ไฟล์เสียขึ้น error")
    ok(by[2]["slots"] == 1 and "error" not in by[2], "เทอมดียังคิดได้")
    ok("error" in by[3] and "SECRET" not in str(out), "อ่านฐานพลาด ไม่รั่วข้อความ")


def test_terms_stats_endpoint_refuses_without_database_and_db_failure():
    mock_api._STORE_KIND = "file"
    try:
        mock_api.terms_stats()
        assert False
    except mock_api.HTTPException as e:
        assert e.status_code == 400 and "ยังไม่ได้ต่อฐานข้อมูล" in e.detail
    saved = (mock_api._STORE_KIND, mock_api._terms_list)
    def boom():
        raise RuntimeError("postgres://u:SECRET@h/db")
    mock_api._STORE_KIND, mock_api._terms_list = "postgres", boom
    try:
        mock_api.terms_stats()
        assert False
    except mock_api.HTTPException as e:
        ok(e.status_code == 503 and "SECRET" not in e.detail, "503 ภาษาไทย ไม่รั่วสตริงเชื่อมต่อ")
    finally:
        mock_api._STORE_KIND, mock_api._terms_list = saved


def test_terms_stats_route_registered_and_write_safe():
    paths = {(r[0].upper(), r[1]) for r in mock_api.app.routes}
    assert ("GET", "/api/terms/stats") in paths


for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        fn()

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
