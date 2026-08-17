// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  getAuthCookieOptions,
} from "@/lib/supabase/auth-cookie";
import {
  isAuthenticatedAppPath,
  shouldCacheAuthenticatedNavigation,
} from "@/lib/pwa-cache";

describe("persistent PWA authentication", () => {
  it("uses a long-lived secure production cookie across the whole app", () => {
    expect(getAuthCookieOptions(true)).toEqual({
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: true,
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    });
    expect(AUTH_COOKIE_MAX_AGE_SECONDS).toBeGreaterThan(365 * 24 * 60 * 60);
  });

  it("never stores an authentication redirect as the offline app shell", () => {
    expect(
      shouldCacheAuthenticatedNavigation({
        status: 200,
        redirected: true,
        url: "https://shouzhong-daily.vercel.app/auth/login",
      }),
    ).toBe(false);
    expect(
      shouldCacheAuthenticatedNavigation({
        status: 200,
        redirected: false,
        url: "https://shouzhong-daily.vercel.app/auth/login",
      }),
    ).toBe(false);
    expect(
      shouldCacheAuthenticatedNavigation({
        status: 200,
        redirected: false,
        url: "https://shouzhong-daily.vercel.app/plans?_rsc=abc",
        headers: {
          get: (name) => (name === "x-nextjs-redirect" ? "/auth/login" : null),
        },
      }),
    ).toBe(false);
    for (const cacheControl of [
      "private, no-cache, no-store, must-revalidate",
      "public, max-age=0, no-store",
    ]) {
      expect(
        shouldCacheAuthenticatedNavigation({
          status: 200,
          redirected: false,
          url: "https://shouzhong-daily.vercel.app/today",
          headers: {
            get: (name) =>
              name.toLowerCase() === "cache-control" ? cacheControl : null,
          },
        }),
      ).toBe(false);
    }
    expect(
      shouldCacheAuthenticatedNavigation({
        status: 200,
        redirected: false,
        url: "https://shouzhong-daily.vercel.app/today",
      }),
    ).toBe(true);
    expect(isAuthenticatedAppPath("/today")).toBe(true);
    expect(isAuthenticatedAppPath("/auth/login")).toBe(false);
  });
});
