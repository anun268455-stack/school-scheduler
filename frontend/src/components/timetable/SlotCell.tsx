import React, { useMemo } from "react";
import clsx from "clsx";
import type { TimetableSlot } from "../../types";
import { slotTeacherNames, teachingTogether, myElectiveOption, slotLabel } from "../../utils/teacherSlots";
import { problemOf, parentMap, type ProblemKind, type SlotProblem } from "../../utils/slotProblems";
import { useTimetableStore } from "../../store/timetableStore";
import { cellFont } from "../../utils/cellScale";

interface SlotCellProps {
  slots:       TimetableSlot[];
  isDragging?: boolean;
  isOver?:     boolean;
  onLock?:     (id: number) => void;
  onDelete?:   (id: number) => void;
  onSwapRoom?: (slot: TimetableSlot) => void;
  onOpenElective?: (slot: TimetableSlot) => void;
  /** หาลานให้คาบที่ไม่มีห้อง — ปุ่มขึ้นเฉพาะคาบกรอบแดงที่ไม่มีห้อง */
  onRescue?:   (slot: TimetableSlot) => void;
  compact?:    boolean;
}

/**
 * คำสั้นๆ บนกรอบแดง — ช่องกว้างไม่กี่ตัวอักษร จึงบอกได้เรื่องเดียว
 *
 * บอกเรื่องที่ "ต้องไปทำอะไรสักอย่าง" ก่อนเสมอ: ไม่มีห้องเลย แก้ด้วยการหาห้อง ·
 * ห้องซ้ำกับอีกห้องเรียน แก้ด้วยการเปลี่ยนห้องให้คาบใดคาบหนึ่ง · ครูติดสอนที่
 * อื่น แก้ด้วยการย้ายเวลา · ที่เหลือคือคาบที่ระบบวางไว้ให้เห็นเฉยๆ
 *
 * เดิมมีสองคำ ("ไม่มีห้อง" กับ "ต้องแก้") — พอเพิ่มเรื่องห้องซ้ำเข้ามา คาบที่
 * ห้องซ้ำจึงขึ้นว่า "ต้องแก้" ซึ่งไม่ได้บอกอะไรเลย ทั้งที่เป็นคนละเรื่องกับ
 * คาบที่ไม่มีห้อง และแก้คนละวิธี
 */
function badgeWord(kinds: ProblemKind[]): string {
  if (kinds.includes("no_room"))       return "ไม่มีห้อง";
  if (kinds.includes("room_clash"))    return "ห้องซ้ำ";
  if (kinds.includes("teacher_clash")) return "ครูซ้ำ";
  return "ต้องแก้";
}

function slotColors(s: TimetableSlot, bad?: boolean): string {
  // คาบที่ยังไม่เรียบร้อย — ไม่มีห้อง ครูติดสอนที่อื่น หรือระบบวางไว้ให้เห็น
  // เฉยๆ ต้องเด่นกว่าทุกสีที่เหลือ เพราะเป็นคาบที่ยังต้องตัดสินใจด้วยมือ
  if (bad)                      return "bg-rose-50 border-rose-500 text-rose-900";
  if (s.is_elective)            return "bg-purple-50 border-purple-300 text-purple-900";
  // สอนร่วม before ล็อก: two teachers in one room is the thing the school is
  // scanning the grid for, and the dark locked cell hid the badge entirely.
  if (teachingTogether(s))      return "bg-sky-50 border-sky-400 text-sky-900";
  if (s.is_locked)              return "bg-slate-700 border-slate-500 text-slate-100";
  if (s.room_type === "outdoor") return "bg-amber-50  border-amber-400  text-amber-900";
  if (s.parallel_group_key)     return "bg-emerald-50 border-emerald-300 text-emerald-900";
  return "bg-white border-gray-200 text-gray-800";
}

