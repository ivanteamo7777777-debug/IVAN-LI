import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseDailySixAutoDraftRepository,
  generateDailySixAutoDraft,
} from "@/lib/ai/daily-six-auto-draft";
import { isLocalE2EMode } from "@/lib/e2e-mode";
import { requireUser } from "@/lib/server-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const inputSchema = z.object({ date: z.iso.date() });
const applySchema = z.object({
  date: z.iso.date(),
  expected_version: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { date } = inputSchema.parse(await request.json());
    if (isLocalE2EMode(request)) {
      return NextResponse.json(
        { status: "ok", outcome: "skipped", date, reason: "disabled" },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const repository =
      createSupabaseDailySixAutoDraftRepository(createAdminClient());
    const result = await generateDailySixAutoDraft(
      { userId: user.id, trigger: "first_open", requestedDate: date },
      { repository },
    );
    return NextResponse.json(result, {
      status: result.status === "error" ? 502 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { status: "error", error: "请求日期格式不正确" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { status: "error", error: "请先登录" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { status: "error", error: "AI 草稿服务暂时不可用" },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const { date, expected_version: expectedVersion } = applySchema.parse(
      await request.json(),
    );
    if (isLocalE2EMode(request)) {
      return NextResponse.json(
        { status: "ok", outcome: "applied", date },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const repository =
      createSupabaseDailySixAutoDraftRepository(createAdminClient());
    const entry = await repository.markApplied(user.id, date, expectedVersion);
    if (entry) {
      return NextResponse.json(
        { status: "ok", outcome: "applied", date, entry },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const current = await repository.getEntry(user.id, date);
    if (current?.daily_six_ai_draft_status === "applied") {
      return NextResponse.json(
        { status: "ok", outcome: "applied", date, entry: current },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      {
        status: "error",
        outcome: "conflict",
        error: "草稿版本已变化，请重新读取后再确认。",
        entry: current,
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { status: "error", error: "请求数据格式不正确" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { status: "error", error: "请先登录" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { status: "error", error: "草稿状态更新失败" },
      { status: 503 },
    );
  }
}
