/**
 * แจ้งไปราชการ แล้วหาคนสอนแทน — the whole point of the page.
 *
 * The flow mirrors what a teacher already does by hand, with the walking taken
 * out: pick the day you are away, see which of your lessons that leaves
 * uncovered, and for each one get the two answers the staffroom would have
 * given you — who is free, and who is free AND can be paid back.
 */
import React, { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import * as sub from "../../api/subClient";

const DAY_TH = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];

/** "2026-10-08" → "พฤหัสบดี 8 ต.ค. 2569" — the form a Thai school reads. */
const TH_MONTH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.",
                  "ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
export function thaiDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAY_TH[(d.getDay() + 6) % 7]} ${d.getDate()} ${TH_MONTH[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/** The next weekday, so the date box does not open on a Saturday. */
function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Choice =
  | { mode: "cover"; teacherId: number }
  | { mode: "swap"; teacherId: number; planIndex: number };

interface Props { me: number; meName: string }

export const ArrangeCover: React.FC<Props> = ({ me, meName }) => {
  const [date, setDate]         = useState(defaultDate());
  const [reason, setReason]     = useState("");
  const [lessons, setLessons]   = useState<sub.SubLesson[]>([]);
  const [picked, setPicked]     = useState<Set<number>>(new Set());
  const [dayMsg, setDayMsg]     = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const [options, setOptions]   = useState<Record<number, {
    cover: sub.CoverCandidate[]; swap: sub.SwapRoute[];
    unit: sub.SubLesson[]; owed: number;
  }>>({});
  const [choice, setChoice]     = useState<Record<number, Choice>>({});
  const [searching, setSearching] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [done, setDone]         = useState<sub.Substitution[] | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const loadDay = useCallback(() => {
    setLoading(true); setOptions({}); setChoice({}); setDone(null); setError(null);
    sub.fetchDay(me, date)
      .then((r) => {
        setLessons(r.lessons);
        setDayMsg(r.message ?? null);
        setPicked(new Set(r.lessons.map((l) => l.slot_id)));   // ทั้งวันเป็นค่าตั้งต้น
      })
      .catch(() => setError("โหลดตารางวันนี้ไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [me, date]);

  useEffect(() => { loadDay(); }, [loadDay]);

  const toggle = (slotId: number) => {
    const next = new Set(picked);
    if (next.has(slotId)) next.delete(slotId); else next.add(slotId);
    setPicked(next);
    setOptions({}); setChoice({}); setDone(null);
  };

  /** Selected lessons grouped into runs of back-to-back periods.
   *
   *  A คาบคู่ handed to one teacher is a single arrangement worth two periods,
   *  which is what lets it come back as one period taught twice. Splitting it
   *  into two independent swaps would work too, but it makes the teacher pick
   *  a cover and a repayment twice for what they think of as one favour.
   */
  const blocks = React.useMemo(() => {
    const chosen = lessons.filter((l) => picked.has(l.slot_id));
    const order = lessons.map((l) => l.period);
    const runs: sub.SubLesson[][] = [];
    for (const l of chosen) {
      const prev = runs[runs.length - 1];
      const last = prev?.[prev.length - 1];
      const adjacent = last && order.indexOf(l.period) === order.indexOf(last.period) + 1;
      if (adjacent) prev.push(l); else runs.push([l]);
    }
    return runs;
  }, [lessons, picked]);

  const [asBlock, setAsBlock] = useState<Record<string, boolean>>({});
  const blockKey = (b: sub.SubLesson[]) => b.map((l) => l.slot_id).join("-");
  /** The units actually searched for: a joined block, or its lessons apart. */
  const units = React.useMemo(() => {
    const out: sub.SubLesson[][] = [];
    for (const b of blocks) {
      if (b.length > 1 && asBlock[blockKey(b)]) out.push(b);
      else for (const l of b) out.push([l]);
    }
    return out;
  }, [blocks, asBlock]);

  const search = async () => {
    setSearching(true); setError(null); setDone(null);
    const next: typeof options = {};
    try {
      // One at a time, not all at once: the free tier is a small machine and a
      // teacher away all day would otherwise fire nine searches together.
      for (const u of units) {
        const r = await sub.fetchOptions({
          slot_ids: u.map((l) => l.slot_id), date, owed: u.length,
        });
        next[u[0].slot_id] = { cover: r.cover, swap: r.swap, unit: u, owed: r.owed };
      }
      setOptions(next);
    } catch {
      setError("ค้นหาไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally { setSearching(false); }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const absence = await sub.createAbsence({
        teacher_id: me, date,
        periods: lessons.filter((l) => picked.has(l.slot_id)).map((l) => l.period),
        reason,
      });
      const saved: sub.Substitution[] = [];
      for (const u of units) {
        const c = choice[u[0].slot_id];
        if (!c) continue;
        const plan = c.mode === "swap"
          ? options[u[0].slot_id]?.swap.find((s) => s.teacher_id === c.teacherId)?.plans[c.planIndex]
          : undefined;
        // One record per lesson, so a double owed is two periods owed, but the
        // repayment plan is attached once — it already covers the whole debt.
        for (let i = 0; i < u.length; i++) {
          saved.push(await sub.createSubstitution({
            slot_id: u[i].slot_id, date, cover_teacher_id: c.teacherId,
            creates_debt: c.mode === "swap",
            absence_id: absence.id,
            repayments: i === 0
              ? (plan?.slots.map((s) => ({ slot_id: s.slot_id, date: s.date })) ?? [])
              : [],
          }));
        }
      }
      setDone(saved);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally { setSaving(false); }
  };

  const readyCount = units.filter((u) => choice[u[0].slot_id]).length;

  return (
    <div className="space-y-4">
      {/* ── วันที่ ── */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-sm font-bold text-slate-800 mb-3">1. ไปราชการวันไหน</h2>
        <div className="flex gap-3 flex-wrap items-end">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 mb-1">วันที่</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block flex-1 min-w-[200px]">
            <span className="block text-xs font-semibold text-slate-600 mb-1">เรื่อง (ไม่บังคับ)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น อบรมเชิงปฏิบัติการที่ สพม."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>
        <p className="text-xs text-slate-500 mt-2">{thaiDate(date)}</p>
      </section>

      {/* ── คาบที่กระทบ ── */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-sm font-bold text-slate-800 mb-1">2. คาบที่ต้องหาคนสอนแทน</h2>
        <p className="text-xs text-slate-500 mb-3">
          ติ๊กออกได้ถ้าคาบไหนไม่ต้องหาคนแทน (เช่น กลับมาทันคาบบ่าย)
        </p>

        {loading && <p className="text-sm text-slate-400 py-4">กำลังโหลดตาราง…</p>}
        {!loading && dayMsg && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{dayMsg}</p>}
        {!loading && !dayMsg && lessons.length === 0 && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            วันนี้คุณไม่มีคาบสอน ไม่ต้องหาคนสอนแทน
          </p>
        )}

        <div className="space-y-1.5">
          {lessons.map((l) => (
            <label key={l.slot_id}
              className={clsx("flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors",
                picked.has(l.slot_id) ? "bg-blue-50 border-blue-200" : "bg-slate-50 border-slate-200")}>
              <input type="checkbox" checked={picked.has(l.slot_id)}
                onChange={() => toggle(l.slot_id)} className="w-4 h-4" />
              <span className="font-bold text-slate-700 text-sm w-20 shrink-0">
                {l.period_label || `คาบ ${l.period}`}
              </span>
              <span className="text-xs text-slate-500 w-24 shrink-0">
                {l.start_time}–{l.end_time}
              </span>
              <span className="text-sm text-slate-800 font-medium w-20 shrink-0">{l.group_name}</span>
              <span className="text-sm text-slate-600 flex-1 min-w-0 truncate">
                {l.subject_code} {l.subject_name}
              </span>
              <span className="text-xs text-slate-500 shrink-0">ห้อง {l.room_name ?? "–"}</span>
            </label>
          ))}
        </div>

        {blocks.some((b) => b.length > 1) && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-600">คาบที่ติดกัน</p>
            {blocks.filter((b) => b.length > 1).map((b) => {
              const k = blockKey(b);
              const on = !!asBlock[k];
              return (
                <label key={k}
                  className={clsx("flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs",
                    on ? "bg-violet-50 border-violet-300" : "bg-slate-50 border-slate-200")}>
                  <input type="checkbox" className="mt-0.5" checked={on}
                    onChange={(e) => { setAsBlock({ ...asBlock, [k]: e.target.checked }); setOptions({}); setChoice({}); }} />
                  <span className="leading-relaxed">
                    <strong>
                      {b.map((l) => l.period_label || `คาบ ${l.period}`).join(" + ")} — ให้ครูคนเดียวสอนรวด {b.length} คาบ
                    </strong>
                    <br />
                    <span className="text-slate-600">
                      ระบบจะหาเฉพาะครูที่ว่างครบทั้ง {b.length} คาบ และถ้าแลกคาบ
                      จะติดคืน {b.length} คาบ ซึ่งคืนเป็นคาบเดียว {b.length} สัปดาห์ก็ได้
                      · ไม่ติ๊ก = แยกหาคนละคาบ
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {lessons.length > 0 && (
          <button onClick={search} disabled={searching || picked.size === 0}
            className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
            {searching ? "กำลังค้นหา…" : `🔍 ค้นหาคนสอนแทน (${units.length} รายการ · ${picked.size} คาบ)`}
          </button>
        )}
      </section>

      {/* ── ตัวเลือกรายคาบ ── */}
      {Object.keys(options).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-slate-800">3. เลือกวิธีจัดการแต่ละคาบ</h2>
          {units.map((u) => (
            <LessonOptions
              key={u[0].slot_id}
              unit={u}
              data={options[u[0].slot_id]}
              choice={choice[u[0].slot_id]}
              onChoose={(c) => setChoice({ ...choice, [u[0].slot_id]: c })}
              onClear={() => {
                const next = { ...choice }; delete next[u[0].slot_id]; setChoice(next);
              }}
            />
          ))}

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold text-slate-800">
                เลือกแล้ว {readyCount} จาก {units.length} รายการ
              </p>
              <p className="text-xs text-slate-500">
                คาบที่ยังไม่ได้เลือกจะไม่ถูกบันทึก — กลับมาจัดการทีหลังได้
              </p>
            </div>
            <button onClick={save} disabled={saving || readyCount === 0}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold disabled:opacity-40">
              {saving ? "กำลังบันทึก…" : `✓ ยืนยันและบันทึก (${readyCount} รายการ)`}
            </button>
          </div>
        </section>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">{error}</div>
      )}

      {done && (
        <section className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4">
          <h2 className="text-sm font-bold text-emerald-900 mb-2">
            ✓ บันทึกเรียบร้อย {done.length} คาบ
          </h2>
          <div className="space-y-1 text-sm text-emerald-900">
            {done.map((d) => (
              <div key={d.id}>
                • {d.group_name} {d.subject_code} คาบ {d.period} →{" "}
                <strong>{d.cover_teacher_name}</strong>
                {d.creates_debt ? " (แลกคาบ — มีคืน)" : " (สอนแทน — ไม่ต้องคืน)"}
              </div>
            ))}
          </div>
          <p className="text-xs text-emerald-800 mt-3">
            ดูรายการทั้งหมดได้ที่แท็บ <strong>คาบของฉัน</strong> ·
            แจ้งครูที่รับสอนแทนด้วยนะครับ ระบบยังไม่ได้ส่งข้อความให้อัตโนมัติ
          </p>
        </section>
      )}

      <p className="text-[11px] text-slate-400 text-center">
        ผู้แจ้ง: {meName}
      </p>
    </div>
  );
};

// ── ตัวเลือกของคาบเดียว ──────────────────────────────────────────────────────

const FIT_STYLE: Record<number, string> = {
  4: "bg-emerald-100 text-emerald-800 border-emerald-300",
  3: "bg-emerald-50 text-emerald-700 border-emerald-200",
  2: "bg-sky-50 text-sky-700 border-sky-200",
  1: "bg-slate-100 text-slate-600 border-slate-300",
  0: "bg-slate-50 text-slate-500 border-slate-200",
};

const LessonOptions: React.FC<{
  unit: sub.SubLesson[];
  data?: { cover: sub.CoverCandidate[]; swap: sub.SwapRoute[]; unit: sub.SubLesson[]; owed: number };
  choice?: Choice;
  onChoose: (c: Choice) => void;
  onClear: () => void;
}> = ({ unit, data, choice, onChoose, onClear }) => {
  const [tab, setTab] = useState<"cover" | "swap">("cover");
  const [openSwap, setOpenSwap] = useState<number | null>(null);

  if (!data) return null;
  const none = data.cover.length === 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="font-bold text-slate-800 text-sm">
          {unit.map((l) => l.period_label || `คาบ ${l.period}`).join(" + ")}
          {unit.length > 1 && <span className="ml-1 text-[10px] bg-violet-100 text-violet-700 border border-violet-300 rounded px-1 py-0.5">คาบคู่</span>}
        </span>
        <span className="text-xs text-slate-500">
          {unit[0].start_time}–{unit[unit.length - 1].end_time}
        </span>
        <span className="text-sm text-slate-700">
          · {[...new Set(unit.map((l) => l.group_name))].join(", ")}
          {" · "}{[...new Set(unit.map((l) => l.subject_code))].join(", ")}
        </span>
        <div className="flex-1" />
        {choice && (
          <button onClick={onClear}
            className="text-xs text-slate-500 hover:text-red-600 underline">ล้างที่เลือก</button>
        )}
      </div>

      {none ? (
        <div className="p-4 text-sm text-amber-800 bg-amber-50">
          ไม่มีครูว่างในคาบนี้เลย — อาจต้องฝากคาบไว้กับฝ่ายวิชาการ
          หรือเปลี่ยนไปหาคนสอนแทนเฉพาะบางคาบ
        </div>
      ) : (
        <>
          <div className="flex gap-1 px-4 pt-3">
            <button onClick={() => setTab("cover")}
              className={clsx("px-3 py-1.5 rounded-lg text-xs font-semibold",
                tab === "cover" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600")}>
              สอนแทน — ไม่ต้องคืน ({data.cover.length})
            </button>
            <button onClick={() => setTab("swap")}
              className={clsx("px-3 py-1.5 rounded-lg text-xs font-semibold",
                tab === "swap" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600")}>
              แลกคาบ — ติดคืน {data.owed} คาบ ({data.swap.length})
            </button>
          </div>

          {tab === "cover" && (
            <div className="p-3 space-y-1.5">
              <p className="text-[11px] text-slate-500 px-1">
                ครูที่ว่างคาบนี้ เรียงจากคนที่สอนวิชานี้ได้ดีที่สุด · เลือกแล้วไม่ต้องไปคืนคาบให้
              </p>
              {data.cover.map((c) => {
                const on = choice?.mode === "cover" && choice.teacherId === c.teacher_id;
                return (
                  <button key={c.teacher_id}
                    onClick={() => onChoose({ mode: "cover", teacherId: c.teacher_id })}
                    className={clsx("w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors",
                      on ? "bg-blue-600 border-blue-700 text-white"
                         : "bg-white border-slate-200 hover:border-blue-400")}>
                    <span className="font-semibold text-sm flex-1 min-w-0 truncate">
                      {c.teacher_code ? `${c.teacher_code} ` : ""}{c.teacher_name}
                    </span>
                    <span className={clsx("text-[10px] px-1.5 py-0.5 rounded border shrink-0",
                      on ? "bg-blue-500 border-blue-400 text-white" : FIT_STYLE[c.score])}>
                      {c.reason}
                    </span>
                    <span className={clsx("text-[10px] shrink-0", on ? "text-blue-100" : "text-slate-400")}>
                      วันนั้นสอน {c.load_that_day} คาบ
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === "swap" && (
            <div className="p-3 space-y-2">
              <p className="text-[11px] text-slate-500 px-1">
                ครูที่ว่างคาบนี้ และคุณไปสอนคืนให้เขาได้ · เลือกครูก่อน แล้วเลือกวิธีคืนคาบ
              </p>
              {data.swap.length === 0 && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                  ไม่มีเส้นทางแลกคาบสำหรับคาบนี้ — คาบที่ครูท่านอื่นสอน
                  ไม่มีช่วงไหนที่คุณว่างพอจะไปคืนให้ได้ ใช้ "สอนแทน" แทนได้
                </p>
              )}
              {data.swap.map((r) => {
                const open = openSwap === r.teacher_id;
                const chosenHere = choice?.mode === "swap" && choice.teacherId === r.teacher_id;
                return (
                  <div key={r.teacher_id}
                    className={clsx("rounded-lg border overflow-hidden",
                      chosenHere ? "border-blue-500" : "border-slate-200")}>
                    <button onClick={() => setOpenSwap(open ? null : r.teacher_id)}
                      className="w-full flex items-center gap-2 p-2.5 text-left bg-white hover:bg-slate-50">
                      <span className="font-semibold text-sm flex-1 min-w-0 truncate">
                        {r.teacher_code ? `${r.teacher_code} ` : ""}{r.teacher_name}
                      </span>
                      <span className={clsx("text-[10px] px-1.5 py-0.5 rounded border shrink-0", FIT_STYLE[r.score])}>
                        {r.reason}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {r.plans.length} วิธีคืน {open ? "▾" : "▸"}
                      </span>
                    </button>

                    {open && (
                      <div className="border-t border-slate-200 bg-slate-50 p-2 space-y-1.5">
                        {r.plans.map((p, i) => {
                          const on = chosenHere && choice.planIndex === i;
                          return (
                            <button key={i}
                              onClick={() => onChoose({ mode: "swap", teacherId: r.teacher_id, planIndex: i })}
                              className={clsx("w-full text-left p-2.5 rounded-lg border transition-colors",
                                on ? "bg-blue-600 border-blue-700 text-white"
                                   : "bg-white border-slate-200 hover:border-blue-400")}>
                              <div className="text-xs font-bold">{p.label}</div>
                              <div className={clsx("text-[11px] mt-0.5 leading-relaxed",
                                on ? "text-blue-100" : "text-slate-600")}>
                                {p.slots.map((s, j) => (
                                  <div key={j}>
                                    คุณไปสอน {thaiDate(s.date)} คาบ {s.period} ·{" "}
                                    {s.group_name} {s.subject_code}
                                  </div>
                                ))}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};
