# ชั้นเทอม และปุ่มสร้างเทอมใหม่ — แผนการทำงาน

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** โปรแกรมจัดตารางสอนเก็บข้อมูลเป็น "เทอม" ได้ — กดสร้างเทอมใหม่แล้วเทอมเก่าถูกปิดเป็นไฟล์ที่เปิดดูและปริ้นได้ แก้ไม่ได้

**Architecture:** ไฟล์เทอมคือสำเนาที่ `_snapshot()` สร้างอยู่แล้ว บีบอัดด้วย `_pack()` เก็บในตาราง `app_terms` ของ Postgres แบบเดียวกับตาราง `app_state_history` ที่มีอยู่ ต่างแค่ไม่ถูกลบตามอายุและมีชื่อเทอมกับสถานะ · การเปิดดูเทอมเก่าเป็นงานฝั่งเบราว์เซอร์ล้วน เซิร์ฟเวอร์ส่งสำเนามาให้แล้วหน้าจอนั้นแสดงและหยุดซิงค์สด ตัวแปรข้อมูลบนเซิร์ฟเวอร์ไม่ถูกแตะ · การ์ดกันเขียนของเทอมที่ปิดแล้วอยู่ที่ middleware `_bump_revision` ซึ่งเป็นจุดที่คำขอเขียนทุกตัววิ่งผ่าน จุดเดียว

**Tech Stack:** Python 3 + FastAPI (ไฟล์เดียว `mock_api.py`) · Postgres ผ่าน psycopg · React + Zustand + TypeScript (`frontend/`) · ตัวทดสอบใน `tests/` รันด้วย `bash tests/run.sh`

**Spec:** `docs/superpowers/specs/2026-11-06-workload-entry-site-design.md` — แผนนี้ทำเฉพาะ **ส่วนที่ 8** (ปุ่มสร้างเทอมใหม่และไฟล์เทอม) และข้อทดสอบ 11–20 ของส่วนที่ 11

## ขอบเขต: นี่เป็นแผนที่ 1 จาก 3

สเปกครอบสามระบบที่แยกกันได้ แต่ละอันใช้งานได้ด้วยตัวเอง

| แผน | ทำอะไร | ต้องมีอะไรก่อน |
|---|---|---|
| **1 (แผนนี้)** | ชั้นเทอมในโปรแกรมเดิม — สร้างเทอมใหม่ · เทอมเก่าอ่านอย่างเดียว · สถิติ | ไม่ต้องมีอะไร |
| 2 | เว็บลงอัตรากำลัง (repo ใหม่) — รหัสเข้า · แถววิชา · คาบเสรี · ตรวจและส่ง | แผน 1 (ต้องรู้ว่ารอบผูกกับเทอมไหน) |
| 3 | การส่งเข้าโปรแกรม — สร้างเทอมใหม่จากรอบอัตรากำลัง · อัปเดตกลางเทอมทีละข้อ | แผน 1 และ 2 |

**แผนนี้เสร็จแล้วใช้งานได้จริงเลย** — "สร้างเทอมใหม่" ของแผนนี้เก็บเทอมเดิมเป็นไฟล์ คงทะเบียนและแผนการสอนไว้ และล้างคาบให้เริ่มจัดใหม่ ซึ่งเป็นสิ่งที่โรงเรียนทำทุกเทอมอยู่แล้ว แผน 3 จะเพิ่มทางเลือก "สร้างจากรอบอัตรากำลัง" เข้ามาทีหลัง

## Global Constraints

- **ห้ามแตะคาบในตารางของเทอมที่ใช้งานอยู่** นอกจากขั้นล้างคาบตอนสร้างเทอมใหม่ ซึ่งผู้ใช้กดยืนยันแล้ว
- **สายต่อฐานข้อมูลเป็นรหัสผ่าน** ห้ามเขียนลง repo ห้ามพิมพ์ออกมา โค้ดอ่านจาก `os.environ` เท่านั้น
- **ไม่มีระบบล็อกอินใน `mock_api.py`** "admin เท่านั้น" ในแผนนี้จึงหมายถึงการยืนยันด้วยการพิมพ์ชื่อเทอม ไม่ใช่การตรวจตัวบุคคล และต้องเขียนไว้ในข้อความบนหน้าจอให้ตรงความจริง
- ข้อความที่ผู้ใช้เห็นทุกข้อความเป็นภาษาไทย
- `_STORE_KIND` เป็น `"file"` ได้เมื่อยังไม่ต่อฐานข้อมูล ทุก endpoint ของเทอมต้องปฏิเสธด้วยข้อความไทยที่บอกสาเหตุ ไม่ใช่ล้มเหลวเงียบ ๆ (ตามแบบของ `restore_history` บรรทัด 13757–13761)
- `npm run lint` ต้องผ่าน — import หรือ prop ที่ไม่ได้ใช้ทำให้ CI พัง
- ทุกการแก้ `mock_api.py` ต้องไม่ย้ายหรือเปลี่ยนลำดับ `add_middleware` (คอมเมนต์บรรทัด 52 อธิบายว่าทำไม)
- **ห้ามย้าย `SLOTS`, `REQUIREMENTS`, `GROUPS` หรือตัวแปรข้อมูลตัวใดเข้าไปอยู่ในก้อนของเทอม** เทอมที่ใช้งานอยู่ยังอยู่ในตัวแปรระดับโมดูลเดิมทุกตัว ไฟล์เทอมเป็นสำเนาแยกที่ไม่เกี่ยวกับตัวแปรเหล่านั้น
  เหตุผล: มี 19 จุดในไฟล์ที่ทำ `global SLOTS` แล้วผูกตัวแปรใหม่ทั้งก้อน (เช่น `_sync_pool_slots` บรรทัด 11099) ถ้าย้ายข้อมูลไปอยู่ใต้เทอม ต้องแก้ทั้ง 19 จุดและ alias ที่ `curriculum.py` ถืออยู่ผ่าน `lambda: SLOTS` (บรรทัด 13841) จะหลุด — เป็นความเสี่ยงที่แผนนี้ไม่รับ และไม่จำเป็นเลย

## Review Focus

ห้าอย่างที่สเปกบอกเป็นนัยแต่ไม่มี task ไหนทดสอบเอง ถ้าไม่ดักจะกัดผู้ใช้จริง — เรียงจากน่าจะเกิดที่สุด

1. **ยังมีการเซฟค้างอยู่ตอนกดสร้างเทอมใหม่** (`_pending_blob` ไม่ว่าง) ไฟล์เทอมจะขาดการแก้ล่าสุดไป → Task 2 Step 1 ทดสอบว่าต้องเรียก `_flush_pending(blocking=True)` ก่อนทำสำเนา
2. **เปิดดูเทอมเก่าแล้วซิงค์สดดึงข้อมูลเทอมปัจจุบันมาทับ** หน้าจอจะเด้งกลับเป็นเทอมปัจจุบันเองเฉย ๆ → Task 7 ทดสอบว่า `shouldPoll` คืน false เมื่อกำลังดูเทอมเก่า
3. **กดสร้างเทอมใหม่สองครั้งซ้อน** (ดับเบิลคลิก หรือสองแท็บ) จะได้เทอมซ้ำหรือสำเนาหาย → Task 2 ทดสอบว่าปี+ภาคเรียนที่มีอยู่แล้วถูกปฏิเสธ
4. **ยังไม่ต่อฐานข้อมูล** (`_STORE_KIND == "file"`) เทอมที่สร้างจะหายตอนเซิร์ฟเวอร์หลับ → Task 1 ทดสอบว่าทุก endpoint ปฏิเสธพร้อมบอกสาเหตุ
5. **ไฟล์เทอมเก่าอ้างครูหรือห้องที่ถูกลบไปก่อนมีระบบเทอม** หน้าจอต้องแสดงได้ ไม่พัง → Task 5 ทดสอบว่า `_term_entity_index` ข้ามรหัสที่ไม่มีในทะเบียนแล้วโดยไม่ยกข้อผิดพลาด

