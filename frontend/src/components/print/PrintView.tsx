/**
 * PrintView
 * ─────────
 * Print-optimised timetable renderer.
 * • Strips all UI chrome via @media print CSS.
 * • Exactly 1 schedule per A4 Landscape page (page-break-inside: avoid).
 * • Outdoor rooms highlighted amber; double-period cells merged.
 * • Can render a single group's schedule OR a multi-page batch (all groups).
 */
import React, { forwardRef } from "react";
import type { StudentGroup, TimetableSlot } from "../../types";
import { DAYS, GRID_PERIODS } from "../../types";

interface PrintViewProps {
  slots: TimetableSlot[];
  groups: StudentGroup[];
  /** If set, render only this group; if null, render all groups (multi-page). */
  filterGroupId: number | null;
  schoolName?: string;
  academicYear?: string;
}

const SCHEDULABLE = GRID_PERIODS.filter((p) => p.type === "class");

function slotsForGroup(slots: TimetableSlot[], groupId: number) {
  return slots.filter((s) => s.group_id === groupId);
}

function buildGrid(slots: TimetableSlot[]) {
  const map = new Map<string, TimetableSlot[]>();
  for (const s of slots) {
    const k = `${s.day}-${s.period}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(s);
  }
  return map;
}

interface SingleGridProps {
  group: StudentGroup;
  grid: Map<string, TimetableSlot[]>;
}

const SingleGrid: React.FC<SingleGridProps> = ({ group: _group, grid }) => (
  <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "9pt",
      tableLayout: "fixed",
    }}
  >
    <colgroup>
      <col style={{ width: "52px" }} />
      {SCHEDULABLE.map((_, i) => (
        <col key={i} style={{ width: `${(100 - 7) / SCHEDULABLE.length}%` }} />
      ))}
    </colgroup>

    <thead>
      <tr style={{ backgroundColor: "#1d4ed8", color: "white" }}>
        <th style={{ border: "1px solid #bbb", padding: "2px 4px", textAlign: "center" }}>วัน/คาบ</th>
        {SCHEDULABLE.map((pm) => (
          <th
            key={pm.period_num}
            style={{ border: "1px solid #bbb", padding: "2px 4px", textAlign: "center", whiteSpace: "nowrap" }}
          >
            <div style={{ fontWeight: 600 }}>{pm.label}</div>
            <div style={{ fontSize: "7pt", fontWeight: 400 }}>{pm.start_time}–{pm.end_time}</div>
          </th>
        ))}
      </tr>
    </thead>

    <tbody>
      {DAYS.map((dayName, dayIdx) => (
        <tr key={dayIdx}>
          <td
            style={{
              border: "1px solid #bbb",
              padding: "2px 4px",
              textAlign: "center",
              backgroundColor: "#1e40af",
              color: "white",
              fontWeight: 600,
              fontSize: "8pt",
            }}
          >
            {dayName}
          </td>

          {SCHEDULABLE.map((pm) => {
            const cellSlots = grid.get(`${dayIdx}-${pm.period_num}`) ?? [];
            const isOutdoor = cellSlots.some((s) => s.room_type === "outdoor");
            const isHeavy = cellSlots.every((s) => s.subject_weight === "heavy");
            const isParallel = cellSlots.length > 1;

            const cellBg = isOutdoor
              ? "#fef3c7"
              : isHeavy
              ? "#eef2ff"
              : isParallel
              ? "#ecfdf5"
              : "white";

            return (
              <td
                key={pm.period_num}
                style={{
                  border: "1px solid #bbb",
                  padding: "2px",
                  verticalAlign: "top",
                  minHeight: "52px",
                  backgroundColor: cellBg,
                  pageBreakInside: "avoid",
                }}
              >
                {cellSlots.length === 0 ? null : isParallel ? (
                  // Parallel: stack sub-layers
                  <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                    {cellSlots.map((slot) => (
                      <PrintSlotLayer key={slot.id} slot={slot} compact />
                    ))}
                  </div>
                ) : (
                  <PrintSlotLayer slot={cellSlots[0]} />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  </table>
);

interface PrintSlotLayerProps {
  slot: TimetableSlot;
  compact?: boolean;
}

const PrintSlotLayer: React.FC<PrintSlotLayerProps> = ({ slot, compact }) => (
  <div style={{ fontSize: compact ? "7pt" : "8pt", lineHeight: 1.3 }}>
    {slot.room_type === "outdoor" && (
      <div style={{ color: "#92400e", fontWeight: 700, fontSize: "6.5pt" }}>
        ☀ {slot.room_name ?? "กลางแจ้ง"}
      </div>
    )}
    <div style={{ fontWeight: 700, color: "#1e293b" }}>{slot.subject_code ?? slot.subject_name}</div>
    <div style={{ color: "#475569" }}>{slot.teacher_name}</div>
    {!compact && slot.room_type !== "outdoor" && (
      <div style={{ color: "#94a3b8", fontSize: "7pt" }}>{slot.room_name}</div>
    )}
    {slot.is_double_start && (
      <div style={{ color: "#2563eb", fontSize: "6.5pt", fontWeight: 700 }}>⟪ 2 คาบ ⟫</div>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main export – forwardRef so react-to-print can get the DOM node
// ─────────────────────────────────────────────────────────────────────────────
export const PrintView = forwardRef<HTMLDivElement, PrintViewProps>(
  ({ slots, groups, filterGroupId, schoolName = "โรงเรียน", academicYear = "2568" }, ref) => {
    const targetGroups = filterGroupId != null
      ? groups.filter((g) => g.id === filterGroupId)
      : groups.filter((g) => g.parent_id === null || groups.every((gg) => gg.parent_id !== g.id));

    return (
      <div ref={ref} className="print-wrapper">
        <style>{`
          @media print {
            /* Strip all UI chrome */
            body > *:not(.print-wrapper) { display: none !important; }
            nav, aside, header, .no-print { display: none !important; }

            .print-wrapper { display: block !important; }

            /* One schedule per A4 landscape page */
            @page { size: A4 landscape; margin: 10mm; }
            .print-page {
              page-break-after: always;
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .print-page:last-child { page-break-after: auto; }
          }

          @media screen {
            .print-wrapper { display: none; }
          }
        `}</style>

        {targetGroups.map((group) => {
          const groupSlots = slotsForGroup(slots, group.id);
          const grid = buildGrid(groupSlots);
          return (
            <div key={group.id} className="print-page" style={{ fontFamily: "Sarabun, sans-serif" }}>
              {/* Page header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <div>
                  <div style={{ fontSize: "13pt", fontWeight: 700 }}>{schoolName}</div>
                  <div style={{ fontSize: "9pt", color: "#475569" }}>
                    ตารางเรียน – ห้อง {group.name} | ปีการศึกษา {academicYear}
                  </div>
                </div>
                <div style={{ fontSize: "8pt", color: "#94a3b8", textAlign: "right" }}>
                  พิมพ์: {new Date().toLocaleDateString("th-TH")}
                </div>
              </div>

              <SingleGrid group={group} grid={grid} />

              {/* Legend */}
              <div style={{ display: "flex", gap: "12px", marginTop: "4px", fontSize: "7.5pt", color: "#475569" }}>
                <span style={{ background: "#fef3c7", padding: "1px 5px", borderRadius: "3px" }}>☀ กลางแจ้ง</span>
                <span style={{ background: "#eef2ff", padding: "1px 5px", borderRadius: "3px" }}>📚 วิชาหนัก</span>
                <span style={{ background: "#ecfdf5", padding: "1px 5px", borderRadius: "3px" }}>↔ คู่ขนาน</span>
                <span style={{ fontWeight: 700 }}>⟪ 2 คาบ ⟫ = คาบคู่</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  },
);

PrintView.displayName = "PrintView";
