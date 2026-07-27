"use client";

import Dexie, { type EntityTable } from "dexie";
import type {
  DomainRecord,
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

class ShouzhongDatabase extends Dexie {
  records!: EntityTable<LocalRecord, "key">;
  operations!: EntityTable<SyncOperation, "id">;
  conflicts!: EntityTable<SyncConflict, "id">;
  files!: EntityTable<LocalFile, "id">;

  constructor() {
    super("shouzhong-daily");
    this.version(1).stores({
      records:
        "&key, [table+user_id], [table+user_id+updated_at], table, user_id, sync_status",
      operations: "&id, [user_id+created_at], user_id, table, record_id",
      conflicts: "&id, [user_id+resolution], user_id, record_id",
      files: "&id, [user_id+status], user_id, status",
    });
  }
}

export const localDb = new ShouzhongDatabase();

const recordWriteBarriers = new Map<string, Promise<void>>();

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

async function saveLocalNow<T extends DomainRecord>(
  table: SyncTable,
  data: T,
  options: { queue?: boolean; baseVersion?: number } = {},
) {
  const current = await localDb.records.get(`${table}:${data.id}`);
  const now = isoNow();
  const next: T = {
    ...data,
    updated_at: now,
    version: Math.max(data.version ?? 1, (current?.version ?? 0) + 1),
  };
  await localDb.transaction(
    "rw",
    localDb.records,
    localDb.operations,
    async () => {
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
    },
  );
  window.dispatchEvent(new CustomEvent("shouzhong:sync-request"));
  return next;
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
  return serializeRecordWrite(key, async () => {
    const current = await localDb.records.get(key);
    if (
      options.preserveLocalChanges !== false &&
      current &&
      ["pending", "syncing", "failed", "conflict"].includes(current.sync_status)
    ) {
      // Realtime can echo an older mutation while a newer local edit is queued.
      // The flush path compares the cloud base and creates a conflict if needed.
      // Never replace an unsynced local value from the subscription callback.
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
  });
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
    async () => {
      await localDb.records.where("user_id").equals(userId).delete();
      await localDb.operations.where("user_id").equals(userId).delete();
      await localDb.conflicts.where("user_id").equals(userId).delete();
      await localDb.files.where("user_id").equals(userId).delete();
    },
  );
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.includes("shouzhong"))
        .map((key) => caches.delete(key)),
    );
  }
}
