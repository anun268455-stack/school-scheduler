/**
 * ImportModal — Excel / CSV bulk-import for Teachers, Rooms, Subjects, Groups.
 *
 * Supported file types: .xlsx, .xls, .csv
 * For each entity the expected columns are shown as hints and auto-mapped.
 */
import React, { useRef, useState, useCallback } from "react";
import { ModalShell } from "../common/ModalShell";
import * as XLSX from "xlsx";
import clsx from "clsx";
import * as api from "../../api/client";
import { useTimetableStore } from "../../store/timetableStore";
import { flattenGroups } from "../../utils/groupHierarchy";

// ── Entity definitions ────────────────────────────────────────────────────────
type EntityType = "teachers" | "rooms" | "subjects" | "groups" | "requirements";

interface ColDef {
  key:       string;    // field name in the API payload
  label:     string;    // human-readable
  aliases:   string[];  // column header synonyms (lower-case)
  required:  boolean;
  hint?:     string;    // shown as placeholder / help
  resolve?:  "room" | "teacher" | "department" | "group" | "subject"; // name → id lookup
}

interface EntityCfg { label: string; icon: string; cols: ColDef[]; sample: Record<string, string | number>[]; }

const ENTITY_CONFIGS: Record<EntityType, EntityCfg> = {
  teachers: {
    label: "ครู",
    icon: "👨‍🏫",
    cols: [
      { key: "code",                label: "รหัสครู",             aliases: ["code","รหัส","รหัสครู"],              required: false, hint: "เช่น T001" },
      { key: "name",                label: "ชื่อครู",             aliases: ["teacher_name","ชื่อครู","ชื่อ","name"], required: true,  hint: "ครูสมชาย ใจดี" },
      { key: "department_id",       label: "กลุ่มสาระ",           aliases: ["department","กลุ่มสาระ","สาระ"],      required: false, hint: "ชื่อกลุ่มสาระ เช่น คณิตศาสตร์", resolve: "department" },
      { key: "fixed_room_id",       label: "ห้องประจำครู",        aliases: ["fixed_room","ห้องประจำ","ห้อง"],       required: false, hint: "ชื่อห้อง เช่น ห้อง 101", resolve: "room" },
      { key: "outdoor_score",       label: "คะแนนกลางแจ้ง (0-10)",aliases: ["outdoor_score","outdoor","กลางแจ้ง"], required: false, hint: "5" },
      { key: "max_slots_per_day",   label: "สอนสูงสุด/วัน",        aliases: ["max_slots_per_day","max_slots","สูงสุด"],required: false,hint: "6" },
      { key: "max_outdoor_per_week",label: "กลางแจ้งสูงสุด/สัปดาห์",aliases: ["max_outdoor_per_week","max_outdoor"], required: false, hint: "2" },
    ],
    sample: [
      { code: "T001", name: "ครูสมชาย ใจดี", department_id: "คณิตศาสตร์", fixed_room_id: "ห้อง 101", outdoor_score: 3, max_slots_per_day: 6, max_outdoor_per_week: 1 },
      { code: "T002", name: "ครูพลศึกษา แข็งแรง", department_id: "พลศึกษา", fixed_room_id: "", outdoor_score: 10, max_slots_per_day: 8, max_outdoor_per_week: 10 },
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
      { key: "reserved_teacher_id", label: "จองให้ครู",  aliases: ["reserved_teacher","จองให้ครู","ครูประจำ"],       required: false, hint: "ชื่อครู (เว้นว่าง = ห้องรวม)", resolve: "teacher" },
      { key: "specialized_dept_id", label: "ห้องเฉพาะกลุ่มสาระ", aliases: ["specialized_dept","ห้องเฉพาะ","เฉพาะ"], required: false, hint: "ชื่อกลุ่มสาระ (เว้นว่าง = ไม่จำกัด)", resolve: "department" },
    ],
    sample: [
      { name: "ห้อง 101", type: "physical", floor: 1, capacity: 40, building_id: 1, reserved_teacher_id: "", specialized_dept_id: "" },
      { name: "ห้องคอมพิวเตอร์", type: "special", floor: 2, capacity: 30, building_id: 2, reserved_teacher_id: "ครูคอมพ์ เก่ง", specialized_dept_id: "" },
      { name: "สนามกีฬา", type: "outdoor", floor: 1, capacity: 120, building_id: "", reserved_teacher_id: "", specialized_dept_id: "" },
    ],
  },
  subjects: {
    label: "วิชาเรียน",
    icon: "📚",
    cols: [
      { key: "code",     label: "รหัสวิชา",  aliases: ["code","รหัส","รหัสวิชา"],                         required: true,  hint: "MATH101" },
      { key: "name",     label: "ชื่อวิชา",   aliases: ["name","ชื่อ","ชื่อวิชา"],                         required: true,  hint: "คณิตศาสตร์" },
      { key: "type",     label: "ประเภท",    aliases: ["type","ประเภท"],                                    required: false, hint: "common / parallel" },
      { key: "duration", label: "จำนวนคาบ", aliases: ["duration","คาบ","จำนวนคาบ"],                      required: false, hint: "1 หรือ 2 (คาบคู่)" },
      { key: "fixed_room_id", label: "ห้องประจำวิชา", aliases: ["fixed_room","ห้องประจำวิชา","ห้องเรียนประจำ"], required: false, hint: "ชื่อห้อง เช่น สนามกีฬา", resolve: "room" },
    ],
    sample: [
      { code: "MATH101", name: "คณิตศาสตร์", type: "common", duration: 1, fixed_room_id: "" },
      { code: "PE101", name: "พลศึกษา", type: "parallel", duration: 2, fixed_room_id: "สนามกีฬา" },
    ],
  },
  groups: {
    label: "ห้องเรียน",
    icon: "👥",
    cols: [
      { key: "name",  label: "ชื่อห้อง",    aliases: ["name","ชื่อ","ชื่อห้อง"],   required: true,  hint: "ม.4/6 หรือ ม.4/6ก" },
      { key: "level", label: "ระดับชั้น",   aliases: ["level","ระดับ","ชั้น"],      required: false, hint: "M1 … M6" },
      { key: "size",  label: "จำนวนนักเรียน",aliases: ["size","จำนวน","นักเรียน"], required: false, hint: "40" },
      { key: "parent_id", label: "ห้องแม่ (ถ้าเป็นห้องย่อย)", aliases: ["parent","ห้องแม่","แม่"], required: false, hint: "ชื่อห้องแม่ เช่น ม.4/6 (เว้นว่าง = ห้องปกติ)", resolve: "group" },
      { key: "homeroom_room_id", label: "ห้องประจำชั้น", aliases: ["homeroom_room","ห้องประจำชั้น","ห้องเพชร"], required: false, hint: "ชื่อห้อง เช่น ห้อง 202", resolve: "room" },
      { key: "homeroom_teacher_id", label: "ครูประจำชั้น", aliases: ["homeroom_teacher","ครูประจำชั้น","ครูที่ปรึกษา"], required: false, hint: "ชื่อครู", resolve: "teacher" },
    ],
    sample: [
      { name: "ม.4/6", level: "M4", size: 35, parent_id: "", homeroom_room_id: "ห้อง 202", homeroom_teacher_id: "ครูสมชาย ใจดี" },
      { name: "ม.4/6ก", level: "M4", size: 12, parent_id: "ม.4/6", homeroom_room_id: "", homeroom_teacher_id: "" },
      { name: "ม.4/6ข", level: "M4", size: 12, parent_id: "ม.4/6", homeroom_room_id: "", homeroom_teacher_id: "" },
      { name: "ม.4/6ค", level: "M4", size: 11, parent_id: "ม.4/6", homeroom_room_id: "", homeroom_teacher_id: "" },
    ],
  },
  requirements: {
    label: "ข้อกำหนดคาบ",
    icon: "📋",
    cols: [
      { key: "group_id",   label: "ห้องเรียน", aliases: ["group","ห้องเรียน","ห้อง"],  required: true,  hint: "ชื่อห้อง เช่น ม.4/6", resolve: "group" },
      { key: "subject_id", label: "วิชา",      aliases: ["subject","วิชา","รหัสวิชา","code"], required: true, hint: "รหัสหรือชื่อวิชา เช่น MATH101", resolve: "subject" },
      { key: "teacher_id", label: "ครูผู้สอน", aliases: ["teacher","ครู","ครูผู้สอน"], required: true,  hint: "ชื่อครู", resolve: "teacher" },
      { key: "weekly_count", label: "คาบ/สัปดาห์", aliases: ["weekly_count","คาบ","จำนวน","สัปดาห์"], required: false, hint: "3" },
      { key: "parallel_group_key", label: "รหัสคู่ขนาน", aliases: ["parallel","คู่ขนาน","รหัสคู่ขนาน"], required: false, hint: "ว่างได้ (เช่น PE-M1)" },
    ],
    sample: [
      { group_id: "ม.4/6", subject_id: "MATH101", teacher_id: "ครูสมชาย ใจดี", weekly_count: 3, parallel_group_key: "" },
      { group_id: "ม.4/6ก", subject_id: "COM101", teacher_id: "ครูคอมพ์ เก่ง", weekly_count: 2, parallel_group_key: "" },
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

// Convert raw row to typed payload. Resolve columns (name→id) keep their raw
// string here and are converted in a later pass.
const NUMERIC_KEYS = ["floor","capacity","outdoor_score","max_slots_per_day","max_outdoor_per_week","building_id","size","duration","weekly_count"];
function mapRow(row: Record<string, string>, mapping: Record<string, string>, cols: ColDef[]): Record<string, unknown> {
  const resolveKeys = new Set(cols.filter((c) => c.resolve).map((c) => c.key));
  const out: Record<string, unknown> = {};
  for (const [key, header] of Object.entries(mapping)) {
    let val: unknown = row[header] ?? "";
    if (NUMERIC_KEYS.includes(key)) {
      const n = Number(val);
      val = isNaN(n) ? undefined : n;
    } else if (resolveKeys.has(key)) {
      val = String(val ?? "").trim();   // keep the name for later resolution
    }
    out[key] = val;
  }
  return out;
}

// Build a template workbook (headers + example rows) and trigger a download.
function downloadTemplate(entity: EntityType) {
  const cfg = ENTITY_CONFIGS[entity];
  const headers = cfg.cols.map((c) => c.label);
  const body = cfg.sample.map((s) => cfg.cols.map((c) => s[c.key] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  ws["!cols"] = cfg.cols.map((c) => ({ wch: Math.max(c.label.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cfg.label);
  XLSX.writeFile(wb, `template_${entity}.xlsx`);
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
      // Lookup maps for name → id resolution (ห้องประจำ, กลุ่มสาระ, ห้องแม่ ฯลฯ).
      const st = useTimetableStore.getState();
      const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, "");
      const roomByName = new Map(st.rooms.map((r) => [norm(r.name), r.id]));
      const teacherByName = new Map(st.teachers.map((t) => [norm(t.name), t.id]));
      const deptByName = new Map(st.departments.map((d) => [norm(d.name), d.id]));
      const groupByName = new Map(flattenGroups(st.groups).map((g) => [norm(g.name), g.id]));
      // Subjects resolve by code first, then name.
      const subjectByKey = new Map<string, number>();
      for (const s of st.subjects) {
        subjectByKey.set(norm(s.code), s.id);
        subjectByKey.set(norm(s.name), s.id);
      }
      const resolver: Record<NonNullable<ColDef["resolve"]>, Map<string, number>> = {
        room: roomByName, teacher: teacherByName, department: deptByName, group: groupByName, subject: subjectByKey,
      };
      const resolveCols = cfg.cols.filter((c) => c.resolve);

      const payload = rows.map((r) => {
        const obj = mapRow(r, mapping, cfg.cols);
        for (const col of resolveCols) {
          const raw = obj[col.key];
          if (raw === undefined || raw === "" || raw === null) { obj[col.key] = null; continue; }
          const id = resolver[col.resolve!].get(norm(raw));
          obj[col.key] = id ?? null;  // unknown name → null rather than crash
        }
        return obj;
      });

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
      } else if (entity === "requirements") {
        const res = await api.bulkCreateRequirements(payload as Parameters<typeof api.bulkCreateRequirements>[0]);
        count = res.length;
      } else if (entity === "groups") {
        // Capture raw parent names so we can link subgroups whose parent is in
        // the SAME file (created in the same batch).
        const parentCol = cfg.cols.find((c) => c.resolve === "group");
        const parentHeader = parentCol ? mapping[parentCol.key] : undefined;
        const parentNames = rows.map((r) => (parentHeader ? norm(r[parentHeader]) : ""));

        const res = await api.bulkCreateGroups(payload as Parameters<typeof api.bulkCreateGroups>[0]);
        count = res.length;

        // Pass 2: link any still-unlinked subgroup to a parent that now exists.
        const fresh = flattenGroups(await api.fetchGroups());
        const freshByName = new Map(fresh.map((g) => [norm(g.name), g.id]));
        for (let i = 0; i < res.length; i++) {
          const needsLink = (payload[i] as { parent_id?: number | null }).parent_id == null && parentNames[i];
          if (!needsLink) continue;
          const pid = freshByName.get(parentNames[i]);
          if (pid && pid !== res[i].id) {
            await api.updateGroup(res[i].id, { parent_id: pid });
          }
        }
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
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" z="z-[100]">

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
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-gray-600">รูปแบบคอลัมน์ที่รองรับ ({cfg.label})</p>
              <button
                onClick={() => downloadTemplate(entity)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                ⬇ ดาวน์โหลดไฟล์ตัวอย่าง (.xlsx)
              </button>
            </div>
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
            <p className="text-[10px] text-gray-400 mt-1.5">* จำเป็น | ระบบจับคู่คอลัมน์อัตโนมัติ รองรับไทย/อังกฤษ | ช่องที่เป็นชื่อ (ห้องประจำ, กลุ่มสาระ, ห้องแม่) พิมพ์ "ชื่อ" ได้เลย ระบบจะแปลงให้</p>
            {entity === "groups" && (
              <p className="text-[10px] text-purple-500 mt-1">💡 ห้องย่อย (เช่น ม.4/6ก) ให้ใส่ชื่อ "ห้องแม่" = ม.4/6 — จะอยู่ไฟล์เดียวกันก็ได้ ระบบเชื่อมให้อัตโนมัติ</p>
            )}
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
    </ModalShell>
  );
};
