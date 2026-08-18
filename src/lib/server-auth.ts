import { isLocalE2EMode } from "@/lib/e2e-mode";
import { createClient } from "@/lib/supabase/server";

export async function requireUser(request?: Request) {
  if (isLocalE2EMode(request)) {
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
