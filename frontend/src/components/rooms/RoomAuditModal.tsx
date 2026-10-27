/**
 * RoomAuditModal — ปุ่มวิเคราะห์ห้อง
 *
 *   "ตอนนี้ปรับปรุงเสร็จหมดแล้ว แต่ก็มีคาบบางห้องที่ว่างแล้ว บางห้องก็เรียนลาน
 *    อยากให้มีปุ่มตรวจสอบ ถ้าคาบว่างตรงกับห้องก็แจ้งเตือนมา"
 *
 * กวาดทั้งตารางครั้งเดียว แล้วบอกเป็นรายการว่าคาบไหนไม่ได้อยู่ในห้องทั้งที่มี
 * ห้องว่างในชั่วโมงนั้นพอดี กดย้ายได้ทีละแถว หรือกดย้ายให้ทั้งหมดในครั้งเดียว
 *
 * ทุกการย้ายตรงนี้ **เปลี่ยนแค่ห้อง** ไม่ขยับวันหรือคาบ ตารางนักเรียนจึงเหมือน
 * เดิมทุกช่อง และย้อนได้ด้วย Ctrl+Z
 */
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import { DAYS } from "../../types";
import { useTimetableStore } from "../../store/timetableStore";
import { auditRooms, allocateRooms, type AuditRow } from "../../utils/roomAudit";

