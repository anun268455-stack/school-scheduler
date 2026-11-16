# เว็บลงอัตรากำลัง ขั้นที่ 2 — รอบอัตรากำลัง แถววิชา งานส่ง-ตรวจ และหน้าตาใหม่

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin ทำหลักสูตรของภาคเรียนในเว็บนี้ (ตั้งต้นจากโปรแกรมจัดตารางหรือเทอมก่อน) แล้วเปิดรอบอัตรากำลังที่แถวมาจากหลักสูตร หัวหน้ากลุ่มสาระใส่ครูอย่างเดียวแล้วกดส่ง admin ตรวจผ่านหรือตีกลับ ทุกคนเปิดดูหลักสูตรและสรุปได้ และทั้งเว็บมีหน้าตาใหม่ที่สบายตา โดยข้อมูลของโปรแกรมจัดตารางไม่ถูกแตะ

**Architecture:** ฝั่งเซิร์ฟเวอร์เพิ่มตารางหลักสูตรของภาคเรียน และตารางของรอบ (แถว = บรรทัดหลักสูตร × ห้อง ที่เก็บแค่ช่องของหัวหน้า) ใน `mock_api.py` ต่อจากบล็อกของขั้นที่ 1 · การแปลงแผนการสอน + ชุดคาบเสรี + ช่องในตาราง เป็นฟังก์ชันล้วนตัวเดียว (Task 1) ใช้ตั้งต้นหลักสูตรและใส่ครูเทอมก่อน · กฎนับคาบรายครูอยู่ที่เซิร์ฟเวอร์ตัวเดียว · ฝั่งหน้าเว็บมีชุดชิ้นส่วนหน้าตา (`workload/src/ui/`) ที่ทุกหน้าใช้ และตรรกะล้วนของรอบ (`workload/src/round.ts`) ที่ทดสอบด้วย node ได้

**Tech Stack:** FastAPI (ไม่มี Pydantic) · psycopg 3 + PostgreSQL · React 18 + Vite + TypeScript + Tailwind (มีอยู่แล้วใน `workload/`) · ตัวทดสอบของ repo (`bash tests/run.sh`) · ไม่มี dependency ใหม่ทั้งสองฝั่ง

**Spec:** `docs/superpowers/specs/2026-11-16-workload-stage2-design.md` (ผู้ใช้อนุมัติ 16 พ.ย. · **ข้อ 4.5 "หลักสูตรมาก่อน" ชนะข้อ 4.1–4.3 ที่ขัดกัน**) — สร้างบน `docs/superpowers/specs/2026-11-06-workload-entry-site-design.md` ("สเปกหลัก")
ภาพทิศทางหน้าตา: `docs/superpowers/specs/2026-11-16-workload-stage2/mockup-head.png` · `mockup-admin.png`

---

## Global Constraints

- **ข้อมูลของโปรแกรมจัดตารางอ่านอย่างเดียว** — `SLOTS` `REQUIREMENTS` `TEACHERS` `SUBJECTS` `ELECTIVE_POOLS` `ROOMS` `GROUPS` `DEPARTMENTS` ห้ามเขียน และห้ามแก้ dict ในลิสต์ (ทำงานกับสำเนาหรือแค่อ่าน)
- **route ใหม่ทั้งหมดอยู่ใต้ `/api/workload/`** — จึงไม่บวกตัวนับรุ่น ไม่เซฟสแนปช็อต ไม่ติดด่านเทอมปิด (ดูคอมเมนต์ที่ `WORKLOAD_PREFIX`)
- **ข้อความที่ผู้ใช้เห็นเป็นภาษาไทยทุกข้อความ** รวม `detail` ของเซิร์ฟเวอร์
- **ไม่เพิ่ม dependency** ทั้ง `requirements.txt` และ `workload/package.json`
- **อ้างครูและวิชาด้วยรหัส ไม่ใช่ชื่อ** — แถวของรอบอ้าง `wl_teachers.id` / `wl_subjects.id` · ห้ามจับคู่ด้วยชื่อแม้เป็นทางสำรอง
- **ไม่มี endpoint ลบครูหรือลบวิชา** (ลบแถวของรอบ/ชุดคาบเสรีได้ เป็นของ admin)
- **หัวหน้ากลุ่มสาระเห็นและแก้ได้แค่กลุ่มตัวเอง บังคับที่เซิร์ฟเวอร์** ไม่ใช่แค่ซ่อนบนหน้าจอ
- **"ยังไม่ยืนยัน" หายได้เพราะคนกดเท่านั้น** — ยืนยัน หรือเลือกครูเอง
- **ห้ามสร้าง unique index ใหม่บนตารางที่มีข้อมูลจริงอยู่แล้ว** (`wl_codes` `wl_teachers` `wl_subjects`) — ถ้าข้อมูลจริงขัดกับ index การสร้างจะล้ม แล้วทุก route ของเว็บนี้ตอบ 503
- ใช้ของขั้นที่ 1 แบบเดิม: `with _wl_db() as cur:` · `wl_require_session` / `wl_require_admin` กับ `cur` ของบล็อกเดียวกัน · `body: Any = Body(None)` + `_wl_require_body` · `wl_clean_fields` · ค่าทุกค่าผ่าน `%s`
- หน้าเว็บ: ข้อผิดพลาดทุกที่ผ่าน `apiErrorText` · ไม่มี react-router · ตรรกะที่ตัดสินอะไรอยู่ในไฟล์ล้วนที่ node รันได้ (เหมือน `auth.ts` `registry.ts` `codes.ts`)
- ทุก task จบด้วย `bash tests/run.sh` ผ่านครบ · task ที่แตะ `workload/` จบด้วย `npm run lint` และ `npm run build` ใน `workload/` สะอาด · แล้ว commit

## สัญญาที่ทุก task ใช้ร่วมกัน

ชื่อสถานะในโค้ดเป็นอังกฤษ ป้ายบนจอเป็นไทย (ป้ายอยู่ใน `workload/src/round.ts` ที่เดียว)

| สิ่ง | รูป JSON ที่ route คืน |
|---|---|
| รอบ | `{id, year, semester, label, status: "preparing"\|"filling"\|"closed", opened_at, closed_at, counts: {rows, sets, unconverted}}` · `label` = `"2/2569"` |
| หลักสูตร | `{id, year, semester, name, level, note, group_ids, group_names, lines: [บรรทัด]}` |
| บรรทัดหลักสูตร | `{id, curriculum_id, subject_id\|null, code, name, credits\|null, weekly, kind: "basic"\|"additional"\|"activity", department_id\|null, sort}` |
| ชุด (ของภาคเรียน) | `{id, year, semester, kind: "elective"\|"activity", name, group_ids, group_names, weekly, is_double, options: [{id, set_id, subject_id\|null, code, name, department_id\|null}]}` |
| บันทึกหลักสูตร | `{id, at, by, action, detail}` (ข้อความไทย) |
| แถว (ของรอบ) | `{id, round_id, line_id, curriculum_id, curriculum_name, group_id, group_name, subject_id\|null, code, name, credits\|null, weekly, kind, department_id\|null, teacher_id\|null, co_teacher_id\|null, lab_room_id\|null, is_double, note, confirmed, from_plan, flag\|null}` — ช่องวิชาอ่านจากบรรทัดหลักสูตร (join) ไม่ได้เก็บในแถว |
| ครูของตัวเลือก | `{id, round_id, option_id, set_id, teacher_id\|null, room_id\|null, note, confirmed, from_plan}` — ตัวเลือกหนึ่งมีได้หลายแถว |
| สถานะกลุ่ม | `{department_id, status: "filling"\|"submitted"\|"returned"\|"approved", submitted_at, submitted_by, reviewed_at, reviewed_by, note}` |
| ยอดคาบ | `{teacher_id, name, department_id, total, own}` · `own` = ส่วนที่มาจากกลุ่มของผู้ขอ (admin: เท่ากับ `total`) |

`group_name` / `group_names` เติมตอนส่งออกจาก `_flat_groups()` · ห้องที่ไม่มีแล้วเป็น `"ห้องที่ไม่มีแล้ว (รหัส N)"`

## Review Focus

ห้าเรื่องที่สเปกบอกเป็นนัยและจะกัดคนใช้ก่อน — แต่ละข้อมีตัวทดสอบอยู่ใน task เจ้าของโค้ด

