import { describe, expect, it } from "vitest";
import {
  applyThemeToDocument,
  readThemePreferenceFromCookie,
  resolveTheme,
  THEME_COLORS,
} from "@/lib/theme";

describe("theme preference", () => {
  it("reads the saved preference from a cookie header", () => {
    expect(
      readThemePreferenceFromCookie(
        "session=abc; shouzhong-theme=dark; another=value",
      ),
    ).toBe("dark");
    expect(readThemePreferenceFromCookie("shouzhong-theme=system")).toBe(
      "system",
    );
  });

  it("falls back to light for a missing or invalid preference", () => {
    expect(readThemePreferenceFromCookie("")).toBe("light");
    expect(readThemePreferenceFromCookie("shouzhong-theme=midnight")).toBe(
      "light",
    );
  });

  it("resolves system preference without changing explicit choices", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("applies the resolved palette to html, browser controls and app metas", () => {
    const targetDocument = document.implementation.createHTMLDocument();
    targetDocument.head.innerHTML = `
      <meta name="theme-color" content="initial">
      <meta name="apple-mobile-web-app-status-bar-style" content="default">
    `;

    expect(applyThemeToDocument(targetDocument, "system", true)).toBe("dark");
    expect(targetDocument.documentElement.dataset.theme).toBe("dark");
    expect(targetDocument.documentElement.dataset.themePreference).toBe(
      "system",
    );
    expect(targetDocument.documentElement.style.colorScheme).toBe("dark");
    expect(
      targetDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe(THEME_COLORS.dark);
    expect(
      targetDocument.querySelector<HTMLMetaElement>(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      )?.content,
    ).toBe("black");

    expect(applyThemeToDocument(targetDocument, "light", true)).toBe("light");
    expect(targetDocument.documentElement.style.colorScheme).toBe("light");
    expect(
      targetDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe(THEME_COLORS.light);
  });
});
