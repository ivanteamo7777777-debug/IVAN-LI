import type { SupabaseClient } from "@supabase/supabase-js";

export type JsonRecord = Record<string, unknown>;
export type PlanType = "annual" | "monthly" | "weekly";
export type PlanStatus =
  "draft" | "active" | "paused" | "completed" | "archived";

export type McpErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "RECORD_DELETED"
  | "RECORD_ARCHIVED"
  | "VERSION_CONFLICT"
  | "HIERARCHY_VIOLATION"
  | "CYCLE_DETECTED"
  | "IDEMPOTENCY_CONFLICT"
  | "BATCH_UPDATE_FAILED"
  | "PARTIAL_FAILURE"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR";

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

export interface DailyTaskUpdateInput {
  date: string;
  slot_index: number;
  expected_version: number;
  patch: DailyTaskPatch;
}

export interface BatchDailyTaskUpdateInput {
  date: string;
  tasks: Array<{
    slot_index: number;
    expected_version: number;
    patch: DailyTaskPatch;
  }>;
  atomic: boolean;
}

export interface PlanCreateInput {
  id: string;
  plan_type: PlanType;
  title: string;
  period_start: string;
  period_end: string;
  status: PlanStatus;
  importance: string;
  objective?: string;
  completion_standard: string;
  first_action: string;
  parent_plan_id: string | null;
  direction_id?: string | null;
  notes: string;
}

export interface PlanUpdatePatch {
  title?: string;
  objective?: string;
  period_start?: string;
  period_end?: string;
  status?: PlanStatus;
  importance?: string;
  completion_standard?: string;
  first_action?: string;
  parent_plan_id?: string | null;
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
  listDirections(): Promise<JsonRecord[]>;
  listPlans(filters: {
    plan_type?: PlanType;
    status?: PlanStatus;
    period_start?: string;
    period_end?: string;
  }): Promise<JsonRecord[]>;
  getPlan(planId: string): Promise<JsonRecord>;
  createPlan(input: PlanCreateInput): Promise<JsonRecord>;
  updatePlan(input: {
    plan_id: string;
    expected_version: number;
    patch: PlanUpdatePatch;
  }): Promise<JsonRecord>;
  searchAccumulations(filters: {
    query?: string;
    tags?: string[];
    period_start?: string;
    period_end?: string;
    limit: number;
  }): Promise<JsonRecord[]>;
  getPeriodSummary(periodStart: string, periodEnd: string): Promise<JsonRecord>;
  updateDailyTask(input: DailyTaskUpdateInput): Promise<JsonRecord>;
  batchUpdateDailyTasks(input: BatchDailyTaskUpdateInput): Promise<JsonRecord>;
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

export class McpServiceError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly details: JsonRecord = {},
  ) {
    super(message);
    this.name = "McpServiceError";
  }
}

export class McpConflictError extends McpServiceError {
  readonly current: JsonRecord | null;

  constructor(message: string, current: JsonRecord | null) {
    super("VERSION_CONFLICT", message, { current });
    this.name = "McpConflictError";
    this.current = current;
  }
}

interface RpcEnvelope {
  status: "ok" | "error";
  message: string;
  data?: unknown;
  code?: McpErrorCode;
  details?: JsonRecord;
}

