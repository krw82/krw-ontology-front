import { classifyFiling, filingAlertPriority } from "@/lib/filing-notifications/classification";
import {
  filingDecisionContextCopy,
  filingDecisionDestinationPath,
  filingNotificationCopy,
} from "@/lib/filing-notifications/contract";
import {
  EMPTY_FILING_DECISION_NOTIFICATION_CONTEXT,
  loadFilingDecisionNotificationContexts,
} from "@/lib/filing-notifications/decision-context";
import { dailyMasterIndexUrl, parseSecDailyMasterIndex } from "@/lib/filing-notifications/sec-daily-index";
import { isSecXslRenderedDocumentUrl, parseFilingIndexDocuments } from "@/lib/filing-notifications/sec-filing-index";
import { parseSecAtomCurrentFeed, formTypeFromAtomSourceKey } from "@/lib/filing-notifications/sec-atom";
import { parseSecForm4 } from "@/lib/filing-notifications/sec-form4";
import { fetchSecAtom, fetchSecJson, fetchSecText, SecRequestError } from "@/lib/filing-notifications/sec-client";
import { reserveSecRequestSlot } from "@/lib/filing-notifications/sec-request-limiter";
import {
  isFilingCandidateWithinLookback,
  parseRecentFilingCandidates,
  type SecFilingCandidate,
  type SecSubmissionsRecent,
} from "@/lib/filing-notifications/sec-edgar";
import { isFilingInboxEligible, shouldQueueImmediateFilingPush } from "@/lib/filing-notifications/notification-policy";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  FilingNotificationPreferencesRow,
  Json,
  SecFilingDiscoveryCheckpointRow,
  SecFilingEventRow,
  SecFilingFormType,
  SecForm4EventSummaryRow,
  UserFilingNotificationRow,
  UserFilingSubscriptionRow,
} from "@/types/database";

type CatalogTarget = { cik: string; release_id: string };
type DiscoveryCheckpoint = {
  env: "dev" | "staging" | "prod";
  source_key: SecFilingDiscoveryCheckpointRow["source_key"];
  watermark_at: string | null;
  watermark_accession: string | null;
  claim_token: string;
};
type ReconciliationClaim = {
  env: "dev" | "staging" | "prod";
  cik: string;
  release_id: string;
  coverage_started_at: string;
  baseline_completed_at: string | null;
  claim_token: string;
};
type ProcessingClaim = {
  id: string;
  filing_event_id: string;
  stage: "enrich" | "notification_fanout";
  claim_token: string;
};
type FilingDiscoveryCandidate = {
  env: GlobalFilingPipelineOptions["env"];
  releaseId: string;
  candidate: SecFilingCandidate;
  discoverySource: "atom" | "submissions" | "daily_index";
  sourceMetadata: Json;
};
type FilingDiscoveryMetrics = {
  candidates: number;
  rpcCalls: number;
};

const FILING_DISCOVERY_BATCH_SIZE = 100;

export type GlobalFilingPipelineOptions = {
  env: "dev" | "staging" | "prod";
  deploymentId: string;
  workerId: string;
  detectionEnabled: boolean;
  notificationCreationEnabled: boolean;
  secMinRequestIntervalMs: number;
  discoverySourcesPerCycle: number;
  schedulerLeaseSeconds: number;
  reconciliationBatchSize: number;
  enrichmentBatchSize: number;
  notificationBatchSize: number;
  catalogLookbackDays: number;
  baselineCleanupBatchSize: number;
};

export type GlobalFilingPipelineResult = {
  discovered: number;
  discoveryCandidates: number;
  discoveryRpcCalls: number;
  enriched: number;
  notificationsCreated: number;
  schedulerLeader: boolean;
};

/**
 * One worker lease protects the global SEC request budget across local and VM
 * deployments. All functions below are deterministic metadata operations; the
 * pipeline deliberately has no LLM, document ingest, or agent-run dependency.
 */
