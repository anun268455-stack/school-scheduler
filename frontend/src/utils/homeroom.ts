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
