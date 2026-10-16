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
    """An id as a client may send it (a number or a string), or None if blank.

    0 counts as blank: ids start at 1, and a form that clears a dropdown sends 0
    or "" as often as null."""
    try:
        return int(value) or None
    except (TypeError, ValueError, OverflowError):
        return None


# ── แถวของหลักสูตร ────────────────────────────────────────────────────────────

def _count(value: Any) -> int:
    """A weekly count as a whole number of periods, never below zero.

    Anything that is not a number is 0 rather than an error: a half-typed cell
    in the grid should not take the whole save down with it, and 0 periods is
    what an empty cell means anyway.
    """
    try:
        return max(0, int(value))
    except (TypeError, ValueError, OverflowError):
        return 0


def normalise_rows(rows: list[dict] | None) -> list[dict]:
    """The rows a curriculum is allowed to hold.

    Only the subject and the count survive — see the module note on why. A row
    with no subject is dropped, because it names nothing to check. The same
    subject twice in one curriculum becomes one row that keeps the LARGER
    count: two entries are most likely a re-pasted line, and silently adding
    them would turn 2 + 2 into a 4-period subject nobody asked for.
    """
    merged: dict[int, int] = {}
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("subject_id"):
            continue
        sid = _id(row["subject_id"])
        if sid is None:
            continue
        n = _count(row.get("weekly_count"))
        merged[sid] = max(n, merged.get(sid, 0))
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
