/**
 * ม.ต้น and ม.ปลาย run different days.
 *
 * The two levels break for lunch in different periods, so one period number
 * means different things — and different times of day — depending on who you
 * ask. Period 5 is a lesson for ม.4-6 while ม.1-3 are eating.
 *
 * Every period row carries `applies_to` ("lower", "upper" or "all"); these
 * helpers resolve the day a given class actually experiences. The grid used a
 * hardcoded period list that deduplicated by number and kept whichever row came
 * last, which meant every class was shown ม.ปลาย's day.
 *
 * This mirrors the backend's own level handling — the two must agree, or the
 * timetable on screen is not the timetable being solved.
 */
import type { Period, StudentGroup } from "../types";

export type LevelKey = "lower" | "upper";

/**
 * "lower" for ม.1-3, "upper" for ม.4-6.
 *
 * Takes the first digit out of whatever form the year is in: the imported data
 * writes it "M1" while the class is named "ม.1/1".
 */
export function levelKeyOf(group: Pick<StudentGroup, "level" | "name"> | null | undefined): LevelKey {
  if (!group) return "upper";
  for (const text of [group.level, group.name]) {
    const m = String(text ?? "").match(/(\d)/);
    if (m) return Number(m[1]) <= 3 ? "lower" : "upper";
  }
  return "upper";
}

/** The day as one level experiences it: one row per period number, in order. */
export function periodsForLevel(periods: Period[], level: LevelKey | "all"): Period[] {
  const by = new Map<number, Period>();
  for (const p of periods) {
    const applies = p.applies_to ?? "all";
    if (applies !== "all" && applies !== level && level !== "all") continue;
    // A row written for this level wins over the generic one for that number.
    if (by.has(p.period_num) && applies === "all") continue;
    by.set(p.period_num, p);
  }
  return [...by.values()].sort((a, b) => a.period_num - b.period_num);
}

/** Which period numbers this level may be taught in. */
export function classPeriodsForLevel(periods: Period[], level: LevelKey | "all"): number[] {
  return periodsForLevel(periods, level).filter((p) => p.type === "class").map((p) => p.period_num);
}

/**
 * Columns for a view that spans both levels (a teacher's or a room's day).
 *
 * Such a sheet has to show every period either level might be taught in, and
 * each column says whose lesson period it is when the two disagree.
 */
export function combinedPeriods(periods: Period[]): (Period & { onlyFor?: LevelKey })[] {
  const lower = new Map(periodsForLevel(periods, "lower").map((p) => [p.period_num, p]));
  const upper = new Map(periodsForLevel(periods, "upper").map((p) => [p.period_num, p]));
  const nums = [...new Set([...lower.keys(), ...upper.keys()])].sort((a, b) => a - b);

  return nums.map((n) => {
    const lo = lower.get(n);
    const up = upper.get(n);
    if (lo && up && lo.type !== up.type) {
      // One level is in class while the other is at lunch. Show it as a lesson
      // column — someone is being taught — and name who.
      const teaching = lo.type === "class" ? lo : up;
      return { ...teaching, onlyFor: (lo.type === "class" ? "lower" : "upper") as LevelKey };
    }
    return (up ?? lo) as Period;
  });
}

/** "ม.1-3" / "ม.4-6", for labelling a column that only one level studies in. */
export function levelLabel(level: LevelKey): string {
  return level === "lower" ? "ม.1-3" : "ม.4-6";
}
