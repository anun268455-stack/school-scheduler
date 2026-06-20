/**
 * PrintView v4 — Pixel-perfect replica of Thai school timetable format.
 * Matches the reference layout: header + period row + time row + day rows + signature footer.
 * Supports: group view (ตารางเรียน) and teacher view (ตารางสอน).
 */
import React, { forwardRef } from "react";
import type { Period, SchoolConfig, StudentGroup, Teacher, TimetableSlot } from "../../types";
import { DAYS } from "../../types";

interface PrintViewProps {
  slots:         TimetableSlot[];
  groups:        StudentGroup[];
  teachers?:     Teacher[];
  periods:       Period[];
  schoolConfig:  SchoolConfig;
  filterGroupId:   number | null;
  filterTeacherId?: number | null;
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

/** Deduplicate period_num and sort — produces one column per unique period_num */
function getDisplayPeriods(periods: Period[]) {
  const seen = new Map<number, Period>();
  for (const p of periods) {
    if (!seen.has(p.period_num)) seen.set(p.period_num, p);
  }
  return Array.from(seen.values()).sort((a, b) => a.period_num - b.period_num);
}

// ── Styles (inline for print-safe rendering) ─────────────────────────────────
const TH: React.CSSProperties = {
  border: "1px solid #000",
  padding: "3px 4px",
  textAlign: "center",
  verticalAlign: "middle",
  fontSize: "8.5pt",
  fontWeight: 700,
  backgroundColor: "#fff",
};

const TD: React.CSSProperties = {
  border: "1px solid #000",
  padding: "3px 4px",
  textAlign: "center",
  verticalAlign: "middle",
  fontSize: "8.5pt",
  minHeight: "52px",
  height: "52px",
};

const BREAK_TH: React.CSSProperties = {
  ...TH,
  backgroundColor: "#e5e7eb",
  fontSize: "7.5pt",
  width: "32px",
};

const BREAK_TD: React.CSSProperties = {
  ...TD,
  backgroundColor: "#f3f4f6",
  width: "32px",
};

// ── Single timetable page ─────────────────────────────────────────────────────
interface PageProps {
  title:     string;       // e.g. "ตารางสอน 001  นายสมชาย ใจดี"
  subtitle:  string;       // e.g. "ภาคเรียนที่ 1/2568  โรงเรียนราชวินิต นนทบุรี"
  grid:      Map<string, TimetableSlot[]>;
  periods:   Period[];
  schoolConfig: SchoolConfig;
  /** How to render a slot cell */
  renderCell: (slots: TimetableSlot[], period: Period) => React.ReactNode;
}

const TimetablePage: React.FC<PageProps> = ({ title, subtitle, grid, periods, schoolConfig, renderCell }) => {
  const cols = getDisplayPeriods(periods);

  return (
    <div
      className="print-page"
      style={{
        fontFamily: "'Sarabun', 'TH Sarabun New', 'Arial', sans-serif",
        width: "100%",
        pageBreakAfter: "always",
        pageBreakInside: "avoid",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "10px" }}>
        {/* Logo placeholder */}
        <div style={{
          width: 48, height: 48, border: "1px solid #ccc", borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "18pt", flexShrink: 0,
        }}>🏫</div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: "12pt", fontWeight: 700, lineHeight: 1.4 }}>
            {title}
          </div>
          <div style={{ fontSize: "10pt", fontWeight: 600, lineHeight: 1.4 }}>
            {subtitle}
          </div>
        </div>
      </div>

