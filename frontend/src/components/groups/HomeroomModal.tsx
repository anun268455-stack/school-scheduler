/**
 * ครูประจำชั้น — set in a dialog instead of a dropdown in the table row.
 *
 * It used to be a select sitting in the table, listing all 93 classes against
 * each of 143 teachers. Two problems came from that: the row was crowded with
 * a control nobody touches most days, and any class that already had a teacher
 * was greyed out — so a teacher added later could not be made ครูประจำชั้น of
 * anything, because every class in the school was already taken.
 *
 * A class may now hold two, and the dialog is the one place this is decided,
 * whether it is opened from a class ("who advises this class") or from a
 * teacher ("which class does this teacher advise").
 */
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import { matches } from "../common/TableSearch";
import type { StudentGroup, Teacher } from "../../types";
import {
  homeroomIds, HOMEROOM_MAX, familyRootId, inheritsHomeroom,
} from "../../utils/homeroom";

interface Props {
  /** Opened from a class: choose up to two teachers for it. */
  group?: StudentGroup;
  /** Opened from a teacher: choose which classes they advise. */
  teacher?: Teacher;
  groups: StudentGroup[];
  teachers: Teacher[];
  /** Called with every change that must be written, as whole class rows. */
  onApply: (changes: { groupId: number; teacherIds: number[] }[]) => Promise<void>;
  onClose: () => void;
}

