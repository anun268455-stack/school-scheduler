import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiErrorText, listDepartments, listTeachers } from "../api";
import { departmentName, formatNumber } from "../curriculum";
import { ROUND_STATUS_TEXT, type Round, type TeacherLoad } from "../round";
import { getRoundItems, getRoundLoads, type RoundItems } from "../roundApi";
import {
  levelTone, pendingNote, sheetRound, sheetTitle, subjectSheet, teacherSheet, type SheetKind, type SubjectBlock,
  type TeacherBlock,
} from "../sheets";
import { Button, Card, Chip, EmptyState, Notice, Segmented } from "../ui";
import { useRegistryList } from "../useRegistryList";

// หน้าสรุปอัตรากำลังสองแบบ แทนชีต Excel เดิมของโรงเรียน (แบบข้อ 2 ข้อ 5): แบบรายวิชา (วิชาไหนครูคนไหนสอน) · แบบครูผู้สอน (ครูคนไหน
// สอนอะไร) — สดจากแถวของรอบ ไม่มีอะไรให้แก้ที่นี่ · พิมพ์จากเบราว์เซอร์ได้ (A4 แนวตั้ง หัวตารางซ้ำทุกหน้า ไม่มีแถบเมนูติดไป)
// admin เลือกกลุ่มสาระหรือทุกกลุ่ม · หัวหน้าเห็นกลุ่มตัวเองเท่านั้น (เซิร์ฟเวอร์ให้แค่แถวของกลุ่มตัวเองอยู่แล้ว ไม่ว่าหน้าจะขออะไร)
// ตัวเลขคาบของครูนับใน sheets.ts ด้วยกฎเดียวกับ wl_teacher_loads · ยอดทั้งรอบ (รวมกลุ่มอื่น) มาจาก GET .../loads

type Mode = "admin" | "head";
type Dept = number | "all";

// ก้อนที่สั้นกว่านี้ไม่แตกข้ามหน้ากระดาษ (ย้ายไปหน้าใหม่ทั้งก้อน) · ก้อนยาวกว่านี้แตกได้ แต่ไม่ตัดกลางบรรทัด — ไม่งั้นหน้าว่างครึ่งหน้า
const KEEP_LINES = 14;
const VIEWS = [
  { value: "subject" as const, label: "แบบรายวิชา" },
  { value: "teacher" as const, label: "แบบครูผู้สอน" },
];
const COUNT_NOTE =
  "คาบเสรี/กิจกรรมนับครั้งเดียวต่อชุด (ไม่คูณจำนวนห้อง) ยอดของครูที่สอนคาบเสรีจึงอาจมากกว่ายอดตามแผนในโปรแกรมจัดตาราง";

const num = (n: number | null): string => (n === null ? "—" : formatNumber(n));

// ความกว้างคอลัมน์ (%) — ตารางเป็น table-layout: fixed (.sheet-table/.sheet-col ใน index.css) ทั้งบนจอและกระดาษ
// ถ้าปล่อยเบราว์เซอร์จัดเอง ช่วงห้องยาว ๆ ของชุดคาบเสรีกินที่จนชื่อครูถูกบีบเป็นสองบรรทัด · จอแคบกว่า 880px เลื่อนในกรอบตาราง
const SUBJECT_COLS = [4, 5, 4.5, 7.5, 17.5, 4, 5, 8.5, 7.5, 21, 15.5];
const TEACHER_COLS = [4, 20, 7.5, 27, 4, 8.5, 8, 7, 7, 7];

function Cols(props: { widths: number[] }) {
  return (
    <colgroup>
      {props.widths.map((w, i) => <col key={i} className="sheet-col" style={{ "--w": `${w}%` } as CSSProperties} />)}
    </colgroup>
  );
}

