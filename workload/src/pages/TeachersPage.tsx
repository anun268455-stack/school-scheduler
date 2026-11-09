import { useMemo, useState, type FormEvent } from "react";
import {
  createTeacher, importPreview, importRun, listDepartments, listTeachers, updateTeacher, apiErrorText,
} from "../api";
import { groupByDepartment, importSummary, parseOrder, sortTeachers } from "../registry";
import type { Department, ImportCounts, TeacherPatch, WlTeacher } from "../types";
import { useRegistryList, useSaving } from "../useRegistryList";
import {
  DepartmentGroups, DepartmentSelect, InactiveSwitch, inputClass, NeverSentBadge, RegistryStatus,
} from "./registryParts";

type ImportState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "confirm"; counts: ImportCounts }
  | { kind: "running" }
  | { kind: "done"; counts: ImportCounts }
  | { kind: "error"; message: string };

export default function TeachersPage() {
  const teachers = useRegistryList(listTeachers);
  const depts = useRegistryList(listDepartments);
  const { saving, error, setError, run } = useSaving();
  const [imp, setImp] = useState<ImportState>({ kind: "idle" });
  const [editingId, setEditingId] = useState<number | null>(null);

  const loading = teachers.loading || depts.loading;
  const loadError = teachers.error ?? depts.error;
  const groups = useMemo(
    () => groupByDepartment(sortTeachers(teachers.rows), depts.rows),
    [teachers.rows, depts.rows],
  );
  const activeCount = teachers.rows.filter((t) => t.active).length;
  const importBusy = imp.kind === "checking" || imp.kind === "running";
  const disabled = saving || importBusy;

  const patch = (id: number, body: TeacherPatch) =>
    run(async () => {
      teachers.upsert(await updateTeacher(id, body));
    });

  const startImport = async () => {
    setImp({ kind: "checking" });
    try {
      setImp({ kind: "confirm", counts: await importPreview() });
    } catch (err) {
      setImp({ kind: "error", message: apiErrorText(err) });
    }
  };

  const confirmImport = async () => {
    setImp({ kind: "running" });
    try {
      const counts = await importRun();
      setImp({ kind: "done", counts });
      teachers.reload();
    } catch (err) {
      setImp({ kind: "error", message: apiErrorText(err) });
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold">ทะเบียนครู</h2>
      {!loading && !loadError && (
        <p data-testid="teacher-count" className="mt-1">
          ครูทั้งหมด {teachers.rows.length} คน · ยังปฏิบัติงาน {activeCount} คน
        </p>
      )}

      <div className="mt-3 rounded border border-gray-300 bg-white p-3">
        <button
          onClick={startImport}
          disabled={disabled || imp.kind === "confirm"}
          className="rounded border border-blue-600 px-3 py-1 text-blue-700 disabled:opacity-50"
        >
          ดึงครูจากโปรแกรมจัดตาราง
        </button>
        {imp.kind === "checking" && <p role="status" className="mt-2">กำลังตรวจจำนวน...</p>}
        {imp.kind === "running" && <p role="status" className="mt-2">กำลังดึงครู...</p>}
        {imp.kind === "confirm" && (
          <div className="mt-2" data-testid="import-confirm">
            <p>{importSummary(imp.counts, "preview")}</p>
            <p className="text-sm text-gray-600">ยังไม่ได้เขียนอะไรลงทะเบียน จนกว่าจะกดยืนยัน</p>
            <div className="mt-2 flex gap-2">
              {imp.counts.created > 0 && (
                <button onClick={confirmImport} className="rounded bg-blue-600 px-3 py-1 text-white">
                  ยืนยันดึงครู {imp.counts.created} คน
                </button>
              )}
              <button onClick={() => setImp({ kind: "idle" })} className="rounded border border-gray-300 px-3 py-1">
                {imp.counts.created > 0 ? "ยกเลิก" : "ปิด"}
              </button>
            </div>
          </div>
        )}
        {imp.kind === "done" && (
          <p role="status" className="mt-2 text-green-800" data-testid="import-done">
            {importSummary(imp.counts, "done")}
          </p>
        )}
        {imp.kind === "error" && <p role="alert" className="mt-2 text-red-700">{imp.message}</p>}
      </div>

      {!loading && !loadError && (
        <AddTeacherForm
          departments={depts.rows}
          disabled={disabled}
          onAdd={(body) =>
            run(async () => {
              teachers.upsert(await createTeacher(body));
            })
          }
          onInvalid={setError}
        />
      )}

      <RegistryStatus loading={loading} saving={saving} error={error ?? loadError} />
      {loadError && (
        <button
          onClick={() => {
            teachers.reload();
            depts.reload();
          }}
          className="rounded border border-gray-300 px-3 py-1"
        >
          ลองโหลดใหม่
        </button>
      )}

      {!loading && !loadError && (
        <DepartmentGroups
          groups={groups}
          renderRow={(t) => (
            <TeacherRow
              teacher={t}
              departments={depts.rows}
              disabled={disabled}
              editing={editingId === t.id}
              onEdit={() => setEditingId(t.id)}
              onCancel={() => setEditingId(null)}
              onSave={async (body) => {
                if (await patch(t.id, body)) setEditingId(null);
              }}
              onInvalid={setError}
              onActive={(active) => patch(t.id, { active })}
            />
          )}
        />
      )}
    </div>
  );
}

function AddTeacherForm(props: {
  departments: Department[];
  disabled: boolean;
  onAdd: (body: { name: string; code: string | null; department_id: number | null; dept_order: number | null }) => Promise<boolean>;
  onInvalid: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [dept, setDept] = useState<number | null>(null);
  const [order, setOrder] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (props.disabled) return;
    if (name.trim() === "") return props.onInvalid("กรุณากรอกชื่อครู");
    const o = parseOrder(order);
    if (!o.ok) return props.onInvalid("ลำดับในกลุ่มต้องเป็นจำนวนเต็ม หรือเว้นว่างไว้");
    const ok = await props.onAdd({
      name,
      code: code.trim() === "" ? null : code,
      department_id: dept,
      dept_order: o.value,
    });
    if (ok) {
      setName("");
      setCode("");
      setOrder("");
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 rounded border border-gray-300 bg-white p-3">
      <label className="block text-sm">
        ชื่อครู
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={props.disabled} className={`${inputClass} mt-1 block`} />
      </label>
      <label className="block text-sm">
        รหัสประจำตัว
        <input value={code} onChange={(e) => setCode(e.target.value)} disabled={props.disabled} className={`${inputClass} mt-1 block w-28`} />
      </label>
      <label className="block text-sm">
        กลุ่มสาระ
        <span className="mt-1 block">
          <DepartmentSelect label="กลุ่มสาระของครูใหม่" value={dept} onChange={setDept} departments={props.departments} disabled={props.disabled} />
        </span>
      </label>
      <label className="block text-sm">
        ลำดับในกลุ่ม
        <input value={order} onChange={(e) => setOrder(e.target.value)} disabled={props.disabled} inputMode="numeric" className={`${inputClass} mt-1 block w-20`} />
      </label>
      <button type="submit" disabled={props.disabled} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
        เพิ่มครู
      </button>
    </form>
  );
}

function TeacherRow(props: {
  teacher: WlTeacher;
  departments: Department[];
  disabled: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (body: TeacherPatch) => Promise<void>;
  onInvalid: (message: string) => void;
  onActive: (active: boolean) => Promise<boolean>;
}) {
  const t = props.teacher;
  const [name, setName] = useState(t.name);
  const [code, setCode] = useState(t.code ?? "");
  const [dept, setDept] = useState<number | null>(t.department_id);
  const [order, setOrder] = useState(t.dept_order === null ? "" : String(t.dept_order));

  const startEdit = () => {
    setName(t.name);
    setCode(t.code ?? "");
    setDept(t.department_id);
    setOrder(t.dept_order === null ? "" : String(t.dept_order));
    props.onEdit();
  };

  const save = async () => {
    if (name.trim() === "") return props.onInvalid("กรุณากรอกชื่อครู");
    const o = parseOrder(order);
    if (!o.ok) return props.onInvalid("ลำดับในกลุ่มต้องเป็นจำนวนเต็ม หรือเว้นว่างไว้");
    await props.onSave({
      name,
      code: code.trim() === "" ? null : code,
      department_id: dept,
      dept_order: o.value,
    });
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${t.active ? "" : "opacity-50"}`} data-testid={`teacher-${t.id}`}>
      {props.editing ? (
        <>
          <input aria-label="ชื่อครู" value={name} onChange={(e) => setName(e.target.value)} disabled={props.disabled} className={inputClass} />
          <input aria-label="รหัสประจำตัว" value={code} onChange={(e) => setCode(e.target.value)} disabled={props.disabled} className={`${inputClass} w-28`} />
          <DepartmentSelect label="กลุ่มสาระ" value={dept} onChange={setDept} departments={props.departments} disabled={props.disabled} />
          <input aria-label="ลำดับในกลุ่ม" value={order} onChange={(e) => setOrder(e.target.value)} disabled={props.disabled} inputMode="numeric" className={`${inputClass} w-20`} />
          <button onClick={save} disabled={props.disabled} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">บันทึก</button>
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
            <button onClick={startEdit} disabled={props.disabled} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50">แก้ไข</button>
          </span>
        </>
      )}
    </div>
  );
}
