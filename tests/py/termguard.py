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


# ── งานที่ 5: กันลบครู ห้อง วิชา ที่เทอมเก่าใช้อยู่ ──────────────────────────
import contextlib


@contextlib.contextmanager
def fake_terms(terms, unreadable=()):
    """terms: {id: (status, snapshot dict | bytes)} · นับจำนวนครั้งที่แกะไฟล์ใน .reads"""
    names = ("_STORE_KIND", "_terms_list", "_term_blob")
    saved = {k: getattr(mock_api, k) for k in names}
    reads: list[int] = []

    def blob(i):
        reads.append(i)
        if i in unreadable:
            raise RuntimeError("SECRET-db-url")
        v = terms[i][1]
        return v if isinstance(v, bytes) else mock_api._pack(v)

    mock_api._STORE_KIND = "postgres"
    mock_api._terms_list = lambda: [{"id": i, "status": st, "year": 2568, "semester": 1,
                                     "label": f"t{i}"} for i, (st, _) in terms.items()]
    mock_api._term_blob = blob
    mock_api._invalidate_entity_index()
    try:
        yield reads
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)
        mock_api._invalidate_entity_index()


def _closed(*slots):
    return {1: ("closed", {"slots": list(slots)})}


def test_delete_blocked_when_a_closed_term_uses_it():
    idx = {"teachers": {5}, "rooms": set(), "subjects": set()}
    msg = mock_api.entity_delete_block("teachers", 5, idx, "ครูสมชาย")
    assert msg is not None and "ไม่ปฏิบัติงานแล้ว" in msg and "ครูสมชาย" in msg


def test_delete_allowed_when_no_closed_term_uses_it():
    idx = {"teachers": {5}, "rooms": set(), "subjects": set()}
    assert mock_api.entity_delete_block("teachers", 6, idx, "ครูสมหญิง") is None
    assert mock_api.entity_delete_block("rooms", 5, idx, "ห้อง 101") is None


def test_index_skips_unreadable_term_files():
    # ไฟล์เทอมที่อ่านไม่ออก หรือ slot ที่ไม่มีคีย์ที่คาด ต้องไม่ทำให้พัง
    mock_api._STORE_KIND = "file"
    idx = mock_api._term_entity_index()
    assert set(idx) == {"teachers", "rooms", "subjects"}
    assert all(isinstance(v, set) for v in idx.values())


EMPTY = {"teachers": set(), "rooms": set(), "subjects": set()}


def test_index_fails_open_without_database_and_on_any_error():
    saved = mock_api._STORE_KIND
    try:
        mock_api._STORE_KIND = "file"
        assert mock_api._term_entity_index() == EMPTY
        # ต่อฐานไม่ได้ / รายการเทอมพัง: ว่าง ไม่ยกข้อผิดพลาด และไม่เอ่ยสตริงเชื่อมต่อ
        mock_api._STORE_KIND = "postgres"
        orig = mock_api._terms_list
        def boom():
            raise RuntimeError("postgres://user:SECRET@host/db")
        mock_api._terms_list = boom
        try:
            mock_api._invalidate_entity_index()
            assert mock_api._term_entity_index() == EMPTY
        finally:
            mock_api._terms_list = orig
    finally:
        mock_api._STORE_KIND = saved
        mock_api._invalidate_entity_index()


def test_index_has_no_raise_statement():
    import ast, inspect, textwrap
    tree = ast.parse(textwrap.dedent(inspect.getsource(mock_api._term_entity_index)))
    assert not [n for n in ast.walk(tree) if isinstance(n, ast.Raise)]


def test_index_teacher_from_teacher_id():
    with fake_terms(_closed({"id": 1, "teacher_id": 11, "room_id": 21, "subject_id": 31})):
        idx = mock_api._term_entity_index()
    assert idx == {"teachers": {11}, "rooms": {21}, "subjects": {31}}


def test_index_teacher_from_co_teacher_id():
    with fake_terms(_closed({"id": 1, "teacher_id": 11, "co_teacher_id": 12})):
        assert mock_api._term_entity_index()["teachers"] == {11, 12}


def test_index_teacher_from_activity_teacher_ids():
    with fake_terms(_closed({"id": 1, "teacher_id": 0, "activity_teacher_ids": [13, 14]})):
        assert mock_api._term_entity_index()["teachers"] == {13, 14}


def test_index_teacher_room_subject_from_elective_options():
    slot = {"id": 1, "teacher_id": 0, "room_id": None, "is_elective": True,
            "elective_options": [{"teacher_id": 15, "room_id": 25, "subject_id": 35},
                                 {"teacher_id": 16, "room_id": 26, "subject_id": 36}]}
    with fake_terms(_closed(slot)):
        idx = mock_api._term_entity_index()
    assert idx == {"teachers": {15, 16}, "rooms": {25, 26}, "subjects": {35, 36}}


def test_index_options_counted_even_without_is_elective_flag():
    slot = {"id": 1, "elective_options": [{"teacher_id": 17}]}
    with fake_terms(_closed(slot)):
        assert mock_api._term_entity_index()["teachers"] == {17}


