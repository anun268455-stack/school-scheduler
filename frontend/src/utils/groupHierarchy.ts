/**
 * groupHierarchy.ts — subgroup (ห้องย่อย) student-sharing logic.
 *
 * A subgroup like ม.4/6ก shares all its students with the parent whole-class
 * ม.4/6. So a parent lesson and any subgroup lesson cannot run at the same time
 * (a student can't be in two places), but sibling subgroups ก/ข/ค CAN run
 * simultaneously because they are different students.
 *
 * Two groups "share students" iff they are equal, or one is an ancestor of the
 * other. Siblings do NOT share students.
 */
import type { StudentGroup } from "../types";

export function flattenGroups(groups: StudentGroup[]): StudentGroup[] {
  const out: StudentGroup[] = [];
  // Ordered as a person reads class numbers, so every list and picker built on
  // this agrees — and ม.1/10 stops coming between ม.1/1 and ม.1/2.
  const walk = (list: StudentGroup[]) => {
    for (const g of [...list].sort((a, b) => compareNames(a.name, b.name))) {
      out.push(g);
      if (g.children?.length) walk(g.children);
    }
  };
  walk(groups);
  return out;
}

export type SharesStudents = (a: number, b: number) => boolean;

/** Build a fast `sharesStudents(a, b)` predicate from the nested group tree. */
export function buildSharesStudents(groups: StudentGroup[]): SharesStudents {
  const parent = new Map<number, number | null>();
  for (const g of flattenGroups(groups)) parent.set(g.id, g.parent_id ?? null);

  const ancestors = (id: number): Set<number> => {
    const out = new Set<number>();
    let cur = parent.get(id) ?? null;
    while (cur != null && !out.has(cur)) {
      out.add(cur);
      cur = parent.get(cur) ?? null;
    }
    return out;
  };

  return (a, b) => {
    if (a === b) return true;
    return ancestors(a).has(b) || ancestors(b).has(a);
  };
}

/** Default predicate used when no hierarchy is supplied: strict equality only. */
export const strictShares: SharesStudents = (a, b) => a === b;

/**
 * Compare two class names the way a person reads them.
 *
 * Plain string comparison orders ม.1/10 before ม.1/2, because "1" sorts before
 * "2" one character at a time. That is how the printed stack of 93 timetables
 * came out, and how every class picker was ordered. Comparing the numbers
 * inside the names as numbers fixes it, and keeps ก/ข/ค subgroups after their
 * parent.
 */
export function compareNames(a: string, b: string): number {
  const parts = (s: string) => s.split(/(\d+)/).filter(Boolean);
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x), ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x.localeCompare(y, "th");
    }
  }
  return 0;
}
