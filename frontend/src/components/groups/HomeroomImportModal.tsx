/**
 * นำเข้าครูประจำชั้นทั้งโรงเรียนในครั้งเดียว.
 *
 * Setting 93 classes one dialog at a time is an afternoon's work, and the
 * office already keeps this list somewhere — a column in their staff
 * spreadsheet, or a printed sheet. This takes that list as it is.
 *
 * The screen exists because the matching must not be trusted silently. A name
 * typed or read slightly wrong would otherwise land on whichever teacher
 * looked closest, and a wrong ครูประจำชั้น is not something anyone notices
 * later. So every uncertain line is shown with what it nearly matched and
 * waits for a person, and nothing is written until they press the button.
 */
import { useMemo, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups } from "../../utils/groupHierarchy";
import { HOMEROOM_MAX } from "../../utils/homeroom";
import {
  parseHomeroomText, findOverfilled, buildChanges, type ParsedRow,
} from "../../utils/homeroomImport";

interface Props {
  onClose: () => void;
  onApply: (changes: { groupId: number; teacherIds: number[] }[]) => Promise<void>;
}

const SAMPLE = `นางสาวพิชชาภา รัตนมลิกา\t2/8
นายทัศนัย ยาระณะ\t1/9
นางพัชรี อ่อนอุระ\tม.2/14`;

export const HomeroomImportModal = ({ onClose, onApply }: Props) => {
  const { groups, teachers } = useTimetableStore();
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const [text, setText] = useState("");
  /** Line number → teacher id the person picked for an uncertain line. */
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(
    () => parseHomeroomText(text, teachers, flat), [text, teachers, flat]);

  /** The person's choices folded in, so everything below counts the same way. */
  const resolved: ParsedRow[] = useMemo(() => rows.map((r) => {
    const id = picked[r.line];
    if (!id || r.status === "ok" || !r.group) return r;
    const t = teachers.find((x) => x.id === id);
    return t ? { ...r, teacher: t, status: "ok" as const } : r;
  }), [rows, picked, teachers]);

  const count = (s: string) => resolved.filter((r) => r.status === s).length;
  const needsEye = resolved.filter(
    (r) => r.status === "ambiguous" || r.status === "no-teacher" || r.status === "no-class");
  const conflicts = findOverfilled(resolved, HOMEROOM_MAX);
  const changes = buildChanges(resolved, HOMEROOM_MAX);

  const uncovered = useMemo(() => {
    const hit = new Set(changes.map((c) => c.groupId));
    return flat.filter((g) => !hit.has(g.id)).map((g) => g.name);
  }, [changes, flat]);

  const apply = async () => {
    setBusy(true); setErr(null); setDone(null);
    try {
      await onApply(changes.map(({ groupId, teacherIds }) => ({ groupId, teacherIds })));
      setDone(`บันทึกแล้ว ${changes.length} ห้อง`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3">
        <h3 className="text-base font-bold text-gray-800">
          👩‍🏫 นำเข้าครูประจำชั้นจากรายชื่อ
        </h3>
        <div className="text-xs bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-3 py-2 leading-relaxed">
          วางรายชื่อได้เลย <strong>บรรทัดละหนึ่งคน</strong> รูปแบบ “ชื่อครู” เว้นวรรคหรือ Tab แล้วตามด้วย “ชั้น”
          เช่น <code>นางสาวพิชชาภา รัตนมลิกา 2/8</code> · ใส่ <code>ม.</code> นำหน้าชั้นหรือไม่ก็ได้
          · ห้องเดียวกันใส่ได้สูงสุด {HOMEROOM_MAX} คน โดยใส่คนละบรรทัด
          <br />
          บรรทัดที่ไม่มีชั้นต่อท้ายจะถูกข้ามไป ไม่ถือว่าผิด
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setPicked({}); setDone(null); }}
          rows={8}
          spellCheck={false}
          placeholder={SAMPLE}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
        />

        {rows.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900">
              จับคู่ได้ <strong>{count("ok")}</strong>
            </span>
            {count("ambiguous") > 0 && (
              <span className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-900">
                ต้องยืนยัน <strong>{count("ambiguous")}</strong>
              </span>
            )}
            {count("no-teacher") > 0 && (
              <span className="px-2 py-1 rounded-md bg-red-50 border border-red-200 text-red-800">
                ไม่พบชื่อครู <strong>{count("no-teacher")}</strong>
              </span>
            )}
            {count("no-class") > 0 && (
              <span className="px-2 py-1 rounded-md bg-red-50 border border-red-200 text-red-800">
                ไม่พบห้องเรียน <strong>{count("no-class")}</strong>
              </span>
            )}
            {count("blank") > 0 && (
              <span className="px-2 py-1 rounded-md bg-gray-50 border border-gray-200 text-gray-600">
                ข้าม (ไม่มีชั้น) <strong>{count("blank")}</strong>
              </span>
            )}
          </div>
        )}

        {needsEye.length > 0 && (
          <div className="border border-amber-300 rounded-lg overflow-hidden">
            <div className="bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
              ต้องให้คุณดูเอง {needsEye.length} บรรทัด — ระบบจะไม่เดาให้
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
              {needsEye.map((r) => (
                <div key={r.line} className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-gray-400 w-10">#{r.line}</span>
                  <span className="font-semibold min-w-[170px]">{r.nameText || "(ไม่มีชื่อ)"}</span>
                  <span className="text-gray-500 w-16">{r.classText || "–"}</span>
                  {r.status === "no-class" ? (
                    <span className="text-red-700">ไม่มีห้อง “{r.classText}” ในระบบ</span>
                  ) : r.candidates.length ? (
                    <select
                      className="px-2 py-1 border border-gray-300 rounded-md text-xs"
                      value={picked[r.line] ?? ""}
                      onChange={(e) => setPicked((p) => ({ ...p, [r.line]: Number(e.target.value) }))}
                    >
                      <option value="">— เลือกครูที่ใช่ —</option>
                      {r.candidates.map((c) => (
                        <option key={c.teacher.id} value={c.teacher.id}>
                          {c.teacher.name} ({Math.round(c.score * 100)}%)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-red-700">ไม่พบครูชื่อใกล้เคียงเลย — อาจยังไม่ได้เพิ่มครูคนนี้</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="text-xs bg-red-50 border border-red-300 text-red-900 rounded-lg px-3 py-2">
            <strong>ห้องที่มีครูเกิน {HOMEROOM_MAX} คน</strong> — ระบบจะเก็บ {HOMEROOM_MAX} คนแรกตามลำดับบรรทัด
            กรุณาลบบรรทัดที่ไม่ต้องการออกก่อน
            <ul className="mt-1 space-y-0.5">
              {conflicts.map((c) => (
                <li key={c.groupName}>• {c.groupName}: {c.names.join(" / ")}</li>
              ))}
            </ul>
          </div>
        )}

        {changes.length > 0 && uncovered.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-600">
              ห้องที่รายการนี้ไม่ได้ระบุครูประจำชั้น {uncovered.length} ห้อง (ของเดิมจะไม่ถูกแตะ)
            </summary>
            <p className="mt-1 text-gray-500 leading-relaxed">{uncovered.join(", ")}</p>
          </details>
        )}

        {done && (
          <p className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg px-3 py-2">{done}</p>
        )}
        {err && (
          <p className="text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2">{err}</p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">
            ปิด
          </button>
          <button
            onClick={apply}
            disabled={busy || changes.length === 0}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? "กำลังบันทึก…" : `บันทึกครูประจำชั้น ${changes.length} ห้อง`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
