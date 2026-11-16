/**
 * ทดสอบ workload/src/curriculum.ts — ตรรกะล้วนของหน้าหลักสูตร (ทุกคนเปิดดู admin แก้ บันทึกการแก้)
 *
 * จุดที่ต้องไม่พลาด: ห้องเรียงแบบเลข (ม.1/2 ก่อน ม.1/10) · ยอดคาบ/หน่วยกิตของหลักสูตรรวมถูก (หน่วยกิตเป็นทศนิยมได้)
 * · หลักสูตรที่ไม่มีระดับต้องไม่หายจากจอ · ฟอร์มบรรทัดปฏิเสธค่าที่เซิร์ฟเวอร์ไม่รับก่อนส่ง
 * · บันทึกการแก้แสดงวันที่ไทย (พ.ศ. · 24 ชม. · เวลาไทย) และข้อความไทยเท่านั้น (ไม่โชว์คีย์ action ภาษาอังกฤษ)
 * · ห้องที่อยู่หลักสูตรอื่นแล้วต้องรู้ว่าอยู่หลักสูตรไหน · 409 ที่ต้องยืนยันซ้ำแยกออกจาก 409 อื่นได้
 */
import {
  applyCode, buildCurriculumBody, buildLineBody, buildOptionBody, buildSetBody, classSort, codeMatch, curriculumChanges,
  curriculumSummary, departmentName, departmentShow, missingRooms, parseSeedResult, forceConflict, groupCurricula, guessTerm, KIND_TEXT, levelOf, lineChanges,
  logLine, logParts, nextTerm, optionChanges, parseTerm, roomRange, roomsByLevel, searchSubjects, seedSummary,
  setChanges, SET_KIND_TEXT, subjectsWithCode, takenRooms, termChoices, termLabel, thaiDateTime,
  type Curriculum, type CurriculumLine, type LineForm, type SeedResult, type TermSet,
} from "../../workload/src/curriculum.ts";

const fails: string[] = [];
const test = (name: string, fn: () => void): void => {
  try { fn(); } catch (e) { fails.push(`${name} — ${(e as Error).message}`); }
};
const eq = (a: unknown, b: unknown): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`ได้ ${JSON.stringify(a)} ควรเป็น ${JSON.stringify(b)}`);
  }
};
const ok = (cond: unknown, what: string): void => {
  if (!cond) throw new Error(what);
};
const hasThai = (s: string): boolean => /[฀-๿]/.test(s);

let nextId = 1;
const L = (p: Partial<CurriculumLine> = {}): CurriculumLine => ({
  id: nextId++, curriculum_id: 1, subject_id: null, code: "ท21102", name: "ภาษาไทยพื้นฐาน 2", credits: 1.5,
  weekly: 3, kind: "basic", department_id: 1, sort: 1, ...p,
});
const C = (p: Partial<Curriculum> = {}): Curriculum => ({
  id: nextId++, year: 2569, semester: 2, name: "หลักสูตร", level: null, note: "", group_ids: [], group_names: [],
  lines: [], ...p,
});
const S = (p: Partial<TermSet> = {}): TermSet => ({
  id: nextId++, year: 2569, semester: 2, kind: "elective", name: "ชุด", group_ids: [], group_names: [], weekly: 2,
  is_double: false, options: [], ...p,
});
const names = (list: { name: string }[]): string[] => list.map((x) => x.name);

// ── ป้าย ──────────────────────────────────────────────────────────────
test("KIND_TEXT ป้ายไทยของประเภทบรรทัด · SET_KIND_TEXT ของชุด", () => {
  eq(KIND_TEXT, { basic: "พื้นฐาน", additional: "เพิ่มเติม", activity: "กิจกรรมพัฒนาผู้เรียน" });
  eq(SET_KIND_TEXT, { elective: "ชุดคาบเสรี", activity: "ชุดกิจกรรม" });
});

// ── ระดับชั้นและการเรียงห้อง ─────────────────────────────────────────────
test("levelOf: ม.4/6ก → ม.4 · ชื่อแปลก → null (กฎเดียวกับ wl_level_of ของเซิร์ฟเวอร์)", () => {
  eq(levelOf("ม.4/6ก"), "ม.4");
  eq(levelOf("ม.1/1"), "ม.1");
  eq(levelOf(" ม. 3 / 2"), "ม.3");
  eq(levelOf("ม4/6"), "ม.4");
  eq(levelOf("ม.04/1"), "ม.4");
  eq(levelOf("ห้องพิเศษ"), null);
  eq(levelOf("4/6"), null);
  eq(levelOf(""), null);
  eq(levelOf(null), null);
  eq(levelOf(undefined), null);
});

