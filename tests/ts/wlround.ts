/**
 * ทดสอบ workload/src/round.ts — ตรรกะล้วนของหน้ารอบอัตรากำลังของผู้ดูแลระบบ
 *
 * จุดที่ต้องไม่พลาด: ป้ายสถานะกลุ่มต้องเป็นข้อความเดียวกับเซิร์ฟเวอร์ (หัวหน้ากับ admin เห็นคำเดียวกัน)
 * · ตัวเลขทุกตัวนับเป็น "รายการ" (แถววิชา + ตัวเลือกคาบเสรี/กิจกรรม) ตาม wl_fill_counts ไม่ใช่แถวอย่างเดียว
 * · หน้าดูก่อนเปิดไม่โชว์บรรทัดของค่าที่เป็นศูนย์ และบรรทัดที่ยังไม่มีกลุ่มสาระเป็นคำเตือน
 * · ปุ่มของรอบ/กลุ่มขึ้นตามสถานะที่เซิร์ฟเวอร์ยอมจริง (รอบที่เตรียมอยู่ยกเลิกได้แต่ปิดไม่ได้)
 * · คำตอบของเซิร์ฟเวอร์ที่ผิดรูป (ตัวเลขเป็นข้อความ ติดลบ สถานะแปลก) ต้องถูกจับ ไม่แปลงเป็นค่าที่ดูปกติ
 */
import { readFileSync } from "node:fs";
import {
  bulkConfirmIds, checkCloseLabel, checkReturnNote, checkRoundForm, closedRounds, currentRound, defaultOpenTerm,
  DEPT_STATUS_TEXT, deptProgress, deptStatusLabel, deptStatusTone, editState, fillLevels, fillProgress, filterOptions,
  filterRows, groupBySubject, headRound, holdPending, isDeptStatus, isOptionTeacher, isRound, isRoundDetail, isRoundOption,
  isRoundPreview, isRoundRow, isTeacherLoad, loadBars, openBlocker, optionState, optionTeacherPatch, previewLines,
  previewWarnings, reviewActions, roundActions, roundChip, roundLabel, roundStats, ROUND_STATUS_TEXT, roundStatusTone,
  releasePending, rowPatch, rowState, settlePending, shownFields, subjectLine, submitState, teacherChoices, teacherNamer,
  termReadiness, changeRow, teacherDraft, retryFields, reviewGap, refreshDue, REFRESH_GAP_MS, bulkConfirmTargets, unsavedDraftsText,
  roundExportChip, exportActivityLines, EXPORT_DONE_TEXT, EXPORT_PARKED_TEXT,
  amendAction, amendChip, amendNotes, AMEND_CHIP_TEXT, AMEND_OTHER_OPEN, isPlanUpdate, planUpdateLine, planUpdateItems,
  type PlanUpdate,
  type DeptStatus, type OptionTeacher, type Round, type RoundOption, type RoundPreview, type RoundRow, type TeacherLoad,
} from "../../workload/src/round.ts";

const fails: string[] = [];
const test = (name: string, fn: () => void): void => {
  try { fn(); } catch (e) { fails.push(`${name} — ${(e as Error).message}`); }
};
const eq = (a: unknown, b: unknown): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`ได้ ${JSON.stringify(a)} ควรเป็น ${JSON.stringify(b)}`);
  }
};
const ok = (cond: unknown, what: string): void => {
  if (!cond) throw new Error(what);
};
const hasThai = (s: string): boolean => /[฀-๿]/.test(s);
// ตัวเลขศูนย์ที่ยืนเดี่ยว ๆ ("0 แถว" · "ตัวเลือก 0") — ไม่นับ 0 ที่อยู่ในเลขอื่น เช่น 1,220 หรือ 2/2569
const hasZero = (s: string): boolean => /(^|[^\d,/.])0(?![\d,/.])/.test(s);

// รูปจริงจากเซิร์ฟเวอร์ (wl_round_view + _wl_dept_views) บนข้อมูลตั้งต้น
const R = (p: Partial<Round> = {}): Round => ({
  id: 1, year: 2569, semester: 2, label: "2/2569", status: "filling",
  opened_at: "2026-11-16T07:47:00.801481+00:00", closed_at: null,
  counts: { rows: 1220, sets: 13, options: 44, unconverted: 0 }, ...p,
});
const D = (p: Partial<DeptStatus> = {}): DeptStatus => ({
  department_id: 1, status: "filling", submitted_at: null, submitted_by: null, reviewed_at: null, reviewed_by: null,
  note: "", rows: 108, confirmed: 0, missing_teacher: 0, ...p,
});
const P = (p: Partial<RoundPreview> = {}): RoundPreview => ({
  label: "2/2569", rows: 1220, options: 44, prefilled_rows: 1220, prefilled_options: 40, empty_rows: 0,
  lines_without_department: 0, options_without_department: 0, unconverted: [], ...p,
});

// ── ป้ายและสี ────────────────────────────────────────────────────────
test("ROUND_STATUS_TEXT ป้ายไทยของสถานะรอบ", () => {
  eq(ROUND_STATUS_TEXT, { preparing: "เตรียม (ยังไม่เปิดให้กรอก)", filling: "เปิดให้กรอก", closed: "ปิดรอบแล้ว" });
});

test("DEPT_STATUS_TEXT ตรงกับ WL_DEPT_STATUS_TEXT ของเซิร์ฟเวอร์ทุกตัวอักษร", () => {
  const src = readFileSync(new URL("../../mock_api.py", import.meta.url), "utf8");
  const m = /^WL_DEPT_STATUS_TEXT[^=]*=\s*\{([\s\S]*?)\}/m.exec(src);
  ok(m, "หา WL_DEPT_STATUS_TEXT ใน mock_api.py ไม่เจอ");
  const server: Record<string, string> = {};
  for (const [, k, v] of m![1].matchAll(/"([a-z]+)":\s*"([^"]*)"/g)) server[k] = v;
  eq(Object.keys(server).sort(), ["approved", "filling", "returned", "submitted"]);
  eq(DEPT_STATUS_TEXT, server);
});

test("roundStatusTone: เตรียม = warn · เปิดให้กรอก = info · ปิดแล้ว = mute", () => {
  eq(roundStatusTone("preparing"), "warn");
  eq(roundStatusTone("filling"), "info");
  eq(roundStatusTone("closed"), "mute");
});

test("deptStatusTone/Label ทุกสถานะ · กำลังกรอกที่ยังไม่ยืนยันสักรายการ = ยังไม่เริ่ม (mute)", () => {
  eq(deptStatusTone(D({ status: "filling", confirmed: 0 })), "mute");
  eq(deptStatusLabel(D({ status: "filling", confirmed: 0 })), "ยังไม่เริ่ม");
  eq(deptStatusTone(D({ status: "filling", confirmed: 1 })), "warn");
  eq(deptStatusLabel(D({ status: "filling", confirmed: 1 })), "กำลังกรอก");
  eq(deptStatusTone(D({ status: "submitted", confirmed: 108 })), "info");
  eq(deptStatusLabel(D({ status: "submitted", confirmed: 108 })), "ส่งแล้ว รอผู้ดูแลระบบตรวจ");
  eq(deptStatusTone(D({ status: "approved", confirmed: 108 })), "ok");
  eq(deptStatusLabel(D({ status: "approved", confirmed: 108 })), "ตรวจผ่านแล้ว");
  // ตีกลับแล้วหัวหน้าล้างครูจนไม่เหลือที่ยืนยัน ยังต้องเห็นว่าถูกตีกลับ (แดง) ไม่ใช่ "ยังไม่เริ่ม"
  eq(deptStatusTone(D({ status: "returned", confirmed: 0 })), "bad");
  eq(deptStatusLabel(D({ status: "returned", confirmed: 0 })), "ถูกตีกลับให้แก้");
  // กลุ่มที่ไม่มีรายการในรอบนี้เลย — ไม่มีอะไรให้เริ่ม
  eq(deptStatusTone(D({ status: "filling", rows: 0, confirmed: 0 })), "mute");
  eq(deptStatusLabel(D({ status: "filling", rows: 0, confirmed: 0 })), "ไม่มีรายการ");
  eq(deptStatusLabel(D({ status: "submitted", rows: 0, confirmed: 0 })), "ส่งแล้ว รอผู้ดูแลระบบตรวจ");
});

test("roundLabel = ชื่อรอบแบบเซิร์ฟเวอร์ (ที่ต้องพิมพ์ยืนยันตอนปิดรอบ)", () => {
  eq(roundLabel(2569, 2), "2/2569");
  eq(roundLabel(2570, 1), "1/2570");
});

// ── ฟอร์มเปิดรอบ ─────────────────────────────────────────────────────
test("checkRoundForm: ว่าง · 2499 · 2701 · ภาค 3 → ข้อความไทย · ถูก → null (กฎเดียวกับ _wl_term_args)", () => {
  for (const [y, s] of [["", "2"], ["   ", "2"], ["2499", "1"], ["2701", "1"], ["2569", "3"], ["2569", "0"],
    ["2569", ""], ["25x9", "1"], ["2569.0", "1"], ["12569", "1"], ["2569", "1.5"], ["-2569", "1"]]) {
    const e = checkRoundForm(y, s);
    ok(e !== null && hasThai(e), `${JSON.stringify([y, s])} ควรมีข้อความไทย ได้ ${JSON.stringify(e)}`);
  }
  eq(checkRoundForm("2569", "2"), null);
  eq(checkRoundForm(" 2569 ", " 1 "), null);
  eq(checkRoundForm("2500", "1"), null);
  eq(checkRoundForm("2700", "2"), null);
  ok(checkRoundForm("", "2")!.includes("ปี"), "ปีว่างต้องบอกว่าขาดปี");
  ok(checkRoundForm("2569", "3")!.includes("ภาคเรียน"), "ภาค 3 ต้องบอกเรื่องภาคเรียน");
});

test("termReadiness: มีรอบแล้ว → ห้าม · ยังไม่มีหลักสูตร → ไปทำหลักสูตรก่อน · โหลดรายการหลักสูตรไม่ได้ → ให้เซิร์ฟเวอร์ตัดสิน", () => {
  const terms = [{ year: 2569, semester: 2 }, { year: 2569, semester: 1 }];
  const rounds = [R({ id: 3, year: 2569, semester: 1, label: "1/2569", status: "closed" })];
  eq(termReadiness({ year: 2569, semester: 2 }, terms, rounds), { ok: true });
  const has = termReadiness({ year: 2569, semester: 1 }, terms, rounds);
  ok(!has.ok && !has.needCurriculum && has.reason.includes("1/2569") && has.reason.includes("รอบเดียว"), JSON.stringify(has));
  const none = termReadiness({ year: 2570, semester: 1 }, terms, rounds);
  ok(!none.ok && none.needCurriculum && none.reason.includes("1/2570") && none.reason.includes("หลักสูตร"), JSON.stringify(none));
  eq(termReadiness({ year: 2570, semester: 1 }, null, rounds), { ok: true });
  // มีรอบแล้วชนะเสมอ แม้ภาคเรียนนั้นไม่มีหลักสูตร (ไปทำหลักสูตรก็เปิดรอบไม่ได้อยู่ดี)
  const both = termReadiness({ year: 2569, semester: 1 }, [], rounds);
  ok(!both.ok && !both.needCurriculum, JSON.stringify(both));
});

