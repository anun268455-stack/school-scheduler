/**
 * Who watches which class during ลูกเสือ / เนตรนารี / ชุมนุม.
 *
 * The school says "ครูทั้งหมด" or "ครูที่สอนระดับชั้นนั้น" and means something
 * very reasonable: everyone is on duty that period. What it does NOT mean is
 * that every teacher stands with every class — one teacher cannot watch ม.1/1
 * and ม.1/2 at the same time, and a roster that says so is a roster that puts
 * the same name in twelve cells of one column.
 *
 * So a bulk choice is a pool of teachers to be DEALT OUT across the chosen
 * classes, one class each, preferring a class they already teach so the name
 * beside ม.1/4 is a face those students know.
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

/**
 * Deal a pool of teachers across classes, at most one class each.
 *
 * Most-constrained first: a teacher who only teaches one of the chosen classes
 * is placed before one who could go anywhere, or the flexible teachers fill
 * the easy classes and the constrained one is left with nowhere to go.
 */
export function spreadTeachers(
  classIds: number[],
  pool: number[],
  affinity: Affinity,
): Map<number, number[]> {
  const out = new Map<number, number[]>(classIds.map((c) => [c, []]));
  if (!classIds.length) return out;
  const place = new Map<number, number>(classIds.map((c, i) => [c, i]));

  const optionsFor = (t: number) => {
    const mine = affinity.byGroup.get(t);
    const fits = mine ? classIds.filter((c) => mine.has(c)) : [];
    // Nobody's own class among these → they can stand anywhere.
    return fits.length ? fits : classIds;
  };

  const order = [...new Set(pool)].sort((a, b) => {
    const d = optionsFor(a).length - optionsFor(b).length;
    return d !== 0 ? d : a - b;
  });

  // A fair share, rounded up. Preferring a teacher's own class is only worth
  // so much: ม.1/1 having six teachers it knows while ม.1/3 has one is not a
  // better roster, it is the same uncovered class with extra steps. Once a
  // class is full, the next teacher goes where they are actually needed.
  const share = Math.max(1, Math.ceil(order.length / classIds.length));
  const emptiest = (from: number[]) => {
    let best = from[0];
    for (const c of from) {
      const n = out.get(c)!.length, m = out.get(best)!.length;
      if (n < m || (n === m && place.get(c)! < place.get(best)!)) best = c;
    }
    return best;
  };

  for (const t of order) {
    const wanted = optionsFor(t).filter((c) => out.get(c)!.length < share);
    out.get(emptiest(wanted.length ? wanted : classIds))!.push(t);
  }
  return out;
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

/** Teachers named in more than one class of the same activity period. */
export function doubleBooked(roster: Map<number, number[]>): Map<number, number[]> {
  const where = new Map<number, number[]>();
  for (const [gid, ids] of roster) {
    for (const t of ids) where.set(t, [...(where.get(t) ?? []), gid]);
  }
  return new Map([...where].filter(([, v]) => v.length > 1));
}

/** A teacher's display name, falling back to the id so nothing renders blank. */
export function nameOf(teachers: Teacher[], id: number): string {
  return teachers.find((t) => t.id === id)?.name ?? String(id);
}
