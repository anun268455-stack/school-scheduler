"""
ทาง ข. งานที่ 4: อัปเดตแผนกลางเทอม — POST /api/terms/plan-update ใส่เฉพาะข้อที่ติ๊กในธุรกรรมเดียว ไม่แตะคาบ ·
ปลดล็อกเทอมปรับทะเบียนของเว็บตามการเขียนกลับของการอัปเดตกลางเทอมด้วย (แบบข้อ 4.3 4.6 4.7)

ฐานข้อมูลปลอมของ wlexportcreate.py (ตาราง wl_* จาก _WL_SCHEMA + app_terms / app_state บนการเชื่อมต่อที่ COMMIT/ROLLBACK ได้จริง)
+ คำสั่งเปิดเทอมของ wlexportunlock.py · ตัวแปรของโปรแกรมเป็นชุดเล็กของ wlopen.py (แผน 8 แถว ชุดเสรี 1 ชุดที่ลงคาบแล้ว) + คาบที่ลงไว้
(คำตัดสิน P1: ตัวทดสอบใส่คาบลงสำเนาเพื่อสร้างฉากได้ ทุกตัวแปรถูกคืนตอนจบ — ข้อห้าม "ไม่เขียน SLOTS" ผูกโค้ดของโปรแกรม)
รอบ = รอบ 2/2569 ของทาง ก. (_rich: ครูใหม่ · วิชาพิมพ์รหัส ZZ9 · ตัวเลือกพิมพ์รหัส พ21201) แก้ให้มีครบหกกอง (_six)
ของจริง (Postgres · เซิร์ฟเวอร์จริง · ฆ่าหลัง COMMIT · สองคำขอพร้อมกัน) ลองแยกในรายงาน
"""
import contextlib
import copy
import datetime as dt
import hashlib
import inspect
import json
import os
import sys

import mock_api
import plan_diff as D
import wlexportcreate as C
import wlexportunlock as U
from wlcurriculum import ADMIN, HEAD, REQ, FakeCur, _call, _code, _patched, _thai
from wlmidtermpreview import _amend, _approve_all, _close, _dept_row, _round

fails: list[str] = []

# ตัวแปรของโปรแกรมทุกตัวที่ไฟล์นี้แตะ (ผ่าน _world/สำเนา) — ต้องเท่าตอนเริ่มเมื่อจบไฟล์ (คำตัดสิน P1)
_WATCH = ("TEACHERS", "SUBJECTS", "REQUIREMENTS", "ELECTIVE_POOLS", "CURRICULA", "SLOTS", "PARKED", "PLAN_TODOS", "GROUPS",
          "_counters", "CURRENT_TERM", "SCHOOL_CONFIG", "REVISION", "ROOMS", "LAST_RUN", "DEPARTMENTS")
_START = copy.deepcopy({k: getattr(mock_api, k) for k in _WATCH})
_IDS = {k: id(getattr(mock_api, k)) for k in _WATCH}

ENV = C.ENV
ACTIVE_2 = {"id": 9, "year": 2569, "semester": 2, "label": "2/2569", "status": "active"}
CLOSED_1 = {"id": 5, "year": 2569, "semester": 1, "label": "1/2569", "status": "closed"}
CLOSED_2 = {**ACTIVE_2, "status": "closed"}
NO_TERM = {"id": None, "year": None, "semester": None, "label": None, "status": None}
# จุดฉีดล้มของ route นี้ตามลำดับในธุรกรรม (SCHED_TEST_FAIL_AT) — plan_after_commit = ฆ่า process หลัง COMMIT (ลองกับของจริง)
STEPS = ("plan_built", "plan_apply", "plan_writeback", "plan_history", "plan_app_state", "plan_round", "plan_commit")
# ตัวแปรของโปรแกรมที่ต้องเท่าก่อนกดเมื่อล้ม (ของทาง ก. + รายการงาน)
PROGRAM = C.PROGRAM + ("PLAN_TODOS",)
STALE = "ข้อมูลเปลี่ยนตั้งแต่เปิดหน้าเทียบ — ดูใหม่อีกครั้ง"
NONE_PICKED = "ยังไม่ได้เลือกข้อใด"
RESPONSE_KEYS = {"applied", "skipped", "todos", "update_id"}
WRITEBACK_KEYS = {"teachers", "subjects", "created_subjects", "created_wl_subjects", "bound_lines", "bound_options"}


def _slot(i, g, s, t, day, period, **kw):
    return {"id": i, "group_id": g, "subject_id": s, "teacher_id": t, "day": day, "period": period, **kw}


# คาบที่ลงไว้แล้ว: ม.1/1 ท21102 ครู 501 สองคาบ (ข้อเปลี่ยนครู+ห้อง) · ม.1/1 ค21102 คู่สอนร่วม 503/504 สามคาบ (คาบ 3 → 4) ·
# ม.1/2 ท21102 ครู 502 สามคาบ (แถวที่รอบไม่มีแล้ว) · ชุดเสรีของโปรแกรม (pool 1) ลงคาบแล้วอยู่ใน POOLS ของ wlopen.py
PLACED = (_slot(1, 1, 900, 501, 0, 1, room_id=40), _slot(2, 1, 900, 501, 0, 2, room_id=40),
          _slot(3, 1, 901, 503, 1, 1, co_teacher_id=504), _slot(4, 1, 901, 503, 1, 2, co_teacher_id=504),
          _slot(5, 1, 901, 503, 1, 3, co_teacher_id=504),
          _slot(6, 2, 900, 502, 2, 1), _slot(7, 2, 900, 502, 2, 2), _slot(8, 2, 900, 502, 2, 3))
PARKED_ONE = ({"id": 1, "rows": [{"x": 1}]},)


@contextlib.contextmanager
def _midworld(current=ACTIVE_2, terms=(CLOSED_1, ACTIVE_2), slots=PLACED, parked=PARKED_ONE):
    """โลกของ wlexportcreate._world (ฐานปลอม + ตัวแปรของโปรแกรมเป็นสำเนา) + การปลดล็อกของ wlexportunlock · ภาคที่เปิดอยู่ 2/2569"""
    with C._world(terms=terms, current=current, slots=slots, parked=parked) as rec, U._unlockable(rec), \
            _patched(PLAN_TODOS=[]):
        mock_api.SCHOOL_CONFIG.update({"term": "2", "year": "2569"})
        yield rec


