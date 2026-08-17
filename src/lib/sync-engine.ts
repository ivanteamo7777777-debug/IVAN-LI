"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  deleteRemoteIfClean,
  localDb,
  storeRemote,
  storeRemotePage,
  type LocalRecord,
  type SyncOperation,
} from "@/lib/local-db";
import { isoNow, newId } from "@/lib/utils";
import {
  syncTables,
  type DomainRecord,
  type SyncConflict,
  type SyncTable,
} from "@/types/domain";

const naturalKeys: Partial<Record<SyncTable, string>> = {
  daily_tasks: "user_id,entry_date,slot_index",
  daily_entries: "user_id,entry_date",
  meal_logs: "user_id,entry_date,meal_type",
  reviews: "user_id,review_type,period_start,period_end",
  reminder_settings: "user_id",
  push_subscriptions: "user_id,endpoint",
};

export const HYDRATE_PAGE_SIZE = 500;
const HYDRATE_REQUEST_TIMEOUT_MS = 12_000;

function table(client: SupabaseClient, name: SyncTable) {
  // Database types are generated after a project is linked. Runtime remains RLS-scoped.
  return client.from(name) as ReturnType<SupabaseClient["from"]>;
}

async function getRemote(
  client: SupabaseClient,
  operation: SyncOperation,
): Promise<DomainRecord | null> {
  let query = table(client, operation.table).select("*");
  const payload = operation.payload as unknown as Record<
    string,
    unknown
  > | null;
  if (
    operation.table === "daily_tasks" &&
    payload?.entry_date &&
    payload?.slot_index
  ) {
    query = query
      .eq("user_id", operation.user_id)
      .eq("entry_date", payload.entry_date)
      .eq("slot_index", payload.slot_index);
  } else if (operation.table === "meal_logs" && payload?.meal_type) {
    query = query
      .eq("user_id", operation.user_id)
      .eq("entry_date", payload.entry_date)
      .eq("meal_type", payload.meal_type);
  } else if (operation.table === "daily_entries" && payload?.entry_date) {
    query = query
      .eq("user_id", operation.user_id)
      .eq("entry_date", payload.entry_date);
  } else if (operation.table === "reviews" && payload) {
    query = query
      .eq("user_id", operation.user_id)
      .eq("review_type", payload.review_type)
      .eq("period_start", payload.period_start)
      .eq("period_end", payload.period_end);
  } else if (operation.table === "reminder_settings") {
    query = query.eq("user_id", operation.user_id);
  } else {
    query = query.eq("id", operation.record_id);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as unknown as DomainRecord | null;
}

async function createConflict(operation: SyncOperation, remote: DomainRecord) {
  await localDb.transaction(
    "rw",
    localDb.conflicts,
    localDb.records,
    localDb.operations,
    async () => {
      const key = `${operation.table}:${operation.record_id}`;
      const current = await localDb.records.get(key);
      if (!operationMatchesLocal(current, operation)) {
        await localDb.operations.delete(operation.id);
        return;
      }
      const now = isoNow();
      const conflict: SyncConflict = {
        id: newId(),
        user_id: operation.user_id,
        table_name: operation.table,
        record_id: current.id,
        local_data: current.data as unknown as Record<string, unknown>,
        remote_data: remote as unknown as Record<string, unknown>,
        resolution: "pending",
        resolved_at: null,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      await localDb.conflicts.add(conflict);
      await localDb.records.update(key, {
        sync_status: "conflict",
      });
      await localDb.operations.delete(operation.id);
    },
  );
}

function operationMatchesLocal(
  local: LocalRecord | undefined,
  operation: SyncOperation,
): local is LocalRecord {
  return Boolean(
    local &&
    operation.payload &&
    local.id === operation.record_id &&
    local.version === operation.payload.version &&
    local.updated_at === operation.payload.updated_at,
  );
}

function sameRecordContent(left: DomainRecord, right: DomainRecord) {
  const ignored = new Set(["updated_at", "version"]);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (ignored.has(key)) continue;
    const leftValue = (left as unknown as Record<string, unknown>)[key];
    const rightValue = (right as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) return false;
  }
  return true;
}

export async function acknowledgeOperation(
  operation: SyncOperation,
  returned: DomainRecord,
) {
  const key = `${operation.table}:${operation.record_id}`;
  await localDb.transaction(
    "rw",
    localDb.operations,
    localDb.records,
    async () => {
      const current = await localDb.records.get(key);
      const newerOperations = (
        await localDb.operations
          .where("record_id")
          .equals(operation.record_id)
          .filter(
            (candidate) =>
              candidate.id !== operation.id &&
              candidate.table === operation.table &&
              candidate.user_id === operation.user_id,
          )
          .toArray()
      ).filter((candidate) => candidate.action === "upsert");

      await localDb.operations.delete(operation.id);

      if (
        operationMatchesLocal(current, operation) &&
        newerOperations.length === 0
      ) {
        await localDb.records.put({
          key: `${operation.table}:${returned.id}`,
          table: operation.table,
          id: returned.id,
          user_id: returned.user_id,
          data: returned,
          version: returned.version,
          updated_at: returned.updated_at,
          sync_status: "synced",
        });
        if (returned.id !== operation.record_id) {
          await localDb.records.delete(key);
        }
        return;
      }

      // A newer local edit landed while this request was in flight. Preserve it
      // and advance its cloud base to the acknowledged server version.
      for (const newer of newerOperations) {
        await localDb.operations.update(newer.id, {
          base_version: Math.max(newer.base_version, returned.version),
        });
      }
      if (current?.sync_status === "syncing") {
        await localDb.records.update(key, { sync_status: "pending" });
      }
    },
  );
}

async function flushFile(client: SupabaseClient, fileId: string) {
  const file = await localDb.files.get(fileId);
  if (!file || file.status === "synced") return;
  await localDb.files.update(file.id, { status: "syncing" });
  try {
    const { error } = await client.storage
      .from(file.bucket)
      .upload(file.path, file.blob, {
        contentType: file.content_type,
        upsert: true,
      });
    if (error) throw error;
    await localDb.files.update(file.id, { status: "synced" });
  } catch {
    // The blob remains in IndexedDB and can be retried on the next flush.
    await localDb.files.update(file.id, { status: "failed" });
  }
}

async function recoverInterruptedFiles(userId: string) {
  await localDb.files
    .where("[user_id+status]")
    .equals([userId, "syncing"])
    .modify({ status: "pending" });
}

export async function queueFileUpload(input: {
  userId: string;
  bucket: "meal-photos" | "attachments";
  path: string;
  blob: Blob;
}) {
  const id = newId();
  await localDb.files.add({
    id,
    user_id: input.userId,
    bucket: input.bucket,
    path: input.path,
    blob: input.blob,
    content_type: input.blob.type || "application/octet-stream",
    status: "pending",
    created_at: isoNow(),
  });
  window.dispatchEvent(new CustomEvent("shouzhong:sync-request"));
  return id;
}

type HydratedTableCallback = (tableName: SyncTable) => void;

function aggregateHydrationFailures(results: PromiseSettledResult<void>[]) {
  const failures = results
    .map((result, index) => ({ result, table: syncTables[index] }))
    .filter(
      (
        item,
      ): item is {
        result: PromiseRejectedResult;
        table: SyncTable;
      } => item.result.status === "rejected",
    );
  if (!failures.length) return null;
  return new AggregateError(
    failures.map(({ result }) => result.reason),
    `${failures.map(({ table }) => table).join("、")} 云端读取失败`,
  );
}

async function settleWithoutThrow(task: Promise<unknown>) {
  try {
    await task;
  } catch {
    // A later full hydrate reconciles a transient Realtime/IndexedDB failure.
  }
}

export class SyncEngine {
  private client: SupabaseClient;
  private userId: string;
  private channel?: RealtimeChannel;
  private flushing = false;
  private flushRequested = false;
  private hydratePromise: Promise<void> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private hydrateControllers = new Set<AbortController>();
  private interruptedFilesRecovered = false;
  private destroyed = false;

  constructor(userId: string, client?: SupabaseClient) {
    this.userId = userId;
    this.client = client ?? createClient();
  }

  private async hydrateTable(tableName: SyncTable) {
    let cursor: { updated_at: string; record_id: string } | null = null;

    while (navigator.onLine && !this.destroyed) {
      let query = table(this.client, tableName)
        .select("*")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(HYDRATE_PAGE_SIZE);

      if (cursor) {
        query = query.or(
          `updated_at.gt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.gt.${cursor.record_id})`,
        );
      }

      const controller = new AbortController();
      this.hydrateControllers.add(controller);
      const timeout = setTimeout(
        () => controller.abort(),
        HYDRATE_REQUEST_TIMEOUT_MS,
      );
      const { data, error } = await Promise.resolve(
        query.abortSignal(controller.signal),
      ).finally(() => {
        clearTimeout(timeout);
        this.hydrateControllers.delete(controller);
      });
      if (error) throw error;
      if (this.destroyed) return;

      const rows = (data ?? []) as unknown as DomainRecord[];
      if (!rows.length) break;

      const last = rows[rows.length - 1];
      const nextCursor = {
        updated_at: last.updated_at,
        record_id: last.id,
      };
      if (
        cursor &&
        (nextCursor.updated_at < cursor.updated_at ||
          (nextCursor.updated_at === cursor.updated_at &&
            nextCursor.record_id <= cursor.record_id))
      ) {
        throw new Error(`${tableName} 云端同步游标没有前进`);
      }

      await storeRemotePage(tableName, this.userId, rows);
      cursor = nextCursor;
      if (rows.length < HYDRATE_PAGE_SIZE) break;
    }
  }

  async hydrate(onTableHydrated?: HydratedTableCallback) {
    if (!navigator.onLine || this.destroyed) return;
    if (this.hydratePromise) return this.hydratePromise;
    const hydration = (async () => {
      const results = await Promise.allSettled(
        syncTables.map(async (tableName) => {
          await this.hydrateTable(tableName);
          if (!this.destroyed) onTableHydrated?.(tableName);
        }),
      );
      if (this.destroyed) return;
      const failure = aggregateHydrationFailures(results);
      if (failure) throw failure;
    })();
    this.hydratePromise = hydration;
    try {
      await hydration;
    } finally {
      if (this.hydratePromise === hydration) this.hydratePromise = null;
    }
  }

  async refresh(onTableHydrated?: HydratedTableCallback) {
    if (!navigator.onLine || this.destroyed) return;
    if (this.refreshPromise) return this.refreshPromise;
    const refresh = (async () => {
      let hydrationError: unknown;
      try {
        await this.hydrate(onTableHydrated);
      } catch (error) {
        hydrationError = error;
      }
      if (!this.destroyed) await this.flush();
      if (hydrationError) throw hydrationError;
    })();
    this.refreshPromise = refresh;
    try {
      await refresh;
    } finally {
      if (this.refreshPromise === refresh) this.refreshPromise = null;
    }
  }

  subscribe() {
    if (this.destroyed) return;
    this.channel = this.client.channel(`shouzhong:${this.userId}`);
    for (const tableName of syncTables) {
      this.channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: tableName,
          filter: `user_id=eq.${this.userId}`,
        },
        (payload) => {
          const data = (payload.new || payload.old) as unknown as DomainRecord;
          if (payload.eventType === "DELETE") {
            void settleWithoutThrow(
              deleteRemoteIfClean(tableName, this.userId, data.id),
            );
          } else {
            void settleWithoutThrow(storeRemote(tableName, data));
          }
        },
      );
    }
    void this.channel.subscribe();
  }

  async flush() {
    if (!navigator.onLine || this.destroyed) return;
    if (this.flushing) {
      this.flushRequested = true;
      return;
    }
    this.flushing = true;
    try {
      do {
        this.flushRequested = false;
        await this.flushBatch();
      } while (this.flushRequested && navigator.onLine && !this.destroyed);
    } finally {
      this.flushing = false;
    }
  }

  private async flushBatch() {
    if (!this.interruptedFilesRecovered) {
      await recoverInterruptedFiles(this.userId);
      this.interruptedFilesRecovered = true;
    }
    const files = await localDb.files
      .where("[user_id+status]")
      .anyOf([
        [this.userId, "pending"],
        [this.userId, "failed"],
      ])
      .toArray();
    for (const file of files) {
      if (this.destroyed) return;
      await settleWithoutThrow(flushFile(this.client, file.id));
    }

    if (this.destroyed) return;
    const operations = await localDb.operations
      .where("[user_id+created_at]")
      .between([this.userId, Dexie.minKey], [this.userId, Dexie.maxKey])
      .sortBy("created_at");
    for (const operation of operations) {
      if (this.destroyed) return;
      await this.flushOperation(operation);
    }
  }

  private async flushOperation(operation: SyncOperation) {
    const key = `${operation.table}:${operation.record_id}`;
    const payload = operation.payload as DomainRecord | null;
    let local = await localDb.records.get(key);
    if (!payload || !operationMatchesLocal(local, operation)) {
      await localDb.operations.delete(operation.id);
      return;
    }
    await localDb.records.update(key, { sync_status: "syncing" });
    try {
      const remote = await getRemote(this.client, operation);
      local = await localDb.records.get(key);
      if (!operationMatchesLocal(local, operation)) {
        await localDb.operations.delete(operation.id);
        return;
      }
      if (remote && remote.version > operation.base_version) {
        if (sameRecordContent(remote, payload)) {
          await acknowledgeOperation(operation, remote);
          return;
        }
        await createConflict(operation, remote);
        return;
      }
      const { data, error } = await table(this.client, operation.table)
        .upsert(payload as never, {
          onConflict: naturalKeys[operation.table] ?? "id",
        })
        .select("*")
        .single();
      if (error) throw error;
      await acknowledgeOperation(operation, data as unknown as DomainRecord);
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 200) : "同步失败";
      await localDb.transaction(
        "rw",
        localDb.operations,
        localDb.records,
        async () => {
          const current = await localDb.records.get(key);
          const queued = await localDb.operations.get(operation.id);
          if (!queued || !operationMatchesLocal(current, operation)) {
            await localDb.operations.delete(operation.id);
            if (current?.sync_status === "syncing") {
              await localDb.records.update(key, { sync_status: "pending" });
            }
            return;
          }
          await localDb.operations.update(operation.id, {
            attempts: operation.attempts + 1,
            last_error: message,
          });
          await localDb.records.update(key, { sync_status: "failed" });
        },
      );
    }
  }

  destroy() {
    this.destroyed = true;
    this.flushRequested = false;
    for (const controller of this.hydrateControllers) controller.abort();
    this.hydrateControllers.clear();
    if (this.channel) {
      void settleWithoutThrow(this.client.removeChannel(this.channel));
      this.channel = undefined;
    }
  }
}

// Dexie keys are used dynamically above; keep the import local to the browser.
import Dexie from "dexie";

export function summarizeSync(rows: LocalRecord[]) {
  if (rows.some((row) => row.sync_status === "conflict")) return "conflict";
  if (rows.some((row) => row.sync_status === "failed")) return "failed";
  if (rows.some((row) => ["pending", "syncing"].includes(row.sync_status))) {
    return "pending";
  }
  return "synced";
}
