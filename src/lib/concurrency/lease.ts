import { getSupabaseAdmin } from "@/lib/supabase/admin";

const GLOBAL_CONCURRENT_LIMIT = parseInt(
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT || "5",
  10
);
const LEASE_TIMEOUT_MINUTES = parseInt(
  process.env.LEASE_TIMEOUT_MINUTES || "5",
  10
);

export type LeaseResult =
  | { acquired: true; runId: string }
  | { acquired: false; reason: string };

export async function tryAcquireLease(
  sessionId: string,
  userMessageId: string,
  requestId: string,
  model: string,
  webCommit: string,
  krwOntologyCommit: string
): Promise<LeaseResult> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + LEASE_TIMEOUT_MINUTES * 60 * 1000
  );
  const admin = getSupabaseAdmin();

  // F-ME-04: Clean up expired leases first (handles crash recovery)
  await admin
    .from("agent_runs")
    .update({
      status: "failed",
      error_code: "lease_expired",
      error_message: "Lease expired",
      finished_at: now.toISOString(),
    })
    .eq("status", "running")
    .lt("lease_expires_at", now.toISOString());

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

  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    // RPC not deployed or no row returned (lease denied).
    // Fall back to the non-atomic check+insert with expired-lease cleanup above.
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

  const runId = Array.isArray(data) ? data[0].id : (data as { id: string }).id;

  // Create concurrency_lease record
  const { error: leaseError } = await admin
    .from("concurrency_leases")
    .insert({
      run_id: runId,
      expires_at: expiresAt.toISOString(),
    });

  if (leaseError) {
    await admin
      .from("agent_runs")
      .update({ status: "failed", error_code: "internal_error" })
      .eq("id", runId);
    return { acquired: false, reason: "internal_error" };
  }

  return { acquired: true, runId };
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
    await admin
      .from("agent_runs")
      .update({ status: "failed", error_code: "concurrency_limit" })
      .eq("id", run.id);
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
    await admin
      .from("agent_runs")
      .update({ status: "failed", error_code: "internal_error" })
      .eq("id", run.id);
    return { acquired: false, reason: "internal_error" };
  }

  return { acquired: true, runId: run.id };
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
