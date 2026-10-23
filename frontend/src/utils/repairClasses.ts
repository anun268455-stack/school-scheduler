/**
 * แก้เฉพาะห้องที่เลือก — ตรรกะล้วนๆ ของปุ่มนั้น แยกไว้ให้ทดสอบได้
 *
 * "ห้องที่บอกว่าล็อกไว้ ต้องล็อคเอาไว้นะ ทุกอย่างยังเหมือนเดิม เพิ่มเติมแค่ฉัน
 *  จะไปกดว่าห้องไหนที่ต้องไปเรียนลาน แล้วกดแก้ไขตารางใหม่ ตารางเรียนนั้นก็จะ
 *  จัดใหม่ให้เหมาะสมสำหรับห้องนั้น"
 *
 * ปุ่มนี้ให้สัญญาสองข้อ: ห้องที่ติ๊กถูกจัดใหม่ · ห้องอื่นอยู่ที่เดิมทุกคาบ
 * ข้อหลังเป็นสิ่งที่โรงเรียนจะไม่เชื่อถ้าไม่ได้เห็นเอง และตัวจัดตารางเป็นฝ่ายที่
 * ผิดสัญญาได้ จึงไม่ถามแค่ตัวจัดว่า "ห้องอื่นขยับไหม" — ไฟล์นี้เทียบตารางก่อน
 * กับหลังจัดเองด้วย (outsideChanges) และคาบที่ล็อกไว้ก็เทียบเช่นเดียวกัน
 *
 * "ห้องไหนมีปัญหา" ไม่ได้นิยามใหม่ที่นี่ — เรียก classProblems ของ slotProblems
 * ซึ่งเป็นตัวเดียวกับที่ทำกรอบแดงในตาราง ถ้าสองที่นับไม่ตรงกัน โรงเรียนจะเลิก
 * เชื่อทั้งคู่
 */
import type { StudentGroup, TimetableSlot } from "../types";
import { classProblems, familyIds, type SlotProblem } from "./slotProblems";
import { compareNames } from "./groupHierarchy";
import type { PickRowLike } from "./yardPicks";

// ── นับปัญหา ──────────────────────────────────────────────────────────────

export interface ProblemCounts {
  /** คาบที่มีปัญหาอย่างน้อยหนึ่งอย่าง */
  lessons: number;
  noRoom:  number;
  clash:   number;
  forced:  number;
}

export const NO_PROBLEMS: ProblemCounts = { lessons: 0, noRoom: 0, clash: 0, forced: 0 };

/** ใช้คำเดียวกับรายการปัญหาของห้อง (ClassProblemsModal) */
export const COUNT_LABEL = {
  noRoom: "ไม่มีห้องเรียน",
  clash:  "ครูติดสอนห้องอื่น",
  forced: "ระบบวางไว้ให้เห็นก่อน",
} as const;

export function countProblems(ps: SlotProblem[]): ProblemCounts {
  const c: ProblemCounts = { ...NO_PROBLEMS };
  for (const p of ps) {
    c.lessons++;
    if (p.kinds.includes("no_room"))       c.noRoom++;
    if (p.kinds.includes("teacher_clash")) c.clash++;
    if (p.kinds.includes("forced"))        c.forced++;
  }
  return c;
}

/** ["ไม่มีห้องเรียน 3 คาบ", "ครูติดสอนห้องอื่น 2 คาบ"] — ว่างเมื่อไม่มีอะไรค้าง */
export function describeCounts(c: ProblemCounts): string[] {
  const out: string[] = [];
  if (c.noRoom) out.push(`${COUNT_LABEL.noRoom} ${c.noRoom} คาบ`);
  if (c.clash)  out.push(`${COUNT_LABEL.clash} ${c.clash} คาบ`);
  if (c.forced) out.push(`${COUNT_LABEL.forced} ${c.forced} คาบ`);
  return out;
}

// ── รายการห้อง ────────────────────────────────────────────────────────────

export interface RepairClass {
  id:    number;
  name:  string;
  /** ห้องนี้รวมห้องย่อยของมัน — ชุดนี้คือที่ส่งไปให้ตัวจัดเมื่อติ๊กห้องนี้ */
  ids:   number[];
  /** "ก", "ข", "ค" — ห้องย่อยที่อยู่ในห้องนี้ */
  subNames: string[];
  /** คาบทั้งหมดของห้องนี้ (รวมห้องย่อย) */
  lessons: number;
  counts:  ProblemCounts;
  /** ลานที่เลือกไว้แล้ว แต่คาบนั้นในตารางยังไม่ได้ลานนั้น */
  pendingYard: number;
}

const hourKey = (g: number, day: number, period: number) => `${g}:${day}:${period}`;

/** "ม.4/6ก" ของห้อง "ม.4/6" → "ก" */
function subLabel(parent: string, child: string): string {
  return child.startsWith(parent) && child.length > parent.length
    ? child.slice(parent.length).trim() : child;
}

