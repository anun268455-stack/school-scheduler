/**
 * SubjectAssignModal — decide, for one subject, which classes study it and who
 * teaches each one. Done before the timetable is generated.
 *
 * Flow: pick a level → tick the classes in it → each ticked class gets a row
 * where you choose the teacher and how many periods a week. Saving writes these
 * as lesson requirements, which is what the auto-scheduler reads.
 *
 * Classes that already have this subject assigned are shown as existing rows so
 * they can be re-pointed at a different teacher or removed.
 */
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups } from "../../utils/groupHierarchy";
import type { Subject } from "../../types";

interface SubjectAssignModalProps {
  subject: Subject;
  onClose: () => void;
}

interface Row {
  groupId:   number;
  teacherId: string;
  weekly:    number;
  reqId?:    number;    // set when this row already exists in the database
}

export const SubjectAssignModal: React.FC<SubjectAssignModalProps> = ({ subject, onClose }) => {
  const { groups, teachers, requirements, departments } = useTimetableStore();

  const flat = useMemo(() => flattenGroups(groups), [groups]);

  // Levels available, plus a bucket for classes with no level set.
  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const g of flat) if (g.level) s.add(g.level);
    return [...s].sort();
  }, [flat]);

  const [level, setLevel] = useState<string>(() => levels[0] ?? "");
  const [rows, setRows]   = useState<Row[]>(() =>
    requirements
      .filter((r) => r.subject_id === subject.id)
      .map((r) => ({ groupId: r.group_id, teacherId: String(r.teacher_id), weekly: r.weekly_count, reqId: r.id })),
  );
  const [defaultTeacher, setDefaultTeacher] = useState("");
  const [defaultWeekly, setDefaultWeekly]   = useState(subject.duration === 2 ? 2 : 1);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only teachers of the subject's own กลุ่มสาระ are offered — a social-studies
  // subject lists social-studies teachers. "แสดงครูทุกคน" lifts the filter for
  // the cases where someone teaches outside their department.
  const [showAllTeachers, setShowAllTeachers] = useState(false);
  const dept = subject.department_id;
  const deptTeachers = useMemo(
    () => (dept ? teachers.filter((t) => t.department_id === dept) : []),
    [teachers, dept],
  );
  // No department on the subject, or nobody in it → fall back to everyone.
  const filterActive = !!dept && deptTeachers.length > 0 && !showAllTeachers;
  const baseTeachers = useMemo(
    () => [...(filterActive ? deptTeachers : teachers)].sort((a, b) => a.name.localeCompare(b.name)),
    [filterActive, deptTeachers, teachers],
  );

  /**
   * Options for one row. A teacher already assigned but outside the filter is
   * still listed, so opening the dialog never silently drops an assignment.
   */
  const optionsFor = (currentId: string) => {
    if (!currentId) return baseTeachers;
    const id = Number(currentId);
    if (baseTeachers.some((t) => t.id === id)) return baseTeachers;
    const extra = teachers.find((t) => t.id === id);
    return extra ? [extra, ...baseTeachers] : baseTeachers;
  };

  const classesInLevel = useMemo(
    () => flat.filter((g) => (g.level ?? "") === level),
    [flat, level],
  );

  const picked = useMemo(() => new Set(rows.map((r) => r.groupId)), [rows]);
  const gName  = (id: number) => flat.find((g) => g.id === id)?.name ?? String(id);

  const toggleClass = (groupId: number) => {
    setRows((prev) =>
      prev.some((r) => r.groupId === groupId)
        ? prev.filter((r) => r.groupId !== groupId)
        : [...prev, { groupId, teacherId: defaultTeacher, weekly: defaultWeekly }],
    );
  };

  const toggleAllInLevel = () => {
    const allPicked = classesInLevel.every((g) => picked.has(g.id));
    setRows((prev) => {
      if (allPicked) {
        const ids = new Set(classesInLevel.map((g) => g.id));
        return prev.filter((r) => !ids.has(r.groupId));
      }
      const add = classesInLevel
        .filter((g) => !picked.has(g.id))
        .map((g) => ({ groupId: g.id, teacherId: defaultTeacher, weekly: defaultWeekly }));
      return [...prev, ...add];
    });
  };

  const applyDefaultsToAll = () => {
    setRows((prev) => prev.map((r) => ({
      ...r,
      teacherId: defaultTeacher || r.teacherId,
      weekly: defaultWeekly,
    })));
  };

  const setRow = (groupId: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.groupId === groupId ? { ...r, ...patch } : r)));

  const missingTeacher = rows.filter((r) => !r.teacherId).length;
  const canSave = rows.length > 0 && missingTeacher === 0 && !busy;

  const handleSave = async () => {
    setBusy(true); setError(null);
    try {
      const original = requirements.filter((r) => r.subject_id === subject.id);

      // Rows removed in the dialog → delete those requirements.
      const keptIds = new Set(rows.filter((r) => r.reqId).map((r) => r.reqId));
      for (const r of original) {
        if (!keptIds.has(r.id)) await api.deleteRequirement(r.id);
      }

      // Existing rows whose teacher or count changed → update in place.
      for (const row of rows) {
        if (!row.reqId) continue;
        const before = original.find((r) => r.id === row.reqId);
        if (!before) continue;
        if (before.teacher_id !== Number(row.teacherId) || before.weekly_count !== row.weekly) {
          await api.updateRequirement(row.reqId, {
            group_id: row.groupId,
            subject_id: subject.id,
            teacher_id: Number(row.teacherId),
            weekly_count: row.weekly,
          });
        }
      }

      // Brand-new rows → one bulk create.
      const fresh = rows.filter((r) => !r.reqId).map((r) => ({
        group_id: r.groupId,
        subject_id: subject.id,
        teacher_id: Number(r.teacherId),
        weekly_count: r.weekly,
        parallel_group_key: null,
      }));
      if (fresh.length) await api.bulkCreateRequirements(fresh);

      const updated = await api.fetchRequirements();
      useTimetableStore.setState({ requirements: updated });
      onClose();
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  const deptName = departments.find((d) => d.id === subject.department_id)?.name;
  const deptLabel = deptName ?? "กลุ่มสาระนี้";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-3 bg-blue-700 px-5 py-4 shrink-0">
          <span className="text-2xl">🧑‍🏫</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base leading-tight truncate">
              จัดห้องเรียนและครู — {subject.code}
            </h2>
            <p className="text-blue-100 text-xs mt-0.5 truncate">
              {subject.name}{deptName ? ` · ${deptName}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-blue-200 hover:text-white text-lg leading-none shrink-0">✕</button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-5">
          {/* ── Left: choose level, then classes ─────────────────────────── */}
          <div className="col-span-2 border-r border-gray-200 flex flex-col min-h-0">
            <div className="px-4 pt-3 pb-2 shrink-0">
              <p className="text-xs font-semibold text-gray-500 mb-1.5">1. เลือกระดับชั้น</p>
              <div className="flex flex-wrap gap-1">
                {levels.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLevel(l)}
                    className={clsx(
                      "px-2.5 py-1 text-xs rounded-full border transition-colors",
                      level === l ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-300 text-gray-600 hover:border-blue-400",
                    )}
                  >
                    {l}
                  </button>
                ))}
                {levels.length === 0 && <span className="text-xs text-gray-400">ยังไม่มีระดับชั้น</span>}
              </div>
            </div>

            <div className="px-4 pb-1.5 flex items-center justify-between shrink-0">
              <p className="text-xs font-semibold text-gray-500">2. เลือกห้อง</p>
              {classesInLevel.length > 0 && (
                <button onClick={toggleAllInLevel} className="text-[11px] text-blue-600 hover:underline">
                  {classesInLevel.every((g) => picked.has(g.id)) ? "เอาออกทั้งหมด" : "เลือกทั้งหมด"}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
              {classesInLevel.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">ไม่มีห้องในระดับนี้</p>
              )}
              {classesInLevel.map((g) => (
                <label
                  key={g.id}
                  className={clsx(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors",
                    picked.has(g.id) ? "border-blue-300 bg-blue-50" : "border-gray-200 hover:border-blue-300",
                    g.parent_id && "ml-4",
                  )}
                >
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 accent-blue-600"
                    checked={picked.has(g.id)}
                    onChange={() => toggleClass(g.id)}
                  />
                  <span className="text-sm text-gray-800">{g.name}</span>
                  {g.parent_id && <span className="text-[10px] text-purple-600 bg-purple-50 px-1 rounded">ห้องย่อย</span>}
                  <span className="ml-auto text-[11px] text-gray-400">{g.size} คน</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Right: teacher per class ──────────────────────────────────── */}
          <div className="col-span-3 flex flex-col min-h-0">
            <div className="px-4 pt-3 pb-2 shrink-0 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-xs font-semibold text-gray-500">3. กำหนดครูผู้สอนของแต่ละห้อง</p>
                {!!dept && deptTeachers.length > 0 && (
                  <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
                    <input type="checkbox" className="w-3 h-3 accent-blue-600"
                      checked={showAllTeachers} onChange={(e) => setShowAllTeachers(e.target.checked)} />
                    แสดงครูทุกคน
                  </label>
                )}
              </div>
              {filterActive && (
                <p className="text-[11px] text-blue-600 mb-1.5">
                  แสดงเฉพาะครู{deptLabel} ({deptTeachers.length} คน)
                </p>
              )}
              {!!dept && deptTeachers.length === 0 && (
                <p className="text-[11px] text-amber-600 mb-1.5">
                  ยังไม่มีครูใน{deptLabel} — แสดงครูทุกคนแทน
                </p>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <label className="block text-[11px] text-gray-500 mb-0.5">ตั้งครูหลัก (ใส่ให้ทุกห้องรวดเดียว)</label>
                  <select className={inputCls} value={defaultTeacher} onChange={(e) => setDefaultTeacher(e.target.value)}>
                    <option value="">– เลือกครู –</option>
                    {optionsFor(defaultTeacher).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div style={{ width: 78 }}>
                  <label className="block text-[11px] text-gray-500 mb-0.5">คาบ/สัปดาห์</label>
                  <input type="number" min={1} max={20} className={inputCls}
                    value={defaultWeekly} onChange={(e) => setDefaultWeekly(Number(e.target.value))} />
                </div>
                <button onClick={applyDefaultsToAll} disabled={rows.length === 0}
                  className="px-2.5 py-1.5 text-xs bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 disabled:opacity-40 whitespace-nowrap">
                  ใส่ให้ทุกห้อง
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2.5 space-y-1.5">
              {rows.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-8">ยังไม่ได้เลือกห้อง — ติ๊กห้องจากทางซ้าย</p>
              )}
              {rows.map((r) => (
                <div key={r.groupId} className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-800 w-20 shrink-0 truncate" title={gName(r.groupId)}>
                    {gName(r.groupId)}
                  </span>
                  <select
                    className={clsx(inputCls, "flex-1 min-w-0", !r.teacherId && "border-red-300 bg-red-50")}
                    value={r.teacherId}
                    onChange={(e) => setRow(r.groupId, { teacherId: e.target.value })}
                  >
                    <option value="">– เลือกครู –</option>
                    {optionsFor(r.teacherId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <input
                    type="number" min={1} max={20} style={{ width: 58 }} className={inputCls}
                    value={r.weekly}
                    onChange={(e) => setRow(r.groupId, { weekly: Number(e.target.value) })}
                  />
                  <button onClick={() => toggleClass(r.groupId)}
                    className="px-1.5 py-1 text-xs text-red-400 hover:text-red-600 shrink-0" title="เอาห้องนี้ออก">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
          <p className="text-[11px] flex-1">
            {missingTeacher > 0
              ? <span className="text-red-600">ยังไม่ได้เลือกครู {missingTeacher} ห้อง</span>
              : <span className="text-gray-400">{rows.length} ห้องจะเรียนวิชานี้ · บันทึกแล้วค่อยกดสร้างตาราง</span>}
          </p>
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg font-medium">ยกเลิก</button>
          <button onClick={handleSave} disabled={!canSave}
            className="px-5 py-2 text-sm bg-blue-700 text-white rounded-lg font-semibold hover:bg-blue-800 disabled:opacity-40">
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
};

const inputCls = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none";
