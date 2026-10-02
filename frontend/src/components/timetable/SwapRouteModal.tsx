/**
 * SwapRouteModal — shows the possible "replacement routes" (เส้นทางการแทนที่)
 * when a slot is dropped onto an occupied cell.
 *
 * Each route is a concrete plan: it lists every teacher that must move, the cell
 * they move from → to, and the room they will end up in (highlighting any room
 * number change). The user picks the route they prefer and it is applied in one
 * click.
 */
import React, { useState } from "react";
import { ModalShell } from "../common/ModalShell";
import clsx from "clsx";
import { DAYS, periodLabel, type Period, type TimetableSlot } from "../../types";
import type { SwapRoute, RouteStep } from "../../utils/swapPlanner";
import { slotLabel } from "../../utils/teacherSlots";

interface SwapRouteModalProps {
  moving:  TimetableSlot;
  target:  { day: number; period: number };
  routes:  SwapRoute[];
  periods: Period[];
  onApply: (route: SwapRoute) => void;
  onCancel: () => void;
}

const RISK_STYLES: Record<SwapRoute["risk"], { chip: string; label: string }> = {
  safe:   { chip: "bg-green-100 text-green-700",   label: "ปลอดภัย" },
  medium: { chip: "bg-amber-100 text-amber-700",   label: "ปานกลาง" },
  risky:  { chip: "bg-red-100 text-red-700",       label: "เสี่ยง" },
};

const KIND_ICON: Record<SwapRoute["kind"], string> = {
  direct:     "✅",
  "room-only":"🚪",
  "two-way":  "🔄",
  relocate:   "➡️",
  force:      "⚠️",
};

export const SwapRouteModal: React.FC<SwapRouteModalProps> = ({
  moving, target, routes, periods, onApply, onCancel,
}) => {
  const [selected, setSelected] = useState<string>(routes.find((r) => r.feasible)?.id ?? routes[0]?.id ?? "");
  const chosen = routes.find((r) => r.id === selected) ?? null;

  const cell = (d: number, p: number) => `${DAYS[d] ?? d} · ${periodLabel(p, periods)}`;

  return (
    <ModalShell onClose={onCancel} maxWidth="max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 bg-indigo-600 px-5 py-4 shrink-0">
          <span className="text-2xl">🧭</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base leading-tight">เลือกเส้นทางการแทนที่</h2>
            <p className="text-indigo-100 text-xs mt-0.5">
              ย้าย <strong>{slotLabel(moving)}</strong> ({moving.teacher_name}) ไปที่ {cell(target.day, target.period)}
              {" "}— มี {routes.length} เส้นทางให้เลือก
            </p>
          </div>
          <button onClick={onCancel} className="text-indigo-200 hover:text-white text-lg leading-none shrink-0">✕</button>
        </div>

        {/* Route list */}
        <div className="px-5 py-4 overflow-y-auto space-y-2.5">
          {routes.map((route) => {
            const isSel = route.id === selected;
            const risk = RISK_STYLES[route.risk];
            return (
              <button
                key={route.id}
                onClick={() => setSelected(route.id)}
                disabled={!route.feasible}
                className={clsx(
                  "w-full text-left rounded-xl border transition-all",
                  isSel ? "border-indigo-400 ring-2 ring-indigo-200 bg-indigo-50/40" : "border-gray-200 hover:border-indigo-300",
                  !route.feasible && "opacity-55",
                )}
              >
                {/* Route header */}
                <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-gray-100">
                  <span className="text-lg">{KIND_ICON[route.kind]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800">{route.title}</p>
                    <p className="text-xs text-gray-500">{route.summary}</p>
                  </div>
                  <span className={clsx("text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0", risk.chip)}>{risk.label}</span>
                </div>

                {/* Steps */}
                <div className="px-4 py-2.5 space-y-1.5">
                  {route.steps.map((step, i) => (
                    <StepRow key={i} step={step} periods={periods} />
                  ))}
                  {route.warnings.map((w, i) => (
                    <p key={`w${i}`} className="text-[11px] text-red-500 flex items-center gap-1">⛔ {w}</p>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-gray-100 flex items-center gap-2 shrink-0 bg-gray-50">
          <p className="text-xs text-gray-400 flex-1">
            💡 ตัวเลขห้องที่เปลี่ยนจะไฮไลต์สีส้ม เพื่อให้เช็คได้ว่าครูจะไปสอนที่ห้องไหน
          </p>
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg font-medium">ยกเลิก</button>
          <button
            onClick={() => chosen && onApply(chosen)}
            disabled={!chosen?.feasible}
            className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-40"
          >
            ใช้เส้นทางนี้
          </button>
        </div>
    </ModalShell>
  );
};

// ── One move line inside a route ─────────────────────────────────────────────
const StepRow: React.FC<{ step: RouteStep; periods: Period[] }> = ({ step, periods }) => {
  if (step.action === "delete") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-red-500">🗑️</span>
        <span className="font-medium text-gray-700 truncate">{step.label}</span>
        <span className="text-red-500">ถูกลบออกจาก {DAYS[step.fromDay]} {periodLabel(step.fromPeriod, periods)}</span>
      </div>
    );
  }

  const roomOnly = !step.cellChanged && step.roomChanged;
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-indigo-400 mt-0.5">{roomOnly ? "🚪" : "👣"}</span>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-gray-700">{step.label}</span>
        {/* Cell path */}
        {step.cellChanged && (
          <span className="text-gray-500">
            {" "}: {DAYS[step.fromDay]} {periodLabel(step.fromPeriod, periods)}
            <span className="mx-1 text-indigo-500 font-bold">→</span>
            {DAYS[step.toDay]} {periodLabel(step.toPeriod, periods)}
          </span>
        )}
        {/* Room path */}
        <div className="mt-0.5">
          {step.noRoomAvailable ? (
            <span className="text-red-500">ห้อง: ไม่มีห้องว่าง ⛔</span>
          ) : step.roomChanged ? (
            <span className="text-gray-500">
              ห้อง:{" "}
              <span className="line-through text-gray-400">{step.fromRoomName ?? "–"}</span>
              <span className="mx-1 text-orange-500 font-bold">→</span>
              <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-semibold">{step.toRoomName ?? "–"}</span>
            </span>
          ) : (
            <span className="text-gray-400">ห้อง: {step.toRoomName ?? "–"} (ไม่เปลี่ยน)</span>
          )}
        </div>
      </div>
    </div>
  );
};
