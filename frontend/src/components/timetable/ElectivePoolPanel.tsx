/**
 * ElectivePoolPanel — "กลุ่มวิชาเสรี": the elective windows the staffing sheet
 * describes, each ready to drop into the timetable in one click.
 *
 * Why pools and not 44 separate lessons: the sheet writes a shared elective as
 * one row per option — "ม.1/7-12 กรีฑา 2 คาบ", "ม.1/7-12 จิตรกรรม 2 คาบ", and
 * so on. Those nine rows are not nine lessons for six classes; they are ONE
 * window those classes share, with nine options students choose between.
 * Entering them one at a time would both take 44 passes and inflate every
 * elective teacher's load sixfold. So each pool is placed once, at a day and
 * period the school picks, and the window appears in all its classes together.
 *
 * The cell shows "วิชาเสรี · N ตัวเลือก" rather than a subject: the class does
 * not sit together in that window, so naming one subject would be wrong. Each
 * option's teacher is still held busy, so nothing else can be scheduled on them.
 */
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups } from "../../utils/groupHierarchy";
import { TableSearch, matches } from "../common/TableSearch";
import { DAYS, periodLabel } from "../../types";
import type { ElectivePool } from "../../types";

export const ElectivePoolPanel: React.FC = () => {
  const { groups, teachers, subjects, periods, loadSlots } = useTimetableStore();

  const [pools, setPools] = useState<ElectivePool[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Where to put the pool being placed. Defaults to the last period of Monday,
  // which is where schools usually park a shared elective.
  const [day, setDay] = useState(0);
  const [period, setPeriod] = useState<number | null>(null);

  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const gName = (id: number) => flat.find((g) => g.id === id)?.name ?? String(id);
  const tName = (id: number) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.code ? `${t.code} ` : ""}${t.name}` : String(id);
  };
  const sName = (id: number) => subjects.find((x) => x.id === id)?.name ?? String(id);

  const classPeriods = useMemo(
    () => [...new Map(periods.filter((p) => p.type === "class").map((p) => [p.period_num, p])).values()]
      .sort((a, b) => a.period_num - b.period_num),
    [periods],
  );

  /** A double needs a following class period to exist, or it cannot be placed. */
  const canDouble = (p: number) => {
    const i = classPeriods.findIndex((x) => x.period_num === p);
    return i >= 0 && i + 1 < classPeriods.length;
  };

  const reload = async () => {
    setPools(await api.fetchElectivePools());
    setLoading(false);
  };
  useEffect(() => { reload().catch(() => setLoading(false)); }, []);

  const shown = useMemo(
    () => pools.filter((p) => matches(q, p.name, p.raw_group,
      ...p.options.map((o) => `${o.code ?? ""} ${o.label}`),
      ...p.group_ids.map(gName))),
    [pools, q, flat],
  );

  const place = async (pool: ElectivePool) => {
    if (period == null) { setMsg("เลือกคาบก่อน"); return; }
    if (pool.is_double && !canDouble(period)) {
      setMsg("คาบนี้เป็นคาบสุดท้ายของวัน วางคาบคู่ไม่ได้");
      return;
    }
    setBusy(pool.id); setMsg(null);
    try {
      const r = await api.placeElectivePool(pool.id, { day, period, is_double: pool.is_double });
      await Promise.all([reload(), loadSlots()]);
      setOpen(null);
      setMsg(
        r.skipped.length === 0
          ? `วาง ${pool.name} ลง ${DAYS[day]} ${periodLabel(period, periods)} เรียบร้อย (${r.created} ห้อง)`
          : `วางได้ ${r.created} ห้อง · ข้าม ${r.skipped.length} ห้องเพราะมีคาบอื่นอยู่แล้ว: ` +
            r.skipped.map((s) => s.group_name ?? s.group_id).join(", "),
      );
    } catch {
      setMsg("วางไม่สำเร็จ");
    } finally { setBusy(null); }
  };

  const unplace = async (pool: ElectivePool) => {
    setBusy(pool.id); setMsg(null);
    try {
      await api.unplaceElectivePool(pool.id);
      await Promise.all([reload(), loadSlots()]);
      setMsg(`ยก ${pool.name} ออกจากตารางแล้ว`);
    } finally { setBusy(null); }
  };

  const placedTotal = pools.filter((p) => (p.placed_count ?? 0) > 0).length;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
        <span className="text-xl">🎓</span>
        <div className="text-xs text-purple-900 leading-relaxed">
          <strong>กลุ่มวิชาเสรี</strong> — หนึ่งกลุ่มคือ "คาบเสรีหนึ่งคาบที่หลายห้องเรียนพร้อมกัน"
          โดยมีวิชาให้นักเรียนเลือกหลายตัวเลือกในคาบนั้น เช่น ม.1/7-12 มี 9 ตัวเลือก
          = 6 ห้องเรียนคาบเดียวกัน ไม่ใช่ 54 คาบ
          <br />
          เลือกวันและคาบ แล้วกด "วางลงตาราง" ระบบจะใส่ให้ทุกห้องในกลุ่มพร้อมกัน
          และกันเวลาครูทุกคนที่สอนตัวเลือกในคาบนั้นไว้ให้ด้วย
        </div>
      </div>

      {/* Where to place */}
      <div className="flex items-end gap-2 flex-wrap bg-white border border-gray-200 rounded-lg px-3 py-2.5">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">วัน</label>
          <select className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">คาบ</label>
          <select className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            value={period ?? ""} onChange={(e) => setPeriod(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— เลือกคาบ —</option>
            {classPeriods.map((p) => (
              <option key={p.period_num} value={p.period_num}>
                {periodLabel(p.period_num, periods)}{canDouble(p.period_num) ? "" : " (คาบสุดท้าย)"}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-gray-500 flex-1 min-w-[160px] pb-1.5">
          วางลงตารางแล้ว {placedTotal} จาก {pools.length} กลุ่ม
        </p>
      </div>

      {msg && (
        <p className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">{msg}</p>
      )}

      <TableSearch value={q} onChange={setQ} count={shown.length} total={pools.length}
        placeholder="ค้นหากลุ่มวิชาเสรี / ชื่อวิชา / ห้องเรียน…" />

      {loading && <p className="text-sm text-gray-400 text-center py-8">กำลังโหลด…</p>}
      {!loading && pools.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีกลุ่มวิชาเสรีในระบบ</p>
      )}

      <div className="space-y-2">
        {shown.map((p) => {
          const isPlaced = (p.placed_count ?? 0) > 0;
          return (
            <div key={p.id} className={clsx(
              "border rounded-lg overflow-hidden",
              isPlaced ? "border-purple-300 bg-purple-50/40" : "border-gray-200 bg-white",
            )}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => setOpen(open === p.id ? null : p.id)}
                  className="text-gray-400 hover:text-gray-700 text-xs w-4 shrink-0">
                  {open === p.id ? "▾" : "▸"}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                  <p className="text-[11px] text-gray-500">
                    {p.group_ids.length} ห้องเรียน · {p.options.length} ตัวเลือก ·
                    {" "}{p.weekly} คาบ{p.is_double ? " (คาบคู่)" : ""}
                  </p>
                </div>
                {isPlaced ? (
                  <span className="text-[11px] text-purple-700 bg-purple-100 border border-purple-200 rounded px-2 py-1 shrink-0">
                    🎓 {DAYS[p.placed_day ?? 0]} {periodLabel(p.placed_period ?? 0, periods)}
                    {" · "}{p.placed_count} ห้อง
                  </span>
                ) : (
                  <span className="text-[11px] text-gray-400 shrink-0">ยังไม่ได้วาง</span>
                )}
                <button
                  onClick={() => place(p)}
                  disabled={busy === p.id || period == null}
                  title={period == null ? "เลือกคาบด้านบนก่อน" : undefined}
                  className="px-2.5 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 shrink-0"
                >
                  {busy === p.id ? "…" : isPlaced ? "ย้ายมาที่นี่" : "วางลงตาราง"}
                </button>
                {isPlaced && (
                  <button onClick={() => unplace(p)} disabled={busy === p.id}
                    className="px-2 py-1 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded shrink-0"
                    title="ยกออกจากตาราง (ไม่ลบกลุ่ม)">
                    ยกออก
                  </button>
                )}
              </div>

              {open === p.id && (
                <div className="border-t border-gray-100 px-3 py-2.5 grid grid-cols-5 gap-3 bg-white">
                  <div className="col-span-2">
                    <p className="text-[11px] font-semibold text-gray-500 mb-1">ห้องเรียนที่เรียนคาบนี้</p>
                    <div className="flex flex-wrap gap-1">
                      {p.group_ids.map((id) => (
                        <span key={id} className="text-[11px] bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
                          {gName(id)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="col-span-3">
                    <p className="text-[11px] font-semibold text-gray-500 mb-1">
                      ตัวเลือกวิชา ({p.options.length})
                    </p>
                    <div className="space-y-0.5">
                      {p.options.map((o, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span className="font-mono text-gray-400 w-14 shrink-0">{o.code ?? "—"}</span>
                          <span className="text-gray-800 flex-1 truncate">{o.label || sName(o.subject_id)}</span>
                          <span className="text-gray-500 truncate max-w-[40%]">{tName(o.teacher_id)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
