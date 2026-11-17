# เว็บลงอัตรากำลัง ขั้นที่ 3 — สร้างเทอมใหม่จากรอบอัตรากำลัง (แผนลงมือ)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปุ่ม "สร้างเทอมใหม่" ของโปรแกรมจัดตารางเลือกรอบอัตรากำลังที่ใช้ได้ แล้วเทอมใหม่เริ่มด้วยแผนการสอน คาบเสรี หลักสูตร และทะเบียนครู/วิชาที่ซิงก์แล้ว — ในธุรกรรมเดียว

**Architecture:** ตรรกะแปลงทั้งหมดเป็นฟังก์ชันล้วนในโมดูลใหม่ `term_from_round.py` (รับข้อมูลเป็น dict คืนสถานะใหม่เป็นสำเนา ไม่ import `mock_api`)
· `mock_api.py` อ่านข้อมูลของรอบด้วย cursor เดียว ตรวจเกณฑ์ ใส่สถานะใหม่ หมุนเทอม เขียนกลับ และ COMMIT ครั้งเดียว · หน้าต่างสร้างเทอมใหม่ใน `frontend/` เพิ่มทางเลือกรอบ

**Tech Stack:** Python 3 · FastAPI (ไม่มี Pydantic) · psycopg 3 · PostgreSQL · React + TS (frontend/ และ workload/) · ตัวทดสอบ `bash tests/run.sh`

**Spec:** `docs/superpowers/specs/2026-11-17-workload-stage3-new-term-design.md` (ผู้ใช้อนุมัติ 17 พ.ย.) · สเปกหลัก `docs/superpowers/specs/2026-11-06-workload-entry-site-design.md` ส่วนที่ 7–8

## Global Constraints

- ข้อมูลของ **เทอมที่ถูกปิด** ต้องเหมือนที่ปุ่มแบบเดิมเก็บทุกไบต์ — บรรจุเทอมเก่า (`_pack(_snapshot())`) **ก่อน** แตะทะเบียนหรือแผน
- **ทั้งหมดหรือไม่มีเลย**: ล้มก่อน COMMIT → ฐาน ROLLBACK และตัวแปรของโปรแกรมทุกตัวกลับเป็นค่าก่อนกด · COMMIT ครั้งเดียวด้วยการเชื่อมต่อเดียว
- **ห้ามโค้ดใหม่เขียน `SLOTS`** — ขั้นล้างคาบของปุ่มเดิมเป็นที่เดียว ไม่เปลี่ยน
- ทางเดิม (ไม่มี `round_id`) ต้องเดินโค้ดเดิมทุกขั้น · `tests/py/terms.py` และ `tests/py/termguard.py` ผ่านโดยไม่แก้
- การเขียน `TEACHERS` `SUBJECTS` `REQUIREMENTS` `ELECTIVE_POOLS` `CURRICULA` และ `curriculum_id` ของห้อง ทำ **ภายในคำขอ `POST /api/terms` เท่านั้น** — route ใต้ `/api/workload/` ห้ามแตะ (คอมเมนต์ที่ `WORKLOAD_PREFIX`)
- ทะเบียน: เพิ่มใหม่และแก้ช่องตัวตนเท่านั้น ไม่ลบ · ช่องที่เว็บเป็นเจ้าของ — ครู: `name` `code` `department_id` `dept_order` · วิชา: `code` `name` `type` `department_id` `duration` `is_activity` `is_elective` — ช่องอื่นของแถวเดิมต้องเท่าเดิมทุกช่อง
- อ้างครู/วิชาด้วยรหัสเท่านั้น ห้ามจับคู่ด้วยชื่อ (รหัสวิชาที่ตรงทุกตัวอักษรหลังตัดช่องว่างใช้ผูกได้ตามแบบข้อ 4.3)
- ห้ามสร้าง unique index ใหม่บนตารางที่มีข้อมูลจริง · เพิ่มคอลัมน์ด้วย `ALTER TABLE … ADD COLUMN IF NOT EXISTS` เท่านั้น
- ข้อความที่ผู้ใช้เห็นเป็นไทยทั้งหมด รวม `detail` · ไม่เพิ่ม dependency
- `frontend/` แก้ได้เฉพาะ `components/terms/` · `utils/terms.ts` · `api/client.ts` · `store/timetableStore.ts` (ส่วน `makeNewTerm`) · ห้ามแตะ `.github/`
- ทดสอบกับ Postgres ทดลองในเครื่องเท่านั้น — ห้ามแตะฐานข้อมูลจริงของโรงเรียน

## Review Focus

