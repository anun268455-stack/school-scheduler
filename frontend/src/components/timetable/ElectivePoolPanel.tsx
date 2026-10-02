/**
 * ElectivePoolPanel — คาบเสรี, managed window-first.
 *
 * The order here follows the order the work actually happens in at school:
 *
 *   1. Say WHICH CLASSES share the elective and WHEN it runs. The window goes
 *      into the timetable and is locked there straight away, empty. Nothing
 *      else can be scheduled on top of it while the subject list is settled.
 *   2. Add the subjects students may choose between, one at a time. Each row
 *      names the teacher who takes it, so who is covering what is visible the
 *      whole time rather than something to reconstruct later.
 *
 * Every option in a window runs simultaneously, so each needs a different
 * teacher. A teacher taken twice — by another lesson at that hour, or by a
 * second option in the same window — is flagged on the row, with a one-click
 * change of teacher to fix it. That check is the reason to do it this way:
 * conflicts surface while they are still cheap, not after generation.
 */
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups } from "../../utils/groupHierarchy";
import { TableSearch, matches } from "../common/TableSearch";
import { SearchableSelect } from "../common/SearchableSelect";
import { AddElectiveSubjectModal } from "./AddElectiveSubjectModal";
import { DAYS, periodLabel } from "../../types";
import type { ElectivePool, ElectivePoolOption, PoolTeacherCandidate, Period } from "../../types";

// ── Small shared pieces ──────────────────────────────────────────────────────

/** "ชนกับ ม.5/1 ทักษะดนตรีไทย" — said once, in full, on the row that owns it. */
const ConflictNote: React.FC<{ option: ElectivePoolOption }> = ({ option }) => {
  const c = option.conflicts ?? [];
  if (c.length === 0) return null;
  return (
    <span className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
      ⚠ ครูชนกับ {c.map((x) => `${x.group_name ?? ""} ${x.subject_name ?? ""}`.trim()).join(" · ")}
    </span>
  );
};

