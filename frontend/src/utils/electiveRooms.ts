/**
 * electiveRooms — ห้องสอนของแต่ละวิชาในคาบเสรี
 *
 *   "คาบเสรี ครูมาบอกว่าต้องการห้องสอนที่นี้ เลยอยากให้ทำระบบที่เข้าไปที่ครู
 *    ที่สอนคนนั้นแล้วเลือกห้องให้ โดยจะขึ้นที่ตารางครูและตารางห้อง (ที่ทำแบบนี้
 *    เพื่อให้ตารางการใช้ห้องขึ้นคาบเสรีอันนี้)"
 *
 * คาบเสรีไม่เหมือนคาบอื่น มันคือ "หน้าต่างเวลา" หนึ่งช่องที่มีหลายวิชาเรียน
 * พร้อมกัน นักเรียนจากหลายห้องกระจายไปตามวิชาที่เลือก แต่ละวิชามีครูของตัวเอง
 * — ตัวคาบจึงไม่มีครูคนเดียวและไม่มีห้องเดียว ช่องห้องของตัวคาบถูกตั้งเป็นค่า
 * ว่างไว้โดยตั้งใจ (mock_api._sync_pool_slots)
 *
 * ของเดิมหยุดอยู่ตรงนั้น โดยมีเหตุผลเขียนไว้ว่าห้องเป็นเรื่องที่ครูไปตกลงกันเอง
 * ใบตารางแค่บอกขอบเขต ตอนนี้โรงเรียนต้องการให้ห้องถูกบันทึกไว้จริง เพราะ
 * ตารางการใช้ห้องต้องเห็นว่าชั่วโมงนั้นห้องไม่ว่าง
 *
 * ห้องจึงไปอยู่ที่ "วิชา" ไม่ใช่ที่ "คาบ" และไฟล์นี้คือที่เดียวที่ตอบคำถามว่า
 * คาบหนึ่งใช้ห้องอะไรบ้าง ซึ่งเมื่อก่อนตอบด้วยการอ่าน `room_id` ตรง ๆ
 *
 * ── กฎที่พลาดง่ายที่สุด ──
 *
 * หน้าต่างคาบเสรีหนึ่งหน้าต่างถูกเขียนเป็นหลายแถว แถวละห้องเรียน และทุกแถวถือ
 * สำเนาของตัวเลือกชุดเดียวกัน วิชา "กรีฑา" ในหน้าต่างที่มีสิบห้องเรียนจึง
 * ปรากฏสิบครั้งในข้อมูล ทั้งที่เป็นการใช้ห้องครั้งเดียวในโลกจริง (ครูคนเดียว
 * ห้องเดียว ชั่วโมงเดียว นักเรียนมาจากสิบห้อง) ถ้านับการจองห้องทีละแถว ห้องจะ
 * ฟ้องว่าชนกับตัวเองเก้าครั้ง แล้วจะไม่มีห้องไหนเลือกได้เลย
 *
 * ตัวนับการจองจึงยุบด้วย (กลุ่มวิชาเสรี · key ของตัวเลือก) ไม่ใช่ด้วยแถว —
 * `key` เท่ากันทุกแถวเพราะเป็นสำเนา ส่วน `id` ไม่เท่า เซิร์ฟเวอร์แจกใหม่ทีละแถว
 */

/** ตัวเลือกหนึ่งวิชาในคาบเสรี เท่าที่เรื่องห้องต้องรู้ */
export interface ElectiveOptionLike {
  /** คงที่ข้ามแถว — ตัวบอกว่า "วิชาเดียวกัน" */
  key?:        number;
  /** ต่างกันทุกแถว ใช้ตัดสินความเหมือนไม่ได้ */
  id?:         number;
  teacher_id:  number | null;
  room_id?:    number | null;
  label?:      string;
  subject_id?: number;
  code?:       string;
  // เติมโดยเซิร์ฟเวอร์ตอนส่งตารางออก (mock_api._enrich_slot)
  room_name?:    string | null;
  teacher_name?: string | null;
}

