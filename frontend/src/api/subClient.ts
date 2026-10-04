/**
 * ระบบจัดการสอนแทน — the calls the teachers' page makes.
 *
 * Kept apart from client.ts on purpose: that file can create, edit and delete
 * the master timetable, and nothing on the teachers' page should be one import
 * away from doing so.
 */
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : "/api";

const api = axios.create({ baseURL: BASE_URL, timeout: 60_000 });

/** One lesson, as a teacher reads it. */
export interface SubLesson {
  slot_id: number;
  day: number;
  period: number;
  period_label: string | null;
  start_time: string | null;
  end_time: string | null;
  group_id: number;
  group_name: string | null;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  room_id: number | null;
  room_name: string | null;
  teacher_id: number | null;
  teacher_name: string | null;
  is_elective: boolean;
  is_locked: boolean;
}

/** A teacher who could take the lesson. */
export interface CoverCandidate {
  teacher_id: number;
  teacher_name: string | null;
  teacher_code: string | null;
  /** 4 = already teaches this subject to this class … 0 = simply free. */
  score: number;
  reason: string;
  load_that_day: number;
}

/** One period the absent teacher would give back. */
export interface RepaySlot {
  slot_id: number;
  date: string;
  day: number;
  period: number;
  group_id: number;
  group_name: string | null;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  room_name: string | null;
  score: number;
  reason: string;
}

/** A whole way of paying the debt back, not a loose slot. */
export interface RepayPlan {
  kind: "single" | "block" | "weekly" | "spread";
  label: string;
  periods: number;
  slots: RepaySlot[];
  score: number;
}

export interface SwapRoute extends CoverCandidate {
  owed: number;
  plans: RepayPlan[];
}

export interface Absence {
  id: number;
  teacher_id: number;
  date: string;
  periods: number[];
  reason: string;
  status: string;
}

export interface Substitution {
  id: number;
  absence_id: number | null;
  slot_id: number;
  date: string;
  day: number;
  period: number;
  group_id: number;
  group_name: string | null;
  subject_code: string | null;
  subject_name: string | null;
  room_name: string | null;
  absent_teacher_id: number | null;
  absent_teacher_name: string | null;
  cover_teacher_id: number;
  cover_teacher_name: string | null;
  creates_debt: boolean;
  note: string;
  status: string;
}

export interface Repayment {
  id: number;
  substitution_id: number;
  slot_id: number;
  date: string;
  day: number;
  period: number;
  group_name: string | null;
  subject_code: string | null;
  subject_name: string | null;
  teacher_id: number;
  to_teacher_id: number;
  status: string;
}

export interface LedgerRow {
  debtor_id: number;
  debtor_name: string | null;
  creditor_id: number;
  creditor_name: string | null;
  periods: number;
}

export const fetchDay = (teacherId: number, date: string) =>
  api.get<{ date: string; day: number | null; lessons: SubLesson[]; message?: string }>(
    "/sub/day", { params: { teacher_id: teacherId, date } }).then((r) => r.data);

/** One lesson, or a คาบคู่ handed over whole via slot_ids. */
export const fetchOptions = (p: {
  slot_id?: number; slot_ids?: number[]; date: string; owed?: number;
}) => api.post<{
  lesson: SubLesson; lessons: SubLesson[]; owed: number;
  cover: CoverCandidate[]; swap: SwapRoute[];
}>("/sub/options", p).then((r) => r.data);

export const fetchAbsences = (teacherId?: number) =>
  api.get<Absence[]>("/sub/absences",
    { params: teacherId == null ? {} : { teacher_id: teacherId } }).then((r) => r.data);

export const createAbsence = (p: {
  teacher_id: number; date: string; periods?: number[]; reason?: string;
}) => api.post<Absence>("/sub/absences", p).then((r) => r.data);

export const deleteAbsence = (id: number) =>
  api.delete(`/sub/absences/${id}`).then((r) => r.data);

export const fetchSubstitutions = (teacherId?: number) =>
  api.get<Substitution[]>("/sub/substitutions",
    { params: teacherId == null ? {} : { teacher_id: teacherId } }).then((r) => r.data);

export const createSubstitution = (p: {
  slot_id: number; date: string; cover_teacher_id: number;
  creates_debt: boolean; absence_id?: number | null; note?: string;
  repayments?: { slot_id: number; date: string }[];
}) => api.post<Substitution>("/sub/substitutions", p).then((r) => r.data);

export const deleteSubstitution = (id: number) =>
  api.delete(`/sub/substitutions/${id}`).then((r) => r.data);

export const fetchRepayments = (teacherId?: number) =>
  api.get<Repayment[]>("/sub/repayments",
    { params: teacherId == null ? {} : { teacher_id: teacherId } }).then((r) => r.data);

export const fetchLedger = () =>
  api.get<{ rows: LedgerRow[] }>("/sub/ledger").then((r) => r.data.rows);

/** Teachers, for the "ฉันคือ…" picker. Read-only here. */
export const fetchTeachersLite = () =>
  api.get<{ id: number; name: string; code?: string | null }[]>("/teachers/")
    .then((r) => r.data);
