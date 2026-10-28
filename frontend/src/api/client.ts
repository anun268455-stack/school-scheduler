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

/**
 * สร้างตาราง รอได้นานกว่าคำขออื่น
 *
 * "ถ้ามันนานก็ปล่อยให้นานไปเลย อยากให้มันเสร็จ"
 *
 * คำขอทั่วไปที่ค้างเกินสามนาทีคือค้างจริง ยอมแพ้ดีกว่าให้คนนั่งรอหน้าค้าง แต่
 * การจัดตารางทั้งโรงเรียนเป็นงานที่ "นาน" กับ "พัง" หน้าตาเหมือนกันจากฝั่งนี้
 * และของโรงเรียนเคยใช้ไป 109 วินาที เหลือที่หายใจจากเพดานสามนาทีไม่ถึงเท่าตัว
 * พอข้อมูลโตขึ้นอีกนิดเดียวก็ชนเพดาน ทั้งที่เซิร์ฟเวอร์ยังคิดอยู่ดีๆ
 *
 * สิบห้านาทีจึงเป็นเพดานของงานนี้โดยเฉพาะ ไม่ใช่ของทั้งแอป
 */
export const SOLVE_TIMEOUT_MS = 15 * 60 * 1000;

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
/** สิ่งที่ /requirements/bulk ตอบกลับมาจริง */
export type BulkReqResult = {
  created: LessonRequirement[];
  rejected: { row: number; reason: string }[];
  updated: LessonRequirement[];
  unchanged: number;
  merged: number;
  teachers_filled: number;
};

/** แถวที่ถูกปฏิเสธ — โยนออกมาเพื่อให้ตัวเรียกเห็น ไม่ใช่กลืนหายไปเฉยๆ */
export class BulkRejected extends Error {
  constructor(public result: BulkReqResult) {
    super(result.rejected.map((x) => x.reason).join(" · "));
    this.name = "BulkRejected";
  }
}

/**
 * ปลายทางนี้ปฏิเสธเป็น "รายแถว" โดยตั้งใจ — นำเข้าทั้งไฟล์แล้วแถวเสียแถวเดียว
 * ต้องไม่ล้มทั้งไฟล์ แต่มันจึงตอบ 200 เสมอ แม้จะไม่ได้สร้างอะไรเลย
 *
 * และตอบคนละรูปสองแบบ: เป็น "ลิสต์" เมื่อทุกแถวผ่าน เป็น "ก้อน" เมื่อมีแถวถูก
 * ปฏิเสธ/ถูกรวม ตัวเรียกทุกที่เขียนไว้ว่าได้ลิสต์ จึงไม่มีใครอ่านเหตุผลเลย
 * ผลคือกดปุ่มเพิ่มวิชาแล้วไม่มีอะไรเกิดขึ้นและไม่มีข้อความใดๆ ขึ้นมาบอก
 * ซึ่งอ่านเหมือนปุ่มเสีย ทั้งที่เซิร์ฟเวอร์ตอบเหตุผลไว้ครบแล้ว
 */
const bulkReqRaw = (rows: Partial<LessonRequirement>[]) =>
  api.post<LessonRequirement[] | Partial<BulkReqResult>>(
    "/timetable/requirements/bulk", rows,
  ).then((r): BulkReqResult => {
    const d = r.data;
    if (Array.isArray(d)) {
      return { created: d, rejected: [], updated: [], unchanged: 0,
               merged: 0, teachers_filled: 0 };
    }
    return { created: d.created ?? [], rejected: d.rejected ?? [],
             updated: d.updated ?? [], unchanged: d.unchanged ?? 0,
             merged: d.merged ?? 0, teachers_filled: d.teachers_filled ?? 0 };
  });

/** ใช้ตอนนำเข้าไฟล์ ซึ่งมีหน้าจอรายงานแถวที่ถูกปฏิเสธอยู่แล้ว */
export const bulkCreateRequirementsReport = bulkReqRaw;

/**
 * ใช้ตอนกดเพิ่มทีละวิชา/ทีละห้อง ซึ่งคนกดคาดว่าจะได้ผลหรือได้คำอธิบาย
 * แถวที่ถูกปฏิเสธจึงโยนเป็น error ให้ตัวเรียกแสดงเหตุผลตามปกติ
 */
export const bulkCreateRequirements = async (rows: Partial<LessonRequirement>[]) => {
  const res = await bulkReqRaw(rows);
  if (res.rejected.length) throw new BulkRejected(res);
  return res.created;
};
export const deleteRequirement = (id: number) => api.delete(`/timetable/requirements/${id}`);

// ── สอนร่วมที่ใส่ทีหลัง ─────────────────────────────────────────────────────
//
//   "เวลาเลือกครูสอนร่วมทีหลัง คาบจะรวมกันเลย โดยจะมีหน้าต่างขึ้นมาให้เลือกว่า
//    คาบไหนจะไปอยู่กับใคร เพราะตอนนี้คือมาใส่ทีหลังแล้วคาบไม่ขึ้น"
//
// co_teacher_id ถูกอ่านตอนสร้างตารางเท่านั้น การแก้แถวกำหนดการสอนจึงไม่ไปถึง
// คาบที่ลงไปแล้ว ตัวนี้ทำให้ไปถึง

