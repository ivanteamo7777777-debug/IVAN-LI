"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  GripVertical,
  Route,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyTask, TaskStatus } from "@/types/domain";
import { taskStatusLabels } from "@/types/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function TaskCard({
  task,
  weeklyPlans,
  path,
  onPatch,
}: {
  task: DailyTask;
  weeklyPlans: { id: string; title: string }[];
  path: string[];
  onPatch: (patch: Partial<DailyTask>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `slot-${task.slot_index}` });
  const completed = task.status === "completed";
  const skipped = task.status === "not_scheduled";

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-2xl border bg-[var(--surface)] transition-colors",
        completed
          ? "border-[var(--accent)] bg-[var(--accent-wash)]/45"
          : skipped
            ? "border-dashed border-[var(--line)] opacity-70"
            : "border-[var(--line)]",
        isDragging && "z-20 shadow-xl",
      )}
      data-testid={`daily-slot-${task.slot_index}`}
    >
      <div className="flex items-start gap-2 p-3 sm:gap-3 sm:p-4">
        <button
          type="button"
          aria-label={`拖动第 ${task.slot_index} 件事`}
          className="mt-2 cursor-grab touch-none rounded-lg p-1 text-[var(--muted-light)] hover:bg-[var(--paper)] active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          aria-label={completed ? "标记为未开始" : "标记为完成"}
          className={cn(
            "mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
            completed
              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
              : "border-[var(--line-strong)] bg-[var(--paper)] text-[var(--muted)]",
          )}
          onClick={() =>
            onPatch({
              status: completed ? "not_started" : "completed",
              completed_at: completed ? null : new Date().toISOString(),
            })
          }
        >
          {completed ? <Check className="size-4" /> : <Circle className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-serif text-xl font-semibold tabular-nums text-[var(--muted-light)]">
              {String(task.slot_index).padStart(2, "0")}
            </span>
            <Input
              value={task.title}
              placeholder={
                skipped ? "今天不安排" : "今天真正重要的是什么？"
              }
              className={cn(
                "h-9 border-0 bg-transparent px-0 text-base font-medium shadow-none focus:ring-0",
                completed && "line-through decoration-[var(--muted-light)]",
              )}
              onChange={(event) => onPatch({ title: event.target.value })}
              disabled={skipped}
            />
          </div>
          {path.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1.5 overflow-hidden text-[11px] text-[var(--river)]">
              <Route className="size-3 shrink-0" />
              <span className="truncate">{path.join(" → ")}</span>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label="展开任务详情"
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </div>

      {expanded && (
        <div className="grid gap-4 border-t border-[var(--line)] px-4 py-5 sm:grid-cols-2 sm:px-6">
          <div className="sm:col-span-2">
            <Label>关联本周重点</Label>
            <Select
              value={task.weekly_plan_id ?? "none"}
              onValueChange={(value) =>
                onPatch({ weekly_plan_id: value === "none" ? null : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="不关联" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">暂不关联</SelectItem>
                {weeklyPlans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>为什么重要</Label>
            <Textarea
              value={task.importance}
              placeholder="它和长期方向有什么关系？"
              onChange={(event) => onPatch({ importance: event.target.value })}
            />
          </div>
          <div>
            <Label>完成标准</Label>
            <Textarea
              value={task.completion_standard}
              placeholder="做到什么程度算完成？"
              onChange={(event) =>
                onPatch({ completion_standard: event.target.value })
              }
            />
          </div>
          <div>
            <Label>第一步行动</Label>
            <Textarea
              value={task.first_action}
              placeholder="现在就能做的最小动作"
              onChange={(event) => onPatch({ first_action: event.target.value })}
            />
          </div>
          <div>
            <Label>状态</Label>
            <Select
              value={task.status}
              onValueChange={(status: TaskStatus) =>
                onPatch({
                  status,
                  completed_at:
                    status === "completed" ? new Date().toISOString() : null,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(taskStatusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {skipped && (
              <Badge className="mt-2 border-dashed">此位置明确不使用</Badge>
            )}
          </div>
          <div>
            <Label>实际结果</Label>
            <Textarea
              value={task.result}
              placeholder="实际发生了什么？"
              onChange={(event) => onPatch({ result: event.target.value })}
            />
          </div>
          <div>
            <Label>备注</Label>
            <Textarea
              value={task.notes}
              onChange={(event) => onPatch({ notes: event.target.value })}
            />
          </div>
        </div>
      )}
    </article>
  );
}
