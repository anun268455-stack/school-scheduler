// ตรรกะล้วนของหน้าหลักสูตร — import ได้เฉพาะ import type (node รันตรง ๆ ใน tests/ts/wlcurriculum.ts)
// ทุกอย่างอ้างหลักสูตร บรรทัด ห้อง และวิชาด้วย id · ชื่อใช้แสดงผลเท่านั้น (ชื่อหลักสูตร/วิชาซ้ำกันได้)
import type { Department } from "./types.ts";

// ---- รูปข้อมูลตามสัญญาของเซิร์ฟเวอร์ (route หลักสูตรของงานที่ 2) ----

export type LineKind = "basic" | "additional" | "activity";
export type SetKind = "elective" | "activity";

export type CurriculumLine = {
  id: number;
  curriculum_id: number;
  /** wl_subjects.id — null = รหัสที่ยังไม่มีในทะเบียนวิชา */
  subject_id: number | null;
  code: string;
  name: string;
  credits: number | null;
  weekly: number;
  kind: LineKind;
  department_id: number | null;
  sort: number;
};

export type Curriculum = {
  id: number;
  year: number;
  semester: number;
  name: string;
  level: string | null;
  note: string;
  group_ids: number[];
  /** ชื่อห้องคู่กับ group_ids ตามลำดับ (ห้องที่ไม่มีแล้วเป็น "ห้องที่ไม่มีแล้ว (รหัส N)") */
  group_names: string[];
  lines: CurriculumLine[];
};

export type TermSetOption = {
  id: number;
  set_id: number;
  subject_id: number | null;
  code: string;
  name: string;
  department_id: number | null;
};

export type TermSet = {
  id: number;
  year: number;
  semester: number;
  kind: SetKind;
  name: string;
  group_ids: number[];
  group_names: string[];
  weekly: number;
  is_double: boolean;
  options: TermSetOption[];
};

/** GET /curricula · locked = รอบของภาคเรียนนี้ปิดแล้ว หลักสูตรอ่านอย่างเดียวตลอดไป */
export type TermCurricula = { curricula: Curriculum[]; sets: TermSet[]; locked: boolean };
export type CurriculumTerm = { year: number; semester: number; label: string; locked: boolean };
/** action เป็นคีย์อังกฤษสำหรับโปรแกรม ห้ามขึ้นจอ — แสดงเฉพาะ detail (ไทย) */
export type LogEntry = { id: number; at: string; by: string; action: string; detail: string };
/** ห้องเรียน (GET /groups) หรือห้องของโปรแกรมจัดตาราง (GET /rooms) */
export type RefItem = { id: number; name: string };
export type Term = { year: number; semester: number };

export type ImportCountsLite = { created: number; linked: number; skipped: number };
export type Unconverted = { source: string; ref: unknown; reason: string };
export type SeedResult = {
  year: number;
  semester: number;
  label: string;
  source: "timetable" | "copy";
  counts: { curricula: number; lines: number; groups: number; sets: number; options: number };
  imported: { teachers: ImportCountsLite; subjects: ImportCountsLite } | null;
  /** รายการแปลงไม่ได้ — เซิร์ฟเวอร์คืนครั้งเดียวตอนตั้งต้น ไม่ได้เก็บไว้ หน้าต้องแสดงทันที */
  unconverted: Unconverted[];
};

// ---- ป้าย ----

export const KIND_TEXT: Record<LineKind, string> = {
  basic: "พื้นฐาน",
  additional: "เพิ่มเติม",
  activity: "กิจกรรมพัฒนาผู้เรียน",
};

export const SET_KIND_TEXT: Record<SetKind, string> = { elective: "ชุดคาบเสรี", activity: "ชุดกิจกรรม" };

const NO_DEPARTMENT = "ยังไม่ระบุกลุ่มสาระ";

// ทะเบียนที่ยังโหลดไม่ได้ (เน็ตสะดุด เซิร์ฟเวอร์ตื่นช้า) ต้องไม่ถูกอ่านเป็น "ไม่มีจริง" — ไม่งั้นจอบอกอย่างมั่นใจว่า
// "กลุ่มสาระที่ไม่มีแล้ว" / "ห้องที่ไม่มีแล้ว — เอาออกได้" / "ไม่มีในทะเบียนวิชา" ทั้งที่ของยังอยู่ แล้ว admin แก้ตามจอผิด ๆ
// loaded = ทะเบียนนั้นเคยโหลดสำเร็จ (useRegistryList.loaded)

