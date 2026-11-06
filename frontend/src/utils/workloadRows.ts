/**
 * workloadRows — บรรทัดวิชาของครูหนึ่งคนในใบอัตรากำลังการสอน
 *
 *   "ตอนนี้เวลาปริ้นอัตรากำลัง วิชาเสรีไม่ขึ้นกับครู
 *    คาบคุณธรรม สาธา ไม่ต้องขึ้นเลขห้อง"
 *
 * แยกออกมาจาก WorkloadReport เพราะกฎสองข้อข้างล่างนี้เป็นกฎที่พลาดมาแล้วสองรอบ
 * ในที่อื่น และเป็นกฎที่ทดสอบได้ตรง ๆ ถ้ามันอยู่นอกหน้าจอ
 *
 * ── ๑ คาบเสรีไม่มีวิชาของตัวเอง ──
 *
 * คาบเสรีคือหน้าต่างเวลาที่มีหลายวิชาเรียนพร้อมกัน `subject_id` ของตัวคาบจึงเป็น
 * ค่าว่างเสมอ (ไม่มีวิชาไหนเป็นตัวแทนของทั้งคาบได้) ใบอัตรากำลังเดิมข้ามแถวที่
 * ไม่มี `subject_id` ไปทั้งหมด — ครูที่สอนวิชาเสรีจึงหายไปจากใบทั้งที่สอนอยู่จริง
 * วิชาที่ถูกต้องอยู่ที่ "ตัวเลือกของครูคนนั้น" ไม่ใช่ที่ตัวคาบ
 *
 * ── ๒ ชั้นที่สอนของคาบกิจกรรมไม่มีความหมาย ──
 *
 * คาบคุณธรรม สาธารณประโยชน์ ชุมนุม ลส.นน.ยว. เป็นคาบที่ทั้งระดับทำพร้อมกัน และ
 * ถูกเขียนไว้แถวละห้องเรียน ตัวยุบสำเนาเก็บแถวแรกที่เจอไว้แถวเดียว เลขชั้นที่
 * ติดมากับแถวนั้นจึงเป็น "ห้องไหนก็ได้ที่บังเอิญมาก่อน" ไม่ใช่ห้องที่ครูสอน —
 * ครูคนหนึ่งขึ้น 1/1 อีกคนขึ้น 3/1 ทั้งที่ทำกิจกรรมเดียวกันทั้งระดับ
 *
 * ตัวเลขที่ไม่มีความหมายแต่ดูเหมือนมี แย่กว่าช่องว่าง เพราะคนอ่านใบจะเชื่อมัน
 */
import type { TimetableSlot } from "../types";
import { myElectiveOption, slotsForTeacher } from "./teacherSlots";

export interface WorkloadRow {
  /** วิชาที่ใช้รวมบรรทัด — ของคาบเสรีคือวิชาของตัวเลือก ไม่ใช่ของตัวคาบ */
  subjectId: number;
  /** สิ่งที่พิมพ์ในคอลัมน์ "รหัสวิชา" */
  code:      string;
  /** คอลัมน์ "ชั้นที่สอน" — ว่างสำหรับคาบกิจกรรม */
  classes:   string[];
  periods:   number;
  isActivity: boolean;
  isElective: boolean;
}

export interface WorkloadLookups {
  /** รหัสวิชาจากทะเบียนวิชา — คืน undefined ถ้าไม่มี */
  codeOf:  (subjectId: number) => string | undefined;
  /** ชื่อชั้นแบบสั้นของแถวหนึ่ง เช่น "1/1" */
  classOf: (slot: TimetableSlot) => string;
}

/**
 * ชั้นเรียนทั้งหมดที่ส่งนักเรียนมาเรียนวิชาเสรีวิชาหนึ่ง
 *
 * ตัวยุบสำเนาเหลือแถวเดียวไว้ให้ ซึ่งพอสำหรับการนับคาบ แต่ไม่พอสำหรับคอลัมน์
 * "ชั้นที่สอน" — ต้องกลับไปดูทั้งตารางว่าหน้าต่างนั้นครอบห้องเรียนใดบ้าง
 */
function electiveClasses(
  all: readonly TimetableSlot[], at: TimetableSlot,
  subjectId: number, teacherId: number, classOf: (s: TimetableSlot) => string,
): string[] {
  const out: string[] = [];
  for (const s of all) {
    if (s.day !== at.day || s.period !== at.period || !s.is_elective) continue;
    const has = (s.elective_options ?? []).some(
      (o) => o.teacher_id === teacherId && o.subject_id === subjectId);
    if (!has) continue;
    const cls = classOf(s);
    if (cls && !out.includes(cls)) out.push(cls);
  }
  return out;
}

const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

/**
 * บรรทัดวิชาของครูคนนี้ รวมชั้นเรียนที่สอนวิชาเดียวกันเข้าด้วยกัน
 *
 * `all` คือตารางทั้งโรงเรียน ไม่ใช่เฉพาะของครูคนนี้ เพราะต้องใช้หาว่าหน้าต่าง
 * คาบเสรีครอบห้องเรียนใดบ้าง ส่วนการนับคาบใช้แถวที่ยุบสำเนาแล้ว
 */
export function workloadRows(
  all: readonly TimetableSlot[], teacherId: number, look: WorkloadLookups,
): WorkloadRow[] {
  const by = new Map<number, WorkloadRow>();
  for (const s of slotsForTeacher(all as TimetableSlot[], teacherId)) {
    let subjectId = s.subject_id;
    let code = look.codeOf(subjectId ?? -1) ?? s.subject_code ?? "";
    let classes = [look.classOf(s)];

    if (subjectId == null && s.is_elective) {
      // วิชาอยู่ที่ตัวเลือกของครูคนนี้ ไม่ใช่ที่ตัวคาบ
      const mine = myElectiveOption(s, teacherId);
      if (!mine?.subject_id) continue;
      subjectId = mine.subject_id;
      code = look.codeOf(subjectId) ?? mine.code ?? mine.label ?? "วิชาเสรี";
      classes = electiveClasses(all, s, subjectId, teacherId, look.classOf);
    }
    if (subjectId == null) continue;

    // คาบกิจกรรม: เลขชั้นที่ติดมากับแถวคือห้องไหนก็ได้ที่บังเอิญมาก่อน
    if (s.is_activity_block) classes = [];

    const row = by.get(subjectId) ?? {
      subjectId, code, classes: [], periods: 0,
      isActivity: !!s.is_activity_block,
      isElective: !!s.is_elective,
    };
    for (const c of classes) if (c && !row.classes.includes(c)) row.classes.push(c);
    row.periods += 1;
    by.set(subjectId, row);
  }

  const rows = [...by.values()];
  for (const r of rows) r.classes.sort(natural);
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}
