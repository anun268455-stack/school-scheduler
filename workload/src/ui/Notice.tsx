import type { HTMLAttributes, ReactNode } from "react";
import type { Tone } from "./Chip";

const BOX: Record<Tone, string> = {
  warn: "bg-warn-soft text-warn",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  bad: "bg-bad-soft text-bad",
  mute: "bg-line2 text-ink",
};

type Props = HTMLAttributes<HTMLDivElement> & { tone: Tone; children: ReactNode };

// กล่องข้อความทั้งบรรทัด (ข้อผิดพลาด · คำเตือน · แจ้งสำเร็จ)
// role (alert/status) ให้ผู้เรียกใส่เอง — แต่ละที่ตัดสินเองว่าต้องให้โปรแกรมอ่านหน้าจออ่านทันทีไหม
export function Notice({ tone, className = "", children, ...rest }: Props) {
  return (
    <div {...rest} className={`rounded-xl px-4 py-3 ${BOX[tone]} ${className}`}>
      {children}
    </div>
  );
}
