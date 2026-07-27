"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Bell,
  CloudAlert,
  Download,
  FileJson,
  LogOut,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  exportAllData,
  clearLocalUserData,
  localDb,
  patchLocal,
  resolveConflict,
  restoreAllData,
  saveLocal,
} from "@/lib/local-db";
import { createClient } from "@/lib/supabase/client";
import {
  downloadBlob,
  isoNow,
  newId,
  toCsv,
} from "@/lib/utils";
import type {
  DomainRecord,
  ReminderSetting,
  SyncTable,
} from "@/types/domain";
import { useSync } from "@/components/sync-provider";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

function emptyReminder(userId: string): ReminderSetting {
  const now = isoNow();
  return {
    id: newId(),
    user_id: userId,
    time_zone: "Asia/Shanghai",
    daily_six_enabled: false,
    daily_six_time: "08:00",
    exercise_enabled: false,
    exercise_time: "18:00",
    review_enabled: false,
    review_time: "21:30",
    last_daily_six_sent: null,
    last_exercise_sent: null,
    last_review_sent: null,
    created_at: now,
    updated_at: now,
    version: 0,
  };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function SettingsView() {
  const router = useRouter();
  const { userId, conflictCount, pendingCount } = useSync();
  const importRef = useRef<HTMLInputElement>(null);
  const reminderRows =
    useLiveQuery(
      () =>
        localDb.records
          .where("[table+user_id]")
          .equals(["reminder_settings", userId])
          .toArray(),
      [userId],
    ) ?? [];
  const reminder =
    (reminderRows[0]?.data as ReminderSetting | undefined) ??
    emptyReminder(userId);
  const conflicts =
    useLiveQuery(
      () =>
        localDb.conflicts
          .where("[user_id+resolution]")
          .equals([userId, "pending"])
          .toArray(),
      [userId],
    ) ?? [];
  const deleted =
    useLiveQuery(
      () =>
        localDb.records
          .where("user_id")
          .equals(userId)
          .filter((row) => Boolean(row.data.deleted_at))
          .toArray(),
      [userId],
    ) ?? [];

  const isExisting = reminderRows.length > 0;

  async function patchReminder(patch: Partial<ReminderSetting>) {
    if (isExisting) {
      await patchLocal("reminder_settings", reminder, patch);
    } else {
      await saveLocal("reminder_settings", { ...reminder, ...patch });
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      throw new Error("当前浏览器不支持 Web Push");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("你没有授予通知权限，提醒保持关闭");
    }
    const registration = await navigator.serviceWorker.ready;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) throw new Error("VAPID 公钥尚未配置");
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) throw new Error("保存通知订阅失败");
    toast.success("通知已开启");
  }

  async function toggleReminder(
    field:
      | "daily_six_enabled"
      | "exercise_enabled"
      | "review_enabled",
    enabled: boolean,
  ) {
    try {
      if (enabled) await enableNotifications();
      await patchReminder({ [field]: enabled });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "通知开启失败");
    }
  }

  async function testNotification() {
    const response = await fetch("/api/push/test", { method: "POST" });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      toast.error(result.error ?? "测试通知发送失败");
      return;
    }
    toast.success("测试通知已发送");
  }

  async function exportJson() {
    const data = await exportAllData(userId);
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      }),
      `守中日课-完整备份-${new Date().toISOString().slice(0, 10)}.json`,
    );
  }

  async function exportCsv(table: SyncTable) {
    const rows = await localDb.records
      .where("[table+user_id]")
      .equals([table, userId])
      .toArray();
    const csv = `\uFEFF${toCsv(
      rows
        .filter((row) => !row.data.deleted_at)
        .map((row) => row.data as unknown as Record<string, unknown>),
    )}`;
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `守中日课-${table}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  async function importJson(file: File) {
    try {
      const backup = JSON.parse(await file.text()) as Parameters<
        typeof restoreAllData
      >[1];
      await restoreAllData(userId, backup);
      toast.success("备份已导入，本地队列将逐项同步");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    }
  }

  async function signOut() {
    if (
      pendingCount > 0 &&
      !window.confirm(
        `还有 ${pendingCount} 项等待同步。现在退出会清除此设备上的未同步副本，是否继续？`,
      )
    ) {
      return;
    }
    if (process.env.NEXT_PUBLIC_E2E_MODE === "1") {
      await clearLocalUserData(userId);
      router.push("/auth/login");
      return;
    }
    await createClient().auth.signOut();
    await clearLocalUserData(userId);
    router.replace("/auth/login");
    router.refresh();
  }

  async function deleteAccount() {
    const phrase = window.prompt(
      "此操作会清除账号及全部云端数据，且无法撤销。\n请输入“删除我的全部数据”继续：",
    );
    if (phrase !== "删除我的全部数据") return;
    if (process.env.NEXT_PUBLIC_E2E_MODE === "1") {
      await clearLocalUserData(userId);
      window.location.href = "/auth/login";
      return;
    }
    const response = await fetch("/api/account", { method: "DELETE" });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      toast.error(result.error ?? "账号删除失败");
      return;
    }
    await clearLocalUserData(userId);
    window.location.href = "/auth/login";
  }

  const csvModules: { table: SyncTable; label: string }[] = useMemo(
    () => [
      { table: "directions", label: "方向" },
      { table: "plans", label: "计划" },
      { table: "daily_tasks", label: "每日六件事" },
      { table: "exercise_logs", label: "运动" },
      { table: "meal_logs", label: "饮食" },
      { table: "accumulation_entries", label: "长期积累" },
      { table: "reviews", label: "复盘" },
    ],
    [],
  );

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="控制权始终属于你"
        title="设置与数据"
        description="管理提醒、同步冲突、备份恢复与账号安全。通知权限只会在你主动开启时请求。"
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_.95fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="mb-1 flex items-center gap-2 text-[var(--river)]">
                <Bell className="size-4" />
                <span className="text-xs tracking-[0.16em]">可选提醒</span>
              </div>
              <CardTitle>每日提醒</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label>时区</Label>
                <Input
                  value={reminder.time_zone}
                  onChange={(event) =>
                    void patchReminder({ time_zone: event.target.value })
                  }
                  placeholder="Asia/Shanghai"
                />
              </div>
              {[
                {
                  label: "今日六件事提醒",
                  enabled: reminder.daily_six_enabled,
                  field: "daily_six_enabled" as const,
                  time: reminder.daily_six_time,
                  timeField: "daily_six_time" as const,
                },
                {
                  label: "运动提醒",
                  enabled: reminder.exercise_enabled,
                  field: "exercise_enabled" as const,
                  time: reminder.exercise_time,
                  timeField: "exercise_time" as const,
                },
                {
                  label: "晚间复盘提醒",
                  enabled: reminder.review_enabled,
                  field: "review_enabled" as const,
                  time: reminder.review_time,
                  timeField: "review_time" as const,
                },
              ].map((item) => (
                <div
                  key={item.field}
                  className="flex items-center gap-4 rounded-xl border border-[var(--line)] p-4"
                >
                  <Switch
                    checked={item.enabled}
                    onCheckedChange={(enabled) =>
                      void toggleReminder(item.field, enabled)
                    }
                    aria-label={item.label}
                  />
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {item.label}
                  </span>
                  <Input
                    type="time"
                    value={item.time}
                    className="w-28"
                    onChange={(event) =>
                      void patchReminder({
                        [item.timeField]: event.target.value,
                      })
                    }
                  />
                </div>
              ))}
              <Button variant="secondary" onClick={() => void testNotification()}>
                <Send />
                发送测试通知
              </Button>
              <p className="text-xs leading-5 text-[var(--muted-light)]">
                iPhone/iPad 需要先“添加到主屏幕”，再从独立应用中允许通知。提醒失败不会影响记录与同步。
              </p>
            </CardContent>
          </Card>

          <Card id="conflicts">
            <CardHeader>
              <div className="mb-1 flex items-center gap-2 text-[var(--warm)]">
                <CloudAlert className="size-4" />
                <span className="text-xs tracking-[0.16em]">多设备同步</span>
              </div>
              <CardTitle>冲突处理</CardTitle>
            </CardHeader>
            <CardContent>
              {conflictCount ? (
                <div className="space-y-3">
                  {conflicts.map((conflict) => (
                    <div
                      key={conflict.id}
                      className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4"
                    >
                      <div className="flex items-center gap-2">
                        <Badge>{conflict.table_name}</Badge>
                        <span className="text-xs text-[var(--muted)]">
                          本机与云端都已保留
                        </span>
                      </div>
                      <p className="mt-3 text-sm">
                        本机更新时间：
                        {String(conflict.local_data.updated_at ?? "未知")}
                      </p>
                      <p className="mt-1 text-sm">
                        云端更新时间：
                        {String(conflict.remote_data.updated_at ?? "未知")}
                      </p>
                      <div className="mt-4 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            void resolveConflict(conflict, "local")
                          }
                        >
                          保留本机版本
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void resolveConflict(conflict, "remote")
                          }
                        >
                          使用云端版本
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
                  <ShieldCheck className="size-5 text-[var(--accent)]" />
                  当前没有需要处理的同步冲突。
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>备份与迁移</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button className="w-full justify-start" onClick={() => void exportJson()}>
                <FileJson />
                导出全部数据为 JSON
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importJson(file);
                  event.currentTarget.value = "";
                }}
              />
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => importRef.current?.click()}
              >
                <Upload />
                从 JSON 恢复导入
              </Button>
              <div>
                <Label>各模块 CSV</Label>
                <div className="grid grid-cols-2 gap-2">
                  {csvModules.map((module) => (
                    <Button
                      key={module.table}
                      size="sm"
                      variant="ghost"
                      className="justify-start"
                      onClick={() => void exportCsv(module.table)}
                    >
                      <Download />
                      {module.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>回收站</CardTitle>
            </CardHeader>
            <CardContent>
              {deleted.length ? (
                <div className="space-y-2">
                  {deleted.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-3 rounded-xl border border-[var(--line)] p-3"
                    >
                      <Trash2 className="size-4 text-[var(--muted)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {String(
                            (row.data as unknown as Record<string, unknown>)
                              .title ?? row.table,
                          )}
                        </p>
                        <p className="text-[10px] text-[var(--muted)]">
                          {row.table}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void saveLocal(row.table, {
                            ...row.data,
                            deleted_at: null,
                          } as DomainRecord)
                        }
                      >
                        <RotateCcw />
                        恢复
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">回收站为空。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>账号安全</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => void signOut()}
              >
                <LogOut />
                退出登录
              </Button>
              <Button
                variant="danger"
                className="w-full justify-start"
                onClick={() => void deleteAccount()}
              >
                <Trash2 />
                删除账号和全部数据
              </Button>
              <p className="text-xs leading-5 text-[var(--muted-light)]">
                删除账号前会要求输入确认短语。建议先导出完整 JSON 备份。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
