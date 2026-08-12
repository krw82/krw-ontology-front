import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPulseSourceEnabled } from "@/lib/pulse/enabled";
import {
  buildDevelopmentPulseShowcase,
  isPulseDevelopmentShowcaseEnabled,
} from "@/lib/pulse/development";
import {
  encodePulseItemId,
  normalizePulseDateTime,
  PULSE_ACTIVE_ANALYSIS_ITEM_LIMIT,
  PULSE_COMPLETED_ANALYSIS_ITEM_LIMIT,
  PULSE_PAGE_SIZE,
  PULSE_VISIBLE_ITEM_LIMIT,
  pulseItemSchema,
  type PulseCandidate,
  type PulseRankedCandidate,
} from "@/lib/pulse/contract";
import {
  applyPulseItemStates,
  getPulseItemStates,
} from "@/lib/pulse/item-state";
import {
  applyPulseFilingDecisionTicker,
  applyPulseUserTickerSignals,
  getPulseUserTickerSignals,
  pulseCandidateTickerIdentities,
} from "@/lib/pulse/personalization";
import {
  applyPulseMonitoringRules,
  buildDueMonitoringCandidates,
  getPulseMonitoringRules,
} from "@/lib/pulse/monitoring";
import { getPulsePreferences } from "@/lib/pulse/preferences";
import {
  buildPulseCandidatePool,
  rankPulseCandidates,
} from "@/lib/pulse/ranking";
import { getLearningCandidates, selectLearningCandidate } from "@/lib/pulse/sources/learning";
import { getAnalysisCandidates } from "@/lib/pulse/sources/analysis";
import { getFilingCandidates } from "@/lib/pulse/sources/filings";
import { getQuestionCandidates } from "@/lib/pulse/sources/questions";
import { getRawResurfaceCandidates, selectResurfaceCandidate } from "@/lib/pulse/sources/resurface";
import { getNewsCandidates } from "@/lib/pulse/sources/news";
import { buildPulseItemVersions } from "@/lib/pulse/delta";
import { getPulseFeedRevision, type PulseFeedRevision } from "@/lib/pulse/revision";
import { getPulseFilingDecisionContext } from "@/lib/judgments/read-model";
import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";
import { DEFAULT_LOCALE } from "@/i18n/config";
import type {
  PulseFeedResponse,
  PulseFilter,
  PulseItem,
  PulseItemKind,
  PulseSourceStatus,
} from "@/types/api-contracts";
import type { Database } from "@/types/database";

const SOURCE_KINDS = ["filing", "analysis", "question", "resurface", "learning", "news"] as const satisfies readonly PulseItemKind[];

export interface ComposePulseFeedOptions {
  supabase: SupabaseClient<Database>;
  userId: string;
  includeNotebookSources: boolean;
  filter?: PulseFilter;
  limit?: number;
  since?: string | null;
  now?: Date;
  /** The route obtains this once so the snapshot and HTTP ETag cannot diverge. */
  revision?: PulseFeedRevision;
}

/**
 * Builds a deterministic, finite research inbox. Source retrieval is parallel;
 * no LLM, credit reservation, or new agent run is started from this path.
 */
