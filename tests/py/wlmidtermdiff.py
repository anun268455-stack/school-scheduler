"""
ทาง ข. งานที่ 1: เครื่องเทียบรอบอัตรากำลังกับแผนสดเป็นกอง และเครื่องใส่เฉพาะข้อที่ติ๊ก (plan_diff.py — ฟังก์ชันล้วน)

ไม่ใช้ฐานข้อมูล · ของสด (live) อยู่ในรูป outgoing ของทาง ก. · live_proposal = mock_api.wl_round_proposal ของของสด (ผู้เรียกเตรียม)
"รอบที่เพิ่งเปิดจากแผนปัจจุบัน" = เส้นเดียวกับไปกลับของทาง ก. (แผนสด → wl_round_proposal → หลักสูตรตั้งต้น → wl_prefill ยืนยันทุกแถว)
ด้วยตัวช่วยของ tests/py/wlexportplan.py · ชุด ข สร้างช่องคาบเสรีรายห้อง กิจกรรมทั้งระดับ และคู่สอนร่วมด้วย route จริงของหน้าจัดคาบ
บนตัวแปรของโปรแกรม ภายใน _scratch ของไฟล์นั้น (คืนทุกตัวที่แตะ — คำตัดสิน P1) แล้วไฟล์นี้ตรวจซ้ำตอนจบว่าตัวแปรของโปรแกรมเท่าตอนเริ่ม
ข้อหน่วยใช้โลกเล็ก ๆ (ห้อง 1–6 · ครูฝั่งเว็บ = ครูฝั่งตาราง + 1000 · วิชาฝั่งเว็บ = วิชาฝั่งตาราง + 2000)
"""
import collections
import copy
import json
import sys

import mock_api
import plan_diff as D
import wlexportplan as P     # ตัวช่วยของทาง ก.: _subjects _round_source _outgoing _scratch _live_shape

fails: list[str] = []

# ตัวแปรของโปรแกรมทุกตัวที่ชุด ข แตะ (route ของหน้าจัดคาบ) + ตัวที่ฟังก์ชันล้วนต้องไม่แตะ — ตรวจตอนจบไฟล์
_WATCH = P._TOUCHED + ("CURRENT_TERM", "REVISION", "ROOMS")
_START = copy.deepcopy({k: getattr(mock_api, k) for k in _WATCH})

KEYS_OF_APPLY = {"teachers", "subjects", "requirements", "pools", "curricula", "group_curricula", "counters",
                 "writeback", "todos", "applied", "skipped"}
GROUPS6 = {g: {"id": g, "name": f"ม.1/{g}", "parent_id": None} for g in range(1, 7)}


# ── โลกเล็กสำหรับข้อหน่วย ─────────────────────────────────────────────────
def _teachers(n=20):
    return [{"id": t, "code": f"T{t:03d}", "name": f"ครู {t}", "department_id": 1, "dept_order": None,
             "fixed_room_id": None, "outdoor_score": 5, "max_slots_per_day": 6, "max_outdoor_per_week": 2, "active": True}
            for t in range(1, n + 1)]


def _mirror(teachers, subjects):
    """ทะเบียนของเว็บที่ได้จากปุ่มดึงจากโปรแกรม (ตัวแปลงของ _WL_IMPORTS) — ครู +1000 วิชา +2000"""
    _t, _n, t_cols, t_row = mock_api._WL_IMPORTS["teachers"]
    _s, _n, s_cols, s_row = mock_api._WL_IMPORTS["subjects"]
    return ([{"id": t["id"] + 1000, **dict(zip(t_cols, t_row(t)))} for t in teachers],
            [{"id": s["id"] + 2000, **dict(zip(s_cols, s_row(s)))} for s in subjects])


def _req(i, g, s, t, weekly=2, **kw):
    r = {"id": i, "group_id": g, "subject_id": s, "teacher_id": t, "weekly_count": weekly, "parallel_group_key": None}
    r.update(kw)
    return r


def _pool(i, gids, opts, weekly=2, day=None, period=None, name=None):
    return {"id": i, "name": name or f"เสรี {i}", "raw_group": "", "group_ids": list(gids), "weekly": weekly,
            "is_double": False, "day": day, "period": period,
            "options": [{"key": 100 * i + n, "subject_id": s, "teacher_id": t, "label": f"วิชา {s}", "code": f"S{s:03d}",
                         "room_id": None} for n, (s, t) in enumerate(opts, 1)]}


def _slot(i, g, s, t, day=0, period=1, **kw):
    out = {"id": i, "group_id": g, "subject_id": s, "teacher_id": t, "day": day, "period": period}
    out.update(kw)
    return out


def _elective_cell(i, g, opts, day, period, pool_id=None):
    """ช่องคาบเสรีในตาราง: pool_id = สำเนาที่การวาง pool เขียนลงตาราง · ไม่มี = คาบเสรีรายห้อง"""
    return {"id": i, "group_id": g, "subject_id": None, "teacher_id": None, "day": day, "period": period,
            "is_elective": True, "elective_pool_id": pool_id,
            "elective_options": [{"subject_id": s, "teacher_id": t, "label": f"วิชา {s}"} for s, t in opts]}


def _world(reqs=(), pools=(), slots=(), group_cur=None, curricula=(), not_in_web=()):
    """ของสดรูปเดียวกับ _outgoing ของทาง ก. (outgoing + teacher_ids subject_ids subject_depts ของ _wl_timetable_source)
    not_in_web = ครูของโปรแกรมที่ทะเบียนของเว็บไม่มี (wl_round_proposal แปลงแถวของครูคนนั้นไม่ได้)"""
    teachers, subjects = _teachers(), P._subjects()
    groups = copy.deepcopy(GROUPS6)
    for g, c in (group_cur or {}).items():
        groups[g]["curriculum_id"] = c
    # แถวแผนที่สอนในคาบเสรีแล้ว (กฎของ _reqs_served_by_elective แบบไม่มีห้องแม่/ลูก)
    windows = [(set(p["group_ids"]), {o["subject_id"] for o in p["options"]}) for p in pools]
    windows += [({s["group_id"]}, {o["subject_id"] for o in s["elective_options"]}) for s in slots if s.get("is_elective")]
    served = {r["id"] for r in reqs if any(r["group_id"] in gs and r["subject_id"] in ss for gs, ss in windows)}
    live = {"requirements": copy.deepcopy(list(reqs)), "pools": copy.deepcopy(list(pools)),
            "slots": copy.deepcopy(list(slots)), "served": served,
            "sched_subjects": {s["id"]: copy.deepcopy(s) for s in subjects}, "groups": groups,
            "teachers": teachers, "subjects": subjects, "curricula": copy.deepcopy(list(curricula)),
            "teacher_ids": {t["id"]: t["id"] + 1000 for t in teachers if t["id"] not in not_in_web},
            "subject_ids": {s["id"]: s["id"] + 2000 for s in subjects},
            "subject_depts": {s["id"] + 2000: s["department_id"] for s in subjects}}
    wl_t, wl_s = _mirror([t for t in teachers if t["id"] not in not_in_web], subjects)
    return live, wl_t, wl_s


def _counters(live):
    return {"teacher": 20, "subject": 29, "slot": max([s["id"] for s in live["slots"]] or [0]),
            "requirement": max([r["id"] for r in live["requirements"]] or [0]),
            "elective_pool": max([p["id"] for p in live["pools"]] or [0]),
            "elective_option": max([o["key"] for p in live["pools"] for o in p["options"]] or [0]),
            "curriculum": max([c["id"] for c in live["curricula"]] or [0])}


def _fresh(live, wl_t, wl_s):
    """รอบที่เพิ่งเปิดจากแผนปัจจุบันแล้วยืนยันทุกแถว (เส้นไปกลับของทาง ก.) → (source, live_proposal)"""
    prop = mock_api.wl_round_proposal(live)
    return P._round_source(live, prop, wl_t, wl_s), prop


def _row(src, g, s):
    """แถวของรอบของห้อง g วิชา s (รหัสฝั่งตาราง)"""
    return next(r for r in src["rows"] if r["group_id"] == g and r["subject_id"] == s + 2000)


