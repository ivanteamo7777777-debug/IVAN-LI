"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, Copy, Droplets, ImageIcon, Utensils } from "lucide-react";
import { toast } from "sonner";
import { localDb } from "@/lib/local-db";
import { queueFileUpload } from "@/lib/sync-engine";
import { newId } from "@/lib/utils";
import type { MealLog, MealType } from "@/types/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BufferedInput,
  BufferedTextarea,
} from "@/components/ui/buffered-field";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const mealLabels: Record<MealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

function MealPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    void localDb.files
      .filter((file) => file.path === path)
      .first()
      .then((file) => {
        if (file) {
          objectUrl = URL.createObjectURL(file.blob);
          setUrl(objectUrl);
        }
      });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)]">
      {url ? (
        <Image
          src={url}
          alt="饮食记录图片"
          fill
          unoptimized
          className="object-cover"
        />
      ) : (
        <ImageIcon className="size-5 text-[var(--muted-light)]" />
      )}
    </div>
  );
}

export function MealSection({
  userId,
  date,
  meals,
  yesterdayMeals,
  onPatch,
  onCarryForward,
}: {
  userId: string;
  date: string;
  meals: Record<MealType, MealLog>;
  yesterdayMeals: Partial<Record<MealType, MealLog>>;
  onPatch: (type: MealType, patch: Partial<MealLog>) => void;
  onCarryForward: (types: MealType[]) => Promise<void>;
}) {
  const [carryOpen, setCarryOpen] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<MealType>>(new Set());
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const mealTypes = Object.keys(mealLabels) as MealType[];
  const availableTypes = mealTypes.filter(
    (type) =>
      Boolean(yesterdayMeals[type]?.content.trim()) &&
      !meals[type].content.trim(),
  );
  const allSelected =
    availableTypes.length > 0 &&
    availableTypes.every((type) => selectedTypes.has(type));
  const hasUnavailableSelection = [...selectedTypes].some(
    (type) => !availableTypes.includes(type),
  );

  function setSelected(type: MealType, selected: boolean) {
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (selected) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  function openCarryDialog() {
    setSelectedTypes(new Set());
    setCarryOpen(true);
  }

  async function carrySelected() {
    if (copyingRef.current || !selectedTypes.size || hasUnavailableSelection) {
      return;
    }
    copyingRef.current = true;
    setCopying(true);
    try {
      await onCarryForward(mealTypes.filter((type) => selectedTypes.has(type)));
      setCarryOpen(false);
      setSelectedTypes(new Set());
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  async function addPhoto(type: MealType, file: File) {
    const extension =
      file.name
        .split(".")
        .pop()
        ?.replace(/[^a-z0-9]/gi, "") || "jpg";
    const path = `${userId}/${date}/${newId()}.${extension.toLowerCase()}`;
    await queueFileUpload({
      userId,
      bucket: "meal-photos",
      path,
      blob: file,
    });
    onPatch(type, {
      photo_paths: [...meals[type].photo_paths, path],
    });
    toast.success("图片已安全保存到本机队列");
  }

  return (
    <>
      <Card data-testid="meal-section">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[var(--river)]">
              <Utensils className="size-4" />
              <span className="text-xs tracking-[0.16em]">独立记录</span>
            </div>
            <CardTitle>每日饮食</CardTitle>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openCarryDialog}
            disabled={!availableTypes.length}
            data-testid="carry-yesterday-meal"
          >
            <Copy />
            从昨天选择
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {mealTypes.map((type) => {
              const meal = meals[type];
              return (
                <div
                  key={type}
                  className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-serif font-semibold">
                      {mealLabels[type]}
                    </h3>
                    <label>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void addPhoto(type, file);
                          event.currentTarget.value = "";
                        }}
                      />
                      <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-strong)]">
                        <Camera className="size-3.5" />
                        图片
                      </span>
                    </label>
                  </div>
                  <BufferedTextarea
                    value={meal.content}
                    placeholder={`记录${mealLabels[type]}，不做卡路里诊断`}
                    className="min-h-20"
                    onCommit={(content) => onPatch(type, { content })}
                  />
                  {meal.photo_paths.length > 0 && (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {meal.photo_paths.map((path) => (
                        <MealPhoto key={path} path={path} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 sm:grid-cols-3">
            <div>
              <Label className="flex items-center gap-1.5">
                <Droplets className="size-3.5 text-[var(--river)]" />
                当日饮水（毫升）
              </Label>
              <BufferedInput
                type="number"
                min={0}
                step={100}
                value={meals.snack.hydration_ml || ""}
                onCommit={(next) =>
                  onPatch("snack", {
                    hydration_ml: Number(next || 0),
                  })
                }
              />
            </div>
            <div>
              <Label>当日整体感受</Label>
              <BufferedInput
                value={meals.snack.overall_feeling}
                placeholder="舒适、匆忙、规律……"
                onCommit={(overall_feeling) =>
                  onPatch("snack", { overall_feeling })
                }
              />
            </div>
            <div>
              <Label>饮食备注</Label>
              <BufferedInput
                value={meals.snack.notes}
                onCommit={(notes) => onPatch("snack", { notes })}
              />
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted-light)]">
            图片在离线时先保存在此设备，联网后自动上传到按账号隔离的私有 Storage
            路径。
          </p>
        </CardContent>
      </Card>

      <Dialog open={carryOpen} onOpenChange={setCarryOpen}>
        <DialogContent data-testid="meal-carry-dialog">
          <DialogHeader>
            <DialogTitle>从昨天选择饮食</DialogTitle>
            <DialogDescription>
              只复制文字内容，不复制图片、饮水、整体感受或备注。今天已有文字的餐次不会被覆盖。
            </DialogDescription>
          </DialogHeader>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">
              已选择 {selectedTypes.size} / {availableTypes.length}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedTypes(
                  allSelected ? new Set() : new Set(availableTypes),
                );
              }}
              disabled={!availableTypes.length}
              data-testid="select-all-yesterday-meals"
            >
              {allSelected ? "取消全选" : "全选有记录的餐次"}
            </Button>
          </div>
          <div className="space-y-2">
            {mealTypes.map((type) => {
              const source = yesterdayMeals[type];
              const hasYesterdayContent = Boolean(source?.content.trim());
              const hasTodayContent = Boolean(meals[type].content.trim());
              const available = hasYesterdayContent && !hasTodayContent;
              const selected = selectedTypes.has(type);
              return (
                <div
                  key={type}
                  className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
                  data-testid={`yesterday-meal-${type}`}
                >
                  <label
                    className={
                      available
                        ? "flex cursor-pointer items-start gap-3"
                        : "flex cursor-not-allowed items-start gap-3 opacity-55"
                    }
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-[var(--accent)]"
                      disabled={!available}
                      checked={selected}
                      onChange={(event) =>
                        setSelected(type, event.target.checked)
                      }
                      aria-label={`选择昨天的${mealLabels[type]}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {mealLabels[type]}
                        {hasTodayContent && hasYesterdayContent && (
                          <span className="text-xs font-normal text-[var(--warning)]">
                            今天已有文字，不会覆盖
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block line-clamp-2 text-xs text-[var(--muted)]">
                        {hasYesterdayContent
                          ? source?.content
                          : "昨天没有文字记录"}
                      </span>
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
          {hasUnavailableSelection && (
            <p className="mt-3 text-xs text-[var(--warning)]" role="alert">
              选择期间今天的文字已发生变化，本次不会覆盖；请重新选择。
            </p>
          )}
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
              disabled={
                !selectedTypes.size || hasUnavailableSelection || copying
              }
              onClick={() => void carrySelected()}
              data-testid="confirm-carry-meals"
            >
              {copying ? "带入中…" : `带入 ${selectedTypes.size} 项`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