test("classSort: ม.1/2 ก่อน ม.1/10 · ห้องย่อยตามหลังห้องแม่ · ชื่อแปลกไว้ท้าย", () => {
  const input = ["ม.2/1", "ม.1/10", "ห้องพิเศษ", "ม.4/7", "ม.1/2", "ม.4/6ข", "ม.4/6", "ม.1/1", "ม.4/6ก", "ก"];
  const before = [...input];
  eq([...input].sort(classSort), ["ม.1/1", "ม.1/2", "ม.1/10", "ม.2/1", "ม.4/6", "ม.4/6ก", "ม.4/6ข", "ม.4/7", "ก", "ห้องพิเศษ"]);
  eq(input, before);
  eq(classSort("ม.1/1", " ม. 1 / 1 "), 0);
  ok(classSort("ม.1/2", "ม.1/10") < 0 && classSort("ม.1/10", "ม.1/2") > 0, "ต้องสมมาตร");
});

test("roomRange: ย่อเป็นช่วงแบบเดียวกับ wl_room_range (คง ม. ไว้ · ห้องย่อยต่อท้าย · ว่าง)", () => {
  eq(roomRange(["ม.1/3", "ม.1/1", "ม.1/2", "ม.1/4", "ม.1/5", "ม.1/6"]), "ม.1/1-6");
  eq(roomRange(["ม.1/1", "ม.1/2", "ม.1/3", "ม.1/5"]), "ม.1/1-3,5");
  eq(roomRange(["ม.2/1", "ม.1/1"]), "ม.1/1 ม.2/1");
  eq(roomRange(["ม.4/6ก", "ม.4/1", "ม.4/6ก"]), "ม.4/1 ม.4/6ก");
  eq(roomRange(["ม.1/9", "ม.1/10", "ม.1/11"]), "ม.1/9-11");
  eq(roomRange([]), "(ยังไม่มีห้อง)");
});

test("roomsByLevel: ช่องติ๊กห้องจัดตามระดับ ม.1 → ม.6 · ในระดับเรียงแบบเลข · ชื่อแปลกไว้กลุ่มท้าย", () => {
  const g = [{ id: 1, name: "ม.2/1" }, { id: 2, name: "ม.1/10" }, { id: 3, name: "ห้องพิเศษ" }, { id: 4, name: "ม.1/2" }];
  eq(roomsByLevel(g), [
    { level: "ม.1", groups: [{ id: 4, name: "ม.1/2" }, { id: 2, name: "ม.1/10" }] },
    { level: "ม.2", groups: [{ id: 1, name: "ม.2/1" }] },
    { level: null, groups: [{ id: 3, name: "ห้องพิเศษ" }] },
  ]);
  eq(g.map((x) => x.id), [1, 2, 3, 4]);
});

// ── สรุปและจัดกลุ่มหลักสูตร ─────────────────────────────────────────────
test("curriculumSummary: รวมคาบ/สัปดาห์ หน่วยกิต (1.5 + 1 · ว่างนับ 0) และช่วงห้อง", () => {
  const c = C({
    group_names: ["ม.1/1", "ม.1/2", "ม.1/3", "ม.1/4", "ม.1/5", "ม.1/6"],
    lines: [L({ credits: 1.5, weekly: 3 }), L({ credits: 1, weekly: 2 }), L({ credits: null, weekly: 1 })],
  });
  eq(curriculumSummary(c), { lines: 3, weekly: 6, credits: 2.5, groups: "ม.1/1-6" });
  eq(curriculumSummary(C({ lines: [L({ credits: 0.1 }), L({ credits: 0.2 })] })).credits, 0.3);
  eq(curriculumSummary(C()), { lines: 0, weekly: 0, credits: 0, groups: "(ยังไม่มีห้อง)" });
});

test("groupCurricula: ม.1 → ม.6 · ในระดับเรียงตามห้องแรก · ไม่มีระดับไว้ท้าย · ไม่แก้ลิสต์เดิม", () => {
  const m2 = C({ name: "ม.2", level: "ม.2", group_names: ["ม.2/1"] });
  const derived = C({ name: "ม.4 วิทย์", level: null, group_names: ["ม.4/1", "ม.4/2"] });
  const b = C({ name: "B", level: "ม.1", group_names: ["ม.1/10"] });
  const a = C({ name: "A", level: "ม.1", group_names: ["ม.1/2", "ม.1/3"] });
  const mixed = C({ name: "ผสม", level: null, group_names: ["ม.1/1", "ม.2/2"] });
  const empty = C({ name: "ยังไม่มีห้อง", level: "ม.1", group_names: [] });
  const odd = C({ name: "พิเศษ", level: "ปวช.", group_names: [] });
  const ten = C({ name: "ม.10", level: "ม.10", group_names: [] });
  const list = [m2, derived, b, mixed, a, empty, odd, ten];
  const before = list.map((c) => c.id);
  const out = groupCurricula(list);
  eq(out.map((g) => g.level), ["ม.1", "ม.2", "ม.4", "ม.10", "ปวช.", null]);
  eq(names(out[0].curricula), ["A", "B", "ยังไม่มีห้อง"]);
  eq(names(out[2].curricula), ["ม.4 วิทย์"]);
  eq(names(out[5].curricula), ["ผสม"]);
  eq(list.map((c) => c.id), before);
  eq(groupCurricula([]), []);
});

