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
 * สอนร่วม — two named teachers in one lesson.
 *
 * Not the same as a คาบกิจกรรม with a duty roster: that is many classrooms
 * sharing one hour, and it already looks different on the grid. This is one
 * class, one subject, two people in the room, which is the thing the school
 * checks a printed grid for.
 */
export function teachingTogether(slot: TimetableSlot): boolean {
  return !slot.is_activity_block && slot.co_teacher_id != null;
}

/**
 * What makes several classes' cells one lesson for the teacher standing in it.
 *
 * A คาบกิจกรรม is one hour of their Monday however many classrooms take part:
 * the ครูผู้ดูแล list belongs to the activity, and the school splits the หมู่
 * between themselves. A คาบเสรี is the same story told the other way round —
 * the window covers ten classes, the students scatter across twenty subjects,
 * and each subject's teacher takes one group drawn from all ten rooms.
 *
 * Either way, counting the cells instead of the lesson stacks ten copies into
 * one square of her timetable and bills her for ten hours she did not work.
 */
function sharedLessonKey(s: TimetableSlot): string | null {
  if (s.activity_key) return `ACT:${s.activity_key}`;
  // Both halves of a double are real hours, so the period is part of the key.
  if (s.elective_pool_id) return `POOL:${s.elective_pool_id}:${s.day}:${s.period}`;
  return null;
}

/** One teacher's own week, each thing she teaches appearing once. */
export function slotsForTeacher(
  slots: TimetableSlot[], teacherId: number,
): TimetableSlot[] {
  const seen = new Set<string>();
  const out: TimetableSlot[] = [];
  for (const s of slots) {
    if (!teachesSlot(s, teacherId)) continue;
    const k = sharedLessonKey(s);
    if (k) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(s);
  }
  return out;
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
