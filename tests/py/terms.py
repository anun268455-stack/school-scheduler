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


def _with_fake_db(fn, fail_on=None, existing=(), active=_FROM_MEMORY):
    saved = {k: getattr(mock_api, k) for k in
             ("_db_connect", "_term_active", "_terms_list", "_term_row", "_flush_pending", "_save_state",
              "_STORE_KIND", "_DB_HAD_DATA", "_STATE_SOURCE")}
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
    mock_api._STORE_KIND = "postgres"
    mock_api._DB_HAD_DATA, mock_api._STATE_SOURCE = False, "snapshot"
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


for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        fn()

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
