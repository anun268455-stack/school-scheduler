import type { ReactNode } from "react";

export type SegmentedOption<T extends string | number> = { value: T; label: ReactNode };

type Props<T extends string | number> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** ชื่อของกลุ่มปุ่มสำหรับโปรแกรมอ่านหน้าจอ เช่น "กรองตามสถานะ" */
  label?: string;
  className?: string;
};

// ตัวเลือกแบบปุ่มติดกัน (ทั้งหมด/ยังไม่ยืนยัน/ยืนยันแล้ว · ทุกชั้น/ม.1…) — เลือกได้ทีละค่า
// จอแคบ: เลื่อนแนวนอนในกรอบของมันเอง ไม่ดันทั้งหน้าให้เลื่อน
export function Segmented<T extends string | number>({ options, value, onChange, label, className = "" }: Props<T>) {
  return (
    <div role="group" aria-label={label} className={`no-scrollbar inline-flex max-w-full overflow-x-auto rounded-xl bg-line2 p-1 ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[15px] leading-6 transition-colors ${
              on ? "bg-surface font-semibold text-ink shadow-card" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
