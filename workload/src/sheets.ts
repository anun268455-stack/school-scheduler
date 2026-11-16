// ตรรกะล้วนของหน้าสรุปอัตรากำลังสองแบบ — แทนชีต Excel เดิมของโรงเรียน (แบบข้อ 2 ข้อ 5) · node รันตรง ๆ ใน tests/ts/wlsheets.ts
// import ได้เฉพาะ import type และฟังก์ชันจากไฟล์ล้วนด้วยกัน (curriculum.ts · round.ts) — ไม่มี React/axios
// ไม่แก้ลิสต์ที่ส่งเข้า: ทุกฟังก์ชันสร้างของใหม่
//
// กฎนับคาบของแบบครูผู้สอนต้องเท่ากับ wl_teacher_loads ของเซิร์ฟเวอร์ (สเปก 4.4 ข. — กฎตัวเดียว อยู่ที่เซิร์ฟเวอร์)
// ชีตนับเองเพราะต้องแยกยอดเป็นรายวิชา/รายห้อง ซึ่งเซิร์ฟเวอร์ไม่ส่ง · ตัวทดสอบเรียก wl_teacher_loads ตัวจริงเทียบทุกครู
// ยอด "ทั้งรอบ" (รวมกลุ่มอื่น) ยังมาจากเซิร์ฟเวอร์ (GET .../loads) เพราะหัวหน้าไม่มีแถวของกลุ่มอื่นให้นับ
import { KIND_TEXT, levelOf, roomRange, SET_KIND_TEXT, type SetKind } from "./curriculum";
import {
  groupBySubject, optionState, rowState, fillProgress, type Round, type RoundOption, type RoundRow, type RowKind,
  type TeacherLoad,
} from "./round";
import type { WlTeacher } from "./types";

export type SheetKind = "subject" | "teacher";

const SHEET_NAME: Record<SheetKind, string> = {
  subject: "สรุปอัตรากำลังแบบรายวิชา",
  teacher: "สรุปอัตรากำลังแบบครูผู้สอน",
};

/** หัวกระดาษสามบรรทัดของชีตเดิม · ชื่อกลุ่มใช้ตามทะเบียน (ส่วนใหญ่ขึ้นต้นด้วย "กลุ่มสาระ" อยู่แล้ว) · null = ทุกกลุ่มสาระ */
export function sheetTitle(kind: SheetKind, semester: number, year: number, deptName: string | null): [string, string, string] {
  return [SHEET_NAME[kind], `ภาคเรียนที่ ${semester} ปีการศึกษา ${year}`, deptName ?? "ทุกกลุ่มสาระ"];
}

// ตัวเลขนำหน้าเหมือนช่องประเภทวิชาของชีตเดิม (เรียงในไฟล์ Excel ได้) · กิจกรรมไม่มีเลข
const KIND_LABEL: Record<RowKind, string> = {
  basic: `1 ${KIND_TEXT.basic}`,
  additional: `2 ${KIND_TEXT.additional}`,
  activity: KIND_TEXT.activity,
};

export function kindLabel(kind: RowKind): string {
  return KIND_LABEL[kind];
}

// ตัวเลือกของชุดไม่มีประเภทวิชาของตัวเอง: วิชาเลือกเสรีเป็นรายวิชาเพิ่มเติมตามหลักสูตรแกนกลาง · ชุดกิจกรรม = กิจกรรมพัฒนาผู้เรียน
const SET_ROW_KIND: Record<SetKind, RowKind> = { elective: "additional", activity: "activity" };

const LEVEL_TONES: Record<string, string> = {
  "ม.1": "lv-1", "ม.2": "lv-2", "ม.3": "lv-3", "ม.4": "lv-4", "ม.5": "lv-5", "ม.6": "lv-6",
};

/** คลาสสีอ่อนของป้ายชั้น (นิยามใน index.css) — หกระดับหกสี · ชื่อที่ไม่ใช่ระดับเดียว (คร่อมหลายระดับ ห้องแปลก) = สีกลาง
 *  ป้ายมีตัวอักษร "ม.N" เสมอ สีเป็นแค่ตัวช่วยกวาดตา พิมพ์ขาวดำก็ยังอ่านได้ */
export function levelTone(level: string | null): string {
  return (level !== null && LEVEL_TONES[level]) || "lv-x";
}

