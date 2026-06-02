import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readIntEnv } from "@/lib/env";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import { closeOpenToolCallsForRuns } from "@/lib/agent/tool-call-cleanup";

const GLOBAL_CONCURRENT_LIMIT = readIntEnv("GLOBAL_CONCURRENT_RUN_LIMIT", 5, {
  min: 1,
});
const LEASE_TIMEOUT_MINUTES = readIntEnv("LEASE_TIMEOUT_MINUTES", 10, {
  min: 1,
});
const LEASE_HEARTBEAT_INTERVAL_MS =
  readIntEnv(
    "LEASE_HEARTBEAT_INTERVAL_MS",
    Math.min(
      60_000,
      Math.max(15_000, Math.floor((LEASE_TIMEOUT_MINUTES * 60_000) / 3)),
    ),
    { min: 1_000 },
  );
const LEASE_EXPIRED_MESSAGE =
  "분석 시간이 초과되었습니다. 다시 시도해주세요.";
const HARD_RUN_TIMEOUT_MINUTES = readIntEnv(
  "AGENT_RUN_HARD_TIMEOUT_MINUTES",
  6,
  { min: 1 },
);

export type LeaseResult =
  | { acquired: true; runId: string }
  | { acquired: false; reason: string; runId?: string };

export async function tryAcquireLease(
  sessionId: string,
  userMessageId: string,
  requestId: string,
  model: string,
  webCommit: string,
  krwOntologyCommit: string
): Promise<LeaseResult> {
  const now = new Date();
  const expiresAt = getLeaseExpiresAt(now);
  const admin = getSupabaseAdmin();

  const existingRun = await findRunByRequestId(admin, requestId);
  if (existingRun) {
    return {
      acquired: false,
      reason: "duplicate_request",
      runId: existingRun.id,
    };
  }

  await cleanupExpiredRuns(admin, now);

  // F-CR-02: Atomic conditional insert via RPC function.
  // Requires migration: supabase/migrations/20260511000001_atomic_lease_acquire.sql
  const { data, error } = await admin.rpc("try_acquire_lease", {
    p_session_id: sessionId,
    p_user_message_id: userMessageId,
    p_request_id: requestId,
    p_model: model,
    p_web_commit: webCommit,
    p_krw_ontology_commit: krwOntologyCommit,
    p_expires_at: expiresAt.toISOString(),
    p_global_limit: GLOBAL_CONCURRENT_LIMIT,
  });

  if (error || !data) {
    const existingAfterError = await findRunByRequestId(admin, requestId);
    if (existingAfterError) {
      return {
        acquired: false,
        reason: "duplicate_request",
        runId: existingAfterError.id,
      };
    }

    // RPC not deployed or failed. Fall back to the non-atomic path with the
    // same explicit active-session and global-concurrency guards.
    return tryAcquireLeaseFallback(
      admin,
      sessionId,
      userMessageId,
      requestId,
      model,
      webCommit,
      krwOntologyCommit,
      expiresAt
    );
  }

  if (Array.isArray(data) && data.length === 0) {
    const existingAfterDenial = await findRunByRequestId(admin, requestId);
    if (existingAfterDenial) {
      return {
        acquired: false,
        reason: "duplicate_request",
        runId: existingAfterDenial.id,
      };
    }

    return (
      (await resolveLeaseDenialReason(admin, sessionId, now)) ?? {
        acquired: false,
        reason: "internal_error",
      }
    );
  }

  const runId = Array.isArray(data) ? data[0].id : (data as { id: string }).id;

  // Create concurrency_lease record
  const { error: leaseError } = await admin
    .from("concurrency_leases")
    .insert({
      run_id: runId,
      expires_at: expiresAt.toISOString(),
    });

  if (leaseError) {
    await markAgentRunTerminal(admin, runId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorCode: "internal_error",
      errorMessage: "Failed to create concurrency lease",
    });
    return { acquired: false, reason: "internal_error" };
  }

  return { acquired: true, runId };
}

function getLeaseExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_TIMEOUT_MINUTES * 60 * 1000);
}

function getHardTimeoutCutoff(now = new Date()): Date {
  return new Date(now.getTime() - HARD_RUN_TIMEOUT_MINUTES * 60 * 1000);
}

