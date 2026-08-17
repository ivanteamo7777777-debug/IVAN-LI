import type { Metadata } from "next";
import { Suspense } from "react";
import { TodayView } from "@/components/today/today-view";

export const metadata: Metadata = { title: "今日执行" };

export default function TodayPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-[var(--muted)]" role="status">
          正在读取今天的记录…
        </div>
      }
    >
      <TodayView />
    </Suspense>
  );
}
