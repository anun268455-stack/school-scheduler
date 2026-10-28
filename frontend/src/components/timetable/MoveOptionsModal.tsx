/**
 * MoveOptionsModal — "คาบนี้ย้ายไปไหนได้บ้าง"
 *
 *   "ย้ายแล้วย้ายไม่สุด คือฉันต้องย้ายคนไปเรื่อยๆ มันงงมากถ้าทำโดยมนุษย์ …
 *    คลิกคาบที่ต้องการย้ายจะมีให้ขึ้นว่าสลับไปคาบไหนง่าย ปลายกลางยาก"
 *
 * เปิดจากปุ่ม 🧭 บนคาบ แล้วหน้านี้ลองทุกช่องในสัปดาห์ให้ ช่องละหลายทาง เรียง
 * จากง่ายไปยาก แต่ละแถวมีแผนเต็มอยู่แล้ว กดครั้งเดียวทั้งชุดก็ขยับตามนั้น —
 * ไม่ต้องไปไล่เบียดคนที่ถูกเบียดต่อเอง
 *
 * กดแล้วย้อนกลับได้ด้วย Ctrl+Z เหมือนการย้ายปกติ
 */
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import { DAYS, type TimetableSlot } from "../../types";
import { useTimetableStore } from "../../store/timetableStore";
import {
  DIFFICULTY_ORDER, countByDifficulty, moveOptions,
  type MoveDifficulty, type MoveOption,
} from "../../utils/moveOptions";

interface Props {
  slot: TimetableSlot;
  onClose: () => void;
}

const TONE: Record<MoveDifficulty, string> = {
  "ง่าย":     "bg-emerald-100 text-emerald-800 border-emerald-300",
  "ปานกลาง":  "bg-amber-100 text-amber-800 border-amber-300",
  "ยาก":      "bg-orange-100 text-orange-900 border-orange-300",
  "ยากมาก":   "bg-rose-100 text-rose-900 border-rose-300",
  "ไม่ได้":    "bg-gray-100 text-gray-500 border-gray-300",
};

