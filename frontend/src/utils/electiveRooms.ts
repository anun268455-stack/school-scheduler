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
  // ใช้บอกคนว่าห้องที่ไม่ว่างติดอะไรอยู่
  group_name?:       string | null;
  subject_name?:     string | null;
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
  /** ใช้ค้นหาและบอกว่าห้องอยู่อาคารไหน */
  building_name?: string | null;
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
 * ส่วนคาบเสรีใช้ (วิชา · ครู) — ดู optionBookingId
 */
export interface RoomBooking {
  roomId: number;
  id:     string;
  /** ใช้บอกคนว่าห้องนี้ติดอะไรอยู่ */
  label:  string;
}

/**
 * ตัวระบุงานสอนหนึ่งงานในคาบเสรี — คงที่ข้ามแถวที่เป็นสำเนากัน
 *
 * ── ทำไมเป็น (วิชา · ครู) ไม่ใช่เลขตัวเลือก ──
 *
 * คาบเสรีในระบบนี้มีสองรูปแบบ และของโรงเรียนเป็นแบบที่สอง:
 *
 *   ๑ สร้างจาก "กลุ่มวิชาเสรี" — ตัวเลือกมี `key` ที่เท่ากันทุกห้องเรียน
 *   ๒ สร้างทีละคาบ แล้วคัดลอกไปห้องอื่น (หรือมาจากการนำเข้า) — ตัวเลือก
 *     **ไม่มี `key`** และทุกสำเนาได้ `id` ใหม่คนละเลข
 *
 * แบบที่สองจึงไม่มีอะไรผูกสำเนาเข้าด้วยกันเลย นอกจาก "วิชาอะไร ครูคนไหน"
 * ซึ่งเป็นกฎเดียวกับที่เซิร์ฟเวอร์ใช้อยู่แล้วตอนนับชั่วโมงของครู
 * (`_elective_option_pairs` → `_same_activity`) — ครูคนหนึ่งสอนวิชาหนึ่งใน
 * ชั่วโมงหนึ่ง คือการสอนครั้งเดียว ไม่ว่านักเรียนจะมาจากกี่ห้องเรียน
 *
 * ตอนแรกไฟล์นี้ใช้ (กลุ่ม · key) ซึ่งใช้ได้เฉพาะแบบที่หนึ่ง ผลคือของโรงเรียน
 * ขึ้นว่า "คาบเสรี 18 คาบ" ทั้งที่มีจริง 5 — และกดเลือกห้องแถวเดียวกางทั้ง 18
 */
