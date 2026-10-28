/**
 * apiBuild — ฝั่งไหนกันแน่ที่ยังเป็นรุ่นเก่า
 *
 * หน้าเว็บอยู่ที่ GitHub Pages ส่วนตัวจัดตารางอยู่ที่ Render สองที่นี้ติดตั้ง
 * แยกกัน จึงไม่ตรงรุ่นกันได้ และ "ไม่ตรงกัน" มีสองแบบที่แก้คนละวิธี
 *
 *   เซิร์ฟเวอร์ค้าง  ติดตั้ง Render ไม่ผ่านหรือยังไม่เริ่ม — ต้องไปสั่งที่ Render
 *   หน้าเว็บค้าง     ติดตั้ง Pages ไม่ผ่าน หรือเบราว์เซอร์ยังใช้ของเก่าในแคช
 *                   — รีเฟรชแบบล้างแคชก่อน ไม่ต้องไปยุ่งกับเซิร์ฟเวอร์เลย
 *
 * เดิมป้ายเขียนว่า "เซิร์ฟเวอร์รุ่นเก่า" ทุกกรณี และบอกให้ไปกด Manual Deploy
 * ที่ Render เสมอ 28 ต.ค. ตัวตรวจไวยากรณ์ทำให้ติดตั้งหน้าเว็บไม่ผ่านสองรอบ
 * หน้าเว็บจึงค้างอยู่รุ่นเก่า แต่ป้ายไปชี้ที่เซิร์ฟเวอร์ คนใช้เลยไปรีเซิร์ฟเวอร์
 * ซ้ำอยู่นานโดยที่ไม่มีอะไรดีขึ้น
 *
 * หมายเลขรุ่นเป็น YYYY-MM-DD.N จึงเทียบกันได้ว่าใครใหม่กว่า
 */

export type BuildSide = "same" | "server-behind" | "page-behind" | "unknown";

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})\.(\d+)$/;

function parse(v: string | null | undefined): number[] | null {
  const m = v ? SHAPE.exec(v) : null;
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * เทียบรุ่นของเซิร์ฟเวอร์กับรุ่นที่หน้าเว็บนี้คาดไว้
 *
 * เซิร์ฟเวอร์ที่เก่าจนไม่มีช่องนี้เลย (null) ถือว่าเก่ากว่าแน่นอน
 * ถ้ารูปแบบอ่านไม่ออกก็ตอบว่าไม่รู้ ดีกว่าเดาแล้วชี้ผิดฝั่ง
 */
export function compareBuild(server: string | null | undefined,
                             expected: string): BuildSide {
  if (server === expected) return "same";
  if (server == null) return "server-behind";
  const a = parse(server);
  const b = parse(expected);
  if (!a || !b) return "unknown";
  const d = cmp(a, b);
  if (d === 0) return "same";
  return d < 0 ? "server-behind" : "page-behind";
}

export interface BuildAdvice {
  /** ข้อความบนป้ายเล็ก */
  chip:  string;
  /** หัวเรื่องในกล่องที่กางออกมา */
  title: string;
  /** ต้องทำอะไรต่อ */
  how:   string;
}

export function buildAdvice(side: BuildSide): BuildAdvice {
  if (side === "page-behind") {
    return {
      chip: "🚧 หน้าเว็บรุ่นเก่า",
      title: "หน้าเว็บนี้ยังเป็นรุ่นเก่ากว่าเซิร์ฟเวอร์",
      how: "กด Ctrl+Shift+R (เครื่อง Mac กด Cmd+Shift+R) เพื่อโหลดใหม่แบบไม่ใช้ของเก่า "
         + "ถ้ายังไม่หายอีกหลังสองสามนาที แปลว่าการติดตั้งหน้าเว็บที่ GitHub ไม่ผ่าน "
         + "— ไม่ต้องไปสั่งอะไรที่ Render เพราะเซิร์ฟเวอร์ใหม่กว่าอยู่แล้ว",
    };
  }
  if (side === "unknown") {
    return {
      chip: "🚧 รุ่นไม่ตรงกัน",
      title: "หน้าเว็บกับเซิร์ฟเวอร์คนละรุ่นกัน",
      how: "ลองรีเฟรชหน้าเว็บแบบล้างแคชก่อน (Ctrl+Shift+R) ถ้ายังไม่หาย "
         + "ให้เข้า Render → school-scheduler-api → Manual Deploy → Deploy latest commit",
    };
  }
  return {
    chip: "🚧 เซิร์ฟเวอร์รุ่นเก่า",
    title: "ตัวจัดตารางบนเซิร์ฟเวอร์ยังเป็นรุ่นเก่า",
    how: "รออีก 2–5 นาทีแล้วป้ายนี้จะหายเอง ถ้ายังไม่หาย ให้เข้า Render → "
       + "school-scheduler-api → Manual Deploy → Deploy latest commit",
  };
}
