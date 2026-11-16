export type ProgressTone = "brand" | "ok" | "warn" | "info" | "bad";

const FILL: Record<ProgressTone, string> = {
  brand: "bg-brand",
  ok: "bg-ok-bar",
  warn: "bg-warn-bar",
  info: "bg-info",
  bad: "bg-bad",
};

type Props = {
  value: number;
  max: number;
  tone?: ProgressTone;
  /** ชื่อสำหรับโปรแกรมอ่านหน้าจอ เช่น "ยืนยันแล้ว 84 จาก 108 รายการ" */
  label?: string;
  className?: string;
};

// max เป็น 0 (กลุ่มที่ยังไม่มีแถว) = 0% ไม่ใช่หารศูนย์ · ค่าเกิน max (ครูคาบล้น) ตันที่เต็มแถบ
export function Progress({ value, max, tone = "brand", label, className = "" }: Props) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={`h-2 w-full overflow-hidden rounded-full bg-line2 ${className}`}
    >
      <div className={`h-full rounded-full ${FILL[tone]} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
    </div>
  );
}
