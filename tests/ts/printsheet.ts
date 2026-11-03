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
  DEFAULT_SIGNER_ROLES, fillTemplate, pageLabel, sheetSigners, thaiDate,
  normalizeSheet, type SheetSetup,
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

console.log(`ALL PASS (${n})`);
