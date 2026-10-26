/**
 * TimetableGrid v3 — Fixed-height uniform cells, DnD impact overlay.
 * Every cell has fixed 88px height enforced by inner wrapper overflow:hidden.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors,
  pointerWithin, rectIntersection,
  useDroppable, useDraggable,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import clsx from "clsx";

import { SlotCell } from "./SlotCell";
import { SwapRouteModal } from "./SwapRouteModal";
import { RoomSwapModal } from "./RoomSwapModal";
import { ElectiveOptionModal } from "./ElectiveOptionModal";
import { AddLessonModal } from "./AddLessonModal";
import { YardPickModal, type YardCol } from "./YardPickModal";
import { YardRescueModal } from "./YardRescueModal";
import { ClassProblemsModal, type ShortRow } from "./ClassProblemsModal";
import { useTimetableStore } from "../../store/timetableStore";
import { impactBorderClass, impactDotColor } from "../../utils/conflictAnalyzer";
import { planRoutes, type SwapRoute } from "../../utils/swapPlanner";
import { buildSharesStudents, flattenGroups } from "../../utils/groupHierarchy";
import { slotsForTeacher } from "../../utils/teacherSlots";
import { problemsIn, parentMap, type SlotProblem } from "../../utils/slotProblems";
import { countProblems, describeCounts } from "../../utils/repairClasses";
import { TableSearch, matches } from "../common/TableSearch";
import { levelKeyOf, periodsForLevel, combinedPeriods, levelLabel } from "../../utils/levels";
import { mergedDoubles, periodsOfCell, picksOfGroup, yardsInCell } from "../../utils/yardPicks";
import { DAYS, type Period, type TimetableSlot, type DragItem, type CellImpact } from "../../types";

// ─── Cell fixed dimensions ────────────────────────────────────────────────────
// These are ratios as much as sizes: the columns are laid out as shares of the
// table (see the colgroup), so what matters is how they compare to each other.
// The px totals still set the width below which the grid scrolls instead of
// crushing itself.
const CELL_H  = 96;  // px — all cells share this fixed height
const CELL_W  = 110; // px — a คาบ column
const BREAK_W = 56;  // px — พัก / พักกลางวัน, which hold only a short label
const DAY_W   = 56;  // px — the วัน label down the left edge

/** Day indexes 0…4, for the rules that walk the whole week. */
const DAY_INDEXES = DAYS.map((_, d) => d);

// ─────────────────────────────────────────────────────────────────────────────
// DroppableCell
// ─────────────────────────────────────────────────────────────────────────────
interface DroppableCellProps {
  /** The period row as THIS class's level sees it — not a global guess. */
  periodDef?: Period | null;
  day:    number;
  period: number;
  slots:  TimetableSlot[];
  impact: CellImpact | null;
  onLock:   (id: number) => void;
  onDelete: (id: number) => void;
  onSwapRoom: (slot: TimetableSlot) => void;
  onOpenElective: (slot: TimetableSlot) => void;
  onRescue: (slot: TimetableSlot) => void;
  preLockMode: boolean;
  onPreLockClick: (slot: TimetableSlot) => void;
  isDragging: boolean;
  onAddLesson?: (day: number, period: number) => void;
  /** โหมดเลือกคาบเรียนลานเปิดอยู่ และกำลังดูตารางของห้องเรียน */
  yardMode: boolean;
  /** The ลาน picked for this cell, as text — null when none is. */
  yardLabel: string | null;
  onYardClick: (day: number, period: number) => void;
}