/** Day + period + คาบคู่, used both when creating a window and when moving one. */
const WhenPicker: React.FC<{
  day: number | null;
  period: number | null;
  isDouble: boolean;
  periods: Period[];
  onChange: (v: { day: number | null; period: number | null; isDouble: boolean }) => void;
  compact?: boolean;
}> = ({ day, period, isDouble, periods, onChange, compact }) => {
  const classPeriods = useMemo(
    () => [...new Map(periods.filter((p) => p.type === "class").map((p) => [p.period_num, p])).values()]
      .sort((a, b) => a.period_num - b.period_num),
    [periods],
  );
  // A double needs a following class period. Note that a break between two
  // numbers means they are not really adjacent, so those are called out.
  const doubleNote = (p: number) => {
    const i = classPeriods.findIndex((x) => x.period_num === p);
    if (i < 0 || i + 1 >= classPeriods.length) return "คาบสุดท้าย — ทำคาบคู่ไม่ได้";
    const next = classPeriods[i + 1].period_num;
    return next === p + 1 ? "" : `คาบคู่จะข้ามไปคาบ ${next} (มีคาบพักคั่น)`;
  };
  const note = period != null && isDouble ? doubleNote(period) : "";
  const cls = compact
    ? "border border-gray-300 rounded px-1.5 py-1 text-xs"
    : "border border-gray-300 rounded px-2 py-1.5 text-sm";

  return (
    <>
      <select className={cls} value={day ?? ""}
        onChange={(e) => onChange({ day: e.target.value === "" ? null : Number(e.target.value), period, isDouble })}>
        <option value="">— วัน —</option>
        {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
      </select>
      <select className={cls} value={period ?? ""}
        onChange={(e) => onChange({ day, period: e.target.value === "" ? null : Number(e.target.value), isDouble })}>
        <option value="">— คาบ —</option>
        {classPeriods.map((p) => (
          <option key={p.period_num} value={p.period_num}>{periodLabel(p.period_num, periods)}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0">
        <input type="checkbox" checked={isDouble}
          onChange={(e) => onChange({ day, period, isDouble: e.target.checked })} />
        คาบคู่
      </label>
      {note && <span className="text-[10px] text-amber-700 shrink-0">{note}</span>}
    </>
  );
};

// ── Adding a subject to a window ─────────────────────────────────────────────

const AddOptionRow: React.FC<{
  pool: ElectivePool;
  onDone: (p: ElectivePool) => void;
}> = ({ pool, onDone }) => {
  const { subjects, departments } = useTimetableStore();
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [cands, setCands] = useState<PoolTeacherCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whenever the subject changes, ask who could take it here. The reply is
  // ordered so the likely answer is first, and says who is already busy.
  useEffect(() => {
    setTeacherId("");
    if (!subjectId) { setCands([]); return; }
    let live = true;
    api.fetchPoolTeachers(pool.id, Number(subjectId))
      .then((r) => { if (live) setCands(r); })
      .catch(() => { if (live) setCands([]); });
    return () => { live = false; };
  }, [subjectId, pool.id, pool.day, pool.period, pool.options.length]);

  const taken = new Set(pool.options.map((o) => o.subject_id));
  const subjectOpts = useMemo(() => {
    const dName = (id?: number | null) => departments.find((d) => d.id === id)?.name ?? "ไม่ระบุกลุ่มสาระ";
    return [...subjects]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((s) => ({
        value: String(s.id),
        label: `${s.code} – ${s.name}`,
        hint: taken.has(s.id) ? "อยู่ในคาบนี้แล้ว" : undefined,
        group: dName(s.department_id),
        disabled: taken.has(s.id),
      }));
  }, [subjects, departments, pool.options]);

  // The default teacher — what the staffing data says — is shown pre-selected
  // so the usual case is one click, while still being changeable.
  const suggested = cands.find((c) => c.teaches_subject) ?? cands[0];
  const teacherOpts = useMemo(
    () => cands.map((c) => ({
      value: String(c.id),
      label: `${c.code ? `${c.code} ` : ""}${c.name}`,
      hint: !c.free
        ? `ไม่ว่าง — ${c.conflicts.map((x) => x.group_name ?? "").filter(Boolean).join(", ")}`
        : c.teaches_subject ? "สอนวิชานี้อยู่" : undefined,
      group: c.teaches_subject ? "ครูที่สอนวิชานี้"
        : c.same_department ? "กลุ่มสาระเดียวกัน" : "ครูอื่น",
    })),
    [cands],
  );

  const chosen = cands.find((c) => c.id === Number(teacherId)) ?? suggested;

  const add = async () => {
    if (!subjectId) return;
    setBusy(true); setError(null);
    try {
      onDone(await api.addPoolOption(pool.id, {
        subject_id: Number(subjectId),
        teacher_id: teacherId ? Number(teacherId) : chosen?.id,
      }));
      setSubjectId(""); setTeacherId("");
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "เพิ่มวิชาไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  return (
    <div className="border-t border-dashed border-gray-200 pt-2 mt-1 space-y-1.5">
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[10px] text-gray-500 mb-0.5">วิชาที่ให้นักเรียนเลือก</label>
          <SearchableSelect value={subjectId} onChange={setSubjectId}
            options={subjectOpts} placeholder="ค้นหาวิชา (รหัส/ชื่อ)…" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] text-gray-500 mb-0.5">
            ครูผู้สอน {suggested && !teacherId && <span className="text-gray-400">(ระบบเลือกให้แล้ว แก้ได้)</span>}
          </label>
          <SearchableSelect
            value={teacherId || (suggested ? String(suggested.id) : "")}
            onChange={setTeacherId}
            options={teacherOpts}
            disabled={!subjectId}
            placeholder={subjectId ? "ค้นหาครู…" : "เลือกวิชาก่อน"} />
        </div>
        <button onClick={add} disabled={busy || !subjectId}
          className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40">
          {busy ? "…" : "+ เพิ่มวิชา"}
        </button>
      </div>
      {chosen && !chosen.free && (
        <p className="text-[10px] text-red-700">
          ⚠ {chosen.name} ไม่ว่างคาบนี้ — สอน{" "}
          {chosen.conflicts.map((x) => `${x.group_name ?? ""} ${x.subject_name ?? ""}`.trim()).join(" · ")}
          {" "}อยู่ เลือกครูคนอื่นหรือย้ายคาบเสรีนี้
        </p>
      )}
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
};

// ── Creating a window ────────────────────────────────────────────────────────

const CreateWindow: React.FC<{ onCreated: () => void }> = ({ onCreated }) => {
  const { groups, periods } = useTimetableStore();
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const g of flat) if (g.level) s.add(g.level);
    return [...s].sort();
  }, [flat]);

  const [open, setOpen]   = useState(false);
  const [name, setName]   = useState("");
  const [level, setLevel] = useState(() => levels[0] ?? "");
  const [picked, setPicked] = useState<number[]>([]);
  const [when, setWhen] = useState<{ day: number | null; period: number | null; isDouble: boolean }>(
    { day: null, period: null, isDouble: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inLevel = useMemo(() => flat.filter((g) => (g.level ?? "") === level), [flat, level]);
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const create = async () => {
    if (picked.length === 0) { setError("เลือกห้องเรียนอย่างน้อย 1 ห้อง"); return; }
    setBusy(true); setError(null);
    try {
      await api.createElectivePool({
        name: name || `คาบเสรี ${level}`,
        group_ids: picked,
        day: when.day, period: when.period, is_double: when.isDouble,
      });
      setName(""); setPicked([]); setWhen({ day: null, period: null, isDouble: true });
      setOpen(false);
      onCreated();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "สร้างไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full px-3 py-2 text-sm border-2 border-dashed border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50">
        + สร้างคาบเสรีใหม่ (เลือกห้อง + วัน/คาบ ก่อน แล้วค่อยใส่วิชา)
      </button>
    );
  }

  return (
    <div className="border border-purple-300 bg-purple-50/50 rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-purple-900 flex-1">สร้างคาบเสรีใหม่</p>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-sm">✕</button>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] text-gray-500 mb-0.5">ชื่อคาบเสรี</label>
          <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder={`คาบเสรี ${level}`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">ระดับชั้น</label>
          <select className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            value={level} onChange={(e) => setLevel(e.target.value)}>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="text-[11px] text-gray-500">ห้องที่เรียนคาบเสรีนี้ร่วมกัน</label>
          <button onClick={() => setPicked([...new Set([...picked, ...inLevel.map((g) => g.id)])])}
            className="text-[10px] text-purple-700 hover:underline">เลือกทั้ง {level}</button>
          {picked.length > 0 && (
            <button onClick={() => setPicked([])} className="text-[10px] text-gray-500 hover:underline">
              ล้าง ({picked.length})
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
          {inLevel.map((g) => (
            <button key={g.id} onClick={() => toggle(g.id)}
              className={clsx("text-[11px] px-2 py-1 rounded border",
                picked.includes(g.id)
                  ? "bg-purple-600 border-purple-600 text-white"
                  : "bg-white border-gray-200 text-gray-700 hover:border-purple-400")}>
              {g.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] text-gray-500">คาบเสรีนี้อยู่</label>
        <WhenPicker {...when} periods={periods} onChange={setWhen} />
      </div>

      <p className="text-[10px] text-gray-500">
        เว้นวัน/คาบไว้ก็ได้ — จะสร้างไว้ก่อนแล้วมากำหนดภายหลัง
        ถ้ากำหนดเลย ระบบจะล็อกช่องนั้นในตารางให้ทันที แล้วค่อยใส่วิชาทีหลัง
      </p>

      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-600 flex-1">{error}</span>}
        {!error && <span className="flex-1" />}
        <button onClick={create} disabled={busy}
          className="px-4 py-1.5 text-sm bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 disabled:opacity-40">
          {busy ? "กำลังสร้าง…" : "สร้างคาบเสรี"}
        </button>
      </div>
    </div>
  );
};

// ── One window ───────────────────────────────────────────────────────────────

const PoolCard: React.FC<{
  pool: ElectivePool;
  expanded: boolean;
  onToggle: () => void;
  onChanged: (p?: ElectivePool) => void;
}> = ({ pool, expanded, onToggle, onChanged }) => {
  const { groups, periods } = useTimetableStore();
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const gName = (id: number) => flat.find((g) => g.id === id)?.name ?? String(id);

  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState({ day: pool.day, period: pool.period, isDouble: pool.is_double });
  const [swapping, setSwapping] = useState<number | null>(null);
  const [cands, setCands] = useState<PoolTeacherCandidate[]>([]);

  const pinned = pool.day != null && pool.period != null;
  const conflicts = pool.conflict_count ?? 0;
  const unplaced = pool.unplaced_groups ?? [];

  const applyMove = async () => {
    setBusy(true);
    try {
      if (when.day == null || when.period == null) {
        await api.unplaceElectivePool(pool.id);
      } else {
        await api.placeElectivePool(pool.id, {
          day: when.day, period: when.period, is_double: when.isDouble,
        });
      }
      setMoving(false);
      onChanged();
    } finally { setBusy(false); }
  };

  const openSwap = async (o: ElectivePoolOption) => {
    setSwapping(o.key);
    setCands(await api.fetchPoolTeachers(pool.id, o.subject_id).catch(() => []));
  };

  const doSwap = async (o: ElectivePoolOption, teacherId: number) => {
    setBusy(true);
    try {
      onChanged(await api.updatePoolOption(pool.id, o.key, { teacher_id: teacherId }));
      setSwapping(null);
    } finally { setBusy(false); }
  };

  const removeOption = async (o: ElectivePoolOption) => {
    setBusy(true);
    try { onChanged(await api.deletePoolOption(pool.id, o.key)); }
    finally { setBusy(false); }
  };

  const removePool = async () => {
    setBusy(true);
    try { await api.deleteElectivePool(pool.id); onChanged(); }
    finally { setBusy(false); }
  };

  return (
    <div className={clsx("border rounded-lg overflow-hidden",
      conflicts > 0 ? "border-red-300 bg-red-50/30"
        : pinned ? "border-purple-300 bg-purple-50/30" : "border-gray-200 bg-white")}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onToggle} className="text-gray-400 hover:text-gray-700 text-xs w-4 shrink-0">
          {expanded ? "▾" : "▸"}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{pool.name}</p>
          <p className="text-[11px] text-gray-500">
            {pool.group_ids.length} ห้องเรียน · {pool.options.length} วิชาให้เลือก
            {pool.is_double ? " · คาบคู่" : ""}
          </p>
        </div>
        {pinned ? (
          <span className="text-[11px] text-purple-800 bg-purple-100 border border-purple-200 rounded px-2 py-1 shrink-0">
            🔒 {DAYS[pool.day!]} {periodLabel(pool.period!, periods)}
          </span>
        ) : (
          <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 shrink-0">
            ยังไม่กำหนดวัน/คาบ
          </span>
        )}
        {conflicts > 0 && (
          <span className="text-[11px] text-red-700 bg-red-100 border border-red-200 rounded px-2 py-1 shrink-0">
            ⚠ ครูชน {conflicts}
          </span>
        )}
        <button onClick={() => { setWhen({ day: pool.day, period: pool.period, isDouble: pool.is_double }); setMoving((v) => !v); }}
          className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 shrink-0">
          {pinned ? "ย้ายคาบ" : "กำหนดคาบ"}
        </button>
      </div>

      {/* Move / pin */}
      {moving && (
        <div className="border-t border-gray-100 px-3 py-2 flex items-center gap-2 flex-wrap bg-white">
          <WhenPicker {...when} periods={periods} compact
            onChange={(v) => setWhen({ day: v.day, period: v.period, isDouble: v.isDouble })} />
          <button onClick={applyMove} disabled={busy}
            className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40">
            {busy ? "…" : "บันทึก"}
          </button>
          <button onClick={() => setMoving(false)} className="px-2 py-1 text-xs text-gray-500">ยกเลิก</button>
          {pinned && (
            <span className="text-[10px] text-gray-400">เว้นวัน/คาบว่าง = ยกออกจากตาราง (วิชาไม่หาย)</span>
          )}
        </div>
      )}

      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2.5 bg-white space-y-2">
          {/* Classes */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 mb-1">ห้องที่เรียนร่วมกัน</p>
            <div className="flex flex-wrap gap-1">
              {pool.group_ids.map((id) => {
                const missed = unplaced.some((u) => u.group_id === id);
                return (
                  <span key={id} title={missed ? "ห้องนี้มีคาบอื่นทับอยู่ จึงยังไม่ได้ลงตาราง" : undefined}
                    className={clsx("text-[11px] rounded px-1.5 py-0.5 border",
                      missed ? "bg-amber-50 border-amber-300 text-amber-800"
                        : "bg-gray-100 border-gray-200 text-gray-700")}>
                    {missed && "⚠ "}{gName(id)}
                  </span>
                );
              })}
            </div>
            {unplaced.length > 0 && (
              <p className="text-[10px] text-amber-700 mt-1">
                {unplaced.length} ห้องยังไม่ได้ลงตารางเพราะมีคาบอื่นอยู่คาบนั้นแล้ว —
                ล้างคาบนั้นก่อน หรือย้ายคาบเสรีไปคาบอื่น
              </p>
            )}
          </div>

          {/* Subjects */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 mb-1">
              วิชาในคาบเสรีนี้ ({pool.options.length}) — ทุกวิชาเรียนพร้อมกัน ครูต้องไม่ซ้ำกัน
            </p>
            {pool.options.length === 0 && (
              <p className="text-[11px] text-gray-400 py-2">
                ยังไม่มีวิชา — ช่องในตารางถูกล็อกไว้แล้ว เพิ่มวิชาได้ด้านล่าง
              </p>
            )}
            <div className="divide-y divide-gray-50">
              {pool.options.map((o) => (
                <div key={o.key} className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-gray-400 w-14 shrink-0">{o.subject_code ?? "—"}</span>
                    <span className="text-xs text-gray-800 flex-1 truncate" title={o.subject_name ?? ""}>
                      {o.subject_name ?? o.label}
                    </span>
                    <span className={clsx("text-xs truncate max-w-[34%] shrink-0",
                      (o.conflicts?.length ?? 0) > 0 ? "text-red-700 font-medium" : "text-gray-600")}>
                      {o.teacher_code ? `${o.teacher_code} ` : ""}{o.teacher_name ?? "— ไม่มีครู —"}
                    </span>
                    <button onClick={() => (swapping === o.key ? setSwapping(null) : openSwap(o))}
                      className="text-[10px] text-blue-600 hover:underline shrink-0">เปลี่ยนครู</button>
                    <button onClick={() => removeOption(o)} disabled={busy}
                      className="text-xs text-red-400 hover:text-red-600 shrink-0" title="เอาวิชานี้ออก">✕</button>
                  </div>
                  {(o.conflicts?.length ?? 0) > 0 && (
                    <div className="pl-16 mt-0.5"><ConflictNote option={o} /></div>
                  )}
                  {swapping === o.key && (
                    <div className="pl-16 mt-1 flex flex-wrap gap-1">
                      {cands.slice(0, 14).map((c) => (
                        <button key={c.id} onClick={() => doSwap(o, c.id)} disabled={busy || c.id === o.teacher_id}
                          className={clsx("text-[10px] px-1.5 py-0.5 rounded border",
                            c.id === o.teacher_id ? "bg-gray-100 border-gray-200 text-gray-400"
                              : c.free ? "bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                              : "bg-white border-red-200 text-red-600 hover:bg-red-50")}
                          title={c.free ? "ว่างคาบนี้" : `ไม่ว่าง: ${c.conflicts.map((x) => x.group_name).join(", ")}`}>
                          {c.free ? "✓ " : "⚠ "}{c.code} {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <AddOptionRow pool={pool} onDone={onChanged} />
          </div>

          <div className="flex justify-end pt-1">
            <button onClick={removePool} disabled={busy}
              className="text-[11px] text-red-500 hover:text-red-700 hover:underline">
              ลบคาบเสรีนี้ทั้งหมด
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── The panel ────────────────────────────────────────────────────────────────

export const ElectivePoolPanel: React.FC = () => {
  const { groups, loadSlots } = useTimetableStore();
  const [pools, setPools] = useState<ElectivePool[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [addingSubject, setAddingSubject] = useState(false);

  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const gName = (id: number) => flat.find((g) => g.id === id)?.name ?? String(id);

  const reload = async () => {
    setPools(await api.fetchElectivePools());
    await loadSlots();
    setLoading(false);
  };
  useEffect(() => { reload().catch(() => setLoading(false)); }, []);

  /** A single changed window comes back from the API — swap it in, don't refetch. */
  const onChanged = (p?: ElectivePool) => {
    if (!p) { reload(); return; }
    setPools((list) => list.map((x) => (x.id === p.id ? p : x)));
    loadSlots();
  };

  const shown = useMemo(
    () => pools.filter((p) => matches(q, p.name, p.raw_group,
      ...p.options.map((o) => `${o.subject_code ?? ""} ${o.subject_name ?? ""} ${o.teacher_name ?? ""}`),
      ...p.group_ids.map(gName))),
    [pools, q, flat],
  );

  const pinnedCount = pools.filter((p) => p.day != null).length;
  const clashCount  = pools.reduce((n, p) => n + (p.conflict_count ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
        <span className="text-xl">🎓</span>
        <div className="text-xs text-purple-900 leading-relaxed">
          <strong>คาบเสรี</strong> = คาบหนึ่งที่หลายห้องเรียนพร้อมกัน แล้วนักเรียนเลือกเรียนคนละวิชา
          <br />
          <strong>ลำดับการทำ:</strong> 1) สร้างคาบเสรี เลือกห้อง + วัน/คาบ → ช่องนั้นถูก
          <strong>ล็อก</strong>ในตารางทันที 2) ค่อยใส่วิชาเข้าไป แต่ละวิชาจะเห็นชื่อครูผู้สอนกำกับไว้
          <br />
          ทุกวิชาในคาบเดียวกันเรียนพร้อมกัน <strong>ครูจึงต้องไม่ซ้ำกัน</strong> —
          ถ้าครูชนกับคาบอื่นหรือซ้ำกันเอง ระบบจะขึ้น ⚠ ให้เห็นทันที กดเปลี่ยนครูได้เลย
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap">
        <span>ทั้งหมด <strong>{pools.length}</strong> คาบเสรี</span>
        <span>· ลงตารางแล้ว <strong className="text-purple-700">{pinnedCount}</strong></span>
        {clashCount > 0 && <span className="text-red-700">· ⚠ ครูชนกัน {clashCount} จุด</span>}
        <button
          onClick={() => setAddingSubject(true)}
          disabled={pinnedCount === 0}
          title={pinnedCount === 0 ? "ต้องมีคาบเสรีที่กำหนดวัน/คาบแล้วอย่างน้อย 1 คาบ" : undefined}
          className="ml-auto px-2.5 py-1 text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100 disabled:opacity-40"
        >
          🎓 เพิ่มวิชาเข้าคาบเสรี…
        </button>
      </div>

      {addingSubject && (
        <AddElectiveSubjectModal onClose={() => setAddingSubject(false)} onDone={reload} />
      )}

      <CreateWindow onCreated={reload} />

      {pools.length > 6 && (
        <TableSearch value={q} onChange={setQ} count={shown.length} total={pools.length}
          placeholder="ค้นหาคาบเสรี / ชื่อวิชา / ชื่อครู / ห้องเรียน…" />
      )}

      {loading && <p className="text-sm text-gray-400 text-center py-8">กำลังโหลด…</p>}
      {!loading && pools.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">ยังไม่มีคาบเสรี — กดปุ่มด้านบนเพื่อสร้าง</p>
      )}

      <div className="space-y-2">
        {shown.map((p) => (
          <PoolCard key={p.id} pool={p} expanded={open === p.id}
            onToggle={() => setOpen(open === p.id ? null : p.id)} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
};
