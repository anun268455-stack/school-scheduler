/**
 * วิเคราะห์ห้อง — กวาดทั้งตารางหาคาบที่ไม่ได้อยู่ในห้องทั้งที่มีห้องว่าง
 *
 *   "ตอนนี้ปรับปรุงเสร็จหมดแล้ว แต่ก็มีคาบบางห้องที่ว่างแล้ว บางห้องก็เรียนลาน
 *    อยากให้มีปุ่มตรวจสอบ ถ้าคาบว่างตรงกับห้องก็แจ้งเตือนมา"
 *
 * ── สิ่งที่วัดได้จากตารางจริง (26 ต.ค. · คาบ 2,735) ─────────────────────
 * มีคาบอยู่บนลาน 272 คาบ ในนั้น 144 คาบเป็นวิชาพละ (ถูกแล้ว) และ 14 คาบอยู่
 * บนลานเพราะปักหมุด 📌 ไว้เอง (ตั้งใจ) เหลือ **115 คาบที่เป็นวิชาในห้องเรียน
 * แต่ไปเรียนบนลาน** — ภาษาไทย อังกฤษ ญี่ปุ่น สังคม คณิต การงาน ฯลฯ
 * และเกือบทุกคาบมีห้องในอาคารว่างอยู่ในชั่วโมงนั้นพอดี
 *
 * เกือบทั้งหมดเป็น ม.4–ม.6 ซึ่งไม่มีห้องประจำ (2 จาก 115 เท่านั้นที่ชั้นมีห้อง
 * ประจำ และไม่มีคาบไหนเลยที่ห้องประจำว่างพอดี) ตัวเลือกห้องจึงต้องหาจากห้อง
 * ว่างทั่วไป ไม่ใช่พึ่งห้องประจำ
 *
 * การย้ายที่เสนอตรงนี้ **เปลี่ยนแค่ห้อง** ไม่ขยับวันหรือคาบ และไม่เบียดใคร
 * ตารางนักเรียนจึงเหมือนเดิมทุกช่อง
 */
import type { Period, Room, StudentGroup, Subject, TimetableSlot } from "../types";
import { roomTakes } from "./swapPlanner";
import { levelKeyOf, periodsForLevel } from "./levels";

export interface YardPick { group_id: number; day: number; period: number; room_id: number }

export interface AuditWorld {
  slots:    TimetableSlot[];
  rooms:    Room[];
  groups:   StudentGroup[];
  subjects: Subject[];
  /** ผังคาบ — ใช้ดูว่าสองคาบ "ติดกัน" ไหม (ม.ต้น/ม.ปลาย คนละผัง) */
  periods?: Period[];
}

/**
 * วิชาเดียวกัน ชั้นเดียวกัน วันเดียวกัน — เป็นอะไรกันแน่
 *
 *   "ช่วยเพิ่มคอลัมน์ให้หน่อยว่ามีคาบที่ซ้ำกันใน 1 วันไหม รวมถึงคาบคู่ด้วย"
 *
 * สามอย่างนี้หน้าตาเหมือนกันในข้อมูลดิบ แต่คนละเรื่องกันสิ้นเชิง
 *   คาบคู่             — ผูกกันไว้แล้ว ติดกัน ตั้งใจ ไม่ต้องแก้
 *   ติดกันแต่ไม่ผูกคู่ — อยู่ติดกันแต่ระบบไม่รู้ว่าเป็นคาบคู่ ควรผูกให้
 *   ซ้ำคนละช่วง        — เช้าทีบ่ายที เด็กเรียนวิชาเดิมสองรอบในวันเดียว
 */
export type DupKind = "คาบคู่" | "ติดกันแต่ไม่ผูกคู่" | "ซ้ำคนละช่วง";

export interface SameDayDup {
  groupId:   number;
  groupName: string;
  day:       number;
  subjectCode: string;
  teacherName: string;
  /** คาบที่วิชานี้ลงไว้ในวันนั้น เรียงจากน้อยไปมาก */
  periods:   number[];
  slotIds:   number[];
  kind:      DupKind;
  note:      string;
}

export type AuditKind = "เรียนลาน" | "ไม่มีห้อง";

export interface AuditRow {
  kind: AuditKind;
  /** แถวหลักที่เอาไว้โชว์ */
  slot: TimetableSlot;
  /** ทุกคาบของเรื่องเดียวกัน — คาบคู่คือสองแถวในตารางแต่เป็นเรื่องเดียว */
  slotIds: number[];
  periods: number[];
  /** อยู่ที่ไหนตอนนี้ */
  nowName: string;
  /** ห้องที่ว่างและรับคาบนี้ได้ เรียงจากที่เหมาะที่สุด */
  free: Room[];
  note: string;
}

