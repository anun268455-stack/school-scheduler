/**
 * เทียบแผนการสอนของห้อง กับหลักสูตรที่ผูกไว้ — แล้วเลือกว่าจะปรับอะไรบ้าง
 *
 * สามทิศทาง: ➕ เพิ่มวิชาที่หลักสูตรมีแต่ห้องยังไม่มี · ✏️ แก้จำนวนคาบที่ต่างกัน ·
 * ➖ เอาวิชาที่หลักสูตรไม่มีออก สองอย่างแรกติ๊กไว้ให้ก่อน ส่วน ➖ ไม่ติ๊ก เพราะการ
 * เอาออกคือการลบแถวในแผนการสอนจริงๆ — ทางเดียวที่ย้อนกลับไม่ได้ จึงต้องเลือกเอง
 *
 * คำเตือน (สีเหลือง) ติ๊กไม่ได้: เป็นเรื่องที่ระบบไม่กล้าตัดสินแทน บอกเหตุผลไว้
 * ให้คนดู
 */
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { flip } from "../../utils/flip";

interface Props {
  groupId:   number;
  groupName: string;
  onClose:   () => void;
  /** Called after a successful apply, so whoever opened this can re-read its own numbers. */
  onApplied?: () => void;
  /** Raise above another dialog when opened from on top of one. */
  z?: string;
}

type Kind = "add" | "fix" | "remove";
type Pick = Record<Kind, Set<number>>;

const KINDS: { key: Kind; icon: string; label: string; box: string; head: string }[] = [
  { key: "add",    icon: "➕", label: "เพิ่ม",    box: "border-emerald-200", head: "bg-emerald-50 text-emerald-900" },
  { key: "fix",    icon: "✏️", label: "แก้คาบ",  box: "border-sky-200",     head: "bg-sky-50 text-sky-900" },
  { key: "remove", icon: "➖", label: "เอาออก",  box: "border-rose-200",    head: "bg-rose-50 text-rose-900" },
];

/** ➕ and ✏️ ticked, ➖ not — see the header. */
const defaults = (d: api.CurriculumDiff): Pick => ({
  add:    new Set(d.add.map((e) => e.subject_id)),
  fix:    new Set(d.fix.map((e) => e.subject_id)),
  remove: new Set<number>(),
});

const detail = (k: Kind, e: api.CurriculumDiffEntry) =>
  k === "add" ? `เพิ่ม ${e.want} คาบ/สัปดาห์`
    : k === "fix" ? `${e.have} → ${e.want} คาบ/สัปดาห์`
    : `มีอยู่ ${e.have} คาบ/สัปดาห์ · หลักสูตรไม่มีวิชานี้`;

