// ตรรกะล้วนของรอบอัตรากำลัง — node รันตรง ๆ ใน tests/ts/wlround.ts: import ได้เฉพาะ import type และฟังก์ชันจาก
// curriculum.ts (ไฟล์ล้วนอีกไฟล์ ไม่มี React/axios) — ระดับชั้นและการเรียงห้องต้องเป็นกฎเดียวกับหน้าหลักสูตรและเซิร์ฟเวอร์
// ป้ายสถานะของรอบและของกลุ่มอยู่ที่นี่ที่เดียว (แผน "สัญญาที่ทุก task ใช้ร่วมกัน") · ตัวเลขของกลุ่มนับเป็น "รายการ"
// = แถววิชา + ตัวเลือกคาบเสรี/กิจกรรมของกลุ่ม ตาม wl_fill_counts ของเซิร์ฟเวอร์ (ชื่อคีย์ rows แต่รวมตัวเลือกด้วย)
import { classSort, KIND_TEXT, levelOf, type Term, type Unconverted } from "./curriculum";
import type { WlTeacher } from "./types";
import type { Tone } from "./ui";

// Term = {year, semester} · Unconverted = {source, ref, reason} (แผนการสอนที่แปลงไม่ได้ — แสดงเฉพาะ reason) ใช้ชนิดเดียวกับหน้าหลักสูตร
export type { Term, Unconverted };

// ---- รูปข้อมูลตามสัญญาของเซิร์ฟเวอร์ (route ของรอบ งานที่ 3–4) ----

export type RoundStatus = "preparing" | "filling" | "closed";
export type DeptStatusKey = "filling" | "submitted" | "returned" | "approved";
export type RowKind = "basic" | "additional" | "activity";

/** รอบ (wl_round_view) · counts.rows = แถววิชา · options/sets = ของภาคเรียนของรอบ · unconverted = จำนวนเท่านั้น */
export type Round = {
  id: number;
  year: number;
  semester: number;
  /** "2/2569" — ชื่อที่ต้องพิมพ์ยืนยันตอนปิดรอบ */
  label: string;
  status: RoundStatus;
  /** เวลาที่สร้างรอบ (ตอนกด "เปิดรอบ" — สถานะเตรียม) */
  opened_at: string;
  closed_at: string | null;
  counts: { rows: number; sets: number; options: number; unconverted: number };
  // ---- ขั้นที่ 3: ส่งเข้าโปรแกรมจัดตารางแล้ว (ปุ่มสร้างเทอมใหม่ของโปรแกรม) · ยังไม่ส่ง = null ทุกช่อง ----
  // ช่องเป็น optional: เซิร์ฟเวอร์รุ่นก่อนขั้นที่ 3 ไม่ส่งมา (เว็บกับเซิร์ฟเวอร์ขึ้นคนละที่ คนละเวลา) = ถือว่ายังไม่ส่ง
  /** ส่งเข้าโปรแกรมเมื่อ (ISO) */
  exported_at?: string | null;
  /** ชื่อเทอมที่ส่งเข้าไป ("2/2569") */
  exported_label?: string | null;
  /** ข้อความของรอบที่ส่งแล้ว คำนวณตอนอ่าน: "ส่งเข้าโปรแกรมแล้ว — เทอม X" · ปิดภาคเรียนแล้ว = ต่อท้าย EXPORT_DONE_TEXT ·
   *  ถูกปิดไว้ (เทอมที่เปิดเก่ากว่า) = ต่อท้าย EXPORT_PARKED_TEXT */
  exported_text?: string | null;
  /** รายงานผลการส่ง (ชุดกิจกรรมที่ต้องลงคาบเอง ฯลฯ) — อ่านด้วย exportActivityLines เท่านั้น (รูปมาจากเซิร์ฟเวอร์ ไม่เชื่อรูป) */
  export_report?: Record<string, unknown> | null;
  /** ทาง ข.: admin เปิดรอบที่ปิดแล้วให้แก้กลางเทอมเมื่อ (ISO) · ไม่ได้แก้อยู่ (ปิดรอบ/อัปเดตในโปรแกรมแล้ว) = null ·
   *  ไม่มีช่อง = เซิร์ฟเวอร์รุ่นก่อน */
  amending_since?: string | null;
};
/** GET /rounds/{id} · POST /rounds · open · close (admin) — มีตัวรายการที่แปลงไม่ได้ */
export type RoundDetail = Round & { unconverted: Unconverted[] };

/** GET /rounds/preview — ตัวเลขที่การเปิดรอบจะทำ โดยไม่เขียนอะไร */
export type RoundPreview = {
  label: string;
  rows: number;
  options: number;
  prefilled_rows: number;
  prefilled_options: number;
  empty_rows: number;
  lines_without_department: number;
  options_without_department: number;
  unconverted: Unconverted[];
};

/** สถานะกลุ่ม + ความคืบหน้า (GET .../departments · submit · approve · return)
 *  rows = จำนวนรายการ (แถว + ตัวเลือก) · confirmed = มีครูและยืนยันแล้ว · missing_teacher = ยังไม่มีครู */
export type DeptStatus = {
  department_id: number;
  status: DeptStatusKey;
  submitted_at: string | null;
  /** ชื่อเรียกของรหัสที่ใช้ส่ง */
  submitted_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  /** หมายเหตุตีกลับครั้งล่าสุด (คงอยู่หลังส่งใหม่/ตรวจผ่าน จนกว่าจะถูกตีกลับครั้งถัดไป) */
  note: string;
  rows: number;
  confirmed: number;
  missing_teacher: number;
};

/** แถว (ของรอบ) — ช่องวิชาอ่านจากบรรทัดหลักสูตร · ครูอ้างด้วย wl_teachers.id */
export type RoundRow = {
  id: number;
  round_id: number;
  line_id: number;
  curriculum_id: number;
  curriculum_name: string;
  group_id: number;
  group_name: string;
  subject_id: number | null;
  code: string;
  name: string;
  credits: number | null;
  weekly: number;
  kind: RowKind;
  department_id: number | null;
  teacher_id: number | null;
  co_teacher_id: number | null;
  lab_room_id: number | null;
  is_double: boolean;
  note: string;
  confirmed: boolean;
  from_plan: boolean;
  flag: string | null;
};

/** ครูของตัวเลือก — ตัวเลือกหนึ่งมีได้หลายคน */
export type OptionTeacher = {
  id: number;
  round_id: number;
  option_id: number;
  set_id: number;
  teacher_id: number | null;
  room_id: number | null;
  note: string;
  confirmed: boolean;
  from_plan: boolean;
};

export type RoundOptionSet = {
  id: number;
  year: number;
  semester: number;
  kind: "elective" | "activity";
  name: string;
  group_ids: number[];
  group_names: string[];
  weekly: number;
  is_double: boolean;
};

/** ตัวเลือกของชุดคาบเสรี/กิจกรรมในรอบ (GET .../rows → options) */
export type RoundOption = {
  id: number;
  set_id: number;
  subject_id: number | null;
  code: string;
  name: string;
  department_id: number | null;
  set: RoundOptionSet;
  teachers: OptionTeacher[];
};

/** ยอดคาบรายครู (GET .../loads) · own = ส่วนจากกลุ่มของผู้ขอ (admin: เท่ากับ total) */
export type TeacherLoad = { teacher_id: number; name: string; department_id: number | null; total: number; own: number };

// ---- ป้ายและสี ----

export const ROUND_STATUS_TEXT: Record<RoundStatus, string> = {
  preparing: "เตรียม (ยังไม่เปิดให้กรอก)",
  filling: "เปิดให้กรอก",
  closed: "ปิดรอบแล้ว",
};

// คัดลอกจาก WL_DEPT_STATUS_TEXT ของเซิร์ฟเวอร์ทุกตัวอักษร (ตัวทดสอบเทียบกับ mock_api.py) — ข้อความ 409 ของเซิร์ฟเวอร์
// ใช้คำเหล่านี้ หัวหน้ากับ admin จึงเห็นคำเดียวกันทั้งบนชิปและในข้อความผิดพลาด
export const DEPT_STATUS_TEXT: Record<DeptStatusKey, string> = {
  filling: "กำลังกรอก",
  submitted: "ส่งแล้ว รอผู้ดูแลระบบตรวจ",
  returned: "ถูกตีกลับให้แก้",
  approved: "ตรวจผ่านแล้ว",
};

const ROUND_TONE: Record<RoundStatus, Tone> = { preparing: "warn", filling: "info", closed: "mute" };
// แดงเฉพาะตีกลับ (แบบข้อ 6: แดงใช้กับข้อผิดพลาดและตีกลับเท่านั้น)
const DEPT_TONE: Record<DeptStatusKey, Tone> = { filling: "warn", submitted: "info", returned: "bad", approved: "ok" };

export function roundStatusTone(status: RoundStatus): Tone {
  return ROUND_TONE[status];
}

type DeptLike = Pick<DeptStatus, "status" | "rows" | "confirmed">;

// กำลังกรอกที่ยังไม่มีรายการไหนยืนยัน = ยังไม่มีใครลงมือ (ครูเทอมก่อนที่ระบบใส่ให้ไม่นับ) — admin ต้องแยกออกจากกลุ่มที่ทำอยู่
const notStarted = (d: DeptLike): boolean => d.status === "filling" && d.confirmed === 0;

/** สีชิปของกลุ่ม · กำลังกรอกที่ยังไม่ยืนยันสักรายการ = mute "ยังไม่เริ่ม" */
export function deptStatusTone(d: DeptLike): Tone {
  return notStarted(d) ? "mute" : DEPT_TONE[d.status];
}

