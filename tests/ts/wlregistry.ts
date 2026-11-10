/**
 * ทดสอบ workload/src/registry.ts — การเรียง/จัดกลุ่มทะเบียนครูและวิชา
 *
 * จุดที่ต้องไม่พลาด: ครูที่ชี้กลุ่มสาระที่หายไปต้องยังเห็นบนจอ · ครูสองคนชื่อเหมือนกันต้องเป็นสองแถว
 * (อ้างด้วย id เท่านั้น ห้ามใช้ชื่อเป็น key) · การเรียงต้องไม่แก้ลิสต์ที่ส่งเข้ามา
 */
import {
  buildSubjectBody, buildTeacherBody, changedFields, groupByDepartment, importSummary, parseOrder,
  sortSubjects, sortTeachers, SUBJECT_NOUN, TEACHER_NOUN, UNASSIGNED_NAME,
} from "../../workload/src/registry.ts";
import type { WlSubject, WlTeacher } from "../../workload/src/types.ts";

const fails: string[] = [];
const test = (name: string, fn: () => void): void => {
  try { fn(); } catch (e) { fails.push(`${name} — ${(e as Error).message}`); }
};
const eq = (a: unknown, b: unknown): void => {
  if (a !== b) throw new Error(`ได้ ${JSON.stringify(a)} ควรเป็น ${JSON.stringify(b)}`);
};
const deepEq = (a: unknown, b: unknown): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`ได้ ${JSON.stringify(a)} ควรเป็น ${JSON.stringify(b)}`);
  }
};

const T = (id: number, department_id: number | null, dept_order: number | null, name = `ครู${id}`): WlTeacher =>
  ({ id, sched_id: null, name, code: null, department_id, dept_order, active: true });
const S = (id: number, department_id: number | null, code: string): WlSubject => ({
  id, sched_id: null, code, name: `วิชา${id}`, type: "common", department_id, duration: 1,
  is_activity: false, is_elective: false, active: true,
});
const ids = (rows: { id: number }[]): number[] => rows.map((r) => r.id);

const DEPTS = [{ id: 2, name: "วิทย์" }, { id: 1, name: "คณิต" }, { id: 3, name: "ไทย" }];

test("ครูเรียงตามกลุ่ม แล้วลำดับในกลุ่ม แล้ว id", () => {
  const rows = [T(5, 2, 1), T(4, 1, 2), T(3, 1, 1), T(2, 1, 1)];
  deepEq(ids(sortTeachers(rows)), [2, 3, 4, 5]);
});

test("ไม่มีกลุ่มไว้ท้าย · ลำดับว่างไว้ท้ายกลุ่ม", () => {
  const rows = [T(1, null, 1), T(2, 1, null), T(3, 1, 5), T(4, null, null)];
  deepEq(ids(sortTeachers(rows)), [3, 2, 1, 4]);
});

test("เรียงครูแล้วไม่แก้ลิสต์เดิม", () => {
  const rows = [T(3, 2, 1), T(1, 1, 1)];
  const before = JSON.stringify(rows);
  const out = sortTeachers(rows);
  eq(JSON.stringify(rows), before);
  eq(out === rows, false);
});

test("วิชาเรียงตามกลุ่ม แล้วรหัสวิชา แล้ว id · ไม่มีกลุ่มไว้ท้าย", () => {
  const rows = [S(1, null, "ก"), S(2, 1, "ค22"), S(3, 1, "ค21"), S(4, 1, "ค21"), S(5, 2, "ว11")];
  deepEq(ids(sortSubjects(rows)), [3, 4, 2, 5, 1]);
});

test("จัดกลุ่มตามลำดับของ departments ไม่ใช่ตามเลข id", () => {
  const g = groupByDepartment([T(1, 1, 1), T(2, 3, 1), T(3, 2, 1)], DEPTS);
  deepEq(g.map((x) => x.name), ["วิทย์", "คณิต", "ไทย"]);
  deepEq(g.map((x) => ids(x.rows)), [[3], [1], [2]]);
});

test("กลุ่มที่ไม่มีแถวไม่ขึ้นหัวกลุ่ม", () => {
  const g = groupByDepartment([T(1, 3, 1)], DEPTS);
  deepEq(g.map((x) => x.name), ["ไทย"]);
});

test("ครูที่ไม่มีกลุ่มหรือชี้กลุ่มที่หายไปต้องยังเห็น ในกลุ่มท้ายสุด", () => {
  const g = groupByDepartment([T(1, null, 1), T(2, 99, 1), T(3, 1, 1)], DEPTS);
  deepEq(g.map((x) => x.name), ["คณิต", UNASSIGNED_NAME]);
  deepEq(ids(g[1].rows), [1, 2]);
  eq(g[1].departmentId, null);
});

