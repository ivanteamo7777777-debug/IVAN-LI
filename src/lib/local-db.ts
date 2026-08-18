"use client";

import Dexie, { type EntityTable } from "dexie";
import type {
  DailyTask,
  DomainRecord,
  MealLog,
  SyncConflict,
  SyncStatus,
  SyncTable,
} from "@/types/domain";
import { isoNow, newId } from "@/lib/utils";

export interface LocalRecord {
  key: string;
  table: SyncTable;
  id: string;
  user_id: string;
  data: DomainRecord;
  version: number;
  updated_at: string;
  sync_status: SyncStatus;
}

export interface SyncOperation {
  id: string;
  table: SyncTable;
  record_id: string;
  user_id: string;
  action: "upsert" | "delete";
  payload: DomainRecord | null;
  base_version: number;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

export interface LocalFile {
  id: string;
  user_id: string;
  bucket: "meal-photos" | "attachments";
  path: string;
  blob: Blob;
  content_type: string;
  status: SyncStatus;
  created_at: string;
}

export interface LocalSessionState {
  key: string;
  user_id: string;
  email: string;
  remembered_at: string;
}

const REMEMBERED_LOCAL_IDENTITY_KEY = "remembered-local-identity";

class ShouzhongDatabase extends Dexie {
  records!: EntityTable<LocalRecord, "key">;
  operations!: EntityTable<SyncOperation, "id">;
  conflicts!: EntityTable<SyncConflict, "id">;
  files!: EntityTable<LocalFile, "id">;
  sessionState!: EntityTable<LocalSessionState, "key">;

