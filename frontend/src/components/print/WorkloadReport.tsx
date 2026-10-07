/**
 * อัตรากำลังการสอน — what each teacher carries, on paper.
 *
 * Not a timetable. A timetable answers "where am I at 10:10"; this answers
 * "what am I responsible for this term", which is the question the academic
 * office is asked for by the district: subject, code, which classes, which
 * rooms, how many periods a week, and a blank column to write in.
 *
 * Built from the placed timetable rather than from the lesson requirements,
 * because the rooms only exist once the timetable is made, and a requirement
 * that failed to place should not be reported as teaching that is happening.
 * Requirements the timetable never placed are listed separately, as a
 * shortfall, instead of being quietly left out.
 */
import React from "react";
import type {
  Department, LessonRequirement, StudentGroup, Subject, Teacher, TimetableSlot,
} from "../../types";
import { flattenGroups, compareNames } from "../../utils/groupHierarchy";
import { teachesSlot } from "../../utils/teacherSlots";

/** "ม.4/2" → "4/2": the "ม." is on every row and tells the reader nothing. */
const shortClass = (n: string | null | undefined) =>
  String(n ?? "").replace(/^ม\.?\s*/, "");

/** "131 ห้องคอมฯ3" → "131". The number is what is on the door. */
const roomNumber = (n: string | null | undefined) => {
  const m = String(n ?? "").trim().match(/^([0-9][0-9.\-/]*)\b/);
  return m ? m[1] : String(n ?? "").trim();
};

interface Row {
  subjectCode: string;
  subjectName: string;
  classes: string[];
  rooms: string[];
  periods: number;
}

export interface WorkloadProps {
  teachers: Teacher[];
  departments: Department[];
  groups: StudentGroup[];
  subjects: Subject[];
  requirements: LessonRequirement[];
  slots: TimetableSlot[];
  schoolName: string;
  termLabel: string;
  /** Empty = every teacher. */
  selectedIds: number[];
  sort: "name" | "code" | "department";
}

