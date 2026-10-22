/**
 * YardRescueModal — หาลานให้คาบที่ไม่มีห้อง.
 *
 * Opens from a red "ไม่มีห้อง" lesson: the problems list, or the lesson itself.
 * The school is short of indoor rooms, and marking an hour out to a ลาน both
 * places that hour and frees an indoor room. Until now which mark would help
 * was a guess, and a bad guess made things worse (27 roomless lessons became 37).
 * The server works out which marks would actually give this lesson a room;
 * this screen shows them.
 *
 * Two kinds of choice, and they are not the same act:
 *  · ลงลานเอง — THIS lesson goes out to a free ลาน. The reliable one.
 *  · ให้ห้องอื่นสละห้องให้ — ANOTHER class's hour is marked out to a ลาน, so the
 *    indoor room it gives up can be used here. What changes is that class's
 *    hour, not this one, and the screen says so before and after the click.
 *
 * Both save with the ordinary คาบเรียนลาน save. Nothing moves in the timetable
 * until สร้างตาราง is pressed again; this only records the decision.
 *
 * A คาบคู่ is one lesson in one room across two hours, so a lesson that is half
 * of one is marked on both hours — this lesson's own for ลงลานเอง, the donor's
 * for the other kind — the way the picker marks both hours of a merged cell.
 * That is two saves, and the second can fail after the first went through; the
 * screen then says one hour was marked and the other was not.
 */
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { ModalShell } from "../common/ModalShell";
import { useTimetableStore } from "../../store/timetableStore";
import { DAYS, periodLabel, type Period, type StudentGroup } from "../../types";
import { flattenGroups } from "../../utils/groupHierarchy";
import { levelKeyOf, periodsForLevel } from "../../utils/levels";
import { lessonHours } from "../../utils/yardPicks";
import {
  directKey, directPick, donorKey, donorPick, marksForHours, partialLine,
  rescueView, savedLine, whenText, writeMarks,
  type RescueSave,
} from "../../utils/yardRescue";

interface YardRescueModalProps {
  /**
   * The stuck lesson's own class. In a school with subgroups that is not always
   * the class on screen, so callers pass the slot's, never the selected one.
   */
  groupId:   number;
  groupName: string;
  day:       number;
  /** period_num — shown through periodLabel, never as a number. */
  period:    number;
  onClose:   () => void;
}

