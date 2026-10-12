/**
 * คาบที่ลงไม่ได้ — what did not fit, and why.
 *
 * The solver used to say "ไม่สามารถจัด ค32205 ครบ 3 คาบ (จัดได้ 1/3)" and
 * stop there, which left the school guessing: cut a period? add a teacher?
 * unlock something? The answer is knowable — every cell of that class's week
 * was refused for a reason, and the reasons can be counted.
 *
 * So each row opens into: what stood in the way and how often, how many cells
 * are genuinely still free, and which of the class's own lessons could move
 * out to a ลาน to free a room. The last one is the lever the school actually
 * has when it is short of rooms, so it is one click from here.
 */
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { DAYS, periodLabel } from "../../types";
import type { UnplacedRow } from "../../api/client";

const BLOCKER_TH: Record<string, string> = {
  group_busy:  "ห้องเรียนไม่ว่าง",
  teacher_busy: "ครูไม่ว่าง",
  teacher_off:  "ครูหยุดวันนั้น",
  consecutive:  "ติดเพดานคาบต่อเนื่อง",
  no_room:      "ไม่มีห้องว่าง",
  no_group:     "ไม่พบห้องเรียนนี้แล้ว",
  no_teacher:   "ยังไม่ได้เลือกครู",
};
const BLOCKER_FIX: Record<string, string> = {
  group_busy:   "ห้องนี้ถูกจัดเต็มสัปดาห์แล้ว — ต้องลดคาบของวิชาใดวิชาหนึ่ง หรือเพิ่มคาบในตารางเวลา",
  teacher_busy: "ครูคนนี้สอนเต็มในคาบเหล่านั้น — ย้ายวิชาอื่นของครู หรือให้ครูอีกคนช่วยสอนห้องนี้",
  teacher_off:  "ครูตั้งวันหยุดไว้ — ถ้าจำเป็นต้องสอนวันนั้น แก้ที่การตั้งค่าของครู",
  consecutive:  "จะทำให้ครูสอนติดกันเกินเพดาน — ปลดเพดานของครูคนนี้ หรือย้ายคาบอื่นออก",
  no_room:      "ห้องเต็มในคาบเหล่านั้น — ดูรายการ “ย้ายลงลานได้” ข้างล่าง หรือเพิ่มห้องที่วิชานี้ใช้ได้",
  no_group:     "ห้องเรียนที่รายวิชานี้ผูกไว้ถูกลบไปแล้ว จึงลงตารางไม่ได้เลย — กดปุ่มข้างบนเพื่อลบแถวค้างทั้งหมด",
  no_teacher:   "แถวนี้ยังไม่มีครูผู้สอน จึงไม่ถูกจัดลงตาราง — เลือกครูให้ที่หน้ารายวิชาของห้องนี้",
};

