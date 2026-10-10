/**
 * A new elective list, read off a sheet and turned into คาบเสรี.
 *
 * The school's elective offer arrives once a term as a page per level: a list
 * of classes along the top, twenty-odd subjects underneath, and the students
 * pick one. In the app that is one window plus twenty "add subject" clicks,
 * times eight levels — and most of those subjects have never been in the
 * system, so each one has to be created by hand first.
 *
 * So the sheet is read as a whole: one row per subject on offer, rows sharing
 * a ชุดวิชาเสรี making one window, and any subject code the system has never
 * seen created from the same row that mentions it.
 *
 * Nothing here talks to the API. The point of that is the awkward part: a row
 * can be wrong in half a dozen ways — a class that does not exist, a code with
 * no name to create it under, the same subject listed twice — and those have to
 * be decidable, and testable, before anything is written.
 */

export interface ElectiveRow {
  [column: string]: unknown;   // whatever else the sheet happened to carry
  pool_name?:    unknown;
  class_names?:  unknown;
  subject_code?: unknown;
  subject_name?: unknown;
  dept_name?:    unknown;
  teacher_name?: unknown;
  day_name?:     unknown;
  period_num?:   unknown;
  is_double?:    unknown;
}

export interface ElectiveLookups {
  /** An existing subject with this code, if there is one. */
  subjectByCode:  (code: string) => number | undefined;
  groupByName:    (name: string) => number | undefined;
  teacherByName:  (name: string) => number | undefined;
  deptByName:     (name: string) => number | undefined;
}

export interface NewSubjectSpec {
  code: string;
  name: string;
  department_id: number | null;
  type: "common";
  duration: number;
}

export interface PoolOptionPlan {
  code:       string;         // the subject is named by code until it has an id
  teacher_id: number | null;  // null = the school picks in the window itself
}

export interface PoolPlan {
  name:      string;
  raw_group: string;          // the class list as the sheet wrote it
  group_ids: number[];
  day:       number | null;
  period:    number | null;
  is_double: boolean;
  weekly:    number;
  options:   PoolOptionPlan[];
}

export interface ElectivePlan {
  pools:       PoolPlan[];
  newSubjects: NewSubjectSpec[];
  /** Rows that cannot be used, each said in a way the school can act on. */
  problems:    string[];
}

const txt = (v: unknown) => String(v ?? "").trim();
const norm = (v: unknown) => txt(v).replace(/\s+/g, "");

const DAY_NAMES = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์"];
const DAY_ALIASES: Record<string, number> = {
  "จ": 0, "จันทร์": 0, "mon": 0, "monday": 0,
  "อ": 1, "อังคาร": 1, "tue": 1, "tuesday": 1,
  "พ": 2, "พุธ": 2, "wed": 2, "wednesday": 2,
  "พฤ": 3, "พฤหัส": 3, "พฤหัสบดี": 3, "thu": 3, "thursday": 3,
  "ศ": 4, "ศุกร์": 4, "fri": 4, "friday": 4,
};

/**
 * Which day the sheet means, or null for "not decided yet".
 *
 * A bare number is refused on purpose. "1" is the first day to whoever typed it
 * and อังคาร to the app, and a window landing on the wrong day is the kind of
 * mistake nobody finds until a class turns up to an empty room.
 */
export function parseDay(v: unknown): number | null {
  const s = norm(v).toLowerCase().replace(/^วัน/, "");
  if (!s) return null;
  return DAY_ALIASES[s] ?? null;
}

/** ว่าง = ใช่: an elective window is a double unless the sheet says otherwise. */
export function parseDouble(v: unknown): boolean {
  const s = norm(v).toLowerCase();
  if (!s) return true;
  return !["ไม่", "ไม่ใช่", "ไม่ควบ", "เดี่ยว", "no", "n", "false", "0"].includes(s);
}

/**
 * "ม.1/7, ม.1/8 ม.1/9" → the three names, however they were separated.
 *
 * Not on "/" — a Thai class name is built round one, and splitting there turns
 * every row of the sheet into "ม.1" and "7". A class name has no space inside
 * it, so whitespace is a separator like any other.
 */
