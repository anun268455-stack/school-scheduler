"""
เว็บลงอัตรากำลัง ขั้นที่ 1 งานที่ 2: รหัสเข้าแบบแฮช · session ในตาราง · route รหัสของ admin

ฟังก์ชันล้วนเรียกตรง ๆ · ส่วนที่แตะฐานข้อมูลใช้ cursor ปลอมเล็ก ๆ (ของจริงลองกับ Postgres แยก)
แฮช PBKDF2 หนึ่งครั้งราว 0.1 วินาที จึงไม่มีตัวทดสอบที่แฮชเป็นร้อยครั้ง
"""
import datetime as dt
import sys
from types import SimpleNamespace

from fastapi import HTTPException

import mock_api

fails: list[str] = []
SALT = b"0123456789abcdef"


def _past():
    return dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)


def _future():
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)


def test_hash_round_trip_and_wrong_code():
    row = {"id": 1, "role": "admin", "salt": SALT,
           "hash": mock_api.wl_hash("ครูใหญ่2569", SALT), "active": True}
    assert mock_api.wl_check_code("ครูใหญ่2569", [row]) is row
    assert mock_api.wl_check_code("ครูใหญ่2568", [row]) is None


def test_blank_code_never_matches():
    # แม้มีแถวที่แฮชของค่าว่างอยู่จริง ก็ต้องไม่ผ่าน (Review Focus ข้อ 2)
    row = {"id": 1, "role": "admin", "salt": SALT,
           "hash": mock_api.wl_hash("", SALT), "active": True}
    for blank in ("", "   ", "\t", "\n"):
        assert mock_api.wl_check_code(blank, [row]) is None


def test_surrounding_space_trimmed_but_case_kept():
    # Review Focus ข้อ 5
    row = {"id": 1, "role": "head", "salt": SALT,
           "hash": mock_api.wl_hash("Thai01", SALT), "active": True}
    assert mock_api.wl_check_code("  Thai01 ", [row]) is row
    assert mock_api.wl_check_code("thai01", [row]) is None


def test_disabled_code_rejected():
    row = {"id": 1, "role": "head", "salt": SALT,
           "hash": mock_api.wl_hash("x", SALT), "active": False}
    assert mock_api.wl_check_code("x", [row]) is None


def test_bytes_from_driver_are_accepted():
    # psycopg คืน bytea เป็น bytes (หรือ memoryview ในบางโหมด) — ต้องเทียบได้
    row = {"id": 1, "role": "head", "salt": memoryview(SALT),
           "hash": memoryview(mock_api.wl_hash("abcdef", SALT)), "active": True}
    assert mock_api.wl_check_code("abcdef", [row]) is row


def test_two_tokens_from_one_code_both_valid():
    # Review Focus ข้อ 4 — หนึ่งกลุ่มสาระมีรหัสเดียว ใช้พร้อมกันเป็นเรื่องปกติ
    rows = []
    a = mock_api.wl_session_open(code_id=5, rows=rows)
    b = mock_api.wl_session_open(code_id=5, rows=rows)
    assert a != b
    assert len(rows) == 2
    assert mock_api.wl_session_find(a, rows) is not None
    assert mock_api.wl_session_find(b, rows) is not None


def test_expired_session_is_not_found():
    # ตัวเทียบ: แถวเดียวกันที่ยังไม่หมดอายุต้องเจอ จึงพิสูจน์ว่าไม่เจอเพราะหมดอายุจริง
    h = mock_api.wl_token_hash("tok")
    old = [{"token_hash": h, "code_id": 5, "expires_at": _past()}]
    new = [{"token_hash": h, "code_id": 5, "expires_at": _future()}]
    assert mock_api.wl_session_find("tok", old) is None
    assert mock_api.wl_session_find("tok", new) is new[0]
    assert mock_api.wl_session_find("", new) is None


def test_session_rows_hold_no_plaintext_token():
    rows = []
    tok = mock_api.wl_session_open(code_id=5, rows=rows)
    assert tok not in repr(rows)
    assert rows[0]["token_hash"] == mock_api.wl_token_hash(tok)
    assert rows[0]["expires_at"].tzinfo is not None


def test_bearer_token():
    f = mock_api.wl_bearer_token
    assert f("Bearer abc123") == "abc123"
    assert f("bearer abc123") == "abc123"
    assert f("BEARER   abc123 ") == "abc123"
    assert f(None) == ""
    assert f("") == ""
    assert f("abc123") == ""
    assert f("Basic abc123") == ""
    assert f("Bearer") == ""
    assert f("Bearer   ") == ""


