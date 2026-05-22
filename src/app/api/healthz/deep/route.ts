import { timingSafeEqual } from "crypto";
import { checkMcpHealth } from "@/lib/agent/mcp-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: Request): boolean {
  const internalKey = request.headers.get("x-internal-key") ?? "";
  const expectedKey = process.env.INTERNAL_API_KEY ?? "";
  return Boolean(expectedKey) && safeCompare(internalKey, expectedKey);
}

async function checkSupabase(): Promise<CheckResult> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("chat_sessions")
      .select("id", { count: "exact", head: true })
      .limit(1);

    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown Supabase health error",
    };
  }
}

async function checkMcp(): Promise<CheckResult> {
  try {
    const health = await checkMcpHealth();
    return {
      ok: health.connected,
      error: health.error,
      static_ok: health.staticOk,
      command_ok: health.commandOk,
      live_ok: health.liveOk,
      sqlite_ok: health.sqliteOk,
      root: health.root,
      index_path: health.indexPath,
      release_id: health.releaseId,
      index_generated_at: health.indexGeneratedAt,
      company_count: health.companyCount,
      document_count: health.documentCount,
      object_count: health.objectCount,
      tool_count: health.toolCount,
      tools: health.tools,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown MCP health error",
    };
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: { code: "forbidden", message: "Unauthorized" } },
      { status: 403 },
    );
  }

  const [supabase, mcp] = await Promise.all([checkSupabase(), checkMcp()]);
  const ok = supabase.ok && mcp.ok;

  return Response.json(
    {
      status: ok ? "ok" : "error",
      timestamp: new Date().toISOString(),
      checks: {
        web: { ok: true },
        supabase,
        mcp,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