export async function runGlobalFilingPipeline(
  options: GlobalFilingPipelineOptions,
): Promise<GlobalFilingPipelineResult> {
  const scheduler = new SecRequestScheduler(options.secMinRequestIntervalMs);
  const leader = options.detectionEnabled
    ? await claimSchedulerLeader(options)
    : false;
  const discoveryMetrics: FilingDiscoveryMetrics = { candidates: 0, rpcCalls: 0 };
  let discovered = 0;

  if (leader) {
    await pruneStaleCatalogBaseline(options);
    await ensureCatalogTargets(options.env);
    const { error: subscriptionSyncError } = await getSupabaseAdmin().rpc(
      "sync_catalog_filing_subscription_status",
      { p_env: options.env },
    );
    if (subscriptionSyncError) {
      throw new Error(
        `Failed to synchronize catalog filing subscriptions: ${subscriptionSyncError.message}`,
      );
    }
    // There are six Atom form feeds plus the daily index checkpoint. Claiming
    // two due sources per 15s worker tick keeps each Atom source near the
    // intended 60-second cadence without exceeding SEC's request budget.
    for (let sourceIndex = 0; sourceIndex < options.discoverySourcesPerCycle; sourceIndex += 1) {
      discovered += await pollOneCurrentFeed(options, scheduler, discoveryMetrics);
    }
    discovered += await reconcileCatalogCiks(options, scheduler, discoveryMetrics);
  }

  // Processing stays live even when discovery is paused. This lets an operator
  // stop incoming SEC traffic without leaving already-recorded events stuck.
  const enriched = await processEnrichmentJobs(options, scheduler);
  const notificationsCreated = options.notificationCreationEnabled
    ? await processNotificationFanoutJobs(options)
    : 0;
  return {
    discovered,
    discoveryCandidates: discoveryMetrics.candidates,
    discoveryRpcCalls: discoveryMetrics.rpcCalls,
    enriched,
    notificationsCreated,
    schedulerLeader: leader,
  };
}

async function claimSchedulerLeader(options: GlobalFilingPipelineOptions): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("claim_sec_filing_scheduler_leader", {
    p_env: options.env,
    p_deployment_id: options.deploymentId,
    p_worker_id: options.workerId,
    p_lease_seconds: options.schedulerLeaseSeconds,
  });
  if (error) throw new Error(`Failed to claim SEC scheduler lease: ${error.message}`);
  return Boolean(data?.length);
}

async function ensureCatalogTargets(env: GlobalFilingPipelineOptions["env"]): Promise<void> {
  const admin = getSupabaseAdmin();
  const [sources, targets] = await Promise.all([
    admin.rpc("ensure_sec_filing_discovery_sources", { p_env: env }),
    admin.rpc("sync_catalog_sec_filing_reconciliation_targets", { p_env: env }),
  ]);
  if (sources.error) throw new Error(`Failed to initialize SEC Atom checkpoints: ${sources.error.message}`);
  if (targets.error) throw new Error(`Failed to synchronize SEC reconciliation targets: ${targets.error.message}`);
}

async function loadActiveTargets(env: GlobalFilingPipelineOptions["env"]): Promise<Map<string, string>> {
  const { data, error } = await getSupabaseAdmin().rpc("get_active_catalog_sec_targets", { p_env: env });
  if (error) throw new Error(`Failed to load active catalog SEC targets: ${error.message}`);
  return new Map((data as CatalogTarget[] | null ?? []).map((target) => [target.cik, target.release_id]));
}

