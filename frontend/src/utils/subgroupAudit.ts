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
import type { LessonRequirement, StudentGroup, Subject, Teacher, TimetableSlot } from "../types";

export interface SubgroupCellEntry {
  groupId:   number;
  groupName: string;
  /** null when this subgroup has nothing in this hour. */
  slot: TimetableSlot | null;
  /**
   * ทำไมช่องนี้ว่าง เมื่อชั่วโมงนี้เป็นชั่วโมงของเซ็ตห้องย่อย
   *
   * "ฉันตั้งค่าแล้วแต่ทำไมไม่เห็นอัปเดตข้อมูลเลย"
   *
   * ช่องว่างในเซ็ตมีอยู่สองแบบที่หน้าตานี่เหมือนกันเป๊ะ — ห้องย่อยที่ได้คาบครบ
   * ตามแผนแล้วจึงนั่งพัก (ปกติ โรงเรียนตั้งใจ) กับห้องย่อยที่เซ็ตลงให้ไม่ได้
   * (ต้องไปแก้) เดิมทั้งสองขึ้นคำเดียวกันว่า "ขาด ม.4/6ก — เรียน 2/3 ห้อง"
   * จึงไม่มีทางรู้ว่าอันไหนเป็นอันไหน
   */
  note?: string;
}

/** หนึ่งแถวของเซ็ตห้องย่อย: ห้องย่อยนี้เรียนวิชานี้กี่คาบ และลงไปได้แล้วกี่คาบ */
export interface SubgroupSetRow {
  groupId:     number;
  groupName:   string;
  subjectId:   number | null;
  subjectName: string;
  teacherName: string;
  /** คาบ/สัปดาห์ ที่แผนการสอนบอกไว้ */
  want: number;
  /** คาบของเซ็ตนี้ที่อยู่ในตารางแล้ว */
  got:  number;
}

/**
 * เซ็ตห้องย่อยหนึ่งเซ็ต เทียบ "ที่ตั้งไว้" กับ "ที่อยู่ในตารางจริง"
 *
 * หน้าตรวจคาบจริงเดิมอ่านแต่ตาราง ไม่เคยอ่านเซ็ตที่โรงเรียนตั้งไว้เลย — เซ็ตที่
 * ลงไม่ได้เลยจึงไม่ปรากฏตัวที่ไหนทั้งนั้น ไม่ใช่ขึ้นว่าผิด แต่หายไปเงียบ ๆ
 */
export interface SubgroupSet {
  key:  string;
  rows: SubgroupSetRow[];
  /** ชั่วโมงที่เซ็ตนี้ลงอยู่ในตาราง */
  hours: { day: number; period: number; busy: number }[];
  /** วัน/คาบที่โรงเรียนล็อกไว้ให้เซ็ตนี้ ถ้ามี */
  pinned: { day: number; period: number } | null;
  /** คาบที่ยังขาด รวมทุกแถว */
  short: number;
  /** ยังไม่มีคาบของเซ็ตนี้ในตารางเลย — ต้องกดสร้างตารางก่อน */
  missing: boolean;
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
  /** เซ็ตห้องย่อยที่ตั้งไว้สำหรับชั้นนี้ — ว่างเมื่อไม่ได้ส่งแผนการสอนมา */
  sets: SubgroupSet[];
}

/** แผนการสอน รายวิชา และครู ที่ทำให้ตรวจเทียบกับเซ็ตที่ตั้งไว้ได้ */
export interface AuditSources {
  requirements?: LessonRequirement[];
  subjects?:     Subject[];
  teachers?:     Teacher[];
}

const flatten = (groups: StudentGroup[]): StudentGroup[] =>
  groups.flatMap((g) => [g, ...(g.children ?? [])]);

/** Does this cell hold a real mistake, as opposed to an uneven hour? */
export function cellHasProblem(c: SubgroupCell): boolean {
  return !!c.parentSlot || c.roomClashes.length > 0
      || c.teacherClashes.length > 0 || c.roomSplits.length > 0;
}

/**
 * เซ็ตห้องย่อยที่ตั้งไว้ของชั้นนี้ เทียบกับตารางที่ออกมา
 *
 * นับคาบของเซ็ตจาก parallel_group_key ที่คาบในตารางพาติดตัวมา ไม่ใช่จากการเดา
 * จากวัน/คาบ — คาบที่โรงเรียนลากไปวางเองก็ยังเป็นคาบของเซ็ตนั้น
 */
