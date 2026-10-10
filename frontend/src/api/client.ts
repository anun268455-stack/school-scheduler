import axios from "axios";
import type {
  Building, Department, LessonRequirement, Period, Room,
  ElectivePool, PoolTeacherCandidate, RequirementProblemReport, SchoolConfig, SolverResult, StudentGroup, Subject, Teacher, TimetableSlot,
} from "../types";

// In production (GitHub Pages), use the Render backend URL via env var
// In development, use the Vite proxy at /api
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : "/api";

const api = axios.create({ baseURL: BASE_URL, timeout: 180_000 });

// ── Departments ──────────────────────────────────────────────────────────────
export const fetchDepartments  = () => api.get<Department[]>("/departments/").then((r) => r.data);
export const createDepartment  = (d: Partial<Department>) => api.post<Department>("/departments/", d).then((r) => r.data);
export const updateDepartment  = (id: number, d: Partial<Department>) => api.put<Department>(`/departments/${id}`, d).then((r) => r.data);
export const deleteDepartment  = (id: number) => api.delete(`/departments/${id}`);

/** รหัสประจำตัวครูตามกลุ่มสาระ — write the dragged order and the codes it implies. */
export const renumberDepartment = (id: number, p: {
  code_base?: number; teacher_ids: number[];
}) => api.post<{
  code_base: number; count: number;
  changed: { id: number; name: string | null; was: string | null; now: string }[];
  teachers: { id: number; name: string | null; code: string | null; dept_order: number }[];
}>(`/departments/${id}/renumber`, p).then((r) => r.data);

// ── Periods ──────────────────────────────────────────────────────────────────
export const fetchPeriods   = () => api.get<Period[]>("/periods/").then((r) => r.data);
export const createPeriod   = (d: Partial<Period>) => api.post<Period>("/periods/", d).then((r) => r.data);
export const updatePeriod   = (id: number, d: Partial<Period>) => api.put<Period>(`/periods/${id}`, d).then((r) => r.data);
export const deletePeriod   = (id: number) => api.delete(`/periods/${id}`);

// ── Rooms & Buildings ────────────────────────────────────────────────────────
export const fetchBuildings  = () => api.get<Building[]>("/rooms/buildings").then((r) => r.data);
export const fetchRooms      = () => api.get<Room[]>("/rooms/").then((r) => r.data);
export const createRoom      = (d: Partial<Room>) => api.post<Room>("/rooms/", d).then((r) => r.data);
export const updateRoom      = (id: number, d: Partial<Room>) => api.put<Room>(`/rooms/${id}`, d).then((r) => r.data);
export const deleteRoom      = (id: number) => api.delete(`/rooms/${id}`);
export const createBuilding  = (d: Partial<Building>) => api.post<Building>("/rooms/buildings", d).then((r) => r.data);
export const bulkCreateRooms = (rows: Partial<Room>[]) => api.post<Room[]>("/rooms/bulk", rows).then((r) => r.data);

// ── Groups ───────────────────────────────────────────────────────────────────
export const fetchGroups      = () => api.get<StudentGroup[]>("/groups/").then((r) => r.data);
export const createGroup      = (d: Partial<StudentGroup>) => api.post<StudentGroup>("/groups/", d).then((r) => r.data);
export const updateGroup      = (id: number, d: Partial<StudentGroup>) => api.put<StudentGroup>(`/groups/${id}`, d).then((r) => r.data);
export const deleteGroup      = (id: number) => api.delete(`/groups/${id}`);
export const bulkCreateGroups = (rows: Partial<StudentGroup>[]) => api.post<StudentGroup[]>("/groups/bulk", rows).then((r) => r.data);

// ── Teachers ─────────────────────────────────────────────────────────────────
export const fetchTeachers      = () => api.get<Teacher[]>("/teachers/").then((r) => r.data);
export const createTeacher      = (d: Partial<Teacher>) => api.post<Teacher>("/teachers/", d).then((r) => r.data);
export const updateTeacher      = (id: number, d: Partial<Teacher>) => api.put<Teacher>(`/teachers/${id}`, d).then((r) => r.data);
export const deleteTeacher      = (id: number) => api.delete(`/teachers/${id}`);
export const bulkCreateTeachers = (rows: Partial<Teacher>[]) => api.post<Teacher[]>("/teachers/bulk", rows).then((r) => r.data);

