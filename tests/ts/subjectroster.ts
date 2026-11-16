/**
 * ทดสอบ utils/subjectRoster — ใบรายวิชาว่าวิชาอันไหนใครสอนบ้าง
 *
 * ข้อที่สำคัญที่สุด: ไม่มีใครและไม่มีวิชาไหนหายจากใบเงียบ ๆ ครูที่ยังไม่ได้
 * เลือกต้องขึ้นว่า "ยังไม่ได้เลือกครู" ไม่ใช่หายไป และคาบของการสอนร่วมต้อง
 * ไม่ถูกนับสองหนจนยอดรวมของวิชาบวม
 */
import {
  buildSubjectRoster, NO_TEACHER,
  type RosterInput, type RosterLookups,
} from "../../frontend/src/utils/subjectRoster.ts";

let n = 0;
const ok = (cond: boolean, what: string): void => {
  n++;
  if (!cond) { console.error("FAIL:", what); process.exit(1); }
};
const eq = (a: unknown, b: unknown, what: string): void =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${what} — ได้ ${JSON.stringify(a)}`);

const look: RosterLookups = {
  subject: (id) => ({
    101: { code: "ท21101", name: "ภาษาไทย 1", departmentId: 1 },
    102: { code: "ท21103", name: "ประวัติวรรณคดี", departmentId: 1 },
    201: { code: "ค21101", name: "คณิตศาสตร์ 1", departmentId: 2 },
  }[id]),
  teacher: (id) => ({
    11: { name: "สมศรี ใจดี", code: "113" },
    12: { name: "วิชัย ตั้งใจ", code: "121" },
    13: { name: "มาลี ศรีสุข", code: "104" },
  }[id]),
  group: (id) => `ม.1/${id}`,
  department: (id) => ({ 1: "ภาษาไทย", 2: "คณิตศาสตร์" }[id]),
};

const row = (o: Partial<RosterInput> & Pick<RosterInput, "subject_id" | "teacher_id" | "group_id">): RosterInput =>
  ({ weekly_count: 3, ...o });

// ── รูปร่างพื้นฐาน ──────────────────────────────────────────────────────────
{
  const out = buildSubjectRoster([
    row({ subject_id: 101, teacher_id: 11, group_id: 1 }),
    row({ subject_id: 101, teacher_id: 11, group_id: 2 }),
    row({ subject_id: 101, teacher_id: 12, group_id: 3 }),
  ], look);

  eq(out.length, 1, "กลุ่มสาระเดียว");
  eq(out[0].deptName, "ภาษาไทย", "ชื่อกลุ่มสาระ");
  eq(out[0].subjects.length, 1, "วิชาเดียว");

  const s = out[0].subjects[0];
  eq(s.code, "ท21101", "รหัสวิชา");
  eq(s.lines.length, 2, "ครูสองคน");
  eq(s.lines[0].teacherName, "มาลี ศรีสุข".slice(0, 0) + "สมศรี ใจดี", "เรียงตามรหัสครู 113 มาก่อน 121");
  eq(s.lines[0].classes, "1/1-2", "ห้องของครูคนแรกย่อเป็นช่วง");
  eq(s.lines[0].periods, 6, "สองห้อง ห้องละ 3 คาบ");
  eq(s.classCount, 3, "ทั้งวิชามีสามห้อง");
  eq(s.periods, 9, "ทั้งวิชาเก้าคาบ");
}

// ── ครูที่ยังไม่ได้เลือก ต้องไม่หาย ─────────────────────────────────────────
{
  const out = buildSubjectRoster([
    row({ subject_id: 101, teacher_id: NO_TEACHER, group_id: 5 }),
  ], look);
  const line = out[0].subjects[0].lines[0];
  eq(line.teacherName, "ยังไม่ได้เลือกครู", "ขึ้นว่ายังไม่ได้เลือก ไม่ใช่ช่องว่าง");
  eq(line.periods, 3, "คาบยังถูกนับ จะได้เห็นว่ายังขาดครูกี่คาบ");
}

// ── สอนร่วม: ขึ้นชื่อทั้งคู่ แต่คาบนับครั้งเดียว ────────────────────────────
{
  const out = buildSubjectRoster([
    row({ subject_id: 201, teacher_id: 11, group_id: 1, co_teacher_id: 12 }),
  ], look);
  const s = out[0].subjects[0];
  eq(s.lines.length, 2, "ครูประจำวิชากับครูสอนร่วม คนละบรรทัด");
  eq(s.lines[0].coTeaching, false, "ครูประจำวิชาขึ้นก่อน");
  eq(s.lines[1].coTeaching, true, "ครูสอนร่วมขึ้นหลัง");
  eq(s.periods, 3, "ยอดรวมของวิชานับคาบนั้นครั้งเดียว ไม่ใช่หกคาบ");
  eq(s.classCount, 1, "และนับห้องครั้งเดียว");
}

// ── co_half: ครึ่งหลังของคู่ที่เขียนไว้สองแถว ───────────────────────────────
{
  const out = buildSubjectRoster([
    row({ subject_id: 201, teacher_id: 11, group_id: 1 }),
    row({ subject_id: 201, teacher_id: 12, group_id: 1, co_half: true }),
  ], look);
  const s = out[0].subjects[0];
  eq(s.lines.length, 2, "ครูขึ้นครบทั้งสองคน");
  eq(s.lines[1].coTeaching, true, "ครึ่งหลังคือครูสอนร่วม ไม่ใช่ครูประจำวิชา");
  // เดิมบรรทัดนี้ขึ้นเลข 0 ซึ่งอ่านแล้วเหมือนครูไม่ได้สอน ทั้งที่เข้าห้องจริงทุกคาบ
  eq(s.lines[1].periods, 3, "คาบขึ้นบนบรรทัดของครูจริง ไม่ใช่ศูนย์");
  eq(s.periods, 3, "แต่ยอดรวมของวิชาไม่ถูกนับซ้ำ");
}

// ── แถวสิทธิ์เลือกวิชาเสรี ไม่ใช่ชั่วโมงสอน ─────────────────────────────────
{
  const out = buildSubjectRoster([
    row({ subject_id: 101, teacher_id: 11, group_id: 1 }),
    row({ subject_id: 101, teacher_id: 11, group_id: 2, served_by_elective: true }),
  ], look);
  const s = out[0].subjects[0];
  eq(s.periods, 3, "แถวสิทธิ์เลือกไม่ถูกนับเป็นคาบ");
  eq(s.classCount, 1, "และไม่ถูกนับเป็นห้อง");
}

// ── เรียงลำดับให้พิมพ์สองครั้งได้ใบเหมือนกัน ───────────────────────────────
{
  const out = buildSubjectRoster([
    row({ subject_id: 201, teacher_id: 13, group_id: 1 }),
    row({ subject_id: 102, teacher_id: 11, group_id: 1 }),
    row({ subject_id: 101, teacher_id: 11, group_id: 1 }),
  ], look);
  eq(out.map((d) => d.deptName), ["คณิตศาสตร์", "ภาษาไทย"], "กลุ่มสาระเรียงตามชื่อ");
  eq(out[1].subjects.map((s) => s.code), ["ท21101", "ท21103"], "วิชาเรียงตามรหัส");
}

// ── ข้อมูลพิการ ต้องไม่ทำให้ทั้งใบพัง ───────────────────────────────────────
{
  eq(buildSubjectRoster([], look), [], "ไม่มีแผนการสอน = ใบว่าง");

  const unknown = buildSubjectRoster([
    row({ subject_id: 999, teacher_id: 99, group_id: 1 }),
  ], look);
  eq(unknown[0].deptName, "ไม่ได้ระบุกลุ่มสาระ", "วิชาที่ไม่รู้จักยังขึ้นใบ ไม่ถูกทิ้ง");
  eq(unknown[0].subjects[0].lines[0].teacherCode, "", "ครูที่ไม่รู้จักได้ช่องว่าง ไม่ใช่พัง");

  const nan = buildSubjectRoster([
    { subject_id: 101, teacher_id: 11, group_id: 1, weekly_count: NaN },
  ], look);
  eq(nan[0].subjects[0].periods, 0, "จำนวนคาบที่อ่านไม่ออกนับเป็นศูนย์ ไม่ใช่ NaN บนกระดาษ");
}

console.log(`ALL PASS (${n})`);
