/**
 * ตรวจว่าของที่สั่งไว้ใส่ลงได้ไหม — demand against supply, before any solve.
 *
 * เวลาตารางออกมาไม่พอดี สิ่งแรกที่ทุกคนมองคือวิธีจัด แต่หลายครั้งมันไม่ใช่วิธีจัด
 * ที่ลงให้ไม่ได้ — มันคือของที่สั่งไว้เกินกว่าที่โรงเรียนมี และไม่มีวิธีจัดแบบไหน
 * ที่ใส่ 92 คาบลงในห้องที่มี 35 ช่องได้ กดจัดใหม่อีกสิบครั้งก็เท่าเดิม
 *
 * So this page counts both sides and puts them next to each other: periods the
 * curriculum asks for against cells the week has, hours bound to a room against
 * hours that room has, a teacher's load against their own week. Whatever is
 * over is what will surface later as คาบสุดท้าย, คาบไม่มีห้อง or คาบที่ลงไม่ครบ
 * — and it is cheaper to see here, before pressing สร้างตาราง, than to read it
 * off a finished grid and wonder which rule went wrong.
 *
 * Read-only: it changes nothing. Each section says what to change, because the
 * decision (fewer periods, another room, let the last period be used) belongs
 * to the school, not to this screen.
 */
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";

/** ชื่อที่จะโชว์ในคอลัมน์แรกของแต่ละแถว — ห้องเรียน ครู หรือกลุ่มห้อง */
const rowLabel = (r: api.CapacityRow): string => {
  if (r.rooms && r.rooms.length > 0) {
    return r.rooms.length === 1
      ? `${r.rooms[0]} (ห้องเดียว)`
      : `${r.rooms.length} ห้อง: ${r.rooms.join(", ")}`;
  }
  return r.name ?? "—";
};

