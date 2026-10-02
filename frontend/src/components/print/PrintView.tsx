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
import { DAYS } from "../../types";
import { buildSharesStudents, flattenGroups } from "../../utils/groupHierarchy";
import { teachesSlot, myElectiveOption } from "../../utils/teacherSlots";

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

/** One column per unique period_num, in order. */
function getDisplayPeriods(periods: Period[]) {
  const seen = new Map<number, Period>();
  for (const p of periods) if (!seen.has(p.period_num)) seen.set(p.period_num, p);
  return [...seen.values()].sort((a, b) => a.period_num - b.period_num);
}

// ── Sizing: compact when two timetables share a sheet ────────────────────────
interface Metrics {
  headFont: string; timeFont: string; cellFont: string; subFont: string;
  rowH: string; pad: string; titleFont: string; subtitleFont: string; logo: number;
}

const METRICS: Record<1 | 2, Metrics> = {
  1: { headFont: "9pt", timeFont: "7pt", cellFont: "8pt", subFont: "7pt",
       rowH: "15mm", pad: "2px 3px", titleFont: "13pt", subtitleFont: "10pt", logo: 42 },
  2: { headFont: "7pt", timeFont: "5.5pt", cellFont: "6.5pt", subFont: "5.5pt",
       rowH: "9.2mm", pad: "1px 2px", titleFont: "10pt", subtitleFont: "8pt", logo: 28 },
};

const borderCell = (m: Metrics): React.CSSProperties => ({
  border: "1px solid #000",
  padding: m.pad,
  textAlign: "center",
  verticalAlign: "middle",
});

// ── One timetable block (header + grid + signatures) ─────────────────────────
interface BlockProps {
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
  title, subtitle, grid, periods, schoolConfig, metrics: m, compact, renderCell,
}) => {
  const cols = getDisplayPeriods(periods);
  const TH: React.CSSProperties = { ...borderCell(m), fontSize: m.headFont, fontWeight: 700, backgroundColor: "#fff" };
  const TD: React.CSSProperties = { ...borderCell(m), fontSize: m.cellFont, height: m.rowH };
  const BREAK_TH: React.CSSProperties = { ...TH, backgroundColor: "#e5e7eb", fontSize: m.timeFont };
  const BREAK_TD: React.CSSProperties = { ...TD, backgroundColor: "#f3f4f6" };

  return (
    <div className="tt-block" style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
      {/* Header */}
      <div style={{ marginBottom: "3px", display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{
          width: m.logo, height: m.logo, border: "1px solid #ccc", borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: compact ? "12pt" : "16pt", flexShrink: 0,
        }}>🏫</div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: m.titleFont, fontWeight: 700, lineHeight: 1.3 }}>{title}</div>
          <div style={{ fontSize: m.subtitleFont, fontWeight: 600, lineHeight: 1.3 }}>{subtitle}</div>
        </div>
        <div style={{ width: m.logo, flexShrink: 0 }} />
      </div>

      {/* Grid */}
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
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
                {compact ? dayName.slice(0, 2) : dayName}
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
        fontSize: compact ? "6.5pt" : "9pt",
      }}>
        <div style={{ textAlign: "center", minWidth: "40%" }}>
          <div>ลงชื่อ................................</div>
          <div>รองผู้อำนวยการกลุ่มบริหารวิชาการ</div>
        </div>
        <div style={{ textAlign: "center", minWidth: "40%" }}>
          <div>ลงชื่อ................................</div>
          <div>{schoolConfig.directorName ? `(${schoolConfig.directorName})` : "ผู้อำนวยการโรงเรียน"}</div>
        </div>
      </div>
    </div>
  );
};

// ── Cell renderers ───────────────────────────────────────────────────────────
const cellText = (m: Metrics): React.CSSProperties => ({ lineHeight: 1.25, fontSize: m.cellFont });

function GroupCell({ slots, m }: { slots: TimetableSlot[]; m: Metrics }) {
  if (slots.length === 0) return null;
  if (slots.length === 1) {
    const s = slots[0];
    // A shared elective names no subject — the class scatters across its
    // options — so the printed cell says so instead of coming out blank.
    const sharedElective = s.is_elective && !s.selected_option_id;
    return (
      <div style={cellText(m)}>
        <div style={{ fontWeight: 700 }}>
          {s.subject_code ?? s.subject_name ?? (sharedElective ? "วิชาเสรี" : "")}
        </div>
        <div style={{ fontSize: m.subFont }}>
          {s.teacher_name
            ?? (sharedElective ? `${s.elective_options?.length ?? 0} ตัวเลือก` : "")}
        </div>
        <div style={{ fontSize: m.subFont, color: "#555" }}>{s.room_name ?? ""}</div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {slots.map((s) => (
        <div key={s.id} style={{ fontSize: m.subFont, lineHeight: 1.2, borderBottom: "1px dotted #ccc" }}>
          <span style={{ fontWeight: 700 }}>{s.subject_code ?? ""}</span>{" "}
          <span>{s.group_name ?? ""}</span>{" "}
          <span style={{ color: "#555" }}>{s.room_name ?? ""}</span>
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
    <div style={cellText(m)}>
      <div style={{ fontWeight: 700 }}>
        {s.subject_code ?? s.subject_name ?? mine?.code ?? (mine ? "วิชาเสรี" : "")}
      </div>
      <div style={{ fontSize: m.subFont }}>{mine?.label ?? s.group_name ?? ""}</div>
      <div style={{ fontSize: m.subFont, color: "#555" }}>{s.room_name ?? ""}</div>
    </div>
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
          if (options.sort === "code") return (a.code ?? "").localeCompare(b.code ?? "") || a.name.localeCompare(b.name);
          if (options.sort === "department") return deptName(a.department_id).localeCompare(deptName(b.department_id)) || a.name.localeCompare(b.name);
          return a.name.localeCompare(b.name);
        });

      list.forEach((teacher, idx) => {
        const grid = buildGrid(slots.filter((s) => teachesSlot(s, teacher.id)));
        const codePart = teacher.code ? `รหัส ${teacher.code}  ` : "";
        blocks.push(
          <TimetableBlock
            key={`t-${teacher.id}`}
            title={`ตารางสอน ${String(idx + 1).padStart(3, "0")}  ${codePart}${teacher.name}`}
            subtitle={`${termLabel}${deptName(teacher.department_id) ? `  ·  ${deptName(teacher.department_id)}` : ""}`}
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
        .sort((a, b) => (a.level ?? "").localeCompare(b.level ?? "") || a.name.localeCompare(b.name));

      list.forEach((group, idx) => {
        const grid = buildGrid(slots.filter((s) => shares(s.group_id, group.id)));
        blocks.push(
          <TimetableBlock
            key={`g-${group.id}`}
            title={`ตารางเรียน ${String(idx + 1).padStart(3, "0")}  ห้อง ${group.name}`}
            subtitle={termLabel}
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
