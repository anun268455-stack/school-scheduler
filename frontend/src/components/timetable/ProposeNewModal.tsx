/**
 * ProposeNewModal — ปุ่มตรวจคาบ: ลองจัดตารางใหม่ทั้งโรงเรียนด้วยเครื่องตัวใหม่
 *
 *   "ลองทำระบบใหม่ สูตรใหม่เพื่อปรับปรุงการลงตารางครั้งหน้า ... ลงไปแล้วเก็บ
 *    ข้อมูลเอาไว้ แล้วลงใหม่ ... เหมือนเวลาหาทางออกจากเขาวงกต ... ทั้งหมดนี้
 *    อาจจะทำเป็นปุ่มตรวจคาบ นานก็ได้"
 *
 * หน้านี้ไม่แตะตารางที่ใช้อยู่เลยแม้แต่คาบเดียว ("ตอนนี้คาบโอเคแล้ว ห้ามยุ่ง")
 * มันบอกแค่ว่า "ถ้าจัดใหม่ตั้งแต่ต้นจะได้ตารางหน้าตาอย่างไร" เพื่อเอาไว้
 * ตัดสินใจตอนจัดตารางเทอมหน้า
 *
 * งานกินเวลาเป็นนาที จึงเริ่มงานฝั่งเซิร์ฟเวอร์แล้วถามความคืบหน้าทุกสองวินาที
 */
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";

interface Props {
  onClose: () => void;
}

/** ตัวเลขที่น้อยกว่าดีกว่าทุกตัวในตารางนี้ */
const ROWS: {
  key: keyof api.ScheduleQuality;
  label: string;
  hint: string;
}[] = [
  { key: "gaps", label: "คาบว่างคั่นกลางวันของนักเรียน",
    hint: "เรียน-ว่าง-เรียน ในวันเดียว หัวท้ายว่างไม่นับ" },
  { key: "heavy_days", label: "ครู-วัน ที่สอนเกิน 6 คาบ",
    hint: "นับเป็นครูหนึ่งคนต่อหนึ่งวัน" },
  { key: "long_runs", label: "คาบที่ทำให้ครูสอนติดกันเกิน 3",
    hint: "คาบที่เลยคาบที่สามของช่วงติดกัน" },
  { key: "clash_teacher", label: "ครูอยู่สองที่พร้อมกัน", hint: "" },
  { key: "clash_room", label: "ห้องถูกใช้ซ้อนกัน", hint: "" },
  { key: "clash_group", label: "ชั้นเรียนซ้อนกัน", hint: "" },
  { key: "no_room", label: "คาบที่ไม่ได้ห้อง", hint: "" },
];

