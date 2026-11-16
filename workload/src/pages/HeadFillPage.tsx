import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AxiosError } from "axios";
import { apiErrorText, listDepartments, listTeachers } from "../api";
import { departmentName, roomRange, SET_KIND_TEXT, thaiDateTime } from "../curriculum";
import { listRooms } from "../curriculumApi";
import {
  bulkConfirmIds, deptStatusLabel, deptStatusTone, editState, fillLevels, fillProgress, filterOptions, filterRows,
  groupBySubject, holdPending, loadBars, optionState, optionTeacherPatch, releasePending, rowPatch, rowState, settlePending,
  shownFields, subjectLine, submitState, teacherChoices, teacherNamer, type AutoFields, type DeptStatus, type PendingEdit, type FillFilter, type OptionTeacher, type Round, type RoundOption, type RoundRow,
  type SubjectGroup, type TeacherChoice, type TeacherLoad, type Term,
} from "../round";
import {
  addOptionTeacher, bulkRows, deleteOptionTeacher, getRoundItems, getRoundLoads, listDeptStatuses, submitDept,
  updateOptionTeacher, updateRow, type OptionTeacherPatch, type RoundItems, type RowPatch,
} from "../roundApi";
import { Button, Card, Chip, EmptyState, Notice, Progress, Segmented } from "../ui";
import { useRegistryList } from "../useRegistryList";

// หน้ากรอกของหัวหน้ากลุ่มสาระ (แบบข้อ 4.5 · ภาพ mockup-head.png): หน้าที่คือ "ใส่ครูอย่างเดียว" — ยืนยันครูจากเทอมก่อนทีละแถว
// หรือทั้งชุด ใส่ครูให้หลายห้อง คาบเสรี/กิจกรรม แล้วกดส่ง · วิชา คาบ ห้องเรียน แก้ที่หลักสูตรโดยผู้ดูแลระบบเท่านั้น (ไม่มีช่องแก้ที่นี่)
// หน้าเดียวกันเป็นโหมดผู้ดูแลระบบจาก "เปิดดู" ของภาพรวมรอบ: เลือกกลุ่มได้ แก้ได้ทุกสถานะกลุ่ม (wl_can_edit) ไม่มีปุ่มส่ง
//
// ทุกการบันทึกส่งเฉพาะช่องที่เปลี่ยน (rowPatch) — PUT ที่มี teacher_id = ยืนยันอัตโนมัติ แถวจากเทอมก่อนจึงห้ามมี teacher_id ติดไป
// ตอนแก้ช่องอื่น · ใช้แถวที่เซิร์ฟเวอร์ตอบกลับแทนค่าบนจอเสมอ (ไม่เดาสถานะยืนยันเอง)
// 409/404 (ส่งแล้ว รอบปิด รายการหายจากที่อื่น) → ข้อความไทยของเซิร์ฟเวอร์ที่แถวนั้น แล้วโหลดสถานะใหม่ทั้งหน้า ค่าที่พิมพ์ค้างในแถวนั้นยังอยู่

type Mode = "head" | "admin";
type Write = <T>(job: () => Promise<T>, done: (value: T) => void) => Promise<string | null>;

const fmt = (n: number): string => n.toLocaleString("th-TH");
const statusOf = (err: unknown): number => (err as AxiosError | undefined)?.response?.status ?? 0;
const when = (iso: string | null): string | null => (iso ? (thaiDateTime(iso) ?? iso) : null);
// แต่ละแถวมีตัวเลือกครูร้อยกว่าคน — เปิดการ์ดทุกใบตั้งแต่แรกเมื่อกลุ่มมีแถวไม่มาก (กลุ่ม 258 แถวบนโทรศัพท์เริ่มแบบพับไว้ ดูภาพรวมก่อน)
const OPEN_ALL_UP_TO = 120;

/** ของที่ทุกแถวใช้ร่วม (ชื่อครู/ห้อง และ <option> ที่สร้างครั้งเดียว) — memo ทั้งก้อน แถวที่ไม่เปลี่ยนจึงไม่วาดใหม่ */
type Kit = {
  name: (id: number) => string;
  teacherKind: (id: number) => "active" | "inactive" | "unknown";
  teachersReady: boolean;
  teacherOptions: ReactNode;
  rooms: ReadonlyMap<number, string>;
  roomsReady: boolean;
  roomOptions: ReactNode;
};

