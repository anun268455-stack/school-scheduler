/**
 * dupExport — เขียนรายการ "รหัสวิชาเดียวกันเรียนซ้ำในวันเดียว" ออกเป็นไฟล์
 *
 *   "เครื่องมือที่ตรวจคาบตรงกันนะแบบว่า รหัสวิชาที่เหมือนกันที่เรียนวันเดียวกัน
 *    เขียนออกมาเพื่อที่จะตรวจสอบช่วยทำให้หน่อย"
 *
 * หน้าวิเคราะห์ห้องโชว์รายการนี้อยู่แล้ว แต่ดูบนจอแล้วตรวจทีละบรรทัดกับของจริง
 * ไม่ถนัด ไฟล์นี้แปลงเป็นตารางที่เปิดใน Excel ได้ เอาไปกาตรวจทีละแถว
 *
 * เขียนออกมา **ทุกชุด** รวมคาบคู่ที่ตั้งใจไว้แล้วด้วย เพราะคนตรวจต้องเห็นของ
 * ที่ถูกอยู่แล้วด้วยจึงจะรู้ว่าไม่ได้ตกไป แต่มีคอลัมน์ "ต้องแก้" บอกไว้ให้ชัด
 * และเรียงให้ของที่ต้องแก้ขึ้นก่อน
 */
import type { SameDayDup } from "./roomAudit";

export interface DupExportInput {
  dups: SameDayDup[];
  /** ชื่อวัน เรียงตามเลขวันในตาราง */
  dayNames: readonly string[];
  /** ชื่อห้องเรียนของคาบนั้น ถ้ารู้ — ไม่รู้ก็เว้นได้ */
  roomOf?: (slotId: number) => string | null | undefined;
}

export const DUP_HEADERS = [
  "ต้องแก้", "ชั้น", "วัน", "รหัสวิชา", "ครู",
  "จำนวนคาบในวันนั้น", "คาบที่ลงไว้", "ห้อง", "เป็นอะไร", "หมายเหตุ",
] as const;

/** คาบคู่ที่ผูกกันไว้แล้วคือของที่ตั้งใจ ไม่ใช่ปัญหา */
export const needsFix = (d: SameDayDup): boolean => d.kind !== "คาบคู่";

const order = (d: SameDayDup): number =>
  d.kind === "ซ้ำคนละช่วง" ? 0 : d.kind === "ติดกันแต่ไม่ผูกคู่" ? 1 : 2;

/** เรียงให้ของที่ต้องแก้ขึ้นก่อน แล้วไล่ตามชั้น วัน รหัสวิชา */
export function sortForCheck(dups: SameDayDup[]): SameDayDup[] {
  return [...dups].sort((a, b) =>
    order(a) - order(b)
    || a.groupName.localeCompare(b.groupName, "th")
    || a.day - b.day
    || a.subjectCode.localeCompare(b.subjectCode, "th"));
}

export function dupRows(input: DupExportInput): string[][] {
  const { dayNames, roomOf } = input;
  return sortForCheck(input.dups).map((d) => {
    const rooms = roomOf
      ? [...new Set(d.slotIds.map((id) => roomOf(id)).filter(Boolean))].join(" · ")
      : "";
    return [
      needsFix(d) ? "ต้องแก้" : "ไม่ (ตั้งใจไว้)",
      d.groupName,
      dayNames[d.day] ?? String(d.day),
      d.subjectCode,
      d.teacherName,
      String(d.periods.length),
      d.periods.join(" · "),
      rooms,
      d.kind,
      d.note,
    ];
  });
}

/**
 * หุ้มช่องหนึ่งช่องให้ปลอดภัย
 *
 * ช่องที่เริ่มด้วย = + - @ ถ้าเปิดใน Excel มันจะคิดว่าเป็นสูตร จึงต้องเติม
 * เครื่องหมายคำพูดนำไว้ ชื่อครูกับรหัสวิชาไม่เคยเริ่มด้วยอักษรพวกนี้ แต่กัน
 * ไว้ไม่เสียหาย
 */
function cell(v: string): string {
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

export function dupCsv(input: DupExportInput): string {
  const lines = [[...DUP_HEADERS], ...dupRows(input)]
    .map((row) => row.map(cell).join(","));
  // ตัวนำหน้าไฟล์ (BOM) ทำให้ Excel อ่านภาษาไทยถูก — ต้องเขียนเป็นข้อความ
  // หลบหนี \uFEFF ไม่ใช่วางตัวอักขระลงไปตรง ๆ เพราะตัวตรวจไวยากรณ์ห้าม
  // อักขระล่องหนในซอร์ส และจะหยุดการติดตั้งทั้งเว็บ · \r\n ให้ Excel บน Windows ขึ้นบรรทัดถูก
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** สรุปหัวเรื่องสั้น ๆ ไว้บอกผู้ใช้ตอนกดบันทึก */
export function dupSummary(dups: SameDayDup[]): string {
  const fix = dups.filter(needsFix).length;
  if (dups.length === 0) return "ไม่มีวิชาไหนลงซ้ำในวันเดียว";
  return fix === 0
    ? `ทั้ง ${dups.length} ชุดเป็นคาบคู่ที่ผูกกันไว้แล้ว ไม่มีอะไรต้องแก้`
    : `ต้องแก้ ${fix} ชุด · คาบคู่ที่ตั้งใจไว้แล้ว ${dups.length - fix} ชุด`;
}

/** ชื่อไฟล์ที่บอกได้ในตัวว่าเป็นของวันไหน */
export function dupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `ตรวจวิชาซ้ำในวัน-${now.getFullYear()}-${p(now.getMonth() + 1)}-`
    + `${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.csv`;
}
