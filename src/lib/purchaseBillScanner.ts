import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export interface ScannedPurchaseItem {
  code?: string;
  name: string;
  hsn_code?: string;
  qty: number;
  unit?: string;
  rate: number;
  disc?: number;
  sgst?: number;
  cgst?: number;
  s_rate?: number;
  mrp?: number;
}

export interface ScannedPurchaseDraft {
  invoice_no?: string;
  serial_no?: string;
  supplier_name?: string;
  purchase_type?: string;
  branch_godown?: string;
  entry_date?: string;
  invoice_date?: string;
  vehicle_no?: string;
  expenses?: number;
  paid_amount?: number;
  payment_status?: string;
  items?: ScannedPurchaseItem[];
}

export interface ScanPurchaseBillResult {
  draft: ScannedPurchaseDraft;
  source: "ai" | "heuristic";
  warning?: string;
}

/** Lighter models first — higher free-tier quotas, fewer 429s. */
const GEMINI_MODELS = [
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash",
] as const;

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MIN_TEXT_CHARS = 80;

const EXTRACTION_PROMPT = `You are extracting data from an Indian wholesale/retail purchase invoice or tax bill (GST invoice).

Return ONLY valid JSON matching this shape (omit fields you cannot find; use null for unknown optional numbers):
{
  "invoice_no": "supplier invoice / bill number",
  "serial_no": "internal serial or challan number if shown",
  "supplier_name": "seller / vendor / supplier company name",
  "purchase_type": "one of: Local Purchase, Interstate Purchase, Import / Custom clearance, Tax-Free Purchase, Consignment Stock Inflow — infer from IGST vs CGST+SGST if possible",
  "branch_godown": "destination godown if mentioned, else omit",
  "entry_date": "YYYY-MM-DD",
  "invoice_date": "YYYY-MM-DD",
  "vehicle_no": "vehicle registration if present",
  "expenses": number for freight/loading/round-off charges NOT already in line items,
  "paid_amount": number if payment amount is shown,
  "payment_status": "Pending | Partial | Paid",
  "items": [
    {
      "code": "product/item code if printed",
      "name": "product description",
      "hsn_code": "HSN or SAC",
      "qty": number,
      "unit": "Nos|Mtr|Kg|Ltr|Box|Pcs|Set|Pair|Roll|Bag|Bundle|Dozen|Sqft|Sqm|Ton",
      "rate": unit rate before discount,
      "disc": line discount amount in rupees,
      "sgst": SGST percentage (e.g. 9),
      "cgst": CGST percentage (e.g. 9),
      "s_rate": selling rate if shown,
      "mrp": MRP if shown
    }
  ]
}

Rules:
- Dates must be ISO YYYY-MM-DD. Convert DD/MM/YYYY or DD-MM-YYYY.
- Amounts are numbers without currency symbols.
- For items, extract every product line from the table.
- If only IGST is shown (interstate), set sgst and cgst each to half of IGST rate.
- Do not invent invoice numbers or items.`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function draftHasData(draft: ScannedPurchaseDraft): boolean {
  return Boolean(draft.invoice_no || draft.supplier_name || (draft.items?.length ?? 0) > 0);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const chunks: string[] = [];

  for (let page = 1; page <= pdf.numPages; page += 1) {
    const pageObj = await pdf.getPage(page);
    const content = await pageObj.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    chunks.push(pageText);
  }

  return chunks.join("\n").replace(/\s+/g, " ").trim();
}

function parseJsonFromModelText(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI response did not contain JSON.");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  return s || undefined;
}

function normalizeIsoDate(value: unknown): string | undefined {
  const raw = toOptionalString(value);
  if (!raw) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    let year = dmy[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }
  return undefined;
}

function normalizePaymentStatus(value: unknown): string | undefined {
  const s = toOptionalString(value)?.toLowerCase();
  if (!s) return undefined;
  if (s.includes("paid") && !s.includes("partial") && !s.includes("unpaid")) return "Paid";
  if (s.includes("partial")) return "Partial";
  if (s.includes("pending") || s.includes("unpaid") || s.includes("due")) return "Pending";
  return undefined;
}