1. ข้อมูลจริงของโรงเรียนเก็บคาบเสรีเป็นช่องรายห้องในตาราง + แถวแผนของวิชาเสรีรายห้อง → ส่งแล้วแถวแผนเหล่านั้นต้องอยู่ ยอดคาบรายครูของโปรแกรมไม่หาย (Task 2 ชุด ข)
2. admin กดยืนยันสองครั้ง / สองเบราว์เซอร์พร้อมกัน → เทอมเดียว อีกคำขอได้ 409 ไทย ไม่มีครูซ้ำ (Task 4)
3. เครื่องดับทันทีหลัง COMMIT → เริ่มใหม่แล้วแผน ครู และเทอมที่เปิดอยู่ตรงกับฐาน (Task 4)
4. มีคนกดดึงครูจากโปรแกรม หรือแก้แถวของรอบ ระหว่างสร้างเทอม → ไม่มีแถวที่ชี้ไปครู/วิชาที่ไม่มีจริง ไม่ว่าสร้างสำเร็จหรือถูกย้อน (Task 3 ล็อก + Task 4 ทดสอบ)
5. วิชาที่พิมพ์รหัสเองถูกอ้างหลายบรรทัด และรหัสชนกับวิชาที่มีอยู่ในโปรแกรม → ได้วิชาเดียว (Task 1)

## สัญญาที่ทุก task ใช้ร่วมกัน

- **ข้อมูลของรอบ** (`source`, Task 3 อ่าน · Task 1–2 ใช้): `{"round": {id, year, semester, label, status, exported_at},
  "rows": [แถวตามสัญญาของขั้นที่ 2: id, group_id, line_id, subject_id (wl), weekly, teacher_id, co_teacher_id, lab_room_id, is_double, confirmed, flag, department_id],
  "options": [ตัวเลือกตามรูป GET …/rows ของขั้นที่ 2 (มี set ฝัง + teachers)], "sets": [ทุกชุดของภาคเรียน {id, kind, name, group_ids, weekly, is_double}],
  "curricula": [{id, name, group_ids, lines: [{id, subject_id (wl|None), code, name, credits, weekly, kind, department_id}]}],
  "wl_teachers": [{id, sched_id, name, code, department_id, dept_order, active}], "wl_subjects": [{id, sched_id, code, name, type, department_id, duration, is_activity, is_elective, active}],
  "dept_status": [{department_id, status}]}`
- **ของเทอมที่กำลังปิด** (`outgoing`): `_wl_timetable_source`-shape (`requirements` `pools` `slots` `served` `sched_subjects` `groups`) + `"teachers"` (สำเนาลึกของ `TEACHERS`) + `"subjects"` (สำเนาลึกของ `SUBJECTS`) + `"curricula"` (สำเนาลึกของ `CURRICULA`)
- **ตัวนับรหัส** `counters`: สำเนาของ `_counters` · ฟังก์ชันล้วนจองรหัสแบบเดียวกับ `_next` (`counters[k] = counters.get(k, 0) + 1`) แล้วคืนตัวนับใหม่

---

## Task 1: ซิงก์ทะเบียนครูและวิชา (ฟังก์ชันล้วน)

**Files:**
- Create: `term_from_round.py`
- Test: `tests/py/wlexportreg.py`

