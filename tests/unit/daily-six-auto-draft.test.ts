// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  generateDailySixAutoDraft,
  isScheduledDraftDue,
  type DailySixAutoDraftRepository,
  type DailySixAutoDraftSetting,
} from "@/lib/ai/daily-six-auto-draft";
import { normalizeDailySixDraft } from "@/lib/ai/daily-six";
import type { DailyEntry, DailySixDraft } from "@/types/domain";

const userId = "00000000-0000-4000-8000-000000000001";
const date = "2026-08-18";

function setting(
  patch: Partial<DailySixAutoDraftSetting> = {},
): DailySixAutoDraftSetting {
  return {
    user_id: userId,
    time_zone: "Asia/Shanghai",
    daily_six_auto_draft_enabled: true,
    daily_six_auto_draft_mode: "first_open",
    daily_six_auto_draft_time: "08:00",
    last_daily_six_ai_draft_generated: null,
    ...patch,
  };
}

function entry(
  draft: DailySixDraft | null,
  status: DailyEntry["daily_six_ai_draft_status"] = "ready",
): DailyEntry {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    user_id: userId,
    entry_date: date,
    note: "",
    daily_six_ai_draft: draft,
    daily_six_ai_draft_status: status,
    daily_six_ai_draft_trigger: "first_open",
    daily_six_ai_draft_generated_at: draft ? "2026-08-18T00:01:00Z" : null,
    daily_six_ai_draft_applied_at:
      status === "applied" ? "2026-08-18T00:02:00Z" : null,
    daily_six_ai_draft_claim_id: null,
    daily_six_ai_draft_claimed_at: null,
    daily_six_ai_draft_last_attempt_at: "2026-08-18T00:00:00Z",
    daily_six_ai_draft_last_error_code: null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:01:00Z",
    version: 3,
  };
}

function suggestions(weeklyPlanId: string | null = null) {
  return Array.from({ length: 6 }, (_, index) => ({
    title: `建议 ${index + 1}`,
    importance: "与长期方向对齐",
    completion_standard: "留下可验证结果",
    first_action: "先做五分钟",
    weekly_plan_id: index === 0 ? weeklyPlanId : null,
  }));
}

function repository(
  patch: Partial<DailySixAutoDraftRepository> = {},
): DailySixAutoDraftRepository {
  return {
    getSetting: vi.fn(async () => setting()),
    getEntry: vi.fn(async () => null),
    claim: vi.fn(async () => "20000000-0000-4000-8000-000000000001"),
    loadContext: vi.fn(async () => ({
      date,
      directions: [],
      plans: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          plan_type: "weekly",
          title: "本周计划",
          objective: "完成重点",
          completion_standard: "完成",
          parent_id: null,
        },
      ],
      existing: [],
      yesterday_incomplete: [{ title: "昨天候选", status: "not_completed" }],
      recent_adjustment: "减少切换",
    })),
    complete: vi.fn(async (_userId, _date, _claimId, _trigger, draft) =>
      entry(draft),
    ),
    fail: vi.fn(async () => undefined),
    markApplied: vi.fn(async () => null),
    ...patch,
  };
}

