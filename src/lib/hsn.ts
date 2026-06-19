export interface HsnCodeRecord {
  code: string;
  description: string;
  chapter?: string;
  default_gst_rate?: number;
  is_active?: boolean;
}

/** Strip non-digits; HSN/SAC codes are numeric (4–8 digits in India). */
export function normalizeHsnCode(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").trim();
}

export function isValidHsnFormat(code: string): boolean {
  const n = normalizeHsnCode(code);
  return n.length >= 4 && n.length <= 8;
}

export function hsnFormatError(code: string): string | null {
  const n = normalizeHsnCode(code);
  if (!n) return "HSN code is required.";
  if (n.length < 4) return "HSN code must be at least 4 digits.";
  if (n.length > 8) return "HSN code cannot exceed 8 digits.";
  return null;
}

export function isKnownHsnCode(code: string, knownCodes: ReadonlySet<string>): boolean {
  const n = normalizeHsnCode(code);
  if (!n) return false;
  if (knownCodes.has(n)) return true;
  // Allow prefix match when master has shorter chapter headings (e.g. 8201 vs 82011000)
  for (const known of knownCodes) {
    if (n.startsWith(known) || known.startsWith(n)) return true;
  }
  return false;
}

export function validateHsnEntry(
  code: string,
  knownCodes: ReadonlySet<string>,
  registryLoaded: boolean,
): string | null {
  const formatErr = hsnFormatError(code);
  if (formatErr) return formatErr;
  if (registryLoaded && !isKnownHsnCode(code, knownCodes)) {
    return `HSN ${normalizeHsnCode(code)} is not in the master list. Pick from suggestions or add it in Supabase (hsn_codes table).`;
  }
  return null;
}

export function buildHsnCodeSet(records: HsnCodeRecord[]): Set<string> {
  const set = new Set<string>();
  for (const row of records) {
    const code = normalizeHsnCode(row.code);
    if (code && row.is_active !== false) set.add(code);
  }
  return set;
}

export function filterHsnSuggestions(records: HsnCodeRecord[], query: string, limit = 12): HsnCodeRecord[] {
  const q = normalizeHsnCode(query);
  const qText = query.trim().toLowerCase();
  const active = records.filter((r) => r.is_active !== false);
  if (!q && !qText) return active.slice(0, limit);
  return active
    .filter((r) => {
      const code = normalizeHsnCode(r.code);
      return code.includes(q) || r.description.toLowerCase().includes(qText);
    })
    .slice(0, limit);
}
