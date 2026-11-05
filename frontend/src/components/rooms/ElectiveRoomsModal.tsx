/**
 * ElectiveRoomsModal — เลือกห้องสอนให้คาบเสรีของครูคนหนึ่ง
 *
 *   "คาบเสรี ครูมาบอกว่าต้องการห้องสอนที่นี้ เลยอยากให้ทำระบบที่เข้าไปที่ครู
 *    ที่สอนคนนั้นแล้วเลือกห้องให้ โดยจะขึ้นที่ตารางครูและตารางห้อง"
 *
 *   "ตอนนี้ไม่สามารถเลือกห้องได้ เพราะห้องไม่ขึ้น ช่วยทำให้ห้องขึ้นให้หน่อย
 *    โดยดูว่าห้องว่างไหม"
 *
 * รอบแรกหน้านี้ผูกกับ "กลุ่มวิชาเสรี" ซึ่งโรงเรียนไม่ได้ใช้ ผลคือทุกแถวได้คีย์
 * เดียวกัน (`null-null`) กดกางแถวเดียวแล้วกางทั้งหมด และกดบันทึกแล้วถูกปฏิเสธ
 * ตอนนี้ระบุงานสอนด้วย (วัน · คาบ · วิชา · ครู) ซึ่งใช้ได้กับคาบเสรีทั้งสอง
 * รูปแบบ — เหตุผลเต็มอยู่ใน utils/electiveRooms.ts
 *
 * และรายการห้องแสดง **ทุกห้อง** พร้อมบอกว่าว่างหรือไม่ว่างเพราะอะไร ของเดิม
 * ซ่อนห้องที่ไม่ว่าง ซึ่งในคาบที่ทั้งโรงเรียนเรียนพร้อมกันเหลือแต่ลานกลางแจ้ง
 */
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { dutyKey, electiveDutiesOf, roomChoicesAt } from "../../utils/electiveRooms";
import { matches } from "../common/TableSearch";
import { DAYS, periodLabel } from "../../types";

interface Props {
  teacherId:   number;
  teacherName: string | null;
  /** เปิดมาที่งานสอนนี้เลย — ใช้ตอนกดจากช่องในตาราง */
  focus?:      { day: number; period: number } | null;
  onClose:     () => void;
}

