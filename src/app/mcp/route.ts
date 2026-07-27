import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  authenticateMcpRequest,
  createMcpChallenge,
  getMcpResourceUrl,
} from "@/lib/mcp/auth";
import {
  createE2eMcpRepository,
  createSupabaseMcpRepository,
} from "@/lib/mcp/repository";
import { createShouzhongMcpServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Last-Event-ID, MCP-Protocol-Version, MCP-Session-Id",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id",
};

function withCors(response: Response) {
  Object.entries(corsHeaders).forEach(([name, value]) =>
    response.headers.set(name, value),
  );
  return response;
}

function unauthorized(request: Request) {
  return withCors(
    new Response(
      JSON.stringify({
        error: "unauthorized",
        error_description: "请先通过守中日课 OAuth 登录并授权。",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "WWW-Authenticate": createMcpChallenge(request.url),
        },
      },
    ),
  );
}

async function handleMcp(request: Request) {
  const auth = await authenticateMcpRequest(request);
  if (!auth && request.method !== "POST") return unauthorized(request);

  const repository = auth
    ? process.env.NEXT_PUBLIC_E2E_MODE === "1"
      ? createE2eMcpRepository()
      : createSupabaseMcpRepository(auth.supabase, auth.user.id)
    : null;
  const challenge = createMcpChallenge(request.url);
  const server = createShouzhongMcpServer(repository, challenge);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(
    request,
    auth
      ? {
          authInfo: {
            token: auth.accessToken,
            clientId: "supabase-oauth-client",
            scopes: ["openid", "email", "profile"],
            resource: new URL(getMcpResourceUrl(request.url)),
            extra: { userId: auth.user.id },
          },
        }
      : undefined,
  );
  return withCors(response);
}

export const GET = handleMcp;
export const POST = handleMcp;
export const DELETE = handleMcp;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
