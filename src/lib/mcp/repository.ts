import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

export interface DailyTaskPatch {
  title?: string;
  importance?: string;
  completion_standard?: string;
  first_action?: string;
  weekly_plan_id?: string | null;
  status?:
    | "not_started"
    | "in_progress"
    | "completed"
    | "not_completed"
    | "not_scheduled";
  result?: string;
  completed_at?: string | null;
  notes?: string;
}

export interface MealPatch {
  content?: string;
  hydration_ml?: number;
  overall_feeling?: string;
  notes?: string;
}

export interface McpRepository {
  getToday(date: string): Promise<JsonRecord>;
  listPlans(filters: {
    plan_type?: "annual" | "monthly" | "weekly";
    status?: "draft" | "active" | "paused" | "completed" | "archived";
    period_start?: string;
    period_end?: string;
  }): Promise<JsonRecord[]>;
  searchAccumulations(filters: {
    query?: string;
    tags?: string[];
    period_start?: string;
    period_end?: string;
    limit: number;
  }): Promise<JsonRecord[]>;
  getPeriodSummary(periodStart: string, periodEnd: string): Promise<JsonRecord>;
  updateDailyTask(input: {
    date: string;
    slot_index: number;
    expected_version: number;
    patch: DailyTaskPatch;
  }): Promise<JsonRecord>;
  addExercise(
    input: JsonRecord & { id: string; entry_date: string },
  ): Promise<JsonRecord>;
  upsertMeal(input: {
    entry_date: string;
    meal_type: "breakfast" | "lunch" | "dinner" | "snack";
    expected_version: number;
    patch: MealPatch;
  }): Promise<JsonRecord>;
  addAccumulation(
    input: JsonRecord & { id: string; entry_date: string },
  ): Promise<JsonRecord>;
  saveReviewDraft(input: {
    review_type: "daily" | "weekly" | "monthly";
    period_start: string;
    period_end: string;
    expected_version: number;
    draft: JsonRecord;
  }): Promise<JsonRecord>;
}