---

## File Structure

**แก้ไข**

| ไฟล์ | รับผิดชอบอะไรเพิ่ม |
|---|---|
| `mock_api.py` | ตาราง `app_terms` · ฟังก์ชันเทอม · endpoint ของเทอม · การ์ดกันเขียนใน `_bump_revision` |
| `frontend/src/api/client.ts` | ฟังก์ชันเรียก endpoint ของเทอม |
| `frontend/src/store/timetableStore.ts` | สถานะเทอมในร้าน · `openTerm` / `closeTerm` · หยุดซิงค์สดตอนดูเทอมเก่า |
| `frontend/src/components/layout/TopNavbar.tsx` | แถบชื่อเทอมและคำเตือนโหมดอ่านอย่างเดียว |
| `frontend/src/utils/printSheet.ts` | ชื่อเทอมในแบบฟอร์มใบพิมพ์ |
| `frontend/src/components/print/PrintView.tsx` · `WorkloadReport.tsx` | แสดงชื่อเทอมบนกระดาษ |

**สร้างใหม่**

| ไฟล์ | รับผิดชอบ |
|---|---|
| `frontend/src/utils/terms.ts` | ฟังก์ชันล้วนเรื่องเทอม — ชื่อเทอม · เรียงลำดับ · ตัดสินว่าแก้ได้ไหม · ตัดสินว่าควรซิงค์ไหม |
| `frontend/src/components/terms/TermsPanel.tsx` | หน้ารายการเทอม — เปิดดู · สร้างใหม่ · ปลดล็อก · ดาวน์โหลด |
| `frontend/src/components/terms/NewTermModal.tsx` | หน้าสรุปก่อนสร้างเทอมใหม่ พร้อมคำเตือน |
| `frontend/src/components/terms/TermStatsPanel.tsx` | สถิติย้อนหลัง |
| `tests/py/terms.py` | ตัวทดสอบฝั่งเซิร์ฟเวอร์ — สร้างเทอม · ปิด · ปลดล็อก · สถิติ |
| `tests/py/termguard.py` | ตัวทดสอบการ์ดกันเขียนและการกันลบ |
| `tests/ts/terms.ts` | ตัวทดสอบฟังก์ชันล้วนใน `utils/terms.ts` |

`TermsPanel.tsx` ลอกโครงจาก `frontend/src/components/backup/ServerHistoryPanel.tsx` ซึ่งทำงานแบบเดียวกันอยู่แล้ว (รายการสำเนาจากเซิร์ฟเวอร์ + ปุ่มกู้คืน)

**ทำไมคอมโพเนนต์ไม่มีตัวทดสอบ** — repo นี้ไม่มีเครื่องมือทดสอบคอมโพเนนต์ React ตัวทดสอบใน `tests/ts/` เป็นไฟล์ที่ node รันตรง ๆ และทดสอบได้แต่โมดูลล้วนใน `utils/` ตามแบบที่ `printsheet.ts` และ `electiverooms.ts` ทำอยู่ Task 7 จึงดึงทุกการตัดสินใจออกมาเป็นฟังก์ชันล้วนใน `utils/terms.ts` ให้ทดสอบได้ และเหลือไว้ในคอมโพเนนต์แค่การวาดหน้าจอ — ถ้า Task 8 หรือ 9 ต้องเขียนเงื่อนไขใหม่ที่ตัดสินใจอะไร ให้ย้ายไป `utils/terms.ts` พร้อมตัวทดสอบ ไม่เขียนไว้ในคอมโพเนนต์

---

## Task 1: ตารางเทอมในฐานข้อมูล และรายการเทอม

**Files:**
- Modify: `mock_api.py` — เพิ่มถัดจาก `_db_history_blob` (จบบรรทัด 13564)
- Test: `tests/py/terms.py` (สร้าง)

**Interfaces:**
- Consumes: `_db_connect()` (13450) · `_pack(snapshot)` (13439) · `_unpack(blob)` (13446) · `_snapshot()` (13299) · `_STORE_KIND` (13427) · `HTTPException`
- Produces:
  - `_TERMS_SCHEMA: str` — DDL ของตาราง `app_terms` คอลัมน์: `id bigserial PRIMARY KEY`, `year integer NOT NULL`, `semester integer NOT NULL`, `label text NOT NULL`, `status text NOT NULL`, `data bytea NOT NULL`, `slots integer`, `opened_at timestamptz NOT NULL DEFAULT now()`, `closed_at timestamptz`, `UNIQUE (year, semester)`
  - `_terms_list() -> list[dict[str, Any]]` — คืน `{"id", "year", "semester", "label", "status", "slots", "opened_at", "closed_at", "bytes"}` เรียงใหม่สุดก่อน **ไม่มีคอลัมน์ `data`**
  - `_term_row(term_id: int) -> dict[str, Any] | None` — เหมือนข้างบนแต่ของแถวเดียว
  - `_term_blob(term_id: int) -> bytes | None`
  - `_term_insert(year: int, semester: int, label: str, status: str, blob: bytes, slots: int) -> int` — คืน id ที่สร้าง
  - `_term_set_status(term_id: int, status: str) -> None` — เมื่อ status เป็น `"closed"` ให้เซ็ต `closed_at = now()` และเมื่อเป็น `"active"` ให้เซ็ตกลับเป็น `NULL`
  - `_require_db() -> None` — ยก `HTTPException(400, "ยังไม่ได้ต่อฐานข้อมูล จึงใช้ระบบเทอมไม่ได้")` เมื่อ `_STORE_KIND != "postgres"`
  - `term_label(year: int, semester: int) -> str` — คืน `f"{semester}/{year}"`
  - `GET /api/terms` → `{"available": bool, "terms": [...]}`

สถานะมีสองค่าเท่านั้น: `"active"` (ใช้งานอยู่ แก้ได้ มีได้ไม่เกินหนึ่งแถว) และ `"closed"` (ปิดแล้ว อ่านอย่างเดียว)

- [ ] **Step 1: เขียนตัวทดสอบที่ยังไม่ผ่าน**

สร้าง `tests/py/terms.py` ตามรูปแบบของ `tests/py/electiveroom2.py` (ตั้ง `PYTHONPATH` ให้เห็น `tests/stubs` แล้ว `import mock_api`, เก็บผลเป็นตัวนับ, พิมพ์ `ALL PASS` ท้ายสุดเมื่อผ่านครบ) ตัวทดสอบในขั้นนี้ไม่ต่อฐานข้อมูลจริง:

```python
def test_term_label():
    assert mock_api.term_label(2569, 1) == "1/2569"
    assert mock_api.term_label(2568, 2) == "2/2568"

def test_require_db_refuses_without_postgres():
    mock_api._STORE_KIND = "file"
    try:
        mock_api._require_db()
        assert False, "ต้องยก HTTPException"
    except Exception as exc:
        assert "ยังไม่ได้ต่อฐานข้อมูล" in str(exc)

def test_terms_list_reports_unavailable_without_postgres():
    mock_api._STORE_KIND = "file"
    out = mock_api.list_terms()
    assert out["available"] is False
    assert out["terms"] == []

def test_terms_schema_has_unique_year_semester():
    # ปี+ภาคเรียนซ้ำต้องถูกฐานข้อมูลปฏิเสธ ไม่ใช่แค่โค้ดตรวจ (Review Focus 3)
    assert "UNIQUE (year, semester)" in mock_api._TERMS_SCHEMA
    assert "app_terms" in mock_api._TERMS_SCHEMA
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd /home/claude/school-scheduler && PYTHONPATH=tests/stubs:. python3 tests/py/terms.py`
Expected: FAIL — `AttributeError: module 'mock_api' has no attribute 'term_label'`

- [ ] **Step 3: เขียนฟังก์ชันตาม Interfaces ข้างบนใน `mock_api.py`**

วางถัดจาก `_db_history_blob` ลอกรูปแบบการต่อฐานข้อมูลจาก `_db_history()` (13544–13554) ทุกฟังก์ชันที่แตะฐานข้อมูลต้อง `cur.execute(_TERMS_SCHEMA)` ก่อน เหมือนที่ `_db_history` ทำกับ `_DB_HISTORY_SCHEMA`

`list_terms()` เป็น endpoint `GET /api/terms` — เมื่อ `_STORE_KIND != "postgres"` คืน `{"available": False, "terms": []}` ไม่ยกข้อผิดพลาด เพราะหน้าจอต้องเปิดได้และบอกผู้ใช้ว่าทำไมใช้ไม่ได้ ส่วน endpoint ที่เขียนข้อมูลใช้ `_require_db()` ยกข้อผิดพลาดแทน

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /home/claude/school-scheduler && bash tests/run.sh`
Expected: `ok   py/terms.py` และตัวทดสอบเดิมทั้งหมดยังผ่าน — `— ผ่าน 7 · ไม่ผ่าน 0 —`

- [ ] **Step 5: Commit**

```bash
git add mock_api.py tests/py/terms.py
git commit -m "เทอม: ตารางเก็บไฟล์เทอมในฐานข้อมูล และรายการเทอม"
```

---

## Task 2: สร้างเทอมใหม่

**Files:**
- Modify: `mock_api.py` — endpoint ใหม่ถัดจาก Task 1
- Test: `tests/py/terms.py` (เพิ่ม)

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1 · `_flush_pending(blocking: bool)` (13598) · `_apply_snapshot(data)` (13345) · `_save_state()` (13651) · `SLOTS` (244) · `REVISION` (61) · `CURRENT_TERM`
- Produces:
  - `CURRENT_TERM: dict[str, Any]` — ตัวแปรระดับโมดูล `{"id": int | None, "year": int | None, "semester": int | None, "label": str | None}` เริ่มเป็น `None` ทั้งหมด เพิ่มเข้า `_snapshot()` เป็นคีย์ `"current_term"` และอ่านกลับใน `_apply_snapshot()`

> **`SCHOOL_CONFIG` มีช่องปีและภาคเรียนอยู่แล้ว** — คีย์ `"term"` และ `"year"` (บรรทัด 13201 เป็นสตริง) ซึ่งทุกวันนี้แก้ได้จากหน้าตั้งค่าผ่าน `PUT /api/school/config` → `update_school_config` (14995) ถ้าปล่อยให้แก้ได้ต่อไปหลังมีระบบเทอม สองที่จะขัดกันเอง และใบพิมพ์จะพิมพ์เทอมที่ไม่ตรงกับไฟล์เทอม
>
> กฎ: **แถวใน `app_terms` เป็นเจ้าของความจริงว่านี่คือเทอมไหน** `SCHOOL_CONFIG["term"]`/`["year"]` เป็นแค่ค่าที่พิมพ์ลงกระดาษ ตอนสร้างเทอมใหม่ให้เขียนทั้งสองที่ให้ตรงกัน และ `PUT /api/school/config` ต้อง **เมินค่า `term` กับ `year` ที่ส่งมา** เมื่อ `CURRENT_TERM["id"]` ไม่เป็น `None` (ไม่ต้องยกข้อผิดพลาด แค่ไม่เขียน) ส่วนหน้าตั้งค่าแสดงสองช่องนี้เป็นอ่านอย่างเดียวพร้อมข้อความว่าเปลี่ยนที่หน้ารายการเทอม (Task 8)
  - `new_term_preview() -> dict[str, Any]` — ฟังก์ชันล้วน นับสิ่งที่จะได้: `{"requirements": int, "teachers": int, "periods_total": int, "curricula": int, "slots_to_clear": int}` โดย `periods_total` คือผลรวม `weekly_count` ของ `REQUIREMENTS` ทั้งหมด
  - `GET /api/terms/preview` → ผลของ `new_term_preview()`
  - `POST /api/terms` รับ `{"year": int, "semester": int}` → `{"closed": {...meta ของเทอมที่ปิด} | None, "active": {...meta ของเทอมใหม่}}`

ลำดับในการสร้างเทอมใหม่ — ลำดับนี้สำคัญ

1. `_require_db()`
2. ตรวจ `year` เป็นจำนวนเต็ม 2500–2700 และ `semester` เป็น 1 หรือ 2 ไม่ใช่ก็ยก `HTTPException(400, ...)`
3. ถ้ามีแถวที่ `(year, semester)` ตรงกันอยู่แล้ว ยก `HTTPException(409, f"มีเทอม {label} อยู่แล้ว")`
4. **`_flush_pending(blocking=True)`** — ถ้าไม่ทำ ไฟล์เทอมจะขาดการแก้ล่าสุด (Review Focus 1)
4ก. ตรวจว่าเซิร์ฟเวอร์ยังเขียนข้อมูลลงฐานได้ — `_save_state()` มีเงื่อนไขปฏิเสธการเขียน (บรรทัด 13662–13668 รายงานเป็น `write_blocked` ใน `/api/state/info`) ถ้ากำลังถูกปฏิเสธอยู่ ให้ยก `HTTPException(409, "เซิร์ฟเวอร์ยังไม่ยอมเขียนข้อมูลลงฐาน จึงสร้างเทอมใหม่ไม่ได้ — ยืนยันข้อมูลที่ถืออยู่ก่อน")` ไม่งั้นแถวเทอมจะถูกเขียนแต่ข้อมูลจริงไม่ถูกเขียน
5. ทำสำเนาเทอมเดิม: `_term_insert(ปีและภาคเรียนของ CURRENT_TERM, status="closed", blob=_pack(_snapshot()), slots=len(SLOTS))` — ถ้า `CURRENT_TERM["year"]` เป็น `None` (ยังไม่เคยมีเทอมเลย) ให้ข้ามขั้นนี้และไม่ปิดอะไร
6. ล้างคาบ: `SLOTS.clear()` — ทะเบียนครู ห้อง วิชา กลุ่มสาระ แผนการสอน หลักสูตร คงไว้ทั้งหมด
7. ตั้ง `CURRENT_TERM` เป็นเทอมใหม่ แล้ว `_term_insert(..., status="active", blob=_pack(_snapshot()), slots=0)` เก็บ id ที่ได้ใส่ `CURRENT_TERM["id"]`
8. `_save_state()`

- [ ] **Step 1: เขียนตัวทดสอบที่ยังไม่ผ่าน**

เพิ่มใน `tests/py/terms.py`:

```python
def test_preview_counts_what_the_new_term_will_hold():
    mock_api.REQUIREMENTS[:] = [
        {"id": 1, "weekly_count": 3}, {"id": 2, "weekly_count": 2},
    ]
    mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}, {"id": 3}]
    out = mock_api.new_term_preview()
    assert out["requirements"] == 2
    assert out["periods_total"] == 5
    assert out["slots_to_clear"] == 3

