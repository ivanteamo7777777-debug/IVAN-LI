// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  createMcpChallenge,
  extractBearerToken,
  getProtectedResourceMetadata,
} from "@/lib/mcp/auth";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  process.env.APP_URL = originalAppUrl;
});

describe("MCP OAuth metadata", () => {
  it("accepts only a well-formed Bearer header", () => {
    expect(extractBearerToken("Bearer token-123")).toBe("token-123");
    expect(extractBearerToken("bearer token-123")).toBe("token-123");
    expect(extractBearerToken("Basic token-123")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
  });

  it("advertises the canonical resource and Supabase OAuth issuer", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable";
    process.env.APP_URL = "https://shouzhong.example";

    expect(
      getProtectedResourceMetadata("https://preview.example/mcp"),
    ).toMatchObject({
      resource: "https://shouzhong.example/mcp",
      authorization_servers: ["https://project-ref.supabase.co/auth/v1"],
      scopes_supported: ["openid", "email", "profile"],
    });
    expect(createMcpChallenge("https://preview.example/mcp")).toContain(
      'resource_metadata="https://shouzhong.example/.well-known/oauth-protected-resource/mcp"',
    );
  });
});
