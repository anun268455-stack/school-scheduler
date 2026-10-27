/**
 * ขนาดตัวอักษรในช่องตาราง — ย่อขยายได้จากหน้าตั้งค่า
 *
 *   "แถบสเกลเลื่อนย่อขยายตัวอักษรในช่องตาราง โดยมีช่องตัวอย่างให้เห็นข้างๆ"
 *
 * ขนาดจริงของแต่ละบรรทัดถูกตั้งไว้เป็น px ในช่องตาราง (รหัสวิชา 11px ชื่อครู
 * 9px …) ซึ่งเป็นสัดส่วนที่ใช้ได้ดีอยู่แล้ว การย่อขยายจึงคูณทุกบรรทัดด้วยตัวเลข
 * เดียวกัน ไม่ใช่ตั้งขนาดใหม่ทีละบรรทัด — สัดส่วนเดิมจึงคงอยู่
 *
 * ส่งผ่าน CSS variable ที่ครอบตารางไว้ชั้นเดียว แล้วทุกช่องอ่านค่าเดียวกันผ่าน
 * calc() ไม่ต้องส่ง prop ลงไปทุกชั้นของตาราง (ซึ่งมีหลายชั้น) และหน้าตัวอย่าง
 * ในหน้าตั้งค่าก็ใช้ทางเดียวกันเป๊ะ ๆ ด้วยการตั้ง variable ของตัวเอง
 */

/** ชื่อ CSS variable ที่ทุกช่องอ่าน */
export const CELL_SCALE_VAR = "--tt-font-scale";

export const CELL_SCALE_MIN = 0.7;
export const CELL_SCALE_MAX = 1.8;
export const CELL_SCALE_STEP = 0.05;
export const CELL_SCALE_DEFAULT = 1;

/** ค่าที่ใช้ได้จริง — ค่าที่อ่านไม่ได้ หรือเกินช่วง ให้กลับไปที่ค่าเริ่มต้น */
export function clampCellScale(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return CELL_SCALE_DEFAULT;
  return Math.min(CELL_SCALE_MAX, Math.max(CELL_SCALE_MIN, Math.round(n * 100) / 100));
}

/** ขนาดตัวอักษรของบรรทัดหนึ่ง เมื่อคิดสเกลของผู้ใช้เข้าไปแล้ว */
export function cellFont(basePx: number): string {
  return `calc(${basePx}px * var(${CELL_SCALE_VAR}, 1))`;
}

/** สไตล์ที่ตั้งสเกลให้ของที่อยู่ข้างใน — ใช้ครอบตาราง และครอบช่องตัวอย่าง */
export function cellScaleStyle(scale: number): React.CSSProperties {
  return { [CELL_SCALE_VAR]: clampCellScale(scale) } as React.CSSProperties;
}

/** "ปกติ" · "ใหญ่ขึ้น 25%" · "เล็กลง 10%" — อ่านง่ายกว่าเลข 1.25 */
export function cellScaleLabel(scale: number): string {
  const pct = Math.round((clampCellScale(scale) - 1) * 100);
  if (pct === 0) return "ขนาดปกติ";
  return pct > 0 ? `ใหญ่ขึ้น ${pct}%` : `เล็กลง ${-pct}%`;
}