/** คาบหนึ่ง เท่าที่เรื่องห้องต้องรู้ */
export interface ElectiveSlotLike {
  id:                number;
  day:               number;
  period:            number;
  room_id:           number | null;
  room_name?:        string | null;
  teacher_id:        number | null;
  group_id?:         number;
  is_elective?:      boolean;
  elective_pool_id?: number | null;
  elective_options?: ElectiveOptionLike[] | null;
}

/** ห้องหนึ่งห้อง เท่าที่การเลือกห้องต้องรู้ */
export interface RoomLike {
  id:       number;
  name:     string;
  usable?:  boolean;
  capacity?: number | null;
  reserved_teacher_ids?: number[] | null;
  reserved_teacher_id?:  number | null;
}

const options = (s: ElectiveSlotLike): ElectiveOptionLike[] => s.elective_options ?? [];

/**
 * ห้องทุกห้องที่คาบนี้ใช้อยู่
 *
 * คาบปกติคือห้องของตัวเอง คาบเสรีคือห้องของทุกวิชาในนั้น — คาบเสรีจึง "อยู่"
 * ในหลายห้องพร้อมกันได้ ซึ่งเป็นเรื่องจริงของมัน ไม่ใช่ความผิดพลาดของข้อมูล
 */
export function slotRoomIds(s: ElectiveSlotLike): number[] {
  const out: number[] = [];
  const add = (id: number | null | undefined): void => {
    if (id && !out.includes(id)) out.push(id);
  };
  add(s.room_id);
  for (const o of options(s)) add(o.room_id);
  return out;
}

/** คาบนี้ใช้ห้องนี้อยู่ไหม — ตัวกรองของตารางห้องและใบพิมพ์ตารางการใช้ห้อง */
export function slotUsesRoom(s: ElectiveSlotLike, roomId: number): boolean {
  return roomId > 0 && slotRoomIds(s).includes(roomId);
}

/**
 * วิชาในคาบเสรีนี้ที่เรียนอยู่ในห้องนี้
 *
 * ตารางของห้อง 501 ต้องเขียนว่า "กรีฑา" ไม่ใช่ "วิชาเสรี" เพราะชั่วโมงนั้น
 * ห้อง 501 ถูกใช้สอนกรีฑา วิชาอื่นในคาบเสรีเดียวกันอยู่ห้องอื่น
 */
export function optionsInRoom(s: ElectiveSlotLike, roomId: number): ElectiveOptionLike[] {
  return options(s).filter((o) => o.room_id === roomId && roomId > 0);
}

/** วิชาที่ครูคนนี้สอนในคาบเสรีนี้ — null ถ้าไม่ได้สอนในคาบนี้ */
export function optionForTeacher(
  s: ElectiveSlotLike, teacherId: number | null | undefined,
): ElectiveOptionLike | null {
  if (teacherId == null) return null;
  return options(s).find((o) => o.teacher_id === teacherId) ?? null;
}

/**
 * ชื่อห้องที่ควรขึ้นบนตารางของครูคนนี้
 *
 * คาบเสรีมีหลายห้องพร้อมกัน ตารางของครูต้องขึ้นห้องของครูคนนั้น ไม่ใช่ห้องของ
 * วิชาแรกในรายการ ซึ่งเป็นห้องของคนอื่น — ของเดิมเก็บ "ห้องแรกที่เจอ" ไว้
 * โดยมีคอมเมนต์ยอมรับไว้เองว่ามันไม่ใช่คำตอบ
 */
export function roomNameForTeacher(
  s: ElectiveSlotLike, teacherId: number | null | undefined,
): string | null {
  const mine = optionForTeacher(s, teacherId);
  if (mine) return mine.room_name ?? null;
  // ไม่ใช่คาบเสรี (หรือครูคนนี้ไม่ได้สอนวิชาใดในนั้น) — ใช้ห้องของแถว
  if (options(s).length > 0) return null;
  return s.room_name ?? null;
}

