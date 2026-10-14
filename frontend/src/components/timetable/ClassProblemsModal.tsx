/**
 * ปัญหาของห้องนี้ — ทุกอย่างที่ยังค้างอยู่ในตารางที่กำลังดูอยู่
 *
 * "ถ้าชนหรือมีปัญหาอะไรก็มีไอคอนปุ่มด้านล่างเด่นออกมาให้กด ว่ามีปัญหาตรงไหน"
 *
 * รายการ "วิชาที่ลงไม่ได้" เดิมเป็นของทั้งโรงเรียน ต้องเลื่อนหา ส่วนนี่คือของ
 * ห้องที่เปิดอยู่ตรงหน้าเท่านั้น และบอกเป็นที่ๆ ไป: วันไหน คาบไหน ติดอะไร
 * แล้วต้องทำอะไรต่อ
 */
import { useMemo } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import { DAYS } from "../../types";
import type { LessonRequirement, StudentGroup, Subject, TimetableSlot } from "../../types";
import type { SlotProblem } from "../../utils/slotProblems";
import { slotLabel } from "../../utils/teacherSlots";

export interface ShortRow {
  requirement: LessonRequirement;
  placed: number;
}

interface Props {
  title:     string;
  problems:  SlotProblem[];
  short:     ShortRow[];
  subjects:  Subject[];
  groups:    StudentGroup[];
  onClose:   () => void;
  /** พาไปที่คาบนั้นในตาราง */
  onGoto?:   (s: TimetableSlot) => void;
}

const KIND_LABEL: Record<string, string> = {
  no_room:       "ไม่มีห้องเรียน",
  teacher_clash: "ครูติดสอนห้องอื่น",
  forced:        "ระบบวางไว้ให้เห็นก่อน",
};

export const ClassProblemsModal: React.FC<Props> = ({
  title, problems, short, subjects, groups, onClose, onGoto,
}) => {
  const sName = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const gName = useMemo(() => {
    const m = new Map<number, string>();
    const walk = (list: StudentGroup[]) => {
      for (const g of list) { m.set(g.id, g.name); walk(g.children ?? []); }
    };
    walk(groups);
    return m;
  }, [groups]);

  const byKind = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of problems) for (const k of p.kinds) m[k] = (m[k] ?? 0) + 1;
    return m;
  }, [problems]);

  const nothing = !problems.length && !short.length;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl">
      <div className={clsx("px-5 py-3 text-white flex items-center justify-between",
        nothing ? "bg-emerald-600" : "bg-gradient-to-r from-rose-600 to-rose-500")}>
        <div>
          <h2 className="font-bold">
            {nothing ? `${title} — เรียบร้อยดี` : `${title} — มีจุดที่ต้องแก้`}
          </h2>
          <p className="text-[11px] opacity-90">
            {nothing
              ? "ทุกคาบมีห้อง ไม่มีครูชนกัน และลงครบตามแผน"
              : [
                  problems.length ? `คาบที่ยังไม่เรียบร้อย ${problems.length} คาบ` : "",
                  short.length ? `วิชาที่ยังลงไม่ครบ ${short.length} รายการ` : "",
                ].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
      </div>

      {!nothing && Object.keys(byKind).length > 0 && (
        <div className="px-5 py-2 border-b bg-rose-50 flex flex-wrap gap-2 text-[11px]">
          {Object.entries(byKind).map(([k, n]) => (
            <span key={k} className="px-2 py-0.5 rounded-full bg-white border border-rose-200 text-rose-800 font-semibold">
              {KIND_LABEL[k] ?? k} {n}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto px-5 py-3 space-y-4">
        {nothing && (
          <p className="text-sm text-gray-500 py-6 text-center">
            ไม่มีอะไรค้างอยู่ในห้องนี้
          </p>
        )}

        {problems.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              คาบที่ลงไว้แล้วแต่ยังไม่เรียบร้อย
            </h3>
            <ul className="space-y-1.5">
              {problems.map((p) => (
                <li key={p.slot.id}
                  className="border border-rose-200 bg-rose-50/60 rounded px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-rose-900">
                      {DAYS[p.slot.day] ?? `วัน ${p.slot.day}`} · คาบ {p.slot.period}
                    </span>
                    <span className="font-semibold text-gray-800">{slotLabel(p.slot)}</span>
                    <span className="text-gray-500">
                      {sName.get(p.slot.subject_id ?? -1)?.name ?? ""}
                    </span>
                    {p.slot.group_name && (
                      <span className="text-gray-400">· {p.slot.group_name}</span>
                    )}
                    {p.slot.teacher_name && (
                      <span className="text-gray-500">· {p.slot.teacher_name}</span>
                    )}
                    {onGoto && (
                      <button onClick={() => { onGoto(p.slot); onClose(); }}
                        className="ml-auto px-2 py-0.5 rounded border border-rose-300 text-rose-700 hover:bg-white font-semibold">
                        ไปที่คาบนี้
                      </button>
                    )}
                  </div>
                  <div className="text-rose-800 mt-0.5">⚠ {p.text}</div>
                  <div className="text-gray-500">→ {p.fix}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {short.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              วิชาที่ยังลงไม่ครบตามแผน
            </h3>
            <ul className="space-y-1.5">
              {short.map(({ requirement: r, placed }) => (
                <li key={r.id}
                  className="border border-amber-200 bg-amber-50/60 rounded px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-amber-900">
                      {sName.get(r.subject_id)?.code ?? `#${r.subject_id}`}
                    </span>
                    <span className="text-gray-700">{sName.get(r.subject_id)?.name ?? ""}</span>
                    <span className="text-gray-400">· {gName.get(r.group_id) ?? r.group_id}</span>
                    <span className="ml-auto font-semibold text-amber-800">
                      ลงได้ {placed}/{r.weekly_count} คาบ
                    </span>
                  </div>
                  <div className="text-gray-500">
                    → เปิดช่องว่างให้ห้องนี้ หรือกดสร้างตารางใหม่อีกครั้ง
                    {r.teacher_id ? "" : " · แถวนี้ยังไม่ได้เลือกครู"}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t bg-gray-50 flex items-center gap-3">
        <p className="text-[11px] text-gray-500 flex-1 leading-relaxed">
          คาบกรอบแดงยังอยู่ในตารางตามปกติ ลากย้ายได้ เปลี่ยนห้อง/ครูได้ —
          พอแก้เรียบร้อย กรอบแดงจะหายไปเอง
        </p>
        <button onClick={onClose}
          className="px-4 py-2 rounded bg-gray-800 text-white text-xs font-semibold hover:bg-gray-700">
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
