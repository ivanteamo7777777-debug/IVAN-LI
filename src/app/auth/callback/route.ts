import { type NextRequest, NextResponse } from "next/server";
import { createRouteClient } from "@/lib/supabase/route";
import { safeInternalPath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeInternalPath(url.searchParams.get("next"));
  if (code) {
    const response = NextResponse.redirect(new URL(next, url.origin));
    const supabase = createRouteClient(request, response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }
  const response = NextResponse.redirect(
    new URL("/auth/login?error=callback", url.origin),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
