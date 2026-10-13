/**
 * ตรวจความสอดคล้องของข้อมูล — where the data has come apart from itself.
 *
 * The school's data says the same thing in more than one place on purpose: a
 * class names its ห้องประจำชั้น and the room names its class; a lesson in the
 * timetable carries the teacher's NAME as well as their id, so a printed sheet
 * needs nothing else. That is fine while the two agree — and nothing was
 * checking that they still did. A rename here, a delete there, and the halves
 * drift apart silently; the only way to find out was for a timetable to come
 * out wrong weeks later.
 *
 * So this asks every one of those questions at once, says what it found in
 * plain words, and — only where the answer is not a judgement call — offers to
 * put it right. Anything it cannot answer for the school, it leaves alone and
 * says so.
 */
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";

export const ConsistencyModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { loadAll } = useTimetableStore();
  const [data, setData] = useState<api.ConsistencyReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = () => {
    setData(null); setErr(null);
    api.fetchConsistency().then(setData)
      .catch(() => setErr("ตรวจไม่สำเร็จ — ลองใหม่อีกครั้ง"));
  };
  useEffect(load, []);

  const repair = async (codes?: string[]) => {
    setBusy(true); setDone(null);
    try {
      const res = await api.repairConsistency(codes);
      await loadAll();
      setData((d) => (d ? { ...d, findings: res.remaining,
                            total: res.remaining.reduce((n, f) => n + f.count, 0),
                            blocking: res.remaining
                              .filter((f) => f.severity === "blocking")
                              .reduce((n, f) => n + f.count, 0) } : d));
      setDone(`ซ่อมแล้ว ${res.total} รายการ`);
    } catch {
      setErr("ซ่อมไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const findings = data?.findings ?? [];
  const fixable = findings.filter((f) => f.fixable);

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="flex items-center gap-3 bg-slate-700 px-5 py-4 shrink-0">
        <span className="text-2xl">🧭</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            ตรวจความสอดคล้องของข้อมูล
          </h2>
          <p className="text-slate-200 text-xs mt-0.5">
            {data == null
              ? "กำลังตรวจ…"
              : data.total === 0
              ? "ข้อมูลทุกส่วนตรงกันหมด"
              : `พบ ${data.total} รายการ${data.blocking ? ` · ร้ายแรง ${data.blocking}` : ""}`}
            {data && ` · ตรวจ ${data.checked.requirements} แถวแผนการสอน · ${data.checked.slots} คาบในตาราง`}
          </p>
        </div>
        <button onClick={onClose}
          className="text-slate-300 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {err && <p className="text-xs text-red-700">{err}</p>}
        {done && <p className="text-xs text-green-700 font-semibold">{done}</p>}

        {data != null && data.total === 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
            ✓ ไม่พบจุดที่ข้อมูลไม่ตรงกัน — ชื่อในตาราง ห้องที่กันไว้ เซ็ตห้องย่อย
            และแผนการสอน ตรงกันทั้งหมด
          </div>
        )}

        {fixable.length > 0 && (
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 flex items-center gap-3">
            <p className="flex-1 text-[11px] text-slate-700">
              ซ่อมได้อัตโนมัติ {fixable.reduce((n, f) => n + f.count, 0)} รายการ
              — เฉพาะข้อที่คำตอบไม่กำกวม เช่น ล้างของที่ถูกลบไปแล้วออก
              หรืออัปเดตชื่อที่ค้างอยู่
            </p>
            <button disabled={busy} onClick={() => repair()}
              className="shrink-0 px-3 py-1 rounded bg-slate-700 text-white text-xs font-semibold
                         hover:bg-slate-800 disabled:opacity-50">
              {busy ? "กำลังซ่อม…" : "ซ่อมทั้งหมด"}
            </button>
          </div>
        )}

        {findings.map((f) => {
          const isOpen = open === f.code;
          return (
            <div key={f.code} className="border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : f.code)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                <span className={clsx("shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold",
                  f.severity === "blocking"
                    ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900")}>
                  {f.count}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-gray-800">{f.title}</span>
                  <span className="block text-[11px] text-gray-500">{f.why}</span>
                </span>
                {f.fixable && (
                  <span className="shrink-0 text-[10px] text-slate-500 border border-slate-200
                                   rounded px-1 py-0.5">ซ่อมได้</span>
                )}
                <span className="text-gray-400 text-xs shrink-0">{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 pt-1 bg-gray-50/60 border-t border-gray-100 space-y-2">
                  <ul className="text-[11px] text-gray-600 space-y-0.5">
                    {f.examples.map((e, i) => <li key={i}>· {e}</li>)}
                    {f.count > f.examples.length && (
                      <li className="text-gray-400">… และอีก {f.count - f.examples.length} รายการ</li>
                    )}
                  </ul>
                  {f.fixable ? (
                    <button disabled={busy} onClick={() => repair([f.code])}
                      className="px-2.5 py-1 rounded bg-slate-700 text-white text-xs font-semibold
                                 hover:bg-slate-800 disabled:opacity-50">
                      {f.fix ?? "ซ่อมข้อนี้"}
                    </button>
                  ) : (
                    <p className="text-[11px] text-gray-500">
                      ข้อนี้ต้องตัดสินใจเอง ระบบจึงไม่แก้ให้
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-2 shrink-0">
        <button onClick={load} disabled={busy}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600
                     hover:bg-gray-50 disabled:opacity-50">
          ↻ ตรวจอีกครั้ง
        </button>
        <span className="flex-1" />
        <button onClick={onClose}
          className="px-4 py-1.5 text-sm bg-slate-700 text-white rounded-lg font-semibold
                     hover:bg-slate-800">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
