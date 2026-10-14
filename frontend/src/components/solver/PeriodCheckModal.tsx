/**
 * ตรวจคาบสุดท้าย / คาบว่าง — ของจริงตรงกับที่โรงเรียนตั้งไว้หรือเปล่า
 *
 * "ฉันอยากได้ระบบเช็ค คาบ 9 กับ คาบว่าง ที่แต่ละห้องมี ถ้าตรงหรือเกินหรือขาด
 *  จะได้ช่วยกันดูได้"
 *
 * โรงเรียนรู้อยู่แล้วว่าห้องไหนควรเรียนถึงคาบสุดท้ายกี่คาบ และห้องไหนควรเหลือ
 * คาบว่างกี่คาบ — รู้ดีกว่าระบบ เพราะมันมาจากหลักสูตรของแต่ละห้อง หน้านี้จึง
 * ไม่เดาให้ แต่รับตัวเลขนั้นมาเก็บไว้ แล้วบอกว่าตารางที่จัดออกมาตรง เกิน หรือ
 * ขาดไปกี่คาบ
 *
 * ช่องกรอกทีละห้องสำหรับแก้ทีหลัง · ช่องวางข้อความสำหรับครั้งแรก เพราะตาราง
 * ชุดแรกมาเป็นข้อความอยู่แล้ว ("ม.2/1 - 6  มี 1 คาบ")
 */
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ModalShell } from "../common/ModalShell";
import * as api from "../../api/client";
import { parseTargets } from "../../utils/periodTargets";

type Row = api.PeriodCheckRow;