export function optionBookingId(
  subjectId: number | null | undefined, teacherId: number | null | undefined,
): string {
  return `elec:${subjectId ?? "-"}:${teacherId ?? "-"}`;
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
  const push = (roomId: number | null | undefined, id: string, label: string): void => {
    if (!roomId || roomId <= 0) return;
    const k = `${roomId}|${id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ roomId, id, label });
  };
  for (const s of slots) {
    if (s.day !== day || s.period !== period) continue;
    push(s.room_id, `slot:${s.id}`,
         [s.group_name, s.subject_name].filter(Boolean).join(" ") || "คาบอื่น");
    for (const o of options(s)) {
      push(o.room_id, optionBookingId(o.subject_id, o.teacher_id),
           ["วิชาเสรี", o.label ?? o.code, o.teacher_name ? `· ครู${o.teacher_name}` : ""]
             .filter(Boolean).join(" "));
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
  /** งานสอนที่กำลังจะลงห้อง — ห้องของตัวเองต้องยังเลือกได้ */
  subjectId?: number | null;
  teacherId?: number | null;
  /** คาบปกติ: เลขแถวที่กำลังจะเปลี่ยนห้อง */
  slotId?:    number | null;
}

/** ห้องหนึ่งห้อง พร้อมคำตอบว่าชั่วโมงนี้ว่างไหม */
export interface RoomChoice {
  room:   RoomLike;
  free:   boolean;
  /** ติดอะไรอยู่ — ว่างเมื่อ free */
  usedBy: string;
  /** ห้องที่งานสอนนี้ถือไว้อยู่แล้ว */
  mine:   boolean;
}

/**
 * ห้องทั้งหมดที่ยกชั้นเรียนไปลงได้ พร้อมสถานะว่าง/ไม่ว่าง
 *
 *   "ไม่สามารถเลือกห้องได้ เพราะห้องไม่ขึ้น ช่วยทำให้ห้องขึ้นให้หน่อย
 *    โดยดูว่าห้องว่างไหม"
 *
 * ของเดิมคืนเฉพาะห้องที่ว่าง ซึ่งฟังดูสมเหตุสมผลจนกระทั่งเอาไปใช้จริง: ในคาบที่
 * ทั้งโรงเรียนเรียนพร้อมกัน ห้องเรียนเกือบทุกห้องมีคนใช้ รายการจึงเหลือแต่ลาน
 * กลางแจ้ง ๒๑ แห่ง — แล้วครูที่เดินมาขอ "ห้องดนตรีไทย" ก็ไม่เห็นห้องนั้นในจอ
 * และไม่มีอะไรบอกว่าทำไม เหมือนระบบไม่รู้จักห้องนั้น
 *
 * บอกว่าไม่ว่างและติดอะไรอยู่ มีค่ากว่าการซ่อน เพราะมันเปลี่ยนคำถามจาก "ห้อง
 * หายไปไหน" เป็น "จะย้ายอะไรออกดี" ซึ่งเป็นคำถามที่ตอบได้
 *
 * ห้องที่ใช้ไม่ได้จริง ๆ (ห้องพักครู ห้องปิด ห้องที่กันไว้ให้ครูคนอื่น) ยังถูก
 * ตัดออก เพราะไม่ใช่ทางเลือกไม่ว่าชั่วโมงไหน
 */
export function roomChoicesAt(
  rooms: readonly RoomLike[], slots: readonly ElectiveSlotLike[],
  day: number, period: number, forWhom: FreeRoomsFor = {},
): RoomChoice[] {
  const mineId = forWhom.subjectId != null || forWhom.teacherId != null
    ? optionBookingId(forWhom.subjectId, forWhom.teacherId)
    : (forWhom.slotId != null ? `slot:${forWhom.slotId}` : null);
  const taken = new Map<number, string>();
  const held = new Set<number>();
  for (const b of roomBookingsAt(slots, day, period)) {
    if (b.id === mineId) { held.add(b.roomId); continue; }
    if (!taken.has(b.roomId)) taken.set(b.roomId, b.label);
  }
  return rooms
    .filter((r) => {
      // ห้องพักครูหรือห้องที่ปิดใช้ ไม่ใช่ที่สำหรับยกชั้นเรียนไปลง
      if (r.usable === false || (r.capacity ?? 1) <= 0) return false;
      return reservedOk(r, forWhom.teacherId);
    })
    .map((r) => ({
      room: r,
      free: !taken.has(r.id),
      usedBy: taken.get(r.id) ?? "",
      mine: held.has(r.id),
    }))
    // ว่างขึ้นก่อน แล้วค่อยเรียงตามชื่อ — ห้องที่เลือกได้ควรอยู่ในสายตาก่อน
    // แต่ห้องที่ไม่ว่างยังอยู่ในรายการให้เห็นว่ามีอยู่และติดอะไร
    .sort((a, b) => Number(b.free) - Number(a.free)
                    || a.room.name.localeCompare(b.room.name, "th", { numeric: true }));
}

/**
 * ห้องที่ว่างจริงเท่านั้น
 *
 * เหลือไว้สำหรับที่ที่ต้องการ "เลือกได้เลย" ล้วน ๆ — ส่วนหน้าจอเลือกห้องใช้
 * roomChoicesAt เพราะการซ่อนห้องที่ไม่ว่างทำให้คนหาห้องที่ต้องการไม่เจอ
 */
export function freeRoomsAt(
  rooms: readonly RoomLike[], slots: readonly ElectiveSlotLike[],
  day: number, period: number, forWhom: FreeRoomsFor = {},
): RoomLike[] {
  return roomChoicesAt(rooms, slots, day, period, forWhom)
    .filter((c) => c.free || c.mine)
    .map((c) => c.room);
}

/**
 * วิชาเสรีหนึ่งวิชาที่ครูคนหนึ่งสอน — หนึ่งแถวต่อหนึ่งงานสอนจริง
 *
 *   "อยากให้ทำระบบที่เข้าไปที่ครูที่สอนคนนั้นแล้วเลือกห้องให้"
 */
export interface ElectiveDuty {
  /** ตัวระบุงานสอน ใช้เป็นคีย์บนจอและส่งให้เซิร์ฟเวอร์ตอนตั้งห้อง */
  subjectId: number | null;
  teacherId: number;
  day:       number;
  period:    number;
  label:     string;
  roomId:    number | null;
  roomName:  string | null;
  /** กี่ห้องเรียนส่งนักเรียนมาเรียนวิชานี้ — ใช้บอกขอบเขตบนจอ */
  groupCount: number;
}

/** คีย์ที่ใช้แยกแถวบนจอ — ต่างกันจริงทุกงานสอน ไม่ซ้ำกันเอง */
export function dutyKey(d: ElectiveDuty): string {
  return `${d.day}|${d.period}|${optionBookingId(d.subjectId, d.teacherId)}`;
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
    const k = `${s.day}|${s.period}|${optionBookingId(mine.subject_id, teacherId)}`;
    const row = by.get(k) ?? {
      subjectId: mine.subject_id ?? null,
      teacherId,
      day: s.day, period: s.period,
      label: mine.label ?? mine.code ?? "วิชาเสรี",
      roomId: mine.room_id ?? null,
      roomName: mine.room_name ?? null,
      groupCount: 0,
      groups: new Set<number>(),
    };
    // ห้องที่ตั้งไว้แล้วชนะค่าว่าง — สำเนาบางแถวอาจยังไม่ได้รับห้อง (เช่นเพิ่ง
    // คัดลอกไปห้องเรียนใหม่) จอต้องขึ้นห้องที่ตั้งไว้ ไม่ใช่ "ยังไม่มีห้อง"
    if (row.roomId == null && mine.room_id != null) {
      row.roomId = mine.room_id;
      row.roomName = mine.room_name ?? null;
    }
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