1. **หัวหน้ากลุ่ม ก ส่งคำขอตรงไปที่แถว/ตัวเลือก/สถานะของกลุ่ม ข** → 403 ไทย ไม่ใช่สำเร็จเงียบ ๆ และไม่ใช่ 500 (Task 3, Task 4)
2. **รอบถูกปิด หรือกลุ่มถูกส่งแล้ว ขณะอีกคนยังเปิดหน้ากรอกค้างไว้** → การบันทึกถัดไปถูกปฏิเสธ 409 ไทยที่บอกเหตุผล และหน้าเว็บโหลดสถานะใหม่ ไม่ใช่ทิ้งค่าที่พิมพ์เงียบ ๆ (Task 3, Task 8)
3. **ครูที่ทำเครื่องหมาย "ไม่ปฏิบัติงานแล้ว" แต่ยังอยู่ในแถวของรอบ** → ชื่อยังแสดงในแถวนั้น (ไม่กลายเป็นช่องว่าง) แต่ไม่มีให้เลือกใหม่ (Task 3, Task 8)
4. **admin ลบบรรทัดหลักสูตรหรือเอาห้องออก ขณะหัวหน้ากลุ่มใส่ครูไว้แล้ว** → ไม่ลบเงียบ ๆ ต้องได้ 409 บอกจำนวนแถวที่มีครู และต้องยืนยันซ้ำ (Task 2, Task 3) · แผนการสอนอ้างครู/วิชา/ห้องที่ไม่มีแล้ว → รายการ "แปลงไม่ได้" ไม่ใช่ 500 (Task 1)
5. **หัวหน้ากลุ่มเปิดจากโทรศัพท์ กลุ่มมี 258 แถว** → แถวจัดกลุ่มตามวิชาแบบพับได้ ตัวกรองทำงาน หน้าไม่เลื่อนแนวนอนทั้งหน้า (Task 8)

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `mock_api.py` (แก้) | ตารางหลักสูตรและของรอบ · ฟังก์ชันล้วนแปลงแผน (Task 1) · กฎนับคาบ · route ของหลักสูตร รอบ แถว ครูของตัวเลือก สถานะกลุ่ม ยอดคาบ — ต่อท้ายบล็อก `/api/workload/` ของขั้นที่ 1 ตามแบบของไฟล์ |
| `tests/py/wlround.py` · `wlcurriculum.py` · `wlopen.py` · `wlrows.py` · `wlflow.py` | ตัวทดสอบฝั่งเซิร์ฟเวอร์ |
| `tests/fixtures/seed_teacher_loads.json` | คำตอบร่วม: ยอดคาบรายครูจาก `teacherLoads` ของโปรแกรมจัดตารางบนข้อมูลตั้งต้น |
| `tests/ts/wlloads.ts` | ยืนยันว่าไฟล์คำตอบร่วมตรงกับ `teacherLoads` จริง |
| `workload/src/ui/` (ใหม่) | ชิ้นส่วนหน้าตา: `AppShell.tsx` `Button.tsx` `Card.tsx` `Chip.tsx` `Progress.tsx` `Segmented.tsx` `StatTile.tsx` `Notice.tsx` `EmptyState.tsx` `index.ts` |
| `workload/src/index.css` · `workload/tailwind.config.js` (แก้) | โทเค็นสีและตัวอักษรของสเปกข้อ 6 |
| `workload/src/round.ts` (ใหม่) + `tests/ts/wlround.ts` | ตรรกะล้วนของรอบ: ป้ายสถานะ จัดกลุ่มแถว ตัวกรอง ความคืบหน้า เงื่อนไขกดส่ง |
| `workload/src/roundApi.ts` (ใหม่) | ตัวเรียก route ของรอบ (ใช้ axios instance เดิมจาก `api.ts`) |
| `workload/src/curriculum.ts` (ใหม่) + `tests/ts/wlcurriculum.ts` | ตรรกะล้วนของหน้าหลักสูตร |
| `workload/src/pages/CurriculumPage.tsx` · `CurriculumEditor.tsx` · `RoundsPage.tsx` · `RoundOverview.tsx` · `HeadFillPage.tsx` · `SummaryPage.tsx` (ใหม่) | หน้าจอขั้นที่ 2 |
| `workload/src/sheets.ts` (ใหม่) + `tests/ts/wlsheets.ts` | ตรรกะล้วนของหน้าสรุปแบบรายวิชาและแบบครูผู้สอน |
| `workload/src/pages/*.tsx` เดิม · `App.tsx` (แก้) | ย้ายมาใช้ชิ้นส่วน `ui/` และเมนูใหม่ |
| `docs/workload-setup.md` (แก้) | วิธีใช้ขั้นที่ 2 สำหรับ admin และหัวหน้ากลุ่ม |

---

## Task 1: ตารางของรอบ และการแปลงแผนการสอนเป็นรอบ (ฟังก์ชันล้วน)

**Files:**
- Modify: `mock_api.py` — ต่อ `_WL_SCHEMA` · เพิ่มฟังก์ชันล้วนหลังบล็อกปุ่มดึง (`_wl_import_from_scheduler`)
- Test: `tests/py/wlround.py`

**Interfaces:**
- Consumes: `_wl_schema(cur)` (ต่อท้าย DDL เดิม — `CREATE ... IF NOT EXISTS` ทั้งหมด)
- Produces:
  - ตาราง (ชื่อคอลัมน์ตรงกับ "สัญญา" ข้างบน): `wl_rounds` (UNIQUE `(year, semester)` · CHECK status · ดัชนี unique บนนิพจน์ `((status <> 'closed')) WHERE status <> 'closed'` = มีรอบที่ยังไม่ปิดได้รอบเดียว) · `wl_rows` (FK `round_id` → `wl_rounds` · `subject_id` → `wl_subjects` · `teacher_id` `co_teacher_id` → `wl_teachers` · `weekly integer NOT NULL CHECK (weekly >= 0)` · `credits numeric`) · `wl_sets` (`group_ids integer[] NOT NULL`) · `wl_set_options` (FK `set_id` `ON DELETE CASCADE`) · `wl_dept_status` (PK `(round_id, department_id)`)
  - `wl_kind_from_code(code: str, is_activity: bool) -> str` — `"activity"` ถ้า `is_activity` · หลักที่ 4 ของรหัส (ดัชนี 3) `"2"` → `"additional"` · อื่น ๆ → `"basic"`
  - `wl_round_proposal(src: dict) -> dict` — ฟังก์ชันล้วน ไม่อ่านตัวแปรกลาง ไม่แก้ `src`
    - `src` = `{"requirements", "pools", "slots", "sched_subjects": {sched_id: dict}, "groups": {gid: dict}, "teacher_ids": {sched_tid: wl_tid}, "subject_ids": {sched_sid: wl_sid}, "subject_depts": {wl_sid: dept|None}, "served": set[req_id]}`
    - คืน `{"rows": [...], "sets": [...], "unconverted": [{"source", "ref", "reason"}], "counts": {"rows", "sets_elective", "sets_activity", "co_merged", "served_skipped"}}` · แถว/ตัวเลือกคืนแบบยังไม่มี `id` / `round_id`

กฎการแปลง (ตามสเปกข้อ 4.1 · 4.2 · 4.4 ก.)

- แถวแผน 1 แถว → แถวรอบ 1 แถว: `group_id` · `subject_id` (แปลงผ่าน `subject_ids`) · `code` `name` `credits` จากวิชาฝั่งตาราง · `weekly` · `kind` = `wl_kind_from_code` · `teacher_id` (แปลงผ่าน `teacher_ids`) · `department_id` = `subject_depts[subject_id]` · `confirmed=False` · `from_plan=True`
- คู่สอนร่วม = สองแถวของห้อง+วิชาเดียวกันที่ `co_teacher_id` ของแถวหนึ่งชี้ครูของอีกแถว (กฎเดียวกับ `coTeachHalves` ใน `frontend/src/utils/teachingLoad.ts`) · `weekly` เท่ากัน → รวมเป็นแถวเดียว `co_teacher_id` = ครูของแถวที่สอง · ไม่เท่า → คงสองแถว `flag = "สอนร่วมในแผนเดิมคาบไม่เท่ากัน"`
- แถวที่ id อยู่ใน `served` → ไม่สร้างแถว นับใน `served_skipped`
- ชุดใน `pools` → ชุด `kind="elective"` ชื่อ/ห้อง/`weekly`/`is_double` ตามชุด · ตัวเลือกละ 1 ต่อ option (`teacher_id` แปลง · `department_id` = กลุ่มของวิชา · `confirmed=False`)
- ช่อง `slots` ที่ `is_elective` และไม่ได้อยู่ในชุดของ `pools` (ห้องอยู่ใน `group_ids` ของชุดที่มีชุดรหัสวิชาเดียวกัน) → จัดกลุ่มด้วยคีย์ `frozenset((subject_id, teacher_id) ของตัวเลือก)` · ห้องของชุด = ห้องทั้งหมดที่มีคีย์นั้น · `weekly` = จำนวนช่องของคีย์นั้นต่อห้อง (ห้องที่จำนวนไม่เท่ากันแยกเป็นชุดละจำนวน) · ชื่อ `"คาบเสรี " + ช่วงห้อง`
- ช่อง `slots` ที่ `is_activity_block` หรือวิชา `is_activity` → จัดกลุ่มด้วย `(subject_id, frozenset(ครูคุมทั้งหมด = teacher_id + activity_teacher_ids))` → ชุด `kind="activity"` ตัวเลือกละ 1 ต่อครูคุม วิชาเดียวกัน · `weekly` = จำนวนช่องต่อห้อง
- ช่องที่เป็นคาบปกติ (ไม่ใช่สองแบบข้างบน) ไม่ยก — มีแถวแผนอยู่แล้ว
- ครู/วิชาที่แปลงไม่ได้ → ช่องนั้นเป็น `None` และต่อท้าย `unconverted` ด้วยเหตุผลภาษาไทย · ห้องเรียนที่ไม่มีใน `groups` → ยังสร้างแถว และต่อท้าย `unconverted`

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/py/wlround.py` (สร้าง `src` ด้วยมือ ไม่อ่าน `school_data.json` ยกเว้นตัวทดสอบสุดท้าย)

```python
def test_plan_row_becomes_unconfirmed_round_row(): ...
    # weekly / code / name / credits / kind / teacher_id แปลงแล้ว / department_id / confirmed False / from_plan True