test("defaultOpenTerm: ภาคเรียนล่าสุดที่มีหลักสูตรแต่ยังไม่มีรอบ → ภาคเรียนตอนนี้ → ภาคเรียนถัดจากรอบล่าสุด", () => {
  const guess = { year: 2569, semester: 2 };
  const terms = [{ year: 2570, semester: 1 }, { year: 2569, semester: 2 }];
  const r2569 = R({ year: 2569, semester: 2, label: "2/2569", status: "closed" });
  eq(defaultOpenTerm(terms, [], guess), { year: 2570, semester: 1 });
  eq(defaultOpenTerm(terms, [r2569], guess), { year: 2570, semester: 1 });
  eq(defaultOpenTerm([{ year: 2569, semester: 2 }], [r2569], guess), { year: 2570, semester: 1 });
  eq(defaultOpenTerm([], [], guess), guess);
  eq(defaultOpenTerm(null, [], guess), guess);
  const r1 = R({ id: 3, year: 2570, semester: 1, label: "1/2570", status: "closed" });
  eq(defaultOpenTerm(null, [r1, r2569], guess), { year: 2570, semester: 2 });
  eq(defaultOpenTerm(null, [r2569, r1], guess), { year: 2570, semester: 2 });
});

// ── ดูก่อนเปิด ───────────────────────────────────────────────────────
test("previewLines: ตัวเลขคั่นหลักพัน · 1,220 แถว · มีครูเทอมก่อน 1,220 แถว · ตัวเลือก 44", () => {
  const lines = previewLines(P());
  ok(lines.length > 0 && lines.every(hasThai), JSON.stringify(lines));
  ok(lines.some((l) => l.includes("1,220 แถว")), `ไม่มี "1,220 แถว": ${JSON.stringify(lines)}`);
  ok(lines.some((l) => l.includes("มีครูเทอมก่อน 1,220 แถว")), `ไม่มี "มีครูเทอมก่อน 1,220 แถว": ${JSON.stringify(lines)}`);
  ok(lines.some((l) => l.includes("ตัวเลือกคาบเสรี/กิจกรรม 44")), `ไม่มีตัวเลือก 44: ${JSON.stringify(lines)}`);
  ok(lines.some((l) => l.includes("40")), `ไม่มีตัวเลือกที่มีครูเทอมก่อน 40: ${JSON.stringify(lines)}`);
  eq(previewWarnings(P()), []);
});

test("previewLines: ไม่มีบรรทัดของค่าที่เป็น 0", () => {
  const zero = P({ rows: 5, options: 0, prefilled_rows: 0, prefilled_options: 0, empty_rows: 5 });
  const lines = previewLines(zero);
  ok(!lines.some(hasZero), `มีบรรทัดของศูนย์: ${JSON.stringify(lines)}`);
  ok(lines.some((l) => l.includes("5 แถว")), JSON.stringify(lines));
  ok(lines.some((l) => l.includes("ช่องครูว่าง 5 แถว")), `แถวที่ช่องครูว่างต้องขึ้น: ${JSON.stringify(lines)}`);
  ok(!lines.some((l) => l.includes("ตัวเลือก")), `ไม่มีตัวเลือกต้องไม่มีบรรทัดตัวเลือก: ${JSON.stringify(lines)}`);
  ok(!lines.some((l) => l.includes("เทอมก่อน")), `ไม่มีครูเทอมก่อนต้องไม่มีบรรทัดนั้น: ${JSON.stringify(lines)}`);
  ok(!previewLines(P()).some(hasZero), JSON.stringify(previewLines(P())));
});

test("previewLines/previewWarnings: บรรทัด/ตัวเลือกที่ยังไม่มีกลุ่มสาระเป็นคำเตือน (อยู่ในทั้งสองรายการ)", () => {
  const p = P({ lines_without_department: 3, options_without_department: 1 });
  const warn = previewWarnings(p);
  eq(warn.length, 2);
  ok(warn[0].includes("3 บรรทัด") && warn[0].includes("กลุ่มสาระ"), JSON.stringify(warn));
  ok(warn[1].includes("1 ตัวเลือก") && warn[1].includes("กลุ่มสาระ"), JSON.stringify(warn));
  const lines = previewLines(p);
  for (const w of warn) ok(lines.includes(w), `คำเตือนต้องอยู่ใน previewLines ด้วย: ${w}`);
  eq(previewWarnings(P({ lines_without_department: 1234 }))[0].includes("1,234 บรรทัด"), true);
});

test("previewLines: รายการที่แปลงไม่ได้ขึ้นจำนวน (ตัวรายการหน้าแสดงเอง)", () => {
  const p = P({ unconverted: [{ source: "requirement", ref: 1, reason: "ครูรหัส 599 ยังไม่มีในทะเบียน" }] });
  ok(previewLines(p).some((l) => l.includes("แปลงไม่ได้ 1 รายการ")), JSON.stringify(previewLines(p)));
  ok(!previewLines(P()).some((l) => l.includes("แปลงไม่ได้")), "ไม่มีรายการแปลงไม่ได้ต้องไม่มีบรรทัดนั้น");
});

test("openBlocker: ยังมีบรรทัด/ตัวเลือกที่ไม่มีกลุ่มสาระ → เหตุผลพร้อมจำนวน · ครบ → null", () => {
  eq(openBlocker(P()), null);
  const one = openBlocker(P({ lines_without_department: 3 }));
  ok(one !== null && one.includes("3 บรรทัด") && one.includes("หน้าหลักสูตร") && !one.includes("ตัวเลือก"), String(one));
  const two = openBlocker(P({ lines_without_department: 2, options_without_department: 5 }));
  ok(two !== null && two.includes("2 บรรทัด") && two.includes("5 ตัวเลือก"), String(two));
  const opt = openBlocker(P({ options_without_department: 1 }));
  ok(opt !== null && opt.includes("1 ตัวเลือก") && !opt.includes("บรรทัดหลักสูตร 0"), String(opt));
});

// ── ความคืบหน้าของกลุ่ม ────────────────────────────────────────────────
test("deptProgress 0/108 → 0% ยังไม่เริ่ม", () => {
  const p = deptProgress(D({ rows: 108, confirmed: 0, missing_teacher: 0 }));
  eq(p.pct, 0);
  ok(p.text.startsWith("ยังไม่เริ่ม") && p.text.includes("108 รายการ"), p.text);
});

test("deptProgress: นับเป็นรายการ · ปัดลง (99.9% ไม่ขึ้น 100%) · บอกจำนวนที่ยังไม่มีครู", () => {
  const p = deptProgress(D({ rows: 108, confirmed: 40, missing_teacher: 3 }));
  eq(p.pct, 37);
  ok(p.text.includes("ยืนยันแล้ว 40/108 รายการ") && p.text.includes("ยังไม่มีครู 3"), p.text);
  const full = deptProgress(D({ rows: 108, confirmed: 108 }));
  eq(full.pct, 100);
  ok(full.text.includes("ยืนยันครบ 108 รายการ"), full.text);
  eq(deptProgress(D({ rows: 1000, confirmed: 999 })).pct, 99);
  ok(deptProgress(D({ rows: 1258, confirmed: 1001 })).text.includes("1,001/1,258"), "ต้องคั่นหลักพัน");
  const empty = deptProgress(D({ rows: 0, confirmed: 0 }));
  eq(empty.pct, 0);
  ok(empty.text.includes("ไม่มีรายการ"), empty.text);
  for (const d of [D(), D({ confirmed: 40, missing_teacher: 3 }), D({ confirmed: 108 }), D({ rows: 0 })]) {
    ok(!deptProgress(d).text.includes("แถว"), `ต้องใช้คำว่า "รายการ" ไม่ใช่ "แถว": ${deptProgress(d).text}`);
  }
});

test("roundStats: ส่งแล้ว = submitted+approved · ยังไม่ยืนยัน = rows − confirmed − missing_teacher รวมทุกกลุ่ม", () => {
  const depts = [
    D({ department_id: 1, status: "submitted", rows: 108, confirmed: 108 }),
    D({ department_id: 2, status: "approved", rows: 115, confirmed: 115 }),
    D({ department_id: 3, status: "returned", rows: 147, confirmed: 96, missing_teacher: 1 }),
    D({ department_id: 4, status: "filling", rows: 111, confirmed: 0, missing_teacher: 5 }),
    D({ department_id: 11, status: "filling", rows: 0, confirmed: 0 }),
  ];
  const before = JSON.stringify(depts);
  eq(roundStats(R(), depts), {
    rows: 1220, options: 44, departments: 5, submitted: 2, approved: 1, unconfirmed: 50 + 106, missingTeacher: 6,
  });
  eq(JSON.stringify(depts), before);
  eq(roundStats(R({ counts: { rows: 0, sets: 0, options: 0, unconverted: 0 } }), []), {
    rows: 0, options: 0, departments: 0, submitted: 0, approved: 0, unconfirmed: 0, missingTeacher: 0,
  });
});

// ── ปุ่มตามสถานะ (ตามที่เซิร์ฟเวอร์ยอม) ───────────────────────────────────
test("roundActions: เตรียม = เปิดให้กรอก/ยกเลิก (ปิดไม่ได้) · เปิดให้กรอก = ปิดรอบ · ปิดแล้ว = ไม่มี", () => {
  eq(roundActions("preparing"), { open: true, cancel: true, close: false, review: false });
  eq(roundActions("filling"), { open: false, cancel: false, close: true, review: true });
  eq(roundActions("closed"), { open: false, cancel: false, close: false, review: false });
});

test("reviewActions: ตรวจผ่านเฉพาะ submitted · ตีกลับจาก submitted/approved · รอบปิดแล้ว/ยังเตรียม = ไม่มี", () => {
  eq(reviewActions("filling", "submitted"), { approve: true, return: true });
  eq(reviewActions("filling", "approved"), { approve: false, return: true });
  eq(reviewActions("filling", "filling"), { approve: false, return: false });
  eq(reviewActions("filling", "returned"), { approve: false, return: false });
  eq(reviewActions("closed", "submitted"), { approve: false, return: false });
  eq(reviewActions("preparing", "submitted"), { approve: false, return: false });
});

test("checkCloseLabel: ต้องพิมพ์ชื่อรอบให้ตรง (ตัดช่องว่างหัวท้ายแบบเซิร์ฟเวอร์)", () => {
  for (const typed of ["", "  ", "2/2568", "2569", "2 /2569", "ภาคเรียน 2/2569"]) {
    const e = checkCloseLabel(typed, "2/2569");
    ok(e !== null && hasThai(e) && e.includes("2/2569"), `${JSON.stringify(typed)} → ${JSON.stringify(e)}`);
  }
  eq(checkCloseLabel("2/2569", "2/2569"), null);
  eq(checkCloseLabel(" 2/2569 ", "2/2569"), null);
});

test("checkReturnNote: หมายเหตุตีกลับห้ามว่าง", () => {
  for (const n of ["", "   ", "\n\t"]) ok(checkReturnNote(n) !== null && hasThai(checkReturnNote(n)!), JSON.stringify(n));
  eq(checkReturnNote("ม.1/1 ครูชนคาบ"), null);
});

// ── รอบปัจจุบัน · ชิปบนแถบบน ────────────────────────────────────────────
test("currentRound / closedRounds / roundChip", () => {
  const closed = R({ id: 1, year: 2569, semester: 1, label: "1/2569", status: "closed", closed_at: "2026-10-01T03:00:00+00:00" });
  const filling = R({ id: 2 });
  eq(currentRound([filling, closed])?.id, 2);
  eq(currentRound([closed]), null);
  eq(closedRounds([filling, closed]).map((r) => r.id), [1]);
  eq(roundChip([]), null);
  eq(roundChip([closed]), null);
  eq(roundChip([filling, closed]), { tone: "info", text: "ภาคเรียน 2/2569 · เปิดให้กรอก" });
  eq(roundChip([R({ status: "preparing" })]), { tone: "warn", text: "ภาคเรียน 2/2569 · เตรียม (ยังไม่เปิดให้กรอก)" });
});

