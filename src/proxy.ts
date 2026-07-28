import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getAuthCookieOptions } from "@/lib/supabase/auth-cookie";
import { hasSupabaseEnv, requireSupabaseEnv } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  if (
    !hasSupabaseEnv() ||
    process.env.NEXT_PUBLIC_E2E_MODE === "1"
  ) {
    return NextResponse.next({ request });
  }

  const { url, key } = requireSupabaseEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookieOptions: getAuthCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headersToSet ?? {}).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|swe-worker).*)",
  ],
};
