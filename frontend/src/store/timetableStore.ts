import { create } from "zustand";
import type {
  Building, CellImpact, Department, LessonRequirement, Period,
  Room, SchoolConfig, SolverResult, StudentGroup, Subject,
  Teacher, TimetableSlot, ViewMode,
} from "../types";
import { DEFAULT_PERIODS } from "../types";
import { buildImpactMap } from "../utils/conflictAnalyzer";
import { buildSharesStudents, flattenGroups } from "../utils/groupHierarchy";
import { levelKeyOf } from "../utils/levels";
import { lockClashAt } from "../utils/lockGuard";
import * as api from "../api/client";
import { writeGuard } from "../utils/writeGuard";
import { putSavePoint, storageAvailable } from "../utils/savePoints";
import { applyPickResult } from "../utils/yardPicks";
import { clampCellScale } from "../utils/cellScale";
import {
  chooseOption, previewSlots, verdictAt, type GuidedStep,
} from "../utils/guidedMove";

// ── Live-sync internals ───────────────────────────────────────────────────────
/** How often to ask the server "did anything change?" (tiny request). */
const POLL_MS = 3500;
let pollTimer: number | null = null;

/**
 * Reload every collection without flipping `isLoading`, so another person's edit
 * refreshes the table in place instead of flashing a loading spinner.
 */
/**
 * Would taking this refresh throw away a timetable that is on screen?
 *
 * One guard, and only one. The server keeps its data in a database now and
 * refuses to write the shipped data over the school's, so a poll returning an
 * empty school is the last unlikely path left — and the cost of being wrong
 * about it is the whole timetable, while the cost of skipping one refresh is
 * nothing. Both numbers have to fall: deleting half the คาบ on purpose is
 * something a school does, losing half the คาบ AND staff at once is not.
 *
 * It replaces a whole warning system that guessed at the same thing from a
 * counter, latched, and switched off live sync and the automatic copies until
 * somebody noticed. The amber strip at the top says what is wrong with the
 * server, from what the server itself reports; this just declines to spread it.
 */
export function wouldWipeTheScreen(
  cur: { slots: number; teachers: number },
  next: { slots: number; teachers: number },
): boolean {
  if (cur.slots <= 20) return false;          // nothing much to lose yet
  return next.slots < cur.slots * 0.5 && next.teachers < cur.teachers;
}

async function quietRefresh(
  set: (partial: Partial<TimetableStore>) => void,
  get: () => TimetableStore,
): Promise<void> {
  const cur = get();
  // What the world looked like when this question was asked.
  const askedAt = writeGuard.token();
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
  // An edit started or finished while this was in the air, so this copy of the
  // timetable predates it. Dropping it loses nothing — the next poll asks again
  // — while applying it would undo what the person just did.
  if (writeGuard.stale(askedAt)) return;
  if (wouldWipeTheScreen(
        { slots: cur.slots.length, teachers: cur.teachers.length },
        { slots: slots.length, teachers: teachers.length })) {
    return;
  }
  set({ departments, buildings, rooms, groups, teachers, subjects, requirements, slots, periods });
  // Other people's ลาน marks arrive with the rest of their edits.
  void get().loadYardPicks();
}

/**
 * Which ลาน load is the latest. A load that began before a save, or before a
 * newer load, is answering a question that has already moved on: letting it land
 * would put a mark back that was just removed.
 */
let yardLoadSeq = 0;

/**
 * กันการดึงข้อมูลมาทับสิ่งที่เพิ่งแก้ — เหตุผลทั้งหมดอยู่ใน utils/writeGuard.ts
 *
 * กับดักเดียวกันนี้เคยถูกเข้าใจแล้วที่ของข้างๆ: yardLoadSeq มีอยู่เพราะการโหลด
 * ลาน "ตอบคำถามที่เลยไปแล้ว" ตัวนี้คือความคิดเดียวกัน แต่ใช้กับสิ่งที่โรงเรียน
 * แก้อยู่ทั้งวัน
 */
