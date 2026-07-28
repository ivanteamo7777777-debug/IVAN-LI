// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/202607260001_initial_schema.sql"),
  "utf8",
);
const mcpWriteMigration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/202607280004_mcp_write_transactions.sql",
  ),
  "utf8",
);

describe("production contracts", () => {
  it("enforces the six-slot uniqueness and range in PostgreSQL", () => {
    expect(migration).toContain("slot_index between 1 and 6");
    expect(migration).toContain(
      "daily_tasks_user_date_slot_unique unique (user_id, entry_date, slot_index)",
    );
  });

  it("enables and forces RLS for every public user table", () => {
    expect(migration).toContain(
      "alter table public.%I enable row level security",
    );
    expect(migration).toContain(
      "alter table public.%I force row level security",
    );
    expect(migration).toContain(
      '"owner select" on public.%I for select to authenticated',
    );
    expect(migration).toContain(
      '"owner insert" on public.%I for insert to authenticated',
    );
  });

  it("keeps storage private and scoped to the first user-id path segment", () => {
    expect(migration).toContain("'meal-photos',");
    expect(migration).toContain("'attachments',");
    expect(migration).toContain(
      "(storage.foldername(name))[1] = (select auth.uid())::text",
    );
  });

  it("declares an installable standalone manifest with all required icons", () => {
    const data = manifest();
    expect(data.display).toBe("standalone");
    expect(data.start_url).toBe("/today");
    expect(data.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });

  it("keeps AI write confirmation in the client and server-only key access", () => {
    const today = fs.readFileSync(
      path.join(root, "src/components/today/today-view.tsx"),
      "utf8",
    );
    const service = fs.readFileSync(
      path.join(root, "src/lib/ai/service.ts"),
      "utf8",
    );
    expect(today).toContain("确认写入空位");
    expect(today).toContain("只会写入空余位置");
    expect(service).toContain("process.env.OPENAI_API_KEY");
    expect(service).not.toContain("NEXT_PUBLIC_OPENAI");
  });

  it("implements service-worker offline fallback and notification click routing", () => {
    const sw = fs.readFileSync(path.join(root, "src/app/sw.ts"), "utf8");
    expect(sw).toContain('url: "/offline"');
    expect(sw).toContain('self.addEventListener("push"');
    expect(sw).toContain('self.addEventListener("notificationclick"');
    expect(sw).toContain("shouldCacheAuthenticatedNavigation");
    expect(sw).toContain("shouzhong-authenticated-shell-v2");
  });

  it("persists password sessions through a server-set cookie response", () => {
    const login = fs.readFileSync(
      path.join(root, "src/components/login-form.tsx"),
      "utf8",
    );
    const route = fs.readFileSync(
      path.join(root, "src/app/api/auth/password/route.ts"),
      "utf8",
    );
    expect(login).toContain('fetch("/api/auth/password"');
    expect(login).toContain("supabase.auth.getSession()");
    expect(route).toContain("createRouteClient(request, response)");
    expect(route).not.toContain("console.");
  });

  it("keeps MCP on user OAuth and exposes a protected-resource challenge", () => {
    const route = fs.readFileSync(
      path.join(root, "src/app/mcp/route.ts"),
      "utf8",
    );
    const auth = fs.readFileSync(
      path.join(root, "src/lib/mcp/auth.ts"),
      "utf8",
    );
    expect(route).toContain("WWW-Authenticate");
    expect(route).toContain("createSupabaseMcpRepository");
    expect(route).toContain("exposeToolSecuritySchemes");
    expect(route).toContain(
      "tool.securitySchemes = tool._meta.securitySchemes",
    );
    expect(auth).toContain("supabase.auth.getUser(accessToken)");
    expect(route).not.toContain("SUPABASE_SECRET_KEY");
    expect(auth).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("ships versioned, security-invoker RPCs for every new MCP write path", () => {
    for (const signature of [
      "create or replace function public.mcp_update_daily_task(",
      "create or replace function public.mcp_batch_update_daily_tasks(",
      "create or replace function public.mcp_create_plan(",
      "create or replace function public.mcp_update_plan(",
    ]) {
      expect(mcpWriteMigration).toContain(signature);
    }
    expect(mcpWriteMigration).toContain("caller uuid := auth.uid()");
    expect(mcpWriteMigration).toContain("security invoker");
    expect(mcpWriteMigration).toContain(
      "revoke all on function public.mcp_update_daily_task(",
    );
    expect(mcpWriteMigration).toContain(
      "grant execute on function public.mcp_update_daily_task(",
    );
    expect(mcpWriteMigration).toContain("to authenticated");
  });

  it("defines non-empty success and failure envelopes at the database boundary", () => {
    expect(mcpWriteMigration).toContain(
      "create or replace function public.mcp_result_ok(",
    );
    expect(mcpWriteMigration).toContain(
      "create or replace function public.mcp_result_error(",
    );
    expect(mcpWriteMigration).toContain("'status', 'ok'");
    expect(mcpWriteMigration).toContain(
      "'data', coalesce(p_data, '{}'::jsonb)",
    );
    expect(mcpWriteMigration).toContain("'status', 'error'");
    expect(mcpWriteMigration).toContain(
      "'code', coalesce(nullif(p_code, ''), 'INTERNAL_ERROR')",
    );
    expect(mcpWriteMigration).toContain(
      "when jsonb_typeof(coalesce(p_details, '{}'::jsonb)) = 'object'",
    );
    expect(mcpWriteMigration).toContain(
      "then coalesce(p_details, '{}'::jsonb)",
    );
  });

  it("guards one daily-task update by owner, date, slot and version", () => {
    expect(mcpWriteMigration).toContain(
      "if p_slot_index is null or p_slot_index < 1 or p_slot_index > 6 then",
    );
    expect(mcpWriteMigration).toContain("where user_id = caller");
    expect(mcpWriteMigration).toContain("and entry_date = p_entry_date");
    expect(mcpWriteMigration).toContain("and slot_index = p_slot_index");
    expect(mcpWriteMigration).toContain("for update;");
    expect(mcpWriteMigration).toContain(
      "if current_task.deleted_at is not null then",
    );
    expect(mcpWriteMigration).toContain(
      "if current_task.archived_at is not null then",
    );
    expect(mcpWriteMigration).toContain(
      "if current_task.version <> p_expected_version then",
    );
    expect(mcpWriteMigration).toContain("and version = p_expected_version");
    expect(mcpWriteMigration).toContain("'VERSION_CONFLICT'");
    expect(mcpWriteMigration).toContain(
      "每日任务只能关联当前用户未删除、未归档的周计划。",
    );
  });

  it("makes batch task writes atomic by default with an explicit partial mode", () => {
    expect(mcpWriteMigration).toContain("p_atomic boolean default true");
    expect(mcpWriteMigration).toContain("if coalesce(p_atomic, true) then");
    expect(mcpWriteMigration).toContain(
      "raise exception using\n            errcode = 'P0001'",
    );
    expect(mcpWriteMigration).toContain("'批量更新失败，所有修改已回滚。'");
    expect(mcpWriteMigration).toContain("'BATCH_UPDATE_FAILED'");
    expect(mcpWriteMigration).toContain("'failed_slot_index', failed_slot");
    expect(mcpWriteMigration).toContain("'atomic', false");
    expect(mcpWriteMigration).toContain("'errors', failed_items");
  });

  it("enforces idempotent plan creation and a cycle-free annual-monthly-weekly hierarchy", () => {
    expect(mcpWriteMigration).toContain(
      "add column if not exists importance text not null default ''",
    );
    expect(mcpWriteMigration).toContain(
      "add column if not exists first_action text not null default ''",
    );
    expect(mcpWriteMigration).toContain("p_id uuid");
    expect(mcpWriteMigration).toContain("'idempotent_replay', true");
    expect(mcpWriteMigration).toContain("'IDEMPOTENCY_CONFLICT'");
    expect(mcpWriteMigration).toContain("月计划只能关联年计划。");
    expect(mcpWriteMigration).toContain("周计划只能关联月计划。");
    expect(mcpWriteMigration).toContain("'CYCLE_DETECTED'");
    expect(mcpWriteMigration).toContain("with recursive descendants(id) as");
    expect(mcpWriteMigration).toContain(
      "if p_period_start > p_period_end then",
    );
    expect(mcpWriteMigration).toContain(
      "warnings := public.mcp_plan_period_warnings(",
    );
  });

  it("keeps MCP transport responses structured and serializable", () => {
    const server = fs.readFileSync(
      path.join(root, "src/lib/mcp/server.ts"),
      "utf8",
    );
    expect(server).toContain('status: z.enum(["ok", "error"])');
    expect(server).toContain("code: z.string().optional()");
    expect(server).toContain(
      "details: z.record(z.string(), z.unknown()).optional()",
    );
    expect(server).toContain("text: JSON.stringify(envelope)");
    expect(server).toContain("structuredContent: envelope");
    expect(server).toContain('"batch_update_daily_tasks"');
    expect(server).toContain('"get_plan"');
    expect(server).toContain('"create_plan"');
    expect(server).toContain('"update_plan"');
  });

  it("ships a repo-local plugin pointing at the production MCP endpoint", () => {
    const plugin = JSON.parse(
      fs.readFileSync(
        path.join(root, "plugins/shouzhong-daily/.codex-plugin/plugin.json"),
        "utf8",
      ),
    );
    const mcp = JSON.parse(
      fs.readFileSync(
        path.join(root, "plugins/shouzhong-daily/.mcp.json"),
        "utf8",
      ),
    );
    expect(plugin.name).toBe("shouzhong-daily");
    expect(mcp.mcpServers["shouzhong-daily"].url).toBe(
      "https://shouzhong-daily.vercel.app/mcp",
    );
  });
});
