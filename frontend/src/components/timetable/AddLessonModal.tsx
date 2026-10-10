/**
 * AddLessonModal — click an empty cell to put a lesson in it.
 *
 * The cell can be empty in any of the three timetables, and which one you were
 * looking at decides what is already settled:
 *
 *   ตารางห้องเรียน  the class is known; choose a subject and who teaches it
 *   ตารางครู        the teacher is known; choose which class they go to
 *   ตารางห้องสอน    the room is known; choose the class and the teacher
 *
 * Whichever is known fills itself in, so the gap in front of you is the thing
 * you fill — a head of department looking at one teacher's empty Tuesday should
 * not have to work out which class view to open in order to use it.
 *
 * Left  : pick a subject. Subjects still owed periods — by this class, or by
 *         this teacher when the teacher is the known one — float to the top
 *         with a "ขาดอีก N คาบ" badge, and picking one fills in the rest.
 * Right : the lesson's details, plus a "สร้างวิชาใหม่" tab for typing in a
 *         brand-new subject without leaving the timetable.
 *
 * Conflicts are checked live: a busy teacher or a class that already has a
 * lesson at this cell blocks saving; a busy room only warns, since the room can
 * be changed afterwards.
 */
import React, { useMemo, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { buildSharesStudents, flattenGroups } from "../../utils/groupHierarchy";
import { SearchableSelect, roomOptions, groupOptions } from "../common/SearchableSelect";
import { DAYS, periodLabel, periodTime } from "../../types";
import type { Subject, SubjectType } from "../../types";
import { slotLabel, teachesSlot } from "../../utils/teacherSlots";
import { levelKeyOf, periodsForLevel } from "../../utils/levels";

interface AddLessonModalProps {
  /** Known from ตารางห้องเรียน. Left out, the modal asks for it. */
  groupId?:       number | null;
  /** Known from ตารางครู. */
  fixedTeacherId?: number | null;
  /** Known from ตารางห้องสอน. */
  fixedRoomId?:    number | null;
  day:     number;
  period:  number;
  onClose: () => void;
}

export const AddLessonModal: React.FC<AddLessonModalProps> = ({
  groupId: fixedGroupId, fixedTeacherId, fixedRoomId, day, period, onClose,
}) => {
  const { subjects, teachers, rooms, slots, requirements, groups, periods, addLesson } = useTimetableStore();

  const [tab, setTab]             = useState<"pick" | "new">("pick");
  const [search, setSearch]       = useState("");
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<string>(
    fixedTeacherId != null ? String(fixedTeacherId) : "");
  const [roomId, setRoomId]       = useState<string>(
    fixedRoomId != null ? String(fixedRoomId) : "");
  const [groupSel, setGroupSel]   = useState<string>(
    fixedGroupId != null ? String(fixedGroupId) : "");
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [newSubject, setNewSubject] = useState({ code: "", name: "", type: "common" as SubjectType, duration: 1 });

  const flat      = useMemo(() => flattenGroups(groups), [groups]);
  const shares    = useMemo(() => buildSharesStudents(groups), [groups]);
  const groupId   = groupSel ? Number(groupSel) : null;
  const groupName = groupId != null
    ? flat.find((g) => g.id === groupId)?.name ?? `ห้อง ${groupId}`
    : "ยังไม่ได้เลือกห้องเรียน";

  // ── What is already happening in this cell (across the whole school) ───────
  const atCell = useMemo(
    () => slots.filter((s) => s.day === day && s.period === period),
    [slots, day, period],
  );
  // Everyone standing in a room this period, สอนร่วม and คาบกิจกรรม included —
  // a teacher on duty with ลูกเสือ is not free, however the cell names her.
  const busyTeacherIds = useMemo(() => {
    const out = new Set<number>();
    for (const t of teachers) if (atCell.some((s) => teachesSlot(s, t.id))) out.add(t.id);
    return out;
  }, [atCell, teachers]);
  const busyRoomIds    = useMemo(
    () => new Set(atCell.map((s) => s.room_id).filter((r): r is number => r != null)),
    [atCell],
  );
  // A class is blocked if it, its parent, or one of its subgroups is already busy.
  const groupBlocker = useMemo(
    () => (groupId == null ? null : atCell.find((s) => shares(s.group_id, groupId)) ?? null),
    [atCell, shares, groupId],
  );
  const busyGroupIds = useMemo(() => {
    const out = new Set<number>();
    for (const g of flat) if (atCell.some((s) => shares(s.group_id, g.id))) out.add(g.id);
    return out;
  }, [atCell, shares, flat]);

  // ม.ต้น and ม.ปลาย eat at different times, so คาบ 4 exists for one of them
  // and is lunch for the other. A teacher's grid shows both columns, so the
  // class picker has to rule out the classes for whom this is not a period at
  // all — otherwise the gap in her Tuesday looks fillable by any class.
  const wrongLevelGroupIds = useMemo(() => {
    const out = new Set<number>();
    for (const g of flat) {
      const p = periodsForLevel(periods, levelKeyOf(g)).find((x) => x.period_num === period);
      if (!p || p.type !== "class") out.add(g.id);
    }
    return out;
  }, [flat, periods, period]);

  // ── What is still owed, and by whom ───────────────────────────────────────
  // With a class in hand that is "what this class still needs". From ตารางครู
  // with no class yet it is "what this teacher still owes, and to which class"
  // — so one click on the list fills in the subject AND the class, which is the
  // whole reason for filling a teacher's gap from their own timetable.
  const remainingBySubject = useMemo(() => {
    const m = new Map<number, { remaining: number; teacherId: number; groupId: number; groupName?: string }>();
    for (const r of requirements) {
      if (groupId != null ? !shares(r.group_id, groupId)
                          : r.teacher_id !== fixedTeacherId) continue;
      const placed = slots.filter((s) => s.group_id === r.group_id && s.subject_id === r.subject_id).length;
      const remaining = (r.weekly_count ?? 0) - placed;
      if (remaining <= 0) continue;
      // A class already busy this period cannot be the answer to this gap.
      if (groupId == null
          && (busyGroupIds.has(r.group_id) || wrongLevelGroupIds.has(r.group_id))) continue;
      const cur = m.get(r.subject_id);
      if (!cur || cur.remaining < remaining) {
        m.set(r.subject_id, {
          remaining, teacherId: r.teacher_id, groupId: r.group_id,
          groupName: flat.find((g) => g.id === r.group_id)?.name,
        });
      }
    }
    return m;
  }, [requirements, slots, shares, groupId, fixedTeacherId, busyGroupIds, wrongLevelGroupIds, flat]);

  const visibleSubjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (s: Subject) =>
      !q || s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    return subjects.filter(matches).sort((a, b) => {
      const ra = remainingBySubject.get(a.id)?.remaining ?? 0;
      const rb = remainingBySubject.get(b.id)?.remaining ?? 0;
      return rb - ra || a.code.localeCompare(b.code);
    });
  }, [subjects, search, remainingBySubject]);

  // ── Suggested room, strongest claim first: the subject's own room
  //    (ห้องประจำวิชา) → the class's homeroom → the teacher's room ───────────
  const suggestedRoomId = useMemo(() => {
    // Opened from ตารางห้องสอน the room is the whole point of the click.
    if (fixedRoomId != null) return fixedRoomId;
    const subj = subjects.find((x) => x.id === subjectId);
    if (subj?.fixed_room_id && !busyRoomIds.has(subj.fixed_room_id)) return subj.fixed_room_id;
    const t = teachers.find((x) => x.id === Number(teacherId));
    const home = groupId != null
      ? flat.find((g) => g.id === groupId)?.homeroom_room_id ?? null : null;
    if (home && !busyRoomIds.has(home)) return home;
    if (t?.fixed_room_id && !busyRoomIds.has(t.fixed_room_id)) return t.fixed_room_id;
    return null;
  }, [fixedRoomId, subjects, subjectId, teachers, teacherId, flat, groupId, busyRoomIds]);

  const pickSubject = (s: Subject) => {
    setSubjectId(s.id);
    setError(null);
    const req = remainingBySubject.get(s.id);
    if (!req) return;
    if (!teacherId) setTeacherId(String(req.teacherId));
    // From ตารางครู the list is "what this teacher still owes", so the class
    // comes with the subject.
    if (!groupSel) setGroupSel(String(req.groupId));
  };

  const effectiveRoomId = roomId ? Number(roomId) : suggestedRoomId;
  const teacherConflict = teacherId ? busyTeacherIds.has(Number(teacherId)) : false;
  const roomConflict    = effectiveRoomId != null && busyRoomIds.has(effectiveRoomId);

  const canSave =
    !busy &&
    groupId != null &&
    !groupBlocker &&
    !teacherConflict &&
    !!teacherId &&
    (tab === "pick" ? subjectId != null : !!newSubject.code.trim() && !!newSubject.name.trim());

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      let useSubjectId = subjectId;

      // "สร้างวิชาใหม่" tab — make the subject first, then use it for this lesson.
      if (tab === "new") {
        const created = await api.createSubject({
          code: newSubject.code.trim(),
          name: newSubject.name.trim(),
          type: newSubject.type,
          duration: newSubject.duration as 1 | 2,
          department_id: null,
          is_activity: false,
        });
        useTimetableStore.setState((s) => ({ subjects: [...s.subjects, created] }));
        useSubjectId = created.id;
      }
      if (useSubjectId == null) { setError("กรุณาเลือกวิชา"); return; }
      if (groupId == null) { setError("กรุณาเลือกห้องเรียน"); return; }

      await addLesson({
        group_id: groupId, day, period,
        subject_id: useSubjectId,
        teacher_id: Number(teacherId),
        room_id: effectiveRoomId,
      });
      onClose();
    } catch (e) {
      // The server knows exactly why — "คาบ 4 ไม่ใช่คาบเรียนของ ม.1-3", "ครู …
      // สอนคาบนี้อยู่แล้ว" — and from ตารางครู or ตารางห้องสอน that is the
      // whole answer. "ลองใหม่" would just send them round the same loop.
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d || "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  const freeRooms = rooms.filter((r) => !busyRoomIds.has(r.id));

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl">

        {/* Header */}
        <div className="flex items-center gap-3 bg-emerald-600 px-5 py-4 shrink-0">
          <span className="text-2xl">➕</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base leading-tight">เพิ่มคาบเรียน</h2>
            <p className="text-emerald-100 text-xs mt-0.5 truncate">
              {/* What the view you came from has already settled. */}
              {fixedTeacherId != null
                ? `ครู ${teachers.find((t) => t.id === fixedTeacherId)?.name ?? ""}`
                : fixedRoomId != null
                ? `ห้อง ${rooms.find((r) => r.id === fixedRoomId)?.name ?? ""}`
                : groupName}
              {" · "}{DAYS[day]} · {periodLabel(period, periods)} {periodTime(period, periods)}
            </p>
          </div>
          <button onClick={onClose} className="text-emerald-200 hover:text-white text-lg leading-none shrink-0">✕</button>
        </div>

        {/* Blocked: this class already has a lesson here */}
        {groupBlocker && (
          <div className="px-5 py-2.5 bg-red-50 border-b border-red-200 text-xs text-red-700 shrink-0">
            ⛔ ช่องนี้ไม่ว่าง — <strong>{groupBlocker.group_name}</strong> เรียน{" "}
            {slotLabel(groupBlocker)} อยู่แล้ว
            {groupBlocker.group_id !== groupId && " (ใช้นักเรียนกลุ่มเดียวกัน)"}
          </div>
        )}

        <div className="flex-1 overflow-hidden grid grid-cols-5">
          {/* ── Left: choose a subject ─────────────────────────────────────── */}
          <div className="col-span-2 border-r border-gray-200 flex flex-col min-h-0">
            <div className="px-4 pt-3 pb-2 shrink-0">
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {groupId == null && fixedTeacherId != null
                  ? "วิชาที่ครูคนนี้ยังสอนไม่ครบ — เลือกแล้วห้องเรียนจะถูกใส่ให้"
                  : "เลือกวิชา"}
              </p>
              <input
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                placeholder="ค้นหารหัส/ชื่อวิชา"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
              {visibleSubjects.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">ไม่พบวิชา</p>
              )}
              {visibleSubjects.map((s) => {
                const req = remainingBySubject.get(s.id);
                const active = tab === "pick" && subjectId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => { setTab("pick"); pickSubject(s); }}
                    className={clsx(
                      "w-full text-left px-2.5 py-1.5 rounded-lg border transition-colors",
                      active ? "border-emerald-400 bg-emerald-50" : "border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/40",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-gray-800 truncate">{s.code}</span>
                      {s.duration === 2 && (
                        <span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded shrink-0">คาบคู่</span>
                      )}
                      {req && (
                        <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 px-1.5 rounded-full shrink-0">
                          ขาดอีก {req.remaining}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">
                      {s.name}
                      {groupId == null && req?.groupName && (
                        <span className="text-emerald-700"> · {req.groupName}</span>
                      )}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Right: lesson details / create a new subject ────────────────── */}
          <div className="col-span-3 flex flex-col min-h-0">
            <div className="flex gap-1 px-4 pt-3 shrink-0">
              {([["pick", "ใช้วิชาที่เลือก"], ["new", "+ สร้างวิชาใหม่"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={clsx(
                    "px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 transition-colors",
                    tab === k ? "border-emerald-500 text-emerald-700" : "border-transparent text-gray-400 hover:text-gray-600",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {/* The class, when the view did not already say which one. A class
                  busy this period is shown but cannot be picked, so the reason
                  it is missing is visible rather than guessed at. */}
              {fixedGroupId == null && (
                <Field label="ห้องเรียน *">
                  <SearchableSelect
                    value={groupSel} onChange={(v) => { setGroupSel(v); setError(null); }}
                    placeholder="เลือกห้องเรียน"
                    options={groupOptions(flat).map((o) => {
                      const id = Number(o.value);
                      if (wrongLevelGroupIds.has(id))
                        return { ...o, label: `${o.label} (คาบนี้ไม่ใช่คาบเรียนของชั้นนี้)`, disabled: true };
                      if (busyGroupIds.has(id))
                        return { ...o, label: `${o.label} (มีคาบอื่นแล้ว)`, disabled: true };
                      return o;
                    })}
                  />
                </Field>
              )}

              {tab === "new" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="รหัสวิชา *">
                    <input className={inputCls} placeholder="เช่น MATH201" value={newSubject.code}
                      onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value })} />
                  </Field>
                  <Field label="ชื่อวิชา *">
                    <input className={inputCls} placeholder="เช่น คณิตศาสตร์เพิ่มเติม" value={newSubject.name}
                      onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })} />
                  </Field>
                  <Field label="ประเภท">
                    <select className={inputCls} value={newSubject.type}
                      onChange={(e) => setNewSubject({ ...newSubject, type: e.target.value as SubjectType })}>
                      <option value="common">ทั่วไป</option>
                      <option value="parallel">คู่ขนาน (สอนหลายห้องพร้อมกัน)</option>
                    </select>
                  </Field>
                  <Field label="ความยาว">
                    <select className={inputCls} value={newSubject.duration}
                      onChange={(e) => setNewSubject({ ...newSubject, duration: Number(e.target.value) })}>
                      <option value={1}>1 คาบ</option>
                      <option value={2}>2 คาบ (คาบคู่)</option>
                    </select>
                  </Field>
                  <p className="col-span-2 text-[11px] text-gray-400">
                    วิชาใหม่จะถูกบันทึกเข้าระบบ และนำมาใส่ในช่องนี้ให้ทันที
                  </p>
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {subjectId ? (
                    <>
                      <span className="font-semibold text-gray-800">
                        {subjects.find((s) => s.id === subjectId)?.code}
                      </span>
                      <span className="text-gray-500"> — {subjects.find((s) => s.id === subjectId)?.name}</span>
                    </>
                  ) : (
                    <span className="text-gray-400">ยังไม่ได้เลือกวิชา — เลือกจากรายการทางซ้าย</span>
                  )}
                </div>
              )}

              <Field label="ครูผู้สอน *">
                <SearchableSelect
                  value={teacherId} onChange={setTeacherId} placeholder="เลือกครู"
                  options={teachers.map((t) => ({
                    value: String(t.id),
                    label: busyTeacherIds.has(t.id) ? `${t.name} (ติดสอนคาบนี้)` : t.name,
                    hint: t.code ?? undefined,
                    disabled: busyTeacherIds.has(t.id),
                  }))}
                />
              </Field>

              <Field label="ห้องสอน">
                <SearchableSelect
                  value={roomId} onChange={setRoomId}
                  options={roomOptions(freeRooms)}
                  emptyLabel={suggestedRoomId
                    ? `แนะนำ: ${rooms.find((r) => r.id === suggestedRoomId)?.name ?? "-"}`
                    : "– ไม่ระบุห้อง –"}
                />
              </Field>

              {/* Conflict feedback */}
              <div className="space-y-1">
                {groupId == null && (
                  <p className="text-xs text-amber-600">เลือกห้องเรียนก่อนจึงจะบันทึกได้</p>
                )}
                {fixedTeacherId != null && teacherId !== String(fixedTeacherId) && (
                  <p className="text-xs text-amber-600">
                    เปลี่ยนครูแล้ว — คาบนี้จะไปอยู่ในตารางของครูคนใหม่ ไม่ใช่ตารางที่เปิดอยู่
                  </p>
                )}
                {fixedRoomId != null && effectiveRoomId !== fixedRoomId && (
                  <p className="text-xs text-amber-600">
                    เปลี่ยนห้องแล้ว — คาบนี้จะไม่อยู่ในตารางห้องที่เปิดอยู่
                  </p>
                )}
                {teacherConflict && (
                  <p className="text-xs text-red-600">⛔ ครูคนนี้สอนคาบอื่นอยู่แล้วในเวลานี้</p>
                )}
                {roomConflict && (
                  <p className="text-xs text-amber-600">⚠️ ห้องนี้ถูกใช้อยู่ — เลือกห้องอื่นหรือเปลี่ยนทีหลังได้</p>
                )}
                {error && <p className="text-xs text-red-600">{error}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
          <p className="text-[11px] text-gray-400 flex-1">คาบที่เพิ่มเองจะไม่ถูกล็อก — ตัวจัดตารางอัตโนมัติอาจย้ายได้ กดล็อก 🔒 ถ้าต้องการตรึงไว้</p>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg font-medium">ยกเลิก</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? "กำลังบันทึก…" : "เพิ่มคาบนี้"}
          </button>
        </div>
    </ModalShell>
  );
};

const inputCls = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-emerald-500 outline-none";

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
    {children}
  </div>
);
