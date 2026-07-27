import { beforeEach, describe, expect, it } from "vitest";
import {
  exportAllData,
  localDb,
  patchLocal,
  restoreAllData,
  saveLocal,
  storeRemote,
} from "@/lib/local-db";
import { acknowledgeOperation, SyncEngine } from "@/lib/sync-engine";
import type {
  DailyTask,
  DomainRecord,
  ExerciseLog,
  MealLog,
} from "@/types/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncOperation } from "@/lib/local-db";

const userId = "00000000-0000-4000-8000-000000000001";
const now = "2026-07-26T00:00:00.000Z";

function task(slot: number): DailyTask {
  return {
    id: `00000000-0000-4000-8000-0000000000${slot.toString().padStart(2, "0")}`,
    user_id: userId,
    entry_date: "2026-07-26",
    slot_index: slot,
    title: `任务 ${slot}`,
    importance: "",
    completion_standard: "",
    first_action: "",
    weekly_plan_id: null,
    status: "not_started",
    result: "",
    completed_at: null,
    notes: "",
    created_at: now,
    updated_at: now,
    version: 0,
  };
}

beforeEach(async () => {
  await localDb.delete();
  await localDb.open();
});

describe("IndexedDB local-first persistence", () => {
  it("keeps exactly six structural task positions and queues them", async () => {
    for (let slot = 1; slot <= 6; slot += 1) {
      await saveLocal("daily_tasks", task(slot));
    }
    const rows = await localDb.records
      .where("[table+user_id]")
      .equals(["daily_tasks", userId])
      .toArray();
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => (row.data as DailyTask).slot_index)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(await localDb.operations.count()).toBe(6);
  });

  it("coalesces rapid edits without losing the earliest cloud base version", async () => {
    const record = await saveLocal("daily_tasks", task(1));
    await saveLocal("daily_tasks", { ...record, title: "第一版" });
    await saveLocal("daily_tasks", { ...record, title: "最终版" });
    const operations = await localDb.operations.toArray();
    expect(operations).toHaveLength(1);
    expect((operations[0].payload as DailyTask).title).toBe("最终版");
    expect(operations[0].base_version).toBe(0);
  });

  it("serializes patches to different fields on the same record", async () => {
    const record = await saveLocal("daily_tasks", task(1));
    await Promise.all([
      patchLocal("daily_tasks", record, { title: "新的标题" }),
      patchLocal("daily_tasks", record, { notes: "新的备注" }),
    ]);
    const stored = await localDb.records.get(`daily_tasks:${record.id}`);
    expect((stored?.data as DailyTask).title).toBe("新的标题");
    expect((stored?.data as DailyTask).notes).toBe("新的备注");
    expect((await localDb.operations.toArray())[0].base_version).toBe(0);
  });

  it("stores exercise and meals independently from the six positions", async () => {
    const exercise: ExerciseLog = {
      id: "10000000-0000-4000-8000-000000000001",
      user_id: userId,
      entry_date: "2026-07-26",
      planned: true,
      activity: "散步",
      planned_minutes: 30,
      actual_minutes: null,
      intensity: "light",
      status: "not_started",
      body_feeling: "",
      notes: "",
      created_at: now,
      updated_at: now,
      version: 0,
    };
    const meal: MealLog = {
      id: "20000000-0000-4000-8000-000000000001",
      user_id: userId,
      entry_date: "2026-07-26",
      meal_type: "breakfast",
      content: "粥和鸡蛋",
      photo_paths: [],
      hydration_ml: 0,
      overall_feeling: "",
      notes: "",
      created_at: now,
      updated_at: now,
      version: 0,
    };
    await saveLocal("exercise_logs", exercise);
    await saveLocal("meal_logs", meal);
    expect(
      await localDb.records
        .where("[table+user_id]")
        .equals(["daily_tasks", userId])
        .count(),
    ).toBe(0);
    expect(await localDb.records.count()).toBe(2);
  });

  it("never lets a realtime echo replace an unsynced local record", async () => {
    const local = await saveLocal("daily_tasks", task(1));
    await storeRemote("daily_tasks", {
      ...local,
      title: "较早的云端回包",
      version: local.version + 1,
      updated_at: "2026-07-26T01:00:00.000Z",
    });
    expect(await localDb.conflicts.count()).toBe(0);
    const row = await localDb.records.get(`daily_tasks:${local.id}`);
    expect(row?.sync_status).toBe("pending");
    expect((row?.data as DailyTask).title).toBe("任务 1");
  });

  it("keeps a newer local edit when an older in-flight request returns", async () => {
    const first = await saveLocal("daily_tasks", {
      ...task(1),
      title: "第一版",
    });
    const firstOperation = (await localDb.operations.toArray())[0];
    await patchLocal("daily_tasks", first, { title: "输入中的最终版" });

    await acknowledgeOperation(firstOperation, {
      ...(firstOperation.payload as DomainRecord),
      updated_at: "2026-07-26T01:00:00.000Z",
      version: 1,
    });

    const row = await localDb.records.get(`daily_tasks:${first.id}`);
    const pending = await localDb.operations.toArray();
    expect((row?.data as DailyTask).title).toBe("输入中的最终版");
    expect(row?.sync_status).toBe("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].base_version).toBe(1);
  });

  it("runs a trailing flush when another request arrives mid-sync", async () => {
    await saveLocal("daily_tasks", task(1));
    const engine = new SyncEngine(userId, {} as SupabaseClient);
    const calls: string[] = [];
    const mutableEngine = engine as unknown as {
      flushOperation: (operation: SyncOperation) => Promise<void>;
    };
    mutableEngine.flushOperation = async (operation) => {
      calls.push(operation.record_id);
      await localDb.operations.delete(operation.id);
      if (calls.length === 1) {
        await saveLocal("daily_tasks", task(2));
        await engine.flush();
      }
    };

    await engine.flush();

    expect(calls).toEqual([task(1).id, task(2).id]);
    expect(await localDb.operations.count()).toBe(0);
  });

  it("creates a conflict when the cloud changed from the preserved base", async () => {
    const local = await saveLocal("daily_tasks", {
      ...task(1),
      title: "本地版本",
    });
    const remote: DailyTask = {
      ...local,
      title: "另一台设备的版本",
      version: 2,
      updated_at: "2026-07-26T02:00:00.000Z",
    };
    const query = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        return { data: remote, error: null };
      },
    };
    const client = {
      from: () => query,
    } as unknown as SupabaseClient;

    await new SyncEngine(userId, client).flush();

    const row = await localDb.records.get(`daily_tasks:${local.id}`);
    expect(row?.sync_status).toBe("conflict");
    expect((row?.data as DailyTask).title).toBe("本地版本");
    expect(await localDb.conflicts.count()).toBe(1);
    expect(await localDb.operations.count()).toBe(0);
  });

  it("exports and restores the JSON backup format", async () => {
    await saveLocal("daily_tasks", task(1));
    const backup = await exportAllData(userId);
    await localDb.delete();
    await localDb.open();
    await restoreAllData(userId, backup);
    expect(await localDb.records.count()).toBe(1);
  });
});
