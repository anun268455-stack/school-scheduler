/**
 * ครูผู้ดูแลคาบกิจกรรม — who stands with which class during ลูกเสือ, เนตรนารี
 * or ชุมนุม.
 *
 * The school thinks of this as "ครูทั้งหมด" or "ครูที่สอน ม.1" — a pool of
 * people on duty, not a name typed per class. So the buttons take the pool and
 * deal it out across the chosen classes, and the lists below stay editable,
 * because the real roster always has exceptions in it.
 *
 * One teacher, one class: a name in two rows of the same period is a teacher
 * in two places, so it is shown in red here rather than discovered on the
 * printed sheet.
 */
import { useMemo, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect, teacherOptions } from "../common/SearchableSelect";
import {
  buildAffinity, spreadTeachers, teachersOfLevels, doubleBooked, nameOf,
} from "../../utils/activityRoster";
import { effectiveHomeroomIds } from "../../utils/homeroom";
import type {
  Department, LessonRequirement, StudentGroup, Teacher,
} from "../../types";

interface Props {
  /** The classes this activity is being created for, in display order. */
  classes:      StudentGroup[];
  flat:         StudentGroup[];
  teachers:     Teacher[];
  departments:  Department[];
  requirements: LessonRequirement[];
  /** What the activity is called, for the heading. */
  title:        string;
  value:        Record<number, number[]>;
  onSave:       (v: Record<number, number[]>) => void;
  onClose:      () => void;
}

export const ActivitySupervisorModal = ({
  classes, flat, teachers, departments, requirements, title, value, onSave, onClose,
}: Props) => {
  const [roster, setRoster] = useState<Map<number, number[]>>(
    () => new Map(classes.map((g) => [g.id, [...(value[g.id] ?? [])]])),
  );

  const affinity = useMemo(
    () => buildAffinity(requirements, flat), [requirements, flat],
  );
  const ids = useMemo(() => classes.map((g) => g.id), [classes]);
  const clashes = useMemo(() => doubleBooked(roster), [roster]);
  const total = useMemo(
    () => [...roster.values()].reduce((n, v) => n + v.length, 0), [roster],
  );

  const fill = (next: Map<number, number[]>) => setRoster(new Map(next));

  const byLevel = () => fill(spreadTeachers(ids, teachersOfLevels(ids, flat, affinity), affinity));
  const everyone = () => fill(spreadTeachers(ids, teachers.map((t) => t.id), affinity));
  const homeroom = () =>
    fill(new Map(classes.map((g) => [g.id, effectiveHomeroomIds(g, flat)])));
  const clear = () => fill(new Map(ids.map((i) => [i, []])));

  const add = (gid: number, tid: string) => {
    if (!tid) return;
    const n = Number(tid);
    setRoster((prev) => {
      const next = new Map(prev);
      const cur = next.get(gid) ?? [];
      if (!cur.includes(n)) next.set(gid, [...cur, n]);
      return next;
    });
  };
  const drop = (gid: number, tid: number) =>
    setRoster((prev) => {
      const next = new Map(prev);
      next.set(gid, (next.get(gid) ?? []).filter((x) => x !== tid));
      return next;
    });

  const save = () => {
    const out: Record<number, number[]> = {};
    for (const [gid, v] of roster) if (v.length) out[gid] = v;
    onSave(out);
    onClose();
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-4xl">
      <div className="px-5 py-3 border-b bg-teal-50">
        <h3 className="font-bold text-gray-800">👩‍🏫 ครูผู้ดูแลคาบกิจกรรม</h3>
        <p className="text-xs text-gray-600 mt-0.5">
          {title} · {classes.length} ห้อง · เลือกครูแล้ว {total} คน
        </p>
      </div>

      <div className="px-5 py-3 border-b bg-gray-50">
        <p className="text-xs text-gray-600 mb-2">
          เลือกทีเดียวทั้งหมด แล้วค่อยแก้ทีละห้องด้านล่างได้ —
          ระบบจะ<strong>กระจายครูไปห้องละไม่กี่คน</strong> ไม่ใส่ครูคนเดียวกันซ้ำหลายห้อง
          เพราะครู 1 คนยืนได้ทีละห้องเท่านั้น
        </p>
        <div className="flex flex-wrap gap-2">
          <Bulk onClick={byLevel}>👥 ครูที่สอนระดับชั้นนั้น</Bulk>
          <Bulk onClick={everyone}>🏫 ครูทั้งหมดในโรงเรียน ({teachers.length} คน)</Bulk>
          <Bulk onClick={homeroom}>👩‍🏫 ครูประจำชั้นของแต่ละห้อง</Bulk>
          <Bulk onClick={clear} danger>✕ ล้างทั้งหมด</Bulk>
        </div>
      </div>

      {clashes.size > 0 && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-800">
          ⚠️ ครูที่ถูกใส่ไว้มากกว่า 1 ห้องในคาบเดียวกัน —{" "}
          {[...clashes.keys()].map((t) => nameOf(teachers, t)).join(", ")} · ต้องแก้ก่อนบันทึก
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        {classes.map((g) => {
          const mine = roster.get(g.id) ?? [];
          return (
            <div key={g.id} className="flex items-start gap-3 border-b border-gray-100 pb-2">
              <span className="w-20 shrink-0 text-sm font-medium text-teal-700 pt-1.5">{g.name}</span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-1 mb-1">
                  {mine.length === 0 && (
                    <span className="text-xs text-gray-300 py-1">– ยังไม่มีครูผู้ดูแล –</span>
                  )}
                  {mine.map((t) => (
                    <span key={t}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${
                        clashes.has(t)
                          ? "bg-red-50 border-red-300 text-red-700"
                          : "bg-teal-50 border-teal-200 text-teal-800"}`}>
                      {nameOf(teachers, t)}
                      <button onClick={() => drop(g.id, t)}
                        className="text-gray-400 hover:text-red-600 leading-none">✕</button>
                    </span>
                  ))}
                </div>
                <SearchableSelect
                  value=""
                  onChange={(v) => add(g.id, v)}
                  options={teacherOptions(teachers.filter((t) => !mine.includes(t.id)), departments)}
                  placeholder="+ เพิ่มครู"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
        <button onClick={onClose}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-100">
          ยกเลิก
        </button>
        <button onClick={save} disabled={clashes.size > 0}
          className="px-4 py-1.5 text-sm bg-teal-600 text-white rounded hover:bg-teal-700 font-medium disabled:opacity-40">
          ใช้รายชื่อนี้
        </button>
      </div>
    </ModalShell>
  );
};

const Bulk = ({ onClick, children, danger }: {
  onClick: () => void; children: React.ReactNode; danger?: boolean;
}) => (
  <button onClick={onClick}
    className={`px-2.5 py-1 text-xs rounded border font-medium ${
      danger
        ? "bg-white border-gray-300 text-gray-600 hover:bg-gray-100"
        : "bg-white border-teal-300 text-teal-700 hover:bg-teal-50"}`}>
    {children}
  </button>
);
