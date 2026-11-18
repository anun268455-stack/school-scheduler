/**
 * รายการงานที่ต้องไปแก้เอง (ทาง ข. แบบข้อ 4.4) — ในแผงเทอม ที่เดียวกับปุ่มสร้างเทอมใหม่
 *
 * ข้อมาจากการอัปเดตแผนจากรอบอัตรากำลัง: คาบที่ลงไว้แล้วไม่ถูกแตะ สิ่งที่ต้องไปแก้เองในหน้าจัดคาบจึงมาอยู่ที่นี่ ·
 * สถานะคิดสดที่เซิร์ฟเวอร์จากแผนเทียบคาบ (ขาด/เกินแผน/ยังเป็นครูเดิม) ข้อจึงเป็น "เรียบร้อย" เองเมื่อแก้แล้ว ·
 * ข้อคาบเสรี/กิจกรรมไม่มีเงื่อนไขอัตโนมัติ → กด "ทำแล้ว" เอง
 *
 * คำตัดสินผู้คุมข้อ 3: ข้อค้างแสดงเสมอ (ซ่อนไม่ได้ — หายเองเมื่อแก้) · "ทำแล้ว" = ซ่อนข้อที่เรียบร้อย · ข้อที่ซ่อนเอากลับมาได้
 * แผงนี้อ่านและกดได้แค่ "ทำแล้ว"/"เอากลับมา" — ไม่แตะคาบหรือแผน และไม่แตะหน้าจัดคาบ
 */
import React, { useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { termErrorText, TODO_KIND_TEXT, todoActions, todoSummary, todoView, type PlanTodo } from "../../utils/terms";

interface Props {
  todos: PlanTodo[];
  /** ข้อที่เซิร์ฟเวอร์ตอบกลับหลังกด (สถานะสดของข้อนั้น) */
  onChanged: (todo: PlanTodo) => void;
  onReload: () => void;
  loading: boolean;
  error: string | null;
}

export const PlanTodoPanel = React.forwardRef<HTMLDivElement, Props>(({ todos, onChanged, onReload, loading, error }, ref) => {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sum = todoSummary(todos);
  const view = todoView(todos);

  const mark = async (t: PlanTodo, done: boolean) => {
    if (busy !== null) return;
    setBusy(t.id); setErr(null);
    try {
      onChanged(await api.markPlanTodo(t.id, done));
    } catch (e) {
      setErr(termErrorText(e, "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง"));
    } finally { setBusy(null); }
  };

  const row = (t: PlanTodo) => {
    const acts = todoActions(t);
    const open = t.state === "open";
    return (
      <li key={t.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2" data-testid={`todo-${t.id}`}>
        <span className={clsx("mt-0.5 shrink-0 text-[11px] px-2 py-0.5 rounded-full border",
          !open ? "bg-emerald-50 border-emerald-300 text-emerald-800"
            : t.kind === "set" ? "bg-blue-50 border-blue-300 text-blue-800" : "bg-amber-50 border-amber-300 text-amber-800")}>
          {open ? (TODO_KIND_TEXT[t.kind] ?? "ต้องแก้เอง") : "เรียบร้อย"}
        </span>
        <span className="min-w-0 flex-1 basis-56">
          <span className="block text-sm text-gray-800 break-words">{t.text}</span>
          {t.detail && (
            <span className={clsx("block text-xs break-words", open ? "text-amber-800" : "text-emerald-700")}>{t.detail}</span>
          )}
        </span>
        {(acts.done || acts.undo) && (
          <button onClick={() => void mark(t, acts.done)} disabled={busy !== null}
            className={clsx("shrink-0 px-2 py-1 text-xs rounded border disabled:opacity-40",
              acts.done ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : "border-gray-300 text-gray-700 hover:bg-gray-100")}>
            {busy === t.id ? "กำลังบันทึก…" : acts.done ? "ทำแล้ว" : "เอากลับมา"}
          </button>
        )}
      </li>
    );
  };

  return (
    <div ref={ref} className="mt-4 rounded-lg border border-gray-200 scroll-mt-28" data-testid="plan-todos">
      <div className="flex flex-wrap items-center gap-2 bg-gray-50 px-3 py-2 border-b border-gray-200 rounded-t-lg">
        <h3 className="text-sm font-bold text-gray-800">รายการงานที่ต้องไปแก้เอง</h3>
        <span className={clsx("text-xs px-2 py-0.5 rounded-full border tabular-nums",
          sum.open > 0 ? "bg-amber-100 border-amber-300 text-amber-900" : "bg-gray-100 border-gray-300 text-gray-600")}
          data-testid="todo-open-count">
          ค้าง {sum.open.toLocaleString("th-TH")}
        </span>
        <span className="text-xs text-gray-500 tabular-nums">เรียบร้อย {sum.resolved.toLocaleString("th-TH")}</span>
        <button onClick={onReload} disabled={loading}
          className="ml-auto px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">
          {loading ? "กำลังโหลด…" : "↻ ตรวจสถานะใหม่"}
        </button>
      </div>
      <p className="px-3 pt-1.5 text-[11px] text-gray-500">
        มาจากการอัปเดตแผนจากรอบอัตรากำลัง (คาบที่ลงไว้ไม่ถูกแตะ) · สถานะคิดจากแผนเทียบคาบที่ลงไว้ตอนนี้ — แก้ในหน้าจัดคาบแล้วข้อจะเป็น
        “เรียบร้อย” เอง · ข้อคาบเสรี/กิจกรรม กด “ทำแล้ว” เมื่อแก้เสร็จ
      </p>
      {view.open.length === 0 && view.resolved.length === 0 && (
        <p className="px-3 py-2 text-xs text-gray-500">ไม่มีข้อค้าง</p>
      )}
      {(view.open.length > 0 || view.resolved.length > 0) && (
        <ul className="divide-y divide-gray-100">
          {view.open.map(row)}
          {view.resolved.map(row)}
        </ul>
      )}
      {view.hidden.length > 0 && (
        <details className="border-t border-gray-100 px-3 py-2" data-testid="todo-hidden">
          <summary className="cursor-pointer select-none text-xs text-gray-600">
            ข้อที่ซ่อนไว้ ({view.hidden.length.toLocaleString("th-TH")})
          </summary>
          <ul className="mt-1 divide-y divide-gray-100">{view.hidden.map(row)}</ul>
        </details>
      )}
      {(err || error) && <p className="px-3 pb-2 text-xs text-red-600">{err ?? error}</p>}
    </div>
  );
});
PlanTodoPanel.displayName = "PlanTodoPanel";
