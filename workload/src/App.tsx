import { useEffect, useState } from "react";
import {
  apiErrorText, clearSession, loadSession, logout, me, saveSession, setSessionExpiredHandler,
} from "./api";
import { canManageRegistry, parseSession, type Session } from "./auth";
import CodesPage from "./pages/CodesPage";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";
import SubjectsPage from "./pages/SubjectsPage";
import TeachersPage from "./pages/TeachersPage";

const ROLE_TEXT = { admin: "ผู้ดูแลระบบ", head: "หัวหน้ากลุ่มสาระ" } as const;

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  // มี session เก็บไว้ = ต้องยืนยันกับเซิร์ฟเวอร์ก่อนเชื่อ (รหัสอาจถูกปิดไปแล้ว)
  const [checking, setChecking] = useState<boolean>(() => loadSession() !== null);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // null = หน้าล็อกอินปกติ · มีค่า = ฟอร์มตั้งรหัสผู้ดูแลระบบ (firstTime: false = ลืมรหัส)
  const [setup, setSetup] = useState<{ firstTime: boolean } | null>(null);
  // สลับหน้าด้วย state (ไม่ใช้ react-router โดยตั้งใจ)
  const [page, setPage] = useState<"teachers" | "subjects" | "codes">("teachers");

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
        // ใช้บทบาทที่เซิร์ฟเวอร์ยืนยัน ไม่ใช่ที่เก็บไว้ในเครื่อง · แต่คำตอบต้องผ่านการตรวจรูปแบบเดียวกับของที่เก็บไว้
        const s = parseSession(JSON.stringify({ token: stored.token, ...m }));
        if (!s) {
          setSession(null);
          setNotice("คำตอบจากเซิร์ฟเวอร์ไม่ถูกต้อง กรุณาใส่รหัสเข้าใหม่");
          setChecking(false);
          return;
        }
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
    setPage("teachers"); // ล็อกอินครั้งหน้าเริ่มที่หน้าแรกเสมอ
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

  if (!session) {
    if (setup) {
      return (
        <SetupPage
          firstTime={setup.firstTime}
          onCancel={() => setSetup(null)}
          onDone={() => {
            setSetup(null);
            setNotice(null);
            setInfo("ตั้งรหัสผู้ดูแลระบบแล้ว ใส่รหัสใหม่ด้านล่างเพื่อเข้าสู่ระบบ");
          }}
        />
      );
    }
    return (
      <LoginPage
        onLoggedIn={(s) => {
          setInfo(null);
          onLoggedIn(s);
        }}
        notice={notice}
        info={info}
        onOpenSetup={(firstTime) => {
          setInfo(null);
          setSetup({ firstTime });
        }}
      />
    );
  }

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
      {canManageRegistry(session) && (
        <nav className="flex gap-2 bg-gray-50 px-6 py-2" aria-label="เมนูผู้ดูแลระบบ">
          {([["teachers", "ทะเบียนครู"], ["subjects", "ทะเบียนวิชา"], ["codes", "รหัสเข้า"]] as const).map(([key, text]) => (
            <button
              key={key}
              onClick={() => setPage(key)}
              aria-current={page === key ? "page" : undefined}
              className={`rounded px-3 py-1 ${page === key ? "bg-blue-600 text-white" : "border border-gray-300"}`}
            >
              {text}
            </button>
          ))}
        </nav>
      )}
      <main className="mx-auto max-w-5xl p-6">
        {canManageRegistry(session) ? (
          page === "teachers" ? <TeachersPage /> : page === "subjects" ? <SubjectsPage /> : <CodesPage />
        ) : (
          <p>ยังไม่มีรอบอัตรากำลังที่เปิดอยู่</p>
        )}
      </main>
    </div>
  );
}
