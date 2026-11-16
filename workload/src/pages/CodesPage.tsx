import { useState, type FormEvent } from "react";
import { createCode, listCodes, listDepartments, updateCode } from "../api";
import { buildCodeRows, codeLengthError, type CodeRow } from "../codes";
import { useRegistryList, useSaving } from "../useRegistryList";
import { inputClass, RegistryFrame, RowError } from "./registryParts";
import { Button, Card, Chip, Notice, type Tone } from "../ui";

const STATUS_TEXT = { unset: "ยังไม่ได้ตั้ง", active: "ใช้งานอยู่", disabled: "ปิดอยู่" } as const;
// ยังไม่ได้ตั้ง = งานที่ admin ต้องทำต่อ (warn) · ปิดอยู่ = ตั้งใจปิด ไม่ใช่ข้อผิดพลาด จึงไม่ใช้แดง (แบบข้อ 6)
const STATUS_TONE: Record<keyof typeof STATUS_TEXT, Tone> = { unset: "warn", active: "ok", disabled: "mute" };

const KICK_WARNING = "คนที่ใช้รหัสเดิมอยู่จะถูกให้ออกจากระบบทันที";

// รหัสที่เพิ่งพิมพ์ — อยู่ใน state ของหน้านี้เท่านั้น หายเมื่อปิดกล่องหรือเปลี่ยนหน้า
type Revealed = { name: string; code: string; stillDisabled: boolean };

export default function CodesPage() {
  const codes = useRegistryList(listCodes);
  const depts = useRegistryList(listDepartments);
  const { saving, run } = useSaving();
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  const rows = buildCodeRows(depts.rows, codes.rows);
  const setCount = rows.filter((r) => r.status !== "unset").length;

  const act = (row: CodeRow, job: () => Promise<void>): Promise<boolean> => {
    setRowError(null);
    return run(
      async () => {
        await job();
        // PUT/POST ไม่ส่งแถวกลับมา จึงโหลดรายการใหม่ให้สถานะตรงกับเซิร์ฟเวอร์
        codes.reload();
      },
      (message) => setRowError({ key: row.key, message }),
    );
  };

  const setCode = async (row: CodeRow, code: string): Promise<boolean> => {
    const problem = codeLengthError(code);
    if (problem) {
      setRowError({ key: row.key, message: problem });
      return false;
    }
    // เซิร์ฟเวอร์เก็บรหัสแบบตัดช่องว่างหัวท้าย กล่องต้องแสดงตัวที่เก็บจริง ไม่งั้นคนจดรหัสพร้อมช่องว่างแล้วล็อกอินไม่ผ่าน
    code = code.trim();
    const ok = await act(row, async () => {
      if (row.codeId === null) {
        if (row.departmentId === null) throw new Error("no department"); // ปุ่มนี้ไม่ขึ้นกับแถวที่ไม่มีกลุ่ม
        await createCode({ department_id: row.departmentId, label: row.name, code });
      } else {
        await updateCode(row.codeId, { code });
      }
    });
    if (ok) setRevealed({ name: row.name, code, stillDisabled: row.status === "disabled" });
    return ok;
  };

  const setActive = (row: CodeRow, active: boolean) =>
    act(row, async () => {
      if (row.codeId !== null) await updateCode(row.codeId, { active });
    });

  return (
    <RegistryFrame
      title="รหัสเข้า"
      countTestId="code-count"
      countText={`ตั้งรหัสแล้ว ${setCount} จาก ${rows.length} รายการ`}
      loaded={codes.loaded && depts.loaded}
      loadError={codes.error ?? depts.error}
      saving={saving}
      onRetry={() => {
        codes.reload();
        depts.reload();
      }}
      top={revealed && <RevealBox revealed={revealed} onClose={() => setRevealed(null)} />}
    >
      <Notice tone="mute" className="mb-4 text-[15px]">
        ระบบไม่เก็บตัวรหัสไว้ให้ดูย้อนหลัง · ตั้งรหัสแล้วจะเห็นรหัสครั้งเดียว ต้องจดแล้วแจกให้หัวหน้ากลุ่มสาระทันที
      </Notice>
      <Card pad={false}>
        <ul className="divide-y divide-line2">
        {rows.map((r) => (
          <li key={r.key} className="px-4 py-3 sm:px-5">
            <CodeRowView
              row={r}
              disabled={saving}
              error={rowError?.key === r.key ? rowError.message : null}
              onClearError={() => setRowError(null)}
              onSetCode={(code) => setCode(r, code)}
              onSetActive={(active) => setActive(r, active)}
            />
          </li>
        ))}
        </ul>
      </Card>
    </RegistryFrame>
  );
}

