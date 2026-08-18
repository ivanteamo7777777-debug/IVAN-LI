// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isLocalE2EMode } from "@/lib/e2e-mode";

const originalMode = process.env.SHOUZHONG_E2E_MODE;
const originalVercel = process.env.VERCEL;

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnvironment("SHOUZHONG_E2E_MODE", originalMode);
  restoreEnvironment("VERCEL", originalVercel);
});

describe("server-only local E2E mode", () => {
  it("requires the exact server flag and is always disabled on Vercel", () => {
    delete process.env.SHOUZHONG_E2E_MODE;
    delete process.env.VERCEL;
    expect(isLocalE2EMode()).toBe(false);

    process.env.SHOUZHONG_E2E_MODE = "true";
    expect(isLocalE2EMode()).toBe(false);

    process.env.SHOUZHONG_E2E_MODE = "1";
    expect(isLocalE2EMode()).toBe(true);

    process.env.VERCEL = "1";
    expect(isLocalE2EMode()).toBe(false);
  });

  it.each([
    "http://localhost:3000/today",
    "http://127.0.0.1:3000/api/ai/daily-six",
    "http://[::1]:3000/mcp",
  ])("allows a loopback request: %s", (url) => {
    process.env.SHOUZHONG_E2E_MODE = "1";
    delete process.env.VERCEL;
    expect(isLocalE2EMode(new Request(url))).toBe(true);
  });

  it("rejects public hosts and a mismatched Host header", () => {
    process.env.SHOUZHONG_E2E_MODE = "1";
    delete process.env.VERCEL;

    expect(isLocalE2EMode(new Request("https://shouzhong.example/today"))).toBe(
      false,
    );
    expect(
      isLocalE2EMode(
        new Request("http://localhost:3000/today", {
          headers: { host: "shouzhong.example" },
        }),
      ),
    ).toBe(false);
  });

  it("removes the public E2E switch from every server entry point", () => {
    const root = process.cwd();
    const serverEntries = [
      "src/proxy.ts",
      "src/lib/server-auth.ts",
      "src/lib/mcp/auth.ts",
      "src/app/(app)/layout.tsx",
      "src/app/auth/login/page.tsx",
      "src/app/mcp/route.ts",
      "src/app/api/account/route.ts",
      "src/app/api/push/test/route.ts",
      "src/app/api/push/subscribe/route.ts",
      "src/app/api/ai/daily-six/route.ts",
      "src/app/api/ai/daily-six/auto/route.ts",
    ];
    const source = serverEntries
      .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
      .join("\n");

    expect(source).not.toContain("NEXT_PUBLIC_E2E_MODE");
    expect(source).toContain("isLocalE2EMode");
  });
});
