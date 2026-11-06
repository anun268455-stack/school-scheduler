/**
 * App v4 — Top-toolbar layout with school config + pixel-perfect print.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { TopNavbar }     from "./components/layout/TopNavbar";
import { PrintView, DEFAULT_PRINT_OPTIONS, type PrintOptions } from "./components/print/PrintView";
import { TimetableGrid } from "./components/timetable/TimetableGrid";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StorageWarningBanner } from "./components/backup/StorageWarningBanner";
import { useAutoSavePoints } from "./utils/useAutoSavePoints";
import { useTimetableStore } from "./store/timetableStore";
import {
  mergeRemembered, parseStored, toRemember, PRINT_MEMORY_KEY,
} from "./utils/printMemory";
import type { DashPage } from "./pages/Dashboard";

const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
// ระบบจัดการสอนแทน — the teachers' page, at #/substitute. Loaded only when
// that link is opened, so the editor's bundle is not what a teacher downloads.
const SubstituteApp = lazy(() => import("./pages/SubstituteApp"));

/** True when the URL asks for the teachers' page rather than the editor. */
function wantsSubstitute(): boolean {
  return /^#\/?(substitute|sub|teacher)\b/i.test(window.location.hash);
}

type Page = "timetable" | DashPage;
const DASH_PAGES: DashPage[] = ["groups","teachers","subjects","rooms","yards","requirements","curriculum","electives","activities","periods","locks","settings","terms","departments","analytics","help"];

export default function App() {
  // Decided before anything else: the two pages share data but no chrome, and
  // a teacher following the link must never see the editor's toolbar flash up
  // on the way. The hash is watched so moving between them needs no reload.
  const [onSubstitute, setOnSubstitute] = useState(wantsSubstitute);
  useEffect(() => {
    const sync = () => setOnSubstitute(wantsSubstitute());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const [page, setPage] = useState<Page>("timetable");
  const {
    loadAll, slots, groups, teachers, rooms, departments, periods, schoolConfig,
    subjects, requirements,
    startLiveSync, stopLiveSync,
  } = useTimetableStore();
  /**
   * ตัวเลือกการพิมพ์ — จำไว้ในเครื่องนี้ ไม่ต้องตั้งใหม่ทุกครั้งที่เปิดหน้าเว็บ
   *
   * ของเดิมอยู่ใน state เฉย ๆ ปิดแท็บแล้วหายหมด ต้องมาเลือกว่าพิมพ์อะไร กี่ใบ
   * ต่อแผ่น และพิมพ์คำว่า "เสริมการเรียนรู้" ใหม่ทุกครั้ง
   *
   * เก็บในเครื่อง ไม่ใช่ที่เซิร์ฟเวอร์ และไม่จำว่าติ๊กห้องไหนไว้ — เหตุผลทั้งสอง
   * ข้ออยู่ใน utils/printMemory.ts
   */
  const [printOptions, setPrintOptions] = useState<PrintOptions>(() => {
    try {
      return mergeRemembered(DEFAULT_PRINT_OPTIONS,
                             parseStored(localStorage.getItem(PRINT_MEMORY_KEY)));
    } catch {
      return DEFAULT_PRINT_OPTIONS;   // โหมดส่วนตัวของเบราว์เซอร์ปิดที่เก็บไว้
    }
  });
  const rememberPrint = useCallback((o: PrintOptions) => {
    setPrintOptions(o);
    try {
      localStorage.setItem(PRINT_MEMORY_KEY, JSON.stringify(toRemember(o)));
    } catch { /* จำไม่ได้ก็ยังพิมพ์ได้ */ }
  }, []);
  const printRef = useRef<HTMLDivElement>(null);

  // The teachers' page fetches only what it needs through its own client, so
  // neither the editor's full load nor its polling runs there. With the link
  // going to every teacher in the school, that polling would otherwise be 143
  // browsers asking a small server for the timetable every few seconds.
  useEffect(() => {
    if (onSubstitute) return;
    loadAll();
  }, [loadAll, onSubstitute]);

  // Keep the page in step with anyone else editing at the same time.
  useEffect(() => {
    if (onSubstitute) return;
    startLiveSync();
    return () => stopLiveSync();
  }, [startLiveSync, stopLiveSync, onSubstitute]);

  // A rolling copy in this browser, for the nights the server wakes up empty,
  // and a check on arrival for the morning after one of those nights.
  useAutoSavePoints(!onSubstitute);

  if (onSubstitute) {
    return (
      <ErrorBoundary>
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
            กำลังโหลด…
          </div>}>
          <SubstituteApp />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <TopNavbar
        printRef={printRef}
        onCrudNav={(p) => setPage(p as Page)}
        currentPage={page}
        printOptions={printOptions}
        onPrintOptionsChange={rememberPrint}
      />

      {/* Stands above everything: if the server has thrown its data away, the
          copy on screen is the only one left and a reload would end it. */}
      <StorageWarningBanner />

      {/* เรื่องรุ่นของเซิร์ฟเวอร์กับคาบที่ไม่พอ เคยเป็นแถบเต็มความกว้างตรงนี้
          รวมกันแล้วกินพื้นที่เกินครึ่งจอเหนือตาราง ย้ายไปเป็นป้ายเล็กบนแถบ
          เครื่องมือแทน (AlertChips) — ข้อมูลเท่าเดิม แต่ไม่บังของจริง */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <ErrorBoundary>
          {page === "timetable" && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <TimetableGrid onNav={(p) => setPage(p as Page)} />
            </div>
          )}
          {(DASH_PAGES as string[]).includes(page) && (
            <div className="flex-1 overflow-y-auto p-5">
              <Suspense fallback={<div className="text-center text-gray-400 text-sm py-20">กำลังโหลด…</div>}>
                <Dashboard page={page as DashPage} onNav={(p) => setPage(p as Page)} />
              </Suspense>
            </div>
          )}
        </ErrorBoundary>
      </main>

      {/* Hidden print target — pixel-perfect format */}
      <div style={{ position: "fixed", left: "-9999px", top: 0, width: "210mm", zIndex: -1 }}>
        <PrintView
          ref={printRef}
          slots={slots}
          groups={groups}
          teachers={teachers}
          rooms={rooms}
          departments={departments}
          subjects={subjects}
          requirements={requirements}
          periods={periods}
          schoolConfig={schoolConfig}
          options={printOptions}
        />
      </div>
    </div>
  );
}
