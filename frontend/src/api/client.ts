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
  // Used by the วิชาเสรี import, which builds a whole window at once. Options
  // added this way may have no teacher yet — a term's elective list arrives
  // before the teaching is shared out.
  raw_group?: string; weekly?: number;
  options?: { subject_id: number; teacher_id?: number | null; label?: string }[];
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
  /**
   * ครูผู้ดูแลของกิจกรรม — one list for the whole activity, overriding
   * teacher_mode. Everyone on it gets the period; who takes which classroom
   * is left to them.
   */
  teacher_ids?: number[];
  room_mode?: "homeroom" | "none";
}) => api.post<{
  created: TimetableSlot[];
  skipped: { group: string; reason: string }[];
  warnings: string[];
  activity_key: string;
}>("/timetable/level-activity", d).then((r) => r.data);

/**
 * Change an activity that is already on the board.
 *
 * Anything left out keeps what it had, so moving ชุมนุม to another period does
 * not mean re-ticking sixty classrooms. If nothing could be placed at the new
 * time the old activity is left exactly as it was and the call fails.
 */
export const updateLevelActivity = (activityKey: string, d: {
  label?: string;
  day?: number; period?: number; subject_id?: number;
  group_ids?: number[];
  teacher_mode?: "homeroom" | "single" | "none";
  teacher_id?: number | null;
  teacher_ids?: number[];
  room_mode?: "homeroom" | "none";
}) =>
  // The key travels in the body, not in the path. Some keys already saved
  // carry the activity's own name — "ACT-ลูกเสือ/เนตรนารี-3-1-7" — and a
  // slash in a path is a new segment, so the route never matched and both
  // แก้ไข and ลบ answered Not Found.
  api.post<{
    created: TimetableSlot[];
    skipped: { group: string; reason: string }[];
    warnings: string[];
    activity_key: string;
    replaced: number;
  }>("/timetable/level-activity/update", { ...d, activity_key: activityKey })
    .then((r) => r.data);

export const deleteLevelActivity = (activityKey: string) =>
  api.post<{ removed: number }>("/timetable/level-activity/delete",
    { activity_key: activityKey }).then((r) => r.data);

// ── Live collaboration ───────────────────────────────────────────────────────
/** Tiny poll: returns the server's data revision so we can detect other people's edits. */
export const fetchStateVersion = () =>
  api.get<{
    revision: number; slots: number;
    /** When the SERVER last wrote to its database. The answer that matters. */
    saved_at?: string | null;
    /** A save is built and on its way out. */
    pending?: boolean;
    store?: "postgres" | "file";
    store_error?: string | null;
  }>("/state/version", { timeout: 8000 }).then((r) => r.data);

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
  /** เพดานคาบสุดท้าย/สัปดาห์ต่อครู — 0 = ไม่จำกัด */
  max_last_period?: number;
  /**
   * คาบสุดท้ายของวัน — "reserve" ใช้เมื่อจำเป็น (ค่าเริ่มต้น),
   * "never" ไม่ใช้เลย, "free" ใช้ได้ตามปกติ
   */
  last_period_mode?: "reserve" | "never" | "free";
}) => api.post<SolverResult>("/timetable/solve", p).then((r) => r.data);

// ── ส่งต่อครู ────────────────────────────────────────────────────────────────
/** ห้องหนึ่งห้องที่ครูคนนี้สอนวิชานั้นอยู่ */
export interface HoldingClass {
  requirement_id: number;
  group_id:       number;
  group_name:     string;
  weekly_count:   number;
  /** คาบของวิชานี้ที่ลงในตารางให้ห้องนี้แล้ว */
  placed:         number;
}

export interface HoldingSubject {
  subject_id: number;
  code:       string;
  name:       string;
  /** คาบ/สัปดาห์ รวมทุกห้อง */
  weekly:     number;
  placed:     number;
  classes:    HoldingClass[];
}

