export const THEME_COOKIE_NAME = "shouzhong-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_COLORS = {
  light: "#f7f5ef",
  dark: "#121713",
} as const;

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";

export function isThemePreference(
  value: string | null | undefined,
): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemePreferenceFromCookie(
  cookieHeader: string,
): ThemePreference {
  const stored = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${THEME_COOKIE_NAME}=`))
    ?.slice(THEME_COOKIE_NAME.length + 1);

  return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function applyThemeToDocument(
  targetDocument: Document,
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark);
  const root = targetDocument.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;

  const themeColor = targetDocument.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (themeColor) themeColor.content = THEME_COLORS[resolved];

  const statusBar = targetDocument.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-status-bar-style"]',
  );
  if (statusBar) statusBar.content = resolved === "dark" ? "black" : "default";

  return resolved;
}

// Runs in <head> before the page paints, so a saved dark preference does not
// briefly flash the light palette when the PWA is opened.
export const THEME_BOOTSTRAP_SCRIPT = `(()=>{try{const n="${THEME_COOKIE_NAME}=",v=document.cookie.split(";").map(s=>s.trim()).find(s=>s.startsWith(n))?.slice(n.length),p=v==="dark"||v==="system"||v==="light"?v:"${DEFAULT_THEME_PREFERENCE}",d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches),t=d?"dark":"light",r=document.documentElement;r.dataset.theme=t;r.dataset.themePreference=p;r.style.colorScheme=t;const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="dark"?"${THEME_COLORS.dark}":"${THEME_COLORS.light}";const a=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(a)a.content=t==="dark"?"black":"default"}catch{}})();`;