def test_kind_from_code():
    assert mock_api.wl_kind_from_code("ท21102", False) == "basic"
    assert mock_api.wl_kind_from_code("ท21204", False) == "additional"
    assert mock_api.wl_kind_from_code("ก21901", True) == "activity"
def test_co_teach_pair_merges_when_weekly_equal(): ...      # 2 แถว → 1 แถว · co_teacher_id · counts["co_merged"] == 1
def test_co_teach_pair_with_unequal_weekly_stays_two_rows_flagged(): ...
def test_two_teachers_not_naming_each_other_stay_two_rows(): ...
def test_rows_taught_in_elective_window_are_skipped(): ...  # served = {req_id} → ไม่มีแถว · served_skipped == 1
def test_pool_becomes_elective_set_with_unconfirmed_options(): ...
def test_per_class_elective_slots_become_sets_grouped_by_options(): ...
    # 3 ห้อง ตัวเลือกเหมือนกัน 2 ช่อง/ห้อง → 1 ชุด weekly 2 · อีกห้องตัวเลือกต่าง → ชุดที่สอง
def test_elective_slots_already_in_a_pool_are_not_duplicated(): ...
def test_activity_block_becomes_activity_set_one_option_per_supervisor(): ...
def test_every_taught_slot_appears_somewhere_in_the_round(): ...
    # ตารางสังเคราะห์ผสมคาบปกติ/คาบเสรี/กิจกรรม: ทุก (ครู, วิชา) ในช่องที่มีครู ต้องอยู่ในแถวหรือตัวเลือกของรอบ
def test_unknown_teacher_and_group_are_reported_not_fatal(): ...
def test_input_is_not_mutated(): ...                       # deepcopy ก่อน แล้วเทียบ
def test_seed_plan_converts_fully():
    # school_data.json: แถวรอบ == 1220 (ไม่มีคู่สอนร่วม ไม่มี served) · ชุดคาบเสรี == 13 · unconverted == []
def test_schema_has_one_open_round_index_and_no_new_index_on_existing_tables(): ...
    # ตรวจข้อความ _WL_SCHEMA: มี wl_rounds_one_open · ไม่มี CREATE UNIQUE INDEX ใหม่ที่ ON wl_teachers / wl_subjects / wl_codes
```

- [ ] **Step 2: รันให้เห็นว่าแดง** — `bash tests/run.sh` → `FAIL py/wlround.py` (AttributeError)
- [ ] **Step 3: ต่อ `_WL_SCHEMA` และเขียน `wl_kind_from_code` · `wl_round_proposal`**
- [ ] **Step 4: รันตัวทดสอบ** — `bash tests/run.sh` → ผ่านครบ (จำนวนไฟล์ +1)
- [ ] **Step 5: ลองสร้างตารางกับ Postgres จริงในเครื่อง** — เปิดเซิร์ฟเวอร์ · `curl /api/workload/health` 200 · `\d wl_rows` ครบคอลัมน์ · INSERT รอบที่สองที่ยังไม่ปิดต้องได้ 23505 · เรียก health ซ้ำไม่พัง
- [ ] **Step 6: Commit** — `git commit -m "เว็บลงอัตรากำลังขั้นที่ 2: ตารางของรอบ และการแปลงแผนการสอนกับตารางเป็นแถวของรอบ"`

---

## Task 2: หลักสูตรของภาคเรียน — ตาราง route บันทึกการแก้ และการตั้งต้น

แบบข้อ 4.5 · ผู้ใช้: "ทุกๆคนเวลาสงสัยจะได้เปิดหลักสูตรดูได้ แถมสามารถตรวจสอบย้อนกลับมาได้ด้วย"

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlcurriculum.py`

**Interfaces:**
- Consumes: `wl_round_proposal` · `wl_kind_from_code` (Task 1) · ตัวช่วยของขั้นที่ 1 (`_wl_import_from_scheduler` แยกส่วนกลางออกเป็น `_wl_import_rows(cur, kind, source, write)` ที่ไม่ตรวจสิทธิ์และไม่เปิดการเชื่อมต่อ — route ดึงครู/วิชาเดิมเรียกมัน พฤติกรรมเดิมทุกอย่าง)
- Produces:
  - ตาราง (ต่อ `_WL_SCHEMA`): `wl_curricula` (UNIQUE `(year, semester, name)`) · `wl_curriculum_lines` (FK `curriculum_id` ON DELETE CASCADE · `subject_id` → `wl_subjects` · `weekly integer NOT NULL CHECK (weekly >= 0)` · `credits numeric` · `sort integer`) · `wl_curriculum_groups` (`curriculum_id` FK CASCADE · `year` `semester` `group_id` · PK `(year, semester, group_id)` = ห้องหนึ่งอยู่หลักสูตรเดียวต่อภาคเรียน) · `wl_term_sets` (`year` `semester` `kind` `name` `group_ids integer[]` `weekly` `is_double`) · `wl_term_set_options` (FK `set_id` CASCADE · `subject_id` `code` `name` `department_id`) · `wl_curriculum_log` (`year` `semester` `at` `by_label` `action` `detail`)
  - **ตารางของรอบจาก Task 1 ปรับรูป** (ยังไม่เคยขึ้นเว็บ จึงแก้ `CREATE TABLE` ตรง ๆ ได้): `wl_rows` = `id, round_id, line_id → wl_curriculum_lines, group_id, teacher_id, co_teacher_id, lab_room_id, is_double, note, confirmed, from_plan, flag` + UNIQUE `(round_id, line_id, group_id)` · `wl_sets`/`wl_set_options` ของ Task 1 แทนด้วย `wl_option_teachers` = `id, round_id, option_id → wl_term_set_options, teacher_id, room_id, note, confirmed, from_plan` · `wl_rounds` `wl_dept_status` คงเดิม
  - `wl_curricula_from_proposal(proposal: dict, groups: dict[int, dict]) -> {"curricula": [{name, level, group_ids, lines: [...]}], "sets": [...]}` — ฟังก์ชันล้วน: ห้องที่ชุดบรรทัด (subject_id, weekly) เหมือนกันทุกตัวรวมเป็นหลักสูตรเดียว · ชื่อ = ระดับชั้น + ช่วงห้อง (เช่น `"ม.1/1-6"`) ชื่อซ้ำเติมเลขต่อท้าย · `level` จากชื่อห้อง · บรรทัดเรียงตามรหัสวิชา · ชุดคาบเสรี/กิจกรรมจาก `proposal["sets"]` (ตัดครูทิ้ง — หลักสูตรไม่มีครู)
  - `wl_curriculum_view(cur, year, semester) -> {"curricula": [...], "sets": [...], "locked": bool}` · `locked` = มีรอบของภาคเรียนนี้ที่ `closed`
  - `GET  /api/workload/curricula?year=&semester=` — **ทุก session** (หัวหน้าก็เห็นทั้งโรงเรียน) · `GET /api/workload/curricula/terms` → ภาคเรียนที่มีหลักสูตร เรียงใหม่ก่อน · `GET /api/workload/curricula/log?year=&semester=` — ทุก session
  - admin เท่านั้น (ทุกตัวปฏิเสธ 409 ไทยเมื่อ `locked`): `POST /api/workload/curricula/seed` `{year, semester, source: "timetable"|"copy", from_year?, from_semester?}` (ภาคเรียนต้องยังไม่มีหลักสูตร 409 · `"timetable"` ดึงครู+วิชา (`_wl_import_rows` โหมดเขียน) แล้วแปลงด้วย `wl_round_proposal` + `wl_curricula_from_proposal` · ปฏิเสธ 503 เมื่อ `_db_write_blocked()`) · `POST/PUT/DELETE /api/workload/curricula[/{id}]` (ชื่อ ระดับ หมายเหตุ ห้อง) · `POST/PUT/DELETE /api/workload/curriculum-lines[/{id}]` · `POST/PUT/DELETE /api/workload/term-sets[/{id}]` · `POST/DELETE /api/workload/term-set-options[/{id}]`
  - บรรทัดใหม่: รหัสที่ตรงกับวิชาในทะเบียน (ตัดช่องว่าง เทียบตรงตัว) → ผูก `subject_id` และเติม ชื่อ กลุ่มสาระ จากทะเบียน · `kind` ถ้าไม่ส่ง = `wl_kind_from_code`
  - ห้องที่อยู่หลักสูตรอื่นของภาคเรียนเดียวกันแล้ว → 409 ไทยบอกชื่อหลักสูตรนั้น
  - `_wl_log(cur, year, semester, session, action, detail)` — ทุกการเขียนของหลักสูตรเรียกในธุรกรรมเดียวกัน · `detail` ไทย เช่น `"เพิ่ม ท21102 ภาษาไทยพื้นฐาน 2 (3 คาบ) ในหลักสูตร ม.1/1-6"`
  - **รหัสวิชาห้ามซ้ำในทะเบียนวิชา** (สเปกข้อ 4.2): `POST /api/workload/subjects` และ `PUT` ที่เปลี่ยน `code` เป็นรหัสที่วิชาอื่นใช้อยู่ (ตัดช่องว่าง เทียบตรงตัว รวมวิชาที่ไม่เปิดสอนแล้ว) → 409 ไทย · ปุ่มดึงวิชา: รหัสชนกับวิชาที่มีอยู่แต่ `sched_id` ต่าง → ไม่สร้าง นับ `skipped`
  - การลบบรรทัด/ห้อง/ตัวเลือกเมื่อมีรอบของภาคเรียนนั้นเปิดอยู่ ใช้ `_wl_sync_round` ของ Task 3 (Task 2 เขียนให้เรียก hook ที่ยังไม่ทำอะไร `_wl_after_curriculum_change(cur, year, semester, force)` ซึ่ง Task 3 เติม)

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/py/wlcurriculum.py`
  - `wl_curricula_from_proposal`: 6 ห้องรายวิชาเหมือนกัน + 1 ห้องต่าง → 2 หลักสูตร ชื่อ `"ม.1/1-6"` และชื่อของห้องเดี่ยว · ห้องย่อย ม.4/6ก ใช้ระดับ ม.4 · ชุดไม่มีครู · ไม่แก้ input · ข้อมูลตั้งต้น: ทุกห้องที่มีแผนอยู่ในหลักสูตรเดียวพอดี และผลรวม (บรรทัด × ห้อง) = 1,220
  - `test_head_can_read_curricula_and_log_of_all_departments` · `test_head_cannot_write_any_curriculum_route (403)`
  - `test_seed_from_timetable_twice_is_409` · `test_seed_copy_from_previous_term_copies_lines_groups_sets` · `test_seed_refuses_when_write_blocked (503)`
  - `test_group_in_two_curricula_same_term_is_409` · `test_line_code_matching_registry_binds_subject_name_and_department`
  - `test_every_write_logs_one_thai_entry` · `test_locked_term_refuses_every_write (409)`
  - `test_duplicate_subject_code_is_409_on_create_and_rename` · `test_subject_import_skips_code_clash_with_other_sched_id` · `test_import_routes_unchanged_after_split`
  - `test_schema_round_rows_reference_curriculum_lines` (ข้อความ `_WL_SCHEMA`: `wl_rows` มี `line_id` และไม่มีคอลัมน์ `code`/`weekly` · ไม่มี unique index ใหม่บน `wl_codes`/`wl_teachers`/`wl_subjects` นอกจากสองตัวเดิม)
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนตาราง ฟังก์ชันล้วน ตัวช่วย และ route**
- [ ] **Step 4: รันตัวทดสอบ** → ผ่านครบ (ตัวทดสอบของ Task 1 ที่ตรวจรูปตารางเดิมแก้ตามรูปใหม่ได้ ห้ามลดสิ่งที่มันพิสูจน์ด้านการแปลง)
- [ ] **Step 5: ลองกับของจริง** (ฐานข้อมูลใหม่) — ตั้งต้นจากโปรแกรมจัดตาราง → จำนวนหลักสูตร บรรทัด ห้อง ชุด · หัวหน้าอ่านได้ เขียนไม่ได้ · เพิ่ม/แก้/ลบบรรทัด → log มีครบ · คัดลอกไปภาคเรียนถัดไป · revision ไม่ขยับ · `GET /api/subjects/` `/api/timetable/slots` เหมือนเดิมทุกไบต์
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: หลักสูตรของภาคเรียน ทุกคนเปิดดูได้ แก้ได้เฉพาะผู้ดูแลระบบ พร้อมบันทึกการแก้"`

