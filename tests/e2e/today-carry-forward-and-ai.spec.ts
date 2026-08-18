import { expect, test, type Locator, type Page } from "@playwright/test";

const E2E_USER_ID = "00000000-0000-4000-8000-000000000001";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0OQAAAAASUVORK5CYII=",
  "base64",
);

function desktopOnly(projectName: string) {
  test.skip(
    projectName !== "desktop",
    "The carry-forward and AI confirmation contracts are covered once in desktop Chromium.",
  );
}

async function setTodayDate(page: Page, date: string) {
  const input = page.locator('input[type="date"]');
  await input.fill(date);
  await expect(input).toHaveValue(date);
}

async function fillAndCommit(locator: Locator, value: string) {
  await locator.fill(value);
  await locator.blur();
}

function exerciseWithActivity(page: Page, activity: string) {
  return page.getByTestId("exercise-log").filter({ hasText: activity });
}

async function addExercise(
  page: Page,
  input: {
    activity: string;
    planned?: boolean;
    plannedMinutes: number;
    actualMinutes: number;
    intensity: "轻度" | "中等" | "高强度";
    status: "已完成" | "未进行";
    bodyFeeling: string;
    notes: string;
  },
) {
  const logs = page.getByTestId("exercise-log");
  const previousCount = await logs.count();
  await page.getByTestId("add-exercise").click();
  await expect(logs).toHaveCount(previousCount + 1);
  const log = logs.last();

  await fillAndCommit(
    log.getByPlaceholder("散步、跑步、力量训练……"),
    input.activity,
  );
  if (input.planned) await log.getByRole("switch").click();
  await fillAndCommit(
    log.locator('input[type="number"]').nth(0),
    String(input.plannedMinutes),
  );
  await fillAndCommit(
    log.locator('input[type="number"]').nth(1),
    String(input.actualMinutes),
  );

  await log.getByRole("combobox").nth(0).click();
  await page
    .getByRole("option", { name: input.intensity, exact: true })
    .click();
  await log.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: input.status, exact: true }).click();
  await fillAndCommit(log.locator("textarea").nth(0), input.bodyFeeling);
  await fillAndCommit(log.locator("textarea").nth(1), input.notes);
}

function mealPanel(page: Page, label: "早餐" | "午餐" | "晚餐" | "加餐") {
  return page
    .getByRole("heading", { name: label, exact: true })
    .locator("..")
    .locator("..");
}

function dailySummaryInput(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..").locator("input");
}