// ── ฟอร์มบรรทัด ───────────────────────────────────────────────────────
const F = (p: Partial<LineForm> = {}): LineForm =>
  ({ code: "ท21102", name: "", credits: "", weekly: "3", kind: "", department_id: null, ...p });

test("buildLineBody: รหัสว่าง → ข้อความ · รหัสตัดช่องว่าง", () => {
  for (const code of ["", "   "]) {
    const r = buildLineBody(F({ code }));
    ok(!r.ok && r.error === "กรุณากรอกรหัสวิชา", JSON.stringify(r));
  }
  const r = buildLineBody(F({ code: "  ท21102 " }));
  ok(r.ok && r.body.code === "ท21102", JSON.stringify(r));
});

test("buildLineBody: คาบ/สัปดาห์ต้องเป็นจำนวนเต็ม 1–99", () => {
  for (const weekly of ["", " ", "0", "-1", "1.5", "abc", "100", "3คาบ", "1e1"]) {
    const r = buildLineBody(F({ weekly }));
    ok(!r.ok && hasThai(r.error) && r.error.includes("คาบ"), `${weekly}: ${JSON.stringify(r)}`);
  }
  for (const [weekly, want] of [["1", 1], [" 3 ", 3], ["99", 99], ["03", 3]] as const) {
    const r = buildLineBody(F({ weekly }));
    ok(r.ok && r.body.weekly === want, `${weekly}: ${JSON.stringify(r)}`);
  }
});

test("buildLineBody: หน่วยกิตว่าง = null · ≥ 0 ทศนิยมได้ · ไม่เกิน 99", () => {
  for (const [credits, want] of [["", null], ["  ", null], ["1.5", 1.5], ["0", 0], [" 2 ", 2], [".5", 0.5], ["99", 99]] as const) {
    const r = buildLineBody(F({ credits }));
    ok(r.ok && r.body.credits === want, `${credits}: ${JSON.stringify(r)}`);
  }
  for (const credits of ["-1", "abc", "1,5", "100", "1.5.1", "1."]) {
    const r = buildLineBody(F({ credits }));
    ok(!r.ok && hasThai(r.error) && r.error.includes("หน่วยกิต"), `${credits}: ${JSON.stringify(r)}`);
  }
});

test("buildLineBody: ชื่อว่างไม่ส่ง (เซิร์ฟเวอร์เติมจากทะเบียน) · ประเภทว่างไม่ส่ง (เซิร์ฟเวอร์เดาจากรหัส) · กลุ่มสาระส่งตามที่เลือก", () => {
  const r = buildLineBody(F({ name: "  ", kind: "", department_id: null }));
  ok(r.ok, JSON.stringify(r));
  if (r.ok) {
    eq(r.body, { code: "ท21102", credits: null, weekly: 3, department_id: null });
    ok(!("name" in r.body) && !("kind" in r.body), "ไม่ควรมีคีย์ name/kind");
  }
  const r2 = buildLineBody(F({ name: " วิชาพิมพ์เอง ", kind: "activity", department_id: 4, credits: "1" }));
  ok(r2.ok, JSON.stringify(r2));
  if (r2.ok) eq(r2.body, { code: "ท21102", name: "วิชาพิมพ์เอง", credits: 1, weekly: 3, kind: "activity", department_id: 4 });
});

test("buildLineBody: ตรวจรหัสก่อน แล้วคาบ แล้วหน่วยกิต (ข้อความเดียวที่ชี้ช่องแรกที่ผิด)", () => {
  const r = buildLineBody(F({ code: "", weekly: "x", credits: "x" }));
  ok(!r.ok && r.error === "กรุณากรอกรหัสวิชา", JSON.stringify(r));
  const r2 = buildLineBody(F({ weekly: "x", credits: "x" }));
  ok(!r2.ok && r2.error.includes("คาบ"), JSON.stringify(r2));
});

// ── ฟอร์มหลักสูตร ชุด ตัวเลือก ─────────────────────────────────────────
test("buildCurriculumBody: ชื่อบังคับ · ระดับว่าง = null (ตามห้อง) · ตัดช่องว่าง", () => {
  const bad = buildCurriculumBody({ name: "  ", level: "", note: "", group_ids: [] });
  ok(!bad.ok && hasThai(bad.error) && bad.error.includes("ชื่อหลักสูตร"), JSON.stringify(bad));
  const r = buildCurriculumBody({ name: " ม.4 วิทย์-คณิต ", level: "", note: " ห้องเรียนพิเศษ ", group_ids: [3, 1] });
  ok(r.ok, JSON.stringify(r));
  if (r.ok) eq(r.body, { name: "ม.4 วิทย์-คณิต", level: null, note: "ห้องเรียนพิเศษ", group_ids: [3, 1] });
});