def _six(rec, amending=False):
    """รอบ 2/2569 ที่ผ่านเกณฑ์ (ต้องอยู่ใน _midworld) แก้ให้หน้าเทียบมีครบหกกอง:
    registry (ครูใหม่ · ZZ9 · ผูก พ21201) · new (แถวของห้องที่แผนยังไม่มี) · weekly (ม.1/1 ค21102 3 → 4) ·
    teacher (ม.1/1 ท21102 ครู 501 → ครูใหม่ และห้องปฏิบัติการ 40 → 41) · removed (ม.1/2 ท21102 — ลบแถวของรอบ) ·
    sets (ชุดเสรีใหม่ของรอบ = pool ยังไม่ลงคาบ · pool 1 ของโปรแกรมที่ลงแล้วไม่มีในรอบ = รายการงานเท่านั้น)
    amending = รอบเปิดให้แก้กลางเทอมอยู่ · เทอม 1/2569 (ปิด) ได้ไฟล์ของสถานะตอนนี้ไว้ปลดล็อก"""
    db, ns = C._rich()
    rec.use(db)
    lines = {ln["code"]: ln for ln in db.tables["wl_curriculum_lines"]}
    lines["ค21102"]["weekly"] = 4
    th = lines["ท21102"]["id"]
    db.tables["wl_rows"] = [r for r in db.tables["wl_rows"] if not (r["line_id"] == th and r["group_id"] == 2)]
    next(r for r in db.tables["wl_rows"] if r["line_id"] == th and r["group_id"] == 1)["lab_room_id"] = 41
    if amending:
        _round(db, ns.rnd["id"])["amending_since"] = dt.datetime(2026, 11, 18, 8, 0, tzinfo=dt.timezone.utc)
    db.terms[0]["data"] = mock_api._pack({**mock_api._snapshot(), "current_term": dict(CLOSED_1)})
    ns.rid = ns.rnd["id"]
    return db, ns


def _preview(rid):
    return mock_api.terms_plan_update_preview(str(rid))


def _post(rid, accept, token, code=C.ADMIN_CODE, **extra):
    return mock_api.terms_plan_update({"round_id": rid, "admin_code": code, "accept": list(accept), "token": token,
                                       **extra})


def _keys(p, pile=None):
    return [it["key"] for it in p["items"] if pile is None or it["pile"] == pile]


def _state():
    return copy.deepcopy({k: getattr(mock_api, k) for k in PROGRAM})


def _bytes():
    """SLOTS / PARKED ทุกไบต์ + ตัวตนของลิสต์"""
    return (json.dumps(mock_api.SLOTS, sort_keys=True, ensure_ascii=False),
            json.dumps(mock_api.PARKED, sort_keys=True, ensure_ascii=False), id(mock_api.SLOTS), id(mock_api.PARKED))


def _log(rec):
    assert len(rec.conns) == 1, len(rec.conns)
    return rec.conns[0].cur.log


def _stmts(log):
    return [s for s, _p in log]


def _history(db):
    return db.tables["wl_plan_updates"]


def _listed(p):
    return [x["key"] for x in p["already_todo"]]


def _fresh(db, rid):
    """หน้าเทียบที่คำนวณใหม่จากสถานะตอนนี้ + ของสดชุดเดียวกัน (ตัวที่ POST ใช้ใส่)"""
    return mock_api._midterm_build(FakeCur(db, None), rid, keep_live=True)


# ── กฎเหล็ก: คาบไม่ถูกแตะ ───────────────────────────────────────────────────
def test_ticking_every_item_never_touches_slots_or_parked():
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        assert p["usable"] is True and p["reasons"] == [], p["reasons"]
        assert {it["pile"] for it in p["items"]} == set(D.PILES), {it["pile"] for it in p["items"]}
        before = _bytes()
        fresh = _fresh(db, ns.rid)
        assert fresh["diff"]["token"] == p["token"]
        want = D.plan_apply(fresh["diff"], fresh["live"], set(_keys(p)), dict(mock_api._counters))
        out = _post(ns.rid, _keys(p), p["token"])
        assert _bytes() == before, "SLOTS/PARKED เปลี่ยน"
        assert set(out) == RESPONSE_KEYS and out["skipped"] == [] and sorted(out["applied"]) == sorted(_keys(p)), out
        # สิ่งที่ถูกเขียน = เครื่องใส่ (ฟังก์ชันล้วน) ของหน้าเทียบเดียวกัน — หน้าเทียบที่เห็น = สิ่งที่ถูกเขียน
        assert mock_api.TEACHERS == want["teachers"] and mock_api.REQUIREMENTS == want["requirements"]
        assert mock_api.SUBJECTS == want["subjects"] and mock_api.ELECTIVE_POOLS == want["pools"]
        assert mock_api.CURRICULA == want["curricula"] and out["todos"] == len(want["todos"]) == 5, out
        # หลังอัปเดต หน้าเทียบไม่เหลือข้อให้ติ๊ก — ข้อที่โปรแกรมเขียนเองไม่ได้ (ชุดที่ลงคาบแล้ว) อยู่ในรายการงานแล้ว จึงย้ายไป already_todo
        again = _preview(ns.rid)
        assert again["items"] == [] and _listed(again) == ["sets:gone:pool:1"], \
            ([(it["key"], it["label"]) for it in again["items"]], again["already_todo"])


# ── เขียนเฉพาะข้อที่ติ๊ก ──────────────────────────────────────────────────────
def test_writes_only_ticked_items():
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        pick = {_keys(p, "weekly")[0], _keys(p, "removed")[0]}
        fresh = _fresh(db, ns.rid)
        want = D.plan_apply(fresh["diff"], fresh["live"], pick, dict(mock_api._counters))
        before, wl_before, bb = _state(), U._wl(db), _bytes()
        out = _post(ns.rid, sorted(pick), p["token"])
        assert sorted(out["applied"]) == sorted(pick) and len(out["skipped"]) == len(p["items"]) - 2, out
        assert mock_api.REQUIREMENTS == want["requirements"] and mock_api.CURRICULA == want["curricula"]
        changed = {r["id"]: r for r in mock_api.REQUIREMENTS}
        old = {r["id"]: r for r in before["REQUIREMENTS"]}
        assert set(old) - set(changed) == {2} and set(changed) == set(old) - {2}, sorted(changed)   # ลบเฉพาะ ม.1/2 ท21102
        assert {i for i in changed if changed[i] != old[i]} == {3, 4}, changed                     # คาบเฉพาะคู่สอนร่วม
        assert (changed[3]["weekly_count"], changed[4]["weekly_count"]) == (4, 4)
        for k in ("TEACHERS", "SUBJECTS", "ELECTIVE_POOLS", "CURRENT_TERM", "SCHOOL_CONFIG", "LAST_RUN", "GROUPS"):
            assert getattr(mock_api, k) == before[k], k                                          # ข้อที่ไม่ได้ติ๊กไม่เปลี่ยน
        assert U._wl(db) == wl_before and _bytes() == bb                                         # ไม่มีการเขียนทะเบียนกลับ
        assert out["todos"] == 2 and [t["kind"] for t in mock_api.PLAN_TODOS] == ["missing", "over"], mock_api.PLAN_TODOS


