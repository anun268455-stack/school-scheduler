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

/**
 * The hours of the lesson that sits at one class's one hour — two when it is
 * half of a merged คาบคู่ — worked out from that class's own lessons, as the
 * grid would draw them. For a screen that has the lesson but not the grid.
 */
export function lessonHours<S extends DoubleLike & { group_id: number; day: number; period: number }>(
  slots: S[], groupId: number, day: number, periodNums: number[], period: number,
): number[] {
  const grid = new Map<string, S[]>();
  for (const s of slots) {
    if (s.group_id !== groupId || s.day !== day) continue;
    const k = cellKey(s.day, s.period);
    const cell = grid.get(k);
    if (cell) cell.push(s);
    else grid.set(k, [s]);
  }
  return periodsOfCell(mergedDoubles(grid, [day], periodNums), day, periodNums, period);
}