def test_index_ignores_zero_none_and_active_terms():
    terms = {1: ("closed", {"slots": [{"teacher_id": 0, "co_teacher_id": None,
                                      "activity_teacher_ids": [None, 0]}]}),
             2: ("active", {"slots": [{"teacher_id": 99, "room_id": 98}]})}
    with fake_terms(terms):
        assert mock_api._term_entity_index() == EMPTY


def test_index_corrupt_blob_does_not_hide_other_terms():
    terms = {1: ("closed", b"not gzip at all"),
             2: ("closed", {"slots": [{"teacher_id": 41}]}),
             3: ("closed", {"slots": None}),
             4: ("closed", {"slots": ["junk", {"teacher_id": 42, "activity_teacher_ids": 7}]}),
             5: ("closed", {"slots": [{"teacher_id": 43}]})}
    with fake_terms(terms):
        idx = mock_api._term_entity_index()
    ok(41 in idx["teachers"] and 43 in idx["teachers"], "เทอมดีต้องยังถูกอ่านครบ")
    # เทอม 4: slot แรกพัง ทั้งเทอมถูกข้าม ไม่ยกข้อผิดพลาด (ทั้งสองผลยอมรับได้)
    assert isinstance(idx["teachers"], set)


def test_index_unreadable_from_database_skips_that_term_only():
    terms = {1: ("closed", {"slots": [{"teacher_id": 51}]}),
             2: ("closed", {"slots": [{"teacher_id": 52}]})}
    with fake_terms(terms, unreadable={1}) as reads:
        idx = mock_api._term_entity_index()
        assert idx["teachers"] == {52}
        # อ่านจากฐานพลาด = ไม่เก็บแคช ครั้งหน้าลองใหม่
        mock_api._term_entity_index()
        ok(reads.count(2) == 2, "ดัชนีไม่ครบต้องไม่ถูกแคช")


def test_index_is_cached_until_invalidated():
    with fake_terms(_closed({"teacher_id": 61})) as reads:
        a = mock_api._term_entity_index()
        b = mock_api._term_entity_index()
        assert a == b == {"teachers": {61}, "rooms": set(), "subjects": set()}
        ok(reads == [1], "เรียกครั้งที่สองต้องไม่แกะไฟล์ซ้ำ")
        a["teachers"].add(999)                      # ผู้เรียกแก้ผลของตัวเองไม่กระทบแคช
        ok(mock_api._term_entity_index()["teachers"] == {61}, "แคชต้องไม่ถูกผู้เรียกแก้")
        mock_api._invalidate_entity_index()
        mock_api._term_entity_index()
        ok(reads == [1, 1], "หลังล้างต้องแกะใหม่")


def test_corrupt_blob_is_cached_not_reread_every_time():
    with fake_terms({1: ("closed", b"junk"), 2: ("closed", {"slots": [{"teacher_id": 7}]})}) as reads:
        mock_api._term_entity_index()
        mock_api._term_entity_index()
        ok(reads == [1, 2], "ไฟล์เสียถาวรต้องไม่ทำให้แกะซ้ำทุกคำขอ")


def test_invalidation_during_build_discards_that_build():
    # การสร้างที่คาบเกี่ยวการล้าง (เช่นสร้างเทอมใหม่ระหว่างทาง) ต้องไม่ถูกเก็บ
    with fake_terms(_closed({"teacher_id": 71})):
        orig = mock_api._term_blob
        def blob(i):
            mock_api._invalidate_entity_index()
            return orig(i)
        mock_api._term_blob = blob
        mock_api._term_entity_index()
        ok(mock_api._ENTITY_INDEX is None, "ดัชนีที่ค้างข้ามการล้างต้องไม่ถูกแคช")


class _Cur:
    def __init__(self, fail): self.fail = fail; self.rowcount = 1
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, params=None):
        if self.fail: raise RuntimeError("boom")
    def fetchone(self): return (9,)


class _Conn:
    def __init__(self, fail=False): self.fail = fail
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def cursor(self): return _Cur(self.fail)
    def commit(self): pass


def test_every_term_writer_invalidates_the_cache():
    saved = mock_api._db_connect
    calls = {
        "_term_insert": lambda: mock_api._term_insert(2569, 1, "1/2569", "closed", b"x", 0),
        "_term_set_status": lambda: mock_api._term_set_status(1, "closed"),
        "_term_rotate": lambda: mock_api._term_rotate(1, b"o", 0, 2569, 2, "2/2569", b"n"),
        "_term_swap_active": lambda: mock_api._term_swap_active(1, b"o", 0, 2),
    }
    try:
        for fail in (False, True):          # ล้างแม้การเขียนล้มเหลวกลางทาง
            mock_api._db_connect = lambda f=fail: _Conn(f)
            for name, call in calls.items():
                mock_api._ENTITY_INDEX = {"teachers": {1}, "rooms": set(), "subjects": set()}
                try:
                    call()
                except RuntimeError:
                    ok(fail, f"{name} ไม่ควรพังตอนปกติ")
                ok(mock_api._ENTITY_INDEX is None, f"{name} (fail={fail}) ต้องล้างแคช")
    finally:
        mock_api._db_connect = saved
        mock_api._invalidate_entity_index()


