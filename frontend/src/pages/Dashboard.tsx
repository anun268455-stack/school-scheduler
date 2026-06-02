/**
 * Dashboard v4 – Full CRUD with inline edit for all entities + Periods + Bulk Lock + Import
 */
import React, { useState } from "react";
import clsx from "clsx";
import { useTimetableStore } from "../store/timetableStore";
import type { SubjectType, SubjectWeight, RoomType, PeriodType } from "../types";
import { DAYS } from "../types";
import * as api from "../api/client";
import { ImportModal } from "../components/import/ImportModal";

export type DashPage =
  | "groups" | "teachers" | "subjects" | "rooms"
  | "requirements" | "periods" | "locks";

export const Dashboard: React.FC<{ page: DashPage }> = ({ page }) => {
  const pageMap: Record<DashPage, React.ReactNode> = {
    groups:       <GroupsPanel />,
    teachers:     <TeachersPanel />,
    subjects:     <SubjectsPanel />,
    rooms:        <RoomsPanel />,
    requirements: <RequirementsPanel />,
    periods:      <PeriodsPanel />,
    locks:        <BulkLockPanel />,
  };

  return <div className="p-4 max-w-5xl mx-auto">{pageMap[page]}</div>;
};

// ─── Shared helpers ───────────────────────────────────────────────────────────
function useReload() { return useTimetableStore((s) => s.loadAll); }

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-gray-800">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls   = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none";
const inlineCls  = "border rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none w-full";
const btnPrimary = "px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors font-medium";
const btnDanger  = "px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors border border-red-200";
const btnEdit    = "px-2 py-1 text-xs bg-gray-100 border border-gray-300 text-gray-700 rounded hover:bg-gray-200 transition-colors";
const btnSave    = "px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700";
const btnCancel  = "px-2 py-0.5 text-xs bg-gray-200 rounded hover:bg-gray-300";
const btnImport  = "flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 transition-colors font-medium";

// ─── Import button (reusable) ─────────────────────────────────────────────────
function ImportButton({ entity }: { entity: "teachers"|"rooms"|"subjects"|"groups" }) {
  const [open, setOpen] = useState(false);
  const reload = useReload();
  return (
    <>
      <button onClick={() => setOpen(true)} className={btnImport} title={`นำเข้า ${entity}`}>
        📥 นำเข้าจาก Excel/CSV
      </button>
      {open && (
        <ImportModal
          onClose={() => setOpen(false)}
          onSuccess={() => { setOpen(false); reload(); }}
        />
      )}
    </>
  );
}

