"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  FileUp,
  Link2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useRecords } from "@/hooks/use-records";
import { deleteLocal, patchLocal, saveLocal } from "@/lib/local-db";
import { queueFileUpload } from "@/lib/sync-engine";
import { isoNow, localDateKey, newId } from "@/lib/utils";
import type {
  AccumulationEntry,
  DailyTask,
  Plan,
} from "@/types/domain";
import { useSync } from "@/components/sync-provider";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const blankForm = {
  title: "",
  content: "",
  entry_date: localDateKey(),
  tags: "",
  source_task_id: null as string | null,
  source_plan_id: null as string | null,
  attachment_paths: [] as string[],
  reusable_conclusion: "",
  next_use: "",
};

export function AccumulationsView() {
  const { userId } = useSync();
  const entries = useRecords<AccumulationEntry>(
    "accumulation_entries",
    userId,
  );
  const tasks = useRecords<DailyTask>("daily_tasks", userId);
  const plans = useRecords<Plan>("plans", userId);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [taskPicker, setTaskPicker] = useState(false);
  const [editing, setEditing] = useState<AccumulationEntry | null>(null);
  const [form, setForm] = useState(blankForm);

  const tags = useMemo(
    () => [...new Set(entries.flatMap((entry) => entry.tags))].sort(),
    [entries],
  );
  const filtered = entries
    .filter((entry) => !entry.archived_at)
    .filter(
      (entry) =>
        !query ||
        [entry.title, entry.content, entry.reusable_conclusion, ...entry.tags]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .filter((entry) => !tagFilter || entry.tags.includes(tagFilter))
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date));

  const completedUncaptured = tasks.filter(
    (task) =>
      task.status === "completed" &&
      task.title &&
      !entries.some((entry) => entry.source_task_id === task.id),
  );

  function startCreate(task?: DailyTask) {
    setEditing(null);
    setForm({
      ...blankForm,
      entry_date: task?.entry_date ?? localDateKey(),
      title: task?.title ?? "",
      content: task?.result ?? "",
      source_task_id: task?.id ?? null,
      source_plan_id: task?.weekly_plan_id ?? null,
    });
    setTaskPicker(false);
    setOpen(true);
  }

  function startEdit(entry: AccumulationEntry) {
    setEditing(entry);
    setForm({
      title: entry.title,
      content: entry.content,
      entry_date: entry.entry_date,
      tags: entry.tags.join(", "),
      source_task_id: entry.source_task_id,
      source_plan_id: entry.source_plan_id,
      attachment_paths: entry.attachment_paths,
      reusable_conclusion: entry.reusable_conclusion,
      next_use: entry.next_use,
    });
    setOpen(true);
  }

  async function addAttachment(file: File) {
    const suffix = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "bin";
    const path = `${userId}/${form.entry_date}/${newId()}.${suffix}`;
    await queueFileUpload({
      userId,
      bucket: "attachments",
      path,
      blob: file,
    });
    setForm((value) => ({
      ...value,
      attachment_paths: [...value.attachment_paths, path],
    }));
    toast.success("附件已进入本地同步队列");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title || !form.content) {
      toast.error("请填写标题和真正留下来的内容");
      return;
    }
    const payload = {
      ...form,
      tags: form.tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    if (editing) {
      await patchLocal("accumulation_entries", editing, payload);
    } else {
      const now = isoNow();
      await saveLocal("accumulation_entries", {
        id: newId(),
        user_id: userId,
        ...payload,
        created_at: now,
        updated_at: now,
        version: 0,
      });
    }
    setOpen(false);
  }

  function sourceLabel(entry: AccumulationEntry) {
    const task = tasks.find((item) => item.id === entry.source_task_id);
    const plan = plans.find((item) => item.id === entry.source_plan_id);
    return task?.title ?? plan?.title ?? "手动记录";
  }

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="完成之后，留下什么"
        title="长期积累库"
        description="只保存真正形成的内容、结论和可复用资产。完成数量不会自动变成积累。"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setTaskPicker(true)}
              disabled={!completedUncaptured.length}
            >
              <Sparkles />
              从完成任务选择
            </Button>
            <Button onClick={() => startCreate()}>
              <Plus />
              新增积累
            </Button>
          </>
        }
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-light)]" />
          <Input
            value={query}
            placeholder="搜索标题、内容、结论或标签"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
          className="h-10 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-sm"
        >
          <option value="">全部标签</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((entry) => (
          <Card key={entry.id}>
            <CardHeader>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs tabular-nums text-[var(--muted)]">
                  {entry.entry_date}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(entry)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    onClick={() =>
                      void patchLocal("accumulation_entries", entry, {
                        archived_at: isoNow(),
                      })
                    }
                    aria-label="归档"
                  >
                    <Archive />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-red-700"
                    onClick={() => {
                      if (window.confirm("将此积累条目移入回收站？")) {
                        void deleteLocal("accumulation_entries", entry);
                      }
                    }}
                    aria-label="删除"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <CardTitle className="text-2xl">{entry.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">
                {entry.content}
              </p>
              {entry.reusable_conclusion && (
                <div className="mt-5 rounded-xl bg-[var(--accent-wash)] p-4">
                  <p className="text-[11px] tracking-[0.14em] text-[var(--accent-deep)]">
                    可复用结论
                  </p>
                  <p className="mt-2 font-serif leading-7">
                    {entry.reusable_conclusion}
                  </p>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {entry.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
                {entry.attachment_paths.length > 0 && (
                  <Badge>{entry.attachment_paths.length} 个附件</Badge>
                )}
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
                <Link2 className="size-3.5" />
                <span className="truncate">来源：{sourceLabel(entry)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!filtered.length && (
        <Card>
          <CardContent className="p-10 text-center text-[var(--muted)]">
            暂无积累条目。完成任务后，由你决定是否把成果带到这里。
          </CardContent>
        </Card>
      )}

      <Dialog open={taskPicker} onOpenChange={setTaskPicker}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择一项真正有留下来的任务</DialogTitle>
            <DialogDescription>
              选择只会创建草稿，不会自动保存到积累库。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {completedUncaptured.map((task) => (
              <button
                key={task.id}
                className="w-full rounded-xl border border-[var(--line)] p-4 text-left hover:border-[var(--accent)]"
                onClick={() => startCreate(task)}
              >
                <p className="font-medium">{task.title}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {task.entry_date} · 第 {task.slot_index} 件
                </p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑积累" : "积累草稿"}</DialogTitle>
            <DialogDescription>
              保存前确认：这里记录的是留下来的东西，不只是“做完了”。
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <div className="sm:col-span-2">
              <Label>标题</Label>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm((value) => ({ ...value, title: event.target.value }))
                }
              />
            </div>
            <div>
              <Label>日期</Label>
              <Input
                type="date"
                value={form.entry_date}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    entry_date: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>标签（逗号分隔）</Label>
              <Input
                value={form.tags}
                onChange={(event) =>
                  setForm((value) => ({ ...value, tags: event.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label>内容</Label>
              <Textarea
                className="min-h-36"
                value={form.content}
                onChange={(event) =>
                  setForm((value) => ({ ...value, content: event.target.value }))
                }
              />
            </div>
            <div>
              <Label>可复用结论</Label>
              <Textarea
                value={form.reusable_conclusion}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    reusable_conclusion: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>下一次如何使用</Label>
              <Textarea
                value={form.next_use}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    next_use: event.target.value,
                  }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label>附件或图片</Label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line-strong)] p-4 text-sm text-[var(--muted)] hover:bg-[var(--surface)]">
                <FileUp className="size-4" />
                选择文件（可离线上传）
                <input
                  type="file"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void addAttachment(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {form.attachment_paths.length > 0 && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  已选择 {form.attachment_paths.length} 个附件
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit">确认保存</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