/** ป้ายชิปของกลุ่ม: DEPT_STATUS_TEXT · "ยังไม่เริ่ม" · "ไม่มีรายการ" (กลุ่มที่รอบนี้ไม่มีแถวหรือตัวเลือกของกลุ่มเลย) */
export function deptStatusLabel(d: DeptLike): string {
  if (!notStarted(d)) return DEPT_STATUS_TEXT[d.status];
  return d.rows === 0 ? "ไม่มีรายการ" : "ยังไม่เริ่ม";
}

/** ชื่อรอบแบบเดียวกับ term_label ของเซิร์ฟเวอร์ ("2/2569") */
export function roundLabel(year: number, semester: number): string {
  return `${semester}/${year}`;
}

// เลขไทยแบบหน้าเดิม (formatNumber ของ curriculum.ts) — คั่นหลักพัน "1,220"
const fmt = (n: number): string => n.toLocaleString("th-TH");

// ---- รอบปัจจุบัน ----

/** รอบที่ยังไม่ปิด — เซิร์ฟเวอร์ยอมให้มีทีละรอบ (ดัชนี wl_rounds_one_open) */
export function currentRound<R extends Pick<Round, "status">>(rounds: readonly R[]): R | null {
  return rounds.find((r) => r.status !== "closed") ?? null;
}

/** รอบที่ปิดแล้ว (รายการรอบเก่า) ตามลำดับที่เซิร์ฟเวอร์ส่ง (ใหม่ก่อน) */
export function closedRounds<R extends Pick<Round, "status">>(rounds: readonly R[]): R[] {
  return rounds.filter((r) => r.status === "closed");
}

// ---- รอบที่ส่งเข้าโปรแกรมจัดตารางแล้ว (ขั้นที่ 3) ----
// รอบที่ส่งแล้วถูกปิดถาวร (เซิร์ฟเวอร์ตั้งสถานะปิดตอนส่ง และทุก route เขียนของรอบตอบ 409) ปุ่มแก้ทุกปุ่มจึงหายไปเองตามสถานะปิด
// (roundActions · reviewActions · editState) — ที่ต้องเพิ่มคือบอกว่าส่งแล้ว เป็นเทอมไหน และเทอมนั้นยังเปิดอยู่ไหม

/** ส่วนท้ายของ exported_text เมื่อเทอมของรอบถูกปิดไว้และเทอมที่เปิดเก่ากว่า (ปลดล็อกย้อน) — ชิ้นเดียวกับ WL_EXPORT_SUFFIX["parked"]
 *  ของเซิร์ฟเวอร์ (ตัวทดสอบเทียบกับ mock_api.py) */
export const EXPORT_PARKED_TEXT = " (ถูกปิดไว้ ปลดล็อกเทอมนั้นเพื่อใช้ต่อ)";
/** ส่วนท้ายเมื่อเทอมของรอบถูกปิดตามปกติเพราะขึ้นเทอมที่ใหม่กว่า (รีวิวทั้งสาขา M1) — WL_EXPORT_SUFFIX["done"] */
export const EXPORT_DONE_TEXT = " (ปิดภาคเรียนแล้ว)";

/**
 * ป้าย "ส่งเข้าโปรแกรมแล้ว — เทอม …" ของรอบ — ข้อความจากเซิร์ฟเวอร์ (exported_text) · ยังไม่ส่ง → null
 * state: open = เทอมของรอบเปิดอยู่ (บอกทางกลับเมื่อส่งผิดได้) · done = ปิดภาคเรียนแล้ว (โทนปกติ ไม่ชวนปลดล็อก) ·
 * parked = ถูกปิดไว้ ปลดล็อกเทอมนั้นเพื่อใช้ต่อ (warn)
 */
export function roundExportChip(
  r: Pick<Round, "exported_at" | "exported_label" | "exported_text">,
): { tone: Tone; text: string; state: "open" | "done" | "parked" } | null {
  if (!r.exported_at) return null;
  const text = r.exported_text || `ส่งเข้าโปรแกรมแล้ว — เทอม ${r.exported_label || "-"}`;
  if (text.endsWith(EXPORT_PARKED_TEXT)) return { tone: "warn", text, state: "parked" };
  return { tone: "ok", text, state: text.endsWith(EXPORT_DONE_TEXT) ? "done" : "open" };
}

/** ชุดกิจกรรมที่ต้องลงคาบเองจาก export_report: "ชื่อชุด · ห้อง · N คาบ/สัปดาห์ · ครู" (รูปเดียวกับหน้าต่างของโปรแกรมจัดตาราง)
 *  · ไม่มีรายงาน/รูปเสีย → [] */
export function exportActivityLines(report: unknown): string[] {
  const sets = isObj(report) && Array.isArray(report.activity_sets) ? report.activity_sets.filter(isObj) : [];
  const words = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  return sets.map((a) => {
    const groups = words(a.group_names);
    const teachers = words(a.teacher_names);
    const weekly = typeof a.weekly === "number" && Number.isFinite(a.weekly) ? a.weekly : 0;
    return [(typeof a.name === "string" && a.name.trim()) || "ชุดกิจกรรม", groups.join(", ") || "ไม่ระบุห้อง",
      `${fmt(weekly)} คาบ/สัปดาห์`, teachers.length ? teachers.join(", ") : "ยังไม่มีครู"].join(" · ");
  });
}

/** ชิปรอบบนแถบบน: รอบที่ยังไม่ปิด · เปิดให้แก้กลางเทอม = "แก้กลางเทอม" (หัวหน้ากลุ่มเห็นด้วย) · ไม่มี → null (ไม่แสดงชิป) */
export function roundChip(rounds: readonly Round[]): { tone: Tone; text: string } | null {
  const r = currentRound(rounds);
  if (!r) return null;
  if (r.amending_since) return { tone: "warn", text: `ภาคเรียน ${r.label} · แก้กลางเทอม` };
  return { tone: roundStatusTone(r.status), text: `ภาคเรียน ${r.label} · ${ROUND_STATUS_TEXT[r.status]}` };
}

// ---- ทาง ข.: เปิดรอบที่ปิดแล้วให้แก้กลางเทอม และประวัติการอัปเดตแผนกลางเทอม ----
// เซิร์ฟเวอร์ตัดสินว่าเปิดให้แก้ได้ไหม (ภาคเรียนที่เปิดอยู่ในโปรแกรมจัดตาราง · รอบอื่นที่ยังไม่ปิด) — ที่นี่ซ่อนปุ่มในกรณีที่รู้แน่ว่าจะได้ 409
// และบอกเหตุแทน · ป้ายอ่านจาก amending_since ของรอบเท่านั้น (ปิดรอบหรืออัปเดตในโปรแกรมแล้วเซิร์ฟเวอร์ล้างเป็น null)

/** ป้ายของรอบที่เปิดให้แก้กลางเทอม (แบบข้อ 4.5) */
export const AMEND_CHIP_TEXT = "แก้กลางเทอม — ยังไม่ส่ง";

/** ชิ้นเดียวกับข้อความ 409 ของ wl_rounds_amend เมื่อมีรอบอื่นที่ยังไม่ปิด (ตัวทดสอบเทียบกับ mock_api.py) */
export const AMEND_OTHER_OPEN = "รอบที่ยังไม่ปิดมีได้ทีละรอบ";

export function amendChip(r: Pick<Round, "amending_since">): { tone: Tone; text: string } | null {
  return r.amending_since ? { tone: "warn", text: AMEND_CHIP_TEXT } : null;
}

/**
 * ปุ่ม "เปิดให้แก้กลางเทอม" ของรอบ: show = รอบที่ปิดแล้ว ยกเว้นรอบที่ส่งแล้วซึ่งเทอมของมันปิดภาคเรียนแล้วหรือถูกปิดไว้
 * (ไม่ใช่ภาคเรียนที่เปิดอยู่ เซิร์ฟเวอร์ปฏิเสธแน่) · blocker = มีรอบอื่นที่ยังไม่ปิด (บอกเหตุแทนปุ่มที่กดแล้วได้ 409)
 * รอบที่ไม่เคยส่งของภาคเรียนอื่น เว็บนี้รู้ไม่ได้ว่าภาคไหนเปิดอยู่ในโปรแกรม — เซิร์ฟเวอร์ตอบข้อความไทยบอกเอง
 */
export function amendAction(
  round: Pick<Round, "id" | "status" | "exported_at" | "exported_label" | "exported_text">,
  rounds: readonly Pick<Round, "id" | "label" | "status">[],
): { show: boolean; blocker: string | null } {
  if (round.status !== "closed") return { show: false, blocker: null };
  const sent = roundExportChip(round);
  if (sent && sent.state !== "open") return { show: false, blocker: null };
  const others = rounds.filter((r) => r.id !== round.id && r.status !== "closed").map((r) => r.label);
  if (others.length === 0) return { show: true, blocker: null };
  return {
    show: true,
    blocker: `มีรอบ ${others.join(", ")} ที่ยังไม่ปิดอยู่ — ${AMEND_OTHER_OPEN} จึงเปิดรอบนี้ให้แก้กลางเทอมไม่ได้จนกว่าจะปิดหรือยกเลิกรอบนั้น `
      + "(ระหว่างนี้แก้แผนในโปรแกรมจัดตารางด้วยมือได้ตามปกติ)",
  };
}

/**
 * แก้เสร็จแล้วรอบใช้อัปเดตได้อีกเมื่อไร (รีวิวทั้งสาขา I1): เปิดให้แก้ส่งทุกกลุ่มกลับเป็นกำลังกรอก (wl_rounds_amend) · ส่งได้เฉพาะหัวหน้า ·
 * ตรวจผ่านได้เฉพาะกลุ่มที่ส่งแล้ว — เกณฑ์ของรอบคือ "ทุกกลุ่มตรวจผ่าน หรือรอบปิดแล้ว" จึงจบได้สองทาง · ใช้ทั้งกล่องยืนยัน ข้อความผล และบรรทัดบอกทางของรอบ
 */
