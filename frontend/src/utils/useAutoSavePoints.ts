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
      // Never photograph a server that has just thrown its data away: that
      // snapshot is the shipped demo data, and saving it would push the real
      // copies out of the rolling window — destroying the safety net at
      // exactly the moment it is needed.
      if (st.serverReset) { settle("idle"); return; }
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

        // Nor is one whose timetable has collapsed. The window holds six
        // copies: if the school loses their คาบ and then keeps working, six
        // ticks is twenty-four minutes before the last copy holding the real
        // timetable is pushed out — and that copy is the only way back. So a
        // sharp drop stops the rolling window instead of feeding it, and the
        // on-screen warning takes over.
        const slots = Array.isArray(snap["slots"]) ? (snap["slots"] as unknown[]).length : 0;
        const kept = await listSavePoints();
        const most = kept.reduce((n, p) => Math.max(n, p.counts.slots ?? 0), 0);
        if (most > 20 && slots < most * 0.5) {
          useTimetableStore.setState({ serverReset: true, savePointState: "idle" });
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
      if (st.serverReset) return;
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
/**
 * Is the server holding the school's data, or has it lost it?
 *
 *   "healthy"  the server has their own data, and at least as much of it as
 *              the best copy kept here. Nothing to warn about — and if the
 *              warning is up, this is what takes it down.
 *   "lost"     our copy is genuinely the fuller one. Raise it.
 *   "unknown"  neither can be shown. A school still setting up has seed data
 *              on the server and little saved here, and being told their data
 *              is missing every morning would be noise.
 */
export type ServerVerdict = "healthy" | "lost" | "unknown";

export function serverHealthVerdict(
  server: { source: string; slots: number; teachers: number },
  mine: { slots: number; teachers: number } | null,
): ServerVerdict {
  const have = mine ?? { slots: 0, teachers: 0 };
  if (server.source === "snapshot"
      && server.slots >= have.slots && server.teachers >= have.teachers) {
    return "healthy";
  }
  if (!mine) return "unknown";
  return (have.slots > server.slots || have.teachers > server.teachers) ? "lost" : "unknown";
}

export function useServerDataCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !storageAvailable()) return;
    let stop = false;

    /**
     * Compare what the server holds against the best copy kept here, and set
     * or clear the warning accordingly.
     *
     * Both directions matter. Raising it was the easy half; the warning used
     * to be a latch, so once the server had a bad morning the red strip stayed
     * across the top for the rest of the day — after the data was recovered,
     * after the database was storing it again — and with it live sync and the
     * automatic copies stayed switched off. A warning that will not go away
     * when the problem does is one people learn to look past, which is worse
     * than not showing it.
     */
    const check = async () => {
      try {
        const info = await api.fetchStateInfo();
        if (stop) return;
        const all = await listSavePoints().catch(() => []);
        if (stop) return;
        const best = all.find((p) => p.kind === "main") ?? all[0];
        const verdict = serverHealthVerdict(
          { source: info.source, slots: info.counts.slots ?? 0,
            teachers: info.counts.teachers ?? 0 },
          best ? { slots: best.counts.slots ?? 0, teachers: best.counts.teachers ?? 0 } : null,
        );
        if (verdict === "healthy") {
          if (useTimetableStore.getState().serverReset) {
            // Forget the old revision too, or the next poll reads the gap as
            // another reset and the strip comes straight back.
            useTimetableStore.setState({ serverReset: false, lastRevision: -1 });
          }
        } else if (verdict === "lost") {
          useTimetableStore.setState({ serverReset: true });
        }
      } catch {
        /* offline; the polling tick reports that separately */
      }
    };

    void check();
    const id = setInterval(check, 45_000) as unknown as number;
    return () => { stop = true; clearInterval(id); };
  }, [enabled]);
}
