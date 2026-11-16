import type { AxiosError } from "axios";
import { ContractError, http } from "./api";
import {
  forceConflict, KIND_TEXT, parseSeedResult, SET_KIND_TEXT,
  type Curriculum, type CurriculumBody, type CurriculumLine, type CurriculumTerm, type LineBody, type LogEntry,
  type OptionBody, type RefItem, type SeedResult, type SetBody, type TermCurricula, type TermSet, type TermSetOption,
} from "./curriculum";

// ตัวเรียก route หลักสูตรของงานที่ 2 (ฟังก์ชันละ route) + รายการห้องของงานที่ 6 · ใช้ axios ตัวเดียวกับ api.ts
// คำตอบที่ผิดรูปจากสัญญา → ContractError (apiErrorText แปลงเป็นข้อความไทย) ไม่แปลงเป็นค่าที่ดูปกติ
// ตัวเลขผิดรูปที่กลายเป็น 0 จะอ่านออกมาเป็น "หลักสูตรนี้ไม่มีคาบ" ซึ่งซ่อนความผิดพลาด

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const isCount = (n: unknown): n is number => isInt(n) && n >= 0;
const isText = (s: unknown): s is string => typeof s === "string";
const isIdOrNull = (n: unknown): boolean => n === null || isInt(n);
const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

function fail(what: string): never {
  throw new ContractError(what);
}

function checkGroups(d: Record<string, any>, what: string): void {
  if (!Array.isArray(d.group_ids) || !d.group_ids.every(isInt)) fail(`${what}: group_ids`);
  if (!Array.isArray(d.group_names) || d.group_names.length !== d.group_ids.length || !d.group_names.every(isText)) {
    fail(`${what}: group_names`);
  }
}

function checkLine(d: unknown): CurriculumLine {
  if (!isObject(d) || !isInt(d.id) || !isInt(d.curriculum_id) || !isIdOrNull(d.subject_id)) fail("line ids");
  if (!isText(d.code) || !isText(d.name) || !isCount(d.weekly) || !isIdOrNull(d.department_id)) fail("line fields");
  if (!(d.credits === null || (typeof d.credits === "number" && Number.isFinite(d.credits)))) fail("line credits");
  if (!(d.kind in KIND_TEXT)) fail("line kind");
  return d as CurriculumLine;
}

function checkCurriculum(d: unknown): Curriculum {
  if (!isObject(d) || !isInt(d.id) || !isInt(d.year) || !isInt(d.semester) || !isText(d.name)) fail("curriculum");
  if (!(d.level === null || isText(d.level)) || !isText(d.note)) fail("curriculum level/note");
  checkGroups(d, "curriculum");
  if (!Array.isArray(d.lines)) fail("curriculum lines");
  d.lines.forEach(checkLine);
  return d as Curriculum;
}

function checkOption(d: unknown): TermSetOption {
  if (!isObject(d) || !isInt(d.id) || !isInt(d.set_id) || !isIdOrNull(d.subject_id)) fail("option ids");
  if (!isText(d.code) || !isText(d.name) || !isIdOrNull(d.department_id)) fail("option fields");
  return d as TermSetOption;
}

function checkSet(d: unknown): TermSet {
  if (!isObject(d) || !isInt(d.id) || !isText(d.name) || !(d.kind in SET_KIND_TEXT)) fail("set");
  if (!isCount(d.weekly) || typeof d.is_double !== "boolean") fail("set weekly");
  checkGroups(d, "set");
  if (!Array.isArray(d.options)) fail("set options");
  d.options.forEach(checkOption);
  return d as TermSet;
}

function checkRefs(d: unknown): RefItem[] {
  if (!Array.isArray(d) || !d.every((x) => isObject(x) && isInt(x.id) && isText(x.name))) fail("refs");
  return d as RefItem[];
}

// DELETE ที่มี body ส่งไม่ได้ในบาง client — ยืนยันซ้ำส่งเป็น ?force=1 ทุกที่ (เซิร์ฟเวอร์รับทั้งสองแบบ)
const forceParams = (force: boolean) => (force ? { params: { force: 1 } } : undefined);

// ---- อ่าน (ทุก session) ----