export const CapacityModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [data, setData] = useState<api.CapacityReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.fetchCapacity().then((d) => {
      setData(d);
      // เปิดหัวข้อที่เกินมากที่สุดไว้เลย ไม่ต้องให้กดหา
      const worst = d.findings[0];
      if (worst) setOpen(worst.code);
    }).catch(() => setErr("ตรวจไม่สำเร็จ — ลองใหม่อีกครั้ง"));
  }, []);

  const findings = data?.findings ?? [];
  // ห้องที่แผนการสอนสั่งไม่เต็มสัปดาห์ — นับแยกจากส่วนเกิน เพราะไม่ใช่ปัญหา
  // ของการจัดตาราง และคำแนะนำที่ต้องให้ก็ตรงกันข้ามกัน
  const short = data?.short_total ?? 0;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="flex items-center gap-3 bg-slate-700 px-5 py-4 shrink-0">
        <span className="text-2xl">⚖️</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            ตรวจว่าของที่สั่งไว้ใส่ลงได้ไหม
          </h2>
          <p className="text-slate-200 text-xs mt-0.5">
            {data == null
              ? "กำลังตรวจ…"
              : data.total === 0 && short === 0
              ? "ทุกอย่างอยู่ในวิสัยที่จัดลงได้"
              : [data.total > 0 ? `พบ ${data.total} รายการที่เกินกว่าที่มี` : null,
                 short > 0 ? `${short} ห้องที่แผนการสอนสั่งไม่เต็มสัปดาห์` : null]
                .filter(Boolean).join(" · ")}
            {data != null
              && ` · ห้องหนึ่งห้องรับได้ ${data.room_week_capacity} คาบ/สัปดาห์`}
          </p>
        </div>
        <button onClick={onClose}
          className="text-slate-300 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {err != null && <p className="text-xs text-red-700">{err}</p>}

        {data != null && data.total === 0 && short === 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
            ✓ หลักสูตรของทุกห้องพอดีกับคาบที่มี ห้องประจำวิชาทุกห้องรับไหว และ
            ไม่มีครูที่ชั่วโมงเกินเวลาตัวเอง — ถ้าตารางยังออกมาไม่ดี ปัญหาอยู่ที่
            การจัดวาง ไม่ใช่ที่จำนวนของ
          </div>
        )}

        {/* คำตอบของคำถามที่ถามซ้ำมาหลายรอบว่า "มีคาบว่าง แต่ลงคาบไม่ได้"
            กล่องเขียวเดิมบอกว่า "ถ้าตารางยังออกมาไม่ดี ปัญหาอยู่ที่การจัดวาง"
            ซึ่งพาไปผิดทางเต็มที่ เมื่อความจริงคือแผนการสอนสั่งชั่วโมงไม่เต็ม
            สัปดาห์ แล้วไม่มีอะไรบนจอบอกเรื่องนี้เลย */}
        {data != null && short > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <b>คาบว่างมีสองแบบ และแก้คนละทาง</b>
            <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed list-disc pl-4">
              <li>
                <b>ลงไม่ได้</b> — มีวิชาที่ต้องลง แต่หาที่ลงไม่ได้ อันนี้เป็นเรื่อง
                ของตัวจัดตาราง
              </li>
              <li>
                <b>ไม่มีอะไรจะลง</b> — แผนการสอนสั่งชั่วโมงน้อยกว่าช่องที่มี ช่องที่
                เหลือจึงว่างเพราะไม่มีวิชาไหนขอใช้ กดสร้างตารางใหม่อีกกี่ครั้งก็
                เท่าเดิม ต้องไปเพิ่มชั่วโมงที่<b>แผนการสอน</b>
              </li>
            </ul>
            <p className="mt-1.5 text-[12px]">
              ตอนนี้มี <b>{short} ห้อง</b> ที่เป็นแบบที่สอง — ดูรายละเอียดใน
              หัวข้อสีเหลืองข้างล่าง (ถ้าตั้งใจให้นักเรียนเลิกเร็ว ก็ถือว่าปกติ
              ไม่ต้องแก้)
            </p>
          </div>
        )}

        {data != null && data.total > 0 && (
          <p className="text-[11px] text-slate-600 leading-relaxed">
            หัวข้อ<b className="text-rose-700">สีแดง</b>คือส่วนที่<b>เกินกว่าที่มี</b>{" "}
            ไม่ใช่เรื่องที่วิธีจัดตารางจะแก้ได้ — กดสร้างตารางใหม่อีกกี่ครั้งส่วนเกิน
            ก็ยังอยู่ ต้องลดของที่สั่ง หรือเพิ่มของที่มี อย่างใดอย่างหนึ่ง
            {short > 0 && <> ส่วนหัวข้อ<b className="text-amber-700">สีเหลือง</b>
              คือส่วนที่<b>ขาด</b> ซึ่งเป็นเรื่องตรงกันข้าม</>}
          </p>
        )}

        {findings.map((f) => {
          const isOpen = open === f.code;
          // หัวข้อ "ขาด" ใช้ช่อง short ไม่ใช่ over และไม่ใช่ความผิดพลาด จึง
          // ใช้สีเหลืองไม่ใช่สีแดง และพูดว่า "ว่าง" ไม่ใช่ "เกิน"
          const isShort = f.kind === "short";
          const amount  = (r: api.CapacityRow) => (isShort ? r.short : r.over) ?? 0;
          const worst   = f.rows.reduce((n, r) => Math.max(n, amount(r)), 0);
          return (
            <div key={f.code} className="border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : f.code)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                <span className={clsx("shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold",
                  isShort ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800")}>
                  {f.count}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-gray-800">{f.title}</span>
                  <span className="block text-[11px] text-gray-500">{f.why}</span>
                </span>
                <span className={clsx("shrink-0 text-[10px] font-semibold",
                  isShort ? "text-amber-700" : "text-rose-700")}>
                  {isShort ? `ว่างมากสุด ${worst} คาบ` : `เกินมากสุด ${worst} คาบ`}
                </span>
                <span className="text-gray-400 text-xs shrink-0">{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 pt-1 bg-gray-50/60 border-t border-gray-100 space-y-2">
                  <table className="w-full text-[11px] table-fixed">
                    <colgroup>
                      <col style={{ width: "52%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "16%" }} />
                    </colgroup>
                    <thead>
                      <tr className="text-gray-500 text-left">
                        <th className="py-1 font-semibold">ที่ไหน</th>
                        <th className="py-1 font-semibold text-right">สั่งไว้</th>
                        <th className="py-1 font-semibold text-right">
                          {isShort ? "ช่องที่มี" : "รับได้"}
                        </th>
                        <th className="py-1 font-semibold text-right">
                          {isShort ? "ว่างแน่ๆ" : "เกิน"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.rows.map((r, i) => (
                        <tr key={i} className={clsx("border-t border-gray-200",
                          i % 2 === 1 && "bg-white/60")}>
                          <td className="py-1 pr-2 text-gray-800">
                            <span className="block">{rowLabel(r)}</span>
                            {r.subjects != null && r.subjects.length > 0 && (
                              <span className="block text-[10px] text-gray-500 truncate">
                                {r.source === "subject"
                                  ? `วิชาที่ตั้งห้องนี้เป็นห้องประจำวิชา ${r.subjects.length} รายการ: `
                                  : r.departments != null && r.departments.length > 0
                                  ? `เป็นห้องของ${r.departments.join("/")} · วิชา ${r.subjects.length} รายการ: `
                                  : `วิชา ${r.subjects.length} รายการ: `}
                                {r.subjects.slice(0, 6).join(", ")}
                                {r.subjects.length > 6 ? "…" : ""}
                              </span>
                            )}
                            {r.before_last_num != null && (
                              <span className="block text-[10px] text-gray-500">
                                นับคาบ 1 ถึงคาบ {r.before_last_num} — คาบ{" "}
                                {r.last_period_num} เก็บไว้ใช้เมื่อจำเป็น
                              </span>
                            )}
                          </td>
                          <td className="py-1 text-right tabular-nums text-gray-700">{r.need}</td>
                          <td className="py-1 text-right tabular-nums text-gray-700">{r.capacity}</td>
                          <td className={clsx("py-1 text-right tabular-nums font-bold",
                            isShort ? "text-amber-700" : "text-rose-700")}>
                            {isShort ? `−${r.short ?? 0}` : `+${r.over ?? 0}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {f.fix != null && f.fix !== "" && (
                    <p className="text-[11px] text-slate-700 bg-white border border-slate-200
                                  rounded px-2 py-1.5">
                      <b>ทางแก้:</b> {f.fix}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
};