export const UnplacedModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { periods, loadAll } = useTimetableStore();
  const [rows, setRows] = useState<UnplacedRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setRows(null); setErr(null);
    api.fetchUnplaced()
      .then((d) => { setRows(d.unplaced); if (d.unplaced.length === 1) setOpen(d.unplaced[0].requirement_id); })
      .catch(() => setErr("อ่านข้อมูลไม่สำเร็จ — ลองกดจัดตารางใหม่หนึ่งครั้งแล้วเปิดอีกที"));
  };
  useEffect(load, []);

  const total = rows?.reduce((n, r) => n + r.missing, 0) ?? 0;
  const orphanRows = (rows ?? []).filter((r) => r.orphan);
  const orphans = orphanRows.length;
  const orphanPeriods = orphanRows.reduce((n, r) => n + r.missing, 0);
  const byClass = useMemo(() => {
    const m = new Map<string, number>();
    // Orphan rows are left out: they are not a class that failed to fit, and
    // counting them made the nameless "?" the worst "class" in the school.
    for (const r of rows ?? []) {
      if (r.orphan) continue;
      m.set(r.group_name ?? "?", (m.get(r.group_name ?? "?") ?? 0) + r.missing);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  /** ติ๊กให้วิชานี้ลงลานได้ — the room-freeing lever, applied where it helps. */
  const allowOutdoor = async (subjectId: number) => {
    setBusy(true);
    try {
      const updated = await api.updateSubject(subjectId, { allow_outdoor: true });
      useTimetableStore.setState((st) => ({
        subjects: st.subjects.map((x) => (x.id === subjectId ? { ...x, ...updated } : x)),
      }));
      load();
    } finally { setBusy(false); }
  };

  const cell = (d: number, p: number) => `${DAYS[d] ?? d} ${periodLabel(p, periods)}`;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-4xl" tall>
      <div className="flex items-center gap-3 bg-rose-700 px-5 py-4 shrink-0">
        <span className="text-2xl">🧩</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            คาบที่ลงไม่ได้ — และเพราะอะไร
          </h2>
          <p className="text-rose-100 text-xs mt-0.5">
            {rows == null
              ? "กำลังตรวจ…"
              : `ขาด ${total - orphanPeriods} คาบ จาก ${rows.length - orphans} รายการ`}
            {orphans > 0 && ` · แถวค้างอีก ${orphanPeriods} คาบ`}
            {byClass.length > 0 && ` · หนักสุด: ${byClass.slice(0, 3).map(([g, n]) => `${g} (${n})`).join(" · ")}`}
          </p>
        </div>
        <button onClick={onClose} className="text-rose-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {err && <p className="text-xs text-red-700">{err}</p>}

        {/* แถวค้าง: a row whose ห้องเรียน was deleted can never be placed and
            can never be opened to be fixed. They are reported first, with the
            one action that resolves them, because on this school's data they
            were the single largest block of "missing" periods. */}
        {orphans > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
            <p className="text-sm font-semibold text-amber-900">
              แถวค้าง {orphans} รายการ · {orphanPeriods} คาบ
            </p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              รายวิชาเหล่านี้ผูกอยู่กับห้องเรียนที่ถูกลบไปแล้ว จึงลงตารางไม่ได้เลยและแก้จากหน้าห้องเรียนก็ไม่ได้
              — ไม่ได้แปลว่าตารางจัดไม่ลง
            </p>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await api.purgeOrphanReqs(); await loadAll(); load(); }
                finally { setBusy(false); }
              }}
              className="mt-2 px-2.5 py-1 rounded bg-amber-600 text-white text-xs font-semibold
                         hover:bg-amber-700 disabled:opacity-50"
            >
              ลบแถวค้างทั้งหมด
            </button>
          </div>
        )}
        {rows != null && rows.length === 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
            ✓ ทุกคาบในแผนการสอนลงตารางได้ครบแล้ว
          </div>
        )}

        {(rows ?? []).map((r) => {
          const isOpen = open === r.requirement_id;
          const top = r.blockers[0];
          return (
            <div key={r.requirement_id} className="border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : r.requirement_id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                <span className={clsx("shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold",
                  r.missing > 0 ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900")}>
                  {r.missing > 0 ? `ขาด ${r.missing}` : `ไม่มีห้อง ${r.roomless}`}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-gray-800">
                    {r.group_name} · {r.subject_code}
                  </span>
                  <span className="text-xs text-gray-500"> {r.subject_name}</span>
                  <span className="block text-[11px] text-gray-500 truncate">
                    ครู {r.teacher_name} · ขอ {r.wanted} ลงได้ {r.placed}
                    {r.roomless > 0 && ` · ลงแล้วแต่ไม่มีห้อง ${r.roomless} คาบ`}
                    {top && ` · ส่วนใหญ่ติดที่ ${BLOCKER_TH[top.kind] ?? top.kind}`}
                  </span>
                </span>
                <span className="text-gray-400 text-xs shrink-0">{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 pt-1 space-y-2 bg-gray-50/60 border-t border-gray-100">
                  {/* ติดอะไร */}
                  <div className="space-y-1">
                    {r.blockers.map((b) => (
                      <div key={b.kind} className="text-[11px]">
                        <span className="inline-block w-36 font-semibold text-gray-700">
                          {BLOCKER_TH[b.kind] ?? b.kind}
                        </span>
                        <span className="text-gray-500">{b.count} ช่อง</span>
                        {b.example && <span className="text-gray-400"> · {b.example}</span>}
                        <p className="ml-36 text-gray-500">{BLOCKER_FIX[b.kind]}</p>
                      </div>
                    ))}
                  </div>

                  {/* ช่องที่ยังว่าง */}
                  <p className="text-[11px]">
                    {r.free_cells.length === 0 ? (
                      <span className="text-rose-700">
                        ⚠ ไม่มีช่องไหนในสัปดาห์ที่ลงได้เลย — ต้องลดคาบหรือเพิ่มทรัพยากรก่อน
                        (สัปดาห์นี้มี {r.week_size} ช่อง)
                      </span>
                    ) : (
                      <span className="text-amber-800">
                        มีช่องที่ลงได้อยู่ {r.free_cells.length} ช่อง
                        ({r.free_cells.slice(0, 4).map((c) => cell(c.day, c.period)).join(" · ")}
                        {r.free_cells.length > 4 ? " …" : ""}) — ลองกดสร้างตารางใหม่อีกครั้ง
                      </span>
                    )}
                  </p>

                  {/* วิชาในห้องนี้ที่ย้ายลงลานได้ */}
                  {r.movable_outdoor.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-600 mb-1">
                        วิชาที่ {r.group_name} เรียนอยู่ และย้ายลงลานได้ (ติ๊กแล้วห้องในอาคารจะว่างขึ้น)
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {r.movable_outdoor.map((m) => (
                          <span key={m.slot_id}
                            className={clsx("inline-flex items-center gap-1 text-[11px] border rounded px-1.5 py-0.5",
                              m.already_allowed
                                ? "bg-green-50 border-green-300 text-green-800"
                                : "bg-white border-gray-300 text-gray-700")}>
                            {cell(m.day, m.period)} · {m.subject_code}
                            <span className="text-gray-400">{m.room_name}</span>
                            {m.already_allowed ? (
                              <span title="ลงลานได้แล้ว">🌳</span>
                            ) : (
                              <button onClick={() => m.subject_id && allowOutdoor(m.subject_id)}
                                disabled={busy}
                                title={`ติ๊กให้ ${m.subject_code} ลงลานได้`}
                                className="text-green-700 hover:text-green-900 font-bold disabled:opacity-40">
                                +🌳
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">
                        ติ๊กเป็นรายวิชา มีผลกับทุกห้องที่เรียนวิชานั้น · ลานจะถูกใช้เมื่อห้องในอาคารเต็มแล้วเท่านั้น
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between shrink-0">
        <button onClick={() => { loadAll(); load(); }} disabled={busy}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40">
          ตรวจใหม่
        </button>
        <button onClick={onClose}
          className="px-5 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg font-medium">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
