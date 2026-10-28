/**
 * ป้ายเตือนแบบเล็ก บนแถบเครื่องมือ
 *
 *   "เอาแถบข้างบนออก"
 *
 * เดิมเรื่องพวกนี้เป็นแถบเต็มความกว้างซ้อนกันสามแถบ กินพื้นที่เกินครึ่งจอเหนือ
 * ตาราง ซึ่งกลายเป็นว่าของที่สร้างมาเพื่อ "ให้เห็น" ไปบังของจริงที่ต้องดู
 *
 * ย้ายมาเป็นป้ายเล็กข้างปุ่มเซฟ กดแล้วค่อยกางรายละเอียด — ข้อมูลยังอยู่ครบ
 * แต่ไม่แย่งที่ของตาราง และเงียบสนิทเมื่อไม่มีอะไรผิด
 */
import { useEffect, useState } from "react";
import { buildAdvice, compareBuild } from "../../utils/apiBuild";
import clsx from "clsx";
import * as api from "../../api/client";

type Build = Awaited<ReturnType<typeof api.checkApiBuild>>;
type Cap = Awaited<ReturnType<typeof api.fetchCapacity>>;

const CHECK_MS = 2 * 60 * 1000;

export const AlertChips = () => {
  const [build, setBuild] = useState<Build | null>(null);
  const [cap, setCap] = useState<Cap | null>(null);
  const [open, setOpen] = useState<"build" | "cap" | null>(null);

  useEffect(() => {
    let stop = false;
    const look = async () => {
      try {
        const b = await api.checkApiBuild();
        if (!stop) setBuild(b);
      } catch { /* ป้ายสถานะการเชื่อมต่อรายงานเรื่องออฟไลน์อยู่แล้ว */ }
      try {
        const c = await api.fetchCapacity();
        if (!stop) setCap(c);
      } catch { /* เหมือนกัน */ }
    };
    void look();
    const id = setInterval(look, CHECK_MS) as unknown as number;
    return () => { stop = true; clearInterval(id); };
  }, []);

  const stale = build != null && !build.ok;
  // ไม่ตรงกันมีสองแบบที่แก้คนละวิธี — ต้องบอกให้ถูกฝั่ง ไม่งั้นคนใช้จะไปสั่ง
  // ติดตั้งเซิร์ฟเวอร์ซ้ำ ๆ ทั้งที่ของที่ค้างคือหน้าเว็บตรงหน้า
  const advice = buildAdvice(
    build ? compareBuild(build.server, build.expected) : "unknown");
  const over = cap?.total ?? 0;
  if (!stale && over === 0) return null;

  const chip = "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors";

  return (
    <>
      {stale && (
        <button
          type="button"
          onClick={() => setOpen(open === "build" ? null : "build")}
          title={`${advice.title} — กดดูวิธีแก้`}
          className={clsx(chip, "bg-orange-900/40 border-orange-600 text-orange-300 hover:text-orange-100")}
        >
          {advice.chip}
        </button>
      )}
      {over > 0 && (
        <button
          type="button"
          onClick={() => setOpen(open === "cap" ? null : "cap")}
          title="หลักสูตรสั่งเกินกว่าคาบที่มี — กดดูรายละเอียด"
          className={clsx(chip, "bg-rose-900/40 border-rose-700 text-rose-300 hover:text-rose-100")}
        >
          🧮 คาบไม่พอ ·{over}
        </button>
      )}

      {open === "build" && build && (
        <div className="absolute right-2 top-full mt-1 z-50 w-[22rem] bg-gray-800 border border-orange-700 rounded-lg shadow-xl p-3 text-[11px] leading-relaxed text-orange-100">
          <p className="font-bold text-orange-300">{advice.title}</p>
          <p className="mt-1">
            หน้าเว็บเป็นรุ่น <span className="font-mono font-bold">{build.expected}</span>{" "}
            ส่วนตัวจัดตารางที่รันอยู่เป็นรุ่น{" "}
            <span className="font-mono font-bold">{build.server ?? "เก่ากว่านั้น"}</span>
          </p>
          <p className="mt-1">{advice.how}</p>
        </div>
      )}
      {open === "cap" && cap && (
        <div className="absolute right-2 top-full mt-1 z-50 w-[22rem] bg-gray-800 border border-rose-700 rounded-lg shadow-xl p-3 text-[11px] leading-relaxed text-rose-100">
          <p className="font-bold text-rose-300">
            หลักสูตรสั่งเกินกว่าคาบที่มี {over} รายการ
          </p>
          <p className="mt-1">
            จะมีวิชาที่ลงไม่ครบเสมอ ไม่ว่าจะกดสร้างตารางใหม่อีกกี่ครั้ง
            — ต้องลดคาบในหลักสูตร หรือเพิ่มคาบเรียนที่ จัดการ → คาบเรียน
          </p>
          {(cap.findings ?? [])
            .filter((f) => (f.kind ?? "over") === "over")
            .slice(0, 1)
            .map((f) => (
              <p key={f.code} className="mt-1 text-rose-200/80">เช่น {f.examples?.[0]}</p>
            ))}
          <p className="mt-1 text-rose-200/80">
            ดูทั้งหมดได้ที่ จัดการ → ตรวจความจุ
          </p>
        </div>
      )}
    </>
  );
};
