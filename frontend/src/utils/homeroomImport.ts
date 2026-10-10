/**
 * Reading a pasted list of ครูประจำชั้น and working out who it means.
 *
 * The list arrives as whatever the office already has — a column copied out
 * of their staff spreadsheet, or typed from the printed sheet. Each line is a
 * teacher and a class. What makes this worth doing carefully is the failure
 * mode: a name read slightly wrong must NOT quietly land on a teacher who
 * happens to look similar, because nobody checking the timetable afterwards
 * would ever spot it. So a name either matches well enough to be certain, or
 * it is handed back for a person to look at.
 */
import type { StudentGroup, Teacher } from "../types";
import { familyRootId } from "./homeroom";

/** Titles that carry no identity, so they are not part of the comparison. */
const TITLES = [
  "ว่าที่ร้อยตรีหญิง", "ว่าที่ร้อยตรี", "ว่าที่ร.ต.",
  "สิบตำรวจตรีหญิง", "สิบตำรวจตรี", "ส.ต.ต.",
  "นางสาว", "นาง", "นาย", "ดร.",
  "Mr.", "Mrs.", "Miss", "Ms.", "Mr", "Mrs", "Ms",
];

/** Strip titles, spaces and punctuation; a nickname in brackets goes too. */
export function normName(raw: string): string {
  let s = String(raw ?? "").trim();
  s = s.replace(/[（(][^）)]*[）)]/g, "");          // กัลยรัตน์(ตุ) → กัลยรัตน์
  let changed = true;
  while (changed) {                                 // "ครู นางสาว ..." etc.
    changed = false;
    const t = s.replace(/^ครู\s*/, "");
    if (t !== s) { s = t; changed = true; }
    for (const title of TITLES) {
      if (s.toLowerCase().startsWith(title.toLowerCase())) {
        s = s.slice(title.length); changed = true; break;
      }
    }
    s = s.trim();
  }
  return s.replace(/[\s.．·]/g, "").toLowerCase();
}

/** Dice coefficient over character bigrams — no dependency, and it handles
 *  Thai, where a dropped vowel mark is one character among many. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a), gb = grams(b);
  let hit = 0, total = 0;
  for (const [, n] of ga) total += n;
  for (const [, n] of gb) total += n;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  return (2 * hit) / total;
}

/** "2/8", "ม.2/8", "ม. 2/8", "2/10ก" → the class name as the system writes it. */
export function normClass(raw: string): string {
  return String(raw ?? "")
    .replace(/^ม\.?\s*/i, "")
    .replace(/\s+/g, "")
    .trim();
}

export type RowStatus = "ok" | "ambiguous" | "no-teacher" | "no-class" | "blank";

export interface ParsedRow {
  line: number;
  raw: string;
  nameText: string;
  classText: string;
  teacher?: Teacher;
  /** When the match was not certain, what it nearly matched, for the person. */
  candidates: { teacher: Teacher; score: number }[];
  group?: StudentGroup;
  status: RowStatus;
  score: number;
}

/**
 * Split one line into a name and a class.
 *
 * The class is found first and from the END, because a name can contain
 * digits far more easily than a class can contain Thai letters, and the
 * office's lists put the class last whatever separator they used — a tab, a
 * run of spaces, a comma, or a pipe from a copied table.
 */
function splitLine(line: string): { nameText: string; classText: string } {
  const cleaned = line.replace(/[|\t,;]+/g, " ").replace(/\s+/g, " ").trim();
  const m = cleaned.match(/(?:^|\s)(ม\.?\s*)?(\d{1,2}\s*\/\s*\d{1,2}\s*[ก-ฮ]?)\s*$/i);
  if (!m) return { nameText: cleaned, classText: "" };
  return {
    nameText: cleaned.slice(0, m.index).trim(),
    classText: (m[2] || "").replace(/\s+/g, ""),
  };
}

/** Certain enough to apply without a person looking at it. */
const SURE = 0.92;
/** Worth showing as a suggestion, but not applying. */
const MAYBE = 0.72;

