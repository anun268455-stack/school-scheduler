"""
ห้องสอนของแต่ละวิชาในคาบเสรี — ฝั่งเซิร์ฟเวอร์

   "คาบเสรี ครูมาบอกว่าต้องการห้องสอนที่นี้ ... เพื่อให้ตารางการใช้ห้องขึ้น
    คาบเสรีอันนี้"

ข้อที่ยากที่สุดและเป็นเหตุให้ต้องมีตัวทดสอบนี้: หน้าต่างคาบเสรีหนึ่งหน้าต่าง
ถูกเขียนเป็นหลายแถว แถวละห้องเรียน ทุกแถวถือสำเนาตัวเลือกชุดเดียวกัน ห้องของ
วิชาหนึ่งจึงปรากฏซ้ำเท่าจำนวนห้องเรียน ถ้าตัวตรวจไม่รู้เรื่องนี้ มันจะฟ้องว่า
ห้องชนกับตัวเอง แล้วโรงเรียนจะเลือกห้องไม่ได้เลย
"""
import sys

import mock_api as M

fails: list[str] = []


def ok(cond: object, what: str) -> None:
    if not cond:
        fails.append(what)


GROUPS = [g["id"] for g in M._flat_groups()[:3]]
DAY, PERIOD = 0, 7
ok(PERIOD in M._class_periods_for_level("lower"), "คาบที่ใช้ทดสอบต้องเป็นคาบเรียน")
R1, R2, R3 = M.ROOMS[0]["id"], M.ROOMS[1]["id"], M.ROOMS[2]["id"]
T1, T2 = M.TEACHERS[0]["id"], M.TEACHERS[1]["id"]
SUBJ = M.SUBJECTS[0]["id"]


def reset() -> dict:
    """หน้าต่างคาบเสรีหนึ่งหน้าต่าง สามห้องเรียน สองวิชา — สร้างใหม่ทุกข้อ"""
    M.SLOTS.clear()
    M.ELECTIVE_POOLS.clear()
    pool = {
        "id": 1, "name": "เสรี ม.1", "raw_group": "ม.1/1-3",
        "group_ids": list(GROUPS), "weekly": 1, "is_double": False,
        "day": DAY, "period": PERIOD,
        "options": [
            {"key": 11, "subject_id": SUBJ, "teacher_id": T1, "label": "กรีฑา",   "room_id": None},
            {"key": 12, "subject_id": SUBJ, "teacher_id": T2, "label": "ดนตรี",   "room_id": None},
        ],
    }
    M.ELECTIVE_POOLS.append(pool)
    M._sync_pool_slots(pool)
    return pool


# ── ๑ ห้องเดินทางจากกลุ่มวิชาไปถึงทุกแถวของหน้าต่าง ────────────────────────
pool = reset()
rows = [s for s in M.SLOTS if s.get("elective_pool_id") == 1]
ok(len(rows) == len(GROUPS), f"ต้องได้หนึ่งแถวต่อห้องเรียน (ได้ {len(rows)})")
ok(all(s.get("room_id") is None for s in rows), "ช่องห้องของตัวคาบยังว่างไว้เหมือนเดิม")

M.update_pool_option(1, 11, {"room_id": R1})
rows = [s for s in M.SLOTS if s.get("elective_pool_id") == 1]
got = [[o.get("room_id") for o in s["elective_options"] if o.get("key") == 11][0] for s in rows]
ok(all(r == R1 for r in got), f"ห้องต้องไปถึงทุกแถว (ได้ {got})")
ok(all(s.get("room_id") is None for s in rows),
   "ตั้งห้องให้วิชาหนึ่ง ต้องไม่ไปตั้งห้องของตัวคาบ — วิชาอื่นอยู่ห้องอื่น")

# ห้องที่ไม่มีอยู่จริงต้องไม่ถูกบันทึก
try:
    M.update_pool_option(1, 11, {"room_id": 999999})
    fails.append("ห้องที่ไม่มีอยู่จริงต้องถูกปฏิเสธ")
except M.HTTPException as e:
    ok(e.status_code == 400, "ปฏิเสธด้วย 400")
ok([o for o in pool["options"] if o["key"] == 11][0]["room_id"] == R1,
   "ถูกปฏิเสธแล้วห้องเดิมต้องไม่เปลี่ยน")

# เอาห้องออกได้
M.update_pool_option(1, 11, {"room_id": None})
ok([o for o in pool["options"] if o["key"] == 11][0]["room_id"] is None, "เอาห้องออกได้")

# ── ๒ ห้องของคาบนี้มีได้หลายห้องพร้อมกัน ───────────────────────────────────
pool = reset()
M.update_pool_option(1, 11, {"room_id": R1})
M.update_pool_option(1, 12, {"room_id": R2})
row = next(s for s in M.SLOTS if s.get("elective_pool_id") == 1)
ok(M._slot_rooms(row) == {R1, R2}, f"คาบเสรีใช้สองห้องพร้อมกัน (ได้ {M._slot_rooms(row)})")

# ── ๓ ห้องซ้ำกันในหน้าต่างเดียวกัน = ชน (รายงาน ไม่ปฏิเสธ แบบเดียวกับครู) ──
pool = reset()
M.update_pool_option(1, 11, {"room_id": R1})
d = M.update_pool_option(1, 12, {"room_id": R2})
by_key = {o["key"]: o for o in d["options"]}
ok(by_key[11]["room_conflicts"] == [], "คนละห้อง ไม่ชน")
ok(by_key[11]["room_name"] == M.ROOMS[0]["name"], "ชื่อห้องถูกเติมมาให้")

