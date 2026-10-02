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
import type { Department, Period, SchoolConfig, StudentGroup, Teacher, TimetableSlot } from "../../types";
import { DAYS, DAYS_SHORT } from "../../types";
import { buildSharesStudents, flattenGroups, compareNames } from "../../utils/groupHierarchy";
import { teachesSlot, myElectiveOption } from "../../utils/teacherSlots";
import { levelKeyOf, periodsForLevel, combinedPeriods, type LevelKey } from "../../utils/levels";

export type PrintMode = "group" | "teacher";
export type PrintSort = "name" | "department" | "code";

export interface PrintOptions {
  mode:        PrintMode;
  /** Which classes / teachers to print. Empty array = every one of them. */
  selectedIds: number[];
  sort:        PrintSort;
  perPage:     1 | 2;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  mode: "group", selectedIds: [], sort: "name", perPage: 2,
};

interface PrintViewProps {
  slots:        TimetableSlot[];
  groups:       StudentGroup[];
  teachers?:    Teacher[];
  departments?: Department[];
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
  1: { headFont: "11pt", timeFont: "8.5pt", cellFont: "15pt", subFont: "9.5pt", roomFont: "15pt",
       lineH: "11mm", rowH: "40mm", pad: "3px 4px", titleFont: "15pt", subtitleFont: "11.5pt", logo: 52 },
  2: { headFont: "8.5pt", timeFont: "7pt", cellFont: "11pt", subFont: "7.5pt", roomFont: "11pt",
       lineH: "5.3mm", rowH: "19mm", pad: "2px 3px", titleFont: "11.5pt", subtitleFont: "9pt", logo: 34 },
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
  const TH: React.CSSProperties = { ...borderCell(m), fontSize: m.headFont, fontWeight: 700, backgroundColor: "#fff" };
  const TD: React.CSSProperties = { ...borderCell(m), fontSize: m.cellFont, height: m.rowH };
  const BREAK_TH: React.CSSProperties = { ...TH, backgroundColor: "#e5e7eb", fontSize: m.timeFont };
  const BREAK_TD: React.CSSProperties = { ...TD, backgroundColor: "#f3f4f6" };

  return (
    <div className="tt-block" style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
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
      <table style={{
        width: "100%", borderCollapse: "collapse", tableLayout: "fixed",
        border: "1.2px solid #000",     /* the outer frame, which collapsed
                                           borders alone were leaving open */
      }}>
        <colgroup>
          <col style={{ width: compact ? "34px" : "46px" }} />
          {cols.map((p) =>
            p.type !== "class"
              ? <col key={p.period_num} style={{ width: compact ? "16px" : "26px" }} />
              : <col key={p.period_num} />)}
        </colgroup>

        <thead>
          <tr>
            <th style={TH}>คาบที่</th>
            {cols.map((p) => (
              <th key={p.period_num} style={p.type !== "class" ? BREAK_TH : TH}>
                {p.type !== "class" ? "พัก" : p.label.replace(/^คาบ\s*/, "")}
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
              <td style={{ ...TD, fontWeight: 700, fontSize: m.headFont, backgroundColor: "#f9fafb" }}>
                {compact ? DAYS_SHORT[dayIdx] : dayName}
              </td>
              {cols.map((p) => {
                if (p.type !== "class") return <td key={p.period_num} style={BREAK_TD} />;
                return (
                  <td key={p.period_num} style={TD}>
                    {renderCell(grid.get(`${dayIdx}-${p.period_num}`) ?? [])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Signatures */}
      <div style={{
        marginTop: compact ? "4px" : "10px",
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
 * "นางสาวกรรณิการ์ เจริญกิจ" → "นางสาวกรรณิการ์".
 *
 * A printed cell is a few millimetres wide; a full name with a surname wraps or
 * is cut, and the surname is the part nobody needs to tell two teachers apart
 * on a timetable.
 */
function shortTeacher(name: string | null | undefined): string {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  // A Thai title is glued to the given name ("นางสาวกรรณิการ์"), so the first
  // word is already the whole thing. A Western title stands alone, and
  // dropping everything after it would leave just "Miss".
  const TITLES = /^(mr|mrs|miss|ms|dr|prof|master)\.?$/i;
  if (TITLES.test(parts[0]) && parts.length > 1) return `${parts[0]} ${parts[1]}`;
  return parts[0];
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
  const line = (h: string): React.CSSProperties => ({
    height: h, display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden", whiteSpace: "nowrap",
  });
  return (
    <div style={{ ...cellText(m), display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ ...line(m.lineH), fontSize: m.cellFont, fontWeight: 700 }}>{code}</div>
      <div style={{ ...line(m.lineH), fontSize: m.subFont }}>{mid}</div>
      <div style={{ ...line(m.lineH), fontSize: m.roomFont, fontWeight: 700 }}>{room}</div>
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
        mid={shortTeacher(s.teacher_name)
          || (sharedElective ? `${s.elective_options?.length ?? 0} ตัวเลือก` : "")}
        room={roomNumber(s.room_name)}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {slots.map((s) => (
        <div key={s.id} style={{ fontSize: m.subFont, lineHeight: 1.25, borderBottom: "1px dotted #ccc" }}>
          <span style={{ fontWeight: 700 }}>{s.subject_code ?? ""}</span>{" "}
          <span>{s.group_name ?? ""}</span>{" "}
          <span style={{ fontWeight: 700 }}>{roomNumber(s.room_name)}</span>
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
      mid={mine?.label ?? s.group_name ?? ""}
      room={roomNumber(s.room_name)}
    />
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export const PrintView = forwardRef<HTMLDivElement, PrintViewProps>(
  ({ slots, groups, teachers = [], departments = [], periods, schoolConfig, options }, ref) => {
    const termLabel = `ภาคเรียนที่ ${schoolConfig.term}/${schoolConfig.year}  โรงเรียน${schoolConfig.schoolName}`;
    const m = METRICS[options.perPage];
    const compact = options.perPage === 2;
    const pick = new Set(options.selectedIds);

    // Build one block per class / teacher, in the requested order.
    const blocks: React.ReactNode[] = [];

    if (options.mode === "teacher") {
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
        const grid = buildGrid(slots.filter((s) => teachesSlot(s, teacher.id)));
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
        const advisor = teachers.find((t) => t.id === group.homeroom_teacher_id);
        const advisorLabel = advisor
          ? `  ·  ครูประจำชั้น ${advisor.code ? `${advisor.code} ` : ""}${advisor.name}`
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
          .tt-block + .tt-block { margin-top: 6mm; padding-top: 4mm; border-top: 1px dashed #bbb; }
          /* Fill the sheet top to bottom rather than leaving the lower half
             blank: the blocks share the height between them. */
          @media print {
            .print-page {
              display: flex; flex-direction: column; justify-content: space-between;
              height: 281mm;
            }
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

        {sheets.length > 0 ? (
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
