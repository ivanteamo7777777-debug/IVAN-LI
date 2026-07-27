import { redirect } from "next/navigation";
import { ArrowRight, Bot, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isValidAuthorizationId } from "@/lib/oauth/authorization-id";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const scopeLabels: Record<string, string> = {
  openid: "确认当前登录身份",
  email: "读取登录邮箱，用于识别账号",
  profile: "读取账号的基础资料",
};

function ConsentError({ message }: { message: string }) {
  return (
    <main className="paper-grid flex min-h-dvh items-center justify-center p-5">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>无法继续授权</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-[var(--muted)]">
            你可以关闭此页面，回到 ChatGPT 后重新连接“守中日课”。
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const { authorization_id: authorizationId } = await searchParams;
  if (!isValidAuthorizationId(authorizationId)) {
    return <ConsentError message="授权请求无效或缺少 authorization_id。" />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    redirect(`/auth/login?next=${encodeURIComponent(next)}`);
  }

  const { data, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return (
      <ConsentError
        message={error?.message || "这次授权请求已失效，请重新连接。"}
      />
    );
  }
  if ("redirect_url" in data) redirect(data.redirect_url);

  const scopes = data.scope.split(/\s+/).filter(Boolean);

  return (
    <main className="paper-grid flex min-h-dvh items-center justify-center p-5">
      <Card className="w-full max-w-xl bg-[rgba(251,250,246,.96)]">
        <CardHeader className="p-7 pb-4">
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]">
            <Bot className="size-5" aria-hidden="true" />
          </div>
          <p className="text-xs tracking-[0.16em] text-[var(--muted)]">
            守中日课 · 安全连接
          </p>
          <CardTitle className="mt-2 text-2xl">
            是否允许 {data.client.name || "ChatGPT"} 连接你的管理库？
          </CardTitle>
          <CardDescription className="mt-3 leading-6">
            授权后，ChatGPT 只能通过你的账号访问 RLS
            允许的数据。写入前仍必须先让你确认。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-7 pt-3">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4" aria-hidden="true" />
              本次授权范围
            </p>
            <ul className="space-y-2">
              {scopes.map((scope) => (
                <li
                  key={scope}
                  className="flex items-start gap-2 text-sm leading-6 text-[var(--muted)]"
                >
                  <Check className="mt-1 size-4 shrink-0" aria-hidden="true" />
                  {scopeLabels[scope] || scope}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 space-y-1 text-xs leading-5 text-[var(--muted-light)]">
            <p>当前账号：{data.user.email}</p>
            <p className="break-all">返回地址：{data.redirect_uri}</p>
            <p>你可以稍后在账号设置中撤销这项授权。</p>
          </div>

          <form
            action="/api/oauth/decision"
            method="post"
            className="mt-7 grid gap-3 sm:grid-cols-2"
          >
            <input
              type="hidden"
              name="authorization_id"
              value={data.authorization_id}
            />
            <Button
              type="submit"
              name="decision"
              value="deny"
              variant="secondary"
              size="lg"
            >
              暂不连接
            </Button>
            <Button type="submit" name="decision" value="approve" size="lg">
              允许连接
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