def _add_round_row(src, g, s, t, weekly=2, co=None):
    """แถวใหม่ของรอบ: บรรทัดใหม่ในหลักสูตรของห้อง g (มีอยู่แล้วเสมอในโลกเล็ก) + แถวของบรรทัดนั้น"""
    cur = next(c for c in src["curricula"] if g in c["group_ids"])
    lid = max(ln["id"] for c in src["curricula"] for ln in c["lines"]) + 1
    cur["lines"].append({"id": lid, "subject_id": s + 2000, "code": f"S{s:03d}", "name": f"วิชา {s}", "credits": 1.0,
                         "weekly": weekly, "kind": "basic", "department_id": 1})
    src["rows"].append({"id": max(r["id"] for r in src["rows"]) + 1, "round_id": 1, "line_id": lid, "group_id": g,
                        "subject_id": s + 2000, "code": f"S{s:03d}", "weekly": weekly, "teacher_id": t,
                        "co_teacher_id": co, "lab_room_id": None, "is_double": False, "confirmed": True, "flag": None,
                        "department_id": 1})


def _option_of(src, set_name):
    st = next(s for s in src["sets"] if s["name"] == set_name)
    return st, [o for o in src["options"] if o["set_id"] == st["id"]]


def _piles(diff):
    return collections.Counter(i["pile"] for i in diff["items"])


def _by_pile(diff, pile):
    return [i for i in diff["items"] if i["pile"] == pile]


def _diff(live, src, prop, counters=None):
    return D.plan_diff(src, live, prop, counters or _counters(live))


# โลกที่มีครบทุกกองแถว: weekly (ห้อง 1 วิชา 1) · teacher (ห้อง 1 วิชา 2) · removed (ห้อง 2 วิชา 3) ·
# new (ห้อง 2 วิชา 4 ครูใหม่ของเว็บ → registry) · แถวที่ไม่เปลี่ยน (ห้อง 3 วิชา 5)
NEW_WL_TEACHER = {"id": 1999, "sched_id": None, "name": "ครูใหม่ กลางเทอม", "code": "T999", "department_id": 1,
                  "dept_order": None, "active": True}


def _rows_world(slots=()):
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1, 3), _req(2, 1, 2, 2, 2), _req(3, 2, 3, 3, 2), _req(4, 3, 5, 5, 2)],
                              slots=slots)
    src, prop = _fresh(live, wl_t, wl_s)
    _row(src, 1, 1)["weekly"] = 4
    _row(src, 1, 2)["teacher_id"] = 1004
    src["rows"].remove(_row(src, 2, 3))
    src["wl_teachers"].append(dict(NEW_WL_TEACHER))
    _add_round_row(src, 2, 4, 1999, weekly=1)
    return live, src, prop


# ── 1–2. รอบที่เพิ่งเปิดจากแผนปัจจุบัน → ว่างทุกกอง ──────────────────────────────
_CACHE: dict = {}


def _seed():
    if "seed" not in _CACHE:
        out, wl_t, wl_s, counters = P._outgoing()
        prop = mock_api.wl_round_proposal(out)
        _CACHE["seed"] = (out, P._round_source(out, prop, wl_t, wl_s), prop, counters)
    return copy.deepcopy(_CACHE["seed"])


def _live_shape():
    if "live" not in _CACHE:
        with P._scratch():
            _want, made = P._live_shape()
            out, wl_t, wl_s, counters = P._outgoing()
        prop = mock_api.wl_round_proposal(out)
        _CACHE["live"] = (out, P._round_source(out, prop, wl_t, wl_s), prop, counters, made)
    return copy.deepcopy(_CACHE["live"])


def _report(label, diff, out):
    print(f"เทียบรอบที่เพิ่งเปิด {label}: ข้อ {len(diff['items'])} · ไม่อยู่ในรอบ {len(diff['unknown'])} · "
          f"จับคู่ชุดไม่ได้ {len(diff['unmatched_sets'])} · แถวสด {len(out['requirements'])} · "
          f"แถวที่รอบต้องการ {len(diff['desired']['requirements'])} · pool {len(out['pools'])} · "
          f"ชุดของรอบ/ของสด {len(diff['desired']['pools'])}+{len(diff['desired']['report']['activity_sets'])}")


def test_fresh_round_diff_is_empty_seed():
    out, src, prop, counters = _seed()
    diff = D.plan_diff(src, out, prop, counters)
    assert diff["items"] == [], [(i["pile"], i["label"]) for i in diff["items"][:5]]
    assert diff["unmatched_sets"] == [], diff["unmatched_sets"][:3]
    assert diff["unknown"] == [], diff["unknown"][:3]           # ชุด ก ไม่มีแถวที่แปลงไม่ได้
    assert diff["token"] == D.diff_token([])
    assert len(diff["desired"]["requirements"]) == len(out["requirements"]) == 1220
    _report("ชุด ก", diff, out)


def test_fresh_round_diff_is_empty_live_shape():
    out, src, prop, counters, made = _live_shape()
    # ชุด ข มีครบ: ช่องคาบเสรีรายห้อง · แถวแผนของวิชาเสรี · กิจกรรมทั้งระดับ · คู่สอนร่วมสองแถว (เท่า/ไม่เท่า)
    assert made["cells"] > 0 and made["elective_rows"] > 0 and made["activity_rows"] == 24
    assert any(s["kind"] == "activity" for s in prop["sets"]) and prop["unconverted"] == []
    diff = D.plan_diff(src, out, prop, counters)
    assert diff["items"] == [], [(i["pile"], i["label"]) for i in diff["items"][:5]]
    assert diff["unmatched_sets"] == [], diff["unmatched_sets"][:3]
    assert diff["unknown"] == [], diff["unknown"][:3]
    assert len(diff["desired"]["requirements"]) == len(out["requirements"])
    _report("ชุด ข", diff, out)


def test_fresh_round_subgroup_elective_rows():
    # รอบแก้ 1 ข้อ 1: แถววิชาเสรีที่สอนผ่านคาบเสรีของห้องแม่/ห้องย่อย (ข้อมูลตั้งต้น + แถวแบบ repro ของผู้ตรวจ ทั้งสองทิศ)
    # เคยขึ้น "ลบแถว" auto — ต้องว่างทุกกอง และแผนที่รอบต้องการมีแถวนั้น (ทาง ก. เขียนกลับตามรูปของแผนเดิมแล้ว)
    with P._scratch():
        made = P._subgroup_rows()
        out, wl_t, wl_s, counters = P._outgoing()
    prop = mock_api.wl_round_proposal(out)
    src = P._round_source(out, prop, wl_t, wl_s)
    diff = D.plan_diff(src, out, prop, counters)
    assert diff["items"] == [] and diff["unknown"] == [], ([(i["pile"], i["label"]) for i in diff["items"]], diff["unknown"])
    cells = {(r["group_id"], r["subject_id"]) for r in out["requirements"] if r["id"] in made}
    assert cells <= {(r["group_id"], r["subject_id"]) for r in diff["desired"]["requirements"]}


def _guidance_over_split_plan():
    """แบบ probe6 ของผู้ตรวจบนข้อมูลตั้งต้น: กิจกรรมทั้งระดับครูคนเดียว (ครู 140) ครอบแนะแนว 6 (วิชา 222) 14 ห้อง ซึ่งแผนแบ่งครู 140×7 / 142×7"""
    gids = [r["group_id"] for r in mock_api.REQUIREMENTS if r["subject_id"] == 222]
    with P._scratch():
        res = mock_api.create_level_activity({"day": 2, "period": 7, "subject_id": 222, "group_ids": gids,
                                              "teacher_mode": "single", "teacher_id": 140, "label": "แนะแนว ม.3"})
        assert len(res["created"]) == 14 and not res["warnings"], res
        out, wl_t, wl_s, counters = P._outgoing()
    prop = mock_api.wl_round_proposal(out)
    return out, P._round_source(out, prop, wl_t, wl_s), prop, counters


