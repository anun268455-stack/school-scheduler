import type { ReactNode } from "react";
import { Card } from "./Card";

type Props = {
  label: ReactNode;
  /** ตัวเลขใส่คั่นหลักพันให้เอง (1220 → 1,220) */
  value: ReactNode;
  /** ต่อท้ายตัวเลขด้วยตัวเล็กสีรอง เช่น "· 61%" · "จาก 11 กลุ่ม" */
  suffix?: ReactNode;
};

export function StatTile({ label, value, suffix }: Props) {
  return (
    <Card>
      <div className="text-[15px] text-muted">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-stat text-ink">{typeof value === "number" ? value.toLocaleString("th-TH") : value}</span>
        {suffix != null && <span className="text-muted">{suffix}</span>}
      </div>
    </Card>
  );
}
