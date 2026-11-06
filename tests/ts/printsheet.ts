/**
 * ทดสอบ utils/printSheet — แบบฟอร์มใบพิมพ์ที่โรงเรียนแก้เองได้
 *
 *   "ช่วยมีระบบที่ก่อนจะปริ้นสามารถกำหนดได้ว่าจะปริ้นอะไรในหน้าอะไรได้ ... ถ้าให้
 *    คุณช่วยตั้งแล้วมาแก้ไขต้องให้คุณช่วยเขียนโค้ดทุกรอบ ... พอมีอะไรแก้ไขจะได้
 *    แก้ไขได้เลยไม่ต้องมานั่งเขียนโค้ดใหม่"
 *
 * ข้อที่สำคัญที่สุดของไฟล์นี้คือข้อที่ดูน่าเบื่อที่สุด: ถ้าโรงเรียนยังไม่ได้ตั้ง
 * อะไรเลย ใบพิมพ์ต้องออกมาเหมือนเดิมเป๊ะ ๆ รวมถึงข้อความใต้เส้นลงชื่อสองช่องที่
 * เคยเขียนตรึงไว้ในโค้ด — ของที่พิมพ์ส่งเขตไปแล้วทั้งเทอมต้องไม่เปลี่ยนรูปเพราะ
 * เราเพิ่มความสามารถให้มัน
 */
import {
  allSigners, DEFAULT_SIGNER_ROLES, DEFAULT_WORKLOAD_SIGNER_ROLES, fillTemplate, pageLabel,
  sheetHeading, sheetVars, sheetSigners, signsOn, thaiDate, normalizeSheet, type SheetSetup,
} from "../../frontend/src/utils/printSheet.ts";

