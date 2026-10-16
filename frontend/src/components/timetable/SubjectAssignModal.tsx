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
import { ModalShell } from "../common/ModalShell";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups, groupLabel } from "../../utils/groupHierarchy";
import { SearchableSelect, teacherOptions } from "../common/SearchableSelect";
import type { Subject } from "../../types";

interface SubjectAssignModalProps {
  subject: Subject;
  onClose: () => void;
}

/**
 * What a newly ticked class says about the ลาน.
 *
 * "ไม่ออกลาน", because that is the answer for almost every class and the
 * school would rather name the exceptions than the rule: a lesson quietly
 * placed outdoors is one nobody chose, and they only find out when a class
 * is standing on the ลาน in the rain. Opting a class in is one click.
 */
const NEW_ROW_YARD = "no" as const;

interface Row {
  groupId:   number;
  teacherId: string;
  /** ครูคนที่ 2 ที่สอนคาบเดียวกัน — "" เมื่อไม่มี */
  coTeacherId: string;
  /** เรียนที่ลานได้ไหม เฉพาะห้องนี้ — "" ไม่ระบุ, "yes", "no" */
  outdoor: "" | "yes" | "no";
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
      .map((r) => ({
        groupId: r.group_id, teacherId: String(r.teacher_id),
        coTeacherId: r.co_teacher_id ? String(r.co_teacher_id) : "",
        // Two answers, not three. "ไม่ได้ตั้ง" used to mean "ตามค่าวิชา",
        // which the school read as a third state they had to understand;
        // now a class is either allowed out or it is not, and not is the
        // starting point, which is also what the solver assumes.
        outdoor: (r.allow_outdoor === true ? "yes" : "no") as "yes" | "no",
        weekly: r.weekly_count, reqId: r.id,
      })),
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

  /**
   * The rows in class order, which is the order anyone reads them in.
   *
   * They arrive in whatever order the requirements happen to be stored, so
   * fourteen classes came out as ม.2/4, ม.2/8, ม.2/10, ม.2/12, ม.2/14, ม.2/1 —
   * and checking that every class has a teacher means reading all fourteen
   * twice. Sorted for display only; the rows themselves keep their identity.
   */
  const shownRows = useMemo(() => {
    const nameOf = (id: number) => groupLabel(flat, id);
    return [...rows].sort((a, b) =>
      nameOf(a.groupId).localeCompare(nameOf(b.groupId), "th", { numeric: true }));
  }, [rows, flat]);
  const gName  = (id: number) => groupLabel(flat, id);

  const toggleClass = (groupId: number) => {
    setRows((prev) =>
      prev.some((r) => r.groupId === groupId)
        ? prev.filter((r) => r.groupId !== groupId)
        : [...prev, { groupId, teacherId: defaultTeacher, coTeacherId: "",
                      outdoor: NEW_ROW_YARD, weekly: defaultWeekly }],
    );
  };

  const toggleAllInLevel = () => {
    const allPicked = classesInLevel.every((g) => picked.has(g.id));
    setRows((prev) => {
      if (allPicked) {
        const ids = new Set(classesInLevel.map((g) => g.id));
        return prev.filter((r) => !ids.has(r.groupId));
      }
      // "เลือกทั้งหมด" means the whole classes, not the subgroups as well:
      // ม.4/6 and ม.4/6ก are the same students, and a lesson on both is that
      // class sitting in two rooms at once.
      const add = classesInLevel
        .filter((g) => !g.parent_id && !picked.has(g.id))
        .map((g) => ({ groupId: g.id, teacherId: defaultTeacher, coTeacherId: "",
                       outdoor: NEW_ROW_YARD, weekly: defaultWeekly }));
      const kids = new Set(classesInLevel.filter((g) => g.parent_id).map((g) => g.id));
      return [...prev.filter((r) => !kids.has(r.groupId)), ...add];
    });
  };

  /** Every class of this subject, in or out of the ลาน, in one click. */
  const setAllYard = (outdoor: "yes" | "no") =>
    setRows((prev) => prev.map((r) => ({ ...r, outdoor })));

  const applyDefaultsToAll = () => {
    setRows((prev) => prev.map((r) => ({
      ...r,
      teacherId: defaultTeacher || r.teacherId,
      weekly: defaultWeekly,
    })));
  };

