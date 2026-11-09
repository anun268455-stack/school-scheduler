"""
เว็บลงอัตรากำลัง ขั้นที่ 1: /api/workload/ ต้องไม่ขยับตัวนับรุ่น ไม่ถูกด่านเทอมปิดกัน
และต่อฐานข้อมูลไม่ได้ต้องตอบ 503 ภาษาไทย

เรียกฟังก์ชันล้วนตรง ๆ และเรียก middleware _bump_revision ด้วยคำขอปลอม
(แบบเดียวกับ termguard.py) เพื่อพิสูจน์ว่า middleware เรียกมันจริง
"""
import asyncio
import contextlib
import sys
from types import SimpleNamespace

from fastapi import HTTPException

import mock_api

fails: list[str] = []


def ok(cond: object, what: str) -> None:
    if not cond:
        fails.append(what)


CLOSED = {"id": 3, "year": 2568, "semester": 2, "label": "2/2568", "status": "closed"}
ACTIVE = {"id": 4, "year": 2569, "semester": 1, "label": "1/2569", "status": "active"}


def test_workload_paths_skip_the_revision_bump():
    assert mock_api.skip_revision_bump("POST", "/api/workload/teachers") is True
    assert mock_api.skip_revision_bump("PUT", "/api/workload/subjects/7") is True
    # การอ่านไม่เคยบวกตัวนับอยู่แล้ว
    assert mock_api.skip_revision_bump("GET", "/api/workload/teachers") is True


def test_scheduler_writes_still_bump():
    assert mock_api.skip_revision_bump("POST", "/api/teachers/") is False
    assert mock_api.skip_revision_bump("DELETE", "/api/slots/9") is False
    # path ที่ขึ้นต้นคล้ายกันแต่ไม่ใช่ของเว็บใหม่ ต้องไม่หลุด
    assert mock_api.skip_revision_bump("POST", "/api/workloadsheet") is False


def test_workload_writes_allowed_while_the_term_is_closed():
    closed = {"status": "closed", "label": "1/2569"}
    assert mock_api.term_blocks_write(closed, "POST", "/api/workload/teachers") is None
    # แต่เว็บตารางยังถูกห้ามเหมือนเดิม
    assert mock_api.term_blocks_write(closed, "POST", "/api/slots/") is not None


def test_db_unreachable_says_so_in_thai():
    # Review Focus ข้อ 3 — ต้องเป็นข้อความไทยที่คนอ่านรู้เรื่อง ไม่ใช่ 500 เปล่า
    msg = mock_api.wl_db_error_detail()
    assert "ฐานข้อมูล" in msg
    assert msg.strip() and not msg.isascii()


# ── ผ่าน middleware จริง ────────────────────────────────────────────────
def _run(term, method, path):
    """คืน (response, handler กี่ครั้ง, เซฟกี่ครั้ง, REVISION ขยับเท่าไร)"""
    calls = {"handler": 0, "save": 0}

    async def call_next(_req):
        calls["handler"] += 1
        return SimpleNamespace(status_code=200)

    saved_term = dict(mock_api.CURRENT_TERM)
    saved_save = mock_api._save_state
    saved_rev = mock_api.REVISION["n"]
    mock_api.CURRENT_TERM.update(term)
    mock_api._save_state = lambda *a, **k: calls.__setitem__("save", calls["save"] + 1)
    try:
        req = SimpleNamespace(method=method, url=SimpleNamespace(path=path))
        resp = asyncio.run(mock_api._bump_revision(req, call_next))
        delta = mock_api.REVISION["n"] - saved_rev
    finally:
        mock_api.CURRENT_TERM.update(saved_term)
        mock_api._save_state = saved_save
        mock_api.REVISION["n"] = saved_rev
    return resp, calls, delta


def test_middleware_workload_write_leaves_revision_and_save_alone():
    resp, calls, delta = _run(ACTIVE, "POST", "/api/workload/teachers")
    ok(resp.status_code == 200 and calls["handler"] == 1, "handler ต้องถูกเรียก")
    ok(delta == 0, "REVISION ต้องไม่ขยับ")
    ok(calls["save"] == 0, "ต้องไม่เรียก _save_state")


