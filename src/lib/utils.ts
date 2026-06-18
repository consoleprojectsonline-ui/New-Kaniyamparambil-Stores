import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatTableDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";

  if (typeof value === "string") {
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (isoMatch) {
      return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
    }
  }

  const d = typeof value === "string"
    ? new Date(value.includes("T") ? value : `${value.slice(0, 10)}T00:00:00`)
    : value;
  if (Number.isNaN(d.getTime())) return String(value);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

export function formatDate(date: Date | string): string {
  return formatTableDate(date);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

export function generateInvoiceNumber(): string {
  const prefix = "INV";
  const year = new Date().getFullYear().toString().slice(-2);
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${year}-${num}`;
}

function toWordsBelowThousand(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  let n = Math.floor(num);
  const parts: string[] = [];

  if (n >= 100) {
    parts.push(`${ones[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(tens[Math.floor(n / 10)]);
    n %= 10;
  } else if (n >= 10) {
    parts.push(teens[n - 10]);
    n = 0;
  }
  if (n > 0) parts.push(ones[n]);

  return parts.filter(Boolean).join(" ");
}

/** Indian numbering — amount in words for tax invoices. */
export function numberToWordsIndian(value: number): string {
  const amount = Math.max(0, Math.round(value));
  if (amount === 0) return "Rupees Zero Only";

  const units = [
    { value: 10000000, label: "Crore" },
    { value: 100000, label: "Lakh" },
    { value: 1000, label: "Thousand" },
  ];

  let remaining = amount;
  const words: string[] = [];

  units.forEach(({ value: unitValue, label }) => {
    if (remaining >= unitValue) {
      const unitCount = Math.floor(remaining / unitValue);
      words.push(`${toWordsBelowThousand(unitCount)} ${label}`);
      remaining %= unitValue;
    }
  });

  if (remaining > 0) words.push(toWordsBelowThousand(remaining));

  return `Rupees ${words.join(" ").replace(/\s+/g, " ").trim()} Only`;
}

export function validateGstin(gstin: string): boolean {
  const v = gstin.trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
}

export function reverseChargeLabel(reverseCharge?: boolean): string {
  return reverseCharge ? "Yes" : "No";
}

export async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}
