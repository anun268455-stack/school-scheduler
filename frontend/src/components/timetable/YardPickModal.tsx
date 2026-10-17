/**
 * YardPickModal — choose the ลาน for one hour of one class.
 *
 * Opens from โหมดเลือกคาบเรียนลาน, on any cell: an empty hour is the main use
 * (reserving it outdoors is what frees an indoor room), a cell that already has
 * a lesson works the same. A cell that already has a ลาน offers to change it or
 * take it away.
 *
 * Picking saves at once. The timetable itself does not move until the school
 * presses สร้างตาราง again — this only records the decision.
 */
import { useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { ModalShell } from "../common/ModalShell";
import { useTimetableStore } from "../../store/timetableStore";
import { DAYS } from "../../types";
import { cellKey, picksOfGroup } from "../../utils/yardPicks";

/** One column of the grid the cell covers — two for a คาบคู่ drawn as one cell. */
export interface YardCol {
  period: number;
  label:  string;
  start:  string;
  end:    string;
}

interface YardPickModalProps {
  groupId:   number;
  groupName: string;
  day:       number;
  cols:      YardCol[];
  onClose:   () => void;
}

export const YardPickModal: React.FC<YardPickModalProps> = ({
  groupId, groupName, day, cols, onClose,
}) => {
  const yardList       = useTimetableStore((s) => s.yardList);
  const yardPicks      = useTimetableStore((s) => s.yardPicks);
  const yardPicksError = useTimetableStore((s) => s.yardPicksError);
  const saveYardPick   = useTimetableStore((s) => s.saveYardPick);
  const loadYardPicks  = useTimetableStore((s) => s.loadYardPicks);

  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  const mine = picksOfGroup(yardPicks, groupId);
  /** What each hour of this cell has now: a ลาน id, or null. */
  const now = cols.map((c) => mine.get(cellKey(day, c.period)) ?? null);
  const anyPick = now.some((id) => id != null);
  const allSame = now.every((id) => id === now[0]);
  /** The ลาน every hour of the cell already has, if they all agree. */
  const current = allSame ? now[0] : null;

  const nameOf = (id: number) =>
    yardList.find((y) => y.id === id)?.name ?? "ลานที่ไม่พบแล้ว";
  const nameOrNone = (id: number | null) => (id == null ? "ยังไม่เลือก" : nameOf(id));

  const hours = cols.map((c) => c.label).join(" + ");
  const times = `${cols[0].start}–${cols[cols.length - 1].end}`;

  /**
   * Set (or, with null, remove) the ลาน for every hour the cell covers.
   *
   * A คาบคู่ is one cell across two columns but two marks on the server, so
   * both are written. Hours that already say the same thing are left alone,
   * which also keeps "remove" from asking the server to delete what is not there.
   */
  const choose = async (roomId: number | null) => {
    setBusy(true);
    setErr(null);
    try {
      for (let i = 0; i < cols.length; i++) {
        if (now[i] === roomId) continue;
        await saveYardPick({ group_id: groupId, day, period: cols[i].period, room_id: roomId });
      }
      onClose();
    } catch (e) {
      setErr(api.errorDetail(e, "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง"));
      // The first hour of a คาบคู่ may have been saved before the second was
      // refused; show what the server really holds.
      void loadYardPicks();
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-sm">
      <div className="px-5 py-3 border-b bg-teal-50">
        <h3 className="text-sm font-bold text-teal-900">📌 เลือกลานสำหรับชั่วโมงนี้</h3>
        <p className="text-xs text-teal-800 mt-0.5">
          {groupName} · วัน{DAYS[day] ?? day + 1} · {hours}
          <span className="text-teal-700/70"> ({times})</span>
        </p>
      </div>

      <div className="px-5 py-3 overflow-y-auto">
        {anyPick && (
          <p className="text-xs text-gray-600 mb-2">
            {allSame && current != null
              ? <>ตอนนี้เลือก <strong className="text-teal-800">{nameOf(current)}</strong> ไว้ — เลือกลานอื่นเพื่อเปลี่ยน หรือเอาออก</>
              : <>แต่ละชั่วโมงเลือกไม่เหมือนกัน — เลือกลานเพื่อให้ทั้งช่องเป็นลานเดียวกัน
                  <span className="block text-gray-400">
                    {cols.map((c, i) => `${c.label}: ${nameOrNone(now[i])}`).join(" · ")}
                  </span></>}
          </p>
        )}

        {yardList.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            {yardPicksError ?? "ยังไม่มีลานในระบบ"}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {yardList.map((y) => {
              const on = allSame && current === y.id;
              return (
                <li key={y.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => choose(y.id)}
                    className={clsx(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors disabled:opacity-50",
                      on
                        ? "bg-teal-600 border-teal-600 text-white font-semibold"
                        : "bg-white border-gray-200 text-gray-800 hover:bg-teal-50 hover:border-teal-300",
                    )}
                  >
                    <span>{on ? "✓" : "📌"}</span>
                    <span className="flex-1 truncate">{y.name}</span>
                    {y.capacity > 0 && (
                      <span className={clsx("text-[11px]", on ? "text-teal-100" : "text-gray-400")}>
                        จุ {y.capacity} คน
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {err && (
          <p role="alert" className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-2">
            {err}
          </p>
        )}
      </div>

      <div className="px-5 py-3 border-t flex items-center gap-2">
        {anyPick && (
          <button
            type="button"
            disabled={busy}
            onClick={() => choose(null)}
            className="px-3 py-1.5 text-sm rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            เอาออก
          </button>
        )}
        <span className="flex-1 text-[11px] text-gray-400">
          {anyPick ? "เอาออก = กลับไปใช้ห้องตามปกติ" : "บันทึกทันทีที่เลือก"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