async function pollOneCurrentFeed(
  options: GlobalFilingPipelineOptions,
  scheduler: SecRequestScheduler,
  discoveryMetrics: FilingDiscoveryMetrics,
): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("claim_sec_filing_discovery_checkpoint", {
    p_env: options.env,
    p_worker_id: options.workerId,
    p_lease_seconds: 120,
  });
  if (error) throw new Error(`Failed to claim SEC Atom checkpoint: ${error.message}`);
  const checkpoint = (data?.[0] ?? null) as DiscoveryCheckpoint | null;
  if (!checkpoint) return 0;
  if (checkpoint.source_key === "daily_index:master") {
    return auditDailyMasterIndex(options, scheduler, checkpoint, discoveryMetrics);
  }
  const formType = formTypeFromAtomSourceKey(checkpoint.source_key);
  if (!formType) {
    await failCheckpoint(options, checkpoint, new Error("Unsupported Atom source key"));
    return 0;
  }

  try {
    const targets = await loadActiveTargets(options.env);
    const url = atomCurrentFeedUrl(formType);
    const xml = await scheduler.run(() => fetchSecAtom(url));
    const cutoff = catalogLookbackCutoff(options);
    const candidates = parseSecAtomCurrentFeed(xml, formType)
      .filter((candidate) => targets.has(candidate.cik))
      .filter((candidate) => isFilingCandidateWithinLookback(candidate, cutoff));
    const baselineCompletedCiks = await loadBaselineCompletedCiks(
      options.env,
      candidates.map((candidate) => candidate.cik),
    );
    const discovered = await recordCandidates(candidates.flatMap((candidate) => {
      const releaseId = targets.get(candidate.cik);
      if (!releaseId) return [];
      return [{
        env: options.env,
        releaseId,
        candidate,
        discoverySource: "atom",
        // On first deployment Atom can still contain filings from before the
        // catalog reconciliation baseline. Keep those cards in Pulse, but do
        // not turn them into personal alerts.
        sourceMetadata: {
          ...candidate.sourceMetadata,
          discoveryBaseline: !baselineCompletedCiks.has(candidate.cik),
        },
      } satisfies FilingDiscoveryCandidate];
    }), discoveryMetrics);
    const newest = candidates[0] ?? null;
    const { error: completeError } = await admin.rpc("complete_sec_filing_discovery_checkpoint", {
      p_env: options.env,
      p_source_key: checkpoint.source_key,
      p_worker_id: options.workerId,
      p_claim_token: checkpoint.claim_token,
      p_watermark_at: newest?.acceptedAt ?? null,
      p_watermark_accession: newest?.accessionNumber ?? null,
      p_next_poll_seconds: 60,
    });
    if (completeError) throw new Error(`Failed to complete SEC Atom checkpoint: ${completeError.message}`);
    return discovered;
  } catch (error) {
    await failCheckpoint(options, checkpoint, error);
    throw error;
  }
}

async function auditDailyMasterIndex(
  options: GlobalFilingPipelineOptions,
  scheduler: SecRequestScheduler,
  checkpoint: DiscoveryCheckpoint,
  discoveryMetrics: FilingDiscoveryMetrics,
): Promise<number> {
  const admin = getSupabaseAdmin();
  try {
    const targets = await loadActiveTargets(options.env);
    const yesterday = utcDayBefore(new Date());
    const start = checkpoint.watermark_at
      ? utcDayAfter(new Date(checkpoint.watermark_at))
      : yesterday;
    let day = start;
    let discovered = 0;
    let newestAudited: Date | null = null;
    while (day.getTime() <= yesterday.getTime()) {
      if (isWeekendUtc(day)) {
        newestAudited = day;
        day = utcDayAfter(day);
        continue;
      }
      let indexText: string;
      try {
        indexText = await scheduler.run(() => fetchSecText(dailyMasterIndexUrl(day)));
      } catch (error) {
        // SEC does not publish a master index on US market holidays. A 404 on
        // this independent recovery source is therefore a completed empty day;
        // all other failures retain the checkpoint lease and back off.
        if (!(error instanceof SecRequestError) || error.status !== 404) throw error;
        newestAudited = day;
        day = utcDayAfter(day);
        continue;
      }
      const candidates = parseSecDailyMasterIndex(indexText).filter((candidate) => targets.has(candidate.cik));
      const baselineCompletedCiks = await loadBaselineCompletedCiks(
        options.env,
        candidates.map((candidate) => candidate.cik),
      );
      discovered += await recordCandidates(candidates.flatMap((candidate) => {
        const releaseId = targets.get(candidate.cik);
        if (!releaseId) return [];
        return [{
          env: options.env,
          releaseId,
          candidate,
          discoverySource: "daily_index",
          sourceMetadata: {
            ...candidate.sourceMetadata,
            dailyIndexDate: utcDateKey(day),
            discoveryBaseline: !baselineCompletedCiks.has(candidate.cik),
          },
        } satisfies FilingDiscoveryCandidate];
      }), discoveryMetrics);
      newestAudited = day;
      day = utcDayAfter(day);
    }
    const { error: completeError } = await admin.rpc("complete_sec_filing_discovery_checkpoint", {
      p_env: options.env,
      p_source_key: checkpoint.source_key,
      p_worker_id: options.workerId,
      p_claim_token: checkpoint.claim_token,
      p_watermark_at: newestAudited?.toISOString() ?? checkpoint.watermark_at,
      p_watermark_accession: null,
      p_next_poll_seconds: 24 * 60 * 60,
    });
    if (completeError) throw new Error(`Failed to complete SEC daily-index audit: ${completeError.message}`);
    return discovered;
  } catch (error) {
    await failCheckpoint(options, checkpoint, error);
    throw error;
  }
}