export async function composePulseFeed({
  supabase,
  userId,
  includeNotebookSources,
  filter = "all",
  limit = PULSE_PAGE_SIZE,
  since,
  now = new Date(),
  revision: suppliedRevision,
}: ComposePulseFeedOptions): Promise<PulseFeedResponse> {
  const snapshotAt = now;
  // Stage labels wrap each async read so a thrown error reports which stage
  // failed ("pulse:setup:preferences") rather than an opaque catch-all.
  const [revision, preferences, userSignals, monitoringRules] = await Promise.all([
    suppliedRevision ?? withStage("revision", () => getPulseFeedRevision(supabase, userId, snapshotAt)),
    withStage("preferences", () => getPulsePreferences(supabase, userId)),
    withStage("signals", () => getPulseUserTickerSignals(supabase, userId, snapshotAt)),
    withStage("monitoring", () => getPulseMonitoringRules(supabase, userId)),
  ]);
  const enabledKinds = new Set(preferences.enabled_kinds);
  const resurfaceCadence = preferences.resurface_cadence === "biweekly" ? "biweekly" : "weekly";
  // These reads are correctness state, not optional ranking enhancements. If
  // they are unavailable, returning a normal-looking feed could resurrect
  // hidden cards or erase an existing judgment. Let the API fail closed while
  // the client keeps its last known-good/offline snapshot.

  const settled = await Promise.allSettled([
    loadSource(
      "filing",
      enabledKinds.has("filing"),
      () => getFilingCandidates(
        supabase,
        snapshotAt,
        userSignals.preferredTickers,
        revision,
        [...userSignals.coverageByTicker.keys()],
      ),
    ),
    loadSource("analysis", enabledKinds.has("analysis"), () => getAnalysisCandidates(supabase, userId, snapshotAt)),
    loadSource(
      "question",
      includeNotebookSources
        && isQuestionCadenceDay(preferences.question_cadence, preferences.timezone, snapshotAt)
        && enabledKinds.has("question"),
      () => getQuestionCandidates(supabase, userId, snapshotAt),
    ),
    loadSource(
      "resurface",
      isPulseSourceEnabled("resurface")
        && includeNotebookSources
        && preferences.resurface_cadence !== "off"
        && preferences.resurfacing_enabled
        && enabledKinds.has("resurface"),
      async () => [
        ...await getRawResurfaceCandidates(supabase, userId, snapshotAt),
        ...buildDueMonitoringCandidates(monitoringRules, snapshotAt),
      ],
    ),
    loadSource(
      "learning",
      isPulseSourceEnabled("learning")
        && preferences.learning_cadence !== "off"
        && preferences.learning_enabled
        && enabledKinds.has("learning"),
      async () => getLearningCandidates(supabase, snapshotAt),
    ),
    loadSource(
      "news",
      enabledKinds.has("news"),
      () => getNewsCandidates(supabase, userId, snapshotAt, userSignals.preferredTickers),
    ),
  ] as const);

  const sources = settled.map((result, index) => result.status === "fulfilled"
    ? result.value
    : { items: [], status: degradedStatus(SOURCE_KINDS[index]) });
  const sourceStatuses = sources.map((source) => source.status);
  const mutedTickers = new Set(preferences.muted_tickers);
  const sourceCandidates = sources
    .flatMap((source) => source.items)
    .filter((item) => !pulseCandidateTickerIdentities(item)
      .some((ticker) => mutedTickers.has(ticker)))
    .filter((item) => filter === "all" || item.kind === filter);

  const personalized = applyPulseMonitoringRules(
    applyPulseUserTickerSignals(sourceCandidates, userSignals),
    monitoringRules,
  );
  const [states, filingDecisions] = await Promise.all([
    withStage("item-states", () => getPulseItemStates(supabase, userId, personalized.map((item) => item.item_key))),
    withStage("filing-decisions", () => getPulseFilingDecisionContext(
      supabase,
      userId,
      personalized.filter((item) => item.kind === "filing").map((item) => item.source_id),
    )),
  ]);
  const contextualized = personalized.map((item) => {
    if (item.kind !== "filing") return item;
    const context = filingDecisions.get(item.source_id);
    if (!context) return item;
    const contextualizedItem = applyPulseFilingDecisionTicker(
      item,
      context.judgment.ticker,
      userSignals,
    );
    return {
      ...contextualizedItem,
      judgment: {
        ...context.judgment,
        updated_at: normalizePulseDateTime(context.judgment.updated_at),
      },
      linked_thesis: context.linked_thesis,
    };
  });
  const stateful = applyPulseItemStates(contextualized, states, snapshotAt);

  // Rotation follows per-item hidden/snoozed/fatigue state, ensuring a hidden
  // first candidate never makes the whole resurface/learning source disappear.
  const scheduledReviews = stateful.filter((item) =>
    item.kind === "resurface" && item.metadata.monitoring_rule_type === "scheduled_review");
  // Rotation and fatigue are device-local in the flat feed. Resurface remains
  // account-scoped, while early editorial stories are emitted as a small
  // approved reservoir for the browser to choose from without a per-device
  // database write.
  const resurface = selectResurfaceCandidate(
    stateful.filter((item) => item.kind === "resurface" && item.metadata.monitoring_rule_type !== "scheduled_review"),
    userId,
    snapshotAt,
    resurfaceCadence,
  );
  const learning = selectLearningCandidate(
    stateful.filter((item) => item.kind === "learning"),
    userId,
    snapshotAt,
  );
  const candidates = [
    ...stateful.filter((item) => item.kind !== "resurface" && item.kind !== "learning"),
    ...scheduledReviews,
    ...resurface,
    ...learning,
  ];
  const ranked = rankPulseCandidates(candidates, snapshotAt);
  const developmentShowcase = isPulseDevelopmentShowcaseEnabled() && !since
    ? rankPulseCandidates(buildDevelopmentPulseShowcase(snapshotAt), snapshotAt)
    : [];
  const activeAnalysis = ranked.filter(isActiveAnalysis);
  // V10 separates completed analyses into a transient notification lane and
  // removes them from the ordinary candidate pool so a finished run no longer
  // competes with new filings and news for screen space.
  const completedAnalysis = ranked.filter(isCompletedAnalysis);
  // Active analyses are also candidates in V5. The separate field remains a
  // compact status channel for polling and summaries; the client de-duplicates
  // it and renders one continuous stream.
  const rankedFeed = ranked.filter((item) => !isCompletedAnalysis(item));
  const developmentFeed = developmentShowcase.filter((item) => !isCompletedAnalysis(item));
  const developmentActiveAnalysis = developmentShowcase.filter(isActiveAnalysis);
  const developmentCompletedAnalysis = developmentShowcase.filter(isCompletedAnalysis);

  const boundedLimit = Math.max(1, Math.min(limit, PULSE_PAGE_SIZE));
  const rankedCandidates = [...developmentFeed, ...rankedFeed];
  const pooledCandidates = buildPulseCandidatePool(rankedCandidates, snapshotAt);
  // V9 sends an account-relevant, server-authorized reservoir rather than
  // forcing one editorial item into the account-level order. The browser
  // chooses one story with private device-local state and keeps it stable
  // until an intentional refresh.
  const candidateItems = pooledCandidates.slice(0, boundedLimit);
  const candidateRankByKey = new Map(
    candidateItems.map((candidate) => [candidate.item_key, candidate.server_rank]),
  );

  const visibleActiveAnalysis = [...developmentActiveAnalysis, ...activeAnalysis]
    .slice(0, PULSE_ACTIVE_ANALYSIS_ITEM_LIMIT)
    .map((candidate, activeIndex) => ({
      ...candidate,
      // The status channel duplicates an active card only for polling. Keep
      // its exact candidate rank so a sparse delta cannot overwrite the flat
      // baseline order with a legacy "active first" position.
      server_rank: candidateRankByKey.get(candidate.item_key)
        ?? candidateItems.length + activeIndex,
    }));

  const visibleCompletedAnalysis = [...developmentCompletedAnalysis, ...completedAnalysis]
    .slice(0, PULSE_COMPLETED_ANALYSIS_ITEM_LIMIT);

  const sinceTime = since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : null;

  const publicActiveAnalysis = toPublicItems(visibleActiveAnalysis);
  const publicCompletedAnalysis = toPublicItems(visibleCompletedAnalysis);
  const publicCandidateItems = toPublicItems(candidateItems);

  return {
    revision: revision.value,
    generated_at: snapshotAt.toISOString(),
    snapshot_at: snapshotAt.toISOString(),
    ranking_version: "rule_v10_research_completion",
    timezone: preferences.timezone,
    date_label: formatDateLabel(snapshotAt, preferences.timezone),
    filter,
    active_analysis_items: publicActiveAnalysis,
    completed_analysis_items: publicCompletedAnalysis,
    candidate_items: publicCandidateItems,
    visible_limit: PULSE_VISIBLE_ITEM_LIMIT,
    item_versions: buildPulseItemVersions({
      active_analysis_items: publicActiveAnalysis,
      completed_analysis_items: publicCompletedAnalysis,
      candidate_items: publicCandidateItems,
    }),
    new_item_count: sinceTime === null
      ? 0
      : ranked.filter((item) => item.actionable
        && item.kind !== "learning"
        && item.kind !== "resurface"
        && Date.parse(item.available_at) > sinceTime).length,
    source_statuses: sourceStatuses,
  };
}

