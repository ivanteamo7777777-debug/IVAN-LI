import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { McpConflictError, type McpRepository } from "@/lib/mcp/repository";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "请使用 YYYY-MM-DD 日期格式");
const optionalText = (max: number) => z.string().max(max).optional();
const outputSchema = {
  status: z.enum(["ok", "conflict", "error"]),
  message: z.string(),
  data: z.unknown().optional(),
};

const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const writeAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const oauthSecuritySchemes = [
  { type: "oauth2", scopes: ["openid", "email", "profile"] },
] as const;

function toolMeta(invoking: string, invoked: string) {
  return {
    securitySchemes: oauthSecuritySchemes,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

class McpUnauthorizedError extends Error {
  constructor(readonly challenge: string) {
    super("请先授权 ChatGPT 连接守中日课。");
  }
}

function ok(message: string, data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { status: "ok", message, data },
  };
}

function fail(error: unknown): CallToolResult {
  if (error instanceof McpUnauthorizedError) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message }],
      _meta: { "mcp/www_authenticate": [error.challenge] },
      structuredContent: { status: "error", message: error.message },
    };
  }

  if (error instanceof McpConflictError) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message }],
      structuredContent: {
        status: "conflict",
        message: error.message,
        data: { current: error.current },
      },
    };
  }

  const message =
    error instanceof Error ? error.message : "守中日课暂时无法完成这次操作。";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { status: "error", message },
  };
}

async function run(
  operation: () => Promise<unknown>,
  message: (data: unknown) => string,
) {
  try {
    const data = await operation();
    return ok(message(data), data);
  } catch (error) {
    return fail(error);
  }
}