/** ป้ายชั้นของก้อน: ห้องทุกห้องอยู่ระดับเดียว = ระดับนั้น · คร่อมหลายระดับ = ทุกระดับ ("ม.4 ม.5") ไม่ใช่แค่ระดับของห้องแรก */
function blockLevel(rooms: readonly string[]): string | null {
  const levels = [...new Set(rooms.map(levelOf).filter((l): l is string => l !== null))];
  levels.sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  return levels.length ? levels.join(" ") : null;
}

const setText = (o: Pick<RoundOption, "set">): string => `${SET_KIND_TEXT[o.set.kind]} “${o.set.name}”`;

// ════ แบบรายวิชา: วิชาไหนครูคนไหนสอน ════════════════════════════════════

/** หนึ่งบรรทัด = หนึ่งห้อง (ตัวเลือกของชุด: หนึ่งบรรทัด ห้อง = ช่วงห้องของชุด)
 *  teacher1/teacher2 = null เมื่อไม่มี (หน้าแสดง "—") · pending = ยังไม่มีครูหรือยังไม่ยืนยัน (ตามสถานะเดียวกับหน้ากรอก) */
export type SubjectLine = { room: string; teacher1: string | null; teacher2: string | null; pending: boolean };

export type SubjectBlock = {
  /** ลำดับที่ นับ 1… ต่อก้อน */
  no: number;
  level: string | null;
  semester: number;
  code: string;
  name: string;
  credits: number | null;
  weekly: number;
  kindLabel: string;
  /** ก้อนของตัวเลือกคาบเสรี/กิจกรรม: ชนิดและชื่อชุด · แถววิชาธรรมดา = null */
  setText: string | null;
  lines: SubjectLine[];
};

/** ครู 1/2 ของตัวเลือก: สองคนแรกตามลำดับที่ใส่ (id ของครูของตัวเลือก) · เกินสองคน ครู 2 บอกจำนวนที่เหลือ · ครูที่ id ว่างไม่นับ */
function optionTeachers(o: RoundOption, teacherName: (id: number) => string): [string | null, string | null] {
  const ids = [...o.teachers].filter((t) => t.teacher_id !== null).sort((a, b) => a.id - b.id).map((t) => t.teacher_id!);
  const first = ids.length > 0 ? teacherName(ids[0]) : null;
  if (ids.length < 2) return [first, null];
  const rest = ids.length - 2;
  return [first, teacherName(ids[1]) + (rest > 0 ? ` และอีก ${rest} คน` : "")];
}

/** ชีตแบบรายวิชา: แถววิชาจัดก้อนด้วย groupBySubject (วิชาเดียวกันจากทุกหลักสูตร = ก้อนเดียว เรียงตามระดับ → รหัส · ห้องแบบตัวเลข)
 *  แล้วต่อท้ายด้วยก้อนละหนึ่งตัวเลือกของชุดคาบเสรี/กิจกรรม ตามลำดับของเซิร์ฟเวอร์ (ชุด → ตัวเลือก) เหมือนหน้ากรอก
 *  แถว/ตัวเลือกที่ยังไม่มีครูอยู่ในชีตเสมอ (ช่องครูว่าง) · semester = ภาคเรียนของรอบ (แถวไม่มีช่องภาคเรียน) */
export function subjectSheet(
  rows: readonly RoundRow[],
  options: readonly RoundOption[],
  teacherName: (id: number) => string,
  semester: number,
): SubjectBlock[] {
  const name = (id: number | null): string | null => (id === null ? null : teacherName(id));
  const blocks: Omit<SubjectBlock, "no">[] = groupBySubject(rows).map((g) => ({
    level: blockLevel(g.rows.map((r) => r.group_name)),
    semester,
    code: g.code,
    name: g.name,
    credits: g.credits,
    weekly: g.weekly,
    kindLabel: kindLabel(g.kind),
    setText: null,
    lines: g.rows.map((r) => ({
      room: r.group_name,
      teacher1: name(r.teacher_id),
      teacher2: name(r.co_teacher_id),
      pending: rowState(r) !== "done",
    })),
  }));
  for (const o of options) {
    const [teacher1, teacher2] = optionTeachers(o, teacherName);
    blocks.push({
      level: blockLevel(o.set.group_names),
      semester,
      code: o.code,
      name: o.name,
      credits: null,
      weekly: o.set.weekly,
      kindLabel: kindLabel(SET_ROW_KIND[o.set.kind]),
      setText: setText(o),
      lines: [{ room: roomRange(o.set.group_names), teacher1, teacher2, pending: optionState(o) !== "done" }],
    });
  }
  return blocks.map((b, i) => ({ no: i + 1, ...b }));
}

