"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { format, isBefore, parseISO } from "date-fns";
import {
  Archive,
  CalendarClock,
  ChevronDown,
  Edit3,
  Plus,
  Route,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useRecords } from "@/hooks/use-records";
import { deleteLocal, patchLocal, saveLocal } from "@/lib/local-db";
import { isoNow, localDateKey, newId } from "@/lib/utils";
import {
  planStatusLabels,
  type DailyTask,
  type Direction,
  type Plan,
  type PlanStatus,
  type PlanType,
} from "@/types/domain";
import { useSync } from "@/components/sync-provider";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const planTypeLabels: Record<PlanType, string> = {
  annual: "年度计划",
  monthly: "月度计划",
  weekly: "每周计划",
};

const initialForm = {
  plan_type: "annual" as PlanType,
  title: "",
  objective: "",
  period_start: localDateKey(),
  period_end: localDateKey(),
  completion_standard: "",
  status: "draft" as PlanStatus,
  parent_id: null as string | null,
  direction_id: null as string | null,
  progress: 0,
  notes: "",
};

const subscribeToHydration = () => () => undefined;
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function PlansView() {
  const ready = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const { userId } = useSync();
  const plans = useRecords<Plan>("plans", userId);
  const directions = useRecords<Direction>("directions", userId);
  const tasks = useRecords<DailyTask>("daily_tasks", userId);
  const [view, setView] = useState("list");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);

  const planMap = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans],
  );
  const directionMap = useMemo(
    () => new Map(directions.map((item) => [item.id, item])),
    [directions],
  );
  const availableDirections = useMemo(
    () =>
      directions.filter(
        (direction) => !direction.deleted_at && !direction.archived_at,
      ),
    [directions],
  );

  function pathFor(plan: Plan) {
    const path = [plan.title];
    let current = plan.parent_id ? planMap.get(plan.parent_id) : undefined;
    let directionId = plan.direction_id;
    const visited = new Set([plan.id]);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current.title);
      directionId ||= current.direction_id;
      current = current.parent_id ? planMap.get(current.parent_id) : undefined;
    }
    const direction = directionId ? directionMap.get(directionId) : undefined;
    if (direction) path.unshift(direction.title);
    return path;
  }

  function descendants(planId: string): Plan[] {
    const result: Plan[] = [];
    const queue = [planId];
    while (queue.length) {
      const parentId = queue.shift()!;
      const children = plans.filter((plan) => plan.parent_id === parentId);
      result.push(...children);
      queue.push(...children.map((child) => child.id));
    }
    return result;
  }

  function tasksFor(plan: Plan) {
    const weeklyIds = new Set(
      [plan, ...descendants(plan.id)]
        .filter((item) => item.plan_type === "weekly")
        .map((item) => item.id),
    );
    return tasks.filter(
      (task) => task.weekly_plan_id && weeklyIds.has(task.weekly_plan_id),
    );
  }

  const filtered = plans
    .filter((plan) => !plan.deleted_at)
    .filter((plan) => statusFilter === "all" || plan.status === statusFilter)
    .filter((plan) => typeFilter === "all" || plan.plan_type === typeFilter)
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  function parentOptions(type: PlanType) {
    const expected = type === "monthly" ? "annual" : "monthly";
    return plans.filter(
      (plan) =>
        plan.plan_type === expected &&
        !plan.deleted_at &&
        !plan.archived_at &&
        plan.status !== "archived",
    );
  }

  function startCreate(type: PlanType = "annual") {
    setEditing(null);
    setForm({ ...initialForm, plan_type: type });
    setOpen(true);
  }

  function startEdit(plan: Plan) {
    setEditing(plan);
    setForm({
      plan_type: plan.plan_type,
      title: plan.title,
      objective: plan.objective,
      period_start: plan.period_start,
      period_end: plan.period_end,
      completion_standard: plan.completion_standard,
      status: plan.status,
      parent_id: plan.parent_id,
      direction_id: plan.direction_id,
      progress: plan.progress,
      notes: plan.notes,
    });
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title || !form.objective || !form.completion_standard) {
      toast.error("请填写标题、目标说明和完成标准");
      return;
    }
    if (form.period_end < form.period_start) {
      toast.error("结束日期不能早于开始日期");
      return;
    }
    const normalized = {
      ...form,
      parent_id: form.plan_type === "annual" ? null : form.parent_id,
      direction_id: form.plan_type === "annual" ? form.direction_id : null,
    };
    if (editing) {
      await patchLocal("plans", editing, normalized);
    } else {
      const now = isoNow();
      await saveLocal("plans", {
        id: newId(),
        user_id: userId,
        ...normalized,
        created_at: now,
        updated_at: now,
        version: 0,
      });
    }
    setOpen(false);
  }

  return (
    <div
      className="fade-in"
      data-ready={ready ? "true" : "false"}
      data-testid="plans-view"
    >
      <PageHeader
        eyebrow="年 → 月 → 周"
        title="计划库"
        description="计划可以独立存在，也可以按需要关联方向或上级计划。每天的六件事仍只直接连接本周重点。"
        actions={
          <Button onClick={() => startCreate()}>
            <Plus />
            新增计划
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="list">列表</TabsTrigger>
            <TabsTrigger value="timeline">时间视图</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部层级</SelectItem>
            <SelectItem value="annual">年度计划</SelectItem>
            <SelectItem value="monthly">月度计划</SelectItem>
            <SelectItem value="weekly">每周计划</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(planStatusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className={
          view === "timeline"
            ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            : "space-y-3"
        }
      >
        {filtered.map((plan) => {
          const relatedTasks = tasksFor(plan);
          const overdue =
            plan.status === "active" &&
            isBefore(parseISO(plan.period_end), parseISO(localDateKey()));
          return (
            <Card
              key={plan.id}
              className={plan.archived_at ? "opacity-55" : ""}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-wash)] text-[var(--accent-deep)] sm:flex">
                    <CalendarClock className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{planTypeLabels[plan.plan_type]}</Badge>
                      <Badge>{planStatusLabels[plan.status]}</Badge>
                      {overdue && (
                        <span className="text-xs text-[var(--warm)]">
                          已越过原定日期，可平静地重新判断
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 font-serif text-xl font-semibold">
                      {plan.title}
                    </h2>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--river)]">
                      <Route className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {pathFor(plan).join(" → ")}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                      {plan.objective}
                    </p>
                    <div className="mt-4">
                      <div className="mb-1.5 flex justify-between text-xs text-[var(--muted)]">
                        <span>
                          {format(parseISO(plan.period_start), "yyyy.MM.dd")} —{" "}
                          {format(parseISO(plan.period_end), "yyyy.MM.dd")}
                        </span>
                        <span>{plan.progress}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-strong)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${plan.progress}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Badge>{relatedTasks.length} 条每日任务</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpanded(expanded === plan.id ? null : plan.id)
                        }
                      >
                        查看执行
                        <ChevronDown />
                      </Button>
                      <div className="ml-auto flex">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() => startEdit(plan)}
                          aria-label="编辑"
                        >
                          <Edit3 />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() =>
                            void patchLocal("plans", plan, {
                              archived_at: plan.archived_at ? null : isoNow(),
                              status: plan.archived_at ? "draft" : "archived",
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
                            if (
                              window.confirm(
                                "将此计划移入回收站？下级计划和任务不会一并删除。",
                              )
                            ) {
                              void deleteLocal("plans", plan);
                            }
                          }}
                          aria-label="删除"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    {expanded === plan.id && (
                      <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4">
                        {relatedTasks.length ? (
                          relatedTasks.slice(0, 12).map((task) => (
                            <div
                              key={task.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <span className="text-xs tabular-nums text-[var(--muted-light)]">
                                {task.entry_date}
                              </span>
                              <span className="truncate">{task.title}</span>
                              <Badge className="ml-auto">
                                {task.slot_index}
                              </Badge>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-[var(--muted)]">
                            暂无关联的每日任务。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!filtered.length && (
        <Card>
          <CardContent className="p-10 text-center text-[var(--muted)]">
            还没有符合当前筛选条件的计划。
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑计划" : "新增计划"}</DialogTitle>
            <DialogDescription>
              上下级关系为可选；选择关联后，系统会继续校验计划层级。
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <div>
              <Label>计划层级</Label>
              <Select
                value={form.plan_type}
                disabled={Boolean(editing)}
                onValueChange={(plan_type: PlanType) =>
                  setForm((value) => ({
                    ...value,
                    plan_type,
                    parent_id: null,
                    direction_id: null,
                  }))
                }
              >
                <SelectTrigger data-testid="plan-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(planTypeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>当前状态</Label>
              <Select
                value={form.status}
                onValueChange={(status: PlanStatus) =>
                  setForm((value) => ({ ...value, status }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(planStatusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>标题</Label>
              <Input
                data-testid="plan-title-input"
                value={form.title}
                onChange={(event) =>
                  setForm((value) => ({ ...value, title: event.target.value }))
                }
              />
            </div>
            {form.plan_type === "annual" ? (
              <div className="sm:col-span-2">
                <Label>关联方向（可选）</Label>
                <Select
                  value={form.direction_id ?? "none"}
                  onValueChange={(value) =>
                    setForm((formValue) => ({
                      ...formValue,
                      direction_id: value === "none" ? null : value,
                    }))
                  }
                >
                  <SelectTrigger data-testid="plan-direction-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联方向</SelectItem>
                    {availableDirections.map((direction) => (
                      <SelectItem key={direction.id} value={direction.id}>
                        {direction.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="sm:col-span-2">
                <Label>上级计划（可选）</Label>
                <Select
                  value={form.parent_id ?? "none"}
                  onValueChange={(value) =>
                    setForm((formValue) => ({
                      ...formValue,
                      parent_id: value === "none" ? null : value,
                    }))
                  }
                >
                  <SelectTrigger data-testid="plan-parent-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联上级计划</SelectItem>
                    {parentOptions(form.plan_type).map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="sm:col-span-2">
              <Label>目标说明</Label>
              <Textarea
                data-testid="plan-objective-input"
                value={form.objective}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    objective: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>开始日期</Label>
              <Input
                type="date"
                value={form.period_start}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    period_start: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>结束日期</Label>
              <Input
                type="date"
                value={form.period_end}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    period_end: event.target.value,
                  }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label>完成标准</Label>
              <Textarea
                data-testid="plan-completion-input"
                value={form.completion_standard}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    completion_standard: event.target.value,
                  }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label>进度：{form.progress}%</Label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={form.progress}
                className="w-full accent-[var(--accent)]"
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    progress: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label>备注</Label>
              <Textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((value) => ({ ...value, notes: event.target.value }))
                }
              />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" data-testid="plan-save">
                保存
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
