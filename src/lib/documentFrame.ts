const DEFAULT_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  top: "0",
  left: "-20000px",
  width: "794px",
  height: "auto",
  minHeight: "400px",
  opacity: "1",
  pointerEvents: "none",
  border: "0",
  background: "#ffffff",
  overflow: "visible",
  zIndex: "-1",
};

export function getFrameDocument(iframe: HTMLIFrameElement): Document | null {
  return iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForImages(doc: Document): Promise<void> {
  const images = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

async function waitForFonts(doc: Document): Promise<void> {
  try {
    await doc.fonts?.ready;
  } catch {
    // Fallback fonts are fine for export.
  }
}

function queryRoot(doc: Document, rootSelector: string, fallbackSelector?: string): HTMLElement | null {
  const root = doc.querySelector(rootSelector)
    ?? (fallbackSelector ? doc.querySelector(fallbackSelector) : null);
  return root instanceof HTMLElement ? root : null;
}

function writeHtmlIntoFrame(iframe: HTMLIFrameElement, html: string): boolean {
  const frameDocument = getFrameDocument(iframe);
  if (!frameDocument) return false;

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
  return true;
}

export type MountHtmlFrameOptions = {
  frameStyle?: Partial<CSSStyleDeclaration>;
  rootSelector: string;
  fallbackSelector?: string;
  maxWaitMs?: number;
  onFrameReady?: (doc: Document, win: Window) => void;
};

async function waitForDocumentReady(
  iframe: HTMLIFrameElement,
  maxWaitMs: number,
): Promise<Document> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const doc = getFrameDocument(iframe);
    if (doc && (doc.readyState === "interactive" || doc.readyState === "complete")) {
      return doc;
    }
    await sleep(50);
  }

  throw new Error("Document preview timed out while loading.");
}

async function waitForRootInFrame(
  iframe: HTMLIFrameElement,
  options: Pick<MountHtmlFrameOptions, "rootSelector" | "fallbackSelector" | "maxWaitMs">,
): Promise<HTMLElement> {
  const maxWaitMs = options.maxWaitMs ?? 12000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const doc = getFrameDocument(iframe);
    if (doc && (doc.readyState === "interactive" || doc.readyState === "complete")) {
      const root = queryRoot(doc, options.rootSelector, options.fallbackSelector);
      if (root) return root;
    }
    await sleep(50);
  }

  throw new Error(`Unable to prepare the document layout (${options.rootSelector}).`);
}

/** Load HTML into a hidden iframe via document.write (reliable for print + PDF export). */
export async function mountHtmlFrame(
  html: string,
  options: MountHtmlFrameOptions,
): Promise<{ iframe: HTMLIFrameElement; root: HTMLElement }> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, DEFAULT_FRAME_STYLE, options.frameStyle ?? {});
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "Document export frame");
  document.body.appendChild(iframe);

  try {
    if (!writeHtmlIntoFrame(iframe, html)) {
      throw new Error("Unable to prepare the document preview frame.");
    }

    const doc = await waitForDocumentReady(iframe, options.maxWaitMs ?? 12000);
    const root = await waitForRootInFrame(iframe, options);

    options.onFrameReady?.(doc, iframe.contentWindow!);
    await waitForFonts(doc);
    await waitForImages(doc);
    await sleep(120);

    const frameWindow = iframe.contentWindow as (Window & { fitInvoiceToSinglePage?: () => void }) | null;
    try {
      frameWindow?.fitInvoiceToSinglePage?.();
    } catch {
      // Layout fitting is optional.
    }
    await sleep(100);

    const refreshedDoc = getFrameDocument(iframe);
    const finalRoot = refreshedDoc
      ? queryRoot(refreshedDoc, options.rootSelector, options.fallbackSelector) ?? root
      : root;

    iframe.style.height = `${Math.max(finalRoot.scrollHeight, finalRoot.offsetHeight) + 40}px`;
    return { iframe, root: finalRoot };
  } catch (error) {
    iframe.remove();
    throw error;
  }
}
