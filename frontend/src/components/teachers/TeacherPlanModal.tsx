/**
 * จัดคาบของครูคนนี้ — เลือกคาบ แล้วดูว่าย้ายไปไหนได้ และต้องทำอะไร
 *
 * "คาบครูบางท่านมีเยอะมากใน 1 วัน คุณช่วยมีระบบว่าถ้าจะย้ายคาบนี้จะต้องทำ
 *  ยังไง คือเราเลือกคาบมา ... ช่วยคิดระบบที่ตรวจว่าจะจัดคาบครูคนนี้ (สามารถ
 *  เลือกได้ว่าจะเอาเฉพาะคาบเดี่ยวหรือทั้งหมดหรือสามารถเลือกทีละหลาย ๆ คาบได้)"
 *
 * ต่างจากปุ่ม ⚖️ เกลี่ยคาบครู ที่ตัดสินใจแทนทั้งโรงเรียนในครั้งเดียว — หน้านี้
 * บอกทางเลือกแล้วให้คนเลือก: แต่ละที่ว่างอยู่เลยหรือต้องสลับกับคาบไหน ย้ายแล้ว
 * ภาระดีขึ้นเท่าไร และมีผลข้างเคียงกับใคร
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";

const DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์"];
type Scope = "all" | "singles" | "ids";

export const TeacherPlanModal: React.FC<{
  teacherId: number;
  onClose: () => void;
}> = ({ teacherId, onClose }) => {
  const { loadSlots, periods } = useTimetableStore();
  const [plan, setPlan] = useState<api.TeacherPlan | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [day, setDay] = useState<number | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  /** ชื่อคาบตามที่โรงเรียนตั้งไว้ ("คาบ 5" ไม่ใช่เลขในฐานข้อมูล) */
  const label = useCallback((n: number) => {
    const p = periods.find((x) => x.period_num === n && x.type === "class");
    return p?.label?.replace("คาบ ", "") ?? String(n);
  }, [periods]);

  const load = useCallback(async (sc: Scope, d: number | null, ids: Set<number>) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.fetchTeacherPlan({
        teacher_id: teacherId, scope: sc, day: d,
        slot_ids: sc === "ids" ? [...ids] : undefined,
      });
      setPlan(r);
      setChosen({});
    } catch (e) {
      const code = (e as { response?: { status?: number } })?.response?.status;
      setErr(code === 404
        ? "ตัวจัดตารางบนเซิร์ฟเวอร์ยังเป็นรุ่นเก่าที่ไม่มีหน้านี้ — "
          + "รออีกสองสามนาทีแล้วเปิดใหม่"
        : api.errorDetail(e, "อ่านตารางของครูคนนี้ไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }, [teacherId]);

  useEffect(() => { void load("all", null, new Set()); }, [load]);

  const lessons = plan?.lessons ?? [];
  const shown = useMemo(
    () => lessons.filter((l) => day == null || l.day === day),
    [lessons, day]);
  const picked = Object.keys(chosen).length;

  const apply = async () => {
    setBusy(true); setErr(null);
    const okMsgs: string[] = [];
    const bad: string[] = [];
    for (const [sid, idx] of Object.entries(chosen)) {
      const L = lessons.find((x) => x.slot_id === Number(sid));
      const o = L?.options[idx];
      if (!L || !o) continue;
      try {
        const r = await api.moveSlots(o.moves);
        if (r.ok) {
          okMsgs.push(`${L.group_name} ${L.subject_code} → ${DAYS[o.day]} `
            + `คาบ ${o.periods.map(label).join("+")}`);
        } else {
          bad.push(`${L.group_name} ${L.subject_code}: ${r.conflicts.join(" · ")}`);
        }
      } catch (e) {
        bad.push(`${L.group_name} ${L.subject_code}: `
          + api.errorDetail(e, "ย้ายไม่สำเร็จ"));
      }
    }
    await loadSlots();
    setDone(okMsgs);
    setErr(bad.length ? bad.join("\n") : null);
    await load(scope, day, ticked);
    setBusy(false);
  };

  const scopeBtn = (v: Scope, text: string) => (
    <button
      key={v}
      onClick={() => { setScope(v); void load(v, day, ticked); }}
      className={clsx("px-3 py-1 rounded text-xs font-medium border transition-colors",
        scope === v ? "bg-blue-600 border-blue-600 text-white"
          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50")}
    >{text}</button>
  );

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="px-5 py-3 border-b border-gray-200 flex items-start justify-between">
        <div>
          <h2 className="font-bold text-gray-900">
            จัดคาบของ {plan?.teacher.name ?? "ครู"}
          </h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            เลือกคาบที่อยากย้าย แล้วระบบบอกว่าไปลงที่ไหนได้ และต้องสลับกับคาบไหน
            {plan && ` · สอน ${plan.teacher.total} คาบ/สัปดาห์ · เพดาน `}
            {plan && `${plan.max_per_day} คาบ/วัน · ติดกันไม่เกิน ${plan.max_consecutive} คาบ`}
          </p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg px-1">✕</button>
      </div>

      <div className="px-5 py-2 border-b border-gray-100 flex flex-wrap items-center gap-2">
        {/* ภาระแต่ละวัน กดเพื่อดูเฉพาะวันนั้น */}
        {(plan?.days ?? []).map((d) => (
          <button
            key={d.day}
            onClick={() => { const nd = day === d.day ? null : d.day;
                             setDay(nd); void load(scope, nd, ticked); }}
            className={clsx("px-2 py-1 rounded text-[11px] border transition-colors",
              day === d.day ? "bg-gray-900 border-gray-900 text-white"
                : d.over ? "bg-red-50 border-red-300 text-red-700"
                : d.runs_over ? "bg-amber-50 border-amber-300 text-amber-800"
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}
            title={d.over ? "วันนี้เกินเพดาน"
              : d.runs_over ? "วันนี้มีคาบติดกันเกินเพดาน" : ""}
          >
            {DAYS[d.day]} {d.periods} คาบ{d.over ? " ⚠" : d.runs_over ? " ·" : ""}
          </button>
        ))}
        <span className="flex-1" />
        {scopeBtn("all", "ทุกคาบ")}
        {scopeBtn("singles", "เฉพาะคาบเดี่ยว")}
        {scopeBtn("ids", `เลือกเอง (${ticked.size})`)}
      </div>

      <div className="px-5 py-3 overflow-y-auto flex-1 space-y-2">
        {busy && !plan && <p className="text-xs text-gray-500">กำลังคิด…</p>}
        {done.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <div className="text-xs font-semibold text-emerald-800 mb-1">
              ย้ายแล้ว {done.length} คาบ
            </div>
            {done.map((m, i) => (
              <div key={i} className="text-[11px] text-emerald-700">· {m}</div>
            ))}
          </div>
        )}
        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3 whitespace-pre-line">{err}</div>
        )}
        {shown.map((L) => {
          const isOpen = open.has(L.slot_id);
          const sel = chosen[L.slot_id];
          return (
            <div key={L.slot_id}
                 className={clsx("border rounded-lg overflow-hidden",
                   sel !== undefined ? "border-blue-400 bg-blue-50/40" : "border-gray-200")}>
              <div className="flex items-center gap-2 px-3 py-2">
                {scope === "ids" && (
                  <input type="checkbox" checked={ticked.has(L.slot_id)}
                         onChange={(e) => {
                           const next = new Set(ticked);
                           if (e.target.checked) next.add(L.slot_id); else next.delete(L.slot_id);
                           setTicked(next);
                           void load("ids", day, next);
                         }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-900 truncate">
                    {L.group_name}
                    {L.group_count > 1 && (
                      <span className="text-gray-500 font-normal"> +{L.group_count - 1} ห้อง</span>
                    )}
                    {" "}{L.subject_code}
                    {L.is_double && (
                      <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-violet-100 text-violet-700">คาบคู่</span>
                    )}
                    {L.warn && (
                      <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-gray-200 text-gray-600">{L.warn}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {DAYS[L.day]} คาบ {L.periods.map(label).join("+")}
                    {L.room_name ? ` · ${L.room_name}` : " · ยังไม่มีห้อง"}
                    {L.subject_name ? ` · ${L.subject_name}` : ""}
                  </div>
                </div>
                {L.stuck ? (
                  <span className="text-[11px] text-gray-500 shrink-0 max-w-[45%] text-right">
                    {L.stuck}
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      const next = new Set(open);
                      if (isOpen) next.delete(L.slot_id); else next.add(L.slot_id);
                      setOpen(next);
                    }}
                    className="shrink-0 px-2 py-1 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {L.options.length === 0 ? "ไม่มีที่ว่างให้ย้าย"
                      : `${L.options.length} ที่ที่ย้ายได้`}
                    {(L.better ?? 0) > 0 && (
                      <span className="ml-1 text-emerald-700">· ช่วยได้ {L.better}</span>
                    )}
                    <span className="ml-1 text-[9px]">{isOpen ? "▲" : "▼"}</span>
                  </button>
                )}
              </div>
              {isOpen && !L.stuck && (
                <div className="border-t border-gray-100 bg-white">
                  {L.options.map((o, i) => (
                    <label key={i}
                      className="flex items-start gap-2 px-3 py-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50">
                      <input type="radio" name={`opt-${L.slot_id}`} className="mt-0.5"
                             checked={sel === i}
                             onChange={() => setChosen((m) => ({ ...m, [L.slot_id]: i }))} />
                      <span className="text-[11px] text-gray-700 flex-1">
                        <b>{DAYS[o.day]} คาบ {o.periods.map(label).join("+")}</b>
                        {" — "}
                        {o.kind === "ว่าง"
                          ? "ช่องนั้นว่างอยู่ ย้ายไปได้เลย"
                          : `ต้องสลับกับ ${o.with?.group_name ?? ""} ${o.with?.subject_code ?? ""}`}
                        {o.gain > 0
                          ? <span className="text-emerald-700"> · ภาระวันนั้นดีขึ้น</span>
                          : <span className="text-gray-400"> · ภาระไม่เปลี่ยน</span>}
                        {o.side.length > 0 && (
                          <span className="text-amber-700"> · {o.side.join(" · ")}</span>
                        )}
                      </span>
                    </label>
                  ))}
                  {sel !== undefined && (
                    <button onClick={() => setChosen((m) => {
                      const n = { ...m }; delete n[L.slot_id]; return n; })}
                      className="px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-800">
                      ยกเลิกที่เลือกไว้
                    </button>
                  )}
                  {L.blocked.length > 0 && (
                    <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                      <div className="text-[10px] font-semibold text-gray-500 mb-0.5">
                        ที่ลองแล้วไม่ได้ {L.blocked_total} ที่ — ตัวอย่าง
                      </div>
                      {L.blocked.slice(0, 4).map((b, i) => (
                        <div key={i} className="text-[10px] text-gray-500">
                          · {DAYS[b.day]} คาบ {label(b.period)} — {b.why}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {plan && shown.length === 0 && (
          <p className="text-xs text-gray-500">ไม่มีคาบตามเงื่อนไขที่เลือกไว้</p>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">
          {picked > 0 ? `เลือกไว้ ${picked} คาบ` : "ติ๊กที่ที่อยากย้ายในแต่ละคาบ"}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">ปิด</button>
          <button
            onClick={() => void load(scope, day, ticked)} disabled={busy}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
          >{busy ? "กำลังคิด…" : "คิดใหม่"}</button>
          <button
            onClick={() => void apply()} disabled={busy || picked === 0}
            className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300"
          >ย้ายที่เลือกไว้{picked > 0 ? ` (${picked})` : ""}</button>
        </div>
      </div>
    </ModalShell>
  );
};