export const RoomAuditModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const slots     = useTimetableStore((s) => s.slots);
  const rooms     = useTimetableStore((s) => s.rooms);
  const groups    = useTimetableStore((s) => s.groups);
  const subjects  = useTimetableStore((s) => s.subjects);
  const yardPicks = useTimetableStore((s) => s.yardPicks);
  const loadYardPicks = useTimetableStore((s) => s.loadYardPicks);
  const swapRoom  = useTimetableStore((s) => s.swapRoom);
  const setManyRooms = useTimetableStore((s) => s.setManyRooms);

  // หมุดลานคือ "ตั้งใจให้เรียนลาน" ถ้าไม่โหลดมาก่อน จะไปเตือนคาบที่โรงเรียน
  // ตั้งใจไว้เอง — โหลดใหม่ทุกครั้งที่เปิด เผื่อมีคนอื่นเพิ่งปักเพิ่ม
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.resolve(loadYardPicks()).finally(() => setReady(true));
  }, [loadYardPicks]);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | "เรียนลาน" | "ไม่มีห้อง">("all");

  const audit = useMemo(
    () => auditRooms({ slots, rooms, groups, subjects }, yardPicks),
    [slots, rooms, groups, subjects, yardPicks],
  );
  const shown = useMemo(
    () => (kind === "all" ? audit.rows : audit.rows.filter((r) => r.kind === kind)),
    [audit, kind],
  );
  const plan = useMemo(() => allocateRooms(audit), [audit]);
  const movable = audit.rows.length - audit.stuck.length;

  const moveOne = async (row: AuditRow) => {
    if (!row.free.length) return;
    setBusy(true); setDone(null);
    await Promise.resolve(swapRoom(row.slotIds[0], row.free[0].id));
    setBusy(false);
    setDone(`ย้าย ${row.slot.group_name} ${row.slot.subject_code} เข้า ${row.free[0].name} แล้ว`);
  };

  const moveAll = async () => {
    if (!plan.length) return;
    setBusy(true); setDone(null);
    const problem = await setManyRooms(
      plan.map((p) => ({ slotId: p.slotId, roomId: p.roomId })), "วิเคราะห์ห้อง");
    setBusy(false);
    setDone(problem ?? `ย้ายเข้าห้องแล้ว ${plan.length} คาบ`);
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="px-4 py-2.5 border-b border-gray-200 bg-gradient-to-r from-sky-50 to-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🏫</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-800">วิเคราะห์ห้อง</div>
            <div className="text-[11px] text-gray-500">
              คาบที่ไม่ได้อยู่ในห้อง ทั้งที่มีห้องว่างในชั่วโมงนั้น
            </div>
          </div>
          <button onClick={onClose}
            className="ml-auto w-7 h-7 rounded hover:bg-gray-200 text-gray-500 shrink-0">✕</button>
        </div>
      </div>

      {!ready ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
          กำลังอ่านหมุดลาน…
        </div>
      ) : (
        <>
          {/* สรุป */}
          <div className="px-4 py-2 border-b border-gray-100 shrink-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Chip on={kind === "all"} onClick={() => setKind("all")}
                label={`ทั้งหมด ${audit.rows.length}`} tone="sky" />
              <Chip on={kind === "เรียนลาน"} onClick={() => setKind("เรียนลาน")}
                label={`เรียนลาน ${audit.rows.filter((r) => r.kind === "เรียนลาน").length}`} tone="amber" />
              <Chip on={kind === "ไม่มีห้อง"} onClick={() => setKind("ไม่มีห้อง")}
                label={`ไม่มีห้อง ${audit.rows.filter((r) => r.kind === "ไม่มีห้อง").length}`} tone="rose" />
              {audit.stuck.length > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                  หาห้องให้ไม่ได้ {audit.stuck.length}
                </span>
              )}
              <button onClick={() => void moveAll()} disabled={busy || !plan.length}
                title="ย้ายทุกคาบที่หาห้องว่างให้ได้ เข้าห้องในครั้งเดียว — เปลี่ยนแค่ห้อง ไม่ขยับเวลา"
                className="ml-auto px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:bg-emerald-300">
                {busy ? "กำลังย้าย…" : `✓ ย้ายให้ทั้งหมด (${plan.length})`}
              </button>
            </div>

            {/* สิ่งที่ตั้งใจไว้แล้ว ไม่ได้นับเป็นปัญหา */}
            <div className="text-[10px] text-gray-400 leading-relaxed">
              ไม่นับเป็นปัญหา: วิชาพละที่อยู่ลาน {audit.peOnYard} คาบ ·
              คาบที่ปักหมุด 📌 ให้เรียนลานไว้เอง {audit.pinnedOnYard} คาบ ·
              กิจกรรมที่ไม่ต้องมีห้อง (ลูกเสือ ชุมนุม ฯลฯ) {audit.activityNoRoom} คาบ
            </div>
            {plan.length < movable && (
              <div className="text-[10px] text-amber-700">
                ย้ายทีเดียวได้ {plan.length} จาก {movable} คาบ — ที่เหลืออยู่วันและชั่วโมง
                เดียวกัน แย่งห้องว่างชุดเดียวกัน ต้องย้ายเวลาถึงจะลงห้องได้
              </div>
            )}
            {done && (
              <div className="text-[11px] px-2 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">
                {done}
              </div>
            )}
          </div>

          {/* รายการ */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center space-y-2">
                <div className="text-2xl">✅</div>
                <div className="text-xs text-gray-600">
                  ไม่มีคาบไหนตกหล่น — ทุกคาบที่ควรอยู่ในห้องอยู่ในห้องแล้ว
                </div>
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                  <tr className="text-gray-500 text-[10px]">
                    <th className="px-3 py-1.5 text-left font-semibold">ชั้น / วิชา</th>
                    <th className="px-2 py-1.5 text-left font-semibold">เวลา</th>
                    <th className="px-2 py-1.5 text-left font-semibold">ตอนนี้อยู่</th>
                    <th className="px-2 py-1.5 text-left font-semibold">ย้ายเข้า</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.slotIds[0]}
                        className={clsx("border-b border-gray-100",
                          r.free.length ? "hover:bg-sky-50/50" : "bg-gray-50/60")}>
                      <td className="px-3 py-1.5">
                        <b className="text-gray-800">{r.slot.group_name}</b>{" "}
                        <span className="text-gray-700">{r.slot.subject_code}</span>
                        {r.slotIds.length > 1 && (
                          <span className="ml-1 px-1 rounded bg-violet-100 text-violet-700 text-[9px]">คู่</span>
                        )}
                        <div className="text-[10px] text-gray-500 truncate">{r.slot.teacher_name}</div>
                      </td>
                      <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">
                        {DAYS[r.slot.day]} คาบ {r.periods.join("–")}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={clsx("px-1.5 py-0.5 rounded text-[10px]",
                          r.kind === "เรียนลาน" ? "bg-amber-100 text-amber-800"
                                                : "bg-rose-100 text-rose-800")}>
                          {r.nowName}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700">
                        {r.free.length ? (
                          <>
                            <b>{r.free[0].name}</b>
                            {r.free.length > 1 && (
                              <span className="text-[10px] text-gray-400"> +{r.free.length - 1}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-gray-500">{r.note}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {r.free.length > 0 && (
                          <button onClick={() => void moveOne(r)} disabled={busy}
                            className="px-2 py-0.5 rounded border border-sky-400 bg-sky-50 text-sky-800 font-medium hover:bg-sky-100 disabled:opacity-40">
                            ย้าย
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ท้าย — เรื่องห้องที่ไม่เกี่ยวกับคาบใดคาบหนึ่ง */}
          <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 shrink-0 text-[10px] text-gray-600 space-y-0.5">
            {audit.neverUsed.length > 0 && (
              <div>
                🈳 ห้องที่ใช้สอนได้แต่ไม่มีคาบไหนใช้เลยทั้งสัปดาห์ {audit.neverUsed.length} ห้อง —{" "}
                {audit.neverUsed.map((r) => r.name).join(" · ")}
              </div>
            )}
            {audit.closed.length > 0 && (
              <div>
                🚧 ห้องที่ตั้งไว้ว่าใช้สอนไม่ได้ {audit.closed.length} ห้อง — ระบบไม่เคยจัดคาบลงเลย
                (แก้ได้ที่ ⚙ จัดการ › ห้องเรียน)
              </div>
            )}
          </div>
        </>
      )}
    </ModalShell>
  );
};

const Chip: React.FC<{
  on: boolean; onClick: () => void; label: string; tone: "sky" | "amber" | "rose";
}> = ({ on, onClick, label, tone }) => (
  <button onClick={onClick}
    className={clsx("px-2 py-0.5 rounded border font-medium transition-colors",
      on ? (tone === "sky"   ? "bg-sky-600 border-sky-600 text-white"
          : tone === "amber" ? "bg-amber-600 border-amber-600 text-white"
          :                    "bg-rose-600 border-rose-600 text-white")
         : "bg-white border-gray-300 text-gray-600 hover:bg-gray-100")}>
    {label}
  </button>
);
