/**
 * Who runs ลูกเสือ / เนตรนารี / ชุมนุม.
 *
 * The school picks a group — "ครูที่สอน ม.1–3", "ครูทั้งโรงเรียน" — and then
 * divides the หมู่ between themselves on the day. The timetable's job is only
 * to know whose hour it is, so what this file builds is the pool behind those
 * buttons, read out of who already teaches where.
 */
import type { LessonRequirement, StudentGroup, Teacher } from "../types";

export interface Affinity {
  /** teacher → the classes they already teach (sub-classes rolled up). */
  byGroup: Map<number, Set<number>>;
  /** level ("M1") → the teachers who teach anything in it. */
  byLevel: Map<string, Set<number>>;
}

/**
 * Read the teaching plan for who belongs where.
 *
 * Sub-classes are rolled up to the class above: a teacher who takes ม.4/6ก
 * belongs with ม.4/6, which is the class an activity is pinned onto.
 */
export function buildAffinity(
  reqs: LessonRequirement[],
  flat: StudentGroup[],
): Affinity {
  const root = new Map<number, number>();
  const level = new Map<number, string>();
  for (const g of flat) {
    root.set(g.id, g.parent_id ?? g.id);
    level.set(g.id, g.level ?? "");
  }
  const byGroup = new Map<number, Set<number>>();
  const byLevel = new Map<string, Set<number>>();
  const add = (map: Map<number, Set<number>>, k: number, v: number) => {
    const s = map.get(k) ?? new Set<number>();
    s.add(v); map.set(k, s);
  };
  for (const r of reqs) {
    const g = root.get(r.group_id) ?? r.group_id;
    const lv = level.get(r.group_id) ?? level.get(g) ?? "";
    // สอนร่วม means both of them know the class, not just the first.
    for (const t of [r.teacher_id, r.co_teacher_id]) {
      if (!t) continue;
      add(byGroup, t, g);
      const s = byLevel.get(lv) ?? new Set<number>();
      s.add(t); byLevel.set(lv, s);
    }
  }
  return { byGroup, byLevel };
}

/** Every teacher who teaches anything in the levels these classes belong to. */
export function teachersOfLevels(
  classIds: number[],
  flat: StudentGroup[],
  affinity: Affinity,
): number[] {
  const levels = new Set(
    classIds.map((id) => flat.find((g) => g.id === id)?.level ?? ""),
  );
  const out = new Set<number>();
  for (const lv of levels) for (const t of affinity.byLevel.get(lv) ?? []) out.add(t);
  return [...out];
}

/** A teacher's display name, falling back to the id so nothing renders blank. */
export function nameOf(teachers: Teacher[], id: number): string {
  return teachers.find((t) => t.id === id)?.name ?? String(id);
}
