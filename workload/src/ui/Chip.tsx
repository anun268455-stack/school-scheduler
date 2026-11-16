import type { HTMLAttributes, ReactNode } from "react";

/** ความหมายของสีสถานะ (แบบข้อ 6) — warn = รอ/ยังไม่ยืนยัน · ok = ผ่าน/ยืนยัน · info = ส่งแล้ว ·
 *  bad = ตีกลับ/ผิดพลาด (แดงใช้กับสองอย่างนี้เท่านั้น) · mute = ยังไม่เริ่ม/ข้อมูลประกอบ */
export type Tone = "warn" | "ok" | "info" | "bad" | "mute";

// เขียนชื่อคลาสเต็มทุกตัว — tailwind หาคลาสจากข้อความในไฟล์ ประกอบชื่อตอนรันจะไม่มีคลาสนั้นใน CSS
const TONE_SOFT: Record<Tone, string> = {
  warn: "bg-warn-soft text-warn",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  bad: "bg-bad-soft text-bad",
  mute: "bg-line2 text-muted",
};

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone: Tone;
  /** จุดสีหน้าข้อความ — ใช้กับสถานะที่ "กำลังเป็นอยู่" (กำลังกรอก · ภาคเรียนที่เปิด) */
  dot?: boolean;
  children: ReactNode;
};

export function Chip({ tone, dot, children, className = "", ...rest }: Props) {
  return (
    <span
      {...rest}
      className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-medium leading-6 ${TONE_SOFT[tone]} ${className}`}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      <span className="truncate">{children}</span>
    </span>
  );
}
