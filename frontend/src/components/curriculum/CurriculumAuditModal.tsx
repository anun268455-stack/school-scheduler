/**
 * ตรวจหลักสูตร — แผนการสอนของแต่ละห้องตรงกับหลักสูตรที่ผูกไว้หรือเปล่า
 *
 * ทั้งโรงเรียนในตารางเดียว: ห้องไหนขาดวิชา เกินวิชา หรือจำนวนคาบไม่ตรง แล้วกด
 * "เทียบ" เปิดดูรายวิชาและปรับให้ตรงได้ทีละห้อง
 *
 * ห้องที่ยังไม่ผูกหลักสูตรไม่ถูกตรวจ — ตั้งใจไว้อย่างนั้น หลายห้องมีแผนเฉพาะตัว
 * หน้านี้จึงไม่นับว่าเป็นข้อผิดพลาด และไม่ขึ้นสีแดงให้
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import { CurriculumDiffModal } from "./CurriculumDiffModal";
import * as api from "../../api/client";

type Row = api.CurriculumAuditRow;

/** ห้องที่ผูกหลักสูตรแล้ว และยังมีอะไรไม่ตรงอยู่ */
const isOff = (r: Row) =>
  r.curriculum_id != null && (r.missing > 0 || r.surplus > 0 || r.mismatch > 0 || r.warn > 0);

const Count: React.FC<{ n: number; tone: "amber" | "rose" | "gray" }> = ({ n, tone }) =>
  n > 0 ? (
    <span className={clsx("px-1.5 py-0.5 rounded text-[11px] font-semibold",
      tone === "rose" ? "bg-rose-100 text-rose-800"
        : tone === "amber" ? "bg-amber-100 text-amber-800"
          : "bg-gray-100 text-gray-700")}>{n}</span>
  ) : <span className="text-gray-300">—</span>;

