/**
 * LevelActivityPanel — pin one activity onto a set of classrooms at once.
 *
 * ลูกเสือ, เนตรนารี, ชุมนุม, สาธารณประโยชน์: the whole school stops at the same
 * time and does the same thing. The panel used to ask for a ระดับชั้น and work
 * level by level, which is three passes for ลูกเสือ (ม.1, ม.2, ม.3) and six for
 * ชุมนุม — and ชุมนุม does not belong to a level at all. So the activity is now
 * named by its subject and pinned onto whichever classrooms the school ticks,
 * and the subject itself can be created right here rather than on another page.
 *
 * The created periods are locked, so the auto-scheduler never books over them.
 */
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { SearchableSelect } from "../common/SearchableSelect";
import { ActivitySupervisorModal } from "./ActivitySupervisorModal";
import { homeroomIds } from "../../utils/homeroom";
import { nameOf } from "../../utils/activityRoster";
import { useTimetableStore } from "../../store/timetableStore";
import { DAYS, periodLabel, periodTime } from "../../types";

export const LevelActivityPanel: React.FC = () => {
  const {
    groups, subjects, teachers, slots, periods, departments, requirements, loadSlots,
  } = useTimetableStore();

  const [form, setForm] = useState({
    day: "0", period: "", subject_id: "",
    // "homeroom" | "none" | a teacher id as a string
    teacher_choice: "homeroom",
    room_mode: "homeroom" as "homeroom" | "none",
  });
  const [picked, setPicked]   = useState<number[]>([]);
  // The ครูผู้ดูแล of the activity as a whole — not one list per classroom.
  const [roster, setRoster]   = useState<number[]>([]);
  const [showRoster, setShowRoster] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState<{ created: number; skipped: { group: string; reason: string }[]; warnings: string[]; edited?: boolean } | null>(null);
  const [error, setError]     = useState<string | null>(null);
  // The activity_key being edited, or null when making a new one.
  const [editing, setEditing] = useState<string | null>(null);
  const topRef = React.useRef(null as HTMLDivElement | null);

  // Top-level classrooms, which is what a whole-school activity is normally
  // pinned onto.
  const parents = useMemo(
    () => groups.filter((g) => !g.parent_id)
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true })),
    [groups],
  );
  const flat = useMemo(
    () => groups.flatMap((g) => [g, ...(g.children ?? [])]), [groups],
  );
  // …and the subgroups too. They used to be hidden here, on the reasoning that
  // ม.4/6ก sits inside ม.4/6's hour so ticking both would double-book the
  // students. That is still true — but hiding them also meant a school whose
  // ชุมนุม is organised by ก/ข/ค simply could not say so, and ม.4/6ก looked
  // like a class that had been lost. So they are listed, and a subgroup whose
  // parent is already ticked is shown as covered rather than offered twice.
  const classes = useMemo(() => {
    const out: typeof parents = [];
    for (const g of parents) {
      out.push(g);
      for (const c of [...(g.children ?? [])].sort(
        (a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true }))) {
        out.push(c);
      }
    }
    return out;
  }, [parents]);
  const parentOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const g of parents) for (const c of g.children ?? []) m.set(c.id, g.id);
    return m;
  }, [parents]);
  const childrenOf = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const g of parents) m.set(g.id, (g.children ?? []).map((c) => c.id));
    return m;
  }, [parents]);
  const levels = useMemo(() => {
    const seen: string[] = [];
    for (const g of parents) if (g.level && !seen.includes(g.level)) seen.push(g.level);
    return seen;
  }, [parents]);

  const classPeriods = useMemo(
    () => [...new Map(periods.filter((p) => p.type === "class").map((p) => [p.period_num, p])).values()]
      .sort((a, b) => a.period_num - b.period_num),
    [periods],
  );

  // กิจกรรม first in the list — this screen is only ever used for those, and
  // hunting for ลูกเสือ among 300 academic subjects is the slow way to find it.
  const activitySubjects = useMemo(
    () => subjects.filter((s) => s.is_activity), [subjects],
  );
  const otherSubjects = useMemo(
    () => subjects.filter((s) => !s.is_activity), [subjects],
  );

  const chosen = useMemo(
    () => picked.map((id) => classes.find((g) => g.id === id)).filter((g): g is NonNullable<typeof g> => !!g),
    [picked, classes],
  );
  const subjectName = useMemo(() => {
    const s = subjects.find((x) => String(x.id) === form.subject_id);
    return s ? `${s.code} – ${s.name}` : "กิจกรรม";
  }, [subjects, form.subject_id]);

  const rosterCount = roster.length;

  // Existing activity blocks, grouped by activity_key.
  //
  // Enough of each one is kept to put it back into the form, not just to list
  // it: an activity that cannot be edited has to be deleted and re-entered,
  // and for ชุมนุม that is sixty classrooms and a roster of a hundred typed
  // again because the period was wrong.
  interface Existing {
    key: string; level: string; day: number; period: number; subject: string;
    classes: string[]; teachers: Set<string>;
    subjectId: number | null; groupIds: number[]; roster: number[];
    teacherIds: (number | null)[]; hasRoom: boolean;
    /** คาบว่างที่จองไว้ให้ว่างตรงกัน ไม่ใช่กิจกรรมที่มีวิชา */
    free: boolean;
  }
  const existing = useMemo(() => {
    const m = new Map<string, Existing>();
    for (const s of slots) {
      if (!s.is_activity_block || !s.activity_key) continue;
      const cur = m.get(s.activity_key) ?? {
        key: s.activity_key,
        level: s.activity_level ?? "",
        day: s.day, period: s.period,
        subject: s.subject_code ?? s.subject_name ?? "",
        classes: [] as string[], teachers: new Set<string>(),
        subjectId: s.subject_id ?? null, groupIds: [] as number[],
        roster: [] as number[], teacherIds: [] as (number | null)[], hasRoom: false,
        free: !!s.is_free_period,
      };
      cur.classes.push(s.group_name ?? "");
      cur.groupIds.push(s.group_id);
      cur.teacherIds.push(s.teacher_id ?? null);
      if (s.room_id) cur.hasRoom = true;
      // The roster is the same list on every classroom of the activity.
      for (const t of s.activity_teacher_ids ?? []) if (!cur.roster.includes(t)) cur.roster.push(t);
      for (const n of [s.teacher_name, ...(s.activity_teacher_names ?? [])]) if (n) cur.teachers.add(n);
      m.set(s.activity_key, cur);
    }
    return [...m.values()].sort((a, b) => a.day - b.day || a.period - b.period || a.level.localeCompare(b.level));
  }, [slots]);

  const missingHomeroom = useMemo(
    () => chosen.filter((g) => homeroomIds(g).length === 0),
    [chosen],
  );

  /**
   * Tick a classroom, keeping a parent and its subgroups from both being in.
   *
   * They hold the same students, so an activity on both is that class sitting
   * in two places at once — the API would refuse the second one anyway, but
   * silently, as "มีคาบอยู่แล้ว". Here it is simply impossible: ticking the
   * parent takes its children out, and ticking a child takes the parent out.
   */
  const toggle = (id: number) =>
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      const kin = new Set<number>([...(childrenOf.get(id) ?? [])]);
      const par = parentOf.get(id);
      if (par != null) kin.add(par);
      return [...p.filter((x) => !kin.has(x)), id];
    });
  const pickLevel = (lv: string) => {
    // A level shortcut means the whole classes, never the subgroups.
    const ids = parents.filter((g) => g.level === lv).map((g) => g.id);
    const all = ids.every((i) => picked.includes(i));
    setPicked((p) => {
      const kids = new Set(ids.flatMap((i) => childrenOf.get(i) ?? []));
      return all ? p.filter((i) => !ids.includes(i))
                 : [...new Set([...p.filter((i) => !kids.has(i)), ...ids])];
    });
  };

  /** Create ลูกเสือ / เนตรนารี / ชุมนุม without leaving this screen. */
  const createSubject = async () => {
    const name = (newName ?? "").trim();
    if (!name) return;
    setBusy(true); setError(null);
    try {
      const made = await api.createSubject({
        name,
        code: `ACT${String(Date.now()).slice(-4)}`,
        type: "common", duration: 1, is_activity: true, department_id: null,
      });
      useTimetableStore.setState((st) => ({ subjects: [...st.subjects, made] }));
      setForm((f) => ({ ...f, subject_id: String(made.id) }));
      setNewName(null);
    } catch {
      setError("สร้างกิจกรรมใหม่ไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const canCreate = picked.length > 0 && form.period !== "" && !!form.subject_id && !busy;

  /** Put an activity that is already on the board back into the form. */
  const startEdit = (a: Existing) => {
    const single = a.roster.length === 0 && a.teacherIds.length > 0
      && a.teacherIds.every((t) => t != null && t === a.teacherIds[0]);
    setEditing(a.key);
    setForm({
      day: String(a.day),
      period: String(a.period),
      subject_id: a.free ? "FREE" : a.subjectId != null ? String(a.subjectId) : "",
      teacher_choice: a.roster.length > 0 ? "homeroom"
        : single ? String(a.teacherIds[0])
        : a.teacherIds.some((t) => t != null) ? "homeroom" : "none",
      room_mode: a.hasRoom ? "homeroom" : "none",
    });
    setPicked(a.groupIds);
    setRoster(a.roster);
    setResult(null); setError(null);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cancelEdit = () => {
    setEditing(null);
    setPicked([]); setRoster([]);
    setForm({ day: "0", period: "", subject_id: "", teacher_choice: "homeroom", room_mode: "homeroom" });
    setResult(null); setError(null);
  };

  const handleCreate = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const choice = form.teacher_choice;
      // คาบว่างไม่มีวิชา ไม่มีครู และไม่จองห้อง — ส่งแค่ว่าเป็นคาบว่าง แล้วให้
      // เซิร์ฟเวอร์จัดการที่เหลือ ถ้าส่งครูหรือห้องไปด้วยมันจะไม่ว่างจริง
      const isFree = form.subject_id === "FREE";
      const base = {
        group_ids: picked,
        label: [...new Set(chosen.map((g) => g.level).filter(Boolean))].join("/") || "ห้องที่เลือก",
        day: Number(form.day),
        period: Number(form.period),
      };
      const payload = isFree
        ? { ...base, free_period: true, teacher_ids: [], room_mode: "none" as const }
        : {
          ...base,
          subject_id: Number(form.subject_id),
          free_period: false,
          teacher_mode: (choice === "homeroom" ? "homeroom" : choice === "none" ? "none" : "single") as
            "homeroom" | "single" | "none",
          teacher_id: choice !== "homeroom" && choice !== "none" ? Number(choice) : null,
          teacher_ids: roster,
          room_mode: form.room_mode,
        };
      // Editing replaces the activity in one call. If nothing can be placed at
      // the new time the server keeps the old one and says so, so a failed
      // edit never costs the school the activity it already had.
      const res = editing
        ? await api.updateLevelActivity(editing, payload)
        : await api.createLevelActivity(payload);
      await loadSlots();
      setResult({ created: res.created.length, skipped: res.skipped, warnings: res.warnings ?? [],
                  edited: !!editing });
      setEditing(null);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || (editing ? "แก้ไขคาบกิจกรรมไม่สำเร็จ" : "สร้างคาบกิจกรรมไม่สำเร็จ กรุณาลองใหม่"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (key: string) => {
    setBusy(true);
    try {
      await api.deleteLevelActivity(key);
      await loadSlots();
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const editingOf = editing ? existing.find((a) => a.key === editing) : null;

  return (
    <div className="mb-6" ref={topRef}>
      <h2 className="text-base font-bold text-gray-800 mb-3">คาบกิจกรรม (ลูกเสือ · เนตรนารี · ชุมนุม)</h2>

      {editing && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mb-3 text-xs text-amber-900">
          <span className="text-base">✏️</span>
          <span className="flex-1">
            กำลังแก้ไข <strong>{editingOf?.subject ?? "กิจกรรม"}</strong>
            {editingOf && ` · ${DAYS[editingOf.day]} ${periodLabel(editingOf.period, periods)} · ${editingOf.classes.length} ห้อง`}
            {" — "}แก้แล้วกด “บันทึกการแก้ไข” ด้านล่าง คาบเดิมจะถูกแทนที่ให้
          </span>
          <button onClick={cancelEdit}
            className="shrink-0 px-2 py-1 border border-amber-400 text-amber-800 rounded hover:bg-white">
            ยกเลิกการแก้ไข
          </button>
        </div>
      )}

      <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 mb-4 text-xs text-teal-900 leading-relaxed">
        <strong>ใช้ทำอะไร:</strong> ตั้งคาบที่หลายห้องทำพร้อมกัน เช่น
        <em> ลูกเสือ/เนตรนารี ของ ม.1–ม.3 คาบ 7 วันพฤหัสบดี</em> หรือ <em>ชุมนุมทั้งโรงเรียน</em>
        <br/><strong>เลือกกิจกรรม → วัน/คาบ → ติ๊กห้อง → จัดครูผู้ดูแล</strong>
        — ถ้ายังไม่มีกิจกรรมในรายการ สร้างใหม่ได้ตรงนี้เลย
        <br/>ระบบจะ<strong>ล็อกคาบไว้</strong> ตัวจัดตารางอัตโนมัติจะไม่วางวิชาอื่นทับ
        และครูผู้ดูแลจะเห็นคาบนี้ในตารางสอนของตัวเอง นับรวมในอัตรากำลังด้วย
        <br/>ห้องย่อย (ก/ข/ค) ติ๊กแยกได้ถ้าต้องการ — แต่ถ้าติ๊กห้องแม่แล้ว ห้องย่อยถือว่ารวมอยู่ด้วย
        จึงติ๊กซ้ำไม่ได้ (นักเรียนกลุ่มเดียวกัน)
      </div>

      {/* ── กิจกรรม / วัน / คาบ ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="กิจกรรม *">
          {newName === null ? (
            <div className="flex gap-1">
              <select className={inputCls} value={form.subject_id}
                onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                <option value="">เลือกกิจกรรม</option>
                {/* คาบว่างที่จองไว้ให้ว่างตรงกันทั้งกลุ่ม — "อยากให้ ม.3/5 - 3/14
                    มีคาบว่างที่ตรงกัน จะได้จัดกิจกรรมต่างๆ ได้" */}
                <option value="FREE">⬜ คาบว่าง — จองไว้ให้ว่างตรงกัน</option>
                {activitySubjects.length > 0 && (
                  <optgroup label="กิจกรรม">
                    {activitySubjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
                  </optgroup>
                )}
                <optgroup label="รายวิชาอื่น">
                  {otherSubjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
                </optgroup>
              </select>
              <button onClick={() => setNewName("")} title="สร้างกิจกรรมใหม่"
                className="shrink-0 px-2 border border-teal-300 text-teal-700 rounded text-sm hover:bg-teal-50">
                ＋
              </button>
            </div>
          ) : (
            <div className="flex gap-1">
              <input autoFocus className={inputCls} value={newName}
                placeholder="เช่น ลูกเสือ, เนตรนารี, ชุมนุม"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createSubject(); }} />
              <button onClick={createSubject} disabled={!newName.trim() || busy}
                className="shrink-0 px-2 bg-teal-600 text-white rounded text-sm disabled:opacity-40">
                สร้าง
              </button>
              <button onClick={() => setNewName(null)}
                className="shrink-0 px-2 border border-gray-300 rounded text-sm hover:bg-gray-100">✕</button>
            </div>
          )}
        </Field>
        <Field label="วัน *">
          <select className={inputCls} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="คาบ *">
          <select className={inputCls} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
            <option value="">เลือกคาบ</option>
            {classPeriods.map((p) => (
              <option key={p.period_num} value={p.period_num}>{p.label} ({p.start_time}–{p.end_time})</option>
            ))}
          </select>
        </Field>
      </div>

      {/* ── ห้องที่เข้าร่วม ──────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <p className="text-xs font-semibold text-gray-700">
            ห้องที่เข้าร่วม <span className="text-teal-700">({picked.length} ห้อง)</span>
          </p>
          <div className="flex flex-wrap gap-1">
            {levels.map((lv) => (
              <button key={lv} onClick={() => pickLevel(lv)}
                className="px-2 py-0.5 text-xs rounded border border-teal-300 text-teal-700 hover:bg-teal-50">
                {lv}
              </button>
            ))}
            <button onClick={() => setPicked(parents.map((g) => g.id))}
              className="px-2 py-0.5 text-xs rounded border border-teal-400 bg-teal-50 text-teal-800 font-medium">
              ทั้งหมด
            </button>
            <button onClick={() => setPicked([])}
              className="px-2 py-0.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-100">
              ล้าง
            </button>
          </div>
        </div>
        <div className="max-h-44 overflow-y-auto grid grid-cols-6 gap-x-2 gap-y-1">
          {classes.map((g) => {
            const par = parentOf.get(g.id);
            const covered = par != null && picked.includes(par);
            const parName = par != null ? parents.find((x) => x.id === par)?.name : undefined;
            return (
              <label key={g.id}
                title={covered ? `รวมอยู่ใน ${parName} แล้ว` : undefined}
                className={clsx("flex items-center gap-1 text-xs cursor-pointer",
                  covered ? "text-gray-300 cursor-default"
                    : par != null ? "text-gray-500 pl-3" : "text-gray-700")}>
                <input type="checkbox" checked={picked.includes(g.id) || covered}
                  disabled={covered} onChange={() => toggle(g.id)} />
                <span className="truncate">{g.name}</span>
              </label>
            );
          })}
          {classes.length === 0 && <p className="text-xs text-gray-400 col-span-6">ยังไม่มีห้องเรียน</p>}
        </div>
      </div>

      {/* ── ครูผู้ดูแล + ห้องที่ใช้ ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Field label="ครูผู้ดูแล">
          {rosterCount > 0 ? (
            <div className="flex items-center gap-2 border border-teal-300 bg-teal-50 rounded px-2 py-1.5">
              <span className="flex-1 text-sm text-teal-900 truncate"
                title={roster.map((t) => nameOf(teachers, t)).join(", ")}>
                👥 ครูผู้ดูแล {rosterCount} คน
              </span>
              <button onClick={() => setShowRoster(true)}
                className="px-2 py-0.5 text-xs border border-teal-400 text-teal-800 rounded hover:bg-white">แก้ไข</button>
              <button onClick={() => setRoster([])}
                className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-red-600">✕</button>
            </div>
          ) : (
            <div className="flex gap-1">
              <SearchableSelect
                className="flex-1 min-w-0"
                value={form.teacher_choice}
                onChange={(v) => setForm({ ...form, teacher_choice: v })}
                options={[
                  { value: "homeroom", label: "👩‍🏫 ครูประจำชั้นของแต่ละห้อง" },
                  { value: "none", label: "– ไม่ระบุครู –" },
                  ...teachers.map((t) => ({
                    value: String(t.id), label: t.name, hint: t.code ?? undefined,
                    group: "ครูคนเดียวดูแลทุกห้อง",
                  })),
                ]}
              />
              <button onClick={() => setShowRoster(true)} disabled={picked.length === 0}
                title={picked.length === 0 ? "ติ๊กห้องก่อน" : "เลือกครูผู้ดูแลหลายคนต่อห้อง"}
                className="shrink-0 px-2 border border-teal-300 text-teal-700 rounded text-xs hover:bg-teal-50 disabled:opacity-40">
                👥 เลือกหลายคน
              </button>
            </div>
          )}
        </Field>
        <Field label="ห้องที่ใช้">
          <select className={inputCls} value={form.room_mode}
            onChange={(e) => setForm({ ...form, room_mode: e.target.value as "homeroom" | "none" })}>
            <option value="homeroom">ห้องประจำชั้นของแต่ละห้อง</option>
            <option value="none">ไม่ระบุห้อง</option>
          </select>
        </Field>
      </div>

      {rosterCount > 0 && (
        <p className="text-xs text-gray-500 mb-2 leading-relaxed">
          {roster.slice(0, 10).map((t) => nameOf(teachers, t)).join(" · ")}
          {roster.length > 10 && ` … อีก ${roster.length - 10} คน`}
          <span className="text-gray-400"> — ครูไปแบ่งกันเองว่าใครดูห้องไหน</span>
        </p>
      )}
      {rosterCount === 0 && form.teacher_choice === "homeroom" && picked.length > 0 && (
        missingHomeroom.length > 0 ? (
          <p className="text-xs text-amber-600 mb-2">
            ⚠️ ยังไม่ได้ตั้งครูประจำชั้น: {missingHomeroom.map((g) => g.name).join(", ")} —
            ห้องเหล่านี้จะได้คาบกิจกรรมแต่ไม่มีครู
          </p>
        ) : (
          <p className="text-xs text-gray-400 mb-2">
            💡 ครูประจำชั้นของแต่ละห้องจะได้คาบนี้ลงในตารางสอนของตัวเองด้วย
          </p>
        )
      )}
      {rosterCount === 0 && form.teacher_choice === "none" && (
        <p className="text-xs text-gray-400 mb-2">
          💡 ไม่ระบุครู = ครูทุกคนยังว่างในคาบนั้น นักเรียนได้คาบกิจกรรมอย่างเดียว
        </p>
      )}

      <div className="flex items-center gap-2">
        <button onClick={handleCreate} disabled={!canCreate}
          className={clsx("px-3 py-1.5 text-white text-sm rounded font-medium disabled:opacity-40",
            editing ? "bg-amber-600 hover:bg-amber-700" : "bg-teal-600 hover:bg-teal-700")}>
          {busy ? "กำลังบันทึก…"
            : editing ? `บันทึกการแก้ไข (${picked.length} ห้อง)`
            : `+ สร้างคาบกิจกรรมให้ ${picked.length} ห้อง`}
        </button>
        {editing && (
          <button onClick={cancelEdit} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100">
            ยกเลิก
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
          ✅ {result.edited ? "แก้ไขแล้ว" : "สร้างแล้ว"} {result.created} ห้อง
          {result.warnings.length > 0 && (
            <div className="mt-1 text-amber-700 space-y-0.5">
              {result.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="mt-1 text-amber-700">
              ⚠️ ข้าม {result.skipped.length} ห้องที่มีคาบอยู่แล้ว:{" "}
              {result.skipped.map((s) => `${s.group} (${s.reason})`).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Existing activities */}
      <div className="mt-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">คาบกิจกรรมที่ตั้งไว้แล้ว</p>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["วัน", "คาบ", "กิจกรรม", "ห้องที่เข้าร่วม", "ครูผู้ดูแล", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {existing.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีคาบกิจกรรม</td></tr>
              )}
              {existing.map((a) => (
                <tr key={a.key} className="hover:bg-teal-50/30">
                  <td className="px-3 py-2 text-gray-600">{DAYS[a.day]}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {periodLabel(a.period, periods)}
                    <span className="text-gray-400 text-[11px] ml-1">{periodTime(a.period, periods)}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-700 font-medium">{a.subject}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs" title={a.classes.join(", ")}>
                    {a.classes.length} ห้อง
                    <span className="text-gray-400 ml-1">{a.classes.slice(0, 4).join(", ")}{a.classes.length > 4 ? " …" : ""}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs" title={[...a.teachers].join(", ")}>
                    {a.teachers.size === 0 ? "– ไม่ระบุ –" : `${a.teachers.size} คน`}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(a)} disabled={busy}
                        className="px-2 py-1 text-xs bg-amber-50 text-amber-700 rounded hover:bg-amber-100 border border-amber-200">
                        ✏️ แก้ไข
                      </button>
                      <button onClick={() => handleDelete(a.key)} disabled={busy}
                        className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 border border-red-200">
                        ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showRoster && (
        <ActivitySupervisorModal
          classes={chosen} flat={flat} teachers={teachers} departments={departments}
          requirements={requirements}
          title={`${subjectName} · ${DAYS[Number(form.day)]} ${form.period ? periodLabel(Number(form.period), periods) : ""}`}
          value={roster}
          onSave={setRoster}
          onClose={() => setShowRoster(false)}
        />
      )}
    </div>
  );
};

const inputCls = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-teal-500 outline-none";

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
    {children}
  </div>
);
