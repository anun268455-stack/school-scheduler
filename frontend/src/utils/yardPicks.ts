/**
 * คาบเรียนลาน — the small amount of logic behind marking an hour as "outdoors,
 * on this ลาน". Kept out of the components so it can be tested on its own.
 *
 * A mark belongs to one class, one day and one period. The grid draws a คาบคู่
 * as a single cell across two columns, so a cell can stand for two marks.
 */

/** What every mark carries, whatever else the server adds. */
export interface PickRowLike {
  group_id: number;
  day:      number;
  period:   number;
  room_id:  number;
}

/** The grid's own key for a cell: "day-period". */
export const cellKey = (day: number, period: number): string => `${day}-${period}`;

/** One class's marks, by cell. No class on screen means no marks to draw. */
export function picksOfGroup<R extends PickRowLike>(
  rows: R[], groupId: number | null,
): Map<string, number> {
  const m = new Map<string, number>();
  if (groupId == null) return m;
  for (const r of rows) {
    if (r.group_id === groupId) m.set(cellKey(r.day, r.period), r.room_id);
  }
  return m;
}

/**
 * The ลาน chosen across a cell's periods — one id for an ordinary cell, one or
 * two for a คาบคู่ whose halves may have been marked separately. Distinct, in
 * period order; empty when nothing is marked.
 */
