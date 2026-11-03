/**
 * ทดสอบ utils/printMemory — จำตัวเลือกการพิมพ์ไว้ให้
 *
 * สองข้อที่สำคัญกว่าข้ออื่น:
 *   · ค่าที่อ่านไม่ได้ต้องถูกทิ้ง "ทีละช่อง" ไม่ใช่ทิ้งทั้งก้อน — ถ้าทิ้งทั้งก้อน
 *     การเพิ่มช่องใหม่ช่องเดียวในรุ่นหน้าจะล้างความจำของทุกคน
 *   · ต้องไม่จำว่าติ๊กห้องไหนไว้ เพราะคนที่เคยพิมพ์ห้องเดียวแล้วกดพิมพ์ทั้ง
 *     โรงเรียน จะได้กระดาษแผ่นเดียวโดยไม่มีอะไรบอก
 */
import {
  mergeRemembered, parseStored, toRemember,
} from "../../frontend/src/utils/printMemory.ts";

let n = 0;
const ok = (cond: boolean, what: string): void => {
  n++;
  if (!cond) { console.error("FAIL:", what); process.exit(1); }
};
const eq = (a: unknown, b: unknown, what: string): void =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${what} — ได้ ${JSON.stringify(a)}`);

const BASE = {
  mode: "group", sort: "name", perPage: 2, countActivities: true,
  freeLabel: "เสริมการเรียนรู้", freeLabelThrough: 8,
  selectedIds: [] as number[],
};

// ── เก็บอะไรไว้ ─────────────────────────────────────────────────────────────
const kept = toRemember({ ...BASE, selectedIds: [1, 2, 3] } as never);
eq(Object.keys(kept).sort(),
   ["countActivities", "freeLabel", "freeLabelThrough", "mode", "perPage", "sort"],
   "เก็บหกช่อง และไม่มี selectedIds");
ok(!("selectedIds" in kept), "ต้องไม่จำว่าติ๊กห้องไหนไว้");

// ── อ่านกลับ ────────────────────────────────────────────────────────────────
eq(mergeRemembered(BASE, null), BASE, "ไม่มีอะไรจำไว้ = ค่าตั้งต้น");
eq(mergeRemembered(BASE, {}), BASE, "ก้อนเปล่า = ค่าตั้งต้น");
eq(mergeRemembered(BASE, { mode: "teacher" }).mode, "teacher", "โหมดที่จำไว้");
eq(mergeRemembered(BASE, { perPage: 1 }).perPage, 1, "จำนวนต่อแผ่น");
eq(mergeRemembered(BASE, { freeLabel: "ชุมนุม" }).freeLabel, "ชุมนุม", "คำในคาบว่าง");
eq(mergeRemembered(BASE, { freeLabel: "" }).freeLabel, "",
   "คำว่างต้องจำได้ด้วย — ว่างคือการตั้งใจปิด ไม่ใช่ยังไม่ได้ตั้ง");
eq(mergeRemembered(BASE, { countActivities: false }).countActivities, false,
   "เท็จต้องจำได้ ไม่ใช่ตกไปเพราะมันเป็นค่าเท็จ");

// selectedIds ที่หลงมาในของเก่า ต้องไม่ถูกเอามาใช้
eq(mergeRemembered(BASE, { selectedIds: [7] }).selectedIds, [],
   "selectedIds ที่หลงมา ต้องไม่ถูกอ่าน");

// ── ค่าที่อ่านไม่ได้ ถูกทิ้งทีละช่อง ────────────────────────────────────────
eq(mergeRemembered(BASE, { mode: "ไม่มีโหมดนี้" }).mode, "group", "โหมดที่ไม่รู้จัก");
eq(mergeRemembered(BASE, { sort: 5 }).sort, "name", "ชนิดผิด");
eq(mergeRemembered(BASE, { perPage: 7 }).perPage, 2, "จำนวนต่อแผ่นที่ทำไม่ได้");
eq(mergeRemembered(BASE, { perPage: 0 }).perPage, 2, "ศูนย์ใบต่อแผ่น");
eq(mergeRemembered(BASE, { freeLabelThrough: 99 }).freeLabelThrough, 8, "เกินช่วง");
eq(mergeRemembered(BASE, { freeLabelThrough: 0 }).freeLabelThrough, 8, "ต่ำกว่าช่วง");
eq(mergeRemembered(BASE, { freeLabelThrough: NaN }).freeLabelThrough, 8, "ไม่ใช่จำนวน");
eq(mergeRemembered(BASE, { freeLabelThrough: 6.6 }).freeLabelThrough, 7, "ปัดเป็นจำนวนเต็ม");
ok(mergeRemembered(BASE, { freeLabel: "ก".repeat(500) }).freeLabel.length <= 60,
   "ข้อความยาวเกินถูกตัด");

// ช่องเสียช่องเดียว ต้องไม่ทำให้ช่องที่ดีหายไปด้วย
const mixed = mergeRemembered(BASE, { mode: "room", perPage: "สอง", freeLabel: "ว่าง" });
eq(mixed.mode, "room", "ช่องที่ดีถูกใช้");
eq(mixed.perPage, 2, "ช่องที่เสียถูกทิ้ง");
eq(mixed.freeLabel, "ว่าง", "ช่องที่ดีอีกช่องก็ถูกใช้");

// ── อ่าน JSON ที่พังได้ ─────────────────────────────────────────────────────
eq(parseStored(null), null, "ไม่มีค่า");
eq(parseStored(""), null, "ข้อความว่าง");
eq(parseStored("{พัง"), null, "JSON พัง — คืน null ไม่ใช่โยนทิ้งทั้งหน้า");
eq(parseStored('{"mode":"room"}'), { mode: "room" }, "อ่านได้");

// ไปกลับหนึ่งรอบต้องได้ของเดิม
const roundTrip = mergeRemembered(BASE,
  parseStored(JSON.stringify(toRemember({ ...BASE, mode: "room", perPage: 1 } as never))));
eq(roundTrip.mode, "room", "ไปกลับ: โหมด");
eq(roundTrip.perPage, 1, "ไปกลับ: จำนวนต่อแผ่น");

console.log(`ALL PASS (${n})`);
