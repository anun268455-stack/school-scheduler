"""
ตั้งห้องให้คาบเสรีที่ "ไม่ได้มาจากกลุ่มวิชาเสรี" — รูปแบบที่โรงเรียนใช้จริง

   "ตอนนี้ไม่สามารถเลือกห้องได้ เพราะห้องไม่ขึ้น"

รอบแรกผมทำระบบเลือกห้องไว้บนกลุ่มวิชาเสรี (ELECTIVE_POOLS) แล้วไม่ได้ตรวจว่า
ข้อมูลของโรงเรียนเป็นรูปแบบนั้นหรือเปล่า — มันไม่ใช่ คาบเสรีของโรงเรียนถูกสร้าง
ทีละคาบแล้วคัดลอกไปห้องอื่น ตัวเลือกจึงไม่มี `key` และทุกสำเนาได้ `id` ใหม่
คนละเลข สิ่งเดียวที่ผูกสำเนาเข้าด้วยกันคือ (วิชา · ครู)

ตัวทดสอบนี้จึงสร้างข้อมูลด้วยเส้นทางจริงที่โรงเรียนใช้ (create_elective_slot +
copy_elective_slot) ไม่ใช่สร้าง dict เอง เพื่อให้ถ้ารูปแบบข้อมูลเปลี่ยนอีก
ตัวทดสอบจะรู้ด้วย
"""
import sys

import mock_api as M

fails: list[str] = []


def ok(cond: object, what: str) -> None:
    if not cond:
        fails.append(what)


GROUPS = [g["id"] for g in M._flat_groups()[:4]]
DAY = 0
PERIOD = next(p for p in M._class_periods_for_level("lower"))
R1, R2 = M.ROOMS[0]["id"], M.ROOMS[1]["id"]
T1, T2 = M.TEACHERS[0]["id"], M.TEACHERS[1]["id"]
S1, S2 = M.SUBJECTS[0]["id"], M.SUBJECTS[1]["id"]


def reset() -> None:
    """คาบเสรีของ GROUPS[0] สองวิชา แล้วคัดลอกไปอีกสองห้องเรียน"""
    M.SLOTS.clear()
    M.ELECTIVE_POOLS.clear()
    slot = M.create_elective_slot({
        "group_id": GROUPS[0], "day": DAY, "period": PERIOD,
        "subject_id": S1, "teacher_id": T1, "label": "ปฏิบัติขิม",
    })
    M.add_elective_option(slot["id"], {
        "subject_id": S2, "teacher_id": T2, "label": "ปฏิบัติซอ",
    })
    M.copy_elective_slot(slot["id"], {"target_group_ids": GROUPS[1:3]})


# ── ๑ ข้อมูลที่โรงเรียนมีจริง — ไม่มีกลุ่ม ไม่มี key ───────────────────────
reset()
rows = [s for s in M.SLOTS if s.get("is_elective")]
ok(len(rows) == 3, f"สามห้องเรียน (ได้ {len(rows)})")
ok(all(s.get("elective_pool_id") is None for s in rows),
   "คาบเสรีแบบนี้ไม่มี elective_pool_id — นี่คือสาเหตุที่ของเดิมใช้ไม่ได้")
ok(all("key" not in o for s in rows for o in s["elective_options"]),
   "และตัวเลือกไม่มี key")
ids = [o["id"] for s in rows for o in s["elective_options"] if o["teacher_id"] == T1]
ok(len(set(ids)) == len(ids),
   f"ทุกสำเนาได้ id ใหม่คนละเลข จึงใช้ id เทียบความเหมือนไม่ได้ (ได้ {ids})")

# ── ๒ ตั้งห้องด้วย (วัน · คาบ · วิชา · ครู) แล้วถึงทุกแถว ──────────────────
res = M.set_elective_room({"day": DAY, "period": PERIOD,
                           "subject_id": S1, "teacher_id": T1, "room_id": R1})
ok(len(res["slots"]) == 3, f"ไปถึงทั้งสามห้องเรียน (ได้ {len(res['slots'])})")
got = [o.get("room_id") for s in M.SLOTS for o in s.get("elective_options", [])
       if o["teacher_id"] == T1]
ok(got == [R1, R1, R1], f"ทุกสำเนาได้ห้องเดียวกัน (ได้ {got})")

others = [o.get("room_id") for s in M.SLOTS for o in s.get("elective_options", [])
          if o["teacher_id"] == T2]
ok(others == [None, None, None],
   f"วิชาอื่นในคาบเดียวกันไม่ถูกแตะ — คนละห้อง (ได้ {others})")
ok(all(s.get("room_id") is None for s in M.SLOTS),
   "ช่องห้องของตัวคาบยังว่าง — ห้องอยู่ที่วิชา ไม่ใช่ที่คาบ")