function setsOf(
  subs: StudentGroup[], slots: TimetableSlot[], src: AuditSources,
): SubgroupSet[] {
  const reqs = src.requirements ?? [];
  if (reqs.length === 0) return [];
  const subIds = new Set(subs.map((g) => g.id));
  const subName = new Map(subs.map((g) => [g.id, g.name]));
  const sName = new Map((src.subjects ?? []).map((s) => [s.id,
    s.code ? `${s.code} ${s.name ?? ""}`.trim() : (s.name ?? `วิชา ${s.id}`)]));
  const tName = new Map((src.teachers ?? []).map((t) => [t.id, t.name]));

  const byKey = new Map<string, LessonRequirement[]>();
  for (const r of reqs) {
    if (!r.parallel_group_key || !subIds.has(r.group_id)) continue;
    const list = byKey.get(r.parallel_group_key) ?? [];
    list.push(r);
    byKey.set(r.parallel_group_key, list);
  }

  const out: SubgroupSet[] = [];
  for (const [key, list] of byKey) {
    const mine = slots.filter((s) => s.parallel_group_key === key
      && subIds.has(s.group_id));
    const rows: SubgroupSetRow[] = list.map((r) => ({
      groupId:   r.group_id,
      groupName: subName.get(r.group_id) ?? `ห้อง ${r.group_id}`,
      subjectId: r.subject_id ?? null,
      subjectName: sName.get(r.subject_id) ?? `วิชา ${r.subject_id}`,
      // ครู 0 = ยังไม่ได้เลือก และแถวนั้นจะไม่ถูกลงเลย ซึ่งเป็นคำตอบที่ตรงที่สุด
      // ของ "ทำไมเซ็ตนี้ไม่ลง" จึงพูดออกมาตรงๆ แทนที่จะโชว์ช่องว่าง
      teacherName: r.teacher_id ? (tName.get(r.teacher_id) ?? `ครู ${r.teacher_id}`)
        : "ยังไม่ได้เลือกครู",
      want: r.weekly_count ?? 0,
      got: mine.filter((s) => s.group_id === r.group_id
        && s.subject_id === r.subject_id).length,
    }));
    const hourKeys = new Map<string, number>();
    for (const s of mine) {
      const k = `${s.day}-${s.period}`;
      hourKeys.set(k, (hourKeys.get(k) ?? 0) + 1);
    }
    const pin = list.find((r) => r.pinned_day != null && r.pinned_period != null);
    out.push({
      key, rows,
      hours: [...hourKeys].map(([k, busy]) => {
        const [day, period] = k.split("-").map(Number);
        return { day, period, busy };
      }).sort((a, b) => a.day - b.day || a.period - b.period),
      pinned: pin ? { day: pin.pinned_day as number, period: pin.pinned_period as number } : null,
      short: rows.reduce((n, r) => n + Math.max(0, r.want - r.got), 0),
      missing: mine.length === 0,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key, "th", { numeric: true }));
}

export function auditSubgroups(
  groups: StudentGroup[], slots: TimetableSlot[], parentId: number,
  src: AuditSources = {},
): SubgroupAudit | null {
  const parent = flatten(groups).find((g) => g.id === parentId);
  if (!parent) return null;
  const subs = [...(parent.children ?? [])].sort(
    (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "th", { numeric: true }));
  if (subs.length === 0) return null;

  const subIds = new Set(subs.map((g) => g.id));
  const sets = setsOf(subs, slots, src);
  // Both halves of a double are real hours of the week, so neither is hidden.
  const mine = slots.filter((s) => subIds.has(s.group_id));
  const parentSlots = slots.filter((s) => s.group_id === parentId);

  const keys = new Set<string>();
  for (const s of mine) keys.add(`${s.day}-${s.period}`);

  const cells: SubgroupCell[] = [];
  for (const k of keys) {
    const [day, period] = k.split("-").map(Number);
    // เซ็ตที่เป็นเจ้าของชั่วโมงนี้ — มีได้อย่างมากหนึ่งเซ็ต เพราะทั้งเซ็ตนั่งชั่วโมงเดียว
    const owner = sets.find((x) => x.hours.some((h) => h.day === day && h.period === period));
    const entries: SubgroupCellEntry[] = subs.map((g) => {
      const slot = mine.find((s) => s.group_id === g.id
        && s.day === day && s.period === period) ?? null;
      if (slot || !owner) return { groupId: g.id, groupName: g.name, slot };
      const row = owner.rows.find((r) => r.groupId === g.id);
      const note = row == null
        ? "ไม่ได้อยู่ในเซ็ตนี้"
        : row.got >= row.want
          ? `ครบ ${row.want} คาบตามแผนแล้ว`
          : `ยังขาด ${row.want - row.got} คาบ — เซ็ตนี้ลงให้ไม่ได้`;
      return { groupId: g.id, groupName: g.name, slot, note };
    });
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
    parentId, parentName: parent.name, subgroups: subs, cells, sets,
    fullCount:    cells.filter((c) => c.busy === subs.length).length,
    partialCount: cells.filter((c) => c.busy > 0 && c.busy < subs.length).length,
    problemCount: cells.filter(cellHasProblem).length,
  };
}

/** Every split class, audited — the view the school opens after generating. */
export function auditAll(
  groups: StudentGroup[], slots: TimetableSlot[], src: AuditSources = {},
): SubgroupAudit[] {
  return flatten(groups)
    .filter((g) => (g.children ?? []).length > 0)
    .map((g) => auditSubgroups(groups, slots, g.id, src))
    .filter((a): a is SubgroupAudit => a !== null)
    .sort((a, b) => a.parentName.localeCompare(b.parentName, "th", { numeric: true }));
}
