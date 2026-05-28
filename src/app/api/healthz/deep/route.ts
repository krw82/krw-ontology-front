import { timingSafeEqual } from "crypto";
import { getReadyAgentWorker } from "@/lib/agent/worker-heartbeat";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";
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

async function checkCatalog(): Promise<CheckResult> {
  try {
    const release = await getActiveOntologyCatalogRelease();
    if (!release) {
      return {
        ok: false,
        error: "No active ontology web catalog release found",
      };
    }

    return {
      ok: true,
      env: release.env,
      release_id: release.release_id,
      generated_at: release.generated_at,
      index_generated_at: release.index_generated_at,
      company_count: release.company_count,
      document_count: release.document_count,
      object_count: release.object_count,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown catalog health error",
    };
  }
}

async function checkWorkerMcp(expectedReleaseId?: string): Promise<CheckResult> {
  try {
    const ready = await getReadyAgentWorker(new Date(), expectedReleaseId);
    if (!ready.ok) {
      return {
        ok: false,
        error: ready.message,
      };
    }

    const health = ready.mcpHealth;
    return {
      ok: health.connected,
      error: health.error,
      static_ok: health.staticOk,
      command_ok: health.commandOk,
      live_ok: health.liveOk,
      sqlite_ok: health.sqliteOk,
      env: health.env,
      root: health.root,
      index_path: health.indexPath,
      manifest_path: health.manifestPath,
      manifest_valid: health.manifestValid,
      release_id: health.releaseId,
      agent_index_schema_version: health.agentIndexSchemaVersion,
      index_generated_at: health.indexGeneratedAt,
      company_count: health.companyCount,
      document_count: health.documentCount,
      object_count: health.objectCount,
      tool_count: health.toolCount,
      tools: health.tools,
      worker_id: ready.worker.worker_id,
      worker_status: ready.worker.status,
      worker_last_seen_at: ready.worker.last_seen_at,
      worker_heartbeat_expires_at: ready.worker.heartbeat_expires_at,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown worker MCP health error",
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

  const [supabase, catalog] = await Promise.all([
    checkSupabase(),
    checkCatalog(),
  ]);
  const mcp =
    catalog.ok && typeof catalog.release_id === "string"
      ? await checkWorkerMcp(catalog.release_id)
      : {
          ok: false,
          error: "Cannot check worker MCP without an active catalog release",
        };
  const ok = supabase.ok && catalog.ok && mcp.ok;

  return Response.json(
    {
      status: ok ? "ok" : "error",
      timestamp: new Date().toISOString(),
      checks: {
        web: { ok: true },
        supabase,
        catalog,
        mcp,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