/** none = บรรทัดไม่ได้ระบุ (รู้แน่จากหลักสูตรเอง) · raw = ยังโหลดชื่อไม่ได้ แสดงรหัสดิบ · gone = ทะเบียนมาแล้วแต่ไม่มีรหัสนี้ */
export function departmentShow(
  id: number | null,
  departments: readonly Department[],
  loaded: boolean,
): { kind: "name" | "none" | "gone" | "raw"; text: string } {
  if (id === null) return { kind: "none", text: NO_DEPARTMENT };
  if (!loaded) return { kind: "raw", text: `กลุ่มสาระรหัส ${id}` };
  const d = departments.find((x) => x.id === id);
  return d ? { kind: "name", text: d.name } : { kind: "gone", text: `กลุ่มสาระที่ไม่มีแล้ว (รหัส ${id})` };
}

export function departmentName(id: number | null, departments: readonly Department[], loaded = true): string {
  return departmentShow(id, departments, loaded).text;
}

/** ห้องที่เลือกไว้แต่ไม่มีในรายการห้องแล้ว — ตัดสินได้เฉพาะเมื่อรายการห้องโหลดแล้ว (ยังไม่มา = ไม่มีห้องไหน "หาย") */
export function missingRooms(value: readonly number[], groups: readonly RefItem[], loaded: boolean): number[] {
  if (!loaded) return [];
  const known = new Set(groups.map((g) => g.id));
  return value.filter((g) => !known.has(g));
}

export function formatNumber(n: number): string {
  return n.toLocaleString("th-TH");
}

// ---- ระดับชั้นและการเรียงห้อง ----

// กฎเดียวกับ wl_level_of ของเซิร์ฟเวอร์ — ระดับที่หน้าเดาต้องตรงกับที่เซิร์ฟเวอร์เดาตอนสร้างหลักสูตร
const LEVEL_RE = /^\s*ม\.?\s*(\d+)\s*\//;
// กฎเดียวกับ wl_class_key ของเซิร์ฟเวอร์ (ลำดับของ GET /groups) — ชั้น · เลขห้อง (แบบเลข) · ส่วนต่อท้าย (ห้องย่อย ก ข ค)
const CLASS_RE = /^\s*ม\.?\s*(\d+)\s*\/\s*(\d+)\s*(.*)$/;

export function levelOf(groupName: string | null | undefined): string | null {
  const m = LEVEL_RE.exec(String(groupName ?? ""));
  return m ? `ม.${Number(m[1])}` : null;
}

// เทียบด้วยรหัสตัวอักษรตรง ๆ ไม่ใช้ localeCompare ที่ผลต่างกันตามเครื่อง (และต้องตรงกับการเรียงของเซิร์ฟเวอร์)
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** เรียงชื่อห้องแบบคนอ่าน: ม.1/2 ก่อน ม.1/10 · ม.4/6 → ม.4/6ก → ม.4/7 · ชื่อที่ไม่ใช่รูป ม.N/… ไว้ท้าย */
export function classSort(a: string, b: string): number {
  const x = CLASS_RE.exec(a);
  const y = CLASS_RE.exec(b);
  if (x && y) {
    return Number(x[1]) - Number(y[1]) || Number(x[2]) - Number(y[2]) || cmp(x[3], y[3]);
  }
  if (x) return -1;
  if (y) return 1;
  return cmp(a, b);
}

function levelNumber(level: string): number | null {
  const m = /\d+/.exec(level);
  return m ? Number(m[0]) : null;
}

// ระดับที่มีเลขเรียงตามเลข · ระดับที่ไม่มีเลขตามหลัง · ไม่มีระดับ (null) ท้ายสุด
function levelOrder(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const x = levelNumber(a);
  const y = levelNumber(b);
  if (x !== null && y !== null) return x - y || cmp(a, b);
  if (x !== null) return -1;
  if (y !== null) return 1;
  return cmp(a, b);
}

