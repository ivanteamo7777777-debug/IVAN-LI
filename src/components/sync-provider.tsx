"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { localDb } from "@/lib/local-db";
import { SyncEngine, summarizeSync } from "@/lib/sync-engine";

interface SyncContextValue {
  userId: string;
  online: boolean;
  hydrated: boolean;
  status: "synced" | "pending" | "failed" | "conflict";
  pendingCount: number;
  conflictCount: number;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);
const SYNC_BATCH_DELAY_MS = 700;

export function SyncProvider({
  userId,
  localOnly,
  children,
}: {
  userId: string;
  localOnly: boolean;
  children: React.ReactNode;
}) {
  const engine = useRef<SyncEngine | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [hydrated, setHydrated] = useState(localOnly);
  const liveRows = useLiveQuery(
    () => localDb.records.where("user_id").equals(userId).toArray(),
    [userId],
  );
  const rows = useMemo(() => liveRows ?? [], [liveRows]);
  const pendingCount =
    useLiveQuery(
      () => localDb.operations.where("user_id").equals(userId).count(),
      [userId],
    ) ?? 0;
  const conflictCount =
    useLiveQuery(
      () =>
        localDb.conflicts
          .where("[user_id+resolution]")
          .equals([userId, "pending"])
          .count(),
      [userId],
    ) ?? 0;

  const syncNow = useCallback(async () => {
    if (localOnly || !engine.current || !navigator.onLine) return;
    if (syncTimer.current !== null) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
    await engine.current.flush();
  }, [localOnly]);

  const scheduleSync = useCallback(() => {
    if (localOnly || !navigator.onLine) return;
    if (syncTimer.current !== null) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      void syncNow();
    }, SYNC_BATCH_DELAY_MS);
  }, [localOnly, syncNow]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      if (syncTimer.current !== null) {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }
      void syncNow();
    };
    const onOffline = () => setOnline(false);
    const onSyncRequest = () => scheduleSync();
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "SHOUZHONG_SYNC_REQUEST") void syncNow();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("shouzhong:sync-request", onSyncRequest);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    return () => {
      if (syncTimer.current !== null) {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("shouzhong:sync-request", onSyncRequest);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, [scheduleSync, syncNow]);

  useEffect(() => {
    if (localOnly) return;
    const next = new SyncEngine(userId);
    engine.current = next;
    next.subscribe();
    void next
      .hydrate()
      .then(() => next.flush())
      .catch(() => toast.error("云端连接暂时不可用，本地记录仍可继续"))
      .finally(() => setHydrated(true));
    return () => {
      next.destroy();
      engine.current = null;
    };
  }, [localOnly, userId]);

  useEffect(() => {
    let cancelled = false;
    async function warmAuthenticatedShell() {
      if (!("serviceWorker" in navigator)) return;
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true },
          );
        });
      }
      if (!cancelled && navigator.onLine) {
        await fetch("/today", { credentials: "same-origin" });
      }
    }
    void warmAuthenticatedShell().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const value = useMemo<SyncContextValue>(
    () => ({
      userId,
      online,
      hydrated,
      status: conflictCount ? "conflict" : summarizeSync(rows),
      pendingCount,
      conflictCount,
      syncNow,
    }),
    [conflictCount, hydrated, online, pendingCount, rows, syncNow, userId],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) throw new Error("useSync 必须在 SyncProvider 内使用");
  return context;
}
