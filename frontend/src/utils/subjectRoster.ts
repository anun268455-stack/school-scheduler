/**
 * subjectRoster — ไล่ทีละวิชาว่าวิชานั้นใครสอนบ้าง
 *
 *   "อยากให้สั่งพิมพ์ เป็นรายวิชาว่าวิชาอันไหนใครสอนบ้าง"
 *   "ช่วยทำเป็นตารางเลย เอาแค่พิมพ์ให้ได้ก่อน"
 *
 * ใบอัตรากำลังที่มีอยู่แล้วไล่ทีละครูว่าครูคนนั้นสอนอะไร ใบนี้กลับด้านกัน
 *
 * ── ต้นทางคือแผนการสอน ไม่ใช่คาบที่ลงตารางแล้ว ──
 *
 * ตั้งใจเลือกแบบนี้ วิชาที่ยังจัดคาบไม่ลงจะได้ยังโผล่บนใบ พร้อมจำนวนคาบที่
 * ควรมี ถ้าอ่านจากคาบที่ลงตารางแล้ว วิชาที่ยังไม่ได้ลงจะหายไปจากใบเงียบ ๆ
 * ซึ่งอันตรายกว่ามาก — คนอ่านจะไม่มีทางรู้ว่ามันหาย
 */
import { classRanges } from "./classRange";

/** หนึ่งบรรทัดในตาราง = ครูหนึ่งคนในวิชาหนึ่งวิชา รวมทุกห้องที่เขาสอน */
export interface RosterLine {
  teacherId: number;
  /** ชื่อครู หรือ "ยังไม่ได้เลือกครู" เมื่อโรงเรียนยังไม่ได้เลือก */
  teacherName: string;
  teacherCode: string;
  /** ห้องเรียนที่สอน ย่อเป็นช่วงแล้ว เช่น "1/1-6" */
  classes: string;
  classCount: number;
  /** คาบต่อสัปดาห์รวมทุกห้องของครูคนนี้ในวิชานี้ */
  periods: number;
  /** ครูคนนี้เข้าห้องในฐานะครูสอนร่วม ไม่ใช่ครูประจำวิชา */
  coTeaching: boolean;
}

export interface RosterSubject {
  subjectId: number;
  code: string;
  name: string;
  lines: RosterLine[];
  /** จำนวนห้องเรียนที่เรียนวิชานี้ นับห้องละครั้งแม้มีครูสองคนในห้อง */
  classCount: number;
  /** คาบต่อสัปดาห์ของทั้งวิชา นับคาบละครั้งแม้มีครูสองคนในคาบ */
  periods: number;
}

export interface RosterDept {
  deptId: number;
  deptName: string;
  subjects: RosterSubject[];
}

/** แถวแผนการสอนเท่าที่ใบนี้ต้องใช้ — รับแบบหลวม ๆ เพื่อให้ทดสอบได้ไม่ต้องสร้างทั้งก้อน */
export interface RosterInput {
  subject_id: number;
  teacher_id: number;
  group_id: number;
  weekly_count: number;
  co_teacher_id?: number | null;
  co_half?: boolean;
  served_by_elective?: boolean;
}

export interface RosterLookups {
  subject: (id: number) => { code: string; name: string; departmentId: number } | undefined;
  teacher: (id: number) => { name: string; code: string } | undefined;
  group: (id: number) => string | undefined;
  department: (id: number) => string | undefined;
}

/** ยังไม่ได้เลือกครู — แผนการสอนเก็บเป็นเลขศูนย์ ไม่ใช่ค่าว่าง */
export const NO_TEACHER = 0;
const NO_TEACHER_LABEL = "ยังไม่ได้เลือกครู";

interface Bucket {
  teacherId: number;
  coTeaching: boolean;
  groups: Set<number>;
  periods: number;
}

/**
 * ประกอบตารางรายวิชา
 *
 * ── แถวที่ไม่นับ ──
 *
 * `served_by_elective` คือสิทธิ์ที่ห้องเรียนนั้นจะเลือกวิชานี้ในคาบเสรี ไม่ใช่
 * ชั่วโมงสอนจริง ชั่วโมงจริงคือคาบเสรีเอง ถ้านับด้วยวิชาเดียวจะโผล่สองหน
 *
 * ── คาบที่นับครั้งเดียว ──
 *
 * สอนร่วมคือครูสองคนในห้องเดียวคาบเดียว ไม่ใช่สองคาบ ครูทั้งสองจึงขึ้นชื่อ
 * ทั้งคู่ แต่ยอดรวมของวิชานับคาบนั้นครั้งเดียว — `co_half` คือครึ่งหลังของคู่
 * ที่เขียนไว้สองแถว ชื่อครูขึ้น แต่คาบไม่ถูกนับซ้ำ
 */
