/**
 * PrintView v5 — Thai school timetable, printable on A4.
 *
 * Paper: A4 **portrait**, with an option to fit **two timetables per sheet**
 * (the default) so a whole school costs half the paper. One-per-sheet is still
 * available when the grid needs the room.
 *
 * What gets printed is chosen by the caller through `options`: class timetables
 * or teacher timetables, which ones, and in what order (by name, by กลุ่มสาระ,
 * or by teacher code). Teacher sheets carry the teacher's code in the header.
 */
import React, { forwardRef } from "react";
import type { Department, LessonRequirement, Period, SchoolConfig, StudentGroup, Subject, Teacher, TimetableSlot } from "../../types";
import { DAYS, DAYS_SHORT } from "../../types";
import { buildSharesStudents, flattenGroups, compareNames } from "../../utils/groupHierarchy";
import { myElectiveOption, slotTeacherNames, slotsForTeacher } from "../../utils/teacherSlots";
import { effectiveHomeroomIds } from "../../utils/homeroom";
import { WorkloadReport } from "./WorkloadReport";
import { levelKeyOf, periodsForLevel, combinedPeriods, type LevelKey } from "../../utils/levels";

export type PrintMode = "group" | "teacher" | "workload";
export type PrintSort = "name" | "department" | "code";

export interface PrintOptions {
  mode:        PrintMode;
  /** Which classes / teachers to print. Empty array = every one of them. */
  selectedIds: number[];
  sort:        PrintSort;
  perPage:     1 | 2;
  /**
   * นับคาบกิจกรรม (ลูกเสือ เนตรนารี ชุมนุม) ในอัตรากำลังหรือไม่
   *
   * Some schools count supervising ลูกเสือ towards a teacher's load and some
   * report only subject teaching, so this is the school's call, not ours.
   */
  countActivities: boolean;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  mode: "group", selectedIds: [], sort: "name", perPage: 2, countActivities: true,
};