export interface CoteachCell {
  slot_id: number;
  day:     number;
  period:  number;
  room_id:   number | null;
  room_name: string | null;
  /** คาบของฝั่งไหน — เจ้าของแถว หรือครูสอนร่วม */
  side:   "mine" | "theirs";
  teacher_name: string | null;
  is_locked: boolean;
  double:    boolean;
  /** ครูอีกคนว่างชั่วโมงนี้ไหม */
  ok:   boolean;
  why:  string | null;
}

export interface CoteachPlan {
  applied: false;
  req_id:  number;
  group_name:   string | null;
  subject_code: string | null;
  teacher_name:    string;
  co_teacher_name: string;
  /** แถวของครูสอนร่วม ถ้าเขามีแถวของตัวเอง */
  partner_req_id: number | null;
  /** ชั้นนี้ควรเรียนวิชานี้กี่คาบต่อสัปดาห์ */
  want:   number;
  mine:   number;
  theirs: number;
  cells:  CoteachCell[];
  /** คาบที่ควรเก็บไว้ เลือกมาให้ล่วงหน้า */
  suggest: number[];
}

export interface CoteachResult {
  applied: true;
  kept?:    number[];
  dropped?: number[];
  removed_from?: number;
  message:  string;
}

/** ขอดูแผนก่อน — ไม่แตะอะไรทั้งนั้น */
export const coteachPlan = (reqId: number, coTeacherId: number) =>
  api.post<CoteachPlan>("/timetable/coteach",
    { req_id: reqId, co_teacher_id: coTeacherId }).then((r) => r.data);

/** ลงมือ — คาบที่เลือกไว้ได้ชื่อครูทั้งสองคน คาบที่เหลือถูกลบ */
export const coteachApply = (reqId: number, coTeacherId: number, keep: number[]) =>
  api.post<CoteachResult>("/timetable/coteach",
    { req_id: reqId, co_teacher_id: coTeacherId, keep }).then((r) => r.data);

// ── ที่พักคาบ ────────────────────────────────────────────────────────────
//
//   "ช่วยทำช่องว่างๆ ออกมาให้หน่อย เพื่อเอาไว้วางคาบเฉยๆ เพื่อรอเปลี่ยนได้"
//
// ยกคาบออกจากตารางมาพักไว้ก่อน แล้วค่อยหาที่ให้ทีหลัง — ไม่ต้องลบทิ้งแล้วสร้าง
// ใหม่ คาบเดิมยังเป็นคาบเดิม

export interface ParkedLesson {
  parked_id:  number;
  parked_at:  string;
  group_id:   number | null;
  group_name: string | null;
  subject_id:   number | null;
  subject_code: string | null;
  subject_name: string | null;
  teacher_id:   number | null;
  teacher_name: string | null;
  co_teacher_id:   number | null;
  co_teacher_name: string | null;
  room_id:   number | null;
  room_name: string | null;
  is_elective:        boolean;
  is_activity_block:  boolean;
  elective_label: string | null;
  /** คาบคู่คือสองชั่วโมง */
  hours: number;
  from_day: number | null;
  from_periods: number[];
  /** ช่องเดิมยังว่างอยู่ไหม — ถ้าว่างก็กดคืนที่เดิมได้เลย */
  home_free: boolean;
}

export const listParked = () =>
  api.get<ParkedLesson[]>("/timetable/parked").then((r) => r.data);

/** ยกคาบออกจากตารางมาพักไว้ — คาบคู่ไปด้วยกันทั้งคู่เสมอ */
export const parkSlots = (slotIds: number[], force = false) =>
  api.post<{ parked: ParkedLesson[]; count: number; total: number }>(
    "/timetable/park", { slot_ids: slotIds, force }).then((r) => r.data);

/** วางกลับลงตาราง — ไม่บอกช่องก็กลับที่เดิม */
export const unparkSlot = (
  parkedId: number,
  at?: { day: number; period?: number; room_id?: number | null },
  force = false,
) =>
  api.post<{ slots: TimetableSlot[]; total: number }>(
    "/timetable/unpark", { parked_id: parkedId, ...(at ?? {}), force })
    .then((r) => r.data);

/** ทิ้งจากถาดไปเลย — คาบนั้นจะไม่อยู่ในตารางอีก */
export const dropParked = (parkedId: number) =>
  api.delete<{ total: number }>(`/timetable/parked/${parkedId}`).then((r) => r.data);

// ── ปุ่มตรวจคาบ — เครื่องจัดตารางตัวใหม่ ─────────────────────────────────
//
// จัดตารางใหม่ทั้งโรงเรียนแล้วคืนเป็น "ข้อเสนอ" ไม่เขียนลงตารางที่ใช้อยู่
// งานกินเวลาเป็นนาที จึงเริ่มงานแล้วถามความคืบหน้าเป็นระยะ

