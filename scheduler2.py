"""เครื่องจัดตารางตัวใหม่ — เขียนใหม่ทั้งตัว แยกจากของเดิม

    "ลองทำระบบใหม่ สูตรใหม่เพื่อปรับปรุงการลงตารางครั้งหน้า ... ลำดับการลง
     1 ลงคาบเสรี สาธารณะต่างๆ · 2 ลงคาบ ม.ต้นให้เสร็จก่อน ทุกๆ ห้องที่มี
     ห้องประจำ · 3 ลงคาบคู่ · 4 ลงคาบที่เหลือ

     ลงไปแล้วเก็บข้อมูลเอาไว้ แล้วลงใหม่ เก็บข้อมูลครั้งนั้นที่ลง เก็บเรื่อยๆ
     หาทางลงไปเรื่อยๆ แล้วสรุปออกมาได้คาบที่ลงตัว เหมือนเวลาหาทางออกจาก
     เขาวงกต พอลงได้แล้วก็ค่อยลบข้อมูลเพื่อไม่ให้พื้นที่เยอะไป"

ของเดิม (_solve_greedy) ลงทีละคาบตามลำดับที่คิดไว้ล่วงหน้า เจอทางตันก็ข้ามไป
คาบนั้นจึงไม่ได้ลง ตัวนี้ทำคนละอย่างสองเรื่อง

  1. **ถอยหลังได้** เจอทางตันแล้วย้อนกลับไปแยกก่อนหน้า ไม่ใช่ทิ้งคาบนั้นไป
  2. **จำว่าทางไหนเคยตัน** จึงไม่เดินซ้ำทางเดิมในรอบถัดไป

และเปลี่ยนวิธีแจกห้องจาก "หยิบห้องว่างที่ดูดีที่สุด" เป็น **จับคู่ให้ได้มาก
ที่สุดในแต่ละชั่วโมง** ซึ่งตอบได้แน่นอนว่าชั่วโมงนั้นแจกห้องได้มากสุดเท่าไร
ไม่ใช่เดาแล้วหวัง

ไฟล์นี้ไม่ยุ่งกับข้อมูลจริงเลยสักบรรทัด — รับสำเนาเข้ามา คืนตารางที่เสนอออกไป
ใครจะเอาไปใช้ค่อยสั่งอีกที ("ตอนนี้คาบโอเคแล้ว ห้ามยุ่ง")
"""
from __future__ import annotations

import random
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

# ── เพดานของที่จำไว้ ────────────────────────────────────────────────────────
#
# "พอลงได้แล้วก็ค่อยลบข้อมูลเพื่อไม่ให้พื้นที่เยอะไป"
#
# จำทางตันช่วยไม่ให้เดินซ้ำ แต่ถ้าจำไม่จำกัด บนตารางจริงหน่วยความจำจะบานโดยที่
# ทางตันเก่า ๆ แทบไม่ถูกถามถึงอีก จึงจำแบบมีเพดาน ทิ้งของเก่าที่สุดเมื่อเต็ม
# และล้างทั้งหมดเมื่อหาคำตอบเจอ
NOGOOD_LIMIT = 150_000

# ลำดับการลงที่โรงเรียนสั่ง
PHASE_SHARED = 0   # คาบเสรี · สาธารณะ · กิจกรรมที่หลายห้องเรียนร่วมกัน
PHASE_LOWER  = 1   # ม.ต้นที่มีห้องประจำ — ให้เสร็จก่อน
PHASE_DOUBLE = 2   # คาบคู่
PHASE_REST   = 3   # ที่เหลือ

PHASE_NAME = {
    PHASE_SHARED: "คาบเสรี/สาธารณะ",
    PHASE_LOWER:  "ม.ต้นที่มีห้องประจำ",
    PHASE_DOUBLE: "คาบคู่",
    PHASE_REST:   "ที่เหลือ",
}

DAYS = 5


