# เว็บลงอัตรากำลัง ขั้นที่ 1 — ล็อกอิน + ทะเบียนครูและวิชา

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เว็บลงอัตรากำลังมีลิงก์ของตัวเอง ล็อกอินด้วยรหัสช่องเดียว และ admin จัดการทะเบียนครูกับทะเบียนวิชาของเว็บใหม่ได้ครบ โดยไม่กระทบตารางสอนที่ใช้งานอยู่แม้แต่คาบเดียว

**Architecture:** หน้าเว็บใหม่อยู่ที่โฟลเดอร์ `workload/` ของ repo เดิม ขึ้น GitHub Pages ที่ path `/workload/` จึงได้ลิงก์คนละชุดจากเว็บตาราง · ฝั่งเซิร์ฟเวอร์เพิ่ม route ใต้ `/api/workload/` และตาราง SQL ของตัวเอง 4 ตาราง ไม่แตะ `TEACHERS`/`SUBJECTS` ในหน่วยความจำ · ทุกคำขอเขียนใต้ `/api/workload/` ถูกกันออกจากตัวนับรุ่นและการเซฟสแนปช็อตของเว็บตาราง

**Tech Stack:** FastAPI (ไม่มี Pydantic ตามแบบของไฟล์เดิม) · psycopg + PostgreSQL · `hashlib.pbkdf2_hmac` และ `secrets` จาก stdlib ไม่เพิ่ม dependency · React + Vite + TypeScript (คัดลอกค่าตั้งจาก `frontend/`) · ตัวทดสอบของ repo เดิม (`bash tests/run.sh`)

**Spec:** `docs/superpowers/specs/2026-11-06-workload-entry-site-design.md` (รวมส่วนแก้ไข 8 พ.ย.)

**ขั้นนี้ครอบสเปกส่วนไหน:** ส่วนที่ 2 (สถาปัตยกรรม) · 3 (ล็อกอินและบทบาท) · 4 เฉพาะหัวข้อ "ทะเบียนที่เว็บใหม่เป็นเจ้าของ" และ "รหัสเข้า"
**ไม่อยู่ในขั้นนี้ รอแผนถัดไป:** รอบอัตรากำลังและแถววิชา (ส่วนที่ 4 หัวข้ออื่น) · การเสนอแถวจากหลักสูตร (5) · ขั้นงานส่ง-ตรวจ-ตีกลับ (6) · ปุ่มส่งเข้าโปรแกรมและการซิงก์ (7) · ชีตครูผู้สอน (9)
เหตุผลที่แยก: สามก้อนนั้นต่อยอดจากตารางและด่านของขั้นนี้ และขั้นนี้เองก็ใช้งานได้จริงอยู่แล้ว — ตรงกับที่ผู้ใช้ขอมาคำต่อคำ ("มีหน้าต่างล็อคอินก่อน … แอดมินมีหน้าที่เพิ่มรหัสวิชา ชื่อวิชาเข้าระบบ ชื่อครู")

---

## Global Constraints

- **ห้ามแตะ `SLOTS` และ `REQUIREMENTS`** ไม่มี route ใดในขั้นนี้เขียนสองลิสต์นี้ ("ตอนนี้คาบโอเคแล้วห้ามยุ่ง")
- **ห้ามเขียน `TEACHERS` / `SUBJECTS`** ขั้นนี้ไม่มีการซิงก์เข้าเว็บตาราง การอ่านเท่านั้น (การเขียนอยู่ในแผนถัดไป ส่วนที่ 7 ของสเปก)
- **ไม่เพิ่ม dependency ฝั่งเซิร์ฟเวอร์** ใช้ stdlib เท่านั้น เซิร์ฟเวอร์เป็น Render free tier และ `requirements.txt` ที่โตขึ้นคือเวลาตื่นที่นานขึ้น
- **ข้อความที่ผู้ใช้เห็นเป็นภาษาไทยทุกข้อความ** รวมข้อความผิดพลาดจากเซิร์ฟเวอร์ (`detail`)
- **ไม่มี endpoint ลบครูหรือลบวิชาในเว็บใหม่** ใช้ธง `active=false` ("ไม่ปฏิบัติงานแล้ว") เท่านั้น
- **อ้างครูและวิชาด้วยรหัส ไม่ใช่ชื่อ เสมอ** ห้ามมีโค้ดที่จับคู่ด้วยชื่อแม้เป็นทางสำรอง
- **รหัสเข้าเก็บแบบแฮชเท่านั้น** ไม่มี route ใดคืนรหัสจริง ไม่ log รหัสจริง
- ทุก task จบด้วย `bash tests/run.sh` ผ่านครบ และ commit

---

## ของจริงในโค้ดที่แผนนี้อ้าง (อ่านแล้ว ไม่ใช่เดา)

| เรื่อง | ที่ไหน | ข้อเท็จจริง |
|---|---|---|
| ตัวนับรุ่น + เซฟสแนปช็อต | `mock_api.py:118-156` | ทุก POST/PUT/PATCH/DELETE ที่สำเร็จ บวกตัวนับ ล้างแคช แล้วเรียก `_save_state()` ซึ่งสร้างสแนปช็อตทั้งก้อน (~60ms) |
| ด่านกันเขียนเทอมปิด | `mock_api.py:94-114`, `TERM_WRITE_SAFE_PATHS` ที่ `:85` | ปฏิเสธทุกการเขียนเมื่อเทอมปัจจุบันปิด ยกเว้น path ในลิสต์ ตัวที่ลงท้าย `/` ครอบ path ลูก |
| สแนปช็อต | `mock_api.py:13383` | เก็บตัวแปรในหน่วยความจำ **ไม่ได้** เก็บตาราง SQL อื่น |
| แบบแผนตารางของชั้นเทอม | `mock_api.py:13672-13698` | รูปแบบที่ใช้ซ้ำ: `_X_SCHEMA` เป็น `CREATE TABLE IF NOT EXISTS` + `_x_schema(cur)` ที่เรียกซ้ำได้ปลอดภัย |
| ช่องของครู | `frontend/src/types/index.ts:121-150` | `TeacherAdvanced` + `Teacher` — ช่องตัวตนกับช่องเงื่อนไขปนกันอยู่ |
| ช่องของวิชา | `frontend/src/types/index.ts:152-167` | `Subject` |
| ตัวทดสอบ | `tests/run.sh` | วางไฟล์ใน `tests/py/` หรือ `tests/ts/` ให้พิมพ์ `ALL PASS` · ฝั่งไพทอนใช้ของปลอม fastapi ใน `tests/stubs` เรียกฟังก์ชันตรง ไม่ผ่าน HTTP · ไม่ต้องลง dependency |

