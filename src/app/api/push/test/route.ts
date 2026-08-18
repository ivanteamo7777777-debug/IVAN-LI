import { NextResponse } from "next/server";
import { isLocalE2EMode } from "@/lib/e2e-mode";
import { asWebPushSubscription, configureWebPush } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server-auth";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (isLocalE2EMode(request)) {
      return NextResponse.json({ ok: true });
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("user_id", user.id);
    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json(
        { error: "尚未找到此设备的通知订阅，请先开启一个提醒" },
        { status: 404 },
      );
    }
    const webpush = configureWebPush();
    const payload = JSON.stringify({
      title: "守中日课 · 测试提醒",
      body: "通知通道已建立。回到自己的河道，看看今天真正重要的事。",
      url: "/today",
      tag: "shouzhong-test",
    });
    await Promise.allSettled(
      data.map((record) =>
        webpush.sendNotification(asWebPushSubscription(record), payload),
      ),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const message =
      error instanceof Error && error.message.includes("环境变量")
        ? error.message
        : "测试通知发送失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
