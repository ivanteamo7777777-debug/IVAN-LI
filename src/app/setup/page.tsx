import { Database, KeyRound, Server } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SetupPage() {
  return (
    <main className="paper-grid min-h-dvh px-5 py-12">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs tracking-[0.28em] text-[var(--muted)]">
          守中日课
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold">
          连接自己的数据河道
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">
          应用源码已经可以运行。当前环境尚未连接 Supabase，因此不会伪造登录或生产数据。完成以下三步后即可进入正式管理库。
        </p>
        <div className="mt-9 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Database,
              title: "建立 Supabase 项目",
              text: "执行 supabase/migrations 中的迁移，启用 Auth、RLS、Realtime 与 Storage。",
            },
            {
              icon: KeyRound,
              title: "配置环境变量",
              text: "复制 .env.example，填写 URL 和 Publishable Key；私钥只放服务端。",
            },
            {
              icon: Server,
              title: "启动或部署",
              text: "本地 pnpm dev；生产环境将相同变量配置到 Vercel。",
            },
          ].map((item) => (
            <Card key={item.title}>
              <CardHeader>
                <item.icon className="mb-4 size-6 text-[var(--river)]" />
                <CardTitle>{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-[var(--muted)]">
                  {item.text}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Button asChild variant="secondary" className="mt-8">
          <Link href="/auth/login">配置完成，前往登录</Link>
        </Button>
      </div>
    </main>
  );
}