**Interfaces:**
- Consumes: รูป `source` · `outgoing["teachers"]` / `["subjects"]` · `counters`
- Produces:
  - `TEACHER_OWNED = ("name", "code", "department_id", "dept_order")` · `SUBJECT_OWNED = ("code", "name", "type", "department_id", "duration", "is_activity", "is_elective")`
  - `TEACHER_DEFAULTS = {"fixed_room_id": None, "outdoor_score": 5, "max_slots_per_day": 6, "max_outdoor_per_week": 2, "active": True}` · `SUBJECT_DEFAULTS = {"type": "common", "prefer_morning": False, "duration": 1, "fixed_room_id": None, "active": True}` (ค่าเดียวกับ `/api/teachers/bulk` `/api/subjects/bulk` — ตัวทดสอบเทียบกับสองฟังก์ชันนั้นจริง)
  - `typed_subjects(source) -> list[dict]` — บรรทัด/ตัวเลือกที่ `subject_id` ว่าง จัดกลุ่มด้วยรหัสหลังตัดช่องว่าง `[{code, name, department_id, credits, line_ids, option_ids}]`
  - `registry_plan(source, outgoing, counters) -> dict` →
    `{"teachers": [...TEACHERS ใหม่ทั้งชุด], "subjects": [...], "counters", "teacher_map": {wl_id: sched_id}, "subject_map": {wl_id: sched_id}, "typed_map": {code: sched_id},
      "writeback": {"teachers": [{"id", "old", "new"}], "subjects": [{"id", "old", "new"}], "new_wl_subjects": [{code, name, department_id, sched_id, line_ids, option_ids}]},
      "report": {"teachers_created", "teachers_patched", "subjects_created", "subjects_patched", "code_links", "inactive_open", "unknown_teachers"}, "reasons": [str]}`
  - กฎตามแบบข้อ 4.3: สร้างครูเมื่อ (ยังปฏิบัติงาน **หรือ** ถูกอ้างในรอบ) และ `sched_id` ว่างหรือชี้ไปครูที่ไม่มี · วิชาใช้กฎเดียวกัน · `credits` ของวิชาใหม่ = บรรทัดแรกที่อ้างถึงตามลำดับ (`curricula` แล้ว `lines`) ·
    ผูกด้วยรหัสวิชาเมื่อโปรแกรมมีรหัสนั้น **วิชาเดียว** และยังไม่ผูกกับวิชาของเว็บ · รหัสมีหลายวิชาหรือผูกแล้ว → `reasons` ไทยระบุรหัส · ครูไม่ปฏิบัติงานที่ยังเปิดในโปรแกรม → `inactive_open` (ไม่แก้ `active`) ·
    ครูในโปรแกรมที่ไม่มี `wl_teachers.sched_id` ชี้ถึง → `unknown_teachers` · **ไม่แก้รายการที่ส่งเข้ามา** (ทำงานกับสำเนา)

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง** (`tests/py/wlexportreg.py`, ไม่ใช้ฐานข้อมูล):
  `test_defaults_match_bulk_routes` (เรียก `mock_api.bulk_create_teachers`/`bulk_create_subjects` จริงบนสำเนาแล้วเทียบช่องค่าตั้งต้น — grep ชื่อจริงของสอง route) ·
  `test_creates_teacher_without_sched_id_and_maps_back` · `test_creates_inactive_teacher_only_when_used_by_round` · `test_dangling_sched_id_is_recreated` ·
  `test_patch_touches_only_owned_fields` (ครูมี `advanced_settings` `max_slots_per_day` `fixed_room_id` — หลังแก้ชื่อทุกช่องอื่นเท่าเดิม = ข้อทดสอบ 10ก) ·
  `test_inactive_in_web_is_reported_not_closed` · `test_unknown_program_teachers_are_listed` · `test_typed_code_used_by_three_lines_creates_one_subject` ·
  `test_typed_code_matching_web_subject_binds_instead_of_create` · `test_code_link_to_single_unlinked_program_subject` · `test_code_on_two_program_subjects_is_a_reason` ·
  `test_new_subject_credits_from_first_line` · `test_ids_come_from_counters_and_counters_advance` · `test_inputs_not_mutated` (deep-equal ก่อน/หลัง)
- [ ] **Step 2: รันให้เห็นว่าแดง** — `bash tests/run.sh` → `wlexportreg.py` ล้มเพราะ `ModuleNotFoundError: term_from_round`
- [ ] **Step 3: เขียน `term_from_round.py`** — คอมเมนต์หัวไฟล์ภาษาไทยบอกว่าโมดูลนี้ห้าม import `mock_api` และห้ามแตะตัวแปรของโปรแกรม
- [ ] **Step 4: รัน** → `— ผ่าน 28 · ไม่ผ่าน 0 —`
- [ ] **Step 5: Commit** — `"ขั้นที่ 3: ซิงก์ทะเบียนครูและวิชาจากรอบ (ฟังก์ชันล้วน) — เพิ่มใหม่และแก้ช่องตัวตนเท่านั้น"`

---

## Task 2: แผนการสอน คาบเสรี และหลักสูตรของเทอมใหม่ (ฟังก์ชันล้วน)

**Files:**
- Modify: `term_from_round.py`
- Test: `tests/py/wlexportplan.py`

