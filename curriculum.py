# -*- coding: utf-8 -*-
"""หลักสูตร — which subjects a class may take, and how many periods a week.

The staffing sheet says who teaches what to which class. It does not say what
the class is SUPPOSED to be taught, and the two drift apart quietly: a subject
gets assigned to a class that never takes it, or a required one is forgotten
until the timetable is already printed. A หลักสูตร is the reference the
assignments are checked against.

It is deliberately small. A row is a subject and a weekly count, nothing else.
How long a lesson runs, how many credits it carries, which room it needs and
which department owns it are all properties of the SUBJECT, so a curriculum
that copied them would hold a second opinion that goes stale the first time
someone edits the subject. The row points at the subject and lets the subject
answer.

A class is attached to a curriculum by `curriculum_id` on the class itself.
Two rules follow from that and the rest of the module depends on them:

  - A class with no curriculum_id is never checked against anything. Having no
    curriculum is "not yet decided", not "takes no subjects".
  - There is NO inheritance. A subgroup (ม.4/6ก) does not borrow its parent's
    curriculum, because a subgroup is exactly the case where students take
    different things. If it should follow a curriculum, say so on the subgroup.
"""
from __future__ import annotations

import re
from typing import Any

# Bound to the live data by mock_api at import time, so this module can be read
# and tested on its own — the same shape substitution.py uses.
DATA: dict[str, Any] = {}


def bind(**tables: Any) -> None:
    """Point this module at the live tables."""
    DATA.update(tables)


def _t(name: str):
    return DATA[name]


def _id(value: Any) -> int | None:
    """The curriculum a class points at, as stored on the class, or None if blank.

    This reads a pointer that may have arrived through any edit of the class, so
    it is forgiving: a number or a string, and 0 or "" meaning "none" (a form
    that clears a dropdown sends those as often as null). Rows are different —
    see _subject_id, which refuses what it cannot read."""
    try:
        return int(value) or None
    except (TypeError, ValueError, OverflowError):
        return None


# ── แถวของหลักสูตร ────────────────────────────────────────────────────────────
# Input that cannot be read is an error here, never a quiet 0 or a guessed id.
# A 0-period row means "this subject may not be taught to this class", so a
# client that forgot to send a count must not be able to ban a subject by
# accident; and a wrong subject id is worse than a missing row. These raise
# ValueError with a Thai message, which the endpoints turn into a 400 — this
# module stays free of the web framework, as substitution.py does.

def _subject_id(value: Any) -> int:
    """A subject id: an int, or a string of digits. Not a float, not a bool.

    True is an int in Python and would silently become subject 1; 5.7 would
    become subject 5. Both are a different subject, not a dropped row."""
    if isinstance(value, bool):
        raise ValueError("รหัสวิชาต้องเป็นจำนวนเต็ม")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            pass
    raise ValueError("รหัสวิชาต้องเป็นจำนวนเต็ม")


