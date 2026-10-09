/**
 * Dashboard v4 – Full CRUD with inline edit for all entities + Periods + Bulk Lock + Import
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useTimetableStore } from "../store/timetableStore";
import type { SubjectType, PeriodType, Room, Period, StudentGroup, Subject } from "../types";
import { DAYS, periodLabel } from "../types";
import * as api from "../api/client";
import { ImportModal } from "../components/import/ImportModal";
import { ElectiveOptionModal } from "../components/timetable/ElectiveOptionModal";
import { ElectivePoolPanel } from "../components/timetable/ElectivePoolPanel";
import { RoomSettingsModal } from "../components/rooms/RoomSettingsModal";
import { AddElectiveSubjectModal } from "../components/timetable/AddElectiveSubjectModal";
import { teachesSlot, slotLabel } from "../utils/teacherSlots";
import { levelKeyOf, levelLabel, classPeriodsForLevel, roomReservedFor } from "../utils/levels";
import { flattenGroups } from "../utils/groupHierarchy";
import { byTeacherCode } from "../utils/teacherOrder";
import { SavePointPanel } from "../components/backup/SavePointPanel";
import { SubjectAssignModal } from "../components/timetable/SubjectAssignModal";
import { HomeroomModal } from "../components/groups/HomeroomModal";
import { HomeroomImportModal } from "../components/groups/HomeroomImportModal";
import { DeptTeacherCodesModal } from "../components/departments/DeptTeacherCodesModal";
import { homeroomNames, classesAdvisedBy, HOMEROOM_MAX } from "../utils/homeroom";
import { TeacherAssignModal } from "../components/timetable/TeacherAssignModal";
import { TeacherSettingsModal } from "../components/teachers/TeacherSettingsModal";
import { LevelActivityPanel } from "../components/timetable/LevelActivityPanel";
import { SearchableSelect, teacherOptions, roomOptions, groupOptions } from "../components/common/SearchableSelect";
import { TableSearch, matches } from "../components/common/TableSearch";

export type DashPage =
  | "groups" | "teachers" | "subjects" | "rooms"
  | "requirements" | "electives" | "activities" | "periods" | "locks" | "settings"
  | "departments" | "analytics" | "help";

export const Dashboard: React.FC<{ page: DashPage }> = ({ page }) => {
  const pageMap: Record<DashPage, React.ReactNode> = {
    groups:       <GroupsPanel />,
    teachers:     <TeachersPanel />,
    subjects:     <SubjectsPanel />,
    rooms:        <RoomsPanel />,
    requirements: <RequirementsPanel />,
    electives:    <ElectivesPanel />,
    activities:   <LevelActivityPanel />,
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
const ROOM_TYPE_TH: Record<string, string> = { physical: "ห้องเรียนทั่วไป", special: "ห้องพิเศษ", outdoor: "กลางแจ้ง", floating: "ห้องเวียน" };

/**
 * A server timestamp as the reader's own clock shows it.
 *
 * The server runs on UTC, so a save made a minute ago printed as seven hours
 * earlier — which reads as "this stopped working last night" rather than
 * "this just worked". An older server sends no offset; that string is left
 * alone rather than guessed at.
 */
