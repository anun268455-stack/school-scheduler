import { create } from "zustand";
import type {
  Building, CellImpact, Department, LessonRequirement, Period,
  Room, SchoolConfig, SolverResult, StudentGroup, Subject,
  Teacher, TimetableSlot, ViewMode,
} from "../types";
import { DEFAULT_PERIODS } from "../types";
import { buildImpactMap } from "../utils/conflictAnalyzer";
import { buildSharesStudents } from "../utils/groupHierarchy";
import * as api from "../api/client";

// ── Live-sync internals ───────────────────────────────────────────────────────
/** How often to ask the server "did anything change?" (tiny request). */
const POLL_MS = 3500;
let pollTimer: number | null = null;

/**
 * Reload every collection without flipping `isLoading`, so another person's edit
 * refreshes the table in place instead of flashing a loading spinner.
 */
async function quietRefresh(
  set: (partial: Partial<TimetableStore>) => void,
  get: () => TimetableStore,
): Promise<void> {
  const cur = get();
  const [departments, buildings, rooms, groups, teachers, subjects, requirements, slots, periods] =
    await Promise.all([
      api.fetchDepartments().catch(() => cur.departments),
      api.fetchBuildings().catch(() => cur.buildings),
      api.fetchRooms().catch(() => cur.rooms),
      api.fetchGroups().catch(() => cur.groups),
      api.fetchTeachers().catch(() => cur.teachers),
      api.fetchSubjects().catch(() => cur.subjects),
      api.fetchRequirements().catch(() => cur.requirements),
      api.fetchSlots().catch(() => cur.slots),
      api.fetchPeriods().catch(() => cur.periods),
    ]);
  set({ departments, buildings, rooms, groups, teachers, subjects, requirements, slots, periods });
}

// One reversible change to a slot, used by the undo stack.
interface SlotPatch {
  slotId:  number;
  day?:    number;
  period?: number;
  room_id?: number | null;
}

interface TimetableStore {
  // ── Master data ────────────────────────────────────────────────────────────
  departments:  Department[];
  buildings:    Building[];
  rooms:        Room[];
  groups:       StudentGroup[];
  teachers:     Teacher[];
  subjects:     Subject[];
  requirements: LessonRequirement[];
  periods:      Period[];
  slots:        TimetableSlot[];

  // ── UI state ───────────────────────────────────────────────────────────────
  viewMode:          ViewMode;
  selectedGroupId:   number | null;
  selectedTeacherId: number | null;
  selectedRoomId:    number | null;
  isLoading:         boolean;
  isSolving:         boolean;
  solverError:       string | null;

  // ── School config ─────────────────────────────────────────────────────────
  schoolConfig: SchoolConfig;
  setSchoolConfig: (c: Partial<SchoolConfig>) => void;

  // ── Pre-lock mode ─────────────────────────────────────────────────────────
  preLockMode: boolean;         // when true, clicking a slot toggles is_locked

  // ── DnD impact analysis ───────────────────────────────────────────────────
  draggingSlot:  TimetableSlot | null;
  impactMap:     Map<string, CellImpact>;   // key = "day-period"
  tooltipText:   string | null;

  // ── Live collaboration (two people editing at once) ───────────────────────
  liveSync:      boolean;                   // polling on/off
  lastRevision:  number;                    // last server revision we rendered
  lastSyncedAt:  number | null;             // epoch ms of last successful poll
  syncState:     "connecting" | "live" | "offline";
  remoteUpdates: number;                    // how many times someone else's edit arrived
  setLiveSync:   (on: boolean) => void;
  startLiveSync: () => void;
  stopLiveSync:  () => void;
  addLesson: (d: {
    group_id: number; day: number; period: number;
    subject_id: number; teacher_id: number; room_id?: number | null;
  }) => Promise<void>;

  // ── Actions ───────────────────────────────────────────────────────────────
  setViewMode:          (m: ViewMode) => void;
  setSelectedGroupId:   (id: number | null) => void;
  setSelectedTeacherId: (id: number | null) => void;
  setSelectedRoomId:    (id: number | null) => void;
  setPreLockMode:       (on: boolean) => void;

  loadAll:   () => Promise<void>;
  loadSlots: () => Promise<void>;

  // DnD lifecycle
  startDrag: (slot: TimetableSlot) => void;
  endDrag:   () => void;

