"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import {
  deleteLocal,
  insertLocalIfAbsent,
  listRecords,
  localDb,
  patchLocal,
  saveDailyTaskSuggestionIfEmpty,
  saveLocal,
  saveMealContentIfEmpty,
  storeRemote,
  waitForLocalWrites,
} from "@/lib/local-db";
import { localDateKey, isoNow, newId, stableUuid } from "@/lib/utils";
import type {
  DailyTask,
  DailyEntry,
  DailySixDraft,
  DailySixDraftSuggestion,
  Direction,
  ExerciseLog,
  MealLog,
  MealType,
  Plan,
  ReminderSetting,
  Review,
} from "@/types/domain";
import { useSync } from "@/components/sync-provider";
import { PageHeader } from "@/components/page-header";
import { TaskCard } from "@/components/today/task-card";
import { ExerciseSection } from "@/components/today/exercise-section";
import { MealSection } from "@/components/today/meal-section";
import {
  carryExerciseFromYesterday,
  carryMealFromYesterday,
  dedupeDailySixSuggestions,
} from "@/components/today/carry-forward";
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

type AiSuggestion = DailySixDraftSuggestion;

interface AutoDraftResponse {
  status: "ok" | "unavailable" | "error";
  outcome:
    | "created"
    | "existing"
    | "skipped"
    | "unavailable"
    | "failed"
    | "applied"
    | "conflict";
  entry?: DailyEntry;
  draft?: DailySixDraft;
  reason?: string;
  error?: string;
}