// ════ แบบครูผู้สอน: ครูคนไหนสอนอะไร ════════════════════════════════════

export type TeacherLine = { room: string; weekly: number; pending: boolean };

export type TeacherSubject = {
  code: string;
  name: string;
  credits: number | null;
  kindLabel: string;
  /** จำนวนคาบของวิชานี้ของครูคนนี้ = Σ คาบ/สัปดาห์ของแถว (ตัวเลือกของชุด: คาบ/สัปดาห์ของชุดครั้งเดียว ไม่คูณห้อง) */
  periods: number;
  setText: string | null;
  lines: TeacherLine[];
};

export type TeacherBlock = {
  no: number;
  teacherId: number;
  name: string;
  /** ยอดทั้งรอบ (GET .../loads) — ไม่น้อยกว่า ownTotal */
  total: number;
  /** ยอดจากรายการในชีตนี้ = Σ periods */
  ownTotal: number;
  /** สอนกลุ่มอื่น = total − ownTotal (≥ 0) */
  otherTotal: number;
  subjects: TeacherSubject[];
};

type TeacherRef = Pick<WlTeacher, "id" | "name" | "department_id"> & { dept_order?: number | null };

// เรียงชื่อแบบพจนานุกรมไทยเหมือนตัวเลือกครูของหน้ากรอก — เป็นแค่ลำดับบนกระดาษ
const thaiOrder = new Intl.Collator("th").compare;
const nullsLast = (a: number | null | undefined, b: number | null | undefined): number =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b;

/** ชีตแบบครูผู้สอน: ครูหนึ่งคนหนึ่งก้อน วิชาเป็นก้อนย่อย (ห้องละบรรทัด) · ครูสอนร่วมได้แถวนั้นในก้อนของตัวเองด้วย
 *  กฎนับ = wl_teacher_loads: แถว → คาบ/สัปดาห์ให้ครูผู้สอนและครูสอนร่วม (คนเดียวกันสองช่องได้ครั้งเดียว)
 *  · ตัวเลือก → คาบ/สัปดาห์ของชุดครั้งเดียวต่อชุดต่อครู (สองตัวเลือกในชุดเดียว หรือซ้ำในตัวเลือกเดียว ก็ครั้งเดียว — รวมเป็นรายการเดียว)
 *  loads = ยอดทั้งรอบจากเซิร์ฟเวอร์ · null = ชีตนี้มีทุกรายการของรอบแล้ว (ทุกกลุ่ม) จึงไม่มีส่วนของกลุ่มอื่น
 *  แถว/ตัวเลือกที่ยังไม่มีครูไม่อยู่ในชีตนี้ (อยู่ในแบบรายวิชา) · เรียงครูตามกลุ่มสาระ → ลำดับในกลุ่ม → ชื่อ → id */