def test_fresh_round_set_taught_rows_keep_live():
    # รอบแก้ 1 ข้อ 2: แถวที่กิจกรรม/คาบเสรีสอนแทน และชุดที่ครอบไม่เปลี่ยน → ไม่มีข้อ (คงของสด) แม้กฎ "ตามรูปของแผนเดิม" ของทาง ก.
    # จะเขียนครูต่างจากแผน (ครูในแผนไม่ใช่ครูของชุด) — กฎของทาง ก. ไม่เปลี่ยน
    out, src, prop, counters = _guidance_over_split_plan()
    diff = D.plan_diff(src, out, prop, counters)
    assert diff["items"] == [] and diff["unknown"] == [], [(i["pile"], i["label"]) for i in diff["items"][:3]]
    live_t = {(r["group_id"], r["subject_id"]): r["teacher_id"] for r in out["requirements"] if r["subject_id"] == 222}
    want_t = {(r["group_id"], r["subject_id"]): r["teacher_id"] for r in diff["desired"]["requirements"]
              if r["subject_id"] == 222}
    assert sum(live_t[c] != want_t[c] for c in live_t) == 7
    # ชุดเปลี่ยน (ครูที่คุมเป็นครู 141) → ใช้กฎทาง ก. ตามเดิม: ทุกแถวของชุดเป็นครู 141 + ข้อชุดกิจกรรม (ลงคาบแล้ว → todo)
    _st, [opt] = _option_of(src, next(s["name"] for s in src["sets"] if s["kind"] == "activity"))
    opt["teachers"] = [{**opt["teachers"][0], "teacher_id": 1141}]
    diff = D.plan_diff(src, out, prop, counters)
    assert _piles(diff) == {"teacher": 14, "sets": 1}, _piles(diff)
    assert {i["after"]["teacher_id"] for i in _by_pile(diff, "teacher")} == {141}
    assert all(i["placed"] == 1 and "ครูเดิม" in i["effect"] for i in _by_pile(diff, "teacher"))
    assert _by_pile(diff, "sets")[0]["auto"] is False


def test_set_taught_rows_kept_when_their_sets_unchanged():
    # probe1 ของผู้ตรวจ (S1–S4): แถวที่คาบเสรี/กิจกรรมสอนแทน ครูในแผนไม่ใช่ครูของชุด → รอบที่เพิ่งเปิดต้องว่าง
    blocks = [_slot(10 + g, g, 20, None, day=0, period=7, is_activity_block=True, activity_teacher_ids=[14]) for g in (1, 2)]
    worlds = {"S1 ครูในแผนไม่ใช่ครูของตัวเลือก": _world([_req(1, 1, 10, 9), _req(2, 1, 1, 1)], pools=[_pool(1, (1, 2), [(10, 8)])]),
              "S2 ครูสอนร่วมนอกชุด": _world([_req(1, 1, 10, 8, co_teacher_id=12), _req(2, 1, 1, 1)],
                                          pools=[_pool(1, (1, 2), [(10, 8)])]),
              "S3 คู่สอนร่วมสองแถว ครูหนึ่งคนนอกชุด": _world([_req(1, 1, 10, 8, co_teacher_id=12), _req(2, 1, 10, 12, co_teacher_id=8),
                                                           _req(3, 1, 1, 1)], pools=[_pool(1, (1, 2), [(10, 8)])]),
              "S4 ครูที่คุมกิจกรรมไม่ใช่ครูในแผน": _world([_req(1, 1, 20, 13, 1), _req(2, 2, 20, 13, 1), _req(3, 1, 1, 1)],
                                                         slots=blocks)}
    for label, (live, wl_t, wl_s) in worlds.items():
        src, prop = _fresh(live, wl_t, wl_s)
        diff = _diff(live, src, prop)
        assert diff["items"] == [], (label, [(i["pile"], i["label"]) for i in diff["items"]])
    # ตัดสินจากครูของวิชานั้นในชุดที่ครอบ (สิ่งเดียวที่กฎของทาง ก. อ่านสำหรับแถวนั้น): ตัวเลือกวิชาอื่นของชุดเปลี่ยน → ข้อชุดอย่างเดียว ·
    # ตัวเลือกของวิชานั้นเปลี่ยน → เทียบด้วยกฎทาง ก. (ครูในแผน 12 ไม่ใช่ครูของตัวเลือก → ครูของตัวเลือก)
    live, wl_t, wl_s = _world([_req(1, 1, 10, 12), _req(2, 1, 1, 1)], pools=[_pool(1, (1, 2), [(10, 8), (11, 9)])])
    src, prop = _fresh(live, wl_t, wl_s)
    next(o for o in src["options"] if o["subject_id"] == 2011)["teachers"][0]["teacher_id"] = 1013
    assert [i["pile"] for i in _diff(live, src, prop)["items"]] == ["sets"]
    next(o for o in src["options"] if o["subject_id"] == 2010)["teachers"][0]["teacher_id"] = 1014
    diff = _diff(live, src, prop)
    assert [(i["pile"], i.get("after", {}).get("teacher_id")) for i in diff["items"]] == [("teacher", 14), ("sets", None)], \
        [(i["pile"], i["label"]) for i in diff["items"]]
    # ชุดที่ครอบต้องคู่กันได้ทั้งสองฝั่ง: รอบเพิ่มชุดใหม่ที่ครอบห้อง+วิชานี้ด้วย = เปลี่ยน → เทียบด้วยกฎทาง ก. (ครูคนแรกของชุดที่ครอบ)
    src, prop = _fresh(live, wl_t, wl_s)
    src["sets"].append({"id": 60, "year": 2569, "semester": 2, "kind": "elective", "name": "เสรีเพิ่ม ม.1/1", "group_ids": [1],
                        "weekly": 1, "is_double": False})
    src["options"].append({"id": 600, "set_id": 60, "subject_id": 2010, "code": "S010", "name": "วิชา 10", "department_id": 1,
                           "teachers": [{"id": 6000, "teacher_id": 1015, "room_id": None}]})
    diff = _diff(live, src, prop)
    assert [(i["pile"], i.get("after", {}).get("teacher_id")) for i in diff["items"]] == [("teacher", 8), ("sets", None)], \
        [(i["pile"], i["label"]) for i in diff["items"]]


def test_round_row_in_set_taught_cell_is_compared():
    # รอบแก้ 2: ห้อง+วิชาที่คาบเสรีสอนแทน (ห้อง 1 วิชา 10 ครู 8) แต่รอบมีแถวของตัวเองสำหรับก้อนนั้น (หัวหน้าเพิ่ม/แก้ในรอบ) —
    # ทาง ก. เขียนแถวของรอบ หน้าเทียบจึงต้องเทียบตามปกติ ไม่ใช่ "คงของสด" แม้ชุดที่ครอบไม่เปลี่ยน (probe_round_row ของผู้ตรวจรอบ 2)
    live, wl_t, wl_s = _world([_req(1, 1, 10, 8), _req(2, 1, 1, 1), _req(3, 2, 1, 1)], pools=[_pool(1, (1, 2), [(10, 8)])])
    assert live["served"] == {1}
    src, prop = _fresh(live, wl_t, wl_s)
    assert _diff(live, src, prop)["items"] == []
    teacher = copy.deepcopy(src)
    _add_round_row(teacher, 1, 10, 1009)
    diff = _diff(live, teacher, prop)
    assert [(i["pile"], i["before"]["teacher_id"], i["after"]["teacher_id"]) for i in diff["items"]] == [("teacher", 8, 9)], \
        [(i["pile"], i["label"]) for i in diff["items"]]
    res = _apply(live, diff, {diff["items"][0]["key"]})
    assert [(r["id"], r["teacher_id"]) for r in res["requirements"]] == [(1, 9), (2, 1), (3, 1)]
    weekly = copy.deepcopy(src)
    _add_round_row(weekly, 1, 10, 1008, weekly=4)
    diff = _diff(live, weekly, prop)
    assert [(i["pile"], i["before"], i["after"]) for i in diff["items"]] == [("weekly", 2, 4)], \
        [(i["pile"], i["label"]) for i in diff["items"]]
    res = _apply(live, diff, {diff["items"][0]["key"]})
    assert [(r["id"], r["weekly_count"]) for r in res["requirements"]] == [(1, 4), (2, 2), (3, 2)]