export default function SummaryPage(props: {
  mode: Mode;
  /** รายการรอบจาก App (หัวหน้าไม่ได้รอบที่กำลังเตรียม — เซิร์ฟเวอร์ไม่ส่ง) */
  rounds: Round[] | null;
  roundsError: string | null;
  onReloadRounds: () => void;
  /** หัวหน้า: กลุ่มของตัวเอง */
  deptId: number | null;
  /** ลิงก์ "ดูทั้งหมด · พิมพ์" จากหน้ากรอก: เปิดที่รอบและกลุ่มนั้น */
  focus?: { roundId: number; deptId: number } | null;
}) {
  const { mode, rounds } = props;
  const [view, setView] = useState<SheetKind>("subject");
  const [pickedRound, setPickedRound] = useState<number | null>(props.focus?.roundId ?? null);
  const [dept, setDept] = useState<Dept>(mode === "head" ? (props.deptId ?? "all") : (props.focus?.deptId ?? "all"));
  // รอบที่เลือกไว้หายจากรายการ (ถูกยกเลิก) → กลับไปรอบตั้งต้น
  const round = rounds ? (rounds.find((r) => r.id === pickedRound) ?? sheetRound(rounds)) : null;
  // ชีตทุกกลุ่มมีทุกรายการของรอบอยู่แล้ว — ไม่ต้องขอยอดทั้งรอบ (ไม่มีส่วนของกลุ่มอื่น)
  const needLoads = !(mode === "admin" && dept === "all");

  const teachers = useRegistryList(listTeachers);
  const depts = useRegistryList(listDepartments);

  // ข้อมูลของชีต: โหลดใหม่ทุกครั้งที่เปลี่ยนรอบ/กลุ่ม · ของเก่าไม่อยู่บนจอระหว่างรอ (หัวกระดาษจะเป็นของอีกกลุ่ม)
  // สถานะรอบเปลี่ยน (เปิดให้กรอก · ปิดรอบ — รายการรอบใหม่มาจาก App) ก็โหลดใหม่ แต่ของเดิมอยู่บนจอจนของใหม่มา
  const roundId = round?.id ?? null;
  const roundStatus = round?.status ?? null;
  const key = roundId === null ? null : `${roundId}-${dept}`;
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<{ key: string; items: RoundItems; loads: TeacherLoad[] | null } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (roundId === null || key === null || roundStatus === null) return;
    let cancelled = false;
    // หัวหน้า: เซิร์ฟเวอร์ให้กลุ่มตัวเองเสมอ ไม่ต้องส่ง · admin: ไม่ส่ง = ทุกกลุ่ม
    const deptParam = mode === "admin" && dept !== "all" ? dept : undefined;
    Promise.all([getRoundItems(roundId, deptParam), needLoads ? getRoundLoads(roundId) : Promise.resolve(null)]).then(
      ([items, loads]) => {
        if (cancelled) return;
        setData({ key, items, loads });
        setError(null);
      },
      (err) => {
        if (!cancelled) setError({ key, text: apiErrorText(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, roundId, roundStatus, dept, mode, needLoads, tick]);

  const current = data && data.key === key ? data : null;
  const loadError = error && error.key === key ? error.text : null;

  const deptName = dept === "all" ? null : departmentName(dept, depts.rows, depts.loaded);
  // ชื่อครูจากทะเบียน (รวมคนที่ไม่ปฏิบัติงานแล้ว) → ชื่อจากยอดคาบ → "ครูรหัส N" (ไม่ใช่ช่องว่าง)
  const teacherName = useMemo(() => {
    const names = new Map<number, string>();
    for (const l of current?.loads ?? []) names.set(l.teacher_id, l.name);
    for (const t of teachers.rows) names.set(t.id, t.name);
    return (id: number) => names.get(id) ?? `ครูรหัส ${id}`;
  }, [teachers.rows, current?.loads]);

  const subjects = useMemo(
    () => (current && round && view === "subject" ? subjectSheet(current.items.rows, current.items.options, teacherName, round.semester) : null),
    [current, round, view, teacherName],
  );
  const teacherBlocks = useMemo(
    () => (current && view === "teacher" ? teacherSheet(current.items.rows, current.items.options, teachers.rows, current.loads) : null),
    [current, view, teachers.rows],
  );
  const pending = useMemo(() => (current ? pendingNote(current.items.rows, current.items.options) : null), [current]);

  // ---- ยังไม่มีรอบให้สรุป ----
  if (!rounds) {
    return props.roundsError ? (
      <div className="space-y-3">
        <Notice tone="bad" role="alert">โหลดรอบอัตรากำลังไม่ได้: {props.roundsError}</Notice>
        <Button onClick={props.onReloadRounds}>ลองโหลดใหม่</Button>
      </div>
    ) : (
      <p role="status" className="text-muted">กำลังโหลดรอบอัตรากำลัง...</p>
    );
  }
  if (!round) {
    return (
      <EmptyState
        title="ยังไม่มีรอบอัตรากำลัง"
        hint={mode === "admin"
          ? "เปิดรอบที่เมนู รอบอัตรากำลัง ก่อน แล้วหน้านี้จะสรุปให้ทั้งแบบรายวิชาและแบบครูผู้สอน"
          : "เมื่อผู้ดูแลระบบเปิดรอบให้กลุ่มสาระกรอก หน้านี้จะสรุปรายวิชาและครูของกลุ่มให้ และพิมพ์ได้"}
      />
    );
  }
  if (mode === "head" && props.deptId === null) {
    return <Notice tone="bad" role="alert">รหัสนี้ไม่ได้ผูกกับกลุ่มสาระ จึงดูสรุปไม่ได้ แจ้งผู้ดูแลระบบ</Notice>;
  }

  const title = sheetTitle(view, round.semester, round.year, deptName);
  const blocks = view === "subject" ? subjects : teacherBlocks;
  // ชื่อครูและชื่อกลุ่มต้องมาก่อน ไม่งั้นกระดาษพิมพ์ออกไปเป็น "ครูรหัส N" / "กลุ่มสาระรหัส N" (โหลดไม่ได้ = ใช้ที่มี พร้อมข้อความผิดพลาด)
  const namesReady = (teachers.loaded || teachers.error !== null) && (dept === "all" || depts.loaded || depts.error !== null);
  const ready = blocks !== null && namesReady;

  return (
    <div>
      {/* ส่วนควบคุม — ไม่ติดไปบนกระดาษ */}
      <div className="mb-5 space-y-4 print:hidden">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-title text-ink">สรุปอัตรากำลัง</h2>
            {round.status === "preparing" && <Chip tone="warn" data-testid="draft-chip">ร่าง — ยังไม่เปิดให้กรอก</Chip>}
            {round.status === "closed" && <Chip tone="mute">ปิดรอบแล้ว</Chip>}
          </div>
          <p className="mt-1 text-muted">
            {view === "subject" ? "วิชาไหน ห้องไหน ครูคนไหนสอน" : "ครูแต่ละคนสอนวิชาอะไร ห้องไหน รวมกี่คาบ"} · สดจากรายการของรอบ
            {mode === "head" ? " · แก้ชื่อครูได้ที่หน้าอัตรากำลังของกลุ่ม" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented options={VIEWS} value={view} onChange={setView} label="แบบของชีต" />
          {mode === "admin" && (
            <label className="flex flex-col gap-1 text-sm text-muted">
              กลุ่มสาระ
              <select className="input text-[15px]" value={String(dept)} data-testid="dept-picker"
                onChange={(e) => setDept(e.target.value === "all" ? "all" : Number(e.target.value))}>
                <option value="all">ทุกกลุ่มสาระ</option>
                {depts.rows.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                {dept !== "all" && !depts.rows.some((d) => d.id === dept) && <option value={dept}>{deptName}</option>}
              </select>
            </label>
          )}
          {rounds.length > 1 && (
            <label className="flex flex-col gap-1 text-sm text-muted">
              รอบ
              <select className="input text-[15px]" value={round.id} data-testid="round-picker"
                onChange={(e) => setPickedRound(Number(e.target.value))}>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>ภาคเรียน {r.label} · {ROUND_STATUS_TEXT[r.status]}</option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center gap-3 sm:ml-auto">
            <span className="hidden text-sm text-muted lg:inline">กระดาษ A4 แนวตั้ง · หัวตารางซ้ำทุกหน้า</span>
            <Button variant="primary" disabled={!ready} onClick={() => window.print()}>พิมพ์</Button>
          </div>
        </div>
        {depts.error && (
          <Notice tone="bad" role="alert" className="flex flex-wrap items-center justify-between gap-3">
            <span>โหลดรายชื่อกลุ่มสาระไม่ได้: {depts.error}</span>
            <Button size="sm" onClick={depts.reload}>ลองโหลดใหม่</Button>
          </Notice>
        )}
        {teachers.error && (
          <Notice tone="bad" role="alert" className="flex flex-wrap items-center justify-between gap-3">
            <span>โหลดรายชื่อครูไม่ได้: {teachers.error} — ครูบางคนอาจขึ้นเป็นรหัสแทนชื่อ</span>
            <Button size="sm" onClick={teachers.reload}>ลองโหลดใหม่</Button>
          </Notice>
        )}
        {loadError && (
          <Notice tone="bad" role="alert" className="flex flex-wrap items-center justify-between gap-3">
            <span>โหลดรายการของรอบไม่ได้: {loadError}</span>
            <Button size="sm" onClick={() => setTick((n) => n + 1)}>ลองโหลดใหม่</Button>
          </Notice>
        )}
      </div>

      {/* กระดาษ: หัวกระดาษ 3 บรรทัด · บรรทัดใต้หัว · ตาราง (จอแคบเป็นการ์ดซ้อน — ตอนพิมพ์ใช้ตารางเสมอ) */}
      <Card as="section" aria-label={title[0]} data-testid="sheet"
        className="print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="text-center" data-testid="sheet-title">
          <h3 className="text-lg font-bold leading-snug print:text-[13pt]">{title[0]}</h3>
          <p className="font-semibold leading-snug print:text-[11pt]">{title[1]}</p>
          <p className="font-semibold leading-snug print:text-[11pt]">{title[2]}</p>
          {round.status === "preparing" && <p className="mt-1 text-sm font-semibold text-warn">ร่าง — ยังไม่เปิดให้กรอก</p>}
        </header>
        <div className="mt-3 space-y-0.5 text-sm text-muted print:text-[8.5pt] print:text-ink">
          <p data-testid="count-note">{COUNT_NOTE}</p>
          {pending && <p data-testid="pending-note" className="font-medium text-warn">{pending} (แถวพื้นเหลืองจาง)</p>}
        </div>

        {!ready || blocks === null ? (
          !loadError && <p role="status" className="mt-6 text-muted">กำลังโหลดรายการของรอบ...</p>
        ) : blocks.length === 0 ? (
          <div className="mt-4">
            {view === "subject" ? (
              <EmptyState title="รอบนี้ไม่มีรายการของกลุ่มสาระนี้"
                hint="ไม่มีบรรทัดหลักสูตรหรือตัวเลือกคาบเสรี/กิจกรรมที่เป็นของกลุ่มนี้ · ถ้าคิดว่าควรมี ให้ตรวจหลักสูตร" />
            ) : (
              <EmptyState title="ยังไม่มีครูในรายการของกลุ่มนี้"
                hint="ใส่ครูที่หน้าอัตรากำลังของกลุ่มก่อน แล้วแบบครูผู้สอนจะแสดงครูแต่ละคนพร้อมยอดคาบ" />
            )}
          </div>
        ) : view === "subject" ? (
          <SubjectSheetView blocks={subjects!} />
        ) : (
          <TeacherSheetView blocks={teacherBlocks!} />
        )}
      </Card>
    </div>
  );
}

// ---- แบบรายวิชา ----

const TH = "px-2 py-2 align-bottom font-semibold print:px-1 print:py-1";
const TD = "px-2 py-1.5 align-top print:px-1 print:py-0.5";

function LevelBadge(props: { level: string | null }) {
  return (
    <span className={`inline-block rounded-md px-1.5 text-sm font-semibold leading-6 print:text-[9pt] print:leading-5 ${levelTone(props.level)}`}>
      {props.level ?? "—"}
    </span>
  );
}

function SubjectSheetView(props: { blocks: SubjectBlock[] }) {
  return (
    <>
      {/* จอกลาง (768–1279) ตารางกว้างกว่ากรอบได้ — เลื่อนในกรอบตัวเอง ไม่ดันทั้งหน้า · กระดาษไม่ตัด */}
      <div className="mt-4 hidden overflow-x-auto md:block print:block print:overflow-visible">
        <table className="sheet-table w-full min-w-[880px] border-collapse text-[15px] print:min-w-0 print:text-[8.5pt]" data-testid="sheet-table">
          <Cols widths={SUBJECT_COLS} />
          <thead>
            <tr className="border-b-2 border-line text-left text-sm text-muted print:text-[8.5pt] print:text-ink">
              <th className={`${TH} text-right`}>ลำดับที่</th>
              <th className={TH}>ชั้น</th>
              <th className={`${TH} text-center`}>ภาคเรียนที่</th>
              <th className={TH}>รหัสวิชา</th>
              <th className={TH}>ชื่อวิชา</th>
              <th className={`${TH} text-right`}>นก.</th>
              <th className={`${TH} text-right`}>คาบ/สัปดาห์</th>
              <th className={TH}>ประเภทวิชา</th>
              <th className={TH}>ห้องที่เรียน</th>
              <th className={TH}>ครูผู้สอน 1</th>
              <th className={TH}>ครูผู้สอน 2 <span className="block text-xs font-normal">(ครูสอนร่วม)</span></th>
            </tr>
          </thead>
          {props.blocks.map((b) => (
            <tbody key={b.no} className={`border-t border-line ${b.lines.length <= KEEP_LINES ? "keep" : ""}`} data-testid="block"
              data-code={b.code}>
              {b.lines.map((l, i) => (
                <tr key={i} className={`${i > 0 ? "border-t border-line2" : ""} ${l.pending ? "sheet-pending bg-warn-faint" : ""} ${i === 0 ? "font-semibold" : ""}`}>
                  <td className={`${TD} text-right tabular-nums`}>{i === 0 ? b.no : ""}</td>
                  <td className={TD}>{i === 0 && <LevelBadge level={b.level} />}</td>
                  <td className={`${TD} text-center tabular-nums`}>{i === 0 ? b.semester : ""}</td>
                  <td className={`${TD} ${i === 0 ? "sheet-code" : ""}`}>{i === 0 ? b.code : ""}</td>
                  <td className={TD}>
                    {i === 0 && (
                      <>
                        {b.name}
                        {b.setText && <span className="block text-xs font-normal text-muted print:text-[7.5pt]">{b.setText}</span>}
                      </>
                    )}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{i === 0 ? num(b.credits) : ""}</td>
                  <td className={`${TD} text-right tabular-nums`}>{i === 0 ? num(b.weekly) : ""}</td>
                  <td className={TD}>{i === 0 ? b.kindLabel : ""}</td>
                  <td className={TD}>{l.room}</td>
                  <td className={TD}>{l.teacher1 ?? <span className="text-muted">—</span>}</td>
                  <td className={TD}>{l.teacher2 ?? ""}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* จอแคบ: ก้อนละการ์ด (ตารางสิบเอ็ดคอลัมน์ไม่พอจอโทรศัพท์ · หน้าไม่เลื่อนแนวนอน) */}
      <ol className="mt-4 space-y-3 md:hidden print:hidden" data-testid="sheet-cards">
        {props.blocks.map((b) => (
          <li key={b.no} className="rounded-xl border border-line p-3" data-testid="card" data-code={b.code}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
              <span className="tabular-nums text-muted">{b.no}.</span>
              <LevelBadge level={b.level} />
              <span className="sheet-code rounded px-1">{b.code}</span>
              <span className="min-w-0 break-words">{b.name}</span>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {b.kindLabel} · {num(b.credits)} นก. · {num(b.weekly)} คาบ/สัปดาห์ · ภาคเรียนที่ {b.semester}
            </p>
            {b.setText && <p className="text-sm text-muted">{b.setText}</p>}
            <ul className="mt-2 divide-y divide-line2 text-[15px]">
              {b.lines.map((l, i) => (
                <li key={i} className={`flex gap-3 px-1 py-1.5 ${l.pending ? "bg-warn-faint" : ""}`}>
                  <span className="w-24 shrink-0 break-words">{l.room}</span>
                  <span className="min-w-0 break-words">
                    {l.teacher1 ?? <span className="text-muted">—</span>}
                    {l.teacher2 && <span className="block text-sm text-muted">ครูผู้สอน 2: {l.teacher2}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </>
  );
}

// ---- แบบครูผู้สอน ----

function OtherLine(props: { block: TeacherBlock }) {
  return (
    <>สอนกลุ่มอื่น {formatNumber(props.block.otherTotal)} คาบ · รวมทั้งหมด {formatNumber(props.block.total)} คาบ</>
  );
}

function TeacherSheetView(props: { blocks: TeacherBlock[] }) {
  return (
    <>
      {/* จอกลาง (768–1279) ตารางกว้างกว่ากรอบได้ — เลื่อนในกรอบตัวเอง ไม่ดันทั้งหน้า · กระดาษไม่ตัด */}
      <div className="mt-4 hidden overflow-x-auto md:block print:block print:overflow-visible">
        <table className="sheet-table w-full min-w-[880px] border-collapse text-[15px] print:min-w-0 print:text-[8.5pt]" data-testid="sheet-table">
          <Cols widths={TEACHER_COLS} />
          <thead>
            <tr className="border-b-2 border-line text-left text-sm text-muted print:text-[8.5pt] print:text-ink">
              <th className={`${TH} text-right`}>ลำดับที่</th>
              <th className={TH}>ครูผู้สอน</th>
              <th className={TH}>รหัสวิชา</th>
              <th className={TH}>ชื่อวิชา</th>
              <th className={`${TH} text-right`}>นก.</th>
              <th className={TH}>ประเภทวิชา</th>
              <th className={TH}>ห้องที่สอน</th>
              <th className={`${TH} text-right`}>คาบ/สัปดาห์</th>
              <th className={`${TH} text-right`}>จำนวนคาบ</th>
              <th className={`${TH} text-right`}>รวมคาบสอน</th>
            </tr>
          </thead>
          {props.blocks.map((b) => {
            const lines = b.subjects.reduce((n, s) => n + s.lines.length, 0) + (b.otherTotal > 0 ? 1 : 0);
            let row = 0;
            return (
              <tbody key={b.teacherId} className={`border-t border-line ${lines <= KEEP_LINES ? "keep" : ""}`} data-testid="block"
                data-teacher={b.teacherId}>
                {b.subjects.map((s, si) =>
                  s.lines.map((l, li) => {
                    const first = row++ === 0;
                    const head = li === 0;
                    return (
                      <tr key={`${si}-${li}`}
                        className={`${!first ? (head ? "border-t border-line2" : "") : ""} ${l.pending ? "sheet-pending bg-warn-faint" : ""} ${first ? "font-semibold" : ""}`}>
                        <td className={`${TD} text-right tabular-nums`}>{first ? b.no : ""}</td>
                        <td className={TD}>{first ? b.name : ""}</td>
                        <td className={`${TD} ${head ? "sheet-code" : ""}`}>{head ? s.code : ""}</td>
                        <td className={TD}>
                          {head && (
                            <>
                              {s.name}
                              {s.setText && <span className="block text-xs font-normal text-muted print:text-[7.5pt]">{s.setText}</span>}
                            </>
                          )}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{head ? num(s.credits) : ""}</td>
                        <td className={TD}>{head ? s.kindLabel : ""}</td>
                        <td className={TD}>{l.room}</td>
                        <td className={`${TD} text-right tabular-nums`}>{formatNumber(l.weekly)}</td>
                        <td className={`${TD} text-right tabular-nums`}>{head ? formatNumber(s.periods) : ""}</td>
                        <td className={`${TD} text-right tabular-nums`} data-testid={first ? "own-total" : undefined}>
                          {first ? formatNumber(b.ownTotal) : ""}
                        </td>
                      </tr>
                    );
                  }),
                )}
                {b.otherTotal > 0 && (
                  <tr className="text-sm text-muted print:text-[8.5pt]">
                    <td className={TD} />
                    <td className={`${TD} text-right`} colSpan={9} data-testid="other-line"><OtherLine block={b} /></td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>

      <ol className="mt-4 space-y-3 md:hidden print:hidden" data-testid="sheet-cards">
        {props.blocks.map((b) => (
          <li key={b.teacherId} className="rounded-xl border border-line p-3" data-testid="card" data-teacher={b.teacherId}>
            <div className="flex items-baseline justify-between gap-3 font-semibold">
              <span className="min-w-0 break-words"><span className="tabular-nums text-muted">{b.no}.</span> {b.name}</span>
              <span className="shrink-0 tabular-nums">{formatNumber(b.ownTotal)} คาบ</span>
            </div>
            <ul className="mt-2 divide-y divide-line2 text-[15px]">
              {b.subjects.map((s, si) => (
                <li key={si} className={`px-1 py-1.5 ${s.lines.some((l) => l.pending) ? "bg-warn-faint" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words">
                      <span className="sheet-code rounded px-1 font-medium">{s.code}</span> {s.name}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatNumber(s.periods)} คาบ</span>
                  </div>
                  <p className="text-sm text-muted">
                    {s.kindLabel} · {num(s.credits)} นก. · {s.lines.map((l) => l.room).join(" ")} · {formatNumber(s.lines[0].weekly)} คาบ/สัปดาห์
                  </p>
                  {s.setText && <p className="text-sm text-muted">{s.setText}</p>}
                </li>
              ))}
            </ul>
            {b.otherTotal > 0 && <p className="mt-1 text-sm text-muted"><OtherLine block={b} /></p>}
          </li>
        ))}
      </ol>
    </>
  );
}
