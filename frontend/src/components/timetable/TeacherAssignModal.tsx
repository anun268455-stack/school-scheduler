/**
 * TeacherAssignModal — the teacher's side of the same question the subject page
 * asks: which subject does this teacher teach, and to which classes?
 *
 * It reads and writes the very same lesson requirements as SubjectAssignModal,
 * so adding a class here shows up there, and the other way round.
 *
 * Left : the teacher's current load, grouped by subject, with the option to
 *        change periods-per-week or drop a class.
 * Right: add work — pick a subject, pick a level, tick the classes.
 */
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups } from "../../utils/groupHierarchy";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect } from "../common/SearchableSelect";
import type { Teacher } from "../../types";

interface Props {
  teacher: Teacher;
  onClose: () => void;
}

export const TeacherAssignModal: React.FC<Props> = ({ teacher, onClose }) => {
  const { subjects, groups, requirements, departments } = useTimetableStore();

  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const g of flat) if (g.level) s.add(g.level);
    return [...s].sort();
  }, [flat]);

  const [subjectId, setSubjectId] = useState("");
  const [level, setLevel]   = useState<string>(() => levels[0] ?? "");
  const [weekly, setWeekly] = useState(1);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Everything this teacher is currently down to teach.
  const mine = useMemo(
    () => requirements.filter((r) => r.teacher_id === teacher.id),
    [requirements, teacher.id],
  );

  const subjName = (id: number) => {
    const s = subjects.find((x) => x.id === id);
    return s ? `${s.code} – ${s.name}` : String(id);
  };
  const gName = (id: number) => flat.find((g) => g.id === id)?.name ?? String(id);

  // Group the load by subject so the list reads like a teaching timetable.
  const bySubject = useMemo(() => {
    const m = new Map<number, typeof mine>();
    for (const r of mine) {
      const list = m.get(r.subject_id) ?? [];
      list.push(r);
      m.set(r.subject_id, list);
    }
    return [...m.entries()].sort((a, b) => subjName(a[0]).localeCompare(subjName(b[0])));
  }, [mine, subjects]);

  const totalPeriods = mine.reduce((n, r) => n + (r.weekly_count ?? 0), 0);
  const cap = (teacher.max_slots_per_day || 6) * 5;

  // Teachers of a subject's own department first, but every subject stays listed.
  const subjectOpts = useMemo(() => {
    const sorted = [...subjects].sort((a, b) => {
      const am = a.department_id === teacher.department_id ? 0 : 1;
      const bm = b.department_id === teacher.department_id ? 0 : 1;
      return am - bm || a.code.localeCompare(b.code);
    });
    return sorted.map((s) => ({
      value: String(s.id),
      label: `${s.code} – ${s.name}`,
      group: s.department_id === teacher.department_id ? "กลุ่มสาระของครูคนนี้" : "วิชาอื่น",
    }));
  }, [subjects, teacher.department_id]);

  const classesInLevel = useMemo(() => flat.filter((g) => (g.level ?? "") === level), [flat, level]);

  /** Who already teaches this subject to this class (anyone, not just us). */
  const takenBy = (groupId: number, subjId: number) =>
    requirements.find((r) => r.group_id === groupId && r.subject_id === subjId);

  const refresh = async () => {
    const updated = await api.fetchRequirements();
    useTimetableStore.setState({ requirements: updated });
  };

  const addClass = async (groupId: number) => {
    if (!subjectId) return;
    setBusy(true); setError(null);
    try {
      await api.bulkCreateRequirements([{
        group_id: groupId,
        subject_id: Number(subjectId),
        teacher_id: teacher.id,
        weekly_count: weekly,
        parallel_group_key: null,
      }]);
      await refresh();
    } catch {
      setError("เพิ่มไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const addAllInLevel = async () => {
    if (!subjectId) return;
    const targets = classesInLevel.filter((g) => !takenBy(g.id, Number(subjectId)));
    if (targets.length === 0) return;
    setBusy(true); setError(null);
    try {
      await api.bulkCreateRequirements(targets.map((g) => ({
        group_id: g.id,
        subject_id: Number(subjectId),
        teacher_id: teacher.id,
        weekly_count: weekly,
        parallel_group_key: null,
      })));
      await refresh();
    } catch {
      setError("เพิ่มไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const removeReq = async (id: number) => {
    setBusy(true);
    try { await api.deleteRequirement(id); await refresh(); }
    finally { setBusy(false); }
  };

  const changeWeekly = async (id: number, groupId: number, subjId: number, n: number) => {
    setBusy(true);
    try {
      await api.updateRequirement(id, {
        group_id: groupId, subject_id: subjId, teacher_id: teacher.id, weekly_count: n,
      });
      await refresh();
    } finally { setBusy(false); }
  };

  const deptName = departments.find((d) => d.id === teacher.department_id)?.name;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 bg-indigo-700 px-5 py-4 shrink-0">
        <span className="text-2xl">📚</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            วิชาที่สอน — {teacher.code ? `${teacher.code} ` : ""}{teacher.name}
          </h2>
          <p className="text-indigo-100 text-xs mt-0.5 truncate">
            {deptName ?? "ไม่ระบุกลุ่มสาระ"} · รวม {totalPeriods} คาบ/สัปดาห์
            {totalPeriods > cap && <span className="text-amber-200"> (เกินเพดาน {cap})</span>}
          </p>
        </div>
        <button onClick={onClose} className="text-indigo-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-5">
        {/* Current load */}
        <div className="col-span-3 border-r border-gray-200 flex flex-col min-h-0">
          <p className="px-4 pt-3 pb-1.5 text-xs font-semibold text-gray-500 shrink-0">
            วิชาที่สอนอยู่ ({mine.length} ห้อง)
          </p>
          <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2.5">
            {bySubject.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">ยังไม่ได้กำหนดวิชาให้ครูคนนี้</p>
            )}
            {bySubject.map(([subjId, rows]) => (
              <div key={subjId} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-2.5 py-1.5 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800 truncate">{subjName(subjId)}</span>
                  <span className="ml-auto text-[11px] text-gray-500 shrink-0">
                    {rows.reduce((n, r) => n + r.weekly_count, 0)} คาบ
                  </span>
                </div>
                <div className="divide-y divide-gray-50">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center gap-1.5 px-2.5 py-1.5">
                      <span className="text-sm text-gray-700 flex-1 truncate">{gName(r.group_id)}</span>
                      <input
                        type="number" min={1} max={20} style={{ width: 52 }} disabled={busy}
                        className="border border-gray-300 rounded px-1.5 py-0.5 text-sm"
                        value={r.weekly_count}
                        onChange={(e) => changeWeekly(r.id, r.group_id, r.subject_id, Number(e.target.value))}
                      />
                      <span className="text-[11px] text-gray-400">คาบ</span>
                      <button onClick={() => removeReq(r.id)} disabled={busy}
                        className="px-1.5 text-red-400 hover:text-red-600 text-xs" title="เอาห้องนี้ออก">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Add work */}
        <div className="col-span-2 flex flex-col min-h-0">
          <div className="px-4 pt-3 pb-2 space-y-2 shrink-0 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500">เพิ่มวิชาที่สอน</p>
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">วิชา</label>
              <SearchableSelect value={subjectId} onChange={setSubjectId}
                options={subjectOpts} placeholder="เลือกวิชา" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <label className="block text-[11px] text-gray-500 mb-0.5">ระดับชั้น</label>
                <SearchableSelect value={level} onChange={setLevel}
                  options={levels.map((l) => ({ value: l, label: l }))} placeholder="เลือกระดับ" />
              </div>
              <div style={{ width: 70 }}>
                <label className="block text-[11px] text-gray-500 mb-0.5">คาบ/สัปดาห์</label>
                <input type="number" min={1} max={20}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  value={weekly} onChange={(e) => setWeekly(Number(e.target.value))} />
              </div>
            </div>
            {subjectId && classesInLevel.length > 0 && (
              <button onClick={addAllInLevel} disabled={busy}
                className="w-full px-2 py-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-40">
                + เพิ่มทุกห้องใน {level} ที่ยังว่าง
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {!subjectId && <p className="text-xs text-gray-400 text-center py-8">เลือกวิชาก่อน แล้วจึงเลือกห้อง</p>}
            {subjectId && classesInLevel.map((g) => {
              const owner = takenBy(g.id, Number(subjectId));
              const isMine = owner?.teacher_id === teacher.id;
              return (
                <button
                  key={g.id}
                  onClick={() => !owner && addClass(g.id)}
                  disabled={!!owner || busy}
                  className={clsx(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors",
                    isMine ? "border-indigo-200 bg-indigo-50"
                      : owner ? "border-gray-200 bg-gray-50 opacity-70 cursor-not-allowed"
                      : "border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/50",
                  )}
                >
                  <span className="text-sm text-gray-800 flex-1 truncate">{g.name}</span>
                  {isMine ? <span className="text-[10px] text-indigo-600">สอนอยู่</span>
                    : owner ? <span className="text-[10px] text-gray-400 truncate max-w-[90px]">
                        ครูอื่นสอน
                      </span>
                    : <span className="text-[11px] text-indigo-500">+ เพิ่ม</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
        <p className="text-[11px] text-gray-400 flex-1">
          ข้อมูลนี้เชื่อมกับหน้า "จัดห้อง/ครู" ของรายวิชา — แก้ที่ไหนก็เห็นเหมือนกัน
        </p>
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button onClick={onClose} className="px-5 py-2 text-sm bg-indigo-700 text-white rounded-lg font-semibold hover:bg-indigo-800">
          เสร็จสิ้น
        </button>
      </div>
    </ModalShell>
  );
};
