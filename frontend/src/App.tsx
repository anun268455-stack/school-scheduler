/**
 * App v4 — Top-toolbar layout with school config + pixel-perfect print.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TopNavbar }     from "./components/layout/TopNavbar";
import { PrintView, DEFAULT_PRINT_OPTIONS, type PrintOptions } from "./components/print/PrintView";
import { TimetableGrid } from "./components/timetable/TimetableGrid";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useTimetableStore } from "./store/timetableStore";
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
const DASH_PAGES: DashPage[] = ["groups","teachers","subjects","rooms","requirements","electives","activities","periods","locks","settings","departments","analytics","help"];

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
    loadAll, slots, groups, teachers, departments, periods, schoolConfig,
    subjects, requirements,
    startLiveSync, stopLiveSync,
  } = useTimetableStore();
  const [printOptions, setPrintOptions] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS);
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
        onPrintOptionsChange={setPrintOptions}
      />

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
                <Dashboard page={page as DashPage} />
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
