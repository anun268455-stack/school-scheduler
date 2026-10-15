/**
 * ส่งต่อครู — ครูคนหนึ่งย้ายออก อีกคนรับช่วงต่อ
 *
 * "จะมีครูย้าย เราสามารถกดเลือกครูสองท่าน ซึ่งต้องมาเลือกรายวิชาที่จะโอนไปให้
 *  ซึ่งก็มีปุ่มที่โอนทั้งหมดเหมือนกัน"
 *
 * งานของครูคนหนึ่งไม่ได้อยู่ที่เดียว — แผนการสอนบอกว่าสอนอะไรให้ห้องไหน ตาราง
 * ที่จัดไว้แล้วถือชื่อเขาอยู่ทุกคาบ และคาบเสรีบางชุดเปิดวิชาของเขาให้เลือก
 * หน้านี้ทำทั้งสามที่พร้อมกัน แทนที่จะต้องไล่แก้ทีละแถวสี่สิบกว่าที่
 *
 * สิ่งเดียวที่การโอนทำให้แย่ลงได้คือครูผู้รับช่วงติดสอนอยู่แล้วในชั่วโมงนั้น
 * จึงนับให้ดูก่อนเสมอ และไม่มีคาบไหนถูกย้ายวัน/คาบ/ห้องเลย
 */
import { useEffect, useMemo, useState } from "react";
import { ModalShell } from "../common/ModalShell";
import { SearchableSelect, teacherOptions } from "../common/SearchableSelect";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { DAYS } from "../../types";

interface Props { onClose: () => void }