const GRADE_PREFIX = /^ม\.?\s*/;
const CLASS_ONLY = /^(\d+)\s*\/\s*(\d+)$/;

/** ย่อชื่อห้องเป็นช่วง รูปเดียวกับ wl_room_range ของเซิร์ฟเวอร์ (ชื่อหลักสูตรที่ตั้งต้นให้):
 *  "ม.1/1-6" · "ม.1/1-3,5" · "ม.1/1 ม.2/1" · ห้องย่อย ("ม.4/6ก") เขียนตามเดิมต่อท้าย — ห้องห้ามหายจากข้อความเงียบ ๆ */
export function roomRange(names: readonly (string | null | undefined)[]): string {
  const byLevel = new Map<number, Set<number>>();
  const prefix = new Map<number, string>();
  const raw: string[] = [];
  for (const label of names) {
    const full = String(label ?? "").trim();
    const bare = full.replace(GRADE_PREFIX, "");
    if (!bare) continue;
    const m = CLASS_ONLY.exec(bare);
    if (!m) {
      if (!raw.includes(full)) raw.push(full);
      continue;
    }
    const level = Number(m[1]);
    let nums = byLevel.get(level);
    if (!nums) byLevel.set(level, (nums = new Set<number>()));
    nums.add(Number(m[2]));
    if (!prefix.has(level)) prefix.set(level, bare !== full ? "ม." : "");
  }
  const parts: string[] = [];
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const nums = [...byLevel.get(level)!].sort((a, b) => a - b);
    const runs: string[] = [];
    for (let i = 0; i < nums.length; ) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      runs.push(i === j ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
      i = j + 1;
    }
    parts.push(`${prefix.get(level)}${level}/${runs.join(",")}`);
  }
  return [...parts, ...raw].join(" ") || "(ยังไม่มีห้อง)";
}

/** ช่องติ๊กห้องของฟอร์มหลักสูตร/ชุด จัดตามระดับ (ม.1 → ม.6 · ชื่อที่เดาระดับไม่ได้เป็นกลุ่มท้าย) ไม่แก้ลิสต์เดิม */
export function roomsByLevel(groups: readonly RefItem[]): { level: string | null; groups: RefItem[] }[] {
  const by = new Map<string | null, RefItem[]>();
  for (const g of [...groups].sort((a, b) => classSort(a.name, b.name) || a.id - b.id)) {
    const level = levelOf(g.name);
    let list = by.get(level);
    if (!list) by.set(level, (list = []));
    list.push(g);
  }
  return [...by.keys()].sort(levelOrder).map((level) => ({ level, groups: by.get(level)! }));
}

// ---- สรุปและจัดกลุ่มหลักสูตร ----

// หน่วยกิตเป็นทศนิยม (0.5 1.5) ผลบวกทศนิยมของเครื่องได้ 0.30000000000000004 — ปัดที่สองตำแหน่ง
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function curriculumSummary(c: Curriculum): { lines: number; weekly: number; credits: number; groups: string } {
  let weekly = 0;
  let credits = 0;
  for (const ln of c.lines) {
    weekly += ln.weekly;
    credits += ln.credits ?? 0;
  }
  return { lines: c.lines.length, weekly, credits: round2(credits), groups: roomRange(c.group_names) };
}

/** ระดับที่ใช้จัดกลุ่ม: ที่ admin ตั้ง · ไม่ได้ตั้ง = ระดับของห้องเมื่อทุกห้องอยู่ระดับเดียวกัน (กฎเดียวกับตอนเซิร์ฟเวอร์สร้าง) */
export function curriculumLevel(c: Curriculum): string | null {
  const own = (c.level ?? "").trim();
  if (own) return own;
  const levels = new Set(c.group_names.map(levelOf));
  if (levels.size !== 1) return null;
  return [...levels][0];
}

function firstRoomOrder(a: Curriculum, b: Curriculum): number {
  const x = [...a.group_names].sort(classSort)[0];
  const y = [...b.group_names].sort(classSort)[0];
  if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
  return classSort(x, y);
}

