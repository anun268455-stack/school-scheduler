import { useState, type FormEvent } from "react";
import { createTeacher, importPreview, importRun, listDepartments, listTeachers, updateTeacher } from "../api";
import { buildTeacherBody, changedFields, sortTeachers, TEACHER_NOUN, type TeacherForm } from "../registry";
import type { Department, TeacherPatch, WlTeacher } from "../types";
import {
  useDepartmentGroups, useRegistryList, useSaving, useSchedulerImport, useWriteErrors,
} from "../useRegistryList";
import {
  DepartmentGroups, ImportBox, InactiveSwitch, NeverSentBadge, RegistryFrame, RowError, TeacherFields,
} from "./registryParts";

const EMPTY_FORM: TeacherForm = { name: "", code: "", department_id: null, order: "" };

function formOf(t: WlTeacher): TeacherForm {
  return {
    name: t.name,
    code: t.code ?? "",
    department_id: t.department_id,
    order: t.dept_order == null ? "" : String(t.dept_order),
  };
}

export default function TeachersPage() {
  const teachers = useRegistryList(listTeachers);
  const depts = useRegistryList(listDepartments);
  const { saving, run } = useSaving();
  const { addError, setAddError, rowError, setRowError } = useWriteErrors();
  const imp = useSchedulerImport(importPreview, importRun, teachers.reload);
  const [editingId, setEditingId] = useState<number | null>(null);

  const loaded = teachers.loaded && depts.loaded;
  const groups = useDepartmentGroups(teachers.rows, sortTeachers, depts.rows);
  const activeCount = teachers.rows.filter((t) => t.active).length;
  const disabled = saving || imp.busy;

  const patch = (id: number, body: TeacherPatch) => {
    setRowError(null);
    return run(
      async () => {
        teachers.upsert(await updateTeacher(id, body));
      },
      (message) => setRowError({ id, message }),
    );
  };

  const saveRow = async (t: WlTeacher, form: TeacherForm) => {
    const built = buildTeacherBody(form);
    if (!built.ok) return setRowError({ id: t.id, message: built.message });
    // ส่งเฉพาะช่องที่เปลี่ยน — กลุ่มสาระที่ไม่มีแล้วของแถวนี้จะไม่ถูกส่งกลับไป
    const changed = changedFields(
      { name: t.name, code: t.code ?? null, department_id: t.department_id, dept_order: t.dept_order ?? null },
      built.body,
    );
    if (Object.keys(changed).length === 0) {
      // ไม่มีอะไรเปลี่ยน = ปิดตัวแก้ และข้อความแดงเก่าของแถวนี้ต้องหายไปด้วย
      setRowError(null);
      return setEditingId(null);
    }
    if (await patch(t.id, changed)) setEditingId(null);
  };

  const addTeacher = async (form: TeacherForm): Promise<boolean> => {
    setAddError(null);
    const built = buildTeacherBody(form);
    if (!built.ok) {
      setAddError(built.message);
      return false;
    }
    return run(
      async () => {
        teachers.upsert(await createTeacher(built.body));
      },
      setAddError,
    );
  };

  return (
    <RegistryFrame
      title="ทะเบียนครู"
      countTestId="teacher-count"
      countText={`ครูทั้งหมด ${teachers.rows.length} คน · ยังปฏิบัติงาน ${activeCount} คน`}
      loaded={loaded}
      loadError={teachers.error ?? depts.error}
      saving={saving}
      onRetry={() => {
        teachers.reload();
        depts.reload();
      }}
      top={<ImportBox imp={imp} noun={TEACHER_NOUN} disabled={disabled} />}
    >
      <AddTeacherForm departments={depts.rows} disabled={disabled} error={addError} onAdd={addTeacher} />
      <DepartmentGroups
        groups={groups}
        renderRow={(t) => (
          <TeacherRow
            teacher={t}
            departments={depts.rows}
            disabled={disabled}
            editing={editingId === t.id}
            error={rowError?.id === t.id ? rowError.message : null}
            onEdit={() => {
              setRowError(null);
              setEditingId(t.id);
            }}
            onCancel={() => {
              setRowError(null);
              setEditingId(null);
            }}
            onSave={(form) => saveRow(t, form)}
            onActive={(active) => patch(t.id, { active })}
          />
        )}
      />
    </RegistryFrame>
  );
}

function AddTeacherForm(props: {
  departments: Department[];
  disabled: boolean;
  error: string | null;
  onAdd: (form: TeacherForm) => Promise<boolean>;
}) {
  const [form, setForm] = useState<TeacherForm>(EMPTY_FORM);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (props.disabled) return;
    // เก็บกลุ่มสาระไว้ให้เพิ่มคนถัดไปในกลุ่มเดียวกันได้เร็ว ล้างที่เหลือ
    if (await props.onAdd(form)) setForm({ ...EMPTY_FORM, department_id: form.department_id });
  };

  return (
    <form onSubmit={submit} aria-label="เพิ่มครู" className="mt-3 mb-4 flex flex-wrap items-end gap-2 rounded border border-gray-300 bg-white p-3">
      <TeacherFields value={form} onChange={setForm} departments={props.departments} disabled={props.disabled} />
      <button type="submit" disabled={props.disabled} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
        เพิ่มครู
      </button>
      <RowError message={props.error} />
    </form>
  );
}

function TeacherRow(props: {
  teacher: WlTeacher;
  departments: Department[];
  disabled: boolean;
  editing: boolean;
  error: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (form: TeacherForm) => Promise<void>;
  onActive: (active: boolean) => Promise<boolean>;
}) {
  const t = props.teacher;
  const [form, setForm] = useState<TeacherForm>(formOf(t));

  return (
    <div className={`flex flex-wrap gap-2 ${props.editing ? "items-end" : "items-center"} ${t.active ? "" : "opacity-50"}`} data-testid={`teacher-${t.id}`}>
      {props.editing ? (
        <>
          <TeacherFields value={form} onChange={setForm} departments={props.departments} disabled={props.disabled} />
          <button onClick={() => void props.onSave(form)} disabled={props.disabled} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">บันทึก</button>
          <button onClick={props.onCancel} disabled={props.disabled} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50">ยกเลิก</button>
        </>
      ) : (
        <>
          <span className="w-10 text-right text-gray-500">{t.dept_order ?? "-"}</span>
          <span className="font-medium">{t.name}</span>
          {t.code && <span className="text-sm text-gray-600">({t.code})</span>}
          {t.sched_id === null && <NeverSentBadge />}
          <span className="ml-auto flex items-center gap-3">
            <InactiveSwitch inactive={!t.active} disabled={props.disabled} onChange={(v) => void props.onActive(!v)} text="ไม่ปฏิบัติงานแล้ว" />
            <button
              onClick={() => {
                setForm(formOf(t));
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