d = M.update_pool_option(1, 12, {"room_id": R1})
by_key = {o["key"]: o for o in d["options"]}
ok(len(by_key[11]["room_conflicts"]) == 1,
   f"ห้องเดียวกันสองวิชาในหน้าต่างเดียว = ชน (ได้ {by_key[11]['room_conflicts']})")
ok(by_key[11]["room_conflicts"][0]["group_name"] == "ในคาบเสรีนี้", "บอกว่าชนกับอะไร")
ok(len(by_key[12]["room_conflicts"]) == 1, "ฟ้องทั้งสองฝ่าย")

# ── ๔ สำเนาข้ามแถวของหน้าต่างตัวเอง ต้องไม่ถือเป็นการชน ────────────────────
#
# นี่คือข้อที่พลาดง่ายที่สุด: วิชา "กรีฑา" อยู่ในสามแถว (สามห้องเรียน) ด้วยห้อง
# เดียวกัน ถ้าตัวตรวจนับทีละแถว มันจะฟ้องสองครั้งทั้งที่ไม่มีอะไรผิด
pool = reset()
d = M.update_pool_option(1, 11, {"room_id": R1})
by_key = {o["key"]: o for o in d["options"]}
ok(by_key[11]["room_conflicts"] == [],
   f"สามแถวของหน้าต่างเดียวกันไม่ชนกันเอง (ได้ {by_key[11]['room_conflicts']})")
ok(M._room_busy_outside_pool(R1, pool) == [],
   "หน้าต่างตัวเองถูกข้ามตอนถามว่าห้องว่างไหม")

# ── ๕ คาบปกติในห้องเดียวกันชั่วโมงเดียวกัน = ชน ────────────────────────────
pool = reset()
M.update_pool_option(1, 11, {"room_id": R1})
M.SLOTS.append({
    "id": 90001, "day": DAY, "period": PERIOD, "group_id": GROUPS[0],
    "teacher_id": M.TEACHERS[5]["id"], "subject_id": SUBJ, "room_id": R1,
    "is_double_start": False, "parallel_group_key": None, "is_locked": False,
})
busy = M._room_busy_outside_pool(R1, pool)
ok(len(busy) == 1, f"คาบปกติที่ใช้ห้องเดียวกันต้องถูกฟ้อง (ได้ {busy})")
ok(M._room_busy_outside_pool(R3, pool) == [], "ห้องที่ไม่มีใครใช้ ว่าง")

# ชั่วโมงอื่นไม่เกี่ยว
M.SLOTS[-1]["period"] = [p for p in M._class_periods_for_level("lower") if p != PERIOD][0]
ok(M._room_busy_outside_pool(R1, pool) == [], "คนละคาบ ไม่ชน")

# ── ๖ ด่านย้ายคาบเห็นห้องของคาบเสรีด้วย ────────────────────────────────────
#
# ของเดิมเทียบ room_id ตรง ๆ คาบปกติจึงย้ายเข้าห้องที่คาบเสรีใช้อยู่ได้เงียบ ๆ
# เพราะ room_id ของคาบเสรีเป็นค่าว่างเสมอ
pool = reset()
M.update_pool_option(1, 11, {"room_id": R1})
other = [p for p in M._class_periods_for_level("lower") if p != PERIOD][0]
M.SLOTS.append({
    "id": 90002, "day": DAY, "period": other, "group_id": GROUPS[0],
    "teacher_id": M.TEACHERS[5]["id"], "subject_id": SUBJ, "room_id": R3,
    "is_double_start": False, "parallel_group_key": None, "is_locked": False,
})
probs = M._validate_moves([{"slot_id": 90002, "day": DAY, "period": PERIOD, "room_id": R1}])
ok(any("ห้อง" in p and "ถูกใช้อยู่แล้ว" in p for p in probs),
   f"ต้องฟ้องว่าห้องถูกใช้อยู่ (ได้ {probs})")

# ห้องว่างยังย้ายได้ตามปกติ — ด่านใหม่ต้องไม่ขัดของเดิม
probs = M._validate_moves([{"slot_id": 90002, "day": DAY, "period": PERIOD, "room_id": R3}])
ok(not any("ถูกใช้อยู่แล้ว" in p for p in probs),
   f"ห้องว่างต้องย้ายได้ (ได้ {probs})")

# ── ๗ ชื่อห้องเดินทางไปกับตัวเลือกตอนส่งตารางออก ────────────────────────────
pool = reset()
M.update_pool_option(1, 11, {"room_id": R1})
out = M.get_slots()
row = next(s for s in out if s.get("elective_pool_id") == 1)
mine = next(o for o in row["elective_options"] if o.get("key") == 11)
ok(mine.get("room_name") == M.ROOMS[0]["name"],
   f"ชื่อห้องต้องติดมากับตัวเลือก (ได้ {mine.get('room_name')})")
theirs = next(o for o in row["elective_options"] if o.get("key") == 12)
ok(theirs.get("room_name") is None, "วิชาที่ยังไม่มีห้อง ต้องไม่ได้ชื่อห้องของคนอื่น")

M.SLOTS.clear()
M.ELECTIVE_POOLS.clear()

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
