"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/lib/theme";

const themeChoices: {
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}[] = [
  {
    value: "light",
    label: "浅色",
    description: "保持当前明亮纸张质感",
    icon: Sun,
  },
  {
    value: "dark",
    label: "夜间",
    description: "降低夜晚使用时的亮度",
    icon: Moon,
  },
  {
    value: "system",
    label: "跟随系统",
    description: "随设备外观自动切换",
    icon: Monitor,
  },
];

export function ThemePreferenceCard() {
  const { preference, ready, setPreference } = useTheme();

  return (
    <Card data-testid="theme-settings">
      <CardHeader>
        <div className="mb-1 flex items-center gap-2 text-[var(--river)]">
          <Moon className="size-4" />
          <span className="text-xs tracking-[0.16em]">当前设备外观</span>
        </div>
        <CardTitle>显示模式</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="grid gap-2 sm:grid-cols-3"
          role="group"
          aria-label="显示模式"
        >
          {themeChoices.map((choice) => {
            const active = ready && preference === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                data-testid={`theme-${choice.value}`}
                aria-pressed={active}
                disabled={!ready}
                onClick={() => setPreference(choice.value)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--ink)]"
                    : "border-[var(--line)] bg-[var(--paper)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]",
                )}
              >
                <choice.icon className="mb-2 size-4" />
                <span className="block text-sm font-medium">
                  {choice.label}
                </span>
                <span className="mt-1 block text-[10px] leading-4 text-[var(--muted-light)]">
                  {choice.description}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-xs leading-5 text-[var(--muted-light)]">
          只保存在当前设备，不影响任务、同步、导出或其他设备。
        </p>
      </CardContent>
    </Card>
  );
}

export function ThemeQuickToggle({ compact = false }: { compact?: boolean }) {
  const { ready, resolvedTheme, toggleResolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const Icon = dark ? Sun : Moon;
  const label = dark ? "切换为浅色模式" : "切换为夜间模式";

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon" : "default"}
      className={cn(!compact && "w-full justify-start")}
      aria-label={label}
      title={label}
      disabled={!ready}
      onClick={toggleResolvedTheme}
      data-testid="theme-quick-toggle"
    >
      <Icon />
      {!compact && <span>{dark ? "浅色模式" : "夜间模式"}</span>}
    </Button>
  );
}