export const ElectiveRoomsModal: React.FC<Props> = ({
  teacherId, teacherName, focus, onClose,
}) => {
  const { slots, rooms, periods, loadSlots } = useTimetableStore();
  const duties = useMemo(() => electiveDutiesOf(slots, teacherId), [slots, teacherId]);

  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [note, setNote]       = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(() => {
    if (!focus) return null;
    const hit = duties.find((d) => d.day === focus.day && d.period === focus.period);
    return hit ? dutyKey(hit) : null;
  });
  const [search, setSearch] = useState("");

  const noRoom = duties.filter((d) => d.roomId == null).length;

  const pick = async (
    duty: typeof duties[number], roomId: number | null, rowKey: string,
  ) => {
    setBusyRow(rowKey);
    setError(null);
    setNote(null);
    try {
      const r = await api.setElectiveRoom({
        day: duty.day, period: duty.period,
        subject_id: duty.subjectId, teacher_id: duty.teacherId, room_id: roomId,
      });
      // เอาห้องที่เพิ่งตั้งไปทับตารางในจอทันที ตารางห้องและใบพิมพ์จะได้ตรงกัน
      await loadSlots();
      setOpen(null);
      if (r.busy.length > 0) {
        setNote(`ตั้งให้แล้ว แต่ชั่วโมงนี้ห้องนี้มีคนใช้อยู่ด้วย — `
          + r.busy.map((b) => `${b.group_name ?? ""} ${b.subject_name ?? ""}`.trim())
              .join(" · "));
      }
    } catch (e) {
      setError(api.errorDetail(e, "ตั้งห้องไม่สำเร็จ"));
    } finally { setBusyRow(null); }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl" tall>
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-base font-bold text-gray-800">
          ห้องสอนของคาบเสรี — ครู{teacherName ?? ""}
        </h2>
        <p className="text-[11px] text-gray-500 mt-0.5">
          คาบเสรีหนึ่งคาบมีหลายวิชาเรียนพร้อมกัน แต่ละวิชาอยู่คนละห้อง ห้องที่เลือกที่นี่
          จะขึ้นทั้งบนตารางของครูและบนตารางการใช้ห้องสอน
        </p>
      </div>

      <div className="px-5 py-3 overflow-y-auto flex-1">
        {error && (
          <p className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </p>
        )}
        {note && (
          <p className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            ⚠ {note}
          </p>
        )}

        {duties.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            ครูท่านนี้ไม่มีคาบเสรีในตารางปัจจุบัน
          </p>
        ) : (
          <>
            <p className={clsx("text-[11px] mb-2",
              noRoom > 0 ? "text-amber-700" : "text-emerald-700")}>
              {noRoom > 0
                ? `คาบเสรี ${duties.length} คาบ — ยังไม่ได้เลือกห้อง ${noRoom} คาบ`
                : `คาบเสรี ${duties.length} คาบ — เลือกห้องไว้ครบแล้ว`}
            </p>
            <div className="divide-y divide-gray-100">
              {duties.map((d) => {
                const rowKey = dutyKey(d);
                // หารายการห้องเฉพาะแถวที่กางอยู่ — การหาหนึ่งครั้งต้องไล่ทั้ง
                // ตาราง ทำทุกแถวทุกครั้งที่วาดจอคือไล่ซ้ำเท่าจำนวนแถว
                const choices = open === rowKey
                  ? roomChoicesAt(rooms, slots, d.day, d.period, {
                      subjectId: d.subjectId, teacherId: d.teacherId,
                    })
                  : [];
                const shown = choices.filter(
                  (c) => matches(search, c.room.name, c.room.building_name ?? ""));
                return (
                  <div key={rowKey} className="py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500 w-28 shrink-0">
                        {DAYS[d.day] ?? `วัน ${d.day}`} · {periodLabel(d.period, periods)}
                      </span>
                      <span className="text-sm text-gray-800 flex-1 min-w-[8rem] truncate"
                        title={d.label}>
                        {d.label}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {d.groupCount} ห้องเรียน
                      </span>
                      <span className={clsx("text-xs shrink-0",
                        d.roomName ? "text-gray-700 font-medium" : "text-amber-700")}>
                        {d.roomName ?? "ยังไม่มีห้อง"}
                      </span>
                      <button
                        onClick={() => {
                          setSearch("");
                          setOpen(open === rowKey ? null : rowKey);
                        }}
                        className="text-[11px] text-blue-600 hover:underline shrink-0">
                        {d.roomId ? "เปลี่ยนห้อง" : "เลือกห้อง"}
                      </button>
                      {d.roomId != null && (
                        <button onClick={() => void pick(d, null, rowKey)}
                          disabled={busyRow === rowKey}
                          className="text-[11px] text-gray-400 hover:text-red-600 shrink-0">
                          เอาออก
                        </button>
                      )}
                    </div>

                    {open === rowKey && (
                      <div className="mt-1.5">
                        <div className="flex items-center gap-2 mb-1.5">
                          <input
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="พิมพ์ชื่อหรือเลขห้อง"
                            className="w-48 border border-gray-200 rounded px-2 py-1 text-xs"
                          />
                          <span className="text-[10px] text-gray-400">
                            ว่าง {choices.filter((c) => c.free).length} ห้อง
                            จาก {choices.length} ห้อง
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {shown.slice(0, 60).map((c) => (
                            <button key={c.room.id}
                              onClick={() => void pick(d, c.room.id, rowKey)}
                              disabled={busyRow === rowKey || c.mine}
                              className={clsx("text-[11px] px-2 py-0.5 rounded border",
                                c.mine
                                  ? "bg-gray-100 border-gray-200 text-gray-400"
                                  : c.free
                                    ? "bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                                    : "bg-white border-red-200 text-red-600 hover:bg-red-50")}
                              title={c.free
                                ? (c.room.building_name ?? "ว่างคาบนี้")
                                : `ไม่ว่าง — ${c.usedBy}`}>
                              {c.mine ? "✓ " : c.free ? "" : "⚠ "}{c.room.name}
                            </button>
                          ))}
                          {shown.length === 0 && (
                            <span className="text-[11px] text-gray-400">
                              ไม่มีห้องที่ชื่อตรงกับที่พิมพ์
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1.5">
                          สีแดงคือห้องที่มีคนใช้อยู่แล้วในคาบนี้ — เลือกได้ แต่จะกลายเป็นห้องซ้ำ
                          (เอาเมาส์ชี้เพื่อดูว่าติดอะไรอยู่)
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
        <span className="text-[11px] text-gray-400 flex-1">
          ห้องที่ตั้งไว้เป็นของวิชานั้น จึงใช้ร่วมกันทุกห้องเรียนที่ส่งนักเรียนมาเรียน
        </span>
        <button onClick={onClose}
          className="px-4 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
