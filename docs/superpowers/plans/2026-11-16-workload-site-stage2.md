# เว็บลงอัตรากำลัง ขั้นที่ 2 — รอบอัตรากำลัง แถววิชา งานส่ง-ตรวจ และหน้าตาใหม่

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin เปิดรอบอัตรากำลังที่ยกแถวมาจากแผนการสอนและตารางที่จัดเสร็จแล้ว หัวหน้ากลุ่มสาระยืนยัน/แก้ครูของกลุ่มตัวเองแล้วกดส่ง admin ตรวจผ่านหรือตีกลับ ทุกคนเห็นคาบรายครู และทั้งเว็บมีหน้าตาใหม่ที่สบายตา โดยข้อมูลของโปรแกรมจัดตารางไม่ถูกแตะ

**Architecture:** ฝั่งเซิร์ฟเวอร์เพิ่มตาราง SQL 5 ตาราง (`wl_rounds` `wl_rows` `wl_sets` `wl_set_options` `wl_dept_status`) และ route ใต้ `/api/workload/` ใน `mock_api.py` ต่อจากบล็อกของขั้นที่ 1 · การแปลงแผนการสอน + ชุดคาบเสรี + ช่องในตาราง เป็นแถวของรอบ เป็นฟังก์ชันล้วนตัวเดียว · กฎนับคาบรายครูอยู่ที่เซิร์ฟเวอร์ตัวเดียว · ฝั่งหน้าเว็บมีชุดชิ้นส่วนหน้าตา (`workload/src/ui/`) ที่ทุกหน้าใช้ และตรรกะล้วนของรอบ (`workload/src/round.ts`) ที่ทดสอบด้วย node ได้

**Tech Stack:** FastAPI (ไม่มี Pydantic) · psycopg 3 + PostgreSQL · React 18 + Vite + TypeScript + Tailwind (มีอยู่แล้วใน `workload/`) · ตัวทดสอบของ repo (`bash tests/run.sh`) · ไม่มี dependency ใหม่ทั้งสองฝั่ง

**Spec:** `docs/superpowers/specs/2026-11-16-workload-stage2-design.md` (ผู้ใช้อนุมัติ 16 พ.ย.) — สร้างบน `docs/superpowers/specs/2026-11-06-workload-entry-site-design.md` ("สเปกหลัก")
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
| แถว | `{id, round_id, department_id\|null, group_id, group_name, subject_id\|null, code, name, credits\|null, weekly, kind: "basic"\|"additional"\|"activity", teacher_id\|null, co_teacher_id\|null, lab_room_id\|null, is_double, note, confirmed, from_plan, flag\|null}` |
| ชุด | `{id, round_id, kind: "elective"\|"activity", name, group_ids, group_names, weekly, is_double, options: [ตัวเลือก]}` |
| ตัวเลือก | `{id, set_id, subject_id\|null, code, name, department_id\|null, teacher_id\|null, room_id\|null, note, confirmed, from_plan}` |
| สถานะกลุ่ม | `{department_id, status: "filling"\|"submitted"\|"returned"\|"approved", submitted_at, submitted_by, reviewed_at, reviewed_by, note}` |
| ยอดคาบ | `{teacher_id, name, department_id, total, own}` · `own` = ส่วนที่มาจากกลุ่มของผู้ขอ (admin: เท่ากับ `total`) |

`group_name` / `group_names` เติมตอนส่งออกจาก `_flat_groups()` · ห้องที่ไม่มีแล้วเป็น `"ห้องที่ไม่มีแล้ว (รหัส N)"`

## Review Focus

ห้าเรื่องที่สเปกบอกเป็นนัยและจะกัดคนใช้ก่อน — แต่ละข้อมีตัวทดสอบอยู่ใน task เจ้าของโค้ด

1. **หัวหน้ากลุ่ม ก ส่งคำขอตรงไปที่แถว/ตัวเลือก/สถานะของกลุ่ม ข** → 403 ไทย ไม่ใช่สำเร็จเงียบ ๆ และไม่ใช่ 500 (Task 3, Task 4)
2. **รอบถูกปิด หรือกลุ่มถูกส่งแล้ว ขณะอีกคนยังเปิดหน้ากรอกค้างไว้** → การบันทึกถัดไปถูกปฏิเสธ 409 ไทยที่บอกเหตุผล และหน้าเว็บโหลดสถานะใหม่ ไม่ใช่ทิ้งค่าที่พิมพ์เงียบ ๆ (Task 3, Task 8)
3. **ครูที่ทำเครื่องหมาย "ไม่ปฏิบัติงานแล้ว" แต่ยังอยู่ในแถวของรอบ** → ชื่อยังแสดงในแถวนั้น (ไม่กลายเป็นช่องว่าง) แต่ไม่มีให้เลือกใหม่ (Task 3, Task 8)
4. **แผนการสอนอ้างครู/วิชา/ห้องที่ไม่มีในทะเบียนแล้ว** → แถวยังถูกสร้าง ช่องที่หาไม่เจอว่าง และรายการ "แปลงไม่ได้" บอกว่าอะไร ไม่ใช่ 500 ทั้งรอบ (Task 1, Task 2)
5. **หัวหน้ากลุ่มเปิดจากโทรศัพท์ กลุ่มมี 258 แถว** → แถวจัดกลุ่มตามวิชาแบบพับได้ ตัวกรองทำงาน หน้าไม่เลื่อนแนวนอนทั้งหน้า (Task 8)

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `mock_api.py` (แก้) | ตาราง 5 ตาราง · ฟังก์ชันล้วนแปลงแผนเป็นรอบ · กฎนับคาบ · route ของรอบ แถว ชุด สถานะกลุ่ม ยอดคาบ — ต่อท้ายบล็อก `/api/workload/` ของขั้นที่ 1 ตามแบบของไฟล์ |
| `tests/py/wlround.py` · `wlrows.py` · `wlflow.py` | ตัวทดสอบฝั่งเซิร์ฟเวอร์ |
| `tests/fixtures/seed_teacher_loads.json` | คำตอบร่วม: ยอดคาบรายครูจาก `teacherLoads` ของโปรแกรมจัดตารางบนข้อมูลตั้งต้น |
| `tests/ts/wlloads.ts` | ยืนยันว่าไฟล์คำตอบร่วมตรงกับ `teacherLoads` จริง |
| `workload/src/ui/` (ใหม่) | ชิ้นส่วนหน้าตา: `AppShell.tsx` `Button.tsx` `Card.tsx` `Chip.tsx` `Progress.tsx` `Segmented.tsx` `StatTile.tsx` `Notice.tsx` `EmptyState.tsx` `index.ts` |
| `workload/src/index.css` · `workload/tailwind.config.js` (แก้) | โทเค็นสีและตัวอักษรของสเปกข้อ 6 |
| `workload/src/round.ts` (ใหม่) + `tests/ts/wlround.ts` | ตรรกะล้วนของรอบ: ป้ายสถานะ จัดกลุ่มแถว ตัวกรอง ความคืบหน้า เงื่อนไขกดส่ง |
| `workload/src/roundApi.ts` (ใหม่) | ตัวเรียก route ของรอบ (ใช้ axios instance เดิมจาก `api.ts`) |
| `workload/src/pages/RoundsPage.tsx` · `RoundOverview.tsx` · `RoundRowsEditor.tsx` · `SetsEditor.tsx` · `HeadFillPage.tsx` · `LoadsPage.tsx` (ใหม่) | หน้าจอขั้นที่ 2 |
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