# ── 3. แก้รอบให้มีครบ 6 กอง ─────────────────────────────────────────────────
def _plain_rows(src, out, n):
    """แถวของรอบที่เป็นห้อง+วิชาธรรมดา (แถวเดียวทั้งในรอบและในแผนสด ไม่มีครูสอนร่วม ไม่ใช่วิชาเสรี/กิจกรรม)"""
    live_n = collections.Counter((r["group_id"], r["subject_id"]) for r in out["requirements"])
    round_n = collections.Counter((r["group_id"], r["subject_id"]) for r in src["rows"])
    by_cell = {(r["group_id"], r["subject_id"]): r for r in out["requirements"]}
    picked = []
    for r in src["rows"]:
        cell = (r["group_id"], r["subject_id"] - 2000)
        if round_n[(r["group_id"], r["subject_id"])] == 1 and live_n[cell] == 1 and r["co_teacher_id"] is None \
                and not r["flag"] and not by_cell[cell].get("co_teacher_id") and by_cell[cell]["id"] not in out["served"] \
                and by_cell[cell]["id"] > 100 and cell[0] not in {x["group_id"] for x in picked}:
            picked.append(r)
        if len(picked) == n:
            return picked
    raise AssertionError("ไม่พอ")


def test_each_pile_detected():
    out, src, prop, counters, _made = _live_shape()
    a, b, c, d = _plain_rows(src, out, 4)
    a["weekly"] += 1                                             # คาบเปลี่ยน
    b["teacher_id"] = 1000 + (7 if b["teacher_id"] != 1007 else 8)  # เปลี่ยนครู
    src["rows"].remove(c)                                        # แถวที่หายไป (ห้องยังอยู่ในหลักสูตร)
    # แถวใหม่ของครูที่เว็บเพิ่งเพิ่ม (ยังไม่มีในโปรแกรม) → ข้อทะเบียน + แถวใหม่ที่ต้องติ๊กข้อทะเบียนด้วย
    have = {r["subject_id"] for r in out["requirements"] if r["group_id"] == d["group_id"]}
    new_s = next(s["id"] for s in out["subjects"] if s["id"] not in have and not s.get("is_activity"))
    src["wl_teachers"].append(dict(NEW_WL_TEACHER))
    src["rows"].append({**d, "id": 99999, "subject_id": new_s + 2000, "teacher_id": 1999, "weekly": 2})
    # คาบเสรี: ชุดของ pool ที่ยังไม่ลงคาบ (วิชาเสรี ม.6/9กข) เปลี่ยนครูของตัวเลือก
    _st, [opt] = _option_of(src, "วิชาเสรี ม.6/9กข")
    old_t = opt["teachers"][0]["teacher_id"]
    opt["teachers"][0]["teacher_id"] = 1000 + (3 if old_t != 1003 else 4)
    diff = D.plan_diff(src, out, prop, counters)
    assert _piles(diff) == {"registry": 1, "new": 1, "weekly": 1, "teacher": 1, "removed": 1, "sets": 1}, \
        [(i["pile"], i["label"]) for i in diff["items"]]
    reg, = _by_pile(diff, "registry")
    new, = _by_pile(diff, "new")
    assert reg["key"] == "registry:teacher:1999" and new["requires"] == [reg["key"]], (reg, new)
    wk, = _by_pile(diff, "weekly")
    assert (wk["group_id"], wk["subject_id"], wk["before"], wk["after"]) == \
        (a["group_id"], a["subject_id"] - 2000, a["weekly"] - 1, a["weekly"]), wk
    rm, = _by_pile(diff, "removed")
    assert (rm["group_id"], rm["subject_id"]) == (c["group_id"], c["subject_id"] - 2000)
    st, = _by_pile(diff, "sets")
    assert st["auto"] is True and st["apply"]["op"] == "pool_edit", st
    # ทุกข้อมีรูปตามสัญญาร่วม · ลำดับกองตามแบบ · JSON ได้ทั้งก้อน (หน้าเทียบส่งให้เว็บตรง ๆ)
    for it in diff["items"]:
        assert {"key", "pile", "label", "placed", "effect", "requires", "auto"} <= set(it), it
        assert isinstance(it["label"], str) and it["label"] and isinstance(it["placed"], int)
    assert [i["pile"] for i in diff["items"]] == ["registry", "new", "weekly", "teacher", "removed", "sets"]
    json.dumps(diff["items"], ensure_ascii=False)
    assert len({i["key"] for i in diff["items"]}) == len(diff["items"])
    for it in diff["items"]:
        print(f"  ชุด ข · {it['pile']}: {it['key']} · {it['label']} · ผลต่อคาบ: {it['effect']}")
    # ติ๊กทุกข้อบนข้อมูลแบบจริง: แผน +1 −1 แถว · ครูใหม่ 1 คน · pool เปลี่ยนเฉพาะครูของตัวเลือกนั้น · ไม่มีคีย์คาบ
    res = D.plan_apply(diff, out, {i["key"] for i in diff["items"]}, counters)
    assert set(res) == KEYS_OF_APPLY
    assert len(res["requirements"]) == len(out["requirements"]) and len(res["teachers"]) == len(out["teachers"]) + 1
    by_id = {r["id"]: r for r in res["requirements"]}
    live_a = next(r for r in out["requirements"] if (r["group_id"], r["subject_id"]) == (a["group_id"], a["subject_id"] - 2000))
    assert by_id[live_a["id"]]["weekly_count"] == a["weekly"]
    changed = [(p["id"], q["options"]) for p, q in zip(out["pools"], res["pools"]) if p != q]
    pool2 = next(p for p in out["pools"] if p["name"] == "วิชาเสรี ม.6/9กข")
    assert [pid for pid, _o in changed] == [pool2["id"]], changed
    assert res["writeback"]["teachers"] == [{"id": 1999, "old": None, "new": counters["teacher"] + 1}]


# ── 4. แถวที่รอบไม่รู้จักไม่ถูกเสนอให้ลบ ───────────────────────────────────────
def test_unknown_rows_never_removed():
    # ห้อง 1 วิชา 1: ครู 15 ไม่มีในทะเบียนของเว็บ → wl_round_proposal แปลงไม่ได้ (unconverted)
    # ห้อง 4: admin ปลดห้องออกจากหลักสูตรของภาคเรียน (แถวของห้องนั้นจึงหายจากรอบ) → รอบไม่รู้จักแถวของห้อง 4
    # ห้อง 2 วิชา 3: รอบรู้จักและไม่มีแล้ว → เสนอให้ลบ (ตัวคุม)
    live, wl_t, wl_s = _world([_req(1, 1, 1, 15, 3), _req(2, 1, 2, 2), _req(3, 2, 3, 3), _req(4, 4, 5, 5), _req(5, 4, 6, 6)],
                              not_in_web={15})
    src, prop = _fresh(live, wl_t, wl_s)
    assert [u["ref"] for u in prop["unconverted"] if u["source"] == "plan"] == [1]
    src["rows"] = [r for r in src["rows"] if r["group_id"] != 4 and (r["group_id"], r["subject_id"]) not in
                   {(1, 2001), (2, 2003)}]
    for c in src["curricula"]:
        c["group_ids"] = [g for g in c["group_ids"] if g != 4]
    diff = _diff(live, src, prop)
    assert [(i["pile"], i["group_id"], i["subject_id"]) for i in diff["items"]] == [("removed", 2, 3)], diff["items"]
    assert [(u["group_id"], u["subject_id"]) for u in diff["unknown"]] == [(1, 1), (4, 5), (4, 6)], diff["unknown"]
    assert all(isinstance(u["label"], str) and u["label"] for u in diff["unknown"])
    # แถวที่รอบไม่รู้จักแต่รอบยังมีแถวของห้อง+วิชานั้น (ครูสอนร่วม/ครูแปลงไม่ได้) ก็ไม่ถูกเทียบ — ไม่มีข้อเท็จจากช่องที่แปลงไม่ได้
    src2, prop2 = _fresh(live, wl_t, wl_s)
    _row(src2, 1, 1)["teacher_id"] = 1007
    diff2 = _diff(live, src2, prop2)
    assert diff2["items"] == [] and [(u["group_id"], u["subject_id"]) for u in diff2["unknown"]] == [(1, 1)]