### สองเรื่องที่สเปกไม่ได้เห็น และแผนนี้ตัดสิน

**1. สเปกส่วนที่ 4 เขียนว่าของใหม่ "อยู่ในฐานข้อมูลเดิม จึงติดไปกับไฟล์สำรองเดิมอัตโนมัติ" — ครึ่งหลังไม่จริง**
`_snapshot()` เก็บตัวแปรในหน่วยความจำ ไม่ได้กวาดตาราง SQL ข้อมูลของเว็บใหม่จึงไม่ติดไปกับไฟล์สำรองของเว็บตาราง และ**ไม่ควรติดไปด้วย** เพราะถ้าติดไป การกู้คืนเว็บตารางหนึ่งครั้งจะย้อนงานอัตรากำลังที่กรอกไปแล้วทิ้ง ข้อมูลเว็บใหม่เป็นแถว SQL ธรรมดา ทนทานด้วยตัวเองและติดไปกับการสำรองฐานข้อมูลของ Render อยู่แล้ว ซึ่งดีกว่า
**ผลต่อแผน:** ไม่ต้องทำอะไรเพิ่ม แต่ต้องไม่มีใครพยายามยัดตารางพวกนี้เข้า `_snapshot()` ภายหลัง — เขียนคอมเมนต์กำกับไว้ที่หัวแบบแผนตาราง

**2. ถ้าไม่กันไว้ การกรอกอัตรากำลังจะทำให้ตารางของทุกคนรีโหลดทั้งวัน**
ตัวนับรุ่นเป็น middleware จับตาม method ไม่ได้จับตาม path คำขอเขียนใหม่ทุกตัวจึงบวกตัวนับและเรียก `_save_state()` อัตโนมัติ แปลว่าหัวหน้ากลุ่มสาระกดบันทึกหนึ่งครั้ง = เบราว์เซอร์ทุกเครื่องที่กำลังจัดตารางดึงข้อมูลใหม่ทั้งก้อน + สแนปช็อต 60ms หนึ่งใบ ตรงกับข้อห้ามของผู้ใช้ว่าอย่ากระทบงานตารางสอน
**ผลต่อแผน:** Task 1 กัน `/api/workload/` ออกจากทั้งตัวนับรุ่นและด่านเทอมปิด

**ทำไมด่านเทอมปิดต้องยกเว้นด้วย:** ขั้นตอนจริงคือเทอมปิด → กรอกอัตรากำลังของเทอมถัดไป ถ้าด่านเทอมปิดบล็อก `/api/workload/` ไว้ งานทั้งกระบวนการจะเดินไม่ได้ในช่วงที่ต้องใช้มันที่สุด

---

## Review Focus

ห้าเรื่องที่สเปกบอกเป็นนัย แต่ไม่มี task ไหนจะทดสอบถ้าไม่เขียนไว้ที่นี่ เรียงจากที่น่าจะกัดคนใช้ก่อน — แต่ละข้อมีตัวทดสอบฝังอยู่ใน task ที่เป็นเจ้าของโค้ดนั้น

1. **ชื่อครูที่ตกตัวการันต์หรือมีสระซ้อน** — "ชนะพันธ" กับ "ชนะพันธ์" คือคนเดียวกันในสายตาคน แต่เป็นสองสายอักขระ การจับคู่ต้องใช้รหัสครูเท่านั้น และต้องไม่มีทางสำรองที่จับด้วยชื่อ (Task 3, Task 6)
2. **รหัสเข้าที่เป็นช่องว่างหรือสตริงว่าง** — `""` หรือ `"   "` ต้องไม่ผ่าน ไม่ว่าจะมีแถวรหัสที่แฮชของค่าว่างอยู่หรือไม่ (Task 2)
3. **ฐานข้อมูลเรียกไม่ได้** — เว็บใหม่ต้องขึ้นข้อความไทยว่าต่อฐานข้อมูลไม่ได้ ไม่ใช่ 500 เปล่า และต้องไม่ทำให้เว็บตารางพลอยพังด้วย (Task 1)
4. **สองคนใช้รหัสกลุ่มสาระเดียวกันพร้อมกัน** — หนึ่งกลุ่มมีรหัสเดียวตามสเปก การใช้งานซ้อนกันจึงเป็นเรื่องปกติ ไม่ใช่กรณีพิเศษ: token สองใบจากรหัสเดียวต้องใช้ได้พร้อมกันทั้งคู่ (Task 2)
5. **ช่องว่างหน้า-หลังรหัสที่ผู้ใช้วางมาจากที่อื่น** — ตัดช่องว่างหัวท้ายก่อนตรวจ แต่**ไม่แปลงตัวพิมพ์** เพราะรหัสอาจมีอักษรไทยและตัวพิมพ์ใหญ่ที่ตั้งใจ (Task 2)

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `mock_api.py` (แก้) | เพิ่มแบบแผนตาราง ตัวช่วยฐานข้อมูล ตัวตรวจรหัส และ route ใต้ `/api/workload/` ทั้งหมด — ไฟล์นี้เป็นไฟล์เดียวตามแบบของ repo เดิม ไม่แยกโมดูลใหม่ |
| `workload/` (ใหม่) | หน้าเว็บใหม่ทั้งแอป โครงเดียวกับ `frontend/` |
| `workload/src/types.ts` | ชนิดข้อมูลของเว็บใหม่ — **นำเข้าชนิด `Teacher`/`Subject` จาก `../../frontend/src/types`** เพื่อให้ตารางแบ่งเจ้าของช่องของสเปกส่วนที่ 4 เพี้ยนไม่ได้เงียบ ๆ |
| `workload/src/api.ts` | ตัวเรียกเซิร์ฟเวอร์ + การแนบ token |
| `workload/src/auth.ts` | ตรรกะบทบาทล้วน ไม่มี axios จึงทดสอบได้ |
| `workload/src/pages/LoginPage.tsx` | หน้าแรก ช่องรหัสช่องเดียว |
| `workload/src/pages/TeachersPage.tsx` · `SubjectsPage.tsx` | ทะเบียนของ admin |
| `.github/workflows/workload.yml` (ใหม่) | ขึ้นเว็บใหม่ที่ `destination_dir: workload` |
| `tests/py/wlguard.py` · `wlcodes.py` · `wlregistry.py` | ตัวทดสอบฝั่งเซิร์ฟเวอร์ |
| `tests/ts/wlauth.ts` | ตัวทดสอบตรรกะบทบาท |

