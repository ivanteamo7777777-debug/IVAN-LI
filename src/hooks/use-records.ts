"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "@/lib/local-db";
import type { DomainRecord, SyncTable } from "@/types/domain";

export function useRecords<T extends DomainRecord>(
  table: SyncTable,
  userId: string,
) {
  return (
    useLiveQuery(
      async () => {
        const rows = await localDb.records
          .where("[table+user_id]")
          .equals([table, userId])
          .toArray();
        return rows
          .filter((row) => !row.data.deleted_at)
          .map((row) => row.data as T);
      },
      [table, userId],
    ) ?? []
  );
}
