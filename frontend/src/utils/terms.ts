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
    const periods = active.slots === null ? "" : ` (ลงคาบไว้ ${active.slots} คาบ)`;
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
 */
export function canRetryCreate(e: unknown): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 400 || status === 409;
}

/**
 * ข้อความไทยที่ผู้ใช้ควรเห็น: ที่เซิร์ฟเวอร์ส่งมา (400/404/409/503) หรือที่ร้านโยนเอง
 * (Error ภาษาไทยที่ไม่ได้มาจากเครือข่าย เช่นข้อความของด่านกันแก้ไข) มิฉะนั้นข้อความสำรอง
 * ข้อความอังกฤษของ axios ("Request failed with status code 500") ไม่เคยถูกส่งต่อ
 */
export function termErrorText(e: unknown, fallback: string): string {
  const r = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  if (!r && e instanceof Error && /[\u0E00-\u0E7F]/.test(e.message)) return e.message;
  const d = r?.data?.detail;
  const ok = r?.status === 400 || r?.status === 404 || r?.status === 409 || r?.status === 503;
  return ok && typeof d === "string" && d.trim() ? d : fallback;
}

/** ผลของการสร้างเทอม ในรูปที่ไม่ต้องพึ่ง axios */
export interface CreateResultLike {
  closed: { label: string; slots: number | null } | null;
  active: { label: string };
  save_error?: string | null;
  save_pending?: boolean;
}

/**
 * บอกผลการสร้างเทอม (หรือปลดล็อก — verb) โดยไม่พูดว่า "บันทึกแล้ว"
 *
 * `save_error: null` ไม่ได้พิสูจน์ว่าเขียนลงฐานข้อมูลแล้ว เซิร์ฟเวอร์แค่ใส่คิวไว้
 * (`save_pending: true` = ยังอยู่ระหว่างส่ง) คำตอบจริงอยู่ที่ป้ายสถานะการบันทึกบนแถบ
 * ด้านบน ซึ่งอ่านจาก /state/version
 */
export function createOutcome(
  r: CreateResultLike, verb: "สร้าง" | "ปลดล็อก" = "สร้าง",
): { tone: "info" | "warn" | "error"; text: string } {
  const closed = r.closed
    ? ` เทอม ${r.closed.label} ถูกปิดแล้ว (${r.closed.slots ?? 0} คาบ)`
    : "";
  const head = `${verb}เทอม ${r.active.label} แล้ว${closed}`;
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

/** คำเตือนตัวหนาในหน้าสร้างเทอม — เทอมที่ใช้อยู่ถูกปิดและเทอมใหม่เริ่มจากตารางว่าง */
export function newTermWarning(active: TermMeta | null): string {
  const old = active === null ? "เทอมที่ใช้งานอยู่" : `เทอม ${active.label}`;
  return `กดแล้ว${old}จะถูกปิดและแก้ไม่ได้อีก · คาบที่ลงไว้ทั้งหมดจะเริ่มจากว่างในเทอมใหม่`;
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
  const v = viewing?.label?.trim();
  if (v) return v;
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