/** จัดตามระดับชั้น ม.1 → ม.6 · ในระดับเรียงตามห้องแรก (หลักสูตรที่ยังไม่มีห้องไว้ท้ายของระดับ) · ไม่มีระดับไว้ท้าย */
export function groupCurricula(list: readonly Curriculum[]): { level: string | null; curricula: Curriculum[] }[] {
  const by = new Map<string | null, Curriculum[]>();
  for (const c of list) {
    const level = curriculumLevel(c);
    let group = by.get(level);
    if (!group) by.set(level, (group = []));
    group.push(c);
  }
  return [...by.keys()].sort(levelOrder).map((level) => ({
    level,
    curricula: [...by.get(level)!].sort((a, b) => firstRoomOrder(a, b) || cmp(a.name, b.name) || a.id - b.id),
  }));
}

// ---- ฟอร์ม ----
// ตรวจไว้ก่อนส่งเพื่อให้ผู้ใช้เห็นข้อความทันที · เซิร์ฟเวอร์ตรวจซ้ำเสมอ (คาบ 0–99 · หน่วยกิต 0–99)

export type Built<T> = { ok: true; body: T } | { ok: false; error: string };

const MAX = 99;
const CODE_REQUIRED = "กรุณากรอกรหัสวิชา";
const WEEKLY_ERROR = `คาบ/สัปดาห์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${MAX}`;
const CREDITS_ERROR = `หน่วยกิตต้องเป็นตัวเลขตั้งแต่ 0 ถึง ${MAX} (ทศนิยมได้ เช่น 1.5) หรือเว้นว่าง`;

function parseWeekly(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX ? n : null;
}

// ว่าง = null (ไม่ระบุหน่วยกิต เช่นกิจกรรม) · undefined = ผิดรูป
function parseCredits(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return undefined;
  const n = Number(t);
  return n <= MAX ? n : undefined;
}

export type LineForm = {
  code: string;
  name: string;
  /** ข้อความในช่องหน่วยกิต (ว่างได้) */
  credits: string;
  /** ข้อความในช่องคาบ/สัปดาห์ */
  weekly: string;
  /** "" = ให้เซิร์ฟเวอร์เดาจากรหัสวิชา */
  kind: LineKind | "";
  department_id: number | null;
};

/** body ของบรรทัด · ไม่มี name = ให้เซิร์ฟเวอร์เติมจากทะเบียนวิชา · ไม่มี kind = ให้เซิร์ฟเวอร์เดาจากรหัส */
export type LineBody = {
  code: string;
  name?: string;
  credits: number | null;
  weekly: number;
  kind?: LineKind;
  department_id: number | null;
};

export function buildLineBody(form: LineForm): Built<LineBody> {
  const code = form.code.trim();
  if (code === "") return { ok: false, error: CODE_REQUIRED };
  const weekly = parseWeekly(form.weekly);
  if (weekly === null) return { ok: false, error: WEEKLY_ERROR };
  const credits = parseCredits(form.credits);
  if (credits === undefined) return { ok: false, error: CREDITS_ERROR };
  const name = form.name.trim();
  return {
    ok: true,
    body: {
      code,
      ...(name !== "" ? { name } : {}),
      credits,
      weekly,
      ...(form.kind !== "" ? { kind: form.kind } : {}),
      department_id: form.department_id,
    },
  };
}

export type CurriculumForm = { name: string; level: string; note: string; group_ids: number[] };
export type CurriculumBody = { name: string; level: string | null; note: string; group_ids: number[] };

export function buildCurriculumBody(form: CurriculumForm): Built<CurriculumBody> {
  const name = form.name.trim();
  if (name === "") return { ok: false, error: "กรุณาตั้งชื่อหลักสูตร เช่น ม.4 วิทย์-คณิต" };
  const level = form.level.trim();
  return { ok: true, body: { name, level: level === "" ? null : level, note: form.note.trim(), group_ids: [...form.group_ids] } };
}

const sameSet = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));

/** การแก้หลักสูตรส่งเฉพาะช่องที่เปลี่ยน — ห้องเทียบเป็นเซต (ลำดับการติ๊กไม่ใช่การเปลี่ยน) */
export function curriculumChanges(before: Curriculum, body: CurriculumBody): Partial<CurriculumBody> {
  const out: Partial<CurriculumBody> = {};
  if (body.name !== before.name) out.name = body.name;
  if (body.level !== (before.level ?? null)) out.level = body.level;
  if (body.note !== (before.note ?? "")) out.note = body.note;
  if (!sameSet(body.group_ids, before.group_ids)) out.group_ids = [...body.group_ids];
  return out;
}

