/**
 * ชุดเรียนพร้อมกัน — what the subgroups of one class do in the same hour.
 *
 * A class that splits into ก/ข/ค does not split evenly across subjects. In
 * one hour ก is at maths, ข is at English and ค is at computing; in another,
 * ก and ข are both at computing and ค is somewhere else entirely. The school
 * calls each of these arrangements a เซ็ต, and the point of a เซ็ต is that
 * its lessons must land on the SAME period — the students are one class being
 * taught three things at once, not three classes with their own timetables.
 *
 * The timetable already has the mechanism: requirements sharing a
 * parallel_group_key are placed together by the solver. What it did not have
 * was a way to say it, so this reads and writes those keys as sets.
 *
 * A set need not cover every subgroup. "ก and ข have this, ค does not" is an
 * ordinary thing for a school to want and the commonest reason to open the
 * dialog at all.
 */
import type { LessonRequirement, StudentGroup } from "../types";

export interface SetRow {
  /** The requirement this row came from, if it is already saved. */
  requirementId?: number;
  groupId:   number;
  subjectId: number;
  /** 0 = ยังไม่ได้เลือกครู, which is allowed: a เซ็ต is about subjects. */
  teacherId: number;
  weekly:    number;
  /** ห้องเรียนที่ล็อกไว้สำหรับห้องย่อยนี้ — 0 = ให้ระบบจัดห้องตามปกติ. */
  roomId?:   number;
}

export interface SubgroupSet {
  /** วัน/คาบที่ล็อกไว้ — null = ปล่อยให้ตัวจัดตารางเลือกเอง. */
  day?:     number | null;
  period?:  number | null;
  /** คาบคู่ — เซ็ตนี้กิน 2 คาบติดกัน เช่น "ศุกร์ คาบ 3-4". */
  double?:  boolean;
  /** parallel_group_key — the thing that actually ties the lessons together. */
  key:      string;
  /** The parent class whose subgroups these are. */
  parentId: number;
  /** What the school called it: "เซ็ต A". Carried inside the key. */
  name:     string;
  rows:     SetRow[];
}

const PREFIX = "SET";

/** "SET:12:เซ็ต A" — the parent and the name, so both survive a reload. */
export function makeSetKey(parentId: number, name: string): string {
  return `${PREFIX}:${parentId}:${name.trim() || "ไม่มีชื่อ"}`;
}

export function parseSetKey(key: string): { parentId: number; name: string } | null {
  const m = /^SET:(\d+):([\s\S]*)$/.exec(key);
  return m ? { parentId: Number(m[1]), name: m[2] } : null;
}

/** Every class, parents and subgroups alike, as one flat list. */
function flatten(groups: StudentGroup[]): StudentGroup[] {
  return groups.flatMap((g) => [g, ...(g.children ?? [])]);
}

/** The subgroups of a class, in name order. Empty for a class that has none. */
export function subgroupsOf(groups: StudentGroup[], parentId: number): StudentGroup[] {
  const parent = flatten(groups).find((g) => g.id === parentId);
  return [...(parent?.children ?? [])].sort(
    (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "th", { numeric: true }));
}

/** Classes that are split into ก/ข/ค, which are the only ones sets apply to. */
export function classesWithSubgroups(groups: StudentGroup[]): StudentGroup[] {
  return groups
    .filter((g) => (g.children ?? []).length > 0)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "th", { numeric: true }));
}

/**
 * The sets already saved, read back out of the requirements.
 *
 * Only keys this dialog wrote are returned. A school may have parallel keys
 * from the staffing import — two whole classes doing PE together, say — and
 * those are not subgroup sets; showing them here would invite someone to
 * "fix" a pairing they did not make.
 */
export function readSets(
  requirements: LessonRequirement[], parentId?: number,
): SubgroupSet[] {
  const by = new Map<string, SubgroupSet>();
  for (const r of requirements) {
    const key = r.parallel_group_key;
    if (!key) continue;
    const parsed = parseSetKey(key);
    if (!parsed) continue;
    if (parentId != null && parsed.parentId !== parentId) continue;
    const cur = by.get(key) ?? { key, parentId: parsed.parentId, name: parsed.name, rows: [] };
    cur.rows.push({
      requirementId: r.id, groupId: r.group_id, subjectId: r.subject_id,
      teacherId: r.teacher_id ?? 0, weekly: r.weekly_count ?? 1,
      roomId: r.room_id ?? 0,
    });
    // วัน/คาบที่ล็อกไว้เป็นของทั้งเซ็ต — ทุกแถวเรียนพร้อมกันอยู่แล้ว
    if (r.pinned_day != null && cur.day == null) {
      cur.day = r.pinned_day; cur.period = r.pinned_period ?? null;
      cur.double = !!r.pinned_double;
    }
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "th", { numeric: true }));
}