**Interfaces:**
- Consumes: `registry_plan` (Task 1: `teacher_map` `subject_map` `typed_map`) · `source` · `outgoing`
- Produces:
  - `plan_from_round(source, outgoing, maps: dict, counters) -> dict` → `{"requirements", "pools", "curricula", "group_curricula": {group_id: curriculum_id|None}, "elective_subjects": [sched ids], "counters",
    "report": {"rows", "periods", "teachers_in_plan", "pools", "pool_options", "activity_sets": [{name, group_ids, weekly, teacher_ids}], "carried", "not_carried", "elective_rows"}}`
  - กฎตามแบบข้อ 4.2 ทุกแถวของตาราง: แถวรอบ → `REQUIREMENTS` (`co_teacher_id` · `room_id` = `lab_room_id` · `pinned_double` ใส่เมื่อจริง) ·
    ยก `parallel_group_key` `pinned_day` `pinned_period` `pinned_double` จากแผนเดิมด้วยก้อน (ห้อง, วิชา) เมื่อทุกแถวในก้อนเห็นตรงกัน ·
    แถว `WL_CO_UNEQUAL_FLAG` เป็นสองแถวชี้กัน · ชุด `elective` → pool (`day`/`period` = None · ตัวเลือกต่อ (ตัวเลือก, ครู) · `room_id`) ·
    แถวแผนของวิชาเสรี: (g, S) ที่แผนเดิมมี → เขียนแถว ครูเดิมถ้ายังสอนตัวเลือกนั้น ไม่งั้นครูของตัวเลือกคนแรก (รหัสน้อยสุด) คาบเท่าแถวเดิม ·
    ชุด `activity` → `report.activity_sets` เท่านั้น · หลักสูตร → `{id, name, rows: normalise_rows(...)}` (ใช้ `curriculum.normalise_rows` — โมดูลล้วนอยู่แล้ว import ได้) ·
    ห้องที่ไม่อยู่หลักสูตรใด → `None` · รหัสใหม่จาก `counters` (`requirement` `elective_pool` `elective_option` `curriculum`)

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง** (`tests/py/wlexportplan.py`):
  - หน่วย: `test_row_maps_teacher_co_room_double` · `test_carry_keys_when_group_agrees` · `test_two_row_coteach_still_carries` · `test_conflicting_old_rows_do_not_carry_and_are_counted` ·
    `test_unequal_coteach_rows_stay_two_and_point_at_each_other` · `test_elective_set_becomes_unplaced_pool_with_one_option_per_teacher` ·
    `test_elective_rows_follow_outgoing_shape` (มีแถวเดิม → เขียน · ไม่มี → ชุดอย่างเดียว · ครูเดิมไม่สอนแล้ว → ครูคนแรก) · `test_activity_set_only_in_report` ·
    `test_curricula_rows_and_group_attach` · `test_ids_from_counters` · `test_inputs_not_mutated`
  - **ไปกลับ (แบบข้อทดสอบ 1)** ผ่านฟังก์ชันล้วนทั้งเส้น ไม่ใช้ฐานข้อมูล: แผนของโปรแกรม → `wl_round_proposal(src)` → `wl_curricula_from_proposal` → แถว/ตัวเลือกพร้อมครูจาก `wl_prefill`
    (ยืนยันทุกแถว · ใช้แผนที่ id ของเว็บ = sched id) → `registry_plan` → `plan_from_round` → เทียบกับแผนเดิมที่ผ่าน `_fold_coteaching` เป็นหลายเซตของ
    (ห้อง, วิชา, ครู, ครูสอนร่วม, คาบ, room_id, parallel_group_key, pinned_*) · ชุดคาบเสรี (group_ids, weekly, {(วิชา, ครู)}) ตรงกัน ·
    เซตวิชาเสรี (`pools` ∪ `is_elective` ∪ ตัวเลือกของช่องคาบเสรีในตาราง) ของเทอมใหม่ = ของเดิม (ฟังก์ชัน `teacherLoads` ของโปรแกรมขึ้นกับสามอย่างนี้ — เท่ากัน = ยอดคาบเท่ากัน) ·
    แถวที่ขั้นที่ 2 แปลงไม่ได้ (`unconverted`) ถูกหักออกพร้อมนับ
    - `test_round_trip_seed` — ชุด ก: `school_data.json`
    - `test_round_trip_live_shape` — ชุด ข: สำเนาข้อมูลตั้งต้นที่แปลงคาบเสรีบางชุดเป็น **ช่องคาบเสรีรายห้องในตาราง + แถวแผนของวิชาเสรีรายห้อง** ด้วยวิธีเดียวกับที่หน้าจัดคาบสร้างจริง
      (grep `elective_options` และ route ที่สร้างช่องคาบเสรีรายห้อง แล้วเรียกฟังก์ชันนั้นในโปรเซสบนสำเนา) · ต้องมีอย่างน้อย 5 ชุดแบบรายห้อง
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียน `plan_from_round`** ใน `term_from_round.py`
- [ ] **Step 4: รัน** → `— ผ่าน 29 · ไม่ผ่าน 0 —` · รายงานจำนวนแถว/ชุดของไปกลับทั้งสองชุดในรายงานของ task
- [ ] **Step 5: Commit** — `"ขั้นที่ 3: แปลงรอบเป็นแผนการสอน คาบเสรี และหลักสูตรของเทอมใหม่ (ฟังก์ชันล้วน) และทดสอบไปกลับ"`

---