interface PrintViewProps {
  slots:        TimetableSlot[];
  groups:       StudentGroup[];
  teachers?:    Teacher[];
  departments?: Department[];
  subjects?:    Subject[];
  requirements?: LessonRequirement[];
  periods:      Period[];
  schoolConfig: SchoolConfig;
  options:      PrintOptions;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildGrid(slots: TimetableSlot[]) {
  const map = new Map<string, TimetableSlot[]>();
  for (const s of slots) {
    const k = `${s.day}-${s.period}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(s);
  }
  return map;
}

/**
 * Columns for a sheet, as the class on it actually experiences the day.
 *
 * Deduplicating by period number alone kept whichever row came first and
 * printed one level's lunch break onto the other level's timetable.
 */
function getDisplayPeriods(periods: Period[], level?: LevelKey) {
  return level ? periodsForLevel(periods, level) : combinedPeriods(periods);
}

// ── Sizing: compact when two timetables share a sheet ────────────────────────
interface Metrics {
  headFont: string; timeFont: string; cellFont: string; subFont: string;
  /** The subject code and room number are the two things read at a glance. */
  roomFont: string;
  /** Fixed height per line, so every cell's three lines sit at the same place. */
  lineH: string;
  rowH: string; pad: string; titleFont: string; subtitleFont: string; logo: number;
}

const METRICS: Record<1 | 2, Metrics> = {
  1: { headFont: "11pt", timeFont: "8.5pt", cellFont: "13pt", subFont: "11pt", roomFont: "12pt",
       lineH: "8mm", rowH: "34mm", pad: "3px 4px", titleFont: "15pt", subtitleFont: "11.5pt", logo: 52 },
  2: { headFont: "8.5pt", timeFont: "7pt", cellFont: "9.5pt", subFont: "8.5pt", roomFont: "9pt",
       lineH: "4.2mm", rowH: "15mm", pad: "2px 3px", titleFont: "11.5pt", subtitleFont: "9pt", logo: 34 },
};

const borderCell = (m: Metrics): React.CSSProperties => ({
  border: "1px solid #000",
  padding: m.pad,
  textAlign: "center",
  verticalAlign: "middle",
});

// ── One timetable block (header + grid + signatures) ─────────────────────────
interface BlockProps {
  /** Whose day this sheet shows; omitted for a teacher, who spans both. */
  level?:   LevelKey;
  title:    string;
  subtitle: string;
  grid:     Map<string, TimetableSlot[]>;
  periods:  Period[];
  schoolConfig: SchoolConfig;
  metrics:  Metrics;
  compact:  boolean;
  renderCell: (slots: TimetableSlot[]) => React.ReactNode;
}

const TimetableBlock: React.FC<BlockProps> = ({
  level, title, subtitle, grid, periods, schoolConfig, metrics: m, compact, renderCell,
}) => {
  const cols = getDisplayPeriods(periods, level);

  // What number each column is given at the top of the sheet.
  //
  // Not the stored period_num, and not the label: the school's rows number
  // breaks and lessons in one series, so printing a break's own number next
  // to a lesson's label put the same figure twice in a row ("… 3 3 … 5 5 …").
  // The sheet is counted here instead, left to right: a lesson gets the next
  // number and so does พักกินข้าว, which the school counts as a period of the
  // day. A ten-minute break, โฮมรูม and เคารพธงชาติ get none — they are not
  // periods, and numbering them is what pushed everything out of step.
  const COUNTED = (t?: string) => t === "class" || t === "lunch";
  const printedNum = new Map<number, number>();
  let seq = 0;
  for (const p of cols) if (COUNTED(p.type)) printedNum.set(p.period_num, ++seq);
  const TH: React.CSSProperties = { ...borderCell(m), fontSize: m.headFont, fontWeight: 600, backgroundColor: "#fff" };
  // A minimum, not a fixed height: the rows share whatever the sheet has left.
  const TD: React.CSSProperties = { ...borderCell(m), fontSize: m.cellFont, minHeight: m.rowH };
  // Printed in black and white, so these are true neutral greys (R=G=B),
  // not the blue-tinted ones: a tinted grey shifts when the driver converts
  // it. #f3f4f6 was only 1.10:1 against the white lesson cells — on paper the
  // band was all but invisible, which is half of why the column was hard to
  // read. These sit at 1.43:1 and 1.67:1, visible as a band, while black text
  // on them is 14.7:1 and 12.6:1.
  //
  // They are deliberately LIGHT. A printer in true black-and-white mode
  // thresholds around mid grey, and a darker band (anything from #808080
  // down) flips to solid black and swallows the text. At 216 and 200 these
  // are 88 and 72 steps clear of that, so the worst a 1-bit printer does is
  // drop the tint and leave black text on white — still perfectly readable.
  const BREAK_TH: React.CSSProperties = {
    ...TH, backgroundColor: "#c8c8c8", color: "#000", fontSize: m.headFont,
  };
  const BREAK_TD: React.CSSProperties = { ...TD, backgroundColor: "#d8d8d8" };

  return (
    <div className="tt-block" style={{
      breakInside: "avoid", pageBreakInside: "avoid",
      display: "flex", flexDirection: "column", minHeight: 0,
    }}>
      {/* Header */}
      <div style={{ marginBottom: "3px", display: "flex", alignItems: "center", gap: "8px" }}>
        {schoolConfig.logoUrl ? (
          <img
            src={schoolConfig.logoUrl}
            alt=""
            style={{ width: m.logo, height: m.logo, objectFit: "contain", flexShrink: 0 }}
          />
        ) : (
          <div style={{
            width: m.logo, height: m.logo, border: "1px solid #ccc", borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: compact ? "12pt" : "16pt", flexShrink: 0,
          }}>🏫</div>
        )}
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: m.titleFont, fontWeight: 700, lineHeight: 1.3 }}>{title}</div>
          <div style={{ fontSize: m.subtitleFont, fontWeight: 600, lineHeight: 1.3 }}>{subtitle}</div>
        </div>
        <div style={{ width: m.logo, flexShrink: 0 }} />
      </div>

      {/* Grid */}
      <div className="tt-grid">
      <table style={{
        width: "100%", height: "100%", borderCollapse: "collapse", tableLayout: "fixed",
        /* height 100% inside a flex child that grows: the day rows share the
           sheet's leftover space instead of stopping at a fixed height and
           leaving the bottom of the page empty.
           The outer frame is NOT here — see .tt-grid. A collapsed table draws
           its border centred ON the table edge, so half of it falls outside
           the table's box, and the page clipped that half away. */
      }}>
        <colgroup>
          <col style={{ width: compact ? "34px" : "46px" }} />
          {cols.map((p) =>
            p.type !== "class"
              ? <col key={p.period_num} style={{ width: compact ? "30px" : "42px" }} />
              : <col key={p.period_num} />)}
        </colgroup>

        <thead>
          <tr>
            <th style={TH}>คาบที่</th>
            {cols.map((p) => (
              <th key={p.period_num} style={p.type !== "class" ? BREAK_TH : TH}>
                {printedNum.get(p.period_num) ?? ""}
              </th>
            ))}
          </tr>
          <tr>
            <th style={{ ...TH, fontSize: m.timeFont, fontWeight: 400 }}>เวลา</th>
            {cols.map((p) => (
              <th key={p.period_num}
                  style={{ ...(p.type !== "class" ? BREAK_TH : TH), fontSize: m.timeFont, fontWeight: 400 }}>
                {p.type !== "class" ? "" : `${p.start_time}–${p.end_time}`}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {DAYS.map((dayName, dayIdx) => (
            <tr key={dayIdx}>
              <td style={{ ...TD, fontWeight: 600, fontSize: m.headFont, backgroundColor: "#f9fafb" }}>
                {compact ? DAYS_SHORT[dayIdx] : dayName}
              </td>
              {cols.map((p) => {
                if (p.type !== "class") {
                  // One cell spanning all five days, written once down the
                  // column, rather than an empty box on every row.
                  if (dayIdx > 0) return null;
                  return (
                    <td key={p.period_num} style={{ ...BREAK_TD, padding: 0 }} rowSpan={DAYS.length}>
                      <div style={{
                        writingMode: "vertical-rl", transform: "rotate(180deg)",
                        margin: "0 auto", whiteSpace: "nowrap",
                        fontSize: m.timeFont, color: "#000", fontWeight: 600,
                        letterSpacing: "0.3px",
                      }}>
                        {breakLabel(p)}
                      </div>
                    </td>
                  );
                }
                return (
                  <td key={p.period_num} style={TD}>
                    {/* A full-height wrapper, so the cell's three lines can
                        share the row however tall the row ends up. */}
                    <div style={{ height: "100%", minHeight: m.rowH }}>
                      {renderCell(grid.get(`${dayIdx}-${p.period_num}`) ?? [])}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Signatures. The gap above is deliberate and in millimetres: the grid
          is the flex child that grows, so whatever is reserved here is taken
          off the table rather than added to the page, and the signature line
          stops sitting right on the table's bottom border. */}
      <div style={{
        marginTop: compact ? "6mm" : "10mm",
        display: "flex", justifyContent: "space-between",
        fontSize: compact ? "8pt" : "10pt",
      }}>
        <div style={{ textAlign: "center", minWidth: "40%" }}>
          <div>ลงชื่อ................................</div>
          {schoolConfig.deputyName && <div>({schoolConfig.deputyName})</div>}
          <div>รองผู้อำนวยการกลุ่มบริหารวิชาการ</div>
        </div>
        <div style={{ textAlign: "center", minWidth: "40%" }}>
          <div>ลงชื่อ................................</div>
          {schoolConfig.directorName && <div>({schoolConfig.directorName})</div>}
          <div>ผู้อำนวยการโรงเรียน</div>
        </div>
      </div>
    </div>
  );
};


/**
 * "นางสาวกรรณิการ์ เจริญกิจ" → "กรรณิการ์".
 *
 * A printed cell is a few millimetres wide. The surname is the part nobody
 * needs to tell two teachers apart on a timetable, and the title in front of
 * the given name is three or four characters of the cell spent saying nothing
 * — every teacher has one.
 *
 * Thai titles run together with the name ("นางสาวกรรณิการ์"), so they are
 * stripped off the front of the first word, longest first: take "นาง" off
 * "นางสาวกรรณิการ์" and what is left is "สาวกรรณิการ์". Western titles stand
 * as their own word and are dropped with it.
 */
// Sorted longest-first below, so the list can be written in any order: match
// "นาง" before "นางสาว" and "นางสาวกรรณิการ์" comes out as "สาวกรรณิการ์".
const THAI_TITLES = [
  "นางสาว", "นาง", "นาย", "น.ส.", "ด.ช.", "ด.ญ.", "ครู",
  "ดร.", "ผศ.ดร.", "รศ.ดร.", "ศ.ดร.", "ผศ.", "รศ.", "ศ.",
  "ว่าที่ร้อยตรีหญิง", "ว่าที่ร้อยตรี", "ว่าที่ ร.ต.", "ว่าที่ร.ต.",
  // Ranks: this school has a "สิบตำรวจตรี" on the staff list.
  "สิบตำรวจตรี", "สิบตำรวจโท", "สิบตำรวจเอก", "จ่าสิบตำรวจ",
  "ร้อยตำรวจตรี", "ร้อยตำรวจโท", "ร้อยตำรวจเอก",
  "พันตำรวจตรี", "พันตำรวจโท", "พันตำรวจเอก",
  "จ่าสิบตรี", "จ่าสิบโท", "จ่าสิบเอก",
  "สิบตรี", "สิบโท", "สิบเอก", "ร้อยตรี", "ร้อยโท", "ร้อยเอก",
  "พันตรี", "พันโท", "พันเอก",
  "ด.ต.", "ส.ต.ต.", "ส.ต.ท.", "ส.ต.อ.", "ร.ต.ต.",
].sort((a, b) => b.length - a.length);
const WESTERN_TITLE = /^(mr|mrs|miss|ms|dr|prof|master|sir)\.?$/i;
/** The same titles written hard against the name: "Mr.Charles", "Mr.Hu". */
const WESTERN_GLUED = /^(mr|mrs|miss|ms|dr|prof)\.\s*(?=\S)/i;

/**
 * The teacher line inside one printed cell.
 *
 * A lesson has one name, สอนร่วม has two, and a ลูกเสือ period can have four
 * standing with the same class. Four names do not fit a timetable cell: set
 * side by side they shrink the subject code to nothing or spill over the
 * border, and a printed sheet has no tooltip to recover them from. So past
 * two the cell counts instead, and the group sheet stays readable.
 */
function teacherLine(s: TimetableSlot): string {
  const names = slotTeacherNames(s).map(shortTeacher).filter(Boolean);
  if (names.length <= 2) return names.join(" + ");
  // A ลูกเสือ roster is a list the school keeps, not a cell caption: the
  // first name carries no more meaning than the twelfth, so the cell counts.
  if (s.is_activity_block) return `ครู ${names.length} คน`;
  return `${names[0]} +${names.length - 1} คน`;
}

function shortTeacher(name: string | null | undefined): string {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";

  // "Mr. Charles" / "Miss Risen" — the title is a word of its own.
  let rest = parts;
  if (WESTERN_TITLE.test(parts[0])) {
    rest = parts.slice(1);
    if (rest.length === 0) return parts[0];   // nothing but a title; keep it
  }

  // "Mr.Charles" — the same title with the space left out, which the
  // whole-word test above cannot see.
  let first = rest[0].replace(WESTERN_GLUED, "");
  if (!first) first = rest[0];
  for (const t of THAI_TITLES) {
    if (first.startsWith(t)) {
      const stripped = first.slice(t.length);
      // Only drop the title if a name is actually left behind, so someone
      // recorded as just "นาย" does not come out as an empty cell.
      if (stripped) first = stripped;
      break;                                   // longest match wins, once
    }
  }
  return first;
}

/**
 * "131 ห้องคอมฯ3" → "131".
 *
 * Which room matters most in the cell and is what people look for, so it is
 * printed large and bold while the name is dropped — the number is on the door.
 */
function roomNumber(room: string | null | undefined): string {
  if (!room) return "";
  const m = String(room).trim().match(/^([0-9][0-9.\-/]*)\b/);
  return m ? m[1] : String(room).trim();
}


/** "ม.4/2" → "4/2". The "ม." is on every row and tells the reader nothing. */
function shortClass(name: string | null | undefined): string {
  return String(name ?? "").replace(/^ม\.?\s*/, "");
}

/** "พัก 10 นาที" → "พัก 10". Enough to name the column without filling it. */
/**
 * The full story of a non-lesson column: what it is, how long, and when.
 *
 * This used to be cut down to one or two words — "พัก 10" with the "นาที"
 * removed, and the "(ม.1-3)" taken off the lunch column, which left it
 * reading simply "พัก". Two levels break at different times here, so a bare
 * "พัก" is exactly the thing people have to ask about. The column is written
 * down the page across all five days, so there is room to answer it.
 *
 * Reads: "พัก 10 นาที · 10:10–10:20", "กินข้าว ม.ต้น · 50 นาที · 12:00–12:50".
 */
function breakLabel(p: {
  label?: string; type?: string; applies_to?: string;
  start_time?: string | null; end_time?: string | null;
}): string {
  const parts: string[] = [];

  // 1. The school's own wording, kept whole. "(ม.1-3)" becomes "ม.ต้น" —
  //    same meaning, and it is how the staffroom says it.
  let name = String(p.label ?? "").trim()
    .replace(/\(\s*ม\.?\s*1\s*[-–]\s*3\s*\)/g, "ม.ต้น")
    .replace(/\(\s*ม\.?\s*4\s*[-–]\s*6\s*\)/g, "ม.ปลาย")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) {
    name = p.type === "lunch" ? "พักกินข้าว"
      : p.type === "homeroom" ? "โฮมรูม"
      : p.type === "assembly" ? "เคารพธงชาติ"
      : "พัก";
  }
  // 2. Which level, when the label does not already say and the row is for
  //    one of them only.
  if (!/ม\.(ต้น|ปลาย)/.test(name)) {
    if (p.applies_to === "lower") name += " ม.ต้น";
    else if (p.applies_to === "upper") name += " ม.ปลาย";
  }
  parts.push(name);

  // 3. How long, unless the label already counted the minutes itself.
  const mins = minutesBetween(p.start_time, p.end_time);
  if (mins != null && mins > 0 && !/\d\s*นาที/.test(name)) {
    parts.push(`${mins} นาที`);
  }

  // 4. When — only if both ends are really times. A half-filled or mistyped
  //    row otherwise prints its own garbage onto the sheet.
  if (hhmm(p.start_time) && hhmm(p.end_time)) {
    parts.push(`${hhmm(p.start_time)}–${hhmm(p.end_time)}`);
  }

  return parts.join("  ·  ");
}

/** "10:10" if it reads as a time, otherwise null. */
function hhmm(t?: string | null): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Minutes from "10:10" to "10:20". null if either side is unreadable. */
function minutesBetween(a?: string | null, b?: string | null): number | null {
  const toMin = (t?: string | null) => {
    const v = hhmm(t);
    if (!v) return null;
    return Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  };
  const s = toMin(a), e = toMin(b);
  if (s == null || e == null) return null;
  return e - s;
}

// ── Cell renderers ───────────────────────────────────────────────────────────
const cellText = (m: Metrics): React.CSSProperties => ({ lineHeight: 1.1, fontSize: m.cellFont });

/**
 * The three lines every cell has: subject code, teacher, room.
 *
 * Each line is a fixed height whether or not it has anything in it, so the
 * codes across a row sit on one line, the teachers on the next and the rooms
 * on the next — instead of every cell starting wherever its own content ended.
 */
function CellLines(
  { m, code, mid, room }: { m: Metrics; code: string; mid: string; room: string },
) {
  // Each line takes a third of the cell. Equal shares keep the codes across a
  // row on one line and the rooms on another, and because they are shares
  // rather than fixed heights they grow with the cell when the grid stretches
  // to fill the sheet.
  const line: React.CSSProperties = {
    flex: "1 1 0", minHeight: m.lineH,
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden", whiteSpace: "nowrap",
  };
  return (
    <div style={{ ...cellText(m), display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ ...line, fontSize: m.cellFont, fontWeight: 600, color: "#111827" }}>{code}</div>
      <div style={{ ...line, fontSize: m.subFont, color: "#4b5563" }}>{mid}</div>
      <div style={{ ...line, fontSize: m.roomFont, fontWeight: 500, color: "#1f2937" }}>{room}</div>
    </div>
  );
}

function GroupCell({ slots, m }: { slots: TimetableSlot[]; m: Metrics }) {
  if (slots.length === 0) return null;
  if (slots.length === 1) {
    const s = slots[0];
    // A shared elective names no subject — the class scatters across its
    // options — so the printed cell says so instead of coming out blank.
    const sharedElective = s.is_elective && !s.selected_option_id;
    return (
      <CellLines
        m={m}
        code={s.subject_code ?? s.subject_name ?? (sharedElective ? "วิชาเสรี" : "")}
        mid={teacherLine(s) || (sharedElective ? `${s.elective_options?.length ?? 0} ตัวเลือก` : "")}
        room={roomNumber(s.room_name)}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {slots.map((s) => (
        <div key={s.id} style={{ fontSize: m.subFont, lineHeight: 1.25, borderBottom: "1px dotted #ccc" }}>
          <span style={{ fontWeight: 600 }}>{s.subject_code ?? ""}</span>{" "}
          <span>{shortClass(s.group_name)}</span>{" "}
          <span style={{ fontWeight: 500 }}>{roomNumber(s.room_name)}</span>
        </div>
      ))}
    </div>
  );
}

function TeacherCell({ slots, m, teacherId }: { slots: TimetableSlot[]; m: Metrics; teacherId?: number }) {
  if (slots.length === 0) return null;
  const s = slots[0];
  // In a shared elective the class cell names nobody, but THIS teacher does
  // teach one of its options — print that subject, not an empty box.
  const mine = teacherId != null ? myElectiveOption(s, teacherId) : null;
  return (
    <CellLines
      m={m}
      code={s.subject_code ?? s.subject_name ?? mine?.code ?? (mine ? "วิชาเสรี" : "")}
      // A คาบกิจกรรม is run for many classrooms at once and the school splits
      // them between the ครูผู้ดูแล themselves, so naming one of the fourteen
      // here would be picking a room at random.
      mid={mine?.label ?? (s.is_activity_block && s.activity_scope
            ? s.activity_scope
            : shortClass(s.group_name))}
      room={roomNumber(s.room_name)}
    />
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export const PrintView = forwardRef<HTMLDivElement, PrintViewProps>(
  ({ slots, groups, teachers = [], departments = [], subjects = [],
     requirements = [], periods, schoolConfig, options }, ref) => {
    const termLabel = `ภาคเรียนที่ ${schoolConfig.term}/${schoolConfig.year}  โรงเรียน${schoolConfig.schoolName}`;
    const m = METRICS[options.perPage];
    const compact = options.perPage === 2;
    const pick = new Set(options.selectedIds);

    // Build one block per class / teacher, in the requested order.
    const blocks: React.ReactNode[] = [];

    if (options.mode === "workload") {
      // handled below, outside the sheet packer
    } else if (options.mode === "teacher") {
      const deptName = (id: number | null | undefined) =>
        departments.find((d) => d.id === id)?.name ?? "";
      const list = teachers
        .filter((t) => pick.size === 0 || pick.has(t.id))
        .sort((a, b) => {
          if (options.sort === "code") return (a.code ?? "").localeCompare(b.code ?? "") || compareNames(a.name, b.name);
          if (options.sort === "department") return deptName(a.department_id).localeCompare(deptName(b.department_id)) || compareNames(a.name, b.name);
          return compareNames(a.name, b.name);
        });

      list.forEach((teacher, idx) => {
        const grid = buildGrid(slotsForTeacher(slots, teacher.id));
        const codePart = teacher.code ? `รหัสประจำตัว ${teacher.code}` : "";
        blocks.push(
          <TimetableBlock
            key={`t-${teacher.id}`}
            title={`ตารางสอน ${String(idx + 1).padStart(3, "0")}  ${teacher.name}`}
            subtitle={[codePart, deptName(teacher.department_id), termLabel]
              .filter(Boolean).join("  ·  ")}
            grid={grid} periods={periods} schoolConfig={schoolConfig}
            metrics={m} compact={compact}
            renderCell={(cs) => <TeacherCell slots={cs} m={m} teacherId={teacher.id} />}
          />,
        );
      });
    } else {
      // A class sheet shows its own lessons plus any shared with parent/subgroups.
      const shares = buildSharesStudents(groups);
      const flat = flattenGroups(groups);
      const list = flat
        .filter((g) => pick.size === 0 || pick.has(g.id))
        .sort((a, b) => compareNames(a.level ?? "", b.level ?? "") || compareNames(a.name, b.name));

      list.forEach((group, idx) => {
        const grid = buildGrid(slots.filter((s) => shares(s.group_id, group.id)));
        // Who to ask about this class's timetable — named on the sheet, with
        // the code, so a printed copy identifies itself without the system.
        // All of them: a class may have up to three ครูประจำชั้น, and a sheet
        // naming only the first sends parents to the wrong one.
        // A sub-class takes the advisors recorded on the class above it, so
        // ม.4/6ก's sheet names the same people as ม.4/6's rather than nobody.
        const advisors = effectiveHomeroomIds(group, flat)
          .map((id) => teachers.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => !!t)
          .map((t) => `${t.code ? `${t.code} ` : ""}${shortTeacher(t.name)}`);
        const advisorLabel = advisors.length
          ? `  ·  ครูประจำชั้น ${advisors.join(" , ")}`
          : "";
        blocks.push(
          <TimetableBlock
            key={`g-${group.id}`}
            level={levelKeyOf(group)}
            title={`ตารางเรียน ${String(idx + 1).padStart(3, "0")}  ห้อง ${group.name}`}
            subtitle={`${termLabel}${advisorLabel}`}
            grid={grid} periods={periods} schoolConfig={schoolConfig}
            metrics={m} compact={compact}
            renderCell={(cs) => <GroupCell slots={cs} m={m} />}
          />,
        );
      });
    }

    // Pack the blocks onto sheets.
    const sheets: React.ReactNode[][] = [];
    for (let i = 0; i < blocks.length; i += options.perPage) {
      sheets.push(blocks.slice(i, i + options.perPage));
    }

    return (
      <div ref={ref} className="print-wrapper">
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
          .print-wrapper { font-family: 'Sarabun','TH Sarabun New',Arial,sans-serif; }
          .print-page { width: 190mm; }
          .tt-block + .tt-block { margin-top: 5mm; padding-top: 3mm; border-top: 1px dashed #bbb; }
          /* The frame round the whole timetable. It is on this wrapper rather
             than on the table because a div's border is drawn inside its own
             box: nothing hangs over the page edge for overflow:hidden to clip,
             so the grid closes on all four sides and the last column ends in a
             border like every other one. */
          .tt-grid { border: 1.4px solid #000; box-sizing: border-box; }
          /* Fill the sheet top to bottom. The page is a flex column of the
             exact printable height; each block takes an equal share of it and
             its grid stretches into that share, so the cells are full-height
             whether there are one or two tables on the sheet. */
          @media print {
            .print-page {
              display: flex; flex-direction: column;
              height: 281mm; max-height: 281mm; overflow: hidden;
            }
            .tt-block { flex: 1 1 0; min-height: 0; }
            .tt-grid  { flex: 1 1 auto; min-height: 0; }
          }
          @media print {
            body > *:not(.print-wrapper) { display: none !important; }
            .no-print { display: none !important; }
            .print-wrapper { display: block !important; }
            @page { size: A4 portrait; margin: 8mm 10mm; }
            .print-page { page-break-after: always; break-after: page; page-break-inside: avoid; width: auto; }
            .print-page:last-child { page-break-after: auto; break-after: auto; }
          }
          @media screen { .print-wrapper { display: none; } }
        `}</style>

        {/* อัตรากำลัง is a different document, not a timetable laid out
            differently — one page per teacher, listing what they carry. */}
        {options.mode === "workload" ? (
          <WorkloadReport
            teachers={teachers} departments={departments} groups={groups}
            subjects={subjects} requirements={requirements} slots={slots}
            schoolName={schoolConfig.schoolName} termLabel={termLabel}
            selectedIds={options.selectedIds} sort={options.sort}
            countActivities={options.countActivities !== false}
          />
        ) : sheets.length > 0 ? (
          sheets.map((sheet, i) => (
            <div key={i} className="print-page">{sheet}</div>
          ))
        ) : (
          <div className="print-page" style={{ padding: "20mm" }}>
            <p>ไม่มีตารางที่ตรงกับตัวเลือกการพิมพ์</p>
          </div>
        )}
      </div>
    );
  },
);

PrintView.displayName = "PrintView";
