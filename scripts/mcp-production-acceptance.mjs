import { createHash } from "node:crypto";

const mcpUrl = process.env.MCP_URL ?? "https://shouzhong-daily.vercel.app/mcp";
const accessToken = process.env.MCP_ACCESS_TOKEN;

if (process.env.RUN_REAL_MCP_ACCEPTANCE !== "1") {
  throw new Error(
    "必须显式设置 RUN_REAL_MCP_ACCEPTANCE=1 才能运行真实数据验收。",
  );
}
if (!accessToken) {
  throw new Error("缺少 MCP_ACCESS_TOKEN，未执行任何写入。");
}

let requestId = 1;

async function callTool(name, args) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(
      `MCP_TRANSPORT_ERROR: ${payload.error?.message ?? response.status}`,
    );
  }
  let envelope = payload.result?.structuredContent;
  if (!envelope && payload.result?.content?.[0]?.text) {
    envelope = JSON.parse(payload.result.content[0].text);
  }
  if (!envelope || envelope.status !== "ok") {
    const code = envelope?.code ?? "INVALID_MCP_RESPONSE";
    const error = new Error(
      `${code}: ${envelope?.message ?? "MCP 未返回有效结果"}`,
    );
    error.code = code;
    error.details = envelope?.details ?? {};
    throw error;
  }
  return envelope.data;
}

function stableUuid(value) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

const date = "2026-07-28";
const desiredTasks = [
  "帽子事业部研究",
  "列出年计划、月计划和周计划",
  "看完《超体》前十章内容",
  "辅料系统做完 50%",
  "尝试柬埔寨工价系统",
  "准备周三和查米达开会的内容",
];
const desiredPlans = [
  {
    title: "完成辅料统计与分析",
    period_start: "2026-07-27",
    period_end: "2026-08-02",
  },
  {
    title: "完成辅料单机系统",
    period_start: "2026-07-27",
    period_end: "2026-08-02",
  },
  {
    title: "完成柬埔寨工价统计单机计算系统",
    period_start: "2026-08-03",
    period_end: "2026-08-09",
  },
];

const today = await callTool("get_today", { date });
const tasksBySlot = new Map(
  (today.daily_tasks ?? []).map((task) => [Number(task.slot_index), task]),
);
for (let slotIndex = 1; slotIndex <= 6; slotIndex += 1) {
  const current = tasksBySlot.get(slotIndex);
  if (!current) {
    throw new Error(
      `NOT_FOUND: ${date} 第 ${slotIndex} 个位置尚未同步到云端，未执行任何验收写入。`,
    );
  }
  const existingTitle = String(current.title ?? "").trim();
  if (existingTitle && existingTitle !== desiredTasks[slotIndex - 1]) {
    throw new Error(
      `EXISTING_DATA_MISMATCH: ${date} 第 ${slotIndex} 个位置已有不同内容，未覆盖。`,
    );
  }
}

const plans = await callTool("list_plans", {
  period_start: "2026-07-01",
  period_end: "2026-08-31",
});
const monthlyPlans = plans.filter((plan) => plan.plan_type === "monthly");

function prepareWeeklyPlan(definition) {
  const existing = plans.find(
    (plan) =>
      plan.plan_type === "weekly" &&
      plan.title === definition.title &&
      plan.period_start === definition.period_start &&
      plan.period_end === definition.period_end,
  );
  if (existing) return { definition, existing, id: existing.id, parent: null };

  const parent = monthlyPlans.find(
    (plan) =>
      plan.period_start <= definition.period_start &&
      plan.period_end >= definition.period_start,
  );
  if (!parent) {
    throw new Error(
      `PARENT_PLAN_NOT_FOUND: ${definition.period_start} 没有可关联的月计划，未新增周计划。`,
    );
  }
  return {
    definition,
    existing: null,
    parent,
    id: stableUuid(
      `shouzhong-production-acceptance:${definition.title}:${definition.period_start}`,
    ),
  };
}

const planCandidates = desiredPlans.map(prepareWeeklyPlan);
const plannedLinks = new Map([
  [4, planCandidates[1].id],
  [5, planCandidates[2].id],
]);
for (const [slotIndex, weeklyPlanId] of plannedLinks) {
  const current = tasksBySlot.get(slotIndex);
  if (current.weekly_plan_id && current.weekly_plan_id !== weeklyPlanId) {
    throw new Error(
      `EXISTING_PLAN_LINK_MISMATCH: ${date} 第 ${slotIndex} 个位置已有其他周计划关联，未新增计划或覆盖任务。`,
    );
  }
}

async function ensureWeeklyPlan(candidate) {
  if (candidate.existing) return candidate.existing;
  const { definition, parent, id } = candidate;
  return callTool("create_plan", {
    id,
    plan_type: "weekly",
    title: definition.title,
    period_start: definition.period_start,
    period_end: definition.period_end,
    status: "active",
    importance: "",
    completion_standard: "",
    first_action: "",
    parent_plan_id: parent.id,
    notes: "",
  });
}

const ensuredPlans = [];
for (const candidate of planCandidates) {
  ensuredPlans.push(await ensureWeeklyPlan(candidate));
}

const linkedPlans = new Map([
  [4, ensuredPlans[1].id],
  [5, ensuredPlans[2].id],
]);
const batchTasks = desiredTasks.map((title, index) => {
  const slotIndex = index + 1;
  const current = tasksBySlot.get(slotIndex);
  const patch = { title };
  if (!String(current.title ?? "").trim()) patch.status = "not_started";
  const weeklyPlanId = linkedPlans.get(slotIndex);
  if (weeklyPlanId) {
    patch.weekly_plan_id = weeklyPlanId;
  }
  return {
    slot_index: slotIndex,
    expected_version: Number(current.version),
    patch,
  };
});

await callTool("batch_update_daily_tasks", {
  date,
  tasks: batchTasks,
  atomic: true,
});

const verified = await callTool("get_today", { date });
for (let slotIndex = 1; slotIndex <= 6; slotIndex += 1) {
  const task = verified.daily_tasks.find(
    (candidate) => Number(candidate.slot_index) === slotIndex,
  );
  if (!task || task.title !== desiredTasks[slotIndex - 1]) {
    throw new Error(`VERIFY_FAILED: 第 ${slotIndex} 个位置读取结果不一致。`);
  }
}
for (const slotIndex of [4, 5]) {
  const task = verified.daily_tasks.find(
    (candidate) => Number(candidate.slot_index) === slotIndex,
  );
  if (!task.weekly_plan_id || !Array.isArray(task.upstream_path)) {
    throw new Error(`VERIFY_FAILED: 第 ${slotIndex} 个位置缺少计划路径。`);
  }
}

console.log("真实 MCP 验收通过：3 条周计划与 6 个每日位置均已校验。");