## Task 2: เปิดรอบ ดูก่อนเปิด และสถานะของรอบ

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlround.py` (ต่อ)

**Interfaces:**
- Consumes: `wl_round_proposal` (Task 1) · `_wl_import_from_scheduler` / `_WL_IMPORTS` (ขั้นที่ 1) · `_reqs_served_by_elective()` · `_db_write_blocked()`
- Produces:
  - `_wl_round_source(cur) -> dict` — ประกอบ `src` ของ Task 1 จากตัวแปรกลาง (อ่านอย่างเดียว ส่ง `copy.deepcopy`) และตาราง `wl_teachers` / `wl_subjects`
  - `GET  /api/workload/rounds` — ทุก session · admin เห็นทุกรอบ · หัวหน้าเห็นเฉพาะรอบที่ `filling` หรือ `closed` · เรียงใหม่ก่อน
  - `GET  /api/workload/rounds/preview?year=&semester=` — admin · **ไม่เขียนอะไรเลย** · คืน `{"label", "rows", "sets_elective", "sets_activity", "co_merged", "served_skipped", "teachers_to_pull", "subjects_to_pull", "unconverted": [...]}`
  - `POST /api/workload/rounds` `{year, semester}` — admin · ในธุรกรรมเดียว: ดึงครู+วิชา (โหมดเขียน) → แปลง → สร้างรอบ `preparing` + แถว + ชุด + ตัวเลือก + `wl_dept_status` ทุกกลุ่มใน `DEPARTMENTS` เป็น `filling` → คืนรอบ · ปี/ภาคไม่ถูกต้อง 400 · ซ้ำ 409 · มีรอบที่ยังไม่ปิด 409
  - `POST /api/workload/rounds/{id}/open` — admin · `preparing` → `filling` · มีแถว/ตัวเลือกที่ `department_id` ว่าง → 409 ไทยพร้อมจำนวน
  - `POST /api/workload/rounds/{id}/close` `{confirm_label}` — admin · ต้องพิมพ์ `label` ตรง (ตัดช่องว่าง) ไม่ตรง 400 · → `closed` + `closed_at`
  - `wl_round_view(row) -> dict` — รูป "รอบ" ในสัญญา
- ด่าน: `_db_write_blocked()` → 503 ไทยทั้ง preview และ POST (ข้อมูลในหน่วยความจำคือข้อมูลตั้งต้น) · ปี 2500–2700 · ภาค 1 หรือ 2 (แบบเดียวกับ `running_term_identity`)

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** (cursor ปลอมแบบ `tests/py/wlregistry.py`)
  - `test_preview_writes_nothing` · `test_create_round_writes_round_rows_sets_and_one_status_per_department` · `test_second_open_round_is_409` · `test_duplicate_year_semester_is_409` · `test_bad_year_or_semester_is_400` · `test_open_refuses_while_rows_have_no_department` · `test_close_requires_typed_label` · `test_head_cannot_open_preview_create_open_or_close (403)` · `test_head_sees_only_filling_and_closed_rounds` · `test_write_blocked_is_503_for_preview_and_create` · `test_round_source_does_not_mutate_timetable_lists`
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียน `_wl_round_source` · `wl_round_view` และ route ทั้งห้า**
- [ ] **Step 4: รันตัวทดสอบ** → ผ่านครบ
- [ ] **Step 5: ลองกับของจริง** (ข้อมูลตั้งต้น · ตั้งรหัส admin ด้วย curl) — preview → `rows 1220, sets_elective 13` และ `count(*) wl_rows` = 0 → POST → 1220 แถว 13 ชุด 11 สถานะกลุ่ม → POST ซ้ำ 409 → open → close ด้วยชื่อผิด 400 / ถูก 200 · `/api/state/version` revision ไม่ขยับ · `GET /api/teachers/` `/api/subjects/` `/api/timetable/slots` เหมือนก่อนเริ่มทุกไบต์
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: เปิดรอบจากแผนการสอน ดูก่อนเปิด และสถานะของรอบ"`

