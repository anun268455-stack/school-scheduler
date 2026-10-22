/**
 * TeacherAssignModal — the teacher's side of the same question the subject page
 * asks: which subject does this teacher teach, and to which classes?
 *
 * It reads and writes the very same lesson requirements as SubjectAssignModal,
 * so adding a class here shows up there, and the other way round.
 *
 * Left : the teacher's current load, grouped by subject, with the option to
 *        change periods-per-week or drop a class.
 * Right: add work — pick a subject, pick a level, tick the classes.
 */
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { electiveCandidates, electiveSubjectIds, teacherLoad } from "../../utils/teachingLoad";
import { coverageFor, windowsFor } from "../../utils/electiveCoverage";
import { flattenGroups } from "../../utils/groupHierarchy";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect } from "../common/SearchableSelect";
import { partnerOf, indexRequirements, assignOffer, type AssignOffer } from "../../utils/coTeaching";
import type { LessonRequirement, Teacher, ElectivePool, TimetableSlot } from "../../types";
import { DAYS, periodLabel } from "../../types";

interface Props {
  teacher: Teacher;
  onClose: () => void;
}

export const TeacherAssignModal: React.FC<Props> = ({ teacher, onClose }) => {
  const { subjects, groups, requirements, departments, teachers, slots, periods } = useTimetableStore();

  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const g of flat) if (g.level) s.add(g.level);
    return [...s].sort();
  }, [flat]);

  const [subjectId, setSubjectId] = useState("");
  const [level, setLevel]   = useState<string>(() => levels[0] ?? "");
  const [weekly, setWeekly] = useState(1);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  /**
   * คำเตือนหายเองหลังอ่านทัน
   *
   * ข้อความพวกนี้มาจากหลักสูตร และยาวพอจะบอกได้ว่าต้องไปทำอะไรต่อ
   * ("เพิ่มวิชานี้ลงในหลักสูตรก่อน") จึงไม่ควรวาบแล้วหาย แต่ก็ไม่ควรค้าง
   * ให้ต้องปัดทิ้งเอง เวลาจึงยืดตามความยาวข้อความ ประโยคสั้นหายเร็ว
   * ประโยคยาวอยู่นานขึ้น อย่างมาก 12 วินาที
   */
  useEffect(() => {
    if (!error) return;
    const ms = Math.min(12000, 4000 + error.length * 60);
    const id = window.setTimeout(() => setError(null), ms);
    return () => window.clearTimeout(id);
  }, [error]);

  const reqIndex = useMemo(() => indexRequirements(requirements), [requirements]);

  /**
   * Everything this teacher is down to teach — including the lessons they
   * joined as the second teacher.
   *
   * Leaving those out made the page disagree with itself: a สอนร่วม lesson
   * sits in their timetable and counts in their อัตรากำลัง, but this list
   * said they did not teach it, so the class still showed as free to add.
   */
  const mine = useMemo(
    () => requirements.filter((r) =>
      r.teacher_id === teacher.id || partnerOf(r, reqIndex) === teacher.id),
    [requirements, reqIndex, teacher.id],
  );
  const isCo = (r: LessonRequirement) => r.teacher_id !== teacher.id;

  const orphanRows = useMemo(
    () => mine.filter((r) => !flat.some((g) => g.id === r.group_id)), [mine, flat]);
  const orphanPeriods = orphanRows.reduce((n, r) => n + (r.weekly_count ?? 0), 0);

  const subjName = (id: number) => {
    const s = subjects.find((x) => x.id === id);
    return s ? `${s.code} – ${s.name}` : String(id);
  };
  /**
   * The class's name — or, when there is no such class any more, something a
   * person can act on.
   *
   * A bare id in this column reads like a room number ("82", "86") and the
   * school has no way to tell it apart from a class that is simply named that
   * way. It is in fact a row pointing at a class that is not in the system:
   * it can never reach the timetable, and this is where it gets fixed.
   */
  const gMissing = (id: number) => !flat.some((g) => g.id === id);
  const gName = (id: number) => {
    const g = flat.find((x) => x.id === id);
    return g ? g.name : `⚠ ไม่พบห้องเรียน #${id}`;
  };

  // Group the load by subject so the list reads like a teaching timetable.
  const bySubject = useMemo(() => {
    const m = new Map<number, typeof mine>();
    for (const r of mine) {
      const list = m.get(r.subject_id) ?? [];
      list.push(r);
      m.set(r.subject_id, list);
    }
    return [...m.entries()].sort((a, b) => subjName(a[0]).localeCompare(subjName(b[0])));
  }, [mine, subjects]);

  // วิชาเสรี across many classes is one hour of this teacher's week, not one
  // per class — see utils/teachingLoad. Counted the old way, a teacher
  // offering one elective to ten classes read as twenty hours and showed up
  // as overloaded when nothing was wrong.

  /**
   * The คาบเสรี windows, so each class can be checked against them.
   *
   * A class down to take an elective that sits in no window offering it gets
   * an ordinary lesson instead, on its own, with a teacher who is already
   * standing in the window teaching the same subject to everybody else. Each
   * half looks reasonable on its own, which is why nothing caught it.
   */
  const [pools, setPools] = useState<ElectivePool[]>([]);
  useEffect(() => { api.fetchElectivePools().then(setPools).catch(() => setPools([])); }, []);
  const electiveSlots = useMemo(() => slots.filter((x) => x.is_elective), [slots]);
  const electiveIds = useMemo(
    () => electiveSubjectIds(subjects, pools, slots), [subjects, pools, slots]);

  /** 1 คาบ หรือ 2 คาบติดกัน — a property of the subject, set from here so it
      is answered beside the question it belongs to. */
  const subjDuration = subjects.find((s) => s.id === Number(subjectId))?.duration ?? 1;
  const setSubjectDuration = async (subjectId: number, duration: 1 | 2) => {
    setBusy(true); setError(null);
    try {
      const updated = await api.updateSubject(subjectId, { duration });
      useTimetableStore.setState((st) => ({
        subjects: st.subjects.map((x) => (x.id === subjectId ? { ...x, ...updated } : x)),
      }));
    } catch (e) {
      // ไม่มี catch มาก่อน ถ้าเซิร์ฟเวอร์ปฏิเสธ ปุ่มจะเด้งกลับเงียบๆ
      // เหมือนกดไม่ติด แทนที่จะบอกว่าทำไม
      setError(api.errorDetail(e, "เปลี่ยนคาบเดี่ยว/คาบคู่ไม่สำเร็จ"));
    } finally { setBusy(false); }
  };

  /** Mark (or unmark) a subject as วิชาเสรี without leaving this dialog. */
  const toggleElective = async (subjectId: number, on: boolean) => {
    setBusy(true);
    try {
      const updated = await api.updateSubject(subjectId, { is_elective: on });
      useTimetableStore.setState((st) => ({
        subjects: st.subjects.map((x) => (x.id === subjectId ? { ...x, ...updated } : x)),
      }));
    } finally { setBusy(false); }
  };
  /**
   * วิชาที่ครูสอนอยู่ในคาบเสรี แต่ยังไม่มีในแผนการสอน
   *
   * A วิชาเสรี is written down twice: the plan says which classes may choose
   * it, and the คาบเสรี is the hour it is taught in. Putting a subject into a
   * window writes only the second, so this list — which reads the plan —
   * showed nothing at all, and the teacher's week was short by those hours
   * with nothing on screen to say why.
   */
  const fromWindows = useMemo(() => {
    const planned = new Set(mine.map((r) => r.subject_id));
    const by = new Map<number, { cells: TimetableSlot[]; groups: Set<number>; label?: string }>();
    for (const s of electiveSlots) {
      for (const o of s.elective_options ?? []) {
        if (o.teacher_id !== teacher.id || o.subject_id == null) continue;
        if (planned.has(o.subject_id)) continue;
        const cur = by.get(o.subject_id)
          ?? { cells: [] as TimetableSlot[], groups: new Set<number>(), label: o.label };
        cur.cells.push(s);
        cur.groups.add(s.group_id);
        by.set(o.subject_id, cur);
      }
    }
    return [...by.entries()].map(([subjectId, v]) => {
      // One hour however many classes sit in it; a double is two hours.
      const hours = new Set(v.cells.map((s) => `${s.day}:${s.period}`));
      return {
        subjectId, label: v.label,
        classes: v.groups.size,
        weekly: hours.size,
        windows: [...new Set(v.cells.filter((s) => !s.is_double_cont)
          .map((s) => `${s.day}:${s.period}`))]
          .map((k) => { const [d, p] = k.split(":").map(Number); return { day: d, period: p }; })
          .sort((a, b) => a.day - b.day || a.period - b.period),
      };
    }).sort((a, b) => subjName(a.subjectId).localeCompare(subjName(b.subjectId)));
  }, [electiveSlots, mine, teacher.id, subjects]);

  const windowHours = fromWindows.reduce((n, w) => n + w.weekly, 0);
  const totalPeriods = useMemo(
    () => teacherLoad(mine, electiveIds) + windowHours,
    [mine, electiveIds, windowHours]);
  const rawPeriods = mine.reduce((n, r) => n + (r.weekly_count ?? 0), 0) + windowHours;
  const coCount = mine.filter((r) => partnerOf(r, reqIndex) != null).length;
  const cap = (teacher.max_slots_per_day || 6) * 5;

  // Which untikcked subjects are spread across a level, and what the week
  // would come to if they really are electives. Shown only when over the cap,
  // because that is the only time the question is worth asking.
  const candidates = useMemo(
    () => electiveCandidates(mine, electiveIds), [mine, electiveIds]);
  const ifAllElective = useMemo(
    () => teacherLoad(mine, new Set([...electiveIds, ...candidates.map((c) => c.subjectId)])),
    [mine, electiveIds, candidates]);

  // Teachers of a subject's own department first, but every subject stays listed.
  const subjectOpts = useMemo(() => {
    const sorted = [...subjects].sort((a, b) => {
      const am = a.department_id === teacher.department_id ? 0 : 1;
      const bm = b.department_id === teacher.department_id ? 0 : 1;
      return am - bm || a.code.localeCompare(b.code);
    });
    return sorted.map((s) => ({
      value: String(s.id),
      label: `${s.code} – ${s.name}`,
      group: s.department_id === teacher.department_id ? "กลุ่มสาระของครูคนนี้" : "วิชาอื่น",
    }));
  }, [subjects, teacher.department_id]);

  const classesInLevel = useMemo(() => flat.filter((g) => (g.level ?? "") === level), [flat, level]);
  const tName = (id: number) => teachers.find((t) => t.id === id)?.name ?? String(id);

  /** Every row for this subject in this class, whoever it belongs to. */
  const rowsFor = (groupId: number, subjId: number) =>
    reqIndex.get(`${groupId}:${subjId}`) ?? [];

  type Offer = AssignOffer;
  const offerFor = (groupId: number, subjId: number): Offer =>
    assignOffer(teacher.id, groupId, subjId, reqIndex);

  const refresh = async () => {
    const updated = await api.fetchRequirements();
    useTimetableStore.setState({ requirements: updated });
  };

  const addClass = async (groupId: number) => {
    if (!subjectId) return;
    setBusy(true); setError(null);
    try {
      await api.bulkCreateRequirements([{
        group_id: groupId,
        subject_id: Number(subjectId),
        teacher_id: teacher.id,
        weekly_count: weekly,
        parallel_group_key: null,
      }]);
      await refresh();
    } catch (e) {
      setError(api.errorDetail(e, "เพิ่มไม่สำเร็จ"));
    } finally { setBusy(false); }
  };

  /**
   * Join somebody else's lesson as the second teacher.
   *
   * Written onto THEIR row rather than by adding one of our own, because one
   * class getting one subject is one lesson: a second row would give the
   * class the subject twice over, which is the duplicate the ตรวจสอบ page
   * reports. Where this teacher already has a row of their own, the two are
   * pointed at each other instead and the solver folds them into one.
   */
  const joinClass = async (offer: Offer, groupId: number) => {
    if (offer.kind !== "join" && offer.kind !== "pair") return;
    setBusy(true); setError(null);
    try {
      await api.updateRequirement(offer.who.id, { co_teacher_id: teacher.id });
      if (offer.kind === "pair") {
        const own = rowsFor(groupId, Number(subjectId))
          .find((r) => r.teacher_id === teacher.id);
        if (own && own.co_teacher_id == null) {
          await api.updateRequirement(own.id, { co_teacher_id: offer.who.teacher_id });
        }
      }
      await refresh();
    } catch {
      setError("จับคู่สอนร่วมไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  /** Join every class of this level that somebody else already teaches. */
  const joinAllInLevel = async () => {
    if (!subjectId) return;
    const targets = classesInLevel
      .map((g) => [g, offerFor(g.id, Number(subjectId))] as const)
      .filter(([, o]) => o.kind === "join" || o.kind === "pair");
    if (targets.length === 0) return;
    setBusy(true); setError(null);
    try {
      for (const [g, o] of targets) {
        if (o.kind !== "join" && o.kind !== "pair") continue;
        await api.updateRequirement(o.who.id, { co_teacher_id: teacher.id });
        if (o.kind === "pair") {
          const own = rowsFor(g.id, Number(subjectId))
            .find((r) => r.teacher_id === teacher.id && r.co_teacher_id == null);
          if (own) await api.updateRequirement(own.id, { co_teacher_id: o.who.teacher_id });
        }
      }
      await refresh();
    } catch {
      setError("จับคู่สอนร่วมไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const addAllInLevel = async () => {
    if (!subjectId) return;
    const targets = classesInLevel.filter((g) => rowsFor(g.id, Number(subjectId)).length === 0);
    if (targets.length === 0) return;
    setBusy(true); setError(null);
    try {
      await api.bulkCreateRequirements(targets.map((g) => ({
        group_id: g.id,
        subject_id: Number(subjectId),
        teacher_id: teacher.id,
        weekly_count: weekly,
        parallel_group_key: null,
      })));
      await refresh();
    } catch (e) {
      setError(api.errorDetail(e, "เพิ่มไม่สำเร็จ"));
    } finally { setBusy(false); }
  };

  /** Step out of a lesson that belongs to another teacher, leaving it theirs. */
  const leavePair = async (r: LessonRequirement) => {
    setBusy(true); setError(null);
    try {
      await api.updateRequirement(r.id, { co_teacher_id: null });
      await refresh();
    } catch {
      setError("เลิกสอนร่วมไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const removeReq = async (id: number) => {
    setBusy(true);
    try { await api.deleteRequirement(id); await refresh(); }
    finally { setBusy(false); }
  };

  /**
   * แก้ไขแถวที่ลงไว้แล้ว — move a row to another class, or another subject.
   *
   * Until now the only things that could be changed here were the period count
   * and "delete". A row written against the wrong class had to be deleted and
   * typed again, and a row whose class is gone (the ⚠ rows) could only be
   * deleted — taking the period count and the สอนร่วม partner with it. This
   * repoints it instead, which is what the school actually wants to do.
   */
  const [editing, setEditing] = useState<number | null>(null);
  const [editGroup, setEditGroup] = useState("");
  const [editSubject, setEditSubject] = useState("");

  const startEdit = (r: LessonRequirement) => {
    setEditing(r.id);
    setEditGroup(String(r.group_id));
    setEditSubject(String(r.subject_id));
  };

  const saveEdit = async (r: LessonRequirement) => {
    const gid = Number(editGroup), sid = Number(editSubject);
    if (!gid || !sid) { setError("ต้องเลือกทั้งวิชาและห้องเรียน"); return; }
    setBusy(true); setError(null);
    try {
      await api.updateRequirement(r.id, { group_id: gid, subject_id: sid });
      setEditing(null);
      await refresh();
    } catch {
      setError("แก้ไขไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const changeWeekly = async (id: number, groupId: number, subjId: number, n: number) => {
    setBusy(true);
    try {
      await api.updateRequirement(id, {
        group_id: groupId, subject_id: subjId, teacher_id: teacher.id, weekly_count: n,
      });
      await refresh();
    } finally { setBusy(false); }
  };

  const offers = useMemo(
    () => subjectId
      ? classesInLevel.map((g) => offerFor(g.id, Number(subjectId)).kind)
      : [],
    // offerFor reads reqIndex, so the list refreshes with the data.
    [subjectId, classesInLevel, reqIndex],
  );
  const freeCount = offers.filter((k) => k === "free").length;
  const joinCount = offers.filter((k) => k === "join" || k === "pair").length;

  const deptName = departments.find((d) => d.id === teacher.department_id)?.name;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-5xl" tall>
      {/* Header */}
      <div className="flex items-center gap-3 bg-indigo-700 px-5 py-4 shrink-0">
        <span className="text-2xl">📚</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            วิชาที่สอน — {teacher.code ? `${teacher.code} ` : ""}{teacher.name}
          </h2>
          <p className="text-indigo-100 text-xs mt-0.5 truncate">
            {deptName ?? "ไม่ระบุกลุ่มสาระ"} · รวม {totalPeriods} คาบ/สัปดาห์
            {rawPeriods !== totalPeriods && (
              <span className="text-purple-200" title="วิชาเสรีที่หลายห้องเรียนพร้อมกัน นับเป็นชั่วโมงเดียว">
                {" "}(นับวิชาเสรีเป็นชั่วโมงเดียว · ตามแถวทั้งหมด {rawPeriods})
              </span>
            )}
            {totalPeriods > cap && <span className="text-amber-200"> (เกินเพดาน {cap})</span>}
          </p>
        </div>
        <button onClick={onClose} className="text-indigo-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-5">
        {/* Current load */}
        <div className="col-span-3 border-r border-gray-200 flex flex-col min-h-0">
          <p className="px-4 pt-3 pb-1.5 text-xs font-semibold text-gray-500 shrink-0">
            วิชาที่สอนอยู่ ({mine.length} ห้อง{coCount > 0 ? ` · สอนร่วม ${coCount}` : ""})
          </p>

          {/* Rows pointing at a class that is gone. They still count towards
              this teacher's คาบ/สัปดาห์, so the number on the header is real
              work that can never happen — which is worth saying plainly. */}
          {orphanRows.length > 0 && (
            <div className="mx-4 mb-2 shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold text-amber-900">
                ⚠ {orphanRows.length} แถว · {orphanPeriods} คาบ ชี้ไปห้องเรียนที่ไม่มีในระบบแล้ว
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                คาบพวกนี้ลงตารางไม่ได้เลย แต่ยังถูกนับรวมใน {totalPeriods} คาบข้างบน
                — กด ✎ ที่แถวนั้นเพื่อย้ายไปห้องที่ถูกต้อง หรือกด ✕ เพื่อเอาออก
              </p>
            </div>
          )}

          {/* Over the cap, and the rows that explain it are almost always one
              subject spread across a level — an elective nobody has ticked
              yet. The arithmetic is the whole question, so it is done here
              rather than left for someone to do on paper. */}
          {totalPeriods > cap && candidates.length > 0 && (
            <div className="mx-4 mb-2 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] text-amber-900 leading-snug">
                <strong>เกินเพดาน {cap} คาบ</strong> — ตอนนี้นับได้ {totalPeriods} คาบ
                เพราะวิชาข้างล่างนี้ถูกนับแยกทุกห้อง ถ้าห้องเหล่านี้เรียนพร้อมกันในคาบเสรี
                ให้ติ๊กเป็นวิชาเสรี แล้วจะนับเป็นชั่วโมงเดียว
              </p>
              <div className="mt-1.5 space-y-1">
                {candidates.slice(0, 4).map((c) => (
                  <div key={c.subjectId} className="flex items-center gap-2 text-[11px]">
                    <span className="flex-1 min-w-0 truncate text-gray-700">
                      <strong>{subjName(c.subjectId)}</strong>
                      <span className="text-gray-500">
                        {" · "}{c.classes} ห้อง · {c.now} → {c.then} คาบ
                      </span>
                    </span>
                    <button
                      onClick={() => toggleElective(c.subjectId, true)}
                      disabled={busy}
                      className="shrink-0 px-2 py-0.5 rounded border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-40"
                    >
                      ติ๊กเป็นวิชาเสรี
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-amber-900">
                ติ๊กทั้งหมดแล้วจะเหลือ <strong>{ifAllElective} คาบ</strong>
                {ifAllElective <= cap
                  ? <span className="text-green-700"> — ไม่เกินเพดานแล้ว</span>
                  : <span> — ยังเกินอยู่ {ifAllElective - cap} คาบ</span>}
                {" · "}ติ๊กแล้วอย่าลืมลงคาบเสรีให้ห้องเหล่านี้ด้วย ระบบจะคอยเตือนให้เองถ้ายังไม่ได้ลง
              </p>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2.5">

            {/* สอนอยู่ในคาบเสรี แต่ยังไม่มีในแผน — real teaching, real hours,
                and until now invisible on this screen. */}
            {fromWindows.map((w) => (
              <div key={`w-${w.subjectId}`}
                className="rounded-lg border-2 border-purple-300 bg-purple-50/60 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100/70">
                  <span className="text-sm font-semibold text-gray-800 truncate">
                    {subjName(w.subjectId)}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-purple-600 text-white text-[10px] shrink-0">
                    วิชาเสรี
                  </span>
                  <span className="flex-1" />
                  <span className="text-xs text-purple-800 shrink-0">
                    {w.weekly} คาบ ({w.classes} ห้อง เรียนพร้อมกัน)
                  </span>
                </div>
                <div className="px-3 py-1.5 text-[11px] text-gray-600">
                  🎓 ลงไว้ในคาบเสรี:{" "}
                  {w.windows.map((x) => `${DAYS[x.day] ?? x.day} ${periodLabel(x.period, periods)}`).join(" · ")}
                  {w.label ? ` · วง “${w.label}”` : ""}
                  <span className="text-gray-400">
                    {" — "}มาจากคาบเสรี ไม่ได้อยู่ในแผนการสอน แก้ได้ที่ช่องคาบเสรีในตาราง
                  </span>
                </div>
              </div>
            ))}

            {bySubject.length === 0 && fromWindows.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">ยังไม่ได้กำหนดวิชาให้ครูคนนี้</p>
            )}
            {bySubject.map(([subjId, rows]) => {
              const isElective = electiveIds.has(subjId);
              const cover = isElective
                ? coverageFor(subjId, requirements, groups, pools, electiveSlots) : null;
              const where = isElective ? windowsFor(subjId, pools, electiveSlots) : [];
              const sum = rows.reduce((n, r) => n + r.weekly_count, 0);
              const counted = isElective ? Math.max(...rows.map((r) => r.weekly_count)) : sum;
              return (
              // The whole block, not just its header: a teacher scanning
              // thirty-one classes needs to see at a glance which of these
              // rows are the elective and which are real lessons.
              <div key={subjId} className={clsx("border-2 rounded-lg overflow-hidden",
                isElective ? "border-purple-200 bg-purple-50/40" : "border-gray-200")}>
                <div className={clsx("px-2.5 py-1.5 flex items-center gap-2",
                  isElective ? "bg-purple-100/70" : "bg-gray-50")}>
                  <span className="text-sm font-semibold text-gray-800 truncate">{subjName(subjId)}</span>
                  {/* Marked right here, where the twenty-period row that gave
                      the game away is sitting. Sending somebody to another
                      page to tick a box is how it stays unticked. */}
                  <button
                    onClick={() => toggleElective(subjId, !isElective)}
                    disabled={busy}
                    title={isElective
                      ? "วิชาเสรี — หลายห้องเรียนพร้อมกัน จึงนับเป็นชั่วโมงเดียว (กดเพื่อยกเลิก)"
                      : "ทำเป็นวิชาเสรี — ถ้าหลายห้องนี้เรียนพร้อมกันในคาบเดียว"}
                    className={clsx("text-[10px] rounded px-1 shrink-0 border transition-colors",
                      isElective
                        ? "bg-purple-100 text-purple-800 border-purple-300"
                        : "bg-white text-gray-400 border-gray-200 hover:border-purple-300 hover:text-purple-700")}>
                    {isElective ? "วิชาเสรี" : "+ วิชาเสรี"}
                  </button>
                  <span className="ml-auto text-[11px] text-gray-500 shrink-0">
                    {isElective ? (
                      <span title={`${rows.length} ห้องเลือกเรียนวิชานี้ แต่เรียนพร้อมกัน จึงนับเป็น ${counted} คาบ`}>
                        <span className="text-purple-800 font-medium">{counted} คาบ</span>
                        <span className="text-gray-400"> ({rows.length} ห้อง เรียนพร้อมกัน)</span>
                      </span>
                    ) : `${sum} คาบ`}
                  </span>
                </div>
                {/* Where it is offered, so nobody goes hunting for the window. */}
                {isElective && where.length > 0 && (
                  <p className="px-2.5 py-1 bg-purple-50/70 border-t border-purple-200 text-[11px] text-purple-900">
                    🎓 อยู่ในคาบเสรี: {where.map((w, i) => (
                      <span key={i}>
                        {i > 0 && " · "}
                        {w.day != null && w.period != null
                          ? `${DAYS[w.day]} ${periodLabel(w.period, periods)}`
                          : "ยังไม่กำหนดวัน/คาบ"}
                        {` (${w.groupCount} ห้อง)`}
                      </span>
                    ))}
                  </p>
                )}
                {cover && cover.missing.length > 0 && (
                  <p className="px-2.5 py-1 bg-amber-50 border-t border-amber-200 text-[11px] text-amber-900">
                    ⚠ {cover.missing.length} ห้องยังไม่ได้อยู่ในคาบเสรีที่มีวิชานี้
                    {cover.noWindow
                      ? " — ยังไม่มีคาบเสรีไหนเปิดวิชานี้เลย ไปสร้างที่หน้า “คาบเสรี”"
                      : " — เปิดหน้า “คาบเสรี” แล้วกด “เพิ่มห้อง” ให้ครบ"}
                  </p>
                )}
                <div className="divide-y divide-gray-50">
                  {rows.map((r) => {
                    // Joined, not owned: the row belongs to the other teacher,
                    // so this teacher can step out of it but must not retitle
                    // somebody else's lesson or change its period count.
                    const joined = isCo(r);
                    const mate = partnerOf(r, reqIndex);
                    if (editing === r.id) return (
                      <div key={r.id} className="px-2.5 py-2 bg-indigo-50/60 space-y-1.5">
                        <div className="flex gap-1.5">
                          <div className="flex-1 min-w-0">
                            <label className="block text-[10px] text-gray-500 mb-0.5">วิชา</label>
                            <SearchableSelect value={editSubject} onChange={setEditSubject}
                              options={subjectOpts} placeholder="เลือกวิชา" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <label className="block text-[10px] text-gray-500 mb-0.5">ห้องเรียน</label>
                            <SearchableSelect value={editGroup} onChange={setEditGroup}
                              options={flat.map((g) => ({ value: String(g.id), label: g.name,
                                                          hint: g.level ?? undefined }))}
                              placeholder="เลือกห้องเรียน" />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {gMissing(r.group_id) && (
                            <span className="text-[10px] text-amber-800">
                              แถวนี้ชี้ไปห้องเรียนที่ไม่มีแล้ว — เลือกห้องที่ถูกต้องเพื่อเอากลับมาใช้
                            </span>
                          )}
                          <span className="flex-1" />
                          <button onClick={() => setEditing(null)} disabled={busy}
                            className="px-2 py-0.5 rounded border border-gray-300 text-xs text-gray-600
                                       hover:bg-gray-50">ยกเลิก</button>
                          <button onClick={() => saveEdit(r)} disabled={busy}
                            className="px-2.5 py-0.5 rounded bg-indigo-600 text-white text-xs font-semibold
                                       hover:bg-indigo-700 disabled:opacity-50">บันทึก</button>
                        </div>
                      </div>
                    );
                    return (
                    <div key={r.id} className={clsx("flex items-center gap-1.5 px-2.5 py-1.5",
                      joined && "bg-sky-50/60",
                      gMissing(r.group_id) && "bg-amber-50")}>
                      <span className={clsx("text-sm truncate",
                        gMissing(r.group_id) ? "text-amber-800 font-medium" : "text-gray-700")}
                        title={gMissing(r.group_id)
                          ? "ห้องเรียนนี้ไม่อยู่ในระบบแล้ว คาบนี้จึงลงตารางไม่ได้ — กด ✎ เพื่อย้ายไปห้องที่ถูกต้อง"
                          : undefined}>
                        {gName(r.group_id)}
                      </span>
                      {/* Said after the class, because the class is the thing
                          that is wrong: this one is not in any คาบเสรี. */}
                      {isElective && cover && cover.missing.includes(r.group_id) && (
                        <span
                          title={cover.noWindow
                            ? "ยังไม่มีคาบเสรีที่มีวิชานี้เลย — ห้องนี้จะถูกจัดเป็นคาบธรรมดาแยกต่างหาก"
                            : "ห้องนี้ไม่ได้อยู่ในคาบเสรีที่มีวิชานี้ — จะถูกจัดเป็นคาบธรรมดาแยกต่างหาก "
                              + "ไปเพิ่มห้องนี้เข้าคาบเสรี หรือเอาวิชานี้ออกจากห้องนี้"}
                          className="shrink-0 px-1.5 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800 text-[10px]">
                          ⚠ ไม่ได้อยู่ในคาบเสรี
                        </span>
                      )}
                      {isElective && cover && cover.covered.includes(r.group_id) && (
                        <span title="ห้องนี้อยู่ในคาบเสรีที่มีวิชานี้แล้ว"
                          className="shrink-0 px-1.5 py-0.5 rounded-full border border-purple-200 bg-purple-50 text-purple-700 text-[10px]">
                          ✓ อยู่ในคาบเสรี
                        </span>
                      )}
                      {mate != null && (
                        <span
                          title={joined
                            ? `ครูผู้สอนหลักคือ ${tName(r.teacher_id)} — คาบนี้สอนร่วมกัน`
                            : `สอนร่วมกับ ${tName(mate)}`}
                          className="shrink-0 px-1.5 py-0.5 rounded-full border border-sky-300 bg-sky-50 text-sky-800 text-[10px] truncate max-w-[130px]">
                          👥 {joined ? tName(r.teacher_id) : tName(mate)}
                        </span>
                      )}
                      <span className="flex-1" />
                      <input
                        type="number" min={1} max={20} style={{ width: 52 }}
                        disabled={busy || joined}
                        title={joined ? "แก้จำนวนคาบได้ที่ครูผู้สอนหลัก" : undefined}
                        className="border border-gray-300 rounded px-1.5 py-0.5 text-sm disabled:bg-gray-100"
                        value={r.weekly_count}
                        onChange={(e) => changeWeekly(r.id, r.group_id, r.subject_id, Number(e.target.value))}
                      />
                      <span className="text-[11px] text-gray-400">คาบ</span>
                      <button
                        onClick={() => startEdit(r)}
                        disabled={busy || joined}
                        className="px-1.5 text-gray-400 hover:text-indigo-600 text-xs disabled:opacity-40"
                        title={joined ? "แก้ได้ที่ครูผู้สอนหลัก" : "แก้ไขวิชาหรือห้องเรียนของแถวนี้"}>✎</button>
                      <button
                        onClick={() => joined ? leavePair(r) : removeReq(r.id)}
                        disabled={busy}
                        className="px-1.5 text-red-400 hover:text-red-600 text-xs"
                        title={joined ? "เลิกสอนร่วมคาบนี้" : "เอาห้องนี้ออก"}>✕</button>
                    </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        </div>

        {/* Add work */}
        <div className="col-span-2 flex flex-col min-h-0">
          <div className="px-4 pt-3 pb-2 space-y-2 shrink-0 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500">เพิ่มวิชาที่สอน</p>
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">วิชา</label>
              <SearchableSelect value={subjectId} onChange={setSubjectId}
                options={subjectOpts} placeholder="เลือกวิชา" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <label className="block text-[11px] text-gray-500 mb-0.5">ระดับชั้น</label>
                <SearchableSelect value={level} onChange={setLevel}
                  options={levels.map((l) => ({ value: l, label: l }))} placeholder="เลือกระดับ" />
              </div>
              <div style={{ width: 70 }}>
                <label className="block text-[11px] text-gray-500 mb-0.5">คาบ/สัปดาห์</label>
                <input type="number" min={1} max={20}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  value={weekly} onChange={(e) => setWeekly(Number(e.target.value))} />
              </div>
            </div>

            {/* จำนวนคาบก่อน แล้วค่อยถามว่าติดกันไหม. Asked the other way round
                — a "ความยาว" dropdown on one screen and a คาบคู่ tick on
                another — the two settings read as the same question and the
                school could not tell which one it had just answered. */}
            {subjectId && weekly >= 2 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-2.5 py-2">
                <p className="text-[11px] text-gray-600 mb-1">
                  {weekly} คาบนี้เรียนยังไง
                </p>
                <div className="flex gap-1.5">
                  {([[1, "แยกคาบ"], [2, "🔗 คาบคู่ (2 คาบติดกัน)"]] as const).map(([d, label]) => (
                    <button key={d}
                      onClick={() => setSubjectDuration(Number(subjectId), d)}
                      disabled={busy}
                      className={clsx("flex-1 px-2 py-1 rounded border text-[11px] transition-colors disabled:opacity-40",
                        (subjDuration === 2 ? 2 : 1) === d
                          ? "bg-blue-600 border-blue-600 text-white font-medium"
                          : "bg-white border-gray-300 text-gray-600 hover:border-blue-400")}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  ตั้งให้ทั้งวิชา ใช้กับทุกห้องที่เรียนวิชานี้
                  {weekly % 2 === 1 && subjDuration === 2 && (
                    <span className="text-amber-700"> · {weekly} คาบเป็นเลขคี่ จะได้คาบคู่ {Math.floor(weekly / 2)} ครั้ง และคาบเดี่ยวอีก 1 คาบ</span>
                  )}
                </p>
              </div>
            )}
            {subjectId && classesInLevel.length > 0 && (
              <div className="space-y-1.5">
                <button onClick={addAllInLevel} disabled={busy || freeCount === 0}
                  className="w-full px-2 py-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-40">
                  + เพิ่มทุกห้องใน {level} ที่ยังว่าง ({freeCount})
                </button>
                {joinCount > 0 && (
                  <button onClick={joinAllInLevel} disabled={busy}
                    className="w-full px-2 py-1.5 text-xs bg-sky-50 text-sky-700 border border-sky-300 rounded hover:bg-sky-100 disabled:opacity-40">
                    👥 สอนร่วมทุกห้องใน {level} ที่ครูอื่นสอน ({joinCount})
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {/* เหตุผลที่เพิ่มไม่ได้ ต้องอยู่ตรงที่กด ไม่ใช่ตัวเล็กๆ ท้ายกล่อง
                หลักสูตรปฏิเสธแถวเป็นรายแถวและตอบ 200 เสมอ กดแล้วจึงเงียบ
                จนอ่านได้ว่าปุ่มเสีย ทั้งที่เซิร์ฟเวอร์บอกเหตุผลมาครบ */}
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 mb-1">
                <p className="text-xs font-semibold text-red-800 mb-0.5">เพิ่มไม่ได้</p>
                <p className="text-[11px] text-red-700 leading-snug">{error}</p>
              </div>
            )}
            {!subjectId && <p className="text-xs text-gray-400 text-center py-8">เลือกวิชาก่อน แล้วจึงเลือกห้อง</p>}
            {subjectId && classesInLevel.map((g) => {
              const offer = offerFor(g.id, Number(subjectId));
              const them = "who" in offer ? tName(offer.who.teacher_id) : "";
              const act = offer.kind === "free" ? () => addClass(g.id)
                : offer.kind === "join" || offer.kind === "pair" ? () => joinClass(offer, g.id)
                : undefined;
              return (
                <button
                  key={g.id}
                  onClick={act}
                  disabled={!act || busy}
                  title={them ? `ครูผู้สอน: ${them}` : undefined}
                  className={clsx(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors",
                    offer.kind === "mine"   ? "border-indigo-200 bg-indigo-50"
                      : offer.kind === "joined" ? "border-sky-300 bg-sky-50"
                      : offer.kind === "full"   ? "border-gray-200 bg-gray-50 opacity-70 cursor-not-allowed"
                      : offer.kind === "join"   ? "border-sky-200 hover:border-sky-400 hover:bg-sky-50"
                      : offer.kind === "pair"   ? "border-sky-200 hover:border-sky-400 hover:bg-sky-50"
                      : "border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/50",
                  )}
                >
                  <span className="text-sm text-gray-800 flex-1 truncate">{g.name}</span>
                  {offer.kind === "mine"   && <span className="text-[10px] text-indigo-600">สอนอยู่</span>}
                  {offer.kind === "joined" && <span className="text-[10px] text-sky-700 truncate max-w-[110px]">👥 สอนร่วมกับ {them}</span>}
                  {offer.kind === "join"   && <span className="text-[10px] text-sky-600 truncate max-w-[110px]">👥 สอนร่วมกับ {them}</span>}
                  {/* Reached from a different starting state than "join" — both
                      teachers already have a row — but the same thing happens
                      and the same thing comes out, so it reads the same. */}
                  {offer.kind === "pair"   && <span className="text-[10px] text-sky-600 truncate max-w-[110px]">👥 สอนร่วมกับ {them}</span>}
                  {offer.kind === "full"   && <span className="text-[10px] text-gray-400 truncate max-w-[110px]">มีครูสอนร่วมแล้ว</span>}
                  {offer.kind === "free"   && <span className="text-[11px] text-indigo-500">+ เพิ่ม</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
        <p className="text-[11px] text-gray-400 flex-1">
          ข้อมูลนี้เชื่อมกับหน้า "จัดห้อง/ครู" ของรายวิชา — แก้ที่ไหนก็เห็นเหมือนกัน
        </p>
        {/* ข้อความเดียวกันนี้ขึ้นเป็นกรอบแดงตรงรายชื่อห้องที่กดแล้ว
            ซ้ำอีกตัวตรงนี้มีแต่จะอ่านเป็นสองเรื่อง */}
        <button onClick={onClose} className="px-5 py-2 text-sm bg-indigo-700 text-white rounded-lg font-semibold hover:bg-indigo-800">
          เสร็จสิ้น
        </button>
      </div>
    </ModalShell>
  );
};