const withWrite = <T,>(fn: () => Promise<T>): Promise<T> => writeGuard.run(fn);

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
  /** ตัวจัดตารางถึงไหนแล้ว — null เมื่อไม่ได้จัด หรือเซิร์ฟเวอร์ตอบเรื่องนี้ไม่ได้ */
  solveProgress:     api.SolveProgress | null;
  solverError:       string | null;

  // ── School config ─────────────────────────────────────────────────────────
  schoolConfig: SchoolConfig;
  setSchoolConfig: (c: Partial<SchoolConfig>) => void;
  /**
   * ขนาดตัวอักษรในช่องตาราง — เห็นผลทันทีบนจอ ส่งขึ้นเซิร์ฟเวอร์แบบหน่วง
   *
   * แถบเลื่อนยิง onChange ทุกขั้นที่ลาก ถ้าเขียนขึ้นเซิร์ฟเวอร์ทุกขั้นก็จะยิง
   * คำขอหลายสิบครั้งต่อการลากครั้งเดียว
   */
  setCellFontScale: (scale: number) => void;

  /**
   * ล็อก/ปลดล็อกทั้งห้อง — "ห้องนี้จัดเสร็จแล้ว"
   *
   * คนละอย่างกับ toggleLock ซึ่งล็อกทีละคาบ อันนี้ปิดทั้งห้องไว้ไม่ให้รอบ
   * สร้างตารางถัดไปมารื้อ และปุ่มล้างตารางก็ไม่ลบให้ด้วย
   */
  toggleClassLock: (groupId: number) => Promise<void>;

  // ── โหมดจัดเอง ────────────────────────────────────────────────────────────
  //
  //   "ช่วยมีโหมดในการสลับคาบโดยใช้มือเลย โดยจะมีแจ้งเตือนเฉย ๆ แต่จะไม่บังคับ
  //    ใด ๆ ... ถ้าชนกันก็จะขึ้นสีแดงให้ไปเลื่อนคาบที่ชนแทน"
  //
  // ปกติเซิร์ฟเวอร์ปฏิเสธการย้ายที่ทำให้ชนกัน หน้าจอจึงคืนคาบกลับที่เดิม ซึ่ง
  // คือ "เลื่อนแล้วเด้งกลับ" ที่โรงเรียนเจอ เปิดโหมดนี้แล้วคาบลงไปได้เลย แล้ว
  // ไปขึ้นกรอบแดงแทน เหลือข้อห้ามเดียวคือทับคาบที่ล็อกไว้ไม่ได้
  manualMode: boolean;

  // ── Pre-lock mode ─────────────────────────────────────────────────────────
  /**
   * โหมดนำทางการจัดคาบ — เลือกเองทีละขั้นว่าคาบนี้ไปไหน แล้วใครไปไหนต่อ
   *
   *   "ฉันย้ายคาบครูคนนี้แต่ก็จะติดไปเรื่อยๆ ... เข้าโหมดนี้แล้วเลือกคาบนี้จะไป
   *    ยังคาบนี้พอ แล้วก็จะมีทางเลือกในการเลื่อนหลายๆแยกให้ฉันเลือก"
   *
   * ยังไม่แตะตารางจริงจนกดลงมือ — ทั้งเส้นทางถูกส่งไปทีเดียว
   */
  guideMode:     boolean;
  /** คาบที่กำลังหาที่ให้ในขั้นนี้ */
  guideMovingId: number | null;
  /** ขั้นที่เลือกไว้แล้ว ยังไม่ลงมือ */
  guideSteps:    GuidedStep[];
  preLockMode: boolean;         // when true, clicking a slot toggles is_locked

  // ── โหมดเลือกคาบเรียนลาน ────────────────────────────────────────────────────
  // When on, clicking a cell of a class's timetable picks the ลาน for that hour.
  // Shares the click with pre-lock mode, so turning one on turns the other off.
  yardPickMode:   boolean;
  /** Every mark in the school: which class, which hour, which ลาน. */
  yardPicks:      api.YardPickRow[];
  /** The ลาน, in the order the school saved. */
  yardList:       api.Yard[];
  /** Why the marks could not be loaded, in Thai — null when they could. */
  yardPicksError: string | null;

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
  /**
   * The copy in this browser: when it was last written, and what is happening
   * to it now. Shown in the toolbar, because "I don't know whether what I'm
   * doing is saved" is answered by seeing it, not by being told it happens.
   */
  lastSavePointAt: number | null;
  savePointState:  "idle" | "saving" | "saved" | "failed";
  /**
   * When the SERVER last stored the data, as its own polling endpoint reports
   * it. The browser's copy is a safety net; this is the real answer to "is my
   * work saved", and it is the one shown in the toolbar.
   */
  serverSavedAt:  number | null;
  serverSaving:   boolean;
  serverStoreError: string | null;
  setLiveSync:   (on: boolean) => void;
  startLiveSync: () => void;
  stopLiveSync:  () => void;
  addLesson: (d: {
    group_id: number; day: number; period: number;
    subject_id: number; teacher_id: number; room_id?: number | null;
    /** คาบคู่ — the server creates the following period too, same room. */
    is_double?: boolean;
  }) => Promise<void>;

  // ── Actions ───────────────────────────────────────────────────────────────
  setViewMode:          (m: ViewMode) => void;
  setSelectedGroupId:   (id: number | null) => void;
  setSelectedTeacherId: (id: number | null) => void;
  setSelectedRoomId:    (id: number | null) => void;
  setGuideMode:   (on: boolean) => void;
  /** เริ่มหาที่ให้คาบนี้ (กดคาบในตารางตอนอยู่ในโหมดนำทาง) */
  guidePick:      (slotId: number) => void;
  /** เลือกช่องนี้ให้คาบที่กำลังหาที่อยู่ */
  guideChoose:    (day: number, period: number) => void;
  /** ย้อนขั้นล่าสุด */
  guideBack:      () => void;
  guideClear:     () => void;
  /** ลงมือทำทั้งเส้นทางทีเดียว */
  guideApply:     () => Promise<void>;
  /**
   * ลงมือย้ายทั้งเส้นทางที่หน้าต่าง "เอาคาบมาลงห้องนี้" ตกลงไว้
   *
   * คืนเหตุผลเป็นข้อความถ้าไม่สำเร็จ (null = สำเร็จ) เพราะหน้าต่างนั้นต้องโชว์
   * เหตุไว้ในตัวเอง ไม่ใช่ปิดตัวเองแล้วให้ไปหาข้อความที่อื่น
   */
  fillApply:      (steps: GuidedStep[]) => Promise<string | null>;
  /**
   * เปลี่ยนห้องให้หลายคาบในครั้งเดียว ไม่ขยับวันหรือคาบ
   *
   * ใช้โดยปุ่มวิเคราะห์ห้อง คืนเหตุผลเป็นข้อความถ้าไม่สำเร็จ (null = สำเร็จ)
   */
  setManyRooms:   (picks: { slotId: number; roomId: number }[],
                   label: string) => Promise<string | null>;
  setPreLockMode:       (on: boolean) => void;
  setManualMode:        (on: boolean) => void;
  setYardPickMode:      (on: boolean) => void;

  loadAll:   () => Promise<void>;
  loadSlots: () => Promise<void>;
  /** Never throws: a server that cannot answer leaves yardPicksError set. */
  loadYardPicks: () => Promise<void>;
  /** Saves at once. `room_id: null` removes the mark. Throws on a refusal, for the caller to show. */
  /**
   * เอาหมุดลานออกจากชั่วโมงที่ระบุ (ทีละหลายชั่วโมงได้ สำหรับคาบคู่)
   *
   *   "ช่วยมีปุ่มปักหมุดออกให้หน่อย เพราะย้ายห้องแล้วกลับไปที่เดิม"
   *
   * หมุดแรงกว่าการย้ายห้องด้วยมือ — เซิร์ฟเวอร์ดึงคาบกลับมาที่ลานที่ปักไว้ทุก
   * ครั้ง เอาหมุดออกแล้วจึงย้ายห้องได้
   */
  removeYardPicks: (groupId: number, day: number, periods: number[]) => Promise<void>;

  saveYardPick: (p: {
    group_id: number; day: number; period: number; room_id: number | null;
  }) => Promise<void>;

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
    /** ปุ่ม "จัดให้เสร็จ" — ปิดคาบว่างกลางวันให้หมด ยอมให้ยังไม่มีห้องได้ */
    closeGapsHard?: boolean;
    excludeRequirementIds?: number[];
    skipProblems?: boolean | "blocking";
    maxConsecutive?: number;
    preferConsecutive?: number;
    minLastPeriod?: number;
    /** เพดานคาบสุดท้าย/สัปดาห์ต่อครู — 0 = ไม่จำกัด */
    maxLastPeriod?: number;
    lastPeriodMode?: "reserve" | "never" | "free";
    /**
     * แก้เฉพาะห้องที่เลือก — re-place these classes only. Omit for the full
     * rebuild. An EMPTY list is refused here rather than sent: the server
     * reads it as "no repair" and would rebuild the whole school.
     */
    repairGroupIds?: number[];
  }) => Promise<SolverResult>;

  // Bulk operations
  bulkLockSlots: (params: {
    is_locked: boolean;
    filters: { group_level?: string; day?: number; period?: number; subject_id?: number };
  }) => Promise<{ affected: number }>;
}