  const setRow = (groupId: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.groupId === groupId ? { ...r, ...patch } : r)));

  /**
   * A class ticked alongside one of its own subgroups.
   *
   * They hold the same students, so the lesson would be that class in two
   * rooms at once. Said here rather than refused, because which of the two
   * the school meant is their call, not the dialog's.
   */
  const doubleBooked = useMemo(() => {
    const ids = new Set(rows.map((r) => r.groupId));
    const out: string[] = [];
    for (const g of flat) {
      if (!ids.has(g.id)) continue;
      for (const c of g.children ?? []) {
        if (ids.has(c.id)) out.push(`${g.name} + ${c.name}`);
      }
    }
    return out;
  }, [rows, flat]);

  const missingTeacher = rows.filter((r) => !r.teacherId).length;
  const canSave = rows.length > 0 && missingTeacher === 0 && !busy;

  /**
   * The สอนร่วม partner to save, or null.
   *
   * Changing ครูผู้สอน after picking a partner can leave the two the same
   * person; sent through, that books one teacher into the cell twice.
   */
  const coOf = (r: Row) =>
    r.coTeacherId && r.coTeacherId !== r.teacherId ? Number(r.coTeacherId) : null;
  /** The row's own answer about the ลาน, or null to inherit. */
  const yardOf = (r: Row) => r.outdoor === "yes" ? true : r.outdoor === "no" ? false : null;

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
        const co = coOf(row);
        if (before.teacher_id !== Number(row.teacherId)
            || before.weekly_count !== row.weekly
            || (before.co_teacher_id ?? null) !== co
            || (before.allow_outdoor ?? null) !== yardOf(row)) {
          await api.updateRequirement(row.reqId, {
            group_id: row.groupId,
            subject_id: subject.id,
            teacher_id: Number(row.teacherId),
            co_teacher_id: co,
            allow_outdoor: yardOf(row),
            weekly_count: row.weekly,
          });
        }
      }

      // Brand-new rows → one bulk create.
      const fresh = rows.filter((r) => !r.reqId).map((r) => ({
        group_id: r.groupId,
        subject_id: subject.id,
        teacher_id: Number(r.teacherId),
        co_teacher_id: coOf(r),
        allow_outdoor: yardOf(r),
        weekly_count: r.weekly,
        parallel_group_key: null,
      }));
      if (fresh.length) await api.bulkCreateRequirements(fresh);

      const updated = await api.fetchRequirements();
      useTimetableStore.setState({ requirements: updated });
      onClose();
    } catch (e) {
      // A class whose curriculum leaves this subject out is refused with a
      // sentence that names the curriculum — that is the message to show.
      setError(api.errorDetail(e, "บันทึกไม่สำเร็จ กรุณาลองใหม่"));
    } finally {
      setBusy(false);
    }
  };

  const deptName = departments.find((d) => d.id === subject.department_id)?.name;
  const deptLabel = deptName ?? "กลุ่มสาระนี้";

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-6xl" tall>

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

        <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden grid grid-cols-1 md:grid-cols-12">
          {/* ── Left: choose level, then classes ─────────────────────────── */}
          <div className="md:col-span-4 lg:col-span-3 border-b md:border-b-0 md:border-r border-gray-200 flex flex-col min-h-0 max-h-[40vh] md:max-h-none">
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
          <div className="md:col-span-8 lg:col-span-9 flex flex-col min-h-0">
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
                  <SearchableSelect value={defaultTeacher} onChange={setDefaultTeacher}
                    options={teacherOptions(optionsFor(defaultTeacher))} emptyLabel="– เลือกครู –" />
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

              {/* ลาน, for every class at once.
                  Fourteen classes meant fourteen clicks on the same button to
                  say one thing about the subject, and the school gave up long
                  before ม.2/14. The per-class button stays, for the exceptions
                  that are the whole reason it is per-class. */}
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                <span className="text-[11px] text-gray-500 shrink-0">เรียนที่ลาน:</span>
                <button onClick={() => setAllYard("yes")} disabled={rows.length === 0}
                  title="ทุกห้องของวิชานี้ออกไปเรียนที่ลานได้ ถ้าห้องเรียนเต็ม"
                  className="px-2 py-1 text-xs bg-green-50 border border-green-300 text-green-800 rounded hover:bg-green-100 disabled:opacity-40 whitespace-nowrap">
                  🌳 ทุกห้องออกลานได้
                </button>
                <button onClick={() => setAllYard("no")} disabled={rows.length === 0}
                  title="ทุกห้องของวิชานี้ต้องอยู่ในห้องเรียน"
                  className="px-2 py-1 text-xs bg-gray-100 border border-gray-400 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-40 whitespace-nowrap">
                  🚫 ทุกห้องไม่ออกลาน
                </button>
                <span className="text-[11px] text-gray-400 truncate">
                  แล้วค่อยกดปุ่มท้ายแถวแก้เฉพาะห้องที่ต่างออกไป
                </span>
              </div>
            </div>

            {rows.length > 0 && (
              <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 shrink-0
                              text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <span className="w-16 shrink-0">ห้อง</span>
                <span className="flex-1 min-w-0">ครูผู้สอน</span>
                <span className="shrink-0" style={{ width: 170 }}>ครูสอนร่วม</span>
                <span className="shrink-0 text-center" style={{ width: 58 }}>คาบ</span>
                <span className="shrink-0 text-center" style={{ width: 30 }}>ลาน</span>
                <span className="shrink-0" style={{ width: 20 }} />
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-4 pb-2.5 space-y-1 border-t border-gray-100">
              {rows.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-8">ยังไม่ได้เลือกห้อง — ติ๊กห้องจากทางซ้าย</p>
              )}
              {shownRows.map((r, i) => (
                <div key={r.groupId}
                  className={clsx("flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5",
                    i % 2 === 1 && "bg-gray-50/80")}>
                  <span className="text-sm text-gray-800 w-16 shrink-0 truncate" title={gName(r.groupId)}>
                    {gName(r.groupId)}
                  </span>
                  <SearchableSelect
                    className={clsx("flex-1 min-w-0", !r.teacherId && "ring-1 ring-red-300 rounded")}
                    value={r.teacherId}
                    onChange={(v) => setRow(r.groupId, { teacherId: v })}
                    options={teacherOptions(optionsFor(r.teacherId))}
                    emptyLabel="– เลือกครู –"
                  />
                  <SearchableSelect
                    className="shrink-0 w-[170px]"
                    value={r.coTeacherId}
                    onChange={(v) => setRow(r.groupId, { coTeacherId: v })}
                    options={teacherOptions(
                      teachers.filter((t) => String(t.id) !== r.teacherId), departments)}
                    emptyLabel="– ไม่มีครูสอนร่วม –"
                    placeholder="👥"
                  />
                  <input
                    type="number" min={1} max={20} style={{ width: 58 }} className={inputCls}
                    value={r.weekly}
                    onChange={(e) => setRow(r.groupId, { weekly: Number(e.target.value) })}
                  />
                  {/* เรียนที่ลานได้ไหม เฉพาะห้องนี้.
                      The school is short of rooms and has to choose who goes
                      outside — and that is a question about classes, not
                      subjects: ห้องวิทย์-คณิต keep the classrooms while
                      another class takes the ลาน for the same lesson. */}
                  <button
                    onClick={() => setRow(r.groupId,
                      { outdoor: r.outdoor === "yes" ? "no" : "yes" })}
                    title={r.outdoor === "yes"
                      ? "ห้องนี้ออกไปเรียนที่ลานได้ ถ้าห้องเรียนเต็ม — กดเพื่อกันไว้ในอาคาร"
                      : "ห้องนี้อยู่ในห้องเรียนเท่านั้น — กดเพื่อให้ออกลานได้"}
                    className={clsx("shrink-0 rounded border text-xs text-center",
                      r.outdoor === "yes" ? "bg-green-50 border-green-300"
                        : "bg-gray-100 border-gray-300")}
                    style={{ width: 30, paddingTop: 4, paddingBottom: 4 }}>
                    {r.outdoor === "yes" ? "🌳" : "🚫"}
                  </button>
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
              : doubleBooked.length > 0
              ? <span className="text-amber-700">
                  ⚠️ ติ๊กทั้งห้องแม่และห้องย่อย ({doubleBooked.join(", ")}) —
                  เป็นนักเรียนกลุ่มเดียวกัน เลือกอย่างใดอย่างหนึ่ง
                </span>
              : <span className="text-gray-400">{rows.length} ห้องจะเรียนวิชานี้ · บันทึกแล้วค่อยกดสร้างตาราง</span>}
          </p>
          {error && <span className="text-xs text-red-600 max-w-sm leading-snug">{error}</span>}
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg font-medium">ยกเลิก</button>
          <button onClick={handleSave} disabled={!canSave}
            className="px-5 py-2 text-sm bg-blue-700 text-white rounded-lg font-semibold hover:bg-blue-800 disabled:opacity-40">
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
    </ModalShell>
  );
};

const inputCls = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none";
