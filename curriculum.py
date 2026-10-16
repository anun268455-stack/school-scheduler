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
    if not isinstance(rows, list):
        raise ValueError("แถวหลักสูตรต้องเป็นรายการ")
    merged: dict[int, int] = {}
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


def _plan_rows(group: dict, reqs: list[dict]) -> list[dict]:
    """The curriculum rows for one class, read from its own teaching-plan rows.

    Reading the plan is more forgiving than reading what a person typed into
    the curriculum grid, in one way only. A plan row with no periods in it —
    0, nothing, or something that is not a number — teaches nothing and is left
    out. It must not become a 0-period curriculum row: the audit (Task 6) reads
    a 0-period row as "this subject may not be taught to this class at all", so
    a stray 0 here would silently ban a subject the plan still lists.
    Everything else is held to normalise_rows, which is also what
    makes two rows for one subject (a co-taught lesson is written from both
    teachers' sides) one row at the larger count, the lesson being held once.

    A subject id that cannot be read is an error naming the class, not a
    skipped row: it means the stored plan is damaged, and a curriculum built
    around the hole would look complete.
    """
    rows = []
    for r in reqs:
        try:
            n = _count(r.get("weekly_count"))
        except ValueError:
            continue
        if n > 0:
            rows.append({"subject_id": r.get("subject_id"), "weekly_count": n})
    try:
        clean = normalise_rows(rows)
    except ValueError as exc:
        raise ValueError(f"ห้อง {group.get('name')}: {exc}") from None
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
                name = str(groups[c["group_ids"][0]].get("name") or "").strip() or base
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