// ── Subjects ──────────────────────────────────────────────────────────────────
export const fetchSubjects      = () => api.get<Subject[]>("/subjects/").then((r) => r.data);
export const createSubject      = (d: Partial<Subject>) => api.post<Subject>("/subjects/", d).then((r) => r.data);
export const updateSubject      = (id: number, d: Partial<Subject>) => api.put<Subject>(`/subjects/${id}`, d).then((r) => r.data);
/** ☀️ เช้า for a whole กลุ่มสาระ (or any set of subjects) in one request. */
export const setPreferMorning = (p: {
  prefer_morning: boolean;
  ids?: number[];
  department_id?: number;
  all?: boolean;
}) => api.post<{
  changed: number; matched: number;
  subjects: { id: number; prefer_morning: boolean }[];
}>("/subjects/prefer-morning", p).then((r) => r.data);

export const deleteSubject      = (id: number) => api.delete(`/subjects/${id}`);
export const bulkCreateSubjects = (rows: Partial<Subject>[]) => api.post<Subject[]>("/subjects/bulk", rows).then((r) => r.data);

// ── Requirements ─────────────────────────────────────────────────────────────
export const fetchRequirements = (groupId?: number) =>
  api.get<LessonRequirement[]>("/timetable/requirements", { params: { group_id: groupId } }).then((r) => r.data);
export const createRequirement = (d: Partial<LessonRequirement>) =>
  api.post<LessonRequirement>("/timetable/requirements", d).then((r) => r.data);
export const updateRequirement = (id: number, d: Partial<LessonRequirement>) =>
  api.put<LessonRequirement>(`/timetable/requirements/${id}`, d).then((r) => r.data);
export const bulkCreateRequirements = (rows: Partial<LessonRequirement>[]) =>
  api.post<LessonRequirement[]>("/timetable/requirements/bulk", rows).then((r) => r.data);
export const deleteRequirement = (id: number) => api.delete(`/timetable/requirements/${id}`);

// ── Timetable Slots ──────────────────────────────────────────────────────────
export const fetchSlots = (params?: { group_id?: number; teacher_id?: number; day?: number; room_id?: number }) =>
  api.get<TimetableSlot[]>("/timetable/slots", { params }).then((r) => r.data);
export const createSlot = (d: Partial<TimetableSlot>) =>
  api.post<TimetableSlot>("/timetable/slots", d).then((r) => r.data);
export const updateSlot = (id: number, d: Partial<TimetableSlot>) =>
  api.patch<TimetableSlot>(`/timetable/slots/${id}`, d).then((r) => r.data);
export const deleteSlot  = (id: number) => api.delete(`/timetable/slots/${id}`);

/**
 * Move several lessons at once, all or nothing.
 *
 * A swap moves two lessons through each other, so each half on its own looks
 * like a clash — they have to be judged against the result, together. The
 * backend rejects the whole set and changes nothing if the result would double
 * -book a class, a teacher or a room.
 */
export const moveSlots = (
  moves: { slot_id: number; day?: number; period?: number; room_id?: number | null }[],
  force = false,
) => api.post<{ ok: boolean; conflicts: string[]; slots: TimetableSlot[] }>(
  "/timetable/slots/move", { moves, force }).then((r) => r.data);
/** Empty the timetable. "unlocked" spares locked periods; "all" wipes them too. */
export const clearSlots = (params?: {
  scope?: "unlocked" | "all"; group_id?: number; teacher_id?: number;
}) =>
  api.delete<{ deleted: number; remaining: number }>("/timetable/slots", { params })
    .then((r) => r.data);

// ── Elective Slots (วิชาเสรี) ────────────────────────────────────────────────
export const createElectiveSlot = (d: {
  group_id: number; day: number; period: number;
  subject_id: number; teacher_id: number; label?: string; room_id?: number | null;
  is_double?: boolean;
}) => api.post<TimetableSlot>("/timetable/elective-slots", d).then((r) => r.data);

export const addElectiveOption = (slotId: number, d: { subject_id: number; teacher_id: number; label?: string }) =>
  api.post<TimetableSlot>(`/timetable/elective-slots/${slotId}/options`, d).then((r) => r.data);

