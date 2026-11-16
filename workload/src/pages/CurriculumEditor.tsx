import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  applyCode, buildCurriculumBody, buildLineBody, buildOptionBody, buildSetBody, curriculumChanges, KIND_TEXT,
  lineChanges, optionChanges, roomsByLevel, seedSummary, SET_KIND_TEXT, setChanges, subjectsWithCode, takenRooms,
  termLabel,
  type Curriculum, type CurriculumForm as CurriculumFormValue, type CurriculumLine, type CurriculumTerm,
  type LineForm, type LineKind, type OptionForm, type RefItem, type SeedResult, type SetForm as SetFormValue,
  type SetKind, type Term, type TermCurricula, type TermSet, type TermSetOption,
} from "../curriculum";
import {
  createCurriculum, createLine, createOption, createTermSet, deleteCurriculum, deleteLine, deleteOption,
  deleteTermSet, seedCurricula, updateCurriculum, updateLine, updateOption, updateTermSet,
} from "../curriculumApi";
import type { Department, WlSubject } from "../types";
import { Button, Card, Notice } from "../ui";
import { CheckField, DepartmentSelect, Field, inputClass, RowError } from "./registryParts";

// ส่วนแก้หลักสูตรของผู้ดูแลระบบ — หน้าหลักสูตร (CurriculumPage) วางชิ้นเหล่านี้เฉพาะเมื่อเป็น admin และภาคเรียนยังไม่ปิด
// เซิร์ฟเวอร์บังคับสิทธิ์ของทุก route อยู่แล้ว (หัวหน้า 403 · ภาคเรียนที่ปิดแล้ว 409) ตรงนี้แค่ไม่โชว์ปุ่มที่กดไม่ได้

/** งานเขียนหนึ่งครั้ง: op(false) ก่อน · 409 ที่ต้องยืนยันซ้ำ → กล่องยืนยัน → op(true) · สำเร็จแล้วหน้าโหลดข้อมูลใหม่เอง
 *  คืน true เมื่อเขียนสำเร็จ (ผู้เรียกปิดฟอร์มได้) · ข้อผิดพลาดส่งให้ onError วางใกล้ช่องที่เกี่ยว */
export type Write = (op: (force: boolean) => Promise<unknown>, onError: (message: string) => void) => Promise<boolean>;

export type Kit = {
  term: Term;
  view: TermCurricula;
  /** ภาคเรียนที่มีหลักสูตรแล้ว (ต้นทางของการคัดลอก) */
  terms: CurriculumTerm[];
  write: Write;
  busy: boolean;
  subjects: WlSubject[];
  departments: Department[];
  groups: RefItem[];
};

const LEVELS = ["ม.1", "ม.2", "ม.3", "ม.4", "ม.5", "ม.6"];
const KINDS = Object.keys(KIND_TEXT) as LineKind[];
const SET_KINDS = Object.keys(SET_KIND_TEXT) as SetKind[];

// ---- กล่องยืนยันลบซ้ำ (409 เพราะมีครูใส่ไว้แล้วในรอบที่ยังไม่ปิด) ----

export function ForceConfirm(props: { message: string; onYes: () => void; onNo: () => void }) {
  const id = useId();
  // Esc = ยกเลิก (ทางที่ปลอดภัย) · ref เพื่อไม่ต้องผูก listener ใหม่ทุกครั้งที่หน้าวาดใหม่
  const onNo = useRef(props.onNo);
  onNo.current = props.onNo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onNo.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        className="w-full max-w-lg rounded-card border border-line bg-surface p-5 shadow-card"
        data-testid="force-confirm"
      >
        <h3 id={`${id}-t`} className="text-lg font-semibold">มีครูใส่ไว้แล้ว จะลบด้วยหรือไม่</h3>
        <p id={`${id}-d`} className="mt-2">{props.message}</p>
        <p className="mt-2 text-sm text-muted">
          ถ้ายืนยัน ครูที่ใส่ไว้ในแถวเหล่านั้นจะหายไปจากรอบด้วย และบันทึกการแก้จะเขียนจำนวนไว้ · ถ้าไม่แน่ใจ ให้ยกเลิกแล้วสอบถามหัวหน้ากลุ่มสาระก่อน
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {/* โฟกัสเริ่มที่ปุ่มยกเลิก — กด Enter ต่อจากปุ่มลบเดิมโดยไม่ได้อ่าน ต้องไม่ลบงานของคนอื่น */}
          <Button autoFocus onClick={props.onNo}>ยกเลิก ไม่ลบ</Button>
          <Button variant="danger" onClick={props.onYes}>ลบพร้อมครูที่ใส่ไว้</Button>
        </div>
      </div>
    </div>
  );
}

