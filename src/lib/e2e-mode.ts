import type { NextRequest } from "next/server";

const LOCAL_E2E_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * E2E bypasses are server-only and are never allowed on Vercel. Request
 * handlers must additionally prove that the request targets a loopback host.
 */
export function isLocalE2EMode(request?: Request | NextRequest) {
  if (
    typeof window !== "undefined" ||
    process.env.SHOUZHONG_E2E_MODE !== "1" ||
    process.env.VERCEL === "1"
  ) {
    return false;
  }

  if (!request) return true;

  try {
    const urlHostname = new URL(request.url).hostname.toLowerCase();
    if (!LOCAL_E2E_HOSTNAMES.has(urlHostname)) return false;

    const hostHeader = request.headers.get("host");
    if (!hostHeader) return true;
    const headerHostname = new URL(
      `http://${hostHeader}`,
    ).hostname.toLowerCase();
    return LOCAL_E2E_HOSTNAMES.has(headerHostname);
  } catch {
    return false;
  }
}