export function yardsInCell(
  picks: Map<string, number>, day: number, periods: number[],
): number[] {
  const out: number[] = [];
  for (const p of periods) {
    const id = picks.get(cellKey(day, p));
    if (id != null && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Fold the server's answer to one save into the marks held here.
 * `saved` is the row that came back, or null when the mark was removed.
 */
export function applyPickResult<R extends PickRowLike>(
  rows: R[],
  asked: { group_id: number; day: number; period: number },
  saved: R | null,
): R[] {
  const rest = rows.filter((r) => !(
    r.group_id === asked.group_id && r.day === asked.day && r.period === asked.period));
  return saved ? [...rest, saved] : rest;
}

/**
 * Yards in the order the school saved. A yard the order does not mention goes
 * last, as the server sent it, and an id with no yard behind it is dropped —
 * a list that quietly loses a ลาน would save an order that is missing one.
 */
export function inOrder<Y extends { id: number }>(order: number[], yards: Y[]): Y[] {
  const left = new Map<number, Y>(yards.map((y) => [y.id, y]));
  const out: Y[] = [];
  for (const id of order) {
    const y = left.get(id);
    if (y) {
      out.push(y);
      left.delete(id);
    }
  }
  return [...out, ...left.values()];
}

/**
 * Move one item a place up (-1) or down (+1). Hands back the SAME array when
 * the move is not possible, so the caller can tell nothing happened.
 */
export function moveBy(ids: number[], index: number, delta: -1 | 1): number[] {
  const to = index + delta;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return ids;
  const next = ids.slice();
  next[index] = ids[to];
  next[to] = ids[index];
  return next;
}

// ── คาบคู่ ─────────────────────────────────────────────────────────────────
// A คาบคู่ is one lesson in one room across two hours, so the two hours of one
// are always marked together. The grid draws them as one cell; these are the
// rules it uses to decide that, kept here so that every screen that marks an
// hour (the picker, the rescue screen) agrees with what the grid shows.

/** What pairing needs to know about a lesson. */
export interface DoubleLike {
  id: number;
  double_group_key?: string | null;
}

/** Which cells are a คาบคู่ drawn as one: the first hour spans two, the second is swallowed. */
export interface MergedDoubles {
  /** "day-period" of the first hour -> 2. */
  spans:     Map<string, number>;
  /** "day-period" of the second hour, which has no cell of its own. */
  swallowed: Set<string>;
}

/**
 * Which cells of a grid are one คาบคู่.
 *
 * `grid` maps "day-period" to the lessons in that cell; `periodNums` are the
 * grid's columns in order. Only when the two columns are actually next to each
 * other — a pair split by a break is two cells, because merging would draw the
 * lesson straight through the break — and only when each cell holds exactly
 * that one lesson and both carry the same pair key.
 */
export function mergedDoubles<S extends DoubleLike>(
  grid: Map<string, S[]>, days: number[], periodNums: number[],
): MergedDoubles {
  const spans = new Map<string, number>();
  const swallowed = new Set<string>();
  for (const d of days) {
    for (let i = 0; i < periodNums.length - 1; i++) {
      const here = grid.get(cellKey(d, periodNums[i])) ?? [];
      const next = grid.get(cellKey(d, periodNums[i + 1])) ?? [];
      if (here.length !== 1 || next.length !== 1) continue;
      const a = here[0], b = next[0];
      if (!a.double_group_key || a.double_group_key !== b.double_group_key) continue;
      if (a.id === b.id) continue;
      spans.set(cellKey(d, periodNums[i]), 2);
      swallowed.add(cellKey(d, periodNums[i + 1]));
    }
  }
  return { spans, swallowed };
}

/**
 * The hours a cell stands for: both of a merged คาบคู่ whichever of the two is
 * asked about, otherwise just its own. Always includes `period`.
 */
export function periodsOfCell(
  merged: MergedDoubles, day: number, periodNums: number[], period: number,
): number[] {
  const at = periodNums.indexOf(period);
  if (at < 0) return [period];
  if (merged.spans.get(cellKey(day, period)) === 2 && at + 1 < periodNums.length) {
    return [period, periodNums[at + 1]];
  }
  if (merged.swallowed.has(cellKey(day, period)) && at > 0) {
    return [periodNums[at - 1], period];
  }
  return [period];
}

// ── ครึ่งไหนเป็นคาบเดียวกัน ─────────────────────────────────────────────────
// The helpers above answer a drawing question: do these two hours draw as ONE
// cell? That needs the columns to touch. They do not answer the lesson question
// — are these two hours ONE LESSON, in one room? — and the two come apart when
// a break falls between the halves: one lesson, two cells. A ลาน is chosen for a
// lesson, so a screen that marks hours out asks the lesson question, the way the
// server does (`_lesson_slots`: the class's slots that carry the same pair key).

/** What finding a lesson, and its other half, needs to know about a slot. */
export interface LessonLike extends DoubleLike {
  group_id: number;
  day:      number;
  period:   number;
  room_id?: number | null;
}

/**
 * The lesson at one class's one hour, told apart by the room it sits in —
 * `null` is the lesson with no room, the one that is stuck. The hour alone does
 * not say which: an hour can hold more than one lesson of a class (an elective
 * window), and a rescue is for one of them. Nothing found: undefined.
 */
export function lessonAt<S extends LessonLike>(
  slots: S[], groupId: number, day: number, period: number, inRoom: number | null,
): S | undefined {
  return slots.find((s) => s.group_id === groupId && s.day === day && s.period === period
    && (s.room_id || null) === inRoom);
}

/**
 * Every hour of a lesson, in period order: its own, and the other half of a
 * คาบคู่ — whether or not the two touch on the page. Found as the server finds
 * them, by the pair key among the class's own slots, and only on the lesson's
 * day (a ลาน is picked for one day's hour). `period` is the hour that was asked
 * about and is always among them, even when the lesson itself cannot be found.
 */
export function lessonHours<S extends LessonLike>(
  slots: S[], lesson: S | undefined, period: number,
): number[] {
  const hours = new Set<number>([period]);
  const key = lesson?.double_group_key;
  if (lesson && key) {
    for (const s of slots) {
      if (s.double_group_key === key && s.group_id === lesson.group_id && s.day === lesson.day) {
        hours.add(s.period);
      }
    }
  }
  return [...hours].sort((a, b) => a - b);
}

/**
 * Every hour a mark on one cell goes with: the cell's own hours, and the other
 * half of the lesson in it when that is a คาบคู่ the page draws apart (a break
 * between the halves). The picker marks a cell; a ลาน is chosen for a lesson;
 * this is how the two are made to agree.
 *
 * Only for an hour that holds exactly one lesson of the class. An hour with two
 * (an elective window) does not say which of them the mark is for, so it goes
 * on that hour alone; an empty hour is its own.
 */
export function hoursOfCell<S extends LessonLike>(
  slots: S[], groupId: number, day: number, cellHours: number[],
): number[] {
  const hours = new Set<number>(cellHours);
  for (const p of cellHours) {
    const here = slots.filter((s) => s.group_id === groupId && s.day === day && s.period === p);
    if (here.length === 1) for (const h of lessonHours(slots, here[0], p)) hours.add(h);
  }
  return [...hours].sort((a, b) => a - b);
}
