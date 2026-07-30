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

test("plans can be independent and a weekly plan can link directly to an annual plan", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The optional plan relationship workflow is covered once in Chromium.",
  );

  await page.goto("/plans");
  await expect(page.getByTestId("plans-view")).toHaveAttribute(
    "data-ready",
    "true",
  );

  async function createIndependentPlan(
    planType: "年度计划" | "月度计划" | "每周计划",
    title: string,
  ) {
    await page.getByRole("button", { name: "新增计划" }).click();
    if (planType !== "年度计划") {
      await page.getByTestId("plan-type-select").click();
      await page.getByRole("option", { name: planType }).click();
      await expect(page.getByTestId("plan-parent-select")).toContainText(
        "不关联上级计划",
      );
    } else {
      await expect(page.getByTestId("plan-direction-select")).toContainText(
        "不关联方向",
      );
    }
    await page.getByTestId("plan-title-input").fill(title);
    await page.getByTestId("plan-objective-input").fill("保持独立执行");
    await page.getByTestId("plan-completion-input").fill("完成并复盘");
    await page.getByTestId("plan-save").click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }

  await createIndependentPlan("年度计划", "独立年度计划");
  await createIndependentPlan("月度计划", "独立月计划");

  await page.getByRole("button", { name: "新增计划" }).click();
  await page.getByTestId("plan-type-select").click();
  await page.getByRole("option", { name: "每周计划" }).click();
  await page.getByTestId("plan-parent-select").click();
  await expect(
    page.getByRole("option", { name: "年度计划 · 独立年度计划" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "月度计划 · 独立月计划" }),
  ).toBeVisible();
  await page.getByRole("option", { name: "年度计划 · 独立年度计划" }).click();
  await page.getByTestId("plan-title-input").fill("直连年度周计划");
  await page.getByTestId("plan-objective-input").fill("跳过月计划直接执行");
  await page.getByTestId("plan-completion-input").fill("完成并复盘");
  await page.getByTestId("plan-save").click();
  await expect(
    page.getByRole("heading", { name: "直连年度周计划" }),
  ).toBeVisible();
  await expect(
    page.getByText("独立年度计划 → 直连年度周计划", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "独立年度计划" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "独立月计划" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "直连年度周计划" }),
  ).toBeVisible();
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

test("MCP lists the write tools and keeps the sixth call addressable", async ({
  request,
}) => {
  const headers = {
    authorization: "Bearer e2e-mcp-token",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const toolsResponse = await request.post("/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
      params: {},
    },
  });
  expect(toolsResponse.ok()).toBeTruthy();
  const toolsBody = await toolsResponse.json();
  expect(
    toolsBody.result.tools.map((tool: { name: string }) => tool.name),
  ).toEqual(
    expect.arrayContaining([
      "list_directions",
      "update_daily_task",
      "batch_update_daily_tasks",
      "get_plan",
      "create_plan",
      "update_plan",
    ]),
  );
  expect(
    toolsBody.result.tools.find(
      (tool: { name: string }) => tool.name === "batch_update_daily_tasks",
    ).securitySchemes,
  ).toEqual([{ type: "oauth2", scopes: ["openid", "email", "profile"] }]);

  for (let slotIndex = 1; slotIndex <= 6; slotIndex += 1) {
    const response = await request.post("/mcp", {
      headers,
      data: {
        jsonrpc: "2.0",
        id: 10 + slotIndex,
        method: "tools/call",
        params: {
          name: "update_daily_task",
          arguments: {
            date: "2026-07-28",
            slot_index: slotIndex,
            expected_version: 1,
            patch: { title: `位置 ${slotIndex}` },
          },
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.error).toBeUndefined();
    expect(body.result.content[0].text).toBeTruthy();
    expect(body.result.structuredContent).toMatchObject({
      status: "error",
      code: "INTERNAL_ERROR",
    });
  }

  const invalidSlot = await request.post("/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "update_daily_task",
        arguments: {
          date: "2026-07-28",
          slot_index: 7,
          expected_version: 1,
          patch: { title: "非法位置" },
        },
      },
    },
  });
  expect((await invalidSlot.json()).result.structuredContent).toMatchObject({
    status: "error",
    code: "INVALID_ARGUMENT",
  });
});