// ── ตรวจรูปคำตอบของเซิร์ฟเวอร์ ────────────────────────────────────────────
test("isRound / isRoundDetail: รูปถูก → true · ตัวเลขเป็นข้อความ/ติดลบ/สถานะแปลก/ขาดช่อง → false", () => {
  ok(isRound(R()), "รอบถูกรูปต้องผ่าน");
  ok(isRound(R({ status: "closed", closed_at: "2026-11-16T08:00:00+00:00" })), "รอบที่ปิดแล้ว");
  ok(isRoundDetail({ ...R(), unconverted: [] }), "รอบพร้อมรายการแปลงไม่ได้");
  ok(isRoundDetail({ ...R(), unconverted: [{ source: "x", ref: null, reason: "เหตุ" }] }), "รายการแปลงไม่ได้มีเหตุผล");
  ok(!isRoundDetail(R()), "ไม่มี unconverted ต้องไม่ผ่าน isRoundDetail");
  ok(!isRoundDetail({ ...R(), unconverted: [{ reason: 1 }] }), "เหตุผลไม่ใช่ข้อความ");
  const bad: unknown[] = [
    null, [], "x", { ...R(), id: "1" }, { ...R(), status: "open" }, { ...R(), label: 2569 },
    { ...R(), counts: { ...R().counts, rows: "1220" } }, { ...R(), counts: { ...R().counts, rows: -1 } },
    { ...R(), counts: { ...R().counts, options: 1.5 } }, { ...R(), counts: null }, { ...R(), closed_at: 5 },
    { ...R(), opened_at: null }, (({ year: _y, ...rest }) => rest)(R()),
  ];
  bad.forEach((b, i) => ok(!isRound(b), `ตัวที่ ${i} ควรไม่ผ่าน: ${JSON.stringify(b)}`));
});

test("isDeptStatus / isRoundPreview: ตัวเลขต้องเป็นจำนวนเต็มไม่ติดลบ · สถานะต้องรู้จัก", () => {
  ok(isDeptStatus(D()), "กลุ่มถูกรูป");
  ok(isDeptStatus(D({ status: "returned", reviewed_at: "2026-11-16T08:00:00+00:00", reviewed_by: "ผู้ดูแลระบบ", note: "แก้" })), "ตีกลับ");
  for (const b of [{ ...D(), rows: "108" }, { ...D(), confirmed: -1 }, { ...D(), status: "done" },
    { ...D(), department_id: null }, { ...D(), note: null }, { ...D(), missing_teacher: undefined }, { ...D(), submitted_by: 1 }]) {
    ok(!isDeptStatus(b), `ควรไม่ผ่าน: ${JSON.stringify(b)}`);
  }
  ok(isRoundPreview(P()), "ดูก่อนเปิดถูกรูป");
  for (const k of ["rows", "options", "prefilled_rows", "prefilled_options", "empty_rows", "lines_without_department",
    "options_without_department"] as const) {
    ok(!isRoundPreview({ ...P(), [k]: "1" }), `${k} เป็นข้อความต้องไม่ผ่าน`);
    ok(!isRoundPreview({ ...P(), [k]: -1 }), `${k} ติดลบต้องไม่ผ่าน`);
  }
  ok(!isRoundPreview({ ...P(), unconverted: null }), "unconverted ต้องเป็นรายการ");
  ok(!isRoundPreview({ ...P(), label: null }), "label ต้องเป็นข้อความ");
});

test("isRoundRow / isRoundOption / isOptionTeacher / isTeacherLoad (รูปในสัญญา · ของงานที่ 8)", () => {
  const row = {
    id: 5, round_id: 1, line_id: 9, curriculum_id: 2, curriculum_name: "ม.1/1", group_id: 1, group_name: "ม.1/1",
    subject_id: 7, code: "ท21102", name: "ภาษาไทยพื้นฐาน 2", credits: 1.5, weekly: 3, kind: "basic", department_id: 1,
    teacher_id: 4, co_teacher_id: null, lab_room_id: null, is_double: false, note: "", confirmed: false, from_plan: true,
    flag: null,
  };
  ok(isRoundRow(row), "แถวถูกรูป");
  ok(isRoundRow({ ...row, subject_id: null, credits: null, department_id: null, teacher_id: null, flag: "ครูสอนร่วมไม่ครบ" }), "ค่าว่างที่สัญญายอม");
  for (const b of [{ ...row, weekly: "3" }, { ...row, kind: "core" }, { ...row, confirmed: "false" }, { ...row, teacher_id: "4" },
    { ...row, group_name: null }, { ...row, credits: "1.5" }, { ...row, is_double: 0 }]) {
    ok(!isRoundRow(b), `แถวควรไม่ผ่าน: ${JSON.stringify(b)}`);
  }
  const ot = { id: 3, round_id: 1, option_id: 8, set_id: 2, teacher_id: 4, room_id: null, note: "", confirmed: true, from_plan: false };
  ok(isOptionTeacher(ot), "ครูของตัวเลือกถูกรูป");
  ok(!isOptionTeacher({ ...ot, confirmed: 1 }), "confirmed ต้องเป็นจริงเท็จ");
  const opt = {
    id: 8, set_id: 2, subject_id: 11, code: "ค31218", name: "คณิตเพิ่ม", department_id: 2,
    set: { id: 2, year: 2569, semester: 2, kind: "elective", name: "ชุด 1", group_ids: [1, 2], group_names: ["ม.4/1", "ม.4/2"], weekly: 2, is_double: false },
    teachers: [ot],
  };
  ok(isRoundOption(opt), "ตัวเลือกถูกรูป");
  ok(!isRoundOption({ ...opt, teachers: [{ ...ot, id: "3" }] }), "ครูของตัวเลือกผิดรูป");
  ok(!isRoundOption({ ...opt, set: { ...opt.set, weekly: "2" } }), "ชุดผิดรูป");
  ok(!isRoundOption({ ...opt, set: { ...opt.set, group_names: ["ม.4/1"] } }), "ชื่อห้องไม่ครบคู่กับรหัสห้อง");
  const load = { teacher_id: 4, name: "ครู ก", department_id: 1, total: 18, own: 12 };
  ok(isTeacherLoad(load) && isTeacherLoad({ ...load, department_id: null }), "ยอดคาบถูกรูป");
  ok(!isTeacherLoad({ ...load, total: -1 }) && !isTeacherLoad({ ...load, own: "12" }), "ยอดคาบผิดรูป");
});

// ══ หน้ากรอกของหัวหน้ากลุ่มสาระ (งานที่ 8) ══════════════════════════════════
// จุดที่ต้องไม่พลาด: นับแบบเดียวกับ wl_fill_counts (แถวครบ = มีครูและยืนยัน · ตัวเลือกครบ = มีครูและครูทุกคนยืนยัน)
// · ข้อความส่งไม่ได้/แก้ไม่ได้เป็นคำเดียวกับเซิร์ฟเวอร์ · **การแก้ช่องอื่นของแถวจากเทอมก่อนต้องไม่ส่ง teacher_id/confirmed**
// (PUT ที่มี teacher_id = ยืนยันอัตโนมัติแม้ค่าเดิม — แถวจะกลายเป็นยืนยันโดยไม่มีคนกด) · ครูที่ไม่ปฏิบัติงานแล้วไม่อยู่ในตัวเลือก

// แถวรูปจริงของ GET .../rows (ครูจากเทอมก่อน ยังไม่ยืนยัน)
const W = (p: Partial<RoundRow> = {}): RoundRow => ({
  id: 1, round_id: 1, line_id: 10, curriculum_id: 2, curriculum_name: "ม.1 ห้องปกติ", group_id: 1, group_name: "ม.1/1",
  subject_id: 7, code: "ท21102", name: "ภาษาไทยพื้นฐาน 2", credits: 1.5, weekly: 3, kind: "basic", department_id: 1,
  teacher_id: 4, co_teacher_id: null, lab_room_id: null, is_double: false, note: "", confirmed: false, from_plan: true,
  flag: null, ...p,
});
const OT = (p: Partial<OptionTeacher> = {}): OptionTeacher => ({
  id: 1, round_id: 1, option_id: 8, set_id: 2, teacher_id: 4, room_id: null, note: "", confirmed: false, from_plan: true, ...p,
});
const O = (p: Partial<RoundOption> = {}): RoundOption => ({
  id: 8, set_id: 2, subject_id: 11, code: "ส30201", name: "ประวัติศาสตร์ไทย", department_id: 1,
  set: { id: 2, year: 2569, semester: 2, kind: "elective", name: "เสรี ม.4", group_ids: [40, 41], group_names: ["ม.4/1", "ม.4/2"],
    weekly: 2, is_double: false },
  teachers: [OT()], ...p,
});
const names: Record<number, string> = { 4: "นางกุลจิรา ยะศะนพ", 5: "นายรัฐชานนท์ กรุ่นทิพย์", 6: "นางสาวณิชาภา ภู่ด้วง" };
const nameOf = (id: number): string => names[id] ?? `ครูรหัส ${id}`;

test("rowState: ดูว่ามีครูก่อน แล้วค่อยดูธงยืนยัน (แถวที่ยืนยันแต่ไม่มีครู = ยังไม่มีครู) · มีแต่ครูสอนร่วม = ยังไม่มีครู", () => {
  eq(rowState(W()), "unconfirmed");
  eq(rowState(W({ confirmed: true })), "done");
  eq(rowState(W({ teacher_id: null })), "missing");
  eq(rowState(W({ teacher_id: null, confirmed: true })), "missing");
  // _wl_row_state ของเซิร์ฟเวอร์ดูแค่ teacher_id — ครูสอนร่วมอย่างเดียวไม่นับว่ามีครู
  eq(rowState(W({ teacher_id: null, co_teacher_id: 5, confirmed: true })), "missing");
});

test("optionState: ไม่มีครูสักคน = ยังไม่มีครู · มีคนที่ยังไม่ยืนยัน = ยังไม่ยืนยัน · ครูทุกคนยืนยัน = ครบ", () => {
  eq(optionState(O({ teachers: [] })), "missing");
  eq(optionState(O({ teachers: [OT({ teacher_id: null, confirmed: true })] })), "missing");
  eq(optionState(O()), "unconfirmed");
  eq(optionState(O({ teachers: [OT({ confirmed: true }), OT({ id: 2, teacher_id: 5, confirmed: false })] })), "unconfirmed");
  eq(optionState(O({ teachers: [OT({ confirmed: true }), OT({ id: 2, teacher_id: 5, confirmed: true })] })), "done");
  // ครูที่ไม่มีรหัส (null) ไม่นับ — ตัวเลือกที่เหลือคนจริงยืนยันครบคือครบ
  eq(optionState(O({ teachers: [OT({ confirmed: true }), OT({ id: 2, teacher_id: null, confirmed: false })] })), "done");
});

test("fillProgress นับแบบ wl_fill_counts: รายการ = แถว + ตัวเลือก · ไม่แก้ลิสต์เดิม", () => {
  const rows = [
    W({ id: 1, confirmed: true }), W({ id: 2 }), W({ id: 3, teacher_id: null }),
    W({ id: 4, teacher_id: null, confirmed: true }), W({ id: 5, teacher_id: null, co_teacher_id: 5 }),
  ];
  const options = [O({ id: 8, teachers: [] }), O({ id: 9, teachers: [OT({ confirmed: true })] }), O({ id: 10 })];
  const before = JSON.stringify([rows, options]);
  eq(fillProgress(rows, options), { total: 8, confirmed: 2, missingTeacher: 4 });
  eq(JSON.stringify([rows, options]), before);
  eq(fillProgress([], []), { total: 0, confirmed: 0, missingTeacher: 0 });
});