# ── 5–8. เครื่องใส่ ─────────────────────────────────────────────────────────
def _apply(live, diff, accepted, counters=None):
    return D.plan_apply(diff, live, set(accepted), counters or _counters(live))


def test_apply_only_accepted():
    live, src, prop = _rows_world()
    diff = _diff(live, src, prop)
    assert _piles(diff) == {"registry": 1, "new": 1, "weekly": 1, "teacher": 1, "removed": 1}, diff["items"]
    wk, = _by_pile(diff, "weekly")
    res = _apply(live, diff, {wk["key"]})
    assert res["applied"] == [wk["key"]] and len(res["skipped"]) == 4
    want = copy.deepcopy(live["requirements"])
    want[0]["weekly_count"] = 4
    assert res["requirements"] == want, res["requirements"]
    for k in ("teachers", "subjects", "pools", "curricula"):
        assert res[k] == live[k], k
    assert res["writeback"] == {"teachers": [], "subjects": [], "new_wl_subjects": [], "bind_wl_subjects": []}
    assert res["counters"] == _counters(live) and res["todos"] == []
    # เปลี่ยนครูอย่างเดียว · ลบอย่างเดียว
    th, = _by_pile(diff, "teacher")
    res = _apply(live, diff, {th["key"]})
    assert [(r["id"], r["teacher_id"]) for r in res["requirements"]] == [(1, 1), (2, 4), (3, 3), (4, 5)]
    rm, = _by_pile(diff, "removed")
    res = _apply(live, diff, {rm["key"]})
    assert [r["id"] for r in res["requirements"]] == [1, 2, 4] and res["requirements"] == \
        [r for r in live["requirements"] if r["id"] != 3]


def test_apply_none_changes_nothing():
    live, src, prop = _rows_world(slots=[_slot(1, 1, 1, 1), _slot(2, 2, 3, 3, period=2)])
    diff = _diff(live, src, prop)
    counters = _counters(live)
    res = D.plan_apply(diff, live, set(), counters)
    for k in ("teachers", "subjects", "requirements", "pools", "curricula"):
        assert res[k] == live[k], k
    assert res["group_curricula"] == {g: None for g in GROUPS6}
    assert res["counters"] == counters
    assert res["writeback"] == {"teachers": [], "subjects": [], "new_wl_subjects": [], "bind_wl_subjects": []}
    assert res["todos"] == [] and res["applied"] == [] and res["skipped"] == [i["key"] for i in diff["items"]]
    # ข้อที่ไม่มีในหน้าเทียบ (หน้าเทียบเก่า) → ปฏิเสธ ไม่เดา
    try:
        D.plan_apply(diff, live, {"weekly:9:9:9"}, counters)
        raise AssertionError("ต้องปฏิเสธ")
    except ValueError as e:
        assert "weekly:9:9:9" in str(e)


def test_apply_never_returns_slots():
    live, src, prop = _rows_world(slots=[_slot(1, 1, 1, 1), _slot(2, 1, 2, 2, period=2), _slot(3, 2, 3, 3, period=3)])
    live["parked"] = [{"id": 1}]
    diff = _diff(live, src, prop)
    res = _apply(live, diff, {i["key"] for i in diff["items"]})
    assert set(res) == KEYS_OF_APPLY, set(res)
    assert "slots" not in res and "parked" not in res


def test_requires_registry_auto_ticked():
    live, src, prop = _rows_world()
    diff = _diff(live, src, prop)
    new, = _by_pile(diff, "new")
    reg, = _by_pile(diff, "registry")
    assert new["requires"] == ["registry:teacher:1999"] == [reg["key"]]
    assert reg["after"]["name"] == "ครูใหม่ กลางเทอม" and reg["auto"] is True
    res = _apply(live, diff, {new["key"]})
    assert res["applied"] == [reg["key"], new["key"]], res["applied"]      # ติ๊กให้อัตโนมัติ (ลำดับของหน้าเทียบ)
    created = [t for t in res["teachers"] if t["id"] not in {x["id"] for x in live["teachers"]}]
    assert [(t["id"], t["name"], t["code"]) for t in created] == [(21, "ครูใหม่ กลางเทอม", "T999")]
    assert res["writeback"]["teachers"] == [{"id": 1999, "old": None, "new": 21}]
    added = res["requirements"][len(live["requirements"]):]
    assert [(r["id"], r["group_id"], r["subject_id"], r["teacher_id"], r["weekly_count"]) for r in added] == \
        [(5, 2, 4, 21, 1)], added
    assert res["counters"]["teacher"] == 21 and res["counters"]["requirement"] == 5


# ── 9–12. คาบเสรี ──────────────────────────────────────────────────────────
def test_placed_pool_is_todo_only():
    pool = _pool(1, (1, 2), [(10, 8), (11, 9)], day=1, period=3)
    cells = [_elective_cell(10 + g, g, [(10, 8), (11, 9)], 1, 3, pool_id=1) for g in (1, 2)]
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1), _req(2, 2, 1, 1)], pools=[pool], slots=cells)
    src, prop = _fresh(live, wl_t, wl_s)
    assert _diff(live, src, prop)["items"] == []
    _st, opts = _option_of(src, "เสรี 1")
    next(o for o in opts if o["subject_id"] == 2011)["teachers"][0]["teacher_id"] = 1012
    diff = _diff(live, src, prop)
    it, = diff["items"]
    assert (it["pile"], it["auto"], it["placed"]) == ("sets", False, 2), it
    assert "หน้าจัดคาบ" in it["effect"]
    res = _apply(live, diff, {it["key"]})
    assert res["pools"] == live["pools"] and res["subjects"] == live["subjects"]
    todo, = res["todos"]
    assert todo["kind"] == "set" and todo["done"] is False and "id" not in todo and todo["text"], todo


def test_unplaced_pool_options_updated():
    pool = _pool(1, (1, 2), [(10, 8), (11, 9)], name="เสรี ม.1/1-2")
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1), _req(2, 2, 1, 1)], pools=[pool])
    src, prop = _fresh(live, wl_t, wl_s)
    _st, opts = _option_of(src, "เสรี ม.1/1-2")
    o10 = next(o for o in opts if o["subject_id"] == 2010)
    o10["teachers"].append({**o10["teachers"][0], "id": 900, "teacher_id": 1012, "room_id": 7})   # ครูคนที่สองของวิชา 10
    opts[1]["teachers"][0]["teacher_id"] = 1013                                                    # วิชา 11 เปลี่ยนครู
    diff = _diff(live, src, prop)
    it, = diff["items"]
    assert (it["pile"], it["auto"], it["apply"]["op"], it["placed"]) == ("sets", True, "pool_edit", 0), it
    res = _apply(live, diff, {it["key"]})
    p, = res["pools"]
    # ตัวเลือกที่ยังอยู่คงรหัสเดิม · ตัวเลือกใหม่ได้รหัสต่อจากตัวนับ · ที่ไม่มีแล้วถูกเอาออก · ยังไม่ลงคาบเหมือนเดิม
    assert [(o["key"], o["subject_id"], o["teacher_id"], o["room_id"]) for o in p["options"]] == \
        [(101, 10, 8, None), (103, 10, 12, 7), (104, 11, 13, None)], p["options"]
    assert (p["id"], p["day"], p["period"], p["group_ids"], p["name"]) == (1, None, None, [1, 2], "เสรี ม.1/1-2")
    assert res["counters"]["elective_option"] == 104 and res["todos"] == []
    assert {s["id"] for s in res["subjects"] if s.get("is_elective")} == {10, 11}   # แบบ _mark_elective
    assert res["requirements"] == live["requirements"]
    # ธงวิชาเสรีที่จะติดอยู่ในข้อ (หน้าเทียบ = สิ่งที่เขียน) และเครื่องใส่อ่านจากข้อ ไม่คำนวณเอง · วิชาที่เป็นวิชาเสรีอยู่แล้วไม่อยู่ในรายการ
    assert it["apply"]["mark_elective"] == [10, 11] and "วิชาเสรี" in it["effect"]
    tampered = copy.deepcopy(diff)
    tampered["items"][0]["apply"]["mark_elective"] = []
    assert _apply(live, tampered, {it["key"]})["subjects"] == live["subjects"]
    live["subjects"][10]["is_elective"] = True                       # วิชา 11
    assert _diff(live, src, prop)["items"][0]["apply"]["mark_elective"] == [10]


