// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  getAuthCookieOptions,
} from "@/lib/supabase/auth-cookie";
import { shouldCacheAuthenticatedNavigation } from "@/lib/pwa-cache";

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
        url: "https://shouzhong-daily.vercel.app/today",
      }),
    ).toBe(true);
  });
});
