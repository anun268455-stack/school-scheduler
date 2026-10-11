/**
 * จุดบันทึก (save points) — the school's own copies of their data, kept in
 * this browser.
 *
 * The server this runs on has no permanent disk. It sleeps when nobody is
 * using it, and the copy it writes next to its own code goes when it wakes up
 * again, so the site comes back holding the data it was first shipped with.
 * Nothing stored on the server can be trusted to outlive the night, which is
 * why these live in the browser instead: a save point written here is still
 * here next week whatever the server has done in between.
 *
 * IndexedDB rather than localStorage because a full snapshot of this school is
 * about 1.2 MB — a handful of them would be over the ~5 MB localStorage gives
 * an origin, and localStorage throws when it fills rather than telling you
 * beforehand. IndexedDB also stores the object as it is, with no JSON string
 * twice the size of the data sitting in memory while it saves.
 *
 * Two kinds of save point:
 *   main — the one the school pins deliberately. Only ever one; saving again
 *          replaces it. This is the "known good" they asked to come back to.
 *   auto — written as they work, newest few kept. These are the safety net for
 *          the times nobody thought to press the button.
 *
 * A save point lives in ONE browser on ONE computer. It is not a substitute
 * for the downloaded backup file, which is the copy that survives a lost
 * laptop; the UI says so rather than letting anyone assume otherwise.
 */

const DB_NAME = "school-scheduler";
const DB_VERSION = 1;
const STORE = "save_points";

/**
 * How many automatic save points to keep.
 *
 * A copy goes in after every change now, so these are spread over time by
 * trimAuto rather than being the last twelve edits — twelve of those would be
 * two minutes of history.
 */
export const AUTO_KEEP = 12;

export type SaveKind = "main" | "auto";

export interface SavePointMeta {
  id: string;
  kind: SaveKind;
  /** Epoch ms — when this copy was taken. */
  saved_at: number;
  /** What the person typed, for a main save. */
  label?: string;
  /** Enough to show "ครู 143 · คาบ 2209" without loading the whole snapshot. */
  counts: Record<string, number>;
  /** Roughly how big the snapshot was, for the UI. */
  bytes: number;
}

export interface SavePoint extends SavePointMeta {
  data: Record<string, unknown>;
}

/** Counted for the list; a missing section counts as none rather than absent. */
const COUNTED = [
  "groups", "teachers", "subjects", "rooms",
  "requirements", "slots", "elective_pools",
] as const;

function countsOf(snapshot: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of COUNTED) {
    const v = snapshot[k];
    out[k] = Array.isArray(v) ? v.length : 0;
  }
  return out;
}

/** A rough size without serialising the whole thing twice. */
function roughBytes(snapshot: Record<string, unknown>): number {
  try {
    return new Blob([JSON.stringify(snapshot)]).size;
  } catch {
    return 0;
  }
}

/**
 * Is there any usable storage here at all?
 *
 * Private windows and locked-down browsers expose indexedDB and then fail on
 * open, so every call below is written to reject rather than throw loose, and
 * the UI reports that saving is unavailable instead of pretending it worked.
 */
export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!storageAvailable()) {
      reject(new Error("เบราว์เซอร์นี้ไม่รองรับการบันทึกในเครื่อง"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
        store.createIndex("saved_at", "saved_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("เปิดที่เก็บข้อมูลไม่ได้"));
    req.onblocked = () => reject(new Error("มีแท็บอื่นเปิดค้างอยู่ ลองปิดแท็บอื่นแล้วลองใหม่"));
  });
}

function tx<T>(mode: IDBTransactionMode,
               run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("บันทึกไม่สำเร็จ"));
    t.oncomplete = () => db.close();
    t.onabort = () => { db.close(); reject(t.error ?? new Error("บันทึกไม่สำเร็จ")); };
  }));
}

/** The id of the pinned save — fixed, so saving again replaces it. */
const MAIN_ID = "main";

/**
 * Write a save point.
 *
 * A main save always lands on the same key, so there is exactly one and the
 * school never has to pick between six things all called "เซฟหลัก". Auto saves
 * get their own key and the oldest beyond AUTO_KEEP are dropped afterwards.
 */
export async function putSavePoint(
  kind: SaveKind,
  snapshot: Record<string, unknown>,
  label?: string,
): Promise<SavePointMeta> {
  const meta: SavePointMeta = {
    id: kind === "main" ? MAIN_ID : `auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    saved_at: Date.now(),
    label,
    counts: countsOf(snapshot),
    bytes: roughBytes(snapshot),
  };
  await tx("readwrite", (s) => s.put({ ...meta, data: snapshot } as SavePoint));
  if (kind === "auto") await trimAuto();
  return meta;
}

/** Everything stored, newest first, without the snapshots themselves. */
export async function listSavePoints(): Promise<SavePointMeta[]> {
  const rows = await tx<SavePoint[]>("readonly", (s) => s.getAll() as IDBRequest<SavePoint[]>);
  return rows
    .map(({ data: _data, ...meta }) => meta)
    .sort((a, b) => b.saved_at - a.saved_at);
}

export async function getSavePoint(id: string): Promise<SavePoint | undefined> {
  return tx<SavePoint | undefined>("readonly",
    (s) => s.get(id) as IDBRequest<SavePoint | undefined>);
}

export async function getMainSave(): Promise<SavePoint | undefined> {
  return getSavePoint(MAIN_ID);
}

export async function deleteSavePoint(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}

/**
 * Keep AUTO_KEEP automatic saves, spread over time rather than bunched.
 *
 * A copy is now written after every change, which is what the school asked
 * for — but dropping the oldest each time would leave a window a few minutes
 * wide. An afternoon's work would be covered by twelve copies of the last two
 * minutes, and the mistake somebody wants to undo is usually older than that.
 *
 * So the copy that goes is the one nobody would miss: the one sitting closest
 * in time to its two neighbours, because the copies on either side of it say
 * almost the same thing. Repeated on every save, that spreads the window out
 * evenly over however long the school has been working — twelve copies across
 * an afternoon rather than twelve copies of the last two minutes — without
 * anyone having to choose an interval.
 *
 * Two are never dropped: the newest, which is the one just written and is
 * always current, and the oldest, which is what makes the window reach back.
 */
export function pickToDrop<T extends { saved_at: number }>(
  newestFirst: T[], keep: number,
): T[] {
  let left = [...newestFirst];
  const dropped: T[] = [];
  while (left.length > keep) {
    let worst = -1, smallest = Infinity;
    // Skip the newest (0) and judge each of the rest by the span it covers.
    for (let i = 1; i < left.length; i++) {
      const newer = left[i - 1].saved_at;
      const older = i + 1 < left.length ? left[i + 1].saved_at : null;
      // The oldest one covers all the history before it, so it is never the
      // cheapest to lose — that is what keeps the window reaching back.
      const span = older === null ? Infinity : newer - older;
      if (span < smallest) { smallest = span; worst = i; }
    }
    if (worst < 0) break;
    dropped.push(left[worst]);
    left = left.filter((_, i) => i !== worst);
  }
  return dropped;
}

async function trimAuto(): Promise<void> {
  const all = await listSavePoints();
  const autos = all.filter((p) => p.kind === "auto");   // already newest-first
  for (const gone of pickToDrop(autos, AUTO_KEEP)) {
    await deleteSavePoint(gone.id).catch(() => undefined);
  }
}

/** "9 ต.ค. 2569 23:20" — what the school reads on the card. */
export function formatSavedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString("th-TH", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

export function formatBytes(n: number): string {
  if (!n) return "–";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB`
                          : `${Math.max(1, Math.round(n / 1024))} KB`;
}
