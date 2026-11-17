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
 * ผ่านได้เฉพาะ: อ่าน (GET/HEAD) และเส้นเทอม (/terms…) ซึ่งเป็นของระบบเทอมเอง
 * นอกนั้นถูกกันทั้งหมด ไม่มียกเว้น — รวมค่าตั้งโรงเรียน (/school/config): ตัวตั้ง
 * ค่าในร้านเขียนลงจอก่อนแล้วค่อยส่ง และ schoolConfig เป็นข้อมูลสดที่ถูกกัน ถ้าปล่อย
 * คำขอไปแต่จอไม่เปลี่ยน จะได้ฟอร์มที่ส่งถึงเซิร์ฟเวอร์จริงแต่ข้อความที่พิมพ์เด้งกลับ
 * ซึ่งแย่กว่าปฏิเสธตรง ๆ ฟอร์มตั้งค่าได้ก่อนเปิดหรือหลังออกจากเทอมเก่า ใบพิมพ์ของ
 * เทอมที่ปิดพิมพ์ได้ครบอยู่แล้ว ประตู "บอกว่าตั้งใจ" ที่ผู้เรียกทำตามได้จึงไม่เปิด
 * POST ที่แค่วิเคราะห์ก็ถูกกันด้วย (หลายตัวเขียนกลับลงข้อมูลที่วิเคราะห์)
 */
export function writeAllowedWhileViewing(method: string, url: string): boolean {
  const m = method.toLowerCase();
  if (m === "get" || m === "head") return true;
  const path = url.split("?")[0];
  return path === "/terms" || path.startsWith("/terms/");
}

// ── หน้าจอรายการเทอม / สร้างเทอมใหม่ / สถิติ ─────────────────────────────────
// ตัดสินใจทุกอย่างที่นี่ ไม่ใช่ในคอมโพเนนต์ — คอมโพเนนต์ทดสอบไม่ได้ ฟังก์ชันล้วนทดสอบได้

/** ข้อความเดียวของทั้งสามหน้าเมื่อไม่มีฐานข้อมูล — ไม่แสดงปุ่มใด ๆ ควบคู่ */
export const TERMS_UNAVAILABLE =
  "ยังไม่ได้ต่อฐานข้อมูล จึงใช้ระบบเทอมไม่ได้ — ต้องต่อฐานข้อมูลก่อน "
  + "จึงจะดู สร้าง หรือเปรียบเทียบเทอมได้";

export function termStatusText(status: TermStatus): string {
  return status === "active" ? "ใช้งานอยู่ · แก้ได้" : "ปิดแล้ว · อ่านอย่างเดียว";
}

/** ขนาดไฟล์ของเทอม: "512 B" · "48 KB" · "1.4 MB" */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "–";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ข้อความเตือนในหน้าต่างปลดล็อก
 *
 * มีได้ทีละหนึ่งเทอมที่แก้ได้ การปลดล็อกเทอมเก่าจึงปิดเทอมที่ใช้อยู่ไปด้วย
 * ต้องบอกชื่อเทอมนั้นและจำนวนคาบ ไม่งั้นคนที่ปลดล็อกเพื่อดูอะไรนิดเดียว
 * จะมาเจอทีหลังว่างานของเทอมนี้ถูกปิดไปแล้ว
 */
export function unlockNotice(target: TermMeta, active: TermMeta | null): string[] {
  const lines: string[] = [];
  if (active !== null && active.id !== target.id) {
    const periods = active.slots === null ? "" : ` (ลงคาบไว้ ${active.slots} คาบ ตามที่เก็บไว้ล่าสุด ไม่ใช่ตัวเลขสด)`;
    lines.push(
      `การปลดล็อกจะปิดเทอมที่ใช้งานอยู่ตอนนี้ คือเทอม ${active.label}${periods} ไปด้วย `
      + "เพราะแก้ได้ทีละหนึ่งเทอมเท่านั้น");
    lines.push(`เทอม ${active.label} จะกลายเป็นอ่านอย่างเดียวจนกว่าจะปลดล็อกกลับมา`);
  }
  lines.push(`เทอม ${target.label} จะกลับมาแก้ไขได้ และทุกคนที่ใช้ระบบอยู่จะเห็นข้อมูลของเทอมนี้`);
  lines.push("ถ้าแค่อยากดูหรือปริ้นเทอมเก่า ให้กด “เปิดดู” แทน — ไม่ต้องปลดล็อก");
  return lines;
}

/** พิมพ์ชื่อเทอมตรงหรือยัง — กฎเดียวกับเซิร์ฟเวอร์ (ตัดช่องว่างหัวท้าย) */
export function unlockConfirmed(target: TermMeta, typed: string): boolean {
  return typed.trim() === target.label;
}

/**
 * กลอนกดครั้งเดียว — take() ได้ true แค่ครั้งแรก
 *
 * disabled จาก state ของ React มีผลหลังวาดใหม่ คลิกซ้อนสองครั้งในจังหวะเดียวกัน
 * ยังผ่านได้ทั้งคู่ ตัวนี้เปลี่ยนทันทีที่ถูกเรียก
 */
export interface Latch { take(): boolean; reset(): void; taken(): boolean }

export function createLatch(): Latch {
  let t = false;
  return {
    take(): boolean { if (t) return false; t = true; return true; },
    reset(): void { t = false; },
    taken(): boolean { return t; },
  };
}