def test_snapshot_carries_current_term():
    mock_api.CURRENT_TERM.update({"id": 7, "year": 2569, "semester": 1, "label": "1/2569"})
    snap = mock_api._snapshot()
    assert snap["current_term"]["label"] == "1/2569"

def test_apply_snapshot_restores_current_term():
    mock_api.CURRENT_TERM.update({"id": None, "year": None, "semester": None, "label": None})
    mock_api._apply_snapshot({"current_term":
        {"id": 7, "year": 2569, "semester": 1, "label": "1/2569"}})
    assert mock_api.CURRENT_TERM["year"] == 2569

def test_apply_snapshot_without_current_term_leaves_it_blank():
    # ไฟล์สำรองเก่าที่ทำไว้ก่อนมีระบบเทอม ต้องโหลดได้ ไม่พัง
    mock_api.CURRENT_TERM.update({"id": 7, "year": 2569, "semester": 1, "label": "1/2569"})
    mock_api._apply_snapshot({})
    assert mock_api.CURRENT_TERM["year"] is None

def test_config_cannot_change_term_once_a_term_exists():
    mock_api.CURRENT_TERM.update({"id": 7, "year": 2569, "semester": 1, "label": "1/2569"})
    mock_api.SCHOOL_CONFIG.update({"term": "1", "year": "2569"})
    mock_api.update_school_config({"term": "2", "year": "2570", "schoolName": "ทดสอบ"})
    assert mock_api.SCHOOL_CONFIG["term"] == "1"      # ไม่ถูกเปลี่ยน
    assert mock_api.SCHOOL_CONFIG["year"] == "2569"
    assert mock_api.SCHOOL_CONFIG["schoolName"] == "ทดสอบ"   # ช่องอื่นยังแก้ได้

def test_config_still_editable_before_any_term_exists():
    mock_api.CURRENT_TERM.update({"id": None, "year": None, "semester": None, "label": None})
    mock_api.update_school_config({"term": "2", "year": "2570"})
    assert mock_api.SCHOOL_CONFIG["term"] == "2"

def test_create_term_rejects_bad_year_and_semester():
    mock_api._STORE_KIND = "postgres"
    for body in ({"year": 1999, "semester": 1}, {"year": 2569, "semester": 3},
                 {"year": "สองพัน", "semester": 1}):
        try:
            mock_api.create_term(body)
            assert False, f"ต้องปฏิเสธ {body}"
        except Exception as exc:
            assert "400" in repr(exc) or "ภาคเรียน" in str(exc) or "ปีการศึกษา" in str(exc)
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd /home/claude/school-scheduler && PYTHONPATH=tests/stubs:. python3 tests/py/terms.py`
Expected: FAIL — ไม่มี `new_term_preview`

- [ ] **Step 3: เขียน `CURRENT_TERM`, `new_term_preview()`, `GET /api/terms/preview`, `POST /api/terms` (`create_term(body: dict[str, Any])`) ใน `mock_api.py` ตามลำดับแปดขั้นข้างบน**

วาง `CURRENT_TERM` ไว้ใกล้ `SCHOOL_CONFIG` (13200) เพื่อให้อยู่ก่อน `_snapshot()`

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /home/claude/school-scheduler && bash tests/run.sh`
Expected: ทุกไฟล์ `ok` และ `ไม่ผ่าน 0`

- [ ] **Step 5: Commit**

```bash
git add mock_api.py tests/py/terms.py
git commit -m "เทอม: สร้างเทอมใหม่ — ปิดเทอมเดิมเป็นไฟล์ แล้วล้างคาบ"
```

---

## Task 3: การ์ดกันเขียนของเทอมที่ปิดแล้ว

**Files:**
- Modify: `mock_api.py` — ฟังก์ชันล้วนวางก่อน `_bump_revision` (82) และเรียกใช้ใน `_bump_revision`
- Test: `tests/py/termguard.py` (สร้าง)

**Interfaces:**
- Consumes: `CURRENT_TERM` (Task 2) · `_term_row` (Task 1)
- Produces:
  - `TERM_WRITE_SAFE_PATHS: frozenset[str]` — path ที่เขียนได้แม้ยังไม่มีเทอม: `"/api/terms"`, `"/api/restore"`, `"/api/state/adopt"` และ path ที่ขึ้นต้นด้วย `"/api/state/history/"`
  - `term_blocks_write(term: dict[str, Any] | None, method: str, path: str) -> str | None` — คืนข้อความไทยที่บอกเหตุผลเมื่อห้ามเขียน คืน `None` เมื่อเขียนได้ กฎ:
    - `method` ไม่อยู่ใน `("POST", "PUT", "PATCH", "DELETE")` → `None`
    - `path` อยู่ใน `TERM_WRITE_SAFE_PATHS` หรือขึ้นต้นด้วยสมาชิกที่ลงท้ายด้วย `/` → `None`
    - `term` เป็น `None` หรือ `term.get("status") != "closed"` → `None` (ยังไม่เคยสร้างเทอม ก็ทำงานได้เหมือนเดิม)
    - นอกนั้น → `f"เทอม {term['label']} ปิดแล้ว ดูและปริ้นได้เท่านั้น"`

`_bump_revision` เรียก `term_blocks_write(CURRENT_TERM, request.method, request.url.path)` **ก่อน** `await call_next(request)` และถ้าได้ข้อความ ให้ตอบ `JSONResponse(status_code=409, content={"detail": msg})` โดยไม่เรียก `call_next` เลย

> **ก่อน ไม่ใช่หลัง** — โค้ดเดิมของ `_bump_revision` ตรวจทุกอย่างหลัง `await call_next` เพราะต้องรู้ `status_code` การ์ดนี้ตรงกันข้าม ต้องตรวจก่อน เพราะถ้าปล่อยให้ handler ทำงานไปแล้วค่อยปฏิเสธ ข้อมูลในหน่วยความจำถูกแก้ไปแล้วจริง ๆ แค่ไม่ได้เซฟ — ซึ่งแปลว่าเทอมที่ปิดแล้วถูกแก้สำเร็จจนถึงรีสตาร์ตครั้งถัดไป `request.method` และ `request.url.path` อ่านได้ก่อนเรียก handler อยู่แล้ว
>
> จุดนี้คือเหตุผลที่การ์ดอยู่ที่เดียว — **โปรแกรมมี endpoint ที่เขียนข้อมูล 85 ตัว** (POST 49 · PUT 16 · DELETE 19 · PATCH 1) ไม่มี dependency กลางและไม่มี Pydantic model เลย แต่ทุกตัววิ่งผ่าน `_bump_revision` ตัวเดียว (คอมเมนต์บรรทัด 52) การ์ดที่จุดนี้จึงครอบทั้ง 85 ตัวและทุกตัวที่จะเขียนเพิ่มในอนาคต ข้อทดสอบ 14 ของสเปกผ่านโดยอัตโนมัติ ส่วนทางเลือกอื่น — แก้ทีละ endpoint — คือ 85 จุดที่พลาดได้ 85 ครั้ง

- [ ] **Step 1: เขียนตัวทดสอบที่ยังไม่ผ่าน**

สร้าง `tests/py/termguard.py`:

```python
CLOSED = {"id": 3, "year": 2568, "semester": 2, "label": "2/2568", "status": "closed"}
ACTIVE = {"id": 4, "year": 2569, "semester": 1, "label": "1/2569", "status": "active"}

def test_reads_always_allowed():
    for m in ("GET", "HEAD", "OPTIONS"):
        assert mock_api.term_blocks_write(CLOSED, m, "/api/slots/") is None

def test_closed_term_blocks_every_write_verb():
    for m in ("POST", "PUT", "PATCH", "DELETE"):
        msg = mock_api.term_blocks_write(CLOSED, m, "/api/slots/1")
        assert msg is not None
        assert "2/2568" in msg and "ปิดแล้ว" in msg

def test_active_term_allows_writes():
    assert mock_api.term_blocks_write(ACTIVE, "POST", "/api/slots/") is None

def test_no_term_yet_allows_writes():
    # โรงเรียนที่ยังไม่เคยกดสร้างเทอม ต้องใช้โปรแกรมได้เหมือนเดิมทุกอย่าง
    assert mock_api.term_blocks_write(None, "POST", "/api/slots/") is None
    assert mock_api.term_blocks_write(
        {"id": None, "label": None, "status": None}, "POST", "/api/slots/") is None

def test_term_endpoints_stay_open_while_closed():
    # ไม่งั้นปลดล็อกไม่ได้เลย เพราะการปลดล็อกเองก็เป็น POST
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/terms") is None
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/terms/3/unlock") is None
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/restore") is None
    assert mock_api.term_blocks_write(CLOSED, "POST", "/api/state/history/9/restore") is None
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd /home/claude/school-scheduler && PYTHONPATH=tests/stubs:. python3 tests/py/termguard.py`
Expected: FAIL — ไม่มี `term_blocks_write`

- [ ] **Step 3: เขียน `TERM_WRITE_SAFE_PATHS` และ `term_blocks_write` แล้วต่อเข้า `_bump_revision`**

`"/api/terms/3/unlock"` ต้องผ่าน จึงต้องให้ `"/api/terms"` ครอบ path ลูกด้วย — ใช้การเทียบทั้งตรงตัวและขึ้นต้นด้วย `"/api/terms/"`

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /home/claude/school-scheduler && bash tests/run.sh`
Expected: `ok   py/termguard.py` และทุกไฟล์เดิมยังผ่าน

- [ ] **Step 5: Commit**

```bash
git add mock_api.py tests/py/termguard.py
git commit -m "เทอม: เซิร์ฟเวอร์ปฏิเสธการเขียนของเทอมที่ปิดแล้ว ที่จุดเดียว"
```

---

## Task 4: เปิดดูเทอมเก่า และปลดล็อกเทอม

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/terms.py` (เพิ่ม)

**Interfaces:**
- Consumes: Task 1 ทั้งหมด · `_unpack` · `_require_db`
- Produces:
  - `GET /api/terms/{term_id}/data` → สำเนาที่เก็บไว้ของเทอมนั้น (ผลของ `_unpack(_term_blob(term_id))`) · 404 เมื่อไม่มีแถวนี้ · **ไม่แตะตัวแปรข้อมูลบนเซิร์ฟเวอร์เลย** — เป็นแค่การอ่าน
  - `unlock_check(term: dict[str, Any], typed: str) -> str | None` — ฟังก์ชันล้วน คืนข้อความไทยเมื่อปลดล็อกไม่ได้ คืน `None` เมื่อได้ กฎ: `term["status"] != "closed"` → `"เทอมนี้ไม่ได้ปิดอยู่"` · `typed.strip() != term["label"]` → `"พิมพ์ชื่อเทอมให้ตรงก่อน"`
  - `POST /api/terms/{term_id}/unlock` รับ `{"confirm": str}` → `{"active": {...meta}, "closed": {...meta} | None}` — ปิดเทอมที่ `active` อยู่ตอนนั้น (ถ้ามี) เอาสำเนาของเทอมที่ปลดเข้าระบบด้วย `_apply_snapshot(_unpack(...))` ตั้งสถานะเทอมนั้นเป็น `"active"` ตั้ง `CURRENT_TERM` แล้ว `_save_state()`
  - `_TERM_LOG_SCHEMA: str` และ `_term_log(term_id: int, action: str, detail: str) -> None` — ตาราง `app_term_log` คอลัมน์ `id bigserial`, `term_id bigint`, `action text`, `detail text`, `at timestamptz NOT NULL DEFAULT now()` · `GET /api/terms/log` คืนรายการใหม่สุดก่อน

เขียน log ทุกครั้งที่สร้างเทอม ปิดเทอม และปลดล็อก (`action` เป็น `"create"`, `"close"`, `"unlock"`)

- [ ] **Step 1: เขียนตัวทดสอบที่ยังไม่ผ่าน**

```python
def test_unlock_requires_exact_label():
    t = {"id": 3, "label": "2/2568", "status": "closed"}
    assert mock_api.unlock_check(t, "2/2568") is None
    assert mock_api.unlock_check(t, "  2/2568  ") is None
    assert mock_api.unlock_check(t, "2/2569") is not None
    assert mock_api.unlock_check(t, "") is not None

def test_unlock_refuses_a_term_that_is_not_closed():
    t = {"id": 4, "label": "1/2569", "status": "active"}
    assert mock_api.unlock_check(t, "1/2569") is not None

def test_term_data_endpoint_does_not_touch_server_state():
    mock_api._STORE_KIND = "file"
    mock_api.SLOTS[:] = [{"id": 1}, {"id": 2}]
    before = list(mock_api.SLOTS)
    try:
        mock_api.term_data(999)
    except Exception:
        pass
    assert mock_api.SLOTS == before
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd /home/claude/school-scheduler && PYTHONPATH=tests/stubs:. python3 tests/py/terms.py`
Expected: FAIL — ไม่มี `unlock_check`

- [ ] **Step 3: เขียน `GET /api/terms/{term_id}/data` (`term_data`), `unlock_check`, `POST /api/terms/{term_id}/unlock`, `_term_log` และ `GET /api/terms/log` ใน `mock_api.py`**

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /home/claude/school-scheduler && bash tests/run.sh`
Expected: ทุกไฟล์ `ok`

- [ ] **Step 5: Commit**

```bash
git add mock_api.py tests/py/terms.py
git commit -m "เทอม: อ่านสำเนาเทอมเก่า และปลดล็อกโดยพิมพ์ชื่อเทอมยืนยัน"
```

---

## Task 5: กันลบครู ห้อง และวิชา ที่เทอมเก่าใช้อยู่

**Files:**
- Modify: `mock_api.py` — endpoint `DELETE /api/teachers/{id}`, `DELETE /api/rooms/{id}`, `DELETE /api/subjects/{id}` และเพิ่มช่อง `active` ให้ครู/ห้อง/วิชา
- Test: `tests/py/termguard.py` (เพิ่ม)

**Interfaces:**
- Consumes: `_terms_list` · `_term_blob` · `_unpack`
- Produces:
  - `_term_entity_index() -> dict[str, set[int]]` — ไล่ไฟล์เทอมที่ `status == "closed"` ทุกไฟล์ แล้วคืน `{"teachers": {...}, "rooms": {...}, "subjects": {...}}` ของรหัสที่มีคาบอ้างถึง · แคชไว้ในตัวแปรโมดูล `_ENTITY_INDEX` และล้างเมื่อสร้างหรือปลดล็อกเทอม · **ไฟล์เทอมที่อ่านไม่ออกหรือคีย์หายให้ข้ามไป ไม่ยกข้อผิดพลาด** (Review Focus 5)
  - `entity_delete_block(kind: str, entity_id: int, index: dict[str, set[int]], label: str) -> str | None` — ฟังก์ชันล้วน คืน `f"{label} มีคาบอยู่ในเทอมที่ปิดแล้ว ลบไม่ได้ — ให้ทำเครื่องหมายว่าไม่ปฏิบัติงานแล้วแทน"` เมื่อ `entity_id in index.get(kind, set())` ไม่งั้น `None`
  - ช่อง `"active": bool` ใน dict ของครู ห้อง และวิชา — ค่าเริ่มต้น `True` และ endpoint `PUT` ที่มีอยู่แล้วของทั้งสามอย่างรับค่านี้ได้

> **ข้อทดสอบ 16 ของสเปกผ่านฟรี** — "ครูที่ทำเครื่องหมายไม่ปฏิบัติงานแล้ว ยังแสดงชื่อถูกต้องในตารางเทอมเก่า" เป็นจริงอยู่แล้วเพราะไฟล์เทอมเก็บทะเบียนครูของตัวเองไว้ในสำเนา (`_snapshot()` มีคีย์ `"teachers"`) การเปิดดูเทอมเก่าจึงอ่านชื่อครูจากสำเนานั้น ไม่ใช่จากทะเบียนปัจจุบัน ให้ยืนยันด้วยมือตอนตรวจก่อนปล่อยใช้ ไม่ต้องเขียนโค้ดเพิ่ม

การลบที่ถูกปฏิเสธตอบ `HTTPException(409, msg)`

- [ ] **Step 1: เขียนตัวทดสอบที่ยังไม่ผ่าน**

```python
def test_delete_blocked_when_a_closed_term_uses_it():
    idx = {"teachers": {5}, "rooms": set(), "subjects": set()}
    msg = mock_api.entity_delete_block("teachers", 5, idx, "ครูสมชาย")
    assert msg is not None and "ไม่ปฏิบัติงานแล้ว" in msg and "ครูสมชาย" in msg

