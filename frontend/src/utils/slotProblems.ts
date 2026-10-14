/**
 * คาบที่ลงไปแล้วแต่ยังไม่เรียบร้อย — อะไรบ้าง และเพราะอะไร
 *
 * "ที่ฉันบอกว่าลงไปได้เลย ให้ลงไปก่อนแล้วใช้สีแดง หรือถ้าลงไม่ได้จริงๆ
 *  ให้มีปุ่มแจ้งเตือนเฉพาะของห้อง"
 *
 * ตารางที่ "จัดเสร็จแล้ว" ไม่ได้แปลว่าทุกคาบใช้งานได้จริง บางคาบลงไปแล้วแต่ยัง
 * ไม่มีห้องเรียน บางคาบครูยังติดสอนห้องอื่นอยู่ในชั่วโมงนั้น เดิมสองอย่างนี้
 * มองจากตารางไม่เห็นเลย — ต้องไปเปิดรายการแยกอีกหน้าถึงจะรู้ ทั้งที่มันคือคาบ
 * ที่อยู่ตรงหน้าอยู่แล้ว
 *
 * ไฟล์นี้ตอบคำถามเดียว: คาบนี้มีอะไรค้างอยู่ไหม เพื่อให้ตารางขึ้นกรอบแดงเอง
 * และปุ่มแจ้งเตือนของห้องนับได้จากที่เดียวกัน
 */
import type { StudentGroup, TimetableSlot } from "../types";
import { slotTeacherNames, slotLabel } from "./teacherSlots";

export type ProblemKind = "no_room" | "teacher_clash" | "forced";

export interface SlotProblem {
  slot:  TimetableSlot;
  kinds: ProblemKind[];
  /** บรรทัดเดียวที่บอกว่าเป็นอะไร ใช้ได้ทั้งใน tooltip และในรายการ */
  text:  string;
  /** จะทำยังไงต่อ */
  fix:   string;
}

/** คาบเสรีกับกิจกรรมไม่ต้องมีห้องของตัวเอง — ไม่ใช่ปัญหา */
const needsRoom = (s: TimetableSlot) =>
  !s.is_elective && !s.is_activity_block && !s.elective_pool_id;

/**
 * ครูคนเดียวกันในชั่วโมงเดียวกันแต่คนละคาบ
 *
 * ห้องย่อยพี่น้องที่เรียนวิชาเดียวกันกับครูคนเดียวกันคือคาบเดียวกัน ครูสอน
 * ทีเดียว ไม่นับ · กิจกรรมและคาบเสรีที่ใช้ครูชุดเดียวกันก็เช่นกัน
 */
function clashingTeachers(s: TimetableSlot, all: TimetableSlot[]): string[] {
  const mine = new Set(slotTeacherNames(s));
  if (!mine.size) return [];
  const out = new Set<string>();
  for (const x of all) {
    if (x.id === s.id) continue;
    if (x.day !== s.day || x.period !== s.period) continue;
    if (x.group_id === s.group_id) continue;
    // คาบเดียวกันที่นั่งเรียนด้วยกัน (วิชาเดียวกัน ครูคนเดียวกัน)
    if (x.subject_id != null && x.subject_id === s.subject_id
        && x.teacher_id === s.teacher_id) continue;
    if (x.activity_key && x.activity_key === s.activity_key) continue;
    if (x.elective_pool_id && x.elective_pool_id === s.elective_pool_id) continue;
    for (const n of slotTeacherNames(x)) if (mine.has(n)) out.add(n);
  }
  return [...out];
}

/** คาบนี้มีอะไรค้างอยู่ไหม — null แปลว่าเรียบร้อยดี */
export function problemOf(s: TimetableSlot, all: TimetableSlot[]): SlotProblem | null {
  const kinds: ProblemKind[] = [];
  const says: string[] = [];
  const fixes: string[] = [];

  if (s.is_overflow) {
    kinds.push("forced");
    says.push("ระบบหาที่ลงตามกติกาไม่ได้ จึงวางไว้ในช่องที่นักเรียนว่างให้เห็นก่อน");
    fixes.push("ลากไปวางช่องอื่น หรือเปลี่ยนครู/ห้องให้ว่างตรงกัน");
  }
  if (needsRoom(s) && !s.room_id) {
    kinds.push("no_room");
    says.push("ยังไม่มีห้องเรียน");
    fixes.push("เลือกห้องให้เอง (กด 🔁 ที่คาบ) หรือเปิดห้องเพิ่มให้วิชานี้ใช้ได้");
  }
  const clash = clashingTeachers(s, all);
  if (clash.length) {
    kinds.push("teacher_clash");
    says.push(`ครู ${clash.join(" · ")} ติดสอนห้องอื่นในชั่วโมงนี้`);
    fixes.push("ย้ายคาบนี้ หรือย้ายคาบของอีกห้องหนึ่ง");
  }
  if (!kinds.length) return null;
  return { slot: s, kinds, text: says.join(" · "), fix: fixes.join(" · ") };
}

/** ทุกคาบที่ยังค้างอยู่ของห้องนี้ เรียงตามวัน/คาบ */
export function classProblems(
  all: TimetableSlot[], groupIds: number[],
): SlotProblem[] {
  const want = new Set(groupIds);
  return all
    .filter((s) => want.has(s.group_id))
    .map((s) => problemOf(s, all))
    .filter((p): p is SlotProblem => p !== null)
    .sort((a, b) => a.slot.day - b.slot.day || a.slot.period - b.slot.period);
}

/** ชื่อห้องย่อยของห้องนี้รวมตัวมันเอง — ห้องแม่ต้องเห็นปัญหาของลูกด้วย */
export function familyIds(groups: StudentGroup[], id: number): number[] {
  const out = new Set<number>([id]);
  const walk = (list: StudentGroup[], inside: boolean) => {
    for (const g of list) {
      const here = inside || g.id === id;
      if (here) out.add(g.id);
      walk(g.children ?? [], here);
    }
  };
  walk(groups, false);
  return [...out];
}

/** "พุธ คาบ 7 · ค31102" — ที่อยู่ของคาบ ใช้ในรายการปัญหา */
export function whereOf(s: TimetableSlot, dayNames: string[]): string {
  return `${dayNames[s.day] ?? `วัน ${s.day}`} คาบ ${s.period} · ${slotLabel(s)}`;
}