def test_requires_are_ticked_and_new_subjects_always_written():
    # ติ๊กข้อเปลี่ยนครูที่อ้างครูใหม่ → ข้อสร้างครูถูกติ๊กให้ (requires) · ติ๊กชุดเสรีใหม่โดยไม่ติ๊กข้อทะเบียนใด → ธงวิชาเสรีของวิชาในชุด
    # ยังถูกเขียน (addendum ข้อ 2: ใส่ subjects ของ plan_apply เสมอ)
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        teacher = next(it for it in p["items"] if it["key"] == "teacher:1:900:1")
        assert teacher["requires"] == ["registry:teacher:11"], teacher
        out = _post(ns.rid, ["teacher:1:900:1", "sets:new:1"], p["token"])
        assert sorted(out["applied"]) == ["registry:teacher:11", "sets:new:1", "teacher:1:900:1"], out
        new_t = next(t for t in mock_api.TEACHERS if t["name"] == "ครูใหม่")
        assert next(r for r in mock_api.REQUIREMENTS if r["id"] == 1)["teacher_id"] == new_t["id"]
        by = {s["id"]: s for s in mock_api.SUBJECTS}
        assert by[904]["is_elective"] is True and by[905]["is_elective"] is True, (by[904], by[905])
        assert len(mock_api.ELECTIVE_POOLS) == 2 and mock_api.ELECTIVE_POOLS[1]["day"] is None
        # ประวัติบอกว่าข้อสร้างครูถูกติ๊กให้เพราะข้ออื่นอ้าง (ไม่ใช่ admin ติ๊กเอง)
        (h,) = _history(db)
        assert [(a["key"], a["auto"]) for a in h["accepted"]] == \
            [("registry:teacher:11", True), ("teacher:1:900:1", False), ("sets:new:1", False)], h["accepted"]


# ── หน้าเทียบเก่า · ข้อที่ไม่มี ──────────────────────────────────────────────
def test_stale_token_is_409_and_nothing_changes():
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        # (ก) มีคนแก้รอบหลังเปิดหน้าเทียบ (หลักสูตร: คาบของ ว21102)
        next(ln for ln in db.tables["wl_curriculum_lines"] if ln["code"] == "ว21102")["weekly"] = 3
        before, dbb, bb = _state(), C._db_snapshot(db), _bytes()
        d = C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 409)
        assert d == STALE == mock_api.PLAN_UPDATE_STALE, d
        assert _state() == before and C._db_snapshot(db) == dbb and _bytes() == bb
        log = _log(rec)
        assert C._writes(log) == [] and "COMMIT" not in _stmts(log) and rec.logged == [], log
        # (ข) มีคนแก้แผนในโปรแกรมหลังเปิดหน้าเทียบ (route เดิม) → หน้าเทียบเก่า → 409
        p2 = _preview(ns.rid)
        mock_api.update_req(5, {"weekly_count": 3})
        before = _state()
        assert C._expect(lambda: _post(ns.rid, _keys(p2), p2["token"]), 409) == STALE
        assert _state() == before
        # (ค) token ตรงแต่ข้อที่ติ๊กไม่มีในหน้าเทียบ → 409 ไทย (เครื่องใส่ปฏิเสธ) ไม่มีอะไรถูกเปลี่ยน
        p3 = _preview(ns.rid)
        before, dbb = _state(), C._db_snapshot(db)
        d = C._expect(lambda: _post(ns.rid, ["new:99:99:99"], p3["token"]), 409, "new:99:99:99")
        assert _state() == before and C._db_snapshot(db) == dbb, d


# ── ทั้งหมดหรือไม่มีเลย ──────────────────────────────────────────────────────
def test_failure_at_each_step_restores_everything():
    for step in STEPS:
        with _midworld() as rec:
            db, ns = _six(rec, amending=True)
            p = _preview(ns.rid)
            before, ids, dbb, bb = _state(), C._ids(), C._db_snapshot(db), _bytes()
            os.environ[ENV] = step
            C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 500, "ยังไม่ได้อัปเดต", "ข้อมูลเดิมยังอยู่ครบ")
            assert _state() == before, (step, [k for k in PROGRAM if _state()[k] != before[k]])
            assert C._ids() == ids and _bytes() == bb, step
            assert C._db_snapshot(db) == dbb, step
            log = _log(rec)
            assert "COMMIT" not in _stmts(log) and rec.conns[0].commits == 0, step
            assert not any(c[0] == "save" for c in rec.calls) and rec.logged == [], (step, rec.calls)
            if step not in ("plan_built", "plan_apply"):            # ล้มจริงหลังขั้นที่ฉีด: มีการเขียนในธุรกรรมแล้วก่อนย้อน
                assert C._writes(log), step
            os.environ.pop(ENV)
            out = _post(ns.rid, _keys(p), p["token"])              # ลองใหม่ได้ผลเหมือนไม่เคยล้ม ไม่มีครู/วิชาซ้ำ
            assert out["update_id"] and sum(1 for t in mock_api.TEACHERS if t["name"] == "ครูใหม่") == 1, step
            assert sum(1 for s in mock_api.SUBJECTS if s.get("code") == "ZZ9") == 1, step
            assert sum(1 for r in db.tables["wl_subjects"] if r["code"] == "ZZ9") == 1 and len(_history(db)) == 1, step


def test_failure_restores_memory_before_the_rollback_releases_the_lock():
    # ROLLBACK ปล่อยล็อกทะเบียน (ปุ่มดึงครูที่รออยู่อ่าน TEACHERS ทันที) → คืนตัวแปรก่อน ROLLBACK ทุกทาง (รีวิวทั้งสาขา M4 ของทาง ก.)
    seen = []
    for case in STEPS + ("edited",):
        with _midworld() as rec:
            db, ns = _six(rec, amending=True)
            p = _preview(ns.rid)
            before = _state()
            real = mock_api._term_writeback

            def writeback(cur, wb):
                out = real(cur, wb)
                if case == "edited":                             # คำขอเขียนอื่นจบหลังใส่ → 409 ก่อน COMMIT
                    mock_api.REVISION["n"] += 1
                return out
            if case in STEPS:
                os.environ[ENV] = case
            del seen[:]
            with _patched(_term_writeback=writeback), \
                    C._patched_attr(C.TermConn, "on_rollback", lambda _c: seen.append(_state())):
                C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 500 if case in STEPS else 409)
            assert seen, case
            for got in seen:
                diff = [k for k in PROGRAM if k != "REVISION" and got[k] != before[k]]
                assert not diff, (case, diff)


