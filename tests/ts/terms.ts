/**
 * ทดสอบ utils/terms — ภาคเรียนฝั่งหน้าเว็บ
 *
 * ข้อที่สำคัญที่สุดคือ shouldPoll: ซิงค์สดต้องหยุดตอนดูเทอมที่ปิด ไม่งั้นมันจะ
 * ดึงเทอมปัจจุบันมาทับของเก่าที่เปิดดูอยู่ แล้วจอเด้งกลับโดยไม่มีอะไรฟ้อง
 */
import {
  activeTerm, canEdit, dropLiveData, LIVE_DATA_KEYS, liveReloadComplete, nextTerm, shouldPoll, sortTerms, termBanner, termLabel,
  type TermMeta,
} from "../../frontend/src/utils/terms.ts";

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

// ── ออกจากเทอมเก่าได้เมื่อข้อมูลสดมาครบเท่านั้น ───────────────────────────────
eq(liveReloadComplete("ready", 0), true, "ครบทุกเส้น");
eq(liveReloadComplete("ready", 1), false, "ล้มบางเส้น = จอเป็นของผสม ห้ามล้างแบนเนอร์");
eq(liveReloadComplete("unreachable", 9), false, "ล้มหมด");
eq(liveReloadComplete("loading", 0), false, "ยังไม่ได้ถามอะไร");

console.log(`ALL PASS (${n})`);
