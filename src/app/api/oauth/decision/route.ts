import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) return origin === requestUrl.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const form = await request.formData();
  const authorizationId = form.get("authorization_id");
  const decision = form.get("decision");
  if (
    typeof authorizationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(authorizationId) ||
    (decision !== "approve" && decision !== "deny")
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    return NextResponse.redirect(
      new URL(`/auth/login?next=${encodeURIComponent(next)}`, request.url),
      303,
    );
  }

  const result =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        });

  if (result.error || !result.data?.redirect_url) {
    return NextResponse.json(
      { error: "authorization_failed" },
      { status: 400 },
    );
  }

  return NextResponse.redirect(result.data.redirect_url, 303);
}