/** ติ๊ก/เอาออกหนึ่งรายการ — คืนชุดใหม่เสมอ เพื่อให้ React เห็นว่าเปลี่ยน */
function flip<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export const TeacherHandoverModal: React.FC<Props> = ({ onClose }) => {
  const { teachers, departments, loadAll } = useTimetableStore();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [held, setHeld] = useState<api.TeacherHoldings | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // รหัสแถวที่ติ๊กไว้ และรหัสวิชาเสรีที่ติ๊กไว้
  const [rows, setRows] = useState<Set<number>>(new Set());
  const [elec, setElec] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<api.HandoverResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<api.HandoverResult | null>(null);

  const opts = useMemo(() => teacherOptions(teachers, departments), [teachers, departments]);
  const toName = teachers.find((t) => String(t.id) === toId)?.name ?? "";

  // ของที่ครูคนนั้นถืออยู่ — โหลดใหม่ทุกครั้งที่เปลี่ยนครูต้นทาง
  useEffect(() => {
    if (!fromId) { setHeld(null); setRows(new Set()); setElec(new Set()); return; }
    setLoading(true); setErr(null); setDone(null);
    api.fetchTeacherHoldings(Number(fromId))
      .then((h) => {
        setHeld(h);
        // ติ๊กทุกอย่างไว้ก่อน — เคสที่พบบ่อยที่สุดคือโอนทั้งหมด
        setRows(new Set(h.subjects.flatMap((s) => s.classes.map((c) => c.requirement_id))));
        setElec(new Set(h.electives.map((e) => e.subject_id)));
        setOpen(new Set());
      })
      .catch(() => setErr("โหลดข้อมูลของครูคนนี้ไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [fromId]);

  // พรีวิว — นับแถว/คาบ/คาบชน โดยไม่แตะข้อมูล
  useEffect(() => {
    if (!fromId || !toId || fromId === toId) { setPreview(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.teacherHandover({
        from_teacher_id: Number(fromId), to_teacher_id: Number(toId),
        requirement_ids: [...rows], elective_subject_ids: [...elec], dry_run: true,
      }).then((r) => { if (alive) setPreview(r); })
        .catch(() => { if (alive) setPreview(null); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [fromId, toId, rows, elec]);

  const toggleRow = (id: number) => setRows((s) => flip(s, id));
  const toggleSubject = (s: api.HoldingSubject) => {
    const ids = s.classes.map((c) => c.requirement_id);
    const all = ids.every((i) => rows.has(i));
    setRows((cur) => {
      const n = new Set(cur);
      for (const i of ids) {
        if (all) n.delete(i);
        else n.add(i);
      }
      return n;
    });
  };
  const allOn = !!held
    && held.subjects.every((s) => s.classes.every((c) => rows.has(c.requirement_id)))
    && held.electives.every((e) => elec.has(e.subject_id));
  const toggleAll = () => {
    if (!held) return;
    if (allOn) { setRows(new Set()); setElec(new Set()); }
    else {
      setRows(new Set(held.subjects.flatMap((s) => s.classes.map((c) => c.requirement_id))));
      setElec(new Set(held.electives.map((e) => e.subject_id)));
    }
  };

  const picked = rows.size + elec.size;
  const canGo = !!fromId && !!toId && fromId !== toId && picked > 0 && !busy;

  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.teacherHandover({
        from_teacher_id: Number(fromId), to_teacher_id: Number(toId),
        requirement_ids: [...rows], elective_subject_ids: [...elec],
      });
      setDone(r);
      await loadAll();
      const h = await api.fetchTeacherHoldings(Number(fromId));
      setHeld(h);
      setRows(new Set(h.subjects.flatMap((s) => s.classes.map((c) => c.requirement_id))));
      setElec(new Set(h.electives.map((e) => e.subject_id)));
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d || "โอนไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" tall>
      <div className="px-5 py-3 border-b bg-gradient-to-r from-teal-600 to-teal-500 text-white flex items-center justify-between">
        <div>
          <h2 className="font-bold">ส่งต่อครู</h2>
          <p className="text-[11px] opacity-90">
            ครูคนหนึ่งย้ายออก อีกคนรับช่วงต่อ — เปลี่ยนให้ทั้งในแผนการสอนและในตารางที่จัดไว้แล้ว
            โดยไม่ขยับวัน/คาบ/ห้องของคาบไหนเลย
          </p>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
      </div>

      <div className="px-5 py-3 border-b bg-gray-50 grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            ครูที่ย้ายออก
          </span>
          <SearchableSelect value={fromId} onChange={setFromId} options={opts}
            emptyLabel="– เลือกครู –" />
        </label>
        <div className="pb-2 text-xl text-gray-400">→</div>
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            ครูที่รับช่วงต่อ
          </span>
          <SearchableSelect value={toId} onChange={setToId}
            options={opts.filter((o) => o.value !== fromId)} emptyLabel="– เลือกครู –" />
        </label>
      </div>

      <div className="flex-1 overflow-auto px-5 py-3 space-y-3">
        {err && <div className="text-rose-700 text-sm bg-rose-50 rounded px-3 py-2">{err}</div>}
        {done && (
          <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-900 rounded px-3 py-2">
            โอนให้ <strong>{done.to_teacher.name}</strong> แล้ว — {done.rows} แถวในแผนการสอน ·
            {" "}{done.slots} คาบในตาราง{done.electives ? ` · คาบเสรี ${done.electives} วิชา` : ""}
            {done.clashes.length > 0 && (
              <div className="text-rose-700 mt-1">
                ⚠ มี {done.clashes.length} คาบที่ครูคนใหม่ติดสอนอยู่แล้ว — ขึ้นกรอบแดงในตารางให้ไปแก้
              </div>
            )}
          </div>
        )}

        {!fromId && (
          <p className="text-sm text-gray-400 py-8 text-center">เลือกครูที่ย้ายออกก่อน</p>
        )}
        {loading && <p className="text-sm text-gray-400">กำลังโหลด…</p>}

        {held && !loading && (
          held.totals.rows === 0 && held.electives.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              ครูคนนี้ยังไม่มีวิชาที่สอนในแผนการสอน
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  วิชาที่จะโอน
                </h3>
                <button onClick={toggleAll}
                  className="text-xs font-semibold text-teal-700 hover:underline">
                  {allOn ? "เอาออกทั้งหมด" : "เลือกทั้งหมด"}
                </button>
              </div>

              <ul className="space-y-1.5">
                {held.subjects.map((s) => {
                  const ids = s.classes.map((c) => c.requirement_id);
                  const on = ids.filter((i) => rows.has(i)).length;
                  const expanded = open.has(s.subject_id);
                  return (
                    <li key={s.subject_id} className="border rounded">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <input type="checkbox" checked={on === ids.length}
                          ref={(el) => { if (el) el.indeterminate = on > 0 && on < ids.length; }}
                          onChange={() => toggleSubject(s)} />
                        <span className="font-bold text-sm text-gray-800">{s.code}</span>
                        <span className="text-xs text-gray-600 truncate">{s.name}</span>
                        <span className="ml-auto text-xs text-gray-500 shrink-0">
                          {ids.length} ห้อง · {s.weekly} คาบ/สัปดาห์
                          {on > 0 && on < ids.length && (
                            <span className="text-teal-700 font-semibold"> · เลือก {on}</span>
                          )}
                        </span>
                        <button
                          onClick={() => setOpen((o) => flip(o, s.subject_id))}
                          className="shrink-0 text-gray-400 hover:text-gray-700 text-xs px-1">
                          {expanded ? "▴" : "▾"}
                        </button>
                      </div>
                      {expanded && (
                        <div className="px-3 pb-2 pt-1 border-t bg-gray-50/70 flex flex-wrap gap-x-4 gap-y-1">
                          {s.classes.map((c) => (
                            <label key={c.requirement_id}
                              className="flex items-center gap-1.5 text-xs text-gray-700">
                              <input type="checkbox" checked={rows.has(c.requirement_id)}
                                onChange={() => toggleRow(c.requirement_id)} />
                              {c.group_name}
                              <span className="text-gray-400">
                                {c.placed}/{c.weekly_count}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {held.electives.length > 0 && (
                <>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-1">
                    วิชาที่เปิดให้เลือกในคาบเสรี
                  </h3>
                  <ul className="space-y-1.5">
                    {held.electives.map((e) => (
                      <li key={e.subject_id}
                        className="border rounded px-3 py-2 flex items-center gap-2">
                        <input type="checkbox" checked={elec.has(e.subject_id)}
                          onChange={() => setElec((s) => flip(s, e.subject_id))} />
                        <span className="font-bold text-sm text-gray-800">{e.code}</span>
                        <span className="text-xs text-gray-600 truncate">{e.name}</span>
                        <span className="ml-auto text-xs text-gray-500 shrink-0">
                          {e.where.slice(0, 2).join(" · ")}{e.where.length > 2 ? " …" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {held.activities.length > 0 && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 leading-relaxed">
                  ครูคนนี้ยังมีหน้าที่<strong>ดูแลกิจกรรม</strong>อยู่
                  {" "}{held.activities.map((a) => `${a.name} (${a.slots} คาบ)`).join(" · ")} —
                  ยังไม่รวมในการโอนนี้ ต้องไปเปลี่ยนที่หน้ากิจกรรมเอง
                </p>
              )}
            </>
          )
        )}
      </div>

      <div className="px-5 py-3 border-t bg-gray-50 space-y-2">
        {preview && picked > 0 && (
          <div className="text-xs">
            <span className="text-gray-700">
              จะย้าย <strong>{preview.rows}</strong> แถวในแผนการสอน ·
              {" "}<strong>{preview.slots}</strong> คาบในตาราง
              {preview.electives > 0 && <> · คาบเสรี <strong>{preview.electives}</strong> วิชา</>}
            </span>
            {preview.clashes.length > 0 ? (
              <div className="mt-1 text-rose-700">
                ⚠ <strong>{preview.clashes.length} คาบที่ {toName} ติดสอนอยู่แล้ว</strong> —
                {" "}{preview.clashes.slice(0, 3).map((c) =>
                  `${DAYS[c.day] ?? c.day} คาบ ${c.period} ${c.group_name} ชนกับ ${c.with_group}`
                ).join(" · ")}{preview.clashes.length > 3 ? " …" : ""}
                <div className="text-gray-500">
                  โอนได้ คาบพวกนี้จะขึ้นกรอบแดงในตารางให้ไปตัดสินใจทีหลัง
                </div>
              </div>
            ) : (
              <div className="mt-1 text-emerald-700">ไม่มีคาบไหนชนกับตารางของ {toName}</div>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-gray-500 flex-1 leading-relaxed">
            ย้อนกลับได้ — โอนกลับทางเดิมด้วยรายการเดิม ข้อมูลจะกลับมาเหมือนเดิมทุกอย่าง
          </p>
          <button onClick={onClose} className="px-3 py-2 rounded border text-xs">ปิด</button>
          <button onClick={apply} disabled={!canGo}
            className="px-4 py-2 rounded bg-teal-600 text-white text-xs font-semibold hover:bg-teal-500 disabled:bg-gray-300">
            {busy ? "กำลังโอน…" : `โอนให้ ${toName || "ครูที่รับช่วง"}`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
