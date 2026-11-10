// ตรรกะล้วนของหน้าทะเบียนครู/วิชา — import ได้เฉพาะ import type (node รันตรง ๆ ใน tests/ts/wlregistry.ts)
// ทุกอย่างอ้างแถวด้วย id เสมอ ห้ามใช้ชื่อเป็น key หรือจับคู่ (ครูชื่อเหมือนกันมีจริง)
import type { Department, ImportCounts, SubjectIdentity, TeacherIdentity, WlSubject, WlTeacher } from "./types.ts";

export const UNASSIGNED_NAME = "ยังไม่ระบุกลุ่มสาระ";

// ว่างไว้ท้ายเสมอ — ใช้กับกลุ่มสาระและลำดับในกลุ่ม
// (dept_order ใน Teacher เป็นช่องไม่บังคับ จึงนับ undefined เป็นว่างด้วย)
function nullsLast(a: number | null | undefined, b: number | null | undefined): number {
  const x = a ?? null;
  const y = b ?? null;
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

export function sortTeachers(rows: readonly WlTeacher[]): WlTeacher[] {
  return [...rows].sort(
    (a, b) =>
      nullsLast(a.department_id, b.department_id) ||
      nullsLast(a.dept_order, b.dept_order) ||
      a.id - b.id,
  );
}

// เซิร์ฟเวอร์เรียงด้วยการเทียบข้อความของ Postgres แต่หลังเพิ่ม/แก้แถวต้องเรียงเองฝั่งนี้ จึงเทียบด้วยรหัสตรง ๆ (ไม่ใช้ localeCompare ที่ผลต่างกันตามเครื่อง)
export function sortSubjects(rows: readonly WlSubject[]): WlSubject[] {
  return [...rows].sort(
    (a, b) =>
      nullsLast(a.department_id, b.department_id) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      a.id - b.id,
  );
}

export type DepartmentGroup<T> = {
  /** ใช้เป็น key ของ React — ไม่ซ้ำกันระหว่างกลุ่ม */
  key: string;
  departmentId: number | null;
  name: string;
  rows: T[];
};

// กลุ่มตามลำดับของ departments · แถวที่ไม่มีกลุ่มหรือชี้กลุ่มที่ถูกลบไปแล้วต้องไม่หายจากจอ จึงรวมเป็นกลุ่มท้ายสุด
export function groupByDepartment<T extends { department_id: number | null }>(
  rows: readonly T[],
  departments: readonly Department[],
): DepartmentGroup<T>[] {
  const known = new Set(departments.map((d) => d.id));
  const groups: DepartmentGroup<T>[] = [];
  for (const d of departments) {
    const inGroup = rows.filter((r) => r.department_id === d.id);
    if (inGroup.length > 0) {
      groups.push({ key: `d${d.id}`, departmentId: d.id, name: d.name, rows: inGroup });
    }
  }
  const orphans = rows.filter((r) => r.department_id === null || !known.has(r.department_id));
  if (orphans.length > 0) {
    groups.push({ key: "none", departmentId: null, name: UNASSIGNED_NAME, rows: orphans });
  }
  return groups;
}

// คำนามของสิ่งที่ดึง: thing = ใช้ในประโยค ("ครูใหม่") · unit = ลักษณนาม ("143 คน")
export type ImportNoun = { thing: string; unit: string };
export const TEACHER_NOUN: ImportNoun = { thing: "ครู", unit: "คน" };
export const SUBJECT_NOUN: ImportNoun = { thing: "วิชา", unit: "วิชา" };

// ข้อความหน้าสรุปก่อนดึง (ยังไม่เขียน) และหลังดึง (จำนวนจริงจากเซิร์ฟเวอร์)
export function importSummary(c: ImportCounts, phase: "preview" | "done", n: ImportNoun): string {
  const skipped = c.skipped > 0 ? ` · ข้าม ${c.skipped} แถว` : "";
  if (c.created === 0) {
    return phase === "preview"
      ? `ไม่มี${n.thing}ใหม่ให้ดึง (มีอยู่แล้ว ${c.linked} ${n.unit})${skipped}`
      : `ไม่มี${n.thing}ใหม่ (มีอยู่แล้ว ${c.linked} ${n.unit})${skipped}`;
  }
  const head = phase === "preview"
    ? `จะสร้าง${n.thing}ใหม่ ${c.created} ${n.unit}`
    : `สร้าง${n.thing}ใหม่แล้ว ${c.created} ${n.unit}`;
  return `${head} · มีอยู่แล้ว ${c.linked} ${n.unit}${skipped}`;
}

// ช่อง "ลำดับในกลุ่ม": ว่าง = ไม่กำหนด · เซิร์ฟเวอร์รับจำนวนเต็มไม่เกิน 2147483647 (ลบได้)
export type OrderParse = { ok: true; value: number | null } | { ok: false };

export function parseOrder(text: string): OrderParse {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^-?\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  return Math.abs(n) <= 2147483647 ? { ok: true, value: n } : { ok: false };
}

export type Built<T> = { ok: true; body: T } | { ok: false; message: string };

export type TeacherForm = {
  name: string;
  code: string;
  department_id: number | null;
  /** ข้อความที่พิมพ์ในช่อง "ลำดับในกลุ่ม" */
  order: string;
};

// ตรวจและแปลงฟอร์มครูเป็น body ที่ส่งได้ — ใช้ทั้งฟอร์มเพิ่มและการแก้ในแถว จะได้ข้อความตรงกัน
export function buildTeacherBody(f: TeacherForm): Built<TeacherIdentity> {
  const name = f.name.trim();
  if (name === "") return { ok: false, message: "กรุณากรอกชื่อครู" };
  const o = parseOrder(f.order);
  if (!o.ok) return { ok: false, message: "ลำดับในกลุ่มต้องเป็นจำนวนเต็ม หรือเว้นว่างไว้" };
  return {
    ok: true,
    body: {
      name,
      code: f.code.trim() === "" ? null : f.code,
      department_id: f.department_id,
      dept_order: o.value,
    },
  };
}

export function buildSubjectBody(f: SubjectIdentity): Built<SubjectIdentity> {
  const code = f.code.trim();
  if (code === "") return { ok: false, message: "กรุณากรอกรหัสวิชา" };
  const name = f.name.trim();
  if (name === "") return { ok: false, message: "กรุณากรอกชื่อวิชา" };
  return { ok: true, body: { ...f, code, name, is_elective: Boolean(f.is_elective) } };
}

// การแก้ในแถวส่งเฉพาะช่องที่ผู้ใช้เปลี่ยน (PUT ของเซิร์ฟเวอร์เป็นการแก้บางช่อง)
// กันส่งค่าเดิมที่เซิร์ฟเวอร์ไม่รับแล้วกลับไป เช่น รหัสกลุ่มสาระที่ถูกลบไปแล้ว
export function changedFields<T extends Record<string, unknown>>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (after[k] !== before[k]) out[k] = after[k];
  }
  return out;
}
