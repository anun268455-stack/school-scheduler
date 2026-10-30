/**
 * teacherLabel — ชื่อครูอย่างที่พิมพ์ลงช่องตาราง
 *
 * ช่องหนึ่งในใบพิมพ์กว้างไม่กี่มิลลิเมตร ชื่อครูจึงต้องถูกตัดให้เหลือเท่าที่
 * จำเป็นก่อนจะใส่ลงไป และต้องมีคำว่า "ครู" นำหน้าตามที่โรงเรียนใช้
 *
 * แยกออกมาจากไฟล์ใบพิมพ์เพราะกฎพวกนี้มีรายละเอียดเยอะ (คำนำหน้าไทยเขียนติดกับ
 * ชื่อ คำนำหน้าฝรั่งเป็นคำของตัวเอง ยศตำรวจทหารก็มี) และต้องเอาไปลองกับรายชื่อ
 * ครูจริงทั้งโรงเรียนได้
 */
import type { TimetableSlot } from "../types";
import { slotTeacherNames } from "./teacherSlots";

/**
 * "นางสาวกรรณิการ์ เจริญกิจ" → "กรรณิการ์".
 *
 * A printed cell is a few millimetres wide. The surname is the part nobody
 * needs to tell two teachers apart on a timetable, and the title in front of
 * the given name is three or four characters of the cell spent saying nothing
 * — every teacher has one.
 *
 * Thai titles run together with the name ("นางสาวกรรณิการ์"), so they are
 * stripped off the front of the first word, longest first: take "นาง" off
 * "นางสาวกรรณิการ์" and what is left is "สาวกรรณิการ์". Western titles stand
 * as their own word and are dropped with it.
 */
// Sorted longest-first below, so the list can be written in any order: match
// "นาง" before "นางสาว" and "นางสาวกรรณิการ์" comes out as "สาวกรรณิการ์".
export const THAI_TITLES = [
  "นางสาว", "นาง", "นาย", "น.ส.", "ด.ช.", "ด.ญ.", "ครู",
  "ดร.", "ผศ.ดร.", "รศ.ดร.", "ศ.ดร.", "ผศ.", "รศ.", "ศ.",
  "ว่าที่ร้อยตรีหญิง", "ว่าที่ร้อยตรี", "ว่าที่ ร.ต.", "ว่าที่ร.ต.",
  // Ranks: this school has a "สิบตำรวจตรี" on the staff list.
  "สิบตำรวจตรี", "สิบตำรวจโท", "สิบตำรวจเอก", "จ่าสิบตำรวจ",
  "ร้อยตำรวจตรี", "ร้อยตำรวจโท", "ร้อยตำรวจเอก",
  "พันตำรวจตรี", "พันตำรวจโท", "พันตำรวจเอก",
  "จ่าสิบตรี", "จ่าสิบโท", "จ่าสิบเอก",
  "สิบตรี", "สิบโท", "สิบเอก", "ร้อยตรี", "ร้อยโท", "ร้อยเอก",
  "พันตรี", "พันโท", "พันเอก",
  "ด.ต.", "ส.ต.ต.", "ส.ต.ท.", "ส.ต.อ.", "ร.ต.ต.",
].sort((a, b) => b.length - a.length);
const WESTERN_TITLE = /^(mr|mrs|miss|ms|dr|prof|master|sir)\.?$/i;
/** The same titles written hard against the name: "Mr.Charles", "Mr.Hu". */
const WESTERN_GLUED = /^(mr|mrs|miss|ms|dr|prof)\.\s*(?=\S)/i;
/**
 * คำนำหน้าที่เขียนติดชื่อโดยไม่มีจุดคั่น — โรงเรียนมี "MissChonna" อยู่คนหนึ่ง
 * ซึ่งพิมพ์ออกมาเป็น "ครูMissChonna" ถ้าไม่ตัด
 *
 * แยกตัวพิมพ์ใหญ่เล็กจริง ๆ ที่นี่ ไม่ใช้ธง i เพราะต้องอาศัยตัวพิมพ์ใหญ่ของ
 * ตัวอักษรถัดไปเป็นเครื่องบอกว่าตรงนั้นคือรอยต่อของสองคำ ไม่งั้นชื่อธรรมดา
 * อย่าง Drake · Mrinal · Missy · Dream จะถูกกินหัวไปด้วย
 */
const WESTERN_CAMEL = /^(Mr|Mrs|Miss|Ms|Dr|Prof)(?=[A-Z])/;