def test_middleware_scheduler_write_still_bumps_and_saves():
    resp, calls, delta = _run(ACTIVE, "POST", "/api/teachers/")
    ok(resp.status_code == 200 and calls["handler"] == 1, "handler ต้องถูกเรียก")
    ok(delta == 1, "REVISION ต้องเพิ่มหนึ่ง")
    ok(calls["save"] == 1, "ต้องเรียก _save_state หนึ่งครั้ง")


def test_middleware_workload_write_reaches_handler_while_closed():
    resp, calls, delta = _run(CLOSED, "POST", "/api/workload/teachers")
    ok(resp.status_code == 200 and calls["handler"] == 1, "ต้องไม่ถูกตอบ 409")
    ok(delta == 0 and calls["save"] == 0, "เทอมปิดก็ต้องไม่ขยับรุ่นหรือเซฟ")


# ── _wl_db() และ health ─────────────────────────────────────────────────
@contextlib.contextmanager
def patched(**kw):
    saved = {k: getattr(mock_api, k) for k in kw}
    for k, v in kw.items():
        setattr(mock_api, k, v)
    try:
        yield
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)


def _enter_wl_db():
    with mock_api._wl_db() as cur:
        return cur


def _expect_503(fn, what):
    try:
        fn()
    except HTTPException as e:
        ok(e.status_code == 503, f"{what}: ต้อง 503 ได้ {e.status_code}")
        ok(e.detail == mock_api.wl_db_error_detail() and not str(e.detail).isascii(),
           f"{what}: ข้อความไทย")
        return
    except Exception as e:  # noqa: BLE001
        fails.append(f"{what}: ได้ {type(e).__name__} แทน HTTPException")
        return
    fails.append(f"{what}: ไม่ยกอะไรเลย")


def test_wl_db_503_when_store_is_not_postgres():
    with patched(_STORE_KIND="file"):
        _expect_503(_enter_wl_db, "ไม่ใช่ postgres")


def test_wl_db_503_when_connect_fails():
    def boom():
        raise RuntimeError("SECRET-db-url")
    with patched(_STORE_KIND="postgres", _db_connect=boom):
        _expect_503(_enter_wl_db, "ต่อไม่ได้")


def test_health_503_without_db():
    with patched(_STORE_KIND="file"):
        _expect_503(mock_api.wl_health, "health")


# ตัวปลอมของ psycopg: บันทึกว่า commit/execute อะไร
class _Cur:
    def __init__(self, log): self.log = log
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, *a): self.log.append("execute")


class _Conn:
    def __init__(self, log): self.log = log
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def cursor(self): return _Cur(self.log)
    def commit(self): self.log.append("commit")


def test_wl_db_commits_on_clean_exit_and_not_on_error():
    log: list[str] = []
    with patched(_STORE_KIND="postgres", _db_connect=lambda: _Conn(log)):
        with mock_api._wl_db():
            pass
        ok("commit" in log and "execute" in log, "บล็อกจบปกติต้อง commit และสร้างตาราง")
        log.clear()
        try:
            with mock_api._wl_db():
                raise HTTPException(409, "ซ้ำ")
        except HTTPException as e:
            ok(e.status_code == 409 and e.detail == "ซ้ำ", "HTTPException ในบล็อกต้องผ่านตามเดิม")
        else:
            fails.append("HTTPException ในบล็อกหายไป")
        ok("commit" not in log, "บล็อกยกข้อผิดพลาดต้องไม่ commit")
        log.clear()
        try:
            with mock_api._wl_db():
                raise ValueError("x")
        except ValueError:
            pass
        ok("commit" not in log, "ข้อผิดพลาดอื่นต้องไม่ commit")


def test_schema_has_four_tables_and_one_per_group_indexes():
    s = mock_api._WL_SCHEMA
    for t in ("wl_codes", "wl_sessions", "wl_teachers", "wl_subjects"):
        ok(f"CREATE TABLE IF NOT EXISTS {t}" in s, f"ตาราง {t}")
    ok("wl_codes_one_admin" in s and "wl_codes_one_per_dept" in s, "ดัชนีหนึ่งกลุ่มหนึ่งรหัส")
    ok("CHECK (role IN ('admin','head'))" in s, "CHECK role")


for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        fn()

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
