/**
 * อัปเดตแผนจากรอบอัตรากำลัง (ทาง ข. — อัปเดตแผนกลางเทอม · แบบข้อ 4.2 4.5)
 *
 * เลือกรอบของภาคเรียนที่เปิดอยู่ → เหตุที่ใช้ไม่ได้ (ถ้ามี) → สิ่งที่ต่างจากแผนแยกเป็นกอง แต่ละข้อมีช่องติ๊ก **ค่าเริ่มต้นไม่ติ๊ก**
 * (ไม่ติ๊ก = คงเดิม) "เลือกทั้งกอง" และผลต่อคาบที่ลงไว้แล้ว (effect — ข้อความของเซิร์ฟเวอร์ที่ตรงกับสิ่งที่จะถูกเขียน แสดงตามที่ได้มา)
 * → รหัสผู้ดูแลระบบของเว็บลงอัตรากำลัง → "ยืนยัน N ข้อ" → ผล + ลิงก์ไปรายการงาน
 *
 * หน้าเทียบที่เห็นต้องเป็นสิ่งที่ถูกเขียน: เซิร์ฟเวอร์คำนวณหน้าเทียบใหม่ในธุรกรรมแล้วเทียบ token — ไม่ตรง (มีคนแก้รอบ/แผน หรือมีการอัปเดต
 * ครั้งอื่นหลังเปิดหน้านี้) ได้ 409 จึงมีปุ่ม "ดูใหม่" ซึ่งโหลดหน้าเทียบใหม่และล้างการติ๊กทั้งหมด (ติ๊กใหม่จากของล่าสุด ไม่ยกการติ๊กเก่าไป)
 * อัปเดตสำเร็จแล้ว token เดิมใช้ไม่ได้อีก (ผูกกับการอัปเดตครั้งล่าสุด) จึงโหลดหน้าเทียบใหม่ก่อนให้กดอีก (คำตัดสินผู้คุมข้อ 2)
 * ไม่มีอะไรในหน้าต่างนี้แตะคาบที่ลงไว้ — สิ่งที่ต้องไปแก้เองเข้ารายการงานในแผงเทอม
 */
import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { ModalShell } from "../common/ModalShell";
import {
  createLatch, groupItems, PILE_HINT, planRoundOption, planUpdateError, planUpdateFailure, planUpdateOutcome, requiredBy,
  termErrorText, togglePile, toggleWithRequires, type Pile, type PlanItem, type PlanPreview, type PlanRound,
} from "../../utils/terms";

interface Props {
  /** รอบของภาคเรียนที่เปิดอยู่ ตามที่แผงเทอมโหลดไว้ (หน้าต่างโหลดใหม่เองเมื่อกด "ดูใหม่") */
  rounds: PlanRound[];
  onClose: () => void;
  /** อัปเดตสำเร็จ — แผงเทอมโหลดรายการงานและรอบใหม่ และร้านโหลดแผนใหม่ */
  onUpdated: () => void;
  /** ลิงก์ "ดูรายการงาน" ในผล — ปิดหน้าต่างแล้วเลื่อนไปที่รายการงาน */
  onShowTodos: () => void;
}

/** รอบที่เลือกให้ตอนเปิด: ที่เปิดให้แก้กลางเทอมและใช้ได้ → ที่ใช้ได้ → รอบแรก */
function defaultRound(rounds: PlanRound[]): number | null {
  return (rounds.find((r) => r.usable && r.amending_since) ?? rounds.find((r) => r.usable) ?? rounds[0])?.id ?? null;
}

/** รายการที่เปิดดูได้ ไม่ทำอะไร (ไม่อยู่ในรอบ · จับคู่ไม่ได้ · อยู่ในรายการงานแล้ว) */
const Folded: React.FC<{ title: string; note: string; lines: string[]; testId: string }> = ({ title, note, lines, testId }) => {
  if (lines.length === 0) return null;
  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2" data-testid={testId}>
      <summary className="cursor-pointer select-none text-sm text-gray-700">
        {title} <span className="text-gray-500">({lines.length.toLocaleString("th-TH")})</span>
      </summary>
      <p className="mt-1 text-[11px] text-gray-500">{note}</p>
      <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-gray-700">
        {lines.map((t, i) => <li key={i} className="break-words">{t}</li>)}
      </ul>
    </details>
  );
};

