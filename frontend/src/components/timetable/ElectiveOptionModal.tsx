/**
 * ElectiveOptionModal — switch / manage the catalog of subject+teacher
 * choices ("วงเสรี") available inside a pinned วิชาเสรี slot.
 */
import React, { useMemo, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect } from "../common/SearchableSelect";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { teachesSlot } from "../../utils/teacherSlots";
import { DAYS, periodLabel } from "../../types";
import type { TimetableSlot } from "../../types";

interface ElectiveOptionModalProps {
  /** The window as it appears for one class — the one the list row opened. */
  slot:    TimetableSlot;
  /**
   * Every class's copy of the same window, when the list opened a group.
   *
   * Nobody edits one class's copy of a level-wide elective on its own: adding
   * ศิลปะตกแต่ง means adding it for all eight classes. Left out, the dialog
   * edits just the one cell, which is what it used to do.
   */
  siblings?: TimetableSlot[];
  onClose: () => void;
}

export const ElectiveOptionModal: React.FC<ElectiveOptionModalProps> = ({
  slot, siblings, onClose,
}) => {
  const { subjects, teachers, departments, slots, requirements, loadSlots } = useTimetableStore();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ subject_id: "", teacher_id: "", label: "" });
  const [busy, setBusy] = useState(false);

  const dayName = DAYS[slot.day] ?? `วัน ${slot.day}`;
  const options = slot.elective_options ?? [];

  const subj = subjects.find((s) => s.id === Number(form.subject_id));

  const subjectOpts = useMemo(() => {
    const dName = (id?: number | null) => departments.find((d) => d.id === id)?.name ?? "ไม่ระบุกลุ่มสาระ";
    const here = new Set(options.map((o) => o.subject_id));
    return [...subjects].sort((a, b) => a.code.localeCompare(b.code)).map((x) => ({
      value: String(x.id),
      label: `${x.code} – ${x.name}`,
      hint: here.has(x.id) ? "อยู่ในคาบนี้แล้ว" : undefined,
      group: dName(x.department_id),
      disabled: here.has(x.id),
    }));
  }, [subjects, departments, options]);

  /** Every วง in this window runs at once, so a teacher already booked at this
      hour — here or anywhere else — cannot take another one. Say so up front. */
  const busyHere = useMemo(() => {
    const ids = new Set<number>();
    for (const t of teachers) {
      const clash = slots.some((x) =>
        x.day === slot.day && x.period === slot.period && x.id !== slot.id && teachesSlot(x, t.id));
      const twice = options.some((o) => o.teacher_id === t.id);
      if (clash || twice) ids.add(t.id);
    }
    return ids;
  }, [teachers, slots, options, slot.day, slot.period, slot.id]);

  const teacherOpts = useMemo(() => {
    const dept = subj?.department_id;
    const teaching = new Set(requirements.filter((r) => r.subject_id === subj?.id).map((r) => r.teacher_id));
    return [...teachers]
      .sort((a, b) => {
        const rank = (t: typeof a) =>
          (busyHere.has(t.id) ? 4 : 0) +
          (teaching.has(t.id) ? 0 : (dept != null && t.department_id === dept) ? 1 : 2);
        return rank(a) - rank(b) || (a.code ?? "").localeCompare(b.code ?? "");
      })
      .map((t) => ({
        value: String(t.id),
        label: `${t.code ? `${t.code} ` : ""}${t.name}`,
        hint: busyHere.has(t.id) ? "ไม่ว่างคาบนี้" : teaching.has(t.id) ? "สอนวิชานี้อยู่" : undefined,
        group: busyHere.has(t.id) ? "ไม่ว่างคาบนี้"
          : teaching.has(t.id) ? "ครูที่สอนวิชานี้"
          : (dept != null && t.department_id === dept) ? "กลุ่มสาระเดียวกัน" : "ครูอื่น",
      }));
  }, [teachers, subj, requirements, busyHere]);

  /** Every cell this edit has to reach: the one opened, plus its siblings. */
  const targets = useMemo(() => {
    const all = [slot, ...(siblings ?? [])];
    return [...new Map(all.map((x) => [x.id, x])).values()];
  }, [slot, siblings]);

  const handleDelete = async (optionId: number) => {
    setBusy(true);
    try {
      // Each class's copy has its own option ids, so the others are matched
      // by what the option IS, not by the id of the one that was clicked.
      const opt = options.find((o) => o.id === optionId);
      for (const t of targets) {
        const mine = t.id === slot.id ? optionId
          : (t.elective_options ?? []).find(
              (o) => o.subject_id === opt?.subject_id && o.teacher_id === opt?.teacher_id)?.id;
        if (mine != null) await api.deleteElectiveOption(t.id, mine);
      }
      await loadSlots();
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!form.subject_id || !form.teacher_id) return;
    setBusy(true);
    try {
      for (const t of targets) {
        if ((t.elective_options ?? []).some((o) => o.subject_id === Number(form.subject_id)
            && o.teacher_id === Number(form.teacher_id))) continue;
        await api.addElectiveOption(t.id, {
          subject_id: Number(form.subject_id),
          teacher_id: Number(form.teacher_id),
          label: form.label || undefined,
        });
      }
      await loadSlots();
      setForm({ subject_id: "", teacher_id: "", label: "" });
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md">

        {/* Header */}
        <div className="flex items-center gap-3 bg-purple-600 px-5 py-4">
          <span className="text-2xl">🎓</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base leading-tight truncate">วิชาเสรี — {slot.group_name}</h2>
            <p className="text-purple-100 text-xs mt-0.5">{dayName} {periodLabel(slot.period)}{slot.room_name ? ` · ห้อง ${slot.room_name}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-purple-200 hover:text-white text-lg leading-none shrink-0">✕</button>
        </div>

        {/* Options list */}
        <div className="px-5 py-4 max-h-80 overflow-y-auto space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">เลือกวงที่ต้องการสอนในคาบนี้</p>
          {options.length === 0 && (
            <p className="text-xs text-gray-400 py-3 text-center">
              ยังไม่มีวิชาในคาบนี้ — ช่องนี้ยังถูกล็อกไว้ เพิ่มวิชาได้ด้านล่าง
            </p>
          )}
          {options.map((opt) => {
            const subj = subjects.find((s) => s.id === opt.subject_id);
            const teacher = teachers.find((t) => t.id === opt.teacher_id);
            // Every วง runs at once — nothing here is "the" one. The
            // students sign up on the day and go to that teacher.
            return (
              <div
                key={opt.id}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-purple-50/50 border-purple-200"
              >
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {opt.label}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {subj?.code ?? "?"} – {subj?.name} ·{" "}
                    {teacher?.name ?? <span className="text-amber-700">ยังไม่ได้เลือกครู</span>}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(opt.id)}
                  disabled={busy}
                  className="text-red-400 hover:text-red-600 text-sm px-2 py-1 shrink-0 rounded hover:bg-red-50"
                  title="ลบวิชานี้ออกจากคาบเสรี"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        {/* Add new option */}
        <div className="px-5 pb-4">
          {adding ? (
            <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
              <input
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                placeholder="ชื่อวง เช่น วงดนตรี"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
              <SearchableSelect
                value={form.subject_id}
                onChange={(v) => setForm({ ...form, subject_id: v, label: form.label || (subjects.find((x) => x.id === Number(v))?.name ?? "") })}
                options={subjectOpts}
                placeholder="ค้นหาวิชา (รหัส/ชื่อ)…" />
              <SearchableSelect
                value={form.teacher_id}
                onChange={(v) => setForm({ ...form, teacher_id: v })}
                options={teacherOpts}
                disabled={!form.subject_id}
                placeholder={form.subject_id ? "ค้นหาครู…" : "เลือกวิชาก่อน"} />
              {form.teacher_id && busyHere.has(Number(form.teacher_id)) && (
                <p className="text-[10px] text-red-700">
                  ⚠ ครูคนนี้ไม่ว่างคาบนี้ — มีคาบอื่นอยู่แล้วหรือรับวงอื่นในคาบนี้ไปแล้ว
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={busy || !form.subject_id || !form.teacher_id}
                  className="flex-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  เพิ่มวง
                </button>
                <button
                  onClick={() => setAdding(false)}
                  className="px-3 py-1.5 bg-gray-200 text-sm rounded hover:bg-gray-300"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full px-3 py-2 border border-dashed border-purple-300 text-purple-600 text-sm rounded-lg hover:bg-purple-50"
            >
              + เพิ่มวงใหม่
            </button>
          )}
        </div>

        <div className="px-5 pb-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors font-medium"
          >
            ปิด
          </button>
        </div>
    </ModalShell>
  );
};
