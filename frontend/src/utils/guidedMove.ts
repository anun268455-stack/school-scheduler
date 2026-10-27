/**
 * โหมดนำทางการจัดคาบ — เลือกเองทีละขั้น ว่าคาบนี้ไปไหน แล้วใครไปไหนต่อ
 *
 *   "ฉันย้ายคาบครูคนนี้แต่ก็จะติดไปเรื่อยๆ คุณช่วยแบบว่าเข้าโหมดนี้แล้วเลือก
 *    คาบนี้จะไปยังคาบนี้พอ แบบนี้แล้วก็จะมีทางเลือกในการเลื่อนหลายๆแยกก็สร้าง
 *    ขึ้นมาเพื่อให้ฉันเลือก"
 *
 * ต่างจาก "เส้นทางการแทนที่" (swapPlanner) ที่คิดทั้งเส้นให้เสร็จแล้วให้เลือก
 * เส้นสำเร็จรูป — โหมดนี้เดินทีละขั้น: คาบที่ถูกเบียดออกมากลายเป็นคาบที่ต้อง
 * หาที่ให้ต่อ และทุกขั้นมีทางแยกให้คนเลือกเอง พร้อมบอกว่าแต่ละทางจะจบในขั้นนี้
 * หรือยังต้องไปต่อ
 *
 * กฎว่า "ใครขวางใคร" และ "ห้องไหนว่าง" ใช้ของ swapPlanner ตัวเดียวกัน จึงไม่มี
 * ทางที่สองหน้าจะบอกคนละอย่างในสถานการณ์เดียวกัน
 */
import type { Period, Room, StudentGroup, Teacher, TimetableSlot } from "../types";
import { blockersAt, buildCtx, pickRoom, type Ctx } from "./swapPlanner";
import { levelKeyOf, periodsForLevel } from "./levels";
import { slotLabel } from "./teacherSlots";

/** หนึ่งการย้ายที่ถูกเลือกไว้แล้ว (ยังไม่ลงมือ) */
export interface GuidedStep {
  slotId:   number;
  label:    string;
  fromDay:  number;
  fromPeriod: number;
  day:      number;
  period:   number;
  roomId:   number | null;
  roomName: string | null;
  /** ย้ายคาบนี้แล้วทำให้ใครต้องหาที่ใหม่ */
  displacedIds: number[];
}

/** หนึ่งทางเลือกของขั้นนี้ */
export interface GuidedOption {
  day:    number;
  period: number;
  roomId: number | null;
  roomName: string | null;
  /** คาบที่จะถูกเบียดออกถ้าเลือกทางนี้ */
  displaced: TimetableSlot[];
  /** ว่าง = จบในขั้นนี้ · สลับ = คาบที่ถูกเบียดลงช่องที่เพิ่งว่างได้พอดี */
  kind:   "ว่าง" | "สลับ" | "เบียด";
  /** ถ้าเลือกทางนี้ คาบที่ถูกเบียดยังมีที่ว่างให้ไปอีกกี่ช่อง (0 = ทางตัน) */
  roomToMove: number;
  note:   string;
  score:  number;
}

export interface GuidedPlan {
  /** คาบที่กำลังหาที่ให้ในขั้นนี้ */
  moving:  TimetableSlot | null;
  /** ขั้นที่เลือกไว้แล้ว เรียงตามลำดับที่เลือก */
  steps:   GuidedStep[];
  options: GuidedOption[];
  /** จบแล้วไหม — ไม่มีคาบที่ค้างต้องหาที่ให้ */
  done:    boolean;
}

export interface GuidedWorld {
  slots:    TimetableSlot[];
  rooms:    Room[];
  teachers: Teacher[];
  periods:  Period[];
  groups:   StudentGroup[];
  subjects?: { id: number; department_id?: number | null }[];
}

/** ตารางเสมือน หลังทำตามขั้นที่เลือกไว้แล้ว (ยังไม่แตะของจริง) */
export function previewSlots(
  slots: TimetableSlot[], steps: GuidedStep[], rooms: Room[],
): TimetableSlot[] {
  if (!steps.length) return slots;
  const by = new Map(steps.map((s) => [s.slotId, s]));
  return slots.map((s) => {
    const m = by.get(s.id);
    if (!m) return s;
    const r = rooms.find((x) => x.id === m.roomId);
    return { ...s, day: m.day, period: m.period, room_id: m.roomId,
             room_name: r?.name ?? null, room_type: r?.type ?? s.room_type };
  });
}

/** ช่องของห้องเรียนนี้ที่เป็นคาบเรียนจริง (ตามชั้นของห้อง) */
function cellsFor(
  world: GuidedWorld, slot: TimetableSlot,
): { day: number; period: number }[] {
  const group = flat(world.groups).find((g) => g.id === slot.group_id);
  const nums = periodsForLevel(world.periods, levelKeyOf(group))
    .filter((p) => p.type === "class")
    .map((p) => p.period_num);
  const out: { day: number; period: number }[] = [];
  for (let d = 0; d < 5; d++) for (const p of nums) out.push({ day: d, period: p });
  return out;
}

