/**
 * chainMove — เบียดต่อเป็นทอดจนสุดทาง แล้วคืนแผนทั้งชุดมาให้ลงมือทีเดียว
 *
 *   "ย้ายแล้วย้ายไม่สุด คือฉันต้องย้ายคนไปเรื่อยๆ มันงงมากถ้าทำโดยมนุษย์ …
 *    ต้องใช้เวลาในการคำนวณหลายๆทางไม่ใช่ทางเดี่ยว"
 *
 * ตัววางเส้นทางเดิมลองได้แค่สองชั้น: ถ้าคนที่ขวางอยู่สลับที่กับเราไม่ได้ หรือ
 * ขยับไปช่องว่างเฉย ๆ ไม่ได้ มันก็ยอมแพ้แล้วเสนอ "ลบคาบคนอื่นทิ้ง" แทน บน
 * ตารางจริงครึ่งหนึ่งของช่องจบลงแบบนั้น ซึ่งคือเหตุที่ต้องมานั่งไล่เบียดเอง
 *
 * ตัวนี้เดินแบบหาทางออกจากเขาวงกต: ลองวาง ถ้าชนก็ไปหาที่ให้คนที่ชนก่อน ถ้าที่
 * นั้นก็ชนอีกก็หาต่อไปอีกทอด เจอทางตันก็ถอยกลับมาลองทางอื่น จำไว้ว่าใครถูก
 * ขยับไปแล้วบ้างจะได้ไม่ย้ายคนเดิมซ้ำจนวน และมีเพดานทั้งความลึกและจำนวนครั้ง
 * ที่ลอง เพื่อให้ตอบกลับภายในเวลาที่กดแล้วไม่รู้สึกว่าค้าง
 *
 * สิ่งที่ได้คือ "แผนทั้งชุด" ไม่ใช่ขั้นแรกของแผน — กดครั้งเดียวจบ
 */
import type { Period, StudentGroup, TimetableSlot } from "../types";
import { blockersAt, mkStep, pickRoom, type Ctx, type RouteStep } from "./swapPlanner";
import { levelKeyOf, periodsForLevel } from "./levels";
import { flattenGroups } from "./groupHierarchy";

export interface ChainMove {
  slot:       TimetableSlot;
  toDay:      number;
  toPeriod:   number;
}

export interface ChainResult {
  /** คาบตัวตั้งอยู่ท้ายสุดเสมอ — คนที่ถูกเบียดต้องย้ายก่อน */
  moves:   ChainMove[];
  /** ต้องขยับคาบของคนอื่นกี่คาบ */
  others:  number;
  /** ลองไปกี่ครั้ง — ไว้ดูว่าหนักแค่ไหน */
  tried:   number;
  /** ชนเพดานการค้นหาไหม (ถ้าชน แปลว่าอาจมีทางอื่นที่ยังไม่ได้ลอง) */
  hitLimit: boolean;
}

export interface ChainOpts {
  /** เบียดต่อกันได้ลึกสุดกี่ทอด */
  maxDepth?: number;
  /** ลองได้มากสุดกี่ครั้งก่อนยอมแพ้ */
  budget?:   number;
  /** ในแต่ละทอด ลองช่องปลายทางมากสุดกี่ช่อง */
  branch?:   number;
}

type Board = Map<string, TimetableSlot[]>;

const key = (day: number, period: number): string => `${day}-${period}`;

function cloneBoard(src: Board): Board {
  const out: Board = new Map();
  for (const [k, v] of src) out.set(k, v.slice());
  return out;
}

/** ช่องที่ชั้นของคาบนี้เรียนได้ — ม.ต้นกับ ม.ปลายพักคนละเวลา */
function cellsFor(
  slot: TimetableSlot, periods: Period[], groups: StudentGroup[], numDays: number,
): { day: number; period: number }[] {
  const owner = flattenGroups(groups).find((g) => g.id === slot.group_id);
  const nums = periodsForLevel(periods, levelKeyOf(owner))
    .filter((p) => p.type === "class")
    .map((p) => p.period_num);
  const out: { day: number; period: number }[] = [];
  for (let day = 0; day < numDays; day++) {
    for (const period of nums) out.push({ day, period });
  }
  return out;
}