export function parseHomeroomText(
  text: string, teachers: Teacher[], flatGroups: StudentGroup[],
): ParsedRow[] {
  const tIndex = teachers.map((t) => ({ t, key: normName(t.name) }));
  const gIndex = flatGroups.map((g) => ({ g, key: normClass(g.name) }));
  const out: ParsedRow[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const { nameText, classText } = splitLine(line);
    const row: ParsedRow = {
      line: i + 1, raw: line, nameText, classText,
      candidates: [], status: "blank", score: 0,
    };

    // A teacher with no class on the line is not an error — plenty of staff
    // advise nobody — but there is nothing to apply, so it is simply skipped.
    if (!classText) { row.status = "blank"; out.push(row); return; }

    const key = normName(nameText);
    if (key) {
      const scored = tIndex
        .map(({ t, key: k }) => ({ teacher: t, score: similarity(key, k) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0], second = scored[1];
      row.candidates = scored.filter((s) => s.score >= MAYBE).slice(0, 3);
      row.score = best?.score ?? 0;
      // Certain, and clearly ahead of whoever came second. Two teachers who
      // genuinely look alike must be decided by a person, not by a hair.
      if (best && best.score >= SURE
          && (!second || best.score - second.score >= 0.05)) {
        row.teacher = best.teacher;
      }
    }

    const gk = normClass(classText);
    row.group = gIndex.find((x) => x.key === gk)?.g;

    row.status = !row.group ? "no-class"
      : row.teacher ? "ok"
      : row.candidates.length ? "ambiguous"
      : "no-teacher";
    out.push(row);
  });

  return out;
}

export interface Conflict {
  groupName: string;
  names: string[];
}

export interface DoubleBooked {
  teacherName: string;
  classNames: string[];
}

/**
 * Teachers the list hands more than one class.
 *
 * One teacher advises one class. A parent and its sub-classes are one class,
 * so a list naming the same teacher for ม.4/6 and ม.4/6ก is not a clash — it
 * is the same assignment written twice, and it collapses to one.
 */
export function findDoubleBooked(
  rows: ParsedRow[], flatGroups: StudentGroup[],
): DoubleBooked[] {
  const by = new Map<number, { name: string; roots: Map<number, string> }>();
  for (const r of rows) {
    if (r.status !== "ok" || !r.group || !r.teacher) continue;
    const root = familyRootId(r.group, flatGroups) ?? r.group.id;
    const e = by.get(r.teacher.id) ?? { name: r.teacher.name, roots: new Map() };
    if (!e.roots.has(root)) {
      e.roots.set(root, flatGroups.find((g) => g.id === root)?.name ?? r.group.name);
    }
    by.set(r.teacher.id, e);
  }
  return [...by.values()]
    .filter((e) => e.roots.size > 1)
    .map((e) => ({ teacherName: e.name, classNames: [...e.roots.values()] }));
}

/**
 * Classes the list gives more than the system allows.
 *
 * Reported rather than trimmed: which two of the three are the real advisors
 * is a staffroom fact, and silently dropping the third would be a decision
 * made by whichever order the lines happened to be in.
 */
export function findOverfilled(
  rows: ParsedRow[], max: number, flatGroups: StudentGroup[],
): Conflict[] {
  const by = new Map<string, string[]>();
  for (const r of rows) {
    if (r.status !== "ok" || !r.group || !r.teacher) continue;
    const root = familyRootId(r.group, flatGroups) ?? r.group.id;
    const key = flatGroups.find((g) => g.id === root)?.name ?? r.group.name;
    const list = by.get(key) ?? [];
    if (!list.includes(r.teacher.name)) list.push(r.teacher.name);
    by.set(key, list);
  }
  return [...by.entries()]
    .filter(([, names]) => names.length > max)
    .map(([groupName, names]) => ({ groupName, names }));
}

/**
 * One update per class, with its advisors in the order they were listed.
 *
 * Written to the class the advisors belong on — the parent, for a line naming
 * a sub-class, since the sub-classes read theirs from it. A list that names
 * both ม.4/6 and ม.4/6ก therefore lands as one entry rather than two that
 * disagree.
 */
export function buildChanges(
  rows: ParsedRow[], max: number, flatGroups: StudentGroup[],
): { groupId: number; teacherIds: number[]; groupName: string }[] {
  const by = new Map<number, { name: string; ids: number[] }>();
  for (const r of rows) {
    if (r.status !== "ok" || !r.group || !r.teacher) continue;
    const root = familyRootId(r.group, flatGroups) ?? r.group.id;
    const name = flatGroups.find((g) => g.id === root)?.name ?? r.group.name;
    const e = by.get(root) ?? { name, ids: [] };
    if (!e.ids.includes(r.teacher.id)) e.ids.push(r.teacher.id);
    by.set(root, e);
  }
  return [...by.entries()].map(([groupId, e]) => ({
    groupId, groupName: e.name, teacherIds: e.ids.slice(0, max),
  }));
}