def test_app_state_is_written_inside_the_transaction():
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        bb = _bytes()
        del rec.wl_logs[:]
        out = _post(ns.rid, _keys(p), p["token"])
        log = _log(rec)
        stmts = _stmts(log)
        assert rec.conns[0].commits == 1 and stmts.count("COMMIT") == 1 and stmts[-1] == "COMMIT", stmts
        # ล็อกทะเบียนเป็นคำสั่งแรก → แถวรอบ FOR UPDATE · ไม่มี DDL ในธุรกรรม · ไม่แตะ app_terms
        assert log[0] == U.LOCK and log[1] == ("SELECT id FROM wl_rounds WHERE id = %s FOR UPDATE", (ns.rid,)), log[:2]
        assert not any(s.split()[0].upper() in ("CREATE", "ALTER", "DROP", "LOCK") for s in stmts), stmts
        assert not any("app_terms" in s for s in stmts), stmts
        # ลำดับ: เขียน sched_id กลับ → ประวัติ → app_state (รายการงานมีรหัสอัปเดตแล้ว) → COMMIT
        i_wb = next(i for i, s in enumerate(stmts) if s.startswith("UPDATE wl_teachers SET sched_id"))
        i_hist = next(i for i, s in enumerate(stmts) if s.startswith("INSERT INTO wl_plan_updates"))
        i_state = stmts.index(C.UPSERT)
        assert i_wb < i_hist < i_state < stmts.index("COMMIT"), stmts
        snap = mock_api._unpack(db.app_state)
        for key, name in (("teachers", "TEACHERS"), ("subjects", "SUBJECTS"), ("requirements", "REQUIREMENTS"),
                          ("elective_pools", "ELECTIVE_POOLS"), ("curricula", "CURRICULA"), ("plan_todos", "PLAN_TODOS")):
            assert snap[key] == getattr(mock_api, name), key
        assert snap["plan_todos"] and all(t["update_id"] == out["update_id"] for t in snap["plan_todos"])
        assert snap["counters"]["todo"] == mock_api._counters["todo"] and snap["current_term"] == ACTIVE_2
        assert (json.dumps(snap["slots"], sort_keys=True, ensure_ascii=False),
                json.dumps(snap["parked"], sort_keys=True, ensure_ascii=False)) == bb[:2]
        # ก่อนเปิดธุรกรรมมีแค่การตรวจรหัส (อ่านอย่างเดียว) · ล้างคิวเซฟก่อน · เซฟหลัง COMMIT
        assert len(rec.wl_logs) == 1 and all("wl_codes" in q for q, _p in rec.wl_logs[0]), rec.wl_logs
        assert rec.calls == [("flush", True), ("save", 1)], rec.calls


# ── กดพร้อมกัน ───────────────────────────────────────────────────────────────
def test_two_presses_one_succeeds():
    # (ก) ข้อที่เปลี่ยนข้อมูล: คำขอที่สองได้หน้าเทียบใหม่ในธุรกรรม → token ไม่ตรง → 409
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        _post(ns.rid, _keys(p), p["token"])
        before, dbb = _state(), C._db_snapshot(db)
        assert C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 409) == STALE
        assert _state() == before and C._db_snapshot(db) == dbb and len(_history(db)) == 1
        assert sum(1 for t in mock_api.TEACHERS if t["name"] == "ครูใหม่") == 1
    # (ข) ข้อที่เข้ารายการงานอย่างเดียว (ข้อมูลของแผนไม่เปลี่ยน): คำขอที่สองรอล็อกทะเบียนขณะคำขอแรก COMMIT → หน้าเทียบที่คำนวณใหม่
    # ใต้ล็อกผูกกับการอัปเดตครั้งล่าสุด (และข้อนั้นอยู่ในรายการงานแล้ว) → token ไม่ตรง → 409 ไม่สร้างรายการงานซ้ำ
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        pick = ["sets:gone:pool:1"]
        real_lock, first = mock_api._wl_registry_lock, []

        def lock(cur):
            if not first:
                with _patched(_wl_registry_lock=real_lock):
                    first.append(_post(ns.rid, pick, p["token"]))     # คำขอแรกทำจนจบและ COMMIT ขณะคำขอที่สองรอล็อก
                waiting = next(c for c in rec.conns if c.cur is cur)
                waiting._snap = C._db_snapshot(db)                     # ROLLBACK ของคำขอที่สองต้องไม่ย้อนงานที่ COMMIT แล้ว
            return real_lock(cur)
        with _patched(_wl_registry_lock=lock):
            d = C._expect(lambda: _post(ns.rid, pick, p["token"]), 409)
        assert d == STALE and first and first[0]["todos"] == 1, (d, first)
        assert len(_history(db)) == 1 and len(mock_api.PLAN_TODOS) == 1, mock_api.PLAN_TODOS
    # (ค) กดซ้ำทีละครั้ง (คำตอบแรกหาย แล้วลองใหม่ · อีกแท็บ · ย้อนกลับ) ด้วยหน้าเทียบเดิม → 409 ไม่มีประวัติ/รายการงานซ้ำ (รีวิว I1)
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        first = _post(ns.rid, ["sets:gone:pool:1"], p["token"])
        before, dbb = _state(), C._db_snapshot(db)
        assert C._expect(lambda: _post(ns.rid, ["sets:gone:pool:1"], p["token"]), 409) == STALE
        assert _state() == before and C._db_snapshot(db) == dbb
        assert len(_history(db)) == 1 and [t["update_id"] for t in mock_api.PLAN_TODOS] == [first["update_id"]]


def test_token_is_bound_to_the_latest_plan_update():
    # token ของหน้าเทียบ = diff_token(ข้อ) เมื่อยังไม่เคยอัปเดตเลย (pin ของ Task 3 ใช้ได้ตามเดิม) · มีแถวประวัติแล้ว = sha256("token ของข้อ:รหัสล่าสุด")
    # ของทั้งฐาน ไม่ใช่เฉพาะรอบนี้ → การอัปเดตครั้งใดก็ตามหลังเปิดหน้าเทียบทำให้หน้าเทียบนั้นเก่า
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        assert p["token"] == D.diff_token(p["items"]), p["token"]
        out = _post(ns.rid, [_keys(p, "weekly")[0]], p["token"])
        q = _preview(ns.rid)
        want = hashlib.sha256(f"{D.diff_token(q['items'])}:{out['update_id']}".encode()).hexdigest()
        assert q["token"] == want != D.diff_token(q["items"]), q["token"]
        other = db.add("wl_plan_updates", round_id=ns.rid + 50, year=2569, semester=1, by="ผู้ดูแลระบบ", accepted=[],
                       rejected=[], report={})                          # การอัปเดตของรอบอื่น
        r = _preview(ns.rid)
        assert r["items"] == q["items"] and r["token"] != q["token"], r["token"]
        assert r["token"] == hashlib.sha256(f"{D.diff_token(r['items'])}:{other['id']}".encode()).hexdigest()


