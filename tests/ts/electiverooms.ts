/**
 * ทดสอบ utils/electiveRooms — ห้องสอนของแต่ละวิชาในคาบเสรี
 *
 *   "คาบเสรี ครูมาบอกว่าต้องการห้องสอนที่นี้ ... โดยจะขึ้นที่ตารางครูและ
 *    ตารางห้อง (ที่ทำแบบนี้เพื่อให้ตารางการใช้ห้องขึ้นคาบเสรีอันนี้)"
 *
 * กฎที่ยากที่สุดและเป็นเหตุให้ต้องมีไฟล์นี้: คาบเสรีหนึ่งหน้าต่างถูกเขียนเป็น
 * หลายแถว แถวละห้องเรียน แต่ละแถวถือสำเนาของตัวเลือกชุดเดียวกัน วิชาหนึ่งใน
 * คาบเสรีจึงปรากฏสิบครั้งในข้อมูล ทั้งที่เป็นการใช้ห้องครั้งเดียวในโลกจริง
 * ถ้านับตรง ๆ มันจะฟ้องว่าห้องชนกับตัวเอง แล้วจะไม่มีห้องไหนเลือกได้
 */
import {
  electiveDutiesOf, freeRoomsAt, optionForTeacher, optionsInRoom, pickClashes,
  roomBookingsAt, roomNameForTeacher, slotRoomIds, slotUsesRoom,
  type ElectiveSlotLike,
} from "../../frontend/src/utils/electiveRooms.ts";

