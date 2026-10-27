/**
 * CoteachMergeModal — เลือกว่าคาบไหนจะเป็นคาบที่ครูสองคนอยู่ด้วยกัน
 *
 *   "เวลาเลือกครูสอนร่วมทีหลัง คาบจะรวมกันเลย โดยจะมีหน้าต่างขึ้นมาให้เลือกว่า
 *    คาบไหนจะไปอยู่กับใคร เพราะตอนนี้คือมาใส่ทีหลังแล้วคาบไม่ขึ้น"
 *
 * `co_teacher_id` ถูกอ่านตอน "สร้างตาราง" เท่านั้น มาใส่ทีหลังจึงไม่ถึงคาบที่
 * ลงไปแล้ว — ชื่อครูสอนร่วมไม่ขึ้นในช่อง และถ้าครูอีกคนมีแถวของตัวเองอยู่ด้วย
 * ชั้นนั้นก็ยังเรียนวิชาเดิมสองรอบ หน้าต่างนี้ทำให้ "ใส่ทีหลัง" ได้ผลเท่ากับ
 * "ใส่ก่อนแล้วสร้างตาราง" โดยไม่ต้องรื้อตารางทั้งโรงเรียน
 *
 * ยังไม่แตะตารางจนกดยืนยัน — แผนที่เห็นมาจากเซิร์ฟเวอร์แบบขอดูเฉย ๆ
 */
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import { DAYS } from "../../types";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";

interface Props {
  reqId:       number;
  coTeacherId: number;
  onClose:     () => void;
  /** เรียกเมื่อรวมเสร็จ เพื่อให้หน้าที่เรียกมาอัปเดตแถวของตัวเอง */
  onDone?:     (message: string) => void;
}