---

## Task 3: แถวและชุดคาบเสรี — อ่าน แก้ และสิทธิ์

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlrows.py`

**Interfaces:**
- Consumes: ตารางของ Task 1 · `wl_round_view` (Task 2)
- Produces:
  - `WL_ROW_ADMIN_FIELDS = frozenset({"department_id","group_id","subject_id","code","name","credits","weekly","kind"})` · `WL_ROW_HEAD_FIELDS = frozenset({"teacher_id","co_teacher_id","lab_room_id","is_double","note","confirmed"})` · `WL_OPTION_ADMIN_FIELDS = frozenset({"subject_id","code","name","department_id"})` · `WL_OPTION_HEAD_FIELDS = frozenset({"teacher_id","room_id","note","confirmed"})` · `WL_SET_FIELDS = frozenset({"kind","name","group_ids","weekly","is_double"})`
  - `wl_can_edit(session: dict, round_status: str, dept_status: str|None, row_dept: int|None, fields: set[str]) -> str|None` — ฟังก์ชันล้วน คืนข้อความไทยเมื่อห้าม · กติกา: รอบ `closed` ห้ามทุกคน · admin: `preparing`/`filling` แก้ได้ทุกช่องทุกกลุ่มทุกสถานะ · head: รอบ `filling` เท่านั้น · `row_dept == session.department_id` · สถานะกลุ่ม `filling` หรือ `returned` · ช่องทั้งหมดอยู่ใน `WL_ROW_HEAD_FIELDS`/`WL_OPTION_HEAD_FIELDS`
  - `wl_apply_teacher_change(fields: dict) -> dict` — ถ้ามี `teacher_id` และไม่ได้ส่ง `confirmed` มา → เติม `confirmed=True` (สเปกข้อ 4.1 "เปลี่ยนครู = ยืนยัน")
  - `GET  /api/workload/rounds/{id}/rows?department_id=` → `{"rows": [...], "sets": [...]}` · admin: ทุกกลุ่ม หรือกลุ่มที่ขอ (`department_id=none` = กองยังไม่ระบุกลุ่ม) · head: บังคับเป็นกลุ่มตัวเอง (ค่าที่ส่งมาถูกเมิน) และรอบต้องไม่ใช่ `preparing` (403) · ชุดที่ head เห็น = ชุดที่มีตัวเลือกของกลุ่มตัวเอง และมีแค่ตัวเลือกของกลุ่มตัวเอง (สเปกหลักข้อทดสอบ 9)
  - `PUT  /api/workload/rows/{id}` · `PUT /api/workload/set-options/{id}` — แก้บางช่อง ผ่าน `wl_clean_fields` กับชุดช่องตามบทบาท แล้ว `wl_can_edit` · ครู/ห้อง/วิชาต้องมีจริง (ครูต้อง `active` ถ้าเป็นการเลือกใหม่ — ค่าเดิมที่ไม่เปลี่ยนไม่ตรวจ) · 404 / 403 / 409 ไทย
  - `POST /api/workload/rows/bulk` `{ids: [..], set: {teacher_id?|confirmed?}}` — แก้หลายแถวในธุรกรรมเดียว ทุกแถวต้องผ่าน `wl_can_edit` ไม่งั้นไม่แก้สักแถว (คืน 403/409 พร้อมจำนวนที่ติด) · `set` รับได้แค่ `teacher_id` และ `confirmed`
  - admin เท่านั้น: `POST /api/workload/rounds/{id}/rows` `{group_ids: [..], subject_id?|code+name, weekly, credits?, kind?, department_id?}` สร้างหนึ่งแถวต่อห้อง · `DELETE /api/workload/rows/{id}` · `POST /api/workload/rounds/{id}/sets` · `PUT /api/workload/sets/{id}` · `DELETE /api/workload/sets/{id}` · `POST /api/workload/sets/{id}/options` · `DELETE /api/workload/set-options/{id}` — ทั้งหมดผ่าน `wl_can_edit` ฝั่ง admin (รอบปิดแล้ว 409)
  - `department_id` ของแถวใหม่ถ้าไม่ส่ง = กลุ่มของวิชาในทะเบียน · รหัสวิชาที่พิมพ์ตรงกับวิชาในทะเบียน (ตัดช่องว่าง เทียบตรงตัว) → ผูก `subject_id` ให้
  - **รหัสวิชาห้ามซ้ำในทะเบียนวิชาของเว็บนี้** (สเปกข้อ 4.2 — ตรวจในโค้ด ไม่ใช่ unique index): `POST /api/workload/subjects` และ `PUT` ที่เปลี่ยน `code` เป็นรหัสที่วิชาอื่นใช้อยู่ (ตัดช่องว่าง เทียบตรงตัว รวมวิชาที่ไม่เปิดสอนแล้ว) → 409 ไทย · ปุ่มดึงวิชา: วิชาฝั่งตารางที่รหัสชนกับวิชาที่มีอยู่แล้วแต่ `sched_id` ต่างกัน → ไม่สร้าง นับเป็น `skipped` (ไม่แก้กฎจับคู่ด้วย `sched_id` ของขั้นที่ 1)

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/py/wlrows.py`
  - `wl_can_edit` ครบตาราง: admin ทุกสถานะรอบ · head กลุ่มตัวเอง/กลุ่มอื่น · head ช่องของ admin · head ตอน `submitted`/`approved` · head ตอนรอบ `preparing`/`closed`
  - `test_teacher_change_confirms_row` · `test_confirm_only_by_explicit_true` (PUT ที่แก้แค่ `note` ไม่ทำให้ `confirmed` เป็นจริง)
  - `test_head_reads_only_own_department_even_if_another_is_requested` · `test_head_sees_only_own_options_inside_shared_set` (Review Focus 1)
  - `test_head_put_on_other_department_row_is_403` · `test_put_after_round_closed_is_409_with_thai_reason` (Review Focus 2)
  - `test_bulk_is_all_or_nothing` · `test_bulk_rejects_fields_other_than_teacher_and_confirmed`
  - `test_inactive_teacher_cannot_be_newly_assigned_but_existing_row_still_reads` (Review Focus 3)
  - `test_admin_add_row_for_three_classes_makes_three_rows` · `test_typed_code_matching_registry_binds_subject` · `test_head_cannot_add_or_delete_rows_or_sets (403)`
  - `test_duplicate_subject_code_is_409_on_create_and_rename` · `test_subject_import_skips_code_clash_with_other_sched_id`
  - `test_no_route_deletes_teachers_or_subjects` (ไล่ `app.routes` แบบตัวทดสอบเดิม — DELETE ใต้ `/api/workload` มีได้แค่ `rows/` `sets/` `set-options/`)
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนค่าคงที่ ฟังก์ชันล้วนสองตัว และ route**
- [ ] **Step 4: รันตัวทดสอบ** → ผ่านครบ
- [ ] **Step 5: ลองกับของจริง** — รอบจาก Task 2 · รหัสกลุ่ม 1 และ 2 · หัวหน้ากลุ่ม 1 แก้แถวกลุ่ม 2 → 403 · แก้ `code` → 403 · เปลี่ยนครู → `confirmed: true` · bulk ยืนยัน 10 แถว · ปิดรอบแล้ว PUT → 409 · revision ไม่ขยับ
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: แก้แถวและคาบเสรีตามสิทธิ์ หัวหน้ากลุ่มเห็นแค่กลุ่มตัวเอง"`