export function createShouzhongMcpServer(
  repository: McpRepository | null,
  challenge = 'Bearer error="insufficient_scope", error_description="Authorization required"',
) {
  const authorizedRepository = () => {
    if (!repository) throw new McpUnauthorizedError(challenge);
    return repository;
  };

  const server = new McpServer(
    {
      name: "shouzhong-daily",
      version: "1.0.0",
    },
    {
      instructions:
        "守中日课是个人执行与复盘系统。写入前必须先读取当前记录；只有用户在当前对话中明确确认后才能调用写入工具。AI 生成的六件事和复盘只能保存为草稿，不能当作事实或自动覆盖正式数据。不得自动延期未完成任务。每日六件事只使用 1–6 的独立位置；运动与饮食是独立记录。所有修改都应携带读取到的 expected_version，冲突时把本地与云端差异交给用户选择。",
    },
  );

  server.registerTool(
    "get_today",
    {
      title: "读取今日执行",
      description:
        "读取指定日期的六件事、多个运动记录和饮食记录。写入任何当天数据前先调用本工具取得 id、version 与完整上游路径。",
      inputSchema: {
        date: dateSchema.describe("要读取的日期，格式 YYYY-MM-DD"),
      },
      outputSchema,
      annotations: readAnnotations,
      _meta: toolMeta("正在读取今日执行…", "已读取今日执行"),
    },
    async ({ date }) =>
      run(
        () => authorizedRepository().getToday(date),
        () => `已读取 ${date} 的今日执行记录。`,
      ),
  );

  server.registerTool(
    "list_plans",
    {
      title: "读取计划",
      description:
        "按层级、状态和时间范围读取年度、月度或每周计划，并返回完整上游路径。",
      inputSchema: {
        plan_type: z.enum(["annual", "monthly", "weekly"]).optional(),
        status: z
          .enum(["draft", "active", "paused", "completed", "archived"])
          .optional(),
        period_start: dateSchema.optional(),
        period_end: dateSchema.optional(),
      },
      outputSchema,
      annotations: readAnnotations,
      _meta: toolMeta("正在读取计划…", "已读取计划"),
    },
    async (filters) =>
      run(
        () => authorizedRepository().listPlans(filters),
        (data) => `已读取 ${(data as unknown[]).length} 条计划。`,
      ),
  );

  server.registerTool(
    "search_accumulations",
    {
      title: "搜索长期积累",
      description:
        "搜索用户确认保存的长期积累，可按关键词、标签与日期筛选，并关联回原任务或计划。",
      inputSchema: {
        query: z.string().max(120).optional(),
        tags: z.array(z.string().max(40)).max(10).optional(),
        period_start: dateSchema.optional(),
        period_end: dateSchema.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      outputSchema,
      annotations: readAnnotations,
      _meta: toolMeta("正在搜索长期积累…", "已搜索长期积累"),
    },
    async (filters) =>
      run(
        () => authorizedRepository().searchAccumulations(filters),
        (data) => `找到 ${(data as unknown[]).length} 条长期积累。`,
      ),
  );

  server.registerTool(
    "get_period_summary",
    {
      title: "读取周期执行摘要",
      description:
        "汇总指定时间范围内的六件事完成趋势、反复未完成事项、真实积累数量，以及运动和饮食记录连续性。结果是事实数据摘要，不是正式复盘。",
      inputSchema: {
        period_start: dateSchema,
        period_end: dateSchema,
      },
      outputSchema,
      annotations: readAnnotations,
      _meta: toolMeta("正在汇总周期执行…", "已汇总周期执行"),
    },
    async ({ period_start, period_end }) =>
      run(
        () =>
          authorizedRepository().getPeriodSummary(period_start, period_end),
        () => `已汇总 ${period_start} 至 ${period_end} 的执行数据。`,
      ),
  );

  server.registerTool(
    "update_daily_task",
    {
      title: "修改每日六件事",
      description:
        "修改指定日期和位置的一件事。调用前必须先用 get_today 读取当前 version，并得到用户明确确认；不得自动延期或替换其他位置。",
      inputSchema: {
        date: dateSchema,
        slot_index: z.number().int().min(1).max(6),
        expected_version: z.number().int().positive(),
        patch: z
          .object({
            title: optionalText(200),
            importance: optionalText(4000),
            completion_standard: optionalText(4000),
            first_action: optionalText(4000),
            weekly_plan_id: z.string().uuid().nullable().optional(),
            status: z
              .enum([
                "not_started",
                "in_progress",
                "completed",
                "not_completed",
                "not_scheduled",
              ])
              .optional(),
            result: optionalText(8000),
            completed_at: z.string().datetime().nullable().optional(),
            notes: optionalText(8000),
          })
          .refine((value) => Object.keys(value).length > 0, "至少修改一个字段"),
      },
      outputSchema,
      annotations: writeAnnotations,
      _meta: toolMeta("正在更新每日六件事…", "已更新每日六件事"),
    },
    async (input) =>
      run(
        () => authorizedRepository().updateDailyTask(input),
        () => `已更新 ${input.date} 第 ${input.slot_index} 件事。`,
      ),
  );

  server.registerTool(
    "add_exercise",
    {
      title: "新增运动记录",
      description:
        "在指定日期新增一条独立运动记录，同一天可新增多条。需要用户明确确认；id 由客户端生成 UUID，重复调用相同 id 不会重复创建。",
      inputSchema: {
        id: z.string().uuid(),
        entry_date: dateSchema,
        planned: z.boolean().default(false),
        activity: z.string().max(200),
        planned_minutes: z.number().int().min(0).nullable().optional(),
        actual_minutes: z.number().int().min(0).nullable().optional(),
        intensity: z.enum(["light", "moderate", "high"]).nullable().optional(),
        status: z.enum(["not_started", "completed", "skipped"]),
        body_feeling: z.string().max(4000).default(""),
        notes: z.string().max(8000).default(""),
      },
      outputSchema,
      annotations: { ...writeAnnotations, idempotentHint: true },
      _meta: toolMeta("正在新增运动记录…", "已新增运动记录"),
    },
    async (input) =>
      run(
        () => authorizedRepository().addExercise(input),
        () => `已新增 ${input.entry_date} 的运动记录。`,
      ),
  );

  server.registerTool(
    "upsert_meal_log",
    {
      title: "新增或修改饮食记录",
      description:
        "新增或修改指定日期的一餐。创建时 expected_version 为 0；修改前先用 get_today 取得当前 version，并获得用户明确确认。",
      inputSchema: {
        entry_date: dateSchema,
        meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
        expected_version: z.number().int().min(0),
        patch: z
          .object({
            content: optionalText(8000),
            hydration_ml: z.number().int().min(0).max(30000).optional(),
            overall_feeling: optionalText(4000),
            notes: optionalText(8000),
          })
          .refine((value) => Object.keys(value).length > 0, "至少写入一个字段"),
      },
      outputSchema,
      annotations: writeAnnotations,
      _meta: toolMeta("正在保存饮食记录…", "已保存饮食记录"),
    },
    async (input) =>
      run(
        () => authorizedRepository().upsertMeal(input),
        () => `已保存 ${input.entry_date} 的饮食记录。`,
      ),
  );

  server.registerTool(
    "add_accumulation",
    {
      title: "计入长期积累",
      description:
        "把用户明确选择留下的成果计入长期积累。不得把所有已完成任务自动写入；id 由客户端生成 UUID，重复调用相同 id 不会重复创建。",
      inputSchema: {
        id: z.string().uuid(),
        entry_date: dateSchema,
        title: z.string().min(1).max(200),
        content: z.string().max(12000).default(""),
        tags: z.array(z.string().max(40)).max(20).default([]),
        source_task_id: z.string().uuid().nullable().default(null),
        source_plan_id: z.string().uuid().nullable().default(null),
        attachment_paths: z.array(z.string().max(500)).max(20).default([]),
        reusable_conclusion: z.string().max(8000).default(""),
        next_use: z.string().max(8000).default(""),
      },
      outputSchema,
      annotations: { ...writeAnnotations, idempotentHint: true },
      _meta: toolMeta("正在计入长期积累…", "已计入长期积累"),
    },
    async (input) =>
      run(
        () => authorizedRepository().addAccumulation(input),
        () => `已把“${input.title}”计入长期积累。`,
      ),
  );

  server.registerTool(
    "save_review_draft",
    {
      title: "保存复盘草稿",
      description:
        "保存每日、每周或每月复盘的 AI 草稿。只写 ai_draft，不会覆盖用户已确认的正式 content；创建时 expected_version 为 0，修改时先读取当前版本。",
      inputSchema: {
        review_type: z.enum(["daily", "weekly", "monthly"]),
        period_start: dateSchema,
        period_end: dateSchema,
        expected_version: z.number().int().min(0),
        draft: z.record(z.string(), z.unknown()),
      },
      outputSchema,
      annotations: writeAnnotations,
      _meta: toolMeta("正在保存复盘草稿…", "已保存复盘草稿"),
    },
    async (input) =>
      run(
        () => authorizedRepository().saveReviewDraft(input),
        () => "复盘内容已保存为待确认草稿，没有覆盖正式复盘。",
      ),
  );

  return server;
}
