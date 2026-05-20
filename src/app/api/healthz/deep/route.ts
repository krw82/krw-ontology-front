import { checkMcpHealth } from "@/lib/agent/mcp-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

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
      root: health.root,
      release_id: health.releaseId,
      index_generated_at: health.indexGeneratedAt,
      company_count: health.companyCount,
      document_count: health.documentCount,
      object_count: health.objectCount,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown MCP health error",
    };
  }
}

export async function GET() {
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