test.describe("today carry-forward and automatic AI draft", () => {
  test("selected yesterday exercises copy only plan fields and remain idempotent", async ({
    page,
  }, testInfo) => {
    desktopOnly(testInfo.project.name);
    test.setTimeout(60_000);

    const yesterday = "2026-08-10";
    const today = "2026-08-11";
    await page.goto("/today");
    await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6);
    await setTodayDate(page, yesterday);

    await addExercise(page, {
      activity: "昨天晨跑",
      planned: true,
      plannedMinutes: 30,
      actualMinutes: 26,
      intensity: "中等",
      status: "已完成",
      bodyFeeling: "微微出汗",
      notes: "昨天实际完成",
    });
    await addExercise(page, {
      activity: "昨天拉伸",
      plannedMinutes: 15,
      actualMinutes: 10,
      intensity: "轻度",
      status: "未进行",
      bodyFeeling: "肩颈略紧",
      notes: "昨天临时中断",
    });
    await expect(page.getByTestId("exercise-log")).toHaveCount(2);

    await setTodayDate(page, today);
    await addExercise(page, {
      activity: "今天已有瑜伽",
      planned: true,
      plannedMinutes: 20,
      actualMinutes: 5,
      intensity: "轻度",
      status: "已完成",
      bodyFeeling: "今天状态",
      notes: "今天备注",
    });

    await page.getByTestId("carry-yesterday-exercise").click();
    await expect(page.getByTestId("exercise-carry-dialog")).toBeVisible();
    await page.getByTestId("select-all-yesterday-exercise").click();
    await expect(page.getByText("已选择 2 / 2", { exact: true })).toBeVisible();
    await page.getByTestId("confirm-carry-exercise").click();

    const todayLogs = page.getByTestId("exercise-log");
    await expect(todayLogs).toHaveCount(3);
    const existingYoga = exerciseWithActivity(page, "今天已有瑜伽");
    const carriedRun = exerciseWithActivity(page, "昨天晨跑");
    const carriedStretch = exerciseWithActivity(page, "昨天拉伸");
    await expect(existingYoga).toHaveCount(1);
    await expect(carriedRun).toHaveCount(1);
    await expect(carriedStretch).toHaveCount(1);
    await expect(
      existingYoga.getByPlaceholder("散步、跑步、力量训练……"),
    ).toHaveValue("今天已有瑜伽");
    await expect(
      carriedRun.getByPlaceholder("散步、跑步、力量训练……"),
    ).toHaveValue("昨天晨跑");
    await expect(
      carriedStretch.getByPlaceholder("散步、跑步、力量训练……"),
    ).toHaveValue("昨天拉伸");

    await expect(carriedRun.getByRole("switch")).toBeChecked();
    await expect(carriedRun.locator('input[type="number"]').nth(0)).toHaveValue(
      "30",
    );
    await expect(carriedRun.locator('input[type="number"]').nth(1)).toHaveValue(
      "",
    );
    await expect(carriedRun.getByRole("combobox").nth(0)).toContainText("中等");
    await expect(carriedRun.getByRole("combobox").nth(1)).toContainText(
      "未开始",
    );
    await expect(carriedRun.locator("textarea").nth(0)).toHaveValue("");
    await expect(carriedRun.locator("textarea").nth(1)).toHaveValue("");
    await expect(carriedStretch.getByRole("switch")).not.toBeChecked();
    await expect(
      carriedStretch.locator('input[type="number"]').nth(0),
    ).toHaveValue("15");
    await expect(
      carriedStretch.locator('input[type="number"]').nth(1),
    ).toHaveValue("");
    await expect(carriedStretch.getByRole("combobox").nth(1)).toContainText(
      "未开始",
    );

    // The deterministic carry key makes a second confirmation a no-op.
    await page.getByTestId("carry-yesterday-exercise").click();
    await page.getByTestId("select-all-yesterday-exercise").click();
    await page.getByTestId("confirm-carry-exercise").click();
    await expect(page.getByTestId("exercise-log")).toHaveCount(3);
    await expect(
      exerciseWithActivity(page, "昨天晨跑").getByPlaceholder(
        "散步、跑步、力量训练……",
      ),
    ).toHaveValue("昨天晨跑");
    await expect(
      exerciseWithActivity(page, "昨天拉伸").getByPlaceholder(
        "散步、跑步、力量训练……",
      ),
    ).toHaveValue("昨天拉伸");
  });

  test("meal carry copies only empty meal text and never overwrites today's private fields", async ({
    page,
  }, testInfo) => {
    desktopOnly(testInfo.project.name);
    test.setTimeout(60_000);

    const yesterday = "2026-08-12";
    const today = "2026-08-13";
    await page.goto("/today");
    await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6);
    await setTodayDate(page, yesterday);

    await fillAndCommit(
      mealPanel(page, "早餐").locator("textarea"),
      "昨天早餐：小米粥",
    );
    await fillAndCommit(
      mealPanel(page, "晚餐").locator("textarea"),
      "昨天晚餐：汤面",
    );
    await fillAndCommit(
      mealPanel(page, "加餐").locator("textarea"),
      "昨天加餐：坚果",
    );
    await mealPanel(page, "晚餐").locator('input[type="file"]').setInputFiles({
      name: "yesterday-dinner.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    await expect(
      mealPanel(page, "晚餐").locator('img[alt="饮食记录图片"]'),
    ).toHaveCount(1);
    await fillAndCommit(dailySummaryInput(page, "当日饮水（毫升）"), "1600");
    await fillAndCommit(dailySummaryInput(page, "当日整体感受"), "昨天匆忙");
    await fillAndCommit(dailySummaryInput(page, "饮食备注"), "昨天备注");

    await setTodayDate(page, today);
    await fillAndCommit(
      mealPanel(page, "早餐").locator("textarea"),
      "今天早餐：面包",
    );
    await fillAndCommit(
      mealPanel(page, "加餐").locator("textarea"),
      "今天加餐：酸奶",
    );
    await mealPanel(page, "早餐").locator('input[type="file"]').setInputFiles({
      name: "today-breakfast.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    await expect(
      mealPanel(page, "早餐").locator('img[alt="饮食记录图片"]'),
    ).toHaveCount(1);
    await fillAndCommit(dailySummaryInput(page, "当日饮水（毫升）"), "900");
    await fillAndCommit(dailySummaryInput(page, "当日整体感受"), "今天舒适");
    await fillAndCommit(dailySummaryInput(page, "饮食备注"), "今天备注");

    await page.getByTestId("carry-yesterday-meal").click();
    await expect(page.getByLabel("选择昨天的早餐")).toBeDisabled();
    await expect(page.getByLabel("选择昨天的加餐")).toBeDisabled();
    await expect(page.getByTestId("yesterday-meal-breakfast")).toContainText(
      "今天已有文字，不会覆盖",
    );
    await expect(page.getByTestId("yesterday-meal-snack")).toContainText(
      "今天已有文字，不会覆盖",
    );
    await page.getByLabel("选择昨天的晚餐").check();
    await expect(page.getByTestId("confirm-carry-meals")).toContainText(
      "带入 1 项",
    );
    await page.getByTestId("confirm-carry-meals").click();

    await expect(mealPanel(page, "早餐").locator("textarea")).toHaveValue(
      "今天早餐：面包",
    );
    await expect(mealPanel(page, "晚餐").locator("textarea")).toHaveValue(
      "昨天晚餐：汤面",
    );
    await expect(mealPanel(page, "加餐").locator("textarea")).toHaveValue(
      "今天加餐：酸奶",
    );
    await expect(
      mealPanel(page, "早餐").locator('img[alt="饮食记录图片"]'),
    ).toHaveCount(1);
    await expect(
      mealPanel(page, "晚餐").locator('img[alt="饮食记录图片"]'),
    ).toHaveCount(0);
    await expect(dailySummaryInput(page, "当日饮水（毫升）")).toHaveValue(
      "900",
    );
    await expect(dailySummaryInput(page, "当日整体感受")).toHaveValue(
      "今天舒适",
    );
    await expect(dailySummaryInput(page, "饮食备注")).toHaveValue("今天备注");
  });

  test("automatic AI draft is disabled by default and makes no request", async ({
    page,
  }, testInfo) => {
    desktopOnly(testInfo.project.name);
    let autoRequests = 0;
    await page.route("**/api/ai/daily-six/auto", async (route) => {
      autoRequests += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ status: "error" }),
      });
    });

    await page.goto("/today");
    await expect(page.getByTestId(/^daily-slot-/)).toHaveCount(6);
    await page.waitForTimeout(750);
    expect(autoRequests).toBe(0);
    await expect(page.getByTestId("ai-suggest")).toContainText("AI 建议");
  });

  test("first-open AI automation stores a draft only and writes confirmed suggestions into empty slots", async ({
    page,
  }, testInfo) => {
    desktopOnly(testInfo.project.name);
    test.setTimeout(60_000);

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const now = new Date().toISOString();
    const suggestions = Array.from({ length: 6 }, (_, index) => ({
      title: `自动草稿 ${index + 1}`,
      importance: `重要原因 ${index + 1}`,
      completion_standard: `验收结果 ${index + 1}`,
      first_action: `第一步 ${index + 1}`,
      weekly_plan_id: null,
    }));
    const readyEntry = {
      id: "10000000-0000-4000-8000-000000000001",
      user_id: E2E_USER_ID,
      entry_date: today,
      note: "",
      daily_six_ai_draft: { suggestions },
      daily_six_ai_draft_status: "ready",
      daily_six_ai_draft_trigger: "first_open",
      daily_six_ai_draft_generated_at: now,
      daily_six_ai_draft_applied_at: null,
      daily_six_ai_draft_claim_id: null,
      daily_six_ai_draft_claimed_at: null,
      daily_six_ai_draft_last_attempt_at: now,
      daily_six_ai_draft_last_error_code: null,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    let posts = 0;
    let patches = 0;
    await page.route("**/api/ai/daily-six/auto", async (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            outcome: "created",
            date: today,
            entry: readyEntry,
            draft: readyEntry.daily_six_ai_draft,
          }),
        });
        return;
      }

      patches += 1;
      const body = route.request().postDataJSON() as {
        date: string;
        expected_version: number;
      };
      expect(body).toEqual({ date: today, expected_version: 1 });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          outcome: "applied",
          date: today,
          entry: {
            ...readyEntry,
            daily_six_ai_draft_status: "applied",
            daily_six_ai_draft_applied_at: new Date().toISOString(),
            version: 2,
          },
        }),
      });
    });

    await page.goto("/today");
    await expect(page.locator('input[type="date"]')).toHaveValue(today);
    const slot1 = page.getByTestId("daily-slot-1");
    const slot2 = page.getByTestId("daily-slot-2");
    await fillAndCommit(
      slot1.getByPlaceholder("今天真正重要的是什么？"),
      "用户已经填写的任务",
    );
    await slot2.getByRole("button", { name: "展开任务详情" }).click();
    await slot2.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "今天不安排", exact: true }).click();
    await expect(slot2.getByPlaceholder("今天不安排")).toBeDisabled();

    await page.goto("/settings");
    const autoSwitch = page.getByRole("switch", {
      name: "自动准备每日六件事 AI 草稿",
    });
    await expect(autoSwitch).not.toBeChecked();
    await autoSwitch.click();
    await expect(autoSwitch).toBeChecked();

    await page.goto("/today");
    await expect.poll(() => posts).toBe(1);
    await expect(page.getByTestId("ai-suggest")).toContainText("查看 AI 草稿");
    await expect(page.getByTestId("daily-slot-1").locator("input")).toHaveValue(
      "用户已经填写的任务",
    );
    await expect(page.getByTestId("daily-slot-2").locator("input")).toHaveValue(
      "",
    );
    for (let slot = 3; slot <= 6; slot += 1) {
      await expect(
        page.getByTestId(`daily-slot-${slot}`).locator("input"),
      ).toHaveValue("");
    }

    await page.getByTestId("ai-suggest").click();
    await expect(page.getByTestId("ai-draft-dialog")).toBeVisible();
    // Opening the draft alone must not mutate any formal daily task.
    await expect(page.getByTestId("daily-slot-1").locator("input")).toHaveValue(
      "用户已经填写的任务",
    );
    await expect(page.getByTestId("daily-slot-3").locator("input")).toHaveValue(
      "",
    );

    await page.getByRole("button", { name: /确认写入空位/ }).click();
    await expect(page.getByTestId("ai-draft-dialog")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /确认写入空位（所选 2 项）/ }),
    ).toBeVisible();
    await expect(page.getByTestId("daily-slot-1").locator("input")).toHaveValue(
      "用户已经填写的任务",
    );
    await expect(page.getByTestId("daily-slot-2").locator("input")).toHaveValue(
      "",
    );
    for (let slot = 3; slot <= 6; slot += 1) {
      await expect(
        page.getByTestId(`daily-slot-${slot}`).locator("input"),
      ).toHaveValue(`自动草稿 ${slot - 2}`);
    }
    expect(posts).toBe(1);
    // Two slots were already occupied or explicitly not scheduled, so only
    // four suggestions fit. The complete server draft must remain ready.
    expect(patches).toBe(0);
    await page.getByRole("button", { name: "暂不使用" }).click();
    await expect(page.getByTestId("ai-draft-dialog")).toBeHidden();
    await expect(page.getByTestId("ai-suggest")).toContainText("查看 AI 草稿");
  });
});
