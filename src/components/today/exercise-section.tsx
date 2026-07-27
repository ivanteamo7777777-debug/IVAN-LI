"use client";

import { Dumbbell, Plus, Trash2 } from "lucide-react";
import type { ExerciseLog } from "@/types/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BufferedInput,
  BufferedTextarea,
} from "@/components/ui/buffered-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function ExerciseSection({
  values,
  onAdd,
  onPatch,
  onDelete,
}: {
  values: ExerciseLog[];
  onAdd: () => void;
  onPatch: (value: ExerciseLog, patch: Partial<ExerciseLog>) => void;
  onDelete: (value: ExerciseLog) => void;
}) {
  return (
    <Card id="exercise" data-testid="exercise-section">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[var(--river)]">
            <Dumbbell className="size-4" />
            <span className="text-xs tracking-[0.16em]">独立记录</span>
          </div>
          <CardTitle>每日运动</CardTitle>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onAdd}
          data-testid="add-exercise"
        >
          <Plus />
          新增运动
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {values.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--paper)] px-4 py-7 text-center">
            <p className="text-sm text-[var(--muted)]">
              今天还没有运动记录，可按实际情况添加一项或多项。
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={onAdd}
            >
              <Plus />
              添加第一项
            </Button>
          </div>
        )}

        {values.map((value, index) => (
          <section
            key={value.id}
            className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4"
            data-testid="exercise-log"
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs tracking-[0.14em] text-[var(--muted-light)]">
                  运动 {String(index + 1).padStart(2, "0")}
                </p>
                <p className="mt-1 truncate text-sm font-medium">
                  {value.activity || "尚未填写运动项目"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor={`exercise-planned-${value.id}`}
                  className="whitespace-nowrap text-xs text-[var(--muted)]"
                >
                  计划内
                </Label>
                <Switch
                  id={`exercise-planned-${value.id}`}
                  checked={value.planned}
                  onCheckedChange={(planned) => onPatch(value, { planned })}
                  aria-label={`运动 ${index + 1} 是否为计划运动`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-[var(--muted-light)] hover:text-red-700"
                  onClick={() => onDelete(value)}
                  aria-label={`删除运动 ${index + 1}`}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>运动项目</Label>
                <BufferedInput
                  value={value.activity}
                  placeholder="散步、跑步、力量训练……"
                  onCommit={(activity) => onPatch(value, { activity })}
                />
              </div>
              <div>
                <Label>计划时长（分钟）</Label>
                <BufferedInput
                  type="number"
                  min={0}
                  value={value.planned_minutes ?? ""}
                  onCommit={(next) =>
                    onPatch(value, {
                      planned_minutes: next ? Number(next) : null,
                    })
                  }
                />
              </div>
              <div>
                <Label>实际时长（分钟）</Label>
                <BufferedInput
                  type="number"
                  min={0}
                  value={value.actual_minutes ?? ""}
                  onCommit={(next) =>
                    onPatch(value, {
                      actual_minutes: next ? Number(next) : null,
                    })
                  }
                />
              </div>
              <div>
                <Label>强度</Label>
                <Select
                  value={value.intensity ?? "none"}
                  onValueChange={(intensity) =>
                    onPatch(value, {
                      intensity:
                        intensity === "none"
                          ? null
                          : (intensity as ExerciseLog["intensity"]),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未记录</SelectItem>
                    <SelectItem value="light">轻度</SelectItem>
                    <SelectItem value="moderate">中等</SelectItem>
                    <SelectItem value="high">高强度</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>完成状态</Label>
                <Select
                  value={value.status}
                  onValueChange={(status: ExerciseLog["status"]) =>
                    onPatch(value, { status })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_started">未开始</SelectItem>
                    <SelectItem value="completed">已完成</SelectItem>
                    <SelectItem value="skipped">未进行</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>身体感受</Label>
                <BufferedTextarea
                  value={value.body_feeling}
                  onCommit={(body_feeling) => onPatch(value, { body_feeling })}
                />
              </div>
              <div>
                <Label>备注</Label>
                <BufferedTextarea
                  value={value.notes}
                  onCommit={(notes) => onPatch(value, { notes })}
                />
              </div>
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
