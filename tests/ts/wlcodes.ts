/**
 * ทดสอบ workload/src/codes.ts — ตรรกะล้วนของหน้ารหัสเข้าและฟอร์มตั้งรหัสผู้ดูแลระบบ
 *
 * จุดที่ต้องไม่พลาด: รหัสที่ชี้กลุ่มสาระซึ่งหายไปแล้วต้องยังขึ้นในรายการ (ไม่งั้นปิดไม่ได้)
 * และแถวผู้ดูแลระบบต้องอยู่บนสุดเสมอ
 */
import {
  buildCodeRows, codeLengthError, MIN_CODE_LENGTH, setupFormError, type CodeEntry,
} from "../../workload/src/codes.ts";

const fails: string[] = [];
const test = (name: string, fn: () => void): void => {
  try { fn(); } catch (e) { fails.push(`${name} — ${(e as Error).message}`); }
};
const eq = (a: unknown, b: unknown): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`ได้ ${JSON.stringify(a)} ควรเป็น ${JSON.stringify(b)}`);
  }
};
const hasThai = (s: string): boolean => /[฀-๿]/.test(s);

const DEPTS = [
  { id: 1, name: "กลุ่มสาระคณิตศาสตร์" },
  { id: 2, name: "กลุ่มสาระวิทยาศาสตร์" },
  { id: 3, name: "กลุ่มสาระภาษาไทย" },
];
const ADMIN: CodeEntry = { id: 10, role: "admin", department_id: null, label: "ผู้ดูแลระบบ", active: true };
const head = (id: number, dept: number, active = true): CodeEntry =>
  ({ id, role: "head", department_id: dept, label: `หัวหน้า ${dept}`, active });

test("ความยาวขั้นต่ำเท่ากับเซิร์ฟเวอร์ (6 ไม่นับช่องว่างหัวท้าย)", () => {
  eq(MIN_CODE_LENGTH, 6);
  eq(codeLengthError("abcdef"), null);
  eq(codeLengthError("  abcdef  "), null);
  eq(hasThai(codeLengthError("abcde") ?? ""), true);
  eq(hasThai(codeLengthError("   abcde ") ?? ""), true);
  eq(hasThai(codeLengthError("") ?? ""), true);
});

test("ฟอร์มตั้งรหัสผู้ดูแลระบบ: ผ่านเมื่อครบ ยาวพอ และตรงกัน", () => {
  eq(setupFormError({ setupCode: "x", code: "abcdef", confirm: "abcdef" }), null);
});

test("ฟอร์มตั้งรหัสผู้ดูแลระบบ: ไม่กรอกรหัสตั้งค่า = ข้อความไทย", () => {
  eq(hasThai(setupFormError({ setupCode: "  ", code: "abcdef", confirm: "abcdef" }) ?? ""), true);
});

test("ฟอร์มตั้งรหัสผู้ดูแลระบบ: สั้นไป = ข้อความไทย", () => {
  const m = setupFormError({ setupCode: "x", code: "abc", confirm: "abc" });
  eq(m !== null && hasThai(m), true);
});

test("ฟอร์มตั้งรหัสผู้ดูแลระบบ: สองช่องไม่ตรงกัน = ข้อความไทย", () => {
  const m = setupFormError({ setupCode: "x", code: "abcdef", confirm: "abcdeg" });
  eq(m !== null && m.includes("ตรงกัน"), true);
});

test("ฟอร์มตั้งรหัสผู้ดูแลระบบ: ช่องว่างหัวท้ายไม่ทำให้ไม่ตรงกัน (เซิร์ฟเวอร์ตัดเอง)", () => {
  eq(setupFormError({ setupCode: "x", code: "abcdef", confirm: "abcdef " }), null);
});

test("แถว admin อยู่บนสุดเสมอ แม้รหัสหัวหน้ามี id น้อยกว่า", () => {
  const rows = buildCodeRows(DEPTS, [head(2, 1), head(3, 2), ADMIN]);
  eq(rows[0].kind, "admin");
  eq(rows[0].codeId, 10);
  eq(rows[0].status, "active");
  eq(rows.length, 4);
});

test("หนึ่งแถวต่อกลุ่มสาระ ตามลำดับของรายการกลุ่ม", () => {
  const rows = buildCodeRows(DEPTS, [ADMIN]);
  eq(rows.slice(1).map((r) => r.departmentId), [1, 2, 3]);
  eq(rows.slice(1).map((r) => r.name), DEPTS.map((d) => d.name));
});

test("กลุ่มที่ยังไม่มีรหัส = ยังไม่ได้ตั้ง และไม่มี codeId", () => {
  const rows = buildCodeRows(DEPTS, [ADMIN, head(2, 1)]);
  const d2 = rows.find((r) => r.departmentId === 2)!;
  eq(d2.status, "unset");
  eq(d2.codeId, null);
  eq(rows.find((r) => r.departmentId === 1)!.status, "active");
});

test("กลุ่มที่รหัสปิดอยู่ = ปิดอยู่ แต่ยังมี codeId ให้เปิดคืน", () => {
  const rows = buildCodeRows(DEPTS, [ADMIN, head(7, 3, false)]);
  const d3 = rows.find((r) => r.departmentId === 3)!;
  eq(d3.status, "disabled");
  eq(d3.codeId, 7);
});

test("รหัสกำพร้า (กลุ่มสาระหายไปแล้ว) ยังขึ้นท้ายรายการเพื่อให้ปิดได้", () => {
  const rows = buildCodeRows(DEPTS, [ADMIN, head(5, 99)]);
  eq(rows.length, 5);
  const last = rows[rows.length - 1];
  eq(last.kind, "orphan");
  eq(last.codeId, 5);
  eq(last.status, "active");
  eq(last.name.includes("99"), true);
  eq(hasThai(last.name), true);
});

test("รหัสหัวหน้าที่ไม่มีกลุ่มสาระเลย (null) ก็ไม่หายเงียบ", () => {
  const stray: CodeEntry = { id: 8, role: "head", department_id: null, label: "x", active: true };
  const rows = buildCodeRows(DEPTS, [ADMIN, stray]);
  eq(rows.filter((r) => r.kind === "orphan").map((r) => r.codeId), [8]);
});

test("ไม่มีแถว admin ในข้อมูล = ยังมีแถว admin บนสุดเป็นยังไม่ได้ตั้ง", () => {
  const rows = buildCodeRows(DEPTS, []);
  eq(rows[0].kind, "admin");
  eq(rows[0].status, "unset");
  eq(rows[0].codeId, null);
});

test("key ของแถวไม่ซ้ำกัน", () => {
  const rows = buildCodeRows(DEPTS, [ADMIN, head(2, 1), head(3, 99), head(4, 98)]);
  eq(new Set(rows.map((r) => r.key)).size, rows.length);
});

test("ไม่มีกลุ่มสาระเลย ก็ยังมีแถว admin", () => {
  eq(buildCodeRows([], [ADMIN]).length, 1);
});

if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  process.exit(1);
}
console.log("ALL PASS");
