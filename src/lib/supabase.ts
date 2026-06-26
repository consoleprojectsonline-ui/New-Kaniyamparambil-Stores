import { createClient } from "@supabase/supabase-js";

/**
 * Public Supabase project credentials (anon key is client-safe; access is enforced by RLS).
 * VITE_* env vars override these when set (local .env or host build settings).
 */
const DEFAULT_SUPABASE_URL = "https://eifwjfpvffziwydmxcol.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpZndqZnB2ZmZ6aXd5ZG14Y29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MTU1MzgsImV4cCI6MjA5NzE5MTUzOH0.g_EgGb-ennaOOw91njbDaYasstl-TS_Qr36EpCNmfik";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    import.meta.env.PROD
      ? "Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your host environment variables, then redeploy."
      : "Missing Supabase configuration. Copy .env.example to .env and add your Supabase URL and anon key.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
