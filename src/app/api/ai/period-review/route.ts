import { NextResponse } from "next/server";
import { z } from "zod";
import { AiUnavailableError, generateStructured } from "@/lib/ai/service";
import { compactTaskSchema, periodReviewOutputSchema } from "@/lib/ai/schemas";
import { requireUser } from "@/lib/server-auth";

const inputSchema = z.object({
  review_type: z.enum(["weekly", "monthly", "annual"]),
  period_start: z.iso.date(),
  period_end: z.iso.date(),
  tasks: z.array(compactTaskSchema).max(220),
  plans: z.array(z.record(z.string(), z.unknown())).max(120),
  accumulations: z.array(z.record(z.string(), z.unknown())).max(150),
  exercise: z.record(z.string(), z.unknown()),
  meals: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const input = inputSchema.parse(await request.json());
    const draft = await generateStructured(
      user.id,
      periodReviewOutputSchema,
      "period_review_draft",
      `根据指定周期的真实执行数据生成周期复盘草稿。比较计划进度、每日六件事趋势、反复未完成事项、真实积累以及运动饮食记录连续性。只使用输入事实，不做医疗或营养诊断，不把缺失记录解释为失败。下一周期重点应少而明确。输出简体中文，供用户修改确认。`,
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
