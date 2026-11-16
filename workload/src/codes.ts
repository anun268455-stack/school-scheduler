// ตรรกะล้วนของหน้ารหัสเข้าและฟอร์มตั้งรหัสผู้ดูแลระบบ — ห้าม import อะไรที่ node รันเองไม่ได้
// (ไม่มี axios/React) เพื่อให้ tests/run.sh ทดสอบได้โดยไม่ต้องลง dependency

// เซิร์ฟเวอร์ตรวจซ้ำเสมอ ตรงนี้ตรวจไว้เพื่อให้ผู้ใช้เห็นข้อความทันที ไม่ต้องรอไปกลับ
export const MIN_CODE_LENGTH = 6;

export function codeLengthError(code: string): string | null {
  return code.trim().length >= MIN_CODE_LENGTH
    ? null
    : `รหัสต้องยาวอย่างน้อย ${MIN_CODE_LENGTH} ตัวอักษร (ไม่นับช่องว่างหัวท้าย)`;
}

export type SetupForm = { setupCode: string; code: string; confirm: string };

// เซิร์ฟเวอร์ตัดช่องว่างหัวท้ายของรหัสเอง จึงเทียบแบบตัดเหมือนกัน ไม่งั้นช่องว่างท้ายที่ตาไม่เห็นทำให้ฟอร์มปฏิเสธรหัสที่ถูก
export function setupFormError(f: SetupForm): string | null {
  if (f.setupCode.trim() === "") return "กรุณากรอกรหัสตั้งค่าที่ตั้งไว้บน Render";
  const tooShort = codeLengthError(f.code);
  if (tooShort) return tooShort;
  if (f.code.trim() !== f.confirm.trim()) return "รหัสใหม่สองช่องไม่ตรงกัน";
  return null;
}

// รูปแถวที่ GET /api/workload/codes ส่งมา (ไม่มีตัวรหัสเลย มีแต่สถานะ)
export type CodeEntry = {
  id: number;
  role: "admin" | "head";
  department_id: number | null;
  label: string;
  active: boolean;
};

export type CodeStatus = "unset" | "active" | "disabled";

export type CodeRow = {
  key: string;
  kind: "admin" | "head" | "orphan";
  departmentId: number | null;
  name: string;
  // null = ยังไม่มีแถวรหัสในเซิร์ฟเวอร์ (ปุ่ม "ตั้งรหัส" ใช้ POST) · มีค่า = ใช้ PUT
  codeId: number | null;
  status: CodeStatus;
};

const statusOf = (e: CodeEntry | undefined): CodeStatus =>
  e === undefined ? "unset" : e.active ? "active" : "disabled";

// แถว admin ก่อน ตามด้วยหนึ่งแถวต่อกลุ่มสาระ (ตามลำดับรายการ) · จับคู่ด้วย department_id เท่านั้น
// รหัสที่ไม่มีแถวไหนรับ (กลุ่มสาระถูกลบไปแล้ว หรือไม่ได้ผูกกลุ่ม) ต่อท้ายไว้ ไม่ปล่อยหายเงียบ — ไม่งั้นจะปิดรหัสนั้นไม่ได้
export function buildCodeRows(
  departments: readonly { id: number; name: string }[],
  codes: readonly CodeEntry[],
): CodeRow[] {
  const used = new Set<number>();
  const take = (e: CodeEntry | undefined): CodeEntry | undefined => {
    if (e) used.add(e.id);
    return e;
  };

  const admin = take(codes.find((c) => c.role === "admin"));
  const rows: CodeRow[] = [{
    key: "admin", kind: "admin", departmentId: null, name: "ผู้ดูแลระบบ",
    codeId: admin?.id ?? null, status: statusOf(admin),
  }];

  for (const d of departments) {
    const e = take(codes.find((c) => c.role === "head" && c.department_id === d.id && !used.has(c.id)));
    rows.push({
      key: `dept-${d.id}`, kind: "head", departmentId: d.id, name: d.name,
      codeId: e?.id ?? null, status: statusOf(e),
    });
  }

  for (const c of codes) {
    if (used.has(c.id)) continue;
    const where = c.department_id === null ? "ไม่ได้ผูกกลุ่มสาระ" : `กลุ่มสาระที่ไม่มีแล้ว รหัส ${c.department_id}`;
    rows.push({
      key: `code-${c.id}`, kind: "orphan", departmentId: c.department_id,
      name: `${c.label} (${where})`, codeId: c.id, status: statusOf(c),
    });
  }
  return rows;
}