export const AMEND_FINISH_TEXT =
  "แก้เสร็จแล้ว ให้ทุกกลุ่มที่มีรายการส่งใหม่และตรวจผ่าน (รวมกลุ่มที่ไม่ได้แก้) หรือผู้ดูแลระบบกด “ปิดรอบ” "
  + "แล้วไปกด “อัปเดตแผนจากรอบอัตรากำลัง” ในโปรแกรมจัดตารางสอน (เมนู ⚙ จัดการ → 🗓 เทอม)";

/** กล่องยืนยันเปิดให้แก้กลางเทอม: สิ่งที่จะเกิด และทางต่อ (แบบข้อ 4.1) · บรรทัดแรกกันการเปิดให้แก้โดยไม่จำเป็น (รีวิวทั้งสาขา I1) */
export function amendNotes(round: Pick<Round, "label" | "exported_at">): string[] {
  const lines = [
    "ถ้าแค่จะอัปเดตแผนในโปรแกรมจากรอบนี้โดยไม่แก้อะไร ไม่ต้องเปิดให้แก้ — รอบที่ปิดแล้วใช้ได้เลย (กด “อัปเดตแผนจากรอบอัตรากำลัง” ในโปรแกรมจัดตารางสอน)",
    `รอบ ${round.label} กลับเป็น "เปิดให้กรอก" และทุกกลุ่มสาระกลับเป็น "กำลังกรอก" (รวมกลุ่มที่ไม่ได้แก้) — รายการที่ยืนยันแล้วยังยืนยันอยู่ · หลักสูตรของภาคเรียนนี้แก้ได้อีก`,
    `${AMEND_FINISH_TEXT} — ติ๊กรับทีละข้อ แล้วรอบที่ยังเปิดอยู่จะกลับเป็นปิดเอง`,
    "ใช้ได้เฉพาะรอบของภาคเรียนที่เปิดอยู่ในโปรแกรมจัดตาราง · ตารางสอนยังไม่ถูกแตะจนกว่าจะกดอัปเดตในโปรแกรม",
  ];
  if (round.exported_at) lines.push("เครื่องหมาย “ส่งเข้าโปรแกรมแล้ว” ยังอยู่ — สร้างเทอมใหม่จากรอบนี้ซ้ำไม่ได้ (ส่งซ้ำไม่ได้)");
  return lines;
}

/**
 * หลังโหลดรายการรอบใหม่: รหัสรอบที่เปิดดูอยู่/กำลังยืนยันเปิดให้แก้ ยังเป็นรอบที่ปิดแล้วไหม — ไม่ใช่ (เปิดให้แก้แล้ว · หายไป) = null ให้ล้าง
 * (รีวิว T5 m2: ล้างเมื่อรายการใหม่มาถึง ไม่ใช่ตอนกดสำเร็จ — ไม่งั้นการ์ดเปิดรอบใหม่ขึ้นแวบหนึ่งระหว่างรอรายการ)
 */
export function stillClosed(rounds: readonly Pick<Round, "id" | "status">[], id: number | null): number | null {
  return id !== null && rounds.some((r) => r.id === id && r.status === "closed") ? id : null;
}

/**
 * กล่องยืนยันเปิดให้แก้หลังกด (รีวิว T5 m3): สำเร็จ = "done" ค้างไว้ (ปุ่มล็อก) จนรายการรอบใหม่มาถึง · 409/404 = "close" ข้อความไทยขึ้นบนสุดของหน้า
 * แล้วปิดกล่อง (กดซ้ำก็ได้ 409 เดิม) · ข้อผิดพลาดอื่น (ข้อความอยู่ในกล่อง) = "stay" กดใหม่ได้
 */
export function amendBoxAfter(ok: boolean, errorShownInBox: boolean): "done" | "close" | "stay" {
  if (ok) return "done";
  return errorShownInBox ? "stay" : "close";
}

/** หนึ่งข้อในประวัติ (wl_plan_updates.accepted/rejected) — auto = ข้อทะเบียนที่ระบบติ๊กให้เพราะข้ออื่นต้องใช้ */
export type PlanUpdateItem = { key: string; pile: string; label: string; auto?: boolean };

/** หนึ่งแถวของ GET /rounds/{id}/plan-updates (ใหม่ก่อน) */
export type PlanUpdate = {
  id: number;
  round_id: number;
  /** เทอมของโปรแกรมตอนอัปเดต · ยังไม่เคยสร้างเทอม = null */
  term_id: number | null;
  year: number;
  semester: number;
  at: string;
  /** ชื่อเรียกของรหัส admin ที่ใช้ยืนยัน */
  by: string | null;
  accepted: PlanUpdateItem[];
  rejected: PlanUpdateItem[];
  /** {token, todos, round_closed, writeback} — อ่านด้วย planUpdateLine เท่านั้น */
  report: Record<string, unknown> | null;
};

const isUpdateItem = (v: unknown): v is PlanUpdateItem =>
  isObj(v) && isText(v.key) && isText(v.pile) && isText(v.label) && (v.auto === undefined || isBool(v.auto));

export function isPlanUpdate(d: unknown): d is PlanUpdate {
  if (!isObj(d) || ![d.id, d.round_id, d.year, d.semester].every(isInt) || !isIdOrNull(d.term_id)) return false;
  if (!isText(d.at) || !isTextOrNull(d.by) || !isReportOrNull(d.report)) return false;
  return [d.accepted, d.rejected].every((list) => Array.isArray(list) && list.every(isUpdateItem));
}

/** หนึ่งบรรทัดของประวัติ: ยอมรับ/ไม่ยอมรับกี่ข้อ · ข้อที่ระบบติ๊กให้ · รายการงานใหม่ · รอบกลับเป็นปิด */
export function planUpdateLine(u: Pick<PlanUpdate, "accepted" | "rejected" | "report">): string {
  const auto = u.accepted.filter((x) => x.auto).length;
  const parts = [`ยอมรับ ${fmt(u.accepted.length)} ข้อ${auto > 0 ? ` (ระบบติ๊กข้อทะเบียนให้ ${fmt(auto)} ข้อ)` : ""}`,
    `ไม่ยอมรับ ${fmt(u.rejected.length)} ข้อ`];
  const todos = isObj(u.report) && isCount(u.report.todos) ? u.report.todos : 0;
  if (todos > 0) parts.push(`รายการงานใหม่ ${fmt(todos)} ข้อ`);
  if (isObj(u.report) && u.report.round_closed === true) parts.push("รอบกลับเป็นปิด");
  return parts.join(" · ");
}

/** รายการข้อที่เปิดดูได้ของหนึ่งครั้ง (ข้อที่ระบบติ๊กให้มีวงเล็บบอก) */
export function planUpdateItems(u: Pick<PlanUpdate, "accepted" | "rejected">): { accepted: string[]; rejected: string[] } {
  return {
    accepted: u.accepted.map((x) => (x.auto ? `${x.label} (ระบบติ๊กให้)` : x.label)),
    rejected: u.rejected.map((x) => x.label),
  };
}

// ---- ฟอร์มเปิดรอบ ----

/** ตรวจปี/ภาคเรียนที่พิมพ์ — กฎเดียวกับ _wl_term_args ของเซิร์ฟเวอร์ (พ.ศ. 2500–2700 · ภาค 1 หรือ 2) · ถูก → null */
export function checkRoundForm(year: string, semester: string): string | null {
  const y = year.trim();
  const s = semester.trim();
  if (y === "") return "ใส่ปีการศึกษา (พ.ศ. 4 หลัก เช่น 2569)";
  if (!/^\d{4}$/.test(y)) return "ปีการศึกษาต้องเป็นปี พ.ศ. 4 หลัก เช่น 2569";
  if (Number(y) < 2500 || Number(y) > 2700) return "ปีการศึกษาต้องอยู่ระหว่าง พ.ศ. 2500–2700";
  if (s === "") return "เลือกภาคเรียน (1 หรือ 2)";
  if (s !== "1" && s !== "2") return "ภาคเรียนต้องเป็น 1 หรือ 2";
  return null;
}

export type Readiness = { ok: true } | { ok: false; reason: string; needCurriculum: boolean };

/** ภาคเรียนนี้เปิดรอบได้ไหม (ก่อนกดดูก่อนเปิด) · หนึ่งภาคเรียนมีได้รอบเดียว · แถวของรอบมาจากหลักสูตร จึงต้องมีหลักสูตรก่อน
 *  curriculumTerms = ภาคเรียนที่มีหลักสูตร (null = โหลดไม่ได้ → ไม่ขวาง ให้เซิร์ฟเวอร์ตัดสิน) */
export function termReadiness(
  term: Term,
  curriculumTerms: readonly Term[] | null,
  rounds: readonly Pick<Round, "year" | "semester" | "label" | "status">[],
): Readiness {
  const label = roundLabel(term.year, term.semester);
  const same = rounds.find((r) => r.year === term.year && r.semester === term.semester);
  if (same) {
    return {
      ok: false,
      reason: `ภาคเรียน ${label} มีรอบอัตรากำลังแล้ว (${ROUND_STATUS_TEXT[same.status]}) — หนึ่งภาคเรียนมีได้รอบเดียว`,
      needCurriculum: false,
    };
  }
  if (curriculumTerms && !curriculumTerms.some((t) => t.year === term.year && t.semester === term.semester)) {
    return {
      ok: false,
      reason: `ภาคเรียน ${label} ยังไม่มีหลักสูตร — ทำหลักสูตรก่อน แล้วค่อยเปิดรอบ (แถวของรอบมาจากหลักสูตร)`,
      needCurriculum: true,
    };
  }
  return { ok: true };
}