/** วิชาที่ครูคนนี้เปิดสอนอยู่ในคาบเสรี */
export interface HoldingElective {
  subject_id: number;
  code:       string;
  name:       string;
  pools:      number;
  slots:      number;
  /** ชื่อชุด/ห้องที่มันไปโผล่ */
  where:      string[];
}

/** หน้าที่ดูแลกิจกรรม — แสดงให้เห็น แต่ยังไม่ได้โอนให้ */
export interface HoldingActivity {
  activity_key: string;
  name:         string;
  slots:        number;
}

export interface TeacherHoldings {
  teacher:    { id: number; name: string };
  subjects:   HoldingSubject[];
  electives:  HoldingElective[];
  activities: HoldingActivity[];
  totals:     { rows: number; weekly: number; slots: number };
}

/** คาบที่ครูผู้รับช่วงจะต้องยืนสองที่พร้อมกัน */
export interface HandoverClash {
  day:           number;
  period:        number;
  group_name:    string | null;
  subject_code:  string | null;
  with_group:    string | null;
  with_subject:  string | null;
}

export interface HandoverResult {
  ok:          boolean;
  /** false = พรีวิว ยังไม่ได้แตะข้อมูล */
  applied:     boolean;
  rows:        number;
  slots:       number;
  electives:   number;
  clashes:     HandoverClash[];
  /** หน้าที่ดูแลกิจกรรมที่ยังค้างอยู่กับครูคนเดิม */
  activities_left: number;
  to_teacher:  { id: number; name: string };
}

export const fetchTeacherHoldings = (id: number) =>
  api.get<TeacherHoldings>(`/teachers/${id}/holdings`).then((r) => r.data);

export const teacherHandover = (p: {
  from_teacher_id: number;
  to_teacher_id: number;
  requirement_ids?: number[];
  elective_subject_ids?: number[];
  dry_run?: boolean;
}) => api.post<HandoverResult>("/teachers/handover", p).then((r) => r.data);

// ── ตรวจคาบสุดท้าย / คาบว่าง ของแต่ละห้อง ───────────────────────────────────
export interface PeriodCheckRow {
  group_id: number;
  name: string | null;
  parent_id: number | null;
  level: string;
  /** เลขคาบสุดท้ายของระดับชั้นนี้ (เช่น 9) */
  last_period_num: number;
  /** คาบที่ห้องนี้เรียนในคาบสุดท้าย ทั้งสัปดาห์ */
  last: number;
  /** ช่องว่างในคาบก่อนคาบสุดท้าย */
  free: number;
  /** ช่องว่างที่ยังมีคาบเรียนตามมาในวันเดียวกัน */
  gaps: number;
  /** คาบที่ยังจัดไม่ลงตัว (กรอบแดง) */
  overflow: number;
  lessons: number;
  want_last: number | null;
  want_free: number | null;
  verdict_last: string | null;
  verdict_free: string | null;
}

export interface PeriodCheckReport {
  rows: PeriodCheckRow[];
  total: number;
  with_last: number;
  last_slots: number;
  overflow: number;
  set: number;
  off: number;
}

export const fetchPeriodCheck = () =>
  api.get<PeriodCheckReport>("/diagnostics/period-check").then((r) => r.data);

export const savePeriodTargets = (
  targets: { group_id: number; last?: number | null; free?: number | null }[],
) => api.put<PeriodCheckReport>("/diagnostics/period-check", { targets })
  .then((r) => r.data);

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

/**
 * คาบที่ลงไม่ได้ และเหตุผล.
 *
 * "ไม่สามารถจัด ค32205 ครบ 3 คาบ" says what happened and nothing about why.
 * This walks the class's week cell by cell and reports what stood in the way,
 * how often, and which of its lessons could move outdoors to free a room.
 */