/**
 * ทุกห้อง (ห้องหลัก) เรียงตามเลขห้อง พร้อมปัญหาของแต่ละห้องตอนนี้
 *
 * ห้องย่อย (ก ข ค) ไม่แยกเป็นแถวของตัวเอง — นักเรียนคนเดียวกับห้องหลัก และ
 * ตารางของห้องหลักก็แสดงคาบของห้องย่อยอยู่แล้ว การติ๊กห้องหลักจึงรวมห้องย่อย
 * ไปด้วยเสมอ ไม่ปล่อยให้ห้องหลักถูกจัดใหม่ทั้งที่คาบของห้องย่อยแข็งอยู่
 */
export function repairClassList(
  groups: StudentGroup[],
  slots: TimetableSlot[],
  picks: PickRowLike[] = [],
): RepairClass[] {
  // ห้องไหน วัน/คาบไหน ตอนนี้อยู่ห้องอะไร — ไว้ดูว่าลานที่เลือกไว้ตารางตามหรือยัง
  const roomsAt = new Map<string, Set<number | null>>();
  for (const s of slots) {
    const k = hourKey(s.group_id, s.day, s.period);
    const set = roomsAt.get(k) ?? new Set<number | null>();
    set.add(s.room_id);
    roomsAt.set(k, set);
  }

  const roots = [...groups].sort((a, b) => compareNames(a.name, b.name));
  return roots.map((g) => {
    const ids  = familyIds(groups, g.id);
    const mine = new Set(ids);
    return {
      id: g.id,
      name: g.name,
      ids,
      subNames: (g.children ?? []).map((c) => subLabel(g.name, c.name)),
      lessons: slots.filter((s) => mine.has(s.group_id)).length,
      counts:  countProblems(classProblems(slots, ids)),
      pendingYard: picks.filter((p) => mine.has(p.group_id)
        && !roomsAt.get(hourKey(p.group_id, p.day, p.period))?.has(p.room_id)).length,
    };
  });
}

/** ห้องที่มีปัญหาอยู่ตอนนี้ — ติ๊กไว้ให้ตั้งแต่เปิด */
export function defaultTicks(list: RepairClass[]): Set<number> {
  return new Set(list.filter((c) => c.counts.lessons > 0).map((c) => c.id));
}

/**
 * รายการห้อง (รวมห้องย่อย) ที่จะส่งไปให้ตัวจัด — เรียงเลข ไม่ซ้ำ
 *
 * ว่างเมื่อไม่ได้ติ๊กอะไร และ "ว่าง" ห้ามส่งเด็ดขาด: ตัวจัดอ่านรายการว่างว่า
 * ไม่ได้ขอแก้เฉพาะห้อง แล้วจัดใหม่ทั้งโรงเรียน
 */
export function idsToSend(list: RepairClass[], ticked: Set<number>): number[] {
  const out = new Set<number>();
  for (const c of list) if (ticked.has(c.id)) for (const id of c.ids) out.add(id);
  return [...out].sort((a, b) => a - b);
}

// ── เทียบตารางก่อน/หลัง ───────────────────────────────────────────────────

/**
 * คาบหนึ่งคือ "ใคร สอนอะไร ให้ห้องไหน วันไหน คาบไหน ที่ห้องอะไร" — ไม่ใช่เลข id
 * เพราะจัดใหม่อาจสร้างแถวใหม่แล้วเลขเปลี่ยน ทั้งที่คาบอยู่ที่เดิมทุกอย่าง
 */
const sigOf = (s: TimetableSlot) =>
  [s.group_id, s.subject_id ?? "-", s.teacher_id ?? "-", s.day, s.period, s.room_id ?? "-"].join("|");

function bucket(list: TimetableSlot[]): Map<string, TimetableSlot[]> {
  const m = new Map<string, TimetableSlot[]>();
  for (const s of list) {
    const k = sigOf(s);
    const arr = m.get(k);
    if (arr) arr.push(s);
    else m.set(k, [s]);
  }
  return m;
}

export interface Cell { day: number; period: number; room_id: number | null }

export interface LessonMove {
  group_id:   number;
  group_name: string | null;
  /** รหัสวิชา หรือชื่อวิชา ไว้บอกว่าคาบไหน */
  label:      string;
  /** null = เป็นคาบที่โผล่มาใหม่ */
  from: Cell | null;
  /** null = คาบนี้หายไป */
  to:   Cell | null;
  /** เมื่อช่องเดิมแต่คาบไม่ใช่คาบเดิม (เปลี่ยนครู/วิชา) */
  note?: string;
}

