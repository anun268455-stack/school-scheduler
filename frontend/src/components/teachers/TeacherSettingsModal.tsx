/**
 * TeacherSettingsModal — one teacher's own rules, in a dialog.
 *
 * These were a strip that unfolded inside the table row, which left no room to
 * say what any of them do. They also, until now, did nothing: the solver read
 * only the consecutive limit, so a day off was decoration. Each setting here is
 * one the timetable actually obeys, and each says so.
 */
import React, { useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { ModalShell } from "../common/ModalShell";
import { periodsForLevel } from "../../utils/levels";
import { DAYS } from "../../types";
import type { Teacher, TeacherAdvanced } from "../../types";

interface Props {
  teacher: Teacher;
  /** The school's figures, shown as the default each setting falls back to. */
  schoolMaxConsecutive: number;
  schoolMinLastPeriod: number;
  onClose: () => void;
}

export const TeacherSettingsModal: React.FC<Props> = ({
  teacher, schoolMaxConsecutive, schoolMinLastPeriod, onClose,
}) => {
  const { periods, slots } = useTimetableStore();
  const adv = teacher.advanced_settings ?? {};

  const [daysOff, setDaysOff]   = useState<number[]>(adv.days_off ?? []);
  const [avoid, setAvoid]       = useState<number[]>(adv.avoid_periods ?? []);
  const [ground, setGround]     = useState(!!adv.require_ground_floor);
  const [noLimit, setNoLimit]   = useState(!!adv.ignore_consecutive_limit);
  const [maxConsec, setMaxConsec] = useState<string>(
    adv.max_consecutive != null ? String(adv.max_consecutive) : "");
  const [minLast, setMinLast]   = useState<string>(
    adv.min_last_period != null ? String(adv.min_last_period) : "");
  const [note, setNote]         = useState(adv.note ?? "");
  const [busy, setBusy]         = useState(false);

  // Both levels' lesson periods, since a teacher may take either.
  const classPeriods = [
    ...new Map([...periodsForLevel(periods, "lower"), ...periodsForLevel(periods, "upper")]
      .filter((p) => p.type === "class")
      .map((p) => [p.period_num, p])).values(),
  ].sort((a, b) => a.period_num - b.period_num);
  const lastPeriod = classPeriods[classPeriods.length - 1];

  /** What this teacher currently has in the last period, so the rule is concrete. */
  const lastPeriodNow = lastPeriod
    ? slots.filter((s) => s.teacher_id === teacher.id && s.period === lastPeriod.period_num).length
    : 0;

  const save = async () => {
    setBusy(true);
    const body: TeacherAdvanced = {
      days_off: daysOff,
      avoid_periods: avoid,
      require_ground_floor: ground,
      ignore_consecutive_limit: noLimit,
      max_consecutive: maxConsec === "" ? undefined : Number(maxConsec),
      min_last_period: minLast === "" ? undefined : Number(minLast),
      note: note.trim() || undefined,
    };
    try {
      const updated = await api.updateTeacher(teacher.id, { advanced_settings: body });
      useTimetableStore.setState((s) => ({
        teachers: s.teachers.map((t) => (t.id === teacher.id ? { ...t, ...updated } : t)),
      }));
      onClose();
    } finally { setBusy(false); }
  };

  const toggle = (list: number[], set: (v: number[]) => void, v: number) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const label = "block text-xs font-semibold text-gray-700 mb-1";
  const hint  = "text-[11px] text-gray-500 mt-1 leading-relaxed";
  const chip  = (on: boolean) => clsx(
    "px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors",
    on ? "bg-indigo-600 border-indigo-600 text-white"
       : "bg-white border-gray-200 text-gray-700 hover:border-indigo-400");

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center gap-3 bg-indigo-700 px-5 py-4 shrink-0">
        <span className="text-2xl">⚙</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            ตั้งค่าครู — {teacher.code ? `${teacher.code} ` : ""}{teacher.name}
          </h2>
          <p className="text-indigo-100 text-xs mt-0.5">
            เงื่อนไขเฉพาะของครูคนนี้ · เว้นว่าง = ใช้ค่ากลางของโรงเรียน
          </p>
        </div>
        <button onClick={onClose} className="text-indigo-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* สอนติดกัน */}
        <div className="border border-gray-200 rounded-lg p-3">
          <label className={label}>สอนติดกันได้สูงสุด</label>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { setMaxConsec(""); setNoLimit(false); }}
              className={chip(maxConsec === "" && !noLimit)}>
              ตามโรงเรียน ({schoolMaxConsecutive} คาบ)
            </button>
            {[2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => { setMaxConsec(String(n)); setNoLimit(false); }}
                className={chip(maxConsec === String(n) && !noLimit)}>
                {n} คาบ
              </button>
            ))}
            <button onClick={() => setNoLimit(true)} className={chip(noLimit)}>
              ไม่จำกัด
            </button>
          </div>
          <p className={hint}>
            ครูคนนี้จะไม่ถูกจัดให้สอนติดกันเกินจำนวนนี้ ·
            คาบพัก 10 นาทีไม่ถือว่าตัดช่วง แต่พักกลางวันตัด
          </p>
        </div>

        {/* เวรคาบสุดท้าย */}
        <div className="border border-gray-200 rounded-lg p-3">
          <label className={label}>
            เวรคาบสุดท้ายของวัน{lastPeriod ? ` (${lastPeriod.label})` : ""} — ขั้นต่ำ/สัปดาห์
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setMinLast("")} className={chip(minLast === "")}>
              ตามโรงเรียน ({schoolMinLastPeriod} คาบ)
            </button>
            {[0, 1, 2, 3].map((n) => (
              <button key={n} onClick={() => setMinLast(String(n))} className={chip(minLast === String(n))}>
                {n === 0 ? "ไม่ต้องเลย" : `${n} คาบ`}
              </button>
            ))}
          </div>
          <p className={hint}>
            ใช้แบ่งเวรคาบเย็นให้ทั่วถึง ไม่ตกกับคนเดิมๆ ·
            เป็น<strong>เป้าหมาย ไม่ใช่ข้อบังคับ</strong> — ตารางของนักเรียนมาก่อน
            ระบบจะไม่เพิ่มคาบท้ายวันให้ห้องที่เลิกเรียนแล้วเพียงเพื่อให้ครูได้เวร
            แต่จะสลับครูกันในคาบที่มีอยู่แล้ว ถ้าไม่ครบก็ไม่ถือว่าผิด ·
            ตอนนี้มีอยู่ <strong>{lastPeriodNow} คาบ</strong>
          </p>
        </div>

        {/* วันหยุด */}
        <div className="border border-gray-200 rounded-lg p-3">
          <label className={label}>วันที่ไม่สอน</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAYS.map((d, i) => (
              <button key={d} onClick={() => toggle(daysOff, setDaysOff, i)}
                className={chip(daysOff.includes(i))}>{d}</button>
            ))}
          </div>
          <p className={hint}>
            ระบบจะไม่จัดคาบให้ครูคนนี้ในวันที่เลือก — ยกเว้นกรณีที่ไม่มีทางอื่นเลย
            ซึ่งจะแจ้งไว้ในผลการจัดตาราง
          </p>
        </div>

        {/* คาบที่หลีกเลี่ยง */}
        <div className="border border-gray-200 rounded-lg p-3">
          <label className={label}>คาบที่ขอเลี่ยง</label>
          <div className="flex gap-1.5 flex-wrap">
            {classPeriods.map((p) => (
              <button key={p.period_num} onClick={() => toggle(avoid, setAvoid, p.period_num)}
                className={chip(avoid.includes(p.period_num))}>
                {p.label.replace(/^คาบ\s*/, "คาบ ")}
              </button>
            ))}
          </div>
          <p className={hint}>เช่น ครูที่ต้องไปประชุมประจำสัปดาห์ หรือมีภาระงานอื่นในคาบนั้น</p>
        </div>

        {/* อื่นๆ */}
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={ground}
              onChange={(e) => setGround(e.target.checked)} />
            <span className="text-xs leading-relaxed">
              <strong className="text-gray-800">สอนได้เฉพาะชั้น 1</strong>
              <br />
              <span className="text-gray-600">สำหรับครูที่ขึ้นบันไดไม่สะดวก — ระบบจะเลือกเฉพาะห้องชั้น 1 ให้</span>
            </span>
          </label>
          <div>
            <label className={label}>หมายเหตุ</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ลาคลอดภาคเรียนนี้" />
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
        <p className="text-[11px] text-gray-400 flex-1">
          ตั้งค่าแล้วต้องกด <strong>สร้างตาราง</strong> ใหม่จึงจะมีผล
        </p>
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ยกเลิก</button>
        <button onClick={save} disabled={busy}
          className="px-5 py-2 text-sm bg-indigo-700 text-white rounded-lg font-semibold hover:bg-indigo-800 disabled:opacity-40">
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </ModalShell>
  );
};