---

## Task 4: งานส่ง-ตรวจ-ตีกลับ และยอดคาบรายครู

**Files:**
- Modify: `mock_api.py`
- Create: `tests/fixtures/seed_teacher_loads.json` · `tests/ts/wlloads.ts`
- Test: `tests/py/wlflow.py`

**Interfaces:**
- Consumes: ตาราง Task 1 · `wl_can_edit` (Task 3) · `wl_round_proposal` (Task 1, ใช้ในตัวทดสอบความตรงกัน)
- Produces:
  - `wl_submit_blocker(rows: list[dict], options: list[dict]) -> str|None` — ฟังก์ชันล้วน: มีแถว/ตัวเลือกที่ `teacher_id` ว่าง หรือ `confirmed` เท็จ → ข้อความไทยพร้อมจำนวนทั้งสองแบบ · ครบ → `None`
  - `POST /api/workload/rounds/{id}/departments/{dept}/submit` — head กลุ่มตัวเองเท่านั้น · รอบ `filling` · สถานะ `filling`/`returned` · `wl_submit_blocker` ต้องเป็น `None` (409 ไทย) → `submitted` + `submitted_at` + `submitted_by` = `label` ของรหัส
  - `POST .../departments/{dept}/approve` — admin · จาก `submitted` เท่านั้น → `approved` + `reviewed_*`
  - `POST .../departments/{dept}/return` `{note}` — admin · จาก `submitted` หรือ `approved` · `note` ไม่ว่าง (400) → `returned` + `note` + `reviewed_*`
  - `GET  /api/workload/rounds/{id}/departments` — admin: ทุกกลุ่ม พร้อม `{rows, confirmed, missing_teacher}` ต่อกลุ่ม · head: กลุ่มตัวเองเท่านั้น
  - `wl_teacher_loads(rows: list[dict], sets: list[dict]) -> dict[int, int]` — ฟังก์ชันล้วน กฎของสเปกข้อ 4.4 ข.: แถว → `weekly` ให้ `teacher_id` และ `co_teacher_id` (ถ้าไม่ซ้ำคนเดียวกัน) · ชุด → `weekly` ของชุดให้ครูของแต่ละตัวเลือก **ครั้งเดียวต่อชุดต่อครู**
  - `GET  /api/workload/rounds/{id}/loads` → `[ยอดคาบ]` ตามสัญญา เรียงมากไปน้อย · admin: ครูทุกคนที่มีคาบ `own = total` · head: ครูที่ `wl_teachers.department_id` = กลุ่มตัวเอง ∪ ครูในแถว/ตัวเลือกของกลุ่มตัวเอง · `own` = ส่วนจากแถว/ตัวเลือกของกลุ่มตัวเอง · ไม่มีข้อมูลแถวของกลุ่มอื่นในคำตอบ

