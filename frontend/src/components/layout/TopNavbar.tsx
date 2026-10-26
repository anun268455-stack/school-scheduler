/**
 * TopNavbar v3 — Consolidated top-toolbar with Periods + Bulk-Lock nav items.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useReactToPrint } from "react-to-print";

import { useTimetableStore } from "../../store/timetableStore";
import { SolverWidget } from "../solver/SolverWidget";
import { RepairClassesModal } from "../solver/RepairClassesModal";
import { ConsistencyModal } from "../solver/ConsistencyModal";
import { PeriodCheckModal } from "../solver/PeriodCheckModal";
import { CapacityModal } from "../solver/CapacityModal";
import { CurriculumAuditModal } from "../curriculum/CurriculumAuditModal";
import { AlertChips } from "../common/AlertChips";
import { PrintOptionsModal } from "../print/PrintOptionsModal";
import { useDismissOnOutside } from "../common/ModalShell";
import { SearchableSelect } from "../common/SearchableSelect";
import { byTeacherCode } from "../../utils/teacherOrder";
import type { PrintOptions } from "../print/PrintView";
import type { ViewMode } from "../../types";

interface TopNavbarProps {
  printRef:    React.RefObject<HTMLDivElement>;
  printOptions: PrintOptions;
  onPrintOptionsChange: (o: PrintOptions) => void;
  onCrudNav:   (page: string) => void;
  currentPage: string;
}

/**
 * 💾 บันทึกแล้ว HH:MM — the copy in this browser, visible at all times.
 *
 * The school's question was not "does it save?" but "is what I am doing right
 * now saved?", and no amount of machinery answers that from behind the scenes.
 * A clock time does: if it says 15:04 and it is 15:20, something is wrong, and
 * they can see that without being told what to look for.
 */
