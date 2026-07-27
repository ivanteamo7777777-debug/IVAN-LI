"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  localDb,
  storeRemote,
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
  exercise_logs: "user_id,entry_date",
  meal_logs: "user_id,entry_date,meal_type",
  reviews: "user_id,review_type,period_start,period_end",
  reminder_settings: "user_id",
  push_subscriptions: "user_id,endpoint",
};

function table(client: SupabaseClient, name: SyncTable) {
  // Database types are generated after a project is linked. Runtime remains RLS-scoped.
  return client.from(name) as ReturnType<SupabaseClient["from"]>;
}

async function getRemote(
  client: SupabaseClient,
  operation: SyncOperation,
): Promise<DomainRecord | null> {
  let query = table(client, operation.table).select("*");
  const payload = operation.payload as unknown as Record<string, unknown> | null;
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
  } else if (
    ["daily_entries", "exercise_logs"].includes(operation.table) &&
    payload?.entry_date
  ) {
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

async function createConflict(
  operation: SyncOperation,
  local: DomainRecord,
  remote: DomainRecord,
) {
  const now = isoNow();
  const conflict: SyncConflict = {
    id: newId(),
    user_id: operation.user_id,
    table_name: operation.table,
    record_id: local.id,
    local_data: local as unknown as Record<string, unknown>,
    remote_data: remote as unknown as Record<string, unknown>,
    resolution: "pending",
    resolved_at: null,
    created_at: now,
    updated_at: now,
    version: 1,
  };
  await localDb.transaction(
    "rw",
    localDb.conflicts,
    localDb.records,
    localDb.operations,
    async () => {
      await localDb.conflicts.add(conflict);
      await localDb.records.update(`${operation.table}:${local.id}`, {
        sync_status: "conflict",
      });
      await localDb.operations.delete(operation.id);
    },
  );
}

async function flushFile(client: SupabaseClient, fileId: string) {
  const file = await localDb.files.get(fileId);
  if (!file || file.status === "synced") return;
  await localDb.files.update(file.id, { status: "syncing" });
  const { error } = await client.storage
    .from(file.bucket)
    .upload(file.path, file.blob, {
      contentType: file.content_type,
      upsert: true,
    });
  await localDb.files.update(file.id, {
    status: error ? "failed" : "synced",
  });
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

export class SyncEngine {
  private client: SupabaseClient;
  private userId: string;
  private channel?: RealtimeChannel;
  private flushing = false;

  constructor(userId: string) {
    this.userId = userId;
    this.client = createClient();
  }

  async hydrate() {
    if (!navigator.onLine) return;
    for (const tableName of syncTables) {
      const { data, error } = await table(this.client, tableName)
        .select("*")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: true });
      if (error) throw error;
      for (const row of data ?? []) {
        await storeRemote(tableName, row as unknown as DomainRecord);
      }
    }
  }

  subscribe() {
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
        async (payload) => {
          const data = (payload.new || payload.old) as unknown as DomainRecord;
          if (payload.eventType === "DELETE") {
            await localDb.records.delete(`${tableName}:${data.id}`);
          } else {
            await storeRemote(tableName, data);
          }
        },
      );
    }
    void this.channel.subscribe();
  }

  async flush() {
    if (this.flushing || !navigator.onLine) return;
    this.flushing = true;
    try {
      const files = await localDb.files
        .where("[user_id+status]")
        .anyOf([
          [this.userId, "pending"],
          [this.userId, "failed"],
        ])
        .toArray();
      for (const file of files) await flushFile(this.client, file.id);

      const operations = await localDb.operations
        .where("[user_id+created_at]")
        .between([this.userId, Dexie.minKey], [this.userId, Dexie.maxKey])
        .sortBy("created_at");
      for (const operation of operations) {
        await this.flushOperation(operation);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async flushOperation(operation: SyncOperation) {
    const key = `${operation.table}:${operation.record_id}`;
    const local = await localDb.records.get(key);
    if (!local) {
      await localDb.operations.delete(operation.id);
      return;
    }
    await localDb.records.update(key, { sync_status: "syncing" });
    try {
      const remote = await getRemote(this.client, operation);
      if (remote && remote.version > operation.base_version) {
        const sameMutation =
          remote.updated_at === operation.payload?.updated_at &&
          remote.version === operation.payload?.version;
        if (!sameMutation) {
          await createConflict(operation, local.data, remote);
          return;
        }
      }
      const payload = operation.payload as DomainRecord;
      const { data, error } = await table(this.client, operation.table)
        .upsert(payload as never, {
          onConflict: naturalKeys[operation.table] ?? "id",
        })
        .select("*")
        .single();
      if (error) throw error;
      await localDb.transaction(
        "rw",
        localDb.operations,
        localDb.records,
        async () => {
          await localDb.operations.delete(operation.id);
          const returned = data as unknown as DomainRecord;
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
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 200) : "同步失败";
      await localDb.transaction(
        "rw",
        localDb.operations,
        localDb.records,
        async () => {
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
    if (this.channel) void this.client.removeChannel(this.channel);
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
