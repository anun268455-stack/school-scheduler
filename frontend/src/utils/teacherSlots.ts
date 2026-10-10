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
  // สอนร่วม — the second teacher is in the room, so the lesson belongs on
  // their timetable too, and they are busy for it like anyone else.
  if (slot.co_teacher_id === teacherId) return true;
  // ครูผู้ดูแลคาบกิจกรรม — ลูกเสือ, เนตรนารี, ชุมนุม. Standing with a class on
  // parade is duty, and duty belongs on the duty teacher's own sheet.
  if ((slot.activity_teacher_ids ?? []).includes(teacherId)) return true;
  if (!slot.is_elective || slot.selected_option_id) return false;
  return (slot.elective_options ?? []).some((o) => o.teacher_id === teacherId);
}

/**
 * Everyone standing in the room, in the order they should be read.
 *
 * One lesson, one teacher is still the normal case; สอนร่วม adds a partner and
 * a คาบกิจกรรม can add a whole duty roster. Callers that only read
 * `teacher_name` show the first of four names and quietly lose the rest.
 */
export function slotTeacherNames(slot: TimetableSlot): string[] {
  return [slot.teacher_name, slot.co_teacher_name, ...(slot.activity_teacher_names ?? [])]
    .filter((n): n is string => !!n);
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
