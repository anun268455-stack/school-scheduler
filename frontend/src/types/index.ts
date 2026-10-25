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
  /**
   * ครูที่จองห้องนี้ไว้ — empty means anyone may use it.
   *
   * A room can belong to several teachers who share it. This was a single
   * teacher once, so `reserved_teacher_id` is still read from older data.
   */
  reserved_teacher_ids?: number[];
  /**
   * ชั้นเรียนที่ใช้ห้องนี้ได้ — empty means any class.
   *
   * A school short of rooms gives one to a class outright: 247 is ม.5/1's
   * and nobody else's. A sub-class counts as its parent.
   */
  reserved_group_ids?: number[];
  reserved_teacher_id?: number | null;
  /**
   * ห้ามใช้ — false keeps the scheduler out of this room entirely.
   * For staff rooms, offices and anything else that is not a classroom.
   */
  usable?:             boolean;
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
  /** ครูประจำชั้น — the first of them, kept in step for older readers. */
  homeroom_teacher_id: number | null;
  /** The real field: a class may have two. Read it via utils/homeroom. */
  homeroom_teacher_ids?: number[];
  advanced_settings?: GroupAdvanced;
  children:          StudentGroup[];
  /**
   * เรียนที่ลานได้ไหม สำหรับทั้งห้องเรียนนี้ — ทับค่าของรายวิชา.
   *
   * ห้องวิทย์-คณิต ที่ต้องได้ห้องเรียนก่อน ติ๊กครั้งเดียวจบ แทนที่จะไล่ตั้ง
   * ทีละวิชา ส่วนคาบไหนยกเว้นก็ตั้งรายคาบทับได้อีกที
   */
  allow_outdoor?:      boolean | null;
  /**
   * เรียนในห้องประจำชั้นเสมอ — ห้องเพชร และห้องโครงการที่มีห้องของตัวเอง.
   *
   * null = ดูจาก "กันไว้ให้ชั้นเรียน" ของห้องนั้น ถ้าโรงเรียนกันห้องไว้ให้
   * ชั้นนี้ ก็ถือว่าเป็นห้องของเขา ไม่ต้องเดินไปตึกอื่น ยกเว้นวิชาที่ตั้งไว้
   * ว่าต้องเรียนที่ห้องประจำวิชา
   */
  stay_in_homeroom?:   boolean | null;
}

export interface TeacherAdvanced {
  ignore_consecutive_limit?: boolean;  // ไม่จำกัดคาบต่อเนื่อง
  /** This teacher's own ceiling; omitted = follow the school's. */
  max_consecutive?:          number;
  /** เวรคาบสุดท้าย per week; omitted = follow the school's, 0 = exempt. */
  min_last_period?:          number;
  require_ground_floor?:     boolean;  // ต้องสอนชั้น 1 เท่านั้น (เหตุสุขภาพ)
  /**
   * ห้องของครูคนนี้ กับ ห้องประจำชั้นของนักเรียน อันไหนมาก่อน.
   * true = นักเรียนเดินมาหาครู · false = ครูเดินไปสอน · ไม่ใส่ = ตามโรงเรียน
   */
  room_over_homeroom?:       boolean;
  days_off?:                 number[]; // วันที่ไม่สอน [0=จ, 1=อ, ... 4=ศ]
  avoid_periods?:            number[]; // คาบที่หลีกเลี่ยง
  note?:                     string;   // หมายเหตุ
}