const SaveIndicator: React.FC = () => {
  const at      = useTimetableStore((s) => s.serverSavedAt);
  const saving  = useTimetableStore((s) => s.serverSaving);
  const problem = useTimetableStore((s) => s.serverStoreError);
  const localAt = useTimetableStore((s) => s.lastSavePointAt);
  // Re-render on the minute so "x นาทีที่แล้ว" does not go stale on screen.
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const time = at
    ? new Date(at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
    : null;
  const mins = at ? Math.floor((Date.now() - at) / 60000) : null;

  const label = problem ? "ยังไม่ปลอดภัย"
    : saving ? "กำลังเซฟ…"
    : time ? `เซฟ ${time}`
    : "ยังไม่ได้เซฟ";

  return (
    <div className="flex items-center px-2 border-r border-gray-700 shrink-0">
      <span
        title={
          problem
            ? `เซิร์ฟเวอร์ยังไม่ได้เก็บข้อมูลลงฐานข้อมูล (${problem}) — `
              + "ข้อมูลอาจหายเมื่อระบบรีสตาร์ท ดูรายละเอียดที่แถบเตือนด้านบน"
            : at
            ? `เซิร์ฟเวอร์บันทึกลงฐานข้อมูลแล้วเมื่อ ${new Date(at).toLocaleString("th-TH")}`
              + ` (${mins} นาทีที่แล้ว)`
              + (localAt ? ` · สำเนาในเบราว์เซอร์นี้ ${new Date(localAt).toLocaleTimeString("th-TH")}` : "")
            : "ยังไม่มีการแก้ไขตั้งแต่เปิดหน้านี้ — ระบบจะบันทึกให้เองทุกครั้งที่แก้ไข"
        }
        className={clsx(
          "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium border",
          problem ? "bg-red-900/40 border-red-700 text-red-300"
          : saving ? "bg-amber-900/40 border-amber-700 text-amber-200"
          : at ? "bg-emerald-900/40 border-emerald-700 text-emerald-300"
          : "bg-gray-800 border-gray-600 text-gray-400",
        )}
      >
        <span>{problem ? "⚠" : "💾"}</span>
        {label}
      </span>
    </div>
  );
};

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
  { id: "yards",        icon: "🌳", label: "ลำดับลาน",       divider: false },
  { id: "requirements", icon: "📋", label: "การสอน/วิชา",    divider: false },
  { id: "curriculum",    icon: "📚", label: "หลักสูตร",       divider: false },
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
    preLockMode, setPreLockMode, manualMode, setManualMode,
    yardPickMode, setYardPickMode,
    lockAll, unlockAll,
    liveSync, setLiveSync, syncState, remoteUpdates, isSolving, runSolver,
  } = useTimetableStore();

  const [showSolver,  setShowSolver]  = useState(false);
  const [showRepair,  setShowRepair]  = useState(false);
  const [showCrud,    setShowCrud]    = useState(false);
  const [showTools,   setShowTools]   = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showPrintOpts, setShowPrintOpts] = useState(false);
  const [showCheck,   setShowCheck]   = useState(false);
  const [showPeriods, setShowPeriods] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [showCurric,  setShowCurric]  = useState(false);

  // Toolbar popovers close when you click anywhere else, or press Esc.
  const solverRef = useRef<HTMLDivElement>(null);
  const crudRef   = useRef<HTMLDivElement>(null);
  const toolsRef  = useRef<HTMLDivElement>(null);
  useDismissOnOutside(solverRef, showSolver, useCallback(() => setShowSolver(false), []));
  useDismissOnOutside(crudRef,   showCrud,   useCallback(() => setShowCrud(false), []));
  useDismissOnOutside(toolsRef,  showTools,  useCallback(() => setShowTools(false), []));

  // ห้องที่ปิดไว้ว่า "จัดเสร็จแล้ว" — นับเฉพาะห้องที่กดปิดเอง ไม่นับห้องย่อย
  // ที่ถูกปิดตามห้องแม่ ไม่งั้นตัวเลขจะดูเยอะเกินจริงจนคนไม่เข้าใจว่ามาจากไหน
  const lockedClassNames = useMemo(
    () => groups.flatMap((g) => [g, ...(g.children ?? [])])
      .filter((g) => g.schedule_locked)
      .map((g) => g.name),
    [groups],
  );

  const entityOptions = viewMode === "group"
    ? groups.flatMap((g) => [g, ...(g.children ?? [])])
    : viewMode === "teacher"
    ? byTeacherCode(teachers)   // same order as the ครูผู้สอน page
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


  return (
    <header className="no-print sticky top-0 z-50 flex flex-wrap items-center gap-y-1 bg-gray-900 text-white shadow-lg border-b border-gray-700 px-3 py-1 min-h-12 shrink-0">

      {/* Logo */}
      <div
        className="flex items-center gap-1.5 pr-3 border-r border-gray-700 cursor-pointer shrink-0"
        onClick={() => onCrudNav("timetable")}
      >
        <span className="text-lg">📐</span>
        <span className="font-bold text-sm tracking-wide">ตารางเรียน</span>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-0.5 px-2 border-r border-gray-700 shrink-0">
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
        <div className="px-2 border-r border-gray-700 w-[252px] shrink-0">
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

      {/* The copy in this browser, said out loud.
          "I don't know whether what I'm doing is saved" is not answered by a
          copy being taken; it is answered by seeing when it was taken. */}
      <SaveIndicator />

      {/* Live-sync indicator — shows that two people can edit at once */}
      {/* relative เพื่อให้กล่องรายละเอียดของ AlertChips กางออกมาใต้ป้ายพอดี */}
      <div className="relative flex items-center gap-1.5 px-2 border-r border-gray-700 shrink-0">
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
        {/* เรื่องที่ต้องรู้แต่ไม่ต้องกินพื้นที่: รุ่นของเซิร์ฟเวอร์ · คาบไม่พอ
            เงียบสนิทเมื่อไม่มีอะไรผิด กดแล้วค่อยกางรายละเอียด */}
        <AlertChips />
      </div>

      {/* เครื่องมือ — one button.
          Lock mode, lock-all, unlock-all, print and PDF were five buttons in
          a row competing with the three that matter (the view tabs, the
          picker, สร้างตาราง). Four of them are things you reach for now and
          then, so they live behind one ⋯ and the bar stays readable. Lock
          mode keeps a lit state on the button itself, because while it is on
          every click in the grid does something different. */}
      <div ref={toolsRef} className="relative px-2 border-r border-gray-700 shrink-0">
        <button
          onClick={() => { setShowTools((v) => !v); setShowSolver(false); setShowCrud(false); }}
          className={clsx(
            "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-all border",
            preLockMode
              ? "bg-amber-500 border-amber-400 text-white shadow-amber-500/30 shadow-md"
              : yardPickMode
              ? "bg-teal-600 border-teal-400 text-white shadow-teal-500/30 shadow-md"
              : "bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600",
          )}
          title="เครื่องมือ — ล็อกคาบ เลือกคาบเรียนลาน พิมพ์ และ PDF"
        >
          {manualMode ? "✋ จัดเอง" : preLockMode ? "🔒 กำลังล็อก" : yardPickMode ? "📌 กำลังเลือกลาน" : "⋯ เครื่องมือ"} <span className="text-[10px]">▾</span>
        </button>
        {showTools && (
          <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 min-w-[230px] py-1">
            {currentPage === "timetable" && (
              <>
                {/* โหมดจัดเอง — ลากวางได้ตามต้องการ ระบบเตือนแต่ไม่ห้าม
                    แก้อาการ "เลื่อนแล้วเด้งกลับมาที่เดิม" ซึ่งเกิดจากเซิร์ฟเวอร์
                    ปฏิเสธการย้ายที่ทำให้ชนกัน แล้วหน้าจอคืนคาบกลับที่เดิม */}
                <button
                  onClick={() => { setManualMode(!manualMode); setShowTools(false); }}
                  className={clsx("w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors",
                    manualMode ? "bg-indigo-600 text-white" : "text-gray-200 hover:bg-gray-700")}>
                  ✋
                  <span className="flex-1">โหมดจัดเอง — วางได้แม้จะชนกัน</span>
                  {manualMode && <span className="text-[10px]">กำลังเปิด</span>}
                </button>
                <button
                  onClick={() => { setPreLockMode(!preLockMode); setShowTools(false); }}
                  className={clsx("w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors",
                    preLockMode ? "bg-amber-600 text-white" : "text-gray-200 hover:bg-gray-700")}>
                  {preLockMode ? "🔒" : "🔓"}
                  <span className="flex-1">โหมดล็อก — คลิกคาบเพื่อล็อก</span>
                  {preLockMode && <span className="text-[10px]">กำลังเปิด</span>}
                </button>
                {/* Picks the ลาน for an hour of a class — empty hours too. Saves
                    as it goes; the timetable follows at the next สร้างตาราง. */}
                <button
                  onClick={() => { setYardPickMode(!yardPickMode); setShowTools(false); }}
                  className={clsx("w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors",
                    yardPickMode ? "bg-teal-600 text-white" : "text-gray-200 hover:bg-gray-700")}>
                  📌
                  <span className="flex-1">โหมดเลือกคาบเรียนลาน</span>
                  {yardPickMode && <span className="text-[10px]">กำลังเปิด</span>}
                </button>
                <button onClick={() => { lockAll(); setShowTools(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-700">
                  🔒 <span>ล็อกทุกคาบ</span>
                </button>
                <button onClick={() => { unlockAll(); setShowTools(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-700">
                  🔓 <span>ปลดล็อกทุกคาบ</span>
                </button>
                <div className="border-t border-gray-700 my-1" />
              </>
            )}
            <button
              onClick={() => { setShowPrintOpts(true); setShowTools(false); setShowSolver(false); setShowCrud(false); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-700">
              🖨 <span>พิมพ์…</span>
            </button>
            <button onClick={() => { setShowTools(false); handlePDF(); }} disabled={isExporting}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-700 disabled:text-gray-500">
              📥 <span>{isExporting ? "กำลังบันทึก…" : "บันทึกเป็น PDF"}</span>
            </button>
            <div className="border-t border-gray-700 my-1" />
            {/* The one place to ask "is everything still agreeing with
                everything else?" — renames, deletes and half-finished edits
                all leave their mark somewhere, and this finds them. */}
            <button
              onClick={() => { setShowCheck(true); setShowTools(false); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-700">
              🧭 <span>ตรวจความสอดคล้องของข้อมูล</span>
            </button>
            {/* ของที่สั่งไว้ใส่ลงได้ไหม — ถามก่อนกดสร้างตาราง ไม่ใช่หลังจาก
                อ่านตารางที่ออกมาแล้วเดาว่าติดกฎข้อไหน ส่วนที่เกินกว่าที่มีไม่มี
                วิธีจัดแบบไหนแก้ได้ ("ให้ลงคาบให้พอดีให้ได้") */}
            <button
              onClick={() => { setShowCapacity(true); setShowTools(false); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-700">
              ⚖️ <span>ตรวจว่าของที่สั่งไว้ใส่ลงได้ไหม</span>
            </button>
            {/* คาบสุดท้ายกับคาบว่างของแต่ละห้อง เทียบกับที่โรงเรียนตั้งไว้ —
                ตัวเลขที่โรงเรียนรู้ดีกว่าระบบ เพราะมาจากหลักสูตรของห้องนั้น */}
            <button
              onClick={() => { setShowPeriods(true); setShowTools(false); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-700">
              📐 <span>ตรวจคาบสุดท้าย / คาบว่าง</span>
            </button>
            {/* แผนการสอนของแต่ละห้องตรงกับหลักสูตรที่ผูกไว้ไหม — ห้องที่ไม่ได้ผูก
                ไม่ถูกตรวจ */}
            <button
              onClick={() => { setShowCurric(true); setShowTools(false); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-700">
              📚 <span>ตรวจหลักสูตร</span>
            </button>
          </div>
        )}
      </div>

      {/* Solver — two buttons, one above the other, and they must never be
          mistaken for each other: ⚡ rebuilds the whole school, 🔧 re-places
          only the classes ticked and leaves every other class exactly where
          it is. Different colour, different words, and the 🔧 dialog says
          what it will and will not touch before anything is pressed. */}
      <div ref={solverRef} className="relative px-2 border-r border-gray-700 shrink-0 flex flex-col items-stretch gap-0.5">
        {/* ห้องที่ปิดไว้ว่าจัดเสร็จแล้ว — บอกตรงนี้ ก่อนกด ไม่ใช่หลังกด
            "ถ้าฉันล็อกแล้ว ฉันให้จัดตารางใหม่ได้ไหม"
            ได้ และปุ่มทั้งสองจะข้ามห้องพวกนี้ไป แต่เดิมไม่มีอะไรบนจอยืนยัน
            ให้เลย คนจึงไม่กล้ากด เพราะกลัวว่างานที่ปิดไว้จะหาย */}
        {lockedClassNames.length > 0 && (
          <span
            title={`จะไม่ถูกแตะ: ${lockedClassNames.join(", ")}`}
            className="flex items-center justify-center gap-1 px-2 py-0.5 rounded bg-gray-700 border border-gray-500 text-gray-200 text-[10px] font-medium"
          >
            🔒 ปิดไว้ {lockedClassNames.length} ห้อง · จะไม่ถูกแตะ
          </span>
        )}
        <button
          onClick={() => { setShowSolver((v) => !v); setShowCrud(false); }}
          title={lockedClassNames.length > 0
            ? `จัดใหม่ทั้งโรงเรียน ยกเว้น ${lockedClassNames.length} ห้องที่ปิดไว้ว่าจัดเสร็จแล้ว`
            : "จัดตารางใหม่ทั้งโรงเรียน"}
          className="flex items-center justify-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-semibold transition-colors"
        >
          ⚡ สร้างตาราง
        </button>
        {/* จัดให้เสร็จ — ปิดคาบว่างกลางวันให้หมด แม้ชั่วโมงนั้นจะไม่มีห้องว่าง
            วัดบนข้อมูลจริง: รูกลางวัน ม.ต้น 17→10 · ม.ปลาย 74→25
            แลกกับคาบที่ยังไม่มีห้องเพิ่มขึ้น ซึ่งขึ้นกรอบแดงให้หาห้องเองทีหลัง */}
        <button
          onClick={() => { setShowSolver(false); setShowCrud(false); setShowTools(false);
                           void runSolver({ closeGapsHard: true }); }}
          disabled={isSolving}
          title={isSolving
            ? "ระบบกำลังจัดตารางอยู่ — รอให้เสร็จก่อน"
            : "จัดใหม่ทั้งโรงเรียน แล้วไล่ปิดคาบว่างกลางวันให้หมดเท่าที่ทำได้ "
              + "คาบที่หาห้องไม่ได้จะลงไปก่อนแล้วขึ้นกรอบแดงให้หาห้องเอง "
              + "— คาบที่ล็อกไว้ไม่ถูกแตะ"}
          className="flex items-center justify-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs font-semibold transition-colors"
        >
          ✅ จัดให้เสร็จ
        </button>
        <button
          onClick={() => { setShowSolver(false); setShowCrud(false); setShowTools(false); setShowRepair(true); }}
          disabled={isSolving}
          title={isSolving
            ? "ระบบกำลังจัดตารางอยู่ — รอให้เสร็จก่อน"
            : "จัดใหม่เฉพาะห้องที่ติ๊ก ห้องอื่นอยู่ที่เดิมทุกคาบ — ต่างจาก ⚡ สร้างตาราง ที่จัดใหม่ทั้งโรงเรียน"}
          className="flex items-center justify-center gap-1 px-2 py-0.5 rounded border border-amber-500/70 bg-amber-900/30 text-[11px] font-semibold text-amber-200 hover:bg-amber-800/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🔧 แก้เฉพาะห้องที่เลือก
        </button>
        {showSolver && (
          <div className="absolute right-0 top-full mt-1 z-50">
            <SolverWidget onClose={() => setShowSolver(false)} />
          </div>
        )}
      </div>

      {/* CRUD Menu */}
      <div ref={crudRef} className="relative px-2 border-r border-gray-700 shrink-0">
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

      <div className="ml-auto" />
      {showCheck && <ConsistencyModal onClose={() => setShowCheck(false)} />}
      {showPeriods && <PeriodCheckModal onClose={() => setShowPeriods(false)} />}
      {showCapacity && <CapacityModal onClose={() => setShowCapacity(false)} />}
      {showCurric && <CurriculumAuditModal onClose={() => setShowCurric(false)} />}
      {showRepair && <RepairClassesModal onClose={() => setShowRepair(false)} />}
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
