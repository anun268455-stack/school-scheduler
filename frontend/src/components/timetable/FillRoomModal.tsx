/**
 * FillRoomModal — กดคาบว่างของห้องสอน แล้วเจาะจงว่าจะเอาคาบไหนมาลง
 *
 *   "ห้องหมวดว่างแล้ว ต้องการให้ครูหมวดวิทย์เข้าไปให้ได้ คือมีโหมดที่ช่วยเวลา
 *    กดคาบว่างของห้อง สามารถเจาะจงวิชาของครูคนนั้นให้มาลงได้ โดยจะสลับห้องให้
 *    ลงได้ไม่ว่าจะยาวขนาดไหน จะเลื่อนครูกี่คน แต่จะมีทางเลือกให้เลื่อนเป็น
 *    หน้าต่างเล็กๆขึ้นมา ให้เลื่อนไปทีละลำดับ"
 *
 * หน้าต่างเดียวทำสองงาน ต่อกันเป็นลำดับ:
 *
 *   ขั้นเลือก  — เจาะจงหมวด/ครู/วิชา แล้วเลือกคาบที่จะเอามาลง
 *   ขั้นไล่ทาง — ถ้าคาบนั้นต้องเบียดใคร ก็ไล่หาที่ให้คนนั้นต่อทีละขั้น
 *                ในหน้าต่างเดิม จนไม่มีใครค้าง แล้วกดลงมือทีเดียว
 *
 * ยังไม่แตะตารางจนกดลงมือ — ทุกขั้นคิดบนตารางเสมือน เหมือนโหมดนำทาง และใช้
 * เครื่องคิดตัวเดียวกัน (utils/guidedMove) จึงไม่มีทางที่สองหน้าจะบอกคนละอย่าง
 */
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import { DAYS } from "../../types";
import type { TimetableSlot } from "../../types";
import { useTimetableStore } from "../../store/timetableStore";
import {
  fillPlan, teachersWithCandidates, type FillCandidate,
} from "../../utils/fillRoom";
import {
  chooseOption, optionsAll, trimOptions, verdictAt,
  type GuidedOption, type GuidedStep,
} from "../../utils/guidedMove";
import { previewSlots } from "../../utils/guidedMove";

interface Props {
  roomId: number;
  day:    number;
  period: number;
  /** ชื่อคาบอย่างที่หัวตารางเขียน */
  periodName: string;
  onClose: () => void;
}

