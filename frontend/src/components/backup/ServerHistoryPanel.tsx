/**
 * ประวัติย้อนหลังบนเซิร์ฟเวอร์ — the dated copies, and the way back to one.
 *
 * The server keeps one live copy and overwrites it on every save. That is a
 * one-way door: a timetable cleared by accident, a bad restore, a restart that
 * came back on the shipped data — whatever happened, the next save wrote over
 * the only copy there was. So it now also keeps a dated copy every ten minutes
 * of work, and one immediately whenever the number of คาบ falls sharply, which
 * is the save somebody will be reaching for.
 *
 * Those copies are useless if nobody can see them, so this is the list: when
 * each was taken, how many คาบ it holds, and a button. The count is the thing
 * to read — "คาบ 2,209" against "คาบ 0" says which one you want without
 * anybody having to understand what a snapshot is.
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../api/client";
import type { StateHistoryPoint } from "../../api/client";

interface Props { onRestored: () => void | Promise<void>; }

/** "วันนี้ 13:40" / "เมื่อวาน 09:12" / "9 ต.ค. 16:05" */
function whenLabel(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return `วันนี้ ${time}`;
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (sameDay(d, yest)) return `เมื่อวาน ${time}`;
  return `${d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} ${time}`;
}

export const ServerHistoryPanel = ({ onRestored }: Props) => {
  const [points, setPoints] = useState<StateHistoryPoint[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "load" | null>("load");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load"); setErr(null);
    try {
      const r = await api.fetchStateHistory();
      setAvailable(r.available);
      setReason(r.reason ?? null);
      setPoints(r.points ?? []);
    } catch {
      setAvailable(false);
      setReason("อ่านประวัติจากเซิร์ฟเวอร์ไม่ได้");
    } finally { setBusy(null); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const restore = async (p: StateHistoryPoint) => {
    setBusy(p.id); setErr(null); setNote(null);
    try {
      const r = await api.restoreStateHistory(p.id);
      await onRestored();
      setNote(`กู้คืนสำเร็จ — ห้องเรียน ${r.restored.groups ?? 0} · ครู ${r.restored.teachers ?? 0}`
        + ` · คาบในตาราง ${r.restored.slots ?? 0}`);
      setConfirmId(null);
      await load();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d ?? "กู้คืนไม่สำเร็จ");
    } finally { setBusy(null); }
  };

  if (available === false) {
    return (
      <p className="text-xs text-gray-500">
        {reason ?? "ยังไม่มีประวัติย้อนหลังบนเซิร์ฟเวอร์"}
      </p>
    );
  }

  // The best copy on the list, so the eye lands on it first.
  const most = points.reduce((n, p) => Math.max(n, p.slots ?? 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-gray-600 flex-1">
          เซิร์ฟเวอร์เก็บสำเนาตามเวลาไว้ให้เอง — เลือกเวลาที่ข้อมูลยังครบแล้วกดกู้คืนได้เลย
        </p>
        <button onClick={load} disabled={busy === "load"}
          className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">
          {busy === "load" ? "กำลังโหลด…" : "↻ โหลดใหม่"}
        </button>
      </div>

      {busy === "load" && points.length === 0 && (
        <p className="text-xs text-gray-400 py-3 text-center">กำลังอ่านประวัติ…</p>
      )}
      {busy !== "load" && points.length === 0 && (
        <p className="text-xs text-gray-400 py-3 text-center">
          ยังไม่มีสำเนาย้อนหลัง — ระบบจะเริ่มเก็บให้หลังจากนี้
        </p>
      )}

      {points.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["เวลาที่เก็บ", "คาบในตาราง", "หมายเหตุ", ""].map((h) => (
                  <th key={h} className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {points.map((p) => {
                const best = (p.slots ?? 0) === most && most > 0;
                return (
                  <tr key={p.id} className={best ? "bg-emerald-50/50" : undefined}>
                    <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{whenLabel(p.saved_at)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={(p.slots ?? 0) === 0 ? "text-red-600 font-semibold" : "text-gray-800 font-medium"}>
                        {p.slots ?? "–"}
                      </span>
                      {best && <span className="ml-1 text-[10px] text-emerald-700">มากที่สุด</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-amber-700">{p.note ?? ""}</td>
                    <td className="px-3 py-1.5 text-right">
                      {confirmId === p.id ? (
                        <span className="inline-flex gap-1">
                          <button onClick={() => restore(p)} disabled={busy === p.id}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded font-semibold disabled:opacity-40">
                            {busy === p.id ? "กำลังกู้คืน…" : "ยืนยัน แทนที่ข้อมูลทั้งหมด"}
                          </button>
                          <button onClick={() => setConfirmId(null)}
                            className="px-2 py-1 text-xs text-gray-500">ยกเลิก</button>
                        </span>
                      ) : (
                        <button onClick={() => { setConfirmId(p.id); setNote(null); setErr(null); }}
                          className="px-2 py-1 text-xs border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50">
                          กู้คืนเวลานี้
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {note && <p className="text-xs text-emerald-700">✅ {note}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <p className="text-[11px] text-gray-400">
        การกู้คืนจะแทนที่ข้อมูลทั้งหมดบนเซิร์ฟเวอร์ · สำเนาเหล่านี้อยู่ในฐานข้อมูล
        จึงไม่หายตอนอัปเดตระบบ แต่ก็ควรกดดาวน์โหลดไฟล์สำรองเก็บไว้ในเครื่องด้วย
      </p>
    </div>
  );
};
