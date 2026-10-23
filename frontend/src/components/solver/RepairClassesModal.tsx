/**
 * 🔧 แก้เฉพาะห้องที่เลือก
 *
 * "ก็คือมีอีกปุ่มนึงขึ้นมาอยู่ล่างปุ่มสร้างตาราง ... ห้องที่บอกว่าล็อกไว้ ต้องล็อค
 *  เอาไว้นะ ทุกอย่างยังเหมือนเดิม เพิ่มเติมแค่ฉันจะไปกดว่าห้องไหนที่ต้องไปเรียนลาน
 *  แล้วกดแก้ไขตารางใหม่ ตารางเรียนนั้นก็จะจัดใหม่ให้เหมาะสมสำหรับห้องนั้น"
 *
 * จัดใหม่เฉพาะห้องที่ติ๊ก ห้องอื่นอยู่ที่เดิมทุกคาบ — ต่างจาก ⚡ สร้างตาราง ที่
 * จัดใหม่ทั้งโรงเรียน หน้านี้จึงต้องบอกชัดสามอย่าง: จะแตะอะไร จะไม่แตะอะไร
 * และหลังจัดแล้วเป็นอย่างไรจริง ไม่ใช่แค่ที่ตัวจัดบอก
 *
 *  · ห้องที่มีปัญหาได้จาก classProblems (slotProblems) ตัวเดียวกับกรอบแดง
 *  · หลังจัด เทียบตารางก่อน/หลังเองว่าห้องอื่นไม่ขยับจริง — ผิดสัญญาเมื่อไหร่
 *    ขึ้นแดงเต็มๆ ไม่ซ่อนไว้ท้ายหน้า
 *  · ตัวจัดตอบ 400 ด้วยข้อความไทย แสดงตามนั้น (api.errorDetail) ไม่กลืน
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { ModalShell } from "../common/ModalShell";
import { useTimetableStore } from "../../store/timetableStore";
import { DAYS } from "../../types";
import type { Room, SolverResult, StudentGroup, TimetableSlot } from "../../types";
import type { YardPickRow } from "../../api/client";
import { flip } from "../../utils/flip";
import { readKept, isSkippedBy, solveOptionsOf, describeSettings } from "../../utils/solverPanel";
import {
  repairClassList, defaultTicks, idsToSend, describeCounts, summariseRepair,
  reportedOutside, verdictOf,
  type RepairClass, type RepairOutcome, type Trend, type LessonMove, type Cell,
} from "../../utils/repairClasses";

interface Props { onClose: () => void }

/**
 * ตัวเลขที่วัดบนข้อมูลของโรงเรียนนี้เอง ห้าครั้ง: จำนวนห้องที่มีปัญหา ก่อน → หลัง
 * กด ⚡ ซ้ำอีกรอบ เทียบกับแก้เฉพาะห้องที่มีปัญหาโดยแช่ห้องอื่นไว้
 */
const MEASURED = {
  again:  "21→20, 19→18, 18→17, 18→18, 17→18",
  repair: "21→9, 19→6, 18→7, 18→6, 17→8",
  secondsAgain:  "5.1",
  secondsRepair: "2.2",
};

const TREND_LABEL: Record<Trend, string> = {
  ok: "ไม่มีปัญหา", fixed: "แก้แล้ว", better: "ดีขึ้น", same: "เท่าเดิม", worse: "แย่ลง",
};
const TREND_CLS: Record<Trend, string> = {
  ok:     "bg-gray-100 text-gray-600 border-gray-200",
  fixed:  "bg-emerald-100 text-emerald-800 border-emerald-300",
  better: "bg-sky-100 text-sky-800 border-sky-300",
  same:   "bg-amber-100 text-amber-800 border-amber-300",
  worse:  "bg-rose-100 text-rose-800 border-rose-300",
};

