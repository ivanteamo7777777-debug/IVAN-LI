"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/supabase/config";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  const { url, key } = requireSupabaseEnv();
  browserClient ??= createBrowserClient(url, key);
  return browserClient;
}
