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

export type ProblemKind = "no_room" | "teacher_clash" | "forced" | "room_clash";

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

/**
 * ห้องเรียนไหนนั่งอยู่ในห้องสอนเดียวกันกับคาบนี้ในชั่วโมงเดียวกัน
 *
 * "ห้อง 1 ไม่ควรมีนักเรียน 2 ห้อง ถ้าไม่ใช้ห้องแม่ลูก"
 *
 * ห้องเดียวที่มีนักเรียนสองห้องพร้อมกันคือคาบที่สอนจริงไม่ได้ ตารางของห้องสอน
 * วาดมันซ้อนกันให้เห็นอยู่แล้ว แต่ไม่มีใครบอกว่ามันผิด — หน้าตรวจความสอดคล้อง
 * เห็น (clash_room) ส่วนช่องในตารางที่โรงเรียนเห็นอาการกลับเงียบ
 *
 * ยกเว้นคาบเดียวกันที่เห็นสองครั้ง: กิจกรรม/คาบเสรีวงเดียวกัน และห้องย่อยพี่น้อง
 * ที่เรียนวิชาเดียวกันกับครูคนเดียวกัน (ครูสอนทีเดียว นักเรียนนั่งห้องเดียว)
 *
 * `parentOf` คือแผนที่ห้องย่อย -> ห้องแม่ ถ้าไม่ส่งมา จะถือว่าวิชาและครูที่ตรงกัน
 * คือคาบเดียวกัน — เกณฑ์เดียวกับที่ clashingTeachers ข้างบนใช้อยู่ ซึ่งผ่อนกว่า
 * จึงไม่มีทางเตือนผิด แต่ทุกที่ที่เรียกจริงส่ง parentOf มา จึงใช้กฎเข้มได้
 */
function roomSharers(
  s: TimetableSlot, all: TimetableSlot[], parentOf?: ReadonlyMap<number, number | null>,
): string[] {
  if (!s.room_id) return [];            // ไม่มีห้อง = อีกเรื่องหนึ่ง นับแยกอยู่แล้ว
  const out = new Set<string>();
  for (const x of all) {
    if (x.id === s.id) continue;
    if (x.day !== s.day || x.period !== s.period) continue;
    if (x.room_id !== s.room_id) continue;
    // ห้องเรียนเดียวกันมีสองคาบในชั่วโมงเดียวกัน เป็นเรื่องของห้องเรียน ไม่ใช่
    // ของห้องสอน (ห้องย่อย ก/ข/ค ที่วาดซ้อนกันในช่องเดียวก็เข้าทางนี้)
    if (x.group_id === s.group_id) continue;
    if (x.activity_key && x.activity_key === s.activity_key) continue;
    if (x.elective_pool_id && x.elective_pool_id === s.elective_pool_id) continue;
    const together = x.subject_id != null && x.subject_id === s.subject_id
      && x.teacher_id === s.teacher_id;
    if (together && siblings(s.group_id, x.group_id, parentOf)) continue;
    out.add(x.group_name ?? `ห้อง ${x.group_id}`);
  }
  return [...out];
}

/** ห้องย่อยของห้องแม่เดียวกันไหม — ไม่รู้จักต้นไม้ห้องก็ตอบว่าใช่ (ดู roomSharers) */
function siblings(
  a: number, b: number, parentOf?: ReadonlyMap<number, number | null>,
): boolean {
  if (!parentOf) return true;
  const pa = parentOf.get(a) ?? null;
  return pa !== null && pa === (parentOf.get(b) ?? null);
}

/** ห้องย่อย -> ห้องแม่ สำหรับส่งให้ problemOf/problemsIn/classProblems */
export function parentMap(groups: StudentGroup[]): Map<number, number | null> {
  const m = new Map<number, number | null>();
  const walk = (list: StudentGroup[], parent: number | null) => {
    for (const g of list) {
      m.set(g.id, parent);
      walk(g.children ?? [], g.id);
    }
  };
  walk(groups, null);
  return m;
}

/** คาบนี้มีอะไรค้างอยู่ไหม — null แปลว่าเรียบร้อยดี */
export function problemOf(
  s: TimetableSlot, all: TimetableSlot[],
  parentOf?: ReadonlyMap<number, number | null>,
): SlotProblem | null {
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
  const mates = roomSharers(s, all, parentOf);
  if (mates.length) {
    kinds.push("room_clash");
    says.push(`${s.room_name ? `ห้อง ${s.room_name}` : "ห้องสอนนี้"} มี `
      + `${mates.join(" · ")} เรียนอยู่ด้วยในชั่วโมงนี้`);
    fixes.push("เปลี่ยนห้องให้คาบใดคาบหนึ่ง (กด 🔁 ที่คาบ) หรือกดแก้เฉพาะห้องที่เลือก");
  }
  if (!kinds.length) return null;
  return { slot: s, kinds, text: says.join(" · "), fix: fixes.join(" · ") };
}

/**
 * ทุกคาบที่ยังค้างอยู่ในกลุ่มคาบที่ให้มา เรียงตามวัน/คาบ
 *
 * `view` คือคาบที่กำลังดู (ตารางของห้องหนึ่ง) ส่วน `all` ต้องเป็นทั้งโรงเรียนเสมอ
 * เพราะครูชนต้องมองข้ามห้อง · กรอบแดงในตารางกับรายการห้องที่มีปัญหาของปุ่ม
 * "แก้เฉพาะห้องที่เลือก" เรียกฟังก์ชันนี้ตัวเดียวกัน จึงไม่มีทางนับไม่ตรงกัน
 */
export function problemsIn(
  view: TimetableSlot[], all: TimetableSlot[],
  parentOf?: ReadonlyMap<number, number | null>,
): SlotProblem[] {
  return view
    .map((s) => problemOf(s, all, parentOf))
    .filter((p): p is SlotProblem => p !== null)
    .sort((a, b) => a.slot.day - b.slot.day || a.slot.period - b.slot.period);
}

/** ทุกคาบที่ยังค้างอยู่ของห้องนี้ เรียงตามวัน/คาบ */
export function classProblems(
  all: TimetableSlot[], groupIds: number[],
  parentOf?: ReadonlyMap<number, number | null>,
): SlotProblem[] {
  const want = new Set(groupIds);
  return problemsIn(all.filter((s) => want.has(s.group_id)), all, parentOf);
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
