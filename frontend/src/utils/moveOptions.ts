/**
 * moveOptions — "คาบนี้ย้ายไปไหนได้บ้าง" พร้อมบอกว่าแต่ละที่ง่ายหรือยาก
 *
 *   "มันมีปัญหาคือย้ายแล้วย้ายไม่สุด คือฉันต้องย้ายคนไปเรื่อยๆ มันงงมาก …
 *    คลิกคาบที่ต้องการย้ายจะมีให้ขึ้นว่าสลับไปคาบไหนง่าย ปลายกลางยาก ซึ่ง
 *    แน่นอนต้องใช้เวลาในการคำนวณหลายๆทางไม่ใช่ทางเดี่ยว"
 *
 * ของเดิมตอบได้แค่ "ถ้าลากไปช่องนี้ จะเกิดอะไรขึ้น" — ต้องเล็งเองทีละช่อง และ
 * พอเลือกทางที่ต้องเบียดคนอื่น ก็ต้องไปตามเก็บคนที่ถูกเบียดต่ออีกทอด
 *
 * ตัวนี้ถามคำถามกลับด้าน: เอาคาบนี้เป็นตัวตั้ง แล้วลองทุกช่องในสัปดาห์ให้ครบ
 * ช่องละหลายทาง เสร็จแล้วเรียงจากง่ายไปยาก พร้อมแผนเต็มของแต่ละช่องที่ลงมือ
 * ได้ในครั้งเดียว ไม่ต้องไล่เบียดเอง
 *
 * ความยากวัดจาก "ต้องขยับคาบอื่นกี่คาบ" ซึ่งเป็นสิ่งที่คนจัดตารางรู้สึกจริง ๆ
 * ไม่ใช่คะแนนภายในของตัววางเส้นทาง
 */
import type { Period, Room, StudentGroup, Teacher, TimetableSlot } from "../types";
import { buildCtx, planRoutesIn, type Ctx, type SwapRoute } from "./swapPlanner";
import { chainToSteps, findChain, type ChainOpts } from "./chainMove";
import { levelKeyOf, periodsForLevel } from "./levels";
import { flattenGroups } from "./groupHierarchy";

export type MoveDifficulty = "ง่าย" | "ปานกลาง" | "ยาก" | "ยากมาก" | "ไม่ได้";

export const DIFFICULTY_ORDER: MoveDifficulty[] =
  ["ง่าย", "ปานกลาง", "ยาก", "ยากมาก", "ไม่ได้"];

export interface MoveOption {
  day:    number;
  period: number;
  difficulty: MoveDifficulty;
  /** ต้องขยับคาบของคนอื่นกี่คาบ — 0 คือไม่ต้องยุ่งกับใครเลย */
  others: number;
  /** แผนเต็มที่จะลงมือ — null เมื่อไปไม่ได้ */
  route: SwapRoute | null;
  /** ห้องที่คาบนี้จะได้ถ้าย้ายไปช่องนี้ */
  roomName: string | null;
  why: string;
}

export interface MoveOptionsResult {
  options: MoveOption[];
  /** ช่องที่ลองทั้งหมด (ไม่นับช่องที่ตัวเองอยู่) */
  tried:   number;
  /** เวลาที่ใช้คิด หน่วยมิลลิวินาที */
  ms:      number;
}

/** คาบอื่นที่แผนนี้ต้องขยับ — นับเป็นคาบ ไม่ใช่นับขั้นตอน */
function othersMoved(route: SwapRoute, movingId: number): number {
  const ids = new Set<number>();
  for (const st of route.steps) {
    if (st.slotId === movingId) continue;
    if (st.action === "move" && st.cellChanged) ids.add(st.slotId);
    if (st.action === "delete") ids.add(st.slotId);
  }
  return ids.size;
}

