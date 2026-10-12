/**
 * ตรวจรายวิชาของห้องเรียนหนึ่งห้อง — what one class is actually down to take.
 *
 * The teaching plan is 1,685 rows typed in over weeks, by several people,
 * partly imported from spreadsheets. Read a class at a time it is obvious
 * when something is wrong; read as one long list it is not, which is how a
 * class ends up with the same subject entered twice and a week that does not
 * fit the week.
 *
 * Four things go wrong, and only the first two are certainly mistakes:
 *
 *   วิชาซ้ำ        the same subject twice, from two teachers who have not
 *                  said they teach it together. One of them is wrong, and
 *                  the solver will place both.
 *   เกินสัปดาห์     more periods asked for than the week holds.
 *   ยังไม่มีครู     a row with no teacher.
 *   เสรีไม่มีคาบ    ticked วิชาเสรี with no คาบเสรี offering it to this class,
 *                  so it will be placed as an ordinary lesson on its own.
 *
 * สอนร่วม is NOT a duplicate: two rows that name each other are one lesson
 * read twice, and the class sits through it once.
 */
import type { LessonRequirement, StudentGroup, Subject } from "../types";

export interface ClassSubjectRow {
  subjectId: number;
  /** Every row for this subject in this class. */
  rows: LessonRequirement[];
  /** Teachers in the room, partners included. */
  teacherIds: number[];
  /** Periods a week the class sits through — the pair counted once. */
  weekly: number;
  /** Two rows that name each other: one lesson, two teachers. */
  coTaught: boolean;
  /** Two teachers who have NOT said they teach it together. */
  duplicate: boolean;
  elective: boolean;
  /** A row with nobody to teach it. */
  noTeacher: boolean;
}

export interface ClassAudit {
  groupId: number;
  subjects: ClassSubjectRow[];
  /** Periods the plan asks for, electives collapsed into one block. */
  planned: number;
  /** Periods the week actually holds for this class. */
  capacity: number;
  /** Periods already on the timetable. */
  placed: number;
  duplicates: ClassSubjectRow[];
  missingTeacher: ClassSubjectRow[];
  /** Ticked เสรี but no window offers it to this class. */
  electiveNoWindow: ClassSubjectRow[];
}

/** Two rows for one class+subject that name each other. */
function pairs(rows: LessonRequirement[]): boolean {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].co_teacher_id === rows[j].teacher_id
          || rows[j].co_teacher_id === rows[i].teacher_id) return true;
    }
  }
  return false;
}

export function auditClass(
  group: StudentGroup,
  requirements: LessonRequirement[],
  subjects: Subject[],
  electiveIds: Set<number>,
  /** Classes that sit in a คาบเสรี offering the subject, by subject id. */
  windowGroups: (subjectId: number) => Set<number>,
  capacity: number,
  placed: number,
): ClassAudit {
  const subjName = new Map(subjects.map((s) => [s.id, s]));
  const bySubject = new Map<number, LessonRequirement[]>();
  for (const r of requirements) {
    if (r.group_id !== group.id) continue;
    const cur = bySubject.get(r.subject_id);
    if (cur) cur.push(r); else bySubject.set(r.subject_id, [r]);
  }

  const out: ClassSubjectRow[] = [];
  for (const [subjectId, rows] of bySubject) {
    const coTaught = rows.length > 1 && pairs(rows);
    const teacherIds = [...new Set(rows.flatMap(
      (r) => [r.teacher_id, r.co_teacher_id].filter((x): x is number => x != null)))];
    out.push({
      subjectId, rows, teacherIds,
      // One lesson however many rows describe it, so the larger count wins
      // rather than the sum: a 2 and a 3 is a disagreement, not five periods.
      weekly: coTaught || rows.length === 1
        ? Math.max(...rows.map((r) => r.weekly_count ?? 0))
        : rows.reduce((n, r) => n + (r.weekly_count ?? 0), 0),
      coTaught,
      duplicate: rows.length > 1 && !coTaught,
      elective: electiveIds.has(subjectId),
      noTeacher: rows.some((r) => !r.teacher_id),
    });
  }
  out.sort((a, b) => (subjName.get(a.subjectId)?.code ?? "")
    .localeCompare(subjName.get(b.subjectId)?.code ?? ""));

  // Electives are one block of the week: a student picks one of them.
  let planned = 0, block = 0;
  for (const s of out) {
    if (s.elective) block = Math.max(block, s.weekly);
    else planned += s.weekly;
  }

  const kin = new Set<number>([group.id,
    ...(group.children ?? []).map((c) => c.id),
    ...(group.parent_id != null ? [group.parent_id] : [])]);

  return {
    groupId: group.id,
    subjects: out,
    planned: planned + block,
    capacity,
    placed,
    duplicates: out.filter((s) => s.duplicate),
    missingTeacher: out.filter((s) => s.noTeacher),
    electiveNoWindow: out.filter((s) => {
      if (!s.elective) return false;
      const w = windowGroups(s.subjectId);
      return ![...kin].some((g) => w.has(g));
    }),
  };
}

/** Does this class have anything worth looking at? */
export function classHasProblem(a: ClassAudit): boolean {
  return a.duplicates.length > 0 || a.missingTeacher.length > 0
    || a.electiveNoWindow.length > 0 || a.planned > a.capacity;
}
