/**
 * Does every class that is down to take an elective actually sit in one?
 *
 * A วิชาเสรี is taught once, in a คาบเสรี, to whoever signed up for it. The
 * teaching plan still lists it class by class — that is how the school writes
 * down who is entitled to choose it — so there are two lists of classes for
 * the same subject, and they have to agree:
 *
 *   the plan    classes with a requirement for the subject
 *   the window  classes sitting in a คาบเสรี that offers it
 *
 * A class in the plan but in no window is the one that goes wrong. Its lesson
 * is a lesson like any other, so the solver puts it somewhere on its own, with
 * that teacher — who is already standing in the elective window teaching the
 * same subject to everybody else. Nothing catches it, because on paper each
 * half is reasonable.
 *
 * The other direction is fine and not reported: a class may sit in a window
 * whose subject it never takes, because the window holds twenty subjects and
 * its students choose among them.
 */
import type { LessonRequirement, StudentGroup, TimetableSlot, ElectivePool } from "../types";

/** Parent and subgroups are the same students, so either covers the other. */
function family(groups: StudentGroup[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const p of groups) {
    const kids = (p.children ?? []).map((c) => c.id);
    out.set(p.id, [p.id, ...kids]);
    for (const k of kids) out.set(k, [k, p.id]);
  }
  return out;
}

/** The classes sitting in some คาบเสรี that offers this subject. */
export function windowGroupsFor(
  subjectId: number, pools: ElectivePool[], slots: TimetableSlot[],
): Set<number> {
  const out = new Set<number>();
  for (const p of pools) {
    if ((p.options ?? []).some((o) => o.subject_id === subjectId)) {
      for (const g of p.group_ids ?? []) out.add(g);
    }
  }
  for (const s of slots) {
    if (!s.is_elective) continue;
    if ((s.elective_options ?? []).some((o) => o.subject_id === subjectId)) {
      out.add(s.group_id);
    }
  }
  return out;
}

export interface ElectiveCoverage {
  subjectId: number;
  /** Classes whose plan has it AND who sit in a window offering it. */
  covered: number[];
  /** Classes whose plan has it but who sit in no such window. */
  missing: number[];
  /** True when there is no window for this subject at all. */
  noWindow: boolean;
}

export function coverageFor(
  subjectId: number,
  requirements: LessonRequirement[],
  groups: StudentGroup[],
  pools: ElectivePool[],
  slots: TimetableSlot[],
): ElectiveCoverage {
  const inWindow = windowGroupsFor(subjectId, pools, slots);
  const kin = family(groups);
  const covered: number[] = [];
  const missing: number[] = [];
  const seen = new Set<number>();
  for (const r of requirements) {
    if (r.subject_id !== subjectId || seen.has(r.group_id)) continue;
    seen.add(r.group_id);
    const mine = kin.get(r.group_id) ?? [r.group_id];
    (mine.some((g) => inWindow.has(g)) ? covered : missing).push(r.group_id);
  }
  return { subjectId, covered, missing, noWindow: inWindow.size === 0 };
}

/** Every elective subject whose plan and windows disagree. */
export function coverageProblems(
  electiveIds: Set<number>,
  requirements: LessonRequirement[],
  groups: StudentGroup[],
  pools: ElectivePool[],
  slots: TimetableSlot[],
): ElectiveCoverage[] {
  return [...electiveIds]
    .map((id) => coverageFor(id, requirements, groups, pools, slots))
    .filter((c) => c.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);
}
