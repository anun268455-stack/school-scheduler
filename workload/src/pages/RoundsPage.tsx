import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { AxiosError } from "axios";
import { apiErrorText, listDepartments } from "../api";
import { guessTerm, thaiDateTime, type CurriculumTerm } from "../curriculum";
import { listTerms } from "../curriculumApi";
import {
  checkCloseLabel, checkRoundForm, closedRounds, currentRound, defaultOpenTerm, openBlocker, previewLines, previewWarnings,
  roundActions, roundLabel, termReadiness, type Round, type RoundPreview, type Term,
} from "../round";
import { cancelRound, closeRound, createRound, listRounds, openRound, previewRound } from "../roundApi";
import { Button, Card, Notice } from "../ui";
import { useRegistryList } from "../useRegistryList";
import { Field, inputClass } from "./registryParts";
import RoundOverview, { ExportChip } from "./RoundOverview";

// หน้ารอบอัตรากำลังของผู้ดูแลระบบ (แบบข้อ 4.3): ยังไม่มีรอบ → ดูก่อนเปิด → เปิดรอบ (เตรียม) → เปิดให้กลุ่มสาระกรอก
// → ภาพรวม ตรวจผ่าน/ตีกลับ → ปิดรอบ · รอบที่ปิดแล้วอยู่ในรายการรอบเก่า เปิดดูได้อ่านอย่างเดียว
// ทุกปุ่มที่เขียนกดได้ทีละอย่าง · 409/404 (อีกแท็บเปลี่ยนรอบไปแล้ว) → ข้อความไทยของเซิร์ฟเวอร์ แล้วโหลดรายการรอบใหม่

const fmt = (n: number): string => n.toLocaleString("th-TH");
const statusOf = (err: unknown): number => (err as AxiosError | undefined)?.response?.status ?? 0;
const isConflict = (err: unknown): boolean => statusOf(err) === 409 || statusOf(err) === 404;

type Flash = { tone: "ok" | "bad"; text: string } | null;

