"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, Mail } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ e2e = false }: { e2e?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (e2e) {
      router.push("/today");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({
              email,
              password,
              options: {
                emailRedirectTo: `${window.location.origin}/auth/callback`,
              },
            });
      if (error) throw error;
      if (mode === "signup") {
        toast.success("注册成功，请检查邮箱完成确认");
      } else {
        router.replace("/today");
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  async function magicLink() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      toast.success("登录链接已发送到邮箱");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md bg-[rgba(251,250,246,.92)]">
      <CardHeader className="p-7 pb-4">
        <div className="mb-6 flex items-center gap-3 lg:hidden">
          <Image
            src="/icons/app-mark.svg"
            alt=""
            width={40}
            height={40}
            className="size-10 rounded-xl"
          />
          <p className="font-serif text-xl font-semibold">守中日课</p>
        </div>
        <p className="text-xs tracking-[0.18em] text-[var(--muted)]">
          回到自己的河道
        </p>
        <CardTitle className="mt-2 text-2xl">
          {mode === "login" ? "登录管理库" : "建立个人管理库"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-7 pt-3">
        <form className="space-y-4" onSubmit={submit}>
          <div>
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required={!e2e}
            />
          </div>
          <div>
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required={!e2e}
            />
          </div>
          <Button className="w-full" disabled={loading}>
            {loading ? "请稍候…" : e2e ? "进入本地测试库" : mode === "login" ? "登录" : "注册"}
            <ArrowRight />
          </Button>
        </form>
        {!e2e && (
          <>
            <Button
              variant="secondary"
              className="mt-3 w-full"
              onClick={magicLink}
              disabled={!email || loading}
            >
              <Mail />
              发送免密登录链接
            </Button>
            <button
              className="mt-6 w-full text-center text-sm text-[var(--muted)] hover:text-[var(--ink)]"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "还没有账号？注册" : "已有账号？返回登录"}
            </button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