/**
 * Server rendering must still give the user a usable Pulse shell when an
 * upstream read is temporarily unavailable. The client can retry the normal
 * API path; this fallback never invents a signal or starts background work.
 */
export function createUnavailablePulseFeed(now = new Date()): PulseFeedResponse {
  return {
    revision: "unavailable",
    generated_at: now.toISOString(),
    snapshot_at: now.toISOString(),
    ranking_version: "rule_v10_research_completion",
    timezone: "Asia/Seoul",
    date_label: formatDateLabel(now, "Asia/Seoul"),
    filter: "all",
    active_analysis_items: [],
    completed_analysis_items: [],
    candidate_items: [],
    visible_limit: PULSE_VISIBLE_ITEM_LIMIT,
    item_versions: {},
    new_item_count: 0,
    source_statuses: SOURCE_KINDS.map((source) => degradedStatus(source)),
  };
}

function toPublicItems(candidates: PulseRankedCandidate[]): PulseItem[] {
  return candidates.flatMap((candidate) => {
    const item = toPublicItem(candidate);
    return item ? [item] : [];
  });
}

function toPublicItem(candidate: PulseRankedCandidate): PulseItem | null {
  const {
    item_key,
    has_recent_research,
    research_affinity,
    is_pinned,
    lane,
    rank_score,
    priority_rank,
    coverage_rank,
    saved_rank,
    ...item
  } = candidate;
  void has_recent_research;
  void research_affinity;
  void is_pinned;
  void lane;
  void rank_score;
  void priority_rank;
  void coverage_rank;
  void saved_rank;
  const parsed = pulseItemSchema.safeParse({
    ...item,
    id: encodePulseItemId(item_key),
    metadata: withCompanyDisplayMetadata(item.ticker, item.metadata),
    phase: item.phase ?? null,
    occurred_at: normalizePulseDateTime(item.occurred_at),
    available_at: normalizePulseDateTime(item.available_at),
    expires_at: normalizePulseDateTime(item.expires_at),
    reviewed_at: normalizePulseDateTime(item.reviewed_at),
    saved_at: normalizePulseDateTime(item.saved_at),
    snoozed_until: normalizePulseDateTime(item.snoozed_until),
  });
  if (parsed.success) return parsed.data;
  console.warn("[pulse] skipped invalid feed item", {
    item_key,
    issue_count: parsed.error.issues.length,
  });
  return null;
}

