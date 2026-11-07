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
  blockedReason, gateRequest, setWriteBlock, WriteBlocked,
} from "../../frontend/src/api/writeGate.ts";

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

console.log(`ALL PASS (${n})`);