export default function RoundsPage(props: {
  /** "เปิดดู" ของการ์ดกลุ่ม → หน้าแถวของกลุ่มในโหมดของ admin (งานที่ 8) */
  onOpenDepartment: (round: Round, departmentId: number) => void;
  /** ลิงก์ไปหน้าหลักสูตรของภาคเรียน (ยังไม่มีหลักสูตร · บรรทัดที่ยังไม่มีกลุ่มสาระ) */
  onOpenCurriculum: (term: Term) => void;
  /** แจ้ง App ทุกครั้งที่โหลดรายการรอบได้ — ชิปรอบบนแถบบนจะได้ตรงกับหน้านี้ */
  onRounds?: (rounds: Round[]) => void;
  /** เปิดหน้ามาที่รอบเก่ารอบนี้ (กลับมาจากหน้าแถวของกลุ่มของรอบที่ปิดแล้ว) */
  focusRoundId?: number | null;
}) {
  const [rounds, setRounds] = useState<{ list: Round[] | null; error: string | null }>({ list: null, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const onRounds = useRef(props.onRounds);
  onRounds.current = props.onRounds;

  useEffect(() => {
    let cancelled = false;
    listRounds().then(
      (list) => {
        if (cancelled) return;
        setRounds({ list, error: null });
        onRounds.current?.(list);
      },
      (err) => {
        if (!cancelled) setRounds((s) => ({ list: s.list, error: apiErrorText(err) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // ภาคเรียนที่มีหลักสูตร (ฟอร์มเปิดรอบ) · null = ยังไม่มา · โหลดไม่ได้ = ไม่ขวาง ให้เซิร์ฟเวอร์ตัดสินตอนดูก่อนเปิด
  const [terms, setTerms] = useState<{ list: CurriculumTerm[] | null; done: boolean }>({ list: null, done: false });
  useEffect(() => {
    let cancelled = false;
    listTerms().then(
      (list) => {
        if (!cancelled) setTerms({ list, done: true });
      },
      () => {
        if (!cancelled) setTerms({ list: null, done: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const depts = useRegistryList(listDepartments);
  const [viewId, setViewId] = useState<number | null>(props.focusRoundId ?? null);
  const [flash, setFlash] = useState<Flash>(null);

  // ---- งานเขียนของรอบ: ทีละอย่าง ----
  // ข้อความผล: สำเร็จ และ 409/404 (มุมมองจะเปลี่ยนหลังโหลดใหม่ — กล่อง/ฟอร์มที่กดอาจหายไป) ขึ้นบนสุดของหน้าซึ่งอยู่ตลอด
  // ข้อผิดพลาดอื่นขึ้นข้างปุ่มที่กด (onError) เพราะหน้าตาไม่เปลี่ยน
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const run = useCallback(
    async (job: () => Promise<string>, onError?: (message: string) => void): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setWorking(true);
      setFlash(null);
      try {
        const done = await job();
        setFlash({ tone: "ok", text: done });
        reload();
        return true;
      } catch (err) {
        const message = apiErrorText(err);
        if (isConflict(err) || !onError) {
          setFlash({ tone: "bad", text: message });
          if (isConflict(err)) reload();
        } else {
          onError(message);
        }
        return false;
      } finally {
        busy.current = false;
        setWorking(false);
      }
    },
    [reload],
  );
  // ข้อความผลอยู่บนสุดของหน้า — จอโทรศัพท์ที่เลื่อนลงมากดปุ่มต้องเห็นมัน
  const flashRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash) flashRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [flash]);
  const [closingId, setClosingId] = useState<number | null>(null);

  const list = rounds.list;
  if (list === null) {
    return rounds.error ? (
      <div className="space-y-3">
        <h2 className="text-title text-ink">รอบอัตรากำลัง</h2>
        <Notice tone="bad" role="alert">โหลดรายการรอบไม่ได้: {rounds.error}</Notice>
        <Button onClick={reload}>ลองโหลดใหม่</Button>
      </div>
    ) : (
      <p role="status" className="text-muted">กำลังโหลดรอบอัตรากำลัง...</p>
    );
  }

  const current = currentRound(list);
  const old = closedRounds(list);
  const viewing = viewId !== null ? (old.find((r) => r.id === viewId) ?? null) : null;
  const shown = viewing ?? current;

  return (
    <div>
      {flash && (
        <div ref={flashRef} className="mb-4 scroll-mt-4">
          <Notice tone={flash.tone} role={flash.tone === "bad" ? "alert" : "status"} data-testid="round-flash">
            {flash.text}
          </Notice>
        </div>
      )}
      {rounds.error && (
        <Notice tone="bad" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>โหลดรายการรอบใหม่ไม่ได้: {rounds.error} — ที่เห็นอยู่อาจไม่ใช่สถานะล่าสุด</span>
          <Button size="sm" onClick={reload}>ลองโหลดใหม่</Button>
        </Notice>
      )}
      {depts.error && (
        <Notice tone="bad" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>โหลดรายชื่อกลุ่มสาระไม่ได้: {depts.error} — ระหว่างนี้การ์ดแสดงเป็นรหัสกลุ่มสาระ</span>
          <Button size="sm" onClick={depts.reload}>ลองโหลดใหม่</Button>
        </Notice>
      )}

      {viewing && (
        <div className="mb-4">
          <Button variant="ghost" onClick={() => setViewId(null)}>
            ← {current ? `กลับไปรอบปัจจุบัน (ภาคเรียน ${current.label})` : "กลับไปหน้าเปิดรอบ"}
          </Button>
        </div>
      )}

      {shown ? (
        <RoundOverview
          key={shown.id}
          round={shown}
          departments={depts.rows}
          departmentsLoaded={depts.loaded}
          onOpenDepartment={(dept) => props.onOpenDepartment(shown, dept)}
          onConflict={reload}
          actions={
            <>
              <Button variant="ghost" onClick={() => props.onOpenCurriculum({ year: shown.year, semester: shown.semester })}>
                หลักสูตรของภาคเรียนนี้
              </Button>
              {roundActions(shown.status).close && closingId !== shown.id && (
                <Button onClick={() => setClosingId(shown.id)} disabled={working}>ปิดรอบ</Button>
              )}
            </>
          }
        >
          {shown.status === "preparing" && (
            <PreparingBar round={shown} working={working} run={run} onOpenCurriculum={props.onOpenCurriculum} tick={tick} />
          )}
          {roundActions(shown.status).close && closingId === shown.id && (
            <CloseRoundBox round={shown} working={working} run={run} onCancel={() => setClosingId(null)} />
          )}
        </RoundOverview>
      ) : terms.done ? (
        <OpenRoundCard
          rounds={list}
          terms={terms.list}
          working={working}
          run={run}
          onOpenCurriculum={props.onOpenCurriculum}
        />
      ) : (
        <p role="status" className="text-muted">กำลังโหลดภาคเรียนที่มีหลักสูตร...</p>
      )}

      {old.length > 0 && (
        <section aria-label="รอบเก่า" className="mt-10">
          <h3 className="mb-3 text-lg font-semibold">รอบเก่า (ปิดแล้ว · เปิดดูได้อ่านอย่างเดียว)</h3>
          <Card pad={false}>
            <ul className="divide-y divide-line2">
              {old.map((r) => (
                <li key={r.id} data-testid={`old-round-${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <span className="font-semibold">ภาคเรียน {r.label}</span>
                    <span className="text-muted">
                      {r.closed_at && <> · ปิดรอบเมื่อ {thaiDateTime(r.closed_at) ?? r.closed_at}</>} · {fmt(r.counts.rows)} แถว
                    </span>
                    {r.exported_at && <div className="mt-1"><ExportChip round={r} /></div>}
                  </div>
                  {viewing?.id === r.id ? (
                    <span className="text-sm text-muted">กำลังเปิดดูอยู่</span>
                  ) : (
                    <Button size="sm" onClick={() => setViewId(r.id)} aria-label={`เปิดดูรอบ ${r.label}`}>เปิดดู</Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

type Run = (job: () => Promise<string>, onError?: (message: string) => void) => Promise<boolean>;

// ---- ปิดรอบ (เฉพาะรอบที่เปิดให้กรอก): พิมพ์ชื่อรอบยืนยัน ----

function CloseRoundBox(props: { round: Round; working: boolean; run: Run; onCancel: () => void }) {
  const { round } = props;
  const id = useId();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = checkCloseLabel(typed, round.label);
    setError(problem);
    if (problem) return;
    await props.run(async () => {
      await closeRound(round.id, typed.trim());
      return `ปิดรอบ ${round.label} แล้ว — หัวหน้ากลุ่มสาระแก้ไม่ได้อีก หลักสูตรของภาคเรียนนี้อ่านอย่างเดียว · ดูย้อนหลังได้ที่รายการรอบเก่า`;
    }, setError);
  };
  return (
    <form onSubmit={submit} aria-label={`ปิดรอบ ${round.label}`} data-testid="close-round"
      className="mb-5 max-w-xl space-y-3 rounded-card border border-bad bg-surface p-4 sm:p-5">
      <p className="font-semibold">ปิดรอบ {round.label} ถาวร</p>
      <p className="text-[15px] text-muted">
        ปิดแล้วหัวหน้ากลุ่มสาระแก้ไม่ได้อีก หลักสูตรของภาคเรียนนี้แก้ไม่ได้ตลอดไป และรอบนี้ย้ายไปอยู่ในรายการรอบเก่า (เปิดดูได้อ่านอย่างเดียว)
      </p>
      <Field label={`พิมพ์ ${round.label} เพื่อยืนยัน`} htmlFor={id}>
        <input
          id={id}
          className={inputClass}
          autoFocus
          autoComplete="off"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
        />
      </Field>
      {error && <p role="alert" className="text-[15px] text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={props.working}>
          {props.working ? "กำลังปิดรอบ..." : "ยืนยันปิดรอบ"}
        </Button>
        <Button onClick={props.onCancel} disabled={props.working}>ยกเลิก</Button>
      </div>
    </form>
  );
}

// ---- รอบที่ยังเตรียมอยู่: แถบเตือน · บรรทัดที่ยังไม่มีกลุ่มสาระ · เปิดให้กลุ่มสาระกรอก · ยกเลิกรอบ ----

function PreparingBar(props: { round: Round; working: boolean; run: Run; onOpenCurriculum: (t: Term) => void; tick: number }) {
  const { round } = props;
  const term = { year: round.year, semester: round.semester };
  // จำนวนบรรทัด/ตัวเลือกที่ยังไม่มีกลุ่มสาระ = ตัวเลขเดียวกับที่ POST .../open ตรวจ (ทั้งคู่มาจาก _wl_term_shape ของเซิร์ฟเวอร์)
  // ดึงจาก "ดูก่อนเปิด" ซึ่งไม่เขียนอะไร · กลับมาจากหน้าหลักสูตร (หน้านี้ถูกโหลดใหม่) ตัวเลขก็ใหม่
  const [gaps, setGaps] = useState<{ data: RoundPreview | null; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    previewRound(round.year, round.semester).then(
      (data) => {
        if (!cancelled) setGaps({ data, error: null });
      },
      (err) => {
        if (!cancelled) setGaps({ data: null, error: apiErrorText(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [round.year, round.semester, props.tick, retry]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocker = gaps?.data ? openBlocker(gaps.data) : null;
  const warnings = gaps?.data ? previewWarnings(gaps.data) : [];

  const open = () =>
    props.run(async () => {
      await openRound(round.id);
      return `เปิดให้กลุ่มสาระกรอกแล้ว — หัวหน้ากลุ่มสาระเข้าแล้วเห็นรายวิชาของกลุ่มตัวเองในรอบ ${round.label}`;
    }, setError);

  const cancel = async () => {
    const ok = await props.run(async () => {
      await cancelRound(round.id);
      return `ยกเลิกรอบ ${round.label} แล้ว — หลักสูตรของภาคเรียนนี้ยังอยู่ครบ เปิดรอบใหม่ได้`;
    }, setError);
    if (!ok) setAsking(false);
  };

  return (
    <Notice tone="warn" className="mb-5 space-y-2" data-testid="preparing-bar">
      <p className="font-semibold">รอบนี้ยังไม่เปิดให้กลุ่มสาระกรอก</p>
      <p className="text-ink">
        หัวหน้ากลุ่มสาระยังไม่เห็นรอบนี้ · ตรวจตัวเลขของแต่ละกลุ่มด้านล่าง ถ้าวิชา คาบ หรือห้องผิด แก้ที่หลักสูตร แล้วค่อยกด "เปิดให้กลุ่มสาระกรอก"
      </p>
      {gaps === null && <p role="status" className="text-ink">กำลังตรวจบรรทัดหลักสูตรที่ยังไม่มีกลุ่มสาระ...</p>}
      {gaps?.error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-bad">
          ตรวจบรรทัดที่ยังไม่มีกลุ่มสาระไม่ได้: {gaps.error}
          <Button size="sm" onClick={() => setRetry((n) => n + 1)}>ลองใหม่</Button>
        </p>
      )}
      {gaps?.data && warnings.length === 0 && (
        <p className="text-ink" data-testid="gaps">ทุกบรรทัดของหลักสูตรและทุกตัวเลือกคาบเสรี/กิจกรรมมีกลุ่มสาระแล้ว — เปิดให้กรอกได้</p>
      )}
      {warnings.length > 0 && (
        <div data-testid="gaps" className="space-y-1">
          {warnings.map((w) => <p key={w} className="font-medium">{w}</p>)}
          <Button size="sm" onClick={() => props.onOpenCurriculum(term)}>
            ไประบุกลุ่มสาระที่หน้าหลักสูตร
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="primary" onClick={() => void open()} disabled={props.working || blocker !== null || gaps === null}
          aria-describedby={blocker ? "open-blocker" : undefined}>
          เปิดให้กลุ่มสาระกรอก
        </Button>
        {!asking && <Button onClick={() => setAsking(true)} disabled={props.working}>ยกเลิกรอบนี้</Button>}
      </div>
      {blocker && <p id="open-blocker" className="text-[15px]">{blocker}</p>}
      {asking && (
        <div role="group" aria-label={`ยืนยันยกเลิกรอบ ${round.label}`} data-testid="cancel-round"
          className="space-y-2 rounded-xl border border-bad bg-surface p-4 text-ink">
          <p className="font-semibold">ยกเลิกรอบ {round.label}?</p>
          <p className="text-[15px] text-muted">
            แถวของรอบนี้ทั้งหมดจะถูกลบ (ครูเทอมก่อนที่ระบบใส่ไว้และที่ผู้ดูแลระบบแก้ในรอบนี้) · หลักสูตรของภาคเรียนนี้ไม่หาย
            และเปิดรอบใหม่ได้ภายหลัง · หัวหน้ากลุ่มสาระยังไม่เห็นรอบนี้ จึงไม่มีงานของใครหาย
          </p>
          <div className="flex flex-wrap gap-2">
            {/* โฟกัสเริ่มที่ "ไม่ยกเลิก" — กด Enter ต่อจากปุ่มเดิมโดยไม่ได้อ่านต้องไม่ลบรอบ */}
            <Button autoFocus onClick={() => setAsking(false)} disabled={props.working}>ไม่ยกเลิก</Button>
            <Button variant="danger" onClick={() => void cancel()} disabled={props.working}>
              {props.working ? "กำลังยกเลิก..." : "ยืนยันยกเลิกรอบ"}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </Notice>
  );
}

// ---- ยังไม่มีรอบที่เปิดอยู่: เลือกภาคเรียน → ดูก่อนเปิด → เปิดรอบ ----

function OpenRoundCard(props: {
  rounds: Round[];
  terms: CurriculumTerm[] | null;
  working: boolean;
  run: Run;
  onOpenCurriculum: (t: Term) => void;
}) {
  const yearId = useId();
  const semId = useId();
  const [initial] = useState<Term>(() => defaultOpenTerm(props.terms, props.rounds, guessTerm(new Date())));
  const [year, setYear] = useState(String(initial.year));
  const [semester, setSemester] = useState(String(initial.semester));
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ term: Term; data: RoundPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const problem = checkRoundForm(year, semester);
  const term: Term | null = problem ? null : { year: Number(year.trim()), semester: Number(semester.trim()) };
  const ready = term ? termReadiness(term, props.terms, props.rounds) : null;

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    // ตัวเลขที่ดูอยู่เป็นของภาคเรียนเดิม — เปลี่ยนภาคเรียนแล้วต้องดูใหม่ก่อนเปิด (กันเปิดรอบผิดภาคเรียน)
    setPreview(null);
    setFormError(null);
    setError(null);
  };

  const look = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(problem);
    if (!term || (ready && !ready.ok) || loading) return;
    setLoading(true);
    setError(null);
    try {
      setPreview({ term, data: await previewRound(term.year, term.semester) });
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setLoading(false);
    }
  };

  const create = async (t: Term) => {
    await props.run(async () => {
      const r = await createRound(t.year, t.semester);
      return `เปิดรอบ ${r.label} แล้ว (เตรียม) — หัวหน้ากลุ่มสาระยังไม่เห็นจนกว่าจะกด "เปิดให้กลุ่มสาระกรอก"`;
    }, setError);
  };

  const withCurriculum = (props.terms ?? []).filter(
    (t) => !props.rounds.some((r) => r.year === t.year && r.semester === t.semester),
  );

  return (
    <div>
      <h2 className="text-title text-ink">รอบอัตรากำลัง</h2>
      <p className="mb-5 mt-1 text-muted">ยังไม่มีรอบที่เปิดอยู่ — เปิดรอบของภาคเรียนใหม่ได้ที่นี่ (มีรอบที่ยังไม่ปิดได้ทีละรอบ)</p>
      <Card as="section" aria-label="เปิดรอบใหม่">
        <h3 className="text-lg font-semibold">เปิดรอบอัตรากำลังของภาคเรียน</h3>
        <p className="mt-1 text-[15px] text-muted">
          แถวของรอบมาจากหลักสูตรของภาคเรียน (บรรทัดวิชา × ห้องเรียน) และใส่ครูเทอมก่อนจากแผนการสอนของโปรแกรมจัดตารางไว้ให้ยืนยัน ·
          กด "ดูก่อนเปิด" เพื่อดูตัวเลขก่อน — ยังไม่มีอะไรถูกบันทึกจนกว่าจะกด "เปิดรอบ"
        </p>
        <form onSubmit={look} className="mt-4 flex flex-wrap items-end gap-3" noValidate>
          <Field label="ปีการศึกษา (พ.ศ.)" htmlFor={yearId}>
            <input id={yearId} className={`${inputClass} sm:w-32`} inputMode="numeric" maxLength={4} autoComplete="off"
              value={year} onChange={(e) => edit(setYear)(e.target.value)} />
          </Field>
          <Field label="ภาคเรียน" htmlFor={semId}>
            <select id={semId} className={`${inputClass} sm:w-28`} value={semester} onChange={(e) => edit(setSemester)(e.target.value)}>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </Field>
          <Button type="submit" variant="primary" disabled={loading || props.working || (ready !== null && !ready.ok)}
            className="max-sm:w-full">
            {loading ? "กำลังดู..." : "ดูก่อนเปิด"}
          </Button>
        </form>
        {withCurriculum.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            ภาคเรียนที่มีหลักสูตรแล้วแต่ยังไม่มีรอบ:
            {withCurriculum.map((t) => (
              <Button key={`${t.year}-${t.semester}`} size="sm" variant="ghost"
                onClick={() => {
                  edit(setYear)(String(t.year));
                  setSemester(String(t.semester));
                }}>
                {t.label}
              </Button>
            ))}
          </p>
        )}
        {formError && <p role="alert" className="mt-3 text-bad">{formError}</p>}
        {ready && !ready.ok && (
          <Notice tone="warn" className="mt-4 flex flex-wrap items-center justify-between gap-3" data-testid="term-not-ready">
            <span>{ready.reason}</span>
            {ready.needCurriculum && term && (
              <Button size="sm" onClick={() => props.onOpenCurriculum(term)}>ไปหน้าหลักสูตร</Button>
            )}
          </Notice>
        )}
        {error && <Notice tone="bad" role="alert" className="mt-4">{error}</Notice>}
        {preview && (
          <PreviewBox
            term={preview.term}
            data={preview.data}
            working={props.working}
            onOpen={() => void create(preview.term)}
            onCancel={() => setPreview(null)}
            onOpenCurriculum={props.onOpenCurriculum}
          />
        )}
      </Card>
    </div>
  );
}

function PreviewBox(props: {
  term: Term;
  data: RoundPreview;
  working: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onOpenCurriculum: (t: Term) => void;
}) {
  const { data } = props;
  const label = roundLabel(props.term.year, props.term.semester);
  const warnings = previewWarnings(data);
  return (
    <section aria-label={`ดูก่อนเปิดรอบ ${label}`} data-testid="round-preview"
      className="mt-5 space-y-3 rounded-card border border-line bg-bg p-4 sm:p-5">
      <h4 className="text-lg font-semibold">ดูก่อนเปิดรอบ ภาคเรียน {label}</h4>
      <ul className="list-disc space-y-1 pl-5">
        {previewLines(data).map((line) => (
          <li key={line} className={warnings.includes(line) ? "font-medium text-warn" : undefined}>{line}</li>
        ))}
      </ul>
      {warnings.length > 0 && (
        <Button size="sm" onClick={() => props.onOpenCurriculum(props.term)}>ไประบุกลุ่มสาระที่หน้าหลักสูตร</Button>
      )}
      {data.unconverted.length > 0 && (
        <div data-testid="preview-unconverted">
          <p className="font-medium">แปลงไม่ได้ {fmt(data.unconverted.length)} รายการ — แถวเหล่านี้จะไม่มีครูเทอมก่อน หัวหน้ากลุ่มสาระเลือกครูเอง</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] text-muted">
            {data.unconverted.map((u, i) => <li key={i}>{u.reason}</li>)}
          </ul>
        </div>
      )}
      <p className="text-[15px] text-muted">
        ยังไม่มีอะไรถูกบันทึก · กด "เปิดรอบ" แล้วรอบจะอยู่ในสถานะเตรียม (หัวหน้ากลุ่มสาระยังไม่เห็น) จนกว่าจะกด "เปิดให้กลุ่มสาระกรอก"
        · ถ้าเปิดผิดภาคเรียน ยกเลิกรอบได้ก่อนเปิดให้กรอก
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={props.onOpen} disabled={props.working}>
          {props.working ? "กำลังเปิดรอบ..." : "เปิดรอบ"}
        </Button>
        <Button onClick={props.onCancel} disabled={props.working}>ยกเลิก</Button>
      </div>
    </section>
  );
}