function throwIfError(
  error: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null,
) {
  if (!error) return;
  throw new McpServiceError("DATABASE_ERROR", "数据库操作失败，请稍后重试。", {
    database_code: error.code ?? "",
    database_message: error.message,
    database_details: error.details ?? "",
    database_hint: error.hint ?? "",
  });
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function callRpc<T>(
  supabase: SupabaseClient,
  functionName: string,
  args: JsonRecord,
): Promise<T> {
  const result = await supabase.rpc(functionName, args);
  throwIfError(result.error);

  if (!isJsonRecord(result.data)) {
    throw new McpServiceError(
      "INTERNAL_ERROR",
      "服务没有返回有效结果，请稍后重试。",
      { function: functionName },
    );
  }

  const envelope = result.data as unknown as RpcEnvelope;
  if (envelope.status === "error") {
    throw new McpServiceError(
      envelope.code ?? "INTERNAL_ERROR",
      envelope.message || "操作未完成。",
      isJsonRecord(envelope.details) ? envelope.details : {},
    );
  }
  if (envelope.status !== "ok" || !("data" in envelope)) {
    throw new McpServiceError(
      "INTERNAL_ERROR",
      "服务返回结构不完整，请稍后重试。",
      { function: functionName },
    );
  }
  return envelope.data as T;
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
      .select("*")
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
  const planById = new Map(
    plans.map((plan) => [String(plan.id), plan] as const),
  );
  return {
    plans,
    planById,
    paths: buildPlanPaths(plans, (directionsResult.data ?? []) as JsonRecord[]),
  };
}

function enrichPlan(
  plan: JsonRecord,
  context: Awaited<ReturnType<typeof getPlanContext>>,
) {
  const parentId = plan.parent_id ? String(plan.parent_id) : null;
  return {
    ...plan,
    parent_plan_id: parentId,
    parent_plan: parentId ? (context.planById.get(parentId) ?? null) : null,
    upstream_path: context.paths.get(String(plan.id)) ?? [],
  };
}

async function enrichDailyTasks(
  supabase: SupabaseClient,
  userId: string,
  tasks: JsonRecord[],
) {
  if (!tasks.some((task) => task.weekly_plan_id)) {
    return tasks.map((task) => ({ ...task, upstream_path: [] }));
  }
  const context = await getPlanContext(supabase, userId);
  return tasks.map((task) => ({
    ...task,
    upstream_path: task.weekly_plan_id
      ? (context.paths.get(String(task.weekly_plan_id)) ?? [])
      : [],
  }));
}

async function getFullPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
) {
  const context = await getPlanContext(supabase, userId);
  const plan = context.planById.get(planId);
  if (!plan) {
    throw new McpServiceError("NOT_FOUND", "未找到该计划。", {
      plan_id: planId,
    });
  }

  const descendantIds = new Set<string>();
  let frontier = [planId];
  while (frontier.length > 0) {
    const parents = new Set(frontier);
    const children = context.plans
      .filter(
        (candidate) =>
          candidate.parent_id &&
          parents.has(String(candidate.parent_id)) &&
          !descendantIds.has(String(candidate.id)),
      )
      .map((candidate) => String(candidate.id));
    children.forEach((id) => descendantIds.add(id));
    frontier = children;
  }

  const directChildCount = context.plans.filter(
    (candidate) => String(candidate.parent_id ?? "") === planId,
  ).length;
  const weeklyPlanIds = context.plans
    .filter(
      (candidate) =>
        candidate.plan_type === "weekly" &&
        (String(candidate.id) === planId ||
          descendantIds.has(String(candidate.id))),
    )
    .map((candidate) => String(candidate.id));

  let associatedDailyTaskCount = 0;
  if (weeklyPlanIds.length > 0) {
    const tasksResult = await supabase
      .from("daily_tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("weekly_plan_id", weeklyPlanIds)
      .is("deleted_at", null);
    throwIfError(tasksResult.error);
    associatedDailyTaskCount = tasksResult.count ?? 0;
  }

  return {
    ...enrichPlan(plan, context),
    child_plan_count: directChildCount,
    descendant_plan_count: descendantIds.size,
    associated_daily_task_count: associatedDailyTaskCount,
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

    async listDirections() {
      const result = await supabase
        .from("directions")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      throwIfError(result.error);
      return (result.data ?? []) as JsonRecord[];
    },

    async listPlans(filters) {
      let query = supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("period_start", { ascending: false });
      if (filters.plan_type) query = query.eq("plan_type", filters.plan_type);
      if (filters.status) {
        query = query.eq("status", filters.status);
      } else {
        query = query.neq("status", "archived").is("archived_at", null);
      }
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
        ...enrichPlan(plan, context),
      }));
    },

    async getPlan(planId) {
      return getFullPlan(supabase, userId, planId);
    },

    async createPlan(input) {
      const rpcData = await callRpc<JsonRecord>(supabase, "mcp_create_plan", {
        p_id: input.id,
        p_plan_type: input.plan_type,
        p_title: input.title,
        p_period_start: input.period_start,
        p_period_end: input.period_end,
        p_status: input.status,
        p_importance: input.importance,
        p_objective: input.objective ?? "",
        p_completion_standard: input.completion_standard,
        p_first_action: input.first_action,
        p_parent_plan_id: input.parent_plan_id,
        p_direction_id: input.direction_id ?? null,
        p_notes: input.notes,
      });
      const fullPlan = await getFullPlan(supabase, userId, String(rpcData.id));
      return {
        ...fullPlan,
        warnings: Array.isArray(rpcData.warnings) ? rpcData.warnings : [],
        idempotent_replay: rpcData.idempotent_replay === true,
      };
    },

    async updatePlan(input) {
      const rpcData = await callRpc<JsonRecord>(supabase, "mcp_update_plan", {
        p_plan_id: input.plan_id,
        p_expected_version: input.expected_version,
        p_patch: input.patch,
      });
      const fullPlan = await getFullPlan(supabase, userId, String(rpcData.id));
      return {
        ...fullPlan,
        warnings: Array.isArray(rpcData.warnings) ? rpcData.warnings : [],
      };
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
      const task = await callRpc<JsonRecord>(
        supabase,
        "mcp_update_daily_task",
        {
          p_entry_date: input.date,
          p_slot_index: input.slot_index,
          p_expected_version: input.expected_version,
          p_patch: input.patch,
        },
      );
      return (await enrichDailyTasks(supabase, userId, [task]))[0];
    },

    async batchUpdateDailyTasks(input) {
      const data = await callRpc<JsonRecord>(
        supabase,
        "mcp_batch_update_daily_tasks",
        {
          p_entry_date: input.date,
          p_tasks: input.tasks,
          p_atomic: input.atomic,
        },
      );
      const tasks = Array.isArray(data.tasks)
        ? (data.tasks as JsonRecord[])
        : [];
      return {
        ...data,
        tasks: await enrichDailyTasks(supabase, userId, tasks),
      };
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
    listDirections: async () => [],
    listPlans: async () => [],
    getPlan: unavailable,
    createPlan: unavailable,
    updatePlan: unavailable,
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
    batchUpdateDailyTasks: unavailable,
    addExercise: unavailable,
    upsertMeal: unavailable,
    addAccumulation: unavailable,
    saveReviewDraft: unavailable,
  };
}