export const SlotCell: React.FC<SlotCellProps> = ({
  slots, isDragging, isOver, onLock, onDelete, onSwapRoom, onOpenElective, onRescue, compact,
}) => {
  // ทุกคาบในตาราง เพราะ "ครูติดสอนห้องอื่นในชั่วโมงนี้" ดูจากคาบของตัวเองไม่ได้
  // และ "ห้องนี้มีอีกห้องเรียนอยู่ด้วย" ก็เช่นกัน — ต้นไม้ห้องมาด้วยเพราะห้องย่อย
  // พี่น้องที่เรียนด้วยกันนั่งห้องเดียวกันได้ ไม่ใช่การชน
  const all = useTimetableStore((st) => st.slots);
  const groups = useTimetableStore((st) => st.groups);
  const parents = useMemo(() => parentMap(groups), [groups]);
  const probs = useMemo(() => {
    const m = new Map<number, SlotProblem | null>();
    for (const s of slots) m.set(s.id, problemOf(s, all, parents));
    return m;
  }, [slots, all, parents]);

  if (!slots.length) return null;

  const isParallel = slots.length > 1;
  const anyBad = slots.some((s) => probs.get(s.id));

  return (
    <div
      className={clsx(
        "relative w-full h-full rounded border overflow-hidden transition-shadow",
        // กรอบแดงของคาบที่ยังไม่เรียบร้อย อยู่ที่กรอบนอก เพราะกรอบของการ์ด
        // ข้างในถูกปิดไว้ (border-0) สีจากในนั้นจึงไม่ขึ้น
        anyBad && "border-rose-500 ring-2 ring-rose-400",
        isDragging && "opacity-40 shadow-lg",
        isOver     && "ring-2 ring-blue-400",
      )}
    >
      {isParallel ? (
        /* ห้องย่อย ก/ข/ค เรียนคนละวิชาในชั่วโมงเดียวกัน.
           Three lessons in one 88px cell used to be three full cards at 29px
           each: the subject, the teacher, the room and the class, all cut off
           — "สามช่องที่ซ่อนกัน". One line each instead, with the subgroup
           letter in front, and the whole thing on hover. */
        <div className="flex flex-col h-full divide-y divide-gray-200/70">
          {slots.map((s) => (
            <MiniLayer key={s.id} slot={s} label={shortName(s.group_name, slots)}
              problem={probs.get(s.id) ?? null} />
          ))}
        </div>
      ) : (
        <Layer slot={slots[0]} problem={probs.get(slots[0].id) ?? null}
          onLock={onLock} onDelete={onDelete} onSwapRoom={onSwapRoom}
          onOpenElective={onOpenElective} onRescue={onRescue} compact={compact} />
      )}
    </div>
  );
};

interface LayerProps {
  slot:      TimetableSlot;
  problem?:  SlotProblem | null;
  compact?:  boolean;
  onLock?:   (id: number) => void;
  onDelete?: (id: number) => void;
  onSwapRoom?: (slot: TimetableSlot) => void;
  onOpenElective?: (slot: TimetableSlot) => void;
  onRescue?: (slot: TimetableSlot) => void;
}