### ทำไมอยู่ repo เดิม ไม่ใช่ repo ใหม่ (ต่างจากสเปกส่วนที่ 2)

สเปกเขียนว่า repo แยก เพราะสิ่งที่ผู้ใช้เลือกคือ **"ลิงก์คนละชุด"** ซึ่ง `destination_dir: workload` ให้ได้เหมือนกัน (พิสูจน์แล้วด้วยลิงก์พรีวิวเมื่อ 7 พ.ย. — เขียนลง `gh-pages` ได้โดยแตะไฟล์นอกโฟลเดอร์เป้าหมาย 0 ไฟล์) และอยู่ repo เดียวกันได้อีกสามอย่างที่ repo แยกให้ไม่ได้

1. **ชนิดข้อมูลร่วมไฟล์เดียว** ตารางแบ่งเจ้าของช่องของครูและวิชาเป็นหัวใจของสเปกส่วนที่ 4 ถ้าอยู่สอง repo มันจะเพี้ยนกันเงียบ ๆ อยู่ repo เดียวกัน การแก้ข้างหนึ่งทำให้อีกข้างคอมไพล์ไม่ผ่านทันที
2. `VITE_API_URL` ที่เดียว ไม่ต้องตั้ง secret ชุดที่สอง
3. ตัวทดสอบชุดเดียว `bash tests/run.sh` ครอบทั้งสองเว็บ

ราคาที่ต้องจ่ายและวิธีจ่าย: push ขึ้น main จะปลุก deploy ของเว็บตารางด้วย แก้ด้วย `paths-ignore` ใน `deploy.yml` (Task 4) ถ้าผู้ใช้ยืนยันว่าอยากได้ repo แยกจริง ๆ ข้อนี้กลับได้ด้วยการย้ายโฟลเดอร์ `workload/` ออกไป ซึ่งเสียแค่ข้อ 1-3 ข้างบน

---

## Task 1: ตาราง ด่าน และการกันออกจากตัวนับรุ่น

**Files:**
- Modify: `mock_api.py` — เพิ่มแบบแผนตารางใกล้ `_TERMS_SCHEMA` (`:13672`) · แก้ `TERM_WRITE_SAFE_PATHS` (`:85`) · แก้เงื่อนไขบวกตัวนับ (`:133`)
- Test: `tests/py/wlguard.py`

**Interfaces:**
- Consumes: `_require_db()` และ `_db_write_blocked()` ที่มีอยู่แล้วจากชั้นเทอม
- Produces:
  - `WORKLOAD_PREFIX: str = "/api/workload/"`
  - `_WL_SCHEMA: str` · `_wl_schema(cur) -> None`
  - `workload_path(path: str) -> bool` — path นี้เป็นของเว็บใหม่หรือไม่
  - `skip_revision_bump(method: str, path: str) -> bool` — จริงเมื่อไม่ต้องบวกตัวนับ
  - `wl_db_error_detail() -> str` — ข้อความไทยเมื่อต่อฐานข้อมูลไม่ได้ ใช้ร่วมกันทุก route ของเว็บใหม่

ตาราง 4 ตาราง ทุกตารางนำหน้าด้วย `wl_`

| ตาราง | ช่อง |
|---|---|
| `wl_codes` | `id bigserial PK` · `role text NOT NULL` ('admin' หรือ 'head') · `department_id integer` (NULL เมื่อ role='admin') · `label text NOT NULL` · `salt bytea NOT NULL` · `hash bytea NOT NULL` · `active boolean NOT NULL DEFAULT true` · `created_at timestamptz NOT NULL DEFAULT now()` |
| `wl_sessions` | `token_hash bytea PRIMARY KEY` · `code_id bigint NOT NULL REFERENCES wl_codes(id)` · `expires_at timestamptz NOT NULL` |
| `wl_teachers` | `id bigserial PK` · `sched_id integer UNIQUE` (รหัสครูฝั่งเว็บตาราง NULL = ยังไม่เคยส่ง) · `name text NOT NULL` · `code text` · `department_id integer` · `dept_order integer` · `active boolean NOT NULL DEFAULT true` |
| `wl_subjects` | `id bigserial PK` · `sched_id integer UNIQUE` · `code text NOT NULL` · `name text NOT NULL` · `type text` · `department_id integer` · `duration integer NOT NULL DEFAULT 1` · `is_activity boolean NOT NULL DEFAULT false` · `is_elective boolean NOT NULL DEFAULT false` · `active boolean NOT NULL DEFAULT true` |

`sched_id` เป็น `UNIQUE` แต่ยอม NULL ได้หลายแถว ซึ่งเป็นพฤติกรรมปกติของ PostgreSQL และเป็นสิ่งที่ต้องการ: ครูที่ยังไม่เคยส่งเข้าโปรแกรมมีได้หลายคน แต่ครูฝั่งเว็บตารางหนึ่งคนผูกกับแถวของเว็บใหม่ได้แถวเดียว