function RevealBox(props: { revealed: Revealed; onClose: () => void }) {
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.revealed.code);
      setCopyNote("คัดลอกแล้ว");
    } catch {
      setCopyNote("คัดลอกให้ไม่ได้ ให้เลือกข้อความในกล่องแล้วคัดลอกเอง");
    }
  };
  return (
    // คู่มือข้อ 5 เรียกว่า "กล่องสีเขียว" — คงสีเขียวไว้ให้หาเจอตามคู่มือ
    <section aria-label="รหัสที่เพิ่งตั้ง" className="mb-4 rounded-card border-2 border-ok bg-ok-soft p-4 sm:p-5">
      <p className="font-semibold text-ok">ตั้งรหัสของ {props.revealed.name} แล้ว</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          aria-label="รหัสที่เพิ่งตั้ง"
          readOnly
          value={props.revealed.code}
          onFocus={(e) => e.currentTarget.select()}
          className="input h-11 font-mono text-lg tracking-wide max-sm:w-full"
        />
        <Button onClick={() => void copy()}>คัดลอก</Button>
        <Button variant="primary" onClick={props.onClose}>ปิดกล่องนี้</Button>
      </div>
      {copyNote && <p role="status" className="mt-2 text-sm text-ink">{copyNote}</p>}
      <p className="mt-3 font-medium text-warn">ปิดหน้านี้แล้วจะดูย้อนไม่ได้ ให้จดหรือคัดลอกไว้ก่อน</p>
      {props.revealed.stillDisabled && (
        <p className="mt-1 font-medium text-warn">รหัสนี้ยังปิดอยู่ ต้องกด "เปิด" ก่อนจึงจะใช้เข้าระบบได้</p>
      )}
    </section>
  );
}

function CodeRowView(props: {
  row: CodeRow;
  disabled: boolean;
  error: string | null;
  onClearError: () => void;
  onSetCode: (code: string) => Promise<boolean>;
  onSetActive: (active: boolean) => Promise<boolean>;
}) {
  const r = props.row;
  const [mode, setMode] = useState<"idle" | "set" | "confirmDisable">("idle");
  const [draft, setDraft] = useState("");

  const close = () => {
    setMode("idle");
    setDraft("");
    props.onClearError();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (props.disabled) return;
    const code = draft;
    setDraft(""); // ไม่เก็บรหัสที่พิมพ์ไว้หลังส่ง
    if (await props.onSetCode(code)) setMode("idle");
    else setDraft(code); // ส่งไม่ผ่าน (เช่นรหัสซ้ำ) ให้แก้ต่อได้โดยไม่ต้องพิมพ์ใหม่ทั้งหมด
  };

  const hasRow = r.codeId !== null;
  // แถว admin ที่ยังไม่มีรหัสตั้งจากหน้าล็อกอินเท่านั้น (เซิร์ฟเวอร์ถือรหัสตั้งค่าไว้)
  const canSet = r.kind === "admin" ? hasRow : r.kind === "head";
  const canToggle = hasRow && r.kind !== "admin";

  return (
    <div data-testid={`code-${r.key}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`font-medium ${r.status === "disabled" ? "text-muted" : ""}`}>{r.name}</span>
        <Chip tone={STATUS_TONE[r.status]} dot={r.status === "active"}>{STATUS_TEXT[r.status]}</Chip>
        <span className="ml-auto flex items-center gap-2">
          {mode === "idle" && canSet && (
            <Button size="sm" onClick={() => setMode("set")} disabled={props.disabled}>
              {hasRow ? "ตั้งรหัสใหม่" : "ตั้งรหัส"}
            </Button>
          )}
          {mode === "idle" && canToggle && r.status === "active" && (
            <Button size="sm" onClick={() => setMode("confirmDisable")} disabled={props.disabled}>
              ปิด
            </Button>
          )}
          {mode === "idle" && canToggle && r.status === "disabled" && (
            <Button size="sm" onClick={() => void props.onSetActive(true)} disabled={props.disabled}>
              เปิด
            </Button>
          )}
        </span>
      </div>

      {r.kind === "admin" && !hasRow && (
        <p className="mt-1 text-sm text-muted">ยังไม่มีรหัสผู้ดูแลระบบ ให้ตั้งจากหน้าล็อกอิน</p>
      )}

      {mode === "set" && (
        <form onSubmit={submit} aria-label={`ตั้งรหัส ${r.name}`} className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-bg p-3">
          <label className="flex flex-col gap-1 text-sm text-muted max-sm:w-full">
            รหัสใหม่ (อย่างน้อย 6 ตัวอักษร)
            <input
              type="password"
              autoComplete="new-password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={props.disabled}
              className={inputClass}
            />
          </label>
          <Button type="submit" variant="primary" disabled={props.disabled}>
            บันทึกรหัส
          </Button>
          <Button onClick={close} disabled={props.disabled}>
            ยกเลิก
          </Button>
          {r.status !== "unset" && <p className="w-full text-sm text-warn">{KICK_WARNING}</p>}
        </form>
      )}

      {mode === "confirmDisable" && (
        <Notice tone="warn" className="mt-3 flex flex-wrap items-center gap-2">
          <p className="w-full text-sm">ปิดรหัสของ {r.name}? {KICK_WARNING}</p>
          <Button
            variant="danger"
            onClick={async () => {
              if (await props.onSetActive(false)) close();
            }}
            disabled={props.disabled}
          >
            ยืนยันปิดรหัส
          </Button>
          <Button onClick={close} disabled={props.disabled}>
            ยกเลิก
          </Button>
        </Notice>
      )}

      <RowError message={props.error} />
    </div>
  );
}