def test_delete_allowed_when_no_closed_term_uses_it():
    idx = {"teachers": {5}, "rooms": set(), "subjects": set()}
    assert mock_api.entity_delete_block("teachers", 6, idx, "ครูสมหญิง") is None
    assert mock_api.entity_delete_block("rooms", 5, idx, "ห้อง 101") is None

def test_index_skips_unreadable_term_files():
    # ไฟล์เทอมที่อ่านไม่ออก หรือ slot ที่ไม่มีคีย์ที่คาด ต้องไม่ทำให้พัง
    mock_api._STORE_KIND = "file"
    idx = mock_api._term_entity_index()
    assert set(idx) == {"teachers", "rooms", "subjects"}
    assert all(isinstance(v, set) for v in idx.values())
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd /home/claude/school-scheduler && PYTHONPATH=tests/stubs:. python3 tests/py/termguard.py`
Expected: FAIL — ไม่มี `entity_delete_block`

- [ ] **Step 3: เขียน `_term_entity_index`, `entity_delete_block` ต่อเข้า endpoint ลบทั้งสามตัว และเพิ่มช่อง `active`**

รหัสห้องของคาบหนึ่งอาจอยู่หลายที่ ใช้ `_slot_rooms()` ที่มีอยู่แล้วเพื่อเก็บให้ครบ ส่วนรหัสครูต้องรวมครูสอนร่วมและครูของตัวเลือกคาบเสรีด้วย

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /home/claude/school-scheduler && bash tests/run.sh`
Expected: ทุกไฟล์ `ok`

- [ ] **Step 5: Commit**

```bash
git add mock_api.py tests/py/termguard.py
git commit -m "เทอม: ลบครู/ห้อง/วิชาที่เทอมเก่าใช้อยู่ไม่ได้ ใช้ 'ไม่ปฏิบัติงานแล้ว' แทน"
```

---

## Task 6: สถิติย้อนหลัง

**Files:**
- Modify: `mock_api.py`
- Test: `tests/py/terms.py` (เพิ่ม)

**Interfaces:**
- Consumes: `_terms_list` · `_term_blob` · `_unpack`
- Produces:
  - `term_stats_of(snapshot: dict[str, Any]) -> dict[str, Any]` — ฟังก์ชันล้วน รับสำเนาหนึ่งเทอม คืน `{"slots": int, "by_department": {ชื่อกลุ่มสาระ: จำนวนคาบ}, "by_teacher": {รหัสครู: จำนวนคาบ}, "rooms_used": int, "subjects_open": int}` · คีย์ที่หายไปในสำเนาถือเป็นว่าง ไม่ยกข้อผิดพลาด
  - `GET /api/terms/stats` → `{"terms": [{"id", "label", **term_stats_of(...)}]}` ของทุกเทอมเรียงเก่าไปใหม่

- [ ] **Step 1: เขียนตัวทดสอบที่ยังไม่ผ่าน**

```python
def test_stats_counts_periods_per_teacher_and_department():
    snap = {
        "departments": [{"id": 1, "name": "ภาษาไทย"}, {"id": 2, "name": "คณิตศาสตร์"}],
        "teachers": [{"id": 10, "department_id": 1}, {"id": 11, "department_id": 2}],
        "rooms": [{"id": 1}, {"id": 2}, {"id": 3}],
        "subjects": [{"id": 100}, {"id": 101}],
        "slots": [
            {"id": 1, "teacher_id": 10, "room_id": 1, "subject_id": 100},
            {"id": 2, "teacher_id": 10, "room_id": 1, "subject_id": 100},
            {"id": 3, "teacher_id": 11, "room_id": 2, "subject_id": 101},
        ],
    }
    out = mock_api.term_stats_of(snap)
    assert out["slots"] == 3
    assert out["by_teacher"][10] == 2
    assert out["by_department"]["ภาษาไทย"] == 2
    assert out["by_department"]["คณิตศาสตร์"] == 1
    assert out["rooms_used"] == 2        # ห้อง 3 ไม่ถูกใช้
    assert out["subjects_open"] == 2

def test_stats_of_an_empty_or_partial_snapshot():
    assert mock_api.term_stats_of({})["slots"] == 0
    assert mock_api.term_stats_of({"slots": [{"id": 1}]})["slots"] == 1
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd /home/claude/school-scheduler && PYTHONPATH=tests/stubs:. python3 tests/py/terms.py`
Expected: FAIL — ไม่มี `term_stats_of`