ไฟล์คำตอบร่วม `tests/fixtures/seed_teacher_loads.json` = `{ "<sched teacher id>": total }` สร้างครั้งเดียวด้วยสคริปต์ node ที่เรียก `teacherLoads(requirements, electiveSubjectIds(subjects, pools))` จาก `frontend/src/utils/teachingLoad.ts` บน `school_data.json` (สคริปต์ไม่ต้อง commit · บรรทัดคำสั่งเขียนไว้ในคอมเมนต์หัวไฟล์ `tests/ts/wlloads.ts`)

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง**
  - `tests/ts/wlloads.ts`: `teacherLoads` จริงบน `school_data.json` เท่ากับไฟล์คำตอบร่วมทุกคน
  - `tests/py/wlflow.py`:
    - `test_loads_match_timetable_program_for_plain_teachers` — `wl_round_proposal` บนข้อมูลตั้งต้น → `wl_teacher_loads` → แปลงกลับเป็น sched id → ครูที่ไม่มีตัวเลือกคาบเสรี/กิจกรรมและไม่สอนร่วม เท่ากับไฟล์คำตอบร่วมทุกคน
    - `test_elective_option_counts_set_weekly_once_not_per_class` (ชุด 8 ห้อง weekly 2 → 2 · สเปกหลักข้อทดสอบ 8)
    - `test_co_teacher_gets_the_row_weekly` · `test_same_teacher_twice_in_one_set_counts_once`
    - `wl_submit_blocker`: ครบ → None · ขาดครู 2 + ยังไม่ยืนยัน 3 → ข้อความมี 2 และ 3
    - ขั้นงาน: submit ไม่ครบ 409 · submit กลุ่มอื่น 403 · submit ซ้ำตอน `submitted` 409 · approve จาก `filling` 409 · return ต้องมี note · head แก้แถวตอน `submitted` → 409 (ผ่าน `wl_can_edit` ของ Task 3) · return แล้วแก้ได้อีก · head อ่าน departments เห็นแค่กลุ่มตัวเอง · head อ่าน loads ไม่มีครูที่ไม่เกี่ยวกับกลุ่ม
- [ ] **Step 2: สร้างไฟล์คำตอบร่วม แล้วรันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนฟังก์ชันล้วนสองตัว และ route**
- [ ] **Step 4: รันตัวทดสอบ** → ผ่านครบ
- [ ] **Step 5: ลองกับของจริง** — กลุ่ม 1 ยืนยันครบด้วย bulk → submit 200 → แก้แถว 409 → admin return พร้อม note → แก้ได้ → submit → approve · loads ของ admin และ head (คำตอบของ head ไม่มี `name` ของครูที่ไม่เกี่ยว)
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: ส่ง ตรวจผ่าน ตีกลับ และยอดคาบรายครูตามกฎเดียวกับโปรแกรมจัดตาราง"`

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
- [ ] **Step 2: ย้ายหน้าเดิมทั้ง 6 ไฟล์มาใช้ `ui/` และ `AppShell`** — เมนู admin: รอบอัตรากำลัง · สรุปคาบรายครู · ทะเบียนครู · ทะเบียนวิชา · รหัสเข้า (สองแท็บแรกขึ้นหน้าว่าง "กำลังจะมา" จนถึง Task 6/9) · หัวหน้ากลุ่ม: ไม่มีแท็บ
- [ ] **Step 3: ตรวจ** — `bash tests/run.sh` ผ่านครบ · `cd workload && npm run lint && npm run build` สะอาด
- [ ] **Step 4: ดูด้วยตา** — Playwright กับเซิร์ฟเวอร์จริง ถ่ายทุกหน้าของขั้นที่ 1 ที่กว้าง 1280 และ 390 (โทรศัพท์): ล็อกอิน · ตั้งรหัสครั้งแรก · ทะเบียนครู (หลังดึง 143) · ทะเบียนวิชา · รหัสเข้า · หน้าหัวหน้ากลุ่ม · ยืนยันว่าทุกปุ่ม/ช่องของขั้นที่ 1 ยังกดได้ (เดินซ้ำขั้นตอนของคู่มือข้อ 2–5) และไม่มีการเลื่อนแนวนอนทั้งหน้าที่ 390
- [ ] **Step 5: Commit** — `"เว็บลงอัตรากำลัง: ชุดหน้าตาใหม่ที่สบายตา และย้ายทุกหน้ามาใช้"`

---

## Task 6: หน้ารอบของ admin — เปิดรอบ ภาพรวม ตรวจ และปิดรอบ

**Files:**
- Create: `workload/src/round.ts` · `workload/src/roundApi.ts` · `workload/src/pages/RoundsPage.tsx` · `RoundOverview.tsx`
- Modify: `workload/src/App.tsx`
- Test: `tests/ts/wlround.ts`

**Interfaces:**
- Consumes: route ของ Task 2 และ Task 4 · `ui/` (Task 5)
- Produces (`round.ts` — ตรรกะล้วน):
  - `ROUND_STATUS_TEXT` · `DEPT_STATUS_TEXT` · `deptStatusTone(status) -> "warn"|"info"|"ok"|"bad"|"mute"` (`filling` ที่ยังไม่ยืนยันสักแถว = `mute` "ยังไม่เริ่ม")
  - `roundLabel(year, semester) -> string` · `checkRoundForm(year: string, semester: string) -> string|null`
  - `previewLines(p) -> string[]` — ข้อความไทยของหน้าดูก่อนเปิด (จำนวนแถว ชุดคาบเสรี ชุดกิจกรรม คู่สอนร่วมที่รวม แถวที่อยู่ในคาบเสรีแล้ว ครู/วิชาที่จะดึงเพิ่ม)
  - `deptProgress(d) -> {pct, text}`
- Produces (`roundApi.ts`): ฟังก์ชันละหนึ่ง route ของ Task 2–4 คืนชนิดตามสัญญา (ตรวจรูปตัวเลขแบบ `counts()` ใน `api.ts` — ผิดรูป → `ContractError`)

