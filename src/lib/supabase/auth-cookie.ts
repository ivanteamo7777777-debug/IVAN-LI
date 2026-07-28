import type { CookieOptionsWithName } from "@supabase/ssr";

export const AUTH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function getAuthCookieOptions(
  production = process.env.NODE_ENV === "production",
): CookieOptionsWithName {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: production,
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  };
}