/** ตัวเลขวัดตารางชุดหนึ่ง — ใช้ไม้บรรทัดเดียวกันทั้งตารางจริงและข้อเสนอ */
export interface ScheduleQuality {
  periods:       number;
  lessons:       number;
  /** คาบว่างที่คั่นกลางวันของห้องหนึ่ง หัวท้ายว่างไม่นับ */
  gaps:          number;
  teacher_busy:  number;
  /** ครู-วัน ที่สอนเกินเพดานต่อวัน */
  heavy_days:    number;
  /** คาบที่ทำให้ครูสอนติดกันเกินเพดาน */
  long_runs:     number;
  clash_group:   number;
  clash_teacher: number;
  clash_room:    number;
  no_room:       number;
}

/** ห้องที่หลักสูตรขอคาบไว้เกินช่องที่มีจริง — ไม่มีเครื่องไหนแก้ได้ */
export interface OverCapacity {
  group_id:   number;
  group_name: string | null;
  want:       number;
  cap:        number;
  over:       number;
}

export interface ProposeSummary {
  units:    number;
  placed:   number;
  unplaced: number;
  unplaced_labels: string[];
  restarts: number;
  seconds:  number;
  /** รูก่อนและหลังรอบขยับให้สวย */
  gaps_before:   number;
  gaps_after:    number;
  polish_moves:  number;
  /** คาบที่เคยลงไม่ได้ แล้วลงได้หลังขยับ */
  rescued:       number;
  now:      ScheduleQuality;
  proposed: ScheduleQuality;
  over_capacity: OverCapacity[];
  activity_windows:   number;
  kept_activity_time: boolean;
}

export interface ProposeJob {
  state:   "running" | "done" | "error";
  message: string;
  started: string;
  budget_s: number;
  polish_s: number;
  summary?: ProposeSummary;
}

/** เริ่มจัดใหม่ — คืนรหัสงานไปใช้ถามความคืบหน้า */
export const proposeNewStart = (opts?: {
  budget_s?: number; polish_s?: number; keep_activity_time?: boolean;
}) =>
  api.post<{ job: string; budget_s: number; polish_s: number; eta_s: number }>(
    "/timetable/propose-new", opts ?? {}).then((r) => r.data);

export const proposeNewStatus = (job: string) =>
  api.get<ProposeJob>(`/timetable/propose-new/${job}`).then((r) => r.data);

/** คาบที่เสนอทั้งหมด — อ่านดูได้ ยังไม่มีใครเอาไปเขียนลงตาราง */
export const proposeNewSlots = (job: string) =>
  api.get<{ job: string; slots: TimetableSlot[] }>(
    `/timetable/propose-new/${job}/slots`).then((r) => r.data.slots);

/** เอาครูสอนร่วมออกจากแถวนี้ และจากคาบที่ลงไปแล้ว */
export const coteachRemove = (reqId: number) =>
  api.post<CoteachResult>("/timetable/coteach",
    { req_id: reqId, co_teacher_id: null }).then((r) => r.data);

// ── Timetable Slots ──────────────────────────────────────────────────────────
export const fetchSlots = (params?: { group_id?: number; teacher_id?: number; day?: number; room_id?: number }) =>
  api.get<TimetableSlot[]>("/timetable/slots", { params }).then((r) => r.data);
export const createSlot = (d: Partial<TimetableSlot>) =>
  api.post<TimetableSlot>("/timetable/slots", d).then((r) => r.data);
/**
 * แก้คาบหนึ่งคาบ
 *
 * manual = โหมดจัดเอง: ยอมให้ย้ายไปชนกับคาบอื่นได้ แล้วไปขึ้นกรอบแดงแทน
 * เหลือข้อห้ามเดียวคือทับคาบที่ล็อกไว้ไม่ได้ (เซิร์ฟเวอร์ยังปฏิเสธข้อนั้น)
 */
export const updateSlot = (id: number, d: Partial<TimetableSlot>,
                           manual = false) =>
  api.patch<TimetableSlot>(`/timetable/slots/${id}`,
                           manual ? { ...d, manual: true } : d)
    .then((r) => r.data);
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
  day: number; period: number;
  /** ต้องส่ง ยกเว้นเมื่อ free_period เป็นจริง ซึ่งคาบว่างไม่มีวิชา */
  subject_id?: number;
  teacher_mode?: "homeroom" | "single" | "none";
  teacher_id?: number | null;
  /**
   * ครูผู้ดูแลของกิจกรรม — one list for the whole activity, overriding
   * teacher_mode. Everyone on it gets the period; who takes which classroom
   * is left to them.
   */
  teacher_ids?: number[];
  room_mode?: "homeroom" | "none";
  /**
   * คาบว่างที่จองไว้ให้ว่างตรงกันทั้งกลุ่ม — ไม่ใช่กิจกรรมที่มีวิชา
   *
   * ตัวจัดตารางเห็นว่าช่องนี้ไม่ว่าง จะได้ไม่เอาวิชาอื่นมาลงทับ แต่รายงานกับ
   * ตารางที่คนอ่านนับเป็นคาบว่าง และไม่จองทั้งครูและห้อง ส่งค่านี้มาแล้ว
   * subject_id กับ teacher ไม่ต้องส่ง
   */
  free_period?: boolean;
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
  /** ไม่ส่งมา = เก็บค่าเดิมไว้ ย้ายเวลาคาบว่างแล้วยังเป็นคาบว่างอยู่ */
  free_period?: boolean;
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
/**
 * ตัวจัดตารางถึงไหนแล้ว — ถามระหว่างรอคำตอบของการจัด
 *
 * "ในหน้าโหลดช่วยทำเป็นเปอร์เซ็นต์หรือคาบที่กำลังลงอยู่ได้ไหม จะได้รู้ว่ามัน
 *  กำลังทำงานอยู่"
 *
 * การจัดตารางเป็นคำขอเดียวที่ค้างเป็นนาที ค้างจริงกับทำงานอยู่จึงหน้าตาเหมือน
 * กันเป๊ะ — และเซิร์ฟเวอร์ของโรงเรียนเคยไม่ตอบจริงๆ มาแล้ว
 */