@dataclass
class Unit:
    """หนึ่งสิ่งที่ต้องหาที่ให้ — ลงทั้งก้อนหรือไม่ลงเลย

    คาบคู่เป็นหน่วยเดียวที่ยาวสองชั่วโมง ไม่ใช่สองหน่วย จึงไม่มีทางที่ครึ่งหนึ่ง
    ลงได้แล้วอีกครึ่งค้าง ซึ่งเป็นอาการที่โรงเรียนเจอมาตลอด ("คาบคู่ มีคาบที่
    คู่กันที่หายไป")
    """
    uid:         int
    group_ids:   tuple[int, ...]
    teacher_ids: tuple[int, ...]
    subject_id:  int | None
    req_id:      int | None
    length:      int
    level:       str
    phase:       int
    label:       str
    needs_room:  bool = True
    is_elective: bool = False
    double_key:  str | None = None
    shared_key:  str | None = None


@dataclass
class World:
    """ข้อมูลโรงเรียนที่เครื่องนี้ต้องใช้ — สำเนาทั้งหมด ไม่ใช่ของจริง"""
    units:        list[Unit]
    cells_for:    dict[str, list[tuple[int, int]]]   # level -> [(วัน, คาบ)]
    period_index: dict[str, dict[int, int]]          # level -> {คาบ: ลำดับที่}
    teacher_off:  dict[int, set[int]]                # ครู -> วันที่ไม่มาสอน
    subject_off:  dict[int, set[int]]                # วิชา -> วันที่ห้ามเรียน
    fixed:        dict[int, tuple[int, int]]         # uid -> ช่องที่ตรึงไว้


# ── สร้างหน่วยจากแผนการสอน ─────────────────────────────────────────────────

def _level_of(group: dict[str, Any]) -> str:
    return "upper" if (group.get("level") or "") in ("M4", "M5", "M6") else "lower"


