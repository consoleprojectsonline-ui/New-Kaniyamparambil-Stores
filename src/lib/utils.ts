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

export async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}
