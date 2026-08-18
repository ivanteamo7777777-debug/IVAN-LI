import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { dailySixOutputSchema } from "@/lib/ai/schemas";

export type DailySixModelOutput = z.infer<typeof dailySixOutputSchema>;

export const DAILY_SIX_INSTRUCTIONS = `你是“守中日课”的计划对齐助手。根据用户明确提供的方向、已启用的年度/月度/周计划，以及最近一次复盘中明确写下的次日调整，为指定日期提出恰好六件可执行事项。昨天未完成事项只能作为候选参考，不得视为已经延期，也不得自动搬到今天。每件事必须有清晰完成标准和可以立即开始的第一步。优先关联已有周计划 ID，不得编造 ID。今天已有事项不要重复。输出只是草稿，绝不声称已经写入、延期或改写正式任务。使用克制、具体的简体中文。`;

/**
 * A model may echo or invent an identifier. Only retain IDs that the server
 * verified as visible weekly plans for the current user.
 */
export function normalizeDailySixDraft(
  output: DailySixModelOutput,
  allowedWeeklyPlanIds: ReadonlySet<string>,
): DailySixModelOutput {
  return dailySixOutputSchema.parse({
    suggestions: output.suggestions.map((suggestion) => ({
      ...suggestion,
      weekly_plan_id:
        suggestion.weekly_plan_id &&
        allowedWeeklyPlanIds.has(suggestion.weekly_plan_id)
          ? suggestion.weekly_plan_id
          : null,
    })),
  });
}

export async function loadVisibleWeeklyPlanIds(
  client: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from("plans")
    .select("id")
    .eq("user_id", userId)
    .eq("plan_type", "weekly")
    .is("deleted_at", null)
    .is("archived_at", null);
  if (error) throw new Error("WEEKLY_PLAN_ALLOWLIST_FAILED");
  return new Set(
    (data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string"),
  );
}