function gradeOf(route: SwapRoute | null, others: number): MoveDifficulty {
  if (!route || !route.feasible) return "ไม่ได้";
  // ทางที่ต้องลบคาบคนอื่นทิ้งไม่ใช่ "ทางที่ยาก" แต่เป็นทางที่ไม่ควรเสนอ
  if (route.kind === "force" || route.steps.some((s) => s.action === "delete")) {
    return "ไม่ได้";
  }
  if (others === 0) return "ง่าย";
  if (others === 1) return "ปานกลาง";
  if (others <= 3) return "ยาก";
  return "ยากมาก";
}

function reasonOf(route: SwapRoute | null, others: number,
                  grade: MoveDifficulty): string {
  if (grade === "ไม่ได้") {
    if (!route) return "ไม่มีทางลงช่องนี้";
    if (route.kind === "force" || route.steps.some((s) => s.action === "delete")) {
      return "ลงได้ก็ต่อเมื่อลบคาบของคนอื่นทิ้ง";
    }
    return route.warnings[0] ?? "ยังมีคาบที่ชนกันเหลืออยู่";
  }
  if (others === 0) {
    return route?.kind === "room-only"
      ? "ช่องว่าง แค่เปลี่ยนห้องให้"
      : "ช่องว่างอยู่แล้ว ไม่ต้องขยับใคร";
  }
  if (others === 1) {
    const one = route?.steps.find((s) => s.slotId !== route.steps[0].slotId
      && s.action === "move" && s.cellChanged);
    return one ? `สลับกับ ${one.label}` : "ขยับคาบอื่นหนึ่งคาบ";
  }
  return `ต้องขยับคาบอื่น ${others} คาบต่อกันเป็นทอด`;
}

/**
 * ทุกช่องที่คาบนี้ไปได้ เรียงจากง่ายไปยาก
 *
 * ctx สร้างครั้งเดียวแล้วใช้ซ้ำทุกช่อง — ตารางจริงมีคาบสองพันกว่าคาบ ถ้า
 * สร้างใหม่ทุกช่องจะกลายเป็นงานสี่สิบเท่าต่อการคลิกหนึ่งครั้ง
 */
export function moveOptions(
  moving:   TimetableSlot,
  slots:    TimetableSlot[],
  rooms:    Room[],
  teachers: Teacher[],
  periods:  Period[],
  groups:   StudentGroup[] = [],
  subjects: { id: number; department_id?: number | null }[] = [],
  numDays = 5,
  chain: ChainOpts = {},
): MoveOptionsResult {
  const t0 = Date.now();
  const ctx: Ctx = buildCtx(slots, rooms, teachers, periods, groups, numDays, subjects);
  return moveOptionsIn(ctx, moving, periods, groups, t0, chain);
}

/** เหมือน moveOptions แต่ใช้ Ctx ที่สร้างไว้แล้ว */
/** ลองเบียดต่อเป็นทอดจนสุดทาง แล้วทำเป็นทางเลือกหนึ่ง */
function deepOption(
  ctx: Ctx, moving: TimetableSlot, day: number, period: number,
  periods: Period[], groups: StudentGroup[], chain: ChainOpts,
): MoveOption | null {
  const found = findChain(ctx, moving, day, period, periods, groups, chain);
  if (!found) return null;
  const steps = chainToSteps(ctx, found);
  const mine = steps.find((st) => st.slotId === moving.id);
  const route: SwapRoute = {
    id: `chain-${day}-${period}`,
    kind: "chain",
    title: `เบียดต่อ ${found.others} คาบ`,
    summary: `ขยับคาบอื่น ${found.others} คาบต่อกันเป็นทอด แล้วคาบนี้ลงได้`,
    steps,
    risk: found.others <= 2 ? "medium" : "risky",
    score: 100 + found.others * 10,
    feasible: true,
    warnings: steps.some((st) => st.noRoomAvailable)
      ? ["มีคาบที่หาห้องว่างให้ไม่ได้ — ต้องไปเลือกห้องเอง"] : [],
  };
  const grade = gradeOf(route, found.others);
  return {
    day, period, difficulty: grade, others: found.others, route,
    roomName: mine?.toRoomName ?? moving.room_name ?? null,
    why: reasonOf(route, found.others, grade),
  };
}

