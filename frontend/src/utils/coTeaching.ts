/**
 * สอนร่วม written from both sides.
 *
 * A school that imports a teaching plan gets one row per teacher: the Thai
 * teacher has ม.2/1 ค22102 and the foreign teacher has ม.2/1 ค22102 too,
 * because each of them really does walk into that room. Setting สอนร่วม on
 * one of the two rows says what is going on, but the OTHER row still names a
 * second teacher for the same class and subject — so the pair kept showing up
 * as the very clash it was meant to resolve, and the teacher who reads their
 * own row saw nothing about a partner at all.
 *
 * Two rows that name each other are therefore one lesson, read twice. This
 * module is where that is decided, so the table, the clash badge, the
 * duplicate check and the solver all draw the same line.
 */
import type { LessonRequirement } from "../types";

const key = (r: LessonRequirement) => `${r.group_id}:${r.subject_id}`;

/**
 * The rows grouped by class+subject.
 *
 * Every question here is about the handful of rows sharing one cell of the
 * plan, and the school has 1,685 rows: asked row by row against the whole
 * list that is 2.8 million comparisons on every keystroke in the table.
 * Callers in a loop build this once and pass it.
 */
export type ReqIndex = Map<string, LessonRequirement[]>;

export function indexRequirements(all: LessonRequirement[]): ReqIndex {
  const m: ReqIndex = new Map();
  for (const r of all) {
    const k = key(r);
    const cur = m.get(k);
    if (cur) cur.push(r); else m.set(k, [r]);
  }
  return m;
}

const peers = (req: LessonRequirement, all: LessonRequirement[] | ReqIndex) =>
  (all instanceof Map ? all.get(key(req)) : all) ?? [];

/**
 * The row that is this row seen from the partner's side, if there is one.
 *
 * Same class, same subject, and the two rows name each other — either because
 * this row's สอนร่วม is that row's teacher, or the other way round. A row
 * whose สอนร่วม points at somebody with no row of their own has no mirror,
 * and needs none: it already says everything by itself.
 */
export function mirrorOf(
  req: LessonRequirement, all: LessonRequirement[] | ReqIndex,
): LessonRequirement | null {
  return peers(req, all).find((o) =>
    o.id !== req.id && key(o) === key(req) &&
    (req.co_teacher_id === o.teacher_id || o.co_teacher_id === req.teacher_id),
  ) ?? null;
}

/** Who this row's teacher stands beside — their own สอนร่วม, or a mirror's. */
export function partnerOf(
  req: LessonRequirement, all: LessonRequirement[] | ReqIndex,
): number | null {
  if (req.co_teacher_id != null) return req.co_teacher_id;
  const m = mirrorOf(req, all);
  return m ? m.teacher_id : null;
}

/**
 * Teachers of this class+subject who are NOT accounted for by a pairing.
 *
 * Empty means the row is settled: either it is the only teacher, or every
 * other teacher on it is a declared partner. Anything returned is a genuine
 * disagreement — two people who each think the class is theirs.
 */
export function unexplainedTeachers(
  req: LessonRequirement, all: LessonRequirement[] | ReqIndex,
): number[] {
  const mine = new Set<number>([req.teacher_id]);
  const partner = partnerOf(req, all);
  if (partner != null) mine.add(partner);
  const others = new Set<number>();
  for (const o of peers(req, all)) {
    if (o.id === req.id || key(o) !== key(req)) continue;
    if (!mine.has(o.teacher_id)) others.add(o.teacher_id);
  }
  return [...others];
}

/**
 * Mirrors whose คาบ/สัปดาห์ disagree.
 *
 * The pair is one lesson, so the two rows have to ask for the same number of
 * periods. "3 and 1" does not say three with help in one of them — it says
 * nobody checked, and the solver would have to pick a number on its own.
 */
export function mismatchedPairs(
  all: LessonRequirement[],
): { a: LessonRequirement; b: LessonRequirement }[] {
  const idx = indexRequirements(all);
  const seen = new Set<number>();
  const out: { a: LessonRequirement; b: LessonRequirement }[] = [];
  for (const r of all) {
    if (seen.has(r.id)) continue;
    const m = mirrorOf(r, idx);
    if (!m || seen.has(m.id)) continue;
    seen.add(r.id); seen.add(m.id);
    if ((r.weekly_count ?? 0) !== (m.weekly_count ?? 0)) out.push({ a: r, b: m });
  }
  return out;
}
