// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("desktop and PWA performance regressions", () => {
  it("indexes every synchronized table for keyset hydration without excluding tombstones", () => {
    const migration = read(
      "supabase/migrations/202608170001_sync_hydration_indexes.sql",
    );
    const synchronizedTables = [
      "directions",
      "plans",
      "daily_entries",
      "daily_tasks",
      "exercise_logs",
      "meal_logs",
      "accumulation_entries",
      "reviews",
      "reminder_settings",
      "push_subscriptions",
    ];
    const indexStatements = migration
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => /create\s+index/i.test(statement));

    expect(indexStatements).toHaveLength(synchronizedTables.length);
    for (const table of synchronizedTables) {
      const statement = indexStatements.find((candidate) =>
        new RegExp(`on\\s+public\\.${table}\\s*\\(`, "i").test(candidate),
      );
      expect(statement, `missing hydration index for ${table}`).toBeDefined();
      expect(statement).toMatch(
        new RegExp(
          `on\\s+public\\.${table}\\s*\\(\\s*user_id\\s*,\\s*updated_at\\s*,\\s*id\\s*\\)`,
          "i",
        ),
      );
      expect(statement).not.toMatch(/\bwhere\b/i);
    }
  });

  it("versions authenticated runtime caches and keeps the current generation on activation", () => {
    const worker = read("src/app/sw.ts");
    const config = read("next.config.ts");

    expect(config).toContain("NEXT_PUBLIC_RUNTIME_CACHE_VERSION");
    expect(config).toMatch(/VERCEL_GIT_COMMIT_SHA[\s\S]*GITHUB_SHA/);
    expect(worker).toContain("process.env.NEXT_PUBLIC_RUNTIME_CACHE_VERSION");
    expect(worker).toContain(
      "shouzhong-authenticated-shell-${RUNTIME_CACHE_VERSION}",
    );
    expect(worker).toContain(
      "shouzhong-authenticated-rsc-${RUNTIME_CACHE_VERSION}",
    );
    expect(worker).toContain(
      "shouzhong-authenticated-rsc-prefetch-${RUNTIME_CACHE_VERSION}",
    );
    expect(worker).toMatch(
      /const CURRENT_AUTHENTICATED_CACHES = new Set\(\[\s*AUTHENTICATED_SHELL_CACHE,\s*AUTHENTICATED_RSC_CACHE,\s*AUTHENTICATED_RSC_PREFETCH_CACHE,\s*\]\)/,
    );
    expect(worker).toMatch(/!CURRENT_AUTHENTICATED_CACHES\.has\(name\)/);
    expect(worker).toContain(
      'name.startsWith("shouzhong-authenticated-shell")',
    );
    expect(worker).toContain('name.startsWith("shouzhong-authenticated-rsc")');
    expect(worker).toContain("LEGACY_NEXT_PAGE_CACHES.has(name)");
    expect(worker).toContain("caches.delete(name)");
  });

  it("renders six structural task slots in memory without queuing six empty writes", () => {
    const today = read("src/components/today/today-view.tsx");

    expect(today).toContain("Array.from({ length: 6 }");
    expect(today).toContain("emptyTask(userId, date, slot)");
    expect(today).toContain("const realSlots = new Set<number>()");
    expect(today).not.toContain("ensuredDates");
    expect(today).not.toMatch(/for\s*\(let slot\s*=\s*1;\s*slot\s*<=\s*6/);
    expect(today).not.toMatch(
      /saveLocal\(\s*["']daily_tasks["']\s*,\s*emptyTask\(/,
    );
  });

  it("does not reload on reconnect and prefetches app routes only after intent", () => {
    const config = read("next.config.ts");
    const shell = read("src/components/app-shell.tsx");

    expect(config).toMatch(/reloadOnOnline:\s*false/);
    expect(shell).not.toContain("requestIdleCallback");
    expect(shell).not.toContain("navItems.forEach");
    expect(shell).not.toMatch(/setTimeout\([\s\S]{0,120}warmRoute/);

    const openingLinkTags = shell.match(/<Link\b[\s\S]*?>/g) ?? [];
    const logoAndSettingsLinks = openingLinkTags.filter(
      (tag) => tag.includes('href="/today"') || tag.includes("/settings"),
    );
    expect(logoAndSettingsLinks.length).toBeGreaterThanOrEqual(4);
    for (const tag of logoAndSettingsLinks) {
      expect(tag).toContain("prefetch={false}");
    }

    expect(shell).toContain("onPointerEnter={() => warmRoute(item.href)}");
    expect(shell).toContain("onFocus={() => warmRoute(item.href)}");
    expect(shell).toContain("onTouchStart={() => warmRoute(item.href)}");
  });
});
