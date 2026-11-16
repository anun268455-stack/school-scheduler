import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { apiErrorText, listDepartments, listSubjects } from "../api";
import {
  curriculumSummary, departmentShow, formatNumber, groupCurricula, guessTerm, KIND_TEXT, logParts, nextTerm,
  parseTerm, roomRange, searchSubjects, SET_KIND_TEXT, termChoices, termLabel,
  type Curriculum, type CurriculumLine, type LogEntry, type RefItem, type SeedResult, type SubjectHit, type Term,
  type TermSet, type TermSetOption,
} from "../curriculum";
import { forceConflictText, getCurricula, getCurriculumLog, listGroups, listTerms } from "../curriculumApi";
import type { Department, WlSubject } from "../types";
import { Button, Card, Chip, EmptyState, Notice, Segmented } from "../ui";
import { useRegistryList } from "../useRegistryList";
import {
  AddLineForm, AddOptionForm, CurriculumActions, CurriculumForm, ForceConfirm, LineEditorRow, OptionEditorRow,
  SeedCard, SeedSummary, SetActions, SetForm, type Kit, type Write,
} from "./CurriculumEditor";
import { Field, inputClass } from "./registryParts";

// หน้าหลักสูตรของภาคเรียน (แบบข้อ 4.5) — ทุกคนที่ล็อกอินเปิดดูได้ทั้งโรงเรียน ("ทุกๆคนเวลาสงสัยจะได้เปิดหลักสูตรดูได้")
// admin แก้ได้จนรอบของภาคเรียนนั้นปิด (ส่วนแก้อยู่ใน CurriculumEditor) · ทุกการแก้ลงบันทึกที่แท็บ "บันทึกการแก้"
// ข้อมูลโหลดใหม่ทั้งภาคเรียนหลังเขียนทุกครั้ง แต่ฟอร์มที่พิมพ์ค้างไม่หาย: รายการเดิมอยู่บนจอระหว่างโหลด ไม่ถอดฟอร์มออก

type Tab = "curricula" | "sets" | "log";

const noSubjects = async (): Promise<WlSubject[]> => [];
const noGroups = async (): Promise<RefItem[]> => [];

