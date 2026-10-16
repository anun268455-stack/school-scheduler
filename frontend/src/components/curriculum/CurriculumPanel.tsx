/**
 * หลักสูตร — แต่ละวิชาเรียนกี่คาบต่อสัปดาห์ แยกตามกลุ่มห้อง
 *
 * ห้องที่ผูกหลักสูตรไว้ จะเพิ่มวิชานอกหลักสูตรลงแผนการสอนไม่ได้ ส่วนห้องที่ยัง
 * ไม่ผูกก็ใช้งานได้ตามปกติ ไม่ถูกตรวจและไม่ถือว่าผิดอะไร — หลายห้องมีแผนเฉพาะตัว
 * จริงๆ
 *
 * ซ้าย: รายการหลักสูตร และจำนวนห้องที่ใช้อยู่ · ขวา: หลักสูตรที่เลือก — แก้ชื่อ
 * แก้วิชา/คาบ แล้วกด "บันทึก" ทีเดียว ส่วนการผูกห้องบันทึกทันทีที่กด
 *
 * ปุ่ม ✨ สร้างหลักสูตรอัตโนมัติ อ่านแผนการสอนที่มีอยู่แล้วเสนอหลักสูตรให้ดูก่อน
 * ยังไม่สร้างอะไรจนกว่าจะกดยืนยัน
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { SearchableSelect, groupOptions, subjectOptions } from "../common/SearchableSelect";
import type { Option } from "../common/SearchableSelect";
import { useTimetableStore } from "../../store/timetableStore";
import { CurriculumDiffModal } from "./CurriculumDiffModal";
import type { Subject } from "../../types";

// ── Page furniture, matched to the other panels in pages/Dashboard.tsx ────────
// (kept local, as LevelActivityPanel does: Dashboard imports this file, so
// importing back from it would be a cycle)
const inputCls = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none";
const btnPrimary = "px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors font-medium disabled:opacity-40 disabled:hover:bg-blue-600";
const btnDanger  = "px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors border border-red-200";
const btnEdit    = "px-2 py-1 text-xs bg-gray-100 border border-gray-300 text-gray-700 rounded hover:bg-gray-200 transition-colors disabled:opacity-40";

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-base font-bold text-gray-800">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
      {children}
    </div>
  );
}

// ── Draft of the curriculum being edited ─────────────────────────────────────
// `weekly` stays text while typing, so clearing the box to type a new number
// does not snap back to 1 under the cursor.
interface DraftRow { subject_id: number; weekly: string }
interface Draft { name: string; rows: DraftRow[] }

const toDraft = (c: api.Curriculum): Draft => ({
  name: c.name,
  rows: c.rows.map((r) => ({ subject_id: r.subject_id, weekly: String(r.weekly_count) })),
});

const validWeekly = (w: string) => /^\d+$/.test(w) && Number(w) >= 1;

const rowsKey = (rows: api.CurriculumRow[]) =>
  JSON.stringify([...rows]
    .sort((a, b) => a.subject_id - b.subject_id)
    .map((r) => [r.subject_id, r.weekly_count]));

const draftRows = (d: Draft): api.CurriculumRow[] =>
  d.rows.map((r) => ({ subject_id: r.subject_id, weekly_count: Number(r.weekly) }));

export const CurriculumPanel: React.FC = () => {
  const { groups, subjects } = useTimetableStore();
  const flat = useMemo(() => groups.flatMap((g) => [g, ...(g.children ?? [])]), [groups]);
  const subjectById = useMemo(
    () => new Map<number, Subject>(subjects.map((s): [number, Subject] => [s.id, s])), [subjects]);

  const [list, setList]     = useState<api.Curriculum[] | null>(null);
  const [selId, setSelId]   = useState<number | null>(null);
  const [draft, setDraft]   = useState<Draft | null>(null);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  const [note, setNote]     = useState<string | null>(null);

  // Making one
  const [newName, setNewName]     = useState("");
  const [fromGroup, setFromGroup] = useState("");
  // Adding a subject to the open curriculum
  const [addSubject, setAddSubject] = useState("");
  const [addWeekly, setAddWeekly]   = useState("1");
  // Adding a class to it
  const [addGroup, setAddGroup] = useState("");
  // Two-step guards: leaving with unsaved edits, and deleting
  const [pendingSel, setPendingSel] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  // ✨ preview — null = not asked for
  const [derived, setDerived] = useState<api.DerivedProposal[] | null>(null);
  // The เทียบ dialog, for one attached class
  const [diffFor, setDiffFor] = useState<{ id: number; name: string } | null>(null);

  const selected = useMemo(
    () => list?.find((c) => c.id === selId) ?? null, [list, selId]);

  /** Open one curriculum, with its saved contents as the draft. */
  const show = useCallback((l: api.Curriculum[], id: number | null) => {
    const c = id == null ? null : l.find((x) => x.id === id) ?? null;
    setList(l);
    setSelId(c ? c.id : null);
    setDraft(c ? toDraft(c) : null);
    setPendingSel(null);
    setConfirmDel(false);
  }, []);

  const load = useCallback(() => {
    setErr(null);
    return api.fetchCurricula()
      .then((l) => show(l, l[0]?.id ?? null))
      .catch((e) => {
        setList([]);
        setErr(api.errorDetail(e, "โหลดหลักสูตรไม่สำเร็จ — ลองใหม่อีกครั้ง"));
      });
  }, [show]);

  useEffect(() => { load(); }, [load]);

  /** Run one server action: spinner on, old messages off, the server's own words on failure. */
  const run = async (fn: () => Promise<void>, failed: string) => {
    setBusy(true); setErr(null); setNote(null);
    try { await fn(); }
    catch (e) { setErr(api.errorDetail(e, failed)); }
    finally { setBusy(false); }
  };

  const nameChanged = !!selected && !!draft && draft.name.trim() !== selected.name;
  const rowsChanged = !!selected && !!draft && rowsKey(draftRows(draft)) !== rowsKey(selected.rows);
  const dirty = nameChanged || rowsChanged;
  // Only judged once the rows are being changed: a row the server already holds
  // at 0 should not stop a rename.
  const rowsBad = rowsChanged && !!draft && draft.rows.some((r) => !validWeekly(r.weekly));
  const canSave = dirty && !rowsBad && !!draft && draft.name.trim() !== "" && !busy;

  const choose = (id: number) => {
    if (id === selId) return;
    if (dirty) { setPendingSel(id); return; }
    if (list) show(list, id);
  };

  // ── Making, copying, deleting ──────────────────────────────────────────────
  const create = () => run(async () => {
    const c = await api.createCurriculum({ name: newName.trim(), rows: [] });
    show(await api.fetchCurricula(), c.id);
    setNewName("");
    setNote(`สร้างหลักสูตร “${c.name}” แล้ว — เพิ่มวิชาและผูกห้องได้เลย`);
  }, "สร้างหลักสูตรไม่สำเร็จ — ลองใหม่อีกครั้ง");

  const createFromGroup = () => run(async () => {
    const c = await api.curriculumFromGroup(Number(fromGroup));
    show(await api.fetchCurricula(), c.id);
    setFromGroup("");
    setNote(`สร้าง “${c.name}” จากแผนการสอนของห้องแล้ว (${c.rows.length} วิชา)`);
  }, "สร้างจากห้องนี้ไม่สำเร็จ — ลองใหม่อีกครั้ง");

  const copy = () => selected && run(async () => {
    const c = await api.copyCurriculum(selected.id);
    show(await api.fetchCurricula(), c.id);
    setNote(`ก๊อปปี้เป็น “${c.name}” แล้ว — ยังไม่ได้ผูกห้องไหน`);
  }, "ก๊อปปี้ไม่สำเร็จ — ลองใหม่อีกครั้ง");

  const remove = () => selected && run(async () => {
    await api.deleteCurriculum(selected.id);
    const l = await api.fetchCurricula();
    show(l, l[0]?.id ?? null);
    setNote(`ลบ “${selected.name}” แล้ว`);
  }, "ลบไม่สำเร็จ — ลองใหม่อีกครั้ง");

  // ── Saving the edits ───────────────────────────────────────────────────────
  const save = () => selected && draft && run(async () => {
    // Only what changed is sent, so saving a rename does not write the rows
    // back over somebody else's edit to them.
    const body: { name?: string; rows?: api.CurriculumRow[] } = {};
    if (nameChanged) body.name = draft.name.trim();
    if (rowsChanged) body.rows = draftRows(draft);
    const saved = await api.updateCurriculum(selected.id, body);
    show(await api.fetchCurricula(), saved.id);
    setNote(`บันทึก “${saved.name}” แล้ว`);
  }, "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");

  const discard = () => { if (selected) setDraft(toDraft(selected)); };

  const addRow = () => {
    if (!draft || !addSubject || !validWeekly(addWeekly)) return;
    const sid = Number(addSubject);
    if (draft.rows.some((r) => r.subject_id === sid)) return;
    setDraft({ ...draft, rows: [...draft.rows, { subject_id: sid, weekly: addWeekly }] });
    setAddSubject("");
  };
  const setWeekly = (sid: number, v: string) => {
    if (!draft) return;
    const digits = v.replace(/\D/g, "").slice(0, 2);
    setDraft({
      ...draft,
      rows: draft.rows.map((r) => (r.subject_id === sid ? { ...r, weekly: digits } : r)),
    });
  };
  const dropRow = (sid: number) => {
    if (!draft) return;
    setDraft({ ...draft, rows: draft.rows.filter((r) => r.subject_id !== sid) });
  };

  // ── Attaching classes (saved on the spot) ──────────────────────────────────
  const owner = useMemo(() => {
    const m = new Map<number, api.Curriculum>();
    for (const c of list ?? []) for (const g of c.groups) m.set(g, c);
    return m;
  }, [list]);

  const groupName = (gid: number) => flat.find((g) => g.id === gid)?.name ?? `#${gid}`;

  const attachOptions: Option[] = useMemo(() => {
    const mine = new Set(selected?.groups ?? []);
    return flat.filter((g) => !mine.has(g.id)).map((g) => {
      const o = owner.get(g.id);
      return {
        value: String(g.id), label: g.name, group: g.level ?? undefined,
        hint: o ? `ใช้ “${o.name}” อยู่` : (g.parent_id ? "ห้องย่อย" : undefined),
      };
    });
  }, [flat, owner, selected]);

  const setClasses = (ids: number[], said: string) => selected && run(async () => {
    await api.setCurriculumGroups(selected.id, ids);
    // The list only: unsaved edits to the rows are none of this call's business.
    setList(await api.fetchCurricula());
    setNote(said);
  }, "ผูกห้องไม่สำเร็จ — ลองใหม่อีกครั้ง");

  const attach = () => {
    if (!selected || !addGroup) return;
    const gid = Number(addGroup);
    const was = owner.get(gid);
    setAddGroup("");
    return setClasses([...selected.groups, gid],
      `ผูก ${groupName(gid)} กับหลักสูตรนี้แล้ว${was ? ` (เดิมใช้ “${was.name}”)` : ""}`);
  };
  const detach = (gid: number) => {
    if (!selected) return;
    return setClasses(selected.groups.filter((g) => g !== gid),
      `เอา ${groupName(gid)} ออกจากหลักสูตรนี้แล้ว — ห้องนี้จะไม่ถูกตรวจอีก`);
  };

  // ── ✨ สร้างอัตโนมัติ ───────────────────────────────────────────────────────
  const preview = () => run(async () => {
    setDerived((await api.fetchDerivedCurricula()).proposals);
  }, "อ่านข้อมูลเดิมไม่สำเร็จ — ลองใหม่อีกครั้ง");

  const confirmDerive = () => run(async () => {
    const n = derived?.length ?? 0;
    await api.applyDerivedCurricula();
    const l = await api.fetchCurricula();
    // Keep whatever is open (and its unsaved edits) when there is something open.
    if (selId != null && l.some((c) => c.id === selId)) setList(l);
    else show(l, l[0]?.id ?? null);
    setDerived(null);
    setNote(`สร้างหลักสูตรแล้ว ${n} หลักสูตร และผูกห้องให้เรียบร้อย`);
  }, "สร้างอัตโนมัติไม่สำเร็จ — ลองใหม่อีกครั้ง");

  const namesOf = (ids: number[]) => {
    const names = ids.map(groupName);
    return names.length > 8 ? `${names.slice(0, 8).join(", ")} …อีก ${names.length - 8} ห้อง` : names.join(", ");
  };

  // ── Draft, as shown ────────────────────────────────────────────────────────
  const shownRows = useMemo(() => {
    const codeOf = (sid: number) => subjectById.get(sid)?.code ?? "";
    return [...(draft?.rows ?? [])].sort((a, b) =>
      codeOf(a.subject_id).localeCompare(codeOf(b.subject_id), undefined, { numeric: true })
      || a.subject_id - b.subject_id);
  }, [draft, subjectById]);
  const inDraft = useMemo(() => new Set((draft?.rows ?? []).map((r) => r.subject_id)), [draft]);
  const addableSubjects = useMemo(
    () => subjectOptions(subjects.filter((s) => !inDraft.has(s.id))), [subjects, inDraft]);
  const total = (draft?.rows ?? []).reduce((n, r) => n + (validWeekly(r.weekly) ? Number(r.weekly) : 0), 0);

  return (
    <Section
      title="หลักสูตร — แต่ละวิชาเรียนกี่คาบต่อสัปดาห์"
      action={
        <button onClick={preview} disabled={busy}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors font-medium disabled:opacity-40">
          ✨ สร้างหลักสูตรอัตโนมัติจากข้อมูลเดิม
        </button>
      }
    >
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800 leading-relaxed">
        <strong>หลักสูตร</strong> บอกว่าห้องหนึ่งเรียนวิชาอะไรบ้าง วิชาละกี่คาบต่อสัปดาห์ —
        ห้องที่ผูกหลักสูตรแล้วจะเพิ่มวิชานอกหลักสูตรลงแผนการสอนไม่ได้ และเทียบกับแผนการสอนที่มีอยู่ได้
        (ปุ่ม <strong>เทียบ</strong> ข้างชื่อห้อง)
        <br />ห้องที่<strong>ยังไม่ผูกหลักสูตร</strong>ใช้งานได้ตามปกติ ไม่ถูกตรวจ และไม่ถือว่าผิดอะไร
      </div>

      {err && (
        <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2">
          <span className="flex-1">{err}</span>
          {list && list.length === 0 && (
            <button onClick={load} className="text-xs font-semibold underline shrink-0">ลองใหม่</button>
          )}
        </div>
      )}
      {note && (
        <div className="mb-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          {note}
        </div>
      )}

      {/* ✨ ข้อเสนอ — พรีวิวเท่านั้น */}
      {derived && (
        <div className="mb-4 border border-indigo-200 bg-indigo-50/60 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-indigo-900 flex-1">
              ✨ หลักสูตรที่ระบบเสนอ{derived.length > 0 ? ` (${derived.length})` : ""}
            </h3>
            <button onClick={() => setDerived(null)} className="text-xs text-gray-500 hover:text-gray-800">ปิด</button>
          </div>
          {derived.length === 0 ? (
            <p className="text-sm text-gray-600 py-2">
              ไม่มีห้องที่ต้องสร้างหลักสูตรให้ — ทุกห้องมีหลักสูตรแล้ว
              <span className="block text-xs text-gray-500 mt-0.5">
                ระบบเสนอเฉพาะห้องที่ยังไม่มีหลักสูตร ห้องที่ผูกไว้แล้วจะไม่ถูกแตะ
              </span>
            </p>
          ) : (
            <>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                อ่านจากแผนการสอนที่มีอยู่ — ยังไม่ได้สร้างอะไร ดูแล้วกดยืนยันถึงจะสร้างและผูกห้องให้
              </p>
              <ul className="space-y-1.5 max-h-72 overflow-auto">
                {derived.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="bg-white border border-indigo-100 rounded px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800">{p.name}</span>
                      {p.variants > 1 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-medium"
                          title="กลุ่มนี้มีแผนการสอนหลายแบบ แยกเป็นหลักสูตรละแบบ">
                          หนึ่งใน {p.variants} แบบ
                        </span>
                      )}
                      <span className="ml-auto text-xs text-gray-500 shrink-0">
                        {p.group_ids.length} ห้อง · {p.rows.length} วิชา
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{namesOf(p.group_ids)}</div>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDerived(null)} className="px-3 py-1.5 rounded border text-sm bg-white">ยกเลิก</button>
                <button onClick={confirmDerive} disabled={busy}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 font-medium disabled:opacity-40">
                  {busy ? "กำลังสร้าง…" : `สร้าง ${derived.length} หลักสูตร และผูกห้อง`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-[17rem_1fr] gap-4 items-start">
        {/* ── ซ้าย: รายการ ── */}
        <div className="space-y-3">
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-600">
              หลักสูตรทั้งหมด{list ? ` (${list.length})` : ""}
            </div>
            <ul className="max-h-[28rem] overflow-auto divide-y divide-gray-100">
              {list === null && <li className="px-3 py-4 text-xs text-gray-400">กำลังโหลด…</li>}
              {list?.length === 0 && !err && (
                <li className="px-3 py-4 text-xs text-gray-400 leading-relaxed">
                  ยังไม่มีหลักสูตร — กด ✨ ด้านบนให้ระบบเสนอจากข้อมูลเดิม หรือสร้างเองด้านล่าง
                </li>
              )}
              {list?.map((c) => {
                // ชื่อห้องขึ้นเป็นกรอบเล็กๆ ให้เห็นตั้งแต่ในรายการ ไม่ต้องกดเข้าไปดูทีละอัน
                // ตัดที่ 8 ห้องแล้วบอกจำนวนที่เหลือ เพื่อไม่ให้รายการยาวจนเลื่อนหาอันอื่นไม่เจอ
                const shown = c.groups.slice(0, 8);
                const more = c.groups.length - shown.length;
                return (
                  <li key={c.id}>
                    <button onClick={() => choose(c.id)}
                      className={clsx("w-full text-left px-3 py-2 transition-colors",
                        c.id === selId ? "bg-blue-50" : "hover:bg-gray-50")}>
                      <div className={clsx("text-sm font-medium truncate",
                        c.id === selId ? "text-blue-800" : "text-gray-800")}>{c.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {c.groups.length > 0
                          ? <span className="text-emerald-700">{c.groups.length} ห้อง</span>
                          : <span className="text-gray-400">ยังไม่ผูกห้อง</span>}
                        {" · "}{c.rows.length} วิชา
                      </div>
                      {shown.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {shown.map((gid, i) => (
                            <span key={gid}
                              className="px-1.5 py-px rounded border border-emerald-200 bg-emerald-50 text-[10px] leading-4 text-emerald-900">
                              {c.group_names[i] ?? groupName(gid)}
                            </span>
                          ))}
                          {more > 0 && (
                            <span className="px-1.5 py-px text-[10px] leading-4 text-gray-500">+{more}</span>
                          )}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <Field label="สร้างหลักสูตรใหม่">
              <div className="flex gap-1.5">
                <input className={inputCls} value={newName} placeholder="ชื่อหลักสูตร"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newName.trim() && !busy) create(); }} />
                <button onClick={create} disabled={busy || !newName.trim()}
                  className={clsx(btnPrimary, "shrink-0")}>สร้าง</button>
              </div>
            </Field>
            <Field label="หรือสร้างจากแผนการสอนของห้อง">
              <SearchableSelect value={fromGroup} onChange={setFromGroup}
                options={groupOptions(flat)} placeholder="เลือกห้อง" />
            </Field>
            <button onClick={createFromGroup} disabled={busy || !fromGroup}
              className={clsx(btnEdit, "w-full py-1.5")}>
              📥 สร้างจากห้องนี้
            </button>
          </div>
        </div>

        {/* ── ขวา: หลักสูตรที่เลือก ── */}
        <div className="min-w-0">
          {!selected || !draft ? (
            <div className="border border-dashed border-gray-300 rounded-lg px-4 py-10 text-center text-sm text-gray-400">
              {list === null ? "กำลังโหลด…" : "เลือกหลักสูตรทางซ้าย เพื่อดูและแก้วิชา"}
            </div>
          ) : (
            <div className="space-y-4">
              {pendingSel != null && (
                <div className="flex items-center gap-2 flex-wrap text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded px-3 py-2">
                  <span className="flex-1">
                    ยังไม่ได้บันทึกการแก้ไข — ทิ้งแล้วไปที่ “{list?.find((c) => c.id === pendingSel)?.name}” ไหม
                  </span>
                  <button onClick={() => list && show(list, pendingSel)}
                    className="px-2 py-1 rounded bg-amber-600 text-white font-semibold">ทิ้งและไปต่อ</button>
                  <button onClick={() => setPendingSel(null)}
                    className="px-2 py-1 rounded border border-amber-400 bg-white">อยู่ต่อ</button>
                </div>
              )}

              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[12rem]">
                  <Field label="ชื่อหลักสูตร">
                    <input className={inputCls} value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </Field>
                </div>
                <button onClick={copy} disabled={busy || dirty}
                  title={dirty ? "บันทึกการแก้ไขก่อน — ก๊อปปี้จะได้ตามที่บันทึกไว้" : "ทำสำเนาหลักสูตรนี้ (ไม่ผูกห้อง)"}
                  className={clsx(btnEdit, "py-1.5")}>
                  📋 ก๊อปปี้
                </button>
                {confirmDel ? (
                  <>
                    <button onClick={remove} disabled={busy}
                      className="px-2 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 font-semibold disabled:opacity-40">
                      ยืนยันลบ
                    </button>
                    <button onClick={() => setConfirmDel(false)}
                      className="px-2 py-1.5 text-xs bg-gray-200 rounded hover:bg-gray-300">ไม่ลบ</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDel(true)} disabled={busy}
                    className={clsx(btnDanger, "py-1.5")}>ลบหลักสูตร</button>
                )}
              </div>

              {/* ห้องที่ใช้หลักสูตรนี้ — ไว้บนสุด เพราะเป็นสิ่งแรกที่ต้องรู้ว่าหลักสูตรนี้ใช้กับห้องไหน */}
              <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg px-3 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-sm font-bold text-gray-700">
                    ห้องที่ใช้หลักสูตรนี้ ({selected.groups.length})
                  </h3>
                  <span className="text-[11px] text-gray-400">ผูก/เอาออกแล้วบันทึกทันที</span>
                </div>
                {selected.groups.length === 0 ? (
                  <p className="text-xs text-gray-500 mb-2">
                    ยังไม่ผูกห้องไหน — หลักสูตรนี้จึงยังไม่ถูกใช้ตรวจห้องใดเลย
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5 mb-2">
                    {selected.groups.map((gid, i) => (
                      <li key={gid}
                        className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border border-emerald-300 bg-white text-xs text-emerald-900">
                        <span className="font-medium">{selected.group_names[i] ?? groupName(gid)}</span>
                        <button
                          onClick={() => setDiffFor({ id: gid, name: selected.group_names[i] ?? groupName(gid) })}
                          title="เทียบแผนการสอนของห้องนี้กับหลักสูตร"
                          className="px-1.5 py-0.5 rounded-full bg-white border border-emerald-300 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50">
                          เทียบ
                        </button>
                        <button onClick={() => detach(gid)} disabled={busy} title="เอาห้องนี้ออกจากหลักสูตร"
                          className="text-emerald-700/60 hover:text-rose-600 leading-none disabled:opacity-40">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <Field label="ผูกห้องเพิ่ม">
                    <SearchableSelect value={addGroup} onChange={setAddGroup}
                      options={attachOptions} placeholder="เลือกห้อง" />
                  </Field>
                  <button onClick={attach} disabled={busy || !addGroup} className={btnPrimary}>+ ผูกห้อง</button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                  ห้องหนึ่งใช้ได้หลักสูตรเดียว — เลือกห้องที่ใช้หลักสูตรอื่นอยู่ จะย้ายมาที่นี่
                </p>
              </div>

              {/* วิชาและคาบ */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-sm font-bold text-gray-700">วิชาในหลักสูตร</h3>
                  <span className="text-xs text-gray-500">
                    {draft.rows.length} วิชา · รวม <strong>{total}</strong> คาบ/สัปดาห์
                  </span>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">วิชา</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 border-b w-28">คาบ/สัปดาห์</th>
                        <th className="px-3 py-2 border-b w-16" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {shownRows.length === 0 && (
                        <tr><td colSpan={3} className="px-3 py-5 text-center text-gray-400 text-xs">
                          ยังไม่มีวิชาในหลักสูตรนี้ — เพิ่มจากช่องด้านล่าง
                        </td></tr>
                      )}
                      {shownRows.map((r) => {
                        const s = subjectById.get(r.subject_id);
                        return (
                          <tr key={r.subject_id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5">
                              {s ? (
                                <>
                                  <span className="font-medium text-blue-700">{s.code}</span>
                                  <span className="ml-2 text-xs text-gray-600">{s.name}</span>
                                </>
                              ) : (
                                <span className="text-xs text-rose-700">วิชา #{r.subject_id} (ไม่พบในระบบ)</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <input inputMode="numeric" value={r.weekly}
                                onChange={(e) => setWeekly(r.subject_id, e.target.value)}
                                className={clsx("w-14 border rounded px-1 py-0.5 text-center text-sm",
                                  validWeekly(r.weekly) ? "border-gray-300" : "border-rose-400 bg-rose-50")} />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <button onClick={() => dropRow(r.subject_id)} className={btnDanger}>เอาออก</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-[1fr_6rem_auto] gap-2 items-end mt-2">
                  <Field label="เพิ่มวิชา">
                    <SearchableSelect value={addSubject} onChange={setAddSubject}
                      options={addableSubjects} placeholder="เลือกวิชา" />
                  </Field>
                  <Field label="คาบ/สัปดาห์">
                    <input inputMode="numeric" className={inputCls} value={addWeekly}
                      onChange={(e) => setAddWeekly(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                  </Field>
                  <button onClick={addRow} disabled={!addSubject || !validWeekly(addWeekly)}
                    className={btnPrimary}>+ เพิ่ม</button>
                </div>
              </div>

              {/* บันทึก */}
              <div className={clsx("flex items-center gap-2 rounded-lg px-3 py-2 border",
                dirty ? "bg-amber-50 border-amber-300" : "bg-gray-50 border-gray-200")}>
                <span className={clsx("text-xs flex-1", dirty ? "text-amber-900" : "text-gray-500")}>
                  {rowsBad ? "มีช่องคาบที่ว่างหรือเป็น 0 — ต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป"
                    : dirty ? "มีการแก้ไขที่ยังไม่ได้บันทึก"
                    : "ตรงกับที่บันทึกไว้"}
                </span>
                {dirty && (
                  <button onClick={discard} disabled={busy}
                    className="px-3 py-1.5 rounded border text-sm bg-white disabled:opacity-40">ยกเลิกการแก้ไข</button>
                )}
                <button onClick={save} disabled={!canSave} className={btnPrimary}>
                  {busy ? "กำลังบันทึก…" : "บันทึก"}
                </button>
              </div>

            </div>
          )}
        </div>
      </div>

      {diffFor && (
        <CurriculumDiffModal
          groupId={diffFor.id} groupName={diffFor.name}
          onClose={() => setDiffFor(null)} />
      )}
    </Section>
  );
};
