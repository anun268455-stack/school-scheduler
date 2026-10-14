/**
 * What the subgroups of a class are actually doing, hour by hour.
 *
 * Once a timetable exists, the question is no longer "what did we ask for"
 * but "what did we get": in this hour ก is at maths and ข is at English, in
 * that one only ค has a lesson and the other two are free. The school wants
 * to read that off a page and decide whether it is right.
 *
 * Deliberately not a rule. A subgroup lesson standing on its own is a normal
 * thing — ค takes a language the others do not — and flagging it as an error
 * would bury the two cases that really are wrong:
 *
 *   ชนกับห้องแม่   the whole class has a lesson in the same hour, so those
 *                  students are in two rooms at once
 *   ห้องสอนซ้ำ     two subgroups sent to the same room at the same time
 *   ครูซ้ำ         one teacher expected in two of them at once
 *
 * Everything else is reported as fact and left to the school.
 */
import type { StudentGroup, TimetableSlot } from "../types";

export interface SubgroupCellEntry {
  groupId:   number;
  groupName: string;
  /** null when this subgroup has nothing in this hour. */
  slot: TimetableSlot | null;
}

export interface SubgroupCell {
  day:     number;
  period:  number;
  entries: SubgroupCellEntry[];
  /** How many subgroups have a lesson here. */
  busy:    number;
  /** The lesson the parent class itself has here, if any — a real clash. */
  parentSlot: TimetableSlot | null;
  /** Rooms used by more than one subgroup at once. */
  roomClashes:    string[];
  /** Teachers expected in more than one subgroup at once. */
  teacherClashes: string[];
  /**
   * หนึ่งคาบที่ถูกแยกห้อง — ห้องย่อยที่เรียนวิชาเดียวกันกับครูคนเดียวกัน
   * ควรนั่งห้องเดียวกัน ถ้าคนละห้องแปลว่าครูต้องยืนสองที่
   */
  roomSplits: string[];
}

export interface SubgroupAudit {
  parentId:   number;
  parentName: string;
  subgroups:  StudentGroup[];
  /** Hours where at least one subgroup has a lesson, in week order. */
  cells:      SubgroupCell[];
  /** Hours where every subgroup is busy. */
  fullCount:  number;
  /** Hours where some are busy and some are free — normal, worth seeing. */
  partialCount: number;
  /** Hours with something genuinely wrong. */
  problemCount: number;
}

const flatten = (groups: StudentGroup[]): StudentGroup[] =>
  groups.flatMap((g) => [g, ...(g.children ?? [])]);

/** Does this cell hold a real mistake, as opposed to an uneven hour? */
export function cellHasProblem(c: SubgroupCell): boolean {
  return !!c.parentSlot || c.roomClashes.length > 0
      || c.teacherClashes.length > 0 || c.roomSplits.length > 0;
}

export function auditSubgroups(
  groups: StudentGroup[], slots: TimetableSlot[], parentId: number,
): SubgroupAudit | null {
  const parent = flatten(groups).find((g) => g.id === parentId);
  if (!parent) return null;
  const subs = [...(parent.children ?? [])].sort(
    (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "th", { numeric: true }));
  if (subs.length === 0) return null;

  const subIds = new Set(subs.map((g) => g.id));
  // Both halves of a double are real hours of the week, so neither is hidden.
  const mine = slots.filter((s) => subIds.has(s.group_id));
  const parentSlots = slots.filter((s) => s.group_id === parentId);

  const keys = new Set<string>();
  for (const s of mine) keys.add(`${s.day}-${s.period}`);

  const cells: SubgroupCell[] = [];
  for (const k of keys) {
    const [day, period] = k.split("-").map(Number);
    const entries: SubgroupCellEntry[] = subs.map((g) => ({
      groupId: g.id,
      groupName: g.name,
      slot: mine.find((s) => s.group_id === g.id && s.day === day && s.period === period) ?? null,
    }));
    const here = entries.map((e) => e.slot).filter((s): s is TimetableSlot => !!s);

    // ห้องย่อยที่เรียนวิชาเดียวกันกับครูคนเดียวกัน = คาบเดียวกัน ไม่ใช่สองคาบ.
    //
    // "มีการแจ้งเตือนห้องซ้ำแบบนี้ ถ้าไม่มีผลต่อระบบไม่ต้องแก้ไข" — ข กับ ค
    // ที่เรียน ค31218 กับครูศศิกัลป์พร้อมกัน นั่งห้องเดียวกันอยู่แล้ว ครูคนเดียว
    // สอนทีเดียว จึงไม่ใช่ความผิดพลาด สิ่งที่ยังผิดจริงคือครูคนเดียวกันอยู่ใน
    // "คาบคนละคาบ" พร้อมกัน หรือห้องเดียวถูกใช้โดยคาบที่ต่างกันสองคาบ
    // A lesson with no subject recorded is its own lesson — never folded in
    // with another one just because neither says what it is.
    const unitOf = (s: TimetableSlot) =>
      (s.subject_id == null ? `one:${s.id}` : `${s.subject_id}:${s.teacher_id ?? 0}`);

    const seen = (key: (s: TimetableSlot) => string | null) => {
      const m = new Map<string, Set<string>>();
      for (const s of here) {
        const k = key(s);
        if (k == null) continue;
        const set = m.get(k) ?? new Set<string>();
        set.add(unitOf(s));
        m.set(k, set);
      }
      return [...m].filter(([, units]) => units.size > 1).map(([name]) => name);
    };

    // คาบเดียวกันแต่ถูกแยกห้อง — ครูคนเดียวยืนสองห้องไม่ได้ จึงยังเป็นปัญหา
    const split = new Map<string, Set<number | string>>();
    for (const s of here) {
      if (!s.teacher_id) continue;
      const set = split.get(unitOf(s)) ?? new Set<number | string>();
      set.add(s.room_id ?? "—");
      split.set(unitOf(s), set);
    }
    const roomSplits = [...split]
      .filter(([u, roomIds]) => roomIds.size > 1
        && here.filter((s) => unitOf(s) === u).length > 1)
      .map(([u]) => {
        const s = here.find((x) => unitOf(x) === u)!;
        return s.teacher_name ?? String(s.teacher_id);
      });

    cells.push({
      day, period, entries, busy: here.length,
      parentSlot: parentSlots.find((s) => s.day === day && s.period === period) ?? null,
      roomClashes:    seen((s) => (s.room_id == null
        ? null : s.room_name ?? String(s.room_id))),
      teacherClashes: seen((s) => (s.teacher_id == null
        ? null : s.teacher_name ?? String(s.teacher_id))),
      roomSplits,
    });
  }

  cells.sort((a, b) => a.day - b.day || a.period - b.period);
  return {
    parentId, parentName: parent.name, subgroups: subs, cells,
    fullCount:    cells.filter((c) => c.busy === subs.length).length,
    partialCount: cells.filter((c) => c.busy > 0 && c.busy < subs.length).length,
    problemCount: cells.filter(cellHasProblem).length,
  };
}

/** Every split class, audited — the view the school opens after generating. */
export function auditAll(
  groups: StudentGroup[], slots: TimetableSlot[],
): SubgroupAudit[] {
  return flatten(groups)
    .filter((g) => (g.children ?? []).length > 0)
    .map((g) => auditSubgroups(groups, slots, g.id))
    .filter((a): a is SubgroupAudit => a !== null)
    .sort((a, b) => a.parentName.localeCompare(b.parentName, "th", { numeric: true }));
}
