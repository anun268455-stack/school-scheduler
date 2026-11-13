/**
 * PrintView v5 — Thai school timetable, printable on A4.
 *
 * Paper: A4 **portrait**, with an option to fit **two timetables per sheet**
 * (the default) so a whole school costs half the paper. One-per-sheet is still
 * available when the grid needs the room.
 *
 * What gets printed is chosen by the caller through `options`: class timetables
 * or teacher timetables, which ones, and in what order (by name, by กลุ่มสาระ,
 * or by teacher code). Teacher sheets carry the teacher's code in the header.
 */
import React, { forwardRef } from "react";
import type { Department, LessonRequirement, Period, Room, SchoolConfig, StudentGroup, Subject, Teacher, TimetableSlot } from "../../types";
import { DAYS, DAYS_SHORT } from "../../types";
import { buildSharesStudents, flattenGroups, compareNames } from "../../utils/groupHierarchy";
import { myElectiveOption, slotTeacherNames, slotsForTeacher } from "../../utils/teacherSlots";
import { optionsInRoom, roomNameForTeacher, slotUsesRoom } from "../../utils/electiveRooms";
import {
  normalizeSheet, pageLabel, sheetSigners, thaiDate,
  type SheetSetup, type Signer,
} from "../../utils/printSheet";
import { shortTeacher, teacherLine, withKhru } from "../../utils/teacherLabel";
import { charsFitting, fitFont, FONT_STACK, THAI_LINE_HEIGHT } from "../../utils/fonts";
import { classRanges } from "../../utils/classRange";
import { DEFAULT_FREE_LABEL, DEFAULT_FREE_THROUGH, freeCellLabel }
  from "../../utils/freePeriodLabel";
import { normalizePrintLayout, type CellLayout, type CellPartKey } from "../../utils/cellLayout";
import { effectiveHomeroomIds } from "../../utils/homeroom";
import { WorkloadReport } from "./WorkloadReport";
import { levelKeyOf, periodsForLevel, combinedPeriods, type LevelKey } from "../../utils/levels";
import { roomHourCount, roomHoursOf, roomsToPrint } from "../../utils/roomUsage";

export type PrintMode = "group" | "teacher" | "room" | "workload";
export type PrintSort = "name" | "department" | "code";

export interface PrintOptions {
  mode:        PrintMode;
  /** Which classes / teachers to print. Empty array = every one of them. */
  selectedIds: number[];
  sort:        PrintSort;
  perPage:     1 | 2;
  /**
   * นับคาบกิจกรรม (ลูกเสือ เนตรนารี ชุมนุม) ในอัตรากำลังหรือไม่
   *
   * Some schools count supervising ลูกเสือ towards a teacher's load and some
   * report only subject teaching, so this is the school's call, not ours.
   */
  countActivities: boolean;
  /**
   * คำที่เขียนลงในคาบว่างของตารางชั้นเรียน — ว่าง = ไม่เขียนอะไร
   *
   *   "อยากให้คาบว่างในคาบที่ 1-8 ให้มีคำว่าเสริมการเรียนรู้"
   */
  freeLabel: string;
  /** เขียนถึงคาบที่เท่าไร (เลขบนหัวตาราง) — คาบสุดท้ายของวันไม่เอา */
  freeLabelThrough: number;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  mode: "group", selectedIds: [], sort: "name", perPage: 2, countActivities: true,
  freeLabel: DEFAULT_FREE_LABEL, freeLabelThrough: DEFAULT_FREE_THROUGH,
};