export interface SolveProgress {
  running: boolean;
  /** "กำลังลงคาบ" · "กำลังปิดคาบว่างกลางวัน" ฯลฯ */
  phase: string;
  done: number;
  total: number;
  /** null เมื่อยังไม่รู้ตัวหาร (ช่วงต้นของการจัด) */
  percent: number | null;
  elapsed_seconds: number;
  /** ห้อง/วิชาที่กำลังลงอยู่ หรือชื่อเซ็ต */
  note: string;
  /** เพิ่มขึ้นทุกครั้งที่มีการรายงาน — ใช้ดูว่ายังขยับอยู่ไหม */
  seq: number;
}

export const fetchSolveProgress = () =>
  api.get<SolveProgress>("/timetable/solve/progress", { timeout: 8000 })
    .then((r) => r.data);

export const runSolver = (p: {
  clear_existing?: boolean;
  /**
   * ปุ่ม "จัดให้เสร็จ" — ปิดคาบว่างกลางวันให้หมด แม้ชั่วโมงนั้นจะไม่มีห้องว่าง
   * คาบที่ลงไปโดยยังไม่มีห้องจะขึ้นกรอบแดงให้หาห้องเองทีหลัง ซึ่งโรงเรียน
   * บอกว่าดีกว่าปล่อยให้เป็นคาบว่าง
   */
  close_gaps_hard?: boolean;
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
  /**
   * แก้เฉพาะห้องที่เลือก: re-place only these classes and freeze every other
   * one. Absent or EMPTY means the full rebuild — so a caller that means
   * "repair" must never send an empty list.
   */
  repair_group_ids?: number[];
}) => api.post<SolverResult>("/timetable/solve", p, { timeout: SOLVE_TIMEOUT_MS })
  .then((r) => r.data);

// ── เกลี่ยคาบครู ─────────────────────────────────────────────────────────────
/** ตัวเลขชุดเดียวกัน วัดก่อนและหลังกดปุ่ม */
export interface BalanceTotals {
  /** คาบที่ล้นเพดานรายวัน รวมทุกคน */
  over_day:      number;
  /** คาบที่ติดกันเกินเพดาน รวมทุกคน */
  over_run:      number;
  /** จำนวนช่วงที่ติดกันเกินเพดาน */
  runs_over:     number;
  teachers_over: number;
  days_over:     number;
  /** วันที่หนักสุดของทั้งโรงเรียน กี่คาบ */
  worst_day:     number;
}

/** ครูหนึ่งคนที่ยังล้นอยู่ หลังเกลี่ยแล้ว */
export interface BalanceStuck {
  teacher: string;
  /** 0 = จันทร์ … 4 = ศุกร์ */
  day:     number;
  periods: number;
  problem: string;
  why:     string;
}

export interface BalanceResult {
  ok:              boolean;
  moved:           number;
  dry_run:         boolean;
  before:          BalanceTotals;
  after:           BalanceTotals;
  max_per_day:     number;
  max_consecutive: number;
  /** ห้องที่ปิดไว้ว่าจัดเสร็จแล้ว — ไม่ถูกแตะ เว้นแต่สั่งให้เกลี่ยด้วย */
  locked_classes:  number;
  touched_locked:  boolean;
  seconds:         number;
  notes:           string[];
  /** ที่ยังเหลืออยู่ — ใครวันไหน และติดอะไร */
  stuck:           BalanceStuck[];
}

/**
 * เกลี่ยคาบครูในตารางที่จัดเสร็จแล้ว โดยไม่รื้อตารางใหม่
 *
 * "อยากให้คุณมีปุ่มที่ช่วยทำให้คาบครูมีไม่มากใน 1 วัน และไม่ติดกันมากเกิน
 *  ความจำเป็นช่วยที"
 *
 * วิธีที่ใช้คือสลับคาบของห้องเดียวกันข้ามวัน ตารางนักเรียนจึงมีคาบเท่าเดิมใน
 * ช่องเดิมทุกช่อง เปลี่ยนแค่ว่าชั่วโมงนั้นเรียนวิชาอะไร
 */