function normalizeScannedItem(raw: Record<string, unknown>): ScannedPurchaseItem | null {
  const name = toOptionalString(raw.name) ?? toOptionalString(raw.description);
  const qty = toNumber(raw.qty ?? raw.quantity) ?? 0;
  const rate = toNumber(raw.rate ?? raw.unit_rate ?? raw.price) ?? 0;
  if (!name || qty <= 0 || rate <= 0) return null;

  return {
    code: toOptionalString(raw.code ?? raw.item_code ?? raw.product_code),
    name,
    hsn_code: toOptionalString(raw.hsn_code ?? raw.hsn ?? raw.sac),
    qty,
    unit: toOptionalString(raw.unit ?? raw.uom),
    rate,
    disc: toNumber(raw.disc ?? raw.discount) ?? 0,
    sgst: toNumber(raw.sgst ?? raw.sgst_percent ?? raw.sgst_pct),
    cgst: toNumber(raw.cgst ?? raw.cgst_percent ?? raw.cgst_pct),
    s_rate: toNumber(raw.s_rate ?? raw.selling_rate),
    mrp: toNumber(raw.mrp),
  };
}

export function normalizeScannedPurchaseDraft(raw: Record<string, unknown>): ScannedPurchaseDraft {
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw
    .map((item) => normalizeScannedItem(item as Record<string, unknown>))
    .filter((item): item is ScannedPurchaseItem => item !== null);

  return {
    invoice_no: toOptionalString(raw.invoice_no ?? raw.invoice_number ?? raw.bill_no),
    serial_no: toOptionalString(raw.serial_no ?? raw.serial_number ?? raw.challan_no),
    supplier_name: toOptionalString(raw.supplier_name ?? raw.vendor_name ?? raw.seller_name),
    purchase_type: toOptionalString(raw.purchase_type),
    branch_godown: toOptionalString(raw.branch_godown ?? raw.godown ?? raw.destination),
    entry_date: normalizeIsoDate(raw.entry_date ?? raw.purchase_date),
    invoice_date: normalizeIsoDate(raw.invoice_date ?? raw.bill_date ?? raw.date),
    vehicle_no: toOptionalString(raw.vehicle_no ?? raw.vehicle_number)?.toUpperCase(),
    expenses: toNumber(raw.expenses ?? raw.freight ?? raw.loading_charges),
    paid_amount: toNumber(raw.paid_amount ?? raw.amount_paid),
    payment_status: normalizePaymentStatus(raw.payment_status),
    items: items.length > 0 ? items : undefined,
  };
}

function parsePurchaseBillFromText(text: string): ScannedPurchaseDraft {
  const normalized = text.replace(/\s+/g, " ");

  const invoiceMatch =
    normalized.match(/(?:invoice|inv\.?|bill)\s*(?:no\.?|number|#|:)\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i) ??
    normalized.match(/\b(?:GST\s*)?INVOICE\s*([A-Z0-9\-\/]{4,})\b/i);

  const supplierMatch =
    normalized.match(/(?:supplier|vendor|seller|from|party)\s*[:\-]?\s*([A-Za-z0-9 &.,()'-]{3,60})/i);

  const vehicleMatch = normalized.match(/\b([A-Z]{2}\s*[-]?\s*\d{1,2}\s*[-]?\s*[A-Z]{1,3}\s*[-]?\s*\d{1,4})\b/i);

  const dateMatches = [...normalized.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g)];
  const dates = dateMatches
    .map((m) => normalizeIsoDate(`${m[1]}/${m[2]}/${m[3]}`))
    .filter((d): d is string => Boolean(d));

  const freightMatch = normalized.match(/(?:freight|transport|loading|carriage)\s*[:\-]?\s*(?:rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);

  const netMatch =
    normalized.match(/(?:grand\s*total|net\s*amount|total\s*amount)\s*[:\-]?\s*(?:rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);

  return normalizeScannedPurchaseDraft({
    invoice_no: invoiceMatch?.[1],
    supplier_name: supplierMatch?.[1]?.trim(),
    invoice_date: dates[0],
    entry_date: dates[0],
    vehicle_no: vehicleMatch?.[1]?.replace(/\s+/g, ""),
    expenses: freightMatch ? toNumber(freightMatch[1]) : undefined,
    paid_amount: netMatch ? toNumber(netMatch[1]) : undefined,
    payment_status: netMatch ? "Paid" : undefined,
  });
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

async function callGeminiOnce(
  model: string,
  parts: GeminiPart[],
  apiKey: string,
): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    },
  );
}

function parseGeminiResponse(response: Response): Promise<ScannedPurchaseDraft> {
  return response.json().then((payload: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }) => {
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      throw new Error("AI returned an empty response.");
    }
    return normalizeScannedPurchaseDraft(parseJsonFromModelText(text));
  });
}

async function scanWithGemini(parts: GeminiPart[]): Promise<ScannedPurchaseDraft> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured (VITE_GEMINI_API_KEY).");
  }

  let sawRateLimit = false;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await callGeminiOnce(model, parts, apiKey);

      if (response.status === 429) {
        sawRateLimit = true;
        const retrySec = Number(response.headers.get("Retry-After")) || (attempt + 1) * 3;
        await sleep(retrySec * 1000);
        continue;
      }

      if (!response.ok) {
        break;
      }

      return parseGeminiResponse(response);
    }
  }

  if (sawRateLimit) {
    throw new Error("RATE_LIMIT");
  }

  throw new Error("AI scan failed. Check your API key and try again.");
}

