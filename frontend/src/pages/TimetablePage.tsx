import React from "react";
import { TimetableGrid } from "../components/timetable/TimetableGrid";
import { useTimetableStore } from "../store/timetableStore";

export const TimetablePage: React.FC = () => {
  const { selectedGroupId, selectedTeacherId, viewMode, groups, teachers, isLoading } =
    useTimetableStore();

  const selectedEntity =
    viewMode === "group"
      ? groups.find((g) => g.id === selectedGroupId)
      : teachers.find((t) => t.id === selectedTeacherId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        <svg className="animate-spin h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        กำลังโหลด…
      </div>
    );
  }

  if (!selectedGroupId && !selectedTeacherId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <span className="text-4xl mb-3">📅</span>
        <p className="text-sm">เลือกห้องเรียนหรือครูจากแผงด้านซ้ายเพื่อดูตาราง</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      {selectedEntity && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-lg font-bold text-gray-800">
            {viewMode === "group" ? "ห้อง" : "ครู"}: {selectedEntity.name}
          </span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {viewMode === "group" ? "ตารางเรียนนักเรียน" : "ตารางสอนครู"}
          </span>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <TimetableGrid />
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
        <LegendItem color="bg-outdoor-light border-outdoor-border" label="กลางแจ้ง ☀" />
        <LegendItem color="bg-heavy-light border-heavy" label="วิชาหนัก 📚" />
        <LegendItem color="bg-parallel-light border-parallel" label="คู่ขนาน ↔" />
        <LegendItem color="bg-gray-100 border-gray-300" label="ล็อก 🔒" />
        <span className="flex items-center gap-1">
          <span className="inline-block w-5 h-3 bg-blue-500 rounded-sm text-white text-[9px] font-bold flex items-center justify-center">2×</span>
          คาบคู่
        </span>
      </div>
    </div>
  );
};

const LegendItem: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded border ${color}`}>
    {label}
  </span>
);