/** ภาคเรียนตั้งต้นของฟอร์มเปิดรอบ: ภาคเรียนล่าสุดที่มีหลักสูตรแต่ยังไม่มีรอบ · ไม่มี → ภาคเรียนตอนนี้ (guess) ถ้ายังไม่มีรอบ
 *  · มีแล้ว → ภาคเรียนถัดจากรอบล่าสุด (เพิ่งปิด 2/2569 → 1/2570 แล้วฟอร์มบอกว่าต้องทำหลักสูตรก่อน แทนที่จะชี้ภาคที่มีรอบแล้ว) */
export function defaultOpenTerm(
  curriculumTerms: readonly Term[] | null,
  rounds: readonly Pick<Round, "year" | "semester">[],
  guess: Term,
): Term {
  const has = (t: Term) => rounds.some((r) => r.year === t.year && r.semester === t.semester);
  const free = [...(curriculumTerms ?? [])].sort((a, b) => b.year - a.year || b.semester - a.semester).find((t) => !has(t));
  if (free) return { year: free.year, semester: free.semester };
  if (!has(guess)) return guess;
  const last = [...rounds].sort((a, b) => b.year - a.year || b.semester - a.semester)[0];
  return last.semester === 1 ? { year: last.year, semester: 2 } : { year: last.year + 1, semester: 1 };
}

// ---- ดูก่อนเปิด ----

type DeptGaps = Pick<RoundPreview, "lines_without_department" | "options_without_department">;

/** คำเตือนของหน้าดูก่อนเปิด: บรรทัด/ตัวเลือกที่ยังไม่มีกลุ่มสาระ (ไม่มีหัวหน้าคนไหนเห็น ต้องแก้ที่หลักสูตรก่อนเปิดให้กรอก) */
export function previewWarnings(p: DeptGaps): string[] {
  const out: string[] = [];
  const after = "ไม่มีหัวหน้ากลุ่มสาระคนไหนเห็น ต้องระบุที่หน้าหลักสูตรก่อนเปิดให้กลุ่มสาระกรอก";
  if (p.lines_without_department > 0) {
    out.push(`บรรทัดหลักสูตรที่ยังไม่ระบุกลุ่มสาระ ${fmt(p.lines_without_department)} บรรทัด — ${after}`);
  }
  if (p.options_without_department > 0) {
    out.push(`ตัวเลือกคาบเสรี/กิจกรรมที่ยังไม่ระบุกลุ่มสาระ ${fmt(p.options_without_department)} ตัวเลือก — ${after}`);
  }
  return out;
}

/** ข้อความไทยของหน้าดูก่อนเปิด (ไม่มีบรรทัดของค่าที่เป็นศูนย์) — คำเตือนอยู่ท้ายรายการ และอยู่ใน previewWarnings ด้วย */
export function previewLines(p: RoundPreview): string[] {
  const lines =
    p.rows > 0
      ? [`รอบนี้จะมีแถววิชา ${fmt(p.rows)} แถว (บรรทัดหลักสูตร × ห้องเรียนที่ใช้หลักสูตรนั้น)`]
      : ["หลักสูตรของภาคเรียนนี้ยังไม่มีแถววิชา (ยังไม่ได้ใส่ห้องเรียนให้หลักสูตร)"];
  if (p.options > 0) lines.push(`ตัวเลือกคาบเสรี/กิจกรรม ${fmt(p.options)} ตัวเลือก`);
  if (p.prefilled_rows > 0) {
    lines.push(`มีครูเทอมก่อน ${fmt(p.prefilled_rows)} แถว — ใส่ไว้ให้แบบยังไม่ยืนยัน หัวหน้ากลุ่มสาระต้องกดยืนยันเอง`);
  }
  if (p.prefilled_options > 0) {
    lines.push(`ตัวเลือกที่มีครูเทอมก่อน ${fmt(p.prefilled_options)} ตัวเลือก (ยังไม่ยืนยันเช่นกัน)`);
  }
  if (p.empty_rows > 0) lines.push(`ช่องครูว่าง ${fmt(p.empty_rows)} แถว — หัวหน้ากลุ่มสาระเลือกครูเอง`);
  if (p.unconverted.length > 0) {
    lines.push(`แผนการสอนเทอมก่อนที่แปลงไม่ได้ ${fmt(p.unconverted.length)} รายการ — ดูเหตุผลด้านล่าง`);
  }
  return [...lines, ...previewWarnings(p)];
}

/** เหตุที่ยังกด "เปิดให้กลุ่มสาระกรอก" ไม่ได้ (เงื่อนไขเดียวกับ POST /rounds/{id}/open) · null = เปิดได้ */
export function openBlocker(p: DeptGaps): string | null {
  const what = [
    ...(p.lines_without_department > 0 ? [`บรรทัดหลักสูตร ${fmt(p.lines_without_department)} บรรทัด`] : []),
    ...(p.options_without_department > 0 ? [`ตัวเลือกคาบเสรี/กิจกรรม ${fmt(p.options_without_department)} ตัวเลือก`] : []),
  ];
  if (what.length === 0) return null;
  return `ยังเปิดให้กลุ่มสาระกรอกไม่ได้ — ${what.join(" และ ")} ยังไม่ได้ระบุกลุ่มสาระ (ไม่มีหัวหน้ากลุ่มสาระคนไหนเห็น) ให้ระบุที่หน้าหลักสูตรก่อน`;
}

// ---- ภาพรวม ----

/** ความคืบหน้าของกลุ่ม: pct ปัดลง (ยืนยัน 999/1000 ไม่ขึ้น 100%) · ข้อความนับเป็น "รายการ" */
export function deptProgress(d: Pick<DeptStatus, "status" | "rows" | "confirmed" | "missing_teacher">): { pct: number; text: string } {
  if (d.rows <= 0) return { pct: 0, text: "ไม่มีรายการของกลุ่มนี้ในรอบนี้" };
  const pct = d.confirmed >= d.rows ? 100 : Math.floor((d.confirmed * 100) / d.rows);
  const missing = d.missing_teacher > 0 ? ` · ยังไม่มีครู ${fmt(d.missing_teacher)}` : "";
  if (notStarted(d)) return { pct: 0, text: `ยังไม่เริ่ม · ${fmt(d.rows)} รายการ${missing}` };
  if (d.confirmed >= d.rows) return { pct, text: `ยืนยันครบ ${fmt(d.rows)} รายการ` };
  return { pct, text: `ยืนยันแล้ว ${fmt(d.confirmed)}/${fmt(d.rows)} รายการ${missing}` };
}

export type RoundStats = {
  /** แถววิชาของรอบ (ไม่รวมตัวเลือก) */
  rows: number;
  options: number;
  departments: number;
  /** ส่งแล้ว = ส่งแล้วรอตรวจ + ตรวจผ่านแล้ว (กลุ่มที่ถูกตีกลับกลับไปแก้อยู่ ไม่นับ) */
  submitted: number;
  approved: number;
  /** มีครูแต่ยังไม่ยืนยัน รวมทุกกลุ่ม (รายการ) */
  unconfirmed: number;
  missingTeacher: number;
};

/** ตัวเลขของ StatTile สี่ช่อง — ไม่แก้ลิสต์ที่ส่งเข้ามา */
export function roundStats(round: Pick<Round, "counts">, depts: readonly DeptStatus[]): RoundStats {
  let submitted = 0;
  let approved = 0;
  let unconfirmed = 0;
  let missingTeacher = 0;
  for (const d of depts) {
    if (d.status === "submitted" || d.status === "approved") submitted += 1;
    if (d.status === "approved") approved += 1;
    unconfirmed += Math.max(0, d.rows - d.confirmed - d.missing_teacher);
    missingTeacher += d.missing_teacher;
  }
  return {
    rows: round.counts.rows, options: round.counts.options, departments: depts.length, submitted, approved,
    unconfirmed, missingTeacher,
  };
}

// ---- ปุ่มตามสถานะ (ตามที่เซิร์ฟเวอร์ยอมจริง ไม่งั้นกดแล้วได้ 409) ----

/** ปุ่มของรอบ: เตรียม → เปิดให้กรอก/ยกเลิกรอบ (ปิดไม่ได้ — ปิดแล้วล็อกหลักสูตรตลอดไป) · เปิดให้กรอก → ปิดรอบ ตรวจ/ตีกลับ */
export function roundActions(status: RoundStatus): { open: boolean; cancel: boolean; close: boolean; review: boolean } {
  return {
    open: status === "preparing",
    cancel: status === "preparing",
    close: status === "filling",
    review: status === "filling",
  };
}

/** ปุ่มของการ์ดกลุ่ม: ตรวจผ่านจากส่งแล้ว · ตีกลับจากส่งแล้วหรือตรวจผ่านแล้ว (แก้การตรวจผ่านที่กดพลาด) · รอบต้องเปิดให้กรอก */
export function reviewActions(roundStatus: RoundStatus, deptStatus: DeptStatusKey): { approve: boolean; return: boolean } {
  const open = roundStatus === "filling";
  return {
    approve: open && deptStatus === "submitted",
    return: open && (deptStatus === "submitted" || deptStatus === "approved"),
  };
}

/** กลุ่มที่ส่งแล้ว/ตรวจผ่านแล้วแต่รายการไม่ครบ — แถวผูกกับบรรทัดหลักสูตร การแก้หลักสูตรระหว่างเปิดให้กรอกเพิ่มแถวไม่มีครูให้กลุ่มที่ส่งแล้ว
 *  ได้ และ admin ล้างครูของกลุ่มที่ส่งแล้วได้ · submitted → ข้อความเดียวกับ 409 ของ wl_approve_blocker (ปุ่มตรวจผ่านกดไม่ได้ บอกเหตุนี้)
 *  · approved → เตือนให้ตีกลับ · สถานะอื่น (หัวหน้ายังกรอกอยู่) หรือครบแล้ว → null · ตัวเลขไม่คั่นหลักพันเหมือนเซิร์ฟเวอร์ */
