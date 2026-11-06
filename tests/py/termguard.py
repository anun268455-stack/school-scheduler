"""
เทอม: ตัวกันเขียนของเทอมที่ปิดแล้ว (_bump_revision)

ไม่มีเซิร์ฟเวอร์จริง — เรียกฟังก์ชันล้วน term_blocks_write ตรง ๆ และเรียก
middleware ด้วยคำขอปลอม เพื่อพิสูจน์ว่าเมื่อห้าม handler ไม่ถูกเรียกเลย
"""
import asyncio
import sys
from types import SimpleNamespace

import mock_api

fails: list[str] = []


def ok(cond: object, what: str) -> None:
    if not cond:
        fails.append(what)


CLOSED = {"id": 3, "year": 2568, "semester": 2, "label": "2/2568", "status": "closed"}
ACTIVE = {"id": 4, "year": 2569, "semester": 1, "label": "1/2569", "status": "active"}
NONE_YET = {"id": None, "year": None, "semester": None, "label": None, "status": None}


def test_reads_always_allowed():
    for m in ("GET", "HEAD", "OPTIONS"):
        assert mock_api.term_blocks_write(CLOSED, m, "/api/slots/") is None


def test_closed_term_blocks_every_write_verb():
    for m in ("POST", "PUT", "PATCH", "DELETE"):
        msg = mock_api.term_blocks_write(CLOSED, m, "/api/slots/1")
        assert msg is not None
        assert "2/2568" in msg and "ปิดแล้ว" in msg


def test_active_term_allows_writes():
    assert mock_api.term_blocks_write(ACTIVE, "POST", "/api/slots/") is None


def test_no_term_yet_allows_writes():
    # โรงเรียนที่ยังไม่เคยกดสร้างเทอม ต้องใช้โปรแกรมได้เหมือนเดิมทุกอย่าง
    assert mock_api.term_blocks_write(None, "POST", "/api/slots/") is None
    assert mock_api.term_blocks_write(
        {"id": None, "label": None, "status": None}, "POST", "/api/slots/") is None
    for m in ("POST", "PUT", "PATCH", "DELETE"):
        assert mock_api.term_blocks_write(NONE_YET, m, "/api/slots/1") is None


def test_unknown_status_fails_closed():
    for bad in ("Closed", "closed ", "archived", "", "ACTIVE", "active "):
        t = dict(CLOSED, status=bad)
        for m in ("POST", "PUT", "PATCH", "DELETE"):
            ok(mock_api.term_blocks_write(t, m, "/api/slots/1") is not None,
               f"status {bad!r} {m} ต้องห้าม")
        ok(mock_api.term_blocks_write(t, "GET", "/api/slots/1") is None, f"{bad!r} อ่านได้")
        ok(mock_api.term_blocks_write(t, "POST", "/api/terms/3/unlock") is None,
           f"{bad!r} ปลดล็อกต้องผ่าน")


def test_missing_or_null_label_still_gives_thai_message():
    no_key = {"id": 3, "year": 2568, "semester": 2, "status": "closed"}
    null = dict(CLOSED, label=None)
    for t in (no_key, null, dict(CLOSED, label="")):
        msg = mock_api.term_blocks_write(t, "POST", "/api/slots/1")
        ok(msg and "ปิดแล้ว" in msg and "None" not in msg, f"ข้อความไทยเมื่อไม่มี label: {msg!r}")
    # ผ่าน middleware ต้องได้ 409 ไม่ใช่ข้อผิดพลาด
    for t in (no_key, null):
        resp, calls, _ = _run_raw(t)
        ok(resp.status_code == 409 and calls["handler"] == 0, "label หาย ต้องได้ 409")


def test_term_endpoints_stay_open_while_closed():
    # ไม่งั้นปลดล็อกไม่ได้เลย เพราะการปลดล็อกเองก็เป็น POST
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/terms") is None
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/terms/3/unlock") is None
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/restore") is None
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/state/history/9/restore") is None
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/state/adopt") is None


def test_safe_paths_do_not_leak_to_lookalikes():
    for p in ("/api/termsX", "/api/terms-old/1", "/api/restore/x", "/api/state/historyX",
              "/api/state/adopt/x", "/api/slots/api/terms"):
        ok(mock_api.term_blocks_write(CLOSED, "POST", p) is not None, f"ต้องห้าม {p}")


