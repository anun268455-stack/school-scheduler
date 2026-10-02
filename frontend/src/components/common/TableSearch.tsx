/**
 * TableSearch — the filter box that sits above every long list.
 *
 * With 143 teachers, 271 subjects and 1,200+ lesson requirements, scrolling is
 * no way to find a row. Each list gets this box, shows how many rows matched,
 * and (for the very long ones) caps how many are drawn at once so the page
 * stays responsive.
 */
import React from "react";

interface TableSearchProps {
  value:    string;
  onChange: (v: string) => void;
  /** Rows matching the current search. */
  count:    number;
  /** Rows in total, before searching. */
  total:    number;
  placeholder?: string;
  /** Set when the list is cut short, so we can say so. */
  shown?:   number;
  children?: React.ReactNode;   // extra filters, e.g. a level dropdown
}

export const TableSearch: React.FC<TableSearchProps> = ({
  value, onChange, count, total, placeholder = "ค้นหา…", shown, children,
}) => (
  <div className="flex items-center gap-2 mb-2 flex-wrap">
    <div className="relative flex-1 min-w-[180px]">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
      <input
        className="w-full border border-gray-300 rounded pl-7 pr-7 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
          title="ล้างคำค้นหา"
        >
          ✕
        </button>
      )}
    </div>
    {children}
    <span className="text-xs text-gray-500 shrink-0">
      {value ? <>พบ <strong className="text-blue-600">{count}</strong> จาก {total}</> : <>ทั้งหมด {total} รายการ</>}
      {shown !== undefined && shown < count && (
        <span className="text-amber-600"> · แสดง {shown} แรก</span>
      )}
    </span>
  </div>
);

/** Case-insensitive "does every word appear somewhere in these fields" match. */
export function matches(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = fields.map((f) => String(f ?? "").toLowerCase()).join(" ");
  return q.split(/\s+/).every((word) => hay.includes(word));
}
