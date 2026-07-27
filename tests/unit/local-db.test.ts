import { beforeEach, describe, expect, it } from "vitest";
import {
  exportAllData,
  localDb,
  restoreAllData,
  saveLocal,
  storeRemote,
} from "@/lib/local-db";
import type {
  DailyTask,
  ExerciseLog,
  MealLog,
} from "@/types/domain";

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

  it("preserves both versions when a newer remote record arrives", async () => {
    const local = await saveLocal("daily_tasks", task(1));
    await storeRemote("daily_tasks", {
      ...local,
      title: "另一台设备的版本",
      version: local.version + 1,
      updated_at: "2026-07-26T01:00:00.000Z",
    });
    expect(await localDb.conflicts.count()).toBe(1);
    const row = await localDb.records.get(`daily_tasks:${local.id}`);
    expect(row?.sync_status).toBe("conflict");
    expect((row?.data as DailyTask).title).toBe("任务 1");
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
