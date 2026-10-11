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

/**
 * วิชาที่น่าจะเป็นวิชาเสรี แต่ยังไม่ได้ติ๊ก — what is making this teacher
 * look overloaded before a single คาบเสรี has been placed.
 *
 * A teacher down for one subject in eight classes at two periods each reads
 * as sixteen hours. If those eight classes sit in one window it is two. The
 * two cases are written down identically, so this cannot decide between them
 * — a maths teacher really does teach eight classes separately. It only says
 * which rows the question is about, and what the week would come to if the
 * answer is yes. The staff tick it; nothing here ticks anything.
 */
export interface ElectiveCandidate {
  subjectId: number;
  /** How many classes are down for it. */
  classes: number;
  /** Hours it is counted as now, and after ticking. */
  now: number;
  then: number;
  /** now − then: what the teacher's week would lose. */
  saves: number;
}

export function electiveCandidates(
  rows: LessonRequirement[], elective: Set<number>, minClasses = 3,
): ElectiveCandidate[] {
  const by = new Map<number, number[]>();
  for (const r of rows) {
    if (elective.has(r.subject_id)) continue;
    const cur = by.get(r.subject_id);
    if (cur) cur.push(r.weekly_count ?? 0);
    else by.set(r.subject_id, [r.weekly_count ?? 0]);
  }
  const out: ElectiveCandidate[] = [];
  for (const [subjectId, counts] of by) {
    if (counts.length < minClasses) continue;
    const now = counts.reduce((a, b) => a + b, 0);
    const then = Math.max(...counts);
    if (now <= then) continue;
    out.push({ subjectId, classes: counts.length, now, then, saves: now - then });
  }
  return out.sort((a, b) => b.saves - a.saves);
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

/**
 * One class's week: electives collapsed into one block, สอนร่วม counted once.
 *
 * สอนร่วม is written as a row per teacher — both really do walk into the
 * room — but the class sits through the lesson once. Counting both halves
 * put ม.1/1 at 49 periods in a 45-period week and told the school to cut
 * four lessons that were never there.
 */
export function groupLoad(
  rows: LessonRequirement[], elective: Set<number>,
): number {
  const halves = coTeachHalves(rows);
  let total = 0, block = 0;
  for (const r of rows) {
    if (halves.has(r.id)) continue;
    const wc = r.weekly_count ?? 0;
    if (elective.has(r.subject_id)) block = Math.max(block, wc);
    else total += wc;
  }
  return total + block;
}

/**
 * The second half of each สอนร่วม pair, by row id.
 *
 * Two rows for one class and one subject that name each other as partners.
 * Rows that do NOT name each other are left alone: two teachers who each
 * think the class is theirs is a real disagreement, not a pair.
 */
export function coTeachHalves(rows: LessonRequirement[]): Set<number> {
  const byCell = new Map<string, LessonRequirement[]>();
  for (const r of rows) {
    const k = `${r.group_id}:${r.subject_id}`;
    const cur = byCell.get(k);
    if (cur) cur.push(r); else byCell.set(k, [r]);
  }
  const out = new Set<number>();
  for (const cell of byCell.values()) {
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i];
      if (out.has(a.id)) continue;
      for (let j = i + 1; j < cell.length; j++) {
        const b = cell[j];
        if (out.has(b.id)) continue;
        if (a.co_teacher_id === b.teacher_id || b.co_teacher_id === a.teacher_id) {
          out.add(b.id);
          break;
        }
      }
    }
  }
  return out;
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