/** GET /curricula/terms — ภาคเรียนที่มีหลักสูตร ใหม่ก่อน */
export async function listTerms(): Promise<CurriculumTerm[]> {
  const res = await http.get("/workload/curricula/terms");
  const d = res.data;
  if (!Array.isArray(d) || !d.every((t) => isObject(t) && isInt(t.year) && isInt(t.semester) && isText(t.label)
    && typeof t.locked === "boolean")) fail("terms");
  return d as CurriculumTerm[];
}

/** GET /curricula?year=&semester= — หลักสูตรและชุดของภาคเรียน (ภาคเรียนที่ยังไม่มี = รายการว่าง ไม่ใช่ 404) */
export async function getCurricula(year: number, semester: number): Promise<TermCurricula> {
  const res = await http.get("/workload/curricula", { params: { year, semester } });
  const d = res.data;
  if (!isObject(d) || !Array.isArray(d.curricula) || !Array.isArray(d.sets) || typeof d.locked !== "boolean") {
    fail("curricula view");
  }
  d.curricula.forEach(checkCurriculum);
  d.sets.forEach(checkSet);
  return d as TermCurricula;
}

/** GET /curricula/log?year=&semester= — บันทึกการแก้ ใหม่ก่อน (ไม่เกิน 500 รายการ) */
export async function getCurriculumLog(year: number, semester: number): Promise<LogEntry[]> {
  const res = await http.get("/workload/curricula/log", { params: { year, semester } });
  const d = res.data;
  if (!Array.isArray(d) || !d.every((e) => isObject(e) && isInt(e.id) && isText(e.at) && isText(e.by)
    && isText(e.detail))) fail("log");
  return d as LogEntry[];
}

/** GET /groups — ห้องเรียนที่ใส่ในหลักสูตรได้ เรียงแบบ classSort */
export async function listGroups(): Promise<RefItem[]> {
  return checkRefs((await http.get("/workload/groups")).data);
}

/** GET /rooms — ห้องของโปรแกรมจัดตาราง (ห้องปฏิบัติการ) เรียงตามชื่อ */
export async function listRooms(): Promise<RefItem[]> {
  return checkRefs((await http.get("/workload/rooms")).data);
}

// ---- เขียน (admin เท่านั้น · ภาคเรียนที่รอบปิดแล้ว 409) ----

export type SeedBody =
  | { year: number; semester: number; source: "timetable" }
  | { year: number; semester: number; source: "copy"; from_year: number; from_semester: number };

/** POST /curricula/seed — ตั้งต้นภาคเรียนที่ยังว่าง · unconverted มาครั้งเดียวในคำตอบนี้ ไม่ได้เก็บไว้ที่ไหน */
export async function seedCurricula(body: SeedBody): Promise<SeedResult> {
  const res = await http.post("/workload/curricula/seed", body);
  const d = res.data;
  const c = d?.counts;
  if (!isObject(d) || !isObject(c) || ![c.curricula, c.lines, c.groups, c.sets, c.options].every(isCount)) {
    fail("seed counts");
  }
  if (!Array.isArray(d.unconverted) || !d.unconverted.every((u: unknown) => isObject(u) && isText(u.reason))) {
    fail("seed unconverted");
  }
  if (d.imported !== null) {
    const counts = (x: any) => isObject(x) && isCount(x.created) && isCount(x.linked) && isCount(x.skipped);
    if (!isObject(d.imported) || !counts(d.imported.teachers) || !counts(d.imported.subjects)) fail("seed imported");
  }
  return d as SeedResult;
}

/** POST /curricula · ไม่ส่ง level = ให้เซิร์ฟเวอร์เดาจากห้อง (ทุกห้องอยู่ระดับเดียวกัน) */
export async function createCurriculum(
  body: { year: number; semester: number } & Omit<CurriculumBody, "level"> & { level?: string | null },
): Promise<Curriculum> {
  return checkCurriculum((await http.post("/workload/curricula", body)).data);
}

/** PUT /curricula/{id} · เอาห้องออกระหว่างรอบเปิดอาจได้ 409 ที่ต้องส่งซ้ำด้วย force */
export async function updateCurriculum(id: number, body: Partial<CurriculumBody>, force = false): Promise<Curriculum> {
  return checkCurriculum((await http.put(`/workload/curricula/${id}`, body, forceParams(force))).data);
}

/** DELETE /curricula/{id} (บรรทัดและห้องของมันหายด้วย) */
export async function deleteCurriculum(id: number, force = false): Promise<void> {
  await http.delete(`/workload/curricula/${id}`, forceParams(force));
}

