/**
 * SolverWidget — One-click auto-schedule panel.
 * Displays: pre-lock summary → solver params → progress → results.
 */
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import type { RequirementProblem, SolverResult } from "../../types";

/** How much of the problem list to leave out of a run. */
type SkipMode = "none" | "blocking" | "all";

interface Props { onClose: () => void }

export const SolverWidget: React.FC<Props> = ({ onClose }) => {
  const { slots, isSolving, solverError, runSolver, groups, teachers, subjects } = useTimetableStore();

  const [clearExisting, setClearExisting] = useState(true);
  const [result, setResult]               = useState<SolverResult | null>(null);

  // วิชาที่มีปัญหา — found before the run so they can be left out of it.
  const [problems, setProblems] = useState<RequirementProblem[]>([]);
  const [skipMode, setSkipMode] = useState<SkipMode>("blocking");
  const [showList, setShowList] = useState(false);
  // Rows the user ticked back ON or OFF by hand, overriding the mode.
  const [manual, setManual] = useState<Record<number, boolean>>({});

  const loadProblems = () =>
    api.fetchRequirementProblems()
      .then((r) => setProblems(r.problems))
      .catch(() => setProblems([]));
  useEffect(() => { loadProblems(); }, []);

  const blocking = problems.filter((p) => p.severity === "blocking");

  /** Does the current setting leave this requirement out? */
  const isSkipped = (p: RequirementProblem) => {
    if (p.requirement_id in manual) return manual[p.requirement_id];
    return skipMode === "all" || (skipMode === "blocking" && p.severity === "blocking");
  };
  const skippedIds = useMemo(
    () => problems.filter(isSkipped).map((p) => p.requirement_id),
    [problems, skipMode, manual],
  );

  const lockedSlots   = slots.filter((s) => s.is_locked);
  const unlockedSlots = slots.filter((s) => !s.is_locked);

  const handleSolve = async () => {
    try {
      const r = await runSolver({ excludeRequirementIds: skippedIds });
      setResult(r);
      await loadProblems();    // the run may have changed what fails
    } catch {
      /* error stored in store.solverError */
    }
  };

  const STATUS_STYLES: Record<string, string> = {
    OPTIMAL:    "bg-green-900/50 border-green-500 text-green-200",
    FEASIBLE:   "bg-blue-900/50  border-blue-500  text-blue-200",
    INFEASIBLE: "bg-red-900/50   border-red-500   text-red-200",
    UNKNOWN:    "bg-gray-800     border-gray-600  text-gray-300",
  };

  return (
    <div className="w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl text-white overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-indigo-900/60 border-b border-indigo-800">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="font-bold text-sm">ระบบสร้างตารางอัตโนมัติ</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">✕</button>
      </div>

      <div className="p-4 space-y-4">
        {/* ── Pre-lock summary ────────────────────────────────────────────── */}
        <div className="bg-gray-800 rounded-lg p-3 space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">สถานะก่อนคำนวณ</p>

          <StatRow icon="🔒" label="คาบที่ล็อกแล้ว (จะไม่ถูกแตะ)" value={lockedSlots.length} color="text-amber-400" />
          <StatRow icon="🔓" label="คาบที่จะคำนวณใหม่"             value={clearExisting ? "ทั้งหมด" : unlockedSlots.length} color="text-blue-400" />
          <StatRow icon="👥" label="ห้องเรียน"   value={groups.length}   color="text-green-400" />
          <StatRow icon="👨‍🏫" label="ครูผู้สอน"  value={teachers.length} color="text-green-400" />
          <StatRow icon="📚" label="วิชาเรียน"   value={subjects.length} color="text-green-400" />
        </div>

        {/* ── Engine note ─────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">ตัวจัดตาราง</p>
          <div className="bg-indigo-900/30 border border-indigo-700/50 rounded p-2 text-[11px] text-indigo-200/90 leading-relaxed">
            ใช้ <strong>CP-SAT (OR-Tools)</strong> หาคำตอบที่ดีที่สุด — จัดครบทุกเงื่อนไข
            และ<strong>ลดการเดินของนักเรียน/ครู</strong> (อยู่ห้องประจำให้มากที่สุด)
            ถ้าเซิร์ฟเวอร์ยังไม่มี OR-Tools จะสลับไปใช้ตัวสำรอง (heuristic เร็ว) อัตโนมัติ
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-300">
            <input
              type="checkbox"
              checked={clearExisting}
              onChange={(e) => setClearExisting(e.target.checked)}
              className="w-3.5 h-3.5 accent-indigo-500"
            />
            ล้างคาบเดิมก่อนคำนวณใหม่ (ยกเว้นคาบที่ล็อก)
          </label>
        </div>

        {/* ── วิชาที่มีปัญหา ───────────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            วิชาที่มีปัญหา
          </p>

          {problems.length === 0 ? (
            <p className="text-[11px] text-green-400/90 bg-green-900/20 border border-green-800/50 rounded p-2">
              ✓ ตรวจแล้วไม่พบวิชาที่จัดลงตารางไม่ได้
            </p>
          ) : (
            <>
              <div className="bg-amber-900/20 border border-amber-800/50 rounded p-2 text-[11px] text-amber-200/90 leading-relaxed">
                พบ <strong>{problems.length}</strong> วิชาที่อาจจัดลงไม่ได้
                {blocking.length > 0 && <> — <strong className="text-red-300">{blocking.length}</strong> วิชาจัดไม่ได้แน่นอน</>}
                <br />
                เลือกได้ว่าจะไม่นำวิชาเหล่านี้มาลงตาราง เพื่อให้วิชาที่เหลือจัดได้ครบ
              </div>

              <div className="space-y-1">
                {([
                  ["blocking", `ข้ามเฉพาะที่จัดไม่ได้แน่นอน (${blocking.length} วิชา)`],
                  ["all",      `ข้ามทุกวิชาที่มีปัญหา (${problems.length} วิชา)`],
                  ["none",     "ไม่ข้าม — ลองจัดให้ครบทุกวิชา"],
                ] as [SkipMode, string][]).map(([mode, label]) => (
                  <label key={mode} className="flex items-center gap-2 cursor-pointer text-[11px] text-gray-300">
                    <input
                      type="radio" name="skipmode" checked={skipMode === mode}
                      onChange={() => { setSkipMode(mode); setManual({}); }}
                      className="w-3 h-3 accent-amber-500"
                    />
                    {label}
                  </label>
                ))}
              </div>

              <button
                onClick={() => setShowList((v) => !v)}
                className="text-[11px] text-indigo-300 hover:text-indigo-200 hover:underline"
              >
                {showList ? "▾ ซ่อนรายการ" : `▸ ดูรายการ (จะข้าม ${skippedIds.length} วิชา)`}
              </button>

              {showList && (
                <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-700 rounded p-1.5 bg-gray-950/60">
                  {problems.map((p) => {
                    const off = isSkipped(p);
                    return (
                      <label key={p.requirement_id}
                        className="flex items-start gap-1.5 text-[10px] cursor-pointer hover:bg-gray-800/60 rounded px-1 py-0.5">
                        <input
                          type="checkbox" checked={off}
                          onChange={(e) => setManual((m) => ({ ...m, [p.requirement_id]: e.target.checked }))}
                          className="mt-0.5 w-3 h-3 accent-amber-500 shrink-0"
                        />
                        <span className={clsx("flex-1 min-w-0", off ? "text-gray-500 line-through" : "text-gray-300")}>
                          <span className="font-mono">{p.subject_code}</span>{" "}
                          {p.group_name} · {p.teacher_name}
                          <span className="block text-amber-400/80 no-underline">
                            {p.severity === "blocking" ? "✕ " : "⚠ "}{p.reasons.join(" · ")}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {solverError && (
          <div className="bg-red-900/40 border border-red-700 rounded p-2 text-xs text-red-300">
            {solverError}
          </div>
        )}

        {/* ── Result ────────────────────────────────────────────────────────── */}
        {result && !isSolving && (
          <div className={clsx("rounded-lg border p-3 text-xs space-y-1", STATUS_STYLES[result.status] ?? STATUS_STYLES.UNKNOWN)}>
            <div className="font-bold text-sm mb-2">
              {result.status === "OPTIMAL"    ? "✅ ตารางที่ดีที่สุด (เดินน้อยสุด)" :
               result.status === "FEASIBLE"   ? "✅ จัดตารางสำเร็จ (ครบทุกเงื่อนไข)" :
               result.status === "INFEASIBLE" ? "❌ จัดไม่ครบ — มีข้อกำหนดที่ลงไม่ได้" :
                                                "❓ ไม่ทราบสถานะ"}
            </div>
            <ResultRow label="คาบที่จัดได้" value={`${result.slots_created} คาบ`} />
            {(result.skipped_requirement_ids?.length ?? 0) > 0 && (
              <ResultRow label="วิชาที่ข้ามไว้" value={`${result.skipped_requirement_ids!.length} วิชา`} />
            )}
            <ResultRow label="เวลาที่ใช้"  value={`${result.solve_time_seconds.toFixed(1)} วิ`} />
            <ResultRow label="ตัวจัดตาราง" value={
              result.engine === "cp-sat" ? "CP-SAT (ดีที่สุด)" :
              result.engine === "greedy-fallback" ? "สำรอง (heuristic)" :
              "heuristic"} />
            {result.status === "OPTIMAL" && result.objective_value != null && (
              <ResultRow label="คะแนนการเดิน" value={`${result.objective_value.toFixed(0)} (ยิ่งต่ำยิ่งดี)`} />
            )}
            {result.violations.length > 0 && (
              <div className="mt-2 text-red-300 text-[10px] space-y-0.5">
                <div className="font-semibold">สิ่งที่จัดไม่ได้:</div>
                {result.violations.map((v, i) => <div key={i}>• {v}</div>)}
                <div className="mt-1 text-amber-300/80">แนวทางแก้: ลดคาบ/สัปดาห์ เพิ่มครูหรือห้อง หรือปลดล็อกบางคาบ แล้วกดใหม่</div>
                {(result.unplaced_requirement_ids?.length ?? 0) > 0 && (
                  <button
                    onClick={() => {
                      const add: Record<number, boolean> = {};
                      for (const id of result.unplaced_requirement_ids ?? []) add[id] = true;
                      setManual((m) => ({ ...m, ...add }));
                      setShowList(true);
                      loadProblems();
                    }}
                    className="mt-1.5 w-full px-2 py-1 rounded bg-amber-700/40 border border-amber-600/60 text-amber-100 text-[10px] hover:bg-amber-700/60"
                  >
                    ข้าม {result.unplaced_requirement_ids!.length} วิชาที่จัดไม่ได้นี้ แล้วกดจัดใหม่
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── CTA Button ────────────────────────────────────────────────────── */}
        <button
          onClick={handleSolve}
          disabled={isSolving}
          className={clsx(
            "w-full py-2.5 rounded-lg text-sm font-bold transition-all",
            isSolving
              ? "bg-gray-700 text-gray-400 cursor-not-allowed"
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40",
          )}
        >
          {isSolving ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              กำลังจัดตาราง…
            </span>
          ) : (
            "🚀 เริ่มจัดตารางอัตโนมัติ"
          )}
        </button>

        {/* ── Pipeline Steps ─────────────────────────────────────────────────── */}
        <div className="border-t border-gray-700 pt-3 space-y-1.5 text-[10px] text-gray-500">
          <PipelineStep done={!!result || isSolving} label="1. อ่านข้อกำหนดคาบ + เงื่อนไขห้อง" />
          <PipelineStep done={lockedSlots.length > 0} label={`2. กันคาบที่ล็อกไว้ ${lockedSlots.length} คาบ`} />
          <PipelineStep done={isSolving || !!result} label="3. หาคำตอบ (CP-SAT / สำรอง) กันชนครู/ห้อง/นักเรียน" />
          <PipelineStep done={!!result && !isSolving} label="4. บันทึกผลลัพธ์" />
        </div>
      </div>
    </div>
  );
};

const StatRow: React.FC<{ icon: string; label: string; value: string | number; color: string }> = ({ icon, label, value, color }) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-gray-400">{icon} {label}</span>
    <span className={clsx("font-bold", color)}>{value}</span>
  </div>
);

const ResultRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="opacity-80">{label}</span>
    <span className="font-bold">{value}</span>
  </div>
);

const PipelineStep: React.FC<{ done: boolean; label: string }> = ({ done, label }) => (
  <div className={clsx("flex items-center gap-1.5 transition-colors", done ? "text-green-500" : "text-gray-600")}>
    <span>{done ? "✓" : "○"}</span>
    <span>{label}</span>
  </div>
);
