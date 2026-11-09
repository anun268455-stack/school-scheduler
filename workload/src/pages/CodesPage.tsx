import { useState, type FormEvent } from "react";
import { createCode, listCodes, listDepartments, updateCode } from "../api";
import { buildCodeRows, codeLengthError, type CodeRow } from "../codes";
import { useRegistryList, useSaving } from "../useRegistryList";
import { inputClass, RegistryFrame, RowError } from "./registryParts";

const STATUS_TEXT = { unset: "ยังไม่ได้ตั้ง", active: "ใช้งานอยู่", disabled: "ปิดอยู่" } as const;
const STATUS_CLASS = {
  unset: "bg-gray-100 text-gray-800",
  active: "bg-green-100 text-green-900",
  disabled: "bg-red-100 text-red-900",
} as const;

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
      <p className="mb-3 text-sm text-gray-700">
        ระบบไม่เก็บตัวรหัสไว้ให้ดูย้อนหลัง · ตั้งรหัสแล้วจะเห็นรหัสครั้งเดียว ต้องจดแล้วแจกให้หัวหน้ากลุ่มสาระทันที
      </p>
      <ul className="divide-y divide-gray-200 rounded border border-gray-300 bg-white">
        {rows.map((r) => (
          <li key={r.key} className="p-3">
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
    <section aria-label="รหัสที่เพิ่งตั้ง" className="my-3 rounded border-2 border-green-600 bg-green-50 p-4">
      <p className="font-bold">ตั้งรหัสของ {props.revealed.name} แล้ว</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          aria-label="รหัสที่เพิ่งตั้ง"
          readOnly
          value={props.revealed.code}
          onFocus={(e) => e.currentTarget.select()}
          className="rounded border border-gray-400 bg-white px-3 py-2 font-mono"
        />
        <button onClick={() => void copy()} className="rounded border border-gray-400 px-3 py-2">คัดลอก</button>
        <button onClick={props.onClose} className="rounded bg-blue-600 px-3 py-2 text-white">ปิดกล่องนี้</button>
      </div>
      {copyNote && <p role="status" className="mt-1 text-sm">{copyNote}</p>}
      <p className="mt-2 text-red-800">ปิดหน้านี้แล้วจะดูย้อนไม่ได้ ให้จดหรือคัดลอกไว้ก่อน</p>
      {props.revealed.stillDisabled && (
        <p className="mt-1 text-red-800">รหัสนี้ยังปิดอยู่ ต้องกด "เปิด" ก่อนจึงจะใช้เข้าระบบได้</p>
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
      <div className={`flex flex-wrap items-center gap-2 ${r.status === "disabled" ? "opacity-70" : ""}`}>
        <span className="font-medium">{r.name}</span>
        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[r.status]}`}>{STATUS_TEXT[r.status]}</span>
        <span className="ml-auto flex items-center gap-2">
          {mode === "idle" && canSet && (
            <button
              onClick={() => setMode("set")}
              disabled={props.disabled}
              className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
            >
              {hasRow ? "ตั้งรหัสใหม่" : "ตั้งรหัส"}
            </button>
          )}
          {mode === "idle" && canToggle && r.status === "active" && (
            <button
              onClick={() => setMode("confirmDisable")}
              disabled={props.disabled}
              className="rounded border border-red-300 px-3 py-1 text-red-800 disabled:opacity-50"
            >
              ปิด
            </button>
          )}
          {mode === "idle" && canToggle && r.status === "disabled" && (
            <button
              onClick={() => void props.onSetActive(true)}
              disabled={props.disabled}
              className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
            >
              เปิด
            </button>
          )}
        </span>
      </div>

      {r.kind === "admin" && !hasRow && (
        <p className="mt-1 text-sm text-gray-700">ยังไม่มีรหัสผู้ดูแลระบบ ให้ตั้งจากหน้าล็อกอิน</p>
      )}

      {mode === "set" && (
        <form onSubmit={submit} aria-label={`ตั้งรหัส ${r.name}`} className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
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
          <button type="submit" disabled={props.disabled} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
            บันทึกรหัส
          </button>
          <button type="button" onClick={close} disabled={props.disabled} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50">
            ยกเลิก
          </button>
          {r.status !== "unset" && <p className="w-full text-sm text-orange-900">{KICK_WARNING}</p>}
        </form>
      )}

      {mode === "confirmDisable" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-orange-900">ปิดรหัสของ {r.name}? {KICK_WARNING}</p>
          <button
            onClick={async () => {
              if (await props.onSetActive(false)) close();
            }}
            disabled={props.disabled}
            className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50"
          >
            ยืนยันปิดรหัส
          </button>
          <button onClick={close} disabled={props.disabled} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50">
            ยกเลิก
          </button>
        </div>
      )}

      <RowError message={props.error} />
    </div>
  );
}