**`sched_id IS NULL` คือธง "ยังไม่ผูก" ของสเปกส่วนที่ 4 โดยตรง** ห้ามเพิ่มช่อง boolean แยกมาเก็บเรื่องเดียวกัน สองที่เก็บความจริงข้อเดียวจะขัดกันเองวันใดวันหนึ่ง และสเปก (ฉบับแก้ 8 พ.ย.) นิยามธงนี้ว่า "ยังไม่ถูกส่งเข้าทะเบียนฝั่งโปรแกรมจัดตารางสอน" ซึ่งคือ "ยังไม่มีรหัสของฝั่งนั้น" พอดี

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/py/wlguard.py`

```python
def test_workload_paths_skip_the_revision_bump():
    assert mock_api.skip_revision_bump("POST", "/api/workload/teachers") is True
    assert mock_api.skip_revision_bump("PUT", "/api/workload/subjects/7") is True
    # การอ่านไม่เคยบวกตัวนับอยู่แล้ว
    assert mock_api.skip_revision_bump("GET", "/api/workload/teachers") is True

def test_scheduler_writes_still_bump():
    assert mock_api.skip_revision_bump("POST", "/api/teachers/") is False
    assert mock_api.skip_revision_bump("DELETE", "/api/slots/9") is False
    # path ที่ขึ้นต้นคล้ายกันแต่ไม่ใช่ของเว็บใหม่ ต้องไม่หลุด
    assert mock_api.skip_revision_bump("POST", "/api/workloadsheet") is False

def test_workload_writes_allowed_while_the_term_is_closed():
    closed = {"status": "closed", "label": "1/2569"}
    assert mock_api.term_blocks_write(closed, "POST", "/api/workload/teachers") is None
    # แต่เว็บตารางยังถูกห้ามเหมือนเดิม
    assert mock_api.term_blocks_write(closed, "POST", "/api/slots/") is not None

def test_db_unreachable_says_so_in_thai():
    # Review Focus ข้อ 3 — ต้องเป็นข้อความไทยที่คนอ่านรู้เรื่อง ไม่ใช่ 500 เปล่า
    msg = mock_api.wl_db_error_detail()
    assert "ฐานข้อมูล" in msg
    assert msg.strip() and not msg.isascii()
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `bash tests/run.sh`
Expected: `FAIL py/wlguard.py` พร้อม `AttributeError: module 'mock_api' has no attribute 'skip_revision_bump'`

- [ ] **Step 3: เพิ่ม `WORKLOAD_PREFIX`, `workload_path()`, `skip_revision_bump()` และใส่ `WORKLOAD_PREFIX` ใน `TERM_WRITE_SAFE_PATHS`**

`skip_revision_bump` คืนจริงเมื่อ method ไม่ใช่การเขียน **หรือ** `workload_path(path)` เป็นจริง — เขียนเป็นฟังก์ชันล้วน ไม่อ่านตัวแปรกลาง เพื่อให้ทดสอบได้ตรง ๆ แบบ `term_blocks_write`

- [ ] **Step 4: แก้เงื่อนไขที่ `mock_api.py:133` ให้เรียก `skip_revision_bump`**

เงื่อนไขเดิมเช็ค method กับ status code กับธง `unchanged` เพิ่มเงื่อนไขใหม่เข้าไปโดยไม่เปลี่ยนสามข้อเดิม พร้อมคอมเมนต์ไทยบอกว่าทำไม (การกรอกอัตรากำลังต้องไม่ทำให้เบราว์เซอร์ที่กำลังจัดตารางรีโหลด)

- [ ] **Step 5: เพิ่ม `_WL_SCHEMA` และ `_wl_schema(cur)` ข้าง `_terms_schema` พร้อมคอมเมนต์หัวตาราง**

คอมเมนต์ต้องเขียนไว้ว่า **ตารางชุดนี้อยู่นอก `_snapshot()` โดยตั้งใจ** ห้ามเพิ่มเข้าไป เพราะการกู้คืนเว็บตารางครั้งเดียวจะย้อนงานอัตรากำลังทิ้ง

- [ ] **Step 6: เพิ่ม `GET /api/workload/health`** คืน `{"db": true}` เมื่อต่อฐานข้อมูลได้ · เมื่อต่อไม่ได้ตอบ 503 พร้อม `detail` เป็นข้อความไทย "ต่อฐานข้อมูลไม่ได้ ..." ไม่ใช่ 500 เปล่า (Review Focus ข้อ 3)

- [ ] **Step 7: รันตัวทดสอบทั้งชุด**

Run: `bash tests/run.sh`
Expected: `ALL PASS` ของ `wlguard.py` และไฟล์เดิมทั้ง 9 ไฟล์ยังผ่าน (`— ผ่าน 10 · ไม่ผ่าน 0 —`)

- [ ] **Step 8: Commit**

```bash
git add mock_api.py tests/py/wlguard.py
git commit -m "เว็บลงอัตรากำลัง: ตาราง 4 ตาราง และกัน /api/workload/ ออกจากตัวนับรุ่นกับด่านเทอมปิด"
```

---