export const ProposeNewModal: React.FC<Props> = ({ onClose }) => {
  const [job, setJob] = useState<string | null>(null);
  const [row, setRow] = useState<api.ProposeJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(2);
  const [keepAct, setKeepAct] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current != null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    setErr(null);
    setRow(null);
    setElapsed(0);
    try {
      const total = Math.round(minutes * 60);
      const started = await api.proposeNewStart({
        // สองในสามไว้หาทางลง หนึ่งในสามไว้ขยับให้สวย
        budget_s: Math.round(total * 0.67),
        polish_s: total - Math.round(total * 0.67),
        keep_activity_time: keepAct,
      });
      setJob(started.job);
      const t0 = Date.now();
      timer.current = window.setInterval(() => {
        setElapsed(Math.round((Date.now() - t0) / 1000));
        api.proposeNewStatus(started.job)
          .then((r) => {
            setRow(r);
            if (r.state !== "running") stop();
          })
          .catch((e) => {
            stop();
            setErr(api.errorDetail(e, "ถามความคืบหน้าไม่สำเร็จ"));
          });
      }, 2000);
    } catch (e) {
      setErr(api.errorDetail(e, "เริ่มงานไม่สำเร็จ"));
    }
  };

  const s = row?.summary;
  const running = row?.state === "running" || (job != null && row == null);

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="px-4 py-2.5 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🧪</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-800">
              ลองจัดตารางใหม่ทั้งโรงเรียน (เครื่องตัวใหม่)
            </div>
            <div className="text-[11px] text-gray-500">
              ตารางที่ใช้อยู่ไม่ถูกแตะเลย — หน้านี้บอกแค่ว่าถ้าจัดใหม่ตั้งแต่ต้นจะได้อะไร
            </div>
          </div>
          <button onClick={onClose}
            className="ml-auto w-7 h-7 rounded hover:bg-gray-200 text-gray-500 shrink-0">✕</button>
        </div>
      </div>

      {err && (
        <div className="mx-4 mt-2 px-3 py-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800 shrink-0">
          {err}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {/* ── ตั้งค่าแล้วเริ่ม ── */}
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-2">
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            <label className="flex items-center gap-1.5">
              ให้เวลาคิด
              <select value={minutes} disabled={running}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="border border-gray-300 rounded px-1.5 py-0.5 bg-white disabled:bg-gray-100">
                {[1, 2, 5, 10].map((m) => (
                  <option key={m} value={m}>{m} นาที</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={keepAct} disabled={running}
                onChange={(e) => setKeepAct(e.target.checked)}
                className="accent-indigo-600" />
              คาบกิจกรรมอยู่วันเดิมเวลาเดิม
            </label>
            <button onClick={() => void start()} disabled={running}
              className="ml-auto px-3 py-1 rounded bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:bg-indigo-300">
              {running ? "กำลังคิด…" : s ? "ลองอีกครั้ง" : "เริ่มลองจัด"}
            </button>
          </div>
          <div className="text-[10px] text-gray-500">
            ให้เวลามากขึ้นได้ตารางแน่นขึ้น เครื่องจะลองลงแล้วถอยแล้วลองใหม่เรื่อย ๆ
            และจำทางที่ตันไว้ไม่ให้เดินซ้ำ ยิ่งคิดนานยิ่งเจอทางที่ลงตัวกว่า
          </div>
        </div>

        {running && (
          <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-3 text-center space-y-1">
            <div className="text-xs font-semibold text-indigo-900">
              {row?.message ?? "กำลังเริ่ม"}
            </div>
            <div className="text-[11px] text-indigo-700">
              ผ่านไป {elapsed} วินาที — ปิดหน้านี้ไปทำอย่างอื่นได้
              แล้วกลับมาเปิดใหม่ทีหลัง
            </div>
          </div>
        )}

        {row?.state === "error" && (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
            เครื่องทำงานไม่สำเร็จ: {row.message}
          </div>
        )}

        {s && (
          <>
            {/* ── เทียบกันตรง ๆ ── */}
            <div>
              <div className="text-[11px] font-bold text-gray-700 mb-1">
                เทียบกับตารางที่ใช้อยู่ — น้อยกว่าดีกว่าทุกบรรทัด
              </div>
              <table className="w-full text-[11px]">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr className="text-gray-500 text-[10px]">
                    <th className="px-2 py-1.5 text-left font-semibold">เรื่อง</th>
                    <th className="px-2 py-1.5 text-right font-semibold w-24">ที่ใช้อยู่</th>
                    <th className="px-2 py-1.5 text-right font-semibold w-24">ข้อเสนอ</th>
                    <th className="px-2 py-1.5 text-right font-semibold w-20">ต่างกัน</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(({ key, label, hint }) => {
                    const a = s.now[key];
                    const b = s.proposed[key];
                    const d = b - a;
                    return (
                      <tr key={key} className="border-b border-gray-100">
                        <td className="px-2 py-1.5">
                          <div className="text-gray-800">{label}</div>
                          {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{a}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-800">{b}</td>
                        <td className={clsx("px-2 py-1.5 text-right tabular-nums font-semibold",
                          d < 0 ? "text-emerald-700" : d > 0 ? "text-rose-700" : "text-gray-400")}>
                          {d === 0 ? "เท่ากัน" : d > 0 ? `+${d}` : d}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── ลงได้ครบไหม ── */}
            <div className="rounded border border-gray-200 px-3 py-2 space-y-1.5">
              <div className="text-[11px] text-gray-700">
                ข้อเสนอลงได้ <b>{s.placed}</b> จาก <b>{s.units}</b> คาบที่หลักสูตรขอ
                {s.unplaced > 0 && <> · ลงไม่ได้ <b className="text-amber-700">{s.unplaced}</b></>}
                {" "}· คิดไป {s.restarts} รอบ ใน {s.seconds} วินาที
              </div>
              <div className="text-[10px] text-gray-500">
                รอบขยับให้สวยย้าย {s.polish_moves} คาบ ทำให้คาบว่างคั่นกลางวันลดจาก{" "}
                {s.gaps_before} เหลือ {s.gaps_after}
                {" "}· หน้าต่างกิจกรรม {s.activity_windows} หน้าต่าง
                {s.kept_activity_time ? " (อยู่วันเดิมเวลาเดิม)" : " (ให้เครื่องเลือกเวลาเอง)"}
              </div>

              {s.over_capacity.length > 0 && (
                <div className="mt-1 rounded bg-amber-50 border border-amber-200 px-2 py-1.5">
                  <div className="text-[11px] font-semibold text-amber-900">
                    ห้องที่หลักสูตรขอคาบไว้เกินช่องที่มีจริง — ส่วนนี้ไม่มีเครื่องไหนแก้ได้
                  </div>
                  <div className="text-[10px] text-amber-800 mt-0.5">
                    ต้องลดคาบในหลักสูตร หรือเพิ่มคาบเรียนในตารางเวลา
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {s.over_capacity.map((o) => (
                      <li key={o.group_id} className="text-[11px] text-amber-900">
                        {o.group_name ?? `ห้อง #${o.group_id}`}: ขอ {o.want} คาบ
                        มีช่องให้ลงจริง {o.cap} — <b>เกิน {o.over} คาบ</b>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {s.unplaced_labels.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[11px] text-gray-600 cursor-pointer hover:text-gray-800">
                    ดูคาบที่ลงไม่ได้ ({s.unplaced_labels.length} รายการแรก)
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.unplaced_labels.map((l, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] text-gray-700">
                        {l}
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </>
        )}
      </div>

      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 shrink-0 flex items-center gap-2">
        <span className="text-[10px] text-gray-500">
          หน้านี้อ่านอย่างเดียว ตารางที่ใช้อยู่ไม่ถูกเขียนทับแม้แต่คาบเดียว
        </span>
        <button onClick={onClose}
          className="ml-auto px-2.5 py-1 text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-100">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
