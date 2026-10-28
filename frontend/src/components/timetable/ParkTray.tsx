/**
 * ParkTray — ถาดพักคาบใต้ตาราง
 *
 *   "ช่วยทำช่องว่างๆ ออกมาให้หน่อย เพื่อเอาไว้วางคาบเฉยๆ เพื่อรอเปลี่ยนได้"
 *
 * เวลาจัดตารางด้วยมือ มักต้องยกคาบหนึ่งออกมาก่อนเพื่อเปิดทางให้อีกคาบลง แล้ว
 * ค่อยหาที่ให้มันทีหลัง ถาดนี้คือที่ที่มันไปพักอยู่ระหว่างนั้น
 *
 * ยกเข้ามาได้สองทาง: ลากคาบมาทิ้งในถาด หรือกดปุ่ม 📥 บนคาบนั้น
 * เอากลับได้สองทาง: ลากการ์ดจากถาดไปวางในช่อง หรือกด "คืนที่เดิม" ถ้าช่องเดิม
 * ยังว่างอยู่
 *
 * คาบที่อยู่ในถาดถือว่า "ยังไม่ได้ลง" ตัวนับคาบไม่พอจึงขึ้นตามจริง — ตั้งใจให้
 * เป็นอย่างนั้น จะได้ไม่ลืมว่ามีคาบค้างอยู่
 */
import { useDraggable, useDroppable } from "@dnd-kit/core";
import clsx from "clsx";
import { DAYS } from "../../types";
import type { ParkedLesson } from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";

export const PARK_DROP_ID = "park-tray";

/** ลากการ์ดจากถาด — ตัวที่ TimetableGrid อ่านตอนปล่อยลงช่อง */
export interface ParkDragItem {
  parkedId: number;
  hours:    number;
}

const Card: React.FC<{
  /** ของ React เอง ประกาศไว้เพราะไฟล์นี้ตรวจ props เข้ม */
  key?: string | number;
  row:  ParkedLesson;
}> = ({ row }) => {
  const unpark = useTimetableStore((s) => s.unpark);
  const drop   = useTimetableStore((s) => s.dropParked);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `parked-${row.parked_id}`,
    data: { parkedId: row.parked_id, hours: row.hours } as ParkDragItem,
  });

  const where = row.from_day != null && row.from_periods.length
    ? `${DAYS[row.from_day]} คาบ ${row.from_periods.join("–")}`
    : "ไม่รู้ที่เดิม";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={clsx(
        "group relative shrink-0 w-[9.5rem] rounded border bg-white px-2 py-1.5 shadow-sm",
        "cursor-grab active:cursor-grabbing select-none",
        isDragging ? "opacity-40 border-amber-400" : "border-amber-300 hover:border-amber-500",
      )}
      title={`${row.group_name ?? ""} ${row.subject_code ?? ""} · ยกมาจาก ${where}`}
    >
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-bold text-gray-800 truncate">
          {row.subject_code ?? (row.is_elective ? "วิชาเสรี" : "ไม่มีรหัสวิชา")}
        </span>
        {row.hours > 1 && (
          <span className="shrink-0 px-1 rounded bg-violet-100 text-violet-700 text-[9px] font-bold">
            คู่
          </span>
        )}
      </div>
      <div className="text-[10px] text-gray-600 truncate">{row.group_name ?? "—"}</div>
      <div className="text-[10px] text-gray-400 truncate">{row.teacher_name ?? "ยังไม่มีครู"}</div>
      <div className="mt-0.5 text-[9px] text-amber-700 truncate">ยกมาจาก {where}</div>

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void unpark(row.parked_id); }}
          disabled={!row.home_free || row.from_day == null}
          title={row.from_day == null ? "ไม่รู้ที่เดิมของคาบนี้ — ลากไปวางในช่องที่ต้องการ"
            : row.home_free ? `คืนไปที่ ${where}`
            : "ที่เดิมมีคาบอื่นลงไปแล้ว — ลากไปวางช่องอื่น"}
          className="flex-1 px-1 py-0.5 rounded text-[9px] font-semibold bg-emerald-600 text-white
                     hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400"
        >
          คืนที่เดิม
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void drop(row.parked_id); }}
          title="ทิ้งคาบนี้ไปเลย — ชั้นนี้จะไม่ได้เรียนคาบนี้"
          className="px-1 py-0.5 rounded text-[9px] text-gray-400 hover:text-rose-700 hover:bg-rose-50"
        >
          ทิ้ง
        </button>
      </div>
    </div>
  );
};

export const ParkTray: React.FC = () => {
  const parked = useTimetableStore((s) => s.parked);
  const err    = useTimetableStore((s) => s.parkError);
  const { setNodeRef, isOver } = useDroppable({ id: PARK_DROP_ID, data: { park: true } });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "mt-2 rounded-lg border-2 border-dashed px-3 py-2 transition-colors",
        isOver ? "border-amber-500 bg-amber-50"
               : parked.length ? "border-amber-300 bg-amber-50/40"
                               : "border-gray-200 bg-gray-50/60",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm">📥</span>
        <span className="text-[11px] font-bold text-gray-700">ที่พักคาบ</span>
        {parked.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px] font-bold">
            {parked.length} คาบรออยู่
          </span>
        )}
        <span className="text-[10px] text-gray-500 truncate">
          {parked.length === 0
            ? "ลากคาบมาทิ้งตรงนี้เพื่อยกออกจากตารางไว้ก่อน แล้วค่อยลากกลับไปวางทีหลัง"
            : "ลากการ์ดไปวางในช่องที่ต้องการ หรือกดคืนที่เดิม"}
        </span>
      </div>

      {err && (
        <div className="mt-1 px-2 py-1 rounded bg-rose-50 border border-rose-200 text-[10px] text-rose-800">
          {err}
        </div>
      )}

      {parked.length > 0 && (
        <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
          {parked.map((row) => <Card key={row.parked_id} row={row} />)}
        </div>
      )}
    </div>
  );
};