หน้าจอ (ตามภาพ `mockup-admin.png`)
- **ยังไม่มีรอบ** → การ์ดเปิดรอบ: ปี · ภาคเรียน → "ดูก่อนเปิด" → รายการ `previewLines` + รายการแปลงไม่ได้ (ถ้ามี) → "เปิดรอบ" / "ยกเลิก" · ไม่มีอะไรถูกเขียนก่อนกดเปิดรอบ
- **รอบ `preparing`** → แถบเตือน "รอบนี้ยังไม่เปิดให้กลุ่มสาระกรอก" + จำนวนในกองยังไม่ระบุกลุ่มสาระ + ปุ่ม "เปิดให้กลุ่มสาระกรอก" (ปิดไว้พร้อมเหตุผลเมื่อกองไม่ว่าง)
- **ภาพรวม** → ชิปรอบ · `StatTile` สี่ช่อง · การ์ดกลุ่มสาระละใบ (สถานะ ความคืบหน้า หมายเหตุตีกลับ) · ปุ่ม "ตรวจผ่าน" / "ตีกลับ" (กล่องให้พิมพ์หมายเหตุ บังคับไม่ว่าง) บนการ์ดที่ `submitted` · "เปิดดู" ไปหน้าแถวของกลุ่ม (Task 7)
- **ปิดรอบ** → กล่องให้พิมพ์ชื่อรอบยืนยัน · รอบที่ปิดแล้วอยู่ในรายการรอบเก่า เปิดดูได้อ่านอย่างเดียว

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/ts/wlround.ts`: ป้ายและสีทุกสถานะ · `checkRoundForm` (ว่าง · 2499 · 2701 · ภาค 3 · ถูก → null) · `previewLines` ของข้อมูลตั้งต้น ("1,220 แถว" · "คาบเสรี 13 ชุด") · ไม่มีบรรทัดของค่าที่เป็น 0 · `deptProgress` 0/108 → 0% "ยังไม่เริ่ม"
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียน `round.ts` `roundApi.ts` และสองหน้า** แล้วต่อเข้าแท็บ "รอบอัตรากำลัง"
- [ ] **Step 4: ตรวจ** — tests ผ่านครบ · lint + build สะอาด
- [ ] **Step 5: Playwright กับของจริง** (ฐานข้อมูลใหม่ · ดึงครู+วิชาก่อนหรือไม่ก็ได้) — ดูก่อนเปิด → `count(*) wl_rows` ยัง 0 → เปิดรอบ → เปิดให้กรอก → ภาพรวม 11 การ์ด → ปิดรอบด้วยชื่อผิด/ถูก · screenshot ที่ 1280 และ 390 · revision ไม่ขยับ
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: หน้ารอบของผู้ดูแลระบบ — เปิดรอบ ภาพรวม ตรวจ ปิดรอบ"`

---

## Task 7: หน้าแก้แถวและชุดคาบเสรีของ admin

**Files:**
- Create: `workload/src/pages/RoundRowsEditor.tsx` · `SetsEditor.tsx`
- Modify: `workload/src/round.ts` · `workload/src/roundApi.ts` · `workload/src/pages/RoundOverview.tsx`
- Test: `tests/ts/wlround.ts` (ต่อ)

**Interfaces:**
- Consumes: route ของ Task 3 · `round.ts` (Task 6)
- Produces (`round.ts`):
  - `groupBySubject(rows) -> {key, code, name, weekly, kind, credits, rows}[]` — คีย์คือ `subject_id` (แถวที่ไม่มี `subject_id` ใช้ `code`) เรียงตามระดับชั้นของห้องแรกแล้วรหัสวิชา · แถวในกลุ่มเรียงตามชื่อห้องแบบตัวเลข (ม.1/2 ก่อน ม.1/10)
  - `levelOf(groupName) -> string|null` — `"ม.4/6ก"` → `"ม.4"` · ชื่อแปลก → `null`
  - `KIND_TEXT` (พื้นฐาน · เพิ่มเติม · กิจกรรมพัฒนาผู้เรียน)
  - `buildRowBody(form) -> {ok: true, body} | {ok: false, error}` — ห้องอย่างน้อยหนึ่ง · คาบเป็นจำนวนเต็ม ≥ 1 · รหัส+ชื่อหรือวิชาจากทะเบียน

หน้าจอ
- เลือกกลุ่มสาระ (รวมกอง "ยังไม่ระบุกลุ่มสาระ" ที่มีตัวเลขค้าง) → แถวจัดกลุ่มตามวิชา (`groupBySubject`) แก้ช่องของ admin ในแถว
- "เพิ่มวิชา" → เลือกวิชาจากทะเบียนหรือพิมพ์รหัส/ชื่อ · เลือกหลายห้องได้ (ติ๊กทั้งระดับในคลิกเดียว) · คาบ/สัปดาห์ · หน่วยกิต · ประเภท
- ลบแถว (ยืนยันก่อน) · ป้าย `flag` ของแถว (เช่น สอนร่วมคาบไม่เท่ากัน) เห็นชัด
- `SetsEditor` → รายการชุด (คาบเสรี/กิจกรรม) แก้ชื่อ ห้อง คาบ · เพิ่ม/ลบตัวเลือก และกลุ่มที่รับผิดชอบของตัวเลือก
- ข้อผิดพลาดของแถวขึ้นในแถวนั้น (แบบขั้นที่ 1) · reload ไม่ทำให้ของที่พิมพ์ค้างหาย

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง**: `groupBySubject` (ลำดับ · วิชาไม่มี subject_id · ไม่แก้ลิสต์เดิม) · `levelOf` (ม.1/1 · ม.4/6ก · "ห้องที่ไม่มีแล้ว (รหัส 9)" → null) · `buildRowBody` ทุกกรณี
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนตรรกะ และสองหน้า** ต่อจากปุ่ม "แก้แถววิชา" และ "เปิดดู" ใน `RoundOverview`
- [ ] **Step 4: ตรวจ** — tests ผ่านครบ · lint + build สะอาด
- [ ] **Step 5: Playwright กับของจริง** — แก้คาบของแถวหนึ่ง · เพิ่มวิชาให้ 3 ห้อง → 3 แถว · ลบแถว · ย้ายแถวจากกอง "ยังไม่ระบุกลุ่มสาระ" (สร้างด้วย psql) ไปกลุ่ม 1 → ปุ่มเปิดให้กรอกกดได้ · แก้ตัวเลือกของชุดคาบเสรี · screenshot
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: ผู้ดูแลระบบแก้แถววิชาและชุดคาบเสรีของรอบ"`

