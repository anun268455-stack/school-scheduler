/**
 * Dashboard v4 – Full CRUD with inline edit for all entities + Periods + Bulk Lock + Import
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useTimetableStore } from "../store/timetableStore";
import type { SubjectType, PeriodType, Room, Period, StudentGroup, Subject, LessonRequirement, ElectivePool } from "../types";
import { DAYS, periodLabel } from "../types";
import * as api from "../api/client";
import { ImportModal } from "../components/import/ImportModal";
import { ElectiveOptionModal } from "../components/timetable/ElectiveOptionModal";
import { ElectivePoolPanel } from "../components/timetable/ElectivePoolPanel";
import { RoomSettingsModal } from "../components/rooms/RoomSettingsModal";
import { AddElectiveSubjectModal } from "../components/timetable/AddElectiveSubjectModal";
import { slotsForTeacher, teachingTogether } from "../utils/teacherSlots";
import { levelKeyOf, levelLabel, classPeriodsForLevel, roomReservedFor } from "../utils/levels";
import { flattenGroups } from "../utils/groupHierarchy";
import type { StayChoice } from "../utils/stayHome";
import { stayChoiceOf, stayPatch, stayAfterSave } from "../utils/stayHome";
import { inOrder, moveBy } from "../utils/yardPicks";
import { byTeacherCode } from "../utils/teacherOrder";
import { SavePointPanel } from "../components/backup/SavePointPanel";
import { ServerHistoryPanel } from "../components/backup/ServerHistoryPanel";
import { clashesByRequirement } from "../utils/teachingConflicts";
import { findSubjectDuplicates } from "../utils/duplicateCheck";
import { indexRequirements, partnerOf, mismatchedPairs, autoPairable, coTeachingPairs } from "../utils/coTeaching";
import { SubjectAssignModal } from "../components/timetable/SubjectAssignModal";
import { SubjectRoomsModal } from "../components/timetable/SubjectRoomsModal";
import { SubgroupSetModal } from "../components/timetable/SubgroupSetModal";
import { auditAll } from "../utils/subgroupAudit";
import { groupElectiveSlots } from "../utils/electiveGroups";
import { electiveSubjectIds, teacherLoads, groupLoads } from "../utils/teachingLoad";
import { coverageProblems } from "../utils/electiveCoverage";
import { HomeroomModal } from "../components/groups/HomeroomModal";
import { HomeroomImportModal } from "../components/groups/HomeroomImportModal";
import { ClassSubjectsModal } from "../components/groups/ClassSubjectsModal";
import { DeptTeacherCodesModal } from "../components/departments/DeptTeacherCodesModal";
import {
  classesAdvisedBy, HOMEROOM_MAX,
  effectiveHomeroomNames, inheritsHomeroom,
} from "../utils/homeroom";
import { TeacherAssignModal } from "../components/timetable/TeacherAssignModal";
import { TeacherSettingsModal } from "../components/teachers/TeacherSettingsModal";
import { TeacherHandoverModal } from "../components/teachers/TeacherHandoverModal";
import { LevelActivityPanel } from "../components/timetable/LevelActivityPanel";
import { CurriculumPanel } from "../components/curriculum/CurriculumPanel";
import { SearchableSelect, teacherOptions, roomOptions, groupOptions, subjectOptions } from "../components/common/SearchableSelect";
import { TableSearch, matches } from "../components/common/TableSearch";

export type DashPage =
  | "groups" | "teachers" | "subjects" | "rooms" | "yards"
  | "requirements" | "curriculum" | "electives" | "activities" | "periods" | "locks" | "settings"
  | "departments" | "analytics" | "help";

export const Dashboard: React.FC<{ page: DashPage }> = ({ page }) => {
  const pageMap: Record<DashPage, React.ReactNode> = {
    groups:       <GroupsPanel />,
    teachers:     <TeachersPanel />,
    subjects:     <SubjectsPanel />,
    rooms:        <RoomsPanel />,
    yards:        <YardOrderPanel />,
    requirements: <RequirementsPanel />,
    curriculum:   <CurriculumPanel />,
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

const STAY_CHOICES: { v: StayChoice; label: string; note: string | null }[] = [
  { v: "",    label: "ยังไม่ได้ระบุ",
    note: "ถ้ามีห้องที่กันไว้ให้ห้องเรียนนี้ ก็จะอยู่ห้องนั้น ถ้าไม่มีก็เดินไปห้องพิเศษได้ตามปกติ" },
  { v: "yes", label: "เรียนห้องประจำเท่านั้น", note: null },
  { v: "no",  label: "ไม่บังคับ",
    note: "เดินไปห้องพิเศษได้ตามปกติ แม้จะมีห้องที่กันไว้ให้ห้องเรียนนี้" },
];

/**
 * เรียนที่ห้องประจำเท่านั้น (ห้องเพชร) — the one control for `stay_in_homeroom`.
 *
 * Three answers, all visible, because "not said" is not "no": a class nobody
 * has ticked may still be held in its room by having its name on that room.
 * And the caution for a class with no ห้องประจำชั้น, which has no room to be
 * held to — a tick there would look like a rule and be nothing.
 */
function StayHomeBox({ name, value, hasRoom, onChange }: {
  /** Radio group name — one per box on the page, or the boxes share an answer. */
  name: string; value: StayChoice; hasRoom: boolean; onChange: (v: StayChoice) => void;
}) {
  const note = STAY_CHOICES.find((c) => c.v === value)?.note;
  return (
    <div className="text-xs">
      <div className="font-medium text-gray-800">เรียนที่ห้องประจำเท่านั้น (ห้องเพชร)</div>
      <div className="text-gray-500">
        ทุกคาบของห้องนี้จะถูกจัดลงห้องประจำ ยกเว้นวิชาที่มีห้องเรียนพิเศษของตัวเอง เช่น ห้องคอม ห้องนาฏศิลป์
      </div>
      <div role="radiogroup" aria-label="เรียนที่ห้องประจำเท่านั้น (ห้องเพชร)" className="mt-1.5 flex flex-wrap gap-1.5">
        {STAY_CHOICES.map((c) => (
          <label key={c.v || "unset"}
            className={clsx("flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer focus-within:ring-1 focus-within:ring-indigo-500",
              value === c.v
                ? c.v === "yes" ? "bg-indigo-100 border-indigo-400 text-indigo-800 font-medium"
                  : "bg-gray-200 border-gray-400 text-gray-800 font-medium"
                : "bg-white border-gray-200 text-gray-500 hover:border-indigo-300")}>
            <input type="radio" name={name} className="accent-indigo-600"
              checked={value === c.v} onChange={() => onChange(c.v)} />
            {c.label}
          </label>
        ))}
      </div>
      {note && <div className="mt-1 text-gray-500">{note}</div>}
      {value === "yes" && !hasRoom && (
        <p role="alert" className="mt-1 text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          ⚠ ห้องนี้ยังไม่ได้เลือกห้องประจำชั้น จึงไม่มีห้องให้อยู่ — ตั้งไว้ก็ยังไม่มีผล ให้เลือก "ห้องประจำชั้น" ก่อน
        </p>
      )}
    </div>
  );
}

