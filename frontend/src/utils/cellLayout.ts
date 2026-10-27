/**
 * ผังช่องตาราง — อะไรอยู่บรรทัดบน อะไรอยู่ล่าง และแต่ละอย่างตัวใหญ่เท่าไร
 *
 *   "อยากให้เราสามารถควบคุมได้เลยว่าแต่ละส่วนจะให้อยู่บนล่าง และสามารถเลือก
 *    ขนาดได้ด้วย · อีกส่วนคือมีตัวอย่างการพิมพ์ด้วยว่าจะให้อะไรอยู่บนล่างและ
 *    ขนาดเท่าใด โดยมีตัวอย่างให้ดูด้วย"
 *
 * แยกสองชุด เพราะอ่านบนจอกับอ่านบนกระดาษไม่เหมือนกัน — บนจอมีชื่อชั้นด้วย
 * ส่วนใบพิมพ์ของชั้นไหนก็ของชั้นนั้น ไม่ต้องเขียนชื่อชั้นซ้ำทุกช่อง
 *
 * ขนาดเก็บเป็น "ตัวคูณ" ไม่ใช่ px เพื่อสองเรื่อง
 *   1. ตัวคูณ 1 = ขนาดที่ใช้อยู่เดิม ของเก่าจึงหน้าตาเหมือนเดิมเป๊ะ ๆ
 *   2. แถบย่อขยายทั้งช่อง (cell_font_scale) ยังคูณทับได้อีกชั้น ไม่ตีกัน
 *      — อันนั้นคือ "ทั้งช่องใหญ่ขึ้น" อันนี้คือ "บรรทัดไหนเด่นกว่าบรรทัดไหน"
 */

/** ส่วนที่จัดลำดับได้ */
export type CellPartKey = "subject" | "teacher" | "room" | "group";

export interface CellPart {
  key:   CellPartKey;
  /** ตัวคูณขนาด — 1 คือขนาดเดิม */
  scale: number;
  /** ปิดไว้ = ไม่ต้องแสดงบรรทัดนี้เลย */
  show:  boolean;
}

export type CellLayout = CellPart[];

export const PART_LABEL: Record<CellPartKey, string> = {
  subject: "รหัสวิชา",
  teacher: "ชื่อครู",
  room:    "ห้องที่สอน",
  group:   "ชั้นเรียน",
};

export const PART_HINT: Record<CellPartKey, string> = {
  subject: "เช่น ค21101",
  teacher: "เช่น ครูสมชาย ใจดี",
  room:    "เช่น 247",
  group:   "เช่น ม.1/5",
};

/** ขนาดจริงตอนนี้ของแต่ละส่วน (px บนจอ) — ตัวคูณคูณกับค่านี้ */
export const SCREEN_BASE_PX: Record<CellPartKey, number> = {
  subject: 11, teacher: 9, room: 11, group: 9,
};

/**
 * ขนาดจริงของแต่ละบรรทัดบนกระดาษ (pt) ตอนพิมพ์ 1 ใบต่อแผ่น
 *
 * ตรงกับ METRICS[1] ใน PrintView — ช่องตัวอย่างในหน้าตั้งค่าใช้ชุดนี้ จะได้
 * ตรงกับที่ออกกระดาษจริง ถ้าวันหนึ่ง METRICS เปลี่ยน ต้องแก้ที่นี่ด้วย
 * (เทสต์ layoutwire ตรวจว่าสองที่ยังตรงกัน)
 */
export const PRINT_BASE_PT: Record<CellPartKey, number> = {
  subject: 13, teacher: 11, room: 12, group: 11,
};

export const PART_SCALE_MIN  = 0.6;
export const PART_SCALE_MAX  = 2;
export const PART_SCALE_STEP = 0.05;

/** ใบพิมพ์เป็นของชั้นหรือของครูอยู่แล้ว จึงไม่มีบรรทัดชั้นเรียน */
export const PRINT_PARTS: CellPartKey[] = ["subject", "teacher", "room"];
export const SCREEN_PARTS: CellPartKey[] = ["subject", "teacher", "room", "group"];

/** ลำดับและขนาดที่ใช้อยู่เดิม — ค่าเริ่มต้นต้องให้หน้าตาไม่เปลี่ยน */
export const DEFAULT_SCREEN_LAYOUT: CellLayout = SCREEN_PARTS.map(
  (key) => ({ key, scale: 1, show: true }));
