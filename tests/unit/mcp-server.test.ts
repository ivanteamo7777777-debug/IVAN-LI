// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createE2eMcpRepository,
  McpServiceError,
  type McpRepository,
} from "@/lib/mcp/repository";
import { createShouzhongMcpServer } from "@/lib/mcp/server";

type ResultEnvelope = {
  status: "ok" | "error";
  message: string;
  code?: string;
  data?: unknown;
  details?: Record<string, unknown>;
};

const allToolNames = [
  "get_today",
  "list_directions",
  "list_plans",
  "get_plan",
  "search_accumulations",
  "get_period_summary",
  "update_daily_task",
  "batch_update_daily_tasks",
  "create_plan",
  "update_plan",
  "add_exercise",
  "upsert_meal_log",
  "add_accumulation",
  "save_review_draft",
];

function envelope(result: unknown) {
  return (result as CallToolResult).structuredContent as ResultEnvelope;
}

function textContent(result: unknown) {
  const callResult = result as CallToolResult;
  return callResult.content
    .filter(
      (
        item,
      ): item is Extract<
        (typeof callResult.content)[number],
        { type: "text" }
      > => item.type === "text",
    )
    .map((item) => item.text)
    .join("\n");
}

describe("守中日课 MCP server", () => {
  let client: Client;
  let server: ReturnType<typeof createShouzhongMcpServer>;
  let repository: McpRepository;

  beforeEach(async () => {
    repository = createE2eMcpRepository();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    server = createShouzhongMcpServer(repository);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await Promise.all([client.close(), server.close()]);
  });

  it("publishes all 14 tools with complete schemas and safety annotations", async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(14);
    expect(result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(allToolNames),
    );
    expect(
      result.tools.find((tool) => tool.name === "get_today")?.annotations,
    ).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(
      result.tools.find((tool) => tool.name === "get_today")?._meta,
    ).toMatchObject({
      securitySchemes: [
        { type: "oauth2", scopes: ["openid", "email", "profile"] },
      ],
    });
    expect(
      result.tools.find((tool) => tool.name === "update_daily_task")
        ?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(
      result.tools.find((tool) => tool.name === "batch_update_daily_tasks")
        ?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(
      result.tools.find((tool) => tool.name === "create_plan")?.annotations,
    ).toMatchObject({ idempotentHint: true });
    for (const tool of result.tools) {
      expect(tool.outputSchema).toMatchObject({
        type: "object",
        properties: {
          status: { enum: ["ok", "error"] },
          message: { type: "string" },
          code: { type: "string" },
          details: { type: "object" },
        },
        required: expect.arrayContaining(["status", "message"]),
      });
    }
  });

  it("documents confirmation, optimistic locks, idempotency and atomic batch semantics", async () => {
    const tools = (await client.listTools()).tools;
    const description = (name: string) =>
      tools.find((tool) => tool.name === name)?.description ?? "";

    expect(description("create_plan")).toMatch(/明确确认/);
    expect(description("create_plan")).toMatch(/UUID/);
    expect(description("create_plan")).toMatch(/幂等|重复/);
    expect(description("update_plan")).toMatch(/先.*读取|调用前.*读取/);
    expect(description("update_plan")).toMatch(/expected_version|version/);
    expect(description("update_plan")).toMatch(/不得自动延期|不得.*覆盖/);
    expect(description("update_plan")).toMatch(/层级/);
    expect(description("batch_update_daily_tasks")).toMatch(/原子事务|原子/);
    expect(description("batch_update_daily_tasks")).toMatch(
      /全部成功.*全部失败|全部成功或全部失败/,
    );
    expect(description("batch_update_daily_tasks")).toMatch(/不得部分覆盖/);
  });

  it("returns structured daily execution data", async () => {
    const result = await client.callTool({
      name: "get_today",
      arguments: { date: "2026-07-27" },
    });
    expect(result.isError).not.toBe(true);
    expect(envelope(result)).toMatchObject({
      status: "ok",
      data: {
        date: "2026-07-27",
        daily_tasks: [],
        exercise_logs: [],
        meal_logs: [],
      },
    });
    expect(envelope(result).message).toBeTruthy();
    expect(textContent(result)).toBeTruthy();
  });

  it("publishes tools before login and returns a non-empty OAuth error envelope", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const unauthenticatedServer = createShouzhongMcpServer(
      null,
      'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="Authorization required"',
    );
    const unauthenticatedClient = new Client({
      name: "unauthenticated-client",
      version: "1.0.0",
    });

    await Promise.all([
      unauthenticatedServer.connect(serverTransport),
      unauthenticatedClient.connect(clientTransport),
    ]);

    try {
      expect((await unauthenticatedClient.listTools()).tools).toHaveLength(14);
      const result = await unauthenticatedClient.callTool({
        name: "get_today",
        arguments: { date: "2026-07-27" },
      });
      expect(result.isError).toBe(true);
      expect(result._meta).toMatchObject({
        "mcp/www_authenticate": [
          expect.stringContaining("/.well-known/oauth-protected-resource/mcp"),
        ],
      });
      expect(envelope(result)).toMatchObject({
        status: "error",
        code: "UNAUTHORIZED",
        details: expect.any(Object),
      });
      expect(envelope(result).message).toBeTruthy();
      expect(textContent(result)).toBeTruthy();
    } finally {
      await Promise.all([
        unauthenticatedClient.close(),
        unauthenticatedServer.close(),
      ]);
    }
  });

  it("passes the explicit version guard and returns the complete updated task", async () => {
    const updatedTask = {
      id: "ca48916f-9dc2-4ec6-9d50-fb2c1f2fcfbe",
      entry_date: "2026-07-27",
      slot_index: 2,
      version: 5,
      title: "确认后的标题",
      updated_at: "2026-07-27T12:00:00.000Z",
    };
    const update = vi.fn(async () => updatedTask);
    repository.updateDailyTask = update;

    const result = await client.callTool({
      name: "update_daily_task",
      arguments: {
        date: "2026-07-27",
        slot_index: 2,
        expected_version: 4,
        patch: { title: "确认后的标题" },
      },
    });

    expect(result.isError).not.toBe(true);
    expect(update).toHaveBeenCalledWith({
      date: "2026-07-27",
      slot_index: 2,
      expected_version: 4,
      patch: { title: "确认后的标题" },
    });
    expect(envelope(result)).toEqual({
      status: "ok",
      message: "已更新 2026-07-27 第 2 件事。",
      data: updatedTask,
    });
  });

  it("updates slots 1 through 6 sequentially without losing or replacing another slot", async () => {
    const tasks = new Map(
      Array.from({ length: 6 }, (_, index) => {
        const slot = index + 1;
        return [
          slot,
          {
            id: `00000000-0000-4000-8000-00000000000${slot}`,
            entry_date: "2026-07-28",
            slot_index: slot,
            title: "",
            version: 1,
          },
        ];
      }),
    );
    const update = vi.fn(async (input) => {
      const current = tasks.get(input.slot_index);
      if (!current) {
        throw new McpServiceError("NOT_FOUND", "指定位置的每日任务不存在。", {
          slot_index: input.slot_index,
        });
      }
      if (current.version !== input.expected_version) {
        throw new McpServiceError(
          "VERSION_CONFLICT",
          "数据已被修改，请重新读取后再提交。",
          { current },
        );
      }
      const next = {
        ...current,
        ...input.patch,
        version: current.version + 1,
        updated_at: "2026-07-28T08:00:00.000Z",
      };
      tasks.set(input.slot_index, next);
      return next;
    });
    repository.updateDailyTask = update;

    const results = [];
    for (let slot = 1; slot <= 6; slot += 1) {
      results.push(
        await client.callTool({
          name: "update_daily_task",
          arguments: {
            date: "2026-07-28",
            slot_index: slot,
            expected_version: 1,
            patch: { title: `第 ${slot} 件事` },
          },
        }),
      );
    }

    expect(update).toHaveBeenCalledTimes(6);
    expect(results.every((result) => result.isError !== true)).toBe(true);
    expect(envelope(results[5])).toMatchObject({
      status: "ok",
      message: "已更新 2026-07-28 第 6 件事。",
      data: {
        slot_index: 6,
        title: "第 6 件事",
        version: 2,
      },
    });
    expect([...tasks.values()].map((task) => task.title)).toEqual([
      "第 1 件事",
      "第 2 件事",
      "第 3 件事",
      "第 4 件事",
      "第 5 件事",
      "第 6 件事",
    ]);
  });

  it("returns INVALID_ARGUMENT for slot 7 with a unified non-empty envelope", async () => {
    const update = vi.fn();
    repository.updateDailyTask = update;

    const result = await client.callTool({
      name: "update_daily_task",
      arguments: {
        date: "2026-07-28",
        slot_index: 7,
        expected_version: 1,
        patch: { title: "非法位置" },
      },
    });

    expect(result.isError).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(envelope(result)).toMatchObject({
      status: "error",
      code: "INVALID_ARGUMENT",
      details: expect.any(Object),
    });
    expect(envelope(result).message).toBeTruthy();
    expect(textContent(result)).toBeTruthy();
  });

  it("returns VERSION_CONFLICT and current task details instead of swallowing the error", async () => {
    const current = {
      id: "ca48916f-9dc2-4ec6-9d50-fb2c1f2fcfbe",
      entry_date: "2026-07-28",
      slot_index: 6,
      title: "云端标题",
      version: 3,
    };
    repository.updateDailyTask = vi.fn(async () => {
      throw new McpServiceError(
        "VERSION_CONFLICT",
        "数据已被修改，请重新读取后再提交。",
        { current },
      );
    });

    const result = await client.callTool({
      name: "update_daily_task",
      arguments: {
        date: "2026-07-28",
        slot_index: 6,
        expected_version: 2,
        patch: { title: "本地标题" },
      },
    });

    expect(result.isError).toBe(true);
    expect(envelope(result)).toEqual({
      status: "error",
      code: "VERSION_CONFLICT",
      message: "数据已被修改，请重新读取后再提交。",
      details: { current },
    });
    expect(textContent(result)).toContain("VERSION_CONFLICT");
  });

  it("passes atomic=true by default for batch updates and returns every latest task", async () => {
    const tasks = [1, 2, 3, 4, 5, 6].map((slot_index) => ({
      id: `00000000-0000-4000-8000-00000000000${slot_index}`,
      entry_date: "2026-07-28",
      slot_index,
      title: `任务 ${slot_index}`,
      version: 2,
      updated_at: "2026-07-28T08:00:00.000Z",
    }));
    const batchData = { atomic: true, tasks };
    const batchUpdate = vi.fn(async () => batchData);
    repository.batchUpdateDailyTasks = batchUpdate;

    const inputTasks = tasks.map((task) => ({
      slot_index: task.slot_index,
      expected_version: 1,
      patch: { title: task.title },
    }));
    const result = await client.callTool({
      name: "batch_update_daily_tasks",
      arguments: {
        date: "2026-07-28",
        tasks: inputTasks,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(batchUpdate).toHaveBeenCalledWith({
      date: "2026-07-28",
      tasks: inputTasks,
      atomic: true,
    });
    expect(envelope(result)).toMatchObject({
      status: "ok",
      data: batchData,
    });
  });

  it("returns BATCH_UPDATE_FAILED with the failed slot and reason", async () => {
    repository.batchUpdateDailyTasks = vi.fn(async () => {
      throw new McpServiceError(
        "BATCH_UPDATE_FAILED",
        "批量更新失败，所有修改已回滚。",
        {
          failed_slot_index: 4,
          reason: "VERSION_CONFLICT",
        },
      );
    });

    const result = await client.callTool({
      name: "batch_update_daily_tasks",
      arguments: {
        date: "2026-07-28",
        tasks: [
          {
            slot_index: 3,
            expected_version: 1,
            patch: { title: "第三件事" },
          },
          {
            slot_index: 4,
            expected_version: 1,
            patch: { title: "第四件事" },
          },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(envelope(result)).toEqual({
      status: "error",
      code: "BATCH_UPDATE_FAILED",
      message: "批量更新失败，所有修改已回滚。",
      details: {
        failed_slot_index: 4,
        reason: "VERSION_CONFLICT",
      },
    });
  });

  it("gets one plan with its version, relations and counts", async () => {
    const plan = {
      id: "a3ac92f6-fae4-4d5c-a996-d0805777e85c",
      plan_type: "weekly",
      title: "完成辅料统计与分析",
      version: 2,
      parent_plan: { id: "dfce34d1-f832-4107-a55f-f8defda7411c" },
      upstream_path: ["年度计划", "月度计划", "完成辅料统计与分析"],
      child_plan_count: 0,
      daily_task_count: 2,
    };
    const getPlan = vi.fn(async () => plan);
    repository.getPlan = getPlan;

    const result = await client.callTool({
      name: "get_plan",
      arguments: { plan_id: plan.id },
    });

    expect(getPlan).toHaveBeenCalledWith(plan.id);
    expect(result.isError).not.toBe(true);
    expect(envelope(result)).toMatchObject({
      status: "ok",
      data: plan,
    });
  });

  it("creates a plan with the client UUID and all hierarchy fields unchanged", async () => {
    const input = {
      id: "a3ac92f6-fae4-4d5c-a996-d0805777e85c",
      plan_type: "weekly" as const,
      title: "完成辅料统计与分析",
      period_start: "2026-07-27",
      period_end: "2026-08-02",
      status: "active" as const,
      importance: "本周重点",
      objective: "完成统计与分析",
      completion_standard: "完成可复核报告",
      first_action: "整理数据源",
      parent_plan_id: "dfce34d1-f832-4107-a55f-f8defda7411c",
      direction_id: null,
      notes: "",
    };
    const created = {
      ...input,
      version: 1,
      upstream_path: ["年度计划", "月度计划", input.title],
    };
    const createPlan = vi.fn(async () => created);
    repository.createPlan = createPlan;

    const result = await client.callTool({
      name: "create_plan",
      arguments: input,
    });

    expect(createPlan).toHaveBeenCalledWith(input);
    expect(result.isError).not.toBe(true);
    expect(envelope(result)).toEqual({
      status: "ok",
      message: "已新增周计划。",
      data: created,
    });
  });

  it("updates a plan with expected_version and only the allowed patch fields", async () => {
    const input = {
      plan_id: "a3ac92f6-fae4-4d5c-a996-d0805777e85c",
      expected_version: 2,
      patch: {
        title: "完成辅料统计与分析（已校准）",
        period_start: "2026-07-27",
        period_end: "2026-08-02",
        status: "active" as const,
        importance: "本周最重要",
        objective: "输出完整分析",
        completion_standard: "报告通过复核",
        first_action: "检查统计口径",
        parent_plan_id: "dfce34d1-f832-4107-a55f-f8defda7411c",
        notes: "保持原周期",
      },
    };
    const updated = {
      id: input.plan_id,
      plan_type: "weekly",
      ...input.patch,
      version: 3,
      updated_at: "2026-07-28T09:00:00.000Z",
      upstream_path: ["年度计划", "月度计划", input.patch.title],
    };
    const updatePlan = vi.fn(async () => updated);
    repository.updatePlan = updatePlan;

    const result = await client.callTool({
      name: "update_plan",
      arguments: input,
    });

    expect(updatePlan).toHaveBeenCalledWith(input);
    expect(result.isError).not.toBe(true);
    expect(envelope(result)).toMatchObject({
      status: "ok",
      data: updated,
    });
  });

  it("returns VERSION_CONFLICT when a plan was changed after it was read", async () => {
    const current = {
      id: "a3ac92f6-fae4-4d5c-a996-d0805777e85c",
      title: "云端计划",
      version: 4,
    };
    repository.updatePlan = vi.fn(async () => {
      throw new McpServiceError(
        "VERSION_CONFLICT",
        "计划已被修改，请重新读取后再提交。",
        { current },
      );
    });

    const result = await client.callTool({
      name: "update_plan",
      arguments: {
        plan_id: current.id,
        expected_version: 3,
        patch: { title: "本地计划" },
      },
    });

    expect(result.isError).toBe(true);
    expect(envelope(result)).toEqual({
      status: "error",
      code: "VERSION_CONFLICT",
      message: "计划已被修改，请重新读取后再提交。",
      details: { current },
    });
  });

  it("never returns an empty result when an unexpected repository error occurs", async () => {
    repository.getPlan = vi.fn(async () => {
      throw new Error("connection reset");
    });

    const result = await client.callTool({
      name: "get_plan",
      arguments: { plan_id: "a3ac92f6-fae4-4d5c-a996-d0805777e85c" },
    });

    expect(result.isError).toBe(true);
    expect(envelope(result)).toMatchObject({
      status: "error",
      code: "INTERNAL_ERROR",
      details: expect.any(Object),
    });
    expect(envelope(result).message).toBeTruthy();
    expect(textContent(result)).toBeTruthy();
  });
});
