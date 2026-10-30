/**
 * parkTray — คิดเรื่องถาดพักคาบจากข้อมูลที่หน้าเว็บมีอยู่แล้ว
 *
 *   "ตอนนี้ช่องฝากคาบด้านล่างใช้งานได้แต่ยังช้าอยู่ ช่วยทำให้การใช้งานลื่นขึ้น"
 *
 * ของเดิม ทุกครั้งที่ฝากหรือดึงคาบกลับ หน้าเว็บยิงเซิร์ฟเวอร์สามรอบเรียงกัน:
 * สั่งงาน → โหลดตารางทั้งโรงเรียนใหม่ (2,735 แถว ≈ 3.3 MB) → โหลดถาดใหม่
 * ทั้งที่คำตอบของรอบแรกบอกทุกอย่างที่ต้องรู้มาแล้ว
 *
 * ไฟล์นี้คือตัวคิดที่ทำให้ตัดสองรอบหลังออกได้ — ฟังก์ชันล้วน ไม่แตะเครือข่าย
 * ไม่แตะ store จึงทดสอบตรง ๆ ได้
 */
import type { TimetableSlot } from "../types";

/**
 * แถวที่จะหายไปจากตาราง เมื่อสั่งพักคาบหนึ่ง
 *
 * กฎเดียวกับฝั่งเซิร์ฟเวอร์: คาบคู่ยกออกไปด้วยกันทั้งคู่เสมอ แยกครึ่งเดียว
 * ไม่ได้ เพราะครึ่งที่เหลือจะกลายเป็นคาบคู่ที่ขาดคู่ (mock_api.park_slots)
 *
 * คืนมาเรียงตามวันและคาบ เท่ากับลำดับที่เซิร์ฟเวอร์เก็บไว้ในถาด
 */
export function parkRows(slotId: number, slots: TimetableSlot[]): TimetableSlot[] {
  const target = slots.find((s) => s.id === slotId);
  if (!target) return [];
  const key = target.double_group_key;
  const rows = key ? slots.filter((s) => s.double_group_key === key) : [target];
  return [...rows].sort((a, b) => (a.day - b.day) || (a.period - b.period));
}

/** เท่าที่ต้องรู้จากการ์ดหนึ่งใบ เพื่อตอบว่าที่เดิมยังว่างอยู่ไหม */
export interface ParkedHome {
  group_id:     number | null;
  from_day:     number | null;
  from_periods: number[];
}

/**
 * ชื่อช่องหนึ่งช่อง — ใช้กฎเดียวกับ `_cell_busy` ฝั่งเซิร์ฟเวอร์:
 * ช่องหนึ่งคือ (ชั้น · วัน · คาบ)
 */
export const cellKey = (
  groupId: number | null, day: number, period: number,
): string => `${groupId ?? "-"}|${day}|${period}`;

/**
 * ช่องที่มีคาบลงอยู่แล้วทั้งตาราง
 *
 * ทำครั้งเดียวต่อการเปลี่ยนตาราง แล้วทุกการ์ดในถาดถามจากชุดนี้ได้ทันที —
 * ถ้าให้แต่ละการ์ดไปไล่ทั้ง 2,735 แถวเอง ถาดก็จะกลายเป็นตัวถ่วงเสียเอง
 */
export function occupiedCells(slots: TimetableSlot[]): Set<string> {
  const used = new Set<string>();
  for (const s of slots) used.add(cellKey(s.group_id, s.day, s.period));
  return used;
}

/**
 * ที่เดิมของคาบนี้ยังว่างอยู่ไหม — ปุ่ม "คืนที่เดิม" กดได้หรือไม่
 *
 * เซิร์ฟเวอร์ตอบข้อนี้มาในการ์ดด้วย (`home_free`) แต่คำตอบนั้นเป็นภาพตอนที่
 * โหลดถาด พอมีการย้ายคาบอื่นทีหลัง คำตอบก็ค้าง ปุ่มเลยกดได้ทั้งที่ช่องเดิมมี
 * คนลงไปแล้ว หรือกดไม่ได้ทั้งที่ว่างแล้ว คิดเองจากตารางที่อยู่ในหน้าเว็บจึง
 * ตรงเสมอ และไม่ต้องถามเซิร์ฟเวอร์ใหม่หลังทุกการเปลี่ยนแปลง
 */
export function homeFreeIn(card: ParkedHome, occupied: Set<string>): boolean {
  if (card.from_day == null || card.from_periods.length === 0) return false;
  const day = card.from_day;
  return card.from_periods.every((n) =>
    n != null && !occupied.has(cellKey(card.group_id, day, n)));
}

/** อย่างเดียวกัน แต่สะดวกเมื่อมีการ์ดใบเดียว */
export function homeFreeFor(card: ParkedHome, slots: TimetableSlot[]): boolean {
  return homeFreeIn(card, occupiedCells(slots));
}

/**
 * ตารางหลังยกคาบออกไปพัก
 *
 * คืนทั้ง slots ชุดใหม่ และแถวที่ถูกยกออก เพื่อเอาไว้ใส่กลับถ้าเซิร์ฟเวอร์
 * ปฏิเสธ (คาบที่ล็อกไว้ หรือคาบที่คนอื่นเพิ่งย้ายไปแล้ว)
 */
export function withoutRows(
  slots: TimetableSlot[], rows: TimetableSlot[],
): TimetableSlot[] {
  if (rows.length === 0) return slots;
  const gone = new Set(rows.map((r) => r.id));
  return slots.filter((s) => !gone.has(s.id));
}