export const DEFAULT_PRINT_LAYOUT: CellLayout = PRINT_PARTS.map(
  (key) => ({ key, scale: 1, show: true }));

function clampScale(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(PART_SCALE_MAX, Math.max(PART_SCALE_MIN, Math.round(n * 100) / 100));
}

/**
 * อ่านค่าที่เก็บไว้ให้เป็นผังที่ใช้ได้จริง
 *
 * ค่ามาจากเซิร์ฟเวอร์และจากไฟล์สำรองเก่า จึงต้องทนทุกอย่าง: ไม่มีเลย, เป็น
 * ชนิดอื่น, ส่วนซ้ำ, ส่วนที่ไม่รู้จัก, ส่วนที่หายไป (เช่นไฟล์เก่าที่ยังไม่มี
 * ชั้นเรียน) ส่วนที่ขาดถูกเติมท้ายด้วยค่าเริ่มต้นเสมอ จะได้ไม่มีทางที่บรรทัด
 * ไหนหายไปจากหน้าจอเพราะข้อมูลเก่า
 */
export function normalizeLayout(raw: unknown, allowed: CellPartKey[]): CellLayout {
  const want = new Set(allowed);
  const out: CellLayout = [];
  const taken = new Set<CellPartKey>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const key = (item && typeof item === "object"
        ? (item as { key?: unknown }).key : item) as CellPartKey;
      if (typeof key !== "string" || !want.has(key) || taken.has(key)) continue;
      taken.add(key);
      const o = (item ?? {}) as { scale?: unknown; show?: unknown };
      out.push({
        key,
        scale: clampScale(typeof o === "object" ? o.scale : 1),
        show: typeof o === "object" && o.show != null ? !!o.show : true,
      });
    }
  }
  for (const key of allowed) {
    if (!taken.has(key)) out.push({ key, scale: 1, show: true });
  }
  return out;
}

export function normalizeScreenLayout(raw: unknown): CellLayout {
  return normalizeLayout(raw, SCREEN_PARTS);
}
export function normalizePrintLayout(raw: unknown): CellLayout {
  return normalizeLayout(raw, PRINT_PARTS);
}

/** ตัวคูณของส่วนนี้ — ปิดไว้ก็คืน 0 เพื่อให้ผู้เรียกข้ามไปได้ง่าย */
export function scaleOf(layout: CellLayout, key: CellPartKey): number {
  const p = layout.find((x) => x.key === key);
  return p && p.show ? p.scale : 0;
}

export function isShown(layout: CellLayout, key: CellPartKey): boolean {
  const p = layout.find((x) => x.key === key);
  return p ? p.show : true;
}

/** เลื่อนส่วนหนึ่งขึ้นหรือลงหนึ่งขั้น — คืนผังใหม่ ไม่แก้ของเดิม */
export function movePart(layout: CellLayout, key: CellPartKey, dir: -1 | 1): CellLayout {
  const i = layout.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const out = [...layout];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function setPartScale(layout: CellLayout, key: CellPartKey, scale: number): CellLayout {
  return layout.map((p) => (p.key === key ? { ...p, scale: clampScale(scale) } : p));
}

export function setPartShown(layout: CellLayout, key: CellPartKey, show: boolean): CellLayout {
  return layout.map((p) => (p.key === key ? { ...p, show } : p));
}

/** เหมือนค่าเริ่มต้นไหม — ไว้บอกว่า "ยังไม่ได้แก้อะไร" */
export function isDefaultLayout(layout: CellLayout, allowed: CellPartKey[]): boolean {
  if (layout.length !== allowed.length) return false;
  return layout.every((p, i) => p.key === allowed[i] && p.scale === 1 && p.show);
}

/** "ปกติ" · "ใหญ่ขึ้น 25%" — อ่านง่ายกว่า 1.25 */
export function partScaleLabel(scale: number): string {
  const pct = Math.round((clampScale(scale) - 1) * 100);
  if (pct === 0) return "ปกติ";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

/** ข้อมูลตัวอย่างที่ใช้ในช่องตัวอย่างทั้งบนจอและบนกระดาษ */
export const SAMPLE: Record<CellPartKey, string> = {
  subject: "ค21101",
  teacher: "ครูสมชาย ใจดี",
  room:    "247",
  group:   "ม.1/5",
};
