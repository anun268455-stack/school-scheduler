/**
 * ClearTimetableModal — "ล้างตาราง": empty the timetable in one go instead of
 * deleting period after period.
 *
 * Four scopes, narrowest first, because this cannot be undone (the undo bar
 * only covers moves, not deletions):
 *   - คาบที่ไม่ได้ล็อก  : the usual "let me generate again" wipe
 *   - ทั้งหมด            : locked periods too
 *   - ห้องเดียว / ครูคนเดียว : only what is on screen
 *
 * The count of what is about to go is shown on the button itself, and
 * "ทั้งหมด" asks for a second click, so nobody loses a week's work by reflex.
 */
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { ModalShell } from "../common/ModalShell";
import { flattenGroups } from "../../utils/groupHierarchy";

type Scope = "unlocked" | "all" | "group" | "teacher";

interface Props {
  onClose: () => void;
}

export const ClearTimetableModal: React.FC<Props> = ({ onClose }) => {
  const { slots, groups, teachers, selectedGroupId, selectedTeacherId, loadSlots } =
    useTimetableStore();

  const [scope, setScope]     = useState<Scope>("unlocked");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const group   = flat.find((g) => g.id === selectedGroupId);
  const teacher = teachers.find((t) => t.id === selectedTeacherId);

  const lockedCount = slots.filter((s) => s.is_locked).length;

  /** How many periods each scope would delete, given the current slots. */
  const counts: Record<Scope, number> = useMemo(() => {
    const unlocked = (s: typeof slots[number]) => !s.is_locked;
    return {
      unlocked: slots.filter(unlocked).length,
      all:      slots.length,
      group:    group   ? slots.filter((s) => unlocked(s) && s.group_id   === group.id).length   : 0,
      teacher:  teacher ? slots.filter((s) => unlocked(s) && s.teacher_id === teacher.id).length : 0,
    };
  }, [slots, group, teacher]);

  const OPTIONS: { id: Scope; label: string; hint: string; disabled?: boolean }[] = [
    {
      id: "unlocked",
      label: "ล้างคาบที่ไม่ได้ล็อก",
      hint: lockedCount > 0
        ? `เก็บคาบที่ล็อกไว้ ${lockedCount} คาบ — ใช้ตอนจะสั่งสร้างตารางใหม่`
        : "ใช้ตอนจะสั่งสร้างตารางใหม่",
    },
    {
      id: "all",
      label: "ล้างทั้งหมด (รวมคาบที่ล็อก)",
      hint: "เริ่มจากศูนย์ คาบที่ล็อกและวิชาเสรีจะหายไปด้วย",
    },
    {
      id: "group",
      label: group ? `ล้างเฉพาะ ${group.name}` : "ล้างเฉพาะห้องที่เลือก",
      hint: group ? "เฉพาะคาบของห้องนี้ที่ไม่ได้ล็อก" : "ยังไม่ได้เลือกห้องในหน้าตาราง",
      disabled: !group,
    },
    {
      id: "teacher",
      label: teacher ? `ล้างเฉพาะ ${teacher.code ? `${teacher.code} ` : ""}${teacher.name}` : "ล้างเฉพาะครูที่เลือก",
      hint: teacher ? "เฉพาะคาบของครูคนนี้ที่ไม่ได้ล็อก" : "ยังไม่ได้เลือกครูในหน้าตาราง",
      disabled: !teacher,
    },
  ];

  const target = counts[scope];

  const run = async () => {
    if (scope === "all" && !confirm) { setConfirm(true); return; }
    setBusy(true); setError(null);
    try {
      await api.clearSlots({
        scope:      scope === "all" ? "all" : "unlocked",
        group_id:   scope === "group"   ? group?.id   : undefined,
        teacher_id: scope === "teacher" ? teacher?.id : undefined,
      });
      await loadSlots();
      onClose();
    } catch {
      setError("ล้างไม่สำเร็จ — ลองใหม่อีกครั้ง");
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md">
      <div className="flex items-center gap-3 bg-red-700 px-5 py-4 shrink-0">
        <span className="text-2xl">🧹</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight">ล้างตาราง</h2>
          <p className="text-red-100 text-xs mt-0.5">ตอนนี้มี {slots.length} คาบในตาราง</p>
        </div>
        <button onClick={onClose} className="text-red-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="p-4 space-y-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            disabled={o.disabled || busy}
            onClick={() => { setScope(o.id); setConfirm(false); }}
            className={clsx(
              "w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
              o.disabled
                ? "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                : scope === o.id
                  ? "border-red-400 bg-red-50"
                  : "border-gray-200 hover:border-red-300 hover:bg-red-50/40",
            )}
          >
            <span className={clsx(
              "mt-0.5 w-4 h-4 rounded-full border-2 shrink-0",
              scope === o.id && !o.disabled ? "border-red-500 bg-red-500" : "border-gray-300",
            )} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-gray-800 truncate">{o.label}</span>
              <span className="block text-[11px] text-gray-500 mt-0.5">{o.hint}</span>
            </span>
            {!o.disabled && (
              <span className="text-xs font-mono text-gray-500 shrink-0 mt-0.5">{counts[o.id]} คาบ</span>
            )}
          </button>
        ))}

        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ การล้างตารางย้อนกลับไม่ได้ (Ctrl+Z ใช้ได้แค่การย้ายคาบ) — ข้อมูลครู วิชา
          ห้องสอน และการสอนที่กำหนดไว้ไม่หาย ล้างแค่ตารางที่จัดไว้
        </p>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
        {error && <span className="text-xs text-red-600 flex-1">{error}</span>}
        {!error && <span className="flex-1" />}
        <button onClick={onClose} disabled={busy}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
          ยกเลิก
        </button>
        <button
          onClick={run}
          disabled={busy || target === 0}
          className={clsx(
            "px-5 py-2 text-sm text-white rounded-lg font-semibold disabled:opacity-40",
            confirm && scope === "all" ? "bg-red-800 hover:bg-red-900 animate-pulse" : "bg-red-600 hover:bg-red-700",
          )}
        >
          {busy ? "กำลังล้าง…"
            : target === 0 ? "ไม่มีคาบให้ล้าง"
            : confirm && scope === "all" ? `กดอีกครั้งเพื่อล้าง ${target} คาบ`
            : `ล้าง ${target} คาบ`}
        </button>
      </div>
    </ModalShell>
  );
};
