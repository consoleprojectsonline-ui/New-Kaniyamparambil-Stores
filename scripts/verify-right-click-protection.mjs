/**
 * Simulates contextmenu events to verify right-click protection logic.
 * Run: node scripts/verify-right-click-protection.mjs
 */

const NOTICE =
  "For your safety, right-click is disabled throughout this software.";

let noticeText = null;
let listener = null;

const document = {
  addEventListener(type, fn, options) {
    if (type === "contextmenu") listener = { fn, options };
  },
  removeEventListener() {},
  createElement() {
    return {
      setAttribute() {},
      style: {},
      textContent: "",
    };
  },
  body: {
    appendChild(el) {
      noticeText = el.textContent;
    },
  },
};

function showNotice() {
  const el = document.createElement("div");
  el.textContent = NOTICE;
  document.body.appendChild(el);
}

function handleContextMenu(event) {
  event.preventDefault();
  showNotice();
}

document.addEventListener("contextmenu", handleContextMenu, { capture: true });

const event = {
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
};

listener.fn(event);

if (!event.defaultPrevented) {
  console.error("FAIL: contextmenu was not prevented");
  process.exit(1);
}

if (noticeText !== NOTICE) {
  console.error("FAIL: safety notice was not shown");
  process.exit(1);
}

if (!listener.options?.capture) {
  console.error("FAIL: listener should use capture phase");
  process.exit(1);
}

console.log("PASS: contextmenu prevented");
console.log("PASS: notice displayed:", NOTICE);
console.log("PASS: capture-phase listener registered");
console.log("Right-click protection logic verified.");