export const CurriculumAuditModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [data, setData] = useState<api.CurriculumAudit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyOff, setOnlyOff] = useState(false);
  const [diffFor, setDiffFor] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(() => {
    setErr(null);
    api.fetchCurriculumAudit().then(setData)
      .catch((e) => setErr(api.errorDetail(e, "ตรวจไม่สำเร็จ — ลองใหม่อีกครั้ง")));
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const off = useMemo(() => rows.filter(isOff).length, [rows]);
  const shown = useMemo(() => (onlyOff ? rows.filter(isOff) : rows), [rows, onlyOff]);

  // While the เทียบ dialog is open on top, Esc and the backdrop are its business:
  // they should close it and leave this one standing.
  const closeSelf = useCallback(() => { if (!diffFor) onClose(); }, [diffFor, onClose]);

  return (
    <>
      <ModalShell onClose={closeSelf} maxWidth="max-w-5xl" tall>
        <div className="px-5 py-3 border-b bg-gradient-to-r from-indigo-600 to-indigo-500 text-white flex items-center justify-between">
          <div>
            <h2 className="font-bold">ตรวจหลักสูตรของแต่ละห้อง</h2>
            <p className="text-[11px] opacity-90">
              เทียบแผนการสอนของแต่ละห้อง กับหลักสูตรที่ผูกไว้ — ขาด เกิน หรือคาบไม่ตรง
            </p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3 text-xs">
          {data && (
            <>
              <span className="text-gray-600">
                ผูกหลักสูตรแล้ว <strong>{data.attached}</strong> จาก {data.total} ห้อง
              </span>
              <span className={clsx("font-semibold",
                data.attached === 0 ? "text-gray-500"
                  : off ? "text-amber-700" : "text-emerald-700")}>
                {data.attached === 0 ? "ยังไม่ได้ผูกหลักสูตรกับห้องไหน — ไม่มีอะไรให้ตรวจ"
                  : off ? `ไม่ตรงกับหลักสูตร ${off} ห้อง`
                    : `ตรงกับหลักสูตรทุกห้องที่ผูกไว้ (${data.attached} ห้อง)`}
              </span>
            </>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={onlyOff} onChange={(e) => setOnlyOff(e.target.checked)} />
            แสดงเฉพาะห้องที่ไม่ตรง
          </label>
          <button onClick={load}
            className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100">
            ตรวจใหม่
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          {err && <div className="text-rose-700 text-sm">{err}</div>}
          {!data && !err && <div className="text-gray-400 text-sm">กำลังตรวจ…</div>}
          {data && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-1.5 pr-2">ห้อง</th>
                  <th className="py-1.5 px-2">หลักสูตร</th>
                  <th className="py-1.5 px-2 text-center" title="วิชาที่หลักสูตรมี แต่แผนการสอนของห้องยังไม่มี">ขาด</th>
                  <th className="py-1.5 px-2 text-center" title="วิชาที่แผนการสอนของห้องมี แต่หลักสูตรไม่มี">เกิน</th>
                  <th className="py-1.5 px-2 text-center" title="วิชาที่มีทั้งสองฝั่ง แต่จำนวนคาบต่างกัน">คาบไม่ตรง</th>
                  <th className="py-1.5 px-2 text-center" title="เรื่องที่ระบบไม่ตัดสินให้ — เปิดดูเหตุผลในหน้าเทียบ">คำเตือน</th>
                  <th className="py-1.5 px-2 text-center" title="คาบรวมต่อสัปดาห์ในแผนการสอนของห้อง">คาบรวม</th>
                  <th className="py-1.5 pl-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.group_id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-1 pr-2 font-medium text-gray-800">{r.group_name}</td>
                    {r.curriculum_id == null ? (
                      <>
                        <td colSpan={5} className="py-1 px-2 text-gray-400">
                          ยังไม่ผูกหลักสูตร — ไม่ถูกตรวจ
                        </td>
                        <td className="py-1 px-2 text-center text-gray-500">{r.weekly}</td>
                        <td className="py-1 pl-2" />
                      </>
                    ) : (
                      <>
                        <td className="py-1 px-2 text-gray-700">{r.curriculum_name}</td>
                        <td className="py-1 px-2 text-center"><Count n={r.missing} tone="amber" /></td>
                        <td className="py-1 px-2 text-center"><Count n={r.surplus} tone="rose" /></td>
                        <td className="py-1 px-2 text-center"><Count n={r.mismatch} tone="amber" /></td>
                        <td className="py-1 px-2 text-center"><Count n={r.warn} tone="gray" /></td>
                        <td className="py-1 px-2 text-center font-semibold">{r.weekly}</td>
                        <td className="py-1 pl-2 text-right">
                          <button onClick={() => setDiffFor({ id: r.group_id, name: r.group_name })}
                            className="px-2 py-0.5 rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-semibold">
                            เทียบ
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {!shown.length && (
                  <tr><td colSpan={8} className="py-6 text-center text-emerald-700">
                    {rows.length === 0
                      ? "ยังไม่มีห้องให้แสดง"
                      : "ทุกห้องตรงกับหลักสูตรที่ผูกไว้"}
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-gray-50">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <strong>ขาด</strong> วิชาที่หลักสูตรมีแต่ห้องไม่มี · <strong>เกิน</strong> วิชาที่ห้องมีแต่หลักสูตรไม่มี ·
            <strong> คาบไม่ตรง</strong> มีทั้งสองฝั่งแต่จำนวนคาบต่างกัน ·
            ห้องที่ยังไม่ผูกหลักสูตรไม่ถูกตรวจ — ตั้งใจไว้ ไม่ใช่ข้อผิดพลาด
          </p>
        </div>
      </ModalShell>
      {diffFor && (
        <CurriculumDiffModal
          groupId={diffFor.id} groupName={diffFor.name} z="z-[210]"
          onClose={() => setDiffFor(null)} onApplied={load} />
      )}
    </>
  );
};
