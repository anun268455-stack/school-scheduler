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
import { slotLabel } from "./teacherSlots";
import { roomFreeFor } from "./levels";

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
  | "chain"       // a bumps b, b bumps c … up to MAX_CHAIN deep
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
  subjects?: { id: number; department_id?: number | null }[];
  classPeriodNums: number[];
  numDays:  number;
  shares:   SharesStudents;
}

/** How many lessons a single route may shuffle. Beyond this nobody can follow it. */
const MAX_CHAIN = 5;

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
  const subject = ctx.subjects?.find((x) => x.id === slot.subject_id);

  const allowed = (r: Room): boolean => {
    if (busy.has(r.id)) return false;
    // ห้ามใช้ — a staff room or office. The planner was offering these as
    // destinations despite the school having said they are not classrooms.
    if (r.usable === false || (r.capacity ?? 1) <= 0) return false;
    // A room reserved for other teachers is off-limits.
    if (!roomFreeFor(r, slot.teacher_id)) return false;
    // A lab belongs to its own department.
    if (r.specialized_dept_id
        && subject?.department_id
        && r.specialized_dept_id !== subject.department_id) return false;
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
      (sameTeacher(s.teacher_id, slot.teacher_id) || ctx.shares(s.group_id, slot.group_id)),
  );
}