async function reconcileCatalogCiks(
  options: GlobalFilingPipelineOptions,
  scheduler: SecRequestScheduler,
  discoveryMetrics: FilingDiscoveryMetrics,
): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("claim_catalog_sec_filing_reconciliation_targets", {
    p_env: options.env,
    p_worker_id: options.workerId,
    p_limit: options.reconciliationBatchSize,
    p_lease_seconds: 180,
  });
  if (error) throw new Error(`Failed to claim SEC submissions reconciliation targets: ${error.message}`);
  let discovered = 0;
  for (const claim of (data ?? []) as ReconciliationClaim[]) {
    try {
      const payload = await scheduler.run(() => fetchSecJson<{ filings?: { recent?: unknown } }>(
        `https://data.sec.gov/submissions/CIK${claim.cik}.json`,
      ));
      const candidates = parseRecentFilingCandidates(
        claim.cik,
        payload.filings?.recent as SecSubmissionsRecent | undefined,
      ).filter((candidate) => isFilingCandidateWithinLookback(candidate, catalogLookbackCutoff(options)));
      discovered += await recordCandidates(candidates.map((candidate) => (
        {
          env: options.env,
          releaseId: claim.release_id,
          candidate,
          discoverySource: "submissions",
          sourceMetadata: {
            ...candidate.sourceMetadata,
            discoveryBaseline: !claim.baseline_completed_at,
          },
        } satisfies FilingDiscoveryCandidate
      )), discoveryMetrics);
      const { error: completeError } = await admin.rpc("complete_catalog_sec_filing_reconciliation", {
        p_env: options.env,
        p_cik: claim.cik,
        p_worker_id: options.workerId,
        p_claim_token: claim.claim_token,
        p_baseline_completed: true,
        p_next_poll_seconds: 15 * 60,
      });
      if (completeError) throw new Error(`Failed to complete SEC submissions reconciliation: ${completeError.message}`);
    } catch (error) {
      await failReconciliation(options, claim, error);
      console.error("[filing-notification-worker] SEC submissions reconciliation failed", {
        cik: claim.cik,
        error: errorMessage(error),
      });
    }
  }
  return discovered;
}

async function recordCandidates(
  candidates: FilingDiscoveryCandidate[],
  metrics: FilingDiscoveryMetrics,
): Promise<number> {
  let discovered = 0;
  const seenAt = new Date().toISOString();
  const admin = getSupabaseAdmin();
  metrics.candidates += candidates.length;

  for (let index = 0; index < candidates.length; index += FILING_DISCOVERY_BATCH_SIZE) {
    const batch = candidates.slice(index, index + FILING_DISCOVERY_BATCH_SIZE);
    metrics.rpcCalls += 1;
    const { data, error } = await admin.rpc("record_catalog_sec_filing_discoveries", {
      p_candidates: batch.map((params) => ({
        env: params.env,
        release_id: params.releaseId,
        cik: params.candidate.cik,
        accession_number: params.candidate.accessionNumber,
        form_type: params.candidate.formType,
        filing_date: params.candidate.filingDate,
        report_date: params.candidate.reportDate,
        accepted_at: params.candidate.acceptedAt,
        primary_document_name: params.candidate.primaryDocumentName,
        filing_detail_url: params.candidate.filingDetailUrl,
        primary_document_url: params.candidate.primaryDocumentUrl,
        source_metadata: params.sourceMetadata,
        discovery_source: params.discoverySource,
        seen_at: seenAt,
      })),
    });
    if (error) throw new Error(`Failed to record SEC filing discovery batch: ${error.message}`);
    discovered += (data ?? []).filter((result) => result.inserted).length;
  }

  return discovered;
}

function catalogLookbackCutoff(options: GlobalFilingPipelineOptions): Date {
  return new Date(Date.now() - options.catalogLookbackDays * 24 * 60 * 60 * 1000);
}

async function pruneStaleCatalogBaseline(options: GlobalFilingPipelineOptions): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("prune_catalog_sec_baseline_backfill", {
    p_env: options.env,
    p_before_occurred_at: catalogLookbackCutoff(options).toISOString(),
    p_limit: options.baselineCleanupBatchSize,
  });
  if (error) throw new Error(`Failed to prune stale SEC baseline backfill: ${error.message}`);
}