/**
 * The teacher line inside one printed cell.
 *
 * A lesson has one name, สอนร่วม has two, and a ลูกเสือ period can have four
 * standing with the same class. Four names do not fit a timetable cell: set
 * side by side they shrink the subject code to nothing or spill over the
 * border, and a printed sheet has no tooltip to recover them from. So past
 * two the cell counts instead, and the group sheet stays readable.
 */
export const KHRU = "ครู";

/**
 * ชื่อครูอย่างที่พิมพ์ลงช่อง — มีคำว่า "ครู" นำหน้า
 *
 *   "ช่วยเติมครูลงไปข้างหน้าของชื่อครูด้วย เช่น ครูกุลจิรา
 *    โดยจัดให้อยู่ในช่องให้สวยงาม"
 *
 * คาบที่สอนร่วมกันใส่ "ครู" ที่ชื่อแรกชื่อเดียว ไม่ใส่ซ้ำที่ชื่อหลัง เพราะช่อง
 * หนึ่งกว้างราวสิบเอ็ดตัวอักษร ขณะที่ "ทัฬหมน + Allen" กว้างสิบสามและถูกย่อ
 * อยู่ก่อนแล้ว ถ้าใส่ทั้งสองชื่อจะกลายเป็นสิบเจ็ดถึงยี่สิบสี่ ซึ่งเลยจุดที่ย่อ
 * แล้วยังอ่านออก แล้วจะถูกตัดท้ายด้วยจุดไข่ปลาแทน (คู่ที่ยาวสุดของโรงเรียนคือ
 * ครูลิยาภรณ์ + ภาษาจีนคนใหม่ ซึ่งถูกตัดท้ายอยู่แล้วตั้งแต่ยังไม่เติมคำว่าครู)
 *
 * ชื่อที่ผ่าน shortTeacher มาแล้วไม่มีคำนำหน้าเหลืออยู่ แต่กันไว้อีกชั้น เผื่อ
 * ชื่อที่เขียนไว้แปลก ๆ จะได้ไม่กลายเป็น "ครูครูสมชาย"
 */
export function withKhru(names: string[], join = " + "): string {
  if (names.length === 0) return "";
  const [first, ...rest] = names;
  const head = first.startsWith(KHRU) ? first : KHRU + first;
  return [head, ...rest].join(join);
}

export function teacherLine(s: TimetableSlot): string {
  const names = slotTeacherNames(s).map(shortTeacher).filter(Boolean);
  if (names.length <= 2) return withKhru(names);
  // คาบกิจกรรมมีครูคุมทั้งโรงเรียน รายชื่อนั้นเป็นบัญชีที่โรงเรียนเก็บไว้ ไม่ใช่
  // คำบรรยายในช่อง และการนับหัวก็ไม่ได้บอกอะไรกับคนที่อ่านตาราง
  //
  //   "ช่วยเอาครู 170 คนตรงข้างล่างคาบคุณธรรมชุมนุมออก
  //    เช่น ลส.นน.ยว. เฉยๆ ไม่ต้องมี ครู 27 คน"
  //
  // บรรทัดนี้ว่างไว้ ไม่ใช่ตัดบรรทัดทิ้ง เพราะสามบรรทัดในช่องมีความสูงตายตัว
  // รหัสวิชาทั้งแถวจึงยังอยู่ระดับเดียวกัน และเลขห้องก็ยังอยู่ระดับเดียวกัน
  if (s.is_activity_block) return "";
  return `${withKhru([names[0]])} +${names.length - 1} คน`;
}

export function shortTeacher(name: string | null | undefined): string {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";

  // "Mr. Charles" / "Miss Risen" — the title is a word of its own.
  let rest = parts;
  if (WESTERN_TITLE.test(parts[0])) {
    rest = parts.slice(1);
    if (rest.length === 0) return parts[0];   // nothing but a title; keep it
  }

  // "Mr.Charles" — the same title with the space left out, which the
  // whole-word test above cannot see.
  let first = rest[0].replace(WESTERN_GLUED, "").replace(WESTERN_CAMEL, "");
  if (!first) first = rest[0];
  for (const t of THAI_TITLES) {
    if (first.startsWith(t)) {
      const stripped = first.slice(t.length);
      // Only drop the title if a name is actually left behind, so someone
      // recorded as just "นาย" does not come out as an empty cell.
      if (stripped) first = stripped;
      break;                                   // longest match wins, once
    }
  }
  return first;
}
