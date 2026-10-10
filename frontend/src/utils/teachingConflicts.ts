/**
 * One class, one subject, one teacher.
 *
 * ค31101 for ม.4/4 is taught by somebody — one somebody. Two rows naming two
 * different teachers for it is not a plan, it is a question nobody answered,
 * and the solver will quietly place both: the class sits through the subject
 * twice a week more than it should, and two teachers each think it is theirs.
 *
 * The legitimate case — a student teacher beside their mentor, a foreign
 * teacher with a Thai partner — is the pair naming each other, whether that
 * is one row with สอนร่วม set or two rows that point at one another. Those
 * are settled, so they are not reported; see coTeaching.ts for the rule.
 */
import type { LessonRequirement } from "../types";
import { indexRequirements, unexplainedTeachers } from "./coTeaching";

export interface TeacherClash {
  /** The requirement rows that disagree, in the order they were listed. */
  ids: number[];
  groupId: number;
  subjectId: number;
  teacherIds: number[];
}

/** Every class+subject handed to teachers no pairing accounts for. */
export function findTeacherClashes(reqs: LessonRequirement[]): TeacherClash[] {
  // คู่ขนาน rows deliberately repeat a subject across classes with their own
  // teachers; the index is keyed by class as well, so they never collide here.
  const by = indexRequirements(reqs);
  const out: TeacherClash[] = [];
  for (const rows of by.values()) {
    if (new Set(rows.map((r) => r.teacher_id)).size < 2) continue;
    // Each row judged against the pairings it declares, so a settled pair
    // among three teachers still reports the third.
    const unexplained = new Set<number>();
    for (const r of rows) for (const t of unexplainedTeachers(r, by)) unexplained.add(t);
    if (unexplained.size === 0) continue;
    out.push({
      ids: rows.map((r) => r.id),
      groupId: rows[0].group_id,
      subjectId: rows[0].subject_id,
      teacherIds: [...new Set(rows.map((r) => r.teacher_id))],
    });
  }
  return out;
}

/**
 * Requirement id → the other teachers claiming the same class and subject.
 *
 * Built once for the whole table rather than searched per row: with 1,700
 * requirements on screen, asking the question row by row is 1,700 scans of
 * 1,700 rows every time anything re-renders.
 */
export function clashesByRequirement(
  reqs: LessonRequirement[],
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const idx = indexRequirements(reqs);
  const byId = new Map(reqs.map((r) => [r.id, r]));
  for (const clash of findTeacherClashes(reqs)) {
    for (const id of clash.ids) {
      const r = byId.get(id);
      if (!r) continue;
      // Only the teachers this particular row cannot account for: a row that
      // has named its partner is not the one with the problem.
      const theirs = unexplainedTeachers(r, idx);
      if (theirs.length) out.set(r.id, theirs);
    }
  }
  return out;
}
