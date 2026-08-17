import { expect, test } from "@playwright/test";

const protectedModulePaths = new Set([
  "/directions",
  "/plans",
  "/accumulations",
  "/reviews",
]);

test("protected modules prefetch only after navigation intent", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Navigation request behavior is covered once in desktop Chromium.",
  );

  const prefetchedModules = new Set<string>();
  page.on("request", (request) => {
    if (request.headers()["next-router-prefetch"] !== "1") return;
    const pathname = new URL(request.url()).pathname;
    if (protectedModulePaths.has(pathname)) prefetchedModules.add(pathname);
  });

  await page.goto("/today");
  await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6);

  await page.waitForTimeout(2_500);
  expect([...prefetchedModules]).toEqual([]);

  const plansLink = page
    .locator("aside")
    .getByRole("link", { name: "计划库", exact: true });
  await plansLink.hover();
  await expect
    .poll(() => prefetchedModules.has("/plans"), { timeout: 5_000 })
    .toBe(true);
  expect([...prefetchedModules]).toEqual(["/plans"]);

  await plansLink.click();
  await expect(page).toHaveURL(/\/plans(?:\?|$)/);
  await expect(page.getByTestId("plans-view")).toHaveAttribute(
    "data-ready",
    "true",
  );
});
