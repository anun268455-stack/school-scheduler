/**
 * The order teachers are listed in: by รหัสประจำตัวครู.
 *
 * The codes are handed out per กลุ่มสาระ — ภาษาไทย from 101, the next
 * department from its own base — and the last digits run on in the order the
 * department head arranged them. So reading down the codes reads down the
 * departments, which is how the staffroom expects a staff list to look.
 *
 * Shared rather than written at each list, because the teacher page and the
 * timetable's teacher picker drifting into different orders is exactly the
 * confusion the codes were introduced to remove.
 */
import { compareNames } from "./groupHierarchy";

/** Just enough of a Teacher to order one; anything with a code and a name. */
export interface Orderable {
  code?: string | null;
  name: string;
}

/**
 * Compare two teachers by code, then by name.
 *
 * The digits are compared as numbers, so 99 comes before 101 and 1010 lands
 * after 102 instead of between 101 and 102. A teacher who has not been given
 * a code yet sorts to the bottom by name: an empty string would otherwise
 * sort before every real code and put them at the top of the page.
 */
export function compareTeacherCode(a: Orderable, b: Orderable): number {
  const ca = (a.code ?? "").trim();
  const cb = (b.code ?? "").trim();
  if (!ca !== !cb) return ca ? -1 : 1;
  return (ca && cb ? compareNames(ca, cb) : 0) || compareNames(a.name, b.name);
}

/** A copy of the list in code order — never sorts the caller's array in place. */
export function byTeacherCode<T extends Orderable>(list: readonly T[]): T[] {
  return [...list].sort(compareTeacherCode);
}