export interface Teacher {
  id:                   number;
  code?:                string | null;   // รหัสประจำตัวครู (ใช้ในหัวกระดาษตอนพิมพ์)
  /** ลำดับในกลุ่มสาระ — รหัสเรียงตามลำดับนี้ ตั้งได้ที่หน้ากลุ่มสาระ */
  dept_order?:          number | null;
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
  /**
   * วิชาเสรี — a subject students CHOOSE, not one the whole class sits.
   * Several classes offering it share one hour and one teacher, so it is
   * counted once rather than once per class. See utils/teachingLoad.
   */
  is_elective?:  boolean;
  fixed_room_id?: number | null; // ห้องประจำวิชา — สำคัญกว่าห้องประจำชั้นของนักเรียน
  /**
   * ห้องที่วิชานี้ใช้ได้ — ได้มากกว่าหนึ่งห้อง.
   *
   * ฟิสิกส์ลง 353 ไม่หมด เพราะคาบต่อสัปดาห์มากกว่าชั่วโมงที่ห้องมี ส่วนที่
   * ล้นเคยไปอยู่ห้องเรียนธรรมดา ใส่ห้องเคมี/ชีววิทยาไว้เป็นห้องสำรองได้
   * ว่างห้องไหนใช้ห้องนั้น โดยเลือกห้องในอาคารเดียวกับห้องเรียนก่อน
   */
  fixed_room_ids?: number[] | null;
  /**
   * อาคารที่วิชานี้เรียนได้ — ไม่ใส่ = อาคารไหนก็ได้.
   *
   * แนะแนว ม.6 ต้องมีห้อง และต้องอยู่อาคาร 1 เท่านั้น การไล่ใส่ห้องของ
   * อาคาร 1 ทีละห้องก็บอกเรื่องเดียวกัน จนกว่าโรงเรียนจะเพิ่มห้องใหม่แล้ว
   * ลืมมาเพิ่มตรงนี้ — กฎที่แท้จริงคืออาคาร
   */
  building_ids?: number[] | null;
  building_id?:  number | null;
  /** วิชายากควรอยู่ช่วงเช้า — a nudge the solver tries first, never a rule. */
  prefer_morning?: boolean;
  /**
   * วันที่วิชานี้ไม่เรียน — 0 จันทร์ ถึง 4 ศุกร์ ไม่ใส่ = เรียนได้ทุกวัน
   *
   * ไม่ใช่ความชอบ แต่เป็นวันที่ทั้งโรงเรียนไปทำอย่างอื่น เช่น พละไม่เรียน
   * วันพฤหัสเพราะเป็นวันลูกเสือ ระบบจะไม่ลงวิชานี้ในวันนั้นเลยแม้แต่คาบเดียว
   * และถ้าเหลือวันไม่พอจะลงครบ จะรายงานว่าลงไม่ครบ แทนที่จะแอบลงวันที่ห้ามไว้
   */
  blocked_days?: number[] | null;
  /**
   * เรียนที่ลานได้ไหม — true ได้, false ห้าม, undefined ไม่ได้ระบุ.
   *
   * Open ground is overflow, never a first choice: a ticked subject goes out
   * only once the classrooms are full.
   */
  allow_outdoor?: boolean | null;
  /**
   * เรียนที่ไหน — "subject" ห้องประจำวิชาเท่านั้น (พละ, นาฏศิลป์),
   * "homeroom" ห้องของนักเรียน ครูเดินมาหา (แนะแนว), undefined = ปกติ.
   */
  room_rule?: "subject" | "homeroom" | null;
}

