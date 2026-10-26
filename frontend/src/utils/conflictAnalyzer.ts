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
import { strictShares, type SharesStudents } from "./groupHierarchy";
import type { LevelKey } from "./levels";

// ─────────────────────────────────────────────────────────────────────────────
// Single-cell analysis
// ─────────────────────────────────────────────────────────────────────────────
export function analyzeDropTarget(
  drag:          TimetableSlot,
  targetDay:     number,
  targetPeriod:  number,
  allSlots:      TimetableSlot[],   // entire DB snapshot (all groups/teachers)
  gridPeriods:   Period[],
  sharesStudents: SharesStudents = strictShares,
  manualMode:    boolean = false,
  level:         LevelKey | null = null,
): CellImpact {
  // ── Same position ──────────────────────────────────────────────────────────
  if (drag.day === targetDay && drag.period === targetPeriod) {
    return mk("same", 0, "ตำแหน่งเดิม");
  }

  // ── Fixed / non-class period ───────────────────────────────────────────────
  // ม.ต้นกับ ม.ปลายใช้ "เลขคาบ" ชุดเดียวกัน แต่คนละความหมาย เพราะพักกลางวัน
  // คนละเวลา: เลขคาบ 5 เป็นคาบ 4 ของ ม.ปลาย และเป็นพักกลางวันของ ม.ต้น
  // ส่วนเลขคาบ 6 เป็นคาบ 5 ของ ม.ต้น และเป็นพักกลางวันของ ม.ปลาย
  //
  //   "เหมือนว่าจะเลื่อนลงคาบ 4 ไม่ได้"
  //
  // เดิมหาด้วย "เลขคาบตรงกัน" เฉย ๆ ซึ่งคืนแถวแรกที่เจอ และในผังคาบจริงของ
  // โรงเรียน แถวพักกลางวันถูกบันทึกไว้ก่อนแถวคาบเรียนทั้งสองคู่ — ทุกครั้งจึง
  // ไปเจอพักกลางวันของอีกฝั่ง แล้วตอบว่า "ช่องนี้ไม่ใช่คาบเรียน"
  //
  // ผลคือ ม.ปลายวางลงคาบ 4 ไม่ได้เลย และ ม.ต้นก็วางลงคาบ 5 ไม่ได้เลย ทั้งที่
  // เป็นคาบเรียนปกติของตัวเอง — ชั้นละหนึ่งคาบเต็ม ๆ ที่ลากวางไม่ได้มาตลอด
  const forLevel = (p: Period) =>
    !level || !p.applies_to || p.applies_to === "all" || p.applies_to === level;
  const periodDef = gridPeriods.find((p) => p.period_num === targetPeriod && forLevel(p))
    ?? gridPeriods.find((p) => p.period_num === targetPeriod);
  if (!periodDef || periodDef.type !== "class") {
    return mk("fixed", 0, periodDef ? `${periodDef.label} – จัดคาบไม่ได้` : "คาบพิเศษ");
  }

  // ── โหมดจัดเอง: ชนกันได้ ยกเว้นชนกับคาบที่ล็อกไว้ ────────────────────────
  //
  //   "วางไม่ได้ ช่วยทำให้วางได้หน่อย"
  //
  // ตอนทำโหมดจัดเอง แก้แต่ฝั่งที่ส่งไปเซิร์ฟเวอร์ ไม่ได้แก้สีตอนลาก หน้าจอจึง
  // ยังขึ้นจุดแดง "ไม่สามารถวางได้" เต็มตารางเหมือนเดิม ทั้งที่วางได้แล้ว —
  // คนอ่านว่าวางไม่ได้ ก็ไม่วาง กลายเป็นว่าโหมดที่ทำไว้ไม่มีใครได้ใช้
  //
  // ในโหมดนี้เหลือสีแดงไว้กรณีเดียว คือชนกับคาบที่ล็อกไว้จริง ๆ
  if (manualMode) {
    const here = allSlots.filter(
      (s) => s.day === targetDay && s.period === targetPeriod && s.id !== drag.id);
    const co = (x: TimetableSlot) =>
      [x.teacher_id, (x as { co_teacher_id?: number | null }).co_teacher_id]
        .filter((t): t is number => t != null);
    const mine = co(drag);
    const lockHit = here.find((s) => s.is_locked && (
      sharesStudents(s.group_id, drag.group_id)
      || co(s).some((t) => mine.includes(t))
      || (drag.room_id != null && s.room_id === drag.room_id)));
    if (lockHit) {
      return mk("red", 0,
        `🔒 ชนกับคาบที่ล็อกไว้ของ ${lockHit.group_name ?? "ห้องอื่น"} — วางตรงนี้ไม่ได้`);
    }
    if (here.length === 0) return mk("green", 0, "✅ ว่าง – วางได้ทันที");
    return mk("yellow", here.length,
      `✋ วางได้ — จะชนกับ ${here.length} คาบ แล้วขึ้นกรอบแดงให้ไปเลื่อนทีหลัง`);
  }

  // ── Slots already at the target (day, period) — exclude current drag slot ─
  const atTarget = allSlots.filter(
    (s) => s.day === targetDay && s.period === targetPeriod && s.id !== drag.id,
  );

  // ── Locked / elective slots at target can't be swapped away ───────────────
  const lockedBlock = atTarget.find((s) => s.is_locked || s.is_elective);
  if (lockedBlock) {
    return mk("red", Infinity, `🔒 มีคาบที่ล็อก/วิชาเสรีอยู่ที่นี่ (วางเพื่อบังคับแทนที่)`);
  }

  // ── Same group (or a parent/child sharing students) already booked ────────
  const groupBlock = atTarget.find((s) => sharesStudents(s.group_id, drag.group_id));
  if (groupBlock) {
    const label = groupBlock.group_id === drag.group_id
      ? `🔁 ห้อง "${groupBlock.group_name}" มีคาบอยู่ — วางเพื่อเลือกเส้นทางแทนที่`
      : `🔁 "${groupBlock.group_name}" ใช้นักเรียนกลุ่มเดียวกัน (ห้องย่อย) — วางเพื่อเลือกเส้นทาง`;
    return mk("red", 1, label);
  }

  // ── Parallel sibling conflict → still a hard block ────────────────────────
  if (drag.parallel_group_key) {
    const parallelConflict = atTarget.find(
      (s) => s.parallel_group_key === drag.parallel_group_key,
    );
    if (parallelConflict) {
      return mk("red", Infinity, "❌ คาบคู่ขนาน (ก/ข/ค) ซ้อนกัน");
    }
  }

  // ── Teacher already teaching at target → droppable, offers routes ─────────
  // (null teacher = activity period with no assigned teacher — never a clash)
  const teacherBlock = drag.teacher_id == null
    ? undefined
    : atTarget.find((s) => s.teacher_id != null && s.teacher_id === drag.teacher_id);
  if (teacherBlock) {
    return mk("red", 1, `🔁 ครู "${drag.teacher_name}" สอนอยู่ — วางเพื่อเลือกเส้นทางแทนที่`);
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
  sharesStudents: SharesStudents = strictShares,
  manualMode:   boolean = false,
  level:        LevelKey | null = null,
): Map<string, CellImpact> {
  const map = new Map<string, CellImpact>();
  const periodNums = gridPeriods.map((p) => p.period_num);
  for (let d = 0; d < numDays; d++) {
    for (const p of periodNums) {
      map.set(`${d}-${p}`,
        analyzeDropTarget(drag, d, p, allSlots, gridPeriods, sharesStudents,
                          manualMode, level));
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
