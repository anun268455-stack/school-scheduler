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
  | "requirements" | "periods" | "locks" | "settings"
  | "departments" | "analytics" | "help";

export const Dashboard: React.FC<{ page: DashPage }> = ({ page }) => {
  const pageMap: Record<DashPage, React.ReactNode> = {
    groups:       <GroupsPanel />,
    teachers:     <TeachersPanel />,
    subjects:     <SubjectsPanel />,
    rooms:        <RoomsPanel />,
    requirements: <RequirementsPanel />,
    periods:      <PeriodsPanel />,
    locks:        <BulkLockPanel />,
    settings:     <SettingsPanel />,
    departments:  <DepartmentsPanel />,
    analytics:    <AnalyticsPanel />,
    help:         <HelpPanel />,
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

// ── Thai label helpers ────────────────────────────────────────────────────────
const SUBJECT_TYPE_TH: Record<string, string> = { common: "ทั่วไป", parallel: "คู่ขนาน" };
const SUBJECT_WEIGHT_TH: Record<string, string> = { heavy: "หนัก", light: "เบา" };
const ROOM_TYPE_TH: Record<string, string> = { physical: "ห้องเรียนทั่วไป", special: "ห้องพิเศษ", outdoor: "กลางแจ้ง", floating: "ห้องเวียน" };
const PERIOD_TYPE_TH: Record<string, string> = { class: "คาบเรียน", break: "พัก", lunch: "กินข้าว", assembly: "เคารพธง", homeroom: "โฮมรูม" };
const APPLIES_TO_TH: Record<string, string> = { all: "ทุกระดับ", lower: "ม.1-3", upper: "ม.4-6" };

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
const GROUP_LEVELS = ["M1","M2","M3","M4","M5","M6","ห้องเวียน"];

const GroupsPanel: React.FC = () => {
  const { groups, rooms } = useTimetableStore();
  const [form, setForm] = useState({ name: "", level: "M1", size: 40, parent_id: "", homeroom_room_id: "" });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

  const handleCreate = async () => {
    const created = await api.createGroup({
      name: form.name, level: form.level || null,
      size: form.size,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      homeroom_room_id: form.homeroom_room_id ? Number(form.homeroom_room_id) : null,
    });
    useTimetableStore.setState((s) => ({ groups: [...s.groups, { ...created, children: created.children ?? [] }] }));
    setForm({ name: "", level: "M1", size: 40, parent_id: "", homeroom_room_id: "" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateGroup(id, {
      name: editForm.name, level: editForm.level || null,
      size: editForm.size,
      parent_id: editForm.parent_id ? Number(editForm.parent_id) : null,
      homeroom_room_id: editForm.homeroom_room_id ? Number(editForm.homeroom_room_id) : null,
    });
    useTimetableStore.setState((s) => ({ groups: s.groups.map((g) => g.id === id ? { ...g, ...updated } : g) }));
    setEditing(null); setEditForm(null);
  };

  const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);
  const roomName = (id: number | null | undefined) => id ? (rooms.find((r) => r.id === id)?.name ?? "–") : "–";

  return (
    <Section title="ห้องเรียน" action={<ImportButton entity="groups" />}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="ชื่อห้อง *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ม.1/1" />
        </Field>
        <Field label="ระดับ">
          <select className={inputCls} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
            {GROUP_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
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
        <Field label="ห้องประจำชั้น (ห้องสอน)">
          <select className={inputCls} value={form.homeroom_room_id} onChange={(e) => setForm({ ...form, homeroom_room_id: e.target.value })}>
            <option value="">– ไม่ระบุ –</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({ROOM_TYPE_TH[r.type] ?? r.type})</option>)}
          </select>
        </Field>
      </div>
      <button onClick={handleCreate} disabled={!form.name} className={btnPrimary}>+ เพิ่มห้องเรียน</button>

      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ชื่อห้อง","ระดับ","จำนวน","ห้องแม่","ห้องประจำชั้น",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {flat.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {flat.map((g) => (
              <tr key={g.id} className={clsx("hover:bg-gray-50", g.level === "ห้องเวียน" && "bg-purple-50/40")}>
                {editing === g.id && editForm ? (
                  <>
                    <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.level} onChange={(e) => setEditForm({ ...editForm, level: e.target.value })}>
                        {GROUP_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
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
                      <select className={inlineCls} value={editForm.homeroom_room_id} onChange={(e) => setEditForm({ ...editForm, homeroom_room_id: e.target.value })}>
                        <option value="">– ไม่ระบุ –</option>
                        {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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
                    <td className="px-3 py-2">
                      {g.level === "ห้องเวียน"
                        ? <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">ห้องเวียน</span>
                        : <span className="text-gray-600">{g.level ?? "–"}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{g.size}</td>
                    <td className="px-3 py-2 text-gray-500">{g.parent_id ? flat.find((p) => p.id === g.parent_id)?.name ?? "–" : "–"}</td>
                    <td className="px-3 py-2 text-gray-500">{roomName(g.homeroom_room_id)}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(g.id); setEditForm({ name: g.name, level: g.level ?? "M1", size: g.size, parent_id: g.parent_id ? String(g.parent_id) : "", homeroom_room_id: g.homeroom_room_id ? String(g.homeroom_room_id) : "" }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteGroup(g.id); useTimetableStore.setState((s) => ({ groups: s.groups.filter((x) => x.id !== g.id) })); }} className={btnDanger}>ลบ</button>
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

// ─── Advanced Settings shared UI ─────────────────────────────────────────────
const DAYS_TH = ["จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์"];

// ─── Teachers ────────────────────────────────────────────────────────────────
const TeachersPanel: React.FC = () => {
  const { teachers, departments } = useTimetableStore();
  const [form, setForm] = useState({ name: "", department_id: "", outdoor_score: 5, max_slots_per_day: 6, max_outdoor_per_week: 2 });
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);
  const [advOpen, setAdvOpen] = useState<number | null>(null);  // id of teacher with open adv settings
  const [advForm, setAdvForm] = useState<{ ignore_consecutive_limit: boolean; require_ground_floor: boolean; days_off: number[]; note: string }>({
    ignore_consecutive_limit: false, require_ground_floor: false, days_off: [], note: "",
  });

  const handleCreate = async () => {
    const created = await api.createTeacher({ ...form, fixed_room_id: null, department_id: form.department_id ? Number(form.department_id) : null });
    useTimetableStore.setState((s) => ({ teachers: [...s.teachers, created] }));
    setForm({ name: "", department_id: "", outdoor_score: 5, max_slots_per_day: 6, max_outdoor_per_week: 2 });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateTeacher(id, { ...editForm, department_id: editForm.department_id ? Number(editForm.department_id) : null });
    useTimetableStore.setState((s) => ({ teachers: s.teachers.map((t) => t.id === id ? { ...t, ...updated } : t) }));
    setEditing(null); setEditForm(null);
  };

  const handleSaveAdv = async (id: number) => {
    const updated = await api.updateTeacher(id, { advanced_settings: advForm });
    useTimetableStore.setState((s) => ({ teachers: s.teachers.map((t) => t.id === id ? { ...t, ...updated } : t) }));
    setAdvOpen(null);
  };

  const deptName = (id: number | null | undefined) => id ? (departments.find((d) => d.id === id)?.name ?? "–") : "–";

  return (
    <Section title="ครูผู้สอน" action={<ImportButton entity="teachers" />}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="ชื่อครู *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ครูสมชาย ใจดี" />
        </Field>
        <Field label="กลุ่มสาระฯ">
          <select className={inputCls} value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">– ไม่ระบุ –</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
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
              {["ชื่อครู","กลุ่มสาระฯ","กลางแจ้ง","สอน/วัน",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {teachers.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {teachers.map((t) => (
              <React.Fragment key={t.id}>
                <tr className="hover:bg-gray-50">
                  {editing === t.id && editForm ? (
                    <>
                      <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                      <td className="px-2 py-1">
                        <select className={inlineCls} value={editForm.department_id} onChange={(e) => setEditForm({ ...editForm, department_id: e.target.value })}>
                          <option value="">–</option>
                          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1"><input type="number" min={0} max={10} className={inlineCls} style={{ width: 55 }} value={editForm.outdoor_score} onChange={(e) => setEditForm({ ...editForm, outdoor_score: Number(e.target.value) })} /></td>
                      <td className="px-2 py-1"><input type="number" min={1} max={10} className={inlineCls} style={{ width: 55 }} value={editForm.max_slots_per_day} onChange={(e) => setEditForm({ ...editForm, max_slots_per_day: Number(e.target.value) })} /></td>
                      <td className="px-2 py-1">
                        <div className="flex gap-1">
                          <button onClick={() => handleUpdate(t.id)} className={btnSave}>บันทึก</button>
                          <button onClick={() => { setEditing(null); setEditForm(null); }} className={btnCancel}>ยกเลิก</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-medium text-gray-800">
                        {t.name}
                        {t.advanced_settings?.require_ground_floor && <span className="ml-1 text-xs bg-blue-100 text-blue-600 px-1 rounded">ชั้น 1</span>}
                        {(t.advanced_settings?.days_off ?? []).length > 0 && <span className="ml-1 text-xs bg-orange-100 text-orange-600 px-1 rounded">วันหยุด</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs truncate max-w-[140px]">{deptName(t.department_id)}</td>
                      <td className="px-3 py-2 text-gray-600">{t.outdoor_score}</td>
                      <td className="px-3 py-2 text-gray-600">{t.max_slots_per_day}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={() => { setEditing(t.id); setEditForm({ name: t.name, department_id: t.department_id ? String(t.department_id) : "", outdoor_score: t.outdoor_score, max_slots_per_day: t.max_slots_per_day, max_outdoor_per_week: t.max_outdoor_per_week }); }} className={btnEdit}>แก้ไข</button>
                          <button onClick={() => { setAdvOpen(advOpen === t.id ? null : t.id); setAdvForm({ ignore_consecutive_limit: t.advanced_settings?.ignore_consecutive_limit ?? false, require_ground_floor: t.advanced_settings?.require_ground_floor ?? false, days_off: t.advanced_settings?.days_off ?? [], note: t.advanced_settings?.note ?? "" }); }} className="px-2 py-1 text-xs bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 border border-indigo-200">⚙ ขั้นสูง</button>
                          <button onClick={async () => { await api.deleteTeacher(t.id); useTimetableStore.setState((s) => ({ teachers: s.teachers.filter((x) => x.id !== t.id) })); }} className={btnDanger}>ลบ</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
                {/* Advanced settings row */}
                {advOpen === t.id && (
                  <tr>
                    <td colSpan={5} className="bg-indigo-50/60 border-b border-indigo-100 px-4 py-3">
                      <p className="text-xs font-bold text-indigo-700 mb-2">⚙ ตั้งค่าขั้นสูง — {t.name}</p>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={advForm.ignore_consecutive_limit} onChange={(e) => setAdvForm({ ...advForm, ignore_consecutive_limit: e.target.checked })} className="w-3.5 h-3.5" />
                          <span>ไม่จำกัดคาบต่อเนื่อง (ignore_consecutive_limit)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={advForm.require_ground_floor} onChange={(e) => setAdvForm({ ...advForm, require_ground_floor: e.target.checked })} className="w-3.5 h-3.5" />
                          <span>ต้องสอนชั้น 1 เท่านั้น (เหตุสุขภาพ)</span>
                        </label>
                        <div>
                          <p className="font-semibold text-gray-600 mb-1">วันที่ไม่สอน (days_off)</p>
                          <div className="flex gap-2 flex-wrap">
                            {DAYS_TH.map((d, i) => (
                              <label key={i} className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={advForm.days_off.includes(i)} onChange={(e) => setAdvForm({ ...advForm, days_off: e.target.checked ? [...advForm.days_off, i] : advForm.days_off.filter((x) => x !== i) })} className="w-3 h-3" />
                                <span>{d}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-600 mb-1">หมายเหตุ</p>
                          <input className={inlineCls + " w-full"} value={advForm.note} onChange={(e) => setAdvForm({ ...advForm, note: e.target.value })} placeholder="เช่น ลาป่วยวันอังคาร" />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleSaveAdv(t.id)} className={btnSave}>บันทึก</button>
                        <button onClick={() => setAdvOpen(null)} className={btnCancel}>ยกเลิก</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// ─── Subjects ────────────────────────────────────────────────────────────────
const SubjectsPanel: React.FC = () => {
  const { subjects, departments } = useTimetableStore();
  const [form, setForm] = useState({ code: "", name: "", type: "common", duration: 1, weight: "light", department_id: "", is_activity: false });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

  const handleCreate = async () => {
    const created = await api.createSubject({
      ...form,
      type:          form.type   as SubjectType,
      weight:        form.weight as SubjectWeight,
      duration:      Number(form.duration) as 1 | 2,
      department_id: form.department_id ? Number(form.department_id) : null,
    });
    useTimetableStore.setState((s) => ({ subjects: [...s.subjects, created] }));
    setForm({ code: "", name: "", type: "common", duration: 1, weight: "light", department_id: "", is_activity: false });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateSubject(id, {
      code: editForm.code, name: editForm.name,
      type: editForm.type as SubjectType,
      weight: editForm.weight as SubjectWeight,
      duration: Number(editForm.duration) as 1 | 2,
      department_id: editForm.department_id ? Number(editForm.department_id) : null,
      is_activity: editForm.is_activity,
    });
    useTimetableStore.setState((s) => ({ subjects: s.subjects.map((x) => x.id === id ? { ...x, ...updated } : x) }));
    setEditing(null); setEditForm(null);
  };

  const deptName = (id: number | null | undefined) => id ? (departments.find((d) => d.id === id)?.name?.replace("กลุ่มสาระ","") ?? String(id)) : "–";

  return (
    <Section title="วิชาเรียน" action={<ImportButton entity="subjects" />}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="รหัสวิชา *">
          <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MATH101" />
        </Field>
        <Field label="ชื่อวิชา *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="คณิตศาสตร์" />
        </Field>
        <Field label="กลุ่มสาระฯ">
          <select className={inputCls} value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">– ไม่ระบุ –</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="ประเภท">
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="common">ทั่วไป</option>
            <option value="parallel">คู่ขนาน</option>
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
            <option value="light">เบา</option>
            <option value="heavy">หนัก</option>
          </select>
        </Field>
        <Field label="วิชากิจกรรม">
          <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
            <input type="checkbox" checked={form.is_activity} onChange={(e) => setForm({ ...form, is_activity: e.target.checked })} className="w-4 h-4" />
            <span className="text-sm text-gray-600">เป็นชุมนุม/ลูกเสือ/กิจกรรม</span>
          </label>
        </Field>
      </div>
      <button onClick={handleCreate} disabled={!form.code || !form.name} className={btnPrimary}>+ เพิ่มวิชา</button>

      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["รหัส","ชื่อวิชา","กลุ่มสาระฯ","ประเภท","คาบ","น้ำหนัก",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {subjects.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {subjects.map((s) => (
              <tr key={s.id} className={clsx("hover:bg-gray-50", s.is_activity && "bg-purple-50/30")}>
                {editing === s.id && editForm ? (
                  <>
                    <td className="px-2 py-1"><input className={inlineCls} style={{ width: 80 }} value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.department_id} onChange={(e) => setEditForm({ ...editForm, department_id: e.target.value })}>
                        <option value="">–</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name.replace("กลุ่มสาระ","")}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                        <option value="common">ทั่วไป</option>
                        <option value="parallel">คู่ขนาน</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} style={{ width: 50 }} value={editForm.duration} onChange={(e) => setEditForm({ ...editForm, duration: Number(e.target.value) })}>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <label className="flex items-center gap-1"><input type="checkbox" checked={editForm.is_activity} onChange={(e) => setEditForm({ ...editForm, is_activity: e.target.checked })} /> กิจกรรม</label>
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
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {s.name}
                      {s.is_activity && <span className="ml-1 px-1 py-0.5 bg-purple-100 text-purple-600 rounded text-[10px]">กิจกรรม</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{deptName(s.department_id)}</td>
                    <td className="px-3 py-2 text-gray-600">{SUBJECT_TYPE_TH[s.type] ?? s.type}</td>
                    <td className="px-3 py-2 text-gray-600">{s.duration}</td>
                    <td className="px-3 py-2 text-gray-600">{SUBJECT_WEIGHT_TH[s.weight ?? ""] ?? s.weight}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(s.id); setEditForm({ code: s.code, name: s.name, type: s.type, duration: s.duration, weight: s.weight, department_id: s.department_id ? String(s.department_id) : "", is_activity: s.is_activity ?? false }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteSubject(s.id); useTimetableStore.setState((st) => ({ subjects: st.subjects.filter((x) => x.id !== s.id) })); }} className={btnDanger}>ลบ</button>
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
  const [form, setForm]     = useState({ name: "", type: "physical", building_id: "", floor: 1, capacity: 40 });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

  const handleCreate = async () => {
    const created = await api.createRoom({
      ...form,
      type:        form.type as RoomType,
      building_id: form.building_id ? Number(form.building_id) : null,
      floor:       Number(form.floor),
      capacity:    Number(form.capacity),
      specialized_dept_id: null,
      reserved_teacher_id: null,
    });
    useTimetableStore.setState((s) => ({ rooms: [...s.rooms, created] }));
    setForm({ name: "", type: "physical", building_id: "", floor: 1, capacity: 40 });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateRoom(id, {
      name: editForm.name,
      type: editForm.type as RoomType,
      building_id: editForm.building_id ? Number(editForm.building_id) : null,
      floor: Number(editForm.floor),
      capacity: Number(editForm.capacity),
    });
    useTimetableStore.setState((s) => ({ rooms: s.rooms.map((r) => r.id === id ? { ...r, ...updated } : r) }));
    setEditing(null); setEditForm(null);
  };

  return (
    <Section title="ห้องสอน" action={<ImportButton entity="rooms" />}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="ชื่อห้อง *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ห้อง 101" />
        </Field>
        <Field label="ประเภท">
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="physical">ห้องเรียนทั่วไป</option>
            <option value="special">ห้องพิเศษ</option>
            <option value="outdoor">กลางแจ้ง</option>
            <option value="floating">ห้องเวียน (ไม่ติดห้องเดิม)</option>
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
                        <option value="floating">ห้องเวียน</option>
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
                    <td className="px-3 py-2 text-gray-600">{ROOM_TYPE_TH[r.type] ?? r.type}</td>
                    <td className="px-3 py-2 text-gray-500">{r.building_name ?? "–"}</td>
                    <td className="px-3 py-2 text-gray-600">{r.floor}</td>
                    <td className="px-3 py-2 text-gray-600">{r.capacity}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(r.id); setEditForm({ name: r.name, type: r.type, building_id: r.building_id ? String(r.building_id) : "", floor: r.floor, capacity: r.capacity }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteRoom(r.id); useTimetableStore.setState((s) => ({ rooms: s.rooms.filter((x) => x.id !== r.id) })); }} className={btnDanger}>ลบ</button>
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
  const [form, setForm] = useState({
    group_id: "", subject_id: "", teacher_id: "", weekly_count: 1, parallel_group_key: "",
  });

  const handleCreate = async () => {
    const created = await api.createRequirement({
      group_id:   Number(form.group_id),
      subject_id: Number(form.subject_id),
      teacher_id: Number(form.teacher_id),
      weekly_count: Number(form.weekly_count),
      parallel_group_key: form.parallel_group_key || null,
    });
    useTimetableStore.setState((s) => ({ requirements: [...s.requirements, created] }));
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
        <br/>ถ้าวิชาเดียวกันสอนหลายห้องพร้อมกัน (คู่ขนาน) ให้กรอก <strong>รหัสคู่ขนาน</strong> เดียวกัน เช่น "PE-M1-001"
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
        <Field label="รหัสคู่ขนาน (สำหรับวิชาที่สอนพร้อมกัน)">
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
              {["ห้องเรียน","วิชา","ครูผู้สอน","คาบ/สัปดาห์","รหัสคู่ขนาน",""].map((h) => (
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
                  <button onClick={async () => { await api.deleteRequirement(r.id); useTimetableStore.setState((s) => ({ requirements: s.requirements.filter((x) => x.id !== r.id) })); }} className={btnDanger}>ลบ</button>
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
  { v: "class",    label: "คาบเรียน"    },
  { v: "break",    label: "พัก"         },
  { v: "lunch",    label: "กินข้าว"    },
  { v: "assembly", label: "เคารพธง"    },
  { v: "homeroom", label: "โฮมรูม"     },
];

const PeriodsPanel: React.FC = () => {
  const { periods } = useTimetableStore();
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
    const created = await api.createPeriod(form);
    useTimetableStore.setState((s) => ({ periods: [...s.periods, created] }));
    setForm({ period_num: form.period_num + 1, label: "", start_time: form.end_time, end_time: "09:00", type: "class", applies_to: "all" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updatePeriod(id, editForm);
    useTimetableStore.setState((s) => ({ periods: s.periods.map((p) => p.id === id ? { ...p, ...updated } : p) }));
    setEditing(null);
    setEditForm(null);
  };

  const sortedPeriods = [...periods].sort((a, b) => a.period_num - b.period_num || a.id - b.id);

  return (
    <Section title="จัดการคาบเรียนและเวลา">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
        <strong>คำอธิบาย:</strong> กำหนดเวลาเริ่ม-สิ้นสุดของแต่ละคาบ และประเภทคาบ (เรียน/พัก/กินข้าว)
        <br/>คาบที่เป็น <strong>พัก/กินข้าว/เคารพธง/โฮมรูม</strong> จะแสดงเป็น "คาบว่าง" และระบบจะไม่จัดวิชาทับ
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
        <p className="text-xs font-semibold text-gray-600 mb-3">➕ เพิ่มคาบใหม่</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <Field label="เลขคาบ">
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
              <option value="all">ทุกระดับ</option>
              <option value="lower">ม.1-3</option>
              <option value="upper">ม.4-6</option>
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
                        {PERIOD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
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
                        <option value="all">ทุกระดับ</option>
                        <option value="lower">ม.1-3</option>
                        <option value="upper">ม.4-6</option>
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
                      )}>{PERIOD_TYPE_TH[p.type] ?? p.type}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{p.start_time}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.end_time}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{APPLIES_TO_TH[p.applies_to] ?? p.applies_to}</td>
                    <td className="px-3 py-2 flex gap-1">
                      <button onClick={() => { setEditing(p.id); setEditForm({ period_num: p.period_num, label: p.label, start_time: p.start_time, end_time: p.end_time, type: p.type, applies_to: p.applies_to }); }}
                        className={btnEdit}>แก้ไข</button>
                      <button onClick={async () => { await api.deletePeriod(p.id); useTimetableStore.setState((s) => ({ periods: s.periods.filter((x) => x.id !== p.id) })); }} className={btnDanger}>ลบ</button>
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
    <Section title="ล็อคคาบเรียนแบบกลุ่ม">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
        <strong>วิธีใช้:</strong> เลือกเงื่อนไขที่ต้องการ แล้วกด "ล็อก" หรือ "ปลดล็อก"
        <br/>คาบที่ล็อกจะไม่ถูกระบบเปลี่ยนแปลง — เหมาะสำหรับวิชาที่กำหนดเวลาตายตัว เช่น คุณธรรม หรือ กิจกรรมชาติ
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

// ─── Departments Panel ────────────────────────────────────────────────────────
const DepartmentsPanel: React.FC = () => {
  const { departments } = useTimetableStore();
  const [form, setForm]     = useState({ name: "" });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ name: string } | null>(null);

  const handleCreate = async () => {
    const created = await api.createDepartment({ name: form.name });
    useTimetableStore.setState((s) => ({ departments: [...s.departments, created] }));
    setForm({ name: "" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateDepartment(id, editForm);
    useTimetableStore.setState((s) => ({ departments: s.departments.map((d) => d.id === id ? { ...d, ...updated } : d) }));
    setEditing(null); setEditForm(null);
  };

  return (
    <Section title="กลุ่มสาระการเรียนรู้">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
        กลุ่มสาระฯ ใช้จัดหมวดหมู่ครูและวิชา ช่วยให้ Analytics แสดงสถิติแยกตามหมวด
      </div>
      <div className="flex gap-2 mb-3">
        <Field label="ชื่อกลุ่มสาระฯ *">
          <input className={inputCls} style={{ width: 280 }} value={form.name}
            onChange={(e) => setForm({ name: e.target.value })} placeholder="กลุ่มสาระคณิตศาสตร์" />
        </Field>
      </div>
      <button onClick={handleCreate} disabled={!form.name} className={btnPrimary}>+ เพิ่มกลุ่มสาระฯ</button>

      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["#","ชื่อกลุ่มสาระฯ",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {departments.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {departments.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                {editing === d.id && editForm ? (
                  <>
                    <td className="px-3 py-2 text-gray-400 text-xs">{d.id}</td>
                    <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ name: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1">
                        <button onClick={() => handleUpdate(d.id)} className={btnSave}>บันทึก</button>
                        <button onClick={() => { setEditing(null); setEditForm(null); }} className={btnCancel}>ยกเลิก</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-gray-400 text-xs font-mono">{d.id}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{d.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(d.id); setEditForm({ name: d.name }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteDepartment(d.id); useTimetableStore.setState((s) => ({ departments: s.departments.filter((x) => x.id !== d.id) })); }} className={btnDanger}>ลบ</button>
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

// ─── Analytics / Audit Dashboard ─────────────────────────────────────────────
const AnalyticsPanel: React.FC = () => {
  const { slots, teachers, requirements, subjects, departments, groups } = useTimetableStore();

  // ── Compute stats ────────────────────────────────────────────────────────
  // Teacher slots per day
  const teacherStats = teachers.map((t) => {
    const tSlots = slots.filter((s) => s.teacher_id === t.id);
    const byDay  = Array.from({ length: 5 }, (_, d) =>
      tSlots.filter((s) => s.day === d).length
    );
    const maxDay = Math.max(...byDay, 0);
    const outdoorCount = tSlots.filter((s) => s.room_type === "outdoor").length;

    // Consecutive periods per day
    let maxConsec = 0;
    for (let d = 0; d < 5; d++) {
      const dayPeriods = tSlots.filter((s) => s.day === d).map((s) => s.period).sort((a, b) => a - b);
      let cur = 1;
      for (let i = 1; i < dayPeriods.length; i++) {
        cur = dayPeriods[i] - dayPeriods[i - 1] === 1 ? cur + 1 : 1;
        maxConsec = Math.max(maxConsec, cur);
      }
    }

    return { teacher: t, total: tSlots.length, maxDay, outdoorCount, maxConsec };
  }).sort((a, b) => b.total - a.total);

  // Requirement coverage
  const totalReq  = requirements.reduce((s, r) => s + r.weekly_count, 0);
  const filledReq = slots.length;
  const coverPct  = totalReq > 0 ? Math.round((filledReq / totalReq) * 100) : 0;

  // Subject dept distribution
  const deptSlots = departments.map((d) => {
    const dSubIds = subjects.filter((s) => s.department_id === d.id).map((s) => s.id);
    const count   = slots.filter((s) => dSubIds.includes(s.subject_id)).length;
    return { dept: d, count };
  }).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);

  // Alerts
  const fatigueTeachers    = teacherStats.filter((t) => t.maxConsec >= 4 || t.maxDay > t.teacher.max_slots_per_day);
  const outdoorOverloaded  = teacherStats.filter((t) => t.outdoorCount > t.teacher.max_outdoor_per_week);
  const groupsWithNoSlots  = groups.flatMap((g) => [g,...(g.children??[])]).filter((g) =>
    !slots.some((s) => s.group_id === g.id)
  );

  const StatCard = ({ icon, label, value, sub, color }: { icon: string; label: string; value: string | number; sub?: string; color: string }) => (
    <div className={clsx("rounded-xl border p-4 flex items-start gap-3", color)}>
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );

  return (
    <Section title="วิเคราะห์และตรวจสอบตาราง 📊">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon="📋" label="คาบทั้งหมดในตาราง" value={slots.length} sub={`จากทั้งหมด ${totalReq} คาบ/สัปดาห์`} color="bg-white border-gray-200" />
        <StatCard icon="✅" label="ความครอบคลุม" value={`${coverPct}%`} sub={filledReq < totalReq ? `ยังขาด ${totalReq - filledReq} คาบ` : "ครบถ้วน"} color={coverPct >= 90 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"} />
        <StatCard icon="⚠️" label="ครูที่ล้า (>3 ต่อเนื่อง)" value={fatigueTeachers.length} sub="ควรปรับตาราง" color={fatigueTeachers.length > 0 ? "bg-red-50 border-red-200" : "bg-white border-gray-200"} />
        <StatCard icon="🌿" label="ห้องที่ยังไม่มีตาราง" value={groupsWithNoSlots.length} sub={groupsWithNoSlots.map((g) => g.name).join(", ") || "ครบทุกห้อง"} color={groupsWithNoSlots.length > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Teacher load table */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-bold text-gray-700">ภาระงานครู</h3>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50/50">
              <tr>
                {["ครู","รวม","สูงสุด/วัน","ต่อเนื่อง","กลางแจ้ง"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {teacherStats.map(({ teacher: t, total, maxDay, maxConsec, outdoorCount }) => (
                <tr key={t.id} className={clsx("hover:bg-gray-50", (maxConsec >= 4 || maxDay > t.max_slots_per_day) && "bg-red-50/60")}>
                  <td className="px-3 py-2 font-medium text-gray-800 truncate max-w-[100px]">{t.name}</td>
                  <td className="px-3 py-2">{total}</td>
                  <td className="px-3 py-2">
                    <span className={clsx("font-mono", maxDay > t.max_slots_per_day && "text-red-600 font-bold")}>{maxDay}</span>
                    <span className="text-gray-400">/{t.max_slots_per_day}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={clsx("font-mono", maxConsec >= 4 && "text-red-600 font-bold")}>{maxConsec}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={clsx("font-mono", outdoorCount > t.max_outdoor_per_week && "text-amber-600 font-bold")}>{outdoorCount}</span>
                    <span className="text-gray-400">/{t.max_outdoor_per_week}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Alerts + Dept distribution */}
        <div className="space-y-4">
          {/* Alerts */}
          {(fatigueTeachers.length > 0 || outdoorOverloaded.length > 0) && (
            <div className="border border-red-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                <h3 className="text-sm font-bold text-red-700">⚠️ แจ้งเตือน</h3>
              </div>
              <div className="p-3 space-y-2">
                {fatigueTeachers.map(({ teacher: t, maxConsec, maxDay }) => (
                  <div key={t.id} className="text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <strong>{t.name}</strong>
                    {maxConsec >= 4 && <span className="ml-1 text-red-600">สอนต่อเนื่อง {maxConsec} คาบ</span>}
                    {maxDay > t.max_slots_per_day && <span className="ml-1 text-red-600">เกินโควตา/วัน ({maxDay})</span>}
                  </div>
                ))}
                {outdoorOverloaded.map(({ teacher: t, outdoorCount }) => (
                  <div key={t.id} className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <strong>{t.name}</strong>
                    <span className="ml-1 text-amber-700">กลางแจ้งเกินโควตา ({outdoorCount}/{t.max_outdoor_per_week})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dept distribution */}
          {deptSlots.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-bold text-gray-700">สัดส่วนคาบแยกกลุ่มสาระฯ</h3>
              </div>
              <div className="p-3 space-y-2">
                {deptSlots.map(({ dept, count }) => {
                  const pct = slots.length > 0 ? Math.round((count / slots.length) * 100) : 0;
                  return (
                    <div key={dept.id}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="font-medium text-gray-700 truncate">{dept.name}</span>
                        <span className="text-gray-500 shrink-0 ml-2">{count} คาบ ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {slots.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-300 rounded-xl">
              ยังไม่มีตาราง — กด "สร้างตาราง" เพื่อสร้างตารางก่อน
            </div>
          )}
        </div>
      </div>
    </Section>
  );
};

// ─── School Settings Panel ────────────────────────────────────────────────────
const SettingsPanel: React.FC = () => {
  const { schoolConfig, setSchoolConfig } = useTimetableStore();
  const [saved, setSaved] = useState(false);

  const handle = (key: string, val: string) => {
    setSchoolConfig({ [key]: val });
    setSaved(false);
  };

  return (
    <Section title="ตั้งค่าโรงเรียนและภาคเรียน 🏫">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
        <strong>ข้อมูลนี้จะปรากฏบนตารางพิมพ์</strong> — กรอกให้ครบเพื่อให้หัวตารางถูกต้อง
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field label="ชื่อโรงเรียน *">
            <input
              className={inputCls}
              value={schoolConfig.schoolName}
              onChange={(e) => handle("schoolName", e.target.value)}
              placeholder="โรงเรียนราชวินิต นนทบุรี"
            />
          </Field>
          <Field label="ชื่อผู้อำนวยการโรงเรียน">
            <input
              className={inputCls}
              value={schoolConfig.directorName}
              onChange={(e) => handle("directorName", e.target.value)}
              placeholder="นายสมชาย ใจดี"
            />
          </Field>
          <Field label="ภาคเรียนที่">
            <select className={inputCls} value={schoolConfig.term} onChange={(e) => handle("term", e.target.value)}>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </Field>
          <Field label="ปีการศึกษา (พ.ศ.)">
            <input
              className={inputCls}
              value={schoolConfig.year}
              onChange={(e) => handle("year", e.target.value)}
              placeholder="2568"
            />
          </Field>
        </div>

        <button
          onClick={() => setSaved(true)}
          className={btnPrimary}
        >
          บันทึกการตั้งค่า
        </button>

        {saved && (
          <span className="ml-3 text-sm text-green-600 font-medium">✅ บันทึกแล้ว</span>
        )}
      </div>

      {/* Preview */}
      <div className="mt-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
        <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">ตัวอย่างหัวตาราง</p>
        <div className="bg-white border rounded p-3 text-center">
          <div className="text-sm font-bold">
            ตารางเรียน 001  ห้อง ม.1/1
          </div>
          <div className="text-xs text-gray-600 mt-1">
            ภาคเรียนที่ {schoolConfig.term}/{schoolConfig.year}  โรงเรียน{schoolConfig.schoolName}
          </div>
        </div>
      </div>
    </Section>
  );
};

// ─── Help / User Manual Panel ────────────────────────────────────────────────
const HELP_TOPICS = [
  { icon: "🚀", title: "ขั้นตอนเริ่มต้นใช้งาน", content: ["1. ตั้งค่าโรงเรียน (⚙ → 🏫)","2. เพิ่มกลุ่มสาระฯ (⚙ → 🏛)","3. เพิ่มห้องสอน (⚙ → 🚪)","4. เพิ่มครูผู้สอน (⚙ → 👨‍🏫)","5. เพิ่มวิชาเรียน (⚙ → 📚)","6. เพิ่มห้องเรียน (⚙ → 👥)","7. กำหนดการสอน/วิชา (⚙ → 📋)","8. สร้างตาราง (⚡)","9. ปรับแก้ด้วยการลากวาง","10. พิมพ์/PDF (🖨️/📥)"] },
  { icon: "🗓️", title: "การดูตาราง (3 มุมมอง)", content: ["👥 ห้อง — ดูตารางเรียนของห้องที่เลือก","👨‍🏫 ครู — ดูตารางสอนของครูที่เลือก","🚪 ห้องสอน — ดูการใช้ห้องแต่ละห้อง","เลือกชื่อจากเมนูรายการด้านบน"] },
  { icon: "🖱️", title: "การลากวางคาบ", content: ["🟢 เขียว = ปลอดภัย","🟡 เหลือง = ผลกระทบปานกลาง","🔴 แดง = วางไม่ได้","⚡ กรอบแจ้งเตือน = เมื่อมีความขัดแย้ง","สลับคาบ = สลับตำแหน่งกัน — แนะนำ","บังคับวาง = วางทับ คาบเดิมถูกลบ"] },
  { icon: "🔒", title: "การล็อคคาบ", content: ["กด 🔓 โหมดล็อก → คลิกคาบที่ต้องการล็อค","ระบบจะไม่เปลี่ยนคาบที่ล็อก","ล็อคทั้งหมด: 🔒 ทั้งหมด","ล็อคกลุ่ม: ⚙ → 🔒 ล็อคคาบ (กลุ่ม)"] },
  { icon: "⚡", title: "การสร้างตาราง", content: ["กด ⚡ สร้างตาราง → เริ่มคำนวณ","ล็อคคาบสำคัญก่อนรัน","ถ้า 0 คาบ: ตรวจเซิร์ฟเวอร์และการสอน/วิชา","หลังรัน ปรับด้วยลากวางได้"] },
  { icon: "⚙", title: "ตั้งค่าขั้นสูงครู", content: ["กด '⚙ ขั้นสูง' ข้างชื่อครู","ไม่จำกัดคาบต่อเนื่อง","ต้องสอนชั้น 1 (เหตุสุขภาพ)","กำหนดวันที่ไม่สอน"] },
  { icon: "📊", title: "วิเคราะห์ตาราง", content: ["⚙ → 📊 วิเคราะห์ตาราง","KPI: ครอบคลุม%, ครูล้า, ห้องขาดตาราง","ตารางภาระงานครู (สีแดง = เกิน)","แจ้งเตือนสอนต่อเนื่อง ≥4 คาบ"] },
  { icon: "❓", title: "ปัญหาที่พบบ่อย", content: ["หน้าขาว → F5 หรือกดรีเฟรชหน้า","เข้าไม่ได้ → รัน python mock_api.py","ข้อมูลหาย → เซิร์ฟเวอร์ดับ ข้อมูลอยู่ใน RAM","สร้างตารางได้ 0 คาบ → ตรวจการสอน/วิชา","ลากวางไม่ได้ → คาบถูกล็อค","หัวตารางว่าง → ตั้งค่าโรงเรียน"] },
];

const HelpPanel: React.FC = () => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section title="📖 คู่มือการใช้งานระบบ">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
        คู่มือฉบับสมบูรณ์อยู่ที่ไฟล์ <code>school-scheduler/คู่มือการใช้งาน.html</code> — เปิดในเบราว์เซอร์ได้เลย
      </div>
      <div className="space-y-2">
        {HELP_TOPICS.map((topic, i) => (
          <div key={i} className="border border-gray-200 rounded-xl overflow-hidden">
            <button onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 text-left">
              <span className="flex items-center gap-2 font-semibold text-sm text-gray-800">
                <span>{topic.icon}</span>{topic.title}
              </span>
              <span className="text-gray-400 text-xs">{open === i ? "▲" : "▼"}</span>
            </button>
            {open === i && (
              <div className="bg-gray-50 border-t border-gray-100 px-4 py-3">
                <ul className="space-y-1.5">
                  {topic.content.map((line, j) => (
                    <li key={j} className="text-sm text-gray-700 flex gap-2">
                      <span className="text-blue-400 shrink-0">•</span><span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
};