export function teacherSheet(
  rows: readonly RoundRow[],
  options: readonly RoundOption[],
  teachers: readonly TeacherRef[],
  loads: readonly TeacherLoad[] | null,
): TeacherBlock[] {
  const rowsOf = new Map<number, RoundRow[]>();
  for (const r of rows) {
    for (const t of new Set([r.teacher_id, r.co_teacher_id])) {
      if (t === null) continue;
      const list = rowsOf.get(t);
      if (list) list.push(r);
      else rowsOf.set(t, [r]);
    }
  }
  // ครู → ชุด → ตัวเลือกที่ครูคนนี้อยู่ (ไม่ซ้ำ ตามลำดับของเซิร์ฟเวอร์)
  const setsOf = new Map<number, Map<number, RoundOption[]>>();
  for (const o of options) {
    for (const x of o.teachers) {
      if (x.teacher_id === null) continue;
      let sets = setsOf.get(x.teacher_id);
      if (!sets) setsOf.set(x.teacher_id, (sets = new Map()));
      const list = sets.get(o.set_id);
      if (!list) sets.set(o.set_id, [o]);
      else if (!list.includes(o)) list.push(o);
    }
  }

  const reg = new Map(teachers.map((t) => [t.id, t]));
  const loadOf = new Map((loads ?? []).map((l) => [l.teacher_id, l]));
  const ids = [...new Set([...rowsOf.keys(), ...setsOf.keys()])];
  const who = (id: number) => {
    const t = reg.get(id);
    const l = loadOf.get(id);
    return {
      name: t?.name ?? l?.name ?? `ครูรหัส ${id}`,
      dept: t ? t.department_id : (l?.department_id ?? null),
      order: t?.dept_order ?? null,
    };
  };
  ids.sort((a, b) => {
    const x = who(a);
    const y = who(b);
    return nullsLast(x.dept, y.dept) || nullsLast(x.order, y.order) || thaiOrder(x.name, y.name) || a - b;
  });

  return ids.map((id, i) => {
    const subjects: TeacherSubject[] = groupBySubject(rowsOf.get(id) ?? []).map((g) => ({
      code: g.code,
      name: g.name,
      credits: g.credits,
      kindLabel: kindLabel(g.kind),
      periods: g.rows.reduce((n, r) => n + r.weekly, 0),
      setText: null,
      lines: g.rows.map((r) => ({ room: r.group_name, weekly: r.weekly, pending: rowState(r) !== "done" })),
    }));
    for (const list of (setsOf.get(id) ?? new Map<number, RoundOption[]>()).values()) {
      const set = list[0].set;
      subjects.push({
        code: list.map((o) => o.code).join(" / "),
        name: list.map((o) => o.name).join(" / "),
        credits: null,
        kindLabel: kindLabel(SET_ROW_KIND[set.kind]),
        periods: set.weekly,
        setText: setText(list[0]),
        lines: [{ room: roomRange(set.group_names), weekly: set.weekly, pending: list.some((o) => optionState(o) !== "done") }],
      });
    }
    const ownTotal = subjects.reduce((n, s) => n + s.periods, 0);
    // แถวกับยอดมาจากสองคำขอ — ถ้ามีคนแก้ระหว่างนั้น ยอดทั้งรอบอาจน้อยกว่าที่ชีตนับเห็น · ไม่ให้ "สอนกลุ่มอื่น" ติดลบ
    const total = loads === null ? ownTotal : Math.max(loadOf.get(id)?.total ?? ownTotal, ownTotal);
    return { no: i + 1, teacherId: id, name: who(id).name, total, ownTotal, otherTotal: total - ownTotal, subjects };
  });
}

// ════ บรรทัดใต้หัว และรอบที่หน้าเปิด ═════════════════════════════════════

/** "ยังไม่ยืนยัน N รายการ · ยังไม่มีครู M รายการ — …" นับแบบเดียวกับหน้ากรอก (fillProgress = wl_fill_counts) · ครบแล้ว = null
 *  ชีตแสดงทุกแถวไม่ว่ายืนยันหรือยัง บรรทัดนี้บอกคนอ่านกระดาษว่ายังไม่ใช่ฉบับสุดท้าย */
export function pendingNote(rows: readonly RoundRow[], options: readonly RoundOption[]): string | null {
  const p = fillProgress(rows, options);
  const unconfirmed = p.total - p.confirmed - p.missingTeacher;
  const bits = [
    ...(unconfirmed > 0 ? [`ยังไม่ยืนยัน ${unconfirmed.toLocaleString("th-TH")} รายการ`] : []),
    ...(p.missingTeacher > 0 ? [`ยังไม่มีครู ${p.missingTeacher.toLocaleString("th-TH")} รายการ`] : []),
  ];
  return bits.length ? `${bits.join(" · ")} — ชื่อครูในชีตนี้อาจยังเปลี่ยน` : null;
}

/** รอบที่หน้าสรุปเปิดเป็นค่าเริ่มต้น: รอบที่ยังไม่ปิด (มีได้รอบเดียว) · ไม่มี = รอบล่าสุดตามปี/ภาค · ไม่มีรอบ = null */
export function sheetRound<R extends Pick<Round, "status" | "year" | "semester">>(rounds: readonly R[]): R | null {
  const open = rounds.find((r) => r.status !== "closed");
  if (open) return open;
  return [...rounds].sort((a, b) => b.year - a.year || b.semester - a.semester)[0] ?? null;
}