/**
 * ข้อผิดพลาดนี้แปลว่า "เซิร์ฟเวอร์ปฏิเสธก่อนทำอะไร" ไหม — กดยืนยันซ้ำได้อย่างปลอดภัย
 *
 * 400/409 มาจากการตรวจก่อนสร้าง ไม่มีอะไรเปลี่ยน ส่วนหมดเวลา เครือข่ายหลุด หรือ 5xx
 * บอกไม่ได้ว่าเทอมถูกสร้างไปแล้วหรือยัง การกดซ้ำอาจปิดเทอมที่เพิ่งสร้าง จึงไม่ปล่อยให้กดอีก
 *
 * `fromRound` (สร้างจากรอบอัตรากำลัง): 403 รหัสผิด · 429 ผิดเกินเกณฑ์ · 404 ไม่มีรอบ ก็เป็นการปฏิเสธ
 * ก่อนแตะอะไรเหมือนกัน (เซิร์ฟเวอร์ตรวจรหัสก่อนเปิดธุรกรรม) — ต้องให้แก้รหัสแล้วกดใหม่ได้
 * · 503 ของทางรอบเกิดก่อนเขียนเสมอ (ต่อฐาน/อ่านรายการเทอมไม่ได้ — ข้อความไทยของเซิร์ฟเวอร์บอกให้ลองใหม่) จึงกดใหม่ได้
 *   เฉพาะเมื่อมีข้อความไทยของเซิร์ฟเวอร์: 503 ที่ตัวกลางตอบแทน (ไม่มีข้อความไทย) บอกไม่ได้ว่าคำขอถึงเซิร์ฟเวอร์หรือยัง (รีวิวทั้งสาขา M11)
 */
export function canRetryCreate(e: unknown, fromRound = false): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status === 400 || status === 409) return true;
  if (!fromRound) return false;
  if (status === 403 || status === 404 || status === 429) return true;
  return status === 503 && serverThai(e) !== null;
}

/** ข้อความไทยที่เซิร์ฟเวอร์ส่งมาใน detail (ไม่มี/ไม่ใช่ไทย = null — เช่นคำตอบของตัวกลาง) */
function serverThai(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === "string" && /[\u0E00-\u0E7F]/.test(d) ? d.trim() : null;
}

/**
 * ข้อความเมื่อกดสร้างใหม่ไม่ได้ (canRetryCreate เป็นเท็จ) — ปุ่มยังล็อก
 * ทางรอบที่ได้ 500 พร้อมข้อความไทยของเซิร์ฟเวอร์ ("…ข้อมูลเดิมยังอยู่ครบ") = เซิร์ฟเวอร์ย้อนแล้ว แสดงข้อความนั้น ไม่ใช่ "ยังไม่รู้ว่าสร้างหรือยัง"
 * แต่ยังให้ดูรายการเทอมก่อนลองใหม่ (COMMIT ที่ล้มแบบกำกวมก็ตอบ 500) (รีวิวทั้งสาขา M11) · ที่เหลือ (ทางเดิม · หมดเวลา ·
 * ตัวกลางตอบแทน) = ข้อความเดิมทุกตัวอักษร
 */
export function createLockedText(e: unknown, fromRound = false): string {
  const status = (e as { response?: { status?: number } })?.response?.status;
  const thai = serverThai(e);
  if (fromRound && status === 500 && thai) {
    return `${thai} — ปิดหน้าต่างนี้แล้วดูรายการเทอมก่อน ถ้ายังไม่มีเทอมใหม่ ค่อยเปิดหน้าต่างใหม่แล้วกดสร้างอีกครั้ง`;
  }
  return termErrorText(e, "ไม่ได้รับคำตอบที่แน่ชัดจากเซิร์ฟเวอร์")
    + " — ยังไม่รู้ว่าเทอมถูกสร้างหรือยัง ปิดหน้าต่างนี้แล้วดูรายการเทอมก่อน อย่ากดสร้างซ้ำ";
}

/**
 * ข้อความไทยที่ผู้ใช้ควรเห็น: ที่เซิร์ฟเวอร์ส่งมา (400/403/404/409/429/503) หรือที่ร้านโยนเอง
 * (Error ภาษาไทยที่ไม่ได้มาจากเครือข่าย เช่นข้อความของด่านกันแก้ไข) มิฉะนั้นข้อความสำรอง
 * ข้อความอังกฤษของ axios ("Request failed with status code 500") ไม่เคยถูกส่งต่อ
 */
export function termErrorText(e: unknown, fallback: string): string {
  const r = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  if (!r && e instanceof Error && /[\u0E00-\u0E7F]/.test(e.message)) return e.message;
  const d = r?.data?.detail;
  // 403/429 มีแค่ทางสร้างเทอมจากรอบ (รหัสผู้ดูแลระบบผิด · ผิดเกินเกณฑ์) — ทางเดิมไม่มีสองตัวนี้
  const ok = [400, 403, 404, 409, 429, 503].includes(r?.status ?? 0);
  return ok && typeof d === "string" && d.trim() ? d : fallback;
}

/** ผลของการสร้างเทอม ในรูปที่ไม่ต้องพึ่ง axios */
export interface CreateResultLike {
  closed: { label: string; slots: number | null } | null;
  active: { label: string };
  save_error?: string | null;
  save_pending?: boolean;
  /** ผลของปลดล็อกเทอม: ข้อความไทยของการปรับทะเบียนครู/วิชาของเว็บลงอัตรากำลังตามเทอมที่เปิด (ว่าง = ไม่มีอะไรต้องปรับ) */
  workload?: string[] | null;
}

/**
 * บอกผลการสร้างเทอม (หรือปลดล็อก — verb) โดยไม่พูดว่า "บันทึกแล้ว"
 *
 * `save_error: null` ไม่ได้พิสูจน์ว่าเขียนลงฐานข้อมูลแล้ว เซิร์ฟเวอร์แค่ใส่คิวไว้
 * (`save_pending: true` = ยังอยู่ระหว่างส่ง) คำตอบจริงอยู่ที่ป้ายสถานะการบันทึกบนแถบ
 * ด้านบน ซึ่งอ่านจาก /state/version
 * `workload` ต่อท้ายข้อความ — คนที่ปลดล็อกต้องรู้ว่าทะเบียนของเว็บลงอัตรากำลังถูกปรับ และมีรายการไหนถูกข้าม
 */