test("curriculumChanges: ส่งเฉพาะช่องที่เปลี่ยน · ห้องเทียบเป็นเซต (ลำดับไม่นับ)", () => {
  const before = C({ name: "A", level: "ม.1", note: "", group_ids: [1, 2] });
  eq(curriculumChanges(before, { name: "A", level: "ม.1", note: "", group_ids: [2, 1] }), {});
  eq(curriculumChanges(before, { name: "A", level: null, note: "x", group_ids: [1, 2] }), { level: null, note: "x" });
  eq(curriculumChanges(before, { name: "B", level: "ม.1", note: "", group_ids: [1, 3] }), { name: "B", group_ids: [1, 3] });
  eq(curriculumChanges(before, { name: "A", level: "ม.1", note: "", group_ids: [1] }), { group_ids: [1] });
});

test("buildSetBody: ชื่อบังคับ · คาบจำนวนเต็ม 1–99 · คาบคู่เป็นจริง/เท็จ", () => {
  const base = { kind: "elective" as const, name: "วิชาเสรี ม.4", weekly: "2", is_double: true, group_ids: [5] };
  const r = buildSetBody(base);
  ok(r.ok, JSON.stringify(r));
  if (r.ok) eq(r.body, { kind: "elective", name: "วิชาเสรี ม.4", weekly: 2, is_double: true, group_ids: [5] });
  const noName = buildSetBody({ ...base, name: " " });
  ok(!noName.ok && noName.error.includes("ชื่อชุด"), JSON.stringify(noName));
  const badWeekly = buildSetBody({ ...base, weekly: "0" });
  ok(!badWeekly.ok && badWeekly.error.includes("คาบ"), JSON.stringify(badWeekly));
});

test("buildOptionBody: รหัสบังคับ · ชื่อว่างไม่ส่ง", () => {
  const bad = buildOptionBody({ code: " ", name: "", department_id: null });
  ok(!bad.ok && bad.error === "กรุณากรอกรหัสวิชา", JSON.stringify(bad));
  const r = buildOptionBody({ code: " ง30201 ", name: "", department_id: 8 });
  ok(r.ok, JSON.stringify(r));
  if (r.ok) eq(r.body, { code: "ง30201", department_id: 8 });
  const r2 = buildOptionBody({ code: "X9", name: " วิชาพิมพ์เอง ", department_id: null });
  ok(r2.ok, JSON.stringify(r2));
  if (r2.ok) eq(r2.body, { code: "X9", name: "วิชาพิมพ์เอง", department_id: null });
});

test("lineChanges: ส่งเฉพาะช่องที่เปลี่ยน · ชื่อที่ไม่ได้ส่ง (ว่าง) ไม่นับ · ประเภทที่ไม่ได้เลือกไม่นับ", () => {
  const ln = L({ code: "ท21102", name: "ภาษาไทยพื้นฐาน 2", credits: 1.5, weekly: 3, kind: "basic", department_id: 1 });
  eq(lineChanges(ln, { code: "ท21102", name: "ภาษาไทยพื้นฐาน 2", credits: 1.5, weekly: 3, kind: "basic", department_id: 1 }), {});
  eq(lineChanges(ln, { code: "ท21102", credits: 1, weekly: 2, department_id: 1 }), { credits: 1, weekly: 2 });
  eq(lineChanges(ln, { code: "ท21102", credits: null, weekly: 3, department_id: null }), { credits: null, department_id: null });
  eq(lineChanges(ln, { code: "X9", name: "วิชาพิมพ์เอง", credits: 1.5, weekly: 3, kind: "additional", department_id: 1 }),
    { code: "X9", name: "วิชาพิมพ์เอง", kind: "additional" });
  // เปลี่ยนรหัสเป็นรหัสที่ไม่มีในทะเบียนแต่คงชื่อเดิม: เซิร์ฟเวอร์ต้องได้ชื่อไปด้วย ไม่งั้นตอบ 400 "ต้องระบุชื่อวิชา"
  eq(lineChanges(ln, { code: "ท21102ก", name: "ภาษาไทยพื้นฐาน 2", credits: 1.5, weekly: 3, kind: "basic", department_id: 1 }),
    { code: "ท21102ก", name: "ภาษาไทยพื้นฐาน 2" });
  // รหัสเดิมที่มีช่องว่างหัวท้ายไม่ใช่การเปลี่ยนรหัส
  eq(lineChanges({ ...ln, code: " ท21102 " }, { code: "ท21102", name: "ภาษาไทยพื้นฐาน 2", credits: 1.5, weekly: 3, department_id: 1 }), {});
});

