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
    expect(auth).toContain("supabase.auth.getUser(accessToken)");
    expect(route).not.toContain("SUPABASE_SECRET_KEY");
    expect(auth).not.toContain("SUPABASE_SECRET_KEY");
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