def test_cell_set_is_todo_only():
    cells = [_elective_cell(10 + g, g, [(15, 9), (16, 10)], 2, 1) for g in (1, 2)]
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1), _req(2, 2, 1, 1)], slots=cells)
    src, prop = _fresh(live, wl_t, wl_s)
    assert any(s["kind"] == "elective" for s in prop["sets"]) and _diff(live, src, prop)["items"] == []
    _st, opts = _option_of(src, prop["sets"][0]["name"])
    opts[0]["teachers"][0]["teacher_id"] = 1011
    diff = _diff(live, src, prop)
    it, = diff["items"]
    assert (it["pile"], it["auto"], it["placed"]) == ("sets", False, 2), it
    res = _apply(live, diff, {it["key"]})
    assert res["pools"] == [] and res["subjects"] == live["subjects"] and [t["kind"] for t in res["todos"]] == ["set"]
    # สองชุดรายห้องห้องเดียวกัน (คนละชั่วโมง คนละวิชา — ชื่อที่ตั้งจากห้องจึงซ้ำกัน) แล้วรอบไม่มีทั้งคู่ → สองข้อ key ไม่ซ้ำ
    cells = [_elective_cell(10 + g, g, [(15, 9)], 2, 1) for g in (1, 2)] + \
        [_elective_cell(20 + g, g, [(16, 10)], 3, 1) for g in (1, 2)]
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1), _req(2, 2, 1, 1)], slots=cells)
    src, prop = _fresh(live, wl_t, wl_s)
    assert len(prop["sets"]) == 2 and prop["sets"][0]["name"] == prop["sets"][1]["name"]
    assert _diff(live, src, prop)["items"] == []
    src["sets"], src["options"] = [], []
    diff = _diff(live, src, prop)
    keys = [i["key"] for i in diff["items"]]
    assert len(keys) == 2 and keys[1] == keys[0] + ":2" and all(not i["auto"] for i in diff["items"]), keys
    assert [t["kind"] for t in _apply(live, diff, set(keys))["todos"]] == ["set", "set"]


def test_live_proposal_must_match_live():
    # live_proposal ต้องคำนวณจากของสดชุดเดียวกับ live (ผู้เรียกเตรียม) — ไม่ตรง = บั๊กของผู้เรียก ปฏิเสธดีกว่าเทียบผิดชุด
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1)], pools=[_pool(1, (1, 2), [(10, 8)])])
    src, prop = _fresh(live, wl_t, wl_s)
    other = copy.deepcopy(live)
    other["pools"][0]["group_ids"] = [3, 4]
    try:
        D.plan_diff(src, other, prop, _counters(live))
        raise AssertionError("ต้องปฏิเสธ")
    except ValueError as e:
        assert "live_proposal" in str(e)


def test_new_set_becomes_unplaced_pool_and_todo():
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1), _req(2, 2, 1, 1)], pools=[_pool(4, (5, 6), [(12, 3)])])
    src, prop = _fresh(live, wl_t, wl_s)
    src["sets"] += [{"id": 50, "year": 2569, "semester": 2, "kind": "elective", "name": "เสรีใหม่ ม.1/1-2",
                     "group_ids": [1, 2], "weekly": 2, "is_double": True},
                    {"id": 51, "year": 2569, "semester": 2, "kind": "activity", "name": "ชุมนุม ม.1/3",
                     "group_ids": [3], "weekly": 1, "is_double": False}]
    src["options"] += [{"id": 500, "set_id": 50, "subject_id": 2017, "code": "S017", "name": "วิชา 17",
                        "department_id": 1, "teachers": [{"id": 5000, "teacher_id": 1006, "room_id": 4},
                                                         {"id": 5001, "teacher_id": 1999, "room_id": None}]},
                       {"id": 501, "set_id": 51, "subject_id": 2018, "code": "S018", "name": "วิชา 18",
                        "department_id": 1, "teachers": [{"id": 5002, "teacher_id": 1007, "room_id": None}]}]
    src["wl_teachers"].append(dict(NEW_WL_TEACHER))
    diff = _diff(live, src, prop)
    assert _piles(diff) == {"registry": 1, "sets": 2}, diff["items"]
    elec = next(i for i in diff["items"] if i["key"] == "sets:new:50")
    act = next(i for i in diff["items"] if i["key"] == "sets:new:51")
    assert (elec["auto"], elec["apply"]["op"], elec["requires"]) == (True, "pool_add", ["registry:teacher:1999"])
    assert elec["apply"]["mark_elective"] == [17]
    assert act["auto"] is False
    res = _apply(live, diff, {elec["key"], act["key"]})
    assert res["applied"] == ["registry:teacher:1999", "sets:new:50", "sets:new:51"]
    old, new = res["pools"]
    assert old == live["pools"][0]
    assert (new["id"], new["name"], new["group_ids"], new["weekly"], new["is_double"], new["day"], new["period"]) == \
        (5, "เสรีใหม่ ม.1/1-2", [1, 2], 2, True, None, None), new
    assert [(o["key"], o["subject_id"], o["teacher_id"], o["room_id"]) for o in new["options"]] == \
        [(402, 17, 6, 4), (403, 17, 21, None)], new["options"]
    assert [t["kind"] for t in res["todos"]] == ["set", "set"] and "ลงคาบ" in res["todos"][0]["text"]
    assert res["counters"]["elective_pool"] == 5 and res["counters"]["elective_option"] == 403


def test_sets_ambiguous_are_unmatched_and_untouched():
    # สองชุดห้องเดียวกันชื่อเดียวกัน แล้วรอบแก้ทั้งคู่ — จับคู่ไม่ได้ → "จับคู่ไม่ได้ — ไม่ทำอะไร" (แบบข้อ 8)
    # แถววิชาเสรีที่ชุดเหล่านั้นสอนแทน (ห้อง 1 วิชา 10 ครูในแผน 12 ไม่ใช่ครูของตัวเลือก) — ชุดที่ครอบจับคู่ไม่ได้ = ตัดสินไม่ได้ → ไม่อยู่ในรอบ
    pools = [_pool(1, (1, 2), [(10, 8)], name="เสรี"), _pool(2, (1, 2), [(11, 9)], name="เสรี")]
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1), _req(2, 1, 10, 12)], pools=pools)
    src, prop = _fresh(live, wl_t, wl_s)
    assert _diff(live, src, prop)["items"] == []          # เนื้อหาเหมือนกันทุกอย่าง → จับคู่ได้
    for o in src["options"]:
        o["teachers"][0]["teacher_id"] = 1015
    diff = _diff(live, src, prop)
    assert diff["items"] == [] and sorted(u["side"] for u in diff["unmatched_sets"]) == ["live", "live", "round", "round"]
    assert all(u["label"] for u in diff["unmatched_sets"])
    assert [(u["group_id"], u["subject_id"]) for u in diff["unknown"]] == [(1, 10)] and "จับคู่" in diff["unknown"][0]["label"]
    # ตัวคุม: ห้องเดียวกันแต่ชื่อต่างกัน → ชื่อแยกได้ แม้รอบแก้ทั้งคู่ (แบบ pool 1 กับ 12 ของข้อมูลตั้งต้น — ห้อง 80–81 ทั้งคู่)
    pools[1]["name"] = "เสรี ข"
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1)], pools=pools)
    src, prop = _fresh(live, wl_t, wl_s)
    for o in src["options"]:
        o["teachers"][0]["teacher_id"] = 1015
    diff = _diff(live, src, prop)
    assert diff["unmatched_sets"] == [] and [(i["apply"]["op"], i["apply"]["pool_id"]) for i in diff["items"]] == \
        [("pool_edit", 1), ("pool_edit", 2)], diff["items"]