def test_create_and_unlock_go_through_invalidating_writers():
    import inspect
    ok("_term_rotate(" in inspect.getsource(mock_api.create_term), "create_term ใช้ _term_rotate")
    ok("_term_swap_active(" in inspect.getsource(mock_api.unlock_term), "unlock ใช้ _term_swap_active")


def test_missing_active_key_reads_as_active():
    assert mock_api._is_active({"id": 1, "name": "ครูเก่า"}) is True
    assert mock_api._is_active({"id": 1, "active": True}) is True
    assert mock_api._is_active({"id": 1, "active": False}) is False


def test_new_records_default_active_and_put_accepts_it():
    saved = (list(mock_api.TEACHERS), list(mock_api.ROOMS), list(mock_api.SUBJECTS))
    try:
        t = mock_api.create_teacher({"name": "ทดสอบ"})
        r = mock_api.create_room({"name": "ห้องทดสอบ"})
        s = mock_api.create_subject({"name": "วิชาทดสอบ"})
        for rec in (t, r, s):
            ok(rec["active"] is True, "ของใหม่ต้อง active")
        mock_api.update_teacher(t["id"], {"active": False})
        mock_api.update_room(r["id"], {"active": False})
        mock_api.update_subject(s["id"], {"active": False})
        ok(not mock_api._is_active(t) and not mock_api._is_active(r)
           and not mock_api._is_active(s), "PUT ต้องรับ active")
        # ครูที่ไม่ปฏิบัติงานแล้วต้องกลับมาได้
        mock_api.update_teacher(t["id"], {"active": True})
        ok(t["active"] is True, "ทำเครื่องหมายกลับได้")
        # ของเดิมไม่มีคีย์ — PUT อย่างอื่นต้องไม่เติม active: False
        old = {"id": 987654, "name": "เก่า"}
        mock_api.TEACHERS.append(old)
        mock_api.update_teacher(987654, {"name": "เก่า2"})
        ok("active" not in old and mock_api._is_active(old), "คีย์ที่หายยังอ่านเป็น active")
    finally:
        mock_api.TEACHERS[:] = saved[0]
        mock_api.ROOMS[:] = saved[1]
        mock_api.SUBJECTS[:] = saved[2]


def _expect_409(fn):
    try:
        fn()
    except mock_api.HTTPException as e:
        return e
    return None


def test_delete_endpoints_refuse_with_409_when_closed_term_uses_it():
    saved = (list(mock_api.TEACHERS), list(mock_api.ROOMS), list(mock_api.SUBJECTS),
             list(mock_api.SLOTS))
    snap_t, snap_r, snap_s = list(saved[0]), list(saved[1]), list(saved[2])
    mock_api.TEACHERS.append({"id": 900001, "name": "ครูเก่าแก่"})
    mock_api.ROOMS.append({"id": 900002, "name": "ห้องเก่า"})
    mock_api.SUBJECTS.append({"id": 900003, "name": "วิชาเก่า"})
    slot = {"teacher_id": 900001, "room_id": 900002, "subject_id": 900003}
    try:
        with fake_terms(_closed(slot)):
            for fn, i, who in ((mock_api.del_teacher, 900001, "ครูเก่าแก่"),
                               (mock_api.del_room, 900002, "ห้องเก่า"),
                               (mock_api.del_subject, 900003, "วิชาเก่า")):
                e = _expect_409(lambda: fn(i))
                ok(e is not None and e.status_code == 409, f"{fn.__name__} ต้อง 409")
                ok(e is not None and "ไม่ปฏิบัติงานแล้ว" in e.detail and who in e.detail,
                   f"{fn.__name__} ข้อความไทยมีชื่อ")
            ok(any(t["id"] == 900001 for t in mock_api.TEACHERS), "ถูกปฏิเสธแล้วต้องไม่ถูกลบ")
            ok(any(r["id"] == 900002 for r in mock_api.ROOMS), "ห้องต้องยังอยู่")
            ok(any(x["id"] == 900003 for x in mock_api.SUBJECTS), "วิชาต้องยังอยู่")
    finally:
        mock_api.TEACHERS[:] = snap_t
        mock_api.ROOMS[:] = snap_r
        mock_api.SUBJECTS[:] = snap_s


def test_delete_teacher_still_works_without_database():
    mock_api._STORE_KIND = "file"
    t = mock_api.create_teacher({"name": "ลบได้"})
    out = mock_api.del_teacher(t["id"])
    ok("removed" in out and not any(x["id"] == t["id"] for x in mock_api.TEACHERS),
       "ไม่มีฐานข้อมูลต้องลบครูได้เหมือนเดิม")



for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        fn()

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
