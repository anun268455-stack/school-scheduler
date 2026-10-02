// ─────────────────────────────────────────────────────────────────────────────
// Core domain types (v2 – period-aware, lock-aware, impact-aware)
// ─────────────────────────────────────────────────────────────────────────────

export type RoomType      = "physical" | "special" | "outdoor" | "floating";
export type SubjectType   = "common" | "parallel";
export type PeriodType    = "class" | "break" | "lunch" | "assembly" | "homeroom";
export type SolverStatus  = "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN";
export type ViewMode      = "group" | "teacher" | "room";

/** Impact level for drag-and-drop target cells */
export type ImpactLevel = "green" | "yellow" | "red" | "fixed" | "same" | "neutral";

export interface CellImpact {
  level:    ImpactLevel;
  cascades: number;           // estimated number of ripple swaps required
  reason:   string;           // Thai explanation shown in tooltip
}

// ── Schema entities ──────────────────────────────────────────────────────────
export interface Period {
  id:         number;
  period_num: number;         // 0-based internal index
  label:      string;         // "คาบ 1", "พัก 10 นาที", "กินข้าว ม.1-3"
  start_time: string;         // "08:00"
  end_time:   string;         // "08:50"
  type:       PeriodType;
  applies_to: "all" | "lower" | "upper";  // staggered lunch/break audience
}

export interface Building {
  id:          number;
  name:        string;
  floor_count: number;
}

export interface Room {
  id:                  number;
  name:                string;
  type:                RoomType;
  building_id:         number | null;
  building_name:       string | null;
  floor:               number;
  capacity:            number;
  specialized_dept_id: number | null;  // e.g. Physics lab locked to Science dept
  reserved_teacher_id: number | null;  // permanently reserved for a specific teacher
}

export interface GroupAdvanced {
  prefer_morning?:     boolean; // ให้จัดวิชาหนักตอนเช้า
  avoid_after_lunch?:  boolean; // หลีกเลี่ยงวิชาหนักหลังกินข้าว
  max_slots_per_day?:  number;  // จำกัดคาบต่อวันของห้องนี้
  note?:               string;  // หมายเหตุ
}

export interface StudentGroup {
  id:                number;
  name:              string;
  parent_id:         number | null;
  level:             string | null;   // "M1" … "M6" | "ห้องเวียน"
  size:              number;
  homeroom_room_id:  number | null;   // ห้องประจำชั้น
  homeroom_teacher_id: number | null; // ครูประจำชั้น
  advanced_settings?: GroupAdvanced;
  children:          StudentGroup[];
}

export interface TeacherAdvanced {
  ignore_consecutive_limit?: boolean;  // ไม่จำกัดคาบต่อเนื่อง
  require_ground_floor?:     boolean;  // ต้องสอนชั้น 1 เท่านั้น (เหตุสุขภาพ)
  days_off?:                 number[]; // วันที่ไม่สอน [0=จ, 1=อ, ... 4=ศ]
  avoid_periods?:            number[]; // คาบที่หลีกเลี่ยง
  note?:                     string;   // หมายเหตุ
}

export interface Teacher {
  id:                   number;
  code?:                string | null;   // รหัสประจำตัวครู (ใช้ในหัวกระดาษตอนพิมพ์)
  name:                 string;
  fixed_room_id:        number | null;
  department_id:        number | null;
  outdoor_score:        number;
  max_slots_per_day:    number;
  max_outdoor_per_week: number;
  advanced_settings?:   TeacherAdvanced;
}

export interface Subject {
  id:            number;
  code:          string;
  name:          string;
  type:          SubjectType;
  duration:      1 | 2;
  department_id: number | null;
  is_activity:   boolean;       // true = ชุมนุม/ลูกเสือ/กิจกรรม
  fixed_room_id?: number | null; // ห้องประจำวิชา — สำคัญกว่าห้องประจำชั้นของนักเรียน
}

export interface LessonRequirement {
  id:                 number;
  group_id:           number;
  subject_id:         number;
  teacher_id:         number;
  weekly_count:       number;
  parallel_group_key: string | null;
}

export interface ElectiveOption {
  id:         number;
  subject_id: number;
  teacher_id: number;
  label:      string;
  /** Subject code, carried over when the option came from a กลุ่มวิชาเสรี. */
  code?:      string;
}

