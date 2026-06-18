export const DEFAULT_GST_SPLIT = { sgst: 9, cgst: 9 } as const;
export const ZERO_GST_SPLIT = { sgst: 0, cgst: 0 } as const;

export type GstRateSplit = { sgst: number; cgst: number };

export type InventoryGstSource = {
  gst_applicable?: boolean | null;
};

export type PurchaseGstLine = GstRateSplit;

export function normalizeProductName(name: string): string {
  return String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inventoryLookupKey(code: unknown): string {
  return String(code ?? "").trim().toUpperCase();
}

export function isGstApplicable(item?: InventoryGstSource | null): boolean {
  return item?.gst_applicable !== false;
}

/** Parse SGST/CGST from a saved purchase line. Returns null when GST was never recorded. */
export function parsePurchaseGstLine(raw: Record<string, unknown>): PurchaseGstLine | null {
  const gstPercent = Number(raw.gst ?? raw.gst_percent ?? 0);
  const hasSplitGst = raw.sgst != null || raw.cgst != null;
  if (hasSplitGst) {
    return {
      sgst: Number(raw.sgst ?? 0),
      cgst: Number(raw.cgst ?? 0),
    };
  }
  if (gstPercent > 0) {
    return { sgst: gstPercent / 2, cgst: gstPercent / 2 };
  }
  return null;
}

export function buildPurchaseGstMaps(rows: Array<{ items: unknown[] }>): {
  byCode: Map<string, PurchaseGstLine>;
  byName: Map<string, PurchaseGstLine>;
} {
  const byCode = new Map<string, PurchaseGstLine>();
  const byName = new Map<string, PurchaseGstLine>();
  for (const row of rows) {
    if (!Array.isArray(row.items)) continue;
    for (const raw of row.items as Record<string, unknown>[]) {
      const parsed = parsePurchaseGstLine(raw);
      if (!parsed) continue;
      const code = inventoryLookupKey(raw.code);
      const nameKey = normalizeProductName(String(raw.name ?? ""));
      if (code && !byCode.has(code)) byCode.set(code, parsed);
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, parsed);
    }
  }
  return { byCode, byName };
}

export type ResolveLineGstOptions = {
  inventoryItem?: InventoryGstSource | null;
  purchaseByCode?: PurchaseGstLine | null;
  purchaseByName?: PurchaseGstLine | null;
  /** When set (e.g. bill-level GST class), overrides per-item defaults. */
  rateTpOverride?: GstRateSplit | null;
  defaultRates?: GstRateSplit;
};

export function resolveLineGstRates(options: ResolveLineGstOptions): GstRateSplit {
  const {
    inventoryItem,
    purchaseByCode,
    purchaseByName,
    rateTpOverride,
    defaultRates = DEFAULT_GST_SPLIT,
  } = options;

  if (!isGstApplicable(inventoryItem)) return { ...ZERO_GST_SPLIT };
  if (rateTpOverride) return rateTpOverride;
  if (purchaseByCode) return purchaseByCode;
  if (purchaseByName) return purchaseByName;
  return { ...defaultRates };
}