export interface RoomAudit {
  rows: AuditRow[];
  /** วิชาเดียวกันลงซ้ำในวันเดียว — ทั้งโรงเรียน ไม่ใช่เฉพาะแถวเรื่องห้อง */
  dups: SameDayDup[];
  /** คาบไหนอยู่ในชุดซ้ำแบบไหน — ไว้เติมคอลัมน์ในตารางเรื่องห้อง */
  dupOf: Map<number, DupKind>;
  /** แถวที่หาห้องให้ไม่ได้เลย */
  stuck: AuditRow[];
  /** ห้องที่ใช้สอนได้แต่ไม่มีคาบไหนใช้เลยทั้งสัปดาห์ */
  neverUsed: Room[];
  /** ห้องที่โรงเรียนตั้งไว้ว่าใช้สอนไม่ได้ */
  closed: Room[];
  /** คาบพละที่อยู่บนลาน — ถูกแล้ว ไม่เตือน */
  peOnYard: number;
  /** คาบที่อยู่บนลานเพราะปักหมุดไว้เอง — ตั้งใจ ไม่เตือน */
  pinnedOnYard: number;
  /** คาบกิจกรรมที่ไม่มีห้อง (ลูกเสือ ชุมนุม ฯลฯ) — ปกติ ไม่เตือน */
  activityNoRoom: number;
}

/** รหัสวิชากิจกรรมที่ไม่ต้องมีห้อง */
const ACTIVITY = new Set([
  "ลส.นน.ยว.", "ชุมนุม", "คุณธรรม", "สาธารณประโยชน์", "แนะแนว",
]);

/** กลุ่มสาระสุขศึกษาและพลศึกษา — วิชาพละอยู่บนลานถือว่าถูก */
function isPE(s: TimetableSlot, deptOf: Map<number, number | null>): boolean {
  if (s.subject_id != null && deptOf.get(s.subject_id) === PE_DEPT) return true;
  // บางวิชายังไม่ได้ผูกหมวด แต่รหัสขึ้นต้นด้วย พ ก็คือพละ — วัดจากตารางจริง
  // มี 10 คาบแบบนี้ (พ30204, พ32202) ถ้าไม่กันไว้จะไปโผล่ในรายการเตือน
  return (s.subject_code ?? "").startsWith("พ");
}
const PE_DEPT = 6;

function flat(groups: StudentGroup[]): StudentGroup[] {
  const out: StudentGroup[] = [];
  const walk = (list: StudentGroup[]) => {
    for (const g of list) { out.push(g); walk(g.children ?? []); }
  };
  walk(groups);
  return out;
}

/**
 * "ลาน" คือห้องที่โรงเรียนตั้งชนิดไว้ว่า outdoor เท่านั้น
 *
 * อย่าเดาจากการไม่มีอาคาร — ตารางจริงมีห้องสอนจริง 11 ห้องที่ไม่ได้ผูกอาคาร
 * ไว้ (001–004 ศูนย์1-4 สอนห้องละ 30–35 คาบ · ห้องการงานตึก 1 · ห้องการงานใหม่
 * · ห้องเขียนแบบ) ถ้านับว่าเป็นลานด้วย จะไปเตือนคาบที่อยู่ในห้องจริงอีก 173 คาบ
 */
function isYard(r: Room | undefined): boolean {
  return !!r && r.type === "outdoor";
}

/**
 * ห้องที่ว่างชั่วโมงนั้นและรับคาบนี้ได้ เรียงจากที่เหมาะที่สุด
 *
 * ลำดับ: ห้องประจำของชั้นนี้ → ห้องธรรมดาในอาคารที่ไม่ใช่ห้องประจำของชั้นอื่น
 *        → ห้องเฉพาะของหมวดเดียวกัน → ห้องประจำของชั้นอื่น
 * ไม่เอาลานมาเสนอ เพราะกำลังพยายามออกจากลาน
 */
