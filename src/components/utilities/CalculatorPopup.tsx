import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type CalculatorPopupProps = {
  onClose: () => void;
};

type PendingOp = {
  value: number;
  operator: string;
};

function formatDisplay(value: string): string {
  if (!value || value === "Error") return value || "0";
  if (value.includes("e")) return value;
  const parts = value.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function sanitizeInput(raw: string): string {
  return raw.replace(/,/g, "");
}

export function CalculatorPopup({ onClose }: CalculatorPopupProps) {
  const [display, setDisplay] = useState("0");
  const [pending, setPending] = useState<PendingOp | null>(null);
  const [resetNext, setResetNext] = useState(false);

  const inputDigit = useCallback((digit: string) => {
    setDisplay((prev) => {
      const clean = sanitizeInput(prev);
      if (resetNext) {
        setResetNext(false);
        return digit === "." ? "0." : digit;
      }
      if (digit === "." && clean.includes(".")) return prev;
      if (clean === "0" && digit !== ".") return digit;
      if (clean.length >= 14) return prev;
      return clean + digit;
    });
  }, [resetNext]);

  const clearAll = () => {
    setDisplay("0");
    setPending(null);
    setResetNext(false);
  };

  const clearEntry = () => setDisplay("0");

  const applyOperator = (operator: string) => {
    const current = Number(sanitizeInput(display));
    if (Number.isNaN(current)) {
      setDisplay("Error");
      return;
    }

    if (pending && !resetNext) {
      const result = compute(pending.value, current, pending.operator);
      if (result == null) {
        setDisplay("Error");
        setPending(null);
        return;
      }
      setDisplay(String(result));
      setPending({ value: result, operator });
    } else {
      setPending({ value: current, operator });
    }
    setResetNext(true);
  };

  const equals = () => {
    if (!pending) return;
    const current = Number(sanitizeInput(display));
    if (Number.isNaN(current)) {
      setDisplay("Error");
      return;
    }
    const result = compute(pending.value, current, pending.operator);
    if (result == null) {
      setDisplay("Error");
      setPending(null);
      return;
    }
    setDisplay(String(result));
    setPending(null);
    setResetNext(true);
  };

  const toggleSign = () => {
    setDisplay((prev) => {
      const clean = sanitizeInput(prev);
      if (clean === "0" || clean === "Error") return prev;
      return clean.startsWith("-") ? clean.slice(1) : `-${clean}`;
    });
  };

  const percent = () => {
    setDisplay((prev) => {
      const n = Number(sanitizeInput(prev));
      if (Number.isNaN(n)) return "Error";
      return String(n / 100);
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (/^\d$/.test(e.key)) inputDigit(e.key);
      if (e.key === ".") inputDigit(".");
      if (e.key === "+") applyOperator("+");
      if (e.key === "-") applyOperator("-");
      if (e.key === "*") applyOperator("×");
      if (e.key === "/") applyOperator("÷");
      if (e.key === "Enter" || e.key === "=") equals();
      if (e.key === "Backspace") {
        setDisplay((prev) => {
          const clean = sanitizeInput(prev);
          if (clean.length <= 1 || clean === "Error") return "0";
          return clean.slice(0, -1);
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [equals, inputDigit, onClose, applyOperator]);

  const buttons: Array<{ label: string; className?: string; action: () => void }> = [
    { label: "C", className: "bg-slate-100 text-slate-700", action: clearAll },
    { label: "CE", className: "bg-slate-100 text-slate-700", action: clearEntry },
    { label: "%", className: "bg-slate-100 text-slate-700", action: percent },
    { label: "÷", className: "bg-blue-50 text-blue-700", action: () => applyOperator("÷") },
    { label: "7", action: () => inputDigit("7") },
    { label: "8", action: () => inputDigit("8") },
    { label: "9", action: () => inputDigit("9") },
    { label: "×", className: "bg-blue-50 text-blue-700", action: () => applyOperator("×") },
    { label: "4", action: () => inputDigit("4") },
    { label: "5", action: () => inputDigit("5") },
    { label: "6", action: () => inputDigit("6") },
    { label: "-", className: "bg-blue-50 text-blue-700", action: () => applyOperator("-") },
    { label: "1", action: () => inputDigit("1") },
    { label: "2", action: () => inputDigit("2") },
    { label: "3", action: () => inputDigit("3") },
    { label: "+", className: "bg-blue-50 text-blue-700", action: () => applyOperator("+") },
    { label: "+/−", className: "bg-slate-100 text-slate-700", action: toggleSign },
    { label: "0", action: () => inputDigit("0") },
    { label: ".", action: () => inputDigit(".") },
    { label: "=", className: "bg-primary text-white hover:bg-primary-600", action: equals },
  ];

  return (
    <div
      className="fixed bottom-24 right-6 z-[160] w-[260px] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Calculator"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/80">
        <span className="text-xs font-semibold text-slate-700">Calculator</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          aria-label="Close calculator"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 pt-3 pb-2">
        {pending && (
          <p className="text-[10px] text-slate-400 text-right font-mono mb-0.5">
            {formatDisplay(String(pending.value))} {pending.operator}
          </p>
        )}
        <div className="text-right text-2xl font-semibold font-mono text-slate-900 truncate min-h-[32px]">
          {formatDisplay(display)}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 p-3 pt-1">
        {buttons.map((btn) => (
          <button
            key={btn.label}
            type="button"
            onClick={btn.action}
            className={cn(
              "h-10 rounded-lg text-sm font-semibold transition-colors",
              btn.className ?? "bg-white border border-slate-200 text-slate-800 hover:bg-slate-50",
              btn.label === "0" && "col-span-1",
            )}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function compute(a: number, b: number, operator: string): number | null {
  switch (operator) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? null : a / b;
    default:
      return null;
  }
}
