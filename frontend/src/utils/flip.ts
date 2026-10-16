/**
 * ติ๊ก/เอาออกหนึ่งรายการ — คืนชุดใหม่เสมอ เพื่อให้ React เห็นว่าเปลี่ยน.
 *
 * Written as a function, not as `has ? delete : add` on one line: lint fails
 * the deploy on a bare conditional used as a statement.
 */
export function flip<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
