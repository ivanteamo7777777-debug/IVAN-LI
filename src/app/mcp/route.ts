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
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function getRpcMethod(request: Request) {
  if (request.method !== "POST") return null;
  try {
    const body = (await request.clone().json()) as { method?: unknown };
    return typeof body.method === "string" ? body.method : null;
  } catch {
    return null;
  }
}

async function exposeToolSecuritySchemes(
  response: Response,
  rpcMethod: string | null,
) {
  if (
    rpcMethod !== "tools/list" ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    return response;
  }
  const body = (await response.json()) as {
    result?: {
      tools?: Array<{
        securitySchemes?: unknown;
        _meta?: { securitySchemes?: unknown };
      }>;
    };
  };
  body.result?.tools?.forEach((tool) => {
    if (!tool.securitySchemes && tool._meta?.securitySchemes) {
      tool.securitySchemes = tool._meta.securitySchemes;
    }
  });
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function unauthorized(request: Request) {
  return withCors(
    new Response(
      JSON.stringify({
        status: "error",
        code: "UNAUTHORIZED",
        message: "请先通过守中日课 OAuth 登录并授权。",
        details: {},
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
  try {
    const rpcMethod = await getRpcMethod(request);
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
    return withCors(await exposeToolSecuritySchemes(response, rpcMethod));
  } catch {
    return withCors(
      Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: "守中日课 MCP 暂时无法处理这次请求。",
            data: {
              status: "error",
              code: "INTERNAL_ERROR",
              message: "守中日课 MCP 暂时无法处理这次请求。",
              details: {},
            },
          },
        },
        { status: 500 },
      ),
    );
  }
}

export const GET = handleMcp;
export const POST = handleMcp;
export const DELETE = handleMcp;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