export type SetForm = { kind: SetKind; name: string; weekly: string; is_double: boolean; group_ids: number[] };
export type SetBody = { kind: SetKind; name: string; weekly: number; is_double: boolean; group_ids: number[] };

export function buildSetBody(form: SetForm): Built<SetBody> {
  const name = form.name.trim();
  if (name === "") return { ok: false, error: "กรุณาตั้งชื่อชุด เช่น วิชาเสรี ม.4" };
  const weekly = parseWeekly(form.weekly);
  if (weekly === null) return { ok: false, error: WEEKLY_ERROR };
  return { ok: true, body: { kind: form.kind, name, weekly, is_double: form.is_double, group_ids: [...form.group_ids] } };
}

/** การแก้บรรทัดส่งเฉพาะช่องที่เปลี่ยน — ชื่อที่ไม่ได้ส่ง (เว้นว่าง) และประเภทที่ไม่ได้เลือกไม่นับเป็นการเปลี่ยน
 *  · เปลี่ยนรหัสแล้วส่งชื่อไปด้วยเสมอ: รหัสใหม่ที่ไม่มีในทะเบียน เซิร์ฟเวอร์ต้องได้ชื่อ (ไม่งั้น 400) แม้ชื่อเท่าเดิม */
export function lineChanges(before: CurriculumLine, body: LineBody): Partial<LineBody> {
  const out: Partial<LineBody> = {};
  if (body.code !== before.code.trim()) out.code = body.code;
  if (body.name !== undefined && (body.name !== before.name || out.code !== undefined)) out.name = body.name;
  if (body.credits !== before.credits) out.credits = body.credits;
  if (body.weekly !== before.weekly) out.weekly = body.weekly;
  if (body.kind !== undefined && body.kind !== before.kind) out.kind = body.kind;
  if (body.department_id !== before.department_id) out.department_id = body.department_id;
  return out;
}

/** การแก้ชุดส่งเฉพาะช่องที่เปลี่ยน — ห้องเทียบเป็นเซต */
export function setChanges(before: TermSet, body: SetBody): Partial<SetBody> {
  const out: Partial<SetBody> = {};
  if (body.kind !== before.kind) out.kind = body.kind;
  if (body.name !== before.name) out.name = body.name;
  if (body.weekly !== before.weekly) out.weekly = body.weekly;
  if (body.is_double !== before.is_double) out.is_double = body.is_double;
  if (!sameSet(body.group_ids, before.group_ids)) out.group_ids = [...body.group_ids];
  return out;
}

export type OptionForm = { code: string; name: string; department_id: number | null };
export type OptionBody = { code: string; name?: string; department_id: number | null };

export function buildOptionBody(form: OptionForm): Built<OptionBody> {
  const code = form.code.trim();
  if (code === "") return { ok: false, error: CODE_REQUIRED };
  const name = form.name.trim();
  return { ok: true, body: { code, ...(name !== "" ? { name } : {}), department_id: form.department_id } };
}

/** กฎเดียวกับ lineChanges (เปลี่ยนรหัสแล้วส่งชื่อไปด้วย) */
export function optionChanges(before: TermSetOption, body: OptionBody): Partial<OptionBody> {
  const out: Partial<OptionBody> = {};
  if (body.code !== before.code.trim()) out.code = body.code;
  if (body.name !== undefined && (body.name !== before.name || out.code !== undefined)) out.name = body.name;
  if (body.department_id !== before.department_id) out.department_id = body.department_id;
  return out;
}

// ---- รหัสวิชา → ชื่อและกลุ่มสาระจากทะเบียน ----

type RegistrySubject = { id: number; code: string; name: string; department_id: number | null };

/** วิชาในทะเบียนที่รหัสตรงกัน (ตัดช่องว่างหัวท้าย เทียบตรงตัว · กฎเดียวกับ _wl_bind_code) — ซ้ำได้หลายวิชา */
export function subjectsWithCode<S extends RegistrySubject>(code: string, subjects: readonly S[]): S[] {
  const key = code.trim();
  if (key === "") return [];
  return subjects.filter((s) => String(s.code ?? "").trim() === key);
}

