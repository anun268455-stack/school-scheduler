/**
 * ห้องสอนถูกใช้กี่ชั่วโมงต่อสัปดาห์ — สำหรับ "ตารางการใช้ห้องสอน"
 *
 *   "ช่วยทำปุ่มกดเพื่อปริ้น ตารางการใช้ห้องสอนเพิ่มเติมด้วย"
 *
 * นับเป็น "ชั่วโมงที่ห้องถูกใช้" ไม่ใช่จำนวนคาบในตาราง — คาบที่สอนรวมสองห้อง
 * ย่อยในห้องเดียวชั่วโมงเดียว ถูกเขียนไว้สองแถว แต่ห้องถูกใช้ไปหนึ่งชั่วโมง
 * ถ้านับแถว ห้องจะดูเหมือนถูกใช้เกินจริงเท่าตัว
 */

/** สิ่งที่ต้องรู้จากคาบหนึ่ง เพื่อนับการใช้ห้อง */
export interface RoomSlotLike {
  room_id: number | null;
  day:     number;
  period:  number;
}

/** ห้อง -> ชั่วโมงที่ถูกใช้ (ไม่ซ้ำ day-period) */
export function roomHoursOf<S extends RoomSlotLike>(slots: S[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const s of slots) {
    if (s.room_id == null) continue;
    const at = out.get(s.room_id) ?? new Set<string>();
    at.add(`${s.day}-${s.period}`);
    out.set(s.room_id, at);
  }
  return out;
}

/** กี่ชั่วโมง — 0 เมื่อห้องนี้ไม่เคยถูกใช้ */
export function roomHourCount(
  hours: Map<number, Set<string>>, roomId: number,
): number {
  return hours.get(roomId)?.size ?? 0;
}

/**
 * ห้องที่จะพิมพ์ — ติ๊กมาเองก็เอาตามที่ติ๊ก (รวมห้องที่ยังไม่มีคาบ เพราะอาจ
 * อยากได้กระดาษเปล่าไว้เขียนมือ) ไม่ติ๊กอะไรเลยแปลว่า "ทั้งหมดที่มีคาบจริง" —
 * โรงเรียนนี้มี 130 ห้อง และหลายห้องเป็นห้องพักครูหรือห้องที่ยังไม่ได้ใช้
 */
export function roomsToPrint<R extends { id: number }, S extends RoomSlotLike>(
  rooms: R[], slots: S[], selectedIds: number[],
): R[] {
  const hours = roomHoursOf(slots);
  const pick = new Set(selectedIds);
  return rooms.filter((r) => (pick.size
    ? pick.has(r.id)
    : roomHourCount(hours, r.id) > 0));
}