- [ ] **Step 3: เขียน `term_stats_of` และ `GET /api/terms/stats` ใน `mock_api.py`**

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /home/claude/school-scheduler && bash tests/run.sh`
Expected: ทุกไฟล์ `ok`

- [ ] **Step 5: Commit**

```bash
git add mock_api.py tests/py/terms.py
git commit -m "เทอม: สถิติย้อนหลัง — คาบรวม รายกลุ่มสาระ รายครู การใช้ห้อง"
```

---

## Task 7: ฟังก์ชันล้วนฝั่งหน้าเว็บ และสถานะเทอมในร้าน

**Files:**
- Create: `frontend/src/utils/terms.ts`
- Create: `tests/ts/terms.ts`
- Modify: `frontend/src/api/client.ts` · `frontend/src/store/timetableStore.ts`

**Interfaces:**
- Consumes: endpoint จาก Task 1–6
- Produces ใน `frontend/src/utils/terms.ts`:
  - `export type TermStatus = "active" | "closed";`
  - `export interface TermMeta { id: number; year: number; semester: number; label: string; status: TermStatus; slots: number | null; opened_at: string | null; closed_at: string | null; bytes: number; }`
  - `export function termLabel(year: number, semester: number): string` — `` `${semester}/${year}` ``
  - `export function sortTerms(terms: TermMeta[]): TermMeta[]` — ใหม่สุดก่อน เรียงด้วย `year` แล้ว `semester` ไม่แก้อาร์เรย์ที่รับมา
  - `export function activeTerm(terms: TermMeta[]): TermMeta | undefined`
  - `export function canEdit(viewing: TermMeta | null, active: TermMeta | null): boolean` — `true` เมื่อ `viewing` เป็น `null` (ยังไม่มีระบบเทอม หรือกำลังดูเทอมที่ใช้งานอยู่) หรือเมื่อ `viewing.id === active?.id && viewing.status === "active"`
  - `export function shouldPoll(viewingClosed: boolean, dataState: DataState): boolean` — `false` เมื่อ `viewingClosed` เป็น `true` (Review Focus 2) · นอกนั้นคืนเงื่อนไขเดิมของร้าน · `DataState` นำเข้าจาก `../utils/serverWake` ด้วย `import type`
  - `export function termBanner(viewing: TermMeta | null, active: TermMeta | null): string | null` — คืนข้อความไทยที่ติดบนหัวจอ `` `เทอม ${viewing.label} · ปิดแล้ว ดูและปริ้นได้เท่านั้น` `` เมื่อกำลังดูเทอมที่ปิด · คืน `null` เมื่อกำลังทำงานในเทอมที่ใช้งานอยู่ หรือยังไม่มีระบบเทอม
  - `export function nextTerm(active: TermMeta | null): { year: number; semester: number }` — ภาคเรียน 1 → 2 ปีเดิม · ภาคเรียน 2 → 1 ปีถัดไป · ไม่มีเทอมเลย → `{ year: 0, semester: 1 }` ให้ผู้ใช้กรอกเอง
- Produces ใน `frontend/src/api/client.ts`: `fetchTerms`, `fetchTermPreview`, `createTerm`, `fetchTermData`, `unlockTerm`, `fetchTermStats`, `fetchTermLog`
- Produces ในร้าน: `terms: TermMeta[]` · `viewingTerm: TermMeta | null` · `loadTerms()` · `openTerm(id: number)` · `closeViewing()` · `makeNewTerm(year, semester)`

`openTerm(id)` เรียก `fetchTermData(id)` แล้วเอาสำเนาที่ได้ลงร้านตรง ๆ (`groups`, `teachers`, `subjects`, `rooms`, `requirements`, `slots`, `periods`, `departments`, `buildings`) ตั้ง `viewingTerm` แล้วหยุดตัวจับเวลาซิงค์สด · `closeViewing()` ตั้ง `viewingTerm` เป็น `null` แล้วเรียก `loadAll()` กับเริ่มซิงค์สดใหม่

- [ ] **Step 1: เขียนตัวทดสอบที่ยังไม่ผ่าน**

สร้าง `tests/ts/terms.ts` ตามรูปแบบของ `tests/ts/printsheet.ts`:

```ts
const ACTIVE: TermMeta = { id: 4, year: 2569, semester: 1, label: "1/2569",
  status: "active", slots: 2735, opened_at: null, closed_at: null, bytes: 0 };
const CLOSED: TermMeta = { id: 3, year: 2568, semester: 2, label: "2/2568",
  status: "closed", slots: 2680, opened_at: null, closed_at: null, bytes: 0 };

eq(termLabel(2569, 1), "1/2569");
eq(sortTerms([CLOSED, ACTIVE])[0].id, 4);
eq(sortTerms([ACTIVE, CLOSED]).map(t => t.id).join(","), "4,3");

// ยังไม่มีระบบเทอมเลย ต้องแก้ได้เหมือนเดิมทุกอย่าง
eq(canEdit(null, null), true);
eq(canEdit(ACTIVE, ACTIVE), true);
eq(canEdit(CLOSED, ACTIVE), false);

// Review Focus 2 — ซิงค์สดต้องหยุดตอนดูเทอมที่ปิด ไม่งั้นจะดึงเทอมปัจจุบันมาทับ
eq(shouldPoll(true, "ready"), false);
eq(shouldPoll(false, "ready"), true);

eq(termBanner(CLOSED, ACTIVE)?.includes("2/2568"), true);
eq(termBanner(CLOSED, ACTIVE)?.includes("ปิดแล้ว"), true);
eq(termBanner(ACTIVE, ACTIVE), null);
eq(termBanner(null, null), null);

eq(JSON.stringify(nextTerm(ACTIVE)), JSON.stringify({ year: 2569, semester: 2 }));
eq(JSON.stringify(nextTerm(CLOSED)), JSON.stringify({ year: 2569, semester: 1 }));
eq(nextTerm(null).semester, 1);
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd /home/claude/school-scheduler/tests && node --import ./register.mjs ts/terms.ts`
Expected: FAIL — หาไฟล์ `../frontend/src/utils/terms` ไม่เจอ

- [ ] **Step 3: เขียน `frontend/src/utils/terms.ts` ตาม Interfaces ข้างบน แล้วเพิ่มฟังก์ชันเรียก endpoint ใน `api/client.ts` และสถานะเทอมในร้าน**

ลอกรูปแบบฟังก์ชันเรียก endpoint จากกลุ่ม `/state/history` ใน `api/client.ts` (บรรทัด 1050–1062)
ในร้าน จุดที่ต้องแก้คือตัวตัดสินว่าจะตั้งตัวจับเวลาซิงค์สดไหม ให้เรียก `shouldPoll` แทนเงื่อนไขเดิม

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /home/claude/school-scheduler && bash tests/run.sh && cd frontend && npm run lint`
Expected: ทุกไฟล์ `ok` · lint ไม่มีข้อผิดพลาด

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/terms.ts frontend/src/api/client.ts frontend/src/store/timetableStore.ts tests/ts/terms.ts
git commit -m "เทอม: ฟังก์ชันล้วนฝั่งหน้าเว็บ และหยุดซิงค์สดตอนดูเทอมที่ปิดแล้ว"
```

---

## Task 8: หน้ารายการเทอม หน้าสรุปก่อนสร้าง และสถิติ

**Files:**
- Create: `frontend/src/components/terms/TermsPanel.tsx` · `NewTermModal.tsx` · `TermStatsPanel.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx` (เพิ่มแท็บหรือส่วนของเทอม ตามรูปแบบที่หน้านี้ใช้อยู่)

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 7 — `TermMeta`, `sortTerms`, `activeTerm`, `nextTerm`, `canEdit` และฟังก์ชันในร้าน

หน้าจอต้องมีสามอย่างนี้ตามสเปกส่วนที่ 8

1. **รายการเทอม** — คอลัมน์ ชื่อเทอม · สถานะ (`ใช้งานอยู่ · แก้ได้` / `ปิดแล้ว · อ่านอย่างเดียว`) · คาบที่ลงแล้ว · แก้ครั้งสุดท้าย · ขนาด และปุ่ม `เปิดดู` `ปริ้น` `ดาวน์โหลด` สำหรับเทอมที่ปิด กับ `ปลดล็อกเทอม` ที่ขอให้พิมพ์ชื่อเทอมยืนยัน
2. **หน้าสรุปก่อนสร้างเทอมใหม่** — แสดงผลจาก `GET /api/terms/preview` (แผนการสอนกี่รายการ · ครูกี่คน · คาบรวมเท่าไหร่) ช่องกรอกปีและภาคเรียนที่เติมค่าจาก `nextTerm()` มาให้ และ **คำเตือนเป็นตัวหนาว่า "กดแล้วเทอม X จะถูกปิดและแก้ไม่ได้อีก · คาบที่ลงไว้ทั้งหมดของเทอมใหม่จะเริ่มจากว่าง"** ปุ่มยืนยันต้องกดได้ครั้งเดียว ปิดปุ่มทันทีที่กด (Review Focus 3)
3. **สถิติย้อนหลัง** — ตารางจาก `GET /api/terms/stats` เทียบเทอมเรียงตามเวลา

เมื่อ `GET /api/terms` ตอบ `available: false` ให้ทั้งสามส่วนแสดงข้อความเดียวว่ายังไม่ได้ต่อฐานข้อมูลจึงใช้ระบบเทอมไม่ได้ และไม่แสดงปุ่มใด ๆ (Review Focus 4)

- [ ] **Step 1: เขียน `TermsPanel.tsx` โดยลอกโครงจาก `frontend/src/components/backup/ServerHistoryPanel.tsx`**

- [ ] **Step 2: เขียน `NewTermModal.tsx` โดยลอกโครงหน้าต่างจาก `frontend/src/components/common/ModalShell.tsx` ที่หน้าต่างอื่นใช้อยู่**

- [ ] **Step 3: เขียน `TermStatsPanel.tsx`**

- [ ] **Step 4: ต่อทั้งสามเข้า `Dashboard.tsx`**

- [ ] **Step 5: ตรวจว่าคอมไพล์และ lint ผ่าน**

Run: `cd /home/claude/school-scheduler/frontend && npm run lint && npx tsc --noEmit -p tsconfig.json`
Expected: ไม่มีข้อผิดพลาด · ถ้า `tsc` บ่นเรื่องที่มีอยู่ก่อนแล้ว ให้เทียบจำนวนข้อผิดพลาดกับก่อนแก้ ต้องไม่เพิ่มขึ้น

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/terms frontend/src/pages/Dashboard.tsx
git commit -m "เทอม: หน้ารายการเทอม หน้าสรุปก่อนสร้าง และสถิติย้อนหลัง"
```