export const FillRoomModal: React.FC<Props> = ({ roomId, day, period, periodName, onClose }) => {
  const slots       = useTimetableStore((s) => s.slots);
  const rooms       = useTimetableStore((s) => s.rooms);
  const teachers    = useTimetableStore((s) => s.teachers);
  const periods     = useTimetableStore((s) => s.periods);
  const groups      = useTimetableStore((s) => s.groups);
  const subjects    = useTimetableStore((s) => s.subjects);
  const departments = useTimetableStore((s) => s.departments);
  const swapRoom    = useTimetableStore((s) => s.swapRoom);
  const fillApply   = useTimetableStore((s) => s.fillApply);

  const room = rooms.find((r) => r.id === roomId) ?? null;
  const world = useMemo(() => ({ slots, rooms, teachers, periods, groups, subjects }),
                        [slots, rooms, teachers, periods, groups, subjects]);

  // ── ขั้นเลือก ─────────────────────────────────────────────────────────
  // ห้องเฉพาะหมวดไหน ก็ตั้งหมวดนั้นไว้ให้เลย — คนกดคาบว่างของแล็บวิทย์
  // ย่อมอยากเห็นคาบวิทย์ก่อน ไม่ใช่ทั้งโรงเรียน
  const [deptId, setDeptId]       = useState<number | null>(room?.specialized_dept_id ?? null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [text, setText]           = useState("");
  const boxRef = useRef<HTMLInputElement>(null);
  useEffect(() => { boxRef.current?.focus(); }, []);

  // ห้องเรียนทั่วไปที่ไม่ได้กันไว้ให้ใครมีคาบเข้าเกณฑ์ถึง 2,200 รายการ คิดรอบละ
  // ~90 ms — พอคิดใหม่ทุกตัวอักษรที่พิมพ์ ช่องค้นจะหนืด จึงรอให้หยุดพิมพ์ก่อน
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setText(typed), 150);
    return () => clearTimeout(id);
  }, [typed]);

  const plan = useMemo(
    () => fillPlan(world, roomId, day, period, { deptId, teacherId, text }, 40),
    [world, roomId, day, period, deptId, teacherId, text],
  );
  const teacherOpts = useMemo(
    () => teachersWithCandidates(world, roomId, day, period, deptId),
    [world, roomId, day, period, deptId],
  );

  // ── ขั้นไล่ทาง ────────────────────────────────────────────────────────
  const [steps, setSteps]   = useState<GuidedStep[]>([]);
  const [moving, setMoving] = useState<TimetableSlot | null>(null);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const movingLive = useMemo(() => {
    if (!moving) return null;
    return previewSlots(slots, steps, rooms).find((s) => s.id === moving.id) ?? moving;
  }, [moving, steps, slots, rooms]);

  const options = useMemo(() => {
    if (!movingLive) return [];
    return trimOptions(optionsAll(world, movingLive, steps), 8);
  }, [world, movingLive, steps]);

  /** เลือกคาบนี้มาลงช่องที่กดมา — ขั้นแรกของเส้นทาง */
  const start = (c: FillCandidate) => {
    setErr(null);
    if (c.kind === "ย้ายห้อง") {
      // ไม่ต้องไล่อะไร สอนอยู่เวลานั้นพอดีแล้ว เปลี่ยนห้องเดียวจบ
      setBusy(true);
      void Promise.resolve(swapRoom(c.slot.id, roomId)).finally(() => {
        setBusy(false); onClose();
      });
      return;
    }
    if (c.lockedBy) {
      setErr(`🔒 ${c.lockedBy.group_name} ${c.lockedBy.subject_code} ล็อกไว้ตรงนี้ — ปลดล็อกก่อน`);
      return;
    }
    const v = verdictAt(world, c.slot, [], day, period);
    if (!v) { setErr("คาบนี้ลงช่องนั้นไม่ได้ — มีคาบที่ล็อกไว้ขวางอยู่"); return; }
    // ขั้นแรกต้องลงห้องที่กดมา ไม่ใช่ห้องที่ระบบเลือกเอง — นั่นคือทั้งหมด
    // ของเรื่องนี้ ("ต้องการให้ครูหมวดวิทย์เข้าไปให้ได้")
    const pinned: GuidedOption = { ...v, roomId, roomName: room?.name ?? null };
    const r = chooseOption(world, c.slot, [], pinned);
    setSteps(r.steps);
    setMoving(r.next);
  };

  /** เลือกทางของขั้นถัดไป */
  const pick = (o: GuidedOption) => {
    if (!movingLive) return;
    setErr(null);
    const r = chooseOption(world, movingLive, steps, o);
    setSteps(r.steps);
    setMoving(r.next);
  };

  const back = () => {
    if (!steps.length) return;
    const last = steps[steps.length - 1];
    setSteps(steps.slice(0, -1));
    setMoving(slots.find((s) => s.id === last.slotId) ?? null);
    setErr(null);
  };

  const reset = () => { setSteps([]); setMoving(null); setErr(null); };

  const apply = async () => {
    if (!steps.length || moving) return;
    setBusy(true);
    const problem = await fillApply(steps);
    setBusy(false);
    if (problem) { setErr(problem); return; }
    onClose();
  };

  const deptName = (id: number | null) =>
    departments.find((d) => d.id === id)?.name ?? "ทุกหมวด";

  const inChain = steps.length > 0;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl" tall>
      {/* หัวเรื่อง — บอกให้ชัดว่ากำลังเติมช่องไหนของห้องไหน */}
      <div className="px-4 py-2.5 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🎯</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-800 truncate">
              เอาคาบมาลง {room?.name ?? `ห้อง #${roomId}`}
            </div>
            <div className="text-[11px] text-gray-500">
              {DAYS[day]} · {periodName}
              {room?.specialized_dept_id != null && (
                <> · ห้องเฉพาะ{deptName(room.specialized_dept_id)}</>
              )}
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

      {/* ── ขั้นไล่ทาง ─────────────────────────────────────────────────── */}
      {inChain ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {/* เส้นทางที่ตกลงไว้แล้ว */}
          <ol className="space-y-1">
            {steps.map((st, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-gray-700">
                <span className="w-4 text-right text-gray-400">{i + 1}.</span>
                <span>
                  <b>{st.label}</b> {DAYS[st.fromDay]} คาบ {st.fromPeriod}
                  {" → "}{DAYS[st.day]} คาบ {st.period}
                  <span className={clsx("ml-1",
                    st.roomId === roomId ? "text-indigo-700 font-semibold" : "text-gray-500")}>
                    {st.roomName ? `· ${st.roomName}` : "· ยังไม่มีห้อง"}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          {movingLive ? (
            <>
              <div className="px-3 py-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900">
                ตอนนี้ต้องหาที่ให้ <b>{movingLive.group_name} {movingLive.subject_code}</b>
                {" "}({movingLive.teacher_name}) — เลือกทางข้างล่าง
              </div>
              {options.length === 0 ? (
                <div className="text-[11px] text-rose-700">
                  ไม่มีที่ให้คาบนี้ไปเลย — กด “ย้อนขั้น” แล้วลองทางอื่น
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {options.map((o) => (
                    <button key={`${o.day}-${o.period}`} onClick={() => pick(o)}
                      className={clsx("px-2 py-1.5 rounded border text-left leading-tight",
                        o.kind === "ว่าง"  ? "border-emerald-400 bg-emerald-50 hover:bg-emerald-100"
                        : o.kind === "สลับ" ? "border-sky-400 bg-sky-50 hover:bg-sky-100"
                        : "border-amber-400 bg-amber-50 hover:bg-amber-100")}>
                      <div className="text-[11px] font-semibold text-gray-800">
                        {DAYS[o.day]} คาบ {o.period}
                        <span className="ml-1 font-normal text-[10px] text-gray-500">{o.kind}</span>
                      </div>
                      <div className="text-[10px] text-gray-600">{o.note}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              ครบแล้ว — ไม่มีคาบไหนค้าง กด “ลงมือทำทั้งชุด” เพื่อย้ายจริง
            </div>
          )}
        </div>
      ) : (
        /* ── ขั้นเลือก ─────────────────────────────────────────────────── */
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ตัวกรอง */}
          <div className="px-4 py-2 border-b border-gray-100 space-y-1.5">
            <div className="flex gap-1.5">
              <select value={deptId ?? ""} disabled={room?.specialized_dept_id != null}
                onChange={(e) => { setDeptId(e.target.value ? Number(e.target.value) : null);
                                   setTeacherId(null); }}
                className="text-[11px] border border-gray-300 rounded px-1.5 py-1 bg-white disabled:bg-gray-100 disabled:text-gray-500">
                <option value="">ทุกหมวด</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={teacherId ?? ""}
                onChange={(e) => setTeacherId(e.target.value ? Number(e.target.value) : null)}
                className="text-[11px] border border-gray-300 rounded px-1.5 py-1 bg-white flex-1 min-w-0">
                <option value="">ครูทุกคนที่ใช้ห้องนี้ได้</option>
                {teacherOpts.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.n})</option>
                ))}
              </select>
            </div>
            <input ref={boxRef} value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder="ค้นรหัสวิชา ชื่อวิชา ชื่อครู หรือชั้น…"
              className="w-full text-[11px] border border-gray-300 rounded px-2 py-1" />
          </div>

          {/* บอกเหตุเมื่อไม่มีอะไรให้เลือก — การกันห้องให้ครูเฉพาะกลุ่มคือ
              เหตุผลหลักที่แล็บว่างทั้งที่มีคาบวิทย์นั่งอยู่ห้องอื่น */}
          {plan.candidates.length === 0 ? (
            <div className="px-4 py-6 text-center space-y-2">
              <div className="text-2xl">🚧</div>
              <div className="text-xs text-gray-700 max-w-sm mx-auto">{plan.why}</div>
            </div>
          ) : (
            <>
              {plan.reservedFor.length > 0 && (
                <div className="mx-4 mt-2 px-2.5 py-1.5 rounded bg-sky-50 border border-sky-200 text-[10px] text-sky-900">
                  ห้องนี้กันไว้ให้ {plan.reservedFor.map((t) => t.name).join(" · ")} เท่านั้น
                  {plan.blockedByReservation > 0 && (
                    <> — ถ้าเลิกกันห้อง จะมีคาบให้เลือกอีก {plan.blockedByReservation} คาบ
                      (แก้ได้ที่ ⚙ จัดการ › ห้องเรียน)</>
                  )}
                </div>
              )}
              <Section
                title="ย้ายห้องอย่างเดียว — ไม่มีใครต้องเลื่อน"
                tone="emerald"
                rows={plan.candidates.filter((c) => c.kind === "ย้ายห้อง")}
                onPick={start} disabled={busy}
              />
              <Section
                title="ดึงมาจากเวลาอื่น — จะไล่หาที่ให้คาบที่ถูกเบียดทีละขั้น"
                tone="sky"
                rows={plan.candidates.filter((c) => c.kind === "ย้ายเวลา")}
                onPick={start} disabled={busy}
              />
              {plan.found > plan.candidates.length && (
                <div className="px-4 py-2 text-[10px] text-gray-400">
                  แสดง {plan.candidates.length} จาก {plan.found} รายการ — พิมพ์ค้นเพื่อแคบลง
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ท้ายหน้าต่าง */}
      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex items-center gap-1.5 shrink-0">
        {inChain ? (
          <>
            <button onClick={back} disabled={busy}
              className="px-2.5 py-1 text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40">
              ↩ ย้อนขั้น
            </button>
            <button onClick={reset} disabled={busy}
              className="px-2.5 py-1 text-[11px] rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40">
              ✕ เริ่มใหม่
            </button>
            <span className="ml-auto" />
            <button onClick={() => void apply()} disabled={busy || moving != null}
              title={moving != null ? "ยังมีคาบที่ต้องหาที่ให้ — เลือกให้ครบก่อน" : "ย้ายทั้งชุดทีเดียว"}
              className="px-3 py-1 text-[11px] rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:bg-emerald-300">
              {busy ? "กำลังย้าย…" : `✓ ลงมือทำทั้งชุด (${steps.length})`}
            </button>
          </>
        ) : (
          <>
            <span className="text-[10px] text-gray-500">
              เลือกคาบที่จะเอามาลงช่องนี้ — ยังไม่แตะตารางจนกดลงมือ
            </span>
            <button onClick={onClose}
              className="ml-auto px-2.5 py-1 text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-100">
              ปิด
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
};

const TONE = {
  emerald: "border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/70",
  sky:     "border-sky-200 bg-sky-50/40 hover:bg-sky-100/60",
} as const;

const Section: React.FC<{
  title: string;
  tone: keyof typeof TONE;
  rows: FillCandidate[];
  onPick: (c: FillCandidate) => void;
  disabled: boolean;
}> = ({ title, tone, rows, onPick, disabled }) => {
  if (!rows.length) return null;
  return (
    <div className="px-4 pt-2.5">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {title} <span className="text-gray-400">({rows.length})</span>
      </div>
      <div className="space-y-1">
        {rows.map((c) => (
          <button key={c.slot.id} onClick={() => onPick(c)} disabled={disabled || !!c.lockedBy}
            className={clsx("w-full text-left px-2.5 py-1.5 rounded border transition-colors",
              TONE[tone], (disabled || c.lockedBy) && "opacity-50 cursor-not-allowed")}>
            <div className="flex items-baseline gap-1.5 text-[11px]">
              <b className="text-gray-800">{c.slot.group_name}</b>
              <span className="text-gray-700">{c.slot.subject_code}</span>
              {c.isDouble && (
                <span className="px-1 rounded bg-violet-100 text-violet-700 text-[9px] shrink-0">คู่</span>
              )}
              <span className="text-gray-500 truncate">{c.slot.teacher_name}</span>
              <span className="ml-auto text-[10px] text-gray-400 shrink-0">
                {DAYS[c.slot.day]} คาบ {c.slot.period}
              </span>
            </div>
            <div className="text-[10px] text-gray-600">{c.note}</div>
          </button>
        ))}
      </div>
    </div>
  );
};