export function createOutcome(
  r: CreateResultLike, verb: "สร้าง" | "ปลดล็อก" = "สร้าง",
): { tone: "info" | "warn" | "error"; text: string } {
  const closed = r.closed
    ? ` เทอม ${r.closed.label} ถูกปิดแล้ว (${r.closed.slots ?? 0} คาบ)`
    : "";
  const notes = (r.workload ?? []).filter((t) => typeof t === "string" && t.trim() !== "");
  const head = `${verb}เทอม ${r.active.label} แล้ว${closed}${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
  if (r.save_error) {
    return {
      tone: "error",
      text: `${head} แต่เซิร์ฟเวอร์รายงานว่าส่งลงฐานข้อมูลไม่สำเร็จ: ${r.save_error} `
        + "— อย่าเพิ่งปิดหน้านี้ ดูป้ายสถานะการบันทึกบนแถบด้านบนจนกว่าจะกลับเป็นปกติ",
    };
  }
  if (r.save_pending) {
    return {
      tone: "warn",
      text: `${head} · ยังอยู่ระหว่างส่งลงฐานข้อมูล รอให้ป้ายสถานะการบันทึกบนแถบด้านบนเปลี่ยนเป็นเวลาล่าสุดก่อนปิดหน้านี้`,
    };
  }
  return {
    tone: "info",
    text: `${head} · ให้ดูป้ายสถานะการบันทึกบนแถบด้านบนยืนยันอีกครั้งว่าส่งลงฐานข้อมูลเรียบร้อย`,
  };
}

/** ตรวจช่องปี/ภาคเรียนในหน้าสร้างเทอม — ช่วงเดียวกับเซิร์ฟเวอร์ คืนข้อความไทยหรือ null */
export function newTermFormError(
  year: string, semester: string, existing: TermMeta[],
): string | null {
  const y = Number(year);
  const s = Number(semester);
  if (year.trim() === "" || !Number.isInteger(y) || y < 2500 || y > 2700) {
    return "ปีการศึกษาต้องเป็นตัวเลข พ.ศ. 2500–2700";
  }
  if (s !== 1 && s !== 2) return "ภาคเรียนต้องเป็น 1 หรือ 2";
  if (existing.some((t) => t.year === y && t.semester === s)) {
    return `มีเทอม ${termLabel(y, s)} อยู่แล้ว`;
  }
  return null;
}

/** ผลจาก GET /terms/preview ที่หน้านี้ใช้ */
export interface PreviewLike {
  requirements: number;
  teachers: number;
  periods_total: number;
  curricula: number;
  slots_to_clear: number;
}

/**
 * แถวของหน้าสรุปก่อนสร้าง — เฉพาะที่เซิร์ฟเวอร์ส่งมาจริง
 * (ไม่มีตัวเลข "วิชาใหม่" หรือ "ชุดคาบเสรี" ในคำตอบของเซิร์ฟเวอร์ จึงไม่แสดง ไม่เดา · สองตัวนี้มากับการส่งข้อมูลจากไซต์อัตรากำลัง (Plan 3) ไม่ใช่งานนี้)
 */
export function previewRows(p: PreviewLike): { label: string; value: number; note?: string }[] {
  return [
    { label: "แผนการสอน", value: p.requirements, note: "รายการ · ติดไปเทอมใหม่" },
    { label: "ครู", value: p.teachers, note: "คน · ติดไปเทอมใหม่" },
    { label: "คาบรวมตามแผน", value: p.periods_total, note: "คาบต่อสัปดาห์" },
    { label: "หลักสูตร", value: p.curricula, note: "ชุด · ติดไปเทอมใหม่" },
    { label: "คาบที่ลงตารางไว้ตอนนี้", value: p.slots_to_clear, note: "คาบ · จะถูกล้างในเทอมใหม่" },
  ];
}

/**
 * คำเตือนตัวหนาในหน้าสร้างเทอม — เทอมที่ใช้อยู่ถูกปิดและเทอมใหม่เริ่มจากตารางว่าง
 *
 * ยังไม่มีเทอมในฐานข้อมูล (active = null) ก็ยังมีของจะปิด: เซิร์ฟเวอร์จะเก็บ
 * ตารางที่ลงไว้เป็นเทอมของตัวเอง (สถานะปิด) ก่อนเปิดเทอมใหม่ คำเตือนต้องบอก
 * ตามนั้น ไม่ใช่พูดถึง "เทอมที่ใช้งานอยู่" ที่ยังไม่มีชื่อ
 */
export function newTermWarning(active: TermMeta | null): string {
  if (active === null) {
    return "กดแล้วตารางที่ลงไว้ตอนนี้จะถูกเก็บเป็นเทอมของตัวเองและปิด แก้ไม่ได้อีก"
      + " · คาบที่ลงไว้ทั้งหมดจะเริ่มจากว่างในเทอมใหม่";
  }
  return `กดแล้วเทอม ${active.label} จะถูกปิดและแก้ไม่ได้อีก · คาบที่ลงไว้ทั้งหมดจะเริ่มจากว่างในเทอมใหม่`;
}

// ── สร้างเทอมใหม่จากรอบอัตรากำลัง (ขั้นที่ 3 · แบบข้อ 4.5) ──────────────────────
// ไม่มีรอบเลย หรืออ่านรายการรอบไม่ได้ → หน้าต่างเป็นแบบเดิมทุกอย่าง ฟังก์ชันชุดนี้ใช้เฉพาะตอนมีรอบให้เลือก
// เซิร์ฟเวอร์เป็นคนตัดสินว่ารอบใช้ได้ไหม (usable/reasons คำนวณแบบเดียวกับตอนกดสร้างจริง) — ที่นี่แค่แสดง

/** หนึ่งแถวของ GET /terms/rounds (ใหม่ก่อน · ไม่มีข้อมูลรายแถว) */
export interface TermRound {
  id: number;
  label: string;
  year: number;
  semester: number;
  /** preparing | filling | closed */
  status: string;
  /** ส่งเข้าโปรแกรมแล้วเมื่อ (ISO) · ยังไม่ส่ง = null */
  exported_at: string | null;
  /** ชื่อเทอมที่รอบนี้ส่งเข้าไป ("2/2569") */
  exported_label: string | null;
  usable: boolean;
  /** เหตุที่ยังสร้างไม่ได้ เป็นภาษาไทย (ว่าง = ใช้ได้) */
  reasons: string[];
}

/** หนึ่งช่องที่จะถูกแก้ของครู/วิชาเดิมในโปรแกรม (Ruling T1 C4) — label = ชื่อไทยของช่องจากเซิร์ฟเวอร์ */
export interface RoundChange { field: string; label: string; old: unknown; new: unknown }

type Named = { id: number; name: string | null; code?: string | null; wl_id?: number | null };

/**
 * report ของหน้าดูก่อนสร้าง = export_report ที่เก็บในแถวรอบ (รูปเต็มอยู่ที่ _term_report ของเซิร์ฟเวอร์)
 * ตัวเลขนับแถว/คาบ · รายการ: จำนวน = ความยาว · ฟังก์ชันข้างล่างอ่านแบบไม่เชื่อรูป (ขาดช่อง = ว่าง ไม่ล้ม)
 */
export interface RoundReport {
  requirements: number;
  periods: number;
  teachers_in_plan: number;
  curricula: number;
  pools: number;
  pool_options: number;
  teachers_created: (Named & { department_id?: number | null })[];
  subjects_created: Named[];
  teachers_patched: (Named & { changes: RoundChange[] })[];
  subjects_patched: (Named & { changes: RoundChange[] })[];
  /** วิชาที่พิมพ์รหัสในเว็บแล้วผูกกับวิชาเดิมของโปรแกรมด้วยรหัส */
  code_links: Named[];
  /** ครูที่เว็บติ๊ก "ไม่ปฏิบัติงานแล้ว" แต่ยังเปิดอยู่ในโปรแกรม (ไม่ปิดให้) */
  inactive_open: Named[];
  /** ครู/วิชาที่ปิดใช้งานอยู่ในโปรแกรม แต่เทอมใหม่ใช้ (ไม่เปิดให้ — ให้เห็น) */
  inactive_teachers_used: Named[];
  inactive_subjects_used: Named[];
  /** ครูที่โปรแกรมมีแต่เว็บไม่รู้จัก (ไม่ทำอะไร) */
  unknown_teachers: (Named & { department_id?: number | null; active?: boolean })[];
  /** ชุดกิจกรรม — ต้องลงคาบเอง (ตารางของเทอมใหม่เริ่มว่าง) */
  activity_sets: { name: string; group_ids?: number[]; group_names: string[]; weekly: number;
    teacher_ids?: number[]; teacher_names: (string | null)[] }[];
  // ── แบบข้อ 4.2 (รีวิวทั้งสาขา M3) — ไม่มีในรายงานรุ่นก่อน จึงเป็นตัวเลือก ──
  /** ห้อง+วิชาที่ยกเซ็ตห้องย่อย/คาบที่ปักจากแผนเดิมไม่ได้ (แถวเดิมไม่ตรงกัน) */
  not_carried?: (RoundCell & { fields?: string[]; field_labels?: string[] })[];
  /** ห้อง+วิชาที่ไม่มีในแผนเดิม (ช่องที่เว็บไม่มีเริ่มว่าง) */
  new_cells?: RoundCell[];
  /** จำนวนแถวแผนของวิชาเสรี / กิจกรรมทั้งระดับที่สร้างตามรูปของแผนเดิม */
  elective_rows?: number;
  activity_rows?: number;
  pattern_rows?: (RoundCell & { kind: string; teacher_id?: number | null; teacher_name?: string | null;
    weekly_count?: number | null })[];
  /** วิชาที่ถูกเพิ่มเข้าหลักสูตรเพื่อให้แถวแผนข้างบนผ่านการตรวจหลักสูตร */
  curriculum_rows_added?: { curriculum_id?: number; curriculum_name?: string | null; subject_id?: number;
    code?: string | null; name?: string | null; weekly_count?: number }[];
}

/** หนึ่งห้อง+วิชาในรายงาน (ชื่อห้อง รหัส/ชื่อวิชามากับรายงาน) */
export interface RoundCell { group_id: number; subject_id: number; group_name?: string; code?: string | null;
  name?: string | null }

/** GET /terms/preview?round_id= — ตัวเลขเดิม 5 ตัว + ของรอบ */
export interface RoundPreview extends PreviewLike {
  round: { id: number; label: string; year: number; semester: number; usable: boolean; reasons: string[];
    report: RoundReport };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const items = <T>(v: unknown): T[] => (Array.isArray(v) ? v.filter((x) => typeof x === "object" && x !== null) : []);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const thaiNum = (n: number): string => n.toLocaleString("th-TH");

/** ป้ายในตัวเลือกรอบ: "ภาคเรียน 2/2569 · ใช้ได้" · "… · ยังใช้ไม่ได้" · "… · ส่งแล้ว (เทอม 2/2569)" */
export function roundOptionLabel(r: TermRound): string {
  const head = `ภาคเรียน ${r.label}`;
  if (r.exported_at) return `${head} · ส่งแล้ว (เทอม ${r.exported_label || r.label})`;
  return `${head} · ${r.usable ? "ใช้ได้" : "ยังใช้ไม่ได้"}`;
}

/** รอบที่ส่งแล้วแสดงในรายการแต่เลือกไม่ได้ (Ruling T3 C2) — รอบที่ใช้ไม่ได้ยังเลือกดูเหตุได้ (แบบข้อ 4.5) */
export function roundSelectable(r: Pick<TermRound, "exported_at">): boolean {
  return !r.exported_at;
}

/**
 * ภาคเรียนปัจจุบัน: เทอมที่เปิดในรายการเทอม · ยังไม่มีเทอมที่บันทึกไว้ (เว็บจริงตอนกดครั้งแรก) → ปี/ภาคในหน้าตั้งค่า
 * (ตามที่ปุ่มสร้างเทอมจะใช้เก็บตารางที่ลงไว้ — running_term_identity ของเซิร์ฟเวอร์) · บอกไม่ได้ → null
 */
export function runningTerm(
  active: Pick<TermMeta, "year" | "semester"> | null, config: { year?: string; term?: string } | null,
): { year: number; semester: number } | null {
  if (active) return { year: active.year, semester: active.semester };
  const y = (config?.year ?? "").trim();
  const t = (config?.term ?? "").trim();
  if (!/^\d{4}$/.test(y) || (t !== "1" && t !== "2")) return null;
  const year = Number(y);
  return year >= 2500 && year <= 2700 ? { year, semester: Number(t) } : null;
}

/**
 * ค่าเริ่มต้นของตัวเลือกรอบ (รีวิวทั้งสาขา M2): รอบที่ใช้ได้ของภาคเรียน "หลัง" ภาคเรียนปัจจุบัน (ที่ใกล้ที่สุด) ·
 * ไม่มี หรือบอกไม่ได้ว่าภาคเรียนปัจจุบันคืออะไร → null (ไม่เลือกรอบ — หน้าต่างใช้แผนเดิม)
 * ไม่ถอยไปรอบของภาคเรียนปัจจุบัน (ปุ่มจะเก็บตารางที่ลงไว้เป็นเทอมนั้น — สร้างซ้ำไม่ได้) หรือภาคเรียนที่ผ่านมา (จะปิดเทอมปัจจุบัน
 * แล้วเปิดเทอมเก่า) · รอบที่ส่งแล้วเลือกไม่ได้
 */
export function defaultTermRound(
  rounds: TermRound[], current: { year: number; semester: number } | null,
): TermRound | null {
  if (current === null) return null;
  const after = rounds.filter((r) => roundSelectable(r) && r.usable
    && (r.year > current.year || (r.year === current.year && r.semester > current.semester)));
  after.sort((a, b) => a.year - b.year || a.semester - b.semester);
  return after[0] ?? null;
}

/** ข้อความเดียวกับ TERM_ADMIN_CODE_MISSING ของเซิร์ฟเวอร์ (ตัวทดสอบเทียบกับ mock_api.py) */
export const TERM_ADMIN_CODE_MISSING =
  "กรอกรหัสผู้ดูแลระบบของเว็บลงอัตรากำลังเพื่อยืนยันการสร้างเทอมใหม่จากรอบอัตรากำลัง";

/**
 * ปุ่มสร้างจากรอบกดได้ไหม — คืนข้อความไทยของสิ่งที่ยังขาด หรือ null
 * ลำดับ: ไม่ได้เลือกรอบ → รอบส่งแล้ว/ใช้ไม่ได้ → ไม่ได้กรอกรหัส (ช่องว่างล้วนนับว่าไม่ได้กรอก เหมือนเซิร์ฟเวอร์)
 */
export function newTermFromRoundError(round: TermRound | null, code: string): string | null {
  if (round === null) return "เลือกรอบอัตรากำลังก่อน";
  if (round.exported_at) {
    return `รอบ ${round.label} ส่งเข้าโปรแกรมแล้ว (เทอม ${round.exported_label || round.label}) — ส่งซ้ำไม่ได้`;
  }
  if (!round.usable) return `รอบ ${round.label} ยังใช้ไม่ได้ — แก้ตามเหตุที่บอกไว้ก่อน แล้วค่อยกลับมาสร้าง`;
  if (code.trim() === "") return TERM_ADMIN_CODE_MISSING;
  return null;
}

/** ชุดกิจกรรมที่ต้องลงคาบเอง ทีละบรรทัด: "ชื่อชุด · ห้อง · N คาบ/สัปดาห์ · ครู" (รายงานไม่มี/ผิดรูป = ว่าง) */
export function activitySetLines(report: unknown): string[] {
  const sets = items<Record<string, unknown>>((report as { activity_sets?: unknown } | null | undefined)?.activity_sets);
  return sets.map((a) => {
    const groups = (Array.isArray(a.group_names) ? a.group_names : []).map(text).filter(Boolean);
    const teachers = (Array.isArray(a.teacher_names) ? a.teacher_names : []).map(text).filter(Boolean);
    return [text(a.name) || "ชุดกิจกรรม", groups.join(", ") || "ไม่ระบุห้อง", `${thaiNum(num(a.weekly))} คาบ/สัปดาห์`,
      teachers.length ? teachers.join(", ") : "ยังไม่มีครู"].join(" · ");
  });
}

export type RoundRowTone = "plain" | "warn" | "info";
/** หนึ่งบรรทัดของสรุปก่อนสร้างจากรอบ · items = รายการที่เปิดดูได้ ("ดูรายการ") */
export interface RoundPreviewRow { label: string; value: string; tone: RoundRowTone; items?: string[] }

const teacherText = (t: Named): string => {
  const name = text(t.name) || `ครูรหัส ${t.id}`;
  return text(t.code) ? `${name} (${text(t.code)})` : name;
};
const subjectText = (s: Named): string => `${text(s.code)} ${text(s.name)}`.trim() || `วิชารหัส ${s.id}`;

function changeValue(field: string, v: unknown, deptName?: (id: number) => string | undefined): string {
  if (v === null || v === undefined || v === "") return "ว่าง";
  if (typeof v === "boolean") return v ? "ใช่" : "ไม่ใช่";
  if (field === "duration" && (v === 1 || v === 2)) return v === 2 ? "ใช่" : "ไม่ใช่";   // ช่อง "คาบคู่"
  if (field === "department_id" && typeof v === "number") return deptName?.(v) ?? `กลุ่มสาระรหัส ${v}`;
  return String(v);
}

/** "ชื่อ · ช่อง: ค่าเดิม → ค่าใหม่ · …" (Ruling T1 C4 — โดยเฉพาะคาบคู่/วิชาเสรีที่กระทบยอดคาบและการจัดคาบ) */
function patchText(who: string, changes: unknown, deptName?: (id: number) => string | undefined): string {
  const parts = items<RoundChange>(changes).map((c) =>
    `${text(c.label) || c.field}: ${changeValue(c.field, c.old, deptName)} → ${changeValue(c.field, c.new, deptName)}`);
  return [who, ...parts].join(" · ");
}

/**
 * บรรทัดของสรุปก่อนสร้างจากรอบ (ภาพร่างแบบข้อ 4.5) — ค่า 0 ไม่ขึ้น ยกเว้นแถวแผน (แผนว่างต้องเห็นว่าว่าง)
 * ชุดกิจกรรมที่ต้องลงคาบเอง และครู/วิชาที่ปิดใช้งานในโปรแกรมแต่เทอมใหม่ใช้ = warn · ที่ไม่ทำอะไร = info
 * `deptName` แปลงรหัสกลุ่มสาระในรายการที่จะถูกแก้เป็นชื่อ (ไม่ส่ง = "กลุ่มสาระรหัส N")
 */
export function roundPreviewRows(
  p: RoundPreview, deptName?: (id: number) => string | undefined,
): RoundPreviewRow[] {
  const r = (p.round?.report ?? {}) as Partial<RoundReport>;
  const out: RoundPreviewRow[] = [
    { label: "แผนการสอน", value: `${thaiNum(num(r.requirements))} แถว`, tone: "plain" },
  ];
  const add = (label: string, n: number, unit: string, tone: RoundRowTone = "plain", list?: string[]) => {
    if (n > 0) out.push({ label, value: `${thaiNum(n)} ${unit}`, tone, ...(list ? { items: list } : {}) });
  };
  const named = (v: unknown) => items<Named>(v);
  add("คาบรวมตามแผน", num(r.periods), "คาบ/สัปดาห์");
  add("ครูในแผน", num(r.teachers_in_plan), "คน");
  add("หลักสูตร", num(r.curricula), "ชุด");
  const tCreated = named(r.teachers_created);
  add("ครูใหม่ที่จะสร้าง", tCreated.length, "คน", "plain", tCreated.map(teacherText));
  const sCreated = named(r.subjects_created);
  add("วิชาใหม่ที่จะสร้าง", sCreated.length, "วิชา", "plain", sCreated.map(subjectText));
  const tPatched = items<Named & { changes: unknown }>(r.teachers_patched);
  add("ครูที่จะถูกแก้ข้อมูล", tPatched.length, "คน", "plain",
    tPatched.map((t) => patchText(text(t.name) || `ครูรหัส ${t.id}`, t.changes, deptName)));
  const sPatched = items<Named & { changes: unknown }>(r.subjects_patched);
  add("วิชาที่จะถูกแก้ข้อมูล", sPatched.length, "วิชา", "plain",
    sPatched.map((s) => patchText(subjectText(s), s.changes, deptName)));
  const links = named(r.code_links);
  add("วิชาที่ผูกกับวิชาเดิมในโปรแกรมด้วยรหัสวิชา", links.length, "วิชา", "info", links.map(subjectText));
  if (num(r.pools) > 0) {
    out.push({ label: "ชุดคาบเสรี", tone: "plain",
      value: `${thaiNum(num(r.pools))} ชุด (${thaiNum(num(r.pool_options))} ตัวเลือก) · ยังไม่ลงคาบ` });
  }
  const acts = activitySetLines(r);
  add("ชุดกิจกรรมที่ต้องลงคาบเอง", acts.length, "ชุด", "warn", acts);
  // แบบข้อ 4.2 (รีวิวทั้งสาขา M3): สิ่งที่เทอมใหม่ได้ต่างจากรอบตรง ๆ — ให้เห็นก่อนกด (กระทบการจัดคาบ) แต่ไม่ต้องทำอะไร = info
  const cellText = (c: RoundCell): string =>
    `${text(c.group_name) || `ห้องรหัส ${c.group_id}`} · ${subjectText({ id: c.subject_id, code: c.code, name: c.name ?? null })}`;
  const pattern = items<NonNullable<RoundReport["pattern_rows"]>[number]>(r.pattern_rows);
  add("แถวแผนของวิชาเสรี/กิจกรรมที่สร้างตามรูปของแผนเดิม", num(r.elective_rows) + num(r.activity_rows), "แถว", "info",
    pattern.map((x) => [cellText(x), text(x.teacher_name) || "ยังไม่มีครู",
      `${thaiNum(num(x.weekly_count))} คาบ/สัปดาห์ (${x.kind === "activity" ? "กิจกรรม" : "คาบเสรี"})`].join(" · ")));
  const added = items<NonNullable<RoundReport["curriculum_rows_added"]>[number]>(r.curriculum_rows_added);
  add("วิชาที่ถูกเพิ่มเข้าหลักสูตร (ให้แถวแผนข้างบนผ่านการตรวจหลักสูตร)", added.length, "รายการ", "info",
    added.map((x) => `${text(x.curriculum_name) || "หลักสูตร"}: `
      + `${subjectText({ id: x.subject_id ?? 0, code: x.code, name: x.name ?? null })} · ${thaiNum(num(x.weekly_count))} คาบ/สัปดาห์`));
  const notCarried = items<NonNullable<RoundReport["not_carried"]>[number]>(r.not_carried);
  add("ห้อง+วิชาที่ยกเซ็ตห้องย่อย/คาบที่ปักจากแผนเดิมไม่ได้ (แถวเดิมไม่ตรงกัน — ปล่อยว่าง)", notCarried.length, "รายการ",
    "info", notCarried.map((c) => {
      const fields = (Array.isArray(c.field_labels) ? c.field_labels : []).map(text).filter(Boolean);
      return fields.length ? `${cellText(c)}: ${fields.join(", ")}` : cellText(c);
    }));
  const fresh = items<RoundCell>(r.new_cells);
  add("ห้อง+วิชาที่ไม่มีในแผนเดิม (เซ็ตห้องย่อย/คาบที่ปักเริ่มว่าง)", fresh.length, "รายการ", "info", fresh.map(cellText));
  const tOff = named(r.inactive_teachers_used);
  add("ครูที่ปิดใช้งานในโปรแกรม แต่อยู่ในเทอมใหม่", tOff.length, "คน", "warn", tOff.map(teacherText));
  const sOff = named(r.inactive_subjects_used);
  add("วิชาที่ปิดใช้งานในโปรแกรม แต่อยู่ในเทอมใหม่", sOff.length, "วิชา", "warn", sOff.map(subjectText));
  const left = named(r.inactive_open);
  add("ครูที่เว็บติ๊กว่าไม่ปฏิบัติงานแล้ว แต่ยังเปิดอยู่ในโปรแกรม", left.length, "คน (ไม่ปิดให้)", "info",
    left.map(teacherText));
  const unknown = named(r.unknown_teachers);
  add("ครูในโปรแกรมที่เว็บไม่รู้จัก", unknown.length, "คน (ไม่ทำอะไร)", "info", unknown.map(teacherText));
  add("คาบที่ลงตารางไว้ตอนนี้", num(p.slots_to_clear), "คาบ · จะถูกล้าง");
  return out;
}

/** ผลหลังสร้างจากรอบ: บอกชุดกิจกรรมที่ต้องลงคาบเอง และที่ที่เปิดดูได้อีก · ไม่มีชุดกิจกรรม = null */
export function roundCreatedNote(report: unknown): string | null {
  const n = activitySetLines(report).length;
  if (n === 0) return null;
  return `ชุดกิจกรรมที่ต้องลงคาบเอง ${thaiNum(n)} ชุด — ตารางของเทอมใหม่เริ่มว่าง ให้ลงคาบกิจกรรมเองในหน้าจัดตาราง `
    + "(รายการนี้เปิดดูได้อีกที่หน้ารอบของเว็บลงอัตรากำลัง)";
}

/**
 * อ่านรายการรอบไม่ได้ → บรรทัดเล็กที่ไม่ขวางอะไร (addendum ข้อ 4: หน้าต่างถอยเป็นแบบเดิม ปุ่มแบบเดิมกดได้)
 * 404 = เซิร์ฟเวอร์รุ่นก่อนขั้นที่ 3 ไม่มี route นี้ — ไม่มีอะไรต้องบอก (null)
 */
export function roundsLoadNote(e: unknown): string | null {
  if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
  const why = termErrorText(e, "");
  return `อ่านรายการรอบอัตรากำลังไม่ได้${why ? ` (${why})` : ""} — สร้างเทอมจากแผนเดิมได้ตามปกติ`;
}

/** ชื่อไฟล์ดาวน์โหลดของเทอม — "/" ใช้ในชื่อไฟล์ไม่ได้ */
export function termDownloadName(t: Pick<TermMeta, "label">): string {
  return `ตารางเรียน-เทอม-${t.label.replace(/[\\/:*?"<>|]/g, "-")}.json`;
}

/** ผู้ฟังใน TopNavbar: เปิดกล่องตัวเลือกการพิมพ์ของเทอมที่เพิ่งเปิดดู (ปุ่ม “ปริ้น” ในรายการเทอม) */
export const TERM_PRINT_EVENT = "term:print";

/** หนึ่งแถวของ GET /terms/stats */
export interface StatsRowLike {
  id: number;
  label: string;
  slots: number;
  by_department: Record<string, number>;
  by_teacher: Record<string, number>;
  rooms_used: number;
  subjects_open: number;
  error?: string;
}

export interface StatsLine {
  id: number;
  label: string;
  slots: number;
  teachers: number;
  rooms: number;
  subjects: number;
  /** คาบที่เพิ่ม/ลดจากเทอมก่อนหน้า — null = เทอมแรก หรือเทอมนี้หรือเทอมก่อนอ่านไม่ได้ */
  slotsDelta: number | null;
  error: string | null;
}

/** เรียงเก่าไปใหม่ตามเวลา (ปี แล้วภาค) แล้วคำนวณการเปลี่ยนแปลงจากเทอมก่อนหน้า */
export function statsLines(rows: StatsRowLike[], metas: TermMeta[] = []): StatsLine[] {
  const when = new Map(metas.map((t) => [t.id, t.year * 10 + t.semester]));
  const order = (r: StatsRowLike): number => when.get(r.id) ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...rows].sort((a, b) => order(a) - order(b) || a.id - b.id);
  const out: StatsLine[] = [];
  let prev: StatsLine | null = null;
  for (const r of sorted) {
    const bad = typeof r.error === "string" && r.error !== "";
    const line: StatsLine = {
      id: r.id, label: r.label, slots: r.slots ?? 0,
      teachers: Object.keys(r.by_teacher ?? {}).length,
      rooms: r.rooms_used ?? 0, subjects: r.subjects_open ?? 0,
      slotsDelta: prev === null || bad || prev.error !== null ? null : (r.slots ?? 0) - prev.slots,
      error: bad ? (r.error as string) : null,
    };
    out.push(line);
    prev = line;
  }
  return out;
}

/** ตารางกลุ่มสาระ × เทอม: ชื่อกลุ่มสาระเรียงตามตัวอักษร และจำนวนคาบของแต่ละเทอม (ไม่มี = 0) */
export function departmentMatrix(rows: StatsRowLike[], metas: TermMeta[] = []):
  { names: string[]; byTerm: { label: string; bad: boolean; counts: number[] }[] } {
  const lines = statsLines(rows, metas);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const names = [...new Set(rows.flatMap((r) => Object.keys(r.by_department ?? {})))]
    .sort((a, b) => a.localeCompare(b, "th"));
  return {
    names,
    byTerm: lines.map((l) => ({
      label: l.label,
      bad: l.error !== null,
      counts: names.map((n) => byId.get(l.id)?.by_department?.[n] ?? 0),
    })),
  };
}

/** "แก้ครั้งสุดท้าย" ของแถวในรายการ: เทอมที่ปิดคือเวลาที่ปิด เทอมที่ใช้อยู่ยังแก้ได้เรื่อย ๆ */
export function lastEditText(t: Pick<TermMeta, "status" | "closed_at">): string {
  if (t.status === "active") return "กำลังใช้งาน";
  const iso = t.closed_at;
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── โหมดอ่านอย่างเดียวบนหน้าจอ และป้ายชื่อเทอมบนใบพิมพ์ ───────────────────────

/** ตารางบนจอแก้ไม่ได้ไหม — ค่าของ prop readOnly ที่ส่งลงไปถึงทุกช่อง */
export function isReadOnly(viewing: TermMeta | null, terms: TermMeta[]): boolean {
  return !canEdit(viewing, activeTerm(terms) ?? null);
}

/**
 * ช่องภาคเรียน/ปีในหน้าตั้งค่าแก้ไม่ได้ไหม — มีเทอมอยู่แล้ว = เซิร์ฟเวอร์ไม่รับสองช่องนี้
 * (ถูกเพิกเฉย) หน้าจอจึงต้องเลิกทำเป็นว่าแก้ได้ ให้ไปเปลี่ยนที่หน้าเทอมแทน
 */
export function termFieldsLocked(available: boolean, terms: TermMeta[]): boolean {
  return available && terms.length > 0;
}

/**
 * ชื่อเทอมที่ใบพิมพ์ต้องขึ้น — เทอมที่ **กำลังดูอยู่** ไม่ใช่เทอมที่ใช้งานอยู่
 * (สเปกข้อทดสอบ 17) ไม่ได้ดูเทอมเก่าอยู่ = เทอมที่ใช้งาน ไม่มีเทอมเลย = undefined
 */
export function printTermName(viewing: TermMeta | null, terms: TermMeta[]): string | undefined {
  // กำลังดูเทอมที่ปิด: ชื่อของเทอมนั้นหรือไม่มีชื่อเลย ห้ามถอยไปใช้ชื่อเทอมที่ใช้งานอยู่
  // (ใบของเทอมเก่าที่ขึ้นชื่อเทอมปัจจุบัน คือความล้มเหลวของข้อทดสอบ 17 พอดี)
  if (viewing !== null) {
    const v = viewing.label?.trim();
    return v ? v : undefined;
  }
  const a = activeTerm(terms)?.label?.trim();
  return a ? a : undefined;
}

/** บอกเรื่องป้ายสถานะการบันทึกที่นิ่งอยู่ — มิฉะนั้นจะดูเหมือนบันทึกไม่สำเร็จ */
export const FROZEN_CHIP_NOTE =
  "ป้ายสถานะการบันทึกด้านบนหยุดอัปเดตระหว่างดูเทอมที่ปิดแล้ว — ไม่ได้แปลว่าบันทึกไม่สำเร็จ "
  + "เมื่อกลับไปเทอมปัจจุบันป้ายจะอัปเดตต่อเอง";

export interface BannerView {
  /** ข้อความหลักจาก termBanner() — null เมื่อไม่ได้ดูเทอมที่ปิด (มีแต่ข้อผิดพลาด) */
  text: string | null;
  /** คำอธิบายป้ายสถานะที่นิ่ง — มีเฉพาะตอนที่เทอมที่ปิดอยู่บนจอ */
  note: string | null;
  /** viewingError — ต้องมีที่แสดงเสมอ แม้ไม่ได้ดูเทอมที่ปิด (เปิดไม่สำเร็จ) */
  error: string | null;
}

/** แถบที่ติดค้างบนหัวจอ — null = ไม่ต้องแสดงอะไรเลย */
export function bannerView(
  viewing: TermMeta | null, active: TermMeta | null, error: string | null,
): BannerView | null {
  const text = termBanner(viewing, active);
  const err = error && error.trim() ? error : null;
  if (text === null && err === null) return null;
  return { text, note: text === null ? null : FROZEN_CHIP_NOTE, error: err };
}