export const CoteachMergeModal: React.FC<Props> = ({
  reqId, coTeacherId, onClose, onDone,
}) => {
  const loadSlots = useTimetableStore((s) => s.loadSlots);
  const loadAll   = useTimetableStore((s) => s.loadAll);
  const [plan, setPlan] = useState<api.CoteachPlan | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [err,  setErr]  = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.coteachPlan(reqId, coTeacherId)
      .then((p) => {
        if (!alive) return;
        setPlan(p);
        setKeep(new Set(p.suggest));
      })
      .catch((e) => alive && setErr(api.errorDetail(e, "ขอแผนรวมคาบไม่สำเร็จ")));
    return () => { alive = false; };
  }, [reqId, coTeacherId]);

  const cells = plan?.cells ?? [];
  const dropped = useMemo(() => cells.filter((c) => !keep.has(c.slot_id)), [cells, keep]);
  const lockedDrop = dropped.filter((c) => c.is_locked);
  const clashKept = useMemo(
    () => cells.filter((c) => keep.has(c.slot_id) && !c.ok), [cells, keep]);

  const toggle = (id: number) => setKeep((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const apply = async () => {
    if (!plan) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.coteachApply(reqId, coTeacherId, [...keep]);
      await loadAll();
      await loadSlots();
      onDone?.(r.message);
      onClose();
    } catch (e) {
      setErr(api.errorDetail(e, "รวมคาบไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl" tall>
      <div className="px-4 py-2.5 border-b border-gray-200 bg-gradient-to-r from-violet-50 to-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">👥</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-800">
              รวมคาบให้เป็นคาบสอนร่วม
            </div>
            <div className="text-[11px] text-gray-500 truncate">
              {plan
                ? `${plan.group_name} ${plan.subject_code} · ${plan.teacher_name} + ${plan.co_teacher_name}`
                : "กำลังอ่านตาราง…"}
            </div>
          </div>
          <button onClick={onClose}
            className="ml-auto w-7 h-7 rounded hover:bg-gray-200 text-gray-500 shrink-0">✕</button>
        </div>
      </div>

      {err && (
        <div className="mx-4 mt-2 px-3 py-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800 shrink-0">
          {err}
        </div>
      )}

      {!plan ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
          กำลังอ่านตาราง…
        </div>
      ) : cells.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="text-2xl">📭</div>
          <div className="text-xs text-gray-600">
            วิชานี้ยังไม่มีคาบไหนลงในตาราง — ตั้งครูสอนร่วมไว้ได้เลย
            แล้วคาบจะมีครูทั้งสองคนตั้งแต่ตอนสร้างตารางรอบหน้า
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 py-2 border-b border-gray-100 shrink-0 space-y-1">
            <div className="text-[11px] text-gray-700">
              ตอนนี้ชั้นนี้เรียนวิชานี้ <b>{cells.length} คาบ</b>
              {plan.theirs > 0 && (
                <> — ของ {plan.teacher_name} {plan.mine} คาบ และของ{" "}
                  {plan.co_teacher_name} อีก {plan.theirs} คาบ แยกกันอยู่</>
              )}
              {plan.want > 0 && <> · หลักสูตรกำหนดไว้ {plan.want} คาบ</>}
            </div>
            <div className="text-[10px] text-gray-500">
              ติ๊กคาบที่จะเก็บไว้ — คาบที่เก็บจะมีครูทั้งสองคนอยู่ด้วยกัน
              ที่ไม่ติ๊กจะถูกลบออกจากตาราง
            </div>
            <div className="flex items-center gap-2 text-[11px] pt-0.5">
              <span className={clsx("px-1.5 py-0.5 rounded font-semibold",
                plan.want > 0 && keep.size === plan.want
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800")}>
                เก็บไว้ {keep.size} คาบ
              </span>
              {plan.want > 0 && keep.size !== plan.want && (
                <span className="text-amber-700">
                  หลักสูตรกำหนด {plan.want} คาบ — ต่างกันอยู่
                  {keep.size > plan.want ? " (เกิน)" : " (ขาด)"}
                </span>
              )}
              <button onClick={() => setKeep(new Set(plan.suggest))}
                className="ml-auto text-[11px] text-violet-700 hover:underline">
                เลือกตามที่แนะนำ
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr className="text-gray-500 text-[10px]">
                  <th className="px-3 py-1.5 text-left font-semibold w-10">เก็บ</th>
                  <th className="px-2 py-1.5 text-left font-semibold">เวลา</th>
                  <th className="px-2 py-1.5 text-left font-semibold">ตอนนี้เป็นคาบของ</th>
                  <th className="px-2 py-1.5 text-left font-semibold">ห้อง</th>
                  <th className="px-2 py-1.5 text-left font-semibold">ครูอีกคนว่างไหม</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((c) => {
                  const on = keep.has(c.slot_id);
                  return (
                    <tr key={c.slot_id}
                        onClick={() => toggle(c.slot_id)}
                        className={clsx("border-b border-gray-100 cursor-pointer",
                          on ? "bg-violet-50/60 hover:bg-violet-100/60"
                             : "hover:bg-gray-50 text-gray-400")}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={on} readOnly
                               className="accent-violet-600 pointer-events-none" />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className={on ? "text-gray-800 font-medium" : ""}>
                          {DAYS[c.day]} คาบ {c.period}
                        </span>
                        {c.double && (
                          <span className="ml-1 px-1 rounded bg-violet-100 text-violet-700 text-[9px]">คู่</span>
                        )}
                        {c.is_locked && (
                          <span className="ml-1 px-1 rounded bg-slate-200 text-slate-700 text-[9px]">🔒</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 truncate">{c.teacher_name}</td>
                      <td className="px-2 py-1.5">{c.room_name ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {c.ok ? (
                          <span className="text-emerald-700">ว่าง</span>
                        ) : (
                          <span className="text-rose-700">{c.why}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 shrink-0 space-y-1">
            {lockedDrop.length > 0 && (
              <div className="text-[10px] text-rose-700">
                🔒 มีคาบที่ล็อกไว้ {lockedDrop.length} คาบอยู่ในคาบที่จะถูกลบ —
                ติ๊กเก็บไว้ หรือไปปลดล็อกก่อน
              </div>
            )}
            {clashKept.length > 0 && (
              <div className="text-[10px] text-amber-700">
                ⚠️ คาบที่เก็บไว้ {clashKept.length} คาบ ครูอีกคนติดสอนอยู่ —
                เก็บไว้ได้ แต่จะกลายเป็นคาบที่ครูอยู่สองที่พร้อมกัน
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">
                {dropped.length > 0
                  ? `จะลบออกจากตาราง ${dropped.length} คาบ`
                  : "ไม่มีคาบไหนถูกลบ"}
              </span>
              <button onClick={onClose}
                className="ml-auto px-2.5 py-1 text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-100">
                ยกเลิก
              </button>
              <button onClick={() => void apply()}
                disabled={busy || keep.size === 0 || lockedDrop.length > 0}
                title={keep.size === 0 ? "ต้องเก็บไว้อย่างน้อยหนึ่งคาบ"
                  : lockedDrop.length > 0 ? "มีคาบที่ล็อกไว้จะถูกลบ"
                  : "รวมคาบตามที่ติ๊กไว้"}
                className="px-3 py-1 text-[11px] rounded bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:bg-violet-300">
                {busy ? "กำลังรวม…" : `✓ รวมเป็น ${keep.size} คาบ`}
              </button>
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
};
