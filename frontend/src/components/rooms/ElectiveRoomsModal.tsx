/**
 * ElectiveRoomsModal — เลือกห้องสอนให้คาบเสรีของครูคนหนึ่ง
 *
 *   "คาบเสรี ครูมาบอกว่าต้องการห้องสอนที่นี้ เลยอยากให้ทำระบบที่เข้าไปที่ครู
 *    ที่สอนคนนั้นแล้วเลือกห้องให้ โดยจะขึ้นที่ตารางครูและตารางห้อง"
 *
 * ห้องของคาบเสรีตั้งได้ที่หน้ากลุ่มวิชาเสรีอยู่แล้ว แต่หน้านั้นเรียงตาม
 * "หน้าต่างเวลา" ไม่ใช่ตามครู เวลาครูเดินมาบอกว่าอยากได้ห้องนี้ คนจัดตารางต้อง
 * ไปหาว่าครูคนนั้นอยู่หน้าต่างไหน วิชาอะไร ซึ่งเป็นการค้นที่ไม่ควรต้องทำ
 *
 * ที่นี่จึงมองจากฝั่งครู: เปิดตารางของครูคนนั้น กดปุ่มเดียว เห็นคาบเสรีของตัวเอง
 * ทั้งหมดพร้อมช่องเลือกห้อง ข้างในเรียกเส้นทางเดียวกับหน้ากลุ่มวิชาเสรี
 * (ห้องเก็บที่ "วิชา" ไม่ใช่ที่ "คาบ" — เหตุผลอยู่ใน utils/electiveRooms)
 */
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { electiveDutiesOf, freeRoomsAt } from "../../utils/electiveRooms";
import { matches } from "../common/TableSearch";
import { DAYS, periodLabel } from "../../types";
import type { Room, TimetableSlot } from "../../types";

interface Props {
  teacherId:   number;
  teacherName: string | null;
  onClose:     () => void;
}

export const ElectiveRoomsModal: React.FC<Props> = ({ teacherId, teacherName, onClose }) => {
  const { slots, rooms, periods, loadSlots } = useTimetableStore();
  const [busy, setBusy]     = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const duties = useMemo(() => electiveDutiesOf(slots, teacherId), [slots, teacherId]);
  const noRoom = duties.filter((d) => d.roomId == null).length;

  const pick = async (
    poolId: number | null, optionKey: number | null, roomId: number | null, rowKey: string,
  ) => {
    if (poolId == null || optionKey == null) {
      setError("คาบเสรีนี้ไม่ได้มาจากกลุ่มวิชาเสรี จึงตั้งห้องจากหน้านี้ไม่ได้");
      return;
    }
    setBusy(rowKey);
    setError(null);
    try {
      await api.updatePoolOption(poolId, optionKey, { room_id: roomId });
      // ดึงตารางมาใหม่ เพื่อให้ตารางครูและตารางห้องตรงกันทันทีโดยไม่ต้องรีเฟรช
      await loadSlots();
      setOpening(null);
    } catch (e) {
      setError(api.errorDetail(e, "ตั้งห้องไม่สำเร็จ"));
    } finally { setBusy(null); }
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

        {duties.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            ครูท่านนี้ไม่มีคาบเสรีในตารางปัจจุบัน
          </p>
        ) : (
          <>
            <p className={clsx("text-[11px] mb-2",
              noRoom > 0 ? "text-amber-700" : "text-emerald-700")}>
              {noRoom > 0
                ? `มี ${noRoom} คาบที่ยังไม่ได้เลือกห้อง`
                : "ทุกคาบมีห้องแล้ว"}
            </p>
            <div className="divide-y divide-gray-100">
              {duties.map((d) => {
                const rowKey = `${d.poolId}-${d.optionKey}`;
                // หาห้องว่างเฉพาะแถวที่กางอยู่ — การหาหนึ่งครั้งต้องไล่ทั้งตาราง
                // ทำทุกแถวทุกครั้งที่วาดจอคือการไล่ตารางซ้ำเท่าจำนวนแถว
                const free = opening === rowKey
                  ? freeRoomsAt(rooms, slots, d.day, d.period, {
                      poolId: d.poolId, optionKey: d.optionKey, teacherId,
                    }) as Room[]
                  : [];
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
                          setOpening(opening === rowKey ? null : rowKey);
                        }}
                        className="text-[11px] text-blue-600 hover:underline shrink-0">
                        {d.roomId ? "เปลี่ยนห้อง" : "เลือกห้อง"}
                      </button>
                      {d.roomId != null && (
                        <button
                          onClick={() => void pick(d.poolId, d.optionKey, null, rowKey)}
                          disabled={busy === rowKey}
                          className="text-[11px] text-gray-400 hover:text-red-600 shrink-0">
                          เอาออก
                        </button>
                      )}
                    </div>

                    {opening === rowKey && (
                      <div className="mt-1.5">
                        <input
                          autoFocus
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="พิมพ์ชื่อหรือเลขห้อง"
                          className="w-48 border border-gray-200 rounded px-2 py-1 text-xs mb-1.5"
                        />
                        <div className="flex flex-wrap gap-1">
                          {free
                            .filter((r) => matches(search, r.name, r.building_name ?? ""))
                            .slice(0, 30)
                            .map((r) => (
                              <button key={r.id}
                                onClick={() => void pick(d.poolId, d.optionKey, r.id, rowKey)}
                                disabled={busy === rowKey || r.id === d.roomId}
                                className={clsx("text-[11px] px-2 py-0.5 rounded border",
                                  r.id === d.roomId
                                    ? "bg-gray-100 border-gray-200 text-gray-400"
                                    : "bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50")}
                                title={r.building_name ?? ""}>
                                {r.id === d.roomId ? "✓ " : ""}{r.name}
                              </button>
                            ))}
                          {free.length === 0 && (
                            <span className="text-[11px] text-amber-700">
                              ไม่มีห้องว่างในคาบนี้เลย — วิชาอื่นในคาบเสรีเดียวกันและคาบปกติ
                              ใช้ห้องไปหมดแล้ว
                            </span>
                          )}
                        </div>
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
          ห้องที่ตั้งไว้ถูกเก็บไว้กับวิชา จึงใช้ร่วมกันทุกห้องเรียนที่ส่งนักเรียนมาเรียนวิชานั้น
        </span>
        <button onClick={onClose}
          className="px-4 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};

/** คาบเสรีของครูคนนี้ที่ยังไม่มีห้อง — ใช้ตั้งเลขบนปุ่ม */
export function electiveRoomsMissing(
  slots: TimetableSlot[], teacherId: number | null,
): number {
  return electiveDutiesOf(slots, teacherId).filter((d) => d.roomId == null).length;
}
