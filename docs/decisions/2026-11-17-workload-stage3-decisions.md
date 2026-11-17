<!-- สำเนาสมุดงาน (ledger) ของ subagent-driven-development สำหรับแผนขั้นที่ 3 (สร้างเทอมใหม่จากรอบอัตรากำลัง) — ต้นฉบับอยู่ใต้ .superpowers/ ซึ่ง .gitignore กันไว้และหายไปพร้อมเครื่องชั่วคราว · บรรทัดที่มีคำว่า Ruling คือการตัดสินใจที่ทำแทนผู้ใช้พร้อมราคาถ้าตัดสินผิด · บรรทัดที่มี minor (deferred คือของที่รู้แล้วว่ายังไม่ได้แก้ · ภาคผนวกท้ายไฟล์: รีวิวทั้งสาขา ตรวจซ้ำรอบแก้ และผลลองอัปเกรด -->

# SDD ledger — plan: docs/superpowers/plans/2026-11-17-workload-stage3-new-term.md

Spec: docs/superpowers/specs/2026-11-17-workload-stage3-new-term-design.md (approved by user 17 Nov "ทำเลย เอาให้จบเลย") · main spec docs/superpowers/specs/2026-11-06-workload-entry-site-design.md §7–8
Branch: claude/claude-code-workload-status-z0w49p restarted from main fc7e560 (stage 2 merged as anun268455-stack/school-scheduler#2)
Baseline: `bash tests/run.sh` → — ผ่าน 27 · ไม่ผ่าน 0 — · rig: $WS/pg/pg.sh + server.sh (recreated) · venv $WS/venv

## Preflight scan
| tasks | produces → consumes / self-check | finding |
|---|---|---|
| T1↔T2 | `registry_plan` maps (teacher_map, subject_map, typed_map) → `plan_from_round(maps)`; both in term_from_round.py | consistent |
| T1↔T3 · T2↔T3 | `_term_build` composes both; `source`/`outgoing` shapes in shared contract | consistent |
| T3↔T4 | `_wl_export_source` `_term_build` `_wl_registry_lock` `_term_outgoing` | consistent |
| T4↔T5 | `export_report` keys prior_status/teachers/subjects/created_wl_subjects/bound_lines/bound_options | consistent |
| T3/T4↔T6 | `/api/terms/rounds` · preview `round` block · POST body round_id/admin_code · response `report` | consistent |
| T3↔T5 | exported_* columns (T3) · refusals on exported rounds (T5) | consistent |
| T1 self | test_defaults_match_bulk_routes calls real bulk routes → mutates TEACHERS/SUBJECTS/_counters | Ruling P1 |
| T2 self | live-shape fixture (ข) built by calling route functions in-process → mutates SLOTS/REQUIREMENTS globals in a test | Ruling P1 |
| T3 self | `/api/terms/rounds` vs existing `/api/terms/{term_id}/data`/`unlock` — no `GET /api/terms/{id}` exists, no route clash | clean |
| T4 self | crash/failure-injection needs a hook in product code | Ruling P2 |
| T4/T5 self | `_term_rotate(cur=None)` / `_term_swap_active(cur=None)` refactors vs "old path untouched" + terms.py/termguard.py unmodified | consistent if default unchanged (reviewer checks) |
| T6 self | ts tests added to existing files (terms.ts, wlround.ts) → count stays 32 | consistent |
| Global | "ห้ามโค้ดใหม่เขียน SLOTS" vs T2 fixture writing SLOTS | test code only — Ruling P1 |

- Ruling P1: tests that call real route/global functions to build fixtures (T1 defaults, T2 live-shape) must save and restore every module global they touch (try/finally, deep copies) — "ห้ามเขียน SLOTS" binds product code, not throwaway test fixtures — cost if wrong: a leaking test pollutes later tests in the same file (caught by inputs-not-mutated tests)
- Ruling P2: T4 failure/crash injection uses ONE env var read at call time (name chosen by implementer, e.g. SCHED_TEST_FAIL_AT=<step>), unset = no effect, documented in a Thai comment; production never sets it — cost if wrong: a dormant test hook in product code
- Ruling P3: `GET /api/terms/rounds` computes `usable` against the round's own year/semester; POST compares with the requested year/semester — the dialog locks year/semester to the round anyway — cost if wrong: none visible

## Tasks
- T1: dispatched implementer (opus) · BASE 5c099a8 · expect 28/0
- T1: implementer a4b213c35abd4df1f DONE_WITH_CONCERNS (3ee16d0, 28/0, 23 tests, 6 mutations caught) · concerns: writeback.bind_wl_subjects added · new_wl_subjects carry type/duration/is_activity/is_elective · id allocation skips ids already used/held · is_elective ownership · report lists not counts, Decimal credits, reasons-excluded subjects absent from maps
- Ruling (T1 C4): เว็บเป็นเจ้าของ is_elective ตามแบบ/สเปกหลัก — แต่หน้าสรุป (T3 report + T6) ต้องแสดงครู/วิชาที่จะถูกแก้ทีละคนพร้อม "ช่อง: ค่าเดิม → ค่าใหม่" ให้ admin เห็นก่อนยืนยัน — ถ้าผิด: ค่าในโปรแกรมที่ติ๊กเองหลังดึงเข้าเว็บถูกทับ (admin เห็นในสรุปก่อนกด แก้ได้ที่ทะเบียนวิชาของเว็บ)
- T1: reviewer dispatched (opus) on review-5c099a8..3ee16d0.diff
- T1: reviewer acadf548decc0bf67 (opus): Spec ✅ · approved · C0/I0/M6 · task-1-review.md
- T1: minor (→ T2 addendum, fix with tests): M1 กันวิชาซ้ำกรณีวิชาเว็บสองตัวไม่มี sched_id ใช้รหัสเดียวกัน (term_from_round.py:313) ไม่มีตัวทดสอบ + ข้อความเหตุชวนเข้าใจผิด · M2 บรรทัดพิมพ์รหัสเองไม่มีชื่อ ผูกด้วยรหัสแล้วทับชื่อวิชาในโปรแกรมเป็นรหัส + ล้างกลุ่มสาระ (ลองแล้วเกิดจริง) · M3 วิชาเว็บที่ถูกอ้างผ่านบรรทัดพิมพ์รหัสเองได้ credits None
- T1: minor (deferred): M4 แก้รหัสวิชาที่ผูกแล้วไปซ้ำวิชาอื่นในโปรแกรมที่เว็บไม่รู้จัก ไม่มีเตือน · M5 registry_plan ~190 บรรทัด + _*_NORM ไม่ผูกกับ *_OWNED · M6 ตัวทดสอบยึด 143/271
- T1: ⚠️ → T3 addendum (source ordering, inactive-in-program report) · T4 addendum (_mark_elective after subjects)
- T1: complete (commits 5c099a8..3ee16d0, review clean; M1–M3 carried to T2)
- T2: dispatching implementer (opus) · BASE 3ee16d0 · expect 29/0
- T2: implementer ae4c017279730b9d1 DONE_WITH_CONCERNS (e275ff7, 29/0, 20/20 mutations; round trip ก 1220/13/44 · ข 1449/13/45 + 227 elective rows, teacherLoads equal for every teacher) · M1–M3 of T1 fixed with tests
- Ruling (T2 C1): คู่สอนร่วมสองแถวคาบเท่ากันในแผนเดิม → เขียนกลับเป็นสองแถวชี้กัน (รูปเดิม) — ไม่งั้นชุด ข ยอดคาบของครูสอนร่วมหาย (20→17) — ถ้าผิด: ลบบล็อก `shaped`
- Ruling (T2 C3): แถวแผนที่เขียนต้องผ่านกฎ check_row — เพิ่มวิชาเข้าหลักสูตรที่ผูกกับห้อง (ค่ามากสุด) — แบบข้อทดสอบ 9 — ส่งกลับให้ผู้ลงมือแก้ก่อนรีวิว — ถ้าผิด: หลักสูตรของโปรแกรมมีวิชาเสรีเพิ่ม (ซึ่งแผนเดิมก็ต้องมีอยู่แล้วจึงสร้างแถวผ่าน route ได้)
- T2 C2 (stage-2 bug, deployed): wl_prefill สลับคาบของคู่สอนร่วมคาบไม่เท่ากันเมื่อแถวแรกมีคาบมากกว่า → T3 addendum ข้อ 5 (แก้ + ตัวทดสอบ)
- T2: C3 fixed d4b23f1 (29/0; check_row 0 refused on ก 1220 and ข 1449, 119 curriculum rows added in ข; curriculum.diff clean on 93 rooms) · residual note: curriculum shared by a room inside and outside an elective set would show 'add S' for the outside room · reviewer dispatched (opus)
- T2: review a2db6c6f78eedffca (opus): Spec ❌ · changes requested · C0/I1/M6 · I1 plan-mandated: rows covered by level-wide activity dropped silently (แนะแนว rows 14→2, teacher 141 loads 20→8)
- Ruling (T2 I1, plan-mandated): ชุดกิจกรรมใช้กฎ "ทำตามรูปของแผนเดิม" เหมือนแถวแผนวิชาเสรี (เขียนแถว (g,S) ที่แผนเดิมมี ครูเดิมถ้ายังคุม ไม่งั้นครูคุมคนแรก คาบเท่าเดิม) + ชุดยังอยู่ในรายการ "ต้องลงคาบเอง" — แบบข้อทดสอบ 1 (ยอดคาบรายครูเท่าเดิม) ชนะข้อความในแผนที่ให้ใส่รายงานอย่างเดียว — ถ้าผิด: แถวกิจกรรมถูกจัดซ้ำ? ไม่ — โปรแกรมเห็นว่ากิจกรรมสอนแทนเมื่อลงคาบกิจกรรมแล้ว (เหมือนเทอมเดิม)
- T2: fix round 1 dispatched (resume ae4c017279730b9d1) · FIX_BASE d4b23f1
- T2: minor (→ T3 addendum): m1 ช่องที่ยกไม่ได้เพราะไม่มีในแผนเดิมไม่ถูกนับ (แบบให้นับ) · m2 parallel_group_key "" กับ None เทียบตรง ๆ → เตือนเท็จ · m3 ตัวเลือกซ้ำ (วิชา, ครู) ถูกทิ้งเงียบ · m6 หลักสูตรที่ห้องในและนอกชุดใช้ร่วมกันจะขึ้น "เพิ่ม S" ใน diff ของห้องนอกชุด → แสดงในสรุป
- T2: minor (deferred): m4 ไปกลับไม่ได้ทดสอบการหัก unconverted และไม่เทียบ room_id ของตัวเลือก · m5 plan_from_round ~270 บรรทัด
- T2: ⚠️ → T3 addendum: หลังแก้ C2 (wl_prefill) กลับลำดับคู่สอนร่วมคาบไม่เท่าในชุด ข (wlexportplan.py:682–692) ให้ไปกลับคุมการแก้นั้น
- T2: fix round 1 done 48c9c5b (29/0, 6/6 mutations; ข: 3 activity sets, 24 activity rows, teacher 141 20→20, all 139 teachers equal) · re-review dispatched (sonnet)
- T2: fix round 1/5 (1 addressed, 0 open; commits d4b23f1..48c9c5b) · re-reviewer a11a090043061d4bc (sonnet)
- T2: minor (→ T3 addendum ข้อ 9): skipped มี source ใหม่ (option / activity_row) · minor (deferred): ห้อง+วิชาที่ทั้งชุดคาบเสรีและกิจกรรมครอบใช้ชนิดของชุดแรก ไม่มีตัวทดสอบ · docstring ยังเรียก "แถวแผนของวิชาเสรี" บางจุด
- T2: complete (commits 3ee16d0..48c9c5b, review clean after 1 fix round)
- T3: dispatching implementer (opus) · BASE 48c9c5b · expect 30/0
- T3: implementer a6977a037fa4b0116 DONE_WITH_CONCERNS (ca3cd5f, 30/0, 19/19 mutations; real PG preview 1220/13/44, 16 tables unchanged, revision 0→0, lock test ~4.1s wait) · wl_prefill swap bug fixed (BASE swaps, ca3cd5f correct) · extra: registry lock also in curriculum seed route; plan_from_round orders unequal co-teach pair like outgoing plan
- Ruling (T3 C1): รอบที่ปิดแล้วแต่มีรายการถูกข้าม (เช่นห้องถูกลบในโปรแกรม) ส่งไม่ได้ — ยอมรับ ไม่เพิ่มทาง "ยอมรับว่าข้าม" (ห้ามสร้างเทอมที่หายแถวเงียบ ๆ ตามแบบ) · คู่มือบอกวิธี: คืนห้อง/ครูในโปรแกรม หรือติดต่อผู้ดูแลระบบ — ถ้าผิด: กรณีหายากที่ต้องแก้ข้อมูลในโปรแกรมก่อนส่ง
- Ruling (T3 C2): เพิ่มเหตุ "มีเทอม … ในโปรแกรมอยู่แล้ว" เมื่อ app_terms มีปี/ภาคของรอบ (รายการรอบ · preview · POST) → T4 addendum · หน้าต่างเลือกรอบใช้ได้ล่าสุดเป็นค่าเริ่มต้น → T6 addendum — ถ้าผิด: รอบเก่าขึ้นว่าใช้ไม่ได้ (ถูกต้องอยู่แล้วเพราะปุ่มเดิมก็ปฏิเสธ)
- Ruling (T3 C3/C4/C5/C7/C8): รับตามที่ทำ (export_report ถึงหัวหน้าได้ — มีแค่ชื่อ/ตัวเลข · ล็อกก่อนตรวจสิทธิ์ · GET ไม่ล็อก · ALTER ล็อกสั้นตอนเริ่ม process · wl_prefill กรณีคาบถูกแก้หลังตั้งต้นมีธงเตือนอยู่แล้ว) — ถ้าผิด: ไม่มีผลกับข้อมูล
- T3: reviewer dispatched (opus) on review-48c9c5b..ca3cd5f.diff
- T3: reviewer a95bec9d87b3d3471 (opus): Spec ✅ · approved · C0/I0/M2 · wl_prefill fix verified on 200k random cases (166 diffs, all the intended case) · task-3-review.md
- T3: minor (→ T4 addendum 5): m1 ธุรกรรมแรกของ process รัน DDL (ALTER = ACCESS EXCLUSIVE บน wl_rounds จนจบธุรกรรม) ก่อนล็อกทะเบียน → deadlock ได้ (ทำซ้ำแล้วด้วย psql) — แก้: commit DDL แยกก่อน yield ใน _wl_db
- T3: minor (→ T4 addendum 6): m2 ข้อความเหตุข้อ 5 ชี้ไปหน้าหลักสูตรผิดที่ เมื่อบรรทัดผูกวิชาที่รหัสว่าง (ต้องแก้ที่ทะเบียนวิชา)
- T3: ⚠️ → T6 addendum: /api/terms/rounds 503 → หน้าต่างถอยเป็นแบบเดิม ไม่ขวางปุ่มเดิม
- T3: complete (commits 48c9c5b..ca3cd5f, review clean)
- T4: dispatching implementer (opus) · BASE ca3cd5f · expect 31/0
- T4: implementer a55f88d98c9d76b0c DONE_WITH_CONCERNS (4cbcd06, 31/0, 14 tests, 26/26 mutations) · real PG: round trip 1220/0 diff, 13/44, loads equal · concurrent 200+409 · crash after COMMIT consistent · injected failures all restore · pull-teachers waits · revision +1 · deadlock fixed (BASE deadlocks, HEAD not) · old button byte-identical vs BASE
- T4: concerns = observations (new state visible in memory before COMMIT — same exposure as old button · extra "new" key in export_report · one wlguard test changed per addendum 5) · controller fixed rig server.sh stop to wait for exit
- T4: reviewer dispatched (opus) on review-ca3cd5f..4cbcd06.diff
- T4: reviewer a2ca2f959814534cb (opus): Spec ✅ · approved · C0/I0/M3 · all 7 checks pass · task-4-review.md
- T4: minor (→ T5 addendum): m1 DDL commit แยกแล้วยัง deadlock กับการสร้างเทอมได้ (CREATE UNIQUE INDEX IF NOT EXISTS ถือ ShareLock ก่อน ALTER) — แก้: DDL ทีละคำสั่งแบบ autocommit (ผู้ตรวจลองแล้วหาย) + แก้คอมเมนต์ · m2 _term_admin_check ไม่มีเพดานคำขอพร้อมกันแบบล็อกอิน (_WL_LOGIN_INFLIGHT) · m3 การแก้ข้อมูลในโปรแกรมระหว่าง _term_outgoing กับ apply/COMMIT ถูกทับเงียบ — แก้: เทียบ REVISION ก่อน apply และก่อน COMMIT → 409 ไทย
- T4: ⚠️ → T5 addendum: ย้อนต้องตั้ง closed_at NULL เมื่อ prior_status = filling · unlock ถือล็อกทะเบียนเป็นคำสั่งแรก
- T4: minor (deferred): wl_rounds_create อ่านตัวแปรของโปรแกรมโดยไม่ถือล็อกทะเบียน (กระทบแค่ค่าแนะนำครูเทอมก่อน) · COMMIT ที่ล้มแบบกำกวมนับเป็นการย้อน (เหมือนปุ่มเดิม)
- T4: complete (commits ca3cd5f..4cbcd06, review clean)
- T5: dispatching implementer (opus) · BASE 4cbcd06 · expect 32/0
- T5: implementer aabc2269aec1cdc87 BLOCKED (uncommitted; 31/1 — terms.py::test_unlock_swaps_in_one_transaction_closing_active_first fails because unlock now reads wl_rounds once via _term_round_exported_to and the fake fetchone always returns (99,)) · real PG all pass: m1 deadlock gone · m3 409 + edit survives · m2 8/16 got 429 · 24 write routes refuse exported round · unlock restores sched_id/lines/options/round
- Ruling (T5 block): อนุญาตแก้ tests/py/terms.py 2 บรรทัดใน _with_fake_db (stub `_term_round_exported_to` = False) ไม่แตะ assertion — ส่วนนั้นแทนฟังก์ชันอ่านฐานตัวอื่นแบบเดียวกันอยู่แล้ว เจตนาของข้อผูกมัด "terms.py ไม่แก้" คือกันพฤติกรรมทางเดิมเปลี่ยน ซึ่งไม่เปลี่ยน — ถ้าผิด: ข้อผูกมัดของแผนถูกผ่อนหนึ่งจุดที่ผู้ตรวจเห็นได้ใน diff
- T5: minor (deferred): ปลดล็อกเทอมที่สร้างจากรอบซ้ำอีกครั้งหลังย้อน → ปุ่มดึงครูสร้างแถวซ้ำ 1 แถว (ห่วงโซ่ที่หายาก) · หลัง 409 ของ m3 app_state ถือสถานะที่ยังไม่ COMMIT ราว 1 วินาทีแล้วแก้เอง · keep_closed (คืนรอบเป็นปิดเมื่อมีรอบอื่นเปิดอยู่) เป็นการตัดสินของผู้ลงมือ
- T5: DONE_WITH_CONCERNS 4298761 (32/0; terms.py only the 2 stub lines; termguard untouched) · concerns 1–5 noted (429 wording says เข้าสู่ระบบ) · reviewer dispatched (opus)
- T5: reviewer a0dacce235e83564f (opus): Spec ✅ · approved · C0/I0/M6 · ⚠️ concern 3 not rare: undo → term row stays → only way forward is unlocking the round-created term back → web registry out of step → pull creates duplicates; round editable but un-exportable
- Ruling (T5 ⚠️ → design §4.8 change): ทะเบียนของเว็บตาม "เทอมที่เปิดอยู่" ทั้งสองทิศ — ย้อน (ปลดล็อกเทอมเก่า): คืน sched_id/การผูก แต่รอบยังปิด แก้ไม่ได้ เก็บ export_report + exported_term_id (เครื่องหมาย "ย้อนแล้ว") · ทำซ้ำ (ปลดล็อกเทอมที่สร้างจากรอบกลับมา): ใส่ sched_id/การผูก/exported_at กลับในธุรกรรมเดียว (ชน → ข้าม + บันทึก) — เส้นทาง "กดเร็วไป → ย้อน → ภาคเรียนจริงมาถึง → เปิดเทอมนั้นกลับ" เกิดได้จริง — ถ้าผิด: รอบที่ย้อนแล้วแก้ไม่ได้ (แต่ก็ส่งซ้ำไม่ได้อยู่แล้วเพราะเทอมปี/ภาคนั้นมีอยู่)
- T5: fix round 1 dispatched (resume aabc2269aec1cdc87) · includes m2 (move old/old_slots/saved_cfg after lock), m4 (save again on failure when revision moved), m5 (Thai result text) — same function under change · FIX_BASE 4298761
- T5: minor (deferred): m3 DDL ทีละคำสั่ง = 22 round trip ครั้งแรกของแต่ละ process (ทางปลดล็อกเดิมจ่ายด้วย) · m6 ปลดล็อกแบบย้อนซ้ำโค้ด ~20 บรรทัดของ unlock_term เดิม
- Ruling (T5 m1): คงการเทียบ REVISION ก่อน COMMIT (การแก้ในช่อง apply→COMMIT หายเมื่อย้อน ได้ 409 แทนการทับเงียบ) · คู่มือ T6 เขียน "อย่าแก้ข้อมูลในโปรแกรมระหว่างสร้างเทอม" — ถ้าผิด: ผู้ใช้กดสร้างใหม่อีกครั้ง
- T5: fix round 1 done bc625b3 (32/0; 9 tests red→green; real PG: undo/redo twice, pull 0 rows each time, 144/144 sched_ids in open term, planted conflict skipped) · concerns: direct POST on undone round gets T4 'term exists' 409 (fine) · triggers by exported_term_id only (rarer chains with an old-button term in between could drift) · re-review dispatched (opus)
- T5: fix round 1/5 (m2 m4 m5 addressed, ⚠️ open; commits 4298761..bc625b3) · re-reviewer af2bc2dfc0c9f804f (opus): undo-by-lineage breaks one term later (S4/S5: create C after B → unlock B → unlock C → R1 undone wrongly, pull creates 2 undeletable duplicate rows) — Important · minor: redo set exported_at = now() · skipped list only in HTTP response
- Ruling (T5 round 2, replaces previous §4.8 ruling): ทะเบียนของเว็บชี้ตาม "ข้อมูลของเทอมที่เปิดอยู่" — หลังทุกการปลดล็อก ปรับเทียบ sched_id ของทุกรอบที่มี export_report (ไล่รอบใหม่→เก่า: ค่า new ที่มีอยู่ในเทอมที่เปิดชนะ · ไม่มี → old ของรอบเก่าสุดถ้ามีอยู่ ไม่งั้น NULL · ชน → ข้าม + บันทึกรายการ) · ไม่แตะสถานะรอบ (ส่งแล้วถาวร exported_at เดิม ข้อความคำนวณตอนอ่านว่าเทอมนั้นเปิดอยู่ไหม) · ไม่ถอดการผูกบรรทัด — กฎตามลำดับเทอมพังเพราะระบบไม่บันทึกว่าเทอมไหนสืบจากเทอมไหน กฎตามข้อมูลถูกทุกลำดับ — ถ้าผิด: รหัสครูของเว็บอาจชี้ค่าที่ต่างจากที่คนคาดในลำดับแปลก ๆ แต่ไม่มีแถวซ้ำและไม่ชี้ไปครูที่ไม่มี
- T5: fix round 2 dispatched (resume aabc2269aec1cdc87) · FIX_BASE bc625b3
- T5: fix round 2 done 48e229a (32/0; wl_registry_reconcile; unit S1–S5 + A↔B×2; reviewer scripts show web→missing [] and pull 0 rows every step; real PG A↔B×2, S4, conflict skipped with names) · concerns: old→missing becomes NULL (by rule) · pre-commit export reports lack created_subjects (test DB only) · archive path doesn't reconcile (unreachable after any export) · re-review dispatched (opus)
- T5: fix round 2/5 (⚠️ addressed; commits bc625b3..48e229a) · re-reviewer afa0196f0b265d0b9 (opus): fuzz 300 seeds (2,081 unlocks) 0 failures · N1 N2 S1–S5 pass · old unlock path identical except 3-line read-only gate
- T5: minor (deferred → final triage, HIGH): สองแถวย้ายไปค่าเป้าหมายเดียวกันที่ยังไม่มีใครถือ → ไม่ถูกจับว่าชน → UNIQUE → ปลดล็อก 500 และทุกการปลดล็อกถัดไปล้มเหมือนกัน (เข้าถึงไม่ได้จากแอป — ต้องแก้ฐานเองหรือรหัสวิชาซ้ำของขั้นที่ 1) — แก้ในฟังก์ชันล้วน: หลายแถวไปเป้าเดียว → ข้ามทั้งหมด + เหตุ
- T5: minor (deferred → final triage, HIGH): การปลดล็อกที่ปรับเทียบไม่เขียน app_state ในธุรกรรม → เครื่องดับหลัง COMMIT ก่อนคิวเซฟ → เริ่มใหม่บนข้อมูลเทอมที่ปิด ขณะทะเบียนตามเทอมที่เปิด → ดึงครูอาจสร้างซ้ำ — แก้: _DB_UPSERT ในธุรกรรมแบบการสร้างเทอม
- T5: info: ฐาน Postgres ทดลองมีแถวสมัยรอบ 1 ("undone") → reset ก่อนลองของจริงใน Task 6
- T5: complete (commits 4cbcd06..48e229a, review clean after 2 fix rounds + 1 block ruling)
- T6: dispatching implementer (opus) · BASE 48e229a · expect 32/0 + frontend & workload lint/build
- T6: implementer ac91a656cc5b1315d DONE_WITH_CONCERNS (da803f3, 32/0, frontend lint 0 errors (26 warnings = BASE) build ok, workload lint/build clean, Playwright real both sites, 22 screenshots) · concerns: admin code stays in disabled field after 409 · manual §16 still says waiting for stage 3 (note added) · head fill page has no exported badge · 9 decisions beyond brief in report · reviewer dispatched (sonnet)
- T6: reviewer a549ace7cec7c7e64 (sonnet): Spec ✅ · approved · C0/I0/M3
- T6: minor (deferred → final triage): M1 503 ตอนสร้างจากรอบเกิดก่อนเขียนอะไร แต่ UI ล็อกปุ่ม + "ยังไม่รู้ว่าเทอมถูกสร้างหรือยัง อย่ากดซ้ำ" สวนกับ detail · 500 ทิ้ง detail "ข้อมูลเดิมยังอยู่ครบ" · M2 คำเตือนตัวหนายังอยู่หลังสร้างสำเร็จ + ขาดช่องว่าง (ของเดิม BASE) · M3 ช่องรหัส autoComplete="off" → ควร new-password
- T6: complete (commits 48e229a..da803f3, review clean)
- FINAL: whole-branch review dispatched (opus) on fc7e560..da803f3
- FINAL: review a21db3cf6b4a4d1ef (opus): ready after I1 · C0/I1/M11 · I1 unlock-with-reconcile doesn't write app_state in-transaction (deferred HIGH #2 → must-fix) · reviewer disagrees: deferring HIGH #2 · "ถูกปิดไว้" wording for normally-closed terms · dialog default may pick current/past semester · "term exists" reason misses first-press archive collision
- Ruling (FINAL scope): one fix wave = I1 + M9 M7 M4 (cheap, same functions) + M1 (label for normally-closed terms) + M2 (first-press archive collision on a server with no saved terms — exactly production's state; default to a future-term round) + M3 (design §4.2 counts in summary) + M11 (dialog polish) · M10 → HANDOFF manual check · M5 M6 M8 wait — ถ้าผิด: ข้อที่รอเป็นช่องที่แคบมาก ไม่กระทบข้อมูลในการใช้งานปกติ
- FINAL: fix wave dispatched (opus, fresh) · FIX_BASE da803f3
- FINAL: fix wave b389703 (32/0, 12/12 mutations; I1 BASE pull created 1 row → HEAD 0 · M2 BASE list/preview "usable" but POST 409 → HEAD consistent, default = next-term round · M1 three label cases · M11 dialog) · concerns: 500 keeps button locked (ambiguous COMMIT) · M2 broader than brief (all archive refusals) · signature changes (round view takes open-term dict; plan report `pattern_rows`) · M9 ~0.5 s residual only on double fault · preview shows 44 false "is_elective ใช่ → ไม่ใช่"
- Ruling (FINAL extra): ขยายรอบแก้เดียวกันด้วย is_elective สุดท้าย = เว็บ OR อยู่ในชุดคาบเสรีของรอบ (ทั้ง patch และ report) — admin จะเห็นคำเตือนเท็จ 44 รายการทุกภาคเรียนบนข้อมูลจริง — ถ้าผิด: วิชาที่โปรแกรมติ๊กเองและอยู่ในชุดจะไม่ถูกแก้ตามเว็บ (ซึ่งยังไงก็ถูกติ๊กกลับ)
- FINAL: extra fix fe12be6 (32/0, 3/3 mutations; real PG preview subjects_patched 0, 44 set subjects stay elective after create) · re-review of whole fix wave da803f3..fe12be6 dispatched (opus)
- FINAL: re-review ad416f196fbc71bb0 (opus): 8/8 ADDRESSED · no new Critical/Important · ready to ship
- FINAL: minor (deferred): _term_running_reasons เทียบกับข้อมูลในหน่วยความจำตอนข้อมูลโรงเรียนยังโหลดไม่เสร็จ (ข้อความเหตุอาจหลอก) · M4 ไม่ครอบ COMMIT ล้มเอง · M9 เขียน app_state หลัง ROLLBACK นอกล็อกทะเบียน (ต้องสองเหตุซ้อน) · M5 M6 M8 จากรีวิวทั้งสาขา (รอได้) · M10 → HANDOFF
- FINAL: note → manual: บรรทัด "ห้อง+วิชาที่ไม่มีในแผนเดิม" จะยาวหลักร้อยเมื่อขึ้นภาคเรียนจริง (รหัสวิชาเปลี่ยนตามภาค) — คู่มือต้องบอกว่าไม่ต้องไล่ทุกบรรทัด
- FINAL: upgrade test dispatched (sonnet) · controller verification running
- FINAL: upgrade test aee1720c068608a12 (sonnet): 5/5 PASS (main fc7e560 → HEAD on same DB: md5-equal tables, same indexes, tokens work, 4 new columns; 2/2569 round unusable with Thai reason when slots present + config 2/2569; 1/2570 created 200, 1220 rows, pull 0 rows, restart consistent) · controller: tests 32/0, lint 0 errors (frontend 26 warnings = BASE), builds ok · HANDOFF v5 · ready to merge


---

# ภาคผนวก ก: รีวิวทั้งสาขา (final-review.md)

# Final whole-branch review — stage 3 "สร้างเทอมใหม่จากรอบอัตรากำลัง"

Range `fc7e560..da803f3` (14 commits, 24 files). Reviewer: whole-branch final review (read-only).

**Passes done**
1. `term_from_round.py`: read in full.
2. `mock_api.py`: every diff hunk, plus the unchanged code they lean on: `create_term`, `unlock_term`, `_wl_db`, `_db_connect`, `_snapshot`/`_apply_snapshot` (counters), `_load_state`, writer thread / `_flush_pending` / `_save_state`, revision middleware, `_archive_target_or_refuse`, `_wl_import_rows`, `wl_curricula_seed`, `wl_rounds_create`/`open`/`close`, curriculum routes (lock order), `_mark_elective`/`_elective_subject_ids`/`_reqs_served_by_elective` (looking for side effects before the old-term pack).
3. Frontend and workload: `api/client.ts`, `store/timetableStore.ts`, `utils/terms.ts`, `NewTermModal.tsx`, `workload/src/round.ts`, `RoundOverview.tsx`, `RoundsPage.tsx`.
4. Tests: diffs of the existing tests that were modified (`terms.py` 2-line stub, `wlguard.py`, `wlcurriculum.py`, `wlopen.py`, `wlregistry.py`). Ran `bash tests/run.sh`: **— ผ่าน 32 · ไม่ผ่าน 0 —**. The working tree was clean afterwards.
5. Docs: design §2/§4/§6, plan Global Constraints and Tasks 1–6, ledger (every `Ruling:` and `minor (deferred` line), task-3 report (upgrade rehearsal), manual §11/§15, HANDOFF header.
6. Probe: called the pure function `wl_registry_reconcile` in-process from a scratchpad script, with no DB, to confirm the deferred HIGH #1 collision. I did not start the Postgres rig. Every finding below can be proven by reading the code. Nothing was left running.

---

### Strengths

- **The architecture fits the risk.** All conversion logic lives in a pure module (`term_from_round.py`) that takes and returns copies. Preview, the rounds list and the real POST share one builder (`_term_build`). So the reasons and numbers the admin sees come from the same code that decides the POST.
- **The 9-step order of design §4.4 is followed exactly** (`mock_api.py:18782–18925`):
  - The old term is packed before anything is touched.
  - There is one connection and one COMMIT.
  - **`app_state` is written inside the transaction** (18885). `CURRENT_TERM["id"]` is set first, so a restart right after COMMIT comes back consistent (test 11).
  - The restore point covers every variable touched. `_term_restore` restores in place, is idempotent, and rolls counters back only if nobody else advanced them.
- **The old path is untouched where it matters.** `create_term` (no `round_id`) and `terms_preview` (no `round_id`) run the original code. The `_term_rotate`/`_term_swap_active` refactor keeps the original SQL sequence when `cur=None`.
- **Lock ordering is now uniform.** Every path takes the registry advisory lock first, then the round row: create-from-round, reconciling unlock, all registry write routes, the pull buttons and curriculum seed. The DDL runs one autocommit statement at a time, before the route transaction, and neither term transaction has DDL inside it. I checked every writer of `wl_teachers`/`wl_subjects`/`wl_curriculum_lines`/`wl_term_set_options` and `wl_rounds_create`'s `LOCK TABLE … SHARE`. I found no lock cycle.
- **Double-click, two browsers and retry are defended in depth:** the frontend latch, the registry lock, `FOR UPDATE` on the round row, `exported_at IS NULL` on the mark, the in-transaction `_term_exists_reasons`, `TERM_ACTIVE_MOVED`, and two revision checks.
- **The registry sync stays inside the owned fields.**
  - Only owned fields are written, and only when they differ after normalization.
  - New ids skip both program ids and every web `sched_id`, including dangling ones.
  - Typed codes are grouped and the reasons are well thought out.
  - Counters never go backwards (`_apply_snapshot` takes `max`), which is what makes the data-driven reconcile rule sound.
- **The Task 5 round-2 ruling is the right call.** "The web registry follows the data of the open term" is correct for any unlock order, where the earlier lineage-based rules were not.
- **Thai messages are consistent.** The text of the round view, the 409s and both frontends come from one function (`wl_round_export_text`), and tests compare them against `mock_api.py`.

---

### Issues

#### Critical

None found.

#### Important

**I1. Reconciling unlock does not write `app_state` in its transaction. A crash window opens that leads to duplicate rows in the web registry, then duplicate teachers in the program.** (This is ledger deferred HIGH #2; I rule it must-fix.)

- **Where:** `mock_api.py:19207–19246` (`_unlock_term_reconciling`, COMMIT at 19246). `app_state` is written only later, at 19276–19277 (`_save_state` + `_flush_after_term_change`), after two `_term_log` calls that each open a new DB connection.
- **What goes wrong:**
  1. After COMMIT, the database says the unlocked term U is active and the web `sched_id`s follow U.
  2. `app_state` still holds the term P that was just closed, until the queued write lands. That is about 1–2 s on a cross-continent link.
  3. If the process dies in that window, the restart loads P with `CURRENT_TERM` = P marked active, while `app_terms` says U.
  4. Now teachers created by P's export exist in memory, but the web no longer points at them (reconcile set them to `old` or `NULL`). "ดึงครูจากโปรแกรม" creates web rows for them. Those rows can never be deleted.
  5. The next export then finds the original web rows without a `sched_id` and creates the same people again in the program. That is a must-never-happen.
  6. Separately, the next term operation closes U's row using P's in-memory data, so U's stored file is overwritten.
- **Why it matters:** this is the escape hatch the manual tells the school to use right after a mistaken press. Design §4.4 step 7 already gives the reason for writing `app_state` in the transaction ("ถ้าเครื่องดับในช่องนั้น … = เทอมครึ่ง ๆ"), and it applies here unchanged.
- **Fix:** two lines inside the transaction, after `CURRENT_TERM.update(...)` and before `conn.commit()`: `cur.execute(_DB_UPSERT, (_pack(_snapshot()),))`. This is the same as create, and the old unlock path is not touched. Add a test that asserts the upsert happens inside the transaction, mirroring `test_app_state_written_inside_transaction`. Ideally also repeat the test-11-style kill test for unlock on the rig.

#### Minor

**M1. Every exported round whose term was closed in the normal way is labelled "(ถูกปิดไว้ ปลดล็อกเทอมนั้นเพื่อใช้ต่อ)" and shown with a warning tone.**
- **Where:** `mock_api.py:15395–15404`, and `workload/src/round.ts:209` (warn tone).
- **What:** the text is chosen by `exported_term_id != CURRENT_TERM.id`. From the second semester on, every past round is no longer the active term. Each one then permanently advises the admin to unlock its term. Unlocking an old term mid-semester closes the current one.
- **Status:** this follows design §4.7 word for word, but the design did not consider terms closed in the ordinary way. Not urgent for the first press.
- **Fix:** call a term "parked" only when it is newer than the active term (compare year/semester), or when it is the term an unlock just replaced. Otherwise show the plain "ส่งเข้าโปรแกรมแล้ว — เทอม X".

**M2. On the live server (no `app_terms` rows yet), a round for the currently running semester shows "ใช้ได้" in the preview, but POST refuses it.**
- **Where:** `mock_api.py:18322` (`terms_rounds`), `18422` (`terms_preview`), `18823` (POST archive check), and `frontend/src/utils/terms.ts:428` (`defaultTermRound`).
- **What:** the rounds list and preview add only `_term_exists_reasons(app_terms)`. They miss the archive collision: the running, never-saved term has the same year/semester as the round (`_archive_target_or_refuse`). The admin is shown "ใช้ได้", types the code, and gets a 409.
- **Related:** `defaultTermRound` falls back to the newest *usable* round. When the upcoming round is not ready yet, that can be the current semester or an older one. A past semester with no `app_terms` row can actually be created, closing the current term.
- **Why it matters:** nothing is written, but preview and POST disagree on exactly the configuration of the first real press. It is confusing.
- **Fix:** add the archive-collision reason to the rounds list and preview when `_term_active()` is None and lessons exist. Also, do not default to a round older than or equal to the running term.

**M3. The summary never shows the carried/not-carried counts or the curriculum additions.**
- **Where:** `frontend/src/utils/terms.ts:492` (`roundPreviewRows`).
- **What:** design §4.2 says fields that could not be carried ("ไม่ตรงกัน/ไม่มีในแผนเดิม → ว่าง (นับและบอกในสรุป)"), meaning `not_carried`/`new_cells`, must be counted in the summary. Ledger T2 m6 likewise sent `curriculum_rows_added` "→ แสดงในสรุป". The server puts all of them in the report, but the dialog renders none of them. `merged_options` is not shown either.
- **Why it matters:** an admin cannot see that sub-group keys or pins were dropped for some room+subject cells before confirming. These fields affect the solver.
- **Fix:** add two or three `info` rows with "ดูรายการ" lists.

**M4. Memory is restored after the database lock is released, on both failure paths.**
- **Where:** `mock_api.py:18902–18909` (create) and `19247–19258` (reconciling unlock). `_term_restore` and `_apply_snapshot(old_blob)` run after `with conn:` has rolled back, which releases the advisory lock.
- **What:** a pull request waiting on the lock can, in principle, read the uncommitted `TEACHERS` before the restore runs. The section comment promises "ปุ่มดึงครูที่กดพร้อมกันรอจน COMMIT/ROLLBACK แล้วอ่าน TEACHERS ที่ตรงกับฐาน", and that guarantee currently rests on timing. In practice it is safe, because the pull does one more DB round trip (`wl_require_admin`) before it reads memory, while the restore takes microseconds.
- **Fix:** restore inside the `with conn` block (try/except around the body, restore, re-raise), so it happens before the rollback releases the lock.

**M5. An ambiguous COMMIT failure is treated as a rollback.** (Ledger deferred T4. The same holds for the old button.)
- **Where:** `mock_api.py:18900/18909`.
- **What:** if `conn.commit()` raises after the server has in fact committed, memory is restored to the old term. The database, `app_state`, the round mark and the registry write-back all say the new term exists. The next save overwrites `app_state` with old data. This is a half-made state, and the UI's "ไม่รู้ว่าสร้างแล้วหรือยัง" hint is all that protects against it.
- **Fix (later):** on a commit exception, check with a fresh connection whether `wl_rounds.exported_term_id` equals `new_id`. If it does, take the success path and do not restore.

**M6. When there is no active row and no lessons, the old plan is replaced without being stored anywhere.**
- **Where:** `mock_api.py:18823`.
- **What:** the round path copied the old guard `not _nothing_a_term_change_would_destroy()`. That function's docstring says the plan "ติดไปเทอมใหม่ ไม่ได้หายไปไหน", which is false for the round path. With no active row and empty SLOTS/PARKED, `REQUIREMENTS`, pools and curricula are replaced and no closed row is written. Only `app_state_history` might hold them.
- **Scope:** this is not reachable on production today, because the live timetable has lessons.
- **Fix:** in the round path, always archive when `not has_old`.

**M7. Reconcile can send two rows to the same unheld target.** (Ledger deferred HIGH #1, reproduced.)
- **Where:** `mock_api.py:19150`.
- **Reproduction:** reports `[{teachers:[{id:1,old:7,new:10}]}, {teachers:[{id:2,old:7,new:11}]}]` with open ids `{7}` produce `set` = `[1→7, 2→7]`. That violates UNIQUE, so the unlock returns 500, and every later unlock fails the same way.
- **Reachability:** only through backup-restore, the I1 crash chain, or hand edits.
- **Fix:** in the pure function, when several moving rows share a target, skip them all with a Thai reason (and set them to `NULL` if their current value is gone). It is cheap; do it in the same round as I1.

**M8. The first `_wl_db` call of every process now costs 22 round trips, and the old unlock path depends on it.**
- **Where:** `mock_api.py:14011` and `19341`.
- **What:** per-statement autocommit DDL is correct for deadlocks, but it adds 22 round trips (roughly 2–5 s cross-continent) to the first workload request after every Render wake. `unlock_term` now calls `_term_round_exported_to` → `_wl_db` even when no round exists, so the old unlock pays this too and fails with 503 if the wl DDL fails. (Ledger T5 m3.)
- **Fix (later):** one catalog probe (columns and index present?), and skip the DDL when everything is there.

**M9. A failed create restores memory but saves it only through the queue.** (Ledger T5 "~1 วินาที".)
- **Where:** `mock_api.py:18706–18709`.
- **What:** if the writer thread already wrote an uncommitted blob (a concurrent edit landing in the apply→upsert window), a crash within about 0.5–1 s of the 409 leaves `app_state` holding a term that never happened.
- **Fix:** one line, `_flush_pending()` right after `_save_state()` in `_term_restore`.

**M10. The `wl_prefill` fix does not reach rounds already opened in production.**
- **Where:** `mock_api.py:16397` (only `wl_rounds_preview`/`wl_rounds_create` call it).
- **What:** rows stored in a round opened between the stage-2 deploy (16 Nov) and this deploy keep the swapped teacher for unequal co-teaching pairs where the plan's first row has more periods. Export carries the swap into `REQUIREMENTS`.
- **Fix:** add a line to the deploy notes and manual telling the admin to re-check rows flagged "สอนร่วมในแผนเดิมคาบไม่เท่ากัน" in any round opened before this deploy. Nothing else is affected.

**M11. Dialog polish.** (Ledger T6 M1–M3.)
- `canRetryCreate` locks the dialog on 503 and on the definite Thai 500 "…ข้อมูลเดิมยังอยู่ครบ". On the round path every 503 happens before any write.
- The 429 text says "เข้าสู่ระบบ".
- `autoComplete="off"` on a password field: browsers ignore it. Use `"new-password"`.
- The bold warning stays visible after success.

---

### Triage of deferred minors and ⚠️ from the ledger

| Ledger item | Verdict |
|---|---|
| T1 M4: a bound subject's code edited to clash with an unknown program subject gives no warning | Can wait. The result is duplicate codes, not duplicate subjects, and the pull button skips the clash. |
| T1 M5: `registry_plan` length; `_*_NORM` not tied to `*_OWNED` | Can wait (refactor). |
| T1 M6: tests pin 143/271 | Can wait. |
| T2 m4: round trip does not test the `unconverted` subtraction or option `room_id` | Can wait. Add when touching the tests. |
| T2 m5: `plan_from_round` is about 270 lines | Can wait. |
| T2: a cell covered by both an elective set and an activity set takes the first set's kind; no test | Can wait. |
| T2: docstring wording ("แถวแผนของวิชาเสรี") | Can wait (trivial). |
| T4: `wl_rounds_create` reads program memory without the registry lock | Can wait. It affects prefill suggestions only; uncommitted `sched_id`s are invisible, so no dangling references. |
| T4: an ambiguous COMMIT failure counts as a rollback | Can wait (M5). Same as the old button; recommend the follow-up check. |
| T5: unlocking the round-created term again after an undo makes pull create one duplicate | Resolved by the round-2 reconcile (fuzz 300 seeds, pull 0). Nothing to do. |
| T5: after the m3 409, `app_state` holds the uncommitted state for about 1 s | Can wait, but it is a one-line fix (M9). Do it in the I1 round. |
| T5: `keep_closed` | Superseded: unlock no longer touches round rows. |
| T5 m3: 22 DDL round trips on the first request of each process | Can wait (M8, latency only). |
| T5 m6: reconciling unlock duplicates about 20 lines of `unlock_term` | Can wait. |
| T5 HIGH #1: two rows move to the same unheld target, giving UNIQUE → 500 forever | Can wait (not reachable from the app alone). The fix is cheap and pure (M7); recommend it in the same round as I1. |
| **T5 HIGH #2: reconciling unlock does not write `app_state` in its transaction** | **Must fix before merge (I1).** |
| T5 info: the rig DB holds rows from the round-1 approach | n/a (test data). |
| T6 M1: on the round path a 503 is pre-write but the UI locks; 500 drops "ข้อมูลเดิมยังอยู่ครบ" | Can wait (M11). |
| T6 M2: the bold warning stays after success (also on BASE) | Can wait. |
| T6 M3: `autoComplete="off"` should be `"new-password"` | Can wait (one-word fix). |
| ⚠️ T1 → T3/T4 addenda (source ordering, `_mark_elective` after SUBJECTS) | Done. Verified in `_term_apply`. |
| ⚠️ T2 → T3 (`wl_prefill` co-teach order; round trip controls it) | Done. See M10 for production rounds. |
| ⚠️ T3 → T6 (rounds 503 → dialog falls back to the old one) | Done (`roundsLoadNote`). |
| ⚠️ T4 → T5 (`closed_at` NULL on undo; unlock takes the registry lock first) | Done. The first point is superseded by round 2; the lock is first in `_unlock_term_reconciling`. |
| ⚠️ T5 (undo-by-lineage breaks one term later) | Resolved by the round-2 data-driven reconcile. |

### Rulings you disagree with

- **Deferring T5 HIGH #2 to final triage.** I rule it must-fix (I1). It is the same crash window design §4.4 closes for create, and the escape-hatch path is where the school will use it.
- **Ruling T5 round 2 / design §4.7 (round text computed from "is that term open").** I agree with the data-driven rule itself. I disagree with labelling a term "ถูกปิดไว้ … ปลดล็อกเทอมนั้นเพื่อใช้ต่อ" when it is merely older than the active term (M1).
- **Ruling T3 C2 (dialog defaults to the latest usable round).** I agree only partially. It should not fall back to a round for the running semester or an earlier one (M2).
- **Ruling T3 C2 "term exists" reason.** I agree, but it is incomplete: it misses the archive collision on a server with no `app_terms` rows, which is the live server's state on the first press (M2).
- All other rulings, including P1–P3, T1 C4, T2 C1/C3/I1, T3 C1/C3–C8, the T5 block (2-line `terms.py` stub) and T5 m1, I agree with.

### Declined to judge

- **Old-path create/unlock running concurrently with create-from-round.** In-memory state can interleave, because the old paths take neither the registry lock nor any process lock. This is a pre-existing race between old-path operations themselves, and the plan forbids changing the old path. Noted under Recommendations.
- **Program writes that finish between `_term_outgoing()` and `_term_apply` but whose revision bump lands after the check, so they are silently overwritten** (including an id reused by a concurrent `POST /api/teachers`). This is the acknowledged residual window of the T4 m3 / T5 m1 rulings and cannot be closed without a process-level write lock.
- **Teachers are not code-linked.** A program teacher re-added by hand under a new id appears as "ครูที่เว็บไม่รู้จัก" while the web row with a dangling id is recreated. This follows the spec ("ไม่จับคู่ด้วยชื่อ"; only subject codes may link) and the preview shows both lists.
- **Reconcile only adjusts rows that appear in some export report**, so web rows pulled while another term was open can dangle after an unlock. Spec §4.8 limits the scope to rows in reports, and a dangling id never creates duplicates (the next export recreates the row and records it).
- **`GET /api/terms/rounds` and `/preview?round_id=` are unauthenticated and run a full build per call.** Spec §4.6 makes them login-free like the rest of the program's routes.
- **`export_report` (names and numbers) is visible to department heads.** This was accepted in Ruling T3 C3.
- **`/api/restore` and history restore leave the web registry untouched.** Pre-existing and outside this plan.
- **Ownership of `is_elective`/`duration` by the web overriding program ticks.** This is Ruling T1 C4 per the design; the changes are listed in the preview.

### Recommendations

1. **Fix round (one round, small):**
   - I1: in-transaction `_DB_UPSERT` in `_unlock_term_reconciling`, plus a test.
   - M9: `_flush_pending()` in `_term_restore`.
   - M7: same-target collision handling in `wl_registry_reconcile`, with a unit test.
   - M4: move the restore before the rollback in both paths.
   - Optionally M3 (render `not_carried`/`new_cells`/`curriculum_rows_added`) and M2 (the archive-collision reason, and no default to past or current-semester rounds).
2. Before the next semester (can wait for the first press): M1, the "parked" wording.
3. Deploy notes:
   - Tell the admin to re-check flagged unequal co-teaching rows in rounds opened before this deploy (M10).
   - Mention the one-time ALTER on the first workload request, and the slower first request after each wake (M8).
4. The upgrade rehearsal from Task 3 covered 8 → 12 columns. Repeat it once more on a copy of production after the fix round, as planned ("หลังจบทั้ง 6 task" item 2). Include one create from a round, one unlock back and one unlock forward, with a kill right after each COMMIT.
5. Later: a process-level lock shared by every term-changing handler (both paths) would close the old-vs-new in-memory interleaving race. It needs an explicit decision to touch the old path.

### Assessment

**Ready to merge? With fixes.**

The core of the work is sound and well defended. The new term is all-or-nothing, with the closed-term file identical to the old button's. `app_state` is written in the create transaction. Lock order is uniform and I found no deadlock. Preview and POST use one builder. The registry sync stays inside owned fields with no duplicates on double-click or retry, and the old path is untouched. The suite passes 32/0.

One Important gap remains on the documented escape hatch: the reconciling unlock leaves `app_state` outside its transaction (I1). A crash in that window can, after a pull and an export, produce duplicate teachers in the program, which is a must-never-happen. The fix is two lines plus a test.

Merge after I1. M9, M7 and M4 are cheap enough to go in the same round. The remaining minors can wait.


---

# ภาคผนวก ข: ตรวจซ้ำรอบแก้สุดท้าย (final-rereview.md)

# ตรวจซ้ำรอบแก้สุดท้าย — ขั้นที่ 3 (da803f3..fe12be6, 2 คอมมิต)

ขอบเขต: ข้อค้นพบ 8 ข้อใน final-fix-brief + คำตัดสินท้าย progress.md (is_elective) และ diff ของรอบแก้เท่านั้น · อ่าน diff ทั้งไฟล์ในสองรอบ (เซิร์ฟเวอร์ แล้วหน้าเว็บ+ตัวทดสอบ) · ไม่ได้แก้โค้ด ไม่ได้ commit · ไม่ได้รันชุดทดสอบซ้ำ · ตรวจที่รันเอง: `npx eslint` สองไฟล์ของหน้าต่าง (`NewTermModal.tsx` `utils/terms.ts`) ไม่มีข้อความ · `git status` สะอาด · `pgrep` ไม่มี mock_api/vite ค้าง

### Finding Verdicts

1. **I1 การปลดล็อกที่ปรับเทียบเขียน app_state ในธุรกรรมเดียวกัน** — **ADDRESSED**
   - `mock_api.py:19391`: `cur.execute(_DB_UPSERT, (_pack(_snapshot()),))` อยู่หลังสลับเทอม (CURRENT_TERM มี id/สถานะ active ของแถวแล้ว) และหลังคำสั่งปรับทะเบียน ก่อน `conn.commit()` ครั้งเดียว · cursor เดียวกัน · `_db_write_blocked()` ถูกปฏิเสธก่อนแล้วใน `unlock_term`
   - จุดฉีด `unlock_after_commit` อยู่นอก try ใน หลัง COMMIT (`:19410`) · `_term_test_fail` เปลี่ยนแค่ให้ชื่อนี้ `_os._exit` · ทางเดิม `unlock_term` (ไม่มีรอบที่ส่งแล้ว) ไม่มี hunk
   - ตัวทดสอบ `wlexportunlock.py::test_unlock_writes_app_state_inside_the_transaction` ตรวจลำดับ ACTIVATE < UPSERT < COMMIT และ UPSERT หลังทุก `UPDATE wl_*` · รายงานมีของจริงฆ่าหลัง COMMIT และตัวเทียบ BASE (ดึงครู created 1 → 0)

2. **M2 เว็บจริงไม่มีแถวใน app_terms → รอบภาคปัจจุบันไม่ขึ้น "ใช้ได้" ถ้า POST จะปฏิเสธ · ค่าเริ่มต้น = รอบของภาคเรียนถัดไป** — **ADDRESSED**
   - `_term_running_reasons` (`mock_api.py:18077`) ใช้เงื่อนไขเดียวกับ POST: ไม่มีแถว active และไม่ใช่ `_nothing_a_term_change_would_destroy()` → `running_term_identity(CURRENT_TERM, SCHOOL_CONFIG)` ปี/ภาคเดียวกับรอบ = เหตุ "มีเทอม … (เป็นเทอมที่กำลังใช้อยู่ …)" · บอกไม่ได้/ปี-ภาคมีแถวเก็บแล้ว = ข้อความของ `_archive_target_or_refuse` ตรงตัว
   - ใช้ในรายการรอบทั้งสองทาง (`:18434` `:18440`), preview (`:18538`), POST (`:18931` → 409 `exists[0]` ก่อนถึง `_archive_target_or_refuse`) → เหตุแรกของรายการ/preview เป็นข้อความเดียวกับ 409 ทุกกรณีที่ปุ่มจะปฏิเสธ (ไล่ครบ: archive None · pair == requested · pair อยู่ใน existing)
   - หน้าต่าง: `runningTerm` (`utils/terms.ts:474`) = เทอมที่เปิด → ไม่มีก็ปี/ภาคในหน้าตั้งค่า · `defaultTermRound(rounds, current)` (`:491`) = รอบที่ใช้ได้ ยังไม่ส่ง ของภาคเรียนหลัง current ที่ใกล้สุด · ไม่มี/ไม่รู้ = null (`NewTermModal.tsx:135`; แหล่งแผนยังเริ่มที่ "แผนเดิม") · ตัวทดสอบ py (ก)–(ง) และ ts 11+7 กรณี

3. **M1 ป้ายรอบที่ส่งแล้วสามกรณี ตรงกันทั้ง exported_text / 409 / หน้าเว็บ** — **ADDRESSED**
   - `wl_round_export_state` (`mock_api.py:15401`): id ตรงเทอมที่เปิด = open · ปี/ภาคของเทอมที่เปิดใหม่กว่า = done · นอกนั้น (เก่ากว่า/บอกไม่ได้) = parked · ข้อความจาก `WL_EXPORT_SUFFIX` ตัวเดียว (`:15397`)
   - 409: `wl_round_exported_refusal` ใช้ state เดียวกัน ("ถ้าส่งผิด…" เฉพาะ open) · ผู้เรียกทุกตัวส่งแถวที่มี year/semester: `_wl_refuse_locked` เติมเอง · `_wl_round_for_update` (`_WL_ROUND_COLS`) · `_wl_round_for_write`/`_wl_option_for_write` (`_WL_ROUND_LOCK_COLS`) มีทั้งคู่
   - หน้าเว็บ: `roundExportChip` คืน state (`workload/src/round.ts:222-223`) · หน้ารอบขึ้น "ถ้าส่งผิด…" เฉพาะ open (`RoundOverview.tsx:126`) · ts เทียบส่วนท้ายกับ `WL_EXPORT_SUFFIX` ใน mock_api.py · py ไล่ A→B→C(ปุ่มเดิม)→B→C→A ทั้ง GET/รายการ/409 ของ route จริง

4. **M3 สรุปแสดง not_carried · แถวตามรูปเดิม · วิชาที่ถูกเพิ่มเข้าหลักสูตร** — **ADDRESSED**
   - `term_from_round.py:629` เก็บ `pattern_rows` (รายงานอย่างเดียว ไม่แตะแผน) · `_term_report` เติมชื่อห้อง/วิชา/ชื่อไทยของช่อง/ชื่อครู (`mock_api.py:18347` `:18351`)
   - หน้าต่าง 4 บรรทัด info พร้อมรายการ (`utils/terms.ts:596` `:600` `:604` + new_cells) · ค่า 0 ไม่ขึ้น · รายงานรุ่นก่อนไม่ล้ม (ฟิลด์ optional)

5. **M7 หลายแถวย้ายไปเป้าเดียว → ข้ามทั้งหมด + เหตุ** — **ADDRESSED**
   - `mock_api.py:19274-19282` จัดกลุ่มตามเป้า กลุ่ม >1 แถว → blocked ทุกแถว เหตุไทยมีชื่อแถวอื่น · ลูปเดิมถือว่าแถวที่ถูกข้ามยังถือค่าเดิม → แถวที่จะไปค่านั้นถูกข้ามต่อ · ค่าเดิมไม่อยู่ในเทอมที่เปิด → ตั้งว่าง
   - ไล่เองแล้ว: การสลับเลข (A:7→10, B:10→7) ไม่ถูกข้าม · ไม่มีทางเกิด `SET sched_id = X` สองแถวค่าเดียวกัน · ตัวทดสอบมีทั้งฟังก์ชันล้วนและการปลดล็อกผ่านฐานปลอมที่ตรวจ UNIQUE

6. **M4 คืนหน่วยความจำก่อน ROLLBACK ปล่อยล็อก · M9 เซฟหลังล้มไม่ทิ้งช่องเวลา** — **ADDRESSED** (มีช่องที่เหลือโดยธรรมชาติ ดูข้อ Minor 2–3)
   - สร้าง: try/except อยู่ใน `with conn:` ครอบ cursor + `conn.commit()` → `_term_restore(back)` ก่อน raise (`mock_api.py:19029`) · ชั้นนอกเหลือ log/500 · `after_commit` อยู่นอก try ใน
   - ปลดล็อก: แบบเดียวกัน (`:19393-19408`) คืน `_apply_snapshot(old_blob)` + CURRENT_TERM + SCHOOL_CONFIG ก่อน ROLLBACK
   - M9: `_term_save_restored` (`:18814`) บรรจุก่อน `conn.rollback()` (ยังถือล็อก) → UPSERT app_state → COMMIT การเชื่อมต่อเดียวกัน · ทุกข้อผิดพลาดถูกกลืน ไม่มีทาง COMMIT สิ่งอื่นนอกจาก UPSERT (rollback มาก่อนเสมอ ล้มที่ไหนก็ไม่ถึง commit) · ไม่ทำเมื่อ `_db_write_blocked()` · psycopg3 `with conn` ออกด้วย exception = rollback ว่าง + ปิด ไม่มีผล
   - `_save_state()` ที่ถูกเรียกระหว่างธุรกรรมยังเปิดเป็นแค่ใส่คิว (ไม่บล็อก ไม่ deadlock กับ row lock ของ app_state)

7. **M11 หน้าต่าง** — **ADDRESSED**
   - 503 ทางรอบที่มี detail ไทย → `canRetryCreate` true (`utils/terms.ts:237`) · ตรวจแล้วทุก 503 ของ `_create_term_from_round` เกิดก่อนเปิดธุรกรรม และหลัง COMMIT ไม่มีทางได้ 503 ไทย (`_term_log` กลืน · `_term_row` ล้มเป็น 500 ไม่มี detail ไทย → ยังล็อก)
   - 500 ไทยทางรอบ → `createLockedText` แสดง detail ของเซิร์ฟเวอร์ (ปุ่มยังล็อก — ตีความที่สมเหตุผลเพราะ M5 ยังเปิด) · ทางเดิมได้ข้อความเดิมทุกตัวอักษร (ts ผูกไว้)
   - 429 = `TERM_ADMIN_CODE_BUSY` (`mock_api.py:18740`) ไม่มี "เข้าสู่ระบบ" · 429 ผิดเกินเกณฑ์ (`_wl_fail_guard`) ไม่มีคำนี้อยู่แล้ว · `autoComplete="new-password"` (`NewTermModal.tsx:304`) · คำเตือนตัวหนา `{!done && …}` (`:368`, done = มีผลสำเร็จ) · เว้นวรรคใน `newTermWarning`

8. **ข้อเพิ่ม: สรุปไม่เตือน "เป็นวิชาเสรี ใช่ → ไม่ใช่" ของวิชาในชุด และผลหลังสร้างไม่เปลี่ยน** — **ADDRESSED**
   - `_term_keep_set_electives` (`mock_api.py:18364`, เรียกที่ `:18402` หลัง `plan_from_round`) แก้เฉพาะสำเนา (`registry_plan` deepcopy ทะเบียน · dict ของ `new_wl_subjects` สร้างใหม่ ไม่ถูกแก้ตาม) → preview/รายการรอบไม่แตะหน่วยความจำ
   - ชุดเดียวกับ `_mark_elective(*plan["elective_subjects"])` → SUBJECTS/ไฟล์เทอมใหม่หลังสร้างเท่าเดิม · แผนคำนวณก่อนเปลี่ยน (เหมือน BASE) · `report` ของ POST = ของ preview (สร้างจาก `_term_build` ตัวเดียวกัน) · วิชานอกชุดตามเว็บ (T1 C4)

### New Breakage in the Fix Diff

ไม่มี Critical/Important · Minor:
1. **Minor — รายการรอบทางข้อมูลยังโหลดไม่สำเร็จ เทียบกับหน่วยความจำ** `mock_api.py:18434` (และ POST `:18931` ตรวจก่อน `_db_write_blocked()`): `_term_running_reasons` อ่าน SLOTS/CURRENT_TERM/SCHOOL_CONFIG ซึ่งในสภาพนั้นไม่ใช่ข้อมูลของโรงเรียน ขัดกับ docstring ของ `terms_rounds` ("ไม่เทียบกับข้อมูลตั้งต้นในหน่วยความจำ") · ผลแค่ข้อความเหตุที่อาจหลอก (รอบใช้ไม่ได้อยู่แล้วด้วย TERM_FROM_ROUND_BLOCKED · POST ปฏิเสธเหมือนเดิม) · ข้อมูลตั้งต้นไม่มีคาบ จึงมักไม่ขึ้น
2. **Minor (เหลือโดยธรรมชาติ) — M4 ไม่ครอบ COMMIT ที่ล้มเอง** `mock_api.py:19023/19029`: Postgres จบธุรกรรม (ปล่อย advisory lock) ก่อนไคลเอนต์เห็นข้อผิดพลาด การคืนจึงตามหลังการปล่อย ~½ RTT · ปลอดภัยตามเวลาแบบเดียวกับที่รีวิวทั้งสาขาบรรยาย (ปุ่มดึงต้องไปฐานอีกรอบก่อนอ่านหน่วยความจำ) · ตัวทดสอบฉีดแทนการ COMMIT จึงไม่จำลองกรณีนี้
3. **Minor (ทฤษฎี, ซ้อนสองเหตุ) — M9 เขียน app_state หลัง ROLLBACK คือนอกล็อกทะเบียน** `mock_api.py:18826-18829`: คำขอเปลี่ยนเทอมที่รอล็อกต้องไปถึง UPSERT ของมันก่อน UPSERT ของเรา (ห่างกันหนึ่ง RTT ขณะที่มันต้องผ่านหลายรอบไปฐาน + คำนวณ) ถึงจะถูกทับ · ใกล้เคียงข้อกังวล 5 ของผู้ลงมือ · ไม่ต้องแก้ก่อนขึ้น

### Out-of-Scope Observations

- **สรุป "ห้อง+วิชาที่ไม่มีในแผนเดิม" บนข้อมูลจริงจะยาวมาก**: ขึ้นภาคเรียนจริง (2/2569 → 1/2570) รหัสวิชาเปลี่ยนเกือบทุกห้อง → `new_cells` เกือบทุกช่อง (หลักร้อย–พัน) · ฐานทดลองเห็น 1 รายการเพราะคัดลอกหลักสูตรภาคเดียวกัน · เป็นบรรทัด info พับไว้และตรงแบบข้อ 4.2 ไม่ใช่ความเสียหาย แต่คู่มือข้อ 11 ที่บอก "ดูรายการแล้วตั้งค่าใหม่" อาจชวนให้ admin ไล่รายการยาวโดยไม่จำเป็น — ผู้คุมพิจารณาถ้อยคำ
- **ช่องที่เหลือของ app_state (มีทั้งทางสร้างและปลดล็อก ไม่ใช่ของรอบนี้)**: คำขอแก้ในโปรแกรมที่จบหลัง `_flush_pending` แต่ก่อนสลับเทอม ใส่ blob ของเทอมเดิมในคิว → เธรดเขียนรอ row lock ของ app_state แล้วเขียนทับหลัง COMMIT จนเซฟหลัง COMMIT ตามมา · ต้องแก้ข้อมูลระหว่างกด + เครื่องดับในช่องนั้น — คู่มือข้อ 11 ข้อ 3 สั่งห้ามแก้ระหว่างกดอยู่แล้ว
- ข้อที่รีวิวทั้งสาขาเลื่อน (M5 M6 M8) และงานก่อนขึ้นของผู้คุม (M10 ใน HANDOFF · หมายเหตุ ALTER/คำขอแรกช้า · ซ้อมบนสำเนาฐานจริงพร้อมฆ่าหลังแต่ละ COMMIT) ยังเป็นของผู้คุม

### ตรวจเพิ่มตามที่สั่ง

- **"ห้ามเกิด" ใหม่: ไม่พบ** — ไฟล์เทอมที่ปิดยังบรรจุจุดเดิมก่อนแตะอะไร (`:18989`) · `_term_keep_set_electives` แก้แค่สำเนา · ทางล้มทุกทาง COMMIT ได้อย่างมากแค่ app_state ของที่คืนแล้ว · M2 เพิ่มแต่การปฏิเสธ · ไม่มีโค้ดใหม่เขียน SLOTS (`_term_restore` คืน SLOTS แบบเดิม) · ช่องที่แก้ในทะเบียนยังเป็นของเว็บ (is_elective)
- **ทางเดิมของปุ่มสร้าง/ปลดล็อก: ไม่เปลี่ยน** — ไม่มี hunk ใน `create_term` ทางเดิม `unlock_term` `_term_rotate` `_term_swap_active` `new_term_preview` · `tests/py/terms.py` `termguard.py` ไม่อยู่ใน diff · หน้าต่างทางเดิม: `canRetryCreate(e)` และข้อความล็อกเหมือนเดิม (ts ผูก) · ต่างแค่เว้นวรรคในคำเตือนและซ่อนคำเตือนหลังสร้างสำเร็จ (สั่งใน brief ข้อ 7)
- **signature ที่เปลี่ยน: ผู้เรียกครบ** — `wl_round_export_text`/`wl_round_exported_refusal`/`wl_round_view` รับ dict: ผู้เรียกในโค้ด 4 ที่ (`:15446` `:16519` `:16547` `:16737`) ส่ง `CURRENT_TERM` · ทุกผู้เรียก `_wl_refuse_exported` ส่งแถวที่มี year/semester · ไม่มีโมดูลอื่นเรียก · `_term_restore` → bool ผู้เรียกเดียว · `defaultTermRound`/`roundExportChip` ผู้เรียกปรับแล้ว

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage — 8/8 ADDRESSED · Minor ใหม่ 3 ข้อ (ข้อความเหตุตอนข้อมูลยังโหลดไม่สำเร็จ · ช่องเหลือของ M4 ตอน COMMIT ล้ม · M9 นอกล็อกเชิงทฤษฎี) ไม่ขวางการขึ้นเว็บ
**พร้อมขึ้นเว็บ:** ใช่ ในส่วนของโค้ด — เหลืองานก่อนขึ้นของผู้คุมตามรีวิวทั้งสาขา (M10 · หมายเหตุ M8 · ซ้อมบนสำเนาฐานจริง)


---

# ภาคผนวก ค: ลองอัปเกรด (upgrade-test.md)

# Upgrade test: fc7e560 (main, stage 2) -> branch head, same PostgreSQL DB (wltest :54329)

Result: PASS on all 5 steps. Date 2026-11-17. Repo untouched (git status clean at end).
Note: branch HEAD moved from fe12be6 to 6ef6dfa during the run (someone committed docs/workload-setup.md only, +2 lines). The NEW server ran from the working tree, so code = fe12be6 = 6ef6dfa (docs-only diff).

## Method
Old = git worktree at fc7e560 under the scratchpad (removed at end). Drivers: python/urllib scripts in the scratchpad (s1.py, s1b.py, c.py, snap.sh).
Server env: DATABASE_URL=postgresql://postgres@127.0.0.1:54329/wltest PORT=18000 WORKLOAD_SETUP_CODE=<รหัสตั้งค่าของฐานทดลอง> $WS/venv/bin/python mock_api.py
Run 1 (discarded, kept as a finding): empty timetable, default config 1/2568. Run 2 (reported below): pg.sh reset, then production-like seed on the OLD server.

## Step 1 - old server, build data (PASS)
- PUT /api/school/config year=2569 term=2; POST /api/timetable/slots x31 (31 of 40 attempts accepted) so the running timetable has slots and is "2/2569", like production. state revision 32, slots 31, saved to app_state (1 row, 30716 bytes, md5 ffff1fba...).
- setup admin code, login, import teachers (created 143) and subjects (created 271), 2 head codes (dept 1, 2), seed 2/2569 from timetable (74 curricula, 923 lines, 93 groups, 13 sets, 44 options), round id 1 (1220 rows), open, bulk-confirm 1220 rows, confirm 44 option teachers, dept 1 and 2 submitted + approved (108 and 115 rows), close with confirm_label "2/2569" -> closed.
- Counts (OLD): app_state 1 · app_state_history 1 · wl_codes 3 · wl_curricula 74 · wl_curriculum_groups 93 · wl_curriculum_lines 923 · wl_curriculum_log 1 · wl_dept_status 11 · wl_option_teachers 44 · wl_rounds 1 · wl_rows 1220 · wl_sessions 3 · wl_subjects 271 · wl_teachers 143 · wl_term_set_options 44 · wl_term_sets 13. app_terms: table does NOT exist on the old version (to_regclass null) - so "0 rows" = no table; the new version creates it lazily (see step 2/4).
- Concrete rows: wl_teachers id1 = "1|1|นางกุลจิรา ยะศะนพ|T001|1||t"; wl_rows id1 = "1|1|1|1|127|||f||t|f|"; wl_rows id1220 = "1220|1|923|78|135|||f||t|f|".
- GET /api/state/version: revision 32, slots 31, pending false after save.
- Old server killed, exit confirmed, no traceback in old log, data_state.json removed. Full snapshot: /tmp/claude-0/-home-user-school-scheduler/4d2ae85a-e6ce-57f8-ac7b-6cc206fbae9a/scratchpad/snap-old.txt

## Step 2 - new server on same DB (PASS)
- Started OK, /api/workload/health {"db":true,"needs_setup":false}, 0 tracebacks (only a FastAPI on_event DeprecationWarning).
- wl_rounds gained: exported_at (timestamptz), exported_term_id (bigint), exported_label (text), export_report (jsonb). Existing round row identical apart from the four new NULL columns.
- Every count identical; md5 checksums of wl_teachers, wl_subjects, wl_rows, wl_option_teachers, wl_dept_status, wl_codes and app_state all identical to step 1 (diff of snapshots only differs in the wl_rounds row = 4 new null columns). wl_rows id1 and id1220 same.
- pg_indexes diff before/after startup: none (no new index on wl_codes / wl_teachers / wl_subjects, none anywhere). app_terms was not created by startup; it appears at first term creation (step 4), with indexes app_terms_one_active, app_terms_pkey, app_terms_year_semester_key, plus table app_term_log (app_term_log_pkey).
- Old admin session token -> GET /api/workload/me 200 (admin); old head token 200; login with same admin code 200. /api/state/version revision 32 slots 31 (same).

## Step 3 - rounds list and preview on new server (PASS)
- GET /api/terms/rounds with only 2/2569: usable=false, reason (Thai): "มีเทอม 2/2569 ในโปรแกรมจัดตารางอยู่แล้ว (เป็นเทอมที่กำลังใช้อยู่ — ตอนสร้างเทอมใหม่ ตารางที่ลงไว้ตอนนี้จะถูกเก็บเป็นเทอม 2/2569) — สร้างเทอมเดียวกันซ้ำไม่ได้ ให้ใช้รอบของภาคเรียนถัดไป". GET /api/terms/preview?round_id=1: requirements 1220, teachers 143, periods_total 2209, curricula 0, slots_to_clear 31, round.usable false, same reason, report still fully computed.
- 1/2570: seed source copy from 2/2569 worked (74/923/93/13/44), round id 2 (1220 rows, 44 options), open, confirm all rows + 44 option teachers, close "1/2570". /api/terms/rounds lists 1/2570 usable=true reasons=[] ; preview round 2: usable true, report requirements 1220, periods 2209, teachers_in_plan 138, curricula 74, pools 13, pool_options 44, every warning list empty.
- SURPRISE (run 1): with an EMPTY timetable (no slots; default config 1/2568) the 2/2569 round was reported usable=true. By design (_nothing_a_term_change_would_destroy: no slots and nothing parked means nothing to archive). The collision reason appears only when the timetable has slots AND config year/term = the round's term. Production has slots, so the expected behaviour holds there. Config year/term must equal 2569/2 for the collision to show.

## Step 4 - POST /api/terms (PASS)
- POST /api/terms {year:2570, semester:1, round_id:2, admin_code:<admin>} -> 200. closed = {id1, 2/2569, slots 31, closed}, active = {id2, 1/2570, slots 0}, save_error null, report as preview.
- app_terms: 2 rows: (1, 2569, 2, closed, 2/2569), (2, 2570, 1, active, 1/2570). GET /api/terms agrees (31 slots archived, bytes 30746).
- GET /api/timetable/requirements = 1220 = round row count (documented report: requirements 1220, no skipped, no not_carried).
- wl_rounds id2: exported_at set, exported_term_id 2, exported_label 1/2570, export_report json stored. /api/terms/rounds now: 1/2570 usable=false "รอบ 1/2570 ส่งเข้าโปรแกรมจัดตารางแล้ว (เทอม 1/2570) — ส่งซ้ำไม่ได้"; 2/2569 usable=false "มีเทอม 2/2569 ในโปรแกรมจัดตารางอยู่แล้ว — สร้างเทอมเดียวกันซ้ำไม่ได้ (ถ้าสร้างผิด ให้ปลดล็อกเทอมเดิมกลับ...)".
- import-from-scheduler teachers: created 0 linked 143 skipped 0; subjects: created 0 linked 271 skipped 0. wl_teachers 143, wl_subjects 271 afterwards.
- school config became 2570/1; state revision 33, slots 0, saved.
- Restart of new server (0 tracebacks): revision 33, requirements 1220, terms [1/2570 active, 2/2569 closed 31 slots], config 2570/1, preview curricula 74 slots_to_clear 0, rounds exported flags as above. wl_rows for round 1 md5 still da3824f6... (unchanged since step 1). wl_rows total 2440 (1220 x 2 rounds).

## Step 5 - cleanup (PASS)
Servers killed and confirmed gone, no data_state.json, worktree removed + pruned, git status --short empty.

## Notes
- app_terms does not exist before the upgrade (not "0 rows"); no migration action needed, created on first use.
- Scratch artifacts (logs, snapshots, drivers) are in /tmp/claude-0/-home-user-school-scheduler/4d2ae85a-e6ce-57f8-ac7b-6cc206fbae9a/scratchpad, outside the repo.
