import { useEffect, useState } from "react";
import { Calculator, LayoutGrid, X, Percent, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { CalculatorPopup } from "./CalculatorPopup";

type ToolId = "calculator";

type UtilityTool =
  | {
      id: ToolId;
      label: string;
      description: string;
      icon: typeof Calculator;
      available: true;
    }
  | {
      label: string;
      description: string;
      icon: typeof Calculator;
      available: false;
    };

const TOOLS: UtilityTool[] = [
  {
    id: "calculator",
    label: "Calculator",
    description: "Quick bills & totals",
    icon: Calculator,
    available: true,
  },
  {
    label: "GST Helper",
    description: "Coming soon",
    icon: Percent,
    available: false,
  },
  {
    label: "Stopwatch",
    description: "Coming soon",
    icon: Clock,
    available: false,
  },
];

export function UtilitiesLauncher() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);

  useEffect(() => {
    if (!menuOpen && !activeTool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setActiveTool(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, activeTool]);

  const openTool = (tool: UtilityTool) => {
    if (!tool.available) return;
    setActiveTool(tool.id);
    setMenuOpen(false);
  };

  return (
    <>
      {(menuOpen || activeTool) && (
        <div
          className="fixed inset-0 z-[150]"
          aria-hidden="true"
          onClick={() => {
            setMenuOpen(false);
            setActiveTool(null);
          }}
        />
      )}

      {activeTool === "calculator" && (
        <CalculatorPopup onClose={() => setActiveTool(null)} />
      )}

      {menuOpen && (
        <div
          className="fixed bottom-24 right-6 z-[155] w-[220px] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200"
          onClick={(e) => e.stopPropagation()}
          role="menu"
          aria-label="Utilities"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100 bg-slate-50/80">
            <span className="text-xs font-semibold text-slate-700">Utilities</span>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
              aria-label="Close utilities menu"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="p-1.5">
            {TOOLS.map((tool, index) => {
              const Icon = tool.icon;
              return (
                <li key={`${tool.label}-${index}`}>
                  <button
                    type="button"
                    disabled={!tool.available}
                    onClick={() => openTool(tool)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors",
                      tool.available
                        ? "hover:bg-primary/5 text-slate-800"
                        : "opacity-45 cursor-not-allowed text-slate-500",
                    )}
                  >
                    <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">{tool.label}</span>
                      <span className="block text-[10px] text-slate-500 truncate">{tool.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setMenuOpen((open) => !open);
          if (menuOpen) setActiveTool(null);
        }}
        className={cn(
          "fixed bottom-6 right-6 z-[155] w-12 h-12 rounded-full shadow-lg border-2 border-white",
          "bg-primary text-white flex items-center justify-center",
          "hover:bg-primary-600 active:scale-95 transition-all duration-150",
          menuOpen && "ring-2 ring-primary/30",
        )}
        aria-label={menuOpen ? "Close utilities" : "Open utilities"}
        title="Utilities"
      >
        {menuOpen ? <X className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
      </button>
    </>
  );
}