def test_todo_only_item_already_listed_is_not_offered_again():
    # คำตัดสินผู้คุม (รอบแก้ 1): ข้อที่เข้ารายการงานอย่างเดียว (apply.op = todo) ไม่เปลี่ยนข้อมูล จึงขึ้นทุกครั้งที่ดูหน้าเทียบ — ถ้ามีข้องาน
    # เดียวกัน (kind group_id subject_id text) ที่ยังไม่กด "ทำแล้ว" อยู่แล้ว → ย้ายไป already_todo (ไม่อยู่ใน items และ token ติ๊กไม่ได้)
    with _midworld() as rec:
        db, ns = _six(rec)
        # ข้องานชนิดเดียวกัน ห้องเดียวกัน แต่ข้อความต่าง (คนละเรื่อง) ไม่ทำให้ข้อถูกซ่อน
        other = {"id": 98, "update_id": 9, "kind": "set", "group_id": 5, "subject_id": None, "text": "เรื่องอื่นของ ม.1/5", "done": False}
        mock_api.PLAN_TODOS.append(other)
        p = _preview(ns.rid)
        assert "sets:gone:pool:1" in _keys(p) and p["already_todo"] == [], p["already_todo"]
        mock_api.PLAN_TODOS.remove(other)
        p = _preview(ns.rid)
        item = next(it for it in p["items"] if it["key"] == "sets:gone:pool:1")
        assert D.set_todo(item)["group_id"] == 5, D.set_todo(item)
        _post(ns.rid, ["sets:gone:pool:1"], p["token"])
        q = _preview(ns.rid)
        assert "sets:gone:pool:1" not in _keys(q), _keys(q)
        assert q["already_todo"] == [{"key": item["key"], "pile": item["pile"], "label": item["label"]}], q["already_todo"]
        assert sorted(_keys(q)) == sorted(k for k in _keys(p) if k != "sets:gone:pool:1")
        assert q["token"] == hashlib.sha256(f"{D.diff_token(q['items'])}:1".encode()).hexdigest()
        # ติ๊กข้อนั้นด้วยหน้าเทียบเก่า → token ไม่ตรง 409 · ด้วยหน้าเทียบใหม่ (ไม่มีข้อนั้นแล้ว) → 409 ไม่พบข้อ · ไม่มีอะไรถูกเขียน
        before, dbb = _state(), C._db_snapshot(db)
        assert C._expect(lambda: _post(ns.rid, ["sets:gone:pool:1"], p["token"]), 409) == STALE
        C._expect(lambda: _post(ns.rid, ["sets:gone:pool:1"], q["token"]), 409, "sets:gone:pool:1")
        assert _state() == before and C._db_snapshot(db) == dbb
        # ข้อที่ติ๊กได้อื่น ๆ ยังใช้ได้ (หน้าเทียบใหม่ ไม่ซ้ำรายการงาน)
        out = _post(ns.rid, [_keys(q, "weekly")[0]], q["token"])
        assert [t["kind"] for t in mock_api.PLAN_TODOS] == ["set", "missing"] and out["todos"] == 1, mock_api.PLAN_TODOS
        # กด "ทำแล้ว" แต่ปัญหาในโปรแกรมยังอยู่ (pool ยังลงคาบ) → กลับมาให้ติ๊กได้เหมือนเดิม
        mock_api.terms_todo_done(mock_api.PLAN_TODOS[0]["id"])
        r = _preview(ns.rid)
        assert "sets:gone:pool:1" in _keys(r) and r["already_todo"] == [], r["already_todo"]
        assert next(it for it in r["items"] if it["key"] == "sets:gone:pool:1") == item
        # ข้อที่เปลี่ยนข้อมูลด้วย (สร้าง pool + ข้องานให้ลงคาบ) ไม่ถูกซ่อน แม้มีข้องานข้อความเดียวกันค้างอยู่
        r_new = next(it for it in r["items"] if it["key"] == "sets:new:1")
        mock_api.PLAN_TODOS.append({"id": 99, "update_id": 9, "done": False, **D.set_todo(r_new)})
        assert "sets:new:1" in _keys(_preview(ns.rid))


# ── แก้โปรแกรมระหว่างกด ─────────────────────────────────────────────────────
def test_program_edited_during_the_press_is_409():
    # (ก) จบหลังอ่านสำเนาของโปรแกรม ก่อนใส่ → 409 ไม่มีอะไรถูกเขียน และงานของอีกคำขอยังอยู่
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        before, dbb = _state(), C._db_snapshot(db)
        real, other = mock_api._midterm_build, {"id": 777, "name": "ครูที่เพิ่มระหว่างกด", "department_id": 1}

        def build(cur, rid, **kw):
            out = real(cur, rid, **kw)
            mock_api.TEACHERS.append(other)
            mock_api.REVISION["n"] += 1
            return out
        with _patched(_midterm_build=build):
            d = C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 409, "ระหว่างอัปเดตแผน")
        assert d == mock_api.PLAN_UPDATE_EDITED, d
        assert mock_api.TEACHERS[-1] is other and mock_api.TEACHERS[:-1] == before["TEACHERS"]
        after = _state()
        assert all(after[k] == before[k] for k in PROGRAM if k not in ("TEACHERS", "REVISION"))
        assert C._db_snapshot(db)[:4] == dbb[:4] and [x for x in C._writes(_log(rec)) if x[0] != C.UPSERT] == []
        assert rec.logged == []
    # (ข) จบหลังใส่แล้ว ก่อน COMMIT → 409 ย้อนทั้งฐานและหน่วยความจำ · ของที่คืนแล้วลง app_state ตรง ๆ (M9) · บวกรุ่นให้หน้าเว็บโหลดใหม่
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        before, dbb, bb = _state(), C._db_snapshot(db), _bytes()
        real = mock_api._term_writeback

        def writeback(cur, wb):
            out = real(cur, wb)
            mock_api.REVISION["n"] += 1                  # = มิดเดิลแวร์ของคำขอเขียนอื่นที่จบระหว่างนั้น
            return out
        with _patched(_term_writeback=writeback):
            assert C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 409) == mock_api.PLAN_UPDATE_EDITED
        after = _state()
        assert all(after[k] == before[k] for k in PROGRAM if k != "REVISION") and _bytes() == bb
        assert mock_api.REVISION["n"] == before["REVISION"]["n"] + 2
        assert C._db_snapshot(db)[:4] == dbb[:4] and _history(db) == []
        stmts = _stmts(_log(rec))
        i_rb = stmts.index("ROLLBACK")
        assert "COMMIT" not in stmts[:i_rb] and stmts[i_rb + 1:i_rb + 3] == [C.UPSERT, "COMMIT"], stmts[i_rb:]
        state = mock_api._unpack(db.app_state)
        assert state["teachers"] == before["TEACHERS"] and state["plan_todos"] == before["PLAN_TODOS"]
        assert ("save", 0) in rec.calls and rec.logged == []
        out = _post(ns.rid, _keys(p), p["token"])        # ลองใหม่ได้ครั้งเดียว
        assert out["update_id"] and len(_history(db)) == 1