---

## Task 3: เปิดรอบจากหลักสูตร ครูเทอมก่อน และการตามหลักสูตร

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlopen.py`

**Interfaces:**
- Consumes: ตารางของ Task 2 · `wl_round_proposal` (Task 1) · `_wl_after_curriculum_change` (hook ของ Task 2)
- Produces:
  - `wl_prefill(proposal: dict, line_keys: list[{"line_id", "group_id", "sched_subject_id"}], option_keys: list[{"option_id", "group_ids", "sched_subject_id"}]) -> {"rows": {(line_id, group_id): {"teacher_id", "co_teacher_id", "lab_room_id", "flag"}}, "options": {option_id: [{"teacher_id", "room_id"}]}}` — ฟังก์ชันล้วน: ครูเทอมก่อนของ ห้อง+วิชา (เทียบ `sched_id` ของวิชา) และของตัวเลือก (วิชาเดียวกัน + ห้องซ้อนกัน)
  - `_wl_round_rows_sql` — SELECT ของแถวที่ join บรรทัดหลักสูตรและหลักสูตร ให้รูป "แถว (ของรอบ)" ในสัญญา (ทุก route ที่คืนแถวใช้ตัวนี้)
  - `wl_round_view(row) -> dict` — รูป "รอบ" ในสัญญา · `counts` = `{rows, options, unconverted}` · เก็บรายการ `unconverted` ไว้ในรอบ (`jsonb`)
  - `GET  /api/workload/rounds` — ทุก session · admin ทุกรอบ · หัวหน้าเฉพาะ `filling`/`closed` · `GET /api/workload/rounds/{round_id}` (admin · มี `unconverted`)
  - `GET  /api/workload/rounds/preview?year=&semester=` — admin · **ไม่เขียนอะไรเลย** · ต้องมีหลักสูตรของภาคเรียนนั้น (409 ไทยถ้าไม่มี "ทำหลักสูตรก่อน") · คืน `{label, rows, options, prefilled_rows, prefilled_options, empty_rows, lines_without_department, unconverted}`
  - `POST /api/workload/rounds` `{year, semester}` — admin · ธุรกรรมเดียว: สร้างรอบ `preparing` → แถว = ทุก (บรรทัด × ห้องของหลักสูตร) → ครูของตัวเลือก = แถวละครูเทอมก่อน (ไม่มี = ไม่มีแถว) → ใส่ครูเทอมก่อนด้วย `wl_prefill` (`confirmed=False` `from_plan=True`) → `wl_dept_status` ทุกกลุ่มใน `DEPARTMENTS` = `filling` · ปี/ภาคผิด 400 · ซ้ำ 409 · มีรอบยังไม่ปิด 409 (ดัชนี `wl_rounds_one_open`) · `_db_write_blocked()` 503
  - `POST /api/workload/rounds/{round_id}/open` — `preparing` → `filling` · มีบรรทัดหลักสูตรที่ `department_id` ว่าง → 409 ไทยพร้อมจำนวน · `POST .../close` `{confirm_label}` — พิมพ์ชื่อรอบตรง → `closed` (หลักสูตรของภาคเรียนนั้นกลายเป็นอ่านอย่างเดียว)
  - `_wl_sync_round(cur, year, semester, force: bool) -> dict` — เติม hook ของ Task 2: เมื่อหลักสูตรของภาคเรียนที่มีรอบ `preparing`/`filling` เปลี่ยน → สร้างแถวที่ขาด (บรรทัด/ห้องใหม่ · ไม่มีครู) · ลบแถวที่บรรทัด/ห้องหายไป และครูของตัวเลือกที่ตัวเลือกหายไป · **ถ้าแถว/ครูที่จะลบมีครูใส่ไว้และ `force` เป็นเท็จ → ยก 409 ไทยบอกจำนวน และไม่เขียนอะไรเลย** · route ของหลักสูตรใน Task 2 รับ `force` จาก body/query ส่งต่อมา
  - ด่าน: ปี 2500–2700 · ภาค 1 หรือ 2

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/py/wlopen.py`
  - `wl_prefill`: ห้อง+วิชาตรง → ครูเดิม · วิชาเดียวกันคนละห้อง → ไม่ใส่ · คู่สอนร่วม → `co_teacher_id` · ตัวเลือกคาบเสรีห้องซ้อนกัน → ครู · ไม่แก้ input
  - `test_preview_writes_nothing_and_requires_curriculum` · `test_create_round_rows_equal_lines_times_groups` · `test_prefilled_rows_are_unconfirmed_and_from_plan` · `test_second_open_round_is_409` · `test_duplicate_year_semester_is_409` · `test_bad_year_or_semester_is_400` · `test_open_refuses_lines_without_department` · `test_close_requires_typed_label` · `test_closed_round_locks_its_curriculum` · `test_head_sees_only_filling_and_closed_rounds` · `test_head_cannot_preview_create_open_close (403)` · `test_write_blocked_is_503`
  - sync: `test_new_line_adds_rows_without_teacher` · `test_removing_line_with_teacher_is_409_and_writes_nothing` (Review Focus 4) · `test_removing_with_force_deletes_rows` · `test_removing_group_from_curriculum_removes_its_rows`
  - ข้อมูลตั้งต้นทั้งเส้น: ตั้งต้นหลักสูตร (Task 2) → เปิดรอบ → แถว 1,220 · ทุกแถวมีครูเทอมก่อน `confirmed=False`
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนฟังก์ชันล้วน ตัวช่วย route และเติม hook**
- [ ] **Step 4: รันตัวทดสอบ** → ผ่านครบ
- [ ] **Step 5: ลองกับของจริง** — ตั้งต้นหลักสูตร → preview (`count(*) wl_rows` ยัง 0) → เปิดรอบ → 1,220 แถว 11 สถานะกลุ่ม → เพิ่มบรรทัด → แถวใหม่ · ใส่ครูในแถวด้วย psql แล้วลบบรรทัด → 409 → force → หาย · open → close · revision ไม่ขยับ · ข้อมูลของโปรแกรมจัดตารางเหมือนเดิมทุกไบต์
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: เปิดรอบจากหลักสูตร ใส่ครูเทอมก่อนให้ยืนยัน และแถวตามหลักสูตรเมื่อหลักสูตรเปลี่ยน"`

---

## Task 4: ใส่ครู สิทธิ์ ส่ง-ตรวจ-ตีกลับ และยอดคาบรายครู

