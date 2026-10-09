/**
 * จุดบันทึก — save and come back to a known-good copy in one click.
 *
 * The downloaded backup file is still the copy that survives a lost laptop,
 * and the panel says so. What this adds is the thing the school actually
 * asked for: somewhere to put a copy before a risky change, and one button to
 * come back to it when the server has thrown its own copy away.
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import {
  putSavePoint, listSavePoints, getSavePoint, deleteSavePoint,
  storageAvailable, formatSavedAt, formatBytes, AUTO_KEEP,
  type SavePointMeta,
} from "../../utils/savePoints";

interface Props {
  /** Called after a restore so the page can reload what it shows. */
  onRestored: () => Promise<void> | void;
}

export const SavePointPanel = ({ onRestored }: Props) => {
  const [points, setPoints] = useState<SavePointMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Set when a save would shrink the pinned copy; holds the warning text. */
  const [shrink, setShrink] = useState<string | null>(null);
  const usable = storageAvailable();

  const refresh = useCallback(() => {
    listSavePoints().then(setPoints).catch(() => setPoints([]));
  }, []);
  useEffect(() => { if (usable) refresh(); }, [usable, refresh]);

  /**
   * Save over the pinned copy.
   *
   * Saving is the one button here that can destroy data, and the moment it is
   * most likely to be pressed is the moment it must not be: the school opens
   * the page, sees an empty timetable, and reaches for the save button. That
   * would replace a good copy with the empty one. Two things stand in the way
   * — the reset flag when we know the server restarted, and a size check for
   * when we do not, since a copy holding a fraction of what the last one held
   * is a loss, not an edit.
   */
  const saveMain = async (force = false) => {
    setBusy("save"); setNote(null); setErr(null); setShrink(null);
    try {
      if (!force && useTimetableStore.getState().serverReset) {
        setErr("ตอนนี้ข้อมูลบนเซิร์ฟเวอร์หายอยู่ — ถ้าบันทึกตอนนี้จะเอาข้อมูลเปล่าไปทับเซฟหลักที่มีอยู่"
          + " กรุณากู้คืนให้ข้อมูลกลับมาก่อน แล้วค่อยบันทึก");
        return;
      }
      const snap = await api.downloadBackup();
      const prev = points.find((p) => p.kind === "main");
      const now = {
        teachers: Array.isArray(snap["teachers"]) ? (snap["teachers"] as unknown[]).length : 0,
        slots: Array.isArray(snap["slots"]) ? (snap["slots"] as unknown[]).length : 0,
      };
      if (!force && prev
          && (now.teachers < prev.counts.teachers * 0.6
              || now.slots < prev.counts.slots * 0.6)) {
        setShrink(
          `ข้อมูลตอนนี้น้อยกว่าเซฟหลักเดิมมาก — ตอนนี้ ครู ${now.teachers} · คาบ ${now.slots}`
          + ` แต่เซฟเดิมมี ครู ${prev.counts.teachers} · คาบ ${prev.counts.slots}`
          + ` (เซฟเมื่อ ${formatSavedAt(prev.saved_at)})`,
        );
        return;
      }
      const meta = await putSavePoint("main", snap, label.trim() || undefined);
      setNote(`บันทึกเป็นเซฟหลักแล้ว — ครู ${meta.counts.teachers} · `
        + `ห้องเรียน ${meta.counts.groups} · คาบในตาราง ${meta.counts.slots}`);
      setLabel("");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally { setBusy(null); }
  };

  const restore = async (id: string) => {
    setBusy(id); setNote(null); setErr(null); setConfirming(null);
    try {
      const point = await getSavePoint(id);
      if (!point) { setErr("หาเซฟนี้ไม่เจอแล้ว"); return; }
      const r = await api.restoreBackup(point.data);
      await onRestored();
      setNote(`กู้คืนแล้ว — ห้องเรียน ${r.restored.groups ?? 0} · ครู ${r.restored.teachers ?? 0}`
        + ` · วิชา ${r.restored.subjects ?? 0} · คาบในตาราง ${r.restored.slots ?? 0}`
        + ` (เซฟเมื่อ ${formatSavedAt(point.saved_at)})`);
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d ?? "กู้คืนไม่สำเร็จ");
    } finally { setBusy(null); }
  };

  const drop = async (id: string) => {
    setConfirming(null);
    await deleteSavePoint(id).catch(() => undefined);
    refresh();
  };

  if (!usable) {
    return (
      <p className="text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded-lg px-3 py-2">
        เบราว์เซอร์นี้บันทึกลงเครื่องไม่ได้ (อาจเปิดโหมดไม่ระบุตัวตนอยู่) —
        ใช้การดาวน์โหลดไฟล์สำรองด้านบนแทน
      </p>
    );
  }

  const main = points.find((p) => p.kind === "main");
  const autos = points.filter((p) => p.kind === "auto");

  const Row = ({ p }: { p: SavePointMeta }) => (
    <div className="flex items-center gap-2 flex-wrap border border-gray-200 rounded-lg px-3 py-2">
      <div className="flex-1 min-w-[180px]">
        <p className="text-xs font-semibold text-gray-800">
          {p.kind === "main" ? "⭐ เซฟหลัก" : "🕒 เซฟอัตโนมัติ"}
          {p.label ? <span className="font-normal text-gray-600"> — {p.label}</span> : null}
        </p>
        <p className="text-[11px] text-gray-500">
          {formatSavedAt(p.saved_at)} · ครู {p.counts.teachers} · ห้องเรียน {p.counts.groups}
          {" · คาบในตาราง "}{p.counts.slots} · {formatBytes(p.bytes)}
        </p>
      </div>
      {confirming === p.id ? (
        <div className="flex gap-1.5 items-center">
          <span className="text-[11px] text-red-700">แทนที่ข้อมูลทั้งหมด?</span>
          <button onClick={() => restore(p.id)}
            className="px-2.5 py-1 text-xs bg-red-600 text-white rounded-md font-semibold">
            ใช่ กู้คืน
          </button>
          <button onClick={() => setConfirming(null)}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md">ยกเลิก</button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button onClick={() => setConfirming(p.id)} disabled={busy !== null}
            className="px-2.5 py-1 text-xs bg-emerald-600 text-white rounded-md font-semibold hover:bg-emerald-700 disabled:opacity-40">
            {busy === p.id ? "กำลังกู้คืน…" : "↩ กู้คืน"}
          </button>
          <button onClick={() => drop(p.id)} disabled={busy !== null}
            title="ลบเซฟนี้"
            className="px-2 py-1 text-xs border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 disabled:opacity-40">
            ลบ
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap items-center">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="ชื่อเซฟ (ไม่ใส่ก็ได้) เช่น ก่อนจัดตารางใหม่"
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
        <button onClick={() => { void saveMain(); }} disabled={busy !== null}
          className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-40">
          {busy === "save" ? "กำลังบันทึก…" : "💾 บันทึกเป็นเซฟหลัก"}
        </button>
      </div>

      {/* The save that would have thrown the good copy away. */}
      {shrink && (
        <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 space-y-2">
          <p className="text-xs text-red-900 font-semibold">⚠️ หยุดไว้ก่อน — {shrink}</p>
          <p className="text-[11px] text-red-800">
            ถ้าข้อมูลเพิ่งหายไป <strong>อย่าบันทึกทับ</strong> ให้กด “↩ กู้คืน” ที่เซฟหลักด้านล่างแทน
            จะบันทึกทับก็ต่อเมื่อคุณตั้งใจลบข้อมูลออกเองจริงๆ
          </p>
          <div className="flex gap-2">
            <button onClick={() => setShrink(null)}
              className="px-3 py-1 text-xs bg-emerald-600 text-white rounded-md font-semibold">
              ยกเลิก (ปลอดภัยกว่า)
            </button>
            <button onClick={() => { void saveMain(true); }}
              className="px-3 py-1 text-xs border border-red-400 text-red-700 rounded-md">
              ยืนยันบันทึกทับ
            </button>
          </div>
        </div>
      )}

      {main ? <Row p={main} /> : (
        <p className="text-xs text-gray-500 px-1">
          ยังไม่มีเซฟหลัก — กดปุ่มด้านบนเพื่อเก็บข้อมูลตอนนี้ไว้เป็นจุดกลับ
        </p>
      )}

      {autos.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-600 px-1 py-1">
            เซฟอัตโนมัติ {autos.length} จุด (ระบบเก็บให้เองล่าสุด {AUTO_KEEP} จุด)
          </summary>
          <div className="space-y-1.5 mt-1.5">
            {autos.map((p) => <Row key={p.id} p={p} />)}
          </div>
        </details>
      )}

      {note && (
        <p className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg px-3 py-2">{note}</p>
      )}
      {err && (
        <p className="text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2">{err}</p>
      )}
      <p className="text-[11px] text-gray-400">
        เซฟนี้เก็บไว้<strong>ในเครื่องนี้และเบราว์เซอร์นี้เท่านั้น</strong> ไม่หายตอนเซิร์ฟเวอร์รีสตาร์ท
        แต่จะไม่ตามไปเครื่องอื่น — ถ้าเปลี่ยนเครื่องหรือล้างข้อมูลเบราว์เซอร์ ให้ใช้ไฟล์สำรองด้านบน
      </p>
    </div>
  );
};