---

## Task 8: หน้ากรอกของหัวหน้ากลุ่มสาระ

**Files:**
- Create: `workload/src/pages/HeadFillPage.tsx`
- Modify: `workload/src/round.ts` · `workload/src/roundApi.ts` · `workload/src/App.tsx` (หัวหน้ากลุ่มไปหน้านี้แทนข้อความ "ยังไม่มีรอบ…" เมื่อมีรอบ `filling`)
- Test: `tests/ts/wlround.ts` (ต่อ)

**Interfaces:**
- Consumes: route ของ Task 3–4 · `groupBySubject` `levelOf` (Task 7) · `ui/` (Task 5)
- Produces (`round.ts`):
  - `filterRows(rows, {state: "all"|"todo"|"done", level: string|null, query: string}, teacherName: (id) => string) -> rows` — ค้นด้วยรหัสวิชา ชื่อวิชา ชื่อห้อง ชื่อครู (ไม่สนช่องว่างหัวท้าย)
  - `fillProgress(rows, options) -> {total, confirmed, missingTeacher}`
  - `submitState(progress, deptStatus, roundStatus) -> {can: boolean, reason: string|null}` — ข้อความไทยตรงกับเงื่อนไขของ `wl_submit_blocker` ฝั่งเซิร์ฟเวอร์ และสถานะ (`submitted` "ส่งแล้ว รอผู้ดูแลระบบตรวจ" · `approved` "ตรวจผ่านแล้ว" · รอบไม่ใช่ `filling`)
  - `teacherChoices(teachers, deptId) -> {id, name, own}[]` — เฉพาะ `active` · กลุ่มตัวเองก่อน แล้วตามชื่อ · ครูที่ไม่ active แต่อยู่ในแถวแสดงชื่อในแถวนั้นได้ แต่ไม่อยู่ในตัวเลือก

หน้าจอ (ตามภาพ `mockup-head.png`)
- หัวหน้า: ชื่อกลุ่ม · ชิปสถานะกลุ่ม · การ์ดความคืบหน้า + ปุ่มส่ง (ปิดพร้อมเหตุผลจาก `submitState`) · ถ้า `returned` แถบหมายเหตุจาก admin เด่นอยู่บนสุด
- ตัวกรอง: ทั้งหมด/ยังไม่ยืนยัน/ยืนยันแล้ว · ค้นหา · ระดับชั้น
- การ์ดวิชาละใบ (พับได้) · แถว: ติ๊กเลือก · ห้อง · ครูผู้สอน · ครูสอนร่วม · ห้องปฏิบัติการ · คาบคู่ · หมายเหตุ · สถานะ ("จากเทอมก่อน" + ปุ่มยืนยัน / "ยืนยันแล้ว") · แถวยังไม่ยืนยันพื้นเหลืองจาง
- ปุ่มของการ์ด: "ใส่ครูให้แถวที่เลือก" · "ยืนยันแถวที่เลือก" (ใช้ `rows/bulk`)
- ส่วนคาบเสรี/กิจกรรม: ตัวเลือกของกลุ่มตัวเอง ช่องครู ห้อง หมายเหตุ ยืนยัน
- ด้านข้าง (จอกว้าง) / ด้านล่าง (จอแคบ): คาบรายครูของกลุ่มจาก `loads` (แถบยาวตามยอด ยอดเกินค่ามากสุดของกลุ่มเป็นสีเตือน) อัปเดตหลังบันทึก
- จอแคบ: แถวกลายเป็นการ์ดซ้อน · ไม่มีเลื่อนแนวนอนทั้งหน้า (Review Focus 5)
- การบันทึกที่ได้ 409 (ส่งแล้ว/รอบปิด) → ขึ้นข้อความไทยของเซิร์ฟเวอร์ และโหลดสถานะใหม่ ค่าในตัวแก้ของแถวนั้นยังอยู่ (Review Focus 2)

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง**: `filterRows` (สามสถานะ · ระดับ · ค้นชื่อครู · ช่องว่างหัวท้าย) · `fillProgress` · `submitState` ทุกสถานะ และข้อความตอนขาดครู/ยังไม่ยืนยันมีตัวเลข · `teacherChoices` (ไม่มีครูที่ไม่ active · กลุ่มตัวเองก่อน · ชื่อซ้ำเป็นสองตัวเลือกด้วย id)
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนตรรกะ และหน้า**
- [ ] **Step 4: ตรวจ** — tests ผ่านครบ · lint + build สะอาด
- [ ] **Step 5: Playwright กับของจริง** (รอบเปิดให้กรอกแล้ว · รหัสกลุ่ม 1 และ 9) — กลุ่ม 9 (258 แถว) ที่จอ 390: ตัวกรองทำงาน ไม่มีเลื่อนแนวนอน (`document.documentElement.scrollWidth <= 390`) · กลุ่ม 1: ยืนยันทีละแถว · เลือก 5 แถวใส่ครูคนเดียว → ยืนยันแล้วทั้ง 5 · ยอดคาบด้านข้างเปลี่ยน · ส่งไม่ได้จนครบ → ครบ → ส่ง → หน้าเป็นอ่านอย่างเดียว · admin ปิดรอบขณะอีกหน้าเปิดค้าง → บันทึกได้ข้อความ 409 ไทย · screenshot ที่ 1280 และ 390
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: หน้าหัวหน้ากลุ่มสาระ ยืนยันครูทีละแถวหรือทั้งชุด แล้วส่งตรวจ"`