const DroppableCell: React.FC<DroppableCellProps> = ({
  periodDef, day, period, slots, impact, onLock, onDelete, onSwapRoom, onOpenElective, onRescue,
  preLockMode, onPreLockClick, isDragging, onAddLesson, yardMode, yardLabel, onYardClick,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${day}-${period}`,
    data: { day, period },
    // Only truly un-droppable cells (break/lunch/homeroom) are disabled.
    // "red" (occupied) cells stay droppable so we can offer replacement routes.
    disabled: impact?.level === "fixed",
  });

  const isFixed   = periodDef != null && periodDef.type !== "class";

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

  const pickYard = () => onYardClick(day, period);

  let body: React.ReactNode = null;
  if (slots.length > 0) {
    if (yardMode) {
      // Picking, not editing: no dragging and no hover buttons, so a click that
      // lands on a lesson can only choose its ลาน, never delete or lock it.
      body = (
        <div className="w-full h-full cursor-pointer" onClick={pickYard}>
          <SlotCell slots={slots} />
        </div>
      );
    } else if (preLockMode) {
      body = (
        <div className="w-full h-full cursor-pointer" onClick={() => onPreLockClick(slots[0])}>
          <SlotCell slots={slots} onLock={onLock} onDelete={onDelete} onSwapRoom={onSwapRoom} onOpenElective={onOpenElective} />
        </div>
      );
    } else {
      body = (
        <DraggableWrapper slots={slots} onLock={onLock} onDelete={onDelete} onSwapRoom={onSwapRoom} onOpenElective={onOpenElective} onRescue={onRescue} />
      );
    }
  } else if (yardMode) {
    /* Empty cell, picking — reserve this hour on a ลาน, or change the reservation. */
    body = (
      <button
        type="button"
        onClick={pickYard}
        className="group/yard w-full h-full flex items-center justify-center hover:bg-teal-50/70 transition-colors"
        title={yardLabel ? `เลือกลานไว้: ${yardLabel} — คลิกเพื่อเปลี่ยนหรือเอาออก` : "คลิกเพื่อเลือกลานของชั่วโมงนี้"}
      >
        {yardLabel
          ? <YardReserved label={yardLabel} />
          : <span className="text-base text-teal-500 opacity-0 group-hover/yard:opacity-100 transition-opacity">📌</span>}
      </button>
    );
  } else if (onAddLesson && !isDragging && !preLockMode) {
    /* Empty cell — click to add a lesson here */
    body = (
      <button
        onClick={() => onAddLesson(day, period)}
        className="group/add w-full h-full flex items-center justify-center text-gray-300 hover:text-emerald-600 hover:bg-emerald-50/60 transition-colors"
        title={yardLabel ? `จองลานไว้: ${yardLabel} — คลิกเพื่อเพิ่มคาบเรียน` : "คลิกเพื่อเพิ่มคาบเรียน"}
      >
        {yardLabel
          ? <YardReserved label={yardLabel} />
          : <span className="text-base opacity-0 group-hover/add:opacity-100 transition-opacity">＋</span>}
      </button>
    );
  } else if (yardLabel) {
    body = <YardReserved label={yardLabel} />;
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
            <span className="ml-1 text-yellow-300">({impact.cascades} สลับ)</span>
          )}
        </div>
      )}

      {/* A ลาน picked for this hour shows under the lesson, or fills the cell
          when the hour is empty — an empty hour is the main use. */}
      {yardLabel && slots.length > 0 ? (
        <div className="flex flex-col h-full">
          <div className="flex-1 min-h-0">{body}</div>
          <YardTag label={yardLabel} />
        </div>
      ) : body}
    </div>
  );
};

/** The strip under a lesson that says which ลาน its hour was picked for. */
const YardTag: React.FC<{ label: string }> = ({ label }) => (
  <div
    className="shrink-0 flex items-center gap-0.5 px-1 bg-teal-600 text-white text-[9px] font-bold leading-none"
    style={{ height: "14px" }}
    title={`เลือกให้เรียนที่ ${label} — ตารางจะจัดตามนี้เมื่อกดสร้างตารางอีกครั้ง`}
  >
    <span className="shrink-0">📌</span>
    <span className="truncate">{label}</span>
  </div>
);

/** An hour with no lesson yet that is already spoken for on a ลาน. */
const YardReserved: React.FC<{ label: string }> = ({ label }) => (
  <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 px-1 bg-teal-50 text-teal-800">
    <span className="text-base leading-none">📌</span>
    <span className="w-full text-center text-[11px] font-bold leading-tight truncate" title={label}>{label}</span>
    <span className="text-[8px] leading-none opacity-70">จองลานไว้</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// DraggableWrapper
// ─────────────────────────────────────────────────────────────────────────────
const DraggableWrapper: React.FC<{
  slots:    TimetableSlot[];
  onLock:   (id: number) => void;
  onDelete: (id: number) => void;
  onSwapRoom: (slot: TimetableSlot) => void;
  onOpenElective: (slot: TimetableSlot) => void;
  onRescue: (slot: TimetableSlot) => void;
}> = ({ slots, onLock, onDelete, onSwapRoom, onOpenElective, onRescue }) => {
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
      <SlotCell slots={slots} isDragging={isDragging} onLock={onLock} onDelete={onDelete} onSwapRoom={onSwapRoom} onOpenElective={onOpenElective} onRescue={onRescue} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Grid
// ─────────────────────────────────────────────────────────────────────────────
interface TimetableGridProps { onNav?: (page: string) => void }

export const TimetableGrid: React.FC<TimetableGridProps> = ({ onNav }) => {
  const {
    slots, rooms, teachers, periods, groups, subjects, requirements, selectedGroupId, selectedTeacherId, selectedRoomId,
    impactMap, draggingSlot, startDrag, endDrag,
    moveSlot, swapRoom, toggleLock, deleteSlot, applySwapRoute, preLockMode,
    undo, undoStack, toggleClassLock,
    yardPickMode, yardPicks, yardList,
  } = useTimetableStore();

  const [validAlert,   setValidAlert]   = useState<string | null>(null);
  const [routePlan,    setRoutePlan]    = useState<
    { moving: TimetableSlot; target: { day: number; period: number }; routes: SwapRoute[] } | null
  >(null);
  const [roomSwapSlot, setRoomSwapSlot] = useState<TimetableSlot | null>(null);
  const [addCell, setAddCell] = useState<{ day: number; period: number } | null>(null);
  const [electiveSlotId, setElectiveSlotId] = useState<number | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  // The red lesson whose ลาน is being looked for. A slot, not a cell: the class
  // that matters is the lesson's own, which on a parent's or a teacher's sheet
  // is not the one selected.
  const [rescueSlot, setRescueSlot] = useState<TimetableSlot | null>(null);
  // The cell whose ลาน is being picked: its day and the column(s) it covers.
  const [yardCell, setYardCell] = useState<{ day: number; cols: YardCol[] } | null>(null);
  const electiveSlot = electiveSlotId != null ? slots.find((s) => s.id === electiveSlotId) ?? null : null;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // For subgroup schools: viewing a group shows its own slots PLUS student-
  // sharing relatives (whole-class lessons of the parent, and — when viewing a
  // parent — the split lessons of its subgroups). Siblings are NOT merged.
  const shares = useMemo(() => buildSharesStudents(groups), [groups]);

  // The day as the thing being shown actually experiences it. A class gets its
  // own level's periods; a teacher or room spans both, so those get the union
  // with each divided column labelled.
  const gridPeriods = useMemo(() => {
    if (selectedGroupId != null) {
      const g = flattenGroups(groups).find((x) => x.id === selectedGroupId);
      return periodsForLevel(periods, levelKeyOf(g));
    }
    return combinedPeriods(periods);
  }, [periods, groups, selectedGroupId]);

  // ห้องนี้ถูกปิดไว้ว่าจัดเสร็จแล้วหรือยัง — ห้องย่อยนับตามห้องแม่ด้วย
  // เพราะเป็นนักเรียนกลุ่มเดียวกัน (ฝั่งเซิร์ฟเวอร์ก็ล็อกตามสายเดียวกัน)
  const classLocked = useMemo(() => {
    if (selectedGroupId == null) return false;
    const flat = flattenGroups(groups);
    let g = flat.find((x) => x.id === selectedGroupId);
    while (g) {
      if (g.schedule_locked) return true;
      g = g.parent_id == null ? undefined : flat.find((x) => x.id === g!.parent_id);
    }
    return false;
  }, [groups, selectedGroupId]);

  // Column widths are shares of this total rather than fixed px, so that every
  // คาบ stays exactly as wide as every other one however wide the panel is.
  const totalGridW = useMemo(
    () => DAY_W + gridPeriods.reduce(
      (w, p) => w + (p.type === "class" ? CELL_W : BREAK_W), 0),
    [gridPeriods],
  );
  const pctOf = (w: number) => `${((w / totalGridW) * 100).toFixed(4)}%`;

  // Filtered slots for current view
  const viewSlots = useMemo(() => {
    if (selectedGroupId   != null) return slots.filter((s) => shares(s.group_id, selectedGroupId));
    if (selectedTeacherId != null) return slotsForTeacher(slots, selectedTeacherId);
    if (selectedRoomId    != null) return slots.filter((s) => s.room_id    === selectedRoomId);
    return [];
  }, [slots, shares, selectedGroupId, selectedTeacherId, selectedRoomId]);

  // ── อะไรยังค้างอยู่ในตารางที่กำลังดู ────────────────────────────────────
  //
  // "ถ้าชนหรือมีปัญหาอะไรก็มีไอคอนปุ่มด้านล่างเด่นออกมาให้กด ว่ามีปัญหาตรงไหน"
  //
  // คาบกรอบแดงบอกว่า "ตรงนี้มีเรื่อง" แต่ไม่ได้บอกว่าทั้งห้องมีกี่เรื่อง และ
  // วิชาที่ลงไม่ได้เลยก็ไม่มีคาบให้ขึ้นกรอบ ปุ่มนี้จึงรวมสองอย่างไว้ที่เดียว
  // problemsIn ตัวเดียวกับที่ปุ่ม "แก้เฉพาะห้องที่เลือก" ใช้นับห้องที่มีปัญหา
  const parents = useMemo(() => parentMap(groups), [groups]);
  const problems: SlotProblem[] = useMemo(
    () => problemsIn(viewSlots, slots, parents),
    [viewSlots, slots, parents]);

  // วิชาของห้องนี้ที่ยังลงไม่ครบ — คาบกรอบแดงนับเป็นยังไม่ลง
  const shortRows: ShortRow[] = useMemo(() => {
    if (selectedGroupId == null && selectedTeacherId == null) return [];
    const mine = requirements.filter((r) => (selectedGroupId != null
      ? shares(r.group_id, selectedGroupId)
      : r.teacher_id === selectedTeacherId));
    const out: ShortRow[] = [];
    for (const r of mine) {
      // วิชาเสรีที่ห้องนี้นั่งอยู่ในคาบเสรีอยู่แล้ว และครึ่งหลังของสอนร่วม
      // ไม่ใช่คาบที่ต้องหาที่ลงให้ — ม.4/6ข ขึ้นว่า ศ31210 ลงได้ 0/2 คาบ
      // ทั้งที่มันอยู่ในคาบเสรีบ่ายอังคารเรียบร้อยแล้ว
      if (r.served_by_elective || r.co_half) continue;
      const placed = slots.filter((s) => s.group_id === r.group_id
        && s.subject_id === r.subject_id && !s.is_overflow).length;
      if (placed < (r.weekly_count ?? 0)) out.push({ requirement: r, placed });
    }
    return out;
  }, [requirements, slots, shares, selectedGroupId, selectedTeacherId]);

  const problemCount = problems.length + shortRows.length;
  const viewTitle = selectedGroupId != null
    ? (flattenGroups(groups).find((g) => g.id === selectedGroupId)?.name ?? "ห้องนี้")
    : selectedTeacherId != null
      ? (teachers.find((t) => t.id === selectedTeacherId)?.name ?? "ครูคนนี้")
      : (rooms.find((r) => r.id === selectedRoomId)?.name ?? "ห้องสอนนี้");

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

  /**
   * คาบคู่กินช่องเดียว — one lesson, one cell.
   *
   * A คาบคู่ is one lesson two periods long, and it was drawn as two
   * identical cards side by side: the same subject, the same teacher and the
   * same room printed twice, which reads as two lessons and makes a wide
   * table wider for no reason. Merged, the pair is one cell across both
   * columns, which is what it is.
   *
   * Only when the two columns are actually next to each other. A pair split
   * by a break (คาบ 3 then คาบ 5 across lunch) is two cells, because merging
   * would draw the lesson straight through the break.
   *
   * The rules live in utils/yardPicks.ts: the screens that mark an hour out to
   * a ลาน must agree with what is drawn here about which hours go together.
   */
  const periodNums = useMemo(() => gridPeriods.map((p) => p.period_num), [gridPeriods]);
  const merged = useMemo(
    () => mergedDoubles(slotGrid, DAY_INDEXES, periodNums),
    [slotGrid, periodNums],
  );
  const { spans, swallowed } = merged;

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
    if (impact?.level === "fixed") {
      setValidAlert(impact.reason);
      return;
    }
    if (nd === item.fromDay && np === item.fromPeriod) return;

    const movingSlot = slots.find((s) => s.id === item.slotId);
    if (!movingSlot) { moveSlot(item.slotId, nd, np); return; }

    // Parallel groups (ก/ข/ค) still use the simple sibling-aware move so the
    // whole set stays together — route planning is per single slot.
    if (movingSlot.parallel_group_key) {
      moveSlot(item.slotId, nd, np);
      return;
    }

    // Compute concrete replacement routes for this drop.
    const routes = planRoutes(movingSlot, nd, np, slots, rooms, teachers, periods, groups, 5, subjects);

    // If the only route is a clean direct placement, just do it — no modal.
    if (routes.length === 1 && routes[0].kind === "direct" && routes[0].feasible) {
      applySwapRoute(routes[0]);
      return;
    }
    setRoutePlan({ moving: movingSlot, target: { day: nd, period: np }, routes });
  }, [endDrag, impactMap, moveSlot, applySwapRoute, slots, rooms, teachers, periods, groups]);

  const activeSlots = useMemo(() => {
    if (!draggingSlot) return [];
    return slotGrid.get(`${draggingSlot.day}-${draggingSlot.period}`) ?? [];
  }, [draggingSlot, slotGrid]);

  const handlePreLockClick = useCallback((slot: TimetableSlot) => toggleLock(slot.id), [toggleLock]);
  const handleSwapRoomClick = useCallback((slot: TimetableSlot) => setRoomSwapSlot(slot), []);
  const handleOpenElective  = useCallback((slot: TimetableSlot) => setElectiveSlotId(slot.id), []);

  // An empty cell can be filled from any of the three timetables. Whichever one
  // you are looking at is already decided, and the modal asks for the rest —
  // a teacher's free Tuesday is filled from the teacher's own sheet, which is
  // where anyone noticing the gap is actually standing.
  const handleAddLesson = useCallback((d: number, p: number) => setAddCell({ day: d, period: p }), []);

  // ── ลานที่เลือกไว้ล่วงหน้า ────────────────────────────────────────────────
  // A mark belongs to one class's hour, so the mode only means something on a
  // class's own timetable. A teacher's or a room's cell can hold several
  // classes at once and there is no one class to mark.
  const yardMode  = yardPickMode && selectedGroupId != null;
  const groupYards = useMemo(() => picksOfGroup(yardPicks, selectedGroupId), [yardPicks, selectedGroupId]);
  const yardNameOf = useCallback(
    (id: number) => yardList.find((y) => y.id === id)?.name ?? "ลานที่ไม่พบแล้ว",
    [yardList],
  );
  const handleYardClick = useCallback((d: number, p: number) => {
    // A คาบคู่ drawn as one cell stands for two hours; both are marked together.
    if (!periodNums.includes(p)) return;
    const covered = periodsOfCell(merged, d, periodNums, p)
      .map((n) => gridPeriods.find((x) => x.period_num === n))
      .filter((x): x is Period => x != null);
    setYardCell({
      day: d,
      cols: covered.map((x) => ({
        period: x.period_num, label: x.label, start: x.start_time, end: x.end_time,
      })),
    });
  }, [gridPeriods, periodNums, merged]);

  const handleApplyRoute = useCallback((route: SwapRoute) => {
    applySwapRoute(route);
    setRoutePlan(null);
  }, [applySwapRoute]);

  const isDragActive = !!draggingSlot;

  // Keyboard shortcut: Ctrl/Cmd+Z to undo the last change.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && undoStack.length > 0) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, undoStack.length]);

  if (!selectedGroupId && !selectedTeacherId && !selectedRoomId) {
    const steps = [
      { key: "groups",       icon: "👥", label: "เพิ่มห้องเรียน",   done: groups.length > 0,       count: groups.length },
      { key: "teachers",     icon: "👨‍🏫", label: "เพิ่มครูผู้สอน",  done: teachers.length > 0,     count: teachers.length },
      { key: "subjects",     icon: "📚", label: "เพิ่มวิชา",        done: subjects.length > 0,     count: subjects.length },
      { key: "rooms",        icon: "🚪", label: "เพิ่มห้องสอน",     done: rooms.length > 0,        count: rooms.length },
      { key: "requirements", icon: "📋", label: "กำหนดว่าใครสอนอะไร", done: requirements.length > 0, count: requirements.length },
    ];
    const allReady = steps.every((s) => s.done);
    const hasTimetable = slots.length > 0;

    // Fresh project → show the setup checklist.
    if (!allReady || !hasTimetable) {
      return (
        <div className="flex-1 overflow-y-auto flex items-start justify-center py-10 px-4">
          <div className="w-full max-w-lg">
            <div className="text-center mb-6">
              <span className="text-4xl">🗓️</span>
              <h2 className="text-lg font-bold text-gray-800 mt-2">เริ่มสร้างตารางเรียน</h2>
              <p className="text-sm text-gray-500 mt-1">ทำตามขั้นตอนนี้ให้ครบ แล้วกดสร้างตารางอัตโนมัติ</p>
            </div>

            <div className="space-y-2">
              {steps.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => onNav?.(s.key)}
                  className={clsx(
                    "w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all hover:shadow-sm",
                    s.done ? "border-green-200 bg-green-50/50" : "border-gray-200 bg-white hover:border-indigo-300",
                  )}
                >
                  <span className={clsx(
                    "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold",
                    s.done ? "bg-green-500 text-white" : "bg-gray-100 text-gray-400",
                  )}>
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className="text-xl">{s.icon}</span>
                  <span className="flex-1">
                    <span className="text-sm font-medium text-gray-800">{s.label}</span>
                    {s.done && <span className="text-xs text-green-600 ml-2">({s.count})</span>}
                  </span>
                  <span className="text-gray-300 text-lg">›</span>
                </button>
              ))}

              {/* Import shortcut */}
              <button
                onClick={() => onNav?.("groups")}
                className="w-full flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-2.5 text-left hover:shadow-sm"
              >
                <span className="text-xl">📥</span>
                <span className="flex-1 text-sm text-blue-800">มีข้อมูลใน Excel อยู่แล้ว? ใช้ปุ่ม "นำเข้า" ด้านบนเพื่อกรอกทีเดียว</span>
              </button>
            </div>

            {/* Final step */}
            <div className={clsx(
              "mt-4 rounded-xl border-2 px-4 py-3 text-center",
              allReady ? "border-indigo-300 bg-indigo-50" : "border-dashed border-gray-200 bg-gray-50",
            )}>
              {allReady ? (
                <p className="text-sm text-indigo-800 font-medium">
                  ✅ ข้อมูลครบแล้ว! กดปุ่ม <strong>⚡ สร้างตาราง</strong> ที่ toolbar ด้านบนได้เลย
                </p>
              ) : (
                <p className="text-sm text-gray-400">กรอกให้ครบทุกขั้นก่อน แล้วปุ่มสร้างตารางจะพร้อมใช้งาน</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Data + timetable exist → quick-pick which schedule to view.
    return <PickEntityScreen />;
  }

  return (
    <>
    {/* Replacement-route Modal (เส้นทางการแทนที่) */}
    {routePlan && (
      <SwapRouteModal
        moving={routePlan.moving}
        target={routePlan.target}
        routes={routePlan.routes}
        periods={periods}
        onApply={handleApplyRoute}
        onCancel={() => setRoutePlan(null)}
      />
    )}

    {/* Room Swap Modal */}
    {roomSwapSlot && (
      <RoomSwapModal
        slot={roomSwapSlot}
        rooms={rooms}
        slots={slots}
        onSelect={(roomId) => { swapRoom(roomSwapSlot.id, roomId); setRoomSwapSlot(null); }}
        onClose={() => setRoomSwapSlot(null)}
      />
    )}

    {/* Add-lesson Modal (click an empty cell, in any of the three views) */}
    {addCell && (
      <AddLessonModal
        groupId={selectedGroupId}
        fixedTeacherId={selectedTeacherId}
        fixedRoomId={selectedRoomId}
        day={addCell.day}
        period={addCell.period}
        onClose={() => setAddCell(null)}
      />
    )}

    {/* ลาน picker (โหมดเลือกคาบเรียนลาน — click any cell of a class) */}
    {yardCell && selectedGroupId != null && (
      <YardPickModal
        groupId={selectedGroupId}
        groupName={viewTitle}
        day={yardCell.day}
        cols={yardCell.cols}
        onClose={() => setYardCell(null)}
      />
    )}

    {/* Elective Option Modal */}
    {electiveSlot && (
      <ElectiveOptionModal
        slot={electiveSlot}
        onClose={() => setElectiveSlotId(null)}
      />
    )}

    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* ล็อกทั้งห้อง — "ห้องนี้จัดเสร็จแล้ว"
          สีเทา เพื่อให้ต่างจากล็อกรายคาบซึ่งเป็นสีดำ ตามที่โรงเรียนขอ
          ขึ้นเฉพาะตอนดูตารางของห้องเรียน เพราะล็อกนี้เป็นของห้องเรียน */}
      {selectedGroupId != null && (
        <div className={clsx(
          "flex items-center gap-2 px-4 py-1.5 border-b text-xs shrink-0",
          classLocked ? "bg-gray-200 border-gray-400 text-gray-700"
                      : "bg-white border-gray-200 text-gray-500")}>
          <button
            onClick={() => void toggleClassLock(selectedGroupId)}
            className={clsx(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-medium transition-colors",
              classLocked
                ? "bg-gray-600 border-gray-700 text-white hover:bg-gray-500"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-100")}
            title={classLocked
              ? "ห้องนี้ถูกปิดไว้ว่าจัดเสร็จแล้ว — กดเพื่อเปิดให้จัดใหม่ได้"
              : "ปิดห้องนี้ไว้ว่าจัดเสร็จแล้ว — สร้างตารางใหม่หรือล้างตารางจะไม่แตะห้องนี้"}
          >
            {classLocked ? "🔒 จัดเสร็จแล้ว" : "🔓 ปิดห้องนี้ว่าจัดเสร็จแล้ว"}
          </button>
          <span>
            {classLocked
              ? "ห้องนี้ถูกปิดไว้ — กดสร้างตารางใหม่หรือล้างตาราง จะไม่แตะคาบของห้องนี้เลย"
              : "จัดห้องนี้พอใจแล้วก็ปิดไว้ได้ แล้วไปจัดห้องถัดไปโดยไม่ต้องกลัวว่าของเดิมจะถูกรื้อ"}
          </span>
        </div>
      )}

      {/* Undo bar */}
      {undoStack.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-200 text-xs shrink-0">
          <button
            onClick={() => undo()}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-slate-300 text-slate-700 font-medium hover:bg-slate-100"
            title="ย้อนกลับ (Ctrl+Z)"
          >
            ↩ ย้อนกลับ
          </button>
          <span className="text-slate-400">
            {undoStack[undoStack.length - 1].label} · ย้อนได้ {undoStack.length} ขั้น (Ctrl+Z)
          </span>
        </div>
      )}

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

      {/* โหมดจัดเองไม่มีแถบของตัวเองแล้ว — ปุ่มบนแถบเครื่องมือขึ้นว่า "✋ จัดเอง"
          อยู่ตลอดเวลาที่เปิด ซึ่งบอกเรื่องเดียวกันโดยไม่กินที่เหนือตาราง */}
      {/* Pre-lock banner */}
      {preLockMode && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-900/40 border-b border-amber-700 text-amber-200 text-xs shrink-0">
          🔒 <strong>โหมดล็อก:</strong> คลิกที่คาบเพื่อล็อก/ปลดล็อก
        </div>
      )}

      {/* โหมดเลือกคาบเรียนลาน banner.
          Says plainly that the timetable stays as it is: the marks are only
          decisions until สร้างตาราง is pressed again, and nobody should wait
          for the grid to rearrange itself. */}
      {yardPickMode && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-1.5 bg-teal-50 border-b border-teal-300 text-teal-900 text-xs shrink-0">
          <span>📌 <strong>โหมดเลือกคาบเรียนลาน:</strong></span>
          {yardMode ? (
            <>
              <span>คลิกช่องไหนก็ได้ (ช่องว่างก็จองลานได้) เพื่อเลือกลานของชั่วโมงนั้น — บันทึกทันที</span>
              <span className="font-semibold">
                แต่ตารางยังไม่ขยับ ต้องกด ⚡ สร้างตาราง อีกครั้งจึงจะจัดตามที่เลือก
              </span>
            </>
          ) : (
            <span>ใช้ได้กับตารางของห้องเรียนเท่านั้น — เปลี่ยนไปมุมมอง 👥 ห้อง แล้วเลือกห้องที่ต้องการ</span>
          )}
        </div>
      )}

      {/* Grid */}
      {/* ห้องที่ปิดไว้ว่าจัดเสร็จแล้ว พื้นเป็นสีเทา เพื่อให้รู้ทันทีว่ากำลังดู
          ห้องที่ปิดอยู่ — ต่างจากล็อกรายคาบซึ่งเป็นสีดำบนตัวคาบเอง */}
      <div className={clsx("flex-1 overflow-auto", classLocked && "bg-gray-100")}>
        <DndContext
          sensors={sensors}
          /* Pick the cell under the POINTER.
           *
           * Without this dnd-kit compares rectangles and takes whichever cell
           * the dragged card overlaps most. The card is cell-sized and follows
           * the grab point, so as soon as you pick a lesson up anywhere but its
           * exact centre the card straddles two cells and the drop lands on the
           * neighbour — the lesson moves somewhere you did not choose.
           * Falls back to rectangles only when the pointer has left the grid.
           */
          collisionDetection={(args) => {
            const hits = pointerWithin(args);
            return hits.length > 0 ? hits : rectIntersection(args);
          }}
          modifiers={[restrictToWindowEdges]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {/* Every คาบ column has to come out the SAME width, or the grid stops
              reading as a grid.

              Two things are needed for that, and pixel widths alone give
              neither. table-fixed is the first: without it the browser treats
              <col width> as a suggestion and lets any column holding a long
              subject or a two-teacher line push itself wider.

              The second is percentages. The table stretches to fill the panel,
              and when a fixed-layout table is wider than its stated columns the
              browser hands out the leftover space itself — how it splits that
              remainder is not something to rely on. Stating each column as a
              share of the whole removes the remainder from the picture: every
              คาบ is the same share by construction, at any panel width, and the
              narrow พัก/พักกลางวัน columns keep their smaller share. minWidth
              in px is what makes it scroll instead of crushing the columns on a
              screen too narrow to hold them. */}
          <table
            className="border-collapse table-fixed w-full"
            style={{ minWidth: `${totalGridW}px` }}
          >
            <colgroup>
              {/* Day label column */}
              <col style={{ width: pctOf(DAY_W) }} />
              {gridPeriods.map((p) => (
                <col
                  key={p.period_num}
                  style={{ width: pctOf(p.type === "class" ? CELL_W : BREAK_W) }}
                />
              ))}
            </colgroup>

            {/* Header row */}
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="bg-gray-800 text-white border border-gray-700 px-1 py-1.5 text-center text-[11px] font-semibold">
                  วัน
                </th>
                {gridPeriods.map((pm) => (
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
                    {/* Only one level is taught in this column; the other is
                        at lunch. Say so, rather than letting it read as a
                        period everyone shares. */}
                    {"onlyFor" in pm && (pm as { onlyFor?: "lower" | "upper" }).onlyFor && (
                      <div className="text-[8px] font-normal text-amber-300">
                        เฉพาะ {levelLabel((pm as { onlyFor: "lower" | "upper" }).onlyFor)}
                      </div>
                    )}
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

                  {gridPeriods.map((pm) => {
                    const key       = `${dayIdx}-${pm.period_num}`;
                    // The second half of a merged คาบคู่ has no cell of its
                    // own — the first half covers both columns.
                    if (swallowed.has(key)) return null;
                    const span      = spans.get(key) ?? 1;
                    const impact    = isDragActive ? (impactMap.get(key) ?? null) : null;
                    const cellSlots = slotGrid.get(key) ?? [];
                    // The hours this cell stands for: two when a คาบคู่ is merged.
                    const covers    = periodsOfCell(merged, dayIdx, periodNums, pm.period_num);
                    const yardIds   = yardsInCell(groupYards, dayIdx, covers);

                    return (
                      <td
                        key={pm.period_num}
                        colSpan={span}
                        className="border border-gray-200 p-0.5 align-top"
                        style={{ height: `${CELL_H}px`, maxHeight: `${CELL_H}px` }}
                      >
                        {/* Inner wrapper enforces fixed height, prevents cell expansion */}
                        <div style={{ height: `${CELL_H - 4}px`, overflow: "hidden" }}>
                          <DroppableCell
                            periodDef={pm}
                            day={dayIdx}
                            period={pm.period_num}
                            slots={cellSlots}
                            impact={impact}
                            onLock={toggleLock}
                            onDelete={deleteSlot}
                            onSwapRoom={handleSwapRoomClick}
                            onOpenElective={handleOpenElective}
                            onRescue={setRescueSlot}
                            preLockMode={preLockMode}
                            onPreLockClick={handlePreLockClick}
                            isDragging={isDragActive}
                            onAddLesson={handleAddLesson}
                            yardMode={yardMode}
                            yardLabel={yardIds.length ? yardIds.map(yardNameOf).join(" · ") : null}
                            onYardClick={handleYardClick}
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

      {/* ปุ่มแจ้งเตือนของห้องนี้ — เด่นอยู่ใต้ตาราง ไม่ต้องไปหาในเมนู */}
      {problemCount > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-rose-200 bg-rose-50">
          <button
            onClick={() => setShowProblems(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-sm transition-colors"
          >
            <span className="text-base leading-none">⚠</span>
            <span>{viewTitle} — มี {problemCount} จุดที่ต้องแก้</span>
            {/* บอกว่าเป็นเรื่องอะไร ไม่ใช่แค่กี่คาบ — "คาบที่ยังไม่เรียบร้อย 4"
                ไม่ได้บอกว่าต้องไปหาห้อง ย้ายเวลา หรือแก้ห้องซ้ำ ซึ่งแก้คนละวิธี
                และต้องเปิดหน้าต่างอีกชั้นถึงจะรู้ */}
            <span className="font-normal opacity-90 hidden sm:inline">
              {[...describeCounts(countProblems(problems)),
                shortRows.length ? `วิชาที่ลงไม่ครบ ${shortRows.length}` : ""]
                .filter(Boolean).join(" · ")}
            </span>
            <span className="ml-auto underline">ดูว่าติดตรงไหน</span>
          </button>
        </div>
      )}

      {/* Footer legend */}
      <div className="shrink-0 flex flex-wrap gap-3 px-4 py-2 border-t border-gray-200 bg-white text-[10px] text-gray-500">
        <LegendDot color="bg-amber-400"   label="☀ กลางแจ้ง" />
        <LegendDot color="bg-emerald-300" label="↔ คู่ขนาน" />
        <LegendDot color="bg-sky-400"     label="👥 สอนร่วม" />
        <LegendDot color="bg-slate-500"   label="🔒 ล็อก" />
        <LegendDot color="bg-teal-600"    label="📌 เลือกให้เรียนที่ลาน (ชื่อลานอยู่ในช่อง)" />
        <LegendDot color="bg-rose-500"    label="⚠ ยังไม่เรียบร้อย (ไม่มีห้อง/ครูชน)" />
        <span className="flex items-center gap-1">
          <span className="inline-block bg-blue-500 text-white text-[8px] px-1 rounded font-bold">2×</span> คาบคู่
        </span>
        {!isDragActive && (
          <span className="ml-auto text-gray-400 italic">ลาก-วางเพื่อย้ายคาบ</span>
        )}
      </div>
    </div>
    {showProblems && (
      <ClassProblemsModal
        title={viewTitle}
        problems={problems}
        short={shortRows}
        subjects={subjects}
        groups={groups}
        // Esc reaches every open dialog; with the rescue screen on top it should
        // only close that one, not the list underneath as well.
        onClose={() => { if (!rescueSlot) setShowProblems(false); }}
        onRescue={setRescueSlot}
      />
    )}
    {/* หาลานให้คาบที่ไม่มีห้อง — from the lesson's hover button or the problems
        list. After the list in the page, and z-[210] over its z-[200]: it opens
        on top and the list stays open behind it. */}
    {rescueSlot && (
      <YardRescueModal
        groupId={rescueSlot.group_id}
        groupName={rescueSlot.group_name ?? `ห้อง #${rescueSlot.group_id}`}
        day={rescueSlot.day}
        period={rescueSlot.period}
        onClose={() => setRescueSlot(null)}
      />
    )}
    </>
  );
};

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-1">
    <span className={clsx("inline-block w-2.5 h-2.5 rounded-sm", color)} />{label}
  </span>
);