def test_revision_is_read_with_the_program_copy_and_checked_twice():
    src = inspect.getsource(mock_api._plan_update_transaction)
    assert src.index('REVISION["n"]') < src.index("_midterm_build("), "จดรุ่นก่อนอ่านสำเนาของโปรแกรม"
    checks = [i for i in range(len(src)) if src.startswith("_term_refuse_program_edited(", i)]
    assert len(checks) == 2, checks
    assert checks[0] < src.index("_plan_update_apply(") < src.index('_term_test_fail("plan_round")') < checks[1] \
        < src.index("conn.commit()"), checks


# ── รอบที่แก้กลางเทอม · ประวัติ · รายการงาน ─────────────────────────────────────
def test_amending_round_closes_back_and_an_open_round_stays_open():
    with _midworld() as rec:
        db, ns = _six(rec)
        _close(db, ns.rid)
        assert _amend(db, ns.rid)["amending_since"] is not None
        _approve_all(db, ns.rid)
        p = _preview(ns.rid)
        assert p["usable"] is True and p["round"]["amending_since"] is not None, p["reasons"]
        _post(ns.rid, [_keys(p, "weekly")[0]], p["token"])
        row = _round(db, ns.rid)
        assert row["status"] == "closed" and row["amending_since"] is None and row["closed_at"] is not None, row
        assert _history(db)[0]["report"]["round_closed"] is True
        c, d = _code(lambda: _call(db, HEAD, mock_api.wl_rows_update, _dept_row(db, ns.t)["id"], REQ, {"note": "x"}))
        assert c == 409 and "ปิดแล้ว" in d, (c, d)
    # รอบที่ยังเปิดให้กรอกอยู่ (ไม่เคยปิด) → หลังอัปเดตไม่เปลี่ยนสถานะรอบ (แบบข้อ 4.1)
    with _midworld() as rec:
        db, ns = _six(rec)
        row0 = copy.deepcopy(_round(db, ns.rid))
        assert row0["status"] == "filling" and row0["amending_since"] is None
        p = _preview(ns.rid)
        _post(ns.rid, [_keys(p, "weekly")[0]], p["token"])
        assert _round(db, ns.rid) == row0 and _history(db)[0]["report"]["round_closed"] is False
        assert not any(s.startswith("UPDATE wl_rounds") for s in _stmts(_log(rec)))


def test_history_todos_and_term_log_are_recorded():
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        pick = [k for k in _keys(p) if k != "teacher:3:902:5"]
        counter0 = mock_api._counters.get("todo", 0)
        out = _post(ns.rid, pick, p["token"])
        (h,) = _history(db)
        assert out["update_id"] == h["id"], (out, h["id"])
        assert (h["round_id"], h["term_id"], h["year"], h["semester"], h["by"]) == (ns.rid, 9, 2569, 2, "ผู้ดูแลระบบ"), h
        assert [a["key"] for a in h["accepted"]] == out["applied"] and [r["key"] for r in h["rejected"]] == out["skipped"]
        assert out["skipped"] == ["teacher:3:902:5"] and all(_thai(a["label"]) for a in h["accepted"] + h["rejected"])
        assert all(a["auto"] is (a["key"] not in pick) for a in h["accepted"]), h["accepted"]
        rep = h["report"]
        assert set(rep["writeback"]) == WRITEBACK_KEYS, rep["writeback"]
        new_t = next(t for t in mock_api.TEACHERS if t["name"] == "ครูใหม่")
        assert rep["writeback"]["teachers"] == [{"id": ns.new_t["id"], "old": None, "new": new_t["id"]}], rep["writeback"]
        zz9 = next(s for s in mock_api.SUBJECTS if s.get("code") == "ZZ9")
        wl_zz9 = next(r for r in db.tables["wl_subjects"] if r["code"] == "ZZ9")
        assert rep["writeback"]["created_subjects"] == [{"id": wl_zz9["id"], "old": None, "new": zz9["id"]}]
        assert wl_zz9["sched_id"] == zz9["id"] and rep["todos"] == out["todos"] == 5 and rep["token"] == p["token"]
        assert next(r for r in db.tables["wl_teachers"] if r["id"] == ns.new_t["id"])["sched_id"] == new_t["id"]
        # รายการงาน: รหัสจากตัวนับ todo เรียงกัน · update_id = แถวประวัติ · ข้อความใช้ชื่อห้องจริง (addendum ข้อ 5)
        todos = mock_api.PLAN_TODOS
        assert [t["id"] for t in todos] == list(range(counter0 + 1, counter0 + 6)) == \
            list(range(counter0 + 1, mock_api._counters["todo"] + 1)), todos
        assert all(t["update_id"] == h["id"] and t["done"] is False for t in todos)
        assert [t["kind"] for t in todos] == ["missing", "teacher", "over", "set", "set"], todos
        teacher_todo = todos[1]
        assert "213 ห้องวิชาการ 3" in teacher_todo["text"] and "214 ห้องสมาคมฯ" in teacher_todo["text"], teacher_todo
        assert not any("ห้องรหัส" in t["text"] for t in todos)
        assert [x["state"] for x in mock_api.terms_todos()] == ["open", "open", "open", "open", "open"]
        assert rec.logged == [(9, "plan_update", f"อัปเดตแผนกลางเทอม 2/2569 จากรอบอัตรากำลัง 2/2569: ยอมรับ {len(out['applied'])} "
                                                 f"ข้อ · ไม่ยอมรับ 1 ข้อ · รายการงานใหม่ 5 ข้อ")], rec.logged
        # ข้อความของหน้าเทียบก็ใช้ชื่อห้องจริง
        label = next(it["label"] for it in p["items"] if it["key"] == "teacher:1:900:1")
        assert "213 ห้องวิชาการ 3 → 214 ห้องสมาคมฯ" in label, label


