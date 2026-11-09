import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiErrorText } from "./api";
import { groupByDepartment } from "./registry";
import type { Department } from "./types";

// โหลดรายการหนึ่งชุดพร้อมสถานะ กำลังโหลด/ผิดพลาด · แถวอ้างด้วย id เท่านั้น
export function useRegistryList<T extends { id: number }>(fetcher: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([]);
  // loaded = เคยโหลดสำเร็จอย่างน้อยครั้งเดียว · โหลดซ้ำ (reload) เก็บแถวเก่าไว้บนจอ ไม่ถอดฟอร์มที่กำลังพิมพ์
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetcher()
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(apiErrorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  // แทนแถวเดิมตาม id หรือต่อท้ายถ้าเป็นแถวใหม่
  const upsert = useCallback((row: T) => {
    setRows((cur) => (cur.some((r) => r.id === row.id) ? cur.map((r) => (r.id === row.id ? row : r)) : [...cur, row]));
  }, []);

  return { rows, loaded, error, reload, upsert };
}

// จัดกลุ่มตามกลุ่มสาระ (sorter ต้องเป็นฟังก์ชันระดับโมดูลเพื่อให้ useMemo คงที่)
export function useDepartmentGroups<T extends { id: number; department_id: number | null }>(
  rows: T[],
  sorter: (rows: readonly T[]) => T[],
  departments: Department[],
) {
  return useMemo(() => groupByDepartment(sorter(rows), departments), [rows, sorter, departments]);
}

// งานเขียนทีละอย่าง: ระหว่างบันทึกปุ่มต้องถูกปิด กันกดซ้ำแล้วสร้างแถวซ้ำ
// ข้อผิดพลาดส่งให้ผู้เรียกวางเอง (ใกล้แถวหรือฟอร์มที่เกี่ยว ไม่ใช่หัวหน้าที่อยู่นอกจอ)
export function useSaving() {
  const [saving, setSaving] = useState(false);
  // ref ไม่ใช่ state: กดสองครั้งติดกันก่อนจอวาดใหม่ state ยังเป็น false อยู่
  const busy = useRef(false);

  const run = useCallback(async (job: () => Promise<void>, onError: (message: string) => void): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    try {
      await job();
      return true;
    } catch (err) {
      onError(apiErrorText(err));
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, []);

  return { saving, run };
}

// ข้อผิดพลาดของงานเขียน: ของฟอร์มเพิ่มแสดงที่ฟอร์ม · ของแถวแสดงที่แถวนั้น (อ้างด้วย id)
export function useWriteErrors() {
  const [addError, setAddError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  return { addError, setAddError, rowError, setRowError };
}
