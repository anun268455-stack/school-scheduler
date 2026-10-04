# -*- coding: utf-8 -*-
"""ระบบจัดการสอนแทน — finding who can take a lesson, and how it gets paid back.

The problem this solves, in the school's words: a teacher is sent away on
official business, and someone has to stand in front of the class. Today that
means walking to the staffroom, reading the timetable on the wall, and asking
people one at a time until somebody is both free and willing.

Two arrangements exist and they are not the same thing:

  สอนแทน  — somebody free takes the lesson. Nothing is owed. Used when the
            absence is short notice or the cover is easy to find.
  แลกคาบ  — two teachers trade. X takes the lesson; the absent teacher later
            teaches one of X's. This creates a debt measured in periods, and
            the debt is what has to be settled, not the particular lesson.

Measuring the debt in periods rather than in lessons is what makes the
school's own example work: two periods owed can come back as one period
taught twice, a fortnight apart, which is exactly how they already do it by
hand. So a repayment PLAN is any set of slots adding up to the debt, and this
module offers several shapes of plan rather than one answer.

Everything here reads the live timetable. Nothing in it writes to the
timetable: an arrangement is recorded alongside, so the master timetable the
academic office built is never altered by a teacher arranging cover.
"""
from __future__ import annotations

from datetime import date as _date, datetime as _dt, timedelta as _td
from typing import Any

# These are bound to the live data by mock_api at import time, so this module
# can be read and tested on its own.
DATA: dict[str, Any] = {}


def bind(**tables: Any) -> None:
    """Point this module at the live tables."""
    DATA.update(tables)


def _t(name: str):
    return DATA[name]


# ── วันที่ ────────────────────────────────────────────────────────────────────
# The timetable is a week; an absence is a date. Everything below converts
# between the two, and a date that falls at the weekend simply has no lessons.

