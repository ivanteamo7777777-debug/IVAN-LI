import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getAuthCookieOptions } from "@/lib/supabase/auth-cookie";
import { hasSupabaseEnv, requireSupabaseEnv } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  if (!hasSupabaseEnv() || process.env.NEXT_PUBLIC_E2E_MODE === "1") {
    return NextResponse.next({ request });
  }

  if (
    request.headers.get("RSC") === "1" ||
    request.nextUrl.searchParams.has("_rsc")
  ) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-shouzhong-user-id");
    requestHeaders.delete("x-shouzhong-user-email");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const { url, key } = requireSupabaseEnv();
  const pendingCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];
  const responseHeaders = new Headers();
  const supabase = createServerClient(url, key, {
    cookieOptions: getAuthCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(nextCookies, headersToSet) {
        nextCookies.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        pendingCookies.push(...nextCookies);
        Object.entries(headersToSet ?? {}).forEach(([name, value]) =>
          responseHeaders.set(name, value),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  let response: NextResponse;
  if (typeof data?.claims?.sub !== "string" || !data.claims.sub) {
    const loginUrl = request.nextUrl.clone();
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    loginUrl.pathname = "/auth/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", nextPath);
    response = NextResponse.redirect(loginUrl);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  } else {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-shouzhong-user-id");
    requestHeaders.delete("x-shouzhong-user-email");
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  pendingCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );
  responseHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
}

export const config = {
  matcher: [
    "/today/:path*",
    "/directions/:path*",
    "/plans/:path*",
    "/accumulations/:path*",
    "/reviews/:path*",
    "/settings/:path*",
  ],
};