export class McpConflictError extends Error {
  constructor(
    message: string,
    public readonly current: JsonRecord | null,
  ) {
    super(message);
    this.name = "McpConflictError";
  }
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function buildPlanPaths(plans: JsonRecord[], directions: JsonRecord[]) {
  const planById = new Map(plans.map((plan) => [String(plan.id), plan]));
  const directionById = new Map(
    directions.map((direction) => [String(direction.id), direction]),
  );

  return new Map(
    plans.map((plan) => {
      const labels: string[] = [];
      const seen = new Set<string>();
      let current: JsonRecord | undefined = plan;
      while (current && !seen.has(String(current.id))) {
        seen.add(String(current.id));
        labels.unshift(String(current.title || ""));
        if (current.direction_id) {
          const direction = directionById.get(String(current.direction_id));
          if (direction) labels.unshift(String(direction.title || ""));
        }
        current = current.parent_id
          ? planById.get(String(current.parent_id))
          : undefined;
      }
      return [String(plan.id), labels.filter(Boolean)] as const;
    }),
  );
}

async function getPlanContext(supabase: SupabaseClient, userId: string) {
  const [plansResult, directionsResult] = await Promise.all([
    supabase
      .from("plans")
      .select(
        "id,title,plan_type,parent_id,direction_id,period_start,period_end,status,progress,version",
      )
      .eq("user_id", userId)
      .is("deleted_at", null),
    supabase
      .from("directions")
      .select("id,title,kind")
      .eq("user_id", userId)
      .is("deleted_at", null),
  ]);
  throwIfError(plansResult.error);
  throwIfError(directionsResult.error);
  const plans = (plansResult.data ?? []) as JsonRecord[];
  return {
    plans,
    paths: buildPlanPaths(plans, (directionsResult.data ?? []) as JsonRecord[]),
  };
}

export function createSupabaseMcpRepository(
  supabase: SupabaseClient,
  userId: string,
): McpRepository {
  return {
    async getToday(date) {
      const [tasksResult, exerciseResult, mealsResult, planContext] =
        await Promise.all([
          supabase
            .from("daily_tasks")
            .select("*")
            .eq("user_id", userId)
            .eq("entry_date", date)
            .is("deleted_at", null)
            .order("slot_index"),
          supabase
            .from("exercise_logs")
            .select("*")
            .eq("user_id", userId)
            .eq("entry_date", date)
            .is("deleted_at", null)
            .order("created_at"),
          supabase
            .from("meal_logs")
            .select("*")
            .eq("user_id", userId)
            .eq("entry_date", date)
            .is("deleted_at", null)
            .order("created_at"),
          getPlanContext(supabase, userId),
        ]);
      throwIfError(tasksResult.error);
      throwIfError(exerciseResult.error);
      throwIfError(mealsResult.error);

      const tasks = ((tasksResult.data ?? []) as JsonRecord[]).map((task) => ({
        ...task,
        upstream_path: task.weekly_plan_id
          ? (planContext.paths.get(String(task.weekly_plan_id)) ?? [])
          : [],
      }));
      return {
        date,
        daily_tasks: tasks,
        exercise_logs: exerciseResult.data ?? [],
        meal_logs: mealsResult.data ?? [],
      };
    },

    async listPlans(filters) {
      let query = supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("period_start", { ascending: false });
      if (filters.plan_type) query = query.eq("plan_type", filters.plan_type);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.period_start)
        query = query.gte("period_end", filters.period_start);
      if (filters.period_end)
        query = query.lte("period_start", filters.period_end);
      const [result, context] = await Promise.all([
        query,
        getPlanContext(supabase, userId),
      ]);
      throwIfError(result.error);
      return ((result.data ?? []) as JsonRecord[]).map((plan) => ({
        ...plan,
        upstream_path: context.paths.get(String(plan.id)) ?? [],
      }));
    },

    async searchAccumulations(filters) {
      let query = supabase
        .from("accumulation_entries")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(Math.min(filters.limit * 5, 250));
      if (filters.period_start)
        query = query.gte("entry_date", filters.period_start);
      if (filters.period_end)
        query = query.lte("entry_date", filters.period_end);
      if (filters.tags?.length) query = query.contains("tags", filters.tags);
      const result = await query;
      throwIfError(result.error);
      const normalized = filters.query?.trim().toLocaleLowerCase();
      return ((result.data ?? []) as JsonRecord[])
        .filter((entry) => {
          if (!normalized) return true;
          return [
            entry.title,
            entry.content,
            entry.reusable_conclusion,
            entry.next_use,
          ].some((value) =>
            String(value ?? "")
              .toLocaleLowerCase()
              .includes(normalized),
          );
        })
        .slice(0, filters.limit);
    },

    async getPeriodSummary(periodStart, periodEnd) {
      const [tasksResult, accumulationsResult, exerciseResult, mealsResult] =
        await Promise.all([
          supabase
            .from("daily_tasks")
            .select("entry_date,title,status")
            .eq("user_id", userId)
            .gte("entry_date", periodStart)
            .lte("entry_date", periodEnd)
            .is("deleted_at", null),
          supabase
            .from("accumulation_entries")
            .select("id,entry_date")
            .eq("user_id", userId)
            .gte("entry_date", periodStart)
            .lte("entry_date", periodEnd)
            .is("deleted_at", null),
          supabase
            .from("exercise_logs")
            .select("entry_date,status")
            .eq("user_id", userId)
            .gte("entry_date", periodStart)
            .lte("entry_date", periodEnd)
            .is("deleted_at", null),
          supabase
            .from("meal_logs")
            .select("entry_date,meal_type")
            .eq("user_id", userId)
            .gte("entry_date", periodStart)
            .lte("entry_date", periodEnd)
            .is("deleted_at", null),
        ]);
      [
        tasksResult.error,
        accumulationsResult.error,
        exerciseResult.error,
        mealsResult.error,
      ].forEach(throwIfError);

      const tasks = (tasksResult.data ?? []) as JsonRecord[];
      const byDate: Record<string, { total: number; completed: number }> = {};
      const unfinishedTitles = new Map<string, number>();
      for (const task of tasks) {
        const date = String(task.entry_date);
        byDate[date] ??= { total: 0, completed: 0 };
        byDate[date].total += 1;
        if (task.status === "completed") {
          byDate[date].completed += 1;
        } else if (
          task.status !== "not_scheduled" &&
          String(task.title || "").trim()
        ) {
          const title = String(task.title).trim();
          unfinishedTitles.set(title, (unfinishedTitles.get(title) ?? 0) + 1);
        }
      }

      return {
        period_start: periodStart,
        period_end: periodEnd,
        daily_task_total: tasks.length,
        daily_task_completed: tasks.filter(
          (task) => task.status === "completed",
        ).length,
        completion_trend: Object.entries(byDate).map(([date, value]) => ({
          date,
          ...value,
        })),
        repeatedly_unfinished: [...unfinishedTitles.entries()]
          .filter(([, count]) => count > 1)
          .sort((a, b) => b[1] - a[1])
          .map(([title, count]) => ({ title, count })),
        accumulation_count: accumulationsResult.data?.length ?? 0,
        exercise_session_count: exerciseResult.data?.length ?? 0,
        exercise_record_days: [
          ...new Set(
            (exerciseResult.data ?? []).map((row) => String(row.entry_date)),
          ),
        ].length,
        meal_record_days: [
          ...new Set(
            (mealsResult.data ?? []).map((row) => String(row.entry_date)),
          ),
        ].length,
      };
    },

    async updateDailyTask(input) {
      const result = await supabase
        .from("daily_tasks")
        .update(input.patch)
        .eq("user_id", userId)
        .eq("entry_date", input.date)
        .eq("slot_index", input.slot_index)
        .eq("version", input.expected_version)
        .is("deleted_at", null)
        .select()
        .maybeSingle();
      throwIfError(result.error);
      if (result.data) return result.data as JsonRecord;

      const current = await supabase
        .from("daily_tasks")
        .select("*")
        .eq("user_id", userId)
        .eq("entry_date", input.date)
        .eq("slot_index", input.slot_index)
        .is("deleted_at", null)
        .maybeSingle();
      throwIfError(current.error);
      throw new McpConflictError(
        "这条任务已在其他设备上发生变化，请先读取当前版本再决定是否修改。",
        (current.data as JsonRecord | null) ?? null,
      );
    },

    async addExercise(input) {
      const existing = await supabase
        .from("exercise_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("id", input.id)
        .maybeSingle();
      throwIfError(existing.error);
      if (existing.data) return existing.data as JsonRecord;
      const result = await supabase
        .from("exercise_logs")
        .insert({ ...input, user_id: userId })
        .select()
        .single();
      throwIfError(result.error);
      return result.data as JsonRecord;
    },

    async upsertMeal(input) {
      const current = await supabase
        .from("meal_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("entry_date", input.entry_date)
        .eq("meal_type", input.meal_type)
        .is("deleted_at", null)
        .maybeSingle();
      throwIfError(current.error);

      if (!current.data) {
        if (input.expected_version !== 0) {
          throw new McpConflictError(
            "饮食记录不存在，创建时 expected_version 应为 0。",
            null,
          );
        }
        const inserted = await supabase
          .from("meal_logs")
          .insert({
            user_id: userId,
            entry_date: input.entry_date,
            meal_type: input.meal_type,
            ...input.patch,
          })
          .select()
          .single();
        throwIfError(inserted.error);
        return inserted.data as JsonRecord;
      }

      const updated = await supabase
        .from("meal_logs")
        .update(input.patch)
        .eq("user_id", userId)
        .eq("id", current.data.id)
        .eq("version", input.expected_version)
        .select()
        .maybeSingle();
      throwIfError(updated.error);
      if (updated.data) return updated.data as JsonRecord;
      throw new McpConflictError(
        "饮食记录已在其他设备上发生变化，请先读取当前版本。",
        current.data as JsonRecord,
      );
    },

    async addAccumulation(input) {
      const existing = await supabase
        .from("accumulation_entries")
        .select("*")
        .eq("user_id", userId)
        .eq("id", input.id)
        .maybeSingle();
      throwIfError(existing.error);
      if (existing.data) return existing.data as JsonRecord;
      const result = await supabase
        .from("accumulation_entries")
        .insert({ ...input, user_id: userId })
        .select()
        .single();
      throwIfError(result.error);
      return result.data as JsonRecord;
    },

    async saveReviewDraft(input) {
      const current = await supabase
        .from("reviews")
        .select("*")
        .eq("user_id", userId)
        .eq("review_type", input.review_type)
        .eq("period_start", input.period_start)
        .eq("period_end", input.period_end)
        .is("deleted_at", null)
        .maybeSingle();
      throwIfError(current.error);
      if (!current.data) {
        if (input.expected_version !== 0) {
          throw new McpConflictError(
            "复盘尚未创建，写入草稿时 expected_version 应为 0。",
            null,
          );
        }
        const inserted = await supabase
          .from("reviews")
          .insert({
            user_id: userId,
            review_type: input.review_type,
            period_start: input.period_start,
            period_end: input.period_end,
            content: {},
            ai_draft: input.draft,
            saved_from_draft: false,
          })
          .select()
          .single();
        throwIfError(inserted.error);
        return inserted.data as JsonRecord;
      }

      const updated = await supabase
        .from("reviews")
        .update({ ai_draft: input.draft, saved_from_draft: false })
        .eq("user_id", userId)
        .eq("id", current.data.id)
        .eq("version", input.expected_version)
        .select()
        .maybeSingle();
      throwIfError(updated.error);
      if (updated.data) return updated.data as JsonRecord;
      throw new McpConflictError(
        "复盘已在其他设备上发生变化，请重新读取后再保存草稿。",
        current.data as JsonRecord,
      );
    },
  };
}

export function createE2eMcpRepository(): McpRepository {
  const emptyToday = (date: string) => ({
    date,
    daily_tasks: [],
    exercise_logs: [],
    meal_logs: [],
  });
  const unavailable = async () => {
    throw new Error("E2E repository does not persist writes");
  };
  return {
    getToday: async (date) => emptyToday(date),
    listPlans: async () => [],
    searchAccumulations: async () => [],
    getPeriodSummary: async (periodStart, periodEnd) => ({
      period_start: periodStart,
      period_end: periodEnd,
      daily_task_total: 0,
      daily_task_completed: 0,
      completion_trend: [],
      repeatedly_unfinished: [],
      accumulation_count: 0,
      exercise_session_count: 0,
      exercise_record_days: 0,
      meal_record_days: 0,
    }),
    updateDailyTask: unavailable,
    addExercise: unavailable,
    upsertMeal: unavailable,
    addAccumulation: unavailable,
    saveReviewDraft: unavailable,
  };
}