def test_setup_allowed():
    f = mock_api.wl_setup_allowed
    assert f(None, "") is False
    assert f("", "") is False
    assert f("   ", "   ") is False
    assert f(None, "x") is False
    assert f("secret-1", "wrong") is False
    assert f("secret-1", "") is False
    assert f("secret-1", None) is False
    assert f("secret-1", 123) is False
    assert f("secret-1", "secret-1") is True
    assert f(" secret-1 ", "  secret-1\n") is True


def test_code_taken_counts_disabled_rows():
    rows = [{"salt": SALT, "hash": mock_api.wl_hash("abcdef", SALT), "active": False}]
    assert mock_api.wl_code_taken("abcdef", rows) is True
    assert mock_api.wl_code_taken("  abcdef ", rows) is True
    assert mock_api.wl_code_taken("abcdeg", rows) is False
    assert mock_api.wl_code_taken("abcdef", []) is False


class _Cur:
    """cursor ปลอม: คืนแถวที่กำหนดให้เมื่ออ่าน"""
    def __init__(self, rows): self.rows = rows
    def execute(self, sql, params=None): self.sql = sql; self.params = params
    def fetchall(self): return self.rows
    def fetchone(self): return self.rows[0] if self.rows else None


def _req(tok):
    return SimpleNamespace(headers={"authorization": f"Bearer {tok}"} if tok else {})


def _code(fn):
    try:
        fn()
    except HTTPException as e:
        return e.status_code, e.detail
    return None, None


def test_require_session_and_admin():
    h = mock_api.wl_token_hash("tok")
    head = (h, 7, "head", 2, "คณิต", _future())
    cur = _Cur([head])
    s, d = _code(lambda: mock_api.wl_require_admin(_req("tok"), cur))
    assert s == 403 and not d.isascii()
    s, d = _code(lambda: mock_api.wl_require_admin(_req(None), _Cur([])))
    assert s == 401 and not d.isascii()
    s, _ = _code(lambda: mock_api.wl_require_session(_req("tok"), _Cur([])))
    assert s == 401
    s, _ = _code(lambda: mock_api.wl_require_session(_req("tok"),
                                                      _Cur([(h, 7, "head", 2, "x", _past())])))
    assert s == 401
    adm = mock_api.wl_require_admin(_req("tok"), _Cur([(h, 1, "admin", None, "ผู้ดูแลระบบ", _future())]))
    assert adm["role"] == "admin" and adm["code_id"] == 1


def test_min_length_and_roles_validated():
    f = mock_api.wl_validate_new_code
    s, d = _code(lambda: f("12345"))
    assert s == 400 and not d.isascii()
    s, _ = _code(lambda: f("   12345   "))
    assert s == 400
    assert f("  123456 ") == "123456"
    s, _ = _code(lambda: f(123456))
    assert s == 400
    g = mock_api.wl_validate_role_dept
    g("admin", None); g("head", 3)
    for role, dept in (("admin", 1), ("head", None), ("head", 99), ("head", True),
                       ("head", "1"), ("boss", None)):
        s, _ = _code(lambda: g(role, dept))
        assert s == 400, (role, dept)


def test_throttled_pure():
    f = mock_api.wl_throttled
    assert f([], 100.0, 3, 60.0) is False
    assert f([90.0, 95.0], 100.0, 3, 60.0) is False
    assert f([90.0, 95.0, 99.0], 100.0, 3, 60.0) is True
    # นอกหน้าต่างไม่นับ
    assert f([10.0, 20.0, 30.0], 100.0, 3, 60.0) is False
    assert f([10.0, 20.0, 99.0, 98.0], 100.0, 3, 60.0) is False


def test_setup_env_strength():
    f = mock_api.wl_setup_env_strong
    assert f(None) is False and f("") is False and f("short") is False
    assert f("   12345678901   ") is False
    assert f("123456789012") is True


def test_lone_surrogate_is_wrong_not_crash():
    bad = "\ud800abcdef"
    row = {"id": 1, "role": "admin", "salt": SALT,
           "hash": mock_api.wl_hash("abcdef", SALT), "active": True}
    assert mock_api.wl_check_code(bad, [row]) is None
    assert mock_api.wl_code_taken(bad, [row]) is False
    assert mock_api.wl_setup_allowed("secret-secret-1", bad) is False
    assert mock_api.wl_setup_allowed(bad, "secret-secret-1") is False
    s, d = _code(lambda: mock_api.wl_validate_new_code(bad))
    assert s == 400 and not d.isascii()


def _with_fails(login=(), fn=None):
    saved = {k: list(v) for k, v in mock_api._WL_FAILS.items()}
    saved_check = mock_api.wl_check_code
    try:
        mock_api._WL_FAILS["login"][:] = list(login)
        mock_api._WL_FAILS["setup"][:] = []
        return fn()
    finally:
        mock_api.wl_check_code = saved_check
        for k, v in saved.items():
            mock_api._WL_FAILS[k][:] = v