export function reviewGap(d: Pick<DeptStatus, "status" | "rows" | "confirmed" | "missing_teacher">): string | null {
  if (d.status !== "submitted" && d.status !== "approved") return null;
  const missing = d.missing_teacher;
  const unconfirmed = Math.max(0, d.rows - d.confirmed - missing);
  if (!missing && !unconfirmed) return null;
  return d.status === "submitted"
    ? `ตรวจผ่านไม่ได้ — ตั้งแต่กลุ่มส่งมา มีรายการที่${gapBits(missing, unconfirmed)} ตีกลับให้กลุ่มกรอกก่อน`
    : `ตรวจผ่านแล้ว แต่ภายหลังมีรายการที่${gapBits(missing, unconfirmed)} — ตีกลับให้กลุ่มกรอกให้ครบ`;
}

/** กล่องยืนยันปิดรอบ: ต้องพิมพ์ชื่อรอบให้ตรง (ตัดช่องว่างหัวท้ายแบบเซิร์ฟเวอร์) · ตรง → null */
export function checkCloseLabel(typed: string, label: string): string | null {
  return typed.trim() === label ? null : `พิมพ์ ${label} ให้ตรงเพื่อยืนยันการปิดรอบ`;
}

/** หมายเหตุตีกลับห้ามว่าง — เป็นสิ่งเดียวที่บอกหัวหน้าว่าต้องแก้อะไร (เซิร์ฟเวอร์ตอบ 400 เหมือนกัน) */
export function checkReturnNote(note: string): string | null {
  return note.trim() ? null : "เขียนหมายเหตุบอกกลุ่มสาระว่าต้องแก้อะไร (ห้ามว่าง)";
}

// ---- ตรวจรูปคำตอบของเซิร์ฟเวอร์ (roundApi.ts โยน ContractError เมื่อไม่ผ่าน) ----
// ตัวเลขผิดรูปที่ถูกแปลงเป็น 0 จะอ่านออกมาเป็น "ยังไม่มีใครยืนยัน" หรือ "ไม่มีแถว" ซึ่งซ่อนความผิดพลาด

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const isCount = (n: unknown): n is number => isInt(n) && n >= 0;
const isText = (s: unknown): s is string => typeof s === "string";
const isBool = (b: unknown): b is boolean => typeof b === "boolean";
const isIdOrNull = (n: unknown): boolean => n === null || isInt(n);
const isTextOrNull = (s: unknown): boolean => s === null || isText(s);
const ROUND_STATUSES: readonly string[] = ["preparing", "filling", "closed"];
const DEPT_STATUSES: readonly string[] = ["filling", "submitted", "returned", "approved"];
const ROW_KINDS: readonly string[] = ["basic", "additional", "activity"];
const SET_KINDS: readonly string[] = ["elective", "activity"];

const isUnconvertedList = (v: unknown): v is Unconverted[] =>
  Array.isArray(v) && v.every((u) => isObj(u) && isText(u.reason));

// ช่องของขั้นที่ 3: ไม่มีช่อง (เซิร์ฟเวอร์รุ่นก่อน) = ยังไม่ส่ง · มีแต่ผิดรูป = ไม่ผ่าน
const isAbsentOr = (ok: (v: unknown) => boolean) => (v: unknown): boolean => v === undefined || ok(v);
const isReportOrNull = (v: unknown): boolean => v === null || isObj(v);

export function isRound(d: unknown): d is Round {
  if (!isObj(d) || !isInt(d.id) || !isInt(d.year) || !isInt(d.semester) || !isText(d.label)) return false;
  if (!ROUND_STATUSES.includes(d.status as string) || !isText(d.opened_at) || !isTextOrNull(d.closed_at)) return false;
  if (![d.exported_at, d.exported_label, d.exported_text, d.amending_since].every(isAbsentOr(isTextOrNull))) return false;
  if (!isAbsentOr(isReportOrNull)(d.export_report)) return false;
  const c = d.counts;
  return isObj(c) && isCount(c.rows) && isCount(c.sets) && isCount(c.options) && isCount(c.unconverted);
}

export function isRoundDetail(d: unknown): d is RoundDetail {
  return isRound(d) && isUnconvertedList((d as Obj).unconverted);
}

export function isRoundPreview(d: unknown): d is RoundPreview {
  if (!isObj(d) || !isText(d.label) || !isUnconvertedList(d.unconverted)) return false;
  return [d.rows, d.options, d.prefilled_rows, d.prefilled_options, d.empty_rows, d.lines_without_department,
    d.options_without_department].every(isCount);
}

export function isDeptStatus(d: unknown): d is DeptStatus {
  if (!isObj(d) || !isInt(d.department_id) || !DEPT_STATUSES.includes(d.status as string)) return false;
  if (![d.submitted_at, d.submitted_by, d.reviewed_at, d.reviewed_by].every(isTextOrNull) || !isText(d.note)) return false;
  return isCount(d.rows) && isCount(d.confirmed) && isCount(d.missing_teacher);
}

export function isRoundRow(d: unknown): d is RoundRow {
  if (!isObj(d)) return false;
  if (![d.id, d.round_id, d.line_id, d.curriculum_id, d.group_id].every(isInt)) return false;
  if (![d.curriculum_name, d.group_name, d.code, d.name, d.note].every(isText) || !isCount(d.weekly)) return false;
  if (![d.subject_id, d.department_id, d.teacher_id, d.co_teacher_id, d.lab_room_id].every(isIdOrNull)) return false;
  if (!(d.credits === null || (typeof d.credits === "number" && Number.isFinite(d.credits)))) return false;
  if (!ROW_KINDS.includes(d.kind as string) || !isTextOrNull(d.flag)) return false;
  return [d.is_double, d.confirmed, d.from_plan].every(isBool);
}

export function isOptionTeacher(d: unknown): d is OptionTeacher {
  if (!isObj(d) || ![d.id, d.round_id, d.option_id, d.set_id].every(isInt)) return false;
  return isIdOrNull(d.teacher_id) && isIdOrNull(d.room_id) && isText(d.note) && isBool(d.confirmed) && isBool(d.from_plan);
}

function isOptionSet(d: unknown): d is RoundOptionSet {
  if (!isObj(d) || ![d.id, d.year, d.semester].every(isInt) || !isText(d.name) || !SET_KINDS.includes(d.kind as string)) {
    return false;
  }
  if (!Array.isArray(d.group_ids) || !d.group_ids.every(isInt)) return false;
  if (!Array.isArray(d.group_names) || d.group_names.length !== d.group_ids.length || !d.group_names.every(isText)) return false;
  return isCount(d.weekly) && isBool(d.is_double);
}

export function isRoundOption(d: unknown): d is RoundOption {
  if (!isObj(d) || !isInt(d.id) || !isInt(d.set_id) || !isIdOrNull(d.subject_id) || !isIdOrNull(d.department_id)) return false;
  if (!isText(d.code) || !isText(d.name) || !isOptionSet(d.set)) return false;
  return Array.isArray(d.teachers) && d.teachers.every(isOptionTeacher);
}

export function isTeacherLoad(d: unknown): d is TeacherLoad {
  return isObj(d) && isInt(d.teacher_id) && isText(d.name) && isIdOrNull(d.department_id) && isCount(d.total)
    && isCount(d.own);
}

// ════ หน้ากรอกของหัวหน้ากลุ่มสาระ (งานที่ 8) ════════════════════════════════
// หัวหน้าใส่ครูอย่างเดียว (แบบข้อ 4.5) · ตัวนับ ข้อความส่งไม่ได้ และข้อความแก้ไม่ได้ เป็นกฎเดียวกับเซิร์ฟเวอร์
// (wl_fill_counts · wl_submit_blocker · wl_can_edit) — จอกับเซิร์ฟเวอร์ต้องไม่บอกคนละอย่าง

/** สถานะของรายการหนึ่งรายการ: ยังไม่มีครู · มีครูแต่ยังไม่ยืนยัน · ครบ (มีครูและยืนยันแล้ว) */
export type ItemState = "missing" | "unconfirmed" | "done";

/** แถว: ดูว่ามีครูผู้สอนก่อน แล้วค่อยดูธงยืนยัน (_wl_row_state) — แถวที่ธงยืนยันค้างแต่ไม่มีครูยังเป็น "ยังไม่มีครู"
 *  · ครูสอนร่วมอย่างเดียวไม่นับว่ามีครู (ครูผู้สอนคือคนที่รับแถวนี้) */
export function rowState(row: Pick<RoundRow, "teacher_id" | "confirmed">): ItemState {
  if (row.teacher_id === null) return "missing";
  return row.confirmed ? "done" : "unconfirmed";
}

/** ตัวเลือก: หนึ่งรายการไม่ว่ามีครูกี่คน (_wl_option_state) · ไม่มีครูสักคน = ยังไม่มีครู · ครูทุกคนยืนยัน = ครบ */
export function optionState(option: Pick<RoundOption, "teachers">): ItemState {
  const teachers = option.teachers.filter((t) => t.teacher_id !== null);
  if (teachers.length === 0) return "missing";
  return teachers.every((t) => t.confirmed) ? "done" : "unconfirmed";
}

export type FillProgress = { total: number; confirmed: number; missingTeacher: number };

/** ความคืบหน้าของกลุ่ม — นับแบบ wl_fill_counts: รายการ = แถว + ตัวเลือก · ที่เหลือ (total − confirmed − missingTeacher) = ยังไม่ยืนยัน */
export function fillProgress(
  rows: readonly Pick<RoundRow, "teacher_id" | "confirmed">[],
  options: readonly Pick<RoundOption, "teachers">[],
): FillProgress {
  const states = [...rows.map(rowState), ...options.map(optionState)];
  return {
    total: states.length,
    confirmed: states.filter((s) => s === "done").length,
    missingTeacher: states.filter((s) => s === "missing").length,
  };
}

export type Verdict = { can: boolean; reason: string | null };
const YES: Verdict = { can: true, reason: null };
const no = (reason: string): Verdict => ({ can: false, reason });