      {/* ── Timetable table ────────────────────────────────────────────── */}
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "50px" }} />
          {cols.map((p) =>
            p.type !== "class"
              ? <col key={p.period_num} style={{ width: "32px" }} />
              : <col key={p.period_num} />
          )}
        </colgroup>

        <thead>
          {/* Row 1: คาบที่ */}
          <tr>
            <th style={{ ...TH, fontSize: "9pt" }}>คาบที่</th>
            {cols.map((p) => (
              <th key={p.period_num} style={p.type !== "class" ? BREAK_TH : TH}>
                {p.type !== "class" ? "พัก" : String(p.period_num)}
              </th>
            ))}
          </tr>

          {/* Row 2: เวลา */}
          <tr>
            <th style={{ ...TH, fontSize: "7.5pt" }}>เวลา</th>
            {cols.map((p) => (
              <th key={p.period_num} style={{ ...(p.type !== "class" ? BREAK_TH : TH), fontSize: "7pt", fontWeight: 400 }}>
                {p.start_time}–{p.end_time}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {DAYS.map((dayName, dayIdx) => (
            <tr key={dayIdx}>
              {/* Day label */}
              <td style={{
                ...TD,
                fontWeight: 700,
                fontSize: "9.5pt",
                backgroundColor: "#f9fafb",
                width: "50px",
              }}>
                {dayName}
              </td>

              {cols.map((p) => {
                if (p.type !== "class") {
                  return (
                    <td key={p.period_num} style={BREAK_TD}>
                      <div style={{ fontSize: "6.5pt", color: "#6b7280", writingMode: "vertical-rl" }}>พัก</div>
                    </td>
                  );
                }
                const cellSlots = grid.get(`${dayIdx}-${p.period_num}`) ?? [];
                return (
                  <td key={p.period_num} style={TD}>
                    {renderCell(cellSlots, p)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Footer signatures ──────────────────────────────────────────── */}
      <div style={{
        marginTop: "12px",
        display: "flex",
        justifyContent: "space-between",
        fontSize: "9pt",
      }}>
        <div style={{ textAlign: "center", minWidth: "220px" }}>
          <div>ลงชื่อ................................</div>
          <div style={{ marginTop: "2px" }}>รองผู้อำนวยการกลุ่มบริหารวิชาการ</div>
        </div>
        <div style={{ textAlign: "center", minWidth: "220px" }}>
          <div>ลงชื่อ................................</div>
          <div style={{ marginTop: "2px" }}>
            {schoolConfig.directorName ? `(${schoolConfig.directorName})` : "ผู้อำนวยการโรงเรียน"}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Cell renderers ────────────────────────────────────────────────────────────

/** Group timetable cell: subject code / teacher / room */
function GroupCell({ slots }: { slots: TimetableSlot[] }) {
  if (slots.length === 0) return null;
  if (slots.length === 1) {
    const s = slots[0];
    return (
      <div style={{ lineHeight: 1.45, fontSize: "8pt" }}>
        <div style={{ fontWeight: 700 }}>{s.subject_code ?? s.subject_name ?? ""}</div>
        <div style={{ fontSize: "7.5pt" }}>{s.teacher_name ?? ""}</div>
        <div style={{ fontSize: "7pt", color: "#555" }}>{s.room_name ?? ""}</div>
      </div>
    );
  }
  // Parallel: show multiple
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {slots.map((s) => (
        <div key={s.id} style={{ lineHeight: 1.3, fontSize: "7pt", borderBottom: "1px dotted #ccc", paddingBottom: "1px" }}>
          <div style={{ fontWeight: 700 }}>{s.subject_code ?? ""}</div>
          <div>{s.group_name ?? ""}</div>
          <div style={{ color: "#555" }}>{s.room_name ?? ""}</div>
        </div>
      ))}
    </div>
  );
}

/** Teacher timetable cell: subject code / group / room — matches reference image exactly */
function TeacherCell({ slots }: { slots: TimetableSlot[] }) {
  if (slots.length === 0) return null;
  const s = slots[0];
  return (
    <div style={{ lineHeight: 1.5, fontSize: "8.5pt" }}>
      <div style={{ fontWeight: 700 }}>{s.subject_code ?? s.subject_name ?? ""}</div>
      <div style={{ fontSize: "8pt" }}>{s.group_name ?? ""}</div>
      <div style={{ fontSize: "7.5pt", color: "#444" }}>{s.room_name ?? ""}</div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export const PrintView = forwardRef<HTMLDivElement, PrintViewProps>(
  ({ slots, groups, teachers = [], periods, schoolConfig, filterGroupId, filterTeacherId }, ref) => {

    const termLabel = `ภาคเรียนที่ ${schoolConfig.term}/${schoolConfig.year}  โรงเรียน${schoolConfig.schoolName}`;

    // Determine which pages to render
    const pages: React.ReactNode[] = [];

    if (filterTeacherId != null) {
      // ── Teacher view: one page per teacher (or filtered teacher) ──────
      const teachersToRender = filterTeacherId
        ? teachers.filter((t) => t.id === filterTeacherId)
        : teachers;

      teachersToRender.forEach((teacher, idx) => {
        const teacherSlots = slots.filter((s) => s.teacher_id === teacher.id);
        const grid = buildGrid(teacherSlots);
        pages.push(
          <TimetablePage
            key={`t-${teacher.id}`}
            title={`ตารางสอน ${String(idx + 1).padStart(3, "0")}  ${teacher.name}`}
            subtitle={termLabel}
            grid={grid}
            periods={periods}
            schoolConfig={schoolConfig}
            renderCell={(cellSlots) => <TeacherCell slots={cellSlots} />}
          />
        );
      });
    } else {
      // ── Group view: one page per group ─────────────────────────────────
      const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);
      const groupsToRender = filterGroupId != null
        ? flat.filter((g) => g.id === filterGroupId)
        : groups; // top-level only for batch

      groupsToRender.forEach((group, idx) => {
        const groupSlots = slots.filter((s) => s.group_id === group.id);
        const grid = buildGrid(groupSlots);
        pages.push(
          <TimetablePage
            key={`g-${group.id}`}
            title={`ตารางเรียน ${String(idx + 1).padStart(3, "0")}  ห้อง ${group.name}`}
            subtitle={termLabel}
            grid={grid}
            periods={periods}
            schoolConfig={schoolConfig}
            renderCell={(cellSlots) => <GroupCell slots={cellSlots} />}
          />
        );
      });
    }

    return (
      <div ref={ref} className="print-wrapper">
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');

          @media print {
            body > *:not(.print-wrapper) { display: none !important; }
            .no-print { display: none !important; }
            .print-wrapper { display: block !important; }
            @page { size: A4 landscape; margin: 8mm 10mm; }
            .print-page { page-break-after: always; page-break-inside: avoid; }
            .print-page:last-child { page-break-after: auto; }
          }
          @media screen {
            .print-wrapper { display: none; }
          }
        `}</style>

        {pages.length > 0 ? pages : (
          <div className="print-page" style={{ padding: "20mm", fontFamily: "Sarabun, sans-serif" }}>
            <p>ยังไม่มีข้อมูลตาราง</p>
          </div>
        )}
      </div>
    );
  }
);

PrintView.displayName = "PrintView";
