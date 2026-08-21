"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyThemeToDocument,
  DEFAULT_THEME_PREFERENCE,
  readThemePreferenceFromCookie,
  resolveTheme,
  THEME_COOKIE_MAX_AGE,
  THEME_COOKIE_NAME,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  ready: boolean;
  setPreference: (preference: ThemePreference) => void;
  toggleResolvedTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialPreference() {
  if (typeof document === "undefined") return DEFAULT_THEME_PREFERENCE;
  return readThemePreferenceFromCookie(document.cookie);
}

function persistThemePreference(preference: ThemePreference) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE_NAME}=${preference}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] =
    useState<ThemePreference>(initialPreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = applyThemeToDocument(
        document,
        preference,
        media.matches,
      );
      setResolvedTheme(resolved);
    };

    persistThemePreference(preference);
    apply();

    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleResolvedTheme = useCallback(() => {
    setPreference((current) => {
      const systemDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      const currentResolved = resolveTheme(current, systemDark);
      return currentResolved === "dark" ? "light" : "dark";
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      ready,
      setPreference,
      toggleResolvedTheme,
    }),
    [preference, ready, resolvedTheme, toggleResolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme 必须在 ThemeProvider 中使用");
  return context;
}