/**
 * ตารางหลังเอาคาบกลับลง
 *
 * เซิร์ฟเวอร์คืนแถวใหม่มาให้พร้อมชื่อครบแล้ว (unpark_slot → {"slots": rows})
 * ใส่ทับด้วย id เพื่อกันแถวซ้ำ เผื่อการดึงข้อมูลเป็นรอบเอาแถวเดียวกันมาก่อน
 */
export function withRows(
  slots: TimetableSlot[], rows: TimetableSlot[],
): TimetableSlot[] {
  if (rows.length === 0) return slots;
  const by = new Map(rows.map((r) => [r.id, r]));
  const here = new Set(slots.map((s) => s.id));
  // แถวที่มีอยู่แล้วทับอยู่กับที่ ไม่ย้ายไปท้ายรายการ — ช่องที่มีหลายคาบซ้อน
  // กัน (ห้องย่อยเรียนพร้อมกัน) จะได้ไม่สลับลำดับบนจอทุกครั้งที่แตะคาบหนึ่ง
  const out = slots.map((s) => by.get(s.id) ?? s);
  for (const r of rows) if (!here.has(r.id)) out.push(r);
  return out;
}

/**
 * การ์ดหนึ่งใบในถาด เท่าที่ ParkedLesson ของฝั่งเครือข่ายต้องการ
 *
 * ประกาศซ้ำที่นี่เพราะไฟล์ในโฟลเดอร์นี้นำเข้าจากฝั่งเครือข่ายไม่ได้ (ตัวคิด
 * ต้องไม่รู้จักเครือข่าย) ถ้าสองฝั่งหลุดกัน ตัวตรวจชนิดจะฟ้องตอนที่ store
 * เอาค่าไปใส่ ซึ่งเป็นจุดที่ทั้งสองฝั่งมาเจอกัน
 */
export interface ParkedCard {
  parked_id:       number;
  parked_at:       string;
  group_id:        number | null;
  group_name:      string | null;
  subject_id:      number | null;
  subject_code:    string | null;
  subject_name:    string | null;
  teacher_id:      number | null;
  teacher_name:    string | null;
  co_teacher_id:   number | null;
  co_teacher_name: string | null;
  room_id:         number | null;
  room_name:       string | null;
  is_elective:       boolean;
  is_activity_block: boolean;
  elective_label:  string | null;
  hours:           number;
  from_day:        number | null;
  from_periods:    number[];
  home_free:       boolean;
}

/**
 * การ์ดชั่วคราว ใช้ระหว่างรอคำตอบจากเซิร์ฟเวอร์
 *
 * ถ้าไม่มีใบนี้ คาบจะหายจากตารางไปแล้วแต่การ์ดยังไม่มา — มีช่วงหนึ่งที่คาบ
 * "ไม่อยู่ที่ไหนเลย" ซึ่งบนเน็ตที่ช้าอาจกินเวลาเกือบวินาที คนใช้ก็จะคิดว่า
 * คาบถูกลบไปแล้ว พอคำตอบมาถึง ใบนี้ถูกแทนด้วยใบจริงที่มี parked_id เดียวกัน
 *
 * ค่าทุกตัวมาจากแถวที่ยกออก ซึ่งมีชื่อครบอยู่แล้ว (เซิร์ฟเวอร์เติมชื่อให้ตอน
 * ส่งตารางออกมา) จึงไม่ต้องเดาอะไร
 */
export function provisionalCard(rows: TimetableSlot[]): ParkedCard {
  const head = rows[0];
  return {
    parked_id:       head.id,
    parked_at:       new Date().toISOString(),
    group_id:        head.group_id,
    group_name:      head.group_name,
    subject_id:      head.subject_id,
    subject_code:    head.subject_code,
    subject_name:    head.subject_name,
    teacher_id:      head.teacher_id,
    teacher_name:    head.teacher_name,
    co_teacher_id:   head.co_teacher_id ?? null,
    co_teacher_name: head.co_teacher_name ?? null,
    room_id:         head.room_id,
    room_name:       head.room_name,
    is_elective:       !!head.is_elective,
    is_activity_block: !!head.is_activity_block,
    elective_label:  head.elective_label ?? null,
    hours:           rows.length,
    from_day:        head.day,
    from_periods:    rows.map((r) => r.period),
    // ที่เดิมเพิ่งว่างเพราะเราเพิ่งยกออกมาเอง แต่ถาดคิดค่านี้ใหม่จากตารางอยู่
    // แล้ว ค่านี้จึงเป็นเพียงค่าตั้งต้นที่ไม่มีใครใช้
    home_free:       true,
  };
}

/**
 * ที่หน้าเว็บคิดไว้ตรงกับที่เซิร์ฟเวอร์ทำจริงไหม
 *
 * ถ้าไม่ตรง แปลว่าตารางในหน้าเว็บกับของเซิร์ฟเวอร์ไม่เหมือนกันแล้ว (คนอื่น
 * แก้ค้างอยู่ หรือคาบคู่ถูกผูกไว้คนละแบบ) กรณีนั้นต้องโหลดตารางใหม่จริง ๆ —
 * ช้าแต่ถูก ดีกว่าเร็วแล้วหน้าจอไม่ตรงกับของจริง
 */
export function parkAgrees(removed: TimetableSlot[], hours: number): boolean {
  return removed.length === hours;
}
