/**
 * LevelActivityPanel — pin one activity onto every classroom of a whole level.
 *
 * The case this exists for: "สาธารณประโยชน์ ของ ม.5 ทุกห้อง อยู่คาบ 7".
 * Pick the level, the day, the period and the activity, and every top-level
 * classroom in that level gets the same locked period. Subgroups (ก/ข/ค) are
 * skipped on purpose — a whole-class activity belongs to the whole class.
 *
 * The created periods are locked, so the auto-scheduler never books over them.
 */
import React, { useMemo, useState } from "react";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { DAYS, periodLabel, periodTime } from "../../types";

export const LevelActivityPanel: React.FC = () => {
  const { groups, subjects, teachers, slots, periods, loadSlots } = useTimetableStore();

  const [form, setForm] = useState({
    level: "", day: "0", period: "", subject_id: "",
    // "homeroom" | "none" | a teacher id as a string
    teacher_choice: "homeroom",
    room_mode: "homeroom" as "homeroom" | "none",
  });
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState<{ created: number; skipped: { group: string; reason: string }[]; warnings: string[] } | null>(null);
  const [error, setError]     = useState<string | null>(null);

  // Levels that actually have classrooms, in order.
  const levels = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) if (!g.parent_id && g.level) set.add(g.level);
    return [...set].sort();
  }, [groups]);

  const classPeriods = useMemo(
    () => [...new Map(periods.filter((p) => p.type === "class").map((p) => [p.period_num, p])).values()]
      .sort((a, b) => a.period_num - b.period_num),
    [periods],
  );

  const targetClasses = useMemo(
    () => groups.filter((g) => !g.parent_id && g.level === form.level),
    [groups, form.level],
  );

  // Existing activity blocks, grouped by activity_key.
  const existing = useMemo(() => {
    const m = new Map<string, { key: string; level: string; day: number; period: number; subject: string; classes: string[]; teacher: string | null }>();
    for (const s of slots) {
      if (!s.is_activity_block || !s.activity_key) continue;
      const cur = m.get(s.activity_key);
      if (cur) { cur.classes.push(s.group_name ?? ""); continue; }
      m.set(s.activity_key, {
        key: s.activity_key,
        level: s.activity_level ?? "",
        day: s.day, period: s.period,
        subject: s.subject_code ?? s.subject_name ?? "",
        classes: [s.group_name ?? ""],
        teacher: s.teacher_name ?? null,
      });
    }
    return [...m.values()].sort((a, b) => a.level.localeCompare(b.level) || a.day - b.day || a.period - b.period);
  }, [slots]);

  const missingHomeroom = useMemo(
    () => targetClasses.filter((g) => !g.homeroom_teacher_id),
    [targetClasses],
  );

  const canCreate = !!form.level && form.period !== "" && !!form.subject_id && !busy;

  const handleCreate = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const choice = form.teacher_choice;
      const res = await api.createLevelActivity({
        level: form.level,
        day: Number(form.day),
        period: Number(form.period),
        subject_id: Number(form.subject_id),
        teacher_mode: choice === "homeroom" ? "homeroom" : choice === "none" ? "none" : "single",
        teacher_id: choice !== "homeroom" && choice !== "none" ? Number(choice) : null,
        room_mode: form.room_mode,
      });
      await loadSlots();
      setResult({ created: res.created.length, skipped: res.skipped, warnings: res.warnings ?? [] });
    } catch {
      setError("สร้างคาบกิจกรรมไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (key: string) => {
    setBusy(true);
    try {
      await api.deleteLevelActivity(key);
      await loadSlots();
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6">
      <h2 className="text-base font-bold text-gray-800 mb-3">คาบกิจกรรมประจำระดับชั้น</h2>

      <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 mb-4 text-xs text-teal-900 leading-relaxed">
        <strong>ใช้ทำอะไร:</strong> ตั้งคาบที่ทุกห้องในระดับชั้นเดียวกันทำพร้อมกัน เช่น
        <em> สาธารณประโยชน์ของ ม.5 ทุกห้อง อยู่คาบ 7 วันพุธ</em>
        <br/>ระบบจะสร้างคาบนี้ให้ทุกห้องในระดับที่เลือก และ<strong>ล็อกไว้</strong> — ตัวจัดตารางอัตโนมัติจะไม่วางวิชาอื่นทับ
        <br/>ห้องย่อย (ก/ข/ค) จะไม่ถูกสร้างซ้ำ เพราะกิจกรรมเป็นของทั้งห้องอยู่แล้ว
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="ระดับชั้น *">
          <select className={inputCls} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
            <option value="">เลือกระดับ</option>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="วัน *">
          <select className={inputCls} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="คาบ *">
          <select className={inputCls} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
            <option value="">เลือกคาบ</option>
            {classPeriods.map((p) => (
              <option key={p.period_num} value={p.period_num}>{p.label} ({p.start_time}–{p.end_time})</option>
            ))}
          </select>
        </Field>
        <Field label="กิจกรรม/วิชา *">
          <select className={inputCls} value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
            <option value="">เลือกกิจกรรม</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
          </select>
        </Field>
        <Field label="ครูผู้ดูแล">
          <select className={inputCls} value={form.teacher_choice}
            onChange={(e) => setForm({ ...form, teacher_choice: e.target.value })}>
            <option value="homeroom">👩‍🏫 ครูประจำชั้นของแต่ละห้อง</option>
            <option value="none">– ไม่ระบุครู –</option>
            <optgroup label="ครูคนเดียวดูแลทุกห้อง">
              {teachers.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
            </optgroup>
          </select>
        </Field>
        <Field label="ห้องที่ใช้">
          <select className={inputCls} value={form.room_mode}
            onChange={(e) => setForm({ ...form, room_mode: e.target.value as "homeroom" | "none" })}>
            <option value="homeroom">ห้องประจำชั้นของแต่ละห้อง</option>
            <option value="none">ไม่ระบุห้อง</option>
          </select>
        </Field>
      </div>

      {form.level && (
        <p className="text-xs text-gray-500 mb-2">
          จะสร้างให้ {targetClasses.length} ห้อง:{" "}
          <span className="text-gray-700">{targetClasses.map((g) => g.name).join(", ") || "– ไม่พบห้องในระดับนี้ –"}</span>
        </p>
      )}
      {form.teacher_choice === "homeroom" && form.level && (
        missingHomeroom.length > 0 ? (
          <p className="text-xs text-amber-600 mb-2">
            ⚠️ ยังไม่ได้ตั้งครูประจำชั้น: {missingHomeroom.map((g) => g.name).join(", ")} —
            ห้องเหล่านี้จะได้คาบกิจกรรมแต่ไม่มีครู (ตั้งได้ที่หน้า "ห้องเรียน")
          </p>
        ) : (
          <p className="text-xs text-gray-400 mb-2">
            💡 ครูประจำชั้นของแต่ละห้องจะได้คาบนี้ลงในตารางสอนของตัวเองด้วย
          </p>
        )
      )}
      {form.teacher_choice === "none" && (
        <p className="text-xs text-gray-400 mb-2">
          💡 ไม่ระบุครู = ครูทุกคนยังว่างในคาบนั้น นักเรียนได้คาบกิจกรรมอย่างเดียว
        </p>
      )}

      <button onClick={handleCreate} disabled={!canCreate}
        className="px-3 py-1.5 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 font-medium disabled:opacity-40">
        {busy ? "กำลังสร้าง…" : "+ สร้างคาบกิจกรรมให้ทุกห้องในระดับนี้"}
      </button>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
          ✅ สร้างแล้ว {result.created} ห้อง
          {result.warnings.length > 0 && (
            <div className="mt-1 text-amber-700 space-y-0.5">
              {result.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="mt-1 text-amber-700">
              ⚠️ ข้าม {result.skipped.length} ห้องที่มีคาบอยู่แล้ว:{" "}
              {result.skipped.map((s) => `${s.group} (${s.reason})`).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Existing activities */}
      <div className="mt-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">คาบกิจกรรมที่ตั้งไว้แล้ว</p>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["ระดับ", "วัน", "คาบ", "กิจกรรม", "ครูผู้ดูแล", "ห้องที่ใช้", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {existing.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีคาบกิจกรรมประจำระดับ</td></tr>
              )}
              {existing.map((a) => (
                <tr key={a.key} className="hover:bg-teal-50/30">
                  <td className="px-3 py-2 font-medium text-teal-700">{a.level}</td>
                  <td className="px-3 py-2 text-gray-600">{DAYS[a.day]}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {periodLabel(a.period, periods)}
                    <span className="text-gray-400 text-[11px] ml-1">{periodTime(a.period, periods)}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{a.subject}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{a.teacher ?? "– ไม่ระบุ –"}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{a.classes.length} ห้อง</td>
                  <td className="px-3 py-2">
                    <button onClick={() => handleDelete(a.key)} disabled={busy}
                      className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 border border-red-200">
                      ลบทั้งระดับ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const inputCls = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-teal-500 outline-none";

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
    {children}
  </div>
);