## Task 2: รหัสเข้าและการตรวจรหัส

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlcodes.py`

**Interfaces:**
- Consumes: `_wl_schema`, `_require_db` (Task 1)
- Produces:
  - `wl_hash(code: str, salt: bytes) -> bytes` — `pbkdf2_hmac("sha256", code.encode(), salt, 200_000)`
  - `wl_normalize_code(raw: str) -> str` — ตัดช่องว่างหัวท้าย ไม่แปลงตัวพิมพ์
  - `wl_check_code(raw: str, rows: list[dict]) -> dict | None` — ฟังก์ชันล้วน คืนแถวรหัสที่ตรงหรือ `None`
  - `POST /api/workload/login` รับ `{"code": str}` คืน `{"token": str, "role": str, "department_id": int | None, "label": str}` · ผิดตอบ 401 `detail` ไทย
  - `POST /api/workload/logout` · `GET /api/workload/me`
  - `wl_session_open(code_id: int, rows: list[dict]) -> str` — คืน token ใหม่ และต่อท้าย `rows` ด้วยแถวที่เก็บ **แฮชของ token** ฟังก์ชันล้วน ผู้เรียกส่งลิสต์เข้ามา (route ส่งลิสต์ที่อ่านจากตาราง)
  - `wl_session_find(token: str, rows: list[dict]) -> dict | None` — คืนแถวที่ตรงและยังไม่หมดอายุ
  - `wl_session_role(token: str) -> dict | None` — ตัวที่ route ใช้ อ่านตารางแล้วเรียกสองตัวข้างบน
  - `POST /api/workload/codes` รับ `{"role": str, "department_id": int | None, "label": str, "code": str}` คืน `{"id": int}` **ไม่คืนรหัส** · `PUT /api/workload/codes/{id}` รับช่องใดก็ได้จาก `{"code": str, "label": str, "active": bool}` · `GET /api/workload/codes` คืนรายการที่มี `id` `role` `department_id` `label` `active` และไม่มีช่อง `salt`/`hash`/รหัสจริง · ทั้งสาม route ต้องเป็น admin ไม่ใช่ admin ตอบ 403 `detail` ไทย

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/py/wlcodes.py`

```python
def test_hash_round_trip_and_wrong_code():
    salt = b"0123456789abcdef"
    row = {"id": 1, "role": "admin", "salt": salt,
           "hash": mock_api.wl_hash("ครูใหญ่2569", salt), "active": True}
    assert mock_api.wl_check_code("ครูใหญ่2569", [row]) is row
    assert mock_api.wl_check_code("ครูใหญ่2568", [row]) is None

def test_blank_code_never_matches():
    # แม้มีแถวที่แฮชของค่าว่างอยู่จริง ก็ต้องไม่ผ่าน (Review Focus ข้อ 2)
    salt = b"0123456789abcdef"
    row = {"id": 1, "role": "admin", "salt": salt,
           "hash": mock_api.wl_hash("", salt), "active": True}
    for blank in ("", "   ", "\t", "\n"):
        assert mock_api.wl_check_code(blank, [row]) is None

def test_surrounding_space_trimmed_but_case_kept():
    # Review Focus ข้อ 5
    salt = b"0123456789abcdef"
    row = {"id": 1, "role": "head", "salt": salt,
           "hash": mock_api.wl_hash("Thai01", salt), "active": True}
    assert mock_api.wl_check_code("  Thai01 ", [row]) is row
    assert mock_api.wl_check_code("thai01", [row]) is None

def test_disabled_code_rejected():
    salt = b"0123456789abcdef"
    row = {"id": 1, "role": "head", "salt": salt,
           "hash": mock_api.wl_hash("x", salt), "active": False}
    assert mock_api.wl_check_code("x", [row]) is None

def test_two_tokens_from_one_code_both_valid():
    # Review Focus ข้อ 4 — หนึ่งกลุ่มสาระมีรหัสเดียว ใช้พร้อมกันเป็นเรื่องปกติ
    # ออก token ใบที่สองต้องไม่ลบใบแรก
    rows = []            # แทนตาราง wl_sessions
    a = mock_api.wl_session_open(code_id=5, rows=rows)
    b = mock_api.wl_session_open(code_id=5, rows=rows)
    assert a != b
    assert len(rows) == 2
    assert mock_api.wl_session_find(a, rows) is not None
    assert mock_api.wl_session_find(b, rows) is not None

def test_expired_session_is_not_found():
    rows = [{"token_hash": mock_api.wl_hash("tok", b"s"),
             "code_id": 5, "expires_at": _past()}]
    assert mock_api.wl_session_find("tok", rows) is None

def test_session_rows_hold_no_plaintext_token():
    rows = []
    tok = mock_api.wl_session_open(code_id=5, rows=rows)
    assert tok not in repr(rows)
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `bash tests/run.sh`
Expected: `FAIL py/wlcodes.py`

- [ ] **Step 3: เขียน `wl_hash`, `wl_normalize_code`, `wl_check_code`**

`wl_check_code` ต้อง: ตัดช่องว่างก่อน · ปฏิเสธทันทีถ้าผลเป็นสตริงว่าง · ข้ามแถวที่ `active` เป็นเท็จ · เทียบด้วย `hmac.compare_digest` ไม่ใช่ `==`

- [ ] **Step 4: เขียน route ล็อกอิน/ออกจากระบบ/ฉันเป็นใคร และการเก็บ session**

token มาจาก `secrets.token_urlsafe(32)` · เก็บ **แฮชของ token** ลง `wl_sessions` ไม่เก็บตัว token · อายุ 12 ชั่วโมง · การล็อกอินครั้งใหม่เพิ่มแถวใหม่ ไม่ลบแถวเก่า (Review Focus ข้อ 4) · ลบแถวที่หมดอายุทิ้งตอนล็อกอิน

เก็บลงตารางไม่เก็บในหน่วยความจำ เพราะเซิร์ฟเวอร์ Render หลับเมื่อไม่มีคนใช้ ถ้าเก็บในหน่วยความจำ ทุกคนจะถูกเตะออกกลางการกรอก

- [ ] **Step 5: เพิ่ม `POST /api/workload/codes` และ `PUT /api/workload/codes/{id}` สำหรับ admin ตั้งและปิดรหัสของกลุ่มสาระ**

ไม่มี route ใดคืนรหัสจริง การตั้งรหัสใหม่คือการเขียนแฮชใหม่ทับ · ต้องเป็น admin เท่านั้น

- [ ] **Step 6: รันตัวทดสอบ**

Run: `bash tests/run.sh`
Expected: `ALL PASS` ทุกไฟล์

- [ ] **Step 7: Commit**

```bash
git add mock_api.py tests/py/wlcodes.py
git commit -m "เว็บลงอัตรากำลัง: รหัสเข้าแบบแฮช และ session ที่รอดการหลับของเซิร์ฟเวอร์"
```

---

## Task 3: ทะเบียนครูและทะเบียนวิชาฝั่งเซิร์ฟเวอร์

สองทะเบียนรูปเดียวกัน ทำใน task เดียวและรีวิวเป็นก้อนเดียว

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/wlregistry.py`