test("setChanges · optionChanges: ส่งเฉพาะช่องที่เปลี่ยน · ห้องของชุดเทียบเป็นเซต", () => {
  const s = S({ kind: "elective", name: "ชุด", weekly: 2, is_double: false, group_ids: [1, 2] });
  eq(setChanges(s, { kind: "elective", name: "ชุด", weekly: 2, is_double: false, group_ids: [2, 1] }), {});
  eq(setChanges(s, { kind: "activity", name: "ชุด ก", weekly: 1, is_double: true, group_ids: [1] }),
    { kind: "activity", name: "ชุด ก", weekly: 1, is_double: true, group_ids: [1] });
  const o = { id: 1, set_id: 1, subject_id: null, code: "X9", name: "วิชาพิมพ์เอง", department_id: null };
  eq(optionChanges(o, { code: "X9", department_id: 7 }), { department_id: 7 });
  eq(optionChanges(o, { code: "X9", name: "วิชาพิมพ์เอง", department_id: null }), {});
  eq(optionChanges(o, { code: "X10", name: "วิชาพิมพ์เอง", department_id: null }), { code: "X10", name: "วิชาพิมพ์เอง" });
});

// ── บันทึกการแก้ ─────────────────────────────────────────────────────
const E = { id: 1, at: "2026-11-16T07:05:00+00:00", by: "ผู้ดูแลระบบ", action: "line.create",
  detail: "เพิ่ม ท21102 ภาษาไทยพื้นฐาน 2 (3 คาบ) ในหลักสูตร ม.1/1-6" };

test("logLine: วันที่ไทย พ.ศ. เวลา 24 ชม. (เวลาไทย) · ผู้แก้ · ข้อความไทย", () => {
  eq(logLine(E), "16 พ.ย. 2569 14:05 · ผู้ดูแลระบบ · เพิ่ม ท21102 ภาษาไทยพื้นฐาน 2 (3 คาบ) ในหลักสูตร ม.1/1-6");
});

test("logLine: ไม่แสดงคีย์ action ภาษาอังกฤษ", () => {
  ok(!logLine(E).includes("line.create"), logLine(E));
  ok(!logLine({ ...E, action: "seed.timetable" }).includes("seed"), "seed");
});

test("thaiDateTime: ไมโครวินาทีของ Postgres · เขตเวลาอื่น · ข้ามปีใหม่ · เที่ยงคืน · ค่าผิดรูป", () => {
  eq(thaiDateTime("2026-11-16T07:05:09.123456+00:00"), "16 พ.ย. 2569 14:05");
  eq(thaiDateTime("2026-11-16T14:05:00+07:00"), "16 พ.ย. 2569 14:05");
  eq(thaiDateTime("2026-12-31T17:30:00Z"), "1 ม.ค. 2570 00:30");
  eq(thaiDateTime("2027-01-31T16:59:00+00:00"), "31 ม.ค. 2570 23:59");
  eq(thaiDateTime("2026-05-01T02:07:00-03:00"), "1 พ.ค. 2569 12:07");
  eq(thaiDateTime("ไม่ใช่วันที่"), null);
  eq(thaiDateTime(""), null);
});

test("logLine: วันที่ผิดรูปแสดงค่าดิบ ไม่ใช่ NaN · ไม่มีชื่อผู้แก้ก็ยังอ่านได้", () => {
  const line = logLine({ ...E, at: "เมื่อวาน", by: "" });
  ok(!line.includes("NaN") && line.startsWith("เมื่อวาน · ") && line.endsWith(E.detail), line);
  eq(logParts(E), { when: "16 พ.ย. 2569 14:05", by: "ผู้ดูแลระบบ", detail: E.detail });
});

// ── ภาคเรียน ─────────────────────────────────────────────────────────
test("termLabel · nextTerm · guessTerm (ภาค 1 = พ.ค.–ต.ค. · ภาค 2 = พ.ย.–เม.ย. ของปีการศึกษาเดิม)", () => {
  eq(termLabel(2569, 2), "2/2569");
  eq(nextTerm({ year: 2569, semester: 2 }), { year: 2570, semester: 1 });
  eq(nextTerm({ year: 2569, semester: 1 }), { year: 2569, semester: 2 });
  eq(guessTerm(new Date(Date.UTC(2026, 10, 16))), { year: 2569, semester: 2 });
  eq(guessTerm(new Date(Date.UTC(2026, 4, 20))), { year: 2569, semester: 1 });
  eq(guessTerm(new Date(Date.UTC(2026, 9, 31))), { year: 2569, semester: 1 });
  eq(guessTerm(new Date(Date.UTC(2027, 0, 10))), { year: 2569, semester: 2 });
  eq(guessTerm(new Date(Date.UTC(2027, 3, 30))), { year: 2569, semester: 2 });
});

