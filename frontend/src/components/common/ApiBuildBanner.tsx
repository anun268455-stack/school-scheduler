/**
 * แถบที่บอกว่าตัวจัดตารางบนเซิร์ฟเวอร์ยังเป็นรุ่นเก่า
 *
 * ระบบนี้อยู่สองที่: หน้าเว็บอยู่บน GitHub Pages ตัวจัดตารางอยู่บน Render และ
 * ทั้งสองที่อัปเดตแยกกัน หน้าเว็บจึงใหม่ได้ทั้งที่ตัวจัดตารางยังเป็นรุ่นเก่า
 * ซึ่งเป็นอาการที่มองไม่เห็นเลยจากในแอป: ข้อความ ปุ่ม ป้ายเตือน เปลี่ยนไปหมด
 * แล้ว — แต่ตารางที่กดสร้างออกมายังเป็นของตัวจัดตารางรุ่นเดิม คนจึงเห็นว่า
 * "แก้แล้วแต่ยังเหมือนเดิม" และกดสร้างตารางซ้ำอยู่อย่างนั้น
 *
 * เลขรุ่นของสองที่นี้ขยับพร้อมกันทุกครั้ง ไม่ตรงกันจึงหมายถึงมีฝั่งหนึ่งยัง
 * ไม่ได้อัปเดต — พูดออกมาตรง ๆ ตรงนี้ พร้อมบอกว่าต้องทำอะไร
 */
import { useEffect, useState } from "react";
import { checkApiBuild, type ApiBuildCheck } from "../../api/client";

/** ถามใหม่เรื่อย ๆ เพื่อให้แถบนี้หายไปเองเมื่อเซิร์ฟเวอร์อัปเดตเสร็จ */
const CHECK_MS = 60 * 1000;

export const ApiBuildBanner = () => {
  const [check, setCheck] = useState<ApiBuildCheck | null>(null);

  useEffect(() => {
    let stop = false;
    const look = async () => {
      try {
        const c = await checkApiBuild();
        if (!stop) setCheck(c);
      } catch {
        /* ต่อเซิร์ฟเวอร์ไม่ได้เป็นเรื่องของป้ายสถานะการเชื่อมต่อ ไม่ใช่ของแถบนี้ */
      }
    };
    void look();
    const id = setInterval(look, CHECK_MS) as unknown as number;
    return () => { stop = true; clearInterval(id); };
  }, []);

  if (!check || check.ok) return null;

  return (
    <div className="bg-rose-50 border-b-2 border-rose-400 px-4 py-2">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5">🚧</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-rose-900">
            ตัวจัดตารางบนเซิร์ฟเวอร์ยังเป็นรุ่นเก่า — ที่แก้ไปยังไม่มีผลกับตารางที่กดสร้าง
          </p>
          <p className="text-xs text-rose-800 mt-0.5 leading-relaxed">
            หน้าเว็บกับตัวจัดตารางอยู่คนละที่และอัปเดตแยกกัน ตอนนี้หน้าเว็บเป็นรุ่น{" "}
            <span className="font-mono font-bold">{check.expected}</span> แต่ตัวจัดตารางที่รันอยู่เป็นรุ่น{" "}
            <span className="font-mono font-bold">{check.server ?? "เก่ากว่านั้น (ไม่บอกรุ่น)"}</span> —
            กดสร้างตารางตอนนี้จะได้ผลของรุ่นเก่า ไม่ใช่ที่แก้ล่าสุด
          </p>
          <p className="text-xs text-rose-800 mt-1 leading-relaxed">
            ปกติรออีก 2–5 นาทีแล้วแถบนี้จะหายไปเอง (ไม่ต้องรีเฟรช) ถ้ายังไม่หาย
            ให้เข้า Render → เลือกเซิร์ฟเวอร์ school-scheduler-api → Manual Deploy →
            Deploy latest commit แล้วรอจน Live
          </p>
        </div>
      </div>
    </div>
  );
};