def _count(value: Any) -> int:
    """A weekly count: a number or numeric string, as whole periods, never below 0.

    The one place a negative count is clamped. 2.9 and "2.9" both mean 2."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("จำนวนคาบต้องเป็นตัวเลข")
    try:
        n = value if isinstance(value, int) else int(float(value))
    except (ValueError, OverflowError):          # "abc", "", nan, inf
        raise ValueError("จำนวนคาบต้องเป็นตัวเลข") from None
    return max(0, n)


def _read_rows(rows: list[dict]) -> list[tuple[int, int, int]]:
    """Every row that names a subject, as (position, subject_id, weekly_count).

    The one place a row is read: what counts as a blank line, what is refused,
    and what an error says. `position` is the row's own 1-based place in the
    list that was given, which is the number the error quotes ("แถวที่ N"), so a
    caller that wants to point at a row can hand the list over unshortened. How
    two rows for one subject combine is the caller's decision, not made here —
    see normalise_rows and _plan_rows, which answer it differently on purpose.
    """
    if not isinstance(rows, list):
        raise ValueError("แถวหลักสูตรต้องเป็นรายการ")
    out = []
    for pos, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"แถวที่ {pos}: แต่ละแถวต้องเป็นข้อมูลที่ระบุรหัสวิชาและจำนวนคาบ")
        if not row.get("subject_id"):
            continue
        try:
            sid = _subject_id(row["subject_id"])
            if not sid:                          # "0": a subject that is not one
                continue
            n = _count(row.get("weekly_count"))
        except ValueError as exc:
            raise ValueError(f"แถวที่ {pos}: {exc}") from None
        out.append((pos, sid, n))
    return out


def normalise_rows(rows: list[dict]) -> list[dict]:
    """The rows a curriculum is allowed to hold.

    Only the subject and the count survive — see the module note on why. A row
    with no subject is dropped, because it names nothing to check (and so is
    not read any further: an empty grid line may well have an empty count). The
    same subject twice in one curriculum becomes one row that keeps the LARGER
    count: two entries are most likely a re-pasted line, and silently adding
    them would turn 2 + 2 into a 4-period subject nobody asked for. A count of 0
    is kept as a row; it is a real answer, not a missing one.

    `rows` must be a list, and every item in it a dict. Anything else raises
    rather than reading as "no rows", which would let one malformed call empty
    a curriculum that classes use. A dict that names no subject is a blank line
    in the grid and is dropped; an item that is not a dict at all is not a line
    in the grid, so it is an error, not a row to drop.
    """
    merged: dict[int, int] = {}
    for _pos, sid, n in _read_rows(rows):
        # MAX, because this is a person typing the same subject twice into one
        # curriculum form, where the forgiving reading is "they meant it once".
        # Plan rows read from the teaching plan are NOT merged this way: two
        # plan rows are two separate sets of periods and add up (_plan_rows).
        # Different input, different rule — do not make one match the other.
        prev = merged.get(sid)
        merged[sid] = n if prev is None else max(n, prev)
    return [{"subject_id": sid, "weekly_count": n} for sid, n in merged.items()]


# ── ห้องไหนใช้หลักสูตรไหน ──────────────────────────────────────────────────────

def groups_by_curriculum() -> dict[int, list[dict]]:
    """Every LIVE class, filed under the curriculum it points at.

    Walks the classes that exist rather than collecting ids written somewhere,
    so a deleted class cannot be counted as still attached: it is simply not in
    the list being walked. A class pointing at a curriculum that no longer
    exists is filed under that dead id and nobody asks for it.
    """
    out: dict[int, list[dict]] = {}
    for g in _t("groups_by_id")().values():
        cid = _id(g.get("curriculum_id"))
        if cid is not None:
            out.setdefault(cid, []).append(g)
    return out


def plan_for(group_id: int) -> dict | None:
    """The curriculum this class follows, or None if it follows none.

    None means "do not check this class", so every way of not having a
    curriculum has to land here: no such class, no curriculum_id, or one that
    points at a curriculum that has been deleted. There is no walk up to the
    parent. The returned dict is the live one; callers read it, they do not
    edit it.
    """
    group = _t("groups_by_id")().get(group_id)
    cid = _id(group.get("curriculum_id")) if group else None
    if cid is None:
        return None
    return next((c for c in _t("curricula")() if c["id"] == cid), None)


def _group_id(value: Any) -> int:
    """A class id from a request: an int, or a string of digits. Not a float, not a bool.

    Strict for the same reason _subject_id is: True would quietly become class 1."""
    if isinstance(value, bool):
        raise ValueError("รหัสห้องต้องเป็นจำนวนเต็ม")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            pass
    raise ValueError("รหัสห้องต้องเป็นจำนวนเต็ม")


def attach(cid: int, group_ids: Any) -> dict[str, list[int]]:
    """Make exactly these classes follow curriculum `cid`.

    The list is the whole answer, not an addition to it: a class that follows
    this curriculum and is not in the list is let go (its curriculum_id becomes
    None, so it is no longer checked against anything). Classes of OTHER
    curricula are not touched unless they are named, in which case they move
    here — a class follows one curriculum. Only `curriculum_id` is written; the
    teaching plan is never read or changed.

    Everything is checked before anything is written. A list that cannot be
    read, an id that is not a class (including one that was deleted), or a
    curriculum that does not exist raises ValueError and leaves every class as
    it was; a half-applied list would have let go of classes the person never
    meant to touch.

    Returns what changed: `attached` (classes that now follow it and did not
    before, in the order asked) and `detached`. A class already following it is
    in neither, and a request that changes nothing returns both empty.
    """
    if not any(c["id"] == cid for c in _t("curricula")()):
        raise ValueError("ไม่พบหลักสูตรนี้")
    if not isinstance(group_ids, list):
        raise ValueError("รายการห้องต้องเป็นรายการของรหัสห้อง")
    groups = _t("groups_by_id")()
    wanted: list[int] = []
    for raw in group_ids:
        gid = _group_id(raw)
        if gid not in groups:
            raise ValueError(f"ไม่พบห้องรหัส {gid}")
        if gid not in wanted:                # the same class twice is one class
            wanted.append(gid)
    keep = set(wanted)
    # Found through the live classes, so a deleted class is not "let go" and a
    # pointer stored as a string by an old form or backup is still found.
    letting_go = [g for g in groups_by_curriculum().get(cid, []) if g["id"] not in keep]
    joining = [gid for gid in wanted if _id(groups[gid].get("curriculum_id")) != cid]
    for g in letting_go:
        g["curriculum_id"] = None
    for gid in joining:
        groups[gid]["curriculum_id"] = cid
    return {"attached": joining, "detached": [g["id"] for g in letting_go]}


# ── สร้างหลักสูตรจากแผนการสอนที่กรอกไว้แล้ว ───────────────────────────────────────
# The school has already typed in what each class is taught. A curriculum read
# back out of that is a starting point they can correct, not a second round of
# typing; and where many classes were typed the same, it is one curriculum
# instead of thirty copies of it.

def _label(value: Any) -> str:
    """A level or plan as text for comparing and naming: blank and None are the same."""
    return str(value or "").strip()


_LEVEL = re.compile(r"M([0-9]+)")


def _level_label(level: str) -> str:
    """A level as the school writes it: "M4" -> "ม.4".

    The data holds the level as "M4" while every class's own name is "ม.4/1",
    and the proposal names are the first thing the school reads. Only an M and
    plain digits are rewritten; anything else ("ห้องเวียน", "T9", "") is left as
    it was rather than guessed at."""
    m = _LEVEL.fullmatch(level)
    return f"ม.{m.group(1)}" if m else level


def _plan_by_subject(group: dict, reqs: list[dict]) -> dict[int, dict]:
    """One class's teaching plan, subject by subject: `{subject_id: {"count", "rows"}}`.

    `count` is the periods a week the plan gives the subject and `rows` are the
    plan rows that make it up (the ones that teach something), so a caller can
    ask both "how many?" and "what kind of row is it?" of the SAME reading.
    This is the one place a class's plan is read and totalled. _plan_rows,
    which turns it into curriculum rows for deriving, and diff, which sets it
    against a curriculum, both go through it: if they totalled differently,
    every curriculum derived from a class would read as wrong against the very
    class it was derived from.

    Reading the plan is more forgiving than reading what a person typed into
    the curriculum grid, in one way only. A plan row with no periods in it —
    0, nothing, or something that is not a number — teaches nothing and is left
    out. It must not become a 0-period curriculum row: the audit (Task 6) reads
    a 0-period row as "this subject may not be taught to this class at all", so
    a stray 0 here would silently ban a subject the plan still lists.

    Rows for ONE subject ADD UP. Two independent plan rows are two separate
    sets of periods: a subject split between two teachers at 2 periods each is
    4 periods a week, not 2. The exception is a co-teaching pair, two rows that
    name each other as the same lesson taught together; _fold_coteaching finds
    those and they count once, at the larger of the two. This deliberately
    differs from normalise_rows, which keeps the larger of a repeated subject:
    that is a person typing a subject twice on one curriculum form, where the
    forgiving reading is right. Different input, different rule — do not make
    one match the other.

    A plan row with periods but no subject id (None, 0, "", "0") is a blank line
    and is skipped without a word, as in normalise_rows. One whose id is there
    but cannot be read ("abc", 5.7, True) means the stored plan is damaged: that
    is an error naming the class and the row's own position in the plan, never a
    skipped row. (A skipped row would build a curriculum that looks complete.)

    A subject id that points at a subject which no longer exists is NOT checked
    and the row is carried into the curriculum like any other. Not dropped (that
    would hide a real data fault) and not a 400 (one bad row would block
    deriving every other class). diff reports a curriculum row whose subject is
    gone as a warning, "วิชานี้ถูกลบออกจากระบบแล้ว", and the curriculum screen
    shows it as a row to remove, which is where the school can see and fix it.
    """
    # A row with no periods is blanked, not removed, so that an error on a later
    # row still counts it: "แถวที่ N" is the row's place in the class's plan.
    shown = []
    for r in reqs:
        try:
            n = _count(r.get("weekly_count"))
        except ValueError:
            n = 0
        shown.append({"subject_id": r.get("subject_id") if n > 0 else None, "weekly_count": n})
    try:
        read = _read_rows(shown)
    except ValueError as exc:
        raise ValueError(f"ห้อง {group.get('name')}: {exc}") from None

    # `pos` is the row's ORIGINAL place in `reqs` (see _read_rows), which is what
    # makes reqs[pos - 1] the row it came from. It is also the lesson's id, so
    # the plan row can be found again from a lesson below.
    lessons = [{"id": pos, "group_id": group.get("id"), "subject_id": sid,
                "teacher_id": reqs[pos - 1].get("teacher_id"),
                "co_teacher_id": reqs[pos - 1].get("co_teacher_id"),
                "weekly_count": n} for pos, sid, n in read]
    folded, agreed = _t("fold_coteaching")(lessons)
    plan: dict[int, dict] = {}
    for lesson in lessons:
        found = plan.setdefault(lesson["subject_id"], {"count": 0, "rows": []})
        found["rows"].append(reqs[lesson["id"] - 1])
        if lesson["id"] in folded:           # the second half of a co-taught lesson
            continue
        found["count"] += agreed.get(lesson["id"], lesson["weekly_count"])
    return plan


def _plan_rows(group: dict, reqs: list[dict]) -> list[dict]:
    """The curriculum rows for one class, read from its own teaching-plan rows.

    How the plan is read and totalled (zero-period rows left out, rows for one
    subject added up, a co-teaching pair counted once) is _plan_by_subject's;
    this turns its totals into curriculum rows.
    """
    plan = _plan_by_subject(group, reqs)
    # Through normalise_rows, so what leaves here is the same fresh two-key
    # dicts every other path that writes a curriculum row produces. It merges
    # nothing: the sums are already one row per subject.
    clean = normalise_rows([{"subject_id": sid, "weekly_count": found["count"]}
                            for sid, found in plan.items()])
    return sorted(clean, key=lambda row: row["subject_id"])


def rows_from_group(group_id: int) -> list[dict]:
    """What this class is taught now, as curriculum rows. [] if it has no plan.

    Only the subject and the weekly count are taken. The teacher, the co-teacher
    and the parallel-group key belong to who teaches it, not to what the class
    should take, and the subject answers duration and credits itself."""
    group = _t("groups_by_id")().get(group_id)
    if group is None:
        return []
    return _plan_rows(group, [r for r in _t("requirements")() if r.get("group_id") == group_id])


def derive_all() -> list[dict]:
    """Every curriculum the existing teaching plans imply, one proposal each.

    Classes are grouped when they have the same level, the same plan and
    EXACTLY the same subjects at exactly the same weekly counts. Same subjects
    with one count different is a different curriculum, as is one extra subject.
    The level and plan are part of the grouping, so a proposal's name is true of
    every class in it.

    Names. A group of two or more classes is "<level> <plan>" with the level
    written the Thai way ("M4" -> "ม.4"), and when one level+plan has more than
    one such group they are numbered "(แบบ 1)", "(แบบ 2)" …, the one with the
    most classes first. A lone class is named after the class ("ม.4/6ก"): it is
    not a design several classes share, so it takes no number and does not use
    one up. `variants` describes the numbered family a proposal belongs to: on
    a multi-class group it is how many such groups the level+plan has, and on a
    lone class it is 0 — it stands alone, whatever its level+plan produced
    around it. So `variants > 0` means "one of a family", 0 means "alone".

    Only classes that follow no curriculum are looked at. A class already on a
    real curriculum has been settled by someone, and re-deriving it would
    quietly move it; pressing the button twice would make every curriculum
    twice. So the preview is exactly what pressing it will do, and after
    pressing it there is nothing left to propose. (A class whose curriculum_id
    points at a curriculum that is gone follows none — see plan_for — so it is
    looked at again.)

    A class with no plan, or only plan rows without periods, is in no proposal:
    a curriculum with no subjects would say nothing, and an empty one is how a
    class ends up allowed nothing. Rows are fresh copies; nothing here is
    shared with the stored tables.
    """
    groups = _t("groups_by_id")()
    plans: dict[int, list[dict]] = {}
    for r in _t("requirements")():
        gid = r.get("group_id")
        if gid in groups:                    # a row for a class that is gone is nobody's plan
            plans.setdefault(gid, []).append(r)

    pairs: dict[tuple[str, str], dict[frozenset, dict]] = {}
    for gid in sorted(plans):
        if plan_for(gid) is not None:
            continue
        group = groups[gid]
        rows = _plan_rows(group, plans[gid])
        if not rows:
            continue
        shape = frozenset((r["subject_id"], r["weekly_count"]) for r in rows)
        pair = (_label(group.get("level")), _label(group.get("plan")))
        found = pairs.setdefault(pair, {}).setdefault(shape, {"rows": rows, "group_ids": []})
        found["group_ids"].append(gid)

    out = []
    for (level, plan), clusters in sorted(pairs.items(), key=lambda kv: kv[0]):
        ordered = sorted(clusters.values(), key=lambda c: (-len(c["group_ids"]), c["group_ids"][0]))
        shared = [c for c in ordered if len(c["group_ids"]) > 1]
        base = " ".join(part for part in (_level_label(level), plan) if part) or "ไม่ระบุระดับ"
        for c in ordered:
            if len(c["group_ids"]) == 1:
                # One class is named for itself. It is not a "แบบ" of anything, so
                # it takes no number (and is not counted in `variants`).
                name = _label(groups[c["group_ids"][0]].get("name")) or base
            elif len(shared) == 1:
                name = base
            else:
                name = f"{base} (แบบ {shared.index(c) + 1})"
            out.append({
                "name": name,
                "rows": c["rows"],
                "group_ids": c["group_ids"],
                # A lone class belongs to no numbered family, so it reads 0; the
                # classes that share a design carry the level+plan's count.
                "variants": len(shared) if len(c["group_ids"]) > 1 else 0,
            })
    return out


# ── ตารางเทียบ: หลักสูตรว่าอย่างไร กับแผนการสอนมีอะไรจริง ──────────────────────────────

WHY_DELETED = "วิชานี้ถูกลบออกจากระบบแล้ว"
WHY_SET = "วิชานี้อยู่ในเซ็ตห้องย่อย จึงไม่เสนอให้ลบอัตโนมัติ — ถ้าไม่ต้องการ ให้ไปแก้ที่เซ็ตห้องย่อย"
WHY_CO = "วิชานี้มีครูสอนร่วม จึงไม่เสนอให้ลบอัตโนมัติ — ถ้าไม่ต้องการ ให้ไปแก้ที่แผนการสอน"
WHY_ELECTIVE = "วิชานี้สอนอยู่ในคาบเสรีแล้ว จึงไม่นับว่าเกิน"


def diff(group_id: int) -> dict:
    """What one class's curriculum says, set against what its teaching plan holds.

    Returns `{"curriculum", "add", "fix", "remove", "warn", "ok"}`. `curriculum`
    is `{"id", "name"}`, or None when the class follows none (see plan_for):
    such a class is never checked, so every list is empty and `ok` is 0 —
    nothing is "missing" from a class nobody has decided anything for. The four
    lists are per subject, in subject-id order, each entry
    `{"subject_id", "code", "name", "want", "have"}` (`warn` also has `why`):
    `want` is what the curriculum asks for and `have` what the plan totals, 0
    when there is no row. `ok` counts the subjects that genuinely match.

      add     the curriculum has the subject and the plan has no row for it
      fix     both have it, at different periods a week (either direction)
      remove  the plan has it and the curriculum does not
      warn    the same difference, but not ours to settle — see below

    The plan is totalled by _plan_by_subject, exactly as deriving does: a
    co-teaching pair counts once, two independent rows for one subject add up.
    A plan row with no periods teaches nothing and is not a row at all, so it
    is never "removed" and a subject that has only such rows still needs adding.

    A curriculum row of 0 periods means "this class may not take this subject"
    (normalise_rows keeps it for that reason). It is read as the subject being
    absent from the curriculum, with one difference: if the plan does not teach
    it, that counts as matching rather than as something to add. So a plan that
    does teach it is `remove`, not "fix to 0 periods", and gets the same
    protection as any other surplus below.

    Surplus is never offered for removal when removing it is not a plain edit
    of the plan. A row in a เซ็ตห้องย่อย (parallel_group_key) or with a
    co-teacher (co_teacher_id) belongs to someone else's arrangement, and a
    subject already taught inside a คาบเสรี is not extra at all. These go to
    `warn` with the reason, and a subject that is both says both. The checks
    apply only to surplus: a subject the curriculum does ask for is compared by
    count like any other, whatever kind of row holds it.

    A subject that no longer exists is only ever a warning, whichever side still
    names it (the curriculum row is stale, or the plan row is): it can be
    neither added nor trusted, and it is the one place the school learns about
    it. It is never counted as matching, even at equal periods.

    Reads only. The entries are fresh dicts; nothing here is shared with the
    stored tables. A plan row that cannot be read raises ValueError naming the
    class and the row, as deriving does — the endpoint turns it into a 400.
    """
    out: dict[str, Any] = {"curriculum": None, "add": [], "fix": [], "remove": [], "warn": [], "ok": 0}
    cur = plan_for(group_id)
    if cur is None:
        return out
    group = _t("groups_by_id")()[group_id]
    out["curriculum"] = {"id": cur["id"], "name": cur.get("name")}

    wanted = {r["subject_id"]: r["weekly_count"] for r in normalise_rows(cur.get("rows") or [])}
    held = _plan_by_subject(group, [r for r in _t("requirements")() if r.get("group_id") == group_id])
    subjects = _t("subjects_by_id")()
    served: set[int] | None = None           # worked out on first need: most classes never need it

    for sid in sorted(set(wanted) | set(held)):
        want = wanted.get(sid, 0)
        plan = held.get(sid)
        have = plan["count"] if plan else 0
        subject = subjects.get(sid)
        entry = {"subject_id": sid,
                 "code": (subject.get("code") or "") if subject else "",
                 "name": (subject.get("name") or "") if subject else "",
                 "want": want, "have": have}
        if subject is None:
            out["warn"].append({**entry, "why": WHY_DELETED})
        elif want == 0:                      # absent from the curriculum, or not allowed in it
            if plan is None:
                out["ok"] += 1               # not allowed, and not taught
                continue
            if served is None:
                served = _t("served_by_elective")()
            why = []
            if any(r.get("parallel_group_key") for r in plan["rows"]):
                why.append(WHY_SET)
            if any(r.get("co_teacher_id") for r in plan["rows"]):
                why.append(WHY_CO)
            if any(r.get("id") in served for r in plan["rows"]):
                why.append(WHY_ELECTIVE)
            if why:
                out["warn"].append({**entry, "why": " · ".join(why)})
            else:
                out["remove"].append(entry)
        elif plan is None:
            out["add"].append(entry)
        elif have != want:
            out["fix"].append(entry)
        else:
            out["ok"] += 1
    return out
