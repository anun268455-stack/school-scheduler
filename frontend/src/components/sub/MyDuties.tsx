/**
 * คาบของฉัน — the two lists a teacher needs on a Monday morning.
 *
 * "Lessons I handed over" and "lessons I agreed to take" are different
 * questions with different consequences, so they are two lists rather than one
 * filtered table: forgetting the second means a class sits alone.
 */
import React, { useCallback, useEffect, useState } from "react";
import * as sub from "../../api/subClient";
import { thaiDate } from "./ArrangeCover";

interface Props { me: number }

export const MyDuties: React.FC<Props> = ({ me }) => {
  const [subs, setSubs] = useState<sub.Substitution[]>([]);
  const [repays, setRepays] = useState<sub.Repayment[]>([]);
  const [absences, setAbsences] = useState<sub.Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      sub.fetchSubstitutions(me),
      sub.fetchRepayments(me),
      sub.fetchAbsences(me),
    ]).then(([s, r, a]) => { setSubs(s); setRepays(r); setAbsences(a); })
      .finally(() => setLoading(false));
  }, [me]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const mine     = subs.filter((s) => s.absent_teacher_id === me);
  const covering = subs.filter((s) => s.cover_teacher_id === me);
  const owedBack = repays.filter((r) => r.teacher_id === me);

  const remove = async (id: number) => {
    setBusy(id);
    try { await sub.deleteSubstitution(id); load(); } finally { setBusy(null); }
  };
  const removeAbsence = async (id: number) => {
    setBusy(-id);
    try { await sub.deleteAbsence(id); load(); } finally { setBusy(null); }
  };

  if (loading) return <p className="text-center text-slate-400 text-sm py-16">กำลังโหลด…</p>;

  const upcoming = (d: string) => d >= today;

  return (
    <div className="space-y-4">
      <Card
        title="🧑‍🏫 คาบที่ฉันต้องไปสอนแทนคนอื่น"
        hint="อย่าลืม — ถ้าไม่ไป ห้องเรียนจะไม่มีครู"
        empty="ยังไม่มีใครฝากคาบไว้กับคุณ"
        rows={covering.map((s) => ({
          key: `c${s.id}`,
          dim: !upcoming(s.date),
          main: `${thaiDate(s.date)} · ${s.group_name ?? ""} ${s.subject_code ?? ""}`,
          sub: `คาบ ${s.period} · ห้อง ${s.room_name ?? "–"} · แทน ${s.absent_teacher_name ?? ""}`,
          tag: s.creates_debt ? "แลกคาบ (เขาจะมาคืน)" : "สอนแทน",
          tagTone: s.creates_debt ? "amber" : "slate",
        }))}
      />

      <Card
        title="📤 คาบที่ฉันฝากคนอื่นไว้"
        empty="ยังไม่ได้ฝากคาบให้ใคร"
        rows={mine.map((s) => ({
          key: `m${s.id}`,
          dim: !upcoming(s.date),
          main: `${thaiDate(s.date)} · ${s.group_name ?? ""} ${s.subject_code ?? ""}`,
          sub: `คาบ ${s.period} · ${s.cover_teacher_name ?? ""} รับสอนแทน`,
          tag: s.creates_debt ? "ต้องไปคืนคาบ" : "ไม่ต้องคืน",
          tagTone: s.creates_debt ? "amber" : "emerald",
          onRemove: () => remove(s.id),
          removing: busy === s.id,
        }))}
      />

      <Card
        title="↩️ คาบที่ฉันต้องไปสอนคืนให้เขา"
        hint="เกิดจากการแลกคาบ — ไปสอนตามวันที่ตกลงไว้"
        empty="ไม่มีคาบค้างคืน"
        rows={owedBack.map((r) => ({
          key: `r${r.id}`,
          dim: !upcoming(r.date),
          main: `${thaiDate(r.date)} · ${r.group_name ?? ""} ${r.subject_code ?? ""}`,
          sub: `คาบ ${r.period} · คืนให้ครูที่รับสอนแทน`,
          tag: upcoming(r.date) ? "ยังไม่ถึงวัน" : "ผ่านไปแล้ว",
          tagTone: upcoming(r.date) ? "sky" : "slate",
        }))}
      />

      <Card
        title="🧳 วันที่ฉันแจ้งไปราชการ"
        empty="ยังไม่ได้แจ้งวันไปราชการ"
        rows={absences.map((a) => ({
          key: `a${a.id}`,
          dim: !upcoming(a.date),
          main: thaiDate(a.date),
          sub: `${a.periods.length ? `คาบ ${a.periods.join(", ")}` : "ทั้งวัน"}${a.reason ? ` · ${a.reason}` : ""}`,
          tag: "ยกเลิกได้",
          tagTone: "slate",
          onRemove: () => removeAbsence(a.id),
          removing: busy === -a.id,
          removeLabel: "ยกเลิกการแจ้ง",
        }))}
      />
    </div>
  );
};

type Tone = "amber" | "emerald" | "sky" | "slate";
const TONE: Record<Tone, string> = {
  amber:   "bg-amber-100 text-amber-800 border-amber-300",
  emerald: "bg-emerald-100 text-emerald-800 border-emerald-300",
  sky:     "bg-sky-100 text-sky-800 border-sky-300",
  slate:   "bg-slate-100 text-slate-600 border-slate-300",
};

interface Row {
  key: string; main: string; sub: string; tag: string; tagTone: Tone | string;
  dim?: boolean; onRemove?: () => void; removing?: boolean; removeLabel?: string;
}

const Card: React.FC<{ title: string; hint?: string; empty: string; rows: Row[] }> = ({
  title, hint, empty, rows,
}) => (
  <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-100">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
    {rows.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-slate-400">{empty}</p>
    ) : (
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.key}
            className={`px-4 py-2.5 flex items-center gap-3 flex-wrap ${r.dim ? "opacity-45" : ""}`}>
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-medium text-slate-800">{r.main}</div>
              <div className="text-xs text-slate-500">{r.sub}</div>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded border shrink-0 ${TONE[(r.tagTone as Tone)] ?? TONE.slate}`}>
              {r.tag}
            </span>
            {r.onRemove && (
              <button onClick={r.onRemove} disabled={r.removing}
                className="text-xs text-slate-400 hover:text-red-600 underline shrink-0 disabled:opacity-40">
                {r.removing ? "กำลังลบ…" : (r.removeLabel ?? "ยกเลิก")}
              </button>
            )}
          </div>
        ))}
      </div>
    )}
  </section>
);
