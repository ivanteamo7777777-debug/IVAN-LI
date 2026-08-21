"use client";

import { useRef, useState } from "react";
import { Copy, Dumbbell, Plus, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ExerciseSection({
  values,
  yesterdayValues,
  onAdd,
  onCarryForward,
  onPatch,
  onDelete,
}: {
  values: ExerciseLog[];
  yesterdayValues: ExerciseLog[];
  onAdd: () => void;
  onCarryForward: (values: ExerciseLog[]) => Promise<void>;
  onPatch: (value: ExerciseLog, patch: Partial<ExerciseLog>) => void;
  onDelete: (value: ExerciseLog) => void;
}) {
  const [carryOpen, setCarryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const allSelected =
    yesterdayValues.length > 0 &&
    yesterdayValues.every((value) => selectedIds.has(value.id));

  function setSelected(id: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openCarryDialog() {
    setSelectedIds(new Set());
    setCarryOpen(true);
  }

  async function carrySelected() {
    if (copyingRef.current) return;
    const selected = yesterdayValues.filter((value) =>
      selectedIds.has(value.id),
    );
    if (!selected.length) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      await onCarryForward(selected);
      setCarryOpen(false);
      setSelectedIds(new Set());
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  return (
    <>
      <Card id="exercise" data-testid="exercise-section">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[var(--river)]">
              <Dumbbell className="size-4" />
              <span className="text-xs tracking-[0.16em]">独立记录</span>
            </div>
            <CardTitle>每日运动</CardTitle>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openCarryDialog}
              disabled={!yesterdayValues.length}
              data-testid="carry-yesterday-exercise"
            >
              <Copy />
              从昨天选择
            </Button>
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
          </div>
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
                    className="size-8 text-[var(--muted-light)] hover:text-[var(--danger)]"
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
                    onCommit={(body_feeling) =>
                      onPatch(value, { body_feeling })
                    }
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

      <Dialog open={carryOpen} onOpenChange={setCarryOpen}>
        <DialogContent data-testid="exercise-carry-dialog">
          <DialogHeader>
            <DialogTitle>从昨天选择运动</DialogTitle>
            <DialogDescription>
              可多选带入。只复制运动项目、是否计划、计划时长和强度；今天的完成情况与感受会重新开始。
            </DialogDescription>
          </DialogHeader>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">
              已选择 {selectedIds.size} / {yesterdayValues.length}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setSelectedIds(
                  allSelected
                    ? new Set()
                    : new Set(yesterdayValues.map((value) => value.id)),
                )
              }
              data-testid="select-all-yesterday-exercise"
            >
              {allSelected ? "取消全选" : "全选"}
            </Button>
          </div>
          <div className="max-h-[48vh] space-y-2 overflow-y-auto">
            {yesterdayValues.map((value, index) => (
              <label
                key={value.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--accent)]"
                  checked={selectedIds.has(value.id)}
                  onChange={(event) =>
                    setSelected(value.id, event.target.checked)
                  }
                  aria-label={`选择昨天的运动 ${index + 1}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {value.activity || "未填写运动项目"}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {value.planned ? "计划运动" : "非计划运动"} · 计划
                    {value.planned_minutes ?? "未填"} 分钟 ·
                    {value.intensity === "light"
                      ? "轻度"
                      : value.intensity === "moderate"
                        ? "中等"
                        : value.intensity === "high"
                          ? "高强度"
                          : "未记录强度"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCarryOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!selectedIds.size || copying}
              onClick={() => void carrySelected()}
              data-testid="confirm-carry-exercise"
            >
              {copying ? "带入中…" : `带入 ${selectedIds.size} 项`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