/**
 * การจองห้องหนึ่งครั้ง
 *
 * `id` คือตัวบอกว่าการจองสองรายการเป็นรายการเดียวกันหรือไม่ คาบปกติใช้เลขแถว
 * ส่วนคาบเสรีใช้ (กลุ่มวิชาเสรี · ตัวเลือก) เพื่อให้สำเนาข้ามแถวยุบเป็นหนึ่ง
 */
export interface RoomBooking {
  roomId: number;
  id:     string;
}

/** ตัวระบุการจองของวิชาหนึ่งในคาบเสรี — คงที่ข้ามแถวที่เป็นสำเนากัน */
export function optionBookingId(
  poolId: number | null | undefined, optionKey: number | null | undefined,
): string {
  return `pool:${poolId ?? "-"}:opt:${optionKey ?? "-"}`;
}

/**
 * ห้องที่ถูกจองไว้แล้วในชั่วโมงนี้ หนึ่งรายการต่อการจองจริงหนึ่งครั้ง
 *
 * ไม่รวมคาบที่ยังไม่มีห้อง และไม่นับสำเนาของคาบเสรีซ้ำ
 */
export function roomBookingsAt(
  slots: readonly ElectiveSlotLike[], day: number, period: number,
): RoomBooking[] {
  const out: RoomBooking[] = [];
  const seen = new Set<string>();
  const push = (roomId: number | null | undefined, id: string): void => {
    if (!roomId || roomId <= 0) return;
    const k = `${roomId}|${id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ roomId, id });
  };
  for (const s of slots) {
    if (s.day !== day || s.period !== period) continue;
    push(s.room_id, `slot:${s.id}`);
    for (const o of options(s)) {
      // ไม่มี key แปลว่าเป็นตัวเลือกที่เพิ่มเองในคาบเดียว ไม่ได้มาจากกลุ่ม —
      // ไม่มีสำเนาที่อื่นให้ยุบ จึงนับด้วยแถวของมันเอง
      const ident = o.key != null
        ? optionBookingId(s.elective_pool_id, o.key)
        : `slotopt:${s.id}:${o.id ?? o.subject_id ?? "-"}`;
      push(o.room_id, ident);
    }
  }
  return out;
}

/** ห้องนี้ถูกกันไว้ให้ครูบางคนไหม และครูคนนี้ใช้ได้ไหม (กฎเดียวกับ utils/levels) */
function reservedOk(r: RoomLike, teacherId: number | null | undefined): boolean {
  const kept = r.reserved_teacher_ids ?? (r.reserved_teacher_id != null
    ? [r.reserved_teacher_id] : []);
  return kept.length === 0 || (teacherId != null && kept.includes(teacherId));
}

export interface FreeRoomsFor {
  /** กลุ่มวิชาเสรีและตัวเลือกที่กำลังจะลงห้อง — ห้องของตัวเองต้องยังเลือกได้ */
  poolId?:    number | null;
  optionKey?: number | null;
  /** คาบปกติ: เลขแถวที่กำลังจะเปลี่ยนห้อง */
  slotId?:    number | null;
  teacherId?: number | null;
}

/**
 * ห้องที่เลือกได้สำหรับชั่วโมงนี้
 *
 * ห้องที่ตัวเองจองไว้อยู่แล้วต้องยังอยู่ในรายการ ไม่งั้นเปิดหน้าต่างมาแล้วห้อง
 * ที่เลือกไว้หายไปจากลิสต์ เหมือนระบบลืมว่าเคยตั้งไว้ แล้วคนก็ไม่กล้าเลือกอะไร
 */
export function freeRoomsAt(
  rooms: readonly RoomLike[], slots: readonly ElectiveSlotLike[],
  day: number, period: number, forWhom: FreeRoomsFor = {},
): RoomLike[] {
  const mine = forWhom.optionKey != null
    ? optionBookingId(forWhom.poolId, forWhom.optionKey)
    : (forWhom.slotId != null ? `slot:${forWhom.slotId}` : null);
  const taken = new Set(
    roomBookingsAt(slots, day, period)
      .filter((b) => b.id !== mine)
      .map((b) => b.roomId));
  return rooms.filter((r) => {
    if (taken.has(r.id)) return false;
    // ห้องพักครูหรือห้องที่ปิดใช้ ไม่ใช่ที่สำหรับยกชั้นเรียนไปลง
    if (r.usable === false || (r.capacity ?? 1) <= 0) return false;
    return reservedOk(r, forWhom.teacherId);
  });
}

/**
 * วิชาเสรีหนึ่งวิชาที่ครูคนหนึ่งสอน — หนึ่งแถวต่อหนึ่งงานสอนจริง
 *
 *   "อยากให้ทำระบบที่เข้าไปที่ครูที่สอนคนนั้นแล้วเลือกห้องให้"
 */
export interface ElectiveDuty {
  poolId:    number | null;
  optionKey: number | null;
  day:       number;
  period:    number;
  label:     string;
  roomId:    number | null;
  roomName:  string | null;
  /** กี่ห้องเรียนส่งนักเรียนมาเรียนวิชานี้ — ใช้บอกขอบเขตบนจอ */
  groupCount: number;
}

/**
 * คาบเสรีที่ครูคนนี้สอน มองจากฝั่งครู
 *
 * วิชาหนึ่งในหน้าต่างที่มีสิบห้องเรียนถูกเขียนไว้สิบแถว แต่ครูสอนครั้งเดียว
 * จึงยุบด้วย (หน้าต่าง · วิชา · วัน · คาบ) ให้เหลือแถวเดียว — ถ้าไม่ยุบ หน้าจอ
 * จะขึ้นงานเดียวกันสิบรายการให้เลือกห้องสิบครั้ง ทั้งที่เป็นห้องเดียวกันห้องเดียว
 */
export function electiveDutiesOf(
  slots: readonly ElectiveSlotLike[], teacherId: number | null | undefined,
): ElectiveDuty[] {
  if (teacherId == null) return [];
  const by = new Map<string, ElectiveDuty & { groups: Set<number> }>();
  for (const s of slots) {
    const mine = optionForTeacher(s, teacherId);
    if (!mine) continue;
    const k = `${s.elective_pool_id ?? "-"}|${mine.key ?? mine.id ?? "-"}|${s.day}|${s.period}`;
    const row = by.get(k) ?? {
      poolId: s.elective_pool_id ?? null,
      optionKey: mine.key ?? null,
      day: s.day, period: s.period,
      label: mine.label ?? mine.code ?? "วิชาเสรี",
      roomId: mine.room_id ?? null,
      roomName: mine.room_name ?? null,
      groupCount: 0,
      groups: new Set<number>(),
    };
    if (s.group_id != null) row.groups.add(s.group_id);
    row.groupCount = row.groups.size;
    by.set(k, row);
  }
  return [...by.values()]
    .map(({ groups: _groups, ...rest }) => rest)
    .sort((a, b) => (a.day - b.day) || (a.period - b.period)
                    || a.label.localeCompare(b.label, "th"));
}

/**
 * ห้องที่ชนกันเองในชุดที่กำลังจะบันทึก
 *
 * หน้าจอให้ตั้งห้องหลายวิชาพร้อมกันก่อนกดบันทึก และทุกวิชาในคาบเสรีเดียวกัน
 * เรียนพร้อมกัน จึงใช้ห้องเดียวกันไม่ได้ — ต้องจับได้ก่อนส่ง เพราะถ้าส่งไป
 * ทีละรายการ รายการแรกจะผ่าน แล้วรายการหลังจะถูกปฏิเสธโดยที่คนกดไม่รู้ว่า
 * ครึ่งแรกบันทึกไปแล้ว
 */
export function pickClashes(
  picks: readonly { optionKey: number; roomId: number | null }[],
): number[] {
  const byRoom = new Map<number, Set<number>>();
  for (const p of picks) {
    if (!p.roomId) continue;
    const who = byRoom.get(p.roomId) ?? new Set<number>();
    who.add(p.optionKey);
    byRoom.set(p.roomId, who);
  }
  return [...byRoom.entries()]
    .filter(([, who]) => who.size > 1)
    .map(([roomId]) => roomId)
    .sort((a, b) => a - b);
}