---

## Task 9: สรุปคาบรายครู พิมพ์ได้ และคู่มือขั้นที่ 2

**Files:**
- Create: `workload/src/pages/LoadsPage.tsx`
- Modify: `workload/src/round.ts` · `workload/src/index.css` (`@media print`) · `workload/src/App.tsx` · `docs/workload-setup.md`
- Test: `tests/ts/wlround.ts` (ต่อ)

**Interfaces:**
- Consumes: `GET .../loads` (Task 4) · `ui/` (Task 5)
- Produces (`round.ts`): `loadRows(loads, departments, filterDept: number|null) -> {teacher_id, name, deptName, total, own}[]` — เรียงตามกลุ่มสาระแล้วยอดมากไปน้อย · ครูไม่มีกลุ่มอยู่ท้าย

หน้าจอ
- admin: แท็บ "สรุปคาบรายครู" — ตารางครูทั้งโรงเรียนจัดตามกลุ่มสาระ เลือกกลุ่มได้ · ปุ่ม "พิมพ์" (`window.print()`) · ใต้หัวตารางมีหนึ่งบรรทัด: นับแบบเดียวกับโปรแกรมจัดตาราง และคาบเสรีนับครั้งเดียวต่อชุด ครูที่สอนคาบเสรีจึงอาจได้ยอดมากกว่ายอดตามแผนในโปรแกรม (สเปกข้อ 4.4 ข.)
- หัวหน้า: ลิงก์ "ดูทั้งหมด · พิมพ์" จากหน้ากรอก ไปหน้าเดียวกันแบบกลุ่มตัวเอง (ครูข้ามกลุ่มแสดงยอดรวม และส่วนของกลุ่มนี้)
- พิมพ์: ไม่มีแถบบน/แท็บ/ปุ่ม · หัวกระดาษ "สรุปคาบรายครู ภาคเรียน 2/2569 · กลุ่มสาระ…" · ตารางไม่แตกกลางแถว

คู่มือ `docs/workload-setup.md` — เพิ่มหัวข้อ (ภาษาไทย สำหรับคนที่ไม่ใช่โปรแกรมเมอร์ ตามแบบเดิมของไฟล์):
1. **เปิดรอบอัตรากำลัง** (admin): ดึงครู/วิชาก่อนก็ได้ ไม่ดึงระบบดึงให้ · ดูก่อนเปิด · เปิดรอบ · จัดแถวกอง "ยังไม่ระบุกลุ่มสาระ" · เปิดให้กลุ่มสาระกรอก · ตรวจผ่าน/ตีกลับ · ปิดรอบ
2. **สำหรับหัวหน้ากลุ่มสาระ**: ป้าย "จากเทอมก่อน" คืออะไร · ยืนยันทีละแถว/ทั้งชุด · ใส่ครูให้หลายห้อง · คาบเสรี · กดส่ง · ถ้าถูกตีกลับ
3. **เรื่องที่ต้องรู้เพิ่ม**: รอบนี้ไม่แตะตารางสอน · การส่งเข้าโปรแกรมจัดตารางเป็นขั้นที่ 3 · ยอดคาบเสรีต่างจากยอดในโปรแกรมได้ เพราะอะไร
4. ตารางข้อสอบท้ายคู่มือ: เพิ่มข้อ 1, 2, 8, 9, 10 ของสเปกหลักพร้อมผลที่ลองในเครื่องพัฒนา และข้อ 7 ที่ต้องเทียบกับไฟล์ Excel เอง

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง**: `loadRows` (ลำดับ · กรองกลุ่ม · ครูไม่มีกลุ่มท้าย · ไม่แก้ลิสต์เดิม)
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนตรรกะ หน้า และ print stylesheet** แล้วต่อเข้าแท็บ
- [ ] **Step 4: แก้คู่มือ** และไล่เลขอ้างอิงข้ามหัวข้อทุกจุดให้ถูก
- [ ] **Step 5: ตรวจ** — tests ผ่านครบ · lint + build สะอาด · Playwright: หน้าสรุปของ admin และหัวหน้า · `page.pdf()` ของหน้าพิมพ์ไม่มีแถบเมนู · screenshot
- [ ] **Step 6: Commit** — `"เว็บลงอัตรากำลังขั้นที่ 2: สรุปคาบรายครูที่พิมพ์ได้ และคู่มือการใช้รอบอัตรากำลัง"`

---

## หลังจบทั้ง 9 task

1. รีวิวทั้งสาขาบนโมเดลที่เก่งที่สุด (`superpowers:requesting-code-review`) แก้รอบเดียว แล้วตรวจซ้ำหนึ่งรอบ
2. ลองอัปเกรดกับ Postgres ทดลอง: เซิร์ฟเวอร์รุ่นบน `main` ตอนนั้นสร้างข้อมูลขั้นที่ 1 (รหัส ครู วิชา) → รุ่นใหม่บนฐานเดียวกัน → ตารางใหม่ถูกสร้าง ของเดิมครบ เปิดรอบได้
3. merge เข้า `main` ครั้งเดียวผ่าน Pull Request (ทุก push เข้า `main` ทำให้เซิร์ฟเวอร์บน Render เริ่มใหม่ 1–3 นาที) · อัปเดต `docs/HANDOFF.md` ในคอมมิตเดียวกัน