interface PrintViewProps {
  slots:        TimetableSlot[];
  groups:       StudentGroup[];
  teachers?:    Teacher[];
  /** ห้องสอน — ใช้เมื่อพิมพ์ "ตารางการใช้ห้องสอน" */
  rooms?:       Room[];
  departments?: Department[];
  subjects?:    Subject[];
  /** ไม่ได้ใช้แล้วหลังใบอัตรากำลังเลิกรายงานคาบที่ลงไม่ได้ — คงช่องไว้
   *  เพราะที่เรียกยังส่งมา และไม่มีเหตุให้ต้องไปแก้ทุกที่พร้อมกัน */
  requirements?: LessonRequirement[];
  periods:      Period[];
  schoolConfig: SchoolConfig;
  options:      PrintOptions;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildGrid(slots: TimetableSlot[]) {
  const map = new Map<string, TimetableSlot[]>();
  for (const s of slots) {
    const k = `${s.day}-${s.period}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(s);
  }
  return map;
}

/**
 * Columns for a sheet, as the class on it actually experiences the day.
 *
 * Deduplicating by period number alone kept whichever row came first and
 * printed one level's lunch break onto the other level's timetable.
 */
function getDisplayPeriods(periods: Period[], level?: LevelKey) {
  return level ? periodsForLevel(periods, level) : combinedPeriods(periods);
}

// ── Sizing: compact when two timetables share a sheet ────────────────────────
interface Metrics {
  headFont: string; timeFont: string; cellFont: string; subFont: string;
  /** The subject code and room number are the two things read at a glance. */
  roomFont: string;
  /** Fixed height per line, so every cell's three lines sit at the same place. */
  lineH: string;
  rowH: string; pad: string; titleFont: string; subtitleFont: string; logo: number;
  /**
   * ความกว้างของช่องคาบหนึ่งช่อง เป็นจุด หลังหักขอบและช่องไฟแล้ว
   *
   * คิดจากจำนวนคาบจริงของใบนั้นใน TimetableBlock แล้วส่งต่อลงไปให้ช่อง เพื่อให้
   * ย่อขนาดตัวอักษรได้พอดีช่องแทนที่จะเดาเป็นจำนวนตัวอักษรตรึงไว้ ไม่ระบุ =
   * ใช้ค่าเดิมที่เคยตรึงไว้ ซึ่งเกิดขึ้นได้เฉพาะเวลาเรียกช่องนอกตาราง
   */
  colPx?: number;
  /**
   * ลำดับและขนาดของสามบรรทัดในช่อง — ตั้งได้ที่หน้าตั้งค่าเครื่องมือ
   *
   * ติดมากับ Metrics เพราะ Metrics ถูกส่งถึงทุกช่องอยู่แล้ว ไม่ต้องร้อย prop
   * ใหม่ลงไปทุกชั้นของใบพิมพ์
   */
  layout?: CellLayout;
}

const METRICS: Record<1 | 2, Metrics> = {
  // ── แถวสูงเท่าที่เนื้อหาต้องการ ไม่ใช่เท่าที่หน้ากระดาษเหลือ ──
  //
  //   "คือจะปริ้นคนเดี่ยวแต่ตารางยาว ช่วยแก้ไขให้เป็นตารางสั้นๆ สวยงาม"
  //
  // เดิม rowH 34mm × ห้าวัน = 170mm ของเนื้อหาสามบรรทัดเล็ก ๆ ครูที่มีคาบไม่
  // เยอะจึงได้ตารางโปร่งสูงเต็มหน้า 20mm พอดีกับสามบรรทัดที่ 5.5mm บวกช่องไฟ
  1: { headFont: "11pt", timeFont: "8.5pt", cellFont: "13pt", subFont: "11pt", roomFont: "12pt",
       lineH: "5.5mm", rowH: "20mm", pad: "3px 4px", titleFont: "15pt", subtitleFont: "11.5pt", logo: 52 },
  2: { headFont: "8.5pt", timeFont: "7pt", cellFont: "9.5pt", subFont: "8.5pt", roomFont: "9pt",
       lineH: "4.2mm", rowH: "15mm", pad: "2px 3px", titleFont: "11.5pt", subtitleFont: "9pt", logo: 34 },
};

const borderCell = (m: Metrics): React.CSSProperties => ({
  border: "1px solid #000",
  padding: m.pad,
  textAlign: "center",
  verticalAlign: "middle",
});

// ── One timetable block (header + grid + signatures) ─────────────────────────
interface BlockProps {
  /** React's own, declared because this tsconfig checks FC props strictly. */
  key?:     string;
  /** Whose day this sheet shows; omitted for a teacher, who spans both. */
  level?:   LevelKey;
  title:    string;
  subtitle: string;
  grid:     Map<string, TimetableSlot[]>;
  periods:  Period[];
  schoolConfig: SchoolConfig;
  metrics:  Metrics;
  compact:  boolean;
  /**
   * วาดเนื้อในช่องหนึ่งช่อง
   *
   * รับ Metrics กลับไปด้วย ไม่ใช่ใช้ตัวที่ปิดทับมาจากข้างนอก เพราะตัวที่ส่งมา
   * ตรงนี้รู้ความกว้างจริงของช่องคาบของใบนี้แล้ว (colPx) ซึ่งคิดจากจำนวนคาบ
   * ของใบนั้น — ข้างนอกไม่รู้
   */
  renderCell: (slots: TimetableSlot[], m: Metrics) => React.ReactNode;
  /**
   * คำที่เขียนในช่องที่ไม่มีคาบ — ใบของชั้นเรียนเท่านั้น
   *
   * ใบของครูกับใบของห้องสอนไม่ส่งมา เพราะช่องว่างในใบพวกนั้นแปลว่า "ครูว่าง"
   * หรือ "ห้องว่าง" ไม่ได้แปลว่านักเรียนมีชั่วโมงเสริมการเรียนรู้
   */
  fillEmpty?: (printedNo: number, slots: TimetableSlot[]) => string | null;
  /**
   * ผู้เซ็นใต้ตาราง — มาจากแบบฟอร์มที่โรงเรียนตั้งไว้ (utils/printSheet)
   *
   * เคยเป็นสองช่องตายตัวพร้อมข้อความตำแหน่งที่เขียนตรึงไว้ในไฟล์นี้
   * "ช่องลงชื่อ สามารถลดหรือเพิ่มได้" คือข้อที่โรงเรียนเลือกว่าสำคัญที่สุด
   */
  signers:  Signer[];
}

const TimetableBlock: React.FC<BlockProps> = ({
  level, title, subtitle, grid, periods, schoolConfig, metrics: m, compact, renderCell,
  fillEmpty, signers,
}) => {
  const cols = getDisplayPeriods(periods, level);

  // ── ช่องคาบหนึ่งช่องกว้างจริงเท่าไร ──
  //
  // ใบกว้าง 190mm (.print-page) ที่ 96 จุดต่อนิ้ว = 718 จุด หักคอลัมน์ชื่อวัน
  // กับคอลัมน์พักซึ่งกว้างตายตัวตาม <colgroup> ที่เหลือหารเท่า ๆ กันให้คาบเรียน
  // แล้วหักช่องไฟสองข้างกับเส้นขอบ เพราะตัวอักษรใช้ได้แค่ส่วนใน
  const SHEET_PX = 718;
  const lessonCols = cols.filter((p) => p.type === "class").length || 1;
  const breakCols = cols.length - lessonCols;
  const dayW = compact ? 34 : 46;
  const breakW = compact ? 30 : 42;
  const padX = compact ? 6 : 8;
  const colPx = Math.max(
    12, (SHEET_PX - dayW - breakCols * breakW) / lessonCols - padX - 2);
  const cellM: Metrics = { ...m, colPx };

  // What number each column is given at the top of the sheet.
  //
  // Not the stored period_num, and not the label: the school's rows number
  // breaks and lessons in one series, so printing a break's own number next
  // to a lesson's label put the same figure twice in a row ("… 3 3 … 5 5 …").
  // The sheet is counted here instead, left to right: a lesson gets the next
  // number and so does พักกินข้าว, which the school counts as a period of the
  // day. A ten-minute break, โฮมรูม and เคารพธงชาติ get none — they are not
  // periods, and numbering them is what pushed everything out of step.
  const COUNTED = (t?: string) => t === "class" || t === "lunch";
  const printedNum = new Map<number, number>();
  let seq = 0;
  for (const p of cols) if (COUNTED(p.type)) printedNum.set(p.period_num, ++seq);
  const TH: React.CSSProperties = { ...borderCell(m), fontSize: m.headFont, fontWeight: 600, backgroundColor: "#fff" };
  // ความสูงของแถว ซึ่งบนช่องตารางทำตัวเป็นค่าต่ำสุดอยู่แล้ว — แถวสูงเท่านี้
  // ไม่ใช่เท่าที่หน้ากระดาษเหลือ ตารางจึงกระชับและไม่โปร่งเต็มหน้า
  const TD: React.CSSProperties = { ...borderCell(m), fontSize: m.cellFont, height: m.rowH };
  // Printed in black and white, so these are true neutral greys (R=G=B),
  // not the blue-tinted ones: a tinted grey shifts when the driver converts
  // it. #f3f4f6 was only 1.10:1 against the white lesson cells — on paper the
  // band was all but invisible, which is half of why the column was hard to
  // read. These sit at 1.43:1 and 1.67:1, visible as a band, while black text
  // on them is 14.7:1 and 12.6:1.
  //
  // They are deliberately LIGHT. A printer in true black-and-white mode
  // thresholds around mid grey, and a darker band (anything from #808080
  // down) flips to solid black and swallows the text. At 216 and 200 these
  // are 88 and 72 steps clear of that, so the worst a 1-bit printer does is
  // drop the tint and leave black text on white — still perfectly readable.
  const BREAK_TH: React.CSSProperties = {
    ...TH, backgroundColor: "#c8c8c8", color: "#000", fontSize: m.headFont,
  };
  const BREAK_TD: React.CSSProperties = { ...TD, backgroundColor: "#d8d8d8" };

  return (
    <div className="tt-block" style={{
      breakInside: "avoid", pageBreakInside: "avoid",
      display: "flex", flexDirection: "column", minHeight: 0,
    }}>
      {/* Header */}
      <div style={{ marginBottom: "3px", display: "flex", alignItems: "center", gap: "8px" }}>
        {schoolConfig.logoUrl ? (
          <img
            src={schoolConfig.logoUrl}
            alt=""
            style={{ width: m.logo, height: m.logo, objectFit: "contain", flexShrink: 0 }}
          />
        ) : (
          <div style={{
            width: m.logo, height: m.logo, border: "1px solid #ccc", borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: compact ? "12pt" : "16pt", flexShrink: 0,
          }}>🏫</div>
        )}
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: m.titleFont, fontWeight: 700, lineHeight: 1.3 }}>{title}</div>
          <div style={{ fontSize: m.subtitleFont, fontWeight: 600, lineHeight: 1.3 }}>{subtitle}</div>
        </div>
        <div style={{ width: m.logo, flexShrink: 0 }} />
      </div>

      {/* Grid */}
      <div className="tt-grid">
      <table style={{
        width: "100%", height: "auto", borderCollapse: "collapse", tableLayout: "fixed",
        /* เดิมเป็น height 100% ในลูก flex ที่ยืดได้ แถววันจึงแบ่งที่ว่างที่เหลือ
           ของหน้ากระดาษกันไป ตารางของครูที่มีคาบไม่เยอะเลยโปร่งสูงเต็มหน้า
           ("ตารางยาว") ตอนนี้แถวสูงเท่า rowH แล้วที่ว่างที่เหลือไปอยู่เหนือ
           แถวลงชื่อซึ่งถูกดันลงไปอยู่ก้นหน้า ตามแบบเอกสารราชการ
           The outer frame is NOT here — see .tt-grid. A collapsed table draws
           its border centred ON the table edge, so half of it falls outside
           the table's box, and the page clipped that half away. */
      }}>
        <colgroup>
          <col style={{ width: compact ? "34px" : "46px" }} />
          {cols.map((p) =>
            p.type !== "class"
              ? <col key={p.period_num} style={{ width: compact ? "30px" : "42px" }} />
              : <col key={p.period_num} />)}
        </colgroup>

        <thead>
          <tr>
            <th style={TH}>คาบที่</th>
            {cols.map((p) => (
              <th key={p.period_num} style={p.type !== "class" ? BREAK_TH : TH}>
                {printedNum.get(p.period_num) ?? ""}
              </th>
            ))}
          </tr>
          <tr>
            <th style={{ ...TH, fontSize: m.timeFont, fontWeight: 400 }}>เวลา</th>
            {cols.map((p) => (
              <th key={p.period_num}
                  style={{ ...(p.type !== "class" ? BREAK_TH : TH), fontSize: m.timeFont, fontWeight: 400 }}>
                {p.type !== "class" ? "" : `${p.start_time}–${p.end_time}`}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {DAYS.map((dayName, dayIdx) => (
            <tr key={dayIdx}>
              {/* ชื่อวันต้องอยู่ในช่องของตัวเอง — "พฤหัสบดี" ยาวกว่าชื่อวันอื่นเท่าตัว
                  และภาษาไทยไม่มีช่องว่างคั่นคำ เบราว์เซอร์จึงขึ้นบรรทัดใหม่ให้เองไม่ได้
                  พอคอลัมน์กว้างตายตัว 46 จุด ตัวอักษรเลยล้นออกนอกเส้นตาราง

                  แก้สามชั้น: ย่อให้พอดีความกว้างก่อน · ถ้ายังไม่พอให้ขึ้นบรรทัดใหม่ได้
                  แม้กลางคำ (แถวสูง 20mm รับสองบรรทัดสบาย) · ชั้นสุดท้ายคือตัดส่วนที่
                  เกินทิ้ง เพื่อให้ไม่มีทางหลุดไปทับช่องข้าง ๆ ได้เลย */}
              <td style={{ ...TD, fontWeight: 600, backgroundColor: "#f9fafb",
                           fontSize: fitFont(compact ? DAYS_SHORT[dayIdx] : dayName,
                                             m.headFont,
                                             charsFitting(dayW - padX - 2, m.headFont), 0.55),
                           overflow: "hidden", overflowWrap: "anywhere" }}>
                {compact ? DAYS_SHORT[dayIdx] : dayName}
              </td>
              {cols.map((p) => {
                if (p.type !== "class") {
                  // One cell spanning all five days, written once down the
                  // column, rather than an empty box on every row.
                  if (dayIdx > 0) return null;
                  return (
                    <td key={p.period_num} style={{ ...BREAK_TD, padding: 0 }} rowSpan={DAYS.length}>
                      <div style={{
                        writingMode: "vertical-rl", transform: "rotate(180deg)",
                        margin: "0 auto", whiteSpace: "nowrap",
                        fontSize: m.timeFont, color: "#000", fontWeight: 600,
                        letterSpacing: "0.3px",
                      }}>
                        {breakLabel(p)}
                      </div>
                    </td>
                  );
                }
                const cs = grid.get(`${dayIdx}-${p.period_num}`) ?? [];
                const filler = fillEmpty?.(printedNum.get(p.period_num) ?? 0, cs) ?? null;
                return (
                  <td key={p.period_num} style={TD}>
                    {/* A full-height wrapper, so the cell's three lines can
                        share the row however tall the row ends up. */}
                    <div style={{ height: "100%", minHeight: m.rowH }}>
                      {filler ? <FreeCell text={filler} m={cellM} /> : renderCell(cs, cellM)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* แถวลงชื่อ อยู่ใต้ตารางเลย ห่างเท่าที่กำหนดเป็นมิลลิเมตร ไม่ถูกดันลงก้นหน้า
          ("เอาชื่อขึ้นไปติดกับตาราง") ระยะห่างนี้มีไว้ไม่ให้เส้นลงชื่อไปแปะติด
          ขอบล่างของตารางพอดีจนดูเหมือนเป็นแถวหนึ่งของตาราง */}
      {signers.length > 0 && (
        <div className="tt-signatures" style={{
          marginTop: compact ? "6mm" : "10mm",
          display: "flex",
          // สองคนยืนห่างกันคนละฝั่งเหมือนเดิม สามคนขึ้นไปเกลี่ยให้เท่ากัน
          justifyContent: signers.length <= 2 ? "space-between" : "space-around",
          fontSize: compact ? "8pt" : "10pt",
        }}>
          {signers.map((s, i) => (
            <div key={i} style={{
              textAlign: "center",
              // เส้นลงชื่อสั้นลงเมื่อมีคนเซ็นมาก ไม่งั้นมันจะชนกัน
              minWidth: signers.length <= 2 ? "40%" : `${Math.floor(92 / signers.length)}%`,
            }}>
              <div>ลงชื่อ{signers.length > 3 ? "................" : "................................"}</div>
              {s.name && <div>({s.name})</div>}
              <div>{s.role}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};



/**
 * "131 ห้องคอมฯ3" → "131".
 *
 * Which room matters most in the cell and is what people look for, so it is
 * printed large and bold while the name is dropped — the number is on the door.
 */
function roomNumber(room: string | null | undefined): string {
  if (!room) return "";
  // "ห้องประชุมเกียรติยศ" → "ประชุมเกียรติยศ". Every room on the sheet is a
  // room; the word costs four characters of a column that holds about ten.
  const name = String(room).trim().replace(/^ห้อง\s*/, "");
  const m = name.match(/^([0-9][0-9.\-/]*)\b/);
  return m ? m[1] : name;
}


/** "ม.4/2" → "4/2". The "ม." is on every row and tells the reader nothing. */
function shortClass(name: string | null | undefined): string {
  return String(name ?? "").replace(/^ม\.?\s*/, "");
}

/** "พัก 10 นาที" → "พัก 10". Enough to name the column without filling it. */
/**
 * The full story of a non-lesson column: what it is, how long, and when.
 *
 * This used to be cut down to one or two words — "พัก 10" with the "นาที"
 * removed, and the "(ม.1-3)" taken off the lunch column, which left it
 * reading simply "พัก". Two levels break at different times here, so a bare
 * "พัก" is exactly the thing people have to ask about. The column is written
 * down the page across all five days, so there is room to answer it.
 *
 * Reads: "พัก 10 นาที · 10:10–10:20", "กินข้าว ม.ต้น · 50 นาที · 12:00–12:50".
 */
function breakLabel(p: {
  label?: string; type?: string; applies_to?: string;
  start_time?: string | null; end_time?: string | null;
}): string {
  const parts: string[] = [];

  // 1. The school's own wording, kept whole. "(ม.1-3)" becomes "ม.ต้น" —
  //    same meaning, and it is how the staffroom says it.
  let name = String(p.label ?? "").trim()
    .replace(/\(\s*ม\.?\s*1\s*[-–]\s*3\s*\)/g, "ม.ต้น")
    .replace(/\(\s*ม\.?\s*4\s*[-–]\s*6\s*\)/g, "ม.ปลาย")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) {
    name = p.type === "lunch" ? "พักกินข้าว"
      : p.type === "homeroom" ? "โฮมรูม"
      : p.type === "assembly" ? "เคารพธงชาติ"
      : "พัก";
  }
  // 2. Which level, when the label does not already say and the row is for
  //    one of them only.
  if (!/ม\.(ต้น|ปลาย)/.test(name)) {
    if (p.applies_to === "lower") name += " ม.ต้น";
    else if (p.applies_to === "upper") name += " ม.ปลาย";
  }
  parts.push(name);

  // 3. How long, unless the label already counted the minutes itself.
  const mins = minutesBetween(p.start_time, p.end_time);
  if (mins != null && mins > 0 && !/\d\s*นาที/.test(name)) {
    parts.push(`${mins} นาที`);
  }

  // 4. When — only if both ends are really times. A half-filled or mistyped
  //    row otherwise prints its own garbage onto the sheet.
  if (hhmm(p.start_time) && hhmm(p.end_time)) {
    parts.push(`${hhmm(p.start_time)}–${hhmm(p.end_time)}`);
  }

  return parts.join("  ·  ");
}

/** "10:10" if it reads as a time, otherwise null. */
function hhmm(t?: string | null): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Minutes from "10:10" to "10:20". null if either side is unreadable. */
function minutesBetween(a?: string | null, b?: string | null): number | null {
  const toMin = (t?: string | null) => {
    const v = hhmm(t);
    if (!v) return null;
    return Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  };
  const s = toMin(a), e = toMin(b);
  if (s == null || e == null) return null;
  return e - s;
}

// ── Cell renderers ───────────────────────────────────────────────────────────
// ความสูงบรรทัดมาจาก THAI_LINE_HEIGHT — เตี้ยกว่านั้นแล้ววรรณยุกต์ที่ซ้อน
// อยู่บนสระจะถูกเฉือนหายไปเงียบ ๆ ("เชื้อหมอ" กลายเป็น "เชือหมอ")
const cellText = (m: Metrics): React.CSSProperties =>
  ({ lineHeight: THAI_LINE_HEIGHT, fontSize: m.cellFont });

/**
 * ใช้เมื่อไม่รู้ความกว้างของช่อง — เกิดขึ้นได้เฉพาะเวลาเรียกช่องนอกตาราง
 *
 * ค่าเดิมที่เคยตรึงไว้ ปล่อยไว้เท่าเดิมเพื่อให้ทางที่ไม่รู้ความกว้างยังได้ผล
 * เหมือนก่อนหน้านี้ แทนที่จะเปลี่ยนรูปไปอีกแบบที่ไม่มีใครตั้งใจ
 */
const LEGACY_MAX_CHARS = 10;

/**
 * The three lines every cell has: subject code, teacher, room.
 *
 * Each line is a fixed height whether or not it has anything in it, so the
 * codes across a row sit on one line, the teachers on the next and the rooms
 * on the next — instead of every cell starting wherever its own content ended.
 */
function CellLines(
  { m, code, mid, room }: { m: Metrics; code: string; mid: string; room: string },
) {
  // สามบรรทัดนี้คือ "ตำแหน่ง" ไม่ใช่ความหมายตายตัว — ใบของชั้นคือ รหัสวิชา /
  // ครู / ห้อง · ใบของครูบรรทัดกลางเป็นชั้นเรียน · ใบของห้องบรรทัดล่างเป็นครู
  // ลำดับและขนาดที่ตั้งไว้จึงใช้ร่วมกันทั้งสามแบบ
  const layout = normalizePrintLayout(m.layout);
  const content: Record<CellPartKey, string> = {
    subject: code, teacher: mid, room, group: "",
  };
  const baseFont: Record<CellPartKey, string> = {
    subject: m.cellFont, teacher: m.subFont, room: m.roomFont, group: m.subFont,
  };
  // ของเดิมเดาไว้เป็นจำนวนตัวอักษรตรึง ๆ (รหัสวิชา 9 ตัว) ซึ่งกว้างกว่าช่องจริง
  // เกือบเท่าตัว รหัสวิชาเลยถูกตัดเป็น "ก339…" ทุกใบ ตอนนี้คิดจากความกว้างจริง
  // ของช่องแทน — ดู charsFitting ใน utils/fonts
  const fitsIn = (font: string): number =>
    m.colPx ? charsFitting(m.colPx, font) : LEGACY_MAX_CHARS;
  // ย่อลงได้ลึกแค่ไหนก่อนจะยอมให้ตัดท้ายด้วยจุดไข่ปลา
  //
  // รหัสวิชากับเลขห้องคือสองอย่างที่อ่านแวบเดียว จึงไม่ยอมให้เล็กมาก ส่วน
  // บรรทัดชื่อครูยอมให้เล็กลงได้อีก เพราะคาบที่สอนร่วมกันอย่าง
  // "ครูทัฬหมน + Charles" กว้าง 17 ช่อง ซึ่งพื้นเดิม (72%) รับได้แค่ราว 15
  // แล้วชื่อครูอีกคนจะหายไปในจุดไข่ปลา — ชื่อเล็กลงยังอ่านได้ ชื่อที่ถูกตัด
  // หายไม่เหลืออะไรให้อ่าน
  // พื้นที่ย่อลงได้ลึกสุดก่อนยอมตัดท้าย — ลดลงจาก 0.72/0.64 ตามที่ผู้ใช้สั่งว่า
  // "ลดขนาดตัวดีกว่าไม่ต้อง ก339.." ตัวที่เล็กลงยังอ่านได้ ตัวที่ถูกตัดไม่เหลือ
  // อะไรให้อ่าน ที่ 0.55 รหัสวิชา 13pt ย่อได้ถึง 7.2pt ซึ่งยังชัดบนกระดาษ
  const minScale: Record<CellPartKey, number> = {
    subject: 0.55, teacher: 0.5, room: 0.55, group: 0.5,
  };
  const weight: Record<CellPartKey, number> = {
    subject: 600, teacher: 400, room: 500, group: 400,
  };
  const colour: Record<CellPartKey, string> = {
    subject: "#111827", teacher: "#4b5563", room: "#1f2937", group: "#4b5563",
  };
  // Each line takes a third of the cell. Equal shares keep the codes across a
  // row on one line and the rooms on another, and because they are shares
  // rather than fixed heights they grow with the cell when the grid stretches
  // to fill the sheet.
  const line: React.CSSProperties = {
    flex: "1 1 0", minHeight: m.lineH,
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  };
  // Whatever is still too long after shrinking ends in an ellipsis instead of
  // being cut off mid-word at both edges, so the start of the name survives
  // and the reader can see that something was left out.
  const text: React.CSSProperties = {
    width: "100%", textAlign: "center",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  };
  // Roughly how many characters a lesson column holds at each size. The code
  // line is the largest type, so it fits the fewest.
  return (
    <div style={{ ...cellText(m), display: "flex", flexDirection: "column", height: "100%" }}>
      {layout.map((part) => {
        if (!part.show) return null;
        const base = scalePt(baseFont[part.key], part.scale);
        return (
          <div key={part.key}
               style={{ ...line, fontWeight: weight[part.key], color: colour[part.key] }}>
            <span style={{ ...text,
                           fontSize: fitFont(content[part.key], base,
                                             fitsIn(base), minScale[part.key]) }}>
              {content[part.key]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "11pt" × 1.25 → "13.8pt" — ขนาดในใบพิมพ์เป็น pt ไม่ใช่ px */
function scalePt(pt: string, scale: number): string {
  const n = parseFloat(pt);
  if (!Number.isFinite(n)) return pt;
  return `${(n * scale).toFixed(1)}pt`;
}

/**
 * ช่องที่ไม่มีคาบ แต่เขียนคำกำกับไว้
 *
 * วางกลางช่องทั้งช่อง ไม่ใช่บนบรรทัดรหัสวิชา เพราะไม่ได้เป็นคาบเรียน — และ
 * ใช้สีเทาเข้มแทนสีดำ เพื่อให้แยกออกจากคาบจริงเมื่อกวาดตามองทั้งหน้า
 */
function FreeCell({ text, m }: { text: string; m: Metrics }) {
  return (
    <div style={{
      ...cellText(m), height: "100%", display: "flex",
      alignItems: "center", justifyContent: "center", overflow: "hidden",
    }}>
      <span style={{
        width: "100%", textAlign: "center", whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", color: "#4b5563",
        fontSize: fitFont(text, m.subFont,
                          m.colPx ? charsFitting(m.colPx, m.subFont) : LEGACY_MAX_CHARS, 0.5),
      }}>{text}</span>
    </div>
  );
}

function GroupCell({ slots, m }: { slots: TimetableSlot[]; m: Metrics }) {
  if (slots.length === 0) return null;
  if (slots.length === 1) {
    const s = slots[0];
    // A shared elective names no subject — the class scatters across its
    // options — so the printed cell says so instead of coming out blank.
    const sharedElective = !!s.is_elective;
    return (
      <CellLines
        m={m}
        code={s.subject_code ?? s.subject_name ?? (sharedElective ? "วิชาเสรี" : "")}
        mid={teacherLine(s) || (sharedElective ? `${s.elective_options?.length ?? 0} ตัวเลือก` : "")}
        room={roomNumber(s.room_name)}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {slots.map((s) => (
        <div key={s.id} style={{ fontSize: m.subFont, lineHeight: 1.25, borderBottom: "1px dotted #ccc" }}>
          <span style={{ fontWeight: 600 }}>{s.subject_code ?? ""}</span>{" "}
          <span>{shortClass(s.group_name)}</span>{" "}
          <span style={{ fontWeight: 500 }}>{roomNumber(s.room_name)}</span>
        </div>
      ))}
    </div>
  );
}

function TeacherCell({ slots, m, teacherId }: { slots: TimetableSlot[]; m: Metrics; teacherId?: number }) {
  if (slots.length === 0) return null;
  const s = slots[0];
  // ครูคนหนึ่งอาจมีหลายห้องเรียนในชั่วโมงเดียว — ห้องย่อย ก/ข/ค ที่เรียนพร้อมกัน
  // ใบพิมพ์เคยวาดแค่คาบแรก ครูจึงเห็นบนจอสองห้องแต่พิมพ์ออกมาห้องเดียว
  //
  //   "คุณลองเช็คระบบปริ้นคาบต้องให้ตรงกับตารางที่เห็น"
  const classes = [...new Set(slots.map((x) => shortClass(x.group_name)).filter(Boolean))];
  // In a shared elective the class cell names nobody, but THIS teacher does
  // teach one of its options — print that subject, not an empty box.
  const mine = teacherId != null ? myElectiveOption(s, teacherId) : null;
  return (
    <CellLines
      m={m}
      code={s.subject_code ?? s.subject_name ?? mine?.code ?? (mine ? "วิชาเสรี" : "")}
      // คาบกิจกรรม (สาธารณประโยชน์ · คุณธรรม · ชุมนุม) ไม่ขึ้นชั้นเรียน
      //
      //   "ไม่ต้องมี ชั้นในคาบ สาธา คุณธรรม ชุมนุม"
      //
      // คาบพวกนี้ทั้งโรงเรียนเข้าพร้อมกัน บรรทัดนี้จึงเคยเป็น "M4/M5/M6 38 ห้อง"
      // ซึ่งยาวจนถูกตัด และไม่ได้บอกอะไรที่ครูไม่รู้อยู่แล้ว
      //
      // คาบเสรียังขึ้นชื่อวิชาที่ครูคนนี้รับผิดชอบ (mine.label) เหมือนเดิม เพราะ
      // ในคาบเสรีครูแต่ละคนสอนคนละวิชา ซึ่งเป็นข้อมูลที่ต้องมี
      //
      // ส่วนคาบปกติ ย่อเป็นช่วงแต่ไม่ตัดทิ้ง: กระดาษชี้เมาส์ดูรายการเต็มไม่ได้
      // ครูที่ถือใบนี้เข้าสอนต้องเห็นห้องเรียนครบทุกห้อง
      mid={mine?.label ?? (s.is_activity_block ? "" : classRanges(classes))}
      // ห้องของครูคนนี้ ไม่ใช่ห้องของคาบ — ในคาบเสรีแต่ละวิชาอยู่คนละห้อง
      // ของเดิมใบนี้เว้นช่องห้องว่างไว้ทุกคาบเสรี เพราะคาบเสรีไม่มีห้องของตัวเอง
      room={roomNumber(roomNameForTeacher(s, teacherId) ?? s.room_name)}
    />
  );
}

/**
 * บรรทัดล่างสุดของกระดาษหนึ่งแผ่น — หมายเหตุของโรงเรียน · วันที่ · เลขหน้า
 *
 *   "ช่วยทำระบบที่สามารถเขียนข้อความจัดหน้ากระดาษก่อนจะปริ้นให้หน่อย"
 *
 * ของเดิมบนใบตารางไม่มีวันที่ ไม่มีเลขหน้า และไม่มีที่ให้โรงเรียนเขียนอะไรเลย
 * ใบที่หลุดจากปึกไปแล้วจึงบอกไม่ได้ว่าเป็นของปึกไหน หรือพิมพ์เมื่อไร
 *
 * เลขหน้าทำที่นี่ ไม่ได้ใช้ counter(page) ของ CSS เพราะเบราว์เซอร์ไม่รองรับกล่อง
 * ขอบกระดาษ (@bottom-center) — แต่ที่นี่รู้อยู่แล้วว่าแผ่นนี้เป็นแผ่นที่เท่าไร
 * จากทั้งหมดกี่แผ่น เพราะใบพิมพ์เป็นฝ่ายจัดแผ่นเองทั้งหมด
 *
 * เงียบสนิทเมื่อโรงเรียนไม่ได้เปิดอะไรไว้ — ค่าตั้งต้นคือใบเดิมทุกตัวอักษร
 */
const SheetFooter: React.FC<{
  setup: SheetSetup; index: number; total: number; compact: boolean;
}> = ({ setup, index, total, compact }) => {
  const note = (setup.note ?? "").trim();
  const right = [
    setup.showDate ? `พิมพ์ ${thaiDate()}` : "",
    setup.showPageNumbers ? pageLabel(index, total) : "",
  ].filter(Boolean).join("  ·  ");
  if (!note && !right) return null;
  return (
    <div style={{
      marginTop: "2mm", display: "flex", justifyContent: "space-between",
      gap: "4mm", fontSize: compact ? "7pt" : "8pt", color: "#444",
      // ไม่ให้ยืดแย่งที่จากตาราง — เอาเท่าที่ข้อความต้องการ
      flex: "0 0 auto",
    }}>
      <span style={{ whiteSpace: "pre-wrap" }}>{note}</span>
      <span style={{ whiteSpace: "nowrap" }}>{right}</span>
    </div>
  );
};

/**
 * หนึ่งช่องของ "ตารางการใช้ห้องสอน" — ห้องเป็นเจ้าของกระดาษแผ่นนี้ บรรทัดที่สาม
 * จึงเป็นชื่อครูแทนชื่อห้อง (ซึ่งจะซ้ำกับหัวกระดาษทุกช่อง)
 *
 *   "ช่วยทำปุ่มกดเพื่อปริ้น ตารางการใช้ห้องสอนเพิ่มเติมด้วย"
 *
 * ห้องหนึ่งอาจมีหลายห้องเรียนในชั่วโมงเดียวได้จริง — คาบที่สอนรวมสองห้องย่อย
 * หรือคาบกิจกรรมที่ใช้ห้องร่วมกัน จึงรวมชื่อห้องเรียนไว้ในบรรทัดเดียว
 */
function RoomCell({ slots, m, roomId }: {
  slots: TimetableSlot[]; m: Metrics; roomId?: number;
}) {
  if (slots.length === 0) return null;
  const s = slots[0];
  const classes = [...new Set(slots.map((x) => shortClass(x.group_name)).filter(Boolean))];
  // คาบเสรีมีหลายวิชาเรียนพร้อมกันคนละห้อง ใบของห้องนี้ต้องเขียนวิชาที่สอนใน
  // ห้องนี้ ไม่ใช่ "วิชาเสรี" ลอย ๆ และไม่ใช่ครูของทุกวิชาในคาบนั้น
  const here = roomId != null
    ? slots.flatMap((x) => optionsInRoom(x, roomId))
    : [];
  const who = (here.length
    ? [...new Set(here.map((o) => o.teacher_name ?? null))]
    : [...new Set(slots.flatMap((x) => slotTeacherNames(x)))]
  ).filter((n): n is string => !!n).map((n) => shortTeacher(n)).filter(Boolean);
  return (
    <CellLines
      m={m}
      code={here[0]?.code ?? here[0]?.label
            ?? s.subject_code ?? s.subject_name ?? (s.is_elective ? "วิชาเสรี" : "")}
      // ใบของห้องคือที่ที่รายชื่อยาวที่สุด — ห้องดนตรีไทยคาบหนึ่งมีสิบห้องเรียน
      mid={classRanges(classes)}
      // บรรทัดล่างของใบนี้เป็นชื่อครู (ไม่ใช่ชื่อห้องซึ่งซ้ำกับหัวกระดาษ) จึงใส่
      // คำว่าครูนำหน้าด้วยกฎเดียวกับใบของชั้นเรียน
      room={withKhru(who, " ")}
    />
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export const PrintView = forwardRef<HTMLDivElement, PrintViewProps>(
  ({ slots, groups, teachers = [], rooms = [], departments = [], subjects = [],
     periods, schoolConfig, options }, ref) => {
    const termLabel = `ภาคเรียนที่ ${schoolConfig.term}/${schoolConfig.year}  โรงเรียน${schoolConfig.schoolName}`;
    // ผังบรรทัดของใบพิมพ์ — เก็บไว้กับการตั้งค่าโรงเรียน เหมือนผังบนจอ
    const m: Metrics = {
      ...METRICS[options.perPage],
      layout: normalizePrintLayout(schoolConfig.print_layout),
    };
    const compact = options.perPage === 2;
    const pick = new Set(options.selectedIds);
    // แบบฟอร์มใบพิมพ์ — ช่องลงชื่อ หมายเหตุ วันที่ เลขหน้า เก็บไว้กับค่าตั้ง
    // โรงเรียนเหมือนผังบรรทัด ยังไม่ได้ตั้ง = ใบเดิมทุกตัวอักษร (utils/printSheet)
    const sheetSetup = normalizeSheet(schoolConfig.print_sheet);
    // ใบตารางกับใบอัตรากำลังต้องการคนเซ็นคนละชุด อ่านจากแบบฟอร์มเดียวกันแต่
    // กรองคนละแบบ — โรงเรียนจะได้ไม่ต้องเข้าไปแก้สลับไปมาทุกครั้งที่เปลี่ยนใบ
    const signers = sheetSigners(sheetSetup, schoolConfig, "timetable");
    const workSigners = sheetSigners(sheetSetup, schoolConfig, "workload");

    // Build one block per class / teacher, in the requested order.
    const blocks: React.ReactNode[] = [];

    if (options.mode === "workload") {
      // handled below, outside the sheet packer
    } else if (options.mode === "teacher") {
      const deptName = (id: number | null | undefined) =>
        departments.find((d) => d.id === id)?.name ?? "";
      const list = teachers
        .filter((t) => pick.size === 0 || pick.has(t.id))
        .sort((a, b) => {
          if (options.sort === "code") return (a.code ?? "").localeCompare(b.code ?? "") || compareNames(a.name, b.name);
          if (options.sort === "department") return deptName(a.department_id).localeCompare(deptName(b.department_id)) || compareNames(a.name, b.name);
          return compareNames(a.name, b.name);
        });

      list.forEach((teacher, idx) => {
        const grid = buildGrid(slotsForTeacher(slots, teacher.id));
        const codePart = teacher.code ? `รหัสประจำตัว ${teacher.code}` : "";
        blocks.push(
          <TimetableBlock
            key={`t-${teacher.id}`}
            title={`ตารางสอน ${String(idx + 1).padStart(3, "0")}  ${teacher.name}`}
            subtitle={[codePart, deptName(teacher.department_id), termLabel]
              .filter(Boolean).join("  ·  ")}
            grid={grid} periods={periods} schoolConfig={schoolConfig}
            signers={signers}
            metrics={m} compact={compact}
            renderCell={(cs, cm) => <TeacherCell slots={cs} m={cm} teacherId={teacher.id} />}
          />,
        );
      });
    } else if (options.mode === "room") {
      // ห้องที่ไม่มีคาบเลยไม่ต้องพิมพ์ ถ้าไม่ได้ติ๊กมาเอง — โรงเรียนนี้มี 130
      // ห้อง และหลายห้องเป็นห้องพักครูหรือห้องที่ยังไม่ได้ใช้ การพิมพ์ทั้งหมด
      // คือกระดาษเปล่าหลายสิบแผ่น
      const hourMap = roomHoursOf(slots);
      const list = roomsToPrint(rooms, slots, options.selectedIds)
        .sort((a, b) => (options.sort === "department"
          ? compareNames(a.building_name ?? "", b.building_name ?? "")
          : 0) || compareNames(a.name, b.name));

      list.forEach((room, idx) => {
        // คาบเสรีเก็บห้องไว้ที่วิชาแต่ละวิชา ไม่ได้เก็บที่ตัวคาบ — ดู
        // utils/electiveRooms ถ้าเทียบ room_id ตรง ๆ ใบนี้จะไม่มีคาบเสรีเลย
        const mine = slots.filter((x) => slotUsesRoom(x, room.id));
        const grid = buildGrid(mine);
        const hours = roomHourCount(hourMap, room.id);
        const where = [room.building_name, room.floor ? `ชั้น ${room.floor}` : ""]
          .filter(Boolean).join(" ");
        blocks.push(
          <TimetableBlock
            key={`r-${room.id}`}
            title={`ตารางการใช้ห้อง ${String(idx + 1).padStart(3, "0")}  ${room.name}`}
            subtitle={[where, room.capacity ? `จุ ${room.capacity} คน` : "",
                       `ใช้ ${hours} คาบ/สัปดาห์`, termLabel]
              .filter(Boolean).join("  ·  ")}
            grid={grid} periods={periods} schoolConfig={schoolConfig}
            signers={signers}
            metrics={m} compact={compact}
            renderCell={(cs, cm) => <RoomCell slots={cs} m={cm} roomId={room.id} />}
          />,
        );
      });
    } else {
      // A class sheet shows its own lessons plus any shared with parent/subgroups.
      const shares = buildSharesStudents(groups);
      const flat = flattenGroups(groups);
      const list = flat
        .filter((g) => pick.size === 0 || pick.has(g.id))
        .sort((a, b) => compareNames(a.level ?? "", b.level ?? "") || compareNames(a.name, b.name));

      list.forEach((group, idx) => {
        const grid = buildGrid(slots.filter((s) => shares(s.group_id, group.id)));
        // Who to ask about this class's timetable — named on the sheet, with
        // the code, so a printed copy identifies itself without the system.
        // All of them: a class may have up to three ครูประจำชั้น, and a sheet
        // naming only the first sends parents to the wrong one.
        // A sub-class takes the advisors recorded on the class above it, so
        // ม.4/6ก's sheet names the same people as ม.4/6's rather than nobody.
        const advisors = effectiveHomeroomIds(group, flat)
          .map((id) => teachers.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => !!t)
          .map((t) => `${t.code ? `${t.code} ` : ""}${shortTeacher(t.name)}`);
        const advisorLabel = advisors.length
          ? `  ·  ครูประจำชั้น ${advisors.join(" , ")}`
          : "";
        blocks.push(
          <TimetableBlock
            key={`g-${group.id}`}
            level={levelKeyOf(group)}
            title={`ตารางเรียน ${String(idx + 1).padStart(3, "0")}  ห้อง ${group.name}`}
            subtitle={`${termLabel}${advisorLabel}`}
            grid={grid} periods={periods} schoolConfig={schoolConfig}
            signers={signers}
            metrics={m} compact={compact}
            renderCell={(cs, cm) => <GroupCell slots={cs} m={cm} />}
            fillEmpty={(no, cs) => freeCellLabel(no, cs, {
              label: options.freeLabel ?? DEFAULT_FREE_LABEL,
              through: options.freeLabelThrough ?? DEFAULT_FREE_THROUGH,
            })}
          />,
        );
      });
    }

    // Pack the blocks onto sheets.
    const sheets: React.ReactNode[][] = [];
    for (let i = 0; i < blocks.length; i += options.perPage) {
      sheets.push(blocks.slice(i, i + options.perPage));
    }

    return (
      <div ref={ref} className="print-wrapper">
        <style>{`
          /* ฟอนต์โหลดไว้แล้วที่ index.html — ไม่ @import ซ้ำที่นี่ เพราะ
             บล็อกนี้ถูกซ่อนอยู่จนกดสั่งพิมพ์ ฟอนต์ที่เพิ่งเริ่มโหลดตอนนั้น
             มาไม่ทันหน้าตัวอย่างพิมพ์ แล้วได้ฟอนต์สำรองที่ขนาดไม่เท่ากัน */
          .print-wrapper { font-family: ${FONT_STACK}; }
          .print-page { width: 190mm; }
          .tt-block + .tt-block { margin-top: 5mm; padding-top: 3mm; border-top: 1px dashed #bbb; }
          /* The frame round the whole timetable. It is on this wrapper rather
             than on the table because a div's border is drawn inside its own
             box: nothing hangs over the page edge for overflow:hidden to clip,
             so the grid closes on all four sides and the last column ends in a
             border like every other one. */
          .tt-grid { border: 1.4px solid #000; box-sizing: border-box; }
          /* Fill the sheet top to bottom. The page is a flex column of the
             exact printable height; each block takes an equal share of it and
             its grid stretches into that share, so the cells are full-height
             whether there are one or two tables on the sheet. */
          @media print {
            .print-page {
              display: flex; flex-direction: column;
              height: 281mm; max-height: 281mm; overflow: hidden;
            }
            .tt-block { flex: 1 1 0; min-height: 0; }
            /* ตารางสูงเท่าเนื้อหา ไม่ยืดกินที่ว่างทั้งหน้า — บล็อกยังกินทั้ง
               หน้าเหมือนเดิม ส่วนแถวลงชื่อตามขึ้นมาอยู่ใต้ตารางเลย ไม่ถูกดัน
               ลงก้นหน้า ("เอาชื่อขึ้นไปติดกับตาราง") ที่ว่างทั้งหมดจึงไปรวมกัน
               อยู่ใต้แถวลงชื่อ แทนที่จะคั่นกลางระหว่างตารางกับชื่อ */
            .tt-grid  { flex: 0 0 auto; min-height: 0; }
            /* Half a sheet, measured the same way a pair is: the page is a
               flex column of the printable height and a pair splits it with
               5mm of gap, so one alone takes that same share and the bottom
               half stays empty. */
            .print-page.half > .tt-block { flex: 0 0 calc(50% - 4mm); }
          }
          @media print {
            body > *:not(.print-wrapper) { display: none !important; }
            .no-print { display: none !important; }
            .print-wrapper { display: block !important; }
            @page { size: A4 portrait; margin: 8mm 10mm; }
            .print-page { page-break-after: always; break-after: page; page-break-inside: avoid; width: auto; }
            .print-page:last-child { page-break-after: auto; break-after: auto; }
          }
          @media screen { .print-wrapper { display: none; } }
        `}</style>

        {/* อัตรากำลัง is a different document, not a timetable laid out
            differently — one page per teacher, listing what they carry. */}
        {options.mode === "workload" ? (
          <WorkloadReport
            teachers={teachers} departments={departments} groups={groups}
            subjects={subjects} slots={slots}
            schoolName={schoolConfig.schoolName} termLabel={termLabel}
            selectedIds={options.selectedIds} sort={options.sort}
            countActivities={options.countActivities !== false}
            signers={workSigners}
          />
        ) : sheets.length > 0 ? (
          sheets.map((sheet, i) => (
            /* A sheet holding one table when two were asked for keeps that
               table at half height. Letting it stretch gave the last page of
               an odd run — and every single-class print — one table blown up
               to fill A4, which is a different sheet from all the others. */
            <div key={i}
              className={`print-page${options.perPage === 2 && sheet.length === 1 ? " half" : ""}`}>
              {sheet}
              <SheetFooter setup={sheetSetup} index={i} total={sheets.length} compact={compact} />
            </div>
          ))
        ) : (
          <div className="print-page" style={{ padding: "20mm" }}>
            <p>ไม่มีตารางที่ตรงกับตัวเลือกการพิมพ์</p>
          </div>
        )}
      </div>
    );
  },
);

PrintView.displayName = "PrintView";
