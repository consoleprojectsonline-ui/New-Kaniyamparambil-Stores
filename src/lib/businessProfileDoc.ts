import type { BusinessDetails } from "@/lib/businessDetails";

const FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  top: "0",
  left: "-20000px",
  width: "794px",
  height: "auto",
  minHeight: "400px",
  opacity: "0",
  pointerEvents: "none",
  border: "0",
  background: "transparent",
  overflow: "visible",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveAssetUrl(relativeUrl: string): string {
  if (typeof window === "undefined") return relativeUrl;
  try {
    return new URL(relativeUrl, window.location.origin).href;
  } catch {
    return relativeUrl;
  }
}

function detailRow(label: string, value: string): string {
  return `
    <tr>
      <td class="label">${escapeHtml(label)}</td>
      <td class="value">${escapeHtml(value || "—")}</td>
    </tr>`;
}

export function buildBusinessProfileHtml(
  business: BusinessDetails,
  photoUrl: string,
  options: { autoPrint?: boolean } = {},
): string {
  const photo = photoUrl.startsWith("data:") ? photoUrl : resolveAssetUrl(photoUrl);
  const autoPrint = options.autoPrint ?? false;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Business Profile — ${escapeHtml(business.storeName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; background: #f3f4f6; font-size: 12px; line-height: 1.4; padding: 20px; }
    .toolbar { max-width: 794px; margin: 0 auto 12px; padding: 12px 16px; border: 1px solid #ccc; background: #fff; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .toolbar-text { margin: 0; font-size: 11px; color: #555; }
    .toolbar-btn { border: 1px solid #0d9488; background: #0d9488; color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .business-profile-sheet { max-width: 794px; margin: 0 auto; background: #fff; border: 1px solid #000; }
    .title { text-align: center; font-size: 16px; font-weight: 700; color: #0d9488; letter-spacing: 0.06em; padding: 10px; border-bottom: 1px solid #000; }
    .subtitle { text-align: center; font-size: 10px; color: #555; padding-bottom: 6px; border-bottom: 1px solid #000; }
    .hero { display: flex; gap: 16px; padding: 14px; border-bottom: 1px solid #000; align-items: flex-start; }
    .photo { width: 120px; height: 150px; object-fit: cover; border: 1px solid #000; flex-shrink: 0; }
    .hero-text h2 { margin: 0 0 6px; font-size: 18px; }
    .hero-text p { margin: 0 0 4px; font-size: 11px; }
    .section { border-bottom: 1px solid #000; }
    .section-title { background: #f0fdfa; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 7px 10px; border-bottom: 1px solid #000; color: #0f766e; }
    table { width: 100%; border-collapse: collapse; }
    td { border-bottom: 1px solid #e5e7eb; padding: 6px 10px; vertical-align: top; font-size: 11px; }
    tr:last-child td { border-bottom: 0; }
    .label { width: 34%; font-weight: 700; color: #444; text-transform: uppercase; font-size: 9px; letter-spacing: 0.04em; }
    .value { font-weight: 600; }
    .footer { padding: 10px; font-size: 10px; color: #666; text-align: center; }
    @media print {
      body { background: #fff; padding: 0; }
      .toolbar { display: none !important; }
      .business-profile-sheet { border: none; max-width: none; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <p class="toolbar-text">Registered business profile — print or save as PDF from your browser.</p>
    <button class="toolbar-btn" type="button" onclick="window.print()">Print / Save PDF</button>
  </div>
  <div class="business-profile-sheet">
    <div class="title">REGISTERED BUSINESS PROFILE</div>
    <div class="subtitle">${escapeHtml(business.storeDisplayName)}</div>
    <div class="hero">
      <img class="photo" src="${escapeHtml(photo)}" alt="Proprietor" />
      <div class="hero-text">
        <h2>${escapeHtml(business.storeName)}</h2>
        <p><b>Proprietor:</b> ${escapeHtml(business.ownerName)}</p>
        <p><b>Business Type:</b> ${escapeHtml(business.businessType)}</p>
        <p><b>Address:</b> ${escapeHtml(business.address)}</p>
        <p><b>Phone:</b> ${escapeHtml(business.phone)} | <b>Email:</b> ${escapeHtml(business.email)}</p>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Tax and Registration</div>
      <table>
        ${detailRow("GSTIN", business.gstin)}
        ${detailRow("PAN", business.pan)}
        ${detailRow("State", `${business.state} (${business.stateCode})`)}
      </table>
    </div>
    <div class="section">
      <div class="section-title">Udyam / MSME Registration</div>
      <table>
        ${detailRow("Udyam Registration No.", business.udyamNumber)}
        ${detailRow("Registration Date", business.udyamRegistrationDate)}
        ${detailRow("Enterprise Type", business.udyamEnterpriseType)}
        ${detailRow("Major Activity", business.udyamMajorActivity)}
        ${detailRow("NIC Code", business.udyamNicCode)}
      </table>
    </div>
    <div class="section">
      <div class="section-title">Bank Details</div>
      <table>
        ${detailRow("Bank", business.bankName)}
        ${detailRow("Account No.", business.accountNo)}
        ${detailRow("IFSC", business.ifsc)}
        ${detailRow("Branch", business.branch)}
      </table>
    </div>
    <div class="footer">Generated from Kaniyamparambil Stores ERP</div>
  </div>
  <script>
    ${autoPrint ? "window.addEventListener('load', function () { window.setTimeout(function () { window.focus(); window.print(); }, 400); });" : ""}
  </script>
</body>
</html>`;
}

async function embedPhotoAsDataUrl(photoUrl: string): Promise<string> {
  if (photoUrl.startsWith("data:")) return photoUrl;

  try {
    const absolute = resolveAssetUrl(photoUrl);
    const response = await fetch(absolute);
    if (!response.ok) return absolute;
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? absolute));
      reader.onerror = () => resolve(absolute);
      reader.readAsDataURL(blob);
    });
  } catch {
    return resolveAssetUrl(photoUrl);
  }
}

async function printViaHiddenIframe(html: string): Promise<void> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, FRAME_STYLE);
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    iframe.remove();
    throw new Error("Unable to prepare the business profile document.");
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const checkReady = () => {
      const readyState = iframe.contentDocument?.readyState;
      if (readyState === "interactive" || readyState === "complete") {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 5000) {
        reject(new Error("Business profile preview took too long to load."));
        return;
      }
      window.setTimeout(checkReady, 50);
    };
    checkReady();
  });

  await new Promise((resolve) => window.setTimeout(resolve, 200));

  const printWindow = iframe.contentWindow;
  if (!printWindow) {
    iframe.remove();
    throw new Error("Unable to open the print dialog.");
  }

  printWindow.focus();
  printWindow.print();
  window.setTimeout(() => iframe.remove(), 1200);
}

export async function printBusinessProfile(
  business: BusinessDetails,
  photoUrl: string,
): Promise<void> {
  const embeddedPhoto = await embedPhotoAsDataUrl(photoUrl);
  const html = buildBusinessProfileHtml(business, embeddedPhoto, { autoPrint: true });

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const printWindow = window.open(blobUrl, "_blank", "noopener,noreferrer");

  if (printWindow) {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  URL.revokeObjectURL(blobUrl);

  try {
    await printViaHiddenIframe(html);
  } catch {
    throw new Error(
      "Could not open print preview. Allow pop-ups for this site, or use Print / Save PDF from the preview tab.",
    );
  }
}
