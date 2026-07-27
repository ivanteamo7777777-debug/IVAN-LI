"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Edit3,
  Link2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useRecords } from "@/hooks/use-records";
import { deleteLocal, patchLocal, saveLocal } from "@/lib/local-db";
import { isoNow, newId } from "@/lib/utils";
import {
  directionLabels,
  type DailyTask,
  type Direction,
  type DirectionKind,
  type Plan,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const kinds = Object.keys(directionLabels) as DirectionKind[];

export function DirectionsView() {
  const { userId } = useSync();
  const directions = useRecords<Direction>("directions", userId);
  const plans = useRecords<Plan>("plans", userId);
  const tasks = useRecords<DailyTask>("daily_tasks", userId);
  const [editing, setEditing] = useState<Direction | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    kind: "life_direction" as DirectionKind,
    title: "",
    content: "",
  });

  const sorted = [...directions].sort((a, b) => a.sort_order - b.sort_order);
  const planMap = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans],
  );

  function directionOfPlan(plan: Plan | undefined): string | null {
    const visited = new Set<string>();
    let current = plan;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.direction_id) return current.direction_id;
      current = current.parent_id ? planMap.get(current.parent_id) : undefined;
    }
    return null;
  }

  function related(directionId: string) {
    const relatedPlans = plans.filter(
      (plan) => directionOfPlan(plan) === directionId,
    );
    const weeklyIds = new Set(
      relatedPlans
        .filter((plan) => plan.plan_type === "weekly")
        .map((plan) => plan.id),
    );
    const relatedTasks = tasks.filter(
      (task) => task.weekly_plan_id && weeklyIds.has(task.weekly_plan_id),
    );
    return { planCount: relatedPlans.length, taskCount: relatedTasks.length };
  }

  function startCreate() {
    setEditing(null);
    setForm({ kind: "life_direction", title: "", content: "" });
    setOpen(true);
  }

  function startEdit(direction: Direction) {
    setEditing(direction);
    setForm({
      kind: direction.kind,
      title: direction.title,
      content: direction.content,
    });
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      toast.error("请填写标题和内容");
      return;
    }
    if (editing) {
      await patchLocal("directions", editing, form);
    } else {
      const now = isoNow();
      await saveLocal("directions", {
        id: newId(),
        user_id: userId,
        ...form,
        sort_order: sorted.length,
        created_at: now,
        updated_at: now,
        version: 0,
      });
    }
    setOpen(false);
  }

  async function move(direction: Direction, delta: number) {
    const index = sorted.findIndex((item) => item.id === direction.id);
    const other = sorted[index + delta];
    if (!other) return;
    await patchLocal("directions", direction, {
      sort_order: other.sort_order,
    });
    await patchLocal("directions", other, {
      sort_order: direction.sort_order,
    });
  }

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="人生方向 → 每日行动"
        title="方向库"
        description="方向不是口号，而是计划与执行的上游。保留会长期约束选择的文字。"
        actions={
          <Button onClick={startCreate}>
            <Plus />
            新增方向
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {sorted.map((direction, index) => {
          const stats = related(direction.id);
          return (
            <Card
              key={direction.id}
              className={direction.archived_at ? "opacity-55" : ""}
            >
              <CardHeader>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Badge>{directionLabels[direction.kind]}</Badge>
                  <div className="flex items-center">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      disabled={index === 0}
                      onClick={() => void move(direction, -1)}
                      aria-label="向上移动"
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      disabled={index === sorted.length - 1}
                      onClick={() => void move(direction, 1)}
                      aria-label="向下移动"
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                </div>
                <CardTitle className="text-2xl">{direction.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap font-serif text-[17px] leading-8 text-[var(--ink-soft)]">
                  {direction.content}
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
                  <Badge>
                    <Link2 className="mr-1 size-3" />
                    {stats.planCount} 个计划
                  </Badge>
                  <Badge>{stats.taskCount} 条执行记录</Badge>
                  <div className="ml-auto flex">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() => startEdit(direction)}
                      aria-label="编辑"
                    >
                      <Edit3 />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() =>
                        void patchLocal("directions", direction, {
                          archived_at: direction.archived_at ? null : isoNow(),
                        })
                      }
                      aria-label={direction.archived_at ? "取消归档" : "归档"}
                    >
                      <Archive />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-red-700"
                      onClick={() => {
                        if (window.confirm("将此方向移入回收站？相关计划不会删除。")) {
                          void deleteLocal("directions", direction);
                        }
                      }}
                      aria-label="移入回收站"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {!sorted.length && (
        <Card>
          <CardContent className="p-10 text-center text-[var(--muted)]">
            暂无方向。新账号会由数据库自动写入 Mission、Vision 01 和 Value。
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑方向" : "新增方向"}</DialogTitle>
            <DialogDescription>
              方向可以关联年度计划，并沿计划路径追溯到每日执行。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <Label>类型</Label>
              <Select
                value={form.kind}
                onValueChange={(kind: DirectionKind) =>
                  setForm((value) => ({ ...value, kind }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {directionLabels[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>标题</Label>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm((value) => ({ ...value, title: event.target.value }))
                }
              />
            </div>
            <div>
              <Label>内容</Label>
              <Textarea
                className="min-h-40"
                value={form.content}
                onChange={(event) =>
                  setForm((value) => ({ ...value, content: event.target.value }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit">保存</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
