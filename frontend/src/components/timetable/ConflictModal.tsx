/**
 * ConflictModal — appears when a drag-and-drop would cause a conflict.
 * Shows who is affected and offers resolution paths.
 */
import React from "react";
import type { TimetableSlot } from "../../types";
import { DAYS } from "../../types";

export interface ConflictInfo {
  type:   "teacher" | "group" | "room";
  name:   string;
  slot:   TimetableSlot;
}

export interface PendingMove {
  slotId:    number;
  newDay:    number;
  newPeriod: number;
  conflicts: ConflictInfo[];
}

interface ConflictModalProps {
  pending:          PendingMove;
  draggingSlotInfo: TimetableSlot | null; // reserved for future use
  onForceMove:      () => void;
  onSwap:           () => void;
  onCancel:         () => void;
}

const IMPACT_ICON: Record<ConflictInfo["type"], string> = {
  teacher: "👨‍🏫",
  group:   "👥",
  room:    "🚪",
};

export const ConflictModal: React.FC<ConflictModalProps> = ({
  pending, draggingSlotInfo: _draggingSlotInfo, onForceMove, onSwap, onCancel,
}) => {
  const dayName    = DAYS[pending.newDay] ?? `วัน ${pending.newDay}`;
  const periodNum  = pending.newPeriod;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">

        {/* Header */}
        <div className="flex items-center gap-3 bg-amber-500 px-5 py-4">
          <span className="text-2xl">⚡</span>
          <div>
            <h2 className="text-white font-bold text-base leading-tight">ตรวจพบความขัดแย้ง</h2>
            <p className="text-amber-100 text-xs mt-0.5">
              คาบ{dayName} คาบที่ {periodNum} — {pending.conflicts.length} รายการที่ถูกกระทบ
            </p>
          </div>
        </div>

        {/* Conflict list */}
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">รายละเอียดความขัดแย้ง</p>
          <div className="space-y-2">
            {pending.conflicts.map((c, i) => (
              <div key={i} className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <span className="text-lg mt-0.5">{IMPACT_ICON[c.type]}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-800 truncate">{c.name}</p>
                  <p className="text-xs text-red-600">
                    กำลังสอน <strong>{c.slot.subject_code ?? c.slot.subject_name}</strong>
                    {c.slot.group_name ? ` ห้อง ${c.slot.group_name}` : ""}
                    {c.slot.room_name ? ` · ${c.slot.room_name}` : ""}
                  </p>
                </div>
                <span className="text-xs text-red-400 font-mono shrink-0">
                  {c.type === "teacher" ? "ครูซ้ำ" : c.type === "group" ? "ห้องซ้ำ" : "ห้องสอนซ้ำ"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Resolution paths */}
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">เลือกวิธีแก้ไข</p>

          {/* Path A: Swap */}
          <button
            onClick={onSwap}
            className="w-full flex items-start gap-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-400 rounded-xl px-4 py-3 transition-all text-left group"
          >
            <span className="text-xl mt-0.5">🔄</span>
            <div className="flex-1">
              <p className="text-sm font-bold text-blue-900 group-hover:text-blue-700">
                สลับคาบ
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                ย้ายคาบที่ขัดแย้งมาอยู่ตำแหน่งเดิมของคาบที่กำลังลาก
              </p>
            </div>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium shrink-0 mt-0.5">
              แนะนำ
            </span>
          </button>

          {/* Path C: Force */}
          <button
            onClick={onForceMove}
            className="w-full flex items-start gap-3 bg-red-50 hover:bg-red-100 border border-red-200 hover:border-red-400 rounded-xl px-4 py-3 transition-all text-left group"
          >
            <span className="text-xl mt-0.5">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-bold text-red-900 group-hover:text-red-700">
                บังคับวาง
              </p>
              <p className="text-xs text-red-600 mt-0.5">
                วางทับคาบเดิม — คาบที่ขัดแย้งจะถูก<strong>ลบออก</strong>จากตาราง
              </p>
            </div>
            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium shrink-0 mt-0.5">
              เสี่ยง
            </span>
          </button>
        </div>

        {/* Cancel */}
        <div className="px-5 pb-4 flex justify-end">
          <button
            onClick={onCancel}
            className="px-5 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors font-medium"
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
};