test("submitState: ข้อความตรงกับ wl_submit_blocker (มีตัวเลข · เฉพาะส่วนที่ไม่เป็นศูนย์) · ครบ = ส่งได้", () => {
  const both = submitState({ total: 108, confirmed: 84, missingTeacher: 4 }, "filling", "filling");
  eq(both, {
    can: false,
    reason: "ยังส่งไม่ได้ — ยังไม่มีครู 4 รายการ · ยังไม่ยืนยัน 20 รายการ (นับทั้งแถววิชาและตัวเลือกคาบเสรี/กิจกรรมของกลุ่ม) ใส่ครูและยืนยันให้ครบก่อน",
  });
  const unconf = submitState({ total: 108, confirmed: 84, missingTeacher: 0 }, "returned", "filling");
  ok(!unconf.can && unconf.reason!.includes("ยังไม่ยืนยัน 24 รายการ") && !unconf.reason!.includes("ยังไม่มีครู"), String(unconf.reason));
  const miss = submitState({ total: 108, confirmed: 105, missingTeacher: 3 }, "filling", "filling");
  ok(!miss.can && miss.reason!.includes("ยังไม่มีครู 3 รายการ") && !miss.reason!.includes("ยังไม่ยืนยัน"), String(miss.reason));
  eq(submitState({ total: 108, confirmed: 108, missingTeacher: 0 }, "filling", "filling"), { can: true, reason: null });
  eq(submitState({ total: 108, confirmed: 108, missingTeacher: 0 }, "returned", "filling"), { can: true, reason: null });
  // กลุ่มที่ไม่มีรายการเลย: เซิร์ฟเวอร์ไม่ขวาง (ไม่มีอะไรค้าง)
  eq(submitState({ total: 0, confirmed: 0, missingTeacher: 0 }, "filling", "filling"), { can: true, reason: null });
});

test("submitState: สถานะกลุ่ม/รอบที่ส่งไม่ได้ (ส่งแล้ว · ตรวจผ่าน · รอบปิด · รอบยังเตรียม) — รอบตัดสินก่อน", () => {
  const full = { total: 108, confirmed: 108, missingTeacher: 0 };
  eq(submitState(full, "submitted", "filling"), { can: false, reason: "ส่งแล้ว รอผู้ดูแลระบบตรวจ" });
  eq(submitState(full, "approved", "filling"), { can: false, reason: "ตรวจผ่านแล้ว" });
  const closed = submitState(full, "filling", "closed");
  ok(!closed.can && closed.reason!.includes("ปิดแล้ว"), String(closed.reason));
  eq(submitState(full, "submitted", "closed").reason, closed.reason);
  const prep = submitState(full, "filling", "preparing");
  eq(prep, { can: false, reason: "รอบอัตรากำลังนี้ยังไม่เปิดให้กลุ่มสาระกรอก" });
  // ยังไม่ครบ + ส่งแล้ว → บอกว่าส่งแล้ว (ไม่ใช่ตัวเลขที่ค้าง)
  eq(submitState({ total: 5, confirmed: 1, missingTeacher: 1 }, "submitted", "filling").reason, "ส่งแล้ว รอผู้ดูแลระบบตรวจ");
});

test("submitState/editState: ข้อความเป็นชิ้นเดียวกับของเซิร์ฟเวอร์ (wl_submit_blocker · wl_can_edit ใน mock_api.py)", () => {
  const src = readFileSync(new URL("../../mock_api.py", import.meta.url), "utf8");
  const body = (fn: string): string => {
    const at = src.indexOf(`def ${fn}(`);
    ok(at >= 0, `หา ${fn} ใน mock_api.py ไม่เจอ`);
    return src.slice(at, src.indexOf("\ndef ", at + 5));
  };
  const blocker = body("wl_submit_blocker");
  for (const piece of ["ยังส่งไม่ได้ — ", "ยังไม่มีครู {missing} รายการ", "ยังไม่ยืนยัน {unconfirmed} รายการ", "' · '",
    "(นับทั้งแถววิชาและตัวเลือกคาบเสรี/กิจกรรมของกลุ่ม) ", "ใส่ครูและยืนยันให้ครบก่อน"]) {
    ok(blocker.includes(piece), `wl_submit_blocker ไม่มี ${JSON.stringify(piece)} แล้ว — แก้ submitState ให้ตรง`);
  }
  const canEdit = body("wl_can_edit");
  for (const text of [editState("head", "closed", "filling").reason!, editState("head", "preparing", "filling").reason!,
    "จึงแก้ไม่ได้ — ถ้าต้องแก้ ให้ผู้ดูแลระบบตีกลับก่อน", editState("head", "filling", null).reason!]) {
    ok(canEdit.includes(text), `wl_can_edit ไม่มีข้อความ ${JSON.stringify(text)}`);
  }
});

test("editState ตาม wl_can_edit: หัวหน้าแก้ได้เมื่อรอบเปิดให้กรอกและกลุ่มกำลังกรอก/ถูกตีกลับ · admin แก้ได้ทุกสถานะกลุ่ม · รอบปิดห้ามทุกคน", () => {
  eq(editState("head", "filling", "filling"), { can: true, reason: null });
  eq(editState("head", "filling", "returned"), { can: true, reason: null });
  eq(editState("head", "filling", "submitted"), {
    can: false, reason: "กลุ่มสาระนี้ส่งแล้ว รอผู้ดูแลระบบตรวจ จึงแก้ไม่ได้ — ถ้าต้องแก้ ให้ผู้ดูแลระบบตีกลับก่อน",
  });
  eq(editState("head", "filling", "approved").reason, "กลุ่มสาระนี้ตรวจผ่านแล้ว จึงแก้ไม่ได้ — ถ้าต้องแก้ ให้ผู้ดูแลระบบตีกลับก่อน");
  eq(editState("head", "preparing", "filling"), { can: false, reason: "รอบอัตรากำลังนี้ยังไม่เปิดให้กลุ่มสาระกรอก" });
  const closed = { can: false, reason: "รอบอัตรากำลังนี้ปิดแล้ว จึงแก้ไม่ได้อีก (เก็บไว้เป็นหลักฐานย้อนหลัง)" };
  eq(editState("head", "closed", "filling"), closed);
  eq(editState("admin", "closed", "filling"), closed);
  for (const s of ["filling", "submitted", "returned", "approved", null] as const) {
    eq(editState("admin", "filling", s), { can: true, reason: null });
    eq(editState("admin", "preparing", s), { can: true, reason: null });
  }
  ok(!editState("head", "filling", null).can, "หัวหน้าที่ไม่มีสถานะกลุ่มต้องแก้ไม่ได้");
});

test("groupBySubject: การ์ดละวิชา (รหัส ชื่อ คาบ ประเภท หน่วยกิต เดียวกัน) รวมทุกหลักสูตร · เรียงตามระดับของห้องแรกแล้วรหัสวิชา · แถวเรียงแบบห้อง · ไม่แก้ลิสต์เดิม", () => {
  const rows = [
    W({ id: 1, line_id: 30, code: "ท31102", name: "ภาษาไทย 4", group_name: "ม.4/2", curriculum_name: "ม.4 วิทย์", curriculum_id: 5 }),
    W({ id: 2, line_id: 10, group_name: "ม.1/10" }),
    W({ id: 3, line_id: 10, group_name: "ม.1/2" }),
    W({ id: 4, line_id: 20, code: "ท21101", name: "ภาษาไทยพื้นฐาน 1", group_name: "ม.1/1", weekly: 2, credits: 1, kind: "additional" }),
    W({ id: 5, line_id: 30, code: "ท31102", name: "ภาษาไทย 4", group_name: "ม.4/1", curriculum_name: "ม.4 วิทย์", curriculum_id: 5 }),
    W({ id: 6, line_id: 10, group_name: "ม.1/1" }),
    W({ id: 7, line_id: 40, code: "ก00001", name: "แนะแนว", group_name: "ห้องสมุด", kind: "activity", credits: null }),
    // วิชาเดียวกันจากอีกหลักสูตร = การ์ดเดียวกัน (ข้อมูลจริง: หลักสูตรส่วนใหญ่มีห้องเดียว) · การ์ดบอกทุกหลักสูตรที่แถวมาจาก
    W({ id: 8, line_id: 11, group_name: "ม.1/11", curriculum_name: "ม.1 พิเศษ", curriculum_id: 3 }),
    // รหัสเดียวกันแต่คาบ/สัปดาห์ต่างกัน = คนละการ์ด (หัวการ์ดบอกคาบเดียว)
    W({ id: 9, line_id: 12, group_name: "ม.1/12", curriculum_name: "ม.1 เข้ม", curriculum_id: 4, weekly: 4 }),
  ];
  const before = JSON.stringify(rows);
  const g = groupBySubject(rows);
  eq(JSON.stringify(rows), before);
  eq(g.map((x) => x.rows.map((r) => r.id)), [[4], [6, 3, 2, 8], [9], [5, 1], [7]]);
  eq(g[1].rows.map((r) => r.group_name), ["ม.1/1", "ม.1/2", "ม.1/10", "ม.1/11"]);
  eq({ ...g[0], rows: g[0].rows.length }, {
    key: "ท21101|ภาษาไทยพื้นฐาน 1|2|additional|1", code: "ท21101", name: "ภาษาไทยพื้นฐาน 1", weekly: 2, kind: "additional",
    credits: 1, curricula: [{ id: 2, name: "ม.1 ห้องปกติ" }], curriculumName: "ม.1 ห้องปกติ", rows: 1,
  });
  eq(g[1].curricula, [{ id: 2, name: "ม.1 ห้องปกติ" }, { id: 3, name: "ม.1 พิเศษ" }]);
  eq(g[1].curriculumName, "ม.1 ห้องปกติ · ม.1 พิเศษ");
  eq([g[2].weekly, g[2].curricula.map((c) => c.id)], [4, [4]]);
  eq(new Set(g.map((x) => x.key)).size, g.length);
  eq(groupBySubject([]), []);
});

test("groupBySubject: ส33102 สองครูสลับห้อง ม.6/1–6/14 จาก 11 หลักสูตร → การ์ดเดียว 14 ห้อง เรียงแบบตัวเลข", () => {
  const rooms = Array.from({ length: 14 }, (_, i) => `ม.6/${14 - i}`);
  const rows = rooms.map((room, i) => W({
    id: 100 + i, line_id: 500 + (i % 11), curriculum_id: 60 + (i % 11), curriculum_name: `หลักสูตร ${i % 11}`,
    code: "ส33102", name: "ประวัติศาสตร์ 6", group_name: room, weekly: 1, credits: 0.5, teacher_id: i % 2 ? 5 : 6,
  }));
  const g = groupBySubject(rows);
  eq(g.length, 1);
  eq(g[0].rows.map((r) => r.group_name), Array.from({ length: 14 }, (_, i) => `ม.6/${i + 1}`));
  eq(g[0].curricula.length, 11);
});

test("subjectLine: ประเภท · หน่วยกิต · คาบ/สัปดาห์ · จำนวนห้อง (ไม่มีหน่วยกิต = ไม่มีส่วนนั้น)", () => {
  const g = groupBySubject([W({ id: 1 }), W({ id: 2, group_name: "ม.1/2" })])[0];
  eq(subjectLine(g), "พื้นฐาน · 1.5 หน่วยกิต · 3 คาบ/สัปดาห์ · 2 ห้อง");
  const a = groupBySubject([W({ kind: "activity", credits: null, weekly: 1 })])[0];
  eq(subjectLine(a), "กิจกรรมพัฒนาผู้เรียน · 1 คาบ/สัปดาห์ · 1 ห้อง");
});