// ---- ตั้งต้นหลักสูตรของภาคเรียนที่ยังว่าง ----

export function SeedCard(props: { kit: Kit; onSeeded: (r: SeedResult) => void; onBlank: () => void }) {
  const { kit } = props;
  const id = useId();
  const label = termLabel(kit.term.year, kit.term.semester);
  const sources = kit.terms.filter((t) => !(t.year === kit.term.year && t.semester === kit.term.semester));
  const [from, setFrom] = useState(sources[0] ? `${sources[0].year}-${sources[0].semester}` : "");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<"timetable" | "copy" | null>(null);
  const picked = sources.find((t) => `${t.year}-${t.semester}` === from) ?? sources[0];

  const seed = async (source: "timetable" | "copy") => {
    setError(null);
    setRunning(source);
    await kit.write(async () => {
      const base = { year: kit.term.year, semester: kit.term.semester };
      props.onSeeded(
        await seedCurricula(
          source === "copy" && picked
            ? { ...base, source, from_year: picked.year, from_semester: picked.semester }
            : { ...base, source: "timetable" },
        ),
      );
    }, setError);
    setRunning(null);
  };

  return (
    <Card as="section" aria-label="ตั้งต้นหลักสูตร">
      <h3 className="text-lg font-semibold">ตั้งต้นหลักสูตรของภาคเรียน {label}</h3>
      <p className="mt-1 text-muted">
        ภาคเรียนนี้ยังไม่มีหลักสูตร เลือกวิธีเริ่ม — ไม่ต้องพิมพ์จากศูนย์ ตั้งต้นแล้วแก้ได้ทุกอย่าง และทุกการแก้ลงบันทึกให้ตรวจย้อนได้
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
          <p className="font-semibold">จากโปรแกรมจัดตาราง</p>
          <p className="text-sm text-muted">
            แปลงแผนการสอนและคาบเสรีของโปรแกรมจัดตารางเป็นหลักสูตร — ห้องที่เรียนวิชาเหมือนกันรวมเป็นหลักสูตรเดียว
            · ดึงครูและวิชาที่ยังไม่มีเข้าทะเบียนให้ด้วย
          </p>
          <div className="mt-auto pt-1">
            <Button variant="primary" onClick={() => void seed("timetable")} disabled={kit.busy}>
              ตั้งต้นจากโปรแกรมจัดตาราง
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
          <p className="font-semibold">คัดลอกจากภาคเรียน…</p>
          <p className="text-sm text-muted">คัดลอกหลักสูตร ห้อง และชุดคาบเสรี/กิจกรรมทั้งหมดของภาคเรียนที่เลือก แล้วแก้เฉพาะส่วนที่ต่าง</p>
          {sources.length > 0 ? (
            <div className="mt-auto flex flex-wrap items-end gap-2 pt-1">
              <Field label="ภาคเรียนต้นทาง" htmlFor={`${id}-from`}>
                <select id={`${id}-from`} value={from} onChange={(e) => setFrom(e.target.value)} disabled={kit.busy} className={inputClass}>
                  {sources.map((t) => (
                    <option key={`${t.year}-${t.semester}`} value={`${t.year}-${t.semester}`}>
                      {t.label}
                      {t.locked ? " (ปิดแล้ว)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Button onClick={() => void seed("copy")} disabled={kit.busy}>คัดลอกหลักสูตร</Button>
            </div>
          ) : (
            <p className="mt-auto text-sm text-muted">ยังไม่มีภาคเรียนอื่นที่มีหลักสูตรให้คัดลอก</p>
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
          <p className="font-semibold">เริ่มว่าง</p>
          <p className="text-sm text-muted">สร้างหลักสูตรทีละชุดเอง เหมาะกับภาคเรียนที่หลักสูตรเปลี่ยนไปมาก</p>
          <div className="mt-auto pt-1">
            <Button onClick={props.onBlank} disabled={kit.busy}>เริ่มว่าง</Button>
          </div>
        </div>
      </div>
      {running && (
        <p role="status" className="mt-3 text-muted">
          {running === "timetable" ? "กำลังตั้งต้นจากโปรแกรมจัดตาราง... (ราวไม่กี่วินาที)" : "กำลังคัดลอกหลักสูตร..."}
        </p>
      )}
      {error && <Notice tone="bad" role="alert" className="mt-3">{error}</Notice>}
    </Card>
  );
}

/** กล่องสรุปหลังตั้งต้น — รายการแปลงไม่ได้มาครั้งเดียว (เซิร์ฟเวอร์ไม่ได้เก็บ) จึงอยู่จนกดปิด */
export function SeedSummary(props: { result: SeedResult; onClose: () => void }) {
  const r = props.result;
  const how = r.source === "copy" ? "คัดลอก" : "ตั้งต้นจากโปรแกรมจัดตาราง";
  return (
    <Card as="section" aria-label="สรุปการตั้งต้นหลักสูตร" className="mb-5" data-testid="seed-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ok">{how}หลักสูตรภาคเรียน {r.label} แล้ว</p>
          <ul className="mt-1 text-[15px]">
            {seedSummary(r).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <Button size="sm" onClick={props.onClose}>ปิด</Button>
      </div>
      {r.unconverted.length > 0 ? (
        <Notice tone="warn" className="mt-3" data-testid="seed-unconverted">
          <p className="font-semibold">แปลงไม่ได้ {r.unconverted.length.toLocaleString("th-TH")} รายการ — ไม่ได้อยู่ในหลักสูตร</p>
          <p className="text-sm">รายการนี้ขึ้นครั้งเดียว ให้จดไว้แล้วเพิ่มเองในหลักสูตรหรือชุดที่เกี่ยวข้อง (ปิดกล่องนี้แล้วดูย้อนไม่ได้)</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[15px]">
            {r.unconverted.map((u, i) => (
              <li key={i}>{u.reason}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        r.source === "timetable" && <p className="mt-2 text-sm text-muted">ไม่มีรายการที่แปลงไม่ได้</p>
      )}
    </Card>
  );
}

// ---- ช่องติ๊กห้องเรียน ----

function RoomPicker(props: {
  groups: RefItem[];
  value: number[];
  onChange: (ids: number[]) => void;
  /** ห้อง → ชื่อหลักสูตรอื่นที่ใช้ห้องนั้นอยู่ (ติ๊กไม่ได้) · ชุดคาบเสรีไม่ส่ง (ห้องหนึ่งอยู่หลายชุดได้) */
  taken?: Map<number, string>;
  /** ชื่อของห้องที่เลือกไว้แต่ไม่มีในรายการแล้ว (ห้องที่ไม่มีแล้วในโปรแกรมจัดตาราง) */
  missingNames: Map<number, string>;
  disabled: boolean;
}) {
  const known = new Set(props.groups.map((g) => g.id));
  const missing = props.value.filter((g) => !known.has(g));
  const toggle = (gid: number, on: boolean) =>
    props.onChange(on ? [...props.value, gid] : props.value.filter((g) => g !== gid));

  const box = (g: RefItem) => {
    const where = props.taken?.get(g.id);
    const checked = props.value.includes(g.id);
    return (
      <label key={g.id} className={`flex items-start gap-2 rounded-lg px-2 py-1 ${where && !checked ? "text-muted" : "hover:bg-bg"}`}>
        <input
          type="checkbox"
          className="mt-1 shrink-0"
          checked={checked}
          disabled={props.disabled || (where !== undefined && !checked)}
          onChange={(e) => toggle(g.id, e.target.checked)}
        />
        <span className="min-w-0 leading-snug">
          {g.name}
          {/* เว้นวรรคให้ชื่อของช่องติ๊กอ่านเป็น "ม.1/1 อยู่ใน …" สำหรับโปรแกรมอ่านหน้าจอ */}
          {where !== undefined && !checked && <span className="block text-xs"> อยู่ใน {where}</span>}
        </span>
      </label>
    );
  };

  return (
    <div className="space-y-3">
      {roomsByLevel(props.groups).map((lv) => (
        <div key={lv.level ?? "-"}>
          <p className="mb-1 text-sm font-semibold text-muted">{lv.level ?? "ห้องอื่น ๆ"}</p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 sm:grid-cols-4 lg:grid-cols-6">{lv.groups.map(box)}</div>
        </div>
      ))}
      {missing.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold text-muted">ห้องที่ไม่มีในโปรแกรมจัดตารางแล้ว — เอาออกได้</p>
          <div className="grid grid-cols-2 gap-x-2 sm:grid-cols-4">
            {missing.map((gid) => box({ id: gid, name: props.missingNames.get(gid) ?? `ห้องที่ไม่มีแล้ว (รหัส ${gid})` }))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- หลักสูตร: เพิ่ม/แก้/ลบ ----

/** ฟอร์มหลักสูตร: initial = แก้ · ไม่ส่ง = เพิ่ม (สำเร็จแล้วส่ง id ของหลักสูตรใหม่ให้หน้าเปิดดู) */
export function CurriculumForm(props: {
  kit: Kit;
  initial?: Curriculum;
  onDone: (createdId: number | null) => void;
  onCancel: () => void;
}) {
  const { kit, initial } = props;
  const id = useId();
  const [form, setForm] = useState<CurriculumFormValue>(() => ({
    name: initial?.name ?? "",
    level: initial?.level ?? "",
    note: initial?.note ?? "",
    group_ids: initial ? [...initial.group_ids] : [],
  }));
  const [error, setError] = useState<string | null>(null);
  const taken = takenRooms(kit.view.curricula, initial?.id ?? null);
  const missingNames = new Map((initial?.group_ids ?? []).map((g, i) => [g, initial!.group_names[i]] as const));
  const levels = form.level && !LEVELS.includes(form.level) ? [...LEVELS, form.level] : LEVELS;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (kit.busy) return;
    setError(null);
    const built = buildCurriculumBody(form);
    if (!built.ok) return setError(built.error);
    if (initial) {
      const changes = curriculumChanges(initial, built.body);
      if (Object.keys(changes).length === 0) return props.onCancel();
      if (await kit.write((force) => updateCurriculum(initial.id, changes, force), setError)) props.onDone(null);
      return;
    }
    let created: number | null = null;
    const { level, ...rest } = built.body;
    const ok = await kit.write(async () => {
      // ไม่ได้เลือกระดับ = ไม่ส่ง level ให้เซิร์ฟเวอร์เดาจากห้อง (ส่ง null คือบอกว่า "ไม่มีระดับ")
      const c = await createCurriculum({ year: kit.term.year, semester: kit.term.semester, ...rest, ...(level ? { level } : {}) });
      created = c.id;
    }, setError);
    if (ok) props.onDone(created);
  };

  return (
    <form onSubmit={submit} aria-label={initial ? `แก้หลักสูตร ${initial.name}` : "เพิ่มหลักสูตร"} className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="ชื่อหลักสูตร" htmlFor={`${id}-name`}>
          <input id={`${id}-name`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="เช่น ม.4 วิทย์-คณิต" disabled={kit.busy} className={`${inputClass} w-72`} />
        </Field>
        <Field label="ระดับชั้น" htmlFor={`${id}-level`}>
          <select id={`${id}-level`} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}
            disabled={kit.busy} className={inputClass}>
            <option value="">(ตามห้องที่เลือก)</option>
            {levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="หมายเหตุ" htmlFor={`${id}-note`}>
          <input id={`${id}-note`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="ไม่บังคับ" disabled={kit.busy} className={`${inputClass} w-72`} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm text-muted">
          ห้องเรียนที่ใช้หลักสูตรนี้ (เลือกแล้ว {form.group_ids.length} ห้อง) — ห้องหนึ่งอยู่ได้หลักสูตรเดียวต่อภาคเรียน
        </legend>
        <RoomPicker groups={kit.groups} value={form.group_ids} onChange={(group_ids) => setForm({ ...form, group_ids })}
          taken={taken} missingNames={missingNames} disabled={kit.busy} />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={kit.busy}>{initial ? "บันทึกหลักสูตร" : "เพิ่มหลักสูตร"}</Button>
        <Button onClick={props.onCancel} disabled={kit.busy}>ยกเลิก</Button>
      </div>
      <RowError message={error} />
    </form>
  );
}

/** ปุ่มแก้/ลบของหลักสูตรที่เปิดอยู่ + ฟอร์มแก้ใต้ปุ่ม */
export function CurriculumActions(props: { kit: Kit; curriculum: Curriculum; onDeleted: () => void }) {
  const { kit, curriculum: c } = props;
  const [mode, setMode] = useState<"idle" | "edit" | "delete">("idle");
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setError(null);
    if (await kit.write((force) => deleteCurriculum(c.id, force), setError)) props.onDeleted();
    else setMode("idle");
  };

  return (
    <div className="w-full">
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("edit")} disabled={kit.busy}>แก้หลักสูตร</Button>
          <Button size="sm" onClick={() => { setError(null); setMode("delete"); }} disabled={kit.busy}>ลบหลักสูตร</Button>
        </div>
      )}
      {mode === "delete" && (
        <div className="rounded-xl border border-line bg-bg px-4 py-3">
          <p className="font-medium">ลบหลักสูตร {c.name} พร้อม {c.lines.length} บรรทัด?</p>
          <p className="text-sm text-muted">ห้องที่ใช้หลักสูตรนี้จะไม่มีหลักสูตร (เพิ่มเข้าหลักสูตรอื่นได้) · การลบลงบันทึกการแก้</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void remove()} disabled={kit.busy}>ยืนยันลบหลักสูตร</Button>
            <Button onClick={() => setMode("idle")} disabled={kit.busy}>ไม่ลบ</Button>
          </div>
        </div>
      )}
      {mode === "edit" && (
        <div className="rounded-xl border border-line bg-bg p-4">
          <CurriculumForm kit={kit} initial={c} onDone={() => setMode("idle")} onCancel={() => setMode("idle")} />
        </div>
      )}
      <RowError message={error} />
    </div>
  );
}

// ---- บรรทัดวิชา ----

function CodeHint(props: { code: string; subjects: WlSubject[] }) {
  if (props.code.trim() === "") return null;
  const hits = subjectsWithCode(props.code, props.subjects);
  if (hits.length === 1) return <p className="w-full text-sm text-ok">ตรงกับทะเบียนวิชา: {hits[0].name}</p>;
  if (hits.length > 1) {
    return <p className="w-full text-sm text-warn">รหัสนี้มีในทะเบียนวิชา {hits.length} วิชา — แก้รหัสในทะเบียนวิชาให้ไม่ซ้ำก่อน</p>;
  }
  return <p className="w-full text-sm text-muted">ไม่มีในทะเบียนวิชา — กรอกชื่อวิชาเอง</p>;
}

function LineFields(props: {
  value: LineForm;
  onChange: (v: LineForm) => void;
  subjects: WlSubject[];
  departments: Department[];
  disabled: boolean;
  /** ฟอร์มเพิ่มมีตัวเลือก "ตามรหัสวิชา" (ให้เซิร์ฟเวอร์เดาประเภท) */
  autoKind: boolean;
}) {
  const id = useId();
  const v = props.value;
  const set = (p: Partial<LineForm>) => props.onChange({ ...v, ...p });
  return (
    <>
      <Field label="รหัสวิชา" htmlFor={`${id}-code`}>
        <input id={`${id}-code`} value={v.code} onChange={(e) => props.onChange(applyCode(v, e.target.value, props.subjects))}
          placeholder="เช่น ท21102" disabled={props.disabled} className={`${inputClass} w-32`} />
      </Field>
      <Field label="ชื่อวิชา" htmlFor={`${id}-name`}>
        <input id={`${id}-name`} value={v.name} onChange={(e) => set({ name: e.target.value })}
          placeholder="เติมจากทะเบียนเมื่อพิมพ์รหัส" disabled={props.disabled} className={`${inputClass} w-64`} />
      </Field>
      <Field label="หน่วยกิต" htmlFor={`${id}-credits`}>
        <input id={`${id}-credits`} value={v.credits} onChange={(e) => set({ credits: e.target.value })}
          placeholder="ว่างได้" inputMode="decimal" disabled={props.disabled} className={`${inputClass} w-24`} />
      </Field>
      <Field label="คาบ/สัปดาห์" htmlFor={`${id}-weekly`}>
        <input id={`${id}-weekly`} value={v.weekly} onChange={(e) => set({ weekly: e.target.value })}
          inputMode="numeric" disabled={props.disabled} className={`${inputClass} w-24`} />
      </Field>
      <Field label="ประเภท" htmlFor={`${id}-kind`}>
        <select id={`${id}-kind`} value={v.kind} onChange={(e) => set({ kind: e.target.value as LineKind | "" })}
          disabled={props.disabled} className={inputClass}>
          {props.autoKind && <option value="">(ตามรหัสวิชา)</option>}
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_TEXT[k]}</option>
          ))}
        </select>
      </Field>
      <Field label="กลุ่มสาระ" htmlFor={`${id}-dept`}>
        <DepartmentSelect id={`${id}-dept`} value={v.department_id} onChange={(d) => set({ department_id: d })}
          departments={props.departments} disabled={props.disabled} />
      </Field>
      <CodeHint code={v.code} subjects={props.subjects} />
    </>
  );
}

const EMPTY_LINE: LineForm = { code: "", name: "", credits: "", weekly: "", kind: "", department_id: null };

export function AddLineForm(props: { kit: Kit; curriculumId: number }) {
  const { kit } = props;
  const [form, setForm] = useState<LineForm>(EMPTY_LINE);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (kit.busy) return;
    setError(null);
    const built = buildLineBody(form);
    if (!built.ok) return setError(built.error);
    if (await kit.write(() => createLine({ ...built.body, curriculum_id: props.curriculumId }), setError)) {
      setForm(EMPTY_LINE);
      // เพิ่มทีละหลายบรรทัด: กลับไปที่ช่องรหัสให้พิมพ์บรรทัดถัดไปได้เลย
      formRef.current?.querySelector("input")?.focus();
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} aria-label="เพิ่มบรรทัดวิชา" className="flex flex-wrap items-end gap-3">
      <LineFields value={form} onChange={setForm} subjects={kit.subjects} departments={kit.departments} disabled={kit.busy} autoKind />
      <Button type="submit" variant="primary" disabled={kit.busy}>เพิ่มบรรทัด</Button>
      <RowError message={error} />
    </form>
  );
}

function lineForm(ln: CurriculumLine): LineForm {
  return {
    code: ln.code, name: ln.name, credits: ln.credits === null ? "" : String(ln.credits), weekly: String(ln.weekly),
    kind: ln.kind, department_id: ln.department_id,
  };
}

/** บรรทัดหนึ่งในโหมดแก้ได้: view(actions) วาดแถวอ่านอย่างเดียวของหน้า แล้วใส่ปุ่มของ admin ไว้ท้ายแถว */
export function LineEditorRow(props: { kit: Kit; line: CurriculumLine; view: (actions: ReactNode) => ReactNode }) {
  const { kit, line } = props;
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [form, setForm] = useState<LineForm>(() => lineForm(line));
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (kit.busy) return;
    setError(null);
    const built = buildLineBody(form);
    if (!built.ok) return setError(built.error);
    const changes = lineChanges(line, built.body);
    if (Object.keys(changes).length === 0) return setMode("view");
    if (await kit.write((force) => updateLine(line.id, changes, force), setError)) setMode("view");
  };

  const remove = async () => {
    setError(null);
    // ยกเลิกในกล่องยืนยัน = ไม่ลบ → กลับเป็นแถวปกติ (ข้อผิดพลาดยังขึ้นที่แถว)
    await kit.write((force) => deleteLine(line.id, force), setError);
    setMode("view");
  };

  if (mode === "edit") {
    return (
      <form onSubmit={save} aria-label={`แก้บรรทัด ${line.code}`} className="flex flex-wrap items-end gap-3 py-1">
        <LineFields value={form} onChange={setForm} subjects={kit.subjects} departments={kit.departments} disabled={kit.busy} autoKind={false} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={kit.busy}>บันทึก</Button>
          <Button onClick={() => { setError(null); setMode("view"); }} disabled={kit.busy}>ยกเลิก</Button>
        </div>
        <RowError message={error} />
      </form>
    );
  }

  const actions =
    mode === "delete" ? (
      <>
        <Button size="sm" variant="danger" onClick={() => void remove()} disabled={kit.busy}>ยืนยันลบ</Button>
        <Button size="sm" onClick={() => setMode("view")} disabled={kit.busy}>ไม่ลบ</Button>
      </>
    ) : (
      <>
        <Button size="sm" onClick={() => { setError(null); setForm(lineForm(line)); setMode("edit"); }} disabled={kit.busy}
          aria-label={`แก้บรรทัด ${line.code}`}>แก้</Button>
        <Button size="sm" onClick={() => { setError(null); setMode("delete"); }} disabled={kit.busy}
          aria-label={`ลบบรรทัด ${line.code}`}>ลบ</Button>
      </>
    );
  return (
    <>
      {props.view(actions)}
      <RowError message={error} />
    </>
  );
}

// ---- ชุดคาบเสรี/กิจกรรม ----

export function SetForm(props: { kit: Kit; initial?: TermSet; onDone: () => void; onCancel: () => void }) {
  const { kit, initial } = props;
  const id = useId();
  const [form, setForm] = useState<SetFormValue>(() => ({
    kind: initial?.kind ?? "elective",
    name: initial?.name ?? "",
    weekly: initial ? String(initial.weekly) : "",
    is_double: initial?.is_double ?? false,
    group_ids: initial ? [...initial.group_ids] : [],
  }));
  const [error, setError] = useState<string | null>(null);
  const missingNames = new Map((initial?.group_ids ?? []).map((g, i) => [g, initial!.group_names[i]] as const));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (kit.busy) return;
    setError(null);
    const built = buildSetBody(form);
    if (!built.ok) return setError(built.error);
    if (initial) {
      const changes = setChanges(initial, built.body);
      if (Object.keys(changes).length === 0) return props.onCancel();
      if (await kit.write((force) => updateTermSet(initial.id, changes, force), setError)) props.onDone();
      return;
    }
    const body = { ...built.body, year: kit.term.year, semester: kit.term.semester };
    if (await kit.write(() => createTermSet(body), setError)) props.onDone();
  };

  return (
    <form onSubmit={submit} aria-label={initial ? `แก้ชุด ${initial.name}` : "เพิ่มชุดคาบเสรี/กิจกรรม"} className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="ประเภทชุด" htmlFor={`${id}-kind`}>
          <select id={`${id}-kind`} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SetKind })}
            disabled={kit.busy} className={inputClass}>
            {SET_KINDS.map((k) => (
              <option key={k} value={k}>{SET_KIND_TEXT[k]}</option>
            ))}
          </select>
        </Field>
        <Field label="ชื่อชุด" htmlFor={`${id}-name`}>
          <input id={`${id}-name`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="เช่น วิชาเสรี ม.4" disabled={kit.busy} className={`${inputClass} w-72`} />
        </Field>
        <Field label="คาบ/สัปดาห์" htmlFor={`${id}-weekly`}>
          <input id={`${id}-weekly`} value={form.weekly} onChange={(e) => setForm({ ...form, weekly: e.target.value })}
            inputMode="numeric" disabled={kit.busy} className={`${inputClass} w-24`} />
        </Field>
        <CheckField id={`${id}-double`} label="คาบคู่" checked={form.is_double} disabled={kit.busy}
          onChange={(is_double) => setForm({ ...form, is_double })} />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm text-muted">
          ห้องเรียนที่เรียนชุดนี้ (เลือกแล้ว {form.group_ids.length} ห้อง) — ห้องหนึ่งอยู่ได้หลายชุด
        </legend>
        <RoomPicker groups={kit.groups} value={form.group_ids} onChange={(group_ids) => setForm({ ...form, group_ids })}
          missingNames={missingNames} disabled={kit.busy} />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={kit.busy}>{initial ? "บันทึกชุด" : "เพิ่มชุด"}</Button>
        <Button onClick={props.onCancel} disabled={kit.busy}>ยกเลิก</Button>
      </div>
      <RowError message={error} />
    </form>
  );
}

export function SetActions(props: { kit: Kit; set: TermSet }) {
  const { kit, set: s } = props;
  const [mode, setMode] = useState<"idle" | "edit" | "delete">("idle");
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setError(null);
    await kit.write((force) => deleteTermSet(s.id, force), setError);
    setMode("idle");
  };

  return (
    <div className="w-full">
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("edit")} disabled={kit.busy} aria-label={`แก้ชุด ${s.name}`}>แก้ชุด</Button>
          <Button size="sm" onClick={() => { setError(null); setMode("delete"); }} disabled={kit.busy} aria-label={`ลบชุด ${s.name}`}>
            ลบชุด
          </Button>
        </div>
      )}
      {mode === "delete" && (
        <div className="rounded-xl border border-line bg-bg px-4 py-3">
          <p className="font-medium">ลบ{SET_KIND_TEXT[s.kind]} {s.name} พร้อม {s.options.length} ตัวเลือก?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void remove()} disabled={kit.busy}>ยืนยันลบชุด</Button>
            <Button onClick={() => setMode("idle")} disabled={kit.busy}>ไม่ลบ</Button>
          </div>
        </div>
      )}
      {mode === "edit" && (
        <div className="rounded-xl border border-line bg-bg p-4">
          <SetForm kit={kit} initial={s} onDone={() => setMode("idle")} onCancel={() => setMode("idle")} />
        </div>
      )}
      <RowError message={error} />
    </div>
  );
}