export function parseClassList(v: unknown): string[] {
  return txt(v).split(/[\s,;·、|]+/).filter(Boolean);
}

export function planElectiveImport(
  rows: ElectiveRow[], look: ElectiveLookups,
): ElectivePlan {
  const problems: string[] = [];
  const newSubjects = new Map<string, NewSubjectSpec>();
  const pools = new Map<string, PoolPlan>();
  // A class list is usually written on the first row of a window and left
  // blank down the rest of the block, so the last one seen carries forward.
  const seenCodes = new Map<string, Set<string>>();

  rows.forEach((row, i) => {
    const where = `แถว ${i + 2}`;            // +2: the header is row 1
    const poolName = txt(row.pool_name);
    const code = norm(row.subject_code).toUpperCase();
    if (!poolName && !code) return;          // a blank separator row
    if (!poolName) { problems.push(`${where}: ไม่ได้ระบุชุดวิชาเสรี`); return; }
    if (!code) { problems.push(`${where}: ไม่ได้ระบุรหัสวิชา`); return; }

    let pool = pools.get(poolName);
    if (!pool) {
      pool = {
        name: poolName, raw_group: txt(row.class_names), group_ids: [],
        day: parseDay(row.day_name),
        period: Number.isFinite(Number(row.period_num)) && txt(row.period_num) !== ""
          ? Number(row.period_num) : null,
        is_double: parseDouble(row.is_double),
        weekly: parseDouble(row.is_double) ? 2 : 1,
        options: [],
      };
      pools.set(poolName, pool);
      seenCodes.set(poolName, new Set());
      if (txt(row.day_name) && pool.day === null) {
        problems.push(`${where}: อ่านวัน "${txt(row.day_name)}" ไม่ออก — `
          + `ใช้ ${DAY_NAMES.join(" / ")}`);
      }
    }

    // Classes may be listed on any row of the window; every row's list is
    // added, so a long list split over two lines still arrives whole.
    for (const name of parseClassList(row.class_names)) {
      const gid = look.groupByName(norm(name));
      if (gid === undefined) {
        problems.push(`${where}: ไม่พบห้องเรียน "${name}"`);
      } else if (!pool.group_ids.includes(gid)) {
        pool.group_ids.push(gid);
      }
    }

    const dup = seenCodes.get(poolName)!;
    if (dup.has(code)) {
      problems.push(`${where}: ${code} อยู่ในชุด "${poolName}" ซ้ำกัน — ข้ามแถวนี้`);
      return;
    }
    dup.add(code);

    // A code the system has never seen is created, but only if the sheet also
    // gives it a name. A row with just a code is a typo more often than a new
    // subject, and inventing "พ20203" as its own name would bury it.
    if (look.subjectByCode(code) === undefined && !newSubjects.has(code)) {
      const name = txt(row.subject_name);
      if (!name) {
        problems.push(`${where}: ยังไม่มีวิชา ${code} ในระบบ และไม่ได้ใส่ชื่อวิชา — ข้ามแถวนี้`);
        dup.delete(code);
        return;
      }
      newSubjects.set(code, {
        code, name,
        department_id: look.deptByName(norm(row.dept_name)) ?? null,
        type: "common",
        duration: pool.is_double ? 2 : 1,
      });
    }

    const tName = txt(row.teacher_name);
    const tid = tName ? look.teacherByName(norm(tName)) : undefined;
    if (tName && tid === undefined) {
      problems.push(`${where}: ไม่พบครู "${tName}" — ใส่วิชาไว้ก่อนโดยยังไม่มีครู`);
    }
    pool.options.push({ code, teacher_id: tid ?? null });
  });

  for (const p of pools.values()) {
    if (p.group_ids.length === 0) {
      problems.push(`ชุด "${p.name}": ไม่มีห้องเรียนที่หาได้เลย — ชุดนี้จะไม่ถูกสร้าง`);
    }
  }

  return {
    pools: [...pools.values()].filter((p) => p.group_ids.length > 0),
    newSubjects: [...newSubjects.values()],
    problems,
  };
}
