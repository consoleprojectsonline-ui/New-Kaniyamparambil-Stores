/**
 * RIGHT-CLICK PROTECTION
 * ─────────────────────────────────────────────────────────────────────────────
 * Blocks the browser context menu across the entire app and shows a safety notice.
 *
 * To ENABLE right-click blocking — uncomment at the bottom:
 *   initRightClickProtection();
 *
 * To ALLOW right-click (default) — keep that line commented.
 *
 * main.tsx imports this file for side effects only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const NOTICE_MESSAGE =
  "For your safety, right-click is disabled throughout this software.";

const NOTICE_DURATION_MS = 3500;
const NOTICE_COOLDOWN_MS = 1500;

let noticeEl: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let lastShownAt = 0;
let cleanup: (() => void) | null = null;

function ensureNoticeElement(): HTMLDivElement {
  if (noticeEl) return noticeEl;

  noticeEl = document.createElement("div");
  noticeEl.setAttribute("role", "alert");
  noticeEl.setAttribute("aria-live", "polite");
  Object.assign(noticeEl.style, {
    position: "fixed",
    left: "50%",
    bottom: "28px",
    transform: "translateX(-50%) translateY(12px)",
    zIndex: "99999",
    maxWidth: "min(420px, calc(100vw - 32px))",
    padding: "12px 18px",
    borderRadius: "10px",
    background: "#1e293b",
    color: "#f8fafc",
    fontFamily: '"Inter", system-ui, sans-serif',
    fontSize: "13px",
    lineHeight: "1.45",
    fontWeight: "500",
    textAlign: "center",
    boxShadow: "0 10px 40px rgba(15, 23, 42, 0.35)",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 0.2s ease, transform 0.2s ease",
  } as CSSStyleDeclaration);

  document.body.appendChild(noticeEl);
  return noticeEl;
}

function showNotice() {
  const now = Date.now();
  if (now - lastShownAt < NOTICE_COOLDOWN_MS) return;
  lastShownAt = now;

  const el = ensureNoticeElement();
  el.textContent = NOTICE_MESSAGE;
  el.style.opacity = "1";
  el.style.transform = "translateX(-50%) translateY(0)";

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!noticeEl) return;
    noticeEl.style.opacity = "0";
    noticeEl.style.transform = "translateX(-50%) translateY(12px)";
  }, NOTICE_DURATION_MS);
}

function handleContextMenu(event: MouseEvent) {
  event.preventDefault();
  showNotice();
}

export function initRightClickProtection(): () => void {
  if (cleanup) return cleanup;

  document.addEventListener("contextmenu", handleContextMenu, { capture: true });

  cleanup = () => {
    document.removeEventListener("contextmenu", handleContextMenu, { capture: true });
    if (hideTimer) clearTimeout(hideTimer);
    noticeEl?.remove();
    noticeEl = null;
    hideTimer = null;
    cleanup = null;
  };

  return cleanup;
}

// ── To DISABLE right-click: uncomment the next line  |  To allow right-click: keep it commented ──
// initRightClickProtection();