// ข้อความของ wl_can_edit / wl_dept_submit (ตัวทดสอบเทียบชิ้นข้อความกับ mock_api.py) — ตัวเลขไม่คั่นหลักพันเหมือนเซิร์ฟเวอร์
const CLOSED_EDIT = "รอบอัตรากำลังนี้ปิดแล้ว จึงแก้ไม่ได้อีก (เก็บไว้เป็นหลักฐานย้อนหลัง)";
const NOT_OPEN = "รอบอัตรากำลังนี้ยังไม่เปิดให้กลุ่มสาระกรอก";

/** "ยังไม่มีครู N รายการ · ยังไม่ยืนยัน M รายการ" เฉพาะส่วนที่ไม่เป็นศูนย์ — ชิ้นเดียวกับ wl_submit_blocker และ wl_approve_blocker */
function gapBits(missing: number, unconfirmed: number): string {
  return [...(missing ? [`ยังไม่มีครู ${missing} รายการ`] : []), ...(unconfirmed ? [`ยังไม่ยืนยัน ${unconfirmed} รายการ`] : [])].join(" · ");
}

/** กดส่งได้ไหม และถ้าไม่ได้เพราะอะไร — ลำดับเดียวกับ POST .../submit: รอบ → สถานะกลุ่ม → รายการที่ยังไม่ครบ (wl_submit_blocker) */
export function submitState(progress: FillProgress, deptStatus: DeptStatusKey, roundStatus: RoundStatus): Verdict {
  if (roundStatus === "closed") return no("รอบอัตรากำลังนี้ปิดแล้ว จึงส่งไม่ได้");
  if (roundStatus !== "filling") return no(NOT_OPEN);
  if (deptStatus === "submitted" || deptStatus === "approved") return no(DEPT_STATUS_TEXT[deptStatus]);
  const missing = progress.missingTeacher;
  const unconfirmed = Math.max(0, progress.total - progress.confirmed - missing);
  if (!missing && !unconfirmed) return YES;
  return no(`ยังส่งไม่ได้ — ${gapBits(missing, unconfirmed)} (นับทั้งแถววิชาและตัวเลือกคาบเสรี/กิจกรรมของกลุ่ม) ใส่ครูและยืนยันให้ครบก่อน`);
}

/** แก้แถว/ครูของตัวเลือกของกลุ่มนี้ได้ไหม (wl_can_edit — หน้านี้แสดงแค่กลุ่มเดียว จึงไม่มีกรณีกลุ่มอื่น)
 *  admin: รอบเตรียม/เปิดให้กรอก แก้ได้ทุกสถานะกลุ่ม · หัวหน้า: รอบเปิดให้กรอก และกลุ่มกำลังกรอกหรือถูกตีกลับ · รอบปิด: ห้ามทุกคน */
export function editState(mode: "head" | "admin", roundStatus: RoundStatus, deptStatus: DeptStatusKey | null): Verdict {
  if (roundStatus === "closed") return no(CLOSED_EDIT);
  if (mode === "admin") return YES;
  if (roundStatus !== "filling") return no(NOT_OPEN);
  if (deptStatus === "filling" || deptStatus === "returned") return YES;
  if (deptStatus === "submitted" || deptStatus === "approved") {
    return no(`กลุ่มสาระนี้${DEPT_STATUS_TEXT[deptStatus]} จึงแก้ไม่ได้ — ถ้าต้องแก้ ให้ผู้ดูแลระบบตีกลับก่อน`);
  }
  return no("ไม่พบสถานะของกลุ่มสาระนี้ในรอบ จึงยังแก้ไม่ได้ แจ้งผู้ดูแลระบบ");
}

// ---- การ์ดวิชา ----

type GroupRow = Pick<RoundRow, "id" | "line_id" | "code" | "name" | "weekly" | "kind" | "credits" | "curriculum_name"
  | "curriculum_id" | "group_name">;

/** การ์ดวิชาหนึ่งใบ = วิชาเดียวกัน (รหัส ชื่อ คาบ/สัปดาห์ ประเภท หน่วยกิต) จากทุกหลักสูตรของกลุ่ม
 *  · curricula = หลักสูตรที่แถวของการ์ดมาจาก (ไม่ซ้ำ ตามลำดับห้อง) สำหรับลิงก์ "จากหลักสูตร …" (ตรวจย้อนได้)
 *  · curriculumName = ชื่อหลักสูตรเหล่านั้นต่อกันด้วย " · " */
export type SubjectGroup<R extends GroupRow = RoundRow> = {
  key: string;
  code: string;
  name: string;
  weekly: number;
  kind: RowKind;
  credits: number | null;
  curricula: { id: number; name: string }[];
  curriculumName: string;
  rows: R[];
};

const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
// ระดับที่ไม่มีเลข (ห้องที่ไม่ใช่รูป ม.N/…) ไว้ท้าย
const levelRank = (groupName: string): number => {
  const lv = levelOf(groupName);
  return lv === null ? Number.POSITIVE_INFINITY : Number(lv.slice(2));
};

/** จัดแถวเป็นการ์ดวิชา: เรียงตามระดับของห้องแรก → รหัสวิชา → ห้องแรก · แถวในการ์ดเรียงแบบห้อง (ม.1/2 ก่อน ม.1/10) · ไม่แก้ลิสต์เดิม
 *  รวมข้ามหลักสูตร ไม่ใช่การ์ดละบรรทัดหลักสูตร: หลักสูตรที่ตั้งต้นจากโปรแกรมจัดตารางส่วนใหญ่มีห้องเดียว (ห้องที่รายวิชาต่างกันนิดเดียว
 *  ก็แยกหลักสูตร) การ์ดละบรรทัดจึงกลายเป็นการ์ดละห้อง — ใส่ครูให้หลายห้องไม่ได้ และไม่ตรงกับชีตเดิมที่วิชาละก้อน
 *  คาบ/สัปดาห์หรือหน่วยกิตต่างกัน = คนละการ์ด (หัวการ์ดบอกค่าเดียว) */
export function groupBySubject<R extends GroupRow>(rows: readonly R[]): SubjectGroup<R>[] {
  const bySubject = new Map<string, R[]>();
  for (const r of rows) {
    const key = [r.code, r.name, r.weekly, r.kind, r.credits ?? ""].join("|");
    const list = bySubject.get(key);
    if (list) list.push(r);
    else bySubject.set(key, [r]);
  }
  const groups: SubjectGroup<R>[] = [];
  for (const [key, list] of bySubject) {
    const sorted = [...list].sort((a, b) => classSort(a.group_name, b.group_name) || a.id - b.id);
    const curricula: { id: number; name: string }[] = [];
    for (const r of sorted) {
      if (!curricula.some((c) => c.id === r.curriculum_id)) curricula.push({ id: r.curriculum_id, name: r.curriculum_name });
    }
    const f = sorted[0];
    groups.push({
      key, code: f.code, name: f.name, weekly: f.weekly, kind: f.kind, credits: f.credits,
      curricula, curriculumName: curricula.map((c) => c.name).join(" · "), rows: sorted,
    });
  }
  return groups.sort((a, b) =>
    levelRank(a.rows[0].group_name) - levelRank(b.rows[0].group_name)
    || cmpText(a.code, b.code)
    || classSort(a.rows[0].group_name, b.rows[0].group_name)
    || cmpText(a.key, b.key));
}

/** บรรทัดรองของการ์ดวิชา: "พื้นฐาน · 1.5 หน่วยกิต · 3 คาบ/สัปดาห์ · 12 ห้อง" */
export function subjectLine(g: Pick<SubjectGroup<GroupRow>, "kind" | "credits" | "weekly" | "rows">): string {
  return [
    KIND_TEXT[g.kind],
    ...(g.credits !== null ? [`${fmt(g.credits)} หน่วยกิต`] : []),
    `${fmt(g.weekly)} คาบ/สัปดาห์`,
    `${fmt(g.rows.length)} ห้อง`,
  ].join(" · ");
}

// ---- ตัวกรอง ----

export type FillFilter = {
  /** all · todo = ยังไม่ครบ (ยังไม่มีครู + ยังไม่ยืนยัน) · done = ยืนยันแล้ว */
  state: "all" | "todo" | "done";
  /** "ม.1" … · null = ทุกชั้น */
  level: string | null;
  query: string;
};

const stateOk = (s: ItemState, want: FillFilter["state"]): boolean =>
  want === "all" || (want === "done" ? s === "done" : s !== "done");
const queryOf = (q: string): string => q.trim().toLowerCase();
const hit = (q: string, texts: readonly string[]): boolean => q === "" || texts.some((t) => t.toLowerCase().includes(q));

/** แถวที่ผ่านตัวกรอง · ค้นด้วยรหัสวิชา ชื่อวิชา ชื่อห้อง ชื่อครูผู้สอนและครูสอนร่วม (ไม่สนช่องว่างหัวท้ายและตัวพิมพ์) */
export function filterRows<R extends Pick<RoundRow, "teacher_id" | "co_teacher_id" | "confirmed" | "group_name" | "code" | "name">>(
  rows: readonly R[],
  filter: FillFilter,
  teacherName: (id: number) => string,
): R[] {
  const q = queryOf(filter.query);
  return rows.filter((r) => {
    if (!stateOk(rowState(r), filter.state)) return false;
    if (filter.level !== null && levelOf(r.group_name) !== filter.level) return false;
    const people = [r.teacher_id, r.co_teacher_id].filter((t): t is number => t !== null).map(teacherName);
    return hit(q, [r.code, r.name, r.group_name, ...people]);
  });
}

