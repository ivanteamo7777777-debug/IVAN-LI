"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { format, parseISO, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarDays, Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useRecords } from "@/hooks/use-records";
import { localDb, patchLocal, saveLocal } from "@/lib/local-db";
import { localDateKey, isoNow, newId, stableUuid } from "@/lib/utils";
import type {
  DailyTask,
  Direction,
  ExerciseLog,
  MealLog,
  MealType,
  Plan,
} from "@/types/domain";
import { useSync } from "@/components/sync-provider";
import { PageHeader } from "@/components/page-header";
import { TaskCard } from "@/components/today/task-card";
import { ExerciseSection } from "@/components/today/exercise-section";
import { MealSection } from "@/components/today/meal-section";
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
import { Textarea } from "@/components/ui/textarea";

const taskContentKeys: (keyof DailyTask)[] = [
  "title",
  "importance",
  "completion_standard",
  "first_action",
  "weekly_plan_id",
  "status",
  "result",
  "completed_at",
  "notes",
];

function emptyTask(userId: string, date: string, slot: number): DailyTask {
  const now = isoNow();
  return {
    id: stableUuid(`daily-task:${userId}:${date}:${slot}`),
    user_id: userId,
    entry_date: date,
    slot_index: slot,
    title: "",
    importance: "",
    completion_standard: "",
    first_action: "",
    weekly_plan_id: null,
    status: "not_started",
    result: "",
    completed_at: null,
    notes: "",
    created_at: now,
    updated_at: now,
    version: 0,
  };
}

function emptyExercise(userId: string, date: string): ExerciseLog {
  const now = isoNow();
  return {
    id: newId(),
    user_id: userId,
    entry_date: date,
    planned: false,
    activity: "",
    planned_minutes: null,
    actual_minutes: null,
    intensity: null,
    status: "not_started",
    body_feeling: "",
    notes: "",
    created_at: now,
    updated_at: now,
    version: 0,
  };
}

function emptyMeal(userId: string, date: string, type: MealType): MealLog {
  const now = isoNow();
  return {
    id: newId(),
    user_id: userId,
    entry_date: date,
    meal_type: type,
    content: "",
    photo_paths: [],
    hydration_ml: 0,
    overall_feeling: "",
    notes: "",
    created_at: now,
    updated_at: now,
    version: 0,
  };
}

interface AiSuggestion {
  title: string;
  importance: string;
  completion_standard: string;
  first_action: string;
  weekly_plan_id: string | null;
}

