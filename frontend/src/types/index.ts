// ─────────────────────────────────────────────────────────────────────────────
// Core domain types (v2 – period-aware, lock-aware, impact-aware)
// ─────────────────────────────────────────────────────────────────────────────

export type RoomType      = "physical" | "special" | "outdoor" | "floating";
export type SubjectType   = "common" | "parallel";
export type SubjectWeight = "heavy" | "light";
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
  weight:        SubjectWeight;
  department_id: number | null;
  is_activity:   boolean;       // true = ชุมนุม/ลูกเสือ/กิจกรรม
}

export interface LessonRequirement {
  id:                 number;
  group_id:           number;
  subject_id:         number;
  teacher_id:         number;
  weekly_count:       number;
  parallel_group_key: string | null;
}

export interface TimetableSlot {
  id:                 number;
  day:                number;     // 0=Mon … 4=Fri
  period:             number;     // period_num (0-based)
  teacher_id:         number;
  group_id:           number;
  room_id:            number | null;
  subject_id:         number;
  is_double_start:    boolean;
  parallel_group_key: string | null;
  is_locked:          boolean;    // pre-lock flag
  // Enriched
  teacher_name:   string | null;
  group_name:     string | null;
  room_name:      string | null;
  room_type:      RoomType | null;
  subject_name:   string | null;
  subject_code:   string | null;
  subject_weight: SubjectWeight | null;
}

export interface SolverResult {
  status:              SolverStatus;
  slots_created:       number;
  solve_time_seconds:  number;
  objective_value:     number | null;
  violations:          string[];
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

export interface Department {
  id:   number;
  name: string;   // "กลุ่มสาระคณิตศาสตร์", "กลุ่มสาระวิทยาศาสตร์", …
}

export interface SchoolConfig {
  schoolName: string;   // ชื่อโรงเรียน
  term:       string;   // "1" หรือ "2"
  year:       string;   // "2568"
  directorName: string; // ชื่อผู้อำนวยการ
  logoUrl?:   string;
}

// Drag item payload
export interface DragItem {
  slotId:            number;
  fromDay:           number;
  fromPeriod:        number;
  parallelGroupKey:  string | null;
}
