/**
 * ตรวจรายวิชา — one class's teaching plan, read as a class rather than as
 * rows in a list of 1,685.
 *
 * The questions it answers are the ones that were being asked by eye: does
 * this class have the same subject twice, does its week fit the week, is
 * anything down with no teacher, and is every วิชาเสรี it takes actually
 * offered to it in a คาบเสรี. Everything here is read off the plan live —
 * nothing is stored, so it cannot go stale.
 */
import { useMemo } from "react";
import { ModalShell } from "../common/ModalShell";
import { auditClass } from "../../utils/classAudit";
import { electiveSubjectIds } from "../../utils/teachingLoad";
import { windowGroupsFor } from "../../utils/electiveCoverage";
import type {
  ElectivePool, LessonRequirement, Period, StudentGroup, Subject, Teacher, TimetableSlot,
} from "../../types";

interface Props {
  group: StudentGroup;
  groups: StudentGroup[];
  requirements: LessonRequirement[];
  subjects: Subject[];
  teachers: Teacher[];
  slots: TimetableSlot[];
  pools: ElectivePool[];
  periods: Period[];
  onClose: () => void;
}

export const ClassSubjectsModal: React.FC<Props> = ({
  group, requirements, subjects, teachers, slots, pools, periods, onClose,
}) => {
  const electiveIds = useMemo(
    () => electiveSubjectIds(subjects, pools, slots), [subjects, pools, slots]);
  const electiveSlots = useMemo(() => slots.filter((s) => s.is_elective), [slots]);

  /** How many teaching periods this class's week actually holds. */
  const capacity = useMemo(() => {
    const teach = periods.filter((p) => (p.type ?? "class") === "class").length;
    return teach * 5;
  }, [periods]);

  const placed = useMemo(
    () => slots.filter((s) => s.group_id === group.id).length, [slots, group.id]);

  const audit = useMemo(() => auditClass(
    group, requirements, subjects, electiveIds,
    (sid) => windowGroupsFor(sid, pools, electiveSlots),
    capacity, placed,
  ), [group, requirements, subjects, electiveIds, pools, electiveSlots, capacity, placed]);

  const subj = (id: number) => subjects.find((s) => s.id === id);
  const tName = (id: number) => teachers.find((t) => t.id === id)?.name ?? `#${id}`;

  const over = audit.planned - audit.capacity;
  const problems = audit.duplicates.length + audit.missingTeacher.length
    + audit.electiveNoWindow.length + (over > 0 ? 1 : 0);

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="flex items-center gap-3 bg-slate-700 px-5 py-4 shrink-0">
        <span className="text-2xl">📋</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            ตรวจรายวิชา — {group.name}
          </h2>
          <p className="text-slate-200 text-xs mt-0.5">
            {audit.subjects.length} วิชา · แผนขอ {audit.planned} คาบ/สัปดาห์
            {" · "}สัปดาห์มี {audit.capacity} คาบ · ลงตารางแล้ว {audit.placed} คาบ
          </p>
        </div>
        <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {/* Verdict first — the reason anyone opened this. */}
        {problems === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            ✓ ไม่พบปัญหา — ไม่มีวิชาซ้ำ ทุกวิชามีครู และคาบรวมไม่เกินสัปดาห์
          </div>
        ) : (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-1">
            {over > 0 && (
              <p className="text-xs text-amber-900">
                ⚠ <strong>เกินสัปดาห์ {over} คาบ</strong> — แผนขอ {audit.planned} คาบ
                แต่สัปดาห์มีช่องเรียน {audit.capacity} คาบ
                {audit.duplicates.length > 0 && " (ดูวิชาซ้ำข้างล่างก่อน บ่อยครั้งเกินเพราะซ้ำ)"}
              </p>
            )}
            {audit.duplicates.length > 0 && (
              <p className="text-xs text-amber-900">
                ⚠ <strong>วิชาซ้ำ {audit.duplicates.length} วิชา</strong> — มีครูมากกว่าหนึ่งคน
                ที่ยังไม่ได้ระบุว่าสอนร่วมกัน ระบบจะลงให้ทั้งคู่
              </p>
            )}
            {audit.missingTeacher.length > 0 && (
              <p className="text-xs text-amber-900">
                ⚠ <strong>ยังไม่มีครู {audit.missingTeacher.length} วิชา</strong>
              </p>
            )}
            {audit.electiveNoWindow.length > 0 && (
              <p className="text-xs text-amber-900">
                ⚠ <strong>วิชาเสรี {audit.electiveNoWindow.length} วิชา</strong> ที่ห้องนี้เรียน
                แต่ยังไม่มีคาบเสรีของห้องนี้เปิดวิชานั้น — ถ้าไม่ลง ระบบจะลงเป็นคาบเดี่ยวให้แทน
              </p>
            )}
          </div>
        )}

        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-1.5 pr-2 font-semibold">วิชา</th>
              <th className="py-1.5 pr-2 font-semibold">ครู</th>
              <th className="py-1.5 pr-2 font-semibold text-right">คาบ/สัปดาห์</th>
              <th className="py-1.5 font-semibold">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {audit.subjects.map((s) => {
              const bad = s.duplicate || s.noTeacher;
              return (
                <tr key={s.subjectId} className={bad ? "bg-red-50/60" : undefined}>
                  <td className="py-1.5 pr-2">
                    <span className="font-semibold text-gray-800">{subj(s.subjectId)?.code ?? s.subjectId}</span>
                    <span className="text-gray-500"> {subj(s.subjectId)?.name}</span>
                    {s.elective && (
                      <span className="ml-1 px-1 rounded bg-purple-100 text-purple-700 text-[10px]">วิชาเสรี</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-gray-600">
                    {s.teacherIds.length === 0
                      ? <span className="text-red-600">ยังไม่มีครู</span>
                      : s.teacherIds.map(tName).join(" · ")}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-gray-700">{s.weekly}</td>
                  <td className="py-1.5 text-[11px]">
                    {s.coTaught && <span className="text-sky-700">👥 สอนร่วม — นับคาบเดียว</span>}
                    {s.duplicate && (
                      <span className="text-red-700">
                        ซ้ำ {s.rows.length} แถว — ถ้าสอนร่วมกันให้ตั้ง “สอนร่วม” ถ้าไม่ใช่ให้ลบแถวที่เกิน
                      </span>
                    )}
                    {s.elective && audit.electiveNoWindow.includes(s) && (
                      <span className="text-amber-700">ยังไม่อยู่ในคาบเสรีของห้องนี้</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {audit.subjects.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-gray-400">ห้องนี้ยังไม่มีรายวิชา</td></tr>
            )}
          </tbody>
        </table>

        <p className="text-[11px] text-gray-400">
          แก้ไขรายวิชาได้ที่หน้า “ข้อกำหนดคาบเรียน” — ค้นด้วยชื่อห้องหรือรหัสวิชา
        </p>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex justify-end shrink-0">
        <button onClick={onClose}
          className="px-5 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg font-medium">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