export interface OutsideCheck {
  /** คาบนอกห้องที่เลือกที่เอามาเทียบ (ก่อนจัด) */
  checked: number;
  /** คาบที่ไม่เหมือนเดิมทุกอย่าง — ควรเป็น 0 */
  changed: number;
  moves:   LessonMove[];
}

const cellOf = (s: TimetableSlot): Cell =>
  ({ day: s.day, period: s.period, room_id: s.room_id });

const labelOf = (s: TimetableSlot) =>
  s.subject_code || s.subject_name || (s.is_activity_block ? "กิจกรรม" : s.is_elective ? "วิชาเสรี" : "คาบ");

/**
 * คาบของห้องที่ "ไม่ได้เลือก" เหมือนเดิมทุกคาบไหม — วันเดียวกัน คาบเดียวกัน
 * ห้องเดิม ครูเดิม วิชาเดิม
 *
 * `inside` คือห้องที่เลือก (รวมห้องย่อย) ทุกอย่างนอกนั้นต้องไม่ขยับ
 */
export function outsideChanges(
  before: TimetableSlot[], after: TimetableSlot[], inside: Set<number>,
): OutsideCheck {
  const outB = before.filter((s) => !inside.has(s.group_id));
  const outA = after.filter((s) => !inside.has(s.group_id));
  const b = bucket(outB);
  const a = bucket(outA);

  const lost: TimetableSlot[] = [];
  const gained: TimetableSlot[] = [];
  for (const [k, list] of b) {
    for (let i = a.get(k)?.length ?? 0; i < list.length; i++) lost.push(list[i]);
  }
  for (const [k, list] of a) {
    for (let i = b.get(k)?.length ?? 0; i < list.length; i++) gained.push(list[i]);
  }

  // คาบที่หายกับคาบที่โผล่มา ที่เป็นคาบเดียวกัน = คาบนั้นถูกย้าย (หรือเปลี่ยนครู)
  // ไล่จับคู่จากแน่นอนสุดไปหลวมสุด ให้ "เปลี่ยนครูคาบเดียว" นับเป็นหนึ่ง ไม่ใช่สอง
  const sameLesson: Array<(x: TimetableSlot, y: TimetableSlot) => boolean> = [
    (x, y) => x.group_id === y.group_id && x.subject_id === y.subject_id && x.teacher_id === y.teacher_id,
    (x, y) => x.group_id === y.group_id && x.subject_id === y.subject_id,
    (x, y) => x.group_id === y.group_id && x.day === y.day && x.period === y.period,
  ];
  const moves: LessonMove[] = [];
  let restLost = lost;
  const restGained = [...gained];
  for (const same of sameLesson) {
    const stillLost: TimetableSlot[] = [];
    for (const l of restLost) {
      const at = restGained.findIndex((g) => same(l, g));
      if (at < 0) { stillLost.push(l); continue; }
      const g = restGained.splice(at, 1)[0];
      const from = cellOf(l), to = cellOf(g);
      const stayed = from.day === to.day && from.period === to.period && from.room_id === to.room_id;
      moves.push({
        group_id: l.group_id, group_name: l.group_name, label: labelOf(l), from, to,
        ...(stayed ? { note: "อยู่ช่องเดิม แต่เปลี่ยนครูหรือวิชา" } : {}),
      });
    }
    restLost = stillLost;
  }
  for (const l of restLost) {
    moves.push({
      group_id: l.group_id, group_name: l.group_name, label: labelOf(l), from: cellOf(l), to: null,
    });
  }
  for (const g of restGained) {
    moves.push({
      group_id: g.group_id, group_name: g.group_name, label: labelOf(g), from: null, to: cellOf(g),
    });
  }
  return { checked: outB.length, changed: moves.length, moves };
}

export interface LockedCheck {
  /** คาบที่ล็อกไว้ก่อนจัด */
  total: number;
  /** ที่ไม่ได้อยู่ที่เดิมแบบยังล็อกอยู่ — ควรเป็น 0 */
  moved: number;
}

