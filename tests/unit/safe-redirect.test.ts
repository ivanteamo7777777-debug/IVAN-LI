// @vitest-environment node
import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/safe-redirect";

describe("safeInternalPath", () => {
  it("keeps an internal OAuth continuation path", () => {
    expect(safeInternalPath("/oauth/consent?authorization_id=abc")).toBe(
      "/oauth/consent?authorization_id=abc",
    );
  });

  it.each([
    "https://attacker.example",
    "//attacker.example/path",
    "/\\attacker.example",
    "",
  ])("rejects an unsafe redirect: %s", (value) => {
    expect(safeInternalPath(value)).toBe("/today");
  });
});