/**
 * คาบเสรี — one elective window shared by several classes.
 *
 * The window comes first: the school decides "ม.1/7-12 has its elective on
 * Wednesday period 7", it is pinned there and locked, and the subjects students
 * may choose between go in afterwards. That is the order the work happens in,
 * and it is why `day`/`period` can be set while `options` is still empty.
 *
 * All of its options run at the same time, so each needs its own teacher — the
 * API fills in who teaches what and flags anyone double-booked.
 */
export interface ElectivePoolOption {
  key:        number;        // stable id for editing/removing this option
  subject_id: number;
  teacher_id: number;
  label:      string;
  code?:      string;
  // Filled in by the API.
  subject_code?:    string | null;
  subject_name?:    string | null;
  teacher_name?:    string | null;
  teacher_code?:    string | null;
  department_name?: string | null;
  conflicts?: { group_name: string | null; subject_name: string | null; period: number | null }[];
}

export interface ElectivePool {
  id:        number;
  name:      string;
  raw_group: string;         // the label as the staffing sheet wrote it
  group_ids: number[];
  weekly:    number;
  is_double: boolean;
  day:       number | null;  // null = not pinned to the timetable yet
  period:    number | null;
  options:   ElectivePoolOption[];
  // Filled in by the API.
  placed_count?:    number;
  unplaced_groups?: { group_id: number; group_name: string | null }[];
  conflict_count?:  number;
}

/** A teacher who could take a subject in a window, and whether they are free. */
export interface PoolTeacherCandidate {
  id:   number;
  name: string;
  code: string | null;
  department_id:   number | null;
  same_department: boolean;
  teaches_subject: boolean;
  free: boolean;
  conflicts: { group_name: string | null; subject_name: string | null; period: number | null }[];
}

export interface TimetableSlot {
  id:                 number;
  day:                number;     // 0=Mon … 4=Fri
  period:             number;     // period_num (0-based)
  teacher_id:         number | null;   // null = คาบกิจกรรมที่ไม่มีครูเจาะจง
  group_id:           number;
  room_id:            number | null;
  subject_id:         number | null;
  is_double_start:    boolean;
  parallel_group_key: string | null;
  // คาบคู่ (double period) — two linked elective slots share a double_group_key;
  // the second period is flagged is_double_cont.
  double_group_key?:  string | null;
  is_double_cont?:    boolean;
  // คาบกิจกรรมประจำระดับชั้น (เช่น สาธารณประโยชน์ ม.5 คาบ 7)
  is_activity_block?: boolean;
  activity_key?:      string | null;   // ใช้ลบทั้งระดับพร้อมกัน
  activity_level?:    string | null;
  is_locked:          boolean;    // pre-lock flag
  // วิชาเสรี — pinned slot with a swappable catalog of subject+teacher choices
  is_elective?:        boolean;
  elective_options?:   ElectiveOption[];
  selected_option_id?: number | null;
  // Set when the slot came from a shared elective pool (กลุ่มวิชาเสรี). Such a
  // slot deliberately has no selected option: the class splits across every
  // option at once, so no single subject or teacher belongs in the cell.
  elective_pool_id?:   number | null;
  elective_label?:     string | null;
  // Enriched
  teacher_name:   string | null;
  group_name:     string | null;
  room_name:      string | null;
  room_type:      RoomType | null;
  subject_name:   string | null;
  subject_code:   string | null;
}

export interface SolverResult {
  status:              SolverStatus;
  slots_created:       number;
  solve_time_seconds:  number;
  objective_value:     number | null;
  violations:          string[];
  engine?:             string;   // "cp-sat" | "greedy" | "greedy-fallback"
  /** Requirements the run tried and failed to place. */
  unplaced_requirement_ids?: number[];
  /** Requirements the run was told to leave out. */
  skipped_requirement_ids?:  number[];
}

/**
 * A lesson requirement that cannot be scheduled, and why.
 *
 * "blocking" is impossible as written and will always fail. "warning" depends
 * on something over capacity — which of a class's lessons to drop is the
 * school's call, so every one of them is listed rather than a guess.
 */
export interface RequirementProblem {
  requirement_id: number;
  group_id:     number;  group_name:   string | null;
  teacher_id:   number;  teacher_name: string | null; teacher_code: string | null;
  subject_id:   number;  subject_code: string | null; subject_name: string | null;
  weekly_count: number;
  severity: "blocking" | "warning";
  reasons:  string[];
}

