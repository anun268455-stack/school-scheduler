/**
 * อ่านตารางคาบสุดท้าย/คาบว่างที่โรงเรียนพิมพ์มา ให้กลายเป็นตัวเลขต่อห้อง
 *
 * "ฉันอยากได้ระบบเช็ค คาบ 9 กับ คาบวาง ที่แต่ละห้องมี"
 *
 * โรงเรียนเขียนมาเป็นข้อความอยู่แล้ว และเขียนแบบที่คนอ่านกันจริงๆ — ช่วงห้อง
 * ("ม.2/1 - 6"), ห้องย่อยเรียงกัน ("ม.4/6 ก ข"), เว้นวรรคตามใจ ไฟล์นี้จึงอ่าน
 * แบบนั้นได้ แทนที่จะให้พิมพ์ใหม่ทีละห้อง
 */

/** ชื่อห้องแบบไม่มีช่องว่าง ใช้เทียบกับที่พิมพ์มา */
const tight = (s: string) => (s ?? "").replace(/\s+/g, "");

/** ตัวอักษรไทยตัวเดียว = ชื่อห้องย่อย (ก/ข/ค) ไม่ใช่เลขห้อง */
const isSubLetter = (s: string) => /^[ก-ฮ]$/.test(s);

export interface Parsed {
  targets: { group_id: number; last: number | null; free: number | null }[];
  matched: string[];
  missed:  string[];
}

/**
 * อ่านตารางที่โรงเรียนพิมพ์มา
 *
 *   ม.2/1 - 6  มี 1 คาบ      → ม.2/1 ถึง ม.2/6 เรียนถึงคาบสุดท้าย 1 คาบ
 *   ม.4/6 ก ข  ว่าง 2 คาบ    → ม.4/6ก และ ม.4/6ข ว่าง 2 คาบ ไม่มีคาบสุดท้าย
 *
 * "มี" กับ "ว่าง" เป็นคนละด้านของเรื่องเดียวกัน ห้องที่วิชาล้นจึงได้คาบสุดท้าย
 * ส่วนห้องที่ยังว่างแปลว่าไม่ต้องเรียนถึงคาบสุดท้าย — เติมอีกฝั่งให้เป็น 0
 * ตามนั้น แก้รายห้องทีหลังได้ที่ตารางข้างล่าง
 */
export function parseTargets(text: string, rows: { group_id: number; name: string | null }[]): Parsed {
  const byName = new Map<string, number>();
  for (const r of rows) byName.set(tight(r.name ?? ""), r.group_id);
  const seen = new Map<number, { last: number | null; free: number | null }>();
  const matched: string[] = [];
  const missed: string[] = [];

  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const kw = line.match(/(มี|ว่าง)\s*(\d+)/);
    if (!kw || kw.index == null) continue;
    const n = Number(kw[2]);
    const want = kw[1] === "มี" ? { last: n, free: 0 } : { last: 0, free: n };

    const head = line.slice(0, kw.index).trim();
    const hm = head.match(/^ม\.?\s*(\d+)\s*\/\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*(.*)$/);
    if (!hm) { missed.push(line); continue; }
    const lvl = Number(hm[1]);
    const from = Number(hm[2]);
    const to = hm[3] ? Number(hm[3]) : from;
    const letters = (hm[4] ?? "").split(/\s+/).filter(isSubLetter);

    const hit: number[] = [];
    for (let i = from; i <= to && i - from < 40; i++) {
      const base = `ม.${lvl}/${i}`;
      if (letters.length) {
        for (const L of letters) {
          const id = byName.get(base + L);
          if (id != null) hit.push(id);
        }
      } else {
        const id = byName.get(base);
        if (id != null) hit.push(id);
        // ไม่มีห้องชื่อนี้ตรงๆ แต่มีห้องย่อยของมัน — ใช้กับทุกห้องย่อย
        for (const [name, gid] of byName) {
          if (name.length === base.length + 1 && name.startsWith(base)
              && isSubLetter(name.slice(base.length))) {
            hit.push(gid);
          }
        }
      }
    }
    if (!hit.length) { missed.push(line); continue; }
    for (const id of hit) seen.set(id, want);
    matched.push(line);
  }

  return {
    targets: [...seen].map(([group_id, w]) => ({ group_id, ...w })),
    matched, missed,
  };
}

