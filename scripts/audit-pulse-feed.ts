/**
 * Read-only Pulse audit for an internal account. It never writes Supabase and
 * deliberately emits only aggregate affinity and card metadata, not messages
 * or research question content.
 *
 * Run through the worker bundle alias because Pulse source modules are marked
 * server-only:
 *   PULSE_AUDIT_EMAIL=... esbuild scripts/audit-pulse-feed.ts ... && node ...
 */
import { createClient } from "@supabase/supabase-js";
import { composePulseFeed } from "@/lib/pulse/composer";
import {
  getPulseUserTickerSignals,
  type PulseResearchAffinity,
} from "@/lib/pulse/personalization";
import {
  createPulseDeviceProfile,
  selectDevicePulseSlate,
} from "@/lib/pulse/device-ranking";
import { buildPulseFeedDisplayEntries } from "@/lib/pulse/insider-trade-stack";
import type { PulseItem } from "@/types/api-contracts";
import type { Database } from "@/types/database";

type Form4Event = {
  id: string;
  cik: string;
  form_type: "4" | "4/A";
  is_amendment: boolean;
  accepted_at: string | null;
  first_seen_at: string;
};

type Form4Owner = {
  filing_event_id: string;
  reporting_owner_index: number;
  owner_cik: string | null;
  owner_name: string;
};

type Form4Transaction = {
  id: string;
  filing_event_id: string;
  reporting_owner_index: number;
  security_kind: string;
  security_title: string;
  transaction_date: string | null;
  transaction_code: string | null;
  transaction_shares: string | number | null;
  acquired_disposed_code: string | null;
  shares_owned_following: string | number | null;
  direct_indirect_code: string | null;
  reported_transaction_value: string | number | null;
  reported_value_basis: string;
};

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "PULSE_AUDIT_EMAIL"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function timestamp(event: Pick<Form4Event, "accepted_at" | "first_seen_at">): number {
  return Date.parse(event.accepted_at ?? event.first_seen_at);
}

