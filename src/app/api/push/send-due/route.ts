import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asWebPushSubscription, configureWebPush } from "@/lib/push";

interface ReminderRow {
  id: string;
  user_id: string;
  time_zone: string;
  daily_six_enabled: boolean;
  daily_six_time: string;
  exercise_enabled: boolean;
  exercise_time: string;
  review_enabled: boolean;
  review_time: string;
  last_daily_six_sent: string | null;
  last_exercise_sent: string | null;
  last_review_sent: string | null;
}

function zonedNow(timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function due(currentMinutes: number, target: string) {
  const [hour, minute] = target.split(":").map(Number);
  const difference = currentMinutes - (hour * 60 + minute);
  return difference >= 0 && difference < 15;
}

async function sendDueReminders(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const admin = createAdminClient();
    const webpush = configureWebPush();
    const { data: settings, error } = await admin
      .from("reminder_settings")
      .select("*");
    if (error) throw error;
    let sent = 0;
    for (const setting of (settings ?? []) as ReminderRow[]) {
      let local;
      try {
        local = zonedNow(setting.time_zone || "Asia/Shanghai");
      } catch {
        local = zonedNow("Asia/Shanghai");
      }
      const reminders = [
        {
          enabled: setting.daily_six_enabled,
          time: setting.daily_six_time,
          last: setting.last_daily_six_sent,
          lastField: "last_daily_six_sent",
          title: "守中日课 · 今日六件事",
          body: "给今天真正重要的六件事一个清晰的位置。",
          url: `/today?date=${local.date}`,
        },
        {
          enabled: setting.exercise_enabled,
          time: setting.exercise_time,
          last: setting.last_exercise_sent,
          lastField: "last_exercise_sent",
          title: "守中日课 · 运动",
          body: "如果今天计划运动，现在可以从最小的一步开始。",
          url: `/today?date=${local.date}#exercise`,
        },
        {
          enabled: setting.review_enabled,
          time: setting.review_time,
          last: setting.last_review_sent,
          lastField: "last_review_sent",
          title: "守中日课 · 晚间复盘",
          body: "平静地记录真实发生的事，为明天校准方向。",
          url: `/reviews?type=daily&date=${local.date}`,
        },
      ];
      for (const reminder of reminders) {
        if (
          !reminder.enabled ||
          reminder.last === local.date ||
          !due(local.minutes, reminder.time)
        ) {
          continue;
        }
        const { data: subscriptions } = await admin
          .from("push_subscriptions")
          .select("endpoint,p256dh,auth")
          .eq("user_id", setting.user_id);
        const payload = JSON.stringify({
          title: reminder.title,
          body: reminder.body,
          url: reminder.url,
          tag: reminder.lastField,
        });
        const results = await Promise.allSettled(
          (subscriptions ?? []).map((subscription) =>
            webpush.sendNotification(
              asWebPushSubscription(subscription),
              payload,
            ),
          ),
        );
        if (results.some((result) => result.status === "fulfilled")) {
          sent += 1;
          await admin
            .from("reminder_settings")
            .update({ [reminder.lastField]: local.date })
            .eq("id", setting.id);
        }
      }
    }
    return NextResponse.json({ ok: true, sent });
  } catch {
    return NextResponse.json(
      { error: "Reminder delivery failed" },
      { status: 500 },
    );
  }
}

export const GET = sendDueReminders;
export const POST = sendDueReminders;
