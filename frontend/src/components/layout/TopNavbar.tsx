/**
 * TopNavbar v3 — Consolidated top-toolbar with Periods + Bulk-Lock nav items.
 */
import React, { useState } from "react";
import clsx from "clsx";
import { useReactToPrint } from "react-to-print";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

import { useTimetableStore } from "../../store/timetableStore";
import { SolverWidget } from "../solver/SolverWidget";
import type { ViewMode } from "../../types";

interface TopNavbarProps {
  printRef:    React.RefObject<HTMLDivElement>;
  onCrudNav:   (page: string) => void;
  currentPage: string;
}

const VIEW_TABS: { id: ViewMode; icon: string; label: string }[] = [
  { id: "group",   icon: "👥", label: "ห้อง"   },
  { id: "teacher", icon: "👨‍🏫", label: "ครู"    },
  { id: "room",    icon: "🚪", label: "ห้องสอน" },
];

const CRUD_ITEMS = [
  { id: "groups",       icon: "👥", label: "ห้องเรียน",      divider: false },
  { id: "teachers",     icon: "👨‍🏫", label: "ครู",            divider: false },
  { id: "subjects",     icon: "📚", label: "วิชา",           divider: false },
  { id: "rooms",        icon: "🚪", label: "ห้องสอน",        divider: false },
  { id: "requirements", icon: "📋", label: "การสอน/วิชา",    divider: true  },
  { id: "periods",      icon: "⏰", label: "คาบ & เวลา",     divider: false },
  { id: "locks",        icon: "🔒", label: "ล็อคคาบ (กลุ่ม)", divider: false },
  { id: "departments", icon: "🏛", label: "กลุ่มสาระฯ",       divider: true  },
  { id: "analytics",  icon: "📊", label: "วิเคราะห์ตาราง",   divider: false },
  { id: "settings",   icon: "🏫", label: "ตั้งค่าโรงเรียน",  divider: false },
  { id: "help",       icon: "📖", label: "คู่มือการใช้งาน", divider: true  },
];