test("parseTerm: ปี พ.ศ. 2500–2700 · ภาค 1 หรือ 2 (กฎเดียวกับเซิร์ฟเวอร์)", () => {
  eq(parseTerm(" 2569 ", "2"), { ok: true, term: { year: 2569, semester: 2 } });
  for (const [y, s] of [["", "1"], ["2499", "1"], ["2701", "1"], ["2569", "3"], ["2569", ""], ["25.5", "1"], ["2026x", "1"]]) {
    const r = parseTerm(y, s);
    ok(!r.ok && hasThai(r.error), `${y}/${s}: ${JSON.stringify(r)}`);
  }
});

test("termChoices: ภาคเรียนที่มีหลักสูตร + ที่เสนอเพิ่ม (ยังว่าง) · ใหม่ก่อน · ไม่ซ้ำ", () => {
  const terms = [
    { year: 2569, semester: 2, label: "2/2569", locked: false },
    { year: 2569, semester: 1, label: "1/2569", locked: true },
  ];
  eq(termChoices(terms, [{ year: 2570, semester: 1 }, { year: 2569, semester: 2 }]), [
    { year: 2570, semester: 1, label: "1/2570", locked: false, empty: true },
    { year: 2569, semester: 2, label: "2/2569", locked: false, empty: false },
    { year: 2569, semester: 1, label: "1/2569", locked: true, empty: false },
  ]);
  eq(termChoices([], []), []);
});

// ── ห้องที่ติ๊กไม่ได้ ──────────────────────────────────────────────────
test("takenRooms: ห้องของหลักสูตรอื่นในภาคเรียนเดียวกัน → ชื่อหลักสูตรนั้น · หลักสูตรที่กำลังแก้ไม่นับ", () => {
  const a = C({ name: "ม.1/1-2", group_ids: [1, 2] });
  const b = C({ name: "ม.1/3", group_ids: [3] });
  eq([...takenRooms([a, b], a.id)], [[3, "ม.1/3"]]);
  eq([...takenRooms([a, b], null)], [[1, "ม.1/1-2"], [2, "ม.1/1-2"], [3, "ม.1/3"]]);
});

// ── รหัสวิชา → ชื่อและกลุ่มสาระจากทะเบียน ────────────────────────────────
const REG = [
  { id: 1, code: "ท21102", name: "ภาษาไทยพื้นฐาน 2", department_id: 1 },
  { id: 2, code: " DUP ", name: "ซ้ำ ก", department_id: 2 },
  { id: 3, code: "DUP", name: "ซ้ำ ข", department_id: 3 },
  { id: 4, code: "ค21102", name: "คณิตศาสตร์พื้นฐาน 2", department_id: 2 },
];

test("subjectsWithCode: ตัดช่องว่างแล้วเทียบตรงตัว (กฎเดียวกับ _wl_bind_code) · ซ้ำได้หลายวิชา", () => {
  eq(subjectsWithCode(" ท21102 ", REG).map((s) => s.id), [1]);
  eq(subjectsWithCode("DUP", REG).map((s) => s.id), [2, 3]);
  eq(subjectsWithCode("ท2110", REG), []);
  eq(subjectsWithCode("  ", REG), []);
});

test("applyCode: พิมพ์รหัสที่มีในทะเบียน → เติมชื่อและกลุ่มสาระ · เปลี่ยนเป็นรหัสที่ไม่มี → ล้างที่เติมให้ · ชื่อที่พิมพ์เองไม่ถูกทับ", () => {
  const empty = { code: "", name: "", department_id: null as number | null, weekly: "3" };
  const filled = applyCode(empty, " ท21102 ", REG);
  eq(filled, { code: " ท21102 ", name: "ภาษาไทยพื้นฐาน 2", department_id: 1, weekly: "3" });
  eq(empty, { code: "", name: "", department_id: null, weekly: "3" });
  eq(applyCode(filled, "ค21102", REG), { code: "ค21102", name: "คณิตศาสตร์พื้นฐาน 2", department_id: 2, weekly: "3" });
  eq(applyCode(filled, "X9", REG), { code: "X9", name: "", department_id: null, weekly: "3" });
  const typed = { code: "X", name: "วิชาพิมพ์เอง", department_id: 4 as number | null, weekly: "3" };
  eq(applyCode(typed, "X9", REG), { ...typed, code: "X9" });
  // รหัสที่มีในทะเบียนหลายวิชา: ไม่เดา
  eq(applyCode(typed, "DUP", REG), { ...typed, code: "DUP" });
  // ชื่อที่เติมไว้แต่ผู้ใช้เปลี่ยนกลุ่มสาระเอง → ล้างชื่อ คงกลุ่มสาระที่เลือก
  eq(applyCode({ ...filled, department_id: 7 }, "X9", REG), { code: "X9", name: "", department_id: 7, weekly: "3" });
});

