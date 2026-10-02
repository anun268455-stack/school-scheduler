/**
 * TopNavbar v3 — Consolidated top-toolbar with Periods + Bulk-Lock nav items.
 */
import React, { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import { useReactToPrint } from "react-to-print";

import { useTimetableStore } from "../../store/timetableStore";
import { SolverWidget } from "../solver/SolverWidget";
import { PrintOptionsModal } from "../print/PrintOptionsModal";
import { ClearTimetableModal } from "../timetable/ClearTimetableModal";
import { useDismissOnOutside } from "../common/ModalShell";
import { SearchableSelect } from "../common/SearchableSelect";
import type { PrintOptions } from "../print/PrintView";
import type { ViewMode } from "../../types";

interface TopNavbarProps {
  printRef:    React.RefObject<HTMLDivElement>;
  printOptions: PrintOptions;
  onPrintOptionsChange: (o: PrintOptions) => void;
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
  { id: "requirements", icon: "📋", label: "การสอน/วิชา",    divider: false },
  { id: "electives",    icon: "🎓", label: "วิชาเสรี",       divider: false },
  { id: "activities",   icon: "🤝", label: "คาบกิจกรรมประจำระดับ", divider: true  },
  { id: "periods",      icon: "⏰", label: "คาบ & เวลา",     divider: false },
  { id: "locks",        icon: "🔒", label: "ล็อคคาบ (กลุ่ม)", divider: false },
  { id: "departments", icon: "🏛", label: "กลุ่มสาระฯ",       divider: true  },
  { id: "analytics",  icon: "📊", label: "วิเคราะห์ตาราง",   divider: false },
  { id: "settings",   icon: "🏫", label: "ตั้งค่าโรงเรียน",  divider: false },
  { id: "help",       icon: "📖", label: "คู่มือการใช้งาน", divider: true  },
];

export const TopNavbar: React.FC<TopNavbarProps> = ({ printRef, onCrudNav, currentPage, printOptions, onPrintOptionsChange }) => {
  const {
    viewMode, setViewMode,
    groups, teachers, rooms,
    selectedGroupId, setSelectedGroupId,
    selectedTeacherId, setSelectedTeacherId,
    selectedRoomId, setSelectedRoomId,
    preLockMode, setPreLockMode,
    slots, lockAll, unlockAll,
    liveSync, setLiveSync, syncState, remoteUpdates,
  } = useTimetableStore();

  const [showSolver,  setShowSolver]  = useState(false);
  const [showCrud,    setShowCrud]    = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showPrintOpts, setShowPrintOpts] = useState(false);
  const [showClear,   setShowClear]   = useState(false);

  // Toolbar popovers close when you click anywhere else, or press Esc.
  const solverRef = useRef<HTMLDivElement>(null);
  const crudRef   = useRef<HTMLDivElement>(null);
  useDismissOnOutside(solverRef, showSolver, useCallback(() => setShowSolver(false), []));
  useDismissOnOutside(crudRef,   showCrud,   useCallback(() => setShowCrud(false), []));

  const entityOptions = viewMode === "group"
    ? groups.flatMap((g) => [g, ...(g.children ?? [])])
    : viewMode === "teacher"
    ? teachers
    : rooms;

  const selectedId = viewMode === "group" ? selectedGroupId
    : viewMode === "teacher" ? selectedTeacherId : selectedRoomId;

  /** null clears the selection and shows the "pick one" screen again. */
  const handleEntityChange = (id: number | null) => {
    if (viewMode === "group")   setSelectedGroupId(id);
    if (viewMode === "teacher") setSelectedTeacherId(id);
    if (viewMode === "room")    setSelectedRoomId(id);
  };

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: "ตารางเรียน",
    pageStyle: "@page { size: A4 portrait; margin: 8mm 10mm; } * { -webkit-print-color-adjust: exact; }",
  });

  // Apply the chosen options, let React paint the new sheets, then print.
  const confirmPrint = (o: PrintOptions) => {
    onPrintOptionsChange(o);
    setShowPrintOpts(false);
    setTimeout(() => handlePrint(), 150);
  };

  const handlePDF = async () => {
    if (!printRef.current) return;
    setIsExporting(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const pages = printRef.current.querySelectorAll<HTMLElement>(".print-page");
      const pdf   = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
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
    <header className="no-print sticky top-0 z-50 flex flex-wrap items-center gap-y-1 bg-gray-900 text-white shadow-lg border-b border-gray-700 px-3 py-1 min-h-12 shrink-0">

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

      {/* Entity Selector. A fixed width, not flex-1: every other item on this
          bar is shrink-0, so this was the only thing that could give — and it
          gave all of it, collapsing to a single letter and an arrow. The bar
          wraps to a second line when it must, which is the better way to lose
          space. */}
      {currentPage === "timetable" && (
        <div className="px-3 border-r border-gray-700 w-[260px] shrink-0">
          {/* Typing beats scrolling 143 teachers or 93 classes. */}
          <SearchableSelect
            tone="dark"
            value={selectedId == null ? "" : String(selectedId)}
            onChange={(v) => handleEntityChange(v === "" ? null : Number(v))}
            placeholder={viewMode === "group" ? "-- เลือกห้อง --"
              : viewMode === "teacher" ? "-- เลือกครู --"
              : "-- เลือกห้องสอน --"}
            emptyLabel={viewMode === "group" ? "-- เลือกห้อง --"
              : viewMode === "teacher" ? "-- เลือกครู --"
              : "-- เลือกห้องสอน --"}
            searchThreshold={8}
            options={entityOptions.map((e) => {
              const row = e as { id: number; name: string; code?: string | null; level?: string | null };
              return {
                value: String(row.id),
                // Teacher codes are how staff refer to each other, so they are
                // searchable here as well as the name.
                label: viewMode === "teacher" && row.code ? `${row.code} ${row.name}` : row.name,
                group: viewMode === "group" ? (row.level ?? undefined) : undefined,
              };
            })}
          />
        </div>
      )}

      {/* Pushes the actions right when there is room, and simply wraps when
          there is not — nothing gets cut off the edge either way. */}
      <div className="flex-1 min-w-0" />

      {/* Live-sync indicator — shows that two people can edit at once */}
      <div className="flex items-center px-3 border-r border-gray-700 shrink-0">
        <button
          onClick={() => setLiveSync(!liveSync)}
          title={
            !liveSync ? "ซิงค์อัตโนมัติปิดอยู่ — คลิกเพื่อเปิด"
            : syncState === "offline" ? "ต่อเซิร์ฟเวอร์ไม่ได้ — กำลังลองใหม่"
            : "ซิงค์อัตโนมัติเปิดอยู่ — เห็นการแก้ไขของคนอื่นโดยไม่ต้องรีเฟรช"
          }
          className={clsx(
            "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium border transition-colors",
            !liveSync        ? "bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-200"
            : syncState === "offline" ? "bg-red-900/40 border-red-700 text-red-300"
            : "bg-emerald-900/40 border-emerald-700 text-emerald-300",
          )}
        >
          <span className={clsx(
            "inline-block w-1.5 h-1.5 rounded-full",
            !liveSync ? "bg-gray-500"
            : syncState === "offline" ? "bg-red-400"
            : "bg-emerald-400 animate-pulse",
          )} />
          {!liveSync ? "ซิงค์ปิด" : syncState === "offline" ? "ออฟไลน์" : "ซิงค์สด"}
          {liveSync && syncState === "live" && remoteUpdates > 0 && (
            <span className="text-emerald-400/70">·{remoteUpdates}</span>
          )}
        </button>
      </div>

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

      {/* Clear the timetable — no more deleting one period at a time */}
      {currentPage === "timetable" && totalSlots > 0 && (
        <div className="flex items-center px-3 border-r border-gray-700 shrink-0">
          <button
            onClick={() => setShowClear(true)}
            title="ล้างตารางให้ว่าง"
            className="flex items-center gap-1 px-2.5 py-1 bg-red-900/60 hover:bg-red-700 border border-red-700 rounded text-xs font-semibold text-red-100 transition-colors"
          >
            🧹 ล้างตาราง
          </button>
        </div>
      )}
      {showClear && <ClearTimetableModal onClose={() => setShowClear(false)} />}

      {/* Solver */}
      <div ref={solverRef} className="relative px-3 border-r border-gray-700 shrink-0">
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
      <div ref={crudRef} className="relative px-3 border-r border-gray-700 shrink-0">
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
      <div className="flex items-center gap-1.5 pl-3 shrink-0 ml-auto">
        <button onClick={() => { setShowPrintOpts(true); setShowSolver(false); setShowCrud(false); }}
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
      {/* Print options */}
      {showPrintOpts && (
        <PrintOptionsModal
          value={printOptions}
          onChange={onPrintOptionsChange}
          onConfirm={confirmPrint}
          onClose={() => setShowPrintOpts(false)}
        />
      )}
    </header>
  );
};
