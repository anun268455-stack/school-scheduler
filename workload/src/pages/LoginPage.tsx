import { useEffect, useState, type FormEvent } from "react";
import { apiErrorText, health, login } from "../api";
import { loginError, type Session } from "../auth";

type Status =
  | { kind: "loading" }
  | { kind: "ok"; needsSetup: boolean }
  | { kind: "error"; message: string };

type Props = {
  onLoggedIn: (s: Session) => void;
  // ข้อความจากการถูกพากลับมา เช่น session หมดอายุ
  notice?: string | null;
};

export default function LoginPage({ onLoggedIn, notice }: Props) {
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
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">เว็บลงอัตรากำลัง</h1>
      <p className="mt-4" role="status">
        {status.kind === "loading" && "กำลังต่อเซิร์ฟเวอร์..."}
        {status.kind === "ok" && <span className="text-green-700">ต่อเซิร์ฟเวอร์ได้</span>}
        {status.kind === "error" && (
          <span className="text-red-700">{status.message}</span>
        )}
      </p>
      {status.kind === "ok" && status.needsSetup && (
        <p className="mt-2 rounded bg-yellow-50 p-3 text-yellow-900">
          ยังไม่ได้ตั้งรหัสผู้ดูแลระบบ ต้องตั้งรหัสแรกก่อนจึงจะเข้าใช้งานได้
        </p>
      )}
      {notice && (
        <p className="mt-2 rounded bg-yellow-50 p-3 text-yellow-900" role="alert">
          {notice}
        </p>
      )}

      <form onSubmit={submit} className="mt-6 space-y-3">
        <label className="block">
          <span className="block text-sm font-medium">รหัสเข้าใช้งาน</span>
          <input
            type="password"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          เข้าสู่ระบบ
        </button>
        {busy && (
          <p role="status" className="text-gray-600">
            กำลังตรวจรหัส... (ครั้งแรกของวันอาจช้า เพราะเซิร์ฟเวอร์กำลังตื่น)
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </form>

      <p className="mt-10 rounded border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
        รหัสนี้ป้องกันได้แค่เว็บนี้ · โปรแกรมจัดตารางสอนยังไม่มีระบบล็อกอิน
        ใครที่รู้ลิงก์ยังเข้าไปแก้ตารางได้
      </p>
    </main>
  );
}
