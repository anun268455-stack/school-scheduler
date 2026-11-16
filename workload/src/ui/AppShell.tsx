import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

export type ShellTab<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  /** ใครเข้าอยู่ เช่น "ผู้ดูแลระบบ" · "ภาษาไทย · หัวหน้ากลุ่มสาระ" */
  user: ReactNode;
  /** ชิปรอบปัจจุบันข้างชื่อเว็บ เช่น <Chip tone="info" dot>ภาคเรียน 2/2569 · เปิดให้กลุ่มสาระกรอก</Chip> */
  roundChip?: ReactNode;
  /** ไม่ส่ง (หรือส่งลิสต์ว่าง) = ไม่มีแถบแท็บ */
  tabs?: ShellTab<K>[];
  active?: K;
  onTab?: (key: K) => void;
  onLogout: () => void;
  /** ชื่อของแถบแท็บสำหรับโปรแกรมอ่านหน้าจอ */
  navLabel?: string;
  children: ReactNode;
};

/** โลโก้กับชื่อเว็บ — ใช้ทั้งแถบบนและหน้าล็อกอิน/ตั้งรหัส ให้เป็นเว็บเดียวกันตั้งแต่หน้าแรก */
export function BrandMark(props: { heading?: boolean }) {
  const Title = props.heading ? "h1" : "span";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-lg font-semibold text-white">
        อ
      </span>
      <Title className="truncate text-lg font-bold text-ink sm:text-xl">เว็บลงอัตรากำลัง</Title>
    </div>
  );
}

// แถบบนขาว (โลโก้ · ชิปรอบ · ใคร · ออกจากระบบ) + แท็บ + เนื้อหากว้างสุด ~1240px (แบบข้อ 6)
// ใครเห็นแท็บอะไรตัดสินที่ App.tsx ที่เดียว — ตรงนี้แค่วาดลิสต์ที่ได้รับ
export function AppShell<K extends string>(props: Props<K>) {
  const tabs = props.tabs ?? [];
  const stripRef = useRef<HTMLDivElement>(null);

  // จอแคบ: แท็บที่เลือกอาจอยู่นอกจอ (admin เริ่มที่ "ทะเบียนครู" แท็บที่สี่) — เลื่อนแถบแท็บให้เห็น
  // เลื่อนเฉพาะแถบเอง ไม่ใช้ scrollIntoView เพราะมันเลื่อนทั้งหน้าได้ด้วย
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !tab) return;
    const pad = 16;
    if (tab.offsetLeft - pad < strip.scrollLeft) strip.scrollLeft = tab.offsetLeft - pad;
    else if (tab.offsetLeft + tab.offsetWidth + pad > strip.scrollLeft + strip.clientWidth)
      strip.scrollLeft = tab.offsetLeft + tab.offsetWidth + pad - strip.clientWidth;
  }, [props.active, tabs.length]);

  return (
    <div className="min-h-screen print:min-h-0">
      {/* print:hidden — หน้าสรุปพิมพ์จากเบราว์เซอร์ แถบบนและแท็บต้องไม่ติดไปบนกระดาษ */}
      <header className="border-b border-line bg-surface print:hidden">
        {/* จอกว้าง: โลโก้ · ชิปรอบ ······ ใคร · ออกจากระบบ (แถวเดียว)
            จอแคบ: โลโก้ ······ ออกจากระบบ / ชิปรอบ · ใคร (สองแถว) — ใช้ order สลับตำแหน่ง ลำดับใน DOM คงเดิม */}
        <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="order-1 min-w-0">
            <BrandMark />
          </div>
          {props.roundChip && <div className="order-4 min-w-0 max-w-full md:order-2">{props.roundChip}</div>}
          <span data-testid="who" className="order-5 min-w-0 text-[15px] text-muted md:order-4 md:ml-auto">
            {props.user}
          </span>
          <Button onClick={props.onLogout} className="order-2 ml-auto md:order-5 md:ml-0">
            ออกจากระบบ
          </Button>
          <div aria-hidden className="order-3 h-0 basis-full md:hidden" />
        </div>
      </header>

      {tabs.length > 0 && (
        // เส้นล่างของแถบวาดด้วยเงาด้านใน แท็บที่เลือก (พื้นขาว) จึงทับเส้นได้โดยไม่ต้องยื่นออกนอกกรอบที่เลื่อนได้
        <nav aria-label={props.navLabel ?? "เมนู"} className="shadow-[inset_0_-1px_0_var(--line)] print:hidden">
          {/* relative: ให้ offsetLeft ของแท็บนับจากแถบนี้ (ใช้ในการเลื่อนข้างบน) */}
          <div ref={stripRef} className="no-scrollbar relative mx-auto flex max-w-page gap-1 overflow-x-auto px-4 pt-2 sm:px-6">
            {tabs.map((t) => {
              const on = t.key === props.active;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => props.onTab?.(t.key)}
                  aria-current={on ? "page" : undefined}
                  className={`shrink-0 whitespace-nowrap rounded-t-xl border border-b-0 px-4 py-2.5 text-[15px] leading-6 transition-colors sm:px-5 ${
                    on ? "border-line bg-surface font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <main className="mx-auto w-full max-w-page px-4 py-6 sm:px-6 sm:py-8 print:max-w-none print:p-0">{props.children}</main>
    </div>
  );
}
