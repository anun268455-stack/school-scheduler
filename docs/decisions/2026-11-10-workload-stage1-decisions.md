<!-- สำเนาสมุดงาน (ledger) ของ subagent-driven-development สำหรับแผนขั้นที่ 1 ของเว็บลงอัตรากำลัง — ต้นฉบับอยู่ใต้ .superpowers/ ซึ่ง .gitignore กันไว้และหายไปพร้อมเครื่องชั่วคราว บรรทัดที่มีคำว่า Ruling คือการตัดสินใจที่ทำแทนผู้ใช้ระหว่างทำ พร้อมราคาถ้าตัดสินผิด · บรรทัดที่มี minor (deferred หรือ parked คือของที่รู้แล้วว่ายังไม่ได้แก้ -->

# SDD ledger — plan: docs/superpowers/plans/2026-11-08-workload-site-stage1.md

Spec: docs/superpowers/specs/2026-11-06-workload-entry-site-design.md (read in full, 9 Nov)
Branch: claude/claude-code-workload-status-z0w49p · started from origin/term-layer @ 9cd6801 (MERGE_BASE for final review)
Baseline: bash tests/run.sh → ผ่าน 9 · ไม่ผ่าน 0
Local integration rig (git-ignored): pg/pg.sh (Postgres 16 ทดลอง) · pg/server.sh (fastapi จริง ที่ :18000) · venv/

## Pre-flight scan

| คู่/ตัว | ผลิต vs ใช้ | พบอะไร |
|---|---|---|
| T1→T2 | `_wl_schema`, ตาราง wl_codes/wl_sessions | wl_sessions ไม่มีช่อง salt → แฮช token ต้องไม่ใส่เกลือ (R2) · แผนไม่บังคับ "หนึ่งกลุ่มหนึ่งรหัส" ที่ฐานข้อมูล (R4) |
| T1→T3 | ตาราง wl_teachers/wl_subjects · `_db_write_blocked` | แผนบอกว่าใช้ `_db_write_blocked` แต่ไม่บอกที่ไหน → ที่ปุ่มดึงครู (R13) |
| T2→T3 | `wl_session_role(token)` | แผนไม่บอกว่า token เดินทางยังไง (R1) |
| T2→T5 | login คืน department_id · Session ใช้ departmentId | แผนตั้งใจ แปลงที่ api.ts ที่เดียว — ไม่ขัด |
| T2→T7 | route รหัสเข้า vs หน้า "ตั้งรหัสครั้งแรก" | ไม่มีทางสร้างรหัส admin ใบแรก: POST /codes ต้องเป็น admin (R3) |
| T3→T6 | route ทะเบียน + ดึงครู | T6 ต้องมีหน้าสรุปก่อนเขียน แต่ T3 มีแต่ POST (R6) · ชนิด Teacher/Subject ไม่มีช่อง active (R9) |
| T4→T5/6/7 | โครง workload/ | check.yml build แค่ frontend/ — เว็บใหม่ไม่ถูกตรวจใน CI (R8) |
| T4↔deploy.yml | workload.yml เขียน gh-pages/workload | deploy.yml ไม่มี keep_files → deploy เว็บหลักครั้งถัดไปลบ /workload/ ทิ้ง (R7) |
| T1 เอง | ทดสอบ vs โค้ด | สอดคล้อง (9+1 = ผ่าน 10) |
| T2 เอง | `test_expired_session_is_not_found` | สร้างแถวด้วย wl_hash("tok", b"s") — ผ่านแบบว่างเปล่าถ้า token แฮชคนละวิธี (R2) · `_past()` ไม่ได้นิยาม (ผู้ทำนิยามเอง) |
| T3 เอง | `test_scheduler_only_fields_are_refused` | ตัวทดสอบมีแต่คอมเมนต์ ไม่ assert อะไร (R5) · คืน created/linked/skipped แต่ wl_import_plan คืน create/already (R6) |
| T4 เอง | Step 4 `gh run list` | ไม่มี gh ที่นี่ — ผู้คุมดู CI ผ่าน GitHub API หลัง push (R8) · ลิงก์ /workload/ ขึ้นจริงหลัง merge เข้า main เท่านั้น |
| T5 เอง | `test/eq/deepEq` | ไม่มีในของเดิม — นิยามในไฟล์ทดสอบ · loginError ไม่มีตัวทดสอบในแผน → เพิ่ม |
| T6 เอง | Pick<Teacher,…> | (R9) |
| T7 เอง | "ข้อ 5 · 6 · 3" ของสเปกส่วนที่ 11 | หมายถึง 10จ · 10ฉ · 10ค |

## Rulings (ก่อนเริ่ม)

- R0 Ruling: ทำบนสาขา claude/claude-code-workload-status-z0w49p ที่ตั้งต้นจาก term-layer ไม่ push เข้า term-layer/main — สาขานี้คือสาขาที่ session กำหนด — ถ้าผิด: ย้ายคอมมิตด้วย fast-forward ครั้งเดียว · main มีคอมมิต f4e0723 (แก้สเปกอย่างเดียว) ที่ term-layer ไม่มีและชนกับสเปกบน term-layer ปล่อยไว้ไม่แตะ
- R1 Ruling: token ส่งทางหัวข้อ `Authorization: Bearer <token>` · route รับ `request: Request` · เพิ่ม `Request` ใน tests/stubs/fastapi — แผนไม่ได้ระบุ — ถ้าผิด: เปลี่ยนชื่อหัวข้อสองไฟล์
- R2 Ruling: wl_sessions เก็บ `wl_token_hash(token)` = sha256 ไม่ใช่ PBKDF2 (token สุ่ม 256 บิต · ต้องค้นด้วยคีย์หลักได้ · PBKDF2 ทุกคำขอกิน CPU ของ Render) และตัวทดสอบ session หมดอายุต้องสร้างแถวด้วย wl_token_hash พร้อมตัวเทียบที่ยังไม่หมดอายุ — แผนเขียน wl_hash("tok", b"s") ซึ่งผ่านแบบว่างเปล่า — ถ้าผิด: เปลี่ยนฟังก์ชันเดียว
- R3 Ruling: รหัส admin ใบแรกตั้งผ่าน `POST /api/workload/setup` ที่ต้องส่ง "รหัสตั้งค่า" ตรงกับตัวแปร `WORKLOAD_SETUP_CODE` ที่ผู้ใช้กรอกเองใน Environment ของ Render (แบบเดียวกับ DATABASE_URL) · ตั้งซ้ำได้ = ทางกู้เมื่อลืมรหัส admin · health บอก `needs_setup` — แผนไม่มีทางสร้างรหัสใบแรกเลย — ถ้าผิด: route หนึ่งตัวกับฟอร์มหนึ่งฟอร์มต้องทำใหม่ · ใครรู้รหัสตั้งค่าก็ยึด admin ของเว็บใหม่ได้ (คู่มือจึงบอกให้ลบตัวแปรออกหลังตั้งเสร็จ)
- R4 Ruling: ฐานข้อมูลบังคับ admin แถวเดียว และหนึ่งแถวต่อกลุ่มสาระ (partial unique index) · ตั้งรหัสที่ซ้ำกับแถวอื่นได้ 409 · รหัสสั้นกว่า 6 ตัวอักษรได้ 400 · ปิด/ตั้งรหัสใหม่แล้ว session เดิมของรหัสนั้นใช้ไม่ได้ทันที — สเปกบอก "กลุ่มสาระละหนึ่งรหัส" และ "admin ปิดรหัสได้" ถ้ารหัสซ้ำกัน หัวหน้ากลุ่ม ข จะล็อกอินเป็นกลุ่ม ก — ถ้าผิด: ลบ index/ค่าคงที่
- R5 Ruling: T3 ต้องมี `wl_clean_fields(body, allowed)` ที่โยน 400 ไทยพร้อมชื่อช่อง และตัวทดสอบต้อง assert จริง — แผนเขียนตัวทดสอบว่างไว้ — ถ้าผิด: ไม่มีราคา
- R6 Ruling: เพิ่ม `GET /api/workload/teachers/import-from-scheduler` คืนตัวเลขเดียวกับ POST โดยไม่เขียน · created = ครูฝั่งตารางที่ยังไม่มีแถว · linked = มีแล้ว (เทียบ sched_id) · skipped = แถวฝั่งตารางที่ไม่มี id เป็นจำนวนเต็ม · คัดลอก name code department_id dept_order active — T6 ต้องมีหน้าสรุปก่อนเขียน — ถ้าผิด: route อ่านอย่างเดียวหนึ่งตัว
- R7 Ruling: deploy.yml เพิ่มขั้น "เก็บ workload/ ของเดิมจาก gh-pages เข้า dist ก่อนเผยแพร่" และ deploy.yml กับ workload.yml ใช้ concurrency group เดียวกัน ไม่ใช้ keep_files:true กับเว็บหลัก (ไฟล์เก่าจะสะสมไม่สิ้นสุด) · ไม่เก็บ /preview/ (พรีวิวเก่าที่เขียนฐานข้อมูลจริงได้คืออันตราย และเป็นพฤติกรรมเดิมอยู่แล้ว) — แผนเพิ่มแค่ paths-ignore ซึ่งทำให้ลิงก์เว็บใหม่หายทุกครั้งที่เว็บหลัก deploy — ถ้าผิด: ขั้นตอน deploy ของเว็บหลักเพิ่มหนึ่งขั้น ถ้าขั้นนั้นพัง deploy แดงและเว็บเดิมยังอยู่
- R8 Ruling: T4 เพิ่ม lint+build ของ workload/ ใน check.yml · ขั้น "ดู CI" ของทุก task ผู้คุมทำเองหลัง push — ไม่งั้นด่านชนิดของ T6 ไม่ถูกบังคับที่ไหนเลย — ถ้าผิด: CI ช้าลงราวหนึ่งนาที
- R9 Ruling: `WlTeacher = Pick<Teacher,"name"|"code"|"department_id"|"dept_order"> & {id; sched_id; active}` (วิชาแบบเดียวกัน) — ชนิดเดิมไม่มี active จึง Pick ไม่ได้ — ถ้าผิด: ไม่มีราคา
- R10 Ruling: คง PBKDF2 200,000 รอบและเกลือรายแถวตามแผน แม้ล็อกอินหนึ่งครั้งต้องลองทุกแถว (สูงสุด 12 แฮช) และไม่เพิ่มตัวจำกัดจำนวนครั้ง — เป็นค่าที่แผนกำหนด และเว็บตารางเองเปิดโล่งอยู่แล้ว — ถ้าผิด: บน Render ฟรี รหัสผิดอาจรอหลายวินาที · เดารหัสได้ไม่จำกัดครั้ง
- R11 Ruling: ไม่ทำปุ่มดึงวิชาจากโปรแกรมจัดตาราง ทะเบียนวิชาของเว็บใหม่เริ่มว่าง — สเปกและแผนพูดถึงครูเท่านั้น — ถ้าผิด: ขั้นที่ 3 จะสร้างวิชาซ้ำในเว็บตารางสำหรับวิชาที่พิมพ์เองแต่มีอยู่แล้ว (ต้องถามผู้ใช้ก่อนเขียนแผนขั้นที่ 3)
- R13 Ruling: ปุ่มดึงครู (GET และ POST) ปฏิเสธ 503 เมื่อ `_db_write_blocked()` — ตอนนั้นครูในหน่วยความจำคือข้อมูลตั้งต้นที่มากับโค้ด ไม่ใช่ของโรงเรียน ดึงเข้ามาจะได้ครูผิดชุดพร้อมรหัสผิด — ถ้าผิด: ไม่มีราคา

## Log
- Task 1: implementer a07a6b9639271fee9 (sonnet) → cbf9103 · reviewer: spec ✅ Approved, 0 Critical/Important · ⚠️ หลักฐานเซิร์ฟเวอร์จริง ผู้คุมยืนยันเองแล้ว (health 200/503 + หัวข้อ CORS + /api/state/version ไม่พังตอนไม่มีฐานข้อมูล)
- Task 1: minor (deferred): tests/py/wlguard.py คืนค่า CURRENT_TERM ด้วย update() ลบคีย์ที่เพิ่มไม่ได้
- Task 1: minor (→ ยกไป Task 2 addendum): ไม่มี CHECK ผูก role กับ department_id (head ที่ department_id NULL หลุดดัชนีได้)
- Task 1: minor (→ ยกไป Task 2 addendum): _wl_schema รัน DDL ~6 คำสั่งทุกคำขอ — ใส่ธง "สร้างแล้ว" ระดับโมดูล
- Task 1: minor (deferred): ตัวทดสอบ no-commit-on-error ใช้การเชื่อมต่อปลอมจึงไม่ได้ตรวจ rollback จริง · ตัวทดสอบ schema ตรวจแค่ข้อความ
- Task 1: complete (commits 9cd6801..cbf9103, review clean)
- Task 2: implementer a68ef0a868d69c410 (sonnet) → 94be3b9 (BASE cbf9103) · DONE_WITH_CONCERNS: (1) rig Postgres เดิมเป็น SQL_ASCII ทำให้ psycopg คืน text เป็น bytes → แก้ที่ rig (UTF8) ไม่แก้โค้ด เพราะ Neon เป็น UTF8 (2) 409 ตอนชนดัชนีพร้อมกันยังไม่ได้ลองสด (3) ไม่มีตัวจำกัดการเดารหัส (R10) · rig: server.sh เปลี่ยนเป็น pidfile
- Task 2: review dispatched (opus) agent a63ba072ae730440d — diff review-cbf9103..94be3b9.diff
- Task 2: review (opus): spec ✅ ยกเว้นช่องเล็ก (body ไม่ใช่ dict → 422 อังกฤษ ไม่ใช่ 401/ไทย) · Important ×1: ไม่จำกัดจำนวนครั้งของ login/setup บนเซิร์ฟเวอร์ที่เปิดทุกต้นทาง (CPU ของเครื่องที่เว็บตารางใช้ร่วม + เดารหัสตั้งค่าได้เร็ว)
- R10b Ruling (กลับ R10): รับข้อค้นพบ — แฮชตอน login ทำทีละหนึ่งคำขอ (Semaphore) · จำกัดความล้มเหลวรวมทั้งเครื่อง: login 10 ครั้ง/60 วินาที, setup 5 ครั้ง/600 วินาที เกินแล้วตอบ 429 ไทยโดยไม่แฮช · ปฏิเสธ setup เมื่อ WORKLOAD_SETUP_CODE สั้นกว่า 12 ตัวอักษร — ข้อค้นพบชนะ R10 เพราะข้อห้ามของผู้ใช้ ("ไม่กระทบงานตารางสอน") อยู่เหนือค่าที่แผนเลือก และ R10 ประเมิน CPU ต่ำไป · ใช้ตัวนับรวมทั้งเครื่อง ไม่ใช่ราย IP เพราะหลัง proxy ของ Render IP ปลอมได้ — ถ้าผิด: คนที่ตั้งใจกวนทำให้ล็อกอินใหม่ไม่ได้ชั่วคราว (คนที่ล็อกอินอยู่แล้วไม่กระทบ) · ครูพิมพ์ผิดรวมกัน 10 ครั้งในหนึ่งนาทีต้องรอหนึ่งนาที
- Task 2: minor (deferred): กติกา "รหัสห้ามซ้ำ" เป็น check-then-write ไม่มีด่านที่ฐานข้อมูล (admin สองคนเขียนพร้อมกัน) — แนะนำ LOCK TABLE wl_codes
- Task 2: minor (deferred): ไม่มี unit test ของตรรกะ route (PUT ลบ session ยกเว้นผู้เรียก · ปิดแถว admin ไม่ได้ · setup สร้าง/ทับ · 23505→409) มีแต่ smoke กับของจริง
- Task 2: minor (deferred): tests/stubs/fastapi Request.headers เป็น class attribute ที่แก้ได้
- Task 2: fix round 1/5 (1 addressed, 1 open — body ผิดรูป/surrogate: ADDRESSED · ตัวจำกัด: NOT ADDRESSED เพราะคำขอพร้อมกันเป็นชุดผ่านด่านตอนลิสต์ยังว่างแล้วไปเข้าคิวที่ semaphore โดยถือ thread และการเชื่อมต่อฐานข้อมูลไว้; commits 94be3b9..e684ffd) · re-reviewer afd2eba167c897827 (sonnet)
- Task 2: minor (deferred): `label` ที่มี lone surrogate ใน POST/PUT codes น่าจะได้ 500 จาก psycopg (route ของ admin)
- Task 2: fix round 2/5 (2 addressed, 0 open; commits e684ffd..d955e43) · re-reviewer a6f642ba2d9f2eb57 (sonnet): all addressed, no new Critical/Important
- Task 2: minor (deferred): test_login_burst_is_bounded ไม่ได้ตรึงการตรวจเพดานซ้ำในประตูแฮช (เพดาน in-flight 8 อธิบายผลได้เอง) — โค้ดจริงถูก แต่ถ้าใครลบการตรวจซ้ำ ตัวทดสอบไม่จับ
- Task 2: ⚠️ จากรีวิวแรก ผู้คุมตรวจเอง: ไม่มี print/log ที่เขียน body ของคำขอใน mock_api.py · มี middleware ตัวเดียว (_bump_revision) ซึ่งไม่อ่าน body
- Task 2: complete (commits cbf9103..d955e43, review clean after 2 fix rounds)
- Task 3: implementer a3388afcf04b4eef9 (sonnet) → 7164bc8 (BASE d955e43) · DONE · ข้อสังเกต: เส้นทาง 503 ของ _db_write_blocked ครอบด้วย unit test เท่านั้น · code ครูไม่ strip · code วิชาไม่บังคับไม่ซ้ำ
- Task 3: review a5ebb69c4887a27b7 (sonnet): spec ✅ Approved, 0 Critical/Important
- Task 3: ⚠️ ผู้คุมตรวจเอง: (1) smoke ข้อ 7-9 มีหลักฐานครบใน task-3-smoke-out.txt (2) app.routes ของปลอมเก็บ (verb, path, fn) จริง (3) เส้นทาง 503 ของ _db_write_blocked: พยายามจำลองกับของจริงด้วยการทำ app_state เสีย — เซิร์ฟเวอร์ไม่ยอมเริ่มเลย (gzip.BadGzipFile ตอน import; พฤติกรรมเดิมของโปรแกรม ไม่เกี่ยวกับงานนี้) จึงเข้าสถานะนั้นไม่ได้ทางนี้ → ครอบด้วย unit test เท่านั้น
- Task 3: minor (deferred): ปุ่มดึงครูคัดลอกค่าจากเว็บตารางโดยไม่ตรวจชนิด (ค่าแปลกทำทั้งชุดล้ม 500) และ bool(active) แปลง None/"false" ไม่ตรงเจตนา
- Task 3: minor (deferred): ตัวทดสอบ no-login ของ PUT สร้างอาร์กิวเมนต์ผิดตำแหน่ง จึงไม่ได้ทดสอบเส้นทางไม่มีหัวข้อจริง · ขาดตัวทดสอบ SQL ของ POST วิชา / ORDER BY / id ขอบ
- Task 3: minor (deferred): code ของครูไม่ strip แต่ code ของวิชา strip · code วิชาไม่บังคับไม่ซ้ำ (ต้องตัดสินตอนเขียนแผนขั้นที่ 2)
- (จากผู้เขียน api-contract) minor (deferred): POST /codes ตอบ 409 "กลุ่มนี้…" แม้เป็น admin · PUT /codes {} ตอบ 200 เฉย ๆ แต่ครู/วิชาตอบ 400 · POST /codes เมินคีย์แปลก แต่ PUT ปฏิเสธ · id ใน path ที่ไม่ใช่ตัวเลขได้ 422 อังกฤษของ FastAPI
- Task 3: complete (commits d955e43..7164bc8, review clean)
- api-contract.md เขียนแล้ว (263 บรรทัด) โดย a705fb938bb54260c — ใช้เป็นสัญญาให้ Task 5-7
- Task 4: implementer a8a7a155ce7b1cfd5 (sonnet) → fb0236a (BASE 7164bc8) · DONE · ข้อสังเกต: ขั้นยก workload/ ใน deploy.yml ยังไม่เคยรันใน Actions จริง (รันได้เมื่อ merge เข้า main เท่านั้น)
- Task 4: review af6428a9660f3c323 (opus): spec ✅ · Important ×2 (ทั้งคู่อยู่ในข้อความที่แผน/ผู้คุมกำหนดเอง): (I1) ขั้นยก workload/ ใน deploy.yml เปิดเมื่อพลาด — fetch ล้มชั่วคราวถูกนับเป็น "ยังไม่มี" แล้ว deploy ลบ /workload/ เงียบ ๆ · ไม่มี pipefail (I2) keep_files: true ใน workload.yml ไม่จำเป็นและทำไฟล์เก่าสะสม
- R7b Ruling (แก้ R7): รับ I1 — ขั้นยก workload/ แยก "ไม่มีสาขา" (ls-remote คืน 2 → ข้าม) ออกจาก "อ่านไม่ได้" (หยุด deploy ด้วย exit 1) และใช้ shell: bash ให้ได้ pipefail · ผู้คุมลองสี่กรณีกับ GitHub จริงแล้ว (มีโฟลเดอร์/ไม่มีโฟลเดอร์/ไม่มีสาขา/ติดต่อไม่ได้) — หยุดดีกว่าลบ: ตอนนั้นยังไม่ได้เผยแพร่อะไร เว็บเดิมอยู่ครบ — ถ้าผิด: deploy ของเว็บหลักแดงเมื่อ GitHub สะดุด ต้องกด Re-run
- R15 Ruling: ไม่รับ I2 — คง keep_files: true ใน workload.yml ตามแผน แต่แก้คอมเมนต์ให้ตรงความจริง (destination_dir คือตัวจำกัดขอบเขต · keep_files คือชั้นสำรองที่ทำให้ไม่มีขั้นลบเลย) และเขียนราคาไว้ — แผนเลือกค่าตั้งที่พิสูจน์แล้วกับพรีวิว และข้อห้ามของผู้ใช้คือห้ามกระทบเว็บหลัก ชั้นสำรองที่ไม่พึ่งพฤติกรรมภายในของ action มีค่ากว่าความสะอาด — ถ้าผิด: ไฟล์ js/css รุ่นเก่าของเว็บใหม่สะสมใน gh-pages/workload/ ราว 0.2 MB ต่อ deploy และถูกยกตามไปทุกครั้งที่เว็บหลัก deploy
- Task 4: minor (→ ยกไป Task 5 addendum): App.tsx แสดง detail ของข้อผิดพลาดที่ไม่ใช่ 503 ได้ (เช่น "Not Found" ภาษาอังกฤษ เมื่อ Render ยังเป็นรุ่นเก่า) — ขัดข้อ "ข้อความไทยทุกข้อความ"
- Task 4: minor (รวมในรอบแก้): กลุ่ม concurrency ร่วมอาจทำให้ run ที่รอคิวถูกยกเลิก — เพิ่มคอมเมนต์บอกให้สั่ง workflow_dispatch ซ้ำ
- Task 4: minor (ไม่รับ): เพิ่ม check.yml/preview.yml/.gitignore/README เข้า paths-ignore — เกินรายการของแผน และเป็นพฤติกรรมเดิมอยู่แล้ว
- Task 4: minor (รับไว้ตามที่เป็น): สถานะ "ต่อได้" ต่อท้าย "(ยังไม่ได้ตั้งรหัสเข้าใช้งาน)" — Task 5 จะจัดหน้าล็อกอินใหม่อยู่แล้ว
- Task 4: fix round 1/5 (3 addressed, 0 open; commits fb0236a..635aad2) · re-reviewer aa90bc57a381cd929 (sonnet): all addressed, no new breakage
- Task 4: ⚠️ ที่ตรวจจาก diff ไม่ได้: ขั้นยก workload/ ยังไม่เคยรันใน Actions จริง — รันได้เมื่อ merge เข้า main เท่านั้น → ต้องบอกผู้ใช้ให้ดู log ของ deploy รอบแรก · ผู้คุมดู screenshot task-4-ok/nodb แล้ว ถูกต้อง · CI ของ fb0236a เขียว (run 42718014484 — build workload ครั้งแรกใน CI)
- Task 4: complete (commits 7164bc8..635aad2, review clean after 1 fix round)
- Task 5: implementer aa0c267c190bee698 (sonnet) → bb9e4d3 (BASE 635aad2) · DONE_WITH_CONCERNS: ข้อความ needs_setup ยังไม่ได้ลองในเบราว์เซอร์ (Task 7 จะเดินจากฐานข้อมูลว่าง) · /me ล้มที่ไม่ใช่ 401 → กลับหน้าล็อกอินแต่เก็บ session ไว้ลองใหม่ตอนโหลดหน้า
- Task 5: review a5f5291f818eddae7 (sonnet): spec ✅ · Important ×1: apiErrorText ถอยไปใช้ loginError ซึ่งเป็นคำของหน้าล็อกอิน ("เข้าสู่ระบบไม่สำเร็จ (รหัสสถานะ 500)") — ทุกหน้าใช้ตัวนี้ และบรรทัดสถานะ health ก็ซ้อนสองข้อความแล้ว
- Task 5: minor (รวมในรอบแก้ เพราะอยู่ในไฟล์เดียวกัน): ช่วงอักษรไทยใน regex พิมพ์เป็นอักขระดิบที่มองไม่เห็น → ใช้ ฀-๿ · จุลภาคเกินในตัวทดสอบ · คำตอบ /me ไม่ผ่านการตรวจรูปแบบเดียวกับค่าที่เก็บไว้ · apiErrorText ไม่มีตัวทดสอบ (ย้ายการแปลงสถานะ→ข้อความเข้า auth.ts)
- Task 5: minor (deferred): catch (err: any) · หลัง /me ล้มที่ไม่ใช่ 401 token ค้างใน sessionStorage และไม่มีปุ่มลองใหม่ (ต้องโหลดหน้า) · ช่องรหัสเสีย focus หลังผิด
- Task 5: fix round 1/5 (5 addressed, 0 open; commits bb9e4d3..5792532) · re-reviewer a49e6f85a9f840745 (sonnet): all addressed, no new breakage
- Task 5: ⚠️ ผู้คุมตรวจเอง: ดู screenshot task-5-login/admin แล้ว (ช่องรหัสช่องเดียว · คำเตือนท้ายหน้าเห็นอยู่ · แถบหัวมีปุ่มออกจากระบบ) · ข้อความ needs_setup ในเบราว์เซอร์ → Task 7 เดินจากฐานข้อมูลว่าง
- Task 5: complete (commits 635aad2..5792532, review clean after 1 fix round)
- Task 6: implementer a95819e9bf8297a93 (sonnet) → 8bf7ebc (BASE 5792532) · DONE_WITH_CONCERNS: ค่า type "common" ไม่มีคำไทยใน frontend/ จึงใช้ "ปกติ" · ลำดับวิชาหลังแก้ฝั่งหน้าเว็บอาจต่างจาก collation ของ Postgres (เรื่องหน้าตา)
- Task 6: review acc199dd0c1137ce3 (sonnet): ไม่มีฟีเจอร์ขาด ไม่ผิดข้อผูกมัด · Important ×2: (I1) ตรรกะตรวจ+payload+ช่องกรอกของครูซ้ำกันคำต่อคำระหว่างฟอร์มเพิ่มกับแก้ในแถว (I2) โครงหน้าซ้ำระหว่างสองหน้า (โหลด/ผิดพลาด/ลองใหม่/นับ)
- Ruling: คำไทยของ type "common" = "ปกติ" และ "parallel" = "คู่ขนาน" — frontend/ ไม่มีคำไทยของ common (addendum ของผู้คุมเข้าใจผิดว่ามี) "ปกติ" ตรงความหมาย (วิชาที่ไม่ได้สอนคู่ขนาน) — ถ้าผิด: เปลี่ยนคำเดียว
- Task 6: minor (รวมในรอบแก้ เพราะเป็นบั๊กการใช้งานจริงในไฟล์เดียวกัน): ครูที่ชี้กลุ่มสาระที่หายไป แก้ชื่อแล้วได้ 400 · counts() แปลงคำตอบผิดรูปเป็น 0 · หลังดึงครู reload ทำฟอร์มที่พิมพ์ค้างหาย · ข้อผิดพลาดตอนแก้แถวขึ้นบนสุดของรายการ มองไม่เห็น · ตัวทดสอบขาด 3 กรณี
- Task 6: minor (deferred): ด่านชนิดพึ่ง excess-property check ซึ่งทำงานกับ object literal สดเท่านั้น — ไม่ใช่ด่านที่กันได้ร้อยเปอร์เซ็นต์ (ฝั่งเซิร์ฟเวอร์ปฏิเสธช่องแปลกอยู่แล้วเป็นด่านจริง)
- Task 6: fix round 1/5 (7 addressed, 0 open; commits 8bf7ebc..2cc2562) · re-reviewer a23aa079a44cb500f (sonnet): all addressed, no new Critical/Important
- Task 6: minor (deferred — ควรแก้ในรอบแก้สุดท้าย): ฟอร์มเพิ่มครูเสียป้ายชื่อช่องที่มองเห็นได้ เหลือแต่ placeholder (หายเมื่อพิมพ์) — registryParts.tsx TeacherFields
- Task 6: minor (deferred): บันทึกแถวแบบไม่มีอะไรเปลี่ยน ปิดตัวแก้โดยไม่ล้าง rowError เก่า (TeachersPage/SubjectsPage saveRow)
- Task 6: minor (deferred): confirmImport — POST สำเร็จแต่คำตอบผิดรูป → ขึ้นข้อผิดพลาดแต่ไม่ reload รายการ ทั้งที่เซิร์ฟเวอร์เขียนแล้ว
- Task 6: minor (deferred): aria-label ของ select กลุ่มสาระในฟอร์มเพิ่มเปลี่ยนเป็น "กลุ่มสาระ" ซ้ำกับตัวแก้ในแถว
- Task 6: ⚠️ ผู้คุมดู screenshot task-6-2-preview / task-6-6-edited แล้ว: สรุปก่อนดึง 143 · รายการจัดตามกลุ่มสาระ · ไม่มีปุ่มลบ
- Task 6: complete (commits 5792532..2cc2562, review clean after 1 fix round)
- Task 7: implementer adb66f34dd50d0166 (sonnet) → 39a618e (BASE 2cc2562) · DONE_WITH_CONCERNS: ครูที่พิมพ์เองโดยไม่มี sched_id แต่มีในเว็บตารางด้วย → ดึงครูแล้วได้สองแถว (ผู้ลงมืออ่าน 'รหัสครู' ของ 10จ เป็นช่อง code) · ตั้งรหัสใหม่ให้แถวที่ปิดอยู่ไม่เปิดให้เอง
- Task 7: review aff9be7c19b55f259 (sonnet): spec ✅ Approved, 0 Critical/Important · ⚠️ 10จ(b) ให้เจ้าของแผนตัดสิน
- R16 Ruling: "รหัสครู" ในสเปกข้อ 10จ และส่วนที่ 2/4 คือเลขครูของโปรแกรมจัดตารางที่เก็บในแถวของเว็บใหม่ (sched_id — สเปกเรียก "รหัสครูเดิม") ไม่ใช่ช่อง code (รหัสประจำตัว T001) ปุ่มดึงครูจึงเทียบด้วย sched_id เท่านั้นตามแผน และ 10จ ผ่านเต็ม ไม่เพิ่มการจับคู่ด้วย code — code เป็นข้อความที่คนพิมพ์ ว่างได้ ซ้ำได้ การจับคู่ด้วยมันคือการเดาแบบเดียวกับที่แผนห้ามทำกับชื่อ — ถ้าผิด: ครูที่พิมพ์เพิ่มเองในเว็บใหม่และมีในเว็บตารางด้วย จะเป็นสองแถวหลังดึงครู (คู่มือบอกให้ดึงก่อนพิมพ์ และขั้นที่ 3 ต้องมีวิธีผูกสองแถวเข้าด้วยกัน)
- Task 7: ⚠️ ผู้คุมตรวจเอง: screenshot task-7-1/task-7-5 มีจริงและถูกต้อง · ผู้คุมอ่านคู่มือทั้งฉบับ พบข้อที่ต้องแก้ 3 ข้อ (10จ เขียนผิดความจริง · ไม่บอกว่าหัวหน้ากลุ่มสาระยังไม่เห็นอะไรในขั้นนี้ · ไม่บอกวิธีแก้เมื่อ Render ยังเป็นรุ่นเก่า) → เข้ารอบแก้ในฐานะช่องโหว่ที่ยืนยันแล้ว
- Task 7: minor (รวมในรอบแก้): ค่าตัวอย่างรหัสตั้งค่าคัดลอกไปใช้ได้ · "ทั้ง 11 กลุ่ม" เป็นเลขตายตัว · คู่มือไม่บอกว่าตั้งรหัสใหม่ให้แถวที่ปิดแล้วยังปิดอยู่ · กล่องแสดงรหัสไม่ trim · ตัวทดสอบขาด 3 กรณี
- Task 7: minor (deferred): listCodes ไม่ตรวจรูปของแต่ละแถว · ข้อความนับ "ตั้งรหัสแล้ว X จาก N" นับแถวที่ปิดและแถวกำพร้า · focus/live-region · ฟอร์ม setup เก็บค่าที่พิมพ์ไว้เมื่อส่งไม่สำเร็จ (ตั้งใจ ให้ลองใหม่ได้ — รับไว้ตามที่เป็น)
- Task 7: fix round 1/5 (8 addressed, 0 open; commits 39a618e..a5c846c) · re-reviewer aceb34c631bc9d303 (sonnet): all addressed, no new Critical/Important
- Task 7: minor (deferred — ต้องแก้ในรอบแก้สุดท้าย): docs/workload-setup.md:38 ยังเขียน "(ดูข้อ 6)" สำหรับกรณีลืมรหัส แต่หลังเรียงเลขใหม่เนื้อหานั้นอยู่ข้อ 7
- Task 7: complete (commits 2cc2562..a5c846c, review clean after 1 fix round)
- ทุก task เสร็จ → final whole-branch review: MERGE_BASE 9cd6801 · HEAD a5c846c
- final review ครั้งแรก (a14082247523dce3b, fable) ถูกตัดกลางคันด้วยเพดานการใช้งาน แล้วถูกยกเลิก — ไม่มีผล · เริ่มใหม่ด้วย a9628c028ca5c3ccd (fable) ตามที่ผู้ใช้สั่งให้ทำต่อจนเสร็จ
- ผู้คุมลองข้อทดสอบท้ายแผนข้อ 3 กับเซิร์ฟเวอร์จริงในเครื่อง (fastapi จริง + Postgres, บังคับ CURRENT_TERM = closed): POST /api/teachers/ → 409 "เทอม 1/2569 ปิดแล้ว ดูและปริ้นได้เท่านั้น" · setup/POST teachers/import 143/PUT/POST codes ของเว็บใหม่ → 200 ทั้งหมด · revision 0 → 0 · ไม่มี Traceback

## Final whole-branch review (a9628c028ca5c3ccd, fable) — 9cd6801..a5c846c
- ผล: ไม่มี Critical · Ready to merge = With fixes · อ่าน diff ครบ 4,975 บรรทัดใน 7 รอบ · รัน schema จริงบน Postgres 16 · tests 15/0
- Important 1: merge เข้า main พาชั้นเทอม (36 คอมมิตที่ยังไม่อยู่บน main) ไปด้วย และสเปกชนกับคอมมิต f4e0723 บน main → ไม่ใช่งานแก้โค้ด เป็นการตัดสินใจของผู้ใช้ (คำถามข้อ 1 เดิม) — รายงานในข้อความสุดท้าย · ผู้คุมไม่แก้ conflict ล่วงหน้า เพราะยังไม่รู้ว่าผู้ใช้จะ merge term-layer ก่อนหรือ merge สาขานี้ทีเดียว (แก้สองที่จะชนกันอีกรอบ)
- Important 2: ข้อผิดพลาดกลางคำขอใน _wl_db() หลุดเป็น 500 เปล่าไม่มีหัวข้อ CORS → หน้าเว็บบอกว่า "เซิร์ฟเวอร์อาจกำลังตื่น" → เข้ารอบแก้
- Important 3 (ค้าน R11): ทะเบียนวิชาเริ่มว่าง → ทุกวิชาที่พิมพ์เองจะเป็นแถวซ้ำตอนขั้นที่ 3 → R11b
- Important 4: คู่มือให้กด Save บน Render ซึ่งรีสตาร์ทเซิร์ฟเวอร์ของเว็บตาราง โดยไม่เตือน → เข้ารอบแก้
- R11b Ruling (กลับ R11): เพิ่มปุ่ม "ดึงวิชาจากโปรแกรมจัดตาราง" ตอนนี้ รูปเดียวกับปุ่มดึงครู (เทียบด้วยเลขวิชาของโปรแกรมจัดตารางเท่านั้น · ดูก่อนเขียน · คัดลอกเฉพาะช่องตัวตน) — สเปกส่วนที่ 4 บอกว่าแถววิชาของเว็บใหม่ "ถือรหัสของฝั่งโปรแกรมจัดตารางสอน ว่างได้เฉพาะแถวที่ยังไม่เคยส่ง" ซึ่งเป็นไปไม่ได้ถ้าไม่มีทางดึง 271 วิชาที่มีอยู่แล้ว และผู้ตรวจชี้ถูกว่ารอถามตอนขั้นที่ 3 คือสายเกิน (แถวที่พิมพ์เองลบไม่ได้) — ถ้าผิด: มีปุ่มหนึ่งปุ่มที่ไม่มีใครกด (ไม่กดก็ไม่เกิดอะไร)
- ข้อเล็กที่ผู้ตรวจให้แก้ก่อน merge: #14 ป้ายชื่อช่องของฟอร์มครู/วิชา · #19 เลขอ้างอิงในคู่มือ · (#15, #17 แก้พร้อมกัน)
- ข้อเล็กจากรีวิวสุดท้ายที่รวมในรอบแก้: คอมเมนต์เตือนที่ WORKLOAD_PREFIX · คู่มือ: ให้กดออกจากระบบบนเครื่องที่ใช้ร่วม · ฐานข้อมูลล่มตอนเซิร์ฟเวอร์เริ่ม · คำแนะนำความแข็งแรงของรหัส
- minor (deferred — คงค้างหลังรอบแก้สุดท้าย, ผู้ตรวจตัดสินว่า CAN WAIT): การแข่งกันของสองคำขอแรกสุดตอนสร้างตาราง (ได้ 503 ครั้งเดียว ลองใหม่ผ่าน) · health และ token ปลอมเปิดการเชื่อมต่อฐานข้อมูลไม่จำกัด · login() ฝั่งหน้าเว็บไม่ตรวจรูปคำตอบ · R13 ครอบแค่ปุ่มดึง · กลุ่ม concurrency ร่วมอาจยกเลิก run ที่รอ · ราคา PBKDF2 บน Render ยังไม่เคยวัด · ไม่มี unit test ของตรรกะ route รหัสเข้า/ตั้งค่า และไม่มีตัวทดสอบผ่าน HTTP จริงในชุด (มีแต่ smoke ด้วยมือ) — ควรเป็นงานแรกของแผนถัดไป
- final fix wave: a2b4ff47f1a67df47 (opus) → d0b835e, 323b32e, 0ac0420 (FIX_BASE a5c846c) · DONE ครบทุกข้อของ final-fix-brief.md · tests 15/0 · ของจริง: วิชา 271 / ครู 143 / 500 ไทย+CORS / revision 0
- final fix wave re-review: affa9db3a912932ec (opus): A1 A2 A3 B1 B2 C1–C7 ADDRESSED ทุกข้อ · ไม่มี Critical/Important ใหม่ · พฤติกรรมเดิมที่ต้องรอดจากการ refactor รอดครบ
- parked — คู่มือ docs/workload-setup.md:156 (และแถว 10ค) ยกข้อความ "สร้างใหม่ 0 … · มีอยู่แล้ว 271 …" ในเครื่องหมายคำพูด ทั้งที่จอขึ้นว่า "ไม่มีวิชาใหม่ให้ดึง (มีอยู่แล้ว 271 วิชา)" — Ruling: จริง แต่ไม่มีอะไรต่อยอดจากมัน ตัวเลขถูก เลื่อนไปแก้พร้อมงานถัดไป — ถ้าผิด: คนอ่านหาข้อความนั้นบนจอไม่เจอ
- parked — ปุ่มดึงวิชาคัดลอก type/duration ตามที่เป็น ไม่ปรับให้เข้ากรอบ common|parallel และ 1|2 — Ruling: ทำตามคำสั่งของผู้คุมเอง (คัดลอกให้ตรงของจริง ดีกว่าแปลงเงียบ ๆ) ข้อมูลที่มากับโค้ดเป็น common ทั้ง 271 วิชา ต้องตรวจกับสำเนาฐานข้อมูลจริงก่อนใช้ — ถ้าผิด: วิชาที่มีค่าแปลกจะแสดงผิดในตัวแก้ของแถว และบันทึกช่องนั้นไม่ได้จนกว่าจะเลือกค่าที่ถูก
- minor (deferred): api-contract.md (ไฟล์ทำงาน ไม่อยู่ใน repo) ไม่มี route ดึงวิชาและสถานะ 500 ใหม่ · docstring ของ wl_import_plan ยังพูดถึงครูอย่างเดียว
- สถานะสุดท้าย: 7/7 task + final review + fix wave เสร็จ · HEAD ของโค้ด 0ac0420 · ยังไม่ merge (การ merge เป็นของผู้ใช้)
