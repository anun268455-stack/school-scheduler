import { useEffect, useState } from "react";
import {
  apiErrorText, clearSession, loadSession, logout, me, saveSession, setSessionExpiredHandler,
} from "./api";
import { canManageRegistry, type Session } from "./auth";
import LoginPage from "./pages/LoginPage";

const ROLE_TEXT = { admin: "ผู้ดูแลระบบ", head: "หัวหน้ากลุ่มสาระ" } as const;

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  // มี session เก็บไว้ = ต้องยืนยันกับเซิร์ฟเวอร์ก่อนเชื่อ (รหัสอาจถูกปิดไปแล้ว)
  const [checking, setChecking] = useState<boolean>(() => loadSession() !== null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSessionExpiredHandler((message) => {
      setSession(null);
      setChecking(false);
      setNotice(message);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    const stored = loadSession();
    if (!stored) return;
    let cancelled = false;
    me()
      .then((m) => {
        if (cancelled) return;
        // ใช้บทบาทที่เซิร์ฟเวอร์ยืนยัน ไม่ใช่ที่เก็บไว้ในเครื่อง
        const s: Session = { token: stored.token, ...m };
        saveSession(s);
        setSession(s);
        setChecking(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // 401 ถูกจัดการโดย callback แล้ว · อย่างอื่น (เซิร์ฟเวอร์ล่ม/หลับ) แสดงหน้าล็อกอินพร้อมเหตุผล แต่คง session ไว้ให้โหลดใหม่แล้วลองยืนยันอีก
        if (err?.response?.status !== 401) {
          setSession(null);
          setNotice(apiErrorText(err));
        }
        setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onLoggedIn = (s: Session) => {
    saveSession(s);
    setNotice(null);
    setSession(s);
  };

  const onLogout = async () => {
    try {
      await logout();
    } catch {
      // ออกจากหน้านี้ได้เสมอ แม้เซิร์ฟเวอร์ไม่ตอบ (session ฝั่งเซิร์ฟเวอร์หมดเองใน 12 ชั่วโมง)
    }
    clearSession();
    setSession(null);
  };

  if (checking) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-bold">เว็บลงอัตรากำลัง</h1>
        <p className="mt-4" role="status">กำลังตรวจสอบการเข้าสู่ระบบ...</p>
      </main>
    );
  }

  if (!session) return <LoginPage onLoggedIn={onLoggedIn} notice={notice} />;

  return (
    <div>
      <header className="flex items-center justify-between bg-white px-6 py-3 shadow">
        <div>
          <span className="font-bold">เว็บลงอัตรากำลัง</span>
          <span className="ml-4 text-gray-700" data-testid="who">
            {session.label} ({ROLE_TEXT[session.role]})
          </span>
        </div>
        <button onClick={onLogout} className="rounded border border-gray-300 px-3 py-1">
          ออกจากระบบ
        </button>
      </header>
      <main className="mx-auto max-w-3xl p-6">
        {canManageRegistry(session) ? (
          // ที่ว่างรอ Task 6 — จะแทนที่ด้วยหน้าทะเบียน
          <p>เข้าสู่ระบบในฐานะผู้ดูแลระบบแล้ว (หน้าทะเบียนครูและวิชากำลังจะมา)</p>
        ) : (
          <p>ยังไม่มีรอบอัตรากำลังที่เปิดอยู่</p>
        )}
      </main>
    </div>
  );
}
