import { describe, expect, it } from "vitest";
import { isValidAuthorizationId } from "@/lib/oauth/authorization-id";

describe("isValidAuthorizationId", () => {
  it("accepts Supabase opaque authorization IDs", () => {
    expect(
      isValidAuthorizationId("yf7nred4sw4psckq2lpdxz3jdq7tzmxi"),
    ).toBe(true);
  });

  it("accepts legacy UUID-shaped IDs", () => {
    expect(
      isValidAuthorizationId("2f52c098-3d02-49f6-a8c3-96123f21ae92"),
    ).toBe(true);
  });

  it.each([
    null,
    "",
    "too-short",
    "contains spaces and punctuation!",
    "../oauth/token",
    "a".repeat(257),
  ])("rejects invalid values", (value) => {
    expect(isValidAuthorizationId(value)).toBe(false);
  });
});