export interface LessonRequirement {
  id:                 number;
  group_id:           number;
  subject_id:         number;
  /**
   * ครูผู้สอน — 0 while the school has not chosen one yet.
   *
   * A เซ็ตห้องย่อย says which subjects the subgroups take at the same hour,
   * and that is often settled before anyone knows who will teach them. Such
   * a row is kept and reported ("ยังไม่ได้เลือกครู"), and never placed: a
   * lesson with nobody in the room is not a lesson. Zero rather than null so
   * the dozen places that group and compare teachers keep working on a plain
   * number; nothing real ever has id 0.
   */
  teacher_id:         number;
  weekly_count:       number;
  parallel_group_key: string | null;
  /**
   * แถวนี้ไม่ต้องหาที่ลงเอง — คิดจากข้อมูลอื่น ไม่ได้เก็บไว้ในแถว
   *
   * served_by_elective: ห้องนี้นั่งอยู่ในคาบเสรีที่เปิดวิชานี้ให้เลือกอยู่แล้ว
   *                     คาบเสรีคือชั่วโมงที่สอนจริง แถวในแผนคือสิทธิ์ที่จะเลือก
   * co_half:            สอนร่วมที่เขียนไว้สองแถว แถวนี้คือครึ่งหลัง คาบเดียวกัน
   */
  served_by_elective?: boolean;
  co_half?:            boolean;
  /**
   * สอนร่วม — a second teacher in the room for the same lesson.
   *
   * For a student teacher with their mentor, or a foreign teacher paired with
   * a Thai one. Not a second lesson: one period, one room, both of them in
   * it, so both are busy and neither can be booked elsewhere at that hour.
   */
  co_teacher_id?:     number | null;
  /**
   * ห้องที่โรงเรียนกำหนดไว้เองสำหรับคาบนี้ของห้องเรียนนี้.
   *
   * ห้องประจำวิชาช่องเดียวใช้ไม่ได้กับวิชาที่มีครูหลายคน — ครูคนหนึ่งสอนที่
   * ห้องแล็บ อีกคนสอนที่ห้องของตัวเอง จึงกำหนดเป็นรายห้องเรียนที่นี่
   * มาก่อนทุกกฎ · null = ให้ระบบเลือกให้
   */
  room_id?:           number | null;
  /**
   * ล็อกวัน/คาบของคาบนี้ไว้ — null = ปล่อยให้ตัวจัดตารางเลือกเอง.
   *
   * ใช้กับเซ็ตห้องย่อยที่โรงเรียนตกลงเวลาไว้แล้ว ตัวจัดตารางจะไม่ย้ายไป
   * คาบอื่น ถ้าคาบนั้นไม่ว่างจะรายงานว่าลงไม่ได้แทนที่จะย้ายเงียบ ๆ
   */
  pinned_day?:        number | null;
  pinned_period?:     number | null;
  /** คาบคู่ — คาบนี้กิน 2 คาบติดกันนับจากคาบที่ล็อกไว้. */
  pinned_double?:     boolean;
  /**
   * เรียนที่ลานได้ไหม เฉพาะคาบนี้ — ทับค่าของห้องเรียนและของรายวิชา.
   * null/undefined = ไม่ระบุ ใช้ค่าที่ตั้งไว้ระดับบน
   */
  allow_outdoor?:     boolean | null;
}

