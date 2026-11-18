# เว็บลงอัตรากำลัง ทาง ข. — อัปเดตแผนกลางเทอมจากรอบอัตรากำลัง (แผนลงมือ)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปุ่ม "อัปเดตแผนจากรอบอัตรากำลัง" ในโปรแกรมจัดตาราง เทียบรอบของภาคที่เปิดอยู่กับแผนสดเป็นกอง ให้ติ๊กยอมรับทีละข้อ เขียนเฉพาะที่ติ๊กในธุรกรรมเดียว ไม่แตะคาบ และสร้างรายการงานที่ต้องไปแก้เอง

**Architecture:** ตรรกะเทียบ/ใส่เป็นฟังก์ชันล้วนในโมดูลใหม่ `plan_diff.py` (ไม่ import `mock_api` · ใช้ `term_from_round.py` ของทาง ก.) · `mock_api.py` อ่านรอบ ตรวจเกณฑ์ ล็อก ใส่ COMMIT ครั้งเดียว ·
รายการงานเก็บใน snapshot สถานะคิดสดจากแผนเทียบคาบ · หน้าต่างใหม่ใน `frontend/src/components/terms/` · ปุ่มเปิดรอบให้แก้กลางเทอมใน `workload/`

**Tech Stack:** Python 3 · FastAPI (ไม่มี Pydantic) · psycopg 3 · PostgreSQL · React + TS · ตัวทดสอบ `bash tests/run.sh`

**Spec:** `docs/superpowers/specs/2026-11-18-workload-midterm-update-design.md` (ผู้ใช้อนุมัติ 18 พ.ย.) · สเปกหลัก `docs/superpowers/specs/2026-11-06-workload-entry-site-design.md` ส่วนที่ 7 · ทาง ก. `docs/superpowers/specs/2026-11-17-workload-stage3-new-term-design.md`

## Global Constraints

