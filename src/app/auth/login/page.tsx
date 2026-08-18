import { redirect } from "next/navigation";
import Image from "next/image";
import { hasSupabaseEnv } from "@/lib/supabase/config";
import { LoginForm } from "@/components/login-form";
import { isLocalE2EMode } from "@/lib/e2e-mode";
import { safeInternalPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const localE2e = isLocalE2EMode();
  if (!hasSupabaseEnv() && !localE2e) {
    redirect("/setup");
  }
  const { next } = await searchParams;
  const nextPath = safeInternalPath(next);
  return (
    <main className="paper-grid grid min-h-dvh lg:grid-cols-[1.05fr_.95fr]">
      <section className="hidden flex-col justify-between border-r border-[var(--line)] p-12 lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <Image
              src="/icons/app-mark.svg"
              alt=""
              width={44}
              height={44}
              className="size-11 rounded-xl"
            />
            <div>
              <p className="font-serif text-xl font-semibold">守中日课</p>
              <p className="text-xs tracking-[0.12em] text-[var(--muted)]">
                个人执行与复盘系统
              </p>
            </div>
          </div>
        </div>
        <blockquote className="river-line max-w-xl pl-8">
          <p className="font-serif text-4xl leading-[1.35] text-[var(--ink)]">
            不断更新，
            <br />
            但不丢失自己的河道。
          </p>
          <p className="mt-7 max-w-lg leading-7 text-[var(--muted)]">
            把脑中的混乱交给系统，用年、月、周、日计划把每天最重要的六件事对齐长期方向。
          </p>
        </blockquote>
        <p className="text-xs text-[var(--muted-light)]">
          长期真实积累，优先于即时完成感。
        </p>
      </section>
      <section className="flex items-center justify-center p-5">
        <LoginForm e2e={localE2e} nextPath={nextPath} />
      </section>
    </main>
  );
}
