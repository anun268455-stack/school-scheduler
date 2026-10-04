/**
 * ระบบจัดการสอนแทน — the page the teachers get.
 *
 * It is the same deployment and the same data as the timetable editor, reached
 * at #/substitute, but it shares no component with it. That is the point: the
 * editor can clear the whole timetable in two clicks, and this link goes to
 * every teacher in the school.
 *
 * There is no password. A school of 143 teachers will not keep one, and the
 * worst this page can do is record that somebody agreed to cover a lesson —
 * it never writes to the timetable itself. So "ฉันคือ…" is a picker, and it is
 * remembered so nobody picks twice.
 */
import React, { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import * as sub from "../api/subClient";
import { ArrangeCover } from "../components/sub/ArrangeCover";
import { MyDuties } from "../components/sub/MyDuties";
import { DebtLedger } from "../components/sub/DebtLedger";
import { SearchableSelect } from "../components/common/SearchableSelect";

type Tab = "arrange" | "duties" | "ledger";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "arrange", icon: "🧳", label: "แจ้งไปราชการ / หาคนสอนแทน" },
  { id: "duties",  icon: "📋", label: "คาบของฉัน" },
  { id: "ledger",  icon: "⚖️", label: "บัญชีคาบที่ติดกัน" },
];

const ME_KEY = "sub.me";

export default function SubstituteApp() {
  const [teachers, setTeachers] = useState<{ id: number; name: string; code?: string | null }[]>([]);
  const [me, setMe] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("arrange");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sub.fetchTeachersLite()
      .then((rows) => {
        setTeachers(rows);
        // Remembered from last time — a teacher should not have to find their
        // own name in a list of 143 every morning.
        try {
          const saved = Number(localStorage.getItem(ME_KEY));
          if (saved && rows.some((t) => t.id === saved)) setMe(saved);
        } catch { /* private window, no memory — the picker still works */ }
      })
      .catch(() => setError("ต่อเซิร์ฟเวอร์ไม่ได้ — ลองรีเฟรชอีกครั้ง"))
      .finally(() => setLoading(false));
  }, []);

  const pickMe = useCallback((v: string) => {
    const id = v ? Number(v) : null;
    setMe(id);
    try {
      if (id) localStorage.setItem(ME_KEY, String(id));
      else localStorage.removeItem(ME_KEY);
    } catch { /* nothing to do; the choice still holds for this visit */ }
  }, []);

  const meName = teachers.find((t) => t.id === me)?.name ?? "";

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-slate-900 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xl">🔄</span>
            <span className="font-bold tracking-wide">ระบบจัดการสอนแทน</span>
          </div>
          <div className="flex-1 min-w-0" />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-300">ฉันคือ</span>
            <div className="w-[240px]">
              <SearchableSelect
                tone="dark"
                value={me == null ? "" : String(me)}
                onChange={pickMe}
                placeholder="— เลือกชื่อของคุณ —"
                emptyLabel="— เลือกชื่อของคุณ —"
                searchThreshold={6}
                options={teachers.map((t) => ({
                  value: String(t.id),
                  label: t.code ? `${t.code} ${t.name}` : t.name,
                }))}
              />
            </div>
          </div>
        </div>

        {me != null && (
          <div className="max-w-5xl mx-auto px-4 pb-2 flex gap-1 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                  tab === t.id ? "bg-blue-600 text-white"
                               : "text-slate-300 hover:bg-slate-700")}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5">
        {loading && <p className="text-center text-slate-400 text-sm py-20">กำลังโหลด…</p>}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && me == null && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
            <div className="text-4xl mb-3">👋</div>
            <h1 className="text-lg font-bold text-slate-800 mb-2">เลือกชื่อของคุณก่อนเริ่มใช้งาน</h1>
            <p className="text-sm text-slate-500 leading-relaxed max-w-lg mx-auto">
              ระบบนี้ช่วยหาครูมาสอนแทนเวลาคุณไปราชการ
              โดยดูจากตารางสอนจริงของทั้งโรงเรียน ว่าใครว่างคาบไหนบ้าง
              และถ้าต้องแลกคาบ ก็จะคำนวณให้ว่าคุณจะไปคืนคาบให้เขาวันไหนได้บ้าง
              <br /><br />
              เลือกชื่อที่มุมขวาบนได้เลย ระบบจะจำไว้ให้ ไม่ต้องเลือกใหม่ทุกครั้ง
            </p>
          </div>
        )}

        {!loading && !error && me != null && (
          <>
            {tab === "arrange" && <ArrangeCover me={me} meName={meName} />}
            {tab === "duties"  && <MyDuties me={me} />}
            {tab === "ledger"  && <DebtLedger me={me} />}
          </>
        )}
      </main>

      <footer className="text-center text-[11px] text-slate-400 py-4">
        ข้อมูลตารางสอนดึงจากระบบตารางเรียนของโรงเรียนโดยตรง ·
        หน้านี้ไม่แก้ไขตารางหลัก เพียงบันทึกการสอนแทนไว้เท่านั้น
      </footer>
    </div>
  );
}