function number(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ownerKey(owner: Form4Owner | undefined): string | null {
  if (!owner) return null;
  return `${owner.owner_cik ?? ""}:${owner.owner_name.trim().toLocaleLowerCase("en-US")}`;
}

function sameTransactionFingerprint(
  left: Form4Transaction,
  right: Form4Transaction,
): boolean {
  return left.security_kind === right.security_kind
    && left.security_title === right.security_title
    && left.transaction_date === right.transaction_date
    && left.transaction_code === right.transaction_code
    && number(left.transaction_shares) === number(right.transaction_shares)
    && left.acquired_disposed_code === right.acquired_disposed_code
    && number(left.shares_owned_following) === number(right.shares_owned_following)
    && left.direct_indirect_code === right.direct_indirect_code;
}

function toDisplayLabel(item: PulseItem): string {
  const formType = String(item.metadata.form_type ?? "");
  if (formType === "4" || formType === "4/A") {
    const sale = typeof item.metadata.form4_reported_sale_value === "number"
      ? Math.round(item.metadata.form4_reported_sale_value)
      : null;
    const purchase = typeof item.metadata.form4_reported_purchase_value === "number"
      ? Math.round(item.metadata.form4_reported_purchase_value)
      : null;
    return `${item.ticker ?? "SEC"} ${formType}${purchase === null ? "" : ` buy $${purchase}`}${sale === null ? "" : ` sell $${sale}`}`;
  }
  return `${item.kind}:${item.ticker ?? "-"}:${item.title.slice(0, 80)}`;
}

function affinitySummary(
  affinities: Map<string, PulseResearchAffinity>,
): Array<Record<string, string | number>> {
  return [...affinities.entries()]
    .sort(([, left], [, right]) => right.score - left.score)
    .slice(0, 12)
    .map(([ticker, affinity]) => ({
      ticker,
      research_sessions: affinity.research_session_count,
      completed_runs: affinity.completed_run_count,
      research_days: affinity.distinct_research_days,
      tier: affinity.tier,
      score: affinity.score,
    }));
}

async function main() {
  const supabase = createClient<Database>(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const email = requiredEnv("PULSE_AUDIT_EMAIL").toLocaleLowerCase("en-US");
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (usersError) throw usersError;
  const user = users.users.find((candidate) => candidate.email?.toLocaleLowerCase("en-US") === email);
  if (!user) throw new Error("Audit account was not found");

  const now = new Date();
  const [signals, feed] = await Promise.all([
    getPulseUserTickerSignals(supabase, user.id, now),
    composePulseFeed({
      supabase,
      userId: user.id,
      includeNotebookSources: true,
      filter: "all",
      limit: 20,
      now,
    }),
  ]);

  const psxCandidateIds = feed.candidate_items
    .filter((item) => item.ticker === "PSX" && ["4", "4/A"].includes(String(item.metadata.form_type ?? "")))
    .map((item) => item.source_id);
  const { data: psxEvents, error: psxEventsError } = await supabase
    .from("sec_filing_events")
    .select("id,cik,form_type,is_amendment,accepted_at,first_seen_at")
    .eq("env", "prod")
    .eq("ticker", "PSX")
    .in("form_type", ["4", "4/A"])
    .order("accepted_at", { ascending: true })
    .limit(80)
    .returns<Form4Event[]>();
  if (psxEventsError) throw psxEventsError;

  const psxEventIds = (psxEvents ?? []).map((event) => event.id);
  const [ownersResult, transactionsResult] = psxEventIds.length === 0
    ? [{ data: [] as Form4Owner[], error: null }, { data: [] as Form4Transaction[], error: null }]
    : await Promise.all([
      supabase
        .from("sec_form4_reporting_owners")
        .select("filing_event_id,reporting_owner_index,owner_cik,owner_name")
        .in("filing_event_id", psxEventIds)
        .returns<Form4Owner[]>(),
      supabase
        .from("sec_form4_transactions")
        .select("id,filing_event_id,reporting_owner_index,security_kind,security_title,transaction_date,transaction_code,transaction_shares,acquired_disposed_code,shares_owned_following,direct_indirect_code,reported_transaction_value,reported_value_basis")
        .in("filing_event_id", psxEventIds)
        .returns<Form4Transaction[]>(),
    ]);
  if (ownersResult.error) throw ownersResult.error;
  if (transactionsResult.error) throw transactionsResult.error;

  const eventById = new Map((psxEvents ?? []).map((event) => [event.id, event]));
  const ownerByTransaction = new Map(
    (transactionsResult.data ?? []).map((transaction) => {
      const owner = (ownersResult.data ?? []).find((candidate) =>
        candidate.filing_event_id === transaction.filing_event_id
          && candidate.reporting_owner_index === transaction.reporting_owner_index);
      return [transaction.id, ownerKey(owner)];
    }),
  );
  const supersededTransactionIds = new Set<string>();
  const correctionEventIds = new Set<string>();
  for (const correction of transactionsResult.data ?? []) {
    const correctionEvent = eventById.get(correction.filing_event_id);
    if (!correctionEvent || correctionEvent.form_type !== "4/A" || !correctionEvent.is_amendment) continue;
    const matches = (transactionsResult.data ?? []).filter((candidate) => {
      const candidateEvent = eventById.get(candidate.filing_event_id);
      return Boolean(candidateEvent)
        && candidate.filing_event_id !== correction.filing_event_id
        && candidateEvent!.cik === correctionEvent.cik
        && timestamp(candidateEvent!) <= timestamp(correctionEvent)
        && timestamp(correctionEvent) - timestamp(candidateEvent!) <= 45 * 24 * 60 * 60 * 1_000
        && ownerByTransaction.get(candidate.id) === ownerByTransaction.get(correction.id)
        && !supersededTransactionIds.has(candidate.id)
        && sameTransactionFingerprint(candidate, correction);
    });
    if (matches.length === 1 && matches[0]) {
      supersededTransactionIds.add(matches[0].id);
      correctionEventIds.add(correction.filing_event_id);
    }
  }

  const effectiveByEvent = new Map<string, { purchase: number | null; sale: number | null; replaced: number }>();
  for (const eventId of psxEventIds) {
    const transactions = (transactionsResult.data ?? []).filter((transaction) =>
      transaction.filing_event_id === eventId
        && transaction.reported_value_basis === "p_or_s"
        && (transaction.transaction_code === "P" || transaction.transaction_code === "S")
        && !supersededTransactionIds.has(transaction.id));
    const purchase = transactions
      .filter((transaction) => transaction.transaction_code === "P")
      .reduce((total, transaction) => total + (number(transaction.reported_transaction_value) ?? 0), 0);
    const sale = transactions
      .filter((transaction) => transaction.transaction_code === "S")
      .reduce((total, transaction) => total + (number(transaction.reported_transaction_value) ?? 0), 0);
    const allPOrS = (transactionsResult.data ?? []).filter((transaction) =>
      transaction.filing_event_id === eventId
        && transaction.reported_value_basis === "p_or_s"
        && (transaction.transaction_code === "P" || transaction.transaction_code === "S"));
    effectiveByEvent.set(eventId, {
      purchase: purchase || null,
      sale: sale || null,
      replaced: allPOrS.length - transactions.length,
    });
  }

  const correctedCandidateItems = feed.candidate_items.flatMap((item) => {
    const effective = effectiveByEvent.get(item.source_id);
    if (!effective) return [item];
    if (effective.purchase === null && effective.sale === null) return [];
    return [{
      ...item,
      metadata: {
        ...item.metadata,
        form4_reported_purchase_value: effective.purchase,
        form4_reported_sale_value: effective.sale,
        form4_has_reported_open_market_trade: true,
      },
    }];
  });
  const correctedFeed = { ...feed, candidate_items: correctedCandidateItems };
  const slate = selectDevicePulseSlate(correctedFeed, createPulseDeviceProfile(now), now);
  const displayEntries = buildPulseFeedDisplayEntries(slate.items, feed.timezone, feed.visible_limit);

  console.log(JSON.stringify({
    generated_at: now.toISOString(),
    source_statuses: feed.source_statuses,
    affinity: affinitySummary(signals.researchAffinityByTicker),
    raw_candidate_count: feed.candidate_items.length,
    selected_candidate_count: slate.items.length,
    display_entry_count: displayEntries.length,
    psx_supersession_count: supersededTransactionIds.size,
    psx_effective_form4s: (psxEvents ?? [])
      .filter((event) => {
        const effective = effectiveByEvent.get(event.id);
        return Boolean(effective && effective.replaced > 0)
          || correctionEventIds.has(event.id)
          || psxCandidateIds.includes(event.id);
      })
      .map((event) => ({
        form_type: event.form_type,
        is_amendment: event.is_amendment,
        ...(effectiveByEvent.get(event.id) ?? {}),
      })),
    corrected_psx_candidates: [...effectiveByEvent.entries()]
      .filter(([filing_event_id]) => psxCandidateIds.includes(filing_event_id))
      .map(([filing_event_id, effective]) => ({ filing_event_id, ...effective })),
    display_entries: displayEntries.map((entry) => entry.type === "item"
      ? { type: "item", position: entry.position, slot: entry.item.feed_slot, item: toDisplayLabel(entry.item) }
      : {
        type: "insider_trade_stack",
        position: entry.position,
        slot: entry.feed_slot,
        items: entry.items.map(({ item }) => toDisplayLabel(item)),
      }),
  }, null, 2));
}

void main();
