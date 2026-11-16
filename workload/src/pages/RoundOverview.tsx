import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AxiosError } from "axios";
import { apiErrorText } from "../api";
import { departmentName, thaiDateTime } from "../curriculum";
import {
  checkReturnNote, deptProgress, deptStatusLabel, deptStatusTone, reviewActions, ROUND_STATUS_TEXT, roundStats,
  roundStatusTone, type DeptStatus, type Round, type Unconverted,
} from "../round";
import { approveDept, getRound, listDeptStatuses, returnDept } from "../roundApi";
import type { Department } from "../types";
import { Button, Card, Chip, Notice, Progress, StatTile } from "../ui";

// ภาพรวมของรอบหนึ่งรอบ (แบบข้อ 4.3 · ภาพ mockup-admin.png): หัวข้อ · ตัวเลขสี่ช่อง · การ์ดกลุ่มสาระละใบพร้อมตรวจผ่าน/ตีกลับ
// ปุ่มของรอบเอง (เปิดให้กรอก ยกเลิก ปิดรอบ) เป็นของหน้ารอบ (RoundsPage) ส่งเข้ามาทาง actions/children — ที่นี่ดูแลแค่กลุ่ม
// รอบที่ปิดแล้วเปิดดูได้ด้วยคอมโพเนนต์เดียวกัน ปุ่มตรวจ/ตีกลับไม่ขึ้นเอง (reviewActions)

const fmt = (n: number): string => n.toLocaleString("th-TH");
const when = (iso: string | null): string | null => (iso ? (thaiDateTime(iso) ?? iso) : null);
const statusOf = (err: unknown): number => (err as AxiosError | undefined)?.response?.status ?? 0;

