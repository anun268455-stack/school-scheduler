/**
 * วิชาซ้ำ — the same subject reaching one class twice over.
 *
 * Two ways it happens, and neither announces itself on the grid:
 *
 *  1. Two requirement rows give ค22102 for ม.2/4 to two different teachers.
 *     Both get placed, so the class sits through the subject more often than
 *     the plan says and each teacher believes the class is theirs. When that
 *     is deliberate it should be one row with สอนร่วม set, which is why the
 *     check names the difference instead of just counting.
 *
 *  2. More periods land than were asked for — an import run twice, a lesson
 *     added by hand on top of a solved week.
 *
 * Both are read off the live data rather than remembered, so fixing the plan
 * clears the warning without anything else having to be told.
 */
import type { LessonRequirement, TimetableSlot } from "../types";
import { indexRequirements, mirrorOf, unexplainedTeachers } from "./coTeaching";

export interface DuplicateRow {
  groupId:   number;
  subjectId: number;
  /** Distinct teachers named for it by separate requirement rows. */
  teacherIds: number[];
  /** Periods per week the plan asks for, summed across those rows. */
  planned:   number;
  /** Periods actually on the timetable. */
  placed:    number;
  /** True when it is one row with สอนร่วม, which is the legitimate pairing. */
  paired:    boolean;
}

export interface DuplicateReport {
  /** One class+subject handed to more than one teacher by separate rows. */
  splitTeachers: DuplicateRow[];
  /** More periods on the timetable than the plan asks for. */
  overPlaced:    DuplicateRow[];
}

export function findSubjectDuplicates(
  requirements: LessonRequirement[], slots: TimetableSlot[],
): DuplicateReport {
  const key = (g: number, s: number) => `${g}:${s}`;

  const idx = indexRequirements(requirements);
  const counted = new Set<number>();
  const rows = new Map<string, DuplicateRow>();
  for (const r of requirements) {
    const k = key(r.group_id, r.subject_id);
    const cur = rows.get(k) ?? {
      groupId: r.group_id, subjectId: r.subject_id,
      teacherIds: [], planned: 0, placed: 0, paired: false,
    };
    if (!cur.teacherIds.includes(r.teacher_id)) cur.teacherIds.push(r.teacher_id);
    const mirror = mirrorOf(r, idx);
    if (mirror) cur.paired = true;
    if (r.co_teacher_id != null) cur.paired = true;
    // A mirrored pair is one lesson written from both sides, so its periods
    // are counted once. Adding both rows would say the class needs six of a
    // subject it needs three of, and every paired lesson would then look
    // like it had been placed only half as often as planned.
    if (!(mirror && counted.has(mirror.id))) cur.planned += r.weekly_count ?? 0;
    counted.add(r.id);
    rows.set(k, cur);
  }

  for (const s of slots) {
    if (s.subject_id == null) continue;
    // A คาบกิจกรรม is pinned by hand and has no requirement behind it, so
    // counting it here would report every ลูกเสือ as unplanned.
    if (s.is_activity_block || s.is_elective) continue;
    const k = key(s.group_id, s.subject_id);
    const cur = rows.get(k);
    if (cur) cur.placed += 1;
  }

  // A pairing is only settled if every teacher on the cell is in it: three
  // teachers where two have paired up still leaves one unaccounted for.
  const settled = new Set<string>();
  for (const [k, group] of idx) {
    if (group.every((r) => unexplainedTeachers(r, idx).length === 0)) settled.add(k);
  }

  const all = [...rows.entries()];
  return {
    splitTeachers: all
      .filter(([k, r]) => r.teacherIds.length > 1 && !settled.has(k))
      .map(([, r]) => r),
    // Only when a plan exists to be exceeded: planned 0 means the lesson was
    // placed by hand, which is a choice, not a duplicate.
    overPlaced: all.map(([, r]) => r).filter((r) => r.planned > 0 && r.placed > r.planned),
  };
}