export interface RequirementProblemReport {
  problems: RequirementProblem[];
  blocking: number;
  warning:  number;
  total_requirements: number;
}

// ── Schedule constants ───────────────────────────────────────────────────────
export const DAYS    = ["จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์"] as const;
export const DAYS_EN = ["Mon","Tue","Wed","Thu","Fri"]                as const;

/** Default period manifest (overridden from API /periods if available) */
export const DEFAULT_PERIODS: Period[] = [
  { id:1,  period_num:0, label:"เคารพธงชาติ/โฮมรูม", start_time:"07:50", end_time:"08:30",  type:"assembly",  applies_to:"all"   },
  { id:2,  period_num:1, label:"คาบ 1",               start_time:"08:30", end_time:"09:20",  type:"class",     applies_to:"all"   },
  { id:3,  period_num:2, label:"คาบ 2",               start_time:"09:20", end_time:"10:10",  type:"class",     applies_to:"all"   },
  { id:4,  period_num:3, label:"คาบ 3",               start_time:"10:10", end_time:"11:00",  type:"class",     applies_to:"all"   },
  { id:5,  period_num:4, label:"คาบ 4",               start_time:"11:00", end_time:"11:50",  type:"class",     applies_to:"all"   },
  { id:6,  period_num:5, label:"พัก (ม.1-3)",         start_time:"11:50", end_time:"12:00",  type:"break",     applies_to:"lower" },
  { id:7,  period_num:6, label:"กินข้าว (ม.1-3)",     start_time:"12:00", end_time:"12:50",  type:"lunch",     applies_to:"lower" },
  { id:8,  period_num:5, label:"คาบ 5",               start_time:"11:50", end_time:"12:40",  type:"class",     applies_to:"upper" },
  { id:9,  period_num:6, label:"พัก (ม.4-6)",         start_time:"12:40", end_time:"12:50",  type:"break",     applies_to:"upper" },
  { id:10, period_num:7, label:"คาบ 6",               start_time:"12:50", end_time:"13:40",  type:"class",     applies_to:"all"   },
  { id:11, period_num:8, label:"คาบ 7",               start_time:"13:40", end_time:"14:30",  type:"class",     applies_to:"all"   },
  { id:12, period_num:9, label:"โฮมรูม/กิจกรรม",     start_time:"14:30", end_time:"15:00",  type:"homeroom",  applies_to:"all"   },
];

/** Unique columns rendered in the grid (deduplicated period_num) */
export const GRID_PERIODS = Array.from(
  new Map(DEFAULT_PERIODS.map((p) => [p.period_num, p])).values()
).sort((a, b) => a.period_num - b.period_num);

export const SCHEDULABLE_PERIOD_NUMS = GRID_PERIODS
  .filter((p) => p.type === "class")
  .map((p) => p.period_num);

/**
 * Friendly label for a period_num, e.g. 7 → "คาบ 6".
 * Prefer passing the live `periods` from the store; falls back to defaults.
 * NOTE: period_num is a 0-based internal index with gaps for break/lunch, so it
 * must never be shown to users directly — always run it through this helper.
 */
export function periodLabel(periodNum: number, periods: Period[] = GRID_PERIODS): string {
  const p = periods.find((x) => x.period_num === periodNum && x.type === "class")
    ?? periods.find((x) => x.period_num === periodNum);
  return p?.label ?? `คาบ ${periodNum}`;
}

export function periodTime(periodNum: number, periods: Period[] = GRID_PERIODS): string {
  const p = periods.find((x) => x.period_num === periodNum && x.type === "class")
    ?? periods.find((x) => x.period_num === periodNum);
  return p ? `${p.start_time}–${p.end_time}` : "";
}

export interface Department {
  id:   number;
  name: string;   // "กลุ่มสาระคณิตศาสตร์", "กลุ่มสาระวิทยาศาสตร์", …
}

export interface SchoolConfig {
  schoolName: string;   // ชื่อโรงเรียน
  term:       string;   // "1" หรือ "2"
  year:       string;   // "2568"
  directorName: string; // ชื่อผู้อำนวยการ
  deputyName?:  string; // รองผู้อำนวยการกลุ่มบริหารวิชาการ
  /** The school crest, stored as a data URL so it travels with the backup. */
  logoUrl?:   string;
}

// Drag item payload
export interface DragItem {
  slotId:            number;
  fromDay:           number;
  fromPeriod:        number;
  parallelGroupKey:  string | null;
}