export type CodeMatch =
  | { kind: "blank" }
  | { kind: "unloaded" }
  | { kind: "none" }
  | { kind: "one"; name: string }
  | { kind: "many"; count: number };

/** รหัสที่พิมพ์ตรงกับทะเบียนวิชาไหม — ทะเบียนยังโหลดไม่ได้ = unloaded (บอกไม่ได้) ไม่ใช่ "ไม่มีในทะเบียน" */
export function codeMatch(code: string, subjects: readonly RegistrySubject[], loaded: boolean): CodeMatch {
  if (code.trim() === "") return { kind: "blank" };
  if (!loaded) return { kind: "unloaded" };
  const hits = subjectsWithCode(code, subjects);
  if (hits.length === 1) return { kind: "one", name: hits[0].name };
  return hits.length === 0 ? { kind: "none" } : { kind: "many", count: hits.length };
}

/** เปลี่ยนรหัสในฟอร์ม: รหัสที่มีในทะเบียนวิชาเดียว → เติมชื่อและกลุ่มสาระ · รหัสใหม่ที่ไม่มีในทะเบียน → ล้างชื่อที่เคยเติมให้
 *  (ชื่อเดิมเป็นของรหัสเก่า ปล่อยไว้จะได้รหัสกับชื่อคนละวิชา) · ชื่อที่ผู้ใช้พิมพ์เองไม่ถูกทับ · รหัสกำกวมไม่เดา */
export function applyCode<F extends { code: string; name: string; department_id: number | null }>(
  form: F,
  code: string,
  subjects: readonly RegistrySubject[],
): F {
  const hits = subjectsWithCode(code, subjects);
  if (hits.length === 1) return { ...form, code, name: hits[0].name, department_id: hits[0].department_id };
  const prev = subjectsWithCode(form.code, subjects);
  const auto = prev.length === 1 && form.name === prev[0].name;
  if (auto && hits.length === 0) {
    return { ...form, code, name: "", department_id: form.department_id === prev[0].department_id ? null : form.department_id };
  }
  return { ...form, code };
}

// ---- ห้องที่อยู่หลักสูตรอื่นแล้ว ----

/** ห้อง → ชื่อหลักสูตรที่ห้องนั้นอยู่ (ห้องหนึ่งอยู่ได้หลักสูตรเดียวต่อภาคเรียน) · ไม่นับหลักสูตรที่กำลังแก้ */
export function takenRooms(curricula: readonly Curriculum[], exceptId: number | null): Map<number, string> {
  const out = new Map<number, string>();
  for (const c of curricula) {
    if (c.id === exceptId) continue;
    for (const g of c.group_ids) out.set(g, c.name);
  }
  return out;
}

// ---- ค้นหาวิชาข้ามทุกหลักสูตร ("วิชานี้อยู่หลักสูตรไหนบ้าง") ----

export type SubjectPlace = { kind: "curriculum" | "set"; id: number; name: string; rooms: string; weekly: number };
export type SubjectHit = { key: string; code: string; name: string; places: SubjectPlace[] };

export function searchSubjects(curricula: readonly Curriculum[], sets: readonly TermSet[], query: string): SubjectHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const hits = new Map<string, SubjectHit>();
  const add = (code: string, name: string, place: SubjectPlace) => {
    if (!code.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) return;
    const key = `${code.trim()}\u0000${name}`;
    let hit = hits.get(key);
    if (!hit) hits.set(key, (hit = { key, code: code.trim(), name, places: [] }));
    hit.places.push(place);
  };
  const ordered = [...curricula].sort((a, b) => firstRoomOrder(a, b) || cmp(a.name, b.name) || a.id - b.id);
  for (const c of ordered) {
    const rooms = roomRange(c.group_names);
    for (const ln of c.lines) add(ln.code, ln.name, { kind: "curriculum", id: c.id, name: c.name, rooms, weekly: ln.weekly });
  }
  for (const s of sets) {
    const rooms = roomRange(s.group_names);
    for (const o of s.options) add(o.code, o.name, { kind: "set", id: s.id, name: s.name, rooms, weekly: s.weekly });
  }
  return [...hits.values()].sort((a, b) => cmp(a.code, b.code) || cmp(a.name, b.name));
}

