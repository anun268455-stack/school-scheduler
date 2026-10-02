/**
 * RoomSettingsModal — everything about one room, in a dialog.
 *
 * A room now carries enough settings — type, building, floor, capacity, whether
 * it may be used at all, a department it belongs to, and any number of teachers
 * who share it — that editing them inside a table row made that row several
 * lines tall and pushed every other room off the screen. The row stays a
 * one-line summary; this is where the settings live.
 */
import React, { useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect } from "../common/SearchableSelect";
import { roomReservedFor } from "../../utils/levels";
import type { Room, RoomType } from "../../types";

const ROOM_TYPES: { v: RoomType; label: string; hint: string }[] = [
  { v: "physical", label: "ห้องเรียนทั่วไป", hint: "ห้องเรียนปกติ" },
  { v: "special",  label: "ห้องพิเศษ",       hint: "แล็บ ห้องคอมฯ ห้องดนตรี" },
  { v: "outdoor",  label: "กลางแจ้ง",        hint: "สนาม ลานกิจกรรม" },
  { v: "floating", label: "ห้องเวียน",       hint: "ใช้ร่วมกันหลายวิชา" },
];

interface Props {
  /** null = creating a new room. */
  room: Room | null;
  onClose: () => void;
}

export const RoomSettingsModal: React.FC<Props> = ({ room, onClose }) => {
  const { buildings, teachers, departments } = useTimetableStore();

  const [name, setName]         = useState(room?.name ?? "");
  const [type, setType]         = useState<RoomType>(room?.type ?? "physical");
  const [buildingId, setBuilding] = useState(room?.building_id ? String(room.building_id) : "");
  const [floor, setFloor]       = useState(room?.floor ?? 1);
  const [capacity, setCapacity] = useState(room?.capacity ?? 50);
  const [usable, setUsable]     = useState(room?.usable !== false);
  const [deptId, setDeptId]     = useState(room?.specialized_dept_id ? String(room.specialized_dept_id) : "");
  const [keptFor, setKeptFor]   = useState<number[]>(room ? roomReservedFor(room) : []);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const teacherLabel = (id: number) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.code ? `${t.code} ` : ""}${t.name}` : String(id);
  };

  const save = async () => {
    if (!name.trim()) { setError("ต้องใส่ชื่อห้อง"); return; }
    setBusy(true); setError(null);
    const body = {
      name: name.trim(),
      type,
      building_id: buildingId ? Number(buildingId) : null,
      floor: Number(floor),
      capacity: Number(capacity),
      usable,
      specialized_dept_id: deptId ? Number(deptId) : null,
      reserved_teacher_ids: keptFor,
    };
    try {
      if (room) {
        const updated = await api.updateRoom(room.id, body);
        useTimetableStore.setState((s) => ({
          rooms: s.rooms.map((x) => (x.id === room.id ? { ...x, ...updated } : x)),
        }));
      } else {
        const created = await api.createRoom(body);
        useTimetableStore.setState((s) => ({ rooms: [...s.rooms, created] }));
      }
      onClose();
    } catch {
      setError("บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  };

  const label = "block text-xs font-semibold text-gray-700 mb-1";
  const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none";

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center gap-3 bg-slate-800 px-5 py-4 shrink-0">
        <span className="text-2xl">🚪</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            {room ? `ตั้งค่าห้อง — ${room.name}` : "เพิ่มห้องสอนใหม่"}
          </h2>
          <p className="text-slate-300 text-xs mt-0.5">
            ชื่อห้อง ประเภท ที่ตั้ง ความจุ และใครใช้ได้บ้าง
          </p>
        </div>
        <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={label}>ชื่อห้อง *</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="เช่น 131 ห้องคอมฯ3" autoFocus />
            <p className="text-[11px] text-gray-400 mt-1">
              ขึ้นต้นด้วยเลขห้องไว้ ระบบจะดึงเลขไปพิมพ์ตัวใหญ่ในตาราง
            </p>
          </div>

          <div className="col-span-2">
            <label className={label}>ประเภทห้อง</label>
            <div className="grid grid-cols-4 gap-1.5">
              {ROOM_TYPES.map((t) => (
                <button key={t.v} onClick={() => setType(t.v)}
                  className={clsx("px-2 py-2 rounded-lg border text-xs text-left transition-colors",
                    type === t.v ? "border-slate-700 bg-slate-700 text-white"
                      : "border-gray-200 hover:border-slate-400 text-gray-700")}>
                  <span className="block font-semibold">{t.label}</span>
                  <span className={clsx("block text-[10px] mt-0.5",
                    type === t.v ? "text-slate-300" : "text-gray-400")}>{t.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={label}>อาคาร</label>
            <select className={input} value={buildingId} onChange={(e) => setBuilding(e.target.value)}>
              <option value="">– ไม่ระบุ –</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>ชั้น</label>
              <input type="number" min={0} className={input} value={floor}
                onChange={(e) => setFloor(Number(e.target.value))} />
            </div>
            <div>
              <label className={label}>ความจุ (คน)</label>
              <input type="number" min={0} className={input} value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))} />
            </div>
          </div>
        </div>

        {/* ใช้จัดคาบได้ไหม */}
        <div className={clsx("rounded-lg border p-3",
          usable ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50")}>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={!usable}
              onChange={(e) => setUsable(!e.target.checked)} />
            <span className="text-xs leading-relaxed">
              <strong className={usable ? "text-gray-800" : "text-red-800"}>
                🚫 ห้ามใช้ห้องนี้จัดคาบเรียน
              </strong>
              <br />
              <span className="text-gray-600">
                ติ๊กไว้สำหรับห้องพักครู ห้องสำนักงาน หรือห้องที่ไม่ใช่ห้องเรียน —
                ระบบจะไม่จัดคาบลงห้องนี้เลย และย้ายคาบเข้ามาไม่ได้ด้วย
              </span>
            </span>
          </label>
        </div>

        {/* กลุ่มสาระเจ้าของห้อง */}
        <div>
          <label className={label}>🧪 ห้องเฉพาะกลุ่มสาระ</label>
          <select className={input} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            <option value="">– ไม่จำกัด (ใครก็ใช้ได้) –</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">
            กลุ่มสาระอื่นจะใช้ห้องนี้ไม่ได้เลย และวิชาของกลุ่มสาระนี้จะถูกพามาเรียนที่นี่ก่อนห้องประจำชั้น
            — ใช้กับห้องคอมฯ แล็บวิทย์ ห้องดนตรี
          </p>
        </div>

        {/* ครูที่จองห้องนี้ */}
        <div>
          <label className={label}>🏠 จองให้ครู (เลือกได้หลายคน)</label>
          {keptFor.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {keptFor.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-800 border border-teal-200 rounded-lg px-2 py-1">
                  {teacherLabel(id)}
                  <button onClick={() => setKeptFor(keptFor.filter((x) => x !== id))}
                    className="text-teal-500 hover:text-red-600 ml-0.5">✕</button>
                </span>
              ))}
            </div>
          )}
          <SearchableSelect
            value=""
            onChange={(v) => { if (v) setKeptFor([...new Set([...keptFor, Number(v)])]); }}
            options={teachers.filter((t) => !keptFor.includes(t.id)).map((t) => ({
              value: String(t.id),
              label: `${t.code ? `${t.code} ` : ""}${t.name}`,
            }))}
            placeholder={keptFor.length ? "+ เพิ่มครูอีกคน" : "– ห้องรวม (ใครใช้ก็ได้) –"} />
          <p className="text-[11px] text-gray-400 mt-1">
            เว้นว่าง = ห้องรวม · ใส่ชื่อไว้ = เฉพาะครูเหล่านี้เท่านั้นที่ระบบจะจัดคาบลงห้องนี้
          </p>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
        {error && <span className="text-xs text-red-600 flex-1">{error}</span>}
        {!error && <span className="flex-1" />}
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ยกเลิก</button>
        <button onClick={save} disabled={busy}
          className="px-5 py-2 text-sm bg-slate-800 text-white rounded-lg font-semibold hover:bg-slate-900 disabled:opacity-40">
          {busy ? "กำลังบันทึก…" : room ? "บันทึก" : "เพิ่มห้อง"}
        </button>
      </div>
    </ModalShell>
  );
};
