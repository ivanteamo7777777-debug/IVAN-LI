# 守中日课 MCP 接口说明

生产端点：

```text
https://shouzhong-daily.vercel.app/mcp
```

MCP 使用 Supabase OAuth 登录用户的访问令牌，并继续受数据库 RLS 约束。浏览器端、插件包和 MCP 返回内容中均不得出现服务端密钥。

## 写入约束

1. 修改前先调用 `get_today`、`get_plan` 或 `list_plans` 读取当前记录。
2. 只有用户在当前对话中明确确认后才能调用写入工具。
3. 修改现有记录必须携带刚读取到的 `expected_version`。
4. 版本冲突时重新读取并交给用户选择，不得静默覆盖。
5. AI 建议只能作为草稿；不得自动延期未完成任务。
6. 每日任务只能使用 1–6 六个独立位置，运动和饮食使用各自接口。
7. 同时修改多个位置时优先调用 `batch_update_daily_tasks`，并保持默认 `atomic: true`。

## 统一返回结构

成功：

```json
{
  "status": "ok",
  "message": "已更新 2026-07-28 第 6 件事。",
  "data": {}
}
```

失败：

```json
{
  "status": "error",
  "code": "VERSION_CONFLICT",
  "message": "数据已被修改，请重新读取后再提交。",
  "details": {}
}
```

MCP 的 `content` 始终包含同一结构的 JSON 文本，`structuredContent` 包含对应对象。错误结果同时设置 `isError: true`，不存在空返回。

主要错误码：

| 错误码                 | 含义                                     |
| ---------------------- | ---------------------------------------- |
| `INVALID_ARGUMENT`     | 日期、UUID、位置、状态或 patch 不合法    |
| `UNAUTHORIZED`         | 登录或 OAuth 授权失效                    |
| `NOT_FOUND`            | 当前用户范围内未找到记录                 |
| `RECORD_DELETED`       | 记录已软删除                             |
| `RECORD_ARCHIVED`      | 记录已归档，不能写入                     |
| `VERSION_CONFLICT`     | `expected_version` 与云端版本不一致      |
| `HIERARCHY_VIOLATION`  | 计划父子层级或每日任务的周计划关联不合法 |
| `CYCLE_DETECTED`       | 修改父计划会形成循环                     |
| `IDEMPOTENCY_CONFLICT` | 同一 UUID 已用于内容不同的计划           |
| `BATCH_UPDATE_FAILED`  | 原子批量中的任一项失败，整批已回滚       |
| `PARTIAL_FAILURE`      | 明确使用 `atomic: false` 后部分项目失败  |
| `DATABASE_ERROR`       | 数据库执行失败                           |
| `INTERNAL_ERROR`       | 服务返回异常或未识别异常                 |

## 核心工具

### `get_today`

读取指定日期的六件事、多个运动记录、饮食记录与任务上游路径。

```json
{ "date": "2026-07-28" }
```

### `list_directions`

读取当前用户未删除、未归档的方向及 UUID。年度计划需要关联方向时，先用它取得 `direction_id`；方向也可以不选。

```json
{}
```

### `update_daily_task`

只修改一个已经存在的位置，不会创建或替换其他位置。

```json
{
  "date": "2026-07-28",
  "slot_index": 6,
  "expected_version": 1,
  "patch": {
    "title": "准备周三和查米达开会的内容",
    "status": "not_started",
    "weekly_plan_id": null
  }
}
```

允许的 patch 字段：`title`、`importance`、`completion_standard`、`first_action`、`weekly_plan_id`、`status`、`result`、`completed_at`、`notes`。

### `batch_update_daily_tasks`

一次更新 1–6 个不重复位置。默认原子提交；任何位置校验或版本失败时，之前的更新也会回滚。

```json
{
  "date": "2026-07-28",
  "tasks": [
    {
      "slot_index": 1,
      "expected_version": 1,
      "patch": {
        "title": "帽子事业部研究",
        "status": "not_started"
      }
    },
    {
      "slot_index": 2,
      "expected_version": 1,
      "patch": {
        "title": "列出年计划、月计划和周计划",
        "status": "not_started"
      }
    }
  ],
  "atomic": true
}
```

