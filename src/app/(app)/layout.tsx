import { redirect } from "next/navigation";
import { ClientAppBoundary } from "@/components/client-app-boundary";
import { isLocalE2EMode } from "@/lib/e2e-mode";
import { hasSupabaseEnv } from "@/lib/supabase/config";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const localOnly = isLocalE2EMode();
  if (!localOnly && !hasSupabaseEnv()) redirect("/setup");

  return (
    <ClientAppBoundary localOnly={localOnly}>{children}</ClientAppBoundary>
  );
}
