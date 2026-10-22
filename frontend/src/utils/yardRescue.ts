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
 * The picker in the grid (YardPickModal) marks a lesson's hours the same way, so
 * it shares writeMarks, runsOfHours, whenText and the "บันทึกได้ไม่ครบ" lines.
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
export type MarkOutcome<M = RescueSave> =
  | { ok: true;  saved: M[] }
  | { ok: false; saved: M[]; unsaved: M[]; error: unknown };

/**
 * Save the marks one after another and stop at the first refusal. Never throws:
 * what a caller needs to know is how many went through before it stopped.
 */
export async function writeMarks<M = RescueSave>(
  marks: M[], save: (m: M) => Promise<unknown>,
): Promise<MarkOutcome<M>> {
  const saved: M[] = [];
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

/**
 * The same, for taking a ลาน away (เอาออก) from a คาบคู่ and having only one of
 * its two hours let go. No ลาน is named: removing does not pick one.
 */
export function partialRemoveLine(o: {
  group:   string;
  saved:   string;
  unsaved: string;
  reason:  string;
}): string {
  return `⚠ เอาออกได้ไม่ครบ: ${o.group} ${o.saved} เอาลานออกแล้ว `
    + `แต่ ${o.unsaved} เอาออกไม่ได้ (${o.reason}) — คาบคู่จึงเอาออกได้แค่ครึ่งเดียว `
    + `กด “เอาออก” อีกครั้งเพื่อทำส่วนที่เหลือ`;
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

/** The lesson's teacher is in another class's lesson that very hour. */
export interface RescueClash {
  teacher:      string;
  with_group:   string;
  with_subject: string;
}

/**
 * What to say when a ลาน will give the lesson its room and the cell will stay
 * red anyway: the room is not the only thing wrong. Plain, and naming the other
 * class and subject, so the school knows where the other half of the fix is.
 * The options stay on offer — they are right, they just do not finish the job;
 * with none on offer it says only what else is wrong.
 */
export function clashLine(c: RescueClash, withOptions = true): { head: string; body: string } {
  const who   = (c.teacher ?? "").trim() || "ครูของคาบนี้";
  const group = (c.with_group ?? "").trim();
  const what  = (c.with_subject ?? "").trim();
  const other = what && group ? `${what} ให้ ${group}` : what || group || "อีกห้องหนึ่ง";
  const clash = `${who} ต้องสอน ${other} ในชั่วโมงเดียวกันนี้ด้วย `
    + `— ต้องแก้เรื่องครูสอนชนกันอีกทาง คาบนี้จึงจะหายแดง`;
  return withOptions
    ? {
      head: "⚠ เลือกลานแล้ว คาบนี้ก็ยังแดงอยู่",
      body: `ลานแก้ได้เฉพาะเรื่องห้อง แต่ ${clash} ตัวเลือกด้านล่างยังใช้ได้ คาบนี้จะได้ห้องตามที่เลือก`,
    }
    : {
      head: "⚠ คาบนี้แดงเพราะครูสอนชนกันด้วย",
      body: `นอกจากเรื่องห้อง ${clash}`,
    };
}

/**
 * Does the server's note already say this clash — the teacher and the other
 * class, by name? The note is its own words (it may fold the clash into the
 * reason there is nothing to offer), so before saying the clash a second time
 * the screen looks.
 */
export function noteSaysClash(note: string, c: RescueClash): boolean {
  const teacher = (c.teacher ?? "").trim();
  const group   = (c.with_group ?? "").trim();
  return !!teacher && !!group && note.includes(teacher) && note.includes(group);
}

/** The parts of the server's answer the screen decides on. */
export interface RescueLike<D, O> {
  lesson?: { found?: boolean; teacher_clash?: RescueClash | null } | null;
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
  | { kind: "gone"; note: string; clash: null }
  | { kind: "nothing"; note: string; clash: RescueClash | null; noteSaysClash: boolean }
  | { kind: "options"; note: string; direct: D[]; donors: O[]; clash: RescueClash | null };

export function rescueView<D extends { rank: number }, O>(
  r: RescueLike<D, O>,
): RescueView<D, O> {
  const note = (r.note ?? "").trim();
  if (r.lesson?.found !== true) return { kind: "gone", note: note || NOTE_GONE, clash: null };
  const clash  = r.lesson.teacher_clash ?? null;
  const direct = directInOrder(r.direct);
  const donors = r.donors ?? [];
  const repeats = !!clash && noteSaysClash(note, clash);
  if (!direct.length && !donors.length) {
    // Nothing to offer: the note is the reason, and the server folds the clash
    // into it. Then it is the one thing printed; `clash` is what the screen
    // still has to say itself, which is nothing when the note already did.
    return { kind: "nothing", note: note || NOTE_NOTHING, clash: repeats ? null : clash, noteSaysClash: repeats };
  }
  // Beside options the server's note is the clash sentence. The screen says the
  // clash itself (clashLine) from the named fields, in its own place, so the note
  // is left out when it only repeats it — never both. A note about anything else
  // is kept.
  return { kind: "options", note: repeats ? "" : note, direct, donors, clash };
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