/** ตัวเลือกคาบเสรี/กิจกรรมที่ผ่านตัวกรอง · ระดับดูจากห้องของชุด · ค้นด้วยรหัส ชื่อวิชา ชื่อชุด ห้อง และชื่อครู */
export function filterOptions<O extends Pick<RoundOption, "code" | "name" | "set" | "teachers">>(
  options: readonly O[],
  filter: FillFilter,
  teacherName: (id: number) => string,
): O[] {
  const q = queryOf(filter.query);
  return options.filter((o) => {
    if (!stateOk(optionState(o), filter.state)) return false;
    if (filter.level !== null && !o.set.group_names.some((g) => levelOf(g) === filter.level)) return false;
    const people = o.teachers.map((t) => t.teacher_id).filter((t): t is number => t !== null).map(teacherName);
    return hit(q, [o.code, o.name, o.set.name, ...o.set.group_names, ...people]);
  });
}

/** ระดับชั้นที่มีในแถวและตัวเลือกของกลุ่ม (ปุ่ม ม.1 … ของตัวกรอง) เรียงตามเลข */
export function fillLevels(
  rows: readonly Pick<RoundRow, "group_name">[],
  options: readonly Pick<RoundOption, "set">[],
): string[] {
  const names = [...rows.map((r) => r.group_name), ...options.flatMap((o) => o.set.group_names)];
  const levels = new Set(names.map(levelOf).filter((l): l is string => l !== null));
  return [...levels].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

// ---- ครู ----

type TeacherRef = Pick<WlTeacher, "id" | "name" | "department_id" | "active">;
// เรียงชื่อแบบพจนานุกรมไทย (ไม่สนสระหน้า เ แ โ) — ตัวเลือกยาวร้อยกว่าคน คนอ่านหาตามที่คุ้น · เป็นแค่ลำดับบนจอ ไม่ต้องตรงกับเซิร์ฟเวอร์
const thaiOrder = new Intl.Collator("th").compare;

export type TeacherChoice = { id: number; name: string; own: boolean };

/** ตัวเลือกครูของแถว/ตัวเลือก: เฉพาะครูที่ยังปฏิบัติงาน (สเปก: ครูทุกคนที่ยังปฏิบัติงาน) · กลุ่มตัวเองก่อน แล้วตามชื่อ
 *  · ชื่อซ้ำเป็นคนละตัวเลือก (อ้างด้วย id เสมอ) · ครูที่ไม่ปฏิบัติงานแล้วแต่อยู่ในแถว หน้าแสดงชื่อในแถวนั้นเอง ไม่อยู่ในตัวเลือกใหม่ */
export function teacherChoices(teachers: readonly TeacherRef[], deptId: number | null): TeacherChoice[] {
  return teachers
    .filter((t) => t.active)
    .map((t) => ({ id: t.id, name: t.name, own: deptId !== null && t.department_id === deptId }))
    .sort((a, b) => Number(b.own) - Number(a.own) || thaiOrder(a.name, b.name) || a.id - b.id);
}

/** ชื่อครูจากทะเบียน (รวมคนที่ไม่ปฏิบัติงานแล้ว — แถวเก่ายังต้องเห็นชื่อ) · รหัสที่ไม่รู้จัก = "ครูรหัส N" ไม่ใช่ช่องว่าง */
export function teacherNamer(teachers: readonly Pick<WlTeacher, "id" | "name">[]): (id: number) => string {
  const names = new Map(teachers.map((t) => [t.id, t.name]));
  return (id) => names.get(id) ?? `ครูรหัส ${id}`;
}

// ---- ส่งเฉพาะช่องที่เปลี่ยน ----
// PUT ที่มีช่อง teacher_id = ยืนยันอัตโนมัติแม้เป็นครูคนเดิม (เซิร์ฟเวอร์ถือว่าคนเลือกครูเอง) ถ้าหน้าส่งทั้งแถว แถวที่ครูมาจาก
// เทอมก่อนจะกลายเป็น "ยืนยันแล้ว" ตอนแก้แค่หมายเหตุ — ข้อห้ามเหนือทุกอย่าง ("ยังไม่ยืนยัน" หายได้เพราะคนกดเท่านั้น)

const ROW_KEYS = ["teacher_id", "co_teacher_id", "lab_room_id", "is_double", "note", "confirmed"] as const;
const OPTION_TEACHER_KEYS = ["room_id", "note", "confirmed"] as const;

function changed<T, K extends keyof T>(before: T, after: Partial<T>, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) {
    if (!(k in after)) continue;
    let v = after[k] as T[K];
    // เซิร์ฟเวอร์ตัดช่องว่างหัวท้ายของหมายเหตุ — พิมพ์ช่องว่างเพิ่มอย่างเดียวไม่ใช่การแก้
    if (k === "note" && typeof v === "string") v = v.trim() as T[K];
    if (v !== before[k]) out[k] = v;
  }
  return out;
}

/** ช่องของแถวที่หัวหน้าแก้ได้และค่าเปลี่ยนจริง (WL_ROW_FIELDS) — ไม่มีคีย์ของช่องที่ค่าเท่าเดิม และไม่มีช่องวิชา/ห้อง/คาบ */
export function rowPatch(
  before: Pick<RoundRow, (typeof ROW_KEYS)[number]>,
  after: Partial<RoundRow>,
): Partial<Pick<RoundRow, (typeof ROW_KEYS)[number]>> {
  return changed(before, after, ROW_KEYS);
}

/** ห้อง/หมายเหตุ/ยืนยัน ของครูในตัวเลือกที่เปลี่ยนจริง — ไม่ส่ง teacher_id (เปลี่ยนครู = เอาออกแล้วเพิ่มใหม่) */
export function optionTeacherPatch(
  before: Pick<OptionTeacher, (typeof OPTION_TEACHER_KEYS)[number]>,
  after: Partial<OptionTeacher>,
): Partial<Pick<OptionTeacher, (typeof OPTION_TEACHER_KEYS)[number]>> {
  return changed(before, after, OPTION_TEACHER_KEYS);
}

// ---- ค่าที่เลือกค้างในแถว (ครูที่เป็นร่าง · คาบคู่ที่บันทึกไม่สำเร็จ) ----
// ครูผู้สอน: เลือกในช่องแล้วเป็น "ร่าง" ยังไม่บันทึก จนคนกดบันทึกครู (หรือ Enter) — <select> ยิง change ทุกครั้งที่กดลูกศรหรือ
// พิมพ์อักษรขณะโฟกัสอยู่ (Chrome/Edge บน Windows/Linux) และการบันทึกครูคือการยืนยันแถว (สเปก 4.1) ปุ่มลูกศรที่หลุดมาครั้งเดียว
// จึงยืนยันครูอีกคนแทนคนได้ (final-review C1 · ข้อห้ามข้อ 3) · คาบคู่บันทึกทันทีที่ติ๊ก (ไม่แตะการยืนยัน) ค้างไว้เฉพาะตอนไม่สำเร็จ
// จอคงค่าที่คนเลือกไว้ให้เห็นว่ายังไม่ได้บันทึก (Review Focus 2) แต่แต่ละช่องใช้ได้เฉพาะขณะที่แถวบนเซิร์ฟเวอร์ยังเป็นสถานะเดิม
// ของช่องนั้น: ครู ↔ ครูและธงยืนยันของแถว (ยืนยัน/ใส่ครูทีละหลายแถว · อีกแท็บ → ร่างหมดอายุ ไม่งั้นจอแสดงครูคนหนึ่งคู่กับ
// "ยืนยันแล้ว" ของอีกคน) · คาบคู่ ↔ คาบคู่ (บันทึกคาบคู่สำเร็จแล้วร่างครูของแถวเดียวกันต้องไม่หายเงียบ ๆ)
// ครูสอนร่วม ห้อง หมายเหตุ ไม่อยู่ในสถานะนี้ (แก้ครูสอนร่วมแล้วบันทึกครูที่เป็นร่างต่อได้)

export type AutoFields = Partial<Pick<RoundRow, "teacher_id" | "is_double">>;
type HeldState = Pick<RoundRow, "teacher_id" | "confirmed" | "is_double">;
/** values = ค่าที่เลือกค้าง · base = สถานะของแถวบนเซิร์ฟเวอร์ตอนที่เลือก */
export type PendingEdit = { values: AutoFields; base: HeldState };

const heldState = (row: HeldState): HeldState => ({ teacher_id: row.teacher_id, confirmed: row.confirmed, is_double: row.is_double });
const DEPENDS: Record<keyof AutoFields, readonly (keyof HeldState)[]> = {
  teacher_id: ["teacher_id", "confirmed"],
  is_double: ["is_double"],
};

/** ค่าที่ค้างหลังรู้แถวล่าสุดจากเซิร์ฟเวอร์ ทีละช่อง: ทุกช่องยังใช้ได้ → ตัวเดิม · บางช่องหมดอายุ → เหลือช่องที่ใช้ได้
 *  · หมดทุกช่อง → null (จอแสดงค่าจริงของเซิร์ฟเวอร์) */
export function settlePending(p: PendingEdit | null, row: HeldState): PendingEdit | null {
  if (!p) return null;
  const keys = Object.keys(p.values) as (keyof AutoFields)[];
  const live = keys.filter((k) => DEPENDS[k].every((f) => p.base[f] === row[f]));
  if (live.length === keys.length) return p;
  if (live.length === 0) return null;
  return { values: Object.fromEntries(live.map((k) => [k, p.values[k]])) as AutoFields, base: p.base };
}

/** เลือกค่าใหม่ในแถว: ต่อยอดช่องที่ค้างที่ยังใช้ได้ · base = สถานะปัจจุบันของแถว (ช่องที่ยังใช้ได้มีสถานะเท่าเดิมอยู่แล้ว) */
export function holdPending(p: PendingEdit | null, row: HeldState, values: AutoFields): PendingEdit {
  const live = settlePending(p, row);
  return { values: { ...(live?.values ?? {}), ...values }, base: heldState(row) };
}

