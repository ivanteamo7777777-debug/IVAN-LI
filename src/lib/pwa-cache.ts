interface NavigationResponse {
  status: number;
  redirected: boolean;
  url: string;
}

export function shouldCacheAuthenticatedNavigation(
  response: NavigationResponse,
) {
  if (response.status !== 200 || response.redirected) return false;
  if (!response.url) return false;

  const pathname = new URL(response.url, "https://shouzhong.invalid").pathname;
  return !pathname.startsWith("/auth/") && pathname !== "/setup";
}