export interface UnplacedBlocker {
  kind: "teacher_off" | "group_busy" | "teacher_busy" | "consecutive" | "no_room";
  count: number;
  example: string;
}
export interface UnplacedMovable {
  slot_id: number; day: number; period: number;
  subject_id: number | null; subject_code: string | null; subject_name: string | null;
  room_name: string | null; already_allowed: boolean;
}
export interface UnplacedRow {
  requirement_id: number;
  group_id: number; group_name: string | null;
  subject_id: number; subject_code: string | null; subject_name: string | null;
  teacher_id: number; teacher_name: string | null;
  wanted: number; placed: number; missing: number;
  /** Placed in the week, but with no room at all. */
  roomless: number;
  is_elective: boolean;
  /** The ห้องเรียน this row names is not in the system any more. */
  orphan?: boolean;
  free_cells: { day: number; period: number }[];
  blockers: UnplacedBlocker[];
  movable_outdoor: UnplacedMovable[];
  week_size: number;
}

/** แถวที่ผูกกับห้องเรียนที่ถูกลบไปแล้ว — never placeable, never explained. */
export const fetchOrphanReqs = () =>
  api.get<{ count: number; periods: number;
            rows: { id: number; group_id: number; subject_code: string | null;
                    subject_name: string | null; teacher_name: string | null;
                    weekly_count: number }[] }>(
    "/timetable/requirements/orphans").then((r) => r.data);

export const purgeOrphanReqs = () =>
  api.delete<{ deleted: number }>("/timetable/requirements/orphans").then((r) => r.data);
export const fetchUnplaced = () =>
  api.get<{ unplaced: UnplacedRow[]; total_missing: number;
            total_roomless?: number; total_rows?: number; shown?: number;
            last_run: unknown }>(
    "/timetable/unplaced").then((r) => r.data);

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
    /** The server is refusing to save, because what it holds is not the school's. */
    write_blocked?: boolean;
    counts: Record<string, number>;
  }>("/state/info").then((r) => r.data);

// ── ประวัติย้อนหลังบนเซิร์ฟเวอร์ ─────────────────────────────────────────────
// Dated copies kept in the database alongside the live one. The live copy is
// overwritten by every save; these are not, so there is always a way back.
export interface StateHistoryPoint {
  id: number;
  saved_at: string | null;
  slots: number | null;
  note: string | null;
  bytes: number;
}

export const fetchStateHistory = () =>
  api.get<{ available: boolean; reason?: string; keep?: number; points: StateHistoryPoint[] }>(
    "/state/history").then((r) => r.data);

export const restoreStateHistory = (id: number) =>
  api.post<{ restored: Record<string, number>; saved_at?: string }>(
    `/state/history/${id}/restore`, {}).then((r) => r.data);

/** "Keep what this server is holding" — the way past the save refusal. */
export const adoptServerState = () =>
  api.post<{ ok: boolean; slots: number }>("/state/adopt", {}).then((r) => r.data);

// ── ตั้งค่าโรงเรียน ──────────────────────────────────────────────────────────
// Kept on the server, not in the browser, so both people editing see the same
// school name and logo and it survives a refresh.
export const fetchSchoolConfig = () =>
  api.get<SchoolConfig>("/school/config").then((r) => r.data);

export const updateSchoolConfig = (c: Partial<SchoolConfig>) =>
  api.put<SchoolConfig>("/school/config", c).then((r) => r.data);

/** ตรวจความสอดคล้องของข้อมูล — จุดที่แก้ที่หนึ่งแล้วอีกที่ไม่ตาม */
export interface ConsistencyFinding {
  code: string;
  title: string;
  why: string;
  count: number;
  examples: string[];
  fixable: boolean;
  fix?: string | null;
  severity: "blocking" | "warning";
}
export interface ConsistencyReport {
  findings: ConsistencyFinding[];
  total: number;
  blocking: number;
  checked: {
    requirements: number; slots: number; groups: number;
    teachers: number; subjects: number; rooms: number; pools: number;
  };
}

export const fetchConsistency = () =>
  api.get<ConsistencyReport>("/diagnostics/consistency").then((r) => r.data);

export const repairConsistency = (codes?: string[]) =>
  api.post<{ fixed: Record<string, number>; total: number;
             remaining: ConsistencyFinding[] }>(
    "/diagnostics/repair", codes ? { codes } : {}).then((r) => r.data);
