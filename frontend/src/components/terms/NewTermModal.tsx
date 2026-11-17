/**
 * สร้างเทอมใหม่ — หน้าสรุปก่อนกดยืนยัน
 *
 * ปุ่มยืนยันกดได้ครั้งเดียว: การสร้างเทอมปิดเทอมที่ใช้อยู่และล้างตาราง กดซ้ำตอนเครือข่าย
 * ช้าอาจปิดเทอมที่เพิ่งสร้างต่อไปอีกชั้น จึงล็อกปุ่มทันทีที่กด (กลอนใน ref ไม่รอ React วาดใหม่)
 * และปลดล็อกคืนเฉพาะเมื่อเซิร์ฟเวอร์ปฏิเสธก่อนทำอะไร (400/409) ส่วนหมดเวลาหรือเครือข่ายหลุด
 * บอกไม่ได้ว่าสร้างไปแล้วหรือยัง จึงให้ไปดูรายการเทอมก่อน
 *
 * ผลลัพธ์ไม่พูดว่า “บันทึกแล้ว”: save_error เป็น null แค่แปลว่าเซิร์ฟเวอร์ต่อคิวเขียนไว้
 * คำตอบจริงอยู่ที่ป้ายสถานะการบันทึกบนแถบด้านบน (อ่านจาก /state/version)
 *
 * ขั้นที่ 3 (แบบข้อ 4.5): มีรอบอัตรากำลัง → เลือกได้ว่าแผนของเทอมใหม่มาจาก "แผนเดิม" (ค่าเริ่มต้น ทางเดิมทุกอย่าง)
 * หรือ "รอบอัตรากำลัง" (ปี/ภาคเรียนตามรอบ แก้ไม่ได้ · สรุปและเหตุจากเซิร์ฟเวอร์ · กรอกรหัสผู้ดูแลระบบของเว็บลงอัตรากำลัง)
 * ไม่มีรอบเลย หรืออ่านรายการรอบไม่ได้ → หน้าต่างเหมือนเดิมทุกอย่าง (อ่านไม่ได้มีบรรทัดเล็กบอกท้ายหน้าต่าง)
 * กลอนกันกดซ้ำและข้อความผลเป็นตัวเดียวกันทั้งสองทาง · ทางรอบ 403/404/429 และ 503 ที่มีข้อความไทยของเซิร์ฟเวอร์ก็เป็นการปฏิเสธ
 * ก่อนทำอะไร จึงกดใหม่ได้ · ค่าเริ่มต้นของตัวเลือกรอบ = รอบที่ใช้ได้ของภาคเรียนถัดจากภาคเรียนปัจจุบัน (ไม่มี = ไม่เลือก)
 */
import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useTimetableStore } from "../../store/timetableStore";
import * as api from "../../api/client";
import { ModalShell } from "../common/ModalShell";
import {
  activeTerm, activitySetLines, canRetryCreate, createLatch, createLockedText, createOutcome, defaultTermRound,
  newTermFormError, newTermFromRoundError, newTermWarning, nextTerm, previewRows, roundCreatedNote, roundOptionLabel,
  roundPreviewRows, roundSelectable, roundsLoadNote, runningTerm, termErrorText, TERMS_UNAVAILABLE,
  type RoundPreview, type RoundPreviewRow, type RoundReport, type TermRound,
} from "../../utils/terms";

interface Props {
  onClose: () => void;
  /** เรียกเมื่อสร้างสำเร็จ — หน้ารายการเก็บข้อความไว้แสดงต่อหลังปิดหน้าต่าง */
  onCreated?: (text: string, tone: "info" | "warn" | "error") => void;
}

/** สรุปของรอบ: หนึ่งบรรทัดต่อรายการ · รายการที่มีชื่อเปิดดูได้ ("ดูรายการ") */
const RoundSummary: React.FC<{ rows: RoundPreviewRow[] }> = ({ rows }) => (
  <ul className="divide-y divide-gray-100 border-y border-gray-100" data-testid="round-summary">
    {rows.map((r) => (
      <li key={r.label} className="py-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={clsx("min-w-0 text-sm",
            r.tone === "warn" ? "font-medium text-amber-800" : r.tone === "info" ? "text-gray-500" : "text-gray-700")}>
            {r.tone === "warn" ? "⚠ " : r.tone === "info" ? "ⓘ " : ""}{r.label}
          </span>
          <span className="text-right text-sm font-semibold text-gray-900 tabular-nums">{r.value}</span>
        </div>
        {r.items && r.items.length > 0 && (
          <details className="mt-0.5">
            <summary className="cursor-pointer select-none text-xs text-blue-700">ดูรายการ</summary>
            <ul className="mt-1 mb-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-gray-700">
              {r.items.map((t, i) => <li key={i} className="break-words">{t}</li>)}
            </ul>
          </details>
        )}
      </li>
    ))}
  </ul>
);

