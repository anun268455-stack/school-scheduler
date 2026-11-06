/**
 * สถิติย้อนหลัง — เทียบเทอมเรียงตามเวลา (GET /api/terms/stats)
 *
 * อ่านอย่างเดียว ไม่แตะข้อมูลที่ใช้งานอยู่ เทอมที่สำเนาอ่านไม่ออกขึ้นข้อความแทนตัวเลข
 * และไม่ถูกนำไปคิดส่วนต่างกับเทอมข้างเคียง (ไม่ให้เห็น “+2,735 คาบ” ที่ไม่จริง)
 */
import React, { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { useTimetableStore } from "../../store/timetableStore";
import * as api from "../../api/client";
import { departmentMatrix, statsLines, termErrorText } from "../../utils/terms";
import { TermsSection, TermsUnavailable } from "./TermsPanel";

const th = "px-3 py-1.5 text-left text-xs font-semibold text-gray-600 border-b whitespace-nowrap";

export const TermStatsPanel: React.FC = () => {
  const terms = useTimetableStore((s) => s.terms);
  const available = useTimetableStore((s) => s.termsAvailable);
  const [rows, setRows] = useState<api.TermStatsRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setRows((await api.fetchTermStats()).terms); }
    catch (e) { setErr(termErrorText(e, "อ่านสถิติไม่สำเร็จ")); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { if (available) void load(); }, [available, load]);

  if (!available) {
    return (
      <TermsSection title="สถิติย้อนหลัง 📈">
        <TermsUnavailable />
      </TermsSection>
    );
  }

  const lines = rows ? statsLines(rows, terms) : [];
  const dept = rows ? departmentMatrix(rows, terms) : { names: [], byTerm: [] };

  return (
    <TermsSection
      title="สถิติย้อนหลัง 📈"
      action={
        <button onClick={() => void load()} disabled={busy}
          className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">
          {busy ? "กำลังโหลด…" : "↻ โหลดใหม่"}
        </button>
      }
    >
      <div className="space-y-3">
        {err && <p className="text-xs text-red-600">{err}</p>}
        {!rows && !err && <p className="text-xs text-gray-400 py-3 text-center">กำลังอ่านสถิติ…</p>}
        {rows && lines.length === 0 && (
          <p className="text-xs text-gray-400 py-3 text-center">ยังไม่มีเทอมให้เทียบ</p>
        )}

        {lines.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["เทอม", "คาบที่ลงแล้ว", "เทียบเทอมก่อน", "ครูที่มีคาบ", "ห้องสอนที่ใช้", "วิชาที่เปิด"].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5 font-semibold text-gray-800 whitespace-nowrap">{l.label}</td>
                    {l.error ? (
                      <td colSpan={5} className="px-3 py-1.5 text-xs text-red-600">{l.error}</td>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 tabular-nums text-gray-800">{l.slots.toLocaleString("th-TH")}</td>
                        <td className={clsx("px-3 py-1.5 tabular-nums text-xs",
                          l.slotsDelta === null ? "text-gray-400"
                            : l.slotsDelta < 0 ? "text-red-600" : "text-emerald-700")}>
                          {l.slotsDelta === null ? "–"
                            : `${l.slotsDelta > 0 ? "+" : ""}${l.slotsDelta.toLocaleString("th-TH")}`}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-800">{l.teachers}</td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-800">{l.rooms}</td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-800">{l.subjects}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dept.names.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">คาบแยกตามกลุ่มสาระฯ</p>
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className={th}>กลุ่มสาระฯ</th>
                    {dept.byTerm.map((t) => <th key={t.label} className={th}>{t.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dept.names.map((name, i) => (
                    <tr key={name}>
                      <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{name}</td>
                      {dept.byTerm.map((t) => (
                        <td key={t.label} className="px-3 py-1.5 tabular-nums text-gray-800">
                          {t.bad ? "–" : t.counts[i].toLocaleString("th-TH")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </TermsSection>
  );
};