def test_set_rows_skipped_by_round_are_not_removed():
    # แถวแผนของวิชาเสรีที่คาบเสรีสอนแทน (ห้อง 1 วิชา 10) — รอบเอาครูของตัวเลือกออกหมด plan_from_round จึงเขียนแถวนั้นไม่ได้
    # (report.skipped) ต้องไม่ขึ้นเป็น "แถวที่หายไป" (รอบยังมีวิชานั้นในชุด) → ไม่อยู่ในรอบ — ไม่ทำอะไร
    live, wl_t, wl_s = _world([_req(1, 1, 10, 8), _req(2, 1, 1, 1)], pools=[_pool(1, (1, 2), [(10, 8)])])
    assert live["served"] == {1}
    src, prop = _fresh(live, wl_t, wl_s)
    assert _diff(live, src, prop)["items"] == []
    src["options"][0]["teachers"] = []
    diff = _diff(live, src, prop)
    assert [s["source"] for s in diff["desired"]["report"]["skipped"]] == ["elective_row"]
    assert [i["pile"] for i in diff["items"]] == ["sets"] and diff["items"][0]["apply"]["remove"] == [[10, 8]]
    assert [(u["group_id"], u["subject_id"]) for u in diff["unknown"]] == [(1, 10)], diff["unknown"]


def test_program_marked_electives_are_not_false_registry_items():
    # วิชาที่โปรแกรมติดธงวิชาเสรีเอง (_mark_elective) หลังดึงทะเบียนไปเว็บ: เว็บยังบอก "ไม่ใช่" — วิชาในชุดคาบเสรีของรอบต้องไม่ขึ้น
    # "เป็นวิชาเสรี: ใช่ → ไม่ใช่" (กฎ _term_keep_set_electives ของทาง ก.) · วิชานอกชุดยังเทียบตามเว็บตามเดิม
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1)], pools=[_pool(1, (1, 2), [(10, 8)])])
    for s in live["subjects"]:
        if s["id"] in (10, 11):
            s["is_elective"] = True
    src, prop = _fresh(live, wl_t, wl_s)
    diff = _diff(live, src, prop)
    assert [(i["key"], i["before"], i["after"]) for i in diff["items"]] == \
        [("registry:subject-edit:2011", {"is_elective": True}, {"is_elective": False})], diff["items"]


# ── 13. รายการงานของข้อที่ติ๊กและมีคาบลงแล้ว ──────────────────────────────────────
def test_todos_for_placed_rows():
    slots = [_slot(1, 1, 1, 1, period=1), _slot(2, 1, 1, 1, period=2), _slot(3, 1, 1, 1, period=3),
             _slot(4, 1, 2, 2, period=4), _slot(5, 1, 2, 2, period=5),
             _slot(6, 2, 3, 3, period=1), _slot(7, 2, 3, 3, period=2),
             _slot(8, 1, 1, 1, period=7, is_overflow=True)]     # คาบกรอบแดงไม่นับว่าลงแล้ว (กฎของ _unplaced_report)
    live, src, prop = _rows_world(slots=slots)
    diff = _diff(live, src, prop)
    by = {i["pile"]: i for i in diff["items"]}
    assert [(p, by[p]["placed"]) for p in ("weekly", "teacher", "removed", "new")] == \
        [("weekly", 3), ("teacher", 2), ("removed", 2), ("new", 0)]
    assert "ขาด 1 คาบ" in by["weekly"]["effect"] and "ครูเดิม" in by["teacher"]["effect"]
    assert "เกินแผน 2 คาบ" in by["removed"]["effect"] and "ยังไม่ลง 1 คาบ" in by["new"]["effect"]
    res = _apply(live, diff, {i["key"] for i in diff["items"]})
    got = [(t["kind"], t["group_id"], t["subject_id"], t.get("teacher_id")) for t in res["todos"]]
    # คาบ 3→4 ลงแล้ว 3 → ขาด · เปลี่ยนครูที่ลงแล้ว → ครู (ครูใหม่ในแผน) · ลบแถวที่ลงแล้ว → เกินแผน · แถวใหม่ยังไม่ลง → ไม่มีข้องาน
    assert got == [("missing", 1, 1, None), ("teacher", 1, 2, 4), ("over", 2, 3, None)], res["todos"]
    assert all(set(t) <= {"kind", "group_id", "subject_id", "teacher_id", "fields", "text", "done"} and t["done"] is False
               and t["text"] for t in res["todos"])
    assert "ขาด 1 คาบ" in res["todos"][0]["text"] and "เกินแผน 2 คาบ" in res["todos"][2]["text"]
    # คาบที่ลงพอดีกับแผนหลังเปลี่ยน → ไม่มีข้องาน
    live2, src2, prop2 = _rows_world(slots=slots + [_slot(9, 1, 1, 1, period=6)])
    diff2 = _diff(live2, src2, prop2)
    wk, = _by_pile(diff2, "weekly")
    assert _apply(live2, diff2, {wk["key"]})["todos"] == [] and "ครบ" in wk["effect"]


# ── สอนร่วม · หลักสูตร ───────────────────────────────────────────────────────
def test_coteach_pair_changes():
    # สอนร่วมสองแถวที่ชี้กัน (บทเรียนเดียว) — คาบเปลี่ยนแก้ทั้งสองแถว · รอบเอาครูสอนร่วมออก → แถวคู่ถูกลบ
    live, wl_t, wl_s = _world([_req(1, 1, 1, 5, 3, co_teacher_id=6), _req(2, 1, 1, 6, 3, co_teacher_id=5)])
    src, prop = _fresh(live, wl_t, wl_s)
    assert _diff(live, src, prop)["items"] == []
    _row(src, 1, 1)["weekly"] = 4
    diff = _diff(live, src, prop)
    wk, = diff["items"]
    assert (wk["pile"], wk["before"], wk["after"]) == ("weekly", 3, 4)
    res = _apply(live, diff, {wk["key"]})
    assert [(r["id"], r["teacher_id"], r["co_teacher_id"], r["weekly_count"]) for r in res["requirements"]] == \
        [(1, 5, 6, 4), (2, 6, 5, 4)]
    src, prop = _fresh(live, wl_t, wl_s)
    _row(src, 1, 1)["co_teacher_id"] = None
    diff = _diff(live, src, prop)
    th, = diff["items"]
    assert (th["pile"], th["before"]["co_teacher_id"], th["after"]["co_teacher_id"]) == ("teacher", 6, None), th
    res = _apply(live, diff, {th["key"]})
    assert [(r["id"], r["teacher_id"], r["co_teacher_id"]) for r in res["requirements"]] == [(1, 5, None)]
    # ลงคาบไว้แล้ว และเปลี่ยนแค่ครูสอนร่วม → บอกในผลต่อคาบ และเข้ารายการงานชนิด teacher ที่ครอบเฉพาะช่องครูสอนร่วม (Task 2 addendum ข้อ 1, 3)
    live, wl_t, wl_s = _world([_req(1, 1, 1, 5, 3, co_teacher_id=6), _req(2, 1, 1, 6, 3, co_teacher_id=5)],
                              slots=[_slot(1, 1, 1, 5, co_teacher_id=6), _slot(2, 1, 1, 5, period=2, co_teacher_id=6)])
    src, prop = _fresh(live, wl_t, wl_s)
    _row(src, 1, 1)["co_teacher_id"] = 1007
    diff = _diff(live, src, prop)
    th, = diff["items"]
    assert th["placed"] == 2 and "ครูสอนร่วม" in th["effect"] and th["after"]["co_teacher_id"] == 7
    res = _apply(live, diff, {th["key"]})
    t, = res["todos"]
    assert (t["kind"], t["teacher_id"], t["fields"]) == ("teacher", 5, ["co_teacher_id"]), t
    assert [(r["teacher_id"], r["co_teacher_id"]) for r in res["requirements"]] == [(5, 7)]