export const PlanUpdateModal: React.FC<Props> = ({ rounds: initialRounds, onClose, onUpdated, onShowTodos }) => {
  const [rounds, setRounds] = useState<PlanRound[]>(initialRounds);
  const [roundsTick, setRoundsTick] = useState(0);
  const [roundId, setRoundId] = useState<number | null>(() => defaultRound(initialRounds));
  /** หน้าเทียบของรอบที่โหลดล่าสุด — null = กำลังโหลด (ไม่มีข้อให้ติ๊กระหว่างนี้) */
  const [view, setView] = useState<{ id: number; data: PlanPreview | null; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; again: boolean } | null>(null);
  const [result, setResult] = useState<{ text: string; todos: number } | null>(null);
  const latch = useRef(createLatch());
  const errRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // รอบ: โหลดใหม่เมื่อกด "ดูใหม่" และหลังอัปเดต (รอบที่แก้กลางเทอมกลับเป็นปิด) · รอบที่เลือกหายไป → เลือกใหม่
  useEffect(() => {
    if (roundsTick === 0) return;
    let alive = true;
    api.fetchPlanRounds()
      .then((list) => {
        if (!alive) return;
        const got = Array.isArray(list) ? list : [];
        setRounds(got);
        setRoundId((cur) => (cur !== null && got.some((r) => r.id === cur) ? cur : defaultRound(got)));
      })
      .catch(() => { /* คงรายการเดิม — หน้าเทียบบอกเหตุเองถ้ารอบใช้ไม่ได้แล้ว */ });
    return () => { alive = false; };
  }, [roundsTick]);

  // หน้าเทียบ: ทุกครั้งที่โหลดเริ่มจากไม่ติ๊กอะไรเลย (ค่าเริ่มต้นไม่ติ๊ก · ไม่ยกการติ๊กของหน้าเก่าไปหน้าใหม่)
  useEffect(() => {
    if (roundId === null) return;
    let alive = true;
    setView(null);
    setSelected(new Set());
    api.fetchPlanPreview(roundId)
      .then((d) => { if (alive) setView({ id: roundId, data: d, error: null }); })
      .catch((e) => { if (alive) setView({ id: roundId, data: null, error: termErrorText(e, "เทียบรอบกับแผนไม่สำเร็จ") }); });
    return () => { alive = false; };
  }, [roundId, tick]);

  useEffect(() => { if (err) errRef.current?.scrollIntoView?.({ block: "nearest" }); }, [err]);
  useEffect(() => { if (result) resultRef.current?.scrollIntoView?.({ block: "nearest" }); }, [result]);

  const data = view !== null && view.id === roundId ? view.data : null;
  const listed = rounds.find((r) => r.id === roundId) ?? null;
  // ใช้ได้ไหม/เหตุ: จากหน้าเทียบที่เพิ่งโหลด (ใหม่กว่ารายการ) ถ้ามี
  const round: PlanRound | null = listed && (data ? { ...listed, usable: data.usable, reasons: data.reasons } : listed);
  const items = data?.items ?? [];
  const usable = round?.usable ?? false;
  const problem = planUpdateError(round, selected, code);
  const frozen = busy || data === null;
  const canTick = !frozen && usable;

  const refresh = () => {
    setErr(null);
    latch.current.reset();
    setRoundsTick((n) => n + 1);
    setTick((n) => n + 1);
  };

  const confirm = async () => {
    if (problem !== null || data === null || roundId === null || !latch.current.take()) return;
    setBusy(true); setErr(null); setResult(null);
    const accept = items.filter((it) => selected.has(it.key)).map((it) => it.key);
    const closing = data.round.amending_since !== null;
    try {
      const r = await api.postPlanUpdate(roundId, code, accept, data.token);
      setResult({ text: planUpdateOutcome(r, accept.length, closing), todos: r.todos });
      setCode("");
      onUpdated();
      // token ของหน้านี้ใช้ไม่ได้อีกแล้ว — โหลดหน้าเทียบ (และรอบ) ใหม่ก่อนให้กดอีก ระหว่างโหลดไม่มีข้อให้ติ๊ก ปุ่มจึงกดไม่ได้
      setRoundsTick((n) => n + 1);
      setTick((n) => n + 1);
      latch.current.reset();
    } catch (e) {
      const f = planUpdateFailure(e);
      setErr(f);
      // ปฏิเสธก่อนทำอะไร (รหัสผิด ฯลฯ) แก้แล้วกดใหม่ได้ · ที่เหลือต้องดูใหม่ก่อน (ปุ่มยืนยันล็อกจนกด "ดูใหม่")
      if (f.again) latch.current.reset();
    } finally { setBusy(false); }
  };

  const close = () => { if (!busy) onClose(); };
  const locked = err !== null && !err.again;
  const groups = groupItems(items);
  const labelOf = (key: string) => items.find((it) => it.key === key)?.label ?? key;

  const itemRow = (it: PlanItem) => {
    const on = selected.has(it.key);
    const needs = (it.requires ?? []).filter((k) => items.some((x) => x.key === k));
    const users = it.pile === "registry" ? requiredBy(selected, items, it.key) : [];
    return (
      <li key={it.key} data-testid={`item-${it.key}`}>
        <label className={clsx("flex gap-2.5 px-3 py-2", canTick && "cursor-pointer hover:bg-blue-50/40", on && "bg-blue-50/60")}>
          <input type="checkbox" className="mt-0.5 shrink-0" checked={on} disabled={!canTick || locked}
            onChange={() => setSelected((s) => toggleWithRequires(s, items, it.key))} />
          <span className="min-w-0 space-y-0.5">
            <span className="block text-sm text-gray-800 break-words">{it.label}</span>
            {it.effect && (
              <span className={clsx("block text-xs break-words", it.auto ? "text-gray-600" : "text-amber-800")}>
                {it.auto ? "" : "⚠ "}{it.effect}
              </span>
            )}
            {needs.length > 0 && (
              <span className="block text-[11px] text-blue-700 break-words">
                ต้องใช้ {needs.map((k) => `“${labelOf(k)}”`).join(" · ")} — ติ๊กข้อนี้แล้วระบบติ๊กข้อนั้นให้ด้วย
              </span>
            )}
            {users.length > 0 && (
              <span className="block text-[11px] text-blue-700 break-words" data-testid="required-note">
                ติ๊กไว้เพราะข้อที่เลือก {users.length.toLocaleString("th-TH")} ข้อต้องใช้ — เอาออกแล้วข้อเหล่านั้นจะถูกเอาออกด้วย
              </span>
            )}
          </span>
        </label>
      </li>
    );
  };

  return (
    <ModalShell onClose={close} maxWidth="max-w-3xl" tall>
      <div className="px-5 py-4 border-b border-gray-200">
        <h3 className="text-base font-bold text-gray-800">อัปเดตแผนจากรอบอัตรากำลัง</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          เทียบรอบอัตรากำลังของภาคเรียนที่เปิดอยู่กับแผนการสอนตอนนี้ · ติ๊กเฉพาะข้อที่ยอมรับ (ไม่ติ๊ก = คงเดิม) ·
          คาบที่ลงไว้แล้วไม่ถูกแตะ — สิ่งที่ต้องไปแก้เองเข้ารายการงาน
        </p>
      </div>

      <div className="flex-1 px-5 py-4 space-y-4 overflow-y-auto" data-testid="plan-update-body">
        {rounds.length === 0 ? (
          <p className="text-sm text-gray-600">ไม่มีรอบอัตรากำลังของภาคเรียนที่เปิดอยู่แล้ว — ปิดหน้าต่างนี้แล้วกด “โหลดใหม่” ในแผงเทอม</p>
        ) : rounds.length > 1 ? (
          <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
            รอบอัตรากำลัง
            <select aria-label="รอบอัตรากำลัง" value={roundId ?? ""} disabled={busy}
              onChange={(e) => { setRoundId(Number(e.target.value)); setErr(null); setResult(null); latch.current.reset(); }}
              className="min-w-0 max-w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none">
              {rounds.map((r) => <option key={r.id} value={r.id}>{planRoundOption(r)}</option>)}
            </select>
          </label>
        ) : (
          <p className="text-sm text-gray-700" data-testid="plan-round">
            รอบอัตรากำลัง <strong>ภาคเรียน {rounds[0].label}</strong>
            {rounds[0].amending_since && (
              <span className="ml-1.5 text-xs px-2 py-0.5 rounded-full border bg-amber-50 border-amber-300 text-amber-800">แก้กลางเทอม</span>
            )}
          </p>
        )}

        {round && round.reasons.length > 0 && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="plan-reasons">
            <p className="font-semibold">ยังอัปเดตแผนจากรอบนี้ไม่ได้ เพราะ</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
              {round.reasons.map((r, i) => <li key={i} className="break-words">{r}</li>)}
            </ul>
          </div>
        )}

        {roundId !== null && view === null && <p className="text-xs text-gray-400">กำลังเทียบรอบกับแผนการสอน…</p>}
        {view?.error && (
          <p className="text-xs text-red-600">
            {view.error}{" "}
            <button onClick={() => setTick((n) => n + 1)} className="underline">ลองใหม่</button>
          </p>
        )}

        {data && (items.length === 0 ? (
          <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2" data-testid="plan-empty">
            แผนการสอนตรงกับรอบนี้แล้ว — ไม่มีอะไรต้องอัปเดต
          </p>
        ) : (
          <p className="text-sm text-gray-700" data-testid="plan-count">
            ต่างจากแผน <strong>{items.length.toLocaleString("th-TH")}</strong> ข้อ ใน {groups.length.toLocaleString("th-TH")} กอง ·
            เลือกแล้ว <strong>{selected.size.toLocaleString("th-TH")}</strong> ข้อ
          </p>
        ))}

        {groups.map((g) => {
          const keys = g.items.map((it) => it.key);
          const n = keys.filter((k) => selected.has(k)).length;
          const all = n === keys.length;
          return (
            <section key={g.pile} className="rounded-lg border border-gray-200" data-testid={`pile-${g.pile}`}>
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-gray-50 px-3 py-2 border-b border-gray-200 rounded-t-lg">
                <h4 className="text-sm font-bold text-gray-800">{g.label}</h4>
                <span className="text-xs text-gray-500 tabular-nums">{g.items.length.toLocaleString("th-TH")} ข้อ · เลือก {n.toLocaleString("th-TH")}</span>
                <label className={clsx("ml-auto flex items-center gap-1.5 text-xs text-gray-700", canTick && "cursor-pointer")}>
                  <input type="checkbox" checked={all} disabled={!canTick || locked} aria-label={`เลือกทั้งกอง ${g.label}`}
                    ref={(el) => { if (el) el.indeterminate = n > 0 && !all; }}
                    onChange={() => setSelected((s) => togglePile(s, items, g.pile, !all))} />
                  เลือกทั้งกอง
                </label>
              </header>
              {g.pile in PILE_HINT && <p className="px-3 pt-1.5 text-[11px] text-gray-500">{PILE_HINT[g.pile as Pile]}</p>}
              <ul className="divide-y divide-gray-100">{g.items.map(itemRow)}</ul>
            </section>
          );
        })}

        {data && (
          <div className="space-y-2">
            <Folded testId="plan-unknown" title="ไม่อยู่ในรอบ — ไม่ทำอะไร"
              note="แถวในแผนที่รอบไม่รู้จัก (เช่นแปลงจากแผนไม่ได้ หรือห้องไม่อยู่ในหลักสูตรของภาคเรียน) — คงไว้ตามเดิม ไม่ถูกเสนอให้ลบ"
              lines={data.unknown.map((u) => u.label)} />
            <Folded testId="plan-unmatched" title="จับคู่ไม่ได้ — ไม่ทำอะไร"
              note="ชุดคาบเสรี/กิจกรรมที่จับคู่ระหว่างรอบกับโปรแกรมไม่ได้ — ถ้าต้องเปลี่ยน แก้ในหน้าจัดคาบเอง"
              lines={data.unmatched_sets.map((u) => u.label)} />
            <Folded testId="plan-already" title="อยู่ในรายการงานแล้ว"
              note="ข้อที่ทำได้แค่เข้ารายการงาน และมีในรายการงาน (ยังไม่ทำ) อยู่แล้ว — ติ๊กซ้ำไม่ได้"
              lines={data.already_todo.map((a) => a.label)} />
          </div>
        )}

        {data && items.length > 0 && (
          <label className="block text-xs font-medium text-gray-600">
            รหัสผู้ดูแลระบบของเว็บลงอัตรากำลัง
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
              disabled={busy || !usable || locked}
              autoComplete="new-password"
              className="mt-0.5 block w-full sm:w-80 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
            />
          </label>
        )}
        {data && items.length > 0 && problem && !locked && <p className="text-xs text-gray-500 -mt-2">{problem}</p>}

        {err && (
          <div ref={errRef} className="flex flex-wrap items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
            data-testid="plan-error">
            <span className="flex-1 min-w-0 break-words">{err.text}</span>
            {!err.again && (
              <button onClick={refresh} disabled={busy}
                className="px-2 py-1 bg-white border border-red-300 rounded font-semibold hover:bg-red-100 disabled:opacity-40">
                ดูใหม่
              </button>
            )}
          </div>
        )}
        {result && (
          <div ref={resultRef} className="flex flex-wrap items-center gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"
            data-testid="plan-result">
            <span className="flex-1 min-w-0 break-words">{result.text}</span>
            {result.todos > 0 && (
              <button onClick={onShowTodos}
                className="px-2 py-1 bg-white border border-emerald-300 rounded font-semibold hover:bg-emerald-100">
                ดูรายการงาน
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
        <button onClick={close} disabled={busy}
          className="px-3 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-100 disabled:opacity-40">
          {result ? "ปิด" : "ยกเลิก"}
        </button>
        <button onClick={() => void confirm()} disabled={busy || locked || problem !== null}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 disabled:opacity-40">
          {busy ? "กำลังอัปเดต…" : `ยืนยัน ${selected.size.toLocaleString("th-TH")} ข้อ`}
        </button>
      </div>
    </ModalShell>
  );
};