async function scanWithGeminiText(text: string): Promise<ScannedPurchaseDraft> {
  return scanWithGemini([
    { text: `${EXTRACTION_PROMPT}\n\n--- INVOICE TEXT ---\n${text.slice(0, 100000)}` },
  ]);
}

async function scanWithGeminiPdf(base64: string): Promise<ScannedPurchaseDraft> {
  return scanWithGemini([
    { inline_data: { mime_type: "application/pdf", data: base64 } },
    { text: EXTRACTION_PROMPT },
  ]);
}

export async function scanPurchaseBillPdf(file: File): Promise<ScanPurchaseBillResult> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error("PDF is too large. Please use a file under 12 MB.");
  }

  const hasGemini = Boolean(import.meta.env.VITE_GEMINI_API_KEY?.trim());
  const text = await extractTextFromPdf(file);
  let rateLimited = false;

  if (hasGemini) {
    try {
      if (text.length >= MIN_TEXT_CHARS) {
        const fromTextAi = await scanWithGeminiText(text);
        if (draftHasData(fromTextAi)) {
          return { draft: fromTextAi, source: "ai" };
        }
      } else {
        const base64 = await fileToBase64(file);
        const fromPdf = await scanWithGeminiPdf(base64);
        if (draftHasData(fromPdf)) {
          return { draft: fromPdf, source: "ai" };
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === "RATE_LIMIT") {
        rateLimited = true;
      }
    }
  }

  if (text.length >= MIN_TEXT_CHARS) {
    const heuristic = parsePurchaseBillFromText(text);
    if (draftHasData(heuristic)) {
      return {
        draft: heuristic,
        source: "heuristic",
        warning: rateLimited
          ? "Gemini rate limit reached — only basic header fields were extracted. Wait a minute and retry, or complete the form manually."
          : hasGemini
            ? "AI could not parse this bill — basic header fields were extracted. Review line items manually."
            : undefined,
      };
    }
  }

  if (!hasGemini) {
    throw new Error(
      "Could not read this PDF. Add a valid VITE_GEMINI_API_KEY (from Google AI Studio) for AI bill scanning.",
    );
  }

  if (rateLimited) {
    throw new Error(
      "Gemini API rate limit reached (429). Wait 1–2 minutes and try again, or enter the bill manually.",
    );
  }

  throw new Error(
    "Could not extract purchase details from this PDF. Try a clearer scan or enter details manually.",
  );
}

/** @deprecated Use scanPurchaseBillPdf — kept for callers expecting draft only */
export async function scanPurchaseBillPdfDraft(file: File): Promise<ScannedPurchaseDraft> {
  const result = await scanPurchaseBillPdf(file);
  return result.draft;
}
