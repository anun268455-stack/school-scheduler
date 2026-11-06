/**
 * ทดสอบ utils/workloadRows — บรรทัดวิชาในใบอัตรากำลังการสอน
 *
 *   "ตอนนี้เวลาปริ้นอัตรากำลัง วิชาเสรีไม่ขึ้นกับครู
 *    คาบคุณธรรม สาธา ไม่ต้องขึ้นเลขห้อง"
 *
 * ข้อมูลทดสอบสร้างตามรูปแบบที่โรงเรียนใช้จริง: คาบเสรีไม่มี elective_pool_id
 * และเขียนไว้แถวละห้องเรียน — บทเรียนจากรอบที่แล้วที่เขียนตัวทดสอบให้ตรงกับที่
 * ตัวเองทำ แทนที่จะตรงกับที่โรงเรียนมี
 */
import {
  workloadRows,
} from "../../frontend/src/utils/workloadRows.ts";

let n = 0;
const ok = (cond: boolean, what: string): void => {
  n++;
  if (!cond) { console.error("FAIL:", what); process.exit(1); }
};
const eq = (a: unknown, b: unknown, what: string): void =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${what} — ได้ ${JSON.stringify(a)}`);

// ชนิดจริงต้องการช่องอีกมากที่เรื่องนี้ไม่ใช้ จึงประกอบเท่าที่ใช้แล้วแปลงชนิด
type Slot = Record<string, unknown>;
const slots = (xs: Slot[]) => xs as never;

const CODES: Record<number, string> = { 101: "ค21102", 102: "ค21215", 301: "ศ21201" };
const look = {
  codeOf: (id: number) => CODES[id],
  classOf: (s: { group_name?: string | null }) =>
    String(s.group_name ?? "").replace(/^ม\.?\s*/, ""),
} as never;

const lesson = (id: number, day: number, period: number, subject: number,
                teacher: number, group: string): Slot => ({
  id, day, period, subject_id: subject, teacher_id: teacher, group_name: group,
  co_teacher_id: null, is_elective: false, is_activity_block: false,
  elective_options: [], activity_teacher_ids: [],
});

/** คาบกิจกรรม — ทั้งระดับทำพร้อมกัน เขียนไว้แถวละห้องเรียน ผูกด้วย activity_key */
const activity = (id: number, day: number, period: number, subject: number,
                  key: string, group: string, duty: number[]): Slot => ({
  id, day, period, subject_id: subject, teacher_id: null, group_name: group,
  co_teacher_id: null, is_elective: false, is_activity_block: true,
  activity_key: key, elective_options: [], activity_teacher_ids: duty,
  subject_code: subject === 901 ? "คุณธรรม" : "สาธารณประโยชน์",
});

/** คาบเสรีแบบที่โรงเรียนใช้ — ไม่มี pool ตัวเลือกไม่มี key id ต่างกันทุกสำเนา */
const elective = (id: number, day: number, period: number, group: string,
                  opts: { subject: number; teacher: number; label: string }[]): Slot => ({
  id, day, period, subject_id: null, subject_code: null, teacher_id: null,
  group_name: group, co_teacher_id: null, is_elective: true,
  is_activity_block: false, elective_pool_id: null,
  activity_teacher_ids: [],
  elective_options: opts.map((o, i) => ({
    id: id * 100 + i, subject_id: o.subject, teacher_id: o.teacher, label: o.label,
  })),
});

const T = 7;   // ครูที่เราดู

// ── ๑ วิชาปกติ ──────────────────────────────────────────────────────────────
const plain = [
  lesson(1, 0, 1, 101, T, "ม.1/3"),
  lesson(2, 0, 2, 101, T, "ม.1/5"),
  lesson(3, 1, 1, 101, T, "ม.1/3"),
  lesson(4, 1, 3, 102, T, "ม.1/2"),
];
const r1 = workloadRows(slots(plain), T, look);
eq(r1.length, 2, "สองวิชา");
eq(r1[0].code, "ค21102", "รหัสจากทะเบียนวิชา");
eq(r1[0].periods, 3, "นับคาบรวม");
eq(r1[0].classes, ["1/3", "1/5"], "ชั้นไม่ซ้ำ เรียงตามเลข");
eq(r1[1].classes, ["1/2"], "อีกวิชา");

// ── ๒ คาบเสรีต้องขึ้น — ข้อที่หายไปทั้งใบ ──────────────────────────────────
//
// คาบเสรีหนึ่งหน้าต่าง เขียนไว้สี่ห้องเรียน ครู T สอน "ปฏิบัติขิม" หนึ่งวิชา
const OPTS = [
  { subject: 301, teacher: T, label: "ปฏิบัติขิม" },
  { subject: 302, teacher: 9, label: "ปฏิบัติซอ" },
];
const window1 = [
  elective(11, 2, 7, "ม.2/7", OPTS),
  elective(12, 2, 7, "ม.2/8", OPTS),
  elective(13, 2, 7, "ม.2/9", OPTS),
  elective(14, 2, 7, "ม.2/10", OPTS),
];
const r2 = workloadRows(slots(window1), T, look);
eq(r2.length, 1, "คาบเสรีขึ้นเป็นหนึ่งบรรทัด (ของเดิมไม่ขึ้นเลย)");
eq(r2[0].code, "ศ21201", "ใช้รหัสของวิชาที่ครูคนนั้นสอน ไม่ใช่ของทั้งคาบ");
eq(r2[0].periods, 1, "สี่ห้องเรียนในหน้าต่างเดียว = หนึ่งคาบ ไม่ใช่สี่");
eq(r2[0].classes, ["2/10", "2/7", "2/8", "2/9"].sort((a, b) =>
   a.localeCompare(b, undefined, { numeric: true })),
   "ชั้นที่สอนคือทุกห้องเรียนที่ส่งนักเรียนมา");
ok(r2[0].isElective, "ทำเครื่องหมายว่าเป็นคาบเสรี");

// ครูคนอื่นในหน้าต่างเดียวกันได้วิชาของตัวเอง ไม่ใช่ของคนแรก
const r2b = workloadRows(slots(window1), 9, look);
eq(r2b.length, 1, "ครูอีกคนก็ขึ้น");
eq(r2b[0].code, "ปฏิบัติซอ", "วิชาที่ไม่มีรหัสในทะเบียน ใช้ชื่อแทน");

// ครูที่ไม่ได้สอนอะไรในหน้าต่างนั้น ต้องไม่ได้บรรทัดมาฟรี ๆ
eq(workloadRows(slots(window1), 99, look), [], "ครูที่ไม่เกี่ยวข้อง");

// คาบเสรีคู่ (สองคาบติดกัน) นับสองคาบ เพราะเป็นสองชั่วโมงจริง
const dbl = [
  ...window1,
  elective(15, 4, 7, "ม.6/9", [{ subject: 301, teacher: T, label: "ปฏิบัติขิม" }]),
  elective(16, 4, 8, "ม.6/9", [{ subject: 301, teacher: T, label: "ปฏิบัติขิม" }]),
];
eq(workloadRows(slots(dbl), T, look)[0].periods, 3, "คาบคู่นับสองชั่วโมง");

// ── ๓ คาบกิจกรรม: ไม่ขึ้นเลขชั้น ───────────────────────────────────────────
//
// เลขชั้นที่ติดมากับแถวคือห้องไหนก็ได้ที่บังเอิญมาก่อน — ครูคนหนึ่งเคยขึ้น 1/1
// อีกคนขึ้น 3/1 ทั้งที่ทำกิจกรรมเดียวกันทั้งระดับ
const acts = [
  activity(21, 0, 7, 901, "ACT-moral", "ม.1/1", [T, 9]),
  activity(22, 0, 7, 901, "ACT-moral", "ม.1/2", [T, 9]),
  activity(23, 0, 7, 901, "ACT-moral", "ม.3/1", [T, 9]),
  activity(24, 0, 8, 902, "ACT-public", "ม.4/1", [T]),
];
const r3 = workloadRows(slots(acts), T, look);
eq(r3.length, 2, "สองกิจกรรม");
const moral = r3.find((r) => r.code === "คุณธรรม")!;
eq(moral.classes, [], "คุณธรรมไม่ขึ้นเลขชั้น");
eq(moral.periods, 1, "สามห้องเรียนในกิจกรรมเดียว = หนึ่งคาบ");
ok(moral.isActivity, "ทำเครื่องหมายว่าเป็นคาบกิจกรรม");
eq(r3.find((r) => r.code === "สาธารณประโยชน์")!.classes, [],
   "สาธารณประโยชน์ก็ไม่ขึ้น");

// ── ๔ ปนกันทั้งสามแบบ ───────────────────────────────────────────────────────
const mixed = [...plain, ...window1, ...acts];
const r4 = workloadRows(slots(mixed), T, look);
eq(r4.length, 5, "สองวิชาปกติ + หนึ่งวิชาเสรี + สองกิจกรรม");
eq(r4.reduce((a, r) => a + r.periods, 0), 3 + 1 + 1 + 1 + 1,
   "รวมคาบถูกต้อง ไม่นับสำเนาซ้ำ");
// วิชาปกติยังมีเลขชั้นเหมือนเดิม — การแก้เรื่องกิจกรรมต้องไม่ลามไปโดนของอื่น
eq(r4.find((r) => r.code === "ค21102")!.classes, ["1/3", "1/5"], "วิชาปกติไม่กระทบ");
eq(r4.find((r) => r.code === "ศ21201")!.classes.length, 4, "คาบเสรีไม่กระทบ");

// ── ๕ ของที่ข้อมูลไม่ครบ ────────────────────────────────────────────────────
// ตัวเลือกที่ยังไม่ได้ระบุวิชา ไม่ควรทำให้ทั้งใบพัง และไม่ควรขึ้นบรรทัดเปล่า
const broken = [elective(31, 3, 2, "ม.5/1",
  [{ subject: null as unknown as number, teacher: T, label: "ยังไม่ระบุ" }])];
eq(workloadRows(slots(broken), T, look), [], "ตัวเลือกที่ไม่มีวิชา ถูกข้าม");

console.log(`ALL PASS (${n})`);
