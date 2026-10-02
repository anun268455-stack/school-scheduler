/**
 * teachesSlot — does this teacher teach in this slot?
 *
 * Usually that is just `slot.teacher_id`. A shared elective window is the
 * exception: it has no single teacher, because every option in it runs at the
 * same time. The teacher of any one option really is teaching then, so the
 * window belongs on their timetable even though the class cell names nobody.
 */
import type { TimetableSlot } from "../types";

export function teachesSlot(slot: TimetableSlot, teacherId: number): boolean {
  if (slot.teacher_id === teacherId) return true;
  if (!slot.is_elective || slot.selected_option_id) return false;
  return (slot.elective_options ?? []).some((o) => o.teacher_id === teacherId);
}

/** The option this teacher runs inside a shared elective window, if any. */
export function myElectiveOption(slot: TimetableSlot, teacherId: number) {
  if (slot.selected_option_id) return null;
  return (slot.elective_options ?? []).find((o) => o.teacher_id === teacherId) ?? null;
}

/**
 * What to call a lesson on screen.
 *
 * A shared elective has no subject of its own — its students scatter across
 * every option at once — so both `subject_code` and `subject_name` are null.
 * Written as `code ?? name` that renders the word "null" inside a sentence,
 * which is how it reached the screen. Everything that names a lesson goes
 * through here instead.
 */
export function slotLabel(slot: TimetableSlot): string {
  return slot.subject_code
    ?? slot.subject_name
    ?? (slot.is_elective ? "วิชาเสรี" : "—");
}