async function loadBaselineCompletedCiks(
  env: GlobalFilingPipelineOptions["env"],
  ciks: string[],
): Promise<Set<string>> {
  const uniqueCiks = [...new Set(ciks)];
  if (!uniqueCiks.length) return new Set();
  const { data, error } = await getSupabaseAdmin()
    .from("sec_catalog_filing_reconciliation_state")
    .select("cik, baseline_completed_at")
    .eq("env", env)
    .in("cik", uniqueCiks);
  if (error) throw new Error(`Failed to load SEC reconciliation baseline state: ${error.message}`);
  return new Set(
    (data ?? [])
      .filter((state) => Boolean(state.baseline_completed_at))
      .map((state) => state.cik),
  );
}

async function processEnrichmentJobs(
  options: GlobalFilingPipelineOptions,
  scheduler: SecRequestScheduler,
): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("claim_sec_filing_processing_jobs", {
    p_env: options.env,
    p_worker_id: options.workerId,
    p_stage: "enrich",
    p_limit: options.enrichmentBatchSize,
    p_lease_seconds: 240,
  });
  if (error) throw new Error(`Failed to claim SEC enrichment jobs: ${error.message}`);
  let completed = 0;
  for (const job of (data ?? []) as ProcessingClaim[]) {
    try {
      await enrichEvent(job, scheduler);
      completed += 1;
    } catch (error) {
      await failProcessingJob(job, error);
      console.error("[filing-notification-worker] SEC enrichment failed", {
        filingEventId: job.filing_event_id,
        error: errorMessage(error),
      });
    }
  }
  return completed;
}

async function enrichEvent(job: ProcessingClaim, scheduler: SecRequestScheduler): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: event, error } = await admin
    .from("sec_filing_events")
    .select("*")
    .eq("id", job.filing_event_id)
    .single<SecFilingEventRow>();
  if (error || !event) throw new Error(`Failed to load filing event: ${error?.message ?? "missing"}`);

  const indexHtml = await scheduler.run(() => fetchSecText(event.filing_detail_url));
  const documents = parseFilingIndexDocuments({
    html: indexHtml,
    filingDetailUrl: event.filing_detail_url,
    primaryDocumentName: event.primary_document_name,
  });
  const secItems = sourceSecItems(event.source_metadata);
  const classification = classifyFiling({
    formType: event.form_type,
    secItems,
    primaryDocDescription: sourceDescription(event.source_metadata),
  });
  let eventTags = classification.eventTags;
  let primaryEventTag = classification.primaryEventTag;
  let classificationSource = classification.source;
  let alertPriority = filingAlertPriority(classification.primaryEventTag, secItems);
  let form4Owners: Json[] = [];
  let form4Transactions: Json[] = [];
  let form4Summary: Json = {};

  if (event.form_type === "4" || event.form_type === "4/A") {
    const xmlUrl = findForm4XmlUrl(event, documents.map((document) => ({
      documentUrl: document.documentUrl,
      documentType: document.documentType,
      documentName: document.documentName,
      isPrimary: document.isPrimary,
    })));
    if (!xmlUrl) throw new Error("SEC Form 4 ownership XML was not found in filing index");
    const parsed = parseSecForm4(await scheduler.run(() => fetchSecText(xmlUrl)));
    form4Owners = parsed.owners.map(toJson);
    form4Transactions = parsed.transactions.map(toJson);
    form4Summary = toJson(parsed.summary);
    eventTags = ["insider_trade"];
    primaryEventTag = "insider_trade";
    classificationSource = "metadata";
    alertPriority = parsed.summary.has_reported_open_market_trade ? "normal" : "digest";
  }

  const { data: completed, error: completeError } = await admin.rpc("complete_sec_filing_enrichment", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_sec_items: secItems,
    p_event_tags: eventTags,
    p_primary_event_tag: primaryEventTag,
    p_classification_source: classificationSource,
    p_alert_priority: alertPriority,
    p_documents: documents.map((document) => ({
      sequence: document.sequence,
      document_name: document.documentName,
      document_type: document.documentType,
      description: document.description,
      document_url: document.documentUrl,
      size_bytes: document.sizeBytes,
      is_primary: document.isPrimary,
      recommendation_score: document.recommendationScore,
    })),
    p_form4_owners: form4Owners,
    p_form4_transactions: form4Transactions,
    p_form4_summary: form4Summary,
    p_parser_version: 1,
  });
  if (completeError || !completed) {
    throw new Error(`Failed to complete SEC enrichment: ${completeError?.message ?? "lease lost"}`);
  }
}