/**
 * The "nothing selected yet" screen.
 *
 * It used to show the first 24 classes as chips and stop — with 93 classes and
 * 143 teachers the one you wanted was usually not among them, and there was no
 * way to ask for it. Every chip is reachable now, through a search box, and the
 * teacher and room views get the same screen instead of a bare line of text.
 */
const PickEntityScreen: React.FC = () => {
  const {
    viewMode, groups, teachers, rooms,
    setSelectedGroupId, setSelectedTeacherId, setSelectedRoomId,
  } = useTimetableStore();
  const [q, setQ] = useState("");

  const what = viewMode === "group" ? "ห้องเรียน" : viewMode === "teacher" ? "ครู" : "ห้องสอน";

  const items = useMemo(() => {
    if (viewMode === "group") {
      return flattenGroups(groups).map((g) => ({ id: g.id, label: g.name, hint: g.level ?? "" }));
    }
    if (viewMode === "teacher") {
      return teachers.map((t) => ({
        id: t.id, label: t.name, hint: t.code ?? "",
      }));
    }
    return rooms.map((r) => ({ id: r.id, label: r.name, hint: "" }));
  }, [viewMode, groups, teachers, rooms]);

  const shown = useMemo(
    () => items.filter((it) => matches(q, it.label, it.hint)),
    [items, q],
  );

  const pick = (id: number) => {
    if (viewMode === "group")   setSelectedGroupId(id);
    if (viewMode === "teacher") setSelectedTeacherId(id);
    if (viewMode === "room")    setSelectedRoomId(id);
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center py-10 px-4 gap-4">
      <span className="text-4xl">📅</span>
      <p className="text-sm text-gray-500">เลือก{what}เพื่อดูตาราง</p>

      <div className="w-full max-w-xl">
        <TableSearch
          value={q} onChange={setQ}
          count={shown.length} total={items.length}
          placeholder={`ค้นหา${what}…${viewMode === "teacher" ? " (ชื่อ หรือ รหัสครู)" : ""}`}
        />
      </div>

      <div className="flex flex-wrap gap-2 justify-center max-w-3xl">
        {shown.map((it) => (
          <button
            key={it.id}
            onClick={() => pick(it.id)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 text-gray-700"
          >
            {it.hint && viewMode === "teacher" && (
              <span className="text-gray-400 font-mono text-xs mr-1">{it.hint}</span>
            )}
            {it.label}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="text-sm text-gray-400 py-6">ไม่พบ{what}ที่ค้นหา</p>
        )}
      </div>
    </div>
  );
};