let n = 0;
const ok = (cond: boolean, what: string): void => {
  n++;
  if (!cond) { console.error("FAIL:", what); process.exit(1); }
};
const eq = (a: unknown, b: unknown, what: string): void =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${what} — ได้ ${JSON.stringify(a)}`);

// ── ยังไม่ได้ตั้งอะไร = ต้องเหมือนเดิมเป๊ะ ──────────────────────────────────
const cfg = { directorName: "สมชาย ใจดี", deputyName: "สมหญิง เก่งมาก" };
const asBefore = sheetSigners(normalizeSheet(undefined), cfg);
eq(asBefore.length, 2, "สองช่องเหมือนเดิม");
eq(asBefore[0], { name: "สมหญิง เก่งมาก", role: DEFAULT_SIGNER_ROLES[0] }, "ช่องซ้าย: รอง ผอ.");
eq(asBefore[1], { name: "สมชาย ใจดี", role: DEFAULT_SIGNER_ROLES[1] }, "ช่องขวา: ผอ.");
eq(DEFAULT_SIGNER_ROLES,
   ["รองผู้อำนวยการกลุ่มบริหารวิชาการ", "ผู้อำนวยการโรงเรียน"],
   "ข้อความเดิมที่เคยเขียนตรึงไว้ ต้องเป็นค่าตั้งต้น");

// ไม่มีชื่อผู้บริหารเลย ก็ยังต้องได้เส้นให้เซ็นสองช่อง
const noNames = sheetSigners(normalizeSheet(undefined), {});
eq(noNames.map((s) => s.name), ["", ""], "ไม่มีชื่อ = เส้นเปล่า ไม่ใช่หายไป");
eq(noNames.map((s) => s.role), DEFAULT_SIGNER_ROLES, "ตำแหน่งยังขึ้น");

// ── เพิ่มหรือลดผู้เซ็นได้ — ข้อที่โรงเรียนเลือกว่าสำคัญที่สุด ───────────────
const three: SheetSetup = normalizeSheet({
  signers: [
    { name: "ก", role: "หัวหน้ากลุ่มสาระ" },
    { name: "ข", role: "รองผู้อำนวยการ" },
    { name: "ค", role: "ผู้อำนวยการโรงเรียน" },
  ],
});
eq(sheetSigners(three, cfg).length, 3, "สามคนได้");
eq(sheetSigners(three, cfg)[0].role, "หัวหน้ากลุ่มสาระ", "ตำแหน่งตามที่พิมพ์เอง");
// ตั้งไว้แล้ว ต้องไม่ถูกชื่อใน settings ทับ
eq(sheetSigners(three, cfg)[2].name, "ค", "ชื่อที่พิมพ์เองชนะชื่อใน settings");

const one = normalizeSheet({ signers: [{ name: "เดี่ยว", role: "ผู้อำนวยการ" }] });
eq(sheetSigners(one, cfg).length, 1, "คนเดียวได้");

// ศูนย์คนก็ได้ — บางใบไม่ต้องมีใครเซ็น
const none = normalizeSheet({ signers: [] });
eq(sheetSigners(none, cfg), [], "ไม่มีใครเซ็นเลยก็ได้ ไม่ใช่เด้งกลับเป็นสองช่อง");
// แยกให้ออกจาก "ยังไม่ได้ตั้ง" ซึ่งต้องได้สองช่องเดิม
eq(sheetSigners(normalizeSheet({}), cfg).length, 2, "ไม่ได้ตั้ง ≠ ตั้งว่าไม่มี");

// ── ข้อมูลเสียจากเซิร์ฟเวอร์ต้องไม่ทำใบพิมพ์พัง ─────────────────────────────
// ค่านี้เก็บอยู่กับค่าตั้งโรงเรียนซึ่งเป็นก้อน JSON อิสระ ของที่อ่านมาจึงเป็น
// อะไรก็ได้ — ใบพิมพ์ 47 หน้าต้องไม่ล้มเพราะคนเผลอแก้ค่าในฐานข้อมูล
eq(sheetSigners(normalizeSheet({ signers: "เอ๊ะ" as unknown }), cfg).length, 2,
   "ค่าที่ไม่ใช่รายการ = ถือว่ายังไม่ได้ตั้ง");
const junk = normalizeSheet({
  signers: [{ name: 5 as unknown, role: null as unknown }, null as unknown, { role: "ผอ." }],
});
eq(sheetSigners(junk, cfg), [{ name: "", role: "" }, { name: "", role: "ผอ." }],
   "แถวเสียถูกทิ้ง ที่เหลือแปลงเป็นข้อความ");
ok(normalizeSheet({ signers: new Array(20).fill({ name: "ก", role: "ข" }) }).signers!.length <= 6,
   "มีเพดานจำนวนผู้เซ็น ไม่งั้นใบพิมพ์เสียรูป");

// ── ใบคนละชนิด คนเซ็นคนละชุด ────────────────────────────────────────────────
//
//   "อัตรากำลังอยากได้ลายเซ็นแค่รอง ผอ. ส่วนตารางเรียนต้องการลายเซ็นสองคน
//    ไม่อยากให้เปลี่ยนไปเปลี่ยนมา"

// ยังไม่ได้ตั้ง = ของเดิมของใบชนิดนั้น ซึ่งไม่เหมือนกันสองใบ
eq(sheetSigners(normalizeSheet(undefined), cfg, "timetable").map((s) => s.role),
   [...DEFAULT_SIGNER_ROLES], "ใบตาราง: ของเดิม");
eq(sheetSigners(normalizeSheet(undefined), cfg, "workload").map((s) => s.role),
   [...DEFAULT_WORKLOAD_SIGNER_ROLES],
   "ใบอัตรากำลัง: ของเดิมคนละชุด (เคยเขียนตรึงไว้คนละไฟล์)");
eq(sheetSigners(normalizeSheet(undefined), cfg).map((s) => s.role),
   [...DEFAULT_SIGNER_ROLES], "ไม่ระบุชนิด = ใบตาราง");

// ตั้งแล้วเลือกได้ว่าใครขึ้นใบไหน
const split: SheetSetup = normalizeSheet({
  signers: [
    { name: "ก", role: "หัวหน้างานตารางสอน", on: ["timetable"] },
    { name: "ข", role: "รองผู้อำนวยการ" },                      // ไม่ระบุ = ทุกใบ
    { name: "ค", role: "ผู้อำนวยการโรงเรียน", on: ["timetable"] },
  ],
});
eq(sheetSigners(split, cfg, "timetable").map((s) => s.name), ["ก", "ข", "ค"],
   "ใบตารางได้ครบสามคน");
eq(sheetSigners(split, cfg, "workload").map((s) => s.name), ["ข"],
   "ใบอัตรากำลังได้คนเดียว — ไม่ต้องเข้าไปแก้สลับไปมาอีก");

// "ไม่ระบุ" ต้องแปลว่าทุกใบ ไม่ใช่ไม่ขึ้นเลย — ผู้เซ็นที่ตั้งไว้ก่อนมีช่องนี้
// ย่อมไม่มีค่าในช่องนี้ ถ้าตีความผิด ลายเซ็นที่ตั้งไว้แล้วจะหายทั้งหมดตอนอัปเดต
ok(signsOn({ name: "x", role: "y" }, "timetable"), "ไม่ระบุ = ขึ้นใบตาราง");
ok(signsOn({ name: "x", role: "y" }, "workload"), "ไม่ระบุ = ขึ้นใบอัตรากำลัง");
ok(signsOn({ name: "x", role: "y", on: [] }, "workload"), "รายการเปล่า = ทุกใบ");
ok(!signsOn({ name: "x", role: "y", on: ["timetable"] }, "workload"), "ระบุแล้วก็ตามนั้น");

// ค่าที่อ่านไม่ออกในช่องนี้ ถูกทิ้งเฉพาะค่านั้น ไม่ทำให้ทั้งแถวหาย
const junkOn = normalizeSheet({
  signers: [{ name: "ง", role: "ผอ.", on: ["timetable", "เอ๊ะ", 5, "timetable"] }],
});
eq(junkOn.signers![0].on, ["timetable"], "เก็บเฉพาะชื่อใบที่รู้จัก และไม่ซ้ำ");
eq(junkOn.signers![0].name, "ง", "แถวยังอยู่");
eq(normalizeSheet({ signers: [{ name: "จ", role: "ผอ.", on: "timetable" }] })
     .signers![0].on, undefined, "ค่าที่ไม่ใช่รายการ = ไม่ระบุ = ทุกใบ");
eq(normalizeSheet({ signers: [{ name: "ฉ", role: "ผอ.", on: ["เอ๊ะ"] }] })
     .signers![0].on, undefined, "ไม่เหลือชื่อใบที่รู้จักเลย = ทุกใบ ไม่ใช่ไม่ขึ้น");

// หน้าตั้งค่าต้องเห็น "ทุกคน" ไม่ใช่เฉพาะคนที่ขึ้นใบใดใบหนึ่ง
//
// หน้านั้นบันทึกทั้งรายการกลับลงไป ถ้าดึงรายชื่อมาด้วยตัวกรองของใบตาราง
// ผู้เซ็นที่ตั้งไว้เฉพาะใบอัตรากำลังจะหายจากจอ แล้วถูกบันทึกทับหายไปจริง ๆ
// ทันทีที่แก้อะไรก็ตามในหน้านั้น
eq(allSigners(split, cfg).map((s) => s.name), ["ก", "ข", "ค"],
   "หน้าตั้งค่าเห็นครบทุกคน แม้คนที่ไม่ได้ขึ้นใบตาราง");
eq(allSigners(normalizeSheet({ signers: [{ name: "ซ", role: "รอง", on: ["workload"] }] }), cfg)
     .map((s) => s.name), ["ซ"],
   "คนที่ตั้งไว้เฉพาะใบอัตรากำลัง ต้องไม่หายจากหน้าตั้งค่า");
eq(allSigners(normalizeSheet(undefined), cfg).map((s) => s.role),
   [...DEFAULT_SIGNER_ROLES], "ยังไม่ได้ตั้ง = ตั้งต้นด้วยสองช่องของใบตาราง");
eq(allSigners(normalizeSheet({ signers: [] }), cfg), [],
   "ตั้งว่าไม่มีใครเซ็น ก็ต้องเห็นว่าไม่มี ไม่ใช่เด้งกลับเป็นสองช่อง");

// ลบทุกคนออกจากใบหนึ่ง แต่ยังอยู่บนอีกใบ
const onlyWork = normalizeSheet({
  signers: [{ name: "ช", role: "รอง ผอ.", on: ["workload"] }],
});
eq(sheetSigners(onlyWork, cfg, "timetable"), [], "ใบตารางไม่มีใครเซ็นได้");
eq(sheetSigners(onlyWork, cfg, "workload").length, 1, "แต่ใบอัตรากำลังยังมี");

// ── ข้อความของโรงเรียนเอง พร้อมตัวแทนค่า ────────────────────────────────────
const vars = { ห้อง: "ม.1/1", ครู: "กุลจิรา", ภาคเรียน: "1", ปีการศึกษา: "2568", โรงเรียน: "สตรีวิทยา" };
eq(fillTemplate("ตารางเรียน ห้อง {ห้อง}", vars), "ตารางเรียน ห้อง ม.1/1", "แทนค่าได้");
eq(fillTemplate("{โรงเรียน} ภาคเรียนที่ {ภาคเรียน}/{ปีการศึกษา}", vars),
   "สตรีวิทยา ภาคเรียนที่ 1/2568", "แทนหลายค่าในบรรทัดเดียว");
eq(fillTemplate("{ไม่รู้จัก} ต่อ", vars), "ต่อ",
   "ตัวแทนค่าที่ไม่รู้จักถูกตัดออก ไม่ใช่พิมพ์ปีกกาติดไปบนกระดาษ");
eq(fillTemplate("", vars), "", "ว่างก็ว่าง");
eq(fillTemplate("ไม่มีปีกกา", vars), "ไม่มีปีกกา", "ข้อความธรรมดาผ่านตรง ๆ");
// ช่องว่างที่เหลือจากการตัดต้องไม่กลายเป็นช่องว่างซ้อนกลางประโยค
eq(fillTemplate("ก {ไม่รู้จัก} ข", vars), "ก ข", "ไม่เหลือช่องว่างซ้อน");

// ── เลขหน้า ─────────────────────────────────────────────────────────────────
eq(pageLabel(0, 5), "หน้า 1/5", "นับจากหนึ่ง ไม่ใช่ศูนย์");
eq(pageLabel(4, 5), "หน้า 5/5", "หน้าสุดท้าย");
eq(pageLabel(0, 1), "หน้า 1/1", "ใบเดียว");

// ── วันที่ไทย ───────────────────────────────────────────────────────────────
// พ.ศ. ไม่ใช่ ค.ศ. — ใบที่ส่งเขตใช้ พ.ศ.
eq(thaiDate(new Date(2026, 10, 3)), "3 พฤศจิกายน 2569", "วันที่เป็นพุทธศักราช");
eq(thaiDate(new Date(2026, 0, 1)), "1 มกราคม 2569", "ต้นปี");

// ── ชื่อเทอมบนใบพิมพ์ (Task 9) ─────────────────────────────────────────────
// แบบฟอร์มที่บันทึกไว้ก่อนมีช่องเทอม ต้องยังใช้ได้
eq(normalizeSheet({}).term, undefined, "แบบฟอร์มเก่าไม่มีเทอม");
eq("term" in normalizeSheet({}), false, "ไม่มีคีย์ term โผล่มาเลย (ใบเดิมเหมือนเดิมทุกตัวอักษร)");
eq(normalizeSheet(undefined).term, undefined, "ไม่มีแบบฟอร์มเลย");
eq(normalizeSheet({ term: "1/2569" }).term, "1/2569", "เก็บชื่อเทอมไว้");
eq(normalizeSheet({ term: "  " }).term, undefined, "ว่างเปล่า = ไม่มี");
eq(normalizeSheet({ term: 5 as unknown }).term, undefined, "ชนิดผิด = ไม่มี");
eq(fillTemplate("ตารางเรียน ภาคเรียนที่ {เทอม}", { term: "1/2569" }),
   "ตารางเรียน ภาคเรียนที่ 1/2569", "แทน {เทอม} ด้วยชื่อเทอม");
eq(fillTemplate("ตารางเรียน {เทอม}", {}).includes("undefined"), false, "ไม่มีชื่อเทอมต้องไม่พิมพ์ undefined");
eq(fillTemplate("ตารางเรียน {เทอม} จบ", {}), "ตารางเรียน จบ", "ไม่มีชื่อเทอม = ตัดออก ไม่เหลือช่องว่างซ้อน");
eq(fillTemplate("{ เทอม }", { term: "2/2568" }), "2/2568", "ช่องว่างในปีกกาไม่เป็นไร");
eq(fillTemplate("{เทอม}", { เทอม: "ก", term: "ข" }), "ก", "คีย์ไทยโดยตรงชนะ");
eq(fillTemplate("{เทอม}", { term: undefined as unknown as string }), "", "ค่า undefined ไม่หลุดออกกระดาษ");

// ชื่อเทอมมาจากเทอมที่กำลังดูอยู่ ไม่ใช่เทอมที่ใช้งานอยู่ (ข้อทดสอบ 17)
{
  const cfgNow = { term: "1", year: "2569", schoolName: "สตรีวิทยา" };   // ค่าตั้งของเทอมที่ใช้อยู่
  const archive = sheetHeading("2/2568", cfgNow);
  eq(archive, "ภาคเรียนที่ 2/2568  โรงเรียนสตรีวิทยา", "ใบของเทอมเก่าขึ้นชื่อเทอมเก่า");
  eq(archive.includes("2569"), false, "ไม่มีชื่อเทอมปัจจุบันปนมา");
  eq(sheetHeading(undefined, cfgNow), "ภาคเรียนที่ 1/2569  โรงเรียนสตรีวิทยา",
     "ยังไม่มีระบบเทอม = ใบเดิมทุกตัวอักษร");
  eq(sheetHeading("", cfgNow), "ภาคเรียนที่ 1/2569  โรงเรียนสตรีวิทยา", "ชื่อว่าง = ใช้ของเดิม");
  eq(sheetHeading(undefined, {}).includes("undefined"), false, "ไม่มีอะไรเลยก็ไม่พิมพ์ undefined");
}
eq(sheetVars({ term: "1/2569" }), { term: "1/2569" }, "ส่งต่อให้ fillTemplate");
eq(sheetVars({}), {}, "ไม่มีเทอม = ไม่มีตัวแทนค่า");
eq(fillTemplate("เทอม {เทอม}", sheetVars(normalizeSheet({ note: "x" }))), "เทอม",
   "แบบฟอร์มเก่าผ่านทั้งทางจนถึงกระดาษโดยไม่มี undefined");

console.log(`ALL PASS (${n})`);