/**
 * What is wrong with a set, in the school's words. Empty means it is fine.
 *
 * These are the mistakes that produce a timetable nobody can teach, so they
 * are caught here rather than discovered when a class turns up twice.
 */
export function setProblems(
  rows: SetRow[], nameOf: (id: number) => string,
): string[] {
  const out: string[] = [];
  const seen = new Map<number, number>();
  for (const r of rows) {
    if (!r.groupId) { out.push("มีแถวที่ยังไม่ได้เลือกห้องย่อย"); continue; }
    seen.set(r.groupId, (seen.get(r.groupId) ?? 0) + 1);
  }
  for (const [gid, n] of seen) {
    if (n > 1) {
      out.push(`${nameOf(gid)} อยู่ในเซ็ตนี้ ${n} แถว — `
        + "ห้องเดียวเรียนสองวิชาพร้อมกันไม่ได้");
    }
  }
  if (rows.some((r) => !r.subjectId)) out.push("มีแถวที่ยังไม่ได้เลือกวิชา");
  // ครูไม่บังคับ. A เซ็ต says which subjects the subgroups take at the same
  // hour, and the school often settles that before it knows who teaches
  // what. The row is saved without a teacher and the จัดห้อง/ครู screen
  // fills it in later; until then the lesson is reported as having no
  // teacher rather than being placed with nobody in the room.
  const teachers = new Map<number, number>();
  for (const r of rows) {
    if (r.teacherId) teachers.set(r.teacherId, (teachers.get(r.teacherId) ?? 0) + 1);
  }
  for (const [, n] of teachers) {
    if (n > 1) {
      out.push("ครูคนเดียวกันสอนสองห้องย่อยในเซ็ตนี้ — "
        + "ทุกวิชาในเซ็ตเรียนพร้อมกัน ครูจึงต้องไม่ซ้ำกัน");
      break;
    }
  }
  const weeks = new Set(rows.map((r) => r.weekly));
  if (weeks.size > 1) {
    out.push(`คาบ/สัปดาห์ไม่เท่ากัน (${[...weeks].sort((a, b) => a - b).join(", ")}) — `
      + "ทุกวิชาในเซ็ตเรียนพร้อมกัน จึงต้องมีจำนวนคาบเท่ากัน");
  }
  return out;
}

/**
 * The writes that turn an edited set into saved requirements.
 *
 * Returned rather than performed, so the caller can show what will happen and
 * so this is testable without a server. Rows that did not change are left
 * alone: rewriting a requirement that nobody touched would churn the ids that
 * the timetable's own lessons point at.
 */
export interface SetPlan {
  create: { group_id: number; subject_id: number; teacher_id: number;
            weekly_count: number; parallel_group_key: string;
            room_id: number | null;
            pinned_day: number | null; pinned_period: number | null;
            pinned_double: boolean }[];
  update: { id: number; patch: Partial<LessonRequirement> }[];
  remove: number[];
}

export function planSetSave(
  key: string, rows: SetRow[], existing: SetRow[],
  /** วัน/คาบที่ล็อกไว้ทั้งเซ็ต — null = ไม่ล็อก */
  when?: { day: number | null; period: number | null; double?: boolean },
): SetPlan {
  const plan: SetPlan = { create: [], update: [], remove: [] };
  const was = new Map(existing.filter((r) => r.requirementId != null)
    .map((r) => [r.requirementId!, r]));
  const keptIds = new Set<number>();

  for (const r of rows) {
    if (!r.groupId || !r.subjectId) continue;        // ครูเว้นว่างได้
    const old = r.requirementId != null ? was.get(r.requirementId) : undefined;
    if (!old) {
      plan.create.push({
        group_id: r.groupId, subject_id: r.subjectId,
        teacher_id: r.teacherId || 0,
        weekly_count: r.weekly, parallel_group_key: key,
        room_id: r.roomId || null,
        pinned_day: when?.day ?? null, pinned_period: when?.period ?? null,
        pinned_double: !!when?.double,
      });
      continue;
    }
    keptIds.add(r.requirementId!);
    const patch: Partial<LessonRequirement> = {};
    if (old.groupId !== r.groupId) patch.group_id = r.groupId;
    if (old.subjectId !== r.subjectId) patch.subject_id = r.subjectId;
    if (old.teacherId !== r.teacherId) patch.teacher_id = r.teacherId || 0;
    if (old.weekly !== r.weekly) patch.weekly_count = r.weekly;
    if ((old.roomId ?? 0) !== (r.roomId ?? 0)) patch.room_id = r.roomId || null;
    if (when) {
      patch.pinned_day = when.day; patch.pinned_period = when.period;
      patch.pinned_double = !!when.double;
    }
    if (Object.keys(patch).length > 0) plan.update.push({ id: r.requirementId!, patch });
  }

  for (const id of was.keys()) if (!keptIds.has(id)) plan.remove.push(id);
  return plan;
}
