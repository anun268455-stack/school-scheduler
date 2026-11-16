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
  checkCloseLabel, checkReturnNote, checkRoundForm, closedRounds, currentRound, defaultOpenTerm, DEPT_STATUS_TEXT, deptProgress,
  deptStatusLabel, deptStatusTone, isDeptStatus, isOptionTeacher, isRound, isRoundDetail, isRoundOption, isRoundPreview,
  isRoundRow, isTeacherLoad, openBlocker, previewLines, previewWarnings, reviewActions, roundActions, roundChip,
  roundLabel, roundStats, ROUND_STATUS_TEXT, roundStatusTone, termReadiness,
  type DeptStatus, type Round, type RoundPreview,
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

if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  process.exit(1);
}
console.log("ALL PASS");
