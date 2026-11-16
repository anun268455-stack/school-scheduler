import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  /** บอกว่าต้องทำอะไรต่อ (แบบข้อ 6: ข้อความว่างทุกที่ต้องบอกทางไปต่อ) */
  hint: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, hint, action }: Props) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-12 text-center sm:py-16">
      <div aria-hidden className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2.5" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      </div>
      <p className="text-lg font-semibold text-ink">{title}</p>
      <div className="mx-auto mt-1 max-w-md text-muted">{hint}</div>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