const Layer: React.FC<LayerProps> = ({ slot, problem, compact, onLock, onDelete, onSwapRoom, onOpenElective, onRescue }) => {
  // สอนร่วม and a คาบกิจกรรม duty roster both put more than one teacher in the
  // room. The line truncates, so the count goes in a badge that cannot.
  const names = slotTeacherNames(slot);
  /**
   * Whose sheet this is, when it is one teacher's.
   *
   * A คาบเสรี holds a dozen subjects at once, so "9 ตัวเลือก" is the honest
   * thing to show a class — but on a teacher's own timetable it tells them
   * nothing. They want the one they are teaching, which is the one the
   * students will come to them for.
   */
  const viewingTeacher = useTimetableStore((st) => st.selectedTeacherId);
  const myOption = viewingTeacher != null ? myElectiveOption(slot, viewingTeacher) : null;
  const extra = names.length - 1;

  // ── คาบว่างที่จองไว้ให้ว่างตรงกันทั้งกลุ่ม ────────────────────────────────
  //
  // "อยากให้ ม.3/5 - 3/14 มีคาบว่างที่ตรงกัน จะได้จัดกิจกรรมต่างๆ ได้
  //  ก็ให้นับเป็นคาบว่างไปเลย"
  //
  // ช่องนี้ว่างจริงๆ ไม่มีวิชา ไม่มีครู ไม่มีห้อง การวาดมันเหมือนคาบเรียนจะทำให้
  // คนอ่านตารางเข้าใจว่ามีอะไรสักอย่างเรียนอยู่ แต่ถ้าปล่อยว่างเปล่าก็จะดูเหมือน
  // ช่องที่ระบบลงไม่ได้ จึงวาดเป็นช่องจางๆ ที่บอกตรงๆ ว่าจองไว้ให้ว่าง
  if (slot.is_free_period) {
    return (
      <div className="relative flex h-full items-center justify-center p-1
                      bg-gray-50 border border-dashed border-gray-300"
           title="คาบว่างที่จองไว้ให้ว่างตรงกันทั้งกลุ่ม — ไม่มีวิชา ไม่มีครู">
        <span className="text-gray-400 leading-tight text-center"
              style={{ fontSize: cellFont(9) }}>
          คาบว่าง
        </span>
      </div>
    );
  }

  return (
  <div
    className={clsx(
      "relative flex flex-col h-full p-1 group border-0 overflow-hidden",
      slotColors(slot, !!problem),
    )}
  >
    {/* ── Badges row (fixed 14px height) ────────────────────────── */}
    <div className="flex items-center gap-0.5 mb-0.5 overflow-hidden" style={{ minHeight: "14px", maxHeight: "14px" }}>
      {problem && (
        <span
          className="shrink-0 inline-block bg-rose-600 text-white text-[7px] px-0.5 rounded-sm leading-tight font-bold"
          title={`${problem.text} — ${problem.fix}`}
        >
          ⚠ {badgeWord(problem.kinds)}
        </span>
      )}
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
      {/* 2× already says คาบคู่ on the first half, and a merged pair is one
          cell — so this only marks a second half still drawn on its own,
          which happens when a break falls between the two periods. */}
      {slot.double_group_key && slot.is_double_cont && (
        <span className="shrink-0 inline-block bg-purple-300 text-purple-900 text-[7px] px-0.5 rounded-sm leading-tight" title="คาบที่สองของคาบคู่ (มีคาบพักคั่น)">
          🔗ต่อ
        </span>
      )}
      {extra > 0 && (
        <span
          className="shrink-0 inline-block bg-sky-500 text-white text-[7px] px-0.5 rounded-sm leading-tight"
          title={`${slot.is_activity_block ? "ครูผู้ดูแล" : "สอนร่วม"}: ${names.join(" · ")}`}
        >
          👥{extra > 1 ? names.length : ""}
        </span>
      )}
    </div>

    {/* ── Subject code (single truncated line) ──────────────────── */}
    <div
      className="font-bold leading-tight overflow-hidden whitespace-nowrap text-ellipsis"
      style={{ fontSize: cellFont(compact ? 9 : 11) }}
      title={slot.subject_name ?? undefined}
    >
      {myOption?.label ?? slot.subject_code ?? slot.subject_name
        ?? (slot.is_elective ? "วิชาเสรี" : "")}
    </div>

    {/* ── Details ───────────────────────────────────────────────── */}
    <div className="flex-1 overflow-hidden mt-0.5 space-y-px">
      <div
        className="overflow-hidden whitespace-nowrap text-ellipsis opacity-80"
        style={{ fontSize: cellFont(9) }}
        title={names.length ? names.join(" · ") : undefined}
      >
        {/* A shared elective the class hasn't settled on has no single teacher —
            its students split across every option at once. Say how many. */}
        {myOption
          ? `วิชาเสรี · ${slot.elective_options?.length ?? 0} วิชาในคาบนี้`
          : names.length
          ? (slot.is_activity_block && names.length > 2
               ? `ครูผู้ดูแล ${names.length} คน`
               : names.join(" + "))
          : (slot.is_elective && slot.elective_options?.length
                ? `${slot.elective_options.length} ตัวเลือก`
                /* A เซ็ตห้องย่อย may be written down before anyone knows who
                   will teach it — the hour is the point. The lesson is placed
                   and the cell says what is still missing, rather than showing
                   a blank line that reads like a bug. */
                : (!slot.is_activity_block
                     ? <span className="text-amber-700">ยังไม่ได้เลือกครู</span>
                     : null))}
      </div>
      {/* On a teacher's own timetable a คาบกิจกรรม belongs to many classrooms
          at once, so the cell says the scope rather than one of them. */}
      {slot.is_activity_block && slot.activity_scope && (
        <div
          className="overflow-hidden whitespace-nowrap text-ellipsis opacity-70 text-teal-700 font-medium"
          style={{ fontSize: cellFont(8) }}
          title={slot.activity_scope}
        >
          {slot.activity_scope}
        </div>
      )}
      {compact && slot.group_name && (
        <div
          className="overflow-hidden whitespace-nowrap text-ellipsis opacity-70 text-teal-700 font-medium"
          style={{ fontSize: cellFont(8) }}
          title={slot.group_name ?? undefined}
        >
          {slot.group_name}
        </div>
      )}
      {!compact && (
        <>
          {/* ห้องที่สอน — read as often as the subject code when you are
              walking the building, so it gets its own weight instead of
              sitting at the same faded size as the class name below it. */}
          <div
            className="overflow-hidden whitespace-nowrap text-ellipsis font-semibold opacity-90"
            style={{ fontSize: cellFont(11) }}
            title={slot.room_name ?? undefined}
          >
            {slot.room_name}
          </div>
          <div
            className="overflow-hidden whitespace-nowrap text-ellipsis opacity-60"
            style={{ fontSize: cellFont(9) }}
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
      {/* A lesson with no room can be rescued by sending an hour out to a ลาน —
          its own, or another class's. The screen behind this says which. */}
      {onRescue && problem?.kinds.includes("no_room") && (
        <button
          onClick={(e) => { e.stopPropagation(); onRescue(slot); }}
          className="bg-white/90 text-[8px] px-0.5 py-0.5 rounded shadow hover:bg-teal-50 leading-none"
          title="หาลานให้คาบนี้ — ดูว่าลานไหนช่วยให้ได้ห้อง"
        >
          🌳
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
};

/**
 * ก / ข / ค — what is left of a subgroup's name once the part it shares with
 * its siblings is taken away. Two unrelated classes sharing an hour share no
 * prefix, so they keep their full names.
 */
function shortName(name: string | null | undefined, all: TimetableSlot[]): string {
  const names = all.map((s) => s.group_name ?? "").filter(Boolean);
  if (!name || names.length < 2) return name ?? "";
  let i = 0;
  while (i < name.length && names.every((n) => n[i] === name[i])) i++;
  const rest = name.slice(i);
  // Only a true suffix — ก, ข, ค, or a room number. Two unrelated classes
  // sharing an hour have only "ม." in common, and "4/6" with the ม. filed
  // off is not a name anyone would recognise at a glance.
  return rest && rest.length <= 2 ? rest : name;
}

const MiniLayer: React.FC<{
  slot: TimetableSlot;
  label: string;
  problem?: SlotProblem | null;
  /** Declared because the type-check stub's React.FC does not carry it. */
  key?: string | number;
}> = ({ slot, label, problem }) => {
  const names = slotTeacherNames(slot);
  const title = [slot.group_name, slotLabel(slot), slot.subject_name,
                 names.join(" · "), slot.room_name].filter(Boolean).join(" · ");
  return (
    <div className={clsx("flex-1 min-h-0 flex items-center gap-1 px-1 overflow-hidden",
      slotColors(slot, !!problem))}
      title={problem ? `${title} — ${problem.text}` : title}>
      <span className="shrink-0 font-bold bg-white/70 rounded px-0.5 leading-tight"
            style={{ fontSize: cellFont(9) }}>
        {problem ? `⚠${label}` : label}
      </span>
      <span className="flex-1 min-w-0 truncate font-semibold leading-tight"
            style={{ fontSize: cellFont(9) }}>
        {slotLabel(slot)}
      </span>
      <span className="shrink-0 max-w-[42%] truncate text-gray-600 leading-tight"
            style={{ fontSize: cellFont(8) }}>
        {slot.room_name ?? names[0] ?? ""}
      </span>
    </div>
  );
};
