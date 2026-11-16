import { ContractError, http } from "./api";
import {
  isDeptStatus, isOptionTeacher, isRound, isRoundDetail, isRoundOption, isRoundPreview, isRoundRow, isTeacherLoad,
  type DeptStatus, type OptionTeacher, type Round, type RoundDetail, type RoundOption, type RoundPreview, type RoundRow,
  type TeacherLoad,
} from "./round";

// ตัวเรียก route ของรอบอัตรากำลัง (งานที่ 3–4) ฟังก์ชันละ route · ใช้ axios ตัวเดียวกับ api.ts (token · 401 → หน้าล็อกอิน)
// คำตอบที่ผิดรูปจากสัญญา → ContractError (apiErrorText แปลงเป็นข้อความไทย) ไม่แปลงเป็นค่าที่ดูปกติ — ตัวตรวจรูปอยู่ใน round.ts

function check<T>(ok: (d: unknown) => d is T, d: unknown, what: string): T {
  if (!ok(d)) throw new ContractError(what);
  return d;
}

function checkList<T>(ok: (d: unknown) => d is T, d: unknown, what: string): T[] {
  if (!Array.isArray(d) || !d.every(ok)) throw new ContractError(what);
  return d;
}

function checkDone(d: unknown, what: string): void {
  if (typeof d !== "object" || d === null || (d as { ok?: unknown }).ok !== true) throw new ContractError(what);
}

const base = (roundId: number) => `/workload/rounds/${roundId}`;

// ---- รอบ (งานที่ 3) ----

/** GET /rounds — ใหม่ก่อน · admin เห็นทุกรอบ · หัวหน้าเห็นเฉพาะที่เปิดให้กรอก/ปิดแล้ว */
export async function listRounds(): Promise<Round[]> {
  return checkList(isRound, (await http.get("/workload/rounds")).data, "rounds");
}

/** GET /rounds/preview — ตัวเลขที่การเปิดรอบจะทำ ไม่เขียนอะไร (admin) · ใช้ได้แม้ภาคเรียนนั้นมีรอบแล้ว */
export async function previewRound(year: number, semester: number): Promise<RoundPreview> {
  return check(isRoundPreview, (await http.get("/workload/rounds/preview", { params: { year, semester } })).data, "preview");
}

/** POST /rounds — สร้างรอบสถานะเตรียม (แถว ครูเทอมก่อน สถานะทุกกลุ่ม) ในธุรกรรมเดียว */
export async function createRound(year: number, semester: number): Promise<RoundDetail> {
  return check(isRoundDetail, (await http.post("/workload/rounds", { year, semester })).data, "round create");
}

/** GET /rounds/{id} — รอบพร้อมรายการที่แปลงแผนไม่ได้ ณ ตอนเปิดรอบ (admin) */
export async function getRound(roundId: number): Promise<RoundDetail> {
  return check(isRoundDetail, (await http.get(base(roundId))).data, "round");
}

/** DELETE /rounds/{id} — ยกเลิกรอบที่ยังเตรียมอยู่ (แถวของรอบหายทั้งหมด หลักสูตรไม่ถูกแตะ) · สถานะอื่น 409 */
export async function cancelRound(roundId: number): Promise<void> {
  checkDone((await http.delete(base(roundId))).data, "round cancel");
}

/** POST /rounds/{id}/open — เตรียม → เปิดให้กลุ่มสาระกรอก · ยังมีบรรทัด/ตัวเลือกที่ไม่มีกลุ่มสาระ 409 */
export async function openRound(roundId: number): Promise<RoundDetail> {
  return check(isRoundDetail, (await http.post(`${base(roundId)}/open`)).data, "round open");
}

/** POST /rounds/{id}/close — ต้องพิมพ์ชื่อรอบให้ตรง (400) · ปิดได้เฉพาะรอบที่เปิดให้กรอก (409) */
export async function closeRound(roundId: number, confirmLabel: string): Promise<RoundDetail> {
  const res = await http.post(`${base(roundId)}/close`, { confirm_label: confirmLabel });
  return check(isRoundDetail, res.data, "round close");
}

// ---- สถานะกลุ่ม ส่ง ตรวจ ตีกลับ (งานที่ 4) ----

/** GET /rounds/{id}/departments — admin ได้ทุกกลุ่ม (เรียงรหัสกลุ่ม) · หัวหน้าได้รายการเดียวของกลุ่มตัวเอง */
export async function listDeptStatuses(roundId: number): Promise<DeptStatus[]> {
  return checkList(isDeptStatus, (await http.get(`${base(roundId)}/departments`)).data, "departments");
}