test("ไม่มีแถวเลยได้กลุ่มว่าง ไม่มีกลุ่ม 'ยังไม่ระบุ' ลอย", () => {
  deepEq(groupByDepartment([], DEPTS), []);
});

test("จัดกลุ่มคงลำดับแถวที่ส่งเข้ามา และไม่แก้ลิสต์เดิม", () => {
  const rows = [T(9, 1, 1), T(2, 1, 2)];
  const g = groupByDepartment(rows, DEPTS);
  deepEq(ids(g[0].rows), [9, 2]);
  eq(rows.length, 2);
});

test("ครูสองคนชื่อเหมือนกันเป็นสองแถว และ key ของกลุ่มไม่ซ้ำ", () => {
  const rows = [T(1, 1, 1, "ครูสมชาย ใจดี"), T(2, 1, 2, "ครูสมชาย ใจดี")];
  const sorted = sortTeachers(rows);
  deepEq(ids(sorted), [1, 2]);
  const g = groupByDepartment(sorted, DEPTS);
  eq(g[0].rows.length, 2);
  eq(new Set(g.map((x) => x.key)).size, g.length);
  const g2 = groupByDepartment([T(1, null, 1), T(2, 99, 1)], DEPTS);
  eq(new Set(g2.map((x) => x.key)).size, g2.length);
});

test("สรุปก่อนดึง: มีครูใหม่", () => {
  eq(importSummary({ created: 143, linked: 0, skipped: 0 }, "preview", TEACHER_NOUN),
    "จะสร้างครูใหม่ 143 คน · มีอยู่แล้ว 0 คน");
});

test("สรุปก่อนดึง: ไม่มีครูใหม่ บอกตรง ๆ", () => {
  eq(importSummary({ created: 0, linked: 143, skipped: 0 }, "preview", TEACHER_NOUN),
    "ไม่มีครูใหม่ให้ดึง (มีอยู่แล้ว 143 คน)");
});

test("สรุปมีแถวที่ข้ามต้องบอกจำนวน", () => {
  eq(importSummary({ created: 2, linked: 1, skipped: 3 }, "preview", TEACHER_NOUN),
    "จะสร้างครูใหม่ 2 คน · มีอยู่แล้ว 1 คน · ข้าม 3 แถว");
});

test("สรุปหลังดึง ใช้ถ้อยคำอดีต", () => {
  eq(importSummary({ created: 143, linked: 0, skipped: 0 }, "done", TEACHER_NOUN),
    "สร้างครูใหม่แล้ว 143 คน · มีอยู่แล้ว 0 คน");
  eq(importSummary({ created: 0, linked: 143, skipped: 0 }, "done", TEACHER_NOUN),
    "ไม่มีครูใหม่ (มีอยู่แล้ว 143 คน)");
});

test("สรุปดึงวิชา ใช้คำว่าวิชาทั้งสิ่งของและหน่วย", () => {
  eq(importSummary({ created: 271, linked: 0, skipped: 0 }, "preview", SUBJECT_NOUN),
    "จะสร้างวิชาใหม่ 271 วิชา · มีอยู่แล้ว 0 วิชา");
  eq(importSummary({ created: 271, linked: 0, skipped: 0 }, "done", SUBJECT_NOUN),
    "สร้างวิชาใหม่แล้ว 271 วิชา · มีอยู่แล้ว 0 วิชา");
  eq(importSummary({ created: 0, linked: 271, skipped: 0 }, "preview", SUBJECT_NOUN),
    "ไม่มีวิชาใหม่ให้ดึง (มีอยู่แล้ว 271 วิชา)");
  eq(importSummary({ created: 0, linked: 271, skipped: 2 }, "done", SUBJECT_NOUN),
    "ไม่มีวิชาใหม่ (มีอยู่แล้ว 271 วิชา) · ข้าม 2 แถว");
  eq(importSummary({ created: 2, linked: 1, skipped: 3 }, "preview", SUBJECT_NOUN),
    "จะสร้างวิชาใหม่ 2 วิชา · มีอยู่แล้ว 1 วิชา · ข้าม 3 แถว");
});