**Interfaces:**
- Consumes: Task 1 (ตาราง) · Task 2 (`wl_session_role`)
- Produces:
  - `GET/POST /api/workload/teachers` · `PUT /api/workload/teachers/{id}`
  - `GET/POST /api/workload/subjects` · `PUT /api/workload/subjects/{id}`
  - `POST /api/workload/teachers/import-from-scheduler` — คัดลอกวันแรก คืน `{"created": int, "linked": int, "skipped": int}`
  - `wl_import_plan(sched: list[dict], existing: list[dict]) -> dict` — ฟังก์ชันล้วนที่ตัดสินว่าแถวไหนสร้างใหม่ แถวไหนมีแล้ว

**ช่องที่รับได้ ตามตารางแบ่งเจ้าของของสเปกส่วนที่ 4** ครู: `name` `code` `department_id` `dept_order` `active` · วิชา: `code` `name` `type` `department_id` `duration` `is_activity` `is_elective` `active` — ช่องอื่นที่ส่งมาให้ปฏิเสธด้วย 400 ไม่ใช่เมินเฉย เพราะ `fixed_room_id` ที่หลุดเข้ามาเงียบ ๆ คือจุดเริ่มของการทับเงื่อนไขเครื่องจัดคาบในแผนถัดไป

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/py/wlregistry.py`

```python
def test_import_links_by_sched_id_never_by_name():
    # Review Focus ข้อ 1 — ชื่อสะกดต่างกันแต่รหัสเดียวกัน = คนเดียวกัน
    sched = [{"id": 12, "name": "ชนะพันธ์ ก.", "department_id": 3}]
    existing = [{"id": 1, "sched_id": 12, "name": "ชนะพันธ ก."}]
    plan = mock_api.wl_import_plan(sched, existing)
    assert plan["create"] == []
    assert plan["already"] == [12]

def test_import_creates_only_teachers_not_seen_before():
    sched = [{"id": 12, "name": "ก"}, {"id": 13, "name": "ข"}]
    existing = [{"id": 1, "sched_id": 12, "name": "ก"}]
    plan = mock_api.wl_import_plan(sched, existing)
    assert [t["id"] for t in plan["create"]] == [13]

def test_import_twice_creates_nothing_the_second_time():
    sched = [{"id": 12, "name": "ก"}, {"id": 13, "name": "ข"}]
    first = mock_api.wl_import_plan(sched, [])
    after = [{"id": i + 1, "sched_id": t["id"], "name": t["name"]}
             for i, t in enumerate(first["create"])]
    assert mock_api.wl_import_plan(sched, after)["create"] == []

def test_same_name_different_sched_id_makes_two_rows():
    # ครูชื่อซ้ำกันจริงมีในโรงเรียน ต้องไม่ยุบเป็นคนเดียว
    sched = [{"id": 12, "name": "สมชาย"}, {"id": 99, "name": "สมชาย"}]
    assert len(mock_api.wl_import_plan(sched, [])["create"]) == 2

def test_scheduler_only_fields_are_refused():
    # ส่ง fixed_room_id มาต้องได้ 400 ไม่ใช่ถูกเมิน
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `bash tests/run.sh`
Expected: `FAIL py/wlregistry.py`

- [ ] **Step 3: เขียน `wl_import_plan` เป็นฟังก์ชันล้วน** จับคู่ด้วย `sched_id` เท่านั้น ห้ามมีการเทียบชื่อแม้เป็นทางสำรอง

- [ ] **Step 4: เขียน route ทั้งหกของสองทะเบียน และ route คัดลอกวันแรก** อ่าน `TEACHERS`/`SUBJECTS` เท่านั้น ไม่เขียน · ปฏิเสธช่องที่เป็นของเว็บตารางด้วย 400 พร้อมบอกชื่อช่องที่ผิดเป็นข้อความไทย

- [ ] **Step 5: ยืนยันว่าไม่มี endpoint ลบ**

Run: `grep -nE '@app\.delete\("/api/workload' mock_api.py`
Expected: ไม่มีผลลัพธ์

- [ ] **Step 6: รันตัวทดสอบ**

Run: `bash tests/run.sh`
Expected: `ALL PASS` ทุกไฟล์

- [ ] **Step 7: Commit**

```bash
git add mock_api.py tests/py/wlregistry.py
git commit -m "เว็บลงอัตรากำลัง: ทะเบียนครูและวิชาของเว็บใหม่ ผูกด้วยรหัสไม่ใช่ชื่อ"
```

---

## Task 4: โครงเว็บใหม่ และลิงก์ที่สอง

**Files:**
- Create: `workload/package.json` · `workload/vite.config.ts` · `workload/tsconfig.json` · `workload/index.html` · `workload/src/main.tsx` · `workload/src/App.tsx`
- Create: `.github/workflows/workload.yml`
- Modify: `.github/workflows/deploy.yml` — เพิ่ม `paths-ignore`

**Interfaces:**
- Produces: ลิงก์ `https://anun268455-stack.github.io/school-scheduler/workload/` ที่เปิดขึ้นหน้าว่างพร้อมหัวข้อไทย

คัดลอกค่าตั้งจาก `frontend/` ทั้งหมด รวม `base: process.env.VITE_BASE_URL ?? "/"` และฟอนต์ Sarabun

- [ ] **Step 1: สร้างโครงแอปให้ build ผ่าน** หน้า `App.tsx` ขึ้นแค่หัวข้อ "เว็บลงอัตรากำลัง" และสถานะการต่อเซิร์ฟเวอร์จาก `GET /api/workload/health`

- [ ] **Step 2: เขียน `.github/workflows/workload.yml`**

เลียนแบบ `preview.yml` ที่พิสูจน์แล้วเมื่อ 7 พ.ย. — `destination_dir: workload` · `keep_files: true` · `VITE_BASE_URL: /${{ github.event.repository.name }}/workload/` · `VITE_API_URL: ${{ secrets.VITE_API_URL }}` · ทำงานเมื่อ push main และแตะ `workload/**` เท่านั้น

