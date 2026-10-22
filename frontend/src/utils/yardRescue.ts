/**
 * หาลานให้คาบที่ไม่มีห้อง — the small amount of logic behind the rescue screen.
 * Kept out of the component so the part that can go wrong without anyone
 * noticing can be tested on its own.
 *
 * That part is WHICH CELL a choice marks. The screen offers two kinds of choice
 * and they write to different classes:
 *
 *   direct — this lesson goes out to a ลาน   → this lesson's own class
 *   donor  — another class goes out instead  → the DONOR's class
 *
 * Both are saved with the ordinary คาบเรียนลาน save (PUT /api/yard-picks), so a
 * mix-up does not fail: it quietly marks the wrong class's hour. The donor also
 * carries the indoor room it gives up (`frees_room_id`), which looks just like
 * the ลาน it goes to (`yard_id`) and must never be what gets saved.
 *
 * A คาบคู่ is one lesson in one room across two hours, so a choice marks both
 * of them — the lesson's own, and for a donor the donor's — including when a
 * break falls between the halves and they are two cells on the page. The two
 * marks are two saves, and the second can be refused after the first went
 * through; that is reported as what it is (one hour marked, one not), never as a
 * clean save.
 *
 * Types here are structural, not imported, like yardPicks.ts: the server's rows
 * satisfy them and this file stays free of the rest of the app.
 */

/** One hour of one class — the cell the school is looking at. */
export interface RescueCell {
  group_id: number;
  day:      number;
  period:   number;
}

/** What goes to the server: a ลาน for one hour of one class. */
export interface RescueSave extends RescueCell {
  room_id: number;
}

/** This lesson goes out to a ลาน. Its own class, the ลาน it chose. */
export function directPick(cell: RescueCell, direct: { room_id: number }): RescueSave {
  return {
    group_id: cell.group_id,
    day:      cell.day,
    period:   cell.period,
    room_id:  direct.room_id,
  };
}

/**
 * Another class goes out to a ลาน. The DONOR's class, the same day and hour as
 * the lesson that needs a room, and the ลาน the donor goes to — not the indoor
 * room it gives up.
 */
export function donorPick(
  cell: { day: number; period: number },
  donor: { group_id: number; yard_id: number },
): RescueSave {
  return {
    group_id: donor.group_id,
    day:      cell.day,
    period:   cell.period,
    room_id:  donor.yard_id,
  };
}

/**
 * Every hour a choice marks: `pick` is for one hour, and `hours` are all the
 * hours of that lesson (two for a คาบคู่, with `pick.period` among them — it is
 * added if the caller left it out, so the hour that was asked for is never lost).
 * An hour that already carries exactly this mark is left out: saving it again
 * would only be refused as "nothing changed". In period order.
 */
export function marksForHours(
  pick: RescueSave, hours: number[], existing: RescueSave[],
): RescueSave[] {
  const all = hours.includes(pick.period) ? hours : [...hours, pick.period];
  return [...new Set(all)]
    .sort((a, b) => a - b)
    .filter((p) => !existing.some((r) => (
      r.group_id === pick.group_id && r.day === pick.day
      && r.period === p && r.room_id === pick.room_id)))
    .map((p) => ({ ...pick, period: p }));
}

/**
 * How far a run of saves got.
 *  · ok      — every mark saved
 *  · !ok     — `saved` went through before `error` stopped it; `unsaved` is what
 *              did not, the one that failed first. Empty `saved` means nothing
 *              changed, which is an ordinary refusal; otherwise it is half done.
 */
export type MarkOutcome =
  | { ok: true;  saved: RescueSave[] }
  | { ok: false; saved: RescueSave[]; unsaved: RescueSave[]; error: unknown };

/**
 * Save the marks one after another and stop at the first refusal. Never throws:
 * what a caller needs to know is how many went through before it stopped.
 */
export async function writeMarks(
  marks: RescueSave[], save: (m: RescueSave) => Promise<unknown>,
): Promise<MarkOutcome> {
  const saved: RescueSave[] = [];
  for (let i = 0; i < marks.length; i++) {
    try {
      await save(marks[i]);
    } catch (error) {
      return { ok: false, saved, unsaved: marks.slice(i), error };
    }
    saved.push(marks[i]);
  }
  return { ok: true, saved };
}

/**
 * The hours of one lesson as runs that follow each other in the day's columns:
 * `[[3, 4]]` for a pair that sits together, `[[4], [7]]` for a pair a break
 * falls between. For telling the time a lesson takes — one stretch from the
 * first start to the last end is true of the first and would be false of the
 * second, which does not run through the break.
 */
export function runsOfHours(hours: number[], columns: number[]): number[][] {
  const runs: number[][] = [];
  for (const h of [...hours].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    const at = columns.indexOf(h);
    if (last && at > 0 && columns[at - 1] === last[last.length - 1]) last.push(h);
    else runs.push([h]);
  }
  return runs;
}

