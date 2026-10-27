/**
 * ดึงคาบมาลงช่องว่างของห้องนี้
 *
 *   "ห้องหมวดว่างแล้ว ต้องการให้ครูหมวดวิทย์เข้าไปให้ได้ คือมีโหมดที่ช่วยเวลา
 *    กดคาบว่างของห้อง สามารถเจาะจงวิชาของครูคนนั้นให้มาลงได้ โดยจะสลับห้องให้
 *    ลงได้ไม่ว่าจะยาวขนาดไหน จะเลื่อนครูกี่คน"
 *
 * กลับทางกับโหมดนำทาง (guidedMove) — ตรงนั้นถามว่า "คาบนี้ไปไหนได้"
 * ตรงนี้ถามว่า "ช่องนี้เอาคาบไหนมาลงได้" แล้วเปิดทางให้
 *
 * ── สิ่งที่วัดได้จากตารางจริง (26 ต.ค. · คาบ 2,735) ─────────────────────
 * ห้องแล็บวิทย์มี 5 ห้อง แต่ "234 ห้องกลุ่มวิทย์" ตั้งไว้ว่าใช้สอนไม่ได้
 * (usable=false) เหลือใช้จริง 4 ห้อง ว่างรวม 76 ช่อง
 *
 * และทั้งสี่ห้อง **กันไว้ให้ครูเฉพาะกลุ่ม** (reserved_teacher_ids) ห้องละ 2–3 คน
 * คาบของครูหมวดวิทย์คนอื่นจึงลงไม่ได้เลย ไม่ว่าจะไล่สลับยังไง — นี่คือเหตุผล
 * ที่แล็บว่างทั้งที่มีคาบวิทย์ 268 คาบนั่งอยู่ห้องอื่น ตัวนี้จึงไม่ได้แค่ซ่อน
 * คาบที่ลงไม่ได้ทิ้ง แต่บอกออกมาว่าติดเพราะอะไร จะได้ไปแก้ที่ต้นเหตุถูก
 *
 * ใน 76 ช่องนั้น 21 ช่องมีครูที่ใช้ห้องได้สอนอยู่เวลานั้นพอดีแต่ไปนั่งห้องอื่น
 * — แค่เปลี่ยนห้องก็จบ ไม่มีใครต้องเลื่อน ที่เหลือต้องดึงมาจากเวลาอื่น
 */
import type { Period, Room, StudentGroup, Teacher, TimetableSlot } from "../types";
import { blockersAt, buildCtx, roomTakes, type Ctx } from "./swapPlanner";
import { levelKeyOf, periodsForLevel, roomReservedFor } from "./levels";

export interface FillWorld {
  slots:    TimetableSlot[];
  rooms:    Room[];
  teachers: Teacher[];
  periods:  Period[];
  groups:   StudentGroup[];
  subjects?: { id: number; department_id?: number | null }[];
}

/** หนึ่งคาบที่เอามาลงช่องนี้ได้ */
export interface FillCandidate {
  slot: TimetableSlot;
  /**
   * ย้ายห้อง = สอนอยู่เวลานี้พอดีอยู่แล้ว เปลี่ยนแค่ห้อง ไม่มีใครต้องเลื่อน
   * ย้ายเวลา = อยู่เวลาอื่น ต้องย้ายมา ชั้นกับครูต้องว่างตรงนี้ ไม่ว่างก็ต้องไล่
   */
  kind: "ย้ายห้อง" | "ย้ายเวลา";
  /** ถ้าย้ายมา ใครต้องหาที่ใหม่บ้าง (ว่างอยู่แล้ว = ไม่มีใคร) */
  blockers: TimetableSlot[];
  /** มีคาบที่ล็อกไว้ขวาง — ทางนี้ไปไม่ได้จนกว่าจะปลดล็อก */
  lockedBy: TimetableSlot | null;
  /**
   * เป็นครึ่งหนึ่งของคาบคู่ — เซิร์ฟเวอร์จะพาอีกครึ่งตามมาด้วยเสมอ
   *
   * ถ้าปลายทางไม่มีคาบที่ติดกันจริงให้อีกครึ่งลง ทั้งชุดจะถูกปฏิเสธตอนกดลงมือ
   * (ไม่ใช่ย้ายครึ่งเดียวแล้วคาบคู่ขาด) จึงบอกไว้ตั้งแต่ตอนเลือก
   */
  isDouble: boolean;
  note:  string;
  score: number;
}

