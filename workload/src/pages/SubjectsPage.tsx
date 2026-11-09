import { useState, type FormEvent } from "react";
import { createSubject, listDepartments, listSubjects, updateSubject } from "../api";
import { buildSubjectBody, changedFields, sortSubjects } from "../registry";
import type { Department, SubjectIdentity, SubjectPatch, WlSubject } from "../types";
import { useDepartmentGroups, useRegistryList, useSaving, useWriteErrors } from "../useRegistryList";
import {
  DepartmentGroups, DepartmentSelect, InactiveSwitch, inputClass, NeverSentBadge, RegistryFrame, RowError,
} from "./registryParts";

// ค่า type สองค่าของวิชา: "คู่ขนาน" ตามที่ frontend/ เรียก (Dashboard.tsx "รหัสคู่ขนาน") · "common" ที่นั่นไม่มีชื่อไทย จึงใช้ "ปกติ"
const TYPE_TEXT: Record<SubjectIdentity["type"], string> = { common: "ปกติ", parallel: "คู่ขนาน" };

const EMPTY: SubjectIdentity = {
  code: "", name: "", type: "common", department_id: null, duration: 1, is_activity: false, is_elective: false,
};

// ช่องกรอกของวิชา ใช้ทั้งฟอร์มเพิ่มและการแก้ในแถว
function SubjectFields(props: {
  value: SubjectIdentity;
  onChange: (v: SubjectIdentity) => void;
  departments: Department[];
  disabled: boolean;
}) {
  const v = props.value;
  const set = (p: Partial<SubjectIdentity>) => props.onChange({ ...v, ...p });
  return (
    <>
      <input aria-label="รหัสวิชา" placeholder="รหัสวิชา" value={v.code} onChange={(e) => set({ code: e.target.value })} disabled={props.disabled} className={`${inputClass} w-28`} />
      <input aria-label="ชื่อวิชา" placeholder="ชื่อวิชา" value={v.name} onChange={(e) => set({ name: e.target.value })} disabled={props.disabled} className={inputClass} />
      <select aria-label="ประเภท" value={v.type} onChange={(e) => set({ type: e.target.value as SubjectIdentity["type"] })} disabled={props.disabled} className={inputClass}>
        <option value="common">{TYPE_TEXT.common}</option>
        <option value="parallel">{TYPE_TEXT.parallel}</option>
      </select>
      <DepartmentSelect label="กลุ่มสาระ" value={v.department_id} onChange={(d) => set({ department_id: d })} departments={props.departments} disabled={props.disabled} />
      <label className="flex items-center gap-1 text-sm whitespace-nowrap">
        <input type="checkbox" checked={v.duration === 2} onChange={(e) => set({ duration: e.target.checked ? 2 : 1 })} disabled={props.disabled} />
        คาบคู่
      </label>
      <label className="flex items-center gap-1 text-sm whitespace-nowrap">
        <input type="checkbox" checked={v.is_activity} onChange={(e) => set({ is_activity: e.target.checked })} disabled={props.disabled} />
        เป็นกิจกรรม
      </label>
      <label className="flex items-center gap-1 text-sm whitespace-nowrap">
        <input type="checkbox" checked={Boolean(v.is_elective)} onChange={(e) => set({ is_elective: e.target.checked })} disabled={props.disabled} />
        เป็นวิชาเสรี
      </label>
    </>
  );
}

function identityOf(s: WlSubject): SubjectIdentity {
  return {
    code: s.code, name: s.name, type: s.type, department_id: s.department_id,
    duration: s.duration, is_activity: s.is_activity, is_elective: Boolean(s.is_elective),
  };
}

