/**
 * ทดสอบ workload/src/sheets.ts — ตรรกะล้วนของหน้าสรุปอัตรากำลังสองแบบ (แทนชีต Excel เดิมของโรงเรียน)
 *
 * จุดที่ต้องไม่พลาด:
 * · แบบรายวิชา: วิชาเดียวกันข้ามหลักสูตรเป็นก้อนเดียว (ส33102 ม.6/1–6/14 = 14 บรรทัด) ห้องเรียงแบบตัวเลข · แถวที่ยังไม่มีครูต้องอยู่
 * · แบบครูผู้สอน: กฎนับคาบต้องเท่ากับ wl_teacher_loads ของเซิร์ฟเวอร์ทุกตัวอักษร — ครูสอนร่วมได้คาบเท่ากัน คนเดียวกันสองช่องนับครั้งเดียว
 *   คาบเสรีนับครั้งเดียวต่อชุด ไม่คูณห้อง (สเปกหลักข้อทดสอบ 8) · ตัวทดสอบเรียก wl_teacher_loads ตัวจริงด้วย python3 บนข้อมูลชุดเดียวกัน
 *   (ไฟล์คำตอบร่วม seed_teacher_loads.json ใช้ไม่ได้ เพราะเป็นรหัสครูของโปรแกรมจัดตาราง ไม่ใช่รหัสของรอบ)
 * · ยอดของครูที่สอนข้ามกลุ่ม: สอนกลุ่มอื่น = ยอดทั้งรอบ − ยอดในชีตนี้ ไม่ติดลบ · ชีตทุกกลุ่มไม่มีส่วนของกลุ่มอื่น
 * · ครูชื่อซ้ำเป็นคนละก้อน (อ้างด้วย id) · ไม่แก้ลิสต์ที่ส่งเข้า
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OptionTeacher, Round, RoundOption, RoundRow, TeacherLoad } from "../../workload/src/round.ts";
import {
  kindLabel, levelTone, pendingNote, sheetRound, sheetTitle, subjectSheet, teacherSheet,
} from "../../workload/src/sheets.ts";

const fails: string[] = [];
const test = (name: string, fn: () => void): void => {
  try { fn(); } catch (e) { fails.push(`${name} — ${(e as Error).message}`); }
};
const eq = (a: unknown, b: unknown): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`ได้ ${JSON.stringify(a)} ควรเป็น ${JSON.stringify(b)}`);
  }
};
const ok = (cond: unknown, what: string): void => {
  if (!cond) throw new Error(what);
};

// ── ข้อมูลรูปเดียวกับที่ GET /rounds/{id}/rows คืน ────────────────────
let nextId = 1;
const W = (p: Partial<RoundRow> = {}): RoundRow => {
  const id = p.id ?? nextId++;
  const room = p.group_name ?? "ม.1/1";
  return {
    id, round_id: 1, line_id: id, curriculum_id: 1, curriculum_name: room, group_id: id, group_name: room,
    subject_id: 1, code: "ท21102", name: "ภาษาไทย 2", credits: 1.5, weekly: 3, kind: "basic", department_id: 5,
    teacher_id: null, co_teacher_id: null, lab_room_id: null, is_double: false, note: "", confirmed: true,
    from_plan: false, flag: null, ...p,
  };
};
const T = (id: number, teacher_id: number | null, p: Partial<OptionTeacher> = {}): OptionTeacher => ({
  id, round_id: 1, option_id: 1, set_id: 1, teacher_id, room_id: null, note: "", confirmed: true, from_plan: false, ...p,
});
const O = (p: Partial<RoundOption> & { rooms?: string[]; weekly?: number; setId?: number; setName?: string;
  setKind?: "elective" | "activity" } = {}): RoundOption => {
  const { rooms = ["ม.1/7", "ม.1/8"], weekly = 2, setId = 1, setName = "วิชาเสรี", setKind = "elective", ...rest } = p;
  return {
    id: nextId++, set_id: setId, subject_id: 9, code: "ศ20201", name: "ดนตรีสากล", department_id: 7,
    set: { id: setId, year: 2569, semester: 2, kind: setKind, name: setName, group_ids: rooms.map((_, i) => 500 + i),
      group_names: rooms, weekly, is_double: false },
    teachers: [], ...rest,
  };
};
const NAMES: Record<number, string> = {
  4: "นายเอ", 5: "นางบี", 6: "นายซี", 7: "นายดี", 8: "นางอี",
  71: "นางสาวธัญรัตน์ สาหร่าย", 77: "นายจิตกร อุทัยแพน", 136: "นายทัฬหมน คันธิก",
  90: "นายสมชาย ใจดี", 91: "นายสมชาย ใจดี",
};
const nameOf = (id: number): string => NAMES[id] ?? `ครูรหัส ${id}`;
type Reg = { id: number; name: string; department_id: number | null; dept_order: number | null };
const REG: Reg[] = [
  { id: 71, name: NAMES[71], department_id: 5, dept_order: 15 },
  { id: 77, name: NAMES[77], department_id: 5, dept_order: 11 },
  { id: 136, name: NAMES[136], department_id: 9, dept_order: 3 },
  { id: 90, name: NAMES[90], department_id: 5, dept_order: null },
  { id: 91, name: NAMES[91], department_id: 5, dept_order: null },
  { id: 4, name: NAMES[4], department_id: 7, dept_order: 1 },
  { id: 5, name: NAMES[5], department_id: 7, dept_order: 2 },
  { id: 6, name: NAMES[6], department_id: 7, dept_order: 3 },
  { id: 7, name: NAMES[7], department_id: null, dept_order: null },
  { id: 8, name: NAMES[8], department_id: 2, dept_order: 1 },
];
const L = (teacher_id: number, total: number, own = total): TeacherLoad =>
  ({ teacher_id, name: nameOf(teacher_id), department_id: REG.find((t) => t.id === teacher_id)?.department_id ?? null,
    total, own });
const frozen = <X>(x: X): X => {
  // แช่แข็งทุกชั้น — ฟังก์ชันที่แก้ลิสต์/ออบเจ็กต์ที่ส่งเข้าจะโยน TypeError ทันที
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) frozen(v);
    Object.freeze(x);
  }
  return x;
};

// ── หัวกระดาษ ────────────────────────────────────────────────────────
test("sheetTitle: สามบรรทัด ชื่อชีต · ภาคเรียน/ปีการศึกษา · กลุ่มสาระ (ไม่ระบุกลุ่ม = ทุกกลุ่มสาระ)", () => {
  eq(sheetTitle("subject", 2, 2569, "กลุ่มสาระสังคมศึกษา"),
    ["สรุปอัตรากำลังแบบรายวิชา", "ภาคเรียนที่ 2 ปีการศึกษา 2569", "กลุ่มสาระสังคมศึกษา"]);
  eq(sheetTitle("teacher", 1, 2570, null),
    ["สรุปอัตรากำลังแบบครูผู้สอน", "ภาคเรียนที่ 1 ปีการศึกษา 2570", "ทุกกลุ่มสาระ"]);
  // ชื่อกลุ่มใช้ตามทะเบียน ไม่เติมคำนำหน้าซ้ำ ("กลุ่มสาระกิจกรรม…" ผิด)
  eq(sheetTitle("subject", 2, 2569, "กิจกรรมพัฒนาผู้เรียน")[2], "กิจกรรมพัฒนาผู้เรียน");
});

test("kindLabel: ตัวเลขนำหน้าแบบชีตเดิม", () => {
  eq([kindLabel("basic"), kindLabel("additional"), kindLabel("activity")],
    ["1 พื้นฐาน", "2 เพิ่มเติม", "กิจกรรมพัฒนาผู้เรียน"]);
});

test("levelTone: หกระดับหกสีไม่ซ้ำ · ชื่อที่ไม่ใช่ระดับเดียวได้สีกลาง · ทุกคลาสมีใน index.css", () => {
  const six = ["ม.1", "ม.2", "ม.3", "ม.4", "ม.5", "ม.6"].map(levelTone);
  eq(new Set(six).size, 6);
  const plain = levelTone(null);
  ok(!six.includes(plain), "สีกลางต้องไม่ซ้ำกับสีของระดับ");
  eq(levelTone("ม.4 ม.5"), plain);
  eq(levelTone("ป.6"), plain);
  const css = readFileSync(new URL("../../workload/src/index.css", import.meta.url), "utf8");
  for (const c of [...six, plain]) ok(new RegExp(`\\.${c}\\s*\\{`).test(css), `index.css ไม่มีคลาส .${c}`);
});

// ── แบบรายวิชา ───────────────────────────────────────────────────────
test("subjectSheet: ส33102 สองครูสลับห้อง ม.6/1–6/14 จากหลายหลักสูตร → ก้อนเดียว 14 บรรทัด เรียงห้องแบบตัวเลข · ครูสอนร่วมอยู่ครู 2", () => {
  // ส่งเข้าแบบกลับลำดับ (ม.6/14 ก่อน) และต่างหลักสูตร — ต้องรวมเป็นก้อนเดียวแล้วเรียง ม.6/1, ม.6/2, … ม.6/10 (ไม่ใช่ ม.6/10 ก่อน ม.6/2)
  const s33 = Array.from({ length: 14 }, (_, i) => {
    const n = 14 - i;
    return W({ curriculum_id: 60 + (n % 5), curriculum_name: `หลักสูตร ${n % 5}`, group_name: `ม.6/${n}`,
      code: "ส33102", name: "สังคมศึกษา ศาสนาและวัฒนธรรม 6", credits: 1, weekly: 2, teacher_id: n % 2 ? 71 : 77,
      co_teacher_id: n === 3 ? 136 : null });
  });
  const s32 = [1, 2].map((n) => W({ group_name: `ม.5/${n}`, code: "ส32103", name: "สังคมศึกษา ศาสนาและวัฒนธรรม 4",
    credits: 1, weekly: 2, teacher_id: 71 }));
  const rows = frozen([...s33, ...s32]);
  const before = JSON.stringify(rows);
  const blocks = subjectSheet(rows, [], nameOf, 2);
  eq(JSON.stringify(rows), before);
  eq(blocks.map((b) => [b.no, b.code, b.lines.length]), [[1, "ส32103", 2], [2, "ส33102", 14]]);
  const b = blocks[1];
  eq([b.level, b.semester, b.name, b.credits, b.weekly, b.kindLabel, b.setText],
    ["ม.6", 2, "สังคมศึกษา ศาสนาและวัฒนธรรม 6", 1, 2, "1 พื้นฐาน", null]);
  eq(b.lines.map((l) => l.room), Array.from({ length: 14 }, (_, i) => `ม.6/${i + 1}`));
  eq(b.lines.slice(0, 4).map((l) => [l.teacher1, l.teacher2]),
    [[NAMES[71], null], [NAMES[77], null], [NAMES[71], NAMES[136]], [NAMES[77], null]]);
});

test("subjectSheet: แถวที่ยังไม่มีครูอยู่ในชีต (ครู 1 ว่าง) · แถวที่ยังไม่ยืนยันติดธง pending", () => {
  const rows = [W({ group_name: "ม.1/1", teacher_id: 4, confirmed: true }), W({ group_name: "ม.1/2", teacher_id: null }),
    W({ group_name: "ม.1/3", teacher_id: 5, confirmed: false })];
  const [b] = subjectSheet(rows, [], nameOf, 1);
  eq(b.lines.map((l) => [l.room, l.teacher1, l.pending]),
    [["ม.1/1", NAMES[4], false], ["ม.1/2", null, true], ["ม.1/3", NAMES[5], true]]);
  eq(b.semester, 1);
});

test("subjectSheet: ตัวเลือกคาบเสรีเป็นก้อนละตัวเลือกต่อท้าย ห้อง = ช่วงห้องของชุด · ครู 1/2 ตามลำดับ id · เกินสองคนบอกจำนวน · no ต่อเนื่อง", () => {
  const rows = [W({ group_name: "ม.2/1", code: "ท22102", name: "ภาษาไทย 4" }), W({ group_name: "ม.1/1" })];
  const options = frozen([
    O({ code: "ศ20201", name: "ดนตรีสากล", rooms: ["ม.1/7", "ม.1/8", "ม.1/9", "ม.1/10", "ม.1/11", "ม.1/12"],
      setName: "วิชาเสรี ม.1/7-12", teachers: [T(9, 5), T(3, 4)] }),
    O({ code: "ศ20202", name: "นาฏศิลป์", rooms: ["ม.1/5", "ม.1/1", "ม.1/2", "ม.1/3"], setId: 2,
      teachers: [T(11, 4), T(12, 5), T(13, 6), T(14, 7), T(15, null)] }),
    O({ code: "ก20901", name: "ชุมนุม", rooms: ["ม.4/1", "ม.5/1"], setId: 3, setKind: "activity", setName: "ชุมนุม ม.4-5",
      weekly: 1, teachers: [] }),
  ]);
  const before = JSON.stringify(options);
  const blocks = subjectSheet(rows, options, nameOf, 2);
  eq(JSON.stringify(options), before);
  eq(blocks.map((b) => b.no), [1, 2, 3, 4, 5]);
  eq(blocks.map((b) => b.code), ["ท21102", "ท22102", "ศ20201", "ศ20202", "ก20901"]);
  const [, , a, b, c] = blocks;
  eq([a.level, a.credits, a.weekly, a.kindLabel, a.setText], ["ม.1", null, 2, "2 เพิ่มเติม", "ชุดคาบเสรี “วิชาเสรี ม.1/7-12”"]);
  eq(a.lines, [{ room: "ม.1/7-12", teacher1: NAMES[4], teacher2: NAMES[5], pending: false }]);
  // ห้องไม่ต่อเนื่อง: แบบเดียวกับหน้าหลักสูตรและหน้ากรอก (roomRange) · ครูที่ id ว่างไม่นับ · คนที่สามขึ้นไปบอกเป็นจำนวน
  eq(b.lines, [{ room: "ม.1/1-3,5", teacher1: NAMES[4], teacher2: `${NAMES[5]} และอีก 2 คน`, pending: false }]);
  // ชุดกิจกรรมคร่อมสองระดับ: ป้ายชั้นบอกทั้งสองระดับ ไม่ใช่แค่ระดับของห้องแรก · ยังไม่มีครู = ช่องครูว่าง แต่ยังอยู่ในชีต
  eq([c.level, c.kindLabel, c.setText], ["ม.4 ม.5", "กิจกรรมพัฒนาผู้เรียน", "ชุดกิจกรรม “ชุมนุม ม.4-5”"]);
  eq(c.lines, [{ room: "ม.4/1 ม.5/1", teacher1: null, teacher2: null, pending: true }]);
});

test("subjectSheet: วิชาเดียวกันแต่คาบ/สัปดาห์ต่างกันเป็นคนละก้อน (หัวก้อนบอกค่าเดียว) เรียงตามห้องแรก · ลิสต์ว่าง = ไม่มีก้อน", () => {
  const rows = [W({ group_name: "ม.1/2", weekly: 2 }), W({ group_name: "ม.1/1", weekly: 3 })];
  eq(subjectSheet(rows, [], nameOf, 2).map((b) => [b.no, b.weekly, b.lines.length]), [[1, 3, 1], [2, 2, 1]]);
  eq(subjectSheet([], [], nameOf, 2), []);
});

// ── แบบครูผู้สอน ─────────────────────────────────────────────────────
// ครู 71 ของภาพชีตที่ผู้ใช้ส่งมา: ส32103 2 ห้อง × 2 คาบ + ส33102 7 ห้อง × 2 คาบ = 18
const s32of71 = (): RoundRow[] => [1, 2].map((n) => W({ group_name: `ม.5/${n}`, code: "ส32103",
  name: "สังคมศึกษา ศาสนาและวัฒนธรรม 4", credits: 1, weekly: 2, teacher_id: 71 }));
const s33of71 = (): RoundRow[] => [9, 1, 3, 5, 7, 11, 13].map((n) => W({ group_name: `ม.6/${n}`, code: "ส33102",
  name: "สังคมศึกษา ศาสนาและวัฒนธรรม 6", credits: 1, weekly: 2, teacher_id: 71 }));

test("teacherSheet: ครูที่สอน ส32103 2 ห้อง และ ส33102 7 ห้อง (2 คาบ) → จำนวนคาบ 4 และ 14 · รวม 18 ตรงกับภาพชีตเดิม", () => {
  const rows = frozen([...s33of71(), ...s32of71()]);
  const before = JSON.stringify(rows);
  const [t] = teacherSheet(rows, [], REG, [L(71, 18)]);
  eq(JSON.stringify(rows), before);
  eq([t.no, t.teacherId, t.name, t.ownTotal, t.total, t.otherTotal], [1, 71, NAMES[71], 18, 18, 0]);
  eq(t.subjects.map((s) => [s.code, s.credits, s.kindLabel, s.periods, s.lines.length]),
    [["ส32103", 1, "1 พื้นฐาน", 4, 2], ["ส33102", 1, "1 พื้นฐาน", 14, 7]]);
  eq(t.subjects[1].lines.map((l) => l.room), ["ม.6/1", "ม.6/3", "ม.6/5", "ม.6/7", "ม.6/9", "ม.6/11", "ม.6/13"]);
  eq(t.subjects[1].lines.every((l) => l.weekly === 2), true);
});

test("teacherSheet: ตัวเลือกคาบเสรี 8 ห้อง 2 คาบ → จำนวนคาบ 2 ไม่คูณ 8 · สอนสองตัวเลือกในชุดเดียวกันหรือซ้ำในตัวเลือกเดียวก็ยังครั้งเดียว", () => {
  const rooms = Array.from({ length: 8 }, (_, i) => `ม.2/${i + 7}`);
  const options = frozen([
    O({ code: "ศ20201", name: "ดนตรีสากล", rooms, setName: "วิชาเสรี ม.2/7-14", teachers: [T(1, 4), T(2, 4)] }),
    O({ code: "ศ20202", name: "นาฏศิลป์", rooms, setName: "วิชาเสรี ม.2/7-14", teachers: [T(3, 4), T(4, 5)] }),
  ]);
  const blocks = teacherSheet([], options, REG, null);
  const four = blocks.find((b) => b.teacherId === 4)!;
  eq(four.ownTotal, 2);
  // หนึ่งรายการต่อชุด: รหัส/ชื่อของทุกตัวเลือกในชุดที่ครูคนนี้สอน
  eq(four.subjects.map((s) => [s.code, s.name, s.credits, s.kindLabel, s.periods, s.setText]),
    [["ศ20201 / ศ20202", "ดนตรีสากล / นาฏศิลป์", null, "2 เพิ่มเติม", 2, "ชุดคาบเสรี “วิชาเสรี ม.2/7-14”"]]);
  eq(four.subjects[0].lines, [{ room: "ม.2/7-14", weekly: 2, pending: false }]);
  eq(blocks.find((b) => b.teacherId === 5)!.ownTotal, 2);
  // ครูของตัวเลือกยังไม่ยืนยัน (มาจากเทอมก่อน) → บรรทัดของชุดนั้นติดธงเหมือนแถววิชา
  const unconfirmed = teacherSheet([], [O({ rooms, teachers: [T(1, 6, { confirmed: false })] })], REG, null);
  eq(unconfirmed[0].subjects[0].lines[0].pending, true);
});

test("teacherSheet: ครูสอนข้ามกลุ่ม ยอดทั้งรอบ 20 → สอนกลุ่มอื่น 2 · ไม่ส่งยอด (ทุกกลุ่ม) = ไม่มีส่วนของกลุ่มอื่น · ยอดน้อยกว่าในชีตไม่ติดลบ", () => {
  const rows = [...s32of71(), ...s33of71()];
  const [t] = teacherSheet(rows, [], REG, [L(71, 20, 18)]);
  eq([t.ownTotal, t.total, t.otherTotal], [18, 20, 2]);
  const [all] = teacherSheet(rows, [], REG, null);
  eq([all.ownTotal, all.total, all.otherTotal], [18, 18, 0]);
  // ข้อมูลสองคำขอไม่พร้อมกัน (แถวถูกแก้ระหว่างโหลด) — ยอดรวมต้องไม่น้อยกว่าที่ชีตนี้นับเห็น
  const [late] = teacherSheet(rows, [], REG, [L(71, 16)]);
  eq([late.ownTotal, late.total, late.otherTotal], [18, 18, 0]);
  // ครูที่ไม่อยู่ในรายการยอด → ใช้ยอดในชีต
  const [none] = teacherSheet(rows, [], REG, []);
  eq([none.total, none.otherTotal], [18, 0]);
});

test("teacherSheet: ครูชื่อซ้ำเป็นสองก้อนด้วย id · ครูสอนร่วมได้แถวนั้นในก้อนตัวเอง · คนเดียวกันสองช่องนับครั้งเดียว · แถวไม่มีครูไม่อยู่", () => {
  const rows = [
    W({ group_name: "ม.1/1", teacher_id: 90 }),
    W({ group_name: "ม.1/2", teacher_id: 91 }),
    W({ group_name: "ม.1/3", teacher_id: 90, co_teacher_id: 136, confirmed: false }),
    W({ group_name: "ม.1/4", teacher_id: 91, co_teacher_id: 91 }),
    W({ group_name: "ม.1/5", teacher_id: null, co_teacher_id: null }),
  ];
  const blocks = teacherSheet(rows, [], REG, null);
  eq(blocks.map((b) => [b.teacherId, b.name, b.ownTotal]),
    [[90, NAMES[90], 6], [91, NAMES[91], 6], [136, NAMES[136], 3]]);
  eq(blocks.map((b) => b.no), [1, 2, 3]);
  const co = blocks[2].subjects[0];
  eq([co.code, co.periods, co.lines], ["ท21102", 3, [{ room: "ม.1/3", weekly: 3, pending: true }]]);
});

test("teacherSheet: เรียงครูตามกลุ่มสาระ → ลำดับในกลุ่ม → ชื่อ · ไม่มีกลุ่ม/ไม่มีลำดับไว้ท้าย · ครูที่ไม่อยู่ในทะเบียนใช้ชื่อจากยอด", () => {
  const rows = [77, 71, 136, 7, 8, 90, 999].map((t, i) => W({ group_name: `ม.1/${i + 1}`, teacher_id: t }));
  const loads = [L(999, 3)];
  loads[0].name = "ครูนอกทะเบียน";
  const blocks = teacherSheet(rows, [], REG, loads);
  // กลุ่ม 2 (8) → กลุ่ม 5 ตามลำดับ 11 (77), 15 (71), ไม่มีลำดับ (90) → กลุ่ม 9 (136) → ไม่มีกลุ่ม ตามชื่อ ("ครู…" ก่อน "นาย…")
  eq(blocks.map((b) => b.teacherId), [8, 77, 71, 90, 136, 999, 7]);
  eq(blocks[5].name, "ครูนอกทะเบียน");
});

// ── กฎนับเท่ากับเซิร์ฟเวอร์ (เรียก wl_teacher_loads ตัวจริง) ────────────
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
function serverLoads(rows: readonly RoundRow[], options: readonly RoundOption[]): Record<string, number> {
  const code = [
    "import json, sys",
    "import mock_api",
    "d = json.load(sys.stdin)",
    "out = mock_api.wl_teacher_loads(d['rows'], d['options'])",
    "print('LOADS ' + json.dumps({str(k): v for k, v in out.items()}))",
  ].join("\n");
  const r = spawnSync("python3", ["-c", code], {
    cwd: ROOT, input: JSON.stringify({ rows, options }), encoding: "utf8",
    env: { ...process.env, PYTHONPATH: `${ROOT}/tests/stubs:${ROOT}` },
  });
  const line = (r.stdout ?? "").split("\n").find((s) => s.startsWith("LOADS "));
  if (!line) throw new Error(`เรียก wl_teacher_loads ไม่ได้: ${r.stderr || r.error}`);
  return JSON.parse(line.slice(6));
}

// รอบสังเคราะห์สามกลุ่ม: ครูสอนร่วม · คนเดียวกันสองช่อง · ครูข้ามกลุ่ม · ตัวเลือกหลายตัวในชุดเดียว · ครูซ้ำในตัวเลือก · ครู id ว่าง
const ROUND_ROWS: RoundRow[] = [
  W({ group_name: "ม.5/1", department_id: 5, teacher_id: 71, weekly: 2 }),
  W({ group_name: "ม.5/2", department_id: 5, teacher_id: 71, co_teacher_id: 136, weekly: 2 }),
  W({ group_name: "ม.6/1", department_id: 5, teacher_id: 77, co_teacher_id: 77, weekly: 2 }),
  W({ group_name: "ม.6/2", department_id: 5, teacher_id: null, weekly: 2 }),
  W({ group_name: "ม.1/1", department_id: 9, teacher_id: 136, weekly: 3, code: "อ21102", name: "English" }),
  W({ group_name: "ม.1/2", department_id: 9, teacher_id: 71, weekly: 3, code: "อ21102", name: "English" }),
  W({ group_name: "ม.1/3", department_id: null, teacher_id: 8, weekly: 1, code: "IS1", name: "IS", kind: "activity" }),
];
const ROUND_OPTIONS: RoundOption[] = [
  O({ setId: 1, department_id: 7, teachers: [T(1, 4), T(2, 4)] }),
  O({ setId: 1, department_id: 7, code: "ศ20202", teachers: [T(3, 4), T(4, 71), T(5, null)] }),
  O({ setId: 2, department_id: 5, code: "ส20201", weekly: 1, rooms: ["ม.4/1", "ม.4/2"], teachers: [T(6, 71), T(7, 77)] }),
  O({ setId: 3, department_id: 9, code: "อ20201", weekly: 2, rooms: ["ม.6/9"], teachers: [] }),
];
const byTeacher = (blocks: { teacherId: number; ownTotal: number }[]): Record<string, number> =>
  Object.fromEntries(blocks.map((b) => [String(b.teacherId), b.ownTotal]));
const sorted = (o: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => Number(a) - Number(b)));

let SERVER_ALL: Record<string, number> | null = null;
test("ทุกกลุ่ม: ยอดในชีตของครูทุกคน = wl_teacher_loads ของเซิร์ฟเวอร์ (ตัวจริง ผ่าน python3)", () => {
  SERVER_ALL = serverLoads(ROUND_ROWS, ROUND_OPTIONS);
  // 71: แถว 2+2+3 + ชุดที่ 1 อีก 2 + ชุดที่ 2 อีก 1 = 10 · 136: ร่วมสอน 2 + 3 · 77: สองช่องนับครั้งเดียว 2 + ชุดที่ 2 อีก 1
  // · 4: สามที่ในชุดที่ 1 นับครั้งเดียว · 8: แถวที่ไม่มีกลุ่มสาระ
  eq(sorted(SERVER_ALL), { 4: 2, 8: 1, 71: 10, 77: 3, 136: 5 });
  eq(sorted(byTeacher(teacherSheet(ROUND_ROWS, ROUND_OPTIONS, REG, null))), sorted(SERVER_ALL));
  const loads = Object.entries(SERVER_ALL).map(([t, n]) => L(Number(t), n));
  for (const b of teacherSheet(ROUND_ROWS, ROUND_OPTIONS, REG, loads)) {
    ok(b.otherTotal === 0 && b.total === b.ownTotal, `ครู ${b.teacherId}: ทุกกลุ่มต้องไม่มีส่วนของกลุ่มอื่น ได้ ${b.total}/${b.ownTotal}`);
  }
});

test("รายกลุ่ม: ยอดในชีต = ส่วนของกลุ่ม (own ของเซิร์ฟเวอร์) · สอนกลุ่มอื่น = ยอดทั้งรอบ − ส่วนของกลุ่ม ≥ 0", () => {
  const all = SERVER_ALL ?? serverLoads(ROUND_ROWS, ROUND_OPTIONS);
  for (const dept of [5, 7, 9]) {
    const rows = ROUND_ROWS.filter((r) => r.department_id === dept);
    const options = ROUND_OPTIONS.filter((o) => o.department_id === dept);
    const own = serverLoads(rows, options);
    const loads = Object.entries(all).map(([t, n]) => L(Number(t), n, own[t] ?? 0));
    const blocks = teacherSheet(rows, options, REG, loads);
    eq(sorted(byTeacher(blocks)), sorted(own));
    for (const b of blocks) {
      eq([b.teacherId, b.total, b.otherTotal], [b.teacherId, all[String(b.teacherId)], all[String(b.teacherId)] - b.ownTotal]);
      ok(b.otherTotal >= 0, `ครู ${b.teacherId} สอนกลุ่มอื่นติดลบ`);
    }
  }
  // ครู 71 ในชีตกลุ่ม 5: แถว 2+2 + ชุดที่ 2 อีก 1 = 5 · ทั้งรอบมีอังกฤษ 3 + ชุดที่ 1 อีก 2 → สอนกลุ่มอื่น 5
  const g5 = teacherSheet(ROUND_ROWS.filter((r) => r.department_id === 5), ROUND_OPTIONS.filter((o) => o.department_id === 5),
    REG, Object.entries(all).map(([t, n]) => L(Number(t), n)));
  eq(g5.filter((b) => b.teacherId === 71).map((b) => [b.ownTotal, b.total, b.otherTotal]), [[5, 10, 5]]);
});

// ── บรรทัดใต้หัว และรอบที่หน้าเปิด ─────────────────────────────────────
test("pendingNote: นับแบบ fillProgress (แถว + ตัวเลือก) · ครบแล้ว = ไม่มีบรรทัด", () => {
  const rows = [W({ teacher_id: 4, confirmed: false }), W({ teacher_id: null }), W({ teacher_id: 5, confirmed: true }),
    W({ teacher_id: 6, confirmed: false })];
  const options = [O({ teachers: [T(1, 4, { confirmed: false })] }), O({ teachers: [] }), O({ teachers: [T(2, 5)] })];
  eq(pendingNote(rows, options), "ยังไม่ยืนยัน 3 รายการ · ยังไม่มีครู 2 รายการ — ชื่อครูในชีตนี้อาจยังเปลี่ยน");
  eq(pendingNote([W({ teacher_id: 4, confirmed: false })], []), "ยังไม่ยืนยัน 1 รายการ — ชื่อครูในชีตนี้อาจยังเปลี่ยน");
  eq(pendingNote([W({ teacher_id: 4 })], [O({ teachers: [T(1, 5)] })]), null);
  eq(pendingNote([], []), null);
});

test("sheetRound: รอบที่ยังไม่ปิดก่อน · ไม่มีก็รอบล่าสุดตามปี/ภาค · ไม่มีรอบ = null", () => {
  const R = (id: number, year: number, semester: number, status: Round["status"]): Round => ({
    id, year, semester, label: `${semester}/${year}`, status, opened_at: "2026-11-16T07:47:00+00:00", closed_at: null,
    counts: { rows: 0, sets: 0, options: 0, unconverted: 0 },
  });
  eq(sheetRound([R(1, 2569, 1, "closed"), R(2, 2569, 2, "filling"), R(3, 2568, 2, "closed")])?.id, 2);
  eq(sheetRound([R(1, 2569, 1, "closed"), R(4, 2569, 2, "preparing")])?.id, 4);
  // รอบที่ยังไม่ปิดมาก่อนเสมอ แม้ภาคเรียนเก่ากว่ารอบที่ปิดแล้ว
  eq(sheetRound([R(6, 2570, 1, "closed"), R(4, 2569, 2, "preparing")])?.id, 4);
  eq(sheetRound([R(1, 2568, 2, "closed"), R(5, 2569, 1, "closed"), R(3, 2568, 1, "closed")])?.id, 5);
  eq(sheetRound([]), null);
});

if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  process.exit(1);
}
console.log("ALL PASS");