export interface FillPlan {
  room: Room | null;
  /** โรงเรียนตั้งไว้ว่าห้องนี้ใช้สอนไม่ได้ */
  unusable: boolean;
  /** ห้องนี้ถูกจองอยู่ในช่องนั้นแล้ว (ไม่ใช่ช่องว่าง) */
  taken: TimetableSlot | null;
  /** ห้องกันไว้ให้ครูกลุ่มนี้เท่านั้น (ว่าง = ใครก็ใช้ได้) */
  reservedFor: Teacher[];
  /** ห้องนี้เป็นห้องเฉพาะของหมวดนี้ */
  onlyDept: number | null;
  candidates: FillCandidate[];
  /** เจอทั้งหมดกี่รายการก่อนตัดตาม limit */
  found: number;
  /**
   * ถ้าห้องนี้ไม่ได้กันไว้ให้ครูเฉพาะกลุ่ม จะมีคาบ**ให้เลือก**อีกกี่คาบ
   *
   * นับเฉพาะคาบที่ลงช่องนี้ได้โดยไม่ต้องเบียดใครเลย (สอนอยู่เวลานั้นพอดี หรือ
   * ชั้นกับครูว่างตรงนี้อยู่แล้ว) ไม่นับคาบที่ต้องไล่สลับยาว ๆ — ไม่งั้นเลขจะ
   * เป็นจำนวนคาบทั้งหมวดและไม่ได้บอกอะไร
   *
   * เป็น "จำนวนที่ให้เลือก" ไม่ใช่ "จำนวนที่จะย้ายมา" — ช่องหนึ่งลงได้คาบเดียว
   */
  blockedByReservation: number;
  /** ทำไมไม่มีอะไรให้เลือก — ว่างแปลว่ามีให้เลือก */
  why: string;
}

export interface FillQuery {
  /** เอาเฉพาะหมวดนี้ (null = ทุกหมวด) */
  deptId?:    number | null;
  /** เอาเฉพาะครูคนนี้ */
  teacherId?: number | null;
  /** ค้นชื่อครู รหัสวิชา ชื่อวิชา หรือชั้น */
  text?:      string;
}

/** ห้องนี้ว่างจริงไหมในช่องนั้น */
export function roomIsFree(
  slots: TimetableSlot[], roomId: number, day: number, period: number,
): boolean {
  return !slots.some((s) => s.room_id === roomId && s.day === day && s.period === period);
}

/** คาบนี้เป็นคาบเรียนของชั้นนั้นจริงไหม (ม.ต้น/ม.ปลาย ใช้ผังคาบคนละอัน) */
function isClassPeriod(
  world: FillWorld, slot: TimetableSlot, period: number,
): boolean {
  const group = flat(world.groups).find((g) => g.id === slot.group_id);
  return periodsForLevel(world.periods, levelKeyOf(group))
    .some((p) => p.type === "class" && p.period_num === period);
}

function flat(groups: StudentGroup[]): StudentGroup[] {
  const out: StudentGroup[] = [];
  const walk = (list: StudentGroup[]) => {
    for (const g of list) { out.push(g); walk(g.children ?? []); }
  };
  walk(groups);
  return out;
}

function lbl(s: TimetableSlot): string {
  return `${s.group_name ?? "?"} ${s.subject_code ?? ""}`.trim();
}

/**
 * คาบที่เอามาลงช่อง (วัน, คาบ) ของห้องนี้ได้ เรียงจากทางที่เจ็บน้อยที่สุด
 *
 * ไม่เสนอคาบที่ห้องนี้ไม่รับ (แล็บของหมวดอื่น ห้องที่กันไว้ให้ครูคนอื่น ห้องที่
 * โรงเรียนบอกว่าใช้สอนไม่ได้) — กฎเดียวกับตัวเลือกห้องอัตโนมัติ แต่จะนับไว้ว่า
 * ที่ตกไปเพราะ "กันห้อง" มีกี่คาบ เพื่อบอกคนใช้ว่าติดตรงไหน
 */
