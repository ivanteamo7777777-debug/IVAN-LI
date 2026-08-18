// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/202608180001_daily_six_auto_drafts.sql"),
  "utf8",
);
const autoService = fs.readFileSync(
  path.join(root, "src/lib/ai/daily-six-auto-draft.ts"),
  "utf8",
);
const autoRoute = fs.readFileSync(
  path.join(root, "src/app/api/ai/daily-six/auto/route.ts"),
  "utf8",
);
const manualRoute = fs.readFileSync(
  path.join(root, "src/app/api/ai/daily-six/route.ts"),
  "utf8",
);
const sendDue = fs.readFileSync(
  path.join(root, "src/app/api/push/send-due/route.ts"),
  "utf8",
);
const todayView = fs.readFileSync(
  path.join(root, "src/components/today/today-view.tsx"),
  "utf8",
);

describe("automatic daily-six production contracts", () => {
  it("defaults the feature off and stores model output only on daily_entries", () => {
    expect(migration).toContain(
      "daily_six_auto_draft_enabled boolean not null default false",
    );
    expect(migration).toContain(
      "add column if not exists daily_six_ai_draft jsonb",
    );
    expect(migration).not.toMatch(
      /update public\.daily_tasks|insert into public\.daily_tasks/,
    );
    expect(autoService).not.toMatch(
      /\.from\(["']daily_tasks["']\)[\s\S]{0,300}\.(?:insert|update|upsert|delete)\(/,
    );
  });

  it("ships service-role-only atomic claim, completion, failure and applied markers", () => {
    expect(migration).toContain(
      "create or replace function public.claim_daily_six_ai_draft(",
    );
    expect(migration).toContain(
      "create or replace function public.complete_daily_six_ai_draft(",
    );
    expect(migration).toContain(
      "create or replace function public.fail_daily_six_ai_draft(",
    );
    expect(migration).toContain(
      "create or replace function public.mark_daily_six_ai_draft_applied(",
    );
    expect(migration).toContain("and entry.daily_six_ai_draft is null");
    expect(migration).toContain(
      "last_daily_six_ai_draft_generated = p_entry_date",
    );
    expect(migration.indexOf("daily_six_ai_draft = p_draft")).toBeLessThan(
      migration.indexOf("last_daily_six_ai_draft_generated = p_entry_date"),
    );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role;");
    expect(migration).toContain(
      "grant select on table public.directions, public.plans, public.daily_tasks,",
    );
    expect(migration).toContain("public.reviews to service_role");
  });

  it("reads only active plans, bounded yesterday candidates and one adjustment", () => {
    expect(autoService).toContain('.eq("status", "active")');
    expect(autoService).toContain(
      '.in("status", ["not_started", "in_progress", "not_completed"])',
    );
    expect(autoService).toContain(".limit(6)");
    expect(autoService).toContain(
      'select("tomorrow_adjustment:content->>tomorrow_adjustment")',
    );
    expect(autoService).not.toContain('.select("content")');
    expect(autoService).toContain("recent_adjustment:");
  });

  it("allows first-open only for today and exposes an optimistic applied marker", () => {
    expect(autoService).toContain(
      'options.trigger === "first_open" && date !== local.date',
    );
    expect(autoRoute).toContain("export async function POST");
    expect(autoRoute).toContain("export async function PATCH");
    expect(autoRoute).toContain("expected_version");
    expect(autoRoute).toContain('trigger: "first_open"');
    expect(autoRoute).not.toContain("daily_tasks");
  });

  it("marks an automatic draft applied only after confirmed tasks are synced", () => {
    expect(todayView).toContain("await flushNow()");
    expect(todayView).toContain('row?.sync_status === "synced"');
    expect(todayView).toContain("unresolvedCount === 0 && localOnly");
    expect(todayView).toContain("AI 草稿会继续保留");
    expect(todayView).not.toMatch(
      /patchLocal\("daily_entries"[\s\S]{0,300}daily_six_ai_draft_status:\s*"applied"/,
    );
    expect(todayView).toContain("response.status === 409");
    expect(todayView).not.toContain("preserveLocalChanges: false");
    expect(todayView).toContain("setSelectedAiIndices(");
  });

  it("normalizes weekly IDs in both manual and automatic flows", () => {
    expect(manualRoute).toContain("loadVisibleWeeklyPlanIds");
    expect(manualRoute).toContain("normalizeDailySixDraft");
    expect(manualRoute).toContain("yesterday_incomplete");
    expect(manualRoute).toContain("recent_adjustment");
    expect(autoService).toContain("normalizeDailySixDraft");
  });

  it("runs scheduled AI independently from optional Web Push setup", () => {
    expect(sendDue.indexOf("generateDailySixAutoDraft(")).toBeLessThan(
      sendDue.indexOf("configureWebPush()"),
    );
    expect(sendDue).toContain("isScheduledDraftDue");
    expect(sendDue.match(/\.is\("deleted_at", null\)/g)).toHaveLength(2);
    expect(sendDue.match(/\.is\("archived_at", null\)/g)).toHaveLength(2);
    expect(sendDue).not.toContain("console.");
  });
});
