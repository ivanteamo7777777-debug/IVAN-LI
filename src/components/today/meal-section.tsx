"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Camera, Droplets, ImageIcon, Utensils } from "lucide-react";
import { toast } from "sonner";
import { localDb } from "@/lib/local-db";
import { queueFileUpload } from "@/lib/sync-engine";
import { newId } from "@/lib/utils";
import type { MealLog, MealType } from "@/types/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
  onPatch,
}: {
  userId: string;
  date: string;
  meals: Record<MealType, MealLog>;
  onPatch: (type: MealType, patch: Partial<MealLog>) => void;
}) {
  async function addPhoto(type: MealType, file: File) {
    const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
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
    <Card data-testid="meal-section">
      <CardHeader>
        <div className="mb-1 flex items-center gap-2 text-[var(--river)]">
          <Utensils className="size-4" />
          <span className="text-xs tracking-[0.16em]">独立记录</span>
        </div>
        <CardTitle>每日饮食</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(mealLabels) as MealType[]).map((type) => {
            const meal = meals[type];
            return (
              <div
                key={type}
                className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-serif font-semibold">{mealLabels[type]}</h3>
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
                <Textarea
                  value={meal.content}
                  placeholder={`记录${mealLabels[type]}，不做卡路里诊断`}
                  className="min-h-20"
                  onChange={(event) =>
                    onPatch(type, { content: event.target.value })
                  }
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
            <Input
              type="number"
              min={0}
              step={100}
              value={meals.snack.hydration_ml || ""}
              onChange={(event) =>
                onPatch("snack", {
                  hydration_ml: Number(event.target.value || 0),
                })
              }
            />
          </div>
          <div>
            <Label>当日整体感受</Label>
            <Input
              value={meals.snack.overall_feeling}
              placeholder="舒适、匆忙、规律……"
              onChange={(event) =>
                onPatch("snack", { overall_feeling: event.target.value })
              }
            />
          </div>
          <div>
            <Label>饮食备注</Label>
            <Input
              value={meals.snack.notes}
              onChange={(event) =>
                onPatch("snack", { notes: event.target.value })
              }
            />
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--muted-light)]">
          图片在离线时先保存在此设备，联网后自动上传到按账号隔离的私有 Storage 路径。
        </p>
      </CardContent>
    </Card>
  );
}
