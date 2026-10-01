/**
 * swapPlanner.ts — Replacement-route planner (เส้นทางการแทนที่).
 *
 * When a user drops slot X onto a target cell that is already occupied, this
 * module produces several concrete "routes" to resolve the collision. Each route
 * is an explicit, ordered list of moves showing exactly:
 *   • which teacher/subject moves,
 *   • from which (day, period) to which (day, period),
 *   • and — crucially — which ROOM they will end up in (and whether the room
 *     number changes).
 *
 * The planner is deterministic and side-effect free: it only reads the current
 * snapshot and returns plans. Applying a plan is done separately in the store.
 */
import type { Room, Teacher, TimetableSlot, Period, StudentGroup } from "../types";
import { buildSharesStudents, type SharesStudents } from "./groupHierarchy";

// ── A single concrete move inside a route ────────────────────────────────────
export interface RouteStep {
  slotId:      number;
  label:       string;          // "คณิตศาสตร์ (ครูสมชาย)"
  teacherName: string;
  fromDay:     number;
  fromPeriod:  number;
  toDay:       number;
  toPeriod:    number;
  fromRoomId:  number | null;
  toRoomId:    number | null;
  fromRoomName: string | null;
  toRoomName:   string | null;
  roomChanged:  boolean;
  cellChanged:  boolean;
  noRoomAvailable: boolean;     // true → could not find any free room at destination
  action:      "move" | "room-only" | "delete";
}

export type RouteKind =
  | "direct"      // target empty — just place
  | "room-only"   // only a room clash — reassign a room, nobody moves cell
  | "two-way"     // classic A↔B swap
  | "relocate"    // bump the blocker to another free cell
  | "force";      // overwrite (delete blocker) — last resort

export interface SwapRoute {
  id:       string;
  kind:     RouteKind;
  title:    string;             // short human title
  summary:  string;             // one-line explanation
  steps:    RouteStep[];
  risk:     "safe" | "medium" | "risky";
  score:    number;             // lower = better (used for sorting)
  feasible: boolean;            // false → shown but disabled (leftover hard conflict)
  warnings: string[];
}

// ── Context passed once, reused across helpers ───────────────────────────────
interface Ctx {
  slots:    TimetableSlot[];
  rooms:    Room[];
  teachers: Teacher[];
  periods:  Period[];
  classPeriodNums: number[];
  numDays:  number;
  shares:   SharesStudents;
}

function roomName(ctx: Ctx, id: number | null): string | null {
  if (id == null) return null;
  return ctx.rooms.find((r) => r.id === id)?.name ?? null;
}

/**
 * Pick the best room for `slot` if it were placed at (day, period), given a set
 * of slots we treat as "already occupying" rooms there. Preference order:
 *   1. the teacher's fixed/home room, if free and allowed
 *   2. the slot's current room, if free and allowed
 *   3. any free room whose type matches the current room type
 *   4. any free room at all
 * Returns null only if literally no room is free.
 */
function pickRoom(
  ctx: Ctx,
  slot: TimetableSlot,
  day: number,
  period: number,
  occupying: TimetableSlot[],
): number | null {
  const busy = new Set(
    occupying
      .filter((s) => s.day === day && s.period === period && s.room_id != null && s.id !== slot.id)
      .map((s) => s.room_id as number),
  );
  const teacher = ctx.teachers.find((t) => t.id === slot.teacher_id);

  const allowed = (r: Room): boolean => {
    if (busy.has(r.id)) return false;
    // A room reserved for another teacher is off-limits.
    if (r.reserved_teacher_id && r.reserved_teacher_id !== slot.teacher_id) return false;
    return true;
  };

  // 1. home room
  if (teacher?.fixed_room_id != null) {
    const home = ctx.rooms.find((r) => r.id === teacher.fixed_room_id);
    if (home && allowed(home)) return home.id;
  }
  // 2. keep current room
  if (slot.room_id != null) {
    const cur = ctx.rooms.find((r) => r.id === slot.room_id);
    if (cur && allowed(cur)) return cur.id;
  }
  // 3. same-type free room
  const sameType = ctx.rooms
    .filter((r) => allowed(r) && r.type === slot.room_type)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sameType.length) return sameType[0].id;
  // 4. any free room
  const any = ctx.rooms.filter(allowed).sort((a, b) => a.name.localeCompare(b.name));
  return any.length ? any[0].id : null;
}

/** Does placing `slot` at (day, period) hit a hard conflict (teacher/group busy)? */
function hardConflictAt(
  ctx: Ctx,
  slot: TimetableSlot,
  day: number,
  period: number,
  ignoreIds: Set<number>,
): boolean {
  return ctx.slots.some(
    (s) =>
      s.day === day &&
      s.period === period &&
      !ignoreIds.has(s.id) &&
      s.id !== slot.id &&
      (s.teacher_id === slot.teacher_id || ctx.shares(s.group_id, slot.group_id)),
  );
}

