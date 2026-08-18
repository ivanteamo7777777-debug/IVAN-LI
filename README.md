# 守中日课｜个人每日管理库

个人执行与复盘系统。它把方向、年/月/周计划、每日六件事、执行记录、长期积累和周期复盘连成一条可持续校准的路径。

> 不断更新，但不丢失自己的河道。

这是可安装、可离线记录、可多设备同步的正式 PWA，不依赖 ChatGPT Sites。

## 当前生产环境

- 应用：https://shouzhong-daily.vercel.app
- GitHub：https://github.com/ivanteamo7777777-debug/IVAN-LI
- Supabase 项目：`qiykfmmeanlrlrnzxygv`

## 已实现

- 方向库：Mission、Vision、Value、人生方向与阶段边界，可排序、归档并关联计划。
- 计划库：年度、月度、每周计划均可独立存在；月计划可关联年计划，周计划可直接关联年计划或月计划；支持列表、时间视图、筛选、路径、进度与温和逾期提示。
- 今日执行：每天恰好六个独立编号位置；运动和四类饮食记录完全独立。运动可从昨天多选带入计划字段，饮食可按餐次带入昨天的文字；今天已有饮食文字绝不覆盖，昨天的完成事实、图片、饮水、感受与备注也不会复制。
- 长期积累库：从已完成任务显式收录可复用成果，支持标签、搜索、来源回溯和附件。
- 复盘库：日、周、月、年度复盘；自动统计只生成可编辑草稿。
- 离线优先：Dexie/IndexedDB、本地有序操作队列、断网图片队列、自动重连同步。
- 冲突保护：版本号与更新时间检测；本机版和云端版同时保留，必须由用户选择。
- Supabase：Cookie Session、PostgreSQL、RLS、Storage 私有桶和 Realtime。
- AI 草稿：三个 Next.js Route Handler 通过 OpenAI Responses API 服务端调用；无密钥时不影响核心功能。
- PWA：Manifest、Serwist Service Worker、离线页、安装提示、更新提示、iOS 图标、maskable 图标。
- Web Push：用户主动开启、时区和时间配置、测试通知、Supabase Cron 扫描到期提醒。
- 数据控制：完整 JSON 备份/恢复、核心模块 CSV、回收站、账号与全部数据删除。

## 技术栈

- Next.js 16 App Router、React 19、TypeScript
- Tailwind CSS 4、shadcn/ui 风格的 Radix 组件
- Supabase Auth / PostgreSQL / Storage / Realtime
- Dexie IndexedDB
- Serwist
- OpenAI Responses API
- Vitest、pgTAP、Playwright
- pnpm（版本写入 `packageManager`，lockfile 已提交）

## 环境要求

- Node.js 22 或更高版本
- pnpm 11
- 本地运行 Supabase 测试时需要 Docker
- 生产环境需要 Supabase、GitHub 和 Vercel 账号

复制 `.env.example` 为 `.env.local`，只在本机或 Vercel 项目设置中填写：

| 变量                                   | 使用位置      | 说明                                                                |
| -------------------------------------- | ------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | 浏览器/服务端 | Supabase 项目 URL                                                   |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 浏览器/服务端 | 可公开的 publishable key，实际权限由 RLS 约束                       |
| `SUPABASE_SECRET_KEY`                  | 仅服务端      | 删除账号和定时推送使用；严禁添加 `NEXT_PUBLIC_`                     |
| `OPENAI_API_KEY`                       | 仅服务端      | 可选；未配置时 AI 功能返回可读提示                                  |
| `OPENAI_MODEL`                         | 仅服务端      | 可选；默认 `gpt-5.6-sol`                                            |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`         | 浏览器        | Web Push 公钥                                                       |
| `VAPID_PRIVATE_KEY`                    | 仅服务端      | Web Push 私钥                                                       |
| `VAPID_SUBJECT`                        | 仅服务端      | 如 `mailto:owner@example.com`                                       |
| `CRON_SECRET`                          | 仅服务端      | 保护 `/api/push/send-due`                                           |
| `NEXT_PUBLIC_SITE_URL`                 | 浏览器/服务端 | 正式域名，例如 `https://example.vercel.app`                         |
| `APP_URL`                              | 仅服务端      | MCP 受保护资源的正式域名，例如 `https://shouzhong-daily.vercel.app` |

仓库不读取或提交任何真实密钥，客户端代码也不会引用服务端密钥。

## 本地开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://localhost:3000`。若 Supabase 变量未配置，会进入设置说明页；Playwright 会在本机进程中临时注入仅服务端的 `SHOUZHONG_E2E_MODE=1`，提供隔离测试库。该变量不进入 `.env.example`，且 Vercel 检测到它时会直接拒绝构建。

本地启动完整 Supabase：