/** คาบที่ล็อกไว้ ยังอยู่ที่เดิมและยังล็อกอยู่ทุกคาบไหม (ทุกห้อง ทั้งที่เลือกและไม่เลือก) */
export function lockedCheck(before: TimetableSlot[], after: TimetableSlot[]): LockedCheck {
  const left = new Map<string, number>();
  for (const s of after) {
    if (!s.is_locked) continue;
    const k = sigOf(s);
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  let total = 0, moved = 0;
  for (const s of before) {
    if (!s.is_locked) continue;
    total++;
    const k = sigOf(s);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else moved++;
  }
  return { total, moved };
}

/** ตัวเลขที่ตัวจัดรายงานว่าคาบนอกห้องที่เลือกขยับกี่คาบ — null เมื่อไม่ได้บอกมา */
export function reportedOutside(r: { repair_outside_changed?: unknown } | null | undefined): number | null {
  const n = r?.repair_outside_changed;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

// ── สรุปผลหลังแก้ ─────────────────────────────────────────────────────────

export type Trend = "ok" | "fixed" | "better" | "same" | "worse";

export function trendOf(before: ProblemCounts, after: ProblemCounts): Trend {
  if (after.lessons === 0) return before.lessons === 0 ? "ok" : "fixed";
  if (after.lessons < before.lessons)  return "better";
  if (after.lessons === before.lessons) return "same";
  return "worse";
}

export type Verdict = "fixed" | "partial" | "same" | "worse";

/**
 * ห้องที่เลือกเป็นอย่างไรโดยรวม — ไม่เคยพูดว่า "แก้เรียบร้อย" ถ้ายังมีคาบแดงเหลือ
 * ในห้องที่เลือกแม้แต่คาบเดียว
 */
export function verdictOf(
  o: Pick<RepairOutcome, "lessonsBefore" | "lessonsAfter" | "remaining">,
): Verdict {
  if (!o.remaining) return "fixed";
  if (o.lessonsAfter > o.lessonsBefore) return "worse";
  if (o.lessonsAfter < o.lessonsBefore) return "partial";
  return "same";
}

export interface ClassChange {
  id: number;
  name: string;
  before: ProblemCounts;
  after:  ProblemCounts;
  yardBefore: number;
  yardAfter:  number;
  trend: Trend;
}

export interface RepairOutcome {
  /** ห้องที่เลือก ก่อนและหลัง */
  changes: ClassChange[];
  lessonsBefore: number;
  lessonsAfter:  number;
  /** ห้อง (ในที่เลือก) ที่มีปัญหาอยู่ */
  classesBefore: number;
  classesAfter:  number;
  /** ลานที่เลือกไว้ในห้องที่แก้ — ก่อนแก้ยังไม่ตามกี่คาบ และหลังแก้ตารางตามแล้วกี่คาบ */
  yardBefore: number;
  yardMet:    number;
  /** ห้องที่ไม่ได้เลือก */
  othersCount: number;
  /** …และตอนนี้ยังมีปัญหาอยู่กี่ห้อง */
  othersWithProblems: number;
  outside: OutsideCheck;
  locked:  LockedCheck;
  /** ตัวจัดบอกว่าคาบนอกห้องที่เลือกขยับกี่คาบ (null = ไม่ได้บอก) */
  serverOutside: number | null;
  /** ตัวที่มากกว่าระหว่างที่ตัวจัดบอกกับที่เทียบเอง — ถ้าไม่ใช่ 0 คือปุ่มผิดสัญญา */
  outsideChanged: number;
  /** ห้องที่เลือกยังมีปัญหาค้างอยู่ */
  remaining: boolean;
}

export function summariseRepair(p: {
  groups: StudentGroup[];
  before: TimetableSlot[];
  after:  TimetableSlot[];
  picks?: PickRowLike[];
  /** id ของห้อง (ห้องหลัก) ที่ติ๊ก */
  ticked: Set<number>;
  serverOutside?: number | null;
}): RepairOutcome {
  const picks = p.picks ?? [];
  const listB = repairClassList(p.groups, p.before, picks);
  const listA = repairClassList(p.groups, p.after, picks);
  const afterOf = new Map(listA.map((c) => [c.id, c]));

  const chosen = listB.filter((c) => p.ticked.has(c.id));
  const changes: ClassChange[] = chosen.map((c) => {
    const a = afterOf.get(c.id);
    const after = a?.counts ?? NO_PROBLEMS;
    return {
      id: c.id, name: c.name,
      before: c.counts, after,
      yardBefore: c.pendingYard, yardAfter: a?.pendingYard ?? 0,
      trend: trendOf(c.counts, after),
    };
  });

  const inside = new Set<number>(chosen.flatMap((c) => c.ids));
  const outside = outsideChanges(p.before, p.after, inside);
  const serverOutside = p.serverOutside ?? null;

  return {
    changes,
    lessonsBefore: changes.reduce((n, c) => n + c.before.lessons, 0),
    lessonsAfter:  changes.reduce((n, c) => n + c.after.lessons, 0),
    classesBefore: changes.filter((c) => c.before.lessons > 0).length,
    classesAfter:  changes.filter((c) => c.after.lessons > 0).length,
    yardBefore: changes.reduce((n, c) => n + c.yardBefore, 0),
    yardMet:    changes.reduce((n, c) => n + Math.max(0, c.yardBefore - c.yardAfter), 0),
    othersCount: listB.length - chosen.length,
    othersWithProblems: listA.filter((c) => !p.ticked.has(c.id) && c.counts.lessons > 0).length,
    outside,
    locked: lockedCheck(p.before, p.after),
    serverOutside,
    outsideChanged: Math.max(outside.changed, serverOutside ?? 0),
    remaining: changes.some((c) => c.after.lessons > 0),
  };
}