export const MoveOptionsModal: React.FC<Props> = ({ slot, onClose }) => {
  const slots    = useTimetableStore((s) => s.slots);
  const rooms    = useTimetableStore((s) => s.rooms);
  const teachers = useTimetableStore((s) => s.teachers);
  const periods  = useTimetableStore((s) => s.periods);
  const groups   = useTimetableStore((s) => s.groups);
  const subjects = useTimetableStore((s) => s.subjects);
  const applySwapRoute = useTimetableStore((s) => s.applySwapRoute);

  const [show, setShow] = useState<MoveDifficulty | "all">("all");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [thinking, setThinking] = useState(true);

  // คิดหลังหน้าต่างขึ้นแล้วหนึ่งจังหวะ ไม่งั้นหน้าค้างตอนเปิด
  const [result, setResult] = useState<ReturnType<typeof moveOptions> | null>(null);
  useEffect(() => {
    setThinking(true);
    const id = window.setTimeout(() => {
      setResult(moveOptions(slot, slots, rooms, teachers, periods, groups, subjects));
      setThinking(false);
    }, 30);
    return () => window.clearTimeout(id);
  }, [slot, slots, rooms, teachers, periods, groups, subjects]);

  const counts = useMemo(
    () => countByDifficulty(result?.options ?? []), [result]);
  const rows = useMemo(
    () => (result?.options ?? []).filter((o) => show === "all" || o.difficulty === show),
    [result, show]);

  const apply = async (o: MoveOption) => {
    if (!o.route) return;
    setBusy(true); setDone(null);
    try {
      await applySwapRoute(o.route);
      setDone(`ย้ายไป ${DAYS[o.day]} คาบ ${o.period} แล้ว`
        + (o.others ? ` · ขยับคาบอื่น ${o.others} คาบตามแผน` : "")
        + " — ย้อนกลับได้ด้วย Ctrl+Z");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="px-4 py-2.5 border-b border-gray-200 bg-gradient-to-r from-sky-50 to-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🧭</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-800">
              ย้าย {slot.group_name} {slot.subject_code} ไปไหนได้บ้าง
            </div>
            <div className="text-[11px] text-gray-500 truncate">
              ตอนนี้อยู่ {DAYS[slot.day]} คาบ {slot.period}
              {slot.room_name ? ` · ${slot.room_name}` : ""}
              {slot.teacher_name ? ` · ${slot.teacher_name}` : ""}
            </div>
          </div>
          <button onClick={onClose}
            className="ml-auto w-7 h-7 rounded hover:bg-gray-200 text-gray-500 shrink-0">✕</button>
        </div>
      </div>

      {done && (
        <div className="mx-4 mt-2 px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 shrink-0">
          {done}
        </div>
      )}

      <div className="px-4 py-2 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <button onClick={() => setShow("all")}
            className={clsx("px-2 py-0.5 rounded border font-semibold",
              show === "all" ? "bg-sky-600 text-white border-sky-600"
                             : "bg-white border-gray-300 text-gray-600")}>
            ทั้งหมด {result?.options.length ?? 0}
          </button>
          {DIFFICULTY_ORDER.map((d) => (
            <button key={d} onClick={() => setShow(d)} disabled={!counts[d]}
              className={clsx("px-2 py-0.5 rounded border font-semibold disabled:opacity-40",
                show === d ? "ring-2 ring-offset-1 ring-sky-400" : "", TONE[d])}>
              {d} {counts[d]}
            </button>
          ))}
          {result && (
            <span className="ml-auto text-[10px] text-gray-400">
              ลอง {result.tried} ช่อง ใน {result.ms} มิลลิวินาที
            </span>
          )}
        </div>
        <div className="mt-1 text-[10px] text-gray-500">
          แต่ละแถวมีแผนครบทั้งชุดแล้ว กดครั้งเดียวขยับตามนั้นทั้งหมด —
          ไม่ต้องไปไล่ย้ายคนที่ถูกเบียดต่อเอง และย้อนกลับได้ด้วย Ctrl+Z
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {thinking ? (
          <div className="px-4 py-10 text-center text-xs text-gray-500">
            กำลังลองทุกช่องในสัปดาห์…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-gray-500">
            ไม่มีช่องในกลุ่มนี้
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
              <tr className="text-gray-500 text-[10px]">
                <th className="px-3 py-1.5 text-left font-semibold w-28">ไปที่</th>
                <th className="px-2 py-1.5 text-left font-semibold w-20">ยากแค่ไหน</th>
                <th className="px-2 py-1.5 text-left font-semibold">ต้องทำอะไร</th>
                <th className="px-2 py-1.5 text-left font-semibold w-24">ห้อง</th>
                <th className="px-2 py-1.5 text-right font-semibold w-20"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const id = `${o.day}-${o.period}`;
                const steps = o.route?.steps ?? [];
                return (
                  <React.Fragment key={id}>
                    <tr className="border-b border-gray-100 hover:bg-sky-50/40">
                      <td className="px-3 py-1.5 whitespace-nowrap font-medium text-gray-800">
                        {DAYS[o.day]} คาบ {o.period}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={clsx("px-1.5 py-0.5 rounded border text-[10px] font-bold",
                          TONE[o.difficulty])}>
                          {o.difficulty}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700">
                        {o.why}
                        {steps.length > 1 && (
                          <button onClick={() => setOpen(open === id ? null : id)}
                            className="ml-1 text-sky-700 hover:underline">
                            {open === id ? "ซ่อนแผน" : `ดูแผน ${steps.length} ขั้น`}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600 truncate">{o.roomName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        {o.difficulty !== "ไม่ได้" && (
                          <button onClick={() => void apply(o)} disabled={busy}
                            className="px-2 py-0.5 rounded bg-sky-600 text-white font-semibold
                                       hover:bg-sky-700 disabled:bg-sky-300">
                            ย้ายไปนี่
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === id && steps.length > 0 && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={5} className="px-6 py-1.5">
                          <ol className="space-y-0.5 list-decimal list-inside text-[10px] text-gray-600">
                            {steps.map((st, i) => (
                              <li key={i}>
                                {st.label} · {DAYS[st.fromDay]} คาบ {st.fromPeriod}
                                {" → "}{DAYS[st.toDay]} คาบ {st.toPeriod}
                                {st.roomChanged && ` · ห้อง ${st.toRoomName ?? "ยังไม่มี"}`}
                                {st.noRoomAvailable && (
                                  <span className="text-rose-700"> · หาห้องว่างให้ไม่ได้</span>
                                )}
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 shrink-0 flex items-center gap-2">
        <span className="text-[10px] text-gray-500">
          "ไม่ได้" คือช่องที่ลงได้ก็ต่อเมื่อลบคาบของคนอื่นทิ้ง จึงไม่เสนอให้
        </span>
        <button onClick={onClose}
          className="ml-auto px-2.5 py-1 text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-100">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
