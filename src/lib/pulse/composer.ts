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
  PULSE_PAGE_SIZE,
  pulseItemSchema,
  type PulseCandidate,
  type PulseRankedCandidate,
} from "@/lib/pulse/contract";
import {
  applyPulseItemStates,
  getPulseItemStates,
  hasRecentKindImpression,
  markPulseItemsFirstSeen,
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
  rankPulseCandidates,
  selectFinitePulseQueue,
} from "@/lib/pulse/ranking";
import { getLearningCandidates, selectLearningCandidate } from "@/lib/pulse/sources/learning";
import { getAnalysisCandidates } from "@/lib/pulse/sources/analysis";
import { getFilingCandidates } from "@/lib/pulse/sources/filings";
import { getQuestionCandidates } from "@/lib/pulse/sources/questions";
import { getRawResurfaceCandidates, selectResurfaceCandidate } from "@/lib/pulse/sources/resurface";
import { buildPulseSummary } from "@/lib/pulse/summary";
import { getPulseFilingDecisionContext } from "@/lib/judgments/read-model";
import type {
  PulseFeedResponse,
  PulseFilter,
  PulseItem,
  PulseItemKind,
  PulseSourceStatus,
} from "@/types/api-contracts";
import type { Database } from "@/types/database";

const SOURCE_KINDS = ["filing", "analysis", "question", "resurface", "learning"] as const satisfies readonly PulseItemKind[];

export interface ComposePulseFeedOptions {
  supabase: SupabaseClient<Database>;
  userId: string;
  includeNotebookSources: boolean;
  filter?: PulseFilter;
  limit?: number;
  since?: string | null;
  now?: Date;
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
}: ComposePulseFeedOptions): Promise<PulseFeedResponse> {
  const snapshotAt = now;
  const preferences = await getPulsePreferences(supabase, userId);
  const enabledKinds = new Set(preferences.enabled_kinds);
  const resurfaceCadence = preferences.resurface_cadence === "biweekly" ? "biweekly" : "weekly";
  // These reads are correctness state, not optional ranking enhancements. If
  // they are unavailable, returning a normal-looking feed could resurrect
  // hidden cards or erase an existing judgment. Let the API fail closed while
  // the client keeps its last known-good/offline snapshot.
  const userSignals = await getPulseUserTickerSignals(supabase, userId, snapshotAt);
  const monitoringRules = await getPulseMonitoringRules(supabase, userId);

  const settled = await Promise.allSettled([
    loadSource("filing", enabledKinds.has("filing"), () => getFilingCandidates(supabase, snapshotAt, userSignals.preferredTickers)),
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
    getPulseItemStates(supabase, userId, personalized.map((item) => item.item_key)),
    getPulseFilingDecisionContext(
      supabase,
      userId,
      personalized.filter((item) => item.kind === "filing").map((item) => item.source_id),
    ),
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
  const stateful = applyPulseItemStates(contextualized, states, snapshotAt, preferences.timezone);

  // Rotation follows per-item hidden/snoozed/fatigue state, ensuring a hidden
  // first candidate never makes the whole resurface/learning source disappear.
  const scheduledReviews = stateful.filter((item) =>
    item.kind === "resurface" && item.metadata.monitoring_rule_type === "scheduled_review");
  const resurface = hasRecentKindImpression(
    states,
    "resurface",
    snapshotAt,
    preferences.timezone,
    28 * 24 * 60 * 60 * 1_000,
  )
    ? []
    : selectResurfaceCandidate(
      stateful.filter((item) => item.kind === "resurface" && item.metadata.monitoring_rule_type !== "scheduled_review"),
      userId,
      snapshotAt,
      resurfaceCadence,
    );
  const learning = hasRecentKindImpression(
    states,
    "learning",
    snapshotAt,
    preferences.timezone,
    7 * 24 * 60 * 60 * 1_000,
  )
    ? []
    : selectLearningCandidate(
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
  const rankedFeed = ranked.filter((item) => !isActiveAnalysis(item));
  const developmentFeed = developmentShowcase.filter((item) => !isActiveAnalysis(item));
  const developmentActiveAnalysis = developmentShowcase.filter(isActiveAnalysis);

  const boundedLimit = Math.max(1, Math.min(limit, PULSE_PAGE_SIZE));
  const displayItems = selectFinitePulseQueue(
    [...developmentFeed, ...rankedFeed],
    boundedLimit,
  );

  const visibleActiveAnalysis = [...developmentActiveAnalysis, ...activeAnalysis].slice(0, 2);
  const summary = buildPulseSummary([...displayItems, ...visibleActiveAnalysis]);
  await markPulseItemsFirstSeen(supabase, userId, [...displayItems, ...visibleActiveAnalysis], snapshotAt).catch((error) => {
    console.warn("[pulse] failed to mark first delivered", {
      error_code: typeof error === "object" && error && "code" in error ? String(error.code) : "unknown",
    });
  });

  const sinceTime = since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : null;

  return {
    generated_at: snapshotAt.toISOString(),
    snapshot_at: snapshotAt.toISOString(),
    ranking_version: "rule_v3",
    timezone: preferences.timezone,
    date_label: formatDateLabel(snapshotAt, preferences.timezone),
    filter,
    summary,
    active_analysis_items: toPublicItems(visibleActiveAnalysis),
    items: toPublicItems(displayItems),
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
    generated_at: now.toISOString(),
    snapshot_at: now.toISOString(),
    ranking_version: "rule_v3",
    timezone: "Asia/Seoul",
    date_label: formatDateLabel(now, "Asia/Seoul"),
    filter: "all",
    summary: {
      actionable_count: 0,
      active_analysis_count: 0,
      counts: { filing: 0, analysis: 0, question: 0, resurface: 0 },
      primary_action: null,
    },
    active_analysis_items: [],
    items: [],
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
    is_pinned,
    lane,
    rank_score,
    priority_rank,
    coverage_rank,
    saved_rank,
    ...item
  } = candidate;
  void has_recent_research;
  void is_pinned;
  void lane;
  void rank_score;
  void priority_rank;
  void coverage_rank;
  void saved_rank;
  const parsed = pulseItemSchema.safeParse({
    ...item,
    id: encodePulseItemId(item_key),
    metadata: item.metadata,
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