const GroupsPanel: React.FC = () => {
  const { groups, rooms, teachers, requirements, subjects, slots, periods } = useTimetableStore();
  const [homeroomFor, setHomeroomFor] = useState<number | null>(null);
  // ตรวจรายวิชารายห้อง — read live off the plan when a row is clicked.
  const [auditFor, setAuditFor] = useState<number | null>(null);
  const [auditPools, setAuditPools] = useState<ElectivePool[]>([]);
  useEffect(() => {
    if (auditFor != null && auditPools.length === 0) {
      api.fetchElectivePools().then(setAuditPools).catch(() => setAuditPools([]));
    }
  }, [auditFor, auditPools.length]);

  /** ปกติ → ไม่ออกลาน → ออกลานได้ → ปกติ */
  const toggleGroupYard = async (g: StudentGroup) => {
    const next = g.allow_outdoor == null ? false : g.allow_outdoor === false ? true : null;
    const updated = await api.updateGroup(g.id, { allow_outdoor: next });
    useTimetableStore.setState((st) => ({
      groups: st.groups.map((x) =>
        x.id === g.id
          ? { ...x, ...updated, children: x.children ?? [] }
          : { ...x, children: (x.children ?? []).map((c) => c.id === g.id ? { ...c, ...updated } : c) }),
    }));
  };
  const [importingHomeroom, setImportingHomeroom] = useState(false);
  const [form, setForm] = useState({ name: "", level: "M1", size: 40, parent_id: "", homeroom_room_id: "", homeroom_teacher_id: "", stay_in_homeroom: "" as StayChoice });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);
  // A 400 here is the server saying why in Thai; keep it where the person is
  // looking (under the add button / under the row being edited).
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [editErr, setEditErr]     = useState<string | null>(null);

  const handleCreate = async () => {
    setCreateErr(null);
    try {
      const created = await api.createGroup({
        name: form.name, level: form.level || null,
        size: form.size,
        parent_id: form.parent_id ? Number(form.parent_id) : null,
        homeroom_room_id: form.homeroom_room_id ? Number(form.homeroom_room_id) : null,
        homeroom_teacher_id: form.homeroom_teacher_id ? Number(form.homeroom_teacher_id) : null,
        // Left unsaid, nothing is sent: the server keeps its own default.
        ...stayPatch(form.stay_in_homeroom, null),
      });
      useTimetableStore.setState((s) => ({ groups: [...s.groups, { ...created, children: created.children ?? [] }] }));
      setForm({ name: "", level: "M1", size: 40, parent_id: "", homeroom_room_id: "", homeroom_teacher_id: "", stay_in_homeroom: "" as StayChoice });
    } catch (e) {
      setCreateErr(api.errorDetail(e, "เพิ่มห้องเรียนไม่สำเร็จ — ลองใหม่อีกครั้ง"));
    }
  };

  const handleUpdate = async (g: StudentGroup) => {
    if (!editForm) return;
    const id = g.id;
    setEditErr(null);
    try {
      const updated = await api.updateGroup(id, {
        name: editForm.name, level: editForm.level || null,
        size: editForm.size,
        parent_id: editForm.parent_id ? Number(editForm.parent_id) : null,
        homeroom_room_id: editForm.homeroom_room_id ? Number(editForm.homeroom_room_id) : null,
        homeroom_teacher_id: editForm.homeroom_teacher_id ? Number(editForm.homeroom_teacher_id) : null,
        // Only when it was changed here: an untouched "ยังไม่ได้ระบุ" must not
        // become a false, which would switch off a class held by its room.
        ...stayPatch(editForm.stay_in_homeroom, g.stay_in_homeroom),
      });
      // The whole tree, not just its top: a sub-class is a row here too, and
      // its new badge has to appear without a reload.
      useTimetableStore.setState((s) => ({
        groups: patchGroupTree(s.groups, id, {
          ...updated, stay_in_homeroom: stayAfterSave(updated, editForm.stay_in_homeroom),
        }),
      }));
      setEditing(null); setEditForm(null);
    } catch (e) {
      setEditErr(api.errorDetail(e, "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง"));
    }
  };

  const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);
  const roomName = (id: number | null | undefined) => id ? (rooms.find((r) => r.id === id)?.name ?? "–") : "–";
  const [q, setQ] = useState("");
  const shownGroups = flat.filter((g) => matches(q, g.name, g.level, roomName(g.homeroom_room_id),
    teachers.find((t) => t.id === g.homeroom_teacher_id)?.name, g.stay_in_homeroom === true ? "ห้องเพชร" : g.stay_in_homeroom === false ? "เดินเรียน" : null));

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
        <div className="col-span-3">
          <StayHomeBox name="stay-new" value={form.stay_in_homeroom} hasRoom={!!form.homeroom_room_id}
            onChange={(v) => setForm({ ...form, stay_in_homeroom: v })} />
        </div>
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
      {createErr && (
        <div role="alert" className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {createErr}
        </div>
      )}

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
              <React.Fragment key={g.id}>
              <tr className={clsx("hover:bg-gray-50", g.level === "ห้องเวียน" && "bg-purple-50/40")}>
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
                        <button onClick={() => handleUpdate(g)} className={btnSave}>บันทึก</button>
                        <button onClick={() => { setEditing(null); setEditForm(null); setEditErr(null); }} className={btnCancel}>ยกเลิก</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {g.name}
                      {/* ห้องเพชร at a glance — the setting itself is changed in
                          แก้ไข, so it lives in one place. Amber when there is no
                          room to be held to: it is set, and does nothing.
                          "ยังไม่ได้ระบุ" shows nothing, as it always has. */}
                      {g.stay_in_homeroom === true && (
                        <span
                          title={g.homeroom_room_id
                            ? "เรียนที่ห้องประจำเท่านั้น — ทุกคาบจัดลงห้องประจำ ยกเว้นวิชาที่มีห้องเรียนพิเศษของตัวเอง"
                            : "ตั้งให้เรียนที่ห้องประจำเท่านั้นไว้ แต่ห้องนี้ยังไม่ได้เลือกห้องประจำชั้น จึงยังไม่มีผล"}
                          className={clsx("ml-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium align-middle",
                            g.homeroom_room_id ? "bg-indigo-100 text-indigo-700" : "bg-amber-100 text-amber-800")}>
                          {g.homeroom_room_id ? "💎 ห้องเพชร" : "⚠ ห้องเพชร · ไม่มีห้องประจำชั้น"}
                        </span>
                      )}
                      {g.stay_in_homeroom === false && (
                        <span title="ไม่บังคับ — เดินไปห้องพิเศษได้ตามปกติ แม้จะมีห้องที่กันไว้ให้ห้องเรียนนี้"
                          className="ml-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium align-middle bg-gray-200 text-gray-700">
                          🚶 เดินเรียน
                        </span>
                      )}
                    </td>
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
                          {effectiveHomeroomNames(g, flat, teachers).join(" · ") || "ยังไม่ได้ตั้ง"}
                          {inheritsHomeroom(g, flat) && effectiveHomeroomNames(g, flat, teachers).length > 0 && (
                            <span className="ml-1 text-[10px] text-gray-400">(ตามห้องแม่)</span>
                          )}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {/* เรียนที่ลานได้ไหม ทั้งห้องนี้.
                            Short of rooms, the school has to choose who goes
                            outside, and that is a decision about classes:
                            ห้องวิทย์-คณิต keep the classrooms. One tick here
                            beats setting it on every subject they take. */}
                        <button onClick={() => toggleGroupYard(g)}
                          title={g.allow_outdoor === false
                            ? "ห้องนี้ไม่ต้องออกลาน — กดเพื่อเปลี่ยน"
                            : g.allow_outdoor === true
                            ? "ห้องนี้ออกลานได้ถ้าห้องเต็ม — กดเพื่อเปลี่ยน"
                            : "ปกติ (ออกลานได้ถ้าห้องเต็ม) — กดเพื่อกันห้องนี้ไว้ในอาคาร"}
                          className={clsx("px-2 py-1 rounded border text-xs",
                            g.allow_outdoor === false ? "bg-gray-200 border-gray-400 text-gray-700"
                              : g.allow_outdoor === true ? "bg-green-50 border-green-300 text-green-700"
                              : "bg-white border-gray-200 text-gray-300 hover:border-green-400")}>
                          {g.allow_outdoor === false ? "🚫 ไม่ออกลาน" : "🌳"}
                        </button>
                        {/* ตรวจรายวิชา — the plan read a class at a time,
                            which is the only way วิชาซ้ำ and a week that
                            does not fit the week are visible at all. */}
                        <button onClick={() => setAuditFor(g.id)} className={btnEdit}
                          title="ตรวจรายวิชาของห้องนี้ — วิชาซ้ำ ครูที่ยังไม่มี คาบรวมเกินสัปดาห์">
                          📋 ตรวจวิชา
                        </button>
                        <button onClick={() => { setEditErr(null); setEditing(g.id); setEditForm({ name: g.name, level: g.level ?? "M1", size: g.size, parent_id: g.parent_id ? String(g.parent_id) : "", homeroom_room_id: g.homeroom_room_id ? String(g.homeroom_room_id) : "", homeroom_teacher_id: g.homeroom_teacher_id ? String(g.homeroom_teacher_id) : "", stay_in_homeroom: stayChoiceOf(g.stay_in_homeroom) }); }} className={btnEdit}>แก้ไข</button>
                        <button onClick={async () => { await api.deleteGroup(g.id); useTimetableStore.setState((s) => ({ groups: s.groups.filter((x) => x.id !== g.id) })); }} className={btnDanger}>ลบ</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
              {editing === g.id && editForm && (
                <tr className="bg-gray-50">
                  <td colSpan={7} className="px-3 py-2 space-y-2">
                    <StayHomeBox name={`stay-${g.id}`} value={editForm.stay_in_homeroom} hasRoom={!!editForm.homeroom_room_id}
                      onChange={(v) => setEditForm({ ...editForm, stay_in_homeroom: v })} />
                    {editErr && (
                      <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                        {editErr}
                      </div>
                    )}
                  </td>
                </tr>
              )}
              </React.Fragment>
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

      {auditFor != null && flat.find((g) => g.id === auditFor) && (
        <ClassSubjectsModal
          group={flat.find((g) => g.id === auditFor)!}
          groups={flat}
          requirements={requirements}
          subjects={subjects}
          teachers={teachers}
          slots={slots}
          pools={auditPools}
          periods={periods}
          onClose={() => setAuditFor(null)}
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
  // ส่งต่อครู — ครูย้ายออก อีกคนรับช่วงต่อ
  const [handover, setHandover] = useState(false);
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
    <Section title="ครูผู้สอน" action={
      <div className="flex items-center gap-2">
        <button onClick={() => setHandover(true)}
          className="px-2.5 py-1 rounded border border-teal-300 text-teal-700 hover:bg-teal-50 text-xs font-semibold">
          🔁 ส่งต่อครู
        </button>
        <ImportButton entity="teachers" />
      </div>
    }>
      {handover && <TeacherHandoverModal onClose={() => setHandover(false)} />}
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
/** The dropdown's three states as the API's tri-state boolean. */
const outdoorValue = (v: string) => v === "yes" ? true : v === "no" ? false : null;
/** And back, for the edit row. */
const outdoorChoice = (v: boolean | null | undefined) =>
  v === true ? "yes" : v === false ? "no" : "";

const SubjectsPanel: React.FC = () => {
  const { subjects, departments, requirements, rooms, buildings } = useTimetableStore();
  const [form, setForm] = useState({ code: "", name: "", type: "common", duration: 1, department_id: "", is_activity: false, is_elective: false, fixed_room_id: "", prefer_morning: false, allow_outdoor: "" as "" | "yes" | "no", room_rule: "" as "" | "subject" | "homeroom" });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [electiveFor, setElectiveFor] = useState<number | null>(null);
  const [roomsFor, setRoomsFor] = useState<number | null>(null);
  const [rowMenu, setRowMenu] = useState<number | null>(null);
  /** Where the ⋯ menu sits on screen, measured from its button when opened. */
  const [menuAt, setMenuAt] = useState<{ top?: number; bottom?: number; right: number }>({ top: 0, right: 0 });
  // A menu pinned to the screen has to close when the page moves under it.
  useEffect(() => {
    if (rowMenu == null) return;
    const close = () => setRowMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [rowMenu]);

  // How many classes each subject is already assigned to.
  const classCount = (subjectId: number) =>
    requirements.filter((r) => r.subject_id === subjectId).length;
  /** อาคารที่วิชานี้เรียนได้ — the list, or the single older field. */
  const subjectBuildings = (x: Subject): number[] => {
    const many = x.building_ids;
    if (Array.isArray(many) && many.length) return many;
    return x.building_id ? [x.building_id] : [];
  };
  const buildingName = (id: number) =>
    buildings.find((b) => b.id === id)?.name ?? `อาคาร ${id}`;

  /** How many of those classes have a room written out for them by hand. */
  const perClassRooms = (subjectId: number) =>
    requirements.filter((r) => r.subject_id === subjectId && r.room_id).length;
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
      allow_outdoor: outdoorValue(form.allow_outdoor),
      room_rule: form.room_rule || null,
    });
    useTimetableStore.setState((s) => ({ subjects: [...s.subjects, created] }));
    setForm({ code: "", name: "", type: "common", duration: 1, department_id: "", is_activity: false, is_elective: false, fixed_room_id: "", prefer_morning: false, allow_outdoor: "" as "" | "yes" | "no", room_rule: "" as "" | "subject" | "homeroom" });
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    const updated = await api.updateSubject(id, {
      code: editForm.code, name: editForm.name,
      type: editForm.type as SubjectType,
      duration: Number(editForm.duration) as 1 | 2,
      department_id: editForm.department_id ? Number(editForm.department_id) : null,
      is_activity: editForm.is_activity,
      is_elective: editForm.is_elective,
      prefer_morning: editForm.prefer_morning,
      fixed_room_id: editForm.fixed_room_id ? Number(editForm.fixed_room_id) : null,
      allow_outdoor: outdoorValue(editForm.allow_outdoor),
      room_rule: editForm.room_rule || null,
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
        {/* "ความยาวคาบ" ไม่ใช่ "คาบต่อสัปดาห์" — คาบต่อสัปดาห์อยู่ที่หน้าแผนการสอน
            เพราะห้องต่างกันเรียนวิชาเดียวกันไม่เท่ากันได้ ช่องนี้บอกว่าเรียน
            ครั้งละติดกันกี่คาบ ซึ่งเป็นคนละคำถาม */}
        <Field label="ความยาวคาบ">
          <select className={inputCls} value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}>
            <option value={1}>1 คาบ (คาบเดี่ยว)</option>
            <option value={2}>2 คาบติดกัน (คาบคู่)</option>
          </select>
        </Field>
        <Field label="วิชากิจกรรม">
          <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
            <input type="checkbox" checked={form.is_activity} onChange={(e) => setForm({ ...form, is_activity: e.target.checked })} className="w-4 h-4" />
            <span className="text-sm text-gray-600">เป็นชุมนุม/ลูกเสือ/กิจกรรม</span>
          </label>
        </Field>
        <Field label="🌳 เรียนที่ลานได้ไหม">
          <select className={inputCls} value={form.allow_outdoor}
            onChange={(e) => setForm({ ...form, allow_outdoor: e.target.value as "" | "yes" | "no" })}>
            <option value="">– ปกติ (ลงลานได้ถ้าห้องเต็ม) –</option>
            <option value="yes">✅ ลงลานได้ ถ้าห้องเต็ม</option>
            <option value="no">🚫 ห้ามลงลาน</option>
          </select>
        </Field>
        <Field label="📍 เรียนที่ไหน">
          <select className={inputCls} value={form.room_rule}
            onChange={(e) => setForm({ ...form, room_rule: e.target.value as "" | "subject" | "homeroom" })}>
            <option value="">– ปกติ (ตามกฎการจัดห้อง) –</option>
            <option value="subject">🏟 ห้องประจำวิชาเท่านั้น</option>
            <option value="homeroom">🎒 ห้องของนักเรียน (ครูเดินไป)</option>
          </select>
        </Field>
      </div>
      <div className="bg-teal-50 border border-teal-200 rounded-lg p-2.5 mb-3 text-xs text-teal-900 leading-relaxed">
        <strong>🌳 ลาน</strong> ใช้เหมือนห้องเรียนห้องหนึ่ง แต่<strong>อยู่ท้ายสุดเสมอ</strong> —
        ระบบจะจัดเข้าห้องในอาคารให้หมดก่อน เหลือเท่าไรจึงลงลาน
        ไม่ต้องติ๊กทุกวิชา ให้ติ๊ก <strong>🚫 ห้ามลงลาน</strong> เฉพาะวิชาที่ออกไปข้างนอกไม่ได้
        <br/><strong>📍 ห้องประจำวิชาเท่านั้น</strong> — พละ นาฏศิลป์ ถ้าสนาม/ห้องไม่ว่างจะรอคาบอื่น
        ไม่ยอมลงห้องเรียนธรรมดา · <strong>ห้องของนักเรียน</strong> — แนะแนว โฮมรูม
        ครูเดินไปหานักเรียน ต่อให้ครูมีห้องประจำของตัวเอง
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
              {["รหัส","ชื่อวิชา","กลุ่มสาระฯ","🏟 ห้องประจำวิชา","ความยาวคาบ","ช่วงเวลาที่อยากให้สอน",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {subjects.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูล</td></tr>
            )}
            {shownSubjects.map((s) => (
              <tr key={s.id} className={clsx("hover:bg-gray-50",
                (s.is_activity || s.is_elective) && "bg-purple-50/30")}>
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
                      <div className="flex gap-1 mt-1">
                        <select className={inlineCls} value={editForm.room_rule}
                          onChange={(e) => setEditForm({ ...editForm, room_rule: e.target.value as "" | "subject" | "homeroom" })}>
                          <option value="">ห้อง: ปกติ</option>
                          <option value="subject">🏟 ห้องวิชาเท่านั้น</option>
                          <option value="homeroom">🎒 ห้องนักเรียน</option>
                        </select>
                        <select className={inlineCls} value={editForm.allow_outdoor}
                          onChange={(e) => setEditForm({ ...editForm, allow_outdoor: e.target.value as "" | "yes" | "no" })}>
                          <option value="">ลาน: ปกติ</option>
                          <option value="yes">🌳 ลานได้</option>
                          <option value="no">🚫 ห้ามลาน</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <select className={inlineCls} style={{ width: 50 }} value={editForm.duration} onChange={(e) => setEditForm({ ...editForm, duration: Number(e.target.value) })}>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <label className="flex items-center gap-1"><input type="checkbox" checked={editForm.is_activity} onChange={(e) => setEditForm({ ...editForm, is_activity: e.target.checked })} /> กิจกรรม</label>
                      <label className="flex items-center gap-1" title="นักเรียนเลือกเรียน หลายห้องเรียนพร้อมกัน จึงนับเป็นชั่วโมงเดียว"><input type="checkbox" checked={editForm.is_elective} onChange={(e) => setEditForm({ ...editForm, is_elective: e.target.checked })} /> วิชาเสรี</label>
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
                      {s.is_elective && <span className="ml-1 px-1 py-0.5 bg-purple-100 text-purple-700 border border-purple-300 rounded text-[10px]">วิชาเสรี</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{deptName(s.department_id)}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1">
                        {roomName(s.fixed_room_id)
                          ? <span className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">🏟 {roomName(s.fixed_room_id)}</span>
                          : <span className="text-gray-400">–</span>}
                        {/* One room per subject stopped being enough once a
                            subject had six teachers in four rooms. This opens
                            the list and lets the school write it out class by
                            class. */}
                        {subjectBuildings(s).length > 0 && (
                          <span title="วิชานี้เรียนได้เฉพาะอาคารนี้"
                            className="bg-slate-100 text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded whitespace-nowrap">
                            🏢 {subjectBuildings(s).map(buildingName).join(" · ")}
                          </span>
                        )}
                        <button onClick={() => setRoomsFor(s.id)}
                          title="กำหนดเองว่าห้องเรียนไหนเรียนวิชานี้ที่ห้องอะไร และอยู่อาคารไหนได้บ้าง"
                          className="px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 whitespace-nowrap">
                          🚪 รายห้อง
                          {perClassRooms(s.id) > 0 && (
                            <span className="ml-1 text-[10px] bg-sky-600 text-white px-1 rounded-full">{perClassRooms(s.id)}</span>
                          )}
                        </button>
                        {s.room_rule === "subject" && (
                          <span title="ต้องเรียนที่ห้องประจำวิชาเท่านั้น ถ้าไม่ว่างจะรอคาบอื่น"
                            className="bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded">เท่านั้น</span>
                        )}
                        {s.room_rule === "homeroom" && (
                          <span title="เรียนที่ห้องของนักเรียน ครูเดินไปหา"
                            className="bg-indigo-50 text-indigo-800 border border-indigo-200 px-1.5 py-0.5 rounded">🎒 ห้องนักเรียน</span>
                        )}
                        {s.allow_outdoor === true && (
                          <span title="ลงลานได้เมื่อห้องในอาคารเต็ม (เหมือนค่าปกติ)"
                            className="bg-green-50 text-green-800 border border-green-200 px-1.5 py-0.5 rounded">🌳 ลานได้</span>
                        )}
                        {s.allow_outdoor === false && (
                          <span title="ห้ามลงลาน"
                            className="bg-gray-100 text-gray-600 border border-gray-300 px-1.5 py-0.5 rounded">🚫 ไม่ลงลาน</span>
                        )}
                      </div>
                    </td>
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
                      {/* Four buttons on every one of 293 rows read as a wall
                          of colour, and the one that matters — จัดห้อง/ครู,
                          where the real work is — looked like the other
                          three. It stays out; the rest fold into one ⋯. */}
                      <div className="flex gap-1 items-center">
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
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              if (rowMenu === s.id) { setRowMenu(null); return; }
                              // Anchored to the button on screen, not to the
                              // row: the table is clipped at its own edge, so
                              // a menu hanging below the last row was cut off
                              // completely — which looked like a dead button
                              // whenever a search left only a row or two.
                              const b = e.currentTarget.getBoundingClientRect();
                              const below = window.innerHeight - b.bottom;
                              setMenuAt({
                                right: Math.max(8, window.innerWidth - b.right),
                                ...(below < 190
                                  ? { bottom: window.innerHeight - b.top + 4 }
                                  : { top: b.bottom + 4 }),
                              });
                              setRowMenu(s.id);
                            }}
                            title="เครื่องมืออื่น"
                            className="px-2 py-1 text-xs bg-gray-50 text-gray-500 rounded hover:bg-gray-100 border border-gray-200">
                            ⋯
                          </button>
                          {rowMenu === s.id && (
                            <>
                              <div className="fixed inset-0 z-[60]" onClick={() => setRowMenu(null)} />
                              <div style={{ position: "fixed", ...menuAt }}
                                className="z-[61] bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[170px] py-1">
                                <button
                                  onClick={() => { setElectiveFor(s.id); setRowMenu(null); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-gray-700 hover:bg-purple-50">
                                  🎓 <span>ใส่คาบเสรี</span>
                                </button>
                                <button
                                  onClick={() => { setRowMenu(null); setEditing(s.id); setEditForm({ code: s.code, name: s.name, type: s.type, duration: s.duration, department_id: s.department_id ? String(s.department_id) : "", is_activity: s.is_activity ?? false, is_elective: s.is_elective ?? false, fixed_room_id: s.fixed_room_id ? String(s.fixed_room_id) : "", prefer_morning: s.prefer_morning ?? false, allow_outdoor: outdoorChoice(s.allow_outdoor) as "" | "yes" | "no", room_rule: (s.room_rule ?? "") as "" | "subject" | "homeroom" }); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-gray-700 hover:bg-gray-50">
                                  ✏️ <span>แก้ไขรายวิชา</span>
                                </button>
                                <div className="border-t border-gray-100 my-1" />
                                <button
                                  onClick={async () => { setRowMenu(null); await api.deleteSubject(s.id); useTimetableStore.setState((st) => ({ subjects: st.subjects.filter((x) => x.id !== s.id) })); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-red-600 hover:bg-red-50">
                                  🗑 <span>ลบวิชานี้</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
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
      {roomsFor != null && subjects.find((x) => x.id === roomsFor) && (
        <SubjectRoomsModal subject={subjects.find((x) => x.id === roomsFor)!}
          onClose={() => setRoomsFor(null)} />
      )}
    </Section>
  );
};

// ─── Rooms ───────────────────────────────────────────────────────────────────

const RoomsPanel: React.FC = () => {
  const { rooms, teachers, departments, groups } = useTimetableStore();
  // Settings live in a dialog: a room carries enough of them that editing in
  // the row made that row several lines tall and hid every other room.
  const [settingsFor, setSettingsFor] = useState<Room | null>(null);
  const [creating, setCreating]       = useState(false);
  const [q, setQ] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);

  const teacherName = (id: number) => teachers.find((t) => t.id === id)?.name ?? "–";
  const deptName = (id: number | null | undefined) =>
    id ? (departments.find((d) => d.id === id)?.name ?? "–") : null;
  const flatGroups = useMemo(() => flattenGroups(groups), [groups]);
  const groupName = (id: number) => flatGroups.find((g) => g.id === id)?.name ?? `#${id}`;
  const forClasses = (r: Room) =>
    Array.isArray(r.reserved_group_ids) ? r.reserved_group_ids : [];

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
      // ค้นด้วยชื่อชั้นเรียนได้ด้วย — "247 เป็นของ ม.5/1" is a thing the
      // school looks up by the class, not by the room number.
      forClasses(r).map(groupName).join(" "),
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
                      {/* กันไว้ให้ชั้นเรียน. Set in the dialog but shown
                          nowhere, so the table said ห้องรวม about a room that
                          was reserved and the setting had to be opened room
                          by room to find out. */}
                      {forClasses(r).length > 0 && (
                        <span className="bg-indigo-50 text-indigo-800 border border-indigo-200 px-1.5 py-0.5 rounded whitespace-nowrap"
                          title={forClasses(r).map(groupName).join(", ")}>
                          🎒 {forClasses(r).length <= 2
                            ? forClasses(r).map(groupName).join(" · ")
                            : `${groupName(forClasses(r)[0])} +${forClasses(r).length - 1} ห้อง`}
                        </span>
                      )}
                      {kept.length === 0 && !r.specialized_dept_id && forClasses(r).length === 0
                        && <span className="text-gray-400">ห้องรวม</span>}
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

// ─── ลำดับลาน ────────────────────────────────────────────────────────────────
/**
 * One order of the ลาน for the whole school.
 *
 * The solver fills the first ลาน and only moves on to the next when that one
 * is taken for the hour. How many คาบ each ลาน already holds is counted from the
 * hours the classes picked in โหมดเลือกคาบเรียนลาน — nothing is typed in here.
 * Every move saves at once; a refusal is shown in the server's own words.
 */
const YardOrderPanel: React.FC = () => {
  const loadYardPicks = useTimetableStore((s) => s.loadYardPicks);
  const [data, setData]   = useState<api.YardOrder | null>(null);
  const [err, setErr]     = useState<string | null>(null);
  const [busy, setBusy]   = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    api.fetchYardOrder()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setErr(null);
      })
      .catch((e) => {
        if (alive) setErr(api.errorDetail(e, "โหลดลำดับลานไม่สำเร็จ — ลองใหม่อีกครั้ง"));
      });
    return () => { alive = false; };
  }, [attempt]);

  // `order` is the school's saved order; `yards` is not promised to follow it.
  const yards = data ? inOrder(data.order, data.yards) : [];

  const move = async (index: number, delta: -1 | 1) => {
    if (!data || busy) return;
    const ids  = yards.map((y) => y.id);
    const next = moveBy(ids, index, delta);
    if (next === ids) return;
    const before = data;
    setBusy(true);
    setErr(null);
    setSaved(false);
    setData({ ...before, order: next });          // the move shows at once
    try {
      const after = await api.saveYardOrder(next);
      setData(after);
      setSaved(true);
      // The picker in the timetable lists the ลาน in this order.
      void loadYardPicks();
    } catch (e) {
      setErr(api.errorDetail(e, "บันทึกลำดับไม่สำเร็จ — ลองใหม่อีกครั้ง"));
      // Show what the server really holds — it may have moved on since.
      try {
        setData(await api.fetchYardOrder());
      } catch {
        setData(before);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="ลำดับลาน"
      action={
        <span className={clsx("text-xs", saved ? "text-emerald-700" : "text-gray-400")}>
          {busy ? "กำลังบันทึก…" : saved ? "✓ บันทึกลำดับแล้ว" : ""}
        </span>
      }
    >
      {/* ลานที่โรงเรียนหาไม่เจอในหน้านี้ เกือบทุกครั้งคือห้องที่ยังไม่ได้ตั้งเป็น
          “กลางแจ้ง” — บอกทางไว้ตรงนี้ แทนที่จะให้เดาว่าหน้านี้ตกหล่นเอง */}
      <p className="text-xs text-gray-600 mb-2">
        รายการนี้มีเฉพาะห้องสอนที่ตั้ง “ประเภทห้อง” เป็น “กลางแจ้ง” — ถ้าไม่เห็นลานที่ต้องการ ให้ไปที่หน้า 🚪 ห้องสอน แล้วเปลี่ยนประเภทของห้องนั้นเป็น “กลางแจ้ง”
      </p>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-3 text-xs text-blue-800">
        💡 ตัวจัดตารางจะเติมลานบนสุดก่อน และไปลานถัดไปก็ต่อเมื่อลานนั้นถูกใช้แล้วในคาบนั้น — ใช้ลำดับเดียวกันทั้งโรงเรียน
        <br />
        {/* ลานที่ไม่อยู่ในลำดับยังถูกใช้ได้เมื่อลานในลำดับเต็มหมดแล้ว การไม่ใส่
            จึงเท่ากับ "ใช้ท้ายสุด" ไม่ใช่ "ห้ามใช้" — ต้องบอกไว้ ไม่งั้นคนที่
            เอาลานแนะแนวออกจากลำดับจะคิดว่ามันจะไม่ถูกใช้อีกเลย */}
        รวมคาบพละด้วย — ลานที่ไม่ได้ใส่ไว้ในลำดับจะถูกใช้ท้ายสุด (ต่อเมื่อลานในลำดับถูกใช้หมดแล้วในคาบนั้น)
        ถ้าไม่อยากให้ใช้เลย ให้ไปปิดห้องนั้นที่หน้า 🚪 ห้องสอน
      </div>

      {err && (
        <div role="alert" className="mb-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span className="flex-1">{err}</span>
          {!data && (
            <button onClick={() => setAttempt((n) => n + 1)} className={btnEdit}>ลองใหม่</button>
          )}
        </div>
      )}

      {!data && !err && (
        <div className="text-center text-gray-400 text-sm py-10">กำลังโหลด…</div>
      )}

      {data && yards.length === 0 && (
        <div className="border border-gray-200 rounded-lg px-3 py-8 text-center text-gray-400 text-xs">
          ยังไม่มีลานในระบบ (ห้องสอนที่ตั้งเป็นประเภท “กลางแจ้ง” จะเป็นลาน)
        </div>
      )}

      {data && yards.length > 0 && (
        <>
          <ol className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
            {yards.map((y, i) => (
              <li key={y.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
                <span className="shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 truncate">{y.name}</div>
                  {y.capacity > 0 && (
                    <div className="text-[11px] text-gray-500">จุ {y.capacity} คน</div>
                  )}
                </div>
                <span
                  className={clsx(
                    "shrink-0 text-xs px-2 py-1 rounded border whitespace-nowrap",
                    y.picks > 0
                      ? "bg-teal-50 border-teal-200 text-teal-800 font-semibold"
                      : "bg-gray-50 border-gray-200 text-gray-400",
                  )}
                  title="จำนวนคาบที่ห้องต่างๆ เลือกไว้ว่าเรียนที่ลานนี้"
                >
                  📌 {y.picks} คาบ
                </span>
                <div className="shrink-0 flex gap-1">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={busy || i === 0}
                    aria-label={`เลื่อน ${y.name} ขึ้น`}
                    title="เลื่อนขึ้น"
                    className={clsx(btnEdit, "disabled:opacity-30 disabled:cursor-not-allowed")}
                  >▲</button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={busy || i === yards.length - 1}
                    aria-label={`เลื่อน ${y.name} ลง`}
                    title="เลื่อนลง"
                    className={clsx(btnEdit, "disabled:opacity-30 disabled:cursor-not-allowed")}
                  >▼</button>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-gray-500 mt-2">
            จำนวนคาบนับให้เองจากช่องที่เลือกไว้ในตารางของแต่ละห้อง (⋯ เครื่องมือ → โหมดเลือกคาบเรียนลาน) — ไม่ต้องกรอกที่นี่
          </p>
        </>
      )}
    </Section>
  );
};

// ─── Requirements (Teacher-Subject-Group Assignments) ─────────────────────────
const RequirementsPanel: React.FC = () => {
  const { requirements, groups, teachers, subjects, periods, departments, slots } = useTimetableStore();
  // Per-class คาบเสรี cells count as windows too, so a subject in one reads
  // as an elective here as well.
  const electiveCells = useMemo(() => slots.filter((x) => x.is_elective), [slots]);
  // ชุดเรียนพร้อมกันของห้องย่อย — ก/ข/ค at three different subjects in one hour.
  const [showSets, setShowSets] = useState(false);
  const hasSubgroups = groups.some((g) => (g.children ?? []).length > 0);
  const [form, setForm] = useState({
    group_id: "", subject_id: "", teacher_id: "", weekly_count: 1, parallel_group_key: "",
    co_teacher_id: "",
  });
  const [editing, setEditing]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);
  /**
   * Why the server turned a row down, in its own words.
   *
   * A class with a curriculum cannot be given a subject outside it, and the
   * 400 says which curriculum and which subject. `key` is the class and subject
   * that were refused: change either and the message no longer describes what
   * is on screen, so it goes.
   */
  const [reqErr, setReqErr] = useState<{ at: "add" | number; key: string; text: string } | null>(null);

  /**
   * The สอนร่วม partner, or null.
   *
   * Changing ครูผู้สอน after picking a partner can leave the two the same
   * person: the dropdown stops offering them, but the value already chosen
   * stays put. Sent through, that books one teacher into the cell twice.
   */
  const coOf = (teacher: string, co: string) =>
    co && co !== teacher ? Number(co) : null;

  const handleCreate = async () => {
    setReqErr(null);
    let created: LessonRequirement;
    try {
      created = await api.createRequirement({
        group_id:   Number(form.group_id),
        subject_id: Number(form.subject_id),
        teacher_id: Number(form.teacher_id),
        weekly_count: Number(form.weekly_count),
        parallel_group_key: form.parallel_group_key || null,
        co_teacher_id: coOf(form.teacher_id, form.co_teacher_id),
      });
    } catch (e) {
      setReqErr({
        at: "add", key: `${form.group_id}:${form.subject_id}`,
        text: api.errorDetail(e, "เพิ่มข้อกำหนดไม่สำเร็จ — ลองใหม่อีกครั้ง"),
      });
      return;
    }
    useTimetableStore.setState((s) => ({ requirements: [...s.requirements, created] }));
    await mirrorPairing(created);
    setForm({ group_id: "", subject_id: "", teacher_id: "", weekly_count: 1,
              parallel_group_key: "", co_teacher_id: "" });
  };

  /**
   * Say the pairing on the partner's row too.
   *
   * The plan holds both halves of a co-taught lesson, so naming the partner
   * on one row and not the other leaves the second teacher's own row looking
   * like a duplicate of somebody else's work — which is exactly what it was
   * being reported as. Only a row that has no partner yet is touched, so this
   * never overwrites a pairing the school set deliberately.
   */
  const mirrorPairing = async (row: LessonRequirement) => {
    if (row.co_teacher_id == null) return;
    const mate = requirements.find((o) =>
      o.id !== row.id && o.group_id === row.group_id &&
      o.subject_id === row.subject_id && o.teacher_id === row.co_teacher_id &&
      o.co_teacher_id == null);
    if (!mate) return;
    const back = await api.updateRequirement(mate.id, { co_teacher_id: row.teacher_id });
    useTimetableStore.setState((st) => ({
      requirements: st.requirements.map((r) => r.id === mate.id ? { ...r, ...back } : r),
    }));
  };

  const handleUpdate = async (id: number) => {
    if (!editForm) return;
    setReqErr(null);
    let updated: LessonRequirement;
    try {
      updated = await api.updateRequirement(id, {
        group_id:   Number(editForm.group_id),
        subject_id: Number(editForm.subject_id),
        teacher_id: Number(editForm.teacher_id),
        weekly_count: Number(editForm.weekly_count),
        parallel_group_key: editForm.parallel_group_key || null,
        co_teacher_id: coOf(editForm.teacher_id, editForm.co_teacher_id),
      });
    } catch (e) {
      setReqErr({
        at: id, key: `${editForm.group_id}:${editForm.subject_id}`,
        text: api.errorDetail(e, "บันทึกข้อกำหนดไม่สำเร็จ — ลองใหม่อีกครั้ง"),
      });
      return;
    }
    useTimetableStore.setState((s) => ({ requirements: s.requirements.map((r) => r.id === id ? { ...r, ...updated } : r) }));
    await mirrorPairing(updated);
    setEditing(null); setEditForm(null);
  };

  const gName = (id: number) => groups.flatMap((g) => [g,...(g.children??[])]).find((g) => g.id === id)?.name ?? String(id);
  const tName = (id: number) => teachers.find((t) => t.id === id)?.name ?? String(id);
  const sCode = (id: number) => subjects.find((s) => s.id === id)?.code ?? String(id);

  const flat = groups.flatMap((g) => [g, ...(g.children ?? [])]);

  // ── Capacity check: warn if a group needs more periods than exist ──────────
  const classPeriodCount = new Set(periods.filter((p) => p.type === "class").map((p) => p.period_num)).size;
  const weekCapacity = classPeriodCount * 5;   // 5 school days
  // วิชาเสรี count once, not once per class — see utils/teachingLoad for why.
  // The ticked subjects. Membership of a คาบเสรี window counts too, but the
  // pools live on their own page; the server's own check knows about both.
  const electiveIds = useMemo(
    () => electiveSubjectIds(subjects, [], electiveCells), [subjects, electiveCells]);
  const groupLoad = groupLoads(requirements, electiveIds);
  const overbooked = [...groupLoad.entries()]
    .filter(([, load]) => load > weekCapacity)
    .map(([gid, load]) => ({ name: gName(gid), load }));

  // Teacher over-load (soft): teacher total weekly count vs their max_slots_per_day*5
  const teacherLoad = teacherLoads(requirements, electiveIds);
  const teacherOver = teachers
    .map((t) => ({ t, load: teacherLoad.get(t.id) ?? 0, cap: (t.max_slots_per_day || 6) * 5 }))
    .filter((x) => x.load > x.cap)
    .map((x) => ({ name: x.t.name, load: x.load, cap: x.cap }));

  const existingParallelKeys = [...new Set(requirements.map((r) => r.parallel_group_key).filter(Boolean))] as string[];

  // หนึ่งห้อง หนึ่งวิชา หนึ่งครู — see utils/teachingConflicts.
  const clashes = useMemo(() => clashesByRequirement(requirements), [requirements]);
  /**
   * The สอนร่วม partner of every row, including the ones that never set it.
   *
   * An imported plan lists the pair as two rows, one per teacher. Setting
   * สอนร่วม on the Thai teacher's row left the foreign teacher's own row
   * saying nothing about a partner, so whoever opened it saw a bare duplicate.
   */
  const partners = useMemo(() => {
    const idx = indexRequirements(requirements);
    const m = new Map<number, number>();
    for (const r of requirements) {
      const p = partnerOf(r, idx);
      if (p != null) m.set(r.id, p);
    }
    return m;
  }, [requirements]);
  const mismatched = useMemo(() => mismatchedPairs(requirements), [requirements]);
  const pairable = useMemo(() => autoPairable(requirements), [requirements]);
  const [pairing, setPairing] = useState(false);

  /**
   * Write every pairing the plan is already describing.
   *
   * One request, not two per class: the bulk endpoint matches on class +
   * subject + teacher and updates the row it finds, so a few hundred
   * pairings go in together instead of a few hundred round trips.
   */
  const pairAll = async () => {
    if (!pairable.length) return;
    setPairing(true);
    try {
      await api.bulkCreateRequirements(pairable.flatMap(({ a, b }) => [
        { group_id: a.group_id, subject_id: a.subject_id, teacher_id: a.teacher_id,
          weekly_count: a.weekly_count, parallel_group_key: a.parallel_group_key ?? null,
          co_teacher_id: b.teacher_id },
        { group_id: b.group_id, subject_id: b.subject_id, teacher_id: b.teacher_id,
          weekly_count: b.weekly_count, parallel_group_key: b.parallel_group_key ?? null,
          co_teacher_id: a.teacher_id },
      ]));
      useTimetableStore.setState({ requirements: await api.fetchRequirements() });
    } finally { setPairing(false); }
  };

  // 1,200+ rows: filter first, then draw only a slice so the page stays quick.
  const [q, setQ] = useState("");
  const matchedReqs = requirements.filter((r) =>
    matches(q, gName(r.group_id), sCode(r.subject_id), tName(r.teacher_id), r.parallel_group_key));
  const ROW_CAP = 200;
  const shownReqs = matchedReqs.slice(0, ROW_CAP);

  return (
    <Section title="ข้อกำหนดคาบเรียน — ครูสอนวิชาอะไร ในห้องใด">
      {showSets && <SubgroupSetModal onClose={() => setShowSets(false)} />}
      {hasSubgroups && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5 mb-3">
          <span className="text-lg">🧩</span>
          <p className="text-xs text-indigo-900 flex-1 leading-relaxed">
            <strong>ห้องย่อย ก/ข/ค เรียนคนละวิชาในชั่วโมงเดียวกัน?</strong>{" "}
            ตั้งเป็น “เซ็ต” ได้ — เช่น เซ็ต A: ก เรียนคณิต · ข เรียนอังกฤษ · ค เรียนคอม
            และเซ็ตไหนที่ ค ไม่เรียน ก็เว้นไว้ได้
          </p>
          <button onClick={() => setShowSets(true)}
            className="shrink-0 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">
            จัดการเซ็ตห้องย่อย
          </button>
        </div>
      )}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
        <strong>วิธีกำหนดการสอน:</strong> เลือกห้องเรียน → วิชา → ครูผู้สอน → จำนวนคาบ/สัปดาห์
        <br/><strong>1 ห้อง + 1 วิชา = ครู 1 คน</strong> — ถ้าอยากให้มีครูสองคนในคาบเดียวกัน (ครูพี่เลี้ยงกับนักศึกษาฝึกสอน
        หรือครูต่างชาติกับครูไทย) <strong>อย่าสร้างสองแถว</strong> ให้ใช้แถวเดียวแล้วใส่คนที่สองในช่อง
        <strong> 👥 สอนร่วม</strong> ทั้งคู่จะได้ลงคาบเดียวกันห้องเดียวกัน และระบบจะกันไม่ให้ทั้งสองคนไปติดคาบอื่น
        <br/>ถ้าวิชาเดียวกันสอนหลายห้องพร้อมกัน (คู่ขนาน) ให้ใช้ <strong>รหัสคู่ขนาน</strong> เดียวกัน — เลือกจากรายการที่มี หรือพิมพ์รหัสใหม่
        <br/>💡 มีข้อกำหนดจำนวนมาก? ใช้ปุ่ม <strong>"นำเข้า"</strong> ด้านบน แล้วเลือก "ข้อกำหนดคาบ" เพื่อนำเข้าจาก Excel ทีเดียว
      </div>

      {clashes.size > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3 mb-4 text-xs text-red-900">
          <p className="font-bold">
            ⚠️ มี {new Set([...clashes.keys()].map((id) => {
              const r = requirements.find((x) => x.id === id);
              return r ? `${r.group_id}:${r.subject_id}` : id;
            })).size} ห้อง-วิชา ที่ถูกกำหนดให้ครูมากกว่า 1 คน
          </p>
          <p className="mt-1 leading-relaxed">
            แถวที่มีปัญหาจะขึ้นป้ายแดง <strong>“⚠ ซ้ำกับ …”</strong> ในคอลัมน์ครูผู้สอนด้านล่าง
            — ถ้า<strong>ตั้งใจให้สอนคู่กัน</strong> กดปุ่มด้านล่างได้เลย ระบบจะจับคู่ให้ทุกรายการ
            แล้วนับเป็นคาบเดียว · ถ้าใส่ผิดให้ลบแถวที่เกินออกแทน
          </p>
          {pairable.length > 0 && (
            <button onClick={pairAll} disabled={pairing}
              className="mt-2 px-3 py-1.5 bg-sky-600 text-white text-xs rounded font-semibold hover:bg-sky-700 disabled:opacity-40">
              {pairing ? "กำลังจับคู่…" : `👥 จับคู่สอนร่วมให้ทั้งหมด (${pairable.length} ห้อง-วิชา)`}
            </button>
          )}
        </div>
      )}

      {mismatched.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-4 text-xs text-amber-900 space-y-1">
          <p className="font-bold">⚠️ คู่สอนร่วมที่จำนวนคาบไม่ตรงกัน {mismatched.length} คู่</p>
          <p className="leading-relaxed">
            คู่สอนร่วมคือคาบเดียวกัน จำนวนคาบ/สัปดาห์ของทั้งสองแถวจึงต้องเท่ากัน
            ระบบจะใช้ตัวเลขที่มากกว่าไปก่อน
          </p>
          {mismatched.slice(0, 8).map(({ a, b }) => (
            <p key={a.id}>
              • <strong>{gName(a.group_id)} {sCode(a.subject_id)}</strong>{" — "}
              {tName(a.teacher_id)} {a.weekly_count} คาบ · {tName(b.teacher_id)} {b.weekly_count} คาบ
            </p>
          ))}
        </div>
      )}

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
          <SearchableSelect value={form.subject_id}
            onChange={(v) => setForm({ ...form, subject_id: v })}
            options={subjectOptions(subjects)} placeholder="เลือกวิชา" />
        </Field>
        <Field label="ครูผู้สอน *">
          <SearchableSelect value={form.teacher_id} onChange={(v) => setForm({ ...form, teacher_id: v })}
            options={teacherOptions(teachers, departments)} placeholder="เลือกครู" />
        </Field>
        <Field label="👥 สอนร่วม — ครูคนที่ 2 (ถ้ามี)">
          <SearchableSelect
            value={form.co_teacher_id}
            onChange={(v) => setForm({ ...form, co_teacher_id: v })}
            options={teacherOptions(teachers.filter((t) => String(t.id) !== form.teacher_id), departments)}
            emptyLabel="– ไม่มี –" placeholder="– ไม่มี –" />
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
      {reqErr && reqErr.at === "add" && reqErr.key === `${form.group_id}:${form.subject_id}` && (
        <div role="alert"
          className="mt-2 text-sm text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2 leading-relaxed">
          <strong>เพิ่มไม่ได้</strong> — {reqErr.text}
        </div>
      )}

      <div className="mt-4">
        <TableSearch value={q} onChange={setQ} count={matchedReqs.length} total={requirements.length}
          shown={shownReqs.length} placeholder="ค้นหาห้องเรียน / รหัสวิชา / ชื่อครู" />
      </div>
      {/* overflow-hidden rounds the table's corners, but it also cuts off the
          search panel of a picker opened in the row being edited. */}
      <div className={`border border-gray-200 rounded-lg ${editing ? "" : "overflow-hidden"}`}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ห้องเรียน","วิชา","ครูผู้สอน","👥 สอนร่วม","คาบ/สัปดาห์","รหัสคู่ขนาน",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {requirements.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อกำหนด</td></tr>
            )}
            {shownReqs.map((r) => (
              editing === r.id && editForm ? (
                /* Typing beats scrolling: a plain <select> of 153 teachers or
                   271 subjects is a list you hunt through, and the เพิ่ม form
                   above this table has had a search box all along. */
                <React.Fragment key={r.id}>
                <tr className="bg-yellow-50">
                  <td className="px-2 py-1">
                    <SearchableSelect value={editForm.group_id}
                      onChange={(v) => setEditForm({ ...editForm, group_id: v })}
                      options={groupOptions(flat)} placeholder="ห้องเรียน" />
                  </td>
                  <td className="px-2 py-1">
                    <SearchableSelect value={editForm.subject_id}
                      onChange={(v) => setEditForm({ ...editForm, subject_id: v })}
                      options={subjectOptions(subjects)} placeholder="วิชา" />
                  </td>
                  <td className="px-2 py-1">
                    <SearchableSelect value={editForm.teacher_id}
                      onChange={(v) => setEditForm({ ...editForm, teacher_id: v })}
                      options={teacherOptions(teachers, departments)} placeholder="ครูผู้สอน" />
                  </td>
                  <td className="px-2 py-1">
                    <SearchableSelect value={editForm.co_teacher_id}
                      onChange={(v) => setEditForm({ ...editForm, co_teacher_id: v })}
                      options={teacherOptions(
                        teachers.filter((t) => String(t.id) !== editForm.teacher_id), departments)}
                      emptyLabel="– ไม่มี –" placeholder="– ไม่มี –" />
                  </td>
                  <td className="px-2 py-1"><input type="number" min={1} max={20} className={inlineCls} style={{ width: 55 }} value={editForm.weekly_count} onChange={(e) => setEditForm({ ...editForm, weekly_count: Number(e.target.value) })} /></td>
                  <td className="px-2 py-1"><input className={inlineCls} list="parallel-keys" style={{ width: 100 }} value={editForm.parallel_group_key} onChange={(e) => setEditForm({ ...editForm, parallel_group_key: e.target.value })} /></td>
                  <td className="px-2 py-1">
                    <div className="flex gap-1">
                      <button onClick={() => handleUpdate(r.id)} className={btnSave}>บันทึก</button>
                      <button onClick={() => { setEditing(null); setEditForm(null); setReqErr(null); }} className={btnCancel}>ยกเลิก</button>
                    </div>
                  </td>
                </tr>
                {reqErr && reqErr.at === r.id && reqErr.key === `${editForm.group_id}:${editForm.subject_id}` && (
                  <tr className="bg-yellow-50">
                    <td colSpan={7} className="px-3 pb-2">
                      <div role="alert"
                        className="text-sm text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2 leading-relaxed">
                        <strong>บันทึกไม่ได้</strong> — {reqErr.text}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ) : (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-blue-700">{gName(r.group_id)}</td>
                  <td className="px-3 py-2">{sCode(r.subject_id)}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {tName(r.teacher_id)}
                    {clashes.has(r.id) && (
                      <span
                        title={`ห้องนี้วิชานี้ถูกกำหนดให้ครูมากกว่า 1 คน — ถ้าตั้งใจให้สอนคู่กัน ให้ลบแถวที่ซ้ำแล้วใส่คนที่สองในช่อง “สอนร่วม” แทน`}
                        className="ml-1.5 px-1.5 py-0.5 rounded border text-[10px] bg-red-50 border-red-300 text-red-700 whitespace-nowrap">
                        ⚠ ซ้ำกับ {(clashes.get(r.id) ?? []).map(tName).join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {partners.has(r.id) ? (
                      <span
                        title={r.co_teacher_id
                          ? undefined
                          : "มาจากแถวของครูอีกคนที่ระบุว่าสอนร่วมกับแถวนี้ — นับเป็นคาบเดียวกัน"}
                        className={`px-1.5 py-0.5 rounded border text-[11px] ${
                          r.co_teacher_id
                            ? "bg-indigo-50 border-indigo-200 text-indigo-800"
                            : "bg-indigo-50/60 border-indigo-200 border-dashed text-indigo-700"}`}>
                        👥 {tName(partners.get(r.id)!)}{r.co_teacher_id ? "" : " (จากแถวคู่)"}
                      </span>
                    ) : <span className="text-gray-300">–</span>}
                  </td>
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
                      <button onClick={() => { setReqErr(null); setEditing(r.id); setEditForm({ group_id: String(r.group_id), subject_id: String(r.subject_id), teacher_id: String(r.teacher_id), weekly_count: r.weekly_count, parallel_group_key: r.parallel_group_key ?? "", co_teacher_id: r.co_teacher_id ? String(r.co_teacher_id) : "" }); }} className={btnEdit}>แก้ไข</button>
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
  const { slots, groups, teachers, subjects, periods, rooms, departments, loadSlots } = useTimetableStore();
  const [form, setForm] = useState({ group_id: "", day: "0", period: "", subject_id: "", teacher_id: "", label: "", room_id: "", is_double: false });
  // Keyed by window, not by one class's cell: the row the school opens is
  // the whole period, and so is the edit.
  const [managing, setManaging]   = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
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

  /**
   * Searching by what is IN the window, not only by its label.
   *
   * Somebody looking for ศ23204 types the code, and the วง is called
   * "ศิลปะตกแต่ง" — so the search found nothing and they were left hunting
   * through forty rows for the window that already holds it. The code, the
   * name and the teacher of every subject in a window are all searchable.
   */
  const optionText = (s: typeof slots[number]) =>
    (s.elective_options ?? []).flatMap((o) => {
      const subj = subjects.find((x) => x.id === o.subject_id);
      return [o.label, subj?.code, subj?.name,
              teachers.find((t) => t.id === o.teacher_id)?.name];
    });

  const electiveSlots = allElectives.filter((s) => matches(q, gName(s.group_id),
    s.subject_code, s.subject_name, s.teacher_name, s.room_name,
    ...optionText(s)));
  // Forty rows that were always one decision — see utils/electiveGroups.
  const electiveGroups = useMemo(() => groupElectiveSlots(electiveSlots), [electiveSlots]);
  const managingGroup = managing != null
    ? electiveGroups.find((g) => g.key === managing) ?? null : null;

  /** Delete the whole window: every class's copy of it. */
  const handleDeleteGroup = async (grp: { slots: { id: number }[] }) => {
    for (const x of grp.slots) await api.deleteSlot(x.id);
    await loadSlots();
  };

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
          <SearchableSelect value={form.group_id}
            onChange={(v) => setForm({ ...form, group_id: v })}
            options={groupOptions(flat)} placeholder="เลือกห้อง" />
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
          <SearchableSelect value={form.subject_id}
            onChange={(v) => setForm({ ...form, subject_id: v })}
            options={subjectOptions(subjects)} placeholder="เลือกวิชา" />
        </Field>
        <Field label="ครูผู้สอน (วงแรก) *">
          <SearchableSelect value={form.teacher_id}
            onChange={(v) => setForm({ ...form, teacher_id: v })}
            options={teacherOptions(teachers, departments)} placeholder="เลือกครู" />
        </Field>
        <Field label="ห้องสอน">
          <SearchableSelect value={form.room_id}
            onChange={(v) => setForm({ ...form, room_id: v })}
            options={roomOptions(rooms)}
            emptyLabel={suggestedRoomId
              ? `🏠 ห้องประจำครู (${rooms.find((r) => r.id === suggestedRoomId)?.name ?? "-"})`
              : "– เลือกห้อง –"} />
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
              {["วัน","คาบ","ห้องเรียนที่เรียนคาบนี้","วิชาให้เลือก",""].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {electiveGroups.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีวิชาเสรี</td></tr>
            )}
            {electiveGroups.map((grp) => (
              <React.Fragment key={grp.key}>
                <tr className="hover:bg-purple-50/30 align-top">
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{DAYS[grp.day]}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                    {periodRange(grp.slots[0])}
                    {grp.isDouble && (
                      <span className="ml-1 text-[10px] bg-purple-100 text-purple-700 border border-purple-200 px-1 py-0.5 rounded">🔗 คาบคู่</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {grp.groupIds.map((id) => (
                        <span key={id} className="text-[11px] bg-purple-50 border border-purple-200 text-purple-800 rounded px-1.5 py-0.5">
                          {gName(id)}
                        </span>
                      ))}
                    </div>
                    <span className="text-[11px] text-gray-400">{grp.groupIds.length} ห้อง</span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    <span className="font-medium">{grp.optionCount} วิชา</span>
                    <div className="text-[11px] text-gray-500 max-w-md">
                      {(grp.slots[0].elective_options ?? []).slice(0, 4)
                        .map((o) => o.label).join(" · ")}
                      {grp.optionCount > 4 && ` … อีก ${grp.optionCount - 4}`}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setManaging(grp.key)}
                        title="แก้ไขวิชาในคาบนี้ — มีผลกับทุกห้องในแถวนี้พร้อมกัน"
                        className="px-2 py-1 text-xs bg-purple-50 text-purple-600 rounded hover:bg-purple-100 border border-purple-200">
                        🎓 จัดการวิชา ({grp.groupIds.length} ห้อง)
                      </button>
                      <button onClick={() => { setCopyingId(grp.key); setCopyTargets([]); }} className={btnEdit}>📋 เพิ่มห้อง</button>
                      <button onClick={() => handleDeleteGroup(grp)} className={btnDanger}>ลบทั้งคาบ</button>
                    </div>
                  </td>
                </tr>
                {copyingId === grp.key && (
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="px-3 py-3">
                      <p className="text-xs font-semibold text-gray-600 mb-2">
                        เพิ่มห้องเรียนเข้าคาบนี้ (ได้วิชาทั้งหมดไปด้วย) — {DAYS[grp.day]} {periodRange(grp.slots[0])}:
                      </p>
                      <div className="flex flex-wrap gap-2 mb-2 max-h-40 overflow-y-auto">
                        {flat.filter((g) => !grp.groupIds.includes(g.id)).map((g) => (
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
                        <button onClick={() => handleCopy(grp.slots[0].id)} disabled={copyTargets.length === 0} className={btnSave}>เพิ่ม ({copyTargets.length})</button>
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

      {managingGroup && (
        <ElectiveOptionModal
          slot={managingGroup.slots[0]}
          siblings={managingGroup.slots}
          onClose={() => setManaging(null)} />
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
          <SearchableSelect value={filter.subject_id}
            onChange={(v) => setFilter({ ...filter, subject_id: v })}
            options={subjectOptions(subjects)} emptyLabel="ทุกวิชา" />
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
    // Her own week, each lesson once. Counting the cells instead stacks every
    // class of a คาบกิจกรรม or a คาบเสรี into one square of her Wednesday and
    // bills her for hours nobody worked — 36 periods in a six-period day.
    const tSlots = slotsForTeacher(slots, t.id);
    const byDay  = Array.from({ length: 5 }, (_, d) =>
      tSlots.filter((s) => s.day === d).length
    );
    const maxDay = Math.max(...byDay, 0);
    const outdoorCount = tSlots.filter((s) => s.room_type === "outdoor").length;

    // Consecutive periods per day
    let maxConsec = 0;
    for (let d = 0; d < 5; d++) {
      const dayPeriods = [...new Set(tSlots.filter((s) => s.day === d).map((s) => s.period))]
        .sort((a, b) => a - b);
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

  const gName = (id: number) =>
    groups.flatMap((g) => [g, ...(g.children ?? [])]).find((g) => g.id === id)?.name ?? String(id);
  const tName = (id: number) => teachers.find((t) => t.id === id)?.name ?? String(id);
  const sCode = (id: number) => subjects.find((x) => x.id === id)?.code ?? String(id);

  // วิชาซ้ำ — read off the plan and the placed week, not remembered.
  const dup = useMemo(
    () => findSubjectDuplicates(requirements, slots), [requirements, slots],
  );
  const dupCount = dup.splitTeachers.length + dup.overPlaced.length;

  // ห้องย่อย: read off the timetable as it stands, so it is already answered
  // by the time anyone thinks to ask.
  const subAudits = useMemo(() => auditAll(groups, slots), [groups, slots]);
  const subProblems = subAudits.reduce((n, r) => n + r.problemCount, 0);
  const [auditFor, setAuditFor] = useState<number | null>(null);

  // วิชาเสรี: the plan and the คาบเสรี windows have to name the same classes.
  const [pools, setPools] = useState<ElectivePool[]>([]);
  useEffect(() => { api.fetchElectivePools().then(setPools).catch(() => setPools([])); }, []);
  const electiveSlotsAll = useMemo(() => slots.filter((x) => x.is_elective), [slots]);
  const covGaps = useMemo(
    () => coverageProblems(electiveSubjectIds(subjects, pools, electiveSlotsAll),
                           requirements, groups, pools, electiveSlotsAll),
    [subjects, pools, requirements, groups, electiveSlotsAll]);
  const coTaught = useMemo(
    () => slots.filter(teachingTogether).length, [slots],
  );
  // Who works with whom, on what — read off the plan rather than the week,
  // so it answers the question before the timetable has been built.
  const pairs = useMemo(() => coTeachingPairs(requirements), [requirements]);
  const pairable = useMemo(() => autoPairable(requirements), [requirements]);
  const [pairing, setPairing] = useState(false);

  /** Same one-shot pairing as the การสอน/วิชา page — see pairAll there. */
  const pairAllDuplicates = async () => {
    if (!pairable.length) return;
    setPairing(true);
    try {
      await api.bulkCreateRequirements(pairable.flatMap(({ a, b }) => [
        { group_id: a.group_id, subject_id: a.subject_id, teacher_id: a.teacher_id,
          weekly_count: a.weekly_count, parallel_group_key: a.parallel_group_key ?? null,
          co_teacher_id: b.teacher_id },
        { group_id: b.group_id, subject_id: b.subject_id, teacher_id: b.teacher_id,
          weekly_count: b.weekly_count, parallel_group_key: b.parallel_group_key ?? null,
          co_teacher_id: a.teacher_id },
      ]));
      useTimetableStore.setState({ requirements: await api.fetchRequirements() });
    } finally { setPairing(false); }
  };

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
        <StatCard icon="🔁" label="วิชาซ้ำ" value={dupCount}
          sub={dupCount === 0 ? "ไม่พบวิชาซ้ำ" : "ดูรายการด้านล่าง"}
          color={dupCount > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"} />
        <StatCard icon="👥" label="คู่สอนร่วม" value={pairs.length}
          sub={pairs.length === 0 ? "ยังไม่มีวิชาที่ครู 2 คนสอนด้วยกัน" : `รวม ${coTaught} คาบในตาราง`}
          color="bg-sky-50 border-sky-200" />
      </div>

      {/* ── ใครสอนร่วมกับใคร วิชาอะไร ──────────────────────────────────── */}
      {pairs.length > 0 && (
        <div className="border border-sky-200 rounded-xl overflow-hidden mb-6">
          <div className="px-4 py-3 bg-sky-50 border-b border-sky-200">
            <h3 className="text-sm font-bold text-sky-800">👥 ครูที่สอนร่วมกัน</h3>
            <p className="text-[11px] text-gray-600 mt-0.5">
              หนึ่งบรรทัดคือครูหนึ่งคู่กับหนึ่งวิชา · นับเป็นคาบเดียว ไม่ใช่คนละคาบ
            </p>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50/50">
              <tr>
                {["ครูคนที่ 1", "ครูคนที่ 2", "วิชา", "ห้อง", "คาบ/สัปดาห์"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pairs.map((p) => (
                <tr key={`${p.teacherA}-${p.teacherB}-${p.subjectId}`} className="hover:bg-sky-50/40">
                  <td className="px-3 py-2 text-gray-800">{tName(p.teacherA)}</td>
                  <td className="px-3 py-2 text-gray-800">{tName(p.teacherB)}</td>
                  <td className="px-3 py-2 font-medium text-gray-700">{sCode(p.subjectId)}</td>
                  <td className="px-3 py-2 text-gray-500" title={p.groupIds.map(gName).join(", ")}>
                    {p.groupIds.length} ห้อง
                    <span className="text-gray-400 ml-1">
                      {p.groupIds.slice(0, 5).map(gName).join(", ")}
                      {p.groupIds.length > 5 ? " …" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{p.periods}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ตรวจวิชาเสรีกับคาบเสรีให้ตรงกัน ───────────────────────────
          A subject marked เสรี is taught once, in a window. Any class whose
          plan has it but who sits in no such window gets an ordinary lesson
          of its own instead — with a teacher who is at that moment standing
          in the window teaching the same subject to everybody else. */}
      {(covGaps.length > 0 || electiveSubjectIds(subjects, pools, electiveSlotsAll).size > 0) && (
        <div className={`border rounded-xl overflow-hidden mb-6 ${
          covGaps.length > 0 ? "border-amber-300" : "border-green-200"}`}>
          <div className={`px-4 py-3 border-b ${
            covGaps.length > 0 ? "bg-amber-50 border-amber-300" : "bg-green-50 border-green-200"}`}>
            <h3 className={`text-sm font-bold ${
              covGaps.length > 0 ? "text-amber-800" : "text-green-700"}`}>
              🎓 ตรวจวิชาเสรีกับคาบเสรี
            </h3>
            <p className="text-[11px] text-gray-600 mt-0.5">
              ห้องที่ลงวิชาเสรีไว้ ต้องอยู่ในคาบเสรีที่เปิดวิชานั้นด้วย
              ไม่งั้นระบบจะจัดให้เป็นคาบธรรมดาแยกต่างหาก และครูจะชนกับคาบเสรีของตัวเอง
            </p>
          </div>
          <div className="p-3 space-y-1.5">
            {covGaps.length === 0 && (
              <p className="text-xs text-green-700">✅ ทุกห้องที่ลงวิชาเสรีไว้ อยู่ในคาบเสรีครบแล้ว</p>
            )}
            {covGaps.slice(0, 12).map((c) => (
              <div key={c.subjectId} className="text-xs">
                <span className="font-medium text-gray-800">{sCode(c.subjectId)}</span>
                <span className="text-amber-800">
                  {" "}— {c.missing.length} ห้องไม่ได้อยู่ในคาบเสรี
                  {c.noWindow && " (ยังไม่มีคาบเสรีไหนเปิดวิชานี้เลย)"}
                </span>
                <div className="text-[11px] text-gray-500">
                  {c.missing.slice(0, 12).map(gName).join(" · ")}
                  {c.missing.length > 12 && ` … อีก ${c.missing.length - 12}`}
                </div>
              </div>
            ))}
            {covGaps.length > 12 && (
              <p className="text-[11px] text-gray-500">… และอีก {covGaps.length - 12} วิชา</p>
            )}
          </div>
        </div>
      )}

      {/* ── ตรวจคาบห้องย่อย ────────────────────────────────────────────
          Runs itself off the timetable as it stands, so the answer is here
          the moment a lesson is placed or the whole week is generated. It
          reports; it does not insist. A subgroup lesson with nobody beside
          it is a normal thing, and only what cannot be taught is red. */}
      {subAudits.length > 0 && (
        <div className={`border rounded-xl overflow-hidden mb-6 ${
          subProblems > 0 ? "border-red-200" : "border-green-200"}`}>
          <div className={`px-4 py-3 border-b ${
            subProblems > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
            <h3 className={`text-sm font-bold ${
              subProblems > 0 ? "text-red-700" : "text-green-700"}`}>
              🧩 ตรวจคาบห้องย่อย (ก/ข/ค)
            </h3>
            <p className="text-[11px] text-gray-600 mt-0.5">
              ดูว่าแต่ละคาบห้องย่อยจับคู่กับอะไรบ้าง และคาบไหนมีห้องเดียวเรียน —
              <strong> ไม่จำเป็นต้องมีคู่ทุกคาบ</strong> คาบที่ห้องอื่นว่างถือว่าปกติ
            </p>
          </div>
          <div className="p-3 space-y-1.5">
            {subProblems === 0 && (
              <p className="text-xs text-green-700">
                ✅ ไม่พบคาบที่สอนจริงไม่ได้ (ห้องแม่เรียนทับ · ห้องสอนซ้ำ · ครูซ้ำ)
              </p>
            )}
            {subAudits.map((r) => (
              <div key={r.parentId} className="flex items-center gap-2 text-xs">
                <span className="font-medium text-gray-800 w-24 shrink-0">{r.parentName}</span>
                <span className="text-gray-500">
                  ครบทุกห้อง {r.fullCount} · บางห้องว่าง {r.partialCount}
                </span>
                {r.problemCount > 0 && (
                  <span className="text-red-700 font-semibold">⚠ ต้องแก้ {r.problemCount}</span>
                )}
                <button onClick={() => setAuditFor(r.parentId)}
                  className="ml-auto px-2 py-1 text-[11px] border border-indigo-200 text-indigo-700 rounded hover:bg-indigo-50">
                  ดูรายคาบ
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {auditFor != null && (
        <SubgroupSetModal onClose={() => setAuditFor(null)} initialParentId={auditFor} />
      )}

      {/* ── ตรวจสอบวิชาซ้ำ ─────────────────────────────────────────────── */}
      <div className={`border rounded-xl overflow-hidden mb-6 ${dupCount > 0 ? "border-red-200" : "border-green-200"}`}>
        <div className={`px-4 py-3 border-b ${dupCount > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
          <h3 className={`text-sm font-bold ${dupCount > 0 ? "text-red-700" : "text-green-700"}`}>
            🔁 ตรวจสอบวิชาซ้ำ
          </h3>
          <p className="text-[11px] text-gray-600 mt-0.5">
            1 ห้อง + 1 วิชา ควรมีครู 1 คน และลงคาบตามที่วางแผนไว้ —
            ถ้าตั้งใจให้ครู 2 คนสอนด้วยกัน ให้ใช้แถวเดียวแล้วใส่ช่อง <strong>👥 สอนร่วม</strong>
          </p>
        </div>
        <div className="p-3 space-y-2">
          {dupCount === 0 && (
            <p className="text-xs text-green-700">✅ ไม่พบห้อง-วิชาที่มีครูซ้ำกัน และไม่มีวิชาไหนลงเกินแผน</p>
          )}
          {pairable.length > 0 && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2.5">
              <p className="text-xs text-sky-900 mb-2">
                <strong>{pairable.length} ห้อง-วิชา</strong> ที่มีครู 2 คนและยังไม่ได้จับคู่ —
                ถ้าทั้งคู่สอนด้วยกันจริง กดปุ่มนี้ครั้งเดียว ระบบจะจับคู่ให้ทั้งหมด
                แล้วนับเป็นคาบเดียว ครูทั้งสองคนจะได้คาบเดียวกันห้องเดียวกัน
              </p>
              <button onClick={pairAllDuplicates} disabled={pairing}
                className="px-3 py-1.5 bg-sky-600 text-white text-xs rounded font-semibold hover:bg-sky-700 disabled:opacity-40">
                {pairing ? "กำลังจับคู่…" : `👥 จับคู่สอนร่วมให้ทั้งหมด (${pairable.length})`}
              </button>
            </div>
          )}
          {dup.splitTeachers.map((d) => (
            <div key={`t-${d.groupId}-${d.subjectId}`} className="text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <strong className="text-red-800">{gName(d.groupId)} · {sCode(d.subjectId)}</strong>
              {" — ถูกกำหนดให้ครู "}{d.teacherIds.length}{" คนจากคนละแถว: "}
              <span className="text-red-700">{d.teacherIds.map(tName).join(", ")}</span>
              {d.teacherIds.length > 2 && (
                <span className="text-gray-500">
                  {" · มีครูเกิน 2 คน ระบบจับคู่ให้เองไม่ได้ ต้องเลือกว่าใครสอนที่หน้า “📋 การสอน/วิชา”"}
                </span>
              )}
            </div>
          ))}
          {dup.overPlaced.map((d) => (
            <div key={`p-${d.groupId}-${d.subjectId}`} className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <strong className="text-amber-800">{gName(d.groupId)} · {sCode(d.subjectId)}</strong>
              {" — ลงตาราง "}{d.placed}{" คาบ แต่แผนขอไว้ "}{d.planned}{" คาบ (เกิน "}{d.placed - d.planned}{" คาบ)"}
            </div>
          ))}
        </div>
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

        {/* ใครเดินหาใคร — ห้องของครู vs ห้องประจำชั้นของนักเรียน */}
        <div className="border-t border-gray-100 pt-4 mb-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">
            เวลาคาบหนึ่งไม่ได้ต้องใช้ห้องพิเศษ ใครเดินไปหาใคร
          </p>
          <div className="flex flex-col gap-2">
            {([[false, "🏫 นักเรียนอยู่กับที่ ครูเดินไปสอน",
                "ห้องประจำชั้นมาก่อนทั้งห้องเฉพาะกลุ่มสาระและห้องของครู — ชั้นที่ไม่มีห้องประจำจึงจะไปห้องอื่น"],
               [true, "🚶 นักเรียนเดินไปหาครู",
                "ห้องของครูมาก่อน ใช้กับโรงเรียนที่ครูประจำห้องตัวเองและนักเรียนเดินเรียน"],
              ] as const).map(([val, title, hint]) => (
              <label key={String(val)}
                className={clsx("flex gap-2 items-start rounded-lg border px-3 py-2 cursor-pointer",
                  !!schoolConfig.teacher_room_over_homeroom === val
                    ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-300")}>
                <input type="radio" className="mt-0.5 accent-blue-600"
                  checked={!!schoolConfig.teacher_room_over_homeroom === val}
                  onChange={() => { setSchoolConfig({ teacher_room_over_homeroom: val }); setSaved(false); }} />
                <span>
                  <span className="text-sm font-medium text-gray-800">{title}</span>
                  <span className="block text-[11px] text-gray-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            ลำดับทั้งหมด: วิชาที่ตั้งว่า “ต้องเรียนที่ห้องประจำวิชา” → ห้องที่กันไว้ให้ชั้นเรียน →
            ห้องประจำชั้น → ห้องเฉพาะกลุ่มสาระ → ห้องของครู · ถ้าวิชาไหนต้องเข้าห้องแล็บ/ห้องคอม
            จริง ๆ ให้ตั้งที่รายวิชานั้นว่า “ต้องเรียนที่ห้องประจำวิชา” ·
            ตั้งสวนทางเป็นรายคนได้ที่การตั้งค่าของครูแต่ละคน
          </p>

          {/* "ห้องที่มีครูประจำอยู่ ที่จะให้นักเรียนเข้ามาเรียนในนี้ ถ้าเป็น
              ม.ปลายบังคับให้ลงครูที่มีชื่อก่อน แล้วค่อยลงครูในหมวดกลุ่มสาระ"

              คนละช่องกับตัวเลือกข้างบน: ข้างบนคือ "ห้องประจำของครู" ที่ตั้งจาก
              หน้าครู ส่วนอันนี้คือ "กันห้องนี้ไว้ให้ครู" ที่ตั้งจากหน้าห้องสอน
              ซึ่งหมายถึงห้องที่มีไว้ให้สอน ไม่ใช่ห้องที่ครูชอบนั่ง */}
          <label className="mt-3 flex gap-2 items-start rounded-lg border border-gray-200
                            px-3 py-2 cursor-pointer hover:border-blue-300">
            <input type="checkbox" className="mt-0.5 accent-blue-600"
              checked={schoolConfig.upper_teacher_room_first !== false}
              onChange={(e) => {
                setSchoolConfig({ upper_teacher_room_first: e.target.checked });
                setSaved(false);
              }} />
            <span>
              <span className="text-sm font-medium text-gray-800">
                ม.ปลายเดินไปเรียนที่ห้องที่กันไว้ให้ครู
              </span>
              <span className="block text-[11px] text-gray-500">
                ห้องที่หน้า 🚪 ห้องสอน “กันไว้ให้ครู” จะได้คาบของครูคนนั้นก่อน แล้วค่อยเติมครู
                ในกลุ่มสาระที่ห้องนั้นเป็นของ — ม.ต้นไม่เกี่ยว ยังอยู่ห้องประจำชั้นของตัวเอง
              </span>
            </span>
          </label>
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

          {/* ประวัติย้อนหลังบนเซิร์ฟเวอร์ — the copies the server keeps itself,
              so a loss is not something only this browser can undo. */}
          <div className="pt-3 mt-1 border-t border-amber-200">
            <p className="text-sm font-bold text-blue-900 mb-2">
              🕘 ประวัติย้อนหลังบนเซิร์ฟเวอร์ — ย้อนกลับไปเวลาที่ข้อมูลยังครบ
            </p>
            <ServerHistoryPanel onRestored={async () => {
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
