import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { requireSupabaseEnv } from "@/lib/supabase/config";

const MCP_SCOPES = ["openid", "email", "profile"] as const;

export interface McpAuthContext {
  accessToken: string;
  user: User;
  supabase: SupabaseClient;
}

export function extractBearerToken(header: string | null) {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function getMcpResourceUrl(requestUrl: string) {
  const configuredOrigin =
    process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  const origin = configuredOrigin
    ? new URL(configuredOrigin).origin
    : new URL(requestUrl).origin;
  return `${origin}/mcp`;
}

export function getSupabaseOAuthIssuer() {
  if (
    process.env.NEXT_PUBLIC_E2E_MODE === "1" &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  ) {
    return "https://e2e-project.supabase.co/auth/v1";
  }
  const { url } = requireSupabaseEnv();
  return `${url.replace(/\/$/, "")}/auth/v1`;
}

export function getProtectedResourceMetadata(requestUrl: string) {
  const resource = getMcpResourceUrl(requestUrl);
  return {
    resource,
    authorization_servers: [getSupabaseOAuthIssuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${new URL(resource).origin}/settings`,
  };
}

export function createMcpChallenge(requestUrl: string) {
  const metadataUrl = `${new URL(getMcpResourceUrl(requestUrl)).origin}/.well-known/oauth-protected-resource/mcp`;
  return `Bearer resource_metadata="${metadataUrl}", scope="${MCP_SCOPES.join(" ")}"`;
}

export async function authenticateMcpRequest(
  request: Request,
): Promise<McpAuthContext | null> {
  const accessToken = extractBearerToken(request.headers.get("authorization"));
  if (!accessToken) return null;

  if (
    process.env.NEXT_PUBLIC_E2E_MODE === "1" &&
    accessToken === "e2e-mcp-token"
  ) {
    return {
      accessToken,
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        aud: "authenticated",
        role: "authenticated",
        email: "e2e@example.invalid",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
      },
      supabase: {} as SupabaseClient,
    };
  }

  const { url, key } = requireSupabaseEnv();
  const supabase = createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);

  if (error || !user) return null;
  return { accessToken, user, supabase };
}