function flat(groups: StudentGroup[]): StudentGroup[] {
  const out: StudentGroup[] = [];
  const walk = (list: StudentGroup[]) => {
    for (const g of list) { out.push(g); walk(g.children ?? []); }
  };
  walk(groups);
  return out;
}

/**
 * ทางเลือกของคาบนี้ — ไปช่องไหนได้ และแต่ละช่องจะเบียดใครออก
 *
 * `steps` คือขั้นที่เลือกไว้แล้ว ซึ่งนับเป็น "เกิดขึ้นแล้ว" ตอนคิดขั้นถัดไป
 * จึงไม่มีทางที่สองขั้นแย่งช่องเดียวกัน และคาบที่ย้ายออกไปแล้วไม่ขวางใคร
 */
export function optionsFor(
  world: GuidedWorld, moving: TimetableSlot, steps: GuidedStep[], limit = 8,
): GuidedOption[] {
  return trimOptions(allOptions(world, moving, steps), limit);
}

/** ทางเลือกทั้งหมด ไม่ตัด — หน้าจอใช้ระบายสีทุกช่องที่เลือกได้ */
export function optionsAll(
  world: GuidedWorld, moving: TimetableSlot, steps: GuidedStep[],
): GuidedOption[] {
  return allOptions(world, moving, steps);
}

/**
 * ตัดให้เหลือเท่าที่อ่านไหว — คิดทางเลือกครั้งเดียวแล้วเอาไปใช้ทั้งรายการและ
 * การระบายสี ไม่ต้องคิดซ้ำสองรอบต่อการคลิกหนึ่งครั้ง
 */
export function trimOptions(all: GuidedOption[], limit: number): GuidedOption[] {
  const keep = all.slice(0, limit);
  // ต้องมีทุกชนิดอย่างน้อยอย่างละหนึ่ง — ช่องว่างมีเป็นสิบ ถ้าตัดตามคะแนนเฉย ๆ
  // "สลับกับคาบนี้" ซึ่งเป็นคำตอบที่คนมองหาจะหลุดออกไปทุกครั้ง
  for (const kind of ["สลับ", "เบียด"] as const) {
    if (keep.some((o) => o.kind === kind)) continue;
    const best = all.find((o) => o.kind === kind);
    if (best) keep[Math.max(0, keep.length - 1)] = best;
  }
  return keep.sort((a, b) => a.score - b.score || a.day - b.day || a.period - b.period);
}

/** ช่องเดียว: ถ้าเอาคาบนี้ไปวางที่นั่น จะเกิดอะไร — null คือวางไม่ได้เลย */
export function verdictAt(
  world: GuidedWorld, moving: TimetableSlot, steps: GuidedStep[],
  day: number, period: number,
): GuidedOption | null {
  return allOptions(world, moving, steps)
    .find((o) => o.day === day && o.period === period) ?? null;
}

