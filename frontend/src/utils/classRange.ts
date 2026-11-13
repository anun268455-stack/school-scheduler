/**
 * classRange — ย่อรายชื่อห้องเรียนให้สั้นลงเป็นช่วง
 *
 *   "ตารางการใช้ห้องคือช่วยเขียนแบบสั้นๆ ไม่ต้องเอามาทั้งหมด เช่น 3/5-12
 *    รวมถึงตารางห้องที่ปริ้นออกมาด้วย"
 *
 * ห้องดนตรีไทยคาบหนึ่งมีสิบห้องเรียนเข้าใช้พร้อมกัน ของเดิมต่อชื่อเรียงกันหมด
 * ด้วย `classes.join(" ")` ทั้งในใบพิมพ์และบนจอ ช่องเดียวจึงสูงสิบบรรทัด
 * แล้วเบียดคาบอื่นในวันเดียวกันจนตารางอ่านยาก
 *
 * ── กฎข้อแรกของไฟล์นี้ ──
 *
 * ห้องเรียนห้ามหายไปเงียบ ๆ ครูถือใบนี้เข้าสอน ถ้าย่อแล้วห้องหนึ่งหายไป
 * จะไม่มีอะไรบอกเลยว่าหาย — ป้ายที่จับรูปแบบไม่ได้อย่าง "6ข" (ห้องย่อย ก/ข/ค
 * ที่เรียนพร้อมกัน ไม่มีเครื่องหมายทับ) จึงถูกเขียนตามเดิมต่อท้าย ไม่ใช่ถูกทิ้ง
 * และการตัดด้วย `max` ต้องบอกจำนวนที่เหลือเสมอ ("+2") ไม่ใช่เงียบไป
 */

/** "3/5" · "ม.3/5" — ชั้นทับเลขห้อง ช่องว่างรอบเครื่องหมายทับเผื่อไว้ */
const CLASS_RE = /^(\d+)\s*\/\s*(\d+)$/;

/** ชิ้นหนึ่งในผลลัพธ์ — `level` เป็น null แปลว่าเป็นป้ายที่อ่านรูปแบบไม่ออก */
interface Part {
  level: number | null;
  text: string;
}

/**
 * ยุบรายชื่อห้องเรียนเป็นช่วง
 *
 *   `["3/5","3/6",…,"3/12"]` → `"3/5-12"`
 *   `["3/5","3/6","3/7","3/8","3/10"]` → `"3/5-8,10"`
 *   `["3/5","3/6","6/1","6/2"]` → `"3/5-6 6/1-2"`
 *
 * ชั้นเรียงจากน้อยไปมาก ไม่ใช่ตามลำดับที่เจอ เพราะลำดับที่เจอมาจากลำดับของคาบ
 * ในฐานข้อมูล ซึ่งคนอ่านใบพิมพ์ไม่รู้และไม่ควรต้องรู้
 *
 * เลขห้องเรียงแบบเลข ไม่ใช่แบบตัวอักษร — เรียงแบบตัวอักษรจะได้ 1/10 มาก่อน 1/9
 * แล้วช่วง "1/5-14" จะขาดเป็นเศษกระจัดกระจาย
 *
 * @param max จำนวนชิ้นมากสุดที่ยอมให้แสดง (ช่วงหนึ่งช่วงนับเป็นหนึ่งชิ้น)
 *            ที่เหลือถูกย่อเป็น "+N" · 0 หรือไม่ส่ง = ไม่จำกัด
 *            ใช้บนจอซึ่งชี้เมาส์ดูรายการเต็มได้ ไม่ใช้กับใบพิมพ์ซึ่งชี้ไม่ได้
 */
export function classRanges(labels: readonly string[], max = 0): string {
  const byLevel = new Map<number, Set<number>>();
  const raw: string[] = [];
  const seenRaw = new Set<string>();

  for (const label of labels ?? []) {
    // group_name มาจากฐานข้อมูล จึงเป็น null หรือค่าว่างได้ ช่องเดียวที่ว่าง
    // ต้องไม่กลายเป็นช่องว่างลอยกลางบรรทัด
    const s = String(label ?? "").trim().replace(/^ม\.?\s*/, "");
    if (!s) continue;
    const m = CLASS_RE.exec(s);
    if (!m) {
      if (!seenRaw.has(s)) { seenRaw.add(s); raw.push(s); }
      continue;
    }
    const level = Number(m[1]);
    let nums = byLevel.get(level);
    if (!nums) byLevel.set(level, nums = new Set<number>());
    nums.add(Number(m[2]));
  }

  // ── ยุบเลขที่ต่อเนื่องกันเป็นช่วง ──
  const parts: Part[] = [];
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const nums = [...byLevel.get(level)!].sort((a, b) => a - b);
    for (let i = 0; i < nums.length;) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      parts.push({ level, text: i === j ? `${nums[i]}` : `${nums[i]}-${nums[j]}` });
      i = j + 1;
    }
  }
  for (const r of raw) parts.push({ level: null, text: r });

  const limit = max > 0 ? max : parts.length;
  const kept = parts.slice(0, limit);
  const dropped = parts.length - kept.length;

  // ── ประกอบข้อความ: ชิ้นที่อยู่ชั้นเดียวกันและติดกัน ใช้ "ชั้น/" ร่วมอันเดียว ──
  const out: string[] = [];
  let group: number | null | undefined;
  let buf: string[] = [];
  const flush = (): void => {
    if (!buf.length) return;
    // ชั้นเดียวกันคั่นด้วยจุลภาค คนละชั้นคั่นด้วยเว้นวรรค — ความต่างนี้คือสิ่ง
    // เดียวที่บอกว่า "3/5-6 6/1" เป็นสองชั้น ไม่ใช่ชั้นเดียวสามห้อง
    out.push(group == null ? buf.join(" ") : `${group}/${buf.join(",")}`);
    buf = [];
  };
  for (const p of kept) {
    if (p.level !== group) { flush(); group = p.level; }
    buf.push(p.text);
  }
  flush();

  const text = out.join(" ");
  if (dropped <= 0) return text;
  return text ? `${text} +${dropped}` : `+${dropped}`;
}
