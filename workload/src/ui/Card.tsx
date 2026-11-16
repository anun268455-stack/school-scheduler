import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLElement> & {
  /** แท็กที่ใช้ — section เมื่อการ์ดเป็นบริเวณที่มีชื่อ (ใส่ aria-label ด้วย) */
  as?: "div" | "section" | "article" | "aside";
  /** false = ไม่มีระยะขอบใน สำหรับการ์ดที่เป็นรายการ/ตาราง ให้แถวชิดขอบการ์ด */
  pad?: boolean;
  children: ReactNode;
};

export function Card({ as: Tag = "div", pad = true, className = "", children, ...rest }: Props) {
  return (
    <Tag {...rest} className={`rounded-card border border-line bg-surface shadow-card ${pad ? "p-4 sm:p-5" : ""} ${className}`}>
      {children}
    </Tag>
  );
}
