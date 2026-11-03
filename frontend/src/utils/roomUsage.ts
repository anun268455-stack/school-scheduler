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
  /** คาบเสรี: ห้องอยู่ที่วิชาแต่ละวิชา ไม่ได้อยู่ที่ตัวคาบ */
  elective_options?: { room_id?: number | null }[] | null;
}

/**
 * ห้อง -> ชั่วโมงที่ถูกใช้ (ไม่ซ้ำ day-period)
 *
 * นับห้องของวิชาในคาบเสรีด้วย เพราะช่องห้องของตัวคาบเสรีว่างไว้เสมอ ถ้าไม่นับ
 * ห้องที่ใช้สอนวิชาเสรีจะรายงานว่า "ไม่เคยถูกใช้" แล้วหลุดจากใบพิมพ์ตารางการ
 * ใช้ห้องไปทั้งใบ (ดู roomsToPrint ข้างล่าง ที่ตัดห้องที่ไม่มีคาบออก)
 */
export function roomHoursOf<S extends RoomSlotLike>(slots: S[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const mark = (roomId: number | null | undefined, s: RoomSlotLike): void => {
    if (roomId == null) return;
    const at = out.get(roomId) ?? new Set<string>();
    at.add(`${s.day}-${s.period}`);
    out.set(roomId, at);
  };
  for (const s of slots) {
    mark(s.room_id, s);
    for (const o of s.elective_options ?? []) mark(o.room_id, s);
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
