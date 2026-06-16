/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        primary: {
          DEFAULT: "#0F4C81",
          50:  "#EBF2FA",
          100: "#C8DCF2",
          200: "#92BAE5",
          300: "#5C97D8",
          400: "#2E75CB",
          500: "#0F4C81",
          600: "#0C3E6A",
          700: "#093054",
          800: "#06223D",
          900: "#031427",
        },
        background: "#F5F7FA",
        card: "#FFFFFF",
        border: "#E5E7EB",
        "text-primary": "#111827",
        "text-secondary": "#6B7280",
        success: { DEFAULT: "#15803D", light: "#DCFCE7" },
        warning: { DEFAULT: "#D97706", light: "#FEF3C7" },
        danger:  { DEFAULT: "#DC2626", light: "#FEE2E2" },
        info:    { DEFAULT: "#0284C7", light: "#E0F2FE" },
      },
      fontSize: {
        "page-title":    ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "section-title": ["16px", { lineHeight: "24px", fontWeight: "500" }],
        body:            ["14px", { lineHeight: "20px" }],
        table:           ["13px", { lineHeight: "18px" }],
        caption:         ["12px", { lineHeight: "16px" }],
      },
      spacing: {
        sidebar:           "260px",
        "sidebar-collapsed": "72px",
        navbar:            "64px",
      },
      boxShadow: {
        card:    "0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.05)",
        "card-hover": "0 4px 12px 0 rgb(0 0 0 / 0.10), 0 2px 4px -1px rgb(0 0 0 / 0.06)",
        sidebar: "2px 0 8px 0 rgb(0 0 0 / 0.06)",
      },
      transitionDuration: {
        DEFAULT: "150ms",
        fast: "100ms",
        slow: "200ms",
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-8px)", opacity: "0" },
          to:   { transform: "translateX(0)",    opacity: "1" },
        },
      },
      animation: {
        "fade-in":       "fade-in 150ms ease-out",
        "slide-in-left": "slide-in-left 150ms ease-out",
      },
    },
  },
  plugins: [],
};