**Files:**
- Modify: `mock_api.py`
- Create: `tests/fixtures/seed_teacher_loads.json` · `tests/ts/wlloads.ts`
- Test: `tests/py/wlrows.py` · `tests/py/wlflow.py`

**Interfaces:**
- Consumes: ตาราง Task 2–3 · `_wl_round_rows_sql` (Task 3)
- Produces:
  - `WL_ROW_FIELDS = frozenset({"teacher_id","co_teacher_id","lab_room_id","is_double","note","confirmed"})` · `WL_OPTION_TEACHER_FIELDS = frozenset({"teacher_id","room_id","note","confirmed"})` — **ช่องเดียวที่แก้ได้ในรอบ** (วิชา คาบ ห้องเรียน แก้ที่หลักสูตร)
  - `wl_can_edit(session: dict, round_status: str, dept_status: str|None, dept: int|None) -> str|None` — ฟังก์ชันล้วน คืนข้อความไทยเมื่อห้าม: รอบ `closed` ห้ามทุกคน · admin: `preparing`/`filling` ทุกกลุ่มทุกสถานะ · head: รอบ `filling` · `dept == session.department_id` · สถานะกลุ่ม `filling`/`returned`
  - `wl_apply_teacher_change(fields: dict) -> dict` — มี `teacher_id` และไม่ได้ส่ง `confirmed` → เติม `confirmed=True`
  - `GET  /api/workload/rounds/{round_id}/rows?department_id=` → `{"rows": [...], "options": [{ตัวเลือก + set ของมัน + teachers: [ครูของตัวเลือก]}]}` · head: บังคับกลุ่มตัวเอง (ค่าที่ส่งมาถูกเมิน) รอบต้องไม่ใช่ `preparing` (403) · ตัวเลือกที่ head เห็น = ของกลุ่มตัวเองเท่านั้น (สเปกหลักข้อทดสอบ 9) · admin: `department_id=none` = บรรทัดที่ไม่มีกลุ่ม
  - `PUT  /api/workload/rows/{id}` · `POST /api/workload/rows/bulk` `{ids, set: {teacher_id?|confirmed?}}` (ทั้งหมดหรือไม่เลย) · `POST /api/workload/options/{option_id}/teachers` `{teacher_id, room_id?, note?}` (เพิ่มครูในตัวเลือก · `confirmed=True`) · `PUT /api/workload/option-teachers/{id}` · `DELETE /api/workload/option-teachers/{id}` — ทุกตัวผ่าน `wl_can_edit` · ครูที่เลือกใหม่ต้องมีจริงและ `active` (ค่าเดิมที่ไม่เปลี่ยนไม่ตรวจ) · 404/403/409 ไทย
  - `wl_submit_blocker(rows, options) -> str|None` — แถวที่ `teacher_id` ว่างหรือ `confirmed` เท็จ · ตัวเลือกที่ไม่มีครูสักคนหรือมีครูที่ยังไม่ยืนยัน → ข้อความไทยพร้อมจำนวน
  - `POST /api/workload/rounds/{round_id}/departments/{dept}/submit` (head กลุ่มตัวเอง · `filling`/`returned` · blocker ต้อง None) · `.../approve` (admin · จาก `submitted`) · `.../return` `{note}` (admin · จาก `submitted`/`approved` · note ไม่ว่าง) · `GET .../departments` (admin ทุกกลุ่ม + `{rows, confirmed, missing_teacher}` · head กลุ่มตัวเอง)
  - `wl_teacher_loads(rows, options) -> dict[int, int]` — แถว: `weekly` ให้ `teacher_id` และ `co_teacher_id` (คนละคน) · ตัวเลือก: `weekly` ของชุดให้ครูแต่ละคน **ครั้งเดียวต่อชุดต่อครู**
  - `GET  /api/workload/rounds/{round_id}/loads` → `[{teacher_id, name, department_id, total, own}]` · admin ทุกคน `own = total` · head: ครูกลุ่มตัวเอง ∪ ครูในแถว/ตัวเลือกของกลุ่มตัวเอง · `own` = ส่วนจากกลุ่มตัวเอง · ไม่มีข้อมูลแถวของกลุ่มอื่น

ไฟล์คำตอบร่วม `tests/fixtures/seed_teacher_loads.json` = `{"<sched teacher id>": total}` จาก `teacherLoads(requirements, electiveSubjectIds(subjects, pools))` ของ `frontend/src/utils/teachingLoad.ts` บน `school_data.json` (บรรทัดคำสั่งที่สร้างเขียนไว้ในคอมเมนต์หัว `tests/ts/wlloads.ts`)

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง**
  - `tests/ts/wlloads.ts`: `teacherLoads` จริงบนข้อมูลตั้งต้นเท่ากับไฟล์คำตอบร่วมทุกคน
  - `tests/py/wlrows.py`: `wl_can_edit` ครบตาราง · `test_teacher_change_confirms_row` · `test_confirm_only_by_explicit_true` · `test_row_put_rejects_subject_fields (400 บอกชื่อช่อง)` · `test_head_reads_only_own_department_even_if_another_is_requested` · `test_head_sees_only_own_options` · `test_head_put_on_other_department_row_is_403` · `test_put_after_round_closed_is_409_with_thai_reason` · `test_bulk_is_all_or_nothing` · `test_inactive_teacher_cannot_be_newly_assigned_but_existing_row_still_reads` · `test_option_can_have_several_teachers` · `test_no_route_deletes_teachers_or_subjects`
  - `tests/py/wlflow.py`: `test_loads_match_timetable_program_for_plain_teachers` (ตั้งต้นหลักสูตร + เปิดรอบบนข้อมูลตั้งต้นด้วย cursor ปลอมหรือฟังก์ชันล้วน → ครูที่ไม่มีคาบเสรี/กิจกรรม/สอนร่วม เท่ากับไฟล์คำตอบร่วม) · `test_elective_option_counts_set_weekly_once_not_per_class` · `test_co_teacher_gets_the_row_weekly` · `test_same_teacher_twice_in_one_set_counts_once` · `wl_submit_blocker` · ขั้นงานส่ง/ตรวจ/ตีกลับครบ · head แก้ตอน `submitted` → 409 · loads ของ head ไม่มีครูที่ไม่เกี่ยว
- [ ] **Step 2: สร้างไฟล์คำตอบร่วม แล้วรันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนค่าคงที่ ฟังก์ชันล้วน และ route**
- [ ] **Step 4: รันตัวทดสอบ** → ผ่านครบ
- [ ] **Step 5: ลองกับของจริง** — หัวหน้ากลุ่ม 1 แก้แถวกลุ่ม 2 → 403 · เปลี่ยนครู → ยืนยัน · bulk · เพิ่มครูในตัวเลือก · ส่ง → แก้ไม่ได้ → ตีกลับ → แก้ได้ → ส่ง → ตรวจผ่าน · loads · revision ไม่ขยับ
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: หัวหน้ากลุ่มใส่ครูตามสิทธิ์ ส่ง ตรวจผ่าน ตีกลับ และยอดคาบรายครู"`

---

## Task 5: ชุดหน้าตาใหม่ และย้ายหน้าเดิมทั้งหมดมาใช้

**Files:**
- Create: `workload/src/ui/*.tsx` + `index.ts` (ตาม File Structure)
- Modify: `workload/src/index.css` · `workload/tailwind.config.js` · `workload/index.html` (ตัวอักษร Sarabun น้ำหนัก 400/500/600/700) · `App.tsx` · `pages/LoginPage.tsx` · `SetupPage.tsx` · `TeachersPage.tsx` · `SubjectsPage.tsx` · `CodesPage.tsx` · `registryParts.tsx`

**Interfaces:**
- Produces (ทุกหน้าของ Task 6–9 ใช้):
  - โทเค็นใน `:root` ของ `index.css` ตามสเปกข้อ 6 (ค่าเดียวกับภาพตัวอย่าง: `--bg #f6f3ec` · `--surface #fff` · `--line #e8e2d6` · `--line2 #f1ece3` · `--ink #2b2a26` · `--muted #736d62` · `--brand #1f6f6b` · `--brand-soft #e3efec` · warn `#fff3d4/#8a5a00` · ok `#e4f3e8/#1e6b34` · info `#e8eefb/#2d4f9c` · bad `#fbe8e4/#a3352b`) และสีเดียวกันใน `tailwind.config.js` (`colors.brand`, `colors.ink` ฯลฯ อ้าง `var(--…)`)
  - `<AppShell user={…} roundChip={…} tabs={[{key,label}]} active onTab onLogout>{children}</AppShell>` — แถบบน + แท็บ (แท็บซ่อนเมื่อไม่ส่ง) · จอแคบ: แท็บเลื่อนแนวนอนในแถบตัวเอง ไม่ใช่ทั้งหน้า
  - `<Button variant="primary"|"secondary"|"ghost"|"danger" …>` · `<Card>` · `<Chip tone="warn"|"ok"|"info"|"bad"|"mute" dot?>` · `<Progress value max tone?>` · `<Segmented options value onChange>` · `<StatTile label value suffix?>` · `<Notice tone>` · `<EmptyState title hint action?>`
- **พฤติกรรมของหน้าเดิมต้องไม่เปลี่ยน** — เปลี่ยนแค่หน้าตา (ข้อความ ป้าย `aria-label` `data-testid` ที่ตัวทดสอบเดิมอ้างต้องอยู่ครบ)

