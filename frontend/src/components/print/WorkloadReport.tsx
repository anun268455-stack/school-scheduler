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
  Department, StudentGroup, Subject, Teacher, TimetableSlot,
} from "../../types";
import { flattenGroups, compareNames } from "../../utils/groupHierarchy";
import { workloadRows, type WorkloadRow } from "../../utils/workloadRows";
import type { Signer } from "../../utils/printSheet";
import { SignatureBlock } from "./SignatureBlock";

/** "ม.4/2" → "4/2": the "ม." is on every row and tells the reader nothing. */
const shortClass = (n: string | null | undefined) =>
  String(n ?? "").replace(/^ม\.?\s*/, "");

interface TeacherBlock {
  teacher: Teacher;
  rows: WorkloadRow[];
  total: number;
}

export interface WorkloadProps {
  teachers: Teacher[];
  departments: Department[];
  groups: StudentGroup[];
  subjects: Subject[];
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
  /**
   * ผู้เซ็นท้ายใบ — มาจากแบบฟอร์มใบพิมพ์ กรองมาแล้วว่าใครขึ้นใบอัตรากำลัง
   *
   * ส่งเข้ามาแทนที่จะอ่านเอง เพราะ PrintView อ่านแบบฟอร์มอยู่แล้วหนึ่งครั้ง
   * และใบตารางกับใบอัตรากำลังต้องอ่านจากชุดเดียวกัน
   */
  signers: Signer[];
}

export const WorkloadReport: React.FC<WorkloadProps> = ({
  teachers, departments, groups, subjects, slots: allSlots, signers,
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

  /**
   * One row per subject this teacher actually teaches, classes merged.
   *
   * กฎที่ยากสองข้อ (คาบเสรีไม่มีวิชาของตัวเอง · คาบกิจกรรมไม่มีชั้นที่มีความหมาย)
   * อยู่ใน utils/workloadRows ซึ่งทดสอบได้ตรง ๆ โดยไม่ต้องมีหน้าจอ
   */
  const rowsFor = (t: Teacher): WorkloadRow[] => workloadRows(slots, t.id, {
    codeOf:  (id) => subj(id)?.code ?? undefined,
    classOf: (s) => shortClass(s.group_name ?? gName(s.group_id)),
  });

  // เคยมีบรรทัด "* ยังลงตารางไม่ได้ N คาบ" ใต้ชื่อครู — โรงเรียนให้เอาออก
  //
  // ตัวเลขนั้นเทียบคาบที่ลงได้กับจำนวนที่ขอไว้ในหลักสูตร ซึ่งเป็นคนละเรื่องกับ
  // สิ่งที่ใบอัตรากำลังรายงาน (ภาระงานที่สอนอยู่จริง) และการเอาตัวเลขของอีกเรื่อง
  // ไปวางใต้ชื่อคน ทำให้ใบที่ส่งต่อถูกอ่านผิดได้ ส่วนข้อมูลนั้นยังดูได้จากป้าย
  // "คาบไม่พอ" บนแถบเครื่องมือ ซึ่งเป็นที่ของมันอยู่แล้ว
  const blockFor = (t: Teacher): TeacherBlock => {
    const rows = rowsFor(t);
    return { teacher: t, rows, total: rows.reduce((n, r) => n + r.periods, 0) };
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
    // ไม่มีอะไรได้รับอนุญาตให้วาดออกนอกช่องของตัวเอง ตารางนี้กว้างคงที่
    // (tableLayout: fixed) ข้อความที่ยาวเกินจึงไปทับช่องข้าง ๆ แทนที่จะขึ้น
    // บรรทัดใหม่ — และภาษาไทยไม่มีช่องว่างระหว่างคำให้เบราว์เซอร์ตัด
    overflow: "hidden", overflowWrap: "anywhere", wordBreak: "break-word",
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
              {/* ความกว้างถูกเกลี่ยใหม่หลังจากคาบเสรีกับคาบกิจกรรมเข้ามาอยู่ใน
                  คอลัมน์รหัสวิชา ("ปฏิบัติเครื่องดนตรีไทย" ไม่ใช่ "ค21102")
                  และหลังจากคาบเสรีพาชั้นเรียนมาทั้งหน้าต่าง — สองคอลัมน์นั้น
                  ต้องการที่เพิ่ม ส่วนช่องหมายเหตุที่เว้นไว้ให้เขียนมือ เล็กลงได้ */}
              <colgroup>
                <col style={{ width: "26px" }} />
                <col style={{ width: "170px" }} />
                <col style={{ width: "110px" }} />
                <col />
                <col style={{ width: "40px" }} />
                <col style={{ width: "120px" }} />
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
                        {/* ชื่อกิจกรรมยาวกว่ารหัสวิชามาก ("สาธารณประโยชน์" เทียบกับ
                            "ค21102") ของเดิมตั้ง nowrap ไว้ในคอลัมน์กว้างคงที่
                            ข้อความจึงล้นออกไปทับคอลัมน์ชั้นที่สอนบนกระดาษ
                            ภาษาไทยไม่มีช่องว่างระหว่างคำ จึงต้องอนุญาตให้ตัดคำได้
                            ไม่งั้นมันไม่ยอมขึ้นบรรทัดใหม่เลย */}
                        <td style={cell({ ...TD, textAlign: "center" })}>
                          {r.code}
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

            {/* ผู้เซ็นมาจากแบบฟอร์มใบพิมพ์ ซึ่งเลือกได้ว่าใครขึ้นใบไหน —
                ใบอัตรากำลังกับใบตารางต้องการคนละชุด และของเดิมต้องเข้าไปแก้
                สลับไปมาทุกครั้งที่เปลี่ยนใบที่จะพิมพ์ (utils/printSheet) */}
            <SignatureBlock
              signers={signers} doc="workload"
              marginTop="5mm" fontSize="9.5pt" className="wl-sign" />
          </div>
        );
      })}
    </>
  );
};
