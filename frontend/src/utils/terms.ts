/**
 * terms — ภาคเรียน: ฟังก์ชันล้วนที่หน้าเว็บใช้ตัดสินว่ากำลังดูเทอมไหน แก้ได้ไหม
 *
 * เทอมที่ปิดแล้วเปิดดูได้ในเบราว์เซอร์เท่านั้น ข้อมูลฝั่งเซิร์ฟเวอร์ไม่ถูกแตะ
 * ครูอีกคนที่แก้ตารางเทอมปัจจุบันอยู่จึงไม่รู้สึกอะไร — ด้วยเหตุนี้ซิงค์สดต้อง
 * หยุดตอนดูเทอมที่ปิด ไม่งั้นมันจะดึงเทอมปัจจุบันมาทับของเก่าที่เปิดดูอยู่
 */
import type { DataState } from "./serverWake";

export type TermStatus = "active" | "closed";

/** หนึ่งแถวจาก /api/terms — ชื่อและลำดับฟิลด์ตรงกับเซิร์ฟเวอร์ทุกตัว */
export interface TermMeta {
  id: number;
  year: number;
  semester: number;
  label: string;
  status: TermStatus;
  slots: number | null;
  opened_at: string | null;
  closed_at: string | null;
  bytes: number;
}

export function termLabel(year: number, semester: number): string {
  return `${semester}/${year}`;
}

/** ใหม่สุดก่อน — ไม่แก้อาร์เรย์ที่รับมา */
export function sortTerms(terms: TermMeta[]): TermMeta[] {
  return [...terms].sort((a, b) => b.year - a.year || b.semester - a.semester);
}

export function activeTerm(terms: TermMeta[]): TermMeta | undefined {
  return terms.find((t) => t.status === "active");
}

/**
 * `viewing` เป็น null = ยังไม่มีระบบเทอม หรือกำลังดูเทอมที่ใช้งานอยู่ → แก้ได้
 */
export function canEdit(viewing: TermMeta | null, active: TermMeta | null): boolean {
  if (viewing === null) return true;
  return viewing.id === active?.id && viewing.status === "active";
}

/**
 * ซิงค์สดควรทำงานไหม — หยุดเสมอตอนดูเทอมที่ปิด นอกนั้นทำเมื่อข้อมูลพร้อมแล้ว
 * ร้านยังมีเงื่อนไขของตัวเอง (เปิดสวิตช์ซิงค์ ไม่กำลังลาก ฯลฯ) และเอามา AND กับตัวนี้
 */
export function shouldPoll(viewingClosed: boolean, dataState: DataState): boolean {
  if (viewingClosed) return false;
  return dataState === "ready";
}

export function termBanner(viewing: TermMeta | null, active: TermMeta | null): string | null {
  if (viewing === null || canEdit(viewing, active)) return null;
  return `เทอม ${viewing.label} · ปิดแล้ว ดูและปริ้นได้เท่านั้น`;
}

/** เทอมถัดไปที่น่าจะเปิด — ไม่มีเทอมเลยให้ผู้ใช้กรอกปีเอง (year: 0) */
export function nextTerm(active: TermMeta | null): { year: number; semester: number } {
  if (active === null) return { year: 0, semester: 1 };
  if (active.semester === 1) return { year: active.year, semester: 2 };
  return { year: active.year + 1, semester: 1 };
}
