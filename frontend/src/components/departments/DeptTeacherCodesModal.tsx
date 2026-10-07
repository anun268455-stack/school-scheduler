/**
 * รหัสประจำตัวครูตามกลุ่มสาระ — drag the names, the numbers follow.
 *
 * ภาษาไทย starts at 101, so its first teacher is 101, the second 102. The
 * order is the school's to decide — seniority, not the alphabet — so it is
 * dragged into place here and the codes are read off the positions.
 *
 * Dragging is done with the browser's own drag events rather than the grid's
 * dnd-kit setup: a plain vertical list does not need it, and HTML5 dragging
 * does not work on a touchscreen at all. The ▲▼ buttons beside each name are
 * not a fallback nobody uses — on the tablets a staffroom actually has, they
 * are the only way to do this.
 */
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { ModalShell } from "../common/ModalShell";
import type { Department, Teacher } from "../../types";

interface Props {
  department: Department;
  onClose: () => void;
}

export const DeptTeacherCodesModal: React.FC<Props> = ({ department, onClose }) => {
  const { teachers } = useTimetableStore();

  const mine = useMemo(
    () => teachers
      .filter((t) => t.department_id === department.id)
      .sort((a, b) => {
        const ao = a.dept_order, bo = b.dept_order;
        if (ao == null && bo == null) return (a.name ?? "").localeCompare(b.name ?? "");
        if (ao == null) return 1;          // not yet ordered — keep at the end
        if (bo == null) return -1;
        return ao - bo;
      }),
    [teachers, department.id],
  );

  const [order, setOrder] = useState<number[]>([]);
  const [base, setBase]   = useState(String(department.code_base ?? 101));
  const [busy, setBusy]   = useState(false);
  const [note, setNote]   = useState<string | null>(null);
  const [drag, setDrag]   = useState<number | null>(null);
  const [over, setOver]   = useState<number | null>(null);

  useEffect(() => { setOrder(mine.map((t) => t.id)); }, [mine]);

  const byId = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const rows = order.map((id) => byId.get(id)).filter((t): t is Teacher => !!t);

  const baseNum = Number(base);
  const baseOk = /^\d+$/.test(base.trim()) && baseNum >= 0;
  const codeAt = (i: number) => (baseOk ? String(baseNum + i) : "?");

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setOrder(next);
    setNote(null);
  };

  const save = async () => {
    if (!baseOk) return;
    setBusy(true); setNote(null);
    try {
      const res = await api.renumberDepartment(department.id, {
        code_base: baseNum, teacher_ids: order,
      });
      // Fold the new codes back into the page rather than reloading the lot.
      const fresh = new Map(res.teachers.map((t) => [t.id, t]));
      useTimetableStore.setState((st) => ({
        teachers: st.teachers.map((t) => {
          const f = fresh.get(t.id);
          return f ? { ...t, code: f.code, dept_order: f.dept_order } : t;
        }),
        departments: st.departments.map((d) =>
          d.id === department.id ? { ...d, code_base: res.code_base } : d),
      }));
      setNote(res.changed.length === 0
        ? "รหัสตรงกับที่ตั้งไว้อยู่แล้ว ไม่มีอะไรเปลี่ยน"
        : `บันทึกแล้ว — เปลี่ยนรหัส ${res.changed.length} คน จากทั้งหมด ${res.count} คน`);
    } catch {
      setNote("บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center gap-3 bg-emerald-700 px-5 py-4 shrink-0">
        <span className="text-2xl">🔢</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            รหัสประจำตัวครู — {department.name}
          </h2>
          <p className="text-emerald-100 text-xs mt-0.5">
            ลากชื่อขึ้นลงเพื่อจัดลำดับ รหัสจะเรียงตามลำดับให้อัตโนมัติ
          </p>
        </div>
        <button onClick={onClose} className="text-emerald-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="px-5 pt-4 shrink-0">
        <label className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-700">รหัสเริ่มต้นของกลุ่มสาระนี้</span>
          <input
            value={base}
            onChange={(e) => { setBase(e.target.value); setNote(null); }}
            inputMode="numeric"
            className={clsx("w-28 border rounded-lg px-3 py-1.5 text-sm font-mono",
              baseOk ? "border-gray-300" : "border-red-400 bg-red-50")}
          />
          <span className="text-[11px] text-gray-500">
            {baseOk
              ? `คนแรกได้ ${codeAt(0)} · คนที่สอง ${codeAt(1)} · ไล่ไปเรื่อยๆ`
              : "ต้องเป็นตัวเลขเท่านั้น"}
          </span>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {rows.length === 0 ? (
          <p className="text-center text-xs text-gray-400 py-8">
            ยังไม่มีครูในกลุ่มสาระนี้ — ไปกำหนดกลุ่มสาระให้ครูที่หน้า "ครูผู้สอน" ก่อน
          </p>
        ) : (
          <div className="space-y-1">
            {rows.map((t, i) => (
              <div
                key={t.id}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => { e.preventDefault(); setOver(i); }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag != null) move(drag, i);
                  setDrag(null); setOver(null);
                }}
                className={clsx(
                  "flex items-center gap-2 p-2 rounded-lg border bg-white transition-colors",
                  drag === i && "opacity-40",
                  over === i && drag !== i ? "border-emerald-500 bg-emerald-50" : "border-gray-200",
                )}
              >
                <span className="cursor-grab text-gray-300 select-none px-1" title="ลากเพื่อจัดลำดับ">⠿</span>
                <span className="font-mono text-sm font-bold text-emerald-700 w-14 shrink-0">
                  {codeAt(i)}
                </span>
                <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{t.name}</span>
                {t.code && t.code !== codeAt(i) && (
                  <span className="text-[10px] text-gray-400 shrink-0">เดิม {t.code}</span>
                )}
                <span className="flex gap-0.5 shrink-0">
                  <button onClick={() => move(i, i - 1)} disabled={i === 0}
                    className="px-1.5 py-0.5 text-xs border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-25"
                    title="เลื่อนขึ้น">▲</button>
                  <button onClick={() => move(i, i + 1)} disabled={i === rows.length - 1}
                    className="px-1.5 py-0.5 text-xs border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-25"
                    title="เลื่อนลง">▼</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 shrink-0">
        {note && (
          <p className="text-xs font-semibold text-emerald-800 bg-white border border-emerald-300 rounded px-2.5 py-1.5 mb-2">
            {note}
          </p>
        )}
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-gray-500 flex-1 leading-relaxed">
            บนแท็บเล็ตที่ลากไม่ได้ ใช้ปุ่ม ▲▼ แทนได้ ·
            รหัสจะถูกเขียนทับของเดิมเมื่อกดบันทึก
          </p>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ปิด</button>
          <button onClick={save} disabled={busy || !baseOk || rows.length === 0}
            className="px-5 py-2 text-sm bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800 disabled:opacity-40">
            {busy ? "กำลังบันทึก…" : "บันทึกรหัส"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