## Task 3: อ่านรอบ เกณฑ์รอบ ล็อกทะเบียน และหน้าดูก่อนสร้าง (เซิร์ฟเวอร์ ไม่เขียนอะไร)

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlexportpreview.py`

**Interfaces:**
- Consumes: `registry_plan` · `plan_from_round` (Task 1–2) · `_wl_round_rows_sql` `_wl_round_items` `wl_approve_blocker` `_wl_timetable_source` (ขั้นที่ 2)
- Produces:
  - `_WL_SCHEMA`: `ALTER TABLE wl_rounds ADD COLUMN IF NOT EXISTS exported_at timestamptz` · `exported_term_id bigint` · `exported_label text` · `export_report jsonb` (สี่คำสั่ง · ไม่มี index)
  - `WL_REGISTRY_LOCK_KEY: int` (ค่าคงที่ระบุตัว) · `_wl_registry_lock(cur) -> None` = `SELECT pg_advisory_xact_lock(%s)` — **เรียกเป็นคำสั่งแรก** ใน route เพิ่ม/แก้ครู เพิ่ม/แก้วิชา และดึงครู/ดึงวิชาจากโปรแกรม (ก่อนอ่านตัวแปรของโปรแกรม)
  - `_wl_export_source(cur, round_id: int) -> dict` — รูป `source` (สัญญาร่วม) จากการเชื่อมต่อเดียว · ไม่มีรอบ → 404 ไทย
  - `wl_export_reasons(source: dict, year: int, semester: int) -> list[str]` (ล้วน) — เกณฑ์แบบข้อ 4.1 ทั้ง 5 ข้อ ข้อความไทยระบุกลุ่ม/จำนวน
  - `_term_outgoing() -> dict` — รูป `outgoing` (สำเนาลึก)
  - `_term_build(source, outgoing, counters, year, semester) -> dict` → `{"registry", "plan", "reasons", "report"}` (รวม Task 1–2 + เหตุ · `report` = ตัวเลขและรายการของแบบข้อ 4.5)
  - `GET /api/terms/rounds` → `[{id, label, year, semester, status, exported_at, exported_label, usable, reasons}]` ใหม่ก่อน (ปี/ภาคที่ใช้ตรวจ = ของรอบเอง)
  - `GET /api/terms/preview?round_id=` → ไม่ส่ง `round_id` = **คืนค่าเดิมเป๊ะ** · ส่ง → ตัวเลขเดิม 5 ตัว + `"round": {id, label, year, semester, usable, reasons, report}` · ไม่มีฐานข้อมูล → 503 ไทย
  - รูปรอบของเว็บลงอัตรากำลัง (`wl_round_view`) เพิ่ม `exported_at` · `exported_label` · `export_report`

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง** (`tests/py/wlexportpreview.py`): `test_schema_adds_columns_without_index` · `test_registry_lock_is_first_statement_of_registry_writes` (SQL ของ route จริงด้วย cursor ปลอม — ทั้ง 6 route) ·
  `test_reasons_each_rule` (ปีไม่ตรง · ส่งแล้ว · preparing · ขาดครู/ยังไม่ยืนยัน · กลุ่มยังไม่ตรวจผ่านขณะรอบยัง filling · รอบปิดแล้วไม่ต้องตรวจผ่าน · กลุ่มไม่มีรายการไม่นับ · วิชาไม่มีรหัส) ·
  `test_preview_without_round_is_unchanged` · `test_preview_with_round_writes_nothing` (ตัวแปรของโปรแกรม deep-equal · ฐานไม่มี INSERT/UPDATE) · `test_rounds_list_shape` · `test_round_view_has_export_fields`
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนตามสัญญา**
- [ ] **Step 4: รัน** → `— ผ่าน 30 · ไม่ผ่าน 0 —`
- [ ] **Step 5: ลองกับของจริง** — ฐานใหม่ · ตั้งต้นหลักสูตร 2/2569 · เปิดรอบ · `GET /api/terms/rounds` (ใช้ไม่ได้ + เหตุ) · ยืนยันทุกแถวผ่าน bulk + ส่ง/ตรวจผ่านทุกกลุ่ม · preview → ตัวเลข (แถว 1,220 · ชุด 13 · ตัวเลือก 44) · `count(*)` ของทุกตาราง + revision ไม่ขยับ ·
  สองเซสชัน psql: ถือ `pg_advisory_xact_lock(WL_REGISTRY_LOCK_KEY)` ค้าง → ปุ่มดึงครูรอ แล้วทำต่อเมื่อปล่อย
- [ ] **Step 6: Commit** — `"ขั้นที่ 3: อ่านรอบ เกณฑ์รอบ ล็อกทะเบียน และหน้าดูก่อนสร้างเทอมจากรอบ"`

---

## Task 4: สร้างเทอมใหม่จากรอบ — ธุรกรรมเดียว

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlexportcreate.py`

