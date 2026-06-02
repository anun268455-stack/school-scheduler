import React, { useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import clsx from "clsx";
import { PrintView } from "../print/PrintView";
import { useTimetableStore } from "../../store/timetableStore";
import type { SolverResult } from "../../types";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

interface HeaderProps {
  title: string;
}

export const Header: React.FC<HeaderProps> = ({ title }) => {
  const { slots, groups, selectedGroupId, isSolving, solverError, runSolver } = useTimetableStore();
  const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
  const [showSolverPanel, setShowSolverPanel] = useState(false);
  const [timeLimitSec, setTimeLimitSec] = useState(120);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  // react-to-print
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `ตารางเรียน-${selectedGroupId ?? "ทั้งหมด"}`,
    pageStyle: `
      @page { size: A4 landscape; margin: 10mm; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    `,
  });

  // PDF export (all groups as multi-page)
  const handlePDFExport = async () => {
    if (!printRef.current) return;
    setIsExportingPDF(true);
    try {
      const pages = printRef.current.querySelectorAll<HTMLElement>(".print-page");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();
        const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL("image/png");
        const pdfW = pdf.internal.pageSize.getWidth();
        const pdfH = (canvas.height * pdfW) / canvas.width;
        pdf.addImage(imgData, "PNG", 0, 0, pdfW, Math.min(pdfH, pdf.internal.pageSize.getHeight()));
      }
      pdf.save(`timetable-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setIsExportingPDF(false);
    }
  };

  const handleSolve = async () => {
    try {
      const result = await runSolver(timeLimitSec);
      setSolverResult(result);
    } catch {
      // error handled in store
    }
  };

  return (
    <>
      <header className="no-print sticky top-0 z-30 flex items-center gap-3 bg-white border-b border-gray-200 px-4 py-2.5 shadow-sm">
        <h2 className="text-base font-bold text-gray-800 flex-1">{title}</h2>

        {/* Solver trigger */}
        <div className="relative">
          <button
            onClick={() => setShowSolverPanel((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 transition-colors"
          >
            ⚡ คำนวณตาราง
          </button>

          {showSolverPanel && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-xl p-4 z-50">
              <h3 className="font-semibold text-gray-800 mb-3">ตั้งค่า Solver</h3>

              <label className="block text-sm text-gray-600 mb-1">
                เวลาสูงสุด (วินาที)
              </label>
              <input
                type="number"
                min={10}
                max={600}
                value={timeLimitSec}
                onChange={(e) => setTimeLimitSec(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-3 focus:ring-1 focus:ring-indigo-500 outline-none"
              />

              {solverError && (
                <div className="text-xs text-red-600 bg-red-50 rounded p-2 mb-3">{solverError}</div>
              )}
              {solverResult && (
                <div className="text-xs text-green-700 bg-green-50 rounded p-2 mb-3 space-y-0.5">
                  <div>✅ สถานะ: <strong>{solverResult.status}</strong></div>
                  <div>📌 สร้างคาบ: {solverResult.slots_created}</div>
                  <div>⏱ เวลา: {solverResult.solve_time_seconds.toFixed(1)} วิ</div>
                  {solverResult.objective_value != null && (
                    <div>🎯 ค่าปรับรวม: {solverResult.objective_value}</div>
                  )}
                </div>
              )}

              <button
                onClick={handleSolve}
                disabled={isSolving}
                className={clsx(
                  "w-full py-2 rounded text-sm font-semibold transition-colors",
                  isSolving
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700",
                )}
              >
                {isSolving ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    กำลังคำนวณ…
                  </span>
                ) : "🚀 เริ่มคำนวณ"}
              </button>
            </div>
          )}
        </div>

        {/* Print */}
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 transition-colors"
        >
          🖨 พิมพ์
        </button>

        {/* PDF Export */}
        <button
          onClick={handlePDFExport}
          disabled={isExportingPDF}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors",
            isExportingPDF
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-red-600 text-white hover:bg-red-700",
          )}
        >
          {isExportingPDF ? "⏳ กำลังส่งออก…" : "📥 PDF"}
        </button>
      </header>

      {/* Hidden print target (rendered off-screen, visible only during print/PDF) */}
      <div style={{ position: "fixed", left: "-9999px", top: 0, width: "297mm" }}>
        <PrintView
          ref={printRef}
          slots={slots}
          groups={groups}
          filterGroupId={selectedGroupId}
        />
      </div>
    </>
  );
};
