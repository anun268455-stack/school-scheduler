/**
 * Real-time drag-and-drop conflict impact analyzer.
 *
 * Produces Green / Yellow / Red ratings for every cell in the grid
 * the moment the user picks up a slot, based on:
 *   🟢 Green  – safe drop, 0–1 swaps
 *   🟡 Yellow – manageable ripple, 2–4 swaps
 *   🔴 Red    – hard-constraint violation or >4-swap cascade
 */
import type { TimetableSlot, CellImpact, ImpactLevel, Period } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Single-cell analysis
// ─────────────────────────────────────────────────────────────────────────────
export function analyzeDropTarget(
  drag:          TimetableSlot,
  targetDay:     number,
  targetPeriod:  number,
  allSlots:      TimetableSlot[],   // entire DB snapshot (all groups/teachers)
  gridPeriods:   Period[],
): CellImpact {
  // ── Same position ──────────────────────────────────────────────────────────
  if (drag.day === targetDay && drag.period === targetPeriod) {
    return mk("same", 0, "ตำแหน่งเดิม");
  }

  // ── Fixed / non-class period ───────────────────────────────────────────────
  const periodDef = gridPeriods.find((p) => p.period_num === targetPeriod);
  if (!periodDef || periodDef.type !== "class") {
    return mk("fixed", 0, periodDef ? `${periodDef.label} – จัดคาบไม่ได้` : "คาบพิเศษ");
  }

  // ── Slots already at the target (day, period) — exclude current drag slot ─
  const atTarget = allSlots.filter(
    (s) => s.day === targetDay && s.period === targetPeriod && s.id !== drag.id,
  );

  // ── HARD: Same group already booked there ─────────────────────────────────
  const groupBlock = atTarget.find((s) => s.group_id === drag.group_id);
  if (groupBlock) {
    return mk("red", Infinity, `❌ ห้อง "${groupBlock.group_name}" มีคาบอยู่แล้ว`);
  }

  // ── HARD: Parallel sibling conflict ───────────────────────────────────────
  if (drag.parallel_group_key) {
    const parallelConflict = atTarget.find(
      (s) => s.parallel_group_key === drag.parallel_group_key,
    );
    if (parallelConflict) {
      return mk("red", Infinity, "❌ คาบคู่ขนาน (ก/ข/ค) ซ้อนกัน");
    }
  }

  // ── HARD: Teacher already teaching at target ───────────────────────────────
  const teacherBlock = atTarget.find((s) => s.teacher_id === drag.teacher_id);
  if (teacherBlock) {
    return mk("red", Infinity, `❌ ครู "${drag.teacher_name}" สอนที่อื่นอยู่แล้ว`);
  }

  // ── HARD: Locked slots at target can't be moved ───────────────────────────
  const lockedBlock = atTarget.find((s) => s.is_locked);
  if (lockedBlock) {
    return mk("red", Infinity, `🔒 มีคาบที่ล็อกอยู่ที่ตำแหน่งนี้`);
  }

  // ── Empty target ──────────────────────────────────────────────────────────
  if (atTarget.length === 0) {
    // Check teacher busy at origin after move (will source vacate teacher?)
    return mk("green", 0, "✅ ว่าง – วางได้ทันที");
  }

  // ── Compute room-swap cascades ────────────────────────────────────────────
  const roomConflicts = drag.room_id
    ? atTarget.filter((s) => s.room_id === drag.room_id)
    : [];

  // Each room conflict needs one additional swap (find alt room or move that class)
  const cascades = roomConflicts.length + atTarget.length - roomConflicts.length;

  // Additional penalty: double-period boundary check
  const doublePenalty = drag.is_double_start && targetPeriod >= gridPeriods.length - 1 ? 1 : 0;
  const total = cascades + doublePenalty;

  if (total === 0) return mk("green",  0,     "✅ ว่าง – วางได้ทันที");
  if (total <= 4)  return mk("yellow", total,  `⚠️ ต้องสลับ ${total} คาบ`);
                   return mk("red",    total,   `❌ ต้องสลับมากเกินไป (${total} คาบ)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk analysis: pre-compute impact for every (day, period) cell
// ─────────────────────────────────────────────────────────────────────────────
export function buildImpactMap(
  drag:         TimetableSlot,
  allSlots:     TimetableSlot[],
  gridPeriods:  Period[],
  numDays:      number = 5,
): Map<string, CellImpact> {
  const map = new Map<string, CellImpact>();
  const periodNums = gridPeriods.map((p) => p.period_num);
  for (let d = 0; d < numDays; d++) {
    for (const p of periodNums) {
      map.set(`${d}-${p}`, analyzeDropTarget(drag, d, p, allSlots, gridPeriods));
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual helpers
// ─────────────────────────────────────────────────────────────────────────────
export function impactBorderClass(level: ImpactLevel): string {
  switch (level) {
    case "green":   return "ring-2 ring-green-400  bg-green-50";
    case "yellow":  return "ring-2 ring-yellow-400 bg-yellow-50";
    case "red":     return "ring-2 ring-red-400    bg-red-50";
    case "same":    return "ring-2 ring-blue-400   bg-blue-50";
    case "fixed":   return "cursor-not-allowed opacity-50";
    default:        return "";
  }
}

export function impactDotColor(level: ImpactLevel): string {
  switch (level) {
    case "green":  return "bg-green-500";
    case "yellow": return "bg-yellow-500";
    case "red":    return "bg-red-500";
    case "same":   return "bg-blue-500";
    default:       return "bg-gray-300";
  }
}

// ── Internal ────────────────────────────────────────────────────────────────
function mk(level: ImpactLevel, cascades: number, reason: string): CellImpact {
  return { level, cascades, reason };
}