test("filterRows: สามสถานะ · ระดับชั้น · ค้นรหัส/ชื่อวิชา/ห้อง/ชื่อครู (ครูสอนร่วมด้วย) · ไม่สนช่องว่างหัวท้ายและตัวพิมพ์", () => {
  const rows = [
    W({ id: 1, confirmed: true }),
    W({ id: 2, group_name: "ม.1/2" }),
    W({ id: 3, group_name: "ม.2/1", teacher_id: null, code: "ท22102", name: "ภาษาไทย 4" }),
    W({ id: 4, group_name: "ม.4/1", teacher_id: 6, co_teacher_id: 5, confirmed: true, code: "ENG31101", name: "English 1" }),
    W({ id: 5, group_name: "ม.4/2", teacher_id: null, confirmed: true }),
  ];
  const ids = (f: Parameters<typeof filterRows>[1]) => filterRows(rows, f, nameOf).map((r) => r.id);
  const all = { state: "all" as const, level: null, query: "" };
  eq(ids(all), [1, 2, 3, 4, 5]);
  // ยังไม่ยืนยัน = ทุกแถวที่ยังไม่ครบ (มีครูแต่ยังไม่ยืนยัน + ยังไม่มีครู · แถวยืนยันที่ไม่มีครูก็ยังไม่ครบ)
  eq(ids({ ...all, state: "todo" }), [2, 3, 5]);
  eq(ids({ ...all, state: "done" }), [1, 4]);
  eq(ids({ ...all, level: "ม.1" }), [1, 2]);
  eq(ids({ ...all, level: "ม.4", state: "done" }), [4]);
  eq(ids({ ...all, level: "ม.6" }), []);
  eq(ids({ ...all, query: "  ท22102 " }), [3]);
  eq(ids({ ...all, query: "english" }), [4]);
  eq(ids({ ...all, query: "ม.1/2" }), [2]);
  eq(ids({ ...all, query: "กุลจิรา" }), [1, 2]);
  eq(ids({ ...all, query: "รัฐชานนท์" }), [4]);
  eq(ids({ ...all, query: "   " }), [1, 2, 3, 4, 5]);
  eq(ids({ state: "todo", level: "ม.1", query: "กุลจิรา" }), [2]);
  const before = JSON.stringify(rows);
  filterRows(rows, { state: "todo", level: "ม.1", query: "x" }, nameOf);
  eq(JSON.stringify(rows), before);
});

test("filterOptions: สถานะของตัวเลือก · ระดับจากห้องของชุด · ค้นรหัส/ชื่อวิชา/ชื่อชุด/ครู", () => {
  const opts = [
    O({ id: 1 }),
    O({ id: 2, code: "ง30201", name: "งานช่าง", teachers: [OT({ teacher_id: 5, confirmed: true })] }),
    O({ id: 3, teachers: [], set: { ...O().set, name: "กิจกรรมชุมนุม ม.1", group_names: ["ม.1/1"], group_ids: [1] } }),
  ];
  const ids = (f: Parameters<typeof filterOptions>[1]) => filterOptions(opts, f, nameOf).map((o) => o.id);
  const all = { state: "all" as const, level: null, query: "" };
  eq(ids(all), [1, 2, 3]);
  eq(ids({ ...all, state: "todo" }), [1, 3]);
  eq(ids({ ...all, state: "done" }), [2]);
  eq(ids({ ...all, level: "ม.1" }), [3]);
  eq(ids({ ...all, level: "ม.4" }), [1, 2]);
  eq(ids({ ...all, query: " ชุมนุม" }), [3]);
  eq(ids({ ...all, query: "รัฐชานนท์" }), [2]);
  eq(ids({ ...all, query: "ง30201" }), [2]);
});

test("fillLevels: ระดับที่มีในแถวและตัวเลือก เรียงตามเลข ไม่ซ้ำ", () => {
  eq(fillLevels([W({ group_name: "ม.4/1" }), W({ group_name: "ม.1/2" }), W({ group_name: "ม.10/1" }), W({ group_name: "ห้องสมุด" })],
    [O({ set: { ...O().set, group_names: ["ม.6/1", "ม.1/1"] } })]), ["ม.1", "ม.4", "ม.6", "ม.10"]);
  eq(fillLevels([], []), []);
});

test("teacherChoices: เฉพาะครูที่ยังปฏิบัติงาน · กลุ่มตัวเองก่อน แล้วตามชื่อ (เรียงแบบพจนานุกรมไทย) · ชื่อซ้ำเป็นสองตัวเลือกด้วย id", () => {
  const teachers = [
    { id: 1, name: "นายรัฐชานนท์ กรุ่นทิพย์", department_id: 2, active: true },
    { id: 2, name: "นางสมใจ ดีมาก", department_id: 1, active: true },
    { id: 3, name: "นางกุลจิรา ยะศะนพ", department_id: 1, active: false },
    { id: 4, name: "นางเพ็ญพรรณ เนติประเสริฐ", department_id: 1, active: true },
    { id: 9, name: "นางสมใจ ดีมาก", department_id: 1, active: true },
    { id: 5, name: "นางลินดา จั่นเพ็ชร์", department_id: null, active: true },
  ];
  const before = JSON.stringify(teachers);
  const c = teacherChoices(teachers, 1);
  eq(JSON.stringify(teachers), before);
  eq(c.map((x) => x.id), [4, 2, 9, 5, 1]);
  eq(c.find((x) => x.id === 3), undefined);
  eq(c.map((x) => x.own), [true, true, true, false, false]);
  eq(c[0], { id: 4, name: "นางเพ็ญพรรณ เนติประเสริฐ", own: true });
  eq(c.filter((x) => x.name === "นางสมใจ ดีมาก").map((x) => x.id), [2, 9]);
});

test("teacherNamer: ชื่อจากทะเบียน (รวมครูที่ไม่ปฏิบัติงานแล้ว) · ไม่รู้จัก = ครูรหัส N", () => {
  const n = teacherNamer([{ id: 3, name: "นางกุลจิรา ยะศะนพ", active: false }, { id: 4, name: "นายก", active: true }]);
  eq(n(3), "นางกุลจิรา ยะศะนพ");
  eq(n(4), "นายก");
  eq(n(77), "ครูรหัส 77");
});

test("rowPatch: ส่งเฉพาะช่องที่เปลี่ยน — แก้หมายเหตุของแถวจากเทอมก่อนต้องไม่มี teacher_id และ confirmed", () => {
  const prev = W({ teacher_id: 4, confirmed: false, from_plan: true });
  const p = rowPatch(prev, { ...prev, note: "ห้องคอมพิวเตอร์ 2" });
  eq(p, { note: "ห้องคอมพิวเตอร์ 2" });
  ok(!("teacher_id" in p) && !("confirmed" in p), JSON.stringify(p));
  eq(rowPatch(prev, { ...prev }), {});
  eq(rowPatch(prev, { teacher_id: 4 }), {});
  eq(rowPatch(prev, { teacher_id: 5 }), { teacher_id: 5 });
  eq(rowPatch(prev, { teacher_id: null }), { teacher_id: null });
  eq(rowPatch(prev, { co_teacher_id: 6, lab_room_id: 30, is_double: true }), { co_teacher_id: 6, lab_room_id: 30, is_double: true });
  eq(rowPatch(prev, { is_double: false, lab_room_id: null }), {});
  // หมายเหตุตัดช่องว่างหัวท้ายแบบเซิร์ฟเวอร์ — พิมพ์ช่องว่างเพิ่มอย่างเดียวไม่ใช่การแก้
  eq(rowPatch(W({ note: "ห้องคอม" }), { note: "  ห้องคอม " }), {});
  eq(rowPatch(W({ note: "ห้องคอม" }), { note: " ห้องคอม 2 " }), { note: "ห้องคอม 2" });
  eq(rowPatch(prev, { confirmed: true }), { confirmed: true });
  // ช่องวิชา/ห้อง/คาบ ไม่ใช่ของหัวหน้า — ไม่หลุดเข้า patch แม้ส่งมา
  eq(rowPatch(prev, { ...prev, weekly: 9, code: "X", group_id: 99 } as Partial<RoundRow>), {});
});

test("optionTeacherPatch: ส่งเฉพาะห้อง/หมายเหตุ/ยืนยันที่เปลี่ยน — ไม่มี teacher_id ถ้าไม่ได้เปลี่ยนครู", () => {
  const prev = OT({ room_id: null, note: "", confirmed: false });
  eq(optionTeacherPatch(prev, { ...prev, room_id: 30 }), { room_id: 30 });
  eq(optionTeacherPatch(prev, { ...prev, note: " ใช้ห้องดนตรี " }), { note: "ใช้ห้องดนตรี" });
  eq(optionTeacherPatch(prev, { ...prev }), {});
  eq(optionTeacherPatch(prev, { confirmed: true }), { confirmed: true });
  // เปลี่ยนครูของตัวเลือก = เอาออกแล้วเพิ่มใหม่ (PUT ที่มี teacher_id ยืนยันอัตโนมัติ) — patch ไม่พาไปด้วยแม้ค่าต่าง
  eq(optionTeacherPatch(prev, { ...prev, teacher_id: 9, note: "x" }), { note: "x" });
});

test("bulkConfirmIds: ยืนยันได้เฉพาะแถวที่เลือกซึ่งมีครูและยังไม่ยืนยัน · นับแถวที่ยังไม่มีครู", () => {
  const rows = [W({ id: 1 }), W({ id: 2, confirmed: true }), W({ id: 3, teacher_id: null }), W({ id: 4 }),
    W({ id: 5, teacher_id: null, confirmed: true })];
  eq(bulkConfirmIds(rows, new Set([1, 2, 3, 5, 99])), { ids: [1], noTeacher: 2 });
  eq(bulkConfirmIds(rows, new Set()), { ids: [], noTeacher: 0 });
  eq(bulkConfirmIds(rows, new Set([1, 4])), { ids: [1, 4], noTeacher: 0 });
});

test("bulkConfirmTargets (re-review): ยืนยันแถวที่เลือกข้ามแถวที่มีร่างครูไม่บันทึก — ไม่ยืนยันครูเดิมแทนครูที่จอแสดง", () => {
  // repro ตรง ๆ: การ์ด ท21102 เก้าห้อง ครูเทอมก่อนยังไม่ยืนยันทุกแถว · ม.1/1 (id 13) เลือกครูใหม่ไว้แต่ยังไม่กดบันทึกครู · เลือกทั้งหมด
  const rows = [13, 14, 15, 16, 17, 18, 19, 20, 21].map((id) => W({ id, teacher_id: 1, confirmed: false, from_plan: true }));
  const all = new Set(rows.map((r) => r.id));
  const t = bulkConfirmTargets(rows, all, new Set([13]));
  eq(t.ids, [14, 15, 16, 17, 18, 19, 20, 21]);
  eq([t.skipped, t.noTeacher], [1, 0]);
  eq(t.reason, "ข้าม 1 แถวที่เลือกครูไว้แต่ยังไม่กดบันทึกครู — กดบันทึกครูหรือยกเลิกก่อน");
  // ไม่มีร่าง = เหมือน bulkConfirmIds เดิม
  eq(bulkConfirmTargets(rows, all, new Set()), { ...bulkConfirmIds(rows, all), skipped: 0, reason: null });
  // ทุกแถวที่เลือกมีร่าง → ไม่มีอะไรให้ยืนยัน (ปุ่มปิด) พร้อมเหตุผลเดียวกัน
  const only = bulkConfirmTargets(rows, new Set([13, 14]), new Set([13, 14, 99]));
  eq([only.ids, only.skipped, only.reason], [[], 2, "ข้าม 2 แถวที่เลือกครูไว้แต่ยังไม่กดบันทึกครู — กดบันทึกครูหรือยกเลิกก่อน"]);
  // ร่างของแถวที่ไม่ได้เลือก ไม่นับ · แถวที่ยืนยันแล้วแต่มีร่าง (กำลังเปลี่ยนครู) นับว่าข้าม — มีร่างค้างที่ต้องบันทึกหรือยกเลิกเหมือนกัน
  const mixed = [W({ id: 1 }), W({ id: 2, confirmed: true }), W({ id: 3, teacher_id: null }), W({ id: 4 })];
  eq(bulkConfirmTargets(mixed, new Set([1, 2, 3]), new Set([4])), { ids: [1], noTeacher: 1, skipped: 0, reason: null });
  eq(bulkConfirmTargets(mixed, new Set([1, 2, 3]), new Set([2, 4])), {
    ids: [1], noTeacher: 1, skipped: 1, reason: "ข้าม 1 แถวที่เลือกครูไว้แต่ยังไม่กดบันทึกครู — กดบันทึกครูหรือยกเลิกก่อน" });
  // แถวที่ยังไม่มีครูแต่เลือกครูเป็นร่างไว้: บอกให้กดบันทึกครู (ข้าม) ไม่ใช่ "ใส่ครูก่อน"
  eq(bulkConfirmTargets(mixed, new Set([1, 3]), new Set([3])), {
    ids: [1], noTeacher: 0, skipped: 1, reason: "ข้าม 1 แถวที่เลือกครูไว้แต่ยังไม่กดบันทึกครู — กดบันทึกครูหรือยกเลิกก่อน" });
  // ไม่แก้ของที่ส่งเข้ามา
  const snap = JSON.stringify(rows);
  bulkConfirmTargets(rows, all, new Set([13]));
  eq(JSON.stringify(rows), snap);
});

