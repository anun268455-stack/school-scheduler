/**
 * ทดสอบ utils/terms — ภาคเรียนฝั่งหน้าเว็บ
 *
 * ข้อที่สำคัญที่สุดคือ shouldPoll: ซิงค์สดต้องหยุดตอนดูเทอมที่ปิด ไม่งั้นมันจะ
 * ดึงเทอมปัจจุบันมาทับของเก่าที่เปิดดูอยู่ แล้วจอเด้งกลับโดยไม่มีอะไรฟ้อง
 */
import {
  activeTerm, blocksLiveWrite, canEdit, createLanding, dropLiveData, LIVE_DATA_KEYS, nextTerm, shouldPoll, sortTerms, termBanner, termLabel,
  writeAllowedWhileViewing, type TermMeta,
} from "../../frontend/src/utils/terms.ts";
import {
  canRetryCreate, createLatch, createOutcome, departmentMatrix, formatBytes, newTermFormError,
  newTermWarning, previewRows, statsLines, TERMS_UNAVAILABLE, termDownloadName, termErrorText,
  termStatusText, unlockConfirmed, unlockNotice, lastEditText,
  bannerView, FROZEN_CHIP_NOTE, isReadOnly, printTermName, termFieldsLocked,
} from "../../frontend/src/utils/terms.ts";
import {
  activitySetLines, createLockedText, defaultTermRound, newTermFromRoundError, roundCreatedNote, roundOptionLabel,
  roundPreviewRows, roundSelectable, roundsLoadNote, runningTerm, type RoundPreview, type RoundReport, type TermRound,
} from "../../frontend/src/utils/terms.ts";
import {
  blockedReason, gateRequest, setWriteBlock, WriteBlocked,
} from "../../frontend/src/api/writeGate.ts";
import { readFileSync } from "node:fs";

