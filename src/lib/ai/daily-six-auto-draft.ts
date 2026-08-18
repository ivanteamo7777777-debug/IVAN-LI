import type { SupabaseClient } from "@supabase/supabase-js";
import { AiUnavailableError, generateStructured } from "@/lib/ai/service";
import {
  DAILY_SIX_INSTRUCTIONS,
  normalizeDailySixDraft,
  type DailySixModelOutput,
} from "@/lib/ai/daily-six";
import { dailySixOutputSchema } from "@/lib/ai/schemas";
import type {
  DailyEntry,
  DailySixAutoDraftMode,
  DailySixDraft,
} from "@/types/domain";

const FALLBACK_TIME_ZONE = "Asia/Shanghai";
const SCHEDULED_RETRY_WINDOW_MINUTES = 60;

export interface DailySixAutoDraftSetting {
  user_id: string;
  time_zone: string;
  daily_six_auto_draft_enabled: boolean;
  daily_six_auto_draft_mode: DailySixAutoDraftMode;
  daily_six_auto_draft_time: string;
  last_daily_six_ai_draft_generated: string | null;
}

interface DailySixAutoDraftContext {
  date: string;
  directions: Array<{
    kind: string;
    title: string;
    content: string;
  }>;
  plans: Array<{
    id: string;
    plan_type: string;
    title: string;
    objective: string;
    completion_standard: string;
    parent_id: string | null;
  }>;
  existing: Array<{ slot_index: number; title: string }>;
  yesterday_incomplete?: Array<{
    title: string;
    status?: string;
    importance?: string;
    completion_standard?: string;
  }>;
  recent_adjustment?: string;
}

export interface DailySixAutoDraftRepository {
  getSetting(userId: string): Promise<DailySixAutoDraftSetting | null>;
  getEntry(userId: string, date: string): Promise<DailyEntry | null>;
  claim(
    userId: string,
    date: string,
    trigger: DailySixAutoDraftMode,
  ): Promise<string | null>;
  loadContext(userId: string, date: string): Promise<DailySixAutoDraftContext>;
  complete(
    userId: string,
    date: string,
    claimId: string,
    trigger: DailySixAutoDraftMode,
    draft: DailySixDraft,
  ): Promise<DailyEntry | null>;
  fail(
    userId: string,
    date: string,
    claimId: string,
    errorCode: string,
  ): Promise<void>;
  markApplied(
    userId: string,
    date: string,
    expectedVersion: number,
  ): Promise<DailyEntry | null>;
}

export type DailySixAutoDraftResult =
  | {
      status: "ok";
      outcome: "created" | "existing";
      date: string;
      entry: DailyEntry;
      draft: DailySixDraft;
    }
  | {
      status: "ok";
      outcome: "skipped";
      date?: string;
      reason:
        | "disabled"
        | "wrong_mode"
        | "not_today"
        | "not_due"
        | "already_generated"
        | "already_applied"
        | "in_progress_or_retry_later";
    }
  | {
      status: "unavailable";
      outcome: "unavailable";
      date: string;
      reason: "openai_not_configured";
    }
  | {
      status: "error";
      outcome: "failed";
      date: string;
      reason: "generation_failed";
    };

interface GenerateDailySixAutoDraftOptions {
  userId: string;
  trigger: DailySixAutoDraftMode;
  requestedDate?: string;
  setting?: DailySixAutoDraftSetting;
  now?: Date;
}

interface GenerateDailySixAutoDraftDependencies {
  repository: DailySixAutoDraftRepository;
  isAiConfigured?: () => boolean;
  generate?: (
    userId: string,
    input: DailySixAutoDraftContext,
  ) => Promise<DailySixModelOutput>;
}

export function zonedDateAndMinutes(now: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: FALLBACK_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  }
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function isScheduledDraftDue(
  currentMinutes: number,
  targetTime: string,
) {
  const [hour, minute] = targetTime.split(":").map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return false;
  }
  const difference = currentMinutes - (hour * 60 + minute);
  return difference >= 0 && difference < SCHEDULED_RETRY_WINDOW_MINUTES;
}

function existingResult(
  date: string,
  entry: DailyEntry | null,
): DailySixAutoDraftResult | null {
  if (!entry?.daily_six_ai_draft) return null;
  if (entry.daily_six_ai_draft_status === "applied") {
    return {
      status: "ok",
      outcome: "skipped",
      date,
      reason: "already_applied",
    };
  }
  return {
    status: "ok",
    outcome: "existing",
    date,
    entry,
    draft: entry.daily_six_ai_draft,
  };
}

async function defaultGenerate(
  userId: string,
  input: DailySixAutoDraftContext,
) {
  return generateStructured(
    userId,
    dailySixOutputSchema,
    "daily_six_auto_draft",
    DAILY_SIX_INSTRUCTIONS,
    input,
  );
}

