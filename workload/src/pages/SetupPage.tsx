import { useState, type FormEvent } from "react";
import { apiErrorText, setupAdmin } from "../api";
import { setupFormError } from "../codes";

type Props = {
  // true = ยังไม่เคยมีรหัสผู้ดูแลระบบ · false = ลืมรหัสแล้วมากู้
  firstTime: boolean;
  onDone: () => void;
  onCancel: () => void;
};

// รหัสตั้งค่าและรหัสใหม่อยู่ใน state ของฟอร์มนี้เท่านั้น ล้างทันทีหลังส่ง ไม่เก็บที่ไหน ไม่ log
export default function SetupPage({ firstTime, onDone, onCancel }: Props) {
  const [setupCode, setSetupCode] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = setupFormError({ setupCode, code, confirm });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setupAdmin(setupCode, code);
      setSetupCode("");
      setCode("");
      setConfirm("");
      onDone();
    } catch (err) {
      setError(apiErrorText(err));
      setBusy(false);
    }
  };

  const field = "mt-1 w-full rounded border border-gray-300 px-3 py-2";
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">เว็บลงอัตรากำลัง</h1>
      <h2 className="mt-4 text-xl font-bold">
        {firstTime ? "ตั้งรหัสผู้ดูแลระบบครั้งแรก" : "ตั้งรหัสผู้ดูแลระบบใหม่ (ลืมรหัส)"}
      </h2>
      <p className="mt-2 text-sm text-gray-700">
        ต้องใช้ <strong>รหัสตั้งค่า</strong> ที่เจ้าของระบบตั้งไว้ในตัวแปร WORKLOAD_SETUP_CODE ของหน้า Environment บน Render
        {!firstTime && " · การตั้งใหม่จะทำให้คนที่ใช้รหัสผู้ดูแลระบบเดิมอยู่ถูกให้ออกจากระบบทันที"}
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block">
          <span className="block text-sm font-medium">รหัสตั้งค่า (จาก Render)</span>
          <input type="password" autoComplete="off" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} disabled={busy} className={field} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium">รหัสผู้ดูแลระบบใหม่ (อย่างน้อย 6 ตัวอักษร)</span>
          <input type="password" autoComplete="new-password" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} className={field} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium">พิมพ์รหัสผู้ดูแลระบบใหม่ซ้ำ</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} className={field} />
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            ตั้งรหัสผู้ดูแลระบบ
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="rounded border border-gray-300 px-4 py-2 disabled:opacity-50">
            กลับหน้าล็อกอิน
          </button>
        </div>
        {busy && <p role="status" className="text-gray-600">กำลังบันทึก...</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </form>
    </main>
  );
}