export interface ElectiveOption {
  id:         number;
  subject_id: number;
  /** null until the school says who takes it — see ElectivePoolOption. */
  teacher_id: number | null;
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
  // null while nobody is recorded as teaching it. An elective list imported
  // before the teaching is shared out arrives this way.
  teacher_id: number | null;
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
  missing_teacher_count?: number;   // options with no teacher chosen yet
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
  /** สอนร่วม — the second teacher in the room for this same lesson. */
  co_teacher_id?:     number | null;
  co_teacher_name?:   string | null;
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
  /**
   * ครูผู้ดูแลคนที่ 2 เป็นต้นไป (คนแรกอยู่ที่ teacher_id ตามปกติ) — ลูกเสือ
   * เนตรนารี ชุมนุม มักมีครูหลายคนคุมห้องเดียวกัน ทุกคนถือว่าไม่ว่างในคาบนี้
   */
  activity_teacher_ids?:   number[];
  activity_teacher_names?: string[];
  /** เช่น "ม.1–ม.3 14 ห้อง" — ใช้แทนชื่อห้องในตารางของครูผู้ดูแล */
  activity_scope?:         string | null;
  is_locked:          boolean;    // pre-lock flag
  /**
   * คาบที่ยังจัดไม่ลงตัว — ระบบหาที่ลงตามกติกาไม่ได้ จึงวางไว้ในช่องที่
   * นักเรียนว่าง เพื่อให้เห็นว่ายังมีวิชานี้ค้างอยู่ ขึ้นกรอบแดง ไม่กำหนดห้อง
   * และไม่นับเป็นคาบที่จัดสำเร็จ พอย้ายหรือให้ห้อง/ครูที่ว่างแล้ว ธงนี้หายไปเอง
   */
  is_overflow?:       boolean;
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
  /** Worth saying, but not faults — these do not make a run INFEASIBLE. */
  notes?:              string[];
  /**
   * แก้เฉพาะห้องที่เลือก — only present when the request carried
   * `repair_group_ids`. The summary is Thai, written by the server.
   */
  repair_summary?:       string;
  /**
   * Lessons OUTSIDE the chosen classes that the server says changed. The
   * promise is 0; anything else is the button breaking it and is shown as such.
   */
  repair_outside_changed?: number;
  engine?:             string;   // "cp-sat" | "greedy" | "greedy-fallback"
  /** Requirements the run tried and failed to place. */
  unplaced_requirement_ids?: number[];
  /** Requirements the run was told to leave out. */
  skipped_requirement_ids?:  number[];
  /** The back-to-back limits this run applied. */
  max_consecutive?:    number;
  prefer_consecutive?: number;
  /** How much walking the timetable asks for, measured afterwards. */
  walking?: {
    class_moves: number; class_pairs: number; class_move_pct: number;
    teacher_moves: number; teacher_pairs: number; teacher_move_pct: number;
    homeroom_hits: number; homeroom_total: number; homeroom_pct: number;
    /** Why the walking is as high as it is — both the school's to fix. */
    classes_without_homeroom: number;
    spare_ordinary_rooms: number;
  };
  /** เวรคาบสุดท้าย: how many teachers ended up with their share. */
  last_period?: {
    teachers: number; met: number; moved: number; swapped?: number; school_min: number;
    /** คาบสุดท้ายของวัน — how freely this run was allowed to use it. */
    mode?: "reserve" | "never" | "free";
    /** คาบที่ดึงกลับลงมาให้เรียนก่อนหน้าได้ */
    drained?: number;
    /** คาบสุดท้ายที่ยังเหลืออยู่ทั้งโรงเรียน */
    left?: number;
    /** ชื่อห้อง → จำนวนคาบสุดท้ายที่ห้องนั้นยังต้องเรียน */
    classes?: Record<string, number>;
  };
  /** How the teaching runs actually came out — the check on the ceiling. */
  consecutive?: {
    runs: Record<string, number>;     // run length → how many times it happened
    longest: number;
    longest_teacher: string | null;
  };
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
/**
 * The standard Thai one-letter day abbreviations.
 *
 * Slicing the full name gave "จั" and "อั" — not abbreviations, just truncated
 * words. พฤหัสบดี needs two letters because พุธ already has พ.
 */
export const DAYS_SHORT = ["จ","อ","พ","พฤ","ศ"]                      as const;

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
  /** รหัสประจำตัวครูคนแรกของกลุ่มสาระนี้ — ภาษาไทย = 101, คนถัดไป 102 … */
  code_base?: number;
}

export interface SchoolConfig {
  schoolName: string;   // ชื่อโรงเรียน
  term:       string;   // "1" หรือ "2"
  year:       string;   // "2568"
  directorName: string; // ชื่อผู้อำนวยการ
  deputyName?:  string; // รองผู้อำนวยการกลุ่มบริหารวิชาการ
  /** The school crest, stored as a data URL so it travels with the backup. */
  logoUrl?:   string;
  /** Most periods in a row a teacher may be given, and what to aim for. */
  max_consecutive?:    number;
  prefer_consecutive?: number;
  /** เวรคาบสุดท้าย: last-period lessons each teacher should carry per week. */
  min_last_period?:    number;
  /** เพดานคาบสุดท้าย/สัปดาห์ต่อครู — 0 = ไม่จำกัด */
  max_last_period?:    number;
  /**
   * ห้องของครู กับ ห้องประจำชั้นของนักเรียน อันไหนมาก่อน.
   *
   * false (ค่าเริ่มต้น) = นักเรียนอยู่กับที่ ครูเดินไปสอน
   * true = นักเรียนเดินไปเรียนที่ห้องของครู
   * ครูแต่ละคนตั้งสวนทางได้ที่การตั้งค่าของตัวเอง
   */
  teacher_room_over_homeroom?: boolean;
}

// Drag item payload
export interface DragItem {
  slotId:            number;
  fromDay:           number;
  fromPeriod:        number;
  parallelGroupKey:  string | null;
}
