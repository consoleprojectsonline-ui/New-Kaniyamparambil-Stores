import { useEffect, useState } from "react";
import { AlertTriangle, Check, Edit3, Loader2, Send, X } from "lucide-react";
import {
  formatPhoneDisplay,
  isValidWhatsAppPhone,
  sendPdfViaWhatsApp,
} from "@/lib/whatsappShare";

export interface WhatsAppShareConfig {
  recipientLabel: string;
  recipientName: string;
  initialPhone?: string;
  documentTitle: string;
  defaultMessage: string;
  generatePdf: () => Promise<{ blob: Blob; filename: string }>;
}

interface WhatsAppShareModalProps {
  config: WhatsAppShareConfig | null;
  onClose: () => void;
}

export function WhatsAppShareModal({ config, onClose }: WhatsAppShareModalProps) {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    const initial = config.initialPhone?.trim() ?? "";
    setPhone(initial);
    setMessage(config.defaultMessage);
    setIsEditingPhone(!initial);
    setError(null);
    setSuccess(null);
    setBusy(false);
  }, [config]);

  if (!config) return null;

  const hasSavedPhone = Boolean(config.initialPhone?.trim());
  const phoneValid = isValidWhatsAppPhone(phone);
  const showPhoneReadOnly = hasSavedPhone && !isEditingPhone;

  const handleSend = async () => {
    if (!phoneValid) {
      setError("Enter a valid 10-digit mobile number (with optional +91).");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const { blob, filename } = await config.generatePdf();
      const result = await sendPdfViaWhatsApp({
        phone,
        message: message.trim() || config.defaultMessage,
        pdfBlob: blob,
        filename,
      });

      setSuccess(
        result === "shared"
          ? "PDF shared via WhatsApp."
          : "WhatsApp opened — attach the downloaded PDF if it was not added automatically.",
      );
      window.setTimeout(() => onClose(), 1800);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Could not send via WhatsApp.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-md w-full z-10 flex flex-col font-sans animate-in fade-in zoom-in-95 duration-150">
        <div className="bg-[#25D366] px-5 py-4 text-white rounded-t-xl flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold tracking-tight">Send via WhatsApp</h2>
            <p className="text-[10px] text-green-100 mt-0.5">{config.documentTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-green-100 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
              <Check className="w-4 h-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              {config.recipientLabel}
            </span>
            <p className="text-sm font-semibold text-slate-900">{config.recipientName}</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="form-label text-xs mb-0">WhatsApp Number</label>
              {hasSavedPhone && (
                <button
                  type="button"
                  onClick={() => setIsEditingPhone((prev) => !prev)}
                  className="text-[10px] font-semibold text-green-700 hover:text-green-800 flex items-center gap-1"
                >
                  <Edit3 className="w-3 h-3" />
                  {isEditingPhone ? "Use saved" : "Edit"}
                </button>
              )}
            </div>

            {showPhoneReadOnly ? (
              <div className="input-enterprise bg-slate-50 text-sm font-mono flex items-center justify-between">
                <span>{formatPhoneDisplay(phone)}</span>
                <span className="text-[10px] text-green-700 font-semibold">Saved</span>
              </div>
            ) : (
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile number"
                className="input-enterprise font-mono text-sm"
                autoFocus
              />
            )}

            {!phone.trim() && (
              <p className="text-[10px] text-amber-700 mt-1.5">
                No number on file — enter the {config.recipientLabel.toLowerCase()}&apos;s WhatsApp number.
              </p>
            )}
          </div>

          <div>
            <label className="form-label text-xs">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="input-enterprise text-xs resize-none"
            />
          </div>

          <p className="text-[10px] text-slate-500 leading-relaxed">
            On mobile, the PDF is shared directly when supported. On desktop, the PDF downloads and WhatsApp Web opens so you can attach it.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button type="button" onClick={onClose} className="btn-secondary px-4 text-xs" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={busy || !phoneValid}
            className="btn-primary bg-[#25D366] hover:bg-[#1da851] active:bg-[#128C3E] px-4 text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {busy ? "Preparing PDF…" : "Send on WhatsApp"}
          </button>
        </div>
      </div>
    </div>
  );
}
