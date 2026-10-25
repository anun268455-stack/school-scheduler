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
              : data.total === 0
              ? "ทุกอย่างอยู่ในวิสัยที่จัดลงได้"
              : `พบ ${data.total} รายการที่เกินกว่าที่มี`}
            {data != null
              && ` · ห้องหนึ่งห้องรับได้ ${data.room_week_capacity} คาบ/สัปดาห์`}
          </p>
        </div>
        <button onClick={onClose}
          className="text-slate-300 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {err != null && <p className="text-xs text-red-700">{err}</p>}

        {data != null && data.total === 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
            ✓ หลักสูตรของทุกห้องพอดีกับคาบที่มี ห้องประจำวิชาทุกห้องรับไหว และ
            ไม่มีครูที่ชั่วโมงเกินเวลาตัวเอง — ถ้าตารางยังออกมาไม่ดี ปัญหาอยู่ที่
            การจัดวาง ไม่ใช่ที่จำนวนของ
          </div>
        )}

        {data != null && data.total > 0 && (
          <p className="text-[11px] text-slate-600 leading-relaxed">
            ทุกบรรทัดข้างล่างคือส่วนที่<b>เกินกว่าที่มี</b> ไม่ใช่เรื่องที่วิธีจัด
            ตารางจะแก้ได้ — กดสร้างตารางใหม่อีกกี่ครั้งส่วนเกินก็ยังอยู่ ต้องลดของ
            ที่สั่ง หรือเพิ่มของที่มี อย่างใดอย่างหนึ่ง
          </p>
        )}

        {findings.map((f) => {
          const isOpen = open === f.code;
          const worst = f.rows.reduce((n, r) => Math.max(n, r.over), 0);
          return (
            <div key={f.code} className="border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : f.code)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold
                                 bg-rose-100 text-rose-800">
                  {f.count}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-gray-800">{f.title}</span>
                  <span className="block text-[11px] text-gray-500">{f.why}</span>
                </span>
                <span className="shrink-0 text-[10px] text-rose-700 font-semibold">
                  เกินมากสุด {worst} คาบ
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
                        <th className="py-1 font-semibold text-right">รับได้</th>
                        <th className="py-1 font-semibold text-right">เกิน</th>
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
                          <td className="py-1 text-right tabular-nums font-bold text-rose-700">
                            +{r.over}
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