describe("automatic daily-six drafts", () => {
  it("is disabled by default and does not claim a generation job", async () => {
    const repo = repository({
      getSetting: vi.fn(async () =>
        setting({ daily_six_auto_draft_enabled: false }),
      ),
    });
    const result = await generateDailySixAutoDraft(
      { userId, trigger: "first_open", requestedDate: date },
      { repository: repo, isAiConfigured: () => true },
    );
    expect(result).toMatchObject({ outcome: "skipped", reason: "disabled" });
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it("never generates while browsing a historical date", async () => {
    const repo = repository();
    const result = await generateDailySixAutoDraft(
      {
        userId,
        trigger: "first_open",
        requestedDate: "2026-08-17",
        now: new Date("2026-08-18T00:00:00Z"),
      },
      { repository: repo, isAiConfigured: () => true },
    );
    expect(result).toMatchObject({ outcome: "skipped", reason: "not_today" });
    expect(repo.getEntry).not.toHaveBeenCalled();
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it("returns the complete existing entry without regenerating", async () => {
    const draft = { suggestions: suggestions() };
    const existing = entry(draft);
    const repo = repository({ getEntry: vi.fn(async () => existing) });
    const result = await generateDailySixAutoDraft(
      {
        userId,
        trigger: "first_open",
        requestedDate: date,
        now: new Date("2026-08-18T00:00:00Z"),
      },
      { repository: repo, isAiConfigured: () => true },
    );
    expect(result).toMatchObject({
      outcome: "existing",
      entry: { id: existing.id, version: 3 },
      draft,
    });
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it("does not offer an already applied draft again", async () => {
    const repo = repository({
      getEntry: vi.fn(async () =>
        entry({ suggestions: suggestions() }, "applied"),
      ),
    });
    const result = await generateDailySixAutoDraft(
      {
        userId,
        trigger: "first_open",
        requestedDate: date,
        now: new Date("2026-08-18T00:00:00Z"),
      },
      { repository: repo, isAiConfigured: () => true },
    );
    expect(result).toMatchObject({
      outcome: "skipped",
      reason: "already_applied",
    });
  });

  it("leaves the database untouched when OpenAI is not configured", async () => {
    const repo = repository();
    const result = await generateDailySixAutoDraft(
      {
        userId,
        trigger: "first_open",
        requestedDate: date,
        now: new Date("2026-08-18T00:00:00Z"),
      },
      { repository: repo, isAiConfigured: () => false },
    );
    expect(result).toMatchObject({
      outcome: "unavailable",
      reason: "openai_not_configured",
    });
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it("persists only a normalized draft and strips invented weekly plan IDs", async () => {
    const repo = repository();
    const result = await generateDailySixAutoDraft(
      {
        userId,
        trigger: "first_open",
        requestedDate: date,
        now: new Date("2026-08-18T00:00:00Z"),
      },
      {
        repository: repo,
        isAiConfigured: () => true,
        generate: vi.fn(async () => ({ suggestions: suggestions("invented") })),
      },
    );
    expect(result).toMatchObject({ outcome: "created" });
    expect(repo.complete).toHaveBeenCalledOnce();
    const persistedDraft = vi.mocked(repo.complete).mock.calls[0][4];
    expect(persistedDraft.suggestions[0].weekly_plan_id).toBeNull();
  });

  it("marks a failed claim for retry without completing a draft", async () => {
    const repo = repository();
    const result = await generateDailySixAutoDraft(
      {
        userId,
        trigger: "first_open",
        requestedDate: date,
        now: new Date("2026-08-18T00:00:00Z"),
      },
      {
        repository: repo,
        isAiConfigured: () => true,
        generate: vi.fn(async () => {
          throw new Error("private model failure");
        }),
      },
    );
    expect(result).toMatchObject({ outcome: "failed" });
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith(
      userId,
      date,
      expect.any(String),
      "GENERATION_FAILED",
    );
  });

  it("keeps scheduled retries inside a bounded one-hour window", () => {
    expect(isScheduledDraftDue(8 * 60, "08:00")).toBe(true);
    expect(isScheduledDraftDue(8 * 60 + 45, "08:00")).toBe(true);
    expect(isScheduledDraftDue(9 * 60, "08:00")).toBe(false);
  });
});

describe("daily-six output normalization", () => {
  it("retains only server-verified weekly plan IDs", () => {
    const verified = "30000000-0000-4000-8000-000000000001";
    const output = { suggestions: suggestions(verified) };
    expect(
      normalizeDailySixDraft(output, new Set([verified])).suggestions[0]
        .weekly_plan_id,
    ).toBe(verified);
    expect(
      normalizeDailySixDraft(output, new Set()).suggestions[0].weekly_plan_id,
    ).toBeNull();
  });
});