export default function HeadFillPage(props: {
  round: Round;
  deptId: number;
  mode: Mode;
  /** ส่ง/ได้ 409 แล้วสถานะรอบอาจเปลี่ยน — App โหลดรายการรอบใหม่ (ชิปบนแถบบน และ prop round ของหน้านี้) */
  onRoundChanged: () => void;
  /** ลิงก์ "จากหลักสูตร …" (ตรวจย้อนได้ว่าแถวมาจากบรรทัดไหน) */
  onOpenCurriculum: (focus: Term & { curriculumId?: number }) => void;
  /** admin: กลับไปภาพรวมรอบ */
  onBack?: () => void;
  /** admin: เปลี่ยนกลุ่มสาระที่ดู */
  onDeptChange?: (deptId: number) => void;
  /** ลิงก์ "ดูทั้งหมด · พิมพ์" → หน้าสรุปอัตรากำลังของรอบและกลุ่มนี้ */
  onOpenSummary?: () => void;
}) {
  const { round, deptId, mode } = props;
  const roundChanged = useRef(props.onRoundChanged);
  roundChanged.current = props.onRoundChanged;

  // ---- ข้อมูลของหน้า: โหลดซ้ำแล้วเก็บของเดิมไว้บนจอจนของใหม่มา (ตัวแก้ที่พิมพ์ค้างไม่ถูกถอด) ----
  const [items, setItems] = useState<RoundItems | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsTick, setItemsTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // หัวหน้า: เซิร์ฟเวอร์ให้กลุ่มตัวเองเสมอ ไม่ต้องส่ง · admin: ต้องบอกกลุ่ม ไม่งั้นได้ทุกกลุ่ม
    getRoundItems(round.id, mode === "admin" ? deptId : undefined).then(
      (d) => {
        if (cancelled) return;
        setItems(d);
        setItemsError(null);
      },
      (err) => {
        if (!cancelled) setItemsError(apiErrorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [round.id, round.status, deptId, mode, itemsTick]);

  const [statuses, setStatuses] = useState<DeptStatus[] | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusTick, setStatusTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listDeptStatuses(round.id).then(
      (list) => {
        if (cancelled) return;
        setStatuses(list);
        setStatusError(null);
      },
      (err) => {
        if (!cancelled) setStatusError(apiErrorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [round.id, round.status, statusTick]);

  const [loads, setLoads] = useState<TeacherLoad[] | null>(null);
  const [loadsError, setLoadsError] = useState<string | null>(null);
  const [loadsTick, setLoadsTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getRoundLoads(round.id).then(
      (list) => {
        if (cancelled) return;
        setLoads(list);
        setLoadsError(null);
      },
      (err) => {
        if (!cancelled) setLoadsError(apiErrorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [round.id, round.status, loadsTick]);

  const teachers = useRegistryList(listTeachers);
  const rooms = useRegistryList(listRooms);
  const depts = useRegistryList(listDepartments);

  // ---- บันทึก ----
  const reloadAll = useCallback(() => {
    setItemsTick((n) => n + 1);
    setStatusTick((n) => n + 1);
    setLoadsTick((n) => n + 1);
    roundChanged.current();
  }, []);

  // คืนข้อความผิดพลาด (ให้แถว/การ์ดที่กดแสดงเอง) หรือ null · สำเร็จ = ยอดคาบรายครูโหลดใหม่ (เซิร์ฟเวอร์นับ หน้าไม่นับเอง)
  const write = useCallback<Write>(
    async (job, done) => {
      try {
        done(await job());
        setLoadsTick((n) => n + 1);
        return null;
      } catch (err) {
        // ส่งแล้ว/รอบปิด/รายการหาย จากอีกแท็บหรืออีกคน — ที่เห็นอยู่ไม่ใช่สถานะจริงแล้ว
        if (statusOf(err) === 409 || statusOf(err) === 404) reloadAll();
        return apiErrorText(err);
      }
    },
    [reloadAll],
  );

  const upsertRows = useCallback((rows: RoundRow[]) => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    setItems((cur) => cur && { ...cur, rows: cur.rows.map((r) => byId.get(r.id) ?? r) });
  }, []);
  const setOptionTeachers = useCallback((optionId: number, fn: (list: OptionTeacher[]) => OptionTeacher[]) => {
    setItems((cur) => cur && {
      ...cur,
      options: cur.options.map((o) => (o.id === optionId ? { ...o, teachers: fn(o.teachers) } : o)),
    });
  }, []);

  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const onSelect = useCallback((ids: number[], on: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const saveRow = useCallback(
    (id: number, patch: RowPatch) => write(() => updateRow(id, patch), (r) => upsertRows([r])),
    [write, upsertRows],
  );
  const bulk = useCallback(
    (ids: number[], set: Pick<RowPatch, "teacher_id" | "confirmed">) =>
      write(() => bulkRows(ids, set), (rows) => {
        upsertRows(rows);
        onSelect(ids, false);
      }),
    [write, upsertRows, onSelect],
  );
  const addTeacher = useCallback(
    (optionId: number, teacherId: number) =>
      write(() => addOptionTeacher(optionId, { teacher_id: teacherId }), (t) => setOptionTeachers(optionId, (l) => [...l, t])),
    [write, setOptionTeachers],
  );
  const saveOptionTeacher = useCallback(
    (ot: OptionTeacher, patch: OptionTeacherPatch) =>
      write(() => updateOptionTeacher(ot.id, patch), (t) => setOptionTeachers(ot.option_id, (l) => l.map((x) => (x.id === t.id ? t : x)))),
    [write, setOptionTeachers],
  );
  const removeOptionTeacher = useCallback(
    (ot: OptionTeacher) =>
      write(() => deleteOptionTeacher(ot.id), () => setOptionTeachers(ot.option_id, (l) => l.filter((x) => x.id !== ot.id))),
    [write, setOptionTeachers],
  );

  // ---- ส่ง (หัวหน้า) ----
  const [askSubmit, setAskSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const err = await write(() => submitDept(round.id, deptId), (d) => {
      setStatuses((cur) => (cur ? cur.map((x) => (x.department_id === d.department_id ? d : x)) : [d]));
      roundChanged.current();
    });
    setSubmitting(false);
    if (err) setSubmitError(err);
    else setAskSubmit(false);
  };

  // ---- ของที่แถวใช้ร่วม ----
  const name = useMemo(() => teacherNamer(teachers.rows), [teachers.rows]);
  const choices = useMemo(() => teacherChoices(teachers.rows, deptId), [teachers.rows, deptId]);
  const kit = useMemo<Kit>(() => {
    const kinds = new Map(teachers.rows.map((t) => [t.id, t.active ? ("active" as const) : ("inactive" as const)]));
    return {
      name,
      teacherKind: (id) => kinds.get(id) ?? "unknown",
      teachersReady: teachers.loaded,
      teacherOptions: <TeacherOptions choices={choices} />,
      rooms: new Map(rooms.rows.map((r) => [r.id, r.name])),
      roomsReady: rooms.loaded,
      roomOptions: rooms.rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>),
    };
  }, [name, choices, teachers.rows, teachers.loaded, rooms.rows, rooms.loaded]);

  // ---- ตัวกรองและการ์ด ----
  const [filter, setFilter] = useState<FillFilter>({ state: "all", level: null, query: "" });
  const progress = useMemo(() => (items ? fillProgress(items.rows, items.options) : null), [items]);
  const groups = useMemo(() => (items ? groupBySubject(items.rows) : []), [items]);
  const shownRows = useMemo(() => (items ? filterRows(items.rows, filter, name) : []), [items, filter, name]);
  const shownOptions = useMemo(() => (items ? filterOptions(items.options, filter, name) : []), [items, filter, name]);
  const levels = useMemo(() => (items ? fillLevels(items.rows, items.options) : []), [items]);
  const visible = useMemo(() => {
    const ids = new Set(shownRows.map((r) => r.id));
    return groups.map((g) => ({ g, rows: g.rows.filter((r) => ids.has(r.id)) })).filter((x) => x.rows.length > 0);
  }, [groups, shownRows]);
  // การ์ดที่เปิด/พับ แยกสองชุด: ตอนไล่ดู กับตอนค้นหา (ค้นหาอยู่ = อยากเห็นแถวที่เจอเลย แม้เคยกดพับทั้งหมดไว้)
  // ชุดของการค้นหาเริ่มใหม่ทุกครั้งที่คำค้นเปลี่ยน
  const [openMap, setOpenMap] = useState<{ browse: Record<string, boolean>; search: Record<string, boolean> }>({ browse: {}, search: {} });
  const view = filter.query.trim() !== "" ? "search" : "browse";
  const openByDefault = view === "search" || (items?.rows.length ?? 0) <= OPEN_ALL_UP_TO;
  const isOpen = (key: string) => openMap[view][key] ?? openByDefault;
  const setOpen = (keys: string[], open: boolean) =>
    setOpenMap((m) => ({ ...m, [view]: { ...m[view], ...Object.fromEntries(keys.map((k) => [k, open])) } }));
  const onQuery = (query: string) => {
    setFilter((f) => ({ ...f, query }));
    setOpenMap((m) => ({ ...m, search: {} }));
  };

  // admin: ยอดของทุกคนในรอบ — แสดงเฉพาะครูของกลุ่มนี้และครูที่อยู่ในรายการของกลุ่มนี้
  const related = useMemo(() => {
    const ids = new Set<number>();
    for (const r of items?.rows ?? []) for (const t of [r.teacher_id, r.co_teacher_id]) if (t !== null) ids.add(t);
    for (const o of items?.options ?? []) for (const t of o.teachers) if (t.teacher_id !== null) ids.add(t.teacher_id);
    return ids;
  }, [items]);

  const dept = statuses?.find((d) => d.department_id === deptId) ?? null;
  const deptName = departmentName(deptId, depts.rows, depts.loaded);
  // หัวหน้ายังไม่รู้สถานะกลุ่ม = ยังไม่ให้แก้ (เซิร์ฟเวอร์ตัดสินซ้ำทุกครั้งอยู่แล้ว)
  const edit = editState(mode, round.status, dept?.status ?? null);
  const editable = edit.can && (mode === "admin" || dept !== null);
  const openCurriculum = (curriculumId?: number) =>
    props.onOpenCurriculum({ year: round.year, semester: round.semester, ...(curriculumId !== undefined ? { curriculumId } : {}) });

  const ready = items !== null && (statuses !== null || statusError !== null);

  return (
    <div>
      {mode === "admin" && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="ghost" onClick={props.onBack}>← กลับไปภาพรวมรอบ</Button>
          <label className="flex min-w-0 items-center gap-2 text-[15px] text-muted">
            กลุ่มสาระ
            <select
              className="input min-w-0"
              value={deptId}
              onChange={(e) => props.onDeptChange?.(Number(e.target.value))}
              data-testid="dept-picker"
            >
              {(statuses ?? [{ department_id: deptId }]).map((d) => (
                <option key={d.department_id} value={d.department_id}>
                  {departmentName(d.department_id, depts.rows, depts.loaded)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-title text-ink" data-testid="fill-title">อัตรากำลัง {deptName}</h2>
          {dept && progress && (
            <Chip tone={deptStatusTone({ status: dept.status, rows: progress.total, confirmed: progress.confirmed })}
              dot={dept.status === "filling"} data-testid="dept-status">
              {deptStatusLabel({ status: dept.status, rows: progress.total, confirmed: progress.confirmed })}
            </Chip>
          )}
        </div>
        <p className="mt-1 text-muted">
          {mode === "head"
            ? "ตรวจชื่อครูของแต่ละห้อง แล้วกดยืนยันทีละแถว หรือเลือกหลายแถวแล้วยืนยันพร้อมกัน"
            : "โหมดผู้ดูแลระบบ — แก้ได้ทุกสถานะของกลุ่ม การแก้ไม่เปลี่ยนสถานะกลุ่ม (การส่งเป็นของหัวหน้ากลุ่มสาระ)"}
        </p>
        <p className="text-sm text-muted">
          ภาคเรียน {round.label} · วิชา คาบ และห้องเรียนมาจากหลักสูตร{" "}
          {mode === "head" ? "— ถ้าผิดให้แจ้งผู้ดูแลระบบแก้ที่หลักสูตร" : "— แก้ได้ที่หน้าหลักสูตร"}
        </p>
      </div>

      {/* ตีกลับ: หมายเหตุจากผู้ดูแลระบบเด่นอยู่บนสุด — เป็นสิ่งเดียวที่บอกว่าต้องแก้อะไร */}
      {dept?.status === "returned" && (
        <Notice tone="bad" role="alert" className="mb-4" data-testid="returned-note">
          <p className="font-semibold">ผู้ดูแลระบบตีกลับให้แก้{dept.reviewed_at && ` (เมื่อ ${when(dept.reviewed_at)}${dept.reviewed_by ? ` โดย ${dept.reviewed_by}` : ""})`}</p>
          <p className="mt-1 break-words">“{dept.note}”</p>
          {mode === "head" && <p className="mt-1 text-sm">แก้ตามหมายเหตุ แล้วกดส่งให้ผู้ดูแลระบบตรวจอีกครั้ง</p>}
        </Notice>
      )}
      {/* สถานะกลุ่มยังไม่มา (กำลังโหลด/โหลดไม่ได้) ไม่ใช่ "ไม่พบสถานะ" — รอให้รู้จริงก่อนค่อยบอกเหตุที่แก้ไม่ได้ */}
      {!edit.can && (statuses !== null || round.status === "closed") && (
        <Notice tone={round.status === "closed" ? "mute" : dept?.status === "approved" ? "ok" : "info"} role="status" className="mb-4"
          data-testid="readonly-note">
          <p>{edit.reason} — หน้านี้อ่านอย่างเดียว</p>
          {dept?.status === "submitted" && dept.submitted_at && (
            <p className="mt-1 text-sm">ส่งเมื่อ {when(dept.submitted_at)}{dept.submitted_by ? ` โดย ${dept.submitted_by}` : ""}</p>
          )}
          {dept?.status === "approved" && dept.reviewed_at && (
            <p className="mt-1 text-sm">ตรวจผ่านเมื่อ {when(dept.reviewed_at)}{dept.reviewed_by ? ` โดย ${dept.reviewed_by}` : ""}</p>
          )}
        </Notice>
      )}
      {mode === "admin" && edit.can && (dept?.status === "submitted" || dept?.status === "approved") && (
        <Notice tone="info" role="status" className="mb-4">
          กลุ่มนี้{dept.status === "submitted" ? "ส่งแล้ว รอตรวจ" : "ตรวจผ่านแล้ว"} — ผู้ดูแลระบบยังแก้ได้ และการแก้ไม่เปลี่ยนสถานะกลุ่ม
        </Notice>
      )}

      {statusError && (
        <Notice tone="bad" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>โหลดสถานะของกลุ่มสาระไม่ได้: {statusError}{mode === "head" && " — ระหว่างนี้แก้ไม่ได้"}</span>
          <Button size="sm" onClick={() => setStatusTick((n) => n + 1)}>ลองโหลดใหม่</Button>
        </Notice>
      )}
      {teachers.error && (
        <Notice tone="bad" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>โหลดรายชื่อครูไม่ได้: {teachers.error} — ยังเลือกครูไม่ได้ แต่ยืนยันแถวที่มีครูแล้วได้</span>
          <Button size="sm" onClick={teachers.reload}>ลองโหลดใหม่</Button>
        </Notice>
      )}
      {rooms.error && (
        <Notice tone="bad" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>โหลดรายการห้องไม่ได้: {rooms.error} — ยังเลือกห้องปฏิบัติการไม่ได้</span>
          <Button size="sm" onClick={rooms.reload}>ลองโหลดใหม่</Button>
        </Notice>
      )}
      {itemsError && (
        <Notice tone="bad" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>
            {items ? "โหลดรายการของกลุ่มใหม่ไม่ได้" : "โหลดรายการของกลุ่มไม่ได้"}: {itemsError}
            {items && " — ที่เห็นอยู่อาจไม่ใช่สถานะล่าสุด"}
          </span>
          <Button size="sm" onClick={() => setItemsTick((n) => n + 1)}>ลองโหลดใหม่</Button>
        </Notice>
      )}

      {!ready ? (
        !itemsError && <p role="status" className="text-muted">กำลังโหลดรายการของกลุ่ม...</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="min-w-0 space-y-4">
            <ProgressCard
              mode={mode}
              progress={progress!}
              rows={items!.rows.length}
              options={items!.options.length}
              verdict={submitState(progress!, dept?.status ?? "filling", round.status)}
              statusKnown={dept !== null}
              ask={askSubmit}
              submitting={submitting}
              error={submitError}
              onAsk={() => {
                setSubmitError(null);
                setAskSubmit(true);
              }}
              onCancel={() => setAskSubmit(false)}
              onSubmit={() => void submit()}
            />

            {progress!.total === 0 ? (
              <EmptyState
                title="รอบนี้ไม่มีรายการของกลุ่มสาระนี้"
                hint="ไม่มีบรรทัดหลักสูตรหรือตัวเลือกคาบเสรี/กิจกรรมที่เป็นของกลุ่มนี้ · ถ้าคิดว่าควรมี ให้แจ้งผู้ดูแลระบบตรวจหลักสูตร"
              />
            ) : (
              <>
                <Filters
                  filter={filter}
                  onFilter={setFilter}
                  progress={progress!}
                  levels={levels}
                  cards={visible.length}
                  onQuery={onQuery}
                  onOpenAll={() => setOpen(visible.map((x) => x.g.key), true)}
                  onCloseAll={() => setOpen(visible.map((x) => x.g.key), false)}
                />

                {visible.length === 0 && shownOptions.length === 0 && (
                  <EmptyState
                    title="ไม่มีรายการที่ตรงกับตัวกรอง"
                    hint="ลองเปลี่ยนสถานะ ระดับชั้น หรือคำค้น"
                    action={
                      <Button onClick={() => {
                        setFilter({ state: "all", level: null, query: "" });
                        setOpenMap((m) => ({ ...m, search: {} }));
                      }}>
                        ล้างตัวกรอง
                      </Button>
                    }
                  />
                )}

                {visible.map(({ g, rows }) => (
                  <SubjectCard
                    key={g.key}
                    group={g}
                    rows={rows}
                    open={isOpen(g.key)}
                    onToggle={() => setOpen([g.key], !isOpen(g.key))}
                    editable={editable}
                    selected={selected}
                    onSelect={onSelect}
                    kit={kit}
                    save={saveRow}
                    bulk={bulk}
                    onCurriculum={openCurriculum}
                  />
                ))}

                {shownOptions.length > 0 && (
                  <section aria-label="คาบเสรีและกิจกรรม" className="space-y-3 pt-2">
                    <div>
                      <h3 className="text-lg font-semibold">คาบเสรี / กิจกรรม</h3>
                      <p className="text-sm text-muted">
                        ตัวเลือกหนึ่งมีครูได้หลายคน · คาบ/สัปดาห์ของชุดนับให้ครูแต่ละคนครั้งเดียว ไม่คูณจำนวนห้อง ·{" "}
                        <button type="button" className="text-brand hover:underline" onClick={() => openCurriculum()}>
                          ดูชุดที่หน้าหลักสูตร
                        </button>
                      </p>
                    </div>
                    {shownOptions.map((o) => (
                      <OptionCard
                        key={o.id}
                        option={o}
                        editable={editable}
                        kit={kit}
                        onAdd={addTeacher}
                        onSave={saveOptionTeacher}
                        onRemove={removeOptionTeacher}
                      />
                    ))}
                  </section>
                )}
              </>
            )}
          </div>

          <LoadsCard
            mode={mode}
            loads={loads}
            error={loadsError}
            onRetry={() => setLoadsTick((n) => n + 1)}
            keep={mode === "admin" ? (l) => l.department_id === deptId || related.has(l.teacher_id) : undefined}
            onOpenSummary={props.onOpenSummary}
          />
        </div>
      )}
    </div>
  );
}

// ---- ความคืบหน้า + ส่ง ----

function ProgressCard(props: {
  mode: Mode;
  progress: { total: number; confirmed: number; missingTeacher: number };
  rows: number;
  options: number;
  verdict: { can: boolean; reason: string | null };
  statusKnown: boolean;
  ask: boolean;
  submitting: boolean;
  error: string | null;
  onAsk: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { total, confirmed, missingTeacher } = props.progress;
  const left = total - confirmed;
  const canSubmit = props.verdict.can && props.statusKnown;
  return (
    <Card data-testid="fill-progress">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <p className="text-lg font-semibold" data-testid="progress-text">ยืนยันแล้ว {fmt(confirmed)} จาก {fmt(total)} รายการ</p>
            <p className="text-[15px] text-muted">
              {left > 0 ? `เหลือ ${fmt(left)} รายการ` : "ครบทุกรายการ"}
              {missingTeacher > 0 && ` · ยังไม่มีครู ${fmt(missingTeacher)}`}
            </p>
          </div>
          <Progress className="mt-2" value={confirmed} max={total} tone={total > 0 && left === 0 ? "ok" : "brand"}
            label={`ยืนยันแล้ว ${confirmed} จาก ${total} รายการ`} />
          {props.options > 0 && (
            <p className="mt-1 text-sm text-muted">นับแถววิชา {fmt(props.rows)} แถว และตัวเลือกคาบเสรี/กิจกรรม {fmt(props.options)} ตัวเลือก</p>
          )}
        </div>
        {props.mode === "head" && !props.ask && (
          <div className="flex max-w-sm flex-col items-start gap-1 sm:items-end">
            <Button variant="primary" disabled={!canSubmit} onClick={props.onAsk} data-testid="submit">
              ส่งให้ผู้ดูแลระบบตรวจ
            </Button>
            {props.verdict.reason && (
              <p className="text-sm text-muted sm:text-right" data-testid="submit-reason">{props.verdict.reason}</p>
            )}
          </div>
        )}
      </div>
      {props.mode === "head" && props.ask && (
        <div className="mt-4 rounded-xl border border-line bg-bg p-3" role="group" aria-label="ยืนยันการส่ง">
          <p>ส่งแล้วจะแก้ไม่ได้จนกว่าผู้ดูแลระบบจะตีกลับ — ตรวจชื่อครูครบแล้วใช่ไหม</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={props.onSubmit} disabled={props.submitting || !canSubmit} autoFocus>
              {props.submitting ? "กำลังส่ง..." : "ยืนยันส่ง"}
            </Button>
            <Button onClick={props.onCancel} disabled={props.submitting}>ยังไม่ส่ง</Button>
          </div>
        </div>
      )}
      {props.error && <p role="alert" className="mt-3 text-[15px] text-bad" data-testid="submit-error">{props.error}</p>}
    </Card>
  );
}

// ---- ตัวกรอง ----

function Filters(props: {
  filter: FillFilter;
  onFilter: (f: FillFilter | ((f: FillFilter) => FillFilter)) => void;
  onQuery: (query: string) => void;
  progress: { total: number; confirmed: number };
  levels: string[];
  cards: number;
  onOpenAll: () => void;
  onCloseAll: () => void;
}) {
  const { filter, progress } = props;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="กรองตามสถานะ"
          value={filter.state}
          onChange={(state) => props.onFilter((f) => ({ ...f, state }))}
          options={[
            { value: "all", label: `ทั้งหมด ${fmt(progress.total)}` },
            { value: "todo", label: `ยังไม่ยืนยัน ${fmt(progress.total - progress.confirmed)}` },
            { value: "done", label: `ยืนยันแล้ว ${fmt(progress.confirmed)}` },
          ]}
        />
        <input
          type="search"
          className="input w-full sm:w-72"
          placeholder="ค้นหาวิชา ห้อง หรือชื่อครู"
          aria-label="ค้นหาวิชา ห้อง หรือชื่อครู"
          value={filter.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
      </div>
      {props.levels.length > 1 && (
        <Segmented
          label="กรองตามระดับชั้น"
          value={filter.level ?? ""}
          onChange={(v) => props.onFilter((f) => ({ ...f, level: v === "" ? null : v }))}
          options={[{ value: "", label: "ทุกชั้น" }, ...props.levels.map((l) => ({ value: l, label: l }))]}
        />
      )}
      {props.cards > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
          <span data-testid="card-count">{fmt(props.cards)} วิชา</span>
          <span aria-hidden>·</span>
          <button type="button" className="text-brand hover:underline" onClick={props.onOpenAll}>เปิดทั้งหมด</button>
          <span aria-hidden>·</span>
          <button type="button" className="text-brand hover:underline" onClick={props.onCloseAll}>พับทั้งหมด</button>
        </div>
      )}
    </div>
  );
}

// ---- การ์ดวิชา ----

function SubjectCard(props: {
  group: SubjectGroup;
  /** แถวของการ์ดที่ผ่านตัวกรอง */
  rows: RoundRow[];
  open: boolean;
  onToggle: () => void;
  editable: boolean;
  selected: ReadonlySet<number>;
  onSelect: (ids: number[], on: boolean) => void;
  kit: Kit;
  save: (id: number, patch: RowPatch) => Promise<string | null>;
  bulk: (ids: number[], set: Pick<RowPatch, "teacher_id" | "confirmed">) => Promise<string | null>;
  onCurriculum: (curriculumId: number) => void;
}) {
  const g = props.group;
  // การ์ดที่แถวมาจากหลายหลักสูตร: แต่ละแถวบอกหลักสูตรของตัวเองด้วย (ตรวจย้อนได้ทีละแถว)
  const several = g.curricula.length > 1;
  const bodyId = useId();
  const done = g.rows.filter((r) => rowState(r) === "done").length;
  const hidden = g.rows.length - props.rows.length;
  return (
    <Card as="section" pad={false} aria-label={`${g.code} ${g.name}`} data-testid={`subject-${g.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-snug">
            <button type="button" aria-expanded={props.open} aria-controls={bodyId} onClick={props.onToggle}
              className="flex items-start gap-2 text-left">
              <svg aria-hidden viewBox="0 0 20 20" className={`mt-1 h-4 w-4 shrink-0 text-muted transition-transform ${props.open ? "rotate-90" : ""}`}
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4l6 6-6 6" />
              </svg>
              <span className="min-w-0 break-words">{g.code} {g.name}</span>
            </button>
          </h3>
          <p className="pl-6 text-[15px] text-muted">{subjectLine(g)}</p>
          <p className="pl-6 text-sm text-muted" data-testid="from-curriculum">
            จากหลักสูตร{" "}
            {g.curricula.map((c, i) => (
              <Fragment key={c.id}>
                {i > 0 && " · "}
                <button type="button" className="text-brand hover:underline" onClick={() => props.onCurriculum(c.id)}
                  aria-label={`เปิดหลักสูตร ${c.name}`}>
                  {c.name}
                </button>
              </Fragment>
            ))}
          </p>
        </div>
        <Chip tone={done === g.rows.length ? "ok" : "warn"} data-testid="subject-progress">
          {done === g.rows.length ? `ยืนยันครบ ${fmt(done)} ห้อง` : `ยืนยันแล้ว ${fmt(done)}/${fmt(g.rows.length)}`}
        </Chip>
      </div>
      {props.open && (
        <div id={bodyId}>
          {props.editable && (
            <BulkBar rows={props.rows} selected={props.selected} onSelect={props.onSelect} kit={props.kit} bulk={props.bulk} />
          )}
          <div aria-hidden className="hidden border-t border-line2 px-4 py-2 text-sm text-muted sm:px-5 md:grid md:grid-cols-[1.5rem_5.5rem_minmax(0,1.35fr)_minmax(0,1fr)_2.75rem_minmax(0,1fr)_8.5rem] md:gap-x-3">
            <span />
            <span>ห้อง</span>
            <span>ครูผู้สอน</span>
            <span>ครูสอนร่วม</span>
            <span>คาบคู่</span>
            <span>ห้องปฏิบัติการ · หมายเหตุ</span>
            <span className="text-right">สถานะ</span>
          </div>
          <ul className="divide-y divide-line2 border-t border-line2">
            {props.rows.map((r) => (
              <RowItem key={r.id} row={r} editable={props.editable} selected={props.selected.has(r.id)}
                onSelect={props.onSelect} kit={props.kit} save={props.save} curriculum={several && r.curriculum_name !== r.group_name} />
            ))}
          </ul>
          {hidden > 0 && (
            <p className="border-t border-line2 px-4 py-2 text-sm text-muted sm:px-5">ซ่อนไว้ {fmt(hidden)} ห้องตามตัวกรอง</p>
          )}
        </div>
      )}
    </Card>
  );
}

function BulkBar(props: {
  rows: RoundRow[];
  selected: ReadonlySet<number>;
  onSelect: (ids: number[], on: boolean) => void;
  kit: Kit;
  bulk: (ids: number[], set: Pick<RowPatch, "teacher_id" | "confirmed">) => Promise<string | null>;
}) {
  const picked = props.rows.filter((r) => props.selected.has(r.id));
  const confirm = bulkConfirmIds(props.rows, props.selected);
  const all = props.rows.length > 0 && picked.length === props.rows.length;
  const [assigning, setAssigning] = useState(false);
  const [teacher, setTeacher] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = picked.length > 0 && !all;
  }, [picked.length, all]);

  const run = async (ids: number[], set: Pick<RowPatch, "teacher_id" | "confirmed">) => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    setError(null);
    const err = await props.bulk(ids, set);
    setBusy(false);
    if (err) setError(err);
    else setAssigning(false);
  };
  const assign = (e: FormEvent) => {
    e.preventDefault();
    if (teacher === null) {
      setError("เลือกครูที่จะใส่ก่อน");
      return;
    }
    void run(picked.map((r) => r.id), { teacher_id: teacher });
  };

  return (
    <div className="border-t border-line2 px-4 py-2.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex min-h-[32px] items-center gap-2 text-[15px]">
          <input ref={allBox} type="checkbox" checked={all} onChange={(e) => props.onSelect(props.rows.map((r) => r.id), e.target.checked)} />
          เลือกทั้งหมด{picked.length > 0 && <span className="text-muted">(เลือกแล้ว {fmt(picked.length)})</span>}
        </label>
        <Button size="sm" disabled={picked.length === 0 || busy} onClick={() => {
          setError(null);
          setAssigning(true);
        }}>
          ใส่ครูให้แถวที่เลือก
        </Button>
        <Button size="sm" disabled={confirm.ids.length === 0 || busy} onClick={() => void run(confirm.ids, { confirmed: true })}>
          {busy && !assigning ? "กำลังบันทึก..." : `ยืนยันแถวที่เลือก (${fmt(confirm.ids.length)})`}
        </Button>
      </div>
      {picked.length > 0 && confirm.noTeacher > 0 && (
        <p className="mt-1 text-sm text-muted">แถวที่เลือก {fmt(confirm.noTeacher)} แถวยังไม่มีครู — ใส่ครูก่อนจึงยืนยันได้</p>
      )}
      {assigning && (
        <form onSubmit={assign} className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg p-2.5"
          aria-label="ใส่ครูให้แถวที่เลือก">
          <div className="min-w-0 flex-1 basis-56">
            <TeacherSelect value={teacher} kit={props.kit} disabled={busy || !props.kit.teachersReady} empty="— เลือกครู —"
              label="ครูที่จะใส่ให้แถวที่เลือก" onChange={setTeacher} autoFocus />
          </div>
          <Button type="submit" size="sm" variant="primary" disabled={busy || picked.length === 0}>
            {busy ? "กำลังบันทึก..." : `ใส่ครู ${fmt(picked.length)} แถว`}
          </Button>
          <Button size="sm" onClick={() => setAssigning(false)} disabled={busy}>ยกเลิก</Button>
          <p className="basis-full text-sm text-muted">ใส่ครูแล้วแถวนั้นนับว่ายืนยันแล้ว (คุณเป็นคนเลือกครูเอง)</p>
        </form>
      )}
      {error && <p role="alert" className="mt-1 text-[15px] text-bad">{error}</p>}
    </div>
  );
}

// ---- แถว ----

type DetailForm = Pick<RoundRow, "co_teacher_id" | "lab_room_id" | "note">;

const RowItem = memo(function RowItem(props: {
  row: RoundRow;
  editable: boolean;
  selected: boolean;
  onSelect: (ids: number[], on: boolean) => void;
  kit: Kit;
  save: (id: number, patch: RowPatch) => Promise<string | null>;
  /** บอกชื่อหลักสูตรของแถวใต้ชื่อห้อง (การ์ดที่รวมหลายหลักสูตร และชื่อหลักสูตรไม่ใช่ชื่อห้องเดียวกัน) */
  curriculum: boolean;
}) {
  const { row, kit, editable } = props;
  // ค่าที่กดแล้วแต่ยังบันทึกไม่สำเร็จ (ครู · คาบคู่) — คงอยู่บนจอพร้อมข้อความ ไม่ถูกแทนด้วยค่าจากเซิร์ฟเวอร์เงียบ ๆ
  // แต่ใช้ได้เฉพาะขณะที่แถวบนเซิร์ฟเวอร์ยังเป็นสถานะเดิม (settlePending) — ยืนยัน/ใส่ครูทีละหลายแถวแล้วแถวเปลี่ยน
  // จอต้องแสดงครูที่เซิร์ฟเวอร์ยืนยันจริง ไม่ใช่ครูที่ค้างคู่กับ "ยืนยันแล้ว"
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [detail, setDetail] = useState<DetailForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const detailId = useId();
  // ปรับตามแถวใหม่ระหว่างวาด (ไม่ใช่ effect) — ไม่มีสักเฟรมที่จอแสดงครูที่ค้างคู่กับสถานะของแถวใหม่
  const live = settlePending(pending, row);
  if (live !== pending) {
    setPending(live);
    // ข้อความผิดพลาดเป็นของค่าที่ค้างซึ่งหมดอายุแล้ว · ฟอร์มรายละเอียดที่เปิดอยู่เก็บข้อความของมันไว้
    if (!detail) setError(null);
  }

  // auto = ครู/คาบคู่ (บันทึกทันทีที่เปลี่ยน) · detail = ฟอร์มรายละเอียด · confirm = ปุ่มยืนยัน (ไม่แตะค่าที่ค้างอยู่)
  const commit = async (fields: Partial<RoundRow>, from: "auto" | "detail" | "confirm") => {
    if (busy.current) return;
    if (from === "auto") setPending((p) => holdPending(p, row, fields as AutoFields));
    const patch = rowPatch(row, fields);
    const finish = () => {
      setError(null);
      if (from === "auto") {
        setPending((p) => releasePending(p, Object.keys(fields) as (keyof AutoFields)[]));
      } else if (from === "detail") {
        setDetail(null);
      }
    };
    if (Object.keys(patch).length === 0) {
      finish();
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    const err = await props.save(row.id, patch);
    busy.current = false;
    setSaving(false);
    if (err) setError(err);
    else finish();
  };
  const discard = () => {
    setPending(null);
    setDetail(null);
    setError(null);
  };

  const { teacher_id: teacherId, is_double: isDouble } = shownFields(row, live);
  const hasPending = live !== null;
  // อ่านอย่างเดียวแต่มีค่าที่ค้างจากการบันทึกที่ถูกปฏิเสธ → ยังแสดงตัวแก้ (ปิดไว้) ให้เห็นว่าค่าไหนไม่ได้บันทึก
  const showEditors = editable || hasPending || detail !== null;
  const state = rowState(row);
  const lock = !editable || saving;
  const openDetail = () => setDetail({ co_teacher_id: row.co_teacher_id, lab_room_id: row.lab_room_id, note: row.note });
  const coText = row.co_teacher_id !== null ? teacherText(row.co_teacher_id, kit) : null;
  const labText = row.lab_room_id !== null ? roomText(row.lab_room_id, kit) : null;
  const editButton = editable && !detail && (
    <Button size="sm" variant="ghost" onClick={openDetail} aria-label={`แก้ครูสอนร่วม ห้องปฏิบัติการ และหมายเหตุ ของ ${row.group_name}`}>
      แก้
    </Button>
  );
  const doubleBox = (
    <input type="checkbox" checked={isDouble} disabled={lock} aria-label={`คาบคู่ ${row.group_name}`}
      onChange={(e) => void commit({ is_double: e.target.checked }, "auto")} />
  );

  return (
    <li
      data-testid={`row-${row.id}`}
      data-state={state}
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5 md:grid-cols-[1.5rem_5.5rem_minmax(0,1.35fr)_minmax(0,1fr)_2.75rem_minmax(0,1fr)_8.5rem] ${
        state === "done" ? "" : "bg-warn-faint"
      }`}
    >
      <div className="col-start-1 row-start-1 flex">
        {editable ? (
          <input type="checkbox" checked={props.selected} aria-label={`เลือก ${row.group_name}`}
            onChange={(e) => props.onSelect([row.id], e.target.checked)} />
        ) : (
          <span aria-hidden className="w-[1.05rem]" />
        )}
      </div>
      <div className="col-start-2 row-start-1 min-w-0">
        <div className="font-semibold">{row.group_name}</div>
        {props.curriculum && <div className="break-words text-xs text-muted">หลักสูตร {row.curriculum_name}</div>}
      </div>
      <div className="col-start-3 row-start-1 flex flex-wrap items-center justify-end gap-2 justify-self-end md:col-start-7 md:flex-col md:items-end md:gap-1">
        <RowStatus row={row} canConfirm={editable && !(live && "teacher_id" in live.values)} saving={saving}
          onConfirm={() => void commit({ confirmed: true }, "confirm")} />
      </div>

      <div className="col-span-3 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
        {showEditors ? (
          <TeacherSelect value={teacherId} kit={kit} disabled={lock || !kit.teachersReady} empty="— ยังไม่มีครู —"
            label={`ครูผู้สอน ${row.group_name}`} testId="teacher" onChange={(v) => void commit({ teacher_id: v }, "auto")} />
        ) : (
          <span className="break-words" data-testid="teacher-text">{row.teacher_id !== null ? teacherText(row.teacher_id, kit) : "—"}</span>
        )}
      </div>

      {/* จอกว้าง: คอลัมน์ของตาราง */}
      <div className="hidden min-w-0 break-words md:col-start-4 md:row-start-1 md:block">{coText ?? <span className="text-muted">—</span>}</div>
      <div className="hidden md:col-start-5 md:row-start-1 md:flex md:justify-center">
        {showEditors ? doubleBox : row.is_double ? <span aria-label="คาบคู่">✓</span> : <span className="text-muted">—</span>}
      </div>
      <div className="hidden min-w-0 items-center justify-between gap-2 md:col-start-6 md:row-start-1 md:flex">
        <div className="min-w-0 break-words">
          {labText && <div>{labText}</div>}
          {row.note && <div className="text-[15px] text-muted">{row.note}</div>}
          {!labText && !row.note && <span className="text-muted">—</span>}
        </div>
        {editButton}
      </div>

      {/* จอแคบ: แถวเป็นการ์ดซ้อน — รายละเอียดรวมเป็นบรรทัดเดียว */}
      <div className="col-span-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-muted md:hidden">
        {coText && <span className="break-words">ครูสอนร่วม {coText}</span>}
        {labText && <span className="break-words">ห้องปฏิบัติการ {labText}</span>}
        {row.note && <span className="break-words">หมายเหตุ: {row.note}</span>}
        {showEditors ? (
          <label className="flex items-center gap-1.5">{doubleBox}คาบคู่</label>
        ) : (
          row.is_double && <span>คาบคู่</span>
        )}
        {editButton}
      </div>

      {detail && (
        <form
          className="col-span-3 rounded-xl border border-line bg-surface p-3 md:col-span-7"
          aria-label={`รายละเอียดของ ${row.group_name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void commit(detail, "detail");
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${detailId}-co`} className="text-sm text-muted">ครูสอนร่วม</label>
              <TeacherSelect id={`${detailId}-co`} value={detail.co_teacher_id} kit={kit} disabled={lock || !kit.teachersReady}
                empty="— ไม่มีครูสอนร่วม —" onChange={(v) => setDetail((d) => d && { ...d, co_teacher_id: v })} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${detailId}-lab`} className="text-sm text-muted">ห้องปฏิบัติการ</label>
              <RoomSelect id={`${detailId}-lab`} value={detail.lab_room_id} kit={kit} disabled={lock || !kit.roomsReady}
                empty="— ไม่ใช้ห้องปฏิบัติการ —" onChange={(v) => setDetail((d) => d && { ...d, lab_room_id: v })} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${detailId}-note`} className="text-sm text-muted">หมายเหตุ</label>
              <input id={`${detailId}-note`} className="input w-full" value={detail.note} disabled={lock}
                onChange={(e) => {
                  const note = e.target.value;
                  setDetail((d) => d && { ...d, note });
                }} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={lock}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
            <Button size="sm" onClick={discard} disabled={saving}>{editable ? "ยกเลิก" : "ทิ้งค่าที่ยังไม่ได้บันทึก"}</Button>
          </div>
        </form>
      )}

      {error && (
        <div role="alert" className="col-span-3 flex flex-wrap items-center gap-2 text-[15px] text-bad md:col-span-7" data-testid="row-error">
          <span className="min-w-0 break-words">บันทึกไม่สำเร็จ: {error}</span>
          {hasPending && (
            <>
              {editable && (
                <Button size="sm" onClick={() => live && void commit(live.values, "auto")} disabled={saving}>ลองบันทึกอีกครั้ง</Button>
              )}
              <Button size="sm" onClick={discard} disabled={saving}>คืนค่าเดิม</Button>
            </>
          )}
        </div>
      )}
    </li>
  );
});

function RowStatus(props: { row: RoundRow; canConfirm: boolean; saving: boolean; onConfirm: () => void }) {
  const { row } = props;
  const state = rowState(row);
  if (state === "done") {
    return <span className="whitespace-nowrap font-medium text-ok" data-testid="row-status">✓ ยืนยันแล้ว</span>;
  }
  if (state === "missing") return <Chip tone="warn" data-testid="row-status">ยังไม่มีครู</Chip>;
  return (
    <>
      {/* ครูที่ระบบใส่ให้จากแผนเทอมก่อน ยังไม่มีใครยืนยัน · แก้ช่องอื่นแล้ว (from_plan หลุด) ก็ยังไม่ยืนยันจนกว่าจะกด */}
      <Chip tone="warn" data-testid="row-status">{row.from_plan ? "จากเทอมก่อน" : "ยังไม่ยืนยัน"}</Chip>
      {props.canConfirm && (
        <Button size="sm" onClick={props.onConfirm} disabled={props.saving} data-testid="confirm-row"
          aria-label={`ยืนยัน ${row.group_name}`} className="text-brand">
          ยืนยัน
        </Button>
      )}
    </>
  );
}

// ---- ตัวเลือกครู/ห้อง ----

function TeacherOptions(props: { choices: TeacherChoice[] }) {
  const own = props.choices.filter((c) => c.own);
  const other = props.choices.filter((c) => !c.own);
  return (
    <>
      {own.length > 0 && (
        <optgroup label="ครูในกลุ่มสาระนี้">
          {own.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )}
      {other.length > 0 && (
        <optgroup label="ครูกลุ่มสาระอื่น">
          {other.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )}
    </>
  );
}

// ครูที่ไม่ปฏิบัติงานแล้วยังแสดงชื่อในแถวของตัวเอง (ไม่กลายเป็นช่องว่าง) แต่ไม่อยู่ในตัวเลือกใหม่ (Review Focus 3)
function teacherText(id: number, kit: Kit): string {
  if (!kit.teachersReady) return `ครูรหัส ${id}`;
  const kind = kit.teacherKind(id);
  if (kind === "inactive") return `${kit.name(id)} (ไม่ปฏิบัติงานแล้ว)`;
  if (kind === "unknown") return `ครูรหัส ${id} (ไม่มีในทะเบียน)`;
  return kit.name(id);
}

function roomText(id: number, kit: Kit): string {
  if (!kit.roomsReady) return `ห้องรหัส ${id}`;
  return kit.rooms.get(id) ?? `ห้องที่ไม่มีแล้ว (รหัส ${id})`;
}

function TeacherSelect(props: {
  id?: string;
  value: number | null;
  kit: Kit;
  disabled: boolean;
  empty: string;
  label?: string;
  testId?: string;
  autoFocus?: boolean;
  onChange: (value: number | null) => void;
}) {
  const { value, kit } = props;
  // ค่าปัจจุบันที่ไม่อยู่ในตัวเลือก (ไม่ปฏิบัติงานแล้ว · ทะเบียนยังไม่มา) → ตัวเลือกที่กดไม่ได้ ให้ช่องยังบอกชื่อเดิม
  const extra = value !== null && (!kit.teachersReady || kit.teacherKind(value) !== "active");
  return (
    <select
      id={props.id}
      className="input w-full"
      value={value ?? ""}
      disabled={props.disabled}
      aria-label={props.label}
      data-testid={props.testId}
      autoFocus={props.autoFocus}
      onChange={(e) => props.onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      <option value="">{props.empty}</option>
      {extra && <option value={value} disabled>{teacherText(value, kit)}</option>}
      {kit.teacherOptions}
    </select>
  );
}

function RoomSelect(props: {
  id?: string;
  value: number | null;
  kit: Kit;
  disabled: boolean;
  empty: string;
  label?: string;
  onChange: (value: number | null) => void;
}) {
  const { value, kit } = props;
  const extra = value !== null && (!kit.roomsReady || !kit.rooms.has(value));
  return (
    <select
      id={props.id}
      className="input w-full"
      value={value ?? ""}
      disabled={props.disabled}
      aria-label={props.label}
      onChange={(e) => props.onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      <option value="">{props.empty}</option>
      {extra && <option value={value} disabled>{roomText(value, kit)}</option>}
      {kit.roomOptions}
    </select>
  );
}

// ---- คาบเสรี / กิจกรรม ----

function OptionCard(props: {
  option: RoundOption;
  editable: boolean;
  kit: Kit;
  onAdd: (optionId: number, teacherId: number) => Promise<string | null>;
  onSave: (ot: OptionTeacher, patch: OptionTeacherPatch) => Promise<string | null>;
  onRemove: (ot: OptionTeacher) => Promise<string | null>;
}) {
  const o = props.option;
  const state = optionState(o);
  const [adding, setAdding] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (adding === null) {
      setError("เลือกครูที่จะเพิ่มก่อน");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await props.onAdd(o.id, adding);
    setBusy(false);
    if (err) setError(err);
    else setAdding(null);
  };
  return (
    <Card as="section" pad={false} aria-label={`${o.code} ${o.name}`} data-testid={`option-${o.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h4 className="break-words text-lg font-semibold leading-snug">{o.code} {o.name}</h4>
          <p className="text-[15px] text-muted">
            {SET_KIND_TEXT[o.set.kind]} “{o.set.name}” · ห้อง {roomRange(o.set.group_names)} · {fmt(o.set.weekly)} คาบ/สัปดาห์
          </p>
        </div>
        <Chip tone={state === "done" ? "ok" : "warn"} data-testid="option-status">
          {state === "done" ? "ยืนยันครบ" : state === "missing" ? "ยังไม่มีครู" : "ยังไม่ยืนยัน"}
        </Chip>
      </div>
      {o.teachers.length > 0 ? (
        <ul className="divide-y divide-line2 border-t border-line2">
          {o.teachers.map((t) => (
            <OptionTeacherItem key={t.id} ot={t} editable={props.editable} kit={props.kit} onSave={props.onSave}
              onRemove={props.onRemove} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-line2 bg-warn-faint px-4 py-3 text-[15px] text-muted sm:px-5">
          ยังไม่มีครูในตัวเลือกนี้{props.editable && " — เพิ่มครูด้านล่าง"}
        </p>
      )}
      {props.editable && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2 border-t border-line2 px-4 py-3 sm:px-5"
          aria-label={`เพิ่มครูให้ ${o.code} ${o.name}`}>
          <div className="min-w-0 flex-1 basis-56">
            <TeacherSelect value={adding} kit={props.kit} disabled={busy || !props.kit.teachersReady} empty="— เลือกครูที่จะเพิ่ม —"
              label={`ครูที่จะเพิ่มให้ ${o.code}`} onChange={setAdding} />
          </div>
          <Button type="submit" size="sm" disabled={busy}>{busy ? "กำลังบันทึก..." : "เพิ่มครู"}</Button>
        </form>
      )}
      {error && <p role="alert" className="px-4 pb-3 text-[15px] text-bad sm:px-5">{error}</p>}
    </Card>
  );
}

function OptionTeacherItem(props: {
  ot: OptionTeacher;
  editable: boolean;
  kit: Kit;
  onSave: (ot: OptionTeacher, patch: OptionTeacherPatch) => Promise<string | null>;
  onRemove: (ot: OptionTeacher) => Promise<string | null>;
}) {
  const { ot, kit, editable } = props;
  const [form, setForm] = useState<Pick<OptionTeacher, "room_id" | "note"> | null>(null);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const done = ot.teacher_id !== null && ot.confirmed;
  const who = ot.teacher_id !== null ? teacherText(ot.teacher_id, kit) : "—";

  const run = async (job: () => Promise<string | null>, after: () => void) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const err = await job();
    setSaving(false);
    if (err) setError(err);
    else after();
  };
  const save = (fields: Partial<OptionTeacher>, after: () => void) => {
    const patch = optionTeacherPatch(ot, fields);
    if (Object.keys(patch).length === 0) {
      after();
      return;
    }
    void run(() => props.onSave(ot, patch), after);
  };

  return (
    <li className={`px-4 py-3 sm:px-5 ${done ? "" : "bg-warn-faint"}`} data-testid={`option-teacher-${ot.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="break-words font-medium">{who}</div>
          <div className="text-[15px] text-muted">
            {ot.room_id !== null ? `ห้อง ${roomText(ot.room_id, kit)}` : "ไม่ระบุห้อง"}
            {ot.note && ` · หมายเหตุ: ${ot.note}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {done ? (
            <span className="whitespace-nowrap font-medium text-ok" data-testid="option-teacher-status">✓ ยืนยันแล้ว</span>
          ) : (
            <Chip tone="warn" data-testid="option-teacher-status">{ot.from_plan ? "จากเทอมก่อน" : "ยังไม่ยืนยัน"}</Chip>
          )}
          {editable && !done && ot.teacher_id !== null && (
            <Button size="sm" className="text-brand" disabled={saving} aria-label={`ยืนยัน ${who}`}
              onClick={() => save({ confirmed: true }, () => undefined)}>
              ยืนยัน
            </Button>
          )}
          {editable && !form && !removing && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setForm({ room_id: ot.room_id, note: ot.note })}
                aria-label={`แก้ห้องและหมายเหตุของ ${who}`}>
                แก้
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(true)} aria-label={`เอา ${who} ออก`}>เอาออก</Button>
            </>
          )}
        </div>
      </div>
      {removing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5" role="group"
          aria-label={`ยืนยันเอา ${who} ออก`}>
          <span className="text-[15px]">เอา {who} ออกจากตัวเลือกนี้?</span>
          <Button size="sm" variant="danger" disabled={saving || !editable} onClick={() => void run(() => props.onRemove(ot), () => setRemoving(false))}>
            {saving ? "กำลังบันทึก..." : "เอาออก"}
          </Button>
          <Button size="sm" onClick={() => setRemoving(false)} disabled={saving} autoFocus>ไม่เอาออก</Button>
        </div>
      )}
      {form && (
        <form className="mt-2 rounded-xl border border-line bg-surface p-3" aria-label={`ห้องและหมายเหตุของ ${who}`}
          onSubmit={(e) => {
            e.preventDefault();
            save(form, () => setForm(null));
          }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${formId}-room`} className="text-sm text-muted">ห้อง</label>
              <RoomSelect id={`${formId}-room`} value={form.room_id} kit={kit} disabled={saving || !editable || !kit.roomsReady}
                empty="— ไม่ระบุห้อง —" onChange={(v) => setForm((f) => f && { ...f, room_id: v })} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${formId}-note`} className="text-sm text-muted">หมายเหตุ</label>
              <input id={`${formId}-note`} className="input w-full" value={form.note} disabled={saving || !editable}
                onChange={(e) => {
                  const note = e.target.value;
                  setForm((f) => f && { ...f, note });
                }} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={saving || !editable}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
            <Button size="sm" onClick={() => {
              setForm(null);
              setError(null);
            }} disabled={saving}>
              {editable ? "ยกเลิก" : "ทิ้งค่าที่ยังไม่ได้บันทึก"}
            </Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 break-words text-[15px] text-bad">บันทึกไม่สำเร็จ: {error}</p>}
    </li>
  );
}

// ---- คาบรายครู ----

function LoadsCard(props: {
  mode: Mode;
  loads: TeacherLoad[] | null;
  error: string | null;
  onRetry: () => void;
  keep?: (l: TeacherLoad) => boolean;
  onOpenSummary?: () => void;
}) {
  const bars = props.loads ? loadBars(props.loads, props.mode === "admin" ? "total" : "own", props.keep) : null;
  return (
    <Card as="aside" aria-label="คาบรายครู" data-testid="loads"
      className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <h3 className="text-lg font-semibold">{props.mode === "admin" ? "คาบรายครูที่เกี่ยวกับกลุ่มนี้" : "คาบรายครูของกลุ่ม"}</h3>
      <p className="text-sm text-muted">
        {props.mode === "admin"
          ? "คาบ/สัปดาห์รวมทั้งรอบ · เซิร์ฟเวอร์นับ (คาบเสรีนับครั้งเดียวต่อชุด) · อัปเดตหลังบันทึก"
          : "คาบ/สัปดาห์จากรายการของกลุ่มนี้ · เซิร์ฟเวอร์นับ (คาบเสรีนับครั้งเดียวต่อชุด) · อัปเดตหลังบันทึก"}
      </p>
      {props.error && (
        <div role="alert" className="mt-3 text-[15px] text-bad">
          โหลดยอดคาบไม่ได้: {props.error}{" "}
          <Button size="sm" onClick={props.onRetry}>ลองโหลดใหม่</Button>
        </div>
      )}
      {!bars ? (
        !props.error && <p role="status" className="mt-3 text-muted">กำลังโหลดยอดคาบ...</p>
      ) : bars.length === 0 ? (
        <p className="mt-3 text-muted">ยังไม่มีครูในกลุ่มนี้</p>
      ) : (
        <>
          <ul className="mt-3 space-y-3">
            {bars.map((b) => (
              <li key={b.teacherId} data-testid={`load-${b.teacherId}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words text-[15px]">{b.name}</span>
                  <span className="font-semibold tabular-nums" data-testid="load-value">{fmt(b.value)}</span>
                </div>
                <Progress className="mt-1" value={b.pct} max={100} tone={b.warn ? "warn" : "brand"}
                  label={`${b.name} ${b.value} คาบต่อสัปดาห์`} />
                {b.more !== null && <p className="text-sm text-muted">รวมทุกกลุ่ม {fmt(b.more)} คาบ</p>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">แถบสีส้ม = ยอดรวมทั้งรอบถึงค่ามากสุดของกลุ่ม (ครูที่คาบหนักที่สุด)</p>
        </>
      )}
      {props.onOpenSummary && (
        // ชีตแบบรายวิชาและแบบครูผู้สอนของกลุ่มนี้ (แทนชีต Excel เดิม) — พิมพ์ได้
        <div className="mt-3 border-t border-line2 pt-3">
          <button type="button" className="font-medium text-brand hover:underline" onClick={props.onOpenSummary}
            data-testid="open-summary">
            ดูทั้งหมด · พิมพ์
          </button>
          <p className="text-sm text-muted">สรุปอัตรากำลังแบบรายวิชาและแบบครูผู้สอนของกลุ่มนี้</p>
        </div>
      )}
    </Card>
  );
}