# ชื่อห้องติดกลับมากับคำตอบ หน้าจอจะได้ไม่ต้องไปเปิดทะเบียนเอง
first = res["slots"][0]
mineopt = next(o for o in first["elective_options"] if o["teacher_id"] == T1)
ok(mineopt.get("room_name") == M.ROOMS[0]["name"], "ชื่อห้องติดกลับมาด้วย")

# ── ๓ เอาห้องออกได้ ────────────────────────────────────────────────────────
M.set_elective_room({"day": DAY, "period": PERIOD,
                     "subject_id": S1, "teacher_id": T1, "room_id": None})
got = [o.get("room_id") for s in M.SLOTS for o in s.get("elective_options", [])
       if o["teacher_id"] == T1]
ok(got == [None, None, None], f"เอาห้องออกถึงทุกแถว (ได้ {got})")

# ── ๔ ห้องที่ไม่มีอยู่จริง และวิชาที่ไม่มีในคาบนั้น ────────────────────────
reset()
try:
    M.set_elective_room({"day": DAY, "period": PERIOD, "subject_id": S1,
                         "teacher_id": T1, "room_id": 999999})
    fails.append("ห้องที่ไม่มีอยู่จริงต้องถูกปฏิเสธ")
except M.HTTPException as e:
    ok(e.status_code == 400, "ห้องไม่มีจริง = 400")

try:
    M.set_elective_room({"day": DAY, "period": PERIOD, "subject_id": S1,
                         "teacher_id": M.TEACHERS[9]["id"], "room_id": R1})
    fails.append("ครูที่ไม่ได้สอนในคาบนั้นต้องถูกปฏิเสธ")
except M.HTTPException as e:
    ok(e.status_code == 404, "ไม่พบวิชาของครูคนนั้นในคาบนั้น = 404")

# ── ๕ ห้องชนถูกบอก ไม่ใช่ถูกห้าม ───────────────────────────────────────────
reset()
M.SLOTS.append({
    "id": 90101, "day": DAY, "period": PERIOD, "group_id": GROUPS[3],
    "teacher_id": M.TEACHERS[5]["id"], "subject_id": S2, "room_id": R2,
    "is_double_start": False, "parallel_group_key": None, "is_locked": False,
})
res = M.set_elective_room({"day": DAY, "period": PERIOD,
                           "subject_id": S1, "teacher_id": T1, "room_id": R2})
ok(len(res["busy"]) == 1, f"บอกว่าห้องนี้มีคนใช้อยู่ (ได้ {res['busy']})")
got = [o.get("room_id") for s in M.SLOTS for o in s.get("elective_options", [])
       if o["teacher_id"] == T1]
ok(got == [R2, R2, R2], "แต่ยังตั้งให้ — รายงาน ไม่ปฏิเสธ แบบเดียวกับครูซ้ำ")

res = M.set_elective_room({"day": DAY, "period": PERIOD,
                           "subject_id": S1, "teacher_id": T1, "room_id": R1})
ok(res["busy"] == [], f"ห้องว่างไม่มีอะไรให้บอก (ได้ {res['busy']})")

# สำเนาของวิชาตัวเองในห้องเรียนอื่น ต้องไม่ถูกนับว่าชนกับตัวเอง
ok(not any(b.get("subject_name") == "วิชาเสรี" and b.get("group_name") is None
           for b in res["busy"]), "ไม่ฟ้องตัวเอง")

# ── ๖ กลุ่มวิชาเสรีก็ยังใช้เส้นนี้ได้ และห้องต้องรอดการเขียนใหม่ ───────────
M.SLOTS.clear()
M.ELECTIVE_POOLS.clear()
pool = {
    "id": 1, "name": "เสรี ม.1", "raw_group": "ม.1/1-3",
    "group_ids": GROUPS[:3], "weekly": 1, "is_double": False,
    "day": DAY, "period": PERIOD,
    "options": [{"key": 11, "subject_id": S1, "teacher_id": T1,
                 "label": "โขน", "room_id": None}],
}
M.ELECTIVE_POOLS.append(pool)
M._sync_pool_slots(pool)
M.set_elective_room({"day": DAY, "period": PERIOD,
                     "subject_id": S1, "teacher_id": T1, "room_id": R1})
ok(pool["options"][0]["room_id"] == R1,
   "ห้องถูกเขียนลงตัวกลุ่มด้วย ไม่ใช่แค่บนแถว")
# พิสูจน์ว่ารอดจริง: เขียนแถวใหม่ทั้งชุดแล้วห้องต้องยังอยู่
M._sync_pool_slots(pool)
after = [o.get("room_id") for s in M.SLOTS for o in s.get("elective_options", [])]
ok(after == [R1] * len(after) and after,
   f"ห้องรอดการเขียนแถวใหม่ (ได้ {after})")

M.SLOTS.clear()
M.ELECTIVE_POOLS.clear()

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
