/**
 * AddElectiveSubjectModal — add a subject to an elective, from the subject's
 * side rather than the window's.
 *
 * The other direction already exists: open a คาบเสรี and fill it. This one is
 * for working down a subject list — "this one is an elective, which window does
 * it belong to?" — which is how the choice usually arrives.
 *
 * A window has to exist first. The period an elective runs in is the school's
 * decision and affects every class in it, so this never invents one: with no
 * windows yet, it says so and points at where to make one.
 *
 * Targets are both kinds of elective: a คาบเสรี shared by several classes, and
 * a standalone one pinned to a single class. Each target says whether the
 * chosen teacher is already busy at that hour, because every option in a window
 * runs at the same time and a clash is the thing worth catching here.
 */
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect } from "../common/SearchableSelect";
import { flattenGroups } from "../../utils/groupHierarchy";
import { teachesSlot } from "../../utils/teacherSlots";
import { DAYS, periodLabel } from "../../types";
import type { ElectivePool, TimetableSlot } from "../../types";

interface Props {
  /** Pre-selected subject, when opened from a row in the subject list. */
  subjectId?: number;
  onClose: () => void;
  onDone?: () => void;
}

type Target =
  | { kind: "pool"; id: number; name: string; day: number; period: number;
      classes: string; optionCount: number; hasSubject: boolean }
  | { kind: "slot"; id: number; name: string; day: number; period: number;
      classes: string; optionCount: number; hasSubject: boolean };