```bash
pnpm dlx supabase start
pnpm dlx supabase db reset
```

迁移位于 `supabase/migrations/`。`db reset` 会应用迁移、建立索引/触发器/RLS/Storage 策略，并在新用户注册后写入已经确定的 Mission、Vision 01 和 Value。它不会创建虚假任务或演示记录。

## Supabase 生产配置

1. 新建 Supabase 项目。
2. 在 Auth URL Configuration 中把 Site URL 设为正式 Vercel 地址。
3. 添加 `https://你的域名/auth/callback` 到 Redirect URLs。
4. 关联项目并推送 Git 中的迁移：

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase db push
```

5. 把项目 URL、publishable key 和 secret key 写入 Vercel 环境变量。
6. 在 Supabase Vault 中创建 `shouzhong_site_url` 和 `shouzhong_cron_secret`；
   后者必须与 Vercel 的 `CRON_SECRET` 相同。
7. 在 Supabase 邮件模板和 SMTP 中配置正式发件设置；应用支持密码登录、注册和 magic link。

所有公开业务表都启用并强制执行 RLS。策略只允许 `auth.uid() = user_id` 的拥有者访问；Storage 路径第一段必须是用户 UUID。secret key 只用于服务器端管理操作。

## OpenAI

接口：

- `POST /api/ai/daily-six`
- `POST /api/ai/daily-six/auto`（仅用户时区当天的首次打开模式）
- `PATCH /api/ai/daily-six/auto`（用户确认使用后，以 `expected_version` 标记已应用）
- `POST /api/ai/daily-review`
- `POST /api/ai/period-review`

请求先验证 Cookie Session，再做 Zod 输入限制，只发送当前草稿所需的数据。每日六件事上下文限于方向、当前日期内已启用的计划、当天已有标题、昨天未完成候选的必要字段，以及最近一次复盘的 `tomorrow_adjustment`；不会发送整份复盘、饮食或运动内容。结构化输出通过 Responses API 生成，且 `store: false`。模型返回的计划 ID 会再次与当前用户可见的周计划白名单核对，未知 ID 会被清空。

“每日六件事自动草稿”在设置中默认关闭，可选“每天首次打开今日执行”或“固定时间”。自动输出只保存在 `daily_entries.daily_six_ai_draft`，不会由接口、Cron 或数据库触发器直接写入 `daily_tasks`。已有或用户已编辑的草稿不会被覆盖；确认按钮仍是写入正式任务的唯一入口。只有所选建议全部落入空位且完成同步后，草稿才会标记为 `applied`；空位不足时，未写入建议及用户编辑会继续保留。未配置 `OPENAI_API_KEY` 时自动草稿返回不可用状态，核心记录、同步和提醒不受影响。

## Web Push

生成 VAPID 密钥：

```bash
pnpm exec web-push generate-vapid-keys
```

在 Vercel 配置公钥、私钥、subject 和 `CRON_SECRET`。到期检查由
`202607270002_reminder_cron.sql` 中的 Supabase Cron 每 15 分钟触发，并通过
Vault 中的 `shouzhong_site_url` 与 `shouzhong_cron_secret` 安全调用
`/api/push/send-due`。这样也兼容只允许每日一次 Cron 的 Vercel Hobby 方案。
用户只有主动打开某个提醒开关时，应用才请求通知权限。

同一轮每 15 分钟的 Supabase Cron 也负责检查固定时间 AI 草稿。生成采用数据库条件式抢占：同一天只允许一个任务生成，失败会在一小时的有限窗口内重试，只有草稿成功写入后才更新 `last_daily_six_ai_draft_generated`。Web Push/VAPID 未配置或推送失败不会阻断 AI 草稿，单个用户生成失败也不会影响其他用户。

iPhone/iPad 需要先用 Safari 将应用添加到主屏幕，再从独立应用中开启通知。通知失败只更新订阅状态，不会阻断记录、同步或复盘。

## PWA 安装

- iPad/iPhone：Safari → 分享 →“添加到主屏幕”→ 从新图标启动。
- Android：Chrome 菜单 →“安装应用”或使用应用内安装提示。
- 桌面 Chrome/Edge：地址栏安装图标或应用内安装提示。

新版本就绪时界面会提示刷新。离线时可打开已经访问过的应用外壳，编辑六件事，记录运动、饮食和图片；恢复网络后队列按创建顺序同步。

## ChatGPT / Codex MCP 插件

生产 MCP 地址：

```text
https://shouzhong-daily.vercel.app/mcp
```

MCP 使用 Supabase OAuth 2.1 和用户自己的访问令牌。所有请求继续受现有 RLS 约束，不使用 `service_role`，也不会在插件包中保存密码、密钥或令牌。

已提供的工具：

- 读取今日六件事、多个运动记录、饮食记录和完整计划路径
- 筛选年度/月度/每周计划
- 搜索长期积累与生成周期事实摘要
- 经用户明确确认后修改每日任务、新增运动、保存饮食与长期积累
- 只保存到 `ai_draft` 的复盘草稿，不覆盖正式复盘

写入工具必须携带读取到的 `expected_version`。若另一设备已更新记录，服务会返回当前云端版本并要求用户选择，不会静默覆盖。

仓库内插件包位于 `plugins/shouzhong-daily/`。在 ChatGPT 中连接时，开启开发者模式并添加上面的 MCP 地址；首次连接会跳转到守中日课授权页。Supabase OAuth Server 需要设置：

- Site URL：`https://shouzhong-daily.vercel.app`
- Authorization Path：`/oauth/consent`
- Allow Dynamic OAuth Apps：开启（仅在确认动态客户端注册风险后）