export const balanceTeachers = (p: {
  /** คาบต่อวันต่อครูที่ถือว่าพอแล้ว — ไม่ส่งมาใช้ค่าของโรงเรียน */
  max_per_day?:            number;
  /** สอนติดกันได้ไม่เกินกี่คาบ */
  max_consecutive?:        number;
  /** ดูก่อนว่าจะเปลี่ยนอะไร ไม่แตะตารางจริง */
  dry_run?:                boolean;
  /** เกลี่ยห้องที่ปิดไว้ว่าจัดเสร็จแล้วด้วย */
  include_locked_classes?: boolean;
}) => api.post<BalanceResult>("/timetable/balance-teachers", p,
  { timeout: SOLVE_TIMEOUT_MS }).then((r) => r.data);

// ── ย้ายคาบนี้ไปไหนได้ ───────────────────────────────────────────────────────
/** ที่หนึ่งที่คาบนี้ไปลงได้ พร้อมของที่ต้องทำและผลที่ตามมา */
export interface PlanOption {
  day:     number;
  period:  number;
  periods: number[];
  /** "ว่าง" = ช่องนั้นว่างอยู่ · "สลับ" = ต้องสลับกับคาบอื่นของห้องเดียวกัน */
  kind:    "ว่าง" | "สลับ";
  with:    { slot_id: number; subject_code: string | null;
             group_name: string | null; periods: number[] } | null;
  /** ภาระของครูคนนี้ลดลงกี่หน่วย — 0 คือย้ายได้แต่ไม่ได้ช่วยเรื่องภาระ */
  gain:    number;
  /** ผลข้างเคียง เช่น ครูคนอื่นแน่นขึ้น หรือห้องเรียนมีคาบว่างเพิ่ม */
  side:    string[];
  /** ส่งต่อให้ moveSlots ได้ตรง ๆ */
  moves:   { slot_id: number; day: number; period: number }[];
}

export interface PlanLesson {
  slot_id:       number;
  slot_ids:      number[];
  day:           number;
  periods:       number[];
  group_name:    string | null;
  /** คาบเดียวที่กินหลายห้อง (ชุมนุม ลูกเสือ วิชาเสรี) */
  group_count:   number;
  subject_code:  string | null;
  subject_name:  string | null;
  room_name:     string | null;
  is_double:     boolean;
  selected:      boolean;
  /** ย้ายไม่ได้เลย พร้อมเหตุผล */
  stuck:         string | null;
  /** ย้ายได้ แต่มีข้อควรรู้ เช่น ห้องนี้ปิดไว้ว่าจัดเสร็จแล้ว */
  warn:          string | null;
  options:       PlanOption[];
  /** กี่ที่ที่ย้ายแล้วภาระดีขึ้นจริง */
  better?:       number;
  blocked:       { day: number; period: number; why: string }[];
  blocked_total?: number;
}

export interface TeacherPlan {
  teacher: { id: number; name: string | null; code: string | null; total: number };
  max_per_day: number;
  max_consecutive: number;
  days: { day: number; periods: number; over: boolean; runs_over: number }[];
  lessons: PlanLesson[];
}

/**
 * คาบของครูคนนี้แต่ละคาบ ย้ายไปไหนได้ และต้องทำอะไร
 *
 * "คาบครูบางท่านมีเยอะมากใน 1 วัน คุณช่วยมีระบบว่าถ้าจะย้ายคาบนี้จะต้องทำ
 *  ยังไง คือเราเลือกคาบมา ... เลือกได้ว่าจะเอาเฉพาะคาบเดี่ยวหรือทั้งหมด
 *  หรือเลือกทีละหลาย ๆ คาบได้"
 *
 * อ่านอย่างเดียว ไม่ย้ายอะไรให้ — การย้ายจริงส่ง option.moves ไปที่ moveSlots
 */
export const fetchTeacherPlan = (p: {
  teacher_id: number;
  scope?: "all" | "singles" | "ids";
  slot_ids?: number[];
  /** ดูเฉพาะวันนี้ (0 = จันทร์) */
  day?: number | null;
  max_per_day?: number;
  max_consecutive?: number;
  max_options?: number;
}) => api.post<TeacherPlan>("/timetable/teacher-plan", p,
  { timeout: 180_000 }).then((r) => r.data);

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
    /** รุ่นของตัวจัดตารางที่กำลังรันอยู่ — ไม่มีช่องนี้เลยคือรุ่นก่อนหน้านี้ */
    api_build?: string | null;
    counts: Record<string, number>;
  }>("/state/info").then((r) => r.data);

/**
 * รุ่นของตัวจัดตารางที่หน้าเว็บรุ่นนี้คู่กัน
 *
 * หน้าเว็บอยู่บน GitHub Pages ส่วนตัวจัดตารางอยู่บน Render — คนละที่ และ
 * อัปเดตแยกกัน หน้าเว็บจึงใหม่ได้ทั้งที่ตัวจัดตารางยังเป็นรุ่นเก่า: ข้อความบน
 * จอเปลี่ยนไปหมดแล้ว แต่ตารางที่ออกมายังเป็นของเดิม ซึ่งมองไม่เห็นเลยว่าเกิด
 * อะไรขึ้น และโรงเรียนก็กดสร้างตารางซ้ำอยู่อย่างนั้น
 *
 * ต้องตรงกับ API_BUILD ใน mock_api.py และขยับพร้อมกันเสมอ — มีเทสต์
 * (scratchpad/apibuild.py) คอยจับไว้ว่าสองที่นี้ตรงกัน
 */