export function moveOptionsIn(
  ctx:     Ctx,
  moving:  TimetableSlot,
  periods: Period[],
  groups:  StudentGroup[] = [],
  startedAt = Date.now(),
  chain:   ChainOpts = {},
): MoveOptionsResult {
  // ชั้นนี้เรียนคาบไหนได้บ้าง — ม.ต้นกับ ม.ปลายพักกันคนละเวลา ช่องที่อีกระดับ
  // มีแต่ชั้นนี้ไม่มี ไม่ใช่ "ทางที่ยาก" แต่เป็นช่องที่ไม่มีอยู่จริง
  const owner = flattenGroups(groups).find((g) => g.id === moving.group_id);
  const level = levelKeyOf(owner);
  const nums = periodsForLevel(periods, level)
    .filter((p) => p.type === "class")
    .map((p) => p.period_num);

  const out: MoveOption[] = [];
  let tried = 0;
  for (let day = 0; day < ctx.numDays; day++) {
    for (const period of nums) {
      if (day === moving.day && period === moving.period) continue;
      tried++;
      const routes = planRoutesIn(ctx, moving, day, period);
      // ทางที่ดีที่สุดของช่องนี้ = ทางที่ไปได้และขยับคนอื่นน้อยที่สุด
      let best: MoveOption | null = null;
      for (const route of routes) {
        const others = othersMoved(route, moving.id);
        const grade = gradeOf(route, others);
        const mine = route.steps.find((s) => s.slotId === moving.id);
        const cand: MoveOption = {
          day, period, difficulty: grade, others, route,
          roomName: mine?.toRoomName ?? moving.room_name ?? null,
          why: reasonOf(route, others, grade),
        };
        if (!best || betterThan(cand, best)) best = cand;
      }
      // ตัววางเส้นทางเดิมลองได้แค่สองชั้น พอตันก็เสนอให้ลบคาบคนอื่นทิ้ง
      // ซึ่งไม่ใช่คำตอบ — ช่องแบบนั้นส่งให้ตัวเดินแบบเขาวงกตลองต่อเป็นทอด
      if (!best || best.difficulty === "ไม่ได้") {
        const deep = deepOption(ctx, moving, day, period, periods, groups, chain);
        if (deep) best = deep;
      }
      out.push(best ?? {
        day, period, difficulty: "ไม่ได้", others: 0, route: null,
        roomName: null, why: "ไม่มีทางลงช่องนี้",
      });
    }
  }

  out.sort((a, b) =>
    rank(a) - rank(b)
    || a.others - b.others
    || a.day - b.day
    || a.period - b.period);

  return { options: out, tried, ms: Date.now() - startedAt };
}

const rank = (o: MoveOption): number => DIFFICULTY_ORDER.indexOf(o.difficulty);

function betterThan(a: MoveOption, b: MoveOption): boolean {
  if (rank(a) !== rank(b)) return rank(a) < rank(b);
  if (a.others !== b.others) return a.others < b.others;
  const sa = a.route?.score ?? Number.POSITIVE_INFINITY;
  const sb = b.route?.score ?? Number.POSITIVE_INFINITY;
  return sa < sb;
}

/** นับว่าแต่ละระดับความยากมีกี่ช่อง — ไว้โชว์เป็นสรุปด้านบน */
export function countByDifficulty(
  options: MoveOption[],
): Record<MoveDifficulty, number> {
  const out = {} as Record<MoveDifficulty, number>;
  for (const d of DIFFICULTY_ORDER) out[d] = 0;
  for (const o of options) out[o.difficulty] += 1;
  return out;
}