let n = 0;
const ok = (cond: boolean, what: string): void => {
  n++;
  if (!cond) { console.error("FAIL:", what); process.exit(1); }
};
const eq = (a: unknown, b: unknown, what: string): void =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${what} — ได้ ${JSON.stringify(a)}`);

const ACTIVE: TermMeta = { id: 4, year: 2569, semester: 1, label: "1/2569",
  status: "active", slots: 2735, opened_at: null, closed_at: null, bytes: 0 };
const CLOSED: TermMeta = { id: 3, year: 2568, semester: 2, label: "2/2568",
  status: "closed", slots: 2680, opened_at: null, closed_at: null, bytes: 0 };
const OLDER: TermMeta = { ...CLOSED, id: 2, semester: 1, label: "1/2568" };

eq(termLabel(2569, 1), "1/2569", "ป้ายเทอม");

eq(sortTerms([CLOSED, ACTIVE])[0].id, 4, "ใหม่สุดก่อน");
eq(sortTerms([ACTIVE, CLOSED]).map((t) => t.id).join(","), "4,3", "ลำดับไม่ขึ้นกับอินพุต");
eq(sortTerms([OLDER, ACTIVE, CLOSED]).map((t) => t.id), [4, 3, 2], "ปีเดียวกันเรียงตามภาคเรียน");
const input = [CLOSED, ACTIVE];
sortTerms(input);
eq(input.map((t) => t.id), [3, 4], "ไม่แก้อาร์เรย์ที่รับมา");
eq(sortTerms([]), [], "ว่างก็ว่าง");

eq(activeTerm([CLOSED, ACTIVE])?.id, 4, "หาเทอมที่ใช้งาน");
eq(activeTerm([CLOSED]), undefined, "ไม่มีเทอมที่ใช้งาน");
eq(activeTerm([]), undefined, "ไม่มีเทอมเลย");

// ยังไม่มีระบบเทอมเลย ต้องแก้ได้เหมือนเดิมทุกอย่าง
eq(canEdit(null, null), true, "ไม่มีระบบเทอม");
eq(canEdit(null, ACTIVE), true, "ดูเทอมที่ใช้งานอยู่ (viewing เป็น null)");
eq(canEdit(ACTIVE, ACTIVE), true, "เทอมที่ใช้งาน");
eq(canEdit(CLOSED, ACTIVE), false, "เทอมที่ปิด");
eq(canEdit(CLOSED, null), false, "เทอมที่ปิดและไม่มีเทอมใช้งาน");
eq(canEdit(ACTIVE, CLOSED), false, "id ไม่ตรงกับเทอมที่ใช้งาน");

// ซิงค์สดต้องหยุดตอนดูเทอมที่ปิด
eq(shouldPoll(true, "ready"), false, "ดูเทอมที่ปิด");
eq(shouldPoll(false, "ready"), true, "ปกติ");
eq(shouldPoll(true, "loading"), false, "ดูเทอมที่ปิดและกำลังโหลด");
eq(shouldPoll(false, "loading"), false, "ข้อมูลยังไม่พร้อม");
eq(shouldPoll(false, "unreachable"), false, "เซิร์ฟเวอร์ไม่ตอบ");

ok(termBanner(CLOSED, ACTIVE)?.includes("2/2568") === true, "แบนเนอร์มีป้ายเทอม");
ok(termBanner(CLOSED, ACTIVE)?.includes("ปิดแล้ว") === true, "แบนเนอร์บอกว่าปิดแล้ว");
eq(termBanner(CLOSED, ACTIVE), "เทอม 2/2568 · ปิดแล้ว ดูและปริ้นได้เท่านั้น", "ข้อความแบนเนอร์ตรงตัว");
eq(termBanner(ACTIVE, ACTIVE), null, "เทอมที่ใช้งานไม่มีแบนเนอร์");
eq(termBanner(null, null), null, "ไม่มีระบบเทอมไม่มีแบนเนอร์");

eq(nextTerm(ACTIVE), { year: 2569, semester: 2 }, "ภาค 1 → ภาค 2 ปีเดิม");
eq(nextTerm(CLOSED), { year: 2569, semester: 1 }, "ภาค 2 → ภาค 1 ปีถัดไป");
eq(nextTerm(null), { year: 0, semester: 1 }, "ไม่มีเทอมเลย");

// ── กฎข้อเดียว: ดูเทอมที่ปิด ข้อมูลสดห้ามลงร้าน ─────────────────────────────
const landed = { slots: [1], teachers: [2], parked: [3], isLoading: false, dataState: "ready" };
eq(dropLiveData(landed, true), { isLoading: false, dataState: "ready" },
   "ตอนดูเทอมที่ปิด ตัดข้อมูลสดออก เหลือสถานะอื่น");
eq(dropLiveData(landed, false), landed, "ปกติผ่านทั้งหมด");
eq(dropLiveData({ viewingTerm: null }, true), { viewingTerm: null }, "ฟิลด์ที่ไม่ใช่ข้อมูลสดผ่าน");
eq(dropLiveData({}, true), {}, "ว่างก็ว่าง");
const orig = { slots: [1], x: 1 };
dropLiveData(orig, true);
eq(orig, { slots: [1], x: 1 }, "ไม่แก้ของที่รับมา");
for (const k of ["groups", "teachers", "subjects", "rooms", "requirements", "slots", "periods",
                 "departments", "buildings"]) {
  ok((LIVE_DATA_KEYS as readonly string[]).includes(k), `${k} อยู่ในชุดข้อมูลสด (ชุดที่ openTerm วาง)`);
}

ok((LIVE_DATA_KEYS as readonly string[]).includes("schoolConfig"),
   "schoolConfig อยู่ในชุดข้อมูลสด (ใบพิมพ์เทอมเก่าต้องไม่ได้ชื่อ ผอ. ปัจจุบัน)");
for (const k of ["parked", "yardPicks", "yardList"]) {
  ok((LIVE_DATA_KEYS as readonly string[]).includes(k), `${k} อยู่ในชุดข้อมูลสด`);
}
let told: string[] = [];
dropLiveData({ slots: [], schoolConfig: {}, isLoading: false }, true, (k) => { told = k; });
eq(told, ["slots", "schoolConfig"], "onDrop บอกชื่อฟิลด์ที่ถูกตัด");
told = [];
dropLiveData({ isLoading: false }, true, (k) => { told = k; });
eq(told, [], "ไม่มีอะไรถูกตัด ไม่เรียก onDrop");
dropLiveData({ slots: [] }, false, (k) => { told = k; });
eq(told, [], "ไม่ได้กัน ไม่เรียก onDrop");

// ── ตั๋วเขียนข้อมูล: ซ้อนกันต้องไม่ล้างของกัน ─────────────────────────────────
{
  const L = createLanding();
  eq(L.held(), 0, "เริ่มต้นไม่มีตั๋ว");
  eq(blocksLiveWrite(CLOSED, L), true, "ดูเทอมปิดและไม่มีตั๋ว = กัน");
  eq(blocksLiveWrite(ACTIVE, L), false, "ดูเทอมที่ใช้งาน = ไม่กัน");
  eq(blocksLiveWrite(null, L), false, "ไม่มีระบบเทอม = ไม่กัน");
  const a = L.enter();
  eq(blocksLiveWrite(CLOSED, L), false, "มีตั๋วหนึ่งใบ = ผ่าน");
  const b = L.enter();
  ok(a !== b, "ตั๋วไม่ซ้ำกัน");
  L.leave(a);
  eq(blocksLiveWrite(CLOSED, L), false, "enter/enter/leave ยังต้องผ่านอยู่ (ตั๋วของ b)");
  eq(L.held(), 1, "เหลือหนึ่งใบ");
  eq(L.leave(a), false, "คืนตั๋วซ้ำไม่ได้");
  eq(L.leave(9999), false, "คนที่ไม่ใช่เจ้าของคืนตั๋วไม่ได้");
  eq(blocksLiveWrite(CLOSED, L), false, "คืนผิดเจ้าของไม่ปลดกัน/ไม่ทำให้ผ่านน้อยลง");
  eq(L.leave(b), true, "เจ้าของคืนได้");
  eq(blocksLiveWrite(CLOSED, L), true, "คืนครบแล้วกันอีกครั้ง");
}
{
  const L = createLanding();
  const first = L.tryEnter();
  ok(first !== null, "tryEnter ครั้งแรกได้");
  eq(L.tryEnter(), null, "งานที่สองซ้อนไม่ได้ (กดกลับสองครั้ง / เปิดระหว่างกลับ)");
  eq(L.held(), 1, "ครั้งที่ปฏิเสธไม่เพิ่มตั๋ว");
  L.leave(first as number);
  ok(L.tryEnter() !== null, "คืนแล้วเริ่มงานใหม่ได้");
}

// ── ด่านขาออกตอนดูเทอมที่ปิด ─────────────────────────────────────────────────
eq(writeAllowedWhileViewing("PUT", "/school/config"), false, "บันทึกค่าตั้งโรงเรียนถูกกัน (ไม่มียกเว้น)");
eq(writeAllowedWhileViewing("GET", "/school/config"), true, "อ่านค่าตั้งโรงเรียนผ่าน");
eq(writeAllowedWhileViewing("POST", "/terms"), true, "สร้างเทอมผ่าน");
eq(writeAllowedWhileViewing("POST", "/terms/3/unlock"), true, "ปลดล็อกผ่าน");
eq(writeAllowedWhileViewing("GET", "/timetable/slots"), true, "อ่านผ่าน");
eq(writeAllowedWhileViewing("head", "/timetable/slots"), true, "HEAD ผ่าน");
eq(writeAllowedWhileViewing("PUT", "/timetable/slots/12"), false, "แก้คาบถูกกัน");
eq(writeAllowedWhileViewing("PATCH", "/timetable/slots/12"), false, "PATCH คาบถูกกัน");
eq(writeAllowedWhileViewing("DELETE", "/timetable/slots/12"), false, "ลบคาบถูกกัน");
eq(writeAllowedWhileViewing("POST", "/timetable/slots"), false, "เพิ่มคาบถูกกัน");
eq(writeAllowedWhileViewing("POST", "/timetable/solve"), false, "สร้างตารางถูกกัน");
eq(writeAllowedWhileViewing("POST", "/timetable/teacher-plan"), false, "POST ที่วิเคราะห์อย่างเดียวถูกกัน (ข้อจำกัดที่รู้)");
eq(writeAllowedWhileViewing("POST", "/sub/absences"), false, "สอนแทน: บันทึกการลาถูกกัน");
eq(writeAllowedWhileViewing("POST", "/sub/substitutions"), false, "สอนแทน: บันทึกการสอนแทนถูกกัน");
eq(writeAllowedWhileViewing("DELETE", "/sub/absences/5"), false, "สอนแทน: ลบถูกกัน");
eq(writeAllowedWhileViewing("POST", "/termsx"), false, "/termsx ไม่ใช่เส้นเทอม");
eq(writeAllowedWhileViewing("POST", "/terms?x=1"), true, "query string ไม่ทำให้พลาด");

// ── ด่านตัวจริง (ไม่มี axios): ใช้ร่วมกันทั้งสอง instance และข้อความต้องถึงผู้ใช้ ──
const BLOCK_MSG = "กำลังดูเทอมที่ปิดแล้ว แก้ไขไม่ได้ กลับไปเทอมปัจจุบันก่อน";
{
  setWriteBlock(() => BLOCK_MSG);
  const refused = async (cfg: { method?: string; url?: string }): Promise<unknown> => {
    try { await gateRequest(cfg); return null; } catch (e) { return e; }
  };
  const e1 = await refused({ method: "patch", url: "/timetable/slots/12" });
  ok(e1 instanceof WriteBlocked, "แก้คาบถูกปฏิเสธด้วย WriteBlocked");
  eq(blockedReason(e1), BLOCK_MSG, "เหตุผลที่ผู้ใช้เห็นคือข้อความของด่าน");
  // ผู้เรียกที่ใช้ข้อความสำรอง ต้องได้ข้อความของด่านก่อน ไม่ใช่ "ช่องนั้นไม่ว่าง"
  eq(blockedReason(e1) ?? "ย้ายไม่ได้ — ช่องนั้นไม่ว่าง", BLOCK_MSG, "ไม่ใช่ข้อความสำรองของผู้เรียก");
  eq(blockedReason(new Error("x")), null, "error อื่นไม่ถูกแปลง");
  eq(blockedReason({ response: { data: { detail: "x" } } }), null, "error จากเซิร์ฟเวอร์ไม่ถูกแปลง");
  ok((await refused({ method: "post", url: "/sub/absences" })) instanceof WriteBlocked,
     "สอนแทน (instance ที่สอง) ถูกปฏิเสธด้วยด่านเดียวกัน");
  ok((await refused({ method: "put", url: "/school/config" })) instanceof WriteBlocked,
     "บันทึกค่าตั้งโรงเรียนถูกปฏิเสธ");
  eq(await refused({ method: "get", url: "/timetable/slots" }), null, "อ่านผ่าน");
  eq(await refused({ method: "post", url: "/terms/3/unlock" }), null, "เส้นเทอมผ่าน");
  setWriteBlock(() => null);
  eq(await refused({ method: "patch", url: "/timetable/slots/12" }), null, "ไม่ได้ดูเทอมปิด = ผ่านทุกอย่าง");
  setWriteBlock(null);
  eq(await refused({ method: "patch", url: "/timetable/slots/12" }), null, "ยังไม่ติดตัวตัดสิน = ผ่าน");
}

// ── Task 8: หน้ารายการเทอม ──────────────────────────────────────────────────
eq(termStatusText("active"), "ใช้งานอยู่ · แก้ได้", "สถานะเทอมที่ใช้");
eq(termStatusText("closed"), "ปิดแล้ว · อ่านอย่างเดียว", "สถานะเทอมที่ปิด");
eq([formatBytes(0), formatBytes(900), formatBytes(2048), formatBytes(5 * 1024 * 1024 + 300000)],
   ["0 B", "900 B", "2 KB", "5.3 MB"], "ขนาดไฟล์");
eq(formatBytes(NaN), "–", "ขนาดที่อ่านไม่ได้ไม่ใช่ NaN");

// หน้าต่างปลดล็อกต้องบอกว่าปิดเทอมที่ใช้อยู่ไปด้วย พร้อมชื่อและจำนวนคาบ
{
  const text = unlockNotice(CLOSED, ACTIVE).join("\n");
  ok(text.includes("ปิดเทอมที่ใช้งานอยู่ตอนนี้"), "บอกว่าปิดเทอมที่ใช้อยู่ไปด้วย");
  ok(text.includes("1/2569"), "ชื่อเทอมที่จะถูกปิด");
  ok(text.includes("2735 คาบ"), "จำนวนคาบของเทอมที่จะถูกปิด");
  ok(text.includes("2/2568"), "ชื่อเทอมที่จะเปิด");
  ok(!text.includes("undefined") && !text.includes("null"), "ไม่มีคำว่า undefined/null");
  const noCount = unlockNotice(CLOSED, { ...ACTIVE, slots: null }).join("\n");
  ok(noCount.includes("1/2569") && !noCount.includes("null") && !noCount.includes("ลงคาบไว้"),
     "ไม่รู้จำนวนคาบ = ไม่พิมพ์ตัวเลขมั่ว");
  const noActive = unlockNotice(CLOSED, null).join("\n");
  ok(!noActive.includes("ปิดเทอมที่ใช้งานอยู่ตอนนี้"), "ไม่มีเทอมที่ใช้อยู่ = ไม่อ้างถึง");
}
eq(unlockConfirmed(CLOSED, "2/2568"), true, "พิมพ์ชื่อตรง");
eq(unlockConfirmed(CLOSED, "  2/2568 "), true, "ตัดช่องว่างหัวท้าย เหมือนเซิร์ฟเวอร์");
eq(unlockConfirmed(CLOSED, "2/68"), false, "ไม่ตรง");
eq(unlockConfirmed(CLOSED, ""), false, "ว่างไม่ผ่าน");

// ── สร้างเทอมใหม่ ──────────────────────────────────────────────────────────
{
  const l = createLatch();
  eq([l.take(), l.take(), l.take()], [true, false, false], "กลอนกดได้ครั้งเดียว");
  eq(l.taken(), true, "จำได้ว่ากดแล้ว");
  l.reset();
  eq(l.take(), true, "reset แล้วกดได้อีก");
}
eq(canRetryCreate({ response: { status: 409 } }), true, "409 = ไม่ได้ทำอะไร กดซ้ำได้");
eq(canRetryCreate({ response: { status: 400 } }), true, "400 กดซ้ำได้");
eq(canRetryCreate({ response: { status: 500 } }), false, "500 บอกไม่ได้ว่าสร้างไปหรือยัง");
eq(canRetryCreate({ response: { status: 503 } }), false, "503 ไม่ปลอดภัยพอ");
eq(canRetryCreate(new Error("timeout")), false, "ไม่มี response = ไม่รู้ผล ห้ามกดซ้ำ");
eq(termErrorText({ response: { status: 409, data: { detail: "มีเทอม 1/2569 อยู่แล้ว" } } }, "สำรอง"),
   "มีเทอม 1/2569 อยู่แล้ว", "ข้อความไทยจากเซิร์ฟเวอร์");
eq(termErrorText({ response: { status: 500, data: { detail: "boom" } } }, "สำรอง"), "สำรอง", "500 ใช้ข้อความสำรอง");
eq(termErrorText({ response: { status: 409, data: { detail: [{ loc: 1 }] } } }, "สำรอง"), "สำรอง",
   "detail ที่ไม่ใช่ข้อความ (422) ไม่ถูกพิมพ์");
eq(termErrorText(new Error("x"), "สำรอง"), "สำรอง", "error ธรรมดา");
eq(termErrorText(new Error("Request failed with status code 500"), "สำรอง"), "สำรอง", "ข้อความอังกฤษของ axios ไม่ถูกส่งต่อ");
eq(termErrorText(new Error("ปลดล็อกเทอมแล้ว แต่โหลดไม่สำเร็จ"), "สำรอง"), "ปลดล็อกเทอมแล้ว แต่โหลดไม่สำเร็จ",
   "Error ไทยที่ร้านโยนเองถึงผู้ใช้");
eq(termErrorText(new WriteBlocked("กำลังดูเทอมที่ปิด"), "สำรอง"), "กำลังดูเทอมที่ปิด", "ข้อความของด่าน");

// save_error: null ไม่ได้พิสูจน์ว่าบันทึกแล้ว
{
  const base = { closed: { label: "1/2569", slots: 2735 }, active: { label: "2/2569" },
                 save_error: null, save_pending: false };
  const clean = createOutcome(base);
  ok(!clean.text.includes("บันทึกแล้ว"), "ไม่ประกาศว่าบันทึกแล้ว แม้ save_error เป็น null");
  ok(clean.text.includes("ป้ายสถานะการบันทึก"), "ชี้ไปที่ป้ายสถานะ");
  ok(clean.text.includes("2/2569") && clean.text.includes("2735 คาบ"), "บอกเทอมที่สร้างและเทอมที่ปิด");
  const pending = createOutcome({ ...base, save_pending: true });
  eq(pending.tone, "warn", "pending = เตือน");
  ok(pending.text.includes("ระหว่างส่ง"), "บอกว่ายังไม่เสร็จ");
  ok(!pending.text.includes("บันทึกแล้ว"), "pending ไม่พูดว่าบันทึกแล้ว");
  const bad = createOutcome({ ...base, save_error: "ฐานข้อมูลปฏิเสธ" });
  eq(bad.tone, "error", "save_error = ผิดพลาด");
  ok(bad.text.includes("ฐานข้อมูลปฏิเสธ"), "แสดงเหตุผลของเซิร์ฟเวอร์");
  const first = createOutcome({ ...base, closed: null });
  ok(!first.text.includes("ถูกปิดแล้ว") && !first.text.includes("null"), "เทอมแรก ไม่มีเทอมที่ปิด");
}

eq(newTermFormError("2569", "2", [ACTIVE]), null, "ฟอร์มถูกต้อง");
ok(newTermFormError("", "1", []) !== null, "ปีว่างไม่ผ่าน");
ok(newTermFormError("25", "1", []) !== null, "ปีสั้นไม่ผ่าน");
ok(newTermFormError("2569.5", "1", []) !== null, "ปีทศนิยมไม่ผ่าน");
ok(newTermFormError("2569", "3", []) !== null, "ภาค 3 ไม่ผ่าน");
eq(newTermFormError("2569", "1", [ACTIVE]), "มีเทอม 1/2569 อยู่แล้ว", "เทอมซ้ำ");

{
  const w = newTermWarning(ACTIVE);
  ok(w.includes("1/2569") && w.includes("ถูกปิดและแก้ไม่ได้อีก") && w.includes("เริ่มจากว่าง"), "คำเตือนครบสามส่วน");
  ok(w.includes("เทอม 1/2569 จะถูกปิด"), `มีช่องว่างระหว่างชื่อเทอมกับคำถัดไป (รีวิวทั้งสาขา M11) — ได้ ${w}`);
  ok(!newTermWarning(null).includes("null"), "ไม่มีเทอมที่ใช้ ไม่พิมพ์ null");
}
{
  const rows = previewRows({ requirements: 812, teachers: 143, periods_total: 3900, curricula: 14, slots_to_clear: 2735 });
  eq(rows.map((r) => r.value), [812, 143, 3900, 14, 2735], "ตัวเลขตรงกับเซิร์ฟเวอร์");
  ok(rows.every((r) => r.label.length > 0), "ทุกแถวมีป้าย");
}
eq(termDownloadName({ label: "2/2568" }), "ตารางเรียน-เทอม-2-2568.json", "ชื่อไฟล์ไม่มี /");
ok(TERMS_UNAVAILABLE.includes("ฐานข้อมูล"), "ข้อความเมื่อไม่มีฐานข้อมูล");

// ── สถิติย้อนหลัง ───────────────────────────────────────────────────────────
{
  const row = (id: number, label: string, slots: number, extra: object = {}) => ({
    id, label, slots, by_department: { "คณิต": slots / 2, "ภาษาไทย": slots / 4 },
    by_teacher: { "ก": 5, "ข": 6 }, rooms_used: 30, subjects_open: 100, ...extra });
  // เซิร์ฟเวอร์ส่งเก่าไปใหม่ แต่ลำดับขาเข้าไม่ควรเป็นเงื่อนไข
  const lines = statsLines([row(4, "1/2569", 2735), row(2, "1/2568", 2600), row(3, "2/2568", 2680)],
                           [ACTIVE, CLOSED, OLDER]);
  eq(lines.map((l) => l.label), ["1/2568", "2/2568", "1/2569"], "เรียงตามเวลา");
  eq(lines.map((l) => l.slotsDelta), [null, 80, 55], "เปลี่ยนแปลงจากเทอมก่อน");
  eq(lines[0].teachers, 2, "นับครูที่มีคาบ");
  const withBad = statsLines([row(2, "1/2568", 2600), row(3, "2/2568", 0, { error: "อ่านข้อมูลของเทอมนี้ไม่ได้" }),
                              row(4, "1/2569", 2735)], [ACTIVE, CLOSED, OLDER]);
  eq(withBad[1].error, "อ่านข้อมูลของเทอมนี้ไม่ได้", "เทอมที่อ่านไม่ได้ขึ้นข้อความ");
  eq(withBad.map((l) => l.slotsDelta), [null, null, null],
     "ไม่คำนวณส่วนต่างข้ามเทอมที่อ่านไม่ได้ (ไม่แสดง +2735 ปลอม)");
  const m = departmentMatrix([row(2, "1/2568", 100), row(3, "2/2568", 200)], [OLDER, CLOSED]);
  eq(m.names, ["คณิต", "ภาษาไทย"], "ชื่อกลุ่มสาระ");
  eq(m.byTerm.map((t) => t.counts), [[50, 25], [100, 50]], "จำนวนคาบแต่ละกลุ่มสาระ");
  eq(statsLines([]), [], "ไม่มีเทอม");
  const mb = departmentMatrix([row(2, "1/2568", 100), row(3, "2/2568", 0, { error: "x" })], [OLDER, CLOSED]);
  eq(mb.byTerm.map((t) => t.bad), [false, true], "เทอมที่อ่านไม่ได้ถูกทำเครื่องหมาย (แสดง – ไม่ใช่ 0)");
}

eq(lastEditText({ status: "active", closed_at: null }), "กำลังใช้งาน", "เทอมที่ใช้อยู่");
eq(lastEditText({ status: "closed", closed_at: null }), "–", "ไม่รู้เวลาปิด");
eq(lastEditText({ status: "closed", closed_at: "ไม่ใช่วันที่" }), "ไม่ใช่วันที่", "วันที่อ่านไม่ออกไม่ล้ม");
ok(lastEditText({ status: "closed", closed_at: "2026-10-01T09:30:00Z" }).length > 3, "เวลาปิดที่ถูกต้อง");

{
  const u = createOutcome({ closed: { label: "1/2569", slots: 2735 }, active: { label: "2/2568" } }, "ปลดล็อก");
  ok(u.text.startsWith("ปลดล็อกเทอม 2/2568 แล้ว") && u.text.includes("ปิดแล้ว (2735 คาบ)"), "ผลของการปลดล็อก");
  ok(!u.text.includes("undefined") && !u.text.includes("บันทึกแล้ว"), "ไม่มี undefined และไม่ประกาศว่าบันทึกแล้ว");
}

// ── Task 9: อ่านอย่างเดียว · แถบ · ชื่อเทอมบนใบพิมพ์ ───────────────────────
eq(isReadOnly(null, [ACTIVE, CLOSED]), false, "ไม่ได้เปิดเทอมเก่า = แก้ได้");
eq(isReadOnly(null, []), false, "ยังไม่มีระบบเทอม = แก้ได้");
eq(isReadOnly(CLOSED, [ACTIVE, CLOSED]), true, "เปิดเทอมที่ปิด = อ่านอย่างเดียว");
eq(isReadOnly(ACTIVE, [ACTIVE, CLOSED]), false, "ดูเทอมที่ใช้งาน = แก้ได้");
eq(isReadOnly(CLOSED, [CLOSED]), true, "เทอมที่ปิด และไม่มีเทอมที่ใช้งานเลย = อ่านอย่างเดียว");

// ข้อทดสอบ 17: ใบพิมพ์ขึ้นชื่อเทอมที่ดูอยู่ ไม่ใช่เทอมที่ใช้งาน
eq(printTermName(CLOSED, [ACTIVE, CLOSED]), "2/2568", "ดูเทอมเก่า = ชื่อเทอมเก่า");
eq(printTermName(null, [ACTIVE, CLOSED]), "1/2569", "ไม่ได้ดูเทอมเก่า = เทอมที่ใช้งาน");
eq(printTermName(null, []), undefined, "ไม่มีเทอมเลย = undefined");
eq(printTermName(CLOSED, []), "2/2568", "ชื่อมาจากเทอมที่ดู แม้รายการเทอมยังไม่โหลด");
eq(printTermName({ ...CLOSED, label: "  " }, [ACTIVE]), undefined,
   "เทอมที่ดูไม่มีชื่อ = ไม่พิมพ์ชื่อ ห้ามใช้ชื่อเทอมที่ใช้งานแทน (ข้อ 17)");
eq(printTermName({ ...CLOSED, label: "" }, [ACTIVE, CLOSED]), undefined, "ชื่อว่างจริง ๆ ก็เช่นกัน");

eq(termFieldsLocked(true, [ACTIVE]), true, "มีเทอมแล้ว = ช่องภาคเรียน/ปีแก้ไม่ได้");
eq(termFieldsLocked(true, []), false, "ยังไม่เคยสร้างเทอม = ยังแก้ได้");
eq(termFieldsLocked(false, [ACTIVE]), false, "ไม่มีฐานข้อมูล = เซิร์ฟเวอร์ไม่ได้เพิกเฉย ยังแก้ได้");

{
  const b = bannerView(CLOSED, ACTIVE, null);
  eq(b?.text, termBanner(CLOSED, ACTIVE), "ข้อความแถบมาจาก termBanner");
  ok((b?.note ?? "").includes("ไม่ได้แปลว่าบันทึกไม่สำเร็จ"), "บอกว่าป้ายสถานะนิ่งโดยตั้งใจ");
  eq(b?.note, FROZEN_CHIP_NOTE, "คำอธิบายป้ายนิ่ง");
  eq(b?.error, null, "ไม่มีข้อผิดพลาด");
  eq(bannerView(ACTIVE, ACTIVE, null), null, "เทอมที่ใช้งาน = ไม่มีแถบ");
  eq(bannerView(null, ACTIVE, null), null, "ไม่ได้ดูเทอมเก่า = ไม่มีแถบ");
  eq(bannerView(null, ACTIVE, "  "), null, "ข้อผิดพลาดว่างไม่ทำให้มีแถบ");
  const e = bannerView(null, ACTIVE, "เปิดเทอมนี้ไม่สำเร็จ");
  eq(e, { text: null, note: null, error: "เปิดเทอมนี้ไม่สำเร็จ" }, "ข้อผิดพลาดมีที่แสดงแม้ไม่ได้ดูเทอมเก่า");
  eq(bannerView(CLOSED, ACTIVE, "กลับไม่สำเร็จ")?.error, "กลับไม่สำเร็จ", "แถบเทอมเก่าพร้อมข้อผิดพลาด");
}

// ── ขั้นที่ 3: สร้างเทอมใหม่จากรอบอัตรากำลัง ─────────────────────────────────
// รูปข้อมูลตามคำตอบจริงของ GET /terms/rounds · GET /terms/preview?round_id= (task-3-report "รูป report")
{
  const RD = (p: Partial<TermRound> = {}): TermRound => ({
    id: 1, label: "2/2569", year: 2569, semester: 2, status: "closed",
    exported_at: null, exported_label: null, usable: true, reasons: [], ...p,
  });
  const SENT = RD({ id: 9, label: "1/2569", year: 2569, semester: 1, exported_at: "2026-11-17T03:00:00+00:00",
    exported_label: "1/2569", usable: false, reasons: ["รอบ 1/2569 ส่งเข้าโปรแกรมจัดตารางแล้ว (เทอม 1/2569) — ส่งซ้ำไม่ได้"] });

  // ป้ายในตัวเลือกรอบ: สามสถานะ
  eq(roundOptionLabel(RD()), "ภาคเรียน 2/2569 · ใช้ได้", "รอบที่ใช้ได้");
  eq(roundOptionLabel(RD({ usable: false, reasons: ["ยังไม่ยืนยัน 3 รายการ"] })), "ภาคเรียน 2/2569 · ยังใช้ไม่ได้",
     "รอบที่ยังใช้ไม่ได้");
  eq(roundOptionLabel(SENT), "ภาคเรียน 1/2569 · ส่งแล้ว (เทอม 1/2569)", "รอบที่ส่งแล้วบอกเทอม");
  ok(!roundOptionLabel({ ...SENT, exported_label: null }).includes("null"), "ไม่มีชื่อเทอมก็ไม่พิมพ์ null");

  // ค่าเริ่มต้นของตัวเลือกรอบ (รีวิวทั้งสาขา M2): รอบที่ใช้ได้ของภาคเรียน "หลัง" ภาคเรียนปัจจุบัน (ที่ใกล้ที่สุด) · ไม่มี → ไม่เลือก
  // (หน้าต่างใช้แผนเดิม) — ไม่ถอยไปรอบของภาคเรียนปัจจุบัน (ปุ่มจะเก็บตารางเป็นเทอมนั้น → 409) หรือภาคเรียนที่ผ่านมา (จะปิดเทอมปัจจุบัน
  // แล้วเปิดเทอมเก่า) · ที่ส่งแล้วเลือกไม่ได้
  const NEW_BAD = RD({ id: 3, label: "1/2570", year: 2570, semester: 1, usable: false, reasons: ["x"] });
  const OLD_OK = RD({ id: 2 });
  const NEXT_OK = RD({ id: 4, label: "1/2570", year: 2570, semester: 1 });
  const LATER_OK = RD({ id: 5, label: "2/2570", year: 2570, semester: 2 });
  const NOW_21 = { year: 2569, semester: 2 };
  eq(defaultTermRound([OLD_OK, NEXT_OK], NOW_21)?.id, 4, "รอบของภาคเรียนถัดไป ไม่ใช่รอบของภาคเรียนปัจจุบัน");
  eq(defaultTermRound([NEXT_OK, OLD_OK, SENT], NOW_21)?.id, 4, "ไม่ขึ้นกับลำดับที่รับมา");
  eq(defaultTermRound([LATER_OK, NEXT_OK], NOW_21)?.id, 4, "หลายรอบข้างหน้า = ภาคเรียนที่ใกล้ที่สุด");
  eq(defaultTermRound([OLD_OK], NOW_21), null, "มีแค่รอบของภาคเรียนปัจจุบัน = ไม่เลือก");
  eq(defaultTermRound([RD({ id: 6, label: "1/2569", year: 2569, semester: 1 })], NOW_21), null, "รอบของภาคเรียนที่ผ่านมา = ไม่เลือก");
  eq(defaultTermRound([OLD_OK, NEW_BAD], NOW_21), null, "รอบข้างหน้ายังใช้ไม่ได้ = ไม่เลือก");
  eq(defaultTermRound([{ ...NEXT_OK, exported_at: "2026-11-17T03:00:00+00:00", exported_label: "1/2570" }], NOW_21), null,
     "รอบข้างหน้าที่ส่งแล้ว = ไม่เลือก");
  eq(defaultTermRound([OLD_OK], { year: 2569, semester: 1 })?.id, 2, "เทอมที่ใช้อยู่ 1/2569 → รอบ 2/2569 คือภาคเรียนถัดไป");
  eq(defaultTermRound([OLD_OK, NEXT_OK], null), null, "บอกไม่ได้ว่าภาคเรียนปัจจุบันคืออะไร = ไม่เลือก");
  eq(defaultTermRound([SENT], NOW_21), null, "ส่งแล้วทุกรอบ = ไม่มีค่าเริ่มต้น");
  eq(defaultTermRound([], NOW_21), null, "ไม่มีรอบ");
  // ภาคเรียนปัจจุบัน: เทอมที่เปิดในรายการเทอม · ยังไม่มีเทอมที่บันทึกไว้ (เว็บจริงตอนกดครั้งแรก) → ปี/ภาคในหน้าตั้งค่า
  // (ตามที่ปุ่มจะใช้เก็บตารางที่ลงไว้ — running_term_identity ของเซิร์ฟเวอร์)
  eq(runningTerm(ACTIVE, { year: "2570", term: "2" }), { year: 2569, semester: 1 }, "มีเทอมที่เปิด = ใช้เทอมนั้น");
  eq(runningTerm(null, { year: "2569", term: "2" }), { year: 2569, semester: 2 }, "ยังไม่มีเทอม = ปี/ภาคในหน้าตั้งค่า");
  eq(runningTerm(null, { year: " 2569 ", term: "1" }), { year: 2569, semester: 1 }, "ตัดช่องว่าง");
  for (const bad of [{ year: "", term: "2" }, { year: "2569", term: "3" }, { year: "69", term: "1" }, { year: "2569.5", term: "1" }, null]) {
    eq(runningTerm(null, bad), null, `ตั้งค่าไม่ครบ/ผิด = ไม่รู้ ${JSON.stringify(bad)}`);
  }
  eq(roundSelectable(SENT), false, "รอบที่ส่งแล้วแสดงแต่เลือกไม่ได้");
  eq(roundSelectable(NEW_BAD), true, "รอบที่ใช้ไม่ได้ยังเลือกดูเหตุได้");

  // ข้อความผิดของฟอร์ม: ไม่ได้เลือกรอบ · รอบใช้ไม่ได้ · ไม่ได้กรอกรหัส (ข้อความเดียวกับ TERM_ADMIN_CODE_MISSING ของเซิร์ฟเวอร์)
  const src = readFileSync(new URL("../../mock_api.py", import.meta.url), "utf8");
  const missing = /^TERM_ADMIN_CODE_MISSING = "([^"]+)"/m.exec(src);
  ok(missing !== null, "หา TERM_ADMIN_CODE_MISSING ใน mock_api.py ไม่เจอ");
  eq(newTermFromRoundError(null, "รหัส"), "เลือกรอบอัตรากำลังก่อน", "ไม่ได้เลือกรอบ");
  ok((newTermFromRoundError(SENT, "รหัส") ?? "").includes("ส่งเข้าโปรแกรมแล้ว"), "รอบที่ส่งแล้ว");
  ok((newTermFromRoundError(NEW_BAD, "รหัส") ?? "").includes("ยังใช้ไม่ได้"), "รอบที่ใช้ไม่ได้");
  eq(newTermFromRoundError(NEW_BAD, ""), newTermFromRoundError(NEW_BAD, "รหัส"), "รอบใช้ไม่ได้ บอกเรื่องรอบก่อนเรื่องรหัส");
  eq(newTermFromRoundError(OLD_OK, ""), missing![1], "ไม่ได้กรอกรหัส");
  eq(newTermFromRoundError(OLD_OK, "   "), missing![1], "ช่องว่างล้วนเท่ากับไม่ได้กรอก (เซิร์ฟเวอร์ตัดช่องว่าง)");
  eq(newTermFromRoundError(OLD_OK, " รหัส "), null, "พร้อมกด");

  // สรุปก่อนสร้าง (แบบข้อ 4.5): ค่า 0 ไม่ขึ้น ยกเว้นแถวแผน · ชุดกิจกรรม = warn · ครูที่เว็บไม่รู้จัก = info
  const report = (p: Partial<RoundReport> = {}): RoundReport => ({
    requirements: 1220, periods: 2209, teachers_in_plan: 138, curricula: 74, pools: 13, pool_options: 44,
    teachers_created: [], subjects_created: [], teachers_patched: [], subjects_patched: [], code_links: [],
    inactive_open: [], inactive_teachers_used: [], inactive_subjects_used: [], unknown_teachers: [], activity_sets: [],
    ...p,
  });
  const preview = (rep: RoundReport, slots = 0): RoundPreview => ({
    requirements: 1220, teachers: 143, periods_total: 2209, curricula: 0, slots_to_clear: slots,
    round: { id: 1, label: "2/2569", year: 2569, semester: 2, usable: true, reasons: [], report: rep },
  });
  const rows = roundPreviewRows(preview(report()));
  eq(rows.map((r) => r.label), ["แผนการสอน", "คาบรวมตามแผน", "ครูในแผน", "หลักสูตร", "ชุดคาบเสรี"],
     "ข้อมูลตั้งต้น: รายการว่างทุกตัวจึงไม่ขึ้น");
  eq(rows[0].value, "1,220 แถว", "ตัวเลขคั่นหลักพัน");
  eq(rows[4].value, "13 ชุด (44 ตัวเลือก) · ยังไม่ลงคาบ", "ชุดคาบเสรีบอกจำนวนตัวเลือก");
  ok(rows.every((r) => r.tone === "plain"), "ไม่มีอะไรต้องเตือน");
  const empty = roundPreviewRows(preview(report({ requirements: 0, periods: 0, teachers_in_plan: 0, curricula: 0,
                                                 pools: 0, pool_options: 0 })));
  eq(empty.map((r) => [r.label, r.value]), [["แผนการสอน", "0 แถว"]], "ค่า 0 ไม่ขึ้น ยกเว้นแถวแผน");

  const full = roundPreviewRows(preview(report({
    teachers_created: [{ wl_id: 144, id: 144, name: "ครูใหม่จากเว็บ", code: null, department_id: 1 }],
    subjects_created: [{ wl_id: null, id: 272, code: "ZZ901", name: "วิชาใหม่พิมพ์เอง" }],
    teachers_patched: [{ wl_id: 1, id: 501, name: "ครูห้าศูนย์หนึ่ง",
      changes: [{ field: "name", label: "ชื่อ", old: "ครู 501", new: "ครูห้าศูนย์หนึ่ง" },
                { field: "department_id", label: "กลุ่มสาระ", old: 1, new: 2 }] }],
    subjects_patched: [{ wl_id: 1, id: 900, code: "ท21102", name: "ภาษาไทยพื้นฐาน 2",
      changes: [{ field: "is_elective", label: "เป็นวิชาเสรี", old: null, new: true },
                { field: "duration", label: "คาบคู่", old: 1, new: 2 }] }],
    activity_sets: [{ name: "ชุมนุม ม.1", group_ids: [1, 2], group_names: ["ม.1/1", "ม.1/2"], weekly: 1,
                      teacher_ids: [4, 5], teacher_names: ["ครู ก", "ครู ข"] },
                    { name: "", group_ids: [3], group_names: ["ม.2/1"], weekly: 2, teacher_ids: [], teacher_names: [] }],
    unknown_teachers: [{ id: 77, name: "ครูเฉพาะโปรแกรม", code: "T77", department_id: null, active: true }],
    inactive_teachers_used: [{ id: 12, name: "ครูปิดใช้งาน" }],
  }), 1150), (id) => ({ 1: "ภาษาไทย", 2: "คณิตศาสตร์" } as Record<number, string>)[id]);
  const row = (label: string) => full.find((r) => r.label === label);
  eq(row("ครูใหม่ที่จะสร้าง")?.value, "1 คน", "ครูใหม่");
  eq(row("ครูใหม่ที่จะสร้าง")?.items, ["ครูใหม่จากเว็บ"], "รายชื่อครูใหม่");
  eq(row("วิชาใหม่ที่จะสร้าง")?.items, ["ZZ901 วิชาใหม่พิมพ์เอง"], "รายการวิชาใหม่มีรหัส");
  eq(row("ครูที่จะถูกแก้ข้อมูล")?.items,
     ["ครูห้าศูนย์หนึ่ง · ชื่อ: ครู 501 → ครูห้าศูนย์หนึ่ง · กลุ่มสาระ: ภาษาไทย → คณิตศาสตร์"],
     "Ruling T1 C4: ชื่อ · ช่อง: ค่าเดิม → ค่าใหม่ (กลุ่มสาระเป็นชื่อ)");
  eq(row("วิชาที่จะถูกแก้ข้อมูล")?.items, ["ท21102 ภาษาไทยพื้นฐาน 2 · เป็นวิชาเสรี: ว่าง → ใช่ · คาบคู่: ไม่ใช่ → ใช่"],
     "ค่าว่าง/จริงเท็จ/คาบคู่อ่านเป็นคำ");
  eq(row("ชุดกิจกรรมที่ต้องลงคาบเอง")?.tone, "warn", "ชุดกิจกรรมเป็นคำเตือน");
  eq(row("ชุดกิจกรรมที่ต้องลงคาบเอง")?.value, "2 ชุด", "จำนวนชุดกิจกรรม");
  eq(row("ชุดกิจกรรมที่ต้องลงคาบเอง")?.items,
     ["ชุมนุม ม.1 · ม.1/1, ม.1/2 · 1 คาบ/สัปดาห์ · ครู ก, ครู ข", "ชุดกิจกรรม · ม.2/1 · 2 คาบ/สัปดาห์ · ยังไม่มีครู"],
     "รายการชุดกิจกรรม: ชื่อ ห้อง คาบ ครู");
  eq(row("ครูในโปรแกรมที่เว็บไม่รู้จัก")?.tone, "info", "ครูที่เว็บไม่รู้จัก = แจ้งให้รู้");
  ok((row("ครูในโปรแกรมที่เว็บไม่รู้จัก")?.value ?? "").includes("ไม่ทำอะไร"), "บอกว่าไม่ทำอะไรกับครูเหล่านี้");
  eq(row("ครูที่ปิดใช้งานในโปรแกรม แต่อยู่ในเทอมใหม่")?.tone, "warn", "ครูที่ปิดใช้งานแต่ถูกใช้ = เตือน");
  eq(row("คาบที่ลงตารางไว้ตอนนี้")?.value, "1,150 คาบ · จะถูกล้าง", "คาบที่จะถูกล้าง");
  ok(full.every((r) => !/undefined|null|NaN/.test(r.value + (r.items ?? []).join(""))), "ไม่มี undefined/null/NaN");

  // รีวิวทั้งสาขา M3 (แบบข้อ 4.2): ช่องที่ยกจากแผนเดิมไม่ได้ · แถวแผนของวิชาเสรี/กิจกรรมที่สร้างตามรูปเดิม · วิชาที่ถูกเพิ่มเข้าหลักสูตร
  // = บรรทัด info พร้อม "ดูรายการ" (รูปตาม _term_report)
  const m3 = roundPreviewRows(preview(report({
    not_carried: [{ group_id: 1, subject_id: 901, fields: ["pinned_day", "pinned_double"], group_name: "ม.1/1",
                    code: "ค21102", name: "คณิตศาสตร์พื้นฐาน 2", field_labels: ["วันที่ปัก", "คาบคู่ที่ปัก"] }],
    new_cells: [{ group_id: 3, subject_id: 900, group_name: "ม.1/3", code: "ท21102", name: "ภาษาไทยพื้นฐาน 2" },
                { group_id: 4, subject_id: 900, group_name: "ม.1/4", code: "ท21102", name: "ภาษาไทยพื้นฐาน 2" }],
    elective_rows: 1, activity_rows: 1,
    pattern_rows: [{ kind: "elective", group_id: 1, group_name: "ม.1/1", subject_id: 904, code: "ศ21201", name: "ดนตรีสากล",
                     teacher_id: 508, teacher_name: "ครู 508", weekly_count: 2 },
                   { kind: "activity", group_id: 2, group_name: "ม.1/2", subject_id: 903, code: "ก21902", name: "แนะแนว 2",
                     teacher_id: null, teacher_name: null, weekly_count: 1 }],
    curriculum_rows_added: [{ curriculum_id: 1, curriculum_name: "ม.1/1-6", subject_id: 904, code: "ศ21201", name: "ดนตรีสากล",
                              weekly_count: 2 }],
  })));
  const m3row = (label: string) => m3.find((r) => r.label === label);
  const NC = "ห้อง+วิชาที่ยกเซ็ตห้องย่อย/คาบที่ปักจากแผนเดิมไม่ได้ (แถวเดิมไม่ตรงกัน — ปล่อยว่าง)";
  const NEW = "ห้อง+วิชาที่ไม่มีในแผนเดิม (เซ็ตห้องย่อย/คาบที่ปักเริ่มว่าง)";
  const PAT = "แถวแผนของวิชาเสรี/กิจกรรมที่สร้างตามรูปของแผนเดิม";
  const CUR = "วิชาที่ถูกเพิ่มเข้าหลักสูตร (ให้แถวแผนข้างบนผ่านการตรวจหลักสูตร)";
  eq([NC, NEW, PAT, CUR].map((l) => m3row(l)?.tone), ["info", "info", "info", "info"], "ทั้งสี่เป็นบรรทัด info");
  eq(m3row(NC)?.value, "1 รายการ", "นับช่องที่ยกไม่ได้ละห้อง+วิชา");
  eq(m3row(NC)?.items, ["ม.1/1 · ค21102 คณิตศาสตร์พื้นฐาน 2: วันที่ปัก, คาบคู่ที่ปัก"], "รายการ: ห้อง วิชา ช่อง");
  eq(m3row(NEW)?.value, "2 รายการ", "ห้อง+วิชาที่ไม่มีในแผนเดิม");
  eq(m3row(NEW)?.items, ["ม.1/3 · ท21102 ภาษาไทยพื้นฐาน 2", "ม.1/4 · ท21102 ภาษาไทยพื้นฐาน 2"], "รายการห้อง+วิชาใหม่");
  eq(m3row(PAT)?.value, "2 แถว", "นับ elective_rows + activity_rows");
  eq(m3row(PAT)?.items, ["ม.1/1 · ศ21201 ดนตรีสากล · ครู 508 · 2 คาบ/สัปดาห์ (คาบเสรี)",
                         "ม.1/2 · ก21902 แนะแนว 2 · ยังไม่มีครู · 1 คาบ/สัปดาห์ (กิจกรรม)"], "รายการแถวแผนตามรูปเดิม");
  eq(m3row(CUR)?.items, ["ม.1/1-6: ศ21201 ดนตรีสากล · 2 คาบ/สัปดาห์"], "รายการวิชาที่ถูกเพิ่มเข้าหลักสูตร");
  ok(m3.every((r) => !/undefined|null|NaN/.test(r.value + (r.items ?? []).join(""))), "M3: ไม่มี undefined/null/NaN");
  ok(m3.findIndex((r) => r.label === PAT) > m3.findIndex((r) => r.label === "ชุดคาบเสรี"), "อยู่ถัดจากชุดคาบเสรี");
  // จำนวนจากตัวเลขของเซิร์ฟเวอร์ แม้รายการไม่มากับรายงาน (รายงานรุ่นก่อน)
  eq(roundPreviewRows(preview(report({ elective_rows: 3, activity_rows: 0 }))).find((r) => r.label === PAT)?.value, "3 แถว",
     "นับจากตัวเลข");
  // รายงานที่ขาดรายการ (รูปเก่า/เสีย) ไม่ทำให้หน้าต่างล้ม
  const partial = { ...preview(report()), round: { ...preview(report()).round,
    report: { requirements: 5 } as unknown as RoundReport } };
  eq(roundPreviewRows(partial).map((r) => r.value), ["5 แถว"], "รายงานไม่ครบ → แสดงเท่าที่มี");

  // ผลหลังสร้าง: บอกชุดกิจกรรมที่ต้องลงคาบเอง และที่ดูได้อีก
  eq(roundCreatedNote(report()), null, "ไม่มีชุดกิจกรรม = ไม่มีข้อความ");
  const note = roundCreatedNote(report({ activity_sets: [{ name: "ชุมนุม", group_ids: [1], group_names: ["ม.1/1"],
    weekly: 1, teacher_ids: [], teacher_names: [] }] })) ?? "";
  ok(note.includes("ชุดกิจกรรมที่ต้องลงคาบเอง 1 ชุด") && note.includes("หน้ารอบของเว็บลงอัตรากำลัง"),
     "บอกจำนวนและที่เปิดดูได้อีก");
  eq(activitySetLines(undefined), [], "ไม่มีรายงาน = ไม่มีรายการ");

  // ปฏิเสธก่อนทำอะไร (400/403/404/409/429) = กดใหม่ได้ · 5xx/ไม่มีคำตอบ = ห้ามกดซ้ำ
  for (const s of [400, 403, 404, 409, 429]) eq(canRetryCreate({ response: { status: s } }, true), true, `จากรอบ ${s}`);
  for (const s of [500, 503]) eq(canRetryCreate({ response: { status: s } }, true), false, `จากรอบ ${s}`);
  eq(canRetryCreate(new Error("timeout"), true), false, "จากรอบ ไม่มีคำตอบ");
  // รีวิวทั้งสาขา M11: 503 ของทางรอบเกิดก่อนเขียนเสมอ (ต่อฐาน/อ่านรายการเทอมไม่ได้ — ข้อความไทยของเซิร์ฟเวอร์บอกให้ลองใหม่) → กดใหม่ได้
  // · 503 ที่ไม่มีข้อความไทย (ตัวกลางตอบแทน ไม่รู้ว่าถึงเซิร์ฟเวอร์ไหม) และทางเดิม ยังล็อกตามเดิม
  const s503 = { response: { status: 503, data: { detail: "ติดต่อฐานข้อมูลไม่ได้ในขณะนี้ ลองใหม่อีกครั้ง" } } };
  eq(canRetryCreate(s503, true), true, "จากรอบ 503 ไทย = กดใหม่ได้");
  eq(canRetryCreate(s503), false, "ทางเดิม 503 ไม่เปลี่ยน");
  eq(canRetryCreate({ response: { status: 503, data: { detail: "Service Unavailable" } } }, true), false, "503 ของตัวกลาง");
  eq(termErrorText(s503, "สำรอง"), "ติดต่อฐานข้อมูลไม่ได้ในขณะนี้ ลองใหม่อีกครั้ง", "503 แสดงข้อความของเซิร์ฟเวอร์");
  // 500 ของทางรอบ: แสดงข้อความไทยของเซิร์ฟเวอร์ ("ข้อมูลเดิมยังอยู่ครบ") — ไม่ใช่ "ยังไม่รู้ว่าเทอมถูกสร้างหรือยัง" · ยังล็อกปุ่ม
  // (COMMIT ที่ล้มแบบกำกวมก็ตอบ 500 — ให้ดูรายการเทอมก่อนเปิดหน้าต่างใหม่) · ทางเดิมและคำตอบที่ไม่มีข้อความไทยเหมือนเดิมทุกตัวอักษร
  const s500 = { response: { status: 500, data: { detail: "สร้างเทอมใหม่ไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ ลองใหม่อีกครั้ง" } } };
  const t500 = createLockedText(s500, true);
  ok(t500.startsWith("สร้างเทอมใหม่ไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ") && !t500.includes("ยังไม่รู้") && t500.includes("รายการเทอม"),
     `500 ทางรอบ — ได้ ${t500}`);
  const legacy = "ไม่ได้รับคำตอบที่แน่ชัดจากเซิร์ฟเวอร์ — ยังไม่รู้ว่าเทอมถูกสร้างหรือยัง ปิดหน้าต่างนี้แล้วดูรายการเทอมก่อน อย่ากดสร้างซ้ำ";
  eq(createLockedText(s500), legacy, "ทางเดิม 500 = ข้อความเดิม");
  eq(createLockedText(new Error("timeout"), true), legacy, "ไม่มีคำตอบ = ข้อความเดิม");
  eq(createLockedText({ response: { status: 502, data: "<html>" } }, true), legacy, "502 ของตัวกลาง = ข้อความเดิม");
  eq(canRetryCreate({ response: { status: 403 } }), false, "ทางเดิมไม่เปลี่ยน");
  eq(termErrorText({ response: { status: 403, data: { detail: "รหัสผู้ดูแลระบบของเว็บลงอัตรากำลังไม่ถูกต้อง" } } }, "สำรอง"),
     "รหัสผู้ดูแลระบบของเว็บลงอัตรากำลังไม่ถูกต้อง", "403 ไทยถึงผู้ใช้");
  eq(termErrorText({ response: { status: 429, data: { detail: "ลองผิดหลายครั้ง รอสักครู่" } } }, "สำรอง"),
     "ลองผิดหลายครั้ง รอสักครู่", "429 ไทยถึงผู้ใช้");

  // โหลดรอบไม่ได้: หน้าต่างแบบเดิม + บรรทัดเล็ก (addendum 4) · เซิร์ฟเวอร์ไม่มี route นี้ (404) = เงียบ
  eq(roundsLoadNote({ response: { status: 404, data: { detail: "Not Found" } } }), null, "เซิร์ฟเวอร์รุ่นก่อน = ไม่มีบรรทัด");
  const note503 = roundsLoadNote({ response: { status: 503, data: { detail: "ต่อฐานข้อมูลไม่ได้ในตอนนี้" } } }) ?? "";
  ok(note503.includes("ต่อฐานข้อมูลไม่ได้ในตอนนี้") && note503.includes("แผนเดิม"), "503 บอกเหตุ และว่าแบบเดิมยังใช้ได้");
  ok((roundsLoadNote(new Error("Network Error")) ?? "").includes("แผนเดิม"), "เครือข่ายหลุด");
  ok(!(roundsLoadNote(new Error("Network Error")) ?? "").includes("Network"), "ไม่ส่งข้อความอังกฤษ");

  // ปลดล็อกเทอม: ข้อความปรับทะเบียนของเว็บลงอัตรากำลัง (คีย์ workload) ต่อท้ายผล
  const base = { closed: { label: "2/2569", slots: 0 }, active: { label: "1/2569" } };
  const w = createOutcome({ ...base, workload: ["ปรับทะเบียนครู/วิชาของเว็บลงอัตรากำลังให้ตรงกับเทอม 1/2569: ครู 1 คน · วิชา 1 วิชา"] },
                          "ปลดล็อก");
  ok(w.text.startsWith("ปลดล็อกเทอม 1/2569 แล้ว") && w.text.includes("ครู 1 คน · วิชา 1 วิชา"), "ต่อท้ายข้อความ workload");
  eq(createOutcome({ ...base, workload: [] }, "ปลดล็อก").text, createOutcome(base, "ปลดล็อก").text, "ว่าง = เหมือนเดิม");
}

console.log(`ALL PASS (${n})`);