export function TodayView({ initialDate }: { initialDate?: string }) {
  const { userId, hydrated } = useSync();
  const [date, setDate] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(initialDate ?? "")
      ? initialDate!
      : localDateKey(),
  );
  const tasks = useRecords<DailyTask>("daily_tasks", userId);
  const plans = useRecords<Plan>("plans", userId);
  const directions = useRecords<Direction>("directions", userId);
  const exercises = useRecords<ExerciseLog>("exercise_logs", userId);
  const allMeals = useRecords<MealLog>("meal_logs", userId);
  const ensuredDates = useRef(new Set<string>());
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiSuggestion[]>([]);

  const todayTasks = useMemo(() => {
    const slots = new Map<number, DailyTask>();
    for (const task of tasks.filter((item) => item.entry_date === date)) {
      const current = slots.get(task.slot_index);
      if (!current || task.updated_at > current.updated_at) {
        slots.set(task.slot_index, task);
      }
    }
    return [...slots.values()].sort(
      (a, b) => a.slot_index - b.slot_index,
    );
  }, [date, tasks]);

  useEffect(() => {
    if (!hydrated) return;
    if (ensuredDates.current.has(date)) return;
    ensuredDates.current.add(date);
    void (async () => {
      const localRows = await localDb.records
        .where("[table+user_id]")
        .equals(["daily_tasks", userId])
        .toArray();
      const existingSlots = new Set(
        localRows
          .map((row) => row.data as DailyTask)
          .filter((task) => !task.deleted_at && task.entry_date === date)
          .map((task) => task.slot_index),
      );
      for (let slot = 1; slot <= 6; slot += 1) {
        if (!existingSlots.has(slot)) {
          await saveLocal("daily_tasks", emptyTask(userId, date, slot));
        }
      }
    })();
  }, [date, hydrated, tasks, userId]);

  const weeklyPlans = useMemo(
    () =>
      plans.filter(
        (plan) =>
          plan.plan_type === "weekly" &&
          !plan.archived_at &&
          plan.status !== "archived",
      ),
    [plans],
  );
  const plansById = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans],
  );
  const directionsById = useMemo(
    () => new Map(directions.map((direction) => [direction.id, direction])),
    [directions],
  );

  function planPath(weeklyPlanId: string | null) {
    if (!weeklyPlanId) return [];
    const path: string[] = [];
    let current = plansById.get(weeklyPlanId);
    let directionId: string | null = null;
    while (current) {
      path.unshift(current.title);
      directionId ||= current.direction_id;
      current = current.parent_id ? plansById.get(current.parent_id) : undefined;
    }
    const direction = directionId ? directionsById.get(directionId) : null;
    if (direction) path.unshift(direction.title);
    return path;
  }

  const yesterday = format(subDays(parseISO(date), 1), "yyyy-MM-dd");
  const yesterdayCandidates = tasks.filter(
    (task) =>
      task.entry_date === yesterday &&
      task.title &&
      !["completed", "not_scheduled"].includes(task.status),
  );

  const exercise =
    exercises.find((item) => item.entry_date === date) ??
    emptyExercise(userId, date);

  const meals = useMemo(() => {
    const result = {} as Record<MealType, MealLog>;
    (["breakfast", "lunch", "dinner", "snack"] as MealType[]).forEach((type) => {
      result[type] =
        allMeals.find(
          (meal) => meal.entry_date === date && meal.meal_type === type,
        ) ?? emptyMeal(userId, date, type);
    });
    return result;
  }, [allMeals, date, userId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = Number(String(event.active.id).replace("slot-", ""));
    const to = Number(String(event.over.id).replace("slot-", ""));
    const first = todayTasks.find((task) => task.slot_index === from);
    const second = todayTasks.find((task) => task.slot_index === to);
    if (!first || !second) return;
    const firstPatch: Partial<DailyTask> = {};
    const secondPatch: Partial<DailyTask> = {};
    for (const key of taskContentKeys) {
      firstPatch[key] = second[key] as never;
      secondPatch[key] = first[key] as never;
    }
    await patchLocal("daily_tasks", first, firstPatch);
    await patchLocal("daily_tasks", second, secondPatch);
  }

  async function copyCandidate(candidate: DailyTask) {
    const target = todayTasks.find(
      (task) => !task.title && task.status !== "not_scheduled",
    );
    if (!target) {
      toast.error("今天六个位置都已有内容，请先腾出一个位置");
      return;
    }
    await patchLocal("daily_tasks", target, {
      title: candidate.title,
      importance: candidate.importance,
      completion_standard: candidate.completion_standard,
      first_action: candidate.first_action,
      weekly_plan_id: candidate.weekly_plan_id,
      status: "not_started",
      result: "",
      completed_at: null,
      notes: candidate.notes,
    });
    toast.success(`已复制到第 ${target.slot_index} 个位置`);
  }

  async function requestAiDraft() {
    setAiLoading(true);
    try {
      const response = await fetch("/api/ai/daily-six", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          directions: directions.map(({ kind, title, content }) => ({
            kind,
            title,
            content,
          })),
          plans: plans
            .filter((plan) => plan.status === "active")
            .map(
              ({
                id,
                plan_type,
                title,
                objective,
                completion_standard,
                parent_id,
              }) => ({
                id,
                plan_type,
                title,
                objective,
                completion_standard,
                parent_id,
              }),
            ),
          existing: todayTasks
            .filter((task) => task.title)
            .map(({ slot_index, title }) => ({ slot_index, title })),
        }),
      });
      const result = (await response.json()) as {
        suggestions?: AiSuggestion[];
        error?: string;
      };
      if (!response.ok || !result.suggestions) {
        throw new Error(result.error ?? "AI 暂时不可用");
      }
      setAiDraft(result.suggestions);
      setAiOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 暂时不可用");
    } finally {
      setAiLoading(false);
    }
  }

  async function applyAiDraft() {
    const targets = todayTasks.filter(
      (task) => !task.title || task.status === "not_scheduled",
    );
    if (!targets.length) {
      toast.error("六个位置已有内容；AI 不会自动覆盖");
      return;
    }
    for (const [index, suggestion] of aiDraft.entries()) {
      const target = targets[index];
      if (!target) break;
      await patchLocal("daily_tasks", target, {
        ...suggestion,
        status: "not_started",
        result: "",
        completed_at: null,
      });
    }
    setAiOpen(false);
    toast.success("已按你的确认写入空余位置");
  }

  const completed = todayTasks.filter(
    (task) => task.status === "completed",
  ).length;

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={format(parseISO(date), "yyyy 年 M 月 d 日 EEEE", {
          locale: zhCN,
        })}
        title="今日执行"
        description="六个位置由你决定内容。运动与饮食独立记录，不占用任何位置。"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setCandidateOpen(true)}
              disabled={!yesterdayCandidates.length}
            >
              <Copy />
              <span className="hidden sm:inline">昨天候选</span>
            </Button>
            <Button
              data-testid="ai-suggest"
              variant="secondary"
              onClick={() => void requestAiDraft()}
              disabled={aiLoading}
            >
              <Sparkles />
              <span className="hidden sm:inline">
                {aiLoading ? "生成中…" : "AI 建议"}
              </span>
            </Button>
          </>
        }
      />

      <Card className="mb-6 overflow-hidden">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <CalendarDays className="size-4" />
            <span>查看日期</span>
          </div>
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-auto"
          />
          <div className="ml-auto flex items-center gap-2">
            <Badge>{completed} / 6 已完成</Badge>
            <span className="hidden text-xs text-[var(--muted-light)] sm:inline">
              不用追求填满，只记录真正重要的事
            </span>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="daily-six-heading">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="text-[11px] tracking-[0.18em] text-[var(--muted)]">
              A · DAILY SIX
            </p>
            <h2
              id="daily-six-heading"
              className="mt-1 font-serif text-2xl font-semibold"
            >
              每日六件事
            </h2>
          </div>
          <p className="text-xs text-[var(--muted)]">拖动可交换位置</p>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => void onDragEnd(event)}
        >
          <SortableContext
            items={todayTasks.map((task) => `slot-${task.slot_index}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {todayTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  weeklyPlans={weeklyPlans}
                  path={planPath(task.weekly_plan_id)}
                  onPatch={(patch) =>
                    void patchLocal("daily_tasks", task, patch)
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      <div className="mt-9 grid gap-6 xl:grid-cols-2">
        <ExerciseSection
          value={exercise}
          onPatch={(patch) => {
            if (exercises.some((item) => item.id === exercise.id)) {
              void patchLocal("exercise_logs", exercise, patch);
            } else {
              void saveLocal("exercise_logs", { ...exercise, ...patch });
            }
          }}
        />
        <MealSection
          userId={userId}
          date={date}
          meals={meals}
          onPatch={(type, patch) => {
            const meal = meals[type];
            if (allMeals.some((item) => item.id === meal.id)) {
              void patchLocal("meal_logs", meal, patch);
            } else {
              void saveLocal("meal_logs", { ...meal, ...patch });
            }
          }}
        />
      </div>

      <Dialog open={candidateOpen} onOpenChange={setCandidateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>昨天未完成的候选项</DialogTitle>
            <DialogDescription>
              只在你点击后复制到今天的空位，不会自动延期。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {yesterdayCandidates.length ? (
              yesterdayCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent)]"
                  onClick={() => void copyCandidate(candidate)}
                >
                  <p className="font-medium">{candidate.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    昨日第 {candidate.slot_index} 件 · 点击复制
                  </p>
                </button>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">昨天没有未完成事项。</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI 六件事建议草稿</DialogTitle>
            <DialogDescription>
              这是建议，不是事实。你可以修改后再确认；只会写入空余位置，不覆盖已有安排。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {aiDraft.map((suggestion, index) => (
              <div
                key={index}
                className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
              >
                <Label>建议 {index + 1}</Label>
                <Input
                  value={suggestion.title}
                  onChange={(event) =>
                    setAiDraft((draft) =>
                      draft.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Textarea
                    value={suggestion.completion_standard}
                    placeholder="完成标准"
                    onChange={(event) =>
                      setAiDraft((draft) =>
                        draft.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                completion_standard: event.target.value,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <Textarea
                    value={suggestion.first_action}
                    placeholder="第一步行动"
                    onChange={(event) =>
                      setAiDraft((draft) =>
                        draft.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, first_action: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAiOpen(false)}>
              暂不使用
            </Button>
            <Button onClick={() => void applyAiDraft()}>确认写入空位</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