export const EXPECTED_API_BUILD = "2026-10-28.3";

export interface ApiBuildCheck {
  /** รุ่นที่เซิร์ฟเวอร์ตอบมา — null เมื่อเก่าจนไม่มีช่องนี้เลย */
  server: string | null;
  expected: string;
  /** ตรงกันไหม — false แปลว่าตัวจัดตารางที่รันอยู่ยังเป็นรุ่นเก่า */
  ok: boolean;
}

/** เทียบรุ่นของหน้าเว็บกับรุ่นของตัวจัดตารางที่รันอยู่จริง */
export const checkApiBuild = async (): Promise<ApiBuildCheck> => {
  const info = await fetchStateInfo();
  const server = info.api_build ?? null;
  return { server, expected: EXPECTED_API_BUILD, ok: server === EXPECTED_API_BUILD };
};

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
  /** ตัวอย่างถูกยุบรวมแล้ว — อย่าเติม "และอีก N รายการ" ต่อท้าย */
  collapsed?: boolean;
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

// ── ของที่สั่งไว้ใส่ลงได้ไหม ─────────────────────────────────────────────────
// Read-only. Counts what the school has asked for against what it has, before
// any solve: periods against cells, bound rooms against hours, teachers against
// their week. Whatever is over cannot be placed by any method, so it is worth
// seeing BEFORE pressing สร้างตาราง rather than reading it off a finished grid.
export interface CapacityRow {
  need:     number;
  capacity: number;
  /** ส่วนที่เกินช่องที่มี — มีในหัวข้อ kind "over" */
  over?:    number;
  /** ช่องที่เหลือว่างเพราะแผนสั่งไม่เต็ม — มีในหัวข้อ kind "short" */
  short?:   number;
  /** ห้องเรียนที่หลักสูตรเกิน */
  group_id?:        number;
  name?:            string;
  last_period_num?: number;
  before_last_num?: number;
  /** ห้องของวิชาที่รับไม่ไหว */
  room_ids?: number[];
  rooms?:    string[];
  subjects?: string[];
  /** วิชามาถึงห้องได้สองทาง และวิธีแก้ของสองทางไม่เหมือนกัน
   *  subject    = วิชาตั้งห้องนี้เป็นห้องประจำวิชาของตัวเอง
   *  department = ห้องนี้ขึ้นทะเบียนเป็นห้องของกลุ่มสาระ */
  source?:      "subject" | "department" | "both";
  departments?: string[];
  /** ครูที่ชั่วโมงเกิน */
  teacher_id?: number;
}
export interface CapacityFinding {
  code:     string;
  title:    string;
  why:      string;
  count:    number;
  rows:     CapacityRow[];
  examples: string[];
  fixable:  boolean;
  fix?:     string | null;
  severity: "blocking" | "warning";
  /** "over" = สั่งไว้เกินช่องที่มี · "short" = สั่งไว้ไม่เต็มช่องที่มี
   *  สองอย่างนี้แก้คนละทาง และหน้าจอพูดถึงคนละประโยค */
  kind?:    "over" | "short";
}
export interface CapacityReport {
  findings: CapacityFinding[];
  /** นับแค่ส่วนที่เกิน — ส่วนที่ขาดอยู่ใน short_total */
  total:    number;
  short_total?: number;
  room_week_capacity: number;
  checked: { requirements: number; groups: number; rooms: number; teachers: number };
}

export const fetchCapacity = () =>
  api.get<CapacityReport>("/diagnostics/capacity").then((r) => r.data);

// ── หลักสูตร ─────────────────────────────────────────────────────────────────
// A curriculum says how many periods a week each subject gets; a class that has
// one attached is held to it. A class with none attached is never checked.
export interface CurriculumRow {
  subject_id:   number;
  weekly_count: number;
}

export interface Curriculum {
  id:   number;
  name: string;
  rows: CurriculumRow[];
  /** ห้องที่ผูกกับหลักสูตรนี้ */
  groups:      number[];
  group_names: string[];
}

/** หลักสูตรที่ระบบเสนอให้ — พรีวิวเฉยๆ ยังไม่ได้สร้างอะไร */
export interface DerivedProposal {
  name:      string;
  rows:      CurriculumRow[];
  group_ids: number[];
  /**
   * 0 = ห้องเดียว · 1 = กลุ่มหลายห้องที่มีแบบเดียว ·
   * มากกว่า 1 = เป็นหนึ่งในหลายแบบของกลุ่มเดียวกัน (ชื่อลงท้าย "(แบบ N)")
   */
  variants:  number;
}

export const fetchCurricula = () =>
  api.get<Curriculum[]>("/curricula").then((r) => r.data);

export const createCurriculum = (d: { name: string; rows: CurriculumRow[] }) =>
  api.post<Curriculum>("/curricula", d).then((r) => r.data);