def build_world(
    requirements: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    subjects: list[dict[str, Any]],
    teachers: list[dict[str, Any]],
    periods: list[dict[str, Any]],
    elective_pools: list[dict[str, Any]] | None = None,
    activities: list[dict[str, Any]] | None = None,
) -> World:
    """แปลงแผนการสอนเป็นหน่วยที่ต้องลง

    สามอย่างนี้มาคนละทาง และถ้าเอามารวมกันผิดจะจำลองโรงเรียนผิดทันที

      กิจกรรม   ไม่ได้อยู่ในแผนการสอนเลย เป็นหน้าต่างเดียวครอบ 38–78 ห้องพร้อม
                กัน (ชุมนุม · คุณธรรม · ลส.นน.ยว. · สาธารณประโยชน์)
      วิชาเสรี  มาจาก elective_pools หนึ่งหน้าต่างใช้ร่วมกัน 6–10 ห้อง และครู
                ทุกคนในหน้าต่างสอนพร้อมกัน — ถ้าไปอ่านจากแถวกำหนดการสอนทีละห้อง
                จะได้ครูที่ต้องสอน 70 คาบ/สัปดาห์ ทั้งที่ของจริงมากสุด 22
      ที่เหลือ  แถวกำหนดการสอนปกติ โดยตัดวิชาที่เป็นตัวเลือกของวิชาเสรีออก
                เพราะมันคือเมนูในหน้าต่าง ไม่ใช่คาบของตัวเอง
    """
    g_map = {g["id"]: g for g in groups}
    s_map = {s["id"]: s for s in subjects}
    t_map = {t["id"]: t for t in teachers}

    cells_for: dict[str, list[tuple[int, int]]] = {}
    period_index: dict[str, dict[int, int]] = {}
    for level in ("lower", "upper"):
        nums = sorted({p["period_num"] for p in periods
                       if p.get("type") == "class"
                       and (p.get("applies_to") or "all") in ("all", level)})
        period_index[level] = {n: i for i, n in enumerate(nums)}
        cells_for[level] = [(d, n) for d in range(DAYS) for n in nums]

    teacher_off: dict[int, set[int]] = {}
    for t in teachers:
        off = t.get("days_off") or t.get("day_off") or []
        if isinstance(off, int):
            off = [off]
        teacher_off[t["id"]] = {int(x) for x in off if x is not None}

    subject_off: dict[int, set[int]] = {}
    for s in subjects:
        off = s.get("blocked_days") or []
        if isinstance(off, int):
            off = [off]
        subject_off[s["id"]] = {int(x) for x in off if x is not None}

    units: list[Unit] = []
    fixed: dict[int, tuple[int, int]] = {}
    uid = 0

    # ── 1. กิจกรรม — หน้าต่างเดียวครอบหลายสิบห้อง ──────────────────────
    for a in (activities or []):
        gids = tuple(sorted(a.get("group_ids") or ()))
        if not gids:
            continue
        tids = tuple(sorted({t for t in (a.get("teacher_ids") or ()) if t}))
        lv = _level_of(g_map.get(gids[0], {}))
        units.append(Unit(
            uid=uid, group_ids=gids, teacher_ids=tids,
            subject_id=a.get("subject_id"), req_id=None,
            length=int(a.get("length") or 1), level=lv, phase=PHASE_SHARED,
            label=f"{a.get('name') or 'กิจกรรม'} ({len(gids)} ห้อง)",
            needs_room=False, shared_key=f"ACT:{a.get('key') or a.get('name')}",
        ))
        if a.get("day") is not None and a.get("period") is not None:
            fixed[uid] = (int(a["day"]), int(a["period"]))
        uid += 1

    # ── 2. วิชาเสรี — หนึ่งหน้าต่าง หลายห้อง ครูทุกคนในเมนูสอนพร้อมกัน ──
    elective_subject_ids: set[int] = set()
    for pool in (elective_pools or []):
        gids = tuple(sorted(pool.get("group_ids") or ()))
        opts = pool.get("options") or []
        for o in opts:
            if o.get("subject_id"):
                elective_subject_ids.add(o["subject_id"])
        if not gids:
            continue
        tids = tuple(sorted({o["teacher_id"] for o in opts if o.get("teacher_id")}))
        lv = _level_of(g_map.get(gids[0], {}))
        weekly = int(pool.get("weekly") or 0)
        length = 2 if pool.get("is_double") else 1
        for _ in range(max(1, weekly // length) if weekly else 0):
            units.append(Unit(
                uid=uid, group_ids=gids, teacher_ids=tids,
                subject_id=None, req_id=None, length=length, level=lv,
                phase=PHASE_SHARED,
                label=f"{pool.get('name') or 'วิชาเสรี'} ({len(gids)} ห้อง)",
                needs_room=False, is_elective=True,
                shared_key=f"EL:{pool.get('id')}",
            ))
            uid += 1

    # ── 3. ที่เหลือ — แถวกำหนดการสอนปกติ ────────────────────────────────
    # ห้องย่อยที่เรียนพร้อมกัน (เซ็ต ก/ข/ค) รวมเป็นหน่วยเดียว
    sets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    plain: list[dict[str, Any]] = []
    for r in requirements:
        if r.get("subject_id") in elective_subject_ids:
            continue                      # เมนูของวิชาเสรี ไม่ใช่คาบของตัวเอง
        key = r.get("parallel_group_key")
        if key:
            sets[str(key)].append(r)
        else:
            plain.append(r)

    for key, rows in sets.items():
        gids = tuple(sorted({r["group_id"] for r in rows}))
        tids = tuple(sorted({t for r in rows
                             for t in (r.get("teacher_id"), r.get("co_teacher_id"))
                             if t and t in t_map}))
        want = max((r.get("weekly_count") or 0) for r in rows)
        lv = _level_of(g_map.get(gids[0], {})) if gids else "lower"
        for _ in range(want):
            units.append(Unit(
                uid=uid, group_ids=gids, teacher_ids=tids,
                subject_id=rows[0].get("subject_id"), req_id=rows[0].get("id"),
                length=1, level=lv, phase=PHASE_SHARED,
                label=f"เซ็ต {key} ({len(gids)} ห้อง)",
                shared_key=f"SET:{key}",
            ))
            uid += 1

    for r in plain:
        grp = g_map.get(r["group_id"]) or {}
        sub = s_map.get(r.get("subject_id")) or {}
        lv = _level_of(grp)
        tids = tuple(x for x in (r.get("teacher_id"), r.get("co_teacher_id"))
                     if x and x in t_map)
        want = r.get("weekly_count") or 0
        double = int(sub.get("duration") or 1) == 2
        has_home = grp.get("homeroom_room_id") is not None
        # ลำดับที่โรงเรียนสั่ง: ม.ต้นที่มีห้องประจำมาก่อนคาบคู่
        if lv == "lower" and has_home:
            phase = PHASE_LOWER
        elif double:
            phase = PHASE_DOUBLE
        else:
            phase = PHASE_REST
        made = 0
        for _ in range(want // 2 if double else 0):
            units.append(Unit(
                uid=uid, group_ids=(r["group_id"],), teacher_ids=tids,
                subject_id=r.get("subject_id"), req_id=r.get("id"),
                length=2, level=lv, phase=phase,
                label=f"{grp.get('name')} {sub.get('code')}",
                double_key=f"D{uid}",
            ))
            uid += 1
            made += 2
        for _ in range(want - made):
            units.append(Unit(
                uid=uid, group_ids=(r["group_id"],), teacher_ids=tids,
                subject_id=r.get("subject_id"), req_id=r.get("id"),
                length=1, level=lv, phase=phase,
                label=f"{grp.get('name')} {sub.get('code')}",
            ))
            uid += 1
        if (r.get("pinned_day") is not None and r.get("pinned_period") is not None
                and units):
            fixed[units[-1].uid] = (int(r["pinned_day"]), int(r["pinned_period"]))

    return World(units=units, cells_for=cells_for, period_index=period_index,
                 teacher_off=teacher_off, subject_off=subject_off, fixed=fixed)


# ── ตารางระหว่างค้นหา ──────────────────────────────────────────────────────

class Board:
    """ใครอยู่ตรงไหนแล้วบ้าง — ตอบว่า "ลงตรงนี้ได้ไหม" ให้เร็วที่สุด"""

    __slots__ = ("group_at", "teacher_at", "placed")

    def __init__(self) -> None:
        self.group_at: dict[tuple[int, int, int], int] = {}     # (ชั้น,วัน,คาบ) -> uid
        self.teacher_at: dict[tuple[int, int, int], int] = {}   # (ครู,วัน,คาบ) -> uid
        self.placed: dict[int, tuple[int, int]] = {}            # uid -> (วัน,คาบ)

    def fits(self, u: Unit, day: int, period: int, world: World) -> bool:
        idx = world.period_index[u.level]
        i = idx.get(period)
        if i is None:
            return False
        if u.length == 2 and i + 1 >= len(idx):
            return False
        nums = [period]
        if u.length == 2:
            nums.append(next(n for n, j in idx.items() if j == i + 1))
        for t in u.teacher_ids:
            if day in world.teacher_off.get(t, ()):
                return False
        if u.subject_id is not None and day in world.subject_off.get(u.subject_id, ()):
            return False
        for n in nums:
            for g in u.group_ids:
                if (g, day, n) in self.group_at:
                    return False
            for t in u.teacher_ids:
                if (t, day, n) in self.teacher_at:
                    return False
        return True

    def put(self, u: Unit, day: int, period: int, world: World) -> None:
        for n in self._nums(u, period, world):
            for g in u.group_ids:
                self.group_at[(g, day, n)] = u.uid
            for t in u.teacher_ids:
                self.teacher_at[(t, day, n)] = u.uid
        self.placed[u.uid] = (day, period)

    def take(self, u: Unit, world: World) -> None:
        day, period = self.placed.pop(u.uid)
        for n in self._nums(u, period, world):
            for g in u.group_ids:
                self.group_at.pop((g, day, n), None)
            for t in u.teacher_ids:
                self.teacher_at.pop((t, day, n), None)

    @staticmethod
    def _nums(u: Unit, period: int, world: World) -> list[int]:
        idx = world.period_index[u.level]
        i = idx[period]
        out = [period]
        if u.length == 2:
            out.append(next(n for n, j in idx.items() if j == i + 1))
        return out


# ── การค้นหา ───────────────────────────────────────────────────────────────

@dataclass
class Result:
    placed:   dict[int, tuple[int, int]]
    unplaced: list[int]
    restarts: int
    seconds:  float
    nogoods:  int
    note:     str = ""


class Search:
    """เดินหาทางลงให้ครบ ถอยหลังได้ และจำทางตันไว้

    ทางตันที่จำคือ "หน่วยนี้ ลงช่องนี้ ตอนที่ของพวกนี้อยู่ที่เดิม แล้วไปต่อ
    ไม่ได้" ซึ่งเล็กกว่าการจำทั้งหน้าตารางมาก และใช้ซ้ำได้ข้ามรอบ
    """

    def __init__(self, world: World, seed: int = 0) -> None:
        self.world = world
        self.rng = random.Random(seed)
        self.nogood: set[tuple] = set()
        self.nogood_order: list[tuple] = []

    # -- จำทางตัน --------------------------------------------------------
    def _remember(self, key: tuple) -> None:
        if key in self.nogood:
            return
        self.nogood.add(key)
        self.nogood_order.append(key)
        if len(self.nogood_order) > NOGOOD_LIMIT:
            old = self.nogood_order.pop(0)
            self.nogood.discard(old)

    def forget_all(self) -> None:
        """ล้างของที่จำไว้ — เรียกเมื่อหาคำตอบเจอแล้ว"""
        self.nogood.clear()
        self.nogood_order.clear()

    # -- ช่องที่ลงได้ ----------------------------------------------------
    def options(self, u: Unit, board: Board) -> list[tuple[int, int]]:
        fixed = self.world.fixed.get(u.uid)
        if fixed is not None:
            return [fixed] if board.fits(u, fixed[0], fixed[1], self.world) else []
        return [c for c in self.world.cells_for[u.level]
                if board.fits(u, c[0], c[1], self.world)]

    def _order(self, units: list[Unit], board: Board) -> list[Unit]:
        """ลำดับที่โรงเรียนสั่งก่อน แล้วที่คับที่สุดก่อนภายในลำดับเดียวกัน"""
        def key(u: Unit) -> tuple:
            return (u.phase, len(self.options(u, board)),
                    -u.length, self.rng.random())
        return sorted(units, key=key)

    # -- เดินหา ----------------------------------------------------------
    def run(self, deadline: float) -> Result:
        t0 = time.time()
        world = self.world
        best: dict[int, tuple[int, int]] = {}
        best_missing = len(world.units) + 1
        restarts = 0

        while time.time() < deadline:
            restarts += 1
            board = Board()
            todo = self._order(world.units, board)
            missing = self._descend(board, todo, deadline)
            if len(board.placed) > len(best):
                best = dict(board.placed)
                best_missing = len(missing)
            if not missing:
                self.forget_all()
                return Result(placed=best, unplaced=[], restarts=restarts,
                              seconds=time.time() - t0, nogoods=0,
                              note="ลงได้ครบทุกคาบ")
        return Result(placed=best, unplaced=[u.uid for u in world.units
                                             if u.uid not in best],
                      restarts=restarts, seconds=time.time() - t0,
                      nogoods=len(self.nogood),
                      note=f"ดีที่สุดที่หาได้ — ยังเหลือ {best_missing} หน่วย")

    def _descend(self, board: Board, todo: list[Unit], deadline: float) -> list[Unit]:
        """ลงให้ได้มากที่สุด ถอยหลังเมื่อตัน — คืนหน่วยที่ยังลงไม่ได้

        ใช้คิว ไม่ใช่การไล่ดัชนี เพราะหน่วยที่ถูกถอยออกต้องกลับเข้าคิวไปหาที่
        ใหม่ ถ้าเดินด้วยดัชนีแล้วถอยคนที่อยู่ข้างหลังออก คนนั้นจะไม่มีวันถูก
        เรียกอีกเลย (รอบแรกเป็นแบบนั้น: บอกว่าครบทั้งที่หายไป 84 หน่วย)
        """
        world = self.world
        by_uid = {u.uid: u for u in todo}
        queue: deque[Unit] = deque(todo)
        tries: dict[int, int] = defaultdict(int)
        missing: list[Unit] = []
        # กันการถอยไปถอยมาไม่จบ — หน่วยหนึ่งขอถอยคนอื่นได้จำกัดครั้ง
        RETRY = 6
        while queue:
            if time.time() > deadline:
                missing.extend(queue)
                break
            u = queue.popleft()
            if u.uid in board.placed:
                continue
            opts = self.options(u, board)
            self.rng.shuffle(opts)
            # ช่องที่ปิดทางคนอื่นน้อยที่สุดก่อน
            opts.sort(key=lambda c: self._damage(u, c, board))
            chosen = None
            for cell in opts:
                if (u.uid, cell) in self.nogood:
                    continue
                chosen = cell
                break
            if chosen is not None:
                board.put(u, chosen[0], chosen[1], world)
                continue
            # ตัน — ถอยคนที่ขวางอยู่ออกหนึ่งคน แล้วทั้งคู่กลับเข้าคิว
            if tries[u.uid] < RETRY:
                victim = self._backtrack(board, u, by_uid)
                if victim is not None:
                    tries[u.uid] += 1
                    queue.appendleft(u)
                    queue.append(victim)
                    continue
            missing.append(u)
        return missing

    def _damage(self, u: Unit, cell: tuple[int, int], board: Board) -> int:
        """ลงตรงนี้แล้วปิดทางคนอื่นไปกี่ทาง — ยิ่งน้อยยิ่งดี"""
        day, period = cell
        n = 0
        for t in u.teacher_ids:
            n += sum(1 for d in range(DAYS) if (t, d, period) in board.teacher_at)
        for g in u.group_ids:
            n += sum(1 for d in range(DAYS) if (g, d, period) in board.group_at)
        return n

    def _backtrack(self, board: Board, stuck: Unit,
                   by_uid: dict[int, Unit]) -> Unit | None:
        """ถอยหน่วยที่ขวาง stuck ออกหนึ่งหน่วย แล้วจำว่าช่องนั้นของมันตัน

        คืนหน่วยที่ถูกถอย เพื่อให้ผู้เรียกเอากลับเข้าคิวไปหาที่ใหม่
        """
        world = self.world
        blockers: set[int] = set()
        for day, period in world.cells_for[stuck.level]:
            for g in stuck.group_ids:
                uid = board.group_at.get((g, day, period))
                if uid is not None:
                    blockers.add(uid)
            for t in stuck.teacher_ids:
                uid = board.teacher_at.get((t, day, period))
                if uid is not None:
                    blockers.add(uid)
        movable = [uid for uid in blockers
                   if uid in by_uid and uid in board.placed
                   and uid not in world.fixed]
        if not movable:
            return None
        victim_uid = self.rng.choice(movable)
        victim = by_uid[victim_uid]
        self._remember((victim_uid, board.placed[victim_uid]))
        board.take(victim, world)
        return victim
