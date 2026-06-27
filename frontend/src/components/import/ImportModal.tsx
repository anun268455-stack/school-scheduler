/**
 * ImportModal — Excel / CSV bulk-import for Teachers, Rooms, Subjects, Groups.
 *
 * Supported file types: .xlsx, .xls, .csv
 * For each entity the expected columns are shown as hints and auto-mapped.
 */
import React, { useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import clsx from "clsx";
import * as api from "../../api/client";

// ── Entity definitions ────────────────────────────────────────────────────────
type EntityType = "teachers" | "rooms" | "subjects" | "groups";

interface ColDef {
  key:       string;    // field name in the API payload
  label:     string;    // human-readable
  aliases:   string[];  // column header synonyms (lower-case)
  required:  boolean;
  hint?:     string;    // shown as placeholder / help
}

const ENTITY_CONFIGS: Record<EntityType, { label: string; icon: string; cols: ColDef[] }> = {
  teachers: {
    label: "ครู",
    icon: "👨‍🏫",
    cols: [
      { key: "name",                label: "ชื่อครู",             aliases: ["name","ชื่อ","ชื่อครู"],             required: true,  hint: "ครูสมชาย ใจดี" },
      { key: "outdoor_score",       label: "คะแนนกลางแจ้ง (0-10)",aliases: ["outdoor_score","outdoor","กลางแจ้ง"], required: false, hint: "5" },
      { key: "max_slots_per_day",   label: "สอนสูงสุด/วัน",        aliases: ["max_slots_per_day","max_slots","สูงสุด"],required: false,hint: "6" },
      { key: "max_outdoor_per_week",label: "กลางแจ้งสูงสุด/สัปดาห์",aliases: ["max_outdoor_per_week","max_outdoor"], required: false, hint: "2" },
    ],
  },
  rooms: {
    label: "ห้องสอน",
    icon: "🚪",
    cols: [
      { key: "name",        label: "ชื่อห้อง",   aliases: ["name","ชื่อ","ชื่อห้อง"],                                  required: true,  hint: "ห้อง 101" },
      { key: "type",        label: "ประเภท",     aliases: ["type","ประเภท"],                                             required: false, hint: "physical / special / outdoor" },
      { key: "floor",       label: "ชั้น",        aliases: ["floor","ชั้น"],                                              required: false, hint: "1" },
      { key: "capacity",    label: "ความจุ (คน)", aliases: ["capacity","จำนวน","ความจุ"],                                 required: false, hint: "40" },
      { key: "building_id", label: "รหัสอาคาร",  aliases: ["building_id","building","อาคาร","รหัสอาคาร"],              required: false, hint: "1" },
    ],
  },
  subjects: {
    label: "วิชาเรียน",
    icon: "📚",
    cols: [
      { key: "code",     label: "รหัสวิชา",  aliases: ["code","รหัส","รหัสวิชา"],                         required: true,  hint: "MATH101" },
      { key: "name",     label: "ชื่อวิชา",   aliases: ["name","ชื่อ","ชื่อวิชา"],                         required: true,  hint: "คณิตศาสตร์" },
      { key: "type",     label: "ประเภท",    aliases: ["type","ประเภท"],                                    required: false, hint: "common / parallel" },
      { key: "duration", label: "จำนวนคาบ", aliases: ["duration","คาบ","จำนวนคาบ"],                      required: false, hint: "1 หรือ 2" },
    ],
  },
  groups: {
    label: "ห้องเรียน",
    icon: "👥",
    cols: [
      { key: "name",  label: "ชื่อห้อง",    aliases: ["name","ชื่อ","ชื่อห้อง"],   required: true,  hint: "ม.1/1" },
      { key: "level", label: "ระดับชั้น",   aliases: ["level","ระดับ","ชั้น"],      required: false, hint: "M1 … M6" },
      { key: "size",  label: "จำนวนนักเรียน",aliases: ["size","จำนวน","นักเรียน"], required: false, hint: "40" },
    ],
  },
};

// ── Helper: parse file → row objects ──────────────────────────────────────────
async function parseFile(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb   = XLSX.read(data, { type: "binary" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// Auto-map column headers to known field keys
function autoMap(headers: string[], cols: ColDef[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const col of cols) {
    const match = headers.find((h) =>
      col.aliases.some((a) => h.toLowerCase().trim().includes(a.toLowerCase()))
    );
    if (match) mapping[col.key] = match;
  }
  return mapping;
}

// Convert raw row to typed payload
function mapRow(row: Record<string, string>, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, header] of Object.entries(mapping)) {
    let val: unknown = row[header] ?? "";
    if (["floor","capacity","outdoor_score","max_slots_per_day","max_outdoor_per_week","building_id","size","duration"].includes(key)) {
      const n = Number(val);
      val = isNaN(n) ? undefined : n;
    }
    out[key] = val;
  }
  return out;
}

// ── Component ──────────────────────────────────────────────────────────────────
interface ImportModalProps {
  onClose:   () => void;
  onSuccess: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ onClose, onSuccess }) => {
  const [entity,   setEntity]   = useState<EntityType>("teachers");
  const [rows,     setRows]     = useState<Record<string, string>[]>([]);
  const [headers,  setHeaders]  = useState<string[]>([]);
  const [mapping,  setMapping]  = useState<Record<string, string>>({});
  const [status,   setStatus]   = useState<"idle"|"parsed"|"importing"|"done"|"error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [imported, setImported] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const cfg = ENTITY_CONFIGS[entity];

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("idle");
    setRows([]);
    try {
      const parsed  = await parseFile(file);
      const hdrs    = parsed.length ? Object.keys(parsed[0]) : [];
      const autoMap2 = autoMap(hdrs, cfg.cols);
      setRows(parsed);
      setHeaders(hdrs);
      setMapping(autoMap2);
      setStatus("parsed");
    } catch {
      setStatus("error");
      setErrorMsg("ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบรูปแบบ CSV หรือ Excel");
    }
  }, [cfg]);

  const handleEntityChange = (e: EntityType) => {
    setEntity(e);
    setRows([]);
    setHeaders([]);
    setMapping({});
    setStatus("idle");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImport = async () => {
    setStatus("importing");
    try {
      const payload = rows.map((r) => mapRow(r, mapping));
      let count = 0;
      if (entity === "teachers") {
        const res = await api.bulkCreateTeachers(payload as Parameters<typeof api.bulkCreateTeachers>[0]);
        count = res.length;
      } else if (entity === "rooms") {
        const res = await api.bulkCreateRooms(payload as Parameters<typeof api.bulkCreateRooms>[0]);
        count = res.length;
      } else if (entity === "subjects") {
        const res = await api.bulkCreateSubjects(payload as Parameters<typeof api.bulkCreateSubjects>[0]);
        count = res.length;
      } else if (entity === "groups") {
        const res = await api.bulkCreateGroups(payload as Parameters<typeof api.bulkCreateGroups>[0]);
        count = res.length;
      }
      setImported(count);
      setStatus("done");
      onSuccess();
    } catch {
      setStatus("error");
      setErrorMsg("เกิดข้อผิดพลาดระหว่างนำเข้าข้อมูล");
    }
  };

  const preview = rows.slice(0, 5);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-blue-700 text-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">📥</span>
            <span className="font-bold text-base">นำเข้าข้อมูล</span>
          </div>
          <button onClick={onClose} className="text-blue-200 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Entity selector */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">เลือกประเภทข้อมูล</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.entries(ENTITY_CONFIGS) as [EntityType, typeof ENTITY_CONFIGS[EntityType]][]).map(([key, c]) => (
                <button
                  key={key}
                  onClick={() => handleEntityChange(key)}
                  className={clsx(
                    "flex flex-col items-center gap-1 p-3 rounded-lg border-2 text-sm font-medium transition-all",
                    entity === key
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-gray-50",
                  )}
                >
                  <span className="text-xl">{c.icon}</span>
                  <span className="text-center text-xs leading-tight">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Column format hint */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-600 mb-1.5">รูปแบบคอลัมน์ที่รองรับ ({cfg.label})</p>
            <div className="flex flex-wrap gap-1.5">
              {cfg.cols.map((c) => (
                <span key={c.key} className={clsx(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border",
                  c.required
                    ? "bg-red-50 border-red-200 text-red-700 font-semibold"
                    : "bg-white border-gray-200 text-gray-600",
                )}>
                  {c.required && <span className="text-red-500">*</span>}
                  {c.label}
                  <span className="text-gray-400 font-mono text-[9px]">({c.hint})</span>
                </span>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">* จำเป็น | ระบบจะจับคู่คอลัมน์อัตโนมัติ รองรับทั้งภาษาไทยและอังกฤษ</p>
          </div>

          {/* File upload */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">อัปโหลดไฟล์</p>
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-blue-300 rounded-xl p-6 cursor-pointer hover:bg-blue-50 transition-colors">
              <span className="text-3xl">📎</span>
              <span className="text-sm text-gray-600">คลิกเพื่อเลือกไฟล์ หรือลากวางที่นี่</span>
              <span className="text-xs text-gray-400">รองรับ .xlsx, .xls, .csv</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFile}
                className="hidden"
              />
            </label>
          </div>

          {/* Column mapping */}
          {status === "parsed" && headers.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                จับคู่คอลัมน์ ({rows.length} แถว)
              </p>
              <div className="grid grid-cols-2 gap-2">
                {cfg.cols.map((col) => (
                  <div key={col.key} className="flex items-center gap-2">
                    <span className={clsx(
                      "text-xs w-28 shrink-0",
                      col.required ? "font-semibold text-gray-800" : "text-gray-500",
                    )}>
                      {col.required && <span className="text-red-500 mr-0.5">*</span>}
                      {col.label}
                    </span>
                    <select
                      value={mapping[col.key] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [col.key]: e.target.value })}
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                    >
                      <option value="">– ไม่เลือก –</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview table */}
          {status === "parsed" && preview.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                ตัวอย่างข้อมูล (5 แถวแรก)
              </p>
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {cfg.cols.filter((c) => mapping[c.key]).map((c) => (
                        <th key={c.key} className="px-3 py-2 text-left font-semibold text-gray-600 border-b whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {cfg.cols.filter((c) => mapping[c.key]).map((c) => (
                          <td key={c.key} className="px-3 py-1.5 text-gray-700 max-w-[200px] truncate">
                            {String(row[mapping[c.key]] ?? "–")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 5 && (
                <p className="text-[10px] text-gray-400 mt-1">และอีก {rows.length - 5} แถว...</p>
              )}
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              ❌ {errorMsg}
            </div>
          )}

          {/* Done */}
          {status === "done" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
              <span className="text-xl">✅</span>
              <div>
                <p className="font-semibold">นำเข้าสำเร็จ!</p>
                <p>เพิ่มข้อมูล {imported} รายการเข้าสู่ระบบเรียบร้อยแล้ว</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100">
            ปิด
          </button>
          <div className="flex items-center gap-2">
            {status === "parsed" && (
              <span className="text-xs text-gray-500">{rows.length} แถวพร้อมนำเข้า</span>
            )}
            <button
              onClick={handleImport}
              disabled={status !== "parsed" || rows.length === 0 || !cfg.cols.filter((c) => c.required).every((c) => mapping[c.key])}
              className={clsx(
                "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all",
                status === "parsed" && rows.length > 0
                  ? "bg-blue-600 hover:bg-blue-700 text-white shadow"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed",
              )}
            >
              {status === "importing" ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  กำลังนำเข้า...
                </>
              ) : (
                <>📥 นำเข้า {rows.length > 0 ? `(${rows.length} รายการ)` : ""}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
