/**
 * How many periods a week a teacher and a class are really being asked for.
 *
 * Not the sum of the rows. วิชาเสรี break that: ten classes "taking"
 * ศิลปะตกแต่ง is not ten lessons — the students who chose it come out of all
 * ten and sit together, one teacher, one room, one hour. Added up row by row
 * it reads as twenty hours of that teacher's week and puts every one of the
 * ten classes past the size of the week, which is how the warning list filled
 * with classes and teachers that were never overloaded.
 *
 * So:
 *   a teacher  one entry per elective subject, its largest weekly_count
 *   a class    all its electives together are ONE block, the largest of them,
 *              because a student picks one of them and sits the rest out
 *
 * Ordinary subjects are summed as before. Shared by the pre-solve warnings
 * and by the dialogs that show a teacher's total, so the two never disagree.
 */
import type { LessonRequirement, Subject, ElectivePool, TimetableSlot } from "../types";

/**
 * Subjects a student chooses: ticked วิชาเสรี, or sitting in a คาบเสรี.
 *
 * Both kinds of window count — the pool that covers a whole level, and the
 * per-class cell. Most of this school's electives are the second kind, and
 * leaving them out meant the subject read as ordinary and was counted once
 * per class however obviously it was an elective.
 */
export function electiveSubjectIds(
  subjects: Subject[], pools: ElectivePool[] = [], slots: TimetableSlot[] = [],
): Set<number> {
  const out = new Set<number>();
  for (const s of subjects) if (s.is_elective) out.add(s.id);
  for (const p of pools) for (const o of p.options ?? []) {
    if (o.subject_id) out.add(o.subject_id);
  }
  for (const s of slots) {
    if (!s.is_elective) continue;
    for (const o of s.elective_options ?? []) if (o.subject_id) out.add(o.subject_id);
  }
  return out;
}

/** One teacher's week, with each elective counted once however many classes. */
export function teacherLoad(
  rows: LessonRequirement[], elective: Set<number>,
): number {
  let total = 0;
  const byElective = new Map<number, number>();
  for (const r of rows) {
    const wc = r.weekly_count ?? 0;
    if (elective.has(r.subject_id)) {
      byElective.set(r.subject_id, Math.max(byElective.get(r.subject_id) ?? 0, wc));
    } else {
      total += wc;
    }
  }
  for (const wc of byElective.values()) total += wc;
  return total;
}

/** One class's week, with all its electives collapsed into a single block. */
export function groupLoad(
  rows: LessonRequirement[], elective: Set<number>,
): number {
  let total = 0, block = 0;
  for (const r of rows) {
    const wc = r.weekly_count ?? 0;
    if (elective.has(r.subject_id)) block = Math.max(block, wc);
    else total += wc;
  }
  return total + block;
}

/** Every teacher's load, keyed by id. */
export function teacherLoads(
  requirements: LessonRequirement[], elective: Set<number>,
): Map<number, number> {
  const rows = new Map<number, LessonRequirement[]>();
  for (const r of requirements) {
    const cur = rows.get(r.teacher_id);
    if (cur) cur.push(r); else rows.set(r.teacher_id, [r]);
  }
  return new Map([...rows].map(([id, rs]) => [id, teacherLoad(rs, elective)]));
}

/** Every class's load, keyed by id. */
export function groupLoads(
  requirements: LessonRequirement[], elective: Set<number>,
): Map<number, number> {
  const rows = new Map<number, LessonRequirement[]>();
  for (const r of requirements) {
    const cur = rows.get(r.group_id);
    if (cur) cur.push(r); else rows.set(r.group_id, [r]);
  }
  return new Map([...rows].map(([id, rs]) => [id, groupLoad(rs, elective)]));
}
