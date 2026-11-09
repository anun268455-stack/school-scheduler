import type { ReactNode } from "react";
import type { DepartmentGroup, TeacherForm } from "../registry";
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
      {/* แถวที่ชี้กลุ่มซึ่งถูกลบไปแล้ว: แสดงตรง ๆ ว่าเป็นกลุ่มที่ไม่มีแล้ว แทนที่จะโชว์ช่องว่างทั้งที่ค่าจริงยังเป็นรหัสเดิม */}
      {props.value !== null && !props.departments.some((d) => d.id === props.value) && (
        <option value={props.value} disabled>กลุ่มสาระที่ไม่มีแล้ว (รหัส {props.value})</option>
      )}
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

// โครงหน้าทะเบียนที่สองหน้าใช้ร่วมกัน: หัวเรื่อง · บรรทัดนับจำนวน · สถานะโหลด/บันทึก · ข้อผิดพลาดตอนโหลดพร้อมปุ่มลองใหม่
// เนื้อหา (ฟอร์ม+รายการ) แสดงเมื่อโหลดสำเร็จแล้วเท่านั้น และคงอยู่ระหว่างโหลดซ้ำ
export function RegistryFrame(props: {
  title: string;
  countTestId: string;
  countText: string;
  loaded: boolean;
  loadError: string | null;
  saving: boolean;
  onRetry: () => void;
  top?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-xl font-bold">{props.title}</h2>
      {props.loaded && <p data-testid={props.countTestId} className="mt-1">{props.countText}</p>}
      {props.top}
      <div className="my-2 min-h-6">
        {!props.loaded && !props.loadError && <p role="status" className="text-gray-600">กำลังโหลด...</p>}
        {props.saving && <p role="status" className="text-gray-600">กำลังบันทึก...</p>}
        {props.loadError && <p role="alert" className="text-red-700">{props.loadError}</p>}
      </div>
      {props.loadError && (
        <button onClick={props.onRetry} className="mb-3 rounded border border-gray-300 px-3 py-1">
          ลองโหลดใหม่
        </button>
      )}
      {props.loaded && props.children}
    </div>
  );
}

export function RowError(props: { message: string | null }) {
  return props.message ? <p role="alert" className="w-full text-red-700">{props.message}</p> : null;
}

// ช่องกรอกครู ใช้ทั้งฟอร์มเพิ่มและการแก้ในแถว
export function TeacherFields(props: {
  value: TeacherForm;
  onChange: (v: TeacherForm) => void;
  departments: Department[];
  disabled: boolean;
}) {
  const v = props.value;
  const set = (p: Partial<TeacherForm>) => props.onChange({ ...v, ...p });
  return (
    <>
      <input aria-label="ชื่อครู" placeholder="ชื่อครู" value={v.name} onChange={(e) => set({ name: e.target.value })} disabled={props.disabled} className={inputClass} />
      <input aria-label="รหัสประจำตัว" placeholder="รหัสประจำตัว" value={v.code} onChange={(e) => set({ code: e.target.value })} disabled={props.disabled} className={`${inputClass} w-28`} />
      <DepartmentSelect label="กลุ่มสาระ" value={v.department_id} onChange={(d) => set({ department_id: d })} departments={props.departments} disabled={props.disabled} />
      <input aria-label="ลำดับในกลุ่ม" placeholder="ลำดับในกลุ่ม" value={v.order} onChange={(e) => set({ order: e.target.value })} disabled={props.disabled} inputMode="numeric" className={`${inputClass} w-28`} />
    </>
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
