import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalE2EMode } from "@/lib/e2e-mode";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server-auth";

const subscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({
    p256dh: z.string().min(20),
    auth: z.string().min(8),
  }),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (isLocalE2EMode(request)) {
      return NextResponse.json({ ok: true });
    }
    const subscription = subscriptionSchema.parse(await request.json());
    const supabase = await createClient();
    const now = new Date().toISOString();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? "",
        updated_at: now,
      },
      { onConflict: "user_id,endpoint" },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "通知订阅格式不正确" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    return NextResponse.json({ error: "保存通知订阅失败" }, { status: 500 });
  }
}
