"use client";

import { useEffect, useMemo, useState } from "react";
import {
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { Edit3, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useRecords } from "@/hooks/use-records";
import { patchLocal, saveLocal } from "@/lib/local-db";
import { isoNow, newId } from "@/lib/utils";
import type {
  AccumulationEntry,
  DailyTask,
  ExerciseLog,
  MealLog,
  Plan,
  Review,
  ReviewType,
} from "@/types/domain";
import { useSync } from "@/components/sync-provider";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const reviewTypeLabels: Record<ReviewType, string> = {
  daily: "每日复盘",
  weekly: "每周复盘",
  monthly: "每月复盘",
  annual: "年度复盘",
};

const dailyFields = [
  ["done", "今天完成了什么"],
  ["six_summary", "六件事完成情况"],
  ["incomplete_reasons", "没完成的真实原因"],
  ["important_accumulation", "今日最重要的积累"],
  ["exercise", "运动情况"],
  ["meals", "饮食情况"],
  ["chaos", "今天最混乱的地方"],
  ["tomorrow_adjustment", "明天需要调整什么"],
  ["one_sentence", "一句话总结"],
] as const;

const periodFields = [
  ["plan_completion", "计划完成情况"],
  ["daily_trend", "每日六件事完成趋势"],
  ["repeated_delays", "反复延期事项"],
  ["accumulation_count", "真实积累"],
  ["continuity", "运动与饮食记录连续性"],
  ["main_problems", "主要问题"],
  ["next_focus", "下一周期重点"],
] as const;

function rangeFor(type: ReviewType, date = new Date()) {
  if (type === "daily") {
    const day = format(date, "yyyy-MM-dd");
    return { start: day, end: day };
  }
  if (type === "weekly") {
    return {
      start: format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      end: format(endOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  if (type === "monthly") {
    return {
      start: format(startOfMonth(date), "yyyy-MM-dd"),
      end: format(endOfMonth(date), "yyyy-MM-dd"),
    };
  }
  return {
    start: format(startOfYear(date), "yyyy-MM-dd"),
    end: format(endOfYear(date), "yyyy-MM-dd"),
  };
}

export function ReviewsView() {
  const { userId } = useSync();
  const reviews = useRecords<Review>("reviews", userId);
  const tasks = useRecords<DailyTask>("daily_tasks", userId);
  const plans = useRecords<Plan>("plans", userId);
  const accumulations = useRecords<AccumulationEntry>(
    "accumulation_entries",
    userId,
  );
  const exercises = useRecords<ExerciseLog>("exercise_logs", userId);
  const meals = useRecords<MealLog>("meal_logs", userId);
  const [type, setType] = useState<ReviewType>("daily");
  const defaultRange = rangeFor("daily");
  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);
  const [content, setContent] = useState<Record<string, string>>({});
  const [aiDraft, setAiDraft] = useState<Record<string, unknown> | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  const existing = reviews.find(
    (review) =>
      review.review_type === type &&
      review.period_start === start &&
      review.period_end === end,
  );

  useEffect(() => {
    queueMicrotask(() => {
      setContent(
        Object.fromEntries(
          Object.entries(existing?.content ?? {}).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join("\n") : String(value ?? ""),
          ]),
        ),
      );
      setAiDraft(existing?.ai_draft ?? null);
    });
  }, [existing]);

  function changeType(next: ReviewType) {
    setType(next);
    const range = rangeFor(next);
    setStart(range.start);
    setEnd(range.end);
    setContent({});
    setAiDraft(null);
  }

  const stats = useMemo(() => {
    const inRange = (date: string) => date >= start && date <= end;
    const periodTasks = tasks.filter((task) => inRange(task.entry_date));
    const plannedTasks = periodTasks.filter(
      (task) => task.title && task.status !== "not_scheduled",
    );
    const completedTasks = plannedTasks.filter(
      (task) => task.status === "completed",
    );
    const incompleteCounts = plannedTasks
      .filter((task) => task.status === "not_completed")
      .reduce<Record<string, number>>((counts, task) => {
        counts[task.title] = (counts[task.title] ?? 0) + 1;
        return counts;
      }, {});
    const periodPlans = plans.filter(
      (plan) => plan.period_start <= end && plan.period_end >= start,
    );
    const periodAccumulations = accumulations.filter((entry) =>
      inRange(entry.entry_date),
    );
    const exerciseDays = new Set(
      exercises
        .filter((log) => inRange(log.entry_date))
        .map((log) => log.entry_date),
    ).size;
    const mealDays = new Set(
      meals.filter((log) => inRange(log.entry_date)).map((log) => log.entry_date),
    ).size;
    return {
      periodTasks,
      periodPlans,
      periodAccumulations,
      plannedCount: plannedTasks.length,
      completedCount: completedTasks.length,
      completionRate: plannedTasks.length
        ? Math.round((completedTasks.length / plannedTasks.length) * 100)
        : 0,
      repeated: Object.entries(incompleteCounts)
        .filter(([, count]) => count > 1)
        .map(([title, count]) => `${title}（${count} 次）`),
      exerciseDays,
      mealDays,
    };
  }, [accumulations, end, exercises, meals, plans, start, tasks]);

  async function generateDraft() {
    setLoadingAi(true);
    try {
      const endpoint =
        type === "daily" ? "/api/ai/daily-review" : "/api/ai/period-review";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review_type: type,
          period_start: start,
          period_end: end,
          tasks: stats.periodTasks.map(
            ({
              entry_date,
              title,
              status,
              importance,
              completion_standard,
              result,
            }) => ({
              entry_date,
              title,
              status,
              importance,
              completion_standard,
              result,
            }),
          ),
          plans: stats.periodPlans.map(
            ({ title, plan_type, progress, status }) => ({
              title,
              plan_type,
              progress,
              status,
            }),
          ),
          accumulations: stats.periodAccumulations.map(
            ({ title, tags, reusable_conclusion }) => ({
              title,
              tags,
              reusable_conclusion,
            }),
          ),
          exercise: { recorded_days: stats.exerciseDays },
          meals: { recorded_days: stats.mealDays },
        }),
      });
      const result = (await response.json()) as {
        draft?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !result.draft) {
        throw new Error(result.error ?? "AI 暂时不可用");
      }
      setAiDraft(result.draft);
      setContent(
        Object.fromEntries(
          Object.entries(result.draft).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join("\n") : String(value ?? ""),
          ]),
        ),
      );
      toast.success("AI 草稿已生成，修改后再保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 暂时不可用");
    } finally {
      setLoadingAi(false);
    }
  }

  async function saveReview() {
    const now = isoNow();
    if (existing) {
      await patchLocal("reviews", existing, {
        content,
        ai_draft: aiDraft,
        saved_from_draft: Boolean(aiDraft),
      });
    } else {
      await saveLocal("reviews", {
        id: newId(),
        user_id: userId,
        review_type: type,
        period_start: start,
        period_end: end,
        content,
        ai_draft: aiDraft,
        saved_from_draft: Boolean(aiDraft),
        created_at: now,
        updated_at: now,
        version: 0,
      });
    }
    toast.success("复盘已保存");
  }

  const fields = type === "daily" ? dailyFields : periodFields;
  const history = reviews
    .filter((review) => review.review_type === type)
    .sort((a, b) => b.period_start.localeCompare(a.period_start));

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="执行 → 复盘 → 调整"
        title="复盘库"
        description="自动汇总只负责提供证据；结论必须经过你的修改和确认，才成为正式复盘。"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void generateDraft()}
              disabled={loadingAi}
            >
              <Sparkles />
              {loadingAi ? "生成中…" : "AI 生成草稿"}
            </Button>
            <Button onClick={() => void saveReview()}>
              <Save />
              保存复盘
            </Button>
          </>
        }
      />

      <Tabs value={type} onValueChange={(value) => changeType(value as ReviewType)}>
        <TabsList className="mb-5 flex w-full overflow-x-auto sm:w-auto">
          {(Object.keys(reviewTypeLabels) as ReviewType[]).map((value) => (
            <TabsTrigger key={value} value={value} className="shrink-0">
              {reviewTypeLabels[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <Label>{type === "daily" ? "日期" : "周期开始"}</Label>
          <Input
            type="date"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              if (type === "daily") setEnd(event.target.value);
            }}
          />
        </div>
        {type !== "daily" && (
          <div>
            <Label>周期结束</Label>
            <Input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
        )}
        {existing && (
          <Badge>
            <Edit3 className="mr-1 size-3" />
            正在编辑已保存复盘
          </Badge>
        )}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["六件事完成", `${stats.completedCount} / ${stats.plannedCount}`],
          ["完成率", `${stats.completionRate}%`],
          ["真实积累", `${stats.periodAccumulations.length} 条`],
          [
            "记录连续性",
            `运动 ${stats.exerciseDays} 天 · 饮食 ${stats.mealDays} 天`,
          ],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-[var(--muted)]">{label}</p>
              <p className="mt-2 font-serif text-xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {type !== "daily" && stats.repeated.length > 0 && (
        <Card className="mb-6 border-[var(--warm)]/30">
          <CardContent className="p-4">
            <p className="text-xs tracking-[0.14em] text-[var(--warm)]">
              反复未完成的事项
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {stats.repeated.map((item) => (
                <Badge key={item}>{item}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {aiDraft && (
        <div className="mb-4 rounded-xl border border-[var(--river)]/30 bg-[var(--accent-wash)] px-4 py-3 text-sm text-[var(--accent-deep)]">
          当前内容来自 AI 草稿。它尚未成为正式数据；请检查、修改，然后点击“保存复盘”。
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {reviewTypeLabels[type]} ·{" "}
            {format(parseISO(start), "M 月 d 日", { locale: zhCN })}
            {start !== end &&
              ` — ${format(parseISO(end), "M 月 d 日", { locale: zhCN })}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          {fields.map(([key, label], index) => (
            <div
              key={key}
              className={
                key === "one_sentence" || key === "next_focus"
                  ? "lg:col-span-2"
                  : ""
              }
            >
              <Label>
                {String(index + 1).padStart(2, "0")} · {label}
              </Label>
              <Textarea
                className="min-h-28"
                value={content[key] ?? ""}
                onChange={(event) =>
                  setContent((value) => ({
                    ...value,
                    [key]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-serif text-xl font-semibold">历史复盘</h2>
          <div className="space-y-2">
            {history.slice(0, 12).map((review) => (
              <button
                key={review.id}
                className="flex w-full items-center rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent)]"
                onClick={() => {
                  setStart(review.period_start);
                  setEnd(review.period_end);
                }}
              >
                <span className="font-medium">
                  {review.period_start}
                  {review.period_start !== review.period_end &&
                    ` — ${review.period_end}`}
                </span>
                <Badge className="ml-auto">
                  {review.saved_from_draft ? "AI 草稿后修改" : "手动复盘"}
                </Badge>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
