/**
 * SearchableSelect — a dropdown you can type into.
 *
 * Schools have hundreds of teachers and dozens of rooms, so a plain <select>
 * means scrolling forever. This keeps the same value-in/value-out shape as a
 * native select (string values, "" for none) but filters as you type.
 *
 * Keyboard: ↑/↓ move, Enter picks, Esc closes. Clicking outside closes it.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

export interface Option {
  value:  string;
  label:  string;
  hint?:  string;      // shown dimmed on the right (room type, teacher code…)
  group?: string;      // optional section heading
  disabled?: boolean;
}

interface SearchableSelectProps {
  value:       string;
  onChange:    (value: string) => void;
  options:     Option[];
  placeholder?: string;     // shown when nothing is selected
  emptyLabel?: string;      // label of the "no selection" entry; omit to require a value
  className?:  string;
  disabled?:   boolean;
  /** Below this many options the search box is hidden — it would only be noise. */
  searchThreshold?: number;
  /** "dark" matches the top toolbar; the open panel stays light either way. */
  tone?: "light" | "dark";
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value, onChange, options, placeholder = "เลือก…", emptyLabel,
  className, disabled, searchThreshold = 7, tone = "light",
}) => {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) ||
      (o.hint ?? "").toLowerCase().includes(q) ||
      (o.group ?? "").toLowerCase().includes(q));
  }, [options, query]);

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(""); setCursor(0); inputRef.current?.focus(); }
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[cursor];
      if (opt && !opt.disabled) pick(opt.value);
    } else if (e.key === "Escape") { setOpen(false); }
  };

  const showSearch = options.length >= searchThreshold;

  return (
    <div ref={boxRef} className={clsx("relative", className)}>
      {/* Closed state — looks like a select */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "w-full flex items-center gap-1 rounded text-left border outline-none",
          tone === "dark"
            ? "bg-gray-800 border-gray-600 text-white px-2.5 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 disabled:text-gray-500"
            : "bg-white border-gray-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400",
        )}
      >
        <span className={clsx("flex-1 min-w-0 truncate",
          !selected && (tone === "dark" ? "text-gray-400" : "text-gray-400"))}>
          {selected ? selected.label : (emptyLabel && !value ? emptyLabel : placeholder)}
        </span>
        {selected?.hint && <span className="text-[11px] text-gray-400 shrink-0">{selected.hint}</span>}
        <span className="text-gray-400 text-[10px] shrink-0">▾</span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-2xl overflow-hidden text-gray-900"
          /* Always at least readable, however narrow the trigger is: a picker
             inside a table column was coming out a few characters wide. */
          style={{ minWidth: "max(100%, 240px)", width: "max-content", maxWidth: "min(380px, 90vw)" }}
        >
          {showSearch && (
            <div className="p-2 border-b border-gray-100 bg-gray-50">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
                onKeyDown={onKeyDown}
                placeholder="พิมพ์เพื่อค้นหา…"
                className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="max-h-72 overflow-y-auto py-1">
            {emptyLabel && (
              <Row
                label={emptyLabel} active={value === ""} highlighted={false} muted
                onClick={() => pick("")}
              />
            )}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-xs text-gray-400 text-center">ไม่พบรายการที่ค้นหา</p>
            )}
            {filtered.map((o, i) => {
              const prev = filtered[i - 1];
              const newGroup = o.group && o.group !== prev?.group;
              return (
                <React.Fragment key={o.value}>
                  {newGroup && (
                    <p className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-semibold text-gray-400">{o.group}</p>
                  )}
                  <Row
                    label={o.label} hint={o.hint}
                    active={o.value === value}
                    highlighted={i === cursor}
                    disabled={o.disabled}
                    onClick={() => !o.disabled && pick(o.value)}
                    onHover={() => setCursor(i)}
                  />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{
  label: string; hint?: string; active: boolean; highlighted: boolean;
  disabled?: boolean; muted?: boolean;
  onClick: () => void; onHover?: () => void;
}> = ({ label, hint, active, highlighted, disabled, muted, onClick, onHover }) => (
  <button
    type="button"
    onClick={onClick}
    onMouseEnter={onHover}
    disabled={disabled}
    className={clsx(
      "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors leading-snug",
      active ? "bg-blue-50 text-blue-800 font-medium" : highlighted ? "bg-gray-100" : "hover:bg-gray-50",
      muted && "text-gray-400",
      disabled && "opacity-40 cursor-not-allowed",
    )}
  >
    <span className="flex-1 min-w-0 break-words">{label}</span>
    {hint && <span className="text-[11px] text-gray-400 shrink-0">{hint}</span>}
  </button>
);

// ── Option builders for the three things people pick constantly ──────────────
export const teacherOptions = (
  teachers: { id: number; name: string; code?: string | null; department_id?: number | null }[],
  departments?: { id: number; name: string }[],
): Option[] =>
  teachers.map((t) => ({
    value: String(t.id),
    label: t.name,
    hint: t.code ?? undefined,
    group: departments?.find((d) => d.id === t.department_id)?.name,
  }));

export const roomOptions = (
  rooms: { id: number; name: string; type?: string; capacity?: number }[],
  typeLabels?: Record<string, string>,
): Option[] =>
  rooms.map((r) => ({
    value: String(r.id),
    label: r.name,
    hint: r.type ? (typeLabels?.[r.type] ?? r.type) : undefined,
  }));

export const groupOptions = (
  groups: { id: number; name: string; level?: string | null; parent_id?: number | null }[],
): Option[] =>
  groups.map((g) => ({
    value: String(g.id),
    label: g.name,
    hint: g.parent_id ? "ห้องย่อย" : undefined,
    group: g.level ?? undefined,
  }));