- [ ] **Step 1: เพิ่มโทเค็นและชิ้นส่วน `ui/`** — ไม่มีตรรกะ (ไม่มีตัวทดสอบหน่วย)
- [ ] **Step 2: ย้ายหน้าเดิมทั้ง 6 ไฟล์มาใช้ `ui/` และ `AppShell`** — เมนู admin: หลักสูตร · รอบอัตรากำลัง · สรุปอัตรากำลัง · ทะเบียนครู · ทะเบียนวิชา · รหัสเข้า (สามแท็บแรกขึ้นหน้าว่าง "กำลังจะมา" จนถึง Task 6/7/9) · หัวหน้ากลุ่ม: หลักสูตร · อัตรากำลังของกลุ่ม · สรุปอัตรากำลัง
- [ ] **Step 3: ตรวจ** — `bash tests/run.sh` ผ่านครบ · `cd workload && npm run lint && npm run build` สะอาด
- [ ] **Step 4: ดูด้วยตา** — Playwright กับเซิร์ฟเวอร์จริง ถ่ายทุกหน้าของขั้นที่ 1 ที่กว้าง 1280 และ 390 (โทรศัพท์): ล็อกอิน · ตั้งรหัสครั้งแรก · ทะเบียนครู (หลังดึง 143) · ทะเบียนวิชา · รหัสเข้า · หน้าหัวหน้ากลุ่ม · ยืนยันว่าทุกปุ่ม/ช่องของขั้นที่ 1 ยังกดได้ (เดินซ้ำขั้นตอนของคู่มือข้อ 2–5) และไม่มีการเลื่อนแนวนอนทั้งหน้าที่ 390
- [ ] **Step 5: Commit** — `"เว็บลงอัตรากำลัง: ชุดหน้าตาใหม่ที่สบายตา และย้ายทุกหน้ามาใช้"`

---

## Task 6: หน้าหลักสูตร — ทุกคนเปิดดู admin แก้ บันทึกการแก้

แบบข้อ 4.5 · ผู้ใช้: "ทุกๆคนเวลาสงสัยจะได้เปิดหลักสูตรดูได้ แถมสามารถตรวจสอบย้อนกลับมาได้ด้วย"

**Files:**
- Create: `workload/src/curriculum.ts` · `workload/src/curriculumApi.ts` · `workload/src/pages/CurriculumPage.tsx` · `CurriculumEditor.tsx`
- Modify: `workload/src/App.tsx` (เมนู "หลักสูตร" ทั้ง admin และหัวหน้า)
- Test: `tests/ts/wlcurriculum.ts`

**Interfaces:**
- Consumes: route ของ Task 2 · `ui/` (Task 5)
- Produces (`curriculum.ts` — ตรรกะล้วน):
  - `KIND_TEXT` (`basic` "พื้นฐาน" · `additional` "เพิ่มเติม" · `activity` "กิจกรรมพัฒนาผู้เรียน") · `levelOf(groupName) -> string|null` (`"ม.4/6ก"` → `"ม.4"` · ชื่อแปลก → null) · `classSort(a, b)` (ม.1/2 ก่อน ม.1/10)
  - `curriculumSummary(c) -> {lines, weekly, credits, groups: string}` — ผลรวมคาบ/สัปดาห์และหน่วยกิตของหลักสูตร · ช่วงห้อง
  - `groupCurricula(list) -> {level, curricula}[]` — จัดตามระดับชั้น ม.1 → ม.6 · ไม่มีระดับไว้ท้าย
  - `buildLineBody(form) -> {ok: true, body} | {ok: false, error}` — รหัสไม่ว่าง · คาบเป็นจำนวนเต็ม ≥ 1 · หน่วยกิตว่างหรือ ≥ 0 ทศนิยมได้
  - `logLine(entry) -> string` — "16 พ.ย. 2569 14:05 · ผู้ดูแลระบบ · เพิ่ม …" (วันที่แบบไทย พ.ศ.)
- Produces (`curriculumApi.ts`): ฟังก์ชันละ route ของ Task 2

หน้าจอ
- **ทุกคน** (เมนู "หลักสูตร"): เลือกภาคเรียน · หลักสูตรจัดตามระดับชั้น เป็นการ์ด (ชื่อ · ห้องที่ใช้ · รวมคาบ/สัปดาห์ · รวมหน่วยกิต) · กดเปิดเห็นตารางบรรทัด (รหัส ชื่อ นก. คาบ/สัปดาห์ ประเภท กลุ่มสาระ) · ชุดคาบเสรี/กิจกรรมของภาคเรียน · แท็บ "บันทึกการแก้" (ใหม่ก่อน) · ค้นหาวิชาจากรหัส/ชื่อ ข้ามทุกหลักสูตร ("วิชานี้อยู่หลักสูตรไหนบ้าง") · ภาคเรียนที่ปิดแล้วมีป้าย "ปิดแล้ว · อ่านอย่างเดียว"
- **admin** (`CurriculumEditor`): ภาคเรียนว่าง → การ์ด "ตั้งต้นหลักสูตร" สามทาง: จากโปรแกรมจัดตาราง · คัดลอกจากภาคเรียน… · เริ่มว่าง · เพิ่ม/แก้/ลบหลักสูตร (ชื่อ ระดับ หมายเหตุ ห้อง — เลือกห้องเป็นช่องติ๊กจัดตามระดับ ห้องที่อยู่หลักสูตรอื่นแล้วติ๊กไม่ได้พร้อมบอกว่าอยู่ที่ไหน) · เพิ่ม/แก้/ลบบรรทัด (พิมพ์รหัส → เติมชื่อและกลุ่มสาระจากทะเบียน) · ชุดคาบเสรี/กิจกรรม · การลบที่ได้ 409 เพราะมีครูใส่แล้ว → กล่องยืนยัน "มีครูใส่ไว้แล้ว N แถว จะลบด้วย" → ส่ง `force`
- ข้อผิดพลาดของบรรทัดขึ้นในบรรทัดนั้น · reload ไม่ทำให้ของที่พิมพ์ค้างหาย · ช่องกรอกมีป้ายที่มองเห็น

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง** ใน `tests/ts/wlcurriculum.ts`: `levelOf` · `classSort` · `curriculumSummary` (1.5 + 1 หน่วยกิต) · `groupCurricula` · `buildLineBody` ทุกกรณี · `logLine` (พ.ศ. · เวลา 24 ชม.)
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนตรรกะ ตัวเรียก และสองหน้า**
- [ ] **Step 4: ตรวจ** — tests ผ่านครบ · lint + build สะอาด
- [ ] **Step 5: Playwright กับของจริง** (ฐานข้อมูลใหม่) — admin ตั้งต้นจากโปรแกรมจัดตาราง → เห็นหลักสูตรจัดตามระดับ → เพิ่มบรรทัด (พิมพ์รหัสแล้วชื่อขึ้นเอง) → บันทึกการแก้มีรายการ → คัดลอกไปภาคเรียนถัดไป · หัวหน้ากลุ่มเปิดดูได้ ไม่มีปุ่มแก้ · ค้นหาวิชาข้ามหลักสูตร · screenshot ที่ 1280 และ 390
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: หน้าหลักสูตรที่ทุกคนเปิดดูได้ ผู้ดูแลระบบแก้ได้ และบันทึกการแก้"`

---

## Task 7: หน้ารอบของ admin — เปิดรอบ ภาพรวม ตรวจ และปิดรอบ

**Files:**
- Create: `workload/src/round.ts` · `workload/src/roundApi.ts` · `workload/src/pages/RoundsPage.tsx` · `RoundOverview.tsx`
- Modify: `workload/src/App.tsx`
- Test: `tests/ts/wlround.ts`

**Interfaces:**
- Consumes: route ของ Task 3 และ Task 4 · `ui/` (Task 5) · `curriculum.ts` (Task 6)
- Produces (`round.ts` — ตรรกะล้วน):
  - `ROUND_STATUS_TEXT` · `DEPT_STATUS_TEXT` · `deptStatusTone(status) -> "warn"|"info"|"ok"|"bad"|"mute"` (`filling` ที่ยังไม่ยืนยันสักแถว = `mute` "ยังไม่เริ่ม")
  - `roundLabel(year, semester) -> string` · `checkRoundForm(year: string, semester: string) -> string|null`
  - `previewLines(p) -> string[]` — ข้อความไทยของหน้าดูก่อนเปิด (จำนวนแถว ตัวเลือก แถวที่มีครูเทอมก่อน แถวที่ช่องครูว่าง บรรทัดที่ยังไม่มีกลุ่มสาระ)
  - `deptProgress(d) -> {pct, text}`
- Produces (`roundApi.ts`): ฟังก์ชันละหนึ่ง route ของ Task 3–4 คืนชนิดตามสัญญา (ตรวจรูปตัวเลขแบบ `counts()` ใน `api.ts` — ผิดรูป → `ContractError`)