export const deleteElectiveOption = (slotId: number, optionId: number) =>
  api.delete<TimetableSlot>(`/timetable/elective-slots/${slotId}/options/${optionId}`).then((r) => r.data);

export const selectElectiveOption = (slotId: number, optionId: number) =>
  api.patch<TimetableSlot>(`/timetable/elective-slots/${slotId}/select`, { option_id: optionId }).then((r) => r.data);

/** Copy an elective to other classes. Classes already busy then are skipped. */
export const copyElectiveSlot = (slotId: number, targetGroupIds: number[]) =>
  api.post<{
    created: TimetableSlot[];
    skipped: { group_id: number; group_name?: string; reason: string }[];
  }>(`/timetable/elective-slots/${slotId}/copy`, { target_group_ids: targetGroupIds })
    .then((r) => r.data);

// ── คาบเสรี (elective windows / pools) ──────────────────────────────────────
// A window is created and pinned to a day/period FIRST, then subjects are added
// into it. Every call returns the whole window back, already carrying each
// subject's teacher and any clash, so the UI never has to work that out itself.
export const fetchElectivePools = () =>
  api.get<ElectivePool[]>("/elective-pools").then((r) => r.data);

export const createElectivePool = (d: {
  name?: string; group_ids: number[];
  day?: number | null; period?: number | null; is_double?: boolean;
}) => api.post<ElectivePool>("/elective-pools", d).then((r) => r.data);

export const updateElectivePool = (id: number, d: {
  name?: string; group_ids?: number[]; is_double?: boolean;
  day?: number | null; period?: number | null;
}) => api.put<ElectivePool>(`/elective-pools/${id}`, d).then((r) => r.data);

export const deleteElectivePool = (id: number) => api.delete(`/elective-pools/${id}`);

/** Pin (or move) the window. Returns how many classes took it and which didn't. */
export const placeElectivePool = (id: number, d: { day: number; period: number; is_double?: boolean }) =>
  api.post<{
    created: number;
    skipped: { group_id: number; group_name?: string; reason: string }[];
    pool: ElectivePool;
  }>(`/elective-pools/${id}/place`, d).then((r) => r.data);

export const unplaceElectivePool = (id: number) =>
  api.delete<{ deleted: number }>(`/elective-pools/${id}/placement`).then((r) => r.data);

/** Add a subject. Omit teacher_id and the staffing data decides who teaches it. */
export const addPoolOption = (id: number, d: { subject_id: number; teacher_id?: number; label?: string }) =>
  api.post<ElectivePool>(`/elective-pools/${id}/options`, d).then((r) => r.data);

export const updatePoolOption = (id: number, key: number, d: { teacher_id?: number; subject_id?: number; label?: string }) =>
  api.put<ElectivePool>(`/elective-pools/${id}/options/${key}`, d).then((r) => r.data);

export const deletePoolOption = (id: number, key: number) =>
  api.delete<ElectivePool>(`/elective-pools/${id}/options/${key}`).then((r) => r.data);

/** Who can take a subject in this window, free teachers and own-department first. */
export const fetchPoolTeachers = (id: number, subjectId?: number) =>
  api.get<PoolTeacherCandidate[]>(`/elective-pools/${id}/teachers`, {
    params: subjectId ? { subject_id: subjectId } : undefined,
  }).then((r) => r.data);

// Bulk lock/unlock slots by filter
export const bulkLockSlots = (params: {
  is_locked: boolean;
  filters: { group_level?: string; day?: number; period?: number; subject_id?: number };
}) => api.post<{ affected: number }>("/timetable/slots/bulk-lock", params).then((r) => r.data);

// ── Level-wide activity periods (คาบกิจกรรมประจำระดับชั้น) ───────────────────
export const createLevelActivity = (d: {
  /** The classes to pin the activity onto — ลูกเสือ is ม.1–3, ชุมนุม is everyone. */
  group_ids?: number[];
  /** What to call the set on screen, e.g. "ม.1–ม.3" or "ทุกห้อง". */
  label?: string;
  /** Kept for activities created by the old per-level screen. */
  level?: string;
  day: number; period: number; subject_id: number;
  teacher_mode?: "homeroom" | "single" | "none";
  teacher_id?: number | null;
  /** ครูผู้ดูแลรายห้อง — {group_id: [teacher_id, …]}, overrides teacher_mode. */
  supervisors?: Record<number, number[]>;
  room_mode?: "homeroom" | "none";
}) => api.post<{
  created: TimetableSlot[];
  skipped: { group: string; reason: string }[];
  warnings: string[];
  activity_key: string;
}>("/timetable/level-activity", d).then((r) => r.data);

