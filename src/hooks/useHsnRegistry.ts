import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  buildHsnCodeSet,
  type HsnCodeRecord,
  normalizeHsnCode,
  validateHsnEntry,
} from "@/lib/hsn";

const LOCAL_HSN_KEY = "kaniyamparambil_hsn_codes";

function isMissingTableError(error: { message?: string; code?: string }): boolean {
  const msg = error.message ?? "";
  return error.code === "PGRST116" || msg.includes("does not exist") || msg.includes("relation");
}

function normalizeRow(raw: Record<string, unknown>): HsnCodeRecord {
  return {
    code: normalizeHsnCode(String(raw.code ?? "")),
    description: String(raw.description ?? ""),
    chapter: raw.chapter ? String(raw.chapter) : undefined,
    default_gst_rate: raw.default_gst_rate != null ? Number(raw.default_gst_rate) : undefined,
    is_active: raw.is_active !== false,
  };
}

export function useHsnRegistry() {
  const [records, setRecords] = useState<HsnCodeRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tableAvailable, setTableAvailable] = useState(false);

  const fetchRegistry = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("hsn_codes")
        .select("code, description, chapter, default_gst_rate, is_active")
        .eq("is_active", true)
        .order("code");

      if (error) {
        if (isMissingTableError(error)) {
          setTableAvailable(false);
          const local = localStorage.getItem(LOCAL_HSN_KEY);
          if (local) {
            try {
              setRecords((JSON.parse(local) as HsnCodeRecord[]).map((r) => ({
                ...r,
                code: normalizeHsnCode(r.code),
              })));
            } catch {
              setRecords([]);
            }
          }
          return;
        }
        throw error;
      }

      const rows = (data ?? []).map((r) => normalizeRow(r as Record<string, unknown>));
      setRecords(rows);
      setTableAvailable(true);
      localStorage.setItem(LOCAL_HSN_KEY, JSON.stringify(rows));
    } catch {
      setTableAvailable(false);
      const local = localStorage.getItem(LOCAL_HSN_KEY);
      if (local) {
        try {
          setRecords(JSON.parse(local) as HsnCodeRecord[]);
        } catch {
          setRecords([]);
        }
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchRegistry();
  }, [fetchRegistry]);

  const codeSet = useMemo(() => buildHsnCodeSet(records), [records]);

  const validate = useCallback(
    (code: string) => validateHsnEntry(code, codeSet, tableAvailable && codeSet.size > 0),
    [codeSet, tableAvailable],
  );

  const upsertCodes = useCallback(async (entries: Array<{ code: string; description: string }>) => {
    if (!tableAvailable) return;
    const rows = entries
      .map((e) => ({
        code: normalizeHsnCode(e.code),
        description: e.description.trim().slice(0, 200) || "Added from bill",
        is_active: true,
      }))
      .filter((e) => e.code.length >= 4);

    if (!rows.length) return;

    const { error } = await supabase.from("hsn_codes").upsert(rows, { onConflict: "code" });
    if (!error) await fetchRegistry();
  }, [fetchRegistry, tableAvailable]);

  return {
    records,
    codeSet,
    loaded,
    tableAvailable,
    validate,
    upsertCodes,
    refresh: fetchRegistry,
  };
}