def test_never_created_term_state_works():
    # สภาพของเว็บจริงตอนนี้: ยังไม่เคยสร้างเทอม ตารางเป็นของ 2/2569 ตามหน้าตั้งค่า → อัปเดตได้ · term_id ว่าง (เก็บปี/ภาคเสมอ)
    with _midworld(current=NO_TERM, terms=()) as rec:
        db, ns = C._rich()
        rec.use(db)
        p = _preview(ns.rnd["id"])
        assert p["usable"] is True and p["items"], p["reasons"]
        bb = _bytes()
        out = _post(ns.rnd["id"], _keys(p), p["token"])
        (h,) = _history(db)
        assert (h["term_id"], h["year"], h["semester"]) == (None, 2569, 2) and out["update_id"] == h["id"]
        assert rec.logged and rec.logged[0][0] is None and _bytes() == bb
        assert mock_api.CURRENT_TERM == NO_TERM and db.terms == []


# ── ปฏิเสธ ─────────────────────────────────────────────────────────────────
def test_refusals_write_nothing():
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        del rec.wl_logs[:]
        before, dbb = _state(), C._db_snapshot(db)
        # ไม่ติ๊กเลย → 400 ไม่ตรวจรหัส ไม่เปิดธุรกรรม
        for empty in ([], ()):
            d = C._expect(lambda: _post(ns.rid, empty, p["token"]), 400)
            assert d == NONE_PICKED, d
        # รูปคำขอผิด → 400 ไทย
        for body in (None, [], {"round_id": "1", "admin_code": "x", "accept": ["a"], "token": p["token"]},
                     {"round_id": True, "admin_code": "x", "accept": ["a"], "token": p["token"]},
                     {"round_id": ns.rid, "admin_code": "x", "accept": "a", "token": p["token"]},
                     {"round_id": ns.rid, "admin_code": "x", "accept": [1], "token": p["token"]},
                     {"round_id": ns.rid, "admin_code": "x", "accept": [""], "token": p["token"]},
                     {"round_id": ns.rid, "admin_code": "x", "accept": ["a"]},
                     {"round_id": ns.rid, "admin_code": "x", "accept": ["a"], "token": 5},
                     {"round_id": ns.rid, "accept": ["a"], "token": p["token"]},
                     {"round_id": ns.rid, "admin_code": "  ", "accept": ["a"], "token": p["token"]}):
            c, d = _code(lambda: mock_api.terms_plan_update(body))
            assert c == 400 and _thai(d), (body, c, d)
        assert rec.conns == [] and rec.wl_logs == [] and rec.calls == []
        # รหัสผิด → 403 ถ้อยคำของการอัปเดตแผน (ไม่ใช่ของการสร้างเทอม) · ก่อนตรวจรหัสไม่แตะฐานเลย (รีวิว m4)
        d = C._expect(lambda: _post(ns.rid, _keys(p), p["token"], code="wrong-code-000"), 403)
        assert "ยังไม่ได้อัปเดตแผน" in d and "เทอมใหม่" not in d and rec.conns == [], d
        assert len(rec.wl_logs) == 1 and all("wl_codes" in q for q, _p in rec.wl_logs[0]), rec.wl_logs
        d = C._expect(lambda: _post(ns.rid, _keys(p), p["token"], code=C.HEAD_CODE), 403)    # รหัสหัวหน้ากลุ่ม = ผิด
        # เหตุของรอบ → 409 รวมเหตุ ไม่มีการเขียน
        next(r for r in db.tables["wl_rows"] if r["teacher_id"] is not None)["confirmed"] = False
        dbb = C._db_snapshot(db)
        d = C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 409, "ยังไม่ยืนยัน 1 รายการ", "ยังอัปเดตแผน")
        assert C._writes(rec.conns[-1].cur.log) == [] and rec.conns[-1].commits == 0
        assert _state() == before and C._db_snapshot(db) == dbb
        # ไม่มีรอบ → 404
        C._expect(lambda: _post(ns.rid + 999, _keys(p), p["token"]), 404)
        # ไม่ได้ต่อฐาน → 503 · ข้อมูลของโรงเรียนยังโหลดไม่สำเร็จ → 503 (ไม่เปิดธุรกรรม)
        n = len(rec.conns)
        with _patched(_STORE_KIND="file"):
            C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 503)
        with _patched(_DB_HAD_DATA=True, _STATE_SOURCE="seed"):
            assert C._expect(lambda: _post(ns.rid, _keys(p), p["token"]), 503) == mock_api.MIDTERM_BLOCKED
        assert len(rec.conns) == n and _state() == before and rec.logged == []
    # เทอมที่เปิดอยู่ปิดแล้ว (เปิดดูเทอมเก่า) → 409 ไทยตัวช่วยร่วม ไม่เปิดธุรกรรม (addendum ข้อ 6)
    for status in ("closed", "Closed", "archived"):
        with _midworld(current={**ACTIVE_2, "status": status}) as rec:
            db, ns = C._rich()
            rec.use(db)
            before = _state()
            d = C._expect(lambda: _post(ns.rnd["id"], ["x"], "0" * 64), 409, "ปิดแล้ว")
            assert d.startswith(mock_api.term_closed_message(mock_api.CURRENT_TERM)), d
            assert rec.conns == [] and _state() == before


def test_term_closed_message_is_the_shared_guard():
    f = mock_api.term_closed_message
    assert f(None) is None and f(NO_TERM) is None and f(ACTIVE_2) is None
    assert f(CLOSED_2) == "เทอม 2/2569 ปิดแล้ว ดูและปริ้นได้เท่านั้น"
    for status in ("Closed", "closed ", "archived"):                      # ปิดไว้ก่อน (fail closed) แบบตัวกันเดิม
        assert f({**ACTIVE_2, "status": status}) is not None, status
    assert f({"status": "closed"}) == "เทอมปัจจุบัน ปิดแล้ว ดูและปริ้นได้เท่านั้น"
    # ตัวกันของมิดเดิลแวร์ใช้กฎเดียวกัน (ข้อความเท่าเดิม)
    assert mock_api.term_blocks_write(CLOSED_2, "POST", "/api/slots/1") == f(CLOSED_2)
    assert mock_api.term_blocks_write(CLOSED_2, "POST", "/api/terms/plan-update") is None
    # route ของรายการงาน (Task 2) และ route อัปเดตแผนใช้ตัวช่วยร่วม ไม่ใช่ term_blocks_write กับ path ปลอม
    for fn in (mock_api.terms_todo_done, mock_api.terms_plan_update):
        src = inspect.getsource(fn)
        assert "term_closed_message(CURRENT_TERM)" in src and "term_blocks_write" not in src, fn.__name__
    with _patched(CURRENT_TERM=dict(CLOSED_2), PLAN_TODOS=[{"id": 1, "kind": "set", "group_id": 1, "subject_id": None,
                                                            "text": "x", "done": False}]):
        c, d = _code(lambda: mock_api.terms_todo_done(1))
        assert (c, d) == (409, f(CLOSED_2)) and mock_api.PLAN_TODOS[0]["done"] is False


