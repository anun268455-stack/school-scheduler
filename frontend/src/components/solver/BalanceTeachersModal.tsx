/**
 * เกลี่ยคาบครู — คาบต่อวันไม่ล้น และไม่สอนติดกันยาวเกินจำเป็น
 *
 * "อยากให้คุณมีปุ่มที่ช่วยทำให้คาบครูมีไม่มากใน 1 วัน และไม่ติดกันมากเกิน
 *  ความจำเป็นช่วยที"
 *
 * ตารางจัดเสร็จแล้ว ปุ่มนี้จึงไม่รื้อใหม่ — สลับคาบของห้องเดียวกันข้ามวัน
 * ตารางนักเรียนมีคาบเท่าเดิมในช่องเดิมทุกช่อง เปลี่ยนแค่ว่าชั่วโมงนั้นเรียน
 * วิชาอะไร คาบที่ล็อกไว้ไม่ถูกแตะ
 *
 * มีปุ่ม "ดูก่อน" เพราะการกดแล้วค่อยดูว่าเปลี่ยนอะไรไปบ้าง ในตาราง 2,700 คาบ
 * คือการหาของที่ไม่รู้ว่าอยู่ไหน
 */
import { useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { putSavePoint, storageAvailable } from "../../utils/savePoints";

const DAY_NAMES = ["จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์"];
const DAYS_CAP = [4, 5, 6, 7];
const RUN_CAP = [2, 3, 4];

export const BalanceTeachersModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { schoolConfig, loadSlots } = useTimetableStore();
  const [cap, setCap] = useState<number>(
    Number(schoolConfig?.max_per_day) > 0 ? Number(schoolConfig?.max_per_day) : 6);
  const [run, setRun] = useState<number>(
    Number(schoolConfig?.max_consecutive) > 0 ? Number(schoolConfig?.max_consecutive) : 3);
  const [withLocked, setWithLocked] = useState(false);
  const [busy, setBusy] = useState<"" | "dry" | "real">("");
  const [res, setRes] = useState<api.BalanceResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const go = async (dry: boolean) => {
    setBusy(dry ? "dry" : "real");
    setErr(null);
    try {
      // เก็บสำเนาไว้ก่อนลงมือจริง — ย้ายได้ถึงร้อยกว่าคาบ ถ้าไม่ถูกใจแล้วต้อง
      // ไล่ย้ายคืนเองทีละคาบคือฝันร้าย กู้จากสำเนาในหน้าสำรองข้อมูลได้เลย
      if (!dry && storageAvailable()) {
        try {
          const snap = await api.downloadBackup();
          if (Array.isArray(snap["teachers"]) && snap["teachers"].length) {
            await putSavePoint("auto", snap, "ก่อนเกลี่ยคาบครู");
          }
        } catch { /* สำเนาไม่สำเร็จก็ไม่ควรขวางงานของโรงเรียน */ }
      }
      const r = await api.balanceTeachers({
        max_per_day: cap, max_consecutive: run,
        dry_run: dry, include_locked_classes: withLocked,
      });
      setRes(r);
      if (!dry && r.moved) await loadSlots();
    } catch (e) {
      // 404 = ตัวจัดตารางบน Render ยังเป็นรุ่นเก่าที่ไม่มีปุ่มนี้ คนละที่กับ
      // หน้าเว็บและอัปเดตช้ากว่า — บอกให้รอ ไม่ใช่บอกว่าพัง
      const code = (e as { response?: { status?: number } })?.response?.status;
      setErr(code === 404
        ? "ตัวจัดตารางบนเซิร์ฟเวอร์ยังเป็นรุ่นเก่าที่ไม่มีปุ่มนี้ — "
          + "รออีกสองสามนาทีแล้วกดใหม่ (ป้าย 🚧 บนแถบด้านบนจะหายไปเมื่อพร้อม)"
        : api.errorDetail(e, "เกลี่ยไม่สำเร็จ — ลองใหม่อีกครั้ง"));
    } finally {
      setBusy("");
    }
  };

  const num = (label: string, value: number, set: (n: number) => void,
               choices: number[], unit: string) => (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <div className="mt-1 flex items-center gap-1">
        {choices.map((n) => (
          <button
            key={n}
            onClick={() => set(n)}
            className={clsx(
              "px-3 py-1.5 rounded border text-sm font-semibold transition-colors",
              value === n
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
            )}
          >{n}</button>
        ))}
        <span className="text-xs text-gray-500 ml-1">{unit}</span>
      </div>
    </label>
  );

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl">
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-900">เกลี่ยคาบครู</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            สลับคาบของห้องเดียวกันข้ามวัน — ตารางนักเรียนมีคาบเท่าเดิมในช่องเดิม
            คาบที่ล็อกไว้ไม่ถูกแตะ
          </p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg px-1">✕</button>
      </div>

      <div className="px-5 py-4 overflow-y-auto space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {num("ครูหนึ่งคนสอนได้ไม่เกิน", cap, setCap, DAYS_CAP, "คาบ / วัน")}
          {num("สอนติดกันได้ไม่เกิน", run, setRun, RUN_CAP, "คาบ")}
        </div>

        {/* ห้องที่ปิดไว้ว่าจัดเสร็จแล้ว — ของโรงเรียนนี้ปิดไว้เกือบทุกห้อง
            ถ้าไม่บอกตรงนี้ ปุ่มจะย้ายได้ไม่กี่คาบแล้วดูเหมือนปุ่มเสีย */}
        <label className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <input type="checkbox" className="mt-0.5" checked={withLocked}
                 onChange={(e) => setWithLocked(e.target.checked)} />
          <span className="text-xs text-gray-700">
            <b>เกลี่ยห้องที่ปิดไว้ว่าจัดเสร็จแล้วด้วย</b>
            <br />
            ห้องที่ปิดไว้จะถูกสลับคาบข้ามวันเหมือนห้องอื่น — จำนวนคาบในแต่ละ
            ช่องของนักเรียนยังเท่าเดิมทุกช่อง เปลี่ยนแค่ว่าชั่วโมงนั้นเรียน
            วิชาอะไร ส่วนคาบที่ล็อกไว้ทีละคาบ (สีดำ) ยังไม่ถูกแตะอยู่ดี
          </span>
        </label>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{err}</div>
        )}

        {res && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className={clsx("px-3 py-2 text-xs font-semibold",
              res.dry_run ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800")}>
              {res.dry_run
                ? `ดูก่อน — จะย้าย ${res.moved} คาบ (ยังไม่เปลี่ยนตารางจริง)`
                : res.moved
                ? `เกลี่ยแล้ว — ย้าย ${res.moved} คาบ`
                : "ไม่มีคาบไหนที่ย้ายแล้วดีขึ้น — ตารางไม่ถูกเปลี่ยน"}
              <span className="font-normal text-gray-500"> · ใช้เวลา {res.seconds} วินาที</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">วัดอะไร</th>
                  <th className="px-3 py-1.5 font-medium w-20">ก่อน</th>
                  <th className="px-3 py-1.5 font-medium w-20">หลัง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  [`ครูที่มีวันเกิน ${res.max_per_day} คาบ`, res.before.teachers_over, res.after.teachers_over, "คน"],
                  ["วันที่เกินเพดาน", res.before.days_over, res.after.days_over, "วัน"],
                  [`ช่วงที่สอนติดกันเกิน ${res.max_consecutive} คาบ`, res.before.runs_over, res.after.runs_over, "ช่วง"],
                  ["วันที่หนักสุดของทั้งโรงเรียน", res.before.worst_day, res.after.worst_day, "คาบ"],
                ].map(([label, a, b, unit]) => (
                  <tr key={String(label)}>
                    <td className="px-3 py-1.5 text-gray-700">{label}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-gray-500">{a} {unit}</td>
                    <td className={clsx("px-3 py-1.5 text-center tabular-nums font-semibold",
                      Number(b) < Number(a) ? "text-emerald-700"
                        : Number(b) > Number(a) ? "text-red-700" : "text-gray-500")}>
                      {b} {unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {res.stuck?.length > 0 && (
              <div className="px-3 py-2 border-t border-gray-200">
                <div className="text-[11px] font-semibold text-gray-700 mb-1">
                  ที่ยังเหลืออยู่ — ต้องไปปลดล็อกหรือสลับด้วยมือ
                </div>
                <ul className="space-y-0.5">
                  {res.stuck.map((r, i) => (
                    <li key={i} className="text-[11px] text-gray-600">
                      {DAY_NAMES[r.day] ?? r.day} · {r.teacher} — {r.problem}
                      <span className="text-gray-400"> ({r.why})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {res.notes.length > 0 && (
              <ul className="px-3 py-2 space-y-1 bg-gray-50 border-t border-gray-200">
                {res.notes.map((n, i) => (
                  <li key={i} className="text-[11px] text-gray-600 leading-relaxed">· {n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
        <button onClick={onClose}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">ปิด</button>
        <button
          onClick={() => void go(true)}
          disabled={!!busy}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
        >{busy === "dry" ? "กำลังคิด…" : "ดูก่อนว่าจะเปลี่ยนอะไร"}</button>
        <button
          onClick={() => void go(false)}
          disabled={!!busy}
          className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300"
        >{busy === "real" ? "กำลังเกลี่ย…" : "เกลี่ยเลย"}</button>
      </div>
    </ModalShell>
  );
};