export const deleteLevelActivity = (activityKey: string) =>
  api.delete<{ removed: number }>(`/timetable/level-activity/${encodeURIComponent(activityKey)}`)
    .then((r) => r.data);

// ── Live collaboration ───────────────────────────────────────────────────────
/** Tiny poll: returns the server's data revision so we can detect other people's edits. */
export const fetchStateVersion = () =>
  api.get<{ revision: number; slots: number }>("/state/version", { timeout: 8000 }).then((r) => r.data);

// ── Solver ───────────────────────────────────────────────────────────────────
export const runSolver = (p: {
  clear_existing?: boolean;
  time_limit_seconds?: number;
  locked_slot_ids?: number[];
  /** Leave these lesson requirements out of the run entirely. */
  exclude_requirement_ids?: number[];
  /** true = skip everything flagged; "blocking" = only the impossible ones. */
  skip_problems?: boolean | "blocking";
  /** Most periods in a row one teacher may be given. */
  max_consecutive?: number;
  /** What to aim for, below the ceiling. */
  prefer_consecutive?: number;
  /** เวรคาบสุดท้าย: last-period lessons each teacher should carry per week. */
  min_last_period?: number;
}) => api.post<SolverResult>("/timetable/solve", p).then((r) => r.data);

/** วิชาที่มีปัญหา — what cannot be scheduled, checked before a run. */
export const fetchRequirementProblems = () =>
  api.get<RequirementProblemReport>("/timetable/problems").then((r) => r.data);

// ── สำรอง / กู้คืนข้อมูล ─────────────────────────────────────────────────────
// The server keeps everything in memory and writes a snapshot to disk, but a
// free host hands out a fresh, empty filesystem on every redeploy — so the
// downloaded file is the only copy that reliably outlives a deployment.
export const downloadBackup = () =>
  api.get<Record<string, unknown>>("/backup").then((r) => r.data);

export const restoreBackup = (data: unknown) =>
  api.post<{ restored: Record<string, number>; saved_at?: string }>("/restore", data)
    .then((r) => r.data);

// ── เลขคาบ ───────────────────────────────────────────────────────────────────
// period_num is a column index the timetable refers to; it is derived from the
// clock rather than typed, so a stray number cannot drop a period off the grid.
export const fetchPeriodPlan = () =>
  api.get<{
    plan: { period_num: number; rows: {
      id: number; label: string; type: string;
      start_time: string; end_time: string; applies_to: string; period_num: number;
    }[] }[];
    moves: { id: number; label: string; from: number; to: number }[];
    issues: { level: string; kind: string; minutes?: number; text: string }[];
    needs_renumber: boolean;
  }>("/periods/plan").then((r) => r.data);

/** Renumber the columns from the clock, carrying every placed lesson with them. */
export const renumberPeriods = () =>
  api.post<{ columns: number; slots_moved: number }>("/periods/renumber", {})
    .then((r) => r.data);

export const fetchStateInfo = () =>
  api.get<{
    revision: number;
    source: "snapshot" | "seed" | "demo";
    disk_snapshot: boolean;
    /** Where the data is really being kept right now. */
    store?: "postgres" | "file";
    /** Whether a database was configured at all, which is a different thing. */
    store_configured?: boolean;
    store_error?: string | null;
    last_saved_at?: string | null;
    counts: Record<string, number>;
  }>("/state/info").then((r) => r.data);

// ── ตั้งค่าโรงเรียน ──────────────────────────────────────────────────────────
// Kept on the server, not in the browser, so both people editing see the same
// school name and logo and it survives a refresh.
export const fetchSchoolConfig = () =>
  api.get<SchoolConfig>("/school/config").then((r) => r.data);

export const updateSchoolConfig = (c: Partial<SchoolConfig>) =>
  api.put<SchoolConfig>("/school/config", c).then((r) => r.data);