export function freeRoomsFor(
  world: AuditWorld, slot: TimetableSlot, periods: number[],
  busy: Map<string, number[]>, homeOf: Map<number, number>,
  homeRooms: Set<number>, ownIds: number[] = [],
): Room[] {
  const mine = homeOf.get(slot.group_id as number) ?? null;
  const own = new Set(ownIds);
  const ok: Room[] = [];
  for (const r of world.rooms) {
    if (isYard(r)) continue;
    if (!roomTakes(r, slot, world.subjects)) continue;
    // คาบของเรื่องนี้เองไม่นับว่าใช้ห้องอยู่ — คาบคู่ที่อีกครึ่งนั่งห้องนั้น
    // อยู่แล้ว ห้องนั้นคือคำตอบที่ดีที่สุด ไม่ใช่ห้องที่ต้องตัดทิ้ง
    const clash = periods.some((p) =>
      (busy.get(`${r.id}-${slot.day}-${p}`) ?? []).some((id) => !own.has(id)));
    if (clash) continue;
    ok.push(r);
  }
  const rank = (r: Room): number => {
    // ห้องที่ไม่ได้ผูกอาคารไว้ไปอยู่ท้ายสุดเสมอ — ในนั้นมีทั้งห้องสอนจริง
    // (ศูนย์1-4) และที่โล่งอย่าง "ลานแนะแนว" ซึ่งไม่ควรถูกหยิบเป็นตัวเลือกแรก
    const noBuilding = r.building_id == null ? 10 : 0;
    if (r.id === mine) return noBuilding + 0;
    if (!homeRooms.has(r.id) && !r.specialized_dept_id) return noBuilding + 1;
    if (r.specialized_dept_id) return noBuilding + 2;
    return noBuilding + 3;
  };
  return ok.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * วิชาเดียวกัน ชั้นเดียวกัน วันเดียวกัน — ทั้งโรงเรียน
 *
 * "ติดกัน" วัดด้วยตำแหน่งในผังคาบของชั้นนั้น ไม่ใช่เลขคาบลบกัน — ม.ต้นกับ
 * ม.ปลายพักกลางวันคนละคาบ เลขคาบจึงกระโดด (ม.ต้นมีคาบ 1,2,4,6,7… ส่วน
 * ม.ปลาย 1,2,4,5,7…) คาบ 2 กับคาบ 4 ของ ม.ต้นคือคาบที่ติดกันจริง ทั้งที่
 * เลขห่างกันสอง
 */
export function sameDayDuplicates(world: AuditWorld): SameDayDup[] {
  const groups = flat(world.groups);
  const byGroup = new Map(groups.map((g) => [g.id, g]));
  const numsFor = new Map<number, number[]>();
  const classNums = (groupId: number): number[] => {
    const hit = numsFor.get(groupId);
    if (hit) return hit;
    const nums = periodsForLevel(world.periods ?? [], levelKeyOf(byGroup.get(groupId)))
      .filter((p) => p.type === "class")
      .map((p) => p.period_num)
      .sort((a, b) => a - b);
    numsFor.set(groupId, nums);
    return nums;
  };

  const bucket = new Map<string, TimetableSlot[]>();
  for (const s of world.slots) {
    if (s.group_id == null || s.subject_id == null) continue;
    const k = `${s.group_id}-${s.day}-${s.subject_id}`;
    const list = bucket.get(k);
    if (list) list.push(s); else bucket.set(k, [s]);
  }

  const out: SameDayDup[] = [];
  for (const rows of bucket.values()) {
    if (rows.length < 2) continue;
    const first = rows[0];
    const periods = [...rows.map((r) => r.period)].sort((a, b) => a - b);
    // คาบคู่นับเป็นชุดเดียว — สองแถวที่ผูกกันไว้ไม่ใช่การซ้ำ
    const units = new Set(rows.map((r) => r.double_group_key || `s${r.id}`));
    const tied = rows.some((r) => r.double_group_key);
    let kind: DupKind;
    if (units.size === 1 && tied) {
      kind = "คาบคู่";
    } else {
      const nums = classNums(first.group_id as number);
      const pos = new Map(nums.map((n, i) => [n, i]));
      const ix = periods.map((x) => pos.get(x)).filter((x): x is number => x != null);
      const adjacent = ix.length === periods.length && periods.length === 2
        && Math.abs(ix[1] - ix[0]) === 1;
      kind = adjacent ? "ติดกันแต่ไม่ผูกคู่" : "ซ้ำคนละช่วง";
    }
    out.push({
      groupId: first.group_id as number,
      groupName: first.group_name ?? "?",
      day: first.day,
      subjectCode: first.subject_code ?? first.subject_name ?? "?",
      teacherName: first.teacher_name ?? "",
      periods, slotIds: rows.map((r) => r.id), kind,
      note: kind === "คาบคู่"
        ? "คาบคู่ที่ผูกกันไว้แล้ว — ติดกัน ไม่ต้องแก้"
        : kind === "ติดกันแต่ไม่ผูกคู่"
        ? "อยู่ติดกันแต่ยังไม่ได้ผูกเป็นคาบคู่ — ผูกได้ที่ ⋯ เครื่องมือ › ตรวจความสอดคล้องของข้อมูล"
        : "วิชาเดียวกันสองรอบในวันเดียว คนละช่วง — ย้ายคาบหนึ่งไปวันอื่นถ้าไม่ได้ตั้งใจ",
    });
  }
  out.sort((a, b) => rank(a.kind) - rank(b.kind)
    || a.groupName.localeCompare(b.groupName) || a.day - b.day);
  return out;
}

const rank = (k: DupKind): number =>
  k === "ซ้ำคนละช่วง" ? 0 : k === "ติดกันแต่ไม่ผูกคู่" ? 1 : 2;

export function auditRooms(world: AuditWorld, yardPicks: YardPick[]): RoomAudit {
  const byId = new Map(world.rooms.map((r) => [r.id, r]));
  const deptOf = new Map(world.subjects.map((s) => [s.id, s.department_id ?? null]));
  const pinned = new Map(yardPicks.map((y) => [`${y.group_id}-${y.day}-${y.period}`, y.room_id]));
  const groups = flat(world.groups);
  const homeOf = new Map<number, number>();
  const homeRooms = new Set<number>();
  for (const g of groups) {
    if (g.homeroom_room_id != null) {
      homeOf.set(g.id, g.homeroom_room_id);
      homeRooms.add(g.homeroom_room_id);
    }
  }
  // ห้อง-วัน-คาบ → คาบที่ใช้ห้องนั้นอยู่ (เก็บ id ไว้ เพื่อแยกคาบของเรื่อง
  // เดียวกันออกตอนหาห้องให้คาบคู่)
  const busy = new Map<string, number[]>();
  for (const s of world.slots) {
    if (s.room_id == null) continue;
    const k = `${s.room_id}-${s.day}-${s.period}`;
    const list = busy.get(k);
    if (list) list.push(s.id); else busy.set(k, [s.id]);
  }

  // คาบคู่ = สองแถวในตาราง แต่เป็นเรื่องเดียว ยุบให้เหลือแถวเดียว
  const seen = new Set<number>();
  const partnersOf = (s: TimetableSlot): TimetableSlot[] => {
    if (!s.double_group_key) return [s];
    return world.slots.filter((x) => x.double_group_key === s.double_group_key
      && x.group_id === s.group_id && x.day === s.day);
  };

  const rows: AuditRow[] = [];
  let peOnYard = 0, pinnedOnYard = 0, activityNoRoom = 0;

  for (const s of world.slots) {
    if (seen.has(s.id)) continue;
    const room = s.room_id != null ? byId.get(s.room_id) : undefined;
    const onYard = s.room_id != null && isYard(room);
    const noRoom = s.room_id == null;
    if (!onYard && !noRoom) continue;

    if (noRoom && (!s.subject_code || ACTIVITY.has(s.subject_code))) {
      activityNoRoom++; continue;
    }
    if (onYard && isPE(s, deptOf)) { peOnYard++; continue; }

    const pin = pinned.get(`${s.group_id}-${s.day}-${s.period}`) ?? null;
    // ปักหมุด 📌 ไว้เองว่าชั่วโมงนี้เรียนลาน = ตั้งใจ ไม่ใช่ปัญหา
    if (onYard && pin != null) { pinnedOnYard++; continue; }

    const group = partnersOf(s);
    for (const x of group) seen.add(x.id);
    const periods = group.map((x) => x.period).sort((a, b) => a - b);

    // ปักหมุดลานไว้แล้วแต่คาบยังไม่มีห้อง — คำตอบมีอยู่แล้ว คือลานที่ปักไว้
    if (noRoom && pin != null) {
      const yardRoom = byId.get(pin);
      // หมุดบอกเจตนา ไม่ได้การันตีว่าลานนั้นยังว่าง — ถ้ามีชั้นอื่นใช้อยู่
      // แล้ว เสนอไปก็จะกลายเป็นห้องซ้ำ จึงต้องเช็กก่อนเหมือนห้องอื่น
      const ours = new Set(group.map((x) => x.id));
      const yardBusy = yardRoom != null && periods.some((p) =>
        (busy.get(`${yardRoom.id}-${s.day}-${p}`) ?? []).some((id) => !ours.has(id)));
      rows.push({
        kind: "ไม่มีห้อง", slot: s, slotIds: group.map((x) => x.id), periods,
        nowName: "ยังไม่มีห้อง",
        free: yardRoom && !yardBusy ? [yardRoom] : [],
        note: !yardRoom
          ? "ปักหมุดลานไว้ แต่หาลานนั้นไม่เจอแล้ว"
          : yardBusy
          ? `ปักหมุดไว้ว่าเรียนที่ ${yardRoom.name} แต่ชั่วโมงนี้มีชั้นอื่นใช้ลานนั้นอยู่`
            + " — ต้องเอาหมุดออก หรือย้ายอีกชั้นก่อน"
          : `ปักหมุดไว้ว่าเรียนที่ ${yardRoom.name} แต่คาบยังไม่ได้ลงห้อง`
            + " — ใส่ห้องตามหมุดได้เลย",
      });
      continue;
    }

    const free = freeRoomsFor(world, s, periods, busy, homeOf, homeRooms,
                              group.map((x) => x.id));
    rows.push({
      kind: onYard ? "เรียนลาน" : "ไม่มีห้อง",
      slot: s,
      slotIds: group.map((x) => x.id),
      periods,
      nowName: onYard ? (room?.name ?? "ลาน") : "ยังไม่มีห้อง",
      free,
      note: free.length
        ? `ย้ายเข้า ${free[0].name} ได้เลย — ว่างอยู่ ${free.length} ห้อง`
        : "ไม่มีห้องไหนว่างในชั่วโมงนี้เลย",
    });
  }

  rows.sort((a, b) =>
    Number(b.free.length > 0) - Number(a.free.length > 0)
    || (a.slot.group_name ?? "").localeCompare(b.slot.group_name ?? "")
    || a.slot.day - b.slot.day || a.slot.period - b.slot.period);

  const used = new Set(world.slots.map((s) => s.room_id).filter((x): x is number => x != null));
  const closed = world.rooms.filter((r) => r.usable === false || (r.capacity ?? 1) <= 0);
  const neverUsed = world.rooms.filter(
    (r) => r.usable !== false && (r.capacity ?? 1) > 0 && !used.has(r.id));

  const dups = sameDayDuplicates(world);
  const dupOf = new Map<number, DupKind>();
  for (const d of dups) for (const id of d.slotIds) dupOf.set(id, d.kind);

  return {
    rows, stuck: rows.filter((r) => !r.free.length),
    neverUsed, closed, peOnYard, pinnedOnYard, activityNoRoom,
    dups, dupOf,
  };
}

/**
 * จัดห้องให้ทุกแถวพร้อมกัน โดยไม่ให้สองแถวแย่งห้องเดียวกัน
 *
 * ไล่ทีละแถว จองห้องที่เลือกแล้วค่อยไปแถวถัดไป — ถ้าเลือกจากรายการ `free`
 * ของแต่ละแถวตรง ๆ โดยไม่จอง สองคาบที่อยู่วันเดียวกันชั่วโมงเดียวกันจะได้ห้อง
 * เดียวกันทั้งคู่
 */
export function allocateRooms(
  audit: RoomAudit,
): { slotId: number; roomId: number; roomName: string; row: AuditRow }[] {
  const taken = new Map<number, Set<string>>();
  const out: { slotId: number; roomId: number; roomName: string; row: AuditRow }[] = [];
  // จัดให้แถวที่มีตัวเลือกน้อยที่สุดก่อน — หลายคาบอยู่วันและชั่วโมงเดียวกัน
  // แย่งห้องว่างชุดเดียวกัน ถ้าปล่อยให้แถวที่มีทางเลือกเยอะหยิบไปก่อน แถวที่มี
  // ทางเดียวจะเหลือศูนย์ วัดบนตารางจริง: เรียงตามลำดับที่โชว์จัดได้ 68 แถว
  // เรียงจากตัวเลือกน้อยไปมากจัดได้ 73 จากเพดานทางทฤษฎี 75
  const order = [...audit.rows].sort((a, b) => a.free.length - b.free.length);
  for (const row of order) {
    const pick = row.free.find((r) => {
      const t = taken.get(r.id);
      return !t || !row.periods.some((p) => t.has(`${row.slot.day}-${p}`));
    });
    if (!pick) continue;
    let t = taken.get(pick.id);
    if (!t) { t = new Set(); taken.set(pick.id, t); }
    for (const p of row.periods) t.add(`${row.slot.day}-${p}`);
    // คาบคู่: เซิร์ฟเวอร์พาอีกครึ่งไปห้องเดียวกันให้เอง ส่งแค่แถวแรกพอ
    out.push({ slotId: row.slotIds[0], roomId: pick.id, roomName: pick.name, row });
  }
  return out;
}