test("parseOrder: ว่างเป็น null · จำนวนเต็มรวมลบ · อย่างอื่นไม่ผ่าน", () => {
  deepEq(parseOrder(""), { ok: true, value: null });
  deepEq(parseOrder("  "), { ok: true, value: null });
  deepEq(parseOrder("12"), { ok: true, value: 12 });
  deepEq(parseOrder(" -3 "), { ok: true, value: -3 });
  eq(parseOrder("1.5").ok, false);
  eq(parseOrder("abc").ok, false);
  eq(parseOrder("99999999999").ok, false);
});

test("dept_order เป็น undefined นับเป็นว่าง ไว้ท้ายกลุ่ม", () => {
  const a = { ...T(1, 1, 1) } as Partial<WlTeacher> & WlTeacher;
  delete a.dept_order;
  deepEq(ids(sortTeachers([a, T(2, 1, 9), T(3, 1, null)])), [2, 1, 3]);
});

test("เรียงวิชาแล้วไม่แก้ลิสต์เดิม", () => {
  const rows = [S(2, 1, "ข"), S(1, 1, "ก")];
  const before = JSON.stringify(rows);
  const out = sortSubjects(rows);
  eq(JSON.stringify(rows), before);
  eq(out === rows, false);
});

test("สรุปไม่มีครูใหม่แต่ข้ามแถว ต้องบอกจำนวนที่ข้าม", () => {
  eq(importSummary({ created: 0, linked: 5, skipped: 2 }, "preview", TEACHER_NOUN),
    "ไม่มีครูใหม่ให้ดึง (มีอยู่แล้ว 5 คน) · ข้าม 2 แถว");
  eq(importSummary({ created: 0, linked: 5, skipped: 2 }, "done", TEACHER_NOUN),
    "ไม่มีครูใหม่ (มีอยู่แล้ว 5 คน) · ข้าม 2 แถว");
});

const TF = { name: "ครูก", code: "T1", department_id: 2 as number | null, order: "3" };

test("buildTeacherBody: ชื่อว่างไม่ผ่าน มีข้อความไทย", () => {
  const r = buildTeacherBody({ ...TF, name: "   " });
  eq(r.ok, false);
  eq(r.ok === false && r.message, "กรุณากรอกชื่อครู");
});

test("buildTeacherBody: ลำดับผิดรูปไม่ผ่าน", () => {
  const r = buildTeacherBody({ ...TF, order: "abc" });
  eq(r.ok, false);
  eq(r.ok === false && r.message, "ลำดับในกลุ่มต้องเป็นจำนวนเต็ม หรือเว้นว่างไว้");
});

test("buildTeacherBody: รหัสว่างเป็น null · ลำดับว่างเป็น null · ตัดช่องว่างชื่อ", () => {
  const r = buildTeacherBody({ name: " ครูก ", code: "  ", department_id: null, order: "" });
  deepEq(r, { ok: true, body: { name: "ครูก", code: null, department_id: null, dept_order: null } });
});

test("buildTeacherBody: ข้อมูลดีได้ body ครบ", () => {
  deepEq(buildTeacherBody(TF), { ok: true, body: { name: "ครูก", code: "T1", department_id: 2, dept_order: 3 } });
});

test("buildSubjectBody: รหัสว่าง/ชื่อว่างไม่ผ่าน · ข้อมูลดีตัดช่องว่าง", () => {
  const base = { code: " ค1 ", name: " คณิต ", type: "common" as const, department_id: null, duration: 1 as const, is_activity: false, is_elective: false };
  eq(buildSubjectBody({ ...base, code: " " }).ok, false);
  eq(buildSubjectBody({ ...base, name: "" }).ok, false);
  const r = buildSubjectBody({ ...base, code: " " });
  eq(r.ok === false && r.message, "กรุณากรอกรหัสวิชา");
  const g = buildSubjectBody(base);
  eq(g.ok && g.body.code, "ค1");
  eq(g.ok && g.body.name, "คณิต");
});

test("changedFields: ส่งเฉพาะช่องที่เปลี่ยน", () => {
  deepEq(changedFields({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: null }), { b: "y" });
  deepEq(changedFields({ a: 1, b: "x" }, { a: 1, b: "x" }), {});
  deepEq(changedFields({ a: 1, c: 5 as number | null }, { a: 2, c: null }), { a: 2, c: null });
});

test("changedFields: กลุ่มสาระกำพร้าที่ไม่ได้แตะต้องไม่ถูกส่ง", () => {
  const before = { name: "ก", code: null, department_id: 9999 as number | null, dept_order: null };
  deepEq(changedFields(before, { ...before, name: "ข" }), { name: "ข" });
});

if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  process.exit(1);
}
console.log("ALL PASS");
