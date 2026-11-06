/**
 * สร้างเทอมใหม่ — หน้าสรุปก่อนกดยืนยัน
 *
 * ปุ่มยืนยันกดได้ครั้งเดียว: การสร้างเทอมปิดเทอมที่ใช้อยู่และล้างตาราง กดซ้ำตอนเครือข่าย
 * ช้าอาจปิดเทอมที่เพิ่งสร้างต่อไปอีกชั้น จึงล็อกปุ่มทันทีที่กด (กลอนใน ref ไม่รอ React วาดใหม่)
 * และปลดล็อกคืนเฉพาะเมื่อเซิร์ฟเวอร์ปฏิเสธก่อนทำอะไร (400/409) ส่วนหมดเวลาหรือเครือข่ายหลุด
 * บอกไม่ได้ว่าสร้างไปแล้วหรือยัง จึงให้ไปดูรายการเทอมก่อน
 *
 * ผลลัพธ์ไม่พูดว่า “บันทึกแล้ว”: save_error เป็น null แค่แปลว่าเซิร์ฟเวอร์ต่อคิวเขียนไว้
 * คำตอบจริงอยู่ที่ป้ายสถานะการบันทึกบนแถบด้านบน (อ่านจาก /state/version)
 */
import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useTimetableStore } from "../../store/timetableStore";
import * as api from "../../api/client";
import { ModalShell } from "../common/ModalShell";
import {
  activeTerm, canRetryCreate, createLatch, createOutcome, newTermFormError, newTermWarning,
  nextTerm, previewRows, termErrorText, TERMS_UNAVAILABLE,
} from "../../utils/terms";

interface Props {
  onClose: () => void;
  /** เรียกเมื่อสร้างสำเร็จ — หน้ารายการเก็บข้อความไว้แสดงต่อหลังปิดหน้าต่าง */
  onCreated?: (text: string, tone: "info" | "warn" | "error") => void;
}