หน้าจอ (ตามภาพ `mockup-admin.png`)
- **ยังไม่มีรอบ** → การ์ดเปิดรอบ: ปี · ภาคเรียน (ต้องมีหลักสูตรของภาคเรียนนั้น ไม่มี → ลิงก์ไปหน้าหลักสูตร) → "ดูก่อนเปิด" → รายการ `previewLines` + รายการแปลงไม่ได้ (ถ้ามี) → "เปิดรอบ" / "ยกเลิก" · ไม่มีอะไรถูกเขียนก่อนกดเปิดรอบ
- **รอบ `preparing`** → แถบเตือน "รอบนี้ยังไม่เปิดให้กลุ่มสาระกรอก" + จำนวนบรรทัดหลักสูตรที่ยังไม่มีกลุ่มสาระ (ลิงก์ไปหน้าหลักสูตร) + ปุ่ม "เปิดให้กลุ่มสาระกรอก" (ปิดไว้พร้อมเหตุผลเมื่อยังมี)
- **ภาพรวม** → ชิปรอบ · `StatTile` สี่ช่อง · การ์ดกลุ่มสาระละใบ (สถานะ ความคืบหน้า หมายเหตุตีกลับ) · ปุ่ม "ตรวจผ่าน" / "ตีกลับ" (กล่องให้พิมพ์หมายเหตุ บังคับไม่ว่าง) บนการ์ดที่ `submitted` · "เปิดดู" ไปหน้าแถวของกลุ่มในโหมดของ admin (หน้าเดียวกับของหัวหน้า Task 8 แต่ admin เลือกกลุ่มได้ และแก้ได้ทุกสถานะ)
- **ปิดรอบ** → กล่องให้พิมพ์ชื่อรอบยืนยัน · รอบที่ปิดแล้วอยู่ในรายการรอบเก่า เปิดดูได้อ่านอย่างเดียว

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/ts/wlround.ts`: ป้ายและสีทุกสถานะ · `checkRoundForm` (ว่าง · 2499 · 2701 · ภาค 3 · ถูก → null) · `previewLines` ("1,220 แถว" · "มีครูเทอมก่อน 1,220 แถว") · ไม่มีบรรทัดของค่าที่เป็น 0 · `deptProgress` 0/108 → 0% "ยังไม่เริ่ม"
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียน `round.ts` `roundApi.ts` และสองหน้า** แล้วต่อเข้าแท็บ "รอบอัตรากำลัง"
- [ ] **Step 4: ตรวจ** — tests ผ่านครบ · lint + build สะอาด
- [ ] **Step 5: Playwright กับของจริง** (ฐานข้อมูลใหม่ · ตั้งต้นหลักสูตรด้วย curl) — ดูก่อนเปิด → `count(*) wl_rows` ยัง 0 → เปิดรอบ → เปิดให้กรอก → ภาพรวม 11 การ์ด → ปิดรอบด้วยชื่อผิด/ถูก · screenshot ที่ 1280 และ 390 · revision ไม่ขยับ
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: หน้ารอบของผู้ดูแลระบบ — เปิดรอบ ภาพรวม ตรวจ ปิดรอบ"`

---

## Task 8: หน้ากรอกของหัวหน้ากลุ่มสาระ

**Files:**
- Create: `workload/src/pages/HeadFillPage.tsx`
- Modify: `workload/src/round.ts` · `workload/src/roundApi.ts` · `workload/src/App.tsx` (หัวหน้ากลุ่มไปหน้านี้แทนข้อความ "ยังไม่มีรอบ…" เมื่อมีรอบ `filling`)
- Test: `tests/ts/wlround.ts` (ต่อ)

**Interfaces:**
- Consumes: route ของ Task 4 · `levelOf` `KIND_TEXT` (Task 6) · `round.ts` (Task 7) · `ui/` (Task 5)
- Produces (`round.ts`):
  - `groupBySubject(rows) -> {key, code, name, weekly, kind, credits, curriculumName, rows}[]` — คีย์ `line_id` · เรียงตามระดับชั้นของห้องแรกแล้วรหัสวิชา · แถวในกลุ่มเรียงด้วย `classSort` · ไม่แก้ลิสต์เดิม
  - `filterRows(rows, {state: "all"|"todo"|"done", level: string|null, query: string}, teacherName: (id) => string) -> rows` — ค้นด้วยรหัสวิชา ชื่อวิชา ชื่อห้อง ชื่อครู (ไม่สนช่องว่างหัวท้าย)
  - `fillProgress(rows, options) -> {total, confirmed, missingTeacher}`
  - `submitState(progress, deptStatus, roundStatus) -> {can: boolean, reason: string|null}` — ข้อความไทยตรงกับเงื่อนไขของ `wl_submit_blocker` ฝั่งเซิร์ฟเวอร์ และสถานะ (`submitted` "ส่งแล้ว รอผู้ดูแลระบบตรวจ" · `approved` "ตรวจผ่านแล้ว" · รอบไม่ใช่ `filling`)
  - `teacherChoices(teachers, deptId) -> {id, name, own}[]` — เฉพาะ `active` · กลุ่มตัวเองก่อน แล้วตามชื่อ · ครูที่ไม่ active แต่อยู่ในแถวแสดงชื่อในแถวนั้นได้ แต่ไม่อยู่ในตัวเลือก

หน้าจอ (ตามภาพ `mockup-head.png`)
- หัวหน้า: ชื่อกลุ่ม · ชิปสถานะกลุ่ม · การ์ดความคืบหน้า + ปุ่มส่ง (ปิดพร้อมเหตุผลจาก `submitState`) · ถ้า `returned` แถบหมายเหตุจาก admin เด่นอยู่บนสุด
- ตัวกรอง: ทั้งหมด/ยังไม่ยืนยัน/ยืนยันแล้ว · ค้นหา · ระดับชั้น
- การ์ดวิชาละใบ (พับได้) · แถว: ติ๊กเลือก · ห้อง · ครูผู้สอน · ครูสอนร่วม · ห้องปฏิบัติการ · คาบคู่ · หมายเหตุ · สถานะ ("จากเทอมก่อน" + ปุ่มยืนยัน / "ยืนยันแล้ว") · แถวยังไม่ยืนยันพื้นเหลืองจาง
- ปุ่มของการ์ด: "ใส่ครูให้แถวที่เลือก" · "ยืนยันแถวที่เลือก" (ใช้ `rows/bulk`)
- ส่วนคาบเสรี/กิจกรรม: ตัวเลือกของกลุ่มตัวเอง · เพิ่ม/เอาครูออก (ตัวเลือกหนึ่งมีได้หลายคน) · ห้อง หมายเหตุ ยืนยัน
- ทุกการ์ดวิชามีบรรทัดเล็ก "จากหลักสูตร <ชื่อหลักสูตร>" ลิงก์ไปหน้าหลักสูตร (ตรวจย้อนได้) · ไม่มีช่องแก้วิชา/คาบ/ห้องเรียน
- ด้านข้าง (จอกว้าง) / ด้านล่าง (จอแคบ): คาบรายครูของกลุ่มจาก `loads` (แถบยาวตามยอด ยอดเกินค่ามากสุดของกลุ่มเป็นสีเตือน) อัปเดตหลังบันทึก
- จอแคบ: แถวกลายเป็นการ์ดซ้อน · ไม่มีเลื่อนแนวนอนทั้งหน้า (Review Focus 5)
- การบันทึกที่ได้ 409 (ส่งแล้ว/รอบปิด) → ขึ้นข้อความไทยของเซิร์ฟเวอร์ และโหลดสถานะใหม่ ค่าในตัวแก้ของแถวนั้นยังอยู่ (Review Focus 2)

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง**: `groupBySubject` (ลำดับ · ไม่แก้ลิสต์เดิม) · `filterRows` (สามสถานะ · ระดับ · ค้นชื่อครู · ช่องว่างหัวท้าย) · `fillProgress` · `submitState` ทุกสถานะ และข้อความตอนขาดครู/ยังไม่ยืนยันมีตัวเลข · `teacherChoices` (ไม่มีครูที่ไม่ active · กลุ่มตัวเองก่อน · ชื่อซ้ำเป็นสองตัวเลือกด้วย id)
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนตรรกะ และหน้า**
- [ ] **Step 4: ตรวจ** — tests ผ่านครบ · lint + build สะอาด
- [ ] **Step 5: Playwright กับของจริง** (รอบเปิดให้กรอกแล้ว · รหัสกลุ่ม 1 และ 9) — กลุ่ม 9 (258 แถว) ที่จอ 390: ตัวกรองทำงาน ไม่มีเลื่อนแนวนอน (`document.documentElement.scrollWidth <= 390`) · กลุ่ม 1: ยืนยันทีละแถว · เลือก 5 แถวใส่ครูคนเดียว → ยืนยันแล้วทั้ง 5 · ยอดคาบด้านข้างเปลี่ยน · ส่งไม่ได้จนครบ → ครบ → ส่ง → หน้าเป็นอ่านอย่างเดียว · admin ปิดรอบขณะอีกหน้าเปิดค้าง → บันทึกได้ข้อความ 409 ไทย · screenshot ที่ 1280 และ 390
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: หน้าหัวหน้ากลุ่มสาระ ยืนยันครูทีละแถวหรือทั้งชุด แล้วส่งตรวจ"`

---

## Task 9: หน้าสรุปอัตรากำลังสองแบบ (รายวิชา · ครูผู้สอน) พิมพ์ได้ และคู่มือขั้นที่ 2

ผู้ใช้ส่งภาพชีต Excel เดิมมาให้ทำตาม — ดูสเปกข้อ 2 ข้อ 5 สำหรับคอลัมน์และหัวกระดาษที่ต้องตรง

