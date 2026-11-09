import axios, { AxiosError } from "axios";
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

export function apiErrorText(err: unknown): string {
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

function counts(d: any): ImportCounts {
  return { created: Number(d?.created) || 0, linked: Number(d?.linked) || 0, skipped: Number(d?.skipped) || 0 };
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
