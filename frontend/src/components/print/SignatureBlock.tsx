import React from "react";
import { splitSignerRows, type SheetDoc, type Signer } from "../../utils/printSheet";

/**
 * แถวลงชื่อท้ายใบพิมพ์ — ใช้ร่วมกันทั้งใบตารางและใบอัตรากำลัง
 *
 *   "อยากให้ชื่อคนตรงกลางอยู่ข้างบนของชื่อ 2 คน"
 *   "กำหนดแยกได้ว่าใบไหนอยู่แถวไหน"
 *
 * เดิมโค้ดชุดนี้ถูกคัดลอกไว้สองที่ (PrintView กับ WorkloadReport) ต่างกันแค่
 * ขนาดตัวอักษรกับระยะห่าง การเพิ่มแถวบนจึงต้องไปแก้สองที่ให้ตรงกันเป๊ะ
 * รวมมาไว้ที่เดียวก่อน แล้วค่อยเพิ่มของใหม่ทีเดียว
 *
 * ── กฎข้อแรกของไฟล์นี้ ──
 *
 * ใบที่ไม่มีใครถูกตั้งให้อยู่แถวบน ต้องออกมาเหมือนเดิมทุกตัวอักษร ของที่
 * โรงเรียนพิมพ์ส่งเขตไปแล้วทั้งเทอมต้องไม่เปลี่ยนรูปเพราะเราเพิ่มความสามารถ
 * ให้มัน — รวมถึงใบที่มีผู้เซ็นคนเดียว ซึ่งของเดิมชิดซ้าย ไม่ใช่กลางหน้า
 */

interface Props {
  /** ผู้เซ็นทั้งหมดของแบบฟอร์ม — กรองตามใบให้เองข้างใน */
  signers: Signer[];
  /** ใบชนิดไหน ใช้ตัดสินว่าใครขึ้นใบนี้ และใครอยู่แถวบน */
  doc: SheetDoc;
  /** ระยะห่างจากของที่อยู่เหนือขึ้นไป */
  marginTop: string;
  fontSize: string;
  /** ชื่อคลาสของแต่ละใบ เช่น wl-sign ที่กันไม่ให้แถวลงชื่อถูกตัดคนละหน้า */
  className?: string;
}

/**
 * หนึ่งแถว
 *
 * การเกลี่ยคิดจากจำนวนคนในแถวนั้น ไม่ใช่จำนวนคนทั้งใบ — คนที่ถูกยกขึ้นแถวบน
 * ไม่ควรทำให้เส้นลงชื่อของแถวล่างสั้นลงตาม ทั้งที่แถวล่างมีคนน้อยลงแล้ว
 */
const Row: React.FC<{
  row: Signer[]; fontSize: string; className?: string; center?: boolean;
}> = ({ row, fontSize, className, center }) => (
  <div className={className} style={{
    display: "flex",
    // คนเดียวบนแถวบน = วางกลางหน้า · ที่เหลือใช้กฎเดิม คือสองคนยืนคนละฝั่ง
    // สามคนขึ้นไปเกลี่ยให้เท่ากัน
    justifyContent: center && row.length === 1 ? "center"
      : row.length <= 2 ? "space-between" : "space-around",
    fontSize,
  }}>
    {row.map((s, i) => (
      <div key={i} className={className} style={{
        textAlign: "center",
        // เส้นลงชื่อสั้นลงเมื่อมีคนเซ็นมาก ไม่งั้นมันจะชนกัน
        minWidth: row.length <= 2 ? "40%" : `${Math.floor(92 / row.length)}%`,
      }}>
        <div>ลงชื่อ{row.length > 3 ? "................" : "................................"}</div>
        {s.name && <div>({s.name})</div>}
        <div>{s.role}</div>
      </div>
    ))}
  </div>
);

export const SignatureBlock: React.FC<Props> = ({
  signers, doc, marginTop, fontSize, className,
}) => {
  const { top, bottom } = splitSignerRows(signers, doc);
  if (!top.length && !bottom.length) return null;

  // ไม่มีใครอยู่แถวบน = วาดแถวเดียวเหมือนเดิมเป๊ะ ไม่มี div ห่อเพิ่ม ไม่มี
  // ระยะห่างงอกมา
  if (!top.length) {
    return (
      <div style={{ marginTop }}>
        <Row row={bottom} fontSize={fontSize} className={className} />
      </div>
    );
  }

  return (
    <div style={{ marginTop }}>
      <Row row={top} fontSize={fontSize} className={className} center />
      {bottom.length > 0 && (
        <div style={{ marginTop: "8mm" }}>
          <Row row={bottom} fontSize={fontSize} className={className} />
        </div>
      )}
    </div>
  );
};