export default function RoundOverview(props: {
  round: Round;
  departments: readonly Department[];
  departmentsLoaded: boolean;
  /** "เปิดดู" ของการ์ดกลุ่ม → หน้าแถวของกลุ่ม (หน้าเดียวกับของหัวหน้า ในโหมดของ admin) */
  onOpenDepartment: (departmentId: number) => void;
  /** ปุ่มของรอบที่หัวข้อ (หน้ารอบเป็นเจ้าของ) */
  actions?: ReactNode;
  /** แถบเตือน/กล่องยืนยันของรอบ ใต้หัวข้อ */
  children?: ReactNode;
  /** การตรวจ/ตีกลับได้ 409/404 = มีคนเปลี่ยนสถานะไปแล้ว (อีกแท็บ) → หน้ารอบโหลดรายการรอบใหม่ */
  onConflict?: () => void;
}) {
  const { round } = props;
  const [statuses, setStatuses] = useState<{ list: DeptStatus[] | null; error: string | null }>({ list: null, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    listDeptStatuses(round.id).then(
      (list) => {
        if (!cancelled) setStatuses({ list, error: null });
      },
      (err) => {
        // โหลดซ้ำไม่ได้ → เก็บตัวเลขเดิมไว้บนจอพร้อมข้อความ (ไม่ทำให้การ์ดหายทั้งหน้า)
        if (!cancelled) setStatuses((s) => ({ list: s.list, error: apiErrorText(err) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [round.id, round.status, tick]);

  // ---- ตรวจผ่าน/ตีกลับ: ทีละอย่าง · ข้อผิดพลาดอยู่บนการ์ดของกลุ่มนั้น ----
  const busy = useRef(false);
  const [working, setWorking] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [returning, setReturning] = useState<number | null>(null);

  const review = async (dept: number, job: () => Promise<DeptStatus>): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setWorking(dept);
    setErrors((e) => ({ ...e, [dept]: "" }));
    try {
      const updated = await job();
      setStatuses((s) => ({ ...s, list: s.list?.map((d) => (d.department_id === dept ? updated : d)) ?? null }));
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [dept]: apiErrorText(err) }));
      // อีกแท็บตรวจ/ตีกลับ/ปิดรอบไปก่อน — ข้อความไทยของเซิร์ฟเวอร์บอกเหตุ แล้วโหลดสถานะจริงมาแทนของบนจอ
      if (statusOf(err) === 409 || statusOf(err) === 404) {
        reload();
        props.onConflict?.();
      }
      return false;
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  const list = statuses.list;
  const stats = list ? roundStats(round, list) : null;
  const opened = when(round.opened_at);
  const closed = when(round.closed_at);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-title text-ink">รอบอัตรากำลัง ภาคเรียน {round.label}</h2>
            <Chip tone={roundStatusTone(round.status)} dot={round.status !== "closed"} data-testid="round-status">
              {ROUND_STATUS_TEXT[round.status]}
            </Chip>
          </div>
          <p className="mt-1 text-muted" data-testid="round-summary">
            {opened && <>เปิดรอบเมื่อ {opened} · </>}
            แถววิชาจากหลักสูตร {fmt(round.counts.rows)} แถว
            {round.counts.options > 0 && <> · ตัวเลือกคาบเสรี/กิจกรรม {fmt(round.counts.options)} ตัวเลือก</>}
            {closed && <> · ปิดรอบเมื่อ {closed}</>}
          </p>
          {round.status === "closed" && (
            <p className="mt-1 text-sm text-muted">รอบนี้ปิดแล้ว อ่านอย่างเดียว — เก็บไว้เป็นหลักฐานย้อนหลัง</p>
          )}
        </div>
        {props.actions && <div className="flex flex-wrap gap-2">{props.actions}</div>}
      </div>

      {props.children}

      {round.counts.unconverted > 0 && <UnconvertedList roundId={round.id} count={round.counts.unconverted} />}

      {statuses.error && (
        <Notice tone="bad" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>โหลดสถานะของกลุ่มสาระไม่ได้: {statuses.error}</span>
          <Button size="sm" onClick={reload}>ลองโหลดใหม่</Button>
        </Notice>
      )}

      {list === null ? (
        !statuses.error && <p role="status" className="text-muted">กำลังโหลดสถานะของกลุ่มสาระ...</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <div data-testid="stat-rows">
              <StatTile label="แถววิชาทั้งหมด" value={stats!.rows}
                suffix={stats!.options > 0 ? `แถว · ตัวเลือก ${fmt(stats!.options)}` : "แถว"} />
            </div>
            <div data-testid="stat-submitted">
              <StatTile label="กลุ่มที่ส่งแล้ว" value={stats!.submitted} suffix={`จาก ${fmt(stats!.departments)} กลุ่ม`} />
            </div>
            <div data-testid="stat-approved">
              <StatTile label="ตรวจผ่านแล้ว" value={stats!.approved} suffix="กลุ่ม" />
            </div>
            <div data-testid="stat-unconfirmed">
              <StatTile label="ยังไม่ยืนยัน" value={stats!.unconfirmed}
                suffix={stats!.missingTeacher > 0 ? `รายการ · ยังไม่มีครู ${fmt(stats!.missingTeacher)}` : "รายการ"} />
            </div>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="กลุ่มสาระ">
            {list.map((d) => (
              <li key={d.department_id} className="min-w-0">
                <DeptCard
                  round={round}
                  dept={d}
                  name={departmentName(d.department_id, props.departments, props.departmentsLoaded)}
                  disabled={working !== null}
                  working={working === d.department_id}
                  error={errors[d.department_id] || null}
                  returning={returning === d.department_id}
                  onApprove={() => void review(d.department_id, () => approveDept(round.id, d.department_id))}
                  onAskReturn={() => setReturning(d.department_id)}
                  onCancelReturn={() => setReturning(null)}
                  onReturn={async (note) => {
                    if (await review(d.department_id, () => returnDept(round.id, d.department_id, note))) setReturning(null);
                  }}
                  onOpen={() => props.onOpenDepartment(d.department_id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DeptCard(props: {
  round: Round;
  dept: DeptStatus;
  name: string;
  disabled: boolean;
  working: boolean;
  error: string | null;
  returning: boolean;
  onApprove: () => void;
  onAskReturn: () => void;
  onCancelReturn: () => void;
  onReturn: (note: string) => Promise<void>;
  onOpen: () => void;
}) {
  const { dept: d } = props;
  const progress = deptProgress(d);
  const acts = reviewActions(props.round.status, d.status);
  const submitted = when(d.submitted_at);
  const reviewed = when(d.reviewed_at);
  // เวลาที่บอกบนการ์ดตามสถานะ: ส่งเมื่อ (รอตรวจ) · ตรวจผ่านเมื่อ · ตีกลับเมื่อ — "ใคร" = ชื่อเรียกของรหัสที่ใช้
  const stamp =
    d.status === "submitted" && submitted
      ? `ส่งเมื่อ ${submitted}${d.submitted_by ? ` โดย ${d.submitted_by}` : ""}`
      : d.status === "approved" && reviewed
        ? `ตรวจผ่านเมื่อ ${reviewed}${d.reviewed_by ? ` โดย ${d.reviewed_by}` : ""}`
        : d.status === "returned" && reviewed
          ? `ตีกลับเมื่อ ${reviewed}${d.reviewed_by ? ` โดย ${d.reviewed_by}` : ""}`
          : null;

  return (
    <Card as="article" aria-label={props.name} data-testid={`dept-${d.department_id}`} className="h-full">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-lg font-semibold">{props.name}</h3>
        <Chip tone={deptStatusTone(d)} dot={d.status === "filling" && d.confirmed > 0} data-testid="dept-status">
          {deptStatusLabel(d)}
        </Chip>
      </div>
      <p className="mt-1 text-[15px] text-muted" data-testid="dept-progress">{progress.text}</p>
      {stamp && <p className="text-sm text-muted">{stamp}</p>}
      {/* หมายเหตุตีกลับครั้งล่าสุด: ตอนถูกตีกลับเป็นสีแดง · ส่งใหม่แล้วยังเห็นว่าครั้งก่อนตีกลับเรื่องอะไร (ไว้ตรวจว่าแก้แล้ว) */}
      {d.note && d.status === "returned" && (
        <p className="mt-1 break-words text-[15px] text-bad" data-testid="dept-note">หมายเหตุที่ตีกลับ: “{d.note}”</p>
      )}
      {d.note && d.status !== "returned" && (
        <p className="mt-1 break-words text-sm text-muted">ตีกลับครั้งก่อน: “{d.note}”</p>
      )}
      <Progress
        className="mt-3"
        value={d.confirmed}
        max={d.rows}
        tone={d.status === "approved" ? "ok" : "brand"}
        label={`${props.name}: ยืนยันแล้ว ${fmt(d.confirmed)} จาก ${fmt(d.rows)} รายการ`}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {acts.approve && (
          <Button variant="primary" disabled={props.disabled} onClick={props.onApprove}>
            {props.working && !props.returning ? "กำลังบันทึก..." : "ตรวจผ่าน"}
          </Button>
        )}
        {acts.return && !props.returning && (
          <Button disabled={props.disabled} onClick={props.onAskReturn}>ตีกลับ</Button>
        )}
        <Button onClick={props.onOpen} aria-label={`เปิดดูแถวของ${props.name}`}>เปิดดู</Button>
      </div>
      {props.returning && acts.return && (
        <ReturnForm name={props.name} busy={props.working} disabled={props.disabled} onCancel={props.onCancelReturn}
          onSubmit={props.onReturn} />
      )}
      {props.error && <p role="alert" className="mt-3 text-[15px] text-bad">{props.error}</p>}
    </Card>
  );
}

function ReturnForm(props: {
  name: string;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = checkReturnNote(note);
    setError(problem);
    if (!problem) void props.onSubmit(note.trim());
  };
  return (
    <form onSubmit={submit} className="mt-4 space-y-2 rounded-xl border border-line bg-bg p-3" aria-label={`ตีกลับ ${props.name}`}>
      <label htmlFor={id} className="block text-sm text-muted">
        หมายเหตุถึง{props.name} — บอกว่าต้องแก้อะไร (หัวหน้ากลุ่มสาระเห็นข้อความนี้)
      </label>
      <textarea
        id={id}
        rows={3}
        autoFocus
        className="input w-full"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          if (error) setError(null);
        }}
        aria-invalid={error ? true : undefined}
      />
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={props.disabled}>
          {props.busy ? "กำลังบันทึก..." : "ยืนยันตีกลับ"}
        </Button>
        <Button onClick={props.onCancel} disabled={props.busy}>ยกเลิก</Button>
      </div>
    </form>
  );
}

/** แผนการสอนเทอมก่อนที่แปลงไม่ได้ ณ ตอนเปิดรอบ — โหลดเมื่อกดเปิดดู (มีแค่ใน GET /rounds/{id}) */
function UnconvertedList(props: { roundId: number; count: number }) {
  const [items, setItems] = useState<Unconverted[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);
  const load = () => {
    if (items || loading.current) return;
    loading.current = true;
    setError(null);
    getRound(props.roundId).then(
      (r) => setItems(r.unconverted),
      (err) => setError(apiErrorText(err)),
    ).finally(() => {
      loading.current = false;
    });
  };
  return (
    <details className="mb-5 rounded-card border border-line bg-surface px-4 py-3 sm:px-5" onToggle={(e) => {
      if ((e.target as HTMLDetailsElement).open) load();
    }}>
      <summary className="cursor-pointer font-medium text-warn">
        แผนการสอนเทอมก่อนที่แปลงเป็นครูของแถวไม่ได้ {fmt(props.count)} รายการ — แถวเหล่านั้นหัวหน้ากลุ่มสาระเลือกครูเอง
      </summary>
      {error && <p role="alert" className="mt-2 text-bad">{error}</p>}
      {!items && !error && <p className="mt-2 text-muted" role="status">กำลังโหลด...</p>}
      {items && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {items.map((u, i) => <li key={i}>{u.reason}</li>)}
        </ul>
      )}
    </details>
  );
}
