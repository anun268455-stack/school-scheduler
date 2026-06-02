/**
 * App v3 — Top-toolbar layout with Periods + Bulk-Lock pages.
 */
import { useEffect, useRef, useState } from "react";
import { TopNavbar }    from "./components/layout/TopNavbar";
import { PrintView }    from "./components/print/PrintView";
import { TimetableGrid } from "./components/timetable/TimetableGrid";
import { Dashboard }    from "./pages/Dashboard";
import { useTimetableStore } from "./store/timetableStore";
import type { DashPage } from "./pages/Dashboard";

type Page = "timetable" | DashPage;
const DASH_PAGES: DashPage[] = ["groups","teachers","subjects","rooms","requirements","periods","locks"];

export default function App() {
  const [page, setPage] = useState<Page>("timetable");
  const { loadAll, slots, groups, selectedGroupId } = useTimetableStore();
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadAll(); }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* Sticky top toolbar */}
      <TopNavbar
        printRef={printRef}
        onCrudNav={(p) => setPage(p as Page)}
        currentPage={page}
      />

      {/* Main workspace */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {page === "timetable" && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <TimetableGrid />
          </div>
        )}

        {(DASH_PAGES as string[]).includes(page) && (
          <div className="flex-1 overflow-y-auto p-5">
            <Dashboard page={page as DashPage} />
          </div>
        )}
      </main>

      {/* Hidden print target */}
      <div style={{ position: "fixed", left: "-9999px", top: 0, width: "297mm", zIndex: -1 }}>
        <PrintView
          ref={printRef}
          slots={slots}
          groups={groups}
          filterGroupId={selectedGroupId}
        />
      </div>
    </div>
  );
}