- **ห้ามโค้ดใหม่เขียน `SLOTS` หรือ `PARKED`** — ไม่ว่าติ๊กข้อใด สองตัวนี้ต้องเท่าเดิมทุกไบต์ · ห้ามเรียก `_sync_pool_slots` `/api/timetable/coteach` `_purge_*` repair
- เขียน **เฉพาะข้อที่ติ๊ก** · ไม่ติ๊กเลย = ไม่เขียนอะไรเลย · ทั้งหมดหรือไม่มีเลย (COMMIT ครั้งเดียว ล้ม → ย้อนทุกตัวแปรที่แตะ)
- แถวแผนที่รอบไม่รู้จัก (ไม่แปลงได้ใน `wl_round_proposal` ของของสดตอนนี้ หรือห้องไม่อยู่ในหลักสูตรของภาค) **ห้ามถูกเสนอให้ลบ**
- หน้าเทียบที่ admin เห็นต้องเท่ากับสิ่งที่ถูกเขียน — `preview_token` ไม่ตรงกับที่คำนวณใหม่ในธุรกรรม → 409
- การเขียนของโปรแกรมอยู่ใน route ใต้ `/api/terms/` เท่านั้น และ route ต้องปฏิเสธเองเมื่อเทอมที่เปิดอยู่เป็น `closed` (สถานะ `active` หรือว่าง = ใช้ได้)
- ทะเบียน: เพิ่มใหม่และแก้ช่องตัวตนเท่านั้น (กฎทาง ก.) · ไม่ลบ · ไม่แก้ช่องของโปรแกรม
- ทางเดิมทั้งหมด (สร้างเทอมสองทาง · ปลดล็อก) ไม่เปลี่ยนพฤติกรรมเมื่อไม่เคยมีการอัปเดตกลางเทอม · `tests/py/terms.py` `termguard.py` ไม่แก้
- ข้อความไทยทั้งหมด · ไม่เพิ่ม dependency · อ้างด้วยรหัส · ไม่มี unique index ใหม่บนตารางที่มีข้อมูล (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`)
- `frontend/` แก้ได้เฉพาะ `components/terms/` (เพิ่มไฟล์ได้) `utils/terms.ts` `api/client.ts` `store/timetableStore.ts` · ห้ามแตะ `.github/`
- ทดสอบกับ Postgres ทดลองในเครื่องเท่านั้น

## Review Focus

1. รอบที่เพิ่งเปิดจากแผนปัจจุบัน (ยังไม่แก้อะไร) → หน้าเทียบต้อง **ว่างทุกกอง** บนข้อมูลแบบจริง (คาบเสรีรายห้อง · กิจกรรมทั้งระดับ · คู่สอนร่วม) — ข้อเท็จจะทำให้ admin ไม่เชื่อหน้าเทียบ (Task 1)
2. ติ๊กทุกข้อทุกกองแล้ว `SLOTS`/`PARKED` เท่าเดิมทุกไบต์ (Task 1 ฟังก์ชันล้วน + Task 4 ของจริง)
3. หน้าเทียบค้างไว้นาน แล้วมีคนแก้รอบหรือแผนก่อนกด → 409 ให้ดูใหม่ ไม่เขียนของเก่า (Task 4)
4. เว็บจริงยังไม่เคยสร้างเทอม (สถานะว่าง) → ใช้ทาง ข. กับรอบภาคปัจจุบันได้ (Task 3–4)
5. อัปเดตกลางเทอมสร้างครูใหม่ แล้วปลดล็อกเทอมไปมา → ปุ่มดึงครูไม่สร้างแถวซ้ำ (Task 4)

## สัญญาที่ทุก task ใช้ร่วมกัน

- **ข้อ (item)** ของหน้าเทียบ: `{"key": str, "pile": "registry"|"new"|"weekly"|"teacher"|"removed"|"sets", "group_id"?, "subject_id"? (sched id), "label": str (ไทย), "before"?, "after"?,
  "placed": int (คาบที่ลงไว้ของ (ห้อง, วิชา)), "effect": str|None (ไทย ผลต่อคาบ), "requires": [key] (ข้อทะเบียนที่ต้องติ๊กด้วย), "auto": bool (ระบบใส่ให้ได้ · False = เข้ารายการงานเท่านั้น)}`
  · `key` คงที่ระหว่างดูกับกด (ประกอบจากกอง + ห้อง + วิชา + ช่อง หรือรหัสของเว็บ) · `preview_token` = sha256 ของรายการข้อแบบเรียงคีย์
- **ข้องานที่ต้องแก้เอง (todo)**: `{"id": int, "update_id": int, "kind": "missing"|"teacher"|"over"|"set", "group_id", "subject_id", "teacher_id"?, "text": str, "done": bool}` ·
  สถานะสด: `{"state": "open"|"resolved", "detail": str}` คิดจากแผน + คาบตอนอ่าน (kind `set` ไม่มีเงื่อนไขอัตโนมัติ — เปิดจนกด "ทำแล้ว")
- ของเดิมที่ใช้ (signature จริงอยู่ในรายงานของทาง ก.): `registry_plan` `plan_from_round` (term_from_round.py) · `wl_round_proposal(src)` · `_fold_coteaching` · `_wl_export_source(cur, round_id)` ·
  `_term_outgoing()` · `_term_admin_check(raw)` · `_term_refuse_program_edited(rev)` · `_wl_registry_lock(cur)` · `_DB_UPSERT` · `wl_registry_reconcile` · `running_term_identity`

---

## Task 1: เครื่องเทียบและเครื่องใส่ (ฟังก์ชันล้วน)

**Files:** Create `plan_diff.py` · Test `tests/py/wlmidtermdiff.py`

**Interfaces:**
- Produces:
  - `plan_diff(source: dict, live: dict, live_proposal: dict, counters: dict) -> dict` → `{"items": [item], "unknown": [{group_id, subject_id, label}], "unmatched_sets": [...], "token": str, "registry": <registry_plan ผล>, "desired": <plan_from_round ผล>}`
    — `live` = รูป `outgoing` ของทาง ก. + `"slots"` · `live_proposal` = `wl_round_proposal` ของของสด (ผู้เรียกเตรียม) · ไม่แก้ข้อมูลขาเข้า
  - `plan_apply(diff: dict, live: dict, accepted: set[str], counters: dict) -> dict` → `{"teachers", "subjects", "requirements", "pools", "curricula", "group_curricula", "counters", "writeback", "todos": [todo ไม่มี id], "applied": [key], "skipped": [key]}`
    — ข้อที่ `requires` ไม่ถูกติ๊กครบ → ติ๊กให้อัตโนมัติ (บันทึกใน `applied`) · ข้อ `auto=False` → เข้า `todos` เท่านั้น · **ผลไม่มีคีย์ `slots`/`parked`**
  - `diff_token(items: list) -> str`
- กฎตามแบบข้อ 4.2 ทั้งตาราง: แถว (ห้อง, วิชา) เทียบหลังพับคู่สอนร่วม · ชุดเทียบรูปชุดทั้งสองฝั่ง (จับด้วยชนิด + ห้อง แล้วชื่อ) · pool ยังไม่ลงคาบ → `auto` · ลงแล้ว/ชุดจากช่องรายห้อง/กิจกรรม → `auto=False` ·
  ชุดใหม่ (คาบเสรี) → pool ยังไม่ลงคาบ + todo "ลงคาบ" · แถวที่รอบไม่รู้จัก → `unknown` · แถวใหม่ที่วิชาไม่อยู่ในหลักสูตรของห้อง → เพิ่มเข้าหลักสูตรตามกฎทาง ก.
  · todo ต่อข้อที่ติ๊กและมีคาบลงแล้ว: `weekly` → missing/over · `teacher` → teacher · `removed` → over · `sets` auto=False → set

- [ ] **Step 1: ตัวทดสอบที่ต้องแดง**: `test_fresh_round_diff_is_empty_seed` · `test_fresh_round_diff_is_empty_live_shape` (ชุด ข ของ `tests/py/wlexportplan.py` — คาบเสรีรายห้อง กิจกรรมทั้งระดับ คู่สอนร่วมคาบไม่เท่า · ใช้ตัวช่วยเดิมของไฟล์นั้น) ·
  `test_each_pile_detected` (แก้รอบให้มีครบ 6 กอง) · `test_unknown_rows_never_removed` · `test_apply_only_accepted` · `test_apply_none_changes_nothing` · `test_apply_never_returns_slots` ·
  `test_requires_registry_auto_ticked` · `test_placed_pool_is_todo_only` · `test_unplaced_pool_options_updated` · `test_cell_set_is_todo_only` · `test_new_set_becomes_unplaced_pool_and_todo` ·
  `test_todos_for_placed_rows` (คาบ 3→4 ลงแล้ว 3 → missing · เปลี่ยนครูที่ลงแล้ว → teacher · ลบแถวที่ลงแล้ว → over) · `test_token_stable_and_changes_with_items` · `test_inputs_not_mutated`
- [ ] **Step 2: แดง** · **Step 3: เขียน `plan_diff.py`** · **Step 4: รัน** → `— ผ่าน 33 · ไม่ผ่าน 0 —`
- [ ] **Step 5: Commit** — `"ทาง ข.: เครื่องเทียบรอบกับแผนสดเป็นกอง และเครื่องใส่เฉพาะข้อที่ติ๊ก (ฟังก์ชันล้วน)"`

---

## Task 2: รายการงานที่ต้องไปแก้เอง

**Files:** Modify `plan_diff.py` · `mock_api.py` · Test `tests/py/wlmidtermtodo.py`

**Interfaces:**
- Consumes: รูป todo (สัญญาร่วม)
- Produces:
  - `todo_status(todos: list, requirements: list, slots: list) -> list[dict]` (ล้วน ใน `plan_diff.py`) — เพิ่ม `state`/`detail` ต่อข้อ: missing = (คาบในแผน − คาบที่ลงของ (ห้อง, วิชา)) > 0 ·
    teacher = มีคาบของ (ห้อง, วิชา) ที่ครู ≠ ครูในแผน · over = คาบที่ลง > คาบในแผน (หรือไม่มีแถวแผนแล้ว) · set = เปิดจน `done`
  - `mock_api.py`: ตัวแปร `PLAN_TODOS: list` ใน `_snapshot()` (คีย์ `plan_todos`) · `_apply_snapshot` ตั้งจากข้อมูล **ไม่มีคีย์ → ว่าง** · ตัวนับ `todo` ·
    `create_term` ทั้งสองทาง: เทอมใหม่เริ่ม `PLAN_TODOS` ว่าง (ไฟล์เทอมเก่าเก็บของเดิมไว้) ·
    `GET /api/terms/todos` → `[todo + state + detail]` · `POST /api/terms/todos/{id}/done` (ไม่มีรหัส · บันทึกผ่านตัวนับรุ่น) · ทั้งสองปฏิเสธเมื่อเทอมที่เปิดเป็น `closed` (GET อ่านได้)
- [ ] **Step 1: แดง**: สถานะทั้ง 4 ชนิด · resolved เมื่อลงคาบครบ/เปลี่ยนครูในคาบแล้ว · snapshot ไปกลับ · คีย์หายแล้วว่าง · สร้างเทอมใหม่แล้วว่าง (ทั้งสองทาง) · route · `terms.py` `termguard.py` ไม่แก้
- [ ] **Step 2–4** → `— ผ่าน 34 · ไม่ผ่าน 0 —` · **Step 5: ลองของจริง** (ใส่ todo ด้วยมือในฐานทดลอง → GET → ลงคาบด้วย route เดิม → resolved → เริ่มเซิร์ฟเวอร์ใหม่ยังอยู่)
- [ ] **Step 6: Commit** — `"ทาง ข.: รายการงานที่ต้องไปแก้เอง สถานะคิดสดจากแผนเทียบคาบ"`

---

## Task 3: เปิดรอบให้แก้กลางเทอม · เกณฑ์ · หน้าเทียบ (ไม่เขียนข้อมูลของโปรแกรม)

**Files:** Modify `mock_api.py` · Test `tests/py/wlmidtermpreview.py`

**Interfaces:**
- Consumes: `plan_diff` (Task 1) · `_wl_export_source` `_term_outgoing` `wl_round_proposal` `running_term_identity` (ของเดิม)
- Produces:
  - `_WL_SCHEMA`: `ALTER TABLE wl_rounds ADD COLUMN IF NOT EXISTS amending_since timestamptz` · `CREATE TABLE IF NOT EXISTS wl_plan_updates (id bigserial PRIMARY KEY, round_id bigint, term_id bigint, year int, semester int, at timestamptz DEFAULT now(), by text, accepted jsonb, rejected jsonb, report jsonb)`
  - `POST /api/workload/rounds/{round_id}/amend` (admin) — รอบ `closed` ของภาคที่เปิดอยู่ (ส่งแล้วหรือไม่ก็ได้) → `filling` · ทุกกลุ่ม `filling` · `amending_since = now()` · มีรอบอื่นยังไม่ปิด → 409 ไทยบอกชื่อ ·
    ตัวกันรอบที่ส่งแล้ว (`_wl_refuse_exported` และพวก) ยอมรอบที่ `amending_since` ไม่ว่าง · `wl_round_view` เพิ่ม `amending_since` · บันทึกการแก้หลักสูตรตามเดิม
  - `_term_running_identity() -> dict|None` — `{year, semester, term_id|None}` ของภาคที่เปิดอยู่ (เทอม `active` หรือสถานะว่างผ่าน `running_term_identity`) · เทอม `closed` → None
  - `wl_midterm_reasons(source: dict, running: dict|None) -> list[str]` (ล้วน) — เกณฑ์แบบข้อ 4.1 (ไทย)
  - `_midterm_build(cur, round_id) -> dict` — `{"round", "reasons", "diff"}` ใช้ `plan_diff` กับของสด
  - `GET /api/terms/plan-update/rounds` → รอบของภาคที่เปิดอยู่ `[{id, label, status, amending_since, exported_label, usable, reasons}]` · `GET /api/terms/plan-update/preview?round_id=` → `{round, usable, reasons, items, unknown, unmatched_sets, token}` · ไม่เขียนอะไร
- [ ] **Step 1: แดง**: เปิดให้แก้ (ส่งแล้ว/ไม่เคยส่ง/รอบอื่นเปิดอยู่ 409/เทอมไม่ใช่ภาคที่เปิด 409) · หลังเปิด หัวหน้าเขียนได้ หลักสูตรแก้ได้ · ทาง ก. ยังส่งรอบที่ส่งแล้วซ้ำไม่ได้ · เกณฑ์ทุกข้อ ·
  preview ไม่เขียน (ตัวแปร + ฐาน) · สถานะเทอมว่าง = ใช้ได้ · เทอมปิด = ใช้ไม่ได้
- [ ] **Step 2–4** → `— ผ่าน 35 · ไม่ผ่าน 0 —` · **Step 5: ลองของจริง**: ตั้งต้นหลักสูตรภาค 2/2569 → เปิดรอบ → ยืนยัน/ปิด → preview **ว่างทุกกอง** · แก้แถวในรอบ (เปิดให้แก้ → หัวหน้าเปลี่ยนครู/คาบผ่านหลักสูตร) → preview เห็นข้อ · revision ไม่ขยับ
- [ ] **Step 6: Commit** — `"ทาง ข.: เปิดรอบให้แก้กลางเทอม เกณฑ์ และหน้าเทียบก่อนอัปเดต"`

---

## Task 4: อัปเดตแผนกลางเทอม — ธุรกรรมเดียว

**Files:** Modify `mock_api.py` · Test `tests/py/wlmidtermapply.py`

**Interfaces:**
- Consumes: Task 1–3 · `_term_admin_check` `_term_refuse_program_edited` `_wl_registry_lock` `_DB_UPSERT` `wl_registry_reconcile` (ของเดิม)
- Produces:
  - `POST /api/terms/plan-update {round_id, admin_code, accept: [key], token}` → ตรวจรหัส → เทอมปิด → 409 → การเชื่อมต่อเดียว: ล็อกทะเบียน → แถวรอบ `FOR UPDATE` → `_midterm_build` ใหม่ → เหตุไม่ว่าง → 409 ·
    `token` ไม่ตรง → 409 "ข้อมูลเปลี่ยนตั้งแต่เปิดหน้าเทียบ — ดูใหม่อีกครั้ง" · จด `REVISION` → เก็บสำเนาเพื่อย้อน (`TEACHERS` `SUBJECTS` `REQUIREMENTS` `ELECTIVE_POOLS` `CURRICULA` `curriculum_id` `_counters` `PLAN_TODOS` — **ไม่รวม SLOTS/PARKED**) →
    เทียบ REVISION → `plan_apply` → ใส่แทนในที่ (+ `_mark_elective` ของวิชาในชุดใหม่) → todos ใส่รหัสแล้วต่อท้าย `PLAN_TODOS` → `_DB_UPSERT` ในธุรกรรม → เขียน `sched_id` กลับ →
    INSERT `wl_plan_updates` (report มี `writeback` แบบเดียวกับ `export_report`) → รอบที่ `amending_since` ไม่ว่าง → ปิดกลับ (`closed`, `amending_since` NULL) → เทียบ REVISION → COMMIT ·
    ล้ม → คืนก่อน ROLLBACK → 500/409 ไทย · หลัง COMMIT: `_term_log` · ล้างแคช · `_save_state()` · คำตอบ `{applied, skipped, todos: n, update_id}`
  - ไม่ติ๊กเลย → 400 ไทย "ยังไม่ได้เลือกข้อใด" (ไม่เปิดธุรกรรม)
  - **ปลดล็อกเทอม**: `wl_registry_reconcile` อ่าน writeback ของ `wl_plan_updates` ด้วย เรียงตามเวลารวมกับ `export_report` · ไม่มีแถวใน `wl_plan_updates` → ผลเท่าเดิม · ข้ามทั้งหมดเฉพาะเมื่อไม่เคยส่งรอบและไม่เคยอัปเดตกลางเทอม
  - ตัวฉีดล้ม `SCHED_TEST_FAIL_AT` (ของเดิม) เพิ่มจุดของ route นี้
- [ ] **Step 1: แดง**: SLOTS/PARKED เท่าเดิมทุกไบต์เมื่อติ๊กทุกข้อ · เขียนเฉพาะข้อที่ติ๊ก · token เก่า 409 · ฉีดล้มทุกจุด → ทุกตัวแปรเท่าก่อนกด · app_state ในธุรกรรม · กดพร้อมกัน 1 สำเร็จ ·
  แก้โปรแกรมระหว่างกด 409 · รอบที่แก้กลางเทอมปิดกลับ · ประวัติถูกบันทึก · ปลดล็อกหลังอัปเดตที่สร้างครู → ทะเบียนชี้ตามเทอมที่เปิด · ไม่เคยอัปเดต → ปลดล็อกเท่าเดิม
- [ ] **Step 2–4** → `— ผ่าน 36 · ไม่ผ่าน 0 —` · **Step 5: ลองของจริง**: ลงคาบส่วนหนึ่งด้วย route เดิม → แก้รอบครบทุกกอง → อัปเดตติ๊กทุกข้อ → md5 ของ SLOTS เท่าเดิม · รายการงานถูกต้อง ·
  ฆ่าเซิร์ฟเวอร์หลัง COMMIT → ตรงกับฐาน · สองคำขอพร้อมกัน · token เก่า · ปลดล็อกไปมา → ดึงครู 0 แถว · สถานะเทอมว่าง (ไม่เคยสร้างเทอม) ใช้ได้
- [ ] **Step 6: Commit** — `"ทาง ข.: อัปเดตแผนกลางเทอมเฉพาะข้อที่ติ๊กในธุรกรรมเดียว ไม่แตะคาบ"`

---

## Task 5: หน้าต่างอัปเดตแผน · รายการงาน · ปุ่มเปิดให้แก้ · คู่มือ

**Files:** Create `frontend/src/components/terms/PlanUpdateModal.tsx` `PlanTodoPanel.tsx` · Modify `frontend/src/components/terms/TermsPanel.tsx` `utils/terms.ts` `api/client.ts` ·
`workload/src/round.ts` `roundApi.ts` `pages/RoundsPage.tsx`/`RoundOverview.tsx` · `docs/workload-setup.md` · Test `tests/ts/terms.ts` `tests/ts/wlround.ts` (ต่อ)

**Interfaces:**
- Produces (`utils/terms.ts` ล้วน): `PILE_TEXT` (ไทยตามแบบข้อ 4.2) · `groupItems(items) -> {pile, label, items}[]` · `toggleWithRequires(selected: Set<string>, items, key) -> Set<string>` (ติ๊กข้อที่ `requires` ให้ · เอาข้อทะเบียนออกเอาข้อที่พึ่งออกด้วย) ·
  `planUpdateError(round, selected, code) -> string|null` · `todoSummary(todos) -> {open, resolved}`
- หน้าต่าง (เปิดจากปุ่มในแผงเทอม เห็นเมื่อมีรอบของภาคที่เปิดอยู่): เลือกรอบ → เหตุ (ถ้ามี) → กองต่าง ๆ พร้อมช่องติ๊ก **ค่าเริ่มต้นไม่ติ๊ก** · "เลือกทั้งกอง" · จำนวน · `effect` ต่อข้อ ·
  รายการ "ไม่อยู่ในรอบ — ไม่ทำอะไร" และ "จับคู่ไม่ได้" แบบเปิดดูได้ · ช่องรหัส (`new-password`) · "ยืนยัน N ข้อ" · 409 token → ปุ่ม "ดูใหม่" · ผล + ลิงก์ไปรายการงาน
- แผงรายการงาน: ค้าง/เรียบร้อย · ข้อความ · "ทำแล้ว" · ตัวเลขค้างบนแผงเทอม · ไม่แตะหน้าจัดคาบ
- เว็บลงอัตรากำลัง: ปุ่ม "เปิดให้แก้กลางเทอม" (ยืนยันก่อน · ข้อความ 409 ไทย) · ชิป "แก้กลางเทอม" · ประวัติการอัปเดตกลางเทอมจาก `wl_plan_updates` (ต้องมี route อ่าน — เพิ่ม `GET /api/workload/rounds/{id}/plan-updates` admin)
- คู่มือ: หัวข้อ "แก้อัตรากำลังกลางเทอม" (เปิดให้แก้ → หัวหน้าแก้ → ตรวจผ่าน → อัปเดตในโปรแกรม → ติ๊กทีละข้อ → รายการงาน · คาบเสรีที่ลงแล้วต้องแก้เอง · ห้ามแก้โปรแกรมระหว่างกด) + ข้อทดสอบด้วยมือ
- [ ] **Step 1: แดง** (ts) · **Step 2–4** → `— ผ่าน 36 · ไม่ผ่าน 0 —` · lint/build ทั้งสองเว็บสะอาด
- [ ] **Step 5: Playwright กับของจริง** 1280/390 (+1024 หน้าต่าง): หน้าเทียบว่าง · มีข้อ · ติ๊ก/ทั้งกอง/requires · รหัสผิด · token เก่า · ผลและรายการงาน · ปุ่มเปิดให้แก้ในเว็บ · ภาพไว้ `$WS/task-5-*.png`
- [ ] **Step 6: Commit** — `"ทาง ข.: หน้าต่างอัปเดตแผนกลางเทอม รายการงาน ปุ่มเปิดรอบให้แก้ และคู่มือ"`

---

## หลังจบทั้ง 5 task

1. รีวิวทั้งสาขาบนโมเดลที่เก่งที่สุด · แก้รอบเดียว · ตรวจซ้ำ
2. ลองอัปเกรดจากรุ่นบน `main` (สภาพเว็บจริง: ยังไม่มีเทอม · มีรอบภาคปัจจุบัน) → ทาง ข. ใช้ได้ · ข้อมูลเดิมครบ
3. merge ผ่าน PR นอกเวลาเรียน · `docs/HANDOFF.md` ฉบับที่ 6 · สมุดการตัดสินใจไป `docs/decisions/`