export async function generateDailySixAutoDraft(
  options: GenerateDailySixAutoDraftOptions,
  dependencies: GenerateDailySixAutoDraftDependencies,
): Promise<DailySixAutoDraftResult> {
  const setting =
    options.setting ??
    (await dependencies.repository.getSetting(options.userId));
  if (
    !setting ||
    setting.user_id !== options.userId ||
    !setting.daily_six_auto_draft_enabled
  ) {
    return { status: "ok", outcome: "skipped", reason: "disabled" };
  }
  if (setting.daily_six_auto_draft_mode !== options.trigger) {
    return { status: "ok", outcome: "skipped", reason: "wrong_mode" };
  }

  const local = zonedDateAndMinutes(
    options.now ?? new Date(),
    setting.time_zone || FALLBACK_TIME_ZONE,
  );
  const date = options.requestedDate ?? local.date;
  if (options.trigger === "first_open" && date !== local.date) {
    return {
      status: "ok",
      outcome: "skipped",
      date,
      reason: "not_today",
    };
  }
  if (
    options.trigger === "scheduled" &&
    !isScheduledDraftDue(local.minutes, setting.daily_six_auto_draft_time)
  ) {
    return { status: "ok", outcome: "skipped", date, reason: "not_due" };
  }

  const entryBeforeClaim = await dependencies.repository.getEntry(
    options.userId,
    date,
  );
  const alreadyExists = existingResult(date, entryBeforeClaim);
  if (alreadyExists) return alreadyExists;
  if (setting.last_daily_six_ai_draft_generated === date) {
    return {
      status: "ok",
      outcome: "skipped",
      date,
      reason: "already_generated",
    };
  }

  const isAiConfigured =
    dependencies.isAiConfigured ?? (() => Boolean(process.env.OPENAI_API_KEY));
  if (!isAiConfigured()) {
    return {
      status: "unavailable",
      outcome: "unavailable",
      date,
      reason: "openai_not_configured",
    };
  }

  const claimId = await dependencies.repository.claim(
    options.userId,
    date,
    options.trigger,
  );
  if (!claimId) {
    const currentEntry = await dependencies.repository.getEntry(
      options.userId,
      date,
    );
    return (
      existingResult(date, currentEntry) ?? {
        status: "ok",
        outcome: "skipped",
        date,
        reason: "in_progress_or_retry_later",
      }
    );
  }

  try {
    const context = await dependencies.repository.loadContext(
      options.userId,
      date,
    );
    const generated = await (dependencies.generate ?? defaultGenerate)(
      options.userId,
      context,
    );
    const allowedWeeklyPlanIds = new Set(
      context.plans
        .filter((plan) => plan.plan_type === "weekly")
        .map((plan) => plan.id),
    );
    const draft = normalizeDailySixDraft(generated, allowedWeeklyPlanIds);
    const entry = await dependencies.repository.complete(
      options.userId,
      date,
      claimId,
      options.trigger,
      draft,
    );
    if (entry?.daily_six_ai_draft) {
      return {
        status: "ok",
        outcome: "created",
        date,
        entry,
        draft: entry.daily_six_ai_draft,
      };
    }
    const currentEntry = await dependencies.repository.getEntry(
      options.userId,
      date,
    );
    return (
      existingResult(date, currentEntry) ?? {
        status: "ok",
        outcome: "skipped",
        date,
        reason: "in_progress_or_retry_later",
      }
    );
  } catch (error) {
    await dependencies.repository
      .fail(
        options.userId,
        date,
        claimId,
        error instanceof AiUnavailableError
          ? "OPENAI_UNAVAILABLE"
          : "GENERATION_FAILED",
      )
      .catch(() => undefined);
    if (error instanceof AiUnavailableError) {
      return {
        status: "unavailable",
        outcome: "unavailable",
        date,
        reason: "openai_not_configured",
      };
    }
    return {
      status: "error",
      outcome: "failed",
      date,
      reason: "generation_failed",
    };
  }
}

function asDailyEntry(value: unknown): DailyEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<DailyEntry>;
  return typeof row.id === "string" && typeof row.entry_date === "string"
    ? (row as DailyEntry)
    : null;
}

