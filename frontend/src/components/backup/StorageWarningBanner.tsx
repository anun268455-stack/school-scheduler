/**
 * The strip that says the server is not keeping anything.
 *
 * The school kept losing their timetable to restarts and could not see why,
 * because from inside the app a server storing nothing looks exactly like one
 * storing everything — right up until it restarts. The reason is one line in
 * /api/state/info, and until now that line was three clicks away on a screen
 * nobody opens until after the damage.
 *
 * So it is said here instead, across the top, and it cannot be dismissed:
 * saving more often does not help if nothing on the server survives the night,
 * and the school should be told which of the two problems they have.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/client";

type Info = Awaited<ReturnType<typeof api.fetchStateInfo>>;

/** Re-check now and then, so fixing it makes the strip disappear on its own. */
const CHECK_MS = 3 * 60 * 1000;

export const StorageWarningBanner = () => {
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    let stop = false;
    const look = async () => {
      try {
        const i = await api.fetchStateInfo();
        if (!stop) setInfo(i);
      } catch { /* offline is the sync chip's job to report, not this one's */ }
    };
    void look();
    const id = setInterval(look, CHECK_MS) as unknown as number;
    return () => { stop = true; clearInterval(id); };
  }, []);

  if (!info) return null;

  // Four different problems, four different things to do about them.
  const noDatabase   = info.store_configured === false;
  const cannotReach  = info.store_configured === true && info.store !== "postgres";
  const writeBlocked = info.write_blocked === true;
  // Connected, but the writes themselves are failing. This one is the quiet
  // one: everything on screen looks normal and nothing is being kept.
  const writeFailing = info.store === "postgres" && !!info.store_error;
  if (!noDatabase && !cannotReach && !writeBlocked && !writeFailing) return null;

  const [title, body] = writeFailing
    ? ["บันทึกลงฐานข้อมูลไม่สำเร็จ — งานที่ทำหลังจากนี้อาจหาย",
       `ต่อฐานข้อมูลได้แต่เขียนไม่ผ่าน (${info.store_error}) ระบบกำลังลองใหม่เรื่อย ๆ `
       + "และเก็บสำเนาไว้ในเบราว์เซอร์นี้ให้ — กรุณากดดาวน์โหลดไฟล์สำรองเก็บไว้ตอนนี้ "
       + "ที่ จัดการ → สำรองและกู้คืนข้อมูล"]
    : writeBlocked
    ? ["เซิร์ฟเวอร์หยุดบันทึกไว้ เพื่อไม่ให้ทับข้อมูลเดิมของโรงเรียน",
       "เซิร์ฟเวอร์กลับมาด้วยข้อมูลตั้งต้น แต่ข้อมูลจริงยังอยู่ในฐานข้อมูล จึงยังไม่บันทึกทับให้ "
       + "— ไปที่ จัดการ → สำรองและกู้คืนข้อมูล → ประวัติย้อนหลังบนเซิร์ฟเวอร์ แล้วกู้คืนเวลาที่ข้อมูลยังครบ"]
    : noDatabase
    ? ["เซิร์ฟเวอร์ยังไม่ได้ต่อฐานข้อมูล — ข้อมูลจะหายทุกครั้งที่ระบบรีสตาร์ท",
       "ตอนนี้บันทึกลงไฟล์ในเครื่องเซิร์ฟเวอร์เท่านั้น ซึ่งหายไปพร้อมกับการรีสตาร์ท "
       + "ต้องตั้งค่า DATABASE_URL ในหน้า Environment ของ Render ก่อน จึงจะเก็บข้อมูลได้จริง "
       + "ระหว่างนี้ระบบยังเก็บสำเนาในเบราว์เซอร์นี้ให้ทุกครั้งที่แก้ไข"]
    : ["ต่อฐานข้อมูลไม่ได้ — ตอนนี้ข้อมูลจะหายเมื่อระบบรีสตาร์ท",
       `ตั้งค่าฐานข้อมูลไว้แล้วแต่เชื่อมต่อไม่สำเร็จ จึงบันทึกลงไฟล์ชั่วคราวแทน`
       + (info.store_error ? ` (${info.store_error})` : "")
       + " ระหว่างนี้ระบบยังเก็บสำเนาในเบราว์เซอร์นี้ให้ทุกครั้งที่แก้ไข"];

  return (
    <div className="bg-amber-50 border-b-2 border-amber-400 px-4 py-2">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-900">{title}</p>
          <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
};