function mkStep(
  ctx: Ctx,
  slot: TimetableSlot,
  toDay: number,
  toPeriod: number,
  toRoomId: number | null,
  action: RouteStep["action"],
): RouteStep {
  const cellChanged = toDay !== slot.day || toPeriod !== slot.period;
  const roomChanged = (toRoomId ?? null) !== (slot.room_id ?? null);
  return {
    slotId: slot.id,
    label: `${slot.subject_code ?? slot.subject_name ?? "?"} (${slot.teacher_name ?? "?"})`,
    teacherName: slot.teacher_name ?? "?",
    fromDay: slot.day,
    fromPeriod: slot.period,
    toDay,
    toPeriod,
    fromRoomId: slot.room_id ?? null,
    toRoomId,
    fromRoomName: roomName(ctx, slot.room_id ?? null),
    toRoomName: roomName(ctx, toRoomId),
    roomChanged,
    cellChanged,
    noRoomAvailable: action !== "delete" && toRoomId == null && slot.room_id != null,
    action,
  };
}

// ── Main entry ───────────────────────────────────────────────────────────────
export function planRoutes(
  moving:   TimetableSlot,
  targetDay:    number,
  targetPeriod: number,
  slots:    TimetableSlot[],
  rooms:    Room[],
  teachers: Teacher[],
  periods:  Period[],
  groups:   StudentGroup[] = [],
  numDays = 5,
): SwapRoute[] {
  const classPeriodNums = [
    ...new Set(periods.filter((p) => p.type === "class").map((p) => p.period_num)),
  ].sort((a, b) => a - b);
  const shares = buildSharesStudents(groups);
  const ctx: Ctx = { slots, rooms, teachers, periods, classPeriodNums, numDays, shares };

  const atTarget = slots.filter(
    (s) => s.day === targetDay && s.period === targetPeriod && s.id !== moving.id,
  );

  // Classify blockers
  const teacherOrGroupBlockers = atTarget.filter(
    (s) => s.teacher_id === moving.teacher_id || shares(s.group_id, moving.group_id),
  );
  const roomOnlyBlockers = atTarget.filter(
    (s) =>
      s.teacher_id !== moving.teacher_id &&
      !shares(s.group_id, moving.group_id) &&
      moving.room_id != null &&
      s.room_id === moving.room_id,
  );

  const routes: SwapRoute[] = [];

  // ── Case 0: nothing really blocks the cell (empty or only coexisting classes) ─
  if (teacherOrGroupBlockers.length === 0 && roomOnlyBlockers.length === 0) {
    const toRoom = pickRoom(ctx, moving, targetDay, targetPeriod, atTarget);
    routes.push({
      id: "direct",
      kind: "direct",
      title: "วางได้ทันที",
      summary: "ช่องนี้ว่างสำหรับครูและห้องเรียนนี้ — ย้ายได้เลย",
      steps: [mkStep(ctx, moving, targetDay, targetPeriod, toRoom, "move")],
      risk: "safe",
      score: 0,
      feasible: true,
      warnings: [],
    });
    return routes;
  }

  // ── Case A: only a ROOM clash (two classes want the same room) ──────────────
  // Nobody needs to change cell — just give the moving class a different room.
  if (teacherOrGroupBlockers.length === 0 && roomOnlyBlockers.length > 0) {
    const newRoom = pickRoom(ctx, moving, targetDay, targetPeriod, atTarget);
    routes.push({
      id: "room-only",
      kind: "room-only",
      title: "เปลี่ยนห้อง (ไม่ต้องย้ายคาบ)",
      summary:
        newRoom != null
          ? `ห้อง ${roomName(ctx, moving.room_id ?? null) ?? "-"} ชนกับคาบอื่น → ย้ายไปห้อง ${roomName(ctx, newRoom)}`
          : "ห้องชนกัน แต่ไม่มีห้องว่างอื่นในคาบนี้",
      steps: [mkStep(ctx, moving, targetDay, targetPeriod, newRoom, "move")],
      risk: newRoom != null ? "safe" : "risky",
      score: 1,
      feasible: newRoom != null,
      warnings: newRoom == null ? ["ไม่มีห้องว่างอื่นในคาบนี้"] : [],
    });
    return routes;
  }

  // From here on there is at least one teacher/group blocker.
  // We only build swap chains when there is exactly ONE such blocker; more than
  // one makes a clean visual "route" impossible, so we fall back to force.
  const blocker = teacherOrGroupBlockers[0];
  const multiBlocker = teacherOrGroupBlockers.length > 1;

  if (!multiBlocker && !blocker.is_locked && !blocker.is_elective) {
    // ── Route 1: two-way swap (A ↔ B) ─────────────────────────────────────────
    // Blocker moves to moving's origin; moving takes the target.
    const ignore = new Set<number>([moving.id, blocker.id]);
    const blockerLandsOk = !hardConflictAt(ctx, blocker, moving.day, moving.period, ignore);
    const movingLandsOk = !hardConflictAt(ctx, moving, targetDay, targetPeriod, ignore);

    if (blockerLandsOk && movingLandsOk) {
      // Rooms: compute both landings treating each other as occupying.
      const blockerRoom = pickRoom(ctx, blocker, moving.day, moving.period, [
        ...slots.filter((s) => !ignore.has(s.id)),
      ]);
      const movingRoom = pickRoom(ctx, moving, targetDay, targetPeriod, [
        ...slots.filter((s) => !ignore.has(s.id)),
      ]);
      const steps = [
        mkStep(ctx, blocker, moving.day, moving.period, blockerRoom, "move"),
        mkStep(ctx, moving, targetDay, targetPeriod, movingRoom, "move"),
      ];
      const warnings: string[] = [];
      if (blockerRoom == null) warnings.push(`${blocker.teacher_name}: ไม่มีห้องว่างที่ปลายทาง`);
      if (movingRoom == null) warnings.push(`${moving.teacher_name}: ไม่มีห้องว่างที่ปลายทาง`);
      const roomChanges = steps.filter((s) => s.roomChanged).length;
      routes.push({
        id: "two-way",
        kind: "two-way",
        title: "สลับสองทาง (A ↔ B)",
        summary: `${blocker.subject_code ?? blocker.subject_name} ↔ ${moving.subject_code ?? moving.subject_name} สลับตำแหน่งกัน`,
        steps,
        risk: warnings.length ? "medium" : "safe",
        score: 2 + roomChanges,
        feasible: warnings.length === 0,
        warnings,
      });
    }

    // ── Route 2+: relocate the blocker to another free cell ───────────────────
    // Enumerate free cells for the blocker (excluding origin & target), pick a few.
    const candidates: { day: number; period: number }[] = [];
    for (let d = 0; d < numDays; d++) {
      for (const p of classPeriodNums) {
        if (d === targetDay && p === targetPeriod) continue;     // that's where moving goes
        if (d === blocker.day && p === blocker.period) continue; // blocker already there
        const ignore = new Set<number>([moving.id, blocker.id]);
        if (hardConflictAt(ctx, blocker, d, p, ignore)) continue;
        candidates.push({ day: d, period: p });
      }
    }
    // Prefer same day, then earliest — keeps the teacher's schedule tidy.
    candidates.sort((a, b) => {
      const aSame = a.day === blocker.day ? 0 : 1;
      const bSame = b.day === blocker.day ? 0 : 1;
      return aSame - bSame || a.day - b.day || a.period - b.period;
    });

    for (const c of candidates.slice(0, 3)) {
      const ignore = new Set<number>([moving.id, blocker.id]);
      const rest = slots.filter((s) => !ignore.has(s.id));
      const blockerRoom = pickRoom(ctx, blocker, c.day, c.period, rest);
      const movingRoom = pickRoom(ctx, moving, targetDay, targetPeriod, rest);
      const steps = [
        mkStep(ctx, blocker, c.day, c.period, blockerRoom, "move"),
        mkStep(ctx, moving, targetDay, targetPeriod, movingRoom, "move"),
      ];
      const warnings: string[] = [];
      if (blockerRoom == null) warnings.push(`${blocker.teacher_name}: ไม่มีห้องว่างที่ปลายทาง`);
      if (movingRoom == null) warnings.push(`${moving.teacher_name}: ไม่มีห้องว่างที่ปลายทาง`);
      const roomChanges = steps.filter((s) => s.roomChanged).length;
      routes.push({
        id: `relocate-${c.day}-${c.period}`,
        kind: "relocate",
        title: "ย้ายคาบที่ชนไปช่องว่าง",
        summary: `ย้าย ${blocker.subject_code ?? blocker.subject_name} ของ ${blocker.teacher_name} ไปช่องว่าง`,
        steps,
        risk: warnings.length ? "medium" : "safe",
        score: 4 + roomChanges,
        feasible: warnings.length === 0,
        warnings,
      });
    }
  }

  // ── Fallback: force / overwrite (delete blockers) ───────────────────────────
  {
    const rest = slots.filter((s) => !teacherOrGroupBlockers.some((b) => b.id === s.id) && s.id !== moving.id);
    const movingRoom = pickRoom(ctx, moving, targetDay, targetPeriod, rest);
    const steps: RouteStep[] = [
      ...teacherOrGroupBlockers.map((b) => mkStep(ctx, b, b.day, b.period, b.room_id ?? null, "delete")),
      mkStep(ctx, moving, targetDay, targetPeriod, movingRoom, "move"),
    ];
    const lockedBlocked = teacherOrGroupBlockers.some((b) => b.is_locked || b.is_elective);
    routes.push({
      id: "force",
      kind: "force",
      title: "บังคับวาง (ลบคาบที่ชน)",
      summary: `ลบ ${teacherOrGroupBlockers.length} คาบที่ชน แล้ววางคาบนี้แทน — ข้อมูลคาบที่ถูกลบจะหายไป`,
      steps,
      risk: "risky",
      score: 100,
      feasible: !lockedBlocked,
      warnings: lockedBlocked ? ["มีคาบที่ล็อก/วิชาเสรีอยู่ ไม่สามารถลบได้"] : [],
    });
  }

  // Sort: feasible first, then by score.
  routes.sort((a, b) => Number(b.feasible) - Number(a.feasible) || a.score - b.score);
  return routes;
}