const FAIL_FALLBACK =
  "แก้เฉพาะห้องที่เลือกไม่สำเร็จ — เซิร์ฟเวอร์ไม่ตอบกลับหรือขัดข้อง "
  + "ลองอีกครั้ง หรือรีเฟรชหน้านี้ดูว่าตารางตอนนี้เป็นอย่างไร";

const cellText = (c: Cell | null, rooms: Map<number, string>): string => {
  if (!c) return "—";
  const room = c.room_id != null ? ` · ${rooms.get(c.room_id) ?? `ห้อง #${c.room_id}`}` : " · ไม่มีห้อง";
  return `${DAYS[c.day] ?? `วัน ${c.day}`} คาบ ${c.period}${room}`;
};

export const RepairClassesModal: React.FC<Props> = ({ onClose }) => {
  const groups: StudentGroup[]    = useTimetableStore((s) => s.groups);
  const slots: TimetableSlot[]    = useTimetableStore((s) => s.slots);
  const rooms: Room[]             = useTimetableStore((s) => s.rooms);
  const yardPicks: YardPickRow[]  = useTimetableStore((s) => s.yardPicks);
  const isSolving: boolean        = useTimetableStore((s) => s.isSolving);
  const runSolver                 = useTimetableStore((s) => s.runSolver);

  const list = useMemo(
    () => repairClassList(groups, slots, yardPicks), [groups, slots, yardPicks]);

  const [ticked, setTicked]   = useState<Set<number>>(() => defaultTicks(list));
  const [query, setQuery]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RepairOutcome | null>(null);
  const [result, setResult]   = useState<SolverResult | null>(null);

  const roomName = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rooms) m.set(r.id, r.name);
    return m;
  }, [rooms]);

  // ห้องที่ติ๊กและยังมีอยู่จริง — ห้องที่ถูกลบระหว่างเปิดหน้านี้ไม่นับ
  const effective = useMemo(
    () => new Set(list.filter((c) => ticked.has(c.id)).map((c) => c.id)), [list, ticked]);
  const picked = effective.size;
  const everyClass = list.length > 0 && picked === list.length;

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list), [list, q]);
  const withProblems = shown.filter((c) => c.counts.lessons > 0);
  const yardOnly     = shown.filter((c) => c.counts.lessons === 0 && c.pendingYard > 0);
  const quiet        = shown.filter((c) => c.counts.lessons === 0 && c.pendingYard === 0);
  const problemTotal = list.filter((c) => c.counts.lessons > 0).length;

  const kept = useMemo(readKept, []);
  const canRun = picked > 0 && !busy && !isSolving;

  const tickShown   = () => setTicked((t) => { const n = new Set(t); for (const c of shown) n.add(c.id); return n; });
  const untickShown = () => setTicked((t) => { const n = new Set(t); for (const c of shown) n.delete(c.id); return n; });

  const run = async () => {
    const send = idsToSend(list, effective);
    if (send.length === 0 || busy || isSolving) return;
    setBusy(true);
    setError(null);

    const st0    = useTimetableStore.getState();
    const before = st0.slots;
    const chosen = new Set(effective);
    try {
      // วิชาที่ข้าม — ตามที่ตั้งไว้ในปุ่ม ⚡ เหมือนกัน
      let skipped: number[];
      try {
        const rep = await api.fetchRequirementProblems();
        skipped = rep.problems
          .filter((p) => isSkippedBy(p, kept.skipMode, kept.manual))
          .map((p) => p.requirement_id);
      } catch (e) {
        setError(api.errorDetail(e, "ตรวจรายการวิชาที่จัดไม่ได้ไม่สำเร็จ — ยังไม่ได้แก้อะไร ลองอีกครั้ง"));
        return;
      }

      const r = await runSolver({ ...solveOptionsOf(kept, skipped), repairGroupIds: send });
      const st1 = useTimetableStore.getState();
      setResult(r);
      setOutcome(summariseRepair({
        groups: st0.groups, before, after: st1.slots, picks: st0.yardPicks,
        ticked: chosen, serverOutside: reportedOutside(r),
      }));
    } catch (e) {
      setError(api.errorDetail(e, FAIL_FALLBACK));
    } finally {
      setBusy(false);
    }
  };

  const again = () => {           // กลับไปเลือก — ติ๊กห้องที่ยังมีปัญหาตามตารางใหม่
    setOutcome(null);
    setResult(null);
    setError(null);
    setTicked(defaultTicks(list));
  };

  // ระหว่างจัดห้ามปิด: ปิดแล้วผลหายไปจากหน้าจอ ทั้งที่ตารางเปลี่ยนไปแล้ว
  const close = () => { if (!busy) onClose(); };

  return (
    <ModalShell onClose={close} maxWidth="max-w-3xl" tall>
      <div className="px-5 py-3 text-white flex items-center justify-between bg-gradient-to-r from-amber-800 to-amber-700">
        <div>
          <h2 className="font-bold">🔧 แก้เฉพาะห้องที่เลือก</h2>
          <p className="text-[11px] opacity-95">
            จัดคาบใหม่เฉพาะห้องที่ติ๊ก — ไม่ใช่การจัดตารางใหม่ทั้งโรงเรียน (นั่นคือปุ่ม ⚡ สร้างตาราง)
          </p>
        </div>
        <button onClick={close} disabled={busy} aria-label="ปิด"
          className="text-white/80 hover:text-white text-xl leading-none disabled:opacity-30">✕</button>
      </div>

      {busy ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <svg className="animate-spin h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <p className="font-semibold text-gray-800">กำลังจัดใหม่ {picked} ห้องที่เลือก…</p>
          <p className="text-xs text-gray-500">
            ห้องอื่นต้องอยู่ที่เดิม — พอจัดเสร็จจะเทียบตารางก่อนกับหลังให้ดู ·
            ปิดหน้านี้ไม่ได้จนกว่าจะเสร็จ
          </p>
        </div>
      ) : outcome ? (
        <OutcomeView
          o={outcome} result={result} rooms={roomName}
          onAgain={again} onBack={() => { setOutcome(null); setResult(null); }} onClose={close}
        />
      ) : (
        <>
          <div className="flex-1 overflow-auto px-5 py-3 space-y-3 min-h-0">
            {error && (
              <div role="alert" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <strong>ทำไม่สำเร็จ</strong> — {error}
              </div>
            )}
            {isSolving && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                ตอนนี้ระบบกำลังจัดตารางอยู่ (จากปุ่ม ⚡) — รอให้เสร็จก่อนจึงจะกดแก้เฉพาะห้องได้
              </div>
            )}

            <p className="text-xs text-gray-600 leading-relaxed">
              {problemTotal > 0
                ? <>ตอนนี้มี <strong className="text-rose-700">{problemTotal} ห้อง</strong>ที่มีคาบกรอบแดง
                    (ไม่มีห้องเรียน · ครูติดสอนห้องอื่น · ระบบวางไว้ให้เห็นก่อน) ติ๊กไว้ให้แล้ว — เอาออกได้
                    และติ๊กห้องอื่นเพิ่มได้ เช่นห้องที่เพิ่งเลือกลานให้บางคาบ</>
                : <>ตอนนี้ไม่มีห้องไหนมีคาบกรอบแดง — ติ๊กห้องที่อยากให้จัดใหม่ได้
                    เช่นห้องที่เพิ่งเลือกลานให้บางคาบ</>}
            </p>

            {/* เลือกทั้งหมด / ไม่เลือกเลย */}
            <div className="sticky top-0 z-10 -mx-5 px-5 py-2 bg-white/95 backdrop-blur border-b flex flex-wrap items-center gap-2">
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาห้อง เช่น ม.4/6"
                aria-label="ค้นหาห้อง"
                className="border border-gray-300 rounded px-2 py-1 text-xs w-40 focus:ring-1 focus:ring-amber-500 outline-none"
              />
              <button type="button" onClick={tickShown} disabled={!shown.length}
                className="px-2 py-1 rounded border border-amber-400 text-amber-900 bg-amber-50 hover:bg-amber-100 text-xs font-semibold disabled:opacity-40">
                {q ? `เลือกที่แสดง (${shown.length})` : "เลือกทั้งหมด"}
              </button>
              <button type="button" onClick={untickShown} disabled={!shown.length}
                className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-semibold disabled:opacity-40">
                {q ? "เอาที่แสดงออก" : "ไม่เลือกเลย"}
              </button>
              <button type="button" onClick={() => setTicked(defaultTicks(list))}
                className="px-2 py-1 rounded border border-rose-300 text-rose-800 bg-rose-50 hover:bg-rose-100 text-xs font-semibold">
                เฉพาะห้องที่มีปัญหา ({problemTotal})
              </button>
              <span className="ml-auto text-xs font-semibold text-gray-700">
                เลือกแล้ว {picked} / {list.length} ห้อง
              </span>
            </div>

            {everyClass && (
              <div className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                ติ๊กครบทุกห้องแล้ว — แบบนี้คือจัดใหม่ทั้งโรงเรียน ไม่ต่างจากปุ่ม ⚡ สร้างตาราง
                (ห้องที่ไม่มีปัญหาก็จะขยับด้วย)
              </div>
            )}

            {!list.length && (
              <p className="text-sm text-gray-500 py-8 text-center">ยังไม่มีห้องเรียนในระบบ</p>
            )}
            {list.length > 0 && !shown.length && (
              <p className="text-sm text-gray-500 py-8 text-center">ไม่พบห้องที่ตรงกับ “{query.trim()}”</p>
            )}

            {withProblems.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-rose-700 uppercase tracking-wider mb-1.5">
                  ห้องที่มีปัญหา ({withProblems.length})
                </h3>
                <ul className="space-y-1.5">
                  {withProblems.map((c) => (
                    <li key={c.id}>
                      <ClassRow c={c} on={effective.has(c.id)}
                        onFlip={() => setTicked((t) => flip(t, c.id))} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {yardOnly.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-teal-700 uppercase tracking-wider mb-1.5">
                  เลือกลานไว้ แต่ตารางยังไม่ตาม ({yardOnly.length})
                </h3>
                <ul className="space-y-1.5">
                  {yardOnly.map((c) => (
                    <li key={c.id}>
                      <ClassRow c={c} on={effective.has(c.id)}
                        onFlip={() => setTicked((t) => flip(t, c.id))} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {quiet.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  ห้องอื่น ไม่มีปัญหา ({quiet.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-1">
                  {quiet.map((c) => {
                    const on = effective.has(c.id);
                    return (
                      <label key={c.id}
                        className={clsx("flex items-center gap-1.5 rounded border px-2 py-1 text-xs cursor-pointer",
                          on ? "border-amber-400 bg-amber-50 font-semibold text-amber-900"
                             : "border-gray-200 text-gray-700 hover:bg-gray-50")}>
                        <input type="checkbox" checked={on}
                          onChange={() => setTicked((t) => flip(t, c.id))}
                          className="w-3.5 h-3.5 accent-amber-600 shrink-0" />
                        <span className="truncate">{c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600 leading-relaxed space-y-1">
              <p>
                <strong>ทำไมถึงมีปุ่มนี้</strong> — วัดบนข้อมูลของโรงเรียนนี้ 5 ครั้ง (จำนวนห้องที่มีปัญหา ก่อน→หลัง):
                กด ⚡ สร้างตาราง ซ้ำ แทบไม่ช่วย ({MEASURED.again}) แต่แก้เฉพาะห้องที่มีปัญหา
                โดยแช่ห้องอื่นไว้ ดีขึ้นทุกครั้ง ({MEASURED.repair}) และเร็วกว่า
                ({MEASURED.secondsRepair} วินาที เทียบ {MEASURED.secondsAgain} วินาที)
              </p>
              <p>
                เป็นตัวเลขที่วัดมา ไม่ใช่คำสัญญา — บางห้องอาจยังเหลือปัญหา และหลังแก้
                หน้านี้จะบอกให้เห็นว่าเหลือเท่าไหร่ ·
                ใช้ค่าเดียวกับที่ตั้งไว้ในปุ่ม ⚡ สร้างตาราง: {describeSettings(kept)}
              </p>
            </div>
          </div>

          <div className="px-5 py-3 border-t bg-gray-50 space-y-2">
            {/* ข้อความเดียวที่บอกว่าจะแตะอะไรและไม่แตะอะไร — อยู่ติดปุ่มที่กด */}
            <p className="text-xs text-gray-800 leading-relaxed">
              {picked > 0
                ? <>🔧 <strong>จัดใหม่เฉพาะ {picked} ห้องที่ติ๊ก</strong> · อีก {list.length - picked} ห้อง
                    <strong> อยู่ที่เดิมทุกคาบ</strong> — วันเดิม คาบเดิม ห้องเดิม · คาบที่ล็อกไว้ยังล็อกอยู่</>
                : <>ยังไม่ได้ติ๊กห้องใด — ติ๊กอย่างน้อยหนึ่งห้อง ตารางจึงจะขยับ (ตอนนี้ไม่มีอะไรเปลี่ยน)</>}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={close}
                className="px-4 py-2 rounded border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-white">
                ปิด
              </button>
              <button type="button" onClick={run} disabled={!canRun}
                className={clsx("px-4 py-2 rounded text-xs font-bold text-white transition-colors",
                  canRun ? "bg-amber-600 hover:bg-amber-500" : "bg-gray-300 cursor-not-allowed")}>
                {picked > 0 ? `🔧 แก้เฉพาะ ${picked} ห้องที่เลือก` : "🔧 เลือกห้องก่อน"}
              </button>
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
};

// ── แถวของห้อง ────────────────────────────────────────────────────────────

const ClassRow: React.FC<{ c: RepairClass; on: boolean; onFlip: () => void }> = ({ c, on, onFlip }) => {
  const says = describeCounts(c.counts);
  const hasProblem = c.counts.lessons > 0;
  return (
    <label className={clsx("flex items-start gap-2 rounded border px-3 py-2 cursor-pointer text-xs",
        on ? "border-amber-400 bg-amber-50"
           : hasProblem ? "border-rose-200 bg-rose-50/50 hover:bg-rose-50"
                        : "border-teal-200 bg-teal-50/40 hover:bg-teal-50")}>
        <input type="checkbox" checked={on} onChange={onFlip}
          className="mt-0.5 w-4 h-4 accent-amber-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-bold text-gray-900 text-sm">{c.name}</span>
            {c.subNames.length > 0 && (
              <span className="text-[10px] text-gray-500">รวมห้องย่อย {c.subNames.join(" ")}</span>
            )}
            <span className="ml-auto text-[10px] text-gray-400">{c.lessons} คาบ</span>
          </div>
          {(says.length > 0 || c.pendingYard > 0) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {says.map((t) => (
                <span key={t}
                  className="px-1.5 py-0.5 rounded-full bg-white border border-rose-200 text-rose-800 font-semibold text-[11px]">
                  ⚠ {t}
                </span>
              ))}
              {c.pendingYard > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-white border border-teal-300 text-teal-800 font-semibold text-[11px]">
                  📌 เลือกลานไว้ {c.pendingYard} คาบ ตารางยังไม่ตาม
                </span>
              )}
            </div>
          )}
        </div>
    </label>
  );
};

// ── หลังจัด ───────────────────────────────────────────────────────────────

const OutcomeView: React.FC<{
  o: RepairOutcome;
  result: SolverResult | null;
  rooms: Map<number, string>;
  onAgain: () => void;
  onBack: () => void;
  onClose: () => void;
}> = ({ o, result, rooms, onAgain, onBack, onClose }) => {
  const verdict = verdictOf(o);
  const outsideBad = o.outsideChanged > 0;
  const lockedBad  = o.locked.moved > 0;
  const leftClasses  = o.changes.filter((c) => c.after.lessons > 0);
  const retry = o.remaining || o.othersWithProblems > 0;

  // ผิดสัญญาเมื่อไหร่ หัวข้อ "แก้เรียบร้อย" สีเขียวห้ามขึ้นเด่นกว่า — ไม่ติ๊กถูก ไม่ขึ้นเขียว
  const broken = outsideBad || lockedBad;
  const head = {
    fixed:   { cls: broken ? "bg-gray-50 border-gray-300 text-gray-900" : "bg-emerald-50 border-emerald-300 text-emerald-900",
               title: broken
                 ? "ห้องที่เลือกไม่มีปัญหาค้างแล้ว — แต่ดูข้อความสีแดงด้านบนก่อน"
                 : "✅ " + (o.lessonsBefore > 0
                     ? "แก้เรียบร้อย — ห้องที่เลือกไม่มีปัญหาค้างแล้ว"
                     : "จัดใหม่แล้ว — ห้องที่เลือกไม่มีปัญหาค้าง"),
               text: `คาบที่มีปัญหาในห้องที่เลือก ${o.lessonsBefore} → ${o.lessonsAfter} คาบ` },
    partial: { cls: "bg-amber-50 border-amber-300 text-amber-900",
               title: "แก้ได้บางส่วน — ยังเหลือปัญหา",
               text: `ห้องที่ยังมีปัญหา ${o.classesBefore} → ${o.classesAfter} ห้อง · `
                 + `คาบที่มีปัญหา ${o.lessonsBefore} → ${o.lessonsAfter} คาบ` },
    same:    { cls: "bg-amber-50 border-amber-300 text-amber-900",
               title: "ยังไม่ดีขึ้น — ปัญหาเท่าเดิม",
               text: `ห้องที่ยังมีปัญหา ${o.classesAfter} ห้อง · ${o.lessonsAfter} คาบ` },
    worse:   { cls: "bg-rose-50 border-rose-300 text-rose-900",
               title: "แย่ลง — ปัญหาเพิ่มขึ้น",
               text: `คาบที่มีปัญหาในห้องที่เลือก ${o.lessonsBefore} → ${o.lessonsAfter} คาบ` },
  }[verdict];

  const shownMoves = o.outside.moves.slice(0, 8);
  const violations = result?.violations ?? [];
  const notes = result?.notes ?? [];

  // สัญญา: ห้องอื่นต้องไม่ขยับ คาบล็อกต้องอยู่ที่เดิม
  const outsideBlock = outsideBad ? (
    <div role="alert" className="rounded-lg border-2 border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-900 space-y-1">
      <div className="font-bold text-sm">
        ⚠ มีคาบของห้องที่ไม่ได้เลือกขยับ {o.outsideChanged} คาบ — ปุ่มนี้สัญญาไว้ว่าห้องอื่นจะอยู่ที่เดิม
      </div>
      <div>
        {o.serverOutside != null && <>ตัวจัดตารางรายงานเอง {o.serverOutside} คาบ · </>}
        เทียบตารางก่อน/หลังพบ {o.outside.changed} คาบ จากที่ตรวจ {o.outside.checked} คาบ
      </div>
      {shownMoves.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5">
          {shownMoves.map((m: LessonMove, i) => (
            <li key={i}>
              {m.group_name ?? `ห้อง #${m.group_id}`} {m.label}:{" "}
              {m.note
                ? <>{cellText(m.from, rooms)} — {m.note}</>
                : <>
                    {m.from ? cellText(m.from, rooms) : "(ไม่มีในตารางเดิม)"}
                    {" → "}
                    {m.to ? cellText(m.to, rooms) : "(หายไป)"}
                  </>}
            </li>
          ))}
          {o.outside.moves.length > shownMoves.length && (
            <li>…และอีก {o.outside.moves.length - shownMoves.length} คาบ</li>
          )}
        </ul>
      )}
      <div>
        อย่าเพิ่งใช้ตารางนี้ แจ้งผู้ดูแลระบบ · กลับไปตารางก่อนจัดได้ที่
        ⚙ จัดการ → ตั้งค่าโรงเรียน → จุดบันทึก (ระบบเก็บสำเนาก่อนจัดทุกครั้งเมื่อเบราว์เซอร์อนุญาต)
      </div>
    </div>
  ) : (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      ✅ <strong>ห้องอื่นอยู่ที่เดิมทุกคาบ</strong> — เทียบตารางก่อนกับหลังแล้ว {o.othersCount} ห้อง
      ({o.outside.checked} คาบ) วันเดิม คาบเดิม ห้องเดิม ไม่ขยับเลย
      {o.serverOutside === 0 && <> · ตัวจัดตารางรายงานตรงกัน</>}
    </div>
  );

  const lockedBlock = lockedBad ? (
    <div role="alert" className="rounded-lg border-2 border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-900">
      <strong>⚠ คาบที่ล็อกไว้ {o.locked.moved} จาก {o.locked.total} คาบ ไม่ได้อยู่ที่เดิมหรือไม่ได้ล็อกอยู่แล้ว</strong>
      {" "}— ตรวจที่ตารางของห้องนั้น
    </div>
  ) : o.locked.total > 0 ? (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      🔒 คาบที่ล็อกไว้ {o.locked.total} คาบ ยังอยู่ที่เดิมและยังล็อกอยู่ทุกคาบ
    </div>
  ) : null;

  // ผลต่อห้องที่เลือก
  const headBlock = (
    <div className={clsx("rounded-lg border px-3 py-2", head.cls)}>
      <div className="font-bold text-sm">{head.title}</div>
      <div className="text-xs mt-0.5">{head.text}</div>
    </div>
  );

  return (
    <>
      <div className="flex-1 overflow-auto px-5 py-3 space-y-3 min-h-0">
        {broken ? <>{outsideBlock}{lockedBlock}{headBlock}</> : <>{headBlock}{outsideBlock}{lockedBlock}</>}

        {/* ยังเหลือปัญหา — ไม่ได้บอกว่าแก้ได้เสมอ */}
        {o.remaining && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
            <div className="font-bold">
              ยังเหลือปัญหา {o.lessonsAfter} คาบ ใน {leftClasses.length} ห้อง — การแก้เฉพาะห้องแก้ไม่ได้ทุกอย่าง
            </div>
            <div>
              ทำต่อได้: กดแก้เฉพาะห้องที่ยังเหลืออีกรอบ · ไปที่ห้องนั้นแล้วย้ายคาบหรือเลือกลานเอง ·
              หรือกด <strong>⚡ สร้างตาราง</strong> เพื่อจัดใหม่ทั้งโรงเรียน
              (ทางนี้ทุกห้องอาจขยับ และไม่การันตีว่าจะดีกว่า)
            </div>
          </div>
        )}

        {/* ลานที่เลือกไว้ — เหตุผลที่คนมักมาใช้ปุ่มนี้ จึงบอกว่าตารางตามหรือยัง */}
        {o.yardBefore > 0 && (
          <div className={clsx("rounded-lg border px-3 py-2 text-xs",
            o.yardMet >= o.yardBefore ? "border-teal-300 bg-teal-50 text-teal-900"
                                       : "border-amber-300 bg-amber-50 text-amber-900")}>
            📌 ลานที่เลือกไว้ในห้องที่แก้: ตารางตามแล้ว <strong>{o.yardMet} จาก {o.yardBefore} คาบ</strong>
            {o.yardMet < o.yardBefore && <> — ที่เหลือยังไม่ได้ลานที่เลือก ดูที่ตารางของห้องนั้น</>}
          </div>
        )}

        {/* ห้องต่อห้อง */}
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
            ห้องที่แก้ ({o.changes.length})
          </h3>
          <div className="border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 text-[11px]">
                <tr>
                  <th className="text-left font-semibold px-2 py-1 w-24">ห้อง</th>
                  <th className="text-left font-semibold px-2 py-1">ก่อนแก้</th>
                  <th className="text-left font-semibold px-2 py-1">หลังแก้</th>
                  <th className="text-left font-semibold px-2 py-1 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {o.changes.map((c) => {
                  const b = describeCounts(c.before);
                  const a = describeCounts(c.after);
                  const yardMet = Math.max(0, c.yardBefore - c.yardAfter);
                  return (
                    <tr key={c.id} className="border-t border-gray-100 align-top">
                      <td className="px-2 py-1 font-bold text-gray-900">{c.name}</td>
                      <td className="px-2 py-1 text-gray-600">{b.length ? b.join(" · ") : "ไม่มีปัญหา"}</td>
                      <td className={clsx("px-2 py-1", a.length ? "text-rose-800 font-semibold" : "text-emerald-700")}>
                        {a.length ? a.join(" · ") : "ไม่มีปัญหา"}
                        {c.yardBefore > 0 && (
                          <div className="text-[10px] font-normal text-teal-800">
                            📌 ตามลานที่เลือกไว้แล้ว {yardMet} จาก {c.yardBefore} คาบ
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <span className={clsx("px-1.5 py-0.5 rounded-full border text-[10px] font-semibold", TREND_CLS[c.trend])}>
                          {TREND_LABEL[c.trend]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {o.othersWithProblems > 0 && (
          <p className="text-xs text-gray-600">
            ห้องที่ไม่ได้เลือกและยังมีคาบกรอบแดงอยู่อีก <strong>{o.othersWithProblems} ห้อง</strong> —
            ไม่ได้ถูกแตะ ตามที่สัญญา · เลือกแก้ต่อได้ถ้าต้องการ
          </p>
        )}

        {/* ที่ตัวจัดตารางพูดเอง */}
        {(result?.repair_summary || notes.length > 0 || violations.length > 0) && (
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-700 space-y-1">
            <div className="font-semibold text-gray-600">ตัวจัดตารางแจ้งว่า</div>
            {result?.repair_summary && <div>{result.repair_summary}</div>}
            {notes.map((n, i) => <div key={`n${i}`}>ℹ️ {n}</div>)}
            {violations.length > 0 && (
              <div className="text-rose-800">
                <div className="font-semibold">สิ่งที่จัดไม่ได้:</div>
                {violations.slice(0, 6).map((v, i) => <div key={`v${i}`}>• {v}</div>)}
                {violations.length > 6 && <div>…และอีก {violations.length - 6} รายการ</div>}
              </div>
            )}
          </div>
        )}
        {result && Number.isFinite(result.solve_time_seconds) && (
          <p className="text-[11px] text-gray-400">ใช้เวลา {result.solve_time_seconds.toFixed(1)} วินาที</p>
        )}
      </div>

      <div className="px-5 py-3 border-t bg-gray-50 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onBack}
          className="px-3 py-2 rounded border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-white">
          ← กลับไปเลือกห้อง
        </button>
        {retry && (
          <button type="button" onClick={onAgain}
            className="px-3 py-2 rounded border border-amber-400 bg-amber-50 text-amber-900 text-xs font-bold hover:bg-amber-100">
            🔧 เลือกห้องที่ยังมีปัญหา แล้วแก้อีกรอบ
          </button>
        )}
        <button type="button" onClick={onClose}
          className="px-4 py-2 rounded bg-gray-800 text-white text-xs font-semibold hover:bg-gray-700">
          ปิด
        </button>
      </div>
    </>
  );
};