/** The backend's reason for refusing a move, or a usable fallback. */
function moveRefusal(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? `ย้ายไม่ได้: ${detail}` : "ย้ายไม่ได้ — ช่องนั้นไม่ว่าง";
}

/** ตัวหน่วงการบันทึกขนาดตัวอักษร — ระดับโมดูลเหมือน pollTimer */
let scaleSaveTimer: ReturnType<typeof setTimeout> | null = null;

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
  solveProgress:     null,
  solverError:       null,
  guideMode:         false,
  guideMovingId:     null,
  guideSteps:        [],
  preLockMode:       false,
  manualMode:        false,
  yardPickMode:      false,
  yardPicks:         [],
  yardList:          [],
  yardPicksError:    null,
  draggingSlot:      null,
  impactMap:         new Map(),
  undoStack:         [],
  tooltipText:       null,
  liveSync:          true,
  lastRevision:      -1,
  lastSyncedAt:      null,
  syncState:         "connecting",
  remoteUpdates:     0,
  lastSavePointAt:   null,
  savePointState:    "idle",
  serverSavedAt:     null,
  serverSaving:      false,
  serverStoreError:  null,

  schoolConfig: {
    schoolName: "โรงเรียน",
    term: "1",
    year: "2568",
    directorName: "",
  },
  // Kept on the server so both editors see the same settings and a refresh
  // does not lose them. Applied locally first so typing stays responsive.
  toggleClassLock: async (groupId) => {
    const { groups } = get();
    const flat = flattenGroups(groups);
    const g = flat.find((x) => x.id === groupId);
    if (!g) return;
    const want = !g.schedule_locked;
    // แสดงผลทันที แล้วค่อยบันทึก — การปิดห้องที่จัดเสร็จแล้วเป็นงานที่ทำรัว ๆ
    // ทีละห้อง การรอเซิร์ฟเวอร์ทุกครั้งทำให้รู้สึกหน่วงโดยไม่จำเป็น
    const stamp = (list: StudentGroup[]): StudentGroup[] =>
      list.map((x) => (x.id === groupId
        ? { ...x, schedule_locked: want }
        : { ...x, children: x.children ? stamp(x.children) : x.children }));
    set({ groups: stamp(groups) });
    try {
      await withWrite(() => api.updateGroup(groupId, { schedule_locked: want }));
    } catch {
      set({ groups, solverError: "บันทึกการล็อกห้องไม่สำเร็จ — ลองใหม่อีกครั้ง" });
    }
  },

  setSchoolConfig: (c) => {
    set((s) => ({ schoolConfig: { ...s.schoolConfig, ...c } }));
    api.updateSchoolConfig(c).catch(() => { /* kept locally either way */ });
  },

  setCellFontScale: (scale) => {
    const v = clampCellScale(scale);
    set((s) => ({ schoolConfig: { ...s.schoolConfig, cell_font_scale: v } }));
    if (scaleSaveTimer !== null) clearTimeout(scaleSaveTimer);
    scaleSaveTimer = setTimeout(() => {
      scaleSaveTimer = null;
      api.updateSchoolConfig({ cell_font_scale: v }).catch(() => { /* อยู่ในจอนี้ก็ยังใช้ได้ */ });
    }, 600);
  },

  setViewMode: (viewMode) => set({ viewMode, selectedGroupId: null, selectedTeacherId: null, selectedRoomId: null }),
  setSelectedGroupId:   (id) => set({ selectedGroupId: id,   selectedTeacherId: null, selectedRoomId: null }),
  setSelectedTeacherId: (id) => set({ selectedTeacherId: id, selectedGroupId: null,   selectedRoomId: null }),
  setSelectedRoomId:    (id) => set({ selectedRoomId: id,    selectedGroupId: null,   selectedTeacherId: null }),
  // Both modes take over the click on a cell, so only one can be on at a time.
  setPreLockMode:       (on) => set(on
    ? { preLockMode: true, yardPickMode: false,
        guideMode: false, guideMovingId: null, guideSteps: [] }
    : { preLockMode: false }),

  // ── โหมดนำทางการจัดคาบ ──────────────────────────────────────────────────
  setGuideMode: (on) => set(on
    ? { guideMode: true, preLockMode: false, yardPickMode: false,
        guideMovingId: null, guideSteps: [] }
    : { guideMode: false, guideMovingId: null, guideSteps: [] }),

  guidePick: (slotId) => {
    const { slots, guideSteps } = get();
    const s = slots.find((x) => x.id === slotId);
    if (!s) return;
    if (s.is_locked) {
      set({ solverError: "คาบนี้ล็อกไว้ — ปลดล็อกก่อนถึงจะย้ายได้" });
      return;
    }
    // กดคาบใหม่ขณะที่ยังมีเส้นทางค้างอยู่ = เริ่มเส้นทางใหม่ ของเดิมยังไม่ลงมือ
    // จึงหายไปได้โดยไม่กระทบตาราง แต่บอกให้รู้ว่าเกิดอะไรขึ้น
    set({
      guideMovingId: slotId,
      guideSteps: [],
      solverError: guideSteps.length
        ? "เริ่มเส้นทางใหม่ — เส้นทางที่เลือกไว้ก่อนหน้านี้ถูกยกเลิก (ยังไม่ได้ลงมือ)"
        : null,
    });
  },

  guideChoose: (day, period) => {
    const { slots, rooms, teachers, periods, groups, subjects,
            guideMovingId, guideSteps } = get();
    if (guideMovingId == null) return;
    const world = { slots, rooms, teachers, periods, groups, subjects };
    const live = previewSlots(slots, guideSteps, rooms)
      .find((x) => x.id === guideMovingId);
    if (!live) return;
    const v = verdictAt(world, live, guideSteps, day, period);
    if (!v) {
      set({ solverError: "ช่องนี้ลงไม่ได้ — มีคาบที่ล็อกไว้ขวางอยู่ หรือไม่ใช่คาบเรียนของชั้นนี้" });
      return;
    }
    const r = chooseOption(world, live, guideSteps, v);
    set({ guideSteps: r.steps, guideMovingId: r.next ? r.next.id : null,
          solverError: null });
  },

  guideBack: () => {
    const { guideSteps } = get();
    if (!guideSteps.length) return;
    const last = guideSteps[guideSteps.length - 1];
    set({ guideSteps: guideSteps.slice(0, -1), guideMovingId: last.slotId,
          solverError: null });
  },

  guideClear: () => set({ guideSteps: [], guideMovingId: null, solverError: null }),

  guideApply: async () => {
    const { guideSteps, slots, groups } = get();
    if (!guideSteps.length) return;
    // ด่านคาบล็อก — เส้นทางนี้ส่งแบบข้ามการตรวจของเซิร์ฟเวอร์เหมือนทางอื่น
    const shares = buildSharesStudents(groups);
    const moving = new Set(guideSteps.map((s) => s.slotId));
    for (const st of guideSteps) {
      const s = slots.find((x) => x.id === st.slotId);
      if (!s) continue;
      const clash = lockClashAt(s, st.day, st.period, st.roomId,
                                slots.filter((x) => !moving.has(x.id)), shares);
      if (clash) {
        set({ solverError: `เส้นทางนี้ใช้ไม่ได้ — ${clash.reason} 🔒 ปลดล็อกคาบนั้นก่อน` });
        return;
      }
    }
    set((st) => ({ undoStack: [...st.undoStack, {
      label: "นำทางจัดคาบ",
      patches: guideSteps.map((g) => {
        const cur = slots.find((x) => x.id === g.slotId);
        return { slotId: g.slotId, day: cur?.day, period: cur?.period,
                 room_id: cur?.room_id ?? null };
      }),
    }].slice(-25) }));
    let refused: string | null = null;
    try {
      await withWrite(() => api.moveSlots(guideSteps.map((g) => ({
        slot_id: g.slotId, day: g.day, period: g.period, room_id: g.roomId,
      })), true));
    } catch (err: unknown) {
      // อย่าให้ตารางเด้งกลับเฉยๆ โดยไม่บอกเหตุ — เส้นทางนี้ส่งแบบข้ามการตรวจ
      // เรื่องชนกันแล้ว ที่ยังถูกปฏิเสธได้คือทับคาบที่ล็อกไว้ หรือเซิร์ฟเวอร์
      // ไม่ตอบ จึงเก็บเส้นทางไว้ให้แก้ต่อ ไม่ล้างทิ้ง
      refused = moveRefusal(err);
    }
    await get().loadSlots();
    if (refused) set({ solverError: refused });
    else set({ guideSteps: [], guideMovingId: null });
  },

  setManyRooms: async (picks, label) => {
    if (!picks.length) return null;
    const { slots } = get();
    set((st) => ({ undoStack: [...st.undoStack, {
      label,
      patches: picks.map((p) => ({
        slotId: p.slotId,
        room_id: slots.find((x) => x.id === p.slotId)?.room_id ?? null,
      })),
    }].slice(-25) }));
    let refused: string | null = null;
    try {
      // เปลี่ยนแค่ห้อง ไม่ส่ง day/period — เซิร์ฟเวอร์พาอีกครึ่งของคาบคู่ไป
      // ห้องเดียวกันให้เอง จึงส่งแค่แถวแรกของแต่ละคาบคู่
      await withWrite(() => api.moveSlots(
        picks.map((p) => ({ slot_id: p.slotId, room_id: p.roomId })), true));
    } catch (err: unknown) {
      refused = moveRefusal(err);
    }
    await get().loadSlots();
    return refused;
  },

  fillApply: async (steps) => {
    if (!steps.length) return null;
    const { slots, groups } = get();
    // ด่านคาบล็อกเหมือนโหมดนำทาง — ส่งแบบ force จึงต้องตรวจเองที่ฝั่งนี้
    const shares = buildSharesStudents(groups);
    const moving = new Set(steps.map((s) => s.slotId));
    for (const st of steps) {
      const s = slots.find((x) => x.id === st.slotId);
      if (!s) continue;
      const clash = lockClashAt(s, st.day, st.period, st.roomId,
                                slots.filter((x) => !moving.has(x.id)), shares);
      if (clash) return `เส้นทางนี้ใช้ไม่ได้ — ${clash.reason} 🔒 ปลดล็อกคาบนั้นก่อน`;
    }
    set((st) => ({ undoStack: [...st.undoStack, {
      label: "เอาคาบมาลงห้อง",
      patches: steps.map((g) => {
        const cur = slots.find((x) => x.id === g.slotId);
        return { slotId: g.slotId, day: cur?.day, period: cur?.period,
                 room_id: cur?.room_id ?? null };
      }),
    }].slice(-25) }));
    let refused: string | null = null;
    try {
      await withWrite(() => api.moveSlots(steps.map((g) => ({
        slot_id: g.slotId, day: g.day, period: g.period, room_id: g.roomId,
      })), true));
    } catch (err: unknown) {
      refused = moveRefusal(err);
    }
    await get().loadSlots();
    return refused;
  },
  // โหมดจัดเองไม่ได้แย่งคลิกกับสองโหมดข้างบน — มันเปลี่ยนแค่ว่า "ลากแล้ววางได้
  // ไหมเมื่อชนกัน" จึงเปิดพร้อมกันได้ และไม่ต้องปิดโหมดอื่น
  setManualMode:        (on) => set({ manualMode: on }),
  setYardPickMode:      (on) => {
    set(on
      ? { yardPickMode: true, preLockMode: false,
          guideMode: false, guideMovingId: null, guideSteps: [] }
      : { yardPickMode: false });
    // Fresh marks and ลาน on the way in: another person may have changed them.
    if (on) void get().loadYardPicks();
  },

  loadAll: async () => {
    set({ isLoading: true });
    try {
      const [departments, buildings, rooms, groups, teachers, subjects, requirements, slots, periods, config] =
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
          api.fetchSchoolConfig().catch(() => null),
        ]);
      set({ departments, buildings, rooms, groups, teachers, subjects, requirements, slots, periods });
      void get().loadYardPicks();
      // The school name, logo and signatories live on the server too, so a
      // refresh — or the other person's browser — shows the same header.
      if (config) set((st) => ({ schoolConfig: { ...st.schoolConfig, ...config } }));
    } finally {
      set({ isLoading: false });
    }
  },

  loadSlots: async () => {
    const slots = await api.fetchSlots();
    set({ slots });
  },

  loadYardPicks: async () => {
    const mine = ++yardLoadSeq;
    try {
      const r = await api.fetchYardPicks();
      if (mine !== yardLoadSeq) return;
      set({ yardPicks: r.rows, yardList: r.yards, yardPicksError: null });
    } catch (e) {
      if (mine !== yardLoadSeq) return;
      // Not worth interrupting anyone for: the marks already on screen stay,
      // and the picker says so if there is nothing to choose from.
      set({ yardPicksError: api.errorDetail(e, "โหลดรายการลานไม่สำเร็จ") });
    }
  },

  saveYardPick: async (p) => {
    const saved = await api.setYardPick(p);
    yardLoadSeq++;   // any load still in flight began before this save
    set((st) => ({ yardPicks: applyPickResult(st.yardPicks, p, saved) }));
  },

  removeYardPicks: async (groupId, day, periods) => {
    for (const period of periods) {
      const asked = { group_id: groupId, day, period, room_id: null };
      try {
        await api.setYardPick(asked);
        yardLoadSeq++;
        set((st) => ({ yardPicks: applyPickResult(st.yardPicks, asked, null) }));
      } catch {
        set({ yardPicksError: "เอาหมุดออกไม่สำเร็จ — ลองใหม่อีกครั้ง" });
        return;
      }
    }
    // คาบที่เคยถูกหมุดดึงไว้ อาจเพิ่งถูกปล่อยให้ไม่มีห้อง — ดึงตารางมาดูของจริง
    await get().loadSlots();
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
      // An edit in flight is the third way the screen can be mid-change, beside
      // a drag and a solve. Refreshing across one is what made edits bounce.
      if (st.draggingSlot || st.isSolving || st.isLoading || writeGuard.busy) return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const info = await api.fetchStateVersion();
        const { revision } = info;
        const prev = get().lastRevision;
        set({
          syncState: "live", lastSyncedAt: Date.now(),
          serverSavedAt: info.saved_at ? new Date(info.saved_at).getTime() : get().serverSavedAt,
          serverSaving: !!info.pending,
          serverStoreError: info.store === "file" ? "ยังไม่ได้เก็บลงฐานข้อมูล"
            : (info.store_error ?? null),
        });
        if (revision === prev) return;
        if (prev === -1) { set({ lastRevision: revision }); return; }  // first poll: just record
        // A revision that went BACKWARDS means the process restarted: the
        // counter only ever climbs while the server is up. Restarts are
        // ordinary on a host that sleeps when nobody is using it, and the
        // counter now comes back with the data, so this is simply a new
        // numbering to adopt. quietRefresh above will not pull an empty
        // server over a full screen, which is the only risk worth guarding.
        if (revision < prev) {
          set({ lastRevision: revision, syncState: "live" });
          await quietRefresh(set, get);
          return;
        }
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
    await withWrite(() => api.createSlot(d));
    // Reload rather than append: a คาบคู่ is two cells and only the first
    // comes back, so appending would leave the second half off the grid
    // until something else refreshed it.
    await get().loadSlots();
  },

  // ── DnD ─────────────────────────────────────────────────────────────────
  startDrag: (slot) => {
    const { slots, periods, groups, manualMode } = get();
    const shares = buildSharesStudents(groups);
    // สีตอนลากต้องรู้จักโหมดจัดเองด้วย ไม่งั้นมันจะขึ้น "ไม่สามารถวางได้"
    // เต็มตาราง ทั้งที่โหมดนั้นวางได้แล้ว
    //
    // และต้องรู้ด้วยว่าคาบนี้เป็นของชั้นไหน เพราะ ม.ต้นกับ ม.ปลายใช้เลขคาบ
    // ชุดเดียวกันแต่คนละความหมาย — เลขคาบ 5 เป็นคาบ 4 ของ ม.ปลาย และเป็น
    // พักกลางวันของ ม.ต้น ถ้าไม่บอกชั้น ตัวเช็คจะหยิบแถวแรกที่เลขตรง ซึ่งเป็น
    // พักกลางวันของอีกฝั่งเสมอ แล้วบอกว่าวางไม่ได้
    const owner = flattenGroups(groups).find((g) => g.id === slot.group_id);
    const map = buildImpactMap(slot, slots, periods, 5, shares, manualMode,
                               levelKeyOf(owner));
    set({ draggingSlot: slot, impactMap: map });
  },

  endDrag: () => set({ draggingSlot: null, impactMap: new Map(), tooltipText: null }),

  moveSlot: async (slotId, newDay, newPeriod) => {
    const { slots, groups } = get();
    const slot = slots.find((s) => s.id === slotId);
    if (!slot || slot.is_locked) return;

    // วางลงไปก่อน แล้วขึ้นสีแดงถ้ามีปัญหา — ไม่เด้งกลับที่เดิม
    //
    //   "ตอนสลับคาบกันมันเด้งกลับไปที่เดิม ช่วยทำให้ไม่เด้งกลับให้หน่อย
    //    ถ้าเกิดปัญหาค่อยขึ้นสีแดง"
    //
    // คำสั่งที่ส่งไปคือ "ข้ามการตรวจทั้งหมด" หน้าเว็บจึงต้องยืนด่านคาบที่ล็อก
    // ไว้เอง (ดู utils/lockGuard.ts) ซึ่งเป็นกฎข้อเดียวที่โรงเรียนบอกให้คงไว้
    // ที่เหลือ — ครูชน ห้องชน นักเรียนมีสองคาบ — ขึ้นกรอบแดงในช่องให้เห็น
    {
      const clash = lockClashAt(slot, newDay, newPeriod, slot.room_id,
                                slots, buildSharesStudents(groups));
      if (clash) {
        set({ solverError: `วางตรงนี้ไม่ได้ — ${clash.reason} 🔒 ` +
                           "ถ้าจะวางจริง ต้องปลดล็อกคาบนั้นก่อน" });
        return;
      }
    }

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
      // force = ข้ามการตรวจของเซิร์ฟเวอร์ ซึ่งเป็นธงที่เซิร์ฟเวอร์รุ่นที่รัน
      // อยู่ตอนนี้รู้จักอยู่แล้ว โหมดจัดเองจึงใช้ได้ทันทีโดยไม่ต้องรออัปเดต
      // ส่วนด่านคาบล็อก หน้าเว็บเช็คไปแล้วข้างบน
      // เส้นทาง force ย้ายทีละคาบตามที่สั่ง ไม่ได้พาห้องย่อยที่เรียนพร้อมกัน
      // ไปด้วยเหมือนเส้นทางปกติ จึงต้องใส่พี่น้องของเซ็ตลงไปในชุดเดียวกันเอง
      // ไม่งั้นเซ็ตห้องแม่ลูกจะขาดครึ่ง
      // ส่งพี่น้องของเซ็ตห้องย่อยไปในชุดเดียวกัน เพราะเส้นทาง "ข้ามการตรวจ"
      // ย้ายเฉพาะที่สั่ง ไม่ได้พาไปให้เองเหมือนเส้นทางที่ตรวจ
      await withWrite(() => api.moveSlots(
        affected.map((s) => ({ slot_id: s.id, day: newDay, period: newPeriod })),
        true));
      // คาบคู่: เซิร์ฟเวอร์พาอีกครึ่งไปวางในคาบที่ติดกันให้แล้ว ("คาบคู่ มีคาบ
      // ที่คู่กันที่หายไป") แต่จอยังไม่รู้ว่าครึ่งนั้นไปอยู่ไหน — คาบติดกันจริง
      // หรือไม่เป็นเรื่องของผังคาบของชั้นนั้น ซึ่งเซิร์ฟเวอร์เป็นคนรู้ จึงโหลด
      // ตารางใหม่ทีเดียวแทนที่จะคิดกฎนั้นซ้ำที่ฝั่งนี้แล้วเสี่ยงคิดไม่ตรงกัน
      if (slot.double_group_key) await get().loadSlots();
    } catch (err: unknown) {
      // The backend refuses a move that would double-book a class, teacher or
      // room. Put the lesson back and say why, rather than letting it snap
      // home with no explanation.
      //
      // ในโหมดจัดเอง เซิร์ฟเวอร์ไม่ปฏิเสธเรื่องชนกันอีกแล้ว ที่ยังปฏิเสธได้คือ
      // ทับคาบที่ล็อกไว้ — ซึ่งเป็นข้อเดียวที่โรงเรียนบอกให้คงไว้ การคืนคาบ
      // กลับที่เดิมตรงนี้จึงยังถูกต้อง และข้อความจะบอกว่าชนกับคาบล็อกตัวไหน
      set({ slots, solverError: moveRefusal(err) });
    }
  },

  swapRoom: async (slotId, newRoomId) => {
    const { slots, rooms } = get();
    const slot = slots.find((s) => s.id === slotId);
    const room = rooms.find((r) => r.id === newRoomId);
    if (!slot || !room) return;

    // คาบคู่คือคาบเดียวที่ยาวสองชั่วโมง เก็บเป็นสองแถวที่ผูกกันด้วย
    // double_group_key — ย้ายห้องให้แถวเดียว เด็กต้องเก็บของย้ายกลางคาบ
    //
    //   "เมื่อกดย้ายห้องคาบคู่ มันไปได้แค่คาบเดียว"
    //
    // เซิร์ฟเวอร์พาอีกครึ่งไปให้แล้ว ตรงนี้ทำให้จอตรงกันทันทีโดยไม่ต้องรอโหลดใหม่
    const dbl = slot.double_group_key;
    const together = (s: TimetableSlot) =>
      s.id === slotId
      || (!!dbl && s.double_group_key === dbl && s.group_id === slot.group_id
          && s.day === slot.day);
    set({
      slots: slots.map((s) => (together(s)
        ? { ...s, room_id: newRoomId, room_name: room.name, room_type: room.type }
        : s)),
    });
    set((st) => ({ undoStack: [...st.undoStack, {
      label: "เปลี่ยนห้อง",
      // ย้อนทั้งคาบคู่ ไม่ใช่ครึ่งเดียว — ไม่งั้นย้อนแล้วสองครึ่งอยู่คนละห้อง
      // ซึ่งแย่กว่าตอนก่อนกดย้ายเสียอีก
      patches: slots.filter(together)
        .map((s) => ({ slotId: s.id, room_id: s.room_id ?? null })),
    }].slice(-25) }));
    try {
      // โหมดจัดเอง: "เราสามารถเปลี่ยนห้องได้" — ย้ายเข้าห้องที่มีคนใช้อยู่ได้
      // แล้วไปขึ้นกรอบแดง "ห้องซ้ำ" แทน (force ใช้ได้กับเซิร์ฟเวอร์รุ่นปัจจุบัน)
      const saved = await withWrite(async () => {
        const r = await api.moveSlots([{ slot_id: slotId, room_id: newRoomId }], true);
        return r.slots.find((x) => x.id === slotId) ?? null;
      });
      // หมุดลานแรงกว่าการย้ายห้องด้วยมือ: ถ้าชั่วโมงนี้ปักหมุดไว้ เซิร์ฟเวอร์จะ
      // คืนห้องเป็นลานที่ปักไว้ ไม่ใช่ห้องที่กดเลือก เดิมหน้าจอเก็บห้องใหม่ไว้
      // เงียบ ๆ แล้วเด้งกลับตอนโหลดครั้งถัดไป — "ย้ายห้องแล้วกลับไปที่เดิม"
      // โดยไม่มีใครรู้ว่าเพราะอะไร
      if (saved && saved.room_id !== newRoomId) {
        const pinned = get().yardPicks.find(
          (r) => r.group_id === slot.group_id && r.day === slot.day
                 && r.period === slot.period);
        const yard = pinned
          ? get().yardList.find((y) => y.id === pinned.room_id)?.name ?? "ลานที่ปักไว้"
          : null;
        set((st) => ({
          slots: st.slots.map((x) => (together(x)
            ? { ...x, room_id: saved.room_id ?? null,
                room_name: saved.room_name ?? null, room_type: saved.room_type ?? null }
            : x)),
          solverError: yard
            ? `ชั่วโมงนี้ปักหมุดไว้ที่ ${yard} จึงกลับไปที่เดิม — กด ✕ ที่แถบ `
              + `📌 ${yard} ในช่องนั้นเพื่อเอาหมุดออกก่อน แล้วค่อยย้ายห้อง`
            : "เซิร์ฟเวอร์เปลี่ยนห้องให้เป็นห้องอื่น — ดูห้องที่ขึ้นในช่องนั้น",
        }));
      }
    } catch (err: unknown) {
      // Put back THIS slot's room, not the whole timetable as it looked when
      // the call began. Restoring that snapshot would also undo any edit made
      // in between — the same bug this guard exists to stop, arriving by way
      // of the error path instead of the refresh.
      set((st) => ({
        slots: st.slots.map((s) => (s.id === slotId
          ? { ...s, room_id: slot.room_id ?? null,
              room_name: slot.room_name ?? null, room_type: slot.room_type ?? null }
          : s)),
        solverError: moveRefusal(err),
      }));
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

    // 2. Persist. The moves go together in one call: a swap's first half looks
    //    like a clash on its own, so the backend judges them against the result.
    try {
      const moves = route.steps
        .filter((s) => s.action !== "delete")
        .map((s) => ({ slot_id: s.slotId, day: s.toDay, period: s.toPeriod, room_id: s.toRoomId }));
      if (moves.length > 0) {
        // ในโหมดจัดเอง เส้นทางที่เลือกไว้ต้องได้ลงจริง ไม่ใช่ถูกปฏิเสธกลับมา
        // ทั้งชุดเพราะมีจุดหนึ่งยังชนอยู่ — คาบที่ยังชนจะไปขึ้นกรอบแดงแทน
        //
        // แต่ต้องยืนด่านคาบล็อกเองก่อนส่ง เพราะ force แปลว่า "ข้ามการตรวจ
        // ทั้งหมด" ซึ่งรวมด่านนั้นด้วย ตรวจทุกก้าวของเส้นทาง ไม่ใช่แค่ก้าวแรก
        // ด่านคาบล็อกต้องตรวจทุกครั้ง ไม่ใช่เฉพาะโหมดจัดเอง เพราะตอนนี้ทุก
        // เส้นทางส่งแบบ "ข้ามการตรวจ" เพื่อไม่ให้เด้งกลับ
        {
          const now = get().slots;
          const shares = buildSharesStudents(get().groups);
          const moved = new Set(moves.map((m) => m.slot_id));
          for (const m of moves) {
            const s = now.find((x) => x.id === m.slot_id);
            if (!s) continue;
            const clash = lockClashAt(s, m.day ?? s.day, m.period ?? s.period,
                                      m.room_id ?? s.room_id,
                                      now.filter((x) => !moved.has(x.id)), shares);
            if (clash) {
              set({ solverError: `เส้นทางนี้ใช้ไม่ได้ — ${clash.reason} 🔒 ` +
                                 "ลองเส้นทางอื่น หรือปลดล็อกคาบนั้นก่อน" });
              await get().loadSlots();
              return;
            }
          }
        }
        // เส้นทางที่โรงเรียนกดเลือกเองต้องได้ลงจริง ไม่ถูกปฏิเสธกลับมาทั้งชุด
        // เพราะมีจุดหนึ่งยังชนอยู่ — จุดนั้นไปขึ้นกรอบแดงในช่องแทน
        const r = await withWrite(() => api.moveSlots(moves, true));
        if (!r.ok) {
          // ที่ยังปฏิเสธได้คือเรื่องเชิงโครงสร้าง เช่น คาบคู่ลงที่นั้นไม่ได้
          // เพราะไม่มีคาบติดกันพอ — บอกเหตุผลแล้วคืนของจริงจากเซิร์ฟเวอร์
          set({ solverError: `ย้ายไม่ได้: ${r.conflicts.slice(0, 2).join(" · ")}` });
          await get().loadSlots();
          return;
        }
      }
      for (const step of route.steps) {
        if (step.action === "delete") await withWrite(() => api.deleteSlot(step.slotId));
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
        await withWrite(() => api.updateSlot(p.slotId, body));
      }
    } catch {
      await get().loadSlots();
    }
  },

  toggleLock: async (slotId) => {
    const { slots } = get();
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;
    const updated = await withWrite(() => api.updateSlot(slotId, { is_locked: !slot.is_locked }));
    set({ slots: slots.map((s) => (s.id === slotId ? { ...s, ...updated } : s)) });
  },

  deleteSlot: async (slotId) => {
    await withWrite(() => api.deleteSlot(slotId));
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
    const result = await withWrite(() => api.bulkLockSlots(params));
    // Re-fetch slots to reflect changes
    const slots = await api.fetchSlots();
    set({ slots });
    return result;
  },

  runSolver: async (opts) => {
    const repair = opts?.repairGroupIds;
    const repairing = repair !== undefined;
    if (repair && repair.length === 0) {
      throw new Error("ยังไม่ได้เลือกห้องที่จะแก้ — ไม่ส่งไปจัด เพราะรายการว่างจะกลายเป็นจัดใหม่ทั้งโรงเรียน");
    }
    set({ isSolving: true, solverError: null, solveProgress: null });
    // ถามความคืบหน้าระหว่างรอ — คำขอการจัดค้างเป็นนาที และ "ค้างจริง" กับ
    // "ทำงานอยู่" หน้าตาเหมือนกันเป๊ะถ้าไม่มีอะไรบอก
    //
    // ถามไม่ได้ก็ไม่เป็นไร (เซิร์ฟเวอร์รุ่นเก่ายังไม่มีเส้นนี้) — ปล่อยให้เป็น
    // null แล้วหน้าจอกลับไปแสดงแบบเดิม ไม่ใช่ขึ้น error ทับงานที่ยังวิ่งอยู่
    const poll = setInterval(() => {
      void api.fetchSolveProgress()
        .then((p) => { if (get().isSolving) set({ solveProgress: p }); })
        .catch(() => { /* ไม่มีเส้นนี้ หรือถามไม่ทัน — ข้ามรอบนี้ไป */ });
    }, 900);
    // Keep a copy of everything as it stands before the solve. This is the
    // heaviest thing the server is ever asked to do and the one most likely
    // to take it down with it — and a solve replaces the whole timetable, so
    // a server that dies here is a server that comes back with neither the
    // old timetable nor the new one. Best effort: a failed copy must not
    // stop the school from building their timetable.
    try {
      if (storageAvailable()) {
        const before = await api.downloadBackup();
        if (Array.isArray(before["teachers"]) && before["teachers"].length) {
          await putSavePoint("auto", before);
        }
      }
    } catch { /* no copy taken; carry on */ }
    try {
      const lockedIds = get().slots.filter((s) => s.is_locked).map((s) => s.id);
      const result = await api.runSolver({
        clear_existing: true,
        close_gaps_hard: opts?.closeGapsHard,
        time_limit_seconds: opts?.timeLimitSeconds,
        locked_slot_ids: lockedIds,
        exclude_requirement_ids: opts?.excludeRequirementIds,
        skip_problems: opts?.skipProblems,
        max_consecutive: opts?.maxConsecutive,
        prefer_consecutive: opts?.preferConsecutive,
        min_last_period: opts?.minLastPeriod,
        max_last_period: opts?.maxLastPeriod,
        last_period_mode: opts?.lastPeriodMode,
        repair_group_ids: opts?.repairGroupIds,
      });
      await get().loadSlots();
      void get().loadYardPicks();
      return result;
    } catch (err: unknown) {
      const e = err as {
        code?: string;
        response?: { status?: number; data?: { detail?: unknown } };
      };
      const raw = e?.response?.data?.detail;
      // สามอย่างนี้หน้าตาเหมือนกันหมดจากฝั่งนี้ ถ้าไม่แยก คนอ่านจะไม่รู้ว่าควร
      // รอต่อ กดใหม่ หรือไปแก้ข้อมูล — เดิมเขียนรวมเป็นประโยคเดียวว่า "อาจใช้
      // เวลานานเกินไปหรือหน่วยความจำไม่พอ" ซึ่งบอกแค่ว่าเราเองก็ไม่รู้
      //   · รอจนครบเพดานแล้วยังไม่ตอบ — เซิร์ฟเวอร์อาจยังคิดอยู่
      //   · ตอบกลับมาเป็นรหัสผิดพลาด — มีคำตอบ แต่เป็นคำตอบว่าพัง
      //   · ไม่มีอะไรตอบกลับเลย — เซิร์ฟเวอร์น่าจะถูกปิดกลางคัน
      const minutes = Math.round(api.SOLVE_TIMEOUT_MS / 60_000);
      const msg = typeof raw === "string"
        ? raw
        : (e?.code === "ECONNABORTED" || e?.code === "ETIMEDOUT")
        ? `จัดตารางไม่เสร็จภายใน ${minutes} นาที จึงหยุดรอ — เซิร์ฟเวอร์อาจยัง`
          + "คิดอยู่ ลองรอสักครู่แล้วรีเฟรชดูตารางก่อน ถ้ายังไม่มีอะไรเปลี่ยน "
          + "ให้ติ๊ก \"ข้ามวิชาที่มีปัญหา\" แล้วกดใหม่"
        : e?.response?.status
        ? `เซิร์ฟเวอร์ตอบว่าผิดพลาด (รหัส ${e.response.status}) — ตารางยังไม่ถูก`
          + "แก้ ลองกดใหม่อีกครั้ง"
        : "เซิร์ฟเวอร์ไม่ตอบกลับเลย — น่าจะถูกปิดกลางคันเพราะหน่วยความจำไม่พอ "
          + "ตารางเดิมยังอยู่ครบ ลองกดใหม่อีกครั้ง หรือติ๊ก \"ข้ามวิชาที่มีปัญหา\"";
      // A repair reports its own failure in its own dialog, with the server's
      // sentence (api.errorDetail). Left in solverError it would turn up later
      // in the ⚡ panel, under a button that had nothing to do with it.
      if (!repairing) set({ solverError: msg });
      throw err;
    } finally {
      clearInterval(poll);
      set({ isSolving: false, solveProgress: null });
    }
  },
}));