/** โหลดของภาคเรียนหนึ่ง · โหลดซ้ำของภาคเรียนเดิมเก็บข้อมูลเก่าไว้บนจอ · เปลี่ยนภาคเรียน = ไม่โชว์ของภาคเรียนเก่า */
function useTermLoad<T>(fetcher: (year: number, semester: number) => Promise<T>, term: Term | null, tick: number) {
  const year = term?.year ?? null;
  const semester = term?.semester ?? null;
  const key = year === null ? null : `${year}-${semester}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (year === null || semester === null) return;
    let cancelled = false;
    const k = `${year}-${semester}`;
    fetcher(year, semester).then(
      (data) => {
        if (!cancelled) setState({ key: k, data, error: null });
      },
      (err) => {
        if (!cancelled) setState((s) => ({ key: k, data: s && s.key === k ? s.data : null, error: apiErrorText(err) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, year, semester, tick, retry]);

  const retryNow = useCallback(() => setRetry((n) => n + 1), []);
  const mine = state && state.key === key ? state : null;
  return { data: mine?.data ?? null, error: mine?.error ?? null, retry: retryNow };
}

function useTerms(tick: number) {
  const [terms, setTerms] = useState<{ list: Awaited<ReturnType<typeof listTerms>>; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listTerms().then(
      (list) => {
        if (!cancelled) setTerms({ list, error: null });
      },
      (err) => {
        if (!cancelled) setTerms((t) => ({ list: t?.list ?? [], error: apiErrorText(err) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tick, retry]);
  return { terms, retry: () => setRetry((n) => n + 1) };
}

export default function CurriculumPage(props: {
  admin: boolean;
  /** กล่องสรุปหลังตั้งต้น — App เป็นเจ้าของ (หน้านี้ถูกถอดเมื่อเปลี่ยนเมนู แต่กล่องต้องอยู่จนกดปิด) */
  seedSummary: SeedResult | null;
  onSeedSummary: (r: SeedResult | null) => void;
  /** เปิดหน้ามาที่ภาคเรียน (และหลักสูตร) นี้ — ให้หน้าอื่นลิงก์มา "จากหลักสูตร …" ได้ */
  focus?: Term & { curriculumId?: number };
}) {
  const { admin } = props;
  const [tick, setTick] = useState(0);
  const { terms, retry: retryTerms } = useTerms(tick);
  const depts = useRegistryList(listDepartments);
  const subjects = useRegistryList(admin ? listSubjects : noSubjects);
  const groups = useRegistryList(admin ? listGroups : noGroups);
  // หลังเขียนทุกครั้ง: โหลดภาคเรียนใหม่ · ทะเบียนวิชาด้วย เพราะการตั้งต้นจากโปรแกรมจัดตารางดึงวิชาเข้าทะเบียน
  // (ถ้าไม่โหลด พิมพ์รหัสในฟอร์มบรรทัดแล้วชื่อไม่ขึ้นจนกว่าจะเปิดหน้าใหม่)
  const reloadSubjects = subjects.reload;
  const refresh = useCallback(() => {
    setTick((n) => n + 1);
    reloadSubjects();
  }, [reloadSubjects]);

  const [today] = useState(() => guessTerm(new Date()));
  // กล่องสรุปหลังตั้งต้นที่ยังไม่ได้ปิดผูกกับภาคเรียนของมัน — กลับมาที่หน้านี้ (เปลี่ยนเมนู/โหลดหน้าใหม่) ให้เปิดภาคเรียนนั้นก่อน กล่องจะได้เห็น
  const [picked, setPicked] = useState<Term | null>(() =>
    props.focus
      ? { year: props.focus.year, semester: props.focus.semester }
      : admin && props.seedSummary
        ? { year: props.seedSummary.year, semester: props.seedSummary.semester }
        : null,
  );
  const known = terms?.list ?? [];
  // ค่าตั้งต้น: ภาคเรียนล่าสุดที่มีหลักสูตร · ยังไม่มีเลย → admin เริ่มที่ภาคเรียนที่น่าจะเป็นตอนนี้ (เปลี่ยนได้) · หัวหน้าไม่มีอะไรให้ดู
  const term: Term | null = picked ?? (known[0] ? { year: known[0].year, semester: known[0].semester } : admin && terms ? today : null);

  const view = useTermLoad(getCurricula, term, tick);
  const log = useTermLoad(getCurriculumLog, term, tick);

  const [tab, setTab] = useState<Tab>("curricula");
  const [openId, setOpenId] = useState<number | null>(props.focus?.curriculumId ?? null);
  const [focusSet, setFocusSet] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [blank, setBlank] = useState(false);
  const [adding, setAdding] = useState<"curriculum" | "set" | null>(null);

  // ---- งานเขียน: ทีละอย่าง · 409 ที่ต้องยืนยันซ้ำเปิดกล่องยืนยัน แล้วส่งซ้ำพร้อม force ----
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [confirm, setConfirm] = useState<{ message: string; answer: (yes: boolean) => void } | null>(null);

  const attempt = useCallback(async (job: () => Promise<unknown>): Promise<{ ok: true } | { ok: false; err: unknown }> => {
    busy.current = true;
    setSaving(true);
    try {
      await job();
      return { ok: true };
    } catch (err) {
      return { ok: false, err };
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, []);

  const write: Write = useCallback(
    async (op, onError) => {
      // ref ไม่ใช่ state: กดสองครั้งติดกันก่อนจอวาดใหม่ state ยังเป็น false อยู่
      if (busy.current) return false;
      let res = await attempt(() => op(false));
      if (!res.ok) {
        const message = forceConflictText(res.err);
        if (message === null) {
          onError(apiErrorText(res.err));
          return false;
        }
        const yes = await new Promise<boolean>((answer) => setConfirm({ message, answer }));
        setConfirm(null);
        if (!yes) return false;
        res = await attempt(() => op(true));
        if (!res.ok) {
          onError(apiErrorText(res.err));
          return false;
        }
      }
      refresh();
      return true;
    },
    [attempt, refresh],
  );

  const pickTerm = (t: Term) => {
    setPicked(t);
    setOpenId(null);
    setFocusSet(null);
    setQuery("");
    setBlank(false);
    setAdding(null);
  };

  const data = view.data;
  const label = term ? termLabel(term.year, term.semester) : "";
  const locked = data?.locked ?? false;
  const canEdit = admin && data !== null && !locked;
  const kit: Kit | null =
    canEdit && term && data
      ? {
          term, view: data, terms: known, write, busy: saving, subjects: subjects.rows, departments: depts.rows, groups: groups.rows,
          loaded: { departments: depts.loaded, subjects: subjects.loaded, groups: groups.loaded },
        }
      : null;
  const seed = props.seedSummary;
  const empty = data !== null && data.curricula.length === 0 && data.sets.length === 0;
  const opened = data?.curricula.find((c) => c.id === openId) ?? null;
  const groupCount = data ? data.curricula.reduce((n, c) => n + c.group_ids.length, 0) : 0;

  // ตัวเลือกภาคเรียน: ที่มีหลักสูตร + (admin) ภาคเรียนตอนนี้ และภาคเรียนถัดจากล่าสุด (ไว้คัดลอกไปเทอมหน้า)
  const extra: Term[] = [];
  if (term) extra.push(term);
  if (admin) {
    extra.push(today);
    if (known[0]) extra.push(nextTerm(known[0]));
  }
  const choices = termChoices(known, extra);

  const openCurriculum = (id: number) => {
    setTab("curricula");
    setQuery("");
    setOpenId(id);
    window.scrollTo({ top: 0 });
  };
  const openSet = (id: number) => {
    setTab("sets");
    setQuery("");
    setFocusSet(id);
  };

  let body: ReactNode;
  if (terms === null) {
    body = <p role="status" className="text-muted">กำลังโหลด...</p>;
  } else if (term === null) {
    body = terms.error ? (
      <LoadError message={terms.error} onRetry={retryTerms} />
    ) : (
      <EmptyState
        title="ยังไม่มีหลักสูตร"
        hint="ผู้ดูแลระบบยังไม่ได้ทำหลักสูตรของภาคเรียนใด เมื่อทำแล้วจะเปิดดูได้ที่หน้านี้ · ถ้าสงสัยเรื่องวิชาหรือคาบ ให้สอบถามผู้ดูแลระบบ"
      />
    );
  } else if (data === null) {
    body = view.error ? (
      <LoadError message={view.error} onRetry={view.retry} />
    ) : (
      <p role="status" className="text-muted">กำลังโหลดหลักสูตรภาคเรียน {label}...</p>
    );
  } else if (empty && !blank) {
    body = kit ? (
      <SeedCard
        kit={kit}
        onSeeded={props.onSeedSummary}
        onBlank={() => {
          // ฟอร์มหลักสูตรแรกอยู่ในแท็บหลักสูตร — ถ้าค้างอยู่ที่แท็บอื่นจากภาคเรียนก่อน ฟอร์มจะไม่ขึ้น
          setBlank(true);
          setTab("curricula");
          setQuery("");
        }}
      />
    ) : (
      <EmptyState
        title={`ภาคเรียน ${label} ยังไม่มีหลักสูตร`}
        hint={admin ? "ภาคเรียนนี้ปิดแล้ว จึงตั้งต้นหลักสูตรไม่ได้ · เลือกภาคเรียนอื่น" : "ผู้ดูแลระบบยังไม่ได้ทำหลักสูตรของภาคเรียนนี้ · ลองเลือกภาคเรียนอื่น"}
      />
    );
  } else {
    const hits = searchSubjects(data.curricula, data.sets, query);
    body = (
      <>
        {view.error && <Notice tone="bad" role="alert" className="mb-4">{view.error}</Notice>}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <Segmented
            label="ส่วนของหลักสูตร"
            value={tab}
            onChange={(t) => {
              setTab(t);
              setQuery("");
            }}
            options={[
              { value: "curricula", label: `หลักสูตร ${formatNumber(data.curricula.length)}` },
              { value: "sets", label: `ชุดคาบเสรี/กิจกรรม ${formatNumber(data.sets.length)}` },
              { value: "log", label: "บันทึกการแก้" },
            ]}
          />
          <SearchBox value={query} onChange={setQuery} />
        </div>
        {query.trim() !== "" ? (
          <SearchResults hits={hits} query={query} onCurriculum={openCurriculum} onSet={openSet} onClear={() => setQuery("")} />
        ) : tab === "curricula" ? (
          opened ? (
            <CurriculumDetail
              curriculum={opened}
              departments={depts}
              kit={kit}
              onBack={() => setOpenId(null)}
            />
          ) : (
            <>
              {kit && (
                <div className="mb-5">
                  {adding === "curriculum" || (blank && data.curricula.length === 0) ? (
                    <Card as="section" aria-label="เพิ่มหลักสูตร">
                      <h3 className="mb-3 text-lg font-semibold">เพิ่มหลักสูตร</h3>
                      <CurriculumForm
                        kit={kit}
                        onDone={(id) => {
                          setAdding(null);
                          setBlank(false);
                          if (id !== null) setOpenId(id);
                        }}
                        onCancel={() => {
                          setAdding(null);
                          setBlank(false);
                        }}
                      />
                    </Card>
                  ) : (
                    <Button variant="primary" onClick={() => setAdding("curriculum")} disabled={saving}>เพิ่มหลักสูตร</Button>
                  )}
                </div>
              )}
              <CurriculumGrid curricula={data.curricula} onOpen={openCurriculum} />
            </>
          )
        ) : tab === "sets" ? (
          <>
            {kit && (
              <div className="mb-5">
                {adding === "set" ? (
                  <Card as="section" aria-label="เพิ่มชุดคาบเสรี/กิจกรรม">
                    <h3 className="mb-3 text-lg font-semibold">เพิ่มชุดคาบเสรี/กิจกรรม</h3>
                    <SetForm kit={kit} onDone={() => setAdding(null)} onCancel={() => setAdding(null)} />
                  </Card>
                ) : (
                  <Button variant="primary" onClick={() => setAdding("set")} disabled={saving}>เพิ่มชุดคาบเสรี/กิจกรรม</Button>
                )}
              </div>
            )}
            <SetList sets={data.sets} departments={depts} kit={kit} focus={focusSet} />
          </>
        ) : (
          <LogList entries={log.data} error={log.error} onRetry={log.retry} />
        )}
      </>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-title text-ink">หลักสูตร</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {term && (
              <p className="text-muted" data-testid="term-summary">
                ภาคเรียน {label}
                {data && !empty && (
                  <>
                    {" · "}
                    {formatNumber(data.curricula.length)} หลักสูตร · ห้องเรียน {formatNumber(groupCount)} ห้อง · ชุดคาบเสรี/กิจกรรม{" "}
                    {formatNumber(data.sets.length)} ชุด
                  </>
                )}
              </p>
            )}
            {locked && <Chip tone="mute" data-testid="locked">ปิดแล้ว · อ่านอย่างเดียว</Chip>}
            {saving && <p role="status" className="text-sm font-medium text-brand">กำลังบันทึก...</p>}
          </div>
          {!admin && term && (
            <p className="mt-1 text-sm text-muted">หลักสูตรแก้ได้เฉพาะผู้ดูแลระบบ — ถ้าวิชา คาบ หรือห้องผิด ให้แจ้งผู้ดูแลระบบแก้ที่หลักสูตร</p>
          )}
          {locked && (
            <p className="mt-1 text-sm text-muted">รอบอัตรากำลังของภาคเรียนนี้ปิดแล้ว หลักสูตรเก็บไว้เป็นหลักฐานย้อนหลัง แก้ไม่ได้อีก</p>
          )}
        </div>
        {terms !== null && term && <TermPicker admin={admin} term={term} choices={choices} onPick={pickTerm} disabled={saving} />}
      </div>
      {terms?.error && term && (
        <div className="mb-4">
          <LoadError message={terms.error} onRetry={retryTerms} />
        </div>
      )}
      {/* ทะเบียนที่ใช้แสดงชื่อ/เติมชื่อโหลดไม่ได้ → บอกตรง ๆ พร้อมปุ่มลองใหม่ (หน้าแสดงรหัสดิบแทน ไม่สรุปว่า "ไม่มีแล้ว") */}
      {depts.error && (
        <RegistryError what="รายชื่อกลุ่มสาระ" effect="ระหว่างนี้แสดงเป็นรหัสกลุ่มสาระ และยังเปลี่ยนกลุ่มสาระในฟอร์มไม่ได้"
          message={depts.error} onRetry={depts.reload} />
      )}
      {admin && groups.error && (
        <RegistryError what="รายการห้องเรียน" effect="ยังแก้ห้องของหลักสูตรและชุดคาบเสรี/กิจกรรมไม่ได้จนกว่าจะโหลดได้"
          message={groups.error} onRetry={groups.reload} />
      )}
      {admin && subjects.error && (
        <RegistryError what="ทะเบียนวิชา" effect="พิมพ์รหัสวิชาแล้วชื่อจะยังไม่ขึ้นเอง (เพิ่มบรรทัดได้ เซิร์ฟเวอร์เติมชื่อตามรหัสให้)"
          message={subjects.error} onRetry={subjects.reload} />
      )}
      {admin && seed && term && seed.year === term.year && seed.semester === term.semester && (
        <SeedSummary result={seed} onClose={() => props.onSeedSummary(null)} />
      )}
      {body}
      {confirm && (
        <ForceConfirm message={confirm.message} onYes={() => confirm.answer(true)} onNo={() => confirm.answer(false)} />
      )}
    </div>
  );
}

function RegistryError(props: { what: string; effect: string; message: string; onRetry: () => void }) {
  return (
    <Notice tone="bad" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <span>
        โหลด{props.what}ไม่ได้: {props.message} — {props.effect}
      </span>
      <Button size="sm" onClick={props.onRetry}>ลองโหลดใหม่</Button>
    </Notice>
  );
}

function LoadError(props: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <Notice tone="bad" role="alert">{props.message}</Notice>
      <Button onClick={props.onRetry}>ลองโหลดใหม่</Button>
    </div>
  );
}

// ---- ตัวเลือกภาคเรียน ----

function TermPicker(props: {
  admin: boolean;
  term: Term;
  choices: ReturnType<typeof termChoices>;
  onPick: (t: Term) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [other, setOther] = useState(false);
  const [year, setYear] = useState(String(props.term.year));
  const [semester, setSemester] = useState(String(props.term.semester));
  const [error, setError] = useState<string | null>(null);
  const value = other ? "other" : `${props.term.year}-${props.term.semester}`;

  const go = () => {
    const r = parseTerm(year, semester);
    if (!r.ok) return setError(r.error);
    setError(null);
    setOther(false);
    props.onPick(r.term);
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="ภาคเรียน" htmlFor={`${id}-term`}>
        <select
          id={`${id}-term`}
          value={value}
          disabled={props.disabled}
          className={inputClass}
          onChange={(e) => {
            if (e.target.value === "other") return setOther(true);
            setOther(false);
            const c = props.choices.find((t) => `${t.year}-${t.semester}` === e.target.value);
            if (c) props.onPick({ year: c.year, semester: c.semester });
          }}
        >
          {props.choices.map((c) => (
            <option key={`${c.year}-${c.semester}`} value={`${c.year}-${c.semester}`}>
              {c.label}
              {c.locked ? " · ปิดแล้ว" : ""}
              {c.empty ? " · ยังไม่มีหลักสูตร" : ""}
            </option>
          ))}
          {props.admin && <option value="other">ภาคเรียนอื่น…</option>}
        </select>
      </Field>
      {other && (
        <>
          <Field label="ภาค" htmlFor={`${id}-sem`}>
            <select id={`${id}-sem`} value={semester} onChange={(e) => setSemester(e.target.value)} className={inputClass}>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </Field>
          <Field label="ปีการศึกษา (พ.ศ.)" htmlFor={`${id}-year`}>
            <input id={`${id}-year`} value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric"
              className={`${inputClass} w-28`} />
          </Field>
          <Button onClick={go}>ไปที่ภาคเรียนนี้</Button>
          {error && <p role="alert" className="w-full text-[15px] text-bad">{error}</p>}
        </>
      )}
    </div>
  );
}

// ---- ค้นหาวิชาข้ามหลักสูตร ----

function SearchBox(props: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <Field label="ค้นหาวิชาจากรหัสหรือชื่อ" htmlFor={id}>
      <input id={id} type="search" value={props.value} onChange={(e) => props.onChange(e.target.value)}
        placeholder="เช่น ท21102 หรือ ภาษาไทย" className={`${inputClass} w-72`} />
    </Field>
  );
}

function SearchResults(props: {
  hits: SubjectHit[];
  query: string;
  onCurriculum: (id: number) => void;
  onSet: (id: number) => void;
  onClear: () => void;
}) {
  return (
    <Card as="section" pad={false} aria-label="ผลการค้นหาวิชา" data-testid="search-results">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h3 className="font-semibold">
          วิชานี้อยู่หลักสูตรไหนบ้าง <span className="font-normal text-muted">— พบ {formatNumber(props.hits.length)} วิชา</span>
        </h3>
        <Button size="sm" variant="ghost" onClick={props.onClear}>ล้างคำค้น</Button>
      </div>
      {props.hits.length === 0 ? (
        <p className="px-4 py-4 text-muted sm:px-5">ไม่พบวิชาที่รหัสหรือชื่อมีคำว่า “{props.query.trim()}” ในภาคเรียนนี้ · ลองพิมพ์รหัสให้สั้นลง</p>
      ) : (
        <ul className="divide-y divide-line2">
          {props.hits.map((h) => (
            <li key={h.key} className="px-4 py-3 sm:px-5">
              <p>
                <span className="font-semibold tabular-nums">{h.code}</span> {h.name}
                <span className="text-muted"> · {formatNumber(h.places.length)} ที่</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-[15px]">
                {h.places.map((p, i) => (
                  <li key={`${p.kind}-${p.id}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                    <button
                      type="button"
                      className="text-left font-medium text-brand underline-offset-2 hover:underline"
                      onClick={() => (p.kind === "curriculum" ? props.onCurriculum(p.id) : props.onSet(p.id))}
                    >
                      {p.kind === "curriculum" ? `หลักสูตร ${p.name}` : p.name}
                    </button>
                    <span className="text-muted">ห้อง {p.rooms} · {p.weekly} คาบ/สัปดาห์</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- รายการหลักสูตร (การ์ดจัดตามระดับชั้น) ----

function credits(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function CurriculumGrid(props: { curricula: Curriculum[]; onOpen: (id: number) => void }) {
  if (props.curricula.length === 0) {
    return <p className="text-muted">ภาคเรียนนี้ยังไม่มีหลักสูตร มีแต่ชุดคาบเสรี/กิจกรรม — ดูที่แท็บชุดคาบเสรี/กิจกรรม</p>;
  }
  return (
    <div className="space-y-6">
      {groupCurricula(props.curricula).map((g) => (
        <section key={g.level ?? "-"} aria-label={g.level ?? "ไม่ระบุระดับชั้น"}>
          <h3 className="mb-2 text-lg font-semibold">
            {g.level ?? "ไม่ระบุระดับชั้น"} <span className="font-normal text-muted">· {formatNumber(g.curricula.length)} หลักสูตร</span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.curricula.map((c) => {
              const s = curriculumSummary(c);
              const noDept = c.lines.filter((ln) => ln.department_id === null).length;
              return (
                <Card as="article" key={c.id} className="flex flex-col" data-testid={`curriculum-${c.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="min-w-0 break-words text-lg font-semibold">{c.name}</h4>
                    {noDept > 0 && <Chip tone="warn">ไม่ระบุกลุ่มสาระ {noDept}</Chip>}
                  </div>
                  <p className="text-[15px] text-muted">
                    ห้อง {s.groups} ({formatNumber(c.group_ids.length)} ห้อง)
                  </p>
                  <p className="text-[15px]">
                    {formatNumber(s.lines)} วิชา · รวม {formatNumber(s.weekly)} คาบ/สัปดาห์ · รวม {credits(s.credits)} หน่วยกิต
                  </p>
                  {c.note && <p className="mt-1 text-sm text-muted">หมายเหตุ: {c.note}</p>}
                  <div className="mt-auto pt-3">
                    <Button size="sm" onClick={() => props.onOpen(c.id)} aria-label={`เปิดดูหลักสูตร ${c.name}`}>เปิดดู</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- หลักสูตรที่เปิดดู: หัว + ตารางบรรทัด ----

// คอลัมน์ของตารางบรรทัดบนจอกว้าง · จอแคบแต่ละบรรทัดเป็นการ์ดสองบรรทัด (md:contents ทำให้กล่องย่อยกลายเป็นช่องของตาราง)
const LINE_COLS = "md:grid-cols-[6.5rem_minmax(0,1fr)_3.5rem_5.5rem_10.5rem_12rem]";
const LINE_COLS_EDIT = "md:grid-cols-[6.5rem_minmax(0,1fr)_3.5rem_5.5rem_10.5rem_12rem_8.5rem]";

type Depts = { rows: Department[]; loaded: boolean };

function DeptCell(props: { id: number | null; departments: Depts }) {
  const d = departmentShow(props.id, props.departments.rows, props.departments.loaded);
  if (d.kind === "none") return <Chip tone="warn">{d.text}</Chip>;
  // raw = ทะเบียนยังไม่มา: รหัสดิบสีรอง ไม่ใช่ป้ายเตือน
  return <span className={d.kind === "raw" ? "text-muted" : undefined}>{d.text}</span>;
}

function LineView(props: { line: CurriculumLine; departments: Depts; actions?: ReactNode; cols: string }) {
  const ln = props.line;
  return (
    <div className={`md:grid ${props.cols} md:items-center md:gap-x-3`} data-testid={`line-${ln.id}`}>
      <div className="flex min-w-0 gap-2 md:contents">
        <span className="shrink-0 font-semibold tabular-nums">{ln.code}</span>
        <span className="min-w-0 break-words">{ln.name}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted md:contents md:text-[15px] md:text-ink">
        <span className="tabular-nums md:text-right">
          {ln.credits === null ? "–" : credits(ln.credits)}
          <span className="md:hidden"> นก.</span>
        </span>
        <span aria-hidden className="md:hidden">·</span>
        <span className="tabular-nums md:text-right">
          {ln.weekly}
          <span className="md:hidden"> คาบ/สัปดาห์</span>
        </span>
        <span aria-hidden className="md:hidden">·</span>
        <span>{KIND_TEXT[ln.kind]}</span>
        <span aria-hidden className="md:hidden">·</span>
        <DeptCell id={ln.department_id} departments={props.departments} />
      </div>
      {props.actions && <div className="mt-2 flex gap-2 md:mt-0 md:justify-end">{props.actions}</div>}
    </div>
  );
}

function CurriculumDetail(props: {
  curriculum: Curriculum;
  departments: Depts;
  kit: Kit | null;
  onBack: () => void;
}) {
  const { curriculum: c, kit } = props;
  const s = curriculumSummary(c);
  const cols = kit ? LINE_COLS_EDIT : LINE_COLS;
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={props.onBack}>← กลับไปรายการหลักสูตร</Button>
      <Card as="section" aria-label={`หลักสูตร ${c.name}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-xl font-bold" data-testid="detail-title">หลักสูตร {c.name}</h3>
            <p className="text-muted">
              {c.level ? `${c.level} · ` : ""}ห้อง {s.groups} ({formatNumber(c.group_ids.length)} ห้อง)
            </p>
            {c.note && <p className="mt-1">หมายเหตุ: {c.note}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip tone="info">{formatNumber(s.lines)} วิชา</Chip>
            <Chip tone="info">รวม {formatNumber(s.weekly)} คาบ/สัปดาห์</Chip>
            <Chip tone="info">รวม {credits(s.credits)} หน่วยกิต</Chip>
          </div>
        </div>
        {kit && (
          <div className="mt-4">
            <CurriculumActions kit={kit} curriculum={c} onDeleted={props.onBack} />
          </div>
        )}
      </Card>
      <Card as="section" pad={false} aria-label="บรรทัดวิชาของหลักสูตร">
        <div className={`hidden border-b border-line px-4 py-2.5 text-sm font-medium text-muted sm:px-5 md:grid ${cols} md:gap-x-3`}>
          <span>รหัส</span>
          <span>ชื่อวิชา</span>
          <span className="text-right">นก.</span>
          <span className="text-right">คาบ/สัปดาห์</span>
          <span>ประเภท</span>
          <span>กลุ่มสาระ</span>
          {kit && <span />}
        </div>
        {c.lines.length === 0 ? (
          <p className="px-4 py-4 text-muted sm:px-5">
            หลักสูตรนี้ยังไม่มีบรรทัดวิชา{kit ? " — เพิ่มบรรทัดด้วยฟอร์มข้างล่าง พิมพ์รหัสแล้วชื่อขึ้นเองจากทะเบียนวิชา" : ""}
          </p>
        ) : (
          <ul className="divide-y divide-line2">
            {c.lines.map((ln) => (
              <li key={ln.id} className="px-4 py-2.5 sm:px-5">
                {kit ? (
                  <LineEditorRow
                    kit={kit}
                    line={ln}
                    view={(actions) => <LineView line={ln} departments={props.departments} actions={actions} cols={cols} />}
                  />
                ) : (
                  <LineView line={ln} departments={props.departments} cols={cols} />
                )}
              </li>
            ))}
          </ul>
        )}
        {kit && (
          <div className="border-t border-line bg-bg px-4 py-4 sm:px-5">
            <p className="mb-2 font-semibold">เพิ่มบรรทัดวิชา</p>
            <AddLineForm kit={kit} curriculumId={c.id} />
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- ชุดคาบเสรี/กิจกรรม ----

function OptionView(props: { option: TermSetOption; departments: Depts; actions?: ReactNode }) {
  const o = props.option;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-semibold tabular-nums">{o.code}</span>
      <span className="min-w-0 break-words">{o.name}</span>
      <span className="text-[15px] text-muted">
        <DeptCell id={o.department_id} departments={props.departments} />
      </span>
      {props.actions && <span className="ml-auto flex gap-2">{props.actions}</span>}
    </div>
  );
}

function SetList(props: { sets: TermSet[]; departments: Depts; kit: Kit | null; focus: number | null }) {
  // มาจากผลค้นหา: เลื่อนให้เห็นชุดนั้น (การ์ดชุดมีกรอบสีหลัก)
  useEffect(() => {
    if (props.focus !== null) document.getElementById(`set-${props.focus}`)?.scrollIntoView({ block: "start" });
  }, [props.focus]);

  if (props.sets.length === 0) {
    return <p className="text-muted">ภาคเรียนนี้ยังไม่มีชุดคาบเสรี/กิจกรรม</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {props.sets.map((s) => (
        <Card
          as="section"
          key={s.id}
          pad={false}
          aria-label={s.name}
          id={`set-${s.id}`}
          className={s.id === props.focus ? "ring-2 ring-brand" : ""}
          data-testid={`set-${s.id}`}
        >
          <div className="space-y-1 border-b border-line px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words font-semibold">{s.name}</h3>
              <Chip tone={s.kind === "elective" ? "info" : "mute"}>{SET_KIND_TEXT[s.kind]}</Chip>
              {s.is_double && <Chip tone="mute">คาบคู่</Chip>}
            </div>
            <p className="text-[15px] text-muted">
              ห้อง {roomRange(s.group_names)} ({formatNumber(s.group_ids.length)} ห้อง)
              · {s.weekly} คาบ/สัปดาห์
            </p>
            {props.kit && <div className="pt-2"><SetActions kit={props.kit} set={s} /></div>}
          </div>
          {s.options.length === 0 ? (
            <p className="px-4 py-3 text-muted sm:px-5">ยังไม่มีตัวเลือกวิชา</p>
          ) : (
            <ul className="divide-y divide-line2">
              {s.options.map((o) => (
                <li key={o.id} className="px-4 py-2 sm:px-5">
                  {props.kit ? (
                    <OptionEditorRow
                      kit={props.kit}
                      option={o}
                      view={(actions) => <OptionView option={o} departments={props.departments} actions={actions} />}
                    />
                  ) : (
                    <OptionView option={o} departments={props.departments} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {props.kit && (
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <AddOptionForm kit={props.kit} setId={s.id} />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ---- บันทึกการแก้ (ใหม่ก่อน) ----

function LogList(props: { entries: LogEntry[] | null; error: string | null; onRetry: () => void }) {
  if (props.entries === null) {
    return props.error ? <LoadError message={props.error} onRetry={props.onRetry} /> : <p role="status" className="text-muted">กำลังโหลดบันทึกการแก้...</p>;
  }
  if (props.entries.length === 0) {
    return <p className="text-muted">ยังไม่มีการแก้หลักสูตรของภาคเรียนนี้</p>;
  }
  return (
    <Card as="section" pad={false} aria-label="บันทึกการแก้หลักสูตร" data-testid="change-log">
      <ul className="divide-y divide-line2">
        {props.entries.map((e) => {
          const p = logParts(e);
          return (
            <li key={e.id} className="px-4 py-2.5 sm:px-5">
              <p className="text-sm text-muted">
                {p.when} · {p.by}
              </p>
              <p className="break-words">{p.detail}</p>
            </li>
          );
        })}
      </ul>
      {props.entries.length >= 500 && (
        <p className="border-t border-line px-4 py-2.5 text-sm text-muted sm:px-5">แสดง 500 รายการล่าสุด</p>
      )}
    </Card>
  );
}
