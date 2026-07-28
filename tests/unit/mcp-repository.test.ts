// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseMcpRepository } from "@/lib/mcp/repository";

type QueryResult = {
  data: unknown;
  error: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null;
  count?: number | null;
};

function query(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "gte",
    "lte",
    "order",
    "limit",
    "contains",
    "maybeSingle",
    "single",
    "insert",
    "update",
  ].forEach((method) => {
    chain[method] = vi.fn(() => chain);
  });
  chain.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function fakeSupabase(options: {
  rpcResult: QueryResult;
  tableResults?: Record<string, QueryResult>;
}) {
  const rpc = vi.fn(async () => options.rpcResult);
  const queries: Record<string, Array<ReturnType<typeof query>>> = {};
  const from = vi.fn((table: string) => {
    const tableQuery = query(
      options.tableResults?.[table] ?? {
        data: [],
        error: null,
        count: 0,
      },
    );
    (queries[table] ??= []).push(tableQuery);
    return tableQuery;
  });
  return {
    client: { rpc, from } as unknown as SupabaseClient,
    rpc,
    from,
    queries,
  };
}

describe("MCP Supabase repository", () => {
  const userId = "16ea73a3-6bf8-4f89-8b58-2c92bcdb2374";

  it("reads active directions in stable user order", async () => {
    const directions = [
      { id: "d1", kind: "mission", title: "Mission", sort_order: 1 },
      { id: "d2", kind: "vision", title: "Vision", sort_order: 2 },
    ];
    const { client, queries } = fakeSupabase({
      rpcResult: { data: null, error: null },
      tableResults: {
        directions: { data: directions, error: null },
      },
    });

    const result = await createSupabaseMcpRepository(
      client,
      userId,
    ).listDirections();

    expect(result).toEqual(directions);
    expect(queries.directions[0].eq).toHaveBeenCalledWith("user_id", userId);
    expect(queries.directions[0].is).toHaveBeenCalledWith("deleted_at", null);
    expect(queries.directions[0].is).toHaveBeenCalledWith("archived_at", null);
    expect(queries.directions[0].order).toHaveBeenCalledWith("sort_order", {
      ascending: true,
    });
  });

  it("applies plan type, status and intersecting date filters", async () => {
    const { client, queries } = fakeSupabase({
      rpcResult: { data: null, error: null },
      tableResults: {
        plans: { data: [], error: null },
        directions: { data: [], error: null },
      },
    });
    const repository = createSupabaseMcpRepository(client, userId);

    await repository.listPlans({
      plan_type: "weekly",
      status: "active",
      period_start: "2026-07-27",
      period_end: "2026-08-09",
    });

    const listQuery = queries.plans[0];
    expect(listQuery.eq).toHaveBeenCalledWith("plan_type", "weekly");
    expect(listQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(listQuery.gte).toHaveBeenCalledWith("period_end", "2026-07-27");
    expect(listQuery.lte).toHaveBeenCalledWith("period_start", "2026-08-09");
    expect(listQuery.neq).not.toHaveBeenCalledWith("status", "archived");
  });

  it("hides deleted and archived plans when status is omitted", async () => {
    const { client, queries } = fakeSupabase({
      rpcResult: { data: null, error: null },
      tableResults: {
        plans: { data: [], error: null },
        directions: { data: [], error: null },
      },
    });

    await createSupabaseMcpRepository(client, userId).listPlans({});

    const listQuery = queries.plans[0];
    expect(listQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(listQuery.neq).toHaveBeenCalledWith("status", "archived");
    expect(listQuery.is).toHaveBeenCalledWith("archived_at", null);
  });

  it("maps one daily-task update to the transaction RPC without changing its slot", async () => {
    const latestTask = {
      id: "eef0974b-a0e4-42f2-8fb0-18335587bd7c",
      entry_date: "2026-07-28",
      slot_index: 6,
      title: "准备周三和查米达开会的内容",
      version: 2,
    };
    const { client, rpc } = fakeSupabase({
      rpcResult: {
        data: {
          status: "ok",
          message: "updated",
          data: latestTask,
        },
        error: null,
      },
    });
    const repository = createSupabaseMcpRepository(client, userId);

    const result = await repository.updateDailyTask({
      date: "2026-07-28",
      slot_index: 6,
      expected_version: 1,
      patch: { title: latestTask.title },
    });

    expect(rpc).toHaveBeenCalledWith("mcp_update_daily_task", {
      p_entry_date: "2026-07-28",
      p_slot_index: 6,
      p_expected_version: 1,
      p_patch: { title: latestTask.title },
    });
    expect(result).toEqual({ ...latestTask, upstream_path: [] });
  });

  it("maps an atomic six-task update to one batch RPC call", async () => {
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      entry_date: "2026-07-28",
      slot_index: index + 1,
      title: `任务 ${index + 1}`,
      version: 2,
    }));
    const inputTasks = tasks.map((task) => ({
      slot_index: task.slot_index,
      expected_version: 1,
      patch: { title: task.title },
    }));
    const { client, rpc } = fakeSupabase({
      rpcResult: {
        data: {
          status: "ok",
          message: "updated",
          data: { atomic: true, tasks },
        },
        error: null,
      },
    });
    const repository = createSupabaseMcpRepository(client, userId);

    const result = await repository.batchUpdateDailyTasks({
      date: "2026-07-28",
      tasks: inputTasks,
      atomic: true,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("mcp_batch_update_daily_tasks", {
      p_entry_date: "2026-07-28",
      p_tasks: inputTasks,
      p_atomic: true,
    });
    expect(result).toEqual({
      atomic: true,
      tasks: tasks.map((task) => ({ ...task, upstream_path: [] })),
    });
  });

  it("maps every create-plan field to the idempotent RPC", async () => {
    const planId = "e61ffea0-f0d6-488b-938d-d0d2cadfb75d";
    const directionId = "8bba88db-6daa-4855-bc73-2fd19b5feb96";
    const plan = {
      id: planId,
      user_id: userId,
      plan_type: "annual",
      title: "2026 年度计划",
      objective: "形成长期积累",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      status: "active",
      importance: "长期方向",
      completion_standard: "完成年度复盘",
      first_action: "明确年度重点",
      parent_id: null,
      direction_id: directionId,
      notes: "",
      version: 1,
    };
    const { client, rpc } = fakeSupabase({
      rpcResult: {
        data: {
          status: "ok",
          message: "created",
          data: {
            id: planId,
            warnings: [],
            idempotent_replay: false,
          },
        },
        error: null,
      },
      tableResults: {
        plans: { data: [plan], error: null },
        directions: {
          data: [{ id: directionId, title: "当前人生方向", kind: "current" }],
          error: null,
        },
      },
    });
    const repository = createSupabaseMcpRepository(client, userId);
    const input = {
      id: planId,
      plan_type: "annual" as const,
      title: plan.title,
      period_start: plan.period_start,
      period_end: plan.period_end,
      status: "active" as const,
      importance: plan.importance,
      objective: plan.objective,
      completion_standard: plan.completion_standard,
      first_action: plan.first_action,
      parent_plan_id: null,
      direction_id: directionId,
      notes: "",
    };

    const result = await repository.createPlan(input);

    expect(rpc).toHaveBeenCalledWith("mcp_create_plan", {
      p_id: planId,
      p_plan_type: "annual",
      p_title: plan.title,
      p_period_start: plan.period_start,
      p_period_end: plan.period_end,
      p_status: "active",
      p_importance: plan.importance,
      p_objective: plan.objective,
      p_completion_standard: plan.completion_standard,
      p_first_action: plan.first_action,
      p_parent_plan_id: null,
      p_direction_id: directionId,
      p_notes: "",
    });
    expect(result).toMatchObject({
      id: planId,
      version: 1,
      parent_plan_id: null,
      upstream_path: ["当前人生方向", "2026 年度计划"],
      child_plan_count: 0,
      associated_daily_task_count: 0,
      warnings: [],
      idempotent_replay: false,
    });
  });

  it("maps update-plan optimistic locking fields to the RPC", async () => {
    const planId = "e61ffea0-f0d6-488b-938d-d0d2cadfb75d";
    const patch = {
      title: "已校准的年度计划",
      notes: "只修改允许字段",
    };
    const updatedPlan = {
      id: planId,
      user_id: userId,
      plan_type: "annual",
      title: patch.title,
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      status: "active",
      parent_id: null,
      direction_id: null,
      version: 3,
      notes: patch.notes,
    };
    const { client, rpc } = fakeSupabase({
      rpcResult: {
        data: {
          status: "ok",
          message: "updated",
          data: { id: planId, warnings: [] },
        },
        error: null,
      },
      tableResults: {
        plans: { data: [updatedPlan], error: null },
        directions: { data: [], error: null },
      },
    });
    const repository = createSupabaseMcpRepository(client, userId);

    const result = await repository.updatePlan({
      plan_id: planId,
      expected_version: 2,
      patch,
    });

    expect(rpc).toHaveBeenCalledWith("mcp_update_plan", {
      p_plan_id: planId,
      p_expected_version: 2,
      p_patch: patch,
    });
    expect(result).toMatchObject({
      id: planId,
      title: patch.title,
      version: 3,
      warnings: [],
    });
  });

  it("preserves an RPC VERSION_CONFLICT code, message and details", async () => {
    const details = {
      current: {
        id: "eef0974b-a0e4-42f2-8fb0-18335587bd7c",
        version: 3,
      },
    };
    const { client } = fakeSupabase({
      rpcResult: {
        data: {
          status: "error",
          code: "VERSION_CONFLICT",
          message: "数据已被修改，请重新读取后再提交。",
          details,
        },
        error: null,
      },
    });
    const repository = createSupabaseMcpRepository(client, userId);

    await expect(
      repository.updateDailyTask({
        date: "2026-07-28",
        slot_index: 6,
        expected_version: 2,
        patch: { title: "本地修改" },
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      message: "数据已被修改，请重新读取后再提交。",
      details,
    });
  });

  it("turns database transport errors and empty RPC responses into explicit errors", async () => {
    const databaseFailure = fakeSupabase({
      rpcResult: {
        data: null,
        error: {
          message: "connection failed",
          code: "08006",
          details: "socket closed",
        },
      },
    });
    const invalidResponse = fakeSupabase({
      rpcResult: {
        data: null,
        error: null,
      },
    });

    await expect(
      createSupabaseMcpRepository(
        databaseFailure.client,
        userId,
      ).updateDailyTask({
        date: "2026-07-28",
        slot_index: 1,
        expected_version: 1,
        patch: { title: "任务" },
      }),
    ).rejects.toMatchObject({
      code: "DATABASE_ERROR",
      details: {
        database_code: "08006",
        database_message: "connection failed",
      },
    });

    await expect(
      createSupabaseMcpRepository(
        invalidResponse.client,
        userId,
      ).updateDailyTask({
        date: "2026-07-28",
        slot_index: 1,
        expected_version: 1,
        patch: { title: "任务" },
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      details: { function: "mcp_update_daily_task" },
    });
  });
});
