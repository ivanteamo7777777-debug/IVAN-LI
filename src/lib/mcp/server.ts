import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  McpServiceError,
  type JsonRecord,
  type McpRepository,
} from "@/lib/mcp/repository";

const transportDateSchema = z.string().describe("有效日期，格式 YYYY-MM-DD");
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "请使用 YYYY-MM-DD 日期格式")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "日期不存在");
const optionalText = (max: number) => z.string().max(max).optional();
const outputSchema = {
  status: z.enum(["ok", "error"]),
  message: z.string(),
  data: z.unknown().optional(),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
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
  {
    type: "oauth2" as const,
    scopes: ["openid", "email", "profile"],
  },
];

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

type ToolEnvelope =
  | { status: "ok"; message: string; data: unknown }
  | {
      status: "error";
      code: string;
      message: string;
      details: JsonRecord;
    };

function toolResult(
  envelope: ToolEnvelope,
  options: Pick<CallToolResult, "_meta"> = {},
): CallToolResult {
  return {
    ...options,
    isError: envelope.status === "error" ? true : undefined,
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
}

function ok(message: string, data: unknown): CallToolResult {
  return toolResult({ status: "ok", message, data });
}

function fail(error: unknown): CallToolResult {
  if (error instanceof McpUnauthorizedError) {
    return toolResult(
      {
        status: "error",
        code: "UNAUTHORIZED",
        message: error.message,
        details: {},
      },
      { _meta: { "mcp/www_authenticate": [error.challenge] } },
    );
  }

  if (error instanceof McpServiceError) {
    return toolResult({
      status: "error",
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }

  return toolResult({
    status: "error",
    code: "INTERNAL_ERROR",
    message: "守中日课暂时无法完成这次操作。",
    details: {
      error_type: error instanceof Error ? error.name : "UnknownError",
    },
  });
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

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new McpServiceError("INVALID_ARGUMENT", "参数校验失败。", {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

async function runWithInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  operation: (parsed: T) => Promise<unknown>,
  message: (data: unknown, parsed: T) => string,
) {
  let parsedInput: T | undefined;
  return run(
    async () => {
      parsedInput = parseInput(schema, input);
      return operation(parsedInput);
    },
    (data) => message(data, parsedInput as T),
  );
}

const planTypeSchema = z.enum(["annual", "monthly", "weekly"]);
const planStatusSchema = z.enum([
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
]);
const taskStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "completed",
  "not_completed",
  "not_scheduled",
]);

const dailyTaskPatchSchema = z
  .object({
    title: optionalText(200),
    importance: optionalText(4000),
    completion_standard: optionalText(4000),
    first_action: optionalText(4000),
    weekly_plan_id: z.string().uuid().nullable().optional(),
    status: taskStatusSchema.optional(),
    result: optionalText(8000),
    completed_at: z.string().datetime().nullable().optional(),
    notes: optionalText(8000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少修改一个字段");

const dailyTaskUpdateSchema = z
  .object({
    date: dateSchema,
    slot_index: z.number().int().min(1).max(6),
    expected_version: z.number().int().positive(),
    patch: dailyTaskPatchSchema,
  })
  .strict();

const batchDailyTaskUpdateSchema = z
  .object({
    date: dateSchema,
    tasks: z
      .array(
        z
          .object({
            slot_index: z.number().int().min(1).max(6),
            expected_version: z.number().int().positive(),
            patch: dailyTaskPatchSchema,
          })
          .strict(),
      )
      .min(1)
      .max(6)
      .superRefine((tasks, context) => {
        const slots = new Set<number>();
        tasks.forEach((task, index) => {
          if (slots.has(task.slot_index)) {
            context.addIssue({
              code: "custom",
              path: [index, "slot_index"],
              message: "同一批次不能重复修改同一个位置",
            });
          }
          slots.add(task.slot_index);
        });
      }),
    atomic: z.boolean().default(true),
  })
  .strict();

const planCreateSchema = z
  .object({
    id: z.string().uuid(),
    plan_type: planTypeSchema,
    title: z.string().trim().min(1).max(200),
    period_start: dateSchema,
    period_end: dateSchema,
    status: planStatusSchema.default("draft"),
    importance: z.string().max(4000).default(""),
    objective: z.string().max(8000).default(""),
    completion_standard: z.string().max(8000).default(""),
    first_action: z.string().max(8000).default(""),
    parent_plan_id: z.string().uuid().nullable().default(null),
    direction_id: z.string().uuid().nullable().default(null),
    notes: z.string().max(12000).default(""),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.period_start > value.period_end) {
      context.addIssue({
        code: "custom",
        path: ["period_end"],
        message: "结束日期不能早于开始日期",
      });
    }
    if (value.plan_type === "annual") {
      if (value.parent_plan_id !== null) {
        context.addIssue({
          code: "custom",
          path: ["parent_plan_id"],
          message: "年度计划不能设置上级计划",
        });
      }
      if (value.direction_id === null) {
        context.addIssue({
          code: "custom",
          path: ["direction_id"],
          message: "年度计划必须关联当前用户的方向",
        });
      }
    } else if (value.parent_plan_id === null) {
      context.addIssue({
        code: "custom",
        path: ["parent_plan_id"],
        message: "月度和每周计划必须设置上级计划",
      });
    }
  });

const planUpdatePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    objective: optionalText(8000),
    period_start: dateSchema.optional(),
    period_end: dateSchema.optional(),
    status: planStatusSchema.optional(),
    importance: optionalText(4000),
    completion_standard: optionalText(8000),
    first_action: optionalText(8000),
    parent_plan_id: z.string().uuid().nullable().optional(),
    notes: optionalText(12000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少修改一个字段");

const planUpdateSchema = z
  .object({
    plan_id: z.string().uuid(),
    expected_version: z.number().int().positive(),
    patch: planUpdatePatchSchema,
  })
  .strict();

const getPlanSchema = z.object({ plan_id: z.string().uuid() }).strict();
const patchTransportSchema = z
  .record(z.string(), z.unknown())
  .describe("仅允许工具说明中列出的可修改字段");

const exerciseCreateSchema = z
  .object({
    id: z.string().uuid(),
    entry_date: dateSchema,
    planned: z.boolean().default(false),
    activity: z.string().trim().min(1).max(200),
    planned_minutes: z.number().int().min(0).nullable().optional(),
    actual_minutes: z.number().int().min(0).nullable().optional(),
    intensity: z.enum(["light", "moderate", "high"]).nullable().optional(),
    status: z.enum(["not_started", "completed", "skipped"]),
    body_feeling: z.string().max(4000).default(""),
    notes: z.string().max(8000).default(""),
  })
  .strict();

const mealPatchSchema = z
  .object({
    content: optionalText(8000),
    hydration_ml: z.number().int().min(0).max(30000).optional(),
    overall_feeling: optionalText(4000),
    notes: optionalText(8000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少写入一个字段");

const mealUpsertSchema = z
  .object({
    entry_date: dateSchema,
    meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    expected_version: z.number().int().min(0),
    patch: mealPatchSchema,
  })
  .strict();

const accumulationCreateSchema = z
  .object({
    id: z.string().uuid(),
    entry_date: dateSchema,
    title: z.string().trim().min(1).max(200),
    content: z.string().max(12000).default(""),
    tags: z.array(z.string().max(40)).max(20).default([]),
    source_task_id: z.string().uuid().nullable().default(null),
    source_plan_id: z.string().uuid().nullable().default(null),
    attachment_paths: z.array(z.string().max(500)).max(20).default([]),
    reusable_conclusion: z.string().max(8000).default(""),
    next_use: z.string().max(8000).default(""),
  })
  .strict();

const reviewDraftSchema = z
  .object({
    review_type: z.enum(["daily", "weekly", "monthly"]),
    period_start: dateSchema,
    period_end: dateSchema,
    expected_version: z.number().int().min(0),
    draft: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    (value) => value.period_start <= value.period_end,
    "结束日期不能早于开始日期",
  );

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
      version: "1.1.0",
    },
    {
      instructions:
        "守中日课是个人执行与复盘系统。写入前必须先读取当前记录；只有用户在当前对话中明确确认后才能调用写入工具。AI 生成的六件事和复盘只能保存为草稿，不能当作事实或自动覆盖正式数据。不得自动延期未完成任务。每日六件事只使用 1–6 的独立位置；运动与饮食是独立记录。所有修改都应携带读取到的 expected_version，冲突时把本地与云端差异交给用户选择。一次修改多个位置时优先使用 batch_update_daily_tasks，默认原子提交。",
    },
  );

  server.registerTool(
    "get_today",
    {
      title: "读取今日执行",
      description:
        "读取指定日期的六件事、多个运动记录和饮食记录。写入任何当天数据前先调用本工具取得 id、version 与完整上游路径。",
      inputSchema: {
        date: transportDateSchema.describe("要读取的日期，格式 YYYY-MM-DD"),
      },
      outputSchema,
      annotations: readAnnotations,
      _meta: toolMeta("正在读取今日执行…", "已读取今日执行"),
    },
    async (input) =>
      runWithInput(
        z.object({ date: dateSchema }).strict(),
        input,
        ({ date }) => authorizedRepository().getToday(date),
        (_data, { date }) => `已读取 ${date} 的今日执行记录。`,
      ),
  );

  server.registerTool(
    "list_directions",
    {
      title: "读取方向",
      description:
        "读取当前用户未删除、未归档的方向及其 UUID。新增年度计划前先调用本工具取得 direction_id；本工具只读，不会修改方向。",
      inputSchema: {},
      outputSchema,
      annotations: readAnnotations,
      _meta: toolMeta("正在读取方向…", "已读取方向"),
    },
    async () =>
      run(
        () => authorizedRepository().listDirections(),
        (data) => `已读取 ${(data as unknown[]).length} 条方向。`,
      ),
  );

  server.registerTool(
    "list_plans",
    {
      title: "读取计划",
      description:
        "按层级、状态和时间范围读取年度、月度或每周计划，并返回完整上游路径。修改计划前先读取当前 version；未指定状态时默认不返回已归档计划。",
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
    "get_plan",
    {
      title: "读取单个计划",
      description:
        "按 plan_id 精确读取当前用户的一条计划，包含完整信息、version、parent_plan、upstream_path、下级计划数量和关联每日任务数量。update_plan 前必须先调用本工具或 list_plans。",
      inputSchema: {
        plan_id: z.string().describe("计划 UUID"),
      },
      outputSchema,
      annotations: readAnnotations,
      _meta: toolMeta("正在读取计划详情…", "已读取计划详情"),
    },
    async (input) =>
      runWithInput(
        getPlanSchema,
        input,
        ({ plan_id }) => authorizedRepository().getPlan(plan_id),
        () => "已读取计划详情。",
      ),
  );

  server.registerTool(
    "create_plan",
    {
      title: "新增计划",
      description:
        "新增年度、月度或周计划。需要用户在当前对话中明确确认。客户端提供 UUID 作为幂等键，相同 ID 不得重复创建。月计划必须关联年计划，周计划必须关联月计划；年度计划必须通过 direction_id 关联当前用户的方向。非自然周、月、年只返回 warning，不会强制阻止。",
      inputSchema: {
        id: z.string().describe("客户端生成的幂等 UUID"),
        plan_type: z.string().describe("annual | monthly | weekly"),
        title: z.string().describe("计划标题"),
        period_start: transportDateSchema,
        period_end: transportDateSchema,
        status: z
          .string()
          .optional()
          .describe("draft | active | paused | completed | archived"),
        importance: z.string().optional(),
        objective: z.string().optional().describe("目标说明"),
        completion_standard: z.string().optional(),
        first_action: z.string().optional(),
        parent_plan_id: z
          .string()
          .nullable()
          .optional()
          .describe("月计划的年计划父级，或周计划的月计划父级"),
        direction_id: z
          .string()
          .nullable()
          .optional()
          .describe("年度计划必须关联的方向 UUID"),
        notes: z.string().optional(),
      },
      outputSchema,
      annotations: { ...writeAnnotations, idempotentHint: true },
      _meta: toolMeta("正在新增计划…", "已新增计划"),
    },
    async (input) =>
      runWithInput(
        planCreateSchema,
        input,
        (parsed) => authorizedRepository().createPlan(parsed),
        (data, parsed) => {
          const labels = {
            annual: "年度",
            monthly: "月度",
            weekly: "周",
          } as const;
          return (data as JsonRecord).idempotent_replay
            ? "该计划已存在，未重复创建。"
            : `已新增${labels[parsed.plan_type]}计划。`;
        },
      ),
  );

  server.registerTool(
    "update_plan",
    {
      title: "修改计划",
      description:
        "修改现有计划。调用前必须先读取当前计划并取得 version，写入时携带 expected_version，且需要用户在当前对话中明确确认。不得自动延期、覆盖或改变计划层级；修改父计划时会重新校验层级与循环引用。",
      inputSchema: {
        plan_id: z.string().describe("计划 UUID"),
        expected_version: z.number().int().describe("读取到的当前 version"),
        patch: patchTransportSchema.describe(
          "允许 title、objective、period_start、period_end、status、importance、completion_standard、first_action、parent_plan_id、notes",
        ),
      },
      outputSchema,
      annotations: writeAnnotations,
      _meta: toolMeta("正在修改计划…", "已修改计划"),
    },
    async (input) =>
      runWithInput(
        planUpdateSchema,
        input,
        (parsed) => authorizedRepository().updatePlan(parsed),
        () => "已修改计划。",
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
        () => authorizedRepository().getPeriodSummary(period_start, period_end),
        () => `已汇总 ${period_start} 至 ${period_end} 的执行数据。`,
      ),
  );

  server.registerTool(
    "update_daily_task",
    {
      title: "修改每日六件事",
      description:
        "修改指定日期和位置的一件事。调用前必须先用 get_today 读取当前 version，并得到用户明确确认；不得自动延期或替换其他位置。记录必须已存在，slot_index 只能是 1–6，版本冲突不会覆盖云端数据。",
      inputSchema: {
        date: transportDateSchema,
        slot_index: z.number().int().describe("独立位置编号 1–6"),
        expected_version: z.number().int().describe("get_today 返回的 version"),
        patch: patchTransportSchema.describe(
          "允许 title、importance、completion_standard、first_action、weekly_plan_id、status、result、completed_at、notes",
        ),
      },
      outputSchema,
      annotations: writeAnnotations,
      _meta: toolMeta("正在更新每日六件事…", "已更新每日六件事"),
    },
    async (input) =>
      runWithInput(
        dailyTaskUpdateSchema,
        input,
        (parsed) => authorizedRepository().updateDailyTask(parsed),
        (_data, parsed) =>
          `已更新 ${parsed.date} 第 ${parsed.slot_index} 件事。`,
      ),
  );

  server.registerTool(
    "batch_update_daily_tasks",
    {
      title: "批量修改每日六件事",
      description:
        "批量更新指定日期的每日六件事。调用前必须先用 get_today 读取每个位置的 version，并得到用户明确确认。默认使用原子事务，全部成功或全部失败，不得部分覆盖；只有明确传入 atomic=false 才允许部分成功。不得自动延期或替换未包含的位置。",
      inputSchema: {
        date: transportDateSchema,
        tasks: z
          .array(
            z.object({
              slot_index: z.number().int().describe("独立位置编号 1–6"),
              expected_version: z.number().int().describe("该位置当前 version"),
              patch: patchTransportSchema,
            }),
          )
          .describe("1–6 条且 slot_index 不重复"),
        atomic: z
          .boolean()
          .optional()
          .describe("默认 true；只有明确设为 false 才允许部分成功"),
      },
      outputSchema,
      annotations: writeAnnotations,
      _meta: toolMeta("正在批量更新每日六件事…", "已批量更新每日六件事"),
    },
    async (input) =>
      runWithInput(
        batchDailyTaskUpdateSchema,
        input,
        (parsed) => authorizedRepository().batchUpdateDailyTasks(parsed),
        (data, parsed) => {
          const count = Array.isArray((data as JsonRecord).tasks)
            ? ((data as JsonRecord).tasks as unknown[]).length
            : parsed.tasks.length;
          return `已批量更新 ${parsed.date} 的 ${count} 件事。`;
        },
      ),
  );

  server.registerTool(
    "add_exercise",
    {
      title: "新增运动记录",
      description:
        "在指定日期新增一条独立运动记录，同一天可新增多条。需要用户明确确认；id 由客户端生成 UUID，重复调用相同 id 不会重复创建。",
      inputSchema: {
        id: z.string().describe("客户端生成的幂等 UUID"),
        entry_date: transportDateSchema,
        planned: z.boolean().default(false),
        activity: z.string().max(200),
        planned_minutes: z.number().int().nullable().optional(),
        actual_minutes: z.number().int().nullable().optional(),
        intensity: z
          .string()
          .nullable()
          .optional()
          .describe("light | moderate | high"),
        status: z.string().describe("not_started | completed | skipped"),
        body_feeling: z.string().max(4000).default(""),
        notes: z.string().max(8000).default(""),
      },
      outputSchema,
      annotations: { ...writeAnnotations, idempotentHint: true },
      _meta: toolMeta("正在新增运动记录…", "已新增运动记录"),
    },
    async (input) =>
      runWithInput(
        exerciseCreateSchema,
        input,
        (parsed) => authorizedRepository().addExercise(parsed),
        (_data, parsed) => `已新增 ${parsed.entry_date} 的运动记录。`,
      ),
  );

  server.registerTool(
    "upsert_meal_log",
    {
      title: "新增或修改饮食记录",
      description:
        "新增或修改指定日期的一餐。创建时 expected_version 为 0；修改前先用 get_today 取得当前 version，并获得用户明确确认。",
      inputSchema: {
        entry_date: transportDateSchema,
        meal_type: z.string().describe("breakfast | lunch | dinner | snack"),
        expected_version: z.number().int(),
        patch: patchTransportSchema.describe(
          "允许 content、hydration_ml、overall_feeling、notes",
        ),
      },
      outputSchema,
      annotations: writeAnnotations,
      _meta: toolMeta("正在保存饮食记录…", "已保存饮食记录"),
    },
    async (input) =>
      runWithInput(
        mealUpsertSchema,
        input,
        (parsed) => authorizedRepository().upsertMeal(parsed),
        (_data, parsed) => `已保存 ${parsed.entry_date} 的饮食记录。`,
      ),
  );

  server.registerTool(
    "add_accumulation",
    {
      title: "计入长期积累",
      description:
        "把用户明确选择留下的成果计入长期积累。不得把所有已完成任务自动写入；id 由客户端生成 UUID，重复调用相同 id 不会重复创建。",
      inputSchema: {
        id: z.string().describe("客户端生成的幂等 UUID"),
        entry_date: transportDateSchema,
        title: z.string(),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
        source_task_id: z.string().nullable().optional(),
        source_plan_id: z.string().nullable().optional(),
        attachment_paths: z.array(z.string()).optional(),
        reusable_conclusion: z.string().optional(),
        next_use: z.string().optional(),
      },
      outputSchema,
      annotations: { ...writeAnnotations, idempotentHint: true },
      _meta: toolMeta("正在计入长期积累…", "已计入长期积累"),
    },
    async (input) =>
      runWithInput(
        accumulationCreateSchema,
        input,
        (parsed) => authorizedRepository().addAccumulation(parsed),
        (_data, parsed) => `已把“${parsed.title}”计入长期积累。`,
      ),
  );

  server.registerTool(
    "save_review_draft",
    {
      title: "保存复盘草稿",
      description:
        "保存每日、每周或每月复盘的 AI 草稿。只写 ai_draft，不会覆盖用户已确认的正式 content；创建时 expected_version 为 0，修改时先读取当前版本。",
      inputSchema: {
        review_type: z.string().describe("daily | weekly | monthly"),
        period_start: transportDateSchema,
        period_end: transportDateSchema,
        expected_version: z.number().int(),
        draft: z.record(z.string(), z.unknown()),
      },
      outputSchema,
      annotations: writeAnnotations,
      _meta: toolMeta("正在保存复盘草稿…", "已保存复盘草稿"),
    },
    async (input) =>
      runWithInput(
        reviewDraftSchema,
        input,
        (parsed) => authorizedRepository().saveReviewDraft(parsed),
        () => "复盘内容已保存为待确认草稿，没有覆盖正式复盘。",
      ),
  );

  return server;
}
