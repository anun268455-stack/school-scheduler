/**
 * TimetableGrid v3 — Fixed-height uniform cells, DnD impact overlay.
 * Every cell has fixed 88px height enforced by inner wrapper overflow:hidden.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import clsx from "clsx";

import { SlotCell } from "./SlotCell";
import { useTimetableStore } from "../../store/timetableStore";
import { impactBorderClass, impactDotColor } from "../../utils/conflictAnalyzer";
import { DAYS, GRID_PERIODS, type TimetableSlot, type DragItem, type CellImpact } from "../../types";

// ─── Cell fixed dimensions ────────────────────────────────────────────────────
const CELL_H = 88;   // px — all cells share this fixed height
const CELL_W = 110;  // px — class columns (non-class cols are narrower)

// ─────────────────────────────────────────────────────────────────────────────
// DroppableCell
// ─────────────────────────────────────────────────────────────────────────────
interface DroppableCellProps {
  day:    number;
  period: number;
  slots:  TimetableSlot[];
  impact: CellImpact | null;
  onLock:   (id: number) => void;
  onDelete: (id: number) => void;
  preLockMode: boolean;
  onPreLockClick: (slot: TimetableSlot) => void;
  isDragging: boolean;
}

const DroppableCell: React.FC<DroppableCellProps> = ({
  day, period, slots, impact, onLock, onDelete, preLockMode, onPreLockClick, isDragging,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${day}-${period}`,
    data: { day, period },
    disabled: impact?.level === "fixed" || impact?.level === "red",
  });

  const periodDef = GRID_PERIODS.find((p) => p.period_num === period);
  const isFixed   = periodDef && periodDef.type !== "class";

  // Non-class periods (break/lunch/homeroom/assembly) — grey placeholder
  if (isFixed) {
    return (
      <div
        className="flex items-center justify-center w-full h-full rounded text-center bg-gray-100 border border-dashed border-gray-300 overflow-hidden"
      >
        <span className="text-[8px] text-gray-400 italic px-1 leading-tight select-none">
          {periodDef.label}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "w-full h-full rounded border transition-all duration-150 relative overflow-hidden",
        isDragging && impact ? impactBorderClass(impact.level) : "border-dashed border-gray-200 hover:border-blue-300",
        isOver && "ring-2 ring-blue-500 ring-inset",
      )}
    >
      {/* Impact dot (during drag) */}
      {isDragging && impact && impact.level !== "same" && (
        <div
          className={clsx("absolute top-0.5 left-0.5 w-2 h-2 rounded-full z-20 pointer-events-none", impactDotColor(impact.level))}
          title={impact.reason}
        />
      )}

      {/* Impact tooltip (isOver) */}
      {isDragging && isOver && impact && (
        <div className="absolute -top-8 left-0 z-50 bg-gray-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap shadow-xl pointer-events-none">
          {impact.reason}
          {impact.cascades > 0 && impact.cascades !== Infinity && (
            <span className="ml-1 text-yellow-300">({impact.cascades} swap)</span>
          )}
        </div>
      )}

      {slots.length > 0 ? (
        preLockMode ? (
          <div className="w-full h-full cursor-pointer" onClick={() => onPreLockClick(slots[0])}>
            <SlotCell slots={slots} onLock={onLock} onDelete={onDelete} />
          </div>
        ) : (
          <DraggableWrapper slots={slots} onLock={onLock} onDelete={onDelete} />
        )
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DraggableWrapper
// ─────────────────────────────────────────────────────────────────────────────
const DraggableWrapper: React.FC<{
  slots:    TimetableSlot[];
  onLock:   (id: number) => void;
  onDelete: (id: number) => void;
}> = ({ slots, onLock, onDelete }) => {
  const primary  = slots[0];
  const isLocked = slots.some((s) => s.is_locked);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `slot-${primary.id}`,
    disabled: isLocked,
    data: {
      slotId: primary.id,
      fromDay: primary.day,
      fromPeriod: primary.period,
      parallelGroupKey: primary.parallel_group_key,
    } as DragItem,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={clsx("w-full h-full", isLocked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing")}
    >
      <SlotCell slots={slots} isDragging={isDragging} onLock={onLock} onDelete={onDelete} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Grid
// ─────────────────────────────────────────────────────────────────────────────
export const TimetableGrid: React.FC = () => {
  const {
    slots, selectedGroupId, selectedTeacherId, selectedRoomId, viewMode,
    impactMap, draggingSlot, startDrag, endDrag,
    moveSlot, toggleLock, deleteSlot, preLockMode,
  } = useTimetableStore();

  const [validAlert, setValidAlert] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // Filtered slots for current view
  const viewSlots = useMemo(() => {
    if (selectedGroupId   != null) return slots.filter((s) => s.group_id   === selectedGroupId);
    if (selectedTeacherId != null) return slots.filter((s) => s.teacher_id === selectedTeacherId);
    if (selectedRoomId    != null) return slots.filter((s) => s.room_id    === selectedRoomId);
    return [];
  }, [slots, selectedGroupId, selectedTeacherId, selectedRoomId, viewMode]);

  // Grid lookup map: "day-period" → TimetableSlot[]
  const slotGrid = useMemo(() => {
    const m = new Map<string, TimetableSlot[]>();
    for (const s of viewSlots) {
      const k = `${s.day}-${s.period}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return m;
  }, [viewSlots]);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const item = e.active.data.current as DragItem;
    const src  = slots.find((s) => s.id === item.slotId);
    if (src) startDrag(src);
    setValidAlert(null);
  }, [slots, startDrag]);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    endDrag();
    const { active, over } = e;
    if (!over) return;
    const item   = active.data.current as DragItem;
    const { day: nd, period: np } = over.data.current as { day: number; period: number };
    const impact = impactMap.get(`${nd}-${np}`);
    if (impact?.level === "red" || impact?.level === "fixed") {
      setValidAlert(impact.reason);
      return;
    }
    if (nd !== item.fromDay || np !== item.fromPeriod) {
      moveSlot(item.slotId, nd, np);
    }
  }, [endDrag, impactMap, moveSlot]);

  const activeSlots = useMemo(() => {
    if (!draggingSlot) return [];
    return slotGrid.get(`${draggingSlot.day}-${draggingSlot.period}`) ?? [];
  }, [draggingSlot, slotGrid]);

  const handlePreLockClick = useCallback((slot: TimetableSlot) => toggleLock(slot.id), [toggleLock]);
  const isDragActive = !!draggingSlot;

  if (!selectedGroupId && !selectedTeacherId && !selectedRoomId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 py-20">
        <span className="text-5xl">📅</span>
        <p className="text-sm">
          เลือก{viewMode === "group" ? "ห้องเรียน" : viewMode === "teacher" ? "ครู" : "ห้องสอน"}จาก toolbar ด้านบน
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Validation alert */}
      {validAlert && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm shrink-0">
          <span>⚠️</span>
          <span className="flex-1">{validAlert}</span>
          <button className="text-red-400 hover:text-red-600 font-bold" onClick={() => setValidAlert(null)}>✕</button>
        </div>
      )}

      {/* DnD legend */}
      {isDragActive && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-gray-900 text-xs text-white shrink-0">
          <span className="text-gray-400">ผลกระทบ:</span>
          {[
            { color: "bg-green-500",  label: "🟢 ปลอดภัย"         },
            { color: "bg-yellow-500", label: "🟡 ต้องสลับ 2-4 คาบ" },
            { color: "bg-red-500",    label: "🔴 ไม่สามารถวางได้"  },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1">
              <span className={clsx("inline-block w-2.5 h-2.5 rounded-full", color)} />{label}
            </span>
          ))}
        </div>
      )}

      {/* Pre-lock banner */}
      {preLockMode && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-900/40 border-b border-amber-700 text-amber-200 text-xs shrink-0">
          🔒 <strong>Pre-Lock Mode:</strong> คลิกที่คาบเพื่อล็อก/ปลดล็อก
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <DndContext
          sensors={sensors}
          modifiers={[restrictToWindowEdges]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <table
            className="border-collapse"
            style={{ minWidth: `${56 + GRID_PERIODS.length * CELL_W}px` }}
          >
            <colgroup>
              {/* Day label column */}
              <col style={{ width: "56px", minWidth: "56px" }} />
              {GRID_PERIODS.map((p) => (
                <col
                  key={p.period_num}
                  style={{
                    width: p.type === "class" ? `${CELL_W}px` : "56px",
                    minWidth: p.type === "class" ? `${CELL_W}px` : "56px",
                  }}
                />
              ))}
            </colgroup>

            {/* Header row */}
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="bg-gray-800 text-white border border-gray-700 px-1 py-1.5 text-center text-[11px] font-semibold">
                  วัน
                </th>
                {GRID_PERIODS.map((pm) => (
                  <th
                    key={pm.period_num}
                    className={clsx(
                      "border border-gray-700 px-1 py-1.5 text-center text-[10px] font-semibold whitespace-nowrap",
                      pm.type === "class"    ? "bg-blue-800   text-blue-100"
                      : pm.type === "break"  ? "bg-gray-700   text-gray-300"
                      : pm.type === "lunch"  ? "bg-orange-900 text-orange-200"
                      : "bg-gray-700 text-gray-400",
                    )}
                  >
                    <div className="truncate">{pm.label}</div>
                    <div className="text-[8px] font-normal opacity-70">{pm.start_time}–{pm.end_time}</div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {DAYS.map((dayName, dayIdx) => (
                <tr key={dayIdx}>
                  {/* Day label */}
                  <td
                    className="bg-blue-900 text-white text-center font-semibold border border-blue-800 text-[11px] px-1 align-middle"
                    style={{ height: `${CELL_H}px`, maxHeight: `${CELL_H}px` }}
                  >
                    {dayName}
                  </td>

                  {GRID_PERIODS.map((pm) => {
                    const key       = `${dayIdx}-${pm.period_num}`;
                    const impact    = isDragActive ? (impactMap.get(key) ?? null) : null;
                    const cellSlots = slotGrid.get(key) ?? [];

                    return (
                      <td
                        key={pm.period_num}
                        className="border border-gray-200 p-0.5 align-top"
                        style={{ height: `${CELL_H}px`, maxHeight: `${CELL_H}px` }}
                      >
                        {/* Inner wrapper enforces fixed height, prevents cell expansion */}
                        <div style={{ height: `${CELL_H - 4}px`, overflow: "hidden" }}>
                          <DroppableCell
                            day={dayIdx}
                            period={pm.period_num}
                            slots={cellSlots}
                            impact={impact}
                            onLock={toggleLock}
                            onDelete={deleteSlot}
                            preLockMode={preLockMode}
                            onPreLockClick={handlePreLockClick}
                            isDragging={isDragActive}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Drag overlay preview */}
          <DragOverlay>
            {activeSlots.length > 0 && (
              <div className="shadow-2xl opacity-95 rounded pointer-events-none" style={{ width: `${CELL_W - 4}px`, height: `${CELL_H - 4}px` }}>
                <SlotCell slots={activeSlots} compact />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Footer legend */}
      <div className="shrink-0 flex flex-wrap gap-3 px-4 py-2 border-t border-gray-200 bg-white text-[10px] text-gray-500">
        <LegendDot color="bg-amber-400"   label="☀ กลางแจ้ง" />
        <LegendDot color="bg-indigo-300"  label="● วิชาหนัก" />
        <LegendDot color="bg-emerald-300" label="↔ คู่ขนาน" />
        <LegendDot color="bg-slate-500"   label="🔒 ล็อก" />
        <span className="flex items-center gap-1">
          <span className="inline-block bg-blue-500 text-white text-[8px] px-1 rounded font-bold">2×</span> คาบคู่
        </span>
        {!isDragActive && (
          <span className="ml-auto text-gray-400 italic">ลาก-วางเพื่อย้ายคาบ</span>
        )}
      </div>
    </div>
  );
};

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-1">
    <span className={clsx("inline-block w-2.5 h-2.5 rounded-sm", color)} />{label}
  </span>
);