let n = 0;
const ok = (cond: boolean, what: string): void => {
  n++;
  if (!cond) { console.error("FAIL:", what); process.exit(1); }
};
const eq = (a: unknown, b: unknown, what: string): void =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${what} — ได้ ${JSON.stringify(a)}`);

/** คาบปกติ */
const plain = (id: number, day: number, period: number, roomId: number | null): ElectiveSlotLike => ({
  id, day, period, room_id: roomId, room_name: roomId ? `ห้อง ${roomId}` : null,
  teacher_id: 900 + id, is_elective: false, elective_pool_id: null, elective_options: [],
});

/**
 * หนึ่งแถวของคาบเสรี — ห้องเรียนหนึ่งห้อง ถือสำเนาตัวเลือกทั้งชุด
 *
 * ตัวเลือกชุดเดียวกันถูกคัดลอกไปทุกแถว `key` เท่ากันข้ามแถว ส่วน `id` ไม่เท่า
 * (เซิร์ฟเวอร์แจกใหม่ทีละแถว) — `key` จึงเป็นตัวบอกว่า "วิชาเดียวกัน"
 */
const pooled = (
  id: number, day: number, period: number, poolId: number,
  opts: { key: number; teacher_id: number | null; room_id: number | null; label: string }[],
): ElectiveSlotLike => ({
  id, day, period, room_id: null, room_name: null, teacher_id: null,
  is_elective: true, elective_pool_id: poolId,
  elective_options: opts.map((o, i) => ({
    id: id * 100 + i, key: o.key, subject_id: o.key, teacher_id: o.teacher_id,
    label: o.label, room_id: o.room_id,
    room_name: o.room_id ? `ห้อง ${o.room_id}` : null,
  })),
});

// คาบเสรีวันจันทร์คาบ 7 ของสามห้องเรียน สามวิชาให้เลือก
const OPTS = [
  { key: 11, teacher_id: 1, room_id: 501, label: "กรีฑา" },
  { key: 12, teacher_id: 2, room_id: 502, label: "ดนตรี" },
  { key: 13, teacher_id: 3, room_id: null, label: "ศิลปะ" },   // ยังไม่ได้ห้อง
];
const window7 = [pooled(1, 0, 7, 9, OPTS), pooled(2, 0, 7, 9, OPTS), pooled(3, 0, 7, 9, OPTS)];

// ── ห้องที่คาบหนึ่งใช้ ──────────────────────────────────────────────────────
eq(slotRoomIds(plain(7, 0, 7, 301)), [301], "คาบปกติใช้ห้องของตัวเอง");
eq(slotRoomIds(plain(7, 0, 7, null)), [], "คาบปกติที่ยังไม่มีห้อง");
eq(slotRoomIds(window7[0]), [501, 502], "คาบเสรีใช้ห้องของทุกวิชาที่ลงห้องแล้ว");

ok(slotUsesRoom(window7[0], 501), "คาบเสรีนับว่าใช้ห้องของวิชาในนั้น");
ok(slotUsesRoom(window7[0], 502), "ทุกวิชา ไม่ใช่แค่วิชาแรก");
ok(!slotUsesRoom(window7[0], 503), "ห้องที่ไม่มีใครใช้");
// นี่คือข้อที่ทำให้ตารางห้องเห็นคาบเสรี — ของเดิมเทียบ s.room_id ตรง ๆ ซึ่ง
// ของคาบเสรีเป็นค่าว่างเสมอ จึงไม่มีคาบเสรีขึ้นในตารางห้องเลย
ok(!slotUsesRoom(window7[0], 0), "ศูนย์ไม่ใช่ห้อง");

// ── ตารางห้อง: ช่องนั้นแสดงวิชาอะไร ─────────────────────────────────────────
eq(optionsInRoom(window7[0], 501).map((o) => o.label), ["กรีฑา"],
   "ห้อง 501 เห็นแค่วิชาที่อยู่ในห้องนั้น ไม่ใช่ทั้งคาบเสรี");
eq(optionsInRoom(window7[0], 502).map((o) => o.label), ["ดนตรี"], "ห้อง 502");
eq(optionsInRoom(window7[0], 999).map((o) => o.label), [], "ห้องที่ไม่เกี่ยว");

// ── ตารางครู: ครูเห็นวิชาและห้องของตัวเอง ───────────────────────────────────
eq(optionForTeacher(window7[0], 2)?.label, "ดนตรี", "ครูเห็นวิชาของตัวเอง");
eq(optionForTeacher(window7[0], 99), null, "ครูที่ไม่ได้สอนในคาบนี้");
eq(roomNameForTeacher(window7[0], 1), "ห้อง 501", "ชื่อห้องของครูคนนั้น");
eq(roomNameForTeacher(window7[0], 3), null, "วิชาที่ยังไม่ได้ห้อง");
// ครูที่ไม่เกี่ยวข้องกับคาบเสรีนี้ ต้องไม่ได้ห้องของคนอื่นไปโดยบังเอิญ
eq(roomNameForTeacher(window7[0], 99), null, "ไม่ใช่ครูในคาบนี้ = ไม่มีห้อง");
eq(roomNameForTeacher(plain(7, 0, 7, 301), 907), "ห้อง 301", "คาบปกติใช้ชื่อห้องของแถว");

// ── การจองห้องในหนึ่งชั่วโมง — หัวใจของเรื่อง ───────────────────────────────
//
// สามแถวของคาบเสรีถือวิชาเดียวกันทั้งสามแถว ถ้านับตรง ๆ จะได้การจองเก้าครั้ง
// ทั้งที่ของจริงมีสามวิชาใช้ห้องสองห้อง
const bookings = roomBookingsAt([...window7, plain(50, 0, 7, 301)], 0, 7);
eq(bookings.length, 3, "สามการจอง: ห้อง 501 · 502 · 301 (ไม่นับซ้ำข้ามแถว)");
eq([...bookings.map((b) => b.roomId)].sort((a, b) => a - b), [301, 501, 502],
   "ห้องที่ถูกจองในชั่วโมงนั้น");
// ตัวระบุของวิชาในคาบเสรีต้องเหมือนกันทุกแถว ไม่งั้นมันจะชนกับตัวเอง
const b501 = bookings.filter((b) => b.roomId === 501);
eq(b501.length, 1, "วิชาเดียวในคาบเสรีคือการจองครั้งเดียว ไม่ใช่สามครั้ง");

// ชั่วโมงอื่นไม่เกี่ยวกัน
eq(roomBookingsAt(window7, 0, 8).length, 0, "คนละคาบ");
eq(roomBookingsAt(window7, 1, 7).length, 0, "คนละวัน");

// ── ห้องที่เลือกได้ ─────────────────────────────────────────────────────────
const ROOMS = [
  { id: 301, name: "301", usable: true,  capacity: 40 },
  { id: 501, name: "501", usable: true,  capacity: 40 },
  { id: 502, name: "502", usable: true,  capacity: 40 },
  { id: 503, name: "503", usable: true,  capacity: 40 },
  { id: 504, name: "ห้องพักครู", usable: false, capacity: 0 },
  { id: 505, name: "505", usable: true,  capacity: 40, reserved_teacher_ids: [7] },
];
const all = [...window7, plain(50, 0, 7, 301)];

// วิชา "ศิลปะ" (key 13) ยังไม่มีห้อง — เลือกได้เฉพาะห้องที่ว่างจริง
const forArt = freeRoomsAt(ROOMS, all, 0, 7, { poolId: 9, optionKey: 13, teacherId: 3 });
eq(forArt.map((r) => r.id), [503], "เหลือห้องเดียวที่ว่าง (504 ห้ามใช้ · 505 กันไว้ให้ครูอื่น)");

// วิชาที่มีห้องอยู่แล้ว ต้องเห็นห้องของตัวเองในรายการ ไม่งั้นเปิดมาแล้วห้องที่
// เลือกไว้หายจากลิสต์ เหมือนระบบลืมว่าเคยตั้งไว้
const forMusic = freeRoomsAt(ROOMS, all, 0, 7, { poolId: 9, optionKey: 12, teacherId: 2 });
ok(forMusic.some((r) => r.id === 502), "ห้องของตัวเองยังอยู่ในรายการ");
ok(!forMusic.some((r) => r.id === 501), "ห้องของวิชาอื่นในคาบเดียวกันเลือกไม่ได้");
ok(!forMusic.some((r) => r.id === 301), "ห้องที่คาบปกติใช้อยู่ก็เลือกไม่ได้");

// ห้องที่กันไว้ให้ครูคนหนึ่ง ครูคนนั้นเลือกได้
const forMrSeven = freeRoomsAt(ROOMS, all, 0, 7, { poolId: 9, optionKey: 13, teacherId: 7 });
ok(forMrSeven.some((r) => r.id === 505), "ครูที่ห้องกันไว้ให้ เลือกห้องนั้นได้");

// ── ตรวจชุดที่กำลังจะบันทึก ─────────────────────────────────────────────────
//
// หน้าจอให้ตั้งหลายวิชาพร้อมกันก่อนกดบันทึก สองวิชาในคาบเสรีเดียวกันเรียน
// พร้อมกัน จึงใช้ห้องเดียวกันไม่ได้ — ต้องจับได้ก่อนส่ง ไม่ใช่ให้เซิร์ฟเวอร์
// รับไปแล้วค่อยพบว่าห้องชน
eq(pickClashes([{ optionKey: 11, roomId: 601 }, { optionKey: 12, roomId: 602 }]), [],
   "คนละห้อง ผ่าน");
eq(pickClashes([{ optionKey: 11, roomId: 601 }, { optionKey: 12, roomId: 601 }]),
   [601], "ห้องเดียวกันสองวิชา = ชน");
eq(pickClashes([{ optionKey: 11, roomId: null }, { optionKey: 12, roomId: null }]), [],
   "ยังไม่เลือกห้องทั้งคู่ ไม่ใช่การชน");
eq(pickClashes([{ optionKey: 11, roomId: 601 }, { optionKey: 11, roomId: 601 }]), [],
   "วิชาเดียวกันส่งมาสองครั้ง ไม่ใช่การชน");

// ── มองจากฝั่งครู ───────────────────────────────────────────────────────────
//
// วิชาหนึ่งในหน้าต่างที่มีสามห้องเรียนถูกเขียนไว้สามแถว แต่ครูสอนครั้งเดียว
// ถ้าไม่ยุบ หน้าจอจะขึ้นงานเดียวกันสามรายการให้เลือกห้องสามครั้ง
const withGroups = window7.map((s, i) => ({ ...s, group_id: 71 + i }));
const duties = electiveDutiesOf(withGroups, 1);
eq(duties.length, 1, "สามแถว = งานสอนหนึ่งงาน");
eq(duties[0].label, "กรีฑา", "วิชาของครูคนนั้น");
eq(duties[0].roomId, 501, "ห้องที่ตั้งไว้");
eq(duties[0].groupCount, 3, "บอกว่ามีสามห้องเรียนส่งนักเรียนมา");
eq(duties[0].optionKey, 11, "ตัวระบุที่ใช้สั่งเปลี่ยนห้องได้");
eq(duties[0].poolId, 9, "อยู่หน้าต่างไหน");

eq(electiveDutiesOf(withGroups, 3)[0].roomId, null, "วิชาที่ยังไม่มีห้อง");
eq(electiveDutiesOf(withGroups, 99), [], "ครูที่ไม่ได้สอนคาบเสรีเลย");
eq(electiveDutiesOf(withGroups, null), [], "ยังไม่ได้เลือกครู");

// ครูที่สอนสองหน้าต่างคนละวัน ต้องได้สองรายการ เรียงตามวันแล้วคาบ
const monday = pooled(21, 0, 7, 9, [{ key: 11, teacher_id: 1, room_id: 501, label: "กรีฑา" }]);
const tuesday = pooled(22, 1, 2, 10, [{ key: 21, teacher_id: 1, room_id: null, label: "ว่ายน้ำ" }]);
const two = electiveDutiesOf([tuesday, monday], 1);
eq(two.map((d) => d.label), ["กรีฑา", "ว่ายน้ำ"], "เรียงตามวันแล้วคาบ");

console.log(`ALL PASS (${n})`);