def test_login_429_before_any_hashing():
    import time
    calls = []

    def run():
        mock_api.wl_check_code = lambda *a, **k: calls.append(1)
        return _code(lambda: mock_api.wl_login({"code": "abcdef"})), _code(
            lambda: mock_api.wl_login([1, 2]))
    (a, b) = _with_fails([time.monotonic()] * mock_api.WL_LOGIN_FAIL_LIMIT, run)
    assert a[0] == 429 and b[0] == 429 and not a[1].isascii()
    assert calls == []


def test_login_bad_body_is_401_and_records_failure():
    def run():
        r = [_code(lambda: mock_api.wl_login(x)) for x in (None, [1, 2], "x", {"code": 5})]
        return r, len(mock_api._WL_FAILS["login"])
    r, n = _with_fails((), run)
    assert all(c == 401 and d == mock_api.WL_BAD_CODE for c, d in r) and n == 4


def test_setup_bad_body_and_short_env_and_throttle():
    import os, time
    saved = os.environ.get("WORKLOAD_SETUP_CODE")

    def run():
        os.environ["WORKLOAD_SETUP_CODE"] = "long-enough-secret"
        a = _code(lambda: mock_api.wl_setup(None))
        b = _code(lambda: mock_api.wl_setup({"setup_code": "wrong", "code": "abcdef"}))
        n = len(mock_api._WL_FAILS["setup"])
        os.environ["WORKLOAD_SETUP_CODE"] = "short"
        c = _code(lambda: mock_api.wl_setup({"setup_code": "short", "code": "abcdef"}))
        mock_api._WL_FAILS["setup"][:] = [time.monotonic()] * mock_api.WL_SETUP_FAIL_LIMIT
        d = _code(lambda: mock_api.wl_setup({"setup_code": "x", "code": "abcdef"}))
        return a, b, n, c, d
    try:
        a, b, n, c, d = _with_fails((), run)
    finally:
        if saved is None:
            os.environ.pop("WORKLOAD_SETUP_CODE", None)
        else:
            os.environ["WORKLOAD_SETUP_CODE"] = saved
    assert a[0] == 400 and b[0] == 403 and n == 1
    assert c[0] == 403 and "12" in c[1]
    assert d[0] == 429


def test_login_burst_is_bounded():
    import contextlib
    import threading
    import time
    lock = threading.Lock()
    st = {"hashes": 0, "open": 0, "max_open": 0}
    outcomes: list = []

    def slow_check(raw, rows):
        with lock:
            st["hashes"] += 1
        time.sleep(0.02)
        return None

    @contextlib.contextmanager
    def fake_db():
        with lock:
            st["open"] += 1
            st["max_open"] = max(st["max_open"], st["open"])
        try:
            yield object()
        finally:
            with lock:
                st["open"] -= 1

    def one():
        try:
            mock_api.wl_login({"code": "wrong-code"})
            outcomes.append("ok")
        except HTTPException as e:
            outcomes.append(e.status_code)
        except Exception as e:  # noqa: BLE001
            outcomes.append(type(e).__name__)

    def run():
        mock_api.wl_check_code = slow_check
        mock_api._wl_db = fake_db
        mock_api._wl_code_rows = lambda cur: []
        ts = [threading.Thread(target=one) for _ in range(40)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()

    saved = {k: getattr(mock_api, k) for k in ("_wl_db", "_wl_code_rows")}
    try:
        _with_fails((), run)
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)
    assert len(outcomes) == 40, outcomes
    assert st["hashes"] <= mock_api.WL_LOGIN_FAIL_LIMIT, st
    assert all(o in (401, 429) for o in outcomes), outcomes
    assert outcomes.count(401) == st["hashes"], (outcomes.count(401), st)
    assert outcomes.count(429) == 40 - st["hashes"]
    assert st["max_open"] <= 1, st


def test_login_inflight_ceiling_gives_distinct_429_without_recording():
    import threading
    saved = mock_api._WL_LOGIN_INFLIGHT
    full = threading.BoundedSemaphore(1)
    full.acquire()
    mock_api._WL_LOGIN_INFLIGHT = full

    def run():
        r = _code(lambda: mock_api.wl_login({"code": "abcdef"}))
        return r, len(mock_api._WL_FAILS["login"])
    try:
        (c, d), n = _with_fails((), run)
    finally:
        mock_api._WL_LOGIN_INFLIGHT = saved
    assert c == 429 and n == 0
    assert "พร้อมกัน" in d and "ผิดบ่อย" not in d


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
