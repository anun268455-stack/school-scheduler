import type { ReactNode } from "react";
import type { DepartmentGroup } from "../registry";
import type { Department } from "../types";

// ชิ้นส่วนที่ทะเบียนครูและทะเบียนวิชาใช้ร่วมกัน

export const inputClass = "rounded border border-gray-300 px-2 py-1 disabled:opacity-50";

export function DepartmentSelect(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  departments: Department[];
  disabled?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={props.label}
      value={props.value ?? ""}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={inputClass}
    >
      <option value="">(ยังไม่ระบุกลุ่มสาระ)</option>
      {props.departments.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  );
}

export function NeverSentBadge() {
  return (
    <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-900">
      ยังไม่เคยส่งเข้าโปรแกรม
    </span>
  );
}

// สวิตช์ "ไม่ปฏิบัติงานแล้ว/ไม่เปิดสอนแล้ว" — ติ๊ก = active:false ไม่มีปุ่มลบ
export function InactiveSwitch(props: {
  inactive: boolean;
  onChange: (inactive: boolean) => void;
  disabled: boolean;
  text: string;
}) {
  return (
    <label className="flex items-center gap-1 text-sm whitespace-nowrap">
      <input
        type="checkbox"
        checked={props.inactive}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.text}
    </label>
  );
}

export function RegistryStatus(props: { loading: boolean; saving: boolean; error: string | null }) {
  return (
    <div className="my-2 min-h-6">
      {props.loading && <p role="status" className="text-gray-600">กำลังโหลด...</p>}
      {props.saving && <p role="status" className="text-gray-600">กำลังบันทึก...</p>}
      {props.error && <p role="alert" className="text-red-700">{props.error}</p>}
    </div>
  );
}

export function DepartmentGroups<T extends { id: number }>(props: {
  groups: DepartmentGroup<T>[];
  renderRow: (row: T) => ReactNode;
}) {
  return (
    <div className="space-y-6">
      {props.groups.map((g) => (
        <section key={g.key} aria-label={g.name}>
          <h3 className="border-b border-gray-300 pb-1 font-bold">
            {g.name} <span className="font-normal text-gray-600">({g.rows.length})</span>
          </h3>
          <ul className="divide-y divide-gray-200">
            {g.rows.map((r) => (
              // key เป็น id ของแถวเสมอ — ชื่อซ้ำกันได้
              <li key={r.id} className="py-1">{props.renderRow(r)}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
