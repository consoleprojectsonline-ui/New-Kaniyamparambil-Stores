import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export type PdfLayoutMode = "fit-single" | "multipage";

function cloneElementForCapture(element: HTMLElement): { host: HTMLDivElement; clone: HTMLElement } {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    top: "0",
    left: "-20000px",
    width: "794px",
    background: "#ffffff",
    zIndex: "-1",
    overflow: "visible",
    pointerEvents: "none",
  } as CSSStyleDeclaration);

  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.transform = "none";
  clone.style.transformOrigin = "top left";
  host.appendChild(clone);
  document.body.appendChild(host);
  return { host, clone };
}

export async function renderElementToPdfBlob(
  element: HTMLElement,
  layout: PdfLayoutMode = "fit-single",
): Promise<Blob> {
  const { host, clone } = cloneElementForCapture(element);

  try {
    const canvas = await html2canvas(clone, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      scrollX: 0,
      scrollY: 0,
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const imgData = canvas.toDataURL("image/png");

    if (layout === "fit-single") {
      const maxWidth = pageWidth - margin * 2;
      const maxHeight = pageHeight - margin * 2;
      const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      pdf.addImage(
        imgData,
        "PNG",
        margin,
        margin,
        canvas.width * scale,
        canvas.height * scale,
        undefined,
        "FAST",
      );
    } else {
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = margin;

      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;

      while (heightLeft > 0) {
        pdf.addPage();
        position = margin - (imgHeight - heightLeft);
        pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
        heightLeft -= pageHeight - margin * 2;
      }
    }

    return pdf.output("blob");
  } finally {
    host.remove();
  }
}