export function TodayView() {
  const { userId, localOnly, online, flushNow } = useSync();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const [date, setDate] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "")
      ? requestedDate!
      : localDateKey(),
  );
  const tasks = useRecords<DailyTask>("daily_tasks", userId);
  const plans = useRecords<Plan>("plans", userId);
  const directions = useRecords<Direction>("directions", userId);
  const exercises = useRecords<ExerciseLog>("exercise_logs", userId);
  const allMeals = useRecords<MealLog>("meal_logs", userId);
  const dailyEntries = useRecords<DailyEntry>("daily_entries", userId);
  const reminderSettings = useRecords<ReminderSetting>(
    "reminder_settings",
    userId,
  );
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [autoAiLoading, setAutoAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiSuggestion[]>([]);
  const [aiDraftEntry, setAiDraftEntry] = useState<DailyEntry | null>(null);
  const [selectedAiIndices, setSelectedAiIndices] = useState<Set<number>>(
    new Set(),
  );
  const autoDraftRequests = useRef(new Set<string>());
  const exerciseCarryInFlight = useRef(false);
  const mealCarryInFlight = useRef(false);

  const todayTasks = useMemo(() => {
    // Structural slots are an in-memory shell until the user edits them. This
    // keeps Today usable immediately from IndexedDB without writing six empty
    // records before a new device has finished its background cloud refresh.
    const slots = new Map<number, DailyTask>(
      Array.from({ length: 6 }, (_, index) => {
        const slot = index + 1;
        return [slot, emptyTask(userId, date, slot)];
      }),
    );
    const realSlots = new Set<number>();
    for (const task of tasks.filter((item) => item.entry_date === date)) {
      const current = slots.get(task.slot_index);
      if (
        !realSlots.has(task.slot_index) ||
        !current ||
        task.updated_at > current.updated_at
      ) {
        slots.set(task.slot_index, task);
      }
      realSlots.add(task.slot_index);
    }
    return [...slots.values()].sort((a, b) => a.slot_index - b.slot_index);
  }, [date, tasks, userId]);

  const currentDailyEntry = useMemo(
    () =>
      dailyEntries
        .filter((entry) => entry.entry_date === date)
        .sort(
          (left, right) =>
            right.updated_at.localeCompare(left.updated_at) ||
            right.id.localeCompare(left.id),
        )[0] ?? null,
    [dailyEntries, date],
  );
  const readyAutoDraftEntry =
    currentDailyEntry?.daily_six_ai_draft_status === "ready" &&
    currentDailyEntry.daily_six_ai_draft
      ? currentDailyEntry
      : null;
  const autoDraftSetting = reminderSettings[0] ?? null;

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
      current = current.parent_id
        ? plansById.get(current.parent_id)
        : undefined;
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

  const todayExercises = useMemo(
    () =>
      exercises
        .filter((item) => item.entry_date === date)
        .sort(
          (left, right) =>
            left.created_at.localeCompare(right.created_at) ||
            left.id.localeCompare(right.id),
        ),
    [date, exercises],
  );

  const yesterdayExercises = useMemo(
    () =>
      exercises
        .filter((item) => item.entry_date === yesterday)
        .sort(
          (left, right) =>
            left.created_at.localeCompare(right.created_at) ||
            left.id.localeCompare(right.id),
        ),
    [exercises, yesterday],
  );

  const yesterdayMeals = useMemo(() => {
    const result: Partial<Record<MealType, MealLog>> = {};
    for (const meal of allMeals.filter(
      (item) => item.entry_date === yesterday,
    )) {
      const current = result[meal.meal_type];
      if (!current || current.updated_at < meal.updated_at) {
        result[meal.meal_type] = meal;
      }
    }
    return result;
  }, [allMeals, yesterday]);

  const meals = useMemo(() => {
    const result = {} as Record<MealType, MealLog>;
    (["breakfast", "lunch", "dinner", "snack"] as MealType[]).forEach(
      (type) => {
        result[type] =
          allMeals.find(
            (meal) => meal.entry_date === date && meal.meal_type === type,
          ) ?? emptyMeal(userId, date, type);
      },
    );
    return result;
  }, [allMeals, date, userId]);

  function openAiDraft(
    suggestions: AiSuggestion[],
    entry: DailyEntry | null = null,
  ) {
    setAiDraft(suggestions);
    setAiDraftEntry(entry);
    setSelectedAiIndices(
      new Set(suggestions.map((_, suggestionIndex) => suggestionIndex)),
    );
    setAiOpen(true);
  }

  useEffect(() => {
    if (
      !online ||
      date !== localDateKey() ||
      !autoDraftSetting?.daily_six_auto_draft_enabled ||
      autoDraftSetting.daily_six_auto_draft_mode !== "first_open" ||
      currentDailyEntry?.daily_six_ai_draft ||
      currentDailyEntry?.daily_six_ai_draft_status === "applied"
    ) {
      return;
    }

    const requestKey = `${userId}:${date}:first_open`;
    if (autoDraftRequests.current.has(requestKey)) return;
    autoDraftRequests.current.add(requestKey);
    let active = true;
    setAutoAiLoading(true);

    void (async () => {
      try {
        // Flush recent local plan/setting edits before the server builds the
        // compact prompt. UI remains available while this runs in background.
        await flushNow();
        const response = await fetch("/api/ai/daily-six/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date }),
        });
        const result = (await response.json()) as AutoDraftResponse;
        if (!response.ok || result.status === "error") {
          throw new Error(result.error ?? "AI 自动草稿暂时不可用");
        }
        if (result.entry?.daily_six_ai_draft) {
          await storeRemote("daily_entries", result.entry);
          if (active && result.outcome === "created") {
            toast.success("今天的 AI 六件事草稿已准备好，可查看后确认");
          }
          return;
        }
        if (active && result.status === "unavailable") {
          toast("未配置 OpenAI，自动草稿暂未生成；其他功能不受影响");
        }
      } catch {
        if (active) {
          toast.error("AI 自动草稿暂未生成；今天的记录仍可正常使用");
        }
      } finally {
        setAutoAiLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [
    autoDraftSetting?.daily_six_auto_draft_enabled,
    autoDraftSetting?.daily_six_auto_draft_mode,
    currentDailyEntry?.daily_six_ai_draft,
    currentDailyEntry?.daily_six_ai_draft_status,
    date,
    online,
    flushNow,
    userId,
  ]);

  async function carryYesterdayExercises(selected: ExerciseLog[]) {
    if (exerciseCarryInFlight.current) return;
    exerciseCarryInFlight.current = true;
    try {
      const selectedIds = new Set(selected.map((value) => value.id));
      const latestRows = await localDb.records
        .where("[table+user_id]")
        .equals(["exercise_logs", userId])
        .toArray();
      const latestById = new Map(
        latestRows
          .map((row) => row.data as ExerciseLog)
          .filter(
            (value) =>
              !value.deleted_at &&
              value.entry_date === yesterday &&
              selectedIds.has(value.id),
          )
          .map((value) => [value.id, value]),
      );
      let copied = 0;
      let alreadyCarried = 0;
      for (const selectedValue of selected) {
        const source = latestById.get(selectedValue.id);
        if (!source) continue;
        const carried = carryExerciseFromYesterday(source, { userId, date });
        const result = await insertLocalIfAbsent("exercise_logs", carried);
        if (!result.applied) {
          alreadyCarried += 1;
          continue;
        }
        copied += 1;
      }
      if (copied) toast.success(`已从昨天带入 ${copied} 项运动`);
      if (alreadyCarried) toast(`其中 ${alreadyCarried} 项今天已经带入过`);
      if (!copied && !alreadyCarried) {
        toast.error("所选的昨天运动已发生变化，请重新选择");
      }
    } catch {
      toast.error("运动带入未完成，本地已有记录不会丢失，可稍后重试");
    } finally {
      exerciseCarryInFlight.current = false;
    }
  }

  async function carryYesterdayMeals(types: MealType[]) {
    if (mealCarryInFlight.current) return;
    mealCarryInFlight.current = true;
    try {
      const latestRows = await localDb.records
        .where("[table+user_id]")
        .equals(["meal_logs", userId])
        .toArray();
      const latestMeals: Partial<Record<string, MealLog>> = {};
      for (const row of latestRows) {
        const meal = row.data as MealLog;
        if (meal.deleted_at) continue;
        const key = `${meal.entry_date}:${meal.meal_type}`;
        const current = latestMeals[key];
        if (!current || current.updated_at < meal.updated_at) {
          latestMeals[key] = meal;
        }
      }

      let copied = 0;
      let refused = 0;
      for (const type of types) {
        const source = latestMeals[`${yesterday}:${type}`];
        if (!source?.content.trim()) continue;
        const result = await saveMealContentIfEmpty(
          carryMealFromYesterday(source, { userId, date }),
        );
        if (!result.applied) {
          refused += 1;
          continue;
        }
        copied += 1;
      }
      if (copied) toast.success(`已从昨天带入 ${copied} 项饮食文字`);
      if (refused) {
        toast.error(
          `${refused} 项今天已有文字或刚刚发生变化，已跳过且没有覆盖`,
        );
      }
    } catch {
      toast.error("饮食带入未完成，今天已有内容不会被静默覆盖");
    } finally {
      mealCarryInFlight.current = false;
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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
      const reviews = await listRecords<Review>("reviews", userId);
      const recentReview = reviews
        .filter(
          (review) =>
            review.review_type === "daily" && review.period_end < date,
        )
        .sort((left, right) =>
          right.period_end.localeCompare(left.period_end),
        )[0];
      const recentAdjustment = recentReview?.content.tomorrow_adjustment;
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
          yesterday_incomplete: yesterdayCandidates.map(
            ({ title, importance, completion_standard }) => ({
              title,
              importance,
              completion_standard,
            }),
          ),
          ...(typeof recentAdjustment === "string" && recentAdjustment.trim()
            ? { recent_adjustment: recentAdjustment }
            : {}),
        }),
      });
      const result = (await response.json()) as {
        suggestions?: AiSuggestion[];
        error?: string;
      };
      if (!response.ok || !result.suggestions) {
        throw new Error(result.error ?? "AI 暂时不可用");
      }
      openAiDraft(result.suggestions);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 暂时不可用");
    } finally {
      setAiLoading(false);
    }
  }

  function handleAiButton() {
    if (readyAutoDraftEntry?.daily_six_ai_draft) {
      openAiDraft(
        readyAutoDraftEntry.daily_six_ai_draft.suggestions,
        readyAutoDraftEntry,
      );
      return;
    }
    void requestAiDraft();
  }

  async function applyAiDraft() {
    if (aiApplying) return;
    const selectedSuggestions = dedupeDailySixSuggestions(
      aiDraft.filter(
        (suggestion, index) =>
          selectedAiIndices.has(index) && suggestion.title.trim(),
      ),
    );
    if (!selectedSuggestions.length) {
      toast.error("请至少选择一条有标题的建议");
      return;
    }

    setAiApplying(true);
    try {
      await waitForLocalWrites();
      const [latestTasks, latestEntries] = await Promise.all([
        listRecords<DailyTask>("daily_tasks", userId),
        aiDraftEntry
          ? listRecords<DailyEntry>("daily_entries", userId)
          : Promise.resolve([]),
      ]);
      const currentDraftEntry = aiDraftEntry
        ? (latestEntries.find((entry) => entry.id === aiDraftEntry.id) ??
          latestEntries.find((entry) => entry.entry_date === date) ??
          null)
        : null;
      if (
        aiDraftEntry &&
        (!currentDraftEntry ||
          currentDraftEntry.daily_six_ai_draft_status !== "ready" ||
          currentDraftEntry.version !== aiDraftEntry.version)
      ) {
        toast.error("AI 草稿已变化，请重新打开后再确认");
        return;
      }

      const currentBySlot = new Map<number, DailyTask>();
      for (const task of latestTasks.filter(
        (candidate) => candidate.entry_date === date,
      )) {
        const existing = currentBySlot.get(task.slot_index);
        if (!existing || existing.updated_at < task.updated_at) {
          currentBySlot.set(task.slot_index, task);
        }
      }
      const currentDateTasks = [...currentBySlot.values()];
      const suggestionKey = (suggestion: AiSuggestion) =>
        suggestion.title.trim().toLocaleLowerCase();
      const confirmedTaskIds = new Set<string>();
      const resolvedSuggestionKeys = new Set<string>();
      for (const suggestion of selectedSuggestions) {
        const existingTask = currentDateTasks.find(
          (task) =>
            task.title.trim() === suggestion.title.trim() &&
            task.completion_standard.trim() ===
              suggestion.completion_standard.trim() &&
            task.first_action.trim() === suggestion.first_action.trim(),
        );
        if (!existingTask) continue;
        confirmedTaskIds.add(existingTask.id);
        resolvedSuggestionKeys.add(suggestionKey(suggestion));
      }
      const suggestionsToWrite = selectedSuggestions.filter(
        (suggestion) => !resolvedSuggestionKeys.has(suggestionKey(suggestion)),
      );
      const targets = Array.from({ length: 6 }, (_, index) => {
        const slot = index + 1;
        return currentBySlot.get(slot) ?? emptyTask(userId, date, slot);
      }).filter(
        (task) => !task.title.trim() && task.status !== "not_scheduled",
      );
      if (!targets.length && suggestionsToWrite.length) {
        toast.error("六个位置已有内容或明确标记不安排；AI 不会覆盖");
        return;
      }

      let written = 0;
      let targetIndex = 0;
      suggestionLoop: for (const suggestion of suggestionsToWrite) {
        while (targetIndex < targets.length) {
          const target = targets[targetIndex];
          targetIndex += 1;
          const result = await saveDailyTaskSuggestionIfEmpty(target, {
            ...suggestion,
            weekly_plan_id:
              suggestion.weekly_plan_id &&
              weeklyPlans.some((plan) => plan.id === suggestion.weekly_plan_id)
                ? suggestion.weekly_plan_id
                : null,
            status: "not_started",
            result: "",
            completed_at: null,
          });
          if (result.applied) {
            written += 1;
            if (result.record) confirmedTaskIds.add(result.record.id);
            resolvedSuggestionKeys.add(suggestionKey(suggestion));
            continue suggestionLoop;
          }
          if (result.reason === "duplicate") {
            if (result.record) confirmedTaskIds.add(result.record.id);
            resolvedSuggestionKeys.add(suggestionKey(suggestion));
            continue suggestionLoop;
          }
        }
        break;
      }
      await waitForLocalWrites();

      const unresolvedCount = selectedSuggestions.filter(
        (suggestion) => !resolvedSuggestionKeys.has(suggestionKey(suggestion)),
      ).length;
      if (!confirmedTaskIds.size && suggestionsToWrite.length) {
        toast.error("空位刚刚发生了变化，AI 没有覆盖你的新输入，请重新确认");
        return;
      }

      let markerMessage: string | null =
        unresolvedCount > 0
          ? `${unresolvedCount} 条所选建议因空位不足尚未写入；AI 草稿会继续保留`
          : null;
      if (currentDraftEntry) {
        let tasksReadyForMarker = unresolvedCount === 0 && localOnly;
        if (unresolvedCount === 0 && !tasksReadyForMarker && online) {
          try {
            await flushNow();
          } catch {
            // The status check below is authoritative; failed rows stay local.
          }
          const taskRows = await localDb.records.bulkGet(
            [...confirmedTaskIds].map((id) => `daily_tasks:${id}`),
          );
          tasksReadyForMarker = taskRows.every(
            (row) => row?.sync_status === "synced",
          );
        }

        if (unresolvedCount > 0) {
          // A partially resolved draft remains ready so the user can make room
          // and explicitly confirm the remaining suggestions later.
        } else if (!tasksReadyForMarker) {
          markerMessage = online
            ? "部分任务仍在等待同步或需要处理冲突；AI 草稿暂不标记为已应用"
            : "任务已保存在本机；联网同步完成后可再次打开草稿确认状态";
        } else {
          try {
            const response = await fetch("/api/ai/daily-six/auto", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                date,
                expected_version: currentDraftEntry.version,
              }),
            });
            const result = (await response.json()) as AutoDraftResponse;
            if (response.status === 409 || result.outcome === "conflict") {
              if (result.entry) {
                await storeRemote("daily_entries", result.entry);
              }
              markerMessage =
                result.error ?? "AI 草稿版本已变化，请重新打开后确认";
            } else if (!response.ok || result.outcome !== "applied") {
              if (result.entry) {
                await storeRemote("daily_entries", result.entry);
              }
              markerMessage = result.error ?? "草稿状态暂未同步";
            } else if (result.entry) {
              await storeRemote("daily_entries", result.entry);
            }
          } catch {
            markerMessage =
              "任务已安全保存；网络恢复后请再次打开草稿完成状态确认";
          }
        }
      }

      if (unresolvedCount > 0) {
        const unresolvedKeys = new Set(
          selectedSuggestions
            .filter(
              (suggestion) =>
                !resolvedSuggestionKeys.has(suggestionKey(suggestion)),
            )
            .map(suggestionKey),
        );
        setSelectedAiIndices(
          new Set(
            aiDraft.flatMap((suggestion, index) =>
              unresolvedKeys.has(suggestionKey(suggestion)) ? [index] : [],
            ),
          ),
        );
      } else {
        setAiOpen(false);
        setAiDraftEntry(null);
      }
      if (written) {
        toast.success(`已按你的确认写入 ${written} 个空余位置`);
      } else {
        toast("所选建议已经存在，没有重复写入");
      }
      if (markerMessage) toast(markerMessage);
    } catch {
      toast.error("AI 建议写入未完成；已有输入仍保存在本机");
    } finally {
      setAiApplying(false);
    }
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
              onClick={handleAiButton}
              disabled={aiLoading || autoAiLoading}
            >
              <Sparkles />
              <span className="hidden sm:inline">
                {aiLoading || autoAiLoading
                  ? "准备草稿中…"
                  : readyAutoDraftEntry
                    ? "查看 AI 草稿"
                    : "AI 建议"}
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
          values={todayExercises}
          yesterdayValues={yesterdayExercises}
          onAdd={() =>
            void saveLocal("exercise_logs", emptyExercise(userId, date))
          }
          onCarryForward={carryYesterdayExercises}
          onPatch={(exercise, patch) =>
            void patchLocal("exercise_logs", exercise, patch)
          }
          onDelete={(exercise) =>
            void (async () => {
              await deleteLocal("exercise_logs", exercise);
              toast("运动记录已移到回收状态", {
                action: {
                  label: "撤销",
                  onClick: () =>
                    void patchLocal("exercise_logs", exercise, {
                      deleted_at: null,
                    }),
                },
              });
            })()
          }
        />
        <MealSection
          userId={userId}
          date={date}
          meals={meals}
          yesterdayMeals={yesterdayMeals}
          onCarryForward={carryYesterdayMeals}
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
              <p className="text-sm text-[var(--muted)]">
                昨天没有未完成事项。
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-2xl" data-testid="ai-draft-dialog">
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
                className={`rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 ${
                  selectedAiIndices.has(index) ? "" : "opacity-60"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      checked={selectedAiIndices.has(index)}
                      onChange={(event) =>
                        setSelectedAiIndices((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(index);
                          else next.delete(index);
                          return next;
                        })
                      }
                      aria-label={`使用 AI 建议 ${index + 1}`}
                    />
                    建议 {index + 1}
                  </label>
                  {suggestion.weekly_plan_id && (
                    <span className="truncate text-xs text-[var(--muted)]">
                      {plansById.get(suggestion.weekly_plan_id)?.title ??
                        "未关联计划"}
                    </span>
                  )}
                </div>
                <Label>任务标题</Label>
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
                <Textarea
                  className="mt-3"
                  value={suggestion.importance}
                  placeholder="为什么重要"
                  onChange={(event) =>
                    setAiDraft((draft) =>
                      draft.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, importance: event.target.value }
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
            <Button
              onClick={() => void applyAiDraft()}
              disabled={aiApplying || selectedAiIndices.size === 0}
            >
              {aiApplying
                ? "写入中…"
                : `确认写入空位（所选 ${selectedAiIndices.size} 项）`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
