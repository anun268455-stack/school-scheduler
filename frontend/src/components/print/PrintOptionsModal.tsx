/**
 * PrintOptionsModal — decide what goes on paper before printing.
 *
 * Choose class or teacher timetables, tick exactly which ones, set the order
 * (by name, by กลุ่มสาระ, or by teacher code) and how many fit on one A4 sheet.
 */
import React, { useMemo, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import clsx from "clsx";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups, compareNames } from "../../utils/groupHierarchy";
import type { PrintOptions, PrintMode, PrintSort } from "./PrintView";

/** Sentinel id that matches nothing — "clear" without meaning "print everything". */
const NONE_SELECTED = -1;

interface Props {
  value:   PrintOptions;
  onChange: (o: PrintOptions) => void;
  onConfirm: (o: PrintOptions) => void;
  onClose: () => void;
}

export const PrintOptionsModal: React.FC<Props> = ({ value, onChange, onConfirm, onClose }) => {
  const { groups, teachers, departments } = useTimetableStore();
  const [opt, setOpt]       = useState<PrintOptions>(value);
  const [search, setSearch] = useState("");

  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const deptName = (id: number | null | undefined) =>
    departments.find((d) => d.id === id)?.name ?? "ไม่ระบุกลุ่มสาระ";

  // The list of things you can tick, already in the chosen order.
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (opt.mode !== "group") {
      return [...teachers]
        .sort((a, b) => {
          if (opt.sort === "code") return (a.code ?? "").localeCompare(b.code ?? "") || compareNames(a.name, b.name);
          if (opt.sort === "department") return deptName(a.department_id).localeCompare(deptName(b.department_id)) || compareNames(a.name, b.name);
          return compareNames(a.name, b.name);
        })
        .filter((t) => !q || t.name.toLowerCase().includes(q) || (t.code ?? "").toLowerCase().includes(q))
        .map((t) => ({ id: t.id, label: t.name, hint: t.code ?? "", group: deptName(t.department_id) }));
    }
    return [...flat]
      .sort((a, b) => compareNames(a.level ?? "", b.level ?? "") || compareNames(a.name, b.name))
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .map((g) => ({ id: g.id, label: g.name, hint: `${g.size} คน`, group: g.level ?? "ไม่ระบุระดับ" }));
  }, [opt.mode, opt.sort, teachers, flat, search, departments]);

  // Every id that exists, ignoring the search box, so counts stay honest.
  const universe = useMemo(
    () => (opt.mode !== "group" ? teachers.map((t) => t.id) : flat.map((g) => g.id)),
    [opt.mode, teachers, flat],
  );
  const allIds   = universe;
  const picked   = new Set(opt.selectedIds);
  const allOn    = opt.selectedIds.length === 0;   // empty means "everything"
  const countSel = allOn ? universe.length : opt.selectedIds.filter((id) => universe.includes(id)).length;

  const set = (patch: Partial<PrintOptions>) => {
    const next = { ...opt, ...patch };
    setOpt(next);
    onChange(next);
  };

  const toggle = (id: number) => {
    // Materialise "all" into a real list the first time something is unticked.
    const base = allOn ? allIds : opt.selectedIds;
    set({ selectedIds: base.includes(id) ? base.filter((x) => x !== id) : [...base, id] });
  };

  const sheets = Math.ceil(countSel / opt.perPage);

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl">

        <div className="flex items-center gap-3 bg-gray-800 px-5 py-4 shrink-0">
          <span className="text-2xl">🖨</span>
          <div className="flex-1">
            <h2 className="text-white font-bold text-base leading-tight">ตัวเลือกการพิมพ์</h2>
            <p className="text-gray-300 text-xs mt-0.5">กระดาษ A4 แนวตั้ง · เลือกได้ว่าจะพิมพ์อะไรบ้าง</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* What to print */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1.5">พิมพ์อะไร</p>
            <div className="flex gap-2">
              {([["group", "👥 ตารางเรียน (รายห้อง)"], ["teacher", "👨‍🏫 ตารางสอน (รายครู)"],
                 ["workload", "📋 อัตรากำลัง (ตามกลุ่มสาระ)"]] as [PrintMode, string][]).map(([k, label]) => (
                <button key={k}
                  onClick={() => set({ mode: k, selectedIds: [], sort: k === "group" ? "name" : "code" })}
                  className={clsx(
                    "flex-1 px-3 py-2 text-sm rounded-lg border transition-colors",
                    opt.mode === k ? "border-gray-800 bg-gray-800 text-white font-medium" : "border-gray-300 hover:border-gray-500",
                  )}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Order + sheets */}
          <div className="grid grid-cols-2 gap-3">
            <div className={opt.mode === "workload" ? "opacity-40 pointer-events-none" : ""}>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">
                เรียงลำดับ{opt.mode === "workload" && " (อัตรากำลังเรียงตามรหัสในกลุ่มสาระ)"}
              </p>
              <select className="w-full border border-gray-400 bg-white text-gray-900 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                value={opt.sort} onChange={(e) => set({ sort: e.target.value as PrintSort })}>
                <option value="name">ตามชื่อ</option>
                {opt.mode !== "group" && <option value="code">ตามรหัสประจำตัวครู</option>}
                {opt.mode !== "group" && <option value="department">ตามกลุ่มสาระฯ</option>}
              </select>
            </div>
            <div className={opt.mode === "workload" ? "opacity-40 pointer-events-none" : ""}>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">
                จำนวนต่อแผ่น A4{opt.mode === "workload" && " (อัตรากำลังจัดเองตามกลุ่มสาระ)"}
              </p>
              <select className="w-full border border-gray-400 bg-white text-gray-900 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                value={opt.perPage} onChange={(e) => set({ perPage: Number(e.target.value) as 1 | 2 })}>
                <option value={2}>2 ตาราง/แผ่น (ประหยัดกระดาษ)</option>
                <option value={1}>1 ตาราง/แผ่น (ตัวใหญ่ อ่านง่าย)</option>
              </select>
            </div>
          </div>

          {/* นับคาบกิจกรรมไหม — อัตรากำลังเท่านั้น */}
          {opt.mode === "workload" && (
            <label className="flex items-start gap-2 bg-teal-50 border border-teal-200 rounded-lg p-2.5 cursor-pointer">
              <input type="checkbox" className="mt-0.5"
                checked={opt.countActivities !== false}
                onChange={(e) => set({ countActivities: e.target.checked })} />
              <span className="text-xs text-teal-900 leading-relaxed">
                <strong>นับคาบกิจกรรมด้วย</strong> — ลูกเสือ เนตรนารี ชุมนุม และคาบกิจกรรมอื่นที่ตั้งไว้
                <br/>
                <span className="text-teal-700/80">
                  {opt.countActivities !== false
                    ? "คาบที่ครูไปคุมกิจกรรมจะรวมอยู่ในจำนวนคาบ/สัปดาห์ของครูแต่ละคน"
                    : "จะนับเฉพาะคาบสอนรายวิชา — หัวกระดาษจะระบุว่า “ไม่นับคาบกิจกรรม”"}
                </span>
              </span>
            </label>
          )}

          {/* Pick which ones */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-xs font-semibold text-gray-700">
                เลือก{opt.mode === "group" ? "ห้องเรียน" : "ครู"}
              </p>
              <span className="text-[11px] text-gray-600">เลือกแล้ว {countSel} / {allIds.length}</span>
              <div className="ml-auto flex gap-2">
                <button onClick={() => set({ selectedIds: [] })} className="text-[11px] text-blue-600 hover:underline">เลือกทั้งหมด</button>
                <button onClick={() => set({ selectedIds: [NONE_SELECTED] })} className="text-[11px] text-gray-500 hover:underline">ล้าง</button>
              </div>
            </div>
            <input
              className="w-full border border-gray-400 bg-white text-gray-900 placeholder-gray-500 rounded px-2 py-1.5 text-sm mb-2 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder={opt.mode === "group" ? "ค้นหาห้องเรียน" : "ค้นหาชื่อครู หรือรหัสครู"}
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-gray-50">
              {items.length === 0 && <p className="text-xs text-gray-400 text-center py-6">ไม่พบรายการ</p>}
              {items.map((it, i) => {
                const on = allOn || picked.has(it.id);
                const newGroup = it.group !== items[i - 1]?.group;
                return (
                  <React.Fragment key={it.id}>
                    {newGroup && (
                      <p className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-semibold text-gray-600 bg-gray-100">{it.group}</p>
                    )}
                    <label className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" className="w-3.5 h-3.5 accent-gray-800"
                        checked={on} onChange={() => toggle(it.id)} />
                      <span className="text-sm text-gray-800 flex-1">{it.label}</span>
                      <span className="text-[11px] text-gray-600 font-mono">{it.hint}</span>
                    </label>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
          <p className="text-[11px] text-gray-500 flex-1">
            {opt.mode === "workload"
              ? <>พิมพ์ <strong>{countSel}</strong> คน แยกเป็นตารางตามกลุ่มสาระ (ขึ้นหน้าใหม่ทุกกลุ่มสาระ)</>
              : <>จะได้ <strong>{sheets}</strong> แผ่น ({countSel} ตาราง × {opt.perPage} ต่อแผ่น)</>}
          </p>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg font-medium">ยกเลิก</button>
          <button
            onClick={() => onConfirm(opt)}
            disabled={countSel === 0}
            className="px-5 py-2 text-sm bg-gray-800 text-white rounded-lg font-semibold hover:bg-gray-900 disabled:opacity-40"
          >
            🖨 พิมพ์
          </button>
        </div>
    </ModalShell>
  );
};
