/**
 * ปุ่มลูกศรเลื่อนดูคนต่อไป — ครูคนถัดไป ห้องถัดไป ห้องสอนถัดไป
 *
 *   "ช่วยทำให้เราสามารถกดปุ่มลูกศรเพื่อเลื่อนดูคนต่อไป"
 *
 * ตรวจตารางครู 170 คนด้วยการเปิดช่องค้นหา พิมพ์ชื่อ แล้วเลือก ซ้ำ 170 ครั้ง
 * คือการพิมพ์ชื่อคนที่ยังไม่ได้ดู ซึ่งเป็นสิ่งเดียวที่คนตรวจไม่รู้ ปุ่มลูกศร
 * เดินไปตามลำดับเดิมของรายชื่อ จึงไม่ต้องจำว่าดูถึงใคร
 *
 * ลำดับที่ใช้คือลำดับเดียวกับในช่องเลือก (ครูเรียงตามรหัส ห้องเรียนเรียงตาม
 * ชั้น) เพื่อให้ "คนต่อไป" หมายถึงคนที่อยู่ถัดลงไปในรายชื่อที่เห็นอยู่
 */

/** คนก่อนหน้า (dir -1) หรือคนต่อไป (dir 1) — null คือไม่มีให้ไปต่อ */
export function stepTarget(
  ids: number[],
  current: number | null,
  dir: -1 | 1,
): number | null {
  if (!ids.length) return null;
  const at = current == null ? -1 : ids.indexOf(current);
  // ยังไม่ได้เลือกใคร หรือคนที่เลือกไว้ไม่อยู่ในรายชื่อนี้แล้ว (เพิ่งสลับมุมมอง
  // หรือห้องนั้นถูกลบไป) — กดขวาเริ่มที่คนแรก กดซ้ายเริ่มที่คนสุดท้าย
  if (at < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  const next = at + dir;
  if (next < 0 || next >= ids.length) return null;  // สุดทางแล้ว
  return ids[next];
}

/** "คนที่ 12 จาก 170" — index เป็น 0 เมื่อยังไม่ได้เลือกใคร */
export function stepPosition(
  ids: number[],
  current: number | null,
): { index: number; total: number } {
  const at = current == null ? -1 : ids.indexOf(current);
  return { index: at < 0 ? 0 : at + 1, total: ids.length };
}