export function createSupabaseDailySixAutoDraftRepository(
  client: SupabaseClient,
): DailySixAutoDraftRepository {
  return {
    async getSetting(userId) {
      const { data, error } = await client
        .from("reminder_settings")
        .select(
          "user_id,time_zone,daily_six_auto_draft_enabled,daily_six_auto_draft_mode,daily_six_auto_draft_time,last_daily_six_ai_draft_generated",
        )
        .eq("user_id", userId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .maybeSingle();
      if (error) throw new Error("AUTO_DRAFT_SETTING_READ_FAILED");
      return (data as DailySixAutoDraftSetting | null) ?? null;
    },

    async getEntry(userId, date) {
      const { data, error } = await client
        .from("daily_entries")
        .select("*")
        .eq("user_id", userId)
        .eq("entry_date", date)
        .is("deleted_at", null)
        .is("archived_at", null)
        .maybeSingle();
      if (error) throw new Error("AUTO_DRAFT_ENTRY_READ_FAILED");
      return asDailyEntry(data);
    },

    async claim(userId, date, trigger) {
      const { data, error } = await client.rpc("claim_daily_six_ai_draft", {
        p_user_id: userId,
        p_entry_date: date,
        p_trigger: trigger,
      });
      if (error) throw new Error("AUTO_DRAFT_CLAIM_FAILED");
      return typeof data === "string" ? data : null;
    },

    async loadContext(userId, date) {
      const previousDate = new Date(`${date}T00:00:00.000Z`);
      previousDate.setUTCDate(previousDate.getUTCDate() - 1);
      const yesterday = previousDate.toISOString().slice(0, 10);
      const directionsRequest = client
        .from("directions")
        .select("kind,title,content")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("sort_order", { ascending: true })
        .limit(30);
      const plansRequest = client
        .from("plans")
        .select("id,plan_type,title,objective,completion_standard,parent_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .lte("period_start", date)
        .gte("period_end", date)
        .is("deleted_at", null)
        .is("archived_at", null)
        .limit(100);
      const tasksRequest = client
        .from("daily_tasks")
        .select("slot_index,title")
        .eq("user_id", userId)
        .eq("entry_date", date)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("slot_index", { ascending: true })
        .limit(6);
      const yesterdayRequest = client
        .from("daily_tasks")
        .select("title,status,importance,completion_standard")
        .eq("user_id", userId)
        .eq("entry_date", yesterday)
        .in("status", ["not_started", "in_progress", "not_completed"])
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("slot_index", { ascending: true })
        .limit(6);
      const reviewRequest = client
        .from("reviews")
        .select("tomorrow_adjustment:content->>tomorrow_adjustment")
        .eq("user_id", userId)
        .eq("review_type", "daily")
        .lt("period_end", date)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();

      const [directions, plans, tasks, yesterdayTasks, review] =
        await Promise.all([
          directionsRequest,
          plansRequest,
          tasksRequest,
          yesterdayRequest,
          reviewRequest,
        ]);
      if (
        directions.error ||
        plans.error ||
        tasks.error ||
        yesterdayTasks.error ||
        review.error
      ) {
        throw new Error("AUTO_DRAFT_CONTEXT_READ_FAILED");
      }

      const tomorrowAdjustment = (
        review.data as { tomorrow_adjustment?: unknown } | null
      )?.tomorrow_adjustment;
      return {
        date,
        directions: (directions.data ?? []).map((row) => ({
          kind: String(row.kind ?? "").slice(0, 40),
          title: String(row.title ?? "").slice(0, 120),
          content: String(row.content ?? "").slice(0, 1200),
        })),
        plans: (plans.data ?? []).map((row) => ({
          id: String(row.id ?? ""),
          plan_type: String(row.plan_type ?? "").slice(0, 20),
          title: String(row.title ?? "").slice(0, 160),
          objective: String(row.objective ?? "").slice(0, 800),
          completion_standard: String(row.completion_standard ?? "").slice(
            0,
            800,
          ),
          parent_id: typeof row.parent_id === "string" ? row.parent_id : null,
        })),
        existing: (tasks.data ?? [])
          .filter((row) => String(row.title ?? "").trim().length > 0)
          .map((row) => ({
            slot_index: Number(row.slot_index),
            title: String(row.title ?? "").slice(0, 160),
          })),
        yesterday_incomplete: (yesterdayTasks.data ?? [])
          .filter((row) => String(row.title ?? "").trim().length > 0)
          .map((row) => ({
            title: String(row.title ?? "").slice(0, 160),
            status: String(row.status ?? "").slice(0, 30),
            importance: String(row.importance ?? "").slice(0, 800),
            completion_standard: String(row.completion_standard ?? "").slice(
              0,
              800,
            ),
          })),
        ...(typeof tomorrowAdjustment === "string" && tomorrowAdjustment.trim()
          ? { recent_adjustment: tomorrowAdjustment.slice(0, 1200) }
          : {}),
      };
    },

    async complete(userId, date, claimId, trigger, draft) {
      const { data, error } = await client.rpc("complete_daily_six_ai_draft", {
        p_user_id: userId,
        p_entry_date: date,
        p_claim_id: claimId,
        p_trigger: trigger,
        p_draft: draft,
      });
      if (error) throw new Error("AUTO_DRAFT_COMPLETE_FAILED");
      return asDailyEntry(data);
    },

    async fail(userId, date, claimId, errorCode) {
      const { error } = await client.rpc("fail_daily_six_ai_draft", {
        p_user_id: userId,
        p_entry_date: date,
        p_claim_id: claimId,
        p_error_code: errorCode,
      });
      if (error) throw new Error("AUTO_DRAFT_FAILURE_MARK_FAILED");
    },

    async markApplied(userId, date, expectedVersion) {
      const { data, error } = await client.rpc(
        "mark_daily_six_ai_draft_applied",
        {
          p_user_id: userId,
          p_entry_date: date,
          p_expected_version: expectedVersion,
        },
      );
      if (error) throw new Error("AUTO_DRAFT_APPLY_MARK_FAILED");
      return asDailyEntry(data);
    },
  };
}