**Interfaces:**
- Consumes: `_wl_export_source` `_term_build` `_wl_registry_lock` `_term_outgoing` (Task 3) · `create_term` `_term_rotate` `_pack` `_snapshot` `_DB_UPSERT` `wl_check_code` `_wl_fail_guard` `_wl_fail_record` `_wl_code_rows` (ของเดิม)
- Produces:
  - `POST /api/terms` รับเพิ่ม `round_id: int` และ `admin_code: str` — ไม่มี `round_id` → โค้ดเดิมทุกบรรทัด
  - รหัส: `_wl_fail_guard("login", …)` ก่อนแฮช · ต้องตรงกับรหัส `admin` ที่เปิดใช้ (`wl_check_code`) · ผิด → `_wl_fail_record("login")` + 403 ไทย · ไม่ส่ง → 400 ไทย
  - `_term_rotate(..., cur=None)` — ส่ง `cur` = ใช้ cursor นั้น ไม่เปิดการเชื่อมต่อเองและไม่ COMMIT · ไม่ส่ง = เหมือนเดิมทุกอย่าง
  - ลำดับตามแบบข้อ 4.4 ขั้น 1–9 ตรงตัว: ล็อกทะเบียน → `FOR UPDATE` แถวรอบ → `_wl_export_source` → `_term_build` (เหตุไม่ว่าง → 409 ไทยรวมเหตุ) → เก็บสำเนาเพื่อย้อน
    (`TEACHERS` `SUBJECTS` `REQUIREMENTS` `ELECTIVE_POOLS` `CURRICULA` `curriculum_id` ทุกห้อง `_counters` `SLOTS` `PARKED` `CURRENT_TERM` `SCHOOL_CONFIG` `LAST_RUN`) →
    บรรจุเทอมเก่า → ล้างคาบ (โค้ดเดิม) → ใส่สถานะใหม่ **แทนในที่** (`[:] =` · ตัวแปรที่ถูก rebind ที่อื่นให้อ่านด้วยชื่อตอนเรียก) + `_mark_elective` ของวิชาในชุด + `curriculum_id` →
    บรรจุเทอมใหม่ → `_term_rotate(cur=…)` → `_DB_UPSERT` ของ `app_state` เป็นไฟล์เทอมใหม่ → เขียน `sched_id` กลับ + สร้าง/ผูกวิชาที่พิมพ์รหัสเอง →
    `UPDATE wl_rounds SET status='closed', closed_at=coalesce(closed_at, now()), exported_at=now(), exported_term_id, exported_label, export_report WHERE id=%s AND exported_at IS NULL` (0 แถว → 409) → COMMIT
  - `export_report` = `report` ของ `_term_build` + `{"prior_status", "teachers": [{"id","old"}], "subjects": [{"id","old"}], "created_wl_subjects": [id], "bound_lines": [id], "bound_options": [id]}` (Task 5 ใช้ย้อน)
  - ล้มก่อน COMMIT → ROLLBACK + คืนทุกตัวจากสำเนา → 500 ไทย "สร้างเทอมไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ" (409 สำหรับเหตุ/ส่งแล้ว) · หลัง COMMIT: `CURRENT_TERM["id"]` · `_term_log` · `LAST_RUN` ว่าง · `_lookup_cache_clear()` · `_save_state()` (เหมือนทางเดิม)
  - คำตอบเพิ่ม `"report"`

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง** (`tests/py/wlexportcreate.py`, ใช้แบบ `_FakeConn`/`_SeqConn` ของ `tests/py/terms.py` + ฟังก์ชันอ่านรอบที่ปลอมได้):
  `test_old_path_untouched_without_round_id` (คำสั่ง SQL และตัวแปรเท่าก่อนงานนี้) · `test_closed_term_blob_equals_plain_create` (คลาย JSON เทียบกับทางเดิมจากสถานะเดียวกัน) ·
  `test_new_state_applied_and_counters_advanced` · `test_one_commit_one_connection` · `test_app_state_written_inside_transaction` ·
  `test_failure_at_each_step_restores_everything` (ฉีดล้ม: ใส่ · บรรจุใหม่ · หมุน · app_state · เขียนกลับ · ทำเครื่องหมาย · COMMIT — ทุกตัวแปร deep-equal ก่อนกด · ไม่มี COMMIT) ·
  `test_reasons_give_409_and_nothing_changes` · `test_wrong_code_403_and_counted` · `test_missing_code_400` · `test_round_already_exported_409` · `test_report_returned`
- [ ] **Step 2: รันให้เห็นว่าแดง**
- [ ] **Step 3: เขียนตามสัญญา** — คอมเมนต์ไทยที่หัวส่วนบอกลำดับและเหตุผล (เทอมเก่าก่อน · app_state ในธุรกรรม · ล็อกทะเบียนก่อนแถวรอบ)
- [ ] **Step 4: รัน** → `— ผ่าน 31 · ไม่ผ่าน 0 —` · `tests/py/terms.py` `termguard.py` ไม่ได้แก้
- [ ] **Step 5: ลองกับของจริง** (Postgres ทดลอง · ข้อมูลตั้งต้น):
  1. ไปกลับเต็มเส้นผ่าน HTTP: ตั้งต้น → เปิดรอบ → ยืนยัน/ส่ง/ตรวจผ่าน → `POST /api/terms {year:2569, semester:2, round_id, admin_code}` → `GET /api/timetable/requirements` เทียบแผนเดิมแบบไปกลับของ Task 2 · `GET /api/elective-pools` 13 ชุด · หน้าจัดคาบเปิดได้ · แก้แถวแผนผ่าน route เดิมไม่ถูกปฏิเสธเรื่องหลักสูตร · สั่งจัดคาบอัตโนมัติรันได้
  2. ส่งรอบเดิมซ้ำ → 409 · สองคำขอพร้อมกัน (สอง curl) → หนึ่ง 200 หนึ่ง 409 · ครูไม่ซ้ำ
  3. ฆ่าเซิร์ฟเวอร์ทันทีหลัง COMMIT (ตัวแปรสภาพแวดล้อมสำหรับทดสอบที่ทำให้ `_save_state` หลังสร้างไม่ทำงาน — ปิดไว้ตามปกติ) → เริ่มใหม่ → แผน/ครู/เทอมตรงกับฐาน
  4. ฉีดล้มที่การเขียนกลับ (ตัวแปรสภาพแวดล้อมเดียวกัน) → 500 · ฐานไม่มีเทอมใหม่ · `sched_id` ไม่เปลี่ยน · รอบไม่ถูกทำเครื่องหมาย · ตัวแปรเท่าเดิม
  5. สองเซสชัน: ปุ่มดึงครูจากโปรแกรมระหว่างสร้าง → รอ แล้วไม่มีแถวชี้ครูที่ไม่มี (ทั้งกรณีสำเร็จและกรณีฉีดล้ม)
  6. revision ขยับหนึ่งครั้ง · server.log ไม่มี traceback ที่ไม่ได้ตั้งใจ