/** บันทึกช่องเหล่านี้สำเร็จ → ปล่อยออกจากค่าที่ค้าง · ไม่เหลือช่องไหน = null */
export function releasePending(p: PendingEdit | null, keys: readonly (keyof AutoFields)[]): PendingEdit | null {
  if (!p) return null;
  const values = { ...p.values };
  for (const k of keys) delete values[k];
  return Object.keys(values).length ? { values, base: p.base } : null;
}

export type RowChange = { pending: PendingEdit | null; save: AutoFields | null };

/** ช่องครู/คาบคู่ของแถวเปลี่ยน (change ของ <select> หรือช่องติ๊ก) → ค่าที่ค้างใหม่ และสิ่งที่ต้องบันทึกตอนนี้
 *  ครู: เป็นร่างเสมอ ไม่บันทึก (save ไม่มี teacher_id ไม่ว่าค่าใด) · เลือกกลับมาที่ครูเดิมของแถว = ไม่มีร่าง (ยืนยันครูเดิมใช้ปุ่มยืนยัน)
 *  คาบคู่: บันทึกทันที และค้างไว้ระหว่างบันทึก (ไม่สำเร็จก็ยังเห็นค่าที่ติ๊ก) */
export function changeRow(p: PendingEdit | null, row: HeldState, values: AutoFields): RowChange {
  let pending = settlePending(p, row);
  if ("teacher_id" in values) {
    const teacher = values.teacher_id ?? null;
    pending = teacher === row.teacher_id
      ? releasePending(pending, ["teacher_id"])
      : holdPending(pending, row, { teacher_id: teacher });
  }
  if (!("is_double" in values)) return { pending, save: null };
  const save = { is_double: Boolean(values.is_double) };
  return { pending: holdPending(pending, row, save), save };
}

/** ครูที่เป็นร่างของแถว (ยังไม่บันทึก) — มี = แสดงปุ่มบันทึกครู/ยกเลิก · null = ไม่มีร่าง (หรือหมดอายุแล้ว) */
export function teacherDraft(row: HeldState, p: PendingEdit | null): { teacher_id: number | null } | null {
  const v = settlePending(p, row)?.values;
  return v && "teacher_id" in v ? { teacher_id: v.teacher_id ?? null } : null;
}

/** "ลองบันทึกอีกครั้ง" ของช่องที่บันทึกทันทีแล้วไม่สำเร็จ (คาบคู่) — ไม่รวมครูที่เป็นร่าง: ครูบันทึกด้วยปุ่มบันทึกครูเท่านั้น */
export function retryFields(row: HeldState, p: PendingEdit | null): AutoFields | null {
  const v = settlePending(p, row)?.values;
  return v && "is_double" in v ? { is_double: Boolean(v.is_double) } : null;
}

/** ค่าที่ช่องครู/คาบคู่ของแถวแสดง: ค่าที่ค้าง (ถ้ายังใช้ได้) ไม่งั้นค่าจากเซิร์ฟเวอร์ */
export function shownFields(row: HeldState, p: PendingEdit | null): { teacher_id: number | null; is_double: boolean } {
  const v = settlePending(p, row)?.values ?? {};
  return {
    teacher_id: "teacher_id" in v ? (v.teacher_id ?? null) : row.teacher_id,
    is_double: "is_double" in v ? Boolean(v.is_double) : row.is_double,
  };
}

/** "ยืนยันแถวที่เลือก": เฉพาะแถวที่เลือกซึ่งมีครูและยังไม่ยืนยัน — แถวที่ไม่มีครูยืนยันไปก็ยังส่งไม่ได้ (นับแยกไว้บอกให้ใส่ครูก่อน) */
export function bulkConfirmIds(
  rows: readonly Pick<RoundRow, "id" | "teacher_id" | "confirmed">[],
  selected: ReadonlySet<number>,
): { ids: number[]; noTeacher: number } {
  const picked = rows.filter((r) => selected.has(r.id));
  return {
    ids: picked.filter((r) => rowState(r) === "unconfirmed").map((r) => r.id),
    noTeacher: picked.filter((r) => r.teacher_id === null).length,
  };
}

/** "ยืนยันแถวที่เลือก" เมื่อบางแถวมีร่างครูที่ยังไม่บันทึก: ข้ามแถวเหล่านั้น — ยืนยันตอนนี้คือยืนยันครูบนเซิร์ฟเวอร์ (ครูเทอมก่อน)
 *  ไม่ใช่ครูที่จอแสดงเป็นร่าง แล้วร่างก็หายเงียบ ๆ (ตรวจซ้ำรอบแก้สุดท้าย) · ปุ่มยืนยันของแถวเดียวก็ซ่อนเมื่อมีร่างด้วยเหตุเดียวกัน
 *  skipped = แถวที่เลือกซึ่งมีร่าง ทุกสถานะ (แถวที่ยืนยันแล้วแต่กำลังเปลี่ยนครูก็มีร่างค้างที่ต้องกดบันทึกหรือยกเลิกเหมือนกัน)
 *  · แถวที่ไม่มีครูแต่มีร่าง นับเป็นข้าม (ให้กดบันทึกครู) ไม่ใช่ "ยังไม่มีครู" · ids ว่างแต่ skipped > 0 = ปุ่มปิดพร้อม reason เดียวกัน */
export function bulkConfirmTargets(
  rows: readonly Pick<RoundRow, "id" | "teacher_id" | "confirmed">[],
  selected: ReadonlySet<number>,
  drafts: ReadonlySet<number>,
): { ids: number[]; noTeacher: number; skipped: number; reason: string | null } {
  const skip = new Set(rows.filter((r) => selected.has(r.id) && drafts.has(r.id)).map((r) => r.id));
  const rest = bulkConfirmIds(rows.filter((r) => !skip.has(r.id)), selected);
  return {
    ...rest,
    skipped: skip.size,
    reason: skip.size ? `ข้าม ${skip.size} แถวที่เลือกครูไว้แต่ยังไม่กดบันทึกครู — กดบันทึกครูหรือยกเลิกก่อน` : null,
  };
}

/** บรรทัดเตือนในกล่องยืนยันการส่ง: ร่างครูที่ยังไม่บันทึกจะไม่ไปกับการส่ง (ไม่บล็อก — เซิร์ฟเวอร์ตัดสินความครบจากค่าที่บันทึกแล้ว) */
export function unsavedDraftsText(drafts: number): string | null {
  return drafts > 0 ? `มี ${drafts} แถวที่เลือกครูไว้แต่ยังไม่กดบันทึกครู — ถ้าส่งตอนนี้ ครูที่เลือกไว้จะไม่ถูกบันทึก` : null;
}

// ---- คาบรายครู (ด้านข้าง) ----

export type LoadBar = {
  teacherId: number;
  name: string;
  /** ตัวเลขของแถบ: own (หัวหน้า — ส่วนจากกลุ่มตัวเอง) หรือ total (admin) */
  value: number;
  total: number;
  /** ความยาวแถบ 0–100 เทียบกับค่ามากสุดในรายการ */
  pct: number;
  /** ยอดรวมทั้งรอบถึงค่ามากสุดของกลุ่ม — คนที่คาบหนักสุด หรือครูข้ามกลุ่มที่ยอดรวมเกินคนในกลุ่ม */
  warn: boolean;
  /** ยอดรวมทุกกลุ่มเมื่อมากกว่าตัวเลขของแถบ · ไม่มากกว่า = null */
  more: number | null;
};

/** แถบคาบรายครูจาก GET .../loads (เซิร์ฟเวอร์นับ หน้าไม่นับเอง) · เรียงมากไปน้อย แล้วตามชื่อ · keep = กรองครูที่แสดง (admin) */
export function loadBars(
  loads: readonly TeacherLoad[],
  by: "own" | "total",
  keep?: (load: TeacherLoad) => boolean,
): LoadBar[] {
  const list = keep ? loads.filter(keep) : [...loads];
  const max = list.reduce((m, l) => Math.max(m, l[by]), 0);
  return list
    .map((l) => ({
      teacherId: l.teacher_id,
      name: l.name,
      value: l[by],
      total: l.total,
      pct: max > 0 ? Math.round((l[by] * 100) / max) : 0,
      warn: max > 0 && l.total >= max,
      more: l.total > l[by] ? l.total : null,
    }))
    .sort((a, b) => b.value - a.value || thaiOrder(a.name, b.name) || a.teacherId - b.teacherId);
}

/** รอบที่หน้ากรอกของหัวหน้าแสดง: รอบที่เปิดให้กรอก · ไม่มี → รอบที่ปิดล่าสุด (อ่านอย่างเดียว) · ไม่มีเลย → null
 *  (รอบที่กำลังเตรียมหัวหน้าไม่เห็น — เซิร์ฟเวอร์ไม่ส่งมาอยู่แล้ว) */
export function headRound<R extends Pick<Round, "status" | "year" | "semester">>(rounds: readonly R[]): R | null {
  const open = rounds.find((r) => r.status === "filling");
  if (open) return open;
  const closed = rounds.filter((r) => r.status === "closed").sort((a, b) => b.year - a.year || b.semester - a.semester);
  return closed[0] ?? null;
}

// ---- โหลดสถานะใหม่เมื่อกลับมาที่หน้า ----

/** ช่วงห่างอย่างน้อยของการโหลดสถานะกลุ่มใหม่ตอนหน้าต่างกลับมา — สลับแท็บกลับมาได้ทั้ง visibilitychange และ focus พร้อมกัน */
export const REFRESH_GAP_MS = 2000;

/** หน้าต่างกลับมา (focus · visibilitychange): ควรโหลดสถานะใหม่ไหม · ไม่เคยโหลด = ควร · นาฬิกาถอยหลัง (ตั้งเวลาเครื่องใหม่) = ควร */
export function refreshDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now < lastAt || now - lastAt >= REFRESH_GAP_MS;
}
