"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  BookOpenText,
  CalendarRange,
  CheckCircle2,
  CircleAlert,
  Cloud,
  CloudOff,
  Compass,
  RefreshCw,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSync } from "@/components/sync-provider";
import { ThemeQuickToggle } from "@/components/theme-controls";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/directions", label: "方向库", icon: Compass },
  { href: "/plans", label: "计划库", icon: CalendarRange },
  { href: "/today", label: "今日执行", icon: CheckCircle2 },
  { href: "/accumulations", label: "长期积累库", icon: Archive },
  { href: "/reviews", label: "复盘库", icon: BookOpenText },
];

interface NavigationConnection {
  effectiveType?: string;
  saveData?: boolean;
}

function hasNormalNavigationNetwork(online: boolean) {
  if (!online || !navigator.onLine) return false;
  const connection = (
    navigator as Navigator & { connection?: NavigationConnection }
  ).connection;
  return (
    !connection?.saveData &&
    connection?.effectiveType !== "slow-2g" &&
    connection?.effectiveType !== "2g"
  );
}

const statusMeta = {
  synced: { text: "已同步", icon: Cloud, className: "text-[var(--accent)]" },
  pending: {
    text: "等待同步",
    icon: RefreshCw,
    className: "text-[var(--warm)]",
  },
  failed: {
    text: "同步失败",
    icon: CloudOff,
    className: "text-[var(--danger)]",
  },
  conflict: {
    text: "需要处理冲突",
    icon: CircleAlert,
    className: "text-[var(--warning)]",
  },
};

export function AppShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const warmedRoutes = useRef(new Map<string, number>());
  const { status, online, pendingCount, syncNow } = useSync();
  const currentStatus = online
    ? statusMeta[status]
    : { text: "离线记录中", icon: CloudOff, className: "text-[var(--river)]" };
  const warmRoute = useCallback(
    (href: string) => {
      if (!hasNormalNavigationNetwork(online)) return;
      const warmedAt = warmedRoutes.current.get(href) ?? 0;
      if (pathname.startsWith(href) || Date.now() - warmedAt < 20_000) {
        return;
      }
      const startedAt = Date.now();
      warmedRoutes.current.set(href, startedAt);
      try {
        router.prefetch(href);
      } catch {
        warmedRoutes.current.delete(href);
      }
    },
    [online, pathname, router],
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16.5rem_1fr]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[16.5rem] flex-col border-r border-[var(--line)] bg-[var(--shell-paper)] p-5 backdrop-blur md:flex">
        <Link
          href="/today"
          prefetch={false}
          onPointerEnter={() => warmRoute("/today")}
          onFocus={() => warmRoute("/today")}
          onTouchStart={() => warmRoute("/today")}
          className="flex items-center gap-3 px-2 py-2"
        >
          <Image
            src="/icons/app-mark.svg"
            alt=""
            width={40}
            height={40}
            className="size-10 rounded-xl"
          />
          <div>
            <p className="font-serif text-lg font-semibold">守中日课</p>
            <p className="text-[10px] tracking-[0.14em] text-[var(--muted)]">
              个人执行与复盘系统
            </p>
          </div>
        </Link>
        <nav className="mt-10 space-y-1.5">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onPointerEnter={() => warmRoute(item.href)}
                onFocus={() => warmRoute(item.href)}
                onTouchStart={() => warmRoute(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-[var(--ink)] text-[var(--paper)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]",
                )}
              >
                <item.icon className="size-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto">
          <div className="mb-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <button
              onClick={() => void syncNow()}
              className={cn(
                "flex w-full items-center gap-2 text-xs",
                currentStatus.className,
              )}
            >
              <currentStatus.icon className="size-4" />
              <span>{currentStatus.text}</span>
              {pendingCount > 0 && (
                <span className="ml-auto tabular-nums">{pendingCount}</span>
              )}
            </button>
            <p className="mt-2 truncate text-[10px] text-[var(--muted-light)]">
              {email}
            </p>
          </div>
          <ThemeQuickToggle />
          <Button asChild variant="ghost" className="w-full justify-start">
            <Link
              href="/settings"
              prefetch={false}
              onPointerEnter={() => warmRoute("/settings")}
              onFocus={() => warmRoute("/settings")}
              onTouchStart={() => warmRoute("/settings")}
            >
              <Settings />
              设置与数据
            </Link>
          </Button>
        </div>
      </aside>

      <div className="min-w-0 md:col-start-2">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[var(--shell-header)] px-4 backdrop-blur md:hidden">
          <Link
            href="/today"
            prefetch={false}
            onPointerEnter={() => warmRoute("/today")}
            onFocus={() => warmRoute("/today")}
            onTouchStart={() => warmRoute("/today")}
            className="flex items-center gap-2"
          >
            <Image
              src="/icons/app-mark.svg"
              alt=""
              width={32}
              height={32}
              className="size-8 rounded-lg"
            />
            <span className="font-serif font-semibold">守中日课</span>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeQuickToggle compact />
            <Link
              href={status === "conflict" ? "/settings#conflicts" : "/settings"}
              prefetch={false}
              onPointerEnter={() => warmRoute("/settings")}
              onFocus={() => warmRoute("/settings")}
              onTouchStart={() => warmRoute("/settings")}
              aria-label={currentStatus.text}
              className={cn(
                "flex size-10 items-center justify-center rounded-xl",
                currentStatus.className,
              )}
            >
              <currentStatus.icon className="size-5" />
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-6 sm:px-6 md:px-8 md:pb-12 md:pt-8">
          {children}
        </main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--line)] bg-[var(--shell-surface)] px-1 pt-1.5 backdrop-blur md:hidden">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onPointerEnter={() => warmRoute(item.href)}
              onFocus={() => warmRoute(item.href)}
              onTouchStart={() => warmRoute(item.href)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px]",
                active ? "text-[var(--ink)]" : "text-[var(--muted)]",
              )}
            >
              <item.icon className={cn("size-5", active && "stroke-[2.4]")} />
              <span>{item.label.replace("库", "")}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
