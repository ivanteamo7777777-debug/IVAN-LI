import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRouteClient } from "@/lib/supabase/route";

const passwordAuthSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(256),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: "请求来源不正确" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = passwordAuthSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "邮箱或密码格式不正确" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const response = NextResponse.json({
    ok: true,
  });
  const supabase = createRouteClient(request, response);
  const { email, password } = parsed.data;
  const result = await supabase.auth.signInWithPassword({ email, password });

  if (result.error) {
    return NextResponse.json(
      { error: result.error.message },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return response;
}