// ── ค้นหาวิชาข้ามหลักสูตร ───────────────────────────────────────────────
test("searchSubjects: วิชานี้อยู่หลักสูตรไหนบ้าง (รหัสหรือชื่อ · ไม่สนตัวพิมพ์เล็กใหญ่) รวมชุดคาบเสรี", () => {
  const c1 = C({ name: "ม.1/10", group_names: ["ม.1/10"], lines: [L({ code: "ท21102", weekly: 3 }), L({ code: "EN21102", name: "English 2", weekly: 2 })] });
  const c2 = C({ name: "ม.1/1-6", group_names: ["ม.1/1", "ม.1/2"], lines: [L({ code: "ท21102", weekly: 4 })] });
  const s1 = S({ name: "วิชาเสรี ม.4", group_names: ["ม.4/1"], weekly: 2,
    options: [{ id: 9, set_id: 1, subject_id: null, code: "ท21102", name: "ภาษาไทยพื้นฐาน 2", department_id: 1 }] });
  const hits = searchSubjects([c1, c2], [s1], "ท211");
  eq(hits.length, 1);
  eq(hits[0].code, "ท21102");
  eq(hits[0].places.map((p) => [p.kind, p.name, p.rooms, p.weekly]), [
    ["curriculum", "ม.1/1-6", "ม.1/1-2", 4], ["curriculum", "ม.1/10", "ม.1/10", 3], ["set", "วิชาเสรี ม.4", "ม.4/1", 2],
  ]);
  eq(searchSubjects([c1, c2], [s1], "english").map((h) => h.code), ["EN21102"]);
  eq(searchSubjects([c1, c2], [s1], " ENGLISH ").map((h) => h.code), ["EN21102"]);
  eq(searchSubjects([c1, c2], [s1], "en211").map((h) => h.code), ["EN21102"]);
  eq(searchSubjects([c1, c2], [s1], "ภาษาไทย").map((h) => h.code), ["ท21102"]);
  eq(searchSubjects([c1, c2], [s1], "  "), []);
  eq(searchSubjects([c1, c2], [s1], "ไม่มีวิชานี้"), []);
});

// ── 409 ที่ต้องยืนยันซ้ำ ───────────────────────────────────────────────
test("forceConflict: เฉพาะ 409 ที่ให้ยืนยันซ้ำ → ข้อความไทยของเซิร์ฟเวอร์ (ตัด '(force)' ออก) · 409 อื่น → null", () => {
  const msg = "รอบอัตรากำลังภาคเรียน 2/2569 ยังไม่ปิด และการแก้นี้จะลบแถวที่มีคนใส่ครูหรือยืนยันไว้แล้ว 2 แถว "
    + "ออกจากรอบ — ถ้าต้องการลบจริง ให้ยืนยันซ้ำ (force)";
  const shown = forceConflict(409, msg);
  ok(shown !== null && shown.includes("2 แถว") && !shown.includes("force") && hasThai(shown), String(shown));
  eq(forceConflict(409, "รอบอัตรากำลังภาคเรียน 2/2569 ปิดแล้ว หลักสูตรของภาคเรียนนี้จึงแก้ไม่ได้"), null);
  eq(forceConflict(400, msg), null);
  eq(forceConflict(409, undefined), null);
  eq(forceConflict(409, "Conflict (force)"), null);
});

// ── สรุปการตั้งต้น ─────────────────────────────────────────────────────
test("seedSummary: จำนวนหลักสูตร ห้อง บรรทัด ชุด (คั่นหลักพัน) และการดึงเข้าทะเบียน", () => {
  const r: SeedResult = {
    year: 2569, semester: 2, label: "2/2569", source: "timetable",
    counts: { curricula: 74, lines: 1220, groups: 93, sets: 13, options: 44 },
    imported: { teachers: { created: 143, linked: 0, skipped: 0 }, subjects: { created: 0, linked: 271, skipped: 0 } },
    unconverted: [],
  };
  const lines = seedSummary(r);
  ok(lines.some((l) => l.includes("74 หลักสูตร")), lines.join("|"));
  ok(lines.some((l) => l.includes("93 ห้อง")), lines.join("|"));
  ok(lines.some((l) => l.includes("1,220 บรรทัด")), lines.join("|"));
  ok(lines.some((l) => l.includes("13 ชุด") && l.includes("44 ตัวเลือก")), lines.join("|"));
  ok(lines.some((l) => l.includes("ครูใหม่ 143 คน")), lines.join("|"));
  ok(!lines.some((l) => l.includes("วิชาใหม่")), "วิชาใหม่ 0 ไม่ต้องบอก");
  ok(!seedSummary({ ...r, imported: null, source: "copy" }).some((l) => l.includes("ครูใหม่")), "copy ไม่มีการดึง");
});

