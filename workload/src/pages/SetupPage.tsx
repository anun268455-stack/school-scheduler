import { useState, type FormEvent } from "react";
import { apiErrorText, setupAdmin } from "../api";
import { setupFormError } from "../codes";
import { BrandMark, Button, Card, Notice } from "../ui";

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

  const field = "input mt-1 w-full";
  return (
    <main className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <BrandMark heading />
      <Card className="mt-6">
        <h2 className="text-xl font-bold">
          {firstTime ? "ตั้งรหัสผู้ดูแลระบบครั้งแรก" : "ตั้งรหัสผู้ดูแลระบบใหม่ (ลืมรหัส)"}
        </h2>
        <p className="mt-2 text-[15px] text-muted">
          ต้องใช้ <strong className="font-semibold text-ink">รหัสตั้งค่า</strong> ที่เจ้าของระบบตั้งไว้ในตัวแปร WORKLOAD_SETUP_CODE ของหน้า Environment บน Render
          {!firstTime && " · การตั้งใหม่จะทำให้คนที่ใช้รหัสผู้ดูแลระบบเดิมอยู่ถูกให้ออกจากระบบทันที"}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
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
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" variant="primary" disabled={busy}>
              ตั้งรหัสผู้ดูแลระบบ
            </Button>
            <Button onClick={onCancel} disabled={busy}>
              กลับหน้าล็อกอิน
            </Button>
          </div>
          {busy && <p role="status" className="text-sm text-muted">กำลังบันทึก...</p>}
          {error && <Notice tone="bad" role="alert">{error}</Notice>}
        </form>
      </Card>
    </main>
  );
}
