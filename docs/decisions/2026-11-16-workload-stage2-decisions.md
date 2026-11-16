<!-- สำเนาสมุดงาน (ledger) ของ subagent-driven-development สำหรับแผนขั้นที่ 2 ของเว็บลงอัตรากำลัง — ต้นฉบับอยู่ใต้ .superpowers/ ซึ่ง .gitignore กันไว้และหายไปพร้อมเครื่องชั่วคราว บรรทัดที่มีคำว่า Ruling คือการตัดสินใจที่ทำแทนผู้ใช้ระหว่างทำ พร้อมราคาถ้าตัดสินผิด · บรรทัดที่มี minor (deferred คือของที่รู้แล้วว่ายังไม่ได้แก้ · รายงานรีวิวทั้งสาขาฉบับเต็มอยู่ท้ายไฟล์ -->

# SDD ledger — plan: docs/superpowers/plans/2026-11-16-workload-site-stage2.md

Spec: docs/superpowers/specs/2026-11-16-workload-stage2-design.md (อนุมัติ 16 พ.ย. — "ทำได้เลย") + สเปกหลัก 2026-11-06 · read in full
Branch: claude/claude-code-workload-status-z0w49p · BASE ของแผนนี้ 897c377 (= main 1f2994c + เอกสาร) · MERGE_BASE สำหรับรีวิวสุดท้าย: 1f2994c
Baseline: bash tests/run.sh → ผ่าน 17 · ไม่ผ่าน 0
Rig: pg/pg.sh · pg/server.sh (fastapi จริง + Postgres 16 ทดลอง ที่ :18000) · venv/ — สร้างใหม่ในโฟลเดอร์นี้

## Pre-flight scan

| คู่/ตัว | ผลิต vs ใช้ | พบ |
|---|---|---|
| T1→T2 | wl_round_proposal(src) ← _wl_round_source | ตรงกัน · preview ต้องคำนวณโดยไม่เขียน แต่ครู/วิชาที่ยังไม่ดึงยังไม่มี wl id (R2) |
| T1→T4 | wl_round_proposal ← ตัวทดสอบความตรงกัน | ตรงกัน |
| T2→T3 | wl_round_view | ตรงกัน |
| T3→T4 | wl_can_edit ← ขั้นงานส่ง | ตรงกัน (สถานะกลุ่มอยู่ในเงื่อนไขของ wl_can_edit) |
| T5→T6..T9 | ui/ + AppShell | ชื่อแท็บ: T5 เขียน "สรุปอัตรากำลัง" แล้ว แต่ T9 ยังพูดถึง "แทนชื่อสรุปคาบรายครู" (R3) |
| T6→T7→T8→T9 | round.ts (สร้าง T6 · เติม T7 T8) · sheets.ts ใช้ groupBySubject/levelOf/KIND_TEXT ของ T7 | ตรงกัน |
| T8→T9 | HeadFillPage (สร้าง T8 · T9 เติมลิงก์) | ตรงกัน |
| T1 เอง | test_schema...no_new_index_on_existing_tables | wl_codes มี unique index สองตัวอยู่แล้ว ตัวทดสอบต้องไม่ล้มเพราะของเดิม (R1) |
| T2 เอง | สอดคล้อง | — |
| T3 เอง | แก้ route วิชาของขั้นที่ 1 (รหัสห้ามซ้ำ) | ตัวทดสอบเดิม wlregistry.py ต้องยังผ่าน |
| T4 เอง | fixture จาก teacherLoads ของ frontend | การ import teachingLoad.ts ด้วย node อาจติดถ้ามัน import ชนิดแบบไม่ใช่ import type (R4) |
| T5 เอง | ไม่มีตัวทดสอบหน่วย (หน้าตาอย่างเดียว) | ไม่ใช่ข้อบกพร่องของ rubric — ไม่มีตรรกะ ตรวจด้วย screenshot + ตัวทดสอบเดิม |
| T6..T9 เอง | สอดคล้อง | — |

## Rulings (ก่อนเริ่ม)

- R1 Ruling: ตัวทดสอบ schema ของ T1 ตรวจว่าชุด CREATE UNIQUE INDEX ที่ ON wl_codes/wl_teachers/wl_subjects เท่ากับของเดิมพอดี (wl_codes_one_admin, wl_codes_one_per_dept) — แผนเขียนว่า "ไม่มี" ซึ่งจะล้มเพราะของเดิม — ไม่มีราคา
- R2 Ruling: preview (T2) คำนวณ mapping ในหน่วยความจำ: ครู/วิชาที่ยังไม่ดึงใช้รหัสชั่วคราวติดลบไม่ซ้ำกัน แล้วนับเป็น teachers_to_pull/subjects_to_pull · ไม่เขียนฐานข้อมูล — ถ้าผิด: ตัวเลข preview กับของจริงต่างกันได้ถ้ามีคนแก้ทะเบียนระหว่างดูกับกดเปิด
- R3 Ruling: แท็บของ admin ชื่อ "สรุปอัตรากำลัง" ตั้งแต่ T5 · T9 แค่ใส่หน้าจริงแทนหน้าว่าง — ไม่มีราคา
- R4 Ruling: ถ้า node import teachingLoad.ts ไม่ได้ตรง ๆ ใน T4 ห้ามแก้ไฟล์ของ frontend/ ให้ใช้วิธีเดียวกับตัวทดสอบเดิมใน tests/ts ที่ import frontend/src/utils อยู่แล้ว ถ้ายังไม่ได้ ให้ BLOCKED กลับมา — ถ้าผิด: ไม่มี
- T1: dispatched implementer a141e4f6050cf8b30 (opus) · BASE 897c377
- T1: NEEDS_CONTEXT → answered: Ruling: ยกช่องในตารางเป็นชุดกิจกรรมเมื่อ is_activity_block/activity_teacher_ids หรือวิชา is_activity ที่ไม่มีแถวแผนของห้อง+วิชาเดียวกัน — ไม่งั้นแนะแนว 75 แถวถูกนับซ้ำ — ถ้าผิด: กิจกรรมที่วางเป็นคาบปกติและมีแถวแผนด้วยจะไม่เป็นชุด (มันเป็นแถวอยู่แล้ว ไม่หาย)
- Ruling: ข้าม is_free_period · กิจกรรมไม่มีครูคุม → ไม่สร้างชุด ใส่ unconverted พร้อมเหตุผลไทย · ห้องที่กำหนดไว้ในแผน/ชุดเดิมคัดลอกมา — ไม่มีราคา
- ผู้ใช้ขอเปลี่ยนทิศ (16 พ.ย.): "admin มีหน้าที่กรอกทุกอย่างให้อิงตามหลักสูตร ให้ทำหลักสูตรก่อน แล้วค่อยไปตั้งรหัสวิชา ชั้นทุกๆอย่าง หัวหน้าหมวดแต่ละวิชามีหน้าที่แค่เพิ่มครูเข้าไปสอนในวิชานั้น" → ถามผู้ใช้ว่าทำหลักสูตรที่ไหน (ก. ในเว็บนี้ — แนะนำ · ข. ในโปรแกรมจัดตาราง) · T1 ทำต่อเพราะใช้ได้ทั้งสองทาง · งานถัดไปรอคำตอบ
- ผู้ใช้ตอบ (16 พ.ย.): "ก. คืออยากให้ลงในหลักสูตรก่อนเพราะทุกๆคนเวลาสงสัยจะได้เปิดหลักสูตรดูได้ แถมสามารถตรวจสอบย้อนกลับมาได้ด้วย" → แบบข้อ 4.5 · แผน T2–T9 เขียนใหม่ (หลักสูตรของภาคเรียนในเว็บนี้ · แถวของรอบ = บรรทัดหลักสูตร × ห้อง เก็บแค่ช่องของหัวหน้า · หัวหน้าใส่ครูอย่างเดียว · ทุกคนดูหลักสูตรได้ · บันทึกการแก้)
- Ruling: แถวของรอบไม่ก๊อปข้อมูลวิชา อ่านจากบรรทัดหลักสูตรด้วย join — แก้หลักสูตรแล้วแถวเปลี่ยนตาม และแถวชี้กลับหลักสูตรได้ (ตรวจย้อน) — ถ้าผิด: แก้หลักสูตรหลังส่งแล้วแถวที่ส่งไปเปลี่ยนตาม (ปิดรอบล็อกหลักสูตรของภาคเรียนนั้นไว้กันข้อนี้หลังจบ)
- Ruling: ลบบรรทัด/ห้องที่มีครูใส่แล้วต้องส่ง force ซ้ำ ไม่งั้น 409 — ครูที่หัวหน้าใส่ไว้หายเงียบ ๆ ไม่ได้ — ไม่มีราคา
- Ruling: ตารางของรอบรูปเดิมจาก T1 (wl_rows ที่ก๊อปข้อมูลวิชา · wl_sets/wl_set_options) ปรับรูปใน T2 ได้เลย เพราะยังไม่เคยขึ้นเว็บ — ถ้าผิด: ไม่มี
- ฟังก์ชันแปลงแผนของ T1 ยังใช้: ตั้งต้นหลักสูตร (T2) และใส่ครูเทอมก่อน (T3)
- T1: implementer a141e4f6050cf8b30 (opus) → 9cb0598 (BASE 897c377; ช่วงนั้นมีคอมมิตเอกสารของผู้คุม 042b52d 897c377→6f52a4d ปนอยู่) · DONE_WITH_CONCERNS: C1 แยกชุดตามรูปแบบวัน/คาบ ไม่ใช่แค่จำนวน (ครูคนเดียวสอนวิชาเสรี/ลูกเสือสองเวลา ต้องได้ 2 คาบ) · C2 เพิ่ม wl_rounds.unconverted jsonb · C3 ครูคุมกิจกรรมรวม co_teacher_id ของช่อง · C4 co_teacher_id ของแถวแผนเดี่ยวติดมา · C5 is_double ของแถวเป็นเท็จเสมอ
- Ruling: รับ C1–C5 ทั้งหมด — สอดคล้องกับเจตนาของแบบ (ไม่ทิ้งการสอนจริง ไม่นับซ้ำ) — ถ้าผิด: แก้ฟังก์ชันล้วนตัวเดียว
- T1: review a0d66113f19bd5c2f (opus): ❌ · Important ×4 (ทั้งหมด plan-mandated): (I1) บล็อกกิจกรรมทั้งระดับที่ครอบแถวแผนห้อง+วิชาเดียวกัน → นับซ้ำ (I2) คาบเสรีรายห้อง: คีย์ทั้งชุดตัวเลือกแยกชุดผิด (ตัวเลือกไม่เหมือนกันทุกห้อง → ครูได้ 2 คาบจากชั่วโมงเดียว) และ "มาจากชุด" ตัดสินด้วยห้อง+วิชา ทำทิ้งหน้าต่างที่ไม่ได้มาจากชุดเงียบ ๆ (I3) คาบปกติที่ไม่มีแถวแผน (ลงเองด้วยมือ) หายเงียบ ไม่อยู่ใน unconverted (I4) wl_kind_from_code ใช้ตัวที่ 4 ทำรหัสนำหน้าสองตัวอักษรผิด 6 วิชา
- Ruling (I1): แถวแผนที่ห้อง+วิชาถูกบล็อกกิจกรรมที่ยกมาครอบ = ถือว่าสอนในบล็อกแล้ว ไม่สร้างแถว นับ served_skipped — แบบข้อ 4.4 ก. ห้ามนับซ้ำ ชนะข้อความ ruling Q1 ที่ไม่ได้คิดกรณีนี้ — ถ้าผิด: แนะแนวที่ทั้งมีแถวและมีบล็อกจะเห็นเป็นชุดกิจกรรม ไม่ใช่แถว (ครูคนเดิม คาบเท่ากัน)
- Ruling (I2): ใช้กฎ "บทเรียนร่วม" ของโปรแกรมจัดตาราง (_shared_lesson_key/_same_activity): ต่อ (วัน, คาบ) รวมช่องที่มีตัวเลือก (วิชา, ครู) ร่วมกันเป็นหน้าต่างเดียว ตัวเลือก = ยูเนียน แล้ว weekly = จำนวนหน้าต่างต่อ (ชุดห้อง, ชุดตัวเลือก) · "มาจากชุด" ใช้ elective_pool_id ของช่องก่อน ไม่มีค่อยใช้กฎเดิมเป็นทางสำรอง — แบบข้อ 4.4 ก. (ไม่ทิ้ง ไม่นับซ้ำ) ชนะคีย์ที่ brief กำหนด — ถ้าผิด: การรวมหน้าต่างกว้างเกินจนสองวิชาที่ไม่เกี่ยวกันกลายเป็นชุดเดียว (ครูยังได้คาบถูก)
- Ruling (I3): คาบปกติที่สอนจริงแต่ไม่มีแถวแผนของห้อง+วิชานั้น → ลงรายการ unconverted (source "slot" เหตุผลไทย หนึ่งรายการต่อห้อง+วิชา) ไม่ยกเป็นแถว — แบบข้อ 4.4 ก. ให้รายงานสิ่งที่แปลงไม่ได้ · ใน "หลักสูตรมาก่อน" admin เพิ่มบรรทัดเอง — ถ้าผิด: admin ต้องเพิ่มเองตามรายการ
- Ruling (I4): หลักประเภทวิชา = หลักที่ 3 ของตัวเลขชุดแรกในรหัส (re.match(r"\D*\d\d(\d)")) — เจตนาของ brief คือ "หลักประเภทของรหัส" ตัวเลขดัชนี 3 เป็นความผิดของผู้เขียนแผน — ไม่มีราคา
- T1: minor (รวมในรอบแก้ เพราะเป็นจุดเดียวกัน/ถูก): grange([]) ทำทั้ง proposal ล้มเมื่อชุดไม่มีชื่อและไม่มีห้อง · _wl_co_teach_pairs กับ _fold_coteaching เดิมซ้ำกันและให้ผลต่างกันกรณีแถวไม่มีครู → ชี้ docstring ถึงกัน และเลือกให้แถวไม่มีครูไม่จับคู่ (บันทึกเหตุผล)
- T1: fix round 1 → e3cdac0 (DONE_WITH_CONCERNS) · Ruling: รับการตีความ I2b ของผู้ลงมือ — ช่องที่ไม่มี elective_pool_id นับว่ามาจากชุดเมื่อห้อง ชั่วโมงของชุด และคู่ (วิชา, ครู) ตรงทั้งหมดเท่านั้น (กฎเดิมแบบตรงตัวยังทิ้ง probe (b) เงียบ ๆ ซึ่งขัดเจตนาของ ruling) — ถ้าผิด: หน้าต่างเก่าที่ไม่มีรหัสชุดและตรงทุกอย่างกับชุดถูกนับเป็นชุด (ไม่ทิ้ง ไม่ซ้ำ) · รับ I1 follow-on (ชั่วโมงเกินบล็อกยกเป็นกิจกรรม) และการแทนที่ C1 ด้วยกฎนับชั่วโมงของ I2
- T1: fix round 1/5 (6 addressed, 0 open; commits 9cb0598..e3cdac0) · re-reviewer a94a79312f9b06482 (opus): all addressed, no new Critical/Important
- T1: minor (deferred): ทางสำรองของ "มาจากชุด" จับครึ่งหลังของคาบคู่ที่คาบไหนก็ได้ — หน้าต่างคาบคู่รายห้องที่ตรงชุดทุกอย่างแต่คนละเวลาเสียไปหนึ่งคาบ (หายาก)
- T1: minor (deferred): แถวแผนที่บล็อกกิจกรรมครอบแต่ weekly มากกว่าชั่วโมงที่วางจริง ส่วนเกินหายไม่รายงาน (เกิดเฉพาะตารางที่ยังจัดไม่ครบ)
- T1: minor (deferred, ก่อน fix): บล็อกกิจกรรม key ด้วยชุดครูคุมเป๊ะ ห้องที่ครูคุมทับกันบางคนนับครูที่ซ้ำห้องละครั้ง (เส้นทางของโปรแกรมเขียนแบบนี้แทบไม่เกิด)
- T1: complete (commits 6f52a4d..e3cdac0, review clean after 1 fix round)
- T2: dispatched implementer ae1ff2ec2bbac63f0 (opus) · BASE e3cdac0
- T2: implementer ae1ff2ec2bbac63f0 (opus) → 1322e04 (BASE e3cdac0) · DONE_WITH_CONCERNS D1–D6
- Ruling (D1): ปุ่มดึงวิชาเทียบรหัสชนกับวิชาที่มีอยู่ก่อนเริ่มดึงเท่านั้น วิชาสองตัวในชุดเดียวกันที่รหัสซ้ำกันถูกสร้างทั้งคู่ — รับไว้ (ข้อมูลของโปรแกรมจัดตารางไม่มีรหัสซ้ำ 271/271 และตัวทดสอบเดิมของขั้นที่ 1 ต้องไม่เปลี่ยนความหมาย) — ถ้าผิด: ถ้าวันหนึ่งโปรแกรมจัดตารางมีรหัสซ้ำ ทะเบียนจะมีสองวิชารหัสเดียวกัน (POST/PUT ยังกันได้)
- Ruling (D2): ตัวทดสอบ "ไม่มี DELETE" ของขั้นที่ 1 แคบลงเหลือ teachers/subjects — แบบกำหนดให้ลบหลักสูตรได้ — ไม่มีราคา
- D3 → ส่งต่อ Task 3: FK ของแถวรอบเป็น DEFERRABLE INITIALLY DEFERRED · route ลบก่อนแล้วเรียก hook · hook ต้องลบแถวกำพร้าในธุรกรรมเดียวกันหรือยก 409 ไม่งั้น COMMIT ล้มเป็น 500
- D4 (hook รันทุกการเขียน) · D5 (ตัวเลือกหนึ่งต่อวิชา) · D6 (ห้องจัดกลุ่มแบบ multiset) — รับ
- T2: review a37ff004f9a474899 (opus): ✅ Approved · 0 Critical/Important · ⚠️ (ก) action ในบันทึกเป็นคีย์อังกฤษ → Task 6 แสดง detail เท่านั้น (ข) unconverted ของการตั้งต้นคืนครั้งเดียวไม่เก็บ → Task 6 ต้องแสดงจากคำตอบ (ค) Postgres จริงมีแต่ในรายงาน → ยกให้ Task 3 ลองซ้ำ
- T2: minor → ยกไป Task 3 (load-bearing): ของปลอมฐานข้อมูลไม่ตรวจ FK ที่ COMMIT (Task 3 จะสร้าง sync บนมัน) · ตรวจล็อกเทอมแข่งกับการปิดรอบได้ · PUT บรรทัดด้วยรหัสเดิมรีเซ็ตชื่อ/กลุ่มสาระจากทะเบียน (ย้ายแถวกลับไปกลุ่มอื่นเงียบ ๆ) · ตั้งต้นพร้อมกันสองครั้งได้ 500 แทน 409 · ตัวทดสอบเทียบค่ากับตัวเอง (บรรทัด 860) · ค่าที่ hook คืนถูกทิ้ง บันทึกไม่บอกจำนวนครูที่หาย
- T2: complete (commits e3cdac0..1322e04, review clean)
- T3: dispatched implementer ae35c6ef51da59aaa (opus) · BASE 1322e04
- T3: implementer ae35c6ef51da59aaa (opus) → 608ce7d (BASE 1322e04) · DONE_WITH_CONCERNS D1–D8 · รับ D1 D2 D4 D6
- Ruling (D3): "มีครูใส่แล้ว" ที่ทำให้การลบต้อง force = แถว/ครูของตัวเลือกที่ **คนเป็นผู้ใส่หรือยืนยัน** (`confirmed` จริง หรือ `from_plan` เท็จและมีครู) — ครูเทอมก่อนที่เครื่องใส่และยังไม่มีใครยืนยันลบได้โดยไม่ต้อง force — กติกานี้มีไว้กันงานของคนหายเงียบ ๆ ไม่ใช่กันของที่เครื่องเดาไว้ · ถ้าไม่แก้ admin แก้หลักสูตรตอนเตรียมรอบจะเจอ 409 ทุกครั้ง — ถ้าผิด: ครูเทอมก่อนที่ยังไม่ยืนยันหายไปพร้อมบรรทัดโดยไม่ถาม (ไม่มีใครเสียงานที่ทำ)
- Ruling (D8): การเปิดให้กลุ่มสาระกรอกปฏิเสธเมื่อมี **ตัวเลือกของชุด** ที่ไม่มีกลุ่มสาระด้วย — ตัวเลือกที่ไม่มีกลุ่มไม่มีหัวหน้าคนไหนเห็น จะค้างเงียบ ๆ — ไม่มีราคา
- T3: ruling-fix → f822d94 (D3 D8 ตามคำตัดสิน) · ผู้ลงมือพบช่องว่างของแผน: ไม่มี PUT ของตัวเลือกชุด (มีแต่ POST/DELETE) — จะใส่กลุ่มสาระให้ตัวเลือกต้องลบแล้วเพิ่มใหม่ ซึ่งทิ้งครูของตัวเลือก
- Ruling: เพิ่ม `PUT /api/workload/term-set-options/{id}` (admin · ช่อง subject_id code name department_id · ล็อกเทอม · บันทึก · เรียก hook) ใน Task 3 — D8 บังคับให้ตัวเลือกมีกลุ่มสาระ จึงต้องแก้ได้โดยไม่ทิ้งครู — ไม่มีราคา
- T3: + 26b32cf (PUT term-set-options ตามคำตัดสิน) · ส่งรีวิวทั้งก้อน 1322e04..26b32cf
- T3: review a05300a016df604f4 (opus): spec ✅ · Important ×1: _wl_sync_round ตัดสิน "มีงานของคน" จากการอ่านที่ไม่ล็อก → บน Postgres การบันทึกของหัวหน้าที่กำลังเกิดพร้อมกันถูกลบได้โดยไม่มี 409
- Ruling (M1 ของรีวิว T3 — แก้ ruling (ข) เดิม): การเขียนหลักสูตรอ่านแถวรอบของภาคเรียนด้วย `FOR NO KEY UPDATE` (ไม่ใช่ FOR SHARE) — ยังกันการปิดรอบได้เหมือนเดิม และเรียงคนแก้หลักสูตรภาคเรียนเดียวกันทีละคน ไม่งั้นการแก้สองอย่างพร้อมกันทำให้แถวขาด/แถวกำพร้า — ถ้าผิด: admin สองแท็บรอกันเสี้ยววินาที
- Ruling (M3): "งานของคน" (_wl_entered) = confirmed จริง หรือ from_plan เท็จ และมี ครู/หมายเหตุ/ห้องปฏิบัติการ/คาบคู่ อย่างใดอย่างหนึ่ง · Task 4: การเขียนของหัวหน้าทุกครั้งตั้ง from_plan = false — ไม่มีราคา
- Ruling (M5): รอบที่ยัง `preparing` ยกเลิกได้ (`DELETE /api/workload/rounds/{round_id}` admin · ลบรอบและแถวทั้งหมด · บันทึกไม่ต้อง) และปิดรอบได้เฉพาะ `filling` — ปิดรอบที่เตรียมผิดเทอมจะล็อกหลักสูตรของเทอมนั้นตลอดไปและเปิดรอบเทอมนั้นใหม่ไม่ได้อีก (UNIQUE year/semester) — แก้ D4 เดิม — ถ้าผิด: ไม่มี
- M2 (ลำดับ UPDATE ใน PUT curricula) · M4 (preview นับแถวที่มีแค่ครูสอนร่วม + เพิ่ม options_without_department) → รวมในรอบแก้
- T3: fix round 1/5 (6 addressed, 0 open; commits 26b32cf..1cc57c4) · re-reviewer af6ec71286d1bd279 (opus): all addressed · พิสูจน์สองเซสชันกับ Postgres จริงแล้ว
- T3: minor (deferred): ช่วงที่ POST /rounds กำลังทำ — ผู้แก้หลักสูตรที่ไม่เจอแถวรอบจะล็อกแถวรอบครั้งแรกใน sync (FOR SHARE) → deadlock 40P01 ได้ และ M1 ยังหลุดได้ในหน้าต่างนั้น (แก้ด้วย advisory lock ต่อภาคเรียน) · ต้อง admin สองแท็บพร้อมกับการเปิดรอบ
- T3: minor (deferred, เดิม): route PUT ของหลักสูตรอ่าน old ก่อนรอล็อกแถวรอบ → ผู้เขียนที่ต่อคิวเทียบกับค่าก่อนรอ (W1 เปลี่ยน A→B, W2 ส่ง A → ถูกทิ้งเงียบ ๆ "ไม่มีค่าที่เปลี่ยน") — แก้ด้วยอ่าน old ใหม่หลัง _wl_refuse_locked
- T3: complete (commits 1322e04..1cc57c4, review clean after 1 fix round + 2 ruling commits)
- T4: dispatched implementer a6abc448cd96be9e7 (opus) · BASE 1cc57c4 · expect 23/0
- T4: implementer DONE_WITH_CONCERNS (c9ae061, 23/0, 84 real checks, 6 races) · concerns D1–D10 in task-4-report.md
- Ruling (T4 D1): ล้างครู (`teacher_id: null` โดยไม่ส่ง confirmed) → confirmed=False ไม่ใช่ True — ข้อผูกมัด "ยังไม่ยืนยันหายได้เพราะคนกด/เลือกครูเท่านั้น" การล้างไม่ใช่การเลือก — ถ้าผิด: หน้าหัวหน้าต้องกดยืนยันซ้ำหลังล้าง (เสียคลิกเดียว) · ส่งกลับให้ผู้ลงมือแก้ก่อนรีวิว
- Ruling (T4 D3): ส่งได้เฉพาะหัวหน้ากลุ่ม (ตาม brief/แบบ 4.3) ไม่เพิ่ม "admin ส่งแทน" — แบบบอก "ปิดรอบได้ทุกเมื่อ" และ admin แก้แถวได้ทุกสถานะ กลุ่มที่หัวหน้าไม่เข้าจึงไม่ขวางงาน — ถ้าผิด: เพิ่ม admin ใน wl_dept_submit บรรทัดเดียว
- Ruling (T4 D2): นับ "รายการ" = แถว + ตัวเลือก ของกลุ่ม (ชื่อคีย์ `rows` ตามสัญญา) — Task 8 fillProgress ต้องนับแบบ wl_fill_counts — ถ้าผิด: ตัวเลขบนหน้าไม่ตรงเซิร์ฟเวอร์ (จับได้ด้วยตัวทดสอบ T8)
- T4: D1 fix 681cc88 (23/0) · reviewer dispatched (opus) on review-1cc57c4..681cc88.diff
- Ruling (T6/T8 refs): ไม่มี route คืนรายการห้องเรียน/ห้องพิเศษให้หน้าเว็บ → Task 6 เพิ่ม GET /api/workload/groups และ /rooms (อ่านอย่างเดียว ทุกบทบาท) · Task 8 ใช้ /rooms — แบบ §4.3 ให้หัวหน้าแก้ห้องปฏิบัติการ และหน้าหลักสูตรต้องติ๊กห้อง — ถ้าผิด: สอง route เล็กที่อ่าน GROUPS/ROOMS อย่างเดียว ลบออกได้ไม่กระทบอะไร
- T4: reviewer a6b2a142541cba774 (opus): Spec ✅ · Quality approved · C0/I0/M6 · task-4-review.md
- T4: minor (deferred → final triage): M1 PUT ที่ส่ง teacher_id เท่าค่าเดิมก็ยืนยันแถว (แถวจากเทอมก่อนอาจยืนยันโดยไม่มีคนกด ถ้าหน้าส่งทั้งแถว) — กันที่หน้า (T8 addendum ข้อ 11) · ทางเซิร์ฟเวอร์: ตัด teacher_id ที่เท่าค่าเดิมก่อนเติม confirmed ใน PUT แถว/ครูของตัวเลือก
- T4: minor (deferred): M2 "ยืนยันแล้วแต่ไม่มีครู" สร้างได้ผ่าน {teacher_id:null, confirmed:true} หรือ bulk confirmed บนแถวว่าง — ส่งตรวจไม่หลุด (นับขาดครู) · หน้าต้องดูครูก่อนธง (T8 addendum ข้อ 2)
- T4: minor (deferred): M3 ตรวจแล้วเขียนโดยไม่ล็อกแถวเป้าหมาย → สองคำขอพร้อมกันอาจได้ครูผู้สอน=ครูสอนร่วม หรือครูซ้ำในตัวเลือก (ยอดคาบไม่ผิด)
- T4: minor (deferred): M4 `_wl_refuse_edit` คิดขอบเขต head ซ้ำขนานกับ `wl_can_edit` (เสี่ยงเพี้ยนถ้าแก้ตัวเดียว)
- T4: minor (deferred): M5 ตัวทดสอบความตรงวนแค่ครูในไฟล์คำตอบ — ครูที่ไม่อยู่ในไฟล์แต่ได้คาบไม่ถูกจับ
- T4: minor (info): M6 ส่ง/ตรวจ/ตีกลับเก็บแค่ครั้งล่าสุด (ตามคอลัมน์ Task 2)
- T4: complete (commits 1cc57c4..681cc88, review clean)
- T5: dispatched implementer a95720304170acbab (opus) · BASE 681cc88 · expect 23/0 + lint/build
- T5: implementer DONE_WITH_CONCERNS (2ef86c9, 23/0, lint/build clean, Playwright 51/51 @1280 52/52 @390) · concerns = observations (doc color word → T9 addendum · Segmented {value,label} → T6–9 addenda · red only for errors)
- T5: reviewer a4372129d1a5b49ab (sonnet) on review-681cc88..2ef86c9.diff
- T5: reviewer (sonnet): Spec ✅ · approved · C0/I0/M6 · ⚠️ ฟอร์มวิชาที่ 390 — ผู้คุมดู task-5-subjects-390.png เอง: เต็มความกว้าง ไม่ล้น (resolved) · ⚠️ hover ของ Button — ไม่กระทบการใช้งาน (accepted)
- T5: minor (deferred → final triage, a11y): M1 ขอบช่องกรอก --line บนขาว 1.29:1 · M2 วง focus ของแท็บถูกตัดขอบล่าง (overflow-x-auto) · M3 Chip mute 4.36:1 (< 4.5) · M4 ปุ่ม "ลืมรหัสผู้ดูแลระบบ" แยกด้วยสีอย่างเดียว
- T5: minor (accepted): M5 ข้อความช่วยเพิ่มสามจุด + who = "label · บทบาท" (ไม่มี test/คู่มืออ้าง) · M6 คู่มือ "ปุ่มสีน้ำเงิน" + ข้อ 6 หัวหน้า "เห็นแค่ข้อความ" → T9 addendum
- T5: complete (commits 681cc88..2ef86c9, review clean)
- T6: dispatched implementer ad2a5adf0f186eae0 (opus) · BASE 2ef86c9 · expect 25/0 + lint/build
- T6: implementer DONE_WITH_CONCERNS (8cc1460, 25/0, lint/build clean, Playwright 96/96 ×2, mutations 24/24) · concerns = observations (api.ts export http · /groups = _flat_groups 93 · weekly 1–99 on page vs server ≥0 · reload 4 GETs · inline delete confirm + focus prop · 409 dialog not full focus trap · Segmented 3rd tab clipped at 390)
- T6: controller checked MA21102 under dept 9 (ภาษาต่างประเทศ) = school_data.json source, not a bug
- T6: reviewer a833a18e393e0844a (opus) on review-2ef86c9..8cc1460.diff
- T6: review: Spec ❌ (addendum 2) · changes requested · C0/I2/M9 · task-6-review.md
- T6: minor (deferred): M1 กล่องยืนยัน force ปล่อย busy ระหว่างรอ + ไม่มี focus trap (เขียนซ้อน → งานแรกค้าง)
- T6: minor (deferred): M2 คืนโฟกัสช่องรหัสหลังเพิ่มบรรทัดอาจไม่ทำงาน (ช่องยัง disabled)
- T6: minor (deferred): M3 หน้าเปิดกล่องยืนยันเมื่อข้อความ 409 มีคำ "(force)" — ไม่มีตัวทดสอบ py ตรึงคำนี้
- T6: minor (deferred): M4 กฎเลือกภาคเรียนตั้งต้น/ภาคที่เสนอเพิ่มอยู่ใน TSX ไม่มีตัวทดสอบ
- T6: minor (deferred → final triage, มีผลข้างเคียง): M5 SeedCard สลับจาก "คัดลอก" เป็น "จากโปรแกรมจัดตาราง" เงียบ ๆ เมื่อไม่มีภาคต้นทาง (ตอนนี้ไปไม่ถึง) — ตั้งต้นจากโปรแกรมดึงครู/วิชาเข้าทะเบียน
- T6: minor (deferred): M6 wlrefs.py สร้างข้อมูลต้นทางเอง ไม่เรียกตัวสร้างจริง
- T6: minor (deferred): M7 จอ 390 แท็บ "บันทึกการแก้" ถูกตัด ไม่มีสิ่งบอกว่าเลื่อนได้ (Segmented ของ T5)
- T6: minor (deferred): M8 prop `focus` ไม่ได้ต่อกับ App ไม่มีตัวทดสอบ (T8 addendum ใช้)
- T6: minor (nit): M9 ตรวจรูปคำตอบใช้ `in` → key ของ prototype ผ่านได้
- T6: fix round 1 dispatched (resume ad2a5adf0f186eae0) · FIX_BASE 8cc1460
- T6: fix round 1 done b76918a (25/0, Playwright 22/22 ×2 + 96 rerun) · re-reviewer (sonnet) on review-8cc1460..b76918a.diff · residual: only latest seed's unconverted kept; code typed before subject registry loads isn't filled later
- T6: fix round 1/5 (2 addressed, 0 open; commits 8cc1460..b76918a) · re-reviewer a478ad5ca684f98a7 (sonnet)
- T6: minor (deferred): 401 ไม่ล้างกล่อง unconverted ใน sessionStorage (แสดงเฉพาะ admin) · เก็บได้ทีละภาค · รหัสที่พิมพ์ก่อนทะเบียนวิชามาไม่เติมชื่อย้อนหลัง
- T6: complete (commits 2ef86c9..b76918a, review clean after 1 fix round)
- T7: dispatching implementer · BASE b76918a · expect 26/0 (+ tests/ts/wlround.ts)
- T7: dispatched implementer ace36b3259cea2ffb (opus) · BASE b76918a
- T7: implementer DONE_WITH_CONCERNS (0814ef4, 26/0, lint/build clean, roundApi 47/47 real, Playwright 105/105+15/15 ×2) · concerns = decisions (deptStatusTone takes {status,rows,confirmed} + "ไม่มีรายการ" · ตีกลับ on approved too (server allows) · onOpenDepartment(round, deptId) · preview 503 shows error · round chip refreshed only by rounds page)
- T7: reviewer (sonnet) on review-b76918a..0814ef4.diff
- T7: reviewer a700de1a446c82ace (sonnet): Spec ✅ · approved · C0/I0/M6 · ⚠️ guards vs real route → accepted on implementer's 47/47 real-server run
- T7: minor (→ T8 addendum ข้อ 13): M1 onOpenDepartment ตั้ง roundFocus กับรอบที่ยังไม่ปิดด้วย → หลังปิดรอบหน้าค้างที่ภาพรวมรอบที่ปิดแทนการ์ดเปิดรอบ
- T7: minor (deferred): M2 DeptCard disabled ไม่รู้ working ของ RoundsPage (เซิร์ฟเวอร์กัน 409) · M3 การ์ด approved ไม่แสดงใคร/เมื่อไหร่ส่ง · M4 fmt/statusOf/isConflict ซ้ำหลายไฟล์ · M5 roundApi.ts ไม่มีตัวทดสอบใน repo · M6 กด "เปิดรอบ" ซ้ำก่อน reload ได้ (409 ไทย)
- T7: complete (commits b76918a..0814ef4, review clean)
- T8: dispatching implementer · BASE 0814ef4
- T8: dispatched implementer a4be356ee5c87b99d (opus) · BASE 0814ef4 · expect 26/0
- T8: implementer DONE_WITH_CONCERNS (8e96ad6, 26/0, lint/build clean, mutations 41/41, Playwright 100/100 ×2, psql: แก้หมายเหตุ/คาบคู่อย่างเดียว → confirmed ยัง false)
- Ruling (T8 C1): `groupBySubject` จัดการ์ดตามวิชา (รหัส ชื่อ คาบ ประเภท หน่วยกิต) แทน `line_id` ตาม brief — ข้อมูลตั้งต้นเป็นหลักสูตรห้องเดียวเกือบทั้งหมด (line_id → 80 การ์ด/108 แถวในกลุ่ม 1 ใส่ครูหลายห้องไม่ได้ ไม่ตรง mockup-head และขัดกับ Task 9 ที่คาด ส33102 เป็นก้อนเดียว 14 ห้อง) · ตรวจย้อนยังได้: การ์ดลิงก์ทุกหลักสูตรต้นทาง — ถ้าผิด: แก้คีย์บรรทัดเดียว + ตัวทดสอบสองตัว
- Ruling (T8 C2): แถบคาบรายครูเป็นสีเตือนเมื่อยอด ≥ ค่ามากสุดในรายการ (ไม่มีเพดานคาบในแบบ) — ตรงภาพตัวอย่าง — ถ้าผิด: เปลี่ยนเงื่อนไขบรรทัดเดียวเมื่อโรงเรียนให้เพดาน
- Ruling (T8 C3): `round.ts` import ฟังก์ชันจริงจาก `curriculum.ts` (ไฟล์ล้วนด้วยกัน node รันได้ ตัวทดสอบผ่าน) — กติกา "import type เท่านั้น" มีไว้กันไม่ให้ดึง React/axios เข้าไฟล์ล้วน ไฟล์ล้วนพึ่งไฟล์ล้วนไม่ขัดเจตนา — ถ้าผิด: ย้ายสามค่าเข้า round.ts
- T8: reviewer dispatched (opus) on review-0814ef4..8e96ad6.diff
- T8: review a4dca22be6c52384f (opus): Spec ✅ · changes requested · C0/I1/M11 · ไล่ทุกทางเขียนแล้ว ไม่รั่วข้อห้ามทั้งสอง · task-8-review.md
- T8: minor (deferred → final triage, HIGH): M5 ช่องเลือกครูบันทึกทันทีที่เปลี่ยน — ลูกศร/พิมพ์อักษรบนคีย์บอร์ด (Chrome Windows ยิง change ต่อการกด) ยืนยันครูผิดคนได้
- T8: minor (deferred → final triage, HIGH): M1 409 จาก bulk → แถบ bulk ถูกถอด ข้อความเซิร์ฟเวอร์และครูที่เลือกหาย (Review Focus 2 ไม่ครบทางนี้)
- T8: minor (deferred → final triage): M2 ข้อความผิดพลาดค้างหลังทำอย่างอื่นสำเร็จ · M3 409 ครูไม่ปฏิบัติงานแล้วไม่โหลดทะเบียนครูใหม่ · M4 ฟอร์มรายละเอียดเทียบ patch กับแถวปัจจุบันไม่ใช่ค่าตอนเปิด (เขียนทับค่าคนอื่นเงียบ ๆ) · M6 ชิป "ยังไม่ยืนยัน N" รวมแถวไม่มีครู (ตัวเลขต่างจากข้อความเหตุ) · M7 ตรรกะบางส่วนอยู่ใน TSX (statusKnown/canSubmit/related/canConfirm) · M8 โค้ดโหลด/กล่องผิดพลาดซ้ำ · M9 สีส้มของยอดสูงสุดบอกแค่อันดับ (คำถามเพดานคาบ → แจ้งผู้ใช้ตอนจบ) · M10 กล่องยืนยันส่งไม่เตือนค่าที่ยังไม่บันทึก · M11 ลิงก์ "ดูชุดที่หน้าหลักสูตร" ไม่พาไปที่ชุด
- T8: ⚠️ (→ final review): ความกว้าง 768–1279 ตารางคอลัมน์ตายตัว ที่ 1024 ช่องครู ~100px · ทาง 409 ของ bulk
- T8: fix round 1 dispatched (resume a4be356ee5c87b99d) · FIX_BASE 8e96ad6
- T8: fix round 1 done c95b771 (26/0, I1 sequence 14/14 ×2 vs psql, walk 100/100 ×2) · residual: pending values expire as a whole
- T8: fix round 1/5 (1 addressed, 0 open; commits 8e96ad6..c95b771) · re-reviewer a175538ad3a5e21bd (sonnet): no new breakage
- T8: minor (deferred): error ของปุ่ม "ยืนยัน" ที่ล้มค้างหลัง bulk เปลี่ยนแถว (= M2 เดิม) · แถวยืนยันแล้วที่มีค่าค้างจากบันทึกล้มยังแสดงครูที่ค้าง + ข้อความ (Review Focus 2 ยอมรับ)
- T8: complete (commits 0814ef4..c95b771, review clean after 1 fix round)
- T9: dispatching implementer · BASE c95b771 · expect 27/0 (+ tests/ts/wlsheets.ts)
- T9: dispatched implementer ad18f2ae357c1f527 (opus) · BASE c95b771
- T9: implementer DONE_WITH_CONCERNS (dc802f5, 27/0, lint/build clean, mutations 17/17, Playwright 56/56 ×2 incl. page.pdf) · C1–C5 decisions
- Ruling (T9 C1): ช่วงห้องใช้ `roomRange` เดิมของ curriculum.ts (`ม.1/1-3,5`) แทนตัวอย่างใน addendum (`ม.1/1-3, ม.1/5`) — ตรงกับที่หน้าหลักสูตร/หน้ากรอกแสดง ผู้ใช้เห็นรูปเดียวทั้งเว็บ — ถ้าผิด: เปลี่ยน helper ตัวเดียว
- Ruling (T9 C2/C4): otherTotal ไม่ติดลบ (rows กับ loads มาจากสองคำขอ) · ตัวเลือกชุดคาบเสรีมีป้าย "2 เพิ่มเติม" — ตัวทดสอบเทียบกับ wl_teacher_loads จริงยังจับการนับผิด — ถ้าผิด: ตัวเลขบรรทัด "สอนกลุ่มอื่น" อาจซ่อนความต่างชั่วคราวระหว่างสองคำขอ
- T9: reviewer dispatched (sonnet) on review-c95b771..dc802f5.diff
- T9: reviewer a453d2e2a37c9ed99 (sonnet): Spec ✅ · approved · C0/I0/M7 · ⚠️ 390/head screenshots → controller viewed task-9-head-subject-390.png: card layout, no overflow (resolved)
- T9: minor (deferred → final triage): M1 หัวคอลัมน์ "ครูผู้สอน 2 (ครูสอนร่วม)" ไม่ตรงคำต่อคำของสเปก "ครูผู้สอน 2" (คู่มือข้อ 10 ซ้ำ) · M2 subjectSheet แสดงชื่อเดียวกันสองช่องเมื่อ teacher=co_teacher · M3 Math.max ซ่อนการนับไม่ตรงตอนรัน (เทสจับ) · M4 สี lv-2/lv-6 ใกล้กัน · M5 เรียงครูตาม department id ไม่ใช่ลำดับแสดง · M6 ชีตครูของกลุ่มไม่มีครูที่สอนแต่กลุ่มอื่น (ตั้งใจ) · M7 HANDOFF.md ยังบอก 4 ข้อ (ตอนนี้ 8)
- T9: complete (commits c95b771..dc802f5, review clean)
- FINAL: whole-branch review dispatched (opus) on merge-base 1f2994c..dc802f5
- FINAL: review ab8a604182869b3bf (opus): merge with fixes · C1 (one keystroke on teacher select saves + confirms other teacher — reproduced) · I1 (teacher names cut 99–100% at 768–1100, 35% at ≥1280) · I2 (approve doesn't re-check completeness — reproduced) · M1–M4 · upgrade path proven on rig (stage-1 server → new server: 10 new tables, old data + session intact, no index on old tables, 1,220 rows unconfirmed) · final-review.md
- Ruling (FINAL scope): one fix wave = C1 + I1 + I2 (must) + cheap low-risk: final M1 (refuse null department on line/option PUT while round filling), M3 (head page reloads status on focus/tab click), M4 (pin "(force)" text with a py test), T9 M1 (header exactly "ครูผู้สอน 2" per spec) — ทุกข้อเล็กอื่นรอได้ตามการคัดของผู้รีวิว — ถ้าผิด: ข้อเล็กที่เหลืออยู่ในบันทึก แก้ทีหลังได้โดยไม่กระทบข้อมูล
- Ruling (FINAL R2): R2 (preview ใช้ id ลบชั่วคราว) ไม่มีผลแล้วภายใต้หลักสูตรมาก่อน — บันทึกไว้เท่านั้น
- Ruling (FINAL T8 C2): คงสีส้มที่ยอดสูงสุดไว้ก่อน แล้วถามผู้ใช้เรื่องเพดานคาบตอนสรุป — ถ้าผิด: สีเป็นแค่อันดับ ไม่ใช่คำเตือน (เปลี่ยนบรรทัดเดียวเมื่อได้เพดาน)
- FINAL: fix wave dispatched (opus, fresh) · FIX_BASE dc802f5
- FINAL: fix wave done 732e5ff..a38a174 (27/0, mutations 21/21 + 41/41, walks ALL OK at 1280/390/1024/1093/1440, names cut 0% everywhere, C1 RED→GREEN shown) · concerns: M1 also refuses POST without dept while filling · teacher field = transparent select over wrapping text · pending values expire per field · loads panel below list at 1024–1279 · focus reloads status only
- FINAL: re-review a4e22c52bb83ed154 (opus): 7/7 ADDRESSED · NEW Important: "ยืนยันแถวที่เลือก" confirms last-term teacher on a row with an unsaved draft (repro: psql 1|f|t → 1|t|f, screen switches) · minor: drafts lost on collapse/filter/tab change, submit dialog silent · minor (untested): Firefox Enter with list open
- Ruling (FINAL residual): แก้เพิ่มเฉพาะจุดนี้หนึ่งรอบ + ตรวจซ้ำแคบ แทนการ "พักไว้ให้ผู้ใช้ตัดสิน" ตามกติกาไม่มีรอบแก้ที่สอง — ผู้ใช้สั่ง "ทำต่อให้จบเลย" (ขึ้นเว็บ) และข้อนี้ขัดกฎของผู้ใช้เอง ("ยังไม่ยืนยันหายได้เพราะคนกด/เลือกครูเท่านั้น" — จอแสดงครูหนึ่งแต่ยืนยันอีกคน) ปล่อยขึ้นเว็บทั้งที่รู้ไม่ได้ · ทาง: bulk confirm ข้ามแถวที่มีร่าง + บอกจำนวน — ถ้าผิด: เสียหนึ่งรอบแก้/ตรวจ (ราว 30–40 นาที)
- Ruling (FINAL upgrade test): ใช้ผลลองอัปเกรดของผู้รีวิวทั้งสาขา (บน dc802f5: เซิร์ฟเวอร์ขั้นที่ 1 → รุ่นใหม่ ฐานเดียวกัน) แทนการลองซ้ำ — รอบแก้หลังจากนั้นไม่มี DDL (ตรวจ diff dc802f5..a38a174: ไม่มี CREATE/ALTER/INDEX/DROP) — ถ้าผิด: เซิร์ฟเวอร์บน Render ไม่ขึ้นหลัง merge → revert merge commit ครั้งเดียว
- FINAL: targeted fix dispatched (resume a060aee0c7b00073e) · FIX_BASE a38a174
- FINAL: targeted fix 9576db9 (27/0, mutations 27/27, RED (9)→psql 1|t|f · GREEN (8) skip 1, psql 1|f|t, draft kept; bulk assign clears draft; submit box counts drafts; walks 43/43, 100/100, 15/15) · re-review dispatched (sonnet)
- FINAL: re-review-2 a8b2ca98c6f544446 (sonnet): ADDRESSED · no new Critical/Important · manual §9.3 line added by controller (328ce8d)
- FINAL: controller verification on 328ce8d: tests/run.sh 27/0 · workload lint clean · build ok
- FINAL: whole-branch review clean after fix wave + 1 targeted fix · ready to merge


---

# ภาคผนวก: รายงานรีวิวทั้งสาขา (final-review.md)

# Final whole-branch review — เว็บลงอัตรากำลัง ขั้นที่ 2

Range `1f2994c..dc802f5` (22 commits, 50 files, +16.8k) · branch `claude/claude-code-workload-status-z0w49p` · reviewer: Opus, read-only.

## How this review was done (passes)

1. **Requirements:** read the design spec in full (§1–§9, incl. §3 prohibitions and §4.5), the plan in full (constraints, contract, Review Focus, Tasks 1–9, post-task steps), and the ledger `progress.md` in full. Per-task review files were consulted only through the ledger.
2. **Server (`mock_api.py`):** read every diff hunk outside the new block: schema comment and DDL, stage-1 subject routes, and the `_wl_import_rows` split. Then read the stage-2 block 15123–17390 line by line: curriculum helpers and routes, the round open/close/cancel/sync code, head writes, submit/approve/return, and loads. Task 1's `wl_round_proposal` (14753–15122) was only skimmed for reads and mutations of globals, because it already had two Opus reviews.
3. **Frontend (`workload/src`):** read `App.tsx`, `roundApi.ts`, `round.ts`, `sheets.ts` and `HeadFillPage.tsx` in full. Read `RoundOverview.tsx`, `CurriculumEditor.tsx`/`CurriculumPage.tsx`, `curriculumApi.ts` and `curriculum.ts` only where they touch force, approve and seed. Diffed `api.ts`, `index.html` and `tailwind.config.js`.
4. **Tests:** `bash tests/run.sh` gave **ผ่าน 27 · ไม่ผ่าน 0**. I looked at how the harness works (a fake DB that parses `_WL_SCHEMA` and checks FK at commit) and at the cross-language pins: `wlsheets.ts` calls the real `wl_teacher_loads` through python3, and `wlround.ts` pins server text.
5. **Docs:** read the outline of `docs/workload-setup.md` and the sections on rounds and heads.
6. **Live rig** (throwaway Postgres + real FastAPI; servers stopped afterwards, worktree removed, checkout unchanged at `dc802f5`):
   - **Upgrade rehearsal:** the stage-1 server at `1f2994c` wrote the data, then the new server ran on the same database.
   - **Width measurement** of the head fill page at 768/900/1024/1100/1280.
   - **Keyboard repro** of auto-confirm.
   - **Approve-on-incomplete repro.**

---

### Strengths

- **All three §3 prohibitions hold on the server for every path I traced.**
  - (1) Every timetable global is only read. `_wl_timetable_source` deep-copies, `/groups` and `/rooms` build new dicts, and all 36 new routes are under `/api/workload/` (checked mechanically).
  - (2) A head's read scope is forced to their own department in `_wl_read_scope`, so a `department_id` they send is ignored. Each write re-reads the line's department after locking the round. Loads return only numbers, and only for related teachers.
  - (3) Prefill writes `confirmed=False`/`from_plan=True`, sync-added rows start empty, and clearing a teacher makes the row unconfirmed again. The one real gap is a UI path (C1 below), not the server.
- **Production upgrade is safe (proven on the rig).**
  - On a database the stage-1 server had populated (143 teachers, 272 subjects including a deliberately duplicated code, 2 codes, a live session), the new server created the 10 new tables on its first request.
  - Existing rows and the session token stayed valid, and there are no new indexes on `wl_codes`/`wl_teachers`/`wl_subjects` (the same 7 indexes before and after).
  - Seeding and opening a round gave **1,220 rows, 0 confirmed, 1,220 `from_plan`, 11 department statuses**. A restart re-ran the DDL harmlessly.
  - The legacy duplicate code gives a clear Thai 409 instead of a 503 or 500.
- **The locking design is careful and documented.**
  - Every write that touches round data takes the round row lock first: FOR SHARE for head writes, FOR NO KEY UPDATE for curriculum writes (which then take FOR UPDATE on all rows during sync), FOR UPDATE for open, close and cancel.
  - The department status lock comes second, then the target rows. This gives one global order, so I found no deadlock or lost update between head writes, sync, submit/approve/return and close.
  - The one known hole (the window while POST /rounds runs) is documented in the ledger.
- **The counting rules have one owner and cross-language tests.**
  - `wl_fill_counts`, `wl_submit_blocker` and `wl_can_edit` are mirrored by `fillProgress`, `submitState` and `editState`, and the tests pin the Thai text.
  - `teacherSheet` is tested against the real Python `wl_teacher_loads`.
  - The fixture shared with `teacherLoads` in `frontend/` keeps the two websites from disagreeing.
- **The contract guards in `round.ts` match the server shapes exactly.** I compared `isRound`, `isRoundRow`, `isRoundOption`, `isDeptStatus` and `isTeacherLoad` with `wl_round_view`, `_WL_ROUND_ROW_SELECT`, `_wl_round_options`, `_wl_dept_views` and `wl_round_loads`.
- **The rest is sound.**
  - Pending/stale-value handling on 409 (Review Focus 2) and the inactive-teacher display (Focus 3).
  - The force rule that protects only human work (`_wl_entered`).
  - The curriculum log is written in the same transaction as the change.
  - Thai `detail` everywhere: every `HTTPException` in the diff carries Thai text or a Thai constant.
  - No new dependencies, and no edits under `frontend/` or `.github/`.
- **The manual is thorough and written for non-programmers**, including the spec test table and the "explain to users why elective totals differ" notes.

---

### Issues

#### Critical (Must Fix)

**C1. One stray keystroke on a teacher dropdown saves a different teacher and marks the row confirmed.** (Ledger T8 M5 "HIGH". I am raising it to Critical with proof.)

- **Where:** `workload/src/pages/HeadFillPage.tsx:885` (`onChange={(v) => void commit({ teacher_id: v }, "auto")}`) combined with `mock_api.py:16780` `wl_apply_teacher_change` (a teacher sent without `confirmed` means confirmed=True).
- **What's wrong:** a `<select>` fires `change` on every ArrowUp, ArrowDown or type-ahead letter while it is focused and closed. This happens in Chrome and Edge on Windows and Linux, which are the school's machines.
  - **Repro on the rig** (1280px, head of department 1): focus the first row's teacher select and press ArrowDown once. In the database the row went from `teacher_id 1, confirmed f, from_plan t` to `teacher_id 2, confirmed t, from_plan f`, and the screen showed "✓ ยืนยันแล้ว".
  - A user who clicks a select, presses Esc and then uses the arrow keys to scroll the page silently confirms the wrong person. The row turns green and drops out of the "ยังไม่ยืนยัน" filter.
- **Why it matters:** this defeats the safeguard behind §3 prohibition 3 ("ป้าย 'ยังไม่ยืนยัน' ต้องหายเพราะคนกดเท่านั้น"). A row leaves "from last term, unconfirmed" without the person deliberately choosing a teacher, and the result is wrong data in the deliverable that nobody will notice.
- **How to fix:**
  - Do not save on `change`. Keep the picked value as pending (`holdPending` already exists) and show an inline **บันทึกครู** / **ยกเลิก** pair, or save on Enter, so that only a deliberate action saves.
  - A deliberate teacher change still confirms in that same action, as spec §4.1 requires.
  - Add a browser-level regression check: focus the select, press ArrowDown, and assert that no PUT is sent.

#### Important (Should Fix)

**I1. Teacher names are unreadable in the fill table at every width from 768px up; at 768–1100px, 99–100% of names are cut.** (Ledger T8 ⚠️ widths.)

- **Where:** `HeadFillPage.tsx:384` (`lg:grid-cols-[minmax(0,1fr)_300px]`) and `:674`/`:861`. The row grid is `md:grid-cols-[1.5rem_5.5rem_minmax(0,1.35fr)_minmax(0,1fr)_2.75rem_minmax(0,1fr)_8.5rem]`, so 22.75rem is fixed plus three fractional columns.
- **Measured** (Playwright, real data, 143 teachers; median name 154px, longest 225px):

  | Viewport | Select width | Text area | Names cut off |
  |---|---|---|---|
  | 768 | 127px | 103px | 99% |
  | 1024 | 99px | 75px | 100% |
  | 1100 | 130px | 106px | 99% |
  | ≥1280 (page max width) | 186px | 162px | 35% |

  - At 1024 the select shows "นางกุลจิ" / "นางสาว" / "นายวิญ".
  - 1366×768 laptops at Windows' default 125% scaling render at about 1093 CSS px, which is the most common school laptop setup.
- **Why it matters:** the head's whole job is "ตรวจชื่อครูของแต่ละห้อง แล้วกดยืนยัน". If they cannot read the name, they cannot check it, so they either open every dropdown or confirm blind.
- **How to fix:**
  - Give the teacher column real width: `minmax(13rem, 2fr)`.
  - Fold co-teacher, lab room and note into one compact "รายละเอียด" cell, because these are rarely used.
  - Switch to the stacked card layout below `xl` (or keep the 300px loads panel below the list until `xl`/`2xl`).
  - Alternatively, render the chosen teacher as wrapping text with a compact "เปลี่ยน" select beside it.
  - Re-check with screenshots at 1024, 1093, 1280 and 1440.

**I2. A department can be "approved" with rows that have no teacher; nothing re-checks completeness after submit.**

- **Where:** `mock_api.py:17353` `_wl_review_target` / `:17365` `wl_dept_approve` (status check only), together with `_wl_sync_round` (`:16541` inserts teacher-less rows into any department, whatever its status).
- **Repro on the rig:**
  1. Head 1 confirms everything and submits (108/108).
  2. Admin adds a curriculum line for department 1 while the round is filling.
  3. Approve returns **200**, giving `{status: approved, rows: 109, confirmed: 108, missing_teacher: 1}`.
- **Why it matters:** the spec's rule "กลุ่มกดส่งไม่ได้จนกว่าทุกแถวของกลุ่มจะยืนยันแล้วและมีครูผู้สอน" is meant to make submitted/approved mean complete.
  - Curriculum edits during filling, which are explicitly supported, silently break that, and the head cannot fix it because the department is locked.
  - The admin is told only by a progress bar that is not full on the card.
  - Stage 3 will export from approved departments.
- **How to fix:**
  - In `wl_dept_approve`, run `wl_submit_blocker(*_wl_round_items(cur, rnd, dept))` and answer 409 in Thai when it fails, for example: "ตั้งแต่กลุ่มส่งมา มีรายการที่ยังไม่มีครู/ยังไม่ยืนยัน N รายการ — ตีกลับให้กลุ่มกรอกก่อน".
  - In `RoundOverview` show a warning line on submitted/approved cards when `confirmed < rows`.
  - Add a test in `wlflow.py`.
  - This keeps "admin edits don't change department status" (§4.3) intact.

#### Minor (Nice to Have)

- **M1. The "every line/option has a department" rule is enforced only when the round is opened.**
  - `mock_api.py:15978` (PUT line) and `:16162` (PUT option) accept `department_id: null`, and changing department moves rows, during filling.
  - Rows with no department disappear from every head, and the overview has no "ไม่ระบุกลุ่มสาระ" card.
  - Fix: refuse null departments on these PUTs while a round is filling (Thai 409), or add a "ยังไม่ระบุกลุ่มสาระ N รายการ" card to the overview.
- **M2. Moving a line to another department, or changing its subject, keeps each row's `confirmed`.**
  - The new department's head sees "✓ ยืนยันแล้ว" on rows they never confirmed.
  - This is an admin action and it is logged, but consider resetting `confirmed` on the affected rows when `department_id` or `subject_id` of a line changes during a round.
- **M3. The head page never refreshes department status while it stays mounted.**
  - `HeadFillPage.tsx:106` only re-runs on `[round.id, round.status, statusTick]`, and re-clicking the active tab calls `reloadRounds()` but does not remount.
  - After the admin returns (ตีกลับ) a department, a head who left the page open keeps seeing "ส่งแล้ว … อ่านอย่างเดียว" without the return note until they press F5 or switch tabs.
  - Fix: reload statuses on window focus or when the tab is clicked.
- **M4. The force dialog depends on the literal "(force)" in the server's Thai 409** (`curriculum.ts:587`, `mock_api.py:16533`), and no Python test pins it.
  - If someone rewords the message, the admin loses the force path entirely.
  - Fix: add a one-line test in `wlopen.py`, or return a machine-readable flag. This is ledger T6 M3.

---

### Triage of deferred minors and ⚠️ from the ledger

**Must fix before merge**
- T8 M5 (HIGH): the select saves on keyboard change. **Fix now: C1, Critical, proven.**
- T8 ⚠️ widths 768–1279. **Fix now: I1, measured; also affects ≥1280 for 35% of names.**
- T9 M7: `docs/HANDOFF.md` still says 4 items. **Update in the merge commit, as plan step "หลังจบ 3" requires.**

**Can wait.** One line each; "after merge" means a follow-up.

| Ledger item | Verdict and reason |
|---|---|
| T1 · pool fallback matches the 2nd half of a double period at any time | Can wait: seed-only, rare, and the admin reviews the curriculum. |
| T1 · activity block covering a plan row with more weekly periods than placed hours | Can wait: only incomplete timetables, and seed-only. |
| T1 · activity key is the exact supervisor set | Can wait: rare in data the program writes. |
| T2→T3 items (FK at commit, PUT-same-code reset, concurrent seed 500, dropped hook result) | Already fixed in T3. Verified: code comparison, `_wl_unique_or_409`, `_wl_sync_note`. |
| T3 · deadlock / M1 window during POST /rounds | Can wait: needs two concurrent curriculum edits at the moment of opening, and there is a single admin code. Fix later with `pg_advisory_xact_lock(year*10+semester)`. |
| T3 · PUT reads `old` before the lock, so a queued writer compares stale values | Can wait: needs two admin tabs. Cheap fix: re-read `old` after `_wl_refuse_locked`. |
| T4 M1 · PUT with the same `teacher_id` confirms | Can wait: the page sends only changed fields. It does not cover C1, which picks a *different* teacher. |
| T4 M2 · confirmed with no teacher via the API | Can wait: still counted as missing, so submit is not affected. |
| T4 M3 · concurrent writes can make teacher equal co-teacher, or duplicate a teacher in an option | Can wait: needs two writers on the same row, and loads are unaffected. |
| T4 M4 · `_wl_refuse_edit` duplicates the head-scope logic | Can wait: refactor. |
| T4 M5 · the fixture loop covers only teachers in the file | Can wait: tighten the test later. |
| T4 M6 · only the last submit/review is kept | Can wait: the spec only asks to record who and when. |
| T5 M1–M4 (a11y: input border 1.29:1, focus ring clipped, mute chip 4.36:1, colour-only button) | Can wait. Recommended soon: M1 (input borders under 3:1, WCAG 1.4.11) hurts older eyes on a form-heavy site. |
| T6 M1 · force dialog busy state / no focus trap | Can wait. |
| T6 M2 · focus return after adding a line | Can wait. |
| T6 M3 · "(force)" string contract | Can wait. Add the pin test (my M4). |
| T6 M4 · term-pick logic in TSX untested | Can wait. |
| T6 M5 · SeedCard can fall back to "timetable" silently | Can wait: unreachable (the copy button renders only when `sources.length > 0`). One-line hardening later. |
| T6 M6–M9, 401 not clearing the seed box, one term only, late registry fill | Can wait. |
| T7 M2–M6 | Can wait. |
| T8 M1 (HIGH) · bulk 409 unmounts the bar | Can wait: the page reloads and shows the read-only notice with the reason (the department is locked anyway). Only the lock/close path loses the picked teacher; an inactive-teacher 409 keeps the bar and its message. |
| T8 M2 · stale error messages | Can wait. |
| T8 M3 · inactive-teacher 409 doesn't reload the teacher list | Can wait: the message tells the user to reload. |
| T8 M4 · detail form patches against the current row | Can wait: needs concurrent editing of the same row. |
| T8 M6 · "ยังไม่ยืนยัน N" counts missing rows | Can wait. Cheap: relabel "ยังไม่ครบ". |
| T8 M7, M8 · logic in TSX, duplicated code | Can wait. |
| T8 M9 · orange marks rank, not a cap | Can wait. Ask the user for the school's period cap (see Rulings). |
| T8 M10 · submit dialog doesn't warn about unsaved values | Can wait. |
| T8 M11 · link doesn't scroll to the set | Can wait. |
| T8 residuals (confirm-button error after bulk; pending value on a confirmed row) | Can wait. |
| T9 M1 · column header "ครูผู้สอน 2 (ครูสอนร่วม)" | Can wait: spec §2 itself writes "ครูผู้สอน 2 (ครูสอนร่วม)". Ask the user whether the parenthesis belongs on paper. |
| T9 M2 · same name twice when teacher equals co-teacher | Can wait: writes forbid it; only bad plan data. |
| T9 M3 · `Math.max` clamp | Can wait: accepted ruling, and the test catches miscounts. |
| T9 M4 · lv-2/lv-6 colours | Can wait. |
| T9 M5 · teacher sort by department id | Can wait. |
| T9 M6 · other-department teachers missing from the head's teacher sheet | Intended. |
| T5 ⚠️ Button hover | Accepted. |
| T7 ⚠️ guards vs the real route | Agree: I re-checked the shapes against the server code (see Strengths). |
| T9 ⚠️ 390 head | Resolved. |

---

### Rulings you disagree with

I agree with all rulings R1–R4 and every T1–T9 ruling, with the following exceptions and qualifications.

- **Partial disagreement: the ruling that rows join the curriculum line instead of copying its data.**
  - The ruling's stated cost is "after submit, sent rows change". It does not mention the consequence that matters during *filling*: a submitted or approved department can gain teacher-less rows, and approve does not notice (I2).
  - The join design is right. Pair it with the approve re-check and a card warning.
- **Mild disagreement: T8 C2, the load bar warns when total ≥ the list maximum.**
  - The busiest teacher is always orange even at 10 periods, so the colour is noise rather than a warning.
  - Keep it for now. Ask the user for the school's period cap, and until then use a neutral highlight for "highest".
- **Qualification: T3 D8, refusing to open while any option has no department.**
  - The rule is right, but it should also hold *after* opening (M1).
- **Superseded: R2, preview using temporary negative ids.**
  - Under curriculum-first, preview reads the registry and never imports, so R2 no longer applies. Harmless; just note it in the ledger.

---

### Declined to judge

- **FastAPI's English 422 for non-integer path parameters** (e.g. `PUT /api/workload/rows/abc`): this is the same pattern as the stage-1 routes and cannot be reached from the UI. It is a stage-wide decision whether to add a Thai `RequestValidationError` handler.
- **`copy.deepcopy` of timetable globals racing with timetable-program writes on another thread** (could raise "dict changed size", which becomes a Thai 500): this is a pre-existing threading model, extremely rare, and not introduced here.
- **`DEPARTMENTS` changing after a round is created** (a new department has no `wl_dept_status`, so its head cannot edit): this is a change on the timetable side, outside the spec.
- **Subjects whose code clashed with a manual stage-1 subject get no last-term prefill:** these rows show up as "ช่องครูว่าง" in the preview, which is consistent with the id-only matching rule.
- **Visual taste of the new design** (palette, spacing, the lv-* colours) beyond the a11y contrast items: subjective, and the per-task reviewers covered it.
- **Performance of recomputing loads after every save** (about 1.2k-row join): fine at this scale. I did not measure it on Neon/Render.
- **History of submit/return** (only the last one is kept): the spec only asks to record who and when.
- **Anything about stage 3** (export to the scheduler).

---

### Recommendations

1. **Fix C1 first and add a browser regression check for it.** It is the one path where the system can produce confidently wrong data.
2. **For I1, re-verify at 1024, 1093, 1280 and 1440, not just 1280/390.** The plan's screenshot widths (1280 and 390) were the gap that let this through; future plans should include 1024 and about 1093 (1366 at 125% scaling).
3. **Add the approve re-check (I2) with a `wlflow.py` test.** It is about 5 lines of server code.
4. **Update `docs/HANDOFF.md` in the merge commit**, as the plan requires.
5. **After merge:** pin the "(force)" contract (M4), keep the department rule enforced after opening (M1), refresh status on focus (M3), raise input-border contrast (T5 M1), and ask the user two questions: the period cap (T8 C2/M9) and whether the paper header should say "ครูผู้สอน 2" or "ครูผู้สอน 2 (ครูสอนร่วม)".
6. **Before handing it to the school, do the manual's §14 check on a copy of the real database.** The upgrade path itself is proven above.

---

### Assessment

**Ready to merge? With fixes.**

The server side is solid: all three §3 prohibitions hold, locking is consistent, and the production upgrade is proven safe on a populated stage-1 database.

Three things must be fixed first:
- **C1:** stop auto-saving on a keystroke.
- **I1:** make teacher names readable on the fill table.
- **I2 (recommended in the same pass because it is cheap):** make approve re-check completeness.

Then update `HANDOFF.md` and merge.