  constructor() {
    super("shouzhong-daily");
    this.version(1).stores({
      records:
        "&key, [table+user_id], [table+user_id+updated_at], table, user_id, sync_status",
      operations: "&id, [user_id+created_at], user_id, table, record_id",
      conflicts: "&id, [user_id+resolution], user_id, record_id",
      files: "&id, [user_id+status], user_id, status",
    });
    this.version(2).stores({
      records:
        "&key, [table+user_id], [table+user_id+updated_at], [user_id+sync_status], table, user_id, sync_status",
      operations: "&id, [user_id+created_at], user_id, table, record_id",
      conflicts: "&id, [user_id+resolution], user_id, record_id",
      files: "&id, [user_id+status], user_id, status",
      sessionState: "&key, user_id",
    });
  }
}

export const localDb = new ShouzhongDatabase();

const recordWriteBarriers = new Map<string, Promise<void>>();

/**
 * Wait until buffered component commits that have already started reach
 * IndexedDB. Confirmation flows use this before re-reading records so a blur
 * commit cannot race a carry-forward or AI draft write.
 */
export async function waitForLocalWrites() {
  while (recordWriteBarriers.size > 0) {
    await Promise.all([...recordWriteBarriers.values()]);
  }
}

async function serializeRecordWrite<T>(
  key: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = recordWriteBarriers.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(write);
  const barrier = result.then(
    () => undefined,
    () => undefined,
  );
  recordWriteBarriers.set(key, barrier);
  try {
    return await result;
  } finally {
    if (recordWriteBarriers.get(key) === barrier) {
      recordWriteBarriers.delete(key);
    }
  }
}

export async function listRecords<T extends DomainRecord>(
  table: SyncTable,
  userId: string,
) {
  const rows = await localDb.records
    .where("[table+user_id]")
    .equals([table, userId])
    .toArray();
  return rows.filter((row) => !row.data.deleted_at).map((row) => row.data as T);
}

async function putLocalInTransaction<T extends DomainRecord>(
  table: SyncTable,
  data: T,
  current: LocalRecord | undefined,
  options: { queue?: boolean; baseVersion?: number } = {},
) {
  const now = isoNow();
  const next: T = {
    ...data,
    updated_at: now,
    version: Math.max(data.version ?? 1, (current?.version ?? 0) + 1),
  };
  await localDb.records.put({
    key: `${table}:${next.id}`,
    table,
    id: next.id,
    user_id: next.user_id,
    data: next,
    version: next.version,
    updated_at: next.updated_at,
    sync_status: options.queue === false ? "synced" : "pending",
  });
  if (options.queue !== false) {
    const queued = await localDb.operations
      .where("record_id")
      .equals(next.id)
      .filter(
        (operation) =>
          operation.table === table &&
          operation.user_id === next.user_id &&
          operation.action === "upsert",
      )
      .toArray();
    if (queued.length) {
      await localDb.operations.bulkDelete(
        queued.map((operation) => operation.id),
      );
    }
    await localDb.operations.add({
      id: newId(),
      table,
      record_id: next.id,
      user_id: next.user_id,
      action: "upsert",
      payload: next,
      base_version: Math.min(
        options.baseVersion ?? current?.version ?? 0,
        ...queued.map((operation) => operation.base_version),
      ),
      created_at: now,
      attempts: 0,
      last_error: null,
    });
  }
  return next;
}

function requestSync() {
  window.dispatchEvent(new CustomEvent("shouzhong:sync-request"));
}

async function saveLocalNow<T extends DomainRecord>(
  table: SyncTable,
  data: T,
  options: { queue?: boolean; baseVersion?: number } = {},
) {
  const next = await localDb.transaction(
    "rw",
    localDb.records,
    localDb.operations,
    async () => {
      const current = await localDb.records.get(`${table}:${data.id}`);
      return putLocalInTransaction(table, data, current, options);
    },
  );
  requestSync();
  return next;
}

export interface ConditionalLocalWriteResult<T extends DomainRecord> {
  applied: boolean;
  record: T | null;
  reason: "written" | "exists" | "not_empty" | "duplicate";
}

/**
 * Insert a deterministic local record only when that exact id is still absent.
 * The check, record write and outbox update share one serialized Dexie
 * transaction, so a second tab or a rapid repeated confirmation cannot create
 * a second logical copy.
 */
export async function insertLocalIfAbsent<T extends DomainRecord>(
  table: SyncTable,
  data: T,
): Promise<ConditionalLocalWriteResult<T>> {
  const key = `${table}:${data.id}`;
  return serializeRecordWrite(key, async () => {
    const result = await localDb.transaction(
      "rw",
      localDb.records,
      localDb.operations,
      async (): Promise<ConditionalLocalWriteResult<T>> => {
        const current = await localDb.records.get(key);
        if (current) {
          return {
            applied: false,
            record: current.data as T,
            reason: "exists",
          };
        }
        const record = await putLocalInTransaction(table, data, undefined);
        return { applied: true, record, reason: "written" };
      },
    );
    if (result.applied) requestSync();
    return result;
  });
}

function newestLiveRecord<T extends DomainRecord>(rows: LocalRecord[]) {
  return rows
    .filter((row) => !row.data.deleted_at)
    .sort(
      (left, right) =>
        right.updated_at.localeCompare(left.updated_at) ||
        right.id.localeCompare(left.id),
    )[0] as (LocalRecord & { data: T }) | undefined;
}

/** Fill only an empty meal content field while preserving every other field. */
export async function saveMealContentIfEmpty(
  proposed: MealLog,
): Promise<ConditionalLocalWriteResult<MealLog>> {
  const barrierKey = `meal-slot:${proposed.user_id}:${proposed.entry_date}:${proposed.meal_type}`;
  return serializeRecordWrite(barrierKey, async () => {
    const result = await localDb.transaction(
      "rw",
      localDb.records,
      localDb.operations,
      async (): Promise<ConditionalLocalWriteResult<MealLog>> => {
        const rows = await localDb.records
          .where("[table+user_id]")
          .equals(["meal_logs", proposed.user_id])
          .filter((row) => {
            const meal = row.data as MealLog;
            return (
              meal.entry_date === proposed.entry_date &&
              meal.meal_type === proposed.meal_type
            );
          })
          .toArray();
        const latest = newestLiveRecord<MealLog>(rows);
        if (latest?.data.content.trim()) {
          return {
            applied: false,
            record: latest.data,
            reason: "not_empty",
          };
        }
        const candidate = latest
          ? ({ ...latest.data, content: proposed.content } as MealLog)
          : proposed;
        const current = await localDb.records.get(`meal_logs:${candidate.id}`);
        const record = await putLocalInTransaction(
          "meal_logs",
          candidate,
          current,
        );
        return { applied: true, record, reason: "written" };
      },
    );
    if (result.applied) requestSync();
    return result;
  });
}

function sameDailyTaskSuggestion(task: DailyTask, patch: Partial<DailyTask>) {
  return (
    task.title.trim().toLocaleLowerCase() ===
    (patch.title ?? "").trim().toLocaleLowerCase()
  );
}

/**
 * Apply one AI suggestion only if the latest record for this natural slot is
 * still empty and schedulable. Duplicate suggestions already present on the
 * same date are skipped inside the same transaction.
 */
export async function saveDailyTaskSuggestionIfEmpty(
  fallback: DailyTask,
  patch: Partial<DailyTask>,
): Promise<ConditionalLocalWriteResult<DailyTask>> {
  const barrierKey = `daily-task-slot:${fallback.user_id}:${fallback.entry_date}:${fallback.slot_index}`;
  return serializeRecordWrite(barrierKey, async () => {
    const result = await localDb.transaction(
      "rw",
      localDb.records,
      localDb.operations,
      async (): Promise<ConditionalLocalWriteResult<DailyTask>> => {
        const rows = await localDb.records
          .where("[table+user_id]")
          .equals(["daily_tasks", fallback.user_id])
          .filter((row) => {
            const task = row.data as DailyTask;
            return task.entry_date === fallback.entry_date;
          })
          .toArray();
        const liveRows = rows.filter((row) => !row.data.deleted_at);
        const duplicate = patch.title?.trim()
          ? liveRows.find((row) =>
              sameDailyTaskSuggestion(row.data as DailyTask, patch),
            )
          : undefined;
        if (duplicate) {
          return {
            applied: false,
            record: duplicate.data as DailyTask,
            reason: "duplicate",
          };
        }
        const latest = newestLiveRecord<DailyTask>(
          liveRows.filter(
            (row) => (row.data as DailyTask).slot_index === fallback.slot_index,
          ),
        );
        if (
          latest &&
          (latest.data.title.trim() || latest.data.status === "not_scheduled")
        ) {
          return {
            applied: false,
            record: latest.data,
            reason: "not_empty",
          };
        }
        const candidate = {
          ...(latest?.data ?? fallback),
          ...patch,
        } as DailyTask;
        const current = await localDb.records.get(
          `daily_tasks:${candidate.id}`,
        );
        const record = await putLocalInTransaction(
          "daily_tasks",
          candidate,
          current,
        );
        return { applied: true, record, reason: "written" };
      },
    );
    if (result.applied) requestSync();
    return result;
  });
}

export async function saveLocal<T extends DomainRecord>(
  table: SyncTable,
  data: T,
  options: { queue?: boolean; baseVersion?: number } = {},
) {
  return serializeRecordWrite(`${table}:${data.id}`, () =>
    saveLocalNow(table, data, options),
  );
}

export async function deleteLocal(table: SyncTable, record: DomainRecord) {
  const deleted = {
    ...record,
    deleted_at: isoNow(),
    updated_at: isoNow(),
    version: record.version + 1,
  } as DomainRecord;
  return saveLocal(table, deleted, { baseVersion: record.version });
}

export async function patchLocal<T extends DomainRecord>(
  table: SyncTable,
  record: T,
  patch: Partial<T>,
) {
  const key = `${table}:${record.id}`;
  return serializeRecordWrite(key, async () => {
    const current = await localDb.records.get(key);
    const source = (current?.data ?? record) as T;
    return saveLocalNow(table, { ...source, ...patch } as T, {
      baseVersion: current?.version ?? record.version,
    });
  });
}

export async function storeRemote<T extends DomainRecord>(
  table: SyncTable,
  data: T,
  options: { preserveLocalChanges?: boolean } = {},
) {
  const key = `${table}:${data.id}`;
  return serializeRecordWrite(key, () =>
    localDb.transaction("rw", localDb.records, async () => {
      const current = await localDb.records.get(key);
      if (
        options.preserveLocalChanges !== false &&
        current &&
        ["pending", "syncing", "failed", "conflict"].includes(
          current.sync_status,
        )
      ) {
        // Realtime can echo an older mutation while a newer local edit is queued.
        // The flush path compares the cloud base and creates a conflict if needed.
        // Never replace an unsynced local value from the subscription callback.
        return;
      }
      if (
        current &&
        (current.version > data.version ||
          (current.version === data.version &&
            current.updated_at >= data.updated_at))
      ) {
        // The version check and write share one IndexedDB transaction so a
        // delayed Realtime event cannot race a newer paged hydrate response.
        return;
      }
      await localDb.records.put({
        key,
        table,
        id: data.id,
        user_id: data.user_id,
        data,
        version: data.version,
        updated_at: data.updated_at,
        sync_status: "synced",
      });
    }),
  );
}

export async function storeRemotePage(
  table: SyncTable,
  userId: string,
  data: DomainRecord[],
) {
  const keys = data.map((record) => `${table}:${record.id}`);
  await localDb.transaction("rw", localDb.records, async () => {
    const existing = await localDb.records.bulkGet(keys);
    const writes: LocalRecord[] = [];

    data.forEach((record, index) => {
      if (record.user_id !== userId) return;
      const current = existing[index];
      if (
        current &&
        ["pending", "syncing", "failed", "conflict"].includes(
          current.sync_status,
        )
      ) {
        return;
      }
      if (
        current &&
        (current.version > record.version ||
          (current.version === record.version &&
            current.updated_at >= record.updated_at))
      ) {
        return;
      }
      writes.push({
        key: `${table}:${record.id}`,
        table,
        id: record.id,
        user_id: record.user_id,
        data: record,
        version: record.version,
        updated_at: record.updated_at,
        sync_status: "synced",
      });
    });

    if (writes.length) await localDb.records.bulkPut(writes);
  });
}

export async function deleteRemoteIfClean(
  table: SyncTable,
  userId: string,
  recordId: string,
) {
  const key = `${table}:${recordId}`;
  return serializeRecordWrite(key, () =>
    localDb.transaction("rw", localDb.records, localDb.operations, async () => {
      const current = await localDb.records.get(key);
      if (!current || current.user_id !== userId) return false;
      const queued = await localDb.operations
        .where("record_id")
        .equals(recordId)
        .filter(
          (operation) =>
            operation.table === table && operation.user_id === userId,
        )
        .count();
      if (current.sync_status !== "synced" || queued > 0) return false;
      await localDb.records.delete(key);
      return true;
    }),
  );
}

export async function rememberLocalIdentity(identity: {
  userId: string;
  email: string;
}) {
  await localDb.sessionState.put({
    key: REMEMBERED_LOCAL_IDENTITY_KEY,
    user_id: identity.userId,
    email: identity.email,
    remembered_at: isoNow(),
  });
}

export async function getRememberedLocalIdentity(): Promise<{
  userId: string;
  email: string;
} | null> {
  const remembered = await localDb.sessionState.get(
    REMEMBERED_LOCAL_IDENTITY_KEY,
  );
  return remembered
    ? { userId: remembered.user_id, email: remembered.email }
    : null;
}

export async function clearRememberedLocalIdentity() {
  await localDb.sessionState.delete(REMEMBERED_LOCAL_IDENTITY_KEY);
}

export async function resolveConflict(
  conflict: SyncConflict,
  choice: "local" | "remote",
) {
  const selected =
    choice === "local" ? conflict.local_data : conflict.remote_data;
  const record = selected as unknown as DomainRecord;
  await localDb.conflicts.update(conflict.id, {
    resolution: choice,
    resolved_at: isoNow(),
    updated_at: isoNow(),
  });
  if (choice === "local") {
    const resolvedBaseVersion = Math.max(
      Number(conflict.local_data.version ?? 0),
      Number(conflict.remote_data.version ?? 0),
    );
    await saveLocal(
      conflict.table_name,
      {
        ...record,
        version: resolvedBaseVersion + 1,
      } as DomainRecord,
      { baseVersion: resolvedBaseVersion },
    );
  } else {
    await storeRemote(conflict.table_name, record, {
      preserveLocalChanges: false,
    });
  }
}

export async function exportAllData(userId: string) {
  const records = await localDb.records
    .where("user_id")
    .equals(userId)
    .toArray();
  return {
    format: "shouzhong-daily-backup",
    schema_version: 1,
    exported_at: isoNow(),
    records: records.map(({ table, data }) => ({ table, data })),
  };
}

export async function restoreAllData(
  userId: string,
  backup: {
    format: string;
    records: { table: SyncTable; data: DomainRecord }[];
  },
) {
  if (backup.format !== "shouzhong-daily-backup") {
    throw new Error("不是有效的守中日课备份文件");
  }
  for (const item of backup.records) {
    await saveLocal(item.table, {
      ...item.data,
      id: item.data.id || newId(),
      user_id: userId,
      updated_at: isoNow(),
    });
  }
}

export async function clearLocalUserData(userId: string) {
  await localDb.transaction(
    "rw",
    localDb.records,
    localDb.operations,
    localDb.conflicts,
    localDb.files,
    localDb.sessionState,
    async () => {
      await localDb.records.where("user_id").equals(userId).delete();
      await localDb.operations.where("user_id").equals(userId).delete();
      await localDb.conflicts.where("user_id").equals(userId).delete();
      await localDb.files.where("user_id").equals(userId).delete();
      await localDb.sessionState.where("user_id").equals(userId).delete();
    },
  );
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(
          (key) =>
            key.includes("shouzhong") ||
            ["pages", "pages-rsc", "pages-rsc-prefetch"].includes(key),
        )
        .map((key) => caches.delete(key)),
    );
  }
}
