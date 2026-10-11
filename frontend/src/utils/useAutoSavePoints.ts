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

/**
 * How often to look when nothing is happening.
 *
 * Mostly this catches somebody else's edit from another browser. The school's
 * own edits do not wait for it: each one schedules a copy of its own.
 */
const CHECK_MS = 2 * 60 * 1000;

/**
 * How long to wait after a change before copying.
 *
 * Long enough that dragging six lessons across the grid is one copy rather
 * than six, short enough that nobody can get ahead of it by much.
 */
const AFTER_CHANGE_MS = 6000;

export function useAutoSavePoints(enabled: boolean): void {
  const savedRevision = useRef<number>(-1);
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || !storageAvailable()) return;

    /** Settle the indicator. It must never be left reading "กำลังเซฟ…". */
    const settle = (why: "saved" | "failed" | "idle") =>
      useTimetableStore.setState((cur) =>
        cur.savePointState === why ? {} : { savePointState: why });

    const tick = async () => {
      if (running.current) return;
      const st = useTimetableStore.getState();
      if (st.isSolving || st.isLoading || st.draggingSlot) return;   // try again shortly
      if (typeof document !== "undefined" && document.hidden) return;

      running.current = true;
      try {
        const { revision } = await api.fetchStateVersion();
        if (revision === savedRevision.current) {        // nothing new to keep
          settle(st.lastSavePointAt ? "saved" : "idle");
          return;
        }
        const snap = await api.downloadBackup();
        // A copy with no teachers in it is not worth a slot in the window;
        // it means the fetch came back from a server mid-reset.
        const teachers = snap["teachers"];
        if (!Array.isArray(teachers) || teachers.length === 0) { settle("idle"); return; }

        // Nor is one whose timetable has collapsed. Copies are written on
        // every change, so a school that loses their คาบ and keeps working
        // would push the last good copy out of the window in minutes — and
        // that copy is the way back. A sharp drop simply stops the window
        // instead of feeding it; nothing is announced, because the server
        // itself says whether anything is wrong, up at the top of the page.
        const slots = Array.isArray(snap["slots"]) ? (snap["slots"] as unknown[]).length : 0;
        const kept = await listSavePoints();
        const most = kept.reduce((n, p) => Math.max(n, p.counts.slots ?? 0), 0);
        if (most > 20 && slots < most * 0.5) {
          settle("idle");
          return;
        }
        const meta = await putSavePoint("auto", snap);
        savedRevision.current = revision;
        // Say so on screen. "I do not know whether what I am doing is saved"
        // is the whole problem; a copy nobody can see does not answer it.
        useTimetableStore.setState({ lastSavePointAt: meta.saved_at, savePointState: "saved" });
      } catch {
        // A failed copy must not interrupt the work, but it must not look like
        // success either — the indicator turns and stays turned.
        useTimetableStore.setState({ savePointState: "failed" });
      } finally {
        running.current = false;
      }
    };

    void tick();
    const id = setInterval(tick, CHECK_MS) as unknown as number;

    // …and after every change the school makes, which is what they asked for:
    // "just save every single time". The revision counter moves on each write,
    // so this fires for their own edits and for anyone else's.
    let pending: number | undefined;
    // Anything that made tick() bail — mid-drag, mid-solve — is over in
    // seconds, so the indicator is given a second chance rather than being
    // left on "กำลังเซฟ…" until the next change.
    const retry = setInterval(() => {
      if (useTimetableStore.getState().savePointState === "saving") void tick();
    }, 15_000) as unknown as number;

    const unsubscribe = useTimetableStore.subscribe((st, prev) => {
      // The school's own edits land in the store directly, so watching the
      // lists catches them the moment they happen; lastRevision catches
      // somebody else's, arriving by poll.
      if (st.slots === prev.slots && st.requirements === prev.requirements
          && st.groups === prev.groups && st.teachers === prev.teachers
          && st.subjects === prev.subjects && st.rooms === prev.rooms
          && st.lastRevision === prev.lastRevision) return;
      useTimetableStore.setState({ savePointState: "saving" });
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => { void tick(); }, AFTER_CHANGE_MS) as unknown as number;
    });

    return () => {
      clearInterval(id);
      clearInterval(retry);
      if (pending !== undefined) clearTimeout(pending);
      unsubscribe();
    };
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
