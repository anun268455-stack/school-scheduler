import { useEffect, useState, type FormEvent } from "react";
import { apiErrorText, health, login } from "../api";
import { loginError, type Session } from "../auth";
import { BrandMark, Button, Card, Chip, Notice } from "../ui";

type Status =
  | { kind: "loading" }
  | { kind: "ok"; needsSetup: boolean }
  | { kind: "error"; message: string };

type Props = {
  onLoggedIn: (s: Session) => void;
  // ข้อความจากการถูกพากลับมา เช่น session หมดอายุ
  notice?: string | null;
  // ข้อความแจ้งสำเร็จ เช่น ตั้งรหัสผู้ดูแลระบบเสร็จแล้ว
  info?: string | null;
  // เปิดฟอร์มตั้งรหัสผู้ดูแลระบบ (true = ครั้งแรก · false = ลืมรหัส)
  onOpenSetup: (firstTime: boolean) => void;
};

export default function LoginPage({ onLoggedIn, notice, info, onOpenSetup }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    health()
      .then((h) => {
        if (!cancelled) setStatus({ kind: "ok", needsSetup: h.needsSetup });
      })
      .catch((err) => {
        if (!cancelled) setStatus({ kind: "error", message: apiErrorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await login(code);
      setCode(""); // ไม่เก็บรหัสที่พิมพ์ไว้หลังส่ง
      onLoggedIn(s);
    } catch (err: any) {
      // login ใช้ข้อความตามสถานะของมันเอง (401 = รหัสผิด) ส่วนข้อความของเซิร์ฟเวอร์ใช้เมื่อเป็นไทย
      const st: number = err?.response?.status ?? 0;
      setError(st === 401 ? loginError(401) : apiErrorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <BrandMark heading />
      <p className="mt-2 text-muted">ใส่รหัสที่ได้รับจากผู้ดูแลระบบเพื่อเข้าใช้งาน</p>

      <Card className="mt-6 space-y-4">
        <div role="status" className="text-[15px]">
          {status.kind === "loading" && <span className="text-muted">กำลังต่อเซิร์ฟเวอร์...</span>}
          {status.kind === "ok" && <Chip tone="ok" dot>ต่อเซิร์ฟเวอร์ได้</Chip>}
          {status.kind === "error" && <Notice tone="bad">{status.message}</Notice>}
        </div>
        {status.kind === "ok" && status.needsSetup && (
          <Notice tone="warn">
            <p>ยังไม่ได้ตั้งรหัสผู้ดูแลระบบ ต้องตั้งรหัสแรกก่อนจึงจะเข้าใช้งานได้</p>
            <Button variant="primary" onClick={() => onOpenSetup(true)} className="mt-3">
              ตั้งรหัสผู้ดูแลระบบครั้งแรก
            </Button>
          </Notice>
        )}
        {info && (
          <Notice tone="ok" role="status">
            {info}
          </Notice>
        )}
        {notice && (
          <Notice tone="warn" role="alert">
            {notice}
          </Notice>
        )}

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium">รหัสเข้าใช้งาน</span>
            <input
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              className="input mt-1 w-full"
            />
          </label>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            เข้าสู่ระบบ
          </Button>
          {busy && (
            <p role="status" className="text-sm text-muted">
              กำลังตรวจรหัส... (ครั้งแรกของวันอาจช้า เพราะเซิร์ฟเวอร์กำลังตื่น)
            </p>
          )}
          {error && (
            <Notice tone="bad" role="alert">
              {error}
            </Notice>
          )}
        </form>

        {status.kind === "ok" && !status.needsSetup && (
          <p className="border-t border-line2 pt-3 text-sm">
            <button type="button" onClick={() => onOpenSetup(false)} className="font-medium text-brand underline-offset-2 hover:underline">
              ลืมรหัสผู้ดูแลระบบ
            </button>
            <span className="text-muted"> (ต้องใช้รหัสตั้งค่าจาก Render)</span>
          </p>
        )}
      </Card>

      <Notice tone="warn" className="mt-6 text-sm">
        รหัสนี้ป้องกันได้แค่เว็บนี้ · โปรแกรมจัดตารางสอนยังไม่มีระบบล็อกอิน
        ใครที่รู้ลิงก์ยังเข้าไปแก้ตารางได้
      </Notice>
    </main>
  );
}
