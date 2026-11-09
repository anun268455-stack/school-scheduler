// ตรรกะล้วนของการล็อกอินและการแยกบทบาท — ห้าม import อะไรที่ node รันเองไม่ได้
// (ไม่มี axios, ไม่แตะ sessionStorage ตอน import) เพื่อให้ tests/run.sh ทดสอบได้โดยไม่ต้องลง dependency

export type Role = "admin" | "head";

export type Session = {
  token: string;
  role: Role;
  departmentId: number | null;
  label: string;
};

export const SESSION_KEY = "workload.session";

// มีแต่ admin ที่จัดการทะเบียนครู/วิชาและรหัสเข้าได้
export function canManageRegistry(s: Session | null): boolean {
  return s !== null && s.role === "admin";
}

// หัวหน้ากลุ่มสาระเห็นแค่กลุ่มของตัวเอง · ยังไม่ล็อกอินไม่เห็นอะไรเลย
// (กลุ่มของหัวหน้าที่ไม่อยู่ในรายการ = ว่าง ไม่ใช่ถอยไปเห็นทั้งหมด)
export function visibleDepartments(s: Session | null, all: number[]): number[] {
  if (s === null) return [];
  if (s.role === "admin") return [...all];
  return s.departmentId !== null && all.includes(s.departmentId) ? [s.departmentId] : [];
}

// ของใน sessionStorage อาจถูกแก้มือหรือมาจากรุ่นเก่า — รูปผิดตรงไหนก็ถือว่าไม่มี session
// จะได้ไม่มีใครกลายเป็น admin บนหน้าจอจากข้อมูลที่ไม่ได้มาจากเซิร์ฟเวอร์
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.token !== "string" || o.token === "") return null;
  if (typeof o.label !== "string") return null;
  if (o.role === "admin") {
    if (o.departmentId !== null) return null;
    return { token: o.token, role: "admin", departmentId: null, label: o.label };
  }
  if (o.role === "head") {
    if (typeof o.departmentId !== "number" || !Number.isInteger(o.departmentId)) return null;
    return { token: o.token, role: "head", departmentId: o.departmentId, label: o.label };
  }
  return null;
}

// ข้อความตามรหัสสถานะที่จริงในทุกหน้า (ไม่ผูกกับการล็อกอิน) · 0 = เรียกเซิร์ฟเวอร์ไม่ถึง
export function statusText(status: number): string {
  switch (status) {
    case 0:
      return "ติดต่อเซิร์ฟเวอร์ไม่ได้ เซิร์ฟเวอร์อาจกำลังตื่น รอสักครู่แล้วลองใหม่";
    case 401:
      return "ยังไม่ได้เข้าสู่ระบบหรือหมดเวลาแล้ว กรุณาใส่รหัสเข้าใหม่";
    case 403:
      return "เฉพาะผู้ดูแลระบบเท่านั้นที่ทำรายการนี้ได้";
    case 404:
      return "เซิร์ฟเวอร์ยังเป็นรุ่นที่ยังไม่มีเว็บลงอัตรากำลัง กรุณาแจ้งผู้ดูแลระบบ";
    case 429:
      return "ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่";
    case 503:
      return "ต่อฐานข้อมูลไม่ได้ในตอนนี้ ลองใหม่อีกครั้งภายหลัง";
    default:
      return `ทำรายการไม่สำเร็จ (รหัสสถานะ ${status})`;
  }
}

// ข้อความของแบบฟอร์มล็อกอินเท่านั้น หน้าอื่นใช้ statusText
// 0 = เรียกเซิร์ฟเวอร์ไม่ถึง (ไม่มีคำตอบกลับมา)
export function loginError(status: number): string {
  if (status === 401) return "รหัสไม่ถูกต้อง ตรวจรหัสแล้วลองใหม่";
  if (status === 503) return "ต่อฐานข้อมูลไม่ได้ในตอนนี้ ลองใหม่อีกครั้งภายหลัง";
  if (status === 0) {
    return "ติดต่อเซิร์ฟเวอร์ไม่ได้ เซิร์ฟเวอร์อาจกำลังตื่น รอสักครู่แล้วลองใหม่";
  }
  return `เข้าสู่ระบบไม่สำเร็จ (รหัสสถานะ ${status}) ลองใหม่อีกครั้ง`;
}

// เซิร์ฟเวอร์รุ่นเก่าตอบ detail เป็นอังกฤษ (เช่น "Not Found") หรือเป็นลิสต์ (422 ของ FastAPI)
// ผู้ใช้ต้องเห็นไทยเท่านั้น จึงรับเฉพาะ string ที่มีอักษรไทย
export function thaiDetail(detail: unknown): string | null {
  return typeof detail === "string" && /[\u0E00-\u0E7F]/.test(detail) ? detail : null;
}