function OptionFields(props: {
  value: OptionForm;
  onChange: (v: OptionForm) => void;
  subjects: WlSubject[];
  departments: Department[];
  disabled: boolean;
}) {
  const id = useId();
  const v = props.value;
  return (
    <>
      <Field label="รหัสวิชา" htmlFor={`${id}-code`}>
        <input id={`${id}-code`} value={v.code} onChange={(e) => props.onChange(applyCode(v, e.target.value, props.subjects))}
          placeholder="เช่น ง30201" disabled={props.disabled} className={`${inputClass} w-32`} />
      </Field>
      <Field label="ชื่อวิชา" htmlFor={`${id}-name`}>
        <input id={`${id}-name`} value={v.name} onChange={(e) => props.onChange({ ...v, name: e.target.value })}
          placeholder="เติมจากทะเบียนเมื่อพิมพ์รหัส" disabled={props.disabled} className={`${inputClass} w-64`} />
      </Field>
      <Field label="กลุ่มสาระ" htmlFor={`${id}-dept`}>
        <DepartmentSelect id={`${id}-dept`} value={v.department_id} onChange={(d) => props.onChange({ ...v, department_id: d })}
          departments={props.departments} disabled={props.disabled} />
      </Field>
      <CodeHint code={v.code} subjects={props.subjects} />
    </>
  );
}