/** POST .../departments/{dept}/submit — หัวหน้าส่งกลุ่มตัวเอง (ทุกรายการมีครูและยืนยันแล้ว) */
export async function submitDept(roundId: number, departmentId: number): Promise<DeptStatus> {
  return check(isDeptStatus, (await http.post(`${base(roundId)}/departments/${departmentId}/submit`)).data, "submit");
}

/** POST .../departments/{dept}/approve — admin ตรวจผ่านกลุ่มที่ส่งแล้ว */
export async function approveDept(roundId: number, departmentId: number): Promise<DeptStatus> {
  return check(isDeptStatus, (await http.post(`${base(roundId)}/departments/${departmentId}/approve`)).data, "approve");
}

/** POST .../departments/{dept}/return — admin ตีกลับพร้อมหมายเหตุ (ห้ามว่าง) จากส่งแล้วหรือตรวจผ่านแล้ว */
export async function returnDept(roundId: number, departmentId: number, note: string): Promise<DeptStatus> {
  const res = await http.post(`${base(roundId)}/departments/${departmentId}/return`, { note });
  return check(isDeptStatus, res.data, "return");
}

// ---- แถว ครูของตัวเลือก ยอดคาบ (งานที่ 4 — หน้ากรอกของงานที่ 8 ใช้) ----

export type RoundItems = { rows: RoundRow[]; options: RoundOption[] };

/** GET /rounds/{id}/rows — หัวหน้า: กลุ่มตัวเองเสมอ · admin: ไม่ส่ง = ทุกกลุ่ม · "none" = บรรทัดที่ไม่มีกลุ่ม · เลข = กลุ่มนั้น */
export async function getRoundItems(roundId: number, departmentId?: number | "none"): Promise<RoundItems> {
  const params = departmentId === undefined ? undefined : { department_id: departmentId };
  const d = (await http.get(`${base(roundId)}/rows`, { params })).data;
  if (typeof d !== "object" || d === null) throw new ContractError("rows");
  return { rows: checkList(isRoundRow, d.rows, "rows"), options: checkList(isRoundOption, d.options, "options") };
}

/** GET /rounds/{id}/loads — ยอดคาบรายครู */
export async function getRoundLoads(roundId: number): Promise<TeacherLoad[]> {
  return checkList(isTeacherLoad, (await http.get(`${base(roundId)}/loads`)).data, "loads");
}

/** ช่องของแถวที่หัวหน้า/admin แก้ได้ (WL_ROW_FIELDS) — เลือกครูโดยไม่ส่ง confirmed = ยืนยันด้วย · ล้างครู = ยังไม่ยืนยัน */
export type RowPatch = Partial<Pick<RoundRow, "teacher_id" | "co_teacher_id" | "lab_room_id" | "is_double" | "note" | "confirmed">>;

/** PUT /rows/{id} — ส่งเฉพาะช่องที่เปลี่ยน */
export async function updateRow(rowId: number, patch: RowPatch): Promise<RoundRow> {
  return check(isRoundRow, (await http.put(`/workload/rows/${rowId}`, patch)).data, "row");
}

/** POST /rows/bulk — หลายแถวพร้อมกัน (ทั้งหมดหรือไม่เลย) · set มีได้แค่ teacher_id และ confirmed */
export async function bulkRows(ids: number[], set: Partial<Pick<RoundRow, "teacher_id" | "confirmed">>): Promise<RoundRow[]> {
  const d = (await http.post("/workload/rows/bulk", { ids, set })).data;
  if (typeof d !== "object" || d === null) throw new ContractError("bulk");
  return checkList(isRoundRow, d.rows, "bulk rows");
}

/** POST /options/{id}/teachers — เพิ่มครูให้ตัวเลือก (ยืนยันทันที) */
export async function addOptionTeacher(
  optionId: number,
  body: { teacher_id: number; room_id?: number | null; note?: string },
): Promise<OptionTeacher> {
  return check(isOptionTeacher, (await http.post(`/workload/options/${optionId}/teachers`, body)).data, "option teacher add");
}

export type OptionTeacherPatch = Partial<{ teacher_id: number; room_id: number | null; note: string; confirmed: boolean }>;

/** PUT /option-teachers/{id} — เอาครูออกใช้ DELETE (teacher_id เป็น null ไม่ได้) */
export async function updateOptionTeacher(optionTeacherId: number, patch: OptionTeacherPatch): Promise<OptionTeacher> {
  const res = await http.put(`/workload/option-teachers/${optionTeacherId}`, patch);
  return check(isOptionTeacher, res.data, "option teacher");
}

/** DELETE /option-teachers/{id} */
export async function deleteOptionTeacher(optionTeacherId: number): Promise<void> {
  checkDone((await http.delete(`/workload/option-teachers/${optionTeacherId}`)).data, "option teacher delete");
}
