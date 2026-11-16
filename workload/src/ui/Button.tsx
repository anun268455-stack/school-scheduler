import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

// เขียนชื่อคลาสเต็มทุกตัว — tailwind หาคลาสจากข้อความในไฟล์
const VARIANT: Record<ButtonVariant, string> = {
  // ปุ่มหลักมีได้ทีละหนึ่งปุ่มต่อบริเวณ — สิ่งที่หน้านั้นอยากให้กดต่อ
  primary: "border-brand bg-brand text-white enabled:hover:border-brand-strong enabled:hover:bg-brand-strong",
  secondary: "border-line bg-surface text-ink enabled:hover:bg-bg",
  ghost: "border-transparent bg-transparent text-brand enabled:hover:bg-brand-soft",
  // แดงเฉพาะการยืนยันที่ทำให้คนอื่นใช้งานไม่ได้หรือส่งงานกลับ (ปิดรหัส · ตีกลับ) — แบบข้อ 6
  danger: "border-bad bg-bad text-white enabled:hover:brightness-95",
};

const SIZE = {
  md: "min-h-[38px] px-4 py-1.5 text-[15px]",
  sm: "min-h-[32px] px-3 py-1 text-sm",
} as const;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof SIZE;
};

// type ตั้งต้นเป็น "button" — ปุ่มที่อยู่ในฟอร์มจะได้ไม่ส่งฟอร์มเองโดยไม่ตั้งใจ (ปุ่มส่งต้องเขียน type="submit")
export function Button({ variant = "secondary", size = "md", type = "button", className = "", ...rest }: Props) {
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border font-medium leading-6 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    />
  );
}
