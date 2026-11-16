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
import { AppShell, BrandMark, EmptyState, type ShellTab } from "./ui";

const ROLE_TEXT = { admin: "ผู้ดูแลระบบ", head: "หัวหน้ากลุ่มสาระ" } as const;

type PageKey = "curriculum" | "rounds" | "summary" | "teachers" | "subjects" | "codes" | "fill";

// เมนูของแต่ละบทบาท — ที่เดียวที่ตัดสินว่าใครเห็นแท็บอะไร (ตาม canManageRegistry)
// เซิร์ฟเวอร์บังคับสิทธิ์ของทุก route อยู่แล้ว เมนูแค่ไม่พาไปหน้าที่ใช้ไม่ได้
const ADMIN_TABS: ShellTab<PageKey>[] = [
  { key: "curriculum", label: "หลักสูตร" },
  { key: "rounds", label: "รอบอัตรากำลัง" },
  { key: "summary", label: "สรุปอัตรากำลัง" },
  { key: "teachers", label: "ทะเบียนครู" },
  { key: "subjects", label: "ทะเบียนวิชา" },
  { key: "codes", label: "รหัสเข้า" },
];
const HEAD_TABS: ShellTab<PageKey>[] = [
  { key: "curriculum", label: "หลักสูตร" },
  { key: "fill", label: "อัตรากำลังของกลุ่ม" },
  { key: "summary", label: "สรุปอัตรากำลัง" },
];
// หน้าแรกหลังล็อกอิน: admin เริ่มที่ทะเบียนครูเหมือนขั้นที่ 1 (สามแท็บแรกยังเป็นหน้าว่าง) · หัวหน้าเริ่มที่งานของกลุ่ม
const ADMIN_HOME: PageKey = "teachers";
const HEAD_HOME: PageKey = "fill";

function ComingSoon(props: { title: string; admin: boolean }) {
  return (
    <EmptyState
      title={`${props.title} — กำลังจะมา`}
      hint={
        props.admin
          ? "หน้านี้ยังไม่เปิดใช้ จะตามมาในรุ่นถัดไปของเว็บ · ระหว่างนี้ใช้เมนูทะเบียนครู ทะเบียนวิชา และรหัสเข้าได้ตามปกติ"
          : "หน้านี้ยังไม่เปิดใช้ จะตามมาในรุ่นถัดไปของเว็บ · ระหว่างนี้ยังไม่ต้องทำอะไร"
      }
    />
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  // มี session เก็บไว้ = ต้องยืนยันกับเซิร์ฟเวอร์ก่อนเชื่อ (รหัสอาจถูกปิดไปแล้ว)
  const [checking, setChecking] = useState<boolean>(() => loadSession() !== null);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // null = หน้าล็อกอินปกติ · มีค่า = ฟอร์มตั้งรหัสผู้ดูแลระบบ (firstTime: false = ลืมรหัส)
  const [setup, setSetup] = useState<{ firstTime: boolean } | null>(null);
  // สลับหน้าด้วย state (ไม่ใช้ react-router โดยตั้งใจ) · null = หน้าแรกของบทบาท
  const [page, setPage] = useState<PageKey | null>(null);

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
    setPage(null); // ล็อกอินครั้งหน้าเริ่มที่หน้าแรกของบทบาทเสมอ
    setSession(null);
  };

  if (checking) {
    return (
      <main className="mx-auto max-w-md px-4 py-10 sm:py-16">
        <BrandMark heading />
        <p className="mt-6 text-muted" role="status">กำลังตรวจสอบการเข้าสู่ระบบ...</p>
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

  const admin = canManageRegistry(session);
  const tabs = admin ? ADMIN_TABS : HEAD_TABS;
  // หน้าที่เลือกไว้ต้องอยู่ในเมนูของบทบาทนี้ ไม่งั้นกลับหน้าแรกของบทบาท (กันหัวหน้าค้างที่หน้าของ admin)
  const current: PageKey = page !== null && tabs.some((t) => t.key === page) ? page : admin ? ADMIN_HOME : HEAD_HOME;
  const tabLabel = tabs.find((t) => t.key === current)?.label ?? "";
  // admin มีชื่อเป็นบทบาทอยู่แล้ว ไม่ต้องเขียนซ้ำ
  const who = session.label === ROLE_TEXT[session.role] ? session.label : `${session.label} · ${ROLE_TEXT[session.role]}`;

  return (
    <AppShell
      user={who}
      tabs={tabs}
      active={current}
      onTab={setPage}
      onLogout={onLogout}
      navLabel={admin ? "เมนูผู้ดูแลระบบ" : "เมนูหัวหน้ากลุ่มสาระ"}
    >
      {current === "teachers" && admin ? (
        <TeachersPage />
      ) : current === "subjects" && admin ? (
        <SubjectsPage />
      ) : current === "codes" && admin ? (
        <CodesPage />
      ) : current === "fill" ? (
        <EmptyState
          title="ยังไม่มีรอบอัตรากำลังที่เปิดอยู่"
          hint="เมื่อผู้ดูแลระบบเปิดรอบให้กลุ่มสาระกรอก หน้านี้จะแสดงรายวิชาของกลุ่มให้ใส่ครูผู้สอน"
        />
      ) : (
        <ComingSoon title={tabLabel} admin={admin} />
      )}
    </AppShell>
  );
}
