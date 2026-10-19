import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type PlanetClient = SupabaseClient<any, "planet", "planet">;

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();

/** 讀取用（anon key，只能讀目錄表與 event_seats） */
export function readClient(): PlanetClient | null {
  const u = url();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!u || !key) return null;
  return createClient<any, "planet", "planet">(u, key, {
    db: { schema: "planet" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 寫入用（service role，只在 server 端） */
export function adminClient(): PlanetClient | null {
  const u = url();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!u || !key) return null;
  return createClient<any, "planet", "planet">(u, key, {
    db: { schema: "planet" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