export function buildSubjectRoster(
  rows: readonly RosterInput[], look: RosterLookups,
): RosterDept[] {
  // subjectId → teacherKey → Bucket
  const bySubject = new Map<number, Map<string, Bucket>>();
  const subjectGroups = new Map<number, Set<number>>();
  const subjectPeriods = new Map<number, number>();

  const bucket = (subjectId: number, teacherId: number, co: boolean): Bucket => {
    let perSubject = bySubject.get(subjectId);
    if (!perSubject) bySubject.set(subjectId, perSubject = new Map());
    // ครูคนเดียวกันอาจเป็นทั้งครูประจำวิชาและครูสอนร่วมในวิชาเดียวกัน
    // ต้องแยกบรรทัด ไม่งั้นจะอ่านไม่ออกว่าบทบาทไหนกี่คาบ
    const key = `${teacherId}:${co ? "co" : "main"}`;
    let b = perSubject.get(key);
    if (!b) perSubject.set(key, b = { teacherId, coTeaching: co, groups: new Set(), periods: 0 });
    return b;
  };

  for (const r of rows ?? []) {
    if (r.served_by_elective) continue;
    const weekly = Number.isFinite(r.weekly_count) ? Math.max(0, r.weekly_count) : 0;

    const main = bucket(r.subject_id, r.teacher_id ?? NO_TEACHER, false);
    main.groups.add(r.group_id);
    if (!r.co_half) main.periods += weekly;

    if (r.co_teacher_id) {
      const co = bucket(r.subject_id, r.co_teacher_id, true);
      co.groups.add(r.group_id);
      co.periods += weekly;
    }

    let gs = subjectGroups.get(r.subject_id);
    if (!gs) subjectGroups.set(r.subject_id, gs = new Set());
    gs.add(r.group_id);
    if (!r.co_half) {
      subjectPeriods.set(r.subject_id, (subjectPeriods.get(r.subject_id) ?? 0) + weekly);
    }
  }

  // ── ประกอบเป็นวิชา แล้วจัดเข้ากลุ่มสาระ ──
  const byDept = new Map<number, RosterSubject[]>();
  for (const [subjectId, buckets] of bySubject) {
    const info = look.subject(subjectId);
    const lines: RosterLine[] = [...buckets.values()]
      .map((b) => {
        const t = b.teacherId === NO_TEACHER ? undefined : look.teacher(b.teacherId);
        const names = [...b.groups].map((g) => look.group(g) ?? "");
        return {
          teacherId: b.teacherId,
          teacherName: t?.name ?? (b.teacherId === NO_TEACHER ? NO_TEACHER_LABEL : ""),
          teacherCode: t?.code ?? "",
          classes: classRanges(names),
          classCount: b.groups.size,
          periods: b.periods,
          coTeaching: b.coTeaching,
        };
      })
      // ครูประจำวิชาขึ้นก่อนครูสอนร่วม แล้วเรียงตามรหัสครู เพื่อให้ใบที่พิมพ์
      // สองครั้งติดกันออกมาเหมือนกัน ไม่ใช่สลับที่ตามลำดับในฐานข้อมูล
      .sort((a, b) =>
        Number(a.coTeaching) - Number(b.coTeaching) ||
        a.teacherCode.localeCompare(b.teacherCode, "th") ||
        a.teacherName.localeCompare(b.teacherName, "th"));

    const subject: RosterSubject = {
      subjectId,
      code: info?.code ?? "",
      name: info?.name ?? "",
      lines,
      classCount: subjectGroups.get(subjectId)?.size ?? 0,
      periods: subjectPeriods.get(subjectId) ?? 0,
    };
    const dept = info?.departmentId ?? 0;
    const list = byDept.get(dept);
    if (list) list.push(subject);
    else byDept.set(dept, [subject]);
  }

  return [...byDept.entries()]
    .map(([deptId, subjects]) => ({
      deptId,
      deptName: look.department(deptId) ?? "ไม่ได้ระบุกลุ่มสาระ",
      subjects: subjects.sort((a, b) =>
        a.code.localeCompare(b.code, "th") || a.name.localeCompare(b.name, "th")),
    }))
    .sort((a, b) => a.deptName.localeCompare(b.deptName, "th"));
}