// ─── Groups ──────────────────────────────────────────────────────────────────
const GroupsPanel: React.FC = () => {
  const { groups } = useTimetableStore();
  const reload = useReload();
  const [form, setForm]     = useState({ name: "", level: "M1", size: 40, parent_id: "" });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; level: string; size: number; parent_id: string } | null>(null);

  const handleCreate = async () => {
    await api.createGroup({
      name: form.name, level: form.level || null,
      size: form.size, parent_id: form.parent_id ? Number(form.parent_id) : null,
    });
    await reload();
    setForm({ name: "", level: "M1", size: 40, parent_id: "" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    await api.updateGroup(id, {
      name: editForm.name, level: editForm.level || null,
      size: editForm.size, parent_id: editForm.parent_id ? Number(editForm.parent_id) : null,
    });
    await reload();
    setEditing(null); setEditForm(null);
  };

  const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);

  return (
    <Section title="ห้องเรียน (Groups)" action={<ImportButton entity="groups" />}>
      <div className="grid grid-cols-4 gap-2 mb-3">
        <Field label="ชื่อห้อง *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ม.1/1" />
        </Field>
        <Field label="ระดับ">
          <select className={inputCls} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
            {["M1","M2","M3","M4","M5","M6"].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="จำนวนนักเรียน">
          <input type="number" min={1} className={inputCls} value={form.size} onChange={(e) => setForm({ ...form, size: Number(e.target.value) })} />
        </Field>
        <Field label="ห้องแม่ (Parent)">
          <select className={inputCls} value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
            <option value="">– ไม่มี –</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      </div>
      <button onClick={handleCreate} disabled={!form.name} className={btnPrimary}>+ เพิ่มห้องเรียน</button>

      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ชื่อห้อง","ระดับ","จำนวน","ห้องแม่",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {flat.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {flat.map((g) => (
              <tr key={g.id} className="hover:bg-gray-50">
                {editing === g.id && editForm ? (
                  <>
                    <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.level} onChange={(e) => setEditForm({ ...editForm, level: e.target.value })}>
                        {["M1","M2","M3","M4","M5","M6"].map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1"><input type="number" className={inlineCls} style={{ width: 70 }} value={editForm.size} onChange={(e) => setEditForm({ ...editForm, size: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.parent_id} onChange={(e) => setEditForm({ ...editForm, parent_id: e.target.value })}>
                        <option value="">– ไม่มี –</option>
                        {groups.filter((pg) => pg.id !== g.id).map((pg) => <option key={pg.id} value={pg.id}>{pg.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1">
                        <button onClick={() => handleUpdate(g.id)} className={btnSave}>บันทึก</button>
                        <button onClick={() => { setEditing(null); setEditForm(null); }} className={btnCancel}>ยกเลิก</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-medium text-gray-800">{g.name}</td>
                    <td className="px-3 py-2 text-gray-600">{g.level ?? "–"}</td>
                    <td className="px-3 py-2 text-gray-600">{g.size}</td>
                    <td className="px-3 py-2 text-gray-500">{g.parent_id ? flat.find((p) => p.id === g.parent_id)?.name ?? String(g.parent_id) : "–"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(g.id); setEditForm({ name: g.name, level: g.level ?? "M1", size: g.size, parent_id: g.parent_id ? String(g.parent_id) : "" }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteGroup(g.id); await reload(); }} className={btnDanger}>ลบ</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// ─── Teachers ────────────────────────────────────────────────────────────────
const TeachersPanel: React.FC = () => {
  const { teachers } = useTimetableStore();
  const reload = useReload();
  const [form, setForm]     = useState({ name: "", outdoor_score: 5, max_slots_per_day: 6, max_outdoor_per_week: 2 });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

  const handleCreate = async () => {
    await api.createTeacher({ ...form, fixed_room_id: null });
    await reload();
    setForm({ name: "", outdoor_score: 5, max_slots_per_day: 6, max_outdoor_per_week: 2 });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    await api.updateTeacher(id, editForm);
    await reload();
    setEditing(null); setEditForm(null);
  };

  return (
    <Section title="ครูผู้สอน (Teachers)" action={<ImportButton entity="teachers" />}>
      <div className="grid grid-cols-4 gap-2 mb-3">
        <Field label="ชื่อครู *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ครูสมชาย ใจดี" />
        </Field>
        <Field label="คะแนนกลางแจ้ง (0-10)">
          <input type="number" min={0} max={10} className={inputCls} value={form.outdoor_score} onChange={(e) => setForm({ ...form, outdoor_score: Number(e.target.value) })} />
        </Field>
        <Field label="สอนสูงสุด/วัน">
          <input type="number" min={1} max={10} className={inputCls} value={form.max_slots_per_day} onChange={(e) => setForm({ ...form, max_slots_per_day: Number(e.target.value) })} />
        </Field>
        <Field label="กลางแจ้งสูงสุด/สัปดาห์">
          <input type="number" min={0} max={10} className={inputCls} value={form.max_outdoor_per_week} onChange={(e) => setForm({ ...form, max_outdoor_per_week: Number(e.target.value) })} />
        </Field>
      </div>
      <button onClick={handleCreate} disabled={!form.name} className={btnPrimary}>+ เพิ่มครู</button>

      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ชื่อครู","กลางแจ้ง","สอน/วัน","กลางแจ้ง/อาทิตย์",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {teachers.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {teachers.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50">
                {editing === t.id && editForm ? (
                  <>
                    <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={10} className={inlineCls} style={{ width: 60 }} value={editForm.outdoor_score} onChange={(e) => setEditForm({ ...editForm, outdoor_score: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1"><input type="number" min={1} max={10} className={inlineCls} style={{ width: 60 }} value={editForm.max_slots_per_day} onChange={(e) => setEditForm({ ...editForm, max_slots_per_day: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={10} className={inlineCls} style={{ width: 60 }} value={editForm.max_outdoor_per_week} onChange={(e) => setEditForm({ ...editForm, max_outdoor_per_week: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1">
                        <button onClick={() => handleUpdate(t.id)} className={btnSave}>บันทึก</button>
                        <button onClick={() => { setEditing(null); setEditForm(null); }} className={btnCancel}>ยกเลิก</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-medium text-gray-800">{t.name}</td>
                    <td className="px-3 py-2 text-gray-600">{t.outdoor_score}</td>
                    <td className="px-3 py-2 text-gray-600">{t.max_slots_per_day}</td>
                    <td className="px-3 py-2 text-gray-600">{t.max_outdoor_per_week}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(t.id); setEditForm({ name: t.name, outdoor_score: t.outdoor_score, max_slots_per_day: t.max_slots_per_day, max_outdoor_per_week: t.max_outdoor_per_week }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteTeacher(t.id); await reload(); }} className={btnDanger}>ลบ</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// ─── Subjects ────────────────────────────────────────────────────────────────
const SubjectsPanel: React.FC = () => {
  const { subjects } = useTimetableStore();
  const reload = useReload();
  const [form, setForm]     = useState({ code: "", name: "", type: "common", duration: 1, weight: "light" });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

  const handleCreate = async () => {
    await api.createSubject({
      ...form,
      type:     form.type     as SubjectType,
      weight:   form.weight   as SubjectWeight,
      duration: Number(form.duration) as 1 | 2,
    });
    await reload();
    setForm({ code: "", name: "", type: "common", duration: 1, weight: "light" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    await api.updateSubject(id, {
      code: editForm.code, name: editForm.name,
      type: editForm.type as SubjectType,
      weight: editForm.weight as SubjectWeight,
      duration: Number(editForm.duration) as 1 | 2,
    });
    await reload();
    setEditing(null); setEditForm(null);
  };

  return (
    <Section title="วิชาเรียน (Subjects)" action={<ImportButton entity="subjects" />}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="รหัสวิชา *">
          <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MATH101" />
        </Field>
        <Field label="ชื่อวิชา *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="คณิตศาสตร์" />
        </Field>
        <Field label="ประเภท">
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="common">ทั่วไป (common)</option>
            <option value="parallel">คู่ขนาน (parallel)</option>
          </select>
        </Field>
        <Field label="จำนวนคาบ">
          <select className={inputCls} value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}>
            <option value={1}>1 คาบ</option>
            <option value={2}>2 คาบ (คาบคู่)</option>
          </select>
        </Field>
        <Field label="น้ำหนัก">
          <select className={inputCls} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })}>
            <option value="light">เบา (light)</option>
            <option value="heavy">หนัก (heavy)</option>
          </select>
        </Field>
      </div>
      <button onClick={handleCreate} disabled={!form.code || !form.name} className={btnPrimary}>+ เพิ่มวิชา</button>

      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["รหัส","ชื่อวิชา","ประเภท","คาบ","น้ำหนัก",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {subjects.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {subjects.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                {editing === s.id && editForm ? (
                  <>
                    <td className="px-2 py-1"><input className={inlineCls} style={{ width: 80 }} value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                        <option value="common">common</option>
                        <option value="parallel">parallel</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} style={{ width: 60 }} value={editForm.duration} onChange={(e) => setEditForm({ ...editForm, duration: Number(e.target.value) })}>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.weight} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })}>
                        <option value="light">light</option>
                        <option value="heavy">heavy</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1">
                        <button onClick={() => handleUpdate(s.id)} className={btnSave}>บันทึก</button>
                        <button onClick={() => { setEditing(null); setEditForm(null); }} className={btnCancel}>ยกเลิก</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{s.code}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{s.name}</td>
                    <td className="px-3 py-2 text-gray-600">{s.type}</td>
                    <td className="px-3 py-2 text-gray-600">{s.duration}</td>
                    <td className="px-3 py-2 text-gray-600">{s.weight}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(s.id); setEditForm({ code: s.code, name: s.name, type: s.type, duration: s.duration, weight: s.weight }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteSubject(s.id); await reload(); }} className={btnDanger}>ลบ</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// ─── Rooms ───────────────────────────────────────────────────────────────────
const RoomsPanel: React.FC = () => {
  const { rooms, buildings } = useTimetableStore();
  const reload = useReload();
  const [form, setForm]     = useState({ name: "", type: "physical", building_id: "", floor: 1, capacity: 40 });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

  const handleCreate = async () => {
    await api.createRoom({
      ...form,
      type:        form.type as RoomType,
      building_id: form.building_id ? Number(form.building_id) : null,
      floor:       Number(form.floor),
      capacity:    Number(form.capacity),
      specialized_dept_id: null,
      reserved_teacher_id: null,
    });
    await reload();
    setForm({ name: "", type: "physical", building_id: "", floor: 1, capacity: 40 });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    await api.updateRoom(id, {
      name: editForm.name,
      type: editForm.type as RoomType,
      building_id: editForm.building_id ? Number(editForm.building_id) : null,
      floor: Number(editForm.floor),
      capacity: Number(editForm.capacity),
    });
    await reload();
    setEditing(null); setEditForm(null);
  };

  return (
    <Section title="ห้องสอน (Rooms)" action={<ImportButton entity="rooms" />}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="ชื่อห้อง *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ห้อง 101" />
        </Field>
        <Field label="ประเภท">
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="physical">ห้องเรียนทั่วไป</option>
            <option value="special">ห้องพิเศษ</option>
            <option value="outdoor">กลางแจ้ง</option>
          </select>
        </Field>
        <Field label="อาคาร">
          <select className={inputCls} value={form.building_id} onChange={(e) => setForm({ ...form, building_id: e.target.value })}>
            <option value="">– ไม่ระบุ –</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="ชั้น">
          <input type="number" min={1} className={inputCls} value={form.floor} onChange={(e) => setForm({ ...form, floor: Number(e.target.value) })} />
        </Field>
        <Field label="ความจุ (คน)">
          <input type="number" min={1} className={inputCls} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
        </Field>
      </div>
      <button onClick={handleCreate} disabled={!form.name} className={btnPrimary}>+ เพิ่มห้อง</button>

      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ชื่อ","ประเภท","อาคาร","ชั้น","ความจุ",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rooms.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {rooms.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                {editing === r.id && editForm ? (
                  <>
                    <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                        <option value="physical">ทั่วไป</option>
                        <option value="special">พิเศษ</option>
                        <option value="outdoor">กลางแจ้ง</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.building_id} onChange={(e) => setEditForm({ ...editForm, building_id: e.target.value })}>
                        <option value="">– ไม่ระบุ –</option>
                        {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1"><input type="number" className={inlineCls} style={{ width: 60 }} value={editForm.floor} onChange={(e) => setEditForm({ ...editForm, floor: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1"><input type="number" className={inlineCls} style={{ width: 70 }} value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1">
                        <button onClick={() => handleUpdate(r.id)} className={btnSave}>บันทึก</button>
                        <button onClick={() => { setEditing(null); setEditForm(null); }} className={btnCancel}>ยกเลิก</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.name}</td>
                    <td className="px-3 py-2 text-gray-600">{r.type}</td>
                    <td className="px-3 py-2 text-gray-500">{r.building_name ?? "–"}</td>
                    <td className="px-3 py-2 text-gray-600">{r.floor}</td>
                    <td className="px-3 py-2 text-gray-600">{r.capacity}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(r.id); setEditForm({ name: r.name, type: r.type, building_id: r.building_id ? String(r.building_id) : "", floor: r.floor, capacity: r.capacity }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteRoom(r.id); await reload(); }} className={btnDanger}>ลบ</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// ─── Requirements (Teacher-Subject-Group Assignments) ─────────────────────────
const RequirementsPanel: React.FC = () => {
  const { requirements, groups, teachers, subjects } = useTimetableStore();
  const reload = useReload();
  const [form, setForm] = useState({
    group_id: "", subject_id: "", teacher_id: "", weekly_count: 1, parallel_group_key: "",
  });

  const handleCreate = async () => {
    await api.createRequirement({
      group_id:   Number(form.group_id),
      subject_id: Number(form.subject_id),
      teacher_id: Number(form.teacher_id),
      weekly_count: Number(form.weekly_count),
      parallel_group_key: form.parallel_group_key || null,
    });
    await reload();
    setForm({ group_id: "", subject_id: "", teacher_id: "", weekly_count: 1, parallel_group_key: "" });
  };

  const gName = (id: number) => groups.flatMap((g) => [g,...(g.children??[])]).find((g) => g.id === id)?.name ?? String(id);
  const tName = (id: number) => teachers.find((t) => t.id === id)?.name ?? String(id);
  const sCode = (id: number) => subjects.find((s) => s.id === id)?.code ?? String(id);

  const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);

  return (
    <Section title="ข้อกำหนดคาบเรียน — ครูสอนวิชาอะไร ในห้องใด">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
        <strong>วิธีกำหนดการสอน:</strong> เลือกห้องเรียน → วิชา → ครูผู้สอน → จำนวนคาบ/สัปดาห์
        <br/>ถ้าวิชาเดียวกันสอนหลายห้องพร้อมกัน (คู่ขนาน) ให้กรอก <strong>Parallel Key</strong> เดียวกัน เช่น "PE-M1-001"
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="ห้องเรียน *">
          <select className={inputCls} value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
            <option value="">เลือกห้อง</option>
            {flat.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="วิชา *">
          <select className={inputCls} value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
            <option value="">เลือกวิชา</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
          </select>
        </Field>
        <Field label="ครูผู้สอน *">
          <select className={inputCls} value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
            <option value="">เลือกครู</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="คาบ/สัปดาห์">
          <input type="number" min={1} max={10} className={inputCls} value={form.weekly_count}
            onChange={(e) => setForm({ ...form, weekly_count: Number(e.target.value) })} />
        </Field>
        <Field label="Parallel Key (ถ้าสอนคู่ขนาน)">
          <input className={inputCls} value={form.parallel_group_key}
            onChange={(e) => setForm({ ...form, parallel_group_key: e.target.value })}
            placeholder="เช่น PE-M1-001" />
        </Field>
      </div>
      <button
        onClick={handleCreate}
        disabled={!form.group_id || !form.subject_id || !form.teacher_id}
        className={btnPrimary}
      >
        + เพิ่มข้อกำหนด
      </button>

      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ห้องเรียน","วิชา","ครูผู้สอน","คาบ/สัปดาห์","Parallel Key",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {requirements.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อกำหนด</td></tr>
            )}
            {requirements.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-blue-700">{gName(r.group_id)}</td>
                <td className="px-3 py-2">{sCode(r.subject_id)}</td>
                <td className="px-3 py-2 text-gray-600">{tName(r.teacher_id)}</td>
                <td className="px-3 py-2 text-center">{r.weekly_count}</td>
                <td className="px-3 py-2">
                  {r.parallel_group_key ? (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-mono">
                      {r.parallel_group_key}
                    </span>
                  ) : "–"}
                </td>
                <td className="px-3 py-2">
                  <button onClick={async () => { await api.deleteRequirement(r.id); await reload(); }} className={btnDanger}>ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// ─── Periods Management ───────────────────────────────────────────────────────
const PERIOD_TYPES: { v: PeriodType; label: string }[] = [
  { v: "class",    label: "คาบเรียน (class)"      },
  { v: "break",    label: "พัก (break)"            },
  { v: "lunch",    label: "กินข้าว (lunch)"        },
  { v: "assembly", label: "เคารพธง (assembly)"     },
  { v: "homeroom", label: "โฮมรูม (homeroom)"      },
];

const PeriodsPanel: React.FC = () => {
  const { periods } = useTimetableStore();
  const reload = useReload();
  const [form, setForm] = useState({
    period_num: 0,
    label: "",
    start_time: "08:00",
    end_time: "08:50",
    type: "class" as PeriodType,
    applies_to: "all" as "all"|"lower"|"upper",
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

  const handleCreate = async () => {
    await api.createPeriod(form);
    await reload();
    setForm({ period_num: form.period_num + 1, label: "", start_time: form.end_time, end_time: "09:00", type: "class", applies_to: "all" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    await api.updatePeriod(id, editForm);
    await reload();
    setEditing(null);
    setEditForm(null);
  };

  const sortedPeriods = [...periods].sort((a, b) => a.period_num - b.period_num || a.id - b.id);

  return (
    <Section title="จัดการคาบเรียนและเวลา (Periods)">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
        <strong>คำอธิบาย:</strong> กำหนดเวลาเริ่ม-สิ้นสุดของแต่ละคาบ และประเภทคาบ (เรียน/พัก/กินข้าว)
        <br/>คาบที่เป็น <strong>break/lunch/assembly/homeroom</strong> จะแสดงเป็น "คาบว่าง" และ Solver จะไม่จัดวิชาทับ
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
        <p className="text-xs font-semibold text-gray-600 mb-3">➕ เพิ่มคาบใหม่</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <Field label="เลขคาบ (period_num)">
            <input type="number" min={0} className={inputCls} value={form.period_num}
              onChange={(e) => setForm({ ...form, period_num: Number(e.target.value) })} />
          </Field>
          <Field label="ชื่อคาบ *">
            <input className={inputCls} value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="คาบ 1" />
          </Field>
          <Field label="ประเภท">
            <select className={inputCls} value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as PeriodType })}>
              {PERIOD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="เวลาเริ่ม">
            <input type="time" className={inputCls} value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          </Field>
          <Field label="เวลาสิ้นสุด">
            <input type="time" className={inputCls} value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </Field>
          <Field label="ใช้กับ">
            <select className={inputCls} value={form.applies_to}
              onChange={(e) => setForm({ ...form, applies_to: e.target.value as "all"|"lower"|"upper" })}>
              <option value="all">ทุกระดับ (all)</option>
              <option value="lower">ม.1-3 (lower)</option>
              <option value="upper">ม.4-6 (upper)</option>
            </select>
          </Field>
        </div>
        <button onClick={handleCreate} disabled={!form.label} className={btnPrimary}>+ เพิ่มคาบ</button>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["คาบ#","ชื่อ","ประเภท","เริ่ม","สิ้นสุด","ใช้กับ",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedPeriods.map((p) => (
              <tr key={p.id} className={clsx("hover:bg-gray-50", p.type !== "class" && "bg-orange-50/30")}>
                {editing === p.id && editForm ? (
                  <>
                    <td className="px-2 py-1">
                      <input type="number" className="w-14 border rounded px-1 py-0.5 text-xs" value={editForm.period_num}
                        onChange={(e) => setEditForm({ ...editForm, period_num: Number(e.target.value) })} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-32 border rounded px-1 py-0.5 text-xs" value={editForm.label}
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <select className="border rounded px-1 py-0.5 text-xs" value={editForm.type}
                        onChange={(e) => setEditForm({ ...editForm, type: e.target.value as PeriodType })}>
                        {PERIOD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.v}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input type="time" className="border rounded px-1 py-0.5 text-xs" value={editForm.start_time}
                        onChange={(e) => setEditForm({ ...editForm, start_time: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <input type="time" className="border rounded px-1 py-0.5 text-xs" value={editForm.end_time}
                        onChange={(e) => setEditForm({ ...editForm, end_time: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <select className="border rounded px-1 py-0.5 text-xs" value={editForm.applies_to}
                        onChange={(e) => setEditForm({ ...editForm, applies_to: e.target.value as "all"|"lower"|"upper" })}>
                        <option value="all">all</option>
                        <option value="lower">lower</option>
                        <option value="upper">upper</option>
                      </select>
                    </td>
                    <td className="px-2 py-1 flex gap-1">
                      <button onClick={() => handleUpdate(p.id)} className={btnSave}>บันทึก</button>
                      <button onClick={() => { setEditing(null); setEditForm(null); }} className={btnCancel}>ยกเลิก</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{p.period_num}</td>
                    <td className="px-3 py-2 font-medium">{p.label}</td>
                    <td className="px-3 py-2">
                      <span className={clsx(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        p.type === "class"    ? "bg-blue-100 text-blue-700"
                        : p.type === "break"  ? "bg-gray-100 text-gray-600"
                        : p.type === "lunch"  ? "bg-orange-100 text-orange-700"
                        : "bg-purple-100 text-purple-700",
                      )}>{p.type}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{p.start_time}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.end_time}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{p.applies_to}</td>
                    <td className="px-3 py-2 flex gap-1">
                      <button onClick={() => { setEditing(p.id); setEditForm({ period_num: p.period_num, label: p.label, start_time: p.start_time, end_time: p.end_time, type: p.type, applies_to: p.applies_to }); }}
                        className={btnEdit}>แก้ไข</button>
                      <button onClick={async () => { await api.deletePeriod(p.id); await reload(); }} className={btnDanger}>ลบ</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// ─── Bulk Lock Panel ──────────────────────────────────────────────────────────
const BulkLockPanel: React.FC = () => {
  const { slots, subjects, periods, groups, loadSlots } = useTimetableStore();
  const [filter, setFilter] = useState({
    group_level: "",
    day: "",
    period: "",
    subject_id: "",
  });
  const [isLocking,  setIsLocking]  = useState(false);
  const [lastResult, setLastResult] = useState<{ action: string; affected: number } | null>(null);

  const classPeriodsUniq = [...new Map(periods.filter((p) => p.type === "class").map((p) => [p.period_num, p])).values()]
    .sort((a, b) => a.period_num - b.period_num);

  const matched = slots.filter((s) => {
    if (filter.group_level) {
      const grp = groups.flatMap((g) => [g,...(g.children??[])]).find((g) => g.id === s.group_id);
      if (!grp || grp.level !== filter.group_level) return false;
    }
    if (filter.day !== "" && s.day !== Number(filter.day)) return false;
    if (filter.period !== "" && s.period !== Number(filter.period)) return false;
    if (filter.subject_id !== "" && s.subject_id !== Number(filter.subject_id)) return false;
    return true;
  });

  const locked   = matched.filter((s) => s.is_locked).length;
  const unlocked = matched.filter((s) => !s.is_locked).length;

  const handle = async (lockValue: boolean) => {
    setIsLocking(true);
    setLastResult(null);
    try {
      const res = await api.bulkLockSlots({
        is_locked: lockValue,
        filters: {
          ...(filter.group_level  ? { group_level: filter.group_level }        : {}),
          ...(filter.day    !== "" ? { day:    Number(filter.day)   }           : {}),
          ...(filter.period !== "" ? { period: Number(filter.period) }          : {}),
          ...(filter.subject_id !== "" ? { subject_id: Number(filter.subject_id) } : {}),
        },
      });
      setLastResult({ action: lockValue ? "ล็อก" : "ปลดล็อก", affected: res.affected });
      await loadSlots();
    } finally {
      setIsLocking(false);
    }
  };

  return (
    <Section title="ล็อคคาบเรียนแบบกลุ่ม (Bulk Lock / Unlock)">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
        <strong>วิธีใช้:</strong> เลือกเงื่อนไขที่ต้องการ แล้วกด "ล็อก" หรือ "ปลดล็อก"
        <br/>คาบที่ล็อกจะไม่ถูก Solver เปลี่ยนแปลง — เหมาะสำหรับวิชาที่กำหนดเวลาตายตัว เช่น คุณธรรม หรือ กิจกรรมชาติ
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Field label="ระดับชั้น">
          <select className={inputCls} value={filter.group_level}
            onChange={(e) => setFilter({ ...filter, group_level: e.target.value })}>
            <option value="">ทุกระดับ</option>
            {["M1","M2","M3","M4","M5","M6"].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="วัน">
          <select className={inputCls} value={filter.day}
            onChange={(e) => setFilter({ ...filter, day: e.target.value })}>
            <option value="">ทุกวัน</option>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="คาบ">
          <select className={inputCls} value={filter.period}
            onChange={(e) => setFilter({ ...filter, period: e.target.value })}>
            <option value="">ทุกคาบ</option>
            {classPeriodsUniq.map((p) => <option key={p.period_num} value={p.period_num}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="วิชา">
          <select className={inputCls} value={filter.subject_id}
            onChange={(e) => setFilter({ ...filter, subject_id: e.target.value })}>
            <option value="">ทุกวิชา</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-700">พบคาบที่ตรงเงื่อนไข: <span className="text-blue-600">{matched.length} คาบ</span></p>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>🔒 ล็อกแล้ว: <strong className="text-amber-600">{locked}</strong></span>
            <span>🔓 ยังไม่ล็อก: <strong className="text-green-600">{unlocked}</strong></span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handle(true)}
            disabled={isLocking || matched.length === 0}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all",
              matched.length > 0 ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-gray-200 text-gray-400 cursor-not-allowed",
            )}
          >
            {isLocking ? "⏳" : "🔒"} ล็อก {unlocked > 0 ? `(${unlocked})` : ""}
          </button>
          <button
            onClick={() => handle(false)}
            disabled={isLocking || matched.length === 0}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all border",
              matched.length > 0 ? "bg-white hover:bg-gray-50 text-gray-700 border-gray-300" : "bg-gray-100 text-gray-400 cursor-not-allowed",
            )}
          >
            🔓 ปลดล็อก {locked > 0 ? `(${locked})` : ""}
          </button>
        </div>
      </div>

      {lastResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
          <span>✅</span>
          <span>{lastResult.action}สำเร็จ: {lastResult.affected} คาบ</span>
        </div>
      )}

      {matched.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">ตัวอย่างคาบที่ตรงเงื่อนไข (10 แรก)</p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {["ห้อง","วิชา","ครู","วัน","คาบ","สถานะ"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 border-b">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {matched.slice(0, 10).map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium text-blue-700">{s.group_name}</td>
                    <td className="px-3 py-1.5">{s.subject_code}</td>
                    <td className="px-3 py-1.5 text-gray-500">{s.teacher_name}</td>
                    <td className="px-3 py-1.5">{DAYS[s.day]}</td>
                    <td className="px-3 py-1.5">{s.period}</td>
                    <td className="px-3 py-1.5">
                      <span className={clsx(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold",
                        s.is_locked ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500",
                      )}>
                        {s.is_locked ? "🔒 ล็อก" : "🔓 ปลด"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
};