export const WorkloadReport: React.FC<WorkloadProps> = ({
  teachers, departments, groups, subjects, requirements, slots,
  schoolName, termLabel, selectedIds, sort,
}) => {
  const flat = flattenGroups(groups);
  const gName = (id: number) => flat.find((g) => g.id === id)?.name ?? "";
  const subj = (id: number | null | undefined) => subjects.find((s) => s.id === id);
  const deptName = (id: number | null | undefined) =>
    departments.find((d) => d.id === id)?.name ?? "";

  const pick = new Set(selectedIds);
  const list = teachers
    .filter((t) => pick.size === 0 || pick.has(t.id))
    .sort((a, b) => {
      if (sort === "code") return (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true })
        || compareNames(a.name, b.name);
      if (sort === "department") return deptName(a.department_id).localeCompare(deptName(b.department_id))
        || compareNames(a.name, b.name);
      return compareNames(a.name, b.name);
    });

  /** One row per subject this teacher actually teaches, classes merged. */
  const rowsFor = (t: Teacher): Row[] => {
    const by = new Map<number, Row>();
    for (const s of slots) {
      if (!teachesSlot(s, t.id)) continue;
      const sid = s.subject_id;
      if (sid == null) continue;
      const row = by.get(sid) ?? {
        subjectCode: subj(sid)?.code ?? s.subject_code ?? "",
        subjectName: subj(sid)?.name ?? s.subject_name ?? "",
        classes: [], rooms: [], periods: 0,
      };
      const cls = shortClass(s.group_name ?? gName(s.group_id));
      if (cls && !row.classes.includes(cls)) row.classes.push(cls);
      const rm = roomNumber(s.room_name);
      if (rm && !row.rooms.includes(rm)) row.rooms.push(rm);
      row.periods += 1;
      by.set(sid, row);
    }
    const rows = [...by.values()];
    for (const r of rows) {
      r.classes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      r.rooms.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return rows.sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));
  };

  /** Periods asked for but never placed — said plainly rather than hidden. */
  const shortfallFor = (t: Teacher) => {
    const want = new Map<number, number>();
    for (const r of requirements) {
      if (r.teacher_id !== t.id) continue;
      want.set(r.subject_id, (want.get(r.subject_id) ?? 0) + r.weekly_count);
    }
    const got = new Map<number, number>();
    for (const s of slots) {
      if (!teachesSlot(s, t.id) || s.subject_id == null) continue;
      got.set(s.subject_id, (got.get(s.subject_id) ?? 0) + 1);
    }
    let missing = 0;
    for (const [sid, n] of want) missing += Math.max(0, n - (got.get(sid) ?? 0));
    return missing;
  };

  const TH: React.CSSProperties = {
    border: "1px solid #000", padding: "3px 5px", fontSize: "9pt",
    fontWeight: 600, background: "#e8e8e8", color: "#000", textAlign: "center",
  };
  const TD: React.CSSProperties = {
    border: "1px solid #000", padding: "3px 5px", fontSize: "9.5pt",
    verticalAlign: "middle",
  };

  return (
    <>
      {list.map((t, idx) => {
        const rows = rowsFor(t);
        const total = rows.reduce((n, r) => n + r.periods, 0);
        const missing = shortfallFor(t);
        return (
          <div key={t.id} className="print-page">
            <div className="tt-block" style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ textAlign: "center", marginBottom: "4mm" }}>
                <div style={{ fontSize: "15pt", fontWeight: 700 }}>
                  อัตรากำลังการสอน {String(idx + 1).padStart(3, "0")}
                </div>
                <div style={{ fontSize: "11.5pt", fontWeight: 600, marginTop: "1mm" }}>
                  {t.code ? `${t.code}  ` : ""}{t.name}
                  {deptName(t.department_id) ? `  ·  ${deptName(t.department_id)}` : ""}
                </div>
                <div style={{ fontSize: "10pt", marginTop: "0.5mm" }}>
                  {termLabel}{schoolName ? `  ${schoolName}` : ""}
                </div>
              </div>

              <div className="tt-grid" style={{ border: "1.4px solid #000", boxSizing: "border-box" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "34px" }} />
                    <col style={{ width: "88px" }} />
                    <col />
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "58px" }} />
                    <col style={{ width: "150px" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={TH}>ที่</th>
                      <th style={TH}>รหัสวิชา</th>
                      <th style={TH}>ชื่อวิชา</th>
                      <th style={TH}>ชั้นที่สอน</th>
                      <th style={TH}>ห้องที่สอน</th>
                      <th style={TH}>คาบ/สัปดาห์</th>
                      <th style={TH}>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td style={{ ...TD, textAlign: "center" }} colSpan={7}>
                          ยังไม่มีคาบสอนในตาราง
                        </td>
                      </tr>
                    )}
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...TD, textAlign: "center" }}>{i + 1}</td>
                        <td style={{ ...TD, fontFamily: "monospace" }}>{r.subjectCode}</td>
                        <td style={TD}>{r.subjectName}</td>
                        <td style={TD}>{r.classes.join(", ")}</td>
                        <td style={TD}>{r.rooms.join(", ") || "–"}</td>
                        <td style={{ ...TD, textAlign: "center", fontWeight: 600 }}>{r.periods}</td>
                        <td style={TD} />
                      </tr>
                    ))}
                    {/* Blank lines, so anything decided after printing can be
                        written straight onto the sheet. */}
                    {rows.length > 0 && Array.from({ length: 3 }).map((_, i) => (
                      <tr key={`blank-${i}`}>
                        <td style={{ ...TD, textAlign: "center", color: "#999" }}>{rows.length + i + 1}</td>
                        <td style={TD} /><td style={TD} /><td style={TD} />
                        <td style={TD} /><td style={TD} /><td style={TD} />
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...TD, fontWeight: 700, textAlign: "right" }} colSpan={5}>
                        รวมคาบสอนทั้งสิ้น
                      </td>
                      <td style={{ ...TD, textAlign: "center", fontWeight: 700 }}>{total}</td>
                      <td style={TD} />
                    </tr>
                  </tbody>
                </table>
              </div>

              {missing > 0 && (
                <p style={{ fontSize: "9pt", marginTop: "2mm" }}>
                  * มีคาบที่กำหนดไว้แต่ยังจัดลงตารางไม่ได้อีก {missing} คาบ
                  — ตัวเลขข้างบนนับเฉพาะคาบที่อยู่ในตารางจริง
                </p>
              )}

              <div style={{
                marginTop: "10mm", display: "flex", justifyContent: "space-between",
                fontSize: "10pt",
              }}>
                <div style={{ textAlign: "center", minWidth: "40%" }}>
                  <div>ลงชื่อ................................</div>
                  <div>({t.name})</div>
                  <div>ครูผู้สอน</div>
                </div>
                <div style={{ textAlign: "center", minWidth: "40%" }}>
                  <div>ลงชื่อ................................</div>
                  <div>ผู้อำนวยการโรงเรียน</div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};
