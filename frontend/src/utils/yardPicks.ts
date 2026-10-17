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