export function fillPlan(
  world: FillWorld, roomId: number, day: number, period: number,
  q: FillQuery = {}, limit = 40,
): FillPlan {
  const room = world.rooms.find((r) => r.id === roomId) ?? null;
  const base: FillPlan = {
    room, unusable: false, taken: null, reservedFor: [], onlyDept: null,
    candidates: [], found: 0, blockedByReservation: 0, why: "",
  };
  if (!room) return { ...base, why: "ไม่พบห้องนี้" };

  const kept = roomReservedFor(room);
  base.reservedFor = kept
    .map((id) => world.teachers.find((t) => t.id === id))
    .filter((t): t is Teacher => t != null);
  base.onlyDept = room.specialized_dept_id ?? null;

  if (room.usable === false || (room.capacity ?? 1) <= 0) {
    return { ...base, unusable: true,
             why: "โรงเรียนตั้งไว้ว่าห้องนี้ใช้สอนไม่ได้ — แก้ได้ที่หน้าจัดการห้อง" };
  }
  const taken = world.slots.find(
    (s) => s.room_id === roomId && s.day === day && s.period === period) ?? null;
  if (taken) {
    return { ...base, taken,
             why: `ช่องนี้ไม่ว่าง — ${lbl(taken)} ใช้ห้องนี้อยู่` };
  }

  const ctx: Ctx = buildCtx(world.slots, world.rooms, world.teachers,
                            world.periods, world.groups, 5, world.subjects);
  const deptOf = new Map((world.subjects ?? []).map((s) => [s.id, s.department_id ?? null]));
  const text = (q.text ?? "").trim().toLowerCase();
  const keptSet = new Set(kept);

  const out: FillCandidate[] = [];
  let blockedByReservation = 0;
  for (const s of world.slots) {
    if (s.is_locked) continue;                       // ล็อกไว้ = ไม่ใช่ตัวเลือก
    if (q.deptId != null && deptOf.get(s.subject_id as number) !== q.deptId) continue;
    if (q.teacherId != null && s.teacher_id !== q.teacherId) continue;
    if (text && ![s.teacher_name, s.subject_code, s.subject_name, s.group_name]
        .some((v) => (v ?? "").toLowerCase().includes(text))) continue;
    // ช่องนี้ต้องเป็นคาบเรียนของชั้นนั้นจริง ไม่ใช่ช่วงที่ชั้นนั้นพักกลางวัน
    if (!isClassPeriod(world, s, period)) continue;

    // ติดเพราะกันห้องไว้ให้ครูคนอื่น — นับไว้บอก ไม่ใช่เงียบหาย
    if (keptSet.size && (s.teacher_id == null || !keptSet.has(s.teacher_id))) {
      const easy = (s.day === day && s.period === period)
        || blockersAt(ctx, s, day, period, new Set<number>()).length === 0;
      if (easy && roomTakes({ ...room, reserved_teacher_ids: [] } as Room, s, world.subjects)) {
        blockedByReservation++;
      }
      continue;
    }
    if (!roomTakes(room, s, world.subjects)) continue;

    if (s.day === day && s.period === period) {
      out.push({
        slot: s, kind: "ย้ายห้อง", blockers: [], lockedBy: null,
        isDouble: !!s.double_group_key,
        note: `ตอนนี้อยู่ ${s.room_name ?? "ไม่มีห้อง"} — ย้ายมาห้องนี้ได้เลย ไม่มีใครต้องเลื่อน`
          + (s.double_group_key ? " · คาบคู่ อีกครึ่งจะย้ายห้องตามมาด้วย" : ""),
        score: 0,
      });
      continue;
    }

    const blockers = blockersAt(ctx, s, day, period, new Set<number>());
    const locked = blockers.find((b) => b.is_locked) ?? null;
    out.push({
      slot: s, kind: "ย้ายเวลา", blockers, lockedBy: locked,
      isDouble: !!s.double_group_key,
      note: (s.double_group_key ? "คาบคู่ — อีกครึ่งจะตามมาด้วย · " : "") + (locked
        ? `🔒 ${lbl(locked)} ล็อกไว้ตรงนี้ — ปลดล็อกก่อนถึงจะดึงมาได้`
        : blockers.length === 0
        ? "ชั้นและครูว่างตรงนี้อยู่แล้ว — ย้ายมาได้เลย"
        : blockers.length === 1
        ? `ต้องหาที่ใหม่ให้ ${lbl(blockers[0])} อีก 1 คาบ`
        : `ต้องหาที่ใหม่ให้อีก ${blockers.length} คาบ`),
      // คาบคู่เสี่ยงกว่า เพราะอีกครึ่งต้องมีคาบติดกันให้ลงด้วย จึงถอยไปท้ายแถว
      score: (locked ? 9000 : 100 + blockers.length * 10)
        + (s.double_group_key ? 5 : 0),
    });
  }
  out.sort((a, b) => a.score - b.score
    || (a.slot.group_name ?? "").localeCompare(b.slot.group_name ?? "")
    || a.slot.day - b.slot.day || a.slot.period - b.slot.period);

  const why = out.length ? "" : whyNothing(base, blockedByReservation, q);
  return { ...base, candidates: out.slice(0, limit), found: out.length,
           blockedByReservation, why };
}