const localTime = (iso: string): string => {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const d = new Date(iso);
  if (!hasZone || Number.isNaN(d.getTime())) return iso.replace("T", " ");
  return d.toLocaleString("th-TH", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};
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


/** Write ครูประจำชั้น for one or more classes, and keep the page in step. */
async function applyHomeroom(changes: { groupId: number; teacherIds: number[] }[]) {
  await Promise.all(changes.map(async (c) => {
    await api.updateGroup(c.groupId, { homeroom_teacher_ids: c.teacherIds });
    useTimetableStore.setState((st) => ({
      groups: patchGroupTree(st.groups, c.groupId, {
        homeroom_teacher_ids: c.teacherIds,
        homeroom_teacher_id: c.teacherIds[0] ?? null,
      }),
    }));
  }));
}

const GroupsPanel: React.FC = () => {
  const { groups, rooms, teachers } = useTimetableStore();
  const [homeroomFor, setHomeroomFor] = useState<number | null>(null);
  const [importingHomeroom, setImportingHomeroom] = useState(false);
  const [form, setForm] = useState({ name: "", level: "M1", size: 40, parent_id: "", homeroom_room_id: "", homeroom_teacher_id: "" });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

  const handleCreate = async () => {
    const created = await api.createGroup({
      name: form.name, level: form.level || null,
      size: form.size,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      homeroom_room_id: form.homeroom_room_id ? Number(form.homeroom_room_id) : null,
      homeroom_teacher_id: form.homeroom_teacher_id ? Number(form.homeroom_teacher_id) : null,
    });
    useTimetableStore.setState((s) => ({ groups: [...s.groups, { ...created, children: created.children ?? [] }] }));
    setForm({ name: "", level: "M1", size: 40, parent_id: "", homeroom_room_id: "", homeroom_teacher_id: "" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateGroup(id, {
      name: editForm.name, level: editForm.level || null,
      size: editForm.size,
      parent_id: editForm.parent_id ? Number(editForm.parent_id) : null,
      homeroom_room_id: editForm.homeroom_room_id ? Number(editForm.homeroom_room_id) : null,
      homeroom_teacher_id: editForm.homeroom_teacher_id ? Number(editForm.homeroom_teacher_id) : null,
    });
    useTimetableStore.setState((s) => ({ groups: s.groups.map((g) => g.id === id ? { ...g, ...updated } : g) }));
    setEditing(null); setEditForm(null);
  };

  const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);
  const roomName = (id: number | null | undefined) => id ? (rooms.find((r) => r.id === id)?.name ?? "–") : "–";
  const [q, setQ] = useState("");
  const shownGroups = flat.filter((g) => matches(q, g.name, g.level, roomName(g.homeroom_room_id),
    teachers.find((t) => t.id === g.homeroom_teacher_id)?.name));

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
          <SearchableSelect value={form.parent_id} onChange={(v) => setForm({ ...form, parent_id: v })}
            options={groupOptions(groups)} emptyLabel="– ไม่มี –" />
        </Field>
        <Field label="ห้องประจำชั้น (ห้องสอน)">
          <SearchableSelect value={form.homeroom_room_id} onChange={(v) => setForm({ ...form, homeroom_room_id: v })}
            options={roomOptions(rooms, ROOM_TYPE_TH)} emptyLabel="– ไม่ระบุ –" />
        </Field>
        <Field label="👩‍🏫 ครูประจำชั้น (คนแรก)">
          <SearchableSelect value={form.homeroom_teacher_id} onChange={(v) => setForm({ ...form, homeroom_teacher_id: v })}
            options={teacherOptions(teachers)} emptyLabel="– ไม่ระบุ –" />
        </Field>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-3 text-xs text-blue-800">
        💡 <strong>ครูประจำชั้นใส่ได้ห้องละ {HOMEROOM_MAX} คน</strong> — สร้างห้องแล้วกดปุ่ม 👩‍🏫 ในตารางด้านล่างเพื่อเพิ่มคนถัดไป
        <br />
        ใช้ตอนสร้าง "คาบกิจกรรมประจำระดับ" (เช่น สาธารณประโยชน์) — เลือกโหมดครูประจำชั้น แล้วแต่ละห้องจะได้ครูของตัวเองลงตารางสอนอัตโนมัติ
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={handleCreate} disabled={!form.name} className={btnPrimary}>+ เพิ่มห้องเรียน</button>
        {/* Ninety-three classes one dialog at a time is an afternoon; the
            office already keeps this list somewhere. */}
        <button onClick={() => setImportingHomeroom(true)}
          className="px-4 py-2 text-sm border border-emerald-400 text-emerald-800 rounded-lg font-semibold hover:bg-emerald-50">
          👩‍🏫 นำเข้าครูประจำชั้นทั้งหมด
        </button>
      </div>

      <div className="mt-4">
        <TableSearch value={q} onChange={setQ} count={shownGroups.length} total={flat.length}
          placeholder="ค้นหาห้องเรียน / ระดับ / ห้องประจำชั้น / ครูประจำชั้น" />
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ชื่อห้อง","ระดับ","จำนวน","ห้องแม่","ห้องประจำชั้น","👩‍🏫 ครูประจำชั้น",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {flat.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {shownGroups.map((g) => (
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
                      <SearchableSelect value={editForm.homeroom_room_id} onChange={(v) => setEditForm({ ...editForm, homeroom_room_id: v })}
                        options={roomOptions(rooms, ROOM_TYPE_TH)} emptyLabel="– ไม่ระบุ –" />
                    </td>
                    <td className="px-2 py-1 text-[11px] text-gray-400">
                      แก้ที่ปุ่ม 👩‍🏫
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
                    <td className="px-3 py-2 text-xs">
                      {/* A button, not a dropdown: 143 teachers do not belong
                          in a table cell, and a class may hold two of them. */}
                      <button onClick={() => setHomeroomFor(g.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded border text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 max-w-[220px]">
                        👩‍🏫
                        <span className="truncate">
                          {homeroomNames(g, teachers).join(" · ") || "ยังไม่ได้ตั้ง"}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(g.id); setEditForm({ name: g.name, level: g.level ?? "M1", size: g.size, parent_id: g.parent_id ? String(g.parent_id) : "", homeroom_room_id: g.homeroom_room_id ? String(g.homeroom_room_id) : "", homeroom_teacher_id: g.homeroom_teacher_id ? String(g.homeroom_teacher_id) : "" }); }} className={btnEdit}>แก้ไข</button>
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

      {homeroomFor != null && (
        <HomeroomModal
          group={flat.find((g) => g.id === homeroomFor)}
          groups={flat}
          teachers={teachers}
          onApply={applyHomeroom}
          onClose={() => setHomeroomFor(null)}
        />
      )}

      {importingHomeroom && (
        <HomeroomImportModal
          onApply={applyHomeroom}
          onClose={() => setImportingHomeroom(false)}
        />
      )}
    </Section>
  );
};

// ─── Teachers ────────────────────────────────────────────────────────────────

/** Update one class inside the nested group tree, leaving the rest alone. */
function patchGroupTree(
  groups: StudentGroup[], id: number, patch: Partial<StudentGroup>,
): StudentGroup[] {
  return groups.map((g) => {
    const next = g.id === id ? { ...g, ...patch } : g;
    return next.children?.length
      ? { ...next, children: patchGroupTree(next.children, id, patch) }
      : next;
  });
}

const TeachersPanel: React.FC = () => {
  const { teachers, departments, rooms, requirements, groups, schoolConfig } = useTimetableStore();
  // How many classes this teacher is down to teach.
  const loadOf = (id: number) => requirements.filter((r) => r.teacher_id === id).length;

  const flat = useMemo(() => flattenGroups(groups), [groups]);


  const [form, setForm] = useState({ code: "", name: "", department_id: "", fixed_room_id: "", outdoor_score: 5, max_slots_per_day: 6, max_outdoor_per_week: 2 });
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);
  const [settingsFor, setSettingsFor] = useState<number | null>(null);
  const [homeroomFor, setHomeroomFor] = useState<number | null>(null);
  const [assigning, setAssigning] = useState<number | null>(null);
  const assigningTeacher = assigning != null ? teachers.find((t) => t.id === assigning) ?? null : null;
  const settingsTeacher  = settingsFor != null ? teachers.find((t) => t.id === settingsFor) ?? null : null;

  const handleCreate = async () => {
    const created = await api.createTeacher({
      ...form,
      department_id: form.department_id ? Number(form.department_id) : null,
      fixed_room_id: form.fixed_room_id ? Number(form.fixed_room_id) : null,
    });
    useTimetableStore.setState((s) => ({ teachers: [...s.teachers, created] }));
    setForm({ code: "", name: "", department_id: "", fixed_room_id: "", outdoor_score: 5, max_slots_per_day: 6, max_outdoor_per_week: 2 });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateTeacher(id, {
      ...editForm,
      department_id: editForm.department_id ? Number(editForm.department_id) : null,
      fixed_room_id: editForm.fixed_room_id ? Number(editForm.fixed_room_id) : null,
    });
    useTimetableStore.setState((s) => ({ teachers: s.teachers.map((t) => t.id === id ? { ...t, ...updated } : t) }));
    setEditing(null); setEditForm(null);
  };

  const roomName = (id: number | null | undefined) => id ? (rooms.find((r) => r.id === id)?.name ?? "–") : "–";

  const deptName = (id: number | null | undefined) => id ? (departments.find((d) => d.id === id)?.name ?? "–") : "–";
  const [q, setQ] = useState("");
  // Listed by รหัสประจำตัวครู — see utils/teacherOrder.
  const shownTeachers = byTeacherCode(
    teachers.filter((t) => matches(q, t.code, t.name,
      deptName(t.department_id), roomName(t.fixed_room_id))));

  return (
    <Section title="ครูผู้สอน" action={<ImportButton entity="teachers" />}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="รหัสประจำตัวครู">
          <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="เช่น T001" />
        </Field>
        <Field label="ชื่อครู *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ครูสมชาย ใจดี" />
        </Field>
        <Field label="กลุ่มสาระฯ">
          <select className={inputCls} value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">– ไม่ระบุ –</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="🏠 ห้องประจำครู">
          <SearchableSelect value={form.fixed_room_id} onChange={(v) => setForm({ ...form, fixed_room_id: v })}
            options={roomOptions(rooms, ROOM_TYPE_TH)} emptyLabel="– ไม่มี (ใช้ห้องว่างอัตโนมัติ) –" />
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

      <div className="mt-4">
        <TableSearch value={q} onChange={setQ} count={shownTeachers.length} total={teachers.length}
          placeholder="ค้นหารหัสครู / ชื่อครู / กลุ่มสาระ" />
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["รหัส","ชื่อครู","กลุ่มสาระฯ","👩‍🏫 ครูประจำชั้น","🏠 ห้องประจำครู","กลางแจ้ง","สอน/วัน",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {teachers.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {shownTeachers.map((t) => (
              <React.Fragment key={t.id}>
                <tr className="hover:bg-gray-50">
                  {editing === t.id && editForm ? (
                    <>
                      <td className="px-2 py-1"><input className={inlineCls} style={{ width: 70 }} value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} /></td>
                      <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                      <td className="px-2 py-1">
                        <select className={inlineCls} value={editForm.department_id} onChange={(e) => setEditForm({ ...editForm, department_id: e.target.value })}>
                          <option value="">–</option>
                          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-xs text-gray-400">
                        {classesAdvisedBy(t.id, flat).map((g) => g.name).join(", ") || "–"}
                      </td>
                      <td className="px-2 py-1">
                        <SearchableSelect value={editForm.fixed_room_id} onChange={(v) => setEditForm({ ...editForm, fixed_room_id: v })}
                          options={roomOptions(rooms, ROOM_TYPE_TH)} emptyLabel="– ไม่มี –" />
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
                      <td className="px-3 py-2 text-xs font-mono text-gray-500">{t.code || "–"}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">
                        {t.name}
                        {t.advanced_settings?.require_ground_floor && <span className="ml-1 text-xs bg-blue-100 text-blue-600 px-1 rounded">ชั้น 1</span>}
                        {(t.advanced_settings?.days_off ?? []).length > 0 && <span className="ml-1 text-xs bg-orange-100 text-orange-600 px-1 rounded">วันหยุด</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs truncate max-w-[140px]">{deptName(t.department_id)}</td>
                      {/* ครูประจำชั้น is a CLASS of students, not a room — it is
                          stored on the class, and shown here because this is
                          where you think about a teacher. */}
                      <td className="px-3 py-2 text-xs">
                        {/* A button, not a select over all 93 classes. The old
                            select also disabled every class that already had a
                            teacher, so a teacher added later could never be
                            made ครูประจำชั้น of anything. */}
                        <button onClick={() => setHomeroomFor(t.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded border text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 max-w-[170px]">
                          👩‍🏫
                          <span className="truncate">
                            {classesAdvisedBy(t.id, flat).map((g) => g.name).join(", ") || "ตั้งห้องประจำชั้น"}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {t.fixed_room_id
                          ? <span className="bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded">🏠 {roomName(t.fixed_room_id)}</span>
                          : <span className="text-gray-400">–</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{t.outdoor_score}</td>
                      <td className="px-3 py-2 text-gray-600">{t.max_slots_per_day}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={() => { setEditing(t.id); setEditForm({ code: t.code ?? "", name: t.name, department_id: t.department_id ? String(t.department_id) : "", fixed_room_id: t.fixed_room_id ? String(t.fixed_room_id) : "", outdoor_score: t.outdoor_score, max_slots_per_day: t.max_slots_per_day, max_outdoor_per_week: t.max_outdoor_per_week }); }} className={btnEdit}>แก้ไข</button>
                          <button
                            onClick={() => setAssigning(t.id)}
                            className="px-2 py-1 text-xs bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100 border border-indigo-200 whitespace-nowrap"
                            title="เลือกวิชาและห้องเรียนที่ครูคนนี้สอน"
                          >
                            📚 วิชาที่สอน
                            {loadOf(t.id) > 0 && (
                              <span className="ml-1 text-[10px] bg-indigo-600 text-white px-1 rounded-full">{loadOf(t.id)}</span>
                            )}
                          </button>
                          <button onClick={() => setSettingsFor(t.id)}
                            className="px-2 py-1 text-xs bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 border border-indigo-200">⚙ ตั้งค่า</button>
                          <button onClick={async () => { await api.deleteTeacher(t.id); useTimetableStore.setState((s) => ({ teachers: s.teachers.filter((x) => x.id !== t.id) })); }} className={btnDanger}>ลบ</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {assigningTeacher && (
        <TeacherAssignModal teacher={assigningTeacher} onClose={() => setAssigning(null)} />
      )}
      {homeroomFor != null && (
        <HomeroomModal
          teacher={teachers.find((t) => t.id === homeroomFor)}
          groups={flat}
          teachers={teachers}
          onApply={applyHomeroom}
          onClose={() => setHomeroomFor(null)}
        />
      )}
      {settingsTeacher && (
        <TeacherSettingsModal
          teacher={settingsTeacher}
          schoolMaxConsecutive={schoolConfig.max_consecutive ?? 3}
          schoolMinLastPeriod={schoolConfig.min_last_period ?? 1}
          onClose={() => setSettingsFor(null)}
        />
      )}
    </Section>
  );
};

// ─── Subjects ────────────────────────────────────────────────────────────────
const SubjectsPanel: React.FC = () => {
  const { subjects, departments, requirements, rooms } = useTimetableStore();
  const [form, setForm] = useState({ code: "", name: "", type: "common", duration: 1, department_id: "", is_activity: false, fixed_room_id: "", prefer_morning: false });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [electiveFor, setElectiveFor] = useState<number | null>(null);

  // How many classes each subject is already assigned to.
  const classCount = (subjectId: number) =>
    requirements.filter((r) => r.subject_id === subjectId).length;
  const assigningSubject = assigning != null ? subjects.find((s) => s.id === assigning) ?? null : null;

  const roomName = (id: number | null | undefined) => id ? (rooms.find((r) => r.id === id)?.name ?? "–") : null;

  // ── ตั้งช่วงเวลาหลายวิชาพร้อมกัน ──────────────────────────────────────────
  // 271 subjects is too many to click one at a time, and a whole กลุ่มสาระ is
  // how the school thinks about it ("วิชาวิทย์ทั้งหมดเรียนเช้า").
  const [bulkTarget, setBulkTarget] = useState("search");
  const [bulkMsg, setBulkMsg]       = useState<string | null>(null);
  const [bulkBusy, setBulkBusy]     = useState(false);

  /** Flip "teach this one in the morning" straight from the table. */
  const toggleMorning = async (s: Subject) => {
    const next = !s.prefer_morning;
    useTimetableStore.setState((st) => ({
      subjects: st.subjects.map((x) => x.id === s.id ? { ...x, prefer_morning: next } : x),
    }));
    await api.updateSubject(s.id, { prefer_morning: next }).catch(() => {
      useTimetableStore.setState((st) => ({   // put it back if the server refused
        subjects: st.subjects.map((x) => x.id === s.id ? { ...x, prefer_morning: !next } : x),
      }));
    });
  };

  const handleCreate = async () => {
    const created = await api.createSubject({
      ...form,
      type:          form.type   as SubjectType,
      duration:      Number(form.duration) as 1 | 2,
      department_id: form.department_id ? Number(form.department_id) : null,
      fixed_room_id: form.fixed_room_id ? Number(form.fixed_room_id) : null,
    });
    useTimetableStore.setState((s) => ({ subjects: [...s.subjects, created] }));
    setForm({ code: "", name: "", type: "common", duration: 1, department_id: "", is_activity: false, fixed_room_id: "", prefer_morning: false });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateSubject(id, {
      code: editForm.code, name: editForm.name,
      type: editForm.type as SubjectType,
      duration: Number(editForm.duration) as 1 | 2,
      department_id: editForm.department_id ? Number(editForm.department_id) : null,
      is_activity: editForm.is_activity,
      prefer_morning: editForm.prefer_morning,
      fixed_room_id: editForm.fixed_room_id ? Number(editForm.fixed_room_id) : null,
    });
    useTimetableStore.setState((s) => ({ subjects: s.subjects.map((x) => x.id === id ? { ...x, ...updated } : x) }));
    setEditing(null); setEditForm(null);
  };

  const deptName = (id: number | null | undefined) => id ? (departments.find((d) => d.id === id)?.name?.replace("กลุ่มสาระ","") ?? String(id)) : "–";
  const [q, setQ] = useState("");
  const shownSubjects = subjects.filter((x) => matches(q, x.code, x.name, deptName(x.department_id), roomName(x.fixed_room_id)));

  /** The subjects the bulk buttons would touch, given the current choice. */
  const bulkSubjects = bulkTarget === "all" ? subjects
    : bulkTarget === "search" ? shownSubjects
    : subjects.filter((x) => x.department_id === Number(bulkTarget));

  const applyBulk = async (want: boolean) => {
    if (bulkSubjects.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      // Send the department, not a list of ids, when that is what was chosen:
      // the server then works from its own data and cannot act on a stale list.
      const res = await api.setPreferMorning({
        prefer_morning: want,
        ...(bulkTarget === "all" ? { all: true }
          : bulkTarget === "search" ? { ids: bulkSubjects.map((x) => x.id) }
          : { department_id: Number(bulkTarget) }),
      });
      const updated = new Map(res.subjects.map((r) => [r.id, r.prefer_morning]));
      useTimetableStore.setState((st) => ({
        subjects: st.subjects.map((x) =>
          updated.has(x.id) ? { ...x, prefer_morning: updated.get(x.id)! } : x),
      }));
      setBulkMsg(res.changed === 0
        ? `${res.matched} วิชานี้เป็น ${want ? "☀️ เช้า" : "🌙 ไม่ระบุ"} อยู่แล้ว ไม่มีอะไรเปลี่ยน`
        : `ตั้ง ${want ? "☀️ เช้า" : "🌙 ไม่ระบุ"} ให้ ${res.matched} วิชา — เปลี่ยนจริง ${res.changed} วิชา`);
    } catch {
      setBulkMsg("บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally { setBulkBusy(false); }
  };

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
        <Field label="🏟 ห้องประจำวิชา">
          <SearchableSelect value={form.fixed_room_id} onChange={(v) => setForm({ ...form, fixed_room_id: v })}
            options={roomOptions(rooms, ROOM_TYPE_TH)} emptyLabel="– ไม่มี (ใช้ห้องประจำชั้น) –" />
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
        <Field label="วิชากิจกรรม">
          <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
            <input type="checkbox" checked={form.is_activity} onChange={(e) => setForm({ ...form, is_activity: e.target.checked })} className="w-4 h-4" />
            <span className="text-sm text-gray-600">เป็นชุมนุม/ลูกเสือ/กิจกรรม</span>
          </label>
        </Field>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3 text-xs text-amber-900">
        <span className="inline-flex items-center gap-1 bg-amber-400 text-white font-bold rounded px-1.5 py-0.5">☀️ เช้า</span>{" "}
        <strong>= วิชายากๆ (คณิต วิทย์) ที่อยากให้อยู่ช่วงเช้า</strong> นักเรียนจะได้ไม่ง่วงในคาบบ่าย ·
        กดปุ่มในคอลัมน์ "ช่วงเวลาที่อยากให้สอน" เพื่อสลับระหว่าง{" "}
        <span className="inline-flex items-center gap-1 bg-amber-400 text-white font-bold rounded px-1.5 py-0.5">☀️ เช้า</span>{" "}
        กับ{" "}
        <span className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 text-gray-400 rounded px-1.5 py-0.5">🌙 ไม่ระบุ</span>
        <br />
        เป็น<strong>แนวทาง</strong> ไม่ใช่กฎ ระบบจะลองวางในเช้าก่อน ถ้าไม่มีที่จริงๆ จึงลงบ่าย วิชาจะไม่หายไปจากตาราง
        <br />
        🏟 <strong>ห้องประจำวิชา</strong> = วิชานี้ต้องเรียนที่ห้องนี้เสมอ (พละ → สนาม, คอมพิวเตอร์ → ห้องแล็บ, ดนตรี → ห้องดนตรี)
        — <strong>สำคัญกว่าห้องประจำชั้นของนักเรียน</strong> นักเรียนจะเดินมาเรียนที่ห้องนี้ ส่วนวิชาที่ไม่ได้ตั้งไว้จะเรียนในห้องประจำชั้นของตัวเอง
      </div>
      <button onClick={handleCreate} disabled={!form.code || !form.name} className={btnPrimary}>+ เพิ่มวิชา</button>

      {/* ตั้งหลายวิชาพร้อมกัน — กดทีละวิชาไม่ไหวเมื่อมี 271 วิชา */}
      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-amber-900 shrink-0">
            ⚡ ตั้งช่วงเวลาทีละหลายวิชา
          </span>
          <select
            className="border border-amber-300 rounded-lg px-2.5 py-1.5 text-sm bg-white min-w-[230px]"
            value={bulkTarget}
            onChange={(e) => { setBulkTarget(e.target.value); setBulkMsg(null); }}
          >
            <option value="search">ผลการค้นหาด้านล่าง ({shownSubjects.length} วิชา)</option>
            {departments.map((d) => {
              const n = subjects.filter((x) => x.department_id === d.id).length;
              return <option key={d.id} value={String(d.id)}>{d.name} ({n} วิชา)</option>;
            })}
            <option value="all">ทุกวิชา ({subjects.length} วิชา)</option>
          </select>
          <button
            onClick={() => applyBulk(true)}
            disabled={bulkBusy || bulkSubjects.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-amber-400 border border-amber-500 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ☀️ ตั้งเป็นเช้า
          </button>
          <button
            onClick={() => applyBulk(false)}
            disabled={bulkBusy || bulkSubjects.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🌙 ล้างเป็นไม่ระบุ
          </button>
          {bulkBusy && <span className="text-xs text-amber-700">กำลังบันทึก…</span>}
        </div>
        <p className="text-[11px] text-amber-800 mt-2 leading-relaxed">
          เลือกกลุ่มสาระแล้วกดปุ่มเดียว ตั้งได้ทั้งกลุ่ม เช่น ให้วิชาวิทยาศาสตร์ทั้งหมดเรียนช่วงเช้า ·
          ถ้าอยากเลือกเองเฉพาะบางวิชา ให้พิมพ์ค้นหาในช่องด้านล่างก่อน แล้วเลือก
          "ผลการค้นหาด้านล่าง"
        </p>
        {bulkMsg && (
          <p className="text-xs font-semibold text-amber-900 bg-white border border-amber-300 rounded px-2.5 py-1.5 mt-2">
            ✓ {bulkMsg}
          </p>
        )}
      </div>

      <div className="mt-4">
        <TableSearch value={q} onChange={setQ} count={shownSubjects.length} total={subjects.length}
          placeholder="ค้นหารหัสวิชา / ชื่อวิชา / กลุ่มสาระ" />
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["รหัส","ชื่อวิชา","กลุ่มสาระฯ","🏟 ห้องประจำวิชา","ประเภท","คาบ","ช่วงเวลาที่อยากให้สอน",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {subjects.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {shownSubjects.map((s) => (
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
                    <td className="px-2 py-1" style={{ minWidth: 130 }}>
                      <SearchableSelect value={editForm.fixed_room_id} onChange={(v) => setEditForm({ ...editForm, fixed_room_id: v })}
                        options={roomOptions(rooms, ROOM_TYPE_TH)} emptyLabel="– ไม่มี –" />
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
                      <label className="flex items-center gap-1"><input type="checkbox" checked={editForm.prefer_morning} onChange={(e) => setEditForm({ ...editForm, prefer_morning: e.target.checked })} /> ☀️ สอนเช้า</label>
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
                    <td className="px-3 py-2 text-xs">
                      {roomName(s.fixed_room_id)
                        ? <span className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">🏟 {roomName(s.fixed_room_id)}</span>
                        : <span className="text-gray-400">–</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{SUBJECT_TYPE_TH[s.type] ?? s.type}</td>
                    <td className="px-3 py-2 text-gray-600">{s.duration}</td>
                    <td className="px-3 py-2">
                      {/* A tinted background alone was not readable — two pale
                          shades of the same icon. The state is written out
                          instead, so it can be read rather than compared. */}
                      <button
                        onClick={() => toggleMorning(s)}
                        title={s.prefer_morning
                          ? "วิชานี้จะถูกลองวางในคาบเช้าก่อน — กดเพื่อปิด"
                          : "กดเพื่อให้ระบบลองวางวิชานี้ในคาบเช้าก่อน"}
                        className={clsx(
                          "flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs whitespace-nowrap transition-colors",
                          s.prefer_morning
                            ? "bg-amber-400 border-amber-500 text-white font-bold shadow-sm"
                            : "bg-gray-50 border-gray-200 text-gray-400 hover:border-amber-400 hover:text-amber-600")}
                      >
                        <span>{s.prefer_morning ? "☀️" : "🌙"}</span>
                        <span>{s.prefer_morning ? "เช้า" : "ไม่ระบุ"}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setAssigning(s.id)}
                          className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 border border-blue-200 whitespace-nowrap"
                          title="เลือกห้องเรียนที่เรียนวิชานี้ และกำหนดครูของแต่ละห้อง"
                        >
                          🧑‍🏫 จัดห้อง/ครู
                          {classCount(s.id) > 0 && (
                            <span className="ml-1 text-[10px] bg-blue-600 text-white px-1 rounded-full">{classCount(s.id)}</span>
                          )}
                        </button>
                        <button
                          onClick={() => setElectiveFor(s.id)}
                          className="px-2 py-1 text-xs bg-purple-50 text-purple-700 rounded hover:bg-purple-100 border border-purple-200 whitespace-nowrap"
                          title="ใส่วิชานี้เป็นตัวเลือกในคาบเสรีที่มีอยู่"
                        >
                          🎓 ใส่คาบเสรี
                        </button>
                        <button onClick={() => { setEditing(s.id); setEditForm({ code: s.code, name: s.name, type: s.type, duration: s.duration, department_id: s.department_id ? String(s.department_id) : "", is_activity: s.is_activity ?? false, fixed_room_id: s.fixed_room_id ? String(s.fixed_room_id) : "", prefer_morning: s.prefer_morning ?? false }); }} className={btnEdit}>แก้ไข</button>
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

      {electiveFor != null && (
        <AddElectiveSubjectModal subjectId={electiveFor} onClose={() => setElectiveFor(null)} />
      )}
      {assigningSubject && (
        <SubjectAssignModal subject={assigningSubject} onClose={() => setAssigning(null)} />
      )}
    </Section>
  );
};

// ─── Rooms ───────────────────────────────────────────────────────────────────

const RoomsPanel: React.FC = () => {
  const { rooms, teachers, departments } = useTimetableStore();
  // Settings live in a dialog: a room carries enough of them that editing in
  // the row made that row several lines tall and hid every other room.
  const [settingsFor, setSettingsFor] = useState<Room | null>(null);
  const [creating, setCreating]       = useState(false);
  const [q, setQ] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);

  const teacherName = (id: number) => teachers.find((t) => t.id === id)?.name ?? "–";
  const deptName = (id: number | null | undefined) =>
    id ? (departments.find((d) => d.id === id)?.name ?? "–") : null;

  /** Take a room out of the timetable, or put it back — one click from the row. */
  const toggleUsable = async (r: Room) => {
    const usable = r.usable === false;
    useTimetableStore.setState((s) => ({
      rooms: s.rooms.map((x) => (x.id === r.id ? { ...x, usable } : x)),
    }));
    try {
      await api.updateRoom(r.id, { usable });
    } catch {
      useTimetableStore.setState((s) => ({
        rooms: s.rooms.map((x) => (x.id === r.id ? { ...x, usable: !usable } : x)),
      }));
    }
  };

  const blockedCount = rooms.filter((r) => r.usable === false).length;
  const shownRooms = rooms.filter((r) =>
    (!onlyBlocked || r.usable === false) &&
    matches(q, r.name, ROOM_TYPE_TH[r.type] ?? r.type, r.building_name, r.floor,
      roomReservedFor(r).map(teacherName).join(" "), deptName(r.specialized_dept_id),
      r.usable === false ? "ห้ามใช้" : "ใช้ได้"));

  return (
    <Section title="ห้องสอน" action={<ImportButton entity="rooms" />}>
      <button onClick={() => setCreating(true)} className={btnPrimary}>+ เพิ่มห้องสอน</button>

      <div className="mt-4">
        <TableSearch value={q} onChange={setQ} count={shownRooms.length} total={rooms.length}
          placeholder="ค้นหาเลขห้อง / ชื่อห้อง / อาคาร / ครู / กลุ่มสาระ">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0 cursor-pointer">
            <input type="checkbox" checked={onlyBlocked}
              onChange={(e) => setOnlyBlocked(e.target.checked)} />
            เฉพาะห้องห้ามใช้ ({blockedCount})
          </label>
        </TableSearch>
        <p className="text-[11px] text-gray-500 -mt-1 mb-2">
          กด <strong>ตั้งค่า</strong> เพื่อแก้ไขทุกอย่างของห้องในหน้าต่างใหม่ ·
          🚫 <strong>ห้ามใช้</strong> = ระบบจะไม่จัดคาบลงห้องนี้เลย (ห้องพักครู ห้องสำนักงาน)
        </p>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ชื่อห้อง","ประเภท","อาคาร/ชั้น","ความจุ","สงวนไว้ให้","ใช้จัดคาบ",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shownRooms.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 text-xs">ไม่พบห้องที่ค้นหา</td></tr>
            )}
            {shownRooms.map((r) => {
              const kept = roomReservedFor(r);
              return (
                <tr key={r.id} className={clsx("hover:bg-gray-50", r.usable === false && "bg-red-50/40")}>
                  <td className="px-3 py-2 font-medium text-gray-800">{r.name}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{ROOM_TYPE_TH[r.type] ?? r.type}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">
                    {r.building_name ?? "–"}{r.building_name ? ` · ชั้น ${r.floor}` : ""}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{r.capacity}</td>
                  {/* One line, however many teachers or departments it names. */}
                  <td className="px-3 py-2 text-xs">
                    <span className="flex items-center gap-1 flex-wrap">
                      {deptName(r.specialized_dept_id) && (
                        <span className="bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                          🧪 {deptName(r.specialized_dept_id)}
                        </span>
                      )}
                      {kept.length > 0 && (
                        <span className="bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded whitespace-nowrap"
                          title={kept.map(teacherName).join(", ")}>
                          🏠 {kept.length === 1 ? teacherName(kept[0]) : `ครู ${kept.length} คน`}
                        </span>
                      )}
                      {kept.length === 0 && !r.specialized_dept_id && <span className="text-gray-400">ห้องรวม</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleUsable(r)}
                      title={r.usable === false
                        ? "ตอนนี้ห้ามใช้ — กดเพื่ออนุญาตให้จัดคาบลงห้องนี้"
                        : "ตอนนี้ใช้ได้ — กดเพื่อห้ามไม่ให้จัดคาบลงห้องนี้"}
                      className={clsx("px-2 py-1 rounded text-xs border whitespace-nowrap",
                        r.usable === false
                          ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                          : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100")}
                    >
                      {r.usable === false ? "🚫 ห้ามใช้" : "✓ ใช้ได้"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button onClick={() => setSettingsFor(r)} className={btnEdit}>⚙ ตั้งค่า</button>
                      <button
                        onClick={async () => {
                          await api.deleteRoom(r.id);
                          useTimetableStore.setState((s) => ({ rooms: s.rooms.filter((x) => x.id !== r.id) }));
                        }}
                        className={btnDanger}>ลบ</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(settingsFor || creating) && (
        <RoomSettingsModal
          room={settingsFor}
          onClose={() => { setSettingsFor(null); setCreating(false); }} />
      )}
    </Section>
  );
};

// ─── Requirements (Teacher-Subject-Group Assignments) ─────────────────────────
const RequirementsPanel: React.FC = () => {
  const { requirements, groups, teachers, subjects, periods, departments } = useTimetableStore();
  const [form, setForm] = useState({
    group_id: "", subject_id: "", teacher_id: "", weekly_count: 1, parallel_group_key: "",
  });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);

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

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateRequirement(id, {
      group_id:   Number(editForm.group_id),
      subject_id: Number(editForm.subject_id),
      teacher_id: Number(editForm.teacher_id),
      weekly_count: Number(editForm.weekly_count),
      parallel_group_key: editForm.parallel_group_key || null,
    });
    useTimetableStore.setState((s) => ({ requirements: s.requirements.map((r) => r.id === id ? { ...r, ...updated } : r) }));
    setEditing(null); setEditForm(null);
  };

  const gName = (id: number) => groups.flatMap((g) => [g,...(g.children??[])]).find((g) => g.id === id)?.name ?? String(id);
  const tName = (id: number) => teachers.find((t) => t.id === id)?.name ?? String(id);
  const sCode = (id: number) => subjects.find((s) => s.id === id)?.code ?? String(id);

  const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);

  // ── Capacity check: warn if a group needs more periods than exist ──────────
  const classPeriodCount = new Set(periods.filter((p) => p.type === "class").map((p) => p.period_num)).size;
  const weekCapacity = classPeriodCount * 5;   // 5 school days
  const groupLoad = new Map<number, number>();
  for (const r of requirements) {
    groupLoad.set(r.group_id, (groupLoad.get(r.group_id) ?? 0) + (r.weekly_count || 0));
  }
  const overbooked = [...groupLoad.entries()]
    .filter(([, load]) => load > weekCapacity)
    .map(([gid, load]) => ({ name: gName(gid), load }));

  // Teacher over-load (soft): teacher total weekly count vs their max_slots_per_day*5
  const teacherLoad = new Map<number, number>();
  for (const r of requirements) teacherLoad.set(r.teacher_id, (teacherLoad.get(r.teacher_id) ?? 0) + (r.weekly_count || 0));
  const teacherOver = teachers
    .map((t) => ({ t, load: teacherLoad.get(t.id) ?? 0, cap: (t.max_slots_per_day || 6) * 5 }))
    .filter((x) => x.load > x.cap)
    .map((x) => ({ name: x.t.name, load: x.load, cap: x.cap }));

  const existingParallelKeys = [...new Set(requirements.map((r) => r.parallel_group_key).filter(Boolean))] as string[];

  // 1,200+ rows: filter first, then draw only a slice so the page stays quick.
  const [q, setQ] = useState("");
  const matchedReqs = requirements.filter((r) =>
    matches(q, gName(r.group_id), sCode(r.subject_id), tName(r.teacher_id), r.parallel_group_key));
  const ROW_CAP = 200;
  const shownReqs = matchedReqs.slice(0, ROW_CAP);

  return (
    <Section title="ข้อกำหนดคาบเรียน — ครูสอนวิชาอะไร ในห้องใด">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
        <strong>วิธีกำหนดการสอน:</strong> เลือกห้องเรียน → วิชา → ครูผู้สอน → จำนวนคาบ/สัปดาห์
        <br/>ถ้าวิชาเดียวกันสอนหลายห้องพร้อมกัน (คู่ขนาน) ให้ใช้ <strong>รหัสคู่ขนาน</strong> เดียวกัน — เลือกจากรายการที่มี หรือพิมพ์รหัสใหม่
        <br/>💡 มีข้อกำหนดจำนวนมาก? ใช้ปุ่ม <strong>"นำเข้า"</strong> ด้านบน แล้วเลือก "ข้อกำหนดคาบ" เพื่อนำเข้าจาก Excel ทีเดียว
      </div>

      {(overbooked.length > 0 || teacherOver.length > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-xs text-red-800 space-y-1">
          <p className="font-semibold">⚠️ ตรวจพบปัญหาก่อนจัดตาราง (แก้ก่อนกดสร้างจะได้ไม่ INFEASIBLE):</p>
          {overbooked.map((o) => (
            <p key={o.name}>• ห้อง <strong>{o.name}</strong> ต้องการ {o.load} คาบ/สัปดาห์ แต่มีช่องเรียนแค่ {weekCapacity} คาบ — ต้องลดลง {o.load - weekCapacity} คาบ</p>
          ))}
          {teacherOver.map((t) => (
            <p key={t.name}>• ครู <strong>{t.name}</strong> ถูกกำหนดให้สอน {t.load} คาบ/สัปดาห์ เกินเพดาน {t.cap} คาบ</p>
          ))}
        </div>
      )}

      <datalist id="parallel-keys">
        {existingParallelKeys.map((k) => <option key={k} value={k} />)}
      </datalist>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="ห้องเรียน *">
          <SearchableSelect value={form.group_id} onChange={(v) => setForm({ ...form, group_id: v })}
            options={groupOptions(flat)} placeholder="เลือกห้อง" />
        </Field>
        <Field label="วิชา *">
          <select className={inputCls} value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
            <option value="">เลือกวิชา</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
          </select>
        </Field>
        <Field label="ครูผู้สอน *">
          <SearchableSelect value={form.teacher_id} onChange={(v) => setForm({ ...form, teacher_id: v })}
            options={teacherOptions(teachers, departments)} placeholder="เลือกครู" />
        </Field>
        <Field label="คาบ/สัปดาห์">
          <input type="number" min={1} max={10} className={inputCls} value={form.weekly_count}
            onChange={(e) => setForm({ ...form, weekly_count: Number(e.target.value) })} />
        </Field>
        <Field label="รหัสคู่ขนาน (สำหรับวิชาที่สอนพร้อมกัน)">
          <input className={inputCls} list="parallel-keys" value={form.parallel_group_key}
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

      <div className="mt-4">
        <TableSearch value={q} onChange={setQ} count={matchedReqs.length} total={requirements.length}
          shown={shownReqs.length} placeholder="ค้นหาห้องเรียน / รหัสวิชา / ชื่อครู" />
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
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
            {shownReqs.map((r) => (
              editing === r.id && editForm ? (
                <tr key={r.id} className="bg-yellow-50">
                  <td className="px-2 py-1">
                    <select className={inlineCls} value={editForm.group_id} onChange={(e) => setEditForm({ ...editForm, group_id: e.target.value })}>
                      {flat.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select className={inlineCls} value={editForm.subject_id} onChange={(e) => setEditForm({ ...editForm, subject_id: e.target.value })}>
                      {subjects.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select className={inlineCls} value={editForm.teacher_id} onChange={(e) => setEditForm({ ...editForm, teacher_id: e.target.value })}>
                      {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1"><input type="number" min={1} max={20} className={inlineCls} style={{ width: 55 }} value={editForm.weekly_count} onChange={(e) => setEditForm({ ...editForm, weekly_count: Number(e.target.value) })} /></td>
                  <td className="px-2 py-1"><input className={inlineCls} list="parallel-keys" style={{ width: 100 }} value={editForm.parallel_group_key} onChange={(e) => setEditForm({ ...editForm, parallel_group_key: e.target.value })} /></td>
                  <td className="px-2 py-1">
                    <div className="flex gap-1">
                      <button onClick={() => handleUpdate(r.id)} className={btnSave}>บันทึก</button>
                      <button onClick={() => { setEditing(null); setEditForm(null); }} className={btnCancel}>ยกเลิก</button>
                    </div>
                  </td>
                </tr>
              ) : (
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
                    <div className="flex gap-1">
                      <button onClick={() => { setEditing(r.id); setEditForm({ group_id: String(r.group_id), subject_id: String(r.subject_id), teacher_id: String(r.teacher_id), weekly_count: r.weekly_count, parallel_group_key: r.parallel_group_key ?? "" }); }} className={btnEdit}>แก้ไข</button>
                      <button onClick={async () => { await api.deleteRequirement(r.id); useTimetableStore.setState((s) => ({ requirements: s.requirements.filter((x) => x.id !== r.id) })); }} className={btnDanger}>ลบ</button>
                    </div>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// ─── Electives (วิชาเสรี) ───────────────────────────────────────────────────────
const ElectivesPanel: React.FC = () => {
  const { slots, groups, teachers, subjects, periods, rooms, loadSlots } = useTimetableStore();
  const [form, setForm] = useState({ group_id: "", day: "0", period: "", subject_id: "", teacher_id: "", label: "", room_id: "", is_double: false });
  const [managing, setManaging]   = useState<number | null>(null);
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const [copyNote, setCopyNote]   = useState<string | null>(null);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);

  const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);
  const classPeriods = [...new Map(periods.filter((p) => p.type === "class").map((p) => [p.period_num, p])).values()]
    .sort((a, b) => a.period_num - b.period_num);

  // Only "start"/single slots make a row — the continuation half is hidden.
  const allElectives = slots.filter((s) => s.is_elective && !s.is_double_cont);
  const [q, setQ] = useState("");
  const gName = (id: number) => flat.find((g) => g.id === id)?.name ?? String(id);

  // Show "คาบ 3 + คาบ 4" for a double, or the single label otherwise.
  const periodRange = (s: typeof slots[number]) => {
    if (s.double_group_key) {
      const partner = slots.find((x) => x.double_group_key === s.double_group_key && x.id !== s.id);
      if (partner) {
        const [a, b] = [s.period, partner.period].sort((x, y) => x - y);
        return `${periodLabel(a, periods)} + ${periodLabel(b, periods)}`;
      }
    }
    return periodLabel(s.period, periods);
  };

  // The period dropdown: a double needs a following class period to exist.
  const periodOptions = form.is_double ? classPeriods.slice(0, -1) : classPeriods;

  const chosenTeacher = teachers.find((t) => t.id === Number(form.teacher_id));
  const suggestedRoomId = chosenTeacher?.fixed_room_id ?? null;

  const handleCreate = async () => {
    await api.createElectiveSlot({
      group_id: Number(form.group_id),
      day: Number(form.day),
      period: Number(form.period),
      subject_id: Number(form.subject_id),
      teacher_id: Number(form.teacher_id),
      label: form.label || undefined,
      room_id: form.room_id ? Number(form.room_id) : suggestedRoomId,
      is_double: form.is_double,
    });
    // Reload so double-period electives pull in both linked halves.
    await loadSlots();
    setForm({ group_id: "", day: "0", period: "", subject_id: "", teacher_id: "", label: "", room_id: "", is_double: false });
  };

  const handleDelete = async (id: number) => {
    await api.deleteSlot(id);
    await loadSlots();   // backend removes both halves of a double — resync
  };

  const handleCopy = async (id: number) => {
    if (copyTargets.length === 0) return;
    const r = await api.copyElectiveSlot(id, copyTargets);
    await loadSlots();
    setCopyingId(null);
    setCopyTargets([]);
    // Say which classes were left out, rather than letting them quietly not
    // appear — a class already teaching something then cannot take this too.
    setCopyNote(
      r.skipped.length === 0
        ? `คัดลอกไปแล้ว ${copyTargets.length} ห้อง`
        : `คัดลอกได้ ${r.created.length > 0 ? copyTargets.length - r.skipped.length : 0} ห้อง · `
          + `ข้าม ${r.skipped.length} ห้อง — `
          + r.skipped.map((s) => `${s.group_name ?? s.group_id} (${s.reason})`).join(", "),
    );
  };

  const electiveSlots = allElectives.filter((s) => matches(q, gName(s.group_id),
    s.subject_code, s.subject_name, s.teacher_name, s.room_name));
  const managingSlot = managing != null ? slots.find((s) => s.id === managing) ?? null : null;

  return (
    <>
    <Section title="คาบเสรี — ล็อกคาบก่อน แล้วค่อยใส่วิชา">
      <ElectivePoolPanel />
    </Section>

    <Section title="วิชาเสรีรายห้อง — คาบล็อกที่เลือกวิชา/ครูได้หลายตัวเลือก">
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4 text-xs text-purple-800 leading-relaxed">
        <strong>วิชาเสรีคืออะไร?</strong> คือคาบที่นักเรียนห้องเดียวกันเลือกเรียนได้หลายอย่าง (เช่น บางคนเรียนดนตรี บางคนเรียนศิลปะ) ในเวลาเดียวกัน
        <br/><strong>วิธีใช้:</strong> 1) สร้างคาบของห้องเรียน + ใส่ "วงแรก" (วิชา+ครู+ห้อง)  2) กด <span className="bg-white border border-purple-200 rounded px-1">🎓 จัดการวง</span> เพื่อเพิ่มวงอื่น  3) สลับวงที่ใช้ได้ตลอดจากในตาราง
        <br/>📌 คาบนี้จะถูก<strong>ล็อกอัตโนมัติ</strong> — ตัวจัดตารางจะไม่วางวิชาอื่นทับ
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="ห้องเรียน *">
          <select className={inputCls} value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
            <option value="">เลือกห้อง</option>
            {flat.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="วัน *">
          <select className={inputCls} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="คาบ *">
          <select className={inputCls} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
            <option value="">เลือกคาบ</option>
            {periodOptions.map((p) => <option key={p.period_num} value={p.period_num}>{p.label} ({p.start_time}–{p.end_time})</option>)}
          </select>
        </Field>
        <Field label="วิชา (วงแรก) *">
          <select className={inputCls} value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
            <option value="">เลือกวิชา</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
          </select>
        </Field>
        <Field label="ครูผู้สอน (วงแรก) *">
          <select className={inputCls} value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
            <option value="">เลือกครู</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="ห้องสอน">
          <select className={inputCls} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
            <option value="">{suggestedRoomId ? `🏠 ห้องประจำครู (${rooms.find((r) => r.id === suggestedRoomId)?.name ?? "-"})` : "– เลือกห้อง –"}</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="ชื่อวง">
          <input className={inputCls} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="เช่น วงดนตรี" />
        </Field>
      </div>

      {/* คาบคู่ toggle */}
      <label className="flex items-center gap-2 mb-3 text-sm text-gray-700 cursor-pointer w-fit bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
        <input
          type="checkbox"
          className="w-4 h-4 accent-purple-600"
          checked={form.is_double}
          onChange={(e) => {
            const on = e.target.checked;
            // If turning on a double but the chosen period is the last class period,
            // clear it — a double needs a following period.
            const lastNum = classPeriods[classPeriods.length - 1]?.period_num;
            const invalid = on && form.period !== "" && Number(form.period) === lastNum;
            setForm({ ...form, is_double: on, period: invalid ? "" : form.period });
          }}
        />
        <span>🔗 <strong>คาบคู่</strong> — จองต่อเนื่อง 2 คาบติดกัน (เช่น คาบ 3 + คาบ 4)</span>
      </label>
      <button
        onClick={handleCreate}
        disabled={!form.group_id || !form.period || !form.subject_id || !form.teacher_id}
        className={btnPrimary}
      >
        + สร้างวิชาเสรี
      </button>

      <div className="mt-4">
        <TableSearch value={q} onChange={setQ} count={electiveSlots.length} total={allElectives.length}
          placeholder="ค้นหาห้องเรียน / วิชา / ครู" />
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ห้องเรียน","วัน","คาบ","วงที่ใช้อยู่","ห้องสอน","จำนวนวง",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {electiveSlots.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีวิชาเสรี</td></tr>
            )}
            {electiveSlots.map((s) => (
              <React.Fragment key={s.id}>
                <tr className="hover:bg-purple-50/30">
                  <td className="px-3 py-2 font-medium text-purple-700">{gName(s.group_id)}</td>
                  <td className="px-3 py-2 text-gray-600">{DAYS[s.day]}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {periodRange(s)}
                    {s.double_group_key && (
                      <span className="ml-1 text-[10px] bg-purple-100 text-purple-700 border border-purple-200 px-1 py-0.5 rounded">🔗 คาบคู่</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{slotLabel(s)} · {s.teacher_name ?? `${s.elective_options?.length ?? 0} ตัวเลือก`}</td>
                  <td className="px-3 py-2 text-gray-600">{s.room_name ?? <span className="text-gray-400">–</span>}</td>
                  <td className="px-3 py-2 text-center text-gray-500">{s.elective_options?.length ?? 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setManaging(s.id)} className="px-2 py-1 text-xs bg-purple-50 text-purple-600 rounded hover:bg-purple-100 border border-purple-200">🎓 จัดการวง</button>
                      <button onClick={() => { setCopyingId(s.id); setCopyTargets([]); }} className={btnEdit}>📋 คัดลอก</button>
                      <button onClick={() => handleDelete(s.id)} className={btnDanger}>ลบ</button>
                    </div>
                  </td>
                </tr>
                {copyingId === s.id && (
                  <tr className="bg-gray-50">
                    <td colSpan={7} className="px-3 py-3">
                      <p className="text-xs font-semibold text-gray-600 mb-2">คัดลอกวิชาเสรีนี้ (พร้อมทุกวง) ไปยังห้องเรียนอื่น — เวลาเดิม ({DAYS[s.day]} {periodRange(s)}):</p>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {flat.filter((g) => g.id !== s.group_id).map((g) => (
                          <label key={g.id} className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded px-2 py-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={copyTargets.includes(g.id)}
                              onChange={(e) => setCopyTargets(e.target.checked ? [...copyTargets, g.id] : copyTargets.filter((id) => id !== g.id))}
                            />
                            {g.name}
                          </label>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleCopy(s.id)} disabled={copyTargets.length === 0} className={btnSave}>คัดลอก ({copyTargets.length})</button>
                        <button onClick={() => { setCopyingId(null); setCopyTargets([]); }} className={btnCancel}>ยกเลิก</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {managingSlot && (
        <ElectiveOptionModal slot={managingSlot} onClose={() => setManaging(null)} />
      )}
      {copyNote && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md bg-white border border-purple-300 shadow-lg rounded-lg px-4 py-3 text-xs text-gray-800">
          <div className="flex items-start gap-2">
            <span className="flex-1">{copyNote}</span>
            <button onClick={() => setCopyNote(null)} className="text-gray-400 hover:text-gray-700">✕</button>
          </div>
        </div>
      )}
    </Section>
    </>
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


/**
 * What each level's week adds up to.
 *
 * When ม.ต้น and ม.ปลาย eat at different times they get different numbers of
 * lesson periods, and a class assigned more periods than its level has simply
 * cannot be timetabled. That was invisible until the generator failed, so it
 * is stated here, next to the setting that causes it.
 */
const LevelDaySummary: React.FC<{ periods: Period[] }> = ({ periods }) => {
  const { groups, requirements } = useTimetableStore();

  const rows = (["lower", "upper"] as const).map((lvl) => {
    const nums = classPeriodsForLevel(periods, lvl);
    const perWeek = nums.length * 5;
    const classes = flattenGroups(groups).filter((g) => levelKeyOf(g) === lvl);
    const over = classes
      .map((g) => {
        const load = requirements
          .filter((r) => r.group_id === g.id)
          .reduce((n, r) => n + (r.weekly_count ?? 0), 0);
        return { name: g.name, load };
      })
      .filter((x) => x.load > perWeek)
      .sort((a, b) => b.load - a.load);
    return { lvl, nums, perWeek, total: classes.length, over };
  });

  return (
    <div className="grid grid-cols-2 gap-3 mb-4">
      {rows.map(({ lvl, nums, perWeek, total, over }) => (
        <div key={lvl} className={clsx("border rounded-lg p-3",
          over.length > 0 ? "border-red-300 bg-red-50/50" : "border-gray-200 bg-white")}>
          <p className="text-sm font-bold text-gray-800">
            {levelLabel(lvl)} <span className="text-xs font-normal text-gray-500">({total} ห้อง)</span>
          </p>
          <p className="text-xs text-gray-600 mt-1">
            คาบเรียน {nums.length} คาบ/วัน = <strong>{perWeek} คาบ/สัปดาห์</strong>
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            คาบที่เรียนได้: {nums.join(", ") || "—"}
          </p>
          {over.length > 0 ? (
            <p className="text-[11px] text-red-700 mt-1.5 leading-relaxed">
              ⚠ มี {over.length} ห้องที่ถูกจัดวิชาเกินจำนวนคาบที่มี เช่น{" "}
              {over.slice(0, 3).map((x) => `${x.name} (${x.load})`).join(", ")}
              {over.length > 3 && " …"}
              <br />แก้ได้โดยเพิ่มคาบเรียนให้ระดับนี้ หรือลดคาบ/สัปดาห์ของวิชา
            </p>
          ) : (
            <p className="text-[11px] text-emerald-700 mt-1.5">✓ ทุกห้องมีคาบพอ</p>
          )}
        </div>
      ))}
    </div>
  );
};

/** "08:50" + 50 → "09:40". Used to prefill the next period's times. */
function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (h * 60 + m + mins + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

const PeriodsPanel: React.FC = () => {
  const { periods, loadAll } = useTimetableStore();
  const [form, setForm] = useState({
    label: "",
    start_time: "08:00",
    end_time: "08:50",
    type: "class" as PeriodType,
    applies_to: "all" as "all"|"lower"|"upper",
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.fetchPeriodPlan>> | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshPlan = () => api.fetchPeriodPlan().then(setPlan).catch(() => setPlan(null));
  useEffect(() => { refreshPlan(); }, [periods]);

  const handleCreate = async () => {
    // No period number to type: the server works it out from the time, so a
    // new row cannot land on a number that already means something else.
    const created = await api.createPeriod({ ...form, auto_number: true } as Partial<Period>);
    useTimetableStore.setState((s) => ({ periods: [...s.periods, created] }));
    const len = Math.max(10, Math.abs(
      Number(form.end_time.split(":")[0]) * 60 + Number(form.end_time.split(":")[1])
      - Number(form.start_time.split(":")[0]) * 60 - Number(form.start_time.split(":")[1])));
    setForm({ label: "", start_time: form.end_time, end_time: addMinutes(form.end_time, len),
      type: "class", applies_to: "all" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updatePeriod(id, editForm);
    useTimetableStore.setState((s) => ({ periods: s.periods.map((p) => p.id === id ? { ...p, ...updated } : p) }));
    setEditing(null);
    setEditForm(null);
  };

  const doRenumber = async () => {
    setBusy(true);
    try {
      await api.renumberPeriods();
      await loadAll();       // slot period numbers moved with the columns
      await refreshPlan();
    } finally { setBusy(false); }
  };

  // Ordered by the clock, which is the order they actually happen in — sorting
  // by the stored number showed them out of sequence whenever it had drifted.
  const sortedPeriods = [...periods].sort((a, b) =>
    (a.start_time ?? "").localeCompare(b.start_time ?? "")
    || (a.end_time ?? "").localeCompare(b.end_time ?? "")
    || a.period_num - b.period_num);

  return (
    <Section title="จัดการคาบเรียนและเวลา">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
        <strong>คำอธิบาย:</strong> กำหนดเวลาเริ่ม-สิ้นสุดของแต่ละคาบ และประเภทคาบ (เรียน/พัก/กินข้าว)
        <br/>คาบที่เป็น <strong>พัก/กินข้าว/เคารพธง/โฮมรูม</strong> จะแสดงเป็น "คาบว่าง" และระบบจะไม่จัดวิชาทับ
        <br/>ช่อง <strong>"ใช้กับ"</strong> ให้ตั้งเป็น ม.1-3 หรือ ม.4-6 ได้ เมื่อสองระดับพักกินข้าวไม่ตรงกัน
        — ระบบจะจัดตารางตามวันของแต่ละระดับแยกกัน และกันครูตาม<strong>เวลาจริง</strong>
        ไม่ใช่ตามเลขคาบ (คาบ 5 ของ ม.ต้นกับ ม.ปลายคนละเวลากัน)
      </div>

      <LevelDaySummary periods={periods} />

      {/* ── เลขคาบและรูปร่างของวัน ───────────────────────────────────────── */}
      {plan && (
        <div className={clsx("border rounded-lg mb-4 overflow-hidden",
          plan.needs_renumber ? "border-amber-300" : "border-gray-200")}>
          <div className={clsx("px-4 py-3 flex items-start gap-3 flex-wrap",
            plan.needs_renumber ? "bg-amber-50" : "bg-gray-50")}>
            <div className="flex-1 min-w-[260px]">
              <p className="text-sm font-bold text-gray-800">🔢 เลขคาบ</p>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                เลขคาบเป็นแค่<strong>ลำดับคอลัมน์</strong>ในตาราง ไม่ต้องกรอกเอง —
                ระบบเรียงให้จากเวลาเริ่ม คาบที่เวลาเดียวกันแต่คนละระดับจะใช้เลขเดียวกัน
                {plan.needs_renumber
                  ? <> · ตอนนี้เลข<strong className="text-amber-800">ไม่เรียงกัน</strong> ({plan.moves.length} แถวต้องย้าย)</>
                  : <> · ตอนนี้<strong className="text-emerald-700">เรียงถูกต้องแล้ว</strong></>}
              </p>
            </div>
            {plan.needs_renumber && (
              <button onClick={doRenumber} disabled={busy}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-40 shrink-0">
                {busy ? "กำลังจัด…" : "จัดเลขคาบใหม่"}
              </button>
            )}
          </div>

          {plan.needs_renumber && (
            <div className="px-4 py-2 bg-white border-t border-amber-200">
              <p className="text-[11px] text-gray-500 mb-1">
                จะเปลี่ยนเป็น (คาบที่จัดไว้ในตารางจะย้ายตามไปด้วย เวลาเรียนจริงไม่เปลี่ยน):
              </p>
              <div className="flex flex-wrap gap-1">
                {plan.moves.map((m) => (
                  <span key={m.id} className="text-[11px] bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                    {m.label}: <span className="text-gray-400">{m.from}</span> → <strong>{m.to}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {plan.issues.filter((i) => i.kind !== "capacity").length > 0 && (
            <div className="px-4 py-2.5 bg-white border-t border-gray-100 space-y-1">
              <p className="text-[11px] font-semibold text-gray-500">ช่องว่าง / เวลาทับกันในวัน</p>
              {plan.issues.filter((i) => i.kind !== "capacity").map((i, n) => (
                <p key={n} className={clsx("text-[11px]",
                  i.kind === "overlap" || i.kind === "duplicate" ? "text-red-700" : "text-amber-700")}>
                  {i.kind === "gap" ? "⏳" : "⚠"} {i.text}
                </p>
              ))}
              <p className="text-[10px] text-gray-400 pt-0.5">
                ช่องว่างไม่ใช่ความผิดเสมอไป (เช่น เวลาเดินเปลี่ยนห้อง) แต่ช่องว่างยาวๆ
                มักแปลว่าลืมใส่คาบเรียนของระดับนั้น
              </p>
            </div>
          )}
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
        <p className="text-xs font-semibold text-gray-600 mb-3">➕ เพิ่มคาบใหม่</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
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
              {["เลขคาบ (อัตโนมัติ)","ชื่อ","ประเภท","เริ่ม","สิ้นสุด","ใช้กับ",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedPeriods.map((p) => (
              <tr key={p.id} className={clsx("hover:bg-gray-50", p.type !== "class" && "bg-orange-50/30")}>
                {editing === p.id && editForm ? (
                  <>
                    <td className="px-2 py-1 text-xs text-gray-400" title="เลขคาบมาจากเวลา ไม่ต้องกรอก">
                      {p.period_num}
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
                      <button onClick={() => { setEditing(p.id); setEditForm({ label: p.label, start_time: p.start_time, end_time: p.end_time, type: p.type, applies_to: p.applies_to }); }}
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
                    <td className="px-3 py-1.5">{periodLabel(s.period, periods)}</td>
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
  const { departments, teachers } = useTimetableStore();
  const [codesFor, setCodesFor] = useState<number | null>(null);
  const countOf = (id: number) => teachers.filter((t) => t.department_id === id).length;
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
        <br />
        🔢 <strong>รหัสประจำตัวครู</strong> — กดปุ่มรหัสครูของแต่ละกลุ่มสาระ
        ตั้งรหัสเริ่มต้นได้ (เช่น ภาษาไทยเริ่ม 101) แล้ว<strong>ลากชื่อครูขึ้นลง</strong>เพื่อจัดลำดับ
        รหัสจะไล่เลขท้ายให้เอง 101, 102, 103 …
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
              {["#","ชื่อกลุ่มสาระฯ","🔢 รหัสประจำตัวครู",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {departments.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {departments.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                {editing === d.id && editForm ? (
                  <>
                    <td className="px-3 py-2 text-gray-400 text-xs">{d.id}</td>
                    <td className="px-2 py-1"><input className={inlineCls} value={editForm.name} onChange={(e) => setEditForm({ name: e.target.value })} /></td>
                    <td className="px-2 py-1 text-[11px] text-gray-400">แก้ที่ปุ่ม 🔢</td>
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
                      <button onClick={() => setCodesFor(d.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100 whitespace-nowrap">
                        🔢
                        <span className="font-mono font-bold">
                          {d.code_base ?? 101}–{(d.code_base ?? 101) + Math.max(0, countOf(d.id) - 1)}
                        </span>
                        <span className="text-emerald-600">· ครู {countOf(d.id)} คน</span>
                      </button>
                    </td>
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

      {codesFor != null && (
        <DeptTeacherCodesModal
          department={departments.find((d) => d.id === codesFor)!}
          onClose={() => setCodesFor(null)}
        />
      )}
    </Section>
  );
};

// ─── Analytics / Audit Dashboard ─────────────────────────────────────────────
const AnalyticsPanel: React.FC = () => {
  const { slots, teachers, requirements, subjects, departments, groups } = useTimetableStore();

  // ── Compute stats ────────────────────────────────────────────────────────
  // Teacher slots per day
  const teacherStats = teachers.map((t) => {
    const tSlots = slots.filter((s) => teachesSlot(s, t.id));
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

  const [tq, setTq] = useState("");
  const shownStats = teacherStats.filter(({ teacher }) => matches(tq, teacher.name, teacher.code));

  // Requirement coverage
  const totalReq  = requirements.reduce((s, r) => s + r.weekly_count, 0);
  const filledReq = slots.length;
  const coverPct  = totalReq > 0 ? Math.round((filledReq / totalReq) * 100) : 0;

  // Subject dept distribution
  const deptSlots = departments.map((d) => {
    const dSubIds = subjects.filter((s) => s.department_id === d.id).map((s) => s.id);
    // A shared elective window has no single subject, so it counts for no
    // department — its students are spread across several at once.
    const count   = slots.filter((s) => s.subject_id != null && dSubIds.includes(s.subject_id)).length;
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
          <div className="px-3 pt-3">
            <TableSearch value={tq} onChange={setTq} count={shownStats.length} total={teacherStats.length}
              placeholder="ค้นหาชื่อครู / รหัสครู" />
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
              {shownStats.map(({ teacher: t, total, maxDay, maxConsec, outdoorCount }) => (
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
  const { schoolConfig, setSchoolConfig, loadAll } = useTimetableStore();
  const [saved, setSaved]   = useState(false);
  const [busy, setBusy]     = useState<string | null>(null);
  const [note, setNote]     = useState<string | null>(null);
  const [info, setInfo]     = useState<Awaited<ReturnType<typeof api.fetchStateInfo>> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.fetchStateInfo().then(setInfo).catch(() => setInfo(null)); }, []);

  const handle = (key: string, val: string) => {
    setSchoolConfig({ [key]: val });
    setSaved(false);
  };

  /** Read the crest as a data URL so it travels inside the backup file. */
  const pickLogo = async (file: File) => {
    if (file.size > 400_000) {
      setNote("ไฟล์โลโก้ใหญ่เกิน 400KB — ขอไฟล์เล็กกว่านี้ (ย่อรูปก่อน)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => handle("logoUrl", String(reader.result));
    reader.readAsDataURL(file);
  };

  const doBackup = async () => {
    setBusy("backup"); setNote(null);
    try {
      const data = await api.downloadBackup();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ตารางเรียน-สำรองข้อมูล-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNote("ดาวน์โหลดไฟล์สำรองแล้ว — เก็บไฟล์นี้ไว้ ถ้าข้อมูลหายให้กู้คืนจากไฟล์นี้");
    } catch {
      setNote("ดาวน์โหลดไม่สำเร็จ");
    } finally { setBusy(null); }
  };

  const doRestore = async (file: File) => {
    setBusy("restore"); setNote(null);
    try {
      const data = JSON.parse(await file.text());
      const r = await api.restoreBackup(data);
      await loadAll();
      setInfo(await api.fetchStateInfo().catch(() => info));
      setNote(
        `กู้คืนแล้ว — ห้องเรียน ${r.restored.groups ?? 0} · ครู ${r.restored.teachers ?? 0} · `
        + `วิชา ${r.restored.subjects ?? 0} · คาบในตาราง ${r.restored.slots ?? 0}`
        + (r.saved_at ? ` (ข้อมูลของวันที่ ${r.saved_at.replace("T", " ")})` : ""),
      );
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNote(d ?? "กู้คืนไม่สำเร็จ — ไฟล์อาจไม่ใช่ไฟล์สำรองของระบบ");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
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
          <Field label="รองผู้อำนวยการกลุ่มบริหารวิชาการ">
            <input
              className={inputCls}
              value={schoolConfig.deputyName ?? ""}
              onChange={(e) => handle("deputyName", e.target.value)}
              placeholder="นางสาวสมหญิง ขยัน"
            />
          </Field>
        </div>

        {/* โลโก้โรงเรียน */}
        <div className="border-t border-gray-100 pt-4 mb-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">โลโก้โรงเรียน (แสดงบนหัวตารางที่พิมพ์)</p>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 shrink-0 overflow-hidden">
              {schoolConfig.logoUrl
                ? <img src={schoolConfig.logoUrl} alt="โลโก้" className="w-full h-full object-contain" />
                : <span className="text-2xl text-gray-300">🏫</span>}
            </div>
            <div className="flex-1">
              <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickLogo(f); }} />
              <div className="flex gap-2">
                <button onClick={() => logoRef.current?.click()}
                  className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100">
                  {schoolConfig.logoUrl ? "เปลี่ยนรูป" : "เลือกไฟล์รูป"}
                </button>
                {schoolConfig.logoUrl && (
                  <button onClick={() => handle("logoUrl", "")}
                    className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">
                    เอาออก
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                PNG / JPG / SVG · ไม่เกิน 400KB · ไฟล์จะถูกเก็บไว้ในระบบและติดไปกับไฟล์สำรองข้อมูลด้วย
              </p>
            </div>
          </div>
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
        <div className="bg-white border rounded p-3 flex items-center gap-3">
          {schoolConfig.logoUrl && (
            <img src={schoolConfig.logoUrl} alt="" className="w-12 h-12 object-contain shrink-0" />
          )}
          <div className="flex-1 text-center">
            <div className="text-sm font-bold">ตารางสอน 001  รหัส T001  นายสมชาย ใจดี</div>
            <div className="text-xs text-gray-600 mt-1">
              ภาคเรียนที่ {schoolConfig.term}/{schoolConfig.year}  โรงเรียน{schoolConfig.schoolName || "…"}
            </div>
          </div>
        </div>
      </div>

      {/* ── สำรองและกู้คืนข้อมูล ──────────────────────────────────────────── */}
      <div className="mt-5 border-2 border-amber-300 rounded-lg overflow-hidden">
        <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
          <p className="text-sm font-bold text-amber-900">💾 สำรองและกู้คืนข้อมูล</p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            เซิร์ฟเวอร์ที่ใช้อยู่เป็นแบบฟรี <strong>ข้อมูลจะถูกล้างทุกครั้งที่อัปเดตระบบ</strong>
            และเมื่อไม่มีคนใช้งานนานๆ ระบบจะบันทึกข้อมูลลงเครื่องให้เองหลังการแก้ไขทุกครั้ง
            แต่เอาไม่อยู่ตอนอัปเดตระบบ
            <br />
            <strong>ก่อนให้ผมอัปเดตระบบ กดดาวน์โหลดไฟล์สำรองเก็บไว้ก่อนทุกครั้ง</strong>
            แล้วค่อยกู้คืนทีหลัง หรือส่งไฟล์นั้นมาให้ผมใส่กลับเข้าไปเป็นข้อมูลตั้งต้นก็ได้
          </p>
        </div>

        <div className="p-4 space-y-3 bg-white">
          {info && (
            <div className="text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>ข้อมูลตอนนี้:</span>
              <span>ห้องเรียน <strong>{info.counts.groups}</strong></span>
              <span>ครู <strong>{info.counts.teachers}</strong></span>
              <span>วิชา <strong>{info.counts.subjects}</strong></span>
              <span>ห้องสอน <strong>{info.counts.rooms}</strong></span>
              <span>คาบในตาราง <strong>{info.counts.slots}</strong></span>
              <span className={info.source === "snapshot" ? "text-green-700" : "text-amber-700"}>
                {info.source === "snapshot" ? "· กำลังใช้ข้อมูลที่แก้ไขไว้"
                  : "· กำลังใช้ข้อมูลตั้งต้น (ยังไม่เคยแก้ หรือเพิ่งอัปเดตระบบ)"}
              </span>
            </div>
          )}

          {/* Where the data is actually being kept. A database that was set up
              but cannot be reached keeps the site working off the file, and
              without saying so that failure looks exactly like success until
              the next restart throws the work away again. */}
          {info && (
            <div className="text-xs rounded-lg px-3 py-2 border"
              style={{
                background: info.store === "postgres" ? "#ecfdf5"
                  : info.store_configured ? "#fef2f2" : "#fffbeb",
                borderColor: info.store === "postgres" ? "#a7f3d0"
                  : info.store_configured ? "#fecaca" : "#fde68a",
              }}>
              {info.store === "postgres" ? (
                <span className="text-emerald-900">
                  ✅ <strong>ข้อมูลเก็บในฐานข้อมูลถาวรแล้ว</strong> — ไม่หายเวลาเซิร์ฟเวอร์รีสตาร์ท
                  {info.last_saved_at
                    ? ` · บันทึกล่าสุด ${localTime(info.last_saved_at)}`
                    : " · ยังไม่มีการบันทึกหลังเปิดเครื่องนี้"}
                </span>
              ) : info.store_configured ? (
                <span className="text-red-800">
                  ⚠️ <strong>ตั้งค่าฐานข้อมูลไว้ แต่ต่อไม่ได้</strong> ระบบกำลังเก็บลงไฟล์ชั่วคราว
                  ซึ่ง<strong>จะหายเมื่อเซิร์ฟเวอร์รีสตาร์ท</strong> — กรุณาตรวจค่า DATABASE_URL ใน Render
                  {info.store_error ? <><br /><span className="font-mono text-[10px]">{info.store_error}</span></> : null}
                </span>
              ) : (
                <span className="text-amber-900">
                  ⚠️ <strong>ยังไม่ได้ตั้งค่าฐานข้อมูลถาวร</strong> — ข้อมูลเก็บลงไฟล์บนเซิร์ฟเวอร์
                  และจะหายทุกครั้งที่เซิร์ฟเวอร์รีสตาร์ท
                </span>
              )}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <button onClick={doBackup} disabled={busy !== null}
              className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-40">
              {busy === "backup" ? "กำลังเตรียมไฟล์…" : "⬇ ดาวน์โหลดไฟล์สำรองข้อมูล"}
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) doRestore(f); }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy !== null}
              className="px-4 py-2 text-sm border border-amber-400 text-amber-800 rounded-lg font-semibold hover:bg-amber-50 disabled:opacity-40">
              {busy === "restore" ? "กำลังกู้คืน…" : "⬆ กู้คืนจากไฟล์สำรอง"}
            </button>
          </div>

          {note && (
            <p className="text-xs bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-3 py-2">{note}</p>
          )}
          <p className="text-[11px] text-gray-400">
            ไฟล์สำรองมีครบทุกอย่าง — ห้องเรียน ครู วิชา ห้องสอน การสอน คาบเสรี ตารางที่จัดไว้
            ตั้งค่าโรงเรียน และโลโก้ · การกู้คืนจะ<strong>แทนที่ข้อมูลทั้งหมด</strong>ที่มีอยู่ตอนนี้
          </p>

          {/* จุดบันทึกในเครื่อง — the one-click copy that a server restart
              cannot reach, since the server has no permanent disk. */}
          <div className="pt-3 mt-1 border-t border-amber-200">
            <p className="text-sm font-bold text-emerald-900 mb-2">
              ⭐ จุดบันทึก (เซฟหลัก) — กดปุ่มเดียวกลับมาได้
            </p>
            <SavePointPanel onRestored={async () => {
              await loadAll();
              setInfo(await api.fetchStateInfo().catch(() => info));
            }} />
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
