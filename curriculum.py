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

    `rows` must be a list. Anything else raises rather than reading as "no
    rows", which would let a client bug empty a curriculum that classes use. A
    row that is not a dict is skipped.
    """
    if not isinstance(rows, list):
        raise ValueError("แถวหลักสูตรต้องเป็นรายการ")
    merged: dict[int, int] = {}
    for pos, row in enumerate(rows, start=1):
        if not isinstance(row, dict) or not row.get("subject_id"):
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
