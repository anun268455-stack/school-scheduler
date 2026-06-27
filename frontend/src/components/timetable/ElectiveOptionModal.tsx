/**
 * ElectiveOptionModal — switch / manage the catalog of subject+teacher
 * choices ("วงเสรี") available inside a pinned วิชาเสรี slot.
 */
import React, { useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { DAYS } from "../../types";
import type { TimetableSlot } from "../../types";

interface ElectiveOptionModalProps {
  slot:    TimetableSlot;
  onClose: () => void;
}

export const ElectiveOptionModal: React.FC<ElectiveOptionModalProps> = ({ slot, onClose }) => {
  const { subjects, teachers } = useTimetableStore();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ subject_id: "", teacher_id: "", label: "" });
  const [busy, setBusy] = useState(false);

  const dayName = DAYS[slot.day] ?? `วัน ${slot.day}`;
  const options = slot.elective_options ?? [];

  const patchSlot = (updated: TimetableSlot) =>
    useTimetableStore.setState((s) => ({ slots: s.slots.map((x) => x.id === slot.id ? updated : x) }));

  const handleSelect = async (optionId: number) => {
    if (optionId === slot.selected_option_id) return;
    setBusy(true);
    try {
      const updated = await api.selectElectiveOption(slot.id, optionId);
      patchSlot(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (optionId: number) => {
    if (options.length <= 1) return;
    setBusy(true);
    try {
      const updated = await api.deleteElectiveOption(slot.id, optionId);
      patchSlot(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!form.subject_id || !form.teacher_id) return;
    setBusy(true);
    try {
      const updated = await api.addElectiveOption(slot.id, {
        subject_id: Number(form.subject_id),
        teacher_id: Number(form.teacher_id),
        label: form.label || undefined,
      });
      patchSlot(updated);
      setForm({ subject_id: "", teacher_id: "", label: "" });
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">

        {/* Header */}
        <div className="flex items-center gap-3 bg-purple-600 px-5 py-4">
          <span className="text-2xl">🎓</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base leading-tight truncate">วิชาเสรี — {slot.group_name}</h2>
            <p className="text-purple-100 text-xs mt-0.5">{dayName} คาบที่ {slot.period}</p>
          </div>
          <button onClick={onClose} className="text-purple-200 hover:text-white text-lg leading-none shrink-0">✕</button>
        </div>

        {/* Options list */}
        <div className="px-5 py-4 max-h-80 overflow-y-auto space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">เลือกวงที่ต้องการสอนในคาบนี้</p>
          {options.map((opt) => {
            const subj = subjects.find((s) => s.id === opt.subject_id);
            const teacher = teachers.find((t) => t.id === opt.teacher_id);
            const isActive = opt.id === slot.selected_option_id;
            return (
              <div
                key={opt.id}
                className={clsx(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-colors",
                  isActive ? "bg-purple-50 border-purple-300" : "bg-white border-gray-200 hover:border-purple-300",
                )}
              >
                <button
                  onClick={() => handleSelect(opt.id)}
                  disabled={busy}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {opt.label} {isActive && <span className="text-purple-600 text-xs">(กำลังใช้)</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{subj?.code ?? "?"} – {subj?.name} · {teacher?.name}</p>
                </button>
                {options.length > 1 && (
                  <button
                    onClick={() => handleDelete(opt.id)}
                    disabled={busy}
                    className="text-red-400 hover:text-red-600 text-xs px-1.5 py-1 shrink-0"
                    title="ลบวงนี้"
                  >
                    ✕
                  </button>
                )}
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
              <select
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                value={form.subject_id}
                onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
              >
                <option value="">เลือกวิชา</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
              </select>
              <select
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                value={form.teacher_id}
                onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}
              >
                <option value="">เลือกครู</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
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
      </div>
    </div>
  );
};
