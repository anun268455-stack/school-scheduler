/**
 * ครูประจำชั้น — a class may have two of them.
 *
 * Reading goes through here rather than touching the field, because rows
 * arrive in two shapes: the list, and the single id that older rows and older
 * backup files carry. Every caller that reads the raw field is a place the
 * second teacher silently disappears.
 */
import type { StudentGroup, Teacher } from "../types";

/**
 * How many ครูประจำชั้น a class may have.
 *
 * Two at first, because that is what the school asked for. Three now: the
 * bigger classes here are advised by a team, and a list that could only hold
 * two left the third advisor off the printed sheet — which is where parents
 * read who to ask.
 */
export const HOMEROOM_MAX = 3;

export function homeroomIds(g: StudentGroup | null | undefined): number[] {
  if (!g) return [];
  const raw = Array.isArray(g.homeroom_teacher_ids)
    ? g.homeroom_teacher_ids
    : g.homeroom_teacher_id ? [g.homeroom_teacher_id] : [];
  const out: number[] = [];
  for (const x of raw) {
    const n = Number(x);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out.slice(0, HOMEROOM_MAX);
}

/** Their names, for a table cell or a printed sheet. */
export function homeroomNames(
  g: StudentGroup | null | undefined,
  teachers: Teacher[],
  short?: (name: string) => string,
): string[] {
  return homeroomIds(g)
    .map((id) => teachers.find((t) => t.id === id)?.name)
    .filter((n): n is string => !!n)
    .map((n) => (short ? short(n) : n));
}

/** Every class this teacher advises. */
export function classesAdvisedBy(teacherId: number, groups: StudentGroup[]): StudentGroup[] {
  return groups.filter((g) => homeroomIds(g).includes(teacherId));
}

// ── Families: a class and the sub-classes split out of it ───────────────────
//
// ม.4/6 is one roomful of students; ม.4/6ก, ข and ค are that same roomful
// divided up for their electives. They have one ครูประจำชั้น between them,
// because they are one class. So the advisors are recorded on the parent and
// the sub-classes follow it, rather than each being set — and kept in step —
// by hand.

/** The class an advisor is actually recorded on: this one, or its parent. */
export function familyRootId(
  group: StudentGroup | null | undefined, flatGroups: StudentGroup[],
): number | null {
  if (!group) return null;
  let cur: StudentGroup = group;
  // Bounded rather than `while (true)`: a row whose parent_id points back into
  // its own ancestry would otherwise hang the page.
  for (let hop = 0; hop < 8; hop++) {
    const pid: number | null = cur.parent_id ?? null;
    if (!pid) return cur.id;
    const parent = flatGroups.find((g) => g.id === pid);
    if (!parent || parent.id === cur.id) return cur.id;
    cur = parent;
  }
  return cur.id;
}

/** True when this class takes its advisors from the class above it. */
export function inheritsHomeroom(
  group: StudentGroup | null | undefined, flatGroups: StudentGroup[],
): boolean {
  if (!group || !group.parent_id) return false;
  return homeroomIds(group).length === 0
    && familyRootId(group, flatGroups) !== group.id;
}

/**
 * The advisors that apply to this class.
 *
 * Its own if it has any — a sub-class the school deliberately gave its own
 * advisor keeps them — and otherwise the ones recorded on the class above.
 */
export function effectiveHomeroomIds(
  group: StudentGroup | null | undefined, flatGroups: StudentGroup[],
): number[] {
  const own = homeroomIds(group);
  if (own.length || !group) return own;
  const rootId = familyRootId(group, flatGroups);
  if (rootId == null || rootId === group.id) return [];
  return homeroomIds(flatGroups.find((g) => g.id === rootId));
}

/** Their names, following inheritance, for a table cell or a printed sheet. */
export function effectiveHomeroomNames(
  group: StudentGroup | null | undefined,
  flatGroups: StudentGroup[],
  teachers: Teacher[],
  short?: (name: string) => string,
): string[] {
  return effectiveHomeroomIds(group, flatGroups)
    .map((id) => teachers.find((t) => t.id === id)?.name)
    .filter((n): n is string => !!n)
    .map((n) => (short ? short(n) : n));
}

/**
 * The families this teacher advises, as root class ids.
 *
 * A teacher belongs to one class and one only, and a parent with its
 * sub-classes is one class — counting the rows instead would read ม.4/6 and
 * its three sub-classes as four and refuse an assignment that is really one.
 */
export function advisedRootIds(
  teacherId: number, flatGroups: StudentGroup[],
): Set<number> {
  const roots = new Set<number>();
  for (const g of flatGroups) {
    if (!homeroomIds(g).includes(teacherId)) continue;
    const r = familyRootId(g, flatGroups);
    if (r != null) roots.add(r);
  }
  return roots;
}
