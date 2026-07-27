import { NextResponse } from "next/server";
import { z } from "zod";
import { AiUnavailableError, generateStructured } from "@/lib/ai/service";
import {
  compactDirectionSchema,
  compactPlanSchema,
  dailySixOutputSchema,
} from "@/lib/ai/schemas";
import { requireUser } from "@/lib/server-auth";

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
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = inputSchema.parse(await request.json());
    if (process.env.NEXT_PUBLIC_E2E_MODE === "1") {
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
    const result = await generateStructured(
      user.id,
      dailySixOutputSchema,
      "daily_six_draft",
      `你是“守中日课”的计划对齐助手。根据用户明确提供的方向、年度/月度/周计划，为指定日期提出恰好六件可执行事项。每件事必须有清晰完成标准和可以立即开始的第一步。优先关联已有周计划 ID，不得编造 ID。已有事项不要重复。输出只是草稿，绝不声称已经写入。使用克制、具体的简体中文。`,
      input,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "请求数据格式不正确" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    return NextResponse.json({ error: "AI 草稿生成失败" }, { status: 500 });
  }
}