async function processNotificationFanoutJobs(options: GlobalFilingPipelineOptions): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("claim_sec_filing_processing_jobs", {
    p_env: options.env,
    p_worker_id: options.workerId,
    p_stage: "notification_fanout",
    p_limit: options.notificationBatchSize,
    p_lease_seconds: 180,
  });
  if (error) throw new Error(`Failed to claim SEC notification fanout jobs: ${error.message}`);
  let created = 0;
  for (const job of (data ?? []) as ProcessingClaim[]) {
    try {
      created += await fanoutEventNotifications(options, job);
    } catch (error) {
      await failProcessingJob(job, error);
      console.error("[filing-notification-worker] SEC notification fanout failed", {
        filingEventId: job.filing_event_id,
        error: errorMessage(error),
      });
    }
  }
  return created;
}

async function fanoutEventNotifications(
  options: GlobalFilingPipelineOptions,
  job: ProcessingClaim,
): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data: event, error: eventError } = await admin
    .from("sec_filing_events")
    .select("*")
    .eq("id", job.filing_event_id)
    .single<SecFilingEventRow>();
  if (eventError || !event) throw new Error(`Failed to load fanout filing event: ${eventError?.message ?? "missing"}`);

  // Initial submissions backfill is for coverage only; it must never announce
  // historical filings as though they had just arrived.
  if (sourceBoolean(event.source_metadata, "discoveryBaseline")) {
    await completeFanout(job, 0, true);
    return 0;
  }
  const { data: subscriptions, error: subscriptionError } = await admin
    .from("user_filing_subscriptions")
    .select("*")
    .eq("env", options.env)
    .eq("cik", event.cik)
    .eq("enabled", true)
    .eq("catalog_collection_status", "active")
    .returns<UserFilingSubscriptionRow[]>();
  if (subscriptionError) throw new Error(`Failed to load catalog filing subscriptions: ${subscriptionError.message}`);
  if (!subscriptions?.length) {
    await completeFanout(job, 0, false);
    return 0;
  }
  const byUser = oneSubscriptionPerUser(subscriptions);
  const userIds = [...byUser.keys()];
  const { data: preferences, error: preferenceError } = await admin
    .from("filing_notification_preferences")
    .select("*")
    .in("user_id", userIds)
    .returns<FilingNotificationPreferencesRow[]>();
  if (preferenceError) throw new Error(`Failed to load filing notification preferences: ${preferenceError.message}`);
  const preferencesByUser = new Map((preferences ?? []).map((preference) => [preference.user_id, preference]));
  const form4Summary = event.form_type.startsWith("4")
    ? await loadForm4Summary(event.id)
    : null;
  const decisionContextsByUser = await loadFilingDecisionNotificationContexts(
    event,
    byUser,
  );
  const notificationsToInsert = [...byUser.values()]
    .filter((subscription) => shouldCreateNotification({
      event,
      subscription,
      preference: preferencesByUser.get(subscription.user_id),
      form4Summary,
    }))
    .map((subscription) => {
      const decisionContext = decisionContextsByUser.get(subscription.user_id)
        ?? EMPTY_FILING_DECISION_NOTIFICATION_CONTEXT;
      const copy = filingDecisionContextCopy(
        filingNotificationCopy({
          ticker: subscription.ticker,
          formType: event.form_type,
          isAmendment: event.is_amendment,
          primaryEventTag: event.primary_event_tag,
        }),
        decisionContext,
      );
      return {
        user_id: subscription.user_id,
        filing_event_id: event.id,
        kind: "filing_received" as const,
        title: copy.title,
        body: copy.body,
        destination_path: filingDecisionDestinationPath(event.id, decisionContext),
      };
    });
  if (!notificationsToInsert.length) {
    await completeFanout(job, 0, false);
    return 0;
  }
  const { data: notifications, error: notificationError } = await admin
    .from("user_filing_notifications")
    .upsert(notificationsToInsert, {
      onConflict: "user_id,filing_event_id,kind,digest_bucket",
      ignoreDuplicates: true,
    })
    .select("*")
    .returns<UserFilingNotificationRow[]>();
  if (notificationError) throw new Error(`Failed to create filing notifications: ${notificationError.message}`);

  await queueImmediatePushDeliveries(event, notifications ?? [], preferencesByUser);
  await completeFanout(job, notifications?.length ?? 0, false);
  return notifications?.length ?? 0;
}