// ---- บันทึกการแก้ ----

const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
// เวลาไทยตายตัว (ไม่มีเวลาออมแสง) — ทุกเครื่องเห็นเวลาเดียวกัน แม้โทรศัพท์บางเครื่องตั้งเขตเวลาผิด และตัวทดสอบไม่ขึ้นกับเครื่อง
const BANGKOK_MS = 7 * 3600 * 1000;
// เซิร์ฟเวอร์ส่ง isoformat ของ Postgres ซึ่งมีเศษวินาทีหกหลัก — Date.parse ของบางเบราว์เซอร์ไม่รับ จึงแยกเอง
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function utcMillis(iso: string): number | null {
  const m = ISO_RE.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, tz] = m;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (tz && tz.toUpperCase() !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    const offset = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0);
    ms -= sign * offset * 60 * 1000;
  }
  return Number.isFinite(ms) ? ms : null;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "16 พ.ย. 2569 14:05" (เวลาไทย พ.ศ. 24 ชม.) · ค่าที่อ่านไม่ออก → null */
export function thaiDateTime(iso: string): string | null {
  const ms = utcMillis(iso);
  if (ms === null) return null;
  const t = new Date(ms + BANGKOK_MS);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear() + 543} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

export function logParts(entry: LogEntry): { when: string; by: string; detail: string } {
  return { when: thaiDateTime(entry.at) ?? entry.at, by: entry.by.trim() || "(ไม่ทราบผู้แก้)", detail: entry.detail };
}

/** "16 พ.ย. 2569 14:05 · ผู้ดูแลระบบ · เพิ่ม …" — ไม่ใช้ action (คีย์อังกฤษสำหรับโปรแกรม) */
export function logLine(entry: LogEntry): string {
  const p = logParts(entry);
  return `${p.when} · ${p.by} · ${p.detail}`;
}

// ---- ภาคเรียน ----

export function termLabel(year: number, semester: number): string {
  return `${semester}/${year}`;
}

export function nextTerm(t: Term): Term {
  return t.semester === 1 ? { year: t.year, semester: 2 } : { year: t.year + 1, semester: 1 };
}

/** ภาคเรียนที่น่าจะเป็นตอนนี้ (ค่าตั้งต้นของตัวเลือก admin เปลี่ยนได้): ภาค 1 = พ.ค.–ต.ค. · ภาค 2 = พ.ย.–เม.ย. ของปีการศึกษาเดิม */
export function guessTerm(now: Date): Term {
  const t = new Date(now.getTime() + BANGKOK_MS);
  const month = t.getUTCMonth() + 1;
  const be = t.getUTCFullYear() + 543;
  if (month >= 5 && month <= 10) return { year: be, semester: 1 };
  return month >= 11 ? { year: be, semester: 2 } : { year: be - 1, semester: 2 };
}

/** ตรวจภาคเรียนที่พิมพ์ (กฎเดียวกับ _wl_term_args ของเซิร์ฟเวอร์: พ.ศ. 2500–2700 · ภาค 1 หรือ 2) */
export function parseTerm(year: string, semester: string): { ok: true; term: Term } | { ok: false; error: string } {
  const y = year.trim();
  const s = semester.trim();
  if (!/^\d{4}$/.test(y) || Number(y) < 2500 || Number(y) > 2700) {
    return { ok: false, error: "ปีการศึกษาต้องเป็นปี พ.ศ. 4 หลัก ระหว่าง 2500–2700 เช่น 2569" };
  }
  if (s !== "1" && s !== "2") return { ok: false, error: "ภาคเรียนต้องเป็น 1 หรือ 2" };
  return { ok: true, term: { year: Number(y), semester: Number(s) } };
}

export type TermChoice = CurriculumTerm & { empty: boolean };