async function findRunByRequestId(
  admin: ReturnType<typeof getSupabaseAdmin>,
  requestId: string,
): Promise<{ id: string } | null> {
  const { data } = await admin
    .from("agent_runs")
    .select("id")
    .eq("request_id", requestId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  return data ?? null;
}

async function cleanupExpiredRuns(
  admin: ReturnType<typeof getSupabaseAdmin>,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const hardTimeoutCutoffIso = getHardTimeoutCutoff(now).toISOString();
  const { data: leaseExpiredRuns } = await admin
    .from("agent_runs")
    .select("id, assistant_message_id")
    .eq("status", "running")
    .lt("lease_expires_at", nowIso)
    .returns<Array<{ id: string; assistant_message_id: string | null }>>();

  const { data: hardExpiredRuns } = await admin
    .from("agent_runs")
    .select("id, assistant_message_id")
    .eq("status", "running")
    .lt("started_at", hardTimeoutCutoffIso)
    .returns<Array<{ id: string; assistant_message_id: string | null }>>();

  const expiredRunsById = new Map<string, { id: string; assistant_message_id: string | null }>();
  for (const run of [...(leaseExpiredRuns ?? []), ...(hardExpiredRuns ?? [])]) {
    expiredRunsById.set(run.id, run);
  }
  const expiredRuns = Array.from(expiredRunsById.values());

  if (!expiredRuns || expiredRuns.length === 0) return;

  const runIds = expiredRuns.map((run) => run.id);
  const assistantMessageIds = expiredRuns
    .map((run) => run.assistant_message_id)
    .filter((id): id is string => Boolean(id));

  await Promise.all(
    expiredRuns.map((run) =>
      markAgentRunTerminal(admin, run.id, {
        status: "expired",
        finishedAt: nowIso,
        errorCode: "lease_expired",
        errorMessage: "Lease expired",
        openToolErrorMessage: "Lease expired before tool result was received",
      }),
    ),
  );

  await closeOpenToolCallsForRuns({
    admin,
    runIds,
    finishedAt: nowIso,
    errorMessage: "Lease expired before tool result was received",
  });

  if (assistantMessageIds.length > 0) {
    await admin
      .from("messages")
      .update({
        status: "failed",
        content: LEASE_EXPIRED_MESSAGE,
      })
      .in("id", assistantMessageIds);
  }

  await admin
    .from("concurrency_leases")
    .update({ released_at: nowIso })
    .in("run_id", runIds)
    .is("released_at", null);
}

async function tryAcquireLeaseFallback(
  admin: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  userMessageId: string,
  requestId: string,
  model: string,
  webCommit: string,
  krwOntologyCommit: string,
  expiresAt: Date
): Promise<LeaseResult> {
  const now = new Date();

  const existingRun = await findRunByRequestId(admin, requestId);
  if (existingRun) {
    return {
      acquired: false,
      reason: "duplicate_request",
      runId: existingRun.id,
    };
  }

  const denial = await resolveLeaseDenialReason(admin, sessionId, now);
  if (denial) {
    return denial;
  }

  // Atomic step 1: Try to claim a slot via conditional INSERT.
  // A partial unique index on (session_id) WHERE status IN ('pending','running')
  // would make this fully atomic. Without it, unique code 23505 catches conflicts.
  const { data: run, error: insertError } = await admin
    .from("agent_runs")
    .insert({
      session_id: sessionId,
      user_message_id: userMessageId,
      request_id: requestId,
      model,
      status: "running",
      lease_expires_at: expiresAt.toISOString(),
      started_at: now.toISOString(),
      web_commit: webCommit,
      krw_ontology_commit: krwOntologyCommit,
    })
    .select("id")
    .single();

  if (insertError || !run) {
    if (insertError?.code === "23505") {
      const existingAfterConflict = await findRunByRequestId(admin, requestId);
      if (existingAfterConflict) {
        return {
          acquired: false,
          reason: "duplicate_request",
          runId: existingAfterConflict.id,
        };
      }
      return { acquired: false, reason: "active_run_exists" };
    }
    return { acquired: false, reason: "internal_error" };
  }

  // Atomic step 2: Check global concurrency AFTER inserting — if over limit, roll back.
  // This accepts a brief over-count but avoids the SELECT-then-INSERT race window.
  const { count: activeRunCount } = await admin
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .in("status", ["running"])
    .gt("lease_expires_at", now.toISOString());

  if ((activeRunCount ?? 0) > GLOBAL_CONCURRENT_LIMIT) {
    await markAgentRunTerminal(admin, run.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorCode: "concurrency_limit",
      errorMessage: "Global concurrency limit exceeded",
    });
    return { acquired: false, reason: "concurrency_limit" };
  }

  // Create concurrency_lease
  const { error: leaseError } = await admin
    .from("concurrency_leases")
    .insert({
      run_id: run.id,
      expires_at: expiresAt.toISOString(),
    });

  if (leaseError) {
    await markAgentRunTerminal(admin, run.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorCode: "internal_error",
      errorMessage: "Failed to create concurrency lease",
    });
    return { acquired: false, reason: "internal_error" };
  }

  return { acquired: true, runId: run.id };
}

async function resolveLeaseDenialReason(
  admin: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  now = new Date(),
): Promise<LeaseResult | null> {
  const nowIso = now.toISOString();
  const { count: activeSessionRunCount, error: activeSessionError } = await admin
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .in("status", ["pending", "running"]);

  if (activeSessionError) {
    return { acquired: false, reason: "internal_error" };
  }

  if ((activeSessionRunCount ?? 0) > 0) {
    return { acquired: false, reason: "active_run_exists" };
  }

  const { count: activeRunCount, error: activeRunError } = await admin
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "running")
    .gt("lease_expires_at", nowIso);

  if (activeRunError) {
    return { acquired: false, reason: "internal_error" };
  }

  if ((activeRunCount ?? 0) >= GLOBAL_CONCURRENT_LIMIT) {
    return { acquired: false, reason: "concurrency_limit" };
  }

  return null;
}

export async function releaseLease(runId: string) {
  const admin = getSupabaseAdmin();

  // Idempotent: only updates if not already released
  await admin
    .from("concurrency_leases")
    .update({ released_at: new Date().toISOString() })
    .eq("run_id", runId)
    .is("released_at", null);

  await admin
    .from("agent_runs")
    .update({ lease_expires_at: null })
    .eq("id", runId);
}

export async function extendLease(runId: string) {
  const admin = getSupabaseAdmin();
  const expiresAt = getLeaseExpiresAt().toISOString();

  await admin
    .from("agent_runs")
    .update({ lease_expires_at: expiresAt })
    .eq("id", runId)
    .eq("status", "running");

  await admin
    .from("concurrency_leases")
    .update({ expires_at: expiresAt })
    .eq("run_id", runId)
    .is("released_at", null);
}

export function startLeaseHeartbeat(runId: string): () => void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    extendLease(runId)
      .catch((error) => {
        console.warn("[lease-heartbeat] failed to extend lease", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight = false;
      });
  }, LEASE_HEARTBEAT_INTERVAL_MS);

  const maybeNodeTimer = timer as { unref?: () => void };
  maybeNodeTimer.unref?.();

  return () => clearInterval(timer);
}