export const YardRescueModal: React.FC<YardRescueModalProps> = ({
  groupId, groupName, day, period, onClose,
}) => {
  const periods       = useTimetableStore((s) => s.periods);
  const slots         = useTimetableStore((s) => s.slots);
  const groups        = useTimetableStore((s) => s.groups);
  const yardPicks     = useTimetableStore((s) => s.yardPicks);
  const saveYardPick  = useTimetableStore((s) => s.saveYardPick);
  const loadYardPicks = useTimetableStore((s) => s.loadYardPicks);

  const [data, setData]       = useState<api.YardRescue | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  /** Bumped to ask the server again — a retry, or after a refused save. */
  const [attempt, setAttempt] = useState(0);
  /** The choice being saved, so every button locks and that one says so. */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr]         = useState<string | null>(null);
  /** The line shown once a mark is saved. */
  const [done, setDone]       = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.fetchYardRescue({ group_id: groupId, day, period })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoadErr(null);
      })
      .catch((e) => {
        if (alive) setLoadErr(api.errorDetail(e, "หาลานที่ว่างไม่สำเร็จ — ลองใหม่อีกครั้ง"));
      });
    return () => { alive = false; };
  }, [groupId, day, period, attempt]);

  const dayName = String(DAYS[day] ?? day + 1);
  const labelOf = (n: number) => periodLabel(n, periods);
  const rowOf = (n: number): Period | undefined =>
    periods.find((x: Period) => x.period_num === n && x.type === "class")
    ?? periods.find((x: Period) => x.period_num === n);

  const groupById = useMemo(() => {
    const m = new Map<number, StudentGroup>();
    for (const g of flattenGroups(groups)) m.set(g.id, g);
    return m;
  }, [groups]);

  /**
   * The hours of one class's lesson at this day and hour — two when it is half
   * of a merged คาบคู่, found the way the grid draws it, in that class's own
   * periods (a ม.1 and a ม.5 class do not share a day).
   */
  const hoursOf = (gid: number, d: number, p: number): number[] => {
    const nums = periodsForLevel(periods, levelKeyOf(groupById.get(gid))).map((x: Period) => x.period_num);
    return lessonHours(slots, gid, d, nums, p);
  };

  const hours = hoursOf(groupId, day, period);
  const first = rowOf(hours[0]);
  const last  = rowOf(hours[hours.length - 1]);
  const times = first && last ? `${first.start_time}–${last.end_time}` : "";
  const when  = whenText(dayName, hours.map(labelOf));

  const view   = data ? rescueView<api.YardRescueDirect, api.YardRescueDonor>(data) : null;
  const lesson = data?.lesson ?? null;
  const subject = lesson?.subject || "คาบนี้";

  const cell = { group_id: groupId, day, period };
  const busy = busyKey != null;

  /**
   * Save one choice — on every hour of the lesson it marks.
   *
   * A refusal is shown in the server's own words. If nothing was saved the
   * options are asked for again: a refusal usually means the hour changed under
   * us (someone else took that ลาน), and the list should not keep offering it.
   * If the first hour of a คาบคู่ was saved and the second refused, that is said
   * outright — half a pair marked is a state the school has to know about — and
   * the options are left as they are, so choosing again writes the missing hour
   * (or, with another ลาน, both).
   */
  const apply = async (
    key: string, pick: RescueSave, who: { group: string; yard: string; frees?: string },
  ) => {
    if (busy) return;
    setBusyKey(key);
    setErr(null);
    try {
      const own   = hoursOf(pick.group_id, pick.day, pick.period);
      const marks = marksForHours(pick, own, yardPicks);
      const out   = await writeMarks(marks, saveYardPick);
      const at    = (ms: RescueSave[]) => whenText(dayName, ms.map((m) => labelOf(m.period)));
      if (out.ok) {
        setDone(savedLine({ group: who.group, when: whenText(dayName, own.map(labelOf)), yard: who.yard, frees: who.frees }));
        // The grid's marks, and any other class's, are read from the server.
        void loadYardPicks();
      } else if (out.saved.length === 0) {
        setErr(api.errorDetail(out.error, "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง"));
        setAttempt((n) => n + 1);
      } else {
        setErr(partialLine({
          group: who.group, yard: who.yard,
          saved: at(out.saved), unsaved: at(out.unsaved),
          reason: api.errorDetail(out.error, "บันทึกไม่สำเร็จ"),
        }));
        // Show what the server really holds, as the picker does.
        void loadYardPicks();
      }
    } catch (e) {
      setErr(api.errorDetail(e, "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง"));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" z="z-[210]">
      <div className="px-5 py-3 border-b bg-teal-50">
        <h3 className="text-sm font-bold text-teal-900">🌳 หาลานให้คาบที่ไม่มีห้อง</h3>
        <p className="text-xs text-teal-800 mt-0.5">
          {groupName} · {when}
          {times && <span className="text-teal-700/70"> ({times})</span>}
        </p>
      </div>

      <div className="px-5 py-3 overflow-y-auto space-y-3">
        {loadErr && (
          <div role="alert" className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-2">
            <span className="flex-1">{loadErr}</span>
            <button
              type="button"
              onClick={() => { setLoadErr(null); setAttempt((n) => n + 1); }}
              className="shrink-0 px-2 py-0.5 rounded border border-red-300 bg-white font-semibold hover:bg-red-100"
            >
              ลองใหม่
            </button>
          </div>
        )}

        {!data && !loadErr && (
          <p className="text-sm text-gray-400 py-6 text-center">กำลังหาลานที่ว่าง…</p>
        )}

        {/* Which lesson is stuck. Class, day and hour are in the header. */}
        {view && view.kind !== "gone" && lesson && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-xs">
            <div className="text-[11px] font-bold text-rose-800">⚠ คาบที่ยังไม่มีห้อง</div>
            <div className="text-sm font-semibold text-gray-900">
              {lesson.subject || "ไม่ทราบชื่อวิชา"}
            </div>
            <div className="text-gray-600">
              {lesson.teacher || "ยังไม่ได้เลือกครู"}
              {" · "}{groupName} · {when}
            </div>
          </div>
        )}

        {view && view.kind !== "options" && (
          <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 leading-relaxed">
            {view.note}
          </p>
        )}

        {done && (
          <p role="status" className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-2.5 leading-relaxed">
            {done}
          </p>
        )}

        {view && view.kind === "options" && !done && (
          <>
            {view.note && (
              <p className="text-xs text-gray-600">{view.note}</p>
            )}

            {/* ── this lesson goes out ────────────────────────────────── */}
            <section>
              <h4 className="text-xs font-bold text-teal-800">ลงลานเอง</h4>
              <p className="text-[11px] text-gray-600 mt-0.5 mb-1.5">
                {subject} ของ {groupName} จะไปเรียนที่ลานที่เลือก — เฉพาะลานที่ว่างในชั่วโมงนี้
                เรียงจากดีที่สุดก่อน ตามลำดับลานที่โรงเรียนตั้งไว้
              </p>
              {view.direct.length === 0 ? (
                <p className="text-[11px] text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-2">
                  ไม่มีลานว่างในชั่วโมงนี้
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {view.direct.map((d) => {
                    const key = directKey(d);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => apply(
                            key, directPick(cell, d), { group: groupName, yard: d.room_name },
                          )}
                          title={`ให้ ${subject} ของ ${groupName} ไปเรียนที่ ${d.room_name}`}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-left text-gray-800 hover:bg-teal-50 hover:border-teal-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <span className="shrink-0">📌</span>
                          {/* The rank is the ลาน's place in the school's own
                              ลำดับลาน, so it can skip (2, 5, 7): the ones between
                              are not free this hour. Said in words, because a bare
                              "5" at the top of the list reads like a mistake. */}
                          <span className="flex-1 min-w-0">
                            <span className="block truncate">{d.room_name}</span>
                            <span className="block text-[11px] text-gray-400">ลำดับลานที่ {d.rank}</span>
                          </span>
                          <span className="shrink-0 text-[11px] text-teal-700">
                            {busyKey === key ? "กำลังบันทึก…" : "ให้คาบนี้ไปที่นี่"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* ── another class goes out ──────────────────────────────── */}
            <section className="rounded-lg border-2 border-amber-300 bg-amber-50/40 px-3 py-2.5">
              <h4 className="text-xs font-bold text-amber-900">ให้ห้องอื่นสละห้องให้</h4>
              <p className="text-[11px] font-semibold text-amber-900 mt-0.5 mb-2 leading-relaxed">
                ⚠ ตัวเลือกกลุ่มนี้ไม่ได้ย้ายคาบนี้ — จะทำเครื่องหมายที่ชั่วโมงของ<u>ห้องเรียนอื่น</u> ให้ห้องเรียนนั้นไปเรียนที่ลานแทน
                เพื่อคืนห้องสอนให้คาบที่ไม่มีห้อง
              </p>
              {view.donors.length === 0 ? (
                <p className="text-[11px] text-gray-400 border border-dashed border-amber-200 rounded-lg px-3 py-2 bg-white">
                  ไม่มีห้องอื่นที่ย้ายออกลานแล้วจะได้ห้องให้คาบนี้
                </p>
              ) : (
                <ul className="space-y-2">
                  {view.donors.map((o) => {
                    const key = donorKey(o);
                    // The donor's own lesson may be a คาบคู่ that starts or ends
                    // at another hour than this lesson does.
                    const theirs = whenText(dayName, hoursOf(o.group_id, day, period).map(labelOf));
                    return (
                      <li key={key} className="rounded-lg border border-amber-300 bg-white px-3 py-2">
                        <div className="text-sm font-semibold text-gray-900">
                          {o.group_name} ไปเรียนที่ {o.yard_name}
                        </div>
                        <div className="text-[11px] text-gray-600 mt-0.5">
                          {o.subject ? `วิชา ${o.subject} ` : "คาบ"}ของ {o.group_name} ({theirs}) จะย้ายออกไปเรียนที่ลาน
                        </div>
                        <div className="text-[11px] text-emerald-700 mt-0.5">
                          ห้อง {o.frees_room_name} ที่ {o.group_name} ใช้อยู่ จะว่างให้คาบที่ไม่มีห้องนี้ใช้
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => apply(
                            key, donorPick(cell, o),
                            { group: o.group_name, yard: o.yard_name, frees: o.frees_room_name },
                          )}
                          title={`ทำเครื่องหมายที่ ${o.group_name} ไม่ใช่ ${groupName}`}
                          className="mt-2 w-full px-3 py-1.5 rounded-lg border border-amber-500 bg-amber-100 text-xs font-semibold text-amber-950 hover:bg-amber-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {busyKey === key
                            ? "กำลังบันทึก…"
                            : `📌 ทำเครื่องหมายให้ ${o.group_name} ไปเรียนที่ ${o.yard_name}`}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {err && (
          <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-2">
            {err}
          </p>
        )}
      </div>

      <div className="px-5 py-3 border-t flex items-center gap-2">
        <span className="flex-1 text-[11px] text-gray-400">
          {view?.kind === "options" && !done
            ? "บันทึกทันทีที่เลือก · ตารางยังไม่ขยับจนกว่าจะกด ⚡ สร้างตาราง"
            : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          className={clsx(
            "px-3 py-1.5 text-sm rounded border",
            done
              ? "border-teal-600 bg-teal-600 text-white hover:bg-teal-700"
              : "border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200",
          )}
        >
          ปิด
        </button>
      </div>
    </ModalShell>
  );
};