/** ตัวเลือกภาคเรียน: ที่มีหลักสูตรแล้ว + ที่เสนอเพิ่ม (ยังว่าง) · ใหม่ก่อน · ไม่ซ้ำ */
export function termChoices(terms: readonly CurriculumTerm[], extra: readonly Term[]): TermChoice[] {
  const out = new Map<string, TermChoice>();
  for (const t of terms) out.set(`${t.year}-${t.semester}`, { ...t, empty: false });
  for (const t of extra) {
    const key = `${t.year}-${t.semester}`;
    if (!out.has(key)) out.set(key, { year: t.year, semester: t.semester, label: termLabel(t.year, t.semester), locked: false, empty: true });
  }
  return [...out.values()].sort((a, b) => b.year - a.year || b.semester - a.semester);
}

// ---- ข้อความจากเซิร์ฟเวอร์ ----

// 409 ของการแก้ที่จะลบงานที่คนใส่ไว้ในรอบที่ยังไม่ปิด จบด้วย "ให้ยืนยันซ้ำ (force)" (_wl_sync_round)
// 409 อื่น (ภาคเรียนปิดแล้ว ชื่อซ้ำ ห้องซ้ำ) ส่งซ้ำพร้อม force ก็ไม่ผ่าน จึงต้องแยกออก ไม่ถามยืนยันให้เสียเวลา
const FORCE_MARK = "(force)";

/** ข้อความที่จะแสดงในกล่องยืนยันลบซ้ำ หรือ null เมื่อไม่ใช่ 409 แบบนั้น — ตัดคำว่า (force) ที่เป็นภาษาของโปรแกรมออก */
export function forceConflict(status: number, detail: unknown): string | null {
  if (status !== 409 || typeof detail !== "string" || !/[฀-๿]/.test(detail)) return null;
  if (!detail.includes(FORCE_MARK)) return null;
  return detail.replace(FORCE_MARK, "").trim();
}

const isCount = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n >= 0;
const isImport = (x: unknown): boolean => {
  const o = x as Record<string, unknown> | null;
  return typeof o === "object" && o !== null && isCount(o.created) && isCount(o.linked) && isCount(o.skipped);
};

/** กล่องสรุปหลังตั้งต้นที่เก็บไว้ใน sessionStorage (รายการแปลงไม่ได้มาครั้งเดียว ต้องรอด reload)
 *  ของที่เก็บอาจถูกแก้มือหรือมาจากรุ่นเก่า — รูปผิดตรงไหนก็ถือว่าไม่มี ไม่ให้หน้าล้ม */
export function parseSeedResult(raw: string | null): SeedResult | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, any>;
  const c = o.counts;
  if (!Number.isInteger(o.year) || !Number.isInteger(o.semester) || typeof o.label !== "string") return null;
  if (o.source !== "timetable" && o.source !== "copy") return null;
  if (typeof c !== "object" || c === null || ![c.curricula, c.lines, c.groups, c.sets, c.options].every(isCount)) return null;
  if (o.imported !== null && !(typeof o.imported === "object" && isImport(o.imported.teachers) && isImport(o.imported.subjects))) {
    return null;
  }
  if (!Array.isArray(o.unconverted) || !o.unconverted.every((u: any) => typeof u === "object" && u !== null && typeof u.reason === "string")) {
    return null;
  }
  return o as SeedResult;
}

/** บรรทัดของกล่องสรุปหลังตั้งต้นหลักสูตร */
export function seedSummary(r: SeedResult): string[] {
  const c = r.counts;
  const lines = [
    `${formatNumber(c.curricula)} หลักสูตร · ห้องเรียน ${formatNumber(c.groups)} ห้อง · ${formatNumber(c.lines)} บรรทัดวิชา`,
    `ชุดคาบเสรี/กิจกรรม ${formatNumber(c.sets)} ชุด (${formatNumber(c.options)} ตัวเลือก)`,
  ];
  const t = r.imported?.teachers.created ?? 0;
  const s = r.imported?.subjects.created ?? 0;
  if (t > 0 || s > 0) {
    const bits = [];
    if (t > 0) bits.push(`ครูใหม่ ${formatNumber(t)} คน`);
    if (s > 0) bits.push(`วิชาใหม่ ${formatNumber(s)} วิชา`);
    lines.push(`ดึงเข้าทะเบียนด้วย: ${bits.join(" · ")}`);
  }
  return lines;
}
