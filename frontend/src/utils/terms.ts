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

/**
 * ฟิลด์ในร้านที่เป็นข้อมูลสดจากเซิร์ฟเวอร์ — ชุดที่ต้องไม่ถูกเขียนทับตอนดูเทอมที่ปิด
 * (เก้าชุดแรกคือสิ่งที่ openTerm วางลงไป ถัดมาคือถาดและลานที่โหลดมาพร้อมกัน
 * และ schoolConfig ซึ่งใบพิมพ์อ่านชื่อผู้อำนวยการ ภาคเรียน ปี จากตรงนี้)
 */
export const LIVE_DATA_KEYS = [
  "groups", "teachers", "subjects", "rooms", "requirements", "slots", "periods",
  "departments", "buildings", "parked", "yardPicks", "yardList", "schoolConfig",
] as const;

/**
 * ตัวนับว่า "ใครกำลังได้รับอนุญาตให้เขียนข้อมูลลงร้าน" และ "มีงานเปลี่ยนเทอมค้างอยู่ไหม"
 *
 * ใช้ตัวเลขตั๋ว (token) ไม่ใช่ boolean: สองงานที่ซ้อนกันต้องไม่ล้างของกันและกัน
 * enter, enter, leave ยังต้องถือว่าอนุญาตอยู่ และคนที่ไม่ใช่เจ้าของตั๋วคืนตั๋วไม่ได้
 */
export interface TermLanding {
  /** ขอเข้า ได้ตั๋วหนึ่งใบ */
  enter(): number;
  /** คืนตั๋ว — ถ้าไม่ใช่ตั๋วที่ถืออยู่ ไม่เกิดอะไรขึ้น คืน false */
  leave(token: number): boolean;
  /** จำนวนตั๋วที่ถืออยู่ */
  held(): number;
  /** ขอเข้าเมื่อไม่มีใครถืออยู่เท่านั้น มิฉะนั้น null (ใช้ปฏิเสธงานที่ซ้อนกัน) */
  tryEnter(): number | null;
}

export function createLanding(): TermLanding {
  let next = 1;
  const tokens = new Set<number>();
  return {
    enter(): number { const t = next++; tokens.add(t); return t; },
    leave(token: number): boolean { return tokens.delete(token); },
    held(): number { return tokens.size; },
    tryEnter(): number | null {
      if (tokens.size > 0) return null;
      const t = next++; tokens.add(t); return t;
    },
  };
}

/**
 * ข้อมูลสดต้องถูกกันไว้ตอนนี้ไหม — กำลังดูเทอมที่ปิด และไม่มีงานที่ได้รับอนุญาตถืออยู่
 */
export function blocksLiveWrite(
  viewing: Pick<TermMeta, "status"> | null, landing: TermLanding,
): boolean {
  return viewing?.status === "closed" && landing.held() === 0;
}

/**
 * กฎข้อเดียวของการดูเทอมเก่า: ระหว่างที่เทอมที่ปิดอยู่บนจอ ข้อมูลสดห้ามเขียนลงร้าน
 *
 * ตรวจที่จุดเดียวคือตอนเขียนลงร้าน ไม่ใช่ที่ผู้เรียกแต่ละราย — ผู้เรียกคนถัดไป
 * จะไม่รู้ว่ามีกฎนี้ `block` เป็น true = ตัดฟิลด์ข้อมูลสดออก เหลือฟิลด์อื่น
 * (isLoading, dataState ฯลฯ) ไว้ตามเดิม `onDrop` ถูกเรียกพร้อมชื่อฟิลด์ที่ถูกตัด
 * เพื่อให้นักพัฒนาที่เขียนแล้วค่าหายหาสาเหตุเจอในไม่กี่วินาที
 */
export function dropLiveData<T extends object>(
  next: T, block: boolean, onDrop?: (keys: string[]) => void,
): Partial<T> {
  if (!block) return next;
  const dropped = new Set<string>(LIVE_DATA_KEYS);
  const kept: Partial<T> = {};
  const lost: string[] = [];
  for (const k of Object.keys(next) as (keyof T & string)[]) {
    if (dropped.has(k)) lost.push(k);
    else kept[k] = next[k];
  }
  if (lost.length > 0 && onDrop) onDrop(lost);
  return kept;
}

/**
 * คำขอนี้ผ่านด่านขาออกได้ไหมตอนดูเทอมที่ปิดอยู่
 *
 * ผ่านได้: อ่าน (GET/HEAD) · เส้นเทอม (/terms…) ซึ่งเป็นของระบบเทอมเอง · และ
 * ค่าตั้งโรงเรียน (/school/config) เพราะแบบฟอร์มใบพิมพ์และช่องลงชื่อเป็นความชอบ
 * ของทั้งโรงเรียน ไม่ใช่ข้อมูลของเทอม และการเปิดเทอมเก่าก็เพื่อพิมพ์ — เซิร์ฟเวอร์
 * ไม่ยอมให้ค่านี้เปลี่ยน term/year เมื่อมีระบบเทอมแล้ว ชื่อเทอมบนใบพิมพ์จึงไม่เพี้ยน
 * นอกนั้นถูกกัน รวมถึง POST ที่แค่วิเคราะห์ (ตั้งใจ: หลายตัวเขียนกลับลงข้อมูลที่
 * วิเคราะห์ การแยกว่าตัวไหนปลอดภัยจริงเป็นงานที่ใหญ่กว่าที่เห็น)
 */
export function writeAllowedWhileViewing(method: string, url: string): boolean {
  const m = method.toLowerCase();
  if (m === "get" || m === "head") return true;
  const path = url.split("?")[0];
  return path === "/terms" || path.startsWith("/terms/") || path === "/school/config";
}