test("unsavedDraftsText: กล่องยืนยันการส่งบอกจำนวนร่างครูที่ยังไม่บันทึก (ไม่บล็อกการส่ง)", () => {
  eq(unsavedDraftsText(0), null);
  eq(unsavedDraftsText(2), "มี 2 แถวที่เลือกครูไว้แต่ยังไม่กดบันทึกครู — ถ้าส่งตอนนี้ ครูที่เลือกไว้จะไม่ถูกบันทึก");
});

test("loadBars: แถบหลักคือ own (head) · บอกยอดรวมทุกกลุ่มเมื่อมากกว่า · เรียงมากไปน้อย · ยอดถึงค่ามากสุดของกลุ่มเป็นสีเตือน", () => {
  const L = (p: Partial<TeacherLoad>): TeacherLoad => ({ teacher_id: 1, name: "ก", department_id: 1, total: 0, own: 0, ...p });
  const loads = [
    L({ teacher_id: 1, name: "นางสาวณิชาภา ภู่ด้วง", own: 18, total: 18 }),
    L({ teacher_id: 2, name: "นางเพ็ญพรรณ เนติประเสริฐ", own: 24, total: 24 }),
    L({ teacher_id: 3, name: "นายรัฐชานนท์ กรุ่นทิพย์", own: 6, total: 26, department_id: 2 }),
    L({ teacher_id: 4, name: "นางกุลจิรา ยะศะนพ", own: 18, total: 18 }),
    L({ teacher_id: 5, name: "นายว่าง", own: 0, total: 0 }),
  ];
  const before = JSON.stringify(loads);
  const bars = loadBars(loads, "own");
  eq(JSON.stringify(loads), before);
  eq(bars.map((b) => b.teacherId), [2, 4, 1, 3, 5]);
  eq(bars[0], { teacherId: 2, name: "นางเพ็ญพรรณ เนติประเสริฐ", value: 24, total: 24, pct: 100, warn: true, more: null });
  eq(bars[1].pct, 75);
  eq(bars[1].warn, false);
  // ครูที่สอนข้ามกลุ่ม: แถบของกลุ่มนี้สั้น แต่ยอดรวมทั้งรอบเกินค่ามากสุดของกลุ่ม → เตือน และบอกยอดรวม
  eq([bars[3].value, bars[3].pct, bars[3].warn, bars[3].more], [6, 25, true, 26]);
  eq([bars[4].value, bars[4].pct, bars[4].warn], [0, 0, false]);
  // admin: ยอดรวมทั้งรอบ (own = total) · กรองเฉพาะครูที่เกี่ยวกับกลุ่ม
  const admin = loadBars(loads.map((l) => ({ ...l, own: l.total })), "total", (l) => l.department_id === 1);
  eq(admin.map((b) => [b.teacherId, b.value, b.more]), [[2, 24, null], [4, 18, null], [1, 18, null], [5, 0, null]]);
  eq(loadBars([L({ own: 0, total: 0 })], "own")[0].warn, false);
  eq(loadBars([], "own"), []);
});

test("headRound: รอบที่เปิดให้กรอก · ไม่มี → รอบที่ปิดล่าสุด (อ่านอย่างเดียว) · ไม่มีรอบ → null", () => {
  const c1 = R({ id: 1, year: 2569, semester: 1, label: "1/2569", status: "closed" });
  const c2 = R({ id: 2, year: 2569, semester: 2, label: "2/2569", status: "closed" });
  const f3 = R({ id: 3, year: 2570, semester: 1, label: "1/2570", status: "filling" });
  eq(headRound([c1, f3, c2])?.id, 3);
  eq(headRound([c1, c2])?.id, 2);
  eq(headRound([c2, c1])?.id, 2);
  eq(headRound([]), null);
  // หัวหน้าไม่เห็นรอบที่กำลังเตรียม (เซิร์ฟเวอร์ไม่ส่ง) — ถ้าหลุดมาก็ไม่ใช้
  eq(headRound([R({ id: 4, status: "preparing" })]), null);
  eq(headRound([R({ id: 4, status: "preparing" }), c1])?.id, 1);
});

test("ค่าที่เลือกค้าง (I1): เลือกครูสอนร่วมเป็นครูผู้สอน → 400 → ยืนยันแถวที่เลือก → จอต้องแสดงครูที่เซิร์ฟเวอร์ยืนยัน ไม่ใช่ครูที่ค้าง", () => {
  // แถวจากเทอมก่อน: ครู A (4) ยังไม่ยืนยัน · ครูสอนร่วม B (5)
  const a = W({ teacher_id: 4, co_teacher_id: 5, confirmed: false });
  // หัวหน้าเลือก B เป็นครูผู้สอน → จอแสดง B ระหว่างบันทึก
  const held = holdPending(null, a, { teacher_id: 5 });
  eq(shownFields(a, held), { teacher_id: 5, is_double: false });
  // เซิร์ฟเวอร์ตอบ 400 (ครูผู้สอนกับครูสอนร่วมต้องเป็นคนละคน) แถวบนเซิร์ฟเวอร์ไม่เปลี่ยน → ค่าที่ค้างยังอยู่ (Review Focus 2)
  ok(settlePending(held, { ...a }) === held, "แถวไม่เปลี่ยน ค่าที่ค้างต้องอยู่ (ตัวเดิม)");
  eq(shownFields(a, settlePending(held, { ...a })), { teacher_id: 5, is_double: false });
  // "ยืนยันแถวที่เลือก": เซิร์ฟเวอร์ยืนยัน A → แถวเปลี่ยน → ค่าที่ค้างหมดอายุ จอแสดง A
  const confirmedA = { ...a, confirmed: true };
  eq(settlePending(held, confirmedA), null);
  eq(shownFields(confirmedA, settlePending(held, confirmedA)), { teacher_id: 4, is_double: false });
  // ค่าที่ค้างที่หมดอายุแล้วแต่ยังไม่ถูกล้างจาก state (เฟรมเดียวกับที่แถวใหม่มาถึง) ก็ต้องไม่ถูกแสดง
  eq(shownFields(confirmedA, held), { teacher_id: 4, is_double: false });
  // "ใส่ครูให้แถวที่เลือก": เซิร์ฟเวอร์ใส่ X (6) → จอแสดง X
  const assignedX = { ...a, teacher_id: 6, confirmed: true };
  eq(settlePending(held, assignedX), null);
  eq(shownFields(assignedX, settlePending(held, assignedX)), { teacher_id: 6, is_double: false });
});

test("ค่าที่เลือกค้าง: หมดอายุทีละช่อง — ครูเมื่อครู/สถานะยืนยันบนเซิร์ฟเวอร์เปลี่ยน · คาบคู่เมื่อคาบคู่เปลี่ยน · ช่องอื่นไม่กระทบ · บันทึกสำเร็จแล้วปล่อยเฉพาะช่องนั้น", () => {
  const r = W({ teacher_id: 4, co_teacher_id: null, confirmed: false, is_double: false });
  const held = holdPending(null, r, { teacher_id: 6 });
  eq(settlePending(held, { ...r, teacher_id: null }), null);
  eq(settlePending(held, { ...r, confirmed: true }), null);
  // ครูที่เป็นร่างไม่ผูกกับคาบคู่: ติ๊กคาบคู่ของแถวเดียวกันแล้วบันทึกสำเร็จ ร่างครูต้องยังอยู่ (C1 — ไม่งั้นร่างหายเงียบ ๆ)
  ok(settlePending(held, { ...r, is_double: true }) === held, "คาบคู่บนเซิร์ฟเวอร์เปลี่ยน ร่างครูต้องอยู่");
  const dbl = holdPending(null, r, { is_double: true });
  eq(settlePending(dbl, { ...r, is_double: true }), null);
  ok(settlePending(dbl, { ...r, teacher_id: 9, confirmed: true }) === dbl, "ครูเปลี่ยน คาบคู่ที่ค้างไม่ต้องหาย");
  // ค้างทั้งสองช่อง แล้วช่องหนึ่งหมดอายุ → เหลือช่องที่ยังใช้ได้
  const two = holdPending(held, r, { is_double: true });
  eq(settlePending(two, { ...r, is_double: true }), { values: { teacher_id: 6 }, base: two.base });
  eq(settlePending(two, { ...r, confirmed: true }), { values: { is_double: true }, base: two.base });
  // หมายเหตุ/ครูสอนร่วม/ห้องเปลี่ยน (เช่น หัวหน้าแก้ครูสอนร่วมเพื่อให้เลือกครูได้) — ไม่ได้ขัดกับครูที่ค้าง ลองบันทึกใหม่ได้
  ok(settlePending(held, { ...r, note: "x", co_teacher_id: 9, lab_room_id: 3 }) === held, "ช่องอื่นต้องไม่ทำให้ค่าที่ค้างหาย");
  // เพิ่มค่าค้างอีกช่อง: base เดิม (สถานะของแถวตอนเลือกครั้งแรก)
  const both = holdPending(held, r, { is_double: true });
  eq(both.values, { teacher_id: 6, is_double: true });
  eq(both.base, held.base);
  eq(shownFields(r, both), { teacher_id: 6, is_double: true });
  eq(releasePending(both, ["is_double"]), { values: { teacher_id: 6 }, base: held.base });
  eq(releasePending(both, ["teacher_id", "is_double"]), null);
  eq(releasePending(null, ["teacher_id"]), null);
  // ค่าที่ค้างที่หมดอายุแล้วไม่ถูกต่อยอด: แถวเปลี่ยนแล้วเลือกใหม่ = เริ่มจากแถวปัจจุบัน
  const moved = { ...r, teacher_id: 7, confirmed: true };
  eq(holdPending(held, moved, { is_double: true }), { values: { is_double: true }, base: { teacher_id: 7, confirmed: true, is_double: false } });
  eq(shownFields(r, null), { teacher_id: 4, is_double: false });
  eq(settlePending(null, r), null);
  // ล้างครู (null) เป็นค่าที่ค้างได้ ต้องแสดง null ไม่ใช่ตกไปใช้ครูเดิม
  eq(shownFields(r, holdPending(null, r, { teacher_id: null })), { teacher_id: null, is_double: false });
});

