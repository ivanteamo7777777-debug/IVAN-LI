import { getProtectedResourceMetadata } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(getProtectedResourceMetadata(request.url), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
