/**
 * อัตรากำลังการสอน — one table per กลุ่มสาระ, every teacher in it a row.
 *
 * It began as a page per teacher, which on this school's data meant 146
 * sheets, most of them three lines and a lot of white paper. The academic
 * office reads this department by department, so that is how it is printed:
 * the teacher's name is a column, their subjects sit beside it, and the whole
 * กลุ่มสาระ is one document that can be handed to its head.
 *
 * Built from the placed timetable rather than from the lesson requirements,
 * because the rooms only exist once the timetable is made, and a requirement
 * that failed to place is not teaching that is happening. What did not place
 * is reported as a shortfall rather than quietly left out.
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

interface SubjectRow {
  subjectCode: string;
  classes: string[];
  periods: number;
}

interface TeacherBlock {
  teacher: Teacher;
  rows: SubjectRow[];
  total: number;
  missing: number;
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
  /**
   * นับคาบกิจกรรมด้วยหรือไม่ — ลูกเสือ เนตรนารี ชุมนุม
   *
   * Supervising a parade is real time on a teacher's week, but not every
   * school counts it as teaching load, so the report says which it did.
   */
  countActivities?: boolean;
}

export const WorkloadReport: React.FC<WorkloadProps> = ({
  teachers, departments, groups, subjects, requirements, slots: allSlots,
  schoolName, termLabel, selectedIds, countActivities = true,
}) => {
  // Dropped once, here, rather than at each of the places that count a slot —
  // a rule applied in three places is a rule that will hold in two of them.
  const slots = countActivities
    ? allSlots
    : allSlots.filter((s) => !s.is_activity_block);
  const flat = flattenGroups(groups);
  const gName = (id: number) => flat.find((g) => g.id === id)?.name ?? "";
  const subj = (id: number | null | undefined) => subjects.find((s) => s.id === id);

  const pick = new Set(selectedIds);
  const chosen = teachers.filter((t) => pick.size === 0 || pick.has(t.id));

  /** One row per subject this teacher actually teaches, classes merged. */
  const rowsFor = (t: Teacher): SubjectRow[] => {
    const by = new Map<number, SubjectRow>();
    for (const s of slots) {
      if (!teachesSlot(s, t.id)) continue;
      const sid = s.subject_id;
      if (sid == null) continue;
      const row = by.get(sid) ?? {
        subjectCode: subj(sid)?.code ?? s.subject_code ?? "",
        classes: [], periods: 0,
      };
      const cls = shortClass(s.group_name ?? gName(s.group_id));
      if (cls && !row.classes.includes(cls)) row.classes.push(cls);
      row.periods += 1;
      by.set(sid, row);
    }
    const rows = [...by.values()];
    const natural = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true });
    for (const r of rows) r.classes.sort(natural);
    return rows.sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));
  };

  /** Periods asked for but never placed — said plainly rather than hidden. */
  const missingFor = (t: Teacher) => {
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

  const blockFor = (t: Teacher): TeacherBlock => {
    const rows = rowsFor(t);
    return {
      teacher: t, rows,
      total: rows.reduce((n, r) => n + r.periods, 0),
      missing: missingFor(t),
    };
  };

  // Teachers with no department still have to appear somewhere, so they get a
  // section of their own rather than being dropped off the report.
  const sections: { name: string; blocks: TeacherBlock[] }[] = [];
  for (const d of departments) {
    const mine = chosen
      .filter((t) => t.department_id === d.id)
      .sort((a, b) =>
        (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true })
        || compareNames(a.name, b.name));
    if (mine.length) sections.push({ name: d.name, blocks: mine.map(blockFor) });
  }
  const orphans = chosen
    .filter((t) => !departments.some((d) => d.id === t.department_id))
    .sort((a, b) => compareNames(a.name, b.name));
  if (orphans.length) {
    sections.push({ name: "ไม่ได้ระบุกลุ่มสาระ", blocks: orphans.map(blockFor) });
  }

  // The school prints this with "background graphics" switched off, so a grey
  // fill is simply not there on paper. Everything that separates one thing
  // from another is therefore a line or a weight, never a tint: the header is
  // bold and sits on a heavy rule, and each teacher's block opens with one.
  const TH: React.CSSProperties = {
    border: "1px solid #000", borderBottom: "1.4px solid #000",
    padding: "5px 6px", fontSize: "9.5pt", fontWeight: 700,
    color: "#000", textAlign: "center",
  };
  const TD: React.CSSProperties = {
    border: "1px solid #000", padding: "3px 6px", fontSize: "10pt",
    verticalAlign: "top", lineHeight: 1.35,
  };
  const mid: React.CSSProperties = { ...TD, verticalAlign: "middle" };
  /** The rule that opens a teacher's block, so rows group by eye. */
  const topRule = "1.4px solid #000";

  return (
    <>
      {/* The sheet flows instead of being locked to one page: a กลุ่มสาระ of
          22 teachers is several pages, and the header repeats on each. */}
      <style>{`
        @media print {
          .wl-section { break-before: page; page-break-before: always; }
          .wl-section:first-child { break-before: auto; page-break-before: auto; }
          .wl-section table { page-break-inside: auto; }
          .wl-section thead { display: table-header-group; }
          .wl-section tr { page-break-inside: avoid; }
          /* A signature line and the title underneath it must not be split
             across a page break — the first print put "ลงชื่อ" at the foot of
             one sheet and "ผู้อำนวยการโรงเรียน" alone at the top of the next. */
          .wl-sign { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {sections.length === 0 && (
        <div style={{ padding: "20mm" }}><p>ไม่มีครูที่ตรงกับตัวเลือกการพิมพ์</p></div>
      )}

      {sections.map((sec) => {
        const deptTotal = sec.blocks.reduce((n, b) => n + b.total, 0);
        let seq = 0;
        return (
          <div key={sec.name} className="wl-section">
            <div style={{ textAlign: "center", marginBottom: "3mm" }}>
              <div style={{ fontSize: "14pt", fontWeight: 700 }}>อัตรากำลังการสอน</div>
              <div style={{ fontSize: "12pt", fontWeight: 600, marginTop: "1mm" }}>
                {sec.name}
              </div>
              <div style={{ fontSize: "9.5pt", marginTop: "0.5mm" }}>
                {termLabel}{schoolName ? `  ${schoolName}` : ""}
                {"  ·  ครู "}{sec.blocks.length}{" คน  ·  รวม "}{deptTotal}{" คาบ/สัปดาห์"}
                {/* Printed, not just chosen: two copies of this sheet with
                    different totals and nothing on the page to tell them
                    apart is how a number gets argued about for an hour. */}
                {!countActivities && "  ·  ไม่นับคาบกิจกรรม"}
              </div>
            </div>

            <table style={{
              width: "100%", borderCollapse: "collapse", tableLayout: "fixed",
              border: "1.4px solid #000",
            }}>
              <colgroup>
                <col style={{ width: "30px" }} />
                <col style={{ width: "190px" }} />
                <col style={{ width: "92px" }} />
                <col />
                <col style={{ width: "46px" }} />
                <col style={{ width: "150px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={TH}>ที่</th>
                  <th style={TH}>ชื่อครูผู้สอน</th>
                  <th style={TH}>รหัสวิชา</th>
                  <th style={TH}>ชั้นที่สอน</th>
                  <th style={TH}>คาบ</th>
                  <th style={TH}>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {sec.blocks.map((b) => {
                  seq += 1;
                  const span = Math.max(1, b.rows.length);
                  // Only the first row of a block carries the rule, so the
                  // teacher's own subjects stay visually tied together.
                  const open = (s: React.CSSProperties): React.CSSProperties =>
                    ({ ...s, borderTop: topRule });
                  const nameCell = (
                    <td style={open(mid)} rowSpan={span}>
                      <div style={{ fontWeight: 700, fontSize: "10pt" }}>
                        {b.teacher.name}
                      </div>
                      <div style={{ fontSize: "8.5pt", marginTop: "1px" }}>
                        {b.teacher.code ? `รหัส ${b.teacher.code}` : ""}
                        {b.total ? `  ·  รวม ${b.total} คาบ` : ""}
                      </div>
                      {b.missing > 0 && (
                        <div style={{ fontSize: "8pt", marginTop: "1px" }}>
                          * ยังลงตารางไม่ได้ {b.missing} คาบ
                        </div>
                      )}
                    </td>
                  );
                  if (b.rows.length === 0) {
                    return (
                      <tr key={b.teacher.id}>
                        <td style={open({ ...mid, textAlign: "center" })}>{seq}</td>
                        {nameCell}
                        <td style={open(TD)} colSpan={3}>ยังไม่มีคาบสอนในตาราง</td>
                        <td style={open(TD)} />
                      </tr>
                    );
                  }
                  return b.rows.map((r, i) => {
                    const cell = (s: React.CSSProperties) => (i === 0 ? open(s) : s);
                    return (
                      <tr key={`${b.teacher.id}-${i}`}>
                        {i === 0 && (
                          <td style={open({ ...mid, textAlign: "center" })} rowSpan={span}>
                            {seq}
                          </td>
                        )}
                        {i === 0 && nameCell}
                        <td style={cell({
                          ...TD, textAlign: "center", whiteSpace: "nowrap",
                        })}>
                          {r.subjectCode}
                        </td>
                        <td style={cell(TD)}>{r.classes.join(", ")}</td>
                        <td style={cell({ ...TD, textAlign: "center", fontWeight: 700 })}>
                          {r.periods}
                        </td>
                        <td style={cell(TD)} />
                      </tr>
                    );
                  });
                })}
                <tr>
                  <td style={{
                    ...TD, fontWeight: 700, textAlign: "right",
                    borderTop: topRule,
                  }} colSpan={4}>
                    รวมทั้งกลุ่มสาระ
                  </td>
                  <td style={{
                    ...TD, textAlign: "center", fontWeight: 700,
                    borderTop: topRule,
                  }}>
                    {deptTotal}
                  </td>
                  <td style={{ ...TD, borderTop: topRule }} />
                </tr>
              </tbody>
            </table>

            <div className="wl-sign" style={{
              marginTop: "5mm", display: "flex", justifyContent: "space-between",
              fontSize: "9.5pt",
            }}>
              <div className="wl-sign" style={{ textAlign: "center", minWidth: "40%" }}>
                <div>ลงชื่อ................................</div>
                <div>หัวหน้ากลุ่มสาระการเรียนรู้</div>
              </div>
              <div className="wl-sign" style={{ textAlign: "center", minWidth: "40%" }}>
                <div>ลงชื่อ................................</div>
                <div>ผู้อำนวยการโรงเรียน</div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};
