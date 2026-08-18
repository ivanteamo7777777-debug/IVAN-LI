import { NextResponse } from "next/server";
import { z } from "zod";
import { AiUnavailableError, generateStructured } from "@/lib/ai/service";
import { isLocalE2EMode } from "@/lib/e2e-mode";
import {
  DAILY_SIX_INSTRUCTIONS,
  loadVisibleWeeklyPlanIds,
  normalizeDailySixDraft,
} from "@/lib/ai/daily-six";
import {
  compactDirectionSchema,
  compactPlanSchema,
  dailySixOutputSchema,
} from "@/lib/ai/schemas";
import { requireUser } from "@/lib/server-auth";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  date: z.iso.date(),
  directions: z.array(compactDirectionSchema).max(30),
  plans: z.array(compactPlanSchema).max(100),
  existing: z
    .array(
      z.object({
        slot_index: z.number().int().min(1).max(6),
        title: z.string().max(160),
      }),
    )
    .max(6),
  yesterday_incomplete: z
    .array(
      z.object({
        title: z.string().max(160),
        status: z.string().max(30).optional(),
        importance: z.string().max(800).optional(),
        completion_standard: z.string().max(800).optional(),
      }),
    )
    .max(6)
    .optional(),
  recent_adjustment: z.string().max(1200).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const input = inputSchema.parse(await request.json());
    if (isLocalE2EMode(request)) {
      return NextResponse.json({
        suggestions: Array.from({ length: 6 }, (_, index) => ({
          title: `AI 建议 ${index + 1}`,
          importance: "与计划对齐",
          completion_standard: "完成一个可验证结果",
          first_action: "先做五分钟",
          weekly_plan_id: null,
        })),
      });
    }
    const client = await createClient();
    const [result, allowedWeeklyPlanIds] = await Promise.all([
      generateStructured(
        user.id,
        dailySixOutputSchema,
        "daily_six_draft",
        DAILY_SIX_INSTRUCTIONS,
        input,
      ),
      loadVisibleWeeklyPlanIds(client, user.id),
    ]);
    return NextResponse.json(
      normalizeDailySixDraft(result, allowedWeeklyPlanIds),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "请求数据格式不正确" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    return NextResponse.json({ error: "AI 草稿生成失败" }, { status: 500 });
  }
}
