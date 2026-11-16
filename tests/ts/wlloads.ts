/**
 * ไฟล์คำตอบร่วมของยอดคาบรายครู — ข้อทดสอบความตรงกับโปรแกรมจัดตาราง (สเปกขั้นที่ 2 ข้อ 4.4 ข.)
 *
 * tests/fixtures/seed_teacher_loads.json = {"<รหัสครูของโปรแกรมจัดตาราง>": ยอดคาบ} จาก teacherLoads ตัวจริงของ
 * frontend/src/utils/teachingLoad.ts บน school_data.json · ฝั่งไพทอน (tests/py/wlflow.py) เทียบ wl_teacher_loads ของ
 * เซิร์ฟเวอร์กับไฟล์เดียวกันนี้ ไฟล์นี้จึงเป็นสะพาน: ถ้ากฎนับคาบของโปรแกรมจัดตารางหรือข้อมูลตั้งต้นเปลี่ยน ตัวทดสอบนี้ล้มก่อน
 * แทนที่ฝั่งไพทอนจะเทียบกับตัวเลขเก่าเงียบ ๆ
 *
 * สร้างไฟล์คำตอบใหม่ (หลังตรวจแล้วว่าการเปลี่ยนนั้นตั้งใจ):
 *   cd tests && node --import ./register.mjs ts/wlloads.ts --write
 */
import { readFileSync, writeFileSync } from "node:fs";
import { electiveSubjectIds, teacherLoads } from "../../frontend/src/utils/teachingLoad.ts";

let n = 0;
const ok = (cond: boolean, what: string): void => {
  n++;
  if (!cond) { console.error("FAIL:", what); process.exit(1); }
};

const DATA = new URL("../../school_data.json", import.meta.url);
const FIXTURE = new URL("../fixtures/seed_teacher_loads.json", import.meta.url);

// school_data.json มีช่องอีกมากที่เรื่องนี้ไม่ใช้ ชนิดจริงอยู่ฝั่ง frontend จึงแปลงชนิดตรงที่ส่งเข้าเท่านั้น
const data = JSON.parse(readFileSync(DATA, "utf8")) as Record<string, unknown[]>;
const loads = teacherLoads(data.requirements as never, electiveSubjectIds(data.subjects as never, data.elective_pools as never));
const actual: Record<string, number> = {};
for (const [id, total] of [...loads].sort((a, b) => a[0] - b[0])) actual[String(id)] = total;

if (process.argv.includes("--write")) {
  writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + "\n");
  console.log(`เขียน ${Object.keys(actual).length} คนลง ${FIXTURE.pathname}`);
  process.exit(0);
}

const want = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, number>;
ok(Object.keys(want).length >= 100, `ไฟล์คำตอบต้องมีครูอย่างน้อย 100 คน — มี ${Object.keys(want).length}`);
ok(Object.keys(actual).length === Object.keys(want).length,
  `จำนวนครู: teacherLoads ${Object.keys(actual).length} · ไฟล์คำตอบ ${Object.keys(want).length}`);
for (const [id, total] of Object.entries(want)) {
  ok(actual[id] === total, `ครูรหัส ${id}: teacherLoads ได้ ${actual[id]} · ไฟล์คำตอบ ${total}`);
}
for (const id of Object.keys(actual)) ok(id in want, `ครูรหัส ${id} ไม่มีในไฟล์คำตอบ`);
// ทุกค่าเป็นจำนวนเต็มบวก (ฝั่งไพทอนเทียบด้วย == ตรง ๆ)
ok(Object.values(want).every((v) => Number.isInteger(v) && v > 0), "ยอดคาบต้องเป็นจำนวนเต็มบวก");

console.log(`ALL PASS (${n} checks)`);