/**
 * หาทางเบียดให้ `moving` ลงช่อง (day, period) ให้ได้
 *
 * คืน null เมื่อหาไม่เจอภายในเพดานที่ให้ — ซึ่งแปลว่า "ยังไม่เจอ" ไม่ใช่
 * "ไม่มีทาง" ถ้าเพิ่มเพดานอาจเจอ และ hitLimit บอกไว้ว่าชนเพดานหรือหมดทางจริง
 */
export function findChain(
  ctx:     Ctx,
  moving:  TimetableSlot,
  day:     number,
  period:  number,
  periods: Period[],
  groups:  StudentGroup[] = [],
  opts:    ChainOpts = {},
): ChainResult | null {
  const maxDepth = opts.maxDepth ?? 4;
  const branch   = opts.branch ?? 6;
  let budget     = opts.budget ?? 4000;
  let hitLimit   = false;

  const board = cloneBoard(ctx.atCell);
  const view: Ctx = { ...ctx, atCell: board };
  // ที่อยู่ปัจจุบันของคาบที่ถูกขยับไปแล้ว — slot.day/period เป็นที่เดิมเสมอ
  const now = new Map<number, { day: number; period: number }>();
  const settled = new Set<number>();
  // ช่องที่จองไว้แล้วระหว่างเดิน
  //
  // ตอนยกคนที่ขวางออกไปหาที่ใหม่ ช่องที่ตัวตั้งกำลังจะลงยังว่างอยู่ (เพราะตัวตั้ง
  // ถูกยกออกไปแล้วและยังไม่ได้วางกลับ) เขาจึงย้ายเข้าไปนั่งตรงนั้นได้ แล้วพอวาง
  // ตัวตั้งทับลงไปก็กลายเป็นสองคาบในช่องเดียวโดยไม่มีใครฟ้อง
  const claimed = new Set<string>();
  const journal: { id: number; from: string; to: string | null; slot: TimetableSlot }[] = [];
  const result: ChainMove[] = [];
  const cellCache = new Map<number, { day: number; period: number }[]>();

  const posOf = (s: TimetableSlot) => now.get(s.id) ?? { day: s.day, period: s.period };

  function lift(s: TimetableSlot): void {
    const p = posOf(s);
    const k = key(p.day, p.period);
    const list = board.get(k);
    if (list) {
      const i = list.indexOf(s);
      if (i >= 0) list.splice(i, 1);
    }
    journal.push({ id: s.id, from: k, to: null, slot: s });
  }

  function drop(s: TimetableSlot, d: number, p: number): void {
    const k = key(d, p);
    const list = board.get(k);
    if (list) list.push(s); else board.set(k, [s]);
    now.set(s.id, { day: d, period: p });
    journal.push({ id: s.id, from: k, to: k, slot: s });
  }

  function rollbackTo(mark: number): void {
    while (journal.length > mark) {
      const entry = journal.pop()!;
      if (entry.to === null) {
        // เคยยกออก → เอากลับเข้าที่เดิม
        const list = board.get(entry.from);
        if (list) list.push(entry.slot); else board.set(entry.from, [entry.slot]);
      } else {
        // เคยวางลง → ยกออก
        const list = board.get(entry.to);
        if (list) {
          const i = list.indexOf(entry.slot);
          if (i >= 0) list.splice(i, 1);
        }
        now.delete(entry.slot.id);
      }
    }
  }

  function candidates(s: TimetableSlot): { day: number; period: number }[] {
    let cells = cellCache.get(s.id);
    if (!cells) {
      cells = cellsFor(s, periods, groups, ctx.numDays);
      cellCache.set(s.id, cells);
    }
    const here = posOf(s);
    const scored: { day: number; period: number; n: number }[] = [];
    for (const c of cells) {
      if (c.day === here.day && c.period === here.period) continue;
      if (claimed.has(key(c.day, c.period))) continue;
      const n = blockersAt(view, s, c.day, c.period, settled).length;
      scored.push({ ...c, n });
    }
    // ช่องที่ว่างอยู่แล้วก่อน แล้วค่อยช่องที่ต้องเบียดน้อยที่สุด
    scored.sort((a, b) => a.n - b.n || a.day - b.day || a.period - b.period);
    return scored.slice(0, branch);
  }

  function attempt(s: TimetableSlot, d: number, p: number, depth: number): boolean {
    if (budget <= 0) { hitLimit = true; return false; }
    budget -= 1;

    const blockers = blockersAt(view, s, d, p, settled);
    // คาบที่ล็อกไว้ และคาบที่ตกลงที่อยู่ไปแล้ว ขยับไม่ได้
    if (blockers.some((b) => b.is_locked || settled.has(b.id))) return false;
    if (blockers.length > 0 && depth >= maxDepth) { hitLimit = true; return false; }

    const mark = journal.length;
    const addedResult = result.length;
    const spot = key(d, p);
    if (claimed.has(spot)) return false;
    settled.add(s.id);
    claimed.add(spot);
    lift(s);

    for (const b of blockers) {
      let moved = false;
      for (const c of candidates(b)) {
        if (attempt(b, c.day, c.period, depth + 1)) { moved = true; break; }
      }
      if (!moved) {
        settled.delete(s.id);
        claimed.delete(spot);
        rollbackTo(mark);
        result.length = addedResult;
        return false;
      }
    }

    drop(s, d, p);
    result.push({ slot: s, toDay: d, toPeriod: p });
    return true;
  }

  const started = opts.budget ?? 4000;
  if (!attempt(moving, day, period, 0)) return null;
  return {
    moves: result,
    others: result.length - 1,
    tried: started - budget,
    hitLimit,
  };
}