export default function SubjectsPage() {
  const subjects = useRegistryList(listSubjects);
  const depts = useRegistryList(listDepartments);
  const { saving, run } = useSaving();
  const { addError, setAddError, rowError, setRowError } = useWriteErrors();
  const [editingId, setEditingId] = useState<number | null>(null);

  const loaded = subjects.loaded && depts.loaded;
  const groups = useDepartmentGroups(subjects.rows, sortSubjects, depts.rows);
  const activeCount = subjects.rows.filter((s) => s.active).length;

  const patch = (id: number, body: SubjectPatch) => {
    setRowError(null);
    return run(
      async () => {
        subjects.upsert(await updateSubject(id, body));
      },
      (message) => setRowError({ id, message }),
    );
  };

  const saveRow = async (s: WlSubject, draft: SubjectIdentity) => {
    const built = buildSubjectBody(draft);
    if (!built.ok) return setRowError({ id: s.id, message: built.message });
    const changed = changedFields(identityOf(s), built.body);
    if (Object.keys(changed).length === 0) return setEditingId(null);
    if (await patch(s.id, changed)) setEditingId(null);
  };

  const addSubject = async (draft: SubjectIdentity): Promise<boolean> => {
    setAddError(null);
    const built = buildSubjectBody(draft);
    if (!built.ok) {
      setAddError(built.message);
      return false;
    }
    return run(
      async () => {
        subjects.upsert(await createSubject(built.body));
      },
      setAddError,
    );
  };

  return (
    <RegistryFrame
      title="ทะเบียนวิชา"
      countTestId="subject-count"
      countText={`วิชาทั้งหมด ${subjects.rows.length} วิชา · ยังเปิดสอน ${activeCount} วิชา`}
      loaded={loaded}
      loadError={subjects.error ?? depts.error}
      saving={saving}
      onRetry={() => {
        subjects.reload();
        depts.reload();
      }}
    >
      <AddSubjectForm departments={depts.rows} disabled={saving} error={addError} onAdd={addSubject} />
      <DepartmentGroups
        groups={groups}
        renderRow={(s) => (
          <SubjectRow
            subject={s}
            departments={depts.rows}
            disabled={saving}
            editing={editingId === s.id}
            error={rowError?.id === s.id ? rowError.message : null}
            onEdit={() => {
              setRowError(null);
              setEditingId(s.id);
            }}
            onCancel={() => {
              setRowError(null);
              setEditingId(null);
            }}
            onSave={(draft) => saveRow(s, draft)}
            onActive={(active) => patch(s.id, { active })}
          />
        )}
      />
    </RegistryFrame>
  );
}

function AddSubjectForm(props: {
  departments: Department[];
  disabled: boolean;
  error: string | null;
  onAdd: (draft: SubjectIdentity) => Promise<boolean>;
}) {
  const [v, setV] = useState<SubjectIdentity>(EMPTY);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (props.disabled) return;
    // เก็บกลุ่มสาระ/ประเภทไว้ให้เพิ่มวิชาถัดไปในกลุ่มเดียวกันได้เร็ว ล้างแต่รหัสกับชื่อ
    if (await props.onAdd(v)) setV({ ...v, code: "", name: "" });
  };

  return (
    <form onSubmit={submit} aria-label="เพิ่มวิชา" className="mt-3 mb-4 flex flex-wrap items-center gap-2 rounded border border-gray-300 bg-white p-3">
      <SubjectFields value={v} onChange={setV} departments={props.departments} disabled={props.disabled} />
      <button type="submit" disabled={props.disabled} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
        เพิ่มวิชา
      </button>
      <RowError message={props.error} />
    </form>
  );
}

function SubjectRow(props: {
  subject: WlSubject;
  departments: Department[];
  disabled: boolean;
  editing: boolean;
  error: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (draft: SubjectIdentity) => Promise<void>;
  onActive: (active: boolean) => Promise<boolean>;
}) {
  const s = props.subject;
  const [draft, setDraft] = useState<SubjectIdentity>(identityOf(s));

  return (
    <div className={`flex flex-wrap items-center gap-2 ${s.active ? "" : "opacity-50"}`} data-testid={`subject-${s.id}`}>
      {props.editing ? (
        <>
          <SubjectFields value={draft} onChange={setDraft} departments={props.departments} disabled={props.disabled} />
          <button onClick={() => void props.onSave(draft)} disabled={props.disabled} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">บันทึก</button>
          <button onClick={props.onCancel} disabled={props.disabled} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50">ยกเลิก</button>
        </>
      ) : (
        <>
          <span className="w-24 text-gray-600">{s.code}</span>
          <span className="font-medium">{s.name}</span>
          {s.type === "parallel" && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{TYPE_TEXT.parallel}</span>}
          {s.duration === 2 && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">คาบคู่</span>}
          {s.is_activity && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">กิจกรรม</span>}
          {s.is_elective && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">วิชาเสรี</span>}
          {s.sched_id === null && <NeverSentBadge />}
          <span className="ml-auto flex items-center gap-3">
            <InactiveSwitch inactive={!s.active} disabled={props.disabled} onChange={(v) => void props.onActive(!v)} text="ไม่เปิดสอนแล้ว" />
            <button
              onClick={() => {
                setDraft(identityOf(s));
                props.onEdit();
              }}
              disabled={props.disabled}
              className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
            >
              แก้ไข
            </button>
          </span>
        </>
      )}
      <RowError message={props.error} />
    </div>
  );
}
