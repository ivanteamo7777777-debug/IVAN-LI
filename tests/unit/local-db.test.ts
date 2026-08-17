import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRememberedLocalIdentity,
  deleteRemoteIfClean,
  exportAllData,
  getRememberedLocalIdentity,
  localDb,
  patchLocal,
  rememberLocalIdentity,
  restoreAllData,
  saveLocal,
  storeRemote,
  storeRemotePage,
} from "@/lib/local-db";
import {
  acknowledgeOperation,
  HYDRATE_PAGE_SIZE,
  SyncEngine,
} from "@/lib/sync-engine";
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

function remoteTask(index: number): DailyTask {
  return {
    ...task((index % 6) + 1),
    id: `remote-task-${index.toString().padStart(6, "0")}`,
    entry_date: "2026-07-26",
    title: `云端任务 ${index}`,
    created_at: new Date(Date.parse(now) + index * 1_000).toISOString(),
    updated_at: new Date(Date.parse(now) + index * 1_000).toISOString(),
    version: 1,
  };
}

function createHydrationClient(rows: DomainRecord[], latencyMs = 1) {
  const metrics = {
    active: 0,
    maxActive: 0,
    calls: new Map<string, number>(),
  };
  const client = {
    from(tableName: string) {
      let limit = HYDRATE_PAGE_SIZE;
      let cursor: { updated_at: string; record_id: string } | null = null;
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit(value: number) {
          limit = value;
          return this;
        },
        or(filter: string) {
          const separator = ",and(updated_at.eq.";
          const idSeparator = ",id.gt.";
          const timestampEnd = filter.indexOf(separator);
          const idStart = filter.indexOf(idSeparator, timestampEnd);
          cursor = {
            updated_at: filter.slice("updated_at.gt.".length, timestampEnd),
            record_id: filter.slice(idStart + idSeparator.length, -1),
          };
          return this;
        },
        abortSignal() {
          return this;
        },
        then(
          resolve: (value: { data: DomainRecord[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) {
          metrics.calls.set(tableName, (metrics.calls.get(tableName) ?? 0) + 1);
          metrics.active += 1;
          metrics.maxActive = Math.max(metrics.maxActive, metrics.active);
          const tableRows = tableName === "daily_tasks" ? rows : [];
          const page = tableRows
            .filter(
              (record) =>
                !cursor ||
                record.updated_at > cursor.updated_at ||
                (record.updated_at === cursor.updated_at &&
                  record.id > cursor.record_id),
            )
            .sort(
              (left, right) =>
                left.updated_at.localeCompare(right.updated_at) ||
                left.id.localeCompare(right.id),
            )
            .slice(0, limit);
          return new Promise<{ data: DomainRecord[]; error: null }>((done) =>
            setTimeout(() => {
              metrics.active -= 1;
              done({ data: page, error: null });
            }, latencyMs),
          ).then(resolve, reject);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, metrics };
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
    await saveLocal("exercise_logs", {
      ...exercise,
      id: "10000000-0000-4000-8000-000000000002",
      activity: "力量训练",
    });
    await saveLocal("meal_logs", meal);
    expect(
      await localDb.records
        .where("[table+user_id]")
        .equals(["daily_tasks", userId])
        .count(),
    ).toBe(0);
    expect(
      await localDb.records
        .where("[table+user_id]")
        .equals(["exercise_logs", userId])
        .count(),
    ).toBe(2);
    expect(await localDb.records.count()).toBe(3);
  });

  it("syncs each exercise session by id instead of collapsing the day", async () => {
    const exercise: ExerciseLog = {
      id: "10000000-0000-4000-8000-000000000003",
      user_id: userId,
      entry_date: "2026-07-26",
      planned: true,
      activity: "游泳",
      planned_minutes: 40,
      actual_minutes: 35,
      intensity: "moderate",
      status: "completed",
      body_feeling: "舒展",
      notes: "",
      created_at: now,
      updated_at: now,
      version: 0,
    };
    const saved = await saveLocal("exercise_logs", exercise);
    const equals: Array<[string, unknown]> = [];
    let upsertConflict = "";
    let upserted: DomainRecord | null = null;
    const query = {
      select() {
        return this;
      },
      eq(field: string, value: unknown) {
        equals.push([field, value]);
        return this;
      },
      async maybeSingle() {
        return { data: null, error: null };
      },
      upsert(payload: DomainRecord, options: { onConflict: string }) {
        upserted = payload;
        upsertConflict = options.onConflict;
        return this;
      },
      async single() {
        return { data: upserted, error: null };
      },
    };
    const client = {
      from: () => query,
    } as unknown as SupabaseClient;

    await new SyncEngine(userId, client).flush();

    expect(equals).toContainEqual(["id", saved.id]);
    expect(equals.some(([field]) => field === "entry_date")).toBe(false);
    expect(upsertConflict).toBe("id");
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

  it("never lets an older hydrate response replace a newer synced record", async () => {
    const newer = { ...remoteTask(1), title: "较新的实时版本", version: 3 };
    await storeRemote("daily_tasks", newer);
    await storeRemote("daily_tasks", {
      ...newer,
      title: "较旧的全量读取版本",
      version: 2,
      updated_at: "2026-07-26T00:00:00.000Z",
    });

    const row = await localDb.records.get(`daily_tasks:${newer.id}`);
    expect((row?.data as DailyTask).title).toBe("较新的实时版本");
    expect(row?.version).toBe(3);
  });

  it("keeps the newest version when paged hydration and Realtime write concurrently", async () => {
    const newer = { ...remoteTask(2), title: "实时新版", version: 4 };
    const older = {
      ...newer,
      title: "分页旧版",
      version: 3,
      updated_at: "2026-07-26T00:00:00.000Z",
    };

    await Promise.all([
      storeRemote("daily_tasks", newer),
      storeRemotePage("daily_tasks", userId, [older]),
    ]);

    const row = await localDb.records.get(`daily_tasks:${newer.id}`);
    expect(row?.version).toBe(4);
    expect((row?.data as DailyTask).title).toBe("实时新版");
  });

  it("hydrates all tables concurrently with keyset pages beyond 1000 rows", async () => {
    const rows = Array.from({ length: 1_205 }, (_, index) => remoteTask(index));
    const first = createHydrationClient(rows, 2);

    await new SyncEngine(userId, first.client).hydrate();

    expect(first.metrics.maxActive).toBeGreaterThan(1);
    expect(first.metrics.calls.get("daily_tasks")).toBe(3);
    expect(
      await localDb.records
        .where("[table+user_id]")
        .equals(["daily_tasks", userId])
        .count(),
    ).toBe(1_205);

    const added = remoteTask(1_205);
    const second = createHydrationClient([...rows, added]);
    await new SyncEngine(userId, second.client).hydrate();

    expect(second.metrics.calls.get("daily_tasks")).toBe(3);
    expect(await localDb.records.get(`daily_tasks:${added.id}`)).toBeDefined();
  });

  it("rescans from the beginning so a late insert with an old timestamp is not missed", async () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      remoteTask(index + 20),
    );
    await new SyncEngine(userId, createHydrationClient(rows).client).hydrate();

    const lateOldRecord = {
      ...remoteTask(1),
      id: "late-record-with-old-time",
      title: "晚同步的旧时间记录",
      updated_at: "2026-07-25T00:00:00.000Z",
    };
    const second = createHydrationClient([...rows, lateOldRecord]);
    await new SyncEngine(userId, second.client).hydrate();

    expect(second.metrics.calls.get("daily_tasks")).toBe(1);
    expect(
      (await localDb.records.get(`daily_tasks:${lateOldRecord.id}`))?.data,
    ).toMatchObject({ title: "晚同步的旧时间记录" });
  });

  it("keeps a dirty local edit when Realtime reports a remote delete", async () => {
    const remote = { ...task(1), version: 1 };
    await storeRemote("daily_tasks", remote);
    const dirty = await saveLocal("daily_tasks", {
      ...remote,
      title: "尚未同步的本地修改",
    });

    await expect(
      deleteRemoteIfClean("daily_tasks", userId, dirty.id),
    ).resolves.toBe(false);
    const stored = await localDb.records.get(`daily_tasks:${dirty.id}`);
    expect(stored?.sync_status).toBe("pending");
    expect((stored?.data as DailyTask).title).toBe("尚未同步的本地修改");
    expect(await localDb.operations.count()).toBe(1);
  });

  it("recovers an interrupted file and retries after an upload exception", async () => {
    const fileId = "interrupted-file";
    await localDb.files.add({
      id: fileId,
      user_id: userId,
      bucket: "attachments",
      path: `${userId}/retry.txt`,
      blob: new Blob(["retry"], { type: "text/plain" }),
      content_type: "text/plain",
      status: "syncing",
      created_at: now,
    });
    let attempts = 0;
    const client = {
      storage: {
        from: () => ({
          upload: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("network unavailable");
            return { data: {}, error: null };
          },
        }),
      },
    } as unknown as SupabaseClient;
    const engine = new SyncEngine(userId, client);

    await engine.flush();
    expect((await localDb.files.get(fileId))?.status).toBe("failed");
    await engine.flush();
    expect((await localDb.files.get(fileId))?.status).toBe("synced");
    expect(attempts).toBe(2);
  });

  it("stores and clears the remembered local identity in Dexie v2", async () => {
    await rememberLocalIdentity({ userId, email: "person@example.com" });
    await expect(getRememberedLocalIdentity()).resolves.toEqual({
      userId,
      email: "person@example.com",
    });
    await clearRememberedLocalIdentity();
    await expect(getRememberedLocalIdentity()).resolves.toBeNull();
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
