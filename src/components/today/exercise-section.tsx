"use client";

import { Dumbbell } from "lucide-react";
import type { ExerciseLog } from "@/types/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BufferedInput,
  BufferedTextarea,
} from "@/components/ui/buffered-field";
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
  value,
  onPatch,
}: {
  value: ExerciseLog;
  onPatch: (patch: Partial<ExerciseLog>) => void;
}) {
  return (
    <Card data-testid="exercise-section">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[var(--river)]">
            <Dumbbell className="size-4" />
            <span className="text-xs tracking-[0.16em]">独立记录</span>
          </div>
          <CardTitle>每日运动</CardTitle>
        </div>
        <Switch
          checked={value.planned}
          onCheckedChange={(planned) => onPatch({ planned })}
          aria-label="今天是否计划运动"
        />
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>运动项目</Label>
          <BufferedInput
            value={value.activity}
            placeholder="散步、跑步、力量训练……"
            onCommit={(activity) => onPatch({ activity })}
          />
        </div>
        <div>
          <Label>计划时长（分钟）</Label>
          <BufferedInput
            type="number"
            min={0}
            value={value.planned_minutes ?? ""}
            onCommit={(next) =>
              onPatch({
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
              onPatch({
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
              onPatch({
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
              onPatch({ status })
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
            onCommit={(body_feeling) => onPatch({ body_feeling })}
          />
        </div>
        <div>
          <Label>备注</Label>
          <BufferedTextarea
            value={value.notes}
            onCommit={(notes) => onPatch({ notes })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
