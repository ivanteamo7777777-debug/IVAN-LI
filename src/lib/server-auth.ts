import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  if (process.env.NEXT_PUBLIC_E2E_MODE === "1") {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      email: "e2e@local.test",
    };
  }
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHORIZED");
  return user;
}