/** Two lessons clash on teacher only when both name the same real teacher. */
function sameTeacher(a: number | null, b: number | null): boolean {
  return a != null && b != null && a === b;
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
    label: `${slotLabel(slot)} (${slot.teacher_name ?? "หลายคน"})`,
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

/**
 * Find a chain of moves that clears the way.
 *
 * A direct swap only works when the blocker happens to fit where the moving
 * lesson came from. Usually it does not, and the next thing a person tries by
 * hand is to push the blocker somewhere, push whatever is THERE somewhere else,
 * and so on. That search is what this does, breadth-first and depth-limited,
 * so the answer is the shortest chain rather than the first one found.
 *
 * Each link is "this lesson moves to this free-or-freeable cell". The chain
 * stops at MAX_CHAIN because a longer one is not something anyone can check.
 */
function findChain(
  ctx: Ctx,
  moving: TimetableSlot,
  targetDay: number,
  targetPeriod: number,
  maxDepth: number,
): { slot: TimetableSlot; day: number; period: number }[] | null {
  type Move = { slot: TimetableSlot; day: number; period: number };

  /** Lessons that would block `slot` at this cell, ignoring ones already moving. */
  const blockersFor = (slot: TimetableSlot, d: number, p: number, movedIds: Set<number>) =>
    ctx.slots.filter(
      (s) => s.day === d && s.period === p && s.id !== slot.id && !movedIds.has(s.id)
        && (sameTeacher(s.teacher_id, slot.teacher_id) || ctx.shares(s.group_id, slot.group_id)),
    );

  // Cells a lesson could go to, nearest-first so a chain stays close to home.
  const cellsFor = (slot: TimetableSlot): { day: number; period: number }[] => {
    const out: { day: number; period: number }[] = [];
    for (let d = 0; d < ctx.numDays; d++) {
      for (const p of ctx.classPeriodNums) {
        if (d === slot.day && p === slot.period) continue;
        out.push({ day: d, period: p });
      }
    }
    return out.sort((a, b) =>
      Math.abs(a.day - slot.day) + Math.abs(a.period - slot.period)
      - (Math.abs(b.day - slot.day) + Math.abs(b.period - slot.period)));
  };

  type State = { chain: Move[]; frontier: Move };
  const start: Move = { slot: moving, day: targetDay, period: targetPeriod };
  const queue: State[] = [{ chain: [start], frontier: start }];
  const seen = new Set<string>([`${moving.id}@${targetDay}-${targetPeriod}`]);

  while (queue.length > 0) {
    const { chain, frontier } = queue.shift()!;
    const movedIds = new Set(chain.map((m) => m.slot.id));
    const blockers = blockersFor(frontier.slot, frontier.day, frontier.period, movedIds);

    if (blockers.length === 0) return chain;      // the way is clear
    if (chain.length >= maxDepth) continue;       // too long to be useful
    // Several blockers at once would need a branching plan; a person cannot
    // follow that, and the force route already covers it.
    if (blockers.length > 1) continue;

    const blocker = blockers[0];
    if (blocker.is_locked || blocker.is_elective) continue;   // not ours to move

    for (const cell of cellsFor(blocker)) {
      const key = `${blocker.id}@${cell.day}-${cell.period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const next: Move = { slot: blocker, day: cell.day, period: cell.period };
      queue.push({ chain: [...chain, next], frontier: next });
    }
  }
  return null;
}

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
  subjects: { id: number; department_id?: number | null }[] = [],
): SwapRoute[] {
  const classPeriodNums = [
    ...new Set(periods.filter((p) => p.type === "class").map((p) => p.period_num)),
  ].sort((a, b) => a - b);
  const shares = buildSharesStudents(groups);
  const ctx: Ctx = { slots, rooms, teachers, periods, subjects, classPeriodNums, numDays, shares };

  const atTarget = slots.filter(
    (s) => s.day === targetDay && s.period === targetPeriod && s.id !== moving.id,
  );

  // Classify blockers
  const teacherOrGroupBlockers = atTarget.filter(
    (s) => sameTeacher(s.teacher_id, moving.teacher_id) || shares(s.group_id, moving.group_id),
  );
  const roomOnlyBlockers = atTarget.filter(
    (s) =>
      !sameTeacher(s.teacher_id, moving.teacher_id) &&
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
        summary: `${slotLabel(blocker)} ↔ ${slotLabel(moving)} สลับตำแหน่งกัน`,
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
        summary: `ย้าย ${slotLabel(blocker)} ของ ${blocker.teacher_name ?? "วิชาเสรี"} ไปช่องว่าง`,
        steps,
        risk: warnings.length ? "medium" : "safe",
        score: 4 + roomChanges,
        feasible: warnings.length === 0,
        warnings,
      });
    }
  }

  // ── Chained moves: push the blocker on, and whatever it displaces too ──────
  // The last thing to try before overwriting: a person doing this by hand would
  // keep pushing lessons along until something lands somewhere free.
  {
    const chain = findChain(ctx, moving, targetDay, targetPeriod, MAX_CHAIN);
    if (chain && chain.length > 1) {
      // Apply the moves in reverse — the far end of the chain steps aside
      // first, so nothing is ever briefly double-booked.
      const ordered = [...chain].reverse();
      const movedIds = new Set(chain.map((m) => m.slot.id));
      const rest = slots.filter((x) => !movedIds.has(x.id));

      const steps: RouteStep[] = [];
      const warnings: string[] = [];
      let roomChanges = 0;
      const placed: TimetableSlot[] = [];
      for (const m of ordered) {
        const occupying = [
          ...rest.filter((x) => x.day === m.day && x.period === m.period),
          ...placed.filter((x) => x.day === m.day && x.period === m.period),
        ];
        const room = pickRoom(ctx, m.slot, m.day, m.period, occupying);
        const step = mkStep(ctx, m.slot, m.day, m.period, room, "move");
        if (step.roomChanged) roomChanges++;
        if (step.noRoomAvailable) warnings.push(`${step.label}: ไม่มีห้องว่างที่ปลายทาง`);
        steps.push(step);
        placed.push({ ...m.slot, day: m.day, period: m.period, room_id: room });
      }

      const others = ordered.length - 1;
      routes.push({
        id: "chain",
        kind: "chain",
        title: `ย้ายต่อกัน ${ordered.length} คาบ`,
        summary: `ย้าย ${slotLabel(moving)} ไปช่องที่เลือก โดยให้อีก ${others} คาบขยับต่อกันเป็นทอดๆ`
          + (roomChanges > 0 ? ` · เปลี่ยนห้อง ${roomChanges} คาบ` : ""),
        steps,
        risk: ordered.length <= 3 ? "medium" : "risky",
        // Longer chains sort below a plain swap but above overwriting.
        score: 10 + ordered.length * 2 + roomChanges,
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
