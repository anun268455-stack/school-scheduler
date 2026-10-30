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
from collections import Counter, defaultdict, deque
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
# ลำดับการลง
#
#   "ที่สำคัญคือคาบ ม.ต้นต้องเต็มก่อน พอเต็มแล้วก็ลงคาบ ม.ปลาย"
#
# ม.ต้นทั้งระดับมาก่อน ม.ปลาย ไม่ใช่เฉพาะห้องที่มีห้องประจำ — ห้องประจำยังได้
# คิวแรกในกลุ่ม ม.ต้นด้วยกันเอง เพราะมันคับที่สุด แต่ ม.ต้นที่ไม่มีห้องประจำ
# ก็ยังต้องลงให้หมดก่อนจะเริ่ม ม.ปลาย
PHASE_SHARED      = 0  # คาบเสรี · สาธารณประโยชน์ · ชุมนุม · ลูกเสือ
PHASE_LOWER_SPEC  = 1  # ม.ต้นที่ต้องใช้ห้องพิเศษ (คอม ดนตรี แล็บ ฯลฯ)
PHASE_LOWER_HOME  = 2  # ม.ต้นที่เหลือของห้องที่มีห้องประจำ
PHASE_LOWER       = 3  # ม.ต้นที่เหลือ
PHASE_DOUBLE      = 4  # คาบคู่ของ ม.ปลาย
PHASE_REST        = 5  # ที่เหลือ