---

## Task 9: โหมดอ่านอย่างเดียวบนหน้าจอ และชื่อเทอมบนใบพิมพ์

**Files:**
- Modify: `frontend/src/components/layout/TopNavbar.tsx` — แถบชื่อเทอมและคำเตือน
- Modify: `frontend/src/utils/printSheet.ts` — ชื่อเทอมในแบบฟอร์ม
- Modify: `frontend/src/components/print/PrintView.tsx` · `WorkloadReport.tsx` — แสดงชื่อเทอมบนกระดาษ
- Modify: `frontend/src/components/timetable/TimetableGrid.tsx` · `SlotCell.tsx` — ปิดการลาก
- Test: `tests/ts/terms.ts` (เพิ่ม) · `tests/ts/printsheet.ts` (เพิ่ม)

**Interfaces:**
- Consumes: `canEdit`, `termBanner` (Task 7) · `SheetSetup`, `normalizeSheet`, `fillTemplate` (`printSheet.ts` ที่มีอยู่)
- Produces:
  - ช่อง `term?: string` ใน `SheetSetup` และ `normalizeSheet` คงค่าเดิมไว้เมื่อไม่มีช่องนี้ (ไฟล์ตั้งค่าที่บันทึกไว้ก่อนหน้านี้ต้องใช้ได้)
  - โทเคน `{เทอม}` ใน `fillTemplate` แทนด้วยชื่อเทอมที่กำลังดูอยู่
  - `TimetableGrid` และ `SlotCell` รับ prop `readOnly: boolean` และเมื่อเป็น `true` ไม่ตั้ง dnd-kit listener และไม่แสดงปุ่มลบหรือเมนูแก้

- [ ] **Step 1: เขียนตัวทดสอบที่ยังไม่ผ่าน**

เพิ่มใน `tests/ts/printsheet.ts`:

```ts
// แบบฟอร์มที่บันทึกไว้ก่อนมีช่องเทอม ต้องยังใช้ได้
eq(normalizeSheet({}).term, undefined);
eq(normalizeSheet({ term: "1/2569" }).term, "1/2569");
eq(fillTemplate("ตารางเรียน ภาคเรียนที่ {เทอม}", { term: "1/2569" }),
   "ตารางเรียน ภาคเรียนที่ 1/2569");
// ไม่มีชื่อเทอม (ยังไม่เคยสร้างเทอม) ต้องไม่พิมพ์คำว่า undefined ลงกระดาษ
eq(fillTemplate("ตารางเรียน {เทอม}", {}).includes("undefined"), false);
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd /home/claude/school-scheduler/tests && node --import ./register.mjs ts/printsheet.ts`
Expected: FAIL — `term` ไม่มีใน `SheetSetup`

- [ ] **Step 3: เพิ่มช่อง `term` และโทเคน `{เทอม}` ใน `printSheet.ts` แล้วส่งชื่อเทอมจากร้านเข้า `PrintView` และ `WorkloadReport`**

ชื่อเทอมต้องมาจากเทอมที่ **กำลังดูอยู่** ไม่ใช่เทอมที่ใช้งานอยู่ (ข้อทดสอบ 17 ของสเปก)

- [ ] **Step 4: เพิ่ม prop `readOnly` เข้า `TimetableGrid` และ `SlotCell` และแถบคำเตือนใน `TopNavbar`**

ค่าของ `readOnly` มาจาก `!canEdit(viewingTerm, activeTerm(terms) ?? null)` · ข้อความแถบมาจาก `termBanner(...)` และแถบต้องติดค้างอยู่ ไม่ใช่หายไปเองหลังสองวินาที

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd /home/claude/school-scheduler && bash tests/run.sh && cd frontend && npm run lint`
Expected: ทุกไฟล์ `ok` · lint ไม่มีข้อผิดพลาด

- [ ] **Step 6: Commit**

```bash
git add frontend/src tests/ts
git commit -m "เทอม: โหมดอ่านอย่างเดียวบนหน้าจอ และชื่อเทอมบนใบพิมพ์ทุกใบ"
```

---

## ตรวจก่อนปล่อยใช้

ข้อทดสอบ 11–20 ของสเปกส่วนที่ 11 ข้อที่ตัวทดสอบอัตโนมัติครอบไม่ได้ ต้องลองด้วยมือบนเซิร์ฟเวอร์จริงที่ต่อฐานข้อมูลแล้ว

- [ ] นับคาบของเทอมปัจจุบันไว้ → กดสร้างเทอมใหม่ → เปิดดูเทอมที่เพิ่งปิด → **จำนวนคาบต้องเท่าเดิมทุกคาบ** (ข้อ 11)
- [ ] เทอมใหม่มี 0 คาบ แต่แผนการสอนและหลักสูตรครบ (ข้อ 12)
- [ ] สลับเปิดดูเทอมเก่า ↔ เทอมปัจจุบัน สามรอบ ข้อมูลทั้งสองยังครบ (ข้อ 13)
- [ ] **เปิดดูเทอมเก่าในเบราว์เซอร์หนึ่ง อีกเบราว์เซอร์ที่จัดตารางเทอมปัจจุบันอยู่ไม่รู้สึกอะไร** (ข้อ 13ก)
- [ ] ส่งคำขอแก้ไขตรงไปที่เซิร์ฟเวอร์ตอนเทอมปิด — ต้องถูกปฏิเสธ (ข้อ 14)
- [ ] ปริ้นใบทั้งสี่แบบของเทอมเก่า ชื่อเทอมบนกระดาษต้องเป็นเทอมที่เปิดดู (ข้อ 17)