- [ ] **Step 3: เพิ่ม `paths-ignore` ใน `deploy.yml`**

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - 'workload/**'
      - 'docs/**'
      - 'tests/**'
  workflow_dispatch:
```

เหตุผลเขียนเป็นคอมเมนต์: การแก้เว็บใหม่ต้องไม่ปลุก deploy ของเว็บตาราง เพราะตารางสอนยังไม่นิ่ง และการ build ใหม่ที่ไม่มีใครขอคือความเสี่ยงที่ไม่ได้อะไรกลับมา · `workflow_dispatch` ยังอยู่ จึงสั่ง deploy เว็บตารางด้วยมือได้เสมอ

- [ ] **Step 4: ยืนยันว่า CI เขียว**

Run: `gh run list --branch <สาขา> --limit 3`
Expected: lint ✓ build ✓ ตัวทดสอบ ✓

- [ ] **Step 5: Commit**

```bash
git add workload .github/workflows/workload.yml .github/workflows/deploy.yml
git commit -m "เว็บลงอัตรากำลัง: โครงแอปและลิงก์ที่สองที่ /workload/ ไม่ปลุก deploy ของเว็บตาราง"
```

---

## Task 5: หน้าล็อกอินและการแยกบทบาท

**Files:**
- Create: `workload/src/auth.ts` · `workload/src/api.ts` · `workload/src/pages/LoginPage.tsx`
- Modify: `workload/src/App.tsx`
- Test: `tests/ts/wlauth.ts`

**Interfaces:**
- Consumes: `POST /api/workload/login` (Task 2)
- Produces:
  - `type Session = { token: string; role: "admin" | "head"; departmentId: number | null; label: string }`
  - `canManageRegistry(s: Session | null): boolean`
  - `visibleDepartments(s: Session | null, all: number[]): number[]`
  - `loginError(status: number): string` — ข้อความไทยตามรหัสสถานะ

- [ ] **Step 1: เขียนตัวทดสอบที่ต้องแดง** ใน `tests/ts/wlauth.ts`

```ts
test("admin จัดการทะเบียนได้ หัวหน้ากลุ่มสาระไม่ได้", () => {
  eq(canManageRegistry({ token: "t", role: "admin", departmentId: null, label: "admin" }), true);
  eq(canManageRegistry({ token: "t", role: "head", departmentId: 3, label: "ภาษาไทย" }), false);
  eq(canManageRegistry(null), false);
});

test("หัวหน้ากลุ่มสาระเห็นแค่กลุ่มตัวเอง", () => {
  deepEq(visibleDepartments({ token: "t", role: "head", departmentId: 3, label: "x" }, [1,2,3]), [3]);
  deepEq(visibleDepartments({ token: "t", role: "admin", departmentId: null, label: "x" }, [1,2,3]), [1,2,3]);
});