def test_unequal_coteach_half_changes():
    # สอนร่วมคาบไม่เท่ากัน (3/2 ชี้กัน — รอบเก็บสองแถวที่ติดธง) · รอบแก้คาบของครูคนที่สอง 2 → 3: คาบที่ตกลงกันยัง 3 แต่ยอดของครู 6
    # เปลี่ยน — ต้องเป็นข้อ weekly ที่แก้เฉพาะแถวของครู 6
    live, wl_t, wl_s = _world([_req(1, 1, 1, 5, 3, co_teacher_id=6), _req(2, 1, 1, 6, 2, co_teacher_id=5)])
    src, prop = _fresh(live, wl_t, wl_s)
    assert [r["flag"] for r in src["rows"]] == [P.FLAG, P.FLAG] and _diff(live, src, prop)["items"] == []
    next(r for r in src["rows"] if r["teacher_id"] == 1006)["weekly"] = 3
    diff = _diff(live, src, prop)
    wk, = diff["items"]
    assert (wk["pile"], wk["before"], wk["after"], wk["apply"]["rows"]) == ("weekly", 3, 3, [[2, 3]]), wk
    assert "ครู 6 2 → 3" in wk["label"]
    res = _apply(live, diff, {wk["key"]})
    assert [(r["id"], r["weekly_count"]) for r in res["requirements"]] == [(1, 3), (2, 3)]


def test_written_rows_follow_curriculum():
    # แถวใหม่/คาบที่เพิ่มที่หลักสูตรของห้องไม่มีวิชานั้น หรือคาบน้อยกว่า → เพิ่มเข้าหลักสูตร (กฎทาง ก.) เฉพาะข้อที่ติ๊ก
    cur = [{"id": 1, "name": "ม.1 ปกติ", "rows": [{"subject_id": 1, "weekly_count": 3}, {"subject_id": 2, "weekly_count": 2},
                                                  {"subject_id": 4, "weekly_count": 0}]}]
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1, 3), _req(2, 2, 2, 2, 2)], group_cur={1: 1, 2: 1}, curricula=cur)
    src, prop = _fresh(live, wl_t, wl_s)
    _row(src, 1, 1)["weekly"] = 5
    _add_round_row(src, 2, 4, 1004, weekly=2)
    _add_round_row(src, 2, 6, 1006, weekly=1)
    diff = _diff(live, src, prop)
    wk, = _by_pile(diff, "weekly")
    n4, n6 = _by_pile(diff, "new")
    assert "หลักสูตร" in wk["effect"] and "หลักสูตร" in n4["effect"] and "หลักสูตร" in n6["effect"]
    res = _apply(live, diff, {wk["key"], n4["key"]})
    assert res["curricula"] == [{"id": 1, "name": "ม.1 ปกติ", "rows": [
        {"subject_id": 1, "weekly_count": 5}, {"subject_id": 2, "weekly_count": 2}, {"subject_id": 4, "weekly_count": 2}]}]
    assert res["group_curricula"] == {1: 1, 2: 1, 3: None, 4: None, 5: None, 6: None}
    assert _apply(live, diff, set())["curricula"] == live["curricula"]


# ── 14. ลายนิ้วมือของหน้าเทียบ ─────────────────────────────────────────────────
def test_token_stable_and_changes_with_items():
    live, src, prop = _rows_world()
    a, b = _diff(live, src, prop), _diff(copy.deepcopy(live), copy.deepcopy(src), copy.deepcopy(prop))
    assert a["token"] == b["token"] == D.diff_token(a["items"]) == D.diff_token(list(reversed(a["items"])))
    assert isinstance(a["token"], str) and len(a["token"]) == 64
    # ตัวนับที่ขยับเพราะคำขออื่น (เช่นคาบใหม่) ไม่ทำให้หน้าเทียบเก่า
    c = _counters(live)
    c["slot"] += 5
    assert _diff(live, src, prop, c)["token"] == a["token"]
    _row(src, 1, 1)["weekly"] = 6
    changed = _diff(live, src, prop)
    assert changed["token"] != a["token"] and [i["key"] for i in changed["items"]] == [i["key"] for i in a["items"]]
    assert D.diff_token([]) != a["token"]


# ── 15. ไม่แก้สิ่งที่ส่งเข้ามา ─────────────────────────────────────────────────
def test_inputs_not_mutated():
    cur = [{"id": 1, "name": "ม.1", "rows": [{"subject_id": 1, "weekly_count": 3}]}]
    pools = [_pool(1, (1, 2), [(10, 8)]), _pool(2, (3, 4), [(11, 9)], day=0, period=1)]
    slots = [_slot(1, 1, 1, 1), _elective_cell(2, 3, [(11, 9)], 0, 1, pool_id=2), _elective_cell(3, 4, [(11, 9)], 0, 1, 2)]
    live, wl_t, wl_s = _world([_req(1, 1, 1, 1, 3), _req(2, 1, 2, 2), _req(3, 2, 3, 3)], pools=pools, slots=slots,
                              group_cur={1: 1}, curricula=cur)
    src, prop = _fresh(live, wl_t, wl_s)
    _row(src, 1, 1)["weekly"] = 4
    _row(src, 1, 2)["teacher_id"] = 1009
    src["rows"].remove(_row(src, 2, 3))
    src["wl_teachers"].append(dict(NEW_WL_TEACHER))
    _add_round_row(src, 1, 7, 1999)
    for o in src["options"]:
        o["teachers"][0]["teacher_id"] = 1014
    counters = _counters(live)
    before = copy.deepcopy((src, live, prop, counters))
    diff = D.plan_diff(src, live, prop, counters)
    assert (src, live, prop, counters) == before
    assert {i["pile"] for i in diff["items"]} == {"registry", "new", "weekly", "teacher", "removed", "sets"}
    keys = {i["key"] for i in diff["items"]}
    diff_before = copy.deepcopy(diff)
    res = D.plan_apply(diff, live, keys, counters)
    assert (src, live, prop, counters) == before and diff == diff_before
    # ผลเป็นของใหม่ทั้งหมด: แก้ผลแล้วต้องไม่ย้อนไปถึงขาเข้าหรือหน้าเทียบ
    for p in res["pools"]:
        for o in p["options"]:
            o["teacher_id"] = -1
    for c in res["curricula"]:
        for x in c["rows"]:
            x["weekly_count"] = -1
    for k in ("teachers", "subjects", "requirements", "pools", "curricula"):
        for x in res[k]:
            x["id"] = -1
            for v in x.values():
                if isinstance(v, list):
                    v.append(-1)
    for v in res["writeback"].values():
        for w in v:
            w["new"] = -1
    res["counters"]["teacher"] = -1
    assert (src, live, prop, counters) == before and diff == diff_before


# ── กฎของ mock_api ที่เขียนซ้ำใน plan_diff (import mock_api ไม่ได้) ต้องตรงกับตัวจริง ──────────────
def test_fold_rule_matches_program():
    out, src, prop, counters, _made = _live_shape()
    desired = D.plan_diff(src, out, prop, counters)["desired"]["requirements"]
    crafted = [_req(1, 1, 1, None), _req(2, 1, 1, None), _req(3, 1, 1, 5, co_teacher_id=6), _req(4, 1, 1, 6),
               _req(5, 1, 1, 7, co_teacher_id=6), _req(6, 2, 1, 5, 2, co_teacher_id=6), _req(7, 2, 1, 6, 3, co_teacher_id=5),
               _req(8, 2, 1, 8, co_teacher_id=5), _req(9, 3, 1, 0), _req(10, 3, 1, 0, co_teacher_id=0)]
    for rows in (out["requirements"], desired, crafted):
        folded, agreed = mock_api._fold_coteaching(rows)
        mine, partner = D._fold(rows)
        assert mine == folded and set(partner) == set(agreed), (len(mine ^ folded), set(partner) ^ set(agreed))
        assert all(max(int(a.get("weekly_count") or 0) for a in (r, partner[r["id"]])) == agreed[r["id"]]
                   for r in rows if r["id"] in partner)


def test_program_globals_untouched():
    # ตรวจท้ายสุด (ชื่อเรียงหลังทุกข้อ): ทุกข้อข้างบนรวมชุด ข ไม่ทิ้งร่องรอยในตัวแปรของโปรแกรม
    assert {k: getattr(mock_api, k) for k in _WATCH} == _START


for name, fn in sorted(((n, f) for n, f in globals().items() if n.startswith("test_") and callable(f)),
                       key=lambda x: x[0] == "test_program_globals_untouched"):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        fails.append(f"{name}: {type(e).__name__} {e}")

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
