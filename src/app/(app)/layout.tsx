import { redirect } from "next/navigation";
import { ClientAppBoundary } from "@/components/client-app-boundary";
import { hasSupabaseEnv } from "@/lib/supabase/config";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const localOnly = process.env.NEXT_PUBLIC_E2E_MODE === "1";
  if (!localOnly && !hasSupabaseEnv()) redirect("/setup");

  return (
    <ClientAppBoundary localOnly={localOnly}>{children}</ClientAppBoundary>
  );
}