- [ ] **Step 6: Commit** — `"ขั้นที่ 3: สร้างเทอมใหม่จากรอบอัตรากำลังในธุรกรรมเดียว — ทะเบียน แผน คาบเสรี หลักสูตร และทำเครื่องหมายรอบ"`

---

## Task 5: ปลดล็อกเทอมย้อนการส่ง และรอบที่ส่งแล้วอ่านอย่างเดียวถาวร

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlexportunlock.py`

**Interfaces:**
- Consumes: `export_report` (Task 4) · `unlock_term` `_term_swap_active` (ของเดิม)
- Produces:
  - `unlock_term`: ถ้าเทอมที่กำลังจะถูกปิดโดยการปลดล็อกมีรอบที่ `exported_term_id` = รหัสเทอมนั้น → ในธุรกรรมเดียวกับการสลับเทอม (`_term_swap_active(..., cur=None)` รับ cursor แบบเดียวกับ `_term_rotate`)
    คืน `sched_id` ของครู/วิชาตาม `export_report` · `sched_id` ของ `created_wl_subjects` เป็น NULL · บรรทัด/ตัวเลือกที่ผูกโดยการส่งกลับเป็น `subject_id` NULL · ลบเครื่องหมายส่งแล้ว + คืน `prior_status`
    (ฟังก์ชันล้วน `wl_export_undo_sql(report: dict, round_id: int) -> list[tuple[str, tuple]]`) · ไม่มีรอบแบบนั้น → โค้ดเดิมทุกบรรทัด
  - รอบที่ `exported_at` ไม่ว่าง: `POST …/open` `…/close` `DELETE /rounds/{id}` · approve/return/submit · การเขียนแถว/ตัวเลือก · การแก้หลักสูตรของภาคเรียนนั้น → 409 ไทย "รอบนี้ส่งเข้าโปรแกรมแล้ว (เทอม …) แก้ไม่ได้"
    (เพิ่มในตัวตรวจที่ทุก route ใช้อยู่แล้ว เช่น `_wl_refuse_locked` / `wl_can_edit` — grep หาจุดเดียวที่ครอบได้มากที่สุด)

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง**: `test_undo_sql_restores_every_recorded_value` · `test_unlock_without_export_is_unchanged` · `test_unlock_after_export_reverts_in_same_transaction` ·
  `test_exported_round_refuses_every_write_route` (ไล่ route จริงทุกตัวที่เขียนรอบ/หลักสูตรของภาคเรียนนั้น)
- [ ] **Step 2: รันให้เห็นว่าแดง** · **Step 3: เขียน** · **Step 4: รัน** → `— ผ่าน 32 · ไม่ผ่าน 0 —`
- [ ] **Step 5: ลองกับของจริง** — ต่อจาก Task 4: ปลดล็อกเทอมเก่า → psql: `sched_id` และสถานะรอบกลับเป็นค่าก่อนส่ง · ปุ่มดึงครูจากโปรแกรมไม่สร้างแถวซ้ำ · ทุก route เขียนของรอบที่ส่งแล้ว → 409
- [ ] **Step 6: Commit** — `"ขั้นที่ 3: ปลดล็อกเทอมย้อนการส่งของรอบ และรอบที่ส่งแล้วแก้ไม่ได้"`

---

## Task 6: หน้าต่างสร้างเทอมใหม่ หน้ารอบของเว็บ และคู่มือ

**Files:**
- Modify: `frontend/src/components/terms/NewTermModal.tsx` · `frontend/src/utils/terms.ts` · `frontend/src/api/client.ts` · `frontend/src/store/timetableStore.ts` (`makeNewTerm`)
- Modify: `workload/src/round.ts` · `workload/src/roundApi.ts` · `workload/src/pages/RoundsPage.tsx` / `RoundOverview.tsx`
- Modify: `docs/workload-setup.md`
- Test: `tests/ts/terms.ts` (ต่อ) · `tests/ts/wlround.ts` (ต่อ)

**Interfaces:**
- Consumes: route ของ Task 3–4
- Produces (`utils/terms.ts` ล้วน):
  - `TermRound` · `RoundPreview` (ชนิดตามคำตอบ Task 3) · `roundOptionLabel(r: TermRound) -> string` ("ภาคเรียน 2/2569 · ใช้ได้" / "… · ยังใช้ไม่ได้" / "… · ส่งแล้ว (เทอม …)")
  - `roundPreviewRows(p: RoundPreview) -> {label: string, value: string, tone: "plain"|"warn"|"info"}[]` — บรรทัดตามแบบข้อ 4.5 (ค่า 0 ไม่แสดง ยกเว้นแถวแผน)
  - `newTermFromRoundError(round: TermRound|null, code: string) -> string|null` — ไม่ได้เลือกรอบ · รอบใช้ไม่ได้ · ไม่ได้กรอกรหัส
  - `client.ts`: `fetchTermRounds()` · `fetchTermPreview(roundId?: number)` · `createTerm(year, semester, opts?: {roundId: number, adminCode: string})`
- หน้าต่าง (แบบข้อ 4.5 ตามภาพร่าง): ไม่มีรอบเลย → **เหมือนเดิมทุกอย่าง** (ตัวทดสอบหน้าตาเดิมไม่เปลี่ยน) · มีรอบ → ทางเลือกสองแบบ (ค่าเริ่มต้น = แผนเดิม) ·
  เลือกรอบ → ปี/ภาคตามรอบ แก้ไม่ได้ · สรุป + เหตุ + ช่องรหัส (type password) · ผลหลังสร้างแสดงรายการชุดกิจกรรมที่ต้องลงคาบเอง · ใช้กลไกกันกดซ้ำและข้อความผลแบบเดิม
- เว็บลงอัตรากำลัง: ชิป "ส่งเข้าโปรแกรมแล้ว — เทอม …" บนหน้ารอบ/ภาพรวม · รายการ "ชุดกิจกรรมที่ต้องลงคาบเอง" จาก `export_report` · ซ่อนปุ่มแก้ทุกปุ่มของรอบนั้น
- คู่มือ: หัวข้อใหม่ "ขึ้นภาคเรียนใหม่ด้วยรอบอัตรากำลัง" (ก่อนกด · ดูสรุป · เหตุที่ใช้ไม่ได้และวิธีแก้ · รหัส · หลังสร้าง: ลงคาบกิจกรรม · กดผิด → ปลดล็อกเทอม) +
  ข้อทดสอบด้วยมือในข้อ 14: **ลองกับสำเนาฐานข้อมูลจริงก่อนกดบนเว็บจริงครั้งแรก** · ไล่เลขหัวข้อและลิงก์ข้ามหัวข้อให้ถูก

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง** — `tests/ts/terms.ts`: `roundOptionLabel` สามสถานะ · `roundPreviewRows` (ค่า 0 ไม่ขึ้น · ชุดกิจกรรมเป็น warn) · `newTermFromRoundError` ทุกกรณี · `tests/ts/wlround.ts`: ป้ายรอบที่ส่งแล้ว
- [ ] **Step 2: รันให้เห็นว่าแดง** · **Step 3: เขียน** · **Step 4: ตรวจ** — `bash tests/run.sh` → `— ผ่าน 32 · ไม่ผ่าน 0 —` (ไฟล์เดิม) · `cd frontend && npm run lint && npm run build` · `cd workload && npm run lint && npm run build` สะอาด
- [ ] **Step 5: Playwright กับของจริง** — เว็บตาราง (`frontend` build ชี้เซิร์ฟเวอร์ทดลอง): เปิดหน้าต่าง → ไม่มีรอบ = เหมือนเดิม · มีรอบที่ใช้ไม่ได้ = เหตุ + ปุ่มปิด · รอบใช้ได้ + รหัสผิด = ข้อความ 403 ไทย · รหัสถูก = เทอมใหม่ แผนตามรอบ ·
  เว็บลงอัตรากำลัง: รอบขึ้น "ส่งเข้าโปรแกรมแล้ว" ไม่มีปุ่มแก้ · ภาพที่ 1280 และ 390 · ส่งภาพหลักไว้ที่ `$WS/task-6-*.png`
- [ ] **Step 6: Commit** — `"ขั้นที่ 3: หน้าต่างสร้างเทอมใหม่เลือกรอบอัตรากำลังได้ หน้ารอบบอกว่าส่งแล้ว และคู่มือ"`

---

## หลังจบทั้ง 6 task

1. รีวิวทั้งสาขาบนโมเดลที่เก่งที่สุด · แก้รอบเดียว · ตรวจซ้ำหนึ่งรอบ
2. ลองอัปเกรด: เซิร์ฟเวอร์รุ่นบน `main` (ข้อมูลขั้นที่ 1–2 + รอบที่ตรวจผ่าน) → รุ่นใหม่บนฐานเดียวกัน → คอลัมน์ใหม่ถูกเพิ่ม ของเดิมครบ · สร้างเทอมจากรอบได้
3. merge ผ่าน PR นอกเวลาเรียน · `docs/HANDOFF.md` ฉบับที่ 5 · สมุดการตัดสินใจไป `docs/decisions/`
