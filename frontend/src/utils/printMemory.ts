/**
 * printMemory — จำตัวเลือกการพิมพ์ไว้ให้ ไม่ต้องตั้งใหม่ทุกครั้ง
 *
 *   "ถ้าให้คุณช่วยตั้งแล้วมาแก้ไขต้องให้คุณช่วยเขียนโค้ดทุกรอบ"
 *
 * ของเดิมตัวเลือกการพิมพ์อยู่ใน React state ของหน้าเดียว (App.tsx) ปิดแท็บหรือ
 * กดรีเฟรชแล้วหายหมด กลับมาต้องเลือกว่าพิมพ์อะไร กี่ใบต่อแผ่น และพิมพ์คำว่า
 * "เสริมการเรียนรู้" ใหม่ทุกครั้ง
 *
 * ── ทำไมเก็บในเครื่อง ไม่ใช่ที่เซิร์ฟเวอร์ ──
 *
 * แบบฟอร์มใบพิมพ์ (ช่องลงชื่อ หมายเหตุ) เป็นของโรงเรียน เก็บที่เซิร์ฟเวอร์
 * ถูกแล้ว — ตั้งครั้งเดียวทุกคนเห็นเหมือนกัน แต่ "ตอนนี้ฉันกำลังพิมพ์อะไร"
 * เป็นของคนที่นั่งอยู่หน้าเครื่อง ถ้าเก็บรวมกัน คนหนึ่งเปลี่ยนไปพิมพ์ใบของครู
 * อีกคนที่เปิดอยู่จะโดนเปลี่ยนตามโดยไม่รู้ตัว
 *
 * ── ทำไมไม่จำว่าติ๊กห้องไหนไว้ ──
 *
 * ตั้งใจไม่จำ `selectedIds` เพราะมันคือ "งานพิมพ์ครั้งนี้" ไม่ใช่ความชอบ ถ้าจำ
 * ไว้ คนที่สัปดาห์ก่อนพิมพ์แค่ ม.1/1 แล้ววันนี้กดพิมพ์ทั้งโรงเรียน จะได้กระดาษ
 * แผ่นเดียวโดยไม่มีอะไรบอก — ผิดแบบที่ไม่มีใครสังเกต ส่วนของที่จำไว้ทั้งหมด
 * มองเห็นได้ในหน้าต่างตัวเลือกก่อนกดพิมพ์อยู่แล้ว
 */

/** ตัวเลือกเท่าที่ตัวจำต้องรู้ — ประกาศซ้ำเพื่อไม่ให้ตัวคิดต้องรู้จักใบพิมพ์ */
export interface RememberedPrint {
  mode:             string;
  sort:             string;
  perPage:          number;
  countActivities:  boolean;
  freeLabel:        string;
  freeLabelThrough: number;
}

export const PRINT_MEMORY_KEY = "schoolScheduler.printOptions.v1";

const MODES = ["group", "teacher", "room", "workload"];
const SORTS = ["name", "department", "code"];

/**
 * ตัวเลือกที่ควรเก็บ — ไม่เอา selectedIds ตามเหตุผลข้างบน
 *
 * รับ object อะไรก็ได้ที่มีช่องพวกนี้ เพื่อให้เรียกด้วย PrintOptions ตรง ๆ ได้
 * โดยไม่ต้องนำเข้าชนิดของใบพิมพ์มาที่นี่
 */
export function toRemember(o: RememberedPrint): RememberedPrint {
  return {
    mode: o.mode, sort: o.sort, perPage: o.perPage,
    countActivities: o.countActivities,
    freeLabel: o.freeLabel, freeLabelThrough: o.freeLabelThrough,
  };
}

/**
 * อ่านของที่จำไว้ ทับลงบนค่าตั้งต้น
 *
 * ค่าที่อ่านมาจาก localStorage เป็นข้อความที่ใครแก้ก็ได้ และอาจมาจากรุ่นก่อน
 * ของโปรแกรม ช่องที่อ่านไม่ได้จึงถูกทิ้งทีละช่อง ไม่ใช่ทิ้งทั้งก้อน — ถ้าทิ้ง
 * ทั้งก้อน การเพิ่มช่องใหม่หนึ่งช่องจะล้างความจำของทุกคน
 */
export function mergeRemembered<T extends RememberedPrint>(base: T, raw: unknown): T {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = { ...base };
  if (typeof r.mode === "string" && MODES.includes(r.mode)) out.mode = r.mode;
  if (typeof r.sort === "string" && SORTS.includes(r.sort)) out.sort = r.sort;
  if (r.perPage === 1 || r.perPage === 2) out.perPage = r.perPage;
  if (typeof r.countActivities === "boolean") out.countActivities = r.countActivities;
  if (typeof r.freeLabel === "string") out.freeLabel = r.freeLabel.slice(0, 60);
  if (typeof r.freeLabelThrough === "number"
      && Number.isFinite(r.freeLabelThrough)
      && r.freeLabelThrough >= 1 && r.freeLabelThrough <= 12) {
    out.freeLabelThrough = Math.round(r.freeLabelThrough);
  }
  return out;
}

/** อ่านข้อความ JSON ที่อาจพังได้ — คืน null แทนการโยน */
export function parseStored(text: string | null): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
