import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorText } from "./api";

// โหลดรายการหนึ่งชุดพร้อมสถานะ กำลังโหลด/ผิดพลาด · แถวอ้างด้วย id เท่านั้น
export function useRegistryList<T extends { id: number }>(fetcher: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(apiErrorText(err));
        setLoading(false);
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

  return { rows, loading, error, reload, upsert };
}

// งานเขียนทีละอย่าง: ระหว่างบันทึกปุ่มต้องถูกปิด กันกดซ้ำแล้วสร้างแถวซ้ำ
export function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ref ไม่ใช่ state: กดสองครั้งติดกันก่อนจอวาดใหม่ state ยังเป็น false อยู่
  const busy = useRef(false);

  const run = useCallback(
    async (job: () => Promise<void>): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setSaving(true);
      setError(null);
      try {
        await job();
        return true;
      } catch (err) {
        setError(apiErrorText(err));
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [],
  );

  return { saving, error, setError, run };
}
