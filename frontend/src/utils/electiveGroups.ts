/**
 * คาบเสรีที่เป็นคาบเดียวกัน — forty rows that were always one decision.
 *
 * A school runs one elective period for a whole level: the same day, the same
 * hour, the same list of subjects, and every class in the level sitting in it.
 * The timetable stores that as one cell per class, which is right — each class
 * has to have the hour booked — but the LIST then showed forty rows, and
 * adding a subject meant opening forty dialogs and typing the same thing.
 *
 * Nobody edits one class's copy on its own. So the rows that are plainly the
 * same period are gathered back into one, and the edit applies to all of them.
 *
 * "Plainly the same" is deliberately strict: same day, same period, and the
 * same subjects on offer. Two windows that happen to share an hour but offer
 * different things are two decisions and stay apart.
 */
import type { TimetableSlot } from "../types";

export interface ElectiveGroup {
  key:     string;
  day:     number;
  period:  number;
  /** Every class's copy of this window — what an edit has to reach. */
  slots:   TimetableSlot[];
  groupIds: number[];
  /** The subjects on offer, read from the first copy; they all match. */
  optionCount: number;
  isDouble: boolean;
}

/** What makes two cells the same window: when it is, and what is in it. */
export function signatureOf(s: TimetableSlot): string {
  const opts = (s.elective_options ?? [])
    .map((o) => `${o.subject_id}:${o.teacher_id ?? ""}`)
    .sort()
    .join(",");
  return `${s.day}-${s.period}-${opts}`;
}

export function groupElectiveSlots(slots: TimetableSlot[]): ElectiveGroup[] {
  const by = new Map<string, ElectiveGroup>();
  for (const s of slots) {
    if (!s.is_elective) continue;
    // The second half of a double is the same lesson, not another window.
    if (s.is_double_cont) continue;
    const key = signatureOf(s);
    const cur = by.get(key) ?? {
      key, day: s.day, period: s.period, slots: [], groupIds: [],
      optionCount: s.elective_options?.length ?? 0,
      isDouble: !!s.double_group_key,
    };
    cur.slots.push(s);
    if (!cur.groupIds.includes(s.group_id)) cur.groupIds.push(s.group_id);
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => a.day - b.day || a.period - b.period);
}
