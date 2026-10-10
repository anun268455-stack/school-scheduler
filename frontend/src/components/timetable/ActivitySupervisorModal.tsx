/**
 * ครูผู้ดูแลคาบกิจกรรม — the teachers who run ลูกเสือ, เนตรนารี or ชุมนุม.
 *
 * One list for the activity, not one per classroom. The school picks the
 * twelve teachers who take ลูกเสือ and sorts out between themselves which หมู่
 * each of them walks to; that split changes week to week and is not something
 * a timetable should be inventing. What everyone on this list gets is the
 * hour: it sits in their own timetable, it counts in อัตรากำลัง, and nothing
 * else will be scheduled on top of it.
 */
import { useMemo, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect, teacherOptions } from "../common/SearchableSelect";
import { buildAffinity, teachersOfLevels } from "../../utils/activityRoster";
import { effectiveHomeroomIds } from "../../utils/homeroom";
import type {
  Department, LessonRequirement, StudentGroup, Teacher,
} from "../../types";

interface Props {
  /** The classes this activity is being created for. */
  classes:      StudentGroup[];
  flat:         StudentGroup[];
  teachers:     Teacher[];
  departments:  Department[];
  requirements: LessonRequirement[];
  /** What the activity is called, for the heading. */
  title:        string;
  value:        number[];
  onSave:       (v: number[]) => void;
  onClose:      () => void;
}

export const ActivitySupervisorModal = ({
  classes, flat, teachers, departments, requirements, title, value, onSave, onClose,
}: Props) => {
  const [chosen, setChosen] = useState<number[]>([...value]);
  const [q, setQ] = useState("");

  const affinity = useMemo(
    () => buildAffinity(requirements, flat), [requirements, flat],
  );
  const ids = useMemo(() => classes.map((g) => g.id), [classes]);
  const byId = useMemo(
    () => new Map(teachers.map((t) => [t.id, t])), [teachers],
  );
  const levelNames = useMemo(
    () => [...new Set(classes.map((g) => g.level).filter(Boolean))].join(", "),
    [classes],
  );

  const addAll = (more: number[]) =>
    setChosen((p) => [...new Set([...p, ...more.filter((t) => byId.has(t))])]);

  const ofLevels = () => addAll(teachersOfLevels(ids, flat, affinity));
  const everyone = () => addAll(teachers.map((t) => t.id));
  const advisors = () => addAll(classes.flatMap((g) => effectiveHomeroomIds(g, flat)));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return chosen;
    return chosen.filter((t) => {
      const x = byId.get(t);
      return `${x?.name ?? ""} ${x?.code ?? ""}`.toLowerCase().includes(needle);
    });
  }, [chosen, q, byId]);

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl">
      <div className="px-5 py-3 border-b bg-teal-50">
        <h3 className="font-bold text-gray-800">👩‍🏫 ครูผู้ดูแลคาบกิจกรรม</h3>
        <p className="text-xs text-gray-600 mt-0.5">
          {title} · {classes.length} ห้อง · เลือกครูแล้ว <strong>{chosen.length}</strong> คน
        </p>
      </div>

      <div className="px-5 py-3 border-b bg-gray-50">
        <p className="text-xs text-gray-600 mb-2 leading-relaxed">
          เลือกรายชื่อครูที่รับผิดชอบกิจกรรมนี้ —{" "}
          <strong>ไม่ต้องระบุว่าใครดูห้องไหน</strong> ครูไปแบ่งกันเองได้
          <br/>ครูทุกคนในรายชื่อจะมีคาบนี้ในตารางสอนของตัวเอง
          นับในอัตรากำลัง และระบบจะไม่จัดวิชาอื่นให้ในคาบนี้
        </p>
        <div className="flex flex-wrap gap-2">
          <Bulk onClick={ofLevels}>
            👥 ครูที่สอน{levelNames ? ` ${levelNames}` : "ระดับชั้นนั้น"}
          </Bulk>
          <Bulk onClick={everyone}>🏫 ครูทั้งหมดในโรงเรียน ({teachers.length} คน)</Bulk>
          <Bulk onClick={advisors}>🧑‍🏫 ครูประจำชั้นของห้องที่เลือก</Bulk>
          <Bulk onClick={() => setChosen([])} danger>✕ ล้างทั้งหมด</Bulk>
        </div>
      </div>

      <div className="px-5 py-3 border-b">
        <SearchableSelect
          value=""
          onChange={(v) => v && addAll([Number(v)])}
          options={teacherOptions(teachers.filter((t) => !chosen.includes(t.id)), departments)}
          placeholder="+ เพิ่มครูทีละคน"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {chosen.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            ยังไม่ได้เลือกครู — กดปุ่มด้านบนเพื่อเพิ่มทีเดียวทั้งกลุ่ม หรือเพิ่มทีละคน
          </p>
        ) : (
          <>
            {chosen.length > 12 && (
              <input
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2 outline-none focus:ring-1 focus:ring-teal-500"
                placeholder="ค้นหาในรายชื่อที่เลือกไว้…"
                value={q} onChange={(e) => setQ(e.target.value)} />
            )}
            <div className="flex flex-wrap gap-1.5">
              {shown.map((t) => (
                <span key={t}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-teal-200 bg-teal-50 text-teal-800 text-xs">
                  {byId.get(t)?.code && (
                    <span className="text-teal-500 font-mono">{byId.get(t)?.code}</span>
                  )}
                  {byId.get(t)?.name ?? t}
                  <button onClick={() => setChosen((p) => p.filter((x) => x !== t))}
                    className="text-gray-400 hover:text-red-600 leading-none">✕</button>
                </span>
              ))}
            </div>
            {q && shown.length === 0 && (
              <p className="text-xs text-gray-400 py-3">ไม่พบครูที่ค้นหาในรายชื่อนี้</p>
            )}
          </>
        )}
      </div>

      <div className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
        <button onClick={onClose}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-100">
          ยกเลิก
        </button>
        <button onClick={() => { onSave(chosen); onClose(); }}
          className="px-4 py-1.5 text-sm bg-teal-600 text-white rounded hover:bg-teal-700 font-medium">
          ใช้รายชื่อนี้ ({chosen.length} คน)
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
