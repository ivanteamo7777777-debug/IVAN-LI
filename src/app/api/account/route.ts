import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server-auth";

export async function DELETE() {
  try {
    await requireUser();
    if (process.env.NEXT_PUBLIC_E2E_MODE === "1") {
      return NextResponse.json({ ok: true });
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_user_account");
    if (error) throw error;
    await supabase.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    return NextResponse.json({ error: "账号删除失败" }, { status: 500 });
  }
}
