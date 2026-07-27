// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createE2eMcpRepository,
  type McpRepository,
} from "@/lib/mcp/repository";
import { createShouzhongMcpServer } from "@/lib/mcp/server";

describe("守中日课 MCP server", () => {
  let client: Client;
  let server: ReturnType<typeof createShouzhongMcpServer>;
  let repository: McpRepository;

  beforeEach(async () => {
    repository = createE2eMcpRepository();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    server = createShouzhongMcpServer(repository);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await Promise.all([client.close(), server.close()]);
  });

  it("publishes complete schemas and safety annotations", async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "get_today",
        "list_plans",
        "search_accumulations",
        "get_period_summary",
        "update_daily_task",
        "add_exercise",
        "upsert_meal_log",
        "add_accumulation",
        "save_review_draft",
      ]),
    );
    expect(
      result.tools.find((tool) => tool.name === "get_today")?.annotations,
    ).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(
      result.tools.find((tool) => tool.name === "update_daily_task")
        ?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it("returns structured daily execution data", async () => {
    const result = await client.callTool({
      name: "get_today",
      arguments: { date: "2026-07-27" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      data: {
        date: "2026-07-27",
        daily_tasks: [],
        exercise_logs: [],
        meal_logs: [],
      },
    });
  });

  it("passes the explicit version guard to a confirmed task update", async () => {
    const update = vi.fn(async (input) => ({
      id: "task-1",
      version: input.expected_version + 1,
      title: input.patch.title,
    }));
    repository.updateDailyTask = update;

    const result = await client.callTool({
      name: "update_daily_task",
      arguments: {
        date: "2026-07-27",
        slot_index: 2,
        expected_version: 4,
        patch: { title: "确认后的标题" },
      },
    });

    expect(result.isError).not.toBe(true);
    expect(update).toHaveBeenCalledWith({
      date: "2026-07-27",
      slot_index: 2,
      expected_version: 4,
      patch: { title: "确认后的标题" },
    });
  });
});
