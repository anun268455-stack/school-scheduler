/**
 * เรียนที่ห้องประจำเท่านั้น (ห้องเพชร) — `stay_in_homeroom` has three answers,
 * not two, and the form has to keep all three.
 *
 *   true   the school said: stay in your own room (except a lesson whose
 *          subject has a room of its own)
 *   false  the school said: no — walk to the special rooms as usual
 *   null   the school has not said. The server then looks at whether the
 *          class's name is written on a room (กันไว้ให้ชั้นเรียน) and keeps
 *          the class there if it is.
 *
 * A plain checkbox would turn every "not said" into false the first time
 * somebody edited the class, and quietly switch off the classes that are held
 * by that second route. So the form holds a three-way choice, and a choice
 * nobody touched sends nothing at all.
 */
export type StayChoice = "" | "yes" | "no";

/** What the stored value looks like to the form. Absent and null are one thing. */
export function stayChoiceOf(v: boolean | null | undefined): StayChoice {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "";
}

/** What the choice means to the server. */
export function stayValueOf(c: StayChoice): boolean | null {
  if (c === "yes") return true;
  if (c === "no") return false;
  return null;
}

/**
 * The part of a save request that concerns this setting: nothing when the
 * choice is the one the class already has, the new value (null included, which
 * puts it back to "not said") when it is not.
 */
export function stayPatch(
  choice: StayChoice, current: boolean | null | undefined,
): { stay_in_homeroom?: boolean | null } {
  if (choice === stayChoiceOf(current)) return {};
  return { stay_in_homeroom: stayValueOf(choice) };
}

/**
 * The value to show after a save. The server's own answer when it gives one;
 * otherwise what was asked for — a server may leave the key off when it is
 * null, and merging that over the old record would keep the old true.
 */
export function stayAfterSave(
  saved: { stay_in_homeroom?: boolean | null }, choice: StayChoice,
): boolean | null {
  if ("stay_in_homeroom" in saved) return saved.stay_in_homeroom ?? null;
  return stayValueOf(choice);
}