  moveSlot:    (slotId: number, newDay: number, newPeriod: number) => Promise<void>;
  swapRoom:    (slotId: number, newRoomId: number) => Promise<void>;
  applySwapRoute: (route: import("../utils/swapPlanner").SwapRoute) => Promise<void>;
  undoStack:   { label: string; patches: SlotPatch[] }[];
  undo:        () => Promise<void>;
  toggleLock:  (slotId: number) => Promise<void>;
  deleteSlot:  (slotId: number) => Promise<void>;
  lockAll:     () => Promise<void>;
  unlockAll:   () => Promise<void>;

  runSolver: (opts?: {
    timeLimitSeconds?: number;
    excludeRequirementIds?: number[];
    skipProblems?: boolean | "blocking";
  }) => Promise<SolverResult>;

  // Bulk operations
  bulkLockSlots: (params: {
    is_locked: boolean;
    filters: { group_level?: string; day?: number; period?: number; subject_id?: number };
  }) => Promise<{ affected: number }>;
}

export const useTimetableStore = create<TimetableStore>((set, get) => ({
  departments:       [],
  buildings:         [],
  rooms:             [],
  groups:            [],
  teachers:          [],
  subjects:          [],
  requirements:      [],
  periods:           DEFAULT_PERIODS,
  slots:             [],
  viewMode:          "group",
  selectedGroupId:   null,
  selectedTeacherId: null,
  selectedRoomId:    null,
  isLoading:         false,
  isSolving:         false,
  solverError:       null,
  preLockMode:       false,
  draggingSlot:      null,
  impactMap:         new Map(),
  undoStack:         [],
  tooltipText:       null,
  liveSync:          true,
  lastRevision:      -1,
  lastSyncedAt:      null,
  syncState:         "connecting",
  remoteUpdates:     0,

  schoolConfig: {
    schoolName: "โรงเรียน",
    term: "1",
    year: "2568",
    directorName: "",
  },
  setSchoolConfig: (c) => set((s) => ({ schoolConfig: { ...s.schoolConfig, ...c } })),

  setViewMode: (viewMode) => set({ viewMode, selectedGroupId: null, selectedTeacherId: null, selectedRoomId: null }),
  setSelectedGroupId:   (id) => set({ selectedGroupId: id,   selectedTeacherId: null, selectedRoomId: null }),
  setSelectedTeacherId: (id) => set({ selectedTeacherId: id, selectedGroupId: null,   selectedRoomId: null }),
  setSelectedRoomId:    (id) => set({ selectedRoomId: id,    selectedGroupId: null,   selectedTeacherId: null }),
  setPreLockMode:       (on) => set({ preLockMode: on }),

  loadAll: async () => {
    set({ isLoading: true });
    try {
      const [departments, buildings, rooms, groups, teachers, subjects, requirements, slots, periods] =
        await Promise.all([
          api.fetchDepartments().catch(() => get().departments),
          api.fetchBuildings().catch(() => get().buildings),
          api.fetchRooms().catch(() => get().rooms),
          api.fetchGroups().catch(() => get().groups),
          api.fetchTeachers().catch(() => get().teachers),
          api.fetchSubjects().catch(() => get().subjects),
          api.fetchRequirements().catch(() => get().requirements),
          api.fetchSlots().catch(() => get().slots),
          api.fetchPeriods().catch(() => get().periods.length ? get().periods : DEFAULT_PERIODS),
        ]);
      set({ departments, buildings, rooms, groups, teachers, subjects, requirements, slots, periods });
    } finally {
      set({ isLoading: false });
    }
  },

  loadSlots: async () => {
    const slots = await api.fetchSlots();
    set({ slots });
  },

  // ── Live collaboration ────────────────────────────────────────────────────
  setLiveSync: (on) => {
    set({ liveSync: on });
    if (on) get().startLiveSync();
    else get().stopLiveSync();
  },

  stopLiveSync: () => {
    if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  },

  startLiveSync: () => {
    get().stopLiveSync();
    const tick = async () => {
      const st = get();
      // Never yank data out from under an interaction in progress.
      if (!st.liveSync) return;
      if (st.draggingSlot || st.isSolving || st.isLoading) return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const { revision } = await api.fetchStateVersion();
        const prev = get().lastRevision;
        set({ syncState: "live", lastSyncedAt: Date.now() });
        if (revision === prev) return;
        if (prev === -1) { set({ lastRevision: revision }); return; }  // first poll: just record
        // Someone (possibly us) changed the data — pull a fresh copy quietly,
        // without flipping isLoading so the table doesn't flash a spinner.
        await quietRefresh(set, get);
        set({ lastRevision: revision, remoteUpdates: get().remoteUpdates + 1 });
      } catch {
        set({ syncState: "offline" });
      }
    };
    void tick();
    pollTimer = setInterval(tick, POLL_MS) as unknown as number;
  },

  // Add a single lesson to one cell (used by "click an empty cell to add").
  addLesson: async (d) => {
    const created = await api.createSlot(d);
    set((s) => ({ slots: [...s.slots, created] }));
  },

  // ── DnD ─────────────────────────────────────────────────────────────────
  startDrag: (slot) => {
    const { slots, periods, groups } = get();
    const shares = buildSharesStudents(groups);
    const map = buildImpactMap(slot, slots, periods, 5, shares);
    set({ draggingSlot: slot, impactMap: map });
  },

  endDrag: () => set({ draggingSlot: null, impactMap: new Map(), tooltipText: null }),

  moveSlot: async (slotId, newDay, newPeriod) => {
    const { slots } = get();
    const slot = slots.find((s) => s.id === slotId);
    if (!slot || slot.is_locked) return;

    // Optimistic update – also move parallel siblings
    const patchSlots = (prev: TimetableSlot[]) =>
      prev.map((s) => {
        if (s.id === slotId) return { ...s, day: newDay, period: newPeriod };
        if (
          slot.parallel_group_key &&
          s.parallel_group_key === slot.parallel_group_key &&
          s.day === slot.day &&
          s.period === slot.period
        ) {
          return { ...s, day: newDay, period: newPeriod };
        }
        return s;
      });

    set({ slots: patchSlots(slots) });
    // Record inverse for undo (move parallel siblings back too).
    const affected = slots.filter((s) =>
      s.id === slotId ||
      (slot.parallel_group_key && s.parallel_group_key === slot.parallel_group_key &&
       s.day === slot.day && s.period === slot.period));
    set((st) => ({ undoStack: [...st.undoStack, {
      label: "ย้ายคาบ",
      patches: affected.map((s) => ({ slotId: s.id, day: s.day, period: s.period })),
    }].slice(-25) }));
    try {
      await api.updateSlot(slotId, { day: newDay, period: newPeriod });
    } catch {
      set({ slots }); // revert
    }
  },

  swapRoom: async (slotId, newRoomId) => {
    const { slots, rooms } = get();
    const slot = slots.find((s) => s.id === slotId);
    const room = rooms.find((r) => r.id === newRoomId);
    if (!slot || !room) return;

    set({
      slots: slots.map((s) => (s.id === slotId
        ? { ...s, room_id: newRoomId, room_name: room.name, room_type: room.type }
        : s)),
    });
    set((st) => ({ undoStack: [...st.undoStack, {
      label: "เปลี่ยนห้อง",
      patches: [{ slotId, room_id: slot.room_id ?? null }],
    }].slice(-25) }));
    try {
      await api.updateSlot(slotId, { room_id: newRoomId });
    } catch {
      set({ slots }); // revert
    }
  },

  // Apply a full replacement route (chain of moves / room changes / deletes).
  // Each step is applied both optimistically (local state) and to the backend.
  applySwapRoute: async (route) => {
    const { rooms, slots } = get();
    const roomName = (id: number | null) => (id == null ? null : rooms.find((r) => r.id === id)?.name ?? null);
    const roomType = (id: number | null) => (id == null ? null : rooms.find((r) => r.id === id)?.type ?? null);

    // Record undo only for non-destructive routes (deletes can't be restored).
    const hasDelete = route.steps.some((s) => s.action === "delete");
    if (!hasDelete) {
      const patches: SlotPatch[] = [];
      for (const step of route.steps) {
        const cur = slots.find((s) => s.id === step.slotId);
        if (cur) patches.push({ slotId: cur.id, day: cur.day, period: cur.period, room_id: cur.room_id ?? null });
      }
      if (patches.length) set((st) => ({ undoStack: [...st.undoStack, { label: "แทนที่ตาราง", patches }].slice(-25) }));
    }

    // 1. Optimistic local update for the whole plan at once.
    set((state) => {
      let next = state.slots;
      for (const step of route.steps) {
        if (step.action === "delete") {
          next = next.filter((s) => s.id !== step.slotId);
        } else {
          next = next.map((s) =>
            s.id === step.slotId
              ? {
                  ...s,
                  day: step.toDay,
                  period: step.toPeriod,
                  room_id: step.toRoomId,
                  room_name: roomName(step.toRoomId),
                  room_type: roomType(step.toRoomId),
                }
              : s,
          );
        }
      }
      return { slots: next };
    });

    // 2. Persist to backend. On any failure, reload authoritative state.
    try {
      for (const step of route.steps) {
        if (step.action === "delete") {
          await api.deleteSlot(step.slotId);
        } else {
          await api.updateSlot(step.slotId, {
            day: step.toDay,
            period: step.toPeriod,
            room_id: step.toRoomId,
          });
        }
      }
    } catch {
      await get().loadSlots();
    }
  },

  // Pop the last undoable action and restore the affected slots.
  undo: async () => {
    const { undoStack, slots, rooms } = get();
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];

    // Apply the restore locally first.
    const byId = new Map(entry.patches.map((p) => [p.slotId, p]));
    set({
      slots: slots.map((s) => {
        const p = byId.get(s.id);
        if (!p) return s;
        const next = { ...s };
        if (p.day !== undefined) next.day = p.day;
        if (p.period !== undefined) next.period = p.period;
        if (p.room_id !== undefined) {
          next.room_id = p.room_id;
          const r = rooms.find((x) => x.id === p.room_id);
          next.room_name = r?.name ?? null;
          next.room_type = r?.type ?? null;
        }
        return next;
      }),
      undoStack: undoStack.slice(0, -1),
    });

    // Persist each restore to the backend.
    try {
      for (const p of entry.patches) {
        const body: Record<string, unknown> = {};
        if (p.day !== undefined) body.day = p.day;
        if (p.period !== undefined) body.period = p.period;
        if (p.room_id !== undefined) body.room_id = p.room_id;
        await api.updateSlot(p.slotId, body);
      }
    } catch {
      await get().loadSlots();
    }
  },

  toggleLock: async (slotId) => {
    const { slots } = get();
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;
    const updated = await api.updateSlot(slotId, { is_locked: !slot.is_locked });
    set({ slots: slots.map((s) => (s.id === slotId ? { ...s, ...updated } : s)) });
  },

  deleteSlot: async (slotId) => {
    await api.deleteSlot(slotId);
    set({ slots: get().slots.filter((s) => s.id !== slotId) });
  },

  lockAll: async () => {
    const { slots } = get();
    await Promise.all(slots.filter((s) => !s.is_locked).map((s) => api.updateSlot(s.id, { is_locked: true })));
    set({ slots: slots.map((s) => ({ ...s, is_locked: true })) });
  },

  unlockAll: async () => {
    const { slots } = get();
    await Promise.all(slots.filter((s) => s.is_locked).map((s) => api.updateSlot(s.id, { is_locked: false })));
    set({ slots: slots.map((s) => ({ ...s, is_locked: false })) });
  },

  bulkLockSlots: async (params) => {
    const result = await api.bulkLockSlots(params);
    // Re-fetch slots to reflect changes
    const slots = await api.fetchSlots();
    set({ slots });
    return result;
  },

  runSolver: async (opts) => {
    set({ isSolving: true, solverError: null });
    try {
      const lockedIds = get().slots.filter((s) => s.is_locked).map((s) => s.id);
      const result = await api.runSolver({
        clear_existing: true,
        time_limit_seconds: opts?.timeLimitSeconds,
        locked_slot_ids: lockedIds,
        exclude_requirement_ids: opts?.excludeRequirementIds,
        skip_problems: opts?.skipProblems,
      });
      await get().loadSlots();
      return result;
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      // No `detail` means the backend never answered — it timed out or ran out
      // of memory and was killed. "Solver error" alone leaves the person with
      // nothing to act on, so say what actually happens and what to do.
      const msg = typeof raw === "string"
        ? raw
        : "เซิร์ฟเวอร์ไม่ตอบกลับ (อาจใช้เวลานานเกินไปหรือหน่วยความจำไม่พอ) — "
          + "ลองติ๊ก \"ข้ามวิชาที่มีปัญหา\" แล้วกดใหม่อีกครั้ง";
      set({ solverError: msg });
      throw err;
    } finally {
      set({ isSolving: false });
    }
  },
}));
