/**
 * แถบที่บอกว่าของที่สั่งไว้กับช่องที่มีไม่พอดีกัน — ก่อนจะกดสร้างตาราง
 *
 * สองอาการที่โรงเรียนถามซ้ำมาหลายรอบมีสาเหตุอยู่ที่นี่ทั้งคู่:
 *
 *   "มีคาบว่าง แต่ก็ไม่สามารถลงคาบได้"
 *   "ม.1/5 มีห้องประจำแต่ไม่มีห้องเรียน"
 *
 * คาบว่างมีสองแบบ และแก้คนละทาง — ลงไม่ได้ (เรื่องของตัวจัดตาราง) กับไม่มีอะไร
 * จะลง (แผนการสอนสั่งชั่วโมงน้อยกว่าช่องที่มี) ส่วนที่สั่งเกินก็เหมือนกัน: ถ้า
 * สัปดาห์มี 35 ช่องแต่หลักสูตรสั่ง 40 คาบ ก็ต้องเหลือคาบที่ลงไม่ได้ 5 คาบเสมอ
 * ไม่ว่าจะกดสร้างตารางใหม่อีกกี่ครั้ง
 *
 * ระบบตรวจเรื่องนี้อยู่แล้วที่ จัดการ → ตรวจความจุ แต่เป็นหน้าที่ไม่มีใครเปิด
 * จนกว่าจะเกิดปัญหา โรงเรียนจึงเห็นแค่กรอบแดงกับวิชาลงไม่ครบ แล้วกดสร้างตาราง
 * ซ้ำอยู่หลายวัน จึงยกหัวข้อขึ้นมาพูดตรงนี้ และกดปิดไม่ได้
 *
 * ใช้เส้น /diagnostics/capacity ที่มีอยู่แล้ว ไม่ได้เพิ่มของใหม่ฝั่งเซิร์ฟเวอร์
 * — แถบนี้จึงทำงานได้ทันทีโดยไม่ต้องรอให้เซิร์ฟเวอร์อัปเดต
 */
import { useEffect, useState } from "react";
import * as api from "../../api/client";

type Report = Awaited<ReturnType<typeof api.fetchCapacity>>;

/** ดูใหม่เป็นระยะ — แก้แผนการสอนหรือผังคาบแล้ว แถบนี้จะหายไปเอง */
const CHECK_MS = 2 * 60 * 1000;

export const CapacityBanner = () => {
  const [rep, setRep] = useState<Report | null>(null);

  useEffect(() => {
    let stop = false;
    const look = async () => {
      try {
        const r = await api.fetchCapacity();
        if (!stop) setRep(r);
      } catch {
        /* ต่อเซิร์ฟเวอร์ไม่ได้เป็นเรื่องของป้ายสถานะการเชื่อมต่อ ไม่ใช่ของแถบนี้ */
      }
    };
    void look();
    const id = setInterval(look, CHECK_MS) as unknown as number;
    return () => { stop = true; clearInterval(id); };
  }, []);

  if (!rep) return null;
  const over = rep.total ?? 0;
  const short = rep.short_total ?? 0;
  // ขึ้นแถบเฉพาะเมื่อ "สั่งเกิน" ซึ่งเป็นปัญหาจริงที่การจัดตารางแก้ไม่ได้
  //
  // ส่วน "สั่งไม่เต็มสัปดาห์" ไม่ใช่ปัญหา — เป็นคำอธิบายว่าทำไมมีช่องว่าง และ
  // วัดบนข้อมูลจริงแล้วเข้าเงื่อนไข 71 จาก 78 ห้อง เพราะแผนปกติสั่ง 23-31 ชม.
  // จากช่องที่มี 35 ช่อง ถ้าเอามาขึ้นแถบค้างไว้ข้างบนก็เท่ากับสอนให้โรงเรียน
  // มองข้ามแถบนี้ไปเลย ซึ่งตรงข้ามกับเหตุผลที่มีมันอยู่
  if (over === 0) return null;

  // ตัวอย่างจริงหนึ่งบรรทัด ดีกว่าตัวเลขรวมลอย ๆ — เอาของหัวข้อที่หนักสุด
  const pick = (kind: "over" | "short") =>
    (rep.findings ?? []).find((f) => (f.kind ?? "over") === kind);
  const overEx = pick("over")?.examples?.[0];
  const shortEx = pick("short")?.examples?.[0];

  return (
    <div className="bg-rose-50 border-b-2 border-rose-400 px-4 py-2">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5">🧮</span>
        <div className="flex-1 min-w-0 text-rose-900">
          <p className="text-sm font-bold">
            หลักสูตรสั่งเกินกว่าคาบที่มี {over} รายการ — จะมีวิชาที่ลงไม่ครบเสมอ
            ไม่ว่าจะกดสร้างตารางใหม่อีกกี่ครั้ง
          </p>
          {overEx && (
            <p className="text-xs text-rose-800 mt-0.5 leading-relaxed">
              เช่น {overEx} — ต้องลดคาบในหลักสูตร หรือเพิ่มคาบเรียนที่ จัดการ → คาบเรียน
            </p>
          )}
          {short > 0 && shortEx && (
            <p className="text-xs text-rose-800 mt-1 leading-relaxed">
              คนละเรื่องกับช่องว่างที่เห็นในตาราง: อีก {short} ห้องมีช่องว่างเพราะ
              แผนการสอนสั่งชั่วโมงไม่เต็มสัปดาห์ ไม่ใช่เพราะลงไม่ได้ (เช่น {shortEx})
              — อันนั้นกดสร้างตารางใหม่ก็เท่าเดิม ถ้าตั้งใจให้เลิกเร็วก็ถือว่าปกติ
            </p>
          )}
          <p className="text-xs text-rose-800 mt-1">
            ดูทั้งหมดได้ที่ <span className="font-bold">จัดการ → ตรวจความจุ</span>
          </p>
        </div>
      </div>
    </div>
  );
};