test("departmentName: ไม่ระบุ · กลุ่มที่ไม่มีแล้ว · ชื่อกลุ่ม", () => {
  const depts = [{ id: 1, name: "ภาษาไทย" }];
  eq(departmentName(1, depts), "ภาษาไทย");
  eq(departmentName(null, depts), "ยังไม่ระบุกลุ่มสาระ");
  eq(departmentName(9, depts), "กลุ่มสาระที่ไม่มีแล้ว (รหัส 9)");
});

// ── ทะเบียนที่ยังโหลดไม่ได้ ≠ ไม่มีจริง (รีวิวงานที่ 6 ข้อ Important 1) ─────────────────
test("departmentShow: ทะเบียนกลุ่มสาระยังไม่มา → รหัสดิบ ไม่ใช่ 'ไม่มีแล้ว' · ไม่ระบุยังเป็นไม่ระบุ", () => {
  const depts = [{ id: 1, name: "ภาษาไทย" }];
  eq(departmentShow(1, depts, true), { kind: "name", text: "ภาษาไทย" });
  eq(departmentShow(9, depts, true), { kind: "gone", text: "กลุ่มสาระที่ไม่มีแล้ว (รหัส 9)" });
  eq(departmentShow(null, depts, true), { kind: "none", text: "ยังไม่ระบุกลุ่มสาระ" });
  eq(departmentShow(1, [], false), { kind: "raw", text: "กลุ่มสาระรหัส 1" });
  eq(departmentShow(9, [], false), { kind: "raw", text: "กลุ่มสาระรหัส 9" });
  eq(departmentShow(null, [], false), { kind: "none", text: "ยังไม่ระบุกลุ่มสาระ" });
  const text = departmentShow(1, [], false).text;
  ok(!text.includes("ไม่มีแล้ว"), text);
  eq(departmentName(1, [], false), "กลุ่มสาระรหัส 1");
});

test("missingRooms: ห้องที่ไม่มีแล้วตัดสินได้เฉพาะเมื่อรายการห้องโหลดแล้ว", () => {
  const groups = [{ id: 1, name: "ม.1/1" }, { id: 2, name: "ม.1/2" }];
  eq(missingRooms([1, 7, 2, 9], groups, true), [7, 9]);
  eq(missingRooms([1, 7], [], false), []);
  eq(missingRooms([1, 2], groups, true), []);
});

test("codeMatch: ทะเบียนวิชายังไม่มา → unloaded ไม่ใช่ 'ไม่มีในทะเบียน'", () => {
  eq(codeMatch("  ", REG, true), { kind: "blank" });
  eq(codeMatch("ท21102", REG, true), { kind: "one", name: "ภาษาไทยพื้นฐาน 2" });
  eq(codeMatch("DUP", REG, true), { kind: "many", count: 2 });
  eq(codeMatch("X9", REG, true), { kind: "none" });
  eq(codeMatch("ท21102", [], false), { kind: "unloaded" });
  eq(codeMatch("", [], false), { kind: "blank" });
});

// ── กล่องสรุปหลังตั้งต้นเก็บใน sessionStorage (รายการแปลงไม่ได้มาครั้งเดียว) ─────────────
const SEED: SeedResult = {
  year: 2569, semester: 2, label: "2/2569", source: "timetable",
  counts: { curricula: 74, lines: 923, groups: 93, sets: 13, options: 44 },
  imported: { teachers: { created: 143, linked: 0, skipped: 0 }, subjects: { created: 271, linked: 0, skipped: 0 } },
  unconverted: [{ source: "requirement", ref: 1, reason: "ครูรหัส 599 ยังไม่มีในทะเบียน" }],
};

test("parseSeedResult: อ่านกลับได้ครบ · ค่าที่เก็บผิดรูป/ถูกแก้มือ → null (ไม่ทำให้หน้าล้ม)", () => {
  eq(parseSeedResult(JSON.stringify(SEED)), SEED);
  eq(parseSeedResult(JSON.stringify({ ...SEED, source: "copy", imported: null, unconverted: [] })),
    { ...SEED, source: "copy", imported: null, unconverted: [] });
  for (const raw of [null, "", "x", "[]", "null", JSON.stringify({ ...SEED, year: "2569" }),
    JSON.stringify({ ...SEED, source: "other" }), JSON.stringify({ ...SEED, counts: { ...SEED.counts, lines: -1 } }),
    JSON.stringify({ ...SEED, unconverted: [{ reason: 5 }] }), JSON.stringify({ ...SEED, unconverted: "x" }),
    JSON.stringify({ ...SEED, imported: { teachers: {} } }), JSON.stringify({ ...SEED, label: 1 })]) {
    eq(parseSeedResult(raw), null);
  }
});

if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  process.exit(1);
}
console.log("ALL PASS");
