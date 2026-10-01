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
  const walk = (list: StudentGroup[]) => {
    for (const g of list) {
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
