// ตรรกะล้วนของรอบอัตรากำลัง — import ได้เฉพาะ import type (node รันตรง ๆ ใน tests/ts/wlround.ts)
// ป้ายสถานะของรอบและของกลุ่มอยู่ที่นี่ที่เดียว (แผน "สัญญาที่ทุก task ใช้ร่วมกัน") · ตัวเลขของกลุ่มนับเป็น "รายการ"
// = แถววิชา + ตัวเลือกคาบเสรี/กิจกรรมของกลุ่ม ตาม wl_fill_counts ของเซิร์ฟเวอร์ (ชื่อคีย์ rows แต่รวมตัวเลือกด้วย)
import type { Term, Unconverted } from "./curriculum";
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

/** ชิปรอบบนแถบบน: รอบที่ยังไม่ปิด · ไม่มี → null (ไม่แสดงชิป) */
export function roundChip(rounds: readonly Round[]): { tone: Tone; text: string } | null {
  const r = currentRound(rounds);
  return r ? { tone: roundStatusTone(r.status), text: `ภาคเรียน ${r.label} · ${ROUND_STATUS_TEXT[r.status]}` } : null;
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

export function isRound(d: unknown): d is Round {
  if (!isObj(d) || !isInt(d.id) || !isInt(d.year) || !isInt(d.semester) || !isText(d.label)) return false;
  if (!ROUND_STATUSES.includes(d.status as string) || !isText(d.opened_at) || !isTextOrNull(d.closed_at)) return false;
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
