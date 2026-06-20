/**
 * SolverWidget — One-click auto-schedule panel.
 * Displays: pre-lock summary → solver params → progress → results.
 */
import React, { useState } from "react";
import clsx from "clsx";
import { useTimetableStore } from "../../store/timetableStore";
import type { SolverResult } from "../../types";

interface Props { onClose: () => void }

export const SolverWidget: React.FC<Props> = ({ onClose }) => {
  const { slots, isSolving, solverError, runSolver, groups, teachers, subjects } = useTimetableStore();

  const [timeLimitSec, setTimeLimitSec]   = useState(120);
  const [clearExisting, setClearExisting] = useState(true);
  const [result, setResult]               = useState<SolverResult | null>(null);

  const lockedSlots   = slots.filter((s) => s.is_locked);
  const unlockedSlots = slots.filter((s) => !s.is_locked);

  const handleSolve = async () => {
    try {
      const r = await runSolver(timeLimitSec);
      setResult(r);
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

        {/* ── Solver Params ────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">พารามิเตอร์</p>

          <div className="flex items-center justify-between gap-3">
            <label className="text-xs text-gray-300">เวลาสูงสุด (วินาที)</label>
            <input
              type="number" min={10} max={600} step={10}
              value={timeLimitSec}
              onChange={(e) => setTimeLimitSec(Number(e.target.value))}
              className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white text-right focus:ring-1 focus:ring-indigo-500 outline-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-300">
            <input
              type="checkbox"
              checked={clearExisting}
              onChange={(e) => setClearExisting(e.target.checked)}
              className="w-3.5 h-3.5 accent-indigo-500"
            />
            ล้างคาบเดิมก่อนคำนวณใหม่ (ยกเว้นล็อก)
          </label>
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
              {result.status === "OPTIMAL"   ? "✅ คำตอบที่เหมาะสมที่สุด" :
               result.status === "FEASIBLE"  ? "⚠️ คำตอบที่เป็นไปได้"    :
               result.status === "INFEASIBLE"? "❌ ไม่สามารถหาคำตอบได้"   :
                                               "❓ ไม่ทราบสถานะ"}
            </div>
            <ResultRow label="คาบที่สร้าง"   value={`${result.slots_created} คาบ`}         />
            <ResultRow label="เวลาคำนวณ"    value={`${result.solve_time_seconds.toFixed(2)} วิ`} />
            {result.objective_value != null && (
              <ResultRow label="ค่าปรับรวม" value={result.objective_value.toFixed(0)} />
            )}
            {result.violations.length > 0 && (
              <div className="mt-2 text-red-300 text-[10px] space-y-0.5">
                {result.violations.map((v, i) => <div key={i}>• {v}</div>)}
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
              กำลังคำนวณ ({timeLimitSec} วิ สูงสุด)…
            </span>
          ) : (
            "🚀 เริ่มคำนวณตาราง"
          )}
        </button>

        {/* ── Pipeline Steps ─────────────────────────────────────────────────── */}
        <div className="border-t border-gray-700 pt-3 space-y-1.5 text-[10px] text-gray-500">
          <PipelineStep done={true}  label="1. ตรวจสอบข้อกำหนดคาบ"           />
          <PipelineStep done={true}  label="2. นำเข้าเงื่อนไขห้องที่กำหนดพิเศษ" />
          <PipelineStep done={lockedSlots.length > 0} label={`3. ล็อกคาบล่วงหน้า ${lockedSlots.length} คาบ`} />
          <PipelineStep done={isSolving || !!result}  label="4. รันตัวแก้ปัญหา (CP-SAT)"                    />
          <PipelineStep done={!!result && !isSolving} label="5. บันทึกผลลัพธ์"                   />
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
