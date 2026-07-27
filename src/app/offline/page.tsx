import { CloudOff, Sprout } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function OfflinePage() {
  return (
    <main className="paper-grid flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          <CloudOff className="size-7 text-[var(--river)]" />
        </div>
        <p className="mb-2 text-xs tracking-[0.25em] text-[var(--muted)]">
          当前离线
        </p>
        <h1 className="font-serif text-3xl font-semibold">河道仍在</h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          已打开过的应用外壳和今日数据仍可使用。你的修改会先保存在设备中，网络恢复后再按顺序同步。
        </p>
        <Button asChild className="mt-7">
          <Link href="/today">
            <Sprout />
            返回今日执行
          </Link>
        </Button>
      </div>
    </main>
  );
}
