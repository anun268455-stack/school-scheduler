/**
 * ตรวจคาบจริง — what the subgroups ended up doing, hour by hour.
 *
 * One row per hour in which any subgroup has a lesson, one column per
 * subgroup, so a glance down the page answers "which of these are paired and
 * which stand alone". A blank cell is just blank: the school was explicit
 * that ค may have a lesson while ก and ข are free, and that this is a thing
 * to see rather than a thing to fix.
 *
 * What is coloured is only what cannot be taught: the whole class booked over
 * its own subgroups, two subgroups in one room, one teacher in two of them.
 */
import { useMemo, useState } from "react";
import { useTimetableStore } from "../../store/timetableStore";
import { auditSubgroups, auditAll, cellHasProblem } from "../../utils/subgroupAudit";
import { DAYS, periodLabel } from "../../types";
import { slotLabel } from "../../utils/teacherSlots";

interface Props {
  /** Limit to one class, or leave out for every split class. */
  parentId?: number | null;
}

export const SubgroupAuditView = ({ parentId }: Props) => {
  const { groups, slots, periods } = useTimetableStore();
  const [onlyProblems, setOnlyProblems] = useState(false);

  const reports = useMemo(() => {
    if (parentId != null) {
      const one = auditSubgroups(groups, slots, parentId);
      return one ? [one] : [];
    }
    return auditAll(groups, slots);
  }, [groups, slots, parentId]);

  if (reports.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-8 text-center">
        ยังไม่มีห้องย่อยที่มีคาบในตาราง — กดสร้างตารางก่อน แล้วกลับมาดูที่นี่
      </p>
    );
  }

  const totals = reports.reduce(
    (a, r) => ({
      full: a.full + r.fullCount,
      partial: a.partial + r.partialCount,
      problem: a.problem + r.problemCount,
    }),
    { full: 0, partial: 0, problem: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="text-gray-600">
          ครบทุกห้อง <strong className="text-emerald-700">{totals.full}</strong> คาบ
        </span>
        <span className="text-gray-600">
          · บางห้องว่าง <strong className="text-gray-800">{totals.partial}</strong> คาบ
          <span className="text-gray-400"> (ปกติ ไม่ใช่ข้อผิดพลาด)</span>
        </span>
        {totals.problem > 0 ? (
          <span className="text-red-700">· ⚠ ต้องแก้ <strong>{totals.problem}</strong> คาบ</span>
        ) : (
          <span className="text-emerald-700">· ไม่พบคาบที่สอนไม่ได้</span>
        )}
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-gray-600">
          <input type="checkbox" className="w-3.5 h-3.5 accent-red-600"
            checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          แสดงเฉพาะคาบที่มีปัญหา
        </label>
      </div>

      {reports.map((r) => {
        const rows = onlyProblems ? r.cells.filter(cellHasProblem) : r.cells;
        return (
          <div key={r.parentId} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-800">{r.parentName}</span>
              <span className="text-[11px] text-gray-500">
                {r.subgroups.map((g) => g.name).join(" · ")}
              </span>
              <span className="ml-auto text-[11px] text-gray-500">
                {r.cells.length} คาบที่มีห้องย่อยเรียน
                {r.problemCount > 0 && (
                  <span className="text-red-700 font-semibold"> · ⚠ {r.problemCount}</span>
                )}
              </span>
            </div>

            {rows.length === 0 ? (
              <p className="text-xs text-gray-400 py-5 text-center">
                {onlyProblems ? "ชั้นนี้ไม่มีคาบที่มีปัญหา" : "ยังไม่มีคาบของห้องย่อยในตาราง"}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-white">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 border-b w-32">
                      วัน / คาบ
                    </th>
                    {r.subgroups.map((g) => (
                      <th key={g.id} className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 border-b">
                        {g.name}
                      </th>
                    ))}
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 border-b w-40">
                      หมายเหตุ
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((c) => {
                    const bad = cellHasProblem(c);
                    return (
                      <tr key={`${c.day}-${c.period}`} className={bad ? "bg-red-50/60" : undefined}>
                        <td className="px-3 py-1.5 text-xs text-gray-700 whitespace-nowrap">
                          {DAYS[c.day]} · {periodLabel(c.period, periods)}
                        </td>
                        {c.entries.map((e) => (
                          <td key={e.groupId} className="px-3 py-1.5 text-xs">
                            {e.slot ? (
                              <>
                                <span className="font-medium text-gray-800">{slotLabel(e.slot)}</span>
                                <span className="text-gray-400">
                                  {e.slot.teacher_name ? ` · ${e.slot.teacher_name}` : ""}
                                  {e.slot.room_name ? ` · ${e.slot.room_name}` : ""}
                                </span>
                              </>
                            ) : (
                              <span className="text-gray-300">ว่าง</span>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-[11px]">
                          {c.parentSlot && (
                            <div className="text-red-700">
                              ⚠ {r.parentName} เรียน {slotLabel(c.parentSlot)} คาบนี้ด้วย
                            </div>
                          )}
                          {c.roomClashes.map((x) => (
                            <div key={x} className="text-red-700">
                              ⚠ ห้อง {x} มีสองคาบพร้อมกัน
                            </div>
                          ))}
                          {c.teacherClashes.map((x) => (
                            <div key={x} className="text-red-700">
                              ⚠ {x} ต้องสอนสองคาบพร้อมกัน
                            </div>
                          ))}
                          {c.roomSplits.map((x) => (
                            <div key={`sp-${x}`} className="text-red-700">
                              ⚠ {x} สอนห้องย่อยพร้อมกันแต่ถูกแยกคนละห้องเรียน
                            </div>
                          ))}
                          {/* Which subgroup is missing, by name. "เรียน 2/3
                              ห้อง" tells the school that something is wrong
                              but not which room to go and look at, and the
                              one that is missing is the whole question. */}
                          {!bad && c.busy < r.subgroups.length && (
                            <span className="text-amber-700">
                              ขาด {c.entries
                                .filter((e) => !e.slot)
                                .map((e) => e.groupName)
                                .join(", ")}
                              <span className="text-gray-400">
                                {" "}— เรียน {c.busy}/{r.subgroups.length} ห้อง
                              </span>
                            </span>
                          )}
                          {!bad && c.busy === r.subgroups.length && (
                            <span className="text-emerald-700">ครบทุกห้อง</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <p className="text-[11px] text-gray-400 leading-relaxed">
        ห้องที่ขึ้นว่า “ว่าง” ไม่ใช่ข้อผิดพลาด — ห้องย่อยไม่จำเป็นต้องมีคู่ทุกคาบ ·
        ห้องย่อยที่เรียน<strong>วิชาเดียวกันกับครูคนเดียวกัน</strong>ถือเป็นคาบเดียวกัน
        นั่งห้องเดียวกันได้ ไม่ใช่ข้อผิดพลาดเช่นกัน ·
        สีแดงคือคาบที่สอนจริงไม่ได้เท่านั้น (ห้องแม่เรียนทับ · ห้องเดียวมีสองคาบ ·
        ครูต้องสอนสองคาบพร้อมกัน)
      </p>
    </div>
  );
};