test("ยังไม่ล็อกอินไม่เห็นกลุ่มไหนเลย", () => {
  deepEq(visibleDepartments(null, [1,2,3]), []);
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `bash tests/run.sh`
Expected: `FAIL ts/wlauth.ts`

- [ ] **Step 3: เขียน `auth.ts` เป็นตรรกะล้วน ไม่นำเข้า axios** เพื่อให้ `tests/run.sh` รันได้โดยไม่ต้องลง dependency

- [ ] **Step 4: เขียน `api.ts` และ `LoginPage.tsx`**

`api.ts` เป็นที่เดียวที่แปลงชื่อช่องระหว่างสองฝั่ง: เซิร์ฟเวอร์ใช้ `department_id` แบบขีดล่างตามแบบของ `mock_api.py` ส่วนชนิด `Session` ในหน้าเว็บใช้ `departmentId` ตามแบบของ `frontend/` ความต่างนี้ตั้งใจ ไม่ใช่ความพลาด และต้องไม่รั่วออกไปไฟล์อื่น

ช่องกรอกรหัสช่องเดียว ไม่มีช่องชื่อผู้ใช้ · เก็บ token ใน `sessionStorage` ไม่ใช่ `localStorage` (เครื่องในห้องพักครูใช้ร่วมกัน) · ล็อกอินแล้วเป็น admin ไปหน้าทะเบียน เป็นหัวหน้ากลุ่มสาระขึ้นข้อความไทยว่ายังไม่มีรอบอัตรากำลังที่เปิดอยู่ ซึ่งเป็นความจริงในขั้นนี้

- [ ] **Step 5: ขึ้นคำเตือนจากสเปกส่วนที่ 3 ค้างไว้ที่ท้ายหน้าล็อกอิน**

ข้อความ: รหัสนี้ป้องกันได้แค่เว็บนี้ · โปรแกรมจัดตารางสอนยังไม่มีระบบล็อกอิน ใครที่รู้ลิงก์ยังเข้าไปแก้ตารางได้ — เขียนไว้ให้เห็น ไม่ซ่อน เพราะคนตั้งรหัสจะเข้าใจผิดว่าทั้งระบบถูกล็อกแล้ว

- [ ] **Step 6: รันตัวทดสอบและ build**

Run: `bash tests/run.sh` แล้วดู CI
Expected: `ALL PASS` · build ✓

- [ ] **Step 7: Commit**

```bash
git add workload tests/ts/wlauth.ts
git commit -m "เว็บลงอัตรากำลัง: หน้าล็อกอินช่องรหัสช่องเดียว และการแยกบทบาท"
```

---

## Task 6: หน้าทะเบียนครูและทะเบียนวิชา

**Files:**
- Create: `workload/src/types.ts` · `workload/src/pages/TeachersPage.tsx` · `workload/src/pages/SubjectsPage.tsx`
- Modify: `workload/src/App.tsx` · `workload/src/api.ts`

**Interfaces:**
- Consumes: route ทั้งหกจาก Task 3 · `canManageRegistry` จาก Task 5
- Produces: หน้าจอที่ admin เพิ่มครู แก้ชื่อครู ย้ายกลุ่มสาระ ทำเครื่องหมายไม่ปฏิบัติงานแล้ว และทำอย่างเดียวกันกับวิชาได้

`types.ts` นำเข้าชนิดจาก `../../frontend/src/types` แล้วประกาศชนิดของเว็บใหม่เป็น `Pick<Teacher, ...>` ของช่องที่เว็บใหม่เป็นเจ้าของเท่านั้น — ถ้าใครเพิ่มช่องเงื่อนไขเข้ามา TypeScript จะฟ้องทันที ไม่ต้องรอรีวิว

- [ ] **Step 1: เขียน `types.ts` ด้วย `Pick` และยืนยันว่าชนิดกันช่องผิดได้จริง**

เพิ่มบรรทัดที่อ้าง `fixed_room_id` ชั่วคราว รัน typecheck ให้เห็นว่ามันฟ้อง แล้วลบบรรทัดนั้นออก — พิสูจน์ว่าด่านชนิดทำงาน ไม่ใช่แค่เขียนไว้

- [ ] **Step 2: เขียน `TeachersPage.tsx`**

รายการเรียงตามกลุ่มสาระแล้วตามลำดับในกลุ่ม · ปุ่มเพิ่ม · แก้ในแถว · สวิตช์ "ไม่ปฏิบัติงานแล้ว" · **ไม่มีปุ่มลบ** · แสดงว่าแถวไหนยังไม่เคยส่งเข้าโปรแกรม (`sched_id` ว่าง)

- [ ] **Step 3: เขียน `SubjectsPage.tsx`** รูปเดียวกัน พร้อมช่องคาบคู่ เป็นกิจกรรม เป็นวิชาเสรี

- [ ] **Step 4: ใส่ปุ่ม "ดึงครูจากโปรแกรมจัดตาราง"**

กดแล้วขึ้นหน้าสรุปก่อนเขียนว่าจะสร้างกี่คน มีแล้วกี่คน ยังไม่เขียนจนกดยืนยัน · หลังทำเสร็จขึ้นจำนวนจริงที่เกิดขึ้น

- [ ] **Step 5: รันตัวทดสอบและ build**

Run: `bash tests/run.sh` แล้วดู CI
Expected: `ALL PASS` · lint ✓ build ✓

- [ ] **Step 6: Commit**

```bash
git add workload
git commit -m "เว็บลงอัตรากำลัง: หน้าทะเบียนครูและวิชา พร้อมด่านชนิดกันช่องของเว็บตาราง"
```

---

## Task 7: ตั้งรหัสครั้งแรก และคู่มือสองหน้า

**Files:**
- Create: `workload/src/pages/CodesPage.tsx`
- Create: `docs/workload-setup.md`

**Interfaces:**
- Consumes: route รหัสเข้าจาก Task 2

- [ ] **Step 1: เขียน `CodesPage.tsx`** admin เห็นรายการรหัสทั้ง 12 รายการ (admin + 11 กลุ่มสาระ) ตั้งใหม่ได้ ปิดได้ · ไม่แสดงรหัสจริงที่ไหนเลย · ตั้งใหม่แล้วแสดงรหัสที่พิมพ์ครั้งเดียวในกล่องที่คัดลอกได้ พร้อมข้อความว่าปิดหน้านี้แล้วจะดูย้อนไม่ได้

- [ ] **Step 2: เขียน `docs/workload-setup.md`** ลำดับงานครั้งเดียวตอนเริ่มใช้: ตั้งรหัส admin → กดดึงครูจากโปรแกรมจัดตาราง → ตรวจว่าครูครบ → ตั้งรหัสกลุ่มสาระ 11 กลุ่ม → แจกรหัส · ภาษาไทย เขียนให้คนที่ไม่ใช่โปรแกรมเมอร์อ่านรู้เรื่อง

- [ ] **Step 3: ไล่ข้อสอบ 6 ข้อของสเปกส่วนที่ 11 หัวข้อทะเบียนครูและวิชา ที่ทำได้ในขั้นนี้**

ข้อที่ทำได้ตอนนี้: ข้อ 5 (ดึงครูเทียบด้วยรหัสไม่ใช่ชื่อ) · ข้อ 6 (คัดลอกวันแรกครบและทุกแถวมีรหัส) · ข้อ 3 เฉพาะครึ่งที่ไม่สร้างซ้ำ — ที่เหลือต้องรอแผนการซิงก์ บันทึกไว้ในไฟล์คู่มือว่าข้อไหนยังค้าง

- [ ] **Step 4: รันตัวทดสอบและ build**

Run: `bash tests/run.sh` แล้วดู CI
Expected: `ALL PASS` · lint ✓ build ✓

- [ ] **Step 5: Commit**

```bash
git add workload docs/workload-setup.md
git commit -m "เว็บลงอัตรากำลัง: หน้าตั้งรหัสเข้า และคู่มือตั้งค่าครั้งแรก"
```

---

## หลังจบทั้ง 7 task

รีวิวทั้งสาขาด้วย `superpowers:requesting-code-review` บนโมเดลที่เก่งที่สุด แล้วจึงใช้ `superpowers:finishing-a-development-branch`

ของที่ต้องทดสอบด้วยมือก่อนให้คนในโรงเรียนใช้ — ไม่มีทางทดสอบจากที่นี่ได้เพราะเข้าฐานข้อมูลจริงไม่ได้

1. กดดึงครูจาก **สำเนา** ฐานข้อมูลจริง แล้วนับว่าได้ครูเท่ากับที่เว็บตารางมี
2. ขณะกรอกในเว็บใหม่ เปิดเว็บตารางอีกเครื่องค้างไว้ — ตัวเลข `revision` ที่ `/api/state/version` ต้องไม่ขยับเลย และหน้าตารางต้องไม่รีโหลด
3. ปิดเทอมในเว็บตาราง แล้วยืนยันว่าเว็บใหม่ยังกรอกได้
4. ล็อกอินด้วยรหัสกลุ่มสาระเดียวกันสองเครื่องพร้อมกัน ทั้งคู่ต้องใช้งานได้