# ── ปลดล็อกเทอม ─────────────────────────────────────────────────────────────
def test_unlock_after_an_update_that_created_rows_follows_the_open_term():
    with _midworld() as rec:
        db, ns = _six(rec)
        p = _preview(ns.rid)
        _post(ns.rid, _keys(p), p["token"])
        new_t = next(t for t in mock_api.TEACHERS if t["name"] == "ครูใหม่")["id"]
        zz9 = next(s for s in mock_api.SUBJECTS if s.get("code") == "ZZ9")["id"]
        wl_zz9 = next(r for r in db.tables["wl_subjects"] if r["code"] == "ZZ9")["id"]

        def sched(table, wl_id):
            return next(r for r in db.tables[table] if r["id"] == wl_id)["sched_id"]
        U._consistent(db, "หลังอัปเดต")
        for cycle in range(2):
            n = len(rec.conns)
            res = U._unlock(5, "1/2569")                         # เทอมก่อนอัปเดต (ไม่มีครูใหม่ / ZZ9)
            log = rec.conns[n].cur.log
            assert log[0] == U.LOCK and len(rec.conns) == n + 1, log[:2]
            assert _stmts(log)[1:3] == [mock_api.WL_EXPORT_HISTORY_SQL, mock_api.WL_PLAN_UPDATE_HISTORY_SQL], log[1:3]
            assert sched("wl_teachers", ns.new_t["id"]) is None and sched("wl_subjects", wl_zz9) is None, cycle
            assert "ครู 1 คน" in res["workload"][0] and "วิชา 1 วิชา" in res["workload"][0], res["workload"]
            U._consistent(db, f"A {cycle}")
            U._unlock(9, "2/2569")                               # เทอมที่อัปเดตแล้ว
            assert sched("wl_teachers", ns.new_t["id"]) == new_t and sched("wl_subjects", wl_zz9) == zz9, cycle
            U._consistent(db, f"B {cycle}")


def test_unlock_without_any_update_or_export_is_unchanged():
    with _midworld() as rec:
        db, ns = _six(rec)
        n = len(rec.conns)
        del rec.wl_logs[:]
        out = U._unlock(5, "1/2569")
        assert rec.wl_logs == [[(mock_api.WL_EXPORT_EXISTS_SQL, ()), (mock_api.WL_PLAN_UPDATE_EXISTS_SQL, ())]], rec.wl_logs
        log = rec.conns[n].cur.log
        assert _stmts(log) == U.TERMS_DDL + [C.ROTATE_UPDATE, U.ACTIVATE, "COMMIT"], _stmts(log)      # ทางเดิมทุกคำสั่ง
        assert set(out) == {"closed", "active", "save_error", "save_pending"}, set(out)
    # การส่งเท่านั้น (ไม่มีการอัปเดตกลางเทอม) → ประวัติ = export_report ตามลำดับเดิมตรงตัว
    t = [dt.datetime(2026, 11, d, tzinfo=dt.timezone.utc) for d in (1, 2, 3)]
    exports = [({"teachers": [1]}, t[0]), ({"teachers": [2]}, t[2]), ({"teachers": [3]}, None)]
    assert mock_api.wl_writeback_history(exports, []) == [{"teachers": [1]}, {"teachers": [2]}, {"teachers": [3]}]


def test_writeback_history_orders_exports_and_updates_by_time():
    t = [dt.datetime(2026, 11, d, tzinfo=dt.timezone.utc) for d in range(1, 6)]
    exports = [({"teachers": ["e1"]}, t[0]), ({"teachers": ["e3"]}, t[2]), (None, t[4])]
    updates = [({"writeback": {"teachers": ["u2"]}, "todos": 1}, t[1]), ({"todos": 0}, t[3]), (None, None)]
    got = mock_api.wl_writeback_history(exports, updates)
    assert got == [{"teachers": ["e1"]}, {"teachers": ["u2"]}, {"teachers": ["e3"]}, {}, {}, {}], got
    # เวลาเท่ากัน: การส่งก่อนการอัปเดต (ลำดับคงที่) · ไม่แก้ขาเข้า
    same = [({"teachers": ["e"]}, t[0])]
    upd = [({"writeback": {"teachers": ["u"]}}, t[0])]
    keep = copy.deepcopy((same, upd))
    assert mock_api.wl_writeback_history(same, upd) == [{"teachers": ["e"]}, {"teachers": ["u"]}]
    assert (same, upd) == keep


# ── ข้อห้ามของผู้ใช้ ───────────────────────────────────────────────────────────
def test_new_code_never_writes_slots_or_parked():
    for fn in (mock_api.terms_plan_update, mock_api._plan_update_transaction, mock_api._plan_update_restore_point,
               mock_api._plan_update_restore, mock_api._plan_update_apply, mock_api.wl_writeback_history,
               mock_api.term_closed_message, mock_api._plan_todos_copy, mock_api.midterm_token, D.set_todo, D.split_listed):
        src = inspect.getsource(fn)
        for bad in ("SLOTS", "PARKED", "_sync_pool_slots", "/api/timetable/coteach", "_purge_"):
            assert bad not in src, (fn.__name__, bad)
    assert "SLOTS" not in mock_api._PLAN_UPDATE_LISTS and "PARKED" not in mock_api._PLAN_UPDATE_LISTS
    # หน้าเทียบอ่านรายการงานเป็นสำเนาเท่านั้น (ไม่แก้)
    src = inspect.getsource(mock_api._plan_todos_copy)
    for bad in ("PLAN_TODOS[", "PLAN_TODOS.append", "PLAN_TODOS.extend", ".clear(", "_save_state", '["done"] ='):
        assert bad not in src, bad


def test_program_state_restored():
    for k in _WATCH:
        obj = getattr(mock_api, k)
        assert id(obj) == _IDS[k] and obj == _START[k], k


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
