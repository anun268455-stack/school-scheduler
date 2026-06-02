import React from "react";
import clsx from "clsx";
import { useTimetableStore } from "../../store/timetableStore";

interface SidebarProps {
  onNavigate: (page: string) => void;
  currentPage: string;
}

const NAV_ITEMS = [
  { id: "timetable",    label: "ตารางเรียน",    icon: "📅" },
  { id: "groups",       label: "ห้องเรียน",      icon: "🏫" },
  { id: "teachers",     label: "ครู",            icon: "👨‍🏫" },
  { id: "subjects",     label: "วิชาเรียน",      icon: "📚" },
  { id: "rooms",        label: "ห้องสอน",        icon: "🚪" },
  { id: "requirements", label: "ข้อกำหนดคาบ",    icon: "📋" },
];

export const Sidebar: React.FC<SidebarProps> = ({ onNavigate, currentPage }) => {
  const { groups, selectedGroupId, setSelectedGroupId, teachers, selectedTeacherId, setSelectedTeacherId, viewMode, setViewMode } =
    useTimetableStore();

  const topLevelGroups = groups.filter((g) => g.parent_id === null);

  return (
    <aside className="no-print flex flex-col w-60 min-h-screen bg-blue-900 text-white shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-blue-800">
        <h1 className="text-lg font-bold leading-tight">📐 ตารางเรียน</h1>
        <p className="text-blue-300 text-xs mt-0.5">ระบบจัดตารางอัจฉริยะ</p>
      </div>

      {/* Main nav */}
      <nav className="flex-1 py-4 space-y-0.5 px-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={clsx(
              "w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors",
              currentPage === item.id
                ? "bg-blue-700 text-white"
                : "text-blue-200 hover:bg-blue-800 hover:text-white",
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}

        {/* Timetable filter panel (only when on timetable page) */}
        {currentPage === "timetable" && (
          <div className="mt-4 pt-4 border-t border-blue-800">
            {/* View mode toggle */}
            <div className="flex rounded overflow-hidden mb-3 text-xs">
              <button
                onClick={() => setViewMode("group")}
                className={clsx(
                  "flex-1 py-1.5 font-medium transition-colors",
                  viewMode === "group" ? "bg-blue-500 text-white" : "bg-blue-800 text-blue-200 hover:bg-blue-700",
                )}
              >
                ห้อง
              </button>
              <button
                onClick={() => setViewMode("teacher")}
                className={clsx(
                  "flex-1 py-1.5 font-medium transition-colors",
                  viewMode === "teacher" ? "bg-blue-500 text-white" : "bg-blue-800 text-blue-200 hover:bg-blue-700",
                )}
              >
                ครู
              </button>
            </div>

            {viewMode === "group" && (
              <div className="space-y-0.5">
                <p className="text-blue-400 text-[10px] font-semibold px-1 uppercase tracking-wider mb-1">
                  ห้องเรียน
                </p>
                {topLevelGroups.map((g) => (
                  <div key={g.id}>
                    <button
                      onClick={() => setSelectedGroupId(g.id)}
                      className={clsx(
                        "w-full text-left px-2 py-1 rounded text-xs transition-colors",
                        selectedGroupId === g.id
                          ? "bg-blue-500 text-white font-semibold"
                          : "text-blue-200 hover:bg-blue-800",
                      )}
                    >
                      {g.name}
                    </button>
                    {/* Children (parallel tracks) */}
                    {g.children?.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => setSelectedGroupId(child.id)}
                        className={clsx(
                          "w-full text-left pl-5 pr-2 py-1 rounded text-[11px] transition-colors",
                          selectedGroupId === child.id
                            ? "bg-blue-500 text-white font-semibold"
                            : "text-blue-300 hover:bg-blue-800",
                        )}
                      >
                        └ {child.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {viewMode === "teacher" && (
              <div className="space-y-0.5">
                <p className="text-blue-400 text-[10px] font-semibold px-1 uppercase tracking-wider mb-1">
                  ครูผู้สอน
                </p>
                {teachers.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTeacherId(t.id)}
                    className={clsx(
                      "w-full text-left px-2 py-1 rounded text-xs transition-colors",
                      selectedTeacherId === t.id
                        ? "bg-blue-500 text-white font-semibold"
                        : "text-blue-200 hover:bg-blue-800",
                    )}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-blue-800 text-blue-400 text-[10px]">
        v1.0.0 · CP-SAT Solver
      </div>
    </aside>
  );
};
