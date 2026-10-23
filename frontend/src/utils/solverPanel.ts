/**
 * ค่าที่ตั้งไว้ในปุ่ม ⚡ สร้างตาราง — อ่านและใช้ที่เดียว
 *
 * ปุ่ม "🔧 แก้เฉพาะห้องที่เลือก" ต้องจัดด้วยกติกาเดียวกับ ⚡ ที่โรงเรียนตั้งไว้
 * (สอนติดกันสูงสุดกี่คาบ · คาบสุดท้ายของวัน · วิชาที่ข้าม) ไม่อย่างนั้นห้องที่
 * แก้แล้วอาจได้คาบสุดท้ายทั้งที่โรงเรียนสั่ง "ไม่ใช้เลย" ไว้ จึงให้ทั้งสองปุ่ม
 * อ่านค่าจากที่นี่ และประกอบคำสั่งไปตัวจัดจากฟังก์ชันเดียวกัน
 */
import type { SolverResult } from "../types";

/** How much of the problem list to leave out of a run. */
export type SkipMode = "none" | "blocking" | "all";

/**
 * คาบสุดท้ายของวัน — how freely the solver may use it.
 *
 * "ช่วยทำให้ไม่มีคาบ 9 เลย เพราะยังมีคาบว่างอยู่ ... ถ้าระบบลงไม่ได้จริงๆ
 *  ก็ไม่ต้องลงให้ เพราะเดี๋ยวฉันจะไปกำหนดเอง"
 */
export type LastMode = "reserve" | "never" | "free";

export const LAST_MODE_LABEL: Record<LastMode, string> = {
  reserve: "ใช้เมื่อจำเป็น",
  never:   "ไม่ใช้เลย",
  free:    "ใช้ได้ตามปกติ",
};

/**
 * The panel's settings and its last result, kept across open and close.
 *
 * Everything here used to live in the component, and the component is
 * unmounted the moment the panel is closed — so the result of a run, with its
 * list of what could not be placed and the แนวทางแก้ beneath it, was thrown
 * away by clicking anywhere else, and the only way back to it was to run the
 * whole thing again. The settings went with it.
 *
 * localStorage, because it should also survive a reload: the school reads
 * this list, goes off to fix a timetable, and comes back to it.
 */
export const KEEP = "solver.panel.v1";

export interface Kept {
  clearExisting: boolean; maxConsec: number; minLast: number; maxLast: number;
  lastMode: LastMode;
  skipMode: SkipMode; manual: Record<number, boolean>;
  result: SolverResult | null; ranAt: string | null;
}

export const BLANK: Kept = {
  clearExisting: true, maxConsec: 3, minLast: 1, maxLast: 3,
  lastMode: "reserve",
  skipMode: "blocking", manual: {}, result: null, ranAt: null,
};

export function readKept(): Kept {
  try {
    const raw = localStorage.getItem(KEEP);
    return raw ? { ...BLANK, ...JSON.parse(raw) } : BLANK;
  } catch {
    return BLANK;        // private window, full disk, anything — never fatal
  }
}

export function writeKept(v: Kept) {
  try { localStorage.setItem(KEEP, JSON.stringify(v)); } catch { /* fine */ }
}

/** Does the current setting leave this requirement out of a run? */
export function isSkippedBy(
  p: { requirement_id: number; severity: "blocking" | "warning" },
  skipMode: SkipMode,
  manual: Record<number, boolean>,
): boolean {
  if (p.requirement_id in manual) return manual[p.requirement_id];
  return skipMode === "all" || (skipMode === "blocking" && p.severity === "blocking");
}

/** "สอนติดกันสูงสุด 3 คาบ · คาบสุดท้ายของวัน: ใช้เมื่อจำเป็น" — ค่าที่ ⚡ ตั้งไว้ตอนนี้ */
export function describeSettings(s: Pick<Kept, "maxConsec" | "lastMode">): string {
  return `สอนติดกันสูงสุด ${s.maxConsec} คาบ · `
    + `คาบสุดท้ายของวัน: ${LAST_MODE_LABEL[s.lastMode ?? "reserve"] ?? LAST_MODE_LABEL.reserve}`;
}

/** The options both buttons hand to the store's runSolver. */
export function solveOptionsOf(
  s: Pick<Kept, "maxConsec" | "minLast" | "maxLast" | "lastMode">,
  excludeRequirementIds: number[],
) {
  return {
    excludeRequirementIds,
    maxConsecutive:    s.maxConsec,
    preferConsecutive: Math.min(2, s.maxConsec),
    minLastPeriod:     s.minLast,
    maxLastPeriod:     s.maxLast,
    lastPeriodMode:    s.lastMode ?? "reserve",
  };
}