export const NewTermModal: React.FC<Props> = ({ onClose, onCreated }) => {
  const terms = useTimetableStore((s) => s.terms);
  const available = useTimetableStore((s) => s.termsAvailable);
  const makeNewTerm = useTimetableStore((s) => s.makeNewTerm);
  const loadTerms = useTimetableStore((s) => s.loadTerms);

  const active = activeTerm(terms) ?? null;
  // เติมค่าจาก nextTerm() ครั้งเดียวตอนเปิด — ไม่ตามรายการที่โหลดใหม่ระหว่างที่ผู้ใช้กำลังพิมพ์
  const [initial] = useState(() => nextTerm(active));
  const [year, setYear] = useState(initial.year > 0 ? String(initial.year) : "");
  const [semester, setSemester] = useState(String(initial.semester));

  const [preview, setPreview] = useState<api.TermPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** สร้างไปแล้ว หรือไม่แน่ใจว่าสร้างไปแล้ว — ปุ่มยืนยันไม่กลับมากดได้อีก */
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<{ text: string; tone: "info" | "warn" | "error" } | null>(null);
  const latch = useRef(createLatch());

  const loadPreview = async () => {
    setPreviewErr(null);
    try { setPreview(await api.fetchTermPreview()); }
    catch (e) { setPreviewErr(termErrorText(e, "อ่านสรุปก่อนสร้างเทอมไม่สำเร็จ")); }
  };

  useEffect(() => {
    if (!available) return;
    let alive = true;
    api.fetchTermPreview()
      .then((p) => { if (alive) setPreview(p); })
      .catch((e) => { if (alive) setPreviewErr(termErrorText(e, "อ่านสรุปก่อนสร้างเทอมไม่สำเร็จ")); });
    return () => { alive = false; };
  }, [available]);

  const formError = newTermFormError(year, semester, terms);

  const confirm = async () => {
    if (formError || !preview) return;
    // กลอนก่อน state: คลิกซ้อนในจังหวะเดียวกันผ่านไปได้แค่ครั้งแรก
    if (!latch.current.take()) return;
    setBusy(true); setErr(null);
    try {
      const r = await makeNewTerm(Number(year), Number(semester));
      const o = createOutcome(r);
      setResult(o);
      setLocked(true);
      onCreated?.(o.text, o.tone);
    } catch (e) {
      if (canRetryCreate(e)) {
        // เซิร์ฟเวอร์ปฏิเสธก่อนทำอะไร (ปีผิด เทอมซ้ำ) แก้แล้วกดใหม่ได้
        setErr(termErrorText(e, "สร้างเทอมไม่สำเร็จ"));
        latch.current.reset();
      } else {
        setLocked(true);
        setErr(termErrorText(e, "ไม่ได้รับคำตอบที่แน่ชัดจากเซิร์ฟเวอร์")
          + " — ยังไม่รู้ว่าเทอมถูกสร้างหรือยัง ปิดหน้าต่างนี้แล้วดูรายการเทอมก่อน อย่ากดสร้างซ้ำ");
        void loadTerms();
      }
    } finally { setBusy(false); }
  };

  const close = () => { if (!busy) onClose(); };

  if (!available) {
    return (
      <ModalShell onClose={close} maxWidth="max-w-md">
        <div className="px-5 py-4 space-y-3">
          <h3 className="text-base font-bold text-gray-800">สร้างเทอมใหม่</h3>
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
            {TERMS_UNAVAILABLE}
          </p>
        </div>
      </ModalShell>
    );
  }

  const done = result !== null;

  return (
    <ModalShell onClose={close} maxWidth="max-w-lg">
      <div className="px-5 py-4 border-b border-gray-200">
        <h3 className="text-base font-bold text-gray-800">สร้างเทอมใหม่</h3>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {/* วิชาใหม่ที่ต้องสร้าง และชุดคาบเสรี: ตัวเลขสองตัวนี้ในสเปกส่วนที่ 8 มาจากรอบอัตรากำลัง
            (Plan 2 ข้อมูลที่ Plan 3 ส่งเข้ามา) ยังไม่มีบนเซิร์ฟเวอร์ จึงเพิ่มที่นี่ตอนทำ Plan 3 */}
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">เทอมใหม่จะเริ่มต้นด้วย</p>
          {preview ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {previewRows(preview).map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-2 border-b border-gray-100 py-1">
                  <dt className="text-sm text-gray-700">{r.label}</dt>
                  <dd className="text-sm font-semibold text-gray-900 tabular-nums">
                    {r.value.toLocaleString("th-TH")}
                    {r.note && <span className="ml-1 text-[10px] font-normal text-gray-400">{r.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          ) : previewErr ? (
            <p className="text-xs text-red-600">
              {previewErr}{" "}
              <button onClick={() => void loadPreview()} className="underline">ลองใหม่</button>
            </p>
          ) : (
            <p className="text-xs text-gray-400">กำลังอ่านสรุป…</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-gray-600">
            ปีการศึกษา (พ.ศ.)
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              disabled={busy || locked}
              inputMode="numeric"
              placeholder="2569"
              className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
            />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            ภาคเรียนที่
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              disabled={busy || locked}
              className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
            >
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
        </div>
        {formError && !locked && <p className="text-xs text-red-600 -mt-2">{formError}</p>}

        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <strong>{newTermWarning(active)}</strong>
        </p>

        {err && <p className="text-xs text-red-600">{err}</p>}
        {result && (
          <p className={clsx("text-xs rounded-lg px-3 py-2 border",
            result.tone === "error" ? "bg-red-50 border-red-200 text-red-700"
              : result.tone === "warn" ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-800")}>
            {result.text}
          </p>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
        <button onClick={close} disabled={busy}
          className="px-3 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-100 disabled:opacity-40">
          {done || locked ? "ปิด" : "ยกเลิก"}
        </button>
        <button onClick={() => void confirm()}
          disabled={busy || locked || done || !preview || formError !== null}
          className="px-3 py-1.5 text-sm bg-red-600 text-white rounded font-semibold hover:bg-red-700 disabled:opacity-40">
          {busy ? "กำลังสร้างเทอม…" : done ? "สร้างแล้ว" : "ปิดเทอมนี้ แล้วสร้างเทอมใหม่"}
        </button>
      </div>
    </ModalShell>
  );
};
