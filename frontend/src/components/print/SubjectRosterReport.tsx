import React, { useMemo } from "react";
import type {
  Department, LessonRequirement, StudentGroup, Subject, Teacher,
} from "../../types";
import { flattenGroups } from "../../utils/groupHierarchy";
import { buildSubjectRoster } from "../../utils/subjectRoster";
import type { Signer } from "../../utils/printSheet";
import { SignatureBlock } from "./SignatureBlock";

/**
 * ใบรายวิชาและผู้สอน — ไล่ทีละวิชาว่าวิชานั้นใครสอนบ้าง
 *
 *   "อยากให้สั่งพิมพ์ เป็นรายวิชาว่าวิชาอันไหนใครสอนบ้าง"
 *   "ช่วยทำเป็นตารางเลย เอาแค่พิมพ์ให้ได้ก่อน"
 *
 * ใบอัตรากำลังไล่ทีละครูว่าครูคนนั้นสอนอะไร ใบนี้กลับด้านกัน
 *
 * ใบนี้ไหลยาวข้ามหน้าได้ ไม่ได้ล็อกหนึ่งกลุ่มสาระหนึ่งหน้า เพราะกลุ่มสาระ
 * ใหญ่ ๆ มีหลายสิบวิชา หัวตารางจึงซ้ำทุกหน้าด้วย display: table-header-group
 */

interface Props {
  requirements: LessonRequirement[];
  subjects:     Subject[];
  teachers:     Teacher[];
  groups:       StudentGroup[];
  departments:  Department[];
  /** ที่เรียกยังส่งมา แต่ไม่ได้ใช้ — termLabel มีคำว่า "โรงเรียน<ชื่อ>" อยู่แล้ว */
  schoolName?:  string;
  termLabel:    string;
  signers:      Signer[];
  /** วิชาที่เลือกพิมพ์ — ว่าง = ทุกวิชา ตามแบบเดียวกับใบอื่น */
  selectedIds:  number[];
}

const TH: React.CSSProperties = {
  border: "1px solid #000", padding: "1.2mm 1.5mm",
  fontSize: "9pt", fontWeight: 700, background: "#f3f4f6", textAlign: "center",
};
const TD: React.CSSProperties = {
  border: "1px solid #000", padding: "1.2mm 1.5mm", fontSize: "9pt",
  verticalAlign: "top",
  // คอลัมน์กว้างตายตัว (tableLayout: fixed) และภาษาไทยไม่มีช่องว่างคั่นคำให้
  // เบราว์เซอร์ตัดบรรทัด ชื่อวิชายาว ๆ อย่าง "พัฒนาอัจฉริยภาพทางคณิตศาสตร์"
  // จึงทะลุไปทับช่องข้าง ๆ ถ้าไม่สั่งให้ตัดกลางคำได้ และตัดส่วนที่ยังเกินทิ้ง
  overflow: "hidden", overflowWrap: "anywhere", wordBreak: "break-word",
};
const NUM: React.CSSProperties = { ...TD, textAlign: "center" };

