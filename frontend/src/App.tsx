/**
 * App v4 — Top-toolbar layout with school config + pixel-perfect print.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TopNavbar }     from "./components/layout/TopNavbar";
import { PrintView }     from "./components/print/PrintView";
import { TimetableGrid } from "./components/timetable/TimetableGrid";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useTimetableStore } from "./store/timetableStore";
import type { DashPage } from "./pages/Dashboard";

const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));

type Page = "timetable" | DashPage;
const DASH_PAGES: DashPage[] = ["groups","teachers","subjects","rooms","requirements","electives","periods","locks","settings","departments","analytics","help"];

export default function App() {
  const [page, setPage] = useState<Page>("timetable");
  const {
    loadAll, slots, groups, teachers, periods, schoolConfig,
    selectedGroupId, selectedTeacherId,
  } = useTimetableStore();
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadAll(); }, [loadAll]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <TopNavbar
        printRef={printRef}
        onCrudNav={(p) => setPage(p as Page)}
        currentPage={page}
      />

      <main className="flex-1 overflow-hidden flex flex-col">
        <ErrorBoundary>
          {page === "timetable" && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <TimetableGrid />
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
      <div style={{ position: "fixed", left: "-9999px", top: 0, width: "297mm", zIndex: -1 }}>
        <PrintView
          ref={printRef}
          slots={slots}
          groups={groups}
          teachers={teachers}
          periods={periods}
          schoolConfig={schoolConfig}
          filterGroupId={selectedGroupId}
          filterTeacherId={selectedTeacherId}
        />
      </div>
    </div>
  );
}
