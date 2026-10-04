/**
 * บัญชีคาบที่ติดกัน — who owes whom, in periods.
 *
 * The school already keeps this count in people's heads, which is why it goes
 * wrong. Measured in periods rather than in favours, a two-period debt settled
 * by one period taught twice comes out exactly even.
 */
import React, { useEffect, useState } from "react";
import clsx from "clsx";
import * as sub from "../../api/subClient";

interface Props { me: number }

export const DebtLedger: React.FC<Props> = ({ me }) => {
  const [rows, setRows] = useState<sub.LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sub.fetchLedger().then(setRows).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-center text-slate-400 text-sm py-16">กำลังโหลด…</p>;

  const mine = rows.filter((r) => r.debtor_id === me || r.creditor_id === me);
  const iOwe  = mine.filter((r) => r.debtor_id === me && r.periods > 0);
  const owedMe = mine.filter((r) => r.creditor_id === me && r.periods > 0);
  const others = rows.filter((r) => r.debtor_id !== me && r.creditor_id !== me && r.periods > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="ฉันติดคาบคนอื่น" value={iOwe.reduce((n, r) => n + r.periods, 0)}
          tone="amber" hint="ต้องไปสอนคืนให้เขา" />
        <Stat label="คนอื่นติดคาบฉัน" value={owedMe.reduce((n, r) => n + r.periods, 0)}
          tone="emerald" hint="เขาจะมาสอนคืนให้" />
      </div>

      <Table title="🔻 ฉันติดคาบใครบ้าง"
        empty="ไม่ติดคาบใครเลย"
        rows={iOwe.map((r) => ({ who: r.creditor_name ?? "–", n: r.periods }))}
        tone="amber" />

      <Table title="🔺 ใครติดคาบฉันบ้าง"
        empty="ไม่มีใครติดคาบคุณ"
        rows={owedMe.map((r) => ({ who: r.debtor_name ?? "–", n: r.periods }))}
        tone="emerald" />

      {others.length > 0 && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-800">📖 บัญชีของทั้งโรงเรียน</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              เปิดให้ทุกคนเห็น เพื่อให้ฝ่ายวิชาการตามได้ว่าคาบไหนยังค้างอยู่
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {others.map((r, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-2 text-sm">
                <span className="text-slate-700 flex-1 min-w-0 truncate">{r.debtor_name}</span>
                <span className="text-slate-400 text-xs shrink-0">ติดคาบ</span>
                <span className="text-slate-700 flex-1 min-w-0 truncate">{r.creditor_name}</span>
                <span className="font-bold text-slate-800 shrink-0">{r.periods} คาบ</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-slate-400 text-center leading-relaxed">
        นับเป็น "คาบ" ไม่ใช่ "ครั้ง" — ติด 2 คาบ จะคืนเป็น 2 คาบรวดเดียว
        หรือคาบเดียวสองสัปดาห์ก็ได้ ผลลัพธ์เท่ากัน
      </p>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone: "amber" | "emerald"; hint: string }> = ({
  label, value, tone, hint,
}) => (
  <div className={clsx("rounded-2xl border p-4 text-center",
    tone === "amber" ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200")}>
    <div className="text-xs font-semibold text-slate-600">{label}</div>
    <div className={clsx("text-3xl font-bold my-1",
      tone === "amber" ? "text-amber-700" : "text-emerald-700")}>{value}</div>
    <div className="text-[11px] text-slate-500">คาบ · {hint}</div>
  </div>
);

const Table: React.FC<{
  title: string; empty: string; rows: { who: string; n: number }[];
  tone: "amber" | "emerald";
}> = ({ title, empty, rows, tone }) => (
  <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-100">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
    </div>
    {rows.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-slate-400">{empty}</p>
    ) : (
      <div className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <div key={i} className="px-4 py-2.5 flex items-center gap-3">
            <span className="flex-1 min-w-0 truncate text-sm text-slate-800">{r.who}</span>
            <span className={clsx("text-sm font-bold",
              tone === "amber" ? "text-amber-700" : "text-emerald-700")}>{r.n} คาบ</span>
          </div>
        ))}
      </div>
    )}
  </section>
);