def parse_date(s: str | None) -> _date | None:
    try:
        return _dt.strptime(str(s).strip(), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def weekday_of(s: str | None) -> int | None:
    """0=จันทร์ … 4=ศุกร์, and None for a weekend — there is nothing to cover."""
    d = parse_date(s)
    if d is None:
        return None
    wd = d.weekday()
    return wd if wd <= 4 else None


def next_dates_for_weekday(from_date: str, day: int, count: int) -> list[str]:
    """The next `count` dates after from_date that fall on this weekday."""
    d = parse_date(from_date)
    if d is None:
        return []
    out: list[str] = []
    probe = d + _td(days=1)
    while len(out) < count and (probe - d).days <= 70:
        if probe.weekday() == day:
            out.append(probe.isoformat())
        probe += _td(days=1)
    return out


# ── ใครว่างเมื่อไหร่ ──────────────────────────────────────────────────────────
# A teacher is busy at a moment in clock time, not at a period number: ม.ต้น
# and ม.ปลาย run different clocks, so คาบ 5 is not one instant. Every check
# here goes through the same five-minute buckets the timetable itself uses.

def _buckets(group: dict | None, period: int) -> frozenset[int]:
    return _t("slot_buckets")(group, period)


def _lookup(name: str) -> dict:
    """The id→row maps, built once per change.

    These are supplied as callables that build a fresh dict, which is fine for
    one call and ruinous when a page asks for a thousand: _group alone was
    rebuilding the whole class list every time it resolved one id."""
    _fresh()
    key = f"map:{name}"
    got = _CACHE.get(key)
    if got is None:
        got = _t(name)()
        _CACHE[key] = got
    return got


def _group(gid: int) -> dict:
    return _lookup("groups_by_id").get(gid, {})


# Building the busy map means walking every lesson in the week, and the routes
# below ask for it once per candidate per date — thousands of times for a
# single page. It is cached per date and thrown away whenever anything it was
# built from changes, which keeps a page load inside a second instead of
# timing out on the school's server.
_CACHE: dict[str, Any] = {"token": None, "busy": {}, "by_day": None}


def invalidate() -> None:
    _CACHE["token"] = None
    _CACHE["busy"] = {}
    _CACHE["by_day"] = None


def _token() -> tuple:
    return (len(_t("slots")()), len(_t("absences")()),
            len(_t("substitutions")()), len(_t("repayments")()),
            DATA.get("stamp", 0))


def _fresh() -> None:
    tok = _token()
    if _CACHE["token"] != tok:
        _CACHE["token"] = tok
        _CACHE["busy"] = {}
        for k in [k for k in _CACHE if k.startswith("map:")]:
            _CACHE.pop(k, None)
        _CACHE.pop("req", None)
        _CACHE.pop("day_load", None)
        by_day: dict[int, list[dict]] = {}
        for s in _t("slots")():
            by_day.setdefault(s["day"], []).append(s)
        _CACHE["by_day"] = by_day


def slots_on_day(day: int) -> list[dict]:
    _fresh()
    return _CACHE["by_day"].get(day, [])


def busy_map(on_date: str) -> dict[int, set[int]]:
    """teacher_id → the clock buckets they are already committed to that date.

    Built from the weekly timetable, then corrected for what has already been
    arranged ON THAT DATE: a teacher who agreed to cover a lesson is not free
    in that period any more, and a teacher who is away is not free at all.
    Leaving either out is how a cover gets offered to somebody who cannot take
    it, so both are applied here rather than at the call sites.
    """
    day = weekday_of(on_date)
    busy: dict[int, set[int]] = {}
    if day is None:
        return busy
    _fresh()
    hit = _CACHE["busy"].get(on_date)
    if hit is not None:
        return hit

    def add(tid: int | None, gid: int, period: int) -> None:
        if tid is None:
            return
        busy.setdefault(tid, set()).update(_buckets(_group(gid), period))

    away = absent_periods_by_teacher(on_date)

    for s in slots_on_day(day):
        tid = s.get("teacher_id")
        if tid is None:
            continue
        # A teacher who is away does not hold their own periods that day — the
        # whole point is that those periods are free for somebody else.
        if s["period"] in away.get(tid, set()):
            continue
        add(tid, s["group_id"], s["period"])
        # An elective's options each have their own teacher, all busy at once.
        for other in _t("elective_option_teachers")(s):
            if other != tid:
                add(other, s["group_id"], s["period"])

    # Cover and repayment already agreed for this date.
    for r in _t("substitutions")():
        if r.get("date") == on_date and r.get("status") != "cancelled":
            add(r.get("cover_teacher_id"), r["group_id"], r["period"])
    for r in _t("repayments")():
        if r.get("date") == on_date and r.get("status") != "cancelled":
            add(r.get("teacher_id"), r["group_id"], r["period"])

    # An absent teacher is unavailable for the whole of their declared window,
    # so they can never be offered as somebody else's cover.
    for tid, periods in away.items():
        for p in periods:
            for s in slots_on_day(day):
                if s["period"] == p:
                    add(tid, s["group_id"], p)
                    break
            else:
                busy.setdefault(tid, set())

    _CACHE["busy"][on_date] = busy
    return busy


def is_free(tid: int, gid: int, period: int, busy: dict[int, set[int]]) -> bool:
    return not (_buckets(_group(gid), period) & busy.get(tid, set()))


# ── การแจ้งไปราชการ ──────────────────────────────────────────────────────────

def absent_periods_by_teacher(on_date: str) -> dict[int, set[int]]:
    """Who is away that date, and in which periods.

    An absence with no periods listed is the whole day, which is read here as
    "every period that teacher actually teaches that day" rather than a magic
    empty list the rest of the module would have to keep re-interpreting.
    """
    day = weekday_of(on_date)
    out: dict[int, set[int]] = {}
    if day is None:
        return out
    for a in _t("absences")():
        if a.get("date") != on_date or a.get("status") == "cancelled":
            continue
        tid = a["teacher_id"]
        listed = a.get("periods")
        if listed:
            out.setdefault(tid, set()).update(int(p) for p in listed)
        else:
            out.setdefault(tid, set()).update(
                s["period"] for s in slots_on_day(day)
                if s.get("teacher_id") == tid)
    return out


def affected_lessons(teacher_id: int, on_date: str, periods: list[int] | None) -> list[dict]:
    """The lessons this absence actually leaves uncovered, in time order."""
    day = weekday_of(on_date)
    if day is None:
        return []
    wanted = {int(p) for p in periods} if periods else None
    out = []
    for s in slots_on_day(day):
        if s.get("teacher_id") != teacher_id:
            continue
        if wanted is not None and s["period"] not in wanted:
            continue
        out.append(s)
    return sorted(out, key=lambda s: s["period"])


# ── ใครสอนแทนได้ ─────────────────────────────────────────────────────────────

def _subject_of(sid: int | None) -> dict:
    return _lookup("subjects_by_id").get(sid, {}) if sid is not None else {}


def _req_index() -> dict[str, set]:
    """Who teaches what, as sets — the same three questions are asked of every
    teacher for every lesson, and scanning 1,220 requirement rows each time is
    what made the page too slow to load."""
    _fresh()
    idx = _CACHE.get("req")
    if idx is None:
        by_sub_group: set[tuple[int, int | None, int]] = set()
        by_sub: set[tuple[int, int | None]] = set()
        by_group: set[tuple[int, int]] = set()
        for r in _t("requirements")():
            by_sub_group.add((r["teacher_id"], r["subject_id"], r["group_id"]))
            by_sub.add((r["teacher_id"], r["subject_id"]))
            by_group.add((r["teacher_id"], r["group_id"]))
        idx = {"sub_group": by_sub_group, "sub": by_sub, "group": by_group}
        _CACHE["req"] = idx
    return idx


def teaches_subject_to(tid: int, subject_id: int | None, gid: int) -> bool:
    return (tid, subject_id, gid) in _req_index()["sub_group"]


def teaches_subject(tid: int, subject_id: int | None) -> bool:
    return (tid, subject_id) in _req_index()["sub"]


def match_level(tid: int, subject_id: int | None, gid: int) -> tuple[int, str]:
    """How well this teacher fits the lesson. Higher is better.

    The order matters more than the numbers: a teacher who already takes this
    very class for this very subject loses nothing at all, while "free that
    period" on its own only means the class is supervised.
    """
    subj = _subject_of(subject_id)
    if teaches_subject_to(tid, subject_id, gid):
        return 4, "สอนวิชานี้ให้ห้องนี้อยู่แล้ว"
    if teaches_subject(tid, subject_id):
        return 3, "สอนวิชานี้อยู่ (คนละห้อง)"
    t = _lookup("teachers_by_id").get(tid, {})
    if subj.get("department_id") and t.get("department_id") == subj["department_id"]:
        return 2, "กลุ่มสาระเดียวกัน"
    if (tid, gid) in _req_index()["group"]:
        return 1, "สอนห้องนี้วิชาอื่นอยู่"
    return 0, "ว่างคาบนี้ (คุมชั้นเรียนได้)"


def _load_that_day(tid: int, day: int, on_date: str) -> int:
    _fresh()
    table = _CACHE.get("day_load")
    if table is None:
        table = {}
        for s in _t("slots")():
            k = (s.get("teacher_id"), s["day"])
            table[k] = table.get(k, 0) + 1
        _CACHE["day_load"] = table
    n = table.get((tid, day), 0)
    n += sum(1 for r in _t("substitutions")()
             if r.get("date") == on_date and r.get("cover_teacher_id") == tid
             and r.get("status") != "cancelled")
    return n


def cover_candidates(lesson: dict, on_date: str, exclude: set[int] | None = None,
                     limit: int = 12) -> list[dict]:
    """Teachers who could take this one lesson, best fit first."""
    day = weekday_of(on_date)
    if day is None:
        return []
    busy = busy_map(on_date)
    gid, period = lesson["group_id"], lesson["period"]
    exclude = exclude or set()
    prefs = _t("teacher_prefs")

    out = []
    for t in _t("teachers")():
        tid = t["id"]
        if tid in exclude or tid == lesson.get("teacher_id"):
            continue
        if not is_free(tid, gid, period, busy):
            continue
        p = prefs(t)
        if day in p["days_off"] or period in p["avoid_periods"]:
            continue            # the teacher told us they are not there
        score, why = match_level(tid, lesson.get("subject_id"), gid)
        out.append({
            "teacher_id": tid,
            "teacher_name": t.get("name"),
            "teacher_code": t.get("code"),
            "score": score,
            "reason": why,
            "load_that_day": _load_that_day(tid, day, on_date),
        })
    # Best fit first; among equals, whoever is having the lighter day.
    out.sort(key=lambda c: (-c["score"], c["load_that_day"], c["teacher_name"] or ""))
    return out[:limit]


# ── แลกคาบ: หาเส้นทางคืนคาบ ──────────────────────────────────────────────────

def repayable_slots(absent_tid: int, cover_tid: int, after_date: str,
                    weeks_ahead: int = 4) -> list[dict]:
    """Lessons of the cover teacher that the absent teacher could take back.

    One entry per (lesson, date): the same Thursday period is a different
    repayment next week, and offering both is what lets two periods come back
    as one period taught twice.
    """
    out: list[dict] = []
    seen: set[tuple[int, str]] = set()
    for s in _t("slots")():
        if s.get("teacher_id") != cover_tid:
            continue
        if s.get("is_locked") or s.get("is_elective") or s.get("parallel_group_key"):
            continue        # not one teacher's to hand over
        gid, period, day = s["group_id"], s["period"], s["day"]
        for d in next_dates_for_weekday(after_date, day, weeks_ahead):
            if (s["id"], d) in seen:
                continue
            busy = busy_map(d)
            if not is_free(absent_tid, gid, period, busy):
                continue
            t = _lookup("teachers_by_id").get(absent_tid, {})
            p = _t("teacher_prefs")(t)
            if day in p["days_off"] or period in p["avoid_periods"]:
                continue
            score, why = match_level(absent_tid, s.get("subject_id"), gid)
            seen.add((s["id"], d))
            out.append({
                "slot_id": s["id"], "date": d, "day": day, "period": period,
                "group_id": gid, "group_name": s.get("group_name"),
                "subject_id": s.get("subject_id"),
                "subject_code": s.get("subject_code"), "subject_name": s.get("subject_name"),
                "room_name": s.get("room_name"),
                "score": score, "reason": why,
            })
    out.sort(key=lambda r: (r["date"], r["period"]))
    return out


def repayment_plans(absent_tid: int, cover_tid: int, owed: int, after_date: str,
                    weeks_ahead: int = 4, max_plans: int = 6) -> list[dict]:
    """Ways to pay back `owed` periods, as whole plans rather than loose slots.

    Three shapes, because the school uses all three:
      รวดเดียว     — the periods back to back on one day, mirroring a คาบคู่
      แยกวัน       — different days in the same week
      ข้ามสัปดาห์  — the same period repeated week after week, which is how a
                     double normally comes back when no free pair exists
    """
    if owed <= 0:
        return []
    slots = repayable_slots(absent_tid, cover_tid, after_date, weeks_ahead)
    if not slots:
        return []

    def plan(kind: str, label: str, chosen: list[dict]) -> dict:
        return {
            "kind": kind, "label": label, "periods": len(chosen),
            "slots": chosen,
            # The weakest link decides how comfortable the plan is: a plan is
            # only as good as the lesson the teacher is least able to take.
            "score": min(c["score"] for c in chosen),
        }

    plans: list[dict] = []

    if owed == 1:
        for c in slots[:max_plans]:
            plans.append(plan("single", "คืน 1 คาบ", [c]))
        return plans[:max_plans]

    # รวดเดียว — consecutive periods on one date.
    by_date: dict[str, list[dict]] = {}
    for c in slots:
        by_date.setdefault(c["date"], []).append(c)
    for d, rows in by_date.items():
        rows = sorted(rows, key=lambda r: r["period"])
        for i in range(len(rows) - owed + 1):
            block = rows[i:i + owed]
            lvl = _t("level_key")(_group(block[0]["group_id"]))
            nums = _t("class_periods_for_level")(lvl)
            want = [block[0]["period"]]
            for _ in range(owed - 1):
                nxt = _t("next_class_period_for")(lvl, want[-1])
                if nxt is None:
                    break
                want.append(nxt)
            if [b["period"] for b in block] == want:
                plans.append(plan("block", f"คืนรวดเดียว {owed} คาบติดกัน", block))
                break

    # ข้ามสัปดาห์ — the same lesson, once a week, until the debt is clear.
    by_slot: dict[int, list[dict]] = {}
    for c in slots:
        by_slot.setdefault(c["slot_id"], []).append(c)
    for sid, rows in by_slot.items():
        rows = sorted(rows, key=lambda r: r["date"])
        if len(rows) >= owed:
            chosen = rows[:owed]
            plans.append(plan("weekly", f"คืนคาบละสัปดาห์ · {owed} สัปดาห์", chosen))

    # แยกวัน — different days, soonest first.
    spread: list[dict] = []
    used_cells: set[tuple[str, int]] = set()
    for c in slots:
        key = (c["date"], c["period"])
        if key in used_cells:
            continue
        if any(x["date"] == c["date"] for x in spread):
            continue
        spread.append(c)
        used_cells.add(key)
        if len(spread) == owed:
            break
    if len(spread) == owed:
        plans.append(plan("spread", f"คืนวันละคาบ · {owed} วัน", spread))

    # Best fit first, soonest finish as the tie-break.
    plans.sort(key=lambda p: (-p["score"], max(c["date"] for c in p["slots"])))
    # One of each shape first, so the teacher sees genuinely different routes
    # rather than six variations of the same one.
    picked, kinds = [], set()
    for p in plans:
        if p["kind"] not in kinds:
            picked.append(p); kinds.add(p["kind"])
    for p in plans:
        if len(picked) >= max_plans:
            break
        if p not in picked:
            picked.append(p)
    return picked[:max_plans]


def cover_candidates_for_block(lessons: list[dict], on_date: str,
                               limit: int = 12) -> list[dict]:
    """Teachers free for EVERY lesson in a block — a คาบคู่ handed over whole.

    A teacher free for the first period of a double and busy for the second is
    no use at all, so the block is judged together rather than one period at a
    time. The fit shown is the weakest of the periods, for the same reason.
    """
    if not lessons:
        return []
    busy = busy_map(on_date)
    day = weekday_of(on_date)
    base = cover_candidates(lessons[0], on_date, limit=200)
    out = []
    for c in base:
        tid = c["teacher_id"]
        ok, worst, why = True, c["score"], c["reason"]
        for l in lessons[1:]:
            if not is_free(tid, l["group_id"], l["period"], busy):
                ok = False
                break
            t = _lookup("teachers_by_id").get(tid, {})
            p = _t("teacher_prefs")(t)
            if day in p["days_off"] or l["period"] in p["avoid_periods"]:
                ok = False
                break
            sc, w = match_level(tid, l.get("subject_id"), l["group_id"])
            if sc < worst:
                worst, why = sc, w
        if ok:
            out.append({**c, "score": worst, "reason": why})
    out.sort(key=lambda c: (-c["score"], c["load_that_day"], c["teacher_name"] or ""))
    return out[:limit]


def swap_routes(lesson: dict, on_date: str, absent_tid: int,
                owed: int = 1, limit: int = 6,
                block: list[dict] | None = None) -> list[dict]:
    """Who could take this lesson AND be paid back, with the plans for doing it."""
    routes = []
    base = (cover_candidates_for_block(block, on_date, limit=limit * 3)
            if block and len(block) > 1
            else cover_candidates(lesson, on_date, limit=limit * 3))
    for cand in base:
        plans = repayment_plans(absent_tid, cand["teacher_id"], owed, on_date)
        if not plans:
            continue            # no way to settle up — not a swap, only a cover
        routes.append({**cand, "owed": owed, "plans": plans})
        if len(routes) >= limit:
            break
    return routes


# ── บัญชีคาบที่ติดกันอยู่ ────────────────────────────────────────────────────

def ledger() -> list[dict]:
    """Who owes whom, in periods, after everything paid back is deducted."""
    owed: dict[tuple[int, int], int] = {}
    for r in _t("substitutions")():
        if r.get("status") == "cancelled" or not r.get("creates_debt"):
            continue
        key = (r["absent_teacher_id"], r["cover_teacher_id"])
        owed[key] = owed.get(key, 0) + 1
    for r in _t("repayments")():
        if r.get("status") == "cancelled":
            continue
        key = (r["teacher_id"], r["to_teacher_id"])
        owed[key] = owed.get(key, 0) - 1

    names = _lookup("teachers_by_id")
    out = []
    for (debtor, creditor), n in owed.items():
        if n == 0:
            continue
        out.append({
            "debtor_id": debtor, "debtor_name": names.get(debtor, {}).get("name"),
            "creditor_id": creditor, "creditor_name": names.get(creditor, {}).get("name"),
            "periods": n,
        })
    out.sort(key=lambda r: -abs(r["periods"]))
    return out