export const TopNavbar: React.FC<TopNavbarProps> = ({ printRef, onCrudNav, currentPage }) => {
  const {
    viewMode, setViewMode,
    groups, teachers, rooms,
    selectedGroupId, setSelectedGroupId,
    selectedTeacherId, setSelectedTeacherId,
    selectedRoomId, setSelectedRoomId,
    preLockMode, setPreLockMode,
    slots, lockAll, unlockAll,
  } = useTimetableStore();

  const [showSolver,  setShowSolver]  = useState(false);
  const [showCrud,    setShowCrud]    = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const entityOptions = viewMode === "group"
    ? groups.flatMap((g) => [g, ...(g.children ?? [])])
    : viewMode === "teacher"
    ? teachers
    : rooms;

  const selectedId = viewMode === "group" ? selectedGroupId
    : viewMode === "teacher" ? selectedTeacherId : selectedRoomId;

  const handleEntityChange = (id: number) => {
    if (viewMode === "group")   setSelectedGroupId(id);
    if (viewMode === "teacher") setSelectedTeacherId(id);
    if (viewMode === "room")    setSelectedRoomId(id);
  };

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: "ตารางเรียน",
    pageStyle: "@page { size: A4 landscape; margin: 10mm; } * { -webkit-print-color-adjust: exact; }",
  });

  const handlePDF = async () => {
    if (!printRef.current) return;
    setIsExporting(true);
    try {
      const pages = printRef.current.querySelectorAll<HTMLElement>(".print-page");
      const pdf   = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();
        const canvas  = await html2canvas(pages[i], { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL("image/png");
        const w       = pdf.internal.pageSize.getWidth();
        const h       = (canvas.height * w) / canvas.width;
        pdf.addImage(imgData, "PNG", 0, 0, w, Math.min(h, pdf.internal.pageSize.getHeight()));
      }
      pdf.save(`timetable-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setIsExporting(false);
    }
  };

  const lockedCount = slots.filter((s) => s.is_locked).length;
  const totalSlots  = slots.length;

  return (
    <header className="no-print sticky top-0 z-50 flex items-center gap-0 bg-gray-900 text-white shadow-lg border-b border-gray-700 px-3 h-12 shrink-0">

      {/* Logo */}
      <div
        className="flex items-center gap-1.5 pr-4 border-r border-gray-700 cursor-pointer shrink-0"
        onClick={() => onCrudNav("timetable")}
      >
        <span className="text-lg">📐</span>
        <span className="font-bold text-sm tracking-wide">ตารางเรียน</span>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-0.5 px-3 border-r border-gray-700 shrink-0">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setViewMode(tab.id); onCrudNav("timetable"); }}
            className={clsx(
              "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
              viewMode === tab.id && currentPage === "timetable"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700",
            )}
          >
            <span>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {/* Entity Selector */}
      {currentPage === "timetable" && (
        <div className="px-3 border-r border-gray-700 shrink-0">
          <select
            value={selectedId ?? ""}
            onChange={(e) => handleEntityChange(Number(e.target.value))}
            className="bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:ring-1 focus:ring-blue-500 outline-none min-w-[140px]"
          >
            <option value="">
              {viewMode === "group" ? "-- เลือกห้อง --"
               : viewMode === "teacher" ? "-- เลือกครู --"
               : "-- เลือกห้องสอน --"}
            </option>
            {entityOptions.map((e) => (
              <option key={(e as { id: number }).id} value={(e as { id: number }).id}>
                {(e as { name: string }).name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Lock Counter */}
      {currentPage === "timetable" && totalSlots > 0 && (
        <div className="flex items-center gap-1 px-3 border-r border-gray-700 text-xs text-gray-300 shrink-0">
          <span>🔒</span>
          <span className="font-mono">{lockedCount}/{totalSlots}</span>
        </div>
      )}

      {/* Pre-Lock Toggle */}
      {currentPage === "timetable" && (
        <div className="flex items-center gap-1.5 px-3 border-r border-gray-700 shrink-0">
          <button
            onClick={() => setPreLockMode(!preLockMode)}
            className={clsx(
              "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-all border",
              preLockMode
                ? "bg-amber-500 border-amber-400 text-white shadow-amber-500/30 shadow-md"
                : "bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600",
            )}
          >
            {preLockMode ? "🔒 กำลังล็อก" : "🔓 โหมดล็อก"}
          </button>
          <button onClick={lockAll}   title="ล็อกทั้งหมด" className="px-2 py-1 text-[10px] bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-gray-300">🔒 ทั้งหมด</button>
          <button onClick={unlockAll} title="ปลดล็อกทั้งหมด" className="px-2 py-1 text-[10px] bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-gray-300">🔓 ปลด</button>
        </div>
      )}

      {/* Solver */}
      <div className="relative px-3 border-r border-gray-700 shrink-0">
        <button
          onClick={() => { setShowSolver((v) => !v); setShowCrud(false); }}
          className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-semibold transition-colors"
        >
          ⚡ สร้างตาราง
        </button>
        {showSolver && (
          <div className="absolute right-0 top-full mt-1 z-50">
            <SolverWidget onClose={() => setShowSolver(false)} />
          </div>
        )}
      </div>

      {/* CRUD Menu */}
      <div className="relative px-3 border-r border-gray-700 shrink-0">
        <button
          onClick={() => { setShowCrud((v) => !v); setShowSolver(false); }}
          className="flex items-center gap-1 px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-200 transition-colors border border-gray-600"
        >
          ⚙ จัดการ <span className="text-[10px]">▾</span>
        </button>
        {showCrud && (
          <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 min-w-[180px]">
            {CRUD_ITEMS.map((item) => (
              <React.Fragment key={item.id}>
                {item.divider && <div className="border-t border-gray-700 my-0.5" />}
                <button
                  onClick={() => { onCrudNav(item.id); setShowCrud(false); }}
                  className={clsx(
                    "w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors",
                    currentPage === item.id ? "bg-blue-700 text-white" : "text-gray-200 hover:bg-gray-700",
                  )}
                >
                  <span>{item.icon}</span>{item.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Print & PDF */}
      <div className="flex items-center gap-1.5 pl-3 shrink-0">
        <button onClick={handlePrint}
          className="flex items-center gap-1 px-2.5 py-1 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-xs text-gray-200">
          🖨 พิมพ์
        </button>
        <button onClick={handlePDF} disabled={isExporting}
          className={clsx(
            "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium",
            isExporting ? "bg-gray-600 text-gray-400 cursor-not-allowed" : "bg-red-600 hover:bg-red-500 text-white",
          )}>
          {isExporting ? "⏳..." : "📥 PDF"}
        </button>
      </div>
    </header>
  );
};
