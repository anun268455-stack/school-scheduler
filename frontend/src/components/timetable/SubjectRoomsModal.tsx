/**
 * ห้องเรียนรายห้องของวิชาหนึ่ง — which class learns this subject where.
 *
 * ห้องประจำวิชา is one room for the whole subject, and that stopped being
 * true the moment a subject had six teachers: ว31202 is taught by one teacher
 * in 353 ฟิสิกส์, by another in their own room, and by a third wherever the
 * class is sitting. One field cannot say that, so the school says it here,
 * a class at a time — and the answer is used exactly as written, ahead of
 * every rule the solver would otherwise apply.
 *
 * The field at the top is for the common case: one room for all of them.
 */
import { useMemo, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect, roomOptions } from "../common/SearchableSelect";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups } from "../../utils/groupHierarchy";
import type { Subject } from "../../types";

interface Props {
  subject: Subject;
  onClose: () => void;
}

export const SubjectRoomsModal: React.FC<Props> = ({ subject, onClose }) => {
  const { requirements, rooms, teachers, groups } = useTimetableStore();
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState("");
  const flat = useMemo(() => flattenGroups(groups), [groups]);

  const rows = useMemo(
    () => requirements
      .filter((r) => r.subject_id === subject.id)
      .map((r) => ({
        req: r,
        groupName: flat.find((g) => g.id === r.group_id)?.name ?? `#${r.group_id}`,
        teacherName: teachers.find((t) => t.id === r.teacher_id)?.name ?? "—",
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName, "th", { numeric: true })),
    [requirements, subject.id, flat, teachers]);

  const setRoom = async (reqId: number, roomId: string) => {
    setBusy(true);
    try {
      const updated = await api.updateRequirement(reqId, {
        room_id: roomId ? Number(roomId) : null,
      });
      useTimetableStore.setState((st) => ({
        requirements: st.requirements.map((r) => (r.id === reqId ? { ...r, ...updated } : r)),
      }));
    } finally { setBusy(false); }
  };

  const applyToAll = async () => {
    setBusy(true);
    try {
      const roomId = bulk ? Number(bulk) : null;
      for (const { req } of rows) {
        const updated = await api.updateRequirement(req.id, { room_id: roomId });
        useTimetableStore.setState((st) => ({
          requirements: st.requirements.map((r) => (r.id === req.id ? { ...r, ...updated } : r)),
        }));
      }
    } finally { setBusy(false); }
  };

  const set = rows.filter((r) => r.req.room_id).length;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="flex items-center gap-3 bg-sky-700 px-5 py-4 shrink-0">
        <span className="text-2xl">🚪</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            ห้องเรียนของวิชานี้ — {subject.code} {subject.name}
          </h2>
          <p className="text-sky-100 text-xs mt-0.5">
            {rows.length} ห้องเรียน · กำหนดห้องแล้ว {set} · ที่เหลือระบบเลือกให้ตามกฎปกติ
          </p>
        </div>
        <button onClick={onClose} className="text-sky-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      {/* เรียนห้องเดียวกันทุกห้องเรียน */}
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
        <p className="text-[11px] font-semibold text-gray-500 mb-1">
          ถ้าทุกห้องเรียนที่ห้องเดียวกัน ตั้งทีเดียวตรงนี้
        </p>
        <div className="flex gap-2 items-center">
          <div className="flex-1 min-w-0">
            <SearchableSelect value={bulk} onChange={setBulk}
              options={roomOptions(rooms)} emptyLabel="– เลือกห้อง –" />
          </div>
          <button onClick={applyToAll} disabled={busy || rows.length === 0}
            className="px-3 py-1.5 text-sm rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 whitespace-nowrap">
            ใช้กับทั้ง {rows.length} ห้อง
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">
          เว้นว่างแล้วกด = ล้างห้องที่กำหนดไว้ทั้งหมด กลับไปให้ระบบเลือกเอง
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {rows.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">
            ยังไม่มีห้องเรียนไหนเรียนวิชานี้ — เพิ่มได้ที่ปุ่ม 🧑‍🏫 จัดห้อง/ครู
          </p>
        )}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-1.5 pr-2 font-semibold w-24">ห้องเรียน</th>
              <th className="py-1.5 pr-2 font-semibold">ครูผู้สอน</th>
              <th className="py-1.5 font-semibold w-64">เรียนที่ห้อง</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ req, groupName, teacherName }) => (
              <tr key={req.id}>
                <td className="py-1.5 pr-2 font-semibold text-gray-800">{groupName}</td>
                <td className="py-1.5 pr-2 text-gray-600 truncate">{teacherName}</td>
                <td className="py-1.5">
                  <SearchableSelect
                    value={req.room_id ? String(req.room_id) : ""}
                    onChange={(v) => setRoom(req.id, v)}
                    options={roomOptions(rooms)}
                    emptyLabel="– ระบบเลือกให้ –"
                    disabled={busy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between shrink-0">
        <p className="text-[11px] text-gray-400">
          ห้องที่กำหนดตรงนี้มาก่อนทุกกฎ · ถ้าห้องไม่ว่างในคาบนั้น ระบบจะเลี่ยงไปคาบอื่นแทนที่จะเปลี่ยนห้อง
        </p>
        <button onClick={onClose}
          className="px-5 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg font-medium">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
