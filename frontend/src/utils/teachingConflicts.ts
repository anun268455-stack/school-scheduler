/**
 * One class, one subject, one teacher.
 *
 * ค31101 for ม.4/4 is taught by somebody — one somebody. Two rows naming two
 * different teachers for it is not a plan, it is a question nobody answered,
 * and the solver will quietly place both: the class sits through the subject
 * twice a week more than it should, and two teachers each think it is theirs.
 *
 * The legitimate case — a student teacher beside their mentor, a foreign
 * teacher with a Thai partner — is one row with สอนร่วม set, not two rows.
 * That is the difference this draws, and why the warning points at it.
 */
import type { LessonRequirement } from "../types";

export interface TeacherClash {
  /** The requirement rows that disagree, in the order they were listed. */
  ids: number[];
  groupId: number;
  subjectId: number;
  teacherIds: number[];
}

/** Every class+subject handed to more than one teacher by separate rows. */
export function findTeacherClashes(reqs: LessonRequirement[]): TeacherClash[] {
  const by = new Map<string, LessonRequirement[]>();
  for (const r of reqs) {
    // คู่ขนาน rows deliberately repeat a subject across classes with their own
    // teachers; they are keyed by class as well, so they never collide here.
    const k = `${r.group_id}:${r.subject_id}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const out: TeacherClash[] = [];
  for (const rows of by.values()) {
    const teacherIds = [...new Set(rows.map((r) => r.teacher_id))];
    if (teacherIds.length < 2) continue;
    out.push({
      ids: rows.map((r) => r.id),
      groupId: rows[0].group_id,
      subjectId: rows[0].subject_id,
      teacherIds,
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
  for (const clash of findTeacherClashes(reqs)) {
    for (const r of reqs) {
      if (!clash.ids.includes(r.id)) continue;
      out.set(r.id, clash.teacherIds.filter((t) => t !== r.teacher_id));
    }
  }
  return out;
}
