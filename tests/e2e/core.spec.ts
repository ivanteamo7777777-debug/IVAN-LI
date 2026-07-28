import { expect, test } from "@playwright/test";

test("login enters the local test vault and shows six independent positions", async ({
  page,
}) => {
  await page.goto("/auth/login");
  await page.getByRole("button", { name: "进入本地测试库" }).click();
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6);
  await expect(page.getByTestId("exercise-section")).toBeVisible();
  await expect(page.getByTestId("meal-section")).toBeVisible();
});

test("a typed task survives offline reload and does not use exercise or meal slots", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Offline navigation is covered in Chromium; WebKit on Windows cannot emulate it reliably.",
  );
  await page.goto("/today");
  await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6);
  const firstTitle = page
    .getByTestId("daily-slot-1")
    .getByPlaceholder("今天真正重要的是什么？");
  await firstTitle.fill("离线也不会丢失的第一件事");
  await firstTitle.blur();
  await page.waitForTimeout(50);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload();
  await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("daily-slot-1").locator("input")).toHaveValue(
    "离线也不会丢失的第一件事",
  );
  await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6);
  await context.setOffline(false);
});

test("continuous keyboard input stays responsive and persists after the debounce", async ({
  page,
}) => {
  await page.goto("/today");
  const title = page
    .getByTestId("daily-slot-1")
    .getByPlaceholder("今天真正重要的是什么？");
  const text = "不断更新，但不丢失自己的河道";

  await title.pressSequentially(text, { delay: 25 });
  await expect(title).toHaveValue(text);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId("daily-slot-1").locator("input")).toHaveValue(
    text,
  );
});

test("task title uses immediate mobile touch targeting", async ({ page }) => {
  await page.goto("/today");
  const title = page
    .getByTestId("daily-slot-1")
    .getByPlaceholder("今天真正重要的是什么？");

  expect(
    await title.evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe("manipulation");
  await title.click();
  expect(
    await title.evaluate((element) => document.activeElement === element),
  ).toBe(true);
});

test("multiple exercise sessions persist independently on the same day", async ({
  page,
}) => {
  await page.goto("/today");
  await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6, {
    timeout: 30_000,
  });
  const add = page.getByTestId("add-exercise");
  await add.click();
  await expect(page.getByTestId("exercise-log")).toHaveCount(1);
  await add.click();

  const logs = page.getByTestId("exercise-log");
  await expect(logs).toHaveCount(2);
  const activities = logs.getByPlaceholder("散步、跑步、力量训练……");
  expect(await activities.count()).toBe(2);
  await activities.nth(0).fill("晨间散步");
  await activities.nth(0).blur();
  await activities.nth(1).fill("晚间拉伸");
  await activities.nth(1).blur();
  await page.waitForTimeout(600);
  await page.reload();

  const persisted = page
    .getByTestId("exercise-log")
    .getByPlaceholder("散步、跑步、力量训练……");
  await expect(persisted).toHaveCount(2);
  await expect(persisted.nth(0)).toHaveValue("晨间散步");
  await expect(persisted.nth(1)).toHaveValue("晚间拉伸");
});

test("AI suggestions remain a draft until explicit confirmation", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The confirmation contract is browser-independent and covered once in Chromium.",
  );
  await page.goto("/today");
  await page.getByTestId("ai-suggest").dispatchEvent("click");
  await expect(page.getByText("AI 六件事建议草稿")).toBeVisible();
  await expect(page.getByTestId("daily-slot-1").locator("input")).toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "确认写入空位" }).click();
  await expect(page.getByTestId("daily-slot-1").locator("input")).toHaveValue(
    "AI 建议 1",
  );
});

test("manifest is installable and icons resolve", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/today");
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok()).toBeTruthy();
  }
});

test("responsive navigation prioritizes mobile and desktop patterns", async ({
  page,
}) => {
  await page.goto("/today");
  if ((page.viewportSize()?.width ?? 1024) < 768) {
    await expect(page.locator("nav").last()).toBeVisible();
  } else {
    await expect(page.locator("aside")).toBeVisible();
  }
});

test("MCP advertises OAuth and completes the protocol handshake", async ({
  request,
}) => {
  const discovered = await request.post("/mcp", {
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "playwright", version: "1.0.0" },
      },
    },
  });
  expect(discovered.ok()).toBeTruthy();
  expect((await discovered.json()).result.serverInfo.name).toBe(
    "shouzhong-daily",
  );

  const metadata = await request.get(
    "/.well-known/oauth-protected-resource/mcp",
  );
  expect(metadata.ok()).toBeTruthy();
  const metadataBody = await metadata.json();
  expect(metadataBody.resource).toMatch(/^https?:\/\/.+\/mcp$/);
  expect(metadataBody.authorization_servers[0]).toMatch(
    /^https:\/\/.+\.supabase\.co\/auth\/v1$/,
  );

  const initialized = await request.post("/mcp", {
    headers: {
      authorization: "Bearer e2e-mcp-token",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "playwright", version: "1.0.0" },
      },
    },
  });
  expect(initialized.ok()).toBeTruthy();
  expect((await initialized.json()).result.serverInfo.name).toBe(
    "shouzhong-daily",
  );
});