只有调用方明确传入 `atomic: false` 才允许部分成功。此时任何失败会返回 `PARTIAL_FAILURE`，`details.successful_tasks` 和 `details.errors` 会分别列出结果；调用方必须重新读取后只处理失败项，不能原样重试整批。

### `list_plans`

按类型、状态和相交日期范围筛选计划，并返回上游路径。没有传 `status` 时默认排除已归档计划。

```json
{
  "plan_type": "weekly",
  "status": "active",
  "period_start": "2026-07-27",
  "period_end": "2026-08-09"
}
```

### `get_plan`

精确读取一条计划，返回当前 `version`、`parent_plan`、`upstream_path`、直接下级数、全部后代数和关联每日任务数。

```json
{ "plan_id": "00000000-0000-4000-8000-000000000001" }
```

### `create_plan`

客户端生成 UUID 作为幂等键。相同 UUID 和相同内容重复调用时返回已有记录，不重复创建；相同 UUID 配不同内容返回 `IDEMPOTENCY_CONFLICT`。

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "plan_type": "weekly",
  "title": "完成辅料统计与分析",
  "period_start": "2026-07-27",
  "period_end": "2026-08-02",
  "status": "active",
  "importance": "",
  "objective": "",
  "completion_standard": "",
  "first_action": "",
  "parent_plan_id": "00000000-0000-4000-8000-000000000002",
  "direction_id": null,
  "notes": ""
}
```

层级规则：

- 年度计划的 `direction_id` 可为空；如选择方向，必须属于当前用户。年度计划的 `parent_plan_id` 始终为空。
- 月计划的 `parent_plan_id` 可为空；如选择上级，只能关联当前用户有效的年计划，不能直接关联方向。
- 周计划的 `parent_plan_id` 可为空；如选择上级，可直接关联当前用户有效的年计划或月计划，不能直接关联方向。
- 独立计划的 `upstream_path` 只包含计划本身；以后可以通过 `update_plan` 补充或取消上级关系。
- 非自然周、自然月或自然年只返回 `warnings`，不阻止创建。

### `update_plan`

先调用 `get_plan` 或 `list_plans`，再用读取到的版本进行乐观锁修改。

```json
{
  "plan_id": "00000000-0000-4000-8000-000000000001",
  "expected_version": 1,
  "patch": {
    "title": "完成辅料统计与分析（修订）",
    "status": "active",
    "notes": "确认后的修改"
  }
}
```

允许的 patch 字段：`title`、`objective`、`period_start`、`period_end`、`status`、`importance`、`completion_standard`、`first_action`、`parent_plan_id`、`notes`。`id`、`user_id`、`created_at`、`plan_type`、`direction_id` 不可修改。`parent_plan_id: null` 表示取消上下级关系；选择父计划时会重新验证所有权、层级和循环引用。

## 本地验证

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm exec supabase start
pnpm test:db
```

生产真实数据验收脚本默认拒绝执行。它会先读取现有任务和计划；任一位置已有不同内容时立即停止，不会覆盖。

```bash
RUN_REAL_MCP_ACCEPTANCE=1 \
MCP_URL=https://shouzhong-daily.vercel.app/mcp \
MCP_ACCESS_TOKEN=用户访问令牌 \
pnpm test:acceptance:mcp
```

## 部署前检查

- 新迁移已在升级数据库执行，69 项 pgTAP 均通过；CI 会在空数据库重新执行全部迁移。
- Supabase 公共业务表继续启用并强制执行 RLS。
- RPC 只授权 `authenticated`，没有向 `anon` 或 `public` 授权。
- Vercel 未配置任何 E2E 测试变量；本地测试只使用不会进入浏览器包的 `SHOUZHONG_E2E_MODE`，且 Vercel 检测到它会拒绝构建。客户端也没有可见的服务端密钥。
- `tools/list` 能看到 `get_today`、`list_directions`、`update_daily_task`、`batch_update_daily_tasks`、`list_plans`、`get_plan`、`create_plan`、`update_plan`。
- OAuth 未登录时返回认证挑战，登录后只能读写当前用户数据。
- 连续写入 1–6、第 6 位置、原子回滚、幂等创建、乐观锁、非法层级、循环引用与跨用户访问测试全部通过。
- 部署后先运行只读检查，再执行受保护的真实数据验收。