test("C1: เลือกครูในช่อง (ลูกศร/อักษร/เมาส์ = change) ไม่บันทึก — เป็นร่างจนกดบันทึกครู · คาบคู่บันทึกทันที", () => {
  // แถวจากเทอมก่อน: ครู 4 ยังไม่ยืนยัน
  const r = W({ teacher_id: 4, confirmed: false, from_plan: true, is_double: false });
  // ArrowDown สามครั้ง = change สามครั้ง → ไม่มีอะไรให้บันทึกเลยสักครั้ง ร่างเป็นครูคนสุดท้าย
  let p: ReturnType<typeof changeRow>["pending"] = null;
  for (const t of [5, 6, 7]) {
    const c = changeRow(p, r, { teacher_id: t });
    eq(c.save, null);
    p = c.pending;
  }
  eq(teacherDraft(r, p), { teacher_id: 7 });
  eq(shownFields(r, p), { teacher_id: 7, is_double: false });
  // แถวบนเซิร์ฟเวอร์ยังเป็นครู 4 ยังไม่ยืนยัน (ไม่มีคำขอ) — ป้าย "ยังไม่ยืนยัน" ยังอยู่
  eq(rowState(r), "unconfirmed");
  // ไม่มีค่าไหนของช่องครูที่ทำให้บันทึกตอน change — ทุกครู · ล้างครู · ครูเดิม
  for (const t of [null, 1, 4, 99]) eq(changeRow(p, r, { teacher_id: t }).save, null);
  // เลือกกลับมาที่ครูเดิม = ไม่มีร่าง (ยืนยันครูเดิมใช้ปุ่มยืนยัน)
  eq(changeRow(p, r, { teacher_id: 4 }).pending, null);
  eq(teacherDraft(r, changeRow(p, r, { teacher_id: 4 }).pending), null);
  // ล้างครูเป็นร่างได้ (null ไม่ใช่ "ไม่มีร่าง")
  const cleared = changeRow(null, r, { teacher_id: null }).pending;
  eq(teacherDraft(r, cleared), { teacher_id: null });
  eq(shownFields(r, cleared).teacher_id, null);
  // คาบคู่: บันทึกทันที (ไม่แตะการยืนยัน) ค้างไว้ระหว่างบันทึก · ร่างครูไม่ติดไปกับการบันทึกคาบคู่
  const d = changeRow(p, r, { is_double: true });
  eq(d.save, { is_double: true });
  eq(teacherDraft(r, d.pending), { teacher_id: 7 });
  eq(shownFields(r, d.pending), { teacher_id: 7, is_double: true });
  // บันทึกคาบคู่สำเร็จ: เซิร์ฟเวอร์ตอบแถวที่คาบคู่เปลี่ยน → ร่างครูยังอยู่ (ยังไม่มีใครกดบันทึกครู)
  const after = releasePending(d.pending, ["is_double"]);
  const r2 = { ...r, is_double: true, from_plan: false };
  eq(teacherDraft(r2, after), { teacher_id: 7 });
  eq(shownFields(r2, after), { teacher_id: 7, is_double: true });
  // คาบคู่ถูกแก้จากอีกแท็บระหว่างมีร่างครู แล้วคนติ๊กคาบคู่อีกที: ค่าที่ติ๊กใหม่ผูกกับคาบคู่ปัจจุบันของแถว ไม่ใช่ของตอนเลือกครู
  const elsewhere = { ...r, is_double: true };
  const again = changeRow(p, elsewhere, { is_double: false });
  eq([again.save, shownFields(elsewhere, again.pending), teacherDraft(elsewhere, again.pending)],
    [{ is_double: false }, { teacher_id: 7, is_double: false }, { teacher_id: 7 }]);
  // ลองบันทึกอีกครั้ง (ช่องที่บันทึกทันทีที่ไม่สำเร็จ) ไม่รวมครูที่เป็นร่าง — ครูบันทึกด้วยปุ่มบันทึกครูเท่านั้น
  eq(retryFields(r, d.pending), { is_double: true });
  eq(retryFields(r, p), null);
  eq(retryFields(r, null), null);
});

test("C1: ร่างครูหมดอายุเมื่อแถวบนเซิร์ฟเวอร์เปลี่ยนจากทางอื่น (ยืนยัน/ใส่ครูทีละหลายแถว · อีกแท็บ) — จอแสดงค่าจริง", () => {
  const r = W({ teacher_id: 4, confirmed: false });
  const p = changeRow(null, r, { teacher_id: 6 }).pending;
  eq(teacherDraft({ ...r, confirmed: true }, p), null);
  eq(shownFields({ ...r, confirmed: true }, p).teacher_id, 4);
  eq(teacherDraft({ ...r, teacher_id: 8, confirmed: true }, p), null);
  // หมายเหตุ/ครูสอนร่วมเปลี่ยน ร่างยังอยู่
  eq(teacherDraft({ ...r, note: "x", co_teacher_id: 3 }, p), { teacher_id: 6 });
  // แถวที่ยังไม่มีครู: เลือกครู = ร่าง
  const empty = W({ teacher_id: null, confirmed: false, from_plan: false });
  const e = changeRow(null, empty, { teacher_id: 5 });
  eq([e.save, teacherDraft(empty, e.pending)], [null, { teacher_id: 5 }]);
  eq(changeRow(e.pending, empty, { teacher_id: null }).pending, null);
});

test("reviewGap: กลุ่มที่ส่งแล้ว/ตรวจผ่านแต่รายการไม่ครบ — ข้อความเดียวกับ 409 ของ wl_approve_blocker", () => {
  eq(reviewGap(D({ status: "submitted", rows: 12, confirmed: 12, missing_teacher: 0 })), null);
  eq(reviewGap(D({ status: "submitted", rows: 12, confirmed: 6, missing_teacher: 6 })),
    "ตรวจผ่านไม่ได้ — ตั้งแต่กลุ่มส่งมา มีรายการที่ยังไม่มีครู 6 รายการ ตีกลับให้กลุ่มกรอกก่อน");
  eq(reviewGap(D({ status: "submitted", rows: 12, confirmed: 10, missing_teacher: 1 })),
    "ตรวจผ่านไม่ได้ — ตั้งแต่กลุ่มส่งมา มีรายการที่ยังไม่มีครู 1 รายการ · ยังไม่ยืนยัน 1 รายการ ตีกลับให้กลุ่มกรอกก่อน");
  const ap = reviewGap(D({ status: "approved", rows: 12, confirmed: 11, missing_teacher: 0 }));
  ok(ap !== null && ap.includes("ยังไม่ยืนยัน 1 รายการ") && ap.includes("ตีกลับ") && hasThai(ap), String(ap));
  // กำลังกรอก/ถูกตีกลับ: ไม่ใช่เรื่องของการตรวจ (หัวหน้ายังกรอกอยู่)
  eq(reviewGap(D({ status: "filling", rows: 12, confirmed: 0, missing_teacher: 3 })), null);
  eq(reviewGap(D({ status: "returned", rows: 12, confirmed: 0, missing_teacher: 3 })), null);
  // ข้อความชิ้นเดียวกับเซิร์ฟเวอร์
  const src = readFileSync(new URL("../../mock_api.py", import.meta.url), "utf8");
  const at = src.indexOf("def wl_approve_blocker(");
  ok(at >= 0, "หา wl_approve_blocker ใน mock_api.py ไม่เจอ");
  const body = src.slice(at, src.indexOf("\ndef ", at + 5));
  for (const piece of ["ตรวจผ่านไม่ได้ — ตั้งแต่กลุ่มส่งมา มีรายการที่", "ยังไม่มีครู {missing} รายการ", "ยังไม่ยืนยัน {unconfirmed} รายการ",
    "' · '", " ตีกลับให้กลุ่มกรอกก่อน"]) {
    ok(body.includes(piece), `wl_approve_blocker ไม่มี ${JSON.stringify(piece)} แล้ว — แก้ reviewGap ให้ตรง`);
  }
});

test("refreshDue: โหลดสถานะใหม่เมื่อกลับมาที่หน้าต่าง — ไม่ถี่กว่าทุก REFRESH_GAP_MS (focus กับ visibilitychange มาคู่กัน)", () => {
  ok(REFRESH_GAP_MS >= 1000 && REFRESH_GAP_MS <= 10000, String(REFRESH_GAP_MS));
  eq(refreshDue(null, 5), true);
  eq(refreshDue(1000, 1000 + REFRESH_GAP_MS - 1), false);
  eq(refreshDue(1000, 1000 + REFRESH_GAP_MS), true);
  // นาฬิกาถอยหลัง (เปลี่ยนเวลาเครื่อง) ไม่ค้างไม่โหลดตลอดไป
  eq(refreshDue(10_000_000, 5), true);
});

// ── ขั้นที่ 3: รอบที่ส่งเข้าโปรแกรมจัดตารางแล้ว ───────────────────────────────
// รูปจริงของ wl_round_view หลังส่ง (task-5-report แก้รอบ 2): exported_text คำนวณตอนอ่านตามว่าเทอมของรอบเปิดอยู่ไหม
const SENT_AT = "2026-11-17T03:00:00+00:00";
const REPORT = {
  requirements: 1220, activity_sets: [
    { name: "ชุมนุม ม.1", group_ids: [1, 2], group_names: ["ม.1/1", "ม.1/2"], weekly: 1, teacher_ids: [4], teacher_names: ["ครู ก"] },
    { name: "", group_ids: [3], group_names: ["ม.2/1"], weekly: 2, teacher_ids: [], teacher_names: [] },
  ],
};

test("roundExportChip: ป้ายรอบที่ส่งแล้วใช้ exported_text ของเซิร์ฟเวอร์ · เทอมถูกปิดไว้ = เตือน · ปิดภาคเรียนแล้ว = ปกติ · ยังไม่ส่ง = ไม่มีป้าย", () => {
  eq(roundExportChip(R()), null);
  eq(roundExportChip(R({ status: "closed", exported_at: null, exported_label: null, exported_text: null, export_report: null })), null);
  eq(roundExportChip(R({ status: "closed", exported_at: SENT_AT, exported_label: "2/2569",
    exported_text: "ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569", export_report: REPORT })),
    { tone: "ok", text: "ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569", state: "open" });
  eq(roundExportChip(R({ status: "closed", exported_at: SENT_AT, exported_label: "2/2569",
    exported_text: `ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569${EXPORT_PARKED_TEXT}`, export_report: REPORT })),
    { tone: "warn", text: "ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569 (ถูกปิดไว้ ปลดล็อกเทอมนั้นเพื่อใช้ต่อ)", state: "parked" });
  // รีวิวทั้งสาขา M1: เทอมของรอบถูกปิดตามปกติเพราะขึ้นเทอมที่ใหม่กว่า — โทนปกติ ไม่ชวนปลดล็อก (หน้ารอบไม่ขึ้น "ถ้าส่งผิด…")
  eq(roundExportChip(R({ status: "closed", exported_at: SENT_AT, exported_label: "2/2569",
    exported_text: `ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569${EXPORT_DONE_TEXT}`, export_report: REPORT })),
    { tone: "ok", text: "ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569 (ปิดภาคเรียนแล้ว)", state: "done" });
  // ไม่มี exported_text (ไม่ควรเกิด) ยังบอกว่าส่งแล้ว ไม่ปล่อยให้ดูเหมือนรอบปิดธรรมดา
  eq(roundExportChip(R({ status: "closed", exported_at: SENT_AT, exported_label: "2/2569" })),
    { tone: "ok", text: "ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569", state: "open" });
});