/** "วันอังคาร คาบ 3 + คาบ 4" — a day and the hour(s) of one lesson. */
export const whenText = (dayName: string, hourLabels: string[]): string =>
  `วัน${dayName} ${hourLabels.join(" + ")}`;

/**
 * Said when a คาบคู่ got only one of its two marks. The school must be able to
 * tell this from a save that worked: the pair is now marked on one hour only.
 */
export function partialLine(o: {
  group:   string;
  /** whenText of the hour(s) that were saved */
  saved:   string;
  /** whenText of the hour(s) that were not */
  unsaved: string;
  yard:    string;
  /** why the server refused */
  reason:  string;
}): string {
  return `⚠ บันทึกได้ไม่ครบ: ${o.group} ${o.saved} ถูกเลือกไปเรียนที่ ${o.yard} แล้ว `
    + `แต่ ${o.unsaved} บันทึกไม่ได้ (${o.reason}) — คาบคู่จึงมีเครื่องหมายแค่ครึ่งเดียว `
    + `กดเลือกอีกครั้งเพื่อบันทึกส่วนที่เหลือ หรือเลือกลานอื่นให้ทั้งสองคาบ`;
}

/** A key for "this choice is being saved", unique within one answer. */
export const directKey = (d: { room_id: number }): string => `direct:${d.room_id}`;

export const donorKey = (
  o: { group_id: number; frees_room_id: number; yard_id: number },
): string => `donor:${o.group_id}:${o.frees_room_id}:${o.yard_id}`;

/**
 * The free ลาน, best first. The server already sends them that way; sorting
 * again means a screen that says "best first" does not depend on it. Equal ranks
 * (or a rank that is not a number) keep the order they came in. Never mutates.
 */
export function directInOrder<D extends { rank: number }>(
  list: D[] | null | undefined,
): D[] {
  return (list ?? [])
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.rank - b.d.rank) || (a.i - b.i))
    .map((x) => x.d);
}

/** Shown when the server says there is no such stuck lesson and gives no reason. */
export const NOTE_GONE =
  "ช่องนี้ไม่มีคาบที่ต้องหาห้องแล้ว — อาจไม่มีคาบเรียน หรือคาบนั้นมีห้องแล้ว";

/** Shown when nothing can be offered and the server gives no reason. */
export const NOTE_NOTHING =
  "ชั่วโมงนี้ไม่มีลานว่าง และไม่มีห้องอื่นที่ย้ายออกลานแล้วจะได้ห้องให้คาบนี้";

/** The parts of the server's answer the screen decides on. */
export interface RescueLike<D, O> {
  lesson?: { found?: boolean } | null;
  direct?:  D[] | null;
  donors?:  O[] | null;
  note?:    string | null;
}

/**
 * What the screen shows:
 *  · gone    — no stuck lesson in that cell; offers nothing, whatever else came
 *  · nothing — a stuck lesson, and nothing to offer: show the note, not empty lists
 *  · options — at least one way out
 *
 * A note is always there for the first two (the server's own, or ours), so the
 * screen never ends up blank.
 */
export type RescueView<D, O> =
  | { kind: "gone" | "nothing"; note: string }
  | { kind: "options"; note: string; direct: D[]; donors: O[] };

export function rescueView<D extends { rank: number }, O>(
  r: RescueLike<D, O>,
): RescueView<D, O> {
  const note = (r.note ?? "").trim();
  if (r.lesson?.found !== true) return { kind: "gone", note: note || NOTE_GONE };
  const direct = directInOrder(r.direct);
  const donors = r.donors ?? [];
  if (!direct.length && !donors.length) {
    return { kind: "nothing", note: note || NOTE_NOTHING };
  }
  return { kind: "options", note, direct, donors };
}

/** Said after every save: the mark is a decision, the timetable has not moved. */
export const REGEN_HINT =
  "ตารางยังไม่ขยับ ต้องกด ⚡ สร้างตาราง จึงจะจัดตามที่เลือก";

/**
 * The one line shown after a save. It says what was marked, in whose hour —
 * for a donor that is another class, and the line must not leave that to guess.
 */
export function savedLine(o: {
  /** The class whose hour was marked: this lesson's own, or the donor's. */
  group: string;
  /** "วันอังคาร คาบ 3" */
  when:  string;
  yard:  string;
  /** Donor only: the indoor room that is given up for the stuck lesson. */
  frees?: string | null;
}): string {
  const freed = o.frees ? ` (ห้อง ${o.frees} จะว่างให้คาบที่ไม่มีห้อง)` : "";
  return `✓ บันทึกแล้ว: ${o.group} ${o.when} ไปเรียนที่ ${o.yard}${freed} — ${REGEN_HINT}`;
}