/** POST /curriculum-lines · รหัสที่ตรงทะเบียนผูกวิชาและเติมชื่อ/กลุ่มสาระที่ไม่ได้ส่ง */
export async function createLine(body: LineBody & { curriculum_id: number }): Promise<CurriculumLine> {
  return checkLine((await http.post("/workload/curriculum-lines", body)).data);
}

/** PUT /curriculum-lines/{id} — ส่งเฉพาะช่องที่เปลี่ยน (รหัสเดิมส่งซ้ำไม่ผูกวิชาใหม่) */
export async function updateLine(id: number, body: Partial<LineBody>, force = false): Promise<CurriculumLine> {
  return checkLine((await http.put(`/workload/curriculum-lines/${id}`, body, forceParams(force))).data);
}

export async function deleteLine(id: number, force = false): Promise<void> {
  await http.delete(`/workload/curriculum-lines/${id}`, forceParams(force));
}

/** POST /term-sets — ชุดคาบเสรี/กิจกรรมของภาคเรียน (ห้องหนึ่งอยู่หลายชุดได้) */
export async function createTermSet(body: SetBody & { year: number; semester: number }): Promise<TermSet> {
  return checkSet((await http.post("/workload/term-sets", body)).data);
}

export async function updateTermSet(id: number, body: Partial<SetBody>, force = false): Promise<TermSet> {
  return checkSet((await http.put(`/workload/term-sets/${id}`, body, forceParams(force))).data);
}

export async function deleteTermSet(id: number, force = false): Promise<void> {
  await http.delete(`/workload/term-sets/${id}`, forceParams(force));
}

/** POST /term-set-options — วิชาเดียวเป็นตัวเลือกของชุดเดียวได้ครั้งเดียว (409) */
export async function createOption(body: OptionBody & { set_id: number }): Promise<TermSetOption> {
  return checkOption((await http.post("/workload/term-set-options", body)).data);
}

/** PUT /term-set-options/{id} — ไม่มี force (การแก้ไม่ลบครูของตัวเลือก) · เซิร์ฟเวอร์ไม่รับช่อง force */
export async function updateOption(id: number, body: Partial<OptionBody>): Promise<TermSetOption> {
  return checkOption((await http.put(`/workload/term-set-options/${id}`, body)).data);
}

export async function deleteOption(id: number, force = false): Promise<void> {
  await http.delete(`/workload/term-set-options/${id}`, forceParams(force));
}

/** ข้อผิดพลาดที่เป็น 409 "จะลบงานที่คนใส่ไว้ในรอบ ให้ยืนยันซ้ำ" → ข้อความไทยของกล่องยืนยัน · อย่างอื่น → null */
export function forceConflictText(err: unknown): string | null {
  const res = (err as AxiosError | undefined)?.response;
  return forceConflict(res?.status ?? 0, (res?.data as { detail?: unknown } | undefined)?.detail);
}

// ---- กล่องสรุปหลังตั้งต้น: เก็บใน sessionStorage จนกว่า admin กดปิด ----
// รายการแปลงไม่ได้มาครั้งเดียวในคำตอบของการตั้งต้น เซิร์ฟเวอร์ไม่เก็บ และตั้งต้นซ้ำไม่ได้ (ภาคเรียนไม่ว่างแล้ว)
// เปลี่ยนเมนูหรือโหลดหน้าใหม่ต้องไม่ทำให้หาย · ที่เก็บใช้ไม่ได้ (ปิดไว้/โหมดส่วนตัว) ก็ยังอยู่ใน state ของ App ระหว่างเปิดแท็บ
const SEED_KEY = "workload.seedSummary";

export function loadSeedSummary(): SeedResult | null {
  try {
    return parseSeedResult(sessionStorage.getItem(SEED_KEY));
  } catch {
    return null;
  }
}

export function saveSeedSummary(r: SeedResult | null): void {
  try {
    if (r === null) sessionStorage.removeItem(SEED_KEY);
    else sessionStorage.setItem(SEED_KEY, JSON.stringify(r));
  } catch {
    // เก็บไม่ได้ — กล่องยังอยู่ระหว่างเปิดแท็บนี้ (state ของ App) แต่โหลดหน้าใหม่แล้วจะหาย
  }
}
