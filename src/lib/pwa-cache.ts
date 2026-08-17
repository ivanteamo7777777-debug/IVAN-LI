interface NavigationResponse {
  status: number;
  redirected: boolean;
  url: string;
  headers?: {
    get(name: string): string | null;
  };
}

export const AUTHENTICATED_NETWORK_TIMEOUT_SECONDS = 2;

const authenticatedPaths = new Set([
  "/today",
  "/directions",
  "/plans",
  "/accumulations",
  "/reviews",
  "/settings",
]);

export function isAuthenticatedAppPath(pathname: string) {
  return authenticatedPaths.has(pathname);
}

export function shouldCacheAuthenticatedNavigation(
  response: NavigationResponse,
) {
  if (response.status !== 200 || response.redirected) return false;
  if (response.headers?.get("x-nextjs-redirect")) return false;
  const cacheControl = response.headers?.get("cache-control")?.toLowerCase();
  if (cacheControl?.includes("private") || cacheControl?.includes("no-store")) {
    return false;
  }
  if (!response.url) return false;

  const pathname = new URL(response.url, "https://shouzhong.invalid").pathname;
  return !pathname.startsWith("/auth/") && pathname !== "/setup";
}