function shouldCreateNotification(params: {
  event: SecFilingEventRow;
  subscription: UserFilingSubscriptionRow;
  preference: FilingNotificationPreferencesRow | undefined;
  form4Summary: SecForm4EventSummaryRow | null;
}): boolean {
  if (params.event.form_type === "4" || params.event.form_type === "4/A") {
    const preference = params.preference;
    if (!preference) return true;
    if (!preference.enabled || !preference.notify_form4 || preference.insider_notification_mode === "none") return false;
    return preference.insider_notification_mode === "all"
      || Boolean(params.form4Summary?.has_reported_open_market_trade);
  }
  return isFilingInboxEligible({
    formType: params.event.form_type,
    isAmendment: params.event.is_amendment,
    acceptedAt: params.event.accepted_at,
    firstSeenAt: params.event.first_seen_at,
    subscribedAt: params.subscription.subscribed_at,
    baselineCompletedAt: params.event.first_seen_at,
    preference: params.preference,
  });
}

async function loadForm4Summary(filingEventId: string): Promise<SecForm4EventSummaryRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("sec_form4_event_summaries")
    .select("*")
    .eq("filing_event_id", filingEventId)
    .maybeSingle<SecForm4EventSummaryRow>();
  if (error) throw new Error(`Failed to load Form 4 summary: ${error.message}`);
  return data;
}

function oneSubscriptionPerUser(subscriptions: UserFilingSubscriptionRow[]): Map<string, UserFilingSubscriptionRow> {
  const byUser = new Map<string, UserFilingSubscriptionRow>();
  for (const subscription of subscriptions) {
    const existing = byUser.get(subscription.user_id);
    if (!existing || subscription.ticker.localeCompare(existing.ticker) < 0) byUser.set(subscription.user_id, subscription);
  }
  return byUser;
}

async function queueImmediatePushDeliveries(
  event: SecFilingEventRow,
  notifications: UserFilingNotificationRow[],
  preferencesByUser: Map<string, FilingNotificationPreferencesRow>,
): Promise<void> {
  if (!notifications.length) return;
  const admin = getSupabaseAdmin();
  const immediate = notifications.filter((notification) => shouldQueueImmediateFilingPush({
    isAmendment: event.is_amendment,
    priority: event.alert_priority,
    preference: preferencesByUser.get(notification.user_id),
  }));
  if (!immediate.length) return;
  const userIds = [...new Set(immediate.map((notification) => notification.user_id))];
  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id")
    .in("user_id", userIds)
    .eq("status", "active");
  if (error) throw new Error(`Failed to load push subscriptions for filing fanout: ${error.message}`);
  const pushIdsByUser = new Map<string, string[]>();
  for (const subscription of subscriptions ?? []) {
    const ids = pushIdsByUser.get(subscription.user_id) ?? [];
    ids.push(subscription.id);
    pushIdsByUser.set(subscription.user_id, ids);
  }
  const deliveries = immediate.flatMap((notification) =>
    (pushIdsByUser.get(notification.user_id) ?? []).map((subscriptionId) => ({
      notification_id: notification.id,
      subscription_id: subscriptionId,
    })),
  );
  if (!deliveries.length) return;
  const { error: deliveryError } = await admin
    .from("filing_notification_deliveries")
    .upsert(deliveries, { onConflict: "notification_id,subscription_id", ignoreDuplicates: true });
  if (deliveryError) throw new Error(`Failed to queue filing push deliveries: ${deliveryError.message}`);
}

async function completeFanout(job: ProcessingClaim, notificationsCreated: number, suppressedBaseline: boolean): Promise<void> {
  const { data, error } = await getSupabaseAdmin().rpc("complete_sec_filing_notification_fanout", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_progress_json: { notificationsCreated, suppressedBaseline },
  });
  if (error || !data) throw new Error(`Failed to complete SEC notification fanout: ${error?.message ?? "lease lost"}`);
}