/** Leave `rows` out to keep them; `rows: []` empties them. */
export const updateCurriculum = (id: number, d: { name?: string; rows?: CurriculumRow[] }) =>
  api.put<Curriculum>(`/curricula/${id}`, d).then((r) => r.data);

/** Refused with a 400 (Thai message, names up to three classes) while any class is attached. */
export const deleteCurriculum = (id: number) =>
  api.delete<{ removed: number }>(`/curricula/${id}`).then((r) => r.data);

export const copyCurriculum = (id: number) =>
  api.post<Curriculum>(`/curricula/${id}/copy`, {}).then((r) => r.data);

/** A new curriculum built from one class's teaching plan. */
export const curriculumFromGroup = (groupId: number) =>
  api.post<Curriculum>(`/curricula/from-group/${groupId}`, {}).then((r) => r.data);

/** Preview only. Covers just the classes that have no curriculum yet, so it is empty once all are attached. */
export const fetchDerivedCurricula = () =>
  api.get<{ proposals: DerivedProposal[] }>("/curricula/derive").then((r) => r.data);

/** Creates the proposals above and attaches their classes. The caller re-reads the list. */
export const applyDerivedCurricula = () =>
  api.post<unknown>("/curricula/derive", {}).then((r) => r.data);

/** Attaches exactly these classes; any class attached before and not listed is detached. */
export const setCurriculumGroups = (id: number, groupIds: number[]) =>
  api.put<unknown>(`/curricula/${id}/groups`, { group_ids: groupIds }).then((r) => r.data);

// ── เทียบหลักสูตรกับแผนการสอนของห้อง ────────────────────────────────────────
/** วิชาหนึ่งที่หลักสูตรกับแผนการสอนของห้องไม่ตรงกัน */
export interface CurriculumDiffEntry {
  subject_id: number;
  code:       string;
  name:       string;
  /** คาบ/สัปดาห์ตามหลักสูตร */
  want:       number;
  /** คาบ/สัปดาห์ในแผนการสอนตอนนี้ */
  have:       number;
}

/** ตรงนี้ระบบไม่ตัดสินให้ — บอกเหตุผลไว้ แล้วให้คนดูเอง */
export interface CurriculumDiffWarn extends CurriculumDiffEntry {
  why: string;
}

export interface CurriculumDiff {
  /** null = ห้องนี้ยังไม่ผูกหลักสูตร จึงไม่มีอะไรให้เทียบ */
  curriculum: { id: number; name: string } | null;
  /** หลักสูตรมี แผนการสอนไม่มี */
  add:    CurriculumDiffEntry[];
  /** มีทั้งสองฝั่ง แต่จำนวนคาบต่างกัน */
  fix:    CurriculumDiffEntry[];
  /** แผนการสอนมี แต่หลักสูตรไม่มี */
  remove: CurriculumDiffEntry[];
  warn:   CurriculumDiffWarn[];
  /** วิชาที่ตรงกันแล้ว */
  ok:     number;
}

export const fetchCurriculumDiff = (groupId: number) =>
  api.get<CurriculumDiff>(`/curricula/diff/${groupId}`).then((r) => r.data);

export interface CurriculumApplyResult {
  added:   number;
  fixed:   number;
  removed: number;
  /** คาบในตารางที่ยังค้างอยู่ ทั้งที่แผนการสอนของวิชานั้นถูกเอาออกไปแล้ว */
  slots_left: number;
}

/** Applies only the subjects listed, by subject_id, in each direction. */
export const applyCurriculumDiff = (
  groupId: number,
  pick: { add: number[]; fix: number[]; remove: number[] },
) => api.post<CurriculumApplyResult>(`/curricula/apply/${groupId}`, pick).then((r) => r.data);

// ── ตรวจหลักสูตรทั้งโรงเรียน ────────────────────────────────────────────────
export interface CurriculumAuditRow {
  group_id:        number;
  group_name:      string;
  /** null = ห้องนี้ยังไม่ผูกหลักสูตร (ไม่ถูกตรวจ — ตั้งใจ ไม่ใช่ข้อผิดพลาด) */
  curriculum_id:   number | null;
  curriculum_name: string | null;
  /** วิชาที่หลักสูตรมีแต่แผนการสอนไม่มี */
  missing:  number;
  /** วิชาที่แผนการสอนมีแต่หลักสูตรไม่มี */
  surplus:  number;
  /** วิชาที่จำนวนคาบไม่ตรง */
  mismatch: number;
  warn:     number;
  /** คาบรวมต่อสัปดาห์ในแผนการสอนของห้อง */
  weekly:   number;
}

export interface CurriculumAudit {
  rows: CurriculumAuditRow[];
  total: number;
  attached: number;
  off: number;
}

export const fetchCurriculumAudit = () =>
  api.get<CurriculumAudit>("/curricula/audit").then((r) => r.data);

// ── คาบเรียนลาน และลำดับลาน ──────────────────────────────────────────────────
// The school decides by hand, in advance, that a class's particular hour happens
// outdoors on a named ลาน — which frees an indoor room for a lesson that would
// otherwise have nowhere to go. Marking a cell saves at once; the timetable only
// follows the marks the next time สร้างตาราง is pressed.