const byNewest = (a: TermRound, b: TermRound): number => b.year - a.year || b.semester - a.semester;

export const NewTermModal: React.FC<Props> = ({ onClose, onCreated }) => {
  const terms = useTimetableStore((s) => s.terms);
  const available = useTimetableStore((s) => s.termsAvailable);
  const makeNewTerm = useTimetableStore((s) => s.makeNewTerm);
  const loadTerms = useTimetableStore((s) => s.loadTerms);
  const departments = useTimetableStore((s) => s.departments);
  const schoolConfig = useTimetableStore((s) => s.schoolConfig);

  const active = activeTerm(terms) ?? null;
  // ภาคเรียนปัจจุบัน — ค่าเริ่มต้นของตัวเลือกรอบต้องเป็นภาคเรียนถัดจากนี้ (เว็บจริงยังไม่มีเทอมที่บันทึกไว้ → ปี/ภาคในหน้าตั้งค่า)
  // อ่านผ่าน ref ตอนรายการรอบมาถึง: ไม่โหลดรายการรอบใหม่ทุกครั้งที่รายการเทอม/การตั้งค่าเปลี่ยน
  const currentRef = useRef(runningTerm(active, schoolConfig));
  currentRef.current = runningTerm(active, schoolConfig);
  // เติมค่าจาก nextTerm() ครั้งเดียวตอนเปิด — ไม่ตามรายการที่โหลดใหม่ระหว่างที่ผู้ใช้กำลังพิมพ์
  const [initial] = useState(() => nextTerm(active));
  const [year, setYear] = useState(initial.year > 0 ? String(initial.year) : "");
  const [semester, setSemester] = useState(String(initial.semester));

  const [preview, setPreview] = useState<api.TermPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** สร้างไปแล้ว หรือไม่แน่ใจว่าสร้างไปแล้ว — ปุ่มยืนยันไม่กลับมากดได้อีก */
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<{ text: string; tone: "info" | "warn" | "error" } | null>(null);
  const latch = useRef(createLatch());

  // ── รอบอัตรากำลัง (ขั้นที่ 3) ──
  /** null = ยังไม่มา หรืออ่านไม่ได้ (หน้าต่างแบบเดิม) */
  const [rounds, setRounds] = useState<TermRound[] | null>(null);
  const [roundsNote, setRoundsNote] = useState<string | null>(null);
  const [roundsTick, setRoundsTick] = useState(0);
  const [source, setSource] = useState<"plan" | "round">("plan");
  const [roundId, setRoundId] = useState<number | null>(null);
  /** สรุปของรอบที่โหลดล่าสุด — ใช้ได้เฉพาะเมื่อ id ตรงกับรอบที่เลือกอยู่ (ไม่ตรง = กำลังโหลด) */
  const [roundView, setRoundView] = useState<{ id: number; data: RoundPreview | null; error: string | null } | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const [code, setCode] = useState("");
  const [createdReport, setCreatedReport] = useState<RoundReport | null>(null);
  // ทางรอบ: สรุปยาว ข้อความผิดพลาด/ผลอยู่ใต้ขอบจอ — เลื่อนให้เห็นทันทีที่ขึ้น (ทางเดิมไม่แตะ)
  const errRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const activitiesRef = useRef<HTMLDivElement>(null);

  const loadPreview = async () => {
    setPreviewErr(null);
    try { setPreview(await api.fetchTermPreview()); }
    catch (e) { setPreviewErr(termErrorText(e, "อ่านสรุปก่อนสร้างเทอมไม่สำเร็จ")); }
  };

  useEffect(() => {
    if (!available) return;
    let alive = true;
    api.fetchTermPreview()
      .then((p) => { if (alive) setPreview(p); })
      .catch((e) => { if (alive) setPreviewErr(termErrorText(e, "อ่านสรุปก่อนสร้างเทอมไม่สำเร็จ")); });
    return () => { alive = false; };
  }, [available]);

  // รายการรอบ: ไม่มีรอบ (รวมไม่ได้ต่อฐานข้อมูล) = [] · อ่านไม่ได้ = คงหน้าต่างแบบเดิม + บรรทัดเล็ก ไม่ขวางทางเดิม
  useEffect(() => {
    if (!available) return;
    let alive = true;
    api.fetchTermRounds()
      .then((list) => {
        if (!alive) return;
        const got = Array.isArray(list) ? list : [];
        setRounds(got);
        setRoundsNote(null);
        // โหลดใหม่ (หลัง 409) คงรอบที่เลือกไว้ถ้ายังเลือกได้ · ครั้งแรก = รอบที่ใช้ได้ของภาคเรียนถัดจากภาคเรียนปัจจุบัน
        // ไม่มี = ไม่เลือก (รีวิวทั้งสาขา M2 — ไม่ถอยไปรอบของภาคเรียนปัจจุบันหรือที่ผ่านมา)
        setRoundId((cur) => (cur !== null && got.some((r) => r.id === cur && roundSelectable(r))
          ? cur : defaultTermRound(got, currentRef.current)?.id ?? null));
      })
      .catch((e) => { if (alive) setRoundsNote(roundsLoadNote(e)); });
    return () => { alive = false; };
  }, [available, roundsTick]);

  const hasRounds = rounds !== null && rounds.length > 0;
  const fromRound = hasRounds && source === "round";

  useEffect(() => { if (fromRound && err) errRef.current?.scrollIntoView?.({ block: "nearest" }); }, [fromRound, err]);
  // ผลสำเร็จ: รายการชุดกิจกรรมที่ต้องลงคาบเองอยู่ท้ายสุด — เลื่อนถึงรายการนั้น (ไม่มี = ถึงข้อความผล)
  useEffect(() => {
    if (fromRound && result) (activitiesRef.current ?? resultRef.current)?.scrollIntoView?.({ block: "nearest" });
  }, [fromRound, result]);

  useEffect(() => {
    if (!fromRound || roundId === null) return;
    let alive = true;
    api.fetchTermPreview(roundId)
      .then((d) => { if (alive) setRoundView({ id: roundId, data: d, error: null }); })
      .catch((e) => {
        if (alive) setRoundView({ id: roundId, data: null, error: termErrorText(e, "อ่านสรุปของรอบนี้ไม่สำเร็จ") });
      });
    return () => { alive = false; };
  }, [fromRound, roundId, previewTick]);

  const formError = newTermFormError(year, semester, terms);

  const listed = rounds?.find((r) => r.id === roundId) ?? null;
  const view = roundView !== null && roundView.id === roundId ? roundView : null;
  const fresh = view?.data?.round ?? null;
  // เหตุ/ใช้ได้ไหม จากสรุปของรอบที่เพิ่งโหลด (ใหม่กว่ารายการ) ถ้ามี
  const selected: TermRound | null = listed && (fresh ? { ...listed, usable: fresh.usable, reasons: fresh.reasons } : listed);
  const roundError = newTermFromRoundError(selected, code);
  const reasons = selected?.reasons ?? [];
  const deptName = (id: number) => departments.find((d) => d.id === id)?.name;

  const confirm = async () => {
    if (fromRound ? roundError !== null || !view?.data || selected === null : formError || !preview) return;
    // กลอนก่อน state: คลิกซ้อนในจังหวะเดียวกันผ่านไปได้แค่ครั้งแรก
    if (!latch.current.take()) return;
    setBusy(true); setErr(null);
    try {
      const r = fromRound && selected
        ? await makeNewTerm(selected.year, selected.semester, { roundId: selected.id, adminCode: code })
        : await makeNewTerm(Number(year), Number(semester));
      const o = createOutcome(r);
      setResult(o);
      setLocked(true);
      const note = fromRound ? roundCreatedNote(r.report) : null;
      if (fromRound) { setCode(""); setCreatedReport(r.report ?? null); }
      onCreated?.(note ? `${o.text} · ${note}` : o.text, o.tone);
    } catch (e) {
      if (canRetryCreate(e, fromRound)) {
        // เซิร์ฟเวอร์ปฏิเสธก่อนทำอะไร (ปีผิด เทอมซ้ำ · รหัสผิด รอบเปลี่ยน · ทางรอบ 503 ต่อฐานไม่ได้) แก้แล้วกดใหม่ได้
        setErr(termErrorText(e, "สร้างเทอมไม่สำเร็จ"));
        latch.current.reset();
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (fromRound && (status === 404 || status === 409)) {
          // อีกเครื่องส่งรอบนี้ไปก่อน · มีคนแก้ข้อมูลระหว่างนี้ — โหลดรายการรอบและสรุปใหม่ให้เห็นเหตุล่าสุด
          setRoundsTick((n) => n + 1);
          setPreviewTick((n) => n + 1);
          void loadTerms();
        }
      } else {
        setLocked(true);
        // ทางรอบ 500 = ข้อความไทยของเซิร์ฟเวอร์ ("ข้อมูลเดิมยังอยู่ครบ") · ที่เหลือ = ข้อความเดิม (รีวิวทั้งสาขา M11)
        setErr(createLockedText(e, fromRound));
        void loadTerms();
      }
    } finally { setBusy(false); }
  };

  const close = () => { if (!busy) onClose(); };

  if (!available) {
    return (
      <ModalShell onClose={close} maxWidth="max-w-md">
        <div className="px-5 py-4 space-y-3">
          <h3 className="text-base font-bold text-gray-800">สร้างเทอมใหม่</h3>
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
            {TERMS_UNAVAILABLE}
          </p>
        </div>
      </ModalShell>
    );
  }

  const done = result !== null;
  const frozen = busy || locked;
  const createdActivities = activitySetLines(createdReport);
  const pick = (next: "plan" | "round") => { setSource(next); setErr(null); };

  return (
    <ModalShell onClose={close} maxWidth={hasRounds ? "max-w-2xl" : "max-w-lg"}>
      <div className="px-5 py-4 border-b border-gray-200">
        <h3 className="text-base font-bold text-gray-800">สร้างเทอมใหม่</h3>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {hasRounds && (
          <div role="radiogroup" aria-label="แผนการสอนของเทอมใหม่" className="space-y-1.5" data-testid="term-source">
            <p className="text-xs font-semibold text-gray-500">แผนการสอนของเทอมใหม่</p>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="radio" name="new-term-source" checked={source === "plan"} disabled={frozen}
                onChange={() => pick("plan")} />
              ใช้แผนเดิมของเทอมนี้ (ไม่เปลี่ยน)
            </label>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input type="radio" name="new-term-source" checked={source === "round"} disabled={frozen}
                  onChange={() => pick("round")} />
                จากรอบอัตรากำลัง
              </label>
              <select
                aria-label="รอบอัตรากำลัง"
                value={roundId ?? ""}
                disabled={frozen}
                onChange={(e) => { setRoundId(e.target.value ? Number(e.target.value) : null); pick("round"); }}
                className="min-w-0 max-w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
              >
                {roundId === null && <option value="">— เลือกรอบ —</option>}
                {[...rounds].sort(byNewest).map((r) => (
                  <option key={r.id} value={r.id} disabled={!roundSelectable(r)}>{roundOptionLabel(r)}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {fromRound ? (
          <>
            {selected && (
              <p className="text-sm text-gray-700" data-testid="round-term">
                ปีการศึกษา <strong>{selected.year}</strong> · ภาคเรียน <strong>{selected.semester}</strong>
                <span className="ml-1 text-xs text-gray-400">(ตามรอบ — แก้ไม่ได้)</span>
              </p>
            )}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">เทอมใหม่จะเริ่มต้นด้วย</p>
              {roundId === null ? (
                <p className="text-xs text-gray-400">เลือกรอบอัตรากำลังก่อน</p>
              ) : view?.data ? (
                <RoundSummary rows={roundPreviewRows(view.data, deptName)} />
              ) : view?.error ? (
                <p className="text-xs text-red-600">
                  {view.error}{" "}
                  <button onClick={() => setPreviewTick((n) => n + 1)} className="underline">ลองใหม่</button>
                </p>
              ) : (
                <p className="text-xs text-gray-400">กำลังอ่านสรุปของรอบ…</p>
              )}
            </div>
            {reasons.length > 0 && (
              <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="round-reasons">
                <p className="font-semibold">ยังสร้างเทอมจากรอบนี้ไม่ได้ เพราะ</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                  {reasons.map((r, i) => <li key={i} className="break-words">{r}</li>)}
                </ul>
              </div>
            )}
            <label className="block text-xs font-medium text-gray-600">
              รหัสผู้ดูแลระบบของเว็บลงอัตรากำลัง
              <input
                type="password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
                disabled={frozen || !selected?.usable}
                autoComplete="new-password"
                className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
              />
            </label>
            {/* ไม่ได้เลือกรอบ: สรุปข้างบนบอกแล้ว ไม่ซ้ำ */}
            {roundError && selected && !locked && <p className="text-xs text-gray-500 -mt-2">{roundError}</p>}
          </>
        ) : (
          <>
            {/* ตัวเลข "วิชาใหม่" และ "ชุดคาบเสรี" มีเฉพาะทางรอบอัตรากำลัง (สรุปข้างบน) — แผนเดิมไม่สร้างวิชาหรือชุดใหม่ */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">เทอมใหม่จะเริ่มต้นด้วย</p>
              {preview ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  {previewRows(preview).map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between gap-2 border-b border-gray-100 py-1">
                      <dt className="text-sm text-gray-700">{r.label}</dt>
                      <dd className="text-sm font-semibold text-gray-900 tabular-nums">
                        {r.value.toLocaleString("th-TH")}
                        {r.note && <span className="ml-1 text-[10px] font-normal text-gray-400">{r.note}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : previewErr ? (
                <p className="text-xs text-red-600">
                  {previewErr}{" "}
                  <button onClick={() => void loadPreview()} className="underline">ลองใหม่</button>
                </p>
              ) : (
                <p className="text-xs text-gray-400">กำลังอ่านสรุป…</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-gray-600">
                ปีการศึกษา (พ.ศ.)
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={busy || locked}
                  inputMode="numeric"
                  placeholder="2569"
                  className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
                />
              </label>
              <label className="block text-xs font-medium text-gray-600">
                ภาคเรียนที่
                <select
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  disabled={busy || locked}
                  className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </label>
            </div>
            {formError && !locked && <p className="text-xs text-red-600 -mt-2">{formError}</p>}
          </>
        )}

        {/* สร้างแล้ว: คำเตือนไม่จริงอีกต่อไป (รายการเทอมโหลดใหม่ — จะกลายเป็นชื่อเทอมใหม่) จึงซ่อน (รีวิวทั้งสาขา M11) */}
        {!done && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <strong>{newTermWarning(active)}</strong>
          </p>
        )}

        {err && <p ref={errRef} className="text-xs text-red-600">{err}</p>}
        {result && (
          <p ref={resultRef} className={clsx("text-xs rounded-lg px-3 py-2 border",
            result.tone === "error" ? "bg-red-50 border-red-200 text-red-700"
              : result.tone === "warn" ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-800")}>
            {result.text}
          </p>
        )}
        {result && createdActivities.length > 0 && (
          <div ref={activitiesRef} className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2"
            data-testid="created-activities">
            <p className="font-semibold">{roundCreatedNote(createdReport)}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {createdActivities.map((t, i) => <li key={i} className="break-words">{t}</li>)}
            </ul>
          </div>
        )}
        {roundsNote && <p className="text-[11px] text-gray-400" data-testid="rounds-note">{roundsNote}</p>}
      </div>

      <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
        <button onClick={close} disabled={busy}
          className="px-3 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-100 disabled:opacity-40">
          {done || locked ? "ปิด" : "ยกเลิก"}
        </button>
        <button onClick={() => void confirm()}
          disabled={busy || locked || done || (fromRound ? !view?.data || roundError !== null : !preview || formError !== null)}
          className="px-3 py-1.5 text-sm bg-red-600 text-white rounded font-semibold hover:bg-red-700 disabled:opacity-40">
          {busy ? "กำลังสร้างเทอม…" : done ? "สร้างแล้ว"
            : fromRound ? "ปิดเทอมนี้ แล้วสร้างเทอมใหม่จากรอบ" : "ปิดเทอมนี้ แล้วสร้างเทอมใหม่"}
        </button>
      </div>
    </ModalShell>
  );
};
