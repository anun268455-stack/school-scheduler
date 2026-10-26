/**
 * ด่านเดียวที่เหลือในโหมดจัดเอง: ห้ามทับคาบที่ล็อกไว้
 *
 *   "เราสามารถวางคาบลงไปได้ ถ้าชนกันก็จะขึ้นสีแดงให้ไปเลื่อนคาบที่ชนแทน
 *    (ยกเว้นจะไปชนกับคาบที่ล็อกเอาไว้)"
 *
 * ทำไมต้องเช็คที่หน้าเว็บ ไม่ใช่ปล่อยให้เซิร์ฟเวอร์เช็ค:
 *
 * โหมดจัดเองส่ง force ไปให้เซิร์ฟเวอร์ ซึ่งแปลว่า "ข้ามการตรวจทั้งหมด" —
 * เป็นธงที่เซิร์ฟเวอร์รุ่นที่รันอยู่ตอนนี้รู้จักอยู่แล้ว โหมดนี้จึงใช้ได้ทันที
 * โดยไม่ต้องรอให้เซิร์ฟเวอร์อัปเดต แต่ "ข้ามทั้งหมด" ก็แปลว่าข้อห้ามเรื่อง
 * คาบล็อกถูกข้ามไปด้วย หน้าเว็บจึงต้องเป็นคนยืนด่านนั้นเอง
 *
 * นับว่า "ชนกัน" แบบเดียวกับเซิร์ฟเวอร์: นักเรียนกลุ่มเดียวกัน · ครูคนเดียวกัน
 * (รวมครูสอนร่วม) · ห้องเดียวกัน อย่างใดอย่างหนึ่ง
 */
import type { TimetableSlot } from "../types";
import type { SharesStudents } from "./groupHierarchy";

/** ครูทุกคนของคาบนี้ — รวมครูสอนร่วม เหมือนที่เซิร์ฟเวอร์นับ */
function teachersOf(s: TimetableSlot): number[] {
  const out: number[] = [];
  if (s.teacher_id != null) out.push(s.teacher_id);
  const co = (s as { co_teacher_id?: number | null }).co_teacher_id;
  if (co != null) out.push(co);
  return out;
}

export interface LockClash {
  slot: TimetableSlot;
  reason: string;
}

/**
 * คาบที่ล็อกไว้ซึ่งจะชนกัน ถ้าย้าย `moving` ไปที่ (day, period) พร้อมห้อง roomId
 *
 * คืน null เมื่อวางได้ — ชนกับคาบที่ไม่ได้ล็อกไม่นับ นั่นคือเรื่องที่โหมดนี้
 * ตั้งใจให้ผ่านไปแล้วขึ้นกรอบแดง
 */
export function lockClashAt(
  moving: TimetableSlot,
  day: number,
  period: number,
  roomId: number | null | undefined,
  all: TimetableSlot[],
  shares: SharesStudents,
): LockClash | null {
  const mine = teachersOf(moving);
  for (const s of all) {
    if (s.id === moving.id || !s.is_locked) continue;
    if (s.day !== day || s.period !== period) continue;
    if (shares(s.group_id, moving.group_id)) {
      return { slot: s, reason: `ห้อง ${s.group_name ?? "?"} มีคาบที่ล็อกไว้อยู่ในชั่วโมงนี้` };
    }
    const theirs = teachersOf(s);
    const both = mine.find((t) => theirs.includes(t));
    if (both != null) {
      return { slot: s, reason: `${s.teacher_name ?? "ครูคนนี้"} มีคาบที่ล็อกไว้อยู่ในชั่วโมงนี้` };
    }
    if (roomId != null && s.room_id === roomId) {
      return { slot: s, reason: `ห้อง ${s.room_name ?? "?"} ถูกคาบที่ล็อกไว้ใช้อยู่ในชั่วโมงนี้` };
    }
  }
  return null;
}
