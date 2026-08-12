import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AgentV1DaemonHeartbeatRow } from "@/types/database";

type Provider = "glm" | "deepseek";

type ExpectedDaemonIdentity = {
  readonly provider: Provider;
  readonly descriptorArtifactHash: string;
  readonly releaseSetHash: string;
};

export type RustAgentDaemonAdmissionResult =
  | {
      ok: true;
      required: boolean;
      daemon: AgentV1DaemonHeartbeatRow | null;
    }
  | {
      ok: false;
      reason: "daemon_unavailable";
      message: string;
    };

/**
 * A Rust Agent V1 deployment is admitted only when the daemon itself has
 * recently written an exact provider/release receipt to the shared database.
 * The retired Claude/plugin worker and its MCP heartbeat are intentionally not
 * part of this path.
 */
export async function getReadyRustAgentDaemon(
  now = new Date(),
): Promise<RustAgentDaemonAdmissionResult> {
  if (!rustDaemonHeartbeatRequired()) {
    return { ok: true, required: false, daemon: null };
  }

  const identity = expectedRustDaemonIdentity();
  if (!identity) return unavailableRustDaemon();

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("agent_v1_daemon_heartbeats")
      .select(
        "daemon_id, provider, descriptor_artifact_hash, release_set_hash, runtime_version, last_seen_at, heartbeat_expires_at, created_at, updated_at",
      )
      .eq("provider", identity.provider)
      .eq("descriptor_artifact_hash", identity.descriptorArtifactHash)
      .eq("release_set_hash", identity.releaseSetHash)
      .gt("heartbeat_expires_at", now.toISOString())
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle<AgentV1DaemonHeartbeatRow>();

    if (error || !data || !isCurrentHeartbeat(data, now)) {
      return unavailableRustDaemon();
    }
    return { ok: true, required: true, daemon: data };
  } catch {
    // This guard is deliberately fail-closed. Do not enqueue work that no
    // confirmed local daemon can claim, and do not expose a database error to
    // a customer or external health probe.
    return unavailableRustDaemon();
  }
}

export function rustDaemonHeartbeatRequired(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const explicit = env.KRW_AGENT_DAEMON_HEARTBEAT_REQUIRED?.trim();
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  return env.KRW_AGENT_BACKEND_MODE === "rust" && (
    env.KRW_RUNTIME_ENVIRONMENT === "prod" || env.NODE_ENV === "production"
  );
}

function expectedRustDaemonIdentity(
  env: Record<string, string | undefined> = process.env,
): ExpectedDaemonIdentity | null {
  const provider = env.KRW_AGENT_PROVIDER?.trim();
  const descriptorArtifactHash = env.KRW_AGENT_RELEASE_ARTIFACT_HASH?.trim();
  const releaseSetHash = env.KRW_AGENT_RELEASE_SET_HASH?.trim();
  if (
    (provider !== "glm" && provider !== "deepseek") ||
    !isSha256Digest(descriptorArtifactHash) ||
    !isSha256Digest(releaseSetHash)
  ) {
    return null;
  }
  return { provider, descriptorArtifactHash, releaseSetHash };
}

function isCurrentHeartbeat(row: AgentV1DaemonHeartbeatRow, now: Date): boolean {
  const lastSeenAt = Date.parse(row.last_seen_at);
  const expiresAt = Date.parse(row.heartbeat_expires_at);
  return Number.isFinite(lastSeenAt)
    && Number.isFinite(expiresAt)
    && lastSeenAt <= now.getTime() + 5_000
    && expiresAt > now.getTime();
}

function unavailableRustDaemon(): RustAgentDaemonAdmissionResult {
  return {
    ok: false,
    reason: "daemon_unavailable",
    message: "Local Rust research daemon is unavailable",
  };
}

function isSha256Digest(value: string | undefined): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