const EMPTY_OPTION: OptionForm = { code: "", name: "", department_id: null };

export function AddOptionForm(props: { kit: Kit; setId: number }) {
  const { kit } = props;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<OptionForm>(EMPTY_OPTION);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (kit.busy) return;
    setError(null);
    const built = buildOptionBody(form);
    if (!built.ok) return setError(built.error);
    if (await kit.write(() => createOption({ ...built.body, set_id: props.setId }), setError)) setForm(EMPTY_OPTION);
  };

  if (!open) {
    return <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={kit.busy}>+ เพิ่มตัวเลือกวิชา</Button>;
  }
  return (
    <form onSubmit={submit} aria-label="เพิ่มตัวเลือกวิชา" className="flex flex-wrap items-end gap-3">
      <OptionFields value={form} onChange={setForm} subjects={kit.subjects} departments={kit.departments} disabled={kit.busy} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={kit.busy}>เพิ่มตัวเลือก</Button>
        <Button onClick={() => { setError(null); setOpen(false); }} disabled={kit.busy}>ปิด</Button>
      </div>
      <RowError message={error} />
    </form>
  );
}

function optionForm(o: TermSetOption): OptionForm {
  return { code: o.code, name: o.name, department_id: o.department_id };
}

export function OptionEditorRow(props: { kit: Kit; option: TermSetOption; view: (actions: ReactNode) => ReactNode }) {
  const { kit, option } = props;
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [form, setForm] = useState<OptionForm>(() => optionForm(option));
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (kit.busy) return;
    setError(null);
    const built = buildOptionBody(form);
    if (!built.ok) return setError(built.error);
    const changes = optionChanges(option, built.body);
    if (Object.keys(changes).length === 0) return setMode("view");
    if (await kit.write(() => updateOption(option.id, changes), setError)) setMode("view");
  };

  const remove = async () => {
    setError(null);
    await kit.write((force) => deleteOption(option.id, force), setError);
    setMode("view");
  };

  if (mode === "edit") {
    return (
      <form onSubmit={save} aria-label={`แก้ตัวเลือก ${option.code}`} className="flex flex-wrap items-end gap-3 py-1">
        <OptionFields value={form} onChange={setForm} subjects={kit.subjects} departments={kit.departments} disabled={kit.busy} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={kit.busy}>บันทึก</Button>
          <Button onClick={() => { setError(null); setMode("view"); }} disabled={kit.busy}>ยกเลิก</Button>
        </div>
        <RowError message={error} />
      </form>
    );
  }
  const actions =
    mode === "delete" ? (
      <>
        <Button size="sm" variant="danger" onClick={() => void remove()} disabled={kit.busy}>ยืนยันลบ</Button>
        <Button size="sm" onClick={() => setMode("view")} disabled={kit.busy}>ไม่ลบ</Button>
      </>
    ) : (
      <>
        <Button size="sm" onClick={() => { setError(null); setForm(optionForm(option)); setMode("edit"); }} disabled={kit.busy}
          aria-label={`แก้ตัวเลือก ${option.code}`}>แก้</Button>
        <Button size="sm" onClick={() => { setError(null); setMode("delete"); }} disabled={kit.busy}
          aria-label={`ลบตัวเลือก ${option.code}`}>ลบ</Button>
      </>
    );
  return (
    <>
      {props.view(actions)}
      <RowError message={error} />
    </>
  );
}