function withCompanyDisplayMetadata(
  ticker: string | null,
  metadata: PulseItem["metadata"],
): PulseItem["metadata"] {
  if (!ticker || typeof metadata.company_name_ko === "string") return metadata;

  const copy = getCompanyDisplayCopyForTicker(DEFAULT_LOCALE, ticker);
  const companyName = copy.companyNameKo ?? copy.name;
  if (!companyName) return metadata;

  return { ...metadata, company_name_ko: companyName };
}

async function loadSource(
  source: (typeof SOURCE_KINDS)[number],
  enabled: boolean,
  load: () => Promise<PulseCandidate[]>,
): Promise<{ items: PulseCandidate[]; status: PulseSourceStatus }> {
  if (!enabled) return { items: [], status: { source, status: "unavailable", item_count: 0 } };
  const startedAt = performance.now();
  const items = await load();
  return {
    items,
    status: {
      source,
      status: items.length > 0 ? "ready" : "empty",
      item_count: items.length,
      latency_ms: Math.round(performance.now() - startedAt),
    },
  };
}

function degradedStatus(source: (typeof SOURCE_KINDS)[number]): PulseSourceStatus {
  return { source, status: "degraded", item_count: 0 };
}

/**
 * Tags an async read with its pipeline stage so a thrown error carries an
 * identifiable "pulse:<stage>" prefix instead of an opaque message. This makes
 * the 503 catch block immediately diagnosable in server logs.
 */
export async function withStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const base = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`pulse:${stage} failed: ${base}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function formatDateLabel(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
}

function isActiveAnalysis(item: PulseRankedCandidate): boolean {
  return item.kind === "analysis" && item.phase === "active";
}

function isCompletedAnalysis(item: PulseRankedCandidate): boolean {
  return item.kind === "analysis" && item.phase === "completed";
}

function isQuestionCadenceDay(
  cadence: "daily" | "three_weekly" | "off",
  timezone: string,
  now: Date,
): boolean {
  if (cadence === "off") return false;
  if (cadence === "daily") return true;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
  return weekday === "Mon" || weekday === "Wed" || weekday === "Fri";
}