export const CurriculumDiffModal: React.FC<Props> = ({ groupId, groupName, onClose, onApplied, z }) => {
  const loadSlots = useTimetableStore((s) => s.loadSlots);
  const [diff, setDiff] = useState<api.CurriculumDiff | null>(null);
  const [pick, setPick] = useState<Pick>({ add: new Set(), fix: new Set(), remove: new Set() });
  const [err, setErr]   = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<api.CurriculumApplyResult | null>(null);

  const load = useCallback(() => {
    setErr(null);
    return api.fetchCurriculumDiff(groupId)
      .then((d) => { setDiff(d); setPick(defaults(d)); })
      .catch((e) => setErr(api.errorDetail(e, "เทียบไม่สำเร็จ — ลองใหม่อีกครั้ง")));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (k: Kind, id: number) => setPick((p) => ({ ...p, [k]: flip(p[k], id) }));
  const toggleAll = (k: Kind) => {
    if (!diff) return;
    const ids = diff[k].map((e) => e.subject_id);
    setPick((p) => ({ ...p, [k]: ids.every((i) => p[k].has(i)) ? new Set<number>() : new Set(ids) }));
  };

  const n = { add: pick.add.size, fix: pick.fix.size, remove: pick.remove.size };
  const picked = n.add + n.fix + n.remove;

  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      setDone(await api.applyCurriculumDiff(groupId, {
        add: [...pick.add], fix: [...pick.fix], remove: [...pick.remove],
      }));
    } catch (e) {
      setErr(api.errorDetail(e, "ปรับแผนการสอนไม่สำเร็จ — ลองใหม่อีกครั้ง"));
      setBusy(false);
      return;
    }
    // It went through. From here a failure is only about refreshing what is
    // on screen, and must not read as "the apply failed".
    await load();
    try {
      // The plan changed under the rest of the app — bring its copy up to date.
      useTimetableStore.setState({ requirements: await api.fetchRequirements() });
      await loadSlots();
    } catch {
      setErr("ปรับแล้ว แต่โหลดแผนการสอนใหม่ไม่สำเร็จ — รีเฟรชหน้าเพื่อให้เห็นตัวเลขล่าสุด");
    }
    if (onApplied) onApplied();
    setBusy(false);
  };

  const nothing = !!diff && !!diff.curriculum
    && diff.add.length + diff.fix.length + diff.remove.length + diff.warn.length === 0;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl" tall z={z}>
      <div className="px-5 py-3 border-b bg-gradient-to-r from-indigo-600 to-indigo-500 text-white flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="font-bold truncate">เทียบกับหลักสูตร — {groupName}</h2>
          <p className="text-[11px] opacity-90 truncate">
            {diff?.curriculum
              ? <>หลักสูตร “{diff.curriculum.name}” เทียบกับแผนการสอนของห้องนี้ตอนนี้</>
              : "แผนการสอนของห้องนี้ เทียบกับหลักสูตรที่ผูกไว้"}
          </p>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
      </div>

      <div className="flex-1 overflow-auto px-5 py-3 space-y-3">
        {err && <div className="text-rose-700 text-sm bg-rose-50 rounded px-3 py-2">{err}</div>}
        {!diff && !err && <p className="text-sm text-gray-400">กำลังเทียบ…</p>}

        {done && (
          <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-900 rounded px-3 py-2 space-y-1">
            <div>
              ปรับแล้ว — เพิ่ม <strong>{done.added}</strong> · แก้คาบ <strong>{done.fixed}</strong> ·
              {" "}เอาออก <strong>{done.removed}</strong> วิชา
            </div>
            {done.slots_left > 0 && (
              <div className="text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-xs leading-relaxed">
                ⚠ มี <strong>{done.slots_left} คาบ</strong>ในตารางที่ตอนนี้ไม่มีแผนการสอนรองรับแล้ว
                (เป็นวิชาที่เพิ่งเอาออกจากแผน) — คาบเหล่านั้นยังอยู่ในตาราง ไม่ได้ถูกลบให้
                ลบออกจากตารางเอง หรือเพิ่มวิชากลับเข้าแผนการสอน
              </div>
            )}
          </div>
        )}

        {diff && !diff.curriculum && (
          <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded px-4 py-6 text-center leading-relaxed">
            ห้องนี้ยังไม่ได้ผูกหลักสูตร จึงไม่มีอะไรให้เทียบ
            <span className="block text-xs text-gray-500 mt-1">
              เป็นเรื่องปกติ — ห้องที่ไม่ผูกหลักสูตรจะไม่ถูกตรวจ ผูกได้ที่หน้า ⚙ จัดการ › หลักสูตร
            </span>
          </div>
        )}

        {nothing && diff && (
          <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-4 py-6 text-center">
            ✓ แผนการสอนของห้องนี้ตรงกับหลักสูตรทุกวิชา ({diff.ok} วิชา)
          </div>
        )}

        {diff?.curriculum && KINDS.map((k) => diff[k.key].length > 0 && (
          <div key={k.key} className={clsx("border rounded-lg overflow-hidden", k.box)}>
            <div className={clsx("px-3 py-1.5 flex items-center gap-2 text-sm font-semibold", k.head)}>
              <span>{k.icon} {k.label}</span>
              <span className="text-xs font-normal opacity-80">
                {diff[k.key].length} วิชา · เลือก {pick[k.key].size}
              </span>
              <button onClick={() => toggleAll(k.key)}
                className="ml-auto text-xs font-semibold underline underline-offset-2">
                {diff[k.key].every((e) => pick[k.key].has(e.subject_id)) ? "เอาออกทั้งหมด" : "ติ๊กทั้งหมด"}
              </button>
            </div>
            <ul className="divide-y divide-gray-100">
              {diff[k.key].map((e) => (
                <li key={e.subject_id}>
                  <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={pick[k.key].has(e.subject_id)}
                      onChange={() => toggle(k.key, e.subject_id)} />
                    <span className="font-bold text-sm text-gray-800">{e.code}</span>
                    <span className="text-xs text-gray-600 truncate">{e.name}</span>
                    <span className="ml-auto text-xs text-gray-500 shrink-0">{detail(k.key, e)}</span>
                  </label>
                </li>
              ))}
            </ul>
            {k.key === "remove" && (
              <p className="px-3 py-1.5 text-[11px] text-rose-800 bg-rose-50/60 border-t border-rose-100 leading-relaxed">
                ไม่ได้ติ๊กไว้ให้ — การเอาออกคือลบแถวในแผนการสอนของห้องนี้จริงๆ ย้อนกลับไม่ได้
              </p>
            )}
          </div>
        ))}

        {diff && diff.warn.length > 0 && (
          <div className="border border-amber-300 rounded-lg overflow-hidden">
            <div className="px-3 py-1.5 bg-amber-100 text-amber-900 text-sm font-semibold">
              ⚠ คำเตือน <span className="text-xs font-normal">{diff.warn.length} วิชา · ระบบไม่ปรับให้ ต้องดูเอง</span>
            </div>
            <ul className="divide-y divide-amber-100 bg-amber-50/50">
              {diff.warn.map((w) => (
                <li key={w.subject_id} className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-gray-800">{w.code}</span>
                    <span className="text-xs text-gray-600 truncate">{w.name}</span>
                    <span className="ml-auto text-xs text-gray-500 shrink-0">
                      หลักสูตร {w.want} · แผนการสอน {w.have} คาบ
                    </span>
                  </div>
                  <div className="text-xs text-amber-900 mt-0.5">{w.why}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {diff?.curriculum && !nothing && diff.ok > 0 && (
          <p className="text-[11px] text-gray-400">ตรงกับหลักสูตรอยู่แล้ว {diff.ok} วิชา — ไม่แตะ</p>
        )}
      </div>

      <div className="px-5 py-3 border-t bg-gray-50 space-y-2">
        {diff?.curriculum && (diff.add.length + diff.fix.length + diff.remove.length) > 0 && (
          <div className="text-xs text-gray-700">
            {picked === 0 ? "ยังไม่ได้เลือกอะไร" : (
              <>
                จะ ➕ เพิ่ม <strong>{n.add}</strong> · ✏️ แก้คาบ <strong>{n.fix}</strong> ·
                {" "}➖ เอาออก <strong className={n.remove > 0 ? "text-rose-700" : undefined}>{n.remove}</strong> วิชา
              </>
            )}
            {n.remove > 0 && (
              <div className="text-rose-700 mt-0.5">
                ⚠ เอาออก {n.remove} วิชา = ลบแถวในแผนการสอนของ {groupName} ย้อนกลับไม่ได้
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-gray-500 flex-1 leading-relaxed">
            ปรับเฉพาะแผนการสอนของห้องนี้ที่ติ๊กไว้ — ไม่ขยับคาบที่จัดลงตารางแล้ว
          </p>
          <button onClick={onClose} className="px-3 py-2 rounded border text-xs">ปิด</button>
          <button onClick={apply} disabled={busy || picked === 0}
            className="px-4 py-2 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 disabled:bg-gray-300">
            {busy ? "กำลังปรับ…" : picked > 0 ? `ปรับตามหลักสูตร (${picked})` : "ปรับตามหลักสูตร"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