function whyNothing(p: FillPlan, blocked: number, q: FillQuery): string {
  if (blocked > 0 && p.reservedFor.length) {
    return `ห้องนี้กันไว้ให้ ${p.reservedFor.map((t) => t.name).join(" · ")} เท่านั้น`
      + ` — ถ้าเลิกกันห้อง จะมีคาบให้เลือกลงช่องนี้อีก ${blocked} คาบ`
      + " โดยไม่ต้องเบียดใคร (แก้ได้ที่ ⚙ จัดการ › ห้องเรียน)";
  }
  if (p.reservedFor.length) {
    return `ห้องนี้กันไว้ให้ ${p.reservedFor.map((t) => t.name).join(" · ")} เท่านั้น`
      + " และตอนนี้ไม่มีคาบของครูกลุ่มนี้ที่ย้ายมาช่องนี้ได้";
  }
  if (q.teacherId != null || q.deptId != null || (q.text ?? "").trim()) {
    return "ไม่มีคาบที่ตรงกับที่กรองไว้ — ลองเอาตัวกรองออกดู";
  }
  return "ไม่มีคาบไหนย้ายมาช่องนี้ได้";
}

/** หมวดที่มีคาบลงช่องนี้ได้จริง — ไว้ทำตัวเลือกหมวดที่ไม่มีช่องตายให้กด */
export function deptsWithCandidates(
  world: FillWorld, roomId: number, day: number, period: number,
): Set<number> {
  const deptOf = new Map((world.subjects ?? []).map((s) => [s.id, s.department_id ?? null]));
  const out = new Set<number>();
  for (const c of fillPlan(world, roomId, day, period, {}, Number.MAX_SAFE_INTEGER).candidates) {
    const d = deptOf.get(c.slot.subject_id as number);
    if (d != null) out.add(d);
  }
  return out;
}

/** ครูที่มีคาบลงช่องนี้ได้ — ไว้ทำตัวเลือก "เจาะจงครูคนนี้" */
export function teachersWithCandidates(
  world: FillWorld, roomId: number, day: number, period: number, deptId?: number | null,
): { id: number; name: string; n: number }[] {
  const by = new Map<number, number>();
  for (const c of fillPlan(world, roomId, day, period, { deptId },
                           Number.MAX_SAFE_INTEGER).candidates) {
    const t = c.slot.teacher_id;
    if (t != null) by.set(t, (by.get(t) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([id, n]) => ({
      id, n, name: world.teachers.find((t) => t.id === id)?.name ?? `ครู #${id}`,
    }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}