export const SubjectRosterReport: React.FC<Props> = ({
  requirements, subjects, teachers, groups, departments,
  termLabel, signers, selectedIds,
}) => {
  const flat = useMemo(() => flattenGroups(groups), [groups]);

  const depts = useMemo(() => {
    const pick = new Set(selectedIds);
    const rows = pick.size
      ? requirements.filter((r) => pick.has(r.subject_id))
      : requirements;

    return buildSubjectRoster(rows, {
      subject: (id) => {
        const s = subjects.find((x) => x.id === id);
        return s
          ? { code: s.code ?? "", name: s.name ?? "", departmentId: s.department_id ?? 0 }
          : undefined;
      },
      teacher: (id) => {
        const t = teachers.find((x) => x.id === id);
        return t ? { name: t.name, code: t.code ?? "" } : undefined;
      },
      group: (id) => flat.find((g) => g.id === id)?.name,
      department: (id) => departments.find((d) => d.id === id)?.name,
    });
  }, [requirements, subjects, teachers, flat, departments, selectedIds]);

  const totalSubjects = depts.reduce((n, d) => n + d.subjects.length, 0);

  return (
    // ห้ามห่อด้วย .print-page — คลาสนั้นมีกฎ page-break-inside: avoid ซึ่งสั่งห้าม
    // ขึ้นหน้าใหม่ข้างใน มันจะทับกฎ break-before ของ .sr-section ด้านล่างจนกลุ่ม
    // สาระทั้งหมดอัดมาต่อกันในหน้าเดียว ใบอัตรากำลังก็คืนเป็น fragment ด้วยเหตุนี้
    <>
      <style>{`
        @media print {
          .sr-section { break-before: page; page-break-before: always; }
          .sr-section:first-child { break-before: auto; page-break-before: auto; }
          .sr-section table { page-break-inside: auto; }
          .sr-section thead { display: table-header-group; }
          .sr-section tr { page-break-inside: avoid; }
          .sr-sign { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {totalSubjects === 0 && (
        <div style={{ padding: "20mm" }}>
          <p>ไม่มีรายวิชาที่ตรงกับตัวเลือกการพิมพ์</p>
        </div>
      )}

      {depts.map((dept) => {
        const deptPeriods = dept.subjects.reduce((n, s) => n + s.periods, 0);
        let seq = 0;
        return (
          <div key={dept.deptId} className="sr-section">
            <div style={{ textAlign: "center", marginBottom: "3mm" }}>
              <div style={{ fontSize: "14pt", fontWeight: 700 }}>รายวิชาและผู้สอน</div>
              <div style={{ fontSize: "12pt", fontWeight: 600, marginTop: "1mm" }}>
                {dept.deptName}
              </div>
              <div style={{ fontSize: "9.5pt", marginTop: "0.5mm" }}>
                {/* termLabel มีคำว่า "โรงเรียน<ชื่อ>" อยู่แล้ว เติม schoolName ซ้ำ
                    ตรงนี้จะได้ "โรงเรียนราชวินิต นนทบุรี ราชวินิต นนทบุรี" */}
                {termLabel}
                {"  ·  "}{dept.subjects.length}{" รายวิชา  ·  รวม "}
                {deptPeriods}{" คาบ/สัปดาห์"}
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "7%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "25%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={TH}>ที่</th>
                  <th style={TH}>รหัสวิชา</th>
                  <th style={TH}>ชื่อวิชา</th>
                  <th style={TH}>ครูผู้สอน</th>
                  <th style={TH}>ห้องที่สอน</th>
                  <th style={TH}>ห้อง</th>
                  <th style={TH}>คาบ</th>
                </tr>
              </thead>
              <tbody>
                {dept.subjects.map((s) => {
                  seq += 1;
                  const span = Math.max(1, s.lines.length);
                  return s.lines.map((line, i) => (
                    <tr key={`${s.subjectId}-${line.teacherId}-${line.coTeaching ? "co" : "m"}`}>
                      {/* ช่องของวิชาเขียนครั้งเดียวแล้วคร่อมบรรทัดครูทุกคน
                          ไม่งั้นรหัสวิชาเดิมจะซ้ำลงมาสิบบรรทัดจนอ่านไม่ออกว่า
                          นับเป็นกี่วิชา */}
                      {i === 0 && (
                        <>
                          <td style={{ ...NUM, fontWeight: 600 }} rowSpan={span}>{seq}</td>
                          <td style={{ ...TD, fontWeight: 600 }} rowSpan={span}>{s.code}</td>
                          <td style={TD} rowSpan={span}>{s.name}</td>
                        </>
                      )}
                      <td style={TD}>
                        {line.teacherCode && (
                          <span style={{ color: "#555" }}>{line.teacherCode}{" "}</span>
                        )}
                        {line.teacherName}
                        {line.coTeaching && (
                          <span style={{ color: "#555" }}>{"  (สอนร่วม)"}</span>
                        )}
                      </td>
                      <td style={TD}>{line.classes}</td>
                      <td style={NUM}>{line.classCount}</td>
                      <td style={NUM}>{line.periods}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>

            <SignatureBlock
              signers={signers} doc="workload"
              marginTop="5mm" fontSize="9.5pt" className="sr-sign" />
          </div>
        );
      })}
    </>
  );
};