**Files:**
- Create: `workload/src/pages/SummaryPage.tsx` · `workload/src/sheets.ts` (ตรรกะล้วนของสองชีต)
- Modify: `workload/src/index.css` (`@media print`) · `workload/src/App.tsx` · `workload/src/pages/HeadFillPage.tsx` (ลิงก์ "ดูทั้งหมด · พิมพ์") · `docs/workload-setup.md`
- Test: `tests/ts/wlsheets.ts`

**Interfaces:**
- Consumes: `GET .../rows` · `GET .../loads` (Task 4) · `KIND_TEXT` `levelOf` `classSort` (Task 6) · `groupBySubject` (Task 8) · `ui/` (Task 5)
- Produces (`sheets.ts` — ตรรกะล้วน ไม่แก้ลิสต์ที่ส่งเข้า):
  - `sheetTitle(kind: "subject"|"teacher", semester, year, deptName|null) -> [string, string, string]` — `["สรุปอัตรากำลังแบบรายวิชา", "ภาคเรียนที่ 2 ปีการศึกษา 2569", "กลุ่มสาระ…"]` (ทุกกลุ่ม → "ทุกกลุ่มสาระ")
  - `kindLabel(kind) -> string` — `"1 พื้นฐาน"` · `"2 เพิ่มเติม"` · `"กิจกรรมพัฒนาผู้เรียน"`
  - `subjectSheet(rows, sets, teacherName) -> SubjectBlock[]` — `SubjectBlock = {no, level, semester, code, name, credits, weekly, kindLabel, lines: {room, teacher1, teacher2}[]}` · แถวธรรมดาจัดก้อนด้วย `groupBySubject` · ตัวเลือกคาบเสรี/กิจกรรมเป็นก้อนละตัวเลือก ห้อง = ช่วงห้องของชุด (`ม.1/7-12` แบบเดียวกับ `classRanges` ของใบพิมพ์ในโปรแกรมจัดตาราง ถ้า import ได้แบบฟังก์ชันล้วน) · `no` นับ 1… ต่อก้อน · `level` จาก `levelOf` ของห้องแรก
  - `teacherSheet(rows, sets, teachers, loads) -> TeacherBlock[]` — `TeacherBlock = {no, teacherId, name, total, ownTotal, otherTotal, subjects: {code, name, credits, kindLabel, periods, lines: {room, weekly}[]}[]}` · `periods` ของวิชา = Σ weekly ของแถว (ตัวเลือกชุด = weekly ของชุดครั้งเดียว) · `ownTotal` = Σ `periods` · `total` จาก `loads` (ยอดทั้งรอบ) · `otherTotal = total − ownTotal` · ครูสอนร่วมได้แถวนั้นในก้อนของตัวเองด้วย · เรียงครูตามกลุ่มสาระ → `dept_order` → ชื่อ
  - `levelTone(level) -> string` — คลาสสีอ่อนของป้ายชั้น ม.1–ม.6 (หกสีไม่ซ้ำ อ่านง่ายทั้งจอและกระดาษ)

หน้าจอ `SummaryPage`
- สลับ "แบบรายวิชา" / "แบบครูผู้สอน" (`Segmented`) · admin เลือกกลุ่มสาระหรือ "ทุกกลุ่ม" · หัวหน้าเห็นกลุ่มตัวเองเท่านั้น
- ตารางตามคอลัมน์ของสเปกข้อ 2 ข้อ 5 คำต่อคำ · บรรทัดแรกของก้อนเป็นตัวหนา · รหัสวิชาพื้นเหลืองอ่อน · ป้ายชั้นสีตาม `levelTone` · ครูที่ `otherTotal > 0` มีบรรทัดท้ายก้อน "สอนกลุ่มอื่น N คาบ · รวมทั้งหมด M คาบ"
- ใต้หัวตารางหนึ่งบรรทัด: คาบเสรีนับครั้งเดียวต่อชุด ยอดของครูที่สอนคาบเสรีจึงอาจมากกว่ายอดตามแผนในโปรแกรมจัดตาราง (สเปกข้อ 4.4 ข.)
- ปุ่ม "พิมพ์" (`window.print()`) · พิมพ์: ไม่มีแถบบน/แท็บ/ปุ่ม · หัวกระดาษ 3 บรรทัดกึ่งกลาง · หัวตารางซ้ำทุกหน้า · ก้อนไม่แตกกลางบรรทัด · กระดาษ A4 แนวตั้ง
- admin: แท็บ "สรุปอัตรากำลัง" (แทนชื่อแท็บ "สรุปคาบรายครู" ของ Task 5) · หัวหน้า: ลิงก์จากหน้ากรอก

คู่มือ `docs/workload-setup.md` — เพิ่มหัวข้อ (ภาษาไทย สำหรับคนที่ไม่ใช่โปรแกรมเมอร์ ตามแบบเดิมของไฟล์):
1. **ทำหลักสูตรก่อน** (admin): ตั้งต้นจากโปรแกรมจัดตารางหรือเทอมก่อน · แก้บรรทัดและห้อง · บันทึกการแก้ · ทุกคนเปิดดูได้
1. **เปิดรอบอัตรากำลัง** (admin): ดูก่อนเปิด · เปิดรอบ · บรรทัดที่ยังไม่มีกลุ่มสาระ · เปิดให้กลุ่มสาระกรอก · ตรวจผ่าน/ตีกลับ · ปิดรอบ
2. **สำหรับหัวหน้ากลุ่มสาระ**: หน้าที่คือใส่ครูอย่างเดียว · ป้าย "จากเทอมก่อน" คืออะไร · ยืนยันทีละแถว/ทั้งชุด · ใส่ครูให้หลายห้อง · คาบเสรี · กดส่ง · ถ้าถูกตีกลับ · วิชาหรือคาบผิดให้แจ้ง admin แก้ที่หลักสูตร
3. **หน้าสรุปอัตรากำลัง** สองแบบ แทนชีตเดิม และวิธีพิมพ์
4. **เรื่องที่ต้องรู้เพิ่ม**: รอบนี้ไม่แตะตารางสอน · การส่งเข้าโปรแกรมจัดตารางเป็นขั้นที่ 3 · ยอดคาบเสรีต่างจากยอดในโปรแกรมได้ เพราะอะไร
5. ตารางข้อสอบท้ายคู่มือ: เพิ่มข้อ 1, 2, 8, 9, 10 ของสเปกหลักพร้อมผลที่ลองในเครื่องพัฒนา และข้อ 7 ที่ต้องเทียบกับไฟล์ Excel เอง

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง** ใน `tests/ts/wlsheets.ts`
  - `sheetTitle` ทั้งสองแบบ และทุกกลุ่ม
  - `subjectSheet`: วิชา ส33102 สองครูสลับห้อง ม.6/1–6/14 → ก้อนเดียว 14 บรรทัด เรียงห้องแบบตัวเลข · ครูสอนร่วมอยู่คอลัมน์ครู 2 · คาบเสรีเป็นก้อนของตัวเลือกพร้อมช่วงห้อง · `no` ต่อเนื่อง · ไม่แก้ลิสต์เดิม
  - `teacherSheet`: ครูที่สอน ส32103 2 ห้อง (2 คาบ) และ ส33102 7 ห้อง (2 คาบ) → `periods` 4 และ 14 · `ownTotal` 18 (ตรงกับภาพชีตที่ผู้ใช้ส่งมา) · ตัวเลือกคาบเสรี 8 ห้อง weekly 2 → `periods` 2 · ครูสอนข้ามกลุ่ม `total` 20 → `otherTotal` 2 · ครูชื่อซ้ำเป็นสองก้อนด้วย id
  - `kindLabel` · `levelTone` ไม่ซ้ำกันหกระดับ
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียน `sheets.ts` หน้า และ print stylesheet** แล้วต่อเข้าแท็บและลิงก์
- [ ] **Step 4: แก้คู่มือ** และไล่เลขอ้างอิงข้ามหัวข้อทุกจุดให้ถูก
- [ ] **Step 5: ตรวจ** — tests ผ่านครบ · lint + build สะอาด · Playwright กับของจริง: สองแบบของ admin (กลุ่ม 5 และทุกกลุ่ม) และของหัวหน้า · `page.pdf()` ของหน้าพิมพ์ไม่มีแถบเมนู หัวตารางซ้ำหน้าสอง · screenshot ของทั้งสองแบบส่งให้ผู้ใช้ดู
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: หน้าสรุปอัตรากำลังแบบรายวิชาและแบบครูผู้สอนที่พิมพ์ได้ และคู่มือการใช้รอบ"`

---

## หลังจบทั้ง 9 task

1. รีวิวทั้งสาขาบนโมเดลที่เก่งที่สุด (`superpowers:requesting-code-review`) แก้รอบเดียว แล้วตรวจซ้ำหนึ่งรอบ
2. ลองอัปเกรดกับ Postgres ทดลอง: เซิร์ฟเวอร์รุ่นบน `main` ตอนนั้นสร้างข้อมูลขั้นที่ 1 (รหัส ครู วิชา) → รุ่นใหม่บนฐานเดียวกัน → ตารางใหม่ถูกสร้าง ของเดิมครบ เปิดรอบได้
3. merge เข้า `main` ครั้งเดียวผ่าน Pull Request (ทุก push เข้า `main` ทำให้เซิร์ฟเวอร์บน Render เริ่มใหม่ 1–3 นาที) · อัปเดต `docs/HANDOFF.md` ในคอมมิตเดียวกัน
