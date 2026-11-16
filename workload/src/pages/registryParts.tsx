import { useId, type ReactNode } from "react";
import { importSummary, type DepartmentGroup, type ImportNoun, type TeacherForm } from "../registry";
import type { Department } from "../types";
import type { SchedulerImport } from "../useRegistryList";
import { Button, Card, Chip, Notice } from "../ui";

// ชิ้นส่วนที่ทะเบียนครูและทะเบียนวิชาใช้ร่วมกัน

// คลาส "input" อยู่ใน index.css · จอแคบให้ช่องเต็มแถว (ช่องที่กำหนดกว้างไว้ เช่น w-28 ก็ขยายตาม)
export const inputClass = "input max-sm:w-full";

// ป้ายที่มองเห็นได้เหนือช่องกรอก ผูกด้วย htmlFor/id · ตัวแก้ในแถวกรอกค่าไว้แล้ว placeholder จึงไม่โชว์
// ถ้าไม่มีป้าย ช่อง "รหัสประจำตัว" กับ "ลำดับในกลุ่ม" ที่เป็นตัวเลขทั้งคู่และกว้างเท่ากันจะแยกไม่ออก
export function Field(props: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 max-sm:w-full">
      <label htmlFor={props.htmlFor} className="text-sm text-muted">{props.label}</label>
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
    <label htmlFor={props.id} className="flex min-h-[38px] items-center gap-2 whitespace-nowrap text-[15px]">
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
    <Chip tone="warn">ยังไม่เคยส่งเข้าโปรแกรม</Chip>
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
    <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
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
      <div className="mb-5">
        <h2 className="text-title text-ink">{props.title}</h2>
        {/* "กำลังบันทึก..." อยู่บรรทัดเดียวกับจำนวน — ขึ้น/หายแล้วรายการข้างล่างไม่กระตุก และไม่ต้องจองที่ว่างไว้ทั้งแถบ */}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          {props.loaded && <p data-testid={props.countTestId} className="text-muted">{props.countText}</p>}
          {props.saving && <p role="status" className="text-sm font-medium text-brand">กำลังบันทึก...</p>}
        </div>
      </div>
      {props.top}
      {!props.loaded && !props.loadError && <p role="status" className="mb-4 text-muted">กำลังโหลด...</p>}
      {props.loadError && (
        <div className="mb-4 space-y-3">
          <Notice tone="bad" role="alert">{props.loadError}</Notice>
          <Button onClick={props.onRetry}>ลองโหลดใหม่</Button>
        </div>
      )}
      {props.loaded && props.children}
    </div>
  );
}

export function RowError(props: { message: string | null }) {
  return props.message ? <p role="alert" className="w-full text-[15px] text-bad">{props.message}</p> : null;
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
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button onClick={() => void start()} disabled={props.disabled || state.kind === "confirm"}>
          ดึง{n.thing}จากโปรแกรมจัดตาราง
        </Button>
        <p className="text-sm text-muted">บอกจำนวนก่อน ยังไม่เขียนอะไรจนกว่าจะกดยืนยัน · กดซ้ำได้ ไม่สร้างซ้ำ</p>
      </div>
      {state.kind === "checking" && <p role="status" className="mt-3 text-muted">กำลังตรวจจำนวน...</p>}
      {state.kind === "running" && <p role="status" className="mt-3 text-muted">กำลังดึง{n.thing}...</p>}
      {state.kind === "confirm" && (
        <div className="mt-3 rounded-xl border border-line bg-bg px-4 py-3" data-testid="import-confirm">
          <p className="font-medium">{importSummary(state.counts, "preview", n)}</p>
          <p className="text-sm text-muted">ยังไม่ได้เขียนอะไรลงทะเบียน จนกว่าจะกดยืนยัน</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.counts.created > 0 && (
              <Button variant="primary" onClick={() => void confirm()}>
                ยืนยันดึง{n.thing} {state.counts.created} {n.unit}
              </Button>
            )}
            <Button onClick={cancel}>{state.counts.created > 0 ? "ยกเลิก" : "ปิด"}</Button>
          </div>
        </div>
      )}
      {state.kind === "done" && (
        <Notice tone="ok" role="status" className="mt-3" data-testid="import-done">
          {importSummary(state.counts, "done", n)}
        </Notice>
      )}
      {state.kind === "error" && <Notice tone="bad" role="alert" className="mt-3">{state.message}</Notice>}
    </Card>
  );
}

export function DepartmentGroups<T extends { id: number }>(props: {
  groups: DepartmentGroup<T>[];
  renderRow: (row: T) => ReactNode;
}) {
  return (
    <div className="space-y-5">
      {props.groups.map((g) => (
        <Card as="section" pad={false} key={g.key} aria-label={g.name}>
          <h3 className="border-b border-line px-4 py-3 font-semibold sm:px-5">
            {g.name} <span className="font-normal text-muted">({g.rows.length})</span>
          </h3>
          <ul className="divide-y divide-line2">
            {g.rows.map((r) => (
              // key เป็น id ของแถวเสมอ — ชื่อซ้ำกันได้
              <li key={r.id} className="px-4 py-2.5 sm:px-5">{props.renderRow(r)}</li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