export const AddElectiveSubjectModal: React.FC<Props> = ({ subjectId, onClose, onDone }) => {
  const { subjects, teachers, departments, groups, periods, slots, requirements, loadSlots } =
    useTimetableStore();

  const [pools, setPools] = useState<ElectivePool[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState(subjectId ? String(subjectId) : "");
  const [teacher, setTeacher] = useState("");
  const [target, setTarget]   = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api.fetchElectivePools()
      .then((p) => setPools(p))
      .catch(() => setPools([]))
      .finally(() => setLoading(false));
  }, []);

  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const gName = (id: number) => flat.find((g) => g.id === id)?.name ?? String(id);
  const subj  = subjects.find((s) => s.id === Number(subject));

  // ── Who teaches this subject? ──────────────────────────────────────────────
  // The staffing data usually answers it: an ordinary lesson assignment first,
  // then any elective window that already offers the subject (elective subjects
  // have no ordinary lessons, so for them that is the only source).
  const suggestedTeacherId = useMemo(() => {
    if (!subj) return null;
    const counts = new Map<number, number>();
    for (const r of requirements) {
      if (r.subject_id === subj.id) counts.set(r.teacher_id, (counts.get(r.teacher_id) ?? 0) + 1);
    }
    for (const p of pools) {
      for (const o of p.options) {
        // An option imported before the teaching was shared out has no teacher
        // yet, and an empty answer is not a vote for anybody.
        if (o.subject_id === subj.id && o.teacher_id) {
          counts.set(o.teacher_id, (counts.get(o.teacher_id) ?? 0) + 1);
        }
      }
    }
    let best: number | null = null, n = 0;
    for (const [id, c] of counts) if (c > n) { best = id; n = c; }
    return best;
  }, [subj, requirements, pools]);

  useEffect(() => { setTeacher(""); }, [subject]);

  const teacherId = teacher ? Number(teacher) : suggestedTeacherId;

  const subjectOpts = useMemo(() => {
    const dName = (id?: number | null) => departments.find((d) => d.id === id)?.name ?? "ไม่ระบุกลุ่มสาระ";
    return [...subjects].sort((a, b) => a.code.localeCompare(b.code)).map((s) => ({
      value: String(s.id),
      label: `${s.code} – ${s.name}`,
      group: dName(s.department_id),
    }));
  }, [subjects, departments]);

  // Teachers of the subject's own กลุ่มสาระ first, then everyone else.
  const teacherOpts = useMemo(() => {
    const dept = subj?.department_id;
    const teaching = new Set(requirements.filter((r) => r.subject_id === subj?.id).map((r) => r.teacher_id));
    for (const p of pools) {
      for (const o of p.options) if (o.subject_id === subj?.id) teaching.add(o.teacher_id);
    }
    return [...teachers]
      .sort((a, b) => {
        const rank = (t: typeof a) =>
          teaching.has(t.id) ? 0 : (dept != null && t.department_id === dept) ? 1 : 2;
        return rank(a) - rank(b) || (a.code ?? "").localeCompare(b.code ?? "");
      })
      .map((t) => ({
        value: String(t.id),
        label: `${t.code ? `${t.code} ` : ""}${t.name}`,
        group: teaching.has(t.id) ? "ครูที่สอนวิชานี้"
          : (dept != null && t.department_id === dept) ? "กลุ่มสาระเดียวกัน" : "ครูอื่น",
      }));
  }, [teachers, subj, requirements, pools]);

  // ── The windows a subject can go into ──────────────────────────────────────
  const targets: Target[] = useMemo(() => {
    const out: Target[] = [];
    for (const p of pools) {
      if (p.day == null || p.period == null) continue;   // not pinned: nothing to join
      out.push({
        kind: "pool", id: p.id, name: p.name, day: p.day, period: p.period,
        classes: p.group_ids.map(gName).join(", "),
        optionCount: p.options.length,
        hasSubject: p.options.some((o) => o.subject_id === Number(subject)),
      });
    }
    // Standalone per-class electives — the older, one-class kind.
    for (const s of slots) {
      if (!s.is_elective || s.elective_pool_id || s.is_double_cont) continue;
      out.push({
        kind: "slot", id: s.id,
        name: `วิชาเสรี ${s.group_name ?? ""}`.trim(),
        day: s.day, period: s.period,
        classes: s.group_name ?? "",
        optionCount: s.elective_options?.length ?? 0,
        hasSubject: (s.elective_options ?? []).some((o) => o.subject_id === Number(subject)),
      });
    }
    return out.sort((a, b) => a.day - b.day || a.period - b.period);
  }, [pools, slots, subject, flat]);

  /** Is the chosen teacher already teaching at this target's hour? */
  const clashAt = (t: Target): TimetableSlot[] => {
    if (!teacherId) return [];
    return slots.filter((s) => {
      if (s.day !== t.day || s.period !== t.period) return false;
      if (t.kind === "pool" && s.elective_pool_id === t.id) return false;
      if (t.kind === "slot" && s.id === t.id) return false;
      return teachesSlot(s, teacherId);
    });
  };

  const chosen = targets.find((t) => `${t.kind}-${t.id}` === target);

  const submit = async () => {
    if (!chosen || !subj || !teacherId) return;
    setBusy(true); setError(null);
    try {
      if (chosen.kind === "pool") {
        await api.addPoolOption(chosen.id, { subject_id: subj.id, teacher_id: teacherId });
      } else {
        await api.addElectiveOption(chosen.id, {
          subject_id: subj.id, teacher_id: teacherId, label: subj.name,
        });
      }
      await loadSlots();
      setPools(await api.fetchElectivePools().catch(() => pools));
      setDone(`เพิ่ม ${subj.code} ${subj.name} เข้า ${chosen.name} แล้ว`);
      setSubject(""); setTeacher(""); setTarget("");
      onDone?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "เพิ่มไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const noWindows = !loading && targets.length === 0;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-xl">
      <div className="flex items-center gap-3 bg-purple-600 px-5 py-4 shrink-0">
        <span className="text-2xl">🎓</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight">เพิ่มวิชาเข้าคาบเสรี</h2>
          <p className="text-purple-100 text-xs mt-0.5">เลือกวิชา → ครูผู้สอน → คาบเสรีที่จะใส่เข้าไป</p>
        </div>
        <button onClick={onClose} className="text-purple-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loading && <p className="text-sm text-gray-400 text-center py-6">กำลังโหลด…</p>}

        {noWindows && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-900 leading-relaxed">
            <strong>ยังไม่มีคาบเสรีที่กำหนดวัน/คาบไว้</strong>
            <br />
            ต้องสร้างคาบเสรีและกำหนดวัน/คาบก่อน เพราะคาบเสรีคือคาบที่หลายห้องเรียนพร้อมกัน
            การเลือกว่าอยู่คาบไหนกระทบทุกห้องในกลุ่ม ระบบจึงไม่เดาให้
            <br />
            ไปที่ <strong>จัดการ → วิชาเสรี → + สร้างคาบเสรีใหม่</strong> แล้วกลับมาที่นี่
          </div>
        )}

        {!loading && !noWindows && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">วิชา</label>
                <SearchableSelect value={subject} onChange={setSubject}
                  options={subjectOpts} placeholder="ค้นหาวิชา (รหัส/ชื่อ)…" />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">
                  ครูผู้สอน
                  {suggestedTeacherId && !teacher && <span className="text-gray-400"> (เลือกให้แล้ว แก้ได้)</span>}
                </label>
                <SearchableSelect
                  value={teacher || (suggestedTeacherId ? String(suggestedTeacherId) : "")}
                  onChange={setTeacher}
                  options={teacherOpts}
                  disabled={!subject}
                  placeholder={subject ? "ค้นหาครู…" : "เลือกวิชาก่อน"} />
              </div>
            </div>

            {subject && !teacherId && (
              <p className="text-[11px] text-amber-700">
                ยังไม่มีข้อมูลว่าใครสอนวิชานี้ — เลือกครูผู้สอนเอง
              </p>
            )}

            <div>
              <p className="text-[11px] text-gray-500 mb-1">
                ใส่เข้าคาบเสรีไหน ({targets.length} คาบที่กำหนดวัน/คาบแล้ว)
              </p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {targets.map((t) => {
                  const key = `${t.kind}-${t.id}`;
                  const clash = clashAt(t);
                  const blocked = t.hasSubject;
                  return (
                    <button
                      key={key}
                      disabled={blocked || !subject}
                      onClick={() => setTarget(key)}
                      className={clsx(
                        "w-full flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors",
                        blocked ? "border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed"
                          : target === key ? "border-purple-400 bg-purple-50"
                          : "border-gray-200 hover:border-purple-300 hover:bg-purple-50/40",
                      )}
                    >
                      <span className={clsx("mt-1 w-3.5 h-3.5 rounded-full border-2 shrink-0",
                        target === key && !blocked ? "border-purple-500 bg-purple-500" : "border-gray-300")} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-gray-800 truncate">
                          {t.name}
                          <span className="text-[11px] text-gray-500 font-normal">
                            {" · "}{DAYS[t.day]} {periodLabel(t.period, periods)}
                            {" · "}{t.optionCount} วิชา
                          </span>
                        </span>
                        <span className="block text-[11px] text-gray-500 truncate">{t.classes}</span>
                        {blocked && (
                          <span className="block text-[10px] text-gray-500 mt-0.5">วิชานี้อยู่ในคาบนี้แล้ว</span>
                        )}
                        {!blocked && clash.length > 0 && (
                          <span className="block text-[10px] text-red-700 mt-0.5">
                            ⚠ ครูไม่ว่างคาบนี้ — ติด{" "}
                            {[...new Set(clash.map((s) => s.group_name ?? ""))].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {done && (
          <p className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">
            ✓ {done} — เลือกวิชาต่อไปได้เลย
          </p>
        )}
        {error && (
          <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
        <p className="text-[11px] text-gray-400 flex-1">
          ทุกวิชาในคาบเสรีเดียวกันเรียนพร้อมกัน ครูจึงต้องไม่ซ้ำกัน
        </p>
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ปิด</button>
        <button onClick={submit} disabled={busy || !chosen || !subject || !teacherId}
          className="px-5 py-2 text-sm bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 disabled:opacity-40">
          {busy ? "กำลังเพิ่ม…" : "เพิ่มเข้าคาบเสรี"}
        </button>
      </div>
    </ModalShell>
  );
};
