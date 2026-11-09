// ตรรกะล้วนของหน้าทะเบียนครู/วิชา — import ได้เฉพาะ import type (node รันตรง ๆ ใน tests/ts/wlregistry.ts)
// ทุกอย่างอ้างแถวด้วย id เสมอ ห้ามใช้ชื่อเป็น key หรือจับคู่ (ครูชื่อเหมือนกันมีจริง)
import type { Department, ImportCounts, WlSubject, WlTeacher } from "./types.ts";

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

// ข้อความหน้าสรุปก่อนดึง (ยังไม่เขียน) และหลังดึง (จำนวนจริงจากเซิร์ฟเวอร์)
export function importSummary(c: ImportCounts, phase: "preview" | "done"): string {
  const skipped = c.skipped > 0 ? ` · ข้าม ${c.skipped} แถว` : "";
  if (c.created === 0) {
    return phase === "preview"
      ? `ไม่มีครูใหม่ให้ดึง (มีอยู่แล้ว ${c.linked} คน)${skipped}`
      : `ไม่มีครูใหม่ (มีอยู่แล้ว ${c.linked} คน)${skipped}`;
  }
  const head = phase === "preview" ? `จะสร้างครูใหม่ ${c.created} คน` : `สร้างครูใหม่แล้ว ${c.created} คน`;
  return `${head} · มีอยู่แล้ว ${c.linked} คน${skipped}`;
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
