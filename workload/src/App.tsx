import { useEffect, useState } from "react";
import axios from "axios";

// ที่อยู่เซิร์ฟเวอร์แบบเดียวกับเว็บตาราง (frontend/src/api/client.ts)
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : "/api";

type Status =
  | { kind: "loading" }
  | { kind: "ok"; needsSetup: boolean }
  | { kind: "error"; message: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    // เซิร์ฟเวอร์ Render หลับได้ ครั้งแรกอาจรอเป็นสิบวินาที จึงตั้งเวลารอไว้ยาว
    axios
      .get(`${BASE_URL}/workload/health`, { timeout: 60_000 })
      .then((res) => {
        if (!cancelled) setStatus({ kind: "ok", needsSetup: Boolean(res.data?.needs_setup) });
      })
      .catch((err) => {
        if (cancelled) return;
        // 503 = เซิร์ฟเวอร์ตอบมาแล้วพร้อมเหตุผลภาษาไทย · ไม่มีคำตอบเลย = เรียกไม่ถึง
        const detail = err?.response?.data?.detail;
        setStatus({
          kind: "error",
          message:
            typeof detail === "string" && detail
              ? detail
              : "เรียกเซิร์ฟเวอร์ไม่ถึง ลองรอสักครู่แล้วโหลดหน้านี้ใหม่",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">เว็บลงอัตรากำลัง</h1>
      <p className="mt-4" role="status">
        {status.kind === "loading" && "กำลังต่อเซิร์ฟเวอร์..."}
        {status.kind === "ok" && (
          <span className="text-green-700">
            ต่อเซิร์ฟเวอร์ได้
            {status.needsSetup ? " (ยังไม่ได้ตั้งรหัสเข้าใช้งาน)" : ""}
          </span>
        )}
        {status.kind === "error" && (
          <span className="text-red-700">ต่อเซิร์ฟเวอร์ไม่ได้: {status.message}</span>
        )}
      </p>
    </main>
  );
}