PHASE_NAME = {
    PHASE_SHARED:     "คาบเสรี/สาธารณะ/กิจกรรม",
    PHASE_LOWER_SPEC: "ม.ต้นที่ใช้ห้องพิเศษ",
    PHASE_LOWER_HOME: "ม.ต้นที่มีห้องประจำ",
    PHASE_LOWER:      "ม.ต้นที่เหลือ",
    PHASE_DOUBLE:     "คาบคู่",
    PHASE_REST:       "ที่เหลือ",
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
    # ช่องที่หน่วยนี้ลงได้จริง และลำดับของคาบในนั้น
    #
    # กิจกรรมอย่างชุมนุมครอบ ม.1 ถึง ม.6 พร้อมกัน แต่ ม.ต้นกับ ม.ปลายพัก
    # กลางวันคนละคาบ ผังคาบจึงไม่เหมือนกัน การเอาระดับของห้องแรกมาใช้ทั้งหน่วย
    # (ซึ่งรอบแรกทำแบบนั้น) ทำให้ชุมนุมไปลงคาบที่ ม.ปลายไม่มีเรียน แล้วลงไม่ได้
    # เลยสักรอบ — ต้องใช้ช่องที่ทุกระดับในหน่วยเรียนได้ร่วมกัน
    cells:       tuple[tuple[int, int], ...] = ()
    pindex:      dict[int, int] = field(default_factory=dict)


@dataclass
class World:
    """ข้อมูลโรงเรียนที่เครื่องนี้ต้องใช้ — สำเนาทั้งหมด ไม่ใช่ของจริง"""
    units:        list[Unit]
    cells_for:    dict[str, list[tuple[int, int]]]   # level -> [(วัน, คาบ)]
    period_index: dict[str, dict[int, int]]          # level -> {คาบ: ลำดับที่}
    teacher_off:  dict[int, set[int]]                # ครู -> วันที่ไม่มาสอน
    subject_off:  dict[int, set[int]]                # วิชา -> วันที่ห้ามเรียน
    fixed:        dict[int, tuple[int, int]]         # uid -> ช่องที่ตรึงไว้
    gindex:       dict[int, dict[int, int]] = field(default_factory=dict)
    """ชั้น -> {คาบ: ลำดับที่} — ใช้วัดว่าวันนั้นของห้องนี้มีรูตรงไหน"""
    glevel:       dict[int, str] = field(default_factory=dict)
    tindex:       dict[tuple[str, int], int] = field(default_factory=dict)
    """(ระดับ, คาบ) -> ลำดับตามเวลานาฬิกา — ใช้นับคาบติดกันของครู"""
    rbuilding:    dict[int, int] = field(default_factory=dict)
    """ห้อง -> อาคาร

    มีไว้วัดว่าครูต้องเดินข้ามอาคารกี่ครั้ง

      "สิ่งที่คอมทำได้คือการจัดการสอนให้ครูผู้สอนมีคาบสอนที่ไม่ติดกันจนเกินไป
       และไม่เดินข้ามอาคารไปๆมาๆ"

    ห้องลอยกับสนามไม่มีอาคาร จึงไม่อยู่ในนี้ — ถือว่า "ไม่รู้" แล้วไม่นับเป็น
    การเดินข้ามทั้งขาไปและขากลับ ดีกว่าเดาแล้วไปไล่แก้สิ่งที่ไม่ได้เกิดขึ้นจริง
    """


# ── สร้างหน่วยจากแผนการสอน ─────────────────────────────────────────────────

def _level_of(group: dict[str, Any]) -> str:
    return "upper" if (group.get("level") or "") in ("M4", "M5", "M6") else "lower"


def special_room_map(rooms: list[dict[str, Any]] | None) -> dict[str, set]:
    """ใครเป็นเจ้าของห้องพิเศษบ้าง

    โรงเรียนนี้ไม่ได้ตรึงห้องไว้ที่ทะเบียนวิชา และไม่มีครูสักคนที่มีห้องประจำ
    ของตัวเอง (0 จาก 170) ความผูกพันกับห้องพิเศษอยู่ที่สองอย่าง

      specialized_dept_id    ห้องคอมฯ ทั้งห้าเป็นของกลุ่มสาระเทคโนโลยี
      reserved_teacher_ids   ห้องดนตรี นาฏศิลป์ วงโยฯ ห้องสมุด กันไว้ให้ครูเฉพาะคน

    นับเฉพาะห้องที่ใช้ได้จริง ห้องที่โรงเรียนปิดไว้ (usable=False เช่น 234
    ห้องกลุ่มวิทย์) ไม่ใช่ห้องที่ใครจะได้ไปเรียน
    """
    depts: set = set()
    teachers: set = set()
    for r in (rooms or []):
        if r.get("type") != "special":
            continue
        if r.get("usable") is False or (r.get("capacity") or 1) <= 0:
            continue
        if r.get("specialized_dept_id"):
            depts.add(r["specialized_dept_id"])
        for tid in (r.get("reserved_teacher_ids") or ()):
            teachers.add(tid)
    return {"depts": depts, "teachers": teachers}


def _needs_special(
    sub: dict[str, Any],
    teacher_ids: tuple[int, ...],
    owners: dict[str, set],
) -> bool:
    """คาบนี้ต้องไปเรียนห้องพิเศษไหม

    สามทาง: วิชาตรึงห้องไว้เอง · กลุ่มสาระของวิชาเป็นเจ้าของห้องพิเศษ (คอม) ·
    มีห้องพิเศษกันไว้ให้ครูผู้สอนคนนี้ (ดนตรี นาฏศิลป์)

    ทั้งสามแบบแปลว่าคาบนี้เลือกที่ลงได้น้อยกว่าคาบที่เรียนในห้องประจำของชั้น
    จึงต้องได้คิวก่อน ("ให้ลงของเด็ก ม.ต้นให้เสร็จ เริ่มจากห้องพิเศษ")
    """
    if sub.get("fixed_room_ids") or sub.get("fixed_room_id"):
        return True
    if sub.get("department_id") in owners["depts"]:
        return True
    return any(tid in owners["teachers"] for tid in teacher_ids)


def fold_coteaching(
    rows: list[dict[str, Any]],
) -> tuple[set[int], dict[int, int], dict[int, tuple[int, ...]]]:
    """สอนร่วมที่เขียนไว้สองฝั่ง — สองแถว แต่เป็นคาบเดียว

    โรงเรียนที่นำเข้าแผนการสอนจะได้แถวละครู ครูไทยมี ม.1/1 EN21204 และครูต่าง
    ชาติก็มี ม.1/1 EN21204 ซึ่งจริงทั้งคู่ เพราะทั้งสองคนเดินเข้าห้องนั้น แต่
    "เด็กเรียนคาบเดียว"

    ถ้านับทีละแถว ม.1/1 จะกลายเป็นขอ 45 คาบในสัปดาห์ที่มี 40 ช่อง แล้วเครื่อง
    ก็จะไปบอกโรงเรียนให้ตัดวิชาที่ไม่มีอยู่จริงทิ้ง — ซึ่งเคยเกิดขึ้นมาแล้ว

    สองแถวจะถูกรวมก็ต่อเมื่อ **อ้างถึงกันและกัน** ครูสองคนที่ต่างคนต่างคิดว่า
    ห้องนี้เป็นของตัวเองคือความขัดแย้งจริง ไม่ใช่คาบเดียวกัน

    คืน: ไอดีของแถวที่ถูกยุบ · จำนวนคาบที่ตกลงกันของแถวที่เหลือ · และครูทั้งคู่
    """
    by_cell: dict[tuple, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_cell[(r.get("group_id"), r.get("subject_id"))].append(r)
    folded: set[int] = set()
    count: dict[int, int] = {}
    pair: dict[int, tuple[int, ...]] = {}
    for cell in by_cell.values():
        for i, a in enumerate(cell):
            if a["id"] in folded:
                continue
            for b in cell[i + 1:]:
                if b["id"] in folded:
                    continue
                if (a.get("co_teacher_id") == b.get("teacher_id")
                        or b.get("co_teacher_id") == a.get("teacher_id")):
                    folded.add(b["id"])
                    count[a["id"]] = max(a.get("weekly_count") or 0,
                                         b.get("weekly_count") or 0)
                    pair[a["id"]] = tuple(sorted({
                        t for t in (a.get("teacher_id"), a.get("co_teacher_id"),
                                    b.get("teacher_id"), b.get("co_teacher_id"))
                        if t}))
                    break
    return folded, count, pair


def build_world(
    requirements: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    subjects: list[dict[str, Any]],
    teachers: list[dict[str, Any]],
    periods: list[dict[str, Any]],
    elective_pools: list[dict[str, Any]] | None = None,
    activities: list[dict[str, Any]] | None = None,
    rooms: list[dict[str, Any]] | None = None,
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
    # กลุ่มสาระไหนและครูคนไหนเป็นเจ้าของห้องพิเศษ
    owners = special_room_map(rooms)
    rbuilding = {r["id"]: r["building_id"] for r in (rooms or [])
                 if r.get("building_id")}

    cells_for: dict[str, list[tuple[int, int]]] = {}
    period_index: dict[str, dict[int, int]] = {}
    for level in ("lower", "upper"):
        nums = sorted({p["period_num"] for p in periods
                       if p.get("type") == "class"
                       and (p.get("applies_to") or "all") in ("all", level)})
        period_index[level] = {n: i for i, n in enumerate(nums)}
        cells_for[level] = [(d, n) for d in range(DAYS) for n in nums]

    # ลำดับตามเวลานาฬิกาจริง — ใช้นับคาบติดกันของครู ซึ่งสอนข้ามระดับได้
    # ม.ต้นคาบ 7 กับ ม.ปลายคาบ 7 เป็นเลขเดียวกันแต่คนละเวลา จะนับว่าติดกันไม่ได้
    # ถ้าดูแต่ตัวเลข
    clock: dict[tuple[str, int], str] = {}
    for p_ in periods:
        if p_.get("type") != "class":
            continue
        ap = p_.get("applies_to") or "all"
        for lv in ("lower", "upper"):
            if ap in ("all", lv):
                clock[(lv, p_["period_num"])] = p_.get("start_time") or ""
    # ลำดับต้องเป็น "ชั่วโมงที่เท่าไรของวัน" จริง ๆ ไม่ใช่ลำดับของแถวในผังคาบ
    #
    # ม.ต้นคาบ 1 กับ ม.ปลายคาบ 1 เริ่ม 08:30 เหมือนกัน ต้องได้ลำดับเดียวกัน
    # ของเดิมไล่หมายเลขทีละแถว สองคาบนี้เลยได้ 0 กับ 1 ผลคือเครื่องคิดว่าครูที่
    # สอนสองห้องนี้ "สอนติดกันสองชั่วโมง" ทั้งที่เป็นชั่วโมงเดียวกัน และคิดว่า
    # ม.ต้นคาบ 1 (08:30) กับคาบ 2 (09:20) ไม่ติดกัน ทั้งที่ต่อกันพอดี
    #
    # ความเพี้ยนนี้ไหลไปทุกที่ที่นับคาบติดกันของครู: ตัววัดคุณภาพ · เพดาน
    # คาบติดกันตอนขัดเกลา · การนับวันที่สอนหนัก — ซึ่งเป็นสิ่งที่โรงเรียนขอ
    # ("อยากให้ครูมีคาบสอนที่ไม่ติดกันจนเกินไป")
    starts = sorted(set(clock.values()))
    rank_of = {t: i for i, t in enumerate(starts)}
    tindex = {k: rank_of[v] for k, v in clock.items()}

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

    # คาบสอนร่วมที่เขียนไว้สองฝั่งต้องนับเป็นคาบเดียว ไม่งั้นห้องที่สอนร่วมเยอะ
    # จะดูเหมือนขอคาบเกินช่องที่มี ทั้งที่ของจริงพอดี
    folded, fold_count, fold_pair = fold_coteaching(plain)
    plain = [r for r in plain if r["id"] not in folded]

    for r in plain:
        grp = g_map.get(r["group_id"]) or {}
        sub = s_map.get(r.get("subject_id")) or {}
        lv = _level_of(grp)
        tids = fold_pair.get(r["id"]) or tuple(
            x for x in (r.get("teacher_id"), r.get("co_teacher_id")) if x)
        tids = tuple(x for x in tids if x in t_map)
        want = fold_count.get(r["id"], r.get("weekly_count") or 0)
        double = int(sub.get("duration") or 1) == 2
        has_home = grp.get("homeroom_room_id") is not None
        # ลำดับที่โรงเรียนสั่ง
        #
        #   "ให้ลงของเด็ก ม.ต้นให้เสร็จ เริ่มจากห้องพิเศษ"
        #
        # ห้องพิเศษมีอยู่ 18 ห้องทั้งโรงเรียน และคาบที่ต้องใช้มันเลือกที่ลงได้
        # น้อยกว่าคาบที่เรียนในห้องประจำตัวเองมาก จึงต้องได้คิวก่อน ไม่งั้นพอถึง
        # คิวมันห้องก็ถูกจองไปหมดแล้ว
        if lv == "lower":
            if _needs_special(sub, tids, owners):
                phase = PHASE_LOWER_SPEC
            else:
                phase = PHASE_LOWER_HOME if has_home else PHASE_LOWER
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

    # ช่องของแต่ละหน่วย = ช่องที่ทุกระดับชั้นในหน่วยนั้นเรียนได้ร่วมกัน
    for u in units:
        levels = {_level_of(g_map.get(gid, {})) for gid in u.group_ids} or {u.level}
        nums = None
        for lv in levels:
            got = set(period_index[lv])
            nums = got if nums is None else (nums & got)
        nums = sorted(nums or ())
        u.pindex = {n: i for i, n in enumerate(nums)}
        u.cells = tuple((d, n) for d in range(DAYS) for n in nums)

    gindex = {gid: period_index[_level_of(gr)] for gid, gr in g_map.items()}

    return World(units=units, cells_for=cells_for, period_index=period_index,
                 teacher_off=teacher_off, subject_off=subject_off, fixed=fixed,
                 gindex=gindex, tindex=tindex, rbuilding=rbuilding,
                 glevel={gid: _level_of(gr) for gid, gr in g_map.items()})


# ── ตารางระหว่างค้นหา ──────────────────────────────────────────────────────

class Board:
    """ใครอยู่ตรงไหนแล้วบ้าง — ตอบว่า "ลงตรงนี้ได้ไหม" ให้เร็วที่สุด"""

    __slots__ = ("group_at", "teacher_at", "placed")

    def __init__(self) -> None:
        self.group_at: dict[tuple[int, int, int], int] = {}     # (ชั้น,วัน,คาบ) -> uid
        self.teacher_at: dict[tuple[int, int, int], int] = {}   # (ครู,วัน,คาบ) -> uid
        self.placed: dict[int, tuple[int, int]] = {}            # uid -> (วัน,คาบ)

    def fits(self, u: Unit, day: int, period: int, world: World) -> bool:
        idx = u.pindex
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
        idx = u.pindex
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
        return [c for c in u.cells if board.fits(u, c[0], c[1], self.world)]

    def _order(self, units: list[Unit], board: Board) -> list[Unit]:
        """ลำดับที่โรงเรียนสั่งก่อน แล้วที่คับที่สุดก่อนภายในลำดับเดียวกัน

        "คับที่สุด" วัดด้วยตัวเลือกที่เหลือ *เทียบกับความกว้าง* ของหน่วย ไม่ใช่
        จำนวนตัวเลือกเปล่า ๆ — ชุมนุมครอบ 78 ห้องพร้อมกัน จึงมีช่องให้เลือก 35
        ช่องซึ่งนับว่า "เยอะ" แล้วไปอยู่ท้ายแถว กว่าจะถึงคิวมัน วิชาเสรีที่แคบ
        กว่าก็แย่งช่องไปหมด และหน้าต่างที่ต้องว่างพร้อมกันทั้ง 78 ห้องก็ไม่เหลือ
        ที่ลงเลย (รอบก่อนชุมนุมกับคุณธรรมลงไม่ได้สักรอบ) หารด้วยความกว้าง
        ทำให้หน้าต่างกว้างได้ลงก่อน แล้วค่อยเกลี่ยคาบเดี่ยวลงรอบ ๆ มัน
        """
        def key(u: Unit) -> tuple:
            width = len(u.group_ids) + len(u.teacher_ids)
            return (u.phase, len(self.options(u, board)) / max(1, width),
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
        for day, period in stuck.cells:
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
        # ถอยคนที่หาที่ใหม่ง่ายที่สุด ไม่ใช่สุ่ม
        #
        # กิจกรรมอย่างชุมนุมครอบ 78 ห้องพร้อมกัน มันจึงขวางเกือบทุกคน และถ้า
        # สุ่มถอย มันจะโดนถอยตลอดเวลาแล้วกลับเข้าไม่ได้เลย (รอบแรกเป็นแบบนั้น:
        # ชุมนุมกับคุณธรรมลงไม่ได้สักรอบ) ยิ่งครอบหลายห้องหลายครู ยิ่งหาที่ใหม่
        # ยาก จึงควรถอยเป็นคนท้าย ๆ
        def ease(uid: int) -> tuple:
            v = by_uid[uid]
            return (len(v.group_ids) + len(v.teacher_ids), v.length,
                    self.rng.random())
        victim_uid = min(movable, key=ease)
        victim = by_uid[victim_uid]
        self._remember((victim_uid, board.placed[victim_uid]))
        board.take(victim, world)
        return victim


# ── แจกห้อง ────────────────────────────────────────────────────────────────
#
# ของเดิมไล่หยิบห้องว่างที่ "ดูดีที่สุด" ให้ทีละคาบ ซึ่งเป็นการตัดสินใจที่ย้อน
# กลับไม่ได้: คาบแรกหยิบห้องที่คาบหลังต้องใช้ไป คาบหลังจึงไม่มีห้อง ทั้งที่ถ้า
# สลับกันแล้วได้ห้องทั้งคู่
#
# ตรงนี้ทำคนละอย่าง — ในแต่ละชั่วโมง ถามว่า "จับคู่คาบกับห้องให้ได้มากที่สุด
# เท่าไร" แล้วตอบด้วยการจับคู่สองฝั่ง (bipartite matching) ซึ่งได้คำตอบที่
# มากที่สุดจริง ไม่ใช่เดาแล้วหวัง ชั่วโมงหนึ่งมีคาบไม่กี่สิบคาบ จึงเร็วพอ


def _augment(u: int, adj: dict[int, list[int]], taken: dict[int, int],
             seen: set[int]) -> bool:
    """หาทางให้คาบ u ได้ห้อง โดยยอมให้คาบอื่นขยับไปห้องอื่นที่ว่างสำหรับมัน"""
    for r in adj.get(u, ()):
        if r in seen:
            continue
        seen.add(r)
        if r not in taken or _augment(taken[r], adj, taken, seen):
            taken[r] = u
            return True
    return False


# ── จัดให้สวย ──────────────────────────────────────────────────────────────
#
# ตัวเดินหาข้างบนตอบแค่ว่า "ลงได้ไหม" ไม่ได้สนว่าสวยหรือเปล่า ผลที่ได้จึงไม่ชน
# เลยแต่วันหนึ่งของเด็กอาจเป็น เรียน-ว่าง-ว่าง-เรียน ซึ่งใช้ไม่ได้จริง
# (วัดครั้งแรกได้ 401 รู เทียบกับตารางที่ครูจัดมือไว้ 83 รู)
#
# รอบนี้จึงไม่รื้ออะไร แค่ "ขยับ" คาบที่ลงแล้วไปช่องอื่นที่ยังลงได้เหมือนกัน
# แล้วเลือกช่องที่ทำให้วันนั้นของห้องต่อเนื่องกว่าเดิม ขยับทีละคาบ วนไปจนไม่มี
# อะไรดีขึ้นแล้วหรือหมดเวลา — ทุกการขยับผ่าน Board.fits เสมอ จึงไม่มีทางทำให้
# ชนเพิ่มแม้แต่คาบเดียว และเลิกกลางทางได้ตลอดเพราะทุกขั้นเป็นตารางที่ใช้ได้จริง


# น้ำหนักของ "ความสวย" — รูของเด็กแพงที่สุด เพราะเด็กต้องอยู่โรงเรียนอยู่แล้ว
# ส่วนของครูเป็นภาระที่เกลี่ยได้ จึงถ่วงให้เบากว่าแต่ไม่ใช่ศูนย์ ถ้าไม่นับเลย
# ตารางจะแน่นสวยสำหรับเด็กแต่ครูสอนติดกันยาวขึ้นทันที (วัดได้ 120 ครั้ง
# เทียบกับตารางมือ 65 ครั้ง)
# ชั่งกันด้วยการวัดจริงกับข้อมูล 30 ต.ค. ไม่ใช่เดา — ไล่ลองทุกคู่ของน้ำหนัก
# แล้วเลือกชุดที่ชนะตารางที่โรงเรียนจัดเองครบทุกข้อพร้อมกัน
#
#   รูของเด็ก 73 → 3 · คาบติดกันเกินเพดาน 47 → 39 · เดินข้ามอาคาร 223 → 104
#   วันที่ครูสอนหนัก 2 → 2
#
# สองตัวที่ขัดกันเองคือ RUN_W กับ WALK_W: รวมครูไว้อาคารเดียวทำให้คาบเกาะกลุ่ม
# กันแล้วติดกันยาวขึ้น (ตอนตั้ง RUN_W=2 ได้เดินข้าม 105 แต่ติดกันเกิน 58 ซึ่ง
# แย่กว่าตารางมือ)
#
# LOAD_W ต้องสูงพอจะกันไม่ให้ไปทิ้งคาบรวมไว้วันเดียวเวลาหนีคาบติดกันกับการเดิน
# ที่ 4 วันที่ครูสอนหนักขึ้นจาก 2 เป็น 6 · ที่ 10 ยังแกว่งเป็น 5 ในบางเมล็ดสุ่ม
# ที่ 30 (= วันสอนหนักหนึ่งวันแพงเท่าเดินข้ามอาคาร 5 เที่ยว) จึงอยู่ที่ 1-3 วัน
# เทียบกับตารางมือ 2 วัน ซึ่งเป็นการแลกที่สมเหตุสมผล: ครูที่สอน 7 คาบในวันเดียว
# เหนื่อยกว่าเดินข้ามตึกสองเที่ยวแน่นอน
GAP_W    = 10   # รูหนึ่งรูในวันของห้องหนึ่ง
LOAD_W   = 30   # คาบที่เกินเพดานต่อวันของครูหนึ่งคน
RUN_W    = 9    # คาบที่ทำให้ครูสอนติดกันเกินเพดาน
WALK_W   = 6    # ครูต้องเดินข้ามอาคารระหว่างสองชั่วโมงที่ติดกัน
TEACH_CAP = 6   # คาบต่อวันที่ถือว่าพอดีสำหรับครูหนึ่งคน
RUN_CAP   = 3   # คาบติดกันที่ถือว่ายังพอรับได้


def _gap_count(idxs: set[int]) -> int:
    """ช่องว่างที่คาบคั่นกลางวันของห้องหนึ่ง — หัวท้ายว่างไม่นับเป็นรู"""
    if len(idxs) < 2:
        return 0
    return (max(idxs) - min(idxs) + 1) - len(idxs)


def _walk_count(where: dict[int, Counter]) -> int:
    """ครูคนหนึ่งในวันหนึ่งต้องเดินข้ามอาคารกี่ครั้ง

      "สิ่งที่คอมทำได้คือ … ไม่เดินข้ามอาคารไปๆมาๆ"

    นับเฉพาะชั่วโมงที่ติดกัน เพราะนั่นคือตอนที่ไม่มีเวลาให้เดินเลย ถ้ามีคาบว่าง
    คั่นอยู่ก็ยังพอเดินทัน · "ข้าม" คือสองชั่วโมงนั้นไม่มีอาคารไหนร่วมกันเลย
    ไม่ใช่แค่ไม่เท่ากัน เพราะชั่วโมงเดียวครูอาจมีหลายห้อง (สอนร่วม · ห้องย่อย)
    """
    ranks = sorted(where)
    n = 0
    for a, b in zip(ranks, ranks[1:]):
        if b == a + 1 and where[a] and where[b] and not (set(where[a]) & set(where[b])):
            n += 1
    return n


def _walk_cost(where: dict[int, Counter]) -> int:
    """ราคาของการเดินนั้น — แยกจากการนับ เพราะที่อื่นอยากได้จำนวนครั้งล้วน ๆ

    เคยเขียนเป็นตัวเดียวแล้วหารกลับด้วย WALK_W เพื่อเอาจำนวนครั้ง ซึ่งพังทันที
    ถ้าตั้งน้ำหนักเป็นศูนย์เพื่อปิดเรื่องนี้ทิ้ง
    """
    return _walk_count(where) * WALK_W


def _teacher_day_cost(load: Counter, day_cap: int = TEACH_CAP,
                      run_cap: int = RUN_CAP) -> int:
    """ภาระวันหนึ่งของครูคนหนึ่ง — สอนเยอะเกินไป และสอนติดกันยาวเกินไป

    เพดานส่งเข้ามาได้ เพราะโรงเรียนตั้งค่า max_consecutive ของตัวเองไว้แล้ว
    ("อยากให้คาบครูไม่ติดกันเกินไปตามที่กำหนด") ค่าตั้งต้นตรงนี้มีไว้ให้
    ทดสอบเรียกง่าย ๆ เท่านั้น
    """
    total = sum(load.values())
    cost = max(0, total - day_cap) * LOAD_W
    run = 0
    prev = None
    for r in sorted(load):
        run = run + 1 if prev is not None and r == prev + 1 else 1
        prev = r
        if run > run_cap:
            cost += RUN_W
    return cost


class Polisher:
    """ขยับคาบที่ลงแล้วให้วันของแต่ละห้องต่อเนื่องขึ้น โดยไม่ทำให้ชนเพิ่ม"""

    def __init__(self, world: World, placed: dict[int, tuple[int, int]],
                 seed: int = 0, day_cap: int = TEACH_CAP,
                 run_cap: int = RUN_CAP,
                 ubuilding: dict[int, int] | None = None) -> None:
        self.day_cap = max(1, int(day_cap))
        self.run_cap = max(1, int(run_cap))
        self.world = world
        self.by_uid = {u.uid: u for u in world.units}
        # หน่วย -> อาคารที่รู้แน่ว่าจะไปลง
        #
        # ห้องยังไม่ได้แจกตอนนี้ แต่ 78% ของหน่วยมีห้องที่ "ดีที่สุด" อยู่อาคาร
        # เดียว (ห้องประจำของชั้น · ห้องพิเศษของวิชา) จึงรู้ล่วงหน้าได้ว่าจะไป
        # อยู่อาคารไหน ที่เหลือปล่อยว่างไว้ ไม่เดา
        self.ubuilding = ubuilding or {}
        self.rng = random.Random(seed)
        self.board = Board()
        self.occ:  dict[tuple[int, int], set[int]] = defaultdict(set)
        self.tocc: dict[tuple[int, int], Counter] = defaultdict(Counter)
        self.twhere: dict[tuple[int, int], dict[int, Counter]] = \
            defaultdict(lambda: defaultdict(Counter))
        for uid, (day, period) in placed.items():
            u = self.by_uid[uid]
            self.board.put(u, day, period, world)
            self._mark(u, day, period, +1)

    # -- จดว่าใครเรียน/สอนลำดับที่เท่าไรของวัน --------------------------
    def _ranks(self, u: Unit, period: int) -> list[int]:
        """ลำดับตามเวลานาฬิกาที่หน่วยนี้กินไป — นับครั้งเดียวต่อเวลา"""
        w = self.world
        out: set[int] = set()
        for n in Board._nums(u, period, w):
            for gid in u.group_ids:
                r = w.tindex.get((w.glevel.get(gid, u.level), n))
                if r is not None:
                    out.add(r)
        return sorted(out)

    def _mark(self, u: Unit, day: int, period: int, sign: int) -> None:
        for n in Board._nums(u, period, self.world):
            for gid in u.group_ids:
                i = self.world.gindex.get(gid, {}).get(n)
                if i is None:
                    continue
                if sign > 0:
                    self.occ[(gid, day)].add(i)
                else:
                    self.occ[(gid, day)].discard(i)
        ranks = self._ranks(u, period)
        b = self.ubuilding.get(u.uid)
        for tid in u.teacher_ids:
            load = self.tocc[(tid, day)]
            for r in ranks:
                if sign > 0:
                    load[r] += 1
                elif load[r] <= 1:
                    del load[r]
                else:
                    load[r] -= 1
            if b is None:
                continue
            wh = self.twhere[(tid, day)]
            for r in ranks:
                if sign > 0:
                    wh[r][b] += 1
                else:
                    c = wh[r]
                    if c[b] <= 1:
                        del c[b]
                    else:
                        c[b] -= 1
                    if not c:
                        del wh[r]

    def cost(self) -> int:
        return (GAP_W * sum(_gap_count(v) for v in self.occ.values())
                + sum(_teacher_day_cost(v, self.day_cap, self.run_cap)
                      for v in self.tocc.values())
                + sum(_walk_cost(v) for v in self.twhere.values()))

    def walks(self) -> int:
        """ครั้งที่ครูต้องเดินข้ามอาคารแบบไม่มีเวลาพัก — ตัวเลขที่ครูดูรู้เรื่อง"""
        return sum(_walk_count(v) for v in self.twhere.values())

    def gaps(self) -> int:
        """จำนวนรูเปล่า ๆ — ตัวเลขที่ครูดูรู้เรื่อง ไม่ใช่คะแนนรวม"""
        return sum(_gap_count(v) for v in self.occ.values())

    def _delta(self, u: Unit, day: int, period: int) -> int:
        """ค่าความไม่สวยที่จะเพิ่มถ้าเอา u (ที่ยกออกแล้ว) ไปวางที่ช่องนี้"""
        nums = Board._nums(u, period, self.world)
        out = 0
        for gid in u.group_ids:
            gi = self.world.gindex.get(gid)
            if gi is None:
                continue
            add = {gi[n] for n in nums if n in gi}
            if not add:
                continue
            here = self.occ[(gid, day)]
            out += GAP_W * (_gap_count(here | add) - _gap_count(here))
        ranks = self._ranks(u, period)
        if ranks:
            b = self.ubuilding.get(u.uid)
            for tid in u.teacher_ids:
                load = self.tocc[(tid, day)]
                after = load.copy()
                for r in ranks:
                    after[r] += 1
                out += (_teacher_day_cost(after, self.day_cap, self.run_cap)
                        - _teacher_day_cost(load, self.day_cap, self.run_cap))
                if b is None:
                    continue
                wh = self.twhere[(tid, day)]
                nxt = dict(wh)
                for r in ranks:
                    c = Counter(nxt.get(r) or ())
                    c[b] += 1
                    nxt[r] = c
                out += _walk_cost(nxt) - _walk_cost(wh)
        return out

    # -- ลองลงของที่เคยลงไม่ได้ ------------------------------------------
    def place_more(self, unplaced: list[int]) -> list[int]:
        """ขยับเสร็จแล้วอาจมีช่องเปิดขึ้นมาให้คาบที่เคยลงไม่ได้

        เลือกช่องที่ทำให้ตารางสวยที่สุดในบรรดาช่องที่ลงได้จริง เพราะคาบที่
        เพิ่งแทรกลงไปไม่ควรไปเจาะรูใหม่ให้ห้องนั้น
        """
        left: list[int] = []
        for uid in unplaced:
            u = self.by_uid[uid]
            pin = self.world.fixed.get(uid)
            cells = [pin] if pin is not None else list(u.cells)
            best: tuple[int, int] | None = None
            best_d: int | None = None
            for cell in cells:
                if not self.board.fits(u, cell[0], cell[1], self.world):
                    continue
                d = self._delta(u, cell[0], cell[1])
                if best_d is None or d < best_d:
                    best, best_d = cell, d
            if best is None:
                left.append(uid)
                continue
            self.board.put(u, best[0], best[1], self.world)
            self._mark(u, best[0], best[1], +1)
        return left

    # -- ไล่เบียดให้ของที่เหลือลงให้ได้ ------------------------------------
    def _who_blocks(self, u: Unit, day: int, period: int) -> set[int] | None:
        """ใครขวางอยู่ถ้าจะวาง u ลงช่องนี้ — None คือช่องนี้ลงไม่ได้เลย

        ต่างจาก Board.fits ตรงที่ fits ตอบแค่ว่าได้หรือไม่ได้ ตัวนี้ตอบว่า
        "ติดใคร" ซึ่งเป็นสิ่งที่ต้องรู้ถ้าจะไปขอให้เขาขยับ
        """
        w = self.world
        idx = u.pindex
        i = idx.get(period)
        if i is None:
            return None
        if u.length == 2 and i + 1 >= len(idx):
            return None
        nums = [period]
        if u.length == 2:
            nums.append(next(n for n, j in idx.items() if j == i + 1))
        for t in u.teacher_ids:
            if day in w.teacher_off.get(t, ()):
                return None
        if u.subject_id is not None and day in w.subject_off.get(u.subject_id, ()):
            return None
        out: set[int] = set()
        for n in nums:
            for gid in u.group_ids:
                v = self.board.group_at.get((gid, day, n))
                if v is not None:
                    out.add(v)
            for tid in u.teacher_ids:
                v = self.board.teacher_at.get((tid, day, n))
                if v is not None:
                    out.add(v)
        out.discard(u.uid)
        return out

    def squeeze(self, unplaced: list[int], max_depth: int = 3,
                budget: int = 40_000) -> list[int]:
        """ของที่ยังลงไม่ได้ ไล่เบียดคนอื่นจนกว่าจะลงให้ได้

        ขยับเฉย ๆ ไม่พอสำหรับชั้นที่คาบเต็มพอดีทุกช่อง เช่น ม.6/1 ที่มี 40
        หน่วยลง 40 ช่อง คาบสุดท้ายเป็นวิชาสอนร่วมที่ครูทั้งสองคนว่างแค่ 4 ช่อง
        และชั้นนี้ไม่ว่างสักช่องในสี่ช่องนั้น ทางเดียวคือขอให้คาบที่นั่งอยู่
        ขยับออกไปก่อน ซึ่งอาจต้องขยับต่อกันอีกทอด

        เดินแบบเดียวกับตัวค้นหา: ลอง ถอย จำว่าใครตกลงที่แล้วจะได้ไม่วน
        """
        journal: list[tuple[int, tuple[int, int] | None]] = []
        settled: set[int] = set()
        # ช่องที่ "จองไว้แล้ว" ระหว่างเดิน
        #
        # ตอนยกคนที่ขวางออกไปหาที่ใหม่ ช่องที่ตัวตั้งกำลังจะลงยังว่างอยู่ (เพราะ
        # ตัวตั้งยังไม่ได้วาง) เขาจึงย้ายเข้าไปนั่งตรงนั้นได้ แล้วพอวางตัวตั้ง
        # ทับลงไปก็กลายเป็นสองคาบในช่องเดียว โดยที่ไม่มีใครฟ้อง
        claimed: set[tuple[int, int]] = set()
        box = [budget]

        def cells_used(v: Unit, day: int, period: int) -> list[tuple[int, int]]:
            return [(day, n) for n in Board._nums(v, period, self.world)]

        def lift(v: Unit) -> None:
            day, period = self.board.placed[v.uid]
            self._mark(v, day, period, -1)
            self.board.take(v, self.world)
            journal.append((v.uid, (day, period)))

        def drop(v: Unit, day: int, period: int) -> None:
            self.board.put(v, day, period, self.world)
            self._mark(v, day, period, +1)
            journal.append((v.uid, None))

        def rollback(mark: int) -> None:
            while len(journal) > mark:
                uid, home = journal.pop()
                v = self.by_uid[uid]
                if home is None:
                    day, period = self.board.placed[uid]
                    self._mark(v, day, period, -1)
                    self.board.take(v, self.world)
                else:
                    drop_no_log(v, home[0], home[1])

        def drop_no_log(v: Unit, day: int, period: int) -> None:
            self.board.put(v, day, period, self.world)
            self._mark(v, day, period, +1)

        def cells_of(v: Unit, cur: tuple[int, int] | None) -> list[tuple[int, int]]:
            pin = self.world.fixed.get(v.uid)
            if pin is not None:
                return [pin]
            scored = []
            for c in v.cells:
                if c == cur or c in claimed:
                    continue
                who = self._who_blocks(v, c[0], c[1])
                if who is None:
                    continue
                if any(x in claimed for x in cells_used(v, c[0], c[1])):
                    continue
                scored.append((len(who), self._delta(v, c[0], c[1]), c))
            scored.sort()
            return [c for _, _, c in scored[:6]]

        def put_in(v: Unit, day: int, period: int, depth: int) -> bool:
            if box[0] <= 0:
                return False
            box[0] -= 1
            who = self._who_blocks(v, day, period)
            if who is None:
                return False
            if any(b in settled or b in self.world.fixed for b in who):
                return False
            if who and depth <= 0:
                return False
            mark = len(journal)
            settled.add(v.uid)
            taking = cells_used(v, day, period)
            if any(c in claimed for c in taking):
                settled.discard(v.uid)
                return False
            claimed.update(taking)
            for b in who:
                bu = self.by_uid[b]
                cur = self.board.placed.get(b)
                if cur is None:
                    rollback(mark); settled.discard(v.uid); return False
                lift(bu)
                if not any(put_in(bu, c[0], c[1], depth - 1) for c in cells_of(bu, cur)):
                    rollback(mark)
                    settled.discard(v.uid)
                    claimed.difference_update(taking)
                    return False
            drop(v, day, period)
            return True

        left: list[int] = []
        for uid in unplaced:
            u = self.by_uid[uid]
            journal.clear()
            settled.clear()
            claimed.clear()
            if not any(put_in(u, c[0], c[1], max_depth)
                       for c in cells_of(u, None)):
                left.append(uid)
        return left

    # -- วน --------------------------------------------------------------
    def run(self, deadline: float) -> tuple[dict[int, tuple[int, int]], int, int]:
        world = self.world
        uids = [u.uid for u in world.units
                if u.uid in self.board.placed and u.uid not in world.fixed]
        moves = 0
        passes = 0
        while time.time() < deadline:
            passes += 1
            gained = 0
            self.rng.shuffle(uids)
            for uid in uids:
                if time.time() >= deadline:
                    break
                u = self.by_uid[uid]
                cur = self.board.placed[uid]
                self.board.take(u, world)
                self._mark(u, cur[0], cur[1], -1)
                keep = self._delta(u, cur[0], cur[1])
                best, best_d = cur, keep
                for cell in u.cells:
                    if cell == cur or not self.board.fits(u, cell[0], cell[1], world):
                        continue
                    d = self._delta(u, cell[0], cell[1])
                    if d < best_d:
                        best, best_d = cell, d
                self.board.put(u, best[0], best[1], world)
                self._mark(u, best[0], best[1], +1)
                if best != cur:
                    moves += 1
                    gained += keep - best_d
            if gained == 0:
                break
        return dict(self.board.placed), moves, passes


# ── ไม้บรรทัดวัดคุณภาพ ─────────────────────────────────────────────────────


def _lesson_key(row: dict[str, Any]) -> Any:
    """คาบเดียวกันคืออะไร — ข้อเสนอบอกมาเป็น unit ตารางจริงต้องเดาจากคีย์ร่วม"""
    if row.get("unit") is not None:
        return ("U", row["unit"])
    for field_ in ("activity_key", "elective_pool_id", "parallel_group_key"):
        if row.get(field_):
            return (field_, row[field_], row.get("day"), row.get("period"))
    return ("row", row.get("id", id(row)))


def quality(world: World, rows: list[dict[str, Any]]) -> dict[str, int]:
    """วัดตารางชุดหนึ่ง — ใช้ไม้บรรทัดอันเดียวกับตารางที่ใช้อยู่และข้อเสนอ

    ครูคนหนึ่งใน วัน·คาบ เดียวต้องนับครั้งเดียว ไม่ใช่นับตามจำนวนแถว กิจกรรม
    หนึ่งคาบมีแถวละห้องถึง 78 แถว และแต่ละแถวพ่วงรายชื่อครูทั้งคณะ ถ้านับตาม
    แถวจะได้ครูคนเดียวสอน 216 คาบ/สัปดาห์ ทั้งที่สัปดาห์มีแค่ 40 ช่อง
    """
    seen_g: dict[tuple, Any] = {}
    seen_t: dict[tuple, Any] = {}
    seen_r: dict[tuple, Any] = {}
    byg: dict[tuple[int, int], set[int]] = defaultdict(set)
    byt: dict[tuple[int, int], set[int]] = defaultdict(set)
    # (ครู, วัน) -> ลำดับชั่วโมง -> อาคารที่ต้องไปยืนในชั่วโมงนั้น
    #
    # คาบกิจกรรมไม่นับ เพราะครูคนหนึ่งถูกผูกไว้กับหลายห้องพร้อมกัน จะบอกไม่ได้
    # ว่าจริง ๆ ไปอยู่ตรงไหน นับว่า "ไม่ว่าง" อย่างเดียวพอ
    bywhere: dict[tuple[int, int], dict[int, set[int]]] = defaultdict(lambda: defaultdict(set))
    clash_g = clash_t = clash_r = no_room = 0

    for row in rows:
        gid, day, num = row.get("group_id"), row.get("day"), row.get("period")
        if gid is None or day is None or num is None:
            continue
        shared = row.get("teacher_ids") or []
        tl = [t for t in (list(shared) if shared else
                          [row.get("teacher_id"), row.get("co_teacher_id")]
                          + list(row.get("activity_teacher_ids") or [])) if t]
        lv = world.glevel.get(gid, "lower")

        # แถวไหนเป็น "คาบเดียวกัน" — กิจกรรมหนึ่งคาบมีแถวละห้องถึง 78 แถว
        # ครูคนเดียวกันในเวลาเดียวกันจากคาบเดียวกันไม่ใช่การชน
        lesson = _lesson_key(row)

        key = (gid, day, num)
        if seen_g.setdefault(key, lesson) != lesson:
            clash_g += 1
        i = world.gindex.get(gid, {}).get(num)
        if i is not None:
            byg[(gid, day)].add(i)

        r = world.tindex.get((lv, num))
        if r is not None:
            for t in set(tl):
                if seen_t.setdefault((t, day, r), lesson) != lesson:
                    clash_t += 1
                byt[(t, day)].add(r)

            rid = row.get("room_id")
            if rid:
                if seen_r.setdefault((rid, day, r), lesson) != lesson:
                    clash_r += 1
                b = world.rbuilding.get(rid)
                if b is not None and not row.get("is_activity_block"):
                    for t in set(tl):
                        bywhere[(t, day)][r].add(b)
            elif not row.get("is_elective") and not row.get("is_activity_block"):
                no_room += 1

    runs = 0
    for v in byt.values():
        run = 0
        prev = None
        for r in sorted(v):
            run = run + 1 if prev is not None and r == prev + 1 else 1
            prev = r
            if run > RUN_CAP:
                runs += 1

    # เดินข้ามอาคาร
    #
    # นับสองแบบ เพราะเจ็บไม่เท่ากัน: ชั่วโมงติดกันแปลว่าต้องเดินทั้งที่ไม่มีเวลา
    # ให้เดินเลย ส่วนที่มีคาบว่างคั่นยังพอเดินทัน · ทั้งคู่ดูว่าอาคารของชั่วโมง
    # ก่อนกับชั่วโมงถัดไป "ไม่มีอาคารไหนร่วมกันเลย" ไม่ใช่แค่ไม่เท่ากัน เพราะ
    # ชั่วโมงเดียวครูอาจมีหลายห้อง (สอนร่วม · ห้องย่อยเรียนพร้อมกัน)
    walk = walk_gap = 0
    for where in bywhere.values():
        ranks = sorted(where)
        for a, b in zip(ranks, ranks[1:]):
            if where[a] and where[b] and not (where[a] & where[b]):
                if b == a + 1:
                    walk += 1
                else:
                    walk_gap += 1
    return {
        "periods":      len(seen_g),
        "lessons":      len({v for v in seen_g.values()}),
        "gaps":         sum(_gap_count(v) for v in byg.values()),
        "teacher_busy": len(seen_t),
        "heavy_days":   sum(1 for v in byt.values() if len(v) > TEACH_CAP),
        "long_runs":    runs,
        "clash_group":  clash_g,
        "clash_teacher": clash_t,
        "clash_room":   clash_r,
        "no_room":      no_room,
        "walk":         walk,
        "walk_gap":     walk_gap,
    }


def demand_vs_capacity(world: World) -> list[dict[str, Any]]:
    """ห้องที่หลักสูตรขอคาบไว้เกินช่องที่มีจริง — ไม่มีเครื่องไหนแก้ได้"""
    need: dict[int, int] = defaultdict(int)
    for u in world.units:
        for gid in u.group_ids:
            need[gid] += u.length
    out = []
    for gid, n in need.items():
        cap = len(world.cells_for[world.glevel.get(gid, "lower")])
        if n > cap:
            out.append({"group_id": gid, "want": n, "cap": cap, "over": n - cap})
    return sorted(out, key=lambda x: -x["over"])


def assign_rooms(
    cell_units: list[tuple[int, list[int]]],
    eligible: dict[int, list[int]],
) -> dict[int, int]:
    """แจกห้องในชั่วโมงเดียว — คืน {uid: room_id}

    cell_units  [(uid, ห้องที่คาบนี้ใช้ได้)] เรียงตามลำดับความสำคัญ
    eligible    uid -> รายการห้องที่ใช้ได้ (เรียงจากเหมาะที่สุด)
    """
    taken: dict[int, int] = {}
    for uid, _ in cell_units:
        _augment(uid, eligible, taken, set())
    return {uid: rid for rid, uid in taken.items()}


def room_ranks(
    u: Unit,
    rooms: list[dict[str, Any]],
    groups: dict[int, dict[str, Any]],
    subjects: dict[int, dict[str, Any]],
    teachers: dict[int, dict[str, Any]],
    lower_homeroom_first: bool = True,
    upper_teacher_room_first: bool = False,
) -> dict[int, int]:
    """ห้องที่คาบนี้ใช้ได้ -> ลำดับความชอบ (เลขน้อย = ชอบมาก)

    คืนเป็นแผนที่ ไม่ใช่รายการ เพราะตอนแจกห้องจริงต้องเรียงใหม่ภายในกลุ่ม
    ความชอบเดียวกัน (ให้ห้องที่อยู่อาคารเดิมของครูมาก่อน) โดยห้ามสลับข้าม
    กลุ่ม — ห้องคอมพิวเตอร์ยังต้องมาก่อนห้องประจำเสมอ ไม่ว่าครูจะอยู่ตรงไหน

    กฎเดียวกับที่หน้าจอใช้ (utils/swapPlanner roomTakes) จะได้ไม่มีทางที่
    เครื่องจัดให้ห้องที่หน้าจอบอกว่าใช้ไม่ได้
    """
    if not u.needs_room:
        return {}
    sub = subjects.get(u.subject_id or -1) or {}
    dept = sub.get("department_id")
    home = None
    if len(u.group_ids) == 1:
        home = (groups.get(u.group_ids[0]) or {}).get("homeroom_room_id")
    fixed_rooms = set(sub.get("fixed_room_ids") or ())
    if sub.get("fixed_room_id"):
        fixed_rooms.add(sub["fixed_room_id"])
    teacher_rooms = {t for tid in u.teacher_ids
                     for t in ((teachers.get(tid) or {}).get("fixed_room_id"),)
                     if t}
    homerooms = {g.get("homeroom_room_id") for g in groups.values()
                 if g.get("homeroom_room_id")}

    out: dict[int, int] = {}
    for r in rooms:
        if r.get("usable") is False or (r.get("capacity") or 1) <= 0:
            continue
        keep = r.get("reserved_teacher_ids") or []
        if keep and not any(t in keep for t in u.teacher_ids):
            continue
        if r.get("specialized_dept_id") and dept and r["specialized_dept_id"] != dept:
            continue
        rid = r["id"]
        # ลำดับความชอบ
        #
        #   "ม.ต้นจะต้องเรียนที่ห้องประจำก่อน แล้วตอนไปเรียนวิชาที่มีห้องพิเศษ
        #    เช่น คอมพิวเตอร์ ก็สามารถเอาห้องอื่นมาเรียนได้"
        #
        # ห้องพิเศษที่เป็นของวิชานี้จริง ๆ มาก่อนห้องประจำ เพราะคาบคอมพิวเตอร์
        # ที่ไปนั่งห้องประจำคือคาบที่สอนไม่ได้ ส่วนวิชาอื่นทั้งหมดอยู่ห้องประจำ
        # ของชั้นเป็นหลัก ไม่ใช่ถูกกระจายไปห้องกลุ่มสาระที่มีไม่พอจะรับอยู่แล้ว
        is_special = r.get("type") == "special"
        mine_by_dept = is_special and dept and r.get("specialized_dept_id") == dept
        mine_by_keep = is_special and any(t in (r.get("reserved_teacher_ids") or ())
                                          for t in u.teacher_ids)
        home_beats_teacher = (lower_homeroom_first if u.level == "lower"
                              else not upper_teacher_room_first)
        if rid in fixed_rooms:          rank = 0
        elif mine_by_keep:              rank = 1
        elif mine_by_dept:              rank = 2
        elif home is not None and rid == home:
            rank = 3 if home_beats_teacher else 4
        elif rid in teacher_rooms:      rank = 4 if home_beats_teacher else 3
        elif rid in homerooms:          rank = 8
        elif r.get("building_id"):      rank = 6
        else:                           rank = 7
        out[rid] = rank
    return out


def room_options(
    u: Unit,
    rooms: list[dict[str, Any]],
    groups: dict[int, dict[str, Any]],
    subjects: dict[int, dict[str, Any]],
    teachers: dict[int, dict[str, Any]],
    lower_homeroom_first: bool = True,
    upper_teacher_room_first: bool = False,
) -> list[int]:
    """ห้องที่คาบนี้ใช้ได้ เรียงจากเหมาะที่สุด"""
    ranks = room_ranks(u, rooms, groups, subjects, teachers,
                       lower_homeroom_first, upper_teacher_room_first)
    return [rid for _, rid in sorted((v, k) for k, v in ranks.items())]


def solve(
    requirements: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    subjects: list[dict[str, Any]],
    teachers: list[dict[str, Any]],
    periods: list[dict[str, Any]],
    rooms: list[dict[str, Any]],
    elective_pools: list[dict[str, Any]] | None = None,
    activities: list[dict[str, Any]] | None = None,
    budget_s: float = 60.0,
    polish_s: float = 30.0,
    seed: int = 1,
    max_per_day: int = TEACH_CAP,
    max_consecutive: int = RUN_CAP,
    lower_homeroom_first: bool = True,
    upper_teacher_room_first: bool = False,
    tries_cap: int = 12,
) -> dict[str, Any]:
    """จัดตารางทั้งโรงเรียน แล้วคืน "ข้อเสนอ" ออกไป

    **ไม่แตะข้อมูลจริงเลย** — รับสำเนาเข้ามา คืนรายการคาบที่เสนอออกไป ใครจะ
    เอาไปใช้ค่อยสั่งอีกที ("ตอนนี้คาบโอเคแล้ว ห้ามยุ่ง")
    """
    t0 = time.time()
    g_map = {g["id"]: g for g in groups}
    s_map = {s["id"]: s for s in subjects}
    t_map = {t["id"]: t for t in teachers}

    world = build_world(requirements, groups, subjects, teachers, periods,
                        elective_pools, activities, rooms)

    # ห้องที่แต่ละหน่วยใช้ได้ กับอาคารที่รู้แน่ว่าจะไปลง — คิดก่อนเริ่มจัด
    # เพราะไม่ขึ้นกับว่าคาบไปลงช่องไหน และตัวขัดเกลาต้องใช้ตอนเกลี่ยการเดิน
    ranks_of = {u.uid: room_ranks(u, rooms, g_map, s_map, t_map,
                                  lower_homeroom_first, upper_teacher_room_first)
                for u in world.units}
    opts = {uid: [rid for _, rid in sorted((v, k) for k, v in rk.items())]
            for uid, rk in ranks_of.items()}
    ubuilding: dict[int, int] = {}
    for uid, rk in ranks_of.items():
        if not rk:
            continue
        best = min(rk.values())
        blds = {world.rbuilding.get(rid) for rid, v in rk.items() if v == best}
        blds.discard(None)
        if len(blds) == 1:
            ubuilding[uid] = next(iter(blds))

    def one_try(sd: int, search_s: float, polish_s_: float) -> dict[str, Any]:
        """จัดหนึ่งรอบเต็ม ๆ แล้วคืนผลพร้อมคะแนน — ไม่แตะอะไรนอกฟังก์ชันนี้"""
        se = Search(world, seed=sd)
        f = se.run(time.time() + search_s)
        moves = passes = saved = 0
        g0 = g1 = w0 = w1 = -1
        po = None
        if polish_s_ > 0 and f.placed:
            po = Polisher(world, f.placed, seed=sd, day_cap=max_per_day,
                          run_cap=max_consecutive, ubuilding=ubuilding)
            g0, w0 = po.gaps(), po.walks()
            f.placed, moves, passes = po.run(time.time() + polish_s_)
            # ขยับเสร็จแล้วช่องว่างย้ายที่ ของที่เคยลงไม่ได้อาจลงได้แล้ว
            if f.unplaced:
                left = po.place_more(f.unplaced)
                # ยังเหลือก็ไล่เบียดต่อ — ชั้นที่คาบเต็มพอดีทุกช่องต้องใช้วิธีนี้
                if left:
                    left = po.squeeze(left)
                saved = len(f.unplaced) - len(left)
                f.unplaced = left
                if saved:
                    po.run(time.time() + min(10.0, polish_s_ / 4))
                f.placed = dict(po.board.placed)
            g1, w1 = po.gaps(), po.walks()
        return {
            "found": f, "seed": sd, "moves": moves, "passes": passes,
            "rescued": saved, "g0": g0, "g1": g1, "w0": w0, "w1": w1,
            # คะแนน: ลงไม่ได้มาก่อนเสมอ แล้วค่อยดูความสวยด้วยไม้บรรทัดเดียวกับ
            # ตอนขัดเกลา (รูของเด็ก · ภาระครู · คาบติดกัน · การเดินข้ามอาคาร)
            "score": (len(f.unplaced), po.cost() if po else 0),
        }

    # ลองหลายรอบแล้วเก็บรอบที่ดีที่สุด
    #
    #   "ระบบสร้างแล้วจำ ถ้าลงไม่ได้ก็ค่อยลบลงใหม่หาทางที่ลงให้ได้"
    #
    # รอบหนึ่งใช้เวลาแค่ไม่กี่วินาที แต่ผลต่างกันมาก — วัดกับข้อมูล 30 ต.ค.
    # ได้การเดินข้ามอาคาร 69 ถึง 104 ครั้ง และคาบติดกันเกินเพดาน 20 ถึง 39
    # แล้วแต่เมล็ดสุ่ม การลองรอบเดียวจึงเป็นการทิ้งของดีไปเปล่า ๆ
    #
    # รอบแรกได้เวลาเต็มตามที่สั่ง เผื่อข้อมูลยากจริง ๆ ที่ต้องใช้เวลาทั้งก้อน
    # รอบต่อไปใช้เวลาที่เหลือ และหยุดเมื่อเวลาหมดหรือครบจำนวนรอบ
    ends = t0 + budget_s + polish_s
    best = one_try(seed, budget_s, polish_s)
    tries = 1
    spent = time.time() - t0
    while tries < max(1, int(tries_cap)) and time.time() + spent < ends:
        left = ends - time.time()
        cand = one_try(seed + tries, min(budget_s, left * 0.6),
                       min(polish_s, left * 0.4))
        tries += 1
        if cand["score"] < best["score"]:
            best = cand
        spent = max(spent, (time.time() - t0) / tries)

    found = best["found"]
    polish_moves, polish_passes, rescued = best["moves"], best["passes"], best["rescued"]
    before_gaps, after_gaps = best["g0"], best["g1"]
    before_walk, after_walk = best["w0"], best["w1"]

    by_uid = {u.uid: u for u in world.units}

    # แจกห้องทีละชั่วโมง — ในชั่วโมงเดียวกันแย่งห้องกัน คนละชั่วโมงไม่เกี่ยวกัน
    #
    # คาบคู่กินสองชั่วโมงแต่ต้องอยู่ห้องเดียวกันทั้งคู่ จึงต้อง "จอง" ห้องไว้ทุก
    # ชั่วโมงของมันตั้งแต่ตอนแจก ไม่ใช่แจกทีละชั่วโมงแล้วทับกันเอง — รอบก่อน
    # คาบคู่ได้ห้องตอนชั่วโมงที่สองก่อน แล้วถูกแจกใหม่ทับตอนชั่วโมงแรก
    # ชั่วโมงที่สองจึงเหลือห้องซ้ำกับคนอื่น (353 ฟิสิกส์ ศุกร์ คาบ 5)
    at_cell: dict[tuple[int, int], list[int]] = defaultdict(list)
    cells_of: dict[int, list[tuple[int, int]]] = {}
    for uid, (day, period) in found.placed.items():
        cells_of[uid] = [(day, n)
                         for n in Board._nums(by_uid[uid], period, world)]
        for c in cells_of[uid]:
            at_cell[c].append(uid)

    room_of: dict[int, int] = {}
    taken: dict[tuple[int, int], set[int]] = defaultdict(set)
    # (ครู, วัน) -> ชั่วโมงที่เท่าไร -> อาคารที่ครูไปยืนชั่วโมงนั้น
    #
    #   "ไม่เดินข้ามอาคารไปๆมาๆ"
    #
    # แจกห้องไล่ตามเวลา ชั่วโมงก่อนหน้าจึงรู้คำตอบแล้วเสมอ พอถึงชั่วโมงนี้ก็
    # เลือกห้องในอาคารเดิมก่อน — แต่สลับได้ภายในกลุ่มความชอบเดียวกันเท่านั้น
    # ห้องคอมพิวเตอร์ยังมาก่อนห้องประจำอยู่ดี ครูเดินไปก็ต้องเดิน
    where: dict[tuple[int, int], dict[int, int]] = defaultdict(dict)

    def rank_at(u: Unit, day: int, period: int) -> list[int]:
        return [r for r in (world.tindex.get((u.level, n))
                            for n in Board._nums(u, period, world)) if r is not None]

    for cell in sorted(at_cell):
        day, num = cell
        elig: dict[int, list[int]] = {}
        for uid in at_cell[cell]:
            u = by_uid[uid]
            if not u.needs_room or uid in room_of:
                continue
            free = [r for r in opts[uid]
                    if all(r not in taken[c] for c in cells_of[uid])]
            here = {b for tid in u.teacher_ids
                    for r in rank_at(u, day, num)
                    for b in (where[(tid, day)].get(r - 1),) if b}
            if here and len(free) > 1:
                rk = ranks_of[uid]
                pos = {rid: i for i, rid in enumerate(free)}
                free = sorted(free, key=lambda rid: (
                    rk.get(rid, 9),
                    0 if world.rbuilding.get(rid) in here else 1,
                    pos[rid]))
            elig[uid] = free
        if not elig:
            continue
        for uid, rid in assign_rooms([(uid, []) for uid in elig], elig).items():
            room_of[uid] = rid
            u = by_uid[uid]
            for c in cells_of[uid]:
                taken[c].add(rid)
            b = world.rbuilding.get(rid)
            if b:
                for tid in u.teacher_ids:
                    for r in rank_at(u, day, num):
                        where[(tid, day)][r] = b

    # สรุปเป็นคาบที่เสนอ
    proposed: list[dict[str, Any]] = []
    for uid, (day, period) in sorted(found.placed.items()):
        u = by_uid[uid]
        for n in Board._nums(u, period, world):
            for gid in u.group_ids:
                proposed.append({
                    "group_id": gid, "subject_id": u.subject_id,
                    "teacher_id": u.teacher_ids[0] if u.teacher_ids else 0,
                    "co_teacher_id": u.teacher_ids[1] if len(u.teacher_ids) > 1 else None,
                    # หน้าต่างกิจกรรมกับวิชาเสรีมีครูทั้งคณะ ไม่ใช่สองคน
                    "teacher_ids": list(u.teacher_ids),
                    "day": day, "period": n,
                    "room_id": room_of.get(uid),
                    "unit": uid, "length": u.length,
                    "is_elective": u.is_elective,
                    # กิจกรรมทั้งโรงเรียนไม่ต้องการห้องของตัวเอง เด็กอยู่ห้อง
                    # ประจำ ครูเดินไปหา — ถ้าไม่ติดธงนี้ไว้ ตัววัดจะนับว่า
                    # "ขาดห้อง" 235 คาบ ทั้งที่ตารางจริงก็ไม่มีห้องเหมือนกัน
                    # และนับไม่เท่ากันแบบนี้ทำให้เทียบสองตารางไม่ได้เลย
                    "is_activity_block": not u.needs_room and not u.is_elective,
                    "double_group_key": u.double_key,
                })
    missing = [by_uid[uid].label for uid in found.unplaced]
    no_room = sum(1 for uid in found.placed
                  if by_uid[uid].needs_room and uid not in room_of)
    return {
        "proposed": proposed,
        "units": len(world.units),
        "placed": len(found.placed),
        "unplaced": len(found.unplaced),
        "unplaced_labels": missing[:40],
        "no_room": no_room,
        "restarts": found.restarts,
        "tries": tries,
        "best_seed": best["seed"],
        "gaps_before": before_gaps,
        "gaps_after": after_gaps,
        "walk_before": before_walk,
        "walk_after": after_walk,
        "polish_moves": polish_moves,
        "polish_passes": polish_passes,
        "rescued": rescued,
        "max_per_day": max_per_day,
        "max_consecutive": max_consecutive,
        "seconds": round(time.time() - t0, 1),
        "note": found.note,
    }
