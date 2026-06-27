import axios from "axios";
import type {
  Building, Department, LessonRequirement, Period, Room,
  SolverResult, StudentGroup, Subject, Teacher, TimetableSlot,
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
export const deleteSubject      = (id: number) => api.delete(`/subjects/${id}`);
export const bulkCreateSubjects = (rows: Partial<Subject>[]) => api.post<Subject[]>("/subjects/bulk", rows).then((r) => r.data);

// ── Requirements ─────────────────────────────────────────────────────────────
export const fetchRequirements = (groupId?: number) =>
  api.get<LessonRequirement[]>("/timetable/requirements", { params: { group_id: groupId } }).then((r) => r.data);
export const createRequirement = (d: Partial<LessonRequirement>) =>
  api.post<LessonRequirement>("/timetable/requirements", d).then((r) => r.data);
export const deleteRequirement = (id: number) => api.delete(`/timetable/requirements/${id}`);

// ── Timetable Slots ──────────────────────────────────────────────────────────
export const fetchSlots = (params?: { group_id?: number; teacher_id?: number; day?: number; room_id?: number }) =>
  api.get<TimetableSlot[]>("/timetable/slots", { params }).then((r) => r.data);
export const createSlot = (d: Partial<TimetableSlot>) =>
  api.post<TimetableSlot>("/timetable/slots", d).then((r) => r.data);
export const updateSlot = (id: number, d: Partial<TimetableSlot>) =>
  api.patch<TimetableSlot>(`/timetable/slots/${id}`, d).then((r) => r.data);
export const deleteSlot  = (id: number) => api.delete(`/timetable/slots/${id}`);
export const clearSlots  = () => api.delete("/timetable/slots");

// ── Elective Slots (วิชาเสรี) ────────────────────────────────────────────────
export const createElectiveSlot = (d: {
  group_id: number; day: number; period: number;
  subject_id: number; teacher_id: number; label?: string; room_id?: number | null;
}) => api.post<TimetableSlot>("/timetable/elective-slots", d).then((r) => r.data);

export const addElectiveOption = (slotId: number, d: { subject_id: number; teacher_id: number; label?: string }) =>
  api.post<TimetableSlot>(`/timetable/elective-slots/${slotId}/options`, d).then((r) => r.data);

export const deleteElectiveOption = (slotId: number, optionId: number) =>
  api.delete<TimetableSlot>(`/timetable/elective-slots/${slotId}/options/${optionId}`).then((r) => r.data);

export const selectElectiveOption = (slotId: number, optionId: number) =>
  api.patch<TimetableSlot>(`/timetable/elective-slots/${slotId}/select`, { option_id: optionId }).then((r) => r.data);

export const copyElectiveSlot = (slotId: number, targetGroupIds: number[]) =>
  api.post<TimetableSlot[]>(`/timetable/elective-slots/${slotId}/copy`, { target_group_ids: targetGroupIds }).then((r) => r.data);

// Bulk lock/unlock slots by filter
export const bulkLockSlots = (params: {
  is_locked: boolean;
  filters: { group_level?: string; day?: number; period?: number; subject_id?: number };
}) => api.post<{ affected: number }>("/timetable/slots/bulk-lock", params).then((r) => r.data);

// ── Solver ───────────────────────────────────────────────────────────────────
export const runSolver = (p: {
  clear_existing?: boolean;
  time_limit_seconds?: number;
  locked_slot_ids?: number[];
}) => api.post<SolverResult>("/timetable/solve", p).then((r) => r.data);
