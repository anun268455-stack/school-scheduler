/**
 * ทดสอบ workload/src/auth.ts — ตรรกะล้วนของการล็อกอินและการแยกบทบาท
 *
 * จุดที่ต้องไม่พลาด: ของที่เก็บใน sessionStorage อาจถูกแก้มือหรือมาจากรุ่นเก่า
 * parseSession จึงต้องไม่ยอมให้ใครกลายเป็น admin บนหน้าจอจากข้อมูลรูปผิด
 */
import {
  canManageRegistry, loginError, parseSession, SESSION_KEY, thaiDetail, visibleDepartments,
  type Session,
} from "../../workload/src/auth.ts";

const fails: string[] = [];
const test = (name: string, fn: () => void): void => {
  try { fn(); } catch (e) { fails.push(`${name} — ${(e as Error).message}`); }
};
const eq = (a: unknown, b: unknown): void => {
  if (a !== b) throw new Error(`ได้ ${JSON.stringify(a)} ควรเป็น ${JSON.stringify(b)}`);
};
const deepEq = (a: unknown, b: unknown): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`ได้ ${JSON.stringify(a)} ควรเป็น ${JSON.stringify(b)}`);
  }
};
const hasThai = (s: string): boolean => /[฀-๿]/.test(s);

const ADMIN: Session = { token: "t", role: "admin", departmentId: null, label: "admin" };
const HEAD3: Session = { token: "t", role: "head", departmentId: 3, label: "ภาษาไทย" };

test("admin จัดการทะเบียนได้ หัวหน้ากลุ่มสาระไม่ได้", () => {
  eq(canManageRegistry({ token: "t", role: "admin", departmentId: null, label: "admin" }), true);
  eq(canManageRegistry({ token: "t", role: "head", departmentId: 3, label: "ภาษาไทย" }), false);
  eq(canManageRegistry(null), false);
});

test("หัวหน้ากลุ่มสาระเห็นแค่กลุ่มตัวเอง", () => {
  deepEq(visibleDepartments({ token: "t", role: "head", departmentId: 3, label: "x" }, [1, 2, 3]), [3]);
  deepEq(visibleDepartments({ token: "t", role: "admin", departmentId: null, label: "x" }, [1, 2, 3]), [1, 2, 3]);
});

test("ยังไม่ล็อกอินไม่เห็นกลุ่มไหนเลย", () => {
  deepEq(visibleDepartments(null, [1, 2, 3]), []);
});

test("หัวหน้าที่กลุ่มของตัวเองไม่อยู่ในรายการ เห็นว่าง", () => {
  deepEq(visibleDepartments(HEAD3, [1, 2]), []);
  deepEq(visibleDepartments({ ...HEAD3, departmentId: null }, [1, 2, 3]), []);
});

test("loginError: ทุกสถานะเป็นไทย ไม่ซ้ำกัน และบอกเหตุถูกข้อ", () => {
  const msgs = [401, 503, 0, 500].map(loginError);
  for (const m of msgs) eq(hasThai(m), true);
  eq(new Set(msgs).size, msgs.length, );
  eq(loginError(401).includes("รหัสไม่ถูกต้อง"), true);
  eq(loginError(503).includes("ฐานข้อมูล"), true);
  eq(loginError(503).includes("ภายหลัง"), true);
  eq(loginError(0).includes("ติดต่อเซิร์ฟเวอร์ไม่ได้"), true);
  eq(loginError(0).includes("ตื่น"), true);
  eq(loginError(500).includes("500"), true);
  eq(loginError(429).includes("429"), true);
});

test("parseSession: ของดีอ่านกลับได้", () => {
  deepEq(parseSession(JSON.stringify(ADMIN)), ADMIN);
  deepEq(parseSession(JSON.stringify(HEAD3)), HEAD3);
});

test("parseSession: null / ไม่ใช่ JSON / รูปผิด → null", () => {
  eq(parseSession(null), null);
  eq(parseSession(""), null);
  eq(parseSession("{not json"), null);
  eq(parseSession("null"), null);
  eq(parseSession("[]"), null);
  eq(parseSession('"admin"'), null);
  eq(parseSession(JSON.stringify({ token: "t", role: "admin" })), null);
  eq(parseSession(JSON.stringify({ ...ADMIN, label: 5 })), null);
});

test("parseSession: role แปลก / token ว่าง → null", () => {
  eq(parseSession(JSON.stringify({ ...ADMIN, role: "root" })), null);
  eq(parseSession(JSON.stringify({ ...ADMIN, role: "ADMIN" })), null);
  eq(parseSession(JSON.stringify({ ...ADMIN, token: "" })), null);
  eq(parseSession(JSON.stringify({ ...ADMIN, token: 123 })), null);
});

test("parseSession: หัวหน้าที่ไม่มี departmentId ที่เป็นเลข → null · admin ที่มี departmentId → null", () => {
  eq(parseSession(JSON.stringify({ ...HEAD3, departmentId: null })), null);
  eq(parseSession(JSON.stringify({ ...HEAD3, departmentId: "3" })), null);
  eq(parseSession(JSON.stringify({ ...ADMIN, departmentId: 3 })), null);
});

test("SESSION_KEY เป็นข้อความไม่ว่าง", () => {
  eq(typeof SESSION_KEY === "string" && SESSION_KEY.length > 0, true);
});

test("thaiDetail: คืนเฉพาะข้อความที่มีอักษรไทย", () => {
  eq(thaiDetail("รหัสไม่ถูกต้อง"), "รหัสไม่ถูกต้อง");
  eq(thaiDetail("ผิดพลาด code 5"), "ผิดพลาด code 5");
  eq(thaiDetail("Not Found"), null);
  eq(thaiDetail([{ msg: "field required" }]), null);
  eq(thaiDetail(undefined), null);
  eq(thaiDetail(""), null);
});

if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  process.exit(1);
}
console.log("ALL PASS");
