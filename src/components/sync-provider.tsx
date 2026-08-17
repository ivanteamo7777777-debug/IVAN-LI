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
import { SyncEngine } from "@/lib/sync-engine";
import { localDateKey } from "@/lib/utils";
import type { DailyTask } from "@/types/domain";

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
  const [hydrationState, setHydrationState] = useState({
    userId,
    ready: localOnly,
  });
  const hydrated =
    hydrationState.userId === userId ? hydrationState.ready : localOnly;
  const queuedOperationCount =
    useLiveQuery(
      () => localDb.operations.where("user_id").equals(userId).count(),
      [userId],
    ) ?? 0;
  const recordSyncCounts = useLiveQuery(async () => {
    const count = (syncStatus: "pending" | "syncing" | "failed") =>
      localDb.records
        .where("[user_id+sync_status]")
        .equals([userId, syncStatus])
        .count();
    const [pending, syncing, failed] = await Promise.all([
      count("pending"),
      count("syncing"),
      count("failed"),
    ]);
    return { pending, syncing, failed };
  }, [userId]) ?? { pending: 0, syncing: 0, failed: 0 };
  const fileSyncCounts = useLiveQuery(async () => {
    const count = (status: "pending" | "syncing" | "failed") =>
      localDb.files.where("[user_id+status]").equals([userId, status]).count();
    const [pending, syncing, failed] = await Promise.all([
      count("pending"),
      count("syncing"),
      count("failed"),
    ]);
    return { pending, syncing, failed };
  }, [userId]) ?? { pending: 0, syncing: 0, failed: 0 };
  const pendingCount =
    queuedOperationCount + fileSyncCounts.pending + fileSyncCounts.syncing;
  const conflictCount =
    useLiveQuery(
      () =>
        localDb.conflicts
          .where("[user_id+resolution]")
          .equals([userId, "pending"])
          .count(),
      [userId],
    ) ?? 0;

  const markDailyTasksHydrated = useCallback(
    (tableName: string) => {
      if (tableName === "daily_tasks") {
        setHydrationState({ userId, ready: true });
      }
    },
    [userId],
  );

  const flushPending = useCallback(async () => {
    if (localOnly || !engine.current || !navigator.onLine) return;
    try {
      await engine.current.flush();
    } catch {
      toast.error("待同步记录暂时未发送，本地内容已经保留");
    }
  }, [localOnly]);

  const syncNow = useCallback(async () => {
    if (localOnly || !engine.current || !navigator.onLine) return;
    if (syncTimer.current !== null) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
    try {
      await engine.current.refresh(markDailyTasksHydrated);
    } catch {
      toast.error("部分云端数据暂时未刷新，本地记录仍可继续");
    }
  }, [localOnly, markDailyTasksHydrated]);

  const scheduleSync = useCallback(() => {
    if (localOnly || !navigator.onLine) return;
    if (syncTimer.current !== null) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      void flushPending();
    }, SYNC_BATCH_DELAY_MS);
  }, [flushPending, localOnly]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      if (syncTimer.current !== null) {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }
      void syncNow();
    };
    const onOffline = () => {
      setOnline(false);
      // Offline users must be able to create today's local slots immediately.
      setHydrationState({ userId, ready: true });
    };
    const onSyncRequest = () => scheduleSync();
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "SHOUZHONG_SYNC_REQUEST") void flushPending();
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
  }, [flushPending, scheduleSync, syncNow, userId]);

  useEffect(() => {
    if (localOnly) return;
    const next = new SyncEngine(userId);
    let active = true;
    engine.current = next;
    next.subscribe();

    void (async () => {
      if (!navigator.onLine) {
        if (active) setHydrationState({ userId, ready: true });
        return;
      }
      const today = localDateKey();
      const hasLocalToday = await localDb.records
        .where("[table+user_id]")
        .equals(["daily_tasks", userId])
        .filter((row) => {
          const task = row.data as DailyTask;
          return task.entry_date === today && !task.deleted_at;
        })
        .count();
      if (active && hasLocalToday > 0) {
        setHydrationState({ userId, ready: true });
      }
    })().catch(() => {
      if (active && !navigator.onLine) {
        setHydrationState({ userId, ready: true });
      }
    });

    void (async () => {
      try {
        await next.refresh((tableName) => {
          if (active) markDailyTasksHydrated(tableName);
        });
      } catch {
        if (active) {
          toast.error("部分云端数据暂时未刷新，本地记录仍可继续");
        }
      }
    })();
    return () => {
      active = false;
      next.destroy();
      if (engine.current === next) engine.current = null;
    };
  }, [localOnly, markDailyTasksHydrated, userId]);

  useEffect(() => {
    let cancelled = false;
    async function warmAuthenticatedShell() {
      if (!("serviceWorker" in navigator)) return;
      if (navigator.serviceWorker.controller) return;
      await navigator.serviceWorker.ready;
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        );
      });
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
      status: conflictCount
        ? "conflict"
        : recordSyncCounts.failed + fileSyncCounts.failed > 0
          ? "failed"
          : pendingCount + recordSyncCounts.pending + recordSyncCounts.syncing >
              0
            ? "pending"
            : "synced",
      pendingCount,
      conflictCount,
      syncNow,
    }),
    [
      conflictCount,
      fileSyncCounts.failed,
      hydrated,
      online,
      pendingCount,
      recordSyncCounts.failed,
      recordSyncCounts.pending,
      recordSyncCounts.syncing,
      syncNow,
      userId,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) throw new Error("useSync 必须在 SyncProvider 内使用");
  return context;
}
