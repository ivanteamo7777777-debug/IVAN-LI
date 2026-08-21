import { expect, test } from "@playwright/test";

test("saved night mode is applied before application scripts load", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "shouzhong-theme",
      value: "dark",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.route("**/_next/static/chunks/**", (route) => route.abort());

  await page.goto("/auth/login", { waitUntil: "domcontentloaded" });

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
            ?.content,
      ),
    )
    .toBe("#121713");
});

test("night mode persists through navigation and reload, then quick toggle returns to light", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "ipad",
    "This interaction is exercised in both desktop and mobile navigation layouts.",
  );

  await page.goto("/settings");
  const darkChoice = page.getByTestId("theme-dark");
  await expect(darkChoice).toBeEnabled();
  await darkChoice.click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-preference",
    "dark",
  );
  await expect(darkChoice).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe("dark");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
            ?.content,
      ),
    )
    .toBe("#121713");

  await page.getByRole("link", { name: "今日执行", exact: true }).click();
  await expect(page).toHaveURL(/\/today(?:\?|$)/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const quickToggle = page.locator(
    '[data-testid="theme-quick-toggle"]:visible',
  );
  await expect(quickToggle).toHaveCount(1);
  await expect(quickToggle).toHaveAccessibleName("切换为浅色模式");
  await quickToggle.click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-preference",
    "light",
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("system mode follows device appearance changes", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The media-query listener is browser-independent and covered once in Chromium.",
  );

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  const systemChoice = page.getByTestId("theme-system");
  await expect(systemChoice).toBeEnabled();
  await systemChoice.click();

  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-preference",
    "system",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
            ?.content,
      ),
    )
    .toBe("#121713");
});