def test_pure_function_ignores_globals():
    saved = dict(mock_api.CURRENT_TERM)
    try:
        mock_api.CURRENT_TERM.update(CLOSED)
        assert mock_api.term_blocks_write(ACTIVE, "POST", "/api/slots/") is None
        mock_api.CURRENT_TERM.update(ACTIVE)
        assert mock_api.term_blocks_write(CLOSED, "POST", "/api/slots/") is not None
    finally:
        mock_api.CURRENT_TERM.update(saved)


# ── ผ่าน middleware จริง ────────────────────────────────────────────────
def _run(term, method, path):
    """เรียก _bump_revision ด้วยคำขอปลอม · คืน (response, handler ถูกเรียกกี่ครั้ง, เซฟกี่ครั้ง)"""
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
        rev_moved = mock_api.REVISION["n"] != saved_rev
    finally:
        mock_api.CURRENT_TERM.update(saved_term)
        mock_api._save_state = saved_save
        mock_api.REVISION["n"] = saved_rev
    return resp, calls, rev_moved


def _run_raw(term):
    """เหมือน _run แต่แทนที่ CURRENT_TERM ทั้งก้อน (ให้คีย์ที่หายหายจริง)"""
    saved = dict(mock_api.CURRENT_TERM)
    mock_api.CURRENT_TERM.clear()
    mock_api.CURRENT_TERM.update(term)
    try:
        return _run(term, "POST", "/api/slots/1")
    finally:
        mock_api.CURRENT_TERM.clear()
        mock_api.CURRENT_TERM.update(saved)


def test_middleware_never_calls_handler_when_blocked():
    # ถ้า handler ถูกเรียก ข้อมูลในหน่วยความจำถูกแก้ไปแล้วทั้งที่บอกผู้ใช้ว่าปฏิเสธ
    for m in ("POST", "PUT", "PATCH", "DELETE"):
        resp, calls, moved = _run(CLOSED, m, "/api/slots/1")
        ok(calls["handler"] == 0, f"{m}: handler ต้องไม่ถูกเรียก")
        ok(calls["save"] == 0 and not moved, f"{m}: ห้ามเซฟหรือขยับรุ่น")
        ok(resp.status_code == 409, f"{m}: ต้องตอบ 409")
        ok("2/2568" in resp.content["detail"] and "ปิดแล้ว" in resp.content["detail"],
           f"{m}: ข้อความไทยบอกเทอม")


def test_blocked_response_carries_cors_header():
    # คำตอบที่คืนก่อน call_next ไม่ผ่าน CORSMiddleware ต้องมีหัวข้อเอง
    # ไม่งั้นเบราว์เซอร์ข้ามโดเมนอ่าน 409 ไม่ได้
    resp, _, _ = _run(CLOSED, "POST", "/api/slots/1")
    ok(resp.headers.get("Access-Control-Allow-Origin") == "*", "409 ต้องมี CORS origin *")


def test_middleware_lets_active_term_write():
    resp, calls, moved = _run(ACTIVE, "POST", "/api/slots/")
    assert calls["handler"] == 1 and resp.status_code == 200
    ok(calls["save"] == 1 and moved, "เทอม active เขียนแล้วต้องเซฟและขยับรุ่น")


def test_middleware_unaffected_before_any_term():
    for m in ("POST", "PUT", "PATCH", "DELETE"):
        resp, calls, moved = _run(NONE_YET, m, "/api/slots/1")
        ok(calls["handler"] == 1 and resp.status_code == 200 and calls["save"] == 1,
           f"{m}: ยังไม่มีเทอมต้องทำงานเหมือนเดิม")


def test_middleware_lets_unlock_through_while_closed():
    resp, calls, _ = _run(CLOSED, "POST", "/api/terms/3/unlock")
    ok(calls["handler"] == 1 and resp.status_code == 200, "ปลดล็อกต้องผ่านตอนเทอมปิด")
    resp, calls, _ = _run(CLOSED, "POST", "/api/state/history/9/restore")
    ok(calls["handler"] == 1, "กู้คืนต้องผ่านตอนเทอมปิด")


def test_middleware_lets_reads_through_while_closed():
    resp, calls, moved = _run(CLOSED, "GET", "/api/slots/")
    ok(calls["handler"] == 1 and not moved and calls["save"] == 0, "อ่านผ่านและไม่เซฟ")


for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        fn()

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
