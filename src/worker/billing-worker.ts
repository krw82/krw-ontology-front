import { randomUUID } from "node:crypto";
import { renewDueTossSubscriptions } from "@/lib/billing/toss-subscriptions";
import {
  isTossPaymentsConfigured,
  isTossPaymentsLiveConfigured,
} from "@/lib/billing/toss";
import { readIntEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const WORKER_ID =
  process.env.BILLING_WORKER_ID || `billing-worker-${randomUUID()}`;
const RECONCILE_INTERVAL_MS = readIntEnv(
  "BILLING_WORKER_RECONCILE_INTERVAL_MS",
  60_000,
  { min: 10_000 },
);
const REQUIRE_TOSS_PAYMENTS =
  process.env.BILLING_WORKER_REQUIRE_TOSS_PAYMENTS !== "0";
const ALLOW_TOSS_TEST_KEYS =
  process.env.BILLING_WORKER_ALLOW_TOSS_TEST_KEYS === "1";

function assertTossPaymentsReady() {
  if (!REQUIRE_TOSS_PAYMENTS) return;
  if (isTossPaymentsLiveConfigured()) return;
  if (ALLOW_TOSS_TEST_KEYS && isTossPaymentsConfigured()) return;

  throw new Error(
    "Toss Payments live keys are required for billing-worker. Set TOSS_PAYMENTS_CLIENT_KEY=live_ck_... and TOSS_PAYMENTS_SECRET_KEY=live_sk_..., or set BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=0 only for an intentional non-launch deploy.",
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    function stop() {
      clearTimeout(timeout);
      resolve();
    }
    function finish() {
      signal.removeEventListener("abort", stop);
      resolve();
    }
    const timeout = setTimeout(finish, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function expireStaleCreditReservations(): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "expire_stale_analysis_credit_reservations",
    { p_now: new Date().toISOString() },
  );
  if (error) {
    throw new Error(`credit reservation expiry failed: ${error.message}`);
  }
  return Number(data ?? 0);
}

async function reconcileExpiredCoverageLimits(): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "sweep_expired_company_coverage_limits",
    { p_now: new Date().toISOString(), p_limit: 250 },
  );
  if (error) {
    throw new Error(`coverage expiry reconciliation failed: ${error.message}`);
  }
  return Number(data ?? 0);
}

async function reconcileOnce() {
  const expiredReservations = await expireStaleCreditReservations();
  const renewals = await renewDueTossSubscriptions({ workerId: WORKER_ID });
  // A due paid subscription must get its renewal/grace transition first. Only
  // then may the entitlement expiry sweep archive over-limit coverage.
  const reconciledCoverageUsers = await reconcileExpiredCoverageLimits();
  if (
    expiredReservations > 0 ||
    reconciledCoverageUsers > 0 ||
    renewals.checked > 0 ||
    renewals.expired > 0
  ) {
    console.info("[billing-worker] reconciled", {
      workerId: WORKER_ID,
      expiredReservations,
      reconciledCoverageUsers,
      ...renewals,
    });
  }
}

async function main() {
  assertTossPaymentsReady();

  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.info("[billing-worker] started", {
    workerId: WORKER_ID,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
  });

  while (!abortController.signal.aborted) {
    try {
      await reconcileOnce();
    } catch (error) {
      console.warn("[billing-worker] reconcile failed", {
        workerId: WORKER_ID,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      });
    }
    await sleep(RECONCILE_INTERVAL_MS, abortController.signal);
  }

  console.info("[billing-worker] stopped", { workerId: WORKER_ID });
}

main().catch((error) => {
  console.error("[billing-worker] fatal", {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exit(1);
});