export const HomeroomModal: React.FC<Props> = ({
  group, teacher, groups, teachers, onApply, onClose,
}) => {
  const byClass = !!group;

  // Working copy: class id → its teachers. Only touched rows are written.
  const [draft, setDraft] = useState<Record<number, number[]>>(() => {
    const d: Record<number, number[]> = {};
    for (const g of groups) d[g.id] = homeroomIds(g);
    return d;
  });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const teacherName = (id: number) => {
    const t = teachers.find((x) => x.id === id);
    return t ? (t.code ? `${t.code} ${t.name}` : t.name) : `#${id}`;
  };

  const original = useMemo(() => {
    const d: Record<number, number[]> = {};
    for (const g of groups) d[g.id] = homeroomIds(g);
    return d;
  }, [groups]);

  const toggleTeacher = (tid: number) => {
    if (!group) return;
    const cur = draft[group.id] ?? [];
    const next = cur.includes(tid)
      ? cur.filter((x) => x !== tid)
      : cur.length >= HOMEROOM_MAX ? cur : [...cur, tid];
    setDraft({ ...draft, [group.id]: next });
  };

  const toggleClass = (gid: number) => {
    if (!teacher) return;
    const cur = draft[gid] ?? [];
    const next = cur.includes(teacher.id)
      ? cur.filter((x) => x !== teacher.id)
      : cur.length >= HOMEROOM_MAX ? cur : [...cur, teacher.id];
    setDraft({ ...draft, [gid]: next });
  };

  const save = async () => {
    setBusy(true);
    try {
      const changes = Object.entries(draft)
        .filter(([gid, ids]) => {
          const was = original[Number(gid)] ?? [];
          return was.length !== ids.length || was.some((x, i) => x !== ids[i]);
        })
        .map(([gid, ids]) => ({ groupId: Number(gid), teacherIds: ids }));
      await onApply(changes);
      onClose();
    } finally { setBusy(false); }
  };

  const chosenHere = group ? (draft[group.id] ?? []) : [];
  const full = chosenHere.length >= HOMEROOM_MAX;

  /** Root class id → the teachers advising that family, from the draft. */
  const familyOf = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const g of groups) {
      const ids = draft[g.id] ?? [];
      if (!ids.length) continue;
      const r = familyRootId(g, groups) ?? g.id;
      m.set(r, [...(m.get(r) ?? []), ...ids]);
    }
    return m;
  }, [draft, groups]);

  /** The other family this teacher already belongs to, if any. */
  const otherFamily = (tid: number, forGroup: StudentGroup) => {
    const mine = familyRootId(forGroup, groups);
    for (const [root, ids] of familyOf) {
      if (root !== mine && ids.includes(tid)) {
        return groups.find((g) => g.id === root)?.name ?? null;
      }
    }
    return null;
  };

  const shownTeachers = teachers.filter((t) => matches(q, t.code, t.name));
  // Sub-classes take their advisors from the class above, so they are not
  // picked here; showing them as choices would offer a setting that the
  // inheritance immediately overrules.
  const shownGroups = groups.filter(
    (g) => matches(q, g.name, g.level) && !g.parent_id);

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center gap-3 bg-blue-700 px-5 py-4 shrink-0">
        <span className="text-2xl">👩‍🏫</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base leading-tight truncate">
            ครูประจำชั้น — {byClass ? group!.name
              : `${teacher!.code ? `${teacher!.code} ` : ""}${teacher!.name}`}
          </h2>
          <p className="text-blue-100 text-xs mt-0.5">
            {byClass
              ? `เลือกได้สูงสุด ${HOMEROOM_MAX} คนต่อห้อง · เลือกแล้ว ${chosenHere.length}`
              : "เลือกห้องที่ครูท่านนี้เป็นครูประจำชั้น (ได้ห้องเดียว)"}
          </p>
        </div>
        <button onClick={onClose} className="text-blue-200 hover:text-white text-lg leading-none shrink-0">✕</button>
      </div>

      <div className="px-5 pt-3 shrink-0">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={byClass ? "ค้นหาชื่อครู / รหัสครู" : "ค้นหาชื่อห้อง / ระดับ"}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
        {byClass && inheritsHomeroom(group!, groups) && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
            {group!.name} เป็นห้องลูก — ครูประจำชั้นตามห้องแม่
            <strong> {groups.find((g) => g.id === group!.parent_id)?.name}</strong> โดยอัตโนมัติ
            ถ้าต้องการเปลี่ยน ให้ไปตั้งที่ห้องแม่
          </p>
        )}

        {byClass && shownTeachers.map((t) => {
          const on = chosenHere.includes(t.id);
          // One teacher, one class. A parent and its sub-classes count as the
          // one class they are, so advising ม.4/6 does not also use up the
          // teacher on ม.4/6ก.
          const taken = otherFamily(t.id, group!);
          const blocked = !on && (full || !!taken);
          return (
            <button key={t.id} onClick={() => !taken && toggleTeacher(t.id)}
              disabled={blocked}
              title={taken ? `เป็นครูประจำชั้น ${taken} อยู่แล้ว — ครู 1 คนประจำได้ห้องเดียว` : undefined}
              className={clsx("w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors",
                on ? "bg-blue-600 border-blue-700 text-white"
                   : blocked ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                          : "bg-white border-gray-200 hover:border-blue-400")}>
              <span className="text-sm font-medium flex-1 min-w-0 truncate">
                {t.code ? `${t.code} ` : ""}{t.name}
              </span>
              {taken && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border shrink-0 bg-amber-50 border-amber-200 text-amber-700">
                  ประจำ {taken} อยู่แล้ว
                </span>
              )}
              {on && <span className="text-xs shrink-0">✓</span>}
            </button>
          );
        })}

        {!byClass && shownGroups.map((g) => {
          const ids = draft[g.id] ?? [];
          const on = ids.includes(teacher!.id);
          const others = ids.filter((x) => x !== teacher!.id);
          const classFull = !on && ids.length >= HOMEROOM_MAX;
          // Already advising somewhere else: picking a second class is the
          // thing this rule exists to prevent, so the rest are closed off
          // until that one is released.
          const elsewhere = !on && [...familyOf.entries()]
            .find(([root, list]) => root !== g.id && list.includes(teacher!.id));
          const takenName = elsewhere
            ? groups.find((x) => x.id === elsewhere[0])?.name ?? null : null;
          const blocked = classFull || !!takenName;
          const kids = groups.filter((x) => x.parent_id === g.id).map((x) => x.name);
          return (
            <button key={g.id} onClick={() => !blocked && toggleClass(g.id)}
              disabled={blocked}
              title={takenName ? `ประจำ ${takenName} อยู่แล้ว — ครู 1 คนประจำได้ห้องเดียว` : undefined}
              className={clsx("w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors",
                on ? "bg-blue-600 border-blue-700 text-white"
                   : blocked ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                               : "bg-white border-gray-200 hover:border-blue-400")}>
              <span className="text-sm font-medium flex-1 min-w-0 truncate">
                {g.name}
                {kids.length > 0 && (
                  <span className={clsx("ml-1 text-[10px]", on ? "text-blue-100" : "text-gray-400")}>
                    (รวมห้องลูก {kids.join(", ")})
                  </span>
                )}
              </span>
              {takenName && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border shrink-0 bg-amber-50 border-amber-200 text-amber-700">
                  ประจำ {takenName} อยู่แล้ว
                </span>
              )}
              {!takenName && others.length > 0 && (
                <span className={clsx("text-[10px] px-1.5 py-0.5 rounded border shrink-0",
                  on ? "bg-blue-500 border-blue-400 text-white"
                     : "bg-gray-100 border-gray-200 text-gray-600")}>
                  {others.map(teacherName).join(", ")}
                  {classFull && " · เต็มแล้ว"}
                </span>
              )}
              {on && <span className="text-xs shrink-0">✓</span>}
            </button>
          );
        })}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
        <p className="text-[11px] text-gray-500 flex-1 leading-relaxed">
          {byClass
            ? `ห้องหนึ่งมีครูประจำชั้นได้ ${HOMEROOM_MAX} คน · แต่ครู 1 คนประจำได้ห้องเดียว`
            : "ครู 1 คนประจำได้ห้องเดียว · ห้องแม่ครอบคลุมห้องลูกให้เอง"}
        </p>
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ยกเลิก</button>
        <button onClick={save} disabled={busy}
          className="px-5 py-2 text-sm bg-blue-700 text-white rounded-lg font-semibold hover:bg-blue-800 disabled:opacity-40">
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </ModalShell>
  );
};