test("ข้อความรอบที่ส่งแล้วเป็นชิ้นเดียวกับ wl_round_export_text ของเซิร์ฟเวอร์", () => {
  const src = readFileSync(new URL("../../mock_api.py", import.meta.url), "utf8");
  const at = src.indexOf("def wl_round_export_text(");
  ok(at >= 0, "หา wl_round_export_text ใน mock_api.py ไม่เจอ");
  const body = src.slice(at, src.indexOf("\ndef ", at + 1));
  ok(body.includes('f"ส่งเข้าโปรแกรมแล้ว — เทอม '), "ข้อความหลัก");
  ok(body.includes("WL_EXPORT_SUFFIX[state]"), "ส่วนท้ายตามสถานะ");
  const at2 = src.indexOf("WL_EXPORT_SUFFIX: dict[str, str] = {");
  ok(at2 >= 0, "หา WL_EXPORT_SUFFIX ใน mock_api.py ไม่เจอ");
  const table = src.slice(at2, src.indexOf("}", at2) + 1);
  ok(table.includes(`"done": "${EXPORT_DONE_TEXT}"`), `ข้อความปิดภาคเรียนแล้ว: ${EXPORT_DONE_TEXT}`);
  ok(table.includes(`"parked": "${EXPORT_PARKED_TEXT}"`), `ข้อความเทอมถูกปิดไว้: ${EXPORT_PARKED_TEXT}`);
  ok(table.includes('"open": ""'), "เปิดอยู่ = ไม่มีส่วนท้าย");
});

test("exportActivityLines: ชุดกิจกรรมที่ต้องลงคาบเองจาก export_report · รูปเสีย/ไม่มี → ว่าง", () => {
  eq(exportActivityLines(REPORT), [
    "ชุมนุม ม.1 · ม.1/1, ม.1/2 · 1 คาบ/สัปดาห์ · ครู ก",
    "ชุดกิจกรรม · ม.2/1 · 2 คาบ/สัปดาห์ · ยังไม่มีครู",
  ]);
  for (const bad of [null, undefined, {}, { activity_sets: "x" }, { activity_sets: [null, 5] }, []]) eq(exportActivityLines(bad), []);
});

test("isRound: ช่องของขั้นที่ 3 — ถูกรูป/ไม่มี (เซิร์ฟเวอร์รุ่นก่อน) ผ่าน · ผิดรูปไม่ผ่าน", () => {
  ok(isRound(R({ status: "closed", exported_at: SENT_AT, exported_label: "2/2569",
    exported_text: "ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569", export_report: REPORT })), "รอบที่ส่งแล้ว");
  ok(isRound(R({ exported_at: null, exported_label: null, exported_text: null, export_report: null })), "ยังไม่ส่ง");
  ok(isRound(R()), "ไม่มีช่องเลย");
  const bad: unknown[] = [
    R({ exported_at: 5 as unknown as string }), R({ exported_label: 2569 as unknown as string }),
    R({ exported_text: true as unknown as string }), R({ export_report: "x" as unknown as Record<string, unknown> }),
    R({ export_report: [] as unknown as Record<string, unknown> }),
  ];
  bad.forEach((b, i) => ok(!isRound(b), `ตัวที่ ${i} ควรไม่ผ่าน`));
});

test("รอบที่ส่งแล้ว (สถานะปิด) ไม่มีปุ่มแก้: ปุ่มของรอบ ตรวจ/ตีกลับ และการแก้แถวของ admin ปิดหมด", () => {
  eq(roundActions("closed"), { open: false, cancel: false, close: false, review: false });
  for (const s of ["filling", "submitted", "returned", "approved"] as const) eq(reviewActions("closed", s), { approve: false, return: false });
  eq(editState("admin", "closed", "approved").can, false);
});

// ── ทาง ข.: เปิดรอบให้แก้กลางเทอม · ชิป "แก้กลางเทอม" · ประวัติการอัปเดตกลางเทอม ─────────────────────
const AMEND_AT = "2026-11-18T06:39:37.257472+00:00";

test("isRound: amending_since ไม่มี (เซิร์ฟเวอร์รุ่นก่อน)/ว่าง/เวลา ผ่าน · ผิดรูปไม่ผ่าน", () => {
  ok(isRound(R({ amending_since: AMEND_AT })), "กำลังแก้กลางเทอม");
  ok(isRound(R({ amending_since: null })), "ไม่ได้แก้");
  ok(isRound(R()), "ไม่มีช่อง");
  ok(!isRound(R({ amending_since: 5 as unknown as string })), "ตัวเลข");
});

test("amendChip: อ่านจาก amending_since ของรอบ (คำตัดสินผู้คุมข้อ 5) · ปิดรอบ/อัปเดตแล้วเป็นว่าง = ไม่มีป้าย", () => {
  eq(AMEND_CHIP_TEXT, "แก้กลางเทอม — ยังไม่ส่ง");
  eq(amendChip(R({ amending_since: AMEND_AT })), { tone: "warn", text: "แก้กลางเทอม — ยังไม่ส่ง" });
  eq(amendChip(R({ amending_since: null })), null);
  eq(amendChip(R()), null);
  eq(amendChip(R({ status: "closed", amending_since: null, exported_at: SENT_AT })), null);
});

test("roundChip: รอบที่เปิดให้แก้กลางเทอมบอกบนแถบบน (หัวหน้ากลุ่มเห็นด้วย) · รอบปกติเหมือนเดิม", () => {
  eq(roundChip([R({ amending_since: AMEND_AT })]), { tone: "warn", text: "ภาคเรียน 2/2569 · แก้กลางเทอม" });
  eq(roundChip([R()]), { tone: "info", text: "ภาคเรียน 2/2569 · เปิดให้กรอก" });
});

test("amendAction: ปุ่มเปิดให้แก้กลางเทอมขึ้นเฉพาะรอบที่ปิดแล้วที่เซิร์ฟเวอร์อาจยอม · มีรอบอื่นที่ยังไม่ปิด = บอกเหตุแทนปุ่ม", () => {
  const closed = R({ id: 1, status: "closed", closed_at: "2026-11-17T03:00:00+00:00" });
  eq(amendAction(closed, [closed]), { show: true, blocker: null });
  for (const s of ["preparing", "filling"] as const) eq(amendAction(R({ status: s }), [R({ status: s })]).show, false);
  // ส่งแล้วและเทอมของรอบเปิดอยู่ = ได้ · ปิดภาคเรียนแล้ว/ถูกปิดไว้ = ไม่ใช่ภาคเรียนที่เปิดอยู่ (เซิร์ฟเวอร์ตอบ 409 แน่) จึงไม่ขึ้นปุ่ม
  const sent = (suffix: string) => R({ id: 1, status: "closed", exported_at: SENT_AT, exported_label: "2/2569",
    exported_text: `ส่งเข้าโปรแกรมแล้ว — เทอม 2/2569${suffix}` });
  eq(amendAction(sent(""), [sent("")]).show, true);
  eq(amendAction(sent(EXPORT_DONE_TEXT), [sent(EXPORT_DONE_TEXT)]).show, false);
  eq(amendAction(sent(EXPORT_PARKED_TEXT), [sent(EXPORT_PARKED_TEXT)]).show, false);
  // รอบที่ยังไม่ปิดมีได้ทีละรอบ (ดัชนี wl_rounds_one_open) — บอกชื่อรอบนั้นแทนปุ่มที่กดแล้วได้ 409
  const next = R({ id: 2, year: 2570, semester: 1, label: "1/2570", status: "preparing" });
  const blocked = amendAction(closed, [next, closed]);
  ok(blocked.show && (blocked.blocker ?? "").includes("1/2570") && (blocked.blocker ?? "").includes(AMEND_OTHER_OPEN),
     `ได้ ${JSON.stringify(blocked)}`);
  const src = readFileSync(new URL("../../mock_api.py", import.meta.url), "utf8");
  const at = src.indexOf("def wl_rounds_amend(");
  ok(at >= 0, "หา wl_rounds_amend ใน mock_api.py ไม่เจอ");
  ok(src.slice(at, src.indexOf("\ndef ", at + 1)).includes(AMEND_OTHER_OPEN), "ชิ้นข้อความเดียวกับ 409 ของเซิร์ฟเวอร์");
});

test("amendNotes: กล่องยืนยันบอกสิ่งที่จะเกิด · รอบที่ส่งแล้วบอกว่าส่งซ้ำไม่ได้", () => {
  const plain = amendNotes(R({ status: "closed" }));
  ok(plain.length >= 3 && plain.every(hasThai), "เป็นไทยหลายบรรทัด");
  ok(plain.some((l) => l.includes("เปิดให้กรอก")) && plain.some((l) => l.includes("อัปเดตแผนจากรอบอัตรากำลัง")), "บอกทางต่อ");
  ok(!plain.some((l) => l.includes("ส่งซ้ำ")), "รอบที่ไม่เคยส่งไม่พูดเรื่องส่งซ้ำ");
  ok(amendNotes(R({ status: "closed", exported_at: SENT_AT, exported_label: "2/2569" })).some((l) => l.includes("ส่งซ้ำไม่ได้")),
     "รอบที่ส่งแล้ว");
});

// รูปแถวของ wl_plan_updates ที่ GET /rounds/{id}/plan-updates คืน (accepted/rejected = [{key, pile, label(, auto)}] ของ Task 4)
const PU = (p: Partial<PlanUpdate> = {}): PlanUpdate => ({
  id: 3, round_id: 1, term_id: null, year: 2569, semester: 2, at: "2026-11-18T07:00:00+00:00", by: "ผู้ดูแลระบบ",
  accepted: [{ key: "registry:teacher:144", pile: "registry", label: "สร้างครู ครูใหม่", auto: true },
             { key: "teacher:2:20:197", pile: "teacher", label: "ม.1/2 ค21102: ครู ก → ครูใหม่", auto: false },
             { key: "weekly:1:184:1056", pile: "weekly", label: "ม.1/1 CH21204: คาบ 2 → 3", auto: false }],
  rejected: [{ key: "sets:edit:1", pile: "sets", label: "คาบเสรี “ม.4/6”" }],
  report: { token: "x", todos: 2, round_closed: true, writeback: {} }, ...p,
});

test("isPlanUpdate: รูปแถวประวัติ · ผิดรูปไม่ผ่าน", () => {
  ok(isPlanUpdate(PU()), "ถูกรูป");
  ok(isPlanUpdate(PU({ term_id: 9, report: null })), "มีเทอม · ไม่มีรายงาน");
  const bad: unknown[] = [PU({ id: "3" as unknown as number }), PU({ at: null as unknown as string }),
    PU({ accepted: "x" as unknown as PlanUpdate["accepted"] }), PU({ rejected: [{ key: 1 }] as unknown as PlanUpdate["rejected"] }),
    PU({ by: 5 as unknown as string }), null, []];
  bad.forEach((b, i) => ok(!isPlanUpdate(b), `ตัวที่ ${i} ควรไม่ผ่าน`));
});

test("planUpdateLine/Items: ยอมรับ/ไม่ยอมรับกี่ข้อ · ข้อที่ระบบติ๊กให้ · รายการงาน · รอบกลับเป็นปิด", () => {
  eq(planUpdateLine(PU()), "ยอมรับ 3 ข้อ (ระบบติ๊กข้อทะเบียนให้ 1 ข้อ) · ไม่ยอมรับ 1 ข้อ · รายการงานใหม่ 2 ข้อ · รอบกลับเป็นปิด");
  eq(planUpdateLine(PU({ accepted: [], rejected: [], report: null })), "ยอมรับ 0 ข้อ · ไม่ยอมรับ 0 ข้อ");
  eq(planUpdateItems(PU()), {
    accepted: ["สร้างครู ครูใหม่ (ระบบติ๊กให้)", "ม.1/2 ค21102: ครู ก → ครูใหม่", "ม.1/1 CH21204: คาบ 2 → 3"],
    rejected: ["คาบเสรี “ม.4/6”"],
  });
});

if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  process.exit(1);
}
console.log("ALL PASS");
