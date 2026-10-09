/**
 * The warning that stands in the way of the data loss the school kept hitting.
 *
 * The server's revision counter only climbs while it is running, so a smaller
 * number than we have already seen means the process restarted — and on a
 * free host that means it also lost the file it saves to and is back on the
 * data it shipped with. The store stops pulling at that point, which leaves
 * the real timetable on screen and nowhere else, so this says so plainly and
 * offers the way back before anyone reloads the page and loses it.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import {
  listSavePoints, getSavePoint, formatSavedAt, type SavePointMeta,
} from "../../utils/savePoints";

export const ServerResetBanner = () => {
  const serverReset = useTimetableStore((s) => s.serverReset);
  const acceptServerState = useTimetableStore((s) => s.acceptServerState);
  const dismissServerReset = useTimetableStore((s) => s.dismissServerReset);
  const loadAll = useTimetableStore((s) => s.loadAll);

  const [best, setBest] = useState<SavePointMeta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Find the newest copy worth offering: the pinned one if there is one,
  // otherwise the most recent automatic save.
  useEffect(() => {
    if (!serverReset) return;
    listSavePoints()
      .then((all) => setBest(all.find((p) => p.kind === "main") ?? all[0] ?? null))
      .catch(() => setBest(null));
  }, [serverReset]);

  if (!serverReset) return null;

  const restore = async () => {
    if (!best) return;
    setBusy("restore"); setErr(null);
    try {
      const point = await getSavePoint(best.id);
      if (!point) { setErr("หาเซฟนี้ไม่เจอแล้ว"); return; }
      await api.restoreBackup(point.data);
      await loadAll();
      dismissServerReset();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d ?? "กู้คืนไม่สำเร็จ");
    } finally { setBusy(null); }
  };

  /** Push what is on screen back up, for when there is no save point at all. */
  const pushCurrent = async () => {
    setBusy("push"); setErr(null);
    try {
      const st = useTimetableStore.getState();
      await api.restoreBackup({
        departments: st.departments, buildings: st.buildings, rooms: st.rooms,
        groups: st.groups, teachers: st.teachers, subjects: st.subjects,
        requirements: st.requirements, periods: st.periods, slots: st.slots,
        school_config: st.schoolConfig,
      });
      await loadAll();
      dismissServerReset();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d ?? "ส่งข้อมูลกลับไม่สำเร็จ");
    } finally { setBusy(null); }
  };

  return (
    <div className="bg-red-50 border-b-2 border-red-300 px-4 py-3">
      <div className="max-w-6xl mx-auto flex flex-wrap items-start gap-3">
        <span className="text-xl leading-none mt-0.5">⚠️</span>
        <div className="flex-1 min-w-[240px]">
          <p className="text-sm font-bold text-red-900">
            เซิร์ฟเวอร์รีสตาร์ทและข้อมูลบนเซิร์ฟเวอร์หายไป
          </p>
          <p className="text-xs text-red-800 mt-0.5 leading-relaxed">
            ระบบ<strong>หยุดดึงข้อมูลจากเซิร์ฟเวอร์แล้ว</strong> ตารางที่เห็นอยู่บนหน้าจอตอนนี้ยังเป็นของจริง
            <strong> อย่าเพิ่งรีเฟรชหน้าเว็บ</strong> — เลือกทางใดทางหนึ่งด้านล่างก่อน
            {best && (
              <> · มีเซฟล่าสุดเมื่อ <strong>{formatSavedAt(best.saved_at)}</strong>
                {" "}(ครู {best.counts.teachers} · คาบในตาราง {best.counts.slots})</>
            )}
          </p>
          {err && <p className="text-xs text-red-900 font-semibold mt-1">{err}</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {best && (
            <button onClick={restore} disabled={busy !== null}
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-40">
              {busy === "restore" ? "กำลังกู้คืน…" : "↩ กู้คืนจากเซฟล่าสุด"}
            </button>
          )}
          <button onClick={pushCurrent} disabled={busy !== null}
            title="ส่งตารางที่เห็นบนหน้าจอกลับขึ้นเซิร์ฟเวอร์"
            className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-40">
            {busy === "push" ? "กำลังส่ง…" : "⬆ ใช้ข้อมูลที่เห็นบนจอนี้"}
          </button>
          <button onClick={() => { void acceptServerState(); }} disabled={busy !== null}
            title="ทิ้งสิ่งที่เห็นบนจอ แล้วใช้ข้อมูลที่เซิร์ฟเวอร์มีตอนนี้"
            className="px-3 py-1.5 text-xs border border-red-300 text-red-800 rounded-lg font-semibold hover:bg-red-100 disabled:opacity-40">
            ใช้ข้อมูลบนเซิร์ฟเวอร์
          </button>
        </div>
      </div>
    </div>
  );
};