/**
 * แปลงแผนเป็นขั้นตอนที่หน้าจอกับร้านค้าสถานะใช้ได้ พร้อมแจกห้องให้
 *
 * แจกห้องหลังจากรู้ที่อยู่สุดท้ายของทุกคาบแล้ว ไม่ใช่ระหว่างเดิน — ระหว่างเดิน
 * ยังไม่รู้ว่าใครจะไปจบที่ไหน การจองห้องตอนนั้นจึงจองผิดคน
 */
export function chainToSteps(ctx: Ctx, chain: ChainResult): RouteStep[] {
  const dest = new Map<number, { day: number; period: number }>();
  for (const m of chain.moves) dest.set(m.slot.id, { day: m.toDay, period: m.toPeriod });

  // ภาพรวมหลังย้ายเสร็จ — คาบที่ไม่ได้ขยับอยู่ที่เดิม
  const after: TimetableSlot[] = ctx.slots.map((s) => {
    const d = dest.get(s.id);
    return d ? { ...s, day: d.day, period: d.period } : s;
  });

  const taken = new Map<string, Set<number>>();
  for (const s of after) {
    if (dest.has(s.id) || s.room_id == null) continue;
    const k = key(s.day, s.period);
    const set = taken.get(k) ?? new Set<number>();
    set.add(s.room_id);
    taken.set(k, set);
  }

  const steps: RouteStep[] = [];
  for (const m of chain.moves) {
    const k = key(m.toDay, m.toPeriod);
    const used = taken.get(k) ?? new Set<number>();
    let room: number | null = m.slot.room_id ?? null;
    if (room == null || used.has(room)) {
      const occupying = after.filter((s) => s.day === m.toDay && s.period === m.toPeriod
        && s.id !== m.slot.id && s.room_id != null && used.has(s.room_id));
      room = pickRoom(ctx, m.slot, m.toDay, m.toPeriod, occupying);
    }
    if (room != null) {
      used.add(room);
      taken.set(k, used);
    }
    steps.push(mkStep(ctx, m.slot, m.toDay, m.toPeriod, room, "move"));
  }
  return steps;
}
