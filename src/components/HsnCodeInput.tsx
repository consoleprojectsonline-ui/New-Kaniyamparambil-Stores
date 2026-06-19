import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildHsnCodeSet,
  filterHsnSuggestions,
  hsnFormatError,
  isKnownHsnCode,
  normalizeHsnCode,
  type HsnCodeRecord,
} from "@/lib/hsn";

type HsnCodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  registry: HsnCodeRecord[];
  registryLoaded?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  /** Inventory only — allow typing a new code not yet in the master list. */
  allowCreate?: boolean;
};

export function HsnCodeInput({
  value,
  onChange,
  registry,
  registryLoaded = false,
  className = "",
  placeholder = "Select HSN…",
  disabled = false,
  compact = false,
  allowCreate = false,
}: HsnCodeInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const normalized = normalizeHsnCode(value);
  const codeSet = useMemo(() => buildHsnCodeSet(registry), [registry]);
  const selected = registry.find((r) => normalizeHsnCode(r.code) === normalized);

  const filtered = useMemo(
    () => filterHsnSuggestions(registry, search, 80),
    [registry, search],
  );

  const searchNormalized = normalizeHsnCode(search);
  const searchFormatErr = searchNormalized ? hsnFormatError(searchNormalized) : null;
  const canCreateNew = allowCreate
    && !!searchNormalized
    && !searchFormatErr
    && !isKnownHsnCode(searchNormalized, codeSet);

  const formatErr = normalized ? hsnFormatError(normalized) : null;
  const isNewCode = allowCreate
    && normalized
    && !formatErr
    && registryLoaded
    && codeSet.size > 0
    && !isKnownHsnCode(normalized, codeSet);
  const unknown = !allowCreate
    && registryLoaded
    && codeSet.size > 0
    && normalized
    && !formatErr
    && !isKnownHsnCode(normalized, codeSet);

  const borderClass = !normalized
    ? "border-slate-300"
    : formatErr || unknown
      ? "border-red-400 bg-red-50/40 focus:ring-red-500/20 focus:border-red-500"
      : isNewCode
        ? "border-amber-400 bg-amber-50/40 focus:ring-amber-500/20 focus:border-amber-500"
        : "border-emerald-300 bg-emerald-50/30 focus:ring-emerald-500/20 focus:border-emerald-500";

  const listCount = filtered.length + (canCreateNew ? 1 : 0);

  const openDropdown = () => {
    if (disabled) return;
    if (!allowCreate && !registry.length) return;
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropH = Math.min(300, listCount * 44 + 56);
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
      setDropdownStyle({ top, left: rect.left, width: Math.max(rect.width, 240) });
    }
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const recalc = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const dropH = Math.min(300, listCount * 44 + 56);
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
        setDropdownStyle({ top, left: rect.left, width: Math.max(rect.width, 240) });
      }
    };
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [isOpen, listCount]);

  const closeDropdown = () => {
    setIsOpen(false);
    setSearch("");
  };

  const applyNewCode = (code: string) => {
    onChange(normalizeHsnCode(code));
    closeDropdown();
  };

  const triggerLabel = selected
    ? `${selected.code}${selected.description ? ` — ${selected.description}` : ""}`
    : normalized
      ? isNewCode
        ? `${normalized} — new (saved on register)`
        : unknown
          ? `${normalized} (not in master)`
          : normalized
      : placeholder;

  const py = compact ? "py-1 px-2" : "py-1.5 px-3";
  const triggerDisabled = disabled || (!allowCreate && !registry.length);

  return (
    <div className={`relative w-full text-left font-sans ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={triggerDisabled}
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        title={
          !registry.length && !allowCreate
            ? "HSN master list not loaded — run sql/14_hsn_codes.sql in Supabase"
            : formatErr ?? (unknown ? "Pick a code from the HSN master list" : isNewCode ? "New HSN — will be added to master on save" : undefined)
        }
        className={`w-full flex items-center justify-between bg-white text-xs border rounded ${py} focus:outline-none focus:ring-2 transition-all text-slate-800 font-medium ${borderClass} ${triggerDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <span className={`truncate ${compact ? "font-mono text-[11px]" : ""}`}>{triggerLabel}</span>
        <span className="ml-1 shrink-0 text-slate-400 text-[9px]">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && dropdownStyle && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={closeDropdown} />
          <div
            className="fixed z-[70] bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden"
            style={{
              top: dropdownStyle.top,
              left: dropdownStyle.left,
              width: dropdownStyle.width,
              maxHeight: "300px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="p-2 border-b border-slate-100 bg-white shrink-0">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreateNew) {
                    e.preventDefault();
                    applyNewCode(searchNormalized);
                  }
                }}
                placeholder={
                  allowCreate
                    ? "Search or type a new 4–8 digit HSN…"
                    : "Search HSN code or description…"
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 font-sans"
              />
            </div>
            <ul className="overflow-y-auto py-1 flex-1">
              {canCreateNew && (
                <li
                  onClick={() => applyNewCode(searchNormalized)}
                  className="px-3 py-2 text-xs cursor-pointer bg-amber-50 hover:bg-amber-100 text-amber-900 border-b border-amber-100 transition-colors"
                >
                  <div className="font-semibold">+ Add new HSN: {searchNormalized}</div>
                  <div className="text-[10px] text-amber-700 mt-0.5">
                    Not in master list — will be saved to Supabase when you register this item
                  </div>
                </li>
              )}
              {filtered.length === 0 && !canCreateNew ? (
                <li className="px-3 py-2 text-xs text-slate-500 text-center">
                  {allowCreate && searchFormatErr
                    ? searchFormatErr
                    : allowCreate
                      ? "Type a 4–8 digit HSN code to add a new one"
                      : "No HSN codes found"}
                </li>
              ) : (
                filtered.map((row) => {
                  const code = normalizeHsnCode(row.code);
                  const isSelected = code === normalized;
                  return (
                    <li
                      key={code}
                      onClick={() => {
                        onChange(code);
                        closeDropdown();
                      }}
                      className={`px-3 py-2 text-xs cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors border-b border-slate-50 last:border-0 ${
                        isSelected ? "bg-blue-100/50 text-blue-800 font-semibold" : "text-slate-700"
                      }`}
                    >
                      <div className="font-mono font-semibold">{code}</div>
                      {row.description ? (
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">{row.description}</div>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
