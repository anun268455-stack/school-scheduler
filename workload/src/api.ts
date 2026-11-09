import axios, { AxiosError } from "axios";
import type { CodeEntry } from "./codes";
import { parseSession, SESSION_KEY, statusText, thaiDetail, type Session } from "./auth";
import type {
  Department, ImportCounts, SubjectCreate, SubjectPatch, TeacherCreate, TeacherPatch, WlSubject, WlTeacher,
} from "./types";

// ที่อยู่เซิร์ฟเวอร์แบบเดียวกับเว็บตาราง (frontend/src/api/client.ts)
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : "/api";

// เซิร์ฟเวอร์ Render หลับได้ ครั้งแรกอาจรอเป็นสิบวินาที จึงตั้งเวลารอไว้ยาว
const http = axios.create({ baseURL: BASE_URL, timeout: 60_000 });

// ---- session: เก็บใน sessionStorage เท่านั้น (เครื่องห้องพักครูใช้ร่วมกัน ปิดแท็บแล้วต้องหาย) ----

export function loadSession(): Session | null {
  try {
    return parseSession(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // เก็บไม่ได้ (เช่นปิดที่เก็บในเบราว์เซอร์) — ยังใช้งานในหน้านี้ได้ แต่โหลดใหม่แล้วต้องใส่รหัสอีก
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ไม่มีอะไรให้ล้าง
  }
}

// ---- 401 = session หมดอายุหรือรหัสถูกปิด: App ลงทะเบียน callback ไว้พากลับหน้าล็อกอิน ----

let onSessionExpired: ((message: string) => void) | null = null;

export function setSessionExpiredHandler(fn: ((message: string) => void) | null): void {
  onSessionExpired = fn;
}

export const SESSION_EXPIRED_TEXT = "หมดเวลาเข้าใช้งานหรือรหัสนี้ถูกปิดแล้ว กรุณาใส่รหัสเข้าใหม่";

http.interceptors.request.use((config) => {
  const s = loadSession();
  if (s) config.headers.set("Authorization", `Bearer ${s.token}`);
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    // login ได้ 401 = รหัสผิด ไม่ใช่ session หมดอายุ
    const isLogin = err.config?.url === "/workload/login";
    if (err.response?.status === 401 && !isLogin) {
      clearSession();
      onSessionExpired?.(SESSION_EXPIRED_TEXT);
    }
    return Promise.reject(err);
  },
);

// ---- ข้อความผิดพลาดภาษาไทยเสมอ แม้เซิร์ฟเวอร์ตอบอังกฤษ ----

// คำตอบของเซิร์ฟเวอร์ผิดรูปจากสัญญา — ต้องขึ้นเป็นความผิดพลาด ไม่ใช่แปลงเป็นค่าที่ดูปกติ
export class ContractError extends Error {}
const CONTRACT_TEXT = "เซิร์ฟเวอร์ตอบกลับในรูปแบบที่ไม่คาดไว้ กรุณาแจ้งผู้ดูแลระบบ";

export function apiErrorText(err: unknown): string {
  if (err instanceof ContractError) return CONTRACT_TEXT;
  const res = (err as AxiosError | undefined)?.response;
  const fromServer = thaiDetail((res?.data as { detail?: unknown } | undefined)?.detail);
  if (fromServer) return fromServer;
  return statusText(res?.status ?? 0);
}

// ---- route ของเว็บลงอัตรากำลัง ----
// ที่เดียวที่รู้ชื่อช่องแบบขีดล่างของเซิร์ฟเวอร์ (department_id) — ไฟล์อื่นเห็นแต่ departmentId

export type Health = { needsSetup: boolean };

export async function health(): Promise<Health> {
  const res = await http.get("/workload/health");
  return { needsSetup: Boolean(res.data?.needs_setup) };
}

export async function login(code: string): Promise<Session> {
  // ส่งรหัสตามที่พิมพ์ — เซิร์ฟเวอร์ตัดช่องว่างเอง
  const res = await http.post("/workload/login", { code });
  const d = res.data;
  return {
    token: d.token,
    role: d.role,
    departmentId: d.department_id ?? null,
    label: d.label,
  };
}

export async function logout(): Promise<void> {
  await http.post("/workload/logout");
}

export type Me = Omit<Session, "token">;

export async function me(): Promise<Me> {
  const res = await http.get("/workload/me");
  const d = res.data;
  return { role: d.role, departmentId: d.department_id ?? null, label: d.label };
}

// ---- ทะเบียนครูและวิชา ----
// body ที่ส่งไปมีชนิดจำกัดแค่ช่องที่เว็บนี้เป็นเจ้าของ (types.ts) — ช่องเงื่อนไขของเครื่องจัดคาบพิมพ์ไม่ผ่านคอมไพล์

export async function listTeachers(): Promise<WlTeacher[]> {
  const res = await http.get("/workload/teachers");
  return res.data as WlTeacher[];
}

export async function createTeacher(body: TeacherCreate): Promise<WlTeacher> {
  const res = await http.post("/workload/teachers", body);
  return res.data as WlTeacher;
}

export async function updateTeacher(id: number, body: TeacherPatch): Promise<WlTeacher> {
  const res = await http.put(`/workload/teachers/${id}`, body);
  return res.data as WlTeacher;
}

export async function listSubjects(): Promise<WlSubject[]> {
  const res = await http.get("/workload/subjects");
  return res.data as WlSubject[];
}

export async function createSubject(body: SubjectCreate): Promise<WlSubject> {
  const res = await http.post("/workload/subjects", body);
  return res.data as WlSubject;
}

export async function updateSubject(id: number, body: SubjectPatch): Promise<WlSubject> {
  const res = await http.put(`/workload/subjects/${id}`, body);
  return res.data as WlSubject;
}

// ตัวเลขที่ผิดรูปแล้วแปลงเป็น 0 จะอ่านออกมาเป็น "ไม่มีครูใหม่" ซึ่งซ่อนความผิดพลาด จึงโยนทิ้ง
function counts(d: any): ImportCounts {
  const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
  if (!isCount(d?.created) || !isCount(d?.linked) || !isCount(d?.skipped)) {
    throw new ContractError("bad import counts");
  }
  return { created: d.created, linked: d.linked, skipped: d.skipped };
}

// GET = ดูก่อนเฉย ๆ ไม่เขียนอะไร · POST = เขียนจริง (ต้องมาจากปุ่มยืนยันเท่านั้น)
export async function importPreview(): Promise<ImportCounts> {
  const res = await http.get("/workload/teachers/import-from-scheduler");
  return counts(res.data);
}

export async function importRun(): Promise<ImportCounts> {
  const res = await http.post("/workload/teachers/import-from-scheduler");
  return counts(res.data);
}

// ทะเบียนกลุ่มสาระเป็นของเว็บตาราง เว็บนี้ยืมอ่านอย่างเดียว (ห้ามเรียก route เขียนใด ๆ นอก /workload/)
export async function listDepartments(): Promise<Department[]> {
  const res = await http.get("/departments/");
  return (res.data as any[]).map((d) => ({ id: d.id, name: d.name }));
}

// ---- รหัสเข้า (admin เท่านั้น) · เซิร์ฟเวอร์ไม่เคยส่งตัวรหัสกลับมา มีแต่สถานะ ----

export async function listCodes(): Promise<CodeEntry[]> {
  const res = await http.get("/workload/codes");
  if (!Array.isArray(res.data)) throw new ContractError("bad codes list");
  return res.data as CodeEntry[];
}

// สร้างได้เฉพาะรหัสหัวหน้ากลุ่มสาระ (รหัส admin มาจากหน้าตั้งรหัสครั้งแรกเท่านั้น)
export async function createCode(body: { department_id: number; label: string; code: string }): Promise<void> {
  await http.post("/workload/codes", { role: "head", ...body });
}

export async function updateCode(id: number, body: { code: string } | { active: boolean }): Promise<void> {
  await http.put(`/workload/codes/${id}`, body);
}

// ตั้ง/กู้รหัสผู้ดูแลระบบด้วยรหัสตั้งค่าจาก Render · ไม่ล็อกอินให้ ผู้เรียกต้องพากลับหน้าล็อกอิน
export async function setupAdmin(setupCode: string, code: string): Promise<void> {
  await http.post("/workload/setup", { setup_code: setupCode, code });
}
