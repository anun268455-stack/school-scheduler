/**
 * ชุดเรียนพร้อมกันของห้องย่อย — building a เซ็ต for one class's ก/ข/ค.
 *
 * The thing being described is one hour of one class, seen three ways: ก at
 * maths, ข at English, ค at computing. So the dialog is laid out as that hour
 * — one card per subgroup, side by side, each holding what that subgroup does
 * — rather than as a table of rows that happen to share a key. A set that
 * leaves ค out shows ค's card empty, which is the point being made.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect, subjectOptions, teacherOptions, roomOptions } from "../common/SearchableSelect";
import { useTimetableStore } from "../../store/timetableStore";
import * as api from "../../api/client";
import {
  classesWithSubgroups, subgroupsOf, readSets, makeSetKey, planSetSave, setProblems,
  type SubgroupSet, type SetRow,
} from "../../utils/subgroupSets";
import { DAYS, periodLabel } from "../../types";
import { periodsForLevel, levelKeyOf } from "../../utils/levels";
import { SubgroupAuditView } from "./SubgroupAuditView";
import { auditAll } from "../../utils/subgroupAudit";

interface Props { onClose: () => void; initialParentId?: number | null; }

export const SubgroupSetModal = ({ onClose, initialParentId }: Props) => {
  const { groups, subjects, teachers, departments, requirements, slots, rooms, periods } = useTimetableStore();

  const parents = useMemo(() => classesWithSubgroups(groups), [groups]);
  const [parentId, setParentId] = useState<number | null>(
    initialParentId ?? parents[0]?.id ?? null);
  const subs = useMemo(
    () => (parentId == null ? [] : subgroupsOf(groups, parentId)), [groups, parentId]);

  // Across every split class, not just the one on screen: the badge is there
  // to send someone to the tab they would not otherwise open.
  const auditProblems = useMemo(
    () => auditAll(groups, slots).reduce((n, r) => n + r.problemCount, 0),
    [groups, slots],
  );

  const saved = useMemo(
    () => (parentId == null ? [] : readSets(requirements, parentId)), [requirements, parentId]);

  // The set being edited: null until one is opened or a new one started.
  const [editing, setEditing] = useState<SubgroupSet | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<SetRow[]>([]);
  // Setting the sets up and checking what came out are the same job seen
  // before and after, so they live behind two tabs rather than in two places.
  const [tab, setTab] = useState<"setup" | "audit">("setup");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const nameOf = (id: number) =>
    subs.find((g) => g.id === id)?.name
    ?? groups.flatMap((g) => [g, ...(g.children ?? [])]).find((g) => g.id === id)?.name
    ?? String(id);
  const subjName = (id: number) => {
    const s = subjects.find((x) => x.id === id);
    return s ? `${s.code} ${s.name}` : "—";
  };

  const open = (s: SubgroupSet) => {
    setEditing(s); setName(s.name); setRows(s.rows.map((r) => ({ ...r })));
    setWhen({ day: s.day ?? null, period: s.period ?? null });
    setErr(null); setNote(null);
  };
  const startNew = () => {
    const n = `เซ็ต ${String.fromCharCode(65 + saved.length)}`;
    setEditing({ key: "", parentId: parentId!, name: n, rows: [] });
    setName(n); setRows([]); setWhen({ day: null, period: null });
    setErr(null); setNote(null);
  };

  /** คาบเรียนของชั้นนี้ — ม.ต้น กับ ม.ปลาย พักคนละคาบ */
  const classPeriods = useMemo(() => {
    const parent = groups.flatMap((g) => [g, ...(g.children ?? [])])
      .find((g) => g.id === parentId);
    return periodsForLevel(periods, levelKeyOf(parent)).filter((p) => p.type === "class");
  }, [periods, groups, parentId]);

  // ล็อกวัน/คาบของทั้งเซ็ต — ทุกแถวเรียนพร้อมกันอยู่แล้ว จึงเป็นค่าเดียว
  const [when, setWhen] = useState<{ day: number | null; period: number | null }>(
    { day: null, period: null });

  /** One subgroup's row in the set being edited, or undefined if it is out. */
  const rowFor = (gid: number) => rows.find((r) => r.groupId === gid);
  const setRowFor = (gid: number, patch: Partial<SetRow>) =>
    setRows((prev) => {
      const at = prev.findIndex((r) => r.groupId === gid);
      if (at < 0) {
        return [...prev, { groupId: gid, subjectId: 0, teacherId: 0, weekly: 1, ...patch }];
      }
      return prev.map((r, i) => (i === at ? { ...r, ...patch } : r));
    });
  const dropRow = (gid: number) => setRows((prev) => prev.filter((r) => r.groupId !== gid));

  const problems = useMemo(() => setProblems(rows, nameOf), [rows, subs]);
  const canSave = !!editing && rows.length > 0 && problems.length === 0 && !!name.trim() && !busy;

  const save = async () => {
    if (!editing || parentId == null) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      const key = makeSetKey(parentId, name);
      const plan = planSetSave(key, rows, editing.rows, when);
      // Renaming moves every row to the new key, which the plan does not know
      // about — so a changed name re-stamps the rows that stayed.
      const renamed = editing.key && editing.key !== key;
      for (const id of plan.remove) await api.deleteRequirement(id);
      for (const u of plan.update) await api.updateRequirement(u.id, u.patch);
      if (renamed) {
        for (const r of rows) {
          if (r.requirementId != null) {
            await api.updateRequirement(r.requirementId, { parallel_group_key: key });
          }
        }
      }
      if (plan.create.length > 0) await api.bulkCreateRequirements(plan.create);
      useTimetableStore.setState({ requirements: await api.fetchRequirements() });
      setNote(`บันทึก "${name}" แล้ว — ${rows.length} ห้องย่อยจะเรียนพร้อมกัน`);
      setEditing(null);
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d ?? "บันทึกไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const removeSet = async (s: SubgroupSet) => {
    setBusy(true); setErr(null);
    try {
      for (const r of s.rows) {
        if (r.requirementId != null) await api.deleteRequirement(r.requirementId);
      }
      useTimetableStore.setState({ requirements: await api.fetchRequirements() });
      setNote(`ลบ "${s.name}" แล้ว`);
      if (editing?.key === s.key) setEditing(null);
    } catch {
      setErr("ลบไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-5xl" tall>
      <div className="flex items-center gap-3 bg-indigo-700 px-5 py-4 shrink-0">
        <span className="text-2xl">🧩</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight">
            ชุดเรียนพร้อมกันของห้องย่อย
          </h2>
          <p className="text-indigo-100 text-xs mt-0.5">
            ห้อง ก/ข/ค ของชั้นเดียวกัน เรียนคนละวิชาในชั่วโมงเดียวกัน
          </p>
        </div>
        <button onClick={onClose} className="text-indigo-200 hover:text-white text-lg shrink-0">✕</button>
      </div>

      <div className="flex gap-1 px-5 pt-2 border-b border-gray-200 shrink-0">
        {([["setup", "🧩 ตั้งค่าเซ็ต"], ["audit", "🔍 ตรวจคาบจริงในตาราง"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={clsx("px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === k ? "border-indigo-500 text-indigo-700"
                : "border-transparent text-gray-400 hover:text-gray-600")}>
            {label}
            {k === "audit" && auditProblems > 0 && (
              <span className="ml-1 text-[10px] bg-red-100 text-red-700 border border-red-200 rounded-full px-1.5">
                {auditProblems}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "audit" ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
          <SubgroupAuditView parentId={parentId} />
        </div>
      ) : (
      <>
      <div className="px-5 py-3 border-b border-gray-100 shrink-0 flex items-end gap-3 flex-wrap">
        <div className="min-w-[200px]">
          <label className="block text-[11px] text-gray-500 mb-0.5">ชั้นเรียนที่มีห้องย่อย</label>
          <SearchableSelect
            value={parentId != null ? String(parentId) : ""}
            onChange={(v) => { setParentId(Number(v)); setEditing(null); }}
            options={parents.map((g) => ({
              value: String(g.id), label: g.name,
              hint: `${(g.children ?? []).length} ห้องย่อย`,
            }))}
            emptyLabel="– เลือกชั้นเรียน –"
          />
        </div>
        <button onClick={startNew} disabled={parentId == null}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-40">
          + สร้างเซ็ตใหม่
        </button>
        {parents.length === 0 && (
          <p className="text-xs text-amber-700">
            ยังไม่มีชั้นไหนแบ่งเป็นห้องย่อย — เพิ่มห้องย่อยได้ที่ จัดการ → ห้องเรียน
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-4">
        {/* ── The set being edited: one card per subgroup ────────────────── */}
        {editing && (
          <div className="border-2 border-indigo-300 rounded-xl p-3 bg-indigo-50/40">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <label className="text-xs text-gray-600">ชื่อเซ็ต</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="เช่น เซ็ต A"
                className="border border-gray-300 rounded px-2 py-1 text-sm w-40" />
              <span className="text-[11px] text-gray-500">
                ทุกวิชาในเซ็ตนี้จะถูกจัดลงคาบเดียวกัน
              </span>
              <span className="ml-auto flex gap-2">
                <button onClick={() => setEditing(null)}
                  className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100">
                  ยกเลิก
                </button>
                <button onClick={save} disabled={!canSave}
                  className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-40">
                  {busy ? "กำลังบันทึก…" : "บันทึกเซ็ตนี้"}
                </button>
              </span>
            </div>

            {/* ล็อกวัน/คาบของทั้งเซ็ต — ไม่เลือก = ให้ระบบหาคาบให้เอง */}
            <div className="flex flex-wrap items-center gap-2 mb-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-2">
              <span className="text-xs font-semibold text-gray-600">ล็อกเวลา</span>
              <select value={when.day ?? ""} disabled={busy}
                onChange={(e) => setWhen((w) => ({
                  ...w, day: e.target.value === "" ? null : Number(e.target.value) }))}
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
                <option value="">– วันไหนก็ได้ –</option>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              <select value={when.period ?? ""} disabled={busy}
                onChange={(e) => setWhen((w) => ({
                  ...w, period: e.target.value === "" ? null : Number(e.target.value) }))}
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
                <option value="">– คาบไหนก็ได้ –</option>
                {classPeriods.map((p) => (
                  <option key={p.period_num} value={p.period_num}>
                    {periodLabel(p.period_num, periods)}
                  </option>
                ))}
              </select>
              {(when.day != null) !== (when.period != null) && (
                <span className="text-[11px] text-amber-700">
                  เลือกทั้งวันและคาบจึงจะล็อกได้ · เลือกอย่างเดียวจะยังไม่ล็อก
                </span>
              )}
              <span className="text-[11px] text-gray-500">
                ไม่เลือก = ให้ระบบหาคาบที่ว่างให้เอง · ล็อกแล้วจะไม่ถูกย้าย
                ถ้าคาบนั้นไม่ว่างจะขึ้นในรายการคาบที่ลงไม่ได้
              </span>
            </div>

            <div className="grid gap-2" style={{
              gridTemplateColumns: `repeat(${Math.min(subs.length || 1, 3)}, minmax(0, 1fr))`,
            }}>
              {subs.map((g) => {
                const row = rowFor(g.id);
                return (
                  <div key={g.id} className={clsx("rounded-lg border p-2.5",
                    row ? "bg-white border-indigo-300" : "bg-gray-50 border-dashed border-gray-300")}>
                    <div className="flex items-center gap-1 mb-1.5">
                      <span className="text-sm font-bold text-gray-800">{g.name}</span>
                      {row ? (
                        <button onClick={() => dropRow(g.id)}
                          title="ห้องนี้ไม่เรียนในเซ็ตนี้"
                          className="ml-auto text-xs text-red-400 hover:text-red-600">✕ ไม่เรียน</button>
                      ) : (
                        <span className="ml-auto text-[11px] text-gray-400">ไม่เรียนในเซ็ตนี้</span>
                      )}
                    </div>
                    {row ? (
                      <div className="space-y-1.5">
                        <SearchableSelect
                          value={row.subjectId ? String(row.subjectId) : ""}
                          onChange={(v) => setRowFor(g.id, { subjectId: Number(v) })}
                          options={subjectOptions(subjects)} emptyLabel="– เลือกวิชา –" />
                        <SearchableSelect
                          value={row.teacherId ? String(row.teacherId) : ""}
                          onChange={(v) => setRowFor(g.id, { teacherId: Number(v) })}
                          options={teacherOptions(teachers, departments)}
                          emptyLabel="– ครู (เว้นว่างได้) –" />
                        <label className="flex items-center gap-1.5 text-xs text-gray-600">
                          คาบ/สัปดาห์
                          <input type="number" min={1} max={20} value={row.weekly}
                            onChange={(e) => setRowFor(g.id, { weekly: Number(e.target.value) })}
                            className="border border-gray-300 rounded px-1.5 py-1 text-sm w-16" />
                        </label>
                        {/* ห้องเรียนของห้องย่อยนี้ — เว้นว่าง = จัดห้องตามปกติ */}
                        <SearchableSelect
                          value={row.roomId ? String(row.roomId) : ""}
                          onChange={(v) => setRowFor(g.id, { roomId: Number(v) || 0 })}
                          options={roomOptions(rooms)}
                          emptyLabel="– ห้องเรียน (ไม่ล็อกก็ได้) –" />
                      </div>
                    ) : (
                      <button onClick={() => setRowFor(g.id, {})}
                        className="w-full py-2 text-xs text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50">
                        + ให้ห้องนี้เรียนด้วย
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {problems.length > 0 && (
              <ul className="mt-2 text-xs text-red-700 list-disc list-inside space-y-0.5">
                {problems.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
            {rows.length === 0 && problems.length === 0 && (
              <p className="mt-2 text-xs text-gray-500">
                เลือกอย่างน้อยหนึ่งห้องย่อย — ห้องที่ไม่ได้เลือกจะว่างในคาบนี้
              </p>
            )}
          </div>
        )}

        {/* ── The sets already saved ─────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            เซ็ตที่ตั้งไว้แล้ว ({saved.length})
          </p>
          {saved.length === 0 && (
            <p className="text-xs text-gray-400 py-6 text-center">
              ยังไม่มีเซ็ตของชั้นนี้ — กด “+ สร้างเซ็ตใหม่” ด้านบน
            </p>
          )}
          <div className="space-y-2">
            {saved.map((s) => (
              <div key={s.key} className="border border-gray-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{s.name}</span>
                  <span className="text-[11px] text-gray-500">
                    {s.rows.length} ห้องย่อย · {s.rows[0]?.weekly ?? 1} คาบ/สัปดาห์
                  </span>
                  <span className="ml-auto flex gap-1">
                    <button onClick={() => open(s)}
                      className="px-2 py-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100">
                      ✏️ แก้ไข
                    </button>
                    <button onClick={() => removeSet(s)} disabled={busy}
                      className="px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100">
                      ลบ
                    </button>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {subs.map((g) => {
                    const r = s.rows.find((x) => x.groupId === g.id);
                    return (
                      <span key={g.id} className={clsx("text-[11px] rounded px-1.5 py-0.5 border",
                        r ? "bg-indigo-50 border-indigo-200 text-indigo-900"
                          : "bg-gray-50 border-gray-200 text-gray-400")}>
                        <strong>{g.name}</strong> {r ? subjName(r.subjectId) : "ไม่เรียน"}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {note && <p className="text-xs text-emerald-700">✅ {note}</p>}
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      </>
      )}

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 shrink-0 flex items-center gap-2">
        <p className="text-[11px] text-gray-500 flex-1">
          เซ็ตหนึ่ง = หนึ่งชั่วโมงที่ห้องย่อยเรียนพร้อมกัน · ห้องที่ไม่ได้ใส่ในเซ็ตจะว่างคาบนั้น ·
          ตัวจัดตารางจะวางทุกวิชาในเซ็ตลงคาบเดียวกันให้เอง · ครูเว้นว่างไว้ก่อนได้
          ค่อยไปเลือกทีหลังที่ปุ่ม 🧑‍🏫 จัดห้อง/ครู (คาบที่ยังไม่มีครูจะยังไม่ถูกจัดลงตาราง
          และขึ้นในรายการคาบที่ลงไม่ได้)
        </p>
        <button onClick={onClose}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
