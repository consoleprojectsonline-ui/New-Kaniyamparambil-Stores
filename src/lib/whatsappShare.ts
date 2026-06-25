const DEFAULT_COUNTRY_CODE = "91";

export function normalizeWhatsAppPhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `${countryCode}${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function isValidWhatsAppPhone(input: string): boolean {
  return normalizeWhatsAppPhone(input) !== null;
}

export function formatPhoneDisplay(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return input.trim();
}

export function buildWhatsAppSendUrl(phone: string, message: string): string {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) throw new Error("Enter a valid 10-digit mobile number.");
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openExternalUrl(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export type WhatsAppSendResult = "shared" | "opened";

export async function sendPdfViaWhatsApp(options: {
  phone: string;
  message: string;
  pdfBlob: Blob;
  filename: string;
}): Promise<WhatsAppSendResult> {
  const { phone, message, pdfBlob, filename } = options;
  const file = new File([pdfBlob], filename, { type: "application/pdf" });

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    const shareData: ShareData = { text: message, files: [file], title: filename };
    const canShareFiles = !navigator.canShare || navigator.canShare(shareData);
    if (canShareFiles) {
      try {
        await navigator.share(shareData);
        return "shared";
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw err;
        }
        // Fall back to download + WhatsApp link (browser extensions often block share).
      }
    }
  }

  downloadBlob(pdfBlob, filename);

  const whatsappMessage = `${message}\n\nThe PDF (${filename}) has been downloaded — please attach it in the chat.`;
  const url = buildWhatsAppSendUrl(phone, whatsappMessage);

  await new Promise((resolve) => window.setTimeout(resolve, 250));
  openExternalUrl(url);
  return "opened";
}