export const PeriodCheckModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [data, setData] = useState<api.PeriodCheckReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<number, { last?: string; free?: string }>>({});
  const [onlyOff, setOnlyOff] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.fetchPeriodCheck().then((d) => { setData(d); setEdits({}); })
      .catch(() => setErr("ตรวจไม่สำเร็จ — ลองใหม่อีกครั้ง"));
  };
  useEffect(load, []);

  const rows = data?.rows ?? [];
  const shown = useMemo(
    () => (onlyOff
      ? rows.filter((r) => (r.verdict_last && r.verdict_last !== "ตรง")
                        || (r.verdict_free && r.verdict_free !== "ตรง")
                        || r.overflow > 0)
      : rows),
    [rows, onlyOff]);

  const valOf = (r: Row, k: "last" | "free") => {
    const e = edits[r.group_id]?.[k];
    if (e !== undefined) return e;
    const v = k === "last" ? r.want_last : r.want_free;
    return v == null ? "" : String(v);
  };
  const setVal = (r: Row, k: "last" | "free", v: string) =>
    setEdits((m) => ({ ...m, [r.group_id]: { ...m[r.group_id], [k]: v } }));

  const save = async () => {
    const targets = Object.entries(edits).map(([gid, e]) => ({
      group_id: Number(gid),
      ...(e.last !== undefined ? { last: e.last === "" ? null : Number(e.last) } : {}),
      ...(e.free !== undefined ? { free: e.free === "" ? null : Number(e.free) } : {}),
    }));
    if (!targets.length) return;
    setBusy(true);
    try {
      const d = await api.savePeriodTargets(targets);
      setData(d); setEdits({});
      setNote(`บันทึกที่ตั้งไว้แล้ว ${targets.length} ห้อง`);
    } catch {
      setErr("บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally { setBusy(false); }
  };

  const applyPaste = async () => {
    const p = parseTargets(paste, rows);
    if (!p.targets.length) {
      setNote("อ่านไม่ออกสักบรรทัด — ต้องมีคำว่า “มี …คาบ” หรือ “ว่าง …คาบ” ต่อท้ายชื่อห้อง");
      return;
    }
    setBusy(true);
    try {
      const d = await api.savePeriodTargets(p.targets);
      setData(d); setEdits({}); setPaste(""); setPasteOpen(false);
      setNote(`ตั้งค่าให้ ${p.targets.length} ห้องจาก ${p.matched.length} บรรทัด`
        + (p.missed.length ? ` · อ่านไม่ออก ${p.missed.length} บรรทัด: ${p.missed.slice(0, 2).join(" / ")}` : ""));
    } catch {
      setErr("บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally { setBusy(false); }
  };

  const Verdict: React.FC<{ v: string | null }> = ({ v }) =>
    !v ? <span className="text-gray-300">—</span> : (
      <span className={clsx("px-1.5 py-0.5 rounded text-[11px] font-semibold",
        v === "ตรง" ? "bg-emerald-100 text-emerald-800"
          : v === "เกิน" ? "bg-rose-100 text-rose-800"
            : "bg-amber-100 text-amber-800")}>{v}</span>
    );

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-5xl" tall>
      <div className="px-5 py-3 border-b bg-gradient-to-r from-indigo-600 to-indigo-500 text-white flex items-center justify-between">
        <div>
          <h2 className="font-bold">ตรวจคาบสุดท้าย / คาบว่าง ของแต่ละห้อง</h2>
          <p className="text-[11px] opacity-90">
            เทียบตารางที่จัดออกมา กับจำนวนที่โรงเรียนตั้งไว้ — ตรง เกิน หรือขาด
          </p>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
      </div>

      <div className="px-5 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3 text-xs">
        {data && (
          <>
            <span className="text-gray-600">
              {data.total} ห้อง · เรียนถึงคาบสุดท้าย <strong>{data.with_last}</strong> ห้อง
              ({data.last_slots} คาบ)
            </span>
            {data.overflow > 0 && (
              <span className="text-rose-700 font-semibold">
                ⚠ คาบกรอบแดง {data.overflow} คาบ
              </span>
            )}
            <span className={clsx("font-semibold",
              data.off ? "text-amber-700" : "text-emerald-700")}>
              {data.set === 0 ? "ยังไม่ได้ตั้งค่าไว้สักห้อง"
                : data.off ? `ไม่ตรงกับที่ตั้งไว้ ${data.off} ห้อง`
                  : `ตรงกับที่ตั้งไว้ทุกห้อง (${data.set} ห้อง)`}
            </span>
          </>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-gray-600">
          <input type="checkbox" checked={onlyOff} onChange={(e) => setOnlyOff(e.target.checked)} />
          แสดงเฉพาะห้องที่ไม่ตรง
        </label>
        <button onClick={() => setPasteOpen((v) => !v)}
          className="px-2 py-1 rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-semibold">
          📋 วางตารางที่เขียนไว้
        </button>
        <button onClick={load}
          className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100">
          ตรวจใหม่
        </button>
      </div>

      {pasteOpen && (
        <div className="px-5 py-3 border-b bg-indigo-50/60 space-y-2">
          <p className="text-[11px] text-gray-600 leading-relaxed">
            วางได้ทั้งก้อน บรรทัดละห้อง เช่น <code>ม.2/1 - 6  มี 1 คาบ</code> ·
            <code> ม.4/6 ก ข  ว่าง 2 คาบ</code> ·
            <strong>“มี”</strong> คือเรียนถึงคาบสุดท้ายกี่คาบ
            <strong> “ว่าง”</strong> คือเหลือคาบว่างกี่คาบ (และแปลว่าไม่มีคาบสุดท้าย)
            บรรทัดที่ไม่มีสองคำนี้จะถูกข้าม
          </p>
          <textarea
            value={paste} onChange={(e) => setPaste(e.target.value)}
            rows={6} spellCheck={false}
            className="w-full border rounded p-2 font-mono text-xs"
            placeholder={"ม.2/1 - 6  มี 1 คาบ\nม.3/5 - 14  ว่าง 2 คาบ\nม.4/6 ก ข  ว่าง 2 คาบ"}
          />
          <div className="flex gap-2">
            <button onClick={applyPaste} disabled={busy || !paste.trim()}
              className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 disabled:bg-gray-300">
              อ่านแล้วบันทึก
            </button>
            <button onClick={() => { setPaste(""); setPasteOpen(false); }}
              className="px-3 py-1.5 rounded border text-xs">ยกเลิก</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-5 py-3">
        {err && <div className="text-rose-700 text-sm">{err}</div>}
        {note && <div className="mb-2 text-xs text-indigo-800 bg-indigo-50 rounded px-2 py-1">{note}</div>}
        {!data && !err && <div className="text-gray-400 text-sm">กำลังตรวจ…</div>}
        {data && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500 border-b">
                <th className="py-1.5 pr-2">ห้อง</th>
                <th className="py-1.5 px-2 text-center">คาบสุดท้าย<br /><span className="font-normal">ที่จัดได้</span></th>
                <th className="py-1.5 px-2 text-center">ที่ตั้งไว้</th>
                <th className="py-1.5 px-2 text-center">ผล</th>
                <th className="py-1.5 px-2 text-center">คาบว่าง<br /><span className="font-normal">ที่จัดได้</span></th>
                <th className="py-1.5 px-2 text-center">ที่ตั้งไว้</th>
                <th className="py-1.5 px-2 text-center">ผล</th>
                <th className="py-1.5 px-2 text-center">ว่างกลางวัน</th>
                <th className="py-1.5 px-2 text-center">กรอบแดง</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.group_id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-1 pr-2 font-medium text-gray-800">{r.name}</td>
                  <td className="py-1 px-2 text-center font-semibold">{r.last}</td>
                  <td className="py-1 px-2 text-center">
                    <input value={valOf(r, "last")} inputMode="numeric"
                      onChange={(e) => setVal(r, "last", e.target.value.replace(/\D/g, ""))}
                      className="w-12 border rounded px-1 py-0.5 text-center" />
                  </td>
                  <td className="py-1 px-2 text-center"><Verdict v={r.verdict_last} /></td>
                  <td className="py-1 px-2 text-center font-semibold">{r.free}</td>
                  <td className="py-1 px-2 text-center">
                    <input value={valOf(r, "free")} inputMode="numeric"
                      onChange={(e) => setVal(r, "free", e.target.value.replace(/\D/g, ""))}
                      className="w-12 border rounded px-1 py-0.5 text-center" />
                  </td>
                  <td className="py-1 px-2 text-center"><Verdict v={r.verdict_free} /></td>
                  <td className={clsx("py-1 px-2 text-center",
                    r.gaps > 1 ? "text-amber-700 font-semibold" : "text-gray-500")}>
                    {r.gaps || "—"}
                  </td>
                  <td className={clsx("py-1 px-2 text-center",
                    r.overflow ? "text-rose-700 font-bold" : "text-gray-300")}>
                    {r.overflow || "—"}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={9} className="py-6 text-center text-emerald-700">
                  ทุกห้องตรงกับที่ตั้งไว้
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-5 py-3 border-t bg-gray-50 flex items-center gap-3">
        <p className="text-[11px] text-gray-500 leading-relaxed flex-1">
          <strong>คาบว่าง</strong> นับเฉพาะช่องว่างในคาบก่อนคาบสุดท้าย — คอลัมน์คาบสุดท้ายที่ว่าง
          คือเลิกเรียนแล้ว ไม่ใช่คาบว่าง · <strong>ว่างกลางวัน</strong> คือช่องว่างที่ยังมีคาบเรียน
          ตามมาในวันนั้น (นักเรียนต้องรอ) · ห้องย่อยนับเวลาที่ห้องแม่เรียนเป็นเวลาที่ไม่ว่างด้วย
        </p>
        <button onClick={save} disabled={busy || !Object.keys(edits).length}
          className="px-4 py-2 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 disabled:bg-gray-300">
          {busy ? "กำลังบันทึก…" : `บันทึกที่ตั้งไว้${Object.keys(edits).length ? ` (${Object.keys(edits).length})` : ""}`}
        </button>
      </div>
    </ModalShell>
  );
};
