import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ShieldCheck, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

// ─── Geometric SVG Background Pattern ─────────────────────────────────────────
function GeometricPattern() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.07]"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="geo-grid"
          x="0"
          y="0"
          width="60"
          height="60"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 60 0 L 0 0 0 60"
            fill="none"
            stroke="white"
            strokeWidth="0.8"
          />
        </pattern>
        <pattern
          id="geo-dots"
          x="0"
          y="0"
          width="60"
          height="60"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="30" cy="30" r="1.5" fill="white" opacity="0.6" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#geo-grid)" />
      <rect width="100%" height="100%" fill="url(#geo-dots)" />

      {/* Large geometric accent shapes */}
      <circle
        cx="15%"
        cy="20%"
        r="120"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
        opacity="0.4"
      />
      <circle
        cx="15%"
        cy="20%"
        r="200"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
        opacity="0.2"
      />
      <circle
        cx="85%"
        cy="75%"
        r="150"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
        opacity="0.3"
      />
      <circle
        cx="85%"
        cy="75%"
        r="240"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
        opacity="0.15"
      />

      {/* Diagonal accent lines */}
      <line
        x1="0"
        y1="60%"
        x2="40%"
        y2="100%"
        stroke="white"
        strokeWidth="0.6"
        opacity="0.3"
      />
      <line
        x1="60%"
        y1="0"
        x2="100%"
        y2="40%"
        stroke="white"
        strokeWidth="0.6"
        opacity="0.3"
      />

      {/* Hex-like polygon accent */}
      <polygon
        points="70,35 90,15 110,35 110,65 90,85 70,65"
        fill="none"
        stroke="white"
        strokeWidth="0.6"
        opacity="0.25"
        transform="translate(30, 200) scale(3)"
      />
      <polygon
        points="70,35 90,15 110,35 110,65 90,85 70,65"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
        opacity="0.15"
        transform="translate(280, 450) scale(5)"
      />
    </svg>
  );
}

// ─── Stats Row on Brand Panel ──────────────────────────────────────────────────
function BrandStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-blue-200 mt-0.5 font-medium">{label}</div>
    </div>
  );
}

// ─── Main Login Page ───────────────────────────────────────────────────────────
export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail]       = useState("");
  const [password, setPassword]   = useState("");
  const [showPw,   setShowPw]     = useState(false);
  const [remember, setRemember]   = useState(false);
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (data?.session) {
        navigate("/app/dashboard");
      } else {
        setError("Unable to authenticate. Please check your credentials.");
        setLoading(false);
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };


  return (
    <div className="flex w-full h-screen overflow-hidden">
      {/* ── LEFT PANEL: Branding ─────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between relative overflow-hidden"
        style={{
          width: "58%",
          background: "linear-gradient(145deg, #0A3560 0%, #0F4C81 45%, #1565A8 100%)",
        }}
      >
        <GeometricPattern />

        {/* Top — Logo + Brand */}
        <div className="relative z-10 p-12">
          {/* Logo mark */}
          <div className="flex items-center gap-3 mb-16">
            <div
              className="w-10 h-10 rounded flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)" }}
            >
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="text-white text-sm font-semibold tracking-wider uppercase opacity-90">
              Enterprise Edition
            </span>
          </div>

          {/* Main headline */}
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight mb-3">
              New Kaniyamparambil
              <br />
              <span style={{ color: "#7ABFFF" }}>Stores</span>
            </h1>
            <p className="text-blue-200 text-base font-medium mt-4 max-w-xs leading-relaxed">
              Integrated billing, inventory management, and financial reporting — built for enterprise-grade retail operations.
            </p>
          </div>
        </div>

        {/* Middle — Feature list */}
        <div className="relative z-10 px-12 py-8">
          <div className="space-y-4">
            {[
              { title: "GST-Compliant Invoicing",     desc: "B2B & B2C invoices with auto GST computation" },
              { title: "Real-Time Inventory Control",  desc: "Stock tracking with low-stock alerts" },
              { title: "Financial Analytics",          desc: "Revenue, margins, and payment dashboards" },
              { title: "Multi-Payment Processing",     desc: "Cash, UPI, card, and credit support" },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div
                  className="mt-0.5 w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
                  style={{ background: "rgba(122, 191, 255, 0.2)", border: "1px solid rgba(122, 191, 255, 0.4)" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-300" />
                </div>
                <div>
                  <div className="text-white text-sm font-semibold">{f.title}</div>
                  <div className="text-blue-300 text-xs mt-0.5">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom — Stats bar */}
        <div
          className="relative z-10 mx-8 mb-10 p-5 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="grid grid-cols-3 divide-x divide-white/20">
            <BrandStat value="₹2.4Cr+" label="Monthly Volume" />
            <BrandStat value="12,500+"  label="Invoices / Month" />
            <BrandStat value="99.9%"    label="Uptime SLA" />
          </div>
        </div>

        {/* Footer note */}
        <div className="relative z-10 px-12 pb-6">
          <p className="text-blue-300 text-xs">
            © 2026 New Kaniyamparambil Stores · All rights reserved
          </p>
        </div>
      </div>

      {/* ── RIGHT PANEL: Login Form ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-background px-6">
        {/* Mobile logo (hidden on large screens) */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <span className="text-base font-semibold text-text-primary">
            New Kaniyamparambil Stores
          </span>
        </div>

        {/* Card */}
        <div
          className="w-full bg-white border border-border rounded-lg shadow-card animate-fade-in"
          style={{ maxWidth: "420px" }}
        >
          {/* Card header */}
          <div className="px-8 pt-8 pb-6 border-b border-border">
            <h2 className="text-lg font-semibold text-text-primary">Sign in to your account</h2>
            <p className="text-sm text-text-secondary mt-1">
              Enter your credentials to access the billing system
            </p>
          </div>

          {/* Form body */}
          <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5">
            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2.5 p-3 bg-danger-light border border-red-200 rounded text-sm text-danger animate-fade-in">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Email field */}
            <div>
              <label htmlFor="email" className="form-label">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-enterprise"
                placeholder="Enter your email"
                autoComplete="email"
                autoFocus
                disabled={loading}
              />
            </div>

            {/* Password field */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" className="form-label mb-0">
                  Password
                </label>
                <button
                  type="button"
                  className="text-caption text-primary hover:text-primary-600 font-medium transition-colors duration-150"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-enterprise pr-10"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors duration-150"
                  tabIndex={-1}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2.5">
              <input
                id="remember"
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border text-primary accent-primary cursor-pointer"
              />
              <label
                htmlFor="remember"
                className="text-sm text-text-secondary cursor-pointer select-none"
              >
                Remember me on this device
              </label>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              className={cn(
                "btn-primary w-full h-10 text-sm font-semibold tracking-wide",
                loading && "opacity-75 cursor-not-allowed"
              )}
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Signing in…
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Card footer */}
          <div className="px-8 pb-7 flex items-center justify-between">
            <p className="text-caption text-text-secondary">
              Don't have an account?{" "}
              <Link
                to="/register"
                className="text-primary font-medium hover:text-primary-600 transition-colors duration-150"
              >
                Register
              </Link>
            </p>
            <div className="flex items-center gap-1.5 text-caption text-text-secondary">
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              System Online
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-caption text-text-secondary text-center">
          <span>Secured by enterprise-grade encryption · </span>
          <a href="#" className="hover:text-text-primary transition-colors duration-150">
            Privacy Policy
          </a>
          <span> · </span>
          <a href="#" className="hover:text-text-primary transition-colors duration-150">
            Terms of Service
          </a>
        </div>
      </div>
    </div>
  );
}