async function failProcessingJob(job: ProcessingClaim, error: unknown): Promise<void> {
  const retryAfter = error instanceof SecRequestError ? error.retryAfterSeconds : null;
  const { error: failError } = await getSupabaseAdmin().rpc("fail_sec_filing_processing_job", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_error: errorMessage(error),
    p_retry_after_seconds: retryAfter,
  });
  if (failError) console.warn("[filing-notification-worker] failed to update processing job error", { error: failError.message });
}

async function failCheckpoint(
  options: GlobalFilingPipelineOptions,
  checkpoint: DiscoveryCheckpoint,
  error: unknown,
): Promise<void> {
  const retryAfter = error instanceof SecRequestError ? error.retryAfterSeconds : null;
  const { error: failError } = await getSupabaseAdmin().rpc("fail_sec_filing_discovery_checkpoint", {
    p_env: options.env,
    p_source_key: checkpoint.source_key,
    p_worker_id: options.workerId,
    p_claim_token: checkpoint.claim_token,
    p_error: errorMessage(error),
    p_retry_after_seconds: retryAfter,
  });
  if (failError) console.warn("[filing-notification-worker] failed to update Atom checkpoint error", { error: failError.message });
}

async function failReconciliation(
  options: GlobalFilingPipelineOptions,
  claim: ReconciliationClaim,
  error: unknown,
): Promise<void> {
  const retryAfter = error instanceof SecRequestError ? error.retryAfterSeconds : null;
  const { error: failError } = await getSupabaseAdmin().rpc("fail_catalog_sec_filing_reconciliation", {
    p_env: options.env,
    p_cik: claim.cik,
    p_worker_id: options.workerId,
    p_claim_token: claim.claim_token,
    p_error: errorMessage(error),
    p_retry_after_seconds: retryAfter,
  });
  if (failError) console.warn("[filing-notification-worker] failed to update reconciliation error", { error: failError.message });
}

function atomCurrentFeedUrl(formType: SecFilingFormType): string {
  const params = new URLSearchParams({
    action: "getcurrent",
    type: formType,
    company: "",
    dateb: "",
    owner: "include",
    start: "0",
    count: "100",
    output: "atom",
  });
  return `https://www.sec.gov/cgi-bin/browse-edgar?${params}`;
}

function utcDayBefore(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - 1));
}

function utcDayAfter(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + 1));
}

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isWeekendUtc(value: Date): boolean {
  const day = value.getUTCDay();
  return day === 0 || day === 6;
}

function findForm4XmlUrl(
  event: SecFilingEventRow,
  documents: Array<{ documentUrl: string; documentType: string | null; documentName: string; isPrimary: boolean }>,
): string | null {
  if (
    event.primary_document_url
    && /\.xml(?:$|\?)/i.test(event.primary_document_url)
    && !isSecXslRenderedDocumentUrl(event.primary_document_url)
  ) {
    return event.primary_document_url;
  }
  const rawXmlDocuments = documents.filter(
    (document) => /\.xml$/i.test(document.documentName) && !isSecXslRenderedDocumentUrl(document.documentUrl),
  );
  const candidate = rawXmlDocuments.find((document) => document.documentType === "4")
    ?? rawXmlDocuments.find((document) => document.isPrimary)
    ?? rawXmlDocuments[0]
    ?? documents.find((document) => document.documentType === "4" && /\.xml$/i.test(document.documentName))
    ?? documents.find((document) => /\.xml$/i.test(document.documentName) && document.isPrimary)
    ?? documents.find((document) => /\.xml$/i.test(document.documentName));
  return candidate?.documentUrl ?? null;
}

function sourceSecItems(metadata: unknown): string[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.secItems)) return [];
  return metadata.secItems
    .filter((value): value is string => typeof value === "string")
    .filter((value) => /^\d\.\d{2}$/.test(value));
}

function sourceDescription(metadata: unknown): string | null {
  return isRecord(metadata) && typeof metadata.primaryDocDescription === "string"
    ? metadata.primaryDocDescription
    : null;
}

function sourceBoolean(metadata: unknown, key: string): boolean {
  return isRecord(metadata) && metadata[key] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

class SecRequestScheduler {
  constructor(private readonly minIntervalMs: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await reserveSecRequestSlot({
      scope: "global",
      minIntervalMs: this.minIntervalMs,
    });
    return operation();
  }
}
