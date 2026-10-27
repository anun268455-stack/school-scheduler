/**
 * RoomSwapModal — pick a different room for an existing slot.
 * Shows only rooms that are free at the slot's day+period.
 *
 * ใช้แป้นพิมพ์ได้ทั้งหมด — "ตรงปุ่มที่เลื่อนห้องสามารถกดปุ่มที่แป้นพิมพ์ได้"
 *
 * โรงเรียนนี้มี 130 ห้อง การหาห้องด้วยการเลื่อนลิสต์แล้วเล็งเมาส์คือการทำงาน
 * ที่ช้าที่สุดของหน้านี้ พิมพ์ชื่อห้องเร็วกว่ามาก (รูปแบบเดียวกับช่องเลือกครู
 * ที่หน้าแรก): ช่องค้นหาโฟกัสให้ตั้งแต่เปิด · ↑ ↓ เลื่อน · Enter เลือก ·
 * Esc ปิด · กด P เอาหมุดออกเมื่อชั่วโมงนั้นปักหมุดไว้
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import clsx from "clsx";
import { DAYS, periodLabel } from "../../types";
import type { Room, TimetableSlot } from "../../types";
import { slotLabel } from "../../utils/teacherSlots";
import { roomFreeFor } from "../../utils/levels";
import { useTimetableStore } from "../../store/timetableStore";

const ROOM_TYPE_TH: Record<string, string> = {
  physical: "ห้องเรียนทั่วไป", special: "ห้องพิเศษ", outdoor: "กลางแจ้ง", floating: "ห้องเวียน",
};

interface RoomSwapModalProps {
  slot:     TimetableSlot;
  rooms:    Room[];
  slots:    TimetableSlot[];
  onSelect: (roomId: number) => void;
  onClose:  () => void;
}

export const RoomSwapModal: React.FC<RoomSwapModalProps> = ({ slot, rooms, slots, onSelect, onClose }) => {
  const dayName = DAYS[slot.day] ?? `วัน ${slot.day}`;
  const yardPicks       = useTimetableStore((s) => s.yardPicks);
  const yardList        = useTimetableStore((s) => s.yardList);
  const removeYardPicks = useTimetableStore((s) => s.removeYardPicks);
  const [unpinning, setUnpinning] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef  = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // หมุดลานของชั่วโมงนี้ — แรงกว่าการเลือกห้องที่นี่ ถ้าไม่เอาออกก่อน เลือกห้อง
  // ใหม่แล้วเซิร์ฟเวอร์จะดึงกลับไปที่ลานที่ปักไว้ ("ย้ายห้องแล้วกลับไปที่เดิม")
  const pin = useMemo(
    () => yardPicks.find((r) => r.group_id === slot.group_id
                                && r.day === slot.day && r.period === slot.period),
    [yardPicks, slot.group_id, slot.day, slot.period]);
  const pinName = pin
    ? yardList.find((y) => y.id === pin.room_id)?.name ?? "ลานที่ปักไว้"
    : null;

  // เปิดกล่องแล้วพิมพ์ได้ทันที ไม่ต้องเล็งเมาส์ไปที่ช่องค้นหาก่อน
  useEffect(() => { boxRef.current?.focus(); }, []);

  const availableRooms = useMemo(() => {
    const occupiedRoomIds = new Set(
      slots
        .filter((s) => s.id !== slot.id && s.day === slot.day && s.period === slot.period && s.room_id)
        .map((s) => s.room_id),
    );
    const free = rooms.filter((r) => {
      if (occupiedRoomIds.has(r.id)) return false;
      // ห้ามใช้ — a staff room or office is not somewhere to move a class to.
      if (r.usable === false || (r.capacity ?? 1) <= 0) return false;
      if (!roomFreeFor(r, slot.teacher_id)) return false;
      return true;
    });
    // Prioritize rooms matching the slot's current room type
    return free.sort((a, b) => {
      const aMatch = a.type === slot.room_type ? 0 : 1;
      const bMatch = b.type === slot.room_type ? 0 : 1;
      return aMatch - bMatch || a.name.localeCompare(b.name);
    });
  }, [rooms, slots, slot]);

  /** ห้องที่ตรงกับที่พิมพ์ — ชื่อห้อง ชื่ออาคาร หรือประเภท */
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return availableRooms;
    return availableRooms.filter((r) =>
      r.name.toLowerCase().includes(needle)
      || (r.building_name ?? "").toLowerCase().includes(needle)
      || (ROOM_TYPE_TH[r.type] ?? r.type).toLowerCase().includes(needle));
  }, [availableRooms, q]);

  // พิมพ์ใหม่แล้วตัวชี้กลับไปบนสุด ไม่ค้างอยู่บรรทัดที่หายไปแล้ว
  useEffect(() => { setCursor(0); }, [q]);

  // เลื่อนด้วยแป้นแล้วบรรทัดที่ชี้อยู่ต้องอยู่ในสายตา
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-at="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const unpin = async () => {
    setUnpinning(true);
    await removeYardPicks(slot.group_id, slot.day, [slot.period]);
    setUnpinning(false);
    boxRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = shown[cursor];
      if (r && r.id !== slot.room_id) onSelect(r.id);
    } else if ((e.key === "p" || e.key === "P") && pinName && !unpinning) {
      // หมุดเป็นด่านแรกของกล่องนี้ จึงมีปุ่มลัดของตัวเอง
      e.preventDefault(); void unpin();
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md">

        {/* Header */}
        <div className="flex items-center gap-3 bg-blue-600 px-5 py-4">
          <span className="text-2xl">🔁</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base leading-tight truncate">สลับห้อง — {slotLabel(slot)}</h2>
            <p className="text-blue-100 text-xs mt-0.5">
              {dayName} {periodLabel(slot.period)} · {slot.group_name} · {slot.teacher_name}
            </p>
          </div>
          <button onClick={onClose} className="text-blue-200 hover:text-white text-lg leading-none shrink-0">✕</button>
        </div>

        {/* Current room */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
          ห้องปัจจุบัน: <strong className="text-gray-700">{slot.room_name ?? "– ไม่มี –"}</strong>
        </div>

        {/* หมุดลาน — ต้องเอาออกก่อน ไม่งั้นเลือกห้องใหม่แล้วเด้งกลับ */}
        {pinName && (
          <div className="px-5 py-3 bg-teal-50 border-b border-teal-100 flex items-start gap-2">
            <span className="text-base leading-none">📌</span>
            <div className="flex-1 min-w-0 text-[11px] text-teal-900">
              ชั่วโมงนี้ปักหมุดไว้ที่ <strong>{pinName}</strong> — ถ้าไม่เอาหมุดออก
              เลือกห้องใหม่แล้วระบบจะดึงกลับมาที่ลานนี้
            </div>
            <button
              type="button"
              disabled={unpinning}
              onClick={() => void unpin()}
              title="ปุ่มลัด: P"
              className="shrink-0 px-2 py-1 rounded bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700 disabled:bg-teal-300"
            >{unpinning ? "กำลังเอาออก…" : "เอาหมุดออก (P)"}</button>
          </div>
        )}

        {/* ช่องค้นหา — พิมพ์ชื่อห้องเร็วกว่าเลื่อนหา 130 ห้อง */}
        <div className="px-5 pt-3">
          <input
            ref={boxRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="พิมพ์ชื่อห้อง / อาคาร / ประเภท — ↑ ↓ เลื่อน · Enter เลือก"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
          />
          <p className="mt-1 text-[10px] text-gray-400">
            ว่างในคาบนี้ {shown.length} ห้อง{q ? ` จากทั้งหมด ${availableRooms.length} ห้อง` : ""}
            {" · "}Esc ปิด
          </p>
        </div>

        {/* Room list */}
        <div ref={listRef} className="px-5 py-3 max-h-80 overflow-y-auto">
          {availableRooms.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">ไม่มีห้องว่างในคาบนี้</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              ไม่มีห้องว่างที่ชื่อตรงกับ "{q}"
            </p>
          ) : (
            <div className="space-y-1.5">
              {shown.map((r, i) => (
                <button
                  key={r.id}
                  data-at={i}
                  onClick={() => onSelect(r.id)}
                  onMouseEnter={() => setCursor(i)}
                  disabled={r.id === slot.room_id}
                  className={clsx(
                    "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-left transition-colors",
                    r.id === slot.room_id
                      ? "bg-blue-50 border-blue-200 cursor-default"
                      : i === cursor
                      ? "bg-blue-50 border-blue-400 ring-1 ring-blue-300"
                      : "bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {r.name} {r.id === slot.room_id && <span className="text-blue-500 text-xs">(ปัจจุบัน)</span>}
                    </p>
                    <p className="text-xs text-gray-500">{ROOM_TYPE_TH[r.type] ?? r.type} · จุ {r.capacity} คน{r.building_name ? ` · ${r.building_name}` : ""}</p>
                  </div>
                  {r.type === slot.room_type && r.id !== slot.room_id && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium shrink-0">ตรงประเภท</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cancel */}
        <div className="px-5 pb-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors font-medium"
          >
            ยกเลิก
          </button>
        </div>
    </ModalShell>
  );
};
