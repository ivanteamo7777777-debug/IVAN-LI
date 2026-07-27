import { NextResponse } from "next/server";
import { z } from "zod";
import { AiUnavailableError, generateStructured } from "@/lib/ai/service";
import {
  compactTaskSchema,
  dailyReviewOutputSchema,
} from "@/lib/ai/schemas";
import { requireUser } from "@/lib/server-auth";

const inputSchema = z.object({
  review_type: z.literal("daily"),
  period_start: z.iso.date(),
  period_end: z.iso.date(),
  tasks: z.array(compactTaskSchema).max(6),
  plans: z.array(z.record(z.string(), z.unknown())).max(30),
  accumulations: z.array(z.record(z.string(), z.unknown())).max(30),
  exercise: z.record(z.string(), z.unknown()),
  meals: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = inputSchema.parse(await request.json());
    const draft = await generateStructured(
      user.id,
      dailyReviewOutputSchema,
      "daily_review_draft",
      `根据提供的当日真实执行数据生成每日复盘草稿。只引用输入中存在的事实；缺少信息时明确写“尚未记录”，不要推断。分析未完成原因时保持诚实、平静，不制造焦虑。输出简体中文，内容供用户修改确认。`,
      input,
    );
    return NextResponse.json(
      { draft },
      { headers: { "Cache-Control": "private, no-store" } },
    );
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