## 同步与冲突

每次修改先写 IndexedDB，再进入操作队列，云端成功后才标为“已同步”。状态栏会显示：

- 已同步
- 等待同步
- 同步失败
- 需要处理冲突

写入前会读取云端版本。若本机和云端都基于旧版本发生变化，系统不会静默覆盖，而是在“设置与数据 → 冲突处理”同时展示两份更新时间，等待选择“保留本机版本”或“使用云端版本”。

## 备份、恢复与删除

- “设置与数据”可下载包含全部本地业务记录的 JSON。
- JSON 恢复会校验备份格式，把导入记录重新归属当前登录用户，再逐项加入同步队列。
- 方向、计划、六件事、运动、饮食、积累和复盘可分别导出带 BOM 的 CSV。
- 普通删除进入软删除回收站，可恢复。
- 删除账号必须输入确认短语；服务器端数据库函数会删除认证用户，并通过外键级联清除业务数据。

建议在重要迁移、批量整理或删除账号前下载 JSON 备份。

## 测试

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:db
```

测试覆盖：

- IndexedDB 操作队列、队列合并、JSON 恢复和冲突保留
- 六个位置唯一性，以及运动/饮食不占位置
- AI 未确认不得写入
- 自动草稿默认关闭、仅当天首次打开、定时幂等与失败重试
- 自动草稿周计划 ID 白名单、`applied` 防重复和跨用户 RLS
- Manifest、图标、Service Worker 注册契约
- 真实浏览器断网重载和离线内容保留
- 桌面、iPad 和手机响应式导航
- SQL 约束、索引、RLS 和 Storage 策略目录验证
- `supabase/tests/` 中的实际 pgTAP 数据库测试（含自动草稿事务与权限）

数据库与 RLS 的集成测试必须在本地 Supabase 或测试项目可用后执行；只做静态 SQL 检查不能替代 `pnpm test:db`。

## GitHub 与 Vercel 部署

首次部署：

```bash
git init
git add .
git commit -m "feat: release shouzhong daily pwa"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY
git push -u origin main
```

在 Vercel 导入该 GitHub 仓库，Framework 选择 Next.js，包管理器自动识别 pnpm。配置全部环境变量后部署。正式部署前确认：

1. Supabase 迁移已全部应用。
2. Auth Site URL 与回调地址使用正式 HTTPS 域名。
3. Vercel 不存在任何 E2E 测试变量；`NEXT_PUBLIC_E2E_MODE` 已被源码明确禁止。
4. VAPID 密钥和 `CRON_SECRET` 已配置。
5. Vercel 构建、登录、上传、推送测试通知和跨设备同步均通过。

生产构建命令为 `pnpm build`，输出由 Vercel 托管；无需也不得创建 `.openai/hosting.json`。

## 维护

- 数据库结构只能通过新迁移演进，不要修改已在生产执行的迁移。
- 更新依赖后提交新的 `pnpm-lock.yaml`，依次执行 lint、类型、单元、E2E 和生产构建。
- 不在日志中输出 AI 输入、饮食、复盘、图片路径或其他私人正文。
- 定期检查失效 push subscription、同步失败记录和 Supabase 数据库备份。
- Realtime 是多设备刷新通道；IndexedDB 队列才是网络错误时防止输入丢失的基础。

## 目录

```text
src/app/                 App Router 页面、Manifest、Service Worker、API
src/components/          五大板块、今日三分区、设置与 PWA 界面
src/lib/local-db.ts      IndexedDB 数据、离线队列、备份与冲突
src/lib/sync-engine.ts   Supabase 顺序同步、Realtime、Storage 上传
src/lib/ai/              OpenAI 服务层与结构化 Schema
supabase/migrations/     PostgreSQL、触发器、索引、RLS、Storage
supabase/tests/          pgTAP 数据库权限与约束测试
tests/unit/              单元与静态安全契约
tests/e2e/               Playwright 核心验收
```
