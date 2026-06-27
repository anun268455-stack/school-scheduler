import React from "react";
import clsx from "clsx";
import type { TimetableSlot } from "../../types";

interface SlotCellProps {
  slots:       TimetableSlot[];
  isDragging?: boolean;
  isOver?:     boolean;
  onLock?:     (id: number) => void;
  onDelete?:   (id: number) => void;
  onSwapRoom?: (slot: TimetableSlot) => void;
  onOpenElective?: (slot: TimetableSlot) => void;
  compact?:    boolean;
}

function slotColors(s: TimetableSlot): string {
  if (s.is_elective)            return "bg-purple-50 border-purple-300 text-purple-900";
  if (s.is_locked)              return "bg-slate-700 border-slate-500 text-slate-100";
  if (s.room_type === "outdoor") return "bg-amber-50  border-amber-400  text-amber-900";
  if (s.parallel_group_key)     return "bg-emerald-50 border-emerald-300 text-emerald-900";
  return "bg-white border-gray-200 text-gray-800";
}

export const SlotCell: React.FC<SlotCellProps> = ({
  slots, isDragging, isOver, onLock, onDelete, onSwapRoom, onOpenElective, compact,
}) => {
  if (!slots.length) return null;

  const isParallel = slots.length > 1;

  return (
    <div
      className={clsx(
        "relative w-full h-full rounded border overflow-hidden transition-shadow",
        isDragging && "opacity-40 shadow-lg",
        isOver     && "ring-2 ring-blue-400",
      )}
    >
      {isParallel ? (
        /* Parallel slots — split vertically */
        <div className="flex flex-col h-full">
          {slots.map((s, i) => (
            <div key={s.id} className={clsx("flex-1 overflow-hidden", i > 0 && "border-t border-gray-200")}>
              <Layer slot={s} compact onLock={onLock} onDelete={onDelete} onSwapRoom={onSwapRoom} onOpenElective={onOpenElective} />
            </div>
          ))}
        </div>
      ) : (
        <Layer slot={slots[0]} onLock={onLock} onDelete={onDelete} onSwapRoom={onSwapRoom} onOpenElective={onOpenElective} compact={compact} />
      )}
    </div>
  );
};

interface LayerProps {
  slot:      TimetableSlot;
  compact?:  boolean;
  onLock?:   (id: number) => void;
  onDelete?: (id: number) => void;
  onSwapRoom?: (slot: TimetableSlot) => void;
  onOpenElective?: (slot: TimetableSlot) => void;
}

const Layer: React.FC<LayerProps> = ({ slot, compact, onLock, onDelete, onSwapRoom, onOpenElective }) => (
  <div
    className={clsx(
      "relative flex flex-col h-full p-1 group border-0 overflow-hidden",
      slotColors(slot),
    )}
  >
    {/* ── Badges row (fixed 14px height) ────────────────────────── */}
    <div className="flex items-center gap-0.5 mb-0.5 overflow-hidden" style={{ minHeight: "14px", maxHeight: "14px" }}>
      {slot.is_locked && (
        <span className="shrink-0 inline-block bg-slate-500 text-white text-[7px] px-0.5 rounded-sm leading-tight">🔒</span>
      )}
      {slot.is_double_start && (
        <span className="shrink-0 inline-block bg-blue-500 text-white text-[7px] px-0.5 rounded-sm leading-tight font-bold">2×</span>
      )}
      {slot.room_type === "outdoor" && (
        <span className="shrink-0 inline-block bg-amber-400 text-amber-900 text-[7px] px-0.5 rounded-sm leading-tight">☀</span>
      )}
      {slot.is_elective && (
        <span className="shrink-0 inline-block bg-purple-500 text-white text-[7px] px-0.5 rounded-sm leading-tight">🎓</span>
      )}
    </div>

    {/* ── Subject code (single truncated line) ──────────────────── */}
    <div
      className="font-bold leading-tight overflow-hidden whitespace-nowrap text-ellipsis"
      style={{ fontSize: compact ? "9px" : "11px" }}
      title={slot.subject_name ?? undefined}
    >
      {slot.subject_code ?? slot.subject_name}
    </div>

    {/* ── Details ───────────────────────────────────────────────── */}
    <div className="flex-1 overflow-hidden mt-0.5 space-y-px">
      <div
        className="overflow-hidden whitespace-nowrap text-ellipsis opacity-80"
        style={{ fontSize: "9px" }}
        title={slot.teacher_name ?? undefined}
      >
        {slot.teacher_name}
      </div>
      {!compact && (
        <>
          <div
            className="overflow-hidden whitespace-nowrap text-ellipsis opacity-60"
            style={{ fontSize: "9px" }}
            title={slot.room_name ?? undefined}
          >
            {slot.room_name}
          </div>
          <div
            className="overflow-hidden whitespace-nowrap text-ellipsis opacity-60"
            style={{ fontSize: "9px" }}
            title={slot.group_name ?? undefined}
          >
            {slot.group_name}
          </div>
        </>
      )}
    </div>

    {/* ── Hover action buttons ───────────────────────────────────── */}
    <div className="absolute top-0.5 right-0.5 hidden group-hover:flex gap-0.5 z-10">
      {slot.is_elective && onOpenElective && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpenElective(slot); }}
          className="bg-white/90 text-[8px] px-0.5 py-0.5 rounded shadow hover:bg-gray-100 leading-none"
          title="เลือกวงเสรี"
        >
          🎓
        </button>
      )}
      {onSwapRoom && (
        <button
          onClick={(e) => { e.stopPropagation(); onSwapRoom(slot); }}
          className="bg-white/90 text-[8px] px-0.5 py-0.5 rounded shadow hover:bg-gray-100 leading-none"
          title="สลับห้อง"
        >
          🔁
        </button>
      )}
      {onLock && (
        <button
          onClick={(e) => { e.stopPropagation(); onLock(slot.id); }}
          className="bg-white/90 text-[8px] px-0.5 py-0.5 rounded shadow hover:bg-gray-100 leading-none"
          title={slot.is_locked ? "ปลดล็อก" : "ล็อก"}
        >
          {slot.is_locked ? "🔓" : "🔒"}
        </button>
      )}
      {onDelete && !slot.is_locked && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(slot.id); }}
          className="bg-white/90 text-red-500 text-[8px] px-0.5 py-0.5 rounded shadow hover:bg-red-50 leading-none"
        >
          ✕
        </button>
      )}
    </div>
  </div>
);
