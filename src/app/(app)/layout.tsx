import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SyncProvider } from "@/components/sync-provider";
import { hasSupabaseEnv } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const localOnly = process.env.NEXT_PUBLIC_E2E_MODE === "1";
  let user = localOnly
    ? { id: "00000000-0000-4000-8000-000000000001", email: "e2e@local.test" }
    : null;

  if (!localOnly) {
    if (!hasSupabaseEnv()) redirect("/setup");
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) redirect("/auth/login?next=/today");
    user = {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : "个人管理库",
    };
  }

  const resolvedUser = user!;
  return (
    <SyncProvider userId={resolvedUser.id} localOnly={localOnly}>
      <AppShell email={resolvedUser.email}>{children}</AppShell>
    </SyncProvider>
  );
}
