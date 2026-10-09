/**
 * Keeps a few recent copies of the data in this browser without anyone asking.
 *
 * The pinned เซฟหลัก covers the change somebody saw coming. This covers the
 * rest: the server sleeping overnight and waking up empty, which is how the
 * school lost work before anyone had a button to press. A copy is taken when
 * the data has actually moved on, so an idle tab does not fill the store with
 * six identical snapshots.
 */
import { useEffect, useRef } from "react";
import * as api from "../api/client";
import { useTimetableStore } from "../store/timetableStore";
import { putSavePoint, listSavePoints, storageAvailable } from "./savePoints";

/** How often to look; a copy is only written if the revision has moved. */
const CHECK_MS = 4 * 60 * 1000;

export function useAutoSavePoints(enabled: boolean): void {
  const savedRevision = useRef<number>(-1);
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || !storageAvailable()) return;

    const tick = async () => {
      if (running.current) return;
      const st = useTimetableStore.getState();
      // Never photograph a server that has just thrown its data away: that
      // snapshot is the shipped demo data, and saving it would push the real
      // copies out of the rolling window — destroying the safety net at
      // exactly the moment it is needed.
      if (st.serverReset) return;
      if (st.isSolving || st.isLoading || st.draggingSlot) return;
      if (typeof document !== "undefined" && document.hidden) return;

      running.current = true;
      try {
        const { revision } = await api.fetchStateVersion();
        if (revision === savedRevision.current) return;   // nothing new to keep
        const snap = await api.downloadBackup();
        // A copy with no teachers in it is not worth a slot in the window;
        // it means the fetch came back from a server mid-reset.
        const teachers = snap["teachers"];
        if (!Array.isArray(teachers) || teachers.length === 0) return;
        await putSavePoint("auto", snap);
        savedRevision.current = revision;
      } catch {
        /* a failed auto-save must never be visible; the next tick retries */
      } finally {
        running.current = false;
      }
    };

    void tick();
    const id = setInterval(tick, CHECK_MS) as unknown as number;
    return () => clearInterval(id);
  }, [enabled]);
}

/**
 * Catch the reset that happened while nobody was watching.
 *
 * The revision check only fires for a tab that was already open when the
 * server went down. The ordinary case is nobody is open: the server sleeps
 * overnight, wakes up on the shipped data, and the first person in next
 * morning is simply shown it — with no earlier number to compare and so no
 * warning at all. Here the server is asked outright what it is serving, and a
 * saved copy that holds more than the server does is taken as proof it lost
 * the school's work rather than the school never having entered any.
 */
export function useServerDataCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !storageAvailable()) return;
    let cancelled = false;

    (async () => {
      try {
        const info = await api.fetchStateInfo();
        if (cancelled || info.source === "snapshot") return;

        const all = await listSavePoints();
        if (cancelled || all.length === 0) return;
        const best = all.find((p) => p.kind === "main") ?? all[0];

        // Only raise it when our copy really is the fuller one. A school still
        // setting up has seed data on the server and little saved here, and
        // being told their data is missing every morning would be noise.
        const richer = (best.counts.slots ?? 0) > (info.counts.slots ?? 0)
          || (best.counts.teachers ?? 0) > (info.counts.teachers ?? 0);
        if (richer) useTimetableStore.setState({ serverReset: true });
      } catch {
        /* offline; the polling tick reports that separately */
      }
    })();

    return () => { cancelled = true; };
  }, [enabled]);
}
