import { timingSafeEqual } from "crypto";
import { APP_VERSION } from "@/lib/app-version";
import {
  getReadyAgentWorker,
} from "@/lib/agent/worker-heartbeat";
import { getReadyRustAgentDaemon } from "@/lib/agent/daemon-heartbeat";
import { hasTrustedClientIpConfiguration } from "@/lib/http/client-ip";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkAgentV1Readiness, type AgentV1Readiness } from "@/lib/agent-v1/readiness";

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

function checkTrustedClientIpConfiguration(): CheckResult {
  if (hasTrustedClientIpConfiguration()) return { ok: true };

  return {
    ok: false,
    error: "Trusted client IP configuration is invalid",
  };
}

function filingDetectionExpected(): boolean {
  return process.env.FILING_DETECTION_ENABLED !== "0";
}

function filingWorkerEnv(): "dev" | "staging" | "prod" {
  const value = process.env.FILING_WORKER_ENV?.trim().toLowerCase();
  return value === "dev" || value === "staging" || value === "prod" ? value : "prod";
}

async function checkFilingWorker(): Promise<CheckResult> {
  if (!filingDetectionExpected()) return { ok: true, enabled: false };
  try {
    const admin = getSupabaseAdmin();
    const [{ data, error }, { data: lease, error: leaseError }] = await Promise.all([
      admin
      .from("filing_notification_worker_heartbeats")
      .select("worker_id, last_seen_at, last_success_at, last_error")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
      admin
        .from("sec_filing_worker_leases")
        .select("worker_id, deployment_id, heartbeat_at, lease_expires_at")
        .eq("env", filingWorkerEnv())
        .eq("lease_key", "sec_request_scheduler")
        .maybeSingle(),
    ]);
    if (error || !data) return { ok: false, enabled: true, error: error?.message ?? "No filing notification worker heartbeat" };
    const ageMs = Date.now() - Date.parse(data.last_seen_at);
    if (!Number.isFinite(ageMs) || ageMs > 75_000) {
      return { ok: false, enabled: true, error: "Filing notification worker heartbeat is stale", worker_id: data.worker_id, last_seen_at: data.last_seen_at };
    }
    const leaseIsCurrent = !leaseError
      && Boolean(lease)
      && Date.parse(lease?.lease_expires_at ?? "") > Date.now();
    const expectedDeploymentId =
      APP_VERSION === "development" ? null : APP_VERSION;
    const leaseMatchesDeployment =
      !expectedDeploymentId || lease?.deployment_id === expectedDeploymentId;
    const schedulerReady = leaseIsCurrent && leaseMatchesDeployment;
    return {
      ok: schedulerReady,
      enabled: true,
      error: schedulerReady
        ? undefined
        : leaseError?.message ??
          (leaseIsCurrent
            ? `Filing scheduler deployment mismatch: ${lease?.deployment_id ?? "missing"}`
            : "No current filing scheduler lease"),
      worker_id: data.worker_id,
      last_seen_at: data.last_seen_at,
      last_success_at: data.last_success_at,
      last_error: data.last_error,
      scheduler_leader: leaseIsCurrent ? {
        worker_id: lease?.worker_id,
        deployment_id: lease?.deployment_id,
        heartbeat_at: lease?.heartbeat_at,
        lease_expires_at: lease?.lease_expires_at,
      } : null,
      scheduler_lease_error: leaseError?.message ?? null,
    };
  } catch (err) {
    return { ok: false, enabled: true, error: err instanceof Error ? err.message : "Unknown filing worker health error" };
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

async function checkRustAgentDaemon(): Promise<CheckResult> {
  try {
    const ready = await getReadyRustAgentDaemon();
    if (!ready.ok) {
      return { ok: false, error: ready.message };
    }
    return {
      ok: true,
      required: ready.required,
      daemon_id: ready.daemon?.daemon_id ?? null,
      provider: ready.daemon?.provider ?? null,
      descriptor_artifact_hash: ready.daemon?.descriptor_artifact_hash ?? null,
      release_set_hash: ready.daemon?.release_set_hash ?? null,
      runtime_version: ready.daemon?.runtime_version ?? null,
      last_seen_at: ready.daemon?.last_seen_at ?? null,
      heartbeat_expires_at: ready.daemon?.heartbeat_expires_at ?? null,
    };
  } catch {
    // This endpoint is operator-only, but it must still not expose a local
    // filesystem path or database/provider error from a failed heartbeat read.
    return { ok: false, error: "Local Rust research daemon is unavailable" };
  }
}

/**
 * Agent V1 settles provider cost from the exact model recorded on the run.
 * Do not let a production queue open when that model has no verified pricing
 * snapshot: the answer can still be projected after the policy is repaired,
 * but silently recording a different provider's price (or zero) is unsafe.
 */
async function checkAgentV1ProviderPricing(
  readiness: AgentV1Readiness,
): Promise<CheckResult> {
  const runtimeEnvironment = process.env.KRW_RUNTIME_ENVIRONMENT?.trim().toLowerCase();
  const required = runtimeEnvironment === "prod"
    || runtimeEnvironment === "staging"
    || process.env.NODE_ENV === "production";
  if (!required) return { ok: true, required: false };
  if (!readiness.provider || !readiness.model) {
    return {
      ok: false,
      required: true,
      error: "Agent V1 provider/model is not resolved",
    };
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("provider_pricing_policies")
      .select("version, effective_from, effective_to, source_url, verified_at")
      .eq("provider", readiness.provider)
      .eq("provider_model", readiness.model)
      .order("effective_from", { ascending: false })
      .limit(16);
    if (error) {
      return { ok: false, required: true, error: error.message };
    }
    const now = Date.now();
    const current = (data ?? []).find((row) => {
      const starts = Date.parse(row.effective_from);
      const ends = row.effective_to ? Date.parse(row.effective_to) : Number.POSITIVE_INFINITY;
      const verifiedAt = row.verified_at ? Date.parse(row.verified_at) : Number.NaN;
      const sourceUrl = typeof row.source_url === "string" ? row.source_url : "";
      return Number.isFinite(starts)
        && starts <= now
        && ends > now
        && Number.isFinite(verifiedAt)
        && verifiedAt <= now
        && /^https:\/\//i.test(sourceUrl);
    });
    if (!current) {
      return {
        ok: false,
        required: true,
        provider: readiness.provider,
        model: readiness.model,
        error: "No current verified provider pricing policy for the selected model",
      };
    }
    return {
      ok: true,
      required: true,
      provider: readiness.provider,
      model: readiness.model,
      pricing_version: current.version,
    };
  } catch (error) {
    return {
      ok: false,
      required: true,
      error: error instanceof Error ? error.message : "Provider pricing readiness failed",
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

  const [supabase, catalog, filingWorker, agentV1] = await Promise.all([
    checkSupabase(),
    checkCatalog(),
    checkFilingWorker(),
    checkAgentV1Readiness(),
  ]);
  const agentV1Pricing = await checkAgentV1ProviderPricing(agentV1);
  const trustedClientIp = checkTrustedClientIpConfiguration();
  const agentV1Required =
    process.env.KRW_AGENT_BACKEND_MODE === "rust" ||
    process.env.KRW_RUNTIME_ENVIRONMENT === "prod";
  const mcp = agentV1Required
    ? {
        ok: true,
        required: false,
        owner: "local_rust_agentd",
      }
    : catalog.ok && typeof catalog.release_id === "string"
      ? await checkWorkerMcp(catalog.release_id)
      : {
          ok: false,
          error: "Cannot check worker MCP without an active catalog release",
        };
  const agentV1Daemon = agentV1Required
    ? await checkRustAgentDaemon()
    : { ok: true, required: false };
  const ok =
    supabase.ok &&
    catalog.ok &&
    mcp.ok &&
    trustedClientIp.ok &&
    filingWorker.ok &&
    (!agentV1Required || (agentV1.ok && agentV1Pricing.ok && agentV1Daemon.ok));

  return Response.json(
    {
      status: ok ? "ok" : "error",
      deployment_id: APP_VERSION,
      timestamp: new Date().toISOString(),
      checks: {
        web: { ok: true },
        supabase,
        catalog,
        mcp,
        filing_worker: filingWorker,
        agent_v1: agentV1,
        agent_v1_pricing: agentV1Pricing,
        agent_v1_daemon: agentV1Daemon,
        trusted_client_ip: trustedClientIp,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