function allOptions(
  world: GuidedWorld, moving: TimetableSlot, steps: GuidedStep[],
): GuidedOption[] {
  const now = previewSlots(world.slots, steps, world.rooms);
  const live = now.find((s) => s.id === moving.id) ?? moving;
  const ctx: Ctx = buildCtx(now, world.rooms, world.teachers, world.periods,
                            world.groups, 5, world.subjects);
  // คาบที่ถูกเลือกย้ายแล้วในขั้นก่อน ๆ ไม่ต้องถูกนับว่าขวาง เพราะมันกำลังย้าย
  const movingIds = new Set<number>([live.id]);
  // ช่องที่เพิ่งว่างจากขั้นก่อน ๆ — คาบที่ลงช่องนั้นได้ถือว่า "สลับ" คือจบ
  const freed = new Set(steps.map((s) => `${s.fromDay}-${s.fromPeriod}`));
  // คาบที่ตกลงที่อยู่ใหม่ไว้แล้วในเส้นทางนี้ ห้ามถูกเบียดอีก ไม่งั้นจะวนกลับไป
  // ล้มขั้นที่เพิ่งเลือก และเส้นทางจะมีคาบเดียวกันสองที่อยู่ ซึ่งอ่านไม่รู้เรื่อง
  // และสั่งย้ายจริงไม่ได้ ("ย้ายคาบนี้แต่ก็จะติดไปเรื่อยๆ" ต้องมีวันจบ)
  const settled = new Set(steps.map((s) => s.slotId));

  const out: GuidedOption[] = [];
  for (const cell of cellsFor(world, live)) {
    if (cell.day === live.day && cell.period === live.period) continue;
    const blockers = blockersAt(ctx, live, cell.day, cell.period, movingIds);
    // ล็อกไว้ = ห้ามแตะ ไม่ใช่ทางเลือก · ที่อยู่ใหม่ที่ตกลงไว้แล้วก็เหมือนกัน
    if (blockers.some((b) => b.is_locked || settled.has(b.id))) continue;
    const roomId = pickRoom(ctx, live, cell.day, cell.period, now.filter(
      (s) => !blockers.some((b) => b.id === s.id)));
    const roomName = world.rooms.find((r) => r.id === roomId)?.name ?? null;

    // คาบที่ถูกเบียด ยังมีที่ไปอีกกี่ช่อง — บอกว่าทางนี้ตันไหม
    let roomToMove = 0;
    if (blockers.length) {
      const after = [...steps, {
        slotId: live.id, label: slotLabel(live), fromDay: live.day,
        fromPeriod: live.period, day: cell.day, period: cell.period,
        roomId, roomName, displacedIds: blockers.map((b) => b.id),
      }];
      const nextWorld = previewSlots(world.slots, after, world.rooms);
      const nextCtx = buildCtx(nextWorld, world.rooms, world.teachers,
                               world.periods, world.groups, 5, world.subjects);
      const b0 = nextWorld.find((s) => s.id === blockers[0].id) ?? blockers[0];
      const skip = new Set<number>([b0.id, live.id]);
      roomToMove = cellsFor(world, b0).filter((c) =>
        !(c.day === b0.day && c.period === b0.period)
        && blockersAt(nextCtx, b0, c.day, c.period, skip).length === 0).length;
    }

    const kind: GuidedOption["kind"] = blockers.length === 0
      ? "ว่าง"
      : (blockers.length === 1 && freed.has(`${live.day}-${live.period}`) === false
         && canTake(ctx, blockers[0], live.day, live.period, movingIds))
      ? "สลับ"
      : "เบียด";

    const note = kind === "ว่าง"
      ? "ช่องนี้ว่าง — จบในขั้นนี้"
      : kind === "สลับ"
      ? `สลับกับ ${slotLabel(blockers[0])} — จบในขั้นนี้`
      : blockers.length === 1
      ? `ต้องหาที่ให้ ${slotLabel(blockers[0])} ต่อ`
      : `ต้องหาที่ให้อีก ${blockers.length} คาบ`;

    out.push({
      day: cell.day, period: cell.period, roomId, roomName,
      displaced: blockers, kind, roomToMove,
      note: roomToMove === 0 && blockers.length ? `${note} (ยังไม่เห็นช่องว่างให้)` : note,
      score: (kind === "ว่าง" ? 0 : kind === "สลับ" ? 1 : 2) * 100
        + blockers.length * 10
        + (blockers.length && roomToMove === 0 ? 50 : 0)
        + (roomId == null ? 5 : 0),
    });
  }
  out.sort((a, b) => a.score - b.score || a.day - b.day || a.period - b.period);
  return out;
}

/** คาบนี้ลงช่องนั้นได้เลยไหม (ไม่มีใครขวาง) */
function canTake(
  ctx: Ctx, slot: TimetableSlot, day: number, period: number, ignore: Set<number>,
): boolean {
  return blockersAt(ctx, slot, day, period, ignore).length === 0;
}

/** เลือกทางนี้ — คืนขั้นที่เพิ่มเข้าไป และคาบที่ต้องหาที่ให้ต่อ */
export function chooseOption(
  world: GuidedWorld, moving: TimetableSlot, steps: GuidedStep[], opt: GuidedOption,
): { steps: GuidedStep[]; next: TimetableSlot | null } {
  const now = previewSlots(world.slots, steps, world.rooms);
  const live = now.find((s) => s.id === moving.id) ?? moving;
  const step: GuidedStep = {
    slotId: live.id,
    label: slotLabel(live),
    fromDay: live.day,
    fromPeriod: live.period,
    day: opt.day,
    period: opt.period,
    roomId: opt.roomId,
    roomName: opt.roomName,
    displacedIds: opt.displaced.map((d) => d.id),
  };
  const nextSteps = [...steps, step];
  if (!opt.displaced.length) return { steps: nextSteps, next: null };

  // คาบที่ถูกเบียดคาบแรกคือคาบที่ต้องหาที่ให้ต่อ — ถ้าลงช่องที่เพิ่งว่างได้พอดี
  // (การสลับ) ก็ปิดเส้นทางให้เลยในขั้นเดียว
  const b = opt.displaced[0];
  if (opt.kind === "สลับ") {
    // ห้องต้องเลือกบนตารางหลังจากที่คาบแรกย้ายออกไปแล้ว ไม่ใช่บนตารางเปล่า
    // ไม่งั้นจะได้ห้องที่ยังมีคนใช้อยู่
    const after = previewSlots(world.slots, nextSteps, world.rooms);
    const ctx = buildCtx(after, world.rooms, world.teachers, world.periods,
                         world.groups, 5, world.subjects);
    const roomId = pickRoom(ctx, b, live.day, live.period,
                            after.filter((s) => s.id !== b.id));
    nextSteps.push({
      slotId: b.id, label: slotLabel(b), fromDay: b.day, fromPeriod: b.period,
      day: live.day, period: live.period, roomId,
      roomName: world.rooms.find((r) => r.id === roomId)?.name ?? null,
      displacedIds: [],
    });
    return { steps: nextSteps, next: null };
  }
  return { steps: nextSteps, next: b };
}
