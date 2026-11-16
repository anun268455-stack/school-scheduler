import { useId, type ReactNode } from "react";
import { importSummary, type DepartmentGroup, type ImportNoun, type TeacherForm } from "../registry";
import type { Department } from "../types";
import type { SchedulerImport } from "../useRegistryList";

// ชิ้นส่วนที่ทะเบียนครูและทะเบียนวิชาใช้ร่วมกัน

export const inputClass = "rounded border border-gray-300 px-2 py-1 disabled:opacity-50";

// ป้ายที่มองเห็นได้เหนือช่องกรอก ผูกด้วย htmlFor/id · ตัวแก้ในแถวกรอกค่าไว้แล้ว placeholder จึงไม่โชว์
// ถ้าไม่มีป้าย ช่อง "รหัสประจำตัว" กับ "ลำดับในกลุ่ม" ที่เป็นตัวเลขทั้งคู่และกว้างเท่ากันจะแยกไม่ออก
export function Field(props: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <label htmlFor={props.htmlFor} className="text-xs text-gray-600">{props.label}</label>
      {props.children}
    </div>
  );
}

// ช่องติ๊กที่ป้ายอยู่ข้างช่อง (ป้ายห่อช่องไว้ และผูก htmlFor/id ด้วย)
export function CheckField(props: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label htmlFor={props.id} className="flex items-center gap-1 pb-1 text-sm whitespace-nowrap">
      <input id={props.id} type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} disabled={props.disabled} />
      {props.label}
    </label>
  );
}

export function DepartmentSelect(props: {
  id: string;
  value: number | null;
  onChange: (v: number | null) => void;
  departments: Department[];
  disabled?: boolean;
}) {
  return (
    <select
      id={props.id}
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

// ช่องกรอกครู ใช้ทั้งฟอร์มเพิ่มและการแก้ในแถว · useId ให้ id ไม่ซ้ำกันระหว่างแถว
export function TeacherFields(props: {
  value: TeacherForm;
  onChange: (v: TeacherForm) => void;
  departments: Department[];
  disabled: boolean;
}) {
  const id = useId();
  const v = props.value;
  const set = (p: Partial<TeacherForm>) => props.onChange({ ...v, ...p });
  return (
    <>
      <Field label="ชื่อครู" htmlFor={`${id}-name`}>
        <input id={`${id}-name`} placeholder="ชื่อครู" value={v.name} onChange={(e) => set({ name: e.target.value })} disabled={props.disabled} className={inputClass} />
      </Field>
      <Field label="รหัสประจำตัว" htmlFor={`${id}-code`}>
        <input id={`${id}-code`} placeholder="รหัสประจำตัว" value={v.code} onChange={(e) => set({ code: e.target.value })} disabled={props.disabled} className={`${inputClass} w-28`} />
      </Field>
      <Field label="กลุ่มสาระ" htmlFor={`${id}-dept`}>
        <DepartmentSelect id={`${id}-dept`} value={v.department_id} onChange={(d) => set({ department_id: d })} departments={props.departments} disabled={props.disabled} />
      </Field>
      <Field label="ลำดับในกลุ่ม" htmlFor={`${id}-order`}>
        <input id={`${id}-order`} placeholder="ลำดับในกลุ่ม" value={v.order} onChange={(e) => set({ order: e.target.value })} disabled={props.disabled} inputMode="numeric" className={`${inputClass} w-28`} />
      </Field>
    </>
  );
}

// กล่องปุ่มดึงจากโปรแกรมจัดตาราง ใช้ร่วมกันทั้งทะเบียนครูและทะเบียนวิชา
export function ImportBox(props: { imp: SchedulerImport; noun: ImportNoun; disabled: boolean }) {
  const { state, start, confirm, cancel } = props.imp;
  const n = props.noun;
  return (
    <div className="mt-3 rounded border border-gray-300 bg-white p-3">
      <button
        onClick={() => void start()}
        disabled={props.disabled || state.kind === "confirm"}
        className="rounded border border-blue-600 px-3 py-1 text-blue-700 disabled:opacity-50"
      >
        ดึง{n.thing}จากโปรแกรมจัดตาราง
      </button>
      {state.kind === "checking" && <p role="status" className="mt-2">กำลังตรวจจำนวน...</p>}
      {state.kind === "running" && <p role="status" className="mt-2">กำลังดึง{n.thing}...</p>}
      {state.kind === "confirm" && (
        <div className="mt-2" data-testid="import-confirm">
          <p>{importSummary(state.counts, "preview", n)}</p>
          <p className="text-sm text-gray-600">ยังไม่ได้เขียนอะไรลงทะเบียน จนกว่าจะกดยืนยัน</p>
          <div className="mt-2 flex gap-2">
            {state.counts.created > 0 && (
              <button onClick={() => void confirm()} className="rounded bg-blue-600 px-3 py-1 text-white">
                ยืนยันดึง{n.thing} {state.counts.created} {n.unit}
              </button>
            )}
            <button onClick={cancel} className="rounded border border-gray-300 px-3 py-1">
              {state.counts.created > 0 ? "ยกเลิก" : "ปิด"}
            </button>
          </div>
        </div>
      )}
      {state.kind === "done" && (
        <p role="status" className="mt-2 text-green-800" data-testid="import-done">
          {importSummary(state.counts, "done", n)}
        </p>
      )}
      {state.kind === "error" && <p role="alert" className="mt-2 text-red-700">{state.message}</p>}
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