/** ลานหนึ่งแห่ง */
export interface Yard {
  id:       number;
  name:     string;
  capacity: number;
}

/** ชั่วโมงหนึ่งของห้องหนึ่งที่โรงเรียนเลือกไว้ว่าเรียนที่ลานนี้ */
export interface YardPickRow {
  id:       number;
  group_id: number;
  /** 0-based day index — the one the grid uses. */
  day:      number;
  /** period_num */
  period:   number;
  /** The ลาน. */
  room_id:  number;
}

export interface YardPicks {
  rows:  YardPickRow[];
  /** Already sorted by the school's saved order. */
  yards: Yard[];
}

export interface YardOrderRow extends Yard {
  /** How many คาบ are pinned to this ลาน right now. */
  picks: number;
}

export interface YardOrder {
  order: number[];
  /** Not promised to be in `order`'s order — sort by `order`. */
  yards: YardOrderRow[];
}

export const fetchYardPicks = () =>
  api.get<YardPicks>("/yard-picks").then((r) => r.data);

/**
 * Pick a ลาน for one hour of one class; `room_id: null` takes the pick away.
 * Resolves to the saved row, or to null when the pick was removed.
 * Refused with a 400 and a Thai message when the hour cannot go to that ลาน.
 */
export const setYardPick = (p: {
  group_id: number; day: number; period: number; room_id: number | null;
}) =>
  api.put<YardPickRow | { removed: true }>("/yard-picks", p)
    .then((r) => ("removed" in r.data ? null : r.data));

export const fetchYardOrder = () =>
  api.get<YardOrder>("/yard-order").then((r) => r.data);

/** One order for the whole school: the solver fills the first ลาน before the next. */
export const saveYardOrder = (order: number[]) =>
  api.put<YardOrder>("/yard-order", { order }).then((r) => r.data);

// ── หาลานให้คาบที่ไม่มีห้อง ──────────────────────────────────────────────────
// For one red "no room" cell: which ลาน marks would actually give that lesson a
// room. Nothing is written by asking — a choice is applied with setYardPick,
// the same save as everywhere else.

/** The same teacher, teaching another class in that very hour. */
export interface YardRescueClash {
  teacher:      string;
  with_group:   string;
  with_subject: string;
}

/** The lesson in the cell that was asked about. */
export interface YardRescueLesson {
  subject:   string | null;
  teacher:   string | null;
  room_name: string | null;
  /** false: no lesson in that cell, or it already has a room — see `note`. */
  found:     boolean;
  /**
   * Set when a ลาน would give the lesson a room and it would still be red,
   * because its teacher is in another class's lesson that hour. null (or
   * absent) is the ordinary case.
   */
  teacher_clash?: YardRescueClash | null;
}

/** A ลาน that is free at that hour. Choosing it puts THIS lesson on it. */
export interface YardRescueDirect {
  /** The ลาน. */
  room_id:   number;
  room_name: string;
  /** 1 is best. */
  rank:      number;
}

/**
 * Another class at the same hour that could go out to a ลาน, giving up an
 * indoor room this lesson can use. Choosing it marks THAT class's hour.
 */
export interface YardRescueDonor {
  group_id:        number;
  group_name:      string;
  subject:         string | null;
  /** The indoor room the donor gives up — NOT a ลาน. */
  frees_room_id:   number;
  frees_room_name: string;
  /** The ลาน the donor class would go to — this is what gets saved. */
  yard_id:         number;
  yard_name:       string;
}

export interface YardRescue {
  lesson: YardRescueLesson;
  /** Best first. */
  direct: YardRescueDirect[];
  donors: YardRescueDonor[];
  /**
   * The other reasons, in Thai: every ลาน taken that hour, no usable ลาน, a pick
   * already waiting for สร้างตาราง. Empty when there is nothing to add. A teacher
   * clash is never in here — it is only in `lesson.teacher_clash`.
   */
  note:   string;
}

export const fetchYardRescue = (p: { group_id: number; day: number; period: number }) =>
  api.get<YardRescue>("/yard-rescue", { params: p }).then((r) => r.data);

/**
 * The server's own message for a refused request (400), or `fallback`.
 *
 * A 400 from the curriculum endpoints carries a Thai sentence in `detail` that
 * already says what was refused and why — deleting a curriculum that classes
 * still use, adding a lesson the curriculum does not list. Showing that
 * sentence beats a generic "ไม่สำเร็จ", which would throw away the one thing the
 * reader needs. Only a 400 is trusted to be written for a person: a 404 or 5xx
 * detail is a developer's string, and a 422 puts a list there, not text.
 */
export const errorDetail = (e: unknown, fallback: string): string => {
  // แถวที่ถูกปฏิเสธจาก bulk — เหตุผลอยู่ในตัว error เอง ไม่ได้อยู่ใน response
  if (e instanceof BulkRejected) {
    const reasons = Array.from(new Set(e.result.rejected.map((x) => x.reason)));
    return reasons.join(" · ") || fallback;
  }
  const r = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const d = r?.data?.detail;
  return r?.status === 400 && typeof d === "string" && d.trim() ? d : fallback;
};
