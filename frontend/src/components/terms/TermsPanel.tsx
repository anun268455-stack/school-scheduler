/**
 * รายการเทอม — ทุกเทอมที่เซิร์ฟเวอร์เก็บไว้ และทางเปิดดู ปริ้น ดาวน์โหลด ปลดล็อก
 *
 * โครงเดียวกับ ServerHistoryPanel (รายการสำเนาที่เซิร์ฟเวอร์ถือ + ปุ่มของแต่ละแถว)
 * เทอมที่ปิดแล้วเปิดดูในเบราว์เซอร์นี้เท่านั้น เซิร์ฟเวอร์ไม่ถูกแตะ คนอื่นที่จัดตาราง
 * เทอมปัจจุบันอยู่จึงไม่รู้สึกอะไร
 *
 * เรื่องที่ต้องไม่พลาดคือ “ปลดล็อก”: แก้ได้ทีละหนึ่งเทอม ปลดล็อกเทอมเก่าจึงปิดเทอมที่ใช้
 * อยู่ไปด้วย หน้าต่างยืนยันบอกชื่อและจำนวนคาบของเทอมนั้นก่อนให้พิมพ์ชื่อเทอมยืนยัน
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useTimetableStore } from "../../store/timetableStore";
import * as api from "../../api/client";
import { ModalShell } from "../common/ModalShell";
import { NewTermModal } from "./NewTermModal";
import {
  activeTerm, createLatch, createOutcome, formatBytes, lastEditText, sortTerms,
  TERM_PRINT_EVENT, termDownloadName, termErrorText, termStatusText, TERMS_UNAVAILABLE,
  unlockConfirmed, unlockNotice, type TermMeta,
} from "../../utils/terms";

/** หัวข้อของหน้า — รูปเดียวกับ Section ใน pages/Dashboard (ไฟล์นั้นนำเข้าไฟล์นี้ จึงเขียนซ้ำ ไม่นำเข้ากลับ) */
export function TermsSection({ title, children, action }: {
  title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-base font-bold text-gray-800">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

/** ข้อความเดียวเมื่อไม่มีฐานข้อมูล — ไม่มีปุ่มใดอยู่คู่กัน */
export const TermsUnavailable: React.FC = () => (
  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
    {TERMS_UNAVAILABLE}
  </p>
);

// ── หน้าต่างปลดล็อก ───────────────────────────────────────────────────────────
const UnlockDialog: React.FC<{
  target: TermMeta;
  onClose: () => void;
  onDone: (text: string, tone: "info" | "warn" | "error") => void;
}> = ({ target, onClose, onDone }) => {
  const unlockOldTerm = useTimetableStore((s) => s.unlockOldTerm);
  const loadTerms = useTimetableStore((s) => s.loadTerms);
  // เทอมที่ใช้อยู่อ่านจากร้านตอนนี้ ไม่ใช่ค่าที่หน้ารายการโหลดไว้ตอนเปิดหน้า: มีหลายคนใช้พร้อมกัน
  // จำนวนคาบที่เตือนว่าจะถูกปิดต้องเป็นของล่าสุดที่เซิร์ฟเวอร์มี
  const active = useTimetableStore((s) => activeTerm(s.terms) ?? null);
  const [refreshing, setRefreshing] = useState(true);
  useEffect(() => {
    let alive = true;
    loadTerms().finally(() => { if (alive) setRefreshing(false); });
    return () => { alive = false; };
  }, [loadTerms]);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const latch = useRef(createLatch());

  const go = async () => {
    if (!unlockConfirmed(target, typed) || !latch.current.take()) return;
    setBusy(true); setErr(null);
    try {
      const r = await unlockOldTerm(target.id, typed.trim());
      const o = createOutcome(r, "ปลดล็อก");
      onDone(o.text, o.tone);
    } catch (e) {
      setErr(termErrorText(e, "ปลดล็อกไม่สำเร็จ ลองใหม่อีกครั้ง"));
      latch.current.reset();
    } finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={() => { if (!busy) onClose(); }} maxWidth="max-w-md">
      <div className="px-5 py-4 border-b border-gray-200">
        <h3 className="text-base font-bold text-gray-800">ปลดล็อกเทอม {target.label}</h3>
      </div>
      <div className="px-5 py-4 space-y-3 overflow-y-auto">
        {refreshing && <p className="text-xs text-gray-400">กำลังอ่านจำนวนคาบล่าสุดของเทอมที่ใช้อยู่…</p>}
        <ul className="space-y-1.5">
          {unlockNotice(target, active).map((line, i) => (
            <li key={i} className={clsx("text-sm flex gap-2",
              i === 0 && active !== null && active.id !== target.id
                ? "text-red-700 font-bold" : "text-gray-700")}>
              <span className="shrink-0">•</span><span>{line}</span>
            </li>
          ))}
        </ul>
        <label className="block text-xs font-medium text-gray-600">
          พิมพ์ชื่อเทอม <strong className="text-gray-900">{target.label}</strong> เพื่อยืนยัน
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
            disabled={busy}
            autoFocus
            placeholder={target.label}
            className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </label>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy}
          className="px-3 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-100 disabled:opacity-40">
          ยกเลิก
        </button>
        <button onClick={() => void go()} disabled={busy || refreshing || !unlockConfirmed(target, typed)}
          className="px-3 py-1.5 text-sm bg-red-600 text-white rounded font-semibold hover:bg-red-700 disabled:opacity-40">
          {busy ? "กำลังปลดล็อก…" : "ปลดล็อกเทอมนี้"}
        </button>
      </div>
    </ModalShell>
  );
};

// ── รายการ ───────────────────────────────────────────────────────────────────
interface Props {
  /** พาไปหน้าอื่นของแอป ("timetable") หลังเปิดเทอมสำหรับดูหรือปริ้น */
  onNav?: (page: string) => void;
}

export const TermsPanel: React.FC<Props> = ({ onNav }) => {
  const terms = useTimetableStore((s) => s.terms);
  const available = useTimetableStore((s) => s.termsAvailable);
  const reason = useTimetableStore((s) => s.termsReason);
  const viewing = useTimetableStore((s) => s.viewingTerm);
  const loadTerms = useTimetableStore((s) => s.loadTerms);
  const openTerm = useTimetableStore((s) => s.openTerm);
  const closeViewing = useTimetableStore((s) => s.closeViewing);

  const [busy, setBusy] = useState<number | "load" | null>("load");
  const [unlocking, setUnlocking] = useState<TermMeta | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "info" | "warn" | "error" } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy("load");
    try { await loadTerms(); } finally { setBusy(null); }
  }, [loadTerms]);

  useEffect(() => { void reload(); }, [reload]);

  const rows = sortTerms(terms);

  const open = async (t: TermMeta, thenPrint: boolean) => {
    setBusy(t.id); setErr(null); setNote(null);
    try {
      await openTerm(t.id);
      const st = useTimetableStore.getState();
      if (st.viewingTerm?.id === t.id) {
        onNav?.("timetable");
        if (thenPrint) window.dispatchEvent(new Event(TERM_PRINT_EVENT));
      } else {
        setErr(st.viewingError ?? "เปิดเทอมนี้ไม่สำเร็จ");
      }
    } catch (e) {
      setErr(termErrorText(e, "เปิดเทอมนี้ไม่สำเร็จ"));
    } finally { setBusy(null); }
  };

  const download = async (t: TermMeta) => {
    setBusy(t.id); setErr(null); setNote(null);
    try {
      const data = await api.fetchTermData(t.id);
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = termDownloadName(t);
      a.click();
      URL.revokeObjectURL(url);
      setNote({ text: `ดาวน์โหลดไฟล์ของเทอม ${t.label} แล้ว`, tone: "info" });
    } catch (e) {
      setErr(termErrorText(e, "ดาวน์โหลดไม่สำเร็จ"));
    } finally { setBusy(null); }
  };

  const backToLive = async () => {
    setBusy("load"); setErr(null);
    try {
      await closeViewing();
      const st = useTimetableStore.getState();
      if (st.viewingTerm) setErr(st.viewingError ?? "กลับไปเทอมปัจจุบันไม่สำเร็จ");
    } finally { setBusy(null); }
  };

  if (!available) {
    return (
      <TermsSection title="เทอม 🗓">
        <TermsUnavailable />
      </TermsSection>
    );
  }

  return (
    <TermsSection
      title="เทอม 🗓"
      action={
        <button onClick={() => setCreating(true)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 font-medium">
          ＋ สร้างเทอมใหม่
        </button>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs text-gray-600 flex-1">
            เทอมที่ปิดแล้วเปิดดู ปริ้น และดาวน์โหลดได้ แต่แก้ไม่ได้ · แก้ได้ทีละหนึ่งเทอมเท่านั้น
          </p>
          <button onClick={() => void reload()} disabled={busy === "load"}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">
            {busy === "load" ? "กำลังโหลด…" : "↻ โหลดใหม่"}
          </button>
        </div>

        {viewing && (
          <div className="flex items-center gap-2 flex-wrap text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-lg px-3 py-2">
            <span className="flex-1">กำลังเปิดดูเทอม {viewing.label} อยู่ (อ่านอย่างเดียว)</span>
            <button onClick={() => void backToLive()} disabled={busy !== null}
              className="px-2 py-1 bg-white border border-amber-400 rounded font-semibold hover:bg-amber-100 disabled:opacity-40">
              กลับไปเทอมปัจจุบัน
            </button>
          </div>
        )}

        {reason && (
          <p className="text-xs text-red-600">{reason}</p>
        )}

        {busy === "load" && rows.length === 0 && (
          <p className="text-xs text-gray-400 py-3 text-center">กำลังอ่านรายการเทอม…</p>
        )}
        {busy !== "load" && rows.length === 0 && (
          <p className="text-xs text-gray-400 py-3 text-center">
            ยังไม่มีเทอมที่บันทึกไว้ — กด “สร้างเทอมใหม่” เพื่อเริ่มเทอมแรก
          </p>
        )}

        {rows.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["ชื่อเทอม", "สถานะ", "คาบที่ลงแล้ว", "แก้ครั้งสุดท้าย", "ขนาด", ""].map((h, i) => (
                    <th key={i} className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600 border-b whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((t) => {
                  const isActive = t.status === "active";
                  const here = viewing?.id === t.id;
                  const working = busy === t.id;
                  return (
                    <tr key={t.id} className={isActive ? "bg-emerald-50/50" : here ? "bg-amber-50/60" : undefined}>
                      <td className="px-3 py-1.5 font-semibold text-gray-800 whitespace-nowrap">
                        {t.label}
                        {here && <span className="ml-1 text-[10px] font-normal text-amber-700">กำลังเปิดดู</span>}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className={clsx("text-xs px-2 py-0.5 rounded-full border",
                          isActive ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                                   : "bg-gray-100 border-gray-300 text-gray-600")}>
                          {termStatusText(t.status)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-800 tabular-nums">{t.slots ?? "–"}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap">{lastEditText(t)}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap">{formatBytes(t.bytes)}</td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">
                        {!isActive && (
                          <span className="inline-flex gap-1">
                            <button onClick={() => void open(t, false)} disabled={busy !== null}
                              className="px-2 py-1 text-xs border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-40">
                              {working ? "กำลังเปิด…" : "เปิดดู"}
                            </button>
                            <button onClick={() => void open(t, true)} disabled={busy !== null}
                              className="px-2 py-1 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-40">
                              ปริ้น
                            </button>
                            <button onClick={() => void download(t)} disabled={busy !== null}
                              className="px-2 py-1 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-40">
                              ดาวน์โหลด
                            </button>
                            <button onClick={() => { setUnlocking(t); setNote(null); setErr(null); }} disabled={busy !== null}
                              className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-40">
                              ปลดล็อกเทอม
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {note && (
          <p className={clsx("text-xs",
            note.tone === "error" ? "text-red-600" : note.tone === "warn" ? "text-amber-700" : "text-emerald-700")}>
            {note.text}
          </p>
        )}
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>

      {unlocking && (
        <UnlockDialog
          target={unlocking}
          onClose={() => setUnlocking(null)}
          onDone={(text, tone) => { setUnlocking(null); setNote({ text, tone }); }}
        />
      )}
      {creating && (
        <NewTermModal
          onClose={() => setCreating(false)}
          onCreated={(text, tone) => { setNote({ text, tone }); }}
        />
      )}
    </TermsSection>
  );
};
